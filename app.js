/* Jexchat — moteur front (design jexchat-3, backend Jexchatv9 réel) */
'use strict';

const SAVED_ACCOUNTS_KEY = 'jx_saved_accounts';
const SESSION_TOKEN_KEY = 'jx_session_token';
const MSG_LIMIT = 30;

const state = {
  me: null,
  token: null,
  conversations: [],
  currentConvId: null,
  messages: {},
  hasMoreMessages: true,
  onlineUsers: new Set(),
  typing: {},
  socket: null,
  notifCount: 0,
  replyTo: null,
  feed: { skip: 0, hasMore: true, loading: false },
  postCache: new Map(),
  userCache: new Map(),
  blocked: new Set(),
};

/* ================= API ================= */
async function api(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.token) headers['X-Session-Token'] = state.token;
  const opts = { method, headers, credentials: 'include' };
  if (body !== undefined && method !== 'GET') opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Erreur réseau.'), { status: res.status });
  return data;
}

/* ================= Icons (thin outline, matches jexchat-3) ================= */
const ICONS = {
  home: '<path d="M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/>',
  msg: '<path d="M4 4h16v12H7l-3 4V4Z"/>',
  bell: '<path d="M18 15.4V11a6 6 0 1 0-12 0v4.4c0 .5-.2 1-.5 1.3L4 18h16l-1.5-1.3c-.3-.4-.5-.8-.5-1.3Z"/><path d="M9.5 20a2.5 2.5 0 0 0 5 0"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-6 8-6s8 2 8 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  create: '<rect x="3" y="3" width="18" height="18" rx="5"/><path d="M12 8v8M8 12h8"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
  back: '<path d="M15 18l-6-6 6-6"/>',
  more: '<circle cx="6" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18" cy="12" r="1.3"/>',
  send: '<path d="M4 20l16-8L4 4v6l10 2-10 2v6Z"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  chev: '<path d="M9 6l6 6-6 6"/>',
  grid: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>',
  image: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="M21 16l-5-5L5 21"/>',
  video: '<rect x="3" y="5" width="14" height="14" rx="2"/><path d="M17 10l4-2.5v9L17 14"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.4l2-2a5 5 0 0 0-7-7l-1.2 1.1"/><path d="M14 11a5 5 0 0 0-7.5-.4l-2 2a5 5 0 0 0 7 7l1.1-1.1"/>',
  heart: '<path d="M12 20.5l-1.4-1.3C5.4 14.9 2 11.9 2 8.3 2 5.3 4.4 3 7.4 3c1.7 0 3.4.8 4.6 2.1C13.2 3.8 14.9 3 16.6 3c3 0 5.4 2.3 5.4 5.3 0 3.6-3.4 6.6-8.6 11l-1.4 1.2Z"/>',
  share: '<path d="M4 12v6a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-6M16 6l-4-4-4 4M12 2v14"/>',
  eye: '<circle cx="12" cy="12" r="3"/><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/>',
  reply: '<path d="M9 14L4 9l5-5M4 9h11a5 5 0 0 1 5 5v5"/>',
  edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
  pin: '<path d="M12 17v4M8 3h8l-1 8h2l-4.5 8-.5-6H8l1-8Z"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  flag: '<path d="M4 22V3M4 4h13l-2.5 4L17 12H4"/>',
  smile: '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><path d="M9 9h.01M15 9h.01"/>',
  bg: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
};
function icon(name, size = 22) {
  return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
}
function paintIcons(root = document) {
  root.querySelectorAll('i[data-ic]').forEach((el) => {
    const name = el.getAttribute('data-ic');
    el.outerHTML = icon(name);
  });
}

/* ================= Avatars ================= */
function initials(username) { return (username || '?').substring(0, 2).toUpperCase(); }
function avatarStyle(identity) {
  if (identity && identity.colorA) return `background:linear-gradient(150deg,${identity.colorA},${identity.colorB || identity.colorA})`;
  const h = hashStr((identity && identity.seed) || '');
  const pal = [['#ff6b6b', '#c92a5b'], ['#ffa94d', '#e8590c'], ['#38d9a9', '#0ca678'], ['#4dabf7', '#1864ab'], ['#748ffc', '#4338ca'], ['#e599f7', '#9c36b5']];
  const [c1, c2] = pal[h % pal.length];
  return `background:linear-gradient(150deg,${c1},${c2})`;
}
function hashStr(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; }
function avatarHtml(user, size = 'md') {
  const name = user?.username || '?';
  return `<div class="avatar avatar-${size}" style="${avatarStyle(user?.identity || { seed: name })}">${escText(initials(name))}</div>`;
}
function meshBg(seed) {
  const h = hashStr(seed || '');
  const h1 = h % 360, h2 = (h1 + 50 + (h >> 4) % 50) % 360, h3 = (h1 + 190 + (h >> 6) % 50) % 360;
  return `radial-gradient(130% 110% at ${15 + (h % 20)}% 10%, hsl(${h1} 88% 66%), transparent 58%),` +
    `radial-gradient(120% 100% at 85% ${20 + (h >> 2) % 30}%, hsl(${h2} 82% 56%), transparent 55%),` +
    `radial-gradient(150% 130% at 45% 105%, hsl(${h3} 70% 32%), transparent 60%),` +
    `linear-gradient(165deg, hsl(${h1} 25% 18%), hsl(${h3} 30% 10%))`;
}

/* ================= Utils ================= */
function escText(str) {
  const d = document.createElement('div'); d.textContent = str ?? ''; return d.innerHTML;
}
function linkify(html) {
  return html.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
}
function formatTime(d) { return new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); }
function formatDay(d) {
  const dt = new Date(d), now = new Date();
  const diff = Math.floor((now - dt) / 86400000);
  if (diff === 0) return "Aujourd'hui";
  if (diff === 1) return 'Hier';
  return dt.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}
function formatRelative(d) {
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return "à l'instant";
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
  if (s < 604800) return `il y a ${Math.floor(s / 86400)} j`;
  return new Date(d).toLocaleDateString('fr-FR');
}
function formatLastSeen(d) { return d ? `vu ${formatRelative(d)}` : 'hors ligne'; }
function debounce(fn, delay) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), delay); }; }
function toast(msg) {
  const wrap = document.getElementById('toastwrap');
  const t = document.createElement('div'); t.className = 'toastmsg'; t.textContent = msg;
  wrap.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 250); }, 2600);
}

/* ================= Theme ================= */
function applyTheme(theme) { document.documentElement.setAttribute('data-theme', theme === 'dark' ? 'dark' : 'light'); }
function applyAccent(color) {
  if (!color) return;
  document.documentElement.style.setProperty('--blue2', color);
}

/* ================= Navigation ================= */
const PROTECTED = ['feed', 'explore', 'messages', 'chat', 'notifs', 'profile', 'editprofile', 'postdetail', 'settings'];
function show(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
  document.querySelectorAll('[data-nav]').forEach((b) => b.classList.toggle('off', b.dataset.nav !== id));
  const isAuthFlow = id === 'auth' || id === 'accounts';
  document.querySelector('.topbar').style.display = id === 'feed' ? '' : 'none';
  document.getElementById('bottomnav').style.display = isAuthFlow ? 'none' : '';
  document.getElementById('sidebar').style.display = isAuthFlow ? 'none' : '';
  document.getElementById('rightpanel').style.display = isAuthFlow ? 'none' : '';
  window.scrollTo(0, 0);
  routeEnter(id);
}
function routeEnter(id) {
  if (id === 'feed' && !state._feedLoaded) loadFeed(true);
  if (id === 'explore' && !state._exploreLoaded) loadExplore();
  if (id === 'messages') loadConversations();
  if (id === 'notifs') loadNotifications();
  if (id === 'profile' && !state._profileTarget) openProfile(state.me.id);
}
document.addEventListener('click', (e) => {
  const nav = e.target.closest('[data-nav]');
  if (nav) { e.preventDefault(); show(nav.dataset.nav); }
});

/* ================= Overlays ================= */
function openOverlay(id) { document.getElementById(id).classList.add('on'); }
function closeOverlay(id) { document.getElementById(id).classList.remove('on'); }
document.querySelectorAll('.overlay').forEach((o) => {
  o.addEventListener('click', (e) => { if (e.target === o) o.classList.remove('on'); });
});
document.addEventListener('click', (e) => {
  const c = e.target.closest('[data-close]');
  if (c) closeOverlay(c.closest('.overlay').id);
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') document.querySelectorAll('.overlay.on').forEach((o) => o.classList.remove('on')); });

/* ================= Saved accounts (local device only) ================= */
function getSavedAccounts() { try { return JSON.parse(localStorage.getItem(SAVED_ACCOUNTS_KEY) || '[]'); } catch { return []; } }
function saveAccount(user, token) {
  const accs = getSavedAccounts().filter((a) => a.id !== user.id);
  accs.unshift({ id: user.id, username: user.username, identity: user.identity, token });
  if (accs.length > 5) accs.splice(5);
  localStorage.setItem(SAVED_ACCOUNTS_KEY, JSON.stringify(accs));
}
function removeSavedAccount(id) { localStorage.setItem(SAVED_ACCOUNTS_KEY, JSON.stringify(getSavedAccounts().filter((a) => a.id !== id))); }
function renderAccounts() {
  const accs = getSavedAccounts();
  const list = document.getElementById('accList');
  const authBtn = document.getElementById('to-accounts');
  if (!accs.length) { authBtn.classList.add('hidden'); return; }
  authBtn.classList.remove('hidden');
  list.innerHTML = accs.map((a) => `
    <div class="conv" role="button" tabindex="0" data-acc="${a.id}">
      ${avatarHtml(a, 'sm')}
      <div class="body" style="border-bottom:none"><div class="top"><b>${escText(a.username)}</b></div></div>
    </div>`).join('');
}
document.getElementById('accList').addEventListener('click', (e) => {
  const row = e.target.closest('[data-acc]'); if (!row) return;
  const acc = getSavedAccounts().find((a) => a.id === row.dataset.acc);
  if (acc) openQuickLogin(acc);
});
function openQuickLogin(acc) {
  document.getElementById('ql-avatar').outerHTML = avatarHtml(acc).replace('avatar-md', 'avatar-md').replace('class="avatar', 'id="ql-avatar" class="avatar');
  document.getElementById('ql-name').textContent = acc.username;
  document.getElementById('ql-pass').value = '';
  document.getElementById('ql-err').textContent = '';
  openOverlay('quicklogin');
  document.getElementById('ql-submit').onclick = async () => {
    const password = document.getElementById('ql-pass').value;
    if (!password) return;
    try {
      const data = await api('POST', '/api/auth/login', { username: acc.username, password });
      await onLoginSuccess(data);
      closeOverlay('quicklogin');
    } catch (err) { document.getElementById('ql-err').textContent = err.message; }
  };
}
document.getElementById('acc-other').addEventListener('click', () => show('auth'));
document.getElementById('to-accounts').addEventListener('click', () => { renderAccounts(); show('accounts'); });

/* ================= Auth ================= */
document.querySelectorAll('[data-authview]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.authview').forEach((v) => v.classList.remove('on'));
    document.getElementById('v-' + btn.dataset.authview).classList.add('on');
    document.querySelectorAll('.authseg button').forEach((b) => b.classList.remove('on'));
    btn.classList.add('on');
  });
});
document.querySelectorAll('[data-pwtoggle]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const inp = btn.previousElementSibling;
    inp.type = inp.type === 'password' ? 'text' : 'password';
  });
});

