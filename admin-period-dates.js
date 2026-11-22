// @ts-check
/**
 * admin-period-dates.js — what a run of booked dates IS, and what it reads as.
 *
 * Owns: the four pure answers the Recorded-dates lists are built from — step a date (`addDays`),
 *   decide whether a day between two bookings breaks the run (`isRestGap`), and put a date
 *   (`fmtPeriodDate`) or a range (`fmtPeriodRange`) into the words a manager reads — and, since
 *   v25.90, name the days a refused save found changed (`namedDays`), in the same words.
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
 * day they came back for — UNLESS A RECORD SHOWS THEY DID (review, Nov 2026): Rest Day Working, a shift
 * swapped onto it, a Spare turn or an Other day is a day they came back for — somebody at work, which is
 * the question `WORKED_OVERRIDE_TYPES` answers — and two runs of leave either side of it are two
 * bookings. Asked of the member's records in play (`ovByDate`); without them, the base roster alone —
 * which is how the ✕ asks, on purpose: its reach and its edge Sunday walk the days the booking itself
 * spanned, whatever has been recorded on them since (admin-booked-periods.js, `computePeriodDeleteIds`).
 * Anything else — including a day whose base shift cannot be resolved, which is what a null member
 * gives — is NOT a gap, so the run is split. Splitting wrongly shows a manager two short periods
 * instead of one; MERGING wrongly claims leave across a day that was worked, which is the direction
 * that misreads the record.
 */

import { DAY_NAMES, MONTH_ABB, getBaseShift, formatISO, isSunday, parseISODate, isWorkedShift } from './roster-data.js';
import { isRestShift } from './override-utils.js';
import { WORKED_OVERRIDE_TYPES } from './admin-shift-types.js';
import { formatDayMonthYear, formatWeekdayDate } from './date-format.js';

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
 * @param {Map<string, any>|null} [ovByDate] the member's records in play, keyed by date: a base rest day
 *        one of them shows was WORKED is not a gap (header)
 */
export function isRestGap(dateStr, memberObj, ovByDate = null) {
    if (isSunday(dateStr)) return true; // Sunday — uncontracted
    if (!memberObj) return false;
    const held = ovByDate && typeof ovByDate.get === 'function' ? ovByDate.get(dateStr) : null;
    // Came back for it: RDW, a swapped-in shift, a Spare turn (its value is not a worked shift, its type is
    // at work), an Other day.
    if (held && (WORKED_OVERRIDE_TYPES.has(held.type) || (held.value && isWorkedShift(held.value)))) return false;
    const shift = getBaseShift(memberObj, parseISODate(dateStr));
    return isRestShift(shift);
}

/** "Fri 18 Sep" — `formatWeekdayDate`'s spelling, read off a YYYY-MM-DD (date-format.js owns the words).
 *  @param {string} d */
export function fmtPeriodDate(d) {
    return formatWeekdayDate(parseISODate(d));
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

/**
 * Formats YYYY-MM-DD as "18 March 2026" — `formatDayMonthYear`'s spelling (date-format.js owns the
 * words). Returns "—" for empty input. (Moved from admin-overrides.js, which re-exports it, when that
 * file reached its line cap.)
 * @param {string} str
 */
export function formatDisplay(str) {
    return str ? formatDayMonthYear(parseISODate(str)) : '—';
}

/**
 * The days a refused save names (v25.90): "Tue 3 Nov", "Tue 3 Nov and Wed 4 Nov", "Tue 3 Nov, Wed 4 Nov
 * and Thu 5 Nov" — past three, the first two and a count, so a long range cannot fill the line. "a day
 * in this save" when there is none to name.
 * @param {string[]} dates YYYY-MM-DD, in the order to name them
 */
export function namedDays(dates) {
    const named = dates.map(fmtPeriodDate);
    if (!named.length) return 'a day in this save';
    if (named.length > 3) return `${named[0]}, ${named[1]} and ${named.length - 2} other days`;
    return named.length === 1 ? named[0] : `${named.slice(0, -1).join(', ')} and ${named[named.length - 1]}`;
}
