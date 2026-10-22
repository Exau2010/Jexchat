// city-world.js — JexCity : construction de la scène (relief, canal, façades, ponts, bateaux, ciel, lumière).
// Tout est procédural : aucune ressource externe. Les bâtiments sont fusionnés en quelques maillages
// (peu d'appels de dessin) et les éléments répétés (lampadaires, arbres, cheminées) sont instanciés.
import * as THREE from 'three';
import * as G from './city-geo.js';
import { createTextureSet } from './city-textures.js';
import { buildAvenue } from './city-modern.js';

// ─── Constructeur de géométrie fusionnée ──────────────────────────────────────
class GB {
  constructor() { this.p = []; this.u = []; this.c = []; this.i = []; this.n = 0; this.col = new THREE.Color(); }
  quad(a, b, c, d, uv, color) {
    const k = this.n; this.col.set(color || '#ffffff');
    for (const v of [a, b, c, d]) this.p.push(v[0], v[1], v[2]);
    this.u.push(...uv);
    for (let j = 0; j < 4; j++) this.c.push(this.col.r, this.col.g, this.col.b);
    this.i.push(k, k + 1, k + 2, k, k + 2, k + 3); this.n += 4;
  }
  tri(a, b, c, uv, color) {
    const k = this.n; this.col.set(color || '#ffffff');
    for (const v of [a, b, c]) this.p.push(v[0], v[1], v[2]);
    this.u.push(...uv);
    for (let j = 0; j < 3; j++) this.c.push(this.col.r, this.col.g, this.col.b);
    this.i.push(k, k + 1, k + 2); this.n += 3;
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.n > 65000 ? new THREE.Uint32BufferAttribute(this.i, 1) : new THREE.Uint16BufferAttribute(this.i, 1));
    g.computeVertexNormals(); g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}

function rnd(seed) { return G.rng(seed); }

// ─── Eau (shader) : 6 ondes croisées (normales fines atténuées avec la distance), Fresnel de Schlick,
// reflet du ciel (même dégradé que le ciel), éclats du soleil, teinte turquoise selon l'angle de vue ───
const WATER_VS = `
#include <fog_pars_vertex>
varying vec3 vW;
void main(){
  vec4 wp = modelMatrix * vec4(position,1.0); vW = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const WATER_FS = `
uniform float uTime, uScale, uDay; uniform vec3 uDeep, uShallow, uTop, uHor, uSunDir, uSunCol;
varying vec3 vW;
#include <fog_pars_fragment>
vec2 wv(vec2 p, vec2 d, float k, float sp, float t){ return normalize(d) * cos(dot(p, normalize(d)) * k + t * sp) * k; }
void main(){
  vec2 p = vW.xz * uScale; float t = uTime;
  vec2 g = wv(p, vec2(1.0,0.3), 1.1, 1.0, t) * 0.060 + wv(p, vec2(-0.4,1.0), 1.9, 1.3, t) * 0.045
         + wv(p, vec2(0.8,-0.7), 3.1, 1.7, t) * 0.030 + wv(p, vec2(-0.9,-0.4), 4.7, 2.1, t) * 0.020
         + wv(p, vec2(0.2,0.95), 7.3, 2.6, t) * 0.012 + wv(p, vec2(-0.6,0.8), 11.0, 3.2, t) * 0.007;
  float dist = length(cameraPosition - vW);
  g *= 1.0 / (1.0 + dist * 0.012);
  vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
  vec3 V = normalize(cameraPosition - vW);
  float cv = max(dot(n, V), 0.0);
  float F = 0.02 + 0.98 * pow(1.0 - cv, 5.0);
  vec3 R = reflect(-V, n); R.y = abs(R.y);
  vec3 sky = mix(uHor, uTop, pow(R.y, 0.5)); sky = mix(sky, uHor, exp(-R.y * 7.0) * 0.4);
  vec3 sd = normalize(uSunDir); float s = max(dot(R, sd), 0.0);
  sky += uSunCol * (pow(s, 600.0) * 9.0 + pow(s, 70.0) * 0.45) * smoothstep(-0.05, 0.1, sd.y);
  vec3 body = mix(uDeep, uShallow, pow(cv, 1.4) * 0.75);
  vec3 col = mix(body, sky, F);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;
function waterMaterial(scale) {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 }, uScale: { value: scale }, uDay: { value: 1 }, uDeep: { value: new THREE.Color('#0b4a5c') }, uShallow: { value: new THREE.Color('#2fa39b') },
      uTop: { value: new THREE.Color('#4a90e2') }, uHor: { value: new THREE.Color('#bcd8f2') }, uSunDir: { value: new THREE.Vector3(0.5, 0.6, 0.3) }, uSunCol: { value: new THREE.Color('#fff1dc') },
    }]),
    vertexShader: WATER_VS, fragmentShader: WATER_FS, fog: true, side: THREE.DoubleSide,
  });
}

