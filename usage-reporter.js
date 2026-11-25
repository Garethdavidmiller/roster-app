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
 * the analytics rule, which needs a member or the admin (`isKnownIdentity`, v24.56).
 *
 * ── ONE IDENTITY FOR BOTH ACCOUNT COUNTS (v19.95) ───────────────────────────────────
 *
 * The account metric and the address counters (`_recordOrigin`) key on the same identity:
 * whoever is acting on this device. Until v19.95 the account metric keyed on a separate
 * signed-in-only argument, so it counted only the minority who visited a page you had to
 * sign in for. Two arguments that must always hold the same value is the drift this
 * codebase writes parity tests about.
 *
 * WHAT THE FIGURES MEAN. "Accounts active" means "accounts that used the app"; the history
 * before v19.95 is not comparable, and the Usage card says so. The Calendar opens only to a
 * named session, so the gap between it and "Accounts that have signed in" (Firebase Auth's
 * exact count) is mostly members on a session whose sign-in is older than that count's
 * 30-day window (functions/account-reads.js, "WHAT IT DOES NOT MEASURE").
 *
 * WHAT CANNOT COUNT. A device on FIRST RUN has no identity to dedup on, so the Calendar
 * passes no selection and, with nobody signed in, it records a page view and no account,
 * exactly as the address counters do.
 *
 * ── ONLY A SIGNED-IN ADMIN IS LEFT OUT (v25.00, Usage card review) ──────────────────
 *
 * A selection says whose roster is on screen, not who is looking at it. The exclusion once
 * keyed on it, and while the station PC opened the roster on the staff PIN (retired 23 Nov
 * 2026) with an admin as the default row, that dropped real staff opens. So the identity is
 * two arguments with one job each: `signedIn` is the only one trusted to exclude, and
 * `selected` is only ever a dedup key, used when nobody is signed in. An admin SELECTION
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
 * @param {string} page - stable page id: 'calendar' | 'admin' | 'paycalc' | 'operations' | 'settings' | 'links' | 'overtime' | 'trains' | 'newlink'
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
 * each address keeps its own flags, and a moved count never changes address. One exception it cannot
 * see: on an iPhone the Home Screen app keeps storage SEPARATE from Safari on the same address, so a
 * member who uses both is counted as two devices (KNOWN_LIMITATIONS → "iPhones keep two separate
 * copies…") — the counts are an upper bound there, not an exact figure.
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
 * The guide ids come from NAV_GUIDES in nav-destinations.js; nav-panel-markup.js stamps each one onto its own
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
