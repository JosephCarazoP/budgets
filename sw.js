// Service Worker — BudgetFlow
// Cambiá el número de versión cada vez que hagás deploy
// para forzar que iOS descarte el caché viejo.
const VERSION = 'v1';
const CACHE = `budgetflow-${VERSION}`;

// Archivos a cachear
const ASSETS = ['/', '/index.html', '/app.js', '/styles.css', '/manifest.json'];

// Instalación: cachear archivos frescos
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting(); // activar inmediatamente sin esperar
});

// Activación: eliminar cachés viejos
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim(); // tomar control de todas las pestañas
});

// Fetch: network-first para app.js (siempre fresco), cache-first para el resto
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Supabase y externos: nunca interceptar
  if (!url.origin.includes(self.location.origin)) return;

  // app.js y styles.css: siempre intentar red primero
  if (url.pathname.endsWith('.js') || url.pathname.endsWith('.css')) {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // Resto: cache-first con fallback a red
  e.respondWith(
    caches.match(e.request).then((cached) => cached || fetch(e.request))
  );
});