// ─── Ciel : dégradé, brume d'horizon, disque solaire, nuages (bruit fractal), étoiles la nuit ───
function makeSky(radius = 1200, forEnv = false) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTop: { value: new THREE.Color('#4a90e2') }, uHor: { value: new THREE.Color('#b4d6f5') }, uGround: { value: new THREE.Color('#556070') },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color('#fff') },
      uTime: { value: 0 }, uDay: { value: 1 }, uNight: { value: 0 }, uClouds: { value: forEnv ? 0 : 1 },
    },
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 uTop,uHor,uGround,uSunCol,uSunDir; uniform float uTime,uDay,uNight,uClouds; varying vec3 vD;
      float hs(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(hs(i),hs(i+vec2(1,0)),f.x), mix(hs(i+vec2(0,1)),hs(i+vec2(1,1)),f.x), f.y); }
      float fbm(vec2 p){ float a=0.5, s=0.0; for(int i=0;i<5;i++){ s+=a*vn(p); p=p*2.03+vec2(7.1,3.7); a*=0.5; } return s; }
      void main(){ vec3 d = normalize(vD); float h = d.y;
        vec3 col = mix(uHor, uTop, pow(max(h,0.0),0.5));
        col = mix(col, uHor, exp(-max(h,0.0)*7.0)*0.4);
        vec3 sd = normalize(uSunDir); float s = max(dot(d, sd),0.0);
        float sunUp = smoothstep(-0.05, 0.1, sd.y);
        col += uSunCol * (pow(s,900.0)*9.0*sunUp + pow(s,48.0)*0.5 + pow(s,5.0)*0.1);
        if (uClouds > 0.5 && h > 0.0) {
          vec2 cp = d.xz / (h + 0.18) * 0.75 + vec2(uTime*0.004, uTime*0.0015);
          float c = fbm(cp * 1.4); float cov = smoothstep(0.5, 0.78, c) * smoothstep(0.0, 0.14, h);
          float dens = fbm(cp * 1.4 + sd.xz * 0.12);
          vec3 lit = mix(vec3(1.0), uSunCol, 0.45) * (0.55 + 0.6 * uDay);
          vec3 shade = mix(uHor, uTop, 0.5) * 0.6 + vec3(0.1) * uDay;
          vec3 cc = mix(lit, shade, clamp((c - dens) * 2.5 + 0.35, 0.0, 1.0) * 0.8);
          col = mix(col, cc, cov * 0.85);
        }
        if (h > 0.0 && uNight > 0.01) { vec3 q = floor(d * 220.0); float st = step(0.9975, hs(q.xz + q.y * 3.1)); col += vec3(st) * uNight * smoothstep(0.02, 0.25, h) * 0.9; }
        if (h < 0.0) col = mix(col, uGround, smoothstep(0.0, -0.3, h));
        gl_FragColor = vec4(col,1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide, depthWrite: false, fog: false,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(radius, forEnv ? 24 : 32, forEnv ? 14 : 18), mat);
  m.frustumCulled = false; m.renderOrder = -10; return m;
}

// Heure → ambiance (couleurs, intensités). Interpolation cyclique sur 24 h.
const KEYS = [
  [0, '#0a1030', '#1a2147', '#8fa4ff', 0.35, 0.35, 0.0012],
  [5.5, '#1d2a5a', '#5a4a6e', '#ff9c6e', 0.3, 0.4, 0.0013],
  [6.5, '#5f86c8', '#f2b595', '#ffb27a', 1.2, 0.6, 0.0013],
  [9, '#5f9ae6', '#bcd8f2', '#fff1dc', 2.4, 0.85, 0.0010],
  [13, '#4a90e2', '#b4d6f5', '#ffffff', 2.9, 1.0, 0.0009],
  [17, '#5f86d0', '#f1d3b4', '#ffe2b8', 2.3, 0.85, 0.0010],
  [18.5, '#6a6fb8', '#f4b79c', '#ff9f6a', 1.4, 0.65, 0.0012],
  [19.5, '#4a4a90', '#e49a9a', '#ff8a6a', 0.5, 0.5, 0.0013],
  [21, '#151c4a', '#3b3a6a', '#8fa4ff', 0.35, 0.35, 0.0013],
  [24, '#0a1030', '#1a2147', '#8fa4ff', 0.35, 0.35, 0.0012],
].map((k) => ({ h: k[0], top: new THREE.Color(k[1]), hor: new THREE.Color(k[2]), sun: new THREE.Color(k[3]), sunI: k[4], hemiI: k[5], fog: k[6] }));

