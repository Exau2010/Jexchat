// Test du décor 3D (modèles GLB) : node city-props_test.mjs   — sans navigateur ni dépendance (three.js local, DOM simulé).
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = fileURLToPath(new URL('.', import.meta.url));
// « three » → le fichier three.module.min.js du projet (comme l'importmap de city.html)
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,n){ if (s==='three') return { url: ${JSON.stringify(pathToFileURL(here + 'three.module.min.js').href)}, shortCircuit: true }; return n(s,c); }`));
globalThis.self = globalThis; globalThis.createImageBitmap = async () => ({ width: 4, height: 4, close() {} }); // décodage d'image simulé (le GLB de la voiture contient des textures)
const store = new Map(); // faux navigateur minimal
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
const hud = { kids: [], append(e) { this.kids.push(e); } };
globalThis.document = { createElement: () => ({ classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); } }, setAttribute() {}, offsetWidth: 0, textContent: '' }), getElementById: (id) => (id === 'hud' ? hud : null) };
Object.defineProperty(globalThis, 'navigator', { value: { vibrate() {}, userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/130 Safari/537.36' }, configurable: true });
const THREE = await import('three'); const G = await import('./city-geo.js'); const P = await import('./city-props.js');
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.error('ÉCHEC :', m); } else console.log('ok   :', m); };
const glb = readFileSync(here + 'city-props.glb'); const ab = glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength);
const layout = G.buildLayout(7), scene = new THREE.Scene(), toasts = [], me = { x: 0, z: 0 };
let t0 = performance.now();
const car = readFileSync(here + 'city-car.glb'); const carAb = car.buffer.slice(car.byteOffset, car.byteOffset + car.byteLength);
const props = await P.createProps({ scene, layout, tier: { name: 'high' }, getPlayer: () => me, toast: (x) => toasts.push(x), glb: ab, carGlb: carAb });
console.log(`     chargement + analyse du GLB : ${(performance.now() - t0).toFixed(0)} ms (${(glb.length / 1024).toFixed(0)} Ko)`);
ok(['truck-red', 'moto', 'truck-yellow', 'truck-green', 'truck-purple'].length === props.vehicles.length, `${props.vehicles.length} véhicules créés`);
// appels de dessin et triangles
let calls = 0, tris = 0; props.root.traverse((o) => { if (o.isMesh) { calls++; const g = o.geometry, n = (g.index ? g.index.count : g.attributes.position.count) / 3; tris += o.isInstancedMesh ? n * o.count : n; } });
ok(calls <= 12, `${calls} appels de dessin au maximum (arches, véhicules, 2 arbres instanciés, pièces)`);
console.log(`     ≈ ${Math.round(tris / 1000)} k triangles au total (ville entière : plusieurs centaines de milliers possibles)`);
const mats = new Set(); props.root.traverse((o) => { if (o.isMesh) mats.add(o.material); }); ok(mats.size <= 2, `${mats.size} matériaux seulement, 0 texture`);
let tex = 0; props.root.traverse((o) => { if (o.isMesh && o.material.map) tex++; }); ok(tex === 0, 'aucune texture à envoyer à la carte graphique');
// voiture réaliste (chargée à part)
t0 = performance.now(); await props.carReady; const hero = props.vehicles.find((x) => x.hero);
ok(!!hero, `voiture réaliste chargée (${(car.length / 1024).toFixed(0)} Ko, ${(performance.now() - t0).toFixed(0)} ms)`);
{ let ct = 0, cm = 0; hero?.mesh.traverse((o) => { if (o.isMesh) { cm++; ct += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; } });
  ok(ct > 15000 && ct < 40000 && cm <= 40, `voiture : ${Math.round(ct)} triangles, ${cm} maillages`);
  const bb = new THREE.Box3().setFromObject(hero.mesh, true); ok(Math.abs(bb.min.y) < 0.05 && bb.max.z - bb.min.z > 4 && bb.max.z - bb.min.z < 5, `voiture posée au sol, longueur ${(bb.max.z - bb.min.z).toFixed(2)} m`); }
// pièces
const sp = props.coins.spots;
ok(sp.length === 28 && sp.every(([x, z]) => G.isFree(layout, x, z, 0.2) || G.terrainWalkable?.(x, z)), '28 pièces, toutes sur un point où l’on peut marcher');
ok(new Set(sp.map((p) => p.map((v) => Math.round(v / 3)).join())).size >= 24, 'pièces bien réparties (pas empilées)');
// images : coût par image
const cam = { x: 0, y: 5, z: 0 }; me.x = 500; me.z = 500;
for (let i = 0; i < 30; i++) props.update(1 / 60, i / 60, cam); // chauffe
t0 = performance.now(); for (let i = 0; i < 600; i++) props.update(1 / 60, 1 + i / 60, cam); const per = (performance.now() - t0) / 600;
ok(per < 0.5, `mise à jour par image : ${(per * 1000).toFixed(0)} µs (budget d'une image à 60 i/s : 16 000 µs)`);
// véhicule : s'arrête devant le joueur puis repart
const v = props.vehicles[0]; v.cur = v.base; const pos = P.roadAt(v.road, v.s); me.x = pos.x; me.z = pos.z; cam.x = pos.x; cam.z = pos.z;
for (let i = 0; i < 240; i++) props.update(1 / 60, 20 + i / 60, cam); ok(v.cur < 0.3, `le véhicule s'arrête devant le joueur (vitesse ${v.cur.toFixed(2)} m/s)`);
me.x = 600; me.z = 600; for (let i = 0; i < 300; i++) props.update(1 / 60, 30 + i / 60, cam); ok(v.cur > v.base * 0.7, `… puis repart quand la route est libre (${v.cur.toFixed(1)} m/s)`);
// orientation : le nez du véhicule regarde dans le sens de la marche
{ const m = v.mesh, fwd = new THREE.Vector3(0, 0, 1).applyEuler(m.rotation), p0 = m.position.clone(); props.update(1 / 60, 40, cam); const mv = m.position.clone().sub(p0).setY(0).normalize(); ok(fwd.setY(0).normalize().dot(mv) > 0.85, 'le véhicule roule dans le sens où il pointe'); }
// pièces : ramassage, compteur, mémoire, nouveau jour
const chip = hud.kids[0]; ok(/0\/28/.test(chip.textContent), 'compteur affiché : ' + chip.textContent);
me.x = sp[3][0]; me.z = sp[3][1]; props.update(1 / 60, 50, cam);
ok(props.coins.got.has(3) && /1\/28/.test(chip.textContent) && toasts.some((t) => /\+1/.test(t)), 'pièce ramassée : compteur et message mis à jour');
ok(JSON.parse(store.get('jexcity.coins')).got.includes(3), 'pièces mémorisées sur l’appareil (rien envoyé au serveur)');
props.update(1 / 60, 51, cam); ok(props.coins.got.size === 1, 'une pièce ne se ramasse qu’une fois');
me.x = 600; me.z = 600; const RealDate = Date; globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [RealDate.now() + 86400000])); } static now() { return RealDate.now() + 86400000; } };
props.update(1 / 60, 52, cam); globalThis.Date = RealDate; ok(props.coins.got.size === 0 && /0\/28/.test(chip.textContent), 'le lendemain, les pièces réapparaissent');
// niveaux de qualité
props.setTier({ name: 'low' }); props.update(1 / 60, 59, cam); ok(!hero.mesh.visible, 'niveau bas : la voiture réaliste n’est pas affichée'); const lowTrees = props.root.children.filter((o) => o.isInstancedMesh && o.geometry === o.geometry && o.count !== undefined).map((o) => o.count).filter((n) => n !== 28);
ok(lowTrees.every((n) => n === 0), 'niveau bas : aucun arbre supplémentaire'); props.update(1 / 60, 60, cam);
ok(props.vehicles.filter((x) => x.mesh.visible).length <= 2, 'niveau bas : 2 véhicules au plus (aucun si loin de la caméra)');
console.log(fails ? `\n${fails} échec(s)` : '\nTous les tests passent'); process.exit(fails ? 1 : 0);
