// city-posts.js — JexCity : les publications s'affichent sur de grands écrans LED accrochés aux tours (avec bandeau défilant,
// comme à Times Square) et sur des cartes lumineuses qui volent au-dessus de la Grande Avenue en circulant autour du joueur.
// Les publications viennent de /api/posts (mêmes données et mêmes autorisations que le fil JexChat) ; rien n'est copié.
// Toucher un écran ou une carte ouvre la publication. Légèreté : la texture d'un écran n'est dessinée que lorsqu'on s'en approche
// (au plus une par image) et libérée à distance ; les cartes volantes restent toujours proches du joueur et se tournent vers la caméra.
import * as THREE from 'three';
import * as G from './city-geo.js';
import { postText, safeHttps } from './city-api.js';
import { parseVideo } from './city-media.js';

const hitMat = new THREE.MeshBasicMaterial({ visible: false });
const FONT = 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
const FLY = 18;

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
const sRGB = (t) => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };

// ── Médias réels des publications (photo, aperçu vidéo) : chargés à la demande, mis en cache (24 max), jamais bloquants ──
// crossOrigin « anonymous » : indispensable pour qu'une image distante puisse servir de texture WebGL ; si l'hébergeur ne l'autorise pas,
// la carte garde simplement son rendu texte (aucune erreur visible).
const mediaCache = new Map();
function loadMedia(post) {
  const url = safeHttps(post.mediaUrl || post.sharedFrom?.mediaUrl), mt = post.mediaType !== 'none' ? post.mediaType : post.sharedFrom?.mediaType;
  if (!url || (mt !== 'image' && mt !== 'video')) return Promise.resolve(null);
  if (mediaCache.has(url)) return mediaCache.get(url);
  const pr = new Promise((res) => {
    const done = (v) => res(v), to = setTimeout(() => done(null), 12000);
    if (mt === 'image') {
      const im = new Image(); im.crossOrigin = 'anonymous'; im.decoding = 'async'; im.referrerPolicy = 'no-referrer';
      im.onload = () => { clearTimeout(to); done(im); }; im.onerror = () => { clearTimeout(to); done(null); }; im.src = url; return;
    }
    const info = parseVideo(url);
    if (info.type === 'youtube' || info.type === 'vimeo') { // aperçu officiel (YouTube) ; Vimeo : pas d'aperçu sans API
      if (!info.thumb) { clearTimeout(to); return done(null); }
      const im = new Image(); im.crossOrigin = 'anonymous'; im.referrerPolicy = 'no-referrer';
      im.onload = () => { clearTimeout(to); done(im); }; im.onerror = () => { clearTimeout(to); done(null); }; im.src = info.thumb; return;
    }
    const v = document.createElement('video'); v.crossOrigin = 'anonymous'; v.muted = true; v.playsInline = true; v.preload = 'metadata';
    v.onloadeddata = () => { clearTimeout(to); try { v.currentTime = Math.min(0.6, (v.duration || 1) / 3); } catch (_) { /* image 0 */ } };
    v.onseeked = () => { clearTimeout(to); done(v); }; v.onerror = () => { clearTimeout(to); done(null); };
    v.src = url;
  });
  mediaCache.set(url, pr); if (mediaCache.size > 24) mediaCache.delete(mediaCache.keys().next().value);
  return pr;
}
const rr = (c, x, y, w, h, r) => { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); };

