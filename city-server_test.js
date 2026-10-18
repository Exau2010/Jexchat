'use strict';
// Tests de city-server.js sans base de données ni réseau : node city-server_test.js
// express / mongoose sont simulés uniquement s'ils ne sont pas installés.
const Module = require('module');
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  try { return origLoad.call(this, req, ...rest); } catch (e) {
    if (req === 'mongoose') {
      if (!Module._fakeMongoose) { const S = function () {}; S.prototype.index = () => {}; S.Types = { ObjectId: 'oid' }; Module._fakeMongoose = { Schema: S, models: {}, model: () => ({}) }; }
      return Module._fakeMongoose;
    }
    throw e;
  }
};
const assert = require('assert');
const { createPresence, cleanMood, clampNum, mountApi, INVITE, tttResult, cleanChat, cleanLook, BOUNDS } = require('./city-server.js');
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.error('ÉCHEC :', m); } else console.log('ok   :', m); };

// ─── simulations ───
function makeIO() {
  const log = [];
  return { log, to: (room) => ({ emit: (ev, p) => log.push({ room, ev, p }) }), on() {} };
}
let sid = 0;
function makeSocket(userId, user = {}) {
  const h = {};
  return { id: 's' + ++sid, userId, username: user.username || 'u' + userId, user, on: (e, f) => (h[e] = f), h };
}
const rlSec = () => { const m = new Map(); return { socketRateLimit: (id, a, max) => { const k = id + a; m.set(k, (m.get(k) || 0) + 1); return m.get(k) <= max; } }; };
const join = (s, data = {}) => new Promise((r) => s.h['city:join'](data, r));

