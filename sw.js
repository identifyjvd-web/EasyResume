const CACHE_NAME = 'easyresume-pwa-v3';
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './responsive-fixes.css',
  './logo.png',
  './logo-192.png'
];

const RESPONSIVE_STYLESHEET = '<link rel="stylesheet" href="./responsive-fixes.css?v=saved-resume-compact-3">';

async function addResponsiveStylesheet(response) {
  if (!response || !response.headers.get('content-type')?.includes('text/html')) {
    return response;
  }

  const html = await response.text();
  if (html.includes('responsive-fixes.css')) return new Response(html, response);

  const updatedHtml = html.replace(/<\/head>/i, `${RESPONSIVE_STYLESHEET}\n</head>`);
  return new Response(updatedHtml, response);
}

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

  if (event.request.mode === 'navigate') {
    event.respondWith(
      caches.match(event.request)
        .then((cached) => cached || caches.match('./index.html'))
        .then((cached) => {
          const cachedPage = cached ? addResponsiveStylesheet(cached) : Promise.resolve(null);
          const freshPage = fetch(event.request)
            .then(addResponsiveStylesheet)
            .then((response) => {
              if (response && response.status === 200) {
                caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response.clone()));
              }
              return response;
            })
            .catch(() => cachedPage);

          return cachedPage.then((page) => page || freshPage);
        })
    );
    return;
  }

  // Runtime caching for external CDNs & static assets
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
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
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
          return networkResponse;
        })
        .catch(() => {
          if (event.request.destination === 'image') {
            return caches.match('./logo.png');
          }
        });
    })
  );
});
