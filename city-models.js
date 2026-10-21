// JexCity — modèles 3D optionnels : arbres réalistes (LOD) et herbe autour du joueur.
// Chargé À LA DEMANDE, après le premier affichage, et seulement sur les niveaux « mid » et « high ».
// Toute erreur laisse la ville intacte (arbres simples d'origine). Aucune requête réseau, aucune écriture en base.
import * as THREE from 'three';
import { GLTFLoader } from './GLTFLoader.js';
import * as G from './city-geo.js';

const CFG = {
  mid:  { trees: 8,  treeR: 55, grassR: 14, cell: 1.9, cap: 260 },
  high: { trees: 20, treeR: 85, grassR: 24, cell: 1.5, cap: 520 },
};
// Touffes de l'atlas herbe.webp : [x, y, largeur, hauteur, rapport l/h] en coordonnées UV (haut-gauche).
const TUFTS = [[0,0,.1074,.2549,.421],[.1113,0,.1201,.1807,.665],[.2354,0,.2402,.1201,2],[.4795,0,.2402,.1201,2],[.7236,0,.1631,.1709,.954],[0,.2588,.1455,.2061,.706],[.1494,.2588,.125,.1143,1.094],[.2783,.2588,.166,.124,1.339]];
const hash = (a, b) => { let h = (a * 374761393 + b * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

export async function attachModels({ root, layout, treeCones, treeTrunks, tier }) {
  const nav = typeof navigator !== 'undefined' ? navigator : {};
  const c = nav.connection || {};
  if (c.saveData || /(^|-)2g|3g/.test(c.effectiveType || '') || (nav.deviceMemory && nav.deviceMemory <= 2)) return null; // appareil ou réseau modeste : on garde la version légère
  if (!CFG[tier.name]) return null; // le niveau a été abaissé entre-temps
  const gltf = await new GLTFLoader().loadAsync('/city-assets/arbre.glb');
  const parts = [];
  gltf.scene.traverse((o) => { if (o.isMesh) parts.push(o); });
  if (!parts.length) return null;

  // ── Arbres : seuls les K plus proches utilisent le vrai modèle, les autres gardent le cône ──
  const T = layout.trees, maxK = CFG.high.trees;
  const inst = parts.map((p) => { const m = new THREE.InstancedMesh(p.geometry, p.material, maxK); m.frustumCulled = false; m.count = 0; m.receiveShadow = true; root.add(m); return m; });
  const coneArr = treeCones.instanceMatrix.array, trunkArr = treeTrunks.instanceMatrix.array;
  const coneOrig = coneArr.slice(), trunkOrig = trunkArr.slice();
  let hidden = [], cfg = null, lastX = 1e9, lastZ = 1e9, grass = null, gx = 1e9, gz = 1e9, active = true;
  const d = new THREE.Object3D(), pick = [];

  const hide = (i) => { for (const [arr, o] of [[coneArr, coneOrig], [trunkArr, trunkOrig]]) { for (let k = 0; k < 12; k++) arr[i * 16 + k] = 0; arr[i * 16 + 12] = o[i * 16 + 12]; arr[i * 16 + 13] = o[i * 16 + 13]; arr[i * 16 + 14] = o[i * 16 + 14]; arr[i * 16 + 15] = 1; } };
  const show = (i) => { for (const [arr, o] of [[coneArr, coneOrig], [trunkArr, trunkOrig]]) for (let k = 0; k < 16; k++) arr[i * 16 + k] = o[i * 16 + k]; };
  function refreshTrees(x, z) {
    lastX = x; lastZ = z;
    for (const i of hidden) show(i); hidden = [];
    let n = 0;
    if (active && cfg) {
      const lim = Math.min(cfg.trees, maxK), R2 = cfg.treeR * cfg.treeR, cnt = Math.min(T.length, treeCones.count);
      pick.length = 0;
      for (let i = 0; i < cnt; i++) {
        const dx = T[i].x - x, dz = T[i].z - z, q = dx * dx + dz * dz; if (q > R2) continue;
        let p = pick.length; if (p >= lim && q >= pick[p - 1][0]) continue;
        if (p < lim) pick.push([q, i]); else pick[p - 1] = [q, i];
        p = pick.length - 1; while (p > 0 && pick[p - 1][0] > pick[p][0]) { const t = pick[p]; pick[p] = pick[p - 1]; pick[p - 1] = t; p--; }
      }
      for (const [, i] of pick) {
        const t = T[i]; d.position.set(t.x, t.y, t.z); d.scale.set(t.s * 0.8, t.s, t.s * 0.8); d.rotation.set(0, hash(i, 7) * 6.283, 0); d.updateMatrix();
        for (const m of inst) m.setMatrixAt(n, d.matrix);
        hide(i); hidden.push(i); n++;
      }
    }
    for (const m of inst) { m.count = n; m.instanceMatrix.needsUpdate = true; }
    treeCones.instanceMatrix.needsUpdate = true; treeTrunks.instanceMatrix.needsUpdate = true;
  }

  // ── Herbe : cartes croisées instanciées autour du joueur, régénérées par pas de quelques mètres ──
  async function buildGrass() {
    const tex = await new THREE.TextureLoader().loadAsync('/city-assets/herbe.webp');
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 2;
    const mat = new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.45, side: THREE.DoubleSide });
    const meshes = TUFTS.map(([u, v, w, h]) => {
      const g = new THREE.BufferGeometry(), P = [], U = [], I = [];
      for (let k = 0; k < 2; k++) { const a = k * Math.PI / 2, cx = Math.cos(a) * 0.5, cz = Math.sin(a) * 0.5, b = P.length / 3;
        P.push(-cx, 0, -cz, cx, 0, cz, cx, 1, cz, -cx, 1, -cz); U.push(u, 1 - (v + h), u + w, 1 - (v + h), u + w, 1 - v, u, 1 - v); I.push(b, b + 1, b + 2, b, b + 2, b + 3); }
      g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); g.setIndex(I);
      g.setAttribute('normal', new THREE.Float32BufferAttribute(P.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
      const m = new THREE.InstancedMesh(g, mat, CFG.high.cap); m.count = 0; m.frustumCulled = false; root.add(m); return m;
    });
    return { meshes, mat, tex };
  }
  const roadNear = (x, z) => { for (const r of G.ROADS) for (let i = 0; i + 1 < r.pts.length; i++) { const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1], vx = bx - ax, vz = bz - az; const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz))); if (Math.hypot(x - ax - vx * t, z - az - vz * t) < 7) return true; } return false; };
  function refreshGrass(x, z) {
    gx = x; gz = z; if (!grass) return;
    const counts = new Array(TUFTS.length).fill(0);
    if (active && cfg) {
      const cs = cfg.cell, R = cfg.grassR, i0 = Math.floor((x - R) / cs), i1 = Math.floor((x + R) / cs), k0 = Math.floor((z - R) / cs), k1 = Math.floor((z + R) / cs), cap = Math.min(cfg.cap, CFG.high.cap);
      for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) {
        const h = hash(i, k); if (h < 0.3) continue;
        const px = (i + hash(i, k + 91)) * cs, pz = (k + hash(i + 57, k)) * cs;
        if ((px - x) ** 2 + (pz - z) ** 2 > R * R) continue;
        if (G.inTown(px, pz) || !G.inWorld(px, pz)) continue;
        const y = G.terrainHeight(px, pz); if (y < 1.6 || y > 40) continue;
        if (G.slopeAt(px, pz) > 0.5 || roadNear(px, pz)) continue;
        const ti = Math.floor(hash(i + 3, k + 5) * TUFTS.length), m = grass.meshes[ti]; if (counts[ti] >= cap) continue;
        const asp = TUFTS[ti][4], hgt = 0.45 + hash(i, k + 13) * 0.45, wid = Math.min(1.4, hgt * asp * 1.4);
        d.position.set(px, y - 0.04, pz); d.rotation.set(0, hash(i + 9, k) * 6.283, 0); d.scale.set(wid, hgt, wid); d.updateMatrix();
        m.setMatrixAt(counts[ti]++, d.matrix);
      }
    }
    grass.meshes.forEach((m, i) => { m.count = counts[i]; m.instanceMatrix.needsUpdate = true; });
  }

  function setTier(t) { cfg = CFG[t.name] || null; active = !!cfg; lastX = gx = 1e9; }
  // seule l'écorce projette une ombre (et seulement en « high ») : les feuilles coûtent trop cher dans la passe d'ombre
  let barkIdx = parts.findIndex((p) => /bark/i.test(p.name) || /bark/i.test(p.material.name || '')); if (barkIdx < 0) barkIdx = parts.length - 1;
  parts.forEach((p) => { if (/leaf|leaves/i.test(p.name) || /leaf|leaves/i.test(p.material.name || '')) { p.material.alphaTest = 0.45; p.material.transparent = false; p.material.depthWrite = true; p.material.side = THREE.DoubleSide; } });
  const applyTier = (t) => { setTier(t); inst.forEach((m, i) => { m.castShadow = t.name === 'high' && i === barkIdx; }); };
  applyTier(tier);
  buildGrass().then((g) => { grass = g; gx = 1e9; }).catch((e) => console.warn('herbe indisponible', e));

  return {
    setTier: applyTier,
    update(cam) {
      if (!active) { if (hidden.length || (grass && grass.meshes[0].count)) { refreshTrees(cam.x, cam.z); refreshGrass(cam.x, cam.z); } return; }
      if ((cam.x - lastX) ** 2 + (cam.z - lastZ) ** 2 > 16) refreshTrees(cam.x, cam.z);
      if ((cam.x - gx) ** 2 + (cam.z - gz) ** 2 > 25) refreshGrass(cam.x, cam.z);
    },
  };
}