async function onLoginSuccess(data) {
  state.me = data.user;
  state.token = data.token;
  localStorage.setItem(SESSION_TOKEN_KEY, data.token);
  saveAccount(data.user, data.token);
  applyTheme(data.user.settings?.theme);
  applyAccent(data.user.settings?.accentColor);
  await boot();
}

document.getElementById('l-submit').addEventListener('click', async () => {
  const username = document.getElementById('l-user').value.trim();
  const password = document.getElementById('l-pass').value;
  const err = document.getElementById('l-err'); err.textContent = '';
  if (!username || !password) { err.textContent = 'Remplissez tous les champs.'; return; }
  const btn = document.getElementById('l-submit'); btn.disabled = true;
  try {
    const data = await api('POST', '/api/auth/login', { username, password });
    await onLoginSuccess(data);
  } catch (e) { err.textContent = e.message; } finally { btn.disabled = false; }
});
document.getElementById('r-submit').addEventListener('click', async () => {
  const username = document.getElementById('r-user').value.trim();
  const password = document.getElementById('r-pass').value;
  const confirm = document.getElementById('r-conf').value;
  const err = document.getElementById('r-err'); err.textContent = '';
  if (!username || !password) { err.textContent = 'Remplissez tous les champs.'; return; }
  if (password !== confirm) { err.textContent = 'Les mots de passe ne correspondent pas.'; return; }
  const btn = document.getElementById('r-submit'); btn.disabled = true;
  try {
    const data = await api('POST', '/api/auth/register', { username, password });
    await onLoginSuccess(data);
  } catch (e) { err.textContent = e.message; } finally { btn.disabled = false; }
});

/* ================= Boot ================= */
async function boot() {
  document.getElementById('to-accounts').classList.add('hidden');
  initSocket();
  await Promise.all([loadBlocked()]);
  renderMe();
  show('feed');
}
function renderMe() {
  document.querySelectorAll('[data-me-avatar]').forEach((el) => { el.outerHTML = avatarHtml(state.me, 'sm').replace('class="avatar', 'data-me-avatar class="avatar'); });
}
async function loadBlocked() {
  try { const list = await api('GET', '/api/users/blocked/list'); state.blocked = new Set(list.map((u) => u.id)); } catch {}
}

async function tryResumeSession() {
  const token = localStorage.getItem(SESSION_TOKEN_KEY);
  if (!token) { renderAccounts(); show(getSavedAccounts().length ? 'accounts' : 'auth'); return; }
  state.token = token;
  try {
    const me = await api('GET', '/api/auth/me');
    state.me = me;
    applyTheme(me.settings?.theme);
    applyAccent(me.settings?.accentColor);
    await boot();
  } catch {
    localStorage.removeItem(SESSION_TOKEN_KEY);
    state.token = null;
    renderAccounts();
    show(getSavedAccounts().length ? 'accounts' : 'auth');
  }
}

/* ================= Socket.IO ================= */
function initSocket() {
  if (typeof io === 'undefined') return;
  if (state.socket?.connected) return;
  const socket = io({ auth: { token: state.token }, transports: ['websocket', 'polling'] });
  state.socket = socket;

  socket.on('connect_error', (err) => console.warn('[Socket]', err.message));

  socket.on('new_message', (msg) => handleIncomingMessage(msg));
  socket.on('message_edited', (msg) => updateMessageInThread(msg));
  socket.on('message_deleted', ({ messageId }) => removeMessageFromThread(messageId));
  socket.on('message_reaction', (msg) => updateMessageInThread(msg));
  socket.on('message_pinned', ({ messageId, pinned }) => {
    const el = document.querySelector(`[data-mid="${messageId}"] .pin`);
    if (el) el.classList.toggle('hidden', !pinned);
  });
  socket.on('messages_seen', ({ conversationId }) => { if (conversationId === state.currentConvId) refreshSeenTicks(); });
  socket.on('user_typing', ({ userId, username, conversationId }) => {
    if (conversationId === state.currentConvId) { state.typing[userId] = username; renderTyping(); }
  });
  socket.on('user_stopped_typing', ({ userId, conversationId }) => {
    if (conversationId === state.currentConvId) { delete state.typing[userId]; renderTyping(); }
  });
  socket.on('user_online', ({ userId }) => { state.onlineUsers.add(userId); refreshPresence(userId, true); });
  socket.on('user_offline', ({ userId, lastSeen }) => { state.onlineUsers.delete(userId); refreshPresence(userId, false, lastSeen); });
  socket.on('conversation_deleted', ({ conversationId }) => {
    state.conversations = state.conversations.filter((c) => c.id !== conversationId);
    renderConvList();
    if (state.currentConvId === conversationId) show('messages');
  });
  socket.on('group_created', (conv) => { if (!state.conversations.find((c) => c.id === conv.id)) { state.conversations.unshift(conv); renderConvList(); } });
  socket.on('group_updated', () => loadConversations());
  socket.on('removed_from_group', ({ conversationId }) => {
    state.conversations = state.conversations.filter((c) => c.id !== conversationId);
    renderConvList();
  });
  socket.on('background_changed', ({ conversationId, background }) => {
    const c = state.conversations.find((x) => x.id === conversationId);
    if (c) c.background = background;
    if (state.currentConvId === conversationId) applyChatBackground(background);
  });
  socket.on('notification', () => { state.notifCount++; renderNotifBadge(); });
  socket.on('notifications_read', () => refreshNotifCount());
  socket.on('notifications_deleted', () => refreshNotifCount());
  socket.on('post_created', (post) => { state.postCache.set(post.id, post); if (document.getElementById('feed').classList.contains('active')) prependPost(post); });
  socket.on('post_liked', ({ postId, likesCount }) => {
    document.querySelectorAll(`[data-postid="${postId}"] .plikes`).forEach((el) => { el.textContent = `${likesCount} mention${likesCount === 1 ? '' : 's'} J'aime`; });
  });
  socket.on('post_deleted', ({ postId }) => { document.querySelectorAll(`[data-postid="${postId}"]`).forEach((el) => el.closest('.post')?.remove()); });
  socket.on('account_deleted', () => {});
}

/* ================= Notifications badge ================= */
async function refreshNotifCount() {
  try { const { count } = await api('GET', '/api/notifications/count'); state.notifCount = count; renderNotifBadge(); } catch {}
}
function renderNotifBadge() {
  document.querySelectorAll('[data-notifbadge]').forEach((el) => {
    el.classList.toggle('hidden', !state.notifCount);
    el.textContent = state.notifCount > 9 ? '9+' : String(state.notifCount);
  });
}
setInterval(() => { if (state.me) refreshNotifCount(); }, 25000);

/* ================= FEED ================= */
async function loadFeed(reset) {
  if (reset) { state.feed = { skip: 0, hasMore: true, loading: false }; document.getElementById('feedList').innerHTML = ''; }
  if (state.feed.loading || !state.feed.hasMore) return;
  state.feed.loading = true;
  try {
    const posts = await api('GET', `/api/posts?skip=${state.feed.skip}&limit=10`);
    posts.forEach((p) => state.postCache.set(p.id, p));
    state.feed.skip += posts.length;
    state.feed.hasMore = posts.length === 10;
    const list = document.getElementById('feedList');
    if (!posts.length && reset) list.innerHTML = '<div class="empty">Aucune publication pour le moment. Soyez le premier à publier !</div>';
    posts.forEach((p) => list.appendChild(renderPostEl(p)));
    document.getElementById('feedMore').classList.toggle('hidden', !state.feed.hasMore);
    state._feedLoaded = true;
  } catch (e) { toast(e.message); } finally { state.feed.loading = false; }
  if (reset) loadOnlineStrip();
}
document.getElementById('feedMore').addEventListener('click', () => loadFeed(false));
function prependPost(post) {
  const list = document.getElementById('feedList');
  list.insertBefore(renderPostEl(post), list.firstChild);
}

