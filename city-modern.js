// city-modern.js — JexCity : la Grande Avenue (chaussée, trottoirs, parcs, tours vitrées, façades, enseignes néon, voitures).
// Tout est procédural sauf le bois (bois.jpg, chargé en différé). Les bâtiments sont fusionnés par style (peu d'appels de dessin) ;
// les voitures et le mobilier sont instanciés. Aucune requête réseau obligatoire, aucune écriture en base.
import * as THREE from 'three';
import * as G from './city-geo.js';
import { mergeGeometries } from './BufferGeometryUtils.js';

// ─── Géométrie fusionnée (même principe que city-world) ───
class GB {
  constructor() { this.p = []; this.u = []; this.c = []; this.i = []; this.n = 0; this.col = new THREE.Color(); }
  quad(a, b, c, d, uv, color) {
    const k = this.n; this.col.set(color || '#ffffff');
    for (const v of [a, b, c, d]) this.p.push(v[0], v[1], v[2]);
    this.u.push(...uv);
    for (let j = 0; j < 4; j++) this.c.push(this.col.r, this.col.g, this.col.b);
    this.i.push(k, k + 1, k + 2, k, k + 2, k + 3); this.n += 4;
  }
  get empty() { return this.n === 0; }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.n > 65000 ? new THREE.Uint32BufferAttribute(this.i, 1) : new THREE.Uint16BufferAttribute(this.i, 1));
    g.computeVertexNormals(); g.computeBoundingSphere();
    return g;
  }
}

// ─── Textures procédurales ───
const cnv = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = Math.max(1, Math.round(h)); return c; };
const FONT = 'system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif';
function noise(c, amt = 0.05, step = 3) { const x = c.getContext('2d'); for (let i = 0; i < c.width; i += step) for (let j = 0; j < c.height; j += step) { const v = Math.random(); x.fillStyle = v > 0.5 ? `rgba(255,255,255,${amt * (v - 0.5) * 2})` : `rgba(0,0,0,${amt * (0.5 - v) * 2})`; x.fillRect(i, j, step, step); } }

