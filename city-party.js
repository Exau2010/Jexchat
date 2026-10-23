// city-party.js — JexCity : client des salons multi-appareils (Arène en ligne, cinéma à plusieurs). Voir city-party-server.js.
// Un seul objet partagé par l'arène et le cinéma : invitation reçue (bandeau Accepter/Refuser), état du salon, relais hôte ↔ invités.
// Tout texte venant du réseau est inséré avec textContent.
export function createPartyClient({ socket, me, toast = () => {} }) {
  const subs = {}; let room = null, inviteEl = null, inviteT = 0;
  const on = (ev, fn) => { (subs[ev] ||= []).push(fn); return () => { subs[ev] = subs[ev].filter((f) => f !== fn); }; };
  const fire = (ev, a) => (subs[ev] || []).slice().forEach((f) => { try { f(a); } catch (e) { console.warn('[party]', e); } });
  const emit = (ev, data) => new Promise((resolve, reject) => {
    if (!socket.connected) return reject(new Error('Connexion perdue.'));
    socket.timeout(6000).emit(ev, data, (err, res) => { if (err) reject(new Error('Le serveur ne répond pas.')); else if (res?.error) reject(new Error(res.error)); else resolve(res); });
  });
  const LABEL = { arena: 'aux mini-jeux de l’Arène', cinema: 'au cinéma' };

  function hideInvite() { clearTimeout(inviteT); inviteEl?.remove(); inviteEl = null; }
  function showInvite(inv) {
    hideInvite();
    const el = document.createElement('div'); el.setAttribute('role', 'alertdialog');
    el.style.cssText = 'position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:80;width:min(92vw,380px);padding:14px 16px;border-radius:18px;color:#fff;font:600 15px system-ui,sans-serif;background:rgba(20,26,44,.92);border:1px solid rgba(255,255,255,.35);backdrop-filter:blur(14px);box-shadow:0 10px 36px rgba(0,0,0,.5)';
    const t = document.createElement('div'); const b = document.createElement('b'); b.textContent = inv.from.username;
    t.append(b, ` vous invite ${LABEL[inv.type] || ''}` + (inv.film?.title ? ` : « ${inv.film.title} »` : '') + '.');
    const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:8px;margin-top:10px';
    const mk = (txt, bg, fg, fn) => { const x = document.createElement('button'); x.textContent = txt; x.style.cssText = `flex:1;padding:10px;border-radius:12px;border:1px solid rgba(255,255,255,.35);font:700 15px system-ui;background:${bg};color:${fg}`; x.onclick = fn; return x; };
    row.append(mk('Accepter', '#ffd23d', '#231a00', async () => { hideInvite(); try { const r = await emit('party:accept', { id: inv.id }); room = r.lobby; fire('joined', { ...r.lobby, invitedBy: inv.from }); } catch (e) { toast(e.message); } }),
      mk('Refuser', 'rgba(255,255,255,.14)', '#fff', () => { socket.emit('party:decline', { id: inv.id }); hideInvite(); }));
    el.append(t, row); document.body.append(el); inviteEl = el; inviteT = setTimeout(hideInvite, 55000);
  }

  socket.on('party:invited', (inv) => { if (inv?.from && inv.id) showInvite(inv); });
  socket.on('party:lobby', (l) => { room = l; fire('lobby', l); });
  socket.on('party:start', (s) => fire('start', s));
  socket.on('party:film', (f) => { if (room && room.id === f.id) room.film = f.film; fire('film', f); });
  socket.on('party:relay', (m) => fire(m.k === 'snap' ? 'snap' : 'in', m));
  socket.on('party:declined', (d) => toast(`${d.by} a décliné l’invitation.`));
  socket.on('party:closed', (c) => { if (room && room.id === c.id) { room = null; hideInvite(); fire('closed', c); if (c.reason === 'left') toast('Le salon a été fermé.'); } });

  return {
    on, emit, get room() { return room; }, isHost: () => !!room && room.host === me.id,
    invite: (to, type, film) => emit('party:invite', { to, type, film }).then((r) => r),
    start: (mode) => emit('party:start', { id: room?.id, mode }),
    end: () => room && socket.emit('party:end', { id: room.id }),
    film: (url, title) => emit('party:film', { id: room?.id, url, title }),
    send: (k, d) => { if (room) socket.volatile.emit('party:relay', { id: room.id, k, d }); },
    leave: () => { if (room) socket.emit('party:leave'); room = null; },
  };
}
