// city-props.js — JexCity : décor 3D chargé EN ARRIÈRE-PLAN après l'affichage de la ville (jamais pendant le démarrage).
// Modèles : city-props.glb (un seul fichier de ~250 Ko, ~100 Ko compressé), tirés des kits Kenney (licence MIT) :
//   - couleurs dans les sommets, AUCUNE texture (rien à décoder, rien à envoyer à la carte graphique) ;
//   - un matériau partagé, instances pour les arbres et les pièces : moins de 10 appels de dessin au total.
// Contenu : camions et moto qui roulent sur les routes de campagne (ils s'arrêtent si vous êtes sur la route),
// arbres le long des routes, arches de départ, et pièces cachées à ramasser (renouvelées chaque jour, mémorisées sur l'appareil).
import * as THREE from 'three';
import * as G from './city-geo.js';

const s2l = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)); // les couleurs d'origine sont en sRGB
export const COINS = 28;
const VEHICLE_SET = ['truck-red', 'moto', 'truck-yellow', 'truck-green', 'truck-purple'];
const PER_TIER = { low: { vehicles: 2, trees: 0, hero: false }, mid: { vehicles: 3, trees: 50, hero: true }, high: { vehicles: 5, trees: 90, hero: true } };

function lcg(seed) { let a = seed >>> 0; return () => { a = (Math.imul(a, 1664525) + 1013904223) >>> 0; return a / 4294967296; }; }
const today = () => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };

// Une route = polyligne avec abscisses cumulées ; position et direction à l'abscisse s.
export function makeRoad(pts) {
  const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return { pts, cum, len: cum[cum.length - 1] };
}
export function roadAt(road, s) {
  s = Math.min(road.len, Math.max(0, s)); let i = 1; while (i < road.pts.length - 1 && road.cum[i] < s) i++;
  const a = road.pts[i - 1], b = road.pts[i], k = (s - road.cum[i - 1]) / Math.max(1e-6, road.cum[i] - road.cum[i - 1]), L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return { x: a[0] + (b[0] - a[0]) * k, z: a[1] + (b[1] - a[1]) * k, dx: (b[0] - a[0]) / L, dz: (b[1] - a[1]) / L };
}

// Emplacements des pièces : déterministes, toujours sur un point libre (quais, routes, château, lac, collines).
export function coinSpots(layout, n = COINS) {
  const R = lcg(20261018), spots = [];
  for (let z = -205, k = 0; z <= 125 && spots.length < 10; z += 33, k++) { const f = G.frame(z), o = (k % 2 ? -1 : 1) * (G.halfW(z) + 2.6); spots.push([f.p[0] + f.n[0] * o, z + f.n[1] * o]); }
  for (const r of G.ROADS) { const road = makeRoad(r.pts); for (let k = 1; k <= 6; k++) { const p = roadAt(road, (road.len * k) / 7); spots.push([p.x + p.dz * (R() - 0.5) * 1.6, p.z - p.dx * (R() - 0.5) * 1.6]); } }
  spots.push([G.CHATEAU.x + 11, G.CHATEAU.z + 3], [G.CHATEAU.x - 9, G.CHATEAU.z - 8], [30, 150], [-25, 148]);
  while (spots.length < n) spots.push([120 + R() * 250, -40 - R() * 260]);
  return spots.slice(0, n).map(([x, z]) => G.freePoint(layout, x, z));
}

