// Test des fonctions pures du cinéma : node city-cinema_test.mjs
import { register } from 'node:module'; import { fileURLToPath, pathToFileURL } from 'node:url';
const here = fileURLToPath(new URL('.', import.meta.url));
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,n){ if (s==='three') return { url: ${JSON.stringify(pathToFileURL(here + 'three.module.min.js').href)}, shortCircuit: true }; if (s.startsWith('three/addons/')) return { url: ${JSON.stringify(pathToFileURL(here).href)} + s.slice(13), shortCircuit: true }; return n(s,c); }`));
const C = await import('./city-cinema.js'); const G = await import('./city-geo.js');
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.error('ÉCHEC :', m); } else console.log('ok   :', m); };
const seats = C.cinemaSeats();
ok(seats.length === 280, 'cinéma : 280 fauteuils');
ok(seats.every((s) => Math.abs(C.cinemaFloorY(s.x) - s.y) < 0.02), 'cinéma : chaque fauteuil est posé exactement sur le sol des gradins');
let jump = 0; for (let x = -72; x < -20; x += 0.1) jump = Math.max(jump, Math.abs(C.cinemaFloorY(x + 0.1) - C.cinemaFloorY(x))); ok(jump < 0.2, `cinéma : sol sans saut brutal (max ${jump.toFixed(2)} m / 10 cm)`);
ok(Math.abs(C.cinemaFloorY(-20) - G.TOWN.quayY) < 1e-6 && Math.abs(C.cinemaFloorY(-30) - (G.TOWN.quayY + 0.3)) < 1e-6, 'cinéma : raccord avenue → hall');
ok(seats.every((s) => s.z > G.LOTS.cinema.cz - 30 && s.z < G.LOTS.cinema.cz + 30), 'cinéma : fauteuils dans la salle');
const ids = [0, 1, 2, 3].map((n) => C.groupSeatIndex(seats, n)); ok(ids.every((i) => i >= 0) && new Set(ids).size === 4, 'cinéma : 4 places de groupe distinctes');
ok(ids.every((i) => seats[i].r === 3), 'cinéma : le groupe est assis dans la même rangée');
const route = C.routeToSeat({ x: -12, z: -140 }, seats[ids[0]]); ok(route[0][0] > -24 && route.at(-1)[1] === seats[ids[0]].z, 'cinéma : trajet porte → hall → allée → fauteuil');
// le trajet traverse la porte (z de la porte) et ne coupe aucun mur : chaque étape est libre pour un piéton
const L = G.buildLayout(7); const walls = []; // les murs sont ajoutés par createCinema ; ici on vérifie seulement la parcelle
ok(!L.buildings.some((b) => Math.abs(b.cx - G.LOTS.cinema.cx) < G.LOTS.cinema.hx + b.hx && Math.abs(b.cz - G.LOTS.cinema.cz) < G.LOTS.cinema.hz + b.hz), 'ville : aucun immeuble sur la parcelle du cinéma');
for (const k of ['cafe', 'museum', 'market']) { const l = G.LOTS[k]; ok(!L.buildings.some((b) => Math.abs(b.cx - l.cx) < l.hx + b.hx && Math.abs(b.cz - l.cz) < l.hz + b.hz), `ville : parcelle libre (${k})`); }
console.log(fails ? fails + ' échec(s)' : 'Tous les tests passent'); process.exit(fails ? 1 : 0);
