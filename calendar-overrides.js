// @ts-check
/**
 * calendar-overrides.js — Firestore override cache for index.html.
 *
 * Owns: rosterOverridesCache, fetchedMonths, shiftTypesMonthCache,
 *   _initialFetchInProgress, monthKey, fetchOverridesForRange,
 *   ensureOverridesCached, getShiftTypesInMonth.
 * Does NOT own: rendering (calendar-app.js / calendar-renderer.js),
 *   member selection (calendar-member.js).
 * Edit here for: Firestore override query, cache invalidation, duplicate resolution.
 */

import { db, collection, query, where, getDocs, getDocsFromCache, COLLECTIONS } from './firebase-client.js';
import { getBaseShift, formatISO, isSunday } from './roster-data.js';
import { reconcileRangeIntoCache, collectOverrideRecords, isBeforeMemberStart, isOtherValue, resolveEffectiveShift } from './override-utils.js';

// Cache keyed "memberName|YYYY-MM-DD".
export const rosterOverridesCache = new Map();

const fetchedMonths        = new Set();
// Memoised getShiftTypesInMonth() results. Key: "memberName|year|month".
// Cleared whenever fetchOverridesForRange() writes new data into rosterOverridesCache.
const shiftTypesMonthCache = new Map();

// Guards against ensureOverridesCached() triggering a competing fetch while
// the initial 3-month load is already in flight. Set via setInitialFetchInProgress().
export let _initialFetchInProgress = false;

/** @param {boolean} v */
export function setInitialFetchInProgress(v) { _initialFetchInProgress = v; }

/**
 * Pre-claim a set of months as fetched before awaiting — used by the coordinator's
 * initial 3-month fetch IIFE to prevent redundant concurrent fetches.
 * @param {string[]} keys
 */
export function addFetchedMonths(keys) { keys.forEach(k => fetchedMonths.add(k)); }

/**
 * Remove a month from the fetched set so it can be retried on the next render.
 * @param {string} key
 */
export function clearFetchedMonth(key) { fetchedMonths.delete(key); }

// The month → shift-types memo used to have a public clearShiftTypesCache() for callers that wrote
// straight into rosterOverridesCache. There are none left: Team Week View was the only one, and it
// went through the shared month fetch at v18.76, so every writer is now fetchOverridesForRange —
// which clears the memo itself (below). The export was removed at v18.84 rather than left as an
// invitation to re-introduce a second cache writer. If one is ever genuinely needed, clear
// shiftTypesMonthCache in the same place you write the cache, or the month legend serves a stale
// type set (an AL cell shows on the grid while the "Annual Leave" legend item stays hidden).

/**
 * @param {number} year
 * @param {number} month - 0-indexed
 * @returns {string}
 */
export function monthKey(year, month) {
    return `${year}-${String(month + 1).padStart(2, '0')}`;
}

/**
 * Query Firestore for all override documents in a date range and populate the cache.
 * Documents with missing required fields are skipped and logged.
 * @param {string} startStr - 'YYYY-MM-DD' inclusive start
 * @param {string} endStr   - 'YYYY-MM-DD' inclusive end
 */
export async function fetchOverridesForRange(startStr, endStr) {
    const q = query(
        collection(db, COLLECTIONS.overrides),
        where('date', '>=', startStr),
        where('date', '<=', endStr)
    );
    const snapshot = await getDocs(q);
    if (snapshot.size >= 1900) console.warn('[Firestore] Override query returned', snapshot.size, 'docs — approaching practical limit. Consider archiving old overrides.');
    // Collect the validated snapshot rows (shared collector — see override-utils.collectOverrideRecords),
    // then RECONCILE authoritatively (v16.96): the range query is the single source of truth for
    // [startStr, endStr], so the winner for each date is rebuilt from THIS snapshot alone
    // (reconcileRangeIntoCache), never merged against the possibly-stale cache. The old per-doc merge
    // kept a deleted higher-priority manual alive when only a lower-priority import remained (the import
    // couldn't out-rank the cached manual, yet the key WAS seen so the deletion pass skipped it —
    // Finding #1). Dates outside the queried range are untouched; the team-view week fetch reconciles
    // independently (calendar-team-view.js), through the same collector.
    const records = collectOverrideRecords(snapshot);
    reconcileRangeIntoCache(rosterOverridesCache, records, startStr, endStr);
    // New override data may change which shift types appear in a month.
    shiftTypesMonthCache.clear();
}

