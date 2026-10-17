// city-world.js — JexCity : construction de la scène (relief, canal, façades, ponts, bateaux, ciel, lumière).
// Tout est procédural : aucune ressource externe. Les bâtiments sont fusionnés en quelques maillages
// (peu d'appels de dessin) et les éléments répétés (lampadaires, arbres, cheminées) sont instanciés.
import * as THREE from 'three';
import * as G from './city-geo.js';
import { createTextureSet } from './city-textures.js';

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
  const wallMat = surf(TX.facade), groundMat = surf(TX.ground), roofMat = surf(TX.roof), quayMat = surf(TX.cobble);
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
    const mesh = new THREE.Mesh(g, terrainMat); mesh.receiveShadow = true; root.add(mesh);
  }

  // ── Sol de la ville (quais pavés), murs du canal, pont, embarcadère ──
  const waterY = G.TOWN.waterY, QY = G.TOWN.quayY;
  const quay = new GB(), stone = new GB();
  {
    for (const side of [-1, 1]) {
      for (let z = G.TOWN.z0; z < G.TOWN.z1; z += 4) {
        const z2 = Math.min(z + 4, G.TOWN.z1);
        const f1 = G.frame(z), f2 = G.frame(z2), h1 = G.halfW(z), h2 = G.halfW(z2);
        const i1 = [f1.p[0] + f1.n[0] * side * h1, QY, z + f1.n[1] * side * h1], i2 = [f2.p[0] + f2.n[0] * side * h2, QY, z2 + f2.n[1] * side * h2];
        const o1 = [side * G.TOWN.x1, QY, z], o2 = [side * G.TOWN.x1, QY, z2];
        quay.quad(o1, i1, i2, o2, [o1[0] / 3, o1[2] / 3, i1[0] / 3, i1[2] / 3, i2[0] / 3, i2[2] / 3, o2[0] / 3, o2[2] / 3], '#ffffff');
        // mur du quai côté canal
        const b1 = [i1[0], waterY - 0.8, i1[2]], b2 = [i2[0], waterY - 0.8, i2[2]];
        stone.quad(i1, i2, b2, b1, [0, 0, 1, 0, 1, 1, 0, 1], '#9d958a');
      }
      // talus sud (embouchure sur le lac)
      const zE = G.TOWN.z1, fE = G.frame(zE), hE = G.halfW(zE);
      const iE = [fE.p[0] + fE.n[0] * side * hE, zE + fE.n[1] * side * hE];
      stone.quad([iE[0], QY, iE[1]], [side * G.TOWN.x1, QY, zE], [side * G.TOWN.x1, -3.6, zE], [iE[0], -3.6, iE[1]], [0, 0, 1, 0, 1, 1, 0, 1], '#8f877b');
    }
    // fond du canal au nord
    const fN = G.frame(G.TOWN.z0), hN = G.halfW(G.TOWN.z0);
    stone.quad([fN.p[0] - hN, QY, G.TOWN.z0], [fN.p[0] + hN, QY, G.TOWN.z0], [fN.p[0] + hN, waterY - 0.8, G.TOWN.z0], [fN.p[0] - hN, waterY - 0.8, G.TOWN.z0], [0, 0, 1, 0, 1, 1, 0, 1], '#9d958a');
    // ponts
    for (const b of G.BRIDGES) {
      const z = b.z, f = G.frame(z), hw = G.bridgeSpan(z), N = 14, th = 0.5, par = 0.95;
      const P = (a, zz, y) => [f.p[0] + f.n[0] * a + f.t[0] * zz, y, z + f.n[1] * a + f.t[1] * zz];
      for (let k = 0; k < N; k++) {
        const a1 = -hw + (2 * hw * k) / N, a2 = -hw + (2 * hw * (k + 1)) / N;
        const y1 = QY + 1.1 * (1 - (a1 / hw) ** 2), y2 = QY + 1.1 * (1 - (a2 / hw) ** 2);
        quay.quad(P(a1, -3, y1), P(a2, -3, y2), P(a2, 3, y2), P(a1, 3, y1), [a1 / 3, -1, a2 / 3, -1, a2 / 3, 1, a1 / 3, 1], '#ffffff');
        for (const s of [-3, 3]) { // façade + parapet
          stone.quad(P(a1, s, y1 - th), P(a2, s, y2 - th), P(a2, s, y2 + par), P(a1, s, y1 + par), [0, 0, 1, 0, 1, 1, 0, 1], '#bdb4a4');
          stone.quad(P(a1, s - Math.sign(s) * 0.0, y1 + par), P(a2, s, y2 + par), P(a2, s - Math.sign(s) * 0.5, y2 + par), P(a1, s - Math.sign(s) * 0.5, y1 + par), [0, 0, 1, 0, 1, 1, 0, 1], '#cfc7b8');
        }
        stone.quad(P(a1, -3, y1 - th), P(a2, -3, y2 - th), P(a2, 3, y2 - th), P(a1, 3, y1 - th), [0, 0, 1, 0, 1, 1, 0, 1], '#8a8277');
      }
    }
  }
  const quayMesh = new THREE.Mesh(quay.build(), quayMat); quayMesh.receiveShadow = true; quayMesh.userData.pick = 'ground'; root.add(quayMesh); pickables.push(quayMesh);
  const stoneMesh = new THREE.Mesh(stone.build(), stoneMat); stoneMesh.receiveShadow = true; stoneMesh.castShadow = true; root.add(stoneMesh);

  // ── Eau : canal et lac ──
  const canalW = waterMaterial(1.0), lakeW = waterMaterial(0.32);
  {
    const pos = [], idx = []; let k = 0;
    for (let z = G.TOWN.z0; z <= G.TOWN.z1 + 0.01; z += 3) {
      const zz = Math.min(z, G.TOWN.z1), f = G.frame(zz), h = G.halfW(zz);
      pos.push(f.p[0] - f.n[0] * h, waterY, zz - f.n[1] * h, f.p[0] + f.n[0] * h, waterY, zz + f.n[1] * h);
      if (k > 0) idx.push((k - 1) * 2, k * 2, (k - 1) * 2 + 1, (k - 1) * 2 + 1, k * 2, k * 2 + 1);
      k++;
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeBoundingSphere();
    root.add(new THREE.Mesh(g, canalW));
    const lake = new THREE.Mesh(new THREE.PlaneGeometry(1500, 800).rotateX(-Math.PI / 2), lakeW); lake.position.set(0, waterY, G.TOWN.z1 + 400); root.add(lake);
  }

  // ── Bâtiments ──
  const gW = new GB(), gG = new GB(), gR = new GB();
  const chim = [];
  for (const b of layout.buildings) {
    const c = [b.cx, b.cz], ax = b.ax, az = b.az, hx = b.hx, hz = b.hz;
    const corner = (sx, sz) => [c[0] + ax[0] * hx * sx + az[0] * hz * sz, c[1] + ax[1] * hx * sx + az[1] * hz * sz];
    const cs = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
    const y0 = b.y0, yg = y0 + 3.6, yt = b.top;
    const nUp = b.floors - 1;
    for (let s = 0; s < 4; s++) {
      const p0 = cs[s], p1 = cs[(s + 1) % 4], len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
      const u0 = b.uOff, u1 = u0 + len / 16;
      gG.quad([p0[0], y0, p0[1]], [p1[0], y0, p1[1]], [p1[0], yg, p1[1]], [p0[0], yg, p0[1]], [u0, 0, u1, 0, u1, 1, u0, 1], b.color);
      if (nUp > 0) {
        const v0 = b.vOff, v1 = v0 + nUp / 4;
        gW.quad([p0[0], yg, p0[1]], [p1[0], yg, p1[1]], [p1[0], yt, p1[1]], [p0[0], yt, p0[1]], [u0, v0, u1, v0, u1, v1, u0, v1], b.color);
      }
    }
    // toit à deux pans (faîtage le long du grand côté)
    const ov = 0.45, ph = b.ph, rT = yt + ph, eaveY = yt - 0.15;
    const along = b.ridgeAlongZ ? az : ax, across = b.ridgeAlongZ ? ax : az;
    const hA = b.ridgeAlongZ ? hz : hx, hC = b.ridgeAlongZ ? hx : hz;
    const pt = (sa, sc, y) => [c[0] + along[0] * (hA + ov) * sa + across[0] * (hC + ov) * sc, y, c[1] + along[1] * (hA + ov) * sa + across[1] * (hC + ov) * sc];
    const ridge = (sa) => [c[0] + along[0] * (hA + ov) * sa, rT, c[1] + along[1] * (hA + ov) * sa];
    const lenA = (hA + ov) * 2, slope = Math.hypot(hC + ov, ph);
    for (const sc of [-1, 1]) {
      gR.quad(pt(-1, sc, eaveY), pt(1, sc, eaveY), ridge(1), ridge(-1), [0, 0, lenA / 2, 0, lenA / 2, slope / 2, 0, slope / 2], b.roofColor);
    }
    // pignons
    for (const sa of [-1, 1]) {
      const a = [c[0] + along[0] * hA * sa + across[0] * hC, yt, c[1] + along[1] * hA * sa + across[1] * hC];
      const bb = [c[0] + along[0] * hA * sa - across[0] * hC, yt, c[1] + along[1] * hA * sa - across[1] * hC];
      const r = [c[0] + along[0] * hA * sa, rT, c[1] + along[1] * hA * sa];
      gW.tri(a, bb, r, [0.005, 0.4, 0.005, 0.4, 0.005, 0.4], b.color);
    }
    if (b.chimney) chim.push({ x: c[0] + along[0] * hA * 0.5, z: c[1] + along[1] * hA * 0.5, y: rT + 0.2, rot: Math.atan2(az[0], az[1]) });
  }
  const wallMesh = new THREE.Mesh(gW.build(), wallMat), groundMesh = new THREE.Mesh(gG.build(), groundMat), roofMesh = new THREE.Mesh(gR.build(), roofMat);
  for (const m of [wallMesh, groundMesh, roofMesh]) { m.castShadow = true; m.receiveShadow = true; m.userData.pick = 'building'; root.add(m); pickables.push(m); }
  if (chim.length) {
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(0.6, 1.6, 0.6), plain({ color: '#8a6a5a' }), chim.length);
    const d = new THREE.Object3D();
    chim.forEach((q, i) => { d.position.set(q.x, q.y, q.z); d.rotation.set(0, q.rot, 0); d.updateMatrix(); im.setMatrixAt(i, d.matrix); });
    im.castShadow = true; root.add(im);
  }

  // ── Palais de l'Île : île en forme de proue sur le canal ──
  {
    const zc = G.ISLAND.z, f = G.frame(zc);
    const shape = new THREE.Shape(); // x = travers, y = -longueur (après rotation, +z = sud)
    [[0, -15], [2.8, -6], [3, 4], [2.2, 12], [0, 15], [-2.2, 12], [-3, 4], [-2.8, -6]].forEach(([x, l], i) => (i ? shape.lineTo(x, -l) : shape.moveTo(x, -l)));
    const base = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: QY - waterY + 0.8, bevelEnabled: false }).rotateX(-Math.PI / 2), plain({ color: '#a79e90' }));
    base.position.set(f.p[0], waterY - 0.8, zc); base.rotation.y = Math.atan2(f.t[0], f.t[1]); base.castShadow = base.receiveShadow = true; root.add(base);
    const g = new THREE.Group(); g.position.set(f.p[0], QY, zc); g.rotation.y = Math.atan2(f.t[0], f.t[1]); root.add(g);
    const stoneM = plain({ color: '#cfc5b3' }), slate = plain({ color: '#4b5563' }), dark = plain({ color: '#3b4250' });
    const body = new THREE.Mesh(new THREE.BoxGeometry(4.4, 11, 11), stoneM); body.position.set(0, 5.5, -1); g.add(body);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(4.2, 4.5, 4).rotateY(Math.PI / 4).scale(1.1, 1, 1.35), slate); roof.position.set(0, 13.2, -1); g.add(roof);
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 2.1, 16, 12), stoneM); tower.position.set(0, 8, 9.5); g.add(tower);
    const tr = new THREE.Mesh(new THREE.ConeGeometry(2.5, 5, 12), slate); tr.position.set(0, 18.5, 9.5); g.add(tr);
    const t2 = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.4, 12, 10), stoneM); t2.position.set(0, 6, -9); g.add(t2);
    const tr2 = new THREE.Mesh(new THREE.ConeGeometry(1.8, 4, 10), slate); tr2.position.set(0, 14, -9); g.add(tr2);
    for (let i = 0; i < 6; i++) { const w = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.3, 0.7), dark); w.position.set(2.23, 3 + (i % 3) * 2.8, -4 + Math.floor(i / 3) * 6); g.add(w); const w2 = w.clone(); w2.position.x = -2.23; g.add(w2); }
    g.traverse((o) => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; } });
    landmarks.push({ name: "Palais de l'Île", pos: new THREE.Vector3(f.p[0], QY + 21, zc + 9.5) });
  }

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
    const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.09, 3.3, 6), plain({ color: '#2f3238' }), n);
    const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.24, 8, 6), lampHeadMat, n);
    layout.lamps.forEach((l, i) => {
      d.position.set(l.x, QY + 1.65, l.z); d.updateMatrix(); poles.setMatrixAt(i, d.matrix);
      d.position.set(l.x, QY + 3.45, l.z); d.updateMatrix(); heads.setMatrixAt(i, d.matrix);
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

  // ── Bateaux ──
  const boats = [];
  function hull(len, wid, color) {
    const sh = new THREE.Shape();
    [[-0.55, -2.4], [0.55, -2.4], [0.95, -0.8], [0.95, 0.9], [0.45, 2.0], [0, 2.6], [-0.45, 2.0], [-0.95, 0.9], [-0.95, -0.8]].forEach(([x, l], i) => (i ? sh.lineTo(x * wid, -l * len) : sh.moveTo(x * wid, -l * len)));
    const m = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: 0.7, bevelEnabled: false }).rotateX(-Math.PI / 2), plain({ color }));
    m.position.y = -0.25; m.castShadow = true; return m;
  }
  const boatColors = ['#2f6f9f', '#b4483b', '#e8e1d0', '#3f7a5a'];
  for (let i = 0; i < 4; i++) {
    const g = new THREE.Group(); g.userData.boat = true;
    g.add(hull(1, 1, boatColors[i]));
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.8, 2.0), plain({ color: '#f3efe6' })); cab.position.set(0, 0.85, -0.4); cab.castShadow = true; g.add(cab);
    const rf = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.12, 2.3), plain({ color: boatColors[(i + 2) % 4] })); rf.position.set(0, 1.3, -0.4); g.add(rf);
    root.add(g); boats.push({ g, kind: 'canal', phase: i * 1.7 + 0.4, side: 1 });
  }
  for (let i = 0; i < 3; i++) {
    const g = new THREE.Group(); g.userData.boat = true;
    g.add(hull(1.15, 1.1, ['#f0ece0', '#27496d', '#a63d40'][i]));
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 6.2, 6), plain({ color: '#d9d4c7' })); mast.position.set(0, 3.1, 0.3); g.add(mast);
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute([0, 1.0, -1.9, 0, 1.0, 1.2, 0, 6.0, 0.15], 3)); sg.setIndex([0, 1, 2]); sg.computeVertexNormals();
    const sail = new THREE.Mesh(sg, plain({ color: '#fbf8f0', side: THREE.DoubleSide })); sail.castShadow = true; g.add(sail);
    root.add(g); boats.push({ g, kind: 'lake', phase: i * 2.2, rx: 110 + i * 30, rz: 55 + i * 18, speed: 0.045 - i * 0.008 });
  }
  const A = (150 - -215) / 2, ZC = (150 + -215) / 2, W = 1.8 / A;
  const laneAt = (z) => lerpLane(z);
  function lerpLane(z) { const bump = Math.exp(-(((z - G.ISLAND.z) / 22) ** 2)); return 1.4 + bump * (((3 + G.halfW(z)) / 2) - 1.4); }
  function boatPos(b, t) {
    const a = W * t + b.phase, z = ZC + A * Math.sin(a), lat = b.side * laneAt(z) * Math.max(-1, Math.min(1, 3 * Math.cos(a)));
    const f = G.frame(z); return [f.p[0] + f.n[0] * lat, z + f.n[1] * lat];
  }
  function updateBoats(t0) {
    for (const b of boats) {
      // Pause individuelle : le temps propre du bateau (t) ne s'écoule plus tant que b.paused est vrai.
      const dtb = t0 - (b._t ?? t0); b._t = t0;
      if (b.paused) { b.lag = (b.lag || 0) + dtb; continue; }
      const t = t0 - (b.lag || 0);
      let x, z, x2, z2;
      if (b.kind === 'canal') { [x, z] = boatPos(b, t); [x2, z2] = boatPos(b, t + 0.6); }
      else { const a = b.speed * t + b.phase, e = (aa) => [-30 + Math.cos(aa) * b.rx, 330 + Math.sin(aa) * b.rz]; [x, z] = e(a); [x2, z2] = e(a + 0.02); }
      b.g.position.set(x, 0.02 * Math.sin(t * 1.3 + b.phase), z);
      b.g.rotation.y = Math.atan2(x2 - x, z2 - z); b.g.rotation.z = 0.03 * Math.sin(t * 1.1 + b.phase);
    }
  }

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
    wallMat.emissiveIntensity = groundMat.emissiveIntensity = night * 1.15;
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
  }
  setTier(tier); setHour(17.5);

  function update(t, dt, camPos) {
    canalW.uniforms.uTime.value = t; lakeW.uniforms.uTime.value = t; sky.material.uniforms.uTime.value = t;
    updateBoats(t);
    sky.position.copy(camPos);
  }

  return { root, update, setHour, setTier, followShadow, landmarks, pickables, state, boats };
}
