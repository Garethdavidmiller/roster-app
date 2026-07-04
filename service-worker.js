// MYB Roster — Service Worker v15.70
// Strategy:
//   HTML documents (navigations)
//               → Network-first: a returning user always lands on the freshest
//                 entry point when online; falls back to cache offline.
//   JS modules + CSS
//               → Stale-while-revalidate: served INSTANTLY from cache, then the
//                 cache is refreshed in the background. This removes the per-file
//                 network wait that network-first imposed on every online load.
//                 Code freshness is preserved by the version-bump → new SW → new
//                 cache lifecycle (each deploy precaches fresh assets and the new
//                 SW claims immediately); roster DATA is always live from Firestore,
//                 independent of which JS version is cached.
//   Icons, fonts, manifest → Cache-first: stable assets served instantly; fetched on miss.
//
// self.skipWaiting() on install activates the new SW immediately — install does
// NOTHING else (v15.41: precache moved to a detached post-activation warm-up, so
// activation is never held behind ~90 re-fetches; see the install handler note).
// self.clients.claim() makes the new SW take control of all open tabs at once.
// Together these mean an update lands within moments of opening the app — the
// app also sends SKIP_WAITING on the rare edge case where a waiting SW needs a nudge.
//
// Cache name includes the app version so any app version bump triggers a full
// cache refresh on all clients — staff always receive the latest roster logic.

const APP_VERSION = '15.70';
const CACHE_NAME  = `myb-roster-v${APP_VERSION}`;

// The SW's scope path — '/' on Firebase Hosting, '/roster-app/' on the GitHub Pages
// install. Managed-asset matching and notification icon/URL resolution all resolve
// relative to this, so the app behaves correctly under a sub-path, not just the root.
const SCOPE_PATH = new URL(self.registration.scope).pathname;

// The "managed" same-origin app files: HTML pages, JS modules, and CSS. HTML docs
// are served network-first; JS/CSS are served stale-while-revalidate (see the fetch
// handler). Everything here is precached so SWR can serve it instantly from cache.
// Matching is SCOPE-RELATIVE (the fetch handler strips SCOPE_PATH before lookup), so
// these names match under both '/' (Firebase) and '/roster-app/' (GitHub Pages). (Name
// kept for the sw-asset-check test that parses this array; not "network-first only".)
const NETWORK_FIRST_FILES = [
    'index.html', 'admin.html', 'operations.html', 'settings.html', 'links.html',
    'index.css', 'admin.css', 'paycalc.css', 'operations.css', 'settings.css', 'links.css',
    'calendar-app.js', 'calendar-state.js', 'calendar-swipe.js',
    'calendar-overrides.js', 'calendar-member.js', 'calendar-renderer.js',
    'calendar-al-lightbox.js', 'calendar-initial-fetch.js', 'calendar-keyboard.js',
    'calendar-team-view.js', 'override-utils.js', 'calendar-huddle-viewer.js', 'calendar-doc-viewer.js',
    'admin-app.js', 'huddle.js', 'admin-auth.js', 'ls.js', 'nav-panel.js', 'notif.js',
    'admin-roster-upload.js', 'admin-overrides.js', 'admin-rangepicker.js',
    'admin-al.js', 'admin-sick.js',
    'operations-app.js', 'operations-boot.js', 'settings-app.js', 'links-app.js', 'links-boot.js', 'links-design.js',
    'overlay.js', 'session.js', 'auth-state-core.js', 'auth-state.js', 'auth-policy.js', 'sw-register.js', 'error-reporter.js',
    'usage-reporter.js', 'usage-stats.js', 'perf-reporter.js', 'perf-stats.js',
    'about-lightbox.js', 'tips-lightbox.js', 'login-overlay.js',
    'roster-data.js', 'roster-cycle-data.js', 'firebase-client.js', 'client-errors.js',
    'shared.css',
    'paycalc.html', 'paycalc-app.js', 'paycalc-boot.js', 'paycalc-calc.js',
    'paycalc-help.js', 'paycalc-migrations.js',
    'paycalc-periods.js', 'paycalc-settings.js',
    'paycalc-roster-hint.js', 'paycalc-hpp.js', 'paycalc-backpay.js',
    'paycalc-format.js', 'paycalc-roster-suggestions.js', 'paycalc-lightboxes.js', 'paycalc-guide.html',
    'fip.html', 'guide.html',
    'railcard-guide.html',
    'railcard-guide.js', 'guide-print.js', 'guide-shell.css',
    'guide.css', 'paycalc-guide.css', 'railcard-guide.css', 'fip.css', 'guide-doc.css',
    'purify.es.mjs',
];

