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
import { bucketDuration, loginDurationBucket } from './perf-stats.js';
import { CONFIG } from './roster-data.js';

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

        if (excluded) return;   // developer's own session: marker consumed above, nothing else recorded

        // First Contentful Paint (metric 'fcp') — when the user first SEES content, i.e. the page
        // "appears". From the Paint Timing API, a SEPARATE timeline to Navigation Timing's domReady
        // ("fully ready") — so record it BEFORE the nav-timing guard below, never gated on it.
        recordFcp(page, mode, conn);

        // Navigation-timing metrics for THIS page (every load).
        const nav = /** @type {any} */ (performance.getEntriesByType?.('navigation')?.[0]);
        if (!nav) return;   // Navigation Timing L2 unsupported (old Safari) — skip silently
        /** @type {Record<string, number>} */
        // responseStart IS time-to-first-byte; responseEnd is the LAST byte (it silently included
        // the full HTML download on slow connections, inflating the App Speed bands) (v16.23).
        const metrics = { ttfb: nav.responseStart, domReady: nav.domContentLoadedEventEnd };
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
