// @ts-check
/**
 * perf-reporter.js — records anonymous page-load latency to Firestore (Project 0 instrumentation).
 * The performance analogue of usage-reporter.js: a thin layer that reads the browser's timing
 * entries, buckets the durations, and lets firebase-client.js do the I/O. Fire-and-forget — it must
 * never throw and never block rendering.
 *
 * What it records, per page load (the App Speed card reads every one of these, and nothing else):
 *   fcp            — first-contentful-paint: something first appears (on the Calendar, the splash)
 *   domReady       — domContentLoadedEventEnd: the app's code has loaded
 *   ready          — `markPageReady`: the page's own content is on screen and usable
 *   readyUpdate    — the same moment on a load a RELEASE caused, timed as the wait a person had
 *   rosterSnapshot — the Calendar painting a member's own stored roster before the sign-in check
 *   loginTotal     — from pressing "Sign in" until the page was usable (page id 'login')
 *
 * ── A SAMPLE IS TIME SOMEBODY SPENT WAITING, AND NOTHING ELSE (whole App Speed review, Oct 2026) ─
 *
 * Two kinds of time reached the figures that are not the app being slow, and the review measured
 * both in the code:
 *
 *   · TIME NOBODY WAS WATCHING. The Calendar's release reload runs while the page is hidden — that
 *     is its whole design (sw-register.js, `deferWhileVisible`) — and about one Calendar open in
 *     seven in September was that reload. A hidden page is slowed or frozen by the phone, so its
 *     timings partly measured how long the member was away. So a reading counts only if the page
 *     had been watched from the start of the load up to it (`_watched`), and a load that STARTED
 *     hidden records none of the ordinary metrics. A Chrome prerender starts hidden, so it is left
 *     out by the same rule.
 *   · TIME A PERSON SPENT TYPING. The staff PIN unlocks the Calendar without a reload, and every
 *     page signs in on the page itself, so `ready` used to include reading the card and typing the
 *     PIN or password. A sign-in has its own figure (`loginTotal`), so `ready` is now dropped once
 *     the page has started waiting for a person (`markAwaitingInput`, called when the sign-in form
 *     or a Calendar lock card appears). `fcp` and `domReady` cannot include typing, so they are kept.
 *
 * A release reload that ran while hidden is not thrown away: `readyUpdate` times what the member
 * actually waited for — from coming back to the page until it was usable, or a token instant if it
 * was ready before they came back.
 *
 * Privacy: NO member identity is ever recorded — only coarse dimensions (version, page, metric,
 * duration BUCKET, PWA display mode, connection class). Call once per page from the coordinator at
 * the same point recordUsage() runs (after the Firebase Auth session is being established) so the
 * write satisfies the analytics rule (`isKnownIdentity` — a member, the admin or the PIN viewer, v24.56).
 *
 * Retired at the same review, writes and all, because the card stopped reading them: the boot
 * phases, the start ladder's other rungs, the saved-copy/server split, `ttfb`, and the service
 * worker's fetch count. LATENCY.md holds what they found.
 */

import { recordPerfSample } from './firebase-client.js';
import { bucketDuration, loginDurationBucket } from './perf-stats.js';
import { CONFIG } from './roster-data.js';
import { SW_UPDATE_RELOAD as SW_RELOAD_KEY } from './storage-keys.js';

// Sign-in timing marker: a wall-clock timestamp stored at the "Sign in" click (login-overlay.js),
// read once on the destination page (recordPageLatency below) to record login-to-usable time. Stored
// in sessionStorage so it survives a post-login reload (same tab); cleared on read, on a failed
// sign-in, and recency-guarded so an abandoned attempt can't log a bogus time. (iOS private mode
// throws on sessionStorage — all access is wrapped.)
const LOGIN_T0_KEY = 'myb_perf_login_t0';

/** Mark the start of a sign-in attempt (call when the user commits — i.e. the network sign-in begins). */
export function markLoginStart() {
    try { sessionStorage.setItem(LOGIN_T0_KEY, String(Date.now())); } catch { /* sessionStorage unavailable */ }
}

/** Clear the sign-in marker — call on a FAILED sign-in, or a sign-in that leads to no page, so a
 *  later page load can't record a stale time. */
