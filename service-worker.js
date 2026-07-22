// MYB Roster — Service Worker
// Strategy:
//   HTML documents + JS modules + CSS (v16.10 — HTML joined JS/CSS, owner-approved)
//               → Stale-while-revalidate: served INSTANTLY from cache, then the
//                 cache is refreshed in the background. No blocking network wait
//                 on any page open. Freshness is preserved by the version-bump →
//                 new SW → new cache lifecycle (each deploy precaches fresh assets
//                 and the new SW claims immediately, then reloads the page); roster
//                 DATA is always live from Firestore, independent of cached code.
//                 A cache MISS (first visit / evicted storage) falls back to
//                 network-first with a 2s cache-fallback race for HTML.
//   Firebase SDK (gstatic, version-pinned) → Cache-first in a dedicated SDK-versioned
//                 cache; offline no longer depends on the browser HTTP cache.
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

const APP_VERSION = '18.30';
const CACHE_NAME  = `myb-roster-v${APP_VERSION}`;

// The SW's scope path — '/' on Firebase Hosting, '/roster-app/' on the GitHub Pages
// install. Managed-asset matching and notification icon/URL resolution all resolve
// relative to this, so the app behaves correctly under a sub-path, not just the root.
const SCOPE_PATH = new URL(self.registration.scope).pathname;

// Memoised handle on this version's cache — caches.open was being re-issued for every
// fetch event (~35 IPC hops per page open). Reset on failure so a transient error
// doesn't poison the SW for its whole lifetime.
let _cacheHandle = null;
function openCache() {
    if (!_cacheHandle) _cacheHandle = caches.open(CACHE_NAME).catch(err => { _cacheHandle = null; throw err; });
    return _cacheHandle;
}

// Strip the `redirected` flag off a response before caching or serving it to a navigation.
// Firebase Hosting 301-redirects /index.html → /, so a followed fetch of ./index.html
// yields a redirected response; storing/serving those to navigations (redirect mode
// 'manual') errors on the Safari lineage — the classic reason Workbox copies responses
// before precaching. Non-redirected responses pass through untouched.
function unredirect(res) {
    return res.redirected
        ? new Response(res.body, { status: res.status, statusText: res.statusText, headers: res.headers })
        : res;
}

// Managed JS/CSS files already background-revalidated during THIS SW process lifetime
// (see the stale-while-revalidate branch). Resets whenever the browser restarts the SW.
const _revalidated = new Set();

// Cross-version fallback selector (v16.86 — mixed-version window mitigation). When an asset
// misses the CURRENT version's cache and can't be fetched (offline / a mid-deploy hosting
// hiccup), it's served from a cached copy for availability. `caches.match()` searches every
// cache in CREATION order — it returns the OLDEST version's copy, maximising the version gap
// against any modules that DID load fresh from the current cache (a mixed, potentially
// interface-incompatible page). This picks the NEWEST available OLDER app cache instead, so a
// page that falls back mid-transition stays as close to single-version as the caches allow, and
// HTML + JS/CSS fallbacks land on the SAME older version. It REDUCES (does not eliminate) the
// window — a partially-warmed current cache can still pair a fresh module with an older fallback;
// fully closing it needs per-file version markers (removed in v16.81) or per-page load
// coordination, both deliberately out of scope. Fails safe: any error → null, and every caller
// already degrades a null to Response.error()/a network retry, so this is never worse than the
// previous caches.match() miss.
/** Parse 'myb-roster-v16.85' → [16, 85]; newest-first comparator for App caches. */
function _appCacheVersion(name) {
    const parts = name.slice('myb-roster-v'.length).split('.');
    return [parseInt(parts[0], 10) || 0, parseInt(parts[1], 10) || 0];
}
function compareAppCacheDesc(a, b) {
    const [aMajor, aMinor] = _appCacheVersion(a);
    const [bMajor, bMinor] = _appCacheVersion(b);
    return (bMajor - aMajor) || (bMinor - aMinor);
}
async function matchNewestManagedCache(request, opts) {
    try {
        const names = (await caches.keys())
            // App caches are 'myb-roster-v<ver>'. The SDK cache is 'myb-roster-sdk-v<ver>' — its
            // 12th char is 's', not 'v', so startsWith('myb-roster-v') already excludes it.
            .filter(name => name.startsWith('myb-roster-v'))
            .sort(compareAppCacheDesc);
        for (const name of names) {
            const cache = await caches.open(name);
            const hit = await cache.match(request, opts);
            if (hit) return hit;
        }
    } catch (_e) { /* broken Cache Storage → null; caller degrades to network/Response.error */ }
    return null;
}

