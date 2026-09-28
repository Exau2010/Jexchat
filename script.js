/* ========================================================================
   JEXCHAT — Frontend Logic
   Created by JEXREY
   Developers: Exaucé BOB & Jeffrey TCHABY
   ======================================================================== */

'use strict';

// ─── Constants ─────────────────────────────────────────────────────────────────
const SAVED_ACCOUNTS_KEY = 'jx_saved_accounts';
const SESSION_TOKEN_KEY = 'jx_session_token';
const THEME_KEY = 'jx_theme';
const MSG_LIMIT = 30;

// ─── State ─────────────────────────────────────────────────────────────────────
const state = {
  currentUser: null,
  sessionToken: null,
  conversations: [],
  currentConvId: null,
  messages: {},
  onlineUsers: new Set(),
  lastSeenMap: new Map(),
  typingUsers: {},
  socket: null,
  notifCount: 0,
  fcmToken: null,
  messaging: null,
  blockedUsers: new Set(),
  posts: { skip: 0, hasMore: true, loading: false, open: false },
};

// ─── API Helper ────────────────────────────────────────────────────────────────
async function api(method, path, body = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.sessionToken) headers['X-Session-Token'] = state.sessionToken;
  const opts = { method, headers, credentials: 'include' };
  if (body && method !== 'GET') opts.body = JSON.stringify(body);
  try {
    const res = await fetch(path, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || 'Erreur réseau'), { status: res.status });
    return data;
  } catch (err) {
    throw err;
  }
}

// ─── Saved Accounts ────────────────────────────────────────────────────────────
function getSavedAccounts() {
  try {
    return JSON.parse(localStorage.getItem(SAVED_ACCOUNTS_KEY) || '[]');
  } catch { return []; }
}

function saveAccount(user, token) {
  const accounts = getSavedAccounts().filter(a => a.id !== user.id);
  accounts.unshift({ id: user.id, username: user.username, identity: user.identity, token });
  if (accounts.length > 5) accounts.splice(5);
  localStorage.setItem(SAVED_ACCOUNTS_KEY, JSON.stringify(accounts));
}

function removeSavedAccount(userId) {
  const accounts = getSavedAccounts().filter(a => a.id !== userId);
  localStorage.setItem(SAVED_ACCOUNTS_KEY, JSON.stringify(accounts));
}

function clearSessionToken() {
  localStorage.removeItem(SESSION_TOKEN_KEY);
  state.sessionToken = null;
}

// ─── Identity / Avatar ─────────────────────────────────────────────────────────
function getUserInitials(username) {
  if (!username) return '?';
  return username.substring(0, 2).toUpperCase();
}

function createAvatarEl(user, size = 'md') {
  const el = document.createElement('div');
  el.className = `avatar avatar-${size}`;
  const id = user?.identity;
  if (id && id.colorA) {
    el.style.background = `linear-gradient(135deg, ${id.colorA}, ${id.colorB})`;
  } else {
    el.style.background = 'linear-gradient(135deg, #6C63FF, #A78BFA)';
  }
  const initials = document.createElement('div');
  initials.className = 'avatar-initials';
  initials.textContent = getUserInitials(user?.username || '');
  initials.style.color = 'white';
  initials.style.fontSize = size === 'xl' ? '1.5rem' : size === 'lg' ? '1.25rem' : size === 'sm' ? '0.75rem' : '1rem';
  el.appendChild(initials);
  return el;
}

// ─── Toast Notifications ───────────────────────────────────────────────────────
function toast(message, type = 'info', duration = 3500) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  const icons = { success: iconCheck(), error: iconX(), info: iconInfo() };
  const iconEl = document.createElement('div');
  iconEl.className = 'toast-icon';
  iconEl.style.color = type === 'success' ? '#22C55E' : type === 'error' ? '#EF4444' : '#3B6EF5';
  iconEl.innerHTML = icons[type] || icons.info;
  const textEl = document.createElement('div');
  textEl.className = 'toast-text';
  textEl.textContent = message;
  el.appendChild(iconEl);
  el.appendChild(textEl);
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add('removing');
    setTimeout(() => el.remove(), 200);
  }, duration);
}

