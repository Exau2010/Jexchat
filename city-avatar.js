// city-avatar.js — JexCity : avatars lisibles (corps, tête, écharpe/bonnet aux couleurs du profil Jexchat).
// Les couleurs viennent de user.identity (colorA / colorB) : aucun profil n'est copié, on lit celui de JexChat.
import * as THREE from 'three';

const matCache = new Map();
function lambert(color) {
  if (!matCache.has(color)) matCache.set(color, new THREE.MeshLambertMaterial({ color }));
  return matCache.get(color);
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
  sp.scale.set(2.2, 0.55, 1); sp.position.y = 2.2; sp.renderOrder = 5;
  return sp;
}

export function createAvatar({ colorA, colorB, name = '' } = {}) {
  const A = safeColor(colorA, '#6C63FF'), B = safeColor(colorB, '#ff9f43');
  const group = new THREE.Group();
  const body = new THREE.Group(); group.add(body);

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.27, 0.55, 4, 10), lambert(A)); torso.position.y = 1.0; torso.castShadow = true; body.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.21, 14, 10), lambert('#f1c9a5')); head.position.y = 1.62; head.castShadow = true; body.add(head);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.225, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2.1), lambert(B)); cap.position.y = 1.64; body.add(cap);
  const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.06, 6, 14), lambert(B)); scarf.rotation.x = Math.PI / 2; scarf.position.y = 1.36; body.add(scarf);

  const limb = (x, y, w, h, color) => {
    const pivot = new THREE.Group(); pivot.position.set(x, y, 0);
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), lambert(color)); m.position.y = -h / 2; m.castShadow = true; pivot.add(m); body.add(pivot); return pivot;
  };
  const legL = limb(-0.11, 0.55, 0.15, 0.55, '#2d3142'), legR = limb(0.11, 0.55, 0.15, 0.55, '#2d3142');
  const armL = limb(-0.33, 1.28, 0.11, 0.5, A), armR = limb(0.33, 1.28, 0.11, 0.5, A);

  const blob = new THREE.Mesh(new THREE.CircleGeometry(0.38, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false }));
  blob.position.y = 0.03; group.add(blob);
  if (name) group.add(nameSprite(name));

  let phase = 0, walk = 0, target = false;
  return {
    group,
    setWalking(on) { target = !!on; },
    face(yaw, dt) { let d = yaw - group.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d)); group.rotation.y += d * Math.min(1, dt * 10); },
    update(dt, t) {
      walk += ((target ? 1 : 0) - walk) * Math.min(1, dt * 9);
      phase += dt * 7.5 * walk;
      const s = Math.sin(phase) * 0.75 * walk;
      legL.rotation.x = s; legR.rotation.x = -s; armL.rotation.x = -s * 0.8; armR.rotation.x = s * 0.8;
      body.position.y = Math.abs(Math.sin(phase)) * 0.05 * walk;
      const br = 1 + Math.sin(t * 2) * 0.012 * (1 - walk); body.scale.set(1, br, 1);
    },
  };
}