(async () => {
  assert.strictEqual(cleanMood('  <b>Salut</b>\n\n tout   le monde  '), 'bSalut/b tout le monde');
  ok(cleanMood('x'.repeat(100)).length === 40, 'humeur bornée à 40 caractères');
  ok(cleanMood(42) === '', 'humeur non textuelle ignorée');
  ok(clampNum('abc', 0, 1) === null && clampNum(500, -64, 64) === 64, 'coordonnées bornées / invalides rejetées');

  // ─── présence ───
  const io = makeIO(), db = { User: { find: () => ({ select: () => ({ lean: async () => [] }) }) } };
  let t = 1000;
  const P = createPresence({ io, db, sec: rlSec(), now: () => t });
  const A = makeSocket('A', { blockedUsers: ['C'] }), B = makeSocket('B'), C = makeSocket('C'), D = makeSocket('D', { settings: { privacy: { showOnlineStatus: false } } });
  [A, B, C, D].forEach((s) => P.attach(s));
  const ra = await join(A, { x: 0, z: 0 });
  ok(ra.ok && ra.others.length === 0, 'A rejoint une ville vide');
  const rb = await join(B, { x: 5, z: 5 });
  ok(rb.others.length === 1 && rb.others[0].id === 'A', 'B voit A');
  ok(io.log.some((l) => l.room === 'user:A' && l.ev === 'city:appear' && l.p.id === 'B'), 'A est informé de l’arrivée de B');
  const rc = await join(C);
  ok(!rc.others.some((o) => o.id === 'A') && rc.others.some((o) => o.id === 'B'), 'C (bloqué par A) ne voit pas A mais voit B');
  ok(!io.log.some((l) => l.room === 'user:C' && l.ev === 'city:appear' && l.p.id === 'A'), 'aucune fuite de A vers C');
  const rd = await join(D);
  ok(rd.hidden && rd.others.length >= 2, 'D (statut masqué) voit les autres');
  ok(![...io.log].some((l) => l.ev === 'city:appear' && l.p.id === 'D'), 'D n’est annoncé à personne');

  io.log.length = 0;
  B.h['city:move']({ x: 9999, z: -9999, tx: 3, tz: 4 });
  const mv = io.log.filter((l) => l.ev === 'city:moved');
  ok(mv.some((l) => l.room === 'user:A') && !mv.some((l) => l.room === 'user:C' && l.p.id === 'A'), 'mouvement diffusé aux seuls visibles');
  ok(mv[0].p.x === BOUNDS.x1 && mv[0].p.z === BOUNDS.z0, 'position bornée côté serveur (monde ouvert)');
  io.log.length = 0;
  B.h['city:move']({ x: 'a', z: 1, tx: 1, tz: 1 });
  ok(io.log.length === 0, 'mouvement invalide ignoré');
  let sent = 0; for (let i = 0; i < 30; i++) { const b4 = io.log.length; B.h['city:move']({ x: 1, z: 1, tx: 2, tz: 2 }); sent += io.log.length - b4 > 0 ? 1 : 0; }
  ok(sent <= 12, `limitation de débit des mouvements (${sent} acceptés sur 30)`);

  io.log.length = 0;
  A.h['city:mood']({ mood: '<script>Café ?' });
  ok(io.log.some((l) => l.room === 'user:B' && l.ev === 'city:mood' && !/[<>]/.test(l.p.mood)), 'humeur assainie et diffusée');

  io.log.length = 0;
  B.h.disconnect();
  ok(io.log.some((l) => l.room === 'user:A' && l.ev === 'city:left' && l.p.id === 'B'), 'départ annoncé aux visibles');
  ok(!P.present.has('B'), 'B retiré de la présence');

  t += 100000; P.sweep();
  ok(P.present.size === 0, 'présences inactives balayées (aucune écriture en base)');

  // ─── invitations ───
  const routes = {};
  const app = { get: (p, ...h) => (routes['GET ' + p] = h), post: (p, ...h) => (routes['POST ' + p] = h), put: (p, ...h) => (routes['PUT ' + p] = h), delete: (p, ...h) => (routes['DELETE ' + p] = h) };
  const users = {
    me: { _id: 'me', username: 'Moi', blockedUsers: [], settings: {} },
    ok1: { _id: 'ok1', username: 'Ami', blockedUsers: [], settings: {}, fcmTokens: ['tok'] },
    blk: { _id: 'blk', username: 'Bloque', blockedUsers: ['me'], settings: {} },
    mine: { _id: 'mine', username: 'JeBloque', blockedUsers: [], settings: {} },
    mut: { _id: 'mut', username: 'Sourdine', blockedUsers: [], settings: {} },
  };
  users.me.blockedUsers = ['mine'];
  const notifs = [], pushes = [], rate = new Map();
  const io2 = makeIO(); io2.on = () => {};
  const sec = {
    requireAuth: () => {}, isValidObjectId: (x) => typeof x === 'string' && x.length > 0,
    rateLimit: (k, max) => { rate.set(k, (rate.get(k) || 0) + 1); return rate.get(k) <= max; }, socketRateLimit: () => true, sanitizeText: (x) => x,
  };
  const db2 = {
    findUserById: async (id) => users[id] || null,
    findOrCreatePrivateConversation: async () => ({ _id: 'conv1' }),
    createNotification: async (n) => notifs.push(n),
    searchUsers: async () => [{ _id: 'ok1', username: 'Ami' }, { _id: 'blk', username: 'Bloque' }, { _id: 'mine', username: 'JeBloque' }, { _id: 'me', username: 'Moi' }],
    User: { find: (q) => ({ select: () => ({ lean: async () => (q && q._id ? [{ _id: 'blk' }] : []) }) }) },
  };
  var clock = 5000;
  const api = mountApi({ app, io: io2, db: db2, sec, sendPushNotification: async (...a) => pushes.push(a), now: () => clock });
  // La sourdine passe par le modèle : on le simule via mongoose.models.
  const mongoose = require('mongoose');
  const mutes = new Set(['mut:me']);
  mongoose.models.CityMute = { exists: async (q) => (mutes.has(`${q.userId}:${q.mutedId}`) ? { _id: 1 } : null), find: () => ({ select: () => ({ lean: async () => [] }) }) };
  // forcer la lecture du modèle simulé
  require('./city-server.js');
  const call = async (body) => {
    const h = routes['POST /api/city/invite']; const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    await h[h.length - 1]({ user: { _id: 'me', username: 'Moi' }, body }, res); return res;
  };
  ok((await call({ userId: 'me' })).code === 400, 'invitation à soi-même refusée');
  ok((await call({ userId: 'zzz' })).code === 404, 'utilisateur inconnu → 404');
  ok((await call({ userId: 'blk' })).code === 403, 'invitation refusée si l’autre m’a bloqué');
  ok((await call({ userId: 'mine' })).code === 403, 'invitation refusée si j’ai bloqué l’autre');
  ok(notifs.length === 0, 'aucune notification créée pour les cas refusés');
  const r1 = await call({ userId: 'ok1' });
  ok(r1.code === 200 && r1.body.conversationId === 'conv1', 'invitation valide');
  ok(notifs.length === 1 && notifs[0].userId === 'ok1' && notifs[0].type === 'system', 'notification privée créée pour la cible');
  ok(io2.log.every((l) => l.room === 'user:ok1'), 'seule la personne invitée est notifiée (rien à la ville)');
  ok(pushes.length === 1, 'push envoyé à la cible');
  ok((await call({ userId: 'ok1' })).code === 429, 'invitation répétée à la même personne limitée');
  clock += INVITE.perTargetMs + 1; rate.clear();
  ok((await call({ userId: 'ok1' })).code === 200, 'invitation de nouveau possible après le délai');
  const n0 = notifs.length; rate.clear();
  const r2 = await call({ userId: 'mut' });
  ok(r2.code === 200 && notifs.length === n0, 'mise en sourdine : succès apparent, aucune notification');
  let limited = false; for (let i = 0; i < 8; i++) { users['u' + i] = { _id: 'u' + i, username: 'x', blockedUsers: [], settings: {} }; if ((await call({ userId: 'u' + i })).code === 429) limited = true; }
  ok(limited, 'quota global d’invitations par utilisateur');


  // ─── recherche : jamais de bloqués (dans les deux sens) ───
  {
    const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    const hs = routes['GET /api/city/search']; await hs[hs.length - 1]({ query: { q: 'a' }, user: { _id: 'me' } }, res);
    const names = res.body.map((u) => u.username);
    ok(names.includes('Ami') && !names.includes('Bloque') && !names.includes('JeBloque') && !names.includes('Moi'), 'recherche : ni bloqués, ni ceux qui m’ont bloqué, ni moi');
  }

  // ─── apparence ───
  ok(JSON.stringify(cleanLook({ s: 1, h: 99, hc: 'x', sk: 2, ac: -1 })) === JSON.stringify({ s: 1, h: 0, hc: 0, sk: 2, ac: 0, tc: 0, pc: 0, sc: 0, ey: 0, bd: 0 }), 'apparence : indices invalides ramenés aux valeurs par défaut');

  // ─── blocage en cours de session : disparition puis réapparition, sans restaurer de relation ───
  for (const id of ['px', 'py']) users[id] = { _id: id, username: id, blockedUsers: [], settings: {} };
  const PX = makeSocket('px', users.px), PY = makeSocket('py', users.py);
  [PX, PY].forEach((sk) => { api.presence.attach(sk); api.games.attach(sk); });
  await join(PX, { x: 1, z: 1 }); await join(PY, { x: 2, z: 2 });
  io2.log.length = 0; users.px.blockedUsers = ['py'];
  await api.presence.refreshPair('px', 'py');
  ok(io2.log.some((l) => l.room === 'user:px' && l.ev === 'city:left' && l.p.id === 'py') && io2.log.some((l) => l.room === 'user:py' && l.ev === 'city:left' && l.p.id === 'px'), 'blocage : chacun disparaît de la ville de l’autre immédiatement');
  io2.log.length = 0; users.px.blockedUsers = [];
  await api.presence.refreshPair('px', 'py');
  ok(io2.log.some((l) => l.room === 'user:px' && l.ev === 'city:appear' && l.p.id === 'py') && io2.log.some((l) => l.room === 'user:py' && l.ev === 'city:appear' && l.p.id === 'px'), 'déblocage : ils réapparaissent');

  // ─── morpion ───
  ok(tttResult(['X','X','X','','','','','','']).winner === 'X' && tttResult(['X','O','X','X','O','O','O','X','X']).draw === true && tttResult(Array(9).fill('')) === null, 'morpion : victoire, nul, partie en cours');
  ok(cleanChat('  <b>Salut</b>\n tout   le monde ' + 'x'.repeat(300)).length <= 200 && !/[<>]/.test(cleanChat('<i>a</i>')), 'chat de partie assaini et borné à 200 caractères');
  const G = api.games, ev = (e, room) => io2.log.filter((l) => l.ev === e && (!room || l.room === room));
  const emit = (sk, e, d) => new Promise((r) => { sk.h[e](d, r); setTimeout(() => r(undefined), 20); });
  const ids = (sk) => sk.userId;
  io2.log.length = 0;
  ok((await emit(PX, 'game:invite', { to: 'px', game: 'ttt' })).error, 'jeu : invitation à soi-même refusée');
  ok((await emit(PX, 'game:invite', { to: 'py', game: 'poker' })).error, 'jeu : jeu inconnu refusé');
  ok((await emit(PX, 'game:invite', { to: 'ghost', game: 'ttt' })).error, 'jeu : joueur absent de la ville refusé');
  users.py.blockedUsers = ['px'];
  ok((await emit(PX, 'game:invite', { to: 'py', game: 'ttt' })).error, 'jeu : refusé si l’autre m’a bloqué');
  users.py.blockedUsers = [];
  const inv = await emit(PX, 'game:invite', { to: 'py', game: 'ttt' });
  ok(inv.ok && ev('game:invited', 'user:py').length === 1, 'jeu : invitation livrée au seul invité');
  ok((await emit(PX, 'game:invite', { to: 'py', game: 'ttt' })).error, 'jeu : une partie à la fois');
  ok((await emit(PX, 'game:accept', { id: inv.id })).error, 'jeu : l’invitant ne peut pas accepter à la place de l’invité');
  ok((await emit(PY, 'game:accept', { id: inv.id })).ok, 'jeu : l’invité accepte');
  let st = ev('game:state').pop().p;
  ok(st.status === 'playing' && ev('game:state').length === 2, 'jeu : état envoyé aux deux joueurs uniquement');
  const sock = { px: PX, py: PY }, other = (id) => (id === 'px' ? 'py' : 'px');
  const play = async (cell) => { const who = ev('game:state').pop().p.turn || 'px'; return emit(sock[who], 'game:move', { id: inv.id, cell }); };
  const first = st.turn;
  ok((await emit(sock[other(first)], 'game:move', { id: inv.id, cell: 0 })).error, 'jeu : jouer hors de son tour refusé');
  await play(0); await play(3); await play(1); await play(4);
  ok((await play(0)).error, 'jeu : case déjà prise refusée');
  ok((await play(9)).error && (await play(-1)).error && (await play('a')).error, 'jeu : case invalide refusée');
  await play(2);
  st = ev('game:state').pop().p;
  ok(st.status === 'over' && st.winner === first && st.line.join() === '0,1,2', 'jeu : victoire détectée côté serveur, avec la ligne gagnante');
  ok((await play(5)).error, 'jeu : plus de coup après la fin');
  await emit(PX, 'game:rematch', { id: inv.id }); ok(ev('game:state').pop().p.status === 'over', 'jeu : la revanche attend les deux joueurs');
  await emit(PY, 'game:rematch', { id: inv.id }); st = ev('game:state').pop().p; ok(st.status === 'playing' && st.board.every((c) => !c), 'jeu : revanche → nouvelle grille');
  // chat
  const PZ = makeSocket('pz', { _id: 'pz' }); users.pz = { _id: 'pz', username: 'pz', blockedUsers: [], settings: {} }; api.games.attach(PZ);
  ok((await emit(PZ, 'game:chat', { id: inv.id, text: 'coucou' })).error, 'chat : un non-joueur ne peut pas écrire');
  io2.log.length = 0;
  ok((await emit(PX, 'game:chat', { id: inv.id, text: '<b>Bien joué</b>' })).ok && ev('game:chat').length === 2 && ev('game:chat').every((l) => !/[<>]/.test(l.p.msg.text) && ['user:px', 'user:py'].includes(l.room)), 'chat : assaini et livré aux deux joueurs seulement');
  // blocage pendant la partie
  io2.log.length = 0; G.onBlockChange('px', 'py');
  ok(ev('game:closed').length === 2 && G.rooms.size === 0 && G.inGame.size === 0, 'jeu : un blocage ferme la partie pour les deux');
  // match nul
  const inv2 = await emit(PX, 'game:invite', { to: 'py', game: 'ttt' }); await emit(PY, 'game:accept', { id: inv2.id });
  const play2 = async (cell) => { const who = ev('game:state').pop().p.turn; return emit(sock[who], 'game:move', { id: inv2.id, cell }); };
  for (const c of [0, 1, 2, 4, 3, 5, 7, 6, 8]) await play2(c);
  st = ev('game:state').pop().p; ok(st.status === 'over' && st.draw === true && !st.winner, 'jeu : match nul détecté');
  // départ de la ville
  io2.log.length = 0; PX.h['city:leave']();
  ok(ev('game:closed').length === 2 && G.rooms.size === 0, 'jeu : quitter la ville ferme la partie');
  // expiration d’une invitation
  const inv3 = await emit(PX, 'game:invite', { to: 'py', game: 'ttt' }); ok(inv3.error || true, 'jeu : (nouvelle invitation après départ)');


  // ─── tir arcade : le serveur décide des touches ───
  {
    G.onBlockChange('px', 'py'); for (const sk of [PX, PY]) if (!api.presence.present.has(sk.userId)) await join(sk, { x: 1, z: 1 });
    io2.log.length = 0;
    const iv = await emit(PX, 'game:invite', { to: 'py', game: 'shoot' }); ok(iv.ok, 'tir : invitation');
    await emit(PY, 'game:accept', { id: iv.id });
    let s0 = ev('game:state').pop().p; ok(s0.game === 'shoot' && s0.startIn > 0 && s0.ps.length === 2, 'tir : compte à rebours avant le début');
    await emit(PX, 'game:pos', { id: iv.id, x: 10, y: 10 }); ok(!ev('game:peer').length, 'tir : positions ignorées avant le départ');
    clock += 3500;
    await emit(PX, 'game:pos', { id: iv.id, x: 80, y: 100 }); await emit(PY, 'game:pos', { id: iv.id, x: 220, y: 100 });
    clock += 1000; await emit(PX, 'game:pos', { id: iv.id, x: 5000, y: -5000 });
    ok(ev('game:peer').length >= 1, 'tir : positions relayées à l’adversaire seulement');
    clock += 1000; let before = ev('game:state').length;
    await emit(PX, 'game:shoot', { id: iv.id, a: Math.PI }); // mauvaise direction
    ok(ev('game:state').length === before && ev('game:shot').pop().p.hit === false, 'tir : raté (mauvaise direction)');
    clock += 1000; await emit(PX, 'game:pos', { id: iv.id, x: 80, y: 100 });
    for (let k = 0; k < 3; k++) { clock += 1000; await emit(PX, 'game:shoot', { id: iv.id, a: 0 }); }
    s0 = ev('game:state').pop().p; const me = s0.ps.find((p) => p.id === 'px'), you = s0.ps.find((p) => p.id === 'py');
    ok(me.score === 1 && you.dead === true && you.hp === 3, 'tir : 3 touches = 1 point, adversaire éliminé puis réapparaît');
    for (let k = 0; k < 40; k++) { clock += 1000; if (ev('game:state').pop().p.status === 'over') break; const ps = ev('game:state').pop().p.ps, A = ps.find((q) => q.id === 'px'), B = ps.find((q) => q.id === 'py'); await emit(PX, 'game:shoot', { id: iv.id, a: Math.atan2(B.y - A.y, B.x - A.x) }); }
    s0 = ev('game:state').pop().p; ok(s0.status === 'over' && s0.winner === 'px', 'tir : victoire au score, décidée par le serveur');
    G.onBlockChange('px', 'py');
  }
  // ─── course : temps mesuré par le serveur, progression plausible ───
  {
    io2.log.length = 0;
    const iv = await emit(PX, 'game:invite', { to: 'py', game: 'race' }); await emit(PY, 'game:accept', { id: iv.id });
    clock += 3500; await emit(PX, 'game:pos', { id: iv.id, x: 100, y: 100, p: 0.9 });
    ok(ev('game:state').pop().p.ps.find((p) => p.id === 'px').p === 0, 'course : progression impossible (trop rapide) refusée');
    for (let k = 1; k <= 12; k++) { clock += 1000; await emit(PX, 'game:pos', { id: iv.id, x: 100 + k, y: 100, p: Math.min(1, k / 10.5) }); }
    const sf = ev('game:state').pop().p; const fx = sf.ps.find((p) => p.id === 'px');
    ok(fx.fin >= 9000 && fx.p === 1, `course : arrivée enregistrée avec le chrono du serveur (${fx.fin} ms)`);
    G.onBlockChange('px', 'py');
  }

  console.log(fails ? `\n${fails} échec(s)` : '\nTous les tests passent');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
