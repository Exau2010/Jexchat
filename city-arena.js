// city-arena.js — JexCity : « Arène Stickman » — mini-jeux 3D de fête, 1 à 4 joueurs, CHACUN SUR SON APPAREIL (style Stickman Party).
// Les amis sont invités depuis la ville (salon : city-party.js / city-party-server.js) ; l'hôte fait tourner la partie et diffuse l'état ~15 fois/s,
// les invités n'envoient que leur touche. Places libres = robots. Une seule touche par joueur (saut, élan, tir, sprint, virage).
// Inspiration : sensations « une seule touche par joueur » ; personnages, niveaux et ressources 100 % originaux (bonshommes bâtons générés en code).
// Modes : COURSE (haies) · SUMO (plateforme qui rétrécit) · BALAI (bras tournant) · CHARS (tourelle qui tourne, tirs qui ricochent) ·
// FOOTBALL (2 équipes, sprint/tir) · PEINTURE (coloriez le plus de cases). Records de course dans localStorage (jexcity.arena.*).
// Moteur indépendant (sa propre scène et son propre rendu, libérés à la fermeture) : la ville n'est pas modifiée.
import * as THREE from 'three';

const COLORS = ['#ff4d4d', '#3d9bff', '#ffd23d', '#4dff88'];
const NAMES = ['Rouge', 'Bleu', 'Jaune', 'Vert'];
const KEYS = ['a', 'l', 'v', 'n']; // une touche par joueur au clavier
const TRACK = 110, HURDLE_W = 0.7, RUN = 6.5, GRAV = 26, JUMP = 9.5;

const rnd = (seed) => { let a = seed >>> 0; return () => { a = (Math.imul(a, 1664525) + 1013904223) >>> 0; return a / 4294967296; }; };
const store = { get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* non bloquant */ } } };

// ───────────── Logique pure (testable sans navigateur) ─────────────
export function makeCourse(n, seed = 1) {
  const R = rnd(seed), hurdles = [];
  for (let x = 14; x < TRACK - 6; x += 5 + R() * 5) hurdles.push({ x: Math.round(x * 10) / 10, h: R() < 0.3 ? 1.5 : 0.9 });
  return { n, hurdles, players: Array.from({ length: n }, (_, i) => ({ i, x: 0, y: 0, vy: 0, stun: 0, t: null, bot: false, react: 0.05 + Math.random() * 0.17 })), time: 0, done: false };
}
export function stepCourse(c, dt, taps) {
  c.time += dt; let fin = 0;
  for (const p of c.players) {
    if (p.t != null) { fin++; continue; }
    if (p.stun > 0) p.stun -= dt;
    const grounded = p.y <= 0.001 && p.vy <= 0;
    if (p.bot && grounded && p.stun <= 0) { const nx = c.hurdles.find((h) => h.x > p.x - 0.2); if (nx && nx.x - p.x < RUN * (0.2 + p.react) + 0.1 && nx.x - p.x > 0.4) taps[p.i] = true; }
    if (taps[p.i] && grounded && p.stun <= 0) p.vy = JUMP;
    p.vy -= GRAV * dt; p.y = Math.max(0, p.y + p.vy * dt); if (p.y === 0 && p.vy < 0) p.vy = 0;
    const sp = p.stun > 0 ? RUN * 0.25 : RUN; const px = p.x; p.x += sp * dt;
    for (const h of c.hurdles) if (h.x + HURDLE_W / 2 > px && h.x - HURDLE_W / 2 <= p.x && p.y < h.h - 0.1) { p.stun = 0.9; p.x = Math.max(px, h.x - HURDLE_W / 2 - 0.05); break; }
    if (p.x >= TRACK) { p.x = TRACK; p.t = c.time; }
  }
  if (fin === c.n || c.time > 60) c.done = true;
  return c;
}
export function ranking(c) { return [...c.players].sort((a, b) => (a.t ?? 1e9 + -a.x) - (b.t ?? 1e9 + -b.x)); }

export function makeSumo(n) {
  const pl = Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2; return { i, x: Math.cos(a) * 3.2, z: Math.sin(a) * 3.2, vx: 0, vz: 0, head: a + Math.PI, alive: true, out: null, bot: false, cd: 0, aim: Math.random() * 0.8 }; });
  return { n, players: pl, time: 0, radius: 7, done: false, winner: null };
}
export function stepSumo(s, dt, taps) {
  s.time += dt; s.radius = Math.max(1.2, 7 - s.time * 0.1);
  const alive = s.players.filter((p) => p.alive);
  for (const p of alive) {
    p.head += 2.4 * dt; p.cd = Math.max(0, p.cd - dt);
    if (p.bot && p.cd <= 0) { // vise un adversaire vivant, avec une marge d'erreur propre à chaque robot
      const o = alive.filter((q) => q !== p).sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0];
      if (o) { let d = Math.atan2(o.z - p.z, o.x - p.x) - p.head; d = Math.atan2(Math.sin(d), Math.cos(d)); if (Math.abs(d) < 0.25 + p.aim * 0.3 && Math.hypot(o.x - p.x, o.z - p.z) < 7.5) taps[p.i] = true; }
    }
    if (taps[p.i] && p.cd <= 0) { p.vx += Math.cos(p.head) * 9; p.vz += Math.sin(p.head) * 9; p.cd = 0.7; }
  }
  for (const p of alive) { p.x += p.vx * dt; p.z += p.vz * dt; const f = Math.exp(-2.2 * dt); p.vx *= f; p.vz *= f; }
  for (let a = 0; a < alive.length; a++) for (let b = a + 1; b < alive.length; b++) { // collisions : on se pousse
    const A = alive[a], B = alive[b]; let dx = B.x - A.x, dz = B.z - A.z; const d = Math.hypot(dx, dz) || 1e-3, min = 0.9;
    if (d < min) { dx /= d; dz /= d; const ov = (min - d) / 2; A.x -= dx * ov; A.z -= dz * ov; B.x += dx * ov; B.z += dz * ov;
      const rv = (B.vx - A.vx) * dx + (B.vz - A.vz) * dz; if (rv < 0) { const j = -rv * 1.15; A.vx -= dx * j; A.vz -= dz * j; B.vx += dx * j; B.vz += dz * j; } }
  }
  for (const p of alive) if (Math.hypot(p.x, p.z) > s.radius + 0.2) { p.alive = false; p.out = s.time; }
  const left = s.players.filter((p) => p.alive);
  if (left.length <= 1 && !s.done) { s.done = true; s.winner = left[0] ? left[0].i : null; if (left[0]) left[0].out = s.time + 1; }
  return s;
}