function facadeCanvas(style, S, mode) {
  const W = S, H = Math.round(S * 0.9), c = cnv(W, H), x = c.getContext('2d'), cw = W / 4, ch = H / 4, R = G.rng(style.length * 31 + (mode === 'emis' ? 5 : 1));
  const emis = mode === 'emis', hei = mode === 'height';
  x.fillStyle = emis ? '#000' : hei ? '#c8c8c8' : style === 'glass' ? '#27343f' : style === 'brick' ? '#b0705a' : '#e6dccb'; x.fillRect(0, 0, W, H);
  if (!emis && !hei && style === 'brick') { // briques
    const bh = ch / 12; for (let r = 0; r < 48; r++) for (let k = 0; k < 40; k++) { const bw = W / 20, ox = (r % 2) * bw / 2, v = 150 + R() * 70; x.fillStyle = `rgb(${v + 20},${v - 40},${v - 60})`; x.fillRect(k * bw + ox + 1, r * bh + 1, bw - 2, bh - 2); }
  }
  for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) {
    const X0 = k * cw, Y0 = r * ch, lit = R() < 0.42, warm = R() < 0.75, tint = R();
    if (style === 'glass') {
      const px = X0 + cw * 0.04, py = Y0 + ch * 0.04, pw = cw * 0.92, ph = ch * 0.74;
      if (emis) { if (lit) { x.fillStyle = warm ? '#ffe0a8' : '#cfe6ff'; x.fillRect(px, py, pw, ph); } }
      else if (hei) { x.fillStyle = '#6a6a6a'; x.fillRect(px, py, pw, ph); }
      else {
        const g = x.createLinearGradient(0, py, 0, py + ph); g.addColorStop(0, tint < 0.3 ? '#a8d6f0' : '#8dc3e6'); g.addColorStop(1, tint < 0.3 ? '#4d7fa0' : '#3b6a8c'); x.fillStyle = g; x.fillRect(px, py, pw, ph);
        x.fillStyle = 'rgba(255,255,255,0.13)'; x.beginPath(); x.moveTo(px, py + ph); x.lineTo(px + pw * 0.45, py); x.lineTo(px + pw * 0.7, py); x.lineTo(px + pw * 0.25, py + ph); x.fill();
        x.fillStyle = '#5b6a77'; x.fillRect(X0, Y0 + ch * 0.82, cw, ch * 0.18);
      }
    } else {
      const ww = cw * 0.5, wh = ch * 0.6, wx = X0 + (cw - ww) / 2, wy = Y0 + ch * 0.16;
      if (emis) { if (lit) { x.fillStyle = warm ? '#ffd9a0' : '#cfe6ff'; x.fillRect(wx, wy, ww, wh); } }
      else if (hei) { x.fillStyle = '#707070'; x.fillRect(wx, wy, ww, wh); x.fillStyle = '#e0e0e0'; x.fillRect(wx - 3, wy + wh, ww + 6, 4); }
      else {
        x.fillStyle = '#f7f3ea'; x.fillRect(wx - ww * 0.07, wy - wh * 0.05, ww * 1.14, wh * 1.1);
        const g = x.createLinearGradient(0, wy, 0, wy + wh); g.addColorStop(0, '#5c7b94'); g.addColorStop(1, '#283a4c'); x.fillStyle = g; x.fillRect(wx, wy, ww, wh);
        x.fillStyle = '#f7f3ea'; x.fillRect(wx + ww / 2 - 1.5, wy, 3, wh); x.fillRect(wx, wy + wh * 0.42, ww, 3);
        x.fillStyle = 'rgba(0,0,0,0.25)'; x.fillRect(wx - ww * 0.09, wy + wh * 1.06, ww * 1.18, 4);
      }
    }
  }
  if (!emis && !hei && S >= 512) noise(c, 0.05, 3);
  return c;
}
function storefrontCanvas(S, mode) {
  const W = S, H = Math.round(S * 0.3), c = cnv(W, H), x = c.getContext('2d'), bw = W / 4, emis = mode === 'emis';
  x.fillStyle = emis ? '#000' : '#2a2d35'; x.fillRect(0, 0, W, H);
  for (let k = 0; k < 4; k++) {
    const X0 = k * bw + bw * 0.04, w = bw * 0.92, y0 = H * 0.22, h = H * 0.7;
    if (emis) { const g = x.createLinearGradient(0, y0, 0, y0 + h); g.addColorStop(0, '#ffe3b0'); g.addColorStop(1, '#c98a4a'); x.fillStyle = k === 2 ? '#bfe0ff' : g; x.fillRect(X0, y0, w, h); }
    else { const g = x.createLinearGradient(0, y0, 0, y0 + h); g.addColorStop(0, '#506a80'); g.addColorStop(1, '#222d38'); x.fillStyle = g; x.fillRect(X0, y0, w, h); x.fillStyle = 'rgba(255,255,255,0.1)'; x.beginPath(); x.moveTo(X0, y0 + h); x.lineTo(X0 + w * 0.4, y0); x.lineTo(X0 + w * 0.6, y0); x.lineTo(X0 + w * 0.2, y0 + h); x.fill(); }
    x.fillStyle = emis ? '#000' : '#1b1d24'; for (let m = 1; m < 4; m++) x.fillRect(X0 + (w * m) / 4 - 1.5, y0, 3, h);
    if (!emis) { x.fillStyle = '#3a3d46'; x.fillRect(X0 + w * 0.42, y0 + h * 0.12, w * 0.16, h * 0.88); } // porte
  }
  return c;
}
function roadCanvas(kind, S) {
  const c = cnv(S, S), x = c.getContext('2d'); x.fillStyle = '#383b41'; x.fillRect(0, 0, S, S); noise(c, 0.1, 2);
  const m = S / (kind === 'ave' ? 26 : 16); // pixels par mètre en travers
  const line = (xm, w, col) => { x.fillStyle = col; x.fillRect(S / 2 + xm * m - (w * m) / 2, 0, w * m, S); };
  const dash = (xm, w, col) => { x.fillStyle = col; x.fillRect(S / 2 + xm * m - (w * m) / 2, 0, w * m, S * 0.375); };
  if (kind === 'ave') { line(-12.4, 0.16, '#e8e8e8'); line(12.4, 0.16, '#e8e8e8'); line(-0.18, 0.12, '#e6b93a'); line(0.18, 0.12, '#e6b93a'); for (const d of [-4.3, 4.3, -8.6, 8.6]) dash(d, 0.14, '#e8e8e8'); }
  else { line(-7.4, 0.14, '#e8e8e8'); line(7.4, 0.14, '#e8e8e8'); dash(0, 0.14, '#e6b93a'); }
  return c;
}
function pavingCanvas(S) {
  const c = cnv(S, S), x = c.getContext('2d'), R = G.rng(5), n = 4, s = S / n;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const v = 176 + R() * 26; x.fillStyle = `rgb(${v},${v - 3},${v - 9})`; x.fillRect(i * s, j * s, s, s); }
  x.strokeStyle = 'rgba(80,78,72,0.55)'; x.lineWidth = Math.max(2, S / 128); for (let i = 0; i <= n; i++) { x.beginPath(); x.moveTo(i * s, 0); x.lineTo(i * s, S); x.moveTo(0, i * s); x.lineTo(S, i * s); x.stroke(); }
  noise(c, 0.08, 2); return c;
}
function grassCanvas(S) { const c = cnv(S, S), x = c.getContext('2d'); x.fillStyle = '#5c8a3c'; x.fillRect(0, 0, S, S); noise(c, 0.35, 2); noise(c, 0.18, 4); return c; }
function zebraCanvas() { const c = cnv(64, 64), x = c.getContext('2d'); x.fillStyle = '#f0f0ee'; x.fillRect(0, 0, 32, 64); return c; }