// Critical app files — precached on install. Each is fetched individually and the
// batch is wrapped in Promise.allSettled (see the install handler), so a single 404
// or network blip skips that one file and logs it rather than aborting the install.
const CORE_ASSETS = [
    "./index.html",
    "./admin.html",
    "./operations.html",
    "./settings.html",
    "./links.html",
    "./index.css",
    "./admin.css",
    "./paycalc.css",
    "./operations.css",
    "./settings.css",
    "./links.css",
    "./links-app.js",
    "./links-boot.js",
    "./links-design.js",
    "./settings-app.js",
    "./calendar-app.js",
    "./calendar-state.js",
    "./calendar-swipe.js",
    "./calendar-overrides.js",
    "./calendar-member.js",
    "./calendar-renderer.js",
    "./calendar-al-lightbox.js",
    "./calendar-initial-fetch.js",
    "./calendar-keyboard.js",
    "./calendar-team-view.js",
    "./override-utils.js",
    "./calendar-huddle-viewer.js",
    "./calendar-doc-viewer.js",
    "./admin-app.js",
    "./huddle.js",
    "./admin-auth.js",
    "./admin-roster-upload.js",
    "./admin-overrides.js",
    "./admin-rangepicker.js",
    "./admin-al.js",
    "./admin-sick.js",
    "./operations-app.js",
    "./operations-boot.js",
    "./error-reporter.js",
    "./usage-reporter.js",
    "./usage-stats.js",
    "./perf-reporter.js",
    "./perf-stats.js",
    "./roster-data.js",
    "./roster-cycle-data.js",
    "./firebase-client.js",
    "./client-errors.js",
    "./ls.js",
    "./overlay.js",
    "./session.js",
    "./auth-state-core.js",
    "./auth-state.js",
    "./auth-policy.js",
    "./sw-register.js",
    "./about-lightbox.js",
    "./tips-lightbox.js",
    "./login-overlay.js",
    "./nav-panel.js",
    "./notif.js",
    "./shared.css",
    "./manifest.json",
    "./paycalc.html",
    "./paycalc-app.js",
    "./paycalc-boot.js",
    "./paycalc-calc.js",
    "./paycalc-help.js",
    "./paycalc-migrations.js",
    "./paycalc-periods.js",
    "./paycalc-settings.js",
    "./paycalc-roster-hint.js",
    "./paycalc-hpp.js",
    "./paycalc-backpay.js",
    "./paycalc-format.js",
    "./paycalc-roster-suggestions.js",
    "./paycalc-lightboxes.js",
];

// Reference guides and icons — cached individually so a transient network error
// on any one file does not block the whole service worker from installing.
const SUPPLEMENTARY_ASSETS = [
    "./paycalc-guide.html",
    "./fip.html",
    "./guide.html",
    "./railcard-guide.html",
    "./railcard-guide.js",
    "./guide-print.js",
    "./guide-shell.css",
    "./guide.css",
    "./paycalc-guide.css",
    "./railcard-guide.css",
    "./fip.css",
    "./guide-doc.css",
    "./purify.es.mjs",
];

// Self-hosted typeface — stable asset, cache-first like icons. Precached so the
// app renders in Inter on the first offline launch (otherwise it would fall back
// to the system font until the file was fetched online once).
// cache-first: the old version persists until APP_VERSION bumps the cache name.
// If the font file ever needs updating, bump the app version in the same commit.
const FONT_ASSETS = [
    "./fonts/inter-latin.woff2",
];

