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
 *      the NEXT year's allowance — counted once for a Dispatcher, whose bank-holiday rule may already
 *      have counted the day. Working Boxing Day from a rest day is overtime, and earns none.
 *
 * Rule 3's year changed on 15 Nov 2026. It was the Boxing Day's own year until the roster clerk said
 * the day in lieu is valid for a year, every year; the owner chose the next year's allowance, so a
 * Boxing Day worked in 2026 is a day to take at any time in 2027 (`allowanceForBoxingDay`).
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
 * Is this day's leave never counted because it falls on Christmas? True for the Christmas leave shown
 * from the pattern (`christmasLeave`, from `resolveDayShift`) AND for leave somebody recorded on 25 or
 * 26 December from 2026, which `consumesEntitlement` does not charge either. A stored record there —
 * one booked before v25.37, or a swapped day — was labelled plain "Annual leave" on the Calendar and
 * Team Week while the leave panel and Admin said "not counted" (6 Nov 2026 review); every surface
 * that words a day asks this instead.
 * @param {string} shift the day's effective value
 * @param {string} dateStr ISO `YYYY-MM-DD`
 * @param {boolean} christmasLeave `resolveDayShift`'s flag for the day
 * @returns {boolean}
 */
export function isUncountedChristmasLeave(shift, dateStr, christmasLeave) {
    return christmasLeave === true || (shift === 'AL' && isChristmasClosureDate(dateStr));
}

/**
 * The allowance a day in lieu for working Boxing Day `year` is added to (rule 3): the NEXT year's
 * (owner, 15 Nov 2026). This is where that is decided. The allowance counts the day through
 * `boxingDayLieuDays`, and the surfaces that word a worked Boxing Day (the Calendar's day panel,
 * Admin's week grid) name the year this returns, so no two can disagree about where the day went.
 *
 * Why the next year, not the Boxing Day's own: the roster clerk says the day is valid for a year,
 * every year. Added to the year it was earned in, it could be taken only in the last days of
 * December, or in January through the carry-back (leave-year.js).
 *
 * THE EXCEPTION IS A DISPATCHER WHOSE BOXING DAY IS A BANK HOLIDAY. Their bank-holiday rule counts
 * the day (`countDispatcherBankHolidaysWorked`, roster-data.js) in the year the holiday falls, as it
 * counts every other one, and this rule adds nothing (`boxingDayLieuDays`), so the day is in that
 * year. Boxing Day is next a bank holiday in 2028. In 2026 it is a Saturday, and the holiday moves to
 * Monday 28 December.
 * @param {any} member  teamMembers entry
 * @param {number|string} year  the Boxing Day's year
 * @returns {number}  the allowance year
 */
export function allowanceForBoxingDay(member, year) {
    const y = Number(year);
    return member?.role === 'Dispatcher' && isBankHoliday(new Date(y, 11, 26)) ? y : y + 1;
}

/**
 * The year of the Boxing Day whose day in lieu is in `year`'s allowance: the year before
 * (`allowanceForBoxingDay`). The Calendar's leave panel reads from that Boxing Day, and the line
 * under an allowance names it, because the 2027 allowance's day was earned in December 2026.
 * @param {number|string} year  the allowance year
 * @returns {number}  the Boxing Day's year
 */
export function boxingDayForAllowance(year) {
    return Number(year) - 1;
}

/**
 * The years whose allowance a record dated `dateStr` can change: its own year, where a Dispatcher's
 * worked bank holiday earns its day, and, for a Boxing Day, the year its day in lieu goes into
 * (`allowanceForBoxingDay`). Admin's save checks each of them for a member it would leave over
 * their allowance (admin-al-projection.js).
 * @param {any} member  teamMembers entry
 * @param {string} dateStr  ISO `YYYY-MM-DD`
 * @returns {number[]}  ascending
 */
export function allowanceYearsOf(member, dateStr) {
    const y = Number(String(dateStr).slice(0, 4));
    if (!String(dateStr).endsWith('-12-26')) return [y];
    const lieu = allowanceForBoxingDay(member, y);
    return lieu === y ? [y] : [y, lieu];
}

