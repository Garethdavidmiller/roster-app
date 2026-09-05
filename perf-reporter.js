// @ts-check
/**
 * perf-reporter.js — records anonymous page-load latency to Firestore (Project 0 instrumentation).
 * The performance analogue of usage-reporter.js: a thin layer that reads the browser's Navigation
 * Timing, buckets the durations, and lets firebase-client.js do the I/O. Fire-and-forget — it must
 * never throw and never block rendering.
 *
 * v1 metrics (both from the PerformanceNavigationTiming entry, so they cost nothing and are NOT
 * confounded by the in-place-login flow — they measure DOCUMENT/shell load, not "time to signed-in"):
 *   ttfb     — responseStart             (server + network to first byte received)
 *   domReady — domContentLoadedEventEnd  (document parsed + deferred modules' first tick)
 * Login-to-usable timing (myb:login-* marks) is a separate, later metric — it belongs with the
 * in-place-login validation, since with INPLACE_LOGIN off that span crosses a reload.
 *
 * Privacy: NO member identity is ever recorded — only coarse dimensions (version, page, metric,
 * duration BUCKET, PWA display mode, connection class). Call once per page from the coordinator at
 * the same point recordUsage() runs (after the Firebase Auth session is being established) so the
 * write satisfies the `request.auth != null` analytics rule.
 */

import { recordPerfSample } from './firebase-client.js';
import { bucketDuration, loginDurationBucket, bootPhases, bucketSwrCount, SWR_HEAVY_BUCKET } from './perf-stats.js';
import { CONFIG } from './roster-data.js';
import { SW_UPDATE_RELOAD as SW_RELOAD_KEY } from './storage-keys.js';

// Sign-in timing marker: a wall-clock timestamp stored at the "Sign in" click (login-overlay.js),
// read once on the destination page (recordPageLatency below) to record login-to-usable time. Stored
// in sessionStorage so it survives the post-login reload (same tab); cleared on read, on a failed
// sign-in, and recency-guarded so an abandoned attempt can't log a bogus time. (iOS private mode
// throws on sessionStorage — all access is wrapped.)
const LOGIN_T0_KEY = 'myb_perf_login_t0';

/** Mark the start of a sign-in attempt (call when the user commits — i.e. the network sign-in begins). */
export function markLoginStart() {
    try { sessionStorage.setItem(LOGIN_T0_KEY, String(Date.now())); } catch { /* sessionStorage unavailable */ }
}

/** Clear the sign-in marker — call on a FAILED sign-in so a later page load can't record a stale time. */
export function clearLoginStart() {
    try { sessionStorage.removeItem(LOGIN_T0_KEY); } catch { /* sessionStorage unavailable */ }
}

// The marker `sw-register.js` writes immediately before an update-triggered reload, read once on the
// load that follows it (recordPageLatency below) to record `readyUpdate`. Its module header has why
// it is a timestamp; this side owns the bound, because the bound protects the METRIC.
//
// A minute is generous against every legitimate delay — the Calendar's beforeReload waits 500ms, the
// default path reloads at once — and short against the one that must not be honoured: a member who
// declined links' confirm and navigated somewhere else later. Erring long would attribute an
// ordinary open to a release; erring short only DROPS an update open. Those costs are not equal, so
// the bound is set where the wrong answer is a miss rather than a false positive.
// The KEY is `storage-keys.js`'s (one spelling, two modules); the BOUND is this side's, because
// the bound protects the metric.
const SW_RELOAD_MAX_MS = 60 * 1000;

/** The mark `markPageReady` writes and `recordPageLatency` reads. */
export const PAGE_READY_MARK = 'myb-page-ready';