function renderPostEl(p) {
  const wrap = document.createElement('div');
  wrap.className = 'post';
  wrap.dataset.postid = p.id;
  const verified = p.author?.roles?.some((r) => ['ADMIN', 'OWNER', 'MODERATOR'].includes(r));
  let mediaHtml = '';
  if (p.mediaType === 'image') mediaHtml = `<div class="pmedia real photo"><img src="${escText(p.mediaUrl)}" loading="lazy" alt="" referrerpolicy="no-referrer" onerror="jxMediaFallback(this,'${escText(p.mediaUrl).replace(/'/g, '&#39;')}')"></div>`;
  else if (p.mediaType === 'video') mediaHtml = renderVideoEmbed(p.mediaUrl);
  else if (p.mediaType === 'link') mediaHtml = `<a class="plink" href="${escText(p.mediaUrl)}" target="_blank" rel="noopener">${escText(p.mediaUrl)}</a>`;

  let sharedHtml = '';
  if (p.sharedFrom) {
    const s = p.sharedFrom;
    sharedHtml = `<div class="shared-box">
      <div class="phead"><div class="who">${avatarHtml(s.author, 'sm')}<div><b>${escText(s.deleted ? 'Publication supprimée' : (s.author?.username || 'Utilisateur'))}</b></div></div></div>
      ${!s.deleted && s.mediaType === 'image' ? `<div class="pmedia real photo"><img src="${escText(s.mediaUrl)}" loading="lazy" alt="" referrerpolicy="no-referrer" onerror="jxMediaFallback(this,'${escText(s.mediaUrl).replace(/'/g, '&#39;')}')"></div>` : ''}
      ${!s.deleted && s.content ? `<div class="pcontent">${linkify(escText(s.content))}</div>` : ''}
    </div>`;
  }

  wrap.innerHTML = `
    <div class="phead"><div class="who">${avatarHtml(p.author, 'sm')}
      <div><b data-openprofile="${p.author?.id}" style="cursor:pointer">${escText(p.author?.username || 'Utilisateur')}${verified ? '<svg viewBox="0 0 24 24" width="14" height="14" style="display:inline;vertical-align:middle;margin-left:3px"><circle cx="12" cy="12" r="10" fill="#1e8fff"/><path d="M8 12l3 3 5-6" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>' : ''}</b>
      <small>${formatRelative(p.createdAt)}</small></div></div>
      <button class="tapbtn" aria-label="Options" data-postmenu="${p.id}">${icon('more')}</button>
    </div>
    ${mediaHtml}
    ${sharedHtml}
    ${!p.sharedFrom && p.content ? `<div class="pcontent">${linkify(escText(p.content))}</div>` : (p.sharedFrom && p.content ? `<div class="pcontent">${linkify(escText(p.content))}</div>` : '')}
    <div class="pactions"><div class="left">
      <button class="tapbtn ${p.likedByMe ? 'liked' : ''}" aria-label="J'aime" data-like="${p.id}">${icon('heart')}</button>
      <button class="tapbtn" aria-label="Partager" data-share="${p.id}">${icon('share')}</button>
    </div></div>
    <div class="plikes">${p.likesCount || 0} mention${p.likesCount === 1 ? '' : 's'} J'aime</div>
  `;
  return wrap;
}
function jxMediaFallback(el, url) {
  const box = el.closest('.pmedia') || el.parentElement;
  const safe = escText(url || '');
  const html = `<a class="medialink" href="${safe}" target="_blank" rel="noopener">${icon('link', 20)}<span>Média indisponible — ouvrir le lien original</span></a>`;
  if (box && box.classList.contains('pmedia')) box.outerHTML = html;
  else el.outerHTML = html;
}
window.jxMediaFallback = jxMediaFallback;

function renderVideoEmbed(url) {
  const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/);
  if (yt) return `<div class="pmedia real video"><iframe src="https://www.youtube-nocookie.com/embed/${yt[1]}" allowfullscreen></iframe></div>`;
  const vimeo = url.match(/vimeo\.com\/(\d+)/);
  if (vimeo) return `<div class="pmedia real video"><iframe src="https://player.vimeo.com/video/${vimeo[1]}" allowfullscreen></iframe></div>`;
  return `<div class="pmedia real video"><video src="${escText(url)}" controls preload="metadata" referrerpolicy="no-referrer" onerror="jxMediaFallback(this,'${escText(url).replace(/'/g, '&#39;')}')"></video></div>`;
}

document.getElementById('feedList').addEventListener('click', async (e) => {
  const likeBtn = e.target.closest('[data-like]');
  if (likeBtn) {
    if (!state.me) return;
    const id = likeBtn.dataset.like;
    likeBtn.classList.toggle('liked');
    try {
      const r = await api('POST', `/api/posts/${id}/like`);
      likeBtn.classList.toggle('liked', r.liked);
      likeBtn.closest('.post').querySelector('.plikes').textContent = `${r.likesCount} mention${r.likesCount === 1 ? '' : 's'} J'aime`;
    } catch (err) { toast(err.message); }
    return;
  }
  const shareBtn = e.target.closest('[data-share]');
  if (shareBtn) { openSharePicker(shareBtn.dataset.share); return; }
  const menuBtn = e.target.closest('[data-postmenu]');
  if (menuBtn) { openPostMenu(menuBtn.dataset.postmenu); return; }
  const prof = e.target.closest('[data-openprofile]');
  if (prof) { openProfile(prof.dataset.openprofile); show('profile'); return; }
});

function openPostMenu(postId) {
  const post = state.postCache.get(postId);
  const mine = post && state.me && post.author?.id === state.me.id;
  const isMod = state.me?.roles?.some((r) => ['ADMIN', 'MODERATOR', 'OWNER'].includes(r));
  const rows = [];
  if (mine || isMod) rows.push(`<button class="arow danger" data-act="delete-post" data-id="${postId}">${icon('trash', 20)}Supprimer la publication</button>`);
  rows.push(`<button class="arow" data-act="copy-link" data-id="${postId}">${icon('copy', 20)}Copier le lien</button>`);
  if (!mine) rows.push(`<button class="arow danger" data-act="report-post" data-id="${postId}">${icon('flag', 20)}Signaler</button>`);
  document.getElementById('sheetBody').innerHTML = rows.join('');
  openOverlay('sheet');
}
document.getElementById('sheetBody').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-act]'); if (!btn) return;
  const id = btn.dataset.id;
  closeOverlay('sheet');
  try {
    if (btn.dataset.act === 'delete-post') { await api('DELETE', `/api/posts/${id}`); document.querySelector(`[data-postid="${id}"]`)?.remove(); toast('Publication supprimée'); }
    if (btn.dataset.act === 'copy-link') { await shareOrCopy(`${location.origin}/lapage/${state.postCache.get(id)?.author?.username || ''}/actu/${id}`, 'Publication Jexchat'); }
    if (btn.dataset.act === 'report-post') { await api('POST', '/api/reports', { targetType: 'message', targetId: id, reason: 'Contenu signalé depuis le fil' }); toast('Signalement envoyé'); }
    if (btn.dataset.act === 'delete-msg') { await deleteMessageAction(id); }
    if (btn.dataset.act === 'edit-msg') { startEditMessage(id); }
    if (btn.dataset.act === 'pin-msg') { await togglePinMessage(id); }
    if (btn.dataset.act === 'reply-msg') { setReplyTo(id); }
    if (btn.dataset.act === 'report-msg') { await api('POST', '/api/reports', { targetType: 'message', targetId: id, reason: 'Message signalé' }); toast('Signalement envoyé'); }
  } catch (err) { toast(err.message); }
});
async function shareOrCopy(url, title) {
  if (navigator.share) { try { await navigator.share({ title, url }); return; } catch { return; } }
  if (navigator.clipboard) { await navigator.clipboard.writeText(url); toast('Lien copié'); return; }
  toast(url);
}

/* ================= Composer (publication / story) ================= */
document.getElementById('composer-input').addEventListener('click', () => openPostModal());
document.getElementById('btn-publish').addEventListener('click', () => openPostModal());
document.getElementById('bn-create').addEventListener('click', () => openPostModal());
document.querySelectorAll('[data-compose]').forEach((btn) => btn.addEventListener('click', () => openPostModal(btn.dataset.compose)));

function openPostModal(type) {
  document.getElementById('post-content').value = '';
  document.getElementById('post-desc').value = '';
  document.getElementById('post-url').value = '';
  document.getElementById('post-err').textContent = '';
  const sel = document.getElementById('post-media-type');
  sel.value = type || 'none';
  document.getElementById('post-url-row').style.display = sel.value === 'none' ? 'none' : 'block';
  openOverlay('modal');
}
document.getElementById('post-media-type').addEventListener('change', (e) => {
  document.getElementById('post-url-row').style.display = e.target.value === 'none' ? 'none' : 'block';
});
document.getElementById('post-submit').addEventListener('click', async () => {
  const err = document.getElementById('post-err'); err.textContent = '';
  const mediaType = document.getElementById('post-media-type').value;
  const body = {
    content: document.getElementById('post-content').value.trim(),
    mediaType,
    mediaUrl: mediaType !== 'none' ? document.getElementById('post-url').value.trim() : '',
    description: document.getElementById('post-desc').value.trim(),
  };
  if (!body.content && !body.mediaUrl) { err.textContent = 'La publication ne peut pas être vide.'; return; }
  const btn = document.getElementById('post-submit'); btn.disabled = true;
  try {
    await api('POST', '/api/posts', body);
    closeOverlay('modal');
    toast('Publication partagée');
    if (!document.getElementById('feed').classList.contains('active')) show('feed');
  } catch (e) { err.textContent = e.message; } finally { btn.disabled = false; }
});

