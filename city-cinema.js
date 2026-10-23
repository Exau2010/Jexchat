// city-cinema.js — JexCity : le CINÉMA JEXCITY (ouest de la Grande Avenue). Vrai cinéma : façade Art déco avec marquise à ampoules, enseigne verticale,
// affiches rétro-éclairées, tapis rouge ; hall (guichet, bar à popcorn) ; grande salle à gradins avec 280 fauteuils, écran géant et rideaux.
// Parcours : guichet → coller l'adresse d'un film (YouTube / Vimeo / fichier .mp4, comme pour une publication) → regarder seul ou INVITER des amis
// (autres appareils, via city-party.js) → on marche jusqu'à sa place, on s'assoit, le film se lance ; on se lève quand on veut.
// Toit et murs deviennent transparents quand on est à l'intérieur. Peu de maillages (fauteuils = 1 InstancedMesh), matériaux simples, aucune texture externe.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';
import * as G from './city-geo.js';
import { parseVideo } from './city-media.js';

const L = G.LOTS.cinema, Y0 = G.TOWN.quayY, F = Y0 + 0.3;           // F : sol du hall
const X_E = L.cx + L.hx, X_W = L.cx - L.hx, Z_N = L.cz - L.hz, Z_S = L.cz + L.hz, ZC = L.cz; // façade est (avenue), mur de l'écran à l'ouest
const X_PART = -36, ROW0 = -63.2, PITCH = 2.4, STEP = 0.32, ROWS = 7, HALL_H = 15, LOBBY_H = 9;
const smooth = G.smooth;

// Hauteur du sol (hall, gradins, rampe d'accès) : enregistrée dans G.FLOORS ; pure, donc testable.
export function cinemaFloorY(x) {
  if (x > X_E - 3) return Y0 + (F - Y0) * (1 - Math.min(1, (x - (X_E - 3)) / 3));
  if (x > X_PART) return F;
  if (x < ROW0) return F;
  if (x < ROW0 + ROWS * PITCH) { const u = (x - ROW0) / PITCH, k = Math.floor(u), f = u - k; return F + STEP * k + STEP * smooth(0, 0.3, f); }
  if (x < -42) return F + STEP * ROWS;
  return G.lerp(F + STEP * ROWS, F, Math.min(1, (x + 42) / (X_PART + 42)));
}
// Fauteuils : 7 rangées × 2 blocs de 20, allée centrale (z = ZC) alignée sur la porte ; chaque fauteuil regarde l'ouest (écran).
export function cinemaSeats() {
  const seats = [];
  for (let r = 0; r < ROWS; r++) for (const blk of [0, 1]) for (let k = 0; k < 20; k++) {
    const z = blk === 0 ? ZC - 3.4 - k * 1.1 : ZC + 3.4 + k * 1.1; // k = 0 : à côté de l'allée
    seats.push({ r, blk, k, x: ROW0 + r * PITCH + 1.45, y: F + STEP * (r + 1), z });
  }
  return seats;
}
export const SEAT_YAW = -Math.PI / 2; // face à l'ouest
// Place numéro n pour un groupe (hôte = 0, invités 1, 2, 3) : rangée centrale, côte à côte, de part et d'autre de l'allée.
export function groupSeatIndex(seats, n) { const want = { r: 3, blk: n % 2, k: Math.floor(n / 2) + 3 }; return seats.findIndex((s) => s.r === want.r && s.blk === want.blk && s.k === want.k); }
// Trajet du dehors jusqu'à une place (porte → hall → allée → rangée) ; depuis l'intérieur, on garde les mêmes étapes utiles.
export function routeToSeat(from, seat) {
  const pts = [], insideHall = from.x < X_PART - 0.5 && from.x > X_W && Math.abs(from.z - ZC) < L.hz, insideLobby = from.x >= X_PART - 0.5 && from.x < X_E && Math.abs(from.z - ZC) < L.hz;
  if (!insideHall && !insideLobby) pts.push([X_E + 3.5, ZC], [X_E - 2, ZC]);
  if (!insideHall) pts.push([X_PART + 3, ZC], [X_PART - 2, ZC]);
  pts.push([seat.x, ZC], [seat.x, seat.z]);
  return pts;
}

function tex(w, h, draw) { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; draw(cv.getContext('2d'), w, h); const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; }
const lam = (c, o = {}) => new THREE.MeshLambertMaterial({ color: c, ...o });
const glow = (c) => new THREE.MeshBasicMaterial({ color: c, toneMapped: false });
const rect = (cx, cz, hx, hz, h) => ({ cx, cz, hx, hz, ax: [1, 0], az: [0, 1], h });

