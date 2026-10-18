// city-games.js — JexCity : mini-jeux multijoueurs (morpion) et chat de partie, sans quitter la ville.
// Le serveur fait autorité (tours, cases, victoire, nul). Ici : affichage et envoi des intentions uniquement.
// Aucun sondage réseau : tout passe par des événements Socket.IO (game:*), les parties vivent en mémoire côté serveur.
// Tout texte venant du réseau est inséré avec textContent.

const MARK = {
  X: '<svg viewBox="0 0 40 40" aria-hidden="true"><path class="stroke" d="M9 9L31 31M31 9L9 31"/></svg>',
  O: '<svg viewBox="0 0 40 40" aria-hidden="true"><circle class="stroke" cx="20" cy="20" r="11"/></svg>',
};

const TITLES = { ttt: 'Morpion', race: 'Course', shoot: 'Tir arcade' };
const TRACK = { cx: 150, cy: 100, rx: 110, ry: 70, band: 0.3, laps: 2 };

export function createGamesClient({ socket, me, h, toast }) {
  let room = null;            // dernier état reçu du serveur
  let chat = [];
  let panel = null, inviteEl = null, inviteT = 0;
  let pendingTo = null, pendingId = null; // invitation envoyée, en attente de réponse
  let lastStatus = '';
  let act = null, pendingGame = 'ttt'; // jeu d'action en cours (course / tir) : boucle d'affichage locale

  const mySym = () => room?.players.find((p) => p.id === me.id)?.sym || '';
  const nameOf = (id) => room?.players.find((p) => p.id === id)?.username || '';

  function emit(ev, data) {
    return new Promise((resolve, reject) => {
      if (!socket.connected) return reject(new Error('Connexion perdue.'));
      socket.timeout(6000).emit(ev, data, (err, res) => { if (err) reject(new Error('Le serveur ne répond pas.')); else if (res?.error) reject(new Error(res.error)); else resolve(res); });
    });
  }

  // ── invitation reçue ──
  function showInvite(inv) {
    hideInvite();
    inviteEl = h('div', { class: 'ginvite', role: 'alertdialog', 'aria-label': 'Invitation à jouer' },
      h('div', { class: 'wrap' }, h('b', { text: inv.from.username }), ' vous invite à jouer ' + ({ ttt: 'au morpion', race: 'à la course', shoot: 'au tir arcade' }[inv.game] || '') + '.'),
      h('div', { class: 'actions', style: 'margin:8px 0 0' },
        h('button', { class: 'btn small primary', onclick: async () => { const id = inv.id; hideInvite(); try { await emit('game:accept', { id }); } catch (e) { toast(e.message); } }, text: 'Accepter' }),
        h('button', { class: 'btn small', onclick: () => { socket.emit('game:decline', { id: inv.id }); hideInvite(); }, text: 'Refuser' })));
    document.body.append(inviteEl);
    inviteT = setTimeout(hideInvite, 55000);
  }
  function hideInvite() { clearTimeout(inviteT); inviteEl?.remove(); inviteEl = null; }

  // ── panneau de partie ──
  function ensurePanel() {
    if (panel) return panel;
    panel = h('section', { class: 'gpanel', 'aria-label': 'Partie de morpion' });
    document.body.append(panel);
    return panel;
  }
  function closePanel() { stopAction(); panel?.remove(); panel = null; room = null; chat = []; pendingTo = null; pendingId = null; lastStatus = ''; }

  function outcome() {
    if (!room || room.status !== 'over') return '';
    if (room.draw) return 'draw';
    return room.winner === me.id ? 'win' : 'lose';
  }
  function statusText() {
    if (pendingTo) return `En attente de ${pendingTo}…`;
    if (!room) return '';
    const o = outcome();
    if (o === 'win') return 'Victoire ! 🎉';
    if (o === 'lose') return `Défaite… ${nameOf(room.winner)} gagne.`;
    if (o === 'draw') return 'Match nul.';
    return room.turn === me.id ? `À vous de jouer (${mySym()})` : `Au tour de ${nameOf(room.turn)}`;
  }

  function render() {
    if (room && room.game !== 'ttt') return renderAction();
    const p = ensurePanel();
    const o = outcome();
    p.className = 'gpanel' + (o ? ' ' + o : '');
    const head = h('header', null, h('b', { text: TITLES[room?.game || pendingGame] }),
      room ? h('span', { class: 'sub', text: room.players.map((x) => `${x.sym} ${x.username}`).join('  ·  ') }) : null,
      h('button', { class: 'fab', 'aria-label': 'Quitter la partie', onclick: leave, text: '✕' }));
    const status = h('div', { class: 'gstatus', role: 'status', 'aria-live': 'polite', text: statusText() });
    const board = h('div', { class: 'gboard' + (room?.turn === me.id ? ' mine' : ''), role: 'grid', 'aria-label': 'Grille' });
    const line = new Set(room?.line || []);
    for (let i = 0; i < 9; i++) {
      const v = room?.board[i] || '';
      const c = h('button', { class: 'cell' + (v ? ' full ' + v : '') + (line.has(i) ? ' hit' : ''), 'aria-label': `Case ${i + 1}${v ? ' : ' + v : ''}`, disabled: !room || room.status !== 'playing' || room.turn !== me.id || !!v ? true : null, onclick: () => play(i) });
      if (v) c.innerHTML = MARK[v]; // contenu statique du module, jamais du texte réseau
      board.append(c);
    }
    const acts = h('div', { class: 'actions', style: 'margin:8px 0' });
    if (room?.status === 'over') {
      const voted = room.rematch.includes(me.id);
      acts.append(h('button', { class: 'btn small primary', disabled: voted ? true : null, onclick: () => socket.emit('game:rematch', { id: room.id }), text: voted ? 'En attente de l’adversaire…' : 'Rejouer' }));
    }
    const log = h('div', { class: 'glog', 'aria-live': 'polite' });
    for (const m of chat) log.append(chatLine(m));
    const input = h('input', { class: 'field', maxlength: 200, placeholder: 'Message à votre adversaire', autocomplete: 'off', 'aria-label': 'Message de partie' });
    const send = h('button', { class: 'btn small primary', text: 'Envoyer', onclick: async () => { const t = input.value.trim(); if (!t || !room) return; input.value = ''; try { await emit('game:chat', { id: room.id, text: t }); } catch (e) { toast(e.message); } } });
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') send.click(); });
    p.replaceChildren(head, status, board, acts, log, h('div', { class: 'sendbar', style: 'position:static' }, input, send));
    log.scrollTop = log.scrollHeight;
    if (o && o !== lastStatus) { lastStatus = o; if (o === 'win') confetti(p); }
    if (!o) lastStatus = '';
  }
  function chatLine(m) { return h('div', { class: 'gmsg' + (m.from === me.id ? ' me' : '') }, h('b', { text: m.from === me.id ? 'Vous' : m.username }), ' ', h('span', { text: m.text })); }

  // petites pastilles de couleur (CSS) pour la victoire : 14 éléments, supprimés après l'animation
  function confetti(p) {
    if (matchMedia('(prefers-reduced-motion:reduce)').matches) return;
    const box = h('div', { class: 'confetti', 'aria-hidden': 'true' });
    const cols = ['#f0b463', '#6fcf97', '#6aa9ff', '#ef6b6b', '#fff'];
    for (let i = 0; i < 14; i++) box.append(h('i', { style: `left:${6 + i * 6.6}%;background:${cols[i % 5]};animation-delay:${(i % 5) * 0.08}s` }));
    p.append(box); setTimeout(() => box.remove(), 1800);
  }

  async function play(i) { if (!room) return; try { await emit('game:move', { id: room.id, cell: i }); } catch (e) { toast(e.message); } }
  function leave() { const id = room?.id || pendingId; if (id) socket.emit('game:leave', { id }); closePanel(); }


  // ── jeux d'action : course et tir (arène 300×200, vue de dessus, dessinée en canvas) ──
  function stopAction() { if (act) { cancelAnimationFrame(act.raf); removeEventListener('keydown', act.kd); removeEventListener('keyup', act.ku); act = null; } }
  function renderAction() {
    const p = ensurePanel();
    if (act && act.id === room.id) return syncAction();
    stopAction();
    const cv = h('canvas', { class: 'gcanvas', width: 300, height: 200, 'aria-label': TITLES[room.game] });
    const status = h('div', { class: 'gstatus', role: 'status', 'aria-live': 'polite' });
    const keys = { l: 0, r: 0, u: 0, d: 0 };
    const hold = (label, k, aria) => { const b = h('button', { class: 'btn pad', 'aria-label': aria, text: label }); const on = (v) => (e) => { e.preventDefault(); keys[k] = v; }; b.addEventListener('pointerdown', on(1)); b.addEventListener('pointerup', on(0)); b.addEventListener('pointerleave', on(0)); b.addEventListener('pointercancel', on(0)); return b; };
    const fireBtn = h('button', { class: 'btn pad primary', text: 'Tir', 'aria-label': 'Tirer' });
    const pad = h('div', { class: 'gpad' }, hold('◀', 'l', 'Gauche'), hold('▲', 'u', 'Haut'), hold('▼', 'd', 'Bas'), hold('▶', 'r', 'Droite'), room.game === 'shoot' ? fireBtn : null);
    const log = h('div', { class: 'glog', 'aria-live': 'polite' }); for (const m of chat) log.append(chatLine(m));
    const input = h('input', { class: 'field', maxlength: 200, placeholder: 'Message à votre adversaire', autocomplete: 'off', 'aria-label': 'Message de partie' });
    const send = h('button', { class: 'btn small primary', text: 'Envoyer', onclick: async () => { const t = input.value.trim(); if (!t || !room) return; input.value = ''; try { await emit('game:chat', { id: room.id, text: t }); } catch (e) { toast(e.message); } } });
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') send.click(); });
    const acts = h('div', { class: 'actions', style: 'margin:6px 0' });
    p.replaceChildren(h('header', null, h('b', { text: TITLES[room.game] }), h('span', { class: 'sub', text: room.players.map((x) => x.username).join(' · ') }), h('button', { class: 'fab', 'aria-label': 'Quitter la partie', onclick: leave, text: '✕' })), status, cv, pad, acts, log, h('div', { class: 'sendbar', style: 'position:static' }, input, send));
    const idx = room.players.findIndex((x) => x.id === me.id);
    act = { id: room.id, game: room.game, cv, ctx: cv.getContext('2d'), status, acts, log, keys, raf: 0, t0: performance.now(), startAt: 0, endAt: 0, ps: [], me: { x: 0, y: 0, a: -Math.PI / 2, v: 0, acc: 0, th: Math.PI, p: 0 }, peer: { x: 0, y: 0, tx: 0, ty: 0, p: 0 }, shots: [], flash: 0, aim: null, idx, sendT: 0, lastFire: 0, over: false };
    act.kd = (e) => { if (e.target?.closest?.('input')) return; const m = { ArrowLeft: 'l', a: 'l', q: 'l', ArrowRight: 'r', d: 'r', ArrowUp: 'u', w: 'u', z: 'u', ArrowDown: 'd', s: 'd' }[e.key]; if (m) { keys[m] = 1; e.preventDefault(); } if (e.key === ' ' && room?.game === 'shoot') { e.preventDefault(); fire(null); } };
    act.ku = (e) => { const m = { ArrowLeft: 'l', a: 'l', q: 'l', ArrowRight: 'r', d: 'r', ArrowUp: 'u', w: 'u', z: 'u', ArrowDown: 'd', s: 'd' }[e.key]; if (m) keys[m] = 0; };
    addEventListener('keydown', act.kd); addEventListener('keyup', act.ku);
    fireBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); fire(null); });
    cv.addEventListener('pointerdown', (e) => { if (room?.game !== 'shoot') return; const r = cv.getBoundingClientRect(); fire({ x: ((e.clientX - r.left) / r.width) * 300, y: ((e.clientY - r.top) / r.height) * 200 }); });
    syncAction(true); act.raf = requestAnimationFrame(loop);
  }
  function fire(target) {
    if (!act || act.game !== 'shoot' || act.over || performance.now() < act.startAt || performance.now() - act.lastFire < 350) return;
    const m = meState(); if (m?.dead) return; act.lastFire = performance.now();
    const t = target || { x: act.peer.x, y: act.peer.y };
    socket.emit('game:shoot', { id: room.id, a: Math.atan2(t.y - act.me.y, t.x - act.me.x) });
  }
  const meState = () => act?.ps.find((q) => q.id === me.id);
  function syncAction(first) {
    const a = act, prevDead = meState()?.dead; a.ps = room.ps;
    const mine = meState(), other = room.ps.find((q) => q.id !== me.id);
    if (first || room.status === 'playing' && room.startIn > 0) { // (re)départ : positions fixées par le serveur
      a.startAt = performance.now() + room.startIn; a.over = false; a.me.x = mine.x; a.me.y = mine.y; a.me.v = 0; a.me.acc = 0; a.me.p = 0; a.me.th = Math.PI; a.me.a = room.game === 'race' ? -Math.PI / 2 : 0;
      a.peer.x = a.peer.tx = other.x; a.peer.y = a.peer.ty = other.y; a.peer.p = 0;
    }
    if (prevDead && !mine.dead) { a.me.x = mine.x; a.me.y = mine.y; } // réapparition
    a.endAt = room.endIn != null ? performance.now() + room.endIn : 0;
    const o = room.status === 'over' ? (room.draw ? 'draw' : room.winner === me.id ? 'win' : 'lose') : '';
    a.over = !!o; panel.className = 'gpanel' + (o ? ' ' + o : '');
    a.acts.replaceChildren();
    if (o) {
      a.status.textContent = o === 'win' ? 'Victoire ! 🎉' : o === 'lose' ? 'Défaite…' : 'Match nul.';
      const voted = room.rematch.includes(me.id);
      a.acts.append(h('button', { class: 'btn small primary', disabled: voted ? true : null, onclick: () => socket.emit('game:rematch', { id: room.id }), text: voted ? 'En attente de l’adversaire…' : 'Rejouer' }));
      if (o !== a.lastO) { a.lastO = o; if (o === 'win') confetti(panel); }
    } else a.lastO = '';
  }
  function trackInfo(x, y) { const nx = (x - TRACK.cx) / TRACK.rx, ny = (y - TRACK.cy) / TRACK.ry; return { on: Math.abs(Math.hypot(nx, ny) - 1) < TRACK.band, th: Math.atan2(ny, nx) }; }
  function loop(now) {
    const a = act; if (!a) return; a.raf = requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - (a.last || now)) / 1000); a.last = now;
    const go = now >= a.startAt && !a.over, m = a.me, k = a.keys, ms = meState();
    if (go && !ms?.dead) {
      if (a.game === 'race') {
        m.a += (k.r - k.l) * 2.7 * dt; const tr = trackInfo(m.x, m.y), vmax = tr.on ? 100 : 40;
        m.v += ((k.d ? 0 : vmax) - m.v) * Math.min(1, dt * (k.d ? 3 : 1.6)); if (m.v > vmax) m.v += (vmax - m.v) * Math.min(1, dt * 5);
        m.x += Math.cos(m.a) * m.v * dt; m.y += Math.sin(m.a) * m.v * dt;
        let d = trackInfo(m.x, m.y).th - m.th; d = Math.atan2(Math.sin(d), Math.cos(d)); m.th += d; m.acc += d; m.p = Math.max(m.p, Math.min(1, Math.max(0, m.acc) / (Math.PI * 2 * TRACK.laps)));
      } else { m.x += (k.r - k.l) * 88 * dt; m.y += (k.d - k.u) * 88 * dt; }
      m.x = Math.min(300, Math.max(0, m.x)); m.y = Math.min(200, Math.max(0, m.y));
      if (now - a.sendT > 100) { a.sendT = now; socket.emit('game:pos', { id: room.id, x: m.x, y: m.y, p: m.p }); }
    }
    a.peer.x += (a.peer.tx - a.peer.x) * Math.min(1, dt * 12); a.peer.y += (a.peer.ty - a.peer.y) * Math.min(1, dt * 12);
    draw(a, now, ms);
  }
  function draw(a, now, ms) {
    const c = a.ctx; c.clearRect(0, 0, 300, 200);
    if (a.game === 'race') {
      c.fillStyle = '#2f5a3a'; c.fillRect(0, 0, 300, 200);
      c.strokeStyle = '#5b5a58'; c.lineWidth = TRACK.band * 2 * 70 * 0.9; c.beginPath(); c.ellipse(TRACK.cx, TRACK.cy, TRACK.rx, TRACK.ry, 0, 0, 7); c.stroke();
      c.strokeStyle = '#fff'; c.lineWidth = 3; c.beginPath(); c.moveTo(18, 100); c.lineTo(62, 100); c.stroke(); // ligne d'arrivée
    } else {
      c.fillStyle = '#26324a'; c.fillRect(0, 0, 300, 200); c.strokeStyle = 'rgba(255,255,255,.12)'; c.lineWidth = 1;
      for (let x = 0; x <= 300; x += 30) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, 200); c.stroke(); } for (let y = 0; y <= 200; y += 30) { c.beginPath(); c.moveTo(0, y); c.lineTo(300, y); c.stroke(); }
    }
    const car = (x, y, ang, col, dead) => { if (dead) return; c.save(); c.translate(x, y); c.rotate(ang); c.fillStyle = col; if (a.game === 'race') c.fillRect(-9, -5, 18, 10); else { c.beginPath(); c.arc(0, 0, 8, 0, 7); c.fill(); c.fillStyle = '#fff'; c.fillRect(0, -2, 11, 4); } c.restore(); };
    const peerAng = a.game === 'race' ? Math.atan2(a.peer.ty - a.peer.y, a.peer.tx - a.peer.x) : 0;
    const peerDead = a.ps.find((q) => q.id !== me.id)?.dead;
    car(a.peer.x, a.peer.y, peerAng, '#f0b463', peerDead); car(a.me.x, a.me.y, a.game === 'race' ? a.me.a : Math.atan2(a.peer.y - a.me.y, a.peer.x - a.me.x), '#6aa9ff', ms?.dead);
    for (const s of a.shots) { const age = (now - s.t) / 140; if (age > 1) continue; c.strokeStyle = `rgba(255,255,255,${1 - age})`; c.lineWidth = 3; c.beginPath(); c.moveTo(s.x, s.y); c.lineTo(s.x + Math.cos(s.a) * 260, s.y + Math.sin(s.a) * 260); c.stroke(); }
    a.shots = a.shots.filter((s) => now - s.t < 140);
    if (now < a.flashUntil) { c.fillStyle = 'rgba(255,255,255,.35)'; c.fillRect(0, 0, 300, 200); }
    // textes d'état (dessinés en gros, contrastés)
    c.textAlign = 'center'; c.font = '700 22px system-ui,sans-serif'; c.lineWidth = 4;
    const say = (t, y = 100) => { c.strokeStyle = 'rgba(0,0,0,.8)'; c.strokeText(t, 150, y); c.fillStyle = '#fff'; c.fillText(t, 150, y); };
    if (now < a.startAt) say(String(Math.ceil((a.startAt - now) / 1000)) || 'Partez !'); else if (now < a.startAt + 600) say('Partez !');
    if (!a.over && a.endAt && now >= a.startAt) { c.font = '600 12px system-ui,sans-serif'; c.textAlign = 'right'; c.strokeStyle = 'rgba(0,0,0,.8)'; c.lineWidth = 3; const left = `${Math.max(0, Math.ceil((a.endAt - now) / 1000))} s`; c.strokeText(left, 294, 14); c.fillStyle = '#fff'; c.fillText(left, 294, 14); }
    if (a.game === 'shoot') { const me2 = a.ps.find((q) => q.id === me.id), pe = a.ps.find((q) => q.id !== me.id); c.textAlign = 'left'; c.font = '600 13px system-ui,sans-serif'; c.lineWidth = 3;
      const hud = `Vous ${'♥'.repeat(me2?.hp || 0)}  ${me2?.score || 0} – ${pe?.score || 0}  ${'♥'.repeat(pe?.hp || 0)} Adv.`; c.strokeStyle = 'rgba(0,0,0,.8)'; c.strokeText(hud, 6, 14); c.fillStyle = '#fff'; c.fillText(hud, 6, 14); }
    else { const pct = Math.round(a.me.p * 100), pp = Math.round(a.peer.p * 100); c.textAlign = 'left'; c.font = '600 13px system-ui,sans-serif'; c.lineWidth = 3; const hud = `Vous ${pct}% · Adv. ${pp}%`; c.strokeStyle = 'rgba(0,0,0,.8)'; c.strokeText(hud, 6, 14); c.fillStyle = '#fff'; c.fillText(hud, 6, 14); }
    if (!a.over) a.status.textContent = now < a.startAt ? 'Préparez-vous…' : (a.game === 'race' ? 'Gauche/droite pour tourner, ▼ pour freiner' : 'Déplacez-vous, touchez l’arène ou « Tir »');
    else if (a.game === 'race') { const f = a.ps.map((q) => `${q.id === me.id ? 'Vous' : 'Adv.'} ${q.fin != null ? (q.fin / 1000).toFixed(2) + ' s' : 'non arrivé'}`).join('  ·  '); a.acts.dataset.t = f; if (!a.times) { a.times = h('div', { class: 'sub wrap', text: f }); a.acts.before(a.times); } a.times.textContent = f; }
  }
  socket.on('game:peer', (d) => { if (act && room && d.id === room.id) { act.peer.tx = d.x; act.peer.ty = d.y; act.peer.p = d.p || 0; } });
  socket.on('game:fix', (d) => { if (act && room && d.id === room.id) { act.me.x = d.x; act.me.y = d.y; act.me.v = 0; } });
  socket.on('game:shot', (d) => { if (!act || !room || d.id !== room.id) return; const mine = d.from === me.id, o = mine ? act.me : act.peer; act.shots.push({ x: o.x, y: o.y, a: d.a, t: performance.now() }); if (d.hit && !mine) act.flashUntil = performance.now() + 160; });

  // ── API vers l'interface ──
  async function invite(userId, username, game = 'ttt') {
    if (room || pendingTo) throw new Error('Vous avez déjà une partie en cours.');
    const r = await emit('game:invite', { to: userId, game });
    pendingGame = game; pendingTo = username || 'le joueur'; pendingId = r?.id || null; render();
  }

  socket.on('game:invited', showInvite);
  socket.on('game:state', (st) => { pendingTo = null; pendingId = null; const first = !room || room.id !== st.id; room = st; if (first) chat = []; hideInvite(); render(); });
  socket.on('game:chat', ({ id, msg }) => { if (room && room.id === id) { chat.push(msg); if (chat.length > 40) chat.shift(); if (act) { act.log.append(chatLine(msg)); act.log.scrollTop = act.log.scrollHeight; } else render(); } });
  socket.on('game:closed', ({ id, reason }) => {
    if (room && room.id !== id) return;
    const was = !!room || !!pendingTo;
    if (was) toast({ declined: 'Invitation refusée.', expired: 'Invitation expirée.', left: 'Votre adversaire a quitté la partie.', idle: 'Partie fermée (inactivité).', blocked: 'Partie fermée.' }[reason] || 'Partie terminée.');
    closePanel(); hideInvite();
  });
  // Reconnexion : on redemande l'état de la partie ; si elle n'existe plus, on ferme proprement.
  socket.on('connect', () => { if (room) emit('game:sync', { id: room.id }).then((r) => { room = r.state; chat = r.chat || []; render(); }).catch(() => closePanel()); });
  socket.on('disconnect', () => { hideInvite(); });

  return { invite, get active() { return !!room || !!pendingTo; } };
}