/* ================= Online strip ================= */
async function loadOnlineStrip() {
  try {
    const users = await api('GET', '/api/users/online');
    const strip = document.getElementById('onlineStrip');
    strip.innerHTML = `<button class="story" id="story-add">
        <div class="add-ring">${icon('plus', 22)}</div><span>Vous</span></button>` +
      users.filter((u) => u.id !== state.me.id).slice(0, 12).map((u) => `
        <button class="story" data-openprofile2="${u.id}">
          <div class="ring">${avatarHtml(u, 'md').replace('avatar avatar-md', 'fill')}</div><span>${escText(u.username)}</span>
        </button>`).join('');
    document.getElementById('story-add').addEventListener('click', () => openPostModal());
    strip.querySelectorAll('[data-openprofile2]').forEach((b) => b.addEventListener('click', () => { openProfile(b.dataset.openprofile2); show('profile'); }));
  } catch {}
}

/* ================= EXPLORE / SEARCH ================= */
async function loadExplore() {
  state._exploreLoaded = true;
  try {
    const [online, posts] = await Promise.all([api('GET', '/api/users/online'), api('GET', '/api/posts?skip=0&limit=15')]);
    document.getElementById('suggRow').innerHTML = online.filter((u) => u.id !== state.me.id).slice(0, 8).map((u) => `
      <div class="sugg" data-openprofile3="${u.id}">${avatarHtml(u)}<b>${escText(u.username)}</b><small>En ligne</small><button data-msguser="${u.id}">Message</button></div>`).join('') || '<div class="empty" style="padding:10px">Aucun utilisateur en ligne</div>';
    const grid = document.getElementById('exploreGrid');
    grid.innerHTML = '';
    posts.forEach((p) => grid.appendChild(renderTile(p)));
    document.getElementById('rightSugg').innerHTML = online.filter((u) => u.id !== state.me.id).slice(0, 5).map((u) => `
      <div class="rsugg">${avatarHtml(u)}<div class="info"><b>${escText(u.username)}</b><small>En ligne</small></div><button data-msguser="${u.id}">Message</button></div>`).join('');
  } catch (e) { toast(e.message); }
}
function renderTile(p) {
  const btn = document.createElement('button');
  btn.className = 'tile' + (p.mediaType === 'image' ? '' : ' text');
  btn.setAttribute('aria-label', 'Publication');
  if (p.mediaType === 'image') btn.innerHTML = `<img src="${escText(p.mediaUrl)}" loading="lazy" alt="">`;
  else btn.textContent = (p.content || '(sans texte)').slice(0, 80);
  btn.addEventListener('click', () => openPostDetail(p.id));
  return btn;
}
document.addEventListener('click', (e) => {
  const m = e.target.closest('[data-msguser]');
  if (m) startPrivateChat(m.dataset.msguser);
  const p3 = e.target.closest('[data-openprofile3]');
  if (p3 && !e.target.closest('[data-msguser]')) { openProfile(p3.dataset.openprofile3); show('profile'); }
});
async function startPrivateChat(userId) {
  try {
    const conv = await api('POST', '/api/conversations/private', { userId });
    if (!state.conversations.find((c) => c.id === conv.id)) state.conversations.unshift(conv);
    show('messages'); renderConvList();
    openConversationObj(conv);
  } catch (e) { toast(e.message); }
}

const searchInput = document.getElementById('searchInput');
searchInput.addEventListener('input', debounce(async (e) => {
  const q = e.target.value.trim();
  const results = document.getElementById('searchResults');
  if (!q) { results.innerHTML = ''; document.getElementById('suggLabel').classList.remove('hidden'); document.getElementById('suggRow').classList.remove('hidden'); return; }
  document.getElementById('suggLabel').classList.add('hidden');
  document.getElementById('suggRow').classList.add('hidden');
  try {
    const users = await api('GET', `/api/users/search?q=${encodeURIComponent(q)}`);
    results.innerHTML = users.length ? `<div class="searchgrid">${users.map((u) => `
      <div class="sresult" data-openprofile3="${u.id}">
        ${avatarHtml(u)}<b>${escText(u.username)}</b><button data-msguser="${u.id}">Message</button>
      </div>`).join('')}</div>` : '<div class="empty">Aucun résultat</div>';
  } catch (e) { toast(e.message); }
}, 300));

/* ================= MESSAGES LIST ================= */
async function loadConversations() {
  try {
    state.conversations = await api('GET', '/api/conversations');
    renderConvList();
  } catch (e) { toast(e.message); }
}
function renderConvList(filter) {
  const list = document.getElementById('convList');
  let convs = state.conversations;
  if (filter) convs = convs.filter((c) => (c.name || '').toLowerCase().includes(filter.toLowerCase()));
  if (!convs.length) { list.innerHTML = '<div class="empty">Aucune conversation pour le moment.</div>'; return; }
  list.innerHTML = convs.map((c) => {
    const online = c.type === 'private' && c.otherUser && state.onlineUsers.has(c.otherUser.id);
    const last = c.lastMessage;
    const preview = last ? messagePreviewText(last) : 'Aucun message';
    return `<button class="conv" data-conv="${c.id}">
      <div class="avatar" style="${avatarStyle(c.otherUser?.identity || { seed: c.name || c.id })}">${escText(initials(c.otherUser?.username || c.name || 'GR'))}${online ? '<span class="onlinedot"></span>' : ''}</div>
      <div class="body"><div class="top"><b>${escText(c.name)}</b><span>${last ? formatDay(last.createdAt) : ''}${c.unreadCount ? `<span class="unreadn">${c.unreadCount}</span>` : ''}</span></div>
      <div class="prev ${c.unreadCount ? 'unread' : ''}">${escText(preview)}</div></div>
    </button>`;
  }).join('');
}
function messagePreviewText(m) {
  const labels = { image: '📷 Photo', video: '🎬 Vidéo', audio: '🎵 Audio', shared_post: 'a partagé une publication', sticker: 'Sticker', link: '🔗 Lien' };
  return labels[m.type] || m.content || '';
}
document.getElementById('convFilter').addEventListener('input', (e) => renderConvList(e.target.value));
document.getElementById('convList').addEventListener('click', (e) => {
  const row = e.target.closest('[data-conv]'); if (!row) return;
  const conv = state.conversations.find((c) => c.id === row.dataset.conv);
  if (conv) openConversationObj(conv);
});
// Appui long (ou clic droit) sur une conversation : suppression rapide sans
// avoir à l'ouvrir d'abord.
function openConvRowMenu(convId) {
  document.getElementById('sheetBody').innerHTML = `<button class="arow danger" data-act2="delete-conv-row" data-cid="${convId}">${icon('trash', 20)}Supprimer la conversation</button>`;
  openOverlay('sheet');
}
document.getElementById('sheetBody').addEventListener('click', (e) => {
  const b = e.target.closest('[data-act2="delete-conv-row"]'); if (!b) return;
  closeOverlay('sheet');
  deleteConversationAction(b.dataset.cid);
});
(() => {
  const list = document.getElementById('convList');
  let pressTimer;
  list.addEventListener('contextmenu', (e) => {
    const row = e.target.closest('[data-conv]'); if (!row) return;
    e.preventDefault(); openConvRowMenu(row.dataset.conv);
  });
  list.addEventListener('touchstart', (e) => {
    const row = e.target.closest('[data-conv]'); if (!row) return;
    pressTimer = setTimeout(() => openConvRowMenu(row.dataset.conv), 480);
  });
  list.addEventListener('touchend', () => clearTimeout(pressTimer));
  list.addEventListener('touchmove', () => clearTimeout(pressTimer));
})();
document.getElementById('btn-newgroup').addEventListener('click', () => openGroupModal());

/* ================= CHAT ================= */
async function openConversationObj(conv) {
  if (state.currentConvId && state.socket) state.socket.emit('leave_conversation', state.currentConvId);
  state.currentConvId = conv.id;
  state.messages[conv.id] = [];
  state.hasMoreMessages = true;
  state.replyTo = null;
  document.getElementById('replybar').classList.add('hidden');

  document.getElementById('chat-avatar').setAttribute('style', avatarStyle(conv.otherUser?.identity || { seed: conv.id }));
  document.getElementById('chat-avatar').textContent = initials(conv.otherUser?.username || conv.name);
  document.getElementById('chat-name').textContent = conv.name;
  const online = conv.type === 'private' && conv.otherUser && state.onlineUsers.has(conv.otherUser.id);
  document.getElementById('chat-status').textContent = conv.type === 'private'
    ? (online ? 'en ligne' : formatLastSeen(conv.otherUser?.lastSeen))
    : `${conv.members.length} membres`;
  document.getElementById('chat-who').onclick = () => { if (conv.type === 'private' && conv.otherUser) { openProfile(conv.otherUser.id); show('profile'); } };
  document.getElementById('chat-avatar').onclick = document.getElementById('chat-who').onclick;

  applyChatBackground(conv.background);
  document.getElementById('thread').innerHTML = '';
  show('chat');
  state.socket?.emit('join_conversation', conv.id);
  await loadMessages(conv.id, true);
  try { await api('POST', `/api/conversations/${conv.id}/seen`); } catch {}
  const rowEl = document.querySelector(`[data-conv="${conv.id}"] .unreadn`);
  if (rowEl) rowEl.remove();
  const stateConv = state.conversations.find((c) => c.id === conv.id);
  if (stateConv) stateConv.unreadCount = 0;
}
document.getElementById('chat-back').addEventListener('click', () => show('messages'));
document.getElementById('chat-menu').addEventListener('click', () => openConvMenu());

function applyChatBackground(bg) {
  const thread = document.getElementById('thread');
  if (!bg || bg.type === 'none') { thread.style.background = ''; return; }
  if (bg.type === 'color') thread.style.background = bg.value;
  else if (bg.type === 'gradient') thread.style.background = bg.value;
  else if (bg.type === 'image') thread.style.background = `url("${bg.value}") center/cover`;
  else thread.style.background = '';
}

