// MYB Roster — Service Worker
// Strategy (the do-not-revert decisions: .claude/rules/pwa.md):
//   HTML documents + JS modules + CSS (owner-approved)
//               → Served INSTANTLY from this version's cache; a cached entry is never
//                 rewritten (it mixed releases — see the JS/CSS branch) or re-fetched.
//                 Freshness is the version-bump → new SW → new cache lifecycle; roster
//                 DATA is always live from Firestore, independent of cached code.
//                 A cache MISS (first visit / evicted storage) falls back to
//                 network-first with a 2s cache-fallback race for HTML.
//   Firebase SDK (gstatic, version-pinned) → Cache-first in a dedicated SDK-versioned cache.
//   Icons, fonts, manifest → Cache-first: stable assets served instantly; fetched on miss.
//   Anything under docs/ (the repository's documents, on the Pages mirror) → left to the browser.
//
// install does ONLY skipWaiting() (the precache is a detached post-activation warm-up — see the
// install handler note); activate claims every open tab at once, so an update lands within moments.
// The app also sends SKIP_WAITING on the rare edge case where a waiting SW needs a nudge.
// The cache name includes the app version, so every bump refreshes the cache on all clients.

const APP_VERSION = '27.04';
const CACHE_NAME  = `myb-roster-v${APP_VERSION}`;

// The SW's scope path — '/' on Firebase Hosting, '/roster-app/' on the GitHub Pages
// install. Managed-asset matching and notification icon/URL resolution all resolve
// relative to this, so the app behaves correctly under a sub-path, not just the root.
const SCOPE_PATH = new URL(self.registration.scope).pathname;

// Memoised handle on this version's cache (one caches.open, not one per fetch event). Reset on
// failure so a transient error doesn't poison the SW for its whole lifetime.
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

// Cross-version fallback selector (mixed-version window mitigation). When an asset misses the
// CURRENT version's cache and can't be fetched (offline / a mid-deploy hiccup), it's served from a
// cached copy. `caches.match()` searches in CREATION order and returns the OLDEST version's copy,
// maximising the gap against modules that DID load fresh (a mixed, potentially incompatible page).
// This picks the NEWEST OLDER app cache instead, so HTML + JS/CSS fallbacks land on the SAME older
// version. It REDUCES (does not eliminate) the window. Fails safe: any error → null, which every
// caller already degrades to Response.error()/a network retry.
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

// Firebase SDK runtime cache (owner-approved): the gstatic modules are version-pinned (immutable),
// and offline launch must not depend on the browser HTTP cache keeping ~400 KB of them (evictable
// on budget Androids). Served cache-first from a dedicated SDK-versioned cache — NOT the app cache,
// so an app bump never refetches the SDK — swept only when the SDK version changes. The constant is
// WRITTEN from firebase-client.js's imports: move the SDK there, then run npm run generate:copies.
const FIREBASE_SDK_VERSION = '13.2.0'; // GENERATED from firebase-client.js by npm run generate:copies
const SDK_CACHE_NAME = `myb-roster-sdk-v${FIREBASE_SDK_VERSION}`;
const SDK_URL_PREFIX = `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/`;
const SDK_ASSETS = ['firebase-app.js', 'firebase-auth.js', 'firebase-firestore.js', 'firebase-storage.js']
    .map(f => SDK_URL_PREFIX + f);