/**
 * The day in lieu for working Boxing Day that `year`'s ALLOWANCE holds — 1 or 0 (rule 3). `year` is
 * the allowance, so the Boxing Day asked about is the one before it (`boxingDayForAllowance`): the
 * 2027 allowance holds the day earned on 26 December 2026.
 *
 * Earned when the member was due at work on Boxing Day by their pattern (`isChristmasLeaveDay`) and
 * the day's WINNING override is a worked shift — resolved with `shouldReplaceOverride`, as the
 * Dispatcher bank-holiday count resolves it, so a stale document can neither earn nor lose the day.
 *
 * COUNTED ONCE FOR A DISPATCHER (owner, 5 Nov 2026). A Dispatcher already earns a day for every bank
 * holiday they work. In a year whose Boxing Day IS a bank holiday that rule has counted the day, so
 * this adds nothing; in a year where it is not — 2026, when Boxing Day is a Saturday and the holiday
 * moves to Monday 28 December — this is the only rule that sees it. The Dispatcher rule itself is
 * unchanged, so nobody loses a day they earned before.
 * @param {any} member  teamMembers entry
 * @param {number|string} year  the ALLOWANCE year, not the Boxing Day's
 * @param {Array<any>} [overrides] the member's overrides (any others are ignored)
 * @returns {number}
 */
export function boxingDayLieuDays(member, year, overrides = []) {
    const y = Number(year);
    if (!member || !Number.isFinite(y)) return 0;
    const from = boxingDayForAllowance(y);
    // A Dispatcher's bank-holiday Boxing Day is counted by that rule, in its own year.
    if (allowanceForBoxingDay(member, from) !== y) return 0;
    const boxingDay = new Date(from, 11, 26);
    if (!isChristmasLeaveDay(member, boxingDay)) return 0;   // also every Boxing Day before 2026
    const dateStr = formatISO(boxingDay);
    /** @type {any} */
    let winner = null;
    for (const o of overrides || []) {
        if (o && o.memberName === member.name && o.date === dateStr && shouldReplaceOverride(winner, o)) winner = o;
    }
    return winner && isWorkedShift(winner.value) ? 1 : 0;
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
 * A date is listed exactly when the Calendar shows the member on Christmas LEAVE that day — because
 * both ask `resolveDayShift`. That is the leave shown from the roster where the pattern had them due at
 * work, or leave somebody RECORDED on the day whatever the pattern says, which is never counted either.
 * The second half was due days only until 7 Nov 2026: a record on a day the member rests by pattern
 * was drawn as "Christmas, not counted", dropped from the ordinary rows (`consumesEntitlement`), and so
 * listed nowhere it could be deleted. A worked Boxing Day is work, not leave, and a correction is rest;
 * a Sunday shows no leave, so lists none. One winner per date, resolved as every consumer resolves it.
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
        .filter(d => {
            const iso = formatISO(d), due = isChristmasLeaveDay(member, d), winner = winners.get(iso) ?? null;
            if (!due && !(winner?.type === 'annual_leave' && isChristmasClosureDate(iso))) return false;
            return resolveDayShift(winner, 'RD', d.getDay() === 0, due).shift === 'AL';
        })
        .map(d => formatISO(d));
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
 * off their allowance, and that is the answer to it. Each day's name is held together by a no-break
 * space (laptop polish, 13 Nov 2026): the leave panel balances this line over two, and it broke
 * "Boxing / Day" across them.
 * @param {string[]} dates from `christmasLeaveDates`
 * @returns {string|null}
 */
export function christmasLeaveLine(dates) {
    const names = (dates || [])
        .map(d => d.endsWith('-12-25') ? 'Christmas\u00a0Day' : d.endsWith('-12-26') ? 'Boxing\u00a0Day' : null)
        .filter(Boolean);
    if (!names.length) return null;
    return `${names.join(' and ')}: annual leave, not counted`;
}