async function loadMessages(convId, reset) {
  if (reset) state.hasMoreMessages = true;
  const before = reset ? null : state.messages[convId]?.[0]?.createdAt;
  try {
    const qs = before ? `?before=${encodeURIComponent(before)}&limit=${MSG_LIMIT}` : `?limit=${MSG_LIMIT}`;
    const msgs = await api('GET', `/api/conversations/${convId}/messages${qs}`);
    const ordered = msgs.slice().reverse();
    if (msgs.length < MSG_LIMIT) state.hasMoreMessages = false;
    state.messages[convId] = [...ordered, ...(state.messages[convId] || [])];
    renderThread(convId, ordered, reset);
  } catch (e) { toast(e.message); }
}
function renderThread(convId, newMsgs, reset) {
  const thread = document.getElementById('thread');
  if (reset) {
    thread.innerHTML = '';
    if (state.hasMoreMessages) thread.appendChild(loadMoreBtn(convId));
    newMsgs.forEach((m) => appendMessageEl(thread, m));
    thread.scrollTop = thread.scrollHeight;
  } else {
    const prevHeight = thread.scrollHeight;
    const btn = thread.querySelector('.loadmore');
    if (btn) btn.remove();
    const frag = document.createDocumentFragment();
    if (state.hasMoreMessages) frag.appendChild(loadMoreBtn(convId));
    newMsgs.forEach((m) => frag.appendChild(buildMessageEl(m)));
    thread.insertBefore(frag, thread.firstChild);
    thread.scrollTop = thread.scrollHeight - prevHeight;
  }
}
function loadMoreBtn(convId) {
  const btn = document.createElement('button');
  btn.className = 'loadmore';
  btn.textContent = 'Charger les messages précédents';
  btn.addEventListener('click', () => loadMessages(convId, false));
  return btn;
}
let lastDaySep = null;
function appendMessageEl(thread, m) { thread.appendChild(buildMessageEl(m)); }
function buildMessageEl(m) {
  const isOut = m.senderId === state.me.id || m.sender?.id === state.me.id;
  const el = document.createElement('div');
  el.className = `bubble ${isOut ? 'out' : 'in'} ${m.deleted ? 'deleted' : ''}`.trim();
  el.dataset.mid = m.id;
  let body = '';
  if (m.replyPreview) body += `<div class="reply">${escText(m.replyPreview.author?.username || '')}: ${escText((m.replyPreview.content || '').slice(0, 60) || '[média]')}</div>`;
  if (m.expired) body += `<i>Message expiré</i>`;
  else if (m.deleted) body += `Message supprimé`;
  else if (m.type === 'shared_post' && m.sharedPost) {
    const sp = m.sharedPost;
    body += `<div class="shared-box" style="margin:0 0 6px">${sp.deleted ? '<div class="pcontent">Publication supprimée</div>' : `
      <div class="phead" style="padding:8px 10px 0">${avatarHtml(sp.author, 'sm')}<div><b style="font-size:12.5px">${escText(sp.author?.username || '')}</b></div></div>
      ${sp.mediaType === 'image' ? `<div class="pmedia real photo" style="border-radius:0"><img src="${escText(sp.mediaUrl)}" alt="" referrerpolicy="no-referrer" onerror="jxMediaFallback(this,'${escText(sp.mediaUrl).replace(/'/g, '&#39;')}')"></div>` : ''}
      <div class="pcontent" style="font-size:13px">${linkify(escText(sp.content || ''))}</div>`}</div>${m.content ? linkify(escText(m.content)) : ''}`;
  } else if (m.type === 'image') body += `<img src="${escText(m.url)}" loading="lazy" alt="" referrerpolicy="no-referrer" onerror="jxMediaFallback(this,'${escText(m.url).replace(/'/g, '&#39;')}')">${m.content ? `<div>${linkify(escText(m.content))}</div>` : ''}`;
  else if (m.type === 'video') body += `<video src="${escText(m.url)}" controls preload="metadata" referrerpolicy="no-referrer" onerror="jxMediaFallback(this,'${escText(m.url).replace(/'/g, '&#39;')}')"></video>${m.content ? `<div>${linkify(escText(m.content))}</div>` : ''}`;
  else if (m.type === 'audio') body += `<audio src="${escText(m.url)}" controls></audio>`;
  else if (m.type === 'link') body += `<a href="${escText(m.url)}" target="_blank" rel="noopener">${escText(m.url)}</a>`;
  else body += linkify(escText(m.content));

  const reacts = (m.reactions || []).length ? `<div class="reacts">${Object.entries(countReactions(m.reactions)).map(([t, n]) => `<span>${reactionEmoji(t)} ${n}</span>`).join('')}</div>` : '';
  const seen = isOut ? (m.seenBy && m.seenBy.length > 1 ? ' ✓✓' : ' ✓') : '';
  const pinBadge = m.pinned ? '<div class="pin">📌 épinglé</div>' : '';
  el.innerHTML = `${pinBadge}${body}${reacts}<time>${escText(formatTime(m.createdAt))}${m.editedAt ? ' · modifié' : ''}${seen}</time>`;
  if (!m.deleted && !m.expired) {
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); openMsgMenu(m, isOut); });
    let pressTimer;
    el.addEventListener('touchstart', () => { pressTimer = setTimeout(() => openMsgMenu(m, isOut), 480); });
    el.addEventListener('touchend', () => clearTimeout(pressTimer));
    el.addEventListener('dblclick', () => openReactionPicker(m.id));
  }
  return el;
}
function countReactions(reactions) { const c = {}; (reactions || []).forEach((r) => { c[r.type] = (c[r.type] || 0) + 1; }); return c; }
function reactionEmoji(t) { return { heart: '❤️', thumbsup: '👍', thumbsdown: '👎', laugh: '😂', wow: '😮', sad: '😢', angry: '😡' }[t] || '👍'; }

function openMsgMenu(m, isOut) {
  const rows = [];
  rows.push(`<button class="arow" data-act="reply-msg" data-id="${m.id}">${icon('reply', 20)}Répondre</button>`);
  if (isOut) rows.push(`<button class="arow" data-act="edit-msg" data-id="${m.id}">${icon('edit', 20)}Modifier</button>`);
  rows.push(`<button class="arow" data-act="pin-msg" data-id="${m.id}">${icon('pin', 20)}${m.pinned ? 'Désépingler' : 'Épingler'}</button>`);
  if (isOut) rows.push(`<button class="arow danger" data-act="delete-msg" data-id="${m.id}">${icon('trash', 20)}Supprimer</button>`);
  if (!isOut) rows.push(`<button class="arow danger" data-act="report-msg" data-id="${m.id}">${icon('flag', 20)}Signaler</button>`);
  document.getElementById('sheetBody').innerHTML = rows.join('');
  openOverlay('sheet');
}
function openReactionPicker(msgId) {
  const types = ['heart', 'thumbsup', 'thumbsdown', 'laugh', 'wow', 'sad', 'angry'];
  document.getElementById('sheetBody').innerHTML = `<div class="reactpick">${types.map((t) => `<button data-react="${t}" data-mid="${msgId}">${reactionEmoji(t)}</button>`).join('')}</div>`;
  openOverlay('sheet');
}
document.getElementById('sheetBody').addEventListener('click', async (e) => {
  const r = e.target.closest('[data-react]'); if (!r) return;
  closeOverlay('sheet');
  try { await api('POST', `/api/messages/${r.dataset.mid}/react`, { type: r.dataset.react }); } catch (err) { toast(err.message); }
});

function setReplyTo(msgId) {
  const m = (state.messages[state.currentConvId] || []).find((x) => x.id === msgId);
  if (!m) return;
  state.replyTo = msgId;
  document.getElementById('replytxt').textContent = `Réponse à : ${(m.content || messagePreviewText(m)).slice(0, 60)}`;
  document.getElementById('replybar').classList.remove('hidden');
  document.getElementById('msgInput').focus();
}
document.getElementById('replyclose').addEventListener('click', () => { state.replyTo = null; document.getElementById('replybar').classList.add('hidden'); });

function startEditMessage(msgId) {
  const m = (state.messages[state.currentConvId] || []).find((x) => x.id === msgId);
  if (!m) return;
  const input = document.getElementById('msgInput');
  input.value = m.content || '';
  input.dataset.editing = msgId;
  input.focus();
}
async function deleteMessageAction(msgId) {
  try { await api('DELETE', `/api/messages/${msgId}`); } catch (e) { toast(e.message); }
}
async function togglePinMessage(msgId) {
  const m = (state.messages[state.currentConvId] || []).find((x) => x.id === msgId);
  try { await api('POST', `/api/messages/${msgId}/pin`, { pinned: !m?.pinned }); } catch (e) { toast(e.message); }
}

function handleIncomingMessage(msg) {
  if (!state.messages[msg.conversationId]) state.messages[msg.conversationId] = [];
  state.messages[msg.conversationId].push(msg);
  if (msg.conversationId === state.currentConvId) {
    const thread = document.getElementById('thread');
    thread.appendChild(buildMessageEl(msg));
    thread.scrollTop = thread.scrollHeight;
    api('POST', `/api/conversations/${msg.conversationId}/seen`).catch(() => {});
  } else {
    const c = state.conversations.find((x) => x.id === msg.conversationId);
    if (c) c.unreadCount = (c.unreadCount || 0) + 1;
  }
  const c = state.conversations.find((x) => x.id === msg.conversationId);
  if (c) { c.lastMessage = { content: msg.content, senderId: msg.senderId, type: msg.type, createdAt: msg.createdAt }; state.conversations = [c, ...state.conversations.filter((x) => x.id !== c.id)]; }
  if (document.getElementById('messages').classList.contains('active')) renderConvList();
}
function updateMessageInThread(msg) {
  const arr = state.messages[msg.conversationId] || [];
  const idx = arr.findIndex((x) => x.id === msg.id);
  if (idx >= 0) arr[idx] = msg;
  const el = document.querySelector(`[data-mid="${msg.id}"]`);
  if (el) el.replaceWith(buildMessageEl(msg));
}
function removeMessageFromThread(msgId) {
  const el = document.querySelector(`[data-mid="${msgId}"]`);
  if (el) el.remove();
}
function refreshSeenTicks() {
  (state.messages[state.currentConvId] || []).forEach((m) => { if (m.senderId === state.me.id || m.sender?.id === state.me.id) updateMessageInThread(m); });
}
function refreshPresence(userId, online, lastSeen) {
  const c = state.conversations.find((x) => x.otherUser?.id === userId);
  if (c) c.otherUser.lastSeen = lastSeen || c.otherUser.lastSeen;
  if (document.getElementById('messages').classList.contains('active')) renderConvList();
  const conv = state.conversations.find((x) => x.id === state.currentConvId);
  if (conv && conv.otherUser?.id === userId) document.getElementById('chat-status').textContent = online ? 'en ligne' : formatLastSeen(lastSeen);
}

