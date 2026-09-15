// @ts-check
// admin-al-week-save.js — what a week-grid save does about the ANNUAL LEAVE in it.
//
// ── WHY THIS IS ITS OWN MODULE ─────────────────────────────────────────────────────────────────
//
// The week grid's Save handler collects rows, validates them, and writes. Everything in that
// sequence is about the DOM — which rows are staged, which turned red, which button to disable —
// except one stretch in the middle, which is a decision about leave: given the rows, the record and
// the admin's swap answers, WHICH leave does this save write, which days does it deliberately leave
// alone, and does the result over-book somebody's year?
//
// That stretch had grown to twenty lines inside a 1,700-line `init()`, behind the session guard and
// the Firestore client, which is to say it could not be run outside a browser and was covered only
// through the page. An external review of v23.89 named it as the extraction due before Admin gains
// any more logic: `admin-app.js` was at 1,694 lines against a 1,700 cap, with `admin-week-editor.js`
// at 950/950 and `admin-overrides.js` at 553/560 beside it. Three cooperating files at their ceiling
// is not a place to add a twenty-first line.
//
// ── THE SPLIT, AND WHERE THE LINE IS ───────────────────────────────────────────────────────────
//
//   `admin-al-projection.js`  what a date MEANS — does it cost a day, is it asked about, is it
//                             written at all. One rule, read by both booking surfaces.
//   THIS MODULE               what one SAVE does with a batch of them — the sequence, in order,
//                             including the two orderings that are easy to get wrong (below).
//   `admin-app.js`            the DOM half that is left: show the confirmation bar, or commit.
//
// So this takes no DOM, no Firestore handle and no module state: the caller passes the member, the
// batch, the override map, this save's answers and the year's records, and gets back the batch to
// write, the days left alone, and the over-entitlement message or `null`.
//
// ── TWO ORDERINGS THAT ARE LOAD-BEARING ────────────────────────────────────────────────────────
//
//   1. THE DROP COMES BEFORE `exclude`. `exclude` names the dates this batch OVERWRITES, so they
//      are not double-counted against the year. A day answered "rest day — free" is not written at
//      all (v23.88), so it overwrites nothing — counting it would hide a day of somebody's existing
//      leave from the entitlement check.
//   2. THE OVERAGE READS THE PROJECTION'S `consuming`, not the batch. The two differ on exactly the
//      case the question was introduced for: a rest day the admin has just declared swapped is not
//      yet a `shift` override anywhere, so anything re-deriving from the stored record would filter
//      it out as REST and let a member with one day left be booked two with no bar (v23.79).
//
// The days it leaves alone are RETURNED rather than dropped, because a save that silently discards a
// staged row is the defect this whole area exists to end — the receipt names them (v23.88).

import { projectAlBooking, projectAlOverage } from './admin-al-projection.js';

/**
 * Decide what a week-grid save writes about annual leave.
 *
 * @param {object} args
 * @param {any} args.member the team-member object; without it nothing can be judged
 * @param {string} args.memberName the name the overage message is written about
 * @param {any[]} args.toSave the batch as collected from the grid — every type, not only leave
 * @param {string[]} [args.toDelete] Firestore ids this save also deletes
 * @param {Map<string, any>|null} [args.ovByDate] the member's overrides in play, keyed by date
 * @param {Map<string, boolean>|null} [args.swapAnswers] THIS SAVE's answers: date → swapped?
 * @param {any[]} [args.overrides] every override on record, for the year's existing leave
 * @returns {{toSave: any[], skipped: string[], overage: any}}
 *   `toSave` is the batch to write — the SAME array when nothing was dropped. `skipped` are the
 *   dates deliberately left alone, in date order. `overage` is the confirmation message, or `null`.
 */
export function planAlWeekSave({ member, memberName, toSave, toDelete = [],
                                ovByDate = null, swapAnswers = null, overrides = [] }) {
    let alInBatch = toSave.filter(e => e.type === 'annual_leave');
    if (!alInBatch.length) return { toSave, skipped: [], overage: null };

    const proj = projectAlBooking({ member, dates: alInBatch.map(e => e.date), ovByDate, swapAnswers });

    /** @type {string[]} */
    let skipped = [];
    let batch = toSave;
    if (proj.answeredFree.length) {
        const free = new Set(proj.answeredFree);
        // Only the LEAVE on those dates is dropped. A save can carry more than one row for a date
        // — a Sunday RD correction beside it, say — and none of that was answered "free".
        batch     = toSave.filter(e => !(e.type === 'annual_leave' && free.has(e.date)));
        alInBatch = alInBatch.filter(e => !free.has(e.date));
        skipped   = proj.answeredFree;
    }

    // Existing leave for the year, less the dates this batch OVERWRITES or DELETES — they are
    // re-accounted through `consuming`, or removed outright. Ordering 1 above: computed from the
    // SURVIVING entries, so a day left alone is not counted as one this batch replaces.
    const exclude = new Set([
        ...alInBatch.filter(e => e.existingId).map(e => e.date),
        ...overrides.filter(o => toDelete.includes(o.id) && o.type === 'annual_leave').map(o => o.date),
    ]);

    return {
        toSave: batch,
        skipped,
        overage: projectAlOverage({ member, memberName, overrides, consuming: proj.consuming, exclude }),
    };
}
