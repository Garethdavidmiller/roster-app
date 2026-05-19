// MYB Roster — Service Worker v10.25
// Strategy:
//   All JS modules, HTML pages, and shared.css
//               → Network-first: always fetch fresh so roster updates reach
//                 staff on next open. Falls back to cache when offline.
//   Icons, manifests → Cache-first: stable assets served instantly; fetched on miss.
//   Reference guides → Network-first: guides can be updated and staff should get fresh wording promptly.
//
// self.skipWaiting() on install activates the new SW immediately.
// self.clients.claim() makes the new SW take control of all open tabs at once.
// Together these mean updates go live on the current tab without a manual reload
// in most cases — but the app also sends SKIP_WAITING on the rare edge case
// where a waiting SW needs a nudge.
//
// Cache name includes the app version so any app version bump triggers a full
// cache refresh on all clients — staff always receive the latest roster logic.

const APP_VERSION = '10.25';
const CACHE_NAME  = `myb-roster-v${APP_VERSION}`;

// All JS modules, HTML pages, and CSS — always fetched fresh (network-first).
// Note: matching uses path.endsWith(filename), which is a suffix check, not an
// exact path check. This is intentional — all these files live at the root of
// the PWA origin so partial suffix matches never collide in practice.
const NETWORK_FIRST_FILES = [
    'index.html', 'admin.html',
    'app.js', 'app-team-view.js', 'app-override-utils.js', 'admin-app.js', 'admin-huddle.js', 'admin-auth.js', 'ls.js',
    'admin-roster-upload.js', 'admin-overrides.js',
    'admin-al.js', 'admin-sick.js',
    'roster-data.js', 'roster-cycle-data.js', 'firebase-client.js',
    'shared.css',
    'paycalc.html', 'paycalc.js', 'paycalc-calc.js',
    'paycalc-roster-suggestions.js', 'paycalc-guide.html',
    'fip.html', 'guide.html',
];

// Critical app files — cached with addAll() (all-or-nothing, abort install if any fail).
const CORE_ASSETS = [
    "./index.html",
    "./admin.html",
    "./app.js",
    "./app-team-view.js",
    "./app-override-utils.js",
    "./admin-app.js",
    "./admin-huddle.js",
    "./admin-auth.js",
    "./admin-roster-upload.js",
    "./admin-overrides.js",
    "./admin-al.js",
    "./admin-sick.js",
    "./roster-data.js",
    "./roster-cycle-data.js",
    "./firebase-client.js",
    "./ls.js",
    "./shared.css",
    "./manifest.json",
    "./paycalc.html",
    "./paycalc.js",
    "./paycalc-calc.js",
    "./paycalc-roster-suggestions.js",
];

// Reference guides and icons — cached individually so a transient network error
// on any one file does not block the whole service worker from installing.
const SUPPLEMENTARY_ASSETS = [
    "./paycalc-guide.html",
    "./fip.html",
    "./guide.html",
];

const ICON_ASSETS = [
    "./icon-120.png",
    "./icon-152.png",
    "./icon-167.png",
    "./icon-180.png",
    "./icon-192.png",
    "./icon-512.png",
];

// ============================================
// INSTALL — pre-cache all assets
// ============================================
self.addEventListener("install", event => {
    console.log(`[SW ${APP_VERSION}] Installing`);
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache =>
            // allSettled (instead of addAll) means a single 404 / network blip on one file
            // does not abort the whole SW install. Each asset is cached if available; failures
            // are logged but install proceeds. Network-first fetch handler can re-fetch later.
            Promise.allSettled(CORE_ASSETS.map(asset =>
                cache.add(asset).catch(err => {
                    console.warn(`[SW ${APP_VERSION}] Core asset cache skipped (${asset}):`, err);
                    throw err;
                })
            )).then(() => Promise.allSettled([
                    ...SUPPLEMENTARY_ASSETS,
                    ...ICON_ASSETS,
                ].map(asset =>
                    cache.add(asset).catch(err =>
                        console.warn(`[SW ${APP_VERSION}] Asset cache skipped (${asset}):`, err)
                    )
                ))).then(() => {
                    console.log(`[SW ${APP_VERSION}] Cached — activating immediately`);
                    return self.skipWaiting();
                })
        )
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
    if (url.origin !== self.location.origin) return;

    const path = url.pathname;
    const isNetworkFirst = path.endsWith("/")
        || NETWORK_FIRST_FILES.some(f => path.endsWith(f));

    if (isNetworkFirst) {
        // Network-first: revalidate against the server (304 if unchanged → no body download),
        // update SW cache, fall back to cached copy if offline or the network hangs past 2 seconds.
        // AbortController ensures the underlying fetch is actually cancelled on timeout
        // rather than completing silently in the background and writing stale data to cache.
        // Feature-detected: AbortController throws in service workers on iOS < 15.1.
        // 2 s timeout: fast enough for 4G, short enough to serve cache quickly on poor signal.
        // cache: 'no-cache' (vs 'no-store') lets the browser do a conditional request and
        // return 304 when the file is unchanged — same freshness, much less bandwidth.
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timeoutId  = controller ? setTimeout(() => controller.abort(), 2000) : null;
        const freshReq   = new Request(event.request.url, {
            method:  event.request.method,
            headers: event.request.headers,
            mode:    event.request.mode === 'navigate' ? 'same-origin' : event.request.mode,
            cache:   'no-cache',
            ...(controller ? { signal: controller.signal } : {}),
        });
        event.respondWith(
            fetch(freshReq)
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
                    // Only use an HTML page as a fallback for document (navigation) requests.
                    // Serving HTML for a JS/CSS request causes a MIME type error in the browser.
                    const isDoc = event.request.destination === 'document';
                    const fallback = isDoc
                        ? (path.includes('paycalc') ? './paycalc.html' : path.includes('admin') ? './admin.html' : './index.html')
                        : null;
                    // iOS can evict the entire Cache Storage under storage pressure —
                    // synthesise a minimal offline page so the request still resolves.
                    return caches.match(event.request)
                        .then(r => r || (fallback ? caches.match(fallback) : null))
                        .then(r => r || (isDoc
                            ? new Response(
                                '<h1 style="font-family:sans-serif;padding:20px">Offline</h1><p style="font-family:sans-serif;padding:0 20px">Cache was cleared. Please reconnect and reload.</p>',
                                { headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }, status: 200 }
                              )
                            : Response.error()
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
    try { if (event.data) Object.assign(data, event.data.json()); } catch (_) {}

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