const SHOPS_H = [['CAFÉ', '#ff7a3d'], ['PIZZA', '#ff3b5c'], ['BOOKS', '#35d0ff'], ['SUSHI', '#ff4fa3'], ['PHARMACIE', '#3dff9a'], ['MÉTRO', '#35d0ff'], ['BANQUE', '#6aa8ff'], ['MODE', '#d37bff'],
  ['MUSIQUE', '#ff9f3d'], ['CINÉMA', '#ff3d3d'], ['JEX CITY', '#3df0ff'], ['BAR', '#ffdb3d'], ['BURGER', '#ff6a3d'], ['TECH', '#52ffd8'], ['FLEURS', '#ff7ac8'], ['GALERIE', '#a8ff3d']];
const SHOPS_V = [['HOTEL', '#ffd23d'], ['CAFÉ', '#ff7a3d'], ['OPEN', '#3dff9a'], ['BAR', '#ff4fa3'], ['PIZZA', '#ff3b5c'], ['JEX', '#3df0ff'], ['MUSIC', '#d37bff'], ['SHOP', '#6aa8ff']];
function signAtlas() {
  const c = cnv(1024, 768), x = c.getContext('2d'); x.fillStyle = '#0d0f16'; x.fillRect(0, 0, 1024, 768);
  const neon = (txt, col, cx, cy, w, h, vertical) => {
    x.fillStyle = '#11131c'; x.fillRect(cx - w / 2 + 4, cy - h / 2 + 4, w - 8, h - 8);
    x.strokeStyle = col; x.lineWidth = 6; x.shadowColor = col; x.shadowBlur = 14; x.strokeRect(cx - w / 2 + 10, cy - h / 2 + 10, w - 20, h - 20);
    x.fillStyle = '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.shadowBlur = 18;
    if (!vertical) { let fs = h * 0.5; x.font = `800 ${fs}px ${FONT}`; while (x.measureText(txt).width > w - 40 && fs > 12) { fs -= 2; x.font = `800 ${fs}px ${FONT}`; } x.fillText(txt, cx, cy + 2); }
    else { x.font = `800 ${w * 0.34}px ${FONT}`; const step = w * 0.36, y0 = cy - (txt.length - 1) * step / 2; [...txt].forEach((ch, i) => x.fillText(ch, cx, y0 + i * step)); }
    x.shadowBlur = 0;
  };
  SHOPS_H.forEach(([t, col], i) => neon(t, col, (i % 4) * 256 + 128, Math.floor(i / 4) * 128 + 64, 256, 128, false));
  SHOPS_V.forEach(([t, col], i) => neon(t, col, (i % 8) * 128 + 64, 512 + 128, 128, 256, true));
  return c;
}