export async function createProps({ scene, layout, tier, getPlayer, toast = () => {}, glb, carGlb }) {
  const buf = glb || (await (await fetch('/city-props.glb', { credentials: 'same-origin' })).arrayBuffer());
  const { GLTFLoader } = await import('./GLTFLoader.js');
  const gltf = await new GLTFLoader().parseAsync(buf, '');
  const geos = {};
  gltf.scene.traverse((o) => { if (o.isMesh) geos[o.name] = o.geometry; });
  for (const g of Object.values(geos)) { // couleurs sRGB → linéaire (une seule fois, ~15 000 sommets)
    const a = g.attributes.color; if (!a) continue; const f = new Float32Array(a.count * 3);
    for (let i = 0; i < a.count; i++) { f[i * 3] = s2l(a.getX(i)); f[i * 3 + 1] = s2l(a.getY(i)); f[i * 3 + 2] = s2l(a.getZ(i)); }
    g.setAttribute('color', new THREE.BufferAttribute(f, 3));
  }
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85, metalness: 0 });
  const coinMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.35, metalness: 0.2, emissive: new THREE.Color('#ffb300'), emissiveIntensity: 0.22 });
  const root = new THREE.Group(); root.name = 'city-props'; scene.add(root);
  const roads = G.ROADS.map((r) => makeRoad(r.pts));
  let level = PER_TIER[tier.name] || PER_TIER.mid;

  // ── Arches de départ ──
  roads.forEach((road) => {
    if (!geos.arch) return; const p = roadAt(road, 4), m = new THREE.Mesh(geos.arch, mat);
    m.position.set(p.x, G.groundY(p.x, p.z), p.z); m.rotation.y = Math.atan2(p.dx, p.dz); root.add(m);
  });

  // ── Véhicules : un seul maillage chacun, mis à jour seulement s'ils sont proches ──
  const vehicles = VEHICLE_SET.filter((k) => geos[k]).map((k, i) => {
    const mesh = new THREE.Mesh(geos[k], mat); mesh.rotation.order = 'YXZ'; mesh.visible = false; root.add(mesh);
    const road = roads[i % roads.length], base = k === 'moto' ? 10 : 6.5 + (i % 3);
    return { mesh, road, s: (road.len * (0.15 + 0.3 * ((i * 0.37) % 1))), dir: i % 2 ? -1 : 1, base, cur: base, yaw: 0, moto: k === 'moto' };
  });
  const pitchAt = (road, s, dir) => { const a = roadAt(road, s - 1.4), b = roadAt(road, s + 1.4); return Math.atan2((G.groundY(b.x, b.z) - G.groundY(a.x, a.z)) * dir, 2.8); };
  function updateVehicles(dt, cam, pl) {
    vehicles.forEach((v, i) => {
      const on = v.hero ? level.hero : i < level.vehicles; if (!on) { v.mesh.visible = false; return; }
      const p = roadAt(v.road, v.s), dPl = pl ? Math.hypot(pl.x - p.x, pl.z - p.z) : 99;
      const target = dPl < 9 ? 0 : v.base; v.cur += (target - v.cur) * Math.min(1, dt * (target ? 1.1 : 3.2)); // s'arrête devant vous, repart ensuite
      v.s += v.dir * v.cur * dt; if (v.s >= v.road.len) { v.s = v.road.len; v.dir = -1; } else if (v.s <= 0) { v.s = 0; v.dir = 1; }
      const q = roadAt(v.road, v.s), near = Math.hypot(cam.x - q.x, cam.z - q.z) < 320; v.mesh.visible = near; if (!near) return;
      const fx = q.dx * v.dir, fz = q.dz * v.dir, x = q.x - fz * 0.8, z = q.z + fx * 0.8; // on roule à droite : les deux sens se croisent
      let d = Math.atan2(fx, fz) - v.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); v.yaw += d * Math.min(1, dt * 4);
      v.mesh.position.set(x, G.groundY(x, z) + 0.04, z); v.mesh.rotation.set(-pitchAt(v.road, v.s, v.dir), v.yaw, 0);
    });
  }

  // ── Voiture réaliste (matériaux PBR, 27 000 triangles, textures WebP ≤ 1024) : modèle CC0 « Free concept car » via Khronos, allégé avec Blender ──
  // Chargée à part, après le reste : si elle échoue, tout le décor fonctionne quand même.
  const carReady = (async () => {
    try {
      const cb = carGlb || (await (await fetch('/city-car.glb', { credentials: 'same-origin' })).arrayBuffer());
      const model = (await new GLTFLoader().parseAsync(cb, '')).scene, box = new THREE.Box3().setFromObject(model, true); // précis : certains maillages fusionnés ont une rotation
      model.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2); // roues au sol, centrée
      model.traverse((o) => { if (o.isMesh && o.material) { o.material.envMapIntensity = 1.0; } });
      const wrap = new THREE.Group(); wrap.rotation.order = 'YXZ'; wrap.visible = false; wrap.add(model); root.add(wrap);
      const road = roads[0]; vehicles.push({ mesh: wrap, road, s: road.len * 0.55, dir: -1, base: 10.5, cur: 10.5, yaw: 0, moto: false, hero: true });
    } catch (e) { console.warn('[JexCity] voiture réaliste indisponible', e); }
  })();

  // ── Arbres le long des routes (instances) ──
  const treeMeshes = [];
  const maxTrees = PER_TIER.high.trees;
  if (geos['tree-a'] && geos['tree-b']) {
    const R = lcg(777), spots = [];
    for (const road of roads) for (let s = 12; s < road.len - 6 && spots.length < maxTrees; s += 13 + R() * 9) { const p = roadAt(road, s), side = R() < 0.5 ? -1 : 1, o = side * (4 + R() * 6); spots.push([p.x - p.dz * o, p.z + p.dx * o, R()]); }
    const A = spots.filter((_, i) => i % 2 === 0), B = spots.filter((_, i) => i % 2 === 1), d = new THREE.Object3D(), col = new THREE.Color();
    [['tree-a', A], ['tree-b', B]].forEach(([k, list]) => {
      const im = new THREE.InstancedMesh(geos[k], mat, Math.max(1, list.length)); im.count = list.length;
      list.forEach(([x, z, r], i) => { const sc = 0.8 + r * 0.6; d.position.set(x, G.groundY(x, z) - 0.05, z); d.rotation.set(0, r * 40, 0); d.scale.setScalar(sc); d.updateMatrix(); im.setMatrixAt(i, d.matrix); im.setColorAt(i, col.setScalar(0.85 + r * 0.25)); });
      im.instanceMatrix.needsUpdate = true; root.add(im); treeMeshes.push({ im, total: list.length });
    });
  }
  const applyTrees = () => { for (const t of treeMeshes) { const n = Math.round((t.total * level.trees) / maxTrees); t.im.count = Math.min(t.total, n); t.im.visible = t.im.count > 0; } };
  applyTrees();

  // ── Pièces cachées ──
  const spots = coinSpots(layout), coinIM = new THREE.InstancedMesh(geos.coin, coinMat, COINS), dummy = new THREE.Object3D();
  let state = (() => { try { const s = JSON.parse(localStorage.getItem('jexcity.coins')); if (s && s.day === today() && Array.isArray(s.got)) return s; } catch (_) { /* première fois */ } return { day: today(), got: [] }; })();
  const got = new Set(state.got), ys = spots.map(([x, z]) => G.groundY(x, z) + 1.0);
  coinIM.frustumCulled = false; root.add(coinIM);
  const chip = document.createElement('div'); chip.id = 'coin-chip'; chip.setAttribute('role', 'status'); document.getElementById('hud')?.append(chip);
  const drawChip = () => { chip.textContent = `🪙 ${got.size}/${COINS}`; chip.setAttribute('aria-label', `${got.size} pièces sur ${COINS} aujourd’hui`); };
  drawChip();
  const save = () => { try { localStorage.setItem('jexcity.coins', JSON.stringify({ day: state.day, got: [...got] })); } catch (_) { /* stockage indisponible : non bloquant */ } };
  function collect(i) {
    got.add(i); save(); drawChip(); chip.classList.remove('pop'); void chip.offsetWidth; chip.classList.add('pop'); try { navigator.vibrate?.(15); } catch (_) { /* ignoré */ }
    toast(got.size === COINS ? '🪙 Toutes les pièces du jour ! Revenez demain.' : `🪙 +1 pièce (${got.size}/${COINS})`);
  }
  function updateCoins(t, cam, pl) {
    if (today() !== state.day) { state = { day: today(), got: [] }; got.clear(); save(); drawChip(); } // nouvelle journée : tout réapparaît
    for (let i = 0; i < COINS; i++) {
      const [x, z] = spots[i];
      if (got.has(i)) { dummy.scale.setScalar(0); dummy.position.set(x, ys[i], z); }
      else {
        if (pl && Math.abs(pl.x - x) < 1.5 && Math.abs(pl.z - z) < 1.5) { collect(i); dummy.scale.setScalar(0); }
        else dummy.scale.setScalar(1);
        dummy.position.set(x, ys[i] + Math.sin(t * 2.2 + i) * 0.12, z); dummy.rotation.set(0, t * 2 + i, 0);
      }
      dummy.updateMatrix(); coinIM.setMatrixAt(i, dummy.matrix);
    }
    coinIM.instanceMatrix.needsUpdate = true;
  }
  if (!localStorage.getItem('jexcity.coins.intro')) { setTimeout(() => toast(`🪙 ${COINS} pièces sont cachées en ville et sur les collines. Elles reviennent chaque jour !`), 5000); try { localStorage.setItem('jexcity.coins.intro', '1'); } catch (_) { /* ignoré */ } }

  return {
    update(dt, t, cam) { const pl = getPlayer?.(); updateVehicles(dt, cam, pl); updateCoins(t, cam, pl); },
    setTier(t) { level = PER_TIER[t.name] || PER_TIER.mid; applyTrees(); },
    coins: { total: COINS, got, spots }, vehicles, root, carReady,
  };
}
