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
 * the analytics rule, which needs a member, the admin or the PIN viewer (`isKnownIdentity`, v24.56).
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
 *
 * ── ONLY A SIGNED-IN ADMIN IS LEFT OUT (v25.00, Usage card review) ──────────────────
 *
 * The admin exclusion used to key on the same single identity, so on a device where nobody
 * is signed in it keyed on the SELECTED member. The station PC opens the roster on the staff
 * PIN with whichever row was picked last, and the default selection is an admin — so every
 * staff open there could be dropped, while the admin's own PIN opens counted whenever another
 * row was selected. A selection says whose roster is on screen, not who is looking at it.
 * The identity is therefore two arguments again, with one job each: `signedIn` is the only
 * one trusted to exclude, and `selected` is only ever a dedup key. An admin SELECTION still
 * records the page view — somebody opened the page — but no member-device and no address,
 * because there is no member to name.
 *
 * ── A RELEASE RELOAD IS NOT A VISIT (v25.00) ────────────────────────────────────────
 *
 * When an update reaches an open page the app reloads it itself, usually while it is hidden
 * (sw-register.js). That is not somebody opening a page — in September it was about one
 * Calendar open in seven — so such a load records nothing here. `loadFollowedRelease` is the
 * same answer App Speed uses, read once per load because the marker can be consumed only once.
 */

import { recordPageView, recordActiveAccount, recordOriginUse } from './firebase-client.js';
import { lsGet, lsSet } from './ls.js';
import { monthKey, dayKey, shouldCountMonth, rollingMove, originLabel } from './usage-stats.js';
import { CONFIG } from './roster-data.js';
import { loadFollowedRelease } from './perf-reporter.js';

/**
 * Record a page view, and — when the acting member can be identified — count them toward
 * the active-account metric (deduped client-side per month and per rolling window).
 * @param {string} page - stable page id: 'calendar' | 'admin' | 'paycalc' | 'operations' | 'settings' | 'links' | 'overtime' | 'trains'
 * @param {string|null} [signedIn] - the member SIGNED IN on this device, or null. The only identity
 *        the admin exclusion trusts: a signed-in admin records NOTHING, so the figures reflect real
 *        staff rather than the developer's test loads.
 * @param {string|null} [selected] - the Calendar's SELECTED member when nobody is signed in (null
 *        on a first-run device, where the selection is only the default). A dedup key and nothing
 *        else — see the header for why it never excludes.
 */
export function recordUsage(page, signedIn = null, selected = null) {
    // Exclude the developer/admin's own sessions (CONFIG.ADMIN_NAMES) so usage reflects real staff.
    if (signedIn && CONFIG.ADMIN_NAMES.includes(signedIn)) return;
    if (loadFollowedRelease()) return;

    try { recordPageView(page); } catch (_e) { /* best-effort */ }

    // Whoever this device's member-device and address counts belong to. Never an admin: a signed-in
    // one has already returned, and a SELECTED one is a roster on a screen, not a member to count.
    const identity = signedIn || selected || null;
    if (!identity || CONFIG.ADMIN_NAMES.includes(identity)) return;

    // Which ADDRESS is this account using, and is it the installed app? (v19.23 — the migration
    // metric.) Same identity, same dedup rule, same moved "+1" as the account metric below.
    _recordOrigin(identity);

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
        // The rolling count MOVES to today rather than freezing for 30 days (v25.00 — `rollingMove`).
        const move = rollingMove(parseInt(lsGet(rollStoreKey) || '', 10), now);
        if (!monthHit && !move) return;

        recordActiveAccount({
            month:   monthHit ? monthKey(now) : null,
            day:     move ? move.add : null,
            fromDay: move ? move.remove : null,
        });
        if (monthHit) lsSet(monthStoreKey, monthKey(now));
        if (move)     lsSet(rollStoreKey, String(now.getTime()));
    } catch (_e) { /* best-effort — usage tracking must never affect the app */ }
}

/**
 * Count this account once per rolling window per ADDRESS, and separately once per window per
 * address for the INSTALLED app — each count sitting on the latest day it was earned (v25.00).
 *
 * The two flags are independent on purpose. A single flag would freeze whichever mode the account
 * happened to use first, so anyone who opened a browser tab before opening the installed app would
 * never be counted as installed — and "how many have actually installed it on the new address" is
 * the whole question. localStorage is per-ORIGIN, so the per-address split needs no work at all:
 * each address keeps its own flags, and a moved count never changes address.
 *
 * @param {string} identity the acting member's name (dedup only — never sent)
 */
function _recordOrigin(identity) {
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
        const seen = rollingMove(parseInt(lsGet(seenKey) || '', 10), now);
        const pwa  = installed ? rollingMove(parseInt(lsGet(pwaKey) || '', 10), now) : null;
        if (!seen && !pwa) return;

        // A pwa-only move still needs the day; no `seen` move simply means today already holds the visit.
        recordOriginUse({
            day: dayKey(now), origin,
            countVisit: !!seen, fromDay: seen ? seen.remove : null,
            installed: !!pwa, fromPwaDay: pwa ? pwa.remove : null,
        });
        if (seen) lsSet(seenKey, String(now.getTime()));
        if (pwa)  lsSet(pwaKey,  String(now.getTime()));
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
 * link — never matched from the href here: './paycalc-guide.html'.includes('guide.html') is true,
 * `guide.html` was the Staff Guide's filename until v22.47, and a substring test therefore counted
 * the Pay Calculator Guide as the Staff Guide. The rename ended that particular collision; the id
 * stays explicit because a filename is not a stable key.
 * @param {string} itemId - stable open id (see list above)
 * @param {string|null} [signedIn] - the member SIGNED IN on this device, for the admin-exclusion
 *        check; null records anonymously. Never the Calendar's selected member (v25.00 — the header's
 *        "only a signed-in admin is left out" says why).
 */
export function recordOpen(itemId, signedIn = null) {
    if (signedIn && CONFIG.ADMIN_NAMES.includes(signedIn)) return;
    try { recordPageView(itemId); } catch (_e) { /* best-effort */ }
}