// GENERATED app files: npm run generate:copies writes every line down to the END marker, from each app page, its stylesheets and its imports (scripts/app-pages.mjs). Never edit them by hand.
const APP_FILES = [
    'index.html',
    'admin.html',
    'paycalc.html',
    'operations.html',
    'settings.html',
    'links.html',
    'overtime.html',
    'trains.html',
    'newlink.html',
    'admin.css',
    'index.css',
    'links.css',
    'newlink.css',
    'operations.css',
    'overtime.css',
    'paycalc.css',
    'settings.css',
    'shared.css',
    'trains.css',
    'about-lightbox.js',
    'account-calls.js',
    'admin-al-projection.js',
    'admin-al-spare-note.js',
    'admin-al-week-save.js',
    'admin-al-year.js',
    'admin-al.js',
    'admin-app.js',
    'admin-auth.js',
    'admin-booked-periods.js',
    'admin-boot.js',
    'admin-bulk-apply.js',
    'admin-confirm-bar.js',
    'admin-day-pills.js',
    'admin-deep-link.js',
    'admin-leave-year-save.js',
    'admin-leave-year.js',
    'admin-override-coverage.js',
    'admin-override-store.js',
    'admin-overrides.js',
    'admin-own-write.js',
    'admin-period-dates.js',
    'admin-period-delete.js',
    'admin-range-booking.js',
    'admin-rangepicker.js',
    'admin-roster-upload.js',
    'admin-save-receipt.js',
    'admin-saved-changes.js',
    'admin-shift-rules.js',
    'admin-shift-types.js',
    'admin-sick.js',
    'admin-time-inputs.js',
    'admin-tips.js',
    'admin-week-collect.js',
    'admin-week-editor.js',
    'admin-week-row-state.js',
    'admin-week-swipe.js',
    'al-contract.js',
    'al-entitlement.js',
    'al-leave-compare.js',
    'al-leave-file.js',
    'al-leave-plan.js',
    'al-leave-save.js',
    'al-leave-words.js',
    'al-swapped-days.js',
    'analytics-client.js',
    'auth-identity.js',
    'auth-policy.js',
    'auth-state-core.js',
    'auth-state.js',
    'calendar-access-core.js',
    'calendar-access-state.js',
    'calendar-access.js',
    'calendar-al-lightbox.js',
    'calendar-app.js',
    'calendar-data-state.js',
    'calendar-doc-access.js',
    'calendar-doc-viewer.js',
    'calendar-drawer.js',
    'calendar-huddle-viewer.js',
    'calendar-initial-fetch.js',
    'calendar-keyboard.js',
    'calendar-legend.js',
    'calendar-lock-cards.js',
    'calendar-lock-slot.js',
    'calendar-member.js',
    'calendar-month-jump.js',
    'calendar-notices.js',
    'calendar-notif-prompt.js',
    'calendar-overrides.js',
    'calendar-own-copy.js',
    'calendar-redraw.js',
    'calendar-renderer.js',
    'calendar-snapshot.js',
    'calendar-state.js',
    'calendar-swipe.js',
    'calendar-team-view.js',
    'calendar-tips.js',
    'card-collapse.js',
    'christmas-leave.js',
    'claim-retry.js',
    'client-errors.js',
    'clock-input.js',
    'date-format.js',
    'date-picker.js',
    'doc-retention.js',
    'doc-upload.js',
    'document-url.js',
    'documents-client.js',
    'error-reporter.js',
    'feedback-line.js',
    'fetch-timeout.js',
    'firebase-client.js',
    'function-url.js',
    'glossary.js',
    'guide-index.js',
    'guide-search.js',
    'huddle-table-grid.js',
    'huddle.js',
    'install-prompt.js',
    'leave-year.js',
    'links-adjacency.js',
    'links-analyse.js',
    'links-analysis.js',
    'links-app.js',
    'links-boot.js',
    'links-brush-bar.js',
    'links-build-button.js',
    'links-build-press.js',
    'links-compare-analysis.js',
    'links-compare.js',
    'links-concurrency.js',
    'links-default-targets.js',
    'links-deletion.js',
    'links-demand.js',
    'links-design-doc.js',
    'links-design-header.js',
    'links-design-library.js',
    'links-design-load.js',
    'links-design-naming.js',
    'links-design-store.js',
    'links-design.js',
    'links-fatigue.js',
    'links-generate.js',
    'links-generator-targets.js',
    'links-grid-cells.js',
    'links-grid-input.js',
    'links-grid.js',
    'links-import.js',
    'links-limits.js',
    'links-print.js',
    'links-proposals.js',
    'links-queued-saves.js',
    'links-seed.js',
    'links-shortlist.js',
    'links-target-hours.js',
    'links-target-sets-store.js',
    'links-target-sets.js',
    'links-tips.js',
    'links-today.js',
    'links-window-editor.js',
    'links-window.js',
    'login-core.js',
    'login-overlay.js',
    'ls.js',
    'mirror-move-words.js',
    'mirror-move.js',
    'nav-bell.js',
    'nav-destinations.js',
    'nav-drawer-lightboxes.js',
    'nav-guide-fold.js',
    'nav-guide-search.js',
    'nav-latest-doc.js',
    'nav-panel-markup.js',
    'nav-panel.js',
    'newlink-app.js',
    'newlink-boot.js',
    'newlink-config.js',
    'newlink-data.js',
    'newlink-render.js',
    'newlink-tips.js',
    'newsletter-recency.js',
    'notice-archive.js',
    'notif-card-core.js',
    'notif-card.js',
    'notif.js',
    'operations-al-save.js',
    'operations-al-sheet.js',
    'operations-app.js',
    'operations-attention.js',
    'operations-boot.js',
    'operations-doc-links.js',
    'operations-doc-uploads.js',
    'operations-errors.js',
    'operations-reports.js',
    'operations-reset.js',
    'operations-speed.js',
    'operations-tips.js',
    'operations-usage.js',
    'other-day.js',
    'overflow-hint.js',
    'overlay-focus.js',
    'overlay-history.js',
    'overlay-panel-scroll.js',
    'overlay.js',
    'override-compare.js',
    'override-id.js',
    'override-utils.js',
    'overtime-answer.js',
    'overtime-app.js',
    'overtime-boot.js',
    'overtime-clock.js',
    'overtime-data.js',
    'overtime-form.js',
    'overtime-format.js',
    'overtime-manager.js',
    'overtime-phase.js',
    'overtime-review-controller.js',
    'overtime-roster.js',
    'overtime-sunday-release.js',
    'overtime-tips.js',
    'own-password.js',
    'page-session.js',
    'page-start.js',
    'password-force.js',
    'pay-audience.js',
    'paycalc-app.js',
    'paycalc-backpay-accrual.js',
    'paycalc-backpay-state.js',
    'paycalc-backpay.js',
    'paycalc-boot.js',
    'paycalc-breakdown.js',
    'paycalc-calc.js',
    'paycalc-clear-confirm.js',
    'paycalc-disclosures.js',
    'paycalc-fill-year.js',
    'paycalc-form-data.js',
    'paycalc-format.js',
    'paycalc-grade-setting.js',
    'paycalc-grade.js',
    'paycalc-help.js',
    'paycalc-hpp-schedule.js',
    'paycalc-hpp.js',
    'paycalc-inputs.js',
    'paycalc-inventory.js',
    'paycalc-lightboxes.js',
    'paycalc-migrations.js',
    'paycalc-money-banner.js',
    'paycalc-pension.js',
    'paycalc-period-merge.js',
    'paycalc-periods.js',
    'paycalc-result-headline.js',
    'paycalc-role-card.js',
    'paycalc-roster-hint.js',
    'paycalc-roster-suggestions.js',
    'paycalc-settings.js',
    'paycalc-sticky-total.js',
    'paycalc-transfer-card.js',
    'paycalc-transfer.js',
    'paycalc-year-card.js',
    'paycalc-year-summary.js',
    'paycalc-ytd-card.js',
    'pdf-viewer-core.js',
    'pdf-viewer.js',
    'perf-reporter.js',
    'perf-stats.js',
    'print-guard.js',
    'roster-alignment.js',
    'roster-cell-rules.js',
    'roster-cycle-data.js',
    'roster-data.js',
    'roster-entry-control.js',
    'roster-import-save.js',
    'roster-member-data.js',
    'roster-review-rows.js',
    'roster-review-states.js',
    'roster-roles.js',
    'select-sheet.js',
    'session.js',
    'settings-app.js',
    'settings-boot.js',
    'settings-install-card.js',
    'settings-password-card.js',
    'settings-status.js',
    'settings-tips.js',
    'silent-sign-in.js',
    'slow-save.js',
    'splash-watchdog.js',
    'staff-pin-ended.js',
    'status-text.js',
    'storage-keys.js',
    'storage-utils.js',
    'sw-register.js',
    'text-scale.js',
    'tips-lightbox.js',
    'trains-app.js',
    'trains-boot.js',
    'trains-cards.js',
    'trains-change.js',
    'trains-data.js',
    'trains-grid-mirror.js',
    'trains-headlines.js',
    'trains-render.js',
    'trains-stations.js',
    'trains-status.js',
    'trains-tips.js',
    'trains-verdict.js',
    'trains-weekdays.js',
    'two-tap.js',
    'unsaved-draft.js',
    'upload-commit.js',
    'usage-reporter.js',
    'usage-stats.js',
    'viewer-shed.js',
];
// END GENERATED app files
// The "managed" same-origin app files: HTML pages, JS modules, and CSS — all served from this
// version's cache, never re-fetched once cached (HTML falls back to network-first on a miss). Each
// must ALSO be in a precache list (CORE_ASSETS / SUPPLEMENTARY_ASSETS), or it is never precached.
// Matching is SCOPE-RELATIVE, so these names match under both '/' (Firebase) and '/roster-app/'
// (GitHub Pages). (Name kept for the sw-asset-check test that parses this array.)
const NETWORK_FIRST_FILES = [
    'paycalc-guide.html',
    'fip-guide.html', 'staff-guide.html',
    'railcard-guide.html', 'rangers-guide.html',
    'guide-chips.js', 'guide-print.js', 'guide-back.js', 'fip-guide.js', 'legacy-redirect.js', 'guide-shell.css',
    'staff-guide.css', 'paycalc-guide.css', 'railcard-guide.css', 'rangers-guide.css', 'fip-guide.css', 'guide-doc.css',
    'purify.es.mjs',
    ...APP_FILES,
];

