// @ts-check
/**
 * override-compare.js — is the server's copy of a day still the record this page showed? (v25.89)
 *
 * One answer, because two editors work the same days: a manager and the admin can both have Admin
 * open on one member's week. Every guarded Admin write — a delete from Saved Changes or a booked
 * period, a leave-year move, and since v25.90 every ordinary save of a day (`commitChecked`) — reads
 * the day inside its transaction (`commitIfUnchanged`, admin-override-store.js) and asks this before
 * it deletes or rewrites it. Pure: no DOM, no Firebase.
 *
 * Its own module because it is the RULE those writes share — what counts as "changed since you
 * looked" — and a rule wants one home and a test of its own (override-utils.test.mjs →
 * `sameOverrideRecord`), not a place in a store module that only Node module mocks can load.
 */

import { tsToMillis } from './override-utils.js';

/**
 * Is `now` — a record as the SERVER holds it — still the record `was`, as this page showed it?
 *
 * Until v25.89 the check compared only `value`, `type` and `memberName`, so a January leave day moved
 * to the other year's allowance — the same AL, the same value — compared equal and could be deleted
 * or rewritten over (external review, Nov 2026). Now everything that says what the day is, what it
 * cost, or who wrote it counts:
 *
 * - `memberName`, `date`, `type`, `value`, `note`, `source`, `replacedType` and `leaveYear`, an absent
 *   field equal to an empty one (the writes leave `replacedType` and `leaveYear` out rather than null);
 * - `createdAt`, the revision: every write stamps it afresh (`buildOverrideWrite`), so a colleague who
 *   re-saved the same values still made a different record. EXCEPT on this page's own optimistic copy
 *   of a write it made (`buildOverrideCacheRecord`), whose stamp is the device's clock and can never
 *   equal the server's — that copy is matched on its fields alone;
 * - `changedBy`, where the page has one (its own copies do not).
 *
 * Fails toward "changed": a guarded write refused for a difference that did not matter costs a
 * reload, one let through over a difference that did destroys a colleague's edit.
 * @param {any} was the record as this page showed it
 * @param {any} now the record as the server holds it
 * @returns {boolean}
 */
export function sameOverrideRecord(was, now) {
    if (!was || !now) return false;
    const opt = (/** @type {any} */ v) => v ?? null;
    for (const k of ['memberName', 'date', 'type', 'value']) if (was[k] !== now[k]) return false;
    if ((was.note ?? '') !== (now.note ?? '')) return false;
    for (const k of ['source', 'replacedType', 'leaveYear']) if (opt(was[k]) !== opt(now[k])) return false;
    /** @param {any} t */
    const stamp = (t) => (typeof t === 'number' ? t : tsToMillis(t));
    if (!(was.createdAt instanceof Date) && stamp(was.createdAt) !== stamp(now.createdAt)) return false;
    if ('changedBy' in was && was.changedBy !== now.changedBy) return false;
    return true;
}
