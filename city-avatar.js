// city-avatar.js — JexCity : personnage humain légèrement stylisé (≈ 1,75 m), proportions crédibles.
// Hiérarchie articulée (bassin, torse, tête, épaules, coudes, hanches, genoux, chevilles), visage, cheveux,
// capuche, jean et baskets. Les couleurs viennent de user.identity (colorA = haut, colorB = détails) :
// aucun profil n'est copié, on lit celui de JexChat. Aucune ressource externe.
import * as THREE from 'three';
import { heightToNormal } from './city-textures.js';
import { WALK } from './city-walk.js';
import { SKIN as SKINS, HAIR as HAIRS, TOPS, PANTS, SHOES, EYES, cleanLook } from './city-look.js';

const SKIN = '#c98f6b', HAIR = '#1d1612', JEANS = '#27324a', SOLE = '#ece8df';
const matCache = new Map();
let fabricNormal = null;
function fabric() {
  if (fabricNormal) return fabricNormal;
  const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
  for (let i = 0; i < 64; i += 2) for (let j = 0; j < 64; j += 2) { const v = ((i + j) / 2) % 2 ? 150 : 100 + Math.random() * 40; x.fillStyle = `rgb(${v},${v},${v})`; x.fillRect(i, j, 2, 2); }
  fabricNormal = new THREE.CanvasTexture(heightToNormal(c, 1.4)); fabricNormal.wrapS = fabricNormal.wrapT = THREE.RepeatWrapping; fabricNormal.repeat.set(3, 3);
  return fabricNormal;
}
function mat(color, rough = 0.85, cloth = false) {
  const key = color + '|' + rough + '|' + cloth;
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0, envMapIntensity: 0.6, normalMap: cloth ? fabric() : null, normalScale: new THREE.Vector2(0.6, 0.6) }));
  return matCache.get(key);
}
function safeColor(c, fallback) { return typeof c === 'string' && /^#[0-9a-f]{3,8}$/i.test(c) ? c : fallback; }

function nameSprite(text) {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64;
  const ctx = cv.getContext('2d');
  ctx.font = '600 28px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  const w = Math.min(244, ctx.measureText(text).width + 28);
  ctx.fillStyle = 'rgba(20,24,40,0.62)'; ctx.beginPath(); ctx.roundRect?.((256 - w) / 2, 12, w, 40, 20); if (!ctx.roundRect) ctx.rect((256 - w) / 2, 12, w, 40); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 128, 33);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sp.scale.set(2.4, 0.6, 1); sp.position.y = 2.12; sp.renderOrder = 5;
  return sp;
}

// Capsule dont l'axe va de l'articulation (y = 0) vers le bas sur la longueur L.
function limb(L, r, material, sx = 1, sz = 1) {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.001, L - 2 * r), 4, 12), material);
  m.position.y = -L / 2; m.scale.set(sx, 1, sz); m.castShadow = true; return m;
}
function ball(r, material, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, seg = 16) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.round(seg * 0.75)), material); m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.castShadow = true; return m;
}