/* Sending */
const msgInput = document.getElementById('msgInput');
let typingTimer = null;
msgInput.addEventListener('input', () => {
  if (!state.currentConvId || !state.socket) return;
  state.socket.emit('typing_start', { conversationId: state.currentConvId });
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => state.socket.emit('typing_stop', { conversationId: state.currentConvId }), 2000);
});
msgInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); sendMessage(); } });
document.getElementById('sendBtn').addEventListener('click', sendMessage);
async function sendMessage() {
  const val = msgInput.value.trim();
  if (!val || !state.currentConvId) return;
  const editing = msgInput.dataset.editing;
  msgInput.value = ''; msgInput.dataset.editing = '';
  try {
    if (editing) { await api('PUT', `/api/messages/${editing}`, { content: val }); }
    else { await api('POST', `/api/conversations/${state.currentConvId}/messages`, { content: val, type: 'text', replyTo: state.replyTo }); }
    state.replyTo = null; document.getElementById('replybar').classList.add('hidden');
  } catch (e) { toast(e.message); }
  state.socket?.emit('typing_stop', { conversationId: state.currentConvId });
}
function renderTyping() {
  const names = Object.values(state.typing);
  document.getElementById('typing').textContent = names.length ? `${names.join(', ')} ${names.length > 1 ? 'écrivent' : 'écrit'}…` : '';
}

document.getElementById('attach').addEventListener('click', () => {
  const rows = [
    ['Image (URL)', 'image'], ['Vidéo (URL)', 'video'], ['Audio (URL)', 'audio'], ['Lien', 'link'],
  ];
  document.getElementById('sheetBody').innerHTML = rows.map(([label, type]) => `<button class="arow" data-attach="${type}">${escText(label)}</button>`).join('');
  openOverlay('sheet');
});
document.getElementById('sheetBody').addEventListener('click', async (e) => {
  const a = e.target.closest('[data-attach]'); if (!a) return;
  closeOverlay('sheet');
  const url = prompt('URL (HTTPS) :');
  if (!url) return;
  try { await api('POST', `/api/conversations/${state.currentConvId}/messages`, { content: '', type: a.dataset.attach, url }); } catch (err) { toast(err.message); }
});

async function openSharePicker(postId) {
  try {
    if (!state.conversations.length) await loadConversations();
    document.getElementById('sheetBody').innerHTML = state.conversations.map((c) => `
      <button class="arow" data-sharepost="${postId}" data-convid="${c.id}">${escText(c.name)}</button>`).join('') || '<div class="empty">Aucune conversation</div>';
    openOverlay('sheet');
  } catch (e) { toast(e.message); }
}
document.getElementById('sheetBody').addEventListener('click', async (e) => {
  const s = e.target.closest('[data-sharepost]'); if (!s) return;
  closeOverlay('sheet');
  try { await api('POST', `/api/posts/${s.dataset.sharepost}/share`, { conversationId: s.dataset.convid, description: '' }); toast('Publication partagée'); } catch (err) { toast(err.message); }
});

/* ================= Conversation menu / group / background ================= */
function openConvMenu() {
  const conv = state.conversations.find((c) => c.id === state.currentConvId);
  const rows = [`<button class="arow" data-act2="pinned">${icon('pin', 20)}Messages épinglés</button>`,
    `<button class="arow" data-act2="bg">${icon('bg', 20)}Arrière-plan</button>`];
  if (conv?.type === 'group') rows.push(`<button class="arow" data-act2="members">${icon('user', 20)}Gérer les membres</button>`, `<button class="arow danger" data-act2="leave">${icon('logout', 20)}Quitter le groupe</button>`);
  else if (conv?.otherUser) rows.push(`<button class="arow danger" data-act2="block">${icon('x', 20)}Bloquer</button>`);
  rows.push(`<button class="arow danger" data-act2="delete-conv">${icon('trash', 20)}Supprimer la conversation</button>`);
  rows.push(`<button class="arow danger" data-act2="report-conv">${icon('flag', 20)}Signaler</button>`);
  document.getElementById('sheetBody').innerHTML = rows.join('');
  openOverlay('sheet');
}
async function deleteConversationAction(convId) {
  try {
    await api('DELETE', `/api/conversations/${convId}`);
    state.conversations = state.conversations.filter((c) => c.id !== convId);
    renderConvList();
    if (state.currentConvId === convId) { state.currentConvId = null; show('messages'); }
    toast('Conversation supprimée');
  } catch (err) { toast(err.message); }
}
document.getElementById('sheetBody').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-act2]'); if (!b) return;
  const conv = state.conversations.find((c) => c.id === state.currentConvId);
  closeOverlay('sheet');
  try {
    if (b.dataset.act2 === 'pinned') showPinned(conv.id);
    if (b.dataset.act2 === 'bg') openBackgroundPicker(conv.id);
    if (b.dataset.act2 === 'members') openGroupModal(conv);
    if (b.dataset.act2 === 'leave') { await api('DELETE', `/api/conversations/${conv.id}/members/${state.me.id}`); show('messages'); }
    if (b.dataset.act2 === 'block' && conv.otherUser) { await api('POST', `/api/users/block/${conv.otherUser.id}`); state.blocked.add(conv.otherUser.id); toast('Utilisateur bloqué'); }
    if (b.dataset.act2 === 'delete-conv') deleteConversationAction(conv.id);
    if (b.dataset.act2 === 'report-conv') { await api('POST', '/api/reports', { targetType: 'conversation', targetId: conv.id, reason: 'Conversation signalée' }); toast('Signalement envoyé'); }
  } catch (err) { toast(err.message); }
});
async function showPinned(convId) {
  try {
    const pinned = await api('GET', `/api/conversations/${convId}/pinned`);
    document.getElementById('sheetBody').innerHTML = pinned.length
      ? pinned.map((m) => `<div class="arow" style="cursor:default">${escText((m.content || messagePreviewText(m)).slice(0, 80))}</div>`).join('')
      : '<div class="empty">Aucun message épinglé</div>';
    openOverlay('sheet');
  } catch (e) { toast(e.message); }
}
function openBackgroundPicker(convId) {
  const conv = state.conversations.find((c) => c.id === convId);
  const current = conv?.background?.value || '';
  // Palette « fonds animés/modernes » : dégradés mesh multi-points et motifs
  // 100% CSS (aucune image externe requise), inspirés des wallpapers des
  // messageries actuelles.
  const opts = [
    ['Aucun', 'none', ''],
    ['Nuit électrique', 'gradient', 'radial-gradient(120% 100% at 15% 0%,#4338ca 0%,transparent 55%),radial-gradient(120% 100% at 90% 30%,#7c3aed 0%,transparent 50%),radial-gradient(130% 120% at 50% 100%,#0891b2 0%,transparent 55%),#0b0f1a'],
    ['Coucher de soleil', 'gradient', 'radial-gradient(120% 100% at 10% 10%,#f97316 0%,transparent 55%),radial-gradient(120% 100% at 90% 20%,#ec4899 0%,transparent 50%),radial-gradient(130% 120% at 50% 100%,#7c3aed 0%,transparent 55%),#1a0b1f'],
    ['Aurore boréale', 'gradient', 'radial-gradient(120% 100% at 20% 0%,#22c55e 0%,transparent 55%),radial-gradient(120% 100% at 85% 25%,#06b6d4 0%,transparent 50%),radial-gradient(130% 120% at 50% 100%,#3b82f6 0%,transparent 55%),#05101a'],
    ['Rose bonbon', 'gradient', 'radial-gradient(120% 100% at 15% 10%,#f472b6 0%,transparent 55%),radial-gradient(120% 100% at 90% 30%,#c084fc 0%,transparent 50%),radial-gradient(130% 120% at 50% 100%,#fb923c 0%,transparent 55%),#1a0f1f'],
    ['Océan profond', 'gradient', 'radial-gradient(120% 100% at 10% 0%,#0ea5e9 0%,transparent 55%),radial-gradient(120% 100% at 90% 40%,#0f766e 0%,transparent 50%),radial-gradient(130% 120% at 50% 100%,#1e3a8a 0%,transparent 55%),#020617'],
    ['Points scintillants', 'gradient', 'radial-gradient(circle,rgba(255,255,255,.35) 1.5px,transparent 1.5px) 0 0/22px 22px,linear-gradient(160deg,#1e1b4b,#3730a3)'],
    ['Rayures douces', 'gradient', 'repeating-linear-gradient(45deg,rgba(255,255,255,.06) 0 12px,transparent 12px 24px),linear-gradient(160deg,#0f172a,#1e293b)'],
    ['Vagues chaudes', 'gradient', 'radial-gradient(90% 60% at 50% 0%,#fb7185 0%,transparent 60%),radial-gradient(90% 60% at 0% 100%,#f59e0b 0%,transparent 60%),radial-gradient(90% 60% at 100% 100%,#a855f7 0%,transparent 60%),#180a12'],
    ['Feu', 'gradient', 'radial-gradient(120% 100% at 50% 110%,#f59e0b 0%,transparent 50%),radial-gradient(120% 100% at 20% 0%,#dc2626 0%,transparent 55%),radial-gradient(120% 100% at 85% 10%,#7c2d12 0%,transparent 55%),#160604'],
    ['Noir mat', 'gradient', 'radial-gradient(120% 90% at 30% 0%,rgba(255,255,255,.06) 0%,transparent 55%),#0a0a0c'],
    ['Doux clair', 'gradient', 'radial-gradient(120% 100% at 15% 0%,#dbeafe 0%,transparent 55%),radial-gradient(120% 100% at 90% 30%,#fce7f3 0%,transparent 50%),#f8fafc'],
  ];
  document.getElementById('sheetBody').innerHTML = `<div style="max-height:60vh;overflow-y:auto"><h3 style="margin:2px 4px 12px">Arrière-plan de la discussion</h3><div class="bgpicker">${opts.map(([label, type, value]) => `
    <button class="bgswatch ${value === current ? 'on' : ''}" style="background:${value || 'var(--chip)'}" data-bg-type="${type}" data-bg-value="${escText(value)}"><span>${escText(label)}</span></button>`).join('')}</div></div>`;
  openOverlay('sheet');
}
document.getElementById('sheetBody').addEventListener('click', async (e) => {
  const bg = e.target.closest('[data-bg-type]'); if (!bg) return;
  closeOverlay('sheet');
  try {
    await api('PUT', `/api/conversations/${state.currentConvId}/background`, { type: bg.dataset.bgType, value: bg.dataset.bgValue });
    const conv = state.conversations.find((c) => c.id === state.currentConvId);
    if (conv) conv.background = { type: bg.dataset.bgType, value: bg.dataset.bgValue };
    applyChatBackground({ type: bg.dataset.bgType, value: bg.dataset.bgValue });
  } catch (err) { toast(err.message); }
});

