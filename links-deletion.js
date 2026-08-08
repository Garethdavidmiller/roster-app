// @ts-check
/**
 * links-deletion.js — the PURE rules behind "Recently deleted" in the Links workspace (v19.41).
 *
 * A link design used to be deleted outright: any designer could permanently remove any design
 * behind a single confirm, with no archive and no ownership check. That was accepted while the
 * tool had two designers; a third arrived at v19.40 and the agreed trigger to revisit fired.
 *
 * The model is a soft delete: a `deletedAt` timestamp (+ `deletedBy`) on the document. A design
 * carrying one is hidden from the picker and kept until a designer deliberately removes it for
 * good. **Automatic expiry is SUSPENDED** (v19.86) — see `SOFT_DELETE_RETENTION_DAYS`. No DOM, no
 * Firebase — because the two directions of this decision are wildly asymmetric and both need
 * pinning:
 *
 *   · Reading a deleted design as LIVE is a visible nuisance — it reappears in the picker.
 *   · Reading a live design as PURGEABLE destroys someone's work permanently, which is the
 *     exact failure the whole feature exists to prevent.
 *
 * So `isDeleted` and `isPurgeable` are deliberately NOT each other's mirror. They disagree about
 * one specific state, and that disagreement is the point — see `isPurgeable`.
 */

/**
 * How long a deleted design WOULD be recoverable, if anything expired it.
 *
 * ⚠️ **DORMANT — nothing in the app acts on this, and nothing says it to a user** (v19.86 suspended
 * the purge; v19.96 removed the last visible copy that still quoted it). It is kept because a
 * server-time sweep will want the number and the transactional re-check around it, both of which
 * were hard-won. What no client-side check can survive is a device clock running 30 days fast: every
 * recent deletion then looks expired, the re-check agrees with the same wrong clock, and a
 * colleague's design is destroyed.
 *
 * **Do not reconnect it to visible copy until the age comes from the server.** A countdown is a
 * promise, and this one was still being displayed for ten versions after the thing that would have
 * honoured it was switched off.
 */
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
 * Whole days left before a deleted design would be removed for good — null when that can't be
 * known (unresolved timestamp), so a caller can say so rather than invent a number.
 *
 * Rounds UP, so a design with any time left never reads "0 days".
 *
 * ⚠️ **DORMANT, like the constant it reads.** It has no caller in the app: `deletedLabel` stopped
 * using it at v19.96 because nothing expires a design, so the number it returns describes an event
 * that does not occur. Kept for the eventual server-time sweep, and tested so it still works when
 * that arrives.
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
 * Calm and factual per the wording conventions — it states who and when, with no exclamation and
 * no alarm.
 *
 * ⚠️ **IT NO LONGER PROMISES A REMOVAL DATE, AND MUST NOT AGAIN** (v19.96, external review P2).
 * It used to append "· removed for good in N days", which was written when the load-time purge was
 * live. That purge was suspended at v19.86 — no client-side age check survives a device clock
 * running 30 days fast — so from then on the countdown was describing something that does not
 * happen. Worse, it said so **in the same dialog** as the panel's own intro line, which correctly
 * reads "kept here until someone removes it for good. Nothing is deleted automatically". One
 * reader, one screen, two mutually exclusive explanations.
 *
 * The actual behaviour is SAFER than the promise was, which is what makes this a trust problem
 * rather than a data-loss one: nothing is destroyed until a designer chooses "Remove for good". But
 * a designer who believed the countdown might reasonably have hurried, or written the work off.
 *
 * `daysLeft` and `SOFT_DELETE_RETENTION_DAYS` are deliberately kept — see their own notes. They are
 * dormant, and must not drive visible copy again until a SERVER-time sweep exists to make the
 * promise true.
 *
 * @param {any} data - the Firestore document data ({deletedAt, deletedBy})
 * @param {number} nowMs
 * @returns {string}
 */
export function deletedLabel(data, nowMs) {
    const by   = (data?.deletedBy || '').trim();
    const at   = tsMillis(data?.deletedAt);
    const who  = by ? ` by ${by}` : '';
    if (at === null) return `Deleted${who}`;
    const ageDays = Math.floor(Math.max(0, nowMs - at) / DAY_MS);
    const when = ageDays === 0 ? 'today' : ageDays === 1 ? 'yesterday' : `${ageDays} days ago`;
    return `Deleted ${when}${who}`;
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
