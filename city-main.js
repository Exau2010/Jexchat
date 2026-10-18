// city-main.js — JexCity : démarrage, rendu, boucle principale, déplacement du joueur.
// Qualité adaptative (3 niveaux), perte de contexte WebGL gérée, boucle suspendue quand l'onglet est caché.
import * as THREE from 'three';
import * as G from './city-geo.js';
import { createWorld } from './city-world.js';
import { createControls } from './city-controls.js';
import { createAvatar } from './city-avatar.js';
import { createSocial } from './city-social.js';
import { createPosts } from './city-posts.js';
import { createUI, h } from './city-ui.js';
import { createGamesClient } from './city-games.js';
import { cleanLook, loadLocalLook, saveLocalLook } from './city-look.js';
import { disposeAvatar } from './city-social.js';
import { api } from './city-api.js';

const $ = (s) => document.querySelector(s);
const TIERS = {
  low:  { name: 'low',  tex: 256,  shadows: 0,    trees: 220, fogMul: 1.25, pr: 1,    aa: false },
  mid:  { name: 'mid',  tex: 512,  shadows: 1024, trees: 500, fogMul: 1,    pr: 1.25, aa: false },
  high: { name: 'high', tex: 1024, shadows: 2048, trees: 800, fogMul: 1,    pr: 2,    aa: true },
};
function fatal(msg, retry = true) {
  $('#loader').classList.add('done'); $('#hud').hidden = true;
  $('#fatal-msg').textContent = msg; $('#fatal-retry').hidden = !retry; $('#fatal').hidden = false;
}
$('#fatal-retry').addEventListener('click', () => location.reload());
addEventListener('unhandledrejection', (e) => console.warn('[JexCity]', e.reason));

function detectTier() {
  const coarse = matchMedia('(pointer:coarse)').matches, mem = navigator.deviceMemory || 4, cores = navigator.hardwareConcurrency || 4;
  if (coarse && (mem <= 3 || cores <= 4)) return TIERS.low;
  if (coarse || mem <= 4) return TIERS.mid;
  return TIERS.high;
}
function pickTier() { const saved = localStorage.getItem('jexcity.tier'); return TIERS[saved] || detectTier(); }

