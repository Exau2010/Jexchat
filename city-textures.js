// city-textures.js — JexCity : textures procédurales (canvas) avec relief.
// Pour chaque surface on dessine UNE description (en rôles : mur, vitre, volet…) dans quatre « modes » :
//   color (albédo) · height (relief → carte de normales) · rough (rugosité) · emis (fenêtres allumées la nuit).
// Les quatre cartes sont donc parfaitement alignées. Aucune ressource externe.
import * as THREE from 'three';
import * as G from './city-geo.js';

const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const gray = (v) => { const n = Math.round(Math.max(0, Math.min(1, v)) * 255); return `rgb(${n},${n},${n})`; };

// Hauteur (canvas niveaux de gris) → carte de normales (Sobel, répétition sans couture).
export function heightToNormal(hc, strength = 2) {
  const w = hc.width, h = hc.height, src = hc.getContext('2d').getImageData(0, 0, w, h).data;
  const out = canvas(w, h), ctx = out.getContext('2d'), img = ctx.createImageData(w, h), d = img.data;
  const n = w * h, Hh = new Float64Array(n); // hauteur lue une seule fois (canal rouge, 0..1)
  for (let i = 0; i < n; i++) Hh[i] = src[i * 4] / 255;
  for (let y = 0; y < h; y++) {
    const r0 = ((y - 1 + h) % h) * w, r1 = y * w, r2 = ((y + 1) % h) * w; // lignes voisines, bouclées
    for (let x = 0; x < w; x++) {
      const xl = x === 0 ? w - 1 : x - 1, xr = x === w - 1 ? 0 : x + 1;
      const dx = (Hh[r0 + xr] + 2 * Hh[r1 + xr] + Hh[r2 + xr]) - (Hh[r0 + xl] + 2 * Hh[r1 + xl] + Hh[r2 + xl]);
      const dy = (Hh[r2 + xl] + 2 * Hh[r2 + x] + Hh[r2 + xr]) - (Hh[r0 + xl] + 2 * Hh[r0 + x] + Hh[r0 + xr]);
      const nx = -dx * strength, ny = dy * strength, il = 1 / Math.hypot(nx, ny, 1);
      const o = (r1 + x) * 4; d[o] = (nx * il * 0.5 + 0.5) * 255; d[o + 1] = (ny * il * 0.5 + 0.5) * 255; d[o + 2] = (il * 0.5 + 0.5) * 255; d[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0); return out;
}
function tex(c, srgb = false, aniso = 4) {
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = aniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t;
}
const rnd = G.rng;

// ─── Façades ──────────────────────────────────────────────────────────────────
// rôle → [couleur, hauteur, rugosité]
const F = {
  wall: ['#f6f0e4', 0.5, 0.93], band: ['#e8dfcd', 0.6, 0.85], glass: ['#46566b', 0.28, 0.07], frame: ['#fbf8f1', 0.66, 0.5],
  shut: ['#b9b09d', 0.74, 0.82], slat: ['#9c937f', 0.62, 0.82], sill: ['#d8cdb8', 0.86, 0.8], slab: ['#a39a8b', 0.84, 0.8],
  rail: ['#2f2f35', 0.95, 0.45], stone: ['#cfc6b4', 0.58, 0.95], door: ['#5b4636', 0.4, 0.7], doorD: ['#3b2c22', 0.3, 0.7],
  arch: ['#ddd2bf', 0.7, 0.85], awnA: ['#b45a4c', 0.7, 0.9], awnB: ['#f3ede2', 0.7, 0.9], dark: ['#4a3a2e', 0.35, 0.6], mullion: ['#fbf8f1', 0.72, 0.5],
};
function painter(ctx, mode, litFn) {
  return (role, x, y, w, h) => {
    const [c, hg, rg] = F[role];
    ctx.fillStyle = mode === 'color' ? c : mode === 'height' ? gray(hg) : mode === 'rough' ? gray(rg)
      : (role === 'glass' && litFn() ? '#ffcf80' : '#000');
    ctx.fillRect(x, y, w, h);
  };
}
function roleFill(ctx, mode, role) { const [c, hg, rg] = F[role]; ctx.fillStyle = mode === 'color' ? c : mode === 'height' ? gray(hg) : mode === 'rough' ? gray(rg) : '#000'; }

// Grille 4×4 modules de 4 m × 3 m. mode ∈ color | height | rough | emis
function facadeCanvas(S, mode) {
  const cv = canvas(S, S), ctx = cv.getContext('2d'), m = S / 4, H = rnd(31), N = rnd(901);
  ctx.fillStyle = mode === 'emis' ? '#000' : mode === 'color' ? F.wall[0] : mode === 'height' ? gray(F.wall[1]) : gray(F.wall[2]); ctx.fillRect(0, 0, S, S);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
    ctx.save(); ctx.translate(c * m, r * m); ctx.scale(m / 4, m / 3);
    const h = H(), litNow = mode === 'emis' ? (rnd(c * 17 + r * 5 + 3)() < 0.4) : false;
    const P = painter(ctx, mode, () => litNow);
    if (mode === 'color') { // enduit : taches et coulures
      for (let k = 0; k < 46; k++) { ctx.fillStyle = `rgba(120,100,80,${0.02 + N() * 0.05})`; ctx.fillRect(N() * 4, N() * 3, 0.12 + N() * 0.35, 0.08 + N() * 0.22); }
    } else if (mode === 'height') { // grain d'enduit
      for (let k = 0; k < 160; k++) { ctx.fillStyle = gray(0.4 + N() * 0.2); ctx.fillRect(N() * 4, N() * 3, 0.05 + N() * 0.12, 0.05 + N() * 0.1); }
    }
    if (mode !== 'emis') P('band', 0, 2.86, 4, 0.14); // bandeau d'étage
    if (h < 0.5) { // fenêtre simple + volets
      P('shut', 0.93, 0.78, 0.55, 1.65); P('shut', 2.52, 0.78, 0.55, 1.65);
      P('frame', 1.45, 0.7, 1.1, 1.8); P('glass', 1.55, 0.8, 0.9, 1.6);
      if (mode !== 'emis') { P('mullion', 1.97, 0.8, 0.06, 1.6); P('mullion', 1.55, 1.55, 0.9, 0.05); P('sill', 1.35, 2.5, 1.3, 0.12); }
      if (mode === 'height') { for (let b = 0; b < 6; b++) { ctx.fillStyle = gray(0.58); ctx.fillRect(0.93, 0.88 + b * 0.26, 0.55, 0.04); ctx.fillRect(2.52, 0.88 + b * 0.26, 0.55, 0.04); } }
      if (mode === 'color') { for (let b = 0; b < 6; b++) { ctx.fillStyle = '#9c937f'; ctx.fillRect(0.93, 0.88 + b * 0.26, 0.55, 0.04); ctx.fillRect(2.52, 0.88 + b * 0.26, 0.55, 0.04); } }
    } else if (h < 0.75) { // fenêtre double
      P('frame', 1.0, 0.8, 2.0, 1.7); P('glass', 1.1, 0.9, 0.85, 1.5); P('glass', 2.05, 0.9, 0.85, 1.5);
      if (mode !== 'emis') { P('sill', 0.9, 2.5, 2.2, 0.12); P('mullion', 1.1, 1.6, 1.8, 0.05); }
    } else if (h < 0.9) { // porte-fenêtre + balcon en fer forgé
      P('frame', 1.3, 0.35, 1.4, 2.4); P('glass', 1.4, 0.45, 1.2, 2.2);
      if (mode !== 'emis') { P('mullion', 1.98, 0.45, 0.05, 2.2); P('slab', 0.9, 2.55, 2.2, 0.16); P('rail', 0.95, 2.0, 2.1, 0.05);
        for (let b = 0; b < 12; b++) P('rail', 1.0 + b * 0.18, 2.05, 0.03, 0.5); }
    } else { // petite fenêtre, volets fermés
      P('shut', 1.5, 1.0, 1.0, 1.3);
      if (mode !== 'emis') { for (let b = 0; b < 5; b++) P('slat', 1.5, 1.1 + b * 0.24, 1.0, 0.04); }
    }
    ctx.restore();
  }
  return cv;
}
// Rez-de-chaussée : 4 modules de 4 m × 3,6 m sur une ligne.
function groundCanvas(S, mode) {
  const cv = canvas(S, S / 4), ctx = cv.getContext('2d'), m = S / 4, R = rnd(43), H = rnd(77);
  ctx.fillStyle = mode === 'emis' ? '#000' : mode === 'color' ? '#f1ead9' : mode === 'height' ? gray(0.5) : gray(0.92); ctx.fillRect(0, 0, S, S / 4);
  for (let c = 0; c < 4; c++) {
    ctx.save(); ctx.translate(c * m, 0); ctx.scale(m / 4, (S / 4) / 3.6);
    const h = H(), lit = mode === 'emis' && rnd(c * 7 + 41)() < 0.65, P = painter(ctx, mode, () => lit);
    if (mode !== 'emis') P('stone', 0, 3.1, 4, 0.5); // soubassement
    if (h < 0.5) { // vitrine + store rayé
      P('frame', 0.4, 1.1, 3.2, 2.1); P('glass', 0.5, 1.2, 3.0, 2.0);
      if (mode !== 'emis') { for (let s = 0; s < 8; s++) P(s % 2 ? 'awnB' : 'awnA', 0.3 + s * 0.425, 0.65, 0.425, 0.45); P('dark', 1.6, 1.4, 0.8, 1.8); P('mullion', 1.45, 1.2, 0.05, 2.0); P('mullion', 2.5, 1.2, 0.05, 2.0); }
    } else if (h < 0.8) { // porte voûtée
      if (mode !== 'emis') {
        P('arch', 1.2, 0.9, 1.6, 2.7); roleFill(ctx, mode, 'arch'); ctx.beginPath(); ctx.arc(2, 1.0, 0.8, Math.PI, 0); ctx.fill();
        roleFill(ctx, mode, 'door'); ctx.beginPath(); ctx.arc(2, 1.2, 0.6, Math.PI, 0); ctx.fill(); P('door', 1.4, 1.2, 1.2, 2.4); P('doorD', 1.98, 1.3, 0.04, 2.3);
        for (let k = 0; k < 4; k++) P('doorD', 1.45, 1.6 + k * 0.5, 0.5, 0.03), P('doorD', 2.05, 1.6 + k * 0.5, 0.5, 0.03);
      }
    } else { // deux fenêtres basses
      P('frame', 0.6, 1.3, 1.2, 1.5); P('frame', 2.2, 1.3, 1.2, 1.5); P('glass', 0.7, 1.4, 1.0, 1.3); P('glass', 2.3, 1.4, 1.0, 1.3);
      if (mode !== 'emis') { P('sill', 0.5, 2.8, 1.4, 0.12); P('sill', 2.1, 2.8, 1.4, 0.12); }
    }
    ctx.restore();
  }
  return cv;
}

// ─── Toit en tuiles ───────────────────────────────────────────────────────────
function roofCanvas(S, mode) {
  const cv = canvas(S, S), ctx = cv.getContext('2d'), R = rnd(3), n = 8, t = S / n;
  ctx.fillStyle = mode === 'height' ? gray(0.3) : mode === 'rough' ? gray(0.78) : '#e8e8e8'; ctx.fillRect(0, 0, S, S);
  for (let r = 0; r < n; r++) for (let c = -1; c < n; c++) {
    const x = c * t + (r % 2 ? t / 2 : 0), y = r * t, v = 0.86 + R() * 0.14;
    if (mode === 'color') {
      ctx.fillStyle = `rgb(${Math.round(255 * v)},${Math.round(255 * (v - 0.03))},${Math.round(255 * (v - 0.06))})`;
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x + 1, y, t - 2, t * 1.05, [0, 0, t * 0.45, t * 0.45]) : ctx.rect(x + 1, y, t - 2, t); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.22)'; ctx.lineWidth = 1.2; ctx.stroke();
    } else if (mode === 'height') {
      const g = ctx.createLinearGradient(0, y, 0, y + t * 1.05); g.addColorStop(0, gray(0.38)); g.addColorStop(0.75, gray(0.8 + R() * 0.06)); g.addColorStop(1, gray(0.9));
      ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x + 1, y, t - 2, t * 1.05, [0, 0, t * 0.45, t * 0.45]) : ctx.rect(x + 1, y, t - 2, t); ctx.fill();
    }
  }
  return cv;
}

