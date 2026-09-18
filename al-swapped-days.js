// @ts-check
// al-swapped-days.js — which days in an AL booking need the SWAP question, and what to write.
//
// ── THE PROBLEM THIS EXISTS FOR ────────────────────────────────────────────────────────────────
//
// Annual leave on a day the base roster calls REST does not consume entitlement, and that is right:
// it stops a stray booking (M. Robson's 5 Dec) and a declined overtime day from costing somebody a
// day they never spent. But there is one case where such a day IS real leave — the member SWAPPED
// working days and then booked the swapped-in day off — and the app's only record of it is
// `replacedType: 'shift'` on the AL doc, which until now could be set ONLY as a side effect of
// writing AL over an existing `shift` override.
//
// So the answer existed and the question was never asked. Both booking paths decided it silently and
// in opposite directions: the AL range card SKIPPED rest days without writing anything, and the week
// grid WROTE the AL but left it costing nothing. Neither said so. The balance was simply wrong
// afterwards, and the only way to find out was to compare against the depot's workbook by hand —
// which is how this surfaced (owner, 14 Sep 2026: three days of C. Francisco-Charles's leave,
// invisible in the app, found only because the workbook disagreed by three).
//
// The fix is not a better default. There is no correct default: only the person booking knows
// whether a swap happened, and they know it at the moment they book. So the app ASKS, and the two
// rules the owner set are both about not being annoying with it:
//
//   1. **Ask only when a day is actually affected.** No rest days in the booking, no question.
//   2. **A question that appears must be ANSWERED** — no default, the save waits. A default is how
//      this went wrong in the first place; a silent default that happens to be visible is still
//      silent.
//
// ── WHY "REST DAY" IS NOT THE WHOLE TEST ───────────────────────────────────────────────────────
//
// The question is only meaningful when the BASE ROSTER is what makes the day free. A day carrying an
// `rdw` override is voluntary work, and declining it is not leave (`VOLUNTARY_WORK_TYPES`) — asking
// "were you swapped onto this?" there would invite an admin to charge somebody for giving back
// overtime. A day carrying a `shift` override is already contracted and already counts, so there is
// nothing to ask. Sundays are uncontracted for every grade and cannot hold AL at all.
//
// So the question is asked on exactly the days where `consumesEntitlement` would fall through to the
// base roster AND find a rest day — which is the same condition, read from the same helpers, so the
// two can never drift apart.
//
// ── BOTH SURFACES ASK THIS, AND THEY DID NOT ALWAYS ────────────────────────────────────────────
//
// The week grid used to decide for itself, on `baseIsRd` alone: "the base roster says rest, so ask".
// That re-asks a question an existing `replacedType: 'shift'` has already answered — and worse, the
// answer could not take effect, because `replacedTypeForSwap` rightly keeps a stronger record than
// its own reconstruction, so a manager choosing "Rest day — free" there changed nothing. The range
// card, reading this function, never asked in the first place.
//
// Since v23.79 the grid sets `row.dataset.alSwapAsk` from `swapDecisionDates` for its one date, so
// both surfaces ask about the same days for the same reason. A UI that offers a choice it cannot
// honour is worse than one that does not offer it. (External review of v23.78.)

import { isSunday, getBaseShift, parseISODate } from './roster-data.js';
import { isRestShift, isContractedWorkOverride, nextReplacedType } from './override-utils.js';

/**
 * The dates in a booking that need the swap question, in order.
 *
 * @param {object} args
 * @param {string[]} args.dates every date the booking covers, ISO `YYYY-MM-DD`
 * @param {any} args.memberObj the team-member object — without it nothing can be judged, so nothing
 *        is asked (the caller has no member selected and cannot save either)
 * @param {Map<string, any>|null} [args.ovByDate] the overrides in play, keyed by date. **Pass it.**
 *        Omitting it makes an already-swapped day look like a rest day and re-asks a settled
 *        question — the same trap `consumesEntitlement` documents on its own signature.
 * @returns {string[]} ISO dates, ascending
 */
export function swapDecisionDates({ dates, memberObj, ovByDate = null }) {
    if (!memberObj || !Array.isArray(dates)) return [];
    return [...new Set(dates)].sort().filter(date => {
        if (isSunday(date)) return false;                     // never holds AL at all
        const ov = ovByDate && typeof ovByDate.get === 'function' ? ovByDate.get(date) : null;
        const under = ov && ov.type === 'annual_leave'
            ? (ov.replacedType ? { type: ov.replacedType } : null)
            : ov;
        // An override that answers the contract question — either way — settles the day.
        if (isContractedWorkOverride(under) !== null) return false;
        // Nothing informative on the day: the base roster decides, and only a REST answer is a question.
        return isRestShift(getBaseShift(memberObj, parseISODate(date)));
    });
}

/**
 * What `replacedType` to write for a day the admin has declared a SWAPPED working day.
 *
 * Normally `replacedType` carries forward whatever the write replaced. Here there is usually nothing
 * to carry — the day held no override, or held one that says nothing about the contract — and the
 * whole point is to record that the member WAS contracted. So it falls back to `'shift'`, which is
 * the type a swapped-in day would have had if anybody had recorded the swap.
 *
 * An existing chain that already names contracted work is kept rather than overwritten: it is a
 * stronger record than our reconstruction, and it may name `spare_shift` or `other`, which this must
 * not flatten.
 *
 * @param {any} existing the override currently on the date, if any
 * @param {string} newType the type being written (`annual_leave`)
 * @returns {string} a member of the `replacedType` vocabulary the Firestore rules allow
 */
export function replacedTypeForSwap(existing, newType) {
    const carried = nextReplacedType(existing, newType);
    if (carried && isContractedWorkOverride({ type: carried }) === true) return carried;
    return 'shift';
}
