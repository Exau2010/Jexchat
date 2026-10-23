// city-geo.js — JexCity : géométrie "pure" (aucune dépendance à Three.js, donc testable avec Node).
// Contient : relief, canal, plan des bâtiments (généré, déterministe), collisions et trajets.
// Repère : x = est, z = sud, y = haut. Le canal court du nord (z<0) vers le lac (z>152).

export const TOWN = { x0: -112, x1: 112, z0: -400, z1: 152, quayY: 0.9, waterY: 0 };
export const TERRAIN = { size: 1280, seg: 160 }; // cellules de 8 m ; le « trou » de la ville tombe sur des bords de cellule
export const BRIDGES = []; // plus de ponts : la Grande Avenue est praticable sur toute sa largeur
export const AV = 13;       // demi-largeur de la chaussée (26 m)
export const SW = 7;        // largeur des trottoirs
export const STREETS = [-304, -200, -96, -8]; // axes (z) des rues transversales (largeur 16 m)
export const STATION = { x: 30, z: 37, hx: 10, hz: 26 }; // emprise de la station de métro (côté est)
export const PARK_X = 92; // au-delà de |x| = 92 : parcs plantés de part et d'autre
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
export const canalX = () => 0;   // l'ancien canal est devenu l'axe de la Grande Avenue (API conservée)
export const canalDX = () => 0;
export const halfW = () => AV;
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
  { name: 'Route du Château', pts: [[112, -60], [140, -80], [150, -120], [190, -150], [230, -190], [270, -250], [300, -330]] },
  { name: 'Route des Crêtes', pts: [[-112, -120], [-140, -150], [-170, -210], [-240, -260], [-300, -340], [-330, -420]] },
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

export function blockedByCanal() { return false; } // plus d'eau dans la ville
export const inPark = (x, z) => Math.abs(x) > PARK_X && inTown(x, z);

// ─── Plan de la ville ─────────────────────────────────────────────────────────
const PALETTES = {
  stone: ['#efe7d8', '#e6dccb', '#f4efe6', '#d9d2c4', '#ece0cf'],
  brick: ['#c98f78', '#b9785f', '#d4a083', '#a8664f', '#c4876c'],
  glass: ['#ffffff', '#f2f8ff', '#e8f1fb'],
};
const pick = (R, arr) => arr[Math.floor(R() * arr.length) % arr.length];
const FLOOR_H = 3.6, GROUND_H = 4.8;
const onStreet = (z0, z1) => STREETS.some((s) => z1 > s - 10 && z0 < s + 10);

