// city-geo.js — JexCity : géométrie "pure" (aucune dépendance à Three.js, donc testable avec Node).
// Contient : relief, canal, plan des bâtiments (généré, déterministe), collisions et trajets.
// Repère : x = est, z = sud, y = haut. Le canal court du nord (z<0) vers le lac (z>152).

export const TOWN = { x0: -64, x1: 64, z0: -240, z1: 152, quayY: 0.9, waterY: 0 };
export const TERRAIN = { size: 1280, seg: 160 }; // cellules de 8 m ; le « trou » de la ville tombe sur des bords de cellule
export const BRIDGES = [{ z: -30 }, { z: 50 }];
export const CHATEAU = { x: 190, z: -150 };
export const ISLAND = { z: 10 }; // centre de l'île du Palais

export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export function smooth(a, b, x) { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash2(i, j) {
  let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, z) {
  const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  return lerp(lerp(hash2(i, j), hash2(i + 1, j), u), lerp(hash2(i, j + 1), hash2(i + 1, j + 1), u), v);
}
export function fbm(x, z, o = 4) {
  let s = 0, a = 0.5, f = 1;
  for (let k = 0; k < o; k++) { s += a * vnoise(x * f, z * f); f *= 2; a *= 0.5; }
  return s / (1 - Math.pow(0.5, o));
}

// ─── Canal ────────────────────────────────────────────────────────────────────
export const canalX = (z) => 5 * Math.sin(z * 0.018);
export const canalDX = (z) => 5 * 0.018 * Math.cos(z * 0.018);
export const halfW = (z) => 4.5 + 3 * Math.exp(-(((z - ISLAND.z) / 16) ** 2)); // s'élargit autour de l'île
// Repère local au canal : p = point central, t = tangente (vers le sud), n = normale (vers l'est)
export function frame(z) {
  const dx = canalDX(z), l = Math.hypot(dx, 1);
  return { p: [canalX(z), z], t: [dx / l, 1 / l], n: [1 / l, -dx / l] };
}

// ─── Relief ───────────────────────────────────────────────────────────────────
export function terrainHeight(x, z) {
  const r = Math.hypot(x * 0.85, z + 40);
  const m = smooth(150, 430, r);
  const ridge = fbm(x * 0.0042 + 10, z * 0.0042 + 3, 4);
  let h = m * (18 + 170 * ridge * ridge) + 4 * fbm(x * 0.02, z * 0.02, 3) * smooth(40, 200, r);
  const d = Math.hypot(x - CHATEAU.x, z - CHATEAU.z);
  h = Math.max(h, Math.min(38 * Math.exp(-((d / 58) ** 2)), 34)); // colline du château (plateau à 34 m)
  const lake = smooth(150, 172, z) * (1 - smooth(330, 480, Math.abs(x))) * (1 - smooth(560, 630, z));
  h = lerp(h, -3.5, lake);
  // raccord avec le sol de la vieille ville (qui est un maillage séparé)
  const dx = Math.max(TOWN.x0 - x, 0, x - TOWN.x1), dz = Math.max(TOWN.z0 - z, 0);
  let w = (1 - smooth(0, 56, Math.hypot(dx, dz))) * (1 - smooth(TOWN.z1, TOWN.z1 + 10, z));
  if (z >= TOWN.z1 - 0.01 && Math.abs(x - canalX(z)) < 12) return Math.min(lerp(h, TOWN.quayY, 0), -1.2); // embouchure du canal
  return lerp(h, TOWN.quayY, w);
}

// Monde explorable : la ville + les collines, routes et prairies alentour (le terrain visible va au-delà ; on borne la marche).
export const WORLD = { x0: -420, x1: 420, z0: -460, z1: 140 };
export const inWorld = (x, z) => x >= WORLD.x0 && x <= WORLD.x1 && z >= WORLD.z0 && z <= WORLD.z1;
// Pente locale (rapport dénivelé / distance) : au-delà de ~0,9 le versant est une paroi, on ne le gravit pas.
export function slopeAt(x, z) {
  const e = 1.5, gx = (terrainHeight(x + e, z) - terrainHeight(x - e, z)) / (2 * e), gz = (terrainHeight(x, z + e) - terrainHeight(x, z - e)) / (2 * e);
  return Math.hypot(gx, gz);
}
// Routes : deux routes de campagne qui partent de la ville et serpentent dans les collines (rubans plats, repérés par la carte).
export const ROADS = [
  { name: 'Route du Château', pts: [[64, -60], [110, -90], [150, -120], [190, -150], [230, -190], [270, -250], [300, -330]] },
  { name: 'Route des Crêtes', pts: [[-64, -120], [-110, -170], [-170, -210], [-240, -260], [-300, -340], [-330, -420]] },
];
export const inTown = (x, z) => x >= TOWN.x0 && x <= TOWN.x1 && z >= TOWN.z0 && z <= TOWN.z1;

// Hauteur du tablier d'un pont en (x,z), ou null. Le tablier est cambré (point haut au centre du canal).
export function bridgeSpan(z) { return halfW(z) + 4; }
export function bridgeY(x, z) {
  for (const b of BRIDGES) {
    if (Math.abs(z - b.z) <= 3) {
      const a = x - canalX(z), hw = bridgeSpan(z);
      if (Math.abs(a) <= hw) { const t = a / hw; return TOWN.quayY + 1.1 * (1 - t * t); }
    }
  }
  return null;
}
export function groundY(x, z) {
  const b = bridgeY(x, z);
  if (b !== null) return b;
  return inTown(x, z) ? TOWN.quayY : terrainHeight(x, z);
}

export function blockedByCanal(x, z) {
  const a = x - canalX(z);
  if (Math.abs(a) >= halfW(z) + 0.35) return false;
  for (const b of BRIDGES) if (Math.abs(z - b.z) <= 2.4) return false;
  return true;
}

// ─── Plan de la ville ─────────────────────────────────────────────────────────
const PALETTE = ['#e8c882', '#e9b4a0', '#f2e3c0', '#e0a083', '#f0d98c', '#c9d3a8', '#b8c4cf', '#d9906a', '#efd2b4', '#e6b98f'];
const ROOFS = ['#b5553b', '#a8442f', '#8f4a3a', '#c0623f', '#9a4b35'];
const pick = (R, arr) => arr[Math.floor(R() * arr.length) % arr.length];

export function buildLayout(seed = 7) {
  const R = rng(seed);
  const buildings = [];
  const widths = [8, 12, 12, 12, 16, 16, 20];
  for (const side of [-1, 1]) {
    for (let row = 0; row < 3; row++) {
      let z = TOWN.z0 + 10;
      while (z < TOWN.z1 - 16) {
        // places dégagées autour des ponts
        let blocked = false;
        const w = pick(R, widths);
        for (const b of BRIDGES) if (z + w > b.z - 8 && z < b.z + 8) { z = b.z + 8; blocked = true; break; }
        if (blocked) continue;
        const depth = row === 0 ? pick(R, [8, 12, 12]) : row === 1 ? pick(R, [12, 16]) : 12;
        let hw = 0;
        for (let s = 0; s <= 4; s++) hw = Math.max(hw, halfW(z + (w * s) / 4));
        const e0 = hw + 5.5;
        const face = row === 0 ? e0 : row === 1 ? e0 + 18 : e0 + 40;
        const zc = z + w / 2;
        const f = frame(zc);
        const off = face + depth / 2;
        const cx = f.p[0] + f.n[0] * side * off, cz = zc + f.n[1] * side * off;
        const hx = depth / 2, hz = w / 2;
        const reach = Math.abs(cx) + hx + hz * 0.12 + 0.5;
        z += w + (R() < 0.22 ? pick(R, [4, 6]) : 0);
        if (reach > 61.5) continue;
        const floors = row === 0 ? pick(R, [3, 4, 4, 5]) : row === 1 ? pick(R, [3, 3, 4, 4]) : pick(R, [2, 3, 3]);
        const H = TOWN.quayY + 3.6 + (floors - 1) * 3;
        const ph = Math.min(0.55 * Math.min(hx, hz), 4.2);
        buildings.push({
          cx, cz, hx, hz, ax: f.n.slice(), az: f.t.slice(), floors, y0: TOWN.quayY, top: H, ph,
          color: pick(R, PALETTE), roofColor: R() < 0.85 ? pick(R, ROOFS) : '#59626e',
          ridgeAlongZ: hz >= hx, chimney: R() < 0.6, uOff: Math.floor(R() * 4) / 4, vOff: Math.floor(R() * 4) / 4,
          h: H + ph,
        });
      }
    }
  }
  const rects = buildings.map((b) => ({ cx: b.cx, cz: b.cz, hx: b.hx, hz: b.hz, ax: b.ax, az: b.az, h: b.h }));
  // lampadaires le long des quais
  const lamps = [];
  for (const side of [-1, 1]) {
    for (let z = TOWN.z0 + 8; z < TOWN.z1 - 6; z += 14) {
      if (BRIDGES.some((b) => Math.abs(z - b.z) < 7)) continue;
      const f = frame(z), o = halfW(z) + 1.1;
      lamps.push({ x: f.p[0] + f.n[0] * side * o, z: z + f.n[1] * side * o });
    }
  }
  // arbres (collines autour de la ville)
  const T = rng(99);
  const trees = [];
  for (let i = 0; i < 4000 && trees.length < 800; i++) {
    const x = (T() * 2 - 1) * 620, z = (T() * 2 - 1) * 620;
    if (x > TOWN.x0 - 6 && x < TOWN.x1 + 6 && z > TOWN.z0 - 6 && z < TOWN.z1 + 20) continue;
    const h = terrainHeight(x, z);
    if (h < 1.5 || h > 95) continue;
    if (T() > 0.85 - smooth(30, 95, h) * 0.6) continue;
    trees.push({ x, z, y: h, s: 0.8 + T() * 0.9 });
  }
  return { buildings, rects, lamps, trees };
}

// ─── Collisions et déplacements ───────────────────────────────────────────────
export function circleHitsRect(x, z, r, q) {
  const dx = x - q.cx, dz = z - q.cz;
  const lx = dx * q.ax[0] + dz * q.ax[1], lz = dx * q.az[0] + dz * q.az[1];
  return Math.abs(lx) < q.hx + r && Math.abs(lz) < q.hz + r;
}
export function isFree(layout, x, z, r = 0.45) {
  if (!inWorld(x, z)) return false;
  if (!inTown(x, z)) { // hors de la ville : prairies, collines, routes — ni lac, ni parois
    if (z > TOWN.z1 - 6 && Math.abs(x) < 40) return terrainHeight(x, z) > 0.4 && slopeAt(x, z) < 0.9 && z < TOWN.z1 + 2; // berge du lac
    return terrainHeight(x, z) > 0.4 && slopeAt(x, z) < 0.9;
  }
  if (blockedByCanal(x, z)) return false;
  for (const q of layout.rects) if (circleHitsRect(x, z, r, q)) return false;
  return true;
}
export function slideMove(layout, px, pz, nx, nz, r = 0.45) {
  if (isFree(layout, nx, nz, r)) return [nx, nz];
  if (isFree(layout, nx, pz, r)) return [nx, pz];
  if (isFree(layout, px, nz, r)) return [px, nz];
  return [px, pz];
}
// Ramène un point cliqué vers le point libre le plus proche (hors bâtiment, hors eau).
export function freePoint(layout, x, z, r = 0.5) {
  x = clamp(x, WORLD.x0 + 1.5, WORLD.x1 - 1.5); z = clamp(z, WORLD.z0 + 1.5, WORLD.z1 - 1.5);
  for (let it = 0; it < 6; it++) {
    if (isFree(layout, x, z, r)) return [x, z];
    if (blockedByCanal(x, z)) { const a = x - canalX(z); x = canalX(z) + (a >= 0 ? 1 : -1) * (halfW(z) + 0.8); continue; }
    const q = layout.rects.find((k) => circleHitsRect(x, z, r, k));
    if (!q) break;
    // quatre sorties possibles (une par face) ; on garde la plus proche qui soit réellement libre
    let best = null, bd = Infinity;
    for (const [axis, half, sgn] of [[q.ax, q.hx, 1], [q.ax, q.hx, -1], [q.az, q.hz, 1], [q.az, q.hz, -1]]) {
      const d = half + r + 0.1;
      const cx = q.cx + axis[0] * sgn * d + (axis === q.ax ? q.az[0] : q.ax[0]) * 0, cz = q.cz + axis[1] * sgn * d;
      // on garde la coordonnée de l'autre axe du point cliqué
      const other = axis === q.ax ? q.az : q.ax;
      const lo = (x - q.cx) * other[0] + (z - q.cz) * other[1];
      const px = cx + other[0] * lo, pz = cz + other[1] * lo;
      if (!isFree(layout, px, pz, r)) continue;
      const dd = Math.hypot(px - x, pz - z);
      if (dd < bd) { bd = dd; best = [px, pz]; }
    }
    if (best) return best;
    break;
  }
  // repli : on cherche en spirale un point libre
  for (let rad = 1; rad < 40; rad += 1) for (let a = 0; a < 16; a++) {
    const px = x + Math.cos((a / 16) * Math.PI * 2) * rad, pz = z + Math.sin((a / 16) * Math.PI * 2) * rad;
    if (isFree(layout, px, pz, r)) return [px, pz];
  }
  return [x, z];
}
// Trajet : si la destination est de l'autre côté du canal, on passe par le pont le plus proche.
export function planPath(layout, from, to) {
  to = freePoint(layout, to[0], to[1]);
  const sa = Math.sign(from[0] - canalX(from[1])), sb = Math.sign(to[0] - canalX(to[1]));
  const pts = [];
  if (inTown(from[0], from[1]) && inTown(to[0], to[1]) && sa !== 0 && sb !== 0 && sa !== sb) {
    let best = BRIDGES[0], bs = Infinity;
    for (const b of BRIDGES) { const s = Math.abs(from[1] - b.z) + Math.abs(to[1] - b.z); if (s < bs) { bs = s; best = b; } }
    const f = frame(best.z), off = halfW(best.z) + 2;
    pts.push([f.p[0] + f.n[0] * sa * off, best.z + f.n[1] * sa * off]);
    pts.push([f.p[0] - f.n[0] * sa * off, best.z - f.n[1] * sa * off]);
  }
  pts.push(to);
  return pts;
}
export function spawnPoint() {
  const z = BRIDGES[0].z + 9, f = frame(z), o = halfW(z) + 2.6;
  return [f.p[0] + f.n[0] * o, z + f.n[1] * o];
}
// La caméra ne doit pas traverser un bâtiment (point en y sous le toit, dans l'emprise élargie).
export function cameraBlocked(layout, x, y, z) {
  for (const q of layout.rects) {
    if (y < q.h && circleHitsRect(x, z, 0.4, q)) return true;
  }
  return false;
}