// Carte d'une publication : style « verre » (glassmorphisme) — photo/aperçu en fond si disponible, panneau translucide à bordure lumineuse,
// reflet diagonal. W×H px (2:1). Le bas reste libre pour le bandeau défilant des écrans LED.
function drawCard(cv, post, ledBottom, media) {
  const W = cv.width, H = cv.height, k = W / 512, c = cv.getContext('2d');
  const g = c.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#101a2e'); g.addColorStop(1, '#2a1250'); c.fillStyle = g; c.fillRect(0, 0, W, H);
  if (media) { // « cover » : la photo remplit la carte sans déformation
    const mw = media.videoWidth || media.naturalWidth || media.width, mh = media.videoHeight || media.naturalHeight || media.height;
    if (mw && mh) { const sc = Math.max(W / mw, H / mh), dw = mw * sc, dh = mh * sc; try { c.drawImage(media, (W - dw) / 2, (H - dh) / 2, dw, dh); } catch (_) { /* image non exploitable */ } }
  }
  const sh = c.createLinearGradient(0, 0, 0, H); sh.addColorStop(0, 'rgba(6,10,24,.72)'); sh.addColorStop(0.45, 'rgba(6,10,24,.18)'); sh.addColorStop(1, 'rgba(6,10,24,.78)'); c.fillStyle = sh; c.fillRect(0, 0, W, H);
  // panneau de verre pour le texte
  const text = postText(post), hasText = !!text;
  const px = 16 * k, py = 14 * k, pw = W - 32 * k, ph = (media ? (hasText ? 118 : 56) : 150) * k;
  c.save(); rr(c, px, py, pw, ph, 18 * k); c.fillStyle = media ? 'rgba(255,255,255,.16)' : 'rgba(255,255,255,.07)'; c.fill();
  c.strokeStyle = 'rgba(255,255,255,.38)'; c.lineWidth = 2 * k; c.stroke(); c.clip();
  const refl = c.createLinearGradient(px, py, px + pw * 0.6, py + ph); refl.addColorStop(0, 'rgba(255,255,255,.22)'); refl.addColorStop(0.5, 'rgba(255,255,255,0)'); c.fillStyle = refl; c.fillRect(px, py, pw, ph); c.restore();
  c.strokeStyle = '#35d0ff'; c.lineWidth = 5 * k; c.shadowColor = '#35d0ff'; c.shadowBlur = 16 * k; rr(c, 4 * k, 4 * k, W - 8 * k, H - 8 * k, 20 * k); c.stroke(); c.shadowBlur = 0;
  c.textBaseline = 'top'; c.textAlign = 'left';
  c.fillStyle = '#ffd23d'; c.font = `800 ${34 * k}px ${FONT}`; c.fillText((post.author?.username || 'JexChat').slice(0, 22), 32 * k, 24 * k);
  if (hasText || !media) { c.fillStyle = '#ffffff'; c.font = `600 ${29 * k}px ${FONT}`; c.shadowColor = 'rgba(0,0,0,.6)'; c.shadowBlur = 4 * k;
    wrap(c, text || mediaTag(post) || '…', W - 70 * k, media ? 2 : 3).forEach((l, i) => c.fillText(l, 32 * k, (68 + i * 38) * k)); c.shadowBlur = 0; }
  const yb = (ledBottom ? 160 : 206) * k, tag = mediaTag(post);
  if (media && post.mediaType !== 'image' && (post.mediaType === 'video' || post.sharedFrom?.mediaType === 'video')) { // pastille lecture
    c.fillStyle = 'rgba(0,0,0,.45)'; c.beginPath(); c.arc(W / 2, H / 2, 38 * k, 0, 7); c.fill(); c.fillStyle = '#fff'; c.beginPath(); c.moveTo(W / 2 - 12 * k, H / 2 - 20 * k); c.lineTo(W / 2 + 22 * k, H / 2); c.lineTo(W / 2 - 12 * k, H / 2 + 20 * k); c.fill();
  }
  c.fillStyle = '#d6e4ff'; c.font = `700 ${24 * k}px ${FONT}`; c.shadowColor = 'rgba(0,0,0,.7)'; c.shadowBlur = 5 * k; c.fillText(`${tag ? tag + '   ' : ''}♥ ${post.likesCount || 0}`, 32 * k, yb);
  c.textAlign = 'right'; c.fillText('Toucher pour ouvrir', W - 32 * k, yb); c.shadowBlur = 0;
}
function postTexture(post, W, H, ledBottom) {
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  drawCard(cv, post, ledBottom, null);
  const tex = sRGB(new THREE.CanvasTexture(cv));
  loadMedia(post).then((m) => { if (m && !tex.userData.dead) { drawCard(cv, post, ledBottom, m); tex.needsUpdate = true; } });
  const dispose = tex.dispose.bind(tex); tex.dispose = () => { tex.userData.dead = true; dispose(); };
  return tex;
}
function brandTexture() {
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 256; const c = cv.getContext('2d');
  const g = c.createLinearGradient(0, 0, 512, 256); g.addColorStop(0, '#12082a'); g.addColorStop(1, '#06223a'); c.fillStyle = g; c.fillRect(0, 0, 512, 256);
  c.textAlign = 'center'; c.textBaseline = 'middle'; c.shadowColor = '#35d0ff'; c.shadowBlur = 24; c.fillStyle = '#fff'; c.font = `900 84px ${FONT}`; c.fillText('JEX CITY', 256, 112);
  c.shadowColor = '#ff4fa3'; c.fillStyle = '#ff9ccd'; c.font = `700 30px ${FONT}`; c.fillText('PUBLIE · PARTAGE · DÉCOUVRE', 256, 190);
  return sRGB(new THREE.CanvasTexture(cv));
}