// Critical app files — precached by the post-activation warm-up, never by install. Each is fetched
// individually in Promise.allSettled batches (`fetchInBatches`), so a 404 or a network blip skips
// that one file — logged, and retried on the next wake — rather than aborting the warm-up.
const CORE_ASSETS = [
    "./manifest.json",
    ...APP_FILES.map(f => `./${f}`),
];

// The guides with their scripts and styles, and the vendored DOMPurify — warmed after the core files.
const SUPPLEMENTARY_ASSETS = [
    "./paycalc-guide.html",
    "./fip-guide.html",
    "./staff-guide.html",
    "./railcard-guide.html",
    "./rangers-guide.html",
    // The two legacy guide URLs: ~3 KB redirect stubs, cached because the Pages mirror serves no
    // redirect rules, so the file IS the redirect there and an old bookmark should land offline.
    // Do NOT write a quoted string in a comment here: the ghost-entry check parses quoted paths.
    "./guide.html",
    "./fip.html",
    "./legacy-redirect.js",
    "./guide-chips.js",
    "./guide-print.js",
    "./guide-back.js",
    "./fip-guide.js",
    "./guide-shell.css",
    "./staff-guide.css",
    "./paycalc-guide.css",
    "./railcard-guide.css",
    "./rangers-guide.css",
    "./fip-guide.css",
    "./guide-doc.css",
    "./purify.es.mjs",
];

// Self-hosted typeface — stable asset, cache-first like icons, precached so the first offline
// launch renders in Inter. ⚠ If the font (or any icon) ever needs updating, RENAME the file as well
// as bumping the version: fonts/icons warm via the HTTP cache (max-age=1y immutable, no forced
// revalidation), so same-name byte changes would repopulate the new cache from a year-old copy.
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
// ⚠ THE UPDATE-LAG FIX — do not revert. A worker CANNOT leave 'installing' until install's waitUntil
// settles, skipWaiting() or not — so precaching there held every update behind the whole app's
// re-fetches ("the app updates with a lot of lag"). Install finishes at once; the cache warms after.
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

/** Start (or join) the cache warm-up. Runs DETACHED from the SW lifecycle events (never inside a
 *  waitUntil — install's would delay activation, activate's would queue every fetch of the
 *  freshly-reloaded page). Resilience: a completion MARKER is written only when every asset
 *  cached, the startup check re-runs an incomplete warm-up on every wake, and the fetch handler
 *  extends the SW's lifetime meanwhile — so a killed or partial warm-up retries until complete. */
function startWarmup() {
    if (_warmupInFlight) return _warmupInFlight;
    _warmupInFlight = warmCacheAndSweepOld()
        .catch(err => console.warn(`[SW ${APP_VERSION}] cache warm-up failed (will retry on next SW start):`, err))
        .finally(() => { _warmupInFlight = null; });
    return _warmupInFlight;
}

/** Run precache fetches a few at a time, not all in parallel — the warm-up fires right after the
 *  post-update reload, and an unbounded burst starved the page's own critical path of the one
 *  mobile connection. Failures are recorded by the precache fn itself. */
async function fetchInBatches(assets, precacheFn) {
    const BATCH = 8;
    for (let i = 0; i < assets.length; i += BATCH) {
        await Promise.allSettled(assets.slice(i, i + BATCH).map(precacheFn));
    }
}