export function buildAvenue({ root, layout, tier, full, mk, stdMats, pickables, landmarks, renderer }) {
  const QY = G.TOWN.quayY, T = G.TOWN, AV = G.AV;
  const S = Math.max(tier.tex, 512), aniso = Math.min(renderer?.capabilities?.getMaxAnisotropy?.() || 4, tier.name === 'high' ? 8 : 4);
  const tx = (canvas, { srgb = true, repeat = false } = {}) => { const t = new THREE.CanvasTexture(canvas); if (srgb) t.colorSpace = THREE.SRGBColorSpace; if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = aniso; return t; };
  const std = (o) => {
    let m;
    if (full) m = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, envMapIntensity: 0.5, ...o });
    else { const { roughness, metalness, envMapIntensity, normalMap, normalScale, ...light } = o; m = new THREE.MeshLambertMaterial(light); } // niveau « low » : matériaux simples
    mk(m); if (full) stdMats.push(m); return m;
  };
  const R = G.rng(2024);

  // ── Textures ──
  const emissiveMats = [];
  const facade = {};
  for (const st of ['glass', 'stone', 'brick']) {
    const o = { map: tx(facadeCanvas(st, S, 'color'), { repeat: true }), vertexColors: true, side: THREE.DoubleSide, emissive: 0xffffff, emissiveMap: tx(facadeCanvas(st, S, 'emis'), { repeat: true }), emissiveIntensity: 0 };
    if (full) { o.roughness = st === 'glass' ? 0.22 : 0.85; o.envMapIntensity = st === 'glass' ? 1.1 : 0.4; if (S >= 512) { o.normalMap = tx(facadeCanvas(st, Math.min(S, 512), 'height'), { srgb: false, repeat: true }); o.normalScale = new THREE.Vector2(0.5, 0.5); } }
    facade[st] = std(o); emissiveMats.push(facade[st]);
  }
  // la carte de relief des façades est une carte de hauteur : on la convertit en normales au besoin (légère, uniquement mid/high)
  const shopMat = std({ map: tx(storefrontCanvas(S, 'color'), { repeat: true }), vertexColors: true, side: THREE.DoubleSide, emissive: 0xffffff, emissiveMap: tx(storefrontCanvas(S, 'emis'), { repeat: true }), emissiveIntensity: 0, ...(full ? { roughness: 0.3, envMapIntensity: 0.9 } : {}) }); emissiveMats.push(shopMat);
  const concrete = std({ color: '#b9b7b0', vertexColors: true, side: THREE.DoubleSide, roughness: 0.9 });
  const woodMat = std({ color: '#5b3d28', vertexColors: true, side: THREE.DoubleSide, roughness: 0.7 });
  const roadAve = std({ map: tx(roadCanvas('ave', S), { repeat: true }), roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const roadSt = std({ map: tx(roadCanvas('st', S), { repeat: true }), roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const pave = std({ map: tx(pavingCanvas(S), { repeat: true }), roughness: 0.95 });
  const grass = std({ map: tx(grassCanvas(S), { repeat: true }), roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  const zebra = std({ map: tx(zebraCanvas(), { repeat: true }), transparent: true, alphaTest: 0.5, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const signMat = new THREE.MeshBasicMaterial({ map: tx(signAtlas()), toneMapped: false, side: THREE.DoubleSide, color: 0xcccccc }); mk(signMat);
  const neonMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, side: THREE.DoubleSide }); mk(neonMat);
  // bois (dark_paneled_wood) : chargé en différé, le brun uni sert de repli
  new THREE.TextureLoader().loadAsync('/city-assets/bois.jpg').then((t) => { t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = aniso; woodMat.map = t; woodMat.color.set('#ffffff'); woodMat.needsUpdate = true; benchMat.map = t; benchMat.color.set('#ffffff'); benchMat.needsUpdate = true; }).catch(() => {});
  const benchMat = std({ color: '#5b3d28', roughness: 0.7 });

  const ground = (geo, mat) => { const m = new THREE.Mesh(geo, mat); m.receiveShadow = true; m.userData.pick = 'ground'; root.add(m); pickables.push(m); return m; };
  const flat = (x0, x1, z0, z1, y, uvf) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1], 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uvf(x0, x1, z0, z1), 2)); g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3)); g.setIndex([0, 2, 1, 0, 3, 2]); g.computeBoundingSphere(); return g; };

  // ── Sol : dallage général, chaussée, rues transversales, parcs, passages piétons ──
  ground(flat(T.x0, T.x1, T.z0, T.z1, QY, (a, b, c, d) => [a / 4, c / 4, b / 4, c / 4, b / 4, d / 4, a / 4, d / 4]), pave);
  ground(flat(-AV, AV, T.z0, T.z1, QY + 0.03, (a, b, c, d) => [0, c / 8, 1, c / 8, 1, d / 8, 0, d / 8]), roadAve);
  for (const s of G.STREETS) for (const side of [-1, 1]) {
    const xa = side < 0 ? T.x0 : AV, xb = side < 0 ? -AV : T.x1;
    ground(flat(xa, xb, s - 8, s + 8, QY + 0.03, () => [0, xa / 8, 0, xb / 8, 1, xb / 8, 1, xa / 8]), roadSt);
    if (side > 0) for (const zz of [s - 11, s + 8.5]) ground(flat(-AV, AV, zz, zz + 2.6, QY + 0.05, () => [0, 0, 26, 0, 26, 1, 0, 1]), zebra);
  }
  for (const side of [-1, 1]) {
    const xa = side < 0 ? T.x0 : G.PARK_X, xb = side < 0 ? -G.PARK_X : T.x1;
    ground(flat(xa, xb, T.z0, T.z1 - 46, QY + 0.04, (a, b, c, d) => [a / 5, c / 5, b / 5, c / 5, b / 5, d / 5, a / 5, d / 5]), grass);
  }
  // quai sur le lac
  const wall = new GB(); wall.quad([T.x0, QY, T.z1], [T.x1, QY, T.z1], [T.x1, -3.6, T.z1], [T.x0, -3.6, T.z1], [0, 0, 28, 0, 28, 1, 0, 1], '#9d958a');
  const wm = new THREE.Mesh(wall.build(), concrete); wm.castShadow = false; root.add(wm);

  // ── Bâtiments ──
  const GROUND_H = 4.8, FLOOR_H = 3.6, TILE_W = 16, TILE_H = 14.4;
  const gStyle = { glass: new GB(), stone: new GB(), brick: new GB() }, gShop = new GB(), gTrim = new GB(), gSign = new GB(), gNeon = new GB(), gWood = new GB();
  const rect = (hx, hz, cx, cz) => [[cx - hx, cz - hz], [cx + hx, cz - hz], [cx + hx, cz + hz], [cx - hx, cz + hz]];
  function walls(g, cs, y0, y1, color, u0, v0, uSpan = TILE_W, vSpan = TILE_H) {
    for (let s = 0; s < 4; s++) {
      const p0 = cs[s], p1 = cs[(s + 1) % 4], len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), ua = u0, ub = u0 + len / uSpan, va = v0, vb = v0 + (y1 - y0) / vSpan;
      g.quad([p0[0], y0, p0[1]], [p1[0], y0, p1[1]], [p1[0], y1, p1[1]], [p0[0], y1, p0[1]], [ua, va, ub, va, ub, vb, ua, vb], color);
    }
  }
  const top = (g, cs, y, color) => g.quad([cs[0][0], y, cs[0][1]], [cs[1][0], y, cs[1][1]], [cs[2][0], y, cs[2][1]], [cs[3][0], y, cs[3][1]], [0, 0, 1, 0, 1, 1, 0, 1], color);
  const slab = (cx, cz, hx, hz, y0, y1, color) => { const cs = rect(hx, hz, cx, cz); walls(gTrim, cs, y0, y1, color, 0, 0, 12, 12); top(gTrim, cs, y1, color); };
  const lowerNight = [];
  let tallest = null;
  for (const b of layout.buildings) {
    if (b.station) continue;
    const g = gStyle[b.style], y0 = b.y0, yg = y0 + GROUND_H, W = b.hz * 2, fxSide = -b.side; // fxSide : direction de la façade (vers l'avenue)
    const csB = rect(b.hx, b.hz, b.cx, b.cz);
    // rez-de-chaussée vitré
    walls(gShop, csB, y0, yg, b.shop ? '#ffffff' : '#9aa0a8', b.uOff, 0, TILE_W, GROUND_H);
    if (b.tower) {
      const yp = y0 + GROUND_H + (b.podium - 1) * FLOOR_H;
      walls(g, csB, yg, yp, b.color, b.uOff, 0);
      slab(b.cx, b.cz, b.hx + 0.35, b.hz + 0.35, yp, yp + 0.7, '#c9c6bd');
      const csT = rect(b.hx - b.inset, b.hz - b.inset, b.cx, b.cz);
      walls(g, csT, yp + 0.7, b.top, b.color, b.uOff, 0);
      top(gTrim, csT, b.top, '#6c7179');
      slab(b.cx, b.cz, b.hx - b.inset + 0.25, b.hz - b.inset + 0.25, b.top, b.top + 0.55, '#d2cfc7');
    } else {
      walls(g, csB, yg, b.top, b.color, b.uOff, 0);
      top(gTrim, csB, b.top, '#6c7179');
      slab(b.cx, b.cz, b.hx + 0.3, b.hz + 0.3, b.top, b.top + 0.7, '#d2cfc7');
    }
    // toit : climatiseurs, antennes, balise
    const rx = b.hx - b.inset - 1.5, rz = b.hz - b.inset - 1.5;
    for (let k = 0; k < 2 + Math.floor(R() * 3); k++) { const bx = b.cx + (R() * 2 - 1) * rx * 0.7, bz = b.cz + (R() * 2 - 1) * rz * 0.7, s = 0.9 + R() * 1.4, hh = 0.9 + R() * 1.2; slab(bx, bz, s, s * 1.2, b.top + 0.7, b.top + 0.7 + hh, '#8c9097'); }
    if (b.floors >= 14) {
      const ax = b.cx + (R() - 0.5) * rx, az = b.cz + (R() - 0.5) * rz, hA = 6 + R() * 10;
      slab(ax, az, 0.12, 0.12, b.top + 0.7, b.top + 0.7 + hA, '#7a7f87');
      gNeon.quad([ax - 0.4, b.top + hA, az], [ax + 0.4, b.top + hA, az], [ax + 0.4, b.top + hA + 0.8, az], [ax - 0.4, b.top + hA + 0.8, az], [0, 0, 1, 0, 1, 1, 0, 1], '#ff3040');
      // liserés néon au sommet des tours
      if (b.style === 'glass') { const col = ['#35d0ff', '#ff4fa3', '#ffd23d', '#6aff9a'][Math.floor(R() * 4)], hx2 = b.hx - b.inset + 0.28, hz2 = b.hz - b.inset + 0.28, yy = b.top + 0.18;
        walls(gNeon, rect(hx2, hz2, b.cx, b.cz), yy, yy + 0.22, col, 0, 0, 1, 1); }
    }
    if (!tallest || b.top > tallest.top) tallest = b;
    // enseignes : bandeau néon par commerce + enseigne drapeau
    if (b.shop) {
      const frontX = b.cx - b.side * b.hx;           // plan de la façade côté avenue
      const nShops = Math.max(1, Math.floor(W / 9)), shopW = W / nShops;
      for (let k = 0; k < nShops; k++) {
        const zc = b.cz - b.hz + shopW * (k + 0.5), sw = Math.min(shopW * 0.8, 7), sh = sw / 2, ci = Math.floor(R() * 16), cu = (ci % 4) / 4, cvv = Math.floor(ci / 4) * 128 / 768;
        const xo = frontX + fxSide * 0.14, yb = y0 + 3.55, ua = b.side > 0 ? cu + 0.25 : cu, ub = b.side > 0 ? cu : cu + 0.25;
        // bandeau enseigne au-dessus de la vitrine (plan parallèle à la façade)
        gSign.quad([xo, yb, zc - sw / 2], [xo, yb, zc + sw / 2], [xo, yb + sw * 0.19, zc + sw / 2], [xo, yb + sw * 0.19, zc - sw / 2], [ua, 1 - (cvv + 128 / 768), ub, 1 - (cvv + 128 / 768), ub, 1 - cvv, ua, 1 - cvv], '#ffffff');
        // socle bois sous la vitrine
        gWood.quad([frontX + fxSide * 0.06, y0, zc - shopW / 2 + 0.2], [frontX + fxSide * 0.06, y0, zc + shopW / 2 - 0.2], [frontX + fxSide * 0.06, y0 + 0.9, zc + shopW / 2 - 0.2], [frontX + fxSide * 0.06, y0 + 0.9, zc - shopW / 2 + 0.2], [0, 0, shopW / 3, 0, shopW / 3, 0.3, 0, 0.3], '#ffffff');
        if (k % 2 === 0 && R() < 0.85) { // enseigne drapeau
          const vi = Math.floor(R() * 8), vu = vi / 8, zb = zc + shopW / 2 - 0.4, vw = 1.1, vh = 2.2, yy = y0 + 2.5;
          const uA = vu, uB = vu + 0.125, vA = 0, vB = 256 / 768;
          gSign.quad([frontX + fxSide * 0.15, yy, zb], [frontX + fxSide * (0.15 + vw), yy, zb], [frontX + fxSide * (0.15 + vw), yy + vh, zb], [frontX + fxSide * 0.15, yy + vh, zb], [uA, vA, uB, vA, uB, vB, uA, vB], '#ffffff');
        }
      }
    }
  }
  const mkMesh = (gb, mat, cast = true, pick = 'building') => { if (gb.empty) return null; const m = new THREE.Mesh(gb.build(), mat); m.castShadow = cast; m.receiveShadow = true; m.userData.pick = pick; root.add(m); if (pick) pickables.push(m); return m; };
  mkMesh(gStyle.glass, facade.glass); mkMesh(gStyle.stone, facade.stone); mkMesh(gStyle.brick, facade.brick); mkMesh(gShop, shopMat); mkMesh(gTrim, concrete); mkMesh(gWood, woodMat, false, null);
  for (const [gb, mat] of [[gSign, signMat], [gNeon, neonMat]]) { if (gb.empty) continue; const m = new THREE.Mesh(gb.build(), mat); m.userData.pick = 'building'; root.add(m); }
  if (tallest) landmarks.push({ name: 'Tour Jex', pos: new THREE.Vector3(tallest.cx, tallest.top + 8, tallest.cz) });
  landmarks.push({ name: 'Grande Avenue', pos: new THREE.Vector3(0, 10, -120) }, { name: 'Station de métro', pos: new THREE.Vector3(G.STATION.x, 12, G.STATION.z) }, { name: 'Esplanade du lac', pos: new THREE.Vector3(0, 8, T.z1 - 24) });

  // ── Mobilier : bancs en bois, jardinières, voitures ──
  const d = new THREE.Object3D();
  if (layout.benches?.length) {
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(0.6, 0.5, 2.2), benchMat, layout.benches.length);
    layout.benches.forEach((b, i) => { d.position.set(b.x, QY + 0.28, b.z); d.rotation.set(0, 0, 0); d.updateMatrix(); im.setMatrixAt(i, d.matrix); });
    im.castShadow = true; im.receiveShadow = true; root.add(im);
  }
  const nCars = tier.name === 'low' ? 0 : tier.name === 'mid' ? 10 : 16;
  let cars = null; const carData = [];
  if (nCars) {
    const body = new THREE.BoxGeometry(1.9, 0.7, 4.3).translate(0, 0.6, 0), cab = new THREE.BoxGeometry(1.6, 0.6, 2.2).translate(0, 1.2, -0.1);
    cars = new THREE.InstancedMesh(mergeGeometries([body, cab]), std({ color: '#ffffff', roughness: 0.35, metalness: 0.3, envMapIntensity: 0.9 }), nCars); cars.castShadow = true; cars.frustumCulled = false;
    const palette = ['#c0392b', '#2c3e50', '#ecf0f1', '#f1c40f', '#27ae60', '#2980b9', '#7f8c8d', '#e67e22', '#1b1b22'], col = new THREE.Color();
    for (let i = 0; i < nCars; i++) {
      const dir = i % 2 ? 1 : -1, lane = [2.15, 6.45][Math.floor(i / 2) % 2];
      carData.push({ x: dir > 0 ? -lane : lane, dir, z: T.z0 + 20 + R() * (T.z1 - T.z0 - 90), v: 6 + R() * 4 }); // circulation à droite : vers le sud sur la moitié ouest
      cars.setColorAt(i, col.set(palette[i % palette.length]));
    }
    root.add(cars);
  }
  const zMin = T.z0 + 12, zMax = T.z1 - 50;
  function updateCars(dt) {
    if (!cars) return;
    for (let i = 0; i < carData.length; i++) {
      const c = carData[i]; c.z += c.dir * c.v * dt; if (c.z > zMax) c.z = zMin; else if (c.z < zMin) c.z = zMax;
      d.position.set(c.x, QY + 0.06, c.z); d.rotation.set(0, c.dir > 0 ? 0 : Math.PI, 0); d.updateMatrix(); cars.setMatrixAt(i, d.matrix);
    }
    cars.instanceMatrix.needsUpdate = true;
  }
  updateCars(0);

  // volume provisoire de la station (visible tant que le modèle n'est pas chargé, et au niveau « low »)
  const st = G.STATION, stationBox = new THREE.Mesh(new THREE.BoxGeometry(st.hx * 2, 7, st.hz * 2), concrete); stationBox.position.set(st.x, QY + 3.5, st.z);
  { const gb = new GB(), x = st.x - st.hx - 0.1; gb.quad([x, QY + 4.2, st.z - 6], [x, QY + 4.2, st.z + 6], [x, QY + 6.4, st.z + 6], [x, QY + 6.4, st.z - 6], [0.25, 0.6667, 0.5, 0.6667, 0.5, 0.8333, 0.25, 0.8333], '#ffffff'); const sg = new THREE.Mesh(gb.build(), signMat); stationBox.add(sg); sg.position.set(-stationBox.position.x, -stationBox.position.y, -stationBox.position.z); }
  stationBox.castShadow = true; root.add(stationBox);

  return {
    station: stationBox,
    // la nuit : fenêtres allumées, enseignes plus vives
    setNight(n) {
      for (const m of emissiveMats) m.emissiveIntensity = n * 1.25;
      signMat.color.setScalar(0.72 + n * 0.5);
    },
    update(t, dt) { updateCars(Math.min(dt, 0.1)); },
  };
}