export function clearLoginStart() {
    try { sessionStorage.removeItem(LOGIN_T0_KEY); } catch { /* sessionStorage unavailable */ }
}

// The marker `sw-register.js` writes immediately before an update-triggered reload, read once on the
// load that follows it. It is compared with WHEN THIS LOAD STARTED, not with when the reading is
// taken (whole App Speed review, Oct 2026): a hidden reload can stay frozen for minutes before its
// reading runs, and the old "within a minute of now" check then dropped the label from exactly the
// loads it was for. The marker is written in the same task that calls `reload()`, so the load starts
// within moments of it; ten seconds is generous, and a second of slack absorbs the two clocks.
// The KEY is `storage-keys.js`'s (one spelling, two modules); the BOUND is this side's, because
// the bound protects the metric.
const SW_RELOAD_WINDOW_MS = 10 * 1000;
const SW_RELOAD_SKEW_MS = 1000;

/** The mark `markPageReady` writes and `recordPageLatency` reads. */
export const PAGE_READY_MARK = 'myb-page-ready';

/**
 * Resolves with the `ready` timestamp the moment `markPageReady` stamps — the fix for a metric that
 * was silently sampling a fifth of its own population (v21.16).
 *
 * `recordPageLatency` used to read the mark table at the instant it was called, and recorded `ready`
 * only if the mark was already there. On the Calendar those two sit on separate promise chains, so
 * whether a load contributed a sample was decided by which chain finished first: measured against
 * a real month, four loads in five were dropped, and not at random. Only `ready` waits; the other
 * metrics are recorded as before. Deliberately unbounded — a page that never becomes ready gives no
 * sample, rather than a fabricated one at some arbitrary cut-off.
 */
/** @type {(t: number) => void} */
let _resolveReady = () => {};
/** @type {Promise<number>} */
const _pageReady = new Promise((resolve) => { _resolveReady = resolve; });

// ── WHEN NOBODY WAS LOOKING ─────────────────────────────────────────────────────────────────────
//
// Times are `performance.now()` values — milliseconds since this load started, the same clock every
// mark and timing entry uses — so a reading is compared with them directly.
/** The first moment this page was hidden. 0 when it loaded hidden; Infinity while never. */
let _firstHiddenAt = Infinity;
/** The first moment it was hidden AFTER somebody had seen it (a page that loaded hidden, then shown). */
let _hiddenAgainAt = Infinity;
/** The first moment it was visible: 0 when it loaded visible; null until then. */
let _firstVisibleAt = /** @type {number|null} */ (null);
/** @type {(t: number) => void} */
let _resolveVisible = () => {};
/** Resolves when the page is first visible. @type {Promise<number>} */
const _visible = new Promise((resolve) => { _resolveVisible = resolve; });

(function watchVisibility() {
    /** @param {number} t */
    const seen = (t) => { if (_firstVisibleAt === null) { _firstVisibleAt = t; _resolveVisible(t); } };
    try {
        const doc = /** @type {any} */ (globalThis).document;
        // No document at all (a test, a worker): nothing can hide it, so it is watched throughout.
        if (!doc) { seen(0); return; }
        // A prerendered page reports itself hidden until it is shown; the flag is checked as well
        // because the two are separate properties and an engine may set one without the other.
        const hiddenNow = doc.visibilityState === 'hidden' || doc.prerendering === true;
        if (hiddenNow) _firstHiddenAt = 0;
        else {
            // A hide BEFORE this module ran — between the navigation and the first script — is read
            // back from the browser's own visibility timeline where it keeps one (Chrome 115+).
            let earlier;
            try { earlier = performance.getEntriesByType?.('visibility-state')?.find((e) => e.name === 'hidden')?.startTime; }
            catch { /* no timeline — the listener below covers everything from here on */ }
            if (typeof earlier === 'number') _firstHiddenAt = earlier;
            seen(0);
        }
        doc.addEventListener('visibilitychange', () => {
            let now = 0;
            try { now = performance.now(); } catch { /* no clock */ }
            if (doc.visibilityState === 'hidden') {
                if (_firstHiddenAt === Infinity) _firstHiddenAt = now;
                if (_firstVisibleAt !== null && _hiddenAgainAt === Infinity) _hiddenAgainAt = now;
            } else {
                seen(now);
            }
        });
    } catch { /* best-effort — a page we cannot observe is treated as watched */ }
})();