// Firebase SDK runtime cache (v16.10, owner-approved): the gstatic CDN modules are
// version-pinned (immutable), but offline launch used to depend on the browser HTTP
// cache keeping ~400 KB of them — evictable under storage pressure on budget Androids,
// which silently broke offline with no self-heal. They are now served cache-first from
// a dedicated SDK-versioned cache — NOT the app cache, so a 0.01 app bump never
// refetches the SDK — swept only when the pinned SDK version changes. Bumping the SDK
// in firebase-client.js requires bumping THIS constant too; sw-asset-check.test.mjs
// enforces the pair stays in sync.
const FIREBASE_SDK_VERSION = '12.16.0';
const SDK_CACHE_NAME = `myb-roster-sdk-v${FIREBASE_SDK_VERSION}`;
const SDK_URL_PREFIX = `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/`;
const SDK_ASSETS = ['firebase-app.js', 'firebase-auth.js', 'firebase-firestore.js', 'firebase-storage.js']
    .map(f => SDK_URL_PREFIX + f);

// The "managed" same-origin app files: HTML pages, JS modules, and CSS — all served
// stale-while-revalidate (v16.10; HTML falls back to network-first on a cache miss).
// Everything here is precached so SWR can serve it instantly from cache.
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
    'admin-app.js', 'admin-boot.js', 'huddle.js', 'doc-upload.js', 'admin-auth.js', 'ls.js', 'nav-panel.js', 'notif.js',
    'admin-roster-upload.js', 'admin-overrides.js', 'admin-rangepicker.js',
    'admin-al.js', 'admin-sick.js', 'admin-range-booking.js', 'admin-email-check.js',
    'operations-app.js', 'operations-boot.js', 'operations-reports.js', 'settings-app.js', 'settings-boot.js', 'links-app.js', 'links-boot.js', 'links-design.js', 'links-analysis.js', 'links-compare.js',
    'overlay.js', 'session.js', 'auth-state-core.js', 'auth-state.js', 'auth-policy.js', 'sw-register.js', 'error-reporter.js', 'splash-watchdog.js',
    'usage-reporter.js', 'usage-stats.js', 'perf-reporter.js', 'perf-stats.js',
    'about-lightbox.js', 'tips-lightbox.js', 'login-overlay.js', 'date-picker.js',
    'roster-data.js', 'roster-cycle-data.js', 'firebase-client.js', 'claim-retry.js', 'storage-utils.js', 'storage-keys.js', 'auth-identity.js', 'client-errors.js',
    'shared.css',
    'paycalc.html', 'paycalc-app.js', 'paycalc-boot.js', 'paycalc-calc.js',
    'paycalc-help.js', 'paycalc-migrations.js',
    'paycalc-periods.js', 'paycalc-settings.js',
    'paycalc-roster-hint.js', 'paycalc-hpp.js', 'paycalc-backpay.js',
    'paycalc-format.js', 'paycalc-breakdown.js', 'paycalc-roster-suggestions.js', 'paycalc-lightboxes.js', 'paycalc-guide.html',
    'fip.html', 'guide.html',
    'railcard-guide.html',
    'railcard-guide.js', 'guide-print.js', 'fip.js', 'guide-shell.css',
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
    "./links-analysis.js",
    "./links-compare.js",
    "./settings-app.js",
    "./settings-boot.js",
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
    "./admin-boot.js",
    "./admin-email-check.js",
    "./huddle.js",
    "./admin-auth.js",
    "./admin-roster-upload.js",
    "./admin-overrides.js",
    "./admin-rangepicker.js",
    "./admin-al.js",
    "./admin-sick.js",
    "./admin-range-booking.js",
    "./operations-app.js",
    "./operations-boot.js",
    "./operations-reports.js",
    "./error-reporter.js",
    "./usage-reporter.js",
    "./usage-stats.js",
    "./perf-reporter.js",
    "./perf-stats.js",
    "./roster-data.js",
    "./roster-cycle-data.js",
    "./firebase-client.js",
    "./claim-retry.js",
    "./storage-utils.js",
    "./storage-keys.js",
    "./client-errors.js",
    "./ls.js",
    "./doc-upload.js",
    "./overlay.js",
    "./session.js",
    "./auth-identity.js",
    "./auth-state-core.js",
    "./auth-state.js",
    "./auth-policy.js",
    "./sw-register.js",
    "./splash-watchdog.js",
    "./about-lightbox.js",
    "./tips-lightbox.js",
    "./login-overlay.js",
    "./date-picker.js",
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
    "./paycalc-breakdown.js",
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
    "./fip.js",
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
// ⚠ If the font (or any icon) ever needs updating, RENAME the file as well as bumping
// the version: fonts/icons warm via the HTTP cache (served max-age=1y immutable, and
// the warm-up deliberately doesn't force revalidation — v16.09), so same-name byte
// changes would repopulate the new cache from a year-old HTTP-cache copy.
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
 *  inside a waitUntil — install's would delay activation, which was the v15.41 update-lag
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