// ─── Monde ────────────────────────────────────────────────────────────────────
export function createWorld({ scene, layout, tier, renderer }) {
  const root = new THREE.Group(); scene.add(root);
  const materials = [];
  const mk = (m) => { materials.push(m); return m; };
  const updaters = [];
  const pickables = []; // objets interrogés par le clic (sol et bâtiments)
  const landmarks = [];
  const S = tier.tex;

  // textures + matériaux : « mid » et « high » utilisent des matériaux physiques (relief, rugosité, reflets du ciel) ; « low » reste en Lambert.
  const full = tier.name !== 'low';
  const TX = createTextureSet(S, full);
  const stdMats = [];
  const surf = (set, extra = {}) => {
    const o = { map: set.map, vertexColors: true, side: THREE.DoubleSide, ...extra };
    if (full) Object.assign(o, { normalMap: set.normalMap, roughnessMap: set.roughnessMap, roughness: 1, metalness: 0, envMapIntensity: 0.8 });
    if (set.emissiveMap) Object.assign(o, { emissiveMap: set.emissiveMap, emissive: 0xffffff, emissiveIntensity: 0 });
    const m = mk(full ? new THREE.MeshStandardMaterial(o) : new THREE.MeshLambertMaterial(o)); if (full) stdMats.push(m); return m;
  };
  const plain = (o) => { const m = mk(full ? new THREE.MeshStandardMaterial({ roughness: 0.93, metalness: 0, envMapIntensity: 0.6, ...o }) : new THREE.MeshLambertMaterial(o)); if (full) stdMats.push(m); return m; };
  const stoneMat = plain({ vertexColors: true, side: THREE.DoubleSide });
  const terrainMat = surf(TX.terrain, { side: THREE.FrontSide });
  if (full) { terrainMat.roughnessMap = null; terrainMat.roughness = 0.96; }

  // ── Relief ──
  {
    const { size, seg } = G.TERRAIN, step = size / seg, o = -size / 2, n = seg + 1;
    const pos = new Float32Array(n * n * 3), col = new Float32Array(n * n * 3), uvs = new Float32Array(n * n * 2), c = new THREE.Color();
    for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) {
      const x = o + i * step, z = o + k * step, y = G.terrainHeight(x, z), q = (k * n + i) * 3;
      pos[q] = x; pos[q + 1] = y; pos[q + 2] = z; uvs[(k * n + i) * 2] = x / 7; uvs[(k * n + i) * 2 + 1] = z / 7;
      const nz = G.fbm(x * 0.05, z * 0.05, 3);
      if (y < -0.2) c.set('#566a62'); else if (y < 1.3) c.set('#b3a88a');
      else if (y < 38) c.set('#718f52').lerp(new THREE.Color('#8aa05a'), nz);
      else if (y < 85) c.set('#4f7040').lerp(new THREE.Color('#5d7a46'), nz);
      else if (y < 135) c.set('#8b8478').lerp(new THREE.Color('#7a746a'), nz);
      else c.set('#cfcac2');
      col[q] = c.r; col[q + 1] = c.g; col[q + 2] = c.b;
    }
    const idx = [];
    for (let k = 0; k < seg; k++) for (let i = 0; i < seg; i++) {
      const x0 = o + i * step, x1 = x0 + step, z0 = o + k * step, z1 = z0 + step;
      if (x0 >= G.TOWN.x0 && x1 <= G.TOWN.x1 && z0 >= G.TOWN.z0 && z1 <= G.TOWN.z1) continue; // trou de la ville
      const a = k * n + i, b = (k + 1) * n + i, cc = k * n + i + 1, d = (k + 1) * n + i + 1;
      idx.push(a, b, cc, cc, b, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    g.setIndex(idx); g.computeVertexNormals(); g.computeBoundingSphere();
    { // les pentes raides montrent la roche
      const nr = g.attributes.normal, rock = new THREE.Color('#857d70'), tmp = new THREE.Color();
      for (let i = 0; i < n * n; i++) {
        const t = 1 - G.smooth(0.62, 0.86, nr.getY(i)), y = pos[i * 3 + 1]; if (t <= 0 || y < 2) continue;
        tmp.setRGB(col[i * 3], col[i * 3 + 1], col[i * 3 + 2]).lerp(rock, t * 0.85); col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
      }
    }
    const mesh = new THREE.Mesh(g, terrainMat); mesh.receiveShadow = true; mesh.userData.pick = 'ground'; root.add(mesh); pickables.push(mesh); // le relief est praticable (clic = marche)
  }

  // ── Routes de campagne : rubans posés sur le relief (une géométrie par route, aucun calcul par image) ──
  {
    const W = 2.6, roadMat = plain({ color: '#77746c', side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    for (const r of G.ROADS) {
      const curve = new THREE.CatmullRomCurve3(r.pts.map(([x, z]) => new THREE.Vector3(x, 0, z)));
      const n = Math.ceil(curve.getLength() / 4), pts = curve.getSpacedPoints(n), pos = [], idx = [];
      for (let i = 0; i <= n; i++) {
        const p = pts[i], q = pts[Math.min(n, i + 1)], o = pts[Math.max(0, i - 1)];
        let tx = q.x - o.x, tz = q.z - o.z; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
        for (const sgn of [-1, 1]) { const x = p.x - tz * W * sgn, z = p.z + tx * W * sgn; pos.push(x, G.terrainHeight(x, z) + 0.14, z); }
        if (i < n) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); }
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
      const m = new THREE.Mesh(g, roadMat); m.receiveShadow = true; root.add(m);
      landmarks.push({ name: r.name, pos: new THREE.Vector3(r.pts[2][0], 0, r.pts[2][1]) });
    }
  }

  // ── Grande Avenue : chaussée, trottoirs, parcs, tours, enseignes, voitures (city-modern.js) ──
  const waterY = G.TOWN.waterY, QY = G.TOWN.quayY;
  const avenue = buildAvenue({ root, layout, tier, full, mk, stdMats, pickables, landmarks, renderer });
  const lakeW = waterMaterial(0.32), canalW = lakeW;
  { const lake = new THREE.Mesh(new THREE.PlaneGeometry(1500, 800).rotateX(-Math.PI / 2), lakeW); lake.position.set(0, waterY, G.TOWN.z1 + 400); root.add(lake); }

  // ── Château sur sa colline ──
  {
    const C = G.CHATEAU, y = G.terrainHeight(C.x, C.z);
    const g = new THREE.Group(); g.position.set(C.x, y - 0.5, C.z); root.add(g);
    const st = plain({ color: '#cbbfa9' }), sl = plain({ color: '#46515f' });
    const keep = new THREE.Mesh(new THREE.BoxGeometry(12, 17, 12), st); keep.position.y = 8.5; g.add(keep);
    const kr = new THREE.Mesh(new THREE.ConeGeometry(9, 7, 4).rotateY(Math.PI / 4), sl); kr.position.y = 20.5; g.add(kr);
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.5, 15, 12), st); t.position.set(sx * 15, 7.5, sz * 15); g.add(t);
      const r = new THREE.Mesh(new THREE.ConeGeometry(4, 6, 12), sl); r.position.set(sx * 15, 18, sz * 15); g.add(r);
    }
    for (const [x, z, w, d] of [[0, -15, 30, 1.6], [0, 15, 30, 1.6], [-15, 0, 1.6, 30], [15, 0, 1.6, 30]]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(w, 7, d), st); wall.position.set(x, 3.5, z); g.add(wall);
    }
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(24, 28, 6, 20), plain({ color: '#7f7a68' })); foot.position.y = -2; g.add(foot);
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    landmarks.push({ name: "Château d'Annecy", pos: new THREE.Vector3(C.x, y + 28, C.z) });
  }
  landmarks.push({ name: 'Le lac', pos: new THREE.Vector3(10, 6, 330) });

  // ── Lampadaires et arbres (instanciés) ──
  const lampHeadMat = mk(new THREE.MeshBasicMaterial({ color: '#cfc7b0' }));
  {
    const n = layout.lamps.length, d = new THREE.Object3D();
    const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.07, 0.11, 7.4, 6), plain({ color: '#2f3238' }), n);
    const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.36, 8, 6), lampHeadMat, n);
    layout.lamps.forEach((l, i) => {
      d.position.set(l.x, QY + 3.7, l.z); d.updateMatrix(); poles.setMatrixAt(i, d.matrix);
      d.position.set(l.x, QY + 7.5, l.z); d.updateMatrix(); heads.setMatrixAt(i, d.matrix);
    });
    root.add(poles, heads);
  }
  let treeCones, treeTrunks;
  {
    const T = layout.trees, n = T.length, d = new THREE.Object3D(), col = new THREE.Color(), R = rnd(5);
    treeCones = new THREE.InstancedMesh(new THREE.ConeGeometry(2.1, 7, 6), plain({ color: '#ffffff' }), n);
    treeTrunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.25, 0.35, 2, 5), plain({ color: '#5a4332' }), n);
    T.forEach((t, i) => {
      d.position.set(t.x, t.y + 1 + 3.5 * t.s, t.z); d.scale.set(t.s, t.s, t.s); d.rotation.y = R() * 6; d.updateMatrix(); treeCones.setMatrixAt(i, d.matrix);
      d.position.set(t.x, t.y + t.s, t.z); d.updateMatrix(); treeTrunks.setMatrixAt(i, d.matrix);
      col.set('#355a35').lerp(new THREE.Color('#4f7a3b'), R()); treeCones.setColorAt(i, col);
    });
    treeCones.castShadow = false; root.add(treeCones, treeTrunks);
  }

  // Modèles 3D réalistes (optionnels) : chargés après le premier affichage, jamais sur « low ». En cas d'échec, la ville reste identique.
  let models = null;
  if (tier.name !== 'low') setTimeout(() => {
    import('./city-models.js').then((m) => m.attachModels({ root, layout, treeCones, treeTrunks, tier, avenue })).then((r) => { models = r; }).catch((e) => console.warn('Modèles 3D ignorés :', e && e.message));
  }, 2500);

  // Décor roulant et pièces (city-props.js) : chargé à la demande par city-main.js une fois le joueur connu ; échec = ville inchangée.
  let props = null;
  function attachProps(o) {
    if (props) return;
    import('./city-props.js').then((m) => m.createProps({ scene, layout, tier, ...o })).then((r) => { props = r; }).catch((e) => console.warn('Décor roulant ignoré :', e && e.message));
  }

  // ── Bateaux ──
  const boats = []; // plus de bateaux : les publications circulent dans les airs (city-posts.js)
  const updateBoats = () => {};

  // ── Ciel et lumières ──
  const sky = makeSky(); root.add(sky);
  // Éclairage d'ambiance par image (IBL) : le ciel lui-même est filmé dans une petite carte d'environnement (niveaux mid/high).
  const pmrem = full && renderer ? new THREE.PMREMGenerator(renderer) : null;
  const envScene = new THREE.Scene(), envSky = makeSky(50, true); envScene.add(envSky);
  let envRT = null;
  function refreshEnv() {
    const rt = pmrem.fromScene(envScene, 0.03, 0.1, 100);
    if (envRT) envRT.dispose(); envRT = rt; scene.environment = rt.texture;
  }
  const sun = new THREE.DirectionalLight('#fff', 2.5); root.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight('#bcd8f2', '#6b5a48', 0.9); root.add(hemi);
  scene.fog = new THREE.FogExp2('#b4d6f5', 0.001);
  const tmpA = new THREE.Color(), tmpB = new THREE.Color();
  const sunDir = new THREE.Vector3();
  const state = { hour: 17.5, night: 0, elev: 1 };

  function setHour(h) {
    h = ((h % 24) + 24) % 24; state.hour = h;
    let k = 0; while (k < KEYS.length - 2 && h >= KEYS[k + 1].h) k++;
    const a = KEYS[k], b = KEYS[k + 1], t = (h - a.h) / (b.h - a.h);
    const top = tmpA.copy(a.top).lerp(b.top, t), hor = tmpB.copy(a.hor).lerp(b.hor, t);
    sky.material.uniforms.uTop.value.copy(top); sky.material.uniforms.uHor.value.copy(hor);
    const sc = a.sun.clone().lerp(b.sun, t), sunI = G.lerp(a.sunI, b.sunI, t), hemiI = G.lerp(a.hemiI, b.hemiI, t);
    scene.fog.color.copy(hor); scene.fog.density = G.lerp(a.fog, b.fog, t) * (tier.fogMul || 1);
    // trajectoire du soleil (jour de 13,5 h) ; la nuit, la lune prend le relais en sens inverse
    const ph = (((h - 6) % 24) + 24) % 24;
    const ang = ph <= 13.5 ? (ph / 13.5) * Math.PI : -((ph - 13.5) / 10.5) * Math.PI;
    sunDir.set(Math.cos(ang) * 0.85, Math.sin(ang) * 0.9 + 0.001, 0.35).normalize();
    const elev = Math.sin(ang); state.elev = elev;
    const dir = elev >= 0 ? sunDir.clone() : sunDir.clone().multiplyScalar(-1);
    sun.color.copy(sc); sun.intensity = sunI; hemi.intensity = hemiI * (full ? 0.45 : 1);
    hemi.color.copy(top).lerp(hor, 0.5); hemi.groundColor.set('#6b5a48').multiplyScalar(0.4 + 0.6 * Math.min(1, sunI / 2));
    sky.material.uniforms.uSunDir.value.copy(dir); sky.material.uniforms.uSunCol.value.copy(sc);
    for (const w of [canalW, lakeW]) {
      const u = w.uniforms, dayF = G.clamp(sunI / 2.5, 0.12, 1);
      u.uTop.value.copy(top); u.uHor.value.copy(hor); u.uDay.value = dayF; u.uSunDir.value.copy(dir); u.uSunCol.value.copy(sc).multiplyScalar(elev > 0 ? 1 : 0.15);
      u.uDeep.value.set('#0b4a5c').multiplyScalar(0.18 + 0.82 * dayF); u.uShallow.value.set('#2fa39b').multiplyScalar(0.18 + 0.82 * dayF);
    }
    const night = G.clamp(1 - (elev + 0.08) / 0.3, 0, 1); state.night = night;
    const dayF = G.clamp(sunI / 2.5, 0, 1);
    for (const sk of [sky, envSky]) {
      const u = sk.material.uniforms; u.uTop.value.copy(top); u.uHor.value.copy(hor); u.uSunDir.value.copy(dir); u.uSunCol.value.copy(sc);
      u.uGround.value.copy(hor).multiplyScalar(0.28 + 0.22 * dayF); u.uDay.value = dayF; u.uNight.value = night;
    }
    if (pmrem && (state.envHour == null || Math.abs(h - state.envHour) > 0.12)) { state.envHour = h; refreshEnv(); }
    for (const m of stdMats) m.envMapIntensity = 0.12 + 0.55 * dayF;
    avenue.setNight(night);
    lampHeadMat.color.set('#cfc7b0').lerp(tmpA.set('#ffd592'), night);
    state.dir = dir;
  }
  setHour(17.5);

  // L'ombre suit le joueur
  function followShadow(p) {
    sun.target.position.copy(p);
    sun.position.copy(p).addScaledVector(state.dir || sunDir, 110);
    sun.target.updateMatrixWorld();
  }
  function setTier(t) {
    tier = t;
    sun.castShadow = !!t.shadows;
    if (t.shadows) {
      const sh = sun.shadow; if (sh.mapSize.x !== t.shadows) { sh.mapSize.set(t.shadows, t.shadows); if (sh.map) { sh.map.dispose(); sh.map = null; } }
      const e = t.shadows >= 2048 ? 90 : 65; Object.assign(sh.camera, { left: -e, right: e, top: e, bottom: -e, near: 10, far: 260 }); sh.camera.updateProjectionMatrix(); sh.bias = -0.0006; sh.normalBias = 0.4;
    }
    const nT = Math.min(t.trees, layout.trees.length); treeCones.count = nT; treeTrunks.count = nT;
    scene.fog.density = scene.fog.density; for (const m of materials) m.needsUpdate = true;
    if (models) models.setTier(t);
    if (props) props.setTier(t);
  }
  setTier(tier); setHour(17.5);

  function update(t, dt, camPos) {
    canalW.uniforms.uTime.value = t; lakeW.uniforms.uTime.value = t; sky.material.uniforms.uTime.value = t;
    updateBoats(t); avenue.update(t, dt);
    sky.position.copy(camPos);
    if (models) models.update(camPos);
    if (props) props.update(dt, t, camPos);
  }

  return { root, update, setHour, setTier, followShadow, landmarks, pickables, state, boats, attachProps };
}
