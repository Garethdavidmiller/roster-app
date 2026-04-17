// ⚠️ APP_VERSION must match paycalc.js CONFIG.APP_VERSION.
// Changing this file on every release is what triggers the browser's SW update detection.
const APP_VERSION = '1.21';
const CACHE_NAME  = 'myb-pay-calc-' + APP_VERSION;

const URLS_TO_CACHE = [
  './paycalc.html',
  './paycalc.js',
  './pay-manifest.json',
  './shared.css',
  './icon-120.png',
  './icon-152.png',
  './icon-167.png',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png'
];

// Install — pre-cache assets. skipWaiting is triggered by the page via postMessage.
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(URLS_TO_CACHE))
  );
});

// Activate — clean up old caches, claim all open clients immediately
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// Fetch strategy:
//   paycalc.html / paycalc.js → network-first (always get the freshest version)
//   everything else → cache-first (icons, manifest don't change often)
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  const isHtml = url.pathname.endsWith('paycalc.html') || url.pathname.endsWith('paycalc.js');

  if (isHtml) {
    // Network-first: fetch fresh, update cache, fall back to cached copy if offline
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const toCache = response.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, toCache));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Cache-first for icons, manifest, etc.
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }
        const toCache = response.clone();
        caches.open(CACHE_NAME).then(c => c.put(event.request, toCache));
        return response;
      });
    })
  );
});

// SKIP_WAITING: sent automatically by the page when a new SW is ready.
// Activates the new SW immediately, triggering controllerchange on the page,
// which stores the new version and reloads to show the update toast.
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
