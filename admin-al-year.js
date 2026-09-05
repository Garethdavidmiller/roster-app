// @ts-check
// admin-al-year.js — WHICH YEAR the Annual Leave figures on admin.html describe.
//
// An entitlement is per YEAR, so the banner above the AL card ("32 entitlement · 26 taken ·
// 2 remaining") has to pick one — and the Admin page implies a year in four different places at
// once. This module owns the PRECEDENCE between them and nothing else: no DOM, no Firebase, no
// imports, so the ordering can be tested without a page.
//
// It is its own module rather than four lines inside `updateALBanner` because the ORDER is the
// whole rule and the ordering is what broke. Reported by the owner at v22.82: a manager scrolled
// the range picker to February 2027 and the banner still read 2026 — taken 26, remaining 2 — so
// next year's untouched 32 days looked almost spent. The SAVE path was never wrong (it reads the
// dates actually picked, in `admin-al.js`), which is exactly what makes this class of defect quiet:
// nothing is written incorrectly, and a manager refusing a leave request does it from the number on
// screen, not from the save.
//
// Two rungs are easy to "tidy" and must not be:
//   · A PICKED START DATE outranks the displayed month. It is a statement of what is being booked;
//     the displayed month is only where the reader's eye is. Someone who has picked 20 Dec 2026 and
//     then scrolled forward to look at January is still booking December.
//   · The picker's view outranks the Change a Shift week, and only once the picker has genuinely
//     CROSSED a year. That is why `pickerViewYear` is null rather than "whatever the picker is
//     showing": passing the picker's year unconditionally would let it win the moment the page
//     loaded, taking every case the Change a Shift week has owned since v16.21 — including the one
//     that matters most, a manager who arrived on this card from a week they were already editing.

/**
 * Decide which calendar year the AL figures should be computed for.
 *
 * @param {object} inputs
 * @param {string|null|undefined} inputs.pickedFrom  The AL range's START date, `YYYY-MM-DD`, or
 *   empty/null when no range has been picked.
 * @param {number|null|undefined} inputs.pickerViewYear  The year the range picker is DISPLAYING,
 *   but ONLY once it has been moved across a year boundary — null until then.
 * @param {string|null|undefined} inputs.shiftDate  The date open on the Change a Shift card,
 *   `YYYY-MM-DD`, or empty/null.
 * @param {Date} inputs.today  Today, injected so the last rung is testable.
 * @returns {string} A four-character year, e.g. `'2027'`.
 */
export function alFigureYear({ pickedFrom, pickerViewYear, shiftDate, today }) {
    if (pickedFrom) return String(pickedFrom).substring(0, 4);
    // `!= null` rather than a truthiness test states the intent — null means "the picker has not
    // moved", not "the picker is showing year zero". It is a SHAPE guard and nothing more: no
    // reachable input distinguishes the two, because the only caller passes a year off a real Date
    // between MIN_YEAR and MAX_YEAR. Mutating it to `if (pickerViewYear)` leaves the whole suite
    // green, and that is recorded here rather than papered over with a test for year 0 — a case
    // that cannot occur, asserted to make a number go up.
    if (pickerViewYear != null) return String(pickerViewYear);
    if (shiftDate) return String(shiftDate).substring(0, 4);
    return String(today.getFullYear());
}
