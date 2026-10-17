// city-ui.js — JexCity : commandes flottantes, panneau contextuel, cartes, téléphone, recherche, carte.
// Tout le texte venant du réseau est inséré avec textContent (jamais innerHTML) ; les liens et médias sont limités à https.
import * as G from './city-geo.js';
import { api, postText, safeHttps } from './city-api.js';

const I = {
  back: '<path d="M15 5l-7 7 7 7"/>', close: '<path d="M6 6l12 12M18 6L6 18"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.5-4.5"/>',
  map: '<path d="M9 4L3 6.5v13L9 17l6 3 6-2.5v-13L15 7z"/><path d="M9 4v13M15 7v13"/>',
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
  bell: '<path d="M6 16V11a6 6 0 0112 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 004 0"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"/>',
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
        acts.append(btn('Inviter à discuter', (e) => guarded(e.currentTarget, () => api.invite(id), 'Invitation envoyée')));
        const mb = btn(muted.has(id) ? 'Réactiver les invitations' : 'Couper les invitations', (e) => guarded(e.currentTarget, async () => {
          if (muted.has(id)) { await api.unmute(id); muted.delete(id); } else { await api.mute(id); muted.add(id); }
          mb.textContent = muted.has(id) ? 'Réactiver les invitations' : 'Couper les invitations';
        }, 'Réglage enregistré'));
        acts.append(mb);
        acts.append(btn('Bloquer', (e) => { if (confirm(`Bloquer ${u.username} ? Vous ne vous verrez plus dans la ville ni dans JexChat.`)) guarded(e.currentTarget, async () => { await api.block(id); ctl.removeRemote(id); close(); }, 'Utilisateur bloqué'); }, 'danger'));
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
    // Médias : image, vidéo lisible dans la carte (https uniquement) ; en cas d'échec de chargement, repli sur un lien.
    const mediaLink = () => h('a', { href: media, target: '_blank', rel: 'noopener noreferrer', class: 'sub', text: 'Ouvrir le média' });
    const fallback = (el) => () => { if (el.parentNode) el.replaceWith(mediaLink()); };
    if (media && mt === 'image') { const im = h('img', { src: media, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }); im.addEventListener('error', fallback(im), { once: true }); card.append(im); }
    else if (media && mt === 'video') {
      const v = h('video', { src: media, controls: true, playsinline: true, preload: 'metadata', referrerpolicy: 'no-referrer', 'aria-label': 'Vidéo de la publication' });
      v.addEventListener('error', fallback(v), { once: true }); card.append(v);
    }
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
      const W = 256, Hh = 784, S = 2, cv = h('canvas', { class: 'map', width: W, height: Hh }), c = cv.getContext('2d');
      const X = (x) => (x - G.TOWN.x0) * S, Z = (z) => (z - G.TOWN.z0) * S;
      const base = document.createElement('canvas'); base.width = W; base.height = Hh; const b = base.getContext('2d');
      b.fillStyle = '#dcd3bd'; b.fillRect(0, 0, W, Hh);
      b.fillStyle = '#5f9ab8'; b.beginPath();
      for (let z = G.TOWN.z0; z <= G.TOWN.z1; z += 4) b.lineTo(X(G.canalX(z) - G.halfW(z)), Z(z));
      for (let z = G.TOWN.z1; z >= G.TOWN.z0; z -= 4) b.lineTo(X(G.canalX(z) + G.halfW(z)), Z(z));
      b.fill();
      b.fillStyle = '#b5553b';
      for (const q of ctl.layout.buildings) {
        b.beginPath();
        [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([sx, sz], i) => { const x = q.cx + q.ax[0] * q.hx * sx + q.az[0] * q.hz * sz, z = q.cz + q.ax[1] * q.hx * sx + q.az[1] * q.hz * sz; i ? b.lineTo(X(x), Z(z)) : b.moveTo(X(x), Z(z)); });
        b.closePath(); b.fill();
      }
      b.fillStyle = '#efe6cf'; for (const br of G.BRIDGES) { const f = G.frame(br.z); b.fillRect(X(f.p[0] - G.bridgeSpan(br.z)), Z(br.z) - 5, G.bridgeSpan(br.z) * 2 * S, 10); }
      const draw = () => {
        c.drawImage(base, 0, 0);
        for (const r of ctl.remotes()) { c.fillStyle = '#fff'; c.strokeStyle = '#1d3550'; c.lineWidth = 2; c.beginPath(); c.arc(X(r.x), Z(r.z), 5, 0, 7); c.fill(); c.stroke(); }
        const s = ctl.self(); c.fillStyle = '#f0b463'; c.strokeStyle = '#2a1d08'; c.lineWidth = 2.5; c.beginPath(); c.arc(X(s.x), Z(s.z), 7, 0, 7); c.fill(); c.stroke();
      };
      draw(); const iv = setInterval(draw, 400); cur.cleanup = () => clearInterval(iv);
      cv.addEventListener('click', (e) => { const r = cv.getBoundingClientRect(); ctl.walkTo(G.TOWN.x0 + ((e.clientX - r.left) / r.width) * (G.TOWN.x1 - G.TOWN.x0), G.TOWN.z0 + ((e.clientY - r.top) / r.height) * (G.TOWN.z1 - G.TOWN.z0)); toast('En route'); });
      const places = ctl.landmarks().filter((l) => G.inTown(l.pos.x, l.pos.z));
      return h('div', null, cv, h('div', { class: 'sub', style: 'text-align:center;margin-top:6px', text: 'Touchez la carte pour vous y rendre' }),
        ...(places.length ? [h('h4', { text: 'Lieux' }), ...places.map((l) => h('button', { class: 'row', onclick: () => { ctl.walkTo(l.pos.x, l.pos.z); close(); } }, h('div', { class: 'grow', text: l.name })))] : []));
    });
  }

  // ── téléphone ──
  const myId = me.id;
  function phoneHome() {
    open('Téléphone', () => {
      const app = (icon, label, color, fn) => h('button', { class: 'app', onclick: fn }, h('i', { style: `background:${color}`, html: null }), label);
      const mk = (icon, label, color, fn) => { const b = app(icon, label, color, fn); b.firstChild.innerHTML = svg(icon); return b; };
      return h('div', null, h('div', { class: 'apps' },
        mk('chat', 'JexChat', '#6C63FF', phoneChats), mk('globe', 'Navigateur', '#2f7fb8', phoneBrowser), mk('invite', 'Appel', '#3f9a6a', phoneCall)),
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
  function phoneBrowser() {
    open('Navigateur', () => {
      const input = h('input', { class: 'field', type: 'url', placeholder: 'https://…', inputmode: 'url', autocomplete: 'off' });
      const go = () => {
        let u; try { u = new URL(/^[a-z]+:\/\//i.test(input.value.trim()) ? input.value.trim() : 'https://' + input.value.trim()); } catch (_) { return toast('Adresse invalide.'); }
        if (u.protocol !== 'https:') return toast('Seules les adresses https sont autorisées.');
        window.open(u.href, '_blank', 'noopener,noreferrer');
      };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
      return h('div', null, h('div', { style: 'display:flex;gap:8px' }, input, btn('Ouvrir', go, 'primary')),
        h('p', { class: 'sub', text: 'Pour votre sécurité, les sites s’ouvrent dans un nouvel onglet (https uniquement). Ils ne peuvent pas s’afficher dans la ville.' }));
    });
  }
  function phoneCall() {
    searchView((u) => open(u.username, () => h('div', null,
      h('div', { class: 'row', style: 'cursor:default' }, pill(u, 52), h('div', { class: 'grow' }, h('b', { text: u.username }))),
      h('p', { class: 'sub', text: 'Envoie une invitation privée à ouvrir une conversation écrite. Personne d’autre n’en est informé.' }),
      (() => { const b = btn('Inviter à discuter', () => guarded(b, async () => { await api.invite(sid(u)); back(); }, 'Invitation envoyée'), 'primary'); return h('div', { class: 'actions' }, b); })())), { titleText: 'Appel — inviter' });
  }

  // ── notifications ──
  let unread = 0;
  function setBadge(n) { unread = Math.max(0, n); const b = $('#notif-badge'); b.hidden = unread === 0; b.textContent = unread > 9 ? '9+' : String(unread); }
  api.notifCount().then((r) => setBadge(r.count || 0)).catch(() => {});
  socket.on('notification', (n) => { setBadge(unread + 1); toast(n?.content ? String(n.content).slice(0, 80) : 'Nouvelle notification'); });
  function notifsView() {
    open('Notifications', (root) => {
      root.append(h('div', { class: 'sub', text: 'Chargement…' }));
      api.notifications().then((list) => {
        if (!root.isConnected) return;
        root.replaceChildren(...(list.length ? list.map((n) => h('button', { class: 'row', onclick: async () => {
          api.readNotification(sid(n)); setBadge(unread - 1);
          if (n.conversationId) { try { const convs = await api.conversations(); const c = convs.find((x) => sid(x) === sid(n.conversationId)); if (c) return phoneConversation(c); } catch (e) { fail(e); } }
          toast('Notification lue');
        } }, h('div', { class: 'grow' }, h('div', { text: n.content || n.type }), h('div', { class: 'sub', text: when(n.createdAt) })))) : [h('div', { class: 'sub', text: 'Rien de nouveau.' })]));
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

  return { toast, showUser, showPost, open, close, isOpen: () => stack.length > 0, setMoodLabel(t) { $('#mood-chip').textContent = t || 'Dire quelque chose…'; }, openConversation: phoneConversation };
}