export function buildLayout(seed = 7) {
  const R = rng(seed);
  const buildings = [], screens = [];
  const widths = [14, 18, 20, 22, 26, 30];
  const ROWS = [{ face: AV + SW, depths: [18, 20, 22, 24], fl: [9, 11, 13, 15, 18, 22, 26] }, { face: 50, depths: [16, 18, 22], fl: [6, 8, 10, 12, 16, 18] }, { face: 76, depths: [14, 16], fl: [4, 5, 6, 8, 10] }];
  const zEnd = TOWN.z1 - 46; // esplanade dégagée devant le lac
  let tallCount = 0;
  for (const side of [-1, 1]) {
    ROWS.forEach((row, ri) => {
      let z = TOWN.z0 + 14;
      while (z < zEnd - 14) {
        const w = pick(R, widths);
        if (onStreet(z, z + w)) { const s = STREETS.find((q) => z + w > q - 10 && z < q + 10); z = s + 10; continue; }
        if (ri === 0 && side === 1 && z + w > STATION.z - STATION.hz - 2 && z < STATION.z + STATION.hz + 2) { z = STATION.z + STATION.hz + 2; continue; }
        const depth = pick(R, row.depths);
        let floors = pick(R, row.fl);
        // une tour phare en bordure de l'esplanade côté ouest
        const landmark = ri === 0 && side === -1 && tallCount === 0 && z > -84 && w >= 18;
        if (landmark) { floors = 34; tallCount++; }
        const style = floors >= 16 || R() < 0.3 ? 'glass' : R() < 0.55 ? 'stone' : 'brick';
        const cx = side * (row.face + depth / 2), cz = z + w / 2, hx = depth / 2, hz = w / 2;
        const top = TOWN.quayY + GROUND_H + (floors - 1) * FLOOR_H;
        const tower = ri === 0 && floors >= 12, inset = tower ? 2.5 : 0;
        buildings.push({
          cx, cz, hx, hz, ax: [1, 0], az: [0, 1], floors, y0: TOWN.quayY, top, ph: 0, h: top + (floors > 14 ? 6 : 1.2), side, row: ri, style,
          color: pick(R, PALETTES[style]), tower, inset, podium: tower ? 4 : floors, uOff: Math.floor(R() * 4) / 4, vOff: 0, shop: ri === 0 || (ri === 1 && R() < 0.2),
        });
        if (ri === 0 && floors >= 11 && w >= 16 && screens.length < 10 && R() < 0.6) {
          const sw = Math.min(w - 4 - 2 * inset, 18), fx = side * (row.face + inset);
          screens.push({ x: fx - side * 0.12, y: Math.min(40, Math.max(19, top * 0.42)), z: cz, side, w: sw, h: sw * 0.5 });
        }
        z += w + (R() < 0.15 ? 4 : 0);
      }
    });
  }
  // la station de métro occupe l'emprise est (chargée à part) : un volume plein pour les collisions
  buildings.push({ cx: STATION.x, cz: STATION.z, hx: STATION.hx, hz: STATION.hz, ax: [1, 0], az: [0, 1], floors: 1, y0: TOWN.quayY, top: 8, ph: 0, h: 8, side: 1, row: 0, style: 'station', color: '#ffffff', podium: 0, tower: false, inset: 0, shop: false, station: true, uOff: 0, vOff: 0 });
  const rects = buildings.map((b) => ({ cx: b.cx, cz: b.cz, hx: b.hx, hz: b.hz, ax: b.ax, az: b.az, h: b.h }));
  // lampadaires, arbres d'alignement et bancs le long des trottoirs
  const lamps = [], trees = [], benches = [];
  for (const side of [-1, 1]) {
    for (let z = TOWN.z0 + 10; z < TOWN.z1 - 12; z += 16) lamps.push({ x: side * (AV + 1.3), z });
    for (let z = TOWN.z0 + 18; z < TOWN.z1 - 14; z += 14) if (!STREETS.some((s) => Math.abs(z - s) < 12)) trees.push({ x: side * (AV + 5.4), z, y: TOWN.quayY, s: 0.55 + R() * 0.12 });
    for (let z = TOWN.z0 + 26; z < TOWN.z1 - 20; z += 42) if (!STREETS.some((s) => Math.abs(z - s) < 12)) benches.push({ x: side * (AV + 3.2), z, side });
    for (let z = TOWN.z0 + 8; z < TOWN.z1 - 20; z += 13) trees.push({ x: side * (PARK_X + 10 + (R() - 0.5) * 6), z: z + R() * 6, y: TOWN.quayY, s: 0.8 + R() * 0.7 });
  }
  // plantations de l'esplanade
  for (const side of [-1, 1]) for (let k = 0; k < 3; k++) trees.push({ x: side * (22 + k * 18), z: TOWN.z1 - 26, y: TOWN.quayY, s: 0.7 + R() * 0.2 });
  // arbres des collines autour de la ville (après les arbres de ville : les premiers du tableau restent affichés même au niveau « low »)
  const T = rng(99);
  const hill = [];
  for (let i = 0; i < 4000 && hill.length < 800; i++) {
    const x = (T() * 2 - 1) * 620, z = (T() * 2 - 1) * 620;
    if (x > TOWN.x0 - 6 && x < TOWN.x1 + 6 && z > TOWN.z0 - 6 && z < TOWN.z1 + 20) continue;
    const h = terrainHeight(x, z);
    if (h < 1.5 || h > 95) continue;
    if (T() > 0.85 - smooth(30, 95, h) * 0.6) continue;
    hill.push({ x, z, y: h, s: 0.8 + T() * 0.9 });
  }
  const allTrees = trees.concat(hill).slice(0, 960);
  return { buildings, rects, lamps, trees: allTrees, benches, screens, streetTrees: trees.length };
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
  return [to]; // plus de canal à franchir : trajet direct (le glissement le long des façades fait le reste)
}
export function spawnPoint() {
  return [-5, 30]; // au milieu de la Grande Avenue, face à la station de métro
}
// La caméra ne doit pas traverser un bâtiment (point en y sous le toit, dans l'emprise élargie).
export function cameraBlocked(layout, x, y, z) {
  for (const q of layout.rects) {
    if (y < q.h && circleHitsRect(x, z, 0.4, q)) return true;
  }
  return false;
}