const ICON_ASSETS = [
    "./icon-120.png",
    "./icon-152.png",
    "./icon-167.png",
    "./icon-180.png",
    "./icon-192.png",
    "./icon-512.png",
    "./icon-badge.png",
];

// ============================================
// INSTALL — activate immediately; precache happens AFTER activation (see below)
// ============================================
// ⚠ THE UPDATE-LAG FIX (v15.41). Precaching used to run inside install's
// event.waitUntil — and despite the early skipWaiting() call, a service worker
// CANNOT leave the 'installing' state until install's waitUntil settles. That
// held every update hostage to ~90 no-cache re-fetches: on a phone the new
// version took seconds-to-minutes to activate, and only THEN did the
// controllerchange reload fire — so the app abruptly reloaded itself long
// after staff had started using it ("the app updates with a lot of lag").
// Now install finishes instantly → activate → claim → the reload lands within
// moments of opening the app, and the cache is warmed in the background.
self.addEventListener("install", () => {
    console.log(`[SW ${APP_VERSION}] Installing (instant — precache deferred to post-activation)`);
    self.skipWaiting();
});

// Synthetic cache entry written ONLY when a warm-up completed with EVERY asset cached.
// Its absence on SW startup means the warm-up never finished (killed mid-run, or some
// fetches failed) → retry. Never requested by pages, so the fetch handler never sees it.
const PRECACHE_MARKER = './__precache-complete';

// The in-flight warm-up promise. The fetch handler piggybacks it onto event.waitUntil so
// the browser keeps the SW alive while page traffic flows — a detached promise alone has
// no lifetime guarantee and Chrome kills an idle SW ~30s after the last event settles.
let _warmupInFlight = null;

/** Start (or join) the cache warm-up. Runs DETACHED from the SW lifecycle events (never
 *  inside a waitUntil — install's would delay activation, which was the v15.33 update-lag
 *  bug; activate's would queue every fetch of the freshly-reloaded page behind ~90 files).
 *  Resilience (v15.46): a completion MARKER is written only when every asset cached, the
 *  top-level startup check re-runs an incomplete warm-up on every SW wake, and the fetch
 *  handler extends the SW's lifetime while a warm-up is in flight — so a killed or
 *  partially-failed warm-up retries until it genuinely completes, on first installs too. */
function startWarmup() {
    if (_warmupInFlight) return _warmupInFlight;
    _warmupInFlight = warmCacheAndSweepOld()
        .catch(err => console.warn(`[SW ${APP_VERSION}] cache warm-up failed (will retry on next SW start):`, err))
        .finally(() => { _warmupInFlight = null; });
    return _warmupInFlight;
}

async function warmCacheAndSweepOld() {
    const cache = await caches.open(CACHE_NAME);
    if (await cache.match(PRECACHE_MARKER)) return;   // already fully warmed + swept
    let allOk = true;
    const precache = asset => fetch(new Request(asset, { cache: 'no-cache' }))
        .then(res => {
            if (res.ok) return cache.put(asset, res);
            allOk = false;
            console.warn(`[SW ${APP_VERSION}] Asset cache skipped (${asset}): HTTP ${res.status}`);
        })
        .catch(err => { allOk = false; console.warn(`[SW ${APP_VERSION}] Asset cache skipped (${asset}):`, err); });
    await Promise.allSettled(CORE_ASSETS.map(precache));
    await Promise.allSettled([...SUPPLEMENTARY_ASSETS, ...FONT_ASSETS, ...ICON_ASSETS].map(precache));
    if (!allOk) {
        // Some assets missed (flaky network). Do NOT delete the old caches — they are the
        // fallback for exactly this situation — and do NOT write the marker, so the next
        // SW start retries the missing files. SWR also self-heals per-file on demand.
        console.warn(`[SW ${APP_VERSION}] Warm-up incomplete — keeping old caches; will retry`);
        return;
    }
    await cache.put(PRECACHE_MARKER, new Response('1'));
    console.log(`[SW ${APP_VERSION}] Pre-cached (complete)`);
    const cacheNames = await caches.keys();
    await Promise.all(
        cacheNames
            // Only prune THIS app's old version caches (myb-roster-v*). Scoping the
            // delete by prefix means we never clobber a cache owned by something else
            // sharing the origin, instead of deleting every non-current cache.
            .filter(name => name.startsWith('myb-roster-v') && name !== CACHE_NAME)
            .map(name => {
                console.log(`[SW ${APP_VERSION}] Deleting old cache:`, name);
                return caches.delete(name);
            })
    );
}