// ─── Native Sharing ─────────────────────────────────────────────────────────────
// Utilise l'API Web Share native quand disponible (WhatsApp, Facebook, etc.
// apparaissent alors directement dans la fenêtre de partage du téléphone) ;
// sinon copie le lien dans le presse-papiers. Aucune API externe créée.
async function shareOrCopy(url, title) {
  if (navigator.share) {
    try {
      await navigator.share({ title: title || 'JEXCHAT', url });
      return;
    } catch (err) {
      // Annulé par l'utilisateur ou indisponible : on retombe sur la copie.
      if (err?.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast('Lien copié', 'success');
  } catch {
    toast(url, 'info', 6000);
  }
}

// ─── SVG Icons ─────────────────────────────────────────────────────────────────
const iconSize = (s = 18) => `width="${s}" height="${s}"`;
function iconMsg() { return `<svg ${iconSize()} fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.86 9.86 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg>`; }
function iconSend() { return `<svg ${iconSize(20)} fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"/></svg>`; }
function iconSearch() { return `<svg ${iconSize()} fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path stroke-linecap="round" d="M21 21l-4.35-4.35"/></svg>`; }
function iconSettings() { return `<svg ${iconSize()} fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><circle cx="12" cy="12" r="3"/></svg>`; }
function iconBell() { return `<svg ${iconSize()} fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/></svg>`; }
function iconPlus() { return `<svg ${iconSize()} fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/></svg>`; }
function iconBack() { return `<svg ${iconSize()} fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/></svg>`; }
function iconCheck() { return `<svg ${iconSize(16)} fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>`; }
function iconCheckDouble() { return `<svg ${iconSize(16)} fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M1.5 12.5l4 4 8-8M9 13l4 4 8-8"/></svg>`; }
function iconX() { return `<svg ${iconSize(16)} fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>`; }
function iconInfo() { return `<svg ${iconSize(16)} fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path stroke-linecap="round" d="M12 8v4M12 16h.01"/></svg>`; }
function iconReply() { return `<svg ${iconSize()} fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 10h11a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"/></svg>`; }
function iconEdit() { return `<svg ${iconSize()} fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>`; }
function iconTrash() { return `<svg ${iconSize()} fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>`; }
function iconPin() { return `<svg ${iconSize()} fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"/></svg>`; }
function iconCopy() { return `<svg ${iconSize()} fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>`; }
function iconSmile() { return `<svg ${iconSize()} fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path stroke-linecap="round" d="M8 13s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/></svg>`; }
function iconImage() { return `<svg ${iconSize()} fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path stroke-linecap="round" stroke-linejoin="round" d="M21 15l-5-5L5 21"/></svg>`; }
function iconLink() { return `<svg ${iconSize()} fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"/></svg>`; }
function iconUsers() { return `<svg ${iconSize()} fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"/></svg>`; }
function iconLogout() { return `<svg ${iconSize()} fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/></svg>`; }
function iconMore() { return `<svg ${iconSize()} fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>`; }
function iconChevron() { return `<svg ${iconSize(16)} fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg>`; }
function iconHeart() { return `<svg ${iconSize(16)} fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"/></svg>`; }
function iconThumbUp() { return `<svg ${iconSize(16)} fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5"/></svg>`; }
function iconThumbDown() { return `<svg ${iconSize(16)} fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M10 14H5.236a2 2 0 01-1.789-2.894l3.5-7A2 2 0 018.736 3h4.018a2 2 0 01.485.06l3.76.94m-7 10v5a2 2 0 002 2h.096c.5 0 .905-.405.905-.904 0-.715.211-1.413.608-2.008L17 13V4m-7 10h2m5-10h2a2 2 0 012 2v6a2 2 0 01-2 2h-2.5"/></svg>`; }
function iconLaugh() { return `<svg ${iconSize(16)} fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path stroke-linecap="round" d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/></svg>`; }
function iconWow() { return `<svg ${iconSize(16)} fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="14" r="2"/><path d="M9 9h.01M15 9h.01"/></svg>`; }
function iconSad() { return `<svg ${iconSize(16)} fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path stroke-linecap="round" d="M16 16s-1.5-2-4-2-4 2-4 2M9 9h.01M15 9h.01"/></svg>`; }
function iconAngry() { return `<svg ${iconSize(16)} fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path stroke-linecap="round" d="M16 16s-1.5-2-4-2-4 2-4 2M8.5 9.5l2 1M15.5 9.5l-2 1"/></svg>`; }
function iconFlag() { return `<svg ${iconSize()} fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2z"/></svg>`; }
function iconBg() { return `<svg ${iconSize()} fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><path stroke-linecap="round" d="M3 9h18M9 21V9"/></svg>`; }
function iconShare() { return `<svg ${iconSize(16)} fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path stroke-linecap="round" d="M8.59 13.51l6.83 3.98M15.41 6.51L8.59 10.49"/></svg>`; }
function iconVideo() { return `<svg ${iconSize()} fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>`; }

// ─── Time Formatting ───────────────────────────────────────────────────────────
function formatTime(date) {
  if (!date) return '';
  const d = new Date(date);
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(date) {
  if (!date) return '';
  const d = new Date(date);
  const now = new Date();
  const diffDays = Math.floor((now - d) / 86400000);
  if (diffDays === 0) return 'Aujourd\'hui';
  if (diffDays === 1) return 'Hier';
  if (diffDays < 7) return d.toLocaleDateString('fr-FR', { weekday: 'long' });
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

function formatRelativeTime(date) {
  if (!date) return '';
  const d = new Date(date);
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return 'maintenant';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}min`;
  if (diff < 86400000) return formatTime(d);
  if (diff < 604800000) return d.toLocaleDateString('fr-FR', { weekday: 'short' });
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

// ─── Last seen ─────────────────────────────────────────────────────────────────
function formatLastSeen(date) {
  if (!date) return 'Hors ligne';
  const diff = Date.now() - new Date(date).getTime();
  if (diff < 60000) return 'En ligne il y a quelques secondes';
  if (diff < 3600000) {
    const mins = Math.floor(diff / 60000);
    return `En ligne il y a ${mins} minute${mins > 1 ? 's' : ''}`;
  }
  if (diff < 86400000) {
    const hours = Math.floor(diff / 3600000);
    return `En ligne il y a ${hours} heure${hours > 1 ? 's' : ''}`;
  }
  const days = Math.floor(diff / 86400000);
  return `En ligne il y a ${days} jour${days > 1 ? 's' : ''}`;
}

// ─── Debounce ──────────────────────────────────────────────────────────────────
function debounce(fn, delay) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); };
}

// ─── Theme ─────────────────────────────────────────────────────────────────────
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme || 'light');
  localStorage.setItem(THEME_KEY, theme);
}

function loadTheme() {
  const saved = localStorage.getItem(THEME_KEY) || 'light';
  applyTheme(saved);
}

// ─── Socket.IO ─────────────────────────────────────────────────────────────────
function initSocket(token) {
  if (typeof io === 'undefined') return;
  if (state.socket?.connected) return;

  const socket = io({ auth: { token }, transports: ['websocket', 'polling'] });
  state.socket = socket;

  socket.on('connect', () => {
    console.log('[Socket] Connected');
  });

  socket.on('connect_error', (err) => {
    console.warn('[Socket] Error:', err.message);
  });

  socket.on('new_message', (msg) => {
    handleNewMessage(msg);
  });

  socket.on('message_edited', (msg) => {
    updateMessageInDOM(msg);
  });

  socket.on('message_deleted', ({ messageId, conversationId }) => {
    removeMessageFromDOM(messageId, conversationId);
  });

  socket.on('message_reaction', (msg) => {
    updateMessageInDOM(msg);
  });

  socket.on('message_pinned', ({ messageId, pinned }) => {
    const el = document.querySelector(`[data-msg-id="${messageId}"]`);
    if (el) {
      const pinnedBadge = el.querySelector('.msg-pinned-badge');
      if (pinned && !pinnedBadge) {
        const badge = document.createElement('div');
        badge.className = 'msg-pinned-badge';
        badge.innerHTML = iconPin() + ' Épinglé';
        el.prepend(badge);
      } else if (!pinned && pinnedBadge) {
        pinnedBadge.remove();
      }
    }
  });

  socket.on('messages_seen', ({ conversationId, userId, seenAt }) => {
    if (conversationId === state.currentConvId) {
      if (userId !== state.currentUser?.id) {
        document.querySelectorAll('.msg-row.out .msg-seen-icon').forEach(el => {
          el.style.color = '#3B6EF5';
        });
      }
    }
    updateConvLastMessage(conversationId);
  });

  socket.on('user_online', async ({ userId, username }) => {
    state.onlineUsers.add(userId);
    updatePresenceDots(userId, true);
    await addUserToOnlineStrip(userId, username);
  });

  socket.on('user_offline', ({ userId, lastSeen }) => {
    state.onlineUsers.delete(userId);
    updatePresenceDots(userId, false, lastSeen);
    removeUserFromOnlineStrip(userId);
  });

  socket.on('account_deleted', () => {
    toast('Votre compte a été supprimé.', 'info');
    clearSessionToken();
    setTimeout(() => window.location.href = '/', 800);
  });

  socket.on('conversation_deleted', ({ conversationId }) => {
    removeConvFromList(conversationId);
    if (state.currentConvId === conversationId) closeConversation();
  });

  socket.on('post_created', (post) => {
    if (typeof prependPostToFeed === 'function') prependPostToFeed(post);
  });

  socket.on('post_liked', ({ postId, likesCount }) => {
    if (typeof updatePostLikeUI === 'function') updatePostLikeUI(postId, likesCount);
  });

  socket.on('post_deleted', ({ postId }) => {
    if (typeof removePostFromFeed === 'function') removePostFromFeed(postId);
  });

  socket.on('user_typing', ({ userId, username, conversationId }) => {
    if (conversationId !== state.currentConvId) return;
    if (userId === state.currentUser?.id) return;
    showTypingIndicator(userId, username);
  });

  socket.on('user_stopped_typing', ({ userId, conversationId }) => {
    if (conversationId !== state.currentConvId) return;
    hideTypingIndicator(userId);
  });

  socket.on('background_changed', ({ conversationId, background }) => {
    if (conversationId === state.currentConvId) applyBackground(background);
    updateConvInList(conversationId, { background });
  });

  socket.on('group_created', (conv) => {
    addConvToList(conv);
  });

  socket.on('group_updated', (data) => {
    if (data.conversationId) {
      updateConvInList(data.conversationId, data);
    } else {
      addConvToList(data);
    }
  });

  socket.on('removed_from_group', ({ conversationId }) => {
    removeConvFromList(conversationId);
    if (state.currentConvId === conversationId) closeConversation();
  });

  socket.on('notification', () => {
    state.notifCount++;
    updateNotifBadge();
  });

  // Synchronise le compteur et la liste entre tous les onglets/appareils de
  // l'utilisateur quand une notification est marquée lue ailleurs, sans
  // recharger la page.
  socket.on('notifications_read', ({ notificationId, all, count }) => {
    state.notifCount = typeof count === 'number' ? count : 0;
    updateNotifBadge();
    const panel = document.getElementById('notif-panel');
    if (!panel) return;
    const list = panel.querySelector('#notif-list');
    if (all) {
      list?.querySelectorAll('.notif-item').forEach(el => el.remove());
    } else if (notificationId) {
      panel.querySelector(`.notif-item[data-notif-id="${notificationId}"]`)?.remove();
    }
    if (list && !list.querySelector('.notif-item')) showEmptyNotifList(list);
  });

  // Corbeille vidée depuis un autre onglet/appareil : synchronise
  // immédiatement ce client (opération distincte de "lu").
  socket.on('notifications_deleted', () => {
    state.notifCount = 0;
    updateNotifBadge();
    const panel = document.getElementById('notif-panel');
    if (!panel) return;
    const list = panel.querySelector('#notif-list');
    list?.querySelectorAll('.notif-item').forEach(el => el.remove());
    if (list) showEmptyNotifList(list);
  });

  return socket;
}

function joinConvRoom(convId) {
  if (state.socket) state.socket.emit('join_conversation', convId);
}

function leaveConvRoom(convId) {
  if (state.socket) state.socket.emit('leave_conversation', convId);
}

// Un onglet en arrière-plan (minimisé, autre appli au premier plan) ne doit
// pas compter comme "en train de voir la conversation" pour la notification
// push hors site (voir isMemberViewingConv côté serveur) : sans ça, un
// message reçu pendant que l'onglet JEXCHAT est ouvert mais caché ne
// déclencherait ni notification système ni son. On quitte/rejoint juste la
// room de présence, sans toucher au reste de l'état de la conversation.
document.addEventListener('visibilitychange', () => {
  if (!state.currentConvId || !state.socket) return;
  if (document.hidden) {
    leaveConvRoom(state.currentConvId);
  } else {
    joinConvRoom(state.currentConvId);
  }
});

// ─── Presence ──────────────────────────────────────────────────────────────────
function updatePresenceDots(userId, online, lastSeen) {
  if (!online) state.lastSeenMap.set(userId, lastSeen || new Date().toISOString());
  document.querySelectorAll(`[data-user-id="${userId}"] .presence-dot`).forEach(dot => {
    dot.classList.toggle('online', online);
  });
  document.querySelectorAll(`[data-user-id="${userId}"] .chat-header-status`).forEach(el => {
    el.textContent = online ? 'En ligne' : formatLastSeen(state.lastSeenMap.get(userId));
    el.className = 'chat-header-status' + (online ? ' online' : '');
  });
}

// Rafraîchit périodiquement le texte "En ligne il y a X" du header de conversation
// ouvert, pour que le délai affiché reste correct au fil du temps sans recharger.
function refreshOpenChatLastSeen() {
  const chatHeader = document.getElementById('chat-header');
  const userId = chatHeader?.dataset.userId;
  if (!userId || state.onlineUsers.has(userId)) return;
  const statusEl = chatHeader.querySelector('.chat-header-status');
  if (statusEl) statusEl.textContent = formatLastSeen(state.lastSeenMap.get(userId));
}
setInterval(refreshOpenChatLastSeen, 30000);

// ─── Typing ────────────────────────────────────────────────────────────────────
let typingTimeout = null;
function sendTypingStart() {
  if (!state.currentConvId || !state.socket) return;
  state.socket.emit('typing_start', { conversationId: state.currentConvId });
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(sendTypingStop, 3000);
}

function sendTypingStop() {
  if (!state.currentConvId || !state.socket) return;
  clearTimeout(typingTimeout);
  state.socket.emit('typing_stop', { conversationId: state.currentConvId });
}

function showTypingIndicator(userId, username) {
  const indicator = document.getElementById('typing-indicator');
  if (!indicator) return;
  state.typingUsers[userId] = username;
  const names = Object.values(state.typingUsers);
  indicator.querySelector('.typing-name').textContent = names.join(', ');
  indicator.classList.remove('hidden');
}

function hideTypingIndicator(userId) {
  delete state.typingUsers[userId];
  const indicator = document.getElementById('typing-indicator');
  if (!indicator) return;
  if (Object.keys(state.typingUsers).length === 0) {
    indicator.classList.add('hidden');
  } else {
    indicator.querySelector('.typing-name').textContent = Object.values(state.typingUsers).join(', ');
  }
}

// ─── Notification Badge ────────────────────────────────────────────────────────
function updateNotifBadge() {
  const badge = document.getElementById('notif-badge');
  if (!badge) return;
  if (state.notifCount > 0) {
    badge.textContent = state.notifCount > 99 ? '99+' : String(state.notifCount);
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

// ─── Conversations ─────────────────────────────────────────────────────────────
function renderConvList(convs) {
  const list = document.getElementById('conv-list');
  if (!list) return;
  list.innerHTML = '';
  if (!convs || convs.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">${iconMsg()}</div>
        <h3>Aucune conversation</h3>
        <p>Recherchez un utilisateur pour démarrer une conversation</p>
      </div>`;
    return;
  }
  convs.forEach(conv => list.appendChild(createConvItem(conv)));
}

function createConvItem(conv) {
  const el = document.createElement('div');
  el.className = `conv-item${conv.unreadCount > 0 ? ' unread' : ''}`;
  el.dataset.convId = conv.id;

  const other = conv.type === 'private' ? conv.otherUser : null;
  const name = conv.name || (other?.username) || 'Conversation';
  const isOnline = other ? state.onlineUsers.has(other.id) : false;

  const avatarWrap = document.createElement('div');
  avatarWrap.style.position = 'relative';
  avatarWrap.dataset.userId = other?.id || '';
  const avatar = createAvatarEl(other || { username: name, identity: null }, 'md');
  avatarWrap.appendChild(avatar);
  if (conv.type === 'group') {
    const groupIndicator = document.createElement('div');
    groupIndicator.style.cssText = 'position:absolute;bottom:1px;right:1px;width:14px;height:14px;background:var(--color-primary);border-radius:50%;border:2px solid var(--color-surface);display:flex;align-items:center;justify-content:center;';
    groupIndicator.innerHTML = `<svg width="8" height="8" fill="white" viewBox="0 0 24 24"><path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/></svg>`;
    avatarWrap.appendChild(groupIndicator);
  } else {
    const dot = document.createElement('div');
    dot.className = `presence-dot${isOnline ? ' online' : ''}`;
    avatarWrap.appendChild(dot);
  }

  const lastMsg = conv.lastMessage?.content || '';
  const lastTime = conv.lastMessage?.createdAt ? formatRelativeTime(conv.lastMessage.createdAt) : '';

  el.innerHTML = `
    <div class="conv-info">
      <div class="conv-name">${escText(name)}</div>
      <div class="conv-preview">${escText(lastMsg.substring(0, 60))}</div>
    </div>
    <div class="conv-meta">
      <div class="conv-time">${escText(lastTime)}</div>
      ${conv.unreadCount > 0 ? `<div class="badge badge-primary">${conv.unreadCount > 99 ? '99+' : conv.unreadCount}</div>` : ''}
    </div>`;

  el.prepend(avatarWrap);
  el.addEventListener('click', () => openConversation(conv));
  return el;
}

function addConvToList(conv) {
  state.conversations.unshift(conv);
  const list = document.getElementById('conv-list');
  if (!list) return;
  const emptyState = list.querySelector('.empty-state');
  if (emptyState) emptyState.remove();
  const existing = list.querySelector(`[data-conv-id="${conv.id}"]`);
  if (existing) existing.remove();
  const item = createConvItem(conv);
  list.prepend(item);
}

function updateConvInList(convId, data) {
  const idx = state.conversations.findIndex(c => c.id === convId);
  if (idx !== -1) Object.assign(state.conversations[idx], data);
  const item = document.querySelector(`[data-conv-id="${convId}"]`);
  if (!item) return;
  if (data.name) item.querySelector('.conv-name').textContent = data.name;
}

function removeConvFromList(convId) {
  state.conversations = state.conversations.filter(c => c.id !== convId);
  const item = document.querySelector(`[data-conv-id="${convId}"]`);
  if (item) item.remove();
}

function updateConvLastMessage(convId) {
  // Update unread badge
  const item = document.querySelector(`[data-conv-id="${convId}"]`);
  if (!item) return;
  item.classList.remove('unread');
  const badge = item.querySelector('.badge');
  if (badge) badge.remove();
}

// ─── Open Conversation ─────────────────────────────────────────────────────────
async function openConversation(conv) {
  if (state.currentConvId) leaveConvRoom(state.currentConvId);
  state.currentConvId = conv.id;
  state.messages[conv.id] = [];

  // Mark active in sidebar
  document.querySelectorAll('.conv-item').forEach(el => {
    el.classList.toggle('active', el.dataset.convId === conv.id);
  });

  // Mobile: show chat area (comportement mobile inchangé)
  const chatArea = document.getElementById('chat-area');
  const sidebar = document.getElementById('sidebar');
  if (window.innerWidth <= 768) {
    sidebar?.classList.add('sidebar-off');
    chatArea?.classList.add('chat-on');
  }

  // Desktop/tablette/mobile : révéler la zone de conversation et masquer le
  // placeholder "Vos messages", quelle que soit la taille d'écran. Une seule
  // et même logique pour toutes les tailles.
  document.getElementById('chat-placeholder-default')?.remove();
  const chatHeaderEl = document.getElementById('chat-header');
  const messagesWrapEl = document.getElementById('chat-messages-wrap');
  const inputAreaEl = document.getElementById('chat-input-area');
  if (chatHeaderEl) chatHeaderEl.style.display = 'flex';
  if (messagesWrapEl) messagesWrapEl.style.display = 'block';
  if (inputAreaEl) inputAreaEl.style.display = 'block';

  // Build chat header
  const other = conv.otherUser;
  const isOnline = other ? state.onlineUsers.has(other.id) : false;
  if (other && !isOnline) state.lastSeenMap.set(other.id, other.lastSeen);
  const name = conv.name || other?.username || 'Conversation';

  const chatHeader = document.getElementById('chat-header');
  if (chatHeader) {
    chatHeader.innerHTML = '';
    chatHeader.dataset.userId = other?.id || '';

    // Back button (mobile)
    const backBtn = document.createElement('button');
    backBtn.className = 'btn-icon mobile-only';
    backBtn.innerHTML = iconBack();
    backBtn.style.display = window.innerWidth <= 768 ? 'flex' : 'none';
    backBtn.addEventListener('click', closeMobileChat);
    chatHeader.appendChild(backBtn);

    // Avatar
    const avatarWrap = document.createElement('div');
    avatarWrap.style.position = 'relative';
    avatarWrap.dataset.userId = other?.id || '';
    const av = createAvatarEl(other || { username: name, identity: null }, 'md');
    avatarWrap.appendChild(av);
    if (conv.type === 'private') {
      const dot = document.createElement('div');
      dot.className = `presence-dot${isOnline ? ' online' : ''}`;
      avatarWrap.appendChild(dot);
    }
    chatHeader.appendChild(avatarWrap);

    // Info
    const info = document.createElement('div');
    info.className = 'chat-header-info';
    info.innerHTML = `
      <div class="chat-header-name">${escText(name)}</div>
      <div class="chat-header-status${isOnline ? ' online' : ''}">${isOnline ? 'En ligne' : formatLastSeen(other?.lastSeen)}</div>`;
    chatHeader.appendChild(info);

    // Cliquer sur l'avatar/le nom ouvre la page profil de l'utilisateur (conv. privées)
    if (conv.type === 'private' && other) {
      avatarWrap.style.cursor = 'pointer';
      info.style.cursor = 'pointer';
      avatarWrap.addEventListener('click', () => openProfileModal(other.id));
      info.addEventListener('click', () => openProfileModal(other.id));
    }

    // Actions
    const actions = document.createElement('div');
    actions.className = 'chat-header-actions';
    const bgBtn = document.createElement('button');
    bgBtn.className = 'btn-icon';
    bgBtn.title = 'Arrière-plan';
    bgBtn.innerHTML = iconBg();
    bgBtn.addEventListener('click', () => openBackgroundModal(conv.id));
    const moreBtn = document.createElement('button');
    moreBtn.className = 'btn-icon';
    moreBtn.innerHTML = iconMore();
    moreBtn.addEventListener('click', (e) => showConvDropdown(e, conv));
    actions.appendChild(bgBtn);
    actions.appendChild(moreBtn);
    chatHeader.appendChild(actions);
  }

  // Apply background
  applyBackground(conv.background);

  // Load messages
  await loadMessages(conv.id, true);
  joinConvRoom(conv.id);

  // Mark as seen
  try {
    await api('POST', `/api/conversations/${conv.id}/seen`);
  } catch {}
  updateConvLastMessage(conv.id);

  // Focus input
  document.getElementById('chat-textarea')?.focus();
}

function closeMobileChat() {
  const chatArea = document.getElementById('chat-area');
  const sidebar = document.getElementById('sidebar');
  sidebar?.classList.remove('sidebar-off');
  chatArea?.classList.remove('chat-on');
  if (state.currentConvId) leaveConvRoom(state.currentConvId);
  state.currentConvId = null;
}

function closeConversation() {
  if (state.currentConvId) leaveConvRoom(state.currentConvId);
  state.currentConvId = null;
  document.querySelectorAll('.conv-item').forEach(el => el.classList.remove('active'));
  showChatPlaceholder();
}

// Non-destructive : masque le header/les messages/la zone de saisie et
// affiche (ou recrée si besoin) le placeholder "Vos messages", SANS jamais
// vider #chat-area entièrement. Réutiliser le même conteneur (au lieu de le
// reconstruire) est ce qui permet à openConversation() de retrouver
// #chat-header / #chat-messages-wrap / #messages-container / #chat-input-area
// sur desktop comme sur mobile.
function showChatPlaceholder() {
  const chatArea = document.getElementById('chat-area');
  if (!chatArea) return;

  const chatHeader = document.getElementById('chat-header');
  const messagesWrap = document.getElementById('chat-messages-wrap');
  const inputArea = document.getElementById('chat-input-area');
  const typingIndicator = document.getElementById('typing-indicator');

  if (chatHeader) { chatHeader.style.display = 'none'; chatHeader.innerHTML = ''; }
  if (messagesWrap) messagesWrap.style.display = 'none';
  if (inputArea) inputArea.style.display = 'none';
  if (typingIndicator) typingIndicator.classList.add('hidden');

  let placeholder = document.getElementById('chat-placeholder-default');
  if (!placeholder) {
    placeholder = document.createElement('div');
    placeholder.id = 'chat-placeholder-default';
    placeholder.className = 'chat-placeholder';
    placeholder.innerHTML = `
      <div class="chat-placeholder-icon">${iconMsg()}</div>
      <h2>Vos messages</h2>
      <p>Sélectionnez une conversation ou recherchez un utilisateur pour commencer</p>`;
    chatArea.appendChild(placeholder);
  }
  placeholder.style.display = 'flex';
}

// ─── Background ────────────────────────────────────────────────────────────────
function applyBackground(bg) {
  const el = document.getElementById('chat-bg');
  if (!el) return;
  if (!bg || bg.type === 'none') {
    el.style.background = '';
    return;
  }
  if (bg.type === 'color') { el.style.background = bg.value; }
  else if (bg.type === 'gradient') { el.style.background = bg.value; }
  else if (bg.type === 'image') { el.style.background = `url('${bg.value}') center/cover`; }
  else if (bg.type === 'pattern') { applyPattern(el, bg.value); }
}

function applyPattern(el, pattern) {
  const patterns = {
    dots: 'radial-gradient(circle, #3B6EF520 1px, transparent 1px)',
    lines: 'repeating-linear-gradient(45deg, #3B6EF510 0, #3B6EF510 1px, transparent 0, transparent 50%)',
    grid: 'linear-gradient(#3B6EF515 1px, transparent 1px), linear-gradient(90deg, #3B6EF515 1px, transparent 1px)',
    waves: 'repeating-radial-gradient(circle at 0 0, transparent 0, #3B6EF510 20px)',
    bubbles: 'radial-gradient(circle at 20% 50%, #3B6EF515 0%, transparent 50%), radial-gradient(circle at 80% 20%, #7C3AED15 0%, transparent 50%)',
  };
  el.style.background = patterns[pattern] || '';
  if (pattern === 'grid') el.style.backgroundSize = '20px 20px';
  else if (pattern === 'dots') el.style.backgroundSize = '20px 20px';
}

// ─── Messages ──────────────────────────────────────────────────────────────────
let loadingMessages = false;
let hasMoreMessages = true;
let oldestMessageDate = null;

async function loadMessages(convId, reset = false) {
  if (loadingMessages) return;
  loadingMessages = true;

  const container = document.getElementById('messages-container');
  if (!container) { loadingMessages = false; return; }

  if (reset) {
    container.innerHTML = `<div class="flex items-center justify-center" style="padding:32px"><div class="spinner"></div></div>`;
    hasMoreMessages = true;
    oldestMessageDate = null;
  }

  try {
    const params = new URLSearchParams({ limit: MSG_LIMIT });
    if (oldestMessageDate && !reset) params.append('before', oldestMessageDate);
    const msgs = await api('GET', `/api/conversations/${convId}/messages?${params}`);

    if (msgs.length < MSG_LIMIT) hasMoreMessages = false;
    if (msgs.length > 0) oldestMessageDate = msgs[msgs.length - 1].createdAt;

    if (reset) {
      container.innerHTML = '';
      if (hasMoreMessages) appendLoadMoreBtn(container, convId);
    } else {
      // Remove existing load more btn
      const loadBtn = container.querySelector('.load-more-btn');
      if (loadBtn) loadBtn.remove();
      if (hasMoreMessages) appendLoadMoreBtn(container, convId);
    }

    // Reverse to show oldest first
    const sorted = [...msgs].reverse();
    let lastDate = null;

    // Get sender info
    const senderIds = [...new Set(sorted.map(m => m.senderId))];
    const sendersData = {};
    for (const conv of state.conversations) {
      if (conv.members) conv.members.forEach(m => { sendersData[m.id] = m; });
    }

    const msgEls = [];
    for (const msg of sorted) {
      const msgDate = new Date(msg.createdAt).toDateString();
      if (msgDate !== lastDate) {
        const sep = createDateSeparator(msg.createdAt);
        msgEls.push(sep);
        lastDate = msgDate;
      }
      const sender = sendersData[msg.senderId] || { id: msg.senderId, username: 'Utilisateur' };
      const isOut = msg.senderId === state.currentUser?.id;
      const msgEl = createMessageEl(msg, sender, isOut);
      msgEls.push(msgEl);
    }

    if (reset) {
      msgEls.forEach(el => container.appendChild(el));
      scrollToBottom(container);
    } else {
      const firstChild = container.querySelector('.load-more-btn')?.nextSibling || container.firstChild;
      msgEls.reverse().forEach(el => {
        if (firstChild) container.insertBefore(el, firstChild);
        else container.prepend(el);
      });
    }

    if (!hasMoreMessages && container.querySelector('.load-more-btn')) {
      container.querySelector('.load-more-btn').remove();
    }
  } catch (err) {
    console.error('[Messages] Load error:', err.message);
    if (reset) container.innerHTML = '<div class="empty-state"><p>Impossible de charger les messages</p></div>';
  } finally {
    loadingMessages = false;
  }
}

function appendLoadMoreBtn(container, convId) {
  const btn = document.createElement('div');
  btn.className = 'load-more-btn';
  btn.innerHTML = `<div class="spinner spinner-sm"></div> Messages précédents`;
  btn.addEventListener('click', () => loadMessages(convId, false));
  const firstMsg = container.querySelector('.msg-group, .date-separator');
  if (firstMsg) container.insertBefore(btn, firstMsg);
  else container.prepend(btn);
}

function createDateSeparator(date) {
  const el = document.createElement('div');
  el.className = 'date-separator';
  el.innerHTML = `<div class="date-separator-line"></div><div class="date-separator-text">${escText(formatDate(date))}</div><div class="date-separator-line"></div>`;
  return el;
}

function createMessageEl(msg, sender, isOut) {
  const group = document.createElement('div');
  group.className = 'msg-group';
  group.dataset.msgId = msg.id;

  const row = document.createElement('div');
  row.className = `msg-row ${isOut ? 'out' : 'in'}`;
  row.dataset.msgId = msg.id;

  if (!isOut) {
    const avatarWrap = document.createElement('div');
    avatarWrap.className = 'msg-avatar avatar-sm';
    const av = createAvatarEl(sender, 'sm');
    avatarWrap.appendChild(av);
    row.appendChild(avatarWrap);
  }

  const bubbleWrap = document.createElement('div');
  bubbleWrap.className = 'msg-bubble-wrap';

  // Reply reference
  if (msg.replyTo) {
    const replyRef = createReplyRef(msg.replyPreview);
    bubbleWrap.appendChild(replyRef);
  }

  // Bubble
  const bubble = createBubble(msg, isOut);
  bubbleWrap.appendChild(bubble);

  // Reactions
  if (msg.reactions && msg.reactions.length > 0) {
    const reactionsEl = createReactionsEl(msg);
    bubbleWrap.appendChild(reactionsEl);
  }

  // Meta (time + seen)
  const meta = document.createElement('div');
  meta.className = 'msg-meta';
  if (msg.editedAt) meta.innerHTML += `<span class="msg-edited">modifié</span>`;
  meta.innerHTML += `<span>${escText(formatTime(msg.createdAt))}</span>`;
  if (isOut) {
    const seenIcon = document.createElement('span');
    seenIcon.className = 'msg-seen-icon';
    const isSeen = msg.seenBy && msg.seenBy.length > 1;
    seenIcon.innerHTML = isSeen ? iconCheckDouble() : iconCheck();
    if (isSeen) seenIcon.style.color = '#3B6EF5';
    meta.appendChild(seenIcon);
  }
  bubbleWrap.appendChild(meta);

  // Action bar (hover)
  if (!msg.expired && !msg.deleted) {
    const actionBar = createMessageActionBar(msg, isOut);
    bubbleWrap.appendChild(actionBar);
  }

  row.appendChild(bubbleWrap);
  group.appendChild(row);

  // Context menu (right click / long press)
  setupMessageContextMenu(group, msg, isOut);

  return group;
}

function createBubble(msg, isOut) {
  const bubble = document.createElement('div');
  bubble.className = `msg-bubble ${isOut ? 'out' : 'in'}`;
  bubble.dataset.msgId = msg.id;

  if (msg.type === 'expired') {
    bubble.classList.add('expired');
    bubble.textContent = 'Réinitialisation des 5 jours atteinte';
    return bubble;
  }

  if (msg.deleted) {
    bubble.classList.add('deleted');
    bubble.textContent = 'Message supprimé';
    return bubble;
  }

  if (msg.pinned) {
    const badge = document.createElement('div');
    badge.className = 'msg-pinned-badge';
    badge.innerHTML = iconPin() + ' Épinglé';
    bubble.appendChild(badge);
  }

  switch (msg.type) {
    case 'text':
      bubble.appendChild(createTextContent(msg.content));
      break;
    case 'image':
      bubble.appendChild(createImageContent(msg.url, msg.content));
      break;
    case 'video':
      bubble.appendChild(createVideoContent(msg.url, msg.content));
      break;
    case 'audio':
      bubble.appendChild(createAudioContent(msg.url, msg.content));
      break;
    case 'link':
      bubble.appendChild(createLinkContent(msg.url, msg.content));
      break;
    case 'sticker':
      bubble.appendChild(createStickerContent(msg.url));
      break;
    case 'note':
      bubble.appendChild(createNoteContent(msg.content));
      break;
    case 'shared_post':
      bubble.appendChild(createSharedPostContent(msg));
      break;
    default:
      bubble.appendChild(createTextContent(msg.content || ''));
  }

  return bubble;
}

function createTextContent(text) {
  const p = document.createElement('p');
  p.textContent = text;
  // Simple link detection
  const urlReg = /https?:\/\/[^\s]+/g;
  if (urlReg.test(text)) {
    p.innerHTML = escText(text).replace(/https?:\/\/[^\s]+/g, url => `<a href="${url}" target="_blank" rel="noopener noreferrer" style="color:inherit;opacity:0.85;text-decoration:underline">${url}</a>`);
  }
  return p;
}

function createImageContent(url, caption) {
  const wrap = document.createElement('div');
  const img = document.createElement('img');
  img.src = url;
  img.className = 'msg-image';
  img.alt = 'Image';
  img.loading = 'lazy';
  img.onerror = () => { img.style.display = 'none'; };
  wrap.appendChild(img);
  if (caption) {
    const cap = document.createElement('p');
    cap.style.marginTop = '6px';
    cap.style.fontSize = '0.875rem';
    cap.textContent = caption;
    wrap.appendChild(cap);
  }
  return wrap;
}

// ─── Video URL Detection ────────────────────────────────────────────────────────
// Détecte le type d'une URL vidéo pour choisir le bon lecteur : fichier direct
// (.mp4/.webm/.ogg -> <video> natif léger), YouTube ou Vimeo (-> embed dédié),
// ou plateforme inconnue (-> lien d'ouverture, jamais passé tel quel à <video>
// qui ne sait pas lire une page YouTube). Ne télécharge ni ne convertit rien :
// seule l'URL est utilisée, jamais stockée ailleurs qu'en base (déjà le cas
// côté serveur).
function parseVideoUrl(url) {
  if (!url || typeof url !== 'string') return { type: 'unknown', url };
  let u;
  try { u = new URL(url); } catch { return { type: 'unknown', url }; }
  const host = u.hostname.replace(/^www\./, '');
  const path = u.pathname;

  if (/\.(mp4|webm|ogg|ogv)$/i.test(path)) {
    return { type: 'direct', url };
  }

  if (host === 'youtube.com' || host === 'youtu.be' || host === 'm.youtube.com') {
    let videoId = '';
    if (host === 'youtu.be') {
      videoId = path.slice(1);
    } else if (path === '/watch') {
      videoId = u.searchParams.get('v') || '';
    } else if (path.startsWith('/embed/')) {
      videoId = path.split('/embed/')[1];
    } else if (path.startsWith('/shorts/')) {
      videoId = path.split('/shorts/')[1];
    }
    videoId = (videoId || '').split(/[?&]/)[0];
    if (videoId && /^[a-zA-Z0-9_-]{6,15}$/.test(videoId)) {
      return {
        type: 'youtube',
        embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}`,
        thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        // Un Short YouTube est toujours au format vertical 9:16 : c'est
        // identifiable directement depuis l'URL, sans requête supplémentaire.
        vertical: path.startsWith('/shorts/'),
        url,
      };
    }
    return { type: 'unknown', url };
  }

  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const match = path.match(/(\d+)/);
    if (match) {
      return {
        type: 'vimeo',
        embedUrl: `https://player.vimeo.com/video/${match[1]}`,
        url,
      };
    }
    return { type: 'unknown', url };
  }

  return { type: 'unknown', url };
}

// Construit un lecteur vidéo adapté au type détecté. Les lecteurs externes
// (YouTube/Vimeo) sont chargés en différé : un aperçu léger (miniature ou
// simple bouton lecture) est affiché en premier, et l'iframe n'est créée
// qu'au clic, pour ne jamais ralentir le chargement du fil ou des messages.
function buildVideoPlayer(url, { maxWidth } = {}) {
  const info = parseVideoUrl(url);
  const wrap = document.createElement('div');
  wrap.className = 'video-player-wrap';
  if (maxWidth) wrap.style.maxWidth = maxWidth;

  if (info.type === 'direct') {
    const video = document.createElement('video');
    video.src = url;
    video.className = 'msg-video';
    video.controls = true;
    video.preload = 'none';
    // Format horizontal/vertical/carré : aucune dimension n'est imposée ici,
    // seulement un encadrement (largeur/hauteur max, voir CSS .msg-video) —
    // le ratio réel du fichier (lu par le navigateur via ses métadonnées)
    // fixe la forme finale, jamais déformée.
    video.style.cssText = 'max-width:100%;border-radius:10px;display:block';
    wrap.appendChild(video);
    return wrap;
  }

  if (info.type === 'youtube' || info.type === 'vimeo') {
    const ratio = info.vertical ? '9/16' : '16/9';
    const preview = document.createElement('div');
    preview.className = 'video-embed-preview';
    preview.style.cssText = `position:relative;cursor:pointer;border-radius:10px;overflow:hidden;background:#000;aspect-ratio:${ratio};display:flex;align-items:center;justify-content:center${info.vertical ? ';max-width:220px;margin:0 auto' : ''}`;
    if (info.thumbnail) {
      const img = document.createElement('img');
      img.src = info.thumbnail;
      img.loading = 'lazy';
      img.alt = 'Vidéo';
      img.style.cssText = `width:100%;height:100%;object-fit:${info.vertical ? 'contain' : 'cover'};position:absolute;inset:0;opacity:0.85`;
      img.onerror = () => { img.style.display = 'none'; };
      preview.appendChild(img);
    }
    const playBtn = document.createElement('div');
    playBtn.style.cssText = 'position:relative;width:56px;height:56px;border-radius:50%;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;color:#fff';
    playBtn.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
    preview.appendChild(playBtn);
    preview.addEventListener('click', () => {
      const iframe = document.createElement('iframe');
      iframe.src = info.embedUrl + (info.embedUrl.includes('?') ? '&' : '?') + 'autoplay=1';
      iframe.loading = 'lazy';
      iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
      iframe.allowFullscreen = true;
      iframe.style.cssText = `width:100%;aspect-ratio:${ratio};border:0;border-radius:10px;display:block${info.vertical ? ';max-width:220px;margin:0 auto' : ''}`;
      wrap.innerHTML = '';
      wrap.appendChild(iframe);
    }, { once: true });
    wrap.appendChild(preview);
    return wrap;
  }

  // URL vidéo inconnue : lien d'ouverture propre plutôt que de casser
  // l'affichage en la passant à <video>.
  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.className = 'flex items-center gap-2';
  a.style.cssText = 'color:var(--color-primary);word-break:break-all;padding:10px 12px;border:1px solid var(--color-border, #e5e7eb);border-radius:10px';
  a.innerHTML = `${iconVideo()}<span>Ouvrir la vidéo</span>`;
  wrap.appendChild(a);
  return wrap;
}

function createVideoContent(url, caption) {
  const wrap = document.createElement('div');
  wrap.appendChild(buildVideoPlayer(url, { maxWidth: '280px' }));
  if (caption) {
    const cap = document.createElement('p');
    cap.style.marginTop = '6px';
    cap.style.fontSize = '0.875rem';
    cap.textContent = caption;
    wrap.appendChild(cap);
  }
  return wrap;
}

function createAudioContent(url, caption) {
  const wrap = document.createElement('div');
  const audio = document.createElement('audio');
  audio.src = url;
  audio.controls = true;
  audio.preload = 'metadata';
  audio.style.maxWidth = '260px';
  wrap.appendChild(audio);
  if (caption) {
    const cap = document.createElement('p');
    cap.style.fontSize = '0.875rem';
    cap.textContent = caption;
    wrap.appendChild(cap);
  }
  return wrap;
}

function createLinkContent(url, caption) {
  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.className = 'msg-link-preview';
  a.innerHTML = `<span class="msg-link-url">${escText(url)}</span>`;
  if (caption) {
    const cap = document.createElement('span');
    cap.textContent = caption;
    a.prepend(cap);
  }
  return a;
}

function createStickerContent(url) {
  const img = document.createElement('img');
  img.src = url;
  img.className = 'msg-sticker';
  img.alt = 'Sticker';
  img.loading = 'lazy';
  img.onerror = () => { img.style.display = 'none'; };
  return img;
}

function createNoteContent(text) {
  const p = document.createElement('p');
  p.className = 'msg-note-content';
  p.textContent = text;
  return p;
}

function createSharedPostContent(msg) {
  const wrap = document.createElement('div');
  if (msg.content) {
    const p = document.createElement('p');
    p.style.marginBottom = '8px';
    p.textContent = msg.content;
    wrap.appendChild(p);
  }
  const card = document.createElement('div');
  card.style.cssText = 'border:1px solid rgba(0,0,0,0.12);border-radius:10px;padding:10px;background:rgba(255,255,255,0.06)';
  const post = msg.sharedPost;
  if (!post || post.deleted) {
    card.innerHTML = '<div class="text-xs" style="opacity:0.7">Publication originale supprimée</div>';
    wrap.appendChild(card);
    return wrap;
  }
  const header = document.createElement('div');
  header.className = 'flex items-center gap-2';
  header.appendChild(createAvatarEl(post.author, 'sm'));
  const name = document.createElement('div');
  name.style.fontWeight = '600';
  name.textContent = post.author?.username || 'Utilisateur';
  header.appendChild(name);
  card.appendChild(header);
  if (post.content) {
    const p = document.createElement('p');
    p.style.cssText = 'margin-top:6px;white-space:pre-wrap;word-break:break-word';
    p.textContent = post.content;
    card.appendChild(p);
  }
  card.appendChild(renderPostMedia(post));
  wrap.appendChild(card);
  return wrap;
}

// Libellés courts utilisés quand le message original n'a pas de contenu
// textuel à afficher tel quel (média, etc.).
const REPLY_TYPE_LABELS = {
  image: 'Photo', video: 'Vidéo', audio: 'Audio', link: 'Lien',
  sticker: 'Sticker', note: 'Note vocale', shared_post: 'Publication partagée',
  expired: 'Message expiré', deleted: 'Message supprimé',
};

function createReplyRef(replyPreview) {
  const ref = document.createElement('div');
  ref.className = 'msg-reply-ref';
  if (replyPreview && !replyPreview.deleted) {
    const name = replyPreview.author?.username || 'Message';
    const text = replyPreview.content || REPLY_TYPE_LABELS[replyPreview.type] || '';
    ref.innerHTML = `<div class="msg-reply-ref-name">${escText(name)}</div><div class="msg-reply-ref-text">${escText(text)}</div>`;
  } else {
    ref.innerHTML = `<div class="msg-reply-ref-text">Message original</div>`;
  }
  return ref;
}

function createReactionsEl(msg) {
  const wrap = document.createElement('div');
  wrap.className = 'msg-reactions';
  wrap.dataset.msgId = msg.id;
  const counts = {};
  msg.reactions.forEach(r => { counts[r.type] = (counts[r.type] || 0) + 1; });
  Object.entries(counts).forEach(([type, count]) => {
    const mine = msg.reactions.some(r => r.userId === state.currentUser?.id && r.type === type);
    const pill = document.createElement('div');
    pill.className = `reaction-pill${mine ? ' mine' : ''}`;
    pill.dataset.reactionType = type;
    pill.innerHTML = `${getReactionIcon(type)}<span class="reaction-count">${count}</span>`;
    pill.addEventListener('click', () => sendReaction(msg.id, type));
    wrap.appendChild(pill);
  });
  return wrap;
}

function getReactionIcon(type) {
  const icons = { heart: iconHeart(), thumbsup: iconThumbUp(), thumbsdown: iconThumbDown(), laugh: iconLaugh(), wow: iconWow(), sad: iconSad(), angry: iconAngry() };
  return icons[type] || iconHeart();
}

function createMessageActionBar(msg, isOut) {
  const bar = document.createElement('div');
  bar.className = 'msg-action-bar';

  const reactionBtn = document.createElement('button');
  reactionBtn.className = 'msg-action-btn';
  reactionBtn.innerHTML = iconSmile();
  reactionBtn.title = 'Réagir';

  const replyBtn = document.createElement('button');
  replyBtn.className = 'msg-action-btn';
  replyBtn.innerHTML = iconReply();
  replyBtn.title = 'Répondre';
  replyBtn.addEventListener('click', () => setReplyTo(msg));

  bar.appendChild(reactionBtn);
  bar.appendChild(replyBtn);

  // Reaction picker
  const picker = document.createElement('div');
  picker.className = 'reaction-picker';
  const reactions = ['heart', 'thumbsup', 'thumbsdown', 'laugh', 'wow', 'sad', 'angry'];
  reactions.forEach(type => {
    const btn = document.createElement('button');
    btn.className = 'reaction-btn';
    btn.innerHTML = getReactionIcon(type);
    btn.title = type;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      sendReaction(msg.id, type);
      picker.classList.remove('open');
    });
    picker.appendChild(btn);
  });
  bar.appendChild(picker);

  reactionBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    picker.classList.toggle('open');
  });

  return bar;
}