/** Content-type sanity check before caching an asset. A trusted-cert intermediary (corporate MITM /
 *  managed-device proxy) can return a 200 body of ANY type for ANY URL — an HTML login interstitial,
 *  a JSON gateway error; caching that under a module path poisons the version cache for its whole
 *  life (SyntaxError → stuck splash). So the extension is POSITIVELY matched to its content-type
 *  family; a MISSING type is accepted (offline-first tolerance), and an UNKNOWN extension only
 *  rejects html, so a new asset kind is never silently dropped. Rejecting is SAFE: ctSafe gates
 *  CACHING only (the response is still served), so the worst case is a re-fetch next time. */
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

/** fetch, and hand the response to `store`, inside ONE hard timeout: one hung fetch (half-open TCP
 *  on flaky mobile) would stall its batch forever and pin the SW. The BODY is inside it too
 *  (fetch-timeout.js's rule), or a stalled body hangs `cache.put`. The abort rejects the put, and
 *  the per-asset .catch records a miss → normal retry-next-wake. */
async function fetchAndStore(/** @type {RequestInfo} */ req, /** @type {(res: Response) => any} */ store, ms = 30000) {
    if (typeof AbortController === 'undefined') return store(await fetch(req));
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), ms);
    try { return await store(await fetch(new Request(req, { signal: c.signal }))); } finally { clearTimeout(t); }
}

async function warmCacheAndSweepOld() {
    const cache = await openCache();
    if (await cache.match(PRECACHE_MARKER)) return;   // already fully warmed + swept
    let allOk = true;
    // revalidate=true → cache:'no-cache' (app code: a conditional 304 check). revalidate=false →
    // default HTTP-cache mode for the immutable fonts/icons (max-age=1y), which only ever change
    // alongside a version bump (and a rename — FONT_ASSETS).
    const precache = (asset, revalidate) => (async () => {
        // The post-update page load fills this same cache through the fetch handler at the same
        // moment — skip anything already present instead of fetching it twice.
        if (await cache.match(asset)) return;
        await fetchAndStore(new Request(asset, revalidate ? { cache: 'no-cache' } : {}), res => {
            if (res.ok && ctSafe(asset, res)) return cache.put(asset, unredirect(res));
            allOk = false;   // non-ok OR wrong content-type (interstitial) — don't cache, don't sweep, retry next wake
            console.warn(`[SW ${APP_VERSION}] Asset cache skipped (${asset}): ${res.ok ? 'unexpected content-type' : `HTTP ${res.status}`}`);
        });
    })().catch(err => { allOk = false; console.warn(`[SW ${APP_VERSION}] Asset cache skipped (${asset}):`, err); });
    await fetchInBatches(CORE_ASSETS, a => precache(a, true));
    await fetchInBatches(SUPPLEMENTARY_ASSETS, a => precache(a, true));
    await fetchInBatches([...FONT_ASSETS, ...ICON_ASSETS], a => precache(a, false));
    // Warm the SDK cache too. SDK failures are tracked SEPARATELY (sdkOk) so third-party CDN
    // reachability can never hold the APP-cache sweep hostage. Default cache mode: the URLs are
    // immutable, so an HTTP-cache copy is always valid.
    let sdkOk = true;
    const sdkCache = await caches.open(SDK_CACHE_NAME);
    const precacheSdk = sdkUrl => (async () => {
        if (await sdkCache.match(sdkUrl)) return;   // runtime route may have cached it already
        await fetchAndStore(sdkUrl, res => {
            if (res.ok && ctSafe(sdkUrl, res)) return sdkCache.put(sdkUrl, res);
            sdkOk = false;   // non-ok OR an HTML interstitial masquerading as the SDK module
            console.warn(`[SW ${APP_VERSION}] SDK cache skipped (${sdkUrl}): ${res.ok ? 'unexpected content-type' : `HTTP ${res.status}`}`);
        });
    })().catch(err => { sdkOk = false; console.warn(`[SW ${APP_VERSION}] SDK cache skipped (${sdkUrl}):`, err); });
    await fetchInBatches(SDK_ASSETS, precacheSdk);

    // Sweep superseded caches as soon as their REPLACEMENT is complete, per group: old app caches
    // once every app asset cached (they are the fallback for exactly the incomplete-app case); old
    // SDK caches once the new SDK cache is fully warmed — decoupled, so a device that can't reach
    // gstatic doesn't accumulate an app cache per deploy. Prefix-scoped. OLDER versions only: deleting
    // every OTHER version let an old worker's retried warm-up delete the NEWER cache, leaving nothing
    // to launch offline — sw-internals.test.mjs has the sequence.
    const cacheNames = await caches.keys();
    await Promise.all(
        cacheNames
            .filter(name => (allOk && name.startsWith('myb-roster-v') && isOlderVersion(name.slice(12), APP_VERSION))
                         || (sdkOk && name.startsWith('myb-roster-sdk-v') && isOlderVersion(name.slice(16), FIREBASE_SDK_VERSION)))
            .map(name => {
                console.log(`[SW ${APP_VERSION}] Deleting old cache:`, name);
                return caches.delete(name);
            })
    );
    if (!allOk || !sdkOk) {
        // Something missed (flaky network / unreachable CDN). Do NOT write the marker, so the next
        // SW start retries — and only re-fetches the gaps, since everything cached is skipped.
        console.warn(`[SW ${APP_VERSION}] Warm-up incomplete (app ${allOk ? 'ok' : 'MISSES'}, sdk ${sdkOk ? 'ok' : 'MISSES'}) — will retry`);
        return;
    }
    await cache.put(PRECACHE_MARKER, new Response('1'));
    console.log(`[SW ${APP_VERSION}] Pre-cached (complete)`);
}

