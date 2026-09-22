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
      const { title, body } = payload.notification || {};
      const data = payload.data || {};
      const notificationTitle = title || 'JEXCHAT';
      const notificationOptions = {
        body: body || 'Nouveau message',
        icon: '/icon-192.png',
        badge: '/badge-72.png',
        tag: data.conversationId || 'jexchat',
        data: { conversationId: data.conversationId, url: '/messages' },
        actions: [{ action: 'open', title: 'Ouvrir' }],
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

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(clients.claim()));
