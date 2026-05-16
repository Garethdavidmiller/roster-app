// MYB Roster — Service Worker v9.80
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

const APP_VERSION = '9.80';
const CACHE_NAME  = `myb-roster-v${APP_VERSION}`;

// Files that contain roster data — always fetched fresh (network-first).
const NETWORK_FIRST_FILES = ['index.html', 'admin.html', 'app.js', 'admin-app.js', 'admin-huddle.js', 'admin-auth.js', 'admin-roster-upload.js', 'admin-overrides.js', 'roster-data.js', 'roster-cycle-data.js', 'firebase-client.js', 'shared.css', 'paycalc.html', 'paycalc.js', 'paycalc-calc.js', 'paycalc-roster-suggestions.js', 'paycalc-guide.html', 'fip.html', 'guide.html'];

// Critical app files — cached with addAll() (all-or-nothing, abort install if any fail).
const CORE_ASSETS = [
    "./index.html",
    "./admin.html",
    "./app.js",
    "./admin-app.js",
    "./admin-huddle.js",
    "./admin-auth.js",
    "./admin-roster-upload.js",
    "./admin-overrides.js",
    "./roster-data.js",
    "./roster-cycle-data.js",
    "./firebase-client.js",
    "./shared.css",
    "./manifest.json",
    "./pay-manifest.json",
    "./paycalc.html",
    "./paycalc.js",
    "./paycalc-calc.js",
    "./paycalc-roster-suggestions.js",
    "./paycalc-guide.html",
    "./fip.html",
    "./guide.html"
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
        // fall back to cached copy if offline or the network hangs past 2 seconds.
        // AbortController ensures the underlying fetch is actually cancelled on timeout
        // rather than completing silently in the background and writing stale data to cache.
        // Feature-detected: AbortController throws in service workers on iOS < 15.1.
        // 2 s timeout: fast enough for 4G, short enough to serve cache quickly on poor signal.
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timeoutId  = controller ? setTimeout(() => controller.abort(), 2000) : null;
        const fetchOpts  = controller ? { cache: 'no-store', signal: controller.signal } : { cache: 'no-store' };
        event.respondWith(
            fetch(event.request, fetchOpts)
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
                    const fallback = path.includes('paycalc') ? './paycalc.html' : path.includes('admin') ? './admin.html' : './index.html';
                    // iOS can evict the entire Cache Storage under storage pressure —
                    // synthesise a minimal offline page so the request still resolves.
                    return caches.match(event.request)
                        .then(r => r || caches.match(fallback))
                        .then(r => r || new Response(
                            '<h1 style="font-family:sans-serif;padding:20px">Offline</h1><p style="font-family:sans-serif;padding:0 20px">Cache was cleared. Please reconnect and reload.</p>',
                            { headers: { 'Content-Type': 'text/html' }, status: 503 }
                        ));
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
// PUSH — incoming notifications (Huddle + Pay reminder)
// ============================================
// Payload shape (sent by Cloud Functions):
//   { title, body, url, tag }
// tag is either 'huddle' or 'pay-reminder'. Using the same tag for repeat
// notifications of the same type means the new one replaces the old one in
// the Notification Centre rather than stacking.
self.addEventListener("push", event => {
    let data = { title: "Marylebone Roster", body: "Huddle is ready" };
    try { if (event.data) data = event.data.json(); } catch (_) {}

    const url = data.url || "./";
    // Prefer explicit tag from payload; fall back to URL inference for legacy payloads.
    const tag = data.tag || (url.includes('paycalc') ? 'pay-reminder' : 'huddle');

    event.waitUntil(
        self.registration.showNotification(data.title, {
            body:    data.body,
            // iOS Notification Centre uses 'icon' when the notification is reviewed
            // later — without it, iOS shows a generic globe glyph.
            icon:    `${self.location.origin}/icon-192.png`,
            badge:   `${self.location.origin}/icon-192.png`,
            tag,
            renotify: true,           // still vibrates/sounds even if replacing
            data:     { url },
        })
    );
});

// When staff tap a notification, bring the correct app page to the front.
// Huddle → index.html (Huddle button lives in the title bar since v9.05).
// Pay reminder → paycalc.html.
//
// iOS-safe order: focus the existing window FIRST, then navigate.
// Calling navigate() on an unfocused window is silently dropped on iOS.
// includeUncontrolled is omitted — it can return stale clients on iOS that
// respond to navigate() but never actually render the new page.
self.addEventListener("notificationclick", event => {
    event.notification.close();
    const targetUrl = new URL(
        (event.notification.data && event.notification.data.url) || './',
        self.location.origin
    ).href;
    event.waitUntil(
        clients.matchAll({ type: 'window' }).then(list => {
            // Find any open window belonging to this app
            const win = list.find(c => c.url.startsWith(self.location.origin));
            if (win) {
                // Focus first (iOS requirement), then navigate if on a different page.
                // If focus() rejects (iOS can leave matchAll returning a stale handle
                // when the PWA is fully backgrounded) fall back to opening a new window.
                // If focus() resolves to null (Android battery-frozen window: the call
                // succeeds but the OS didn't hand back a live client handle) also fall
                // back to openWindow so the app still comes to the foreground.
                return win.focus().then(focusedClient => {
                    if (!focusedClient) return clients.openWindow(targetUrl);
                    if (focusedClient.url !== targetUrl && 'navigate' in focusedClient) {
                        return focusedClient.navigate(targetUrl)
                            .catch(() => clients.openWindow(targetUrl));
                    }
                }).catch(() => clients.openWindow(targetUrl));
            }
            return clients.openWindow(targetUrl);
        })
    );
});
