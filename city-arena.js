// city-arena.js — JexCity : « Arène Stickman » — mini-jeux 3D de fête pour 1 à 4 joueurs sur le même appareil (style jeux Stickman Party).
// Inspiration : sensations « une seule touche par joueur » ; personnages, niveaux et ressources 100 % originaux (bonshommes bâtons générés en code).
// Modes : COURSE (haies, une touche = saut, chronométrée), SUMO (plateforme qui rétrécit, une touche = élan) et BALAI (bras tournant, une touche = saut) ; dernier debout gagne.
// Les places non occupées par un humain sont jouées par des robots. Aucun réseau, aucune base : records dans localStorage (jexcity.arena.*).
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

export function mountArena({ hud, toast = () => {} } = {}) {
  if (!hud || document.getElementById('b-arena')) return;
  const st = document.createElement('style');
  st.textContent = `#arena{position:fixed;inset:0;z-index:50;background:#0b1020;color:#fff;font-family:system-ui,sans-serif;touch-action:none;user-select:none;-webkit-user-select:none}
#arena canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
#arena .ov{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:rgba(8,12,28,.55);backdrop-filter:blur(8px);text-align:center;padding:16px}
#arena h2{margin:0;font-size:28px;letter-spacing:1px}#arena .row{display:flex;gap:10px;flex-wrap:wrap;justify-content:center}
#arena button{font:700 16px system-ui;border:1px solid rgba(255,255,255,.35);background:rgba(255,255,255,.12);color:#fff;border-radius:14px;padding:12px 18px;backdrop-filter:blur(6px)}
#arena button.on{background:#35d0ff;color:#06121f;border-color:#fff}#arena button.go{background:#ffd23d;color:#231a00;font-size:19px;padding:14px 30px}
#arena .pad{position:absolute;width:42%;height:22%;border-radius:22px;font-size:20px;display:flex;align-items:center;justify-content:center;opacity:.78;border:3px solid #fff}
#arena .top{position:absolute;top:10px;left:0;right:0;text-align:center;font-weight:800;text-shadow:0 2px 6px #000;pointer-events:none}
#arena .big{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:96px;font-weight:900;text-shadow:0 4px 18px #000;pointer-events:none}
#arena .x{position:absolute;top:10px;right:10px;z-index:3;padding:8px 14px}`;
  document.head.append(st);
  const fab = document.createElement('button'); fab.id = 'b-arena'; fab.className = 'fab'; fab.textContent = '🎮'; fab.setAttribute('aria-label', 'Arène Stickman : mini-jeux à 1-4 joueurs');
  fab.style.cssText = 'font-size:20px'; hud.querySelector('#hud-right')?.append(fab);

  let root, renderer, scene, cam, raf = 0, cfg = { humans: 1, mode: 'course' }, game = null, figs = [], taps = [], phase = 'menu', t0 = 0, last = 0, cd = 0, bestRec = {};
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };

  function open() {
    if (root) return;
    root = el('div'); root.id = 'arena';
    const cv = el('canvas'); root.append(cv);
    try { renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: false }); } catch (_) { toast('3D indisponible.'); root = null; return; }
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5)); renderer.setClearColor('#7fb7ee');
    scene = new THREE.Scene(); scene.fog = new THREE.Fog('#7fb7ee', 25, 70);
    scene.add(new THREE.HemisphereLight('#ffffff', '#6a7a60', 1.6)); const sun = new THREE.DirectionalLight('#fff4d6', 1.6); sun.position.set(6, 12, 8); scene.add(sun);
    cam = new THREE.PerspectiveCamera(55, 1, 0.1, 120);
    const close = el('button', 'x', '✕ Quitter'); close.onclick = close_; root.append(close);
    document.body.append(root); addEventListener('resize', resize); addEventListener('keydown', onKey); resize();
    document.dispatchEvent(new CustomEvent('jexarena', { detail: { open: true } }));
    menu(); last = performance.now(); raf = requestAnimationFrame(loop);
  }
  function close_() {
    cancelAnimationFrame(raf); removeEventListener('resize', resize); removeEventListener('keydown', onKey);
    scene?.traverse((o) => { o.geometry?.dispose(); if (o.material) [].concat(o.material).forEach((m) => m.dispose()); });
    renderer?.dispose(); root?.remove(); root = renderer = scene = null; game = null; figs = []; phase = 'menu';
    document.dispatchEvent(new CustomEvent('jexarena', { detail: { open: false } }));
  }
  function resize() { if (!renderer) return; renderer.setSize(innerWidth, innerHeight, false); cam.aspect = innerWidth / Math.max(1, innerHeight); cam.updateProjectionMatrix(); }
  function onKey(e) { const i = KEYS.indexOf(e.key.toLowerCase()); if (i >= 0 && i < cfg.humans) { taps[i] = true; e.preventDefault(); } if (e.key === 'Escape') close_(); }

  function clearOverlay() { root.querySelectorAll('.ov,.pad,.top,.big').forEach((n) => n.remove()); }
  function menu() {
    phase = 'menu'; clearOverlay(); clearScene();
    const ov = el('div', 'ov'); ov.append(el('h2', null, '🎮 Arène Stickman'));
    ov.append(el('div', null, 'Une touche par joueur — jusqu’à 4 sur le même écran (clavier : A · L · V · N)'));
    const r1 = el('div', 'row'), r2 = el('div', 'row');
    [1, 2, 3, 4].forEach((n) => { const b = el('button', cfg.humans === n ? 'on' : '', n + (n > 1 ? ' joueurs' : ' joueur')); b.onclick = () => { cfg.humans = n; menu(); }; r1.append(b); });
    [['course', '🏃 Course de haies'], ['sumo', '💥 Sumo'], ['sweep', '🌀 Balai']].forEach(([k, l]) => { const b = el('button', cfg.mode === k ? 'on' : '', l); b.onclick = () => { cfg.mode = k; menu(); }; r2.append(b); });
    const go = el('button', 'go', 'Jouer'); go.onclick = start;
    const rec = store.get('jexcity.arena.course'); const info = el('div', null, rec ? `Record course : ${(+rec).toFixed(2)} s` : 'Les places libres sont jouées par des robots.');
    ov.append(r1, r2, go, info); root.append(ov);
  }
  function clearScene() { for (const f of figs) scene.remove(f); figs = []; scene.children.filter((o) => o.userData.arena).forEach((o) => scene.remove(o)); }
  const add = (o) => { o.userData.arena = true; scene.add(o); return o; };

  function start() {
    clearOverlay(); clearScene(); taps = []; const n = 4;
    const seed = (Date.now() / 1000) | 0;
    game = cfg.mode === 'course' ? makeCourse(n, seed) : cfg.mode === 'sweep' ? makeSweep(n) : makeSumo(n);
    game.players.forEach((p, i) => { p.bot = i >= cfg.humans; });
    figs = game.players.map((p, i) => { const f = stick(COLORS[i]); scene.add(f); return f; });
    if (cfg.mode === 'course') {
      add(new THREE.Mesh(new THREE.BoxGeometry(TRACK + 40, 0.3, 8), new THREE.MeshLambertMaterial({ color: '#9a8f7a' }))).position.set(TRACK / 2, -0.15, 0);
      for (let i = 0; i < 4; i++) { const l = new THREE.Mesh(new THREE.BoxGeometry(TRACK + 40, 0.02, 0.08), new THREE.MeshBasicMaterial({ color: '#fff' })); l.position.set(TRACK / 2, 0.01, (i - 1.5) * 1.6 + 0.8); add(l); }
      const hm = new THREE.MeshLambertMaterial({ color: '#ff8a3d' });
      game.hurdles.forEach((h) => game.players.forEach((p, i) => { const m = new THREE.Mesh(new THREE.BoxGeometry(HURDLE_W, h.h, 1.3), hm); m.position.set(h.x, h.h / 2, (i - 1.5) * 1.6); add(m); }));
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 8), new THREE.MeshBasicMaterial({ color: '#111' })); fin.position.set(TRACK, 0.02, 0); add(fin);
      const arch = new THREE.Mesh(new THREE.BoxGeometry(0.4, 4, 0.4), new THREE.MeshLambertMaterial({ color: '#35d0ff' })); [-4, 4].forEach((z) => { const a = arch.clone(); a.position.set(TRACK, 2, z); add(a); });
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 8.4), new THREE.MeshLambertMaterial({ color: '#ffd23d' })); bar.position.set(TRACK, 4, 0); add(bar);
    } else if (cfg.mode === 'sweep') {
      const disc = add(new THREE.Mesh(new THREE.CylinderGeometry(6.2, 6.2, 0.6, 40), new THREE.MeshLambertMaterial({ color: '#c9d4e8' }))); disc.position.y = -0.3;
      const ring = add(new THREE.Mesh(new THREE.TorusGeometry(6.2, 0.08, 6, 48), new THREE.MeshBasicMaterial({ color: '#35d0ff' }))); ring.rotation.x = Math.PI / 2; ring.position.y = 0.02;
      const sea = add(new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshBasicMaterial({ color: '#2a6fb0' }))); sea.rotation.x = -Math.PI / 2; sea.position.y = -3;
      const hub = add(new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1, 12), new THREE.MeshLambertMaterial({ color: '#333' }))); hub.position.y = 0.5;
      [0, 1].forEach((k) => { const bar = new THREE.Mesh(new THREE.BoxGeometry(6, 0.5, 0.45), new THREE.MeshLambertMaterial({ color: k ? '#ff4fa3' : '#ff8a3d' })); bar.geometry.translate(3, 0, 0); bar.position.y = 0.3; bar.name = 'bar' + k; add(bar); });
    } else {
      const disc = add(new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.6, 40), new THREE.MeshLambertMaterial({ color: '#c9d4e8' }))); disc.position.y = -0.3; disc.name = 'disc';
      const sea = add(new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshBasicMaterial({ color: '#2a6fb0' }))); sea.rotation.x = -Math.PI / 2; sea.position.y = -3;
    }
    // boutons tactiles (un par joueur humain) aux quatre coins
    const pos = [['left:3%;bottom:3%'], ['right:3%;bottom:3%'], ['left:3%;bottom:27%'], ['right:3%;bottom:27%']];
    for (let i = 0; i < cfg.humans; i++) {
      const b = el('div', 'pad', `${NAMES[i]} · ${KEYS[i].toUpperCase()}`); b.style.cssText = `${pos[i]};background:${COLORS[i]}55;border-color:${COLORS[i]}`;
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); taps[i] = true; }); root.append(b);
    }
    root.append(el('div', 'top', cfg.mode === 'course' ? 'Sautez les haies — touchez votre bouton !' : cfg.mode === 'sweep' ? 'Sautez par-dessus le balai — le dernier debout gagne !' : 'Poussez vos adversaires hors de la plateforme — touchez pour foncer !'));
    phase = 'count'; cd = 3.2; setCamera(0);
  }
  function setCamera(dt) {
    if (cfg.mode === 'course') { const lead = Math.max(...game.players.map((p) => p.x)), tx = lead - 2; cam.position.lerp(new THREE.Vector3(tx + 2, 5.2, 11), dt ? Math.min(1, dt * 4) : 1); cam.lookAt(cam.position.x + 3, 0.8, 0); }
    else { cam.position.set(0, cfg.mode === 'sweep' ? 11 : 12, 10.5); cam.lookAt(0, 0, 0.5); }
  }
  function sync(t) {
    if (cfg.mode === 'course') game.players.forEach((p, i) => { const f = figs[i]; f.position.set(p.x, p.y, (i - 1.5) * 1.6); f.rotation.y = Math.PI / 2; pose(f, t + i, p.t != null ? 0 : p.y > 0.05 ? 0.2 : p.stun > 0 ? 0.1 : 0.9); f.rotation.x = p.stun > 0 ? -0.35 : 0; });
    else if (cfg.mode === 'sweep') {
      const b0 = scene.getObjectByName('bar0'), b1 = scene.getObjectByName('bar1'); if (b0) b0.rotation.y = -game.a; if (b1) { b1.visible = game.bars === 2; b1.rotation.y = -(game.a + Math.PI); }
      game.players.forEach((p, i) => { const f = figs[i]; if (!p.alive) { f.position.y -= 0.25; f.rotation.z += 0.2; return; } f.position.set(Math.cos(p.ang) * 4.6, p.y, Math.sin(p.ang) * 4.6); f.rotation.y = -p.ang - Math.PI / 2 + Math.PI; pose(f, t + i, p.y > 0.05 ? 0.3 : 0); });
    } else {
      const disc = scene.getObjectByName('disc'); if (disc) disc.scale.set(game.radius, 1, game.radius);
      game.players.forEach((p, i) => { const f = figs[i]; if (!p.alive) { f.position.y -= 0.25; f.rotation.z += 0.2; return; } f.position.set(p.x, 0, p.z); f.rotation.y = -p.head + Math.PI / 2; pose(f, t + i, Math.min(0.8, Math.hypot(p.vx, p.vz) * 0.2 + 0.1)); });
    }
  }
  let sumoRound = 0, wins = [0, 0, 0, 0];
  function finish() {
    phase = 'over'; const ov = el('div', 'ov'); let order;
    if (cfg.mode === 'course') {
      order = ranking(game); ov.append(el('h2', null, `🏁 ${NAMES[order[0].i]} gagne !`));
      order.forEach((p, k) => ov.append(el('div', null, `${k + 1}. ${NAMES[p.i]}${p.bot ? ' (robot)' : ''} — ${p.t != null ? p.t.toFixed(2) + ' s' : 'abandon'}`)));
      const h = order.find((p) => !p.bot && p.t != null); if (h && (!store.get('jexcity.arena.course') || h.t < +store.get('jexcity.arena.course'))) { store.set('jexcity.arena.course', h.t.toFixed(2)); ov.append(el('div', null, '⭐ Nouveau record !')); }
    } else {
      if (game.winner != null) wins[game.winner]++; sumoRound++;
      order = [...game.players].sort((a, b) => (b.alive ? 1e9 : b.out) - (a.alive ? 1e9 : a.out) || 0);
      ov.append(el('h2', null, game.winner != null ? `💥 ${NAMES[game.winner]} gagne la manche !` : 'Égalité !'));
      ov.append(el('div', null, 'Manches gagnées : ' + wins.map((w, i) => `${NAMES[i]} ${w}`).join(' · ')));
    }
    const r = el('div', 'row'); const again = el('button', 'go', 'Rejouer'); again.onclick = start; const m = el('button', null, 'Menu'); m.onclick = () => { wins = [0, 0, 0, 0]; sumoRound = 0; menu(); };
    r.append(again, m); ov.append(r); root.append(ov);
  }
  function loop(now) {
    raf = requestAnimationFrame(loop); const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (!renderer) return;
    if (game && phase !== 'menu') {
      if (phase === 'count') {
        cd -= dt; root.querySelectorAll('.big').forEach((n) => n.remove());
        if (cd > 0) root.append(el('div', 'big', String(Math.ceil(cd - 0.2) || 'GO!'))); else phase = 'play';
        taps = [];
      } else if (phase === 'play') {
        if (cfg.mode === 'course') stepCourse(game, dt, taps); else if (cfg.mode === 'sweep') stepSweep(game, dt, taps); else stepSumo(game, dt, taps);
        taps = []; if (game.done) setTimeout(() => { if (phase === 'ending') finish(); }, 900), phase = 'ending';
      } else if (phase === 'ending') { if (cfg.mode === 'course') stepCourse(game, dt, []); else if (cfg.mode === 'sweep') stepSweep(game, dt, []); else stepSumo(game, dt, []); }
      sync(now / 1000); setCamera(dt);
    } else { cam.position.set(0, 6, 14); cam.lookAt(0, 0, 0); }
    renderer.render(scene, cam);
  }
  fab.addEventListener('click', open);
  window.__arena = { open, close: close_, get game() { return game; }, cfg, start, get phase() { return phase; } }; // diagnostic
}
