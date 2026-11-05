// @ts-check
/**
 * christmas-leave.js — CHRISTMAS DAY AND BOXING DAY: who is on leave, what it costs, and the day in lieu.
 *
 * ── THE OWNER'S RULES (5 Nov 2026; built v25.37) ─────────────────────────────────────────────────
 *
 * The station is closed on Christmas Day and Boxing Day, so `getBaseShift` makes both a rest day for
 * everybody (`isChristmasRD`, roster-data.js — unchanged, and still applied before every override).
 * On top of that, from Christmas 2026:
 *
 *   1. Somebody DUE AT WORK on either day by their pattern — a shift or a spare day — is shown on
 *      annual leave and has it listed in their leave records, and it costs them nothing.
 *   2. Never on a Sunday. Sundays are uncontracted, so nobody is due at work on one.
 *   3. Somebody due at work on Boxing Day who WORKS it earns one day of annual leave in lieu, added to
 *      that year's allowance — counted once for a Dispatcher, whose bank-holiday rule may already have
 *      counted the day. Working Boxing Day from a rest day is overtime, and earns none.
 *
 * ── DERIVED, NEVER STORED ────────────────────────────────────────────────────────────────────────
 *
 * Whether a member has the leave follows entirely from their pattern and the date, so nothing is
 * written to Firestore. A stored copy would need writing every December and would go stale whenever
 * a roster changed after it. Anything recorded on the day still wins — an overtime shift on Boxing
 * Day shows as worked, a correction as rest — because the leave is shown only where no override
 * applies (`resolveDayShift`). Being derived, it never reaches the allowance count, which reads
 * overrides; and `consumesEntitlement` (al-entitlement.js) charges neither day in any case, for leave
 * somebody DID record there.
 *
 * ── WHY THIS IS ITS OWN MODULE, AND THE ONE DOOR IT COSTS ────────────────────────────────────────
 *
 * Every Christmas rule is here rather than spread across the three modules it touches — roster-data.js
 * (the pattern), override-utils.js (what a day shows) and al-entitlement.js (what it costs). It imports
 * from the first two and is imported by the third, so there is no cycle (import-graph.test.mjs), and
 * neither of the first two had room for it (coordinator-ratchet.test.mjs).
 *
 * The cost is that `getALEntitlement` cannot add the Boxing Day day itself: it would have to import
 * this module, which imports it. So the WHOLE allowance is `entitlementFor` in al-entitlement.js, and
 * christmas-leave.test.mjs fails if any other module calls `getALEntitlement` directly — a second door
 * would be a surface that quietly leaves the earned day out.
 *
 * The depot's spreadsheet agrees on the counts: both days are `Closed` in every grade's block, so
 * neither is ever counted there (AL_WORKBOOK.md §4 and §9).
 */

import { getPatternShift, isChristmasRD, isWorkedShift, isBankHoliday, formatISO, parseISODate } from './roster-data.js';
import { shouldReplaceOverride, resolveEffectiveShift, isOverrideDisplaySuppressed } from './override-utils.js';

/** The first Christmas these rules apply to. Earlier years keep showing Rest, as they always did. */
export const CHRISTMAS_LEAVE_FROM_YEAR = 2026;

/**
 * Is `date` one of the member's Christmas leave days — 25 or 26 December from 2026, not a Sunday, on
 * which their PATTERN had them due at work (a shift or a spare day)? A day before their start date is
 * a rest day in the pattern, so it is never one (rules 1 and 2).
 * @param {any} member  teamMembers entry
 * @param {Date} date
 * @returns {boolean}
 */
export function isChristmasLeaveDay(member, date) {
    if (!member || !date || !isChristmasRD(date)) return false;
    if (date.getFullYear() < CHRISTMAS_LEAVE_FROM_YEAR) return false;
    if (date.getDay() === 0) return false;               // rule 2: Sundays are uncontracted
    const pattern = getPatternShift(member, date);
    return pattern !== 'RD' && pattern !== 'OFF';        // a shift or SPARE — due at work
}

/**
 * Is the ISO date Christmas Day or Boxing Day in a year these rules apply to? Leave on such a day
 * never costs anybody a day (`consumesEntitlement`), so the booking flows neither ask about it nor
 * write it: the leave a member due at work has there is SHOWN from their pattern, not recorded.
 * @param {string} dateStr ISO `YYYY-MM-DD`
 * @returns {boolean}
 */
export function isChristmasClosureDate(dateStr) {
    if (!dateStr) return false;
    const d = parseISODate(dateStr);
    return isChristmasRD(d) && d.getFullYear() >= CHRISTMAS_LEAVE_FROM_YEAR;
}

/**
 * The annual leave earned in lieu by working Boxing Day — 1 or 0 for the member's `year` (rule 3).
 *
 * Earned when the member was due at work on Boxing Day by their pattern (`isChristmasLeaveDay`) and
 * the day's WINNING override is a worked shift — resolved with `shouldReplaceOverride`, as the
 * Dispatcher bank-holiday count resolves it, so a stale document can neither earn nor lose the day.
 * It counts towards the Boxing Day's own year (owner, 5 Nov 2026), as a Dispatcher's bank-holiday
 * days do; the January carry-back (leave-year.js) is how it can be taken in early January.
 *
 * COUNTED ONCE FOR A DISPATCHER (owner, 5 Nov 2026). A Dispatcher already earns a day for every bank
 * holiday they work. In a year whose Boxing Day IS a bank holiday that rule has counted the day, so
 * this adds nothing; in a year where it is not — 2026, when Boxing Day is a Saturday and the holiday
 * moves to Monday 28 December — this is the only rule that sees it. The Dispatcher rule itself is
 * unchanged, so nobody loses a day they earned before.
 * @param {any} member  teamMembers entry
 * @param {number|string} year
 * @param {Array<any>} [overrides] the member's overrides (any others are ignored)
 * @returns {number}
 */
