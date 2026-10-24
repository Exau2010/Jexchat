// city-drive.js — JexCity : voitures garées (modèles réalistes), palmiers et buissons, et CONDUITE par le joueur.
//  • Chargé en arrière-plan ~4 s après l'affichage de la ville (jamais pendant le démarrage) ; si le chargement échoue, la ville reste inchangée.
//  • Modèles : city-vehicles.glb (9 voitures de 3 400 à 6 500 triangles + palmier + buisson, une seule texture WebP 1024) et city-truck.glb
//    (tout-terrain à chenilles, 25 000 triangles, texture WebP 1024). Un matériau partagé par les voitures : 1 appel de dessin par voiture.
//  • Arbres : INSTANCES (2 appels de dessin au total) ; nombre selon la qualité (aucun en mode « léger »).
//  • Conduite : s'approcher d'une voiture → bouton « Conduire » (ou toucher la voiture, ou touche E). Pédales et volant tactiles, ZQSD / flèches au clavier,
//    espace = frein à main. Collisions avec les bâtiments, arbres et voitures garées (mêmes règles que le piéton) ; la voiture ne peut pas entrer dans les salles.
//  • Les autres joueurs voient votre personnage se déplacer (pas la voiture : la synchronisation des véhicules n'existe pas).
import * as THREE from 'three';
import * as G from './city-geo.js';

const CAR_IDS = ['g2', 'g5', 'g10', 'g11', 'g12', 'g16', 'g18', 'g19', 'g23']; // voitures retenues de la planche
const CAR_LEN = 4.5;                 // longueur finale d'une voiture (m)
const TRUCK_LEN = 5.4;
const PER_TIER = { low: { cars: 4, palms: 0, bushes: 0 }, mid: { cars: 7, palms: 26, bushes: 12 }, high: { cars: 9, palms: 44, bushes: 22 } };
const ENTER_DIST = 6.5;
const KMH = 3.6;
const CSS = `
body.driving #mood-chip,body.driving #campad,body.driving #hint{display:none!important}
#drive-enter{position:absolute;left:50%;transform:translateX(-50%);bottom:calc(var(--sab,0px) + 108px);height:46px;padding:0 20px;border-radius:23px;border:1px solid var(--line,#fff3);background:var(--acc,#f0b463);color:#2a1d08;font:700 16px system-ui,sans-serif;cursor:pointer;box-shadow:0 4px 16px #0006;display:none;z-index:12}
#drive-enter.on{display:block}
#hud>#drive-ui{position:absolute;inset:0;pointer-events:none;display:none}
body.driving #hud>#drive-ui{display:block}
#drive-ui>*{pointer-events:auto}
#drive-top{position:absolute;top:calc(var(--sat,0px) + 62px);left:50%;transform:translateX(-50%);display:flex;gap:8px;align-items:center}
#drive-speed{min-width:92px;height:38px;padding:0 14px;border-radius:19px;display:grid;place-items:center;background:var(--glass,#0008);border:1px solid var(--line,#fff3);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);font:700 15px system-ui,sans-serif;color:var(--txt,#fff)}
#drive-exit{height:38px;padding:0 16px;border-radius:19px;border:1px solid var(--line,#fff3);background:var(--acc,#f0b463);color:#2a1d08;font:700 14px system-ui,sans-serif;cursor:pointer}
.dpad{position:absolute;border-radius:50%;border:1px solid var(--line,#fff3);background:var(--glass,#0008);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);color:var(--txt,#fff);font:700 26px system-ui,sans-serif;display:grid;place-items:center;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;cursor:pointer}
.dpad.on{background:var(--acc,#f0b463);color:#2a1d08}
#dp-l{left:calc(var(--sal,0px) + 14px);bottom:calc(var(--sab,0px) + 24px);width:78px;height:78px}
#dp-r{left:calc(var(--sal,0px) + 104px);bottom:calc(var(--sab,0px) + 24px);width:78px;height:78px}
#dp-g{right:calc(var(--sar,0px) + 16px);bottom:calc(var(--sab,0px) + 44px);width:92px;height:92px;font-size:15px}
#dp-b{right:calc(var(--sar,0px) + 118px);bottom:calc(var(--sab,0px) + 24px);width:68px;height:68px;font-size:13px}
`;