/** Dotted numeric versions ('25.06', '12.19.0'): is `a` older than `b`? Unparseable → false (keep it). */
function isOlderVersion(a, b) { const x = a.split('.').map(Number), y = b.split('.').map(Number); if ([...x, ...y].some(Number.isNaN)) return false; for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d < 0; } return false; }

// STARTUP RE-CHECK — this top-level code runs every time the browser wakes the SW, so a warm-up
// killed mid-run resumes on the next wake. One cheap cache.match when already complete.
(async () => {
    try {
        const cache = await openCache();
        if (!(await cache.match(PRECACHE_MARKER))) startWarmup();
    } catch (_e) { /* best-effort */ }
})();

// ============================================
// ACTIVATE — claim all open tabs IMMEDIATELY; cache warm-up runs detached
// ============================================
// waitUntil holds ONLY the (instant) claim: fetch events are queued until activate's waitUntil
// settles, so the precache here would hang the freshly-reloaded page's every request. The warm-up
// runs detached instead — the post-claim reload's own fetch traffic keeps the SW alive.
self.addEventListener("activate", event => {
    console.log(`[SW ${APP_VERSION}] Activating — claiming clients`);
    event.waitUntil(Promise.all([
        self.clients.claim(),
        // Navigation Preload OFF — actively: the setting outlives the worker that set it. With HTML
        // never re-fetched, a preload was a wasted request on every open, and on a miss could be last
        // release's page from the HTTP cache. Feature-detected; non-fatal.
        self.registration.navigationPreload
            ? self.registration.navigationPreload.disable().catch(() => {})
            : null,
    ]));
    startWarmup();
});