/* Group creation / management */
function openGroupModal(existing) {
  document.getElementById('g-title').textContent = existing ? 'Gérer le groupe' : 'Créer un groupe';
  document.getElementById('g-create').style.display = existing ? 'none' : 'block';
  document.getElementById('group-name').value = '';
  document.getElementById('g-search').value = '';
  const selected = new Map();
  const list = document.getElementById('g-list');
  async function renderCandidates(q) {
    list.innerHTML = '';
    let users = [];
    try { users = q ? await api('GET', `/api/users/search?q=${encodeURIComponent(q)}`) : await api('GET', '/api/users/online'); } catch { users = []; }
    users = users.filter((u) => u.id !== state.me.id && !(existing && existing.members.some((m) => m.id === u.id)));
    users.forEach((u) => {
      const row = document.createElement('button');
      row.type = 'button'; row.className = 'conv';
      row.innerHTML = `${avatarHtml(u, 'sm')}<div class="body" style="border-bottom:none"><div class="top"><b>${escText(u.username)}</b></div></div><span class="memcheck"></span>`;
      row.addEventListener('click', () => {
        row.classList.toggle('sel');
        if (selected.has(u.id)) selected.delete(u.id); else selected.set(u.id, u);
      });
      list.appendChild(row);
    });
  }
  renderCandidates('');
  document.getElementById('g-search').oninput = debounce((e) => renderCandidates(e.target.value.trim()), 250);
  document.getElementById('g-submit').textContent = existing ? 'Ajouter les membres' : 'Créer le groupe';
  document.getElementById('g-submit').onclick = async () => {
    const err = document.getElementById('g-err'); err.textContent = '';
    try {
      if (existing) {
        for (const id of selected.keys()) await api('POST', `/api/conversations/${existing.id}/members`, { memberIds: [id] });
        closeOverlay('groupmodal'); toast('Membres ajoutés');
      } else {
        const name = document.getElementById('group-name').value.trim();
        if (!name) { err.textContent = 'Nom du groupe requis.'; return; }
        if (!selected.size) { err.textContent = 'Sélectionnez au moins un membre.'; return; }
        const conv = await api('POST', '/api/conversations/group', { name, memberIds: [...selected.keys()] });
        state.conversations.unshift(conv);
        closeOverlay('groupmodal');
        show('messages'); renderConvList();
        openConversationObj(conv);
      }
    } catch (e2) { err.textContent = e2.message; }
  };
  openOverlay('groupmodal');
}

/* ================= NOTIFICATIONS ================= */
async function loadNotifications() {
  try {
    const notifs = await api('GET', '/api/notifications');
    const list = document.getElementById('notifList');
    if (!notifs.length) { list.innerHTML = '<div class="empty">Aucune notification.</div>'; return; }
    list.innerHTML = notifs.map((n) => `
      <div class="notif ${n.read ? '' : 'unread'}" data-notif="${n.id}" data-conv="${n.conversationId || ''}">
        ${avatarHtml(state.userCache.get(n.fromUserId) || { username: '', identity: { seed: n.fromUserId } }, 'md')}
        <p><b>${escText(notifActorLabel(n))}</b> ${escText(notifText(n))}<br><small>${formatRelative(n.createdAt)}</small></p>
      </div>`).join('');
    await refreshNotifCount();
    resolveNotifActors(notifs);
  } catch (e) { toast(e.message); }
}
function notifActorLabel() { return ''; }
function notifText(n) {
  const map = { message: 'vous a envoyé un message.', mention: 'vous a mentionné dans une publication.', group_invite: "vous a ajouté à un groupe.", system: n.content || 'Notification système.' };
  return map[n.type] || n.content || '';
}
async function resolveNotifActors(notifs) {
  const ids = [...new Set(notifs.map((n) => n.fromUserId).filter(Boolean))];
  for (const id of ids) {
    if (state.userCache.has(id)) continue;
    try { const u = await api('GET', `/api/users/${id}`); state.userCache.set(id, u); } catch {}
  }
  document.querySelectorAll('.notif').forEach((el) => {
    const n = notifs.find((x) => x.id === el.dataset.notif);
    const u = n && state.userCache.get(n.fromUserId);
    if (u) el.querySelector('b').textContent = u.username;
  });
}
document.getElementById('notifList').addEventListener('click', async (e) => {
  const row = e.target.closest('[data-notif]'); if (!row) return;
  try { await api('POST', `/api/notifications/${row.dataset.notif}/read`); row.classList.remove('unread'); } catch {}
  if (row.dataset.conv) { const c = state.conversations.find((x) => x.id === row.dataset.conv) || await api('GET', `/api/conversations/${row.dataset.conv}`).catch(() => null); if (c) { show('messages'); openConversationObj(c); } }
});
document.getElementById('notif-readall').addEventListener('click', async () => {
  try { await api('POST', '/api/notifications/read-all'); loadNotifications(); } catch (e) { toast(e.message); }
});

/* ================= PROFILE ================= */
async function openProfile(userId) {
  state._profileTarget = userId;
  const reqId = (state._profileReqId = (state._profileReqId || 0) + 1);
  // Réinitialise l'affichage immédiatement pour ne jamais laisser l'ancien
  // profil visible pendant le chargement du nouveau (avant, il restait figé
  // jusqu'à une actualisation manuelle si la requête était lente).
  document.getElementById('p-avatar').setAttribute('style', avatarStyle({ seed: userId }));
  document.getElementById('p-avatar').textContent = '';
  document.getElementById('p-name').textContent = '';
  document.getElementById('p-handle').textContent = '';
  document.getElementById('p-count').textContent = '–';
  document.getElementById('p-likes').textContent = '–';
  document.getElementById('p-actions').innerHTML = '';
  document.getElementById('aboutBlock').innerHTML = '';
  document.getElementById('profileGrid').innerHTML = '<div class="empty">Chargement…</div>';
  switchProfileTab('posts');
  try {
    const user = await api('GET', `/api/users/${userId}`);
    if (reqId !== state._profileReqId) return; // un profil plus récent a déjà été demandé entre-temps
    state.userCache.set(userId, user);
    const mine = userId === state.me.id;
    document.getElementById('p-avatar').setAttribute('style', avatarStyle(user.identity || { seed: userId }));
    document.getElementById('p-avatar').textContent = initials(user.username);
    document.getElementById('p-name').textContent = user.username;
    document.getElementById('p-handle').textContent = '@' + user.username;
    document.getElementById('p-settings').classList.toggle('hidden', !mine);
    const actions = document.getElementById('p-actions');
    if (mine) actions.innerHTML = `<button class="btn" data-nav="editprofile">Modifier le pseudo</button><button class="btn" data-nav="settings">Paramètres</button>`;
    else actions.innerHTML = `<button class="btn" data-msguser="${userId}">Message</button><button class="btn" data-blockuser="${userId}">${state.blocked.has(userId) ? 'Débloquer' : 'Bloquer'}</button>`;
    paintIcons(actions);
    document.getElementById('aboutBlock').innerHTML = `
      <div class="row"><span>Pseudo</span><span>@${escText(user.username)}</span></div>
      <div class="row"><span>Statut</span><span>${state.onlineUsers.has(userId) ? 'En ligne' : 'Hors ligne'}</span></div>
      <div class="row"><span>Vu pour la dernière fois</span><span>${escText(formatLastSeen(user.lastSeen))}</span></div>`;
    const posts = await api('GET', `/api/posts/user/${userId}`);
    if (reqId !== state._profileReqId) return;
    document.getElementById('p-count').textContent = posts.length;
    document.getElementById('p-likes').textContent = posts.reduce((sum, p) => sum + (p.likesCount || 0), 0);
    const grid = document.getElementById('profileGrid');
    grid.innerHTML = '';
    posts.forEach((p) => { state.postCache.set(p.id, p); grid.appendChild(renderTile(p)); });
    if (!posts.length) grid.innerHTML = '<div class="empty">Aucune publication.</div>';
  } catch (e) { if (reqId === state._profileReqId) toast(e.message); }
}
document.querySelectorAll('[data-ptab]').forEach((t) => t.addEventListener('click', () => switchProfileTab(t.dataset.ptab)));
function switchProfileTab(tab) {
  document.querySelectorAll('[data-ptab]').forEach((t) => t.classList.toggle('on', t.dataset.ptab === tab));
  document.getElementById('profileGrid').style.display = tab === 'posts' ? '' : 'none';
  document.getElementById('aboutBlock').style.display = tab === 'about' ? 'block' : 'none';
}
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-blockuser]'); if (!b) return;
  const id = b.dataset.blockuser;
  try {
    if (state.blocked.has(id)) { await api('POST', `/api/users/unblock/${id}`); state.blocked.delete(id); }
    else { await api('POST', `/api/users/block/${id}`); state.blocked.add(id); }
    openProfile(id);
  } catch (err) { toast(err.message); }
});

