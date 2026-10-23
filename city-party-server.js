// city-party-server.js — JexCity : salons de jeu/loisir entre PLUSIEURS appareils (Arène Stickman en ligne, cinéma à plusieurs).
// Principe : un salon = un hôte + jusqu'à 3 invités (joueurs présents dans la ville, visibles, non bloqués, sans sourdine).
//  · l'hôte fait tourner la partie et diffuse des instantanés (party:relay k='snap') ; les invités n'envoient que leur touche (k='in').
//  · le serveur ne fait que valider, limiter le débit/la taille et relayer : rien n'est écrit en base, tout vit en mémoire.
//  · cinéma : l'hôte choisit un lien (https) ; le serveur le valide et le diffuse aux membres du salon.
// Événements client → serveur : party:invite · party:accept · party:decline · party:start · party:end · party:film · party:relay · party:leave
// Événements serveur → client : party:invited · party:lobby · party:start · party:film · party:relay · party:closed · party:declined
'use strict';

const TYPES = new Set(['arena', 'cinema']);
const MODES = new Set(['course', 'sumo', 'sweep', 'tanks', 'football', 'paint']);
const MAX_MEMBERS = 4, PENDING_MS = 60 * 1000, IDLE_MS = 30 * 60 * 1000, MAX_ROOMS = 80, MAX_MSG = 9000;

