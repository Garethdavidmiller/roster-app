// @ts-check
/**
 * analytics-client.js — the admin's two read-outs of the app itself, and the writers that feed them:
 * the CLIENT ERROR LOG (`logClientError` / `getClientErrors` / `resolveClientError`) and the anonymous
 * USAGE and SPEED counters (`recordPageView`, `recordActiveAccount`, `recordOriginUse`,
 * `recordPerfSample`, `getPerfStats`, `getUsageStats`).
 *
 * Owns: the Firestore I/O around `clientErrors` and `analytics/*` — the queries, the merged counter
 *   writes, and the best-effort prunes that keep both bounded.
 * Does NOT own: any decision. Ordering and retention are `client-errors.js`; bucketing, windows and
 *   summaries are `usage-stats.js` and `perf-stats.js`; who counts as a new account is
 *   `usage-reporter.js`. This module is the wiring between those rules and the database.
 *
 * ── TWO PROPERTIES EVERY FUNCTION HERE KEEPS ───────────────────────────────────────────────────
 *
 *   NO IDENTITY IN A COUNTER. Every `analytics/*` write is an integer increment under a key built
 *     from non-identifying dimensions. A member name may appear in an ERROR record (the admin needs
 *     to know whose device failed) and nowhere else in this file.
 *   TELEMETRY NEVER AFFECTS THE APP. Every writer is fire-and-forget with its rejection swallowed,
 *     and every prune is wrapped so that it cannot reject the read it rides on. That is also why the
 *     prunes use `FieldPath`: a dotted `daily.<date>` path is invalid and throws SYNCHRONOUSLY,
 *     past any `.catch`, which would take the whole Usage card down with it.
 *
 * ── WHY A FACTORY (v24.64) ─────────────────────────────────────────────────────────────────────
 *
 * The same reason as `documents-client.js`: `firebase-client.js` re-exports these, so importing `db`
 * back would be a cycle, and with every Firebase handle INJECTED this file imports nothing from the
 * gstatic CDN and loads in Node — `analytics-client.test.mjs` runs it against a fake Firestore. It
 * left `firebase-client.js` because that file sat at its ratchet cap with no headroom (external
 * review, Oct 2026), and this was the one block in it with no tie to authentication.
 */

import { orderClientErrors, expiredResolvedIds, capUnresolvedErrors } from './client-errors.js';
import { monthKey, prevMonthKey, sumDailyWindow, orderPageCounts, staleDailyKeys, originKey, summariseOrigins, staleOriginKeys } from './usage-stats.js';
import { perfSampleKey, summarisePerf, createPerfBatcher } from './perf-stats.js';

/**
 * @param {{
 *   db: any,
 *   collections: { clientErrors: string, analytics: string },
 *   fs: { doc: Function, getDoc: Function, getDocs: Function, setDoc: Function, addDoc: Function, deleteDoc: Function,
 *         updateDoc: Function, collection: Function, query: Function, where: Function, limit: Function,
 *         serverTimestamp: Function, increment: Function, deleteField: Function, FieldPath: any },
 *   writeWithClaimRetry: <T>(fn: () => Promise<T>) => Promise<T>,
 *   appVersion: string,
 * }} deps
 */
