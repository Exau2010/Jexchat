// Tests de la géométrie JexCity (sans navigateur) : node city-geo.test.mjs
import * as G from './city-geo.js';
let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.error('ÉCHEC :', msg); } else console.log('ok   :', msg); };

const L = G.buildLayout(7);
ok(L.buildings.length > 100, `bâtiments générés (${L.buildings.length})`);
ok(L.buildings.every((b) => !G.blockedByCanal(b.cx, b.cz)), 'aucun centre de bâtiment dans le canal');

// aucun coin de bâtiment dans l'eau, aucun bâtiment hors de la zone
let bad = 0, outside = 0;
for (const b of L.buildings) {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = b.cx + b.ax[0] * b.hx * sx + b.az[0] * b.hz * sz, z = b.cz + b.ax[1] * b.hx * sx + b.az[1] * b.hz * sz;
    const a = Math.abs(x - G.canalX(z));
    if (a < G.halfW(z) + 4.5 && !(Math.abs(z - G.BRIDGES[0].z) > 100)) bad++; // 5,5 m de quai libre attendus ; tolérance 1 m
    if (x < G.TOWN.x0 || x > G.TOWN.x1 || z < G.TOWN.z0 || z > G.TOWN.z1) outside++;
  }
}
ok(bad === 0, `coins de bâtiments à ≥ 4,5 m du bord du canal (${bad} fautifs)`);
ok(outside === 0, `bâtiments contenus dans la zone ville (${outside} dehors)`);

// chevauchements (même rangée) : séparation SAT simple par cercle englobant réduit
let overlaps = 0;
for (let i = 0; i < L.rects.length; i++) for (let j = i + 1; j < L.rects.length; j++) {
  const a = L.rects[i], b = L.rects[j];
  const dx = b.cx - a.cx, dz = b.cz - a.cz;
  if (Math.hypot(dx, dz) > a.hx + a.hz + b.hx + b.hz) continue;
  // test sur 9 points de b dans a
  for (const u of [-0.8, 0, 0.8]) for (const v of [-0.8, 0, 0.8]) {
    const px = b.cx + b.ax[0] * b.hx * u + b.az[0] * b.hz * v, pz = b.cz + b.ax[1] * b.hx * u + b.az[1] * b.hz * v;
    const lx = (px - a.cx) * a.ax[0] + (pz - a.cz) * a.ax[1], lz = (px - a.cx) * a.az[0] + (pz - a.cz) * a.az[1];
    if (Math.abs(lx) < a.hx - 0.3 && Math.abs(lz) < a.hz - 0.3) overlaps++;
  }
}
ok(overlaps === 0, `pas de bâtiments qui se chevauchent (${overlaps})`);

// ponts : espaces libres
ok(L.rects.every((q) => G.BRIDGES.every((b) => Math.abs(q.cz - b.z) > 5)), 'places dégagées aux abords des ponts');

// relief : raccord aux bords du « trou » de la ville
const edge = [[-64, -100], [64, 0], [0, -240.0001 - 0.0001], [-64, 100], [64, 140]];
ok(edge.every(([x, z]) => Math.abs(G.terrainHeight(x, z) - G.TOWN.quayY) < 0.05 || z < G.TOWN.z0), 'le relief rejoint le sol de la ville (bords est/ouest)');
ok(Math.abs(G.terrainHeight(0, -240) - G.TOWN.quayY) < 0.05, 'raccord au bord nord');
ok(G.terrainHeight(0, 300) < -2, `le lac est creusé (${G.terrainHeight(0, 300).toFixed(1)} m)`);
ok(G.terrainHeight(500, -400) > 20, `des montagnes bordent la vallée (${G.terrainHeight(500, -400).toFixed(0)} m)`);
ok(Math.abs(G.terrainHeight(G.CHATEAU.x, G.CHATEAU.z) - 34) < 0.5, 'plateau du château à 34 m');
ok(G.terrainHeight(G.canalX(152), 152) < 0, 'embouchure du canal sous le niveau de l\'eau');