function cleanFilm(v) {
  if (!v || typeof v.url !== 'string') return null;
  let u; try { u = new URL(v.url.trim()); } catch (_) { return null; }
  if (u.protocol !== 'https:' || u.href.length > 600) return null;
  // eslint-disable-next-line no-control-regex
  const title = String(v.title || '').replace(/[\u0000-\u001F\u007F<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
  return { url: u.href, title };
}

function createParty({ io, db, sec, presence, isMuted, now = () => Date.now() }) {
  const rooms = new Map();   // id -> salle
  const byUser = new Map();  // userId -> id de salle
  const toUser = (id, ev, payload) => io.to(`user:${id}`).emit(ev, payload);
  let seq = 0;
  const newId = () => `p${now().toString(36)}${(++seq).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  const lobby = (r) => ({
    id: r.id, type: r.type, host: r.host, status: r.status, mode: r.mode || null,
    members: r.members.map((m) => ({ id: m.id, username: m.username })),
    invited: [...r.invited.keys()],
    film: r.film ? { url: r.film.url, title: r.film.title, elapsed: Math.max(0, Math.round((now() - r.film.t0) / 1000)) } : null,
  });
  const sendLobby = (r) => { for (const m of r.members) toUser(m.id, 'party:lobby', lobby(r)); };
  function close(r, reason) {
    if (!rooms.delete(r.id)) return;
    for (const m of r.members) { if (byUser.get(m.id) === r.id) byUser.delete(m.id); toUser(m.id, 'party:closed', { id: r.id, reason }); }
  }
  function leaveRoom(userId, reason = 'left') {
    const id = byUser.get(userId), r = id && rooms.get(id); if (!r) return;
    if (r.host === userId) return close(r, reason);
    r.members = r.members.filter((m) => m.id !== userId); byUser.delete(userId);
    toUser(userId, 'party:closed', { id: r.id, reason });
    if (r.members.length < 2 && r.invited.size === 0 && r.type === 'arena' && r.status === 'lobby') { /* l'hôte reste seul dans son salon : il peut réinviter */ }
    sendLobby(r);
  }
  const roomOf = (userId, id) => { const r = rooms.get(id); return r && r.members.some((m) => m.id === userId) ? r : null; };

  function attach(socket) {
    const userId = socket.userId;
    const rl = (a, max, ms) => sec.socketRateLimit(socket.id, `party:${a}`, max, ms);
    const reply = (ack, v) => { if (typeof ack === 'function') ack(v); };

    socket.on('party:invite', async (data, ack) => {
      try {
        if (!rl('invite', 10, 60000)) return reply(ack, { error: 'Trop d’invitations. Patientez un instant.' });
        const tid = String(data?.to || ''), type = data?.type;
        if (!TYPES.has(type)) return reply(ack, { error: 'Activité indisponible.' });
        if (!sec.isValidObjectId(tid) || tid === userId) return reply(ack, { error: 'Joueur invalide.' });
        const me = presence.present.get(userId), other = presence.present.get(tid);
        if (!me || !other || !socket.cityJoined) return reply(ack, { error: 'Ce joueur n’est pas dans la ville.' });
        if (byUser.has(tid)) return reply(ack, { error: 'Ce joueur est déjà dans un salon.' });
        let r = byUser.has(userId) ? rooms.get(byUser.get(userId)) : null;
        if (r && (r.host !== userId || r.type !== type)) return reply(ack, { error: 'Quittez d’abord votre salon actuel.' });
        if (r && r.members.length + r.invited.size >= MAX_MEMBERS) return reply(ack, { error: 'Le salon est complet.' });
        if (!r && rooms.size >= MAX_ROOMS) return reply(ack, { error: 'Trop de salons ouverts. Réessayez plus tard.' });
        const [a, b] = await Promise.all([db.findUserById(userId), db.findUserById(tid)]);
        if (!b) return reply(ack, { error: 'Joueur introuvable.' });
        if ((a?.blockedUsers || []).map(String).includes(tid)) return reply(ack, { error: 'Vous avez bloqué ce joueur.' });
        if ((b.blockedUsers || []).map(String).includes(userId)) return reply(ack, { error: 'Action non autorisée.' });
        if (!r) {
          r = { id: newId(), type, host: userId, status: 'lobby', mode: null, members: [{ id: userId, username: me.username }], invited: new Map(), film: null, created: now(), touched: now() };
          rooms.set(r.id, r); byUser.set(userId, r.id);
        }
        if (type === 'cinema' && data?.film) { const f = cleanFilm(data.film); if (!f) { if (!r.film && r.members.length === 1 && !r.invited.size) close(r, 'bad'); return reply(ack, { error: 'Lien de film invalide (https requis).' }); } if (!r.film || r.film.url !== f.url) r.film = { ...f, t0: now() }; }
        if (type === 'cinema' && !r.film) return reply(ack, { error: 'Choisissez d’abord un film.' });
        r.touched = now(); r.invited.set(tid, now());
        if (!(await isMuted(tid, userId))) toUser(tid, 'party:invited', { id: r.id, type, from: { id: userId, username: me.username }, film: r.film ? { title: r.film.title } : null });
        sendLobby(r); reply(ack, { ok: true, id: r.id });
      } catch (err) { console.warn('[JexCity] party:invite', err.message); reply(ack, { error: 'Erreur.' }); }
    });

    socket.on('party:accept', (data, ack) => {
      const r = rooms.get(String(data?.id || ''));
      if (!r || !r.invited.has(userId)) return reply(ack, { error: 'Invitation expirée.' });
      if (byUser.has(userId) && byUser.get(userId) !== r.id) return reply(ack, { error: 'Vous êtes déjà dans un salon.' });
      if (r.members.length >= MAX_MEMBERS) return reply(ack, { error: 'Le salon est complet.' });
      const e = presence.present.get(userId); r.invited.delete(userId);
      r.members.push({ id: userId, username: e?.username || 'Joueur' }); byUser.set(userId, r.id); r.touched = now();
      sendLobby(r); reply(ack, { ok: true, lobby: lobby(r) });
    });
    socket.on('party:decline', (data) => {
      const r = rooms.get(String(data?.id || '')); if (!r || !r.invited.delete(userId)) return;
      toUser(r.host, 'party:declined', { id: r.id, by: presence.present.get(userId)?.username || 'Joueur' }); sendLobby(r);
    });

    socket.on('party:start', (data, ack) => {
      const r = roomOf(userId, String(data?.id || ''));
      if (!r || r.host !== userId || r.type !== 'arena' || !MODES.has(data?.mode)) return reply(ack, { error: 'Impossible de démarrer.' });
      if (!rl('start', 6, 10000)) return reply(ack, { error: 'Trop rapide.' });
      r.status = 'playing'; r.mode = data.mode; r.touched = now(); r.seed = (Math.random() * 1e9) | 0;
      const players = r.members.map((m, i) => ({ id: m.id, username: m.username, seat: i }));
      for (const m of r.members) toUser(m.id, 'party:start', { id: r.id, mode: r.mode, seed: r.seed, players });
      reply(ack, { ok: true });
    });
    socket.on('party:end', (data) => {
      const r = roomOf(userId, String(data?.id || '')); if (!r || r.host !== userId || r.type !== 'arena') return;
      r.status = 'lobby'; r.touched = now(); sendLobby(r);
    });
    socket.on('party:film', (data, ack) => {
      const r = roomOf(userId, String(data?.id || '')); const f = cleanFilm(data);
      if (!r || r.host !== userId || r.type !== 'cinema' || !f) return reply(ack, { error: 'Lien de film invalide (https requis).' });
      if (!rl('film', 5, 30000)) return reply(ack, { error: 'Trop rapide.' });
      r.film = { ...f, t0: now() }; r.touched = now(); sendLobby(r);
      for (const m of r.members) toUser(m.id, 'party:film', { id: r.id, film: { url: f.url, title: f.title, elapsed: 0 } });
      reply(ack, { ok: true });
    });

    // Relais : 'in' (invité → hôte : touche) et 'snap' (hôte → invités : état de la partie). Débit et taille bornés.
    socket.on('party:relay', (data) => {
      if (!rl('relay', 60, 1000)) return;
      const r = roomOf(userId, String(data?.id || '')); if (!r || r.status !== 'playing') return;
      const k = data?.k; if (k !== 'in' && k !== 'snap') return;
      let raw; try { raw = JSON.stringify(data.d); } catch (_) { return; } if (!raw || raw.length > MAX_MSG) return;
      r.touched = now();
      if (k === 'in') { if (r.host === userId) return; toUser(r.host, 'party:relay', { id: r.id, k, from: userId, d: data.d }); }
      else { if (r.host !== userId) return; for (const m of r.members) if (m.id !== userId) toUser(m.id, 'party:relay', { id: r.id, k, d: data.d }); }
    });

    socket.on('party:leave', () => leaveRoom(userId));
    socket.on('city:leave', () => leaveRoom(userId));
    socket.on('disconnect', () => { if (!io.sockets.adapter.rooms.get(`user:${userId}`)?.size) leaveRoom(userId); });
  }

  function sweep() {
    const t = now();
    for (const r of [...rooms.values()]) {
      let changed = false;
      for (const [id, at] of r.invited) if (t - at > PENDING_MS) { r.invited.delete(id); changed = true; }
      if (changed) sendLobby(r);
      if (t - r.touched > IDLE_MS) close(r, 'idle');
    }
  }
  function onBlockChange(a, b) { for (const r of [...rooms.values()]) if (r.members.some((m) => m.id === a) && r.members.some((m) => m.id === b)) close(r, 'blocked'); }
  return { attach, sweep, onBlockChange, rooms, byUser, _lobby: lobby };
}

module.exports = { createParty, cleanFilm, MODES };
