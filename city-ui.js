// city-ui.js — JexCity : commandes flottantes, panneau contextuel, cartes, téléphone, recherche, carte.
// Tout le texte venant du réseau est inséré avec textContent (jamais innerHTML) ; les liens et médias sont limités à https.
import * as G from './city-geo.js';
import { api, postText, safeHttps } from './city-api.js';
import { buildPlayer, embeddable } from './city-media.js';
import { SKIN, HAIR, SKIN_NAMES, HAIR_NAMES, STYLES, ACCESSORIES, TOPS, TOP_NAMES, PANTS, PANT_NAMES, SHOES, SHOE_NAMES, EYES, EYE_NAMES, BEARDS } from './city-look.js';

const I = {
  back: '<path d="M15 5l-7 7 7 7"/>', close: '<path d="M6 6l12 12M18 6L6 18"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.5-4.5"/>',
  map: '<path d="M9 4L3 6.5v13L9 17l6 3 6-2.5v-13L15 7z"/><path d="M9 4v13M15 7v13"/>',
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
  bell: '<path d="M6 16V11a6 6 0 0112 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 004 0"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"/>',
  game: '<rect x="3" y="8" width="18" height="9" rx="4"/><path d="M8 10.5v4M6 12.5h4M16 11.5h.01M18 13.5h.01"/>', user: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c0-4 3-6 7-6s7 2 7 6"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/>', globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>', invite: '<path d="M4 6h16v12H4z"/><path d="M4 7l8 6 8-6"/>',
};
const svg = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[n]}</svg>`;

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v; else if (k === 'text') el.textContent = v; else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
}
const $ = (s) => document.querySelector(s);
const sid = (v) => String(v?._id || v?.id || v || '');
const when = (d) => { try { return new Date(d).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (_) { return ''; } };

export function pill(user, size = 40) {
  const url = safeHttps(user?.avatarUrl);
  const bg = /^#[0-9a-f]{3,8}$/i.test(user?.identity?.colorA || '') ? user.identity.colorA : '#6C63FF';
  const el = h('span', { class: 'pill', style: `width:${size}px;height:${size}px;background-color:${bg};font-size:${Math.round(size * 0.42)}px` }, url ? '' : (user?.username || '?').slice(0, 1).toUpperCase());
  if (url) el.style.backgroundImage = `url("${url.replace(/["\\()\s]/g, encodeURIComponent)}")`;
  return el;
}