/**
 * Resolves with the `ready` timestamp the moment `markPageReady` runs — the fix for a metric that
 * was silently sampling a fifth of its own population (v21.16).
 *
 * ── WHY A PROMISE AND NOT JUST THE MARK ─────────────────────────────────────────────────────────
 *
 * `recordPageLatency` reads the mark table at the instant it is called, and records `ready` only if
 * the mark is already there. On the Calendar those two things sit on COMPLETELY SEPARATE promise
 * chains: `markPageReady()` fires after the first grid render (downstream of the access decision and
 * the initial fetch), while `recordPageLatency` fires off `calendarAuthReady`. Nothing orders them.
 *
 * So whether a load contributed a `usable` sample was decided by which of two unrelated async chains
 * happened to finish first. Measured against a real month: three pages mark themselves ready and
 * took 1,044 opens between them; 218 `ready` samples were recorded. Four out of five loads were
 * dropped — and because the dropped ones are those where the render lost the race, the survivors are
 * not a random sample of anything. The figure could not be read in either direction.
 *
 * Overtime already got this right by hand, sequencing its `recordPageLatency` into a `.finally()`
 * after the load; that works for a page with one linear load chain and does not generalise.
 *
 * ── IT DEFERS THE ONE SAMPLE, NOT THE WHOLE CALL ────────────────────────────────────────────────
 *
 * The obvious fix — make `recordPageLatency` await the mark — is worse: on a page that never becomes
 * ready (a locked Calendar, a hard failure) it would hold back `ttfb`/`fcp`/`domReady` too, and lose
 * them entirely if the member navigated away. Those are recorded exactly as before; only `ready`
 * waits, and only when it is not already available.
 *
 * Deliberately unbounded. A page that never becomes ready never resolves this, which is the honest
 * outcome — no sample, rather than a fabricated one at some arbitrary cut-off — and an unsettled
 * promise costs nothing on a page that is about to be unloaded.
 */
/** @type {(t: number) => void} */
let _resolveReady = () => {};
/** @type {Promise<number>} */
const _pageReady = new Promise((resolve) => { _resolveReady = resolve; });

// ── THE REST OF THE START LADDER (v21.29, external latency review) ──────────────────────────────
//
// `ready` had this machinery to itself. The other three milestones need exactly the same thing —
// a mark, and a promise so `recordPageLatency` can record one that has not happened yet — so it is
// generalised rather than copied three times. Each keeps its own deferred promise for the reason
// spelled out above `_pageReady`: reading the mark table at one arbitrary instant sampled a fifth
// of its own population, and not at random.
//
// The DEFERRED half is what makes these usable at all. `access` fires early and would usually be
// present, but `rosterLive` waits on Firestore — the very case worth measuring is the one where it
// lands after `recordPageLatency` has run.
// ── HOW MUCH BACKGROUND WORK THE SERVICE WORKER DID DURING THIS BOOT (v22.94) ───────────────────
//
// The external calendar-latency review's second suggested measurement. Its service-worker
// hypothesis — that a warm cache still issues a full sweep of conditional requests while the member
// waits on `accounts:lookup` — has a MECHANISM confirmed in code and a VOLUME measured locally (53
// requests on the first open after the worker wakes, against 2 when it is already awake), and no
// field evidence at all. This is the field evidence.
//
// Asked, not counted here: the worker already keeps the set that makes the refresh once-only, so
// this reads its size over a MessageChannel. A COUNT and never a URL — which files a device fetched
// is browsing information, and the number answers the question by itself.
//
// **Every failure answers `null`, never 0.** No controller, no reply, a worker too old to know the
// message, or a browser with no service worker at all — none of those is "this boot did no
// revalidation", and recording them as zero would manufacture the reassuring half of the very
// finding this is here to test. The timeout exists because a MessageChannel reply that never comes
// would otherwise hold the promise for the life of the page.
const SWR_COUNT_TIMEOUT_MS = 1500;

/** Ask the controlling service worker how many revalidations it has started since it woke.
 *  @returns {Promise<number|null>} the count, or null when it cannot be known. */
