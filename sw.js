const CACHE_NAME = 'gladiator-pilot-v4';
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './gladiator-icon.svg',
  './icon-192.png',
  './icon-512.png',
];

// Pre-cache both core shell AND hashed ./assets/*.js & ./assets/*.css bundles on very first install
// so Airplane Mode / zero-signal trail use works after opening the app just once!
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(CORE_ASSETS);
      try {
        const htmlResp = await fetch('./index.html', { cache: 'no-cache' });
        const html = await htmlResp.text();
        const assetMatches = [...html.matchAll(/(?:src|href)="(\.\/assets\/[^"]+)"/g)].map(
          (m) => m[1]
        );
        if (assetMatches.length > 0) {
          await cache.addAll([...new Set(assetMatches)]);
        }
      } catch {
        // Ignore if offline during install
      }
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() =>
        caches.match(event.request).then((cached) => cached || caches.match('./index.html'))
      )
  );
});