const lcg = (seed) => { let a = seed >>> 0; return () => { a = (Math.imul(a, 1664525) + 1013904223) >>> 0; return a / 4294967296; }; };
const wrapAng = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const inFloor = (x, z) => G.FLOORS.some((f) => x >= f.x0 - 0.5 && x <= f.x1 + 0.5 && z >= f.z0 - 0.5 && z <= f.z1 + 0.5); // salles intérieures : interdites aux voitures
const mkRect = (cx, cz, hx, hz, yaw, h) => ({ cx, cz, hx, hz, ax: [Math.cos(yaw), -Math.sin(yaw)], az: [Math.sin(yaw), Math.cos(yaw)], h });

export async function createDrive({ scene, root, layout, pickables, tier, player, controls, social, hud, setAvatarVisible, getBusy = () => false, toast = () => {} }) {
  const loadBuf = async (u) => (await fetch(u, { credentials: 'same-origin' })).arrayBuffer();
  const { GLTFLoader } = await import('./GLTFLoader.js');
  const loader = new GLTFLoader();
  const [vb, tb] = await Promise.all([loadBuf('/city-vehicles.glb'), loadBuf('/city-truck.glb').catch(() => null)]);
  const vg = await loader.parseAsync(vb, '');
  const parts = {}; vg.scene.children.forEach((o) => { parts[o.name] = o; });
  const group = new THREE.Group(); group.name = 'city-drive'; root.add(group);
  let level = PER_TIER[tier.name] || PER_TIER.mid;

  // ── Voitures : échelle pour 4,5 m de long, avant vers +z, roues au sol (le pivot est déjà au centre/sol dans le fichier) ──
  const defs = [];
  for (const id of CAR_IDS) {
    const m = parts[id]; if (!m || !m.isMesh) continue;
    m.geometry.computeBoundingBox(); const b = m.geometry.boundingBox, len = b.max.z - b.min.z, s = CAR_LEN / len;
    defs.push({ mesh: m, scale: s, hl: (CAR_LEN / 2) * 0.96, hw: ((b.max.x - b.min.x) * s) / 2 });
  }
  let truckDef = null;
  if (tb) {
    try {
      const t = (await loader.parseAsync(tb, '')).scene, box = new THREE.Box3().setFromObject(t, true), sz = box.getSize(new THREE.Vector3());
      const wrap = new THREE.Group(), s = TRUCK_LEN / Math.max(sz.x, sz.z);
      t.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2); // roues/chenilles au sol, centré
      const pivot = new THREE.Group(); pivot.add(t); pivot.rotation.y = sz.x > sz.z ? TRUCK_FRONT_SIGN() * Math.PI / 2 : 0; // longueur le long de z, avant vers +z
      wrap.add(pivot); wrap.scale.setScalar(s);
      truckDef = { obj: wrap, scale: s, hl: (Math.max(sz.x, sz.z) * s) / 2 * 0.96, hw: (Math.min(sz.x, sz.z) * s) / 2, truck: true };
    } catch (e) { console.warn('[JexCity] tout-terrain indisponible', e); }
  }
  function TRUCK_FRONT_SIGN() { return -1; }

  // ── Emplacements : bord de la Grande Avenue, face au sens de circulation (à droite), triés par distance au point d'arrivée ──
  const sp = G.spawnPoint();
  const fitsAt = (x, z, yaw, hl, hw) => { // la voiture entière tient sur un terrain libre
    const f = [Math.sin(yaw), Math.cos(yaw)], r = [Math.cos(yaw), -Math.sin(yaw)];
    for (const a of [-1, -0.5, 0, 0.5, 1]) for (const c of [-1, 0, 1]) {
      const px = x + f[0] * hl * a + r[0] * hw * c, pz = z + f[1] * hl * a + r[1] * hw * c;
      if (!G.isFree(layout, px, pz, 0.3) || inFloor(px, pz)) return false;
    }
    return true;
  };
  const cand = [];
  for (let z = 134; z > G.TOWN.z0 + 20; z -= 5) for (const side of [-1, 1]) {
    if (G.STREETS.some((s) => Math.abs(z - s) < 12)) continue; // pas dans les carrefours
    cand.push({ x: side * (G.AV - 2.6), z, yaw: side > 0 ? Math.PI : 0 });
  }
  cand.sort((a, b) => Math.hypot(a.x - sp[0], a.z - sp[1]) - Math.hypot(b.x - sp[0], b.z - sp[1]));
  const all = truckDef ? [truckDef, ...defs] : defs.slice();
  const cars = []; // { def, obj, x, z, yaw, rect, … }
  for (const d of all) {
    const spot = cand.find((c) => Math.hypot(c.x - sp[0], c.z - sp[1]) > 7 && cars.every((o) => Math.hypot(o.x - c.x, o.z - c.z) > 13) && fitsAt(c.x, c.z, c.yaw, d.hl, d.hw));
    if (!spot) continue;
    const obj = d.truck ? d.obj : d.mesh; if (!d.truck) obj.scale.setScalar(d.scale);
    obj.position.set(spot.x, G.groundY(spot.x, spot.z) + 0.02, spot.z); obj.rotation.set(0, spot.yaw, 0); obj.rotation.order = 'YXZ';
    obj.traverse((o) => { if (o.isMesh) { o.castShadow = tier.shadows > 0; o.userData.pick = 'car'; o.userData.car = cars.length; pickables.push(o); } });
    group.add(obj);
    const car = { def: d, obj, x: spot.x, z: spot.z, yaw: spot.yaw, v: 0, pitch: 0, roll: 0, rect: mkRect(spot.x, spot.z, d.hw * 0.95, d.hl, spot.yaw, 1.3) };
    layout.rects.push(car.rect); cars.push(car);
  }
  const applyCars = () => cars.forEach((c, i) => { c.obj.visible = c.driving || i < level.cars; if (c.obj.visible === false) { c.rect.cx = 1e6; } else if (!c.driving) { c.rect.cx = c.x; } });
  applyCars();

  // ── Palmiers et buissons (instances) ──
  const trees = []; // { im, list, key }
  const addInstanced = (part, list, height, rectR) => {
    if (!part || !list.length) return;
    part.geometry.computeBoundingBox(); const hgt = part.geometry.boundingBox.max.y, s0 = height / hgt;
    const im = new THREE.InstancedMesh(part.geometry, part.material, list.length), d = new THREE.Object3D();
    list.forEach(([x, z, r], i) => { d.position.set(x, G.groundY(x, z) - 0.04, z); d.rotation.set(0, r * 6.28, 0); d.scale.setScalar(s0 * (0.85 + r * 0.35)); d.updateMatrix(); im.setMatrixAt(i, d.matrix); layout.rects.push(mkRect(x, z, rectR, rectR, 0, 0.2)); });
    im.instanceMatrix.needsUpdate = true; im.count = list.length; group.add(im); trees.push({ im, total: list.length, key: part.name });
  };
  {
    const R = lcg(4242), taken = [], near = (x, z, d) => taken.some(([a, b]) => Math.hypot(a - x, b - z) < d) || layout.trees.some((t) => Math.hypot(t.x - x, t.z - z) < 3) || layout.lamps.some((t) => Math.hypot(t.x - x, t.z - z) < 2) || layout.benches.some((t) => Math.hypot(t.x - x, t.z - z) < 3) || cars.some((c) => Math.hypot(c.x - x, c.z - z) < 4);
    const spots = (n, tries, gen, spacing) => { const out = []; for (let i = 0; i < tries && out.length < n; i++) { const [x, z] = gen(); if (!G.isFree(layout, x, z, 1.4) || inFloor(x, z) || near(x, z, spacing)) continue; out.push([x, z, R()]); taken.push([x, z]); } return out; };
    const parkGen = () => [(R() < 0.5 ? -1 : 1) * (G.PARK_X + 4 + R() * 14), G.TOWN.z0 + 10 + R() * (G.TOWN.z1 - G.TOWN.z0 - 40)];
    const esplanade = () => [(R() * 2 - 1) * 70, G.TOWN.z1 - 40 + R() * 16];
    const palmSpots = spots(24, 600, parkGen, 8).concat(spots(PER_TIER.high.palms - 24, 300, esplanade, 9));
    const bushSpots = spots(PER_TIER.high.bushes, 500, () => (R() < 0.6 ? parkGen() : esplanade()), 6);
    addInstanced(parts.g9, palmSpots, 8.5, 0.3);
    addInstanced(parts.g17, bushSpots, 3.8, 0.7);
  }
  const applyTrees = () => trees.forEach((t) => { const cap = t.key === 'g9' ? PER_TIER.high.palms : PER_TIER.high.bushes, want = t.key === 'g9' ? level.palms : level.bushes; t.im.count = Math.min(t.total, Math.round((t.total * want) / cap)); t.im.visible = t.im.count > 0; t.im.boundingSphere = null; });
  applyTrees();

  // ── Interface ──
  const st = document.createElement('style'); st.textContent = CSS; document.head.append(st);
  const el = (tag, id, cls, html) => { const e = document.createElement(tag); if (id) e.id = id; if (cls) e.className = cls; if (html) e.innerHTML = html; return e; };
  const enterBtn = el('button', 'drive-enter', '', '🚗 Conduire'); enterBtn.type = 'button'; hud.append(enterBtn);
  const ui = el('div', 'drive-ui'); hud.append(ui);
  const speedEl = el('div', 'drive-speed', '', '0 km/h'), exitBtn = el('button', 'drive-exit', '', 'Sortir'); exitBtn.type = 'button';
  const top = el('div', 'drive-top'); top.append(speedEl, exitBtn); ui.append(top);
  const keys = { l: false, r: false, g: false, b: false, hb: false }, touch = { l: false, r: false, g: false, b: false };
  const pad = (id, label, k, aria) => {
    const b = el('div', id, 'dpad', label); b.setAttribute('role', 'button'); b.setAttribute('aria-label', aria);
    const on = (e) => { e.preventDefault(); touch[k] = true; b.classList.add('on'); try { b.setPointerCapture(e.pointerId); } catch (_) { /* ignoré */ } };
    const off = () => { touch[k] = false; b.classList.remove('on'); };
    b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); b.addEventListener('lostpointercapture', off); b.addEventListener('contextmenu', (e) => e.preventDefault());
    ui.append(b);
  };
  pad('dp-l', '◀', 'l', 'Tourner à gauche'); pad('dp-r', '▶', 'r', 'Tourner à droite'); pad('dp-g', 'ACCÉLÉRER', 'g', 'Accélérer'); pad('dp-b', 'FREIN', 'b', 'Freiner / reculer');

  // ── État de conduite ──
  const S = { active: false, car: null, steer: 0, manualT: 0, lastYaw: 0, sendT: 0, savedDist: 16, bump: 0 };
  const nearest = () => { let best = null, bd = ENTER_DIST; cars.forEach((c, i) => { if (!c.obj.visible) return; const d = Math.hypot(c.x - player.x, c.z - player.z); if (d < bd) { bd = d; best = c; } }); return best; };

  function enter(car) {
    if (S.active || !car || player.sitting || getBusy()) return false;
    S.active = true; S.car = car; car.driving = true; car.v = 0; car.rect.cx = 1e6; // la voiture ne se bloque pas elle-même
    player.path.length = 0; player.dest = null; player.x = car.x; player.z = car.z; setAvatarVisible(false);
    document.body.classList.add('driving'); enterBtn.classList.remove('on');
    S.savedDist = controls.state.tDist; controls.state.tDist = Math.max(13, Math.min(S.savedDist, 30)); controls.state.tPitch = 0.42; controls.state.tYaw = wrapAng(car.yaw + Math.PI); S.lastYaw = controls.state.tYaw; S.manualT = 0;
    social.emitMove(car.x, car.z, car.x, car.z); try { navigator.vibrate?.(20); } catch (_) { /* ignoré */ }
    return true;
  }
  function exit() {
    if (!S.active) return; const car = S.car; S.active = false; S.car = null; car.driving = false; car.v = 0;
    const r = [Math.cos(car.yaw), -Math.sin(car.yaw)], f = [Math.sin(car.yaw), Math.cos(car.yaw)], side = car.def.hw + 1.1;
    const tries = [[r, side], [r, -side], [f, -(car.def.hl + 1.2)], [f, car.def.hl + 1.2]]; let out = null;
    for (const [v, d] of tries) { const x = car.x + v[0] * d, z = car.z + v[1] * d; if (G.isFree(layout, x, z, 0.5) && !inFloor(x, z)) { out = [x, z]; break; } }
    if (!out) out = G.freePoint(layout, car.x + r[0] * side, car.z + r[1] * side);
    player.x = out[0]; player.z = out[1]; player.path.length = 0; player.dest = null;
    car.rect.cx = car.x; car.rect.cz = car.z; car.rect.ax = [Math.cos(car.yaw), -Math.sin(car.yaw)]; car.rect.az = [Math.sin(car.yaw), Math.cos(car.yaw)];
    setAvatarVisible(true); document.body.classList.remove('driving');
    controls.state.tDist = S.savedDist; controls.state.tPitch = 0.62; social.emitMove(player.x, player.z, player.x, player.z);
    for (const k of Object.keys(keys)) keys[k] = false; for (const k of Object.keys(touch)) { touch[k] = false; } ui.querySelectorAll('.dpad').forEach((b) => b.classList.remove('on'));
  }
  enterBtn.addEventListener('click', () => { const c = nearest(); if (c) enter(c); });
  exitBtn.addEventListener('click', exit);
  const inField = (e) => e.target?.closest?.('input,textarea,select,[contenteditable="true"]');
  const MAP = { ArrowUp: 'g', w: 'g', W: 'g', z: 'g', Z: 'g', ArrowDown: 'b', s: 'b', S: 'b', ArrowLeft: 'l', a: 'l', A: 'l', q: 'l', Q: 'l', ArrowRight: 'r', d: 'r', D: 'r', ' ': 'hb' };
  addEventListener('keydown', (e) => {
    if (inField(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    if ((e.key === 'e' || e.key === 'E') && !e.repeat) { if (S.active) exit(); else { const c = nearest(); if (c) enter(c); } return; }
    if (!S.active) return;
    const k = MAP[e.key]; if (!k) return;
    keys[k] = true; e.preventDefault(); e.stopImmediatePropagation(); // les flèches ne tournent pas la caméra pendant la conduite
  }, true);
  addEventListener('keyup', (e) => { const k = MAP[e.key]; if (k && S.active) { keys[k] = false; e.stopImmediatePropagation(); } }, true);
  addEventListener('blur', () => { for (const k of Object.keys(keys)) keys[k] = false; });

  // ── Physique simple de type arcade ──
  const free = (x, z) => G.isFree(layout, x, z, 0.3) && !inFloor(x, z);
  const hits = (car, x, z, yaw) => {
    const fx = Math.sin(yaw), fz = Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw), hl = car.def.hl, hw = car.def.hw * 0.8;
    for (const a of [-1, 0, 1]) for (const c of [-1, 0, 1]) if (!free(x + fx * hl * a + rx * hw * c, z + fz * hl * a + rz * hw * c)) return true;
    return false;
  };
  function drive(dt) {
    const car = S.car, vmax = car.def.truck ? 15 : 25;
    const gas = keys.g || touch.g, brk = keys.b || touch.b, left = keys.l || touch.l, right = keys.r || touch.r;
    const want = (left ? 1 : 0) - (right ? 1 : 0); S.steer += (want - S.steer) * Math.min(1, dt * (want ? 6 : 9));
    if (gas) car.v += (car.v < vmax ? (car.def.truck ? 9 : 11) * (1 - Math.max(0, car.v) / vmax * 0.8) : 0) * dt;
    if (brk) car.v -= (car.v > 0.4 ? 24 : 7 * (1 + car.v / 7)) * dt; // freine, puis recule
    if (car.v < -6) car.v = -6;
    if (keys.hb) car.v -= Math.sign(car.v) * Math.min(Math.abs(car.v), 30 * dt);
    if (!gas && !brk) car.v -= Math.sign(car.v) * Math.min(Math.abs(car.v), (3.2 + Math.abs(car.v) * 0.06) * dt); // frein moteur
    const off = !G.inTown(car.x, car.z) && !G.ROADS.some((r) => r.pts.some((p) => Math.hypot(p[0] - car.x, p[1] - car.z) < 26)); // hors route : plus lent
    if (off && car.v > vmax * 0.55) car.v -= (car.v - vmax * 0.55) * Math.min(1, dt * 1.5);
    const sgn = car.v >= 0 ? 1 : -1, sv = Math.abs(car.v), rate = 2.0 * Math.min(1, sv / 4.5) * (1 - 0.6 * Math.min(1, sv / vmax));
    const yaw = car.yaw + S.steer * rate * sgn * dt, step = car.v * dt;
    const nx = car.x + Math.sin(yaw) * step, nz = car.z + Math.cos(yaw) * step;
    if (!hits(car, nx, nz, yaw)) { car.x = nx; car.z = nz; car.yaw = yaw; }
    else if (!hits(car, nx, car.z, yaw)) { car.x = nx; car.yaw = yaw; car.v *= 0.8; }
    else if (!hits(car, car.x, nz, yaw)) { car.z = nz; car.yaw = yaw; car.v *= 0.8; }
    else if (!hits(car, car.x, car.z, yaw)) { car.yaw = yaw; if (sv > 3) S.bump = 0.25; car.v *= -0.25; } // choc : petit rebond
    else { car.v *= -0.25; } // coincée : on reste en place
    // posture sur le terrain
    const gy = G.groundY(car.x, car.z), fy = G.groundY(car.x + Math.sin(car.yaw) * 1.8, car.z + Math.cos(car.yaw) * 1.8), by = G.groundY(car.x - Math.sin(car.yaw) * 1.8, car.z - Math.cos(car.yaw) * 1.8);
    const kp = 1 - Math.exp(-dt * 10); car.pitch += (-Math.atan2(fy - by, 3.6) - car.pitch) * kp; car.roll += (-S.steer * Math.min(1, sv / vmax) * 0.06 - car.roll) * kp;
    S.bump = Math.max(0, S.bump - dt);
    car.obj.position.set(car.x, gy + 0.02, car.z); car.obj.rotation.set(car.pitch, car.yaw, car.roll + Math.sin(S.bump * 40) * S.bump * 0.05);
    player.x = car.x; player.z = car.z; player.path.length = 0;
    speedEl.textContent = Math.round(Math.abs(car.v) * KMH) + ' km/h';
    // caméra : elle se replace derrière la voiture, sauf si le joueur la tourne à la main
    const cs = controls.state;
    if (Math.abs(wrapAng(cs.tYaw - S.lastYaw)) > 0.02) S.manualT = 2.2; // le joueur tourne la caméra
    S.manualT = Math.max(0, S.manualT - dt);
    if (S.manualT === 0 && sv > 1) cs.tYaw += wrapAng(car.yaw + Math.PI - cs.tYaw) * (1 - Math.exp(-dt * 2.4));
    S.lastYaw = cs.tYaw;
    // les autres joueurs voient le personnage avancer
    S.sendT += dt; if (S.sendT > 0.5) { S.sendT = 0; social.emitMove(car.x, car.z, car.x + Math.sin(car.yaw) * car.v * 0.9, car.z + Math.cos(car.yaw) * car.v * 0.9); }
  }

  // ── Mise à jour à chaque image ──
  let promptT = 0, shown = false;
  function update(dt, cam) {
    if (S.active) { drive(dt); return; }
    promptT -= dt; if (promptT > 0) return; promptT = 0.2; // bouton « Conduire » : testé 5 fois par seconde
    const c = !player.sitting && !getBusy() ? nearest() : null; if (!!c !== shown) { shown = !!c; enterBtn.classList.toggle('on', shown); }
  }
  setTimeout(() => { if (!localStorage.getItem('jexcity.drive.intro') && cars.length) { toast('🚗 Des voitures sont garées sur la Grande Avenue : approchez-vous pour les conduire.'); try { localStorage.setItem('jexcity.drive.intro', '1'); } catch (_) { /* ignoré */ } } }, 600);

  return {
    update, enter, exit, cars,
    get active() { return S.active; },
    tapCar(i) { const c = cars[i]; if (!c || !c.obj.visible) return false; if (Math.hypot(c.x - player.x, c.z - player.z) <= ENTER_DIST) return enter(c); return false; },
    setTier(t) { level = PER_TIER[t.name] || PER_TIER.mid; cars.forEach((c) => c.obj.traverse((o) => { if (o.isMesh) o.castShadow = t.shadows > 0; })); applyCars(); applyTrees(); },
  };
}
