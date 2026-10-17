// city-posts.js — JexCity : publications portées par les bateaux.
// Les publications viennent de /api/posts (mêmes données et mêmes autorisations que le fil JexChat) ;
// rien n'est copié. Toucher un bateau suspend son trajet (b.paused) et ouvre la publication ; la fermer le relance.
import * as THREE from 'three';
import { postText } from './city-api.js';

const hitMat = new THREE.MeshBasicMaterial({ visible: false });

function labelTexture(post) {
  const cv = document.createElement('canvas'); cv.width = 320; cv.height = 128;
  const c = cv.getContext('2d');
  c.fillStyle = 'rgba(255,252,244,.96)'; c.beginPath();
  if (c.roundRect) c.roundRect(4, 4, 312, 100, 16); else c.rect(4, 4, 312, 100); c.fill();
  c.beginPath(); c.moveTo(150, 103); c.lineTo(160, 122); c.lineTo(170, 103); c.fill();
  c.textBaseline = 'top'; c.textAlign = 'left';
  c.fillStyle = '#b5553b'; c.font = '700 22px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  c.fillText((post.author?.username || 'JexChat').slice(0, 22), 18, 14);
  c.fillStyle = '#2b2a33'; c.font = '400 20px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  const words = (postText(post) || (post.mediaType !== 'none' ? '📷 Média' : '…')).split(/\s+/);
  let line = '', y = 44, lines = 0;
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (c.measureText(test).width > 284 && line) { c.fillText(line, 18, y); y += 25; lines++; line = w; if (lines === 2) break; } else line = test;
  }
  if (lines < 2 && line) c.fillText(line, 18, y); else if (lines === 2) c.fillText('…', 18, y);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; return tex;
}

export function createPosts({ world, pickables }) {
  const slots = world.boats.map((b, i) => {
    const hit = new THREE.Mesh(new THREE.BoxGeometry(3.2, 3, 6.5), hitMat);
    hit.position.y = 1.2; hit.userData = { pick: 'boat', index: i }; b.g.add(hit); pickables.push(hit);
    return { boat: b, hit, sprite: null, post: null };
  });
  let current = null;

  function assign(posts) {
    const usable = (posts || []).filter((p) => p && (postText(p) || p.mediaType !== 'none'));
    slots.forEach((s, i) => {
      if (s.sprite) { s.boat.g.remove(s.sprite); s.sprite.material.map.dispose(); s.sprite.material.dispose(); s.sprite = null; }
      s.post = usable[i] || null;
      if (!s.post) return;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(s.post), transparent: true, depthWrite: false }));
      sp.scale.set(3, 1.2, 1); sp.position.set(0, 3.6, 0); sp.renderOrder = 7; s.boat.g.add(sp); s.sprite = sp;
    });
  }
  function select(index) {
    const s = slots[index]; if (!s?.post) return null;
    release(); s.boat.paused = true; current = s; return s.post;
  }
  function release() { if (current) { current.boat.paused = false; current = null; } }
  function update(camPos) {
    for (const s of slots) if (s.sprite) { s.sprite.visible = s.boat.g.position.distanceTo(camPos) < 70; }
  }
  return { assign, select, release, update, get selected() { return current?.post || null; }, slots };
}