function setupMessageContextMenu(el, msg, isOut) {
  let longPressTimer;

  const show = (e) => {
    e.preventDefault();
    showMsgContextMenu(e, msg, isOut);
  };

  el.addEventListener('contextmenu', show);
  el.addEventListener('touchstart', () => { longPressTimer = setTimeout(() => show({ preventDefault: () => {}, clientX: 0, clientY: 0, target: el }), 600); }, { passive: true });
  el.addEventListener('touchend', () => clearTimeout(longPressTimer));
  el.addEventListener('touchmove', () => clearTimeout(longPressTimer));
}

function showMsgContextMenu(e, msg, isOut) {
  closeAllDropdowns();
  const menu = document.createElement('div');
  menu.className = 'dropdown';
  menu.style.position = 'fixed';

  const items = [];

  if (!msg.expired && !msg.deleted) {
    items.push({ icon: iconReply(), label: 'Répondre', action: () => setReplyTo(msg) });
    if (msg.type === 'text') {
      items.push({ icon: iconCopy(), label: 'Copier', action: () => { navigator.clipboard?.writeText(msg.content); toast('Copié', 'success', 1500); } });
    }
    if (isOut) {
      items.push({ icon: iconEdit(), label: 'Modifier', action: () => startEditMessage(msg) });
    }
    items.push({ icon: iconPin(), label: msg.pinned ? 'Désépingler' : 'Épingler', action: () => pinMessage(msg.id) });
    items.push({ icon: iconFlag(), label: 'Signaler', action: () => reportContent('message', msg.id) });
    items.push({ divider: true });
  }

  if (isOut || state.currentUser?.roles?.some(r => ['ADMIN', 'MODERATOR', 'OWNER'].includes(r))) {
    items.push({ icon: iconTrash(), label: 'Supprimer', danger: true, action: () => deleteMessage(msg.id) });
  }

  items.forEach(item => {
    if (item.divider) {
      const div = document.createElement('div');
      div.className = 'dropdown-divider';
      menu.appendChild(div);
      return;
    }
    const el = document.createElement('div');
    el.className = `dropdown-item${item.danger ? ' danger' : ''}`;
    el.innerHTML = item.icon + `<span>${escText(item.label)}</span>`;
    el.addEventListener('click', () => { item.action(); menu.remove(); });
    menu.appendChild(el);
  });

  document.body.appendChild(menu);
  menu.classList.add('open');

  // Position menu
  const rect = menu.getBoundingClientRect();
  let x = e.clientX || window.innerWidth / 2;
  let y = e.clientY || window.innerHeight / 2;
  if (x + rect.width > window.innerWidth) x = window.innerWidth - rect.width - 8;
  if (y + rect.height > window.innerHeight) y = y - rect.height;
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';

  setTimeout(() => {
    document.addEventListener('click', () => menu.remove(), { once: true });
  }, 50);
}

function updateMessageInDOM(msg) {
  const el = document.querySelector(`[data-msg-id="${msg.id}"]`);
  if (!el) return;
  const isOut = msg.senderId === state.currentUser?.id;
  const bubble = el.querySelector('.msg-bubble');
  if (bubble) {
    bubble.innerHTML = '';
    const content = createBubble(msg, isOut);
    bubble.className = content.className;
    while (content.firstChild) bubble.appendChild(content.firstChild);
  }
  // Update reactions
  const existingReactions = el.querySelector('.msg-reactions');
  if (existingReactions) existingReactions.remove();
  if (msg.reactions && msg.reactions.length > 0) {
    const reactionsEl = createReactionsEl(msg);
    const meta = el.querySelector('.msg-meta');
    if (meta) meta.insertAdjacentElement('beforebegin', reactionsEl);
  }
}

function removeMessageFromDOM(messageId) {
  const el = document.querySelector(`[data-msg-id="${messageId}"]`);
  if (el) {
    el.style.opacity = '0';
    el.style.transform = 'scale(0.95)';
    el.style.transition = 'all 0.2s ease';
    setTimeout(() => el.remove(), 200);
  }
}

function handleNewMessage(msg) {
  // Update conversation list
  const convIdx = state.conversations.findIndex(c => c.id === msg.conversationId);
  if (convIdx !== -1) {
    state.conversations[convIdx].lastMessage = {
      content: msg.content || msg.type,
      senderId: msg.senderId,
      type: msg.type,
      createdAt: msg.createdAt,
    };
    // Move to top
    const conv = state.conversations.splice(convIdx, 1)[0];
    state.conversations.unshift(conv);
    renderConvList(state.conversations);
  }

  if (msg.conversationId !== state.currentConvId) return;

  const container = document.getElementById('messages-container');
  if (!container) return;

  const isOut = msg.senderId === state.currentUser?.id;
  const sender = msg.sender || { id: msg.senderId, username: 'Utilisateur' };
  const msgEl = createMessageEl(msg, sender, isOut);
  container.appendChild(msgEl);
  scrollToBottom(container);

  // Mark as seen immediately if we're viewing
  api('POST', `/api/conversations/${msg.conversationId}/seen`).catch(() => {});
}