async function boot() {
  // 1) Session JexChat existante (cookie HttpOnly, même origine). Sinon : retour à la connexion.
  // Les appels réseau sont déjà partis (city.html) : ils avancent pendant que la ville se construit ci-dessous.
  let meErr = null;
  const meP = api.me(); meP.catch((e) => { meErr = e; });
  const configP = api.config().catch(() => ({ muted: [] })); // sourdine indisponible : non bloquant
  const failMe = (e) => {
    if (e.status === 401) { $('#fatal-home').textContent = 'Se connecter à JexChat'; return fatal('Connectez-vous à JexChat pour entrer dans JexCity.', false); }
    return fatal(e.message);
  };

  // 2) Rendu
  let tier = pickTier();
  const canvas = $('#gl');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: tier.aa, powerPreference: 'high-performance', alpha: false });
  } catch (_) { return fatal('Votre navigateur ne peut pas afficher la 3D (WebGL indisponible).', false); }
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = tier.name === 'high' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 1, 0.5, 1600);
  const applySize = () => {
    const pr = Math.min(devicePixelRatio || 1, tier.pr);
    renderer.setPixelRatio(pr); renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / Math.max(1, innerHeight); camera.updateProjectionMatrix();
  };
  applySize(); addEventListener('resize', applySize); addEventListener('orientationchange', () => setTimeout(applySize, 250));

  // 3) Monde
  $('#ld-msg').textContent = 'Construction de la ville…';
  await new Promise((r) => setTimeout(r, 30)); // laisse le navigateur afficher le message
  if (meErr) return failMe(meErr); // non connecté : inutile de construire la ville
  const layout = G.buildLayout(7);
  let world;
  try { world = createWorld({ scene, layout, tier, renderer }); } catch (e) { console.error(e); return fatal('Impossible de construire la ville : ' + e.message); }
  const pickables = world.pickables;

  // Session et réglages : normalement déjà arrivés pendant la construction.
  let me; try { me = await meP; } catch (e) { return failMe(e); }
  me.id = String(me.id);
  const config = await configP;

  // 4) Joueur (position restaurée après une perte de contexte)
  const saved = (() => { try { return JSON.parse(sessionStorage.getItem('jexcity.pos')); } catch (_) { return null; } })();
  const sp = saved && G.isFree(layout, saved.x, saved.z) ? [saved.x, saved.z] : G.spawnPoint();
  const player = { x: sp[0], z: sp[1], path: [], speed: 4.2, stuck: 0, dest: null };
  // Apparence : celle du serveur (partagée avec les autres joueurs), sinon la copie locale de cet appareil.
  let look = cleanLook(config.look && Object.keys(config.look).length ? config.look : loadLocalLook());
  let av = createAvatar({ colorA: me.identity?.colorA, colorB: me.identity?.colorB, name: me.username, look });
  scene.add(av.group);
  let lookT = 0;
  const setLook = (next) => { // visible tout de suite ; conservé sur l'appareil puis sur le serveur (un seul envoi après 0,6 s sans changement)
    look = cleanLook(next); saveLocalLook(look);
    const old = av.group, yaw = old.rotation.y; scene.remove(old); disposeAvatar(old);
    av = createAvatar({ colorA: me.identity?.colorA, colorB: me.identity?.colorB, name: me.username, look }); av.group.rotation.y = yaw; scene.add(av.group);
    clearTimeout(lookT); lookT = setTimeout(() => api.saveLook(look).catch(() => ui?.toast('Apparence non enregistrée sur le serveur.')), 600);
  };
  const posV = new THREE.Vector3(player.x, G.groundY(player.x, player.z), player.z);
  const marker = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.5, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xf0b463, transparent: true, opacity: 0, depthWrite: false }));
  scene.add(marker);

  const socket = window.io ? window.io({ transports: ['websocket', 'polling'] }) : null;
  if (!socket) return fatal('Connexion temps réel indisponible.');
  const social = createSocial({ scene, layout, pickables, socket, getSelf: () => player });
  const posts = createPosts({ world, pickables, layout });

  let ui, games; let mood = '';
  const walkTo = (x, z) => {
    const path = G.planPath(layout, [player.x, player.z], [x, z]);
    if (!path.length) return;
    player.path = path; player.stuck = 0; player.dest = path[path.length - 1];
    marker.position.set(player.dest[0], G.groundY(player.dest[0], player.dest[1]) + 0.05, player.dest[1]); marker.material.opacity = 0.9;
    social.emitMove(player.x, player.z, player.dest[0], player.dest[1]);
    $('#hint').style.opacity = 0;
  };
  const controls = createControls({
    camera, dom: canvas, layout, pickables, padEl: $('#campad'),
    onGround: (pt) => walkTo(pt.x, pt.z),
    onBuilding: (hit) => {
      const kind = hit.object.userData.pick;
      if (kind === 'avatar') { const r = social.remotes.get(hit.object.userData.userId); if (r) ui.showUser({ ...r.user, id: r.id }); }
      else if (kind === 'boat') { const p = posts.select(hit.object.userData.index); if (p) ui.showPost(p, () => posts.release()); }
      else if (kind === 'board') { const p = posts.selectBoard(hit.object.userData.index); if (p) ui.showPost(p); }
      else walkTo(hit.point.x, hit.point.z); // façade : on rejoint le point libre le plus proche
    },
  });
  controls.snap(posV);

  ui = createUI({
    me, socket,
    ctl: {
      muted: config.muted, layout, walkTo,
      games: { invite: (id, name) => games.invite(id, name) },
      look: { get: () => look, set: setLook },
      remote: (id) => social.remotes.get(id), remotes: () => [...social.remotes.values()], self: () => player, landmarks: () => world.landmarks,
      removeRemote: (id) => social.remove(id),
      getMood: () => mood, setMood: (t) => { mood = (t || '').trim().slice(0, 40); social.setMood(mood); ui.setMoodLabel(mood); },
      getHour: () => world.state.hour, setHour: (h) => world.setHour(h),
      isLight: () => tier.name === 'low',
      setLight: (on) => { if (on) { localStorage.setItem('jexcity.tier', 'low'); setTier(TIERS.low); } else { localStorage.removeItem('jexcity.tier'); const d = detectTier(); setTier(d.name === 'low' ? TIERS.mid : d); } },
    },
  });
  games = createGamesClient({ socket, me, h, toast: (m) => ui.toast(m) });
  function setTier(t) { tier = t; world.setTier(t); applySize(); }

  // Heure réelle de l'utilisateur (modifiable dans les réglages)
  const now = new Date(); world.setHour(now.getHours() + now.getMinutes() / 60);

  // Réseau social : présence + publications portées par les bateaux
  social.onError = (m) => ui.toast(m);
  const connectJoin = () => social.join(mood);
  if (socket.connected) connectJoin(); else socket.once('connect', connectJoin);
  const loadPosts = () => api.latestPosts(Math.min(30, posts.capacity)).then((p) => posts.assign(p)).catch(() => {});
  loadPosts(); setInterval(() => { if (!ui.isOpen() && !document.hidden) loadPosts(); }, 180000);

  // 5) Boucle
  const clock = new THREE.Clock(); let t = 0, running = true, frames = 0, fpsT = 0, adapt = 0, saveT = 0;
  function frame() {
    if (!running) return;
    const dt = Math.min(clock.getDelta(), 0.05); t += dt;
    // déplacement
    if (player.path.length) {
      const [wx, wz] = player.path[0], dx = wx - player.x, dz = wz - player.z, d = Math.hypot(dx, dz);
      if (d < 0.25) { player.path.shift(); }
      else {
        const s = Math.min(d, player.speed * dt), [nx, nz] = G.slideMove(layout, player.x, player.z, player.x + dx / d * s, player.z + dz / d * s);
        if (Math.hypot(nx - player.x, nz - player.z) < s * 0.25) { player.stuck += dt; if (player.stuck > 0.5) player.path.length = 0; } else { player.stuck = 0; player.x = nx; player.z = nz; }
        av.face(Math.atan2(dx, dz), dt);
      }
      if (!player.path.length) { social.emitMove(player.x, player.z, player.x, player.z); player.dest = null; }
    }
    av.setWalking(player.path.length > 0);
    posV.set(player.x, G.groundY(player.x, player.z), player.z); av.group.position.copy(posV); av.update(dt, t);
    if (marker.material.opacity > 0) { marker.material.opacity = player.dest ? 0.85 : Math.max(0, marker.material.opacity - dt * 2); marker.scale.setScalar(1 + Math.sin(t * 6) * 0.08); }
    controls.update(dt, posV);
    world.followShadow(posV); world.update(t, dt, camera.position);
    social.update(dt, t, camera.position); posts.update(camera.position, t);
    renderer.render(scene, camera);
    // sauvegarde de position (reprise après perte de contexte) + qualité adaptative
    saveT += dt; if (saveT > 2) { saveT = 0; try { sessionStorage.setItem('jexcity.pos', JSON.stringify({ x: player.x, z: player.z })); } catch (_) {} }
    frames++; fpsT += dt;
    if (fpsT >= 3) {
      const fps = frames / fpsT; frames = 0; fpsT = 0; window.__jexcityFps = Math.round(fps);
      if (fps < 24 && tier.name !== 'low' && adapt < 2) { adapt++; setTier(tier.name === 'high' ? TIERS.mid : TIERS.low); ui.toast('Qualité réduite pour rester fluide'); }
    }
  }
  const start = () => { running = true; clock.getDelta(); renderer.setAnimationLoop(frame); };
  const stop = () => { running = false; renderer.setAnimationLoop(null); };
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else start(); });
  addEventListener('pagehide', () => { social.leave(); try { sessionStorage.setItem('jexcity.pos', JSON.stringify({ x: player.x, z: player.z })); } catch (_) {} });

  // Perte de contexte WebGL : on met en pause, puis on recharge la scène à la restauration (position conservée).
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); stop(); ui.toast('Affichage interrompu, reprise…'); });
  canvas.addEventListener('webglcontextrestored', () => { try { sessionStorage.setItem('jexcity.pos', JSON.stringify({ x: player.x, z: player.z })); } catch (_) {} location.reload(); });

  $('#hud').hidden = false; $('#loader').classList.add('done'); start();
  setTimeout(() => { $('#hint').style.opacity = 0; }, 9000);
  window.__jexcity = { renderer, scene, camera, controls, world, player, social, tier: () => tier.name }; // diagnostic (console)
}
boot().catch((e) => { console.error(e); fatal('Erreur au démarrage : ' + (e?.message || e)); });