// ─── Pavés (partagés quais/ponts) ─────────────────────────────────────────────
function cobbleCanvas(S, mode) {
  const cv = canvas(S, S), ctx = cv.getContext('2d'), R = rnd(8), k = S / 256;
  ctx.fillStyle = mode === 'color' ? '#5e574d' : mode === 'height' ? gray(0.12) : gray(0.97); ctx.fillRect(0, 0, S, S);
  const count = Math.round(430 * k * k * 0.9);
  for (let i = 0; i < count; i++) {
    const x = R() * S, y = R() * S, rw = (6 + R() * 9) * k, rh = (5 + R() * 7) * k, a = R() * 3, v = 105 + R() * 60, tone = R();
    for (const [ox, oy] of [[0, 0], [S, 0], [-S, 0], [0, S], [0, -S]]) {
      if ((ox && Math.abs(x + ox - S / 2) > S / 2 + rw) || (oy && Math.abs(y + oy - S / 2) > S / 2 + rw)) continue;
      ctx.save(); ctx.translate(x + ox, y + oy); ctx.rotate(a);
      if (mode === 'color') { const b = Math.round(v); ctx.fillStyle = `rgb(${b},${b - 6 + tone * 4},${b - 16 + tone * 6})`; ctx.beginPath(); ctx.ellipse(0, 0, rw, rh, 0, 0, 7); ctx.fill(); }
      else if (mode === 'height') { const g = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.max(rw, rh)); g.addColorStop(0, gray(0.95 - R() * 0.1)); g.addColorStop(0.7, gray(0.78)); g.addColorStop(1, gray(0.3)); ctx.fillStyle = g; ctx.scale(1, rh / rw); ctx.beginPath(); ctx.arc(0, 0, rw, 0, 7); ctx.fill(); }
      else { ctx.fillStyle = gray(0.84 + R() * 0.12); ctx.beginPath(); ctx.ellipse(0, 0, rw, rh, 0, 0, 7); ctx.fill(); }
      ctx.restore();
    }
  }
  return cv;
}

