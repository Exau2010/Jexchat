// Test du serveur de salons (arène en ligne + cinéma) avec dépendances simulées : node city-party_test.js
const { createParty } = require('./city-party-server.js');
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.error('ÉCHEC :', m); } else console.log('ok   :', m); };
const log = []; const io = { to: (room) => ({ emit: (ev, p) => log.push({ room, ev, p }) }), sockets: { adapter: { rooms: new Map() } } };
const A = 'a'.repeat(24), B = 'b'.repeat(24), C = 'c'.repeat(24);
const present = new Map([[A, { username: 'Ann' }], [B, { username: 'Bob' }], [C, { username: 'Cy' }]]);
const db = { findUserById: async (id) => ({ blockedUsers: id === C ? [A] : [] }) };
const sec = { socketRateLimit: () => true, isValidObjectId: (x) => /^[a-f0-9]{24}$/.test(x) };
const party = createParty({ io, db, sec, presence: { present }, isMuted: async () => false });
const mk = (id) => { const h = {}; const s = { userId: id, id: 's' + id[0], cityJoined: true, on: (e, f) => { h[e] = f; } }; party.attach(s); return (e, d) => new Promise((r) => { const out = h[e](d, r); if (out && out.then) out.then(() => {}); setTimeout(() => r(undefined), 20); }); };
(async () => {
  const a = mk(A), b = mk(B), c = mk(C);
  let r = await a('party:invite', { to: B, type: 'arena' }); ok(r?.ok && r.id, 'invitation créée'); const id = r.id;
  ok(log.some((l) => l.ev === 'party:invited' && l.room === `user:${B}`), 'l’invité reçoit l’invitation');
  r = await c('party:accept', { id }); ok(r?.error, 'un non-invité ne peut pas entrer');
  r = await a('party:invite', { to: C, type: 'arena' }); ok(r?.error === 'Action non autorisée.', 'invitation refusée si C a bloqué A');
  r = await b('party:accept', { id }); ok(r?.ok && r.lobby.members.length === 2, 'B accepte : salon à 2');
  r = await b('party:start', { id, mode: 'tanks' }); ok(r?.error, 'un invité ne peut pas démarrer');
  r = await a('party:start', { id, mode: 'nimporte' }); ok(r?.error, 'mode inconnu refusé');
  log.length = 0; r = await a('party:start', { id, mode: 'tanks' }); const st = log.filter((l) => l.ev === 'party:start');
  ok(r?.ok && st.length === 2 && st[0].p.seed === st[1].p.seed && st[0].p.players.length === 2, 'démarrage : même graine pour tous, 2 joueurs');
  log.length = 0; await b('party:relay', { id, k: 'in', d: { t: 1 } }); ok(log.length === 1 && log[0].room === `user:${A}` && log[0].p.from === B, 'touche invité → hôte uniquement');
  log.length = 0; await a('party:relay', { id, k: 'snap', d: { g: 1 } }); ok(log.length === 1 && log[0].room === `user:${B}`, 'état hôte → invités');
  log.length = 0; await b('party:relay', { id, k: 'snap', d: {} }); ok(log.length === 0, 'un invité ne peut pas diffuser l’état');
  log.length = 0; await a('party:relay', { id, k: 'snap', d: { x: 'y'.repeat(9500) } }); ok(log.length === 0, 'message trop gros ignoré');
  // cinéma
  r = await a('party:invite', { to: C, type: 'cinema', film: { url: 'http://x.com/a.mp4' } }); ok(r?.error, 'le salon d’arène existant bloque un autre type');
  await a('party:leave'); const a2 = mk(A); r = await a2('party:invite', { to: B, type: 'cinema' }); ok(r?.error === 'Choisissez d’abord un film.', 'cinéma : film obligatoire');
  r = await a2('party:invite', { to: B, type: 'cinema', film: { url: 'javascript:alert(1)' } }); ok(r?.error, 'cinéma : lien non-https refusé');
  r = await a2('party:invite', { to: B, type: 'cinema', film: { url: 'https://www.youtube.com/watch?v=AL5cKRIGu0g', title: 'Test <b>x</b>' } }); ok(r?.ok, 'cinéma : invitation avec film https');
  const inv = log.filter((l) => l.ev === 'party:invited').pop(); ok(inv && inv.p.film.title === 'Test bx/b'.replace('bx/b', 'bxb') || inv.p.film.title.indexOf('<') < 0, 'cinéma : titre nettoyé');
  console.log(fails ? fails + ' échec(s)' : 'Tous les tests passent'); process.exit(fails ? 1 : 0);
})();
