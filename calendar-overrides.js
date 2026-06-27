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

import { db, collection, query, where, getDocs, COLLECTIONS } from './firebase-client.js';
import { getBaseShift, formatISO, isSunday } from './roster-data.js';
import { shouldReplaceOverride, isBeforeMemberStart } from './override-utils.js';

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
    snapshot.forEach((/** @type {any} */ doc) => {
        const data = doc.data();
        if (!data.memberName || !data.date || !data.value) {
            console.error('[Firestore] Skipping malformed override document:', doc.id, data);
            return;
        }
        const key      = `${data.memberName}|${data.date}`;
        const incoming = {
            value:     data.value,
            note:      data.note   || '',
            type:      data.type   || '',
            source:    data.source || null,
            createdAt: data.createdAt || null,
        };
        const existing = rosterOverridesCache.get(key);
        if (existing) {
            console.warn('[Firestore] Duplicate override for', key,
                '— keeping', shouldReplaceOverride(existing, incoming) ? 'incoming' : 'existing',
                { existing, incoming });
        }
        if (shouldReplaceOverride(existing, incoming)) {
            rosterOverridesCache.set(key, incoming);
        }
    });
    // New override data may change which shift types appear in a month.
    shiftTypesMonthCache.clear();
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
        renderFn?.();
    } catch (err) {
        fetchedMonths.delete(key);  // Allow retry on next navigation
        console.error('[Firestore] Failed to fetch overrides for', key, err);
    }
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
        const date    = new Date(year, month, day);
        let shift = getBaseShift(member, date);
        const dateStr = formatISO(date);
        const ov = !isBeforeMemberStart(member, date) ? rosterOverridesCache.get(`${member.name}|${dateStr}`) : null;
        if (ov && !(ov.type === 'sick' && (shift === 'RD' || shift === 'OFF' || isSunday(dateStr)))) {
            shift = ov.type === 'rdw' ? 'RDW' : ov.value;
        }
        if (shift === 'SPARE') types.add('SPARE');
        else if (shift === 'RDW')  types.add('RDW');
        else if (shift === 'AL')   types.add('AL');
        else if (shift === 'SICK') types.add('SICK');
    }

    shiftTypesMonthCache.set(cacheKey, types);
    return types;
}