function askSwrCount() {
    return new Promise((resolve) => {
        let done = false;
        const finish = (/** @type {number|null} */ v) => { if (!done) { done = true; resolve(v); } };
        try {
            const ctrl = navigator.serviceWorker && navigator.serviceWorker.controller;
            if (!ctrl) { finish(null); return; }
            const ch = new MessageChannel();
            ch.port1.onmessage = (e) => finish(typeof e.data?.count === 'number' ? e.data.count : null);
            ctrl.postMessage({ type: 'REVALIDATION_COUNT' }, [ch.port2]);
            setTimeout(() => finish(null), SWR_COUNT_TIMEOUT_MS);
        } catch { finish(null); }   // no MessageChannel, a detached controller, a throwing postMessage
    });
}

/** @type {Record<string, string>} milestone id → performance.mark name */
const MILESTONE_MARKS = { authBoot: 'myb-auth-boot', access: 'myb-access', rosterCached: 'myb-roster-cached', rosterLive: 'myb-roster-live' };
/** @type {Record<string, (t: number) => void>} */
const _resolveMilestone = {};
/** @type {Record<string, Promise<number>>} */
const _milestone = {};
for (const id of Object.keys(MILESTONE_MARKS)) {
    _milestone[id] = new Promise((resolve) => { _resolveMilestone[id] = resolve; });
}

/**
 * Mark one of the start-ladder milestones. Idempotent, silent on any platform without the
 * Performance API, and — like `markPageReady` — it must never be able to break the page it times.
 * @param {'authBoot'|'access'|'rosterCached'|'rosterLive'} id
 * @returns {void}
 */
export function markMilestone(id) {
    const name = MILESTONE_MARKS[id];
    if (!name) return;
    try {
        if (performance.getEntriesByName?.(name)?.length) return;
        performance.mark(name);
        const t = performance.getEntriesByName?.(name)?.[0]?.startTime;
        if (typeof t === 'number') _resolveMilestone[id]?.(t);
    } catch { /* Performance API unavailable — the metric is simply absent */ }
}

/**
 * Mark the instant this page's MAIN CONTENT is actually on screen.
 *
 * ── WHY THIS EXISTS (v20.80) ────────────────────────────────────────────────────────────────────
 *
 * Until now the card's two page milestones were `fcp` ("first appears") and `domReady` ("fully
 * ready"), and the v20.12 access gate quietly made both of them stop describing the thing an admin
 * reads them as.
 *
 *   · `fcp` is the first pixel painted, which on the Calendar is the SPLASH — inline markup in
 *     index.html. It has never measured the roster and cannot.
 *   · `domReady` is DOMContentLoaded, i.e. the module scripts finishing. `initCalendarAccess` is
 *     async, so DCL now fires while the Calendar is still blank. MEASURED with the auth restore
 *     held at 2s: fcp 512ms, domReady 669ms, roster on screen **2630ms**. The card would have
 *     called that load "fully ready in 669ms".
 *
 * So this is the milestone the other two cannot be. A page calls it once, at the moment its own
 * content is genuinely usable — the Calendar's first grid render, and the three pages whose
 * `.container` is hidden until `body.auth-ready`. Everything before it is a page the member is
 * looking at and cannot use.
 *
 * Idempotent (the first call wins — `performance.mark` would otherwise record a second entry and
 * `getEntriesByName()[0]` would still read the first, but a re-render must not even try). Silent on
 * any platform without the Performance API: the metric is simply absent, which the card handles.
 *
 * ── WHAT SERVED THE FIRST GRID (v21.99) ─────────────────────────────────────────────────────────
 *
 * `source` says whether the grid the member is now looking at came from the LOCAL CACHE or from the
 * authoritative server read. It exists to make one decision decidable and no other: `LATENCY_PLAN.md`
 * Phase 2 proposes narrowing that server read, and its entire value rests on how many loads reach a
 * grid THROUGH it. A cache-served load never touches the network on this path, so narrowing the read
 * cannot move it by a millisecond — while a cache MISS waits for the whole three-month, whole-team
 * query, which the card says has never once finished inside a second.
 *
 * Nothing about `ready` changes: it is still written for every load and its history stays
 * continuous. The split is recorded as two ADDITIONAL metrics, because the sample key is a fixed
 * six-part format that `parsePerfSampleKey` splits positionally — a seventh field would invalidate
 * every sample already stored, and the analytics document's rules constrain its shape but not the
 * names inside `samples`, so a new metric needs no rules deploy and carries no ordering hazard.
 *
 * A page that does not know its source simply omits it and reports `ready` alone, which is the same
 * honesty rule the milestones follow: a thing that was not established is not given a value.
 *
 * @param {'cached'|'fetched'} [source] what put this grid on screen, where the caller knows
 * @returns {void}
 */