/** A reading taken `t` ms into the load counts only if the page had been watched until then.
 *  @param {number} t */
function _watched(t) { return t < _firstHiddenAt; }

// ── WHEN THE PAGE WAS WAITING FOR A PERSON ──────────────────────────────────────────────────────
/** When the page first asked somebody to type. null while it never has. @type {number|null} */
let _awaitingInputAt = null;

/**
 * Note that the page is now waiting for a person — a sign-in form or a Calendar lock card has
 * appeared. Everything that page reaches AFTER this includes their reading and typing, so `ready`
 * (and `rosterSnapshot`) are not recorded past it. Idempotent: the first call wins. Never throws.
 *
 * Called by login-overlay.js when it mounts, and by calendar-app.js through the lock cards'
 * `onAwaitingInput` — those modules decide who may see the Calendar and import no telemetry.
 * @returns {void}
 */
export function markAwaitingInput() {
    try { if (_awaitingInputAt === null) _awaitingInputAt = performance.now(); } catch { /* no clock */ }
}

/** @param {number} t */
function _beforeTyping(t) { return _awaitingInputAt === null || t < _awaitingInputAt; }

/** Epoch ms at which this load started. `timeOrigin` where the browser has it; otherwise derived.
 *  @returns {number} */
function _loadStartEpoch() {
    try {
        const o = /** @type {any} */ (performance).timeOrigin;
        if (typeof o === 'number' && o > 0) return o;
        return Date.now() - (typeof performance.now === 'function' ? performance.now() : 0);
    } catch { return Date.now(); }
}

/** milestone id → performance.mark name. `rosterSnapshot` (v24.85) is the Calendar painting a member's
 *  own stored roster before the sign-in check answers (calendar-snapshot.js) — the moment they first
 *  SEE their shifts, which `ready` does not time: that is the grid after the check. It reports only
 *  when it happened, so an open with no stored copy gives it no time. The other rungs it shared this
 *  table with (`authBoot`, `access`, `rosterCached`, `rosterLive`) were retired with the card blocks
 *  that read them (Oct 2026).
 *  @type {Record<string, string>} */
const MILESTONE_MARKS = { rosterSnapshot: 'myb-roster-snapshot' };
/** @type {Record<string, (t: number) => void>} */
const _resolveMilestone = {};
/** @type {Record<string, Promise<number>>} */
const _milestone = {};
for (const id of Object.keys(MILESTONE_MARKS)) {
    _milestone[id] = new Promise((resolve) => { _resolveMilestone[id] = resolve; });
}

/**
 * Mark a milestone. Idempotent, silent on any platform without the Performance API, and — like
 * `markPageReady` — it must never be able to break the page it times.
 * @param {'rosterSnapshot'} id
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

/** Set by the first `markPageReady` call; later calls do nothing. */
let _readyRequested = false;

/**
 * Mark the instant this page's MAIN CONTENT is on screen and usable.
 *
 * ── WHY THIS EXISTS (v20.80) ────────────────────────────────────────────────────────────────────
 *
 * `fcp` is the first pixel painted, which on the Calendar is the SPLASH, and `domReady` fires when
 * the module scripts finish, while the Calendar can still be blank (measured with the auth restore
 * held at 2s: fcp 512ms, domReady 669ms, roster on screen 2630ms). So a page calls this once, at the
 * moment its own content is genuinely usable — the Calendar's first grid render, and the pages whose
 * `.container` is hidden until `body.auth-ready`.
 *
 * ── STAMPED AFTER THE FRAME THAT SHOWS IT (Oct 2026) ────────────────────────────────────────────
 *
 * Callers mark at the end of their own setup, and on four pages synchronous work still followed in
 * the same task, so the mark landed before the screen did. The stamp now waits for the next frame
 * and then one more turn (`requestAnimationFrame` then `setTimeout`), which is when that frame has
 * been presented. A hidden page draws no frames, so it stamps at once — and its reading is left out
 * anyway (above). The first call wins; a re-render must not even try.
 * @returns {void}
 */
