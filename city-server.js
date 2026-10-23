'use strict';
// city-server.js — Module serveur JexCity (additif, n'altère aucune route JexChat).
//
// Branchement dans server.js (2 lignes) :
//   const jexcity = require('./city-server.js');
//   jexcity.mountStatic(app);                       // avant app.use(sec.apiLimiter)
//   jexcity.mountApi({ app, io, db, sec, sendPushNotification });   // après les routes existantes
//
// Principes :
//  • Même origine que JexChat (/city) : le cookie de session HttpOnly existant est utilisé tel quel,
//    aucun jeton dans une URL.
//  • Aucun compte, message ou publication dupliqué : JexCity lit les routes JexChat existantes.
//  • Présence en mémoire uniquement (jamais écrite en base). Positions diffusées uniquement aux
//    utilisateurs présents dans la ville, jamais à travers un blocage, jamais pour les comptes
//    qui masquent leur statut en ligne.
//  • Seule donnée persistante ajoutée : la sourdine (CityMute), référençant des utilisateurs existants.

const path = require('path');
const mongoose = require('mongoose');

const CITY_DIR = __dirname;
const ZONE = 'main';
const BOUNDS = { x0: -420, x1: 420, z0: -460, z1: 152 }; // identique à WORLD dans city-geo.js (ville + collines et routes alentour)
const MAX_PRESENCE = 60;                // avatars simultanés dans la zone
const STALE_MS = 90 * 1000;             // sans signe de vie → retiré
const INVITE = { perTargetMs: 30 * 60 * 1000, perUserMax: 5, perUserWindowMs: 10 * 60 * 1000 };

// ─── Utilitaires purs (testés) ────────────────────────────────────────────────
function cleanMood(v) {
  if (typeof v !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return v.replace(/[\u0000-\u001F\u007F<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);
}
function clampNum(v, min, max) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : null;
}
function safeColor(c) { return typeof c === 'string' && /^#[0-9a-f]{3,8}$/i.test(c) ? c : ''; }

// Apparence : uniquement des indices validés (la palette est définie côté client) → rien d'arbitraire n'est stocké ni diffusé.
const LOOK_MAX = { s: 1, h: 7, hc: 7, sk: 7, ac: 5, tc: 8, pc: 6, sc: 5, ey: 4, bd: 3 };
const DEFAULT_LOOK = { s: 0, h: 0, hc: 0, sk: 3, ac: 0, tc: 0, pc: 0, sc: 0, ey: 0, bd: 0 };
function cleanLook(v) {
  const out = { ...DEFAULT_LOOK };
  if (!v || typeof v !== 'object') return out;
  for (const k of Object.keys(LOOK_MAX)) { const n = Number(v[k]); if (Number.isInteger(n) && n >= 0 && n <= LOOK_MAX[k]) out[k] = n; }
  return out;
}
let _CityLook = null;
function getLookModel() {
  if (_CityLook) return _CityLook;
  const schema = new mongoose.Schema({ userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true }, look: { type: Object, default: DEFAULT_LOOK }, updatedAt: { type: Date, default: Date.now } });
  _CityLook = mongoose.models.CityLook || mongoose.model('CityLook', schema);
  return _CityLook;
}
async function loadLook(userId) { try { const r = await getLookModel().findOne({ userId }).select('look').lean(); return cleanLook(r?.look); } catch (_) { return { ...DEFAULT_LOOK }; } }

// ─── Modèle de sourdine ───────────────────────────────────────────────────────
let _CityMute = null;
function getMuteModel() {
  if (_CityMute) return _CityMute;
  const schema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    mutedId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    createdAt: { type: Date, default: Date.now },
  });
  schema.index({ userId: 1, mutedId: 1 }, { unique: true });
  _CityMute = mongoose.models.CityMute || mongoose.model('CityMute', schema);
  return _CityMute;
}

// ─── Fichiers statiques ───────────────────────────────────────────────────────
// Tous les fichiers JexCity sont à la racine du projet. Liste blanche explicite : on ne sert JAMAIS
// la racine entière (server.js, database.js, .env… resteraient exposés).
const CITY_FILES = ['city.css', 'city-main.js', 'city-api.js', 'city-social.js', 'city-posts.js', 'city-ui.js',
  'city-geo.js', 'city-textures.js', 'city-world.js', 'city-controls.js', 'city-avatar.js', 'city-media.js', 'city-games.js', 'city-look.js', 'city-solo.js', 'city-models.js', 'city-modern.js', 'city-walk.js', 'city-props.js', 'city-arena.js', 'city-venues.js'];

// Three.js r160 (MIT) servi localement depuis la racine : plus de dépendance à un CDN. Liste blanche, version figée.
const VENDOR_FILES = ['three.module.min.js', 'GLTFLoader.js', 'BufferGeometryUtils.js'];
// Ressources 3D locales de JexCity (modèles GLB, textures) : noms simples uniquement, pas de sous-dossier.
const ASSET_RE = /^[a-z0-9_-]+\.(glb|jpg|png|webp)$/i;