/** Run precache fetches a few at a time instead of ~100 in parallel — the warm-up fires
 *  right after the post-update reload, and an unbounded burst starved the freshly-loaded
 *  page's own critical path (modules on the cold new cache, Firestore) of the one mobile
 *  connection. Failures are recorded by the precache fn itself. */
async function fetchInBatches(assets, precacheFn) {
    const BATCH = 8;
    for (let i = 0; i < assets.length; i += BATCH) {
        await Promise.allSettled(assets.slice(i, i + BATCH).map(precacheFn));
    }
}

/** Content-type sanity check before caching an asset (v16.23; positively validated v17.01). A
 *  trusted-cert intermediary (corporate MITM / managed-device proxy) can return a 200 body of ANY
 *  type for ANY URL — an HTML login interstitial, a JSON/XML gateway error; caching that under a
 *  module path poisons the version cache for its whole life (SyntaxError → stuck splash). The old
 *  rule rejected only a PRESENT text/html; a wrong-but-not-html body (e.g. `application/json` under
 *  a `.js` path — Finding #10) slipped through. Now POSITIVELY match the asset's extension to its
 *  expected content-type family; a MISSING type is still accepted (offline-first tolerance — a
 *  same-origin 200 with no CT is trusted), and an UNKNOWN extension falls back to the old reject-html
 *  rule so a new asset kind can never be silently dropped. Rejecting is SAFE: ctSafe only gates
 *  CACHING (the response is still served to the page), so the worst case is a re-fetch next time —
 *  never a broken page — while caching a wrong body breaks the app for the version's whole life. */
function ctSafe(assetPath, res) {
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (!ct) return true;   // missing type — trust a same-origin 200 (offline-first tolerance)
    const p = assetPath;
    const ends = (/** @type {string} */ s) => p.endsWith(s);
    if (ends('.html') || ends('/') || p === './') return ct.includes('text/html');
    if (ends('.mjs') || ends('.js'))               return ct.includes('javascript');
    if (ends('.css'))                              return ct.includes('text/css');
    if (ends('.json'))                             return ct.includes('json');   // application/json | manifest+json
    if (ends('.woff2'))                            return ct.includes('woff') || ct.includes('font');
    if (ends('.png'))                              return ct.includes('image/png');
    if (ends('.svg'))                              return ct.includes('svg') || ct.includes('xml');
    return !ct.includes('text/html');   // unknown extension — keep the original lenient reject-html rule
}

/** fetch with a hard timeout (v16.23). The warm-up had NO per-fetch timeout, so one hung
 *  fetch (half-open TCP on flaky mobile) stalled its batch forever — the marker was never
 *  written and every fetch event's waitUntil(_warmupInFlight) kept the SW pinned alive.
 *  An abort REJECTS, which the per-asset .catch records as a miss → normal retry-next-wake. */
function fetchWithTimeout(req, ms = 30000) {
    if (typeof AbortController === 'undefined') return fetch(req);
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), ms);
    return fetch(new Request(req, { signal: c.signal })).finally(() => clearTimeout(t));
}

