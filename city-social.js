// city-social.js — JexCity : présence temps réel et avatars des autres utilisateurs.
// Le serveur ne diffuse que : arrivée, destination/position, humeur, départ (events city:*), jamais en base.
// Les autres avatars marchent localement vers la destination reçue : peu de trafic, mouvement fluide.
import * as THREE from 'three';
import * as G from './city-geo.js';
import { createAvatar } from './city-avatar.js';

const SPEED = 4.2, FAR = 90; // m/s ; au-delà de 90 m un avatar n'est plus dessiné

const hitMat = new THREE.MeshBasicMaterial({ visible: false });
const hitGeo = new THREE.CapsuleGeometry(0.55, 1.1, 2, 6);

function moodSprite(text) {
  const cv = document.createElement('canvas'); cv.width = 384; cv.height = 96;
  const c = cv.getContext('2d');
  c.font = '500 30px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  let t = text; while (c.measureText(t).width > 330 && t.length > 3) t = t.slice(0, -2);
  if (t !== text) t = t.trimEnd() + '…';
  const w = Math.min(372, c.measureText(t).width + 40);
  c.fillStyle = 'rgba(255,252,244,.96)'; c.beginPath();
  if (c.roundRect) c.roundRect((384 - w) / 2, 8, w, 54, 27); else c.rect((384 - w) / 2, 8, w, 54);
  c.fill();
  c.beginPath(); c.moveTo(192 - 9, 61); c.lineTo(192, 78); c.lineTo(192 + 9, 61); c.fill();
  c.fillStyle = '#2b2a33'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(t, 192, 36);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sp.scale.set(2.6, 0.65, 1); sp.position.y = 2.85; sp.renderOrder = 6;
  return sp;
}
function disposeSprite(sp) { sp.material.map?.dispose(); sp.material.dispose(); }
// Libère la mémoire GPU d'un avatar retiré (géométries et étiquettes) ; la capsule de sélection est partagée, on n'y touche pas.
export function disposeAvatar(group) {
  group.traverse((o) => { if (o.isSprite) { o.material.map?.dispose(); o.material.dispose(); } else if (o.geometry && o.geometry !== hitGeo) o.geometry.dispose(); });
}