// Mode BALAI : un bras tournant de plus en plus vite balaie la plateforme ; une touche = saut ; touché au sol = éliminé. Un 2e bras arrive après 15 s.
const wrapA = (a) => Math.atan2(Math.sin(a), Math.cos(a));
export function makeSweep(n) {
  return { n, time: 0, a: 0, bars: 1, done: false, winner: null,
    players: Array.from({ length: n }, (_, i) => ({ i, ang: (i / n) * Math.PI * 2, y: 0, vy: 0, alive: true, out: null, bot: false, react: 0.05 + Math.random() * 0.22, err: 0.15 + Math.random() * 0.85, jit: 0 })) };
}
export function stepSweep(s, dt, taps) {
  s.time += dt; const w = Math.min(8, 1.5 + 0.1 * s.time); s.a = wrapA(s.a + w * dt); s.bars = s.time > 15 ? 2 : 1;
  const angs = s.bars === 2 ? [s.a, wrapA(s.a + Math.PI)] : [s.a];
  for (const p of s.players) {
    if (!p.alive) continue;
    const grounded = p.y <= 0.001 && p.vy <= 0;
    if (p.bot && grounded) for (const b of angs) { const d = wrapA(p.ang - b); if (d > 0 && d < w * (0.28 + p.react + p.jit)) { taps[p.i] = true; p.jit = (Math.random() - 0.5) * 0.6 * p.err; break; } }
    if (taps[p.i] && grounded) p.vy = JUMP;
    p.vy -= GRAV * dt; p.y = Math.max(0, p.y + p.vy * dt); if (p.y === 0 && p.vy < 0) p.vy = 0;
    for (const b of angs) if (Math.abs(wrapA(p.ang - b)) < 0.2 && p.y < 0.55) { p.alive = false; p.out = s.time; break; }
  }
  const left = s.players.filter((p) => p.alive);
  if (left.length <= 1 && !s.done) { s.done = true; s.winner = left[0] ? left[0].i : null; if (left[0]) left[0].out = s.time + 1; }
  return s;
}


// ───── CHARS : arène 20×12 avec 4 blocs ; le char avance seul, la tourelle tourne en continu, une touche = tir (ricochets ×2) ─────
export const TANK = { w: 10, h: 6, blocks: [{ x: -3.5, z: -1.6, hx: 1, hz: 0.6 }, { x: 3.5, z: 1.6, hx: 1, hz: 0.6 }, { x: 0, z: 0, hx: 0.5, hz: 1.6 }, { x: 0, z: -4.4, hx: 1.4, hz: 0.4 }, { x: 0, z: 4.4, hx: 1.4, hz: 0.4 }], hp: 3, speed: 1.7, bullet: 9, bounces: 2 };
const inBlock = (x, z, r) => TANK.blocks.find((b) => Math.abs(x - b.x) < b.hx + r && Math.abs(z - b.z) < b.hz + r);
export function makeTanks(n) {
  const corners = [[-8, -4.2, 0.4], [8, 4.2, Math.PI + 0.4], [8, -4.2, Math.PI - 0.4], [-8, 4.2, -0.4]];
  return { n, time: 0, done: false, winner: null, bullets: [], limit: 75,
    players: Array.from({ length: n }, (_, i) => ({ i, x: corners[i][0], z: corners[i][1], h: corners[i][2], a: Math.random() * 6.28, hp: TANK.hp, alive: true, out: null, cd: 0, bot: false, aim: 0.05 + Math.random() * 0.2 })) };
}
export function stepTanks(s, dt, taps) {
  s.time += dt;
  const alive = s.players.filter((p) => p.alive);
  for (const p of alive) {
    p.a += 2.1 * dt; p.cd = Math.max(0, p.cd - dt);
    if (p.bot && p.cd <= 0) {
      const o = alive.filter((q) => q !== p).sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0];
      if (o) { let d = Math.atan2(o.z - p.z, o.x - p.x) - p.a; d = Math.atan2(Math.sin(d), Math.cos(d)); if (Math.abs(d) < 0.12 + p.aim) taps[p.i] = true; }
    }
    if (taps[p.i] && p.cd <= 0) { p.cd = 0.55; s.bullets.push({ x: p.x + Math.cos(p.a) * 0.9, z: p.z + Math.sin(p.a) * 0.9, vx: Math.cos(p.a) * TANK.bullet, vz: Math.sin(p.a) * TANK.bullet, b: 0, o: p.i, life: 4 }); }
    const nx = p.x + Math.cos(p.h) * TANK.speed * dt, nz = p.z + Math.sin(p.h) * TANK.speed * dt;
    if (Math.abs(nx) > TANK.w - 0.8 || Math.abs(nz) > TANK.h - 0.8 || inBlock(nx, nz, 0.7)) p.h += 1.4 + Math.random() * 0.8; else { p.x = nx; p.z = nz; }
  }
  for (const b of s.bullets) {
    b.life -= dt; const nx = b.x + b.vx * dt, nz = b.z + b.vz * dt; let hitWall = false;
    if (Math.abs(nx) > TANK.w) { b.vx = -b.vx; hitWall = true; } else if (inBlock(nx, b.z, 0.12)) { b.vx = -b.vx; hitWall = true; } else b.x = nx;
    if (Math.abs(nz) > TANK.h) { b.vz = -b.vz; hitWall = true; } else if (inBlock(b.x, nz, 0.12)) { b.vz = -b.vz; hitWall = true; } else b.z = nz;
    if (hitWall && ++b.b > TANK.bounces) b.life = 0;
    for (const p of alive) if (p.alive && (p.i !== b.o || b.b > 0 || b.life < 3.6) && Math.hypot(p.x - b.x, p.z - b.z) < 0.7) { b.life = 0; if (--p.hp <= 0) { p.alive = false; p.out = s.time; } break; }
  }
  s.bullets = s.bullets.filter((b) => b.life > 0);
  const left = s.players.filter((p) => p.alive);
  if (!s.done && (left.length <= 1 || s.time > s.limit)) { s.done = true; const best = [...left].sort((a, b) => b.hp - a.hp); s.winner = best.length && (best.length === 1 || best[0].hp > best[1].hp) ? best[0].i : null; }
  return s;
}

