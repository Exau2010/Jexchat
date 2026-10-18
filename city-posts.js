// city-posts.js — JexCity : publications portées par les bateaux et affichées sur des panneaux dans les rues et le long des routes.
// Les publications viennent de /api/posts (mêmes données et mêmes autorisations que le fil JexChat) ; rien n'est copié.
// Toucher un bateau suspend son trajet (b.paused) et ouvre la publication ; la fermer le relance. Toucher un panneau l'ouvre aussi.
// Légèreté : les panneaux flottent doucement (calcul trivial) et se tournent vers la caméra ; leur texture n'est dessinée que lorsqu'on
// s'en approche (< 60 m) et libérée quand on s'éloigne (> 110 m). Aucun panneau n'est dessiné au-delà de 60 m.
import * as THREE from 'three';
import * as G from './city-geo.js';
import { postText } from './city-api.js';

const hitMat = new THREE.MeshBasicMaterial({ visible: false });
const FONT = 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif';

function wrap(c, text, maxW, maxLines) {
  const words = text.split(/\s+/).filter(Boolean), lines = []; let line = '';
  for (const w of words) {
    const t = line ? line + ' ' + w : w;
    if (c.measureText(t).width > maxW && line) { lines.push(line); line = w; if (lines.length === maxLines) break; } else line = t;
  }
  if (lines.length < maxLines && line) lines.push(line);
  else if (lines.length === maxLines) { let l = lines[maxLines - 1]; while (c.measureText(l + '…').width > maxW && l.length > 1) l = l.slice(0, -1); lines[maxLines - 1] = l + '…'; }
  return lines;
}
function mediaTag(p) { const t = p.mediaType !== 'none' ? p.mediaType : p.sharedFrom?.mediaType; return t === 'video' ? '▶ Vidéo' : t === 'image' ? 'Photo' : t === 'link' ? 'Lien' : ''; }

// Étiquette claire des bateaux (police agrandie pour rester lisible à distance).
function boatTexture(post) {
  const cv = document.createElement('canvas'); cv.width = 384; cv.height = 160;
  const c = cv.getContext('2d');
  c.fillStyle = 'rgba(255,252,244,.97)'; c.beginPath();
  if (c.roundRect) c.roundRect(4, 4, 376, 124, 18); else c.rect(4, 4, 376, 124); c.fill();
  c.beginPath(); c.moveTo(180, 127); c.lineTo(192, 150); c.lineTo(204, 127); c.fill();
  c.textBaseline = 'top'; c.textAlign = 'left';
  c.fillStyle = '#9a3f27'; c.font = `700 28px ${FONT}`; c.fillText((post.author?.username || 'JexChat').slice(0, 20), 20, 14);
  c.fillStyle = '#1f1e26'; c.font = `500 24px ${FONT}`;
  wrap(c, postText(post) || mediaTag(post) || '…', 344, 2).forEach((l, i) => c.fillText(l, 20, 52 + i * 30));
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; return tex;
}

// Panneau (écran) : fond sombre, texte clair, fort contraste ; 512×256 px pour 3,6 × 1,8 m.
function boardTexture(post) {
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 256;
  const c = cv.getContext('2d');
  c.fillStyle = '#141d2e'; c.fillRect(0, 0, 512, 256);
  c.strokeStyle = '#f0b463'; c.lineWidth = 6; c.strokeRect(3, 3, 506, 250);
  c.textBaseline = 'top'; c.textAlign = 'left';
  c.fillStyle = '#f0b463'; c.font = `700 34px ${FONT}`; c.fillText((post.author?.username || 'JexChat').slice(0, 22), 24, 20);
  c.fillStyle = '#ffffff'; c.font = `500 30px ${FONT}`;
  wrap(c, postText(post) || mediaTag(post) || '…', 464, 3).forEach((l, i) => c.fillText(l, 24, 68 + i * 40));
  c.fillStyle = '#b9c0cc'; c.font = `600 24px ${FONT}`;
  const tag = mediaTag(post); c.fillText(`${tag ? tag + '   ' : ''}♥ ${post.likesCount || 0}`, 24, 206);
  c.textAlign = 'right'; c.fillText('Toucher pour ouvrir', 488, 206);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; return tex;
}
const idleTexture = (() => {
  let t = null;
  return () => { if (t) return t; const cv = document.createElement('canvas'); cv.width = 64; cv.height = 32; const c = cv.getContext('2d'); c.fillStyle = '#141d2e'; c.fillRect(0, 0, 64, 32); t = new THREE.CanvasTexture(cv); return t; };
})();