function scrollToBottom(container) {
  requestAnimationFrame(() => {
    container.scrollTop = container.scrollHeight;
  });
}

// ─── Reply ─────────────────────────────────────────────────────────────────────
let replyToMsg = null;

function setReplyTo(msg) {
  replyToMsg = msg;
  const preview = document.getElementById('reply-preview');
  if (!preview) return;
  preview.classList.remove('hidden');
  preview.querySelector('.reply-preview-name').textContent = msg.senderId === state.currentUser?.id ? 'Vous' : 'Message';
  preview.querySelector('.reply-preview-text').textContent = msg.content || msg.type || '';
}

function clearReplyTo() {
  replyToMsg = null;
  document.getElementById('reply-preview')?.classList.add('hidden');
}

// ─── Send Message ──────────────────────────────────────────────────────────────
async function sendMessage() {
  if (!state.currentConvId) return;
  const textarea = document.getElementById('chat-textarea');
  const content = textarea?.value.trim();
  if (!content) return;

  const body = { content, type: 'text' };
  if (replyToMsg) body.replyTo = replyToMsg.id;

  textarea.value = '';
  textarea.style.height = 'auto';
  clearReplyTo();
  sendTypingStop();

  try {
    await api('POST', `/api/conversations/${state.currentConvId}/messages`, body);
  } catch (err) {
    toast(err.message || 'Erreur d\'envoi', 'error');
    textarea.value = content;
  }
}

async function sendMediaMessage(url, type, caption = '') {
  if (!state.currentConvId || !url) return;
  try {
    await api('POST', `/api/conversations/${state.currentConvId}/messages`, { url, content: caption, type });
  } catch (err) {
    toast(err.message || 'Erreur d\'envoi', 'error');
  }
}

// ─── Edit Message ──────────────────────────────────────────────────────────────
let editingMsgId = null;

function startEditMessage(msg) {
  editingMsgId = msg.id;
  const textarea = document.getElementById('chat-textarea');
  if (!textarea) return;
  textarea.value = msg.content;
  textarea.focus();
  const sendBtn = document.getElementById('send-btn');
  if (sendBtn) {
    sendBtn.innerHTML = iconCheck();
    sendBtn.title = 'Enregistrer';
    sendBtn.dataset.editMode = '1';
  }
}

async function confirmEdit() {
  const textarea = document.getElementById('chat-textarea');
  const content = textarea?.value.trim();
  if (!content || !editingMsgId) return;
  try {
    await api('PUT', `/api/messages/${editingMsgId}`, { content });
    editingMsgId = null;
    textarea.value = '';
    const sendBtn = document.getElementById('send-btn');
    if (sendBtn) { sendBtn.innerHTML = iconSend(); delete sendBtn.dataset.editMode; }
  } catch (err) {
    toast(err.message || 'Erreur de modification', 'error');
  }
}

// ─── Delete Message ────────────────────────────────────────────────────────────
async function deleteMessage(msgId) {
  try {
    await api('DELETE', `/api/messages/${msgId}`);
  } catch (err) {
    toast(err.message || 'Erreur de suppression', 'error');
  }
}

// ─── Pin Message ───────────────────────────────────────────────────────────────
async function pinMessage(msgId) {
  try {
    await api('POST', `/api/messages/${msgId}/pin`);
  } catch (err) {
    toast(err.message || 'Erreur', 'error');
  }
}

// ─── React ─────────────────────────────────────────────────────────────────────
async function sendReaction(msgId, type) {
  try {
    await api('POST', `/api/messages/${msgId}/react`, { type });
  } catch (err) {
    toast(err.message || 'Erreur', 'error');
  }
}

// ─── Report ────────────────────────────────────────────────────────────────────
function reportContent(targetType, targetId) {
  const reason = prompt('Raison du signalement :');
  if (!reason) return;
  api('POST', '/api/reports', { targetType, targetId, reason })
    .then(() => toast('Signalement envoyé', 'success'))
    .catch(err => toast(err.message || 'Erreur', 'error'));
}

// ─── Background Modal ──────────────────────────────────────────────────────────
function openBackgroundModal(convId) {
  const modal = document.getElementById('bg-modal');
  if (!modal) {
    createBackgroundModal(convId);
    return;
  }
  modal.dataset.convId = convId;
  modal.classList.add('open');
}

function createBackgroundModal(convId) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'bg-modal';
  overlay.dataset.convId = convId;

  const colors = ['#F8F8FC', '#FFF0F0', '#F0FFF4', '#F0F4FF', '#FFF8F0', '#F8F0FF', '#0F0F14'];
  const gradients = [
    'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
    'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
    'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
    'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
    'linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)',
  ];

  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h3 class="modal-title">Arrière-plan de la conversation</h3>
        <button class="btn-icon" id="bg-modal-close">${iconX()}</button>
      </div>
      <div class="modal-body">
        <p class="text-sm text-secondary mb-4">L'arrière-plan est partagé avec l'autre participant.</p>
        <div class="input-group mb-4">
          <label class="input-label">Aucun</label>
          <button class="btn btn-secondary w-full" data-bg-type="none" data-bg-value="">Réinitialiser</button>
        </div>
        <div class="input-group mb-4">
          <label class="input-label">Couleur unie</label>
          <div class="color-options">
            ${colors.map(c => `<div class="color-dot" style="background:${c}" data-bg-type="color" data-bg-value="${c}"></div>`).join('')}
          </div>
        </div>
        <div class="input-group mb-4">
          <label class="input-label">Dégradé</label>
          <div class="color-options">
            ${gradients.map(g => `<div class="color-dot" style="background:${g}" data-bg-type="gradient" data-bg-value="${encodeURIComponent(g)}"></div>`).join('')}
          </div>
        </div>
        <div class="input-group mb-4">
          <label class="input-label">Motif</label>
          <div class="flex gap-2 flex-wrap">
            ${['dots', 'lines', 'grid', 'waves', 'bubbles'].map(p => `<button class="btn btn-secondary btn-sm" data-bg-type="pattern" data-bg-value="${p}">${p}</button>`).join('')}
          </div>
        </div>
        <div class="input-group">
          <label class="input-label">Image (URL HTTPS)</label>
          <div class="flex gap-2">
            <input type="url" class="input flex-1" id="bg-image-url" placeholder="https://...">
            <button class="btn btn-primary btn-sm" id="bg-image-apply">Appliquer</button>
          </div>
        </div>
      </div>
    </div>`;

  document.body.appendChild(overlay);
  setTimeout(() => overlay.classList.add('open'), 10);

  overlay.addEventListener('click', async (e) => {
    const target = e.target.closest('[data-bg-type]');
    if (!target) return;
    const type = target.dataset.bgType;
    let value = target.dataset.bgValue;
    if (type === 'gradient') value = decodeURIComponent(value);
    await setBackground(overlay.dataset.convId, type, value);
  });

  document.getElementById('bg-image-apply')?.addEventListener('click', async () => {
    const url = document.getElementById('bg-image-url')?.value;
    if (!url) return;
    await setBackground(overlay.dataset.convId, 'image', url);
  });

  document.getElementById('bg-modal-close')?.addEventListener('click', () => {
    overlay.classList.remove('open');
    setTimeout(() => overlay.remove(), 200);
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      overlay.classList.remove('open');
      setTimeout(() => overlay.remove(), 200);
    }
  });
}

async function setBackground(convId, type, value) {
  try {
    const res = await api('PUT', `/api/conversations/${convId}/background`, { type, value });
    applyBackground(res.background);
    toast('Arrière-plan mis à jour', 'success', 2000);
  } catch (err) {
    toast(err.message || 'Erreur', 'error');
  }
}

// ─── Conv Dropdown ─────────────────────────────────────────────────────────────
function showConvDropdown(e, conv) {
  closeAllDropdowns();
  const menu = document.createElement('div');
  menu.className = 'dropdown open';
  menu.style.cssText = `position:fixed;top:${e.clientY + 8}px;right:16px;z-index:500;`;

  const items = [
    { icon: iconPin(), label: 'Messages épinglés', action: () => showPinnedMessages(conv.id) },
    { icon: iconBg(), label: 'Arrière-plan', action: () => openBackgroundModal(conv.id) },
  ];

  if (conv.type === 'private') {
    items.push({ divider: true });
    items.push({ icon: iconFlag(), label: 'Signaler', action: () => conv.otherUser && reportContent('user', conv.otherUser.id) });
  }

  if (conv.type === 'group') {
    // Tous les membres peuvent gérer l'ajout de participants ; seul un
    // administrateur voit en plus le retrait de membres et le renommage
    // (contrôlé à nouveau côté interface dans openGroupModal, en plus du
    // serveur qui applique déjà ces permissions).
    items.push({ icon: iconUsers(), label: 'Gérer le groupe', action: () => openGroupModal(conv) });
    items.push({ divider: true });
    items.push({ icon: iconLogout(), label: 'Quitter le groupe', danger: true, action: () => leaveGroup(conv.id) });
  }

  items.forEach(item => {
    if (item.divider) { const d = document.createElement('div'); d.className = 'dropdown-divider'; menu.appendChild(d); return; }
    const el = document.createElement('div');
    el.className = `dropdown-item${item.danger ? ' danger' : ''}`;
    el.innerHTML = item.icon + `<span>${escText(item.label)}</span>`;
    el.addEventListener('click', () => { item.action(); menu.remove(); });
    menu.appendChild(el);
  });

  const btnRect = e.currentTarget.getBoundingClientRect();
  menu.style.top = (btnRect.bottom + 4) + 'px';
  menu.style.right = (window.innerWidth - btnRect.right) + 'px';

  document.body.appendChild(menu);
  setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 50);
}

// ─── Pinned Messages ───────────────────────────────────────────────────────────
async function showPinnedMessages(convId) {
  try {
    const msgs = await api('GET', `/api/conversations/${convId}/pinned`);
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h3 class="modal-title">Messages épinglés</h3>
          <button class="btn-icon" id="pinned-close">${iconX()}</button>
        </div>
        <div class="modal-body">
          ${msgs.length === 0 ? '<p class="text-secondary text-center">Aucun message épinglé</p>' :
            msgs.map(m => `<div class="msg-bubble in" style="margin-bottom:8px"><p>${escText(m.content || m.type)}</p><div class="msg-meta"><span>${escText(formatTime(m.createdAt))}</span></div></div>`).join('')}
        </div>
      </div>`;
    document.body.appendChild(overlay);
    setTimeout(() => overlay.classList.add('open'), 10);
    document.getElementById('pinned-close')?.addEventListener('click', () => { overlay.classList.remove('open'); setTimeout(() => overlay.remove(), 200); });
    overlay.addEventListener('click', e => { if (e.target === overlay) { overlay.classList.remove('open'); setTimeout(() => overlay.remove(), 200); } });
  } catch (err) {
    toast(err.message || 'Erreur', 'error');
  }
}

// ─── Group ─────────────────────────────────────────────────────────────────────
async function leaveGroup(convId) {
  try {
    await api('DELETE', `/api/conversations/${convId}/members/${state.currentUser.id}`);
    removeConvFromList(convId);
    closeConversation();
  } catch (err) {
    toast(err.message || 'Erreur', 'error');
  }
}