// Compression gzip/brotli faite ici, en mémoire, pour les seuls fichiers JexCity (aucune dépendance ajoutée,
// aucun changement dans server.js). Recalculée automatiquement si le fichier change sur le disque.
const zlib = require('zlib');
const crypto = require('crypto');
const fsp = require('fs').promises;
const { promisify } = require('util');
const gzipAsync = promisify(zlib.gzip), brotliAsync = promisify(zlib.brotliCompress);
const MIME = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8' };
const _packed = new Map();

function packed(file) { // → Promise<{ raw, gz, br, etag, type }>
  const full = path.join(CITY_DIR, file);
  return fsp.stat(full).then((st) => {
    const key = st.mtimeMs + ':' + st.size, hit = _packed.get(file);
    if (hit && hit.key === key) return hit.p;
    const p = (async () => {
      const raw = await fsp.readFile(full);
      const [gz, br] = await Promise.all([
        gzipAsync(raw, { level: 9 }),
        brotliAsync(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: raw.length } }),
      ]);
      return { raw, gz, br, etag: crypto.createHash('sha1').update(raw).digest('base64url').slice(0, 20), type: MIME[path.extname(file)] || 'application/octet-stream' };
    })();
    _packed.set(file, { key, p });
    p.catch(() => { if (_packed.get(file) && _packed.get(file).p === p) _packed.delete(file); });
    return p;
  });
}
const etagMatches = (header, etag) => typeof header === 'string' && header.split(',').some((t) => t.trim().replace(/^W\//, '') === etag);

// Envoie un fichier compressé (br > gzip > brut) avec ETag ; en cas de problème, retombe sur l'envoi classique.
function sendPacked(req, res, file, cacheControl) {
  packed(file).then((e) => {
    const ae = String(req.headers['accept-encoding'] || '');
    const enc = /\bbr\b/.test(ae) ? 'br' : /\bgzip\b/.test(ae) ? 'gzip' : '';
    const body = enc === 'br' ? e.br : enc === 'gzip' ? e.gz : e.raw;
    const etag = '"' + e.etag + (enc ? '-' + enc : '') + '"';
    res.setHeader('Vary', 'Accept-Encoding');
    res.setHeader('Cache-Control', cacheControl);
    res.setHeader('ETag', etag);
    if (etagMatches(req.headers['if-none-match'], etag)) return res.status(304).end();
    res.setHeader('Content-Type', e.type);
    if (enc) res.setHeader('Content-Encoding', enc);
    res.setHeader('Content-Length', body.length);
    res.end(body);
  }).catch(() => {
    if (res.headersSent) return;
    res.setHeader('Cache-Control', cacheControl);
    res.sendFile(path.join(CITY_DIR, file), (err) => { if (err && !res.headersSent) res.status(404).end(); });
  });
}

function mountStatic(app) {
  const REVALIDATE = 'no-cache';                 // fichiers JexCity : ETag → 304 très légère, jamais de version périmée
  const VENDOR_CACHE = 'public, max-age=604800'; // Three.js r160 (version figée) : 7 jours
  for (const f of VENDOR_FILES) {
    app.get('/' + f, (req, res) => sendPacked(req, res, f, VENDOR_CACHE));
  }
  // Modèles 3D : fichiers à la racine du projet (pas de sous-dossier), liste blanche stricte.
  const CITY_MODELS = ['arbre.glb', 'herbe.webp', 'bois.jpg', 'station.glb'];
  app.get('/city-assets/:name', (req, res) => {
    if (!ASSET_RE.test(req.params.name) || !CITY_MODELS.includes(req.params.name)) return res.status(404).end();
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(path.join(CITY_DIR, req.params.name), (err) => { if (err && !res.headersSent) res.status(404).end(); });
  });
  // CSP propre à la page JexCity uniquement (JexChat inchangé) : three.js/GLTFLoader décodent les textures intégrées aux
  // fichiers .glb via des URL « blob: ». Sans cette autorisation, arbres, station et voiture restaient BLANCS.
  // Décor Kenney (camions, moto, arbres de bord de route, pièces) et voiture réaliste : fichiers à la racine, liste blanche.
  for (const f of ['city-props.glb', 'city-car.glb']) {
    app.get('/' + f, (req, res) => { res.setHeader('Cache-Control', 'public, max-age=86400'); res.sendFile(path.join(CITY_DIR, f), (err) => { if (err && !res.headersSent) res.status(404).end(); }); });
  }
  const page = (req, res) => {
    const csp = res.getHeader('Content-Security-Policy');
    if (typeof csp === 'string') {
      res.setHeader('Content-Security-Policy', csp
        .replace(/(img-src [^;]*)/, (m) => (/\bblob:/.test(m) ? m : m + ' blob:'))
        .replace(/(connect-src [^;]*)/, (m) => (/\bblob:/.test(m) ? m : m + ' blob:')));
    }
    sendPacked(req, res, 'city.html', REVALIDATE);
  };
  app.get('/city', page);
  app.get('/city/', page);
  for (const f of CITY_FILES) {
    app.get('/' + f, (req, res) => sendPacked(req, res, f, REVALIDATE));
  }
  // Préparation au démarrage du serveur : le premier visiteur n'attend pas la compression.
  setImmediate(() => { for (const f of ['city.html', 'three.module.min.js', ...CITY_FILES]) packed(f).catch(() => {}); });
}

// ─── Présence (en mémoire) ────────────────────────────────────────────────────
function createPresence({ io, db, sec, now = () => Date.now() }) {
  const present = new Map(); // userId -> entrée

  const canSee = (viewer, target) =>
    viewer.userId !== target.userId && !target.hidden &&
    !viewer.hide.has(target.userId) && !target.hide.has(viewer.userId);

  const view = (e) => ({
    id: e.userId, username: e.username, identity: e.identity, avatarUrl: e.avatarUrl,
    x: e.x, z: e.z, tx: e.tx, tz: e.tz, mood: e.mood, look: e.look,
  });
  const toUser = (id, ev, payload) => io.to(`user:${id}`).emit(ev, payload);

  function peersOf(entry) { return [...present.values()].filter((o) => canSee(o, entry)); }

  async function loadHide(userDoc, userId) {
    const hide = new Set((userDoc?.blockedUsers || []).map(String));
    try {
      const rows = await db.User.find({ blockedUsers: userId }).select('_id').lean();
      for (const r of rows || []) hide.add(String(r._id));
    } catch (_) { /* échec non fatal : on garde au moins mes propres blocages */ }
    return hide;
  }

  function remove(userId) {
    const e = present.get(userId);
    if (!e) return;
    present.delete(userId);
    if (!e.hidden) for (const o of present.values()) if (!o.hide.has(userId) && !e.hide.has(o.userId)) toUser(o.userId, 'city:left', { id: userId });
  }

  function attach(socket) {
    const userId = socket.userId;
    const rl = (action, max, ms) => sec.socketRateLimit(socket.id, `city:${action}`, max, ms);

    socket.on('city:join', async (data, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      try {
        if (!rl('join', 6, 15000)) return reply({ error: 'Trop de tentatives.' });
        let e = present.get(userId);
        if (!e && present.size >= MAX_PRESENCE) return reply({ error: 'La ville est pleine pour le moment.' });
        const u = socket.user || {};
        const [hide, look] = await Promise.all([loadHide(u, userId), loadLook(userId)]);
        const x = clampNum(data?.x, BOUNDS.x0, BOUNDS.x1) ?? 0, z = clampNum(data?.z, BOUNDS.z0, BOUNDS.z1) ?? 0;
        if (!e) {
          e = { userId, sockets: new Set(), x, z, tx: x, tz: z, mood: '' };
          present.set(userId, e);
        }
        Object.assign(e, {
          username: socket.username || u.username || 'Anonyme',
          identity: { colorA: safeColor(u.identity?.colorA), colorB: safeColor(u.identity?.colorB) },
          avatarUrl: typeof u.avatarUrl === 'string' && u.avatarUrl.startsWith('https://') ? u.avatarUrl : '',
          hidden: u.settings?.privacy?.showOnlineStatus === false, // « ghost » : on voit mais on n'est pas vu
          hide, look, seen: now(),
        });
        if (data?.mood !== undefined) e.mood = cleanMood(data.mood);
        e.sockets.add(socket.id);
        socket.cityJoined = true;
        const others = [...present.values()].filter((o) => canSee(e, o)).map(view);
        for (const o of peersOf(e)) toUser(o.userId, 'city:appear', view(e));
        reply({ ok: true, self: view(e), others, hidden: e.hidden });
      } catch (err) {
        console.warn('[JexCity] join:', err.message);
        reply({ error: 'Erreur.' });
      }
    });

    socket.on('city:move', (data) => {
      const e = present.get(userId);
      if (!e || !socket.cityJoined || !rl('move', 12, 5000)) return;
      const x = clampNum(data?.x, BOUNDS.x0, BOUNDS.x1), z = clampNum(data?.z, BOUNDS.z0, BOUNDS.z1);
      const tx = clampNum(data?.tx, BOUNDS.x0, BOUNDS.x1), tz = clampNum(data?.tz, BOUNDS.z0, BOUNDS.z1);
      if (x === null || z === null || tx === null || tz === null) return;
      Object.assign(e, { x, z, tx, tz, seen: now() });
      for (const o of peersOf(e)) toUser(o.userId, 'city:moved', { id: userId, x, z, tx, tz });
    });

    socket.on('city:mood', (data) => {
      const e = present.get(userId);
      if (!e || !socket.cityJoined || !rl('mood', 6, 60000)) return;
      e.mood = cleanMood(data?.mood); e.seen = now();
      for (const o of peersOf(e)) toUser(o.userId, 'city:mood', { id: userId, mood: e.mood });
    });

    socket.on('city:ping', () => { const e = present.get(userId); if (e && rl('ping', 6, 60000)) e.seen = now(); });

    const leave = () => {
      const e = present.get(userId);
      if (!e) return;
      e.sockets.delete(socket.id);
      socket.cityJoined = false;
      if (e.sockets.size === 0) remove(userId);
    };
    socket.on('city:leave', leave);
    socket.on('disconnect', leave);
  }

  // Blocage / déblocage en cours de session : on recalcule les listes de masquage des deux personnes présentes,
  // puis on n'envoie que les différences (disparition ou réapparition). Aucune relation n'est créée ni restaurée ici.
  async function refreshPair(a, b) {
    const ea = present.get(a), eb = present.get(b);
    if (!ea && !eb) return;
    const was = ea && eb ? [canSee(ea, eb), canSee(eb, ea)] : null;
    for (const [id, e] of [[a, ea], [b, eb]]) if (e) { const u = await db.findUserById(id); e.hide = await loadHide(u, id); }
    if (!was) return;
    const now2 = [canSee(ea, eb), canSee(eb, ea)];
    if (was[0] && !now2[0]) toUser(a, 'city:left', { id: b }); else if (!was[0] && now2[0]) toUser(a, 'city:appear', view(eb));
    if (was[1] && !now2[1]) toUser(b, 'city:left', { id: a }); else if (!was[1] && now2[1]) toUser(b, 'city:appear', view(ea));
  }

  function sweep() {
    const t = now();
    for (const [id, e] of present) if (t - e.seen > STALE_MS) remove(id);
  }

  return { attach, sweep, present, remove, canSee, refreshPair, view };
}

// ─── Mini-jeux (en mémoire uniquement : rien n'est écrit en base) ──────────────────
// Le serveur fait autorité : tour de jeu, cases libres, victoire et nul sont calculés ici ; le client ne fait qu'afficher.
const WIN_LINES = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
function tttResult(board) {
  for (const l of WIN_LINES) { const [a, b, c] = l; if (board[a] && board[a] === board[b] && board[a] === board[c]) return { winner: board[a], line: l }; }
  return board.every(Boolean) ? { draw: true } : null;
}
function cleanChat(v) {
  if (typeof v !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return v.replace(/[\u0000-\u001F\u007F<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 200);
}
// Réglages des jeux d'action (course, tir) : arène 300×200, positions annoncées par chaque client puis bornées par le serveur.
const ARENA = { w: 300, h: 200 }, RACE = { minLapMs: 5000, laps: 2, maxSpeed: 110 }, SHOOT = { hp: 3, range: 260, radius: 12, cooldown: 350, respawn: 2000, winScore: 5, durMs: 60000, maxSpeed: 95 };
const GAMES = new Set(['ttt', 'race', 'shoot']);
function createGames({ io, db, sec, presence, isMuted, now = () => Date.now() }) {
  const rooms = new Map();   // id -> salle
  const inGame = new Map();  // userId -> id de salle (une partie à la fois)
  const PENDING_MS = 60 * 1000, IDLE_MS = 5 * 60 * 1000, MAX_ROOMS = 100, CHAT_KEEP = 40;
  const toUser = (id, ev, payload) => io.to(`user:${id}`).emit(ev, payload);
  let seq = 0;
  const newId = () => `g${now().toString(36)}${(++seq).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  const publicState = (r) => ({
    id: r.id, game: r.game, status: r.status,
    players: r.players.map((p, i) => ({ id: p.id, username: p.username, sym: i === 0 ? 'X' : 'O' })),
    board: r.board, turn: r.turnIdx != null ? r.players[r.turnIdx].id : null,
    winner: r.winner || null, line: r.line || null, draw: !!r.draw, rematch: [...r.rematch],
    ...(r.game === 'ttt' ? {} : {
      startIn: Math.max(0, (r.startAt || 0) - now()), endIn: r.endAt ? Math.max(0, r.endAt - now()) : null,
      ps: r.players.map((p) => { const a = r.act[p.id]; return { id: p.id, x: a.x, y: a.y, p: a.p, fin: a.fin, hp: a.hp, score: a.score, dead: a.respawnAt > now() }; }),
    }),
  });
  const broadcast = (r, ev = 'game:state') => { for (const p of r.players) toUser(p.id, ev, ev === 'game:state' ? publicState(r) : ev); };
  function close(r, reason) {
    if (!rooms.delete(r.id)) return;
    r.timers?.forEach(clearTimeout);
    for (const p of r.players) { if (inGame.get(p.id) === r.id) inGame.delete(p.id); toUser(p.id, 'game:closed', { id: r.id, reason }); }
  }
  function startAction(r) {
    const t = now(); r.startAt = t + 3000; r.timers?.forEach(clearTimeout); r.timers = [];
    r.act = {}; r.players.forEach((p, i) => { r.act[p.id] = { x: r.game === 'race' ? 40 : (i ? 220 : 80), y: r.game === 'race' ? 88 + 24 * i : 100, p: 0, fin: null, hp: SHOOT.hp, score: 0, respawnAt: 0, last: t, lastShot: 0 }; });
    r.status = 'playing'; r.winner = null; r.draw = false; r.rematch = new Set();
    r.endAt = r.startAt + (r.game === 'shoot' ? SHOOT.durMs : 120000);
    r.timers.push(setTimeout(() => finishAction(r), r.endAt - t + 50));
  }
  function finishAction(r) {
    if (!rooms.has(r.id) || r.status !== 'playing') return;
    const [a, b] = r.players.map((p) => r.act[p.id]);
    if (r.game === 'shoot') { if (a.score === b.score) r.draw = true; else r.winner = (a.score > b.score ? r.players[0] : r.players[1]).id; }
    else { const fa = a.fin, fb = b.fin; if (fa == null && fb == null) r.draw = true; else r.winner = (fb == null || (fa != null && fa <= fb) ? r.players[0] : r.players[1]).id; }
    r.status = 'over'; r.timers?.forEach(clearTimeout); broadcast(r);
  }
  const roomOf = (userId, id) => { const r = rooms.get(id); return r && r.players.some((p) => p.id === userId) ? r : null; };

  function attach(socket) {
    const userId = socket.userId;
    const rl = (a, max, ms) => sec.socketRateLimit(socket.id, `game:${a}`, max, ms);
    const reply = (ack, v) => { if (typeof ack === 'function') ack(v); };

    socket.on('game:invite', async (data, ack) => {
      try {
        if (!rl('invite', 6, 60000)) return reply(ack, { error: 'Trop d’invitations. Patientez un instant.' });
        const tid = String(data?.to || ''), game = data?.game;
        if (!GAMES.has(game)) return reply(ack, { error: 'Jeu indisponible.' });
        if (!sec.isValidObjectId(tid) || tid === userId) return reply(ack, { error: 'Joueur invalide.' });
        const me = presence.present.get(userId), other = presence.present.get(tid);
        if (!me || !other || !socket.cityJoined) return reply(ack, { error: 'Ce joueur n’est pas dans la ville.' });
        if (inGame.has(userId)) return reply(ack, { error: 'Vous avez déjà une partie en cours.' });
        if (inGame.has(tid)) return reply(ack, { error: 'Ce joueur est déjà en partie.' });
        if (rooms.size >= MAX_ROOMS) return reply(ack, { error: 'Trop de parties en cours. Réessayez plus tard.' });
        const [a, b] = await Promise.all([db.findUserById(userId), db.findUserById(tid)]);
        if (!b) return reply(ack, { error: 'Joueur introuvable.' });
        if ((a?.blockedUsers || []).map(String).includes(tid)) return reply(ack, { error: 'Vous avez bloqué ce joueur.' });
        if ((b.blockedUsers || []).map(String).includes(userId)) return reply(ack, { error: 'Action non autorisée.' });
        const r = { id: newId(), game, status: 'pending', players: [{ id: userId, username: me.username }, { id: tid, username: other.username }], board: Array(9).fill(''), turnIdx: null, rematch: new Set(), chat: [], created: now(), touched: now() };
        inGame.set(userId, r.id); rooms.set(r.id, r);
        // Joueur en sourdine pour l'invité : succès apparent, mais l'invitation n'est pas livrée (la sourdine n'est pas révélée).
        if (!(await isMuted(tid, userId))) toUser(tid, 'game:invited', { id: r.id, game, from: { id: userId, username: me.username } });
        reply(ack, { ok: true, id: r.id });
      } catch (err) { console.warn('[JexCity] game:invite', err.message); reply(ack, { error: 'Erreur.' }); }
    });

    socket.on('game:accept', (data, ack) => {
      const r = rooms.get(String(data?.id || ''));
      if (!r || r.status !== 'pending' || r.players[1].id !== userId) return reply(ack, { error: 'Invitation expirée.' });
      if (inGame.has(userId) && inGame.get(userId) !== r.id) return reply(ack, { error: 'Vous avez déjà une partie en cours.' });
      inGame.set(userId, r.id); r.touched = now();
      if (r.game === 'ttt') { r.status = 'playing'; r.turnIdx = Math.random() < 0.5 ? 0 : 1; } else startAction(r);
      broadcast(r); reply(ack, { ok: true });
    });
    socket.on('game:decline', (data) => {
      const r = rooms.get(String(data?.id || ''));
      if (r && r.status === 'pending' && r.players[1].id === userId) close(r, 'declined');
    });

    socket.on('game:move', (data, ack) => {
      if (!rl('move', 20, 10000)) return reply(ack, { error: 'Trop rapide.' });
      const r = roomOf(userId, String(data?.id || ''));
      const cell = Number(data?.cell);
      if (!r || r.game !== 'ttt' || r.status !== 'playing' || !Number.isInteger(cell) || cell < 0 || cell > 8) return reply(ack, { error: 'Coup invalide.' });
      if (r.players[r.turnIdx].id !== userId) return reply(ack, { error: 'Ce n’est pas votre tour.' });
      if (r.board[cell]) return reply(ack, { error: 'Case déjà prise.' });
      r.board[cell] = r.turnIdx === 0 ? 'X' : 'O'; r.touched = now();
      const res = tttResult(r.board);
      if (res?.winner) { r.status = 'over'; r.winner = r.players[r.board[res.line[0]] === 'X' ? 0 : 1].id; r.line = res.line; r.turnIdx = null; }
      else if (res?.draw) { r.status = 'over'; r.draw = true; r.turnIdx = null; }
      else r.turnIdx = 1 - r.turnIdx;
      broadcast(r); reply(ack, { ok: true });
    });

    socket.on('game:rematch', (data) => {
      if (!rl('rematch', 10, 30000)) return;
      const r = roomOf(userId, String(data?.id || ''));
      if (!r || r.status !== 'over') return;
      r.rematch.add(userId); r.touched = now();
      if (r.rematch.size === 2 && r.game !== 'ttt') { startAction(r); return broadcast(r); }
      if (r.rematch.size === 2) { r.board = Array(9).fill(''); r.winner = null; r.line = null; r.draw = false; r.rematch = new Set(); r.players.reverse(); r.status = 'playing'; r.turnIdx = 0; }
      broadcast(r);
    });

    socket.on('game:chat', (data, ack) => {
      if (!rl('chat', 8, 10000)) return reply(ack, { error: 'Trop de messages. Patientez un instant.' });
      const r = roomOf(userId, String(data?.id || ''));
      const text = cleanChat(data?.text);
      if (!r || !text) return reply(ack, { error: 'Message vide.' });
      const msg = { from: userId, username: r.players.find((p) => p.id === userId).username, text, t: now() };
      r.chat.push(msg); if (r.chat.length > CHAT_KEEP) r.chat.shift(); r.touched = now();
      for (const p of r.players) toUser(p.id, 'game:chat', { id: r.id, msg });
      reply(ack, { ok: true });
    });

    // Position annoncée par le client (≈ 10/s) : bornée à l'arène et à la vitesse maximale, puis relayée à l'adversaire seulement.
    socket.on('game:pos', (data) => {
      if (!rl('pos', 14, 1000)) return;
      const r = roomOf(userId, String(data?.id || '')); if (!r || r.game === 'ttt' || r.status !== 'playing') return;
      const a = r.act[userId], t = now(); if (t < r.startAt) return;
      const x = Number(data.x), y = Number(data.y); if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      const dt = Math.max(0.05, (t - a.last) / 1000), vmax = (r.game === 'race' ? RACE.maxSpeed : SHOOT.maxSpeed) * 1.6;
      if (a.respawnAt > t) return;
      const nx = Math.min(ARENA.w, Math.max(0, x)), ny = Math.min(ARENA.h, Math.max(0, y));
      if (Math.hypot(nx - a.x, ny - a.y) > vmax * dt + 6) { toUser(userId, 'game:fix', { id: r.id, x: a.x, y: a.y }); a.last = t; return; } // trop loin : recalé
      a.x = nx; a.y = ny; a.last = t;
      if (r.game === 'race') {
        const p = Number(data.p), el = (t - r.startAt) / RACE.minLapMs / RACE.laps; // progression plausible au plus vite
        if (Number.isFinite(p) && p > a.p && p <= el + 0.03) a.p = Math.min(1, p);
        if (a.p >= 1 && a.fin == null) { a.fin = t - r.startAt; if (r.players.every((q) => r.act[q.id].fin != null)) return finishAction(r); r.timers.push(setTimeout(() => finishAction(r), 15000)); broadcast(r); return; }
      }
      const o = r.players.find((q) => q.id !== userId); toUser(o.id, 'game:peer', { id: r.id, from: userId, x: a.x, y: a.y, p: a.p });
    });
    socket.on('game:shoot', (data, ack) => {
      if (!rl('shoot', 6, 1000)) return;
      const r = roomOf(userId, String(data?.id || '')); if (!r || r.game !== 'shoot' || r.status !== 'playing') return;
      const t = now(), a = r.act[userId], ang = Number(data?.a); if (t < r.startAt || !Number.isFinite(ang) || a.respawnAt > t || t - a.lastShot < SHOOT.cooldown) return;
      a.lastShot = t; const o = r.players.find((q) => q.id !== userId), b = r.act[o.id];
      const dx = Math.cos(ang), dy = Math.sin(ang), rx = b.x - a.x, ry = b.y - a.y, along = rx * dx + ry * dy, perp = Math.abs(rx * dy - ry * dx);
      const hit = b.respawnAt <= t && along > 0 && along < SHOOT.range && perp < SHOOT.radius;
      for (const q of r.players) toUser(q.id, 'game:shot', { id: r.id, from: userId, a: ang, hit });
      if (!hit) return;
      b.hp--; if (b.hp <= 0) { a.score++; b.hp = SHOOT.hp; b.respawnAt = t + SHOOT.respawn; b.x = Math.random() * (ARENA.w - 40) + 20; b.y = Math.random() * (ARENA.h - 40) + 20; b.last = t + SHOOT.respawn; }
      if (a.score >= SHOOT.winScore) return finishAction(r);
      broadcast(r);
    });
    socket.on('game:sync', (data, ack) => {
      const r = roomOf(userId, String(data?.id || '')); if (!r) return reply(ack, { error: 'Partie terminée.' });
      reply(ack, { state: publicState(r), chat: r.chat });
    });
    socket.on('game:leave', (data) => { const r = roomOf(userId, String(data?.id || '')); if (r) close(r, 'left'); });
    socket.on('disconnect', () => { const id = inGame.get(userId); const r = id && rooms.get(id); if (r && !io.sockets.adapter.rooms.get(`user:${userId}`)?.size) close(r, 'left'); });
    socket.on('city:leave', () => { const id = inGame.get(userId); const r = id && rooms.get(id); if (r) close(r, 'left'); });
  }

  function sweep() {
    const t = now();
    for (const r of [...rooms.values()]) {
      if (r.status === 'pending' && t - r.created > PENDING_MS) close(r, 'expired');
      else if (t - r.touched > IDLE_MS) close(r, 'idle');
    }
  }
  function onBlockChange(a, b) { for (const r of [...rooms.values()]) if (r.players.some((p) => p.id === a) && r.players.some((p) => p.id === b)) close(r, 'blocked'); }
  return { attach, sweep, onBlockChange, rooms, inGame, _publicState: publicState };
}

// ─── API HTTP ─────────────────────────────────────────────────────────────────
function mountApi({ app, io, db, sec, sendPushNotification, now = () => Date.now() }) {
  const inviteLast = new Map(); // "de:vers" -> horodatage
  const MuteModel = () => getMuteModel();

  const presence = createPresence({ io, db, sec, now });
  const games = createGames({ io, db, sec, presence, isMuted: (o, u) => isMuted(o, u), now });
  io.on('connection', (socket) => { if (socket.userId) { presence.attach(socket); games.attach(socket); } });
  const timers = [
    setInterval(presence.sweep, 30 * 1000),
    setInterval(games.sweep, 15 * 1000),
    setInterval(() => { const t = now(); for (const [k, v] of inviteLast) if (t - v > INVITE.perTargetMs) inviteLast.delete(k); }, 10 * 60 * 1000),
  ];
  timers.forEach((t) => t.unref && t.unref());

  const isMuted = async (ownerId, otherId) => {
    try { return !!(await MuteModel().exists({ userId: ownerId, mutedId: otherId })); } catch (_) { return false; }
  };

  app.get('/api/city/config', sec.requireAuth, async (req, res) => {
    try {
      const rows = await MuteModel().find({ userId: req.user._id }).select('mutedId').lean();
      return res.json({ zone: ZONE, bounds: BOUNDS, maxAvatars: MAX_PRESENCE, muted: rows.map((r) => String(r.mutedId)), look: await loadLook(req.user._id) });
    } catch (_) {
      return res.json({ zone: ZONE, bounds: BOUNDS, maxAvatars: MAX_PRESENCE, muted: [], look: { ...DEFAULT_LOOK } });
    }
  });

  // Recherche d'utilisateurs : mêmes résultats que JexChat, sans les personnes que j'ai bloquées ni celles qui m'ont bloqué.
  app.get('/api/city/search', sec.requireAuth, sec.searchLimiter, async (req, res) => {
    try {
      const q = sec.sanitizeText(String(req.query.q || '')).trim().slice(0, 32);
      if (!q) return res.json([]);
      const meId = req.user._id.toString();
      const [rows, me] = await Promise.all([db.searchUsers(q, 30), db.findUserById(meId)]);
      const mine = new Set((me?.blockedUsers || []).map(String));
      const ids = rows.map((r) => r._id).filter((id) => !mine.has(String(id)) && String(id) !== meId);
      const blockers = new Set((await db.User.find({ _id: { $in: ids }, blockedUsers: req.user._id }).select('_id').lean()).map((r) => String(r._id)));
      return res.json(rows.filter((r) => ids.includes(r._id) && !blockers.has(String(r._id))).slice(0, 20)
        .map((r) => ({ id: String(r._id), username: r.username, identity: r.identity, isOnline: !!r.isOnline })));
    } catch (_) { return res.status(500).json({ error: 'Erreur.' }); }
  });

  // À appeler après un blocage ou un déblocage : met à jour la présence dans la ville sans attendre une reconnexion.
  app.post('/api/city/hide-refresh/:id', sec.requireAuth, async (req, res) => {
    try {
      if (!sec.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'ID invalide.' });
      if (!sec.rateLimit(`${req.user._id}:cityrefresh`, 20, 60000)) return res.status(429).json({ error: 'Trop de requêtes.' });
      await presence.refreshPair(req.user._id.toString(), req.params.id);
      games.onBlockChange(req.user._id.toString(), req.params.id);
      return res.json({ ok: true });
    } catch (_) { return res.status(500).json({ error: 'Erreur.' }); }
  });

  // Mon apparence (indices validés) : une seule petite ligne par utilisateur, diffusée aux personnes présentes.
  app.put('/api/city/look', sec.requireAuth, async (req, res) => {
    try {
      const meId = req.user._id.toString();
      if (!sec.rateLimit(`${meId}:citylook`, 20, 60000)) return res.status(429).json({ error: 'Trop de modifications.' });
      const look = cleanLook(req.body);
      await getLookModel().updateOne({ userId: req.user._id }, { $set: { look, updatedAt: new Date() } }, { upsert: true });
      const e = presence.present.get(meId);
      if (e) { e.look = look; for (const o of presence.present.values()) if (presence.canSee(o, e)) io.to(`user:${o.userId}`).emit('city:look', { id: meId, look }); }
      return res.json({ ok: true, look });
    } catch (_) { return res.status(500).json({ error: 'Erreur.' }); }
  });

  app.post('/api/city/mute/:id', sec.requireAuth, async (req, res) => {
    try {
      const id = req.params.id;
      if (!sec.isValidObjectId(id) || id === req.user._id.toString()) return res.status(400).json({ error: 'ID invalide.' });
      if (!(await db.findUserById(id))) return res.status(404).json({ error: 'Utilisateur introuvable.' });
      await MuteModel().updateOne({ userId: req.user._id, mutedId: id }, { $setOnInsert: { createdAt: new Date() } }, { upsert: true });
      return res.json({ ok: true });
    } catch (_) { return res.status(500).json({ error: 'Erreur.' }); }
  });

  app.delete('/api/city/mute/:id', sec.requireAuth, async (req, res) => {
    try {
      if (!sec.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'ID invalide.' });
      await MuteModel().deleteOne({ userId: req.user._id, mutedId: req.params.id });
      return res.json({ ok: true });
    } catch (_) { return res.status(500).json({ error: 'Erreur.' }); }
  });

  // Invitation à une conversation TEXTUELLE (aucun appel vocal). Jamais annoncée à la ville :
  // seule une notification privée est envoyée à la personne invitée.
  app.post('/api/city/invite', sec.requireAuth, async (req, res) => {
    try {
      const meId = req.user._id.toString();
      const tid = req.body?.userId;
      if (!sec.isValidObjectId(tid) || tid === meId) return res.status(400).json({ error: 'ID invalide.' });
      if (!sec.rateLimit(`${meId}:cityinvite`, INVITE.perUserMax, INVITE.perUserWindowMs)) {
        return res.status(429).json({ error: "Trop d'invitations. Réessayez dans quelques minutes." });
      }
      const [target, me] = await Promise.all([db.findUserById(tid), db.findUserById(meId)]);
      if (!target) return res.status(404).json({ error: 'Utilisateur introuvable.' });
      if (me.blockedUsers?.map(String).includes(tid)) return res.status(403).json({ error: 'Vous avez bloqué cet utilisateur.' });
      if (target.blockedUsers?.map(String).includes(meId)) return res.status(403).json({ error: 'Action non autorisée.' });

      const key = `${meId}:${tid}`, last = inviteLast.get(key);
      if (last && now() - last < INVITE.perTargetMs) {
        return res.status(429).json({ error: 'Vous avez déjà invité cette personne récemment.' });
      }
      inviteLast.set(key, now());

      const conv = await db.findOrCreatePrivateConversation(meId, tid);
      // Si la personne m'a mis en sourdine : succès apparent, aucune notification (on ne révèle pas la sourdine).
      const silent = (await isMuted(tid, meId)) || target.settings?.notifications === false;
      if (!silent) {
        const content = `${req.user.username} vous invite à discuter (JexCity)`;
        await db.createNotification({ userId: tid, type: 'system', fromUserId: meId, conversationId: conv._id, content });
        io.to(`user:${tid}`).emit('notification', { type: 'system', fromUserId: meId, conversationId: String(conv._id), content });
        if (typeof sendPushNotification === 'function' && target.fcmTokens?.length) {
          sendPushNotification(tid, target.fcmTokens, 'JexCity', content, { conversationId: String(conv._id) }).catch(() => {});
        }
      }
      return res.json({ ok: true, conversationId: String(conv._id) });
    } catch (err) {
      console.warn('[JexCity] invite:', err.message);
      return res.status(500).json({ error: 'Erreur.' });
    }
  });

  return { presence, games, inviteLast };
}

module.exports = { ARENA, RACE, SHOOT, createGames, tttResult, cleanChat, cleanLook, CITY_FILES, mountStatic, mountApi, createPresence, cleanMood, clampNum, INVITE, BOUNDS, MAX_PRESENCE };
