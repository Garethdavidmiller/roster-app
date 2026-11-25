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
 *   1. Somebody DUE AT WORK on either day by their pattern — a SHIFT — is shown on annual leave and
 *      has it listed in their leave records, and it costs them nothing. A spare day is NOT due at
 *      work there (owner, 19 Nov 2026: "Christmas days and Boxing days cannot be spare days even if
 *      they fall in a usually spare week"): a spare week's 25 or 26 December is a rest day, with no
 *      leave shown and no day in lieu for working Boxing Day — that is overtime from a rest day. Nor
 *      can a Spare turn be recorded or imported on either day (admin-day-pills.js, checkDayRules in
 *      admin-shift-rules.js, normaliseCellValue in roster-cell-rules.js).
 *   2. Never on a Sunday. Sundays are uncontracted, so nobody is due at work on one.
 *   3. Somebody due at work on Boxing Day who WORKS it earns one day of annual leave in lieu, to take
 *      from 27 December to the end of the next year — counted once for a Dispatcher, whose
 *      bank-holiday rule may already have counted the day. Working Boxing Day from a rest day is
 *      overtime, and earns none.
 *
 * Rule 3's year has changed twice. It was the Boxing Day's own year until the roster clerk said the
 * day in lieu is valid for a year, every year; the owner then chose the next year's allowance (15 Nov
 * 2026), so a Boxing Day worked in 2026 was a day to take in 2027 — and could not be taken on New
 * Year's Eve. Since 25 Nov 2026 (owner) it is SPENT WHERE IT IS NEEDED: in its own year when leave
 * after it that December runs past that year's allowance, otherwise in the next
 * (`boxingDayLieuYear`, al-entitlement.js, which needs the leave count and so cannot live here).
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
 * from the first two — and from al-contract.js, for the Dispatcher bank-holiday rule it must not count
 * twice — and is imported by the third, so there is no cycle (import-graph.test.mjs), and neither of
 * the first two had room for it (coordinator-ratchet.test.mjs).
 *
 * The cost is that `getALEntitlement` (al-contract.js) cannot add the Boxing Day day itself: it would
 * have to import this module, which imports al-contract.js. So the WHOLE allowance is `entitlementFor` in al-entitlement.js, and
 * christmas-leave.test.mjs fails if any other module calls `getALEntitlement` directly — a second door
 * would be a surface that quietly leaves the earned day out.
 *
 * The depot's spreadsheet agrees on the counts: both days are `Closed` in every grade's block, so
 * neither is ever counted there (AL_WORKBOOK.md §4 and §9).
 */

import { getPatternShift, isChristmasRD, isWorkedShift, formatISO, parseISODate } from './roster-data.js';
import { countsAsDispatcherBankHoliday } from './al-contract.js';
import { shouldReplaceOverride, resolveEffectiveShift, isOverrideDisplaySuppressed } from './override-utils.js';

/** The first Christmas these rules apply to. Earlier years keep showing Rest, as they always did. */
export const CHRISTMAS_LEAVE_FROM_YEAR = 2026;

/**
 * Is `date` one of the member's Christmas leave days — 25 or 26 December from 2026, not a Sunday, on
 * which their PATTERN had them due at work: a shift, never a spare day (rule 1). A day before their
 * start date is a rest day in the pattern, so it is never one (rules 1 and 2).
 * @param {any} member  teamMembers entry
 * @param {Date} date
 * @returns {boolean}
 */
