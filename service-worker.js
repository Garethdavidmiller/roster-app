const CACHE_NAME = 'myb-roster-v5.2'; // Increment this to force cache refresh on all clients

const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './icon-120.png',
  './icon-152.png',
  './icon-167.png',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png'
];

// ─── INSTALL ──────────────────────────────────────────────────────────────────
// Pre-cache all assets. skipWaiting() means the new SW activates immediately
// rather than waiting for all existing tabs to close.
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// ─── ACTIVATE ─────────────────────────────────────────────────────────────────
// Delete every cache that isn't the current version, then claim all open tabs
// immediately so users don't need to close and reopen the app to get the update.
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          })
      ))
      .then(() => self.clients.claim())
  );
});

// ─── FETCH ────────────────────────────────────────────────────────────────────
// Strategy depends on the resource type:
//
//   index.html  → Network-first, fall back to cache.
//                 Ensures roster updates are picked up as soon as the user
//                 has a connection. The old cached version is only served
//                 when offline.
//
//   Everything else (icons, manifest) → Cache-first, fall back to network.
//                 These assets rarely change so serving from cache is fast
//                 and correct. If a new version is needed, bumping CACHE_NAME
//                 above forces a fresh download on next install.

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  const isHTML = url.pathname.endsWith('/') || url.pathname.endsWith('.html');

  if (isHTML) {
    // Network-first for HTML
    event.respondWith(
      fetch(event.request)
        .then(networkResponse => {
          // Got a fresh response — update the cache and return it
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return networkResponse;
        })
        .catch(() => {
          // Offline — serve from cache
          return caches.match(event.request);
        })
    );
  } else {
    // Cache-first for all other assets
    event.respondWith(
      caches.match(event.request)
        .then(cached => {
          if (cached) return cached;
          return fetch(event.request).then(networkResponse => {
            if (networkResponse && networkResponse.status === 200) {
              const clone = networkResponse.clone();
              caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
            }
            return networkResponse;
          });
        })
    );
  }
});
