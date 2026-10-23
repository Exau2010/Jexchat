// city-venues.js — JexCity : quartier des loisirs sur l'esplanade (sud de la Grande Avenue) :
// cafétéria, musée technologique, supermarché et stade. Bâtiments 3D à façade ouverte (on entre en marchant), vrais murs et comptoirs
// (collisions ajoutées à layout.rects), enseignes lumineuses. Toucher l'enseigne ouvre l'activité du lieu :
//   stade → Arène Stickman · cafétéria → humeur · supermarché → tenue · musée → expositions.
// Peu de maillages (≈ 90 au total), matériaux simples, aucune texture externe, aucune requête réseau.
import * as THREE from 'three';
import * as G from './city-geo.js';
import { LOOK_MAX } from './city-look.js';

const Y0 = G.TOWN.quayY, HZ = 9.5, WALL_H = 6.5;
export const STADIUM = { x: 84, z: 134, r: 13 };
export const VENUES = {
  cafe: { name: 'CAFÉTÉRIA', x: G.LOTS.cafe.cx, z: G.LOTS.cafe.cz, hx: 11, color: '#e8a55a', accent: '#ffb347' },
  museum: { name: 'MUSÉE TECH', x: G.LOTS.museum.cx, z: G.LOTS.museum.cz, hx: 12, color: '#cfd8e6', accent: '#35d0ff' },
  market: { name: 'SUPERMARCHÉ', x: G.LOTS.market.cx, z: G.LOTS.market.cz, hx: 14, color: '#e9eef0', accent: '#4dff88' },
  stadium: { name: 'STADE JEXCITY', x: STADIUM.x, accent: '#ffd23d' },
};