// ─── Sol naturel (herbe / roche) : détail fin ; la couleur vient des sommets ─
function terrainCanvas(S, mode) {
  const cv = canvas(S, S), ctx = cv.getContext('2d'), R = rnd(21);
  ctx.fillStyle = gray(0.5); ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < S * S / 14; i++) {
    const x = R() * S, y = R() * S, s = 1 + R() * 3.2, v = 0.3 + R() * 0.7;
    ctx.fillStyle = `rgba(${Math.round(v * 255)},${Math.round(v * 255)},${Math.round(v * 255)},${0.25 + R() * 0.3})`;
    if (R() < 0.5) ctx.fillRect(x, y, s * 0.6, s * 1.8); else ctx.fillRect(x, y, s, s);
    if (x < 4 || x > S - 4 || y < 4 || y > S - 4) ctx.fillRect((x + S / 2) % S, (y + S / 2) % S, 0, 0);
  }
  if (mode === 'color') { // éclaircit et resserre : multiplié par les couleurs de sommets
    const id = ctx.getImageData(0, 0, S, S), d = id.data;
    for (let i = 0; i < d.length; i += 4) { const v = 0.74 + (d[i] / 255) * 0.5; d[i] = d[i + 1] = d[i + 2] = Math.min(255, v * 255 * 0.95); }
    ctx.putImageData(id, 0, 0);
  }
  return cv;
}

// ─── Assemblage ───────────────────────────────────────────────────────────────
// full = true : cartes de relief et de rugosité (niveaux « mid » et « high »).
export function createTextureSet(S, full) {
  const out = {};
  const mk = (name, color, size, fn, nStrength) => {
    const set = { map: tex(fn(size, 'color'), true) };
    if (full) { set.normalMap = tex(heightToNormal(fn(size, 'height'), nStrength)); set.roughnessMap = tex(fn(size, 'rough')); }
    out[name] = set;
  };
  mk('facade', null, S, facadeCanvas, 3.2);
  mk('ground', null, S, groundCanvas, 3.2);
  mk('roof', null, Math.min(S, 512), roofCanvas, 4);
  mk('cobble', null, Math.min(S, 512), cobbleCanvas, 2.2);
  mk('terrain', null, Math.min(S, 512), terrainCanvas, 3);
  out.facade.emissiveMap = tex(facadeCanvas(S, 'emis'), true);
  out.ground.emissiveMap = tex(groundCanvas(S, 'emis'), true);
  return out;
}
