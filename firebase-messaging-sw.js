/* JEXCHAT Firebase Cloud Messaging Service Worker */
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

// Config will be injected by the client
let messaging = null;

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'FIREBASE_CONFIG') {
    try {
      if (!firebase.apps.length) {
        firebase.initializeApp(event.data.config);
      }
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
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const url = data.url || '/messages';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.focus();
          client.postMessage({ type: 'NOTIFICATION_CLICK', conversationId: data.conversationId });
          return;
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(clients.claim()));
