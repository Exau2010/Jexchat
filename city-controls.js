// city-controls.js — JexCity : caméra orbitale stable + entrées souris / tactile.
//  • Un clic/une touche courte sur le sol = déplacement.
//  • Souris : glisser (clic gauche, droit ou milieu) = tourner, molette = zoom.
//  • Tactile : zone de caméra dédiée (#campad) pour tourner, pincement à deux doigts = zoom.
//    Un glissement hors de cette zone ne fait rien : plus de conflit entre « marcher » et « tourner ».
import * as THREE from 'three';
import * as G from './city-geo.js';

export function createControls({ camera, dom, layout, pickables, onGround, onBuilding, padEl }) {
  const st = { yaw: 0.6, pitch: 0.62, dist: 16, tYaw: 0.6, tPitch: 0.62, tDist: 16 };
  const target = new THREE.Vector3(), tTarget = new THREE.Vector3();
  const ray = new THREE.Raycaster(); const ndc = new THREE.Vector2();
  const pointers = new Map(); let pinch = 0, gesture = null;
  const MIN_D = 5, MAX_D = 70, MIN_P = 0.12, MAX_P = 1.3;

  const rotate = (dx, dy) => { st.tYaw -= dx * 0.0055; st.tPitch = G.clamp(st.tPitch + dy * 0.0045, MIN_P, MAX_P); };
  const zoom = (f) => { st.tDist = G.clamp(st.tDist * f, MIN_D, MAX_D); };

  function pick(clientX, clientY) {
    const r = dom.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(pickables, false)[0];
    if (!hit) return;
    if (hit.object.userData.pick === 'ground') onGround?.(hit.point);
    else onBuilding?.(hit);
  }
  const inPad = (e) => { if (!padEl) return false; const r = padEl.getBoundingClientRect(); return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom; };

  dom.addEventListener('contextmenu', (e) => e.preventDefault());
  dom.addEventListener('pointerdown', (e) => {
    dom.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), pad: e.pointerType === 'touch' && inPad(e), moved: false, btn: e.button });
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); }
  });
  dom.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId); if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
    if (!p.moved && Math.hypot(e.clientX - p.sx, e.clientY - p.sy) > 7) p.moved = true;
    if (pointers.size === 2 && e.pointerType === 'touch') {
      const [a, b] = [...pointers.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch > 0) zoom(pinch / d); pinch = d; p.moved = true; return;
    }
    if (e.pointerType === 'touch') { if (p.pad) rotate(dx, dy); return; }
    if (p.moved) rotate(dx, dy); // souris : tout bouton, après 7 px
  });
  const end = (e) => {
    const p = pointers.get(e.pointerId); pointers.delete(e.pointerId); pinch = 0;
    if (!p || e.type === 'pointercancel') return;
    const tap = !p.moved && performance.now() - p.t < 500 && !p.pad && (p.btn === 0 || e.pointerType === 'touch');
    if (tap && pointers.size === 0) pick(e.clientX, e.clientY);
  };
  dom.addEventListener('pointerup', end); dom.addEventListener('pointercancel', end);
  dom.addEventListener('wheel', (e) => { e.preventDefault(); zoom(Math.exp(e.deltaY * 0.0011)); }, { passive: false });
  addEventListener('keydown', (e) => {
    if (e.target?.closest?.('input,textarea,select')) return;
    const k = e.key;
    if (k === 'ArrowLeft') st.tYaw += 0.12; else if (k === 'ArrowRight') st.tYaw -= 0.12;
    else if (k === 'ArrowUp') st.tPitch = G.clamp(st.tPitch + 0.06, MIN_P, MAX_P); else if (k === 'ArrowDown') st.tPitch = G.clamp(st.tPitch - 0.06, MIN_P, MAX_P);
    else if (k === '+' || k === '=') zoom(0.88); else if (k === '-') zoom(1.14);
  });

  const off = new THREE.Vector3();
  function update(dt, playerPos) {
    const k = 1 - Math.exp(-dt * 8);
    tTarget.set(playerPos.x, playerPos.y + 1.3, playerPos.z); target.lerp(tTarget, 1 - Math.exp(-dt * 10));
    st.yaw += (st.tYaw - st.yaw) * k; st.pitch += (st.tPitch - st.pitch) * k;
    // distance : on raccourcit si un bâtiment est entre le joueur et la caméra
    let want = st.tDist;
    const place = (d) => off.set(Math.sin(st.yaw) * Math.cos(st.pitch), Math.sin(st.pitch), Math.cos(st.yaw) * Math.cos(st.pitch)).multiplyScalar(d);
    for (let d = want; d > 3.2; d -= 1.2) {
      place(d); const x = target.x + off.x, y = target.y + off.y, z = target.z + off.z;
      const mid = [0.35, 0.7, 1].some((f) => G.cameraBlocked(layout, target.x + off.x * f, target.y + off.y * f, target.z + off.z * f));
      if (!mid && y > G.groundY(x, z) + 1.0) { want = d; break; } want = d;
    }
    st.dist += (want - st.dist) * (want < st.dist ? 1 - Math.exp(-dt * 14) : k);
    place(st.dist);
    camera.position.set(target.x + off.x, Math.max(target.y + off.y, G.groundY(target.x + off.x, target.z + off.z) + 0.9), target.z + off.z);
    camera.lookAt(target);
  }
  function snap(playerPos) { target.set(playerPos.x, playerPos.y + 1.3, playerPos.z); update(0.5, playerPos); }
  return { update, snap, rotate, zoom, state: st };
}