const mat = (c, o = {}) => new THREE.MeshLambertMaterial({ color: c, ...o });
const glow = (c) => new THREE.MeshBasicMaterial({ color: c, toneMapped: false });
function signTexture(text, color) {
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 128; const c = cv.getContext('2d');
  c.fillStyle = '#0b1020'; c.fillRect(0, 0, 512, 128);
  c.strokeStyle = color; c.lineWidth = 6; c.shadowColor = color; c.shadowBlur = 14; c.strokeRect(8, 8, 496, 112); c.shadowBlur = 0;
  c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.shadowColor = color; c.shadowBlur = 16;
  let fs = 62; c.font = `900 ${fs}px system-ui, sans-serif`; while (c.measureText(text).width > 450 && fs > 24) { fs -= 4; c.font = `900 ${fs}px system-ui, sans-serif`; }
  c.fillText(text, 256, 68);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const rect = (cx, cz, hx, hz, h, ang = 0) => ({ cx, cz, hx, hz, ax: [Math.cos(ang), Math.sin(ang)], az: [-Math.sin(ang), Math.cos(ang)], h });

export function createVenues({ root, layout, pickables, panelHost = document.body, actions = {} }) {
  const g = new THREE.Group(); g.name = 'city-venues'; root.add(g);
  const hitMat = new THREE.MeshBasicMaterial({ visible: false });
  const box = (parent, w, h, d, color, x, y, z, m) => { const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m || mat(color)); mesh.position.set(x, y, z); parent.add(mesh); return mesh; };
  const addHit = (parent, w, h, d, x, y, z, key) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), hitMat); m.position.set(x, y, z); m.userData = { pick: 'venue', venue: key }; parent.add(m); pickables.push(m); };
  const signPlane = (parent, w, h, x, y, z, key, text, accent) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: signTexture(text, accent), toneMapped: false })); m.position.set(x, y, z); m.rotation.y = Math.PI; parent.add(m); // visible depuis le nord (z plus petit)
    addHit(parent, w, h + 0.6, 1.2, x, y, z, key);
  };
  const anim = [];

  // ── Coque commune : sol, mur du fond, murs latéraux, toit, bandeau d'enseigne. Façade nord entièrement ouverte. ──
  function shell(key) {
    const V = VENUES[key], cx = V.x, CZ = V.z, hx = V.hx, grp = new THREE.Group(); g.add(grp);
    box(grp, hx * 2, 0.2, HZ * 2, '#b8b2a6', cx, Y0 + 0.1, CZ, mat(key === 'cafe' ? '#8a6a4a' : key === 'museum' ? '#dfe3ea' : '#d8dcdc'));
    box(grp, hx * 2, WALL_H, 0.5, V.color, cx, Y0 + WALL_H / 2, CZ + HZ - 0.25);
    box(grp, 0.5, WALL_H, HZ * 2, V.color, cx - hx + 0.25, Y0 + WALL_H / 2, CZ); box(grp, 0.5, WALL_H, HZ * 2, V.color, cx + hx - 0.25, Y0 + WALL_H / 2, CZ);
    box(grp, hx * 2 + 1.2, 0.5, HZ * 2 + 2, '#2a2f3a', cx, Y0 + WALL_H + 0.25, CZ - 0.4);
    box(grp, hx * 2 + 1.2, 0.18, 0.18, V.accent, cx, Y0 + WALL_H + 0.1, CZ - HZ - 1.3, glow(V.accent)); // liseré lumineux
    signPlane(grp, Math.min(hx * 2 - 2, 14), 2.4, cx, Y0 + WALL_H - 1.5, CZ - HZ - 0.05, key, V.name, V.accent);
    for (const sx of [-1, 1]) box(grp, 0.5, WALL_H, 0.5, '#2a2f3a', cx + sx * (hx - 0.25), Y0 + WALL_H / 2, CZ - HZ + 0.25);
    layout.rects.push(rect(cx, CZ + HZ - 0.25, hx, 0.3, WALL_H), rect(cx - hx + 0.25, CZ, 0.3, HZ, WALL_H), rect(cx + hx - 0.25, CZ, 0.3, HZ, WALL_H));
    // éclairage intérieur : plafonnier lumineux (matériau émissif, aucune lumière dynamique)
    box(grp, hx * 1.2, 0.08, 0.8, '#fff', cx, Y0 + WALL_H - 0.2, CZ - 1, glow('#fff7e0')); box(grp, hx * 1.2, 0.08, 0.8, '#fff', cx, Y0 + WALL_H - 0.2, CZ + 4, glow('#fff7e0'));
    return { grp, cx, hx, CZ };
  }
  const solid = (grp, w, h, d, color, x, y, z, m) => { const b = box(grp, w, h, d, color, x, Y0 + 0.2 + y, z, m); layout.rects.push(rect(x, z, w / 2, d / 2, h + 0.2)); return b; };
  const deco = (grp, w, h, d, color, x, y, z, m) => box(grp, w, h, d, color, x, Y0 + 0.2 + y, z, m);

  // ── Cafétéria : comptoir au fond, machine à café, tables et tabourets ──
  { const { grp, cx, hx, CZ } = shell('cafe');
    solid(grp, hx * 1.5, 1.1, 1.2, '#5b3b24', cx, 0.55, CZ + HZ - 2.2); deco(grp, hx * 1.5, 0.1, 1.5, '#e9dcc8', cx, 1.15, CZ + HZ - 2.2);
    deco(grp, 1, 0.8, 0.7, '#222', cx - 3, 1.6, CZ + HZ - 2.2); deco(grp, 0.6, 0.3, 0.1, '#ff4d4d', cx - 3, 2.1, CZ + HZ - 2.6, glow('#ff4d4d'));
    for (let i = 0; i < 6; i++) deco(grp, 0.9, 0.9, 0.2, ['#c0392b', '#f1c40f', '#27ae60', '#2980b9'][i % 4], cx - 4.5 + i * 1.8, 4, CZ + HZ - 0.7); // tableaux au mur
    [[-5, -2], [0, -3.5], [5, -2], [-5, 3], [5, 3.5]].forEach(([dx, dz], i) => {
      const x = cx + dx * (hx / 11), z = CZ + dz;
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.08, 12), mat('#f0e6d6')); t.position.set(x, Y0 + 1.15, z); grp.add(t);
      box(grp, 0.12, 0.9, 0.12, '#444', x, Y0 + 0.7, z);
      for (const [sx, sz] of [[1.1, 0], [-1.1, 0]]) { const s = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.1, 10), mat(['#e0503a', '#3a8fe0'][i % 2])); s.position.set(x + sx, Y0 + 0.75, z + sz); grp.add(s); }
      layout.rects.push(rect(x, z, 0.8, 0.8, 1.3));
    });
  }
  // ── Musée technologique : socles lumineux avec objets en rotation, grands écrans au mur ──
  { const { grp, cx, hx, CZ } = shell('museum');
    for (let i = 0; i < 4; i++) deco(grp, 3.2, 2.2, 0.1, '#0b1020', cx - hx + 3.6 + i * ((hx * 2 - 7.2) / 3), 3.4, CZ + HZ - 0.55, glow(['#0d4d6b', '#4d1a6b', '#0d6b45', '#6b3a0d'][i]));
    const shapes = [new THREE.IcosahedronGeometry(0.6, 0), new THREE.TorusKnotGeometry(0.4, 0.14, 40, 8), new THREE.OctahedronGeometry(0.65), new THREE.BoxGeometry(0.8, 0.8, 0.8)];
    [[-1, -3.2], [0, -4.4], [1, -3.2], [-0.5, 1.2], [0.5, 1.2]].forEach(([k, dz], i) => {
      const x = cx + k * (hx - 4) * 0.9, z = CZ + dz;
      solid(grp, 1.6, 1.1, 1.6, '#f2f4f8', x, 0.55, z); deco(grp, 1.7, 0.06, 1.7, V_ACC('museum'), x, 1.12, z, glow(V_ACC('museum')));
      const m = new THREE.Mesh(shapes[i % 4], new THREE.MeshStandardMaterial({ color: ['#35d0ff', '#ff4fa3', '#ffd23d', '#6aff9a', '#b48cff'][i], metalness: 0.6, roughness: 0.25, emissive: ['#0b3a4a', '#4a0b2a', '#4a3a0b', '#0b4a22', '#2a0b4a'][i] }));
      m.position.set(x, Y0 + 2.4, z); grp.add(m); anim.push((t) => { m.rotation.y = t * 0.8 + i; m.rotation.x = t * 0.5; m.position.y = Y0 + 2.4 + Math.sin(t * 1.5 + i) * 0.12; });
    });
  }
  // ── Supermarché : rayons (étagères colorées), caisses, enseigne ──
  { const { grp, cx, hx, CZ } = shell('market');
    const cols = ['#e74c3c', '#f1c40f', '#27ae60', '#3498db', '#e67e22', '#9b59b6'];
    for (let r = 0; r < 3; r++) {
      const z = CZ - 3.4 + r * 3.4; solid(grp, hx * 1.2, 1.9, 0.9, '#9aa3ad', cx - 2, 0.95, z);
      for (let k = 0; k < 14; k++) deco(grp, 0.7, 0.45, 0.5, cols[(k + r * 2) % 6], cx - 2 - hx * 0.6 + 0.6 + k * ((hx * 1.2 - 1.2) / 13), 2.1, z - 0.05);
      for (let k = 0; k < 14; k++) deco(grp, 0.7, 0.45, 0.5, cols[(k * 2 + r) % 6], cx - 2 - hx * 0.6 + 0.6 + k * ((hx * 1.2 - 1.2) / 13), 1.3, z + 0.05);
    }
    for (let c = 0; c < 2; c++) { solid(grp, 2.6, 1, 1.1, '#3a4250', cx + hx - 5, 0.5, CZ + 2.5 + c * 3.4); deco(grp, 0.6, 0.5, 0.4, '#111', cx + hx - 4.4, 1.3, CZ + 2.5 + c * 3.4, glow('#4dff88')); }
  }

  // ── Stade : tribunes ouvertes côté avenue (nord), pelouse rayée, buts, projecteurs ──
  { const S = STADIUM, grp = new THREE.Group(); grp.position.set(S.x, Y0, S.z); g.add(grp);
    const gap = 0.9, tStart = Math.PI + gap / 2, tLen = Math.PI * 2 - gap;
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(S.r + 0.6, S.r + 0.6, 7, 36, 1, true, tStart, tLen), mat('#cfd3da', { side: THREE.DoubleSide, emissive: new THREE.Color('#6b7080') })); wall.position.y = 3.5; grp.add(wall);
    const stand = new THREE.Mesh(new THREE.CylinderGeometry(S.r, S.r - 5, 5, 36, 1, true, tStart, tLen), mat('#c0392b', { side: THREE.DoubleSide })); stand.position.y = 2.5; grp.add(stand);
    const stand2 = new THREE.Mesh(new THREE.CylinderGeometry(S.r - 2.6, S.r - 6.4, 2.4, 36, 1, true, tStart, tLen), mat('#f1c40f', { side: THREE.DoubleSide })); stand2.position.y = 1.2; grp.add(stand2);
    const pitch = new THREE.Mesh(new THREE.CircleGeometry(S.r - 5.2, 36), mat('#2f8f3c')); pitch.rotation.x = -Math.PI / 2; pitch.position.y = 0.05; grp.add(pitch);
    const cv = document.createElement('canvas'); cv.width = cv.height = 256; const c = cv.getContext('2d');
    for (let i = 0; i < 8; i++) { c.fillStyle = i % 2 ? '#2f8f3c' : '#3aa148'; c.fillRect(0, i * 32, 256, 32); }
    c.strokeStyle = '#fff'; c.lineWidth = 4; c.strokeRect(20, 20, 216, 216); c.beginPath(); c.arc(128, 128, 30, 0, 7); c.moveTo(20, 128); c.lineTo(236, 128); c.stroke();
    const pt = new THREE.CanvasTexture(cv); pt.colorSpace = THREE.SRGBColorSpace; pitch.material = new THREE.MeshLambertMaterial({ map: pt });
    for (const sz of [-1, 1]) { const goal = new THREE.Mesh(new THREE.BoxGeometry(3, 1.6, 0.15), glow('#ffffff')); goal.position.set(0, 0.9, sz * (S.r - 6.3)); grp.add(goal); }
    for (let i = 0; i < 4; i++) { const a = Math.PI / 4 + i * Math.PI / 2 + 0.2, x = Math.cos(a) * (S.r + 1), z = Math.sin(a) * (S.r + 1);
      if (Math.abs(a % (2 * Math.PI) - Math.PI * 1.5) < 0.6) continue;
      box(grp, 0.4, 11, 0.4, '#444', x, 5.5, z); box(grp, 2.4, 0.8, 0.5, '#fff', x, 11.2, z, glow('#fffbe0')); }
    // enseigne au-dessus de l'entrée (côté avenue, z négatif)
    box(grp, 8, 0.4, 0.4, '#2a2f3a', 0, 8.2, -S.r - 0.6); box(grp, 0.4, 8.2, 0.4, '#2a2f3a', -4, 4.1, -S.r - 0.6); box(grp, 0.4, 8.2, 0.4, '#2a2f3a', 4, 4.1, -S.r - 0.6);
    signPlane(grp, 8, 2, 0, 9.4, -S.r - 0.9, 'stadium', VENUES.stadium.name, VENUES.stadium.accent);
    // collisions : anneau de segments droits, avec la porte laissée libre côté nord (angle −π/2)
    const N = 20;
    for (let i = 0; i < N; i++) { const a = ((i + 0.5) / N) * Math.PI * 2; let d = Math.atan2(Math.sin(a + Math.PI / 2), Math.cos(a + Math.PI / 2)); if (Math.abs(d) < gap / 2 + 0.08) continue;
      const R = S.r + 0.3, len = (Math.PI * 2 * R) / N / 2 + 0.3;
      layout.rects.push(rect(S.x + Math.cos(a) * R, S.z + Math.sin(a) * R, len, 0.6, 7, a + Math.PI / 2)); }
  }
  function V_ACC(k) { return VENUES[k].accent; }

  // ── Fenêtres d'activités ──
  const css = `position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:45;width:min(92vw,420px);max-height:82vh;overflow:auto;padding:18px;border-radius:22px;color:#fff;font-family:system-ui,sans-serif;background:linear-gradient(135deg,rgba(255,255,255,.2),rgba(255,255,255,.07));border:1px solid rgba(255,255,255,.4);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);box-shadow:0 10px 40px rgba(0,0,0,.5)`;
  let panel = null;
  function close() { panel?.remove(); panel = null; }
  function openPanel(title, sub, nodes) {
    close(); panel = document.createElement('div'); panel.style.cssText = css;
    const h = document.createElement('div'); h.style.cssText = 'font:800 22px system-ui;margin-bottom:4px'; h.textContent = title;
    const s = document.createElement('div'); s.style.cssText = 'opacity:.85;margin-bottom:12px'; s.textContent = sub;
    const x = document.createElement('button'); x.textContent = '✕'; x.setAttribute('aria-label', 'Fermer'); x.style.cssText = 'position:absolute;top:10px;right:12px;background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.4);color:#fff;border-radius:12px;padding:6px 11px;font-size:16px'; x.onclick = close;
    panel.append(h, s, x, ...nodes); panelHost.append(panel);
  }
  const btn = (label, fn, primary) => { const b = document.createElement('button'); b.textContent = label; b.style.cssText = `display:block;width:100%;margin:8px 0;padding:13px;border-radius:14px;font:700 16px system-ui;border:1px solid rgba(255,255,255,.4);color:${primary ? '#1b1400' : '#fff'};background:${primary ? '#ffd23d' : 'rgba(255,255,255,.14)'}`; b.onclick = fn; return b; };
  const card = (t, d) => { const e = document.createElement('div'); e.style.cssText = 'margin:8px 0;padding:11px 13px;border-radius:14px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.22)'; const a = document.createElement('b'); a.textContent = t; const p = document.createElement('div'); p.style.cssText = 'opacity:.88;font-size:14px;margin-top:3px'; p.textContent = d; e.append(a, p); return e; };

  const ACT = {
    stadium: () => openPanel('🏟️ Stade JexCity', 'Mini-jeux Stickman à 1-4 joueurs sur le même écran.', [btn('Entrer dans l’Arène', () => { close(); actions.openArena?.(); }, true)]),
    cafe: () => openPanel('☕ Cafétéria', 'Choisissez votre pause : elle s’affiche au-dessus de votre personnage.', [
      ['☕ Prend un café', '🍰 Se régale d’un gâteau', '🥤 Boit une boisson fraîche', '🎶 Écoute de la musique', '💬 Discute avec des amis'].map((t) => btn(t, () => { actions.setMood?.(t.slice(0, 40)); actions.toast?.('Humeur mise à jour.'); close(); })),
      btn('Effacer mon humeur', () => { actions.setMood?.(''); close(); })].flat()),
    market: () => openPanel('🛒 Supermarché', 'Rayon mode : changez votre tenue (haut, pantalon, chaussures).', [
      btn('🎲 Tenue au hasard', () => { actions.randomOutfit?.(); actions.toast?.('Nouvelle tenue !'); }, true),
      btn('↩︎ Reprendre ma tenue d’avant', () => { actions.restoreOutfit?.(); actions.toast?.('Tenue rétablie.'); }),
      card('Astuce', 'La tenue est enregistrée et visible par les autres joueurs. Pour tout régler en détail : Réglages → Apparence.')]),
    museum: () => openPanel('🧠 Musée technologique', 'Quatre étapes qui ont changé le monde.', [
      card('1947 — Le transistor', 'Un minuscule interrupteur électronique : la base de tous les ordinateurs et téléphones.'),
      card('1989 — Le Web', 'Des pages reliées entre elles par des liens, accessibles depuis n’importe quel navigateur.'),
      card('2007 — Le smartphone', 'Un ordinateur dans la poche, avec écran tactile et connexion permanente.'),
      card('Années 2020 — L’IA générative', 'Des programmes capables d’écrire, de dessiner et de dialoguer.')]),
  };
  return {
    group: g, open: (k) => ACT[k]?.(), close,
    update(t) { for (const f of anim) f(t); },
  };
}
