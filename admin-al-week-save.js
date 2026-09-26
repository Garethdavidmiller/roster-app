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
//
// ── AND "LEFT ALONE" IS TWO DIFFERENT DAYS (v23.93, external review of v23.92) ──────────────────
//
// A day answered "rest day — free" may already HOLD leave. That is not hypothetical: every
// annual-leave document the week grid wrote onto a rest day before v23.88 is a record with no
// `replacedType` provenance, which `al-swapped-days.js` correctly re-asks about. Answer "free" and
// nothing is written — right, because answering a question is not an instruction to delete, and the
// untick path owns removal — but the document stands, and the Calendar goes on showing 🏖️ AL.
//
// Reported as one list, that day and a genuinely empty one both came back as "no leave recorded",
// so the receipt contradicted the calendar the manager was about to look at. `keptLeave` is the
// subset that still holds leave, so the receipt can say which is which. It is a SUBSET of `skipped`,
// not a replacement for it: every answered-free day is still named, exactly as before.

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
 * @returns {{toSave: any[], skipped: string[], keptLeave: string[], unanswered: string[], overage: any}}
 *   `toSave` is the batch to write — the SAME array when nothing was dropped. `unanswered` are the
 *   rest days whose question has not been answered: they are WITHHELD from the batch and the caller
 *   must refuse the save and name them (see the block beside the filter below). `skipped` are the
 *   dates deliberately left alone, in date order. `keptLeave` is the SUBSET of those that still hold
 *   a leave record afterwards, so the receipt can avoid telling a manager a day is clear when the
 *   Calendar is about to show leave on it. `overage` is the confirmation message, or `null`.
 */
export function planAlWeekSave({ member, memberName, toSave, toDelete = [],
                                ovByDate = null, swapAnswers = null, overrides = [] }) {
    let alInBatch = toSave.filter(e => e.type === 'annual_leave');
    if (!alInBatch.length) return { toSave, skipped: [], keptLeave: [], unanswered: [], overage: null };

    const proj = projectAlBooking({ member, dates: alInBatch.map(e => e.date), ovByDate, swapAnswers });

    /** @type {string[]} */
    let skipped = [];
    /** @type {string[]} */
    let keptLeave = [];
    let batch = toSave;
    if (proj.answeredFree.length) {
        const free = new Set(proj.answeredFree);
        // Only the LEAVE on those dates is dropped. A save can carry more than one row for a date
        // — a Sunday RD correction beside it, say — and none of that was answered "free".
        batch     = toSave.filter(e => !(e.type === 'annual_leave' && free.has(e.date)));
        alInBatch = alInBatch.filter(e => !free.has(e.date));
        skipped   = proj.answeredFree;
        // Which of them the reader will still see leave on. Read from the record in play rather
        // than from the batch: the batch is what this save proposed, and what survives the save is
        // what was already there. A date being DELETED in the same save is not kept.
        keptLeave = skipped.filter(date => {
            const held = ovByDate?.get(date);
            return !!held && held.type === 'annual_leave' && !toDelete.includes(held.id);
        });
    }

    // ── AN UNANSWERED REST DAY IS NEVER WRITTEN ────────────────────────────────────────────────
    //
    // `projectAlBooking`'s own contract says an unanswered day "blocks the save", and this planner
    // computed the set and threw it away: the batch still carried the day and `consuming` did not,
    // so the leave was RECORDED AND COST NOTHING — the exact failure v23.75 exists to prevent, and
    // the one that lost three of a member's days before anybody counted.
    //
    // The coordinator's per-row check is what names the day, and it fires first in every ordinary
    // save. It cannot fire when its input is STALE, and that is reachable rather than theoretical:
    // `row.dataset.alSwapAsk` is written ONCE per row by `renderWeekGrid`, while this reads
    // `buildMemberDateMap` at save time, and the AL/absence range delete deliberately skips the
    // re-render while edits are staged (admin-app.js, v16.82). Deleting an AL that carried
    // `replacedType: 'shift'` from a base rest day turns a not-asked row into an asked one with no
    // question on screen.
    //
    // So the decision lives HERE, beside the projection that makes it, and the surfaces keep the
    // message — which is the whole reason this module exists (see its header: one decision, no
    // second copy to forget). Withholding is the safe direction: a day not recorded is visible and
    // recoverable, leave that costs nothing is neither until somebody counts the year.
    if (proj.unanswered.length) {
        const open = new Set(proj.unanswered);
        batch = batch.filter(e => !(e.type === 'annual_leave' && open.has(e.date)));
    }

    // Existing leave for the year, less the dates this batch OVERWRITES or DELETES — they are
    // re-accounted through `consuming`, or removed outright. Ordering 1 above: computed from the
    // SURVIVING entries, so a day left alone is not counted as one this batch replaces.
    const exclude = new Set([
        ...alInBatch.filter(e => e.existingId).map(e => e.date),
        // …and leave another TYPE overwrites: it is being replaced, not kept (review A16). Non-leave
        // rows are never dropped above, so reading them off `toSave` keeps ordering 1 intact.
        ...toSave.filter(e => e.existingId && e.type !== 'annual_leave').map(e => e.date),
        ...overrides.filter(o => toDelete.includes(o.id) && o.type === 'annual_leave').map(o => o.date),
    ]);

    return {
        toSave: batch,
        skipped,
        keptLeave,
        unanswered: proj.unanswered,
        overage: projectAlOverage({ member, memberName, overrides, consuming: proj.consuming, exclude }),
    };
}