/**
 * Paint from the LOCAL Firestore cache only — no network, no auth, no rule evaluation (rules are
 * evaluated server-side, so a cache hit is never gated). This is phase 1 of the calendar's two-phase
 * initial load (AUTH_PLAN.md → E1): it lets the roster appear instantly on a returning device, and
 * keeps appearing once reads require a session, WITHOUT putting a `signInAnonymously` round-trip in
 * front of data the device already holds.
 *
 * **Merged additively — never authoritative.** A cache snapshot is a possibly-stale SUBSET, so an
 * absent key is not a delete. Only the server read (`fetchOverridesForRange`) may evict. See the
 * `authoritative` note on `reconcileRangeIntoCache`.
 *
 * Never throws: a cache miss (first visit, evicted IndexedDB) is the normal empty state, not a
 * failure, and must never reach the sync chip's error path.
 *
 * @param {string} startStr - 'YYYY-MM-DD' inclusive start
 * @param {string} endStr   - 'YYYY-MM-DD' inclusive end
 * @returns {Promise<boolean>} true if the cache produced anything that changed the display
 */
export async function fetchOverridesForRangeFromCache(startStr, endStr) {
    try {
        const q = query(
            collection(db, COLLECTIONS.overrides),
            where('date', '>=', startStr),
            where('date', '<=', endStr)
        );
        const snapshot = await getDocsFromCache(q);
        if (snapshot.empty) return false;
        const records = collectOverrideRecords(snapshot);
        const changed = reconcileRangeIntoCache(rosterOverridesCache, records, startStr, endStr,
            { authoritative: false });
        if (changed) shiftTypesMonthCache.clear();
        return changed;
    } catch {
        return false;   // no cache yet / storage unavailable — phase 2 does the real work
    }
}

/**
 * Ensure overrides for a given month are in the cache.
 * No-op if already fetched. Fires a background fetch and calls renderFn() on success.
 * The renderFn callback is provided by the coordinator and includes any guards (e.g.
 * team-view check, member-change check) appropriate to the call site.
 * @param {number} year
 * @param {number} month - 0-indexed
 * @param {Function} [renderFn]
 */
export async function ensureOverridesCached(year, month, renderFn) {
    const key = monthKey(year, month);
    if (fetchedMonths.has(key)) return;
    fetchedMonths.add(key);
    try {
        const startStr = formatISO(new Date(year, month, 1));
        const endStr   = formatISO(new Date(year, month + 1, 0));
        await fetchOverridesForRange(startStr, endStr);
    } catch (err) {
        fetchedMonths.delete(key);  // Allow retry on next navigation
        console.error('[Firestore] Failed to fetch overrides for', key, err);
        return;
    }
    // The render is deliberately OUTSIDE the try (v18.91). The fetch succeeded by this point and the
    // cache holds the new data; if the callback then throws mid-DOM-rebuild, treating that as a fetch
    // failure would log the wrong cause AND un-mark the month, so the next navigation re-queries data
    // that is already cached. v18.76 raised the stakes by making a full Team-View grid rebuild one of
    // these callbacks. A render fault is the caller's to handle — it must not corrupt fetch state.
    renderFn?.();
}

/**
 * Returns a Set of shift-type strings that actually appear in the given month
 * for the given member, after applying roster pattern + Firestore overrides.
 * Used by updateLegend() to show/hide Spare, RDW, AL, and Absent legend items.
 * Result is memoised; cache cleared by fetchOverridesForRange() on new data.
 * @param {any} member
 * @param {number} year
 * @param {number} month - 0-indexed
 * @returns {Set<string>}
 */
export function getShiftTypesInMonth(member, year, month) {
    const cacheKey = `${member.name}|${year}|${month}`;
    if (shiftTypesMonthCache.has(cacheKey)) return shiftTypesMonthCache.get(cacheKey);

    const types = new Set();
    const days  = new Date(year, month + 1, 0).getDate();

    for (let day = 1; day <= days; day++) {
        const date      = new Date(year, month, day);
        const baseShift = getBaseShift(member, date);
        const dateStr   = formatISO(date);
        const ov = !isBeforeMemberStart(member, date) ? rosterOverridesCache.get(`${member.name}|${dateStr}`) : null;
        // Same shared override→effective-shift ladder as the calendar renderer + Team view (v16.48)
        // so the month legend can never drift from them — e.g. it can't light 'AL' from a legacy
        // Sunday AL override (suppressed), since Sundays are non-contracted (CLAUDE.md layer 5).
        const { shift } = resolveEffectiveShift(ov, baseShift, isSunday(dateStr));
        if (shift === 'SPARE') types.add('SPARE');
        else if (shift === 'RDW')  types.add('RDW');
        else if (shift === 'AL')   types.add('AL');
        else if (shift === 'SICK') types.add('SICK');
        else if (isOtherValue(shift)) types.add('OTHER');
    }

    shiftTypesMonthCache.set(cacheKey, types);
    return types;
}