export function createPosts({ world, pickables, layout }) {
  const screens = layout?.screens || [];
  const root = new THREE.Group(); world.root.add(root);
  const brand = brandTexture();
  const frameMat = new THREE.MeshLambertMaterial({ color: '#12151c' });
  const glowMat = new THREE.MeshBasicMaterial({ color: '#35d0ff', transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const ticker = { tex: null, mats: [] };
  const boards = [];

  // ── Écrans LED géants sur les façades ──
  screens.forEach((s, i) => {
    const g = new THREE.Group(); g.position.set(s.x, s.y, s.z); g.rotation.y = s.side > 0 ? -Math.PI / 2 : Math.PI / 2;
    g.add(new THREE.Mesh(new THREE.BoxGeometry(s.w + 0.8, s.h + 0.8, 0.45), frameMat));
    const mat = new THREE.MeshBasicMaterial({ map: brand, toneMapped: false });
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(s.w, s.h), mat); scr.position.z = 0.24; g.add(scr);
    const tmat = new THREE.MeshBasicMaterial({ transparent: true, toneMapped: false, depthWrite: false, opacity: 0 });
    const tk = new THREE.Mesh(new THREE.PlaneGeometry(s.w, s.h * 0.13), tmat); tk.position.set(0, -s.h * 0.435, 0.245); g.add(tk); ticker.mats.push(tmat);
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(s.w * 1.25, s.h * 1.35), glowMat); glow.position.z = 0.1; g.add(glow);
    const hit = new THREE.Mesh(new THREE.BoxGeometry(s.w, s.h, 1.2), hitMat); hit.position.z = 0.4; hit.userData = { pick: 'board', index: i }; g.add(hit); pickables.push(hit);
    root.add(g);
    boards.push({ led: true, g, face: g, mat, post: null, tex: null, hit, pos: g.position, range: 150, free: 230 });
  });

  // ── Cartes volantes : elles tournent autour du joueur le long de l'avenue ──
  const cardGeo = new THREE.PlaneGeometry(4.6, 2.3), cardFrame = new THREE.BoxGeometry(4.9, 2.6, 0.1), hitGeo = new THREE.BoxGeometry(5.2, 3, 0.8), glowGeo = new THREE.PlaneGeometry(6.2, 3.6);
  for (let i = 0; i < FLY; i++) {
    const g = new THREE.Group(); g.visible = false;
    const face = new THREE.Group(); g.add(face);
    face.add(new THREE.Mesh(cardFrame, frameMat));
    const mat = new THREE.MeshBasicMaterial({ map: brand, toneMapped: false });
    const scr = new THREE.Mesh(cardGeo, mat); scr.position.z = 0.07; face.add(scr);
    const glow = new THREE.Mesh(glowGeo, glowMat); glow.position.z = -0.08; face.add(glow);
    const hit = new THREE.Mesh(hitGeo, hitMat); hit.userData = { pick: 'board', index: screens.length + i }; face.add(hit); pickables.push(hit);
    root.add(g);
    const dir = i % 2 ? 1 : -1;
    boards.push({ led: false, g, face, mat, post: null, tex: null, hit, pos: g.position, range: 95, free: 150, fly: { u: (i / FLY) * 240, dir, lane: ((i % 6) - 2.5) * 4.4, baseY: 7 + (i % 4) * 4.5, speed: 2.4 + (i % 3) * 1.1, phase: i * 1.7 } });
  }

  let center = 0, centerInit = false, tickerKey = '';
  function setTicker(usable) {
    const key = usable.map((p) => p._id || p.id || '').join(',');
    if (key === tickerKey) return; tickerKey = key;
    if (ticker.tex) ticker.tex.dispose();
    const cv = document.createElement('canvas'); cv.width = 2048; cv.height = 64; const c = cv.getContext('2d');
    c.fillStyle = '#05070c'; c.fillRect(0, 0, 2048, 64); c.font = `800 34px ${FONT}`; c.textBaseline = 'middle';
    let x = 20; const cols = ['#ffd23d', '#35d0ff', '#ff4fa3', '#6aff9a'];
    usable.slice(0, 12).forEach((p, i) => { const t = '◆ ' + `${(p.author?.username || 'JexChat').slice(0, 14)}  ${(postText(p) || mediaTag(p) || '').replace(/\s+/g, ' ').slice(0, 40)}` + '   '; c.fillStyle = cols[i % 4]; c.fillText(t, x, 34); x += c.measureText(t).width; });
    if (x < 1000) { c.fillStyle = '#35d0ff'; c.fillText('◆ JEX CITY — bienvenue sur la Grande Avenue ◆', x + 10, 34); }
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.repeat.set(0.5, 1); ticker.tex = t;
    for (const m of ticker.mats) { m.map = t; m.opacity = 1; m.needsUpdate = true; }
  }

  function assign(posts) {
    const usable = (posts || []).filter((p) => p && (postText(p) || p.mediaType !== 'none'));
    boards.forEach((b, i) => {
      b.post = usable[i] || null;
      if (b.tex) { b.tex.dispose(); b.tex = null; b.mat.map = brand; b.mat.needsUpdate = true; } // redessiné à la prochaine approche
    });
    setTicker(usable);
  }
  function select() { return null; }  // plus de bateaux (API conservée)
  function selectBoard(index) { return boards[index]?.post || null; }
  function release() { /* rien à relancer : les cartes ne s'arrêtent pas */ }

  function update(camPos, t = 0, dt = 0.016) {
    if (ticker.tex) ticker.tex.offset.x = (t * 0.045) % 1;
    const zMin = G.TOWN.z0 + 50, zMax = G.TOWN.z1 - 70;
    const target = Math.min(zMax, Math.max(zMin, camPos.z));
    if (!centerInit) { center = target; centerInit = true; } else center += (target - center) * Math.min(1, 0.5 * Math.min(dt, 0.1));
    let built = 0;
    for (const b of boards) {
      if (b.fly) { // trajectoire : la carte parcourt une boucle de 240 m centrée sur le joueur
        const f = b.fly; f.u = (f.u + f.dir * f.speed * Math.min(dt, 0.1) + 240) % 240;
        b.g.position.set(f.lane + Math.sin(t * 0.4 + f.phase) * 2.2, f.baseY + Math.sin(t * 0.8 + f.phase) * 1.1, center + f.u - 120);
      }
      const dx = camPos.x - b.pos.x, dz = camPos.z - b.pos.z, d = Math.hypot(dx, dz);
      const show = (b.led || !!b.post) && d < b.range * 1.6;
      if (b.g.visible !== show) b.g.visible = show;
      if (!show) { if (b.tex && d > b.free) { b.tex.dispose(); b.tex = null; b.mat.map = brand; b.mat.needsUpdate = true; } continue; }
      if (b.post && !b.tex && d < b.range && built < 1) { b.tex = b.led ? postTexture(b.post, 1024, 512, true) : postTexture(b.post, 768, 384, false); b.mat.map = b.tex; b.mat.needsUpdate = true; built++; }
      if (b.fly) { let dy = Math.atan2(dx, dz) - b.face.rotation.y; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); b.face.rotation.y += dy * 0.1; b.face.rotation.z = Math.sin(t * 0.6 + b.fly.phase) * 0.05; }
      else b.mat.color.setScalar(0.92 + 0.08 * Math.sin(t * 2.2 + b.pos.z)); // légère pulsation de l'écran
    }
  }
  return { assign, select, selectBoard, release, update, capacity: boards.length, get selected() { return null; }, slots: [], boards };
}
