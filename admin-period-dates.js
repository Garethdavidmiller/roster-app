// @ts-check
/**
 * admin-period-dates.js — what a run of booked dates IS, and what it reads as.
 *
 * Owns: the four pure answers the Recorded-dates lists are built from — step a date (`addDays`),
 *   decide whether a day between two bookings breaks the run (`isRestGap`), and put a date
 *   (`fmtPeriodDate`) or a range (`fmtPeriodRange`) into the words a manager reads.
 * Does NOT own: the list, its year selector, the merge, or any DOM. Those are
 *   `admin-booked-periods.js`, which already takes all four as injected handles.
 * Edit here for: what counts as a gap, or how a period is worded.
 *
 * ── WHY IT IS ITS OWN MODULE (v23.54) ──────────────────────────────────────────────────────────
 *
 * They were nested inside `admin-app.js`'s `init()` — a 1,600-line function on a coordinator with
 * nine lines of ratchet headroom — and were already being passed OUT of it as `isRestGap`,
 * `addDays`, `fmtDate` and `fmtRange`. Code that is handed to another module as a set of named
 * collaborators is that module's neighbour, not the coordinator's private business; the only thing
 * keeping it in a closure was that nobody had moved it. Nothing here touches a DOM, a session or
 * Firestore, so it loads in Node and can finally be tested directly.
 *
 * ── THE RULE WORTH KNOWING: A GAP IS NOT THE SAME AS A DAY OFF ─────────────────────────────────
 *
 * `isRestGap` decides whether two bookings either side of a date are ONE period or two. A Sunday is
 * always a gap — Sundays are uncontracted for every grade, so leave is never recorded on one and a
 * Sunday sitting between two booked weeks did not interrupt anything. A day the member's BASE
 * roster gives them off is a gap for the same reason: they were not due to work it, so it is not a
 * day they came back for. Anything else — including a day whose base shift cannot be resolved,
 * which is what a null member gives — is NOT a gap, so the run is split. Splitting wrongly shows a
 * manager two short periods instead of one; MERGING wrongly claims leave across a day that was
 * worked, which is the direction that misreads the record.
 */

import { DAY_NAMES, MONTH_ABB, getBaseShift, formatISO, isSunday, parseISODate } from './roster-data.js';
import { isRestShift } from './override-utils.js';

/**
 * @param {string} dateStr
 * @param {number} n
 */
export function addDays(dateStr, n) {
    const d = parseISODate(dateStr);
    d.setDate(d.getDate() + n);
    return formatISO(d);
}

/**
 * @param {string} dateStr
 * @param {any} memberObj
 */
export function isRestGap(dateStr, memberObj) {
    if (isSunday(dateStr)) return true; // Sunday — uncontracted
    if (!memberObj) return false;
    const shift = getBaseShift(memberObj, parseISODate(dateStr));
    return isRestShift(shift);
}

/** @param {string} d */
export function fmtPeriodDate(d) {
    const dt = parseISODate(d);
    return `${DAY_NAMES[dt.getDay()]} ${dt.getDate()} ${MONTH_ABB[dt.getMonth()]}`;
}

/**
 * @param {string} start
 * @param {string} end
 */
export function fmtPeriodRange(start, end) {
    const ds = parseISODate(start);
    const de = parseISODate(end  );
    if (ds.getMonth() === de.getMonth()) {
        return `${DAY_NAMES[ds.getDay()]} ${ds.getDate()} – ${DAY_NAMES[de.getDay()]} ${de.getDate()} ${MONTH_ABB[de.getMonth()]}`;
    }
    return `${fmtPeriodDate(start)} – ${fmtPeriodDate(end)}`;
}