export function boxingDayLieuDays(member, year, overrides = []) {
    const y = Number(year);
    if (!member || !Number.isFinite(y) || y < CHRISTMAS_LEAVE_FROM_YEAR) return 0;
    const boxingDay = new Date(y, 11, 26);
    if (!isChristmasLeaveDay(member, boxingDay)) return 0;
    const dateStr = formatISO(boxingDay);
    /** @type {any} */
    let winner = null;
    for (const o of overrides || []) {
        if (o && o.memberName === member.name && o.date === dateStr && shouldReplaceOverride(winner, o)) winner = o;
    }
    if (!winner || !isWorkedShift(winner.value)) return 0;
    if (member.role === 'Dispatcher' && isBankHoliday(boxingDay)) return 0;
    return 1;
}

/**
 * `resolveEffectiveShift` with Christmas leave on top — what every surface that DRAWS a day calls (the
 * Calendar, Team Week View, the month legend, Overtime's roster and Admin's week grid), so no two can
 * show a Christmas day differently. Where `christmasLeave` (`isChristmasLeaveDay(member, date)`) is
 * true and NO override applies — none, or one suppressed exactly as it would be on any other day — the
 * day is 'AL' and `christmasLeave` comes back true. Everything else is the shared ladder, unchanged.
 * @param {any} override  the day's override, or null
 * @param {string} baseShift  `getBaseShift` for the day
 * @param {boolean} sunday
 * @param {boolean} christmasLeave
 * @returns {{ shift: string, rdwTime: string, derivedRdw: boolean, christmasLeave: boolean }}
 */
export function resolveDayShift(override, baseShift, sunday, christmasLeave) {
    if (christmasLeave && (!override || isOverrideDisplaySuppressed(override, baseShift, sunday))) {
        return { shift: 'AL', rdwTime: '', derivedRdw: false, christmasLeave: true };
    }
    return { ...resolveEffectiveShift(override, baseShift, sunday), christmasLeave: false };
}

/**
 * The member's CHRISTMAS LEAVE days in `year` — 25 and/or 26 December, ISO, ascending.
 *
 * The leave records list them (Admin's Recorded Annual Leave, the Calendar's leave panel) because the
 * owner asked for Christmas leave to be RECORDED, not merely shown. They are listed BESIDE the counted
 * days and never among them.
 *
 * A date is listed exactly when the Calendar shows the member, due at work by their pattern, on LEAVE
 * that day — because both ask `resolveDayShift`. That is the Christmas leave shown from the roster, or
 * leave somebody recorded there, which is never counted either. A worked Boxing Day is work, not
 * leave, and a correction is rest. One winner per date, resolved as every consumer resolves it.
 * @param {{ member: any, year: number|string, overrides: any[] }} args
 * @returns {string[]}
 */
export function christmasLeaveDates({ member, year, overrides }) {
    const y = parseInt(String(year), 10);
    if (!member || !Number.isFinite(y)) return [];
    const winners = /** @type {Map<string, any>} */ (new Map());
    for (const o of overrides || []) {
        if (o && o.memberName === member.name && o.date && shouldReplaceOverride(winners.get(o.date), o)) winners.set(o.date, o);
    }
    return [25, 26]
        .map(day => new Date(y, 11, day))
        .filter(d => isChristmasLeaveDay(member, d))
        .map(d => formatISO(d))
        .filter(iso => resolveDayShift(winners.get(iso) ?? null, 'RD', false, true).shift === 'AL');
}

/**
 * Year → the member's Christmas leave dates, from the first Christmas these rules apply to up to
 * `thisYear` — Admin's Recorded Annual Leave list grows a year chip for each, and a year still to come
 * must not grow one for a Christmas nobody has reached.
 * @param {{ member: any, overrides: any[], thisYear: number }} args
 * @returns {Record<string, string[]>}
 */
export function christmasLeaveByYear({ member, overrides, thisYear }) {
    /** @type {Record<string, string[]>} */
    const out = {};
    if (!member) return out;
    for (let y = CHRISTMAS_LEAVE_FROM_YEAR; y <= thisYear; y++) {
        const dates = christmasLeaveDates({ member, year: y, overrides });
        if (dates.length) out[String(y)] = dates;
    }
    return out;
}

/**
 * The words for a member's Christmas leave days, or null when there are none — one phrasing for every
 * surface that lists them. "Not counted" rather than "free": the reader's question is whether it came
 * off their allowance, and that is the answer to it.
 * @param {string[]} dates from `christmasLeaveDates`
 * @returns {string|null}
 */
export function christmasLeaveLine(dates) {
    const names = (dates || [])
        .map(d => d.endsWith('-12-25') ? 'Christmas Day' : d.endsWith('-12-26') ? 'Boxing Day' : null)
        .filter(Boolean);
    if (!names.length) return null;
    return `${names.join(' and ')}: annual leave, not counted`;
}