// ============================================
// FETCH — HTML/JS/CSS from this version's cache (fetched on a miss only), cache-first for SDK + stable assets
// ============================================
self.addEventListener("fetch", event => {
    // Piggyback an in-flight warm-up onto this event's lifetime so the browser doesn't
    // kill the SW mid-precache while page traffic is flowing (a detached promise alone
    // has no lifetime guarantee). Guarded: waitUntil can throw if the event settled.
    if (_warmupInFlight) { try { event.waitUntil(_warmupInFlight); } catch (_e) { /* settled */ } }
    // Only handle same-origin GET requests — plus the pinned Firebase SDK modules.
    if (event.request.method !== "GET") return;
    const url = new URL(event.request.url);

    // Firebase SDK modules: cache-first from the SDK-versioned cache (immutable URLs); a miss is
    // cached for deterministic offline. During an SDK bump a still-open OLD page's old-version URLs
    // fail this prefix check and pass through untouched, fine for the seconds until the reload.
    if (url.href.startsWith(SDK_URL_PREFIX)) {
        event.respondWith(
            caches.open(SDK_CACHE_NAME).then(cache =>
                cache.match(event.request).then(cached => cached
                    || fetch(event.request).then(response => {
                        // ctSafe: never cache an HTML interstitial masquerading as an SDK module.
                        if (response && response.status === 200 && ctSafe(url.pathname, response)) {
                            const clone = response.clone();
                            cache.put(event.request, clone).catch(() => {});
                        }
                        return response;
                    })
                )
            // Terminal backstop: on a fully-broken Cache Storage the fallback lookup can ITSELF reject
            // (→ failed SDK import → app won't boot), and the fetch above may never have run. So catch
            // the lookup and end with a real network attempt, mirroring the doc branch.
            ).catch(() => caches.match(event.request).catch(() => null))
             .then(r => r || fetch(event.request).catch(() => Response.error()))
        );
        return;
    }
    // …and docs/ (the New link pack, read by pdf-viewer.js) is a document: to the network, never kept for a release (v25.67).
    if (url.origin !== self.location.origin || url.pathname.startsWith(`${SCOPE_PATH}docs/`)) return;

    const path = url.pathname;
    // HTML documents and JS/CSS are both served instantly from this version's cache and never
    // re-fetched once there; HTML falls back to network-first on a miss.
    const isDoc          = path === '/' || path.endsWith('/') || path.endsWith('.html');
    // Scope-relative so JS/CSS match under a sub-path (/roster-app/) too, not just root.
    const relPath        = path.startsWith(SCOPE_PATH) ? path.slice(SCOPE_PATH.length) : path.replace(/^\//, '');
    const isManagedAsset = NETWORK_FIRST_FILES.includes(relPath);

    if (isDoc) {
        // Cache-hit → served instantly, nothing fetched. Miss → network-first: revalidate (304 if
        // unchanged), store it, fall back to a cached copy if offline or the network hangs past 2 s
        // (fast enough for 4G, short enough on poor signal). AbortController cancels OUR fetch on
        // timeout (feature-detected: it throws in service workers on iOS < 15.1). 'no-cache' (vs
        // 'no-store') lets the browser revalidate with a 304 — same freshness, less bandwidth.
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
        const isDoc = event.request.destination === 'document';
        const PAGE_FALLBACKS = [
            ['paycalc',    './paycalc.html',    'Pay Calculator is not available offline. Please reconnect and reload.'],
            ['operations', './operations.html', 'Operations is not available offline. Please reconnect and reload.'],
            ['settings',   './settings.html',   'Settings is not available offline. Please reconnect and reload.'],
            ['links',      './links.html',       'Links is not available offline. Please reconnect and reload.'],
            ['overtime',   './overtime.html',   'Overtime is not available offline. Please reconnect and reload.'],
            ['trains',     './trains.html',     'Trains is not available offline. Please reconnect and reload.'],
            ['newlink',    './newlink.html',    'New link is not available offline. Please reconnect and reload.'],
            ['admin',      './admin.html',       'Admin is not available offline. Please reconnect and reload.'],
            // The guides fall back to THEMSELVES (Nov 2026, owner): through the default, a guide the warm-up
            // had not reached was answered with the Calendar at the race. A stub falls back to its guide.
            ['staff-guide',    './staff-guide.html',    'The Staff &amp; Admin Guide is not available offline. Please reconnect and reload.'],
            ['paycalc-guide',  './paycalc-guide.html',  'The Pay Calculator Guide is not available offline. Please reconnect and reload.'],
            ['railcard-guide', './railcard-guide.html', 'The Railcard Guide is not available offline. Please reconnect and reload.'],
            ['rangers-guide',  './rangers-guide.html',  'The Rangers &amp; Rovers Guide is not available offline. Please reconnect and reload.'],
            ['fip-guide',      './fip-guide.html',      'The FIP Travel Guide is not available offline. Please reconnect and reload.'],
            ['guide',          './staff-guide.html',    'The Staff &amp; Admin Guide is not available offline. Please reconnect and reload.'],
            ['fip',            './fip-guide.html',      'The FIP Travel Guide is not available offline. Please reconnect and reload.'],
        ];
        // Match the page by its exact path segment, not a substring — path.includes('admin') would mis-route
        // a future '/admin-report.html' to the wrong fallback (the class of the historical /admin-app.js MIME bug).
        const match      = isDoc && PAGE_FALLBACKS.find(([seg]) => path.endsWith(`/${seg}.html`));
        const fallback   = match ? match[1] : (isDoc ? './index.html' : null);
        const offlineMsg = match ? match[2] : 'The roster is not available offline. Please reconnect and reload.';
        // CURRENT-version cache first — the global caches.match() prefers the OLDEST cache, which
        // served the PREVIOUS version's HTML to a page whose JS then loaded fresh (mixed-version).
        // The newest-older lookup is the last resort, so pure-offline still works mid-transition; iOS
        // can evict ALL Cache Storage, so a minimal offline page is synthesised as the floor.
        // ignoreSearch: navigations are cached under the bare path, so paycalc.html?payday=… matches.
        // Every lookup is .catch-guarded: one rejection on broken storage must not skip the
        // synthesised offline page exactly when it is needed.
        /** The best cached copy for this navigation, or null when there is NONE. */
        const findCachedFallback = () => openCache().then(c => c.match(event.request, { ignoreSearch: true })).catch(() => null)
            .then(r => r || matchNewestManagedCache(event.request, { ignoreSearch: true }))
            .then(r => r || (fallback ? openCache().then(c => c.match(fallback)).then(fr => fr || matchNewestManagedCache(fallback)).catch(() => null) : null))
            .then(r => r || null);
        /** The synthesised last resort, with a "Try again" that RELOADS: an installed app has
         *  no address bar, and a reload keeps the fragment a notification tap carried (#huddle), which
         *  a link built from the request could not — the fragment never reaches a service worker. The
         *  inline handler is allowed because a synthesised response carries no CSP. */
        const offlinePage = () => {
            if (!isDoc) return Response.error();
            return new Response(
                `<!DOCTYPE html><html lang="en-GB"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Offline — Marylebone Roster</title></head><body style="font-family:sans-serif;padding:20px"><h1>Offline</h1><p>${offlineMsg}</p><p><button type="button" onclick="location.reload()" style="font:inherit;padding:8px 14px">Try again</button></p></body></html>`,
                { headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }, status: 200 }
            );
        };
        event.respondWith((async () => {
            // ── A HELD PAGE IS SERVED AT ONCE, AND NOTHING IS FETCHED (owner-approved; pwa.md): no
            // blocking round trip per page open. HTML never changes without a version bump → new SW →
            // new cache → warm-up → controllerchange reload, and a copy fetched beside a hit could only
            // be the same or the wrong release. EXACT-page match only — '/' (the scope root) also tries
            // the warm-up's './index.html' key; never map one page to another here (the index default
            // is OFFLINE-fallback behaviour). A broken Cache Storage must DEGRADE to the network path,
            // never reject: a rejected navigation renders the browser's own error page, and the splash
            // never even loads.
            const cache = await openCache().catch(() => null);
            const cachedDoc = cache
                ? (await cache.match(event.request, { ignoreSearch: true }).catch(() => null)
                    || (relPath === '' ? await cache.match('./index.html').catch(() => null) : null))
                : null;
            if (cachedDoc) return cachedDoc;
            // ── A MISS (first visit, evicted storage, a page the warm-up has not reached) ──
            let networkSettled = false;
            let viaPreload = false;   // a preload answer may be the browser's HTTP cache — see below
            const networkPromise = (event.preloadResponse
                // The preload promise RESOLVES undefined when preload is off (→ our own fetch) but
                // REJECTS when the preload request errors — so it needs a reject handler too, or an
                // ONLINE user would get the offline page. Two-arg .then (not trailing .catch) so a
                // genuine offline fetch rejection still propagates instead of re-fetching.
                ? event.preloadResponse.then(pre => (pre ? ((viaPreload = true), pre) : fetch(freshReq)), () => fetch(freshReq))
                : Promise.resolve().then(() => fetch(freshReq))
            ).then(response => {
                networkSettled = true;
                // Only cache a genuine HTML document: a 200 that is NOT html (a host interstitial, a
                // JSON error page) would be served for the life of the version cache. A MISSING
                // content-type still caches (offline-first tolerance); only a clearly-non-html one is skipped.
                const ct = response ? (response.headers.get('content-type') || '') : '';
                // NEVER A PRELOAD ANSWER (preload is off, but one may arrive): it may be last release's page
                // from the HTTP cache. Serve it; STORE a NEW Request (the race aborts freshReq). Stored under
                // the bare path (query stripped) — findCachedFallback matches ignoreSearch.
                if (response && response.status === 200 && (!ct || ct.includes('text/html'))) {
                    const store = viaPreload
                        ? fetch(new Request(event.request.url, { headers: event.request.headers, mode: 'same-origin', cache: 'no-cache' })).then(r => (r && r.status === 200 && /text\/html|^$/.test(r.headers.get('content-type') || '') ? r : null)).catch(() => null)
                        : Promise.resolve(response.clone());
                    event.waitUntil(store.then(r => r && openCache().then(c => c.put(url.origin + url.pathname, unredirect(r))))
                        .catch(err => console.warn(`[SW ${APP_VERSION}] cache.put failed (quota?):`, err)));
                }
                return response;
            }, err => { networkSettled = true; throw err; });
            // Keep the SW alive so a late network result on a MISS still reaches the cache for the
            // next open (a preload response cannot be aborted anyway, so consuming it is free).
            try { event.waitUntil(networkPromise.catch(() => null)); } catch (_e) { /* settled */ }

            // Network-first with the 2s cache-fallback race — PROVIDED THERE IS SOMETHING TO FALL BACK
            // TO (iOS audit B3). With nothing cached, the race would serve "Offline" to an ONLINE member
            // on a slow connection; so it waits for the network, and only the network's failure is offline.
            const fallbackDoc = await findCachedFallback();
            if (!fallbackDoc) {
                let response;
                try { response = await networkPromise; }
                catch (_err) { return offlinePage(); }
                return finishNetworkDoc(response);
            }

            // The abort is GUARDED on networkSettled: firing it after the response resolved would
            // kill the body mid-stream (a response arriving at ~1999ms destroyed by the 2000ms abort).
            const timeout = new Promise(resolve => setTimeout(() => {
                if (!networkSettled && controller) controller.abort();
                resolve('timeout');
            }, 2000));

            let response;
            try {
                const winner = await Promise.race([networkPromise, timeout]);
                if (winner === 'timeout') { console.log(`[SW ${APP_VERSION}] Offline/timeout — serving from cache:`, path); return fallbackDoc; }
                response = winner;
            } catch (_err) {
                console.log(`[SW ${APP_VERSION}] Offline/timeout — serving from cache:`, path);
                return fallbackDoc;
            }
            return finishNetworkDoc(response);
        })().catch(() => fetch(event.request).catch(() => Response.error())));
        // Ultimate backstop: if ANYTHING in the doc branch rejects, degrade to a plain network
        // fetch, then a network-error response — never a rejected navigation.

        /** What a network answer for a document becomes. Shared by the two cache-miss paths above. */
        function finishNetworkDoc(response) {
            if (response && response.status === 200) return unredirect(response);
            // A redirect under redirect-mode 'manual' surfaces as 'opaqueredirect' (status 0). Pass it
            // straight through so the BROWSER follows it: treated as a broken-site response, every
            // installed-PWA launch (start_url ./index.html → Firebase 301 → /) took the cache fallback.
            if (response && response.type === 'opaqueredirect') return response;
            // A 4xx/5xx for a navigation: the cached app if there is one (a notification tap still
            // opens the app when the site is down) — otherwise the SERVER'S answer, not an "Offline"
            // page about a device that is online (24-hour review of v24.61).
            if (event.request.destination === 'document' && response && !response.ok) {
                console.log(`[SW ${APP_VERSION}] Navigation got ${response.status} — falling back to cache:`, path);
                return findCachedFallback().then(r => r || response);
            }
            return response;
        }
    } else if (isManagedAsset) {
        // JS/CSS: respond from this version's cache when the file is there, and fetch nothing; on a
        // cold cache, wait for the network (the note below says why a held file is never refreshed).
        event.respondWith((async () => {
            const cache   = await openCache();
            const cached  = await cache.match(event.request);
            // A CACHED FILE IS SERVED AND LEFT ALONE — do not reintroduce a background refresh. One
            // that wrote its answer back used the page's cache mode, so on the Pages mirror
            // (`max-age=600`) it stored the PREVIOUS release's module in the NEW cache, and an OLD
            // worker wrote new files into the OLD cache: the version-pinned cache held two versions.
            // A miss is fetched past the HTTP cache (`no-cache`, a 304 when unchanged) and stored.
            // `new Request(url, …)`, not opts on the existing Request: older Safari ignores a cache
            // mode passed that way (.claude/rules/pwa.md → SW new Request(url) fetch pattern).
            let network = null;
            if (!cached) {
                network = fetch(new Request(event.request.url, {
                    cache:       'no-cache',
                    credentials: event.request.credentials,
                    mode:        event.request.mode === 'navigate' ? 'same-origin' : event.request.mode,
                }))
                    .then(response => {
                        // ctSafe: never cache a proxy interstitial under a JS/CSS path.
                        if (response && response.status === 200 && ctSafe(relPath, response)) {
                            cache.put(event.request, response.clone())
                                .catch(err => console.warn(`[SW ${APP_VERSION}] cache.put failed (quota?):`, err));
                        }
                        return response;
                    })
                    .catch(() => null);
            }
            if (cached) return cached;
            // Cold current-version cache: prefer a GOOD (2xx) network response; on a 4xx/5xx (a
            // transient 502 mid-deploy) fall back to the NEWEST older cached copy
            // (matchNewestManagedCache) — a bad response to a <script type=module> would stick the splash.
            const net = await network;
            return (net && net.ok ? net : null) || (await matchNewestManagedCache(event.request)) || Response.error();
        })().catch(() => caches.match(event.request).catch(() => null)
            .then(r => r || fetch(event.request).catch(() => Response.error()))));
        // A rejected respondWith for a <script type=module> breaks the module graph and sticks the
        // splash, so a broken Cache Storage must degrade: the backstop's own lookup is caught, and it
        // ends with a real network attempt (an online device with wedged storage still gets its modules).
    } else {
        // Cache-first: icons/manifest served from cache instantly, fetched if missing
        event.respondWith(
            caches.match(event.request)
                .then(cached => {
                    if (cached) return cached;
                    return fetch(event.request).then(response => {
                        // ctSafe: never cache a proxy interstitial under an icon/font/manifest path.
                        if (response && response.status === 200 && ctSafe(url.pathname, response)) {
                            const clone = response.clone();
                            // Best-effort: an unguarded put would reject (quota / broken storage) unhandled.
                            openCache().then(cache => cache.put(event.request, clone)).catch(() => {});
                        }
                        return response;
                    });
                })
                // As the other branches: on broken storage or an offline miss, degrade (the lookup
                // guarded, then a network attempt) — never a rejected respondWith.
                .catch(() => caches.match(event.request).catch(() => null)
                    .then(r => r || fetch(event.request).catch(() => Response.error())))
        );
    }
});