export function createCinema({ root, layout, pickables, party = null, me = null, toast = () => {}, panelHost = document.body, getPlayers = () => [] }) {
  const g = new THREE.Group(); g.name = 'city-cinema'; root.add(g);
  const hit = new THREE.MeshBasicMaterial({ visible: false });
  const B = (cx, cy, cz, w, h, d, m, parent = g) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(cx, cy, cz); parent.add(o); return o; };
  const pick = (cx, cy, cz, w, h, d, extra) => { const o = B(cx, cy, cz, w, h, d, hit); o.userData = { pick: 'venue', venue: 'cinema', ...extra }; pickables.push(o); return o; };
  const solid = (cx, cz, hx, hz, h) => layout.rects.push(rect(cx, cz, hx, hz, h));

  // matériaux de murs extérieurs : rendus translucides quand on est dedans
  const brick = lam('#6b2b30', { transparent: true }), cream = lam('#efe3c8', { transparent: true }), dark = lam('#24262f', { transparent: true }), gold = lam('#d9b45a');
  const wallMats = [brick, cream, dark];
  const roofMat = lam('#2c2f3a', { transparent: true }), roofGrp = new THREE.Group(); g.add(roofGrp);

  // ── Soubassement et sols ──
  B((X_W + X_E) / 2, Y0 + 0.15, ZC, L.hx * 2 + 1, 0.3, L.hz * 2 + 1, lam('#8a8478'));
  { const cv = tex(256, 256, (c) => { c.fillStyle = '#e8dcc4'; c.fillRect(0, 0, 256, 256); c.fillStyle = '#b9ab8e'; for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) if ((i + j) % 2) c.fillRect(i * 32, j * 32, 32, 32); });
    cv.wrapS = cv.wrapT = THREE.RepeatWrapping; cv.repeat.set(6, 15); const f = new THREE.Mesh(new THREE.PlaneGeometry(X_E - X_PART, L.hz * 2), new THREE.MeshLambertMaterial({ map: cv })); f.rotation.x = -Math.PI / 2; f.position.set((X_E + X_PART) / 2, F + 0.02, ZC); g.add(f); f.userData = { pick: 'venue', venue: 'floor' }; pickables.push(f); }
  // gradins : une marche par rangée + palier arrière + rampe vers le hall (moquette rouge sombre)
  const carpet = lam('#5a1220'); const stepMeshes = [];
  for (let r = 0; r < ROWS; r++) { const top = F + STEP * (r + 1), m = B(ROW0 + r * PITCH + PITCH / 2, (top + Y0) / 2, ZC, PITCH, top - Y0, L.hz * 2, carpet); m.userData = { pick: 'venue', venue: 'floor' }; stepMeshes.push(m); pickables.push(m); }
  { const top = F + STEP * ROWS, m = B(-44.2, (top + Y0) / 2, ZC, 4.8, top - Y0, L.hz * 2, carpet); m.userData = { pick: 'venue', venue: 'floor' }; pickables.push(m); }
  { const ang = Math.atan2(STEP * ROWS, 6), w = Math.hypot(6, STEP * ROWS) + 0.2, m = B(-39, F + (STEP * ROWS) / 2 - 0.05, ZC, w, 0.3, L.hz * 2, lam('#4a0f1b')); m.rotation.z = -ang; m.userData = { pick: 'venue', venue: 'floor' }; pickables.push(m); }
  B(-67.3, F + 0.5, ZC, 8.2, 1, L.hz * 2, lam('#3a2a1e')).position.y = Y0 + 0.65; // estrade devant l'écran
  G.FLOORS.push({ x0: X_W + 0.5, x1: X_E + 0.5, z0: Z_N, z1: Z_S, y: (x) => cinemaFloorY(x) });

  // ── Murs (portes : façade au centre, cloison hall/salle au centre) ──
  const W = 0.8, doorW = 9, pass = 10;
  const wall = (x0, z0, x1, z1, h, m) => { const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, w = Math.abs(x1 - x0) || W, d = Math.abs(z1 - z0) || W; B(cx, Y0 + h / 2, cz, w, h, d, m); solid(cx, cz, w / 2, d / 2, h); };
  const seg = (xa, za, xb, zb, h, m) => wall(Math.min(xa, xb), Math.min(za, zb), Math.max(xa, xb), Math.max(za, zb), h, m);
  seg(X_W, Z_N, X_W, Z_S, HALL_H, brick);                                  // mur de l'écran (ouest)
  seg(X_W, Z_N, X_PART, Z_N, HALL_H, brick); seg(X_W, Z_S, X_PART, Z_S, HALL_H, brick); // salle nord/sud
  seg(X_PART, Z_N, X_E, Z_N, LOBBY_H, cream); seg(X_PART, Z_S, X_E, Z_S, LOBBY_H, cream); // hall nord/sud
  seg(X_PART, Z_N, X_PART, ZC - pass / 2, HALL_H, dark); seg(X_PART, ZC + pass / 2, X_PART, Z_S, HALL_H, dark); // cloison avec double porte
  B(X_PART, Y0 + 12.25, ZC, W, HALL_H - 9.5, pass, dark); B(X_PART, Y0 + 5.6, ZC, 0.5, 0.6, pass + 0.6, gold);        // linteau + frise dorée
  seg(X_E, Z_N, X_E, ZC - doorW / 2, LOBBY_H, cream); seg(X_E, ZC + doorW / 2, X_E, Z_S, LOBBY_H, cream);           // façade est avec porte centrale
  B(X_E, Y0 + 7.4, ZC, W, LOBBY_H - 5.8, doorW, cream);                                                             // au-dessus de la porte
  // vitrage de la porte (panneaux translucides) et cadres dorés
  const glass = new THREE.MeshLambertMaterial({ color: '#9fd0ff', transparent: true, opacity: 0.28 }); B(X_E, Y0 + 2.9, ZC, 0.12, 5.6, doorW, glass); for (const z of [ZC - doorW / 2, ZC, ZC + doorW / 2]) B(X_E + 0.05, Y0 + 2.9, z, 0.3, 5.7, 0.25, gold);
  // façade : pilastres, bandeau, grandes fenêtres éclairées de chaque côté
  for (const sz of [-1, 1]) { for (let k = 0; k < 3; k++) { const z = ZC + sz * (8 + k * 6.2); B(X_E + 0.25, Y0 + 3.6, z, 0.7, 7.2, 1, lam('#f6ecd3')); } B(X_E + 0.1, Y0 + 3, ZC + sz * 17, 0.3, 4.6, 7.4, glow('#ffe2a8')); B(X_E + 0.14, Y0 + 3, ZC + sz * 17, 0.3, 0.2, 7.5, gold); }
  B(X_E + 0.7, Y0 + LOBBY_H - 0.6, ZC, 1.6, 1.2, L.hz * 2 + 1, gold); // corniche
  // tour d'enseigne verticale (Art déco) + enseigne horizontale
  B(X_E + 0.8, Y0 + 15.5, ZC, 1.6, 13, 5.5, lam('#8d1a2b')); B(X_E + 1.7, Y0 + 15.5, ZC - 2.9, 0.4, 13.4, 0.3, gold); B(X_E + 1.7, Y0 + 15.5, ZC + 2.9, 0.4, 13.4, 0.3, gold);
  const vt = tex(128, 512, (c, w, h) => { c.fillStyle = '#8d1a2b'; c.fillRect(0, 0, w, h); c.fillStyle = '#fff3c4'; c.font = '900 84px system-ui,sans-serif'; c.textAlign = 'center'; c.shadowColor = '#ffb347'; c.shadowBlur = 18; 'CINÉMA'.split('').forEach((ch, i) => c.fillText(ch, w / 2, 90 + i * 76)); });
  const vs = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 12.2), new THREE.MeshBasicMaterial({ map: vt, toneMapped: false })); vs.rotation.y = Math.PI / 2; vs.position.set(X_E + 1.62, Y0 + 15.5, ZC); g.add(vs);
  const hz = tex(1024, 192, (c, w, h) => { c.fillStyle = '#16121a'; c.fillRect(0, 0, w, h); c.strokeStyle = '#ffd23d'; c.lineWidth = 8; c.strokeRect(8, 8, w - 16, h - 16); c.fillStyle = '#fff'; c.font = '900 92px system-ui,sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.shadowColor = '#ff3b5c'; c.shadowBlur = 24; c.fillText('JEXCITY CINÉMA', w / 2, h / 2 + 4); });
  const hs = new THREE.Mesh(new THREE.PlaneGeometry(14, 2.6), new THREE.MeshBasicMaterial({ map: hz, toneMapped: false })); hs.rotation.y = Math.PI / 2; hs.position.set(X_E + 3.6, Y0 + 7.9, ZC); g.add(hs);
  B(X_E + 3.5, Y0 + 7.9, ZC, 0.3, 3, 14.4, dark);
  // marquise (auvent) à ampoules, colonnes, tapis rouge, affiches
  B(X_E + 2.6, Y0 + 6.3, ZC, 5.6, 0.5, 16, lam('#8d1a2b'));
  const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.16, 8, 6), glow('#ffe27a'), 52), d = new THREE.Object3D(); let bi = 0;
  for (let k = 0; k < 17; k++) { d.position.set(X_E + 5.4, Y0 + 6.0, ZC - 8 + k * 1); d.updateMatrix(); bulbs.setMatrixAt(bi++, d.matrix); }
  for (let k = 0; k < 5; k++) for (const sz of [-1, 1]) { d.position.set(X_E + 5.4 - k * 1.2, Y0 + 6.0, ZC + sz * 8); d.updateMatrix(); bulbs.setMatrixAt(bi++, d.matrix); }
  bulbs.count = bi; g.add(bulbs);
  for (const sz of [-1, 1]) { const col = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.4, 6.1, 14), lam('#f6ecd3')); col.position.set(X_E + 5.2, Y0 + 3.2, ZC + sz * 7.4); g.add(col); solid(X_E + 5.2, ZC + sz * 7.4, 0.45, 0.45, 6); B(X_E + 5.2, Y0 + 0.5, ZC + sz * 7.4, 1.1, 0.4, 1.1, gold); }
  const rc = B(X_E + 4, Y0 + 0.36, ZC, 12.5, 0.07, 6, lam('#b0132e')); rc.userData = { pick: 'venue', venue: 'floor' }; pickables.push(rc);
  const posters = [['#ff6b3d', '#ffd23d', 'AVENTURE'], ['#2b6bff', '#9fe6ff', 'SCIENCE-FICTION'], ['#8d1a2b', '#ffb3c1', 'ROMANCE'], ['#1e9d5a', '#d8ffc9', 'FAMILLE'], ['#6a2bd1', '#e0c7ff', 'MYSTÈRE'], ['#e0a31b', '#fff0b3', 'COMÉDIE']];
  posters.forEach(([a, b, t], i) => { const side = i < 3 ? -1 : 1, k = i % 3, z = ZC + side * (11.5 + k * 5.2);
    const pt = tex(256, 384, (c, w, h) => { const gr = c.createLinearGradient(0, 0, w, h); gr.addColorStop(0, a); gr.addColorStop(1, '#14101c'); c.fillStyle = gr; c.fillRect(0, 0, w, h); c.fillStyle = b; c.beginPath(); c.arc(w / 2, 150, 64, 0, 7); c.fill(); c.fillStyle = 'rgba(0,0,0,.35)'; c.fillRect(0, 262, w, 122); c.fillStyle = '#fff'; c.font = '800 28px system-ui,sans-serif'; c.textAlign = 'center'; c.fillText(t, w / 2, 316); c.font = '600 18px system-ui,sans-serif'; c.fillText('À L’AFFICHE', w / 2, 350); });
    B(X_E + 0.3, Y0 + 3.4, z, 0.3, 4.2, 3.3, lam('#1c1a22')); const p = new THREE.Mesh(new THREE.PlaneGeometry(2.9, 3.9), new THREE.MeshBasicMaterial({ map: pt, toneMapped: false })); p.rotation.y = Math.PI / 2; p.position.set(X_E + 0.5, Y0 + 3.4, z); g.add(p); pick(X_E + 0.6, Y0 + 3.4, z, 0.8, 4.2, 3.3, { tip: 1 }); });

  // ── Hall : guichet, bar à popcorn, bancs, plantes, lustre ──
  { const cx = -30, cz = Z_N + 7; B(cx, F + 0.55, cz, 8, 1.1, 1.4, lam('#5b3b24')); B(cx, F + 1.15, cz, 8.2, 0.12, 1.6, lam('#e9dcc8')); solid(cx, cz, 4, 0.8, 1.4);
    for (const dx of [-2.2, 2.2]) B(cx + dx, F + 1.6, cz - 0.2, 0.9, 0.9, 0.12, glow('#9fe6ff'));
    const st = tex(512, 128, (c, w, h) => { c.fillStyle = '#16121a'; c.fillRect(0, 0, w, h); c.fillStyle = '#ffd23d'; c.font = '900 64px system-ui,sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('🎟️ GUICHET — FILMS', w / 2, h / 2); });
    const sp = new THREE.Mesh(new THREE.PlaneGeometry(8, 2), new THREE.MeshBasicMaterial({ map: st, toneMapped: false })); sp.position.set(cx, F + 4.2, Z_N + 0.5); g.add(sp); pick(cx, F + 2, cz, 8.4, 3.6, 2, { booth: 1 }); pick(cx, F + 4.2, Z_N + 0.6, 8, 2, 0.8, { booth: 1 }); }
  { const cx = -30, cz = Z_S - 7; B(cx, F + 0.55, cz, 9, 1.1, 1.5, lam('#a31f2d')); B(cx, F + 1.15, cz, 9.2, 0.12, 1.7, lam('#f3e9d2')); solid(cx, cz, 4.5, 0.85, 1.4);
    for (let k = 0; k < 4; k++) { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.3, 0.8, 10), lam(k % 2 ? '#fff' : '#d62839')); m.position.set(cx - 3 + k * 2, F + 1.65, cz); g.add(m); }
    const st = tex(512, 128, (c, w, h) => { c.fillStyle = '#16121a'; c.fillRect(0, 0, w, h); c.fillStyle = '#ff9f43'; c.font = '900 64px system-ui,sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('🍿 POPCORN', w / 2, h / 2); });
    const sp = new THREE.Mesh(new THREE.PlaneGeometry(8, 2), new THREE.MeshBasicMaterial({ map: st, toneMapped: false })); sp.rotation.y = Math.PI; sp.position.set(cx, F + 4.2, Z_S - 0.5); g.add(sp); pick(cx, F + 2, cz, 9.4, 3.6, 2, { snack: 1 }); }
  for (const z of [ZC - 14, ZC + 14]) { B(-27.5, F + 0.3, z, 1.2, 0.5, 4, lam('#3a2a1e')); const pl = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 8), lam('#2f8f3c')); pl.position.set(-27.5, F + 1.7, z + 2.9); g.add(pl); B(-27.5, F + 0.6, z + 2.9, 0.9, 1.2, 0.9, lam('#7a5a3a')); }
  { const lus = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.14, 8, 28), glow('#ffe6a8')); lus.rotation.x = Math.PI / 2; lus.position.set(-30, F + LOBBY_H - 1.6, ZC); g.add(lus); B(-30, F + LOBBY_H - 0.9, ZC, 0.1, 1.5, 0.1, dark); }

  // ── Salle : écran, rideaux, murs capitonnés, fauteuils, éclairage ──
  const scrCv = document.createElement('canvas'); scrCv.width = 1024; scrCv.height = 436; const scrTex = new THREE.CanvasTexture(scrCv); scrTex.colorSpace = THREE.SRGBColorSpace;
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(26, 11), new THREE.MeshBasicMaterial({ map: scrTex, toneMapped: false })); scr.rotation.y = Math.PI / 2; scr.position.set(X_W + 0.55, F + 7.4, ZC); g.add(scr);
  scr.userData = { pick: 'venue', venue: 'cinema', booth: 1 }; pickables.push(scr);
  B(X_W + 0.5, F + 7.4, ZC, 0.25, 11.8, 27.2, lam('#111')); B(X_W + 0.75, F + 7.4, ZC, 0.25, 11.4, 26.6, glow('#fff')).visible = false;
  for (const sz of [-1, 1]) { B(X_W + 1.4, F + 7.5, ZC + sz * 16.6, 1.6, 15, 6, lam('#a1122c')); B(X_W + 1.4, F + 7.5, ZC + sz * 20.8, 1.6, 15, 2.6, lam('#7d0e22')); }
  B(X_W + 1.4, F + 14, ZC, 1.6, 2.2, 27, lam('#a1122c')); // lambrequin
  const wallPanel = lam('#3b1018'); for (const sz of [-1, 1]) for (let k = 0; k < 8; k++) B(G.lerp(X_W + 6, X_PART - 4, k / 7), F + 5, ZC + sz * (L.hz - 0.7), 3.2, 7, 0.3, wallPanel), B(G.lerp(X_W + 6, X_PART - 4, k / 7), F + 9.5, ZC + sz * (L.hz - 0.45), 3.2, 0.25, 0.2, glow('#ffcf7a'));
  const seatGeo = (() => { const a = new THREE.BoxGeometry(0.8, 0.22, 0.8); a.translate(0, 0.34, 0); const b = new THREE.BoxGeometry(0.16, 0.9, 0.8); b.translate(0.34, 0.8, 0); const c = new THREE.BoxGeometry(0.7, 0.1, 0.08); c.translate(0, 0.56, 0.44); const e = c.clone(); e.translate(0, 0, -0.88); return mergeGeometries([a, b, c, e]); })();
  const seats = cinemaSeats(), seatMesh = new THREE.InstancedMesh(seatGeo, new THREE.MeshLambertMaterial({ color: '#b3122e' }), seats.length); seatMesh.frustumCulled = false;
  seats.forEach((s, i) => { d.position.set(s.x, s.y, s.z); d.rotation.set(0, 0, 0); d.updateMatrix(); seatMesh.setMatrixAt(i, d.matrix); }); seatMesh.instanceMatrix.needsUpdate = true; seatMesh.userData = { pick: 'seat' }; g.add(seatMesh); pickables.push(seatMesh);
  for (let r = 0; r < ROWS; r++) B(ROW0 + r * PITCH + 0.2, F + STEP * (r + 1) + 0.04, ZC, 0.12, 0.06, 56, glow('#ffb347')); // liserés d'allée
  // plafond de la salle (disparaît quand on entre) + toit du hall + corniche
  const rf = new THREE.Mesh(new THREE.BoxGeometry(X_PART - X_W + 1, 0.8, L.hz * 2 + 1), roofMat); rf.position.set((X_W + X_PART) / 2, Y0 + HALL_H + 0.4, ZC); roofGrp.add(rf);
  const rf2 = new THREE.Mesh(new THREE.BoxGeometry(X_E - X_PART + 1, 0.8, L.hz * 2 + 1), roofMat); rf2.position.set((X_PART + X_E) / 2, Y0 + LOBBY_H + 0.4, ZC); roofGrp.add(rf2);
  for (let k = 0; k < 4; k++) { const sk = new THREE.Mesh(new THREE.BoxGeometry(6, 0.5, 6), glow('#bfe3ff')); sk.position.set(-60 + k * 7, Y0 + HALL_H + 0.9, ZC); roofGrp.add(sk); }

  // ── Écran : affiche d'attente / titre du film en cours ──
  let film = null; // { url, title, t0 (ms locale) }
  function drawScreen(t = 0) {
    const c = scrCv.getContext('2d'), w = scrCv.width, h = scrCv.height; const gr = c.createLinearGradient(0, 0, w, h);
    gr.addColorStop(0, film ? '#1b2a52' : '#241226'); gr.addColorStop(1, '#0a0a12'); c.fillStyle = gr; c.fillRect(0, 0, w, h);
    c.fillStyle = 'rgba(255,255,255,.08)'; for (let i = 0; i < 40; i++) c.fillRect(((i * 97 + t * 30) % w), (i * 53) % h, 3, 3);
    c.textAlign = 'center'; c.fillStyle = '#fff'; c.font = '800 54px system-ui,sans-serif';
    if (film) { c.fillText('▶ SÉANCE EN COURS', w / 2, 170); c.font = '700 40px system-ui,sans-serif'; c.fillStyle = '#ffd23d'; c.fillText((film.title || 'Film surprise').slice(0, 38), w / 2, 240); c.font = '500 28px system-ui,sans-serif'; c.fillStyle = '#cfe3ff'; c.fillText('Asseyez-vous pour regarder', w / 2, 300); }
    else { c.fillText('🎬 JEXCITY CINÉMA', w / 2, 180); c.font = '500 32px system-ui,sans-serif'; c.fillStyle = '#ffd7a8'; c.fillText('Choisissez un film au guichet', w / 2, 250); }
    scrTex.needsUpdate = true;
  }
  drawScreen();

  // ── Interface : guichet, séance, bouton « se lever » ──
  const css = `position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:46;width:min(92vw,430px);max-height:84vh;overflow:auto;padding:18px;border-radius:22px;color:#fff;font-family:system-ui,sans-serif;background:linear-gradient(135deg,rgba(40,16,26,.93),rgba(14,14,26,.93));border:1px solid rgba(255,255,255,.35);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);box-shadow:0 10px 40px rgba(0,0,0,.6)`;
  const mk = (tag, css2, txt) => { const e = document.createElement(tag); if (css2) e.style.cssText = css2; if (txt != null) e.textContent = txt; return e; };
  const bt = (label, fn, primary) => { const b = mk('button', `display:block;width:100%;margin:8px 0;padding:13px;border-radius:14px;font:700 16px system-ui;border:1px solid rgba(255,255,255,.4);color:${primary ? '#1b1400' : '#fff'};background:${primary ? '#ffd23d' : 'rgba(255,255,255,.14)'}`, label); b.onclick = fn; return b; };
  let panel = null; const closePanel = () => { panel?.remove(); panel = null; };
  function shell(title, sub) {
    closePanel(); panel = mk('div', css); panel.append(mk('div', 'font:800 22px system-ui;margin-bottom:4px', title), mk('div', 'opacity:.85;margin-bottom:12px;font-size:14px', sub));
    const x = mk('button', 'position:absolute;top:10px;right:12px;background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.4);color:#fff;border-radius:12px;padding:6px 11px;font-size:16px', '✕'); x.setAttribute('aria-label', 'Fermer'); x.onclick = closePanel; panel.append(x); panelHost.append(panel); return panel;
  }
  const input = (ph, v = '') => { const i = mk('input', 'width:100%;box-sizing:border-box;margin:5px 0;padding:12px;border-radius:12px;border:1px solid rgba(255,255,255,.4);background:rgba(255,255,255,.12);color:#fff;font:16px system-ui'); i.placeholder = ph; i.value = v; i.setAttribute('autocomplete', 'off'); i.setAttribute('autocapitalize', 'off'); return i; };
  const validUrl = (v) => { const p = parseVideo(v); return p.type !== 'unknown' || /^https:\/\/\S{4,}$/.test((v || '').trim()); };

  function openBooth() {
    const p = shell('🎟️ Guichet du cinéma', 'Collez l’adresse d’un film (YouTube, Vimeo ou fichier .mp4), comme pour une publication, puis choisissez : seul(e) ou avec des amis.');
    const url = input('https://… adresse du film', film?.url || ''), title = input('Titre (facultatif)', film?.title || '');
    const msg = mk('div', 'color:#ffb3b3;font-size:14px;min-height:18px'); p.append(url, title, msg);
    const ok = () => { const v = url.value.trim(); if (!validUrl(v)) { msg.textContent = 'Adresse invalide : elle doit commencer par https://'; return null; } msg.textContent = ''; return { url: v, title: title.value.trim().slice(0, 80) }; };
    p.append(bt('🎬 Regarder seul(e)', () => { const f = ok(); if (!f) return; closePanel(); startFilm(f, 0, false); }, true));
    const inRoom = party?.room?.type === 'cinema';
    if (inRoom && party.isHost()) p.append(bt('🔁 Changer le film de ma séance', async () => { const f = ok(); if (!f) return; try { await party.film(f.url, f.title); closePanel(); } catch (e) { msg.textContent = e.message; } }));
    if (party && (!inRoom || party.isHost())) {
      p.append(mk('div', 'margin-top:10px;font-weight:700', 'Inviter un ami présent dans la ville (sur son appareil) :'));
      const pl = getPlayers(), list = mk('div', 'display:flex;flex-direction:column;gap:6px;max-height:24vh;overflow:auto');
      if (!pl.length) list.append(mk('div', 'opacity:.8;font-size:14px', 'Personne d’autre n’est dans la ville pour l’instant. Vous pouvez regarder seul(e), puis inviter quelqu’un plus tard.'));
      pl.forEach((u) => { const row = mk('div', 'display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 10px;border-radius:12px;background:rgba(255,255,255,.1)'); row.append(mk('span', 'font-weight:600', u.username));
        const b = mk('button', 'padding:8px 14px;border-radius:12px;border:1px solid rgba(255,255,255,.4);background:#ffd23d;color:#1b1400;font:700 14px system-ui', 'Inviter');
        b.onclick = async () => { const f = ok(); if (!f) return; b.disabled = true; try { await party.invite(u.id, 'cinema', f); b.textContent = 'Invité ✔'; if (!film || film.url !== f.url) startFilm(f, 0, true); } catch (e) { msg.textContent = e.message; b.disabled = false; } };
        row.append(b); list.append(row); });
      p.append(list);
    }
    p.append(mk('div', 'margin-top:10px;font-size:12px;opacity:.7', 'Astuce : une fois dans la salle, touchez un fauteuil pour vous asseoir, et le sol pour vous lever.'));
  }
  function openSnack() {
    const p = shell('🍿 Bar du cinéma', 'Un en-cas pour la séance : il s’affiche au-dessus de votre personnage.');
    for (const t of ['🍿 Mange du popcorn', '🥤 Boit un soda', '🍫 Grignote des bonbons']) p.append(bt(t, () => { actions.setMood?.(t); toast('Bon appétit !'); closePanel(); }));
  }
  const actions = {};

  // lecteur de film (au-dessus de la scène 3D, tant que le joueur est assis)
  let view = null;
  function closeView() { view?.remove(); view = null; }
  function openView() {
    closeView(); if (!film) { toast('Aucun film : passez au guichet pour en choisir un.'); return; }
    view = mk('div', 'position:fixed;left:0;right:0;top:0;z-index:44;display:flex;flex-direction:column;align-items:center;padding:calc(env(safe-area-inset-top,0px) + 8px) 8px 0;pointer-events:none');
    const box = mk('div', 'pointer-events:auto;width:min(96vw,calc(58vh * 16 / 9));aspect-ratio:16/9;background:#000;border-radius:10px;overflow:hidden;box-shadow:0 0 0 6px #2b0f16,0 0 40px rgba(255,190,90,.55);position:relative');
    const info = parseVideo(film.url), el = Math.max(0, Math.round((Date.now() - film.t0) / 1000));
    if (info.type === 'youtube' || info.type === 'vimeo') {
      const f = mk('iframe', 'position:absolute;inset:0;width:100%;height:100%;border:0'); f.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture; fullscreen'); f.setAttribute('allowfullscreen', ''); f.setAttribute('title', film.title || 'Film'); f.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
      f.src = info.type === 'youtube' ? `${info.embed}&autoplay=1&start=${el}` : `${info.embed}?autoplay=1#t=${el}s`; box.append(f);
    } else {
      const v = mk('video', 'position:absolute;inset:0;width:100%;height:100%;background:#000'); v.controls = true; v.autoplay = true; v.playsInline = true; v.setAttribute('referrerpolicy', 'no-referrer'); v.src = film.url;
      v.addEventListener('loadedmetadata', () => { try { if (el > 2 && el < v.duration) v.currentTime = el; } catch (_) { /* non bloquant */ } }, { once: true });
      v.addEventListener('error', () => { const a = mk('a', 'position:absolute;inset:0;display:grid;place-items:center;color:#f0b463;font:700 16px system-ui;text-align:center;padding:16px', 'Ce lien ne peut pas être lu ici. Touchez pour l’ouvrir dans un nouvel onglet.'); a.href = film.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; box.replaceChildren(a); }, { once: true }); box.append(v);
    }
    const bar = mk('div', 'pointer-events:auto;display:flex;gap:8px;align-items:center;margin-top:8px;color:#fff;font:700 14px system-ui;text-shadow:0 1px 4px #000');
    const up = mk('button', 'padding:9px 16px;border-radius:14px;border:1px solid rgba(255,255,255,.5);background:rgba(20,16,26,.85);color:#fff;font:700 15px system-ui', '🧍 Se lever'); up.onclick = standUp;
    bar.append(mk('span', null, '🎬 ' + (film.title || 'Séance')), up); view.append(box, bar); document.body.append(view);
  }

  // ── Séance : film courant, places, assise ──
  let seatedIdx = -1, wantSit = null, sitAvatar = null;
  const occupiedBy = (i, remotes) => { const s = seats[i]; for (const r of remotes) if (Math.hypot(r.x - s.x, r.z - s.z) < 0.5) return true; return false; };
  function startFilm(f, memberIndex = 0, invited = false) {
    film = { url: f.url, title: f.title || '', t0: Date.now() - (f.elapsed || 0) * 1000 }; drawScreen(); goSit(memberIndex);
    if (invited) toast('Invitation envoyée : installez-vous, la séance commence.');
  }
  function goSit(n) {
    const pl = host.getPlayer?.(); if (!pl) return; let i = groupSeatIndex(seats, n); const rem = host.remotes?.() || [];
    for (let guard = 0; guard < 40 && (i < 0 || occupiedBy(i, rem)); guard++) i = groupSeatIndex(seats, n + guard + 1);
    if (i < 0) i = seats.findIndex((s, k) => !occupiedBy(k, rem)); sitAt(i);
  }
  function sitAt(i) {
    const s = seats[i], pl = host.getPlayer?.(); if (!s || !pl) return;
    if (seatedIdx >= 0) standUp(true);
    const route = routeToSeat({ x: pl.x, z: pl.z }, s); wantSit = i; host.walkPath?.(route); toast('Direction : votre fauteuil…');
  }
  function arrived(i) { // appelé par la boucle principale quand le joueur a fini son trajet
    const s = seats[i]; seatedIdx = i; wantSit = null; const pl = host.getPlayer?.(); if (pl) { pl.x = s.x; pl.z = s.z; pl.path = []; pl.sitting = true; }
    host.sit?.(true, SEAT_YAW); host.emitMove?.(s.x, s.z, s.x, s.z); if (film) openView(); else { toast('Fauteuil trouvé ! Choisissez un film au guichet pour lancer la séance.'); }
  }
  function standUp(silent) {
    closeView(); const was = seatedIdx >= 0; seatedIdx = -1; wantSit = null; const pl = host.getPlayer?.();
    if (pl && was) { pl.sitting = false; host.sit?.(false); const tz = ZC + (pl.z < ZC ? -1 : 1) * 2.2; const x = pl.x, z = pl.z; host.walkPath?.([[x, tz]]); void z; }
    if (!silent && was) toast('Vous vous êtes levé(e).');
  }
  const host = { getPlayer: null, remotes: null, walkPath: null, sit: null, emitMove: null };

  // ── Salon (invités / hôte) ──
  if (party) {
    party.on('joined', (l) => { if (l.type !== 'cinema' || !l.film) return; const k = Math.max(0, l.members.findIndex((m) => m.id === me?.id)); startFilm(l.film, k); });
    party.on('film', (f) => { if (!party.room || party.room.id !== f.id) return; film = { url: f.film.url, title: f.film.title, t0: Date.now() }; drawScreen(); if (seatedIdx >= 0) openView(); else toast('Le film a changé.'); });
    party.on('lobby', (l) => { if (l.type !== 'cinema' || !l.film || film) return; /* hôte : film déjà posé à l'invitation */ });
    party.on('closed', () => { /* la séance continue seul(e) : on garde le film en cours */ });
  }

  // Une place reste « assise » tant que le joueur n'a pas bougé ailleurs (appelé quand il clique ailleurs).
  const inside = (x, z) => x > X_W && x < X_E && Math.abs(z - ZC) < L.hz;
  let flick = 0;
  return {
    group: g, host, actions, inside, seats,
    bind(o) { Object.assign(host, o); },
    openBooth, openSnack, open(k, data) { if (data?.snack) openSnack(); else openBooth(); },
    pickSeat(i) { if (Number.isInteger(i) && seats[i]) sitAt(i); },
    sitNearest() { const pl = host.getPlayer?.(); if (!pl) return; const rem = host.remotes?.() || []; let b = -1, bd = 1e9; seats.forEach((s, k) => { if (s.r < 2 || s.r > 4 || occupiedBy(k, rem)) return; const dd = Math.hypot(s.x - pl.x, s.z - pl.z); if (dd < bd) { bd = dd; b = k; } }); sitAt(b); },
    standUp, get seated() { return seatedIdx >= 0; }, get wanting() { return wantSit; }, arrived,
    // un fauteuil occupé par un autre joueur (affiché assis chez les autres) : position exacte d'un fauteuil et immobile
    seatAt(x, z) { if (x > X_PART || x < X_W) return null; const r = Math.round((x - ROW0 - 1.45) / PITCH); if (r < 0 || r >= ROWS) return null; const sx = ROW0 + r * PITCH + 1.45; if (Math.abs(x - sx) > 0.08) return null; return { yaw: SEAT_YAW, y: 0 }; },
    update(t, player) {
      flick += 1; const inn = !!player && inside(player.x, player.z);
      roofGrp.visible = !inn; for (const m of wallMats) { m.opacity += ((inn ? 0.22 : 1) - m.opacity) * 0.12; m.depthWrite = m.opacity > 0.9; }
      if (flick % 10 === 0) bulbs.material.color.setScalar(0.85 + 0.15 * Math.sin(t * 6));
      if (film && flick % 24 === 0) drawScreen(t);
      if (wantSit != null && player && !player.path.length) arrived(wantSit);
    },
  };
}