export function markPageReady(source) {
    try {
        if (performance.getEntriesByName?.(PAGE_READY_MARK)?.length) return;
        // Captured on the FIRST call only, alongside the mark it describes. A later re-render can
        // reach a better-known state — cached becomes authoritative the moment phase 2 lands — and
        // attributing the FIRST grid's timing to the SECOND grid's source would report the whole
        // population as fetch-served and answer the question backwards.
        if (source === 'cached' || source === 'fetched') _readySource = source;
        performance.mark(PAGE_READY_MARK);
        // Announce it as well as record it. `performance.mark()` returns the entry in modern
        // browsers and nothing in older ones, so the timestamp is read back the same way
        // `recordPageLatency` reads it rather than trusted from the return value.
        const t = performance.getEntriesByName?.(PAGE_READY_MARK)?.[0]?.startTime;
        if (typeof t === 'number') _resolveReady(t);
    } catch { /* Performance API unavailable — the metric is skipped, nothing else changes */ }
}

/** What served the first grid, when the page knew. @type {'cached'|'fetched'|null} */
let _readySource = null;

/** Read non-identifying environment dimensions (PWA display mode + connection class). */
function envContext() {
    let mode = 'browser';
    try {
        if (window.matchMedia?.('(display-mode: standalone)')?.matches ||
            /** @type {any} */ (window.navigator).standalone) mode = 'standalone';
    } catch { /* matchMedia/standalone unavailable — leave 'browser' */ }
    let conn = 'unknown';
    try { conn = /** @type {any} */ (navigator).connection?.effectiveType || 'unknown'; } catch { /* no Network Information API */ }
    return { mode, conn };
}

/**
 * Record this page's navigation-timing latency (bucketed), anonymously. Best-effort and silent: any
 * missing API or error simply records nothing.
 * @param {string} page - stable page id: 'calendar' | 'admin' | 'paycalc' | 'operations' | 'settings' | 'links'
 * @param {string|null} [identity] - the active member's name; if it is an admin (the developer), this
 *        session is the developer testing the app, so NOTHING is recorded — the figures must reflect
 *        real staff, not test loads. Pass the signed-in member, or the calendar's selected member.
 * @returns {void}
 */
