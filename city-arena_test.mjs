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
console.log(fails ? fails + ' échec(s)' : 'Tous les tests passent'); process.exit(fails ? 1 : 0);