export function isChristmasLeaveDay(member, date) {
    if (!member || !date || !isChristmasRD(date)) return false;
    if (date.getFullYear() < CHRISTMAS_LEAVE_FROM_YEAR) return false;
    if (date.getDay() === 0) return false;               // rule 2: Sundays are uncontracted
    const pattern = getPatternShift(member, date);
    // A shift is due at work; a rest day and a spare day are not — 25 and 26 December cannot be spare
    // days, even in a spare week (owner, 19 Nov 2026).
    return pattern !== 'RD' && pattern !== 'OFF' && pattern !== 'SPARE';
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
 * The allowance a day in lieu for working Boxing Day `year` goes to when leave after it that December
 * does not need it (rule 3): the NEXT year's (owner, 15 Nov 2026). Where it IS spent, its own year or
 * this one, is `boxingDayLieuYear` (al-entitlement.js), because that needs the leave count. The surfaces
 * that word a worked Boxing Day (the Calendar's day panel, Admin's week grid) name both years, so no two
 * can disagree about where the day goes.
 *
 * Why the next year, not the Boxing Day's own: the roster clerk says the day is valid for a year,
 * every year. Added to the year it was earned in, it could be taken only in the last days of
 * December, or in January through the carry-back (leave-year.js).
 *
 * THE EXCEPTION IS A DISPATCHER WHOSE BOXING DAY IS A BANK HOLIDAY. Their bank-holiday rule counts
 * the day (`countDispatcherBankHolidaysWorked`, al-contract.js) in the year the holiday falls, as it
 * counts every other one, and this rule adds nothing (`boxingDayLieuDays`), so the day is in that
 * year. Boxing Day is next a bank holiday in 2028. In 2026 it is a Saturday, and the holiday moves to
 * Monday 28 December.
 * @param {any} member  teamMembers entry
 * @param {number|string} year  the Boxing Day's year
 * @returns {number}  the allowance year
 */
export function allowanceForBoxingDay(member, year) {
    const y = Number(year);
    // Asked of the Dispatcher rule itself — the grade at the time, the bank holiday, the start date —
    // so a Boxing Day that rule counts is never counted again here (al-contract.js).
    return countsAsDispatcherBankHoliday(member, new Date(y, 11, 26)) ? y : y + 1;
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
 * The years whose allowance a record dated `dateStr` can change. Admin's save checks each of them for
 * a member it would leave over their allowance (admin-al-projection.js).
 *
 * Its own year, where a Dispatcher's worked bank holiday earns its day, AND THE NEXT (25 Nov 2026):
 * the year's Boxing Day in lieu is spent in that year or the next by how much of that year's leave is
 * left over (`boxingDayLieuYear`, al-entitlement.js), so any day's leave — not only Boxing Day's work —
 * can move it from one to the other. A January day adds the year before too, because it can be charged
 * there (leave-year.js), moving that year's day in lieu the same way.
 * @param {any} _member  teamMembers entry (the years no longer depend on who; kept for the callers)
 * @param {string} dateStr  ISO `YYYY-MM-DD`
 * @returns {number[]}  ascending
 */
export function allowanceYearsOf(_member, dateStr) {
    const y = Number(String(dateStr).slice(0, 4));
    return String(dateStr).slice(5, 7) === '01' ? [y - 1, y, y + 1] : [y, y + 1];
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
    // A record the Calendar does not DRAW earns nothing (owner, 25 Nov 2026): an Other day saved there before Save
    // refused one (`isOverrideDisplaySuppressed`) shows as Christmas leave, so it cannot also be work that earns a day.
    if (!winner || isOverrideDisplaySuppressed(winner, getPatternShift(member, boxingDay), boxingDay.getDay() === 0, true)) return 0;
    return isWorkedShift(winner.value) ? 1 : 0;
}

/**
 * `resolveEffectiveShift` with Christmas leave on top — what every surface that DRAWS a day calls (the
 * Calendar, Team Week View, the month legend, Overtime's roster and Admin's week grid), so no two can
 * show a Christmas day differently. Where `christmasLeave` (`isChristmasLeaveDay(member, date)`) is
 * true and NO override applies — none, or one suppressed as `isOverrideDisplaySuppressed` says (as on any
 * other day, and a Spare, which these two days cannot have, besides) — the
 * day is 'AL' and `christmasLeave` comes back true. Everything else is the shared ladder, unchanged.
 * @param {any} override  the day's override, or null
 * @param {string} baseShift  `getBaseShift` for the day
 * @param {boolean} sunday
 * @param {boolean} christmasLeave
 * @param {boolean} christmasDay  `isChristmasOrBoxingDay(date)` — a legacy Spare there is not drawn
 * @returns {{ shift: string, rdwTime: string, derivedRdw: boolean, christmasLeave: boolean }}
 */
export function resolveDayShift(override, baseShift, sunday, christmasLeave, christmasDay) {
    if (christmasLeave && (!override || isOverrideDisplaySuppressed(override, baseShift, sunday, christmasDay))) {
        return { shift: 'AL', rdwTime: '', derivedRdw: false, christmasLeave: true };
    }
    return { ...resolveEffectiveShift(override, baseShift, sunday, christmasDay), christmasLeave: false };
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
            return resolveDayShift(winner, 'RD', d.getDay() === 0, due, true).shift === 'AL';
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
 * surface that lists them. Not "free", and not "not counted" either (lightbox review, 22 Nov 2026 —
 * counted against what?): the reader's question is whether it came off their allowance, so the line says
 * that, in the day panel's own words. Each day's name is held together by a no-break
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
    return `${names.join(' and ')}: annual leave that does not come off the allowance`;
}
