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

import { recordPageView, recordActiveAccount, recordOriginUse } from './firebase-client.js';
import { lsGet, lsSet } from './ls.js';
import { monthKey, dayKey, shouldCountMonth, shouldCountRolling, originLabel } from './usage-stats.js';
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

    // Which ADDRESS is this account using, and is it the installed app? (v19.23 — the migration
    // metric.) Keyed on `identity`, NOT `member`: active accounts only count signed-in pages, so
    // calendar-only staff — the majority, and precisely the people a migration strands — would
    // never appear. `identity` is the calendar's selected member, which never leaves the device;
    // the server still only ever receives "+1".
    _recordOrigin(identity);

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

/**
 * Count this account once per rolling window per ADDRESS, and separately once per window per
 * address for the INSTALLED app.
 *
 * The two flags are independent on purpose. A single flag would freeze whichever mode the account
 * happened to use first, so anyone who opened a browser tab before opening the installed app would
 * never be counted as installed — and "how many have actually installed it on the new address" is
 * the whole question. localStorage is per-ORIGIN, so the per-address split needs no work at all:
 * each address keeps its own flags.
 *
 * @param {string|null} identity the acting member's name (dedup only — never sent)
 */
function _recordOrigin(identity) {
    if (!identity) return;
    try {
        const now = new Date();
        const origin = originLabel(location.hostname);
        let installed = false;
        try {
            installed = !!(window.matchMedia?.('(display-mode: standalone)')?.matches
                || /** @type {any} */ (window.navigator).standalone);
        } catch { /* matchMedia unavailable — treat as a browser tab */ }

        const seenKey = `myb_origin_seen_${identity}`;
        const pwaKey  = `myb_origin_pwa_${identity}`;
        const seenHit = shouldCountRolling(parseInt(lsGet(seenKey) || '', 10), now);
        const pwaHit  = installed && shouldCountRolling(parseInt(lsGet(pwaKey) || '', 10), now);
        if (!seenHit && !pwaHit) return;

        // A pwa-only hit still needs the day; `seenHit` false simply means don't re-count the visit.
        recordOriginUse({ day: dayKey(now), origin, installed: pwaHit, countVisit: seenHit });
        if (seenHit) lsSet(seenKey, String(now.getTime()));
        if (pwaHit)  lsSet(pwaKey,  String(now.getTime()));
    } catch (_e) { /* best-effort — usage tracking must never affect the app */ }
}

/**
 * Record an anonymous "opened" count for a document or guide (v18.20). Same counter store as
 * page views (analytics/pv_<YYYY-MM>.counts) and the same write-time admin exclusion — the
 * developer's own opens are never recorded. No dedup: every open counts ("how many times"),
 * unlike the active-account metric. Item ids (also allowlisted in firestore.rules):
 *   'huddle' | 'circular' | 'newsletter' | 'guide-railcard' | 'guide-fip'
 * @param {string} itemId - stable open id (see list above)
 * @param {string|null} [identity] - the acting member's name for the admin-exclusion check
 *        (signed-in name, or the calendar's selected member); null records anonymously
 */
export function recordOpen(itemId, identity = null) {
    if (identity && CONFIG.ADMIN_NAMES.includes(identity)) return;
    try { recordPageView(itemId); } catch (_e) { /* best-effort */ }
}