export function createUI({ me, socket, ctl }) {
  const sheet = $('#sheet'), body = $('#sheet-body'), title = $('#sheet-title'), backBtn = $('#sheet-back');
  const stack = []; let muted = new Set(ctl.muted || []); let toastT = 0; let current = null;

  document.querySelectorAll('[data-ic]').forEach((el) => { el.insertAdjacentHTML('afterbegin', svg(el.dataset.ic)); });

  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2600); }
  const fail = (e) => toast(e?.message || 'Une erreur est survenue.');

  // ── panneau : pile de vues ; fermer ne touche ni à la caméra, ni à la position, ni au monde ──
  function render() {
    current?.cleanup?.(); current = null;
    const v = stack[stack.length - 1];
    document.body.classList.toggle('sheet-open', !!v);
    if (!v) { sheet.hidden = true; body.replaceChildren(); return; }
    sheet.hidden = false; title.textContent = v.title; backBtn.hidden = stack.length < 2;
    body.replaceChildren(); current = { cleanup: null };
    const out = v.build(body, current); if (out) body.append(out);
    body.scrollTop = 0;
  }
  function open(titleText, build, { onClose, replace } = {}) { if (replace) stack.pop(); stack.push({ title: titleText, build, onClose }); render(); }
  function back() { const v = stack.pop(); v?.onClose?.(); render(); }
  function close() { while (stack.length) stack.pop().onClose?.(); render(); }
  $('#sheet-close').addEventListener('click', close); backBtn.addEventListener('click', back);
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && stack.length) close(); });

  const btn = (label, fn, cls = '') => h('button', { class: `btn small ${cls}`, onclick: fn }, label);
  async function guarded(button, fn, okMsg) {
    button.disabled = true;
    try { const r = await fn(); if (okMsg) toast(okMsg); return r; } catch (e) { fail(e); } finally { button.disabled = false; }
  }

  // ── carte d'un utilisateur (avatar touché / résultat de recherche) ──
  function showUser(u, { replace } = {}) {
    const id = sid(u); if (!id) return;
    open(u.username || 'Profil', () => {
      const r = ctl.remote(id);
      const mood = r?.user.mood || u.mood;
      const isMe = id === me.id;
      const wrap = h('div', null,
        h('div', { class: 'row', style: 'cursor:default' }, pill(u, 52), h('div', { class: 'grow' }, h('b', { text: u.username }), mood ? h('div', { class: 'sub', text: `« ${mood} »` }) : null,
          h('div', { class: 'sub', text: r ? 'Dans la ville' : (u.isOnline ? 'En ligne sur JexChat' : '') }))));
      const acts = h('div', { class: 'actions' });
      acts.append(btn('Profil et publications', () => showProfile(id)));
      if (!isMe) {
        if (r && ctl.games) acts.append(btn('Jouer au morpion', (e) => guarded(e.currentTarget, () => ctl.games.invite(id, u.username), null)));
        if (r && ctl.games) { acts.append(btn('Course', (e) => guarded(e.currentTarget, () => ctl.games.invite(id, u.username, 'race')))); acts.append(btn('Tir arcade', (e) => guarded(e.currentTarget, () => ctl.games.invite(id, u.username, 'shoot')))); }
        acts.append(btn('Inviter à discuter', (e) => guarded(e.currentTarget, () => api.invite(id), 'Invitation envoyée')));
        const mb = btn(muted.has(id) ? 'Réactiver les invitations' : 'Couper les invitations', (e) => guarded(e.currentTarget, async () => {
          if (muted.has(id)) { await api.unmute(id); muted.delete(id); } else { await api.mute(id); muted.add(id); }
          mb.textContent = muted.has(id) ? 'Réactiver les invitations' : 'Couper les invitations';
        }, 'Réglage enregistré'));
        acts.append(mb);
        acts.append(btn('Bloquer', (e) => { if (confirm(`Bloquer ${u.username} ? Vous ne vous verrez plus dans la ville ni dans JexChat.`)) guarded(e.currentTarget, async () => { await api.block(id); ctl.removeRemote(id); close(); }, 'Utilisateur bloqué. Vous pourrez le débloquer dans Réglages.'); }, 'danger'));
        acts.append(btn('Signaler', () => report('user', id)));
      }
      wrap.append(acts); return wrap;
    }, { replace });
  }
  function report(type, id) {
    open('Signaler', () => {
      const ta = h('textarea', { class: 'field', rows: 3, maxlength: 400, placeholder: 'Décrivez le problème', style: 'padding:10px 14px;border-radius:14px;resize:none' });
      const go = btn('Envoyer le signalement', () => { if (ta.value.trim().length < 3) return toast('Ajoutez quelques mots.'); guarded(go, async () => { await api.report(type, id, ta.value.trim()); back(); }, 'Merci, signalement envoyé.'); }, 'primary');
      return h('div', null, h('p', { class: 'sub', text: 'Un modérateur examinera votre signalement.' }), ta, h('div', { class: 'actions' }, go));
    });
  }

  function postCard(p, { compact } = {}) {
    const a = p.author || {}, media = safeHttps(p.mediaUrl || p.sharedFrom?.mediaUrl), mt = p.mediaType !== 'none' ? p.mediaType : p.sharedFrom?.mediaType;
    const card = h('div', { class: 'card' },
      h('div', { class: 'row', style: 'padding:0;min-height:40px', onclick: () => showUser(a) }, pill(a, 34), h('div', { class: 'grow' }, h('b', { text: a.username || '' }), h('div', { class: 'sub', text: when(p.createdAt) }))),
      h('div', { style: 'margin-top:8px;white-space:pre-wrap;word-break:break-word', text: postText(p) }));
    // Médias : image ; vidéo via le lecteur intégré (fichier direct, YouTube, Vimeo) ; en cas d'échec, repli sur un lien.
    const mediaLink = () => h('a', { href: media, target: '_blank', rel: 'noopener noreferrer', class: 'sub', text: 'Ouvrir le média' });
    const fallback = (el) => () => { if (el.parentNode) el.replaceWith(mediaLink()); };
    if (media && mt === 'image') { const im = h('img', { src: media, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }); im.addEventListener('error', fallback(im), { once: true }); card.append(im); }
    else if (media && mt === 'video') card.append(buildPlayer(media));
    else if (media) card.append(mediaLink());
    if (!compact) {
      const like = btn(`♥ ${p.likesCount || 0}`, () => guarded(like, async () => { await api.like(sid(p)); p.likedByMe = !p.likedByMe; p.likesCount = (p.likesCount || 0) + (p.likedByMe ? 1 : -1); like.textContent = `♥ ${p.likesCount}`; }));
      card.append(h('div', { class: 'actions', style: 'margin-bottom:0' }, like,
        h('a', { class: 'btn small', href: `/lapage/${encodeURIComponent(a.username || '')}/actu/${encodeURIComponent(sid(p))}`, target: '_blank', rel: 'noopener', text: 'Ouvrir sur JexChat' }),
        btn('Signaler', () => report('post', sid(p)))));
    }
    return card;
  }
  function showPost(p, onClose) { open('Publication', () => postCard(p), { onClose }); }

  function showProfile(id) {
    open('Profil', (root) => {
      root.append(h('div', { class: 'sub', text: 'Chargement…' }));
      Promise.all([api.user(id), api.postsOf(id)]).then(([u, posts]) => {
        if (!root.isConnected) return;
        root.replaceChildren(h('div', { class: 'row', style: 'cursor:default' }, pill(u, 56), h('div', { class: 'grow' }, h('b', { text: u.username }),
          h('div', { class: 'sub', text: u.stats ? `${u.stats.postsCount ?? u.stats.posts ?? ''} publications`.trim() : '' }))),
          h('h4', { text: 'Publications' }), ...(posts.length ? posts.map((p) => postCard(p)) : [h('div', { class: 'sub', text: 'Aucune publication.' })]));
      }).catch((e) => { root.replaceChildren(h('div', { class: 'sub', text: e.message })); });
    });
  }

  // ── recherche ──
  function searchView(onPick, { replace, titleText = 'Rechercher' } = {}) {
    open(titleText, () => {
      const list = h('div', { style: 'margin-top:8px' }), input = h('input', { class: 'field', type: 'search', placeholder: 'Rechercher un pseudo', autocomplete: 'off', maxlength: 32 });
      let t = 0, seq = 0;
      input.addEventListener('input', () => {
        clearTimeout(t); const v = input.value.trim();
        if (!v) return list.replaceChildren();
        t = setTimeout(async () => {
          const my = ++seq;
          try {
            const res = (await api.search(v)).filter((u) => sid(u) !== me.id); if (my !== seq) return;
            list.replaceChildren(...(res.length ? res.map((u) => h('button', { class: 'row', onclick: () => onPick(u) }, pill(u, 40), h('div', { class: 'grow' }, h('b', { text: u.username }), h('div', { class: 'sub', text: ctl.remote(sid(u)) ? 'Dans la ville' : '' })))) : [h('div', { class: 'sub', text: 'Aucun résultat.' })]));
          } catch (e) { list.replaceChildren(h('div', { class: 'sub', text: e.message })); }
        }, 280);
      });
      setTimeout(() => input.focus({ preventScroll: true }), 60);
      return h('div', null, input, list);
    }, { replace });
  }

  // ── carte de la ville ──
  function mapView() {
    open('Carte', (root, cur) => {
      const S = 1.5, W = Math.round((G.TOWN.x1 - G.TOWN.x0) * S), Hh = Math.round((G.TOWN.z1 - G.TOWN.z0) * S), cv = h('canvas', { class: 'map', width: W, height: Hh }), c = cv.getContext('2d');
      const X = (x) => (x - G.TOWN.x0) * S, Z = (z) => (z - G.TOWN.z0) * S;
      const base = document.createElement('canvas'); base.width = W; base.height = Hh; const b = base.getContext('2d');
      // fond : herbe, parcs de chaque côté, esplanade et lac au sud
      b.fillStyle = '#b9d3a0'; b.fillRect(0, 0, W, Hh);
      b.fillStyle = '#9fc486'; b.fillRect(0, 0, X(-G.PARK_X), Hh); b.fillRect(X(G.PARK_X), 0, W - X(G.PARK_X), Hh);
      b.fillStyle = '#9cc7e8'; b.fillRect(0, Z(G.TOWN.z1 - 6), W, Hh - Z(G.TOWN.z1 - 6));
      // chaussée : Grande Avenue + rues transversales, trottoirs clairs
      b.fillStyle = '#e8e2d2'; b.fillRect(X(-G.AV - G.SW), 0, (G.AV + G.SW) * 2 * S, Hh);
      for (const z of G.STREETS) b.fillRect(0, Z(z - 8), W, 16 * S);
      b.fillStyle = '#6f7682'; b.fillRect(X(-G.AV), 0, G.AV * 2 * S, Hh); for (const z of G.STREETS) b.fillRect(0, Z(z - 7), W, 14 * S);
      b.strokeStyle = '#f4e9b8'; b.lineWidth = 1.5; b.setLineDash([8, 8]); b.beginPath(); b.moveTo(X(0), 0); b.lineTo(X(0), Hh); b.stroke(); b.setLineDash([]);
      // immeubles (tons selon le style) ; stations et tours plus sombres
      for (const q of ctl.layout.buildings) {
        b.fillStyle = q.style === 'brick' ? '#c79a85' : q.style === 'glass' ? '#a9bfd6' : q.style === 'station' ? '#8b93a3' : '#d9d2c4'; b.beginPath();
        [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([sx, sz], i) => { const x = q.cx + q.ax[0] * q.hx * sx + q.az[0] * q.hz * sz, z = q.cz + q.ax[1] * q.hx * sx + q.az[1] * q.hz * sz; i ? b.lineTo(X(x), Z(z)) : b.moveTo(X(x), Z(z)); });
        b.closePath(); b.fill(); b.strokeStyle = 'rgba(60,50,40,.35)'; b.lineWidth = 0.8; b.stroke();
      }
      // lieux ouverts (parcelles) : pastilles colorées avec icône
      const POI = [['🎬', 'Cinéma', G.LOTS.cinema, '#c0392b'], ['☕', 'Cafétéria', G.LOTS.cafe, '#e8a55a'], ['🧠', 'Musée', G.LOTS.museum, '#35a6d0'], ['🛒', 'Supermarché', G.LOTS.market, '#3fbf6b'], ['🏟️', 'Stade', { cx: 84, cz: 134, hx: 13, hz: 13 }, '#e6b800']];
      b.textAlign = 'center'; b.textBaseline = 'middle';
      for (const [ic, name, l, col] of POI) { b.fillStyle = col + 'cc'; b.fillRect(X(l.cx - l.hx), Z(l.cz - l.hz), l.hx * 2 * S, l.hz * 2 * S); b.strokeStyle = col; b.lineWidth = 2; b.strokeRect(X(l.cx - l.hx), Z(l.cz - l.hz), l.hx * 2 * S, l.hz * 2 * S); b.font = '22px system-ui'; b.fillText(ic, X(l.cx), Z(l.cz) - 4); b.font = '700 11px system-ui'; b.lineWidth = 3; b.strokeStyle = '#fff'; b.strokeText(name, X(l.cx), Z(l.cz) + 16); b.fillStyle = '#1d3550'; b.fillText(name, X(l.cx), Z(l.cz) + 16); }
      b.fillStyle = '#1d3550'; b.font = '700 12px system-ui'; b.fillText('N ↑', 18, 14); b.fillText('Grande Avenue', X(0), 14);
      const draw = () => {
        c.drawImage(base, 0, 0);
        for (const r of ctl.remotes()) { c.fillStyle = '#fff'; c.strokeStyle = '#1d3550'; c.lineWidth = 2; c.beginPath(); c.arc(X(r.x), Z(r.z), 5, 0, 7); c.fill(); c.stroke(); }
        const s = ctl.self(); c.fillStyle = '#f0b463'; c.strokeStyle = '#2a1d08'; c.lineWidth = 2.5; c.beginPath(); c.arc(X(s.x), Z(s.z), 7, 0, 7); c.fill(); c.stroke();
        c.fillStyle = '#1d3550'; c.font = '700 11px system-ui'; c.textAlign = 'center'; c.fillText('Vous', X(s.x), Z(s.z) - 12);
        if (s.dest) { c.strokeStyle = '#f0b463'; c.setLineDash([5, 4]); c.lineWidth = 2; c.beginPath(); c.moveTo(X(s.x), Z(s.z)); c.lineTo(X(s.dest[0]), Z(s.dest[1])); c.stroke(); c.setLineDash([]); }
      };
      draw(); const iv = setInterval(draw, 400); cur.cleanup = () => clearInterval(iv);
      const toWorld = (e) => { const r = cv.getBoundingClientRect(); return [G.TOWN.x0 + ((e.clientX - r.left) / r.width) * (G.TOWN.x1 - G.TOWN.x0), G.TOWN.z0 + ((e.clientY - r.top) / r.height) * (G.TOWN.z1 - G.TOWN.z0)]; };
      cv.addEventListener('click', (e) => { const [x, z] = toWorld(e); const hitPoi = POI.find(([, , l]) => Math.abs(x - l.cx) < l.hx && Math.abs(z - l.cz) < l.hz); if (hitPoi) { ctl.goTo?.(hitPoi[1]) || ctl.walkTo(x, z); } else ctl.walkTo(x, z); toast('En route'); });
      const places = ctl.landmarks().filter((l) => G.inWorld(l.pos.x, l.pos.z));
      const poiRows = POI.map(([ic, name, l]) => h('button', { class: 'row', onclick: () => { (ctl.goTo?.(name)) || ctl.walkTo(l.cx, l.cz); close(); } }, h('div', { class: 'grow', text: `${ic} ${name}` })));
      return h('div', null, cv, h('div', { class: 'sub', style: 'text-align:center;margin-top:6px', text: 'Touchez la carte ou un lieu pour vous y rendre' }),
        h('h4', { text: 'Lieux ouverts' }), ...poiRows,
        ...(places.length ? [h('h4', { text: 'Sites' }), ...places.map((l) => h('button', { class: 'row', onclick: () => { ctl.walkTo(l.pos.x, l.pos.z); close(); } }, h('div', { class: 'grow', text: l.name })))] : []));
    });
  }

  // ── téléphone ──
  const myId = me.id;
  function phoneHome() {
    open('Téléphone', () => {
      const app = (icon, label, color, fn) => h('button', { class: 'app', onclick: fn }, h('i', { style: `background:${color}`, html: null }), label);
      const mk = (icon, label, color, fn) => { const b = app(icon, label, color, fn); b.firstChild.innerHTML = svg(icon); return b; };
      return h('div', null, h('div', { class: 'apps' },
        mk('chat', 'JexChat', '#6C63FF', phoneChats), mk('globe', 'Navigateur', '#2f7fb8', () => phoneBrowser()), mk('invite', 'Appel', '#3f9a6a', phoneCall),
        mk('game', 'Jeux', '#c9663f', gamesView), mk('user', 'Personnage', '#8a5ab8', lookView)),
        h('p', { class: 'sub', style: 'text-align:center', text: '« Appel » envoie une invitation de conversation écrite, pas un appel vocal.' }));
    });
  }
  function phoneChats() {
    open('JexChat', (root) => {
      root.append(h('div', { class: 'sub', text: 'Chargement…' }));
      api.conversations().then((list) => {
        if (!root.isConnected) return;
        root.replaceChildren(...(list.length ? list.map((c) => h('button', { class: 'row', onclick: () => phoneConversation(c) },
          pill(c.otherUser || { username: c.name }, 42), h('div', { class: 'grow' }, h('b', { text: c.name }), h('div', { class: 'sub', text: c.lastMessage?.content || '' })),
          c.unreadCount ? h('span', { class: 'badge', style: 'position:static', text: String(c.unreadCount) }) : null)) : [h('div', { class: 'sub', text: 'Aucune conversation.' })]));
      }).catch((e) => root.replaceChildren(h('div', { class: 'sub', text: e.message })));
    });
  }
  function phoneConversation(conv) {
    const cid = sid(conv);
    open(conv.name || 'Conversation', (root, cur) => {
      const list = h('div', { class: 'msgs' }), seen = new Set();
      const line = (m) => {
        if (seen.has(sid(m))) return null; seen.add(sid(m));
        const mine = sid(m.senderId) === myId;
        const text = m.type === 'text' ? m.content : m.type === 'deleted' ? 'Message supprimé' : m.type === 'expired' ? 'Message expiré' : `[${m.type}]`;
        return h('div', { class: 'msg' + (mine ? ' me' : ''), text });
      };
      const add = (m) => { const el = line(m); if (el) { list.append(el); body.scrollTop = body.scrollHeight; } };
      const input = h('input', { class: 'field', placeholder: 'Message', maxlength: 2000, autocomplete: 'off' });
      const send = btn('Envoyer', () => {
        const v = input.value.trim(); if (!v) return;
        guarded(send, async () => { const m = await api.send(cid, v); input.value = ''; add(m); });
      }, 'primary');
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send.click(); });
      root.append(list, h('div', { class: 'sendbar' }, input, send));
      api.messages(cid).then((ms) => { ms.slice().sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)).forEach(add); api.seen(cid); }).catch(fail);
      const onMsg = (m) => { if (sid(m.conversationId) === cid) { add(m); api.seen(cid); } };
      socket.on('new_message', onMsg); cur.cleanup = () => socket.off('new_message', onMsg);
    });
  }
  // Navigateur intégré : la politique de sécurité du serveur n'autorise l'affichage intégré que de YouTube et Vimeo ;
  // la plupart des autres sites interdisent d'être affichés dans une autre page. Pour eux : ouverture dans un onglet
  // à côté (JexCity reste ouverte en arrière-plan) — aucune promesse d'intégration quand elle est impossible.
  function phoneBrowser(start) {
    open('Navigateur', (root, cur) => {
      const hist = []; let pos = -1;
      const input = h('input', { class: 'field', type: 'url', placeholder: 'https://…', inputmode: 'url', autocomplete: 'off', maxlength: 500 });
      const stage = h('div', { class: 'webstage' }), bar = h('div', { class: 'webbar' });
      const prev = btn('◀', () => go(pos - 1, true)), next = btn('▶', () => go(pos + 1, true)), reload = btn('↻', () => go(pos, true)), quit = btn('Fermer', () => back());
      [prev, next, reload].forEach((b) => b.setAttribute('aria-label', 'Navigation'));
      prev.setAttribute('aria-label', 'Page précédente'); next.setAttribute('aria-label', 'Page suivante'); reload.setAttribute('aria-label', 'Recharger');
      const sync = () => { prev.disabled = pos <= 0; next.disabled = pos >= hist.length - 1; reload.disabled = pos < 0; input.value = hist[pos] || ''; };
      function show(url) {
        const emb = embeddable(url);
        if (emb) { const f = h('iframe', { class: 'webframe', allow: 'encrypted-media; picture-in-picture; fullscreen', allowfullscreen: true, title: 'Page intégrée', referrerpolicy: 'strict-origin-when-cross-origin' }); f.src = emb.embed; stage.replaceChildren(f); return; }
        stage.replaceChildren(h('div', { class: 'webnote' },
          h('b', { text: 'Ce site ne peut pas s’afficher dans JexCity.' }),
          h('p', { class: 'wrap', text: 'La plupart des sites interdisent d’être affichés à l’intérieur d’une autre page (protection contre le détournement). Vous pouvez l’ouvrir à côté : JexCity reste ouverte ici.' }),
          h('div', { class: 'actions' },
            btn('Ouvrir à côté', () => window.open(url, '_blank', 'noopener,noreferrer'), 'primary'),
            btn('Copier le lien', () => { (navigator.clipboard?.writeText(url) || Promise.reject()).then(() => toast('Lien copié'), () => toast('Copie impossible')); }))));
      }
      function go(i, fromNav) {
        if (i < 0 || i >= hist.length) return; pos = i; sync(); show(hist[pos]);
      }
      function open2(raw) {
        let u; try { u = new URL(/^[a-z]+:\/\//i.test(raw.trim()) ? raw.trim() : 'https://' + raw.trim()); } catch (_) { return toast('Adresse invalide.'); }
        if (u.protocol !== 'https:') return toast('Seules les adresses https sont autorisées.');
        hist.length = pos + 1; hist.push(u.href); go(hist.length - 1);
      }
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') open2(input.value); });
      bar.append(prev, next, reload, input, btn('Aller', () => open2(input.value), 'primary'), quit);
      stage.append(h('p', { class: 'sub wrap', text: 'Saisissez une adresse https. Les vidéos YouTube et Vimeo s’affichent ici ; les autres sites s’ouvrent à côté.' }));
      cur.cleanup = () => stage.replaceChildren(); // arrête toute lecture à la fermeture
      sync(); if (start) open2(start);
      return h('div', null, bar, stage);
    });
  }
  function phoneCall() {
    searchView((u) => open(u.username, () => h('div', null,
      h('div', { class: 'row', style: 'cursor:default' }, pill(u, 52), h('div', { class: 'grow' }, h('b', { text: u.username }))),
      h('p', { class: 'sub', text: 'Envoie une invitation privée à ouvrir une conversation écrite. Personne d’autre n’en est informé.' }),
      (() => { const b = btn('Inviter à discuter', () => guarded(b, async () => { await api.invite(sid(u)); back(); }, 'Invitation envoyée'), 'primary'); return h('div', { class: 'actions' }, b); })())), { titleText: 'Appel — inviter' });
  }

  // ── notifications ──
  // Lecture : on marque « lu » côté serveur AVANT d'ouvrir le contenu ; le compteur vient du serveur (pas d'estimation locale).
  // La liste du serveur ne contient que les non lues : une notification lue ne réapparaît donc plus à la réouverture.
  let unread = 0; const notifRows = new Map();
  function setBadge(n) { unread = Math.max(0, n | 0); const b = $('#notif-badge'); b.hidden = unread === 0; b.textContent = unread > 9 ? '9+' : String(unread); }
  let badgeT = 0;
  const refreshBadge = () => { clearTimeout(badgeT); badgeT = setTimeout(() => api.notifCount().then((r) => setBadge(r.count || 0)).catch(() => {}), 300); };
  refreshBadge();
  const dropRow = (id) => { const row = notifRows.get(String(id)); if (row) { const parent = row.parentNode; row.remove(); notifRows.delete(String(id)); if (parent && !parent.children.length) parent.append(h('div', { class: 'sub', text: 'Rien de nouveau.' })); } };
  socket.on('notification', (n) => { refreshBadge(); if (n?.content) toast(String(n.content).slice(0, 80)); });
  const onSync = (d) => { if (Number.isFinite(d?.count)) setBadge(d.count); else if (d?.all) setBadge(0); else refreshBadge(); if (d?.all) [...notifRows.keys()].forEach(dropRow); (d?.ids || (d?.notificationId ? [d.notificationId] : [])).forEach(dropRow); };
  socket.on('notifications_read', onSync); socket.on('notifications_deleted', onSync);

  async function openNotification(n) {
    try {
      if (n.postId) return showPost(await api.post(sid(n.postId)));
      if (n.conversationId) { const c = (await api.conversations()).find((x) => sid(x) === sid(n.conversationId)); if (c) return phoneConversation(c); return toast('Cette conversation n’est plus disponible.'); }
      if (n.storyId) return toast('Les stories se regardent dans JexChat.');
      if (n.fromUserId) { const u = await api.user(sid(n.fromUserId)); return showUser({ ...u, id: sid(u) }); }
      toast('Notification lue');
    } catch (e) { toast(e.status === 404 ? 'Ce contenu n’existe plus.' : e.message); }
  }
  function notifsView() {
    open('Notifications', (root, cur) => {
      root.append(h('div', { class: 'sub', text: 'Chargement…' }));
      cur.cleanup = () => notifRows.clear();
      api.notifications().then((list) => {
        if (!root.isConnected) return;
        notifRows.clear();
        if (!list.length) return root.replaceChildren(h('div', { class: 'sub', text: 'Rien de nouveau.' }));
        const box = h('div', null);
        const all = btn('Tout marquer comme lu', () => guarded(all, async () => { const r = await api.readAllNotifications(); setBadge(r?.count || 0); box.replaceChildren(h('div', { class: 'sub', text: 'Rien de nouveau.' })); notifRows.clear(); all.remove(); }), '');
        for (const n of list) {
          const row = h('button', { class: 'row', onclick: async () => {
            if (row.dataset.busy) return; row.dataset.busy = '1';
            try { const r = await api.readNotification(sid(n)); setBadge(Number.isFinite(r?.count) ? r.count : unread - 1); }
            catch (e) { delete row.dataset.busy; return fail(e); } // pas marquée lue : on ne l'affirme pas et on la garde
            dropRow(sid(n));
            openNotification(n);
          } }, h('div', { class: 'grow' }, h('div', { class: 'wrap', text: n.content || n.type }), h('div', { class: 'sub', text: when(n.createdAt) })));
          notifRows.set(sid(n), row); box.append(row);
        }
        root.replaceChildren(h('div', { class: 'actions', style: 'margin-top:0' }, all), box);
      }).catch((e) => root.replaceChildren(h('div', { class: 'sub', text: e.message })));
    });
  }

  // ── jeux ──
  function gamesView() {
    open('Jeux', (root) => {
      const here = ctl.remotes();
      const list = h('div', null, h('h4', { text: 'Morpion, course, tir arcade — 2 joueurs' }),
        ...(here.length ? here.map((r) => h('div', { class: 'row', style: 'cursor:default' }, pill(r.user, 38), h('div', { class: 'grow' }, h('b', { text: r.user.username })),
          h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap' }, ...[['Morpion', 'ttt'], ['Course', 'race'], ['Tir', 'shoot']].map(([l, g]) => { const b = btn(l, () => guarded(b, () => ctl.games.invite(r.id, r.user.username, g)), 'primary'); return b; }))))
          : [h('div', { class: 'sub wrap', text: 'Personne d’autre n’est dans la ville pour l’instant. Touchez un joueur pour l’inviter quand il arrive.' })]),
        h('h4', { text: 'Solo — sans réseau' }),
        h('div', { class: 'actions', style: 'margin-top:0' }, btn('Morpion contre l’ordinateur', () => ctl.solo.start('ttt'), 'primary'), btn('Contre-la-montre', () => ctl.solo.start('race'), 'primary'), btn('Cibles', () => ctl.solo.start('targets'), 'primary')),
        h('p', { class: 'sub wrap', text: 'Les records sont gardés sur cet appareil. Tir arcade : balles en mousse, 3 vies, 60 s ou 5 points. Course : 2 tours, chrono mesuré par le serveur.' }));
      return list;
    });
  }

  // ── personnage ──
  function lookView() {
    open('Mon personnage', () => {
      let look = { ...ctl.look.get() };
      const root = h('div', null);
      const set = (k, v) => { look = { ...look, [k]: v }; ctl.look.set(look); draw(); };
      const seg = (title, items, key) => h('div', null, h('h4', { text: title }), h('div', { class: 'seg' }, ...items.map((label, i) => h('button', { class: 'chip' + (look[key] === i ? ' on' : ''), 'aria-pressed': look[key] === i ? 'true' : 'false', onclick: () => set(key, i), text: label }))));
      const sw = (title, colors, names, key, off = 0) => h('div', null, off ? null : h('h4', { text: title }), h('div', { class: 'seg' }, ...colors.map((c, i) => h('button', { class: 'sw' + (look[key] === i + off ? ' on' : ''), style: `background:${c}`, 'aria-label': names[i], 'aria-pressed': look[key] === i + off ? 'true' : 'false', title: names[i], onclick: () => set(key, i + off) }))));
      function draw() {
        root.replaceChildren(seg('Apparence', ['Masculine', 'Féminine'], 's'), sw('Teint de peau', SKIN, SKIN_NAMES, 'sk'), seg('Coiffure', STYLES, 'h'), sw('Couleur des cheveux', HAIR, HAIR_NAMES, 'hc'), seg('Barbe', BEARDS, 'bd'), sw('Couleur des yeux', EYES, EYE_NAMES, 'ey'),
          seg('Haut', TOP_NAMES.slice(0, 1), 'tc'), sw('Couleur du haut', TOPS, TOP_NAMES.slice(1), 'tc', 1), sw('Pantalon', PANTS, PANT_NAMES, 'pc'), sw('Chaussures', SHOES, SHOE_NAMES, 'sc'), seg('Accessoire', ACCESSORIES, 'ac'),
          h('div', { class: 'actions' }, btn('Aléatoire', () => { const r = (n) => Math.floor(Math.random() * (n + 1)); look = { s: look.s, h: r(7), hc: r(7), sk: r(7), ac: r(5), tc: r(8), pc: r(6), sc: r(5), ey: r(4), bd: look.s ? 0 : r(3) }; ctl.look.set(look); draw(); }), btn('Réinitialiser', () => { look = { s: look.s, h: 0, hc: 0, sk: 3, ac: 0, tc: 0, pc: 0, sc: 0, ey: 0, bd: 0 }; ctl.look.set(look); draw(); })),
          h('p', { class: 'sub wrap', text: 'Les changements sont visibles tout de suite et conservés. Les couleurs du haut viennent de votre profil JexChat.' }));
      }
      draw(); return root;
    });
  }

  // ── utilisateurs bloqués ──
  function blockedView() {
    open('Utilisateurs bloqués', (root) => {
      root.append(h('div', { class: 'sub', text: 'Chargement…' }));
      api.blockedList().then((list) => {
        if (!root.isConnected) return;
        const box = h('div', null);
        const empty = () => h('div', { class: 'sub', text: 'Aucun utilisateur bloqué.' });
        for (const u of list) {
          const row = h('div', { class: 'row', style: 'cursor:default' }, pill(u, 38), h('div', { class: 'grow' }, h('b', { text: u.username })),
            (() => { const b = btn('Débloquer', () => guarded(b, async () => { await api.unblock(sid(u)); row.remove(); if (!box.children.length) box.append(empty()); }, 'Utilisateur débloqué'), ''); return b; })());
          box.append(row);
        }
        root.replaceChildren(...(list.length ? [box] : [empty()]), h('p', { class: 'sub wrap', text: 'Débloquer rend la personne de nouveau visible (recherche, ville, profils). Une conversation ou une relation supprimée n’est pas restaurée.' }));
      }).catch((e) => root.replaceChildren(h('div', { class: 'sub', text: e.message })));
    });
  }

  // ── réglages (mode léger, heure, humeur) ──
  function settingsView() {
    open('Réglages', () => {
      const mood = h('input', { class: 'field', maxlength: 40, placeholder: 'Une humeur, un statut (40 caractères)', value: ctl.getMood() });
      const saveMood = btn('Publier', () => { ctl.setMood(mood.value); toast(mood.value.trim() ? 'Humeur mise à jour' : 'Humeur retirée'); }, 'primary');
      const hour = h('input', { class: 'range', type: 'range', min: 0, max: 24, step: 0.25, value: ctl.getHour() });
      hour.addEventListener('input', () => ctl.setHour(+hour.value));
      const light = h('input', { type: 'checkbox', checked: ctl.isLight() || null, style: 'width:22px;height:22px' });
      light.addEventListener('change', () => ctl.setLight(light.checked));
      return h('div', null, h('h4', { text: 'Mon humeur' }), h('div', { style: 'display:flex;gap:8px' }, mood, saveMood),
        h('h4', { text: 'Personnage et confidentialité' }), h('button', { class: 'row', onclick: lookView }, h('div', { class: 'grow', text: 'Mon personnage' })), h('button', { class: 'row', onclick: blockedView }, h('div', { class: 'grow', text: 'Utilisateurs bloqués' })),
        h('h4', { text: 'Heure de la journée' }), hour,
        h('h4', { text: 'Performances' }), h('label', { class: 'row', style: 'cursor:pointer' }, light, h('div', { class: 'grow', text: 'Mode graphique léger' })),
        h('p', { class: 'sub', style: 'white-space:normal', text: 'Réduit la résolution, les ombres et les effets. Activé automatiquement si l’appareil peine.' }),
        h('p', { class: 'sub', style: 'white-space:normal', text: 'Si votre statut en ligne est masqué dans JexChat, vous voyez la ville sans y être visible.' }));
    });
  }

  document.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
    const a = b.dataset.act;
    if (a === 'search') searchView((u) => showUser(u)); else if (a === 'map') mapView(); else if (a === 'phone') phoneHome(); else if (a === 'notifs') notifsView(); else if (a === 'settings') settingsView();
  }));
  $('#mood-chip').addEventListener('click', settingsView);

  return { toast, showUser, openBrowser: phoneBrowser, openLook: lookView, showPost, open, close, isOpen: () => stack.length > 0, setMoodLabel(t) { $('#mood-chip').textContent = t || 'Dire quelque chose…'; }, openConversation: phoneConversation };
}
