/* JEXCHAT Firebase Cloud Messaging Service Worker */
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

// Config injectée par le serveur au moment de servir ce fichier (voir la
// route dédiée dans server.js) : le placeholder ci-dessous est remplacé par
// un objet JSON réel avant l'envoi au navigateur. L'initialisation se fait
// directement ici, au chargement du script, pour que le Service Worker soit
// opérationnel dès son démarrage — y compris quand il est relancé par le
// navigateur en arrière-plan pour traiter un push reçu alors qu'aucun onglet
// JEXCHAT n'est ouvert. Ne dépend plus d'un postMessage envoyé par une page
// cliente, qui ne peut jamais arriver dans ce cas précis.
const FIREBASE_CONFIG = "__FIREBASE_CONFIG__";

let messaging = null;
if (FIREBASE_CONFIG && typeof FIREBASE_CONFIG === 'object' && FIREBASE_CONFIG.apiKey) {
  try {
    firebase.initializeApp(FIREBASE_CONFIG);
    messaging = firebase.messaging();
    messaging.onBackgroundMessage((payload) => {
      const data = payload.data || {};
      const { title, body } = { ...(payload.notification || {}), ...(data.title ? { title: data.title } : {}), ...(data.body ? { body: data.body } : {}) };
      const notificationTitle = title || 'JEXCHAT';
      const notificationOptions = {
        body: body || 'Nouveau message',
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        tag: data.conversationId || 'jexchat',
        // Sans renotify, un 2e message de la même conversation remplaçait le 1er SANS alerte (ni son ni vibration).
        renotify: true,
        vibrate: [80, 40, 80],
        data: { conversationId: data.conversationId, url: '/messages' },
        requireInteraction: false,
        silent: false,
      };
      return self.registration.showNotification(notificationTitle, notificationOptions);
    });
  } catch (e) {
    console.warn('[SW] Firebase init error:', e.message);
  }
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const convId = data.conversationId || '';
  // Onglet déjà ouvert : on le réutilise et on le prévient de la
  // conversation à ouvrir (voir le listener 'message' côté client dans
  // script.js). Aucun onglet ouvert : on en ouvre un nouveau directement sur
  // la bonne conversation via le paramètre d'URL.
  const url = convId ? `/messages?conv=${encodeURIComponent(convId)}` : (data.url || '/messages');
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.focus();
          client.postMessage({ type: 'NOTIFICATION_CLICK', conversationId: convId });
          return;
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

// ─── Mode connexion instable : coquille de l'application gardée en cache ────────────────────
// Réseau d'abord (toujours la dernière version quand la connexion marche), cache en secours quand
// elle tombe : l'application s'ouvre même hors ligne. Jamais d'API ni de Socket.IO en cache.
const SHELL_CACHE = 'jx-shell-v1';
const SHELL_URLS = ['/', '/jexchat.css', '/app.js', '/icon-192.png', '/manifest.webmanifest'];
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(SHELL_CACHE).then((c) => Promise.allSettled(SHELL_URLS.map((u) => c.add(u)))).catch(() => {}));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('jx-shell-') && k !== SHELL_CACHE).map((k) => caches.delete(k))))
      .catch(() => {})
      .then(() => clients.claim())
  );
});
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io/') || url.pathname === '/firebase-messaging-sw.js' || url.pathname.startsWith('/admin')) return;
  const isNav = req.mode === 'navigate';
  // Seules les pages de l'application (index.html) sont gardées ; /informations, /admin… passent directement.
  if (isNav && !(url.pathname === '/' || url.pathname === '/messages' || url.pathname === '/settings' || url.pathname.startsWith('/lapage/'))) return;
  if (!isNav && !/\.(css|js|png|webmanifest|ico|svg)$/i.test(url.pathname)) return;
  event.respondWith(
    fetch(req).then((res) => {
      if (res && res.ok && res.type === 'basic') {
        const copy = res.clone();
        const key = isNav ? '/' : req;
        caches.open(SHELL_CACHE).then((c) => c.put(key, copy)).catch(() => {});
      }
      return res;
    }).catch(() => caches.match(isNav ? '/' : req).then((hit) => hit || Response.error()))
  );
});
