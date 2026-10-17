// city-api.js — JexCity : communications avec l'API JexChat existante (même origine, cookie de session HttpOnly).
// Aucune donnée n'est copiée : on lit et on écrit via les routes déjà en place (+ /api/city/* pour l'invitation et la sourdine).

async function call(url, { method = 'GET', body } = {}) {
  let r;
  try {
    r = await fetch(url, {
      method, credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (_) {
    const e = new Error('Connexion impossible. Vérifiez votre réseau.'); e.offline = true; throw e;
  }
  let data = null;
  try { data = await r.json(); } catch (_) { /* corps vide */ }
  if (!r.ok) { const e = new Error(data?.error || 'Une erreur est survenue.'); e.status = r.status; throw e; }
  return data;
}
const q = encodeURIComponent;
const uid = () => (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '').slice(0, 24) : String(Date.now()) + Math.random().toString(36).slice(2, 10));

export const api = {
  me: () => call('/api/auth/me'),
  config: () => call('/api/city/config'),
  search: (text) => call(`/api/users/search?q=${q(text)}`),
  user: (id) => call(`/api/users/${q(id)}`),
  latestPosts: (limit = 7) => call(`/api/posts?limit=${limit}`),
  postsOf: (id) => call(`/api/posts/user/${q(id)}?limit=10`),
  like: (id) => call(`/api/posts/${q(id)}/like`, { method: 'POST' }),
  conversations: () => call('/api/conversations?limit=30'),
  messages: (id) => call(`/api/conversations/${q(id)}/messages?limit=30`),
  send: (id, content) => call(`/api/conversations/${q(id)}/messages`, { method: 'POST', body: { content, type: 'text', clientId: uid() } }),
  seen: (id) => call(`/api/conversations/${q(id)}/seen`, { method: 'POST' }).catch(() => {}),
  privateConversation: (userId) => call('/api/conversations/private', { method: 'POST', body: { userId } }),
  invite: (userId) => call('/api/city/invite', { method: 'POST', body: { userId } }),
  mute: (id) => call(`/api/city/mute/${q(id)}`, { method: 'POST' }),
  unmute: (id) => call(`/api/city/mute/${q(id)}`, { method: 'DELETE' }),
  block: (id) => call(`/api/users/block/${q(id)}`, { method: 'POST' }),
  report: (targetType, targetId, reason) => call('/api/reports', { method: 'POST', body: { targetType, targetId, reason } }),
  notifCount: () => call('/api/notifications/count'),
  notifications: () => call('/api/notifications'),
  readNotification: (id) => call(`/api/notifications/${q(id)}/read`, { method: 'POST' }).catch(() => {}),
};

// Texte d'une publication, partagée ou non (le contenu partagé est celui de l'original).
export function postText(p) { return (p?.content || p?.sharedFrom?.content || '').trim(); }
// N'accepte que des URL https pour les médias (la CSP limite déjà img-src à https:).
export function safeHttps(u) { return typeof u === 'string' && /^https:\/\//i.test(u) ? u : ''; }