function openGroupModal(conv) {
  // Gestion du groupe : tous les membres peuvent ajouter des participants ;
  // seul un administrateur peut en retirer ou renommer le groupe (appliqué
  // ici côté interface, en plus des permissions déjà vérifiées côté serveur).
  const isAdmin = conv.admins?.includes(state.currentUser?.id);
  const isOwner = conv.owner === state.currentUser?.id;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'group-manage-modal';
  overlay.dataset.convId = conv.id;

  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h3 class="modal-title">Gérer le groupe</h3>
        <button class="btn-icon" id="group-modal-close">${iconX()}</button>
      </div>
      <div class="modal-body">
        <div class="input-group mb-4">
          <label class="input-label">Nom du groupe</label>
          ${isAdmin ? `
            <div class="flex gap-2">
              <input type="text" class="input flex-1" id="group-name-input" value="${escText(conv.name || '')}" maxlength="64">
              <button class="btn btn-primary btn-sm" id="group-name-save">Sauvegarder</button>
            </div>` : `<div class="input" style="opacity:0.7">${escText(conv.name || '')}</div>`}
        </div>
        <div class="input-group mb-4">
          <label class="input-label">Ajouter un membre</label>
          <input type="text" class="input" id="gm-search" placeholder="Rechercher un utilisateur...">
          <div id="gm-search-results" class="user-select-list" style="margin-top:8px"></div>
        </div>
        <div class="input-group">
          <label class="input-label" id="gm-members-label">Membres (${conv.members?.length || 0})</label>
          <div id="gm-members-list">
            ${(conv.members || []).map(m => renderGroupMemberRowHtml(conv, m, isAdmin)).join('')}
          </div>
        </div>
        ${isOwner ? `
        <div class="input-group" style="margin-top:20px">
          <label class="input-label" style="color:var(--color-error)">Zone dangereuse</label>
          <button class="btn btn-ghost" id="gm-delete-group" style="color:var(--color-error);width:100%">Supprimer le groupe définitivement</button>
        </div>` : ''}
      </div>
    </div>`;

  document.body.appendChild(overlay);
  setTimeout(() => overlay.classList.add('open'), 10);

  const close = () => { overlay.classList.remove('open'); setTimeout(() => overlay.remove(), 200); };
  document.getElementById('group-modal-close')?.addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  document.getElementById('group-name-save')?.addEventListener('click', async () => {
    const name = document.getElementById('group-name-input')?.value.trim();
    if (!name) return;
    try {
      await api('PUT', `/api/conversations/${conv.id}/name`, { name });
      conv.name = name;
      toast('Nom mis à jour', 'success');
    } catch (err) {
      toast(err.message || 'Erreur', 'error');
    }
  });

  document.getElementById('gm-delete-group')?.addEventListener('click', async () => {
    if (!confirm(`Supprimer définitivement le groupe "${conv.name || ''}" ? Cette action est irréversible pour tous les membres.`)) return;
    try {
      await api('DELETE', `/api/conversations/${conv.id}`);
      removeConvFromList(conv.id);
      if (state.currentConvId === conv.id) closeConversation();
      close();
      toast('Groupe supprimé', 'success');
    } catch (err) {
      toast(err.message || 'Erreur', 'error');
    }
  });

  const debouncedGmSearch = debounce(async (q) => {
    const results = document.getElementById('gm-search-results');
    if (!results) return;
    if (!q.trim()) { results.innerHTML = ''; return; }
    try {
      const users = await api('GET', `/api/users/search?q=${encodeURIComponent(q)}`);
      const memberIds = new Set((conv.members || []).map(m => m.id));
      results.innerHTML = '';
      users
        .filter(u => u.id !== state.currentUser?.id && !memberIds.has(u.id))
        .forEach(u => results.appendChild(renderAddMemberRow(conv, u, overlay)));
      if (!results.children.length) {
        results.innerHTML = '<div class="text-secondary text-sm" style="padding:8px">Aucun résultat</div>';
      }
    } catch {}
  }, 300);
  document.getElementById('gm-search')?.addEventListener('input', e => debouncedGmSearch(e.target.value));
}

function renderGroupMemberRowHtml(conv, m, isAdmin) {
  const canRemove = isAdmin && m.id !== conv.owner && m.id !== state.currentUser?.id;
  return `
    <div class="admin-table-row" style="border-radius:8px;margin-bottom:4px" data-member-id="${m.id}">
      ${createAvatarEl(m, 'sm').outerHTML}
      <div class="admin-row-info">
        <div class="admin-row-name">${escText(m.username)}</div>
      </div>
      ${canRemove ? `<button class="btn btn-ghost btn-sm" onclick="removeMember('${conv.id}','${m.id}',this)">Retirer</button>` : ''}
    </div>`;
}

function renderAddMemberRow(conv, user, overlay) {
  const el = document.createElement('div');
  el.className = 'admin-table-row';
  el.style.cssText = 'border-radius:8px;margin-bottom:4px';
  const av = createAvatarEl(user, 'sm');
  const info = document.createElement('div');
  info.className = 'admin-row-info';
  info.innerHTML = `<div class="admin-row-name">${escText(user.username)}</div>`;
  const addBtn = document.createElement('button');
  addBtn.className = 'btn btn-primary btn-sm';
  addBtn.textContent = 'Ajouter';
  addBtn.addEventListener('click', async () => {
    addBtn.disabled = true;
    try {
      await api('POST', `/api/conversations/${conv.id}/members`, { userId: user.id });
      conv.members = conv.members || [];
      // Empêche tout doublon même en cas de double-clic ou de réponse tardive.
      if (!conv.members.some(m => m.id === user.id)) conv.members.push(user);
      el.remove();
      const membersList = overlay.querySelector('#gm-members-list');
      const isAdmin = conv.admins?.includes(state.currentUser?.id);
      if (membersList && !membersList.querySelector(`[data-member-id="${user.id}"]`)) {
        membersList.insertAdjacentHTML('beforeend', renderGroupMemberRowHtml(conv, user, isAdmin));
      }
      const label = overlay.querySelector('#gm-members-label');
      if (label) label.textContent = `Membres (${conv.members.length})`;
      toast('Membre ajouté', 'success');
    } catch (err) {
      toast(err.message || 'Erreur', 'error');
      addBtn.disabled = false;
    }
  });
  el.appendChild(av);
  el.appendChild(info);
  el.appendChild(addBtn);
  return el;
}

async function removeMember(convId, userId, btn) {
  btn.disabled = true;
  try {
    await api('DELETE', `/api/conversations/${convId}/members/${userId}`);
    btn.closest('.admin-table-row').remove();
  } catch (err) {
    toast(err.message || 'Erreur', 'error');
    btn.disabled = false;
  }
}
window.removeMember = removeMember;

// ─── Create Group ──────────────────────────────────────────────────────────────
function openCreateGroupModal() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'create-group-modal';
  let selectedUsers = [];

  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h3 class="modal-title">Créer un groupe</h3>
        <button class="btn-icon" id="cg-close">${iconX()}</button>
      </div>
      <div class="modal-body">
        <div class="input-group mb-4">
          <label class="input-label">Nom du groupe</label>
          <input type="text" class="input" id="cg-name" placeholder="Nom du groupe..." maxlength="64">
        </div>
        <div class="input-group mb-3">
          <label class="input-label">Rechercher des membres</label>
          <input type="text" class="input" id="cg-search" placeholder="Rechercher...">
        </div>
        <div id="cg-selected" class="selected-members mb-3"></div>
        <div id="cg-results" class="user-select-list"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" id="cg-cancel">Annuler</button>
        <button class="btn btn-primary" id="cg-create">Créer le groupe</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);
  setTimeout(() => overlay.classList.add('open'), 10);

  const close = () => { overlay.classList.remove('open'); setTimeout(() => overlay.remove(), 200); };
  document.getElementById('cg-close')?.addEventListener('click', close);
  document.getElementById('cg-cancel')?.addEventListener('click', close);

  const debouncedSearch = debounce(async (q) => {
    if (q.length < 1) { document.getElementById('cg-results').innerHTML = ''; return; }
    try {
      const users = await api('GET', `/api/users/search?q=${encodeURIComponent(q)}`);
      renderUserSelectList(users, selectedUsers, (user) => {
        toggleUserSelection(user, selectedUsers, overlay);
      });
    } catch {}
  }, 300);

  document.getElementById('cg-search')?.addEventListener('input', e => debouncedSearch(e.target.value));

  document.getElementById('cg-create')?.addEventListener('click', async () => {
    const name = document.getElementById('cg-name')?.value.trim();
    if (!name) { toast('Entrez un nom pour le groupe', 'error'); return; }
    if (selectedUsers.length === 0) { toast('Sélectionnez au moins un membre', 'error'); return; }
    try {
      const conv = await api('POST', '/api/conversations/group', {
        name,
        memberIds: selectedUsers.map(u => u.id),
      });
      addConvToList(conv);
      openConversation(conv);
      close();
      toast('Groupe créé', 'success');
    } catch (err) {
      toast(err.message || 'Erreur', 'error');
    }
  });
}

function toggleUserSelection(user, selectedUsers, overlay) {
  const idx = selectedUsers.findIndex(u => u.id === user.id);
  if (idx === -1) {
    selectedUsers.push(user);
  } else {
    selectedUsers.splice(idx, 1);
  }
  renderSelectedChips(selectedUsers, overlay.querySelector('#cg-selected'), selectedUsers, overlay);
  overlay.querySelectorAll('.user-select-item').forEach(el => {
    el.classList.toggle('selected', selectedUsers.some(u => u.id === el.dataset.userId));
    const check = el.querySelector('.user-select-check');
    if (check) check.innerHTML = selectedUsers.some(u => u.id === el.dataset.userId) ? iconCheck() : '';
  });
}

function renderSelectedChips(users, container, selectedUsers, overlay) {
  if (!container) return;
  container.innerHTML = '';
  users.forEach(user => {
    const chip = document.createElement('div');
    chip.className = 'member-chip';
    chip.innerHTML = `${escText(user.username)}<span class="member-chip-remove">${iconX()}</span>`;
    chip.querySelector('.member-chip-remove').addEventListener('click', () => {
      toggleUserSelection(user, selectedUsers, overlay);
    });
    container.appendChild(chip);
  });
}

function renderUserSelectList(users, selectedUsers, onSelect) {
  const container = document.getElementById('cg-results');
  if (!container) return;
  container.innerHTML = '';
  users.filter(u => u.id !== state.currentUser?.id).forEach(user => {
    const el = document.createElement('div');
    const isSelected = selectedUsers.some(s => s.id === user.id);
    el.className = `user-select-item${isSelected ? ' selected' : ''}`;
    el.dataset.userId = user.id;
    const av = createAvatarEl(user, 'sm');
    const check = document.createElement('div');
    check.className = 'user-select-check';
    if (isSelected) check.innerHTML = iconCheck();
    el.innerHTML = `<div class="flex-1 flex gap-2 items-center"></div>`;
    el.querySelector('.flex-1').prepend(av);
    const name = document.createElement('div');
    name.textContent = user.username;
    name.style.fontWeight = '500';
    el.querySelector('.flex-1').appendChild(name);
    el.appendChild(check);
    el.addEventListener('click', () => onSelect(user));
    container.appendChild(el);
  });
}

// ─── Search ────────────────────────────────────────────────────────────────────
async function handleSearch(q) {
  if (!q.trim()) {
    renderConvList(state.conversations);
    return;
  }
  try {
    const users = await api('GET', `/api/users/search?q=${encodeURIComponent(q)}`);
    const list = document.getElementById('conv-list');
    if (!list) return;
    list.innerHTML = '';
    if (users.length === 0) {
      list.innerHTML = '<div class="empty-state"><p>Aucun utilisateur trouvé</p></div>';
      return;
    }
    users.forEach(user => {
      if (user.id === state.currentUser?.id) return;
      const el = document.createElement('div');
      el.className = 'conv-item';
      const av = createAvatarEl(user, 'md');
      const avatarWrap = document.createElement('div');
      avatarWrap.style.position = 'relative';
      const dot = document.createElement('div');
      dot.className = `presence-dot${state.onlineUsers.has(user.id) ? ' online' : ''}`;
      avatarWrap.appendChild(av);
      avatarWrap.appendChild(dot);
      el.appendChild(avatarWrap);
      const infoEl = document.createElement('div');
      infoEl.className = 'conv-info';
      infoEl.innerHTML = `<div class="conv-name">${escText(user.username)}</div><div class="conv-preview">${state.onlineUsers.has(user.id) ? 'En ligne' : 'Hors ligne'}</div>`;
      el.appendChild(infoEl);
      avatarWrap.style.cursor = 'pointer';
      avatarWrap.addEventListener('click', (e) => { e.stopPropagation(); openProfileModal(user.id); });
      el.addEventListener('click', async () => {
        try {
          const conv = await api('POST', '/api/conversations/private', { userId: user.id });
          if (!state.conversations.find(c => c.id === conv.id)) addConvToList(conv);
          openConversation(conv);
        } catch (err) {
          toast(err.message || 'Erreur', 'error');
        }
      });
      list.appendChild(el);
    });
  } catch {}
}

// ─── Notifications Panel ───────────────────────────────────────────────────────
// Chaque notification lue (individuellement ou via "Tout lire") est retirée
// de la liste des non-lues à l'écran, sans jamais être supprimée en base tant
// qu'elle n'a pas réellement été marquée comme lue côté serveur ; le compteur
// est mis à jour immédiatement, et synchronisé entre onglets/appareils via
// Socket.IO (voir 'notifications_read' dans initSocket). Aucun refresh de page.
let notifPanelOutsideHandler = null;

// Positionne le panneau en position:fixed calculée depuis la cloche
// (au lieu d'être un descendant absolu du header, qui a un fond semi-
// transparent + backdrop-filter — combinaison qui le laissait apparaître
// translucide, avec le contenu du dessous visible à travers).
function positionNotifPanel(panel) {
  const btn = document.getElementById('notif-btn');
  if (!btn) return;
  const btnRect = btn.getBoundingClientRect();
  panel.style.top = (btnRect.bottom + 8) + 'px';
  if (window.innerWidth <= 768) {
    panel.style.left = '8px';
    panel.style.right = '8px';
    panel.style.width = 'auto';
  } else {
    panel.style.left = '';
    panel.style.width = '340px';
    panel.style.right = Math.max(16, window.innerWidth - btnRect.right) + 'px';
  }
}

async function toggleNotifPanel() {
  let panel = document.getElementById('notif-panel');
  if (panel?.classList.contains('open')) {
    panel.classList.remove('open');
    return;
  }
  if (!panel) {
    panel = document.createElement('div');
    panel.className = 'notif-panel';
    panel.id = 'notif-panel';
    panel.innerHTML = `
      <div class="notif-panel-header">
        <span class="notif-panel-title">Notifications</span>
        <div style="display:flex;gap:4px;align-items:center">
          <button class="btn btn-ghost btn-sm" id="notif-read-all">Tout lire</button>
          <button class="btn-icon" id="notif-clear-all" title="Tout supprimer">${iconTrash()}</button>
        </div>
      </div>
      <div class="notif-list" id="notif-list"><div class="flex items-center justify-center" style="padding:32px"><div class="spinner"></div></div></div>`;
    // Ajouté directement à <body> (position:fixed) plutôt qu'au header, pour
    // ne jamais hériter de son fond translucide / backdrop-filter.
    document.body.appendChild(panel);

    // Listeners attachés une seule fois, à la création du panneau (évite les
    // doublons d'écouteurs — et donc les appels API en double — à chaque
    // ouverture).
    document.getElementById('notif-read-all')?.addEventListener('click', async () => {
      try {
        await api('POST', '/api/notifications/read-all');
      } catch { return; }
      const list = panel.querySelector('#notif-list');
      list?.querySelectorAll('.notif-item').forEach(el => el.remove());
      if (list) showEmptyNotifList(list);
      state.notifCount = 0;
      updateNotifBadge();
    });

    // Corbeille : suppression définitive (deleteMany groupé côté serveur),
    // distincte du simple marquage comme lu.
    document.getElementById('notif-clear-all')?.addEventListener('click', async () => {
      try {
        await api('POST', '/api/notifications/delete-all');
      } catch { return; }
      const list = panel.querySelector('#notif-list');
      list?.querySelectorAll('.notif-item').forEach(el => el.remove());
      if (list) showEmptyNotifList(list);
      state.notifCount = 0;
      updateNotifBadge();
    });

    window.addEventListener('resize', () => {
      if (panel.classList.contains('open')) positionNotifPanel(panel);
    });
  }

  positionNotifPanel(panel);
  panel.classList.add('open');

  await renderNotifList(panel);

  // Ouvrir le panneau marque immédiatement toutes les notifications
  // affichées comme lues côté serveur (une seule requête updateMany), sans
  // attendre un clic sur "Tout lire" : badge et liste repassent à zéro tout
  // de suite, et ces notifications ne réapparaîtront pas (la liste ne
  // renvoie que les non lues).
  if (state.notifCount > 0) {
    state.notifCount = 0;
    updateNotifBadge();
    try {
      await api('POST', '/api/notifications/read-all');
      const list = panel.querySelector('#notif-list');
      list?.querySelectorAll('.notif-item').forEach(el => el.remove());
      if (list) showEmptyNotifList(list);
    } catch {}
  }

  if (notifPanelOutsideHandler) document.removeEventListener('click', notifPanelOutsideHandler);
  notifPanelOutsideHandler = (e) => {
    if (!panel.contains(e.target) && !e.target.closest('#notif-btn')) panel.classList.remove('open');
  };
  setTimeout(() => document.addEventListener('click', notifPanelOutsideHandler), 100);
}

function showEmptyNotifList(list) {
  list.innerHTML = '<div class="empty-state" style="padding:24px"><p>Aucune notification</p></div>';
}

async function renderNotifList(panel) {
  const list = panel.querySelector('#notif-list');
  if (!list) return;
  try {
    const notifs = await api('GET', '/api/notifications');
    list.innerHTML = '';
    if (notifs.length === 0) {
      showEmptyNotifList(list);
      return;
    }
    notifs.forEach(n => {
      const el = document.createElement('div');
      el.className = `notif-item${n.read ? '' : ' unread'}`;
      el.dataset.notifId = n.id;
      el.innerHTML = `<div class="notif-item-content"><div class="notif-item-text">${escText(n.content)}</div><div class="notif-item-time">${escText(formatRelativeTime(n.createdAt))}</div></div>`;
      el.addEventListener('click', async () => {
        // Marque comme lue avant tout retrait visuel : elle ne disparaît
        // réellement de la liste qu'une fois l'état enregistré côté serveur.
        if (!n.read) {
          try {
            await api('POST', `/api/notifications/${n.id}/read`);
            n.read = true;
            el.remove();
            if (!list.querySelector('.notif-item')) showEmptyNotifList(list);
            state.notifCount = Math.max(0, state.notifCount - 1);
            updateNotifBadge();
          } catch {}
        }
        if (n.conversationId) {
          const conv = state.conversations.find(c => c.id === n.conversationId);
          if (conv) openConversation(conv);
        }
        panel.classList.remove('open');
      });
      list.appendChild(el);
    });
  } catch {}
}

// ─── Online Users Strip ────────────────────────────────────────────────────────
// Chargement initial uniquement : les arrivées/départs suivants sont gérés en
// temps réel par les événements Socket.IO user_online/user_offline
// (addUserToOnlineStrip / removeUserFromOnlineStrip), sans recharger toute la
// liste ni dupliquer d'éléments DOM lors d'ouvertures répétées.
async function loadOnlineUsers() {
  try {
    const users = await api('GET', '/api/users/online');
    const list = document.getElementById('online-list');
    if (!list) return;
    list.innerHTML = '';
    if (users.length === 0) {
      list.innerHTML = '<p class="text-xs text-secondary" style="padding:4px 0">Aucun utilisateur en ligne</p>';
      return;
    }
    users.forEach(user => {
      if (user.id === state.currentUser?.id) return;
      if (list.querySelector(`[data-user-id="${user.id}"]`)) return; // anti-doublon
      state.onlineUsers.add(user.id);
      const el = document.createElement('div');
      el.className = 'online-user';
      el.dataset.userId = user.id;
      const wrap = document.createElement('div');
      wrap.style.position = 'relative';
      const av = createAvatarEl(user, 'sm');
      const dot = document.createElement('div');
      dot.className = 'presence-dot online';
      wrap.appendChild(av);
      wrap.appendChild(dot);
      wrap.style.cursor = 'pointer';
      wrap.addEventListener('click', (e) => { e.stopPropagation(); openProfileModal(user.id); });
      const name = document.createElement('div');
      name.className = 'online-user-name';
      name.textContent = user.username;
      el.appendChild(wrap);
      el.appendChild(name);
      el.addEventListener('click', async () => {
        try {
          const conv = await api('POST', '/api/conversations/private', { userId: user.id });
          if (!state.conversations.find(c => c.id === conv.id)) addConvToList(conv);
          openConversation(conv);
        } catch (err) {
          toast(err.message || 'Erreur', 'error');
        }
      });
      list.appendChild(el);
    });
  } catch {}
}

// Ajoute/retire un utilisateur de la bande "En ligne" en temps réel via
// Socket.IO, sans refaire un chargement complet ni dupliquer d'élément DOM.
async function addUserToOnlineStrip(userId, username) {
  if (userId === state.currentUser?.id) return;
  const list = document.getElementById('online-list');
  if (!list) return;
  if (list.querySelector(`[data-user-id="${userId}"]`)) return; // déjà présent
  const emptyMsg = list.querySelector('.text-xs.text-secondary');
  if (emptyMsg) list.innerHTML = '';
  let user = { id: userId, username: username || '?' };
  try { user = await api('GET', `/api/users/${userId}`); } catch {}
  const el = document.createElement('div');
  el.className = 'online-user';
  el.dataset.userId = userId;
  const wrap = document.createElement('div');
  wrap.style.position = 'relative';
  const av = createAvatarEl(user, 'sm');
  const dot = document.createElement('div');
  dot.className = 'presence-dot online';
  wrap.appendChild(av);
  wrap.appendChild(dot);
  wrap.style.cursor = 'pointer';
  wrap.addEventListener('click', (e) => { e.stopPropagation(); openProfileModal(userId); });
  const name = document.createElement('div');
  name.className = 'online-user-name';
  name.textContent = user.username;
  el.appendChild(wrap);
  el.appendChild(name);
  el.addEventListener('click', async () => {
    try {
      const conv = await api('POST', '/api/conversations/private', { userId });
      if (!state.conversations.find(c => c.id === conv.id)) addConvToList(conv);
      openConversation(conv);
    } catch (err) {
      toast(err.message || 'Erreur', 'error');
    }
  });
  list.prepend(el);
}

function removeUserFromOnlineStrip(userId) {
  const list = document.getElementById('online-list');
  list?.querySelector(`[data-user-id="${userId}"]`)?.remove();
  if (list && !list.querySelector('.online-user')) {
    list.innerHTML = '<p class="text-xs text-secondary" style="padding:4px 0">Aucun utilisateur en ligne</p>';
  }
}

// ─── Firebase / Push Notifications ────────────────────────────────────────────
// Le Service Worker (firebase-messaging-sw.js) s'auto-initialise désormais
// avec la config injectée par le serveur : plus besoin de la lui transmettre
// par postMessage (qui pouvait ne jamais arriver si le SW n'était pas encore
// "active", ou si aucune page n'était ouverte). Ici on se contente de
// l'enregistrer, de récupérer le token FCM en lui étant explicitement
// rattaché (serviceWorkerRegistration), et d'écouter les messages reçus
// pendant que l'onglet est au premier plan (onMessage), pour lesquels le SW
// ne déclenche pas automatiquement onBackgroundMessage.
async function initFirebase() {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) return;
  try {
    const config = await api('GET', '/api/firebase-config');
    if (!config.apiKey || !config.vapidKey || typeof firebase === 'undefined') return;

    const swReg = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
    await navigator.serviceWorker.ready;

    if (!firebase.apps?.length) firebase.initializeApp(config);
    const messaging = firebase.messaging?.();
    if (!messaging) return;
    state.messaging = messaging;

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return;

    const token = await messaging.getToken({ vapidKey: config.vapidKey, serviceWorkerRegistration: swReg });
    if (token && token !== state.fcmToken) {
      state.fcmToken = token;
      await api('POST', '/api/fcm/token', { token });
    }

    // Message reçu pendant que l'onglet JEXCHAT est au premier plan (sur une
    // autre page/conversation) : le SW ne l'affiche pas tout seul dans ce
    // cas, donc on l'affiche nous-mêmes via le SW déjà enregistré — sauf si
    // l'utilisateur est justement en train de voir cette conversation (il
    // voit alors déjà le message arriver via Socket.IO).
    messaging.onMessage?.((payload) => {
      const data = payload.data || {};
      if (data.conversationId && data.conversationId === state.currentConvId && !document.hidden) return;
      const { title, body } = payload.notification || {};
      if (!title && !body) return;
      swReg.showNotification(title || 'JEXCHAT', {
        body: body || 'Nouveau message',
        icon: '/icon-192.png',
        badge: '/badge-72.png',
        tag: data.conversationId || 'jexchat',
        data: { conversationId: data.conversationId, url: '/messages' },
      });
    });
  } catch (err) {
    console.warn('[FCM]', err.message);
  }
}

// Clic sur une notification système alors que JEXCHAT est déjà ouvert dans un
// onglet : le Service Worker focus cet onglet et lui poste ce message pour
// qu'il ouvre directement la bonne conversation.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type !== 'NOTIFICATION_CLICK' || !event.data.conversationId) return;
    if (document.getElementById('conv-list')) {
      // Déjà sur la page Messages : ouvre directement la conversation.
      openConversationById(event.data.conversationId);
    } else {
      // Onglet focusé par le SW mais sur une autre page (accueil,
      // paramètres...) : on y va, avec le paramètre pour ouvrir la bonne
      // conversation une fois la page chargée.
      window.location.href = `/messages?conv=${encodeURIComponent(event.data.conversationId)}`;
    }
  });
}

// JEXCHAT n'était pas ouvert : le Service Worker ouvre /messages?conv=ID
// (voir firebase-messaging-sw.js). Une fois la liste des conversations
// chargée, on ouvre directement celle-ci.
function openConversationFromNotifParam() {
  const convId = new URLSearchParams(window.location.search).get('conv');
  if (!convId) return;
  history.replaceState(null, '', window.location.pathname);
  openConversationById(convId);
}

async function openConversationById(convId) {
  let conv = state.conversations?.find(c => c.id === convId);
  if (!conv) {
    try { conv = await api('GET', `/api/conversations/${convId}`); } catch { return; }
    if (conv && !state.conversations.find(c => c.id === conv.id)) addConvToList(conv);
  }
  if (conv) openConversation(conv);
}

// ─── Helpers ───────────────────────────────────────────────────────────────────
function escText(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function closeAllDropdowns() {
  document.querySelectorAll('.dropdown.open').forEach(d => d.remove());
}

function closeAllModals() {
  document.querySelectorAll('.modal-overlay.open').forEach(m => {
    m.classList.remove('open');
    setTimeout(() => m.remove(), 200);
  });
}

// ─── Page Initialization ───────────────────────────────────────────────────────

// INDEX PAGE
function initIndexPage() {
  loadTheme();
  renderSavedAccounts();
  setupAuthForms();
}

function renderSavedAccounts() {
  const accounts = getSavedAccounts();
  const container = document.getElementById('saved-accounts');
  if (!container) return;
  if (accounts.length === 0) { container.classList.add('hidden'); return; }
  container.classList.remove('hidden');
  const list = container.querySelector('#saved-accounts-list');
  if (!list) return;
  list.innerHTML = '';
  accounts.forEach(acc => {
    const el = document.createElement('div');
    el.className = 'saved-account-item';
    const av = createAvatarEl(acc, 'sm');
    el.appendChild(av);
    el.innerHTML += `
      <div class="saved-account-info">
        <div class="saved-account-name">${escText(acc.username)}</div>
        <div class="saved-account-sub">Compte enregistré</div>
      </div>`;
    const removeBtn = document.createElement('button');
    removeBtn.className = 'saved-account-remove';
    removeBtn.innerHTML = iconX();
    removeBtn.title = 'Retirer';
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeSavedAccount(acc.id);
      el.remove();
      if (list.children.length === 0) container.classList.add('hidden');
    });
    el.appendChild(removeBtn);
    el.addEventListener('click', (e) => {
      if (e.target.closest('.saved-account-remove')) return;
      loginWithSavedAccount(acc);
    });
    list.appendChild(el);
  });
}

async function loginWithSavedAccount(acc) {
  const passwordPrompt = document.getElementById('quick-login-modal');
  if (passwordPrompt) { passwordPrompt.remove(); }

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h3 class="modal-title">Connexion rapide</h3>
        <button class="btn-icon" id="ql-close">${iconX()}</button>
      </div>
      <div class="modal-body">
        <div class="flex items-center gap-3 mb-4">
          <div id="ql-avatar"></div>
          <div><div style="font-weight:700">${escText(acc.username)}</div><div class="text-secondary text-sm">Entrez votre mot de passe</div></div>
        </div>
        <div class="input-group">
          <input type="password" class="input" id="ql-password" placeholder="Mot de passe" autocomplete="current-password">
        </div>
        <div id="ql-error" class="input-error mt-2 hidden"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" id="ql-close2">Annuler</button>
        <button class="btn btn-primary" id="ql-submit">Se connecter</button>
      </div>
    </div>`;
  overlay.id = 'quick-login-modal';

  document.body.appendChild(overlay);
  const avContainer = overlay.querySelector('#ql-avatar');
  if (avContainer) avContainer.appendChild(createAvatarEl(acc, 'md'));

  setTimeout(() => overlay.classList.add('open'), 10);

  const close = () => { overlay.classList.remove('open'); setTimeout(() => overlay.remove(), 200); };
  document.getElementById('ql-close')?.addEventListener('click', close);
  document.getElementById('ql-close2')?.addEventListener('click', close);

  const submit = async () => {
    const password = document.getElementById('ql-password')?.value;
    if (!password) return;
    const btn = document.getElementById('ql-submit');
    btn.disabled = true;
    btn.innerHTML = `<div class="spinner spinner-sm"></div>`;
    try {
      const data = await api('POST', '/api/auth/login', { username: acc.username, password });
      state.currentUser = data.user;
      state.sessionToken = data.token;
      saveAccount(data.user, data.token);
      applyTheme(data.user.settings?.theme || 'light');
      window.location.href = '/messages';
    } catch (err) {
      const errEl = document.getElementById('ql-error');
      if (errEl) { errEl.textContent = err.message; errEl.classList.remove('hidden'); }
      btn.disabled = false;
      btn.textContent = 'Se connecter';
    }
  };

  document.getElementById('ql-submit')?.addEventListener('click', submit);
  document.getElementById('ql-password')?.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
  document.getElementById('ql-password')?.focus();
}