// ───── FOOTBALL : 24×14, buts de 4 m, équipes (0,2) contre (1,3) ; humains courent toujours vers le ballon, robots : un attaquant + un défenseur ; touche = sprint, ou tir si proche ─────
export const FOOT = { w: 12, h: 7, goal: 2, win: 3, limit: 80 };
export const teamOf = (i) => i % 2;
export function makeFootball(n) {
  const s = { n, time: 0, done: false, winner: null, score: [0, 0], pause: 1, ball: { x: 0, z: 0, vx: 0, vz: 0 }, players: [] };
  for (let i = 0; i < n; i++) s.players.push({ i, x: (teamOf(i) ? 1 : -1) * (i < 2 ? 5 : 8), z: i < 2 ? -1.5 : 2.5, vx: 0, vz: 0, boost: 0, cd: 0, bot: false, err: (Math.random() - 0.5) * 1.6 });
  return s;
}
function kickoff(s) { s.ball = { x: 0, z: 0, vx: 0, vz: 0 }; s.pause = 1.2; s.players.forEach((p, i) => { p.x = (teamOf(i) ? 1 : -1) * (i < 2 ? 5 : 8); p.z = i < 2 ? -1.5 : 2.5; p.vx = p.vz = 0; }); }
export function stepFootball(s, dt, taps) {
  s.time += dt; const B = s.ball;
  if (s.pause > 0) { s.pause -= dt; for (const p of s.players) taps[p.i] = false; }
  for (const p of s.players) {
    p.cd = Math.max(0, p.cd - dt); p.boost = Math.max(0, p.boost - dt);
    if (s.pause > 0) continue;
    const mates = s.players.filter((q) => teamOf(q.i) === teamOf(p.i)), nearest = [...mates].sort((a, b) => Math.hypot(a.x - B.x, a.z - B.z) - Math.hypot(b.x - B.x, b.z - B.z))[0];
    const chase = !p.bot || nearest === p; let tx = B.x, tz = B.z;
    if (!chase) { tx = (teamOf(p.i) ? 1 : -1) * 6; tz = B.z * 0.6; }
    const d = Math.hypot(tx - p.x, tz - p.z) || 1e-3, sp = (chase ? 3.3 : 2.6) * (p.boost > 0 ? 1.7 : 1);
    p.vx = ((tx - p.x) / d) * Math.min(sp, d * 6); p.vz = ((tz - p.z) / d) * Math.min(sp, d * 6);
    const dBall = Math.hypot(B.x - p.x, B.z - p.z), goalX = teamOf(p.i) ? -FOOT.w : FOOT.w;
    if (p.bot && chase && dBall < 1.1 && p.cd <= 0 && Math.random() < 0.06) taps[p.i] = true;
    if (taps[p.i] && p.cd <= 0) {
      if (dBall < 1.4) { const gz = p.err * 0.9 + (Math.random() - 0.5) * 2, dx = goalX - B.x, dz = gz - B.z, L = Math.hypot(dx, dz) || 1; B.vx = (dx / L) * 13; B.vz = (dz / L) * 13; p.cd = 0.45; } else { p.boost = 0.45; p.cd = 0.8; }
    }
    p.x = Math.max(-FOOT.w + 0.4, Math.min(FOOT.w - 0.4, p.x + p.vx * dt)); p.z = Math.max(-FOOT.h + 0.4, Math.min(FOOT.h - 0.4, p.z + p.vz * dt));
    if (dBall < 0.7 && p.cd < 0.3) { B.vx += (B.x - p.x) * 7 * dt * 6 + p.vx * dt * 4; B.vz += (B.z - p.z) * 7 * dt * 6 + p.vz * dt * 4; }
  }
  if (s.pause <= 0) {
    B.x += B.vx * dt; B.z += B.vz * dt; const f = Math.exp(-1.1 * dt); B.vx *= f; B.vz *= f;
    if (Math.abs(B.z) > FOOT.h - 0.2) { B.z = Math.sign(B.z) * (FOOT.h - 0.2); B.vz = -B.vz * 0.8; }
    if (Math.abs(B.x) > FOOT.w) {
      if (Math.abs(B.z) < FOOT.goal) { s.score[B.x > 0 ? 0 : 1]++; if (s.score[0] >= FOOT.win || s.score[1] >= FOOT.win) { s.done = true; s.winner = s.score[0] > s.score[1] ? 0 : 1; } else kickoff(s); }
      else { B.x = Math.sign(B.x) * FOOT.w; B.vx = -B.vx * 0.8; }
    }
  }
  if (!s.done && s.time > FOOT.limit) { s.done = true; s.winner = s.score[0] === s.score[1] ? null : s.score[0] > s.score[1] ? 0 : 1; }
  return s;
}

// ───── PEINTURE : grille 16×10 ; on avance seul, une touche = virage à droite ; on repeint les cases traversées ; 45 s ─────
export const PAINT = { cols: 16, rows: 10, speed: 4, limit: 45 };
const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
export function makePaint(n) {
  const starts = [[1.5, 1.5, 0], [14.5, 8.5, 2], [14.5, 1.5, 1], [1.5, 8.5, 3]];
  return { n, time: 0, done: false, winner: null, grid: '.'.repeat(PAINT.cols * PAINT.rows), counts: Array(n).fill(0),
    players: Array.from({ length: n }, (_, i) => ({ i, x: starts[i][0], z: starts[i][1], d: starts[i][2], cd: 0, bot: false, nerve: 0.3 + Math.random() * 0.5 })) };
}
export function stepPaint(s, dt, taps) {
  s.time += dt; const g = s.grid.split('');
  for (const p of s.players) {
    p.cd = Math.max(0, p.cd - dt);
    const [dx, dz] = DIRS[p.d], ahead = [Math.floor(p.x + dx * 0.8), Math.floor(p.z + dz * 0.8)];
    const out = ahead[0] < 0 || ahead[1] < 0 || ahead[0] >= PAINT.cols || ahead[1] >= PAINT.rows;
    if (p.bot && p.cd <= 0) { const mine = !out && g[ahead[1] * PAINT.cols + ahead[0]] === String(p.i); if (out || (mine && Math.random() < p.nerve * 0.5) || Math.random() < dt * 0.5) taps[p.i] = true; }
    if (taps[p.i] && p.cd <= 0) { p.d = (p.d + 1) % 4; p.cd = 0.18; }
    else if (out) { p.d = (p.d + 1) % 4; p.cd = 0.05; }
    const [ux, uz] = DIRS[p.d]; p.x = Math.min(PAINT.cols - 0.01, Math.max(0.01, p.x + ux * PAINT.speed * dt)); p.z = Math.min(PAINT.rows - 0.01, Math.max(0.01, p.z + uz * PAINT.speed * dt));
    g[Math.floor(p.z) * PAINT.cols + Math.floor(p.x)] = String(p.i);
  }
  s.grid = g.join(''); s.counts = s.players.map((p) => g.filter((c) => c === String(p.i)).length);
  if (!s.done && s.time > PAINT.limit) { s.done = true; const m = Math.max(...s.counts), w = s.counts.map((c, i) => (c === m ? i : -1)).filter((i) => i >= 0); s.winner = w.length === 1 ? w[0] : null; }
  return s;
}
export const MAKERS = { course: (n, seed) => makeCourse(n, seed), sumo: makeSumo, sweep: makeSweep, tanks: makeTanks, football: makeFootball, paint: makePaint };
export const STEPPERS = { course: stepCourse, sumo: stepSumo, sweep: stepSweep, tanks: stepTanks, football: stepFootball, paint: stepPaint };
// Instantané réseau : nombres arrondis, données statiques (haies) exclues.
export const snapshot = (g) => JSON.parse(JSON.stringify(g, (k, v) => (k === 'hurdles' ? undefined : typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 100) / 100 : v)));
export const applySnapshot = (g, snap) => { for (const k of Object.keys(snap)) g[k] = snap[k]; return g; };

