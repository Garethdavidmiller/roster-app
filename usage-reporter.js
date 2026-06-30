// @ts-check
/**
 * usage-reporter.js — records anonymous usage to Firestore (page popularity +
 * active-account counts). The usage analogue of error-reporter.js: a thin
 * orchestration layer that decides WHEN to write and lets firebase-client.js do
 * the I/O. Fire-and-forget — never throws, never blocks rendering.
 *
 * Two metrics, both anonymous:
 *   1. Page popularity — every page load increments an anonymous per-page counter.
 *   2. Active accounts — counts DISTINCT accounts active per calendar month and over
 *      a rolling 30 days. Uniqueness is deduped HERE on the client (localStorage
 *      flags keyed by member name, which never leave the device) so the server only
 *      ever receives "+1" — it never learns WHO was active, only how many.
 *
 * Call once per page from the coordinator, at the same point initErrorReporter() is
 * called (after the Firebase Auth session is being established) so the writes satisfy
 * the `request.auth != null` rule. Pass the signed-in member for the account metric;
 * pass no member (e.g. the anonymous calendar) to record only the page view.
 */

import { recordPageView, recordActiveAccount } from './firebase-client.js';
import { lsGet, lsSet } from './ls.js';
import { monthKey, dayKey, shouldCountMonth, shouldCountRolling } from './usage-stats.js';
import { CONFIG } from './roster-data.js';

/**
 * Record a page view, and — if a signed-in member is supplied — count them toward
 * the active-account metric (deduped client-side per month and per rolling window).
 * @param {string} page - stable page id: 'calendar' | 'admin' | 'paycalc' | 'operations' | 'settings' | 'links'
 * @param {string|null} [member] - the signed-in member's name, or null/omitted for anonymous page views
 * @param {string|null} [identity] - the active member's name for the admin-exclusion check; defaults to
 *        `member`. If it is an admin (the developer), NOTHING is recorded — the figures must reflect real
 *        staff, not test loads. The anonymous calendar passes its selected member here while leaving
 *        `member` null (so it still records a page view but no active-account, as before).
 */
export function recordUsage(page, member = null, identity = member) {
    // Exclude the developer/admin's own sessions (CONFIG.ADMIN_NAMES) so usage reflects real staff.
    if (identity && CONFIG.ADMIN_NAMES.includes(identity)) return;

    try { recordPageView(page); } catch (_e) { /* best-effort */ }

    if (!member) return;
    try {
        const now = new Date();
        // Device-level dedup keys, keyed by member name. They never leave the device;
        // the server only sees the resulting increment. Not paycalc-namespaced — these
        // are per-account guards, not per-member financial data.
        const monthStoreKey = `myb_usage_m_${member}`;
        const rollStoreKey   = `myb_usage_d30_${member}`;

        const monthHit = shouldCountMonth(lsGet(monthStoreKey), now);
        const rollHit  = shouldCountRolling(parseInt(lsGet(rollStoreKey) || '', 10), now);
        if (!monthHit && !rollHit) return;

        recordActiveAccount({
            month: monthHit ? monthKey(now) : null,
            day:   rollHit  ? dayKey(now)   : null,
        });
        if (monthHit) lsSet(monthStoreKey, monthKey(now));
        if (rollHit)  lsSet(rollStoreKey, String(now.getTime()));
    } catch (_e) { /* best-effort — usage tracking must never affect the app */ }
}