function setupAuthForms() {
  const loginTab = document.getElementById('login-tab');
  const registerTab = document.getElementById('register-tab');
  const loginForm = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');

  loginTab?.addEventListener('click', () => {
    loginTab.classList.add('active');
    registerTab?.classList.remove('active');
    loginForm?.classList.remove('hidden');
    registerForm?.classList.add('hidden');
  });

  registerTab?.addEventListener('click', () => {
    registerTab.classList.add('active');
    loginTab?.classList.remove('active');
    registerForm?.classList.remove('hidden');
    loginForm?.classList.add('hidden');
  });

  document.getElementById('login-submit')?.addEventListener('click', handleLogin);
  document.getElementById('register-submit')?.addEventListener('click', handleRegister);

  document.getElementById('login-form')?.addEventListener('keydown', e => { if (e.key === 'Enter') handleLogin(); });
  document.getElementById('register-form')?.addEventListener('keydown', e => { if (e.key === 'Enter') handleRegister(); });
}

async function handleLogin() {
  const username = document.getElementById('login-username')?.value.trim();
  const password = document.getElementById('login-password')?.value;
  const errEl = document.getElementById('login-error');
  const btn = document.getElementById('login-submit');

  if (!username || !password) { if (errEl) { errEl.textContent = 'Remplissez tous les champs.'; errEl.classList.remove('hidden'); } return; }
  if (errEl) errEl.classList.add('hidden');
  btn.disabled = true;
  btn.innerHTML = `<div class="spinner spinner-sm"></div>`;

  try {
    const data = await api('POST', '/api/auth/login', { username, password });
    state.currentUser = data.user;
    state.sessionToken = data.token;
    saveAccount(data.user, data.token);
    applyTheme(data.user.settings?.theme || 'light');
    window.location.href = '/messages';
  } catch (err) {
    if (errEl) { errEl.textContent = err.message; errEl.classList.remove('hidden'); }
    btn.disabled = false;
    btn.textContent = 'Se connecter';
  }
}

async function handleRegister() {
  const username = document.getElementById('reg-username')?.value.trim();
  const password = document.getElementById('reg-password')?.value;
  const confirm = document.getElementById('reg-confirm')?.value;
  const errEl = document.getElementById('reg-error');
  const btn = document.getElementById('register-submit');

  if (!username || !password) { if (errEl) { errEl.textContent = 'Remplissez tous les champs.'; errEl.classList.remove('hidden'); } return; }
  if (password !== confirm) { if (errEl) { errEl.textContent = 'Les mots de passe ne correspondent pas.'; errEl.classList.remove('hidden'); } return; }
  if (errEl) errEl.classList.add('hidden');
  btn.disabled = true;
  btn.innerHTML = `<div class="spinner spinner-sm"></div>`;

  try {
    const data = await api('POST', '/api/auth/register', { username, password });
    state.currentUser = data.user;
    state.sessionToken = data.token;
    saveAccount(data.user, data.token);
    window.location.href = '/messages';
  } catch (err) {
    if (errEl) { errEl.textContent = err.message; errEl.classList.remove('hidden'); }
    btn.disabled = false;
    btn.textContent = 'Créer le compte';
  }
}

// MESSAGES PAGE
async function initMessagesPage() {
  loadTheme();
  try {
    const user = await api('GET', '/api/auth/me');
    state.currentUser = user;
    state.sessionToken = localStorage.getItem(SESSION_TOKEN_KEY);
    applyTheme(user.settings?.theme || 'light');
  } catch {
    // Lien partagé (/lapage/pseudo[/actu/ID]) : un visiteur non connecté doit
    // pouvoir voir le profil/la publication publique visée, sans être
    // renvoyé vers la connexion et sans que le reste de l'app (conversations,
    // Socket.IO, etc., qui nécessitent un compte) ne se charge.
    if (/^\/lapage\//.test(window.location.pathname)) {
      await handleSharedLinkRoute();
      return;
    }
    window.location.href = '/';
    return;
  }

  // Requêtes indépendantes lancées en parallèle (au lieu de s'attendre l'une
  // l'autre) : chacune garde exactement le même traitement qu'avant
  // (blocked-list continue d'échouer silencieusement, les autres restent
  // bloquantes en cas d'erreur), seul l'ordre d'exécution change.
  const blockedPromise = api('GET', '/api/users/blocked/list').catch(() => []);

  const [, convs, count] = await Promise.all([
    loadOnlineUsers(),
    api('GET', '/api/conversations'),
    api('GET', '/api/notifications/count'),
  ]);
  state.conversations = convs;
  renderConvList(convs);

  // Accueil : la barre "En ligne" reste visible, mais on affiche les
  // Actualités par défaut plutôt que la liste des conversations (qui ne
  // s'ouvre que via le bouton Message).
  showPublicationsView();

  state.blockedUsers = new Set((await blockedPromise).map(u => u.id));

  state.notifCount = count.count || 0;
  updateNotifBadge();

  initSocket(state.sessionToken);

  // Notifications FCM : lancée en tâche de fond, ne doit jamais bloquer ni faire
  // échouer le reste de l'initialisation de la page (initFirebase gère déjà ses
  // propres erreurs en interne et ne relance jamais).
  initFirebase();

  // Search
  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    searchInput.addEventListener('input', debounce(e => handleSearch(e.target.value), 300));
    searchInput.addEventListener('input', () => { if (state.posts.open) showConversationsView(); });
    searchInput.addEventListener('focus', () => searchInput.classList.add('focused'));
    searchInput.addEventListener('blur', () => { setTimeout(() => { if (!searchInput.value) renderConvList(state.conversations); }, 200); });
  }

  // New group button
  document.getElementById('new-group-btn')?.addEventListener('click', openCreateGroupModal);

  // Notification button
  document.getElementById('notif-btn')?.addEventListener('click', toggleNotifPanel);

  // Publications
  document.getElementById('publications-btn')?.addEventListener('click', togglePublicationsPanel);
  document.getElementById('new-post-btn')?.addEventListener('click', openComposePostModal);

  // Settings
  document.getElementById('settings-btn')?.addEventListener('click', () => window.location.href = '/settings');

  // Chat input
  const textarea = document.getElementById('chat-textarea');
  textarea?.addEventListener('input', () => {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
    sendTypingStart();
  });

  textarea?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const sendBtn = document.getElementById('send-btn');
      if (sendBtn?.dataset.editMode) confirmEdit();
      else sendMessage();
    }
  });

  const sendBtn = document.getElementById('send-btn');
  sendBtn?.addEventListener('click', () => {
    if (sendBtn.dataset.editMode) confirmEdit();
    else sendMessage();
  });

  document.getElementById('reply-cancel')?.addEventListener('click', clearReplyTo);

  // Attach menu
  const attachBtn = document.getElementById('attach-btn');
  attachBtn?.addEventListener('click', () => {
    const menu = document.createElement('div');
    menu.className = 'dropdown open';
    const items = [
      { icon: iconImage(), label: 'Image (URL)', type: 'image' },
      { icon: iconLink(), label: 'Lien', type: 'link' },
      { icon: iconLink(), label: 'Vidéo (URL)', type: 'video' },
      { icon: iconLink(), label: 'Audio (URL)', type: 'audio' },
    ];
    items.forEach(item => {
      const el = document.createElement('div');
      el.className = 'dropdown-item';
      el.innerHTML = item.icon + `<span>${escText(item.label)}</span>`;
      el.addEventListener('click', () => {
        const url = prompt(`URL ${item.label} (HTTPS) :`);
        if (url) sendMediaMessage(url, item.type);
        menu.remove();
      });
      menu.appendChild(el);
    });
    const rect = attachBtn.getBoundingClientRect();
    menu.style.cssText = `position:fixed;bottom:${window.innerHeight - rect.top + 4}px;left:${rect.left}px;`;
    document.body.appendChild(menu);
    setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 50);
  });

  // Mobile back button
  document.getElementById('mobile-back')?.addEventListener('click', closeMobileChat);

  // Show placeholder initially on desktop
  if (window.innerWidth > 768) {
    showChatPlaceholder();
  }

  // Refresh online users every 60s
  // Filet de sécurité seulement : les mises à jour normales sont en temps réel
  // via Socket.IO (addUserToOnlineStrip / removeUserFromOnlineStrip).
  setInterval(loadOnlineUsers, 5 * 60 * 1000);

  // Lien partagé (/lapage/pseudo ou /lapage/pseudo/actu/ID) : ouvre le profil
  // ou la publication ciblée directement, sans recharger tout le fil.
  handleSharedLinkRoute();

  // Notification système cliquée alors que JEXCHAT n'était pas ouvert
  // (?conv=ID ajouté par le Service Worker) : ouvre directement cette
  // conversation.
  openConversationFromNotifParam();
}

// ─── Publications (Actualités) ─────────────────────────────────────────────────
// Panneau séparé de la liste des conversations. L'icône dans la barre
// horizontale (inchangée) bascule entre les deux ; aucune reconstruction de
// page complète. La barre horizontale "En ligne" reste toujours visible, au
// même endroit, dans les deux vues — seul le panneau du dessous change.
function showPublicationsView() {
  const feedPanel = document.getElementById('publications-panel');
  const convList = document.getElementById('conv-list');
  const btn = document.getElementById('publications-btn');
  if (!feedPanel || !convList) return;
  state.posts.open = true;
  feedPanel.style.display = 'block';
  convList.style.display = 'none';
  if (btn) { btn.innerHTML = iconMsg(); btn.title = 'Messages'; }
  if (state.posts.skip === 0 && !document.getElementById('publications-feed').children.length) {
    loadPublicationsFeed(true);
  }
}

function showConversationsView() {
  const feedPanel = document.getElementById('publications-panel');
  const convList = document.getElementById('conv-list');
  const btn = document.getElementById('publications-btn');
  if (!feedPanel || !convList) return;
  state.posts.open = false;
  feedPanel.style.display = 'none';
  convList.style.display = 'block';
  if (btn) { btn.innerHTML = iconUsers(); btn.title = 'Publications'; }
}

function togglePublicationsPanel() {
  if (state.posts.open) showConversationsView();
  else showPublicationsView();
}

async function loadPublicationsFeed(reset = false) {
  if (state.posts.loading) return;
  if (reset) { state.posts.skip = 0; state.posts.hasMore = true; document.getElementById('publications-feed').innerHTML = ''; }
  if (!state.posts.hasMore) return;
  state.posts.loading = true;
  const feed = document.getElementById('publications-feed');
  feed.querySelector('.load-more-btn')?.remove();
  // Animation de chargement légère (skeletons déjà utilisés ailleurs dans
  // l'app) pendant la requête, retirée dès que les publications arrivent ;
  // ne bloque jamais l'interface (le fil déjà chargé reste visible et
  // utilisable au-dessus).
  const skeletonWrap = renderPostsSkeleton();
  feed.appendChild(skeletonWrap);
  try {
    const posts = await api('GET', `/api/posts?skip=${state.posts.skip}&limit=15`);
    skeletonWrap.remove();
    if (posts.length === 0 && state.posts.skip === 0) {
      feed.innerHTML = '<div class="empty-state" style="padding:24px"><p>Aucune publication pour le moment</p></div>';
      state.posts.hasMore = false;
      state.posts.loading = false;
      return;
    }
    posts.forEach((p) => feed.appendChild(renderPostCard(p)));
    state.posts.skip += posts.length;
    state.posts.hasMore = posts.length === 15;
    if (state.posts.hasMore) {
      const btn = document.createElement('button');
      btn.className = 'load-more-btn btn btn-ghost';
      btn.style.cssText = 'width:calc(100% - 24px);margin:8px 12px';
      btn.textContent = 'Charger plus';
      btn.addEventListener('click', () => loadPublicationsFeed(false));
      feed.appendChild(btn);
    }
  } catch (err) {
    skeletonWrap.remove();
    toast(err.message || 'Erreur de chargement', 'error');
  } finally {
    state.posts.loading = false;
  }
}

// Skeletons légers (CSS only, déjà utilisés ailleurs dans l'app) affichés le
// temps que les publications se chargent, sans bibliothèque externe.
function renderPostsSkeleton() {
  const wrap = document.createElement('div');
  wrap.className = 'posts-skeleton';
  for (let i = 0; i < 3; i++) {
    const card = document.createElement('div');
    card.className = 'card card-body';
    card.style.margin = '8px 12px';
    card.innerHTML = `
      <div class="flex items-center gap-2">
        <div class="skeleton" style="width:36px;height:36px;border-radius:50%"></div>
        <div style="flex:1">
          <div class="skeleton" style="height:12px;width:40%;border-radius:6px"></div>
          <div class="skeleton" style="height:10px;width:25%;border-radius:6px;margin-top:6px"></div>
        </div>
      </div>
      <div class="skeleton" style="height:80px;border-radius:10px;margin-top:10px"></div>`;
    wrap.appendChild(card);
  }
  return wrap;
}