export function recordPageLatency(page, identity = null) {
    try {
        // Exclude the developer/admin's own sessions (CONFIG.ADMIN_NAMES) so speed figures reflect real
        // staff — but still CONSUME the one-shot login marker below, so an excluded sign-in can't leave a
        // stale marker that mis-times a later load.
        const excluded = !!(identity && CONFIG.ADMIN_NAMES.includes(identity));
        const { mode, conn } = envContext();

        // Login-to-usable: if a sign-in started this session, record how long until the page became
        // usable. Attributed to the synthetic page id 'login' (login speed is ONE number, not split by
        // destination). One-shot: the marker is ALWAYS cleared (even when excluded); only RECORDED when not.
        try {
            const t0 = Number(sessionStorage.getItem(LOGIN_T0_KEY));
            if (t0) {
                sessionStorage.removeItem(LOGIN_T0_KEY);
                if (!excluded) {
                    const bucket = loginDurationBucket(t0, Date.now());
                    if (bucket) recordPerfSample({ page: 'login', metric: 'loginTotal', bucket, mode, conn });
                }
            }
        } catch { /* sessionStorage unavailable — skip login timing */ }

        // Did this load follow a release? One-shot by the SAME rule as the login marker above, and
        // for the same reason: ALWAYS cleared, RECORDED only when not excluded — a developer's own
        // reload must not leave a marker that then attributes a member's next open to an update.
        // Read here, used inside `recordReady` below, which may run much later.
        let afterUpdate = false;
        try {
            const t = Number(sessionStorage.getItem(SW_RELOAD_KEY));
            if (t) {
                sessionStorage.removeItem(SW_RELOAD_KEY);
                afterUpdate = Date.now() - t >= 0 && Date.now() - t < SW_RELOAD_MAX_MS;
            }
        } catch { /* sessionStorage unavailable — this load simply reports no update attribution */ }

        if (excluded) return;   // developer's own session: markers consumed above, nothing else recorded

        // First Contentful Paint (metric 'fcp') — when the user first SEES content, i.e. the page
        // "appears". From the Paint Timing API, a SEPARATE timeline to Navigation Timing's domReady
        // ("fully ready") — so record it BEFORE the nav-timing guard below, never gated on it.
        recordFcp(page, mode, conn);

        // ── `ready`, WHENEVER IT ARRIVES ────────────────────────────────────────────────────────
        //
        // Handled here, ABOVE the Navigation Timing guard, because it depends on neither: it comes
        // from a `performance.mark` and nothing else. Sitting below that guard would have tied it to
        // an unrelated capability.
        //
        // BOTH cases live here — already marked, and not yet — so the two cannot diverge. Splitting
        // them across the guard was the first attempt and it reintroduced the same class of bias one
        // level down: a browser with marks but no Navigation Timing would have kept `ready` on the
        // loads that were still waiting and dropped it on the ones already finished, i.e. exactly
        // the fast ones. Caught by a test that stubs marks without navigation entries.
        const recordReady = (/** @type {number} */ startTime) => {
            const bucket = bucketDuration(startTime);
            // Deferring the WRITE is safe: this function is already gated on the page's auth being
            // established, so the session that carries it exists by now and outlives the wait.
            if (!bucket) return;
            recordPerfSample({ page, metric: 'ready', bucket, mode, conn });
            // The same reading, attributed. Written as a SECOND sample rather than replacing the
            // first, so `ready` keeps counting every load and the two are comparable against it.
            if (_readySource) {
                recordPerfSample({ page, metric: _readySource === 'cached' ? 'readyCached' : 'readyFetched',
                    bucket, mode, conn });
            }
            // The same reading again, for the loads a release caused. A SUBSET of `ready` — not a
            // split of it, which is the opposite of the two rows above and the thing the card has to
            // say. Because it is written here, from the same bucket, on the same path, the two
            // counts divide: `readyUpdate` over `ready` IS the share of opens that followed a
            // release, which is the question v22.90 left unanswerable.
            if (afterUpdate) recordPerfSample({ page, metric: 'readyUpdate', bucket, mode, conn });
            // …and how much background work the worker did getting here. Two samples, because the
            // review asks two questions: how many revalidations a real boot carries (`swrCount`,
            // in COUNT bands), and whether a boot carrying a full sweep reaches the roster more
            // slowly than one that does not. The second is the same SUBSET trick as `readyUpdate`
            // — `readyHeavySwr` is written beside `ready`, from the same bucket, only on the heavy
            // band — so its distribution is directly comparable with `ready` overall and the key
            // stays at six components.
            askSwrCount().then((n) => {
                const band = bucketSwrCount(/** @type {any} */ (n));
                if (!band) return;   // unknowable — see askSwrCount; never recorded as zero
                recordPerfSample({ page, metric: 'swrCount', bucket: band, mode, conn });
                if (band === SWR_HEAVY_BUCKET) {
                    recordPerfSample({ page, metric: 'readyHeavySwr', bucket, mode, conn });
                }
            }).catch(() => { /* never rejects; here so a future change cannot make it unhandled */ });
        };
        let readyNow;
        try { readyNow = performance.getEntriesByName?.(PAGE_READY_MARK)?.[0]?.startTime; }
        catch { /* no marks — fall through and wait, which on such a platform simply never fires */ }
        if (typeof readyNow === 'number') recordReady(readyNow);
        // See `_pageReady` for what reading the mark table at one arbitrary instant was costing:
        // four loads in five, silently, and not at random.
        else _pageReady.then(recordReady)
            .catch(() => { /* never rejects; here so a future change cannot make it unhandled */ });

        // The other three rungs, by exactly the same rule — already marked, or recorded when they
        // arrive. A page that never reaches one simply never reports it, which is the honest
        // answer: a milestone that did not happen must not be given a time.
        for (const id of Object.keys(MILESTONE_MARKS)) {
            const write = (/** @type {number} */ startTime) => {
                const b = bucketDuration(startTime);
                if (b) recordPerfSample({ page, metric: id, bucket: b, mode, conn });
            };
            let now;
            try { now = performance.getEntriesByName?.(MILESTONE_MARKS[id])?.[0]?.startTime; }
            catch { /* no marks on this platform — the await below simply never fires */ }
            if (typeof now === 'number') write(now);
            else _milestone[id]?.then(write).catch(() => { /* never rejects */ });
        }

        // Navigation-timing metrics for THIS page (every load).
        const nav = /** @type {any} */ (performance.getEntriesByType?.('navigation')?.[0]);
        if (!nav) return;   // Navigation Timing L2 unsupported (old Safari) — skip silently
        /** @type {Record<string, number>} */
        // responseStart IS time-to-first-byte; responseEnd is the LAST byte (it silently included
        // the full HTML download on slow connections, inflating the App Speed bands) (v16.23).
        const metrics = { ttfb: nav.responseStart, domReady: nav.domContentLoadedEventEnd };
        // Boot phases (v20.33) — where a slow start actually goes: waking the SW cache, reaching the
        // 'myb-sdk-ready' mark (firebase-client.js), then the app's own modules to DCL. The pure
        // split lives in perf-stats.bootPhases; an uncomputable phase is NaN and bucketDuration
        // skips it (no SW on a first visit; no mark where the Performance API is missing).
        let sdkMark;
        try { sdkMark = performance.getEntriesByName?.('myb-sdk-ready')?.[0]?.startTime; } catch { /* no marks */ }
        Object.assign(metrics, bootPhases(nav, sdkMark));
        // 'ready' is NOT in this map — it is handled above, before the Navigation Timing guard,
        // because it comes from a mark and depends on neither nav timing nor the order this
        // function happens to run in. ABSENT on a page that does not mark, and absent is the honest
        // answer there: a fabricated fallback to domReady would put the exact number this metric
        // exists to contradict under the label that says it is something else.
        for (const metric of Object.keys(metrics)) {
            const bucket = bucketDuration(metrics[metric]);
            if (bucket) recordPerfSample({ page, metric, bucket, mode, conn });
        }
    } catch { /* best-effort — latency telemetry must never affect the app */ }
}

/**
 * Record First Contentful Paint for `page` (bucketed), best-effort. Reads the existing paint entry if
 * present; otherwise observes once for a late paint. Never throws.
 * @param {string} page @param {string} mode @param {string} conn
 */
function recordFcp(page, mode, conn) {
    try {
        const report = (/** @type {number} */ startTime) => {
            const bucket = bucketDuration(startTime);
            if (bucket) recordPerfSample({ page, metric: 'fcp', bucket, mode, conn });
        };
        const existing = (performance.getEntriesByType?.('paint') || [])
            .find(e => e.name === 'first-contentful-paint');
        if (existing) { report(existing.startTime); return; }
        if (typeof PerformanceObserver !== 'function') return;   // unsupported — skip silently
        const obs = new PerformanceObserver((list) => {
            const e = list.getEntries().find(x => x.name === 'first-contentful-paint');
            if (e) { obs.disconnect(); report(e.startTime); }
        });
        obs.observe({ type: 'paint', buffered: true });
    } catch { /* best-effort — FCP telemetry must never affect the app */ }
}
