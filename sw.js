const CACHE_NAME = 'easyresume-pwa-v50';
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './logo.png',
  './logo-192.png',
  './logo.jpg',
  './logo.ico',
  './candidate_male.jpg',
  './candidate_photo.jpg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(CORE_ASSETS).catch((err) => console.warn('PWA Precache warning:', err));
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Stale-while-revalidate / Instant cache response for navigation so reload never hangs
  if (event.request.mode === 'navigate') {
    event.respondWith(
      caches.match(event.request)
        .then((cached) => cached || caches.match('./index.html'))
        .then((cached) => cached || caches.match('./'))
        .then((cached) => {
          const fetchPromise = fetch(event.request)
            .then((response) => {
              if (response && response.status === 200) {
                const respClone = response.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(event.request, respClone));
              }
              return response;
            })
            .catch(() => cached || caches.match('./index.html'));

          return cached || fetchPromise;
        })
    );
    return;
  }

  // Runtime caching for external CDNs & static assets
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // Fetch fresh in background
        fetch(event.request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, networkResponse));
            }
          })
          .catch(() => {});
        return cachedResponse;
      }

      return fetch(event.request)
        .then((networkResponse) => {
          if (!networkResponse || networkResponse.status !== 200 || (networkResponse.type !== 'basic' && networkResponse.type !== 'cors')) {
            return networkResponse;
          }
          const respClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, respClone));
          return networkResponse;
        })
        .catch(() => {
          // If offline and request is an image
          if (event.request.destination === 'image') {
            return caches.match('./logo.png');
          }
        });
    })
  );
});