export function createAvatar({ colorA, colorB, name = '', look } = {}) {
  const L = cleanLook(look), fem = L.s === 1;
  const A = safeColor(colorA, '#3b4256'), B = safeColor(colorB, '#e8c882');
  const top = mat(L.tc ? TOPS[L.tc - 1] : A, 0.9, true), trim = mat(B, 0.7), skin = mat(SKINS[L.sk] || SKIN, 0.55), hair = mat(HAIRS[L.hc] || HAIR, 0.5), jeans = mat(PANTS[L.pc] || JEANS, 0.9, true), sole = mat(SOLE, 0.7), shoe = mat(SHOES[L.sc] || '#d9d6cf', 0.75);
  const eyeW = mat('#f4f1ec', 0.3), iris = mat(EYES[L.ey] || '#1a1410', 0.2), lipM = mat(fem ? '#b5545c' : '#9a5a4c', 0.5);
  const dark = mat('#1b1b22', 0.4);

  const group = new THREE.Group();
  const body = new THREE.Group(); group.add(body);
  if (fem) body.scale.set(0.97, 0.96, 0.97); // silhouette un peu plus fine et plus petite

  // bassin
  const pelvis = new THREE.Group(); pelvis.position.y = 0.93; body.add(pelvis);
  pelvis.add(ball(0.155, jeans, 0, 0, 0, fem ? 1.32 : 1.15, 0.78, 0.9));

  // torse (pivot à la taille)
  const spine = new THREE.Group(); spine.position.y = 0.05; pelvis.add(spine);
  const chest = ball(0.19, top, 0, 0.24, 0, fem ? 1.0 : 1.18, 1.45, fem ? 0.82 : 0.78, 20); spine.add(chest);
  if (fem) { spine.add(ball(0.17, top, 0, 0.1, 0, 1.0, 0.8, 0.82, 14)); }
  spine.add(ball(0.165, top, 0, 0.07, 0, 1.12, 0.9, 0.78, 16)); // ventre / bas de veste
  spine.add(ball(0.2, top, 0, 0.4, 0, fem ? 1.02 : 1.2, 0.5, 0.75, 16));      // épaules
  const hem = new THREE.Mesh(new THREE.TorusGeometry(0.155, 0.014, 6, 24), trim); hem.rotation.x = Math.PI / 2; hem.position.set(0, -0.02, 0); hem.scale.set(1.1, 0.8, 1); spine.add(hem);
  const hood = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.034, 8, 18), top); hood.rotation.x = Math.PI / 2.4; hood.position.set(0, 0.5, -0.03); hood.castShadow = true; spine.add(hood);

  // cou + tête (pivot à la base du cou)
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.056, 0.1, 12), skin); neck.position.y = 0.5; neck.castShadow = true; spine.add(neck);
  const headP = new THREE.Group(); headP.position.y = 0.56; spine.add(headP);
  const cranium = ball(0.112, skin, 0, 0.1, 0, 0.93, 1.07, 1.0, 24); headP.add(cranium);
  headP.add(ball(0.074, skin, 0, 0.035, 0.038, 0.95, 0.9, 0.95, 18));        // menton / mâchoire
  // Coiffures (matériau unique : léger) — 0 courts, 1 longs, 2 queue de cheval, 3 bouclés, 4 rasés, 5 chauve
  const cap = (r, cover) => { const m = ball(r, hair, 0, 0.118, -0.006, 0.95, 1.0, 1.02, 24); m.geometry.dispose(); m.geometry = new THREE.SphereGeometry(r, 24, 14, 0, Math.PI * 2, 0, Math.PI * cover); return m; };
  if (L.h !== 5) {
    headP.add(cap(L.h === 4 ? 0.1165 : 0.119, L.h === 4 ? 0.4 : 0.56));
    if (L.h !== 4) headP.add(ball(0.095, hair, 0, 0.115, -0.04, 1, 0.8, 1, 14)); // nuque
    if (L.h === 1) { const back = limb(0.3, 0.07, hair, 1.25, 0.7); back.position.set(0, 0.1, -0.085); headP.add(back); for (const sx of [-1, 1]) { const side = limb(0.2, 0.026, hair); side.position.set(sx * 0.1, 0.1, -0.02); headP.add(side); } }
    if (L.h === 6) { for (const sx of [-1, 1]) { const side = limb(0.17, 0.045, hair, 1, 1.3); side.position.set(sx * 0.1, 0.06, -0.01); headP.add(side); } const bk = limb(0.17, 0.08, hair, 1.3, 0.7); bk.position.set(0, 0.06, -0.085); headP.add(bk); }
    if (L.h === 7) headP.add(ball(0.16, hair, 0, 0.14, -0.02, 1, 0.95, 1, 16));
    if (L.h === 2) { headP.add(ball(0.03, hair, 0, 0.17, -0.12, 1, 1, 1, 10)); const tail = limb(0.22, 0.028, hair); tail.position.set(0, 0.15, -0.14); tail.rotation.x = -0.35; headP.add(tail); }
    if (L.h === 3) for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2; headP.add(ball(0.04, hair, Math.sin(a) * 0.095, 0.17 + (i % 2) * 0.03, Math.cos(a) * 0.09 - 0.02, 1, 1, 1, 8)); }
  }
  if (L.ac === 1) { for (const sx of [-1, 1]) { const g = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.004, 6, 16), dark); g.position.set(sx * 0.04, 0.105, 0.108); headP.add(g); } const br = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.004, 0.004), dark); br.position.set(0, 0.108, 0.11); headP.add(br); }
  if (L.ac === 2) { const c = ball(0.124, trim, 0, 0.124, -0.004, 0.95, 1, 1.02, 20); c.geometry.dispose(); c.geometry = new THREE.SphereGeometry(0.124, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.5); headP.add(c); const v = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.008, 0.08), trim); v.position.set(0, 0.138, 0.13); v.rotation.x = 0.12; headP.add(v); }
  if (L.ac === 4) { const c = ball(0.126, trim, 0, 0.13, -0.004, 0.95, 1, 1.02, 18); c.geometry.dispose(); c.geometry = new THREE.SphereGeometry(0.126, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.55); headP.add(c); headP.add(ball(0.03, trim, 0, 0.26, 0, 1, 1, 1, 8)); }
  if (L.ac === 5) { const cr = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.014, 6, 20), mat('#f1c40f', 0.3)); cr.rotation.x = Math.PI / 2; cr.position.y = 0.225; headP.add(cr); for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2, t = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.04, 5), mat('#f1c40f', 0.3)); t.position.set(Math.sin(a) * 0.1, 0.25, Math.cos(a) * 0.1); headP.add(t); } }
  if (L.bd === 1) { const b = ball(0.078, hair, 0, 0.035, 0.03, 1, 0.8, 1, 14); b.material = mat(HAIRS[L.hc] || HAIR, 0.8); headP.add(b); }
  if (L.bd === 2) { const b = ball(0.085, hair, 0, 0.0, 0.035, 1, 1.1, 1, 14); headP.add(b); }
  if (L.bd === 3) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.012, 0.012), hair); m.position.set(0, 0.058, 0.118); headP.add(m); }
  if (L.ac === 3) { const b = new THREE.Mesh(new THREE.TorusGeometry(0.108, 0.012, 6, 24), trim); b.rotation.x = Math.PI / 2; b.position.y = 0.15; b.scale.set(0.95, 1, 1.02); headP.add(b); }
  for (const s of [-1, 1]) {
    headP.add(ball(0.019, skin, s * 0.107, 0.085, 0, 0.5, 1.2, 1, 8));       // oreilles
    headP.add(ball(0.0155, eyeW, s * 0.04, 0.105, 0.098, 1, 0.8, 0.6, 10));  // yeux
    headP.add(ball(0.0085, iris, s * 0.04, 0.105, 0.108, 1, 1, 0.4, 8));
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.007, 0.01), hair); brow.position.set(s * 0.04, 0.131, 0.1); brow.rotation.z = -s * 0.12; headP.add(brow);
  }
  headP.add(ball(0.016, skin, 0, 0.078, 0.118, 0.9, 1.2, 1.1, 10));          // nez
  const mouth = new THREE.Mesh(new THREE.CapsuleGeometry(0.004, 0.034, 3, 6), lipM); mouth.rotation.z = Math.PI / 2; mouth.position.set(0, 0.04, 0.108); headP.add(mouth);

  // bras : épaule → coude → main
  function arm(s) {
    const sh = new THREE.Group(); sh.position.set(s * (fem ? 0.188 : 0.215), 0.4, 0); spine.add(sh);
    sh.add(ball(0.052, top, 0, 0, 0, 1, 1, 1, 12));
    sh.add(limb(0.27, 0.047, top));
    const el = new THREE.Group(); el.position.y = -0.27; sh.add(el);
    el.add(ball(0.043, top, 0, 0, 0, 1, 1, 1, 10)); el.add(limb(0.25, 0.04, top));
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.03, 12), trim); cuff.position.y = -0.235; el.add(cuff);
    const hand = ball(0.036, skin, 0, -0.29, 0.005, 0.85, 1.25, 0.6, 12); el.add(hand);
    const thumb = ball(0.014, skin, -s * 0.026, -0.275, 0.012, 0.7, 1.5, 0.7, 8); el.add(thumb);
    sh.rotation.z = s * 0.06; return { sh, el };
  }
  const aL = arm(-1), aR = arm(1);

  // jambes : hanche → genou → cheville
  function leg(s) {
    const hip = new THREE.Group(); hip.position.set(s * 0.085, -0.02, 0); pelvis.add(hip);
    hip.add(limb(0.43, 0.075, jeans, 1, 1.02));
    const kn = new THREE.Group(); kn.position.y = -0.43; hip.add(kn);
    kn.add(ball(0.06, jeans, 0, 0, 0, 1, 1, 1, 10)); kn.add(limb(0.42, 0.058, jeans));
    const an = new THREE.Group(); an.position.y = -0.42; kn.add(an);
    const foot = ball(0.052, shoe, 0, -0.035, 0.05, 1.0, 0.8, 2.3, 14); an.add(foot);
    const toe = ball(0.05, shoe, 0, -0.045, 0.1, 1, 0.7, 1.2, 12); an.add(toe);
    const so = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.022, 0.26), sole); so.position.set(0, -0.078, 0.06); so.castShadow = true; an.add(so);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.104, 0.012, 0.1), trim); stripe.position.set(0, -0.055, 0.02); an.add(stripe);
    return { hip, kn, an };
  }
  const lL = leg(-1), lR = leg(1);

  const blob = new THREE.Mesh(new THREE.CircleGeometry(0.34, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false }));
  blob.position.y = 0.03; group.add(blob);
  if (name) group.add(nameSprite(name));

  // Mouvement : cycle de marche réel (city-walk.js), rejoué à une cadence qui suit la vitesse réelle du personnage
  let sit = 0, sitT = false; // posture assise (cinéma)
  let phase = 0, walk = 0, target = false, speed = 0, lastX = null, lastZ = 0;
  const rot = (o, x, y, z) => o.rotation.set(x, y ?? 0, z ?? 0);
  const N = WALK.n, CH = WALK.ch, K = 1.3;
  const samp = (arr, ph) => { const x = ph * N, i = Math.floor(x) % N, f = x - Math.floor(x); return arr[i] + (arr[(i + 1) % N] - arr[i]) * f; };
  return {
    group,
    setWalking(on) { target = !!on; },
    setSeated(on) { sitT = !!on; },
    get seated() { return sitT; },
    face(yaw, dt) { let d = yaw - group.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d)); group.rotation.y += d * Math.min(1, dt * 10); },
    update(dt, t) {
      const px = group.position.x, pz = group.position.z;
      if (lastX !== null && dt > 0) speed += (Math.min(8, Math.hypot(px - lastX, pz - lastZ) / dt) - speed) * Math.min(1, dt * 6);
      lastX = px; lastZ = pz;
      walk += ((target ? 1 : 0) - walk) * Math.min(1, dt * 8);
      const freq = Math.min(1.9, Math.max(0.8, speed / 1.7)); // cycles par seconde
      phase = (phase + dt * freq * walk) % 1;
      const idle = 1 - walk, w = walk, f = (k) => samp(CH[k], phase);
      // jambes : A = côté x>0 (lR), B = côté x<0 (lL)
      rot(lR.hip, f('hipA') * K * w, 0, -0.02); rot(lL.hip, f('hipB') * K * w, 0, 0.02);
      rot(lR.kn, Math.max(0, f('knA')) * 1.1 * w, 0, 0); rot(lL.kn, Math.max(0, f('knB')) * 1.1 * w, 0, 0);
      rot(lR.an, f('anA') * w, 0, 0); rot(lL.an, f('anB') * w, 0, 0);
      // bras : balancement opposé aux jambes, coude légèrement fléchi
      rot(aR.sh, f('shA') * K * w + Math.sin(t * 1.2 + 1) * 0.02 * idle, 0, 0.06 - 0.02 * idle); rot(aL.sh, f('shB') * K * w + Math.sin(t * 1.2) * 0.02 * idle, 0, -0.06 + 0.02 * idle);
      rot(aR.el, -0.2 + f('elA') * K * w, 0, 0); rot(aL.el, -0.2 + f('elB') * K * w, 0, 0);
      // buste : inclinaison, rotation inverse du bassin, rebond, respiration, regard
      rot(spine, (0.04 + f('lean')) * w, f('spY') * w, 0); pelvis.rotation.y = f('pelY') * w; pelvis.rotation.z = f('sway') * 1.2 * w;
      body.position.y = f('bob') * 1.3 * w - 0.012 * w;
      spine.scale.set(1, 1 + Math.sin(t * 1.8) * 0.006 * idle, 1 + Math.sin(t * 1.8) * 0.01 * idle);
      rot(headP, -0.03 * w + Math.sin(t * 0.7) * 0.02 * idle, Math.sin(t * 0.5) * 0.12 * idle, 0);
      sit += ((sitT ? 1 : 0) - sit) * Math.min(1, dt * 7);
      if (sit > 0.002) { // assis : cuisses à l'horizontale, genoux fléchis, bassin abaissé, bras posés
        const k = sit; lR.hip.rotation.x = lR.hip.rotation.x * (1 - k) - 1.5 * k; lL.hip.rotation.x = lL.hip.rotation.x * (1 - k) - 1.5 * k;
        lR.kn.rotation.x = lR.kn.rotation.x * (1 - k) + 1.5 * k; lL.kn.rotation.x = lL.kn.rotation.x * (1 - k) + 1.5 * k; lR.an.rotation.x *= (1 - k); lL.an.rotation.x *= (1 - k);
        body.position.y -= 0.5 * k; aR.sh.rotation.x = aR.sh.rotation.x * (1 - k) - 0.55 * k; aL.sh.rotation.x = aL.sh.rotation.x * (1 - k) - 0.55 * k;
      }
    },
  };
}
