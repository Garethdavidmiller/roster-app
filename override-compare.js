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

/** A record's revision in milliseconds: a Firestore Timestamp, or the number the browser-test stub
 *  hands back, read the same way wherever a revision is compared. @param {any} t @returns {number} */
const stampOf = (t) => (typeof t === 'number' ? t : tsToMillis(t));

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
    if (!(was.createdAt instanceof Date) && stampOf(was.createdAt) !== stampOf(now.createdAt)) return false;
    if ('changedBy' in was && was.changedBy !== now.changedBy) return false;
    return true;
}

/**
 * A saved record as an unsaved-work draft keeps it (unsaved-draft.js rule 5): every field
 * `sameOverrideRecord` reads, plus the id, in a shape that survives localStorage's JSON — the
 * revision (`createdAt`) as milliseconds, and this page's own optimistic copy marked `own` instead,
 * because its stamp is the device's clock and is never compared. Null for a day with no record.
 *
 * Until v26.08 a draft kept only `id|type|value`, so a day whose leave year, note, source or
 * revision had changed since read as the record the row was edited over, and the old edit was put
 * back over it with no "changed since" (external review, 14 Nov 2026). And the save after a Restore
 * cannot catch it: it compares with what the restored row now SHOWS, the newer record.
 * @param {any} rec
 * @returns {Record<string, any>|null}
 */
export function keptRecord(rec) {
    if (!rec) return null;
    const own = rec.createdAt instanceof Date;
    /** @type {Record<string, any>} */
    const kept = { id: rec.id, memberName: rec.memberName, date: rec.date, type: rec.type, value: rec.value,
        note: rec.note ?? '', source: rec.source ?? null, replacedType: rec.replacedType ?? null,
        leaveYear: rec.leaveYear ?? null, createdAt: own ? null : stampOf(rec.createdAt), own };
    if ('changedBy' in rec) kept.changedBy = rec.changedBy ?? null;
    return kept;
}

/**
 * Is the record a day holds NOW still the one a draft kept (`keptRecord`)? A day with no record then
 * and none now is unchanged; a record that came or went is a change. Otherwise the same id and
 * `sameOverrideRecord`'s rule — one rule for "changed since you looked", whether a save asks it or a
 * restore does. Fails toward "changed", as that rule does.
 * @param {Record<string, any>|null|undefined} kept  as read back from storage
 * @param {any} now
 * @returns {boolean}
 */
export function sameKeptRecord(kept, now) {
    if (!kept || !now) return !kept && !now;
    if ((kept.id ?? null) !== (now.id ?? null)) return false;
    const { own, ...was } = kept;
    // An own copy compares on its fields alone: `sameOverrideRecord` skips the stamp of a `Date`.
    return sameOverrideRecord(own ? { ...was, createdAt: new Date(0) } : was, now);
}

/**
 * One override as this page HOLDS it, from a document read outside a transaction — Admin's lists
 * (`loadOverrides`) and the roster import's week (`fetchOverridesForWeek`).
 *
 * A document this device has written but not yet sent (`metadata.hasPendingWrites`) has no server
 * stamp yet: the SDK reads a pending `serverTimestamp()` as null. Read like that, it could never
 * match the server's copy once the save landed, so the page's OWN record was refused as "someone else
 * has changed this" — found by the signed-in lane on the real SDK (v25.96), where a list read just
 * after the signal returned held a save still in this device's queue. It IS this page's own copy, so
 * it is stamped like one (`buildOverrideCacheRecord`): a `Date`, the SDK's estimate of when it was
 * written, which `sameOverrideRecord` matches on its fields alone and `tsToMillis` ranks as the newest.
 * A settled document, or one whose stamp is already the server's, is returned as it was read.
 * @param {{ id: string, data: (options?: any) => any, metadata?: { hasPendingWrites?: boolean } }} d
 * @returns {any}
 */
export function overrideFromSnapshot(d) {
    const data = d.data();
    if (!d.metadata?.hasPendingWrites || data?.createdAt != null) return { id: d.id, ...data };
    const estimate = d.data({ serverTimestamps: 'estimate' })?.createdAt;
    return { id: d.id, ...data, createdAt: typeof estimate?.toDate === 'function' ? estimate.toDate() : new Date() };
}