export function createPosts({ world, pickables, layout }) {
  // ── bateaux ──
  const slots = world.boats.map((b, i) => {
    const hit = new THREE.Mesh(new THREE.BoxGeometry(3.2, 3, 6.5), hitMat);
    hit.position.y = 1.2; hit.userData = { pick: 'boat', index: i }; b.g.add(hit); pickables.push(hit);
    return { boat: b, hit, sprite: null, post: null };
  });

  // ── panneaux dans le monde : quais (près des lampadaires) et routes ──
  const spots = [];
  const lamps = layout?.lamps || [];
  for (let i = 2; i < lamps.length && spots.length < 8; i += Math.max(5, Math.floor(lamps.length / 8))) {
    const l = lamps[i], out = l.x >= G.canalX(l.z) ? 1 : -1; spots.push({ x: l.x + out * 1.7, z: l.z });
  }
  for (const r of G.ROADS) for (const k of [1, 3]) { const [x, z] = r.pts[k]; spots.push({ x: x + 4.5, z }); }
  const root = new THREE.Group(); world.root.add(root);
  const poleMat = new THREE.MeshLambertMaterial({ color: '#2f3238' }), frameMat = new THREE.MeshLambertMaterial({ color: '#1a1f2b' });
  const poleGeo = new THREE.CylinderGeometry(0.06, 0.08, 1, 6), frameGeo = new THREE.BoxGeometry(3.8, 2, 0.12), screenGeo = new THREE.PlaneGeometry(3.6, 1.8), hitGeo = new THREE.BoxGeometry(4, 2.2, 0.8);
  const boards = spots.map((sp, i) => {
    const g = new THREE.Group(); g.position.set(sp.x, G.groundY(sp.x, sp.z), sp.z);
    const pole = new THREE.Mesh(poleGeo, poleMat); pole.scale.y = 3.2; pole.position.y = 1.6; g.add(pole); // le mât reste fixe
    const face = new THREE.Group(); face.position.y = 4.1; g.add(face);                                      // l'écran flotte et se tourne vers la caméra
    face.add(new THREE.Mesh(frameGeo, frameMat));
    const mat = new THREE.MeshBasicMaterial({ map: idleTexture(), toneMapped: false });
    const screen = new THREE.Mesh(screenGeo, mat); screen.position.z = 0.07; face.add(screen);
    const hit = new THREE.Mesh(hitGeo, hitMat); hit.userData = { pick: 'board', index: i }; face.add(hit); pickables.push(hit);
    g.visible = false; root.add(g);
    return { g, face, mat, hit, post: null, tex: null, phase: i * 1.3 };
  });

  let current = null;
  function assign(posts) {
    const usable = (posts || []).filter((p) => p && (postText(p) || p.mediaType !== 'none'));
    slots.forEach((s, i) => {
      if (s.sprite) { s.boat.g.remove(s.sprite); s.sprite.material.map.dispose(); s.sprite.material.dispose(); s.sprite = null; }
      s.post = usable[i] || null;
      if (!s.post) return;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: boatTexture(s.post), transparent: true, depthWrite: false }));
      sp.scale.set(3.9, 1.63, 1); sp.position.set(0, 3.8, 0); sp.renderOrder = 7; s.boat.g.add(sp); s.sprite = sp;
    });
    boards.forEach((b, i) => {
      b.post = usable[slots.length + i] || null;
      if (b.tex) { b.tex.dispose(); b.tex = null; b.mat.map = idleTexture(); b.mat.needsUpdate = true; } // redessiné à la prochaine approche
    });
  }
  function select(index) { const s = slots[index]; if (!s?.post) return null; release(); s.boat.paused = true; current = s; return s.post; }
  function selectBoard(index) { return boards[index]?.post || null; }
  function release() { if (current) { current.boat.paused = false; current = null; } }

  function update(camPos, t = 0) {
    for (const s of slots) if (s.sprite) s.sprite.visible = s.boat.g.position.distanceTo(camPos) < 70;
    for (const b of boards) {
      const dx = camPos.x - b.g.position.x, dz = camPos.z - b.g.position.z, d = Math.hypot(dx, dz);
      const show = !!b.post && d < 60;
      if (b.g.visible !== show) b.g.visible = show;
      if (show) {
        if (!b.tex) { b.tex = boardTexture(b.post); b.mat.map = b.tex; b.mat.needsUpdate = true; }
        b.face.position.y = 4.1 + Math.sin(t * 0.9 + b.phase) * 0.12; // flottement
        let dy = Math.atan2(dx, dz) - b.face.rotation.y; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); b.face.rotation.y += dy * 0.08; // se tourne doucement
      } else if (b.tex && d > 110) { b.tex.dispose(); b.tex = null; b.mat.map = idleTexture(); b.mat.needsUpdate = true; }
    }
  }
  return { assign, select, selectBoard, release, update, capacity: slots.length + boards.length, get selected() { return current?.post || null; }, slots, boards };
}