export function createSocial({ scene, layout, pickables, socket, getSelf }) {
  const remotes = new Map(); // id -> { id, user, av, hit, mood, x, z, path }
  let joined = false, pingT = 0, moveT = 0;

  function setMood(r, text) {
    if (r.moodSp) { r.av.group.remove(r.moodSp); disposeSprite(r.moodSp); r.moodSp = null; }
    r.user.mood = text || '';
    if (text) { r.moodSp = moodSprite(text); r.av.group.add(r.moodSp); }
  }
  function add(u) {
    if (!u || remotes.has(u.id)) return;
    const av = createAvatar({ colorA: u.identity?.colorA, colorB: u.identity?.colorB, name: u.username, look: u.look });
    const hit = new THREE.Mesh(hitGeo, hitMat); hit.position.y = 1.05; hit.userData = { pick: 'avatar', userId: u.id };
    av.group.add(hit); pickables.push(hit);
    const x = Number.isFinite(u.x) ? u.x : 0, z = Number.isFinite(u.z) ? u.z : 0;
    av.group.position.set(x, G.groundY(x, z), z); scene.add(av.group);
    const r = { id: u.id, user: { id: u.id, username: u.username, identity: u.identity, avatarUrl: u.avatarUrl, look: u.look, mood: '' }, av, hit, x, z, path: [], moodSp: null };
    setMood(r, u.mood); remotes.set(u.id, r);
    if (Number.isFinite(u.tx) && (Math.abs(u.tx - x) > 0.5 || Math.abs(u.tz - z) > 0.5)) r.path = G.planPath(layout, [x, z], [u.tx, u.tz]);
  }
  function remove(id) {
    const r = remotes.get(id); if (!r) return;
    scene.remove(r.av.group);
    const i = pickables.indexOf(r.hit); if (i >= 0) pickables.splice(i, 1);
    disposeAvatar(r.av.group); // inclut l'étiquette d'humeur (enfant du groupe)
    remotes.delete(id);
  }
  function clear() { for (const id of [...remotes.keys()]) remove(id); }

  socket.on('city:appear', add);
  socket.on('city:left', ({ id }) => remove(id));
  socket.on('city:moved', ({ id, x, z, tx, tz }) => {
    const r = remotes.get(id); if (!r) return;
    if (Math.hypot(r.x - x, r.z - z) > 8) { r.x = x; r.z = z; } // trop d'écart : on recale
    r.path = G.planPath(layout, [r.x, r.z], [tx, tz]);
  });
  // Apparence modifiée par un joueur : on reconstruit son avatar à la même place (rare, donc sans coût au quotidien).
  socket.on('city:look', ({ id, look }) => {
    const r = remotes.get(id); if (!r) return;
    const old = r.av.group, pos = old.position.clone(), yaw = old.rotation.y, mood = r.user.mood;
    scene.remove(old); const i = pickables.indexOf(r.hit); if (i >= 0) pickables.splice(i, 1); disposeAvatar(old);
    r.user.look = look; r.moodSp = null;
    r.av = createAvatar({ colorA: r.user.identity?.colorA, colorB: r.user.identity?.colorB, name: r.user.username, look });
    r.hit = new THREE.Mesh(hitGeo, hitMat); r.hit.position.y = 1.05; r.hit.userData = { pick: 'avatar', userId: id }; r.av.group.add(r.hit); pickables.push(r.hit);
    r.av.group.position.copy(pos); r.av.group.rotation.y = yaw; scene.add(r.av.group); setMood(r, mood);
  });
  socket.on('city:mood', ({ id, mood }) => { const r = remotes.get(id); if (r) setMood(r, mood); });

  function join(mood) {
    const s = getSelf();
    socket.emit('city:join', { x: s.x, z: s.z, mood }, (res) => {
      if (!res || res.error) { api.onError?.(res?.error || 'Présence indisponible.'); return; }
      joined = true; clear(); (res.others || []).forEach(add);
      api.onJoined?.(res);
    });
  }
  // Après coupure : le serveur a oublié notre présence, on la ré-annonce.
  socket.on('connect', () => { if (joined) join(); });
  socket.on('disconnect', () => { clear(); });

  function update(dt, t, camPos) {
    for (const r of remotes.values()) {
      const g = r.av.group;
      if (r.path.length) {
        const [wx, wz] = r.path[0], dx = wx - r.x, dz = wz - r.z, d = Math.hypot(dx, dz);
        if (d < 0.25) r.path.shift();
        else {
          const s = Math.min(d, SPEED * dt); const [nx, nz] = G.slideMove(layout, r.x, r.z, r.x + dx / d * s, r.z + dz / d * s);
          if (Math.hypot(nx - r.x, nz - r.z) < s * 0.2) r.path.length = 0; else { r.x = nx; r.z = nz; }
          r.av.face(Math.atan2(dx, dz), dt);
        }
      }
      r.av.setWalking(r.path.length > 0);
      g.position.set(r.x, G.groundY(r.x, r.z), r.z);
      const near = Math.hypot(camPos.x - r.x, camPos.z - r.z) < FAR;
      g.visible = near;
      if (near) r.av.update(dt, t);
    }
    if (joined) { pingT += dt; if (pingT > 25) { pingT = 0; socket.emit('city:ping'); } moveT += dt; }
  }

  const api = {
    remotes, join, update, clear, remove, onError: null, onJoined: null,
    get count() { return remotes.size; },
    emitMove(x, z, tx, tz) { if (joined) { socket.emit('city:move', { x, z, tx, tz }); moveT = 0; } },
    setMood(text) { if (joined) socket.emit('city:mood', { mood: text }); },
    leave() { if (joined) { socket.emit('city:leave'); joined = false; } },
    get joined() { return joined; },
  };
  return api;
}
