const CACHE_NAME = 'ner-landslide-v1';
const OFFLINE_URLS = [
  '/',
  '/index.html',
];

// Install — cache core assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(OFFLINE_URLS))
  );
  self.skipWaiting();
});

// Activate — clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch — network first, fallback to cache
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Skip non-GET and API/WS requests
  if (request.method !== 'GET') return;
  if (request.url.includes('/api/') || request.url.includes('/ws/')) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        // Cache successful responses
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        return response;
      })
      .catch(() => {
        // Fallback to cache when offline
        return caches.match(request).then((cached) => cached || caches.match('/'));
      })
  );
});

// Push notification handler
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : { title: 'NER Alert', body: 'Landslide warning' };
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      vibrate: [200, 100, 200],
      tag: 'ner-alert',
      renotify: true,
    })
  );
});

// Notification click — open app
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow('/'));
});