export function markPageReady() {
    if (_readyRequested) return;
    _readyRequested = true;
    const stamp = () => {
        try {
            if (performance.getEntriesByName?.(PAGE_READY_MARK)?.length) return;
            performance.mark(PAGE_READY_MARK);
            // Read back rather than trusted from the return value: `performance.mark()` returns the
            // entry in modern browsers and nothing in older ones.
            const t = performance.getEntriesByName?.(PAGE_READY_MARK)?.[0]?.startTime;
            if (typeof t === 'number') _resolveReady(t);
        } catch { /* Performance API unavailable — the metric is skipped, nothing else changes */ }
    };
    try {
        const doc = /** @type {any} */ (globalThis).document;
        if (typeof requestAnimationFrame === 'function' && doc && doc.visibilityState === 'visible') {
            requestAnimationFrame(() => setTimeout(stamp, 0));
            return;
        }
    } catch { /* fall through and stamp now */ }
    stamp();
}

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
 * Run `cb` with the navigation entry once its DOMContentLoaded END is known. Called from inside a
 * page's own boot, this can run BEFORE that field is written (it reads 0 until the event's handlers
 * have finished), and a 0 is dropped — which removed `domReady` from the fastest opens of all
 * (statistics review, Oct 2026: the Calendar's `ready` count exceeded its `domReady` count). So a 0
 * waits for the event and one more turn, then reads again; a page already past it reads at once.
 * @param {(nav: any) => void} cb
 */
function _whenDomReadyKnown(cb) {
    const read = () => /** @type {any} */ (performance.getEntriesByType?.('navigation')?.[0]);
    const nav = read();
    if (!nav) return;   // Navigation Timing L2 unsupported (old Safari) — skip silently
    if (nav.domContentLoadedEventEnd > 0) { cb(nav); return; }
    try {
        const doc = /** @type {any} */ (globalThis).document;
        const again = () => setTimeout(() => { const n = read(); if (n && n.domContentLoadedEventEnd > 0) cb(n); }, 0);
        if (doc && doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', again, { once: true });
        else again();
    } catch { /* no document — nothing more to wait for */ }
}

/**
 * Record this page's latency (bucketed), anonymously. Best-effort and silent: any missing API or
 * error simply records nothing.
 * @param {string} page - stable page id: 'calendar' | 'admin' | 'paycalc' | 'operations' | 'settings' | 'links' | …
 * @param {string|null} [identity] - the signed-in member's name; if it is an admin (the developer),
 *        this session is the developer testing the app, so NOTHING is recorded — the figures must
 *        reflect real staff, not test loads.
 * @returns {void}
 */
export function recordPageLatency(page, identity = null) {
    try {
        // Exclude the developer/admin's own sessions (CONFIG.ADMIN_NAMES) so speed figures reflect real
        // staff — but still CONSUME both one-shot markers below, so an excluded load can't leave a
        // stale marker that mis-times or mis-labels a later staff load.
        const excluded = !!(identity && CONFIG.ADMIN_NAMES.includes(identity));
        const { mode, conn } = envContext();

        // Sign-in time: from pressing "Sign in" until this page was USABLE (its `ready` mark), which
        // is what the card says it is. It ended at whenever this function happened to run until
        // Oct 2026 — on the Calendar that is before the grid appears. Attributed to the synthetic page
        // id 'login' (sign-in speed is ONE number, not split by destination). The marker is ALWAYS
        // cleared; the sample is RECORDED only for a real staff load watched until it was usable.
        try {
            const t0 = Number(sessionStorage.getItem(LOGIN_T0_KEY));
            if (t0) {
                sessionStorage.removeItem(LOGIN_T0_KEY);
                if (!excluded) {
                    _pageReady.then((readyAt) => {
                        if (!_watched(readyAt)) return;
                        const bucket = loginDurationBucket(t0, _loadStartEpoch() + readyAt);
                        if (bucket) recordPerfSample({ page: 'login', metric: 'loginTotal', bucket, mode, conn });
                    }).catch(() => { /* never rejects */ });
                }
            }
        } catch { /* sessionStorage unavailable — skip login timing */ }

        // Did this load follow a release? One-shot by the SAME rule as the login marker above.
        let afterUpdate = false;
        try {
            const t = Number(sessionStorage.getItem(SW_RELOAD_KEY));
            if (t) {
                sessionStorage.removeItem(SW_RELOAD_KEY);
                const gap = _loadStartEpoch() - t;
                afterUpdate = gap >= -SW_RELOAD_SKEW_MS && gap < SW_RELOAD_WINDOW_MS;
            }
        } catch { /* sessionStorage unavailable — this load simply reports no update attribution */ }

        if (excluded) return;   // developer's own session: markers consumed above, nothing else recorded

        // First Contentful Paint (metric 'fcp') — when the user first SEES content. From the Paint
        // Timing API, a separate timeline to Navigation Timing, so recorded independently of it.
        recordFcp(page, mode, conn);

        // ── `ready`, WHENEVER IT ARRIVES ────────────────────────────────────────────────────────
        // Above the Navigation Timing read, because it depends only on a mark. A load watched until
        // it was usable, with nobody asked to type first, is recorded; a release reload watched
        // from its start records `readyUpdate` beside it — a SUBSET, from the same reading.
        const recordReady = (/** @type {number} */ readyAt) => {
            if (!_watched(readyAt) || !_beforeTyping(readyAt)) return;
            const bucket = bucketDuration(readyAt);
            if (!bucket) return;
            recordPerfSample({ page, metric: 'ready', bucket, mode, conn });
            if (afterUpdate) recordPerfSample({ page, metric: 'readyUpdate', bucket, mode, conn });
        };
        let readyNow;
        try { readyNow = performance.getEntriesByName?.(PAGE_READY_MARK)?.[0]?.startTime; }
        catch { /* no marks — fall through and wait, which on such a platform simply never fires */ }
        if (typeof readyNow === 'number') recordReady(readyNow);
        else _pageReady.then(recordReady).catch(() => { /* never rejects */ });

        // A release reload that ran WHILE HIDDEN — the Calendar's, by design. Nobody waited for the
        // load itself, so what is timed is the wait the member actually had: from coming back to the
        // page until it was usable, and a token instant (the fastest band) if it was ready first. If
        // they leave again before it is ready, or have to type, there is no wait to report.
        if (afterUpdate && _firstHiddenAt === 0) {
            Promise.all([_pageReady, _visible]).then(([readyAt, seenAt]) => {
                if (readyAt > seenAt && readyAt >= _hiddenAgainAt) return;
                if (!_beforeTyping(readyAt)) return;
                const bucket = bucketDuration(Math.max(1, readyAt - seenAt));
                if (bucket) recordPerfSample({ page, metric: 'readyUpdate', bucket, mode, conn });
            }).catch(() => { /* never rejects */ });
        }

        // The milestones, by the same rule as `ready` — already marked, or recorded when they arrive.
        // A page that never reaches one never reports it: a milestone that did not happen must not be
        // given a time.
        for (const id of Object.keys(MILESTONE_MARKS)) {
            const write = (/** @type {number} */ t) => {
                if (!_watched(t) || !_beforeTyping(t)) return;
                const b = bucketDuration(t);
                if (b) recordPerfSample({ page, metric: id, bucket: b, mode, conn });
            };
            let now;
            try { now = performance.getEntriesByName?.(MILESTONE_MARKS[id])?.[0]?.startTime; }
            catch { /* no marks on this platform — the await below simply never fires */ }
            if (typeof now === 'number') write(now);
            else _milestone[id]?.then(write).catch(() => { /* never rejects */ });
        }

        // The app's code having loaded (DOMContentLoaded). It cannot include typing, so only the
        // watched rule applies.
        _whenDomReadyKnown((nav) => {
            const dcl = nav.domContentLoadedEventEnd;
            if (!_watched(dcl)) return;
            const bucket = bucketDuration(dcl);
            if (bucket) recordPerfSample({ page, metric: 'domReady', bucket, mode, conn });
        });
    } catch { /* best-effort — latency telemetry must never affect the app */ }
}

/**
 * Record First Contentful Paint for `page` (bucketed), best-effort. Reads the existing paint entry if
 * present; otherwise observes once for a late paint. A paint after the page was first hidden is not
 * a load anybody watched, so it is not recorded. Never throws.
 * @param {string} page @param {string} mode @param {string} conn
 */
function recordFcp(page, mode, conn) {
    try {
        const report = (/** @type {number} */ startTime) => {
            if (!_watched(startTime)) return;
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
