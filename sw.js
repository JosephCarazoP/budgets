const VERSION = 'v10';
const STATIC_CACHE = `budgetflow-static-${VERSION}`;
const RUNTIME_CACHE = `budgetflow-runtime-${VERSION}`;

const APP_SHELL = [
  '/',
  '/index.html',
  '/app.js',
  '/auth.js',
  '/firebase-config.js',
  '/styles.css',
  '/auth.css',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png',
  '/icons/favicon.png',
  '/icons/favicon.svg'
];

const CRITICAL_ASSETS = new Set([
  '/index.html',
  '/app.js',
  '/auth.js',
  '/firebase-config.js',
  '/styles.css',
  '/auth.css',
  '/manifest.json',
  '/icons/icon-192.png'
]);

const ALLOWED_CDN_HOSTS = new Set([
  'www.gstatic.com',
  'gstatic.com',
  'cdn.jsdelivr.net',
  'fonts.googleapis.com',
  'fonts.gstatic.com'
]);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key !== STATIC_CACHE && key !== RUNTIME_CACHE)
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Manejo de recursos externos (Firebase compat, Chart.js, Supabase, Google Fonts)
  if (url.origin !== self.location.origin) {
    if (ALLOWED_CDN_HOSTS.has(url.hostname)) {
      event.respondWith(
        caches.open(RUNTIME_CACHE).then(async (cache) => {
          const cachedResponse = await cache.match(event.request);
          if (cachedResponse) {
            // Actualizar en segundo plano si hay red disponible
            fetch(event.request)
              .then((networkResponse) => {
                if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque')) {
                  cache.put(event.request, networkResponse);
                }
              })
              .catch(() => {});
            return cachedResponse;
          }

          try {
            const networkResponse = await fetch(event.request);
            if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque')) {
              cache.put(event.request, networkResponse.clone());
            }
            return networkResponse;
          } catch (err) {
            return cachedResponse || Response.error();
          }
        })
      );
    }
    return;
  }

  // Navegación principal (HTML)
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(STATIC_CACHE).then((cache) => cache.put('/index.html', copy));
          return response;
        })
        .catch(async () => {
          const cached = await caches.match('/index.html');
          return cached || Response.error();
        })
    );
    return;
  }

  // Activos críticos locales
  if (CRITICAL_ASSETS.has(url.pathname)) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200 && response.type === 'basic') {
            const copy = response.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(event.request);
          return cached || Response.error();
        })
    );
    return;
  }

  // Resto de activos locales
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkFetch = fetch(event.request)
        .then((response) => {
          if (response && response.status === 200 && response.type === 'basic') {
            const copy = response.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => cached);

      return cached || networkFetch;
    })
  );
});