// ============================================
// MESSAGE — SKIP_WAITING
// ============================================
// SKIP_WAITING: sent by the app if it detects a waiting SW. skipWaiting() already fires on install,
// so this covers the rare case where auto-activation did not occur (multiple tabs, older Chrome).
self.addEventListener("message", event => {
    if (event.data && event.data.type === "SKIP_WAITING") {
        console.log(`[SW ${APP_VERSION}] SKIP_WAITING received — activating`);
        self.skipWaiting();
    }
    // No REVALIDATION_COUNT reply any more: an older page that still asks gets none and records nothing.
});

// ============================================
// PUSH — incoming notifications (every notifying feature)
// ============================================
// Payload shape (sent by Cloud Functions via buildPushPayload):
//   { title, body, url, tag }
// tag is the feature's stable tag — one per feature, from the table in
// .claude/rules/notifications.md (the documents, the pay reminder, the account and
// admin notices…; the list is kept there, not here) — or the SW-local fallback
// 'update' for a data-less/unparseable push. Using the same tag for repeat
// notifications of the same type means the new one replaces the old one in the
// Notification Centre rather than stacking.
self.addEventListener("push", event => {
    // Neutral defensive fallback for a data-less / unparseable push — we can't know the feature, so
    // do NOT assume a Huddle (it would collide with real Huddle notifications). Well-formed payloads
    // come from buildPushPayload (functions/push-notices.js) and Object.assign over these defaults.
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
// Huddle → the app root with #huddle (the in-app Huddle viewer opens on the hash).
// Pay reminder → paycalc.html. Every page a payload may name: SAFE_NOTIFICATION_PAGES, below.
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
// or path (a bare-root route fell back to the bare origin on the Pages install: a 404).
// Listing a page is not an access grant: it only decides which in-scope page a payload may open,
// and each page runs its own gate (operations.html, the admin's reset-request queue, is only ever
// SENT to the admin's own devices). It matches notifications.md → "Deep link" entry for entry
// (sw-asset-check.test.mjs).
const SAFE_NOTIFICATION_PAGES = ['', 'paycalc.html', 'operations.html', 'overtime.html', 'settings.html', 'trains.html', 'newlink.html'];

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
                    // Ask before navigating: a busy page is left alone and asked (sw-register.js).
                    return askIfBusy(focusedClient).then(busy => {
                        if (busy) { focusedClient.postMessage({ type: 'myb-open-later', url: targetUrl }); return undefined; }
                        return navigateOrOpen(focusedClient);
                    });
                }).catch(() => clients.openWindow(targetUrl));
            }
            return clients.openWindow(targetUrl);
        })
    );

    /** @param {any} focusedClient */
    function navigateOrOpen(focusedClient) {
        // ALWAYS navigate, never compare focusedClient.url first: Client.url is the CREATION url and
        // misses the huddle viewer's hash-strip, so a repeat #huddle tap compared equal and did nothing.
        // A hash-only navigate is same-document, and the viewer strips its hash, so hashchange re-fires.
        if ('navigate' in focusedClient) {
            return focusedClient.navigate(targetUrl)
                .catch(() => clients.openWindow(targetUrl));
        }
        return clients.openWindow(targetUrl);   // navigate() unsupported: a fresh window, not a dead tap (v16.23)
    }
});

