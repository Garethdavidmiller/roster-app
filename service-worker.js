// MYB Roster — Service Worker v7.61
// Strategy:
//   index.html, admin.html, roster-data.js
//               → Network-first: always fetch fresh so roster updates reach
//                 staff on next open. Falls back to cache when offline.
//   All assets  → Cache-first: icons and manifest never change between versions,
//                 serving from cache is always correct and faster.
//
// self.skipWaiting() on install activates the new SW immediately.
// self.clients.claim() makes the new SW take control of all open tabs at once.
// Together these mean updates go live on the current tab without a manual reload
// in most cases — but the app also sends SKIP_WAITING on the rare edge case
// where a waiting SW needs a nudge.
//
// Cache name includes the app version so any app version bump triggers a full
// cache refresh on all clients — staff always receive the latest roster logic.

const APP_VERSION = '7.61';
const CACHE_NAME  = `myb-roster-v${APP_VERSION}`;

// Files that contain roster data — always fetched fresh (network-first).
const NETWORK_FIRST_FILES = ['index.html', 'admin.html', 'app.js', 'admin-app.js', 'roster-data.js', 'firebase-client.js', 'shared.css', 'paycalc.html', 'paycalc.js', 'paycalc-guide.html', 'fip.html'];

// Critical app files — cached with addAll() (all-or-nothing, abort install if any fail).
const CORE_ASSETS = [
    "./index.html",
    "./admin.html",
    "./app.js",
    "./admin-app.js",
    "./roster-data.js",
    "./firebase-client.js",
    "./shared.css",
    "./manifest.json",
    "./pay-manifest.json",
    "./paycalc.html",
    "./paycalc.js",
    "./paycalc-guide.html",
    "./fip.html"
];

// Icons — cached individually so a transient network error on one icon does not
// block the whole service worker from installing (addAll is all-or-nothing).
const ICON_ASSETS = [
    "./icon-120.png",
    "./icon-152.png",
    "./icon-167.png",
    "./icon-180.png",
    "./icon-192.png",
    "./icon-512.png"
];

// ============================================
// INSTALL — pre-cache all assets
// ============================================
self.addEventListener("install", event => {
    console.log(`[SW ${APP_VERSION}] Installing`);
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(CORE_ASSETS))
            .then(() => caches.open(CACHE_NAME).then(cache =>
                // Cache icons one at a time — a missing icon won't block activation
                Promise.all(ICON_ASSETS.map(icon =>
                    cache.add(icon).catch(err =>
                        console.warn(`[SW ${APP_VERSION}] Icon cache skipped (${icon}):`, err)
                    )
                ))
            ))
            .then(() => {
                console.log(`[SW ${APP_VERSION}] Cached — activating immediately`);
                return self.skipWaiting();
            })
    );
});

// ============================================
// ACTIVATE — delete old caches, claim all open tabs
// ============================================
self.addEventListener("activate", event => {
    console.log(`[SW ${APP_VERSION}] Activating`);
    event.waitUntil(
        caches.keys()
            .then(cacheNames => Promise.all(
                cacheNames
                    .filter(name => name !== CACHE_NAME)
                    .map(name => {
                        console.log(`[SW ${APP_VERSION}] Deleting old cache:`, name);
                        return caches.delete(name);
                    })
            ))
            .then(() => {
                console.log(`[SW ${APP_VERSION}] Claiming all clients`);
                return self.clients.claim();
            })
    );
});

// ============================================
// FETCH — network-first for HTML, cache-first for assets
// ============================================
self.addEventListener("fetch", event => {
    // Only handle same-origin GET requests
    if (event.request.method !== "GET") return;
    const url = new URL(event.request.url);
    if (url.origin !== location.origin) return;

    const path = url.pathname;
    const isNetworkFirst = path.endsWith("/") || path === "/"
        || NETWORK_FIRST_FILES.some(f => path.endsWith(f));

    if (isNetworkFirst) {
        // Network-first: fetch fresh (bypassing browser HTTP cache), update SW cache,
        // fall back to cached copy if offline or the network hangs past 5 seconds.
        // AbortController ensures the underlying fetch is actually cancelled on timeout
        // rather than completing silently in the background and writing stale data to cache.
        const controller = new AbortController();
        const timeoutId  = setTimeout(() => controller.abort(), 5000);
        event.respondWith(
            fetch(event.request, { cache: 'no-store', signal: controller.signal })
                .then(response => {
                    clearTimeout(timeoutId);
                    if (response && response.status === 200) {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                    }
                    return response;
                })
                .catch(() => {
                    clearTimeout(timeoutId);
                    console.log(`[SW ${APP_VERSION}] Offline/timeout — serving from cache:`, path);
                    const fallback = path.includes('admin') ? './admin.html' : './index.html';
                    return caches.match(event.request).then(r => r || caches.match(fallback));
                })
        );
    } else {
        // Cache-first: icons/manifest served from cache instantly, fetched if missing
        event.respondWith(
            caches.match(event.request)
                .then(cached => {
                    if (cached) return cached;
                    return fetch(event.request).then(response => {
                        if (response && response.status === 200) {
                            const clone = response.clone();
                            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                        }
                        return response;
                    });
                })
        );
    }
});

// ============================================
// MESSAGE — SKIP_WAITING from the app
// ============================================
// The app sends { type: "SKIP_WAITING" } if it detects a waiting SW.
// skipWaiting() already fires on install, so this handles the rare edge
// case where auto-activation did not occur (e.g. multiple open tabs on
// older Chrome versions).
self.addEventListener("message", event => {
    if (event.data && event.data.type === "SKIP_WAITING") {
        console.log(`[SW ${APP_VERSION}] SKIP_WAITING received — activating`);
        self.skipWaiting();
    }
});

// ============================================
// PUSH — Huddle upload notifications
// ============================================
// The ingestHuddle Cloud Function fans out a Web Push to every subscribed
// device when a new Huddle is uploaded. The payload is JSON with:
//   { title: "Marylebone Roster", body: "Tomorrow's Huddle is ready" }
// The notification tag "huddle" replaces any previous unread huddle
// notification rather than stacking them.
self.addEventListener("push", event => {
    let data = { title: "Marylebone Roster", body: "Huddle is ready" };
    try { if (event.data) data = event.data.json(); } catch (_) {}

    event.waitUntil(
        self.registration.showNotification(data.title, {
            body:     data.body,
            icon:     "./icon-192.png",
            badge:    "./icon-192.png",
            tag:      "huddle",       // replaces the previous notification rather than stacking
            renotify: true,           // still vibrates/sounds even if replacing
            data:     { url: "./" },
        })
    );
});

// When staff tap the notification, focus the app if it's already open,
// otherwise open it in a new tab.
self.addEventListener("notificationclick", event => {
    event.notification.close();
    event.waitUntil(
        clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
            for (const client of list) {
                if (client.url.startsWith(self.location.origin) && "focus" in client) {
                    return client.focus();
                }
            }
            return clients.openWindow("./");
        })
    );
});