// STARTUP RE-CHECK — this top-level code runs every time the browser wakes the SW (any
// fetch/push/message), so a warm-up killed mid-run resumes on the next wake instead of
// leaving the "transition window" open until the next deploy. One cheap cache.match when
// already complete.
(async () => {
    try {
        const cache = await caches.open(CACHE_NAME);
        if (!(await cache.match(PRECACHE_MARKER))) startWarmup();
    } catch (_e) { /* best-effort */ }
})();

// ============================================
// ACTIVATE — claim all open tabs IMMEDIATELY; cache warm-up runs detached
// ============================================
// waitUntil holds ONLY the (instant) claim: functional events (fetch) are queued
// until activate's waitUntil settles, so putting the precache here would hang
// the freshly-reloaded page's every request until ~90 files finished. The
// warm-up + old-cache sweep run as a detached promise instead — the post-claim
// reload's own fetch traffic keeps the SW alive while it completes.
self.addEventListener("activate", event => {
    console.log(`[SW ${APP_VERSION}] Activating — claiming clients`);
    event.waitUntil(self.clients.claim());
    startWarmup();
});

// ============================================
// FETCH — network-first for HTML docs, stale-while-revalidate for JS/CSS, cache-first for assets
// ============================================
self.addEventListener("fetch", event => {
    // Piggyback an in-flight warm-up onto this event's lifetime so the browser doesn't
    // kill the SW mid-precache while page traffic is flowing (a detached promise alone
    // has no lifetime guarantee). Guarded: waitUntil can throw if the event settled.
    if (_warmupInFlight) { try { event.waitUntil(_warmupInFlight); } catch (_e) { /* settled */ } }
    // Only handle same-origin GET requests
    if (event.request.method !== "GET") return;
    const url = new URL(event.request.url);
    if (url.origin !== self.location.origin) return;

    const path = url.pathname;
    // HTML documents stay network-first (freshest entry point); JS/CSS use
    // stale-while-revalidate (instant from cache, refreshed in the background).
    const isDoc          = path === '/' || path.endsWith('/') || path.endsWith('.html');
    // Scope-relative so JS/CSS match under a sub-path (/roster-app/) too, not just root.
    const relPath        = path.startsWith(SCOPE_PATH) ? path.slice(SCOPE_PATH.length) : path.replace(/^\//, '');
    const isManagedAsset = NETWORK_FIRST_FILES.includes(relPath);

    if (isDoc) {
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
        // Shared fallback: serve cached app on network failure OR a broken-site response (4xx/5xx).
        // Only applies to document (navigation) requests — JS/CSS get Response.error() on failure.
        const serveFallback = (logMsg) => {
            console.log(`[SW ${APP_VERSION}] ${logMsg}`, path);
            const isDoc = event.request.destination === 'document';
            const PAGE_FALLBACKS = [
                ['paycalc',    './paycalc.html',    'Pay Calculator is not available offline. Please reconnect and reload.'],
                ['operations', './operations.html', 'Operations is not available offline. Please reconnect and reload.'],
                ['settings',   './settings.html',   'Settings is not available offline. Please reconnect and reload.'],
                ['links',      './links.html',       'Links is not available offline. Please reconnect and reload.'],
                ['admin',      './admin.html',       'Admin is not available offline. Please reconnect and reload.'],
            ];
            // Match the page by its exact path segment, not a substring — a substring
            // test (path.includes('admin')) would mis-route a future '/admin-report.html'
            // to the wrong fallback (the same class as the historical /admin-app.js MIME bug).
            const match      = isDoc && PAGE_FALLBACKS.find(([seg]) => path.endsWith(`/${seg}.html`) || path.endsWith(`/${seg}`));
            const fallback   = match ? match[1] : (isDoc ? './index.html' : null);
            const offlineMsg = match ? match[2] : 'The roster is not available offline. Please reconnect and reload.';
            // CURRENT-version cache first — the global caches.match() prefers the OLDEST
            // cache (creation order), which during a warm-up window served the PREVIOUS
            // version's HTML to a page whose JS then loaded fresh (a mixed-version page).
            // The any-version lookup stays as the last resort so pure-offline still works
            // mid-transition. iOS can evict the entire Cache Storage under storage
            // pressure — synthesise a minimal offline page so the request still resolves.
            return caches.open(CACHE_NAME).then(c => c.match(event.request))
                .then(r => r || caches.match(event.request))
                .then(r => r || (fallback ? caches.open(CACHE_NAME).then(c => c.match(fallback)).then(fr => fr || caches.match(fallback)) : null))
                .then(r => r || (isDoc
                    ? new Response(
                        `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Offline — Marylebone Roster</title></head><body><h1 style="font-family:sans-serif;padding:20px">Offline</h1><p style="font-family:sans-serif;padding:0 20px">${offlineMsg}</p></body></html>`,
                        { headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }, status: 200 }
                      )
                    : Response.error()
                ));
        };
        event.respondWith(
            fetch(freshReq)
                .then(response => {
                    clearTimeout(timeoutId);
                    if (response && response.status === 200) {
                        const clone = response.clone();
                        caches.open(CACHE_NAME)
                            .then(cache => cache.put(event.request, clone))
                            .catch(err => console.warn(`[SW ${APP_VERSION}] cache.put failed (quota?):`, err));
                        return response;
                    }
                    // Navigation request returned 4xx/5xx (e.g. staff site is down) — serve cached
                    // app so a notification tap still loads the app rather than GitHub's 404 page.
                    if (event.request.destination === 'document' && response && !response.ok) {
                        return serveFallback(`Navigation got ${response.status} — falling back to cache:`);
                    }
                    return response;
                })
                .catch(() => {
                    clearTimeout(timeoutId);
                    return serveFallback('Offline/timeout — serving from cache:');
                })
        );
    } else if (isManagedAsset) {
        // Stale-while-revalidate for JS/CSS: respond from cache immediately when present and
        // refresh the cache in the background; on a cold cache, wait for the network. The
        // version-pinned CACHE_NAME means the cache only ever holds the current version's
        // assets, so "stale" is at most one version behind during the brief window before a
        // newly-installed SW claims (skipWaiting + clients.claim on activate).
        event.respondWith((async () => {
            const cache   = await caches.open(CACHE_NAME);
            const cached  = await cache.match(event.request);
            const network = fetch(event.request)
                .then(response => {
                    if (response && response.status === 200) {
                        cache.put(event.request, response.clone())
                            .catch(err => console.warn(`[SW ${APP_VERSION}] SWR cache.put failed (quota?):`, err));
                    }
                    return response;
                })
                .catch(() => null);
            if (cached) {
                // Keep the background revalidation alive after we return the cached copy.
                // Guarded: calling waitUntil after the event settles throws on some browsers.
                try { event.waitUntil(network); } catch (_e) { /* event already settled */ }
                return cached;
            }
            // Cold current-version cache AND network failed: fall back to ANY cached copy
            // (caches.match searches every cache, incl. the previous version's — which the
            // warm-up deliberately keeps until the new cache is fully populated). This keeps
            // the app offline-usable during the brief post-update transition window.
            return (await network) || (await caches.match(event.request)) || Response.error();
        })());
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
// Payload shape (sent by Cloud Functions via buildPushPayload):
//   { title, body, url, tag }
// tag is the feature's stable tag from notifications.md ('huddle', 'circular',
// 'newsletter', 'pay-reminder') — or the SW-local fallback 'update' for a
// data-less/unparseable push. Using the same tag for repeat notifications of the
// same type means the new one replaces the old one in the Notification Centre
// rather than stacking.
self.addEventListener("push", event => {
    // Neutral defensive fallback for a data-less / unparseable push — we can't know the feature, so
    // do NOT assume a Huddle (the old fallback used the app name as title and mistagged everything as
    // 'huddle', colliding with real Huddle notifications). Well-formed payloads come from
    // buildPushPayload in functions/index.js and Object.assign over these defaults.
    let data = { title: "Marylebone Roster", body: "Open the app for the latest update." };
    try { if (event.data) Object.assign(data, event.data.json()); } catch (_) {}

    const url = data.url || "./";
    // Prefer explicit tag from payload; infer from the URL for legacy payloads; else a neutral tag
    // (NOT 'huddle') so an unidentified push never replaces/mislabels a real Huddle notification.
    const tag = data.tag || (url.includes('paycalc') ? 'pay-reminder' : 'update');

    event.waitUntil(
        self.registration.showNotification(data.title, {
            body:    data.body,
            // iOS Notification Centre uses 'icon' when the notification is reviewed
            // later — without it, iOS shows a generic globe glyph.
            // Resolve against the SW scope, not the bare origin: on the /roster-app/
            // GitHub Pages install, origin/icon-192.png 404s (bare origin = a different,
            // empty site). registration.scope ends in '/'.
            icon:    `${self.registration.scope}icon-192.png`,
            // Monochrome white-on-transparent silhouette — Android masks the badge to one colour in
            // the status bar, so the full-colour icon-192 produced a muddy blob (notifications.md).
            badge:   `${self.registration.scope}icon-badge.png`,
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
// The SW's own scope = the app ROOT, NOT the bare origin. On GitHub Pages the app is
// served from a sub-path (…/roster-app/), so the bare origin is a DIFFERENT, empty site
// that 404s. Notification taps must always land within scope. (registration.scope ends in '/'.)
const APP_SCOPE = self.registration.scope;
// Pages a push payload may open, RELATIVE to APP_SCOPE ('' = the app root). The Cloud
// Function hardcodes one absolute URL, but installs live on different origins/paths
// (…/roster-app/ vs myb-roster.web.app), so we take only the page + query + hash from the
// payload and RE-BASE it onto this install's scope — never trusting the payload's origin
// or path. This was the cause of the "notification opens a 404" bug: the old allowlist used
// bare-root routes (/index.html#huddle), so the real /roster-app/#huddle never matched and
// it fell back to the bare origin (a 404). Re-basing fixes it for any origin/sub-path.
const SAFE_NOTIFICATION_PAGES = ['', 'index.html', 'paycalc.html'];

self.addEventListener("notificationclick", event => {
    event.notification.close();
    const rawUrl = (event.notification.data && event.notification.data.url) || APP_SCOPE;
    let targetUrl = APP_SCOPE;   // safe default: the app root within scope (never the bare origin → 404)
    try {
        const parsed = new URL(rawUrl, APP_SCOPE);
        const page   = parsed.pathname.split('/').pop() || '';   // 'paycalc.html' | '' (app root)
        if (SAFE_NOTIFICATION_PAGES.includes(page)) {
            // Re-base onto THIS scope, e.g. …/roster-app/#huddle or …/roster-app/paycalc.html?payday=…
            targetUrl = APP_SCOPE + page + parsed.search + parsed.hash;
        }
    } catch (_) { /* keep the APP_SCOPE default */ }
    event.waitUntil(
        clients.matchAll({ type: 'window' }).then(list => {
            // Find any open window belonging to this app
            const win = list.find(c => c.url.startsWith(APP_SCOPE));
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