async function warmCacheAndSweepOld() {
    const cache = await openCache();
    if (await cache.match(PRECACHE_MARKER)) return;   // already fully warmed + swept
    let allOk = true;
    // revalidate=true → cache:'no-cache' (app code: server serves no-cache, so this is a
    // conditional 304 check). revalidate=false → default HTTP-cache mode for the immutable
    // fonts/icons (max-age=1y) — forcing revalidation there was 8 guaranteed-304 round
    // trips per warm-up for assets that only ever change alongside a version bump.
    const precache = (asset, revalidate) => (async () => {
        // The post-update page load populates this same cache through the fetch handler at
        // the same moment — skip anything already present instead of fetching it twice.
        // (Everything in this version-pinned cache was fetched fresh from the origin.)
        if (await cache.match(asset)) return;
        const res = await fetchWithTimeout(new Request(asset, revalidate ? { cache: 'no-cache' } : {}));
        if (res.ok && ctSafe(asset, res)) return cache.put(asset, unredirect(res));
        allOk = false;   // non-ok OR wrong content-type (interstitial) — don't cache, don't sweep, retry next wake
        console.warn(`[SW ${APP_VERSION}] Asset cache skipped (${asset}): ${res.ok ? 'unexpected content-type' : `HTTP ${res.status}`}`);
    })().catch(err => { allOk = false; console.warn(`[SW ${APP_VERSION}] Asset cache skipped (${asset}):`, err); });
    await fetchInBatches(CORE_ASSETS, a => precache(a, true));
    await fetchInBatches(SUPPLEMENTARY_ASSETS, a => precache(a, true));
    await fetchInBatches([...FONT_ASSETS, ...ICON_ASSETS], a => precache(a, false));
    // Warm the SDK cache too — offline-first must not depend on the browser HTTP cache
    // keeping the CDN modules. SDK failures are tracked SEPARATELY (sdkOk, v16.11) so
    // third-party CDN reachability can never hold the APP-cache sweep hostage. Default
    // cache mode: the URLs are immutable, so an HTTP-cache copy is always valid.
    let sdkOk = true;
    const sdkCache = await caches.open(SDK_CACHE_NAME);
    const precacheSdk = sdkUrl => (async () => {
        if (await sdkCache.match(sdkUrl)) return;   // runtime route may have cached it already
        const res = await fetchWithTimeout(sdkUrl);
        if (res.ok && ctSafe(sdkUrl, res)) return sdkCache.put(sdkUrl, res);
        sdkOk = false;   // non-ok OR an HTML interstitial masquerading as the SDK module
        console.warn(`[SW ${APP_VERSION}] SDK cache skipped (${sdkUrl}): ${res.ok ? 'unexpected content-type' : `HTTP ${res.status}`}`);
    })().catch(err => { sdkOk = false; console.warn(`[SW ${APP_VERSION}] SDK cache skipped (${sdkUrl}):`, err); });
    await fetchInBatches(SDK_ASSETS, precacheSdk);

    // Sweep superseded caches as soon as their REPLACEMENT is complete, per group:
    // old app caches once every app asset cached (they are the fallback for exactly the
    // incomplete-app case, so an app miss keeps them); old SDK caches once the new SDK
    // cache is fully warmed. Decoupled (v16.11) so a device that can't reach gstatic —
    // where the app is hard-broken anyway — doesn't accumulate an old app cache per
    // deploy forever. Prefix-scoped so we never clobber another cache on the origin.
    const cacheNames = await caches.keys();
    await Promise.all(
        cacheNames
            .filter(name => (allOk && name.startsWith('myb-roster-v') && name !== CACHE_NAME)
                         || (sdkOk && name.startsWith('myb-roster-sdk-v') && name !== SDK_CACHE_NAME))
            .map(name => {
                console.log(`[SW ${APP_VERSION}] Deleting old cache:`, name);
                return caches.delete(name);
            })
    );
    if (!allOk || !sdkOk) {
        // Something missed (flaky network / unreachable CDN). Do NOT write the marker, so
        // the next SW start retries the missing files (everything cached is skip-if-cached,
        // so a retry only re-fetches the gaps). SWR also self-heals per-file on demand.
        console.warn(`[SW ${APP_VERSION}] Warm-up incomplete (app ${allOk ? 'ok' : 'MISSES'}, sdk ${sdkOk ? 'ok' : 'MISSES'}) — will retry`);
        return;
    }
    await cache.put(PRECACHE_MARKER, new Response('1'));
    console.log(`[SW ${APP_VERSION}] Pre-cached (complete)`);
}