function renderPostCard(post) {
  const card = document.createElement('div');
  card.className = 'card card-body';
  card.style.margin = '8px 12px';
  card.dataset.postId = post.id;

  const header = document.createElement('div');
  header.className = 'flex items-center gap-2';
  const av = createAvatarEl(post.author, 'sm');
  av.style.cursor = 'pointer';
  av.addEventListener('click', () => post.author && openProfileModal(post.author.id));
  header.appendChild(av);
  const info = document.createElement('div');
  info.style.cssText = 'flex:1;cursor:pointer';
  info.innerHTML = `<div style="font-weight:600">${escText(post.author?.username || 'Utilisateur')}</div><div class="text-xs text-secondary">${escText(formatRelativeTime(post.createdAt))}</div>`;
  info.addEventListener('click', () => post.author && openProfileModal(post.author.id));
  header.appendChild(info);
  card.appendChild(header);

  if (post.content) {
    const p = document.createElement('p');
    p.style.cssText = 'margin-top:10px;white-space:pre-wrap;word-break:break-word';
    p.textContent = post.content;
    card.appendChild(p);
  }

  card.appendChild(renderPostMedia(post));

  if (post.description) {
    const d = document.createElement('p');
    d.className = 'text-sm text-secondary';
    d.style.marginTop = '6px';
    d.textContent = post.description;
    card.appendChild(d);
  }

  // Partage référencé (contenu original affiché, jamais dupliqué en base)
  if (post.sharedFrom) {
    const shared = document.createElement('div');
    shared.style.cssText = 'border:1px solid var(--color-border, #e5e7eb);border-radius:10px;padding:10px;margin-top:10px';
    if (post.sharedFrom.deleted) {
      shared.innerHTML = '<div class="text-xs text-secondary">Publication originale supprimée</div>';
    } else {
      const sHeader = document.createElement('div');
      sHeader.className = 'flex items-center gap-2';
      const sAv = createAvatarEl(post.sharedFrom.author, 'sm');
      sHeader.appendChild(sAv);
      const sName = document.createElement('div');
      sName.style.fontWeight = '600';
      sName.textContent = post.sharedFrom.author?.username || 'Utilisateur';
      sHeader.appendChild(sName);
      shared.appendChild(sHeader);
      if (post.sharedFrom.content) {
        const sp = document.createElement('p');
        sp.style.cssText = 'margin-top:6px;white-space:pre-wrap;word-break:break-word';
        sp.textContent = post.sharedFrom.content;
        shared.appendChild(sp);
      }
      shared.appendChild(renderPostMedia(post.sharedFrom));
    }
    card.appendChild(shared);
  }

  // Actions : like / partager / supprimer
  const actions = document.createElement('div');
  actions.className = 'flex items-center gap-3';
  actions.style.marginTop = '10px';

  const likeBtn = document.createElement('button');
  likeBtn.className = 'btn-icon post-like-btn';
  likeBtn.style.cssText = 'width:auto;padding:4px 10px;gap:6px;display:flex;align-items:center;color:' + (post.likedByMe ? '#EF4444' : 'inherit');
  likeBtn.innerHTML = `${iconHeart()}<span class="post-like-count">${post.likesCount || 0}</span>`;
  likeBtn.addEventListener('click', () => togglePostLikeAction(post.id, likeBtn));
  actions.appendChild(likeBtn);

  const shareBtn = document.createElement('button');
  shareBtn.className = 'btn-icon';
  shareBtn.style.cssText = 'width:auto;padding:4px 10px;gap:6px;display:flex;align-items:center';
  shareBtn.innerHTML = `${iconShare()}<span>${post.sharesCount || 0}</span>`;
  shareBtn.addEventListener('click', () => sharePostAction(post));
  actions.appendChild(shareBtn);

  if (post.author?.id === state.currentUser?.id) {
    const delBtn = document.createElement('button');
    delBtn.className = 'btn-icon';
    delBtn.style.marginLeft = 'auto';
    delBtn.innerHTML = iconTrash();
    delBtn.addEventListener('click', () => deletePostAction(post.id, card));
    actions.appendChild(delBtn);
  }

  card.appendChild(actions);
  return card;
}

function renderPostMedia(post) {
  const wrap = document.createElement('div');
  if (!post.mediaUrl || post.mediaType === 'none') return wrap;
  wrap.style.marginTop = '8px';
  if (post.mediaType === 'image') {
    const img = document.createElement('img');
    img.src = post.mediaUrl;
    img.loading = 'lazy';
    img.style.cssText = 'max-width:100%;border-radius:10px;display:block';
    wrap.appendChild(img);
  } else if (post.mediaType === 'video') {
    wrap.appendChild(buildVideoPlayer(post.mediaUrl));
  } else if (post.mediaType === 'link') {
    const a = document.createElement('a');
    a.href = post.mediaUrl;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.className = 'flex items-center gap-2';
    a.style.cssText = 'color:var(--color-primary);word-break:break-all';
    a.innerHTML = `${iconLink()}<span>${escText(post.mediaUrl)}</span>`;
    wrap.appendChild(a);
  }
  return wrap;
}

async function togglePostLikeAction(postId, btnEl) {
  try {
    const result = await api('POST', `/api/posts/${postId}/like`);
    updatePostLikeUI(postId, result.likesCount, result.liked);
  } catch (err) {
    toast(err.message || 'Erreur', 'error');
  }
}

function updatePostLikeUI(postId, likesCount, liked) {
  document.querySelectorAll(`[data-post-id="${postId}"] .post-like-btn`).forEach((btn) => {
    btn.querySelector('.post-like-count').textContent = likesCount;
    if (liked !== undefined) btn.style.color = liked ? '#EF4444' : 'inherit';
  });
}

async function sharePostAction(post) {
  const postId = typeof post === 'string' ? post : post.id;
  const postUrl = (typeof post === 'object' && post.author?.username)
    ? `${window.location.origin}/lapage/${encodeURIComponent(post.author.username)}/actu/${postId}`
    : null;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h3 class="modal-title">Partager la publication</h3>
        <button class="btn-icon" id="share-close">${iconX()}</button>
      </div>
      <div class="modal-body">
        ${postUrl ? `
        <div class="flex gap-2 mb-4">
          <button class="btn btn-ghost flex-1" id="share-copy-link">${iconCopy()}<span style="margin-left:6px">Copier le lien</span></button>
          <button class="btn btn-ghost flex-1" id="share-native">${iconShare()}<span style="margin-left:6px">Partager</span></button>
        </div>` : ''}
        <label class="input-label" style="margin-bottom:8px;display:block">Envoyer dans une discussion</label>
        <div class="input-group mb-3">
          <label class="input-label">Commentaire (optionnel)</label>
          <input type="text" class="input" id="share-desc" maxlength="300" placeholder="Ajouter un commentaire...">
        </div>
        <div id="share-conv-list" class="user-select-list"></div>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  setTimeout(() => overlay.classList.add('open'), 10);
  const close = () => { overlay.classList.remove('open'); setTimeout(() => overlay.remove(), 200); };
  document.getElementById('share-close')?.addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  if (postUrl) {
    document.getElementById('share-copy-link')?.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(postUrl); toast('Lien copié', 'success'); }
      catch { toast(postUrl, 'info', 6000); }
    });
    document.getElementById('share-native')?.addEventListener('click', () => {
      shareOrCopy(postUrl, 'Publication JEXCHAT');
    });
  }

  const list = document.getElementById('share-conv-list');
  const convs = state.conversations.length ? state.conversations : await api('GET', '/api/conversations');
  if (!convs.length) {
    list.innerHTML = '<div class="text-secondary text-sm" style="padding:8px">Aucune discussion disponible</div>';
    return;
  }
  convs.forEach(conv => {
    const other = conv.type === 'private' ? conv.otherUser : null;
    const name = conv.name || other?.username || 'Conversation';
    const el = document.createElement('div');
    el.className = 'admin-table-row';
    el.style.cssText = 'border-radius:8px;margin-bottom:4px;cursor:pointer';
    const av = createAvatarEl(other || { username: name, identity: null }, 'sm');
    const info = document.createElement('div');
    info.className = 'admin-row-info';
    info.innerHTML = `<div class="admin-row-name">${escText(name)}</div>`;
    el.appendChild(av);
    el.appendChild(info);
    el.addEventListener('click', async () => {
      const description = (document.getElementById('share-desc')?.value || '').substring(0, 300);
      try {
        await api('POST', `/api/posts/${postId}/share`, { conversationId: conv.id, description });
        toast('Publication partagée', 'success');
        close();
      } catch (err) {
        toast(err.message || 'Erreur de partage', 'error');
      }
    });
    list.appendChild(el);
  });
}

async function deletePostAction(postId, cardEl) {
  if (!confirm('Supprimer cette publication ?')) return;
  try {
    await api('DELETE', `/api/posts/${postId}`);
    cardEl?.remove();
  } catch (err) {
    toast(err.message || 'Erreur', 'error');
  }
}

function prependPostToFeed(post) {
  const feed = document.getElementById('publications-feed');
  if (!feed) return;
  feed.querySelector('.empty-state')?.remove();
  feed.prepend(renderPostCard(post));
  state.posts.skip++;
}

function removePostFromFeed(postId) {
  document.querySelectorAll(`[data-post-id="${postId}"]`).forEach((el) => el.remove());
}

// ─── Compose Post Modal ─────────────────────────────────────────────────────────
function openComposePostModal() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <div class="modal-title">Nouvelle publication</div>
        <button class="btn-icon" id="post-modal-close">${iconX()}</button>
      </div>
      <div class="modal-body">
        <div class="input-group mb-3">
          <label class="input-label">Texte</label>
          <textarea class="input" id="post-content" rows="3" maxlength="2000" placeholder="Quoi de neuf ?"></textarea>
        </div>
        <div class="input-group mb-3">
          <label class="input-label">Type de média</label>
          <select class="input" id="post-media-type">
            <option value="none">Aucun</option>
            <option value="image">Image (URL)</option>
            <option value="video">Vidéo (URL)</option>
            <option value="link">Lien</option>
          </select>
        </div>
        <div class="input-group mb-3 hidden" id="post-media-url-group">
          <label class="input-label">URL (HTTPS)</label>
          <input type="url" class="input" id="post-media-url" placeholder="https://...">
        </div>
        <div class="input-group mb-3">
          <label class="input-label">Description (optionnelle, 300 caractères max)</label>
          <textarea class="input" id="post-description" rows="2" maxlength="300"></textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" id="post-cancel">Annuler</button>
        <button class="btn btn-primary" id="post-submit">Publier</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  setTimeout(() => overlay.classList.add('open'), 10);
  const close = () => { overlay.classList.remove('open'); setTimeout(() => overlay.remove(), 200); };
  document.getElementById('post-modal-close')?.addEventListener('click', close);
  document.getElementById('post-cancel')?.addEventListener('click', close);
  document.getElementById('post-media-type')?.addEventListener('change', (e) => {
    document.getElementById('post-media-url-group').classList.toggle('hidden', e.target.value === 'none');
  });
  document.getElementById('post-submit')?.addEventListener('click', async () => {
    const content = document.getElementById('post-content').value.trim();
    const mediaType = document.getElementById('post-media-type').value;
    const mediaUrl = document.getElementById('post-media-url').value.trim();
    const description = document.getElementById('post-description').value.trim();
    if (!content && mediaType === 'none') { toast('Ajoutez du texte ou un média', 'error'); return; }
    if (mediaType !== 'none' && !mediaUrl) { toast('URL requise pour ce type de média', 'error'); return; }
    try {
      await api('POST', '/api/posts', { content, mediaType, mediaUrl, description });
      close();
      toast('Publication créée', 'success');
    } catch (err) {
      toast(err.message || 'Erreur', 'error');
    }
  });
}

// ─── Profile Modal ──────────────────────────────────────────────────────────────
async function openProfileModal(userId) {
  if (!userId) return;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <div class="modal-title">Profil</div>
        <button class="btn-icon" id="profile-modal-close">${iconX()}</button>
      </div>
      <div class="modal-body" id="profile-modal-body">
        <div class="skeleton" style="height:80px;border-radius:12px"></div>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  setTimeout(() => overlay.classList.add('open'), 10);
  const close = () => { overlay.classList.remove('open'); setTimeout(() => overlay.remove(), 200); };
  document.getElementById('profile-modal-close')?.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  const body = document.getElementById('profile-modal-body');
  let user;
  try {
    user = await api('GET', `/api/users/${userId}`);
  } catch (err) {
    body.innerHTML = '<p class="text-secondary">Utilisateur introuvable.</p>';
    return;
  }

  const isOnline = state.onlineUsers.has(user.id);
  const isBlocked = state.blockedUsers.has(user.id);
  const isSelf = user.id === state.currentUser?.id;

  body.innerHTML = '';
  const header = document.createElement('div');
  header.className = 'flex items-center gap-3';
  header.appendChild(createAvatarEl(user, 'xl'));
  const info = document.createElement('div');
  info.style.flex = '1';
  info.innerHTML = `<div style="font-weight:700;font-size:1.125rem">${escText(user.username)}</div><div class="text-sm ${isOnline ? 'text-success' : 'text-secondary'}">${isOnline ? 'En ligne' : formatLastSeen(user.lastSeen)}</div>`;
  header.appendChild(info);
  const shareProfileBtn = document.createElement('button');
  shareProfileBtn.className = 'btn-icon';
  shareProfileBtn.title = 'Partager le profil';
  shareProfileBtn.innerHTML = iconShare();
  shareProfileBtn.addEventListener('click', () => {
    shareOrCopy(`${window.location.origin}/lapage/${encodeURIComponent(user.username)}`, `${user.username} sur JEXCHAT`);
  });
  header.appendChild(shareProfileBtn);
  body.appendChild(header);

  if (!isSelf && state.currentUser) {
    const actions = document.createElement('div');
    actions.className = 'flex gap-2';
    actions.style.marginTop = '14px';
    const msgBtn = document.createElement('button');
    msgBtn.className = 'btn btn-primary';
    msgBtn.textContent = 'Message';
    msgBtn.addEventListener('click', async () => {
      try {
        const conv = await api('POST', '/api/conversations/private', { userId: user.id });
        if (!state.conversations.find(c => c.id === conv.id)) addConvToList(conv);
        close();
        openConversation(conv);
      } catch (err) { toast(err.message || 'Erreur', 'error'); }
    });
    actions.appendChild(msgBtn);

    const blockBtn = document.createElement('button');
    blockBtn.className = 'btn btn-ghost';
    blockBtn.textContent = isBlocked ? 'Débloquer' : 'Bloquer';
    blockBtn.addEventListener('click', async () => {
      try {
        if (state.blockedUsers.has(user.id)) {
          await api('POST', `/api/users/unblock/${user.id}`);
          state.blockedUsers.delete(user.id);
          blockBtn.textContent = 'Bloquer';
          toast('Utilisateur débloqué', 'success');
        } else {
          await api('POST', `/api/users/block/${user.id}`);
          state.blockedUsers.add(user.id);
          blockBtn.textContent = 'Débloquer';
          toast('Utilisateur bloqué', 'success');
        }
      } catch (err) { toast(err.message || 'Erreur', 'error'); }
    });
    actions.appendChild(blockBtn);
    body.appendChild(actions);
  }

  const postsTitle = document.createElement('div');
  postsTitle.className = 'text-sm text-secondary';
  postsTitle.style.cssText = 'margin-top:18px;margin-bottom:6px;font-weight:600';
  postsTitle.textContent = 'Publications';
  body.appendChild(postsTitle);

  const postsList = document.createElement('div');
  postsList.id = 'profile-posts-list';
  body.appendChild(postsList);

  await loadProfilePosts(user.id, postsList, 0);
}

// ─── Post Modal (lien direct /lapage/pseudo/actu/ID) ────────────────────────────
// N'affiche que la publication ciblée : aucune autre publication n'est
// chargée pour ouvrir ce lien.
async function openPostModal(postId) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <div class="modal-title">Publication</div>
        <button class="btn-icon" id="post-modal-close">${iconX()}</button>
      </div>
      <div class="modal-body" id="post-modal-body">
        <div class="skeleton" style="height:120px;border-radius:12px"></div>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  setTimeout(() => overlay.classList.add('open'), 10);
  const close = () => { overlay.classList.remove('open'); setTimeout(() => overlay.remove(), 200); };
  document.getElementById('post-modal-close')?.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  const body = document.getElementById('post-modal-body');
  try {
    const post = await api('GET', `/api/posts/${postId}`);
    body.innerHTML = '';
    body.appendChild(renderPostCard(post));
  } catch (err) {
    body.innerHTML = `<p class="text-secondary">${escText(err.message || 'Publication introuvable.')}</p>`;
  }
}

// Analyse l'URL au chargement de la page Messages pour ouvrir directement un
// profil ou une publication partagés (/lapage/pseudo ou
// /lapage/pseudo/actu/ID), sans jamais charger tout le fil pour autant.
async function handleSharedLinkRoute() {
  const match = window.location.pathname.match(/^\/lapage\/([^/]+)(?:\/actu\/([^/]+))?\/?$/);
  if (!match) return;
  const [, pseudo, postId] = match;
  try {
    const user = await api('GET', `/api/users/by-username/${encodeURIComponent(decodeURIComponent(pseudo))}`);
    if (postId) {
      await openPostModal(postId);
    } else {
      await openProfileModal(user.id);
    }
  } catch {
    toast('Lien introuvable ou expiré', 'error');
  }
}

async function loadProfilePosts(userId, container, skip) {
  container.querySelector('.load-more-btn')?.remove();
  try {
    const posts = await api('GET', `/api/posts/user/${userId}?skip=${skip}&limit=10`);
    if (posts.length === 0 && skip === 0) {
      container.innerHTML = '<p class="text-sm text-secondary">Aucune publication.</p>';
      return;
    }
    posts.forEach((p) => container.appendChild(renderPostCard(p)));
    if (posts.length === 10) {
      const btn = document.createElement('button');
      btn.className = 'load-more-btn btn btn-ghost';
      btn.style.cssText = 'width:100%;margin-top:8px';
      btn.textContent = 'Charger plus';
      btn.addEventListener('click', () => loadProfilePosts(userId, container, skip + 10));
      container.appendChild(btn);
    }
  } catch {
    container.innerHTML = '<p class="text-sm text-secondary">Erreur de chargement.</p>';
  }
}

// SETTINGS PAGE
async function initSettingsPage() {
  loadTheme();
  try {
    const user = await api('GET', '/api/auth/me');
    state.currentUser = user;
    setupSettings(user);
  } catch {
    window.location.href = '/';
  }
}