// ───────────── Rendu 3D et interface ─────────────
function stick(color) {
  const g = new THREE.Group(), ink = new THREE.MeshLambertMaterial({ color: '#15171c' }), hm = new THREE.MeshLambertMaterial({ color });
  const limb = (len, rad) => { const p = new THREE.Group(), m = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, len, 6), ink); m.position.y = -len / 2; p.add(m); return p; };
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.7, 6), ink); body.position.y = 1.05; g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 14, 10), hm); head.position.y = 1.65; g.add(head);
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.285, 0.05, 6, 14), ink); band.position.y = 1.7; band.rotation.x = Math.PI / 2; g.add(band);
  const mk = (len, x, y, rad = 0.06) => { const l = limb(len, rad); l.position.set(0, y, x); g.add(l); return l; };
  g.userData = { aL: mk(0.7, -0.14, 1.38), aR: mk(0.7, 0.14, 1.38), lL: mk(0.75, -0.08, 0.72, 0.07), lR: mk(0.75, 0.08, 0.72, 0.07) };
  return g;
}
const pose = (g, t, run) => { const u = g.userData, s = Math.sin(t * 12) * run; u.lL.rotation.z = s; u.lR.rotation.z = -s; u.aL.rotation.z = -s * 0.9; u.aR.rotation.z = s * 0.9; };
const lam = (c) => new THREE.MeshLambertMaterial({ color: c });
const bas = (c) => new THREE.MeshBasicMaterial({ color: c });

export const MODES = {
  course: { label: '🏃 Course de haies', btn: 'SAUTER', rules: ['Courez jusqu’à l’arrivée (110 m).', 'Touchez pour SAUTER les haies.', 'Une haie touchée = ralenti. Le plus rapide gagne !'] },
  sumo: { label: '💥 Sumo', btn: 'FONCER', rules: ['Votre bonhomme tourne sur lui-même.', 'Touchez pour FONCER dans la direction visée.', 'La plateforme rétrécit : poussez les autres dehors !'] },
  sweep: { label: '🌀 Balai', btn: 'SAUTER', rules: ['Un bras géant balaie la plateforme, de plus en plus vite.', 'Touchez pour SAUTER par-dessus.', 'Touché au sol = éliminé. Le dernier debout gagne !'] },
  tanks: { label: '🛡️ Chars', btn: 'TIRER', rules: ['Votre char avance seul, sa tourelle tourne.', 'Touchez pour TIRER : les obus rebondissent 2 fois sur les murs.', '3 points de vie. Le dernier char en vie gagne !'] },
  football: { label: '⚽ Football', btn: 'TIR / SPRINT', rules: ['Équipes : Rouge + Jaune contre Bleu + Vert. Premier à 3 buts.', 'Vous courez vers le ballon tout seul.', 'Touchez : TIR vers le but si le ballon est près, sinon SPRINT.'] },
  paint: { label: '🎨 Peinture', btn: 'TOURNER', rules: ['Vous avancez en peignant les cases.', 'Touchez pour TOURNER à droite (les murs aussi vous font tourner).', 'Après 45 s, la couleur qui couvre le plus de cases gagne !'] },
};
const ORDER = ['course', 'sumo', 'sweep', 'tanks', 'football', 'paint'];