/* Edit profile (username) */
document.getElementById('ep-save').addEventListener('click', async () => {
  const err = document.getElementById('ep-err'); err.textContent = '';
  const username = document.getElementById('ep-username').value.trim();
  const password = document.getElementById('ep-password').value;
  if (!username || !password) { err.textContent = 'Remplissez tous les champs.'; return; }
  try {
    await api('PUT', '/api/settings/username', { username, password });
    state.me.username = username;
    toast('Pseudo mis à jour');
    show('profile');
  } catch (e) { err.textContent = e.message; }
});
document.getElementById('editprofile').addEventListener('transitionend', () => {});
document.querySelector('#editprofile').addEventListener('DOMNodeInsertedIntoDocument', () => {});
document.addEventListener('click', (e) => { if (e.target.closest('[data-nav="editprofile"]')) document.getElementById('ep-username').value = state.me.username; });

/* Post detail */
async function openPostDetail(postId) {
  try {
    const post = state.postCache.get(postId) || await api('GET', `/api/posts/${postId}`);
    state.postCache.set(postId, post);
    document.getElementById('postBody').innerHTML = '';
    document.getElementById('postBody').appendChild(renderPostEl(post));
    show('postdetail');
  } catch (e) { toast(e.message); }
}
document.getElementById('post-back').addEventListener('click', () => history.length ? history.back() : show('feed'));

/* ================= SETTINGS ================= */
document.addEventListener('click', (e) => { if (e.target.closest('[data-nav="settings"]')) initSettingsScreen(); });
function initSettingsScreen() {
  document.getElementById('s-handle').textContent = '@' + state.me.username;
  document.getElementById('s-dark').checked = state.me.settings?.theme === 'dark';
  document.getElementById('s-notif').checked = state.me.settings?.notifications !== false;
  document.getElementById('s-online').checked = state.me.settings?.privacy?.showOnlineStatus !== false;
  document.getElementById('s-seen').checked = state.me.settings?.privacy?.showLastSeen !== false;
  document.getElementById('s-font').value = state.me.settings?.messageFont || 'default';
  const isMod = state.me.roles?.some((r) => ['ADMIN', 'MODERATOR', 'OWNER'].includes(r));
  document.getElementById('s-admin').style.display = isMod ? 'flex' : 'none';
  document.getElementById('s-adminlabel').style.display = isMod ? 'block' : 'none';
  const swatches = [['#0057ff', '#8b3ef0'], ['#ff5a5f', '#ff9f43'], ['#0ca678', '#38d9a9'], ['#e64980', '#f783ac']];
  document.getElementById('s-swatches').innerHTML = swatches.map(([c1, c2], i) => `<button class="swatch ${state.me.settings?.accentColor === c1 ? 'on' : ''}" style="background:linear-gradient(135deg,${c1},${c2})" data-accent="${c1}"></button>`).join('');
}
document.getElementById('s-dark').addEventListener('change', async (e) => {
  applyTheme(e.target.checked ? 'dark' : 'light');
  try { await api('PUT', '/api/settings', { theme: e.target.checked ? 'dark' : 'light' }); state.me.settings.theme = e.target.checked ? 'dark' : 'light'; } catch {}
});
document.getElementById('s-notif').addEventListener('change', async (e) => {
  try { await api('PUT', '/api/settings', { notifications: e.target.checked }); toast(e.target.checked ? 'Notifications activées' : 'Notifications désactivées'); } catch (err) { toast(err.message); }
});
document.getElementById('s-online').addEventListener('change', async (e) => {
  try { await api('PUT', '/api/settings', { privacy: { showOnlineStatus: e.target.checked } }); toast(e.target.checked ? 'Statut visible' : 'Statut masqué'); } catch (err) { toast(err.message); }
});
document.getElementById('s-seen').addEventListener('change', async (e) => {
  try { await api('PUT', '/api/settings', { privacy: { showLastSeen: e.target.checked } }); } catch (err) { toast(err.message); }
});
document.getElementById('s-font').addEventListener('change', async (e) => {
  try { await api('PUT', '/api/settings', { messageFont: e.target.value }); } catch (err) { toast(err.message); }
});
document.getElementById('s-swatches').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-accent]'); if (!b) return;
  document.querySelectorAll('#s-swatches .swatch').forEach((s) => s.classList.remove('on'));
  b.classList.add('on');
  applyAccent(b.dataset.accent);
  try { await api('PUT', '/api/settings', { accentColor: b.dataset.accent }); state.me.settings.accentColor = b.dataset.accent; } catch (err) { toast(err.message); }
});
document.getElementById('s-pw').addEventListener('click', () => { document.getElementById('pw-cur').value = ''; document.getElementById('pw-new').value = ''; document.getElementById('pw-err').textContent = ''; openOverlay('pwsheet'); });
document.getElementById('pw-save').addEventListener('click', async () => {
  const err = document.getElementById('pw-err'); err.textContent = '';
  try {
    await api('PUT', '/api/settings/password', { currentPassword: document.getElementById('pw-cur').value, newPassword: document.getElementById('pw-new').value });
    closeOverlay('pwsheet'); toast('Mot de passe mis à jour');
  } catch (e) { err.textContent = e.message; }
});
document.getElementById('s-share-app').addEventListener('click', () => shareOrCopy(location.origin, 'Jexchat'));
document.getElementById('s-share-me').addEventListener('click', () => shareOrCopy(`${location.origin}/lapage/${state.me.username}`, 'Mon profil Jexchat'));
document.getElementById('s-sessions').addEventListener('click', async () => {
  const panel = document.getElementById('sessions-panel');
  panel.classList.toggle('hidden');
  if (panel.classList.contains('hidden')) return;
  try {
    const sessions = await api('GET', '/api/sessions');
    panel.innerHTML = sessions.map((s) => `
      <div class="inline-row"><b>${escText(s.deviceInfo || 'Appareil')}</b><small>${s.current ? 'Actif maintenant' : formatRelative(s.lastActive)}</small>
      ${s.current ? '' : `<button class="linkbtn" data-killsession="${s.id}">Déconnecter</button>`}</div>`).join('');
  } catch (e) { toast(e.message); }
});
document.getElementById('sessions-panel').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-killsession]'); if (!b) return;
  try { await api('DELETE', `/api/sessions/${b.dataset.killsession}`); toast('Session déconnectée'); document.getElementById('s-sessions').click(); document.getElementById('s-sessions').click(); } catch (err) { toast(err.message); }
});
document.getElementById('s-blocked').addEventListener('click', async () => {
  const panel = document.getElementById('blocked-panel');
  panel.classList.toggle('hidden');
  if (panel.classList.contains('hidden')) return;
  try {
    const blocked = await api('GET', '/api/users/blocked/list');
    panel.innerHTML = blocked.length ? blocked.map((u) => `
      <div class="inline-row">${avatarHtml(u, 'sm')}<b>${escText(u.username)}</b><button class="linkbtn" data-unblock="${u.id}">Débloquer</button></div>`).join('')
      : '<small style="color:var(--sub)">Aucun utilisateur bloqué</small>';
  } catch (e) { toast(e.message); }
});
document.getElementById('blocked-panel').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-unblock]'); if (!b) return;
  try { await api('POST', `/api/users/unblock/${b.dataset.unblock}`); state.blocked.delete(b.dataset.unblock); document.getElementById('s-blocked').click(); document.getElementById('s-blocked').click(); } catch (err) { toast(err.message); }
});
document.getElementById('s-logout').addEventListener('click', async () => {
  try { await api('POST', '/api/auth/logout'); } catch {}
  localStorage.removeItem(SESSION_TOKEN_KEY);
  state.me = null; state.token = null;
  state.socket?.disconnect();
  renderAccounts();
  show(getSavedAccounts().length ? 'accounts' : 'auth');
});
document.getElementById('s-logoutall').addEventListener('click', async () => {
  try { await api('DELETE', '/api/sessions'); toast('Déconnecté de tous les autres appareils'); } catch (e) { toast(e.message); }
});
document.getElementById('s-delete').addEventListener('click', () => { document.getElementById('del-pw').value = ''; document.getElementById('del-err').textContent = ''; openOverlay('delsheet'); });
document.getElementById('del-confirm').addEventListener('click', async () => {
  const err = document.getElementById('del-err'); err.textContent = '';
  try {
    await api('DELETE', '/api/settings/account', { password: document.getElementById('del-pw').value });
    closeOverlay('delsheet');
    localStorage.removeItem(SESSION_TOKEN_KEY);
    removeSavedAccount(state.me.id);
    toast('Compte supprimé');
    state.me = null; state.token = null;
    state.socket?.disconnect();
    show('auth');
  } catch (e) { err.textContent = e.message; }
});

/* ================= Init ================= */
paintIcons();
tryResumeSession();
window.addEventListener('storage', (e) => { if (e.key === SESSION_TOKEN_KEY && !e.newValue && state.me) location.reload(); });