export function buildAnalyticsClient({ db, collections, fs, writeWithClaimRetry, appVersion }) {
    const { doc, getDoc, getDocs, setDoc, addDoc, deleteDoc, updateDoc, collection, query, where, limit,
        serverTimestamp, increment, deleteField, FieldPath } = fs;

    // ---- Client Error Reporting ----

    /**
     * Write a client-side uncaught error to Firestore.
     * Called by error-reporter.js — fire-and-forget, never throws.
     * @param {{ memberName: string, page: string, message: string, stack: string, appVersion: string, userAgent: string }} data
     */
    function logClientError({ memberName, page, message, stack, appVersion, userAgent }) {
        addDoc(collection(db, collections.clientErrors), {
            memberName, page, message, stack, appVersion, userAgent,
            timestamp: serverTimestamp(),
            resolved:  false,
        }).catch(() => {/* swallow — never throw from an error reporter */});
    }

    /**
     * Fetch client error records for the admin error log (admin-only).
     *
     * Unresolved errors get their OWN equality query, prioritised ahead of resolved ones —
     * the previous single newest-first window could hide them once 100 resolved records
     * piled up. Within expected operational volume (< 100 unresolved at once) none are missed. Resolved
     * records are fetched with a bounded query and used both for display context and to
     * prune anything past the post-resolution retention window, so the collection stays
     * bounded at this app's scale (not just the newest rows being cleaned up).
     *
     * Both queries are single-field equality filters (auto-indexed) — no composite index.
     * Ordering and retention are pure logic in client-errors.js (unit-tested); this
     * function is only the Firestore I/O around them.
     *
     * The unresolved query is capped at `UNRESOLVED_CAP` shown, with NO `orderBy` (that would
     * need the composite index this design deliberately avoids), so once the cap is exceeded the
     * shown set is an arbitrary — not the newest — 100. That only happens above the documented
     * operating volume (< 100 unresolved), but the error log is the admin's own "see problems"
     * surface, so a genuinely-hidden overflow must be surfaced, never silently swallowed (the
     * app's no-silent-caps rule). We query `CAP + 1` and set `truncated` only when the extra row
     * comes back (i.e. > 100 actually exist) — exactly 100 with none hidden is NOT truncated.
     * @returns {Promise<{ errors: Array<{id: string, memberName: string, page: string, message: string, stack: string, appVersion: string, userAgent: string, timestamp: import('firebase/firestore').Timestamp, resolved: boolean, resolvedAt?: import('firebase/firestore').Timestamp}>, truncated: boolean }>}
     */
    async function getClientErrors() {
        const now = Date.now();
        const UNRESOLVED_CAP = 100;
        // Fetch ONE more than the display cap: if the 101st exists we KNOW there are more than
        // 100 (truncated), whereas a plain limit(100) can't tell "exactly 100" from "100+".
        const [unresolvedSnap, resolvedSnap] = await Promise.all([
            getDocs(query(collection(db, collections.clientErrors), where('resolved', '==', false), limit(UNRESOLVED_CAP + 1))),
            getDocs(query(collection(db, collections.clientErrors), where('resolved', '==', true),  limit(200))),
        ]);
        // Pure truncation split (client-errors.capUnresolvedErrors, unit-tested): show at most the cap;
        // `truncated` is true only when the (cap+1)th row came back, i.e. > cap genuinely exist.
        const { shown: unresolvedDocs, truncated } = capUnresolvedErrors(unresolvedSnap.docs, UNRESOLVED_CAP);
        const unresolved = unresolvedDocs.map(/** @param {any} d */ d => ({ id: d.id, ...d.data() }));
        const resolved   = resolvedSnap.docs.map(/** @param {any} d */ d => ({ id: d.id, ...d.data() }));

        // Best-effort prune of resolved records past the retention window (from resolvedAt).
        for (const id of expiredResolvedIds(resolved, now)) {
            deleteDoc(doc(db, collections.clientErrors, id)).catch(() => {/* best-effort cleanup */});
        }
        return { errors: orderClientErrors(unresolved, resolved, now), truncated };
    }

    /**
     * Mark a client error record as resolved, stamping the resolution time so retention is
     * measured from when it was resolved (not when the error occurred).
     * @param {string} id - Firestore document ID
     */
    async function resolveClientError(id) {
        // clientErrors is admin-only. Wrap in writeWithClaimRetry so a just-re-provisioned admin whose
        // ID token hasn't refreshed self-heals (force-refresh + retry once) instead of a dead Resolve
        // button — parity with every other admin write path.
        await writeWithClaimRetry(() => setDoc(doc(db, collections.clientErrors, id), { resolved: true, resolvedAt: serverTimestamp() }, { merge: true }));
    }

    // ── Anonymous usage analytics ──────────────────────────────────────────────────
    // Aggregate integer counters only — no member identity is ever stored. Page popularity
    // lives in one doc per month (analytics/pv_<YYYY-MM>); active-account counts live in a
    // single analytics/activeAccounts doc. Uniqueness of active accounts is deduped on the
    // client (usage-reporter.js) so these writes only ever carry "+1". All writes are
    // fire-and-forget — usage tracking must never affect the app. Decision math is the pure
    // usage-stats.js module; this is just the Firestore I/O. See ROADMAP_HISTORY.md → "Usage analytics".

    /**
     * Increment the anonymous page-view counter for the current month.
     * @param {string} pageId - stable page id ('calendar', 'admin', 'paycalc', …)
     */
    function recordPageView(pageId) {
        const m = monthKey(new Date());
        setDoc(
            doc(db, collections.analytics, `pv_${m}`),
            { month: m, counts: { [pageId]: increment(1) } },
            { merge: true },
        ).catch(() => {/* best-effort analytics */});
    }

    /**
     * Increment the anonymous active-account counters. The caller (usage-reporter.js) has
     * already decided, from client-side dedup, whether this account is new this month
     * and/or new within the rolling window — pass the bucket key for each that should tick.
     * @param {{ month?: string|null, day?: string|null }} buckets
     */
    function recordActiveAccount({ month = null, day = null } = {}) {
        /** @type {Record<string, any>} */
        const data = {};
        if (month) data.months = { [month]: increment(1) };
        if (day)   data.daily  = { [day]:   increment(1) };
        if (!month && !day) return;
        setDoc(doc(db, collections.analytics, 'activeAccounts'), data, { merge: true })
            .catch(() => {/* best-effort analytics */});
    }

    /**
     * Increment the anonymous per-ADDRESS counters (v19.23) — `analytics/origins` = `{ daily: {…} }`,
     * keyed `YYYY-MM-DD|<origin>` and `YYYY-MM-DD|<origin>|pwa`. Answers "how far through the move off
     * the GitHub Pages mirror are we", which nothing recorded before. No identity: uniqueness is deduped
     * client-side in usage-reporter.js, so the server only ever sees "+1".
     *
     * A SEPARATE DOC from `activeAccounts`, deliberately. That doc's rule pins it to
     * `hasOnly(['months','daily'])` and Firestore evaluates the RESULTING document — so the moment a
     * client wrote an extra key there, the doc would permanently contain it and every later write,
     * including the existing counters, would be denied until the rules deploy caught up. Hosting and
     * rules ship from the same push via separate workflows with no ordering guarantee, so that window is
     * real. Here, a rules lag costs only the new metric.
     *
     * The two counters are gated INDEPENDENTLY by the caller: `countVisit` false with `installed` true
     * is the real case where an account already counted as a visit this window has now opened the
     * installed app for the first time. Incrementing the visit again there would break the "unique
     * accounts" guarantee the whole metric rests on.
     *
     * @param {{ day: string, origin: string, installed?: boolean, countVisit?: boolean }} o
     */
    function recordOriginUse({ day, origin, installed = false, countVisit = true }) {
        if (!day || !origin) return;
        /** @type {Record<string, any>} */
        const daily = {};
        if (countVisit) daily[originKey(day, origin)] = increment(1);
        if (installed)  daily[originKey(day, origin, true)] = increment(1);
        if (!Object.keys(daily).length) return;
        setDoc(doc(db, collections.analytics, 'origins'), { daily }, { merge: true })
            .catch(() => {/* best-effort analytics */});
    }

    /**
     * Increment an anonymous page-load latency counter (Project 0 instrumentation). Lives in one doc per
     * month, `analytics/perf_<YYYY-MM>`, as `{ month, samples: { <key>: int } }`. The key bundles only
     * non-identifying dimensions (app version, page, metric, duration BUCKET, PWA mode, connection class)
     * — never a member or a raw millisecond value. Decision/bucketing maths is the pure perf-stats.js
     * module; this is just the Firestore I/O. Fire-and-forget — telemetry must never affect the app.
     * @param {{ page: string, metric: string, bucket: string, mode: string, conn: string }} sample
     */
    function recordPerfSample({ page, metric, bucket, mode, conn }) {
        if (!bucket) return;
        _perfBatch.add(monthKey(new Date()), perfSampleKey({ version: appVersion, page, metric, bucket, mode, conn }));
    }
    // ONE merged write per open, 1s after its first sample and then at idle — behind the roster's own
    // reads rather than a dozen writes ahead of them (createPerfBatcher). The delay is SHORT on purpose:
    // the pagehide/hidden drain below is only an async setDoc, and on a real unload (a same-tab
    // navigation, which is the common "open, glance, tap to another page") the IndexedDB write queue is
    // torn down with the page, so samples still waiting are LOST, not sent next open. 4s lost exactly
    // those opens and biased the speed figures toward long sessions. A backgrounded PWA resumes the write.
    const _perfBatch = createPerfBatcher((m, counts) => setDoc(doc(db, collections.analytics, `perf_${m}`),
        { month: m, samples: Object.fromEntries(Object.entries(counts).map(([k, n]) => [k, increment(n)])) },
        { merge: true }).catch(() => {/* best-effort analytics */}),
    (flush) => { setTimeout(() => (typeof requestIdleCallback === 'function' ? requestIdleCallback(flush, { timeout: 1000 }) : flush()), 1000); });
    try { addEventListener('pagehide', _perfBatch.flush); document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') _perfBatch.flush(); }); } catch { /* no DOM */ }

    /**
     * Read latency for the Operations "App speed" card (admin-only), for THIS month and LAST month (the
     * comparison window — trend across deploys, and a stable reference early in a month). Each window
     * carries plain-language quick/ok/slow summaries for THREE journeys: `login` (sign-in to usable),
     * `fcp` (a page first appearing on screen), `pages` (the page's CODE finishing — the 'domReady'
     * metric) and `ready` (the page's own content on screen — v20.80). Computed by the pure perf-stats
     * module. No identity is involved.
     * @returns {Promise<{ thisMonth: PerfWindow, lastMonth: PerfWindow }>}
     * @typedef {{ month: string, login: ReturnType<typeof summarisePerf>, fcp: ReturnType<typeof summarisePerf>, pages: ReturnType<typeof summarisePerf>, ready: ReturnType<typeof summarisePerf>, samples: Record<string, number> }} PerfWindow
     */
    async function getPerfStats() {
        const now = new Date();
        const m = monthKey(now);
        const pm = prevMonthKey(now);
        const [thisSnap, lastSnap] = await Promise.all([
            getDoc(doc(db, collections.analytics, `perf_${m}`)),
            getDoc(doc(db, collections.analytics, `perf_${pm}`)),
        ]);
        /** @param {any} snap @param {string} month @returns {PerfWindow} */
        const windowFor = (snap, month) => {
            const samples = (snap.exists() ? /** @type {any} */ (snap.data()) : {}).samples || {};
            return {
                month,
                login: summarisePerf(samples, { metric: 'loginTotal' }),
                fcp:   summarisePerf(samples, { metric: 'fcp' }),
                pages: summarisePerf(samples, { metric: 'domReady' }),
                // 'ready' — the page's content actually on screen (perf-reporter.markPageReady, v20.80).
                // A different population from the three above: only pages that mark it appear here, so
                // its `total` is legitimately smaller and the card says so rather than hiding the bar.
                ready: summarisePerf(samples, { metric: 'ready' }),
                // The RAW map, carried through so the card can break the busiest page down by
                // connection / install mode / version (`summarisePerfBy`). Summarising every dimension
                // here instead would mean deciding in the data layer which page the admin is asking
                // about, and re-reading the document to change that answer. The map is a few hundred
                // small integer counters and is already in memory.
                samples,
            };
        };
        return { thisMonth: windowFor(thisSnap, m), lastMonth: windowFor(lastSnap, pm) };
    }

    /**
     * Read the usage figures for the Operations "Usage" card (admin-only). Also prunes
     * daily buckets outside the retention window, fire-and-forget, so the rolling doc
     * stays bounded (mirrors the resolved-error prune in getClientErrors).
     * @returns {Promise<{ month: string, prevMonth: string, pageCounts: Array<{page: string, count: number}>, prevPageCounts: Array<{page: string, count: number}>, accountsThisMonth: number, accountsLast30: number, monthsHistory: Record<string, number>, origins: Array<{origin: string, accounts: number, installed: number}> }>}
     */
    async function getUsageStats() {
        const now = new Date();
        const m = monthKey(now);
        const pm = prevMonthKey(now);
        const [pvSnap, pvPrevSnap, aaSnap, orgSnap] = await Promise.all([
            getDoc(doc(db, collections.analytics, `pv_${m}`)),
            getDoc(doc(db, collections.analytics, `pv_${pm}`)),
            getDoc(doc(db, collections.analytics, 'activeAccounts')),
            // Missing until the first write after v19.23 — an absent doc is the empty picture, not an error.
            getDoc(doc(db, collections.analytics, 'origins')).catch(() => null),
        ]);
        const pv = pvSnap.exists() ? /** @type {any} */ (pvSnap.data()) : { counts: {} };
        const pvPrev = pvPrevSnap.exists() ? /** @type {any} */ (pvPrevSnap.data()) : { counts: {} };
        const aa = aaSnap.exists() ? /** @type {any} */ (aaSnap.data()) : { months: {}, daily: {} };
        const daily = aa.daily || {};

        // Best-effort prune of daily buckets past the retention window. Wrapped in try/catch
        // and using FieldPath (literal segments) — NOT a `daily.<key>` dotted string. A day key
        // like "2026-06-25" is an INVALID dotted field path (a segment may not start with a digit
        // or contain hyphens), so updateDoc would throw SYNCHRONOUSLY, bypass the `.catch`, and
        // reject getUsageStats — breaking the whole Usage card. The prune must never do that.
        try {
            const stale = staleDailyKeys(daily, now);
            if (stale.length) {
                const ref = doc(db, collections.analytics, 'activeAccounts');
                stale.forEach(k => {
                    updateDoc(ref, new FieldPath('daily', k), deleteField()).catch(() => {/* best-effort */});
                });
            }
        } catch (_e) { /* prune is best-effort — never let it break the usage read */ }

        // Same prune for the per-address counters, on the same terms (FieldPath, never a dotted string —
        // an origin key contains hyphens AND a `|`, so a dotted path would throw synchronously).
        const originDaily = (orgSnap && orgSnap.exists() ? /** @type {any} */ (orgSnap.data()).daily : null) || {};
        try {
            const staleO = staleOriginKeys(originDaily, now);
            if (staleO.length) {
                const ref = doc(db, collections.analytics, 'origins');
                staleO.forEach(k => {
                    updateDoc(ref, new FieldPath('daily', k), deleteField()).catch(() => {/* best-effort */});
                });
            }
        } catch (_e) { /* prune is best-effort */ }

        return {
            month: m,
            prevMonth: pm,
            pageCounts: orderPageCounts(pv.counts || {}),
            prevPageCounts: orderPageCounts(pvPrev.counts || {}),
            accountsThisMonth: Number((aa.months || {})[m]) || 0,
            accountsLast30: sumDailyWindow(daily, now),
            monthsHistory: aa.months || {},
            origins: summariseOrigins(originDaily, now),
        };
    }

    return { logClientError, getClientErrors, resolveClientError, recordPageView, recordActiveAccount,
        recordOriginUse, recordPerfSample, getPerfStats, getUsageStats };
}
