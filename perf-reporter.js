// @ts-check
/**
 * perf-reporter.js — records anonymous page-load latency to Firestore (Project 0 instrumentation).
 * The performance analogue of usage-reporter.js: a thin layer that reads the browser's Navigation
 * Timing, buckets the durations, and lets firebase-client.js do the I/O. Fire-and-forget — it must
 * never throw and never block rendering.
 *
 * v1 metrics (both from the PerformanceNavigationTiming entry, so they cost nothing and are NOT
 * confounded by the in-place-login flow — they measure DOCUMENT/shell load, not "time to signed-in"):
 *   ttfb     — responseEnd               (server + network to first byte received)
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
import { bucketDuration } from './perf-stats.js';

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
 * @returns {void}
 */
export function recordPageLatency(page) {
    try {
        const nav = /** @type {any} */ (performance.getEntriesByType?.('navigation')?.[0]);
        if (!nav) return;   // Navigation Timing L2 unsupported (old Safari) — skip silently
        const { mode, conn } = envContext();
        /** @type {Record<string, number>} */
        const metrics = { ttfb: nav.responseEnd, domReady: nav.domContentLoadedEventEnd };
        for (const metric of Object.keys(metrics)) {
            const bucket = bucketDuration(metrics[metric]);
            if (bucket) recordPerfSample({ page, metric, bucket, mode, conn });
        }
    } catch { /* best-effort — latency telemetry must never affect the app */ }
}