function setupSettings(user) {
  // Back button
  document.getElementById('settings-back')?.addEventListener('click', () => window.location.href = '/messages');

  // Theme toggle
  const themeToggle = document.getElementById('theme-toggle');
  if (themeToggle) {
    themeToggle.checked = user.settings?.theme === 'dark';
    themeToggle.addEventListener('change', async () => {
      const theme = themeToggle.checked ? 'dark' : 'light';
      applyTheme(theme);
      try { await api('PUT', '/api/settings', { theme }); } catch {}
    });
  }

  // Notifications toggle
  const notifToggle = document.getElementById('notif-toggle');
  if (notifToggle) {
    notifToggle.checked = user.settings?.notifications !== false;
    notifToggle.addEventListener('change', async () => {
      try { await api('PUT', '/api/settings', { notifications: notifToggle.checked }); } catch {}
    });
  }

  // Accent colors
  const colors = ['#3B6EF5', '#EF4444', '#22C55E', '#F59E0B', '#EC4899', '#06B6D4', '#8B5CF6', '#F97316'];
  const colorsEl = document.getElementById('accent-colors');
  if (colorsEl) {
    colors.forEach(c => {
      const dot = document.createElement('div');
      dot.className = `color-dot${user.settings?.accentColor === c ? ' selected' : ''}`;
      dot.style.background = c;
      dot.addEventListener('click', async () => {
        colorsEl.querySelectorAll('.color-dot').forEach(d => d.classList.remove('selected'));
        dot.classList.add('selected');
        document.documentElement.style.setProperty('--color-primary', c);
        try { await api('PUT', '/api/settings', { accentColor: c }); } catch {}
      });
      colorsEl.appendChild(dot);
    });
  }

  // Username change
  document.getElementById('change-username-btn')?.addEventListener('click', () => openChangeUsernameModal(user));

  // Password change
  document.getElementById('change-password-btn')?.addEventListener('click', openChangePasswordModal);

  // Blocked users
  document.getElementById('blocked-users-btn')?.addEventListener('click', loadBlockedUsers);

  // Sessions
  document.getElementById('sessions-btn')?.addEventListener('click', loadSessions);

  // Logout
  document.getElementById('logout-btn')?.addEventListener('click', async () => {
    try {
      await api('POST', '/api/auth/logout');
    } catch {}
    clearSessionToken();
    window.location.href = '/';
  });

  // Logout all
  document.getElementById('logout-all-btn')?.addEventListener('click', async () => {
    if (!confirm('Déconnecter tous les appareils ?')) return;
    try {
      await api('DELETE', '/api/sessions');
      clearSessionToken();
      window.location.href = '/';
    } catch (err) {
      toast(err.message || 'Erreur', 'error');
    }
  });

  // Delete account
  document.getElementById('delete-account-btn')?.addEventListener('click', openDeleteAccountModal);

  // Partager JEXCHAT
  document.getElementById('share-site-btn')?.addEventListener('click', () => {
    shareOrCopy(window.location.origin + '/', 'JEXCHAT');
  });

  // Partager mon profil
  document.getElementById('share-profile-btn')?.addEventListener('click', () => {
    if (!user.username) return;
    shareOrCopy(`${window.location.origin}/lapage/${encodeURIComponent(user.username)}`, `${user.username} sur JEXCHAT`);
  });

  // Saved accounts
  loadSavedAccountsInSettings();
}

function loadSavedAccountsInSettings() {
  const container = document.getElementById('saved-accounts-settings');
  if (!container) return;
  const accounts = getSavedAccounts();
  container.innerHTML = '';
  if (accounts.length === 0) {
    container.innerHTML = '<p class="text-sm text-secondary">Aucun compte enregistré sur cet appareil</p>';
    return;
  }
  accounts.forEach(acc => {
    const el = document.createElement('div');
    el.className = 'admin-table-row';
    el.style.borderRadius = '8px';
    el.style.marginBottom = '4px';
    const av = createAvatarEl(acc, 'sm');
    const info = document.createElement('div');
    info.className = 'admin-row-info';
    info.innerHTML = `<div class="admin-row-name">${escText(acc.username)}</div>`;
    const rmBtn = document.createElement('button');
    rmBtn.className = 'btn btn-ghost btn-sm';
    rmBtn.innerHTML = iconTrash();
    rmBtn.style.color = 'var(--color-error)';
    rmBtn.addEventListener('click', () => {
      removeSavedAccount(acc.id);
      el.remove();
    });
    el.appendChild(av);
    el.appendChild(info);
    el.appendChild(rmBtn);
    container.appendChild(el);
  });
}

function openChangeUsernameModal(user) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header"><h3 class="modal-title">Changer de pseudo</h3><button class="btn-icon" id="cu-close">${iconX()}</button></div>
      <div class="modal-body">
        <div class="input-group">
          <label class="input-label">Nouveau pseudo</label>
          <input type="text" class="input" id="cu-input" value="${escText(user.username)}" maxlength="32">
        </div>
        <div id="cu-error" class="input-error mt-2 hidden"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" id="cu-cancel">Annuler</button>
        <button class="btn btn-primary" id="cu-save">Sauvegarder</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  setTimeout(() => overlay.classList.add('open'), 10);

  const close = () => { overlay.classList.remove('open'); setTimeout(() => overlay.remove(), 200); };
  document.getElementById('cu-close')?.addEventListener('click', close);
  document.getElementById('cu-cancel')?.addEventListener('click', close);
  document.getElementById('cu-save')?.addEventListener('click', async () => {
    const val = document.getElementById('cu-input')?.value.trim();
    try {
      const res = await api('PUT', '/api/settings/username', { username: val });
      user.username = res.username;
      document.getElementById('settings-username')?.textContent && (document.getElementById('settings-username').textContent = res.username);
      toast('Pseudo mis à jour', 'success');
      close();
    } catch (err) {
      const e = document.getElementById('cu-error');
      if (e) { e.textContent = err.message; e.classList.remove('hidden'); }
    }
  });
}

function openChangePasswordModal() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header"><h3 class="modal-title">Changer le mot de passe</h3><button class="btn-icon" id="cp-close">${iconX()}</button></div>
      <div class="modal-body">
        <div class="input-group mb-3">
          <label class="input-label">Mot de passe actuel</label>
          <input type="password" class="input" id="cp-current" autocomplete="current-password">
        </div>
        <div class="input-group mb-3">
          <label class="input-label">Nouveau mot de passe</label>
          <input type="password" class="input" id="cp-new" autocomplete="new-password">
        </div>
        <div class="input-group">
          <label class="input-label">Confirmer</label>
          <input type="password" class="input" id="cp-confirm" autocomplete="new-password">
        </div>
        <div id="cp-error" class="input-error mt-2 hidden"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" id="cp-cancel">Annuler</button>
        <button class="btn btn-primary" id="cp-save">Changer</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  setTimeout(() => overlay.classList.add('open'), 10);
  const close = () => { overlay.classList.remove('open'); setTimeout(() => overlay.remove(), 200); };
  document.getElementById('cp-close')?.addEventListener('click', close);
  document.getElementById('cp-cancel')?.addEventListener('click', close);
  document.getElementById('cp-save')?.addEventListener('click', async () => {
    const current = document.getElementById('cp-current')?.value;
    const newPwd = document.getElementById('cp-new')?.value;
    const confirm = document.getElementById('cp-confirm')?.value;
    if (newPwd !== confirm) { const e = document.getElementById('cp-error'); if (e) { e.textContent = 'Les mots de passe ne correspondent pas.'; e.classList.remove('hidden'); } return; }
    try {
      await api('PUT', '/api/settings/password', { currentPassword: current, newPassword: newPwd });
      toast('Mot de passe mis à jour', 'success');
      close();
    } catch (err) {
      const e = document.getElementById('cp-error');
      if (e) { e.textContent = err.message; e.classList.remove('hidden'); }
    }
  });
}

function openDeleteAccountModal() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header"><h3 class="modal-title" style="color:var(--color-error)">Supprimer le compte</h3><button class="btn-icon" id="da-close">${iconX()}</button></div>
      <div class="modal-body">
        <p class="text-secondary mb-4">Cette action est <strong>irréversible</strong>. Toutes vos données seront supprimées.</p>
        <div class="input-group">
          <label class="input-label">Confirmez votre mot de passe</label>
          <input type="password" class="input" id="da-password" autocomplete="current-password">
        </div>
        <div id="da-error" class="input-error mt-2 hidden"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" id="da-cancel">Annuler</button>
        <button class="btn btn-danger" id="da-confirm">Supprimer définitivement</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  setTimeout(() => overlay.classList.add('open'), 10);
  const close = () => { overlay.classList.remove('open'); setTimeout(() => overlay.remove(), 200); };
  document.getElementById('da-close')?.addEventListener('click', close);
  document.getElementById('da-cancel')?.addEventListener('click', close);
  document.getElementById('da-confirm')?.addEventListener('click', async () => {
    const pw = document.getElementById('da-password')?.value;
    try {
      await api('DELETE', '/api/settings/account', { password: pw });
      clearSessionToken();
      window.location.href = '/';
    } catch (err) {
      const e = document.getElementById('da-error');
      if (e) { e.textContent = err.message; e.classList.remove('hidden'); }
    }
  });
}

async function loadBlockedUsers() {
  try {
    const users = await api('GET', '/api/users/blocked/list');
    const container = document.getElementById('blocked-list');
    if (!container) return;
    container.innerHTML = '';
    if (users.length === 0) { container.innerHTML = '<p class="text-sm text-secondary">Aucun utilisateur bloqué</p>'; return; }
    users.forEach(u => {
      const el = document.createElement('div');
      el.className = 'admin-table-row';
      el.style.cssText = 'border-radius:8px;margin-bottom:4px;';
      el.appendChild(createAvatarEl(u, 'sm'));
      el.innerHTML += `<div class="admin-row-info"><div class="admin-row-name">${escText(u.username)}</div></div>`;
      const unblock = document.createElement('button');
      unblock.className = 'btn btn-ghost btn-sm';
      unblock.textContent = 'Débloquer';
      unblock.addEventListener('click', async () => {
        await api('POST', `/api/users/unblock/${u.id}`);
        el.remove();
        toast('Utilisateur débloqué', 'success');
      });
      el.appendChild(unblock);
      container.appendChild(el);
    });
  } catch {}
}

async function loadSessions() {
  try {
    const sessions = await api('GET', '/api/sessions');
    const container = document.getElementById('sessions-list');
    if (!container) return;
    container.innerHTML = '';
    sessions.forEach(s => {
      const el = document.createElement('div');
      el.className = 'settings-row no-hover';
      el.innerHTML = `
        <div class="settings-row-icon gray">${iconSettings()}</div>
        <div class="settings-row-content">
          <div class="settings-row-label">${escText(s.deviceInfo?.substring(0, 40) || 'Appareil inconnu')}${s.current ? ' <span style="font-size:0.75rem;color:var(--color-success)">(actif)</span>' : ''}</div>
          <div class="settings-row-desc">${escText(formatRelativeTime(s.lastActive))}</div>
        </div>
        ${!s.current ? `<button class="btn btn-ghost btn-sm" data-session-id="${escText(s.id)}" style="color:var(--color-error)">Révoquer</button>` : ''}`;
      el.querySelector(`[data-session-id]`)?.addEventListener('click', async (e) => {
        const sid = e.currentTarget.dataset.sessionId;
        await api('DELETE', `/api/sessions/${sid}`);
        el.remove();
      });
      container.appendChild(el);
    });
  } catch {}
}

// ADMIN PAGE
async function initAdminPage() {
  loadTheme();
  try {
    const user = await api('GET', '/api/auth/me');
    state.currentUser = user;
    const isAdmin = user.roles?.some(r => ['ADMIN', 'OWNER', 'MODERATOR'].includes(r));
    if (!isAdmin) { window.location.href = '/'; return; }
    setupAdmin();
  } catch {
    window.location.href = '/';
  }
}

async function setupAdmin() {
  document.getElementById('admin-back')?.addEventListener('click', () => window.location.href = '/messages');

  // Tabs
  document.querySelectorAll('.admin-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.admin-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      const panel = document.getElementById(tab.dataset.panel);
      if (panel) panel.classList.add('active');
    });
  });

  await loadAdminUsers();
  await loadAdminReports();
  await loadAdminPosts();
}

async function loadAdminUsers(skip = 0) {
  const container = document.getElementById('admin-users-list');
  if (!container) return;
  try {
    const users = await api('GET', `/api/admin/users?skip=${skip}`);
    if (skip === 0) container.innerHTML = '';
    users.forEach(u => {
      const el = document.createElement('div');
      el.className = 'admin-table-row';
      const av = createAvatarEl(u, 'sm');
      el.appendChild(av);
      el.innerHTML += `
        <div class="admin-row-info">
          <div class="admin-row-name">${escText(u.username)}</div>
          <div class="admin-row-sub">
            <span class="role-badge role-${u.roles?.[0] || 'USER'}">${u.roles?.[0] || 'USER'}</span>
            ${u.isBanned ? '<span class="status-badge status-banned">Banni</span>' : u.isSuspended ? '<span class="status-badge status-suspended">Suspendu</span>' : '<span class="status-badge status-active">Actif</span>'}
          </div>
        </div>
        <div class="flex gap-2">
          ${!u.roles?.includes('OWNER') ? `
            <button class="btn btn-ghost btn-sm" onclick="adminToggleSuspend('${u._id}',${u.isSuspended})">${u.isSuspended ? 'Réactiver' : 'Suspendre'}</button>
            <button class="btn btn-ghost btn-sm" style="color:var(--color-error)" onclick="adminToggleBan('${u._id}',${u.isBanned})">${u.isBanned ? 'Débannir' : 'Bannir'}</button>
            <button class="btn btn-ghost btn-sm" style="color:var(--color-error)" onclick="adminDeleteUser('${u._id}','${escText(u.username).replace(/'/g, "\\'")}')">Supprimer</button>
          ` : ''}
        </div>`;
      container.appendChild(el);
    });
  } catch {}
}

async function adminToggleSuspend(userId, current) {
  try {
    await api('PUT', `/api/admin/users/${userId}/suspend`, { value: !current });
    await loadAdminUsers();
    toast(current ? 'Utilisateur réactivé' : 'Utilisateur suspendu', 'success');
  } catch (err) { toast(err.message || 'Erreur', 'error'); }
}
window.adminToggleSuspend = adminToggleSuspend;

async function adminToggleBan(userId, current) {
  try {
    await api('PUT', `/api/admin/users/${userId}/ban`, { value: !current });
    await loadAdminUsers();
    toast(current ? 'Utilisateur débanni' : 'Utilisateur banni', 'success');
  } catch (err) { toast(err.message || 'Erreur', 'error'); }
}
window.adminToggleBan = adminToggleBan;

// Suppression totale et définitive du compte (contrairement à
// suspendre/bannir, irréversible : messages, conversations privées,
// publications et sessions de l'utilisateur sont effacés côté serveur).
async function adminDeleteUser(userId, username) {
  if (!confirm(`Supprimer définitivement le compte "${username}" ? Cette action est irréversible : ses messages, conversations privées et publications seront effacés.`)) return;
  try {
    await api('DELETE', `/api/admin/users/${userId}`);
    await loadAdminUsers();
    toast('Compte supprimé', 'success');
  } catch (err) { toast(err.message || 'Erreur', 'error'); }
}
window.adminDeleteUser = adminDeleteUser;

async function loadAdminReports() {
  const container = document.getElementById('admin-reports-list');
  if (!container) return;
  try {
    const reports = await api('GET', '/api/admin/reports?status=pending');
    container.innerHTML = '';
    if (reports.length === 0) { container.innerHTML = '<div class="empty-state" style="padding:24px"><p>Aucun signalement en attente</p></div>'; return; }
    reports.forEach(r => {
      const el = document.createElement('div');
      el.className = 'admin-table-row';
      el.style.flexDirection = 'column';
      el.style.alignItems = 'flex-start';
      el.innerHTML = `
        <div style="width:100%;display:flex;align-items:center;justify-content:space-between">
          <div><span class="role-badge role-USER">${escText(r.targetType)}</span><span class="text-secondary text-sm" style="margin-left:8px">${escText(formatRelativeTime(r.createdAt))}</span></div>
          <div class="flex gap-2">
            <button class="btn btn-ghost btn-sm" onclick="resolveReport('${r._id}','resolved')">Résoudre</button>
            <button class="btn btn-ghost btn-sm" onclick="resolveReport('${r._id}','dismissed')">Ignorer</button>
          </div>
        </div>
        <p class="text-sm text-secondary" style="margin-top:6px">${escText(r.reason)}</p>`;
      container.appendChild(el);
    });
  } catch {}
}

async function resolveReport(id, status) {
  try {
    await api('PUT', `/api/admin/reports/${id}`, { status });
    await loadAdminReports();
    toast('Signalement mis à jour', 'success');
  } catch (err) { toast(err.message || 'Erreur', 'error'); }
}
window.resolveReport = resolveReport;

async function loadAdminPosts(skip = 0) {
  const container = document.getElementById('admin-posts-list');
  if (!container) return;
  try {
    const posts = await api('GET', `/api/posts?skip=${skip}&limit=30`);
    if (skip === 0) container.innerHTML = '';
    if (skip === 0 && posts.length === 0) {
      container.innerHTML = '<div class="empty-state" style="padding:32px"><p>Aucune publication</p></div>';
      return;
    }
    posts.forEach(p => {
      const el = document.createElement('div');
      el.className = 'admin-table-row';
      el.style.flexDirection = 'column';
      el.style.alignItems = 'flex-start';
      const preview = (p.content || p.description || '').slice(0, 140);
      el.innerHTML = `
        <div style="width:100%;display:flex;align-items:center;justify-content:space-between;gap:8px">
          <div style="min-width:0">
            <span class="admin-row-name">${escText(p.author?.username || 'Utilisateur')}</span>
            <span class="text-secondary text-sm" style="margin-left:8px">${escText(formatRelativeTime(p.createdAt))}</span>
          </div>
          <button class="btn btn-ghost btn-sm" style="color:var(--color-error);flex-shrink:0" onclick="adminDeletePost('${p.id}')">Supprimer</button>
        </div>
        ${preview ? `<p class="text-sm text-secondary" style="margin-top:6px">${escText(preview)}</p>` : ''}`;
      container.appendChild(el);
    });
  } catch {
    if (skip === 0) container.innerHTML = '<div class="empty-state" style="padding:32px"><p>Erreur de chargement</p></div>';
  }
}
window.loadAdminPosts = loadAdminPosts;

async function adminDeletePost(id) {
  if (!confirm('Supprimer définitivement cette publication ?')) return;
  try {
    await api('DELETE', `/api/posts/${id}`);
    document.getElementById(`post-${id}`)?.remove();
    await loadAdminPosts();
    toast('Publication supprimée', 'success');
  } catch (err) { toast(err.message || 'Erreur', 'error'); }
}
window.adminDeletePost = adminDeletePost;

// ─── Auto-init ─────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const page = document.body.dataset.page;

  // Global toast container
  if (!document.getElementById('toast-container')) {
    const tc = document.createElement('div');
    tc.className = 'toast-container';
    tc.id = 'toast-container';
    document.body.appendChild(tc);
  }

  if (page === 'index') initIndexPage();
  else if (page === 'messages') initMessagesPage();
  else if (page === 'settings') initSettingsPage();
  else if (page === 'admin') initAdminPage();
  else if (page === 'info') {
    loadTheme();
    // Animate sections
    const sections = document.querySelectorAll('.info-section');
    sections.forEach((s, i) => { s.style.animationDelay = (i * 0.1) + 's'; });
  }
});
