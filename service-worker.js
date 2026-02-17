// CEA Roster Calendar — Service Worker v3.12
// Strategy: Cache-first with network fallback.
// All app assets are static and baked in — no dynamic data to fetch.
// Bump CACHE_NAME on every deploy to force users onto the new version.

const CACHE_NAME = 'cea-roster-v3.12';

const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './service-worker.js',
  './icon-120.png',
  './icon-152.png',
  './icon-167.png',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png'
];

// ============================================
// INSTALL — pre-cache all app assets
// ============================================
// skipWaiting() is called AFTER caching succeeds so we don't activate
// with an empty cache on slow connections. If caching fails entirely,
// the install fails and the old SW stays in place — which is the safe outcome.
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS_TO_CACHE))
      .then(() => self.skipWaiting())
      .catch(err => {
        console.error('[SW] Pre-cache failed during install:', err);
        // Re-throw so the install event fails cleanly rather than
        // activating with a broken cache.
        throw err;
      })
  );
});

// ============================================
// ACTIVATE — delete stale caches from old versions
// ============================================
// clients.claim() takes immediate control of all open tabs so users
// don't need to refresh to get the new version.
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(cacheNames => Promise.all(
        cacheNames
          .filter(name => name !== CACHE_NAME)
          .map(name => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      ))
      .then(() => self.clients.claim())
  );
});

// ============================================
// FETCH — serve from cache, fall back to network
// ============================================
// Only handles same-origin requests (response.type === 'basic').
// Cross-origin requests (e.g. if icons were ever served from a CDN)
// pass through to the network and are not cached.
self.addEventListener('fetch', event => {
  // Only handle GET requests — don't intercept POST/PUT etc.
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request)
      .then(cachedResponse => {
        // Cache hit — return immediately without touching the network.
        if (cachedResponse) {
          return cachedResponse;
        }

        // Cache miss — fetch from network and cache the result.
        return fetch(event.request)
          .then(networkResponse => {
            // Only cache valid, same-origin responses.
            if (
              !networkResponse ||
              networkResponse.status !== 200 ||
              networkResponse.type !== 'basic'
            ) {
              return networkResponse;
            }

            // Clone before consuming — one copy for the cache, one for the browser.
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME)
              .then(cache => cache.put(event.request, responseToCache));

            return networkResponse;
          })
          .catch(() => {
            // Network failed and nothing in cache — nothing we can do.
            // The browser will show its own offline error.
            console.warn('[SW] Fetch failed and no cache entry for:', event.request.url);
          });
      })
  );
});