export function mountArena({ hud, toast = () => {}, party = null, me = null, getPlayers = () => [] } = {}) {
  if (!hud || document.getElementById('b-arena')) return;
  const st = document.createElement('style');
  st.textContent = `#arena{position:fixed;inset:0;z-index:50;background:#0b1020;color:#fff;font-family:system-ui,sans-serif;touch-action:none;user-select:none;-webkit-user-select:none}
#arena canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
#arena .ov{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;background:rgba(8,12,28,.62);backdrop-filter:blur(8px);text-align:center;padding:16px;overflow:auto}
#arena h2{margin:0;font-size:27px;letter-spacing:1px}#arena .row{display:flex;gap:8px;flex-wrap:wrap;justify-content:center}
#arena button{font:700 15px system-ui;border:1px solid rgba(255,255,255,.35);background:rgba(255,255,255,.12);color:#fff;border-radius:14px;padding:11px 16px;backdrop-filter:blur(6px)}
#arena button.on{background:#35d0ff;color:#06121f;border-color:#fff}#arena button.go{background:#ffd23d;color:#231a00;font-size:19px;padding:14px 30px}
#arena button:disabled{opacity:.5}
#arena .pad{position:absolute;left:50%;bottom:4%;transform:translateX(-50%);width:min(70%,360px);height:20%;border-radius:28px;font:900 26px system-ui;display:flex;align-items:center;justify-content:center;opacity:.85;border:4px solid #fff}
#arena .top{position:absolute;top:10px;left:0;right:0;text-align:center;font-weight:800;text-shadow:0 2px 6px #000;pointer-events:none;padding:0 70px}
#arena .big{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:96px;font-weight:900;text-shadow:0 4px 18px #000;pointer-events:none}
#arena .x{position:absolute;top:10px;right:10px;z-index:3;padding:8px 14px}
#arena .rules{background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.3);border-radius:16px;padding:12px 18px;max-width:420px;text-align:left;font-size:15px;line-height:1.5}
#arena .seats{display:flex;gap:8px;flex-wrap:wrap;justify-content:center}#arena .seat{padding:7px 12px;border-radius:12px;border:2px solid;font-weight:700;font-size:14px;background:rgba(0,0,0,.3)}
#arena .plist{width:min(92vw,400px);max-height:26vh;overflow:auto;display:flex;flex-direction:column;gap:6px}
#arena .prow{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 10px;border-radius:12px;background:rgba(255,255,255,.1);font-weight:600}
#arena .prow button{padding:7px 12px;font-size:14px}`;
  document.head.append(st);
  const fab = document.createElement('button'); fab.id = 'b-arena'; fab.className = 'fab'; fab.textContent = '🎮'; fab.setAttribute('aria-label', 'Arène Stickman : mini-jeux avec vos amis'); fab.style.cssText = 'font-size:20px'; hud.querySelector('#hud-right')?.append(fab);

  const COLORS = ['#ff4d4d', '#3d9bff', '#ffd23d', '#4dff88'], CNAMES = ['Rouge', 'Bleu', 'Jaune', 'Vert'];
  let root, renderer, scene, cam, raf = 0, mode = 'course', game = null, figs = [], taps = [], phase = 'menu', last = 0, cd = 0, wins = [0, 0, 0, 0];
  let seat = 0, seats = [], online = false, isHost = true, snapT = 0, endT = 0, extra = {}; // seats : [{ id, username }] par place
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const nameOf = (i) => (seats[i]?.username ? `${seats[i].username}` : `${CNAMES[i]}${i >= seats.length ? ' (robot)' : ''}`);
  const lobbyOk = () => party && party.room && party.room.type === 'arena';

  function open(fromInvite = false) {
    if (root) return;
    root = el('div'); root.id = 'arena'; const cv = el('canvas'); root.append(cv);
    try { renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: false }); } catch (_) { toast('3D indisponible.'); root = null; return; }
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5)); renderer.setClearColor('#7fb7ee');
    scene = new THREE.Scene(); scene.fog = new THREE.Fog('#7fb7ee', 25, 80);
    scene.add(new THREE.HemisphereLight('#ffffff', '#6a7a60', 1.6)); const sun = new THREE.DirectionalLight('#fff4d6', 1.6); sun.position.set(6, 12, 8); scene.add(sun);
    cam = new THREE.PerspectiveCamera(55, 1, 0.1, 160);
    const close = el('button', 'x', '✕ Quitter'); close.onclick = close_; root.append(close);
    document.body.append(root); addEventListener('resize', resize); addEventListener('keydown', onKey); resize();
    document.dispatchEvent(new CustomEvent('jexarena', { detail: { open: true } }));
    online = false; seats = []; seat = 0; isHost = true; wins = [0, 0, 0, 0];
    if (lobbyOk()) { online = true; isHost = party.isHost(); }
    menu(); last = performance.now(); raf = requestAnimationFrame(loop);
  }
  function close_() {
    cancelAnimationFrame(raf); removeEventListener('resize', resize); removeEventListener('keydown', onKey);
    scene?.traverse((o) => { o.geometry?.dispose(); if (o.material) [].concat(o.material).forEach((m) => { m.map?.dispose(); m.dispose(); }); });
    renderer?.dispose(); root?.remove(); root = renderer = scene = null; game = null; figs = []; phase = 'menu';
    if (party?.room?.type === 'arena') party.leave();
    document.dispatchEvent(new CustomEvent('jexarena', { detail: { open: false } }));
  }
  function resize() { if (!renderer) return; renderer.setSize(innerWidth, innerHeight, false); cam.aspect = innerWidth / Math.max(1, innerHeight); cam.updateProjectionMatrix(); }
  function press() { if (phase !== 'play' && phase !== 'count') return; if (online && !isHost) party.send('in', { t: 1 }); else taps[seat] = true; }
  function onKey(e) { if (e.key === 'Escape') return close_(); if ([' ', 'a', 'l', 'Enter'].includes(e.key.length === 1 ? e.key.toLowerCase() : e.key)) { press(); e.preventDefault(); } }

  function clearOverlay() { root.querySelectorAll('.ov,.pad,.top,.big').forEach((n) => n.remove()); }
  function clearScene() { for (const f of figs) scene.remove(f); figs = []; scene.children.filter((o) => o.userData.arena).forEach((o) => scene.remove(o)); extra = {}; }
  const add = (o) => { o.userData.arena = true; scene.add(o); return o; };

  // ── Menu / salon ──
  function menu() {
    if (!root) return; phase = 'menu'; game = null; clearOverlay(); clearScene();
    const ov = el('div', 'ov'); ov.append(el('h2', null, '🎮 Arène Stickman'));
    ov.append(el('div', null, 'Une seule touche par joueur. Chacun joue sur SON appareil : invitez vos amis présents dans la ville — les places libres sont jouées par des robots.'));
    const guest = online && !isHost;
    if (guest) ov.append(el('div', null, 'En attente du choix de l’hôte…'));
    else {
      const r2 = el('div', 'row'); ORDER.forEach((k) => { const b = el('button', mode === k ? 'on' : '', MODES[k].label); b.onclick = () => { mode = k; menu(); }; r2.append(b); }); ov.append(r2);
      const rules = el('div', 'rules'); rules.append(el('b', null, MODES[mode].label)); MODES[mode].rules.forEach((t) => rules.append(el('div', null, '• ' + t))); ov.append(rules);
    }
    // places
    const members = online ? party.room.members : [{ id: me?.id, username: me?.username || 'Vous' }];
    const sr = el('div', 'seats'); for (let i = 0; i < 4; i++) { const s = el('div', 'seat', `${CNAMES[i]} : ${members[i] ? members[i].username + (members[i].id === me?.id ? ' (vous)' : '') : 'robot'}`); s.style.borderColor = COLORS[i]; sr.append(s); } ov.append(sr);
    if (!guest && party) {
      ov.append(el('div', null, 'Inviter un joueur présent :'));
      const list = el('div', 'plist'), pl = getPlayers(); const room = party.room;
      if (!pl.length) list.append(el('div', 'prow', 'Personne d’autre n’est dans la ville pour l’instant.'));
      pl.forEach((u) => { const row = el('div', 'prow'); row.append(el('span', null, u.username)); const inRoom = room?.members.some((m) => m.id === u.id), pending = room?.invited.includes(u.id);
        const b = el('button', null, inRoom ? '✔ dans le salon' : pending ? 'Invité…' : 'Inviter'); b.disabled = inRoom || pending || (room && room.members.length + room.invited.length >= 4);
        b.onclick = async () => { b.disabled = true; try { await party.invite(u.id, 'arena'); online = true; isHost = true; menu(); } catch (e) { toast(e.message); b.disabled = false; } }; row.append(b); list.append(row); });
      ov.append(list);
    }
    if (!guest) { const go = el('button', 'go', online && members.length > 1 ? `Jouer à ${members.length}` : 'Jouer contre des robots'); go.onclick = launchHost; ov.append(go); }
    const rec = store.get('jexcity.arena.course'); if (rec) ov.append(el('div', null, `Record course : ${(+rec).toFixed(2)} s`));
    root.append(ov);
  }
  async function launchHost() {
    if (online && party.room.members.length > 1) { try { await party.start(mode); } catch (e) { toast(e.message); } } // chacun reçoit 'start' (graine commune)
    else begin({ mode, seed: (Date.now() / 1000) | 0, players: [{ id: me?.id, username: me?.username, seat: 0 }] });
  }

  // ── Démarrage d'une manche (hôte, invités et solo) ──
  function begin({ mode: m, seed, players }) {
    if (!root) return; mode = m; clearOverlay(); clearScene(); taps = []; const n = 4;
    seats = players.slice().sort((a, b) => a.seat - b.seat); seat = Math.max(0, seats.findIndex((p) => p.id === me?.id)); if (!online) seat = 0;
    game = MAKERS[mode](n, seed); game.players.forEach((p, i) => { p.bot = i >= seats.length; });
    figs = game.players.map((p, i) => { const f = stick(COLORS[i]); scene.add(f); return f; });
    buildScene(); wins = wins || [0, 0, 0, 0];
    const b = el('div', 'pad', MODES[mode].btn); b.style.cssText = `background:${COLORS[seat]}66;border-color:${COLORS[seat]}`; b.addEventListener('pointerdown', (e) => { e.preventDefault(); press(); }); root.append(b);
    root.append(el('div', 'top', `${MODES[mode].label} — ${MODES[mode].rules[1]}`));
    phase = 'count'; cd = 3.4; endT = 0; setCamera(0);
  }
  function buildScene() {
    if (mode === 'course') {
      add(new THREE.Mesh(new THREE.BoxGeometry(TRACK + 40, 0.3, 8), lam('#9a8f7a'))).position.set(TRACK / 2, -0.15, 0);
      for (let i = 0; i < 4; i++) { const l = new THREE.Mesh(new THREE.BoxGeometry(TRACK + 40, 0.02, 0.08), bas('#fff')); l.position.set(TRACK / 2, 0.01, (i - 1.5) * 1.6 + 0.8); add(l); }
      const hm = lam('#ff8a3d'); game.hurdles.forEach((h) => game.players.forEach((p, i) => { const m = new THREE.Mesh(new THREE.BoxGeometry(HURDLE_W, h.h, 1.3), hm); m.position.set(h.x, h.h / 2, (i - 1.5) * 1.6); add(m); }));
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 8), bas('#111')); fin.position.set(TRACK, 0.02, 0); add(fin);
      [-4, 4].forEach((z) => { const a = new THREE.Mesh(new THREE.BoxGeometry(0.4, 4, 0.4), lam('#35d0ff')); a.position.set(TRACK, 2, z); add(a); });
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 8.4), lam('#ffd23d')); bar.position.set(TRACK, 4, 0); add(bar);
    } else if (mode === 'sweep') {
      add(new THREE.Mesh(new THREE.CylinderGeometry(6.2, 6.2, 0.6, 40), lam('#c9d4e8'))).position.y = -0.3;
      const ring = add(new THREE.Mesh(new THREE.TorusGeometry(6.2, 0.08, 6, 48), bas('#35d0ff'))); ring.rotation.x = Math.PI / 2; ring.position.y = 0.02;
      const sea = add(new THREE.Mesh(new THREE.PlaneGeometry(200, 200), bas('#2a6fb0'))); sea.rotation.x = -Math.PI / 2; sea.position.y = -3;
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1, 12), lam('#333'))).position.y = 0.5;
      [0, 1].forEach((k) => { const bar = new THREE.Mesh(new THREE.BoxGeometry(6, 0.5, 0.45), lam(k ? '#ff4fa3' : '#ff8a3d')); bar.geometry.translate(3, 0, 0); bar.position.y = 0.3; bar.name = 'bar' + k; add(bar); });
    } else if (mode === 'sumo') {
      const disc = add(new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.6, 40), lam('#c9d4e8'))); disc.position.y = -0.3; disc.name = 'disc';
      const sea = add(new THREE.Mesh(new THREE.PlaneGeometry(200, 200), bas('#2a6fb0'))); sea.rotation.x = -Math.PI / 2; sea.position.y = -3;
    } else if (mode === 'tanks') {
      add(new THREE.Mesh(new THREE.BoxGeometry(TANK.w * 2 + 1, 0.4, TANK.h * 2 + 1), lam('#8c9a6a'))).position.y = -0.2;
      const wm = lam('#5b4a3a'); [[0, -TANK.h - 0.3, TANK.w * 2 + 1.6, 0.6], [0, TANK.h + 0.3, TANK.w * 2 + 1.6, 0.6]].forEach(([x, z, w, d]) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, 1, d), wm); m.position.set(x, 0.5, z); add(m); });
      [-1, 1].forEach((s) => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1, TANK.h * 2 + 1.6), wm); m.position.set(s * (TANK.w + 0.3), 0.5, 0); add(m); });
      TANK.blocks.forEach((b) => { const m = new THREE.Mesh(new THREE.BoxGeometry(b.hx * 2, 1.1, b.hz * 2), lam('#a9835a')); m.position.set(b.x, 0.55, b.z); add(m); });
      extra.tanks = game.players.map((p, i) => { const g = new THREE.Group(); const body = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.45, 0.95), lam(COLORS[i])); body.position.y = 0.3; const tur = new THREE.Group(); const dome = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.38, 0.28, 12), lam(COLORS[i])); dome.position.y = 0.7; const gun = new THREE.Mesh(new THREE.BoxGeometry(1, 0.14, 0.14), lam('#222')); gun.position.set(0.55, 0.72, 0); tur.add(dome, gun); g.add(body, tur); g.userData.tur = tur; g.userData.body = body; add(g); return g; });
      figs.forEach((f) => { f.visible = false; });
      extra.bul = Array.from({ length: 24 }, () => { const m = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), bas('#222')); m.visible = false; add(m); return m; });
    } else if (mode === 'football') {
      add(new THREE.Mesh(new THREE.BoxGeometry(FOOT.w * 2 + 6, 0.4, FOOT.h * 2 + 5), lam('#2f8f3c'))).position.y = -0.2;
      const cv = document.createElement('canvas'); cv.width = 480; cv.height = 280; const c = cv.getContext('2d');
      for (let i = 0; i < 12; i++) { c.fillStyle = i % 2 ? '#2f8f3c' : '#379b45'; c.fillRect(i * 40, 0, 40, 280); }
      c.strokeStyle = '#fff'; c.lineWidth = 3; c.strokeRect(6, 6, 468, 268); c.beginPath(); c.moveTo(240, 6); c.lineTo(240, 274); c.stroke(); c.beginPath(); c.arc(240, 140, 34, 0, 7); c.stroke();
      c.strokeRect(6, 100, 30, 80); c.strokeRect(444, 100, 30, 80);
      const pit = new THREE.Mesh(new THREE.PlaneGeometry(FOOT.w * 2, FOOT.h * 2), new THREE.MeshLambertMaterial({ map: new THREE.CanvasTexture(cv) })); pit.rotation.x = -Math.PI / 2; pit.position.y = 0.01; add(pit);
      [-1, 1].forEach((s) => { const gm = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.4, FOOT.goal * 2), bas(s < 0 ? '#ffb3b3' : '#b3d1ff')); gm.position.set(s * (FOOT.w + 0.15), 0.7, 0); add(gm); });
      const bm = new THREE.Mesh(new THREE.BoxGeometry(FOOT.w * 2 + 1, 0.8, 0.4), lam('#d9dde6')); [-1, 1].forEach((s) => { const w = bm.clone(); w.position.set(0, 0.4, s * (FOOT.h + 0.2)); add(w); });
      extra.ball = add(new THREE.Mesh(new THREE.SphereGeometry(0.32, 14, 10), lam('#ffffff'))); extra.ball.position.y = 0.32;
    } else if (mode === 'paint') {
      add(new THREE.Mesh(new THREE.BoxGeometry(PAINT.cols + 1, 0.4, PAINT.rows + 1), lam('#2b3350'))).position.y = -0.2;
      const cv = document.createElement('canvas'); cv.width = PAINT.cols * 16; cv.height = PAINT.rows * 16; extra.cv = cv; extra.tex = new THREE.CanvasTexture(cv); extra.tex.colorSpace = THREE.SRGBColorSpace; extra.tex.magFilter = THREE.NearestFilter; extra.grid = '';
      const pl = new THREE.Mesh(new THREE.PlaneGeometry(PAINT.cols, PAINT.rows), new THREE.MeshBasicMaterial({ map: extra.tex })); pl.rotation.x = -Math.PI / 2; pl.position.y = 0.01; add(pl);
    }
  }
  function setCamera(dt) {
    const v = (x, y, z, lx, ly, lz) => { cam.position.set(x, y, z); cam.lookAt(lx, ly, lz); };
    if (mode === 'course') { const lead = Math.max(...game.players.map((p) => p.x)), tx = lead - 2; cam.position.lerp(new THREE.Vector3(tx + 2, 5.2, 11), dt ? Math.min(1, dt * 4) : 1); cam.lookAt(cam.position.x + 3, 0.8, 0); }
    else if (mode === 'tanks') v(0, 19, 9.5, 0, 0, 0.4);
    else if (mode === 'football') v(0, 17, 12, 0, 0, 0.5);
    else if (mode === 'paint') v(0, 15.5, 8.5, 0, 0, 0.3);
    else v(0, mode === 'sweep' ? 11 : 12, 10.5, 0, 0, 0.5);
  }
  function sync(t) {
    if (mode === 'course') game.players.forEach((p, i) => { const f = figs[i]; f.position.set(p.x, p.y, (i - 1.5) * 1.6); f.rotation.y = Math.PI / 2; pose(f, t + i, p.t != null ? 0 : p.y > 0.05 ? 0.2 : p.stun > 0 ? 0.1 : 0.9); f.rotation.x = p.stun > 0 ? -0.35 : 0; });
    else if (mode === 'sweep') {
      const b0 = scene.getObjectByName('bar0'), b1 = scene.getObjectByName('bar1'); if (b0) b0.rotation.y = -game.a; if (b1) { b1.visible = game.bars === 2; b1.rotation.y = -(game.a + Math.PI); }
      game.players.forEach((p, i) => { const f = figs[i]; if (!p.alive) { f.position.y -= 0.25; f.rotation.z += 0.2; return; } f.position.set(Math.cos(p.ang) * 4.6, p.y, Math.sin(p.ang) * 4.6); f.rotation.y = -p.ang - Math.PI / 2 + Math.PI; pose(f, t + i, p.y > 0.05 ? 0.3 : 0); });
    } else if (mode === 'sumo') {
      const disc = scene.getObjectByName('disc'); if (disc) disc.scale.set(game.radius, 1, game.radius);
      game.players.forEach((p, i) => { const f = figs[i]; if (!p.alive) { f.position.y -= 0.25; f.rotation.z += 0.2; return; } f.position.set(p.x, 0, p.z); f.rotation.y = -p.head + Math.PI / 2; pose(f, t + i, Math.min(0.8, Math.hypot(p.vx, p.vz) * 0.2 + 0.1)); });
    } else if (mode === 'tanks') {
      game.players.forEach((p, i) => { const g = extra.tanks[i]; g.visible = p.alive; g.position.set(p.x, 0, p.z); g.userData.body.rotation.y = -p.h; g.userData.tur.rotation.y = -p.a; });
      extra.bul.forEach((m, k) => { const b = game.bullets[k]; m.visible = !!b; if (b) m.position.set(b.x, 0.7, b.z); });
    } else if (mode === 'football') {
      extra.ball.position.set(game.ball.x, 0.32, game.ball.z);
      game.players.forEach((p, i) => { const f = figs[i]; f.scale.setScalar(0.8); f.position.set(p.x, 0, p.z); f.rotation.y = -Math.atan2(p.vz, p.vx) + Math.PI / 2 - Math.PI / 2 + Math.PI / 2 * 0; pose(f, t + i, Math.min(0.9, Math.hypot(p.vx, p.vz) * 0.3)); });
    } else if (mode === 'paint') {
      if (extra.grid !== game.grid) { extra.grid = game.grid; const c = extra.cv.getContext('2d'); for (let r = 0; r < PAINT.rows; r++) for (let q = 0; q < PAINT.cols; q++) { const k = game.grid[r * PAINT.cols + q]; c.fillStyle = k === '.' ? ((r + q) % 2 ? '#39426a' : '#333b60') : COLORS[+k]; c.fillRect(q * 16, r * 16, 16, 16); } extra.tex.needsUpdate = true; }
      game.players.forEach((p, i) => { const f = figs[i]; f.scale.setScalar(0.7); f.position.set(p.x - PAINT.cols / 2, 0, p.z - PAINT.rows / 2); f.rotation.y = -Math.atan2(DIRS[p.d][1], DIRS[p.d][0]) + Math.PI / 2 - Math.PI / 2; pose(f, t + i, 0.8); });
    }
  }
  function hudText() {
    if (!game || phase === 'menu') return;
    let top = root.querySelector('.top'); if (!top) return;
    if (phase === 'play') {
      if (mode === 'football') top.textContent = `⚽ ${game.score[0]} – ${game.score[1]}  (Rouge+Jaune · Bleu+Vert)`;
      else if (mode === 'paint') top.textContent = `🎨 ${Math.max(0, Math.ceil(PAINT.limit - game.time))} s — ` + game.counts.map((c, i) => `${CNAMES[i]} ${c}`).join(' · ');
      else if (mode === 'tanks') top.textContent = '🛡️ ' + game.players.map((p, i) => `${CNAMES[i]} ${'♥'.repeat(Math.max(0, p.hp))}`).join('  ');
    }
  }

  // ── Fin de manche ──
  function finish() {
    phase = 'over'; clearOverlay(); const ov = el('div', 'ov'); let title = '';
    if (mode === 'course') {
      const order = ranking(game); title = `🏁 ${nameOf(order[0].i)} gagne !`; ov.append(el('h2', null, title));
      order.forEach((p, k) => ov.append(el('div', null, `${k + 1}. ${nameOf(p.i)} — ${p.t != null ? p.t.toFixed(2) + ' s' : 'abandon'}`)));
      const h = order.find((p) => p.i === seat && p.t != null); if (h && (!store.get('jexcity.arena.course') || h.t < +store.get('jexcity.arena.course'))) { store.set('jexcity.arena.course', h.t.toFixed(2)); ov.append(el('div', null, '⭐ Nouveau record !')); }
    } else {
      const w = mode === 'football' ? (game.winner == null ? null : game.winner) : game.winner;
      const label = w == null ? 'Égalité !' : mode === 'football' ? `⚽ Équipe ${w ? 'Bleu + Vert' : 'Rouge + Jaune'} gagne ! (${game.score[0]}–${game.score[1]})` : `${nameOf(w)} gagne la manche !`;
      ov.append(el('h2', null, label)); if (w != null && mode !== 'football') wins[w]++;
      if (mode !== 'football') ov.append(el('div', null, 'Manches gagnées : ' + wins.map((x, i) => `${CNAMES[i]} ${x}`).join(' · ')));
    }
    const r = el('div', 'row');
    if (isHost) { const again = el('button', 'go', 'Rejouer'); again.onclick = launchHost; const m = el('button', null, 'Changer de jeu'); m.onclick = () => { wins = [0, 0, 0, 0]; if (online) party.end(); menu(); }; r.append(again, m); }
    else r.append(el('div', null, 'L’hôte choisit la suite…'));
    ov.append(r); root.append(ov);
  }

  // ── Boucle ──
  function loop(now) {
    raf = requestAnimationFrame(loop); const dt = Math.min(0.05, (now - last) / 1000); last = now; if (!renderer) return;
    if (game && phase !== 'menu') {
      const step = STEPPERS[mode], guest = online && !isHost;
      if (phase === 'count') {
        cd -= dt; root.querySelectorAll('.big').forEach((n) => n.remove());
        if (cd > 0) root.append(el('div', 'big', cd > 3 ? '' : String(Math.ceil(cd - 0.2) || 'GO!'))); else phase = 'play'; taps = [];
      } else if (phase === 'play' || phase === 'ending') {
        if (!guest) { step(game, dt, phase === 'play' ? taps : []); taps = []; if (game.done && phase === 'play') { phase = 'ending'; endT = 0.9; } if (phase === 'ending') { endT -= dt; if (endT <= 0) { phase = 'over'; finish(); snapT = 99; } } }
        else step(game, dt, []); // invité : prolonge localement entre deux instantanés (mouvement fluide)
        hudText();
      }
      if (online && isHost && (phase === 'play' || phase === 'ending' || phase === 'over' || phase === 'count')) { snapT += dt; if (snapT > 0.066) { snapT = 0; party.send('snap', { ph: phase, cd, w: wins, g: snapshot(game) }); } }
      sync(now / 1000); setCamera(dt);
    } else { cam.position.set(0, 6, 14); cam.lookAt(0, 0, 0); }
    renderer.render(scene, cam);
  }
  fab.addEventListener('click', () => open());

  // ── Réseau : invités ──
  if (party) {
    party.on('joined', (l) => { if (l.type === 'arena') { online = true; isHost = false; if (!root) open(); else menu(); } });
    party.on('lobby', (l) => { if (l.type !== 'arena' || !root) return; online = true; isHost = party.isHost(); if (phase === 'menu' || (l.status === 'lobby' && !isHost)) { if (l.status === 'lobby') menu(); } });
    party.on('start', (s) => { if (!root) open(); online = true; isHost = party.isHost(); wins = isHost ? wins : wins; begin(s); });
    party.on('in', (m) => { if (!isHost || !game) return; const p = seats.findIndex((x) => x.id === m.from); if (p >= 0 && phase === 'play') taps[p] = true; });
    party.on('snap', (m) => {
      if (isHost || !game || !m.d) return; const d = m.d;
      applySnapshot(game, d.g); wins = d.w || wins;
      if (d.ph === 'over' && phase !== 'over') { phase = 'over'; finish(); }
      else if (d.ph === 'count' && phase === 'count') cd = d.cd;
      else if ((d.ph === 'play' || d.ph === 'ending') && (phase === 'count' || phase === 'play')) phase = d.ph === 'ending' ? 'ending' : 'play';
    });
    party.on('closed', () => { if (root && online) { online = false; isHost = true; seats = []; toast('Le salon de jeu est fermé.'); menu(); } });
  }
  window.__arena = { open, close: close_, get game() { return game; }, get phase() { return phase; } }; // diagnostic
}
