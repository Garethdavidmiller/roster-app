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
 * the `request.auth != null` rule.
 *
 * ── ONE IDENTITY ARGUMENT, AND ANONYMOUS VISITS COUNT (v19.95) ─────────────────────
 *
 * There used to be two: `member` (the SIGNED-IN name, which gated the account metric)
 * and `identity` (whoever is acting on this device, for the admin exclusion and the
 * address counters). The calendar passed `member: null` with a real `identity`, so a
 * member who only ever looks at the roster — never signing in anywhere — incremented
 * the page counter and nothing else. That is most of the staff: `password-force.js`
 * only reaches people who sign in, and AUTH_PLAN.md's whole Track E premise is that a
 * roster-only viewer is never compelled to. "Accounts active" was therefore counting
 * the minority who happen to visit an authenticated page, and reading as though it
 * counted everybody.
 *
 * `_recordOrigin` had already worked around exactly this (v19.23) by keying on
 * `identity` instead — its comment says so in as many words. Rather than leave one
 * metric compensating for a gate the one above it still applied, the gate now keys on
 * `identity` too, and the two parameters collapse into one. Two arguments that must
 * always hold the same value is the drift this codebase writes parity tests about.
 *
 * WHAT IT CHANGES ABOUT THE FIGURES. "Accounts active" steps UP from v19.95 and the
 * history either side of it is not comparable — it now means "accounts that used the
 * app", where before it meant "accounts that used a page you must sign in for". The
 * Usage card says so, and the gap between it and "Accounts that have signed in"
 * (Firebase Auth's exact count) becomes readable: roughly the staff who use the roster
 * without ever holding an account session.
 *
 * WHAT STILL CANNOT COUNT. A device on FIRST RUN has no identity to dedup on — the
 * "selection" is only CONFIG.DEFAULT_MEMBER_NAME (an admin) — so it records a page
 * view and no account, exactly as the address counters do. That is one load per
 * device, immediately before a member is chosen.
 */

import { recordPageView, recordActiveAccount, recordOriginUse } from './firebase-client.js';
import { lsGet, lsSet } from './ls.js';
import { monthKey, dayKey, shouldCountMonth, shouldCountRolling, originLabel } from './usage-stats.js';
import { CONFIG } from './roster-data.js';

/**
 * Record a page view, and — when the acting member can be identified — count them toward
 * the active-account metric (deduped client-side per month and per rolling window).
 * @param {string} page - stable page id: 'calendar' | 'admin' | 'paycalc' | 'operations' | 'settings' | 'links'
 * @param {string|null} [identity] - whoever is acting on this device: the signed-in member on an
 *        authenticated page, or the calendar's SELECTED member when nobody is signed in. It does
 *        three jobs and never leaves the device — admin exclusion (an admin identity records
 *        NOTHING, so the figures reflect real staff rather than the developer's test loads), the
 *        active-account dedup key, and the address-counter dedup key. Null (first run) records the
 *        page view alone, because there is nothing to dedup on.
 */
export function recordUsage(page, identity = null) {
    // Exclude the developer/admin's own sessions (CONFIG.ADMIN_NAMES) so usage reflects real staff.
    if (identity && CONFIG.ADMIN_NAMES.includes(identity)) return;

    try { recordPageView(page); } catch (_e) { /* best-effort */ }

    // Which ADDRESS is this account using, and is it the installed app? (v19.23 — the migration
    // metric.) Same identity, same dedup rule, same "+1"-only write as the account metric below.
    _recordOrigin(identity);

    if (!identity) return;
    try {
        const now = new Date();
        // Device-level dedup keys, keyed by member name. They never leave the device;
        // the server only sees the resulting increment. Not paycalc-namespaced — these
        // are per-account guards, not per-member financial data. The key namespace is
        // shared with the pre-v19.95 signed-in-only counts on purpose: a member who reads
        // the calendar and then opens Settings is one account, counted once.
        const monthStoreKey = `myb_usage_m_${identity}`;
        const rollStoreKey   = `myb_usage_d30_${identity}`;

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
 *   'huddle' | 'circular' | 'newsletter'
 *   'guide-staff' | 'guide-paycalc' | 'guide-railcard' | 'guide-rangers' | 'guide-fip'
 * The guide ids come from NAV_GUIDES in nav-panel.js, which stamps each one onto its own
 * link — never matched from the href here, because './paycalc-guide.html'.includes('guide.html')
 * is true and a substring test would silently count the Pay Calculator Guide as the Staff Guide.
 * @param {string} itemId - stable open id (see list above)
 * @param {string|null} [identity] - the acting member's name for the admin-exclusion check
 *        (signed-in name, or the calendar's selected member); null records anonymously
 */
export function recordOpen(itemId, identity = null) {
    if (identity && CONFIG.ADMIN_NAMES.includes(identity)) return;
    try { recordPageView(itemId); } catch (_e) { /* best-effort */ }
}
