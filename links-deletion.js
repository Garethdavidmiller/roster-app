// @ts-check
/**
 * links-deletion.js — the PURE rules behind "Recently deleted" in the Links workspace (v19.41).
 *
 * A link design used to be deleted outright: any designer could permanently remove any design
 * behind a single confirm, with no archive and no ownership check. That was accepted while the
 * tool had two designers; a third arrived at v19.40 and the agreed trigger to revisit fired.
 *
 * The model is a soft delete: a `deletedAt` timestamp (+ `deletedBy`) on the document. A design
 * carrying one is hidden from the picker, kept for SOFT_DELETE_RETENTION_DAYS, and then removed
 * for good. No DOM, no Firebase — because the two directions of this decision are wildly
 * asymmetric and both need pinning:
 *
 *   · Reading a deleted design as LIVE is a visible nuisance — it reappears in the picker.
 *   · Reading a live design as PURGEABLE destroys someone's work permanently, which is the
 *     exact failure the whole feature exists to prevent.
 *
 * So `isDeleted` and `isPurgeable` are deliberately NOT each other's mirror. They disagree about
 * one specific state, and that disagreement is the point — see `isPurgeable`.
 */

/** How long a deleted design is recoverable before it is removed for good. */
export const SOFT_DELETE_RETENTION_DAYS = 30;

const DAY_MS = 86_400_000;

/**
 * Millis from a Firestore Timestamp, or null when there isn't one yet.
 *
 * A `serverTimestamp()` write reads back as **null on the writing device** until the server
 * resolves it, so "the field is there but has no value" is a normal, expected state — not
 * corruption.
 *
 * @param {any} ts
 * @returns {number|null}
 */
export function tsMillis(ts) {
    const ms = ts?.toMillis?.();
    return typeof ms === 'number' && Number.isFinite(ms) ? ms : null;
}

/**
 * Is this design in the bin?
 *
 * Tests for the PRESENCE of the key, not for a usable timestamp. Immediately after a delete the
 * writer's own snapshot carries `deletedAt: null` (unresolved server timestamp) — requiring a
 * number here would leave the design sitting in the picker on the device that just deleted it,
 * until a server round trip it may not get while offline.
 *
 * Restore clears the field entirely (`deleteField()`), so an absent key is unambiguous.
 *
 * @param {any} data - the Firestore document data
 * @returns {boolean}
 */
export function isDeleted(data) {
    return !!data
        && Object.prototype.hasOwnProperty.call(data, 'deletedAt')
        && data.deletedAt !== undefined;
}

/**
 * Has this deletion aged out of the recovery window?
 *
 * Fails CLOSED — every uncertain state answers "no, keep it":
 *  · no `deletedAt` at all → not even deleted, let alone purgeable;
 *  · `deletedAt` present but UNRESOLVED (null) → age unknown, and unknown age must never read as
 *    expired. This is where it deliberately parts company with `isDeleted`, which counts the same
 *    state as deleted: hiding a design you cannot date is free, destroying it is not;
 *  · a FUTURE `deletedAt` → the device clock is wrong (the purge runs on the client, like every
 *    other prune in this app, so it is only ever as trustworthy as `Date.now()`). Treating a
 *    future date as very old would purge the entire bin on a machine whose clock has jumped.
 *
 * @param {any} data - the Firestore document data
 * @param {number} nowMs
 * @param {number} [retentionDays=SOFT_DELETE_RETENTION_DAYS]
 * @returns {boolean}
 */
export function isPurgeable(data, nowMs, retentionDays = SOFT_DELETE_RETENTION_DAYS) {
    if (!isDeleted(data)) return false;
    const at = tsMillis(data?.deletedAt);
    if (at === null) return false;
    const age = nowMs - at;
    if (age < 0) return false;
    return age > retentionDays * DAY_MS;
}

/**
 * Which of these deleted designs are due to be removed for good?
 *
 * @param {Array<{id: any, deletedAt?: any}>} entries
 * @param {number} nowMs
 * @param {number} [retentionDays=SOFT_DELETE_RETENTION_DAYS]
 * @returns {any[]} ids
 */
export function purgeableIds(entries, nowMs, retentionDays = SOFT_DELETE_RETENTION_DAYS) {
    return (entries || []).filter(e => isPurgeable(e, nowMs, retentionDays)).map(e => e.id);
}

/**
 * Whole days left before a deleted design is removed for good — null when that can't be known
 * (unresolved timestamp), so the UI can say so rather than invent a number.
 *
 * Rounds UP, so a design with any time left never reads "0 days".
 *
 * @param {any} data
 * @param {number} nowMs
 * @param {number} [retentionDays=SOFT_DELETE_RETENTION_DAYS]
 * @returns {number|null}
 */
export function daysLeft(data, nowMs, retentionDays = SOFT_DELETE_RETENTION_DAYS) {
    const at = tsMillis(data?.deletedAt);
    if (at === null) return null;
    const left = (at + retentionDays * DAY_MS) - nowMs;
    return left <= 0 ? 0 : Math.ceil(left / DAY_MS);
}

/**
 * The staff-facing line under a deleted design's name.
 *
 * Calm and factual per the wording conventions — it states who and when, and how long is left,
 * with no exclamation and no alarm.
 *
 * @param {any} data - the Firestore document data ({deletedAt, deletedBy})
 * @param {number} nowMs
 * @param {number} [retentionDays=SOFT_DELETE_RETENTION_DAYS]
 * @returns {string}
 */
export function deletedLabel(data, nowMs, retentionDays = SOFT_DELETE_RETENTION_DAYS) {
    const by   = (data?.deletedBy || '').trim();
    const at   = tsMillis(data?.deletedAt);
    const who  = by ? ` by ${by}` : '';
    if (at === null) return `Deleted${who}`;
    const ageDays = Math.floor(Math.max(0, nowMs - at) / DAY_MS);
    const when = ageDays === 0 ? 'today' : ageDays === 1 ? 'yesterday' : `${ageDays} days ago`;
    const left = daysLeft(data, nowMs, retentionDays);
    const tail = left === null ? ''
        : left === 0 ? ' · removed for good today'
        : left === 1 ? ' · removed for good tomorrow'
        : ` · removed for good in ${left} days`;
    return `Deleted ${when}${who}${tail}`;
}

/**
 * Order the bin: most recently deleted first.
 *
 * An UNRESOLVED `deletedAt` sorts to the TOP — it is, by definition, the deletion that just
 * happened on this device. Note the two-null case is returned explicitly rather than falling out
 * of the arithmetic: `Infinity - Infinity` is `NaN`, and a comparator that returns NaN produces an
 * implementation-defined order rather than an error, so it would misbehave silently.
 *
 * Returns a NEW array — the caller's input is not reordered in place.
 *
 * @template {{deletedAt?: any}} T
 * @param {T[]} entries
 * @returns {T[]}
 */
export function sortByDeleted(entries) {
    return (entries || []).slice().sort((a, b) => {
        const ka = tsMillis(a?.deletedAt);
        const kb = tsMillis(b?.deletedAt);
        if (ka === null && kb === null) return 0;
        if (ka === null) return -1;
        if (kb === null) return 1;
        return kb - ka;
    });
}

/**
 * May a design be deleted at all?
 *
 * The workspace must always keep one LIVE design — deleting the last one would empty the picker
 * and drop the user into the "no designs yet" state, from which the only way back is the
 * generator. Counts live designs only: a bin with ten designs in it does not make the last
 * remaining design disposable.
 *
 * @param {number} liveCount
 * @returns {boolean}
 */
export function canSoftDelete(liveCount) {
    return liveCount > 1;
}