// STARTUP RE-CHECK — this top-level code runs every time the browser wakes the SW (any
// fetch/push/message), so a warm-up killed mid-run resumes on the next wake instead of
// leaving the "transition window" open until the next deploy. One cheap cache.match when
// already complete.
(async () => {
    try {
        const cache = await openCache();
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
    event.waitUntil(Promise.all([
        self.clients.claim(),
        // Navigation Preload: the browser starts the HTML fetch in PARALLEL with SW boot.
        // Since v16.10 (HTML stale-while-revalidate) it doubles as the free background
        // refresh on a cache hit, and still saves ~50–250ms on the cache-miss path when
        // the SW process was cold. The doc branch consumes event.preloadResponse.
        // Feature-detected (iOS < 15.4 lacks it); failure is non-fatal — the doc branch
        // falls back to the SW's own fetch.
        self.registration.navigationPreload
            ? self.registration.navigationPreload.enable().catch(() => {})
            : null,
    ]));
    startWarmup();
});

// ============================================
// FETCH — stale-while-revalidate for HTML/JS/CSS, cache-first for SDK + stable assets
// ============================================
self.addEventListener("fetch", event => {
    // Piggyback an in-flight warm-up onto this event's lifetime so the browser doesn't
    // kill the SW mid-precache while page traffic is flowing (a detached promise alone
    // has no lifetime guarantee). Guarded: waitUntil can throw if the event settled.
    if (_warmupInFlight) { try { event.waitUntil(_warmupInFlight); } catch (_e) { /* settled */ } }
    // Only handle same-origin GET requests — plus the pinned Firebase SDK modules.
    if (event.request.method !== "GET") return;
    const url = new URL(event.request.url);

    // Firebase SDK modules: cache-first from the SDK-versioned cache. The URLs are
    // version-pinned (immutable), so a cached copy is always correct; on a miss the
    // network response is cached for deterministic offline. During an SDK bump, a
    // still-open OLD page imports the old-version URLs — those fail this prefix check
    // and pass through to the browser/network untouched (the pre-v16.10 behaviour),
    // which is fine for the seconds until the update reload. The .catch below is
    // storage-error resilience only (a broken Cache Storage must not kill the fetch).
    if (url.href.startsWith(SDK_URL_PREFIX)) {
        event.respondWith(
            caches.open(SDK_CACHE_NAME).then(cache =>
                cache.match(event.request).then(cached => cached
                    || fetch(event.request).then(response => {
                        // ctSafe (v16.23): match the warm-up/SWR puts — never cache an HTML
                        // interstitial masquerading as an SDK module (the runtime path was the
                        // one remaining unguarded put).
                        if (response && response.status === 200 && ctSafe(url.pathname, response)) {
                            const clone = response.clone();
                            cache.put(event.request, clone).catch(() => {});
                        }
                        return response;
                    })
                )
            // Terminal backstop hardening (v16.23): the fallback caches.match can ITSELF reject on a
            // fully-broken Cache Storage (rejecting respondWith → failed SDK import → app won't boot),
            // and when caches.open rejected the fetch above was never reached — so an ONLINE device
            // with wedged storage got Response.error() without ever trying the network. Catch the
            // fallback lookup and end with a real network attempt, mirroring the doc branch.
            ).catch(() => caches.match(event.request).catch(() => null))
             .then(r => r || fetch(event.request).catch(() => Response.error()))
        );
        return;
    }
    if (url.origin !== self.location.origin) return;

    const path = url.pathname;
    // HTML documents and JS/CSS are both stale-while-revalidate (v16.10) — instant from
    // cache, refreshed in the background; HTML falls back to network-first on a miss.
    const isDoc          = path === '/' || path.endsWith('/') || path.endsWith('.html');
    // Scope-relative so JS/CSS match under a sub-path (/roster-app/) too, not just root.
    const relPath        = path.startsWith(SCOPE_PATH) ? path.slice(SCOPE_PATH.length) : path.replace(/^\//, '');
    const isManagedAsset = NETWORK_FIRST_FILES.includes(relPath);

    if (isDoc) {
        // Cache-hit → served instantly (SWR, v16.10). Miss → network-first: revalidate
        // against the server (304 if unchanged → no body download), update the SW cache,
        // fall back to cached copy if offline or the network hangs past 2 seconds.
        // The network source is the browser's Navigation Preload response when available
        // (started in parallel with SW boot — see activate); else the SW's own fetch below.
        // AbortController cancels OUR fetch on timeout (feature-detected: it throws in
        // service workers on iOS < 15.1); a preload response can't be cancelled, so a late
        // one still refreshes the cache via waitUntil — only this response is already served.
        // 2 s timeout: fast enough for 4G, short enough to serve cache quickly on poor signal.
        // cache: 'no-cache' (vs 'no-store') lets the browser do a conditional request and
        // return 304 when the file is unchanged — same freshness, much less bandwidth.
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
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
            // ignoreSearch: navigations are cached under the bare path (no ?query — see the
            // network handler), so a deep link like paycalc.html?payday=… must match it.
            // Every cache lookup below is .catch-guarded (v16.23): a rejecting openCache/match on
            // broken storage previously rejected the WHOLE fallback chain — skipping the synthesized
            // offline page exactly when it was designed to appear (the rejection then landed in the
            // untimed outer network backstop). The offline page must always be reachable.
            return openCache().then(c => c.match(event.request, { ignoreSearch: true })).catch(() => null)
                .then(r => r || matchNewestManagedCache(event.request, { ignoreSearch: true }))
                .then(r => r || (fallback ? openCache().then(c => c.match(fallback)).then(fr => fr || matchNewestManagedCache(fallback)).catch(() => null) : null))
                .then(r => r || (isDoc
                    ? new Response(
                        `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Offline — Marylebone Roster</title></head><body><h1 style="font-family:sans-serif;padding:20px">Offline</h1><p style="font-family:sans-serif;padding:0 20px">${offlineMsg}</p></body></html>`,
                        { headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }, status: 200 }
                      )
                    : Response.error()
                ));
        };
        event.respondWith((async () => {
            // ── STALE-WHILE-REVALIDATE for HTML (v16.10, owner-approved — replaces the
            // v14.18 network-first decision): serve the cached page INSTANTLY when this
            // version's cache has it, and let the network fetch below refresh the cache in
            // the background. This removes the last blocking round trip per page open
            // (100–500ms on 4G; a full 2s on the old timeout path when offline/poor signal).
            // Freshness still propagates exactly like JS/CSS: HTML never changes without a
            // version bump → new SW → new cache → warm-up → controllerchange reload. Serving
            // HTML and JS from the SAME version cache also shrinks the mixed-version window
            // network-first had (fresh HTML + cached JS during a deploy transition).
            // EXACT-page match only — '/' (the scope root) additionally tries the warm-up's
            // './index.html' key. Never map one page to another here: serveFallback's
            // index-default is OFFLINE-fallback behaviour, not an instant-serve rule.
            // A broken Cache Storage (corrupt IndexedDB backing, iOS eviction mid-read) must
            // DEGRADE to the network path, never reject: a rejected respondWith on a navigation
            // makes the browser render its own error page, so index.html — and therefore the
            // splash — never even loads (the stuck-launch class the watchdog papers over). The
            // SDK and cache-first branches already .catch their cache access; the two SWR
            // branches were the odd ones out (v16.19).
            const cache = await openCache().catch(() => null);
            const cachedDoc = cache
                ? (await cache.match(event.request, { ignoreSearch: true }).catch(() => null)
                    || (relPath === '' ? await cache.match('./index.html').catch(() => null) : null))
                : null;

            let networkSettled = false;
            const networkPromise = (event.preloadResponse
                // The preload promise RESOLVES undefined when preload is disabled/unsupported
                // (→ fall back to our own fetch) but REJECTS when the preload network request
                // itself errors — so it needs a reject handler too, or on a cache MISS a preload
                // failure would reach serveFallback and show the offline page to an ONLINE user
                // whose own fetch would have worked. Two-arg .then (not trailing .catch) so a
                // genuine offline fetch rejection still propagates instead of re-fetching.
                ? event.preloadResponse.then(pre => pre || fetch(freshReq), () => fetch(freshReq))
                : Promise.resolve().then(() => fetch(freshReq))
            ).then(response => {
                networkSettled = true;
                // Only cache a genuine HTML document. A 200 that is NOT html (a host
                // interstitial or a JSON error page returned with status 200) would otherwise
                // be written under the page path and served instantly by SWR for the life of
                // the version cache. A MISSING content-type still caches (offline-first
                // guarantee: Firebase always sets it, so absence means a stub we shouldn't
                // second-guess) — only a present, clearly-non-html type is skipped (v16.19).
                const ct = response ? (response.headers.get('content-type') || '') : '';
                if (response && response.status === 200 && (!ct || ct.includes('text/html'))) {
                    // Cache under the bare path (query stripped): every distinct
                    // paycalc.html?payday=… would otherwise pile up as its own ~40 KB entry
                    // for the life of the version cache. serveFallback matches ignoreSearch.
                    const clone = response.clone();
                    openCache()
                        .then(c => c.put(url.origin + url.pathname, unredirect(clone)))
                        .catch(err => console.warn(`[SW ${APP_VERSION}] cache.put failed (quota?):`, err));
                }
                return response;
            }, err => { networkSettled = true; throw err; });
            // Keep the SW alive so the background/late network result still refreshes the
            // cache for the NEXT open (a preload response cannot be aborted anyway, so
            // consuming it here is free — the browser already sent the request).
            try { event.waitUntil(networkPromise.catch(() => null)); } catch (_e) { /* settled */ }

            if (cachedDoc) return cachedDoc;
            // Cache miss (first visit to this page, or evicted storage): network-first with
            // the 2s cache-fallback race, exactly as before v16.10.

            // The abort is GUARDED on networkSettled: firing it after the response resolved
            // would kill the body mid-stream (the old timeout-boundary race, where a response
            // arriving at ~1999ms could be destroyed by the 2000ms abort).
            const timeout = new Promise(resolve => setTimeout(() => {
                if (!networkSettled && controller) controller.abort();
                resolve('timeout');
            }, 2000));

            let response;
            try {
                const winner = await Promise.race([networkPromise, timeout]);
                if (winner === 'timeout') return serveFallback('Offline/timeout — serving from cache:');
                response = winner;
            } catch (_err) {
                return serveFallback('Offline/timeout — serving from cache:');
            }
            if (response && response.status === 200) return unredirect(response);
            // A redirect under redirect-mode 'manual' (navigation preload, or a manual-mode
            // fetch) surfaces as type 'opaqueredirect' — status 0, ok:false. Pass it straight
            // through: the BROWSER follows the redirect and issues a fresh navigation (and
            // fetch event) for the target. Treating it as a broken-site response sent every
            // installed-PWA launch (start_url ./index.html → Firebase 301 → /) down the
            // cache-fallback path — network-first defeated for the entry point.
            if (response && response.type === 'opaqueredirect') return response;
            // Navigation request returned 4xx/5xx (e.g. staff site is down) — serve cached
            // app so a notification tap still loads the app rather than GitHub's 404 page.
            if (event.request.destination === 'document' && response && !response.ok) {
                return serveFallback(`Navigation got ${response.status} — falling back to cache:`);
            }
            return response;
        })().catch(() => fetch(event.request).catch(() => Response.error())));
        // Ultimate backstop: if ANYTHING in the doc branch rejects (a broken Cache Storage
        // reaching serveFallback's own un-caught openCache().then chain), degrade to a plain
        // network fetch, then a network-error response — never a rejected navigation (v16.19).
    } else if (isManagedAsset) {
        // Stale-while-revalidate for JS/CSS: respond from cache immediately when present and
        // refresh the cache in the background; on a cold cache, wait for the network. The
        // version-pinned CACHE_NAME means the cache only ever holds the current version's
        // assets, so "stale" is at most one version behind during the brief window before a
        // newly-installed SW claims (skipWaiting + clients.claim on activate).
        event.respondWith((async () => {
            const cache   = await openCache();
            const cached  = await cache.match(event.request);
            // Background-revalidate each file at most ONCE per SW process lifetime. The
            // cache is version-pinned and content never changes within a version (the
            // mandatory bump rule), so per-request refreshes were ~35 guaranteed no-op 304s
            // on EVERY page open — pure radio/connection contention against the page's own
            // Firestore traffic. One check per SW start keeps the self-heal for a
            // hypothetically un-bumped deploy without the storm.
            let network = null;
            if (!cached || !_revalidated.has(relPath)) {
                _revalidated.add(relPath);
                network = fetch(event.request)
                    .then(response => {
                        // ctSafe (v16.23): never cache a text/html body under a JS/CSS path — a
                        // proxy interstitial 200 would otherwise poison the module for the whole
                        // version (this branch never serves .html; isDoc routes those first).
                        if (response && response.status === 200 && ctSafe(relPath, response)) {
                            cache.put(event.request, response.clone())
                                .catch(err => console.warn(`[SW ${APP_VERSION}] SWR cache.put failed (quota?):`, err));
                        }
                        return response;
                    })
                    .catch(() => null);
            }
            if (cached) {
                // Keep the background revalidation (when one started) alive after we return
                // the cached copy. Guarded: waitUntil after the event settles can throw.
                if (network) { try { event.waitUntil(network); } catch (_e) { /* settled */ } }
                return cached;
            }
            // Cold current-version cache: prefer a GOOD (2xx) network response, but if the network
            // resolved a 4xx/5xx (a transient 502 mid-deploy, a hosting hiccup) fall back to ANY
            // cached copy — the previous version's cache still holds a working module (caches.match
            // searches every cache; the warm-up keeps the old one until the new is fully populated).
            // Returning the bad response to a <script type=module> would break the import and stick
            // the splash — the doc branch already falls back on !response.ok, this mirrors it (v16.19).
            const net = await network;
            // Prefer a good network response; else the NEWEST older cached copy (not the oldest
            // caches.match() would pick) so a mid-deploy fallback stays closest to the current
            // version — see matchNewestManagedCache. Null → Response.error() → clean reload (v16.86).
            return (net && net.ok ? net : null) || (await matchNewestManagedCache(event.request)) || Response.error();
        })().catch(() => caches.match(event.request).catch(() => null)
            .then(r => r || fetch(event.request).catch(() => Response.error()))));
        // A rejected respondWith for a <script type=module> fails the import and breaks the
        // module graph → calendar-app.js never runs → the splash sticks. A broken Cache
        // Storage at the initial openCache()/cache.match must degrade like the else-branch,
        // not hard-fail the module load (v16.19). v16.23: the backstop's own caches.match can
        // ALSO reject on fully-broken storage, and when openCache rejected the branch's fetch
        // was never reached — so catch the lookup and end with a real network attempt (an
        // online device with wedged storage must still get its modules).
    } else {
        // Cache-first: icons/manifest served from cache instantly, fetched if missing
        event.respondWith(
            caches.match(event.request)
                .then(cached => {
                    if (cached) return cached;
                    return fetch(event.request).then(response => {
                        // ctSafe (v16.83): match the SWR/SDK/warm-up puts — never cache a text/html
                        // body under an icon/font/manifest path. A corporate-proxy login interstitial
                        // returned as 200 for manifest.json or icon-192.png would otherwise poison the
                        // cache for the life of the version cache (the exact class ctSafe was added for).
                        if (response && response.status === 200 && ctSafe(url.pathname, response)) {
                            const clone = response.clone();
                            // .catch to match the SWR/SDK puts — an unguarded put rejects (quota /
                            // broken Cache Storage) as an unhandled rejection; respondWith still
                            // returns the response independently, so caching is best-effort (v16.19).
                            openCache().then(cache => cache.put(event.request, clone)).catch(() => {});
                        }
                        return response;
                    });
                })
                // Match the SDK/managed branches' resilience: on a broken Cache Storage or an
                // offline miss, degrade to a network-error response instead of a rejected
                // respondWith (a hard browser error). v16.23: guard the fallback lookup itself
                // and end with a network attempt, like the other branches.
                .catch(() => caches.match(event.request).catch(() => null)
                    .then(r => r || fetch(event.request).catch(() => Response.error())))
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
// Huddle → index.html#huddle (the in-app Huddle viewer opens on the hash; the old #huddleBtn
//   title-bar button was removed at v12.57 — the viewer is reached via the nav link + this tap).
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
                    // ALWAYS navigate — never compare focusedClient.url first. Client.url is
                    // the client's CREATION url (per spec), which does not track the huddle
                    // viewer's history.replaceState hash-strip: after one #huddle open, a
                    // repeat tap on the still-alive window compared equal and became a
                    // no-op (the viewer never opened again until the OS killed the window).
                    // Navigating is cheap when only the hash differs (same-document), and
                    // the viewer always strips its hash after opening, so hashchange
                    // re-fires reliably on every tap.
                    if ('navigate' in focusedClient) {
                        return focusedClient.navigate(targetUrl)
                            .catch(() => clients.openWindow(targetUrl));
                    }
                    // navigate() unsupported (defensive — universal on push-capable browsers):
                    // fall back to a fresh window rather than dead-ending the tap with only a
                    // focus and no deep link (v16.23).
                    return clients.openWindow(targetUrl);
                }).catch(() => clients.openWindow(targetUrl));
            }
            return clients.openWindow(targetUrl);
        })
    );
});
