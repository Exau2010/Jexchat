// Test de la logique des mini-jeux : node city-arena_test.mjs (sans navigateur ; three.js n'est pas nécessaire pour la logique)
import { register } from 'node:module'; import { fileURLToPath, pathToFileURL } from 'node:url';
const here = fileURLToPath(new URL('.', import.meta.url));
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,n){ if (s==='three') return { url: ${JSON.stringify(pathToFileURL(here + 'three.module.min.js').href)}, shortCircuit: true }; return n(s,c); }`));
const A = await import('./city-arena.js');
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.error('ÉCHEC :', m); } else console.log('ok   :', m); };
// Course : 4 robots finissent, classement cohérent, un joueur qui ne saute jamais est ralenti par les haies
const c = A.makeCourse(4, 7); c.players.forEach((p) => { p.bot = true; });
for (let i = 0; i < 4000 && !c.done; i++) A.stepCourse(c, 1 / 60, []);
ok(c.done && c.players.every((p) => p.t != null), 'course : les 4 robots franchissent l’arrivée');
const r = A.ranking(c); ok(r[0].t <= r[3].t, 'course : classement trié par temps');
const d = A.makeCourse(2, 7); d.players[0].bot = true; for (let i = 0; i < 4000 && !d.done; i++) A.stepCourse(d, 1 / 60, []);
ok(d.players[1].t == null || d.players[1].t > d.players[0].t + 2, 'course : sans saut, on perd (haies)');
ok(d.players.every((p) => p.x <= 110.001), 'course : jamais au-delà de l’arrivée');
// Sumo : 4 robots → un vainqueur, plateforme qui rétrécit
const s = A.makeSumo(4); s.players.forEach((p) => { p.bot = true; });
for (let i = 0; i < 60 * 80 && !s.done; i++) A.stepSumo(s, 1 / 60, []);
ok(s.done, 'sumo : la manche se termine'); ok(s.radius < 7, 'sumo : la plateforme rétrécit');
ok(s.players.filter((p) => p.alive).length <= 1, 'sumo : au plus un survivant');
const s2 = A.makeSumo(2); for (let i = 0; i < 60 * 3; i++) A.stepSumo(s2, 1 / 60, []); ok(s2.players.every((p) => p.alive), 'sumo : sans action, personne ne tombe en 3 s');
const s3 = A.makeSumo(2); s3.players[0].x = 0; s3.players[0].z = 0; s3.players[1].x = 0.5; s3.players[1].z = 0; s3.players[0].head = 0; A.stepSumo(s3, 1 / 60, [true]);
ok(s3.players[1].vx > 0 || s3.players[1].x > 0.5, 'sumo : un élan pousse l’adversaire');
// Balai : 4 robots → une manche se termine, un seul survivant ; sans saut on est touché ; un saut bien placé évite le bras
const w = A.makeSweep(4); w.players.forEach((p) => { p.bot = true; });
for (let i = 0; i < 60 * 120 && !w.done; i++) A.stepSweep(w, 1 / 60, []);
ok(w.done, 'balai : la manche se termine'); ok(w.players.filter((p) => p.alive).length <= 1, 'balai : au plus un survivant');
const w2 = A.makeSweep(2); w2.players[0].bot = true; for (let i = 0; i < 60 * 30 && w2.players[1].alive; i++) A.stepSweep(w2, 1 / 60, []);
ok(!w2.players[1].alive, 'balai : sans sauter, le bras vous touche');
// Chars : 4 robots → un vainqeur ou nul, obus bornés ; sans tir on ne gagne pas
const tk = A.makeTanks(4); tk.players.forEach((p) => { p.bot = true; }); for (let i = 0; i < 60 * 90 && !tk.done; i++) A.stepTanks(tk, 1 / 60, []);
ok(tk.done, 'chars : la manche se termine'); ok(tk.bullets.every((b) => Math.abs(b.x) <= 10.1 && Math.abs(b.z) <= 6.1), 'chars : obus dans l’arène'); ok(tk.players.every((p) => Math.abs(p.x) <= 10 && Math.abs(p.z) <= 6), 'chars : chars dans l’arène');
const tk2 = A.makeTanks(2); tk2.players[0].a = 0; tk2.players[0].x = -5; tk2.players[0].z = 3; tk2.players[1].x = 5; tk2.players[1].z = 3; tk2.players[1].h = 0; A.stepTanks(tk2, 1 / 60, [true]); ok(tk2.bullets.length === 1, 'chars : une touche tire un obus');
// Football : 4 robots → des buts, fin de match ; un tir proche envoie la balle vers le but adverse
const fb = A.makeFootball(4); fb.players.forEach((p) => { p.bot = true; }); for (let i = 0; i < 60 * 100 && !fb.done; i++) A.stepFootball(fb, 1 / 60, []);
ok(fb.done, 'football : le match se termine'); ok(Math.abs(fb.ball.z) <= 7 && Math.abs(fb.ball.x) <= 12.5, 'football : balle sur le terrain');
const f2 = A.makeFootball(2); f2.pause = 0; f2.ball = { x: -3, z: 0, vx: 0, vz: 0 }; f2.players[0].x = -3.5; f2.players[0].z = 0; A.stepFootball(f2, 1 / 60, [true]); ok(f2.ball.vx > 5, 'football : le tir part vers le but adverse');
// Peinture : cases peintes, un joueur qui ne tourne jamais finit par repeindre ; décompte cohérent
const pt = A.makePaint(4); pt.players.forEach((p) => { p.bot = true; }); for (let i = 0; i < 60 * 50 && !pt.done; i++) A.stepPaint(pt, 1 / 60, []);
ok(pt.done && pt.counts.reduce((a, b) => a + b, 0) === pt.grid.split('').filter((c) => c !== '.').length, 'peinture : décompte cohérent'); ok(pt.counts.every((c) => c > 0), 'peinture : chacun a peint');
// Instantané réseau : aller-retour sans perte de l’état et plus léger que la limite serveur (9000)
const sn = A.snapshot(tk); ok(JSON.stringify(sn).length < 9000, 'réseau : instantané < 9 ko'); const cc = A.makeCourse(4, 3); const s0 = A.snapshot(cc); ok(!('hurdles' in s0), 'réseau : haies non envoyées'); A.applySnapshot(cc, { time: 5 }); ok(cc.time === 5 && cc.hurdles.length > 3, 'réseau : l’instantané se superpose');
for (const m of ['sumo', 'sweep', 'paint', 'football', 'tanks']) ok(JSON.stringify(A.snapshot(A.MAKERS[m](4, 1))).length < 9000, 'réseau : ' + m + ' < 9 ko');
console.log(fails ? fails + ' échec(s)' : 'Tous les tests passent'); process.exit(fails ? 1 : 0);