// déplacements
const sp = G.spawnPoint();
ok(G.isFree(L, sp[0], sp[1]), 'point d\'apparition libre');
ok(!G.isFree(L, G.canalX(0), 0), 'le canal n\'est pas praticable');
ok(G.isFree(L, G.canalX(G.BRIDGES[0].z), G.BRIDGES[0].z), 'le pont est praticable');
ok(G.bridgeY(G.canalX(-30), -30) > 1.9, 'tablier cambré au centre');
const q = L.rects[10];
const fp = G.freePoint(L, q.cx, q.cz);
ok(G.isFree(L, fp[0], fp[1], 0.5), 'un clic sur un bâtiment est ramené à un point libre');

// trajet de l'autre côté du canal : passe par un pont
const from = sp; const other = [G.canalX(-30) - 12, -22];
const path = G.planPath(L, from, other);
ok(path.length === 3, `trajet via pont (${path.length} points)`);
// simulation de marche
let pos = from.slice(), steps = 0;
for (const wp of path) {
  for (let i = 0; i < 4000; i++) {
    const dx = wp[0] - pos[0], dz = wp[1] - pos[1], d = Math.hypot(dx, dz);
    if (d < 0.3) break;
    const s = Math.min(0.1, d);
    pos = G.slideMove(L, pos[0], pos[1], pos[0] + dx / d * s, pos[1] + dz / d * s);
    steps++;
  }
}
const finalD = Math.hypot(pos[0] - path[path.length - 1][0], pos[1] - path[path.length - 1][1]);
ok(finalD < 1.5, `le personnage traverse le canal par le pont (distance restante ${finalD.toFixed(2)} m, ${steps} pas)`);
ok(L.trees.length > 300, `arbres (${L.trees.length})`);

// ─── monde ouvert : sortir de la ville vers les collines et les routes ───
ok(G.isFree(L, 0, -300) && G.isFree(L, 150, -120), 'prairies et colline praticables hors de la ville');
ok(!G.isFree(L, 0, 300) && !G.isFree(L, 0, G.WORLD.z1 + 50), 'le lac et l\'extérieur du monde ne sont pas praticables');
let steep = 0, sampled = 0;
for (let x = -400; x <= 400; x += 10) for (let z = -450; z <= 130; z += 10) { if (G.inTown(x, z)) continue; sampled++; if (G.slopeAt(x, z) >= 0.9 && G.isFree(L, x, z)) steep++; }
ok(steep === 0, `aucune paroi (pente >= 0,9) n'est praticable (${sampled} points testés)`);
for (const r of G.ROADS) ok(r.pts.every(([x, z]) => G.isFree(L, x, z)), `${r.name} : tous les points de passage sont praticables`);
{ // marche réelle de la ville jusqu'au pied de la route du Château
  const dest = G.ROADS[0].pts[1]; const pth = G.planPath(L, sp, dest); let ps = sp.slice(), n = 0, reached = false;
  for (const wp of pth) for (let i = 0; i < 20000; i++) { const dx = wp[0] - ps[0], dz = wp[1] - ps[1], d = Math.hypot(dx, dz); if (d < 0.3) break; const sS = Math.min(0.1, d); ps = G.slideMove(L, ps[0], ps[1], ps[0] + dx / d * sS, ps[1] + dz / d * sS); n++; }
  reached = Math.hypot(ps[0] - dest[0], ps[1] - dest[1]) < 3;
  ok(reached, `marche de la ville vers la route du Château (arrivée à ${Math.hypot(ps[0] - dest[0], ps[1] - dest[1]).toFixed(1)} m, ${n} pas)`);
}
console.log(fails ? `\n${fails} échec(s)` : '\nTous les tests passent');
process.exit(fails ? 1 : 0);