/** Is a window holding unsaved work or a save in flight? Unanswered in 500 ms → false. @param {any} client */
function askIfBusy(client) {
    return new Promise(resolve => {
        try {
            const channel = new MessageChannel();
            const done = (/** @type {boolean} */ v) => { channel.port1.close(); resolve(v); };
            channel.port1.onmessage = (e) => done(!!(e.data && e.data.busy));
            client.postMessage({ type: 'myb-busy?' }, [channel.port2]);
            setTimeout(() => done(false), 500);   // a settled promise ignores the later call
        } catch (_) { resolve(false); }
    });
}

// THE SUBSCRIPTION ROTATED UNDER US (iOS audit B4): re-subscribe with the key the OLD one
// carried — this file holds no copy of the VAPID key — or take the ready-made `newSubscription`.
// notif.js re-saves the server record at once when the live endpoint differs from the one it last
// saved. Full account: .claude/rules/notifications.md → "When the push service rotates a subscription".
self.addEventListener("pushsubscriptionchange", event => {
    const oldSub = event.oldSubscription;
    const key = oldSub && oldSub.options && oldSub.options.applicationServerKey;
    const renewed = event.newSubscription
        ? Promise.resolve(event.newSubscription)
        : (key ? self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
               : Promise.resolve(null));
    event.waitUntil(renewed.catch(err => console.warn(`[SW ${APP_VERSION}] push re-subscribe failed:`, err && err.message)));
});
