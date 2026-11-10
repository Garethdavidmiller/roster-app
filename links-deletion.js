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
 * good. No DOM, no Firebase.
 *
 * ── THE BIN IS PERMANENT, BY DECISION (owner, 19 Sep 2026) ──────────────────────────────────────
 *
 * Automatic expiry was SUSPENDED at v19.86 — no client-side age check survives a device clock
 * running 30 days fast, which makes every recent deletion look expired and destroys a colleague's
 * work. It was then carried as a production exception on the assumption a sweep would arrive.
 *
 * It will not, and the reasoning is better than the plan it replaces: a soft-deleted design is
 * already invisible and restorable, storing it costs almost nothing, and the one thing an automatic
 * purge adds is the ability to destroy a designer's work unattended — the exact failure this
 * feature was built to prevent. Expiry makes nothing here better.
 *
 * So the machinery that existed ONLY to serve the un-built sweep is GONE rather than left dormant:
 * `SOFT_DELETE_RETENTION_DAYS`, `isPurgeable`, `purgeableIds`, `daysLeft`, the unwired
 * `_purgeExpiredDeletions` in links-app.js and the store's `purgeIfExpired`. That follows this
 * repo's own rule, coined about this very constant: *a knob that drives nothing is the
 * `SOFT_DELETE_RETENTION_DAYS` mistake*. Ten months of "dormant, kept for the sweep" is how a
 * countdown came to be shown to designers for ten versions after the thing that would have
 * honoured it was switched off.
 *
 * What remains is what a permanent bin needs: hide it, say who binned it and when, sort it, and one
 * deliberate **Remove for good** with a transactional read-and-delete. If a sweep is ever wanted, git
 * has all of it — and it would be a Cloud Function reading SERVER time, which would not have used the
 * client store's method anyway.
 *
 * **The last saved design CAN be binned** (whole-app fix, Nov 2026 — links-app-23, the lead's decided
 * default). `canSoftDelete` refused it, because an empty list "would empty the picker and drop the
 * user into the 'no designs yet' state". Neither holds any more: the picker always carries the
 * shortlisted proposals (v24.47), and Keep only the shortlist empties the saved list on purpose and
 * opens the first of them — which is what deleting the last design now does too. The refusal had no
 * reason left to give, and its greyed row gave none.
 */

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

/** Local midnight at the start of the day `ms` falls on. @param {number} ms */
const startOfLocalDay = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };

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
 * With the bin now permanent (see the module header), there is no removal date to promise and no
 * constant left to promise it from. This line reports AGE and nothing else.
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
    // CALENDAR days, not elapsed 24-hour periods (test audit, 7 Nov 2026) — the rule `lastSavedLabel`
    // beside it already follows. Counted in 24-hour blocks, a design binned at 23:30 was "Deleted
    // today" at 00:30 the next morning, and one binned at 23:00 two days back read "yesterday".
    // Rounded, because a day across a clock change is 23 or 25 hours long; floored at 0, because a
    // server timestamp can run a little ahead of this device's clock.
    const ageDays = Math.max(0, Math.round((startOfLocalDay(nowMs) - startOfLocalDay(at)) / DAY_MS));
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
 * What a delete FOUND, in a sentence (whole-app fix, Nov 2026). The store's soft delete answers
 * `'deleted'`, `'already-deleted'` (with the binned copy) or `'gone'`, and each tells the designer
 * something different: their own delete; a colleague's, which the line — like the bin row — must
 * attribute to THEM, never to the reader; and a design removed for good, which has no bin row at all.
 * @param {'deleted'|'already-deleted'|'gone'} found @param {string} name @param {any} [deletedData]
 * @returns {string}
 */
export function deleteOutcomeLine(found, name, deletedData) {
    if (found === 'gone') return `“${name}” had already been removed for good.`;
    if (found === 'already-deleted') {
        return `“${name}” is in Recently deleted — ${String(deletedData?.deletedBy ?? '').trim() || 'someone'} had already deleted it.`;
    }
    return `“${name}” is in Recently deleted.`;
}

/**
 * Why a rename did not happen, when its design was no longer live (links-design-5): binned by a
 * colleague — named, and in Recently deleted — or removed for good. Never "check your connection",
 * which no retry could answer.
 * @param {string} name @param {any} deletedData  the binned copy, or null when it was removed for good
 * @returns {string}
 */
export function renameRefusedLine(name, deletedData) {
    return deletedData
        ? `“${name}” was not renamed — ${String(deletedData.deletedBy ?? '').trim() || 'Someone'} deleted it while it was open here. It is in Recently deleted.`
        : `“${name}” was not renamed — it was removed for good while it was open here.`;
}
