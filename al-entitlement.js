// @ts-check
/**
 * Which annual-leave days count against a member's entitlement for a year — and, from that, where
 * they stand: taken, booked, remaining.
 *
 * ── WHY THIS IS A MODULE AND NOT FOUR FILTERS ───────────────────────────────────────────────────
 *
 * `projectAnnualLeaveOverage` (roster-data.js) is shared; the set of existing AL dates FEEDING it
 * was once built by hand in four places (the Admin banner, the week-grid save, admin-al.js's cap
 * check, the Calendar's leave panel), each holding a different subset of the rules. So the banner
 * could say "0 left" while the save path believed otherwise. One module answers the question once.
 *
 * ── THE TWO RULES, AND THE THIRD THAT IS ALREADY IMPLIED ────────────────────────────────────────
 *
 * **A Sunday never counts.** Sundays are uncontracted for every grade. This is the read-side face of
 * `SUNDAY_FORBIDDEN_TYPES` (override-utils.js): the write paths refuse, and this makes sure a document
 * that got in before they did cannot spend a day.
 *
 * **A day whose BASE shift is a rest day never counts.** A member does not spend annual leave on a
 * day they were not working. NEW dates are filtered through `isWorkingDate`, which already excludes
 * rest days, so an existing-AL set that kept them would compare unlike with unlike and meet a
 * spurious "over entitlement" confirm bar.
 *
 * **A day before the member joined never counts — and it needs a rule of its own.** `getBaseShift`
 * returns `'RD'` before `startDate`, which answers a bare record. But a record carrying its OWN
 * evidence (leave over a swapped working day, `replacedType`) is answered from that evidence BEFORE
 * the base is asked. So `isBeforeMemberStart` is asked first, as the calendar and the leave sheet's
 * card (al-leave-compare.js) do, and the test pins both halves.
 *
 * ── WHICH YEAR A DAY BELONGS TO IS ITS OWN — UNLESS IT IS A JANUARY DAY MOVED BACK ─────────────
 *
 * A January leave day carrying `leaveYear` counts against the year before (leave-year.js has the
 * owner's decision). So `countedAlDates` for a year reads the NEXT January too, and every day is
 * counted towards `leaveYearOf` its winning record — never the year its date merely starts with. A
 * surface that still filtered by date prefix would count a moved day twice, once in each year.
 *
 * ── THE TAKEN / BOOKED SPLIT IS TODAY, NOT THE DEADLINE ─────────────────────────────────────────
 *
 * `alPosition` splits the counted days at `todayStr` — on or before today is TAKEN, after is BOOKED.
 * Both consume entitlement. The date is passed in rather than read from a clock, which keeps the
 * module pure and lets the boundary (a day that is today) be tested.
 */

import { getBaseShift, isSunday, isChristmasRD, parseISODate, formatISO } from './roster-data.js';
import { getALEntitlement, dispatcherBaseAL, allowanceRole } from './al-contract.js';
import { isRestShift, isContractedWorkOverride, contractEvidence, shouldReplaceOverride, isBeforeMemberStart } from './override-utils.js';
import { leaveYearOf, offeredJanuaries } from './leave-year.js';
import { isChristmasClosureDate, boxingDayLieuDays, boxingDayForAllowance, allowanceYearsOf } from './christmas-leave.js';
import { roleOn } from './roster-roles.js';

/**
 * A member's WHOLE annual-leave allowance for a year — the one door every surface reads it through.
 * The contract figure is `getALEntitlement` (al-contract.js); on top of it goes the day in lieu
 * earned by working a Boxing Day the member was due to work, in whichever year it is SPENT
 * (`boxingDayLieuYear`, below). No entitlement on record stays `null` — a day is not added to nothing.
 *
 * It is not inside `getALEntitlement` because christmas-leave.js imports al-contract.js, so
 * al-contract.js cannot import it back. christmas-leave.test.mjs fails if any module but this one
 * calls `getALEntitlement`, since a second door would quietly leave the earned day out.
 * @param {any} member  teamMembers entry
 * @param {number|string} year
 * @param {Array<any>} [overrides] the member's overrides
 * @returns {number|null}
 */
export function entitlementFor(member, year, overrides = []) {
    const y = parseInt(String(year), 10);
    const contract = getALEntitlement(member, y, overrides);
    if (contract === null) return null;
    const { carried, late } = boxingDayLieuSplit(member, y, overrides);
    return contract + carried + late;
}

/**
 * WHICH ALLOWANCE HOLDS THE DAY IN LIEU FOR WORKING BOXING DAY `boxingYear` — that year's, the next
 * year's, or `null` when none was earned (owner, 25 Nov 2026).
 *
 * The roster clerk says the day is valid for a year. It can be taken from 27 December, and it is
 * SPENT WHERE IT IS NEEDED: in its own year when that year has leave counted from 27 December on (a
 * January day charged back to it included, leave-year.js) and the year's allowance without it cannot
 * cover the year's leave; otherwise in the next year, to 31 December (owner: "keep it to 31 December").
 *
 * The year's own leave goes FIRST, the day in lieu only on what is left over: unused leave is lost at
 * the year's end and the day in lieu keeps, so that order keeps every day a member has. Nothing is
 * asked or stored — it derives from what is on record (christmas-leave.js, "derived, never stored").
 *
 * THE COST IS A CHAIN, AND EVERY SURFACE MUST READ IT WHOLE. Whether one year's allowance "cannot cover"
 * its leave depends on the day carried in from the Boxing Day before, and so on back to the first
 * Christmas these rules apply to — a surface needs the member's records from that year on (the
 * Calendar's leave panel reads from it). A Dispatcher's bank-holiday Boxing Day is not in it: their
 * bank-holiday rule counts that day in its own year (`boxingDayLieuDays` gives nothing for it).
 * @param {any} member  teamMembers entry
 * @param {number|string} boxingYear  the Boxing Day's year
 * @param {Array<any>} [overrides] the member's overrides
 * @returns {number|null}  the allowance year holding the day
 */
export function boxingDayLieuYear(member, boxingYear, overrides = []) {
    const b = parseInt(String(boxingYear), 10);
    if (!member || !Number.isFinite(b)) return null;
    if (!boxingDayLieuDays(member, b + 1, overrides)) return null;   // none earned (every Boxing Day before the rules too)
    const contract = getALEntitlement(member, b, overrides);
    if (contract === null) return b + 1;                             // no allowance that year to run past
    const carried = boxingDayLieuYear(member, b - 1, overrides) === b ? 1 : 0;
    const counted = countedAlDates({ overrides, member, year: b });
    const afterIt = [...counted].some(d => d >= `${b}-12-27`);
    return afterIt && counted.size > contract + carried ? b : b + 1;
}

/**
 * The days in lieu for working Boxing Day that `year`'s allowance holds, by where they came from:
 * `carried`, the Boxing Day before, unless it was spent that December; `late`, this year's own,
 * spent on leave after it (`boxingDayLieuYear`). Each 0 or 1.
 * @param {any} member @param {number|string} year @param {Array<any>} [overrides]
 * @returns {{ carried: number, late: number }}
 */
export function boxingDayLieuSplit(member, year, overrides = []) {
    const y = parseInt(String(year), 10);
    return {
        carried: boxingDayLieuYear(member, y - 1, overrides) === y ? 1 : 0,
        late: boxingDayLieuYear(member, y, overrides) === y ? 1 : 0,
    };
}

/**
 * Does a record written on `date` lower the member's allowance — the day in lieu its work earned going
 * with the work? Asked of `entitlementFor` with and without the record, so every rule that earns a day
 * in lieu (a worked Boxing Day, a Dispatcher's worked bank holiday) answers through the one that
 * grants it, rather than a second copy of either.
 *
 * Across EVERY year the day can reach (`allowanceYearsOf`, christmas-leave.js), as a TOTAL: a worked
 * Boxing Day's day in lieu sits in its own year or the next, and late-December leave can move it
 * between them, which lowers neither the member's days nor this answer.
 *
 * `written` is the record the save puts there — leave by default; an absence takes the day in lieu
 * back exactly as leave does (`projectAbsenceRange`, admin-al-projection.js). It lives here because
 * the Absence range's writer asks it too, and that module imports the writer's (al-swapped-days.js).
 * @param {any} member @param {string} date @param {Map<string, any>|null|undefined} ovByDate
 * @param {{type: string, value: string}} [written]
 * @returns {boolean}
 */
export function lowersAllowance(member, date, ovByDate, written = { type: 'annual_leave', value: 'AL' }) {
    const held = ovByDate && typeof ovByDate.values === 'function' ? [...ovByDate.values()].filter(Boolean) : [];
    const leave = { memberName: member.name, date, ...written, createdAt: { seconds: 4102444800 } };
    const withLeave = [...held.filter(o => o.date !== date), leave];
    let before = 0, after = 0;
    for (const year of allowanceYearsOf(member, date)) {
        const was = entitlementFor(member, year, held), now = entitlementFor(member, year, withLeave);
        if (was === null || now === null) continue;
        before += was; after += now;
    }
    return after < before;
}

/**
 * Does a single date consume `member`'s entitlement if AL is recorded on it?
 *
 * Exported because BOTH halves of the overage projection have to ask it: filtering only the existing
 * set makes a rest day on record free while the identical day being booked is not. `admin-al.js`
 * routes new dates through `isWorkingDate`; the week-grid save has no such filter, so it calls this.
 *
 * @param {any} member the team-member object
 * @param {string} date ISO `YYYY-MM-DD`
 * @param {Map<string, any>|null} [ovByDate] the overrides in play, keyed by date. Omit only where
 *        there genuinely are none to hand — without it a swapped-in day reads as a rest day.
 * @returns {boolean}
 */
export function consumesEntitlement(member, date, ovByDate = null) {
    if (!costsWithoutSpareCap(member, date, ovByDate)) return false;
    // …AND A SPARE WEEK NEVER COSTS MORE THAN FOUR (owner, 21 Nov 2026), its days as rostered
    // (owner, 22 Nov 2026): `pastSpareWeekCap`.
    return !pastSpareWeekCap(member, date, ovByDate);
}

/**
 * The most leave in one Spare week costs (owner, 21 Nov 2026). A Spare week is four days' work of
 * 35 hours, but the roster marks Monday to Saturday Spare, so a whole week off was charged six. Each
 * day still costs one; the week stops costing at four.
 *
 * THE CAP FOLLOWS THE WEEK AS ROSTERED (owner, 22 Nov 2026): a week the BASE roster makes Spare costs
 * at most four however many of its days a roster upload has since given named shifts (`rosteredSpareDay`).
 */
export const SPARE_WEEK_MAX_DAYS = 4;

/**
 * Is the work underneath `date` still a SPARE turn — on standby, the shift not yet assigned? Read
 * as `consumesEntitlement` reads what was underneath: a record's own evidence first (leave or an
 * absence carries what it replaced, `contractEvidence`), else the base roster. A Spare day a roster
 * upload has since given a named shift is not Spare any more.
 *
 * This is what the booking preview CALLS the day (admin-al-spare-note.js). It is NOT what the week's
 * cap counts: that is the week as rostered, assigned days included (`rosteredSpareDay`).
 * @param {any} member @param {string} date @param {Map<string, any>|null|undefined} ovByDate
 * @returns {boolean}
 */
export function spareUnderneath(member, date, ovByDate) {
    // CEA AND CES ONLY (owner, 21 Nov 2026). Their Spare week is four days' work of 35 hours, which is
    // what the cap is for; a Dispatcher's Spare days each cost one day, as they always did.
    const role = roleOn(member, parseISODate(date));
    if (role !== 'CEA' && role !== 'CES') return false;
    const ov = ovByDate && typeof ovByDate.get === 'function' ? ovByDate.get(date) : null;
    const evidence = contractEvidence(ov);
    // Evidence that SAYS something about the contract answers; an absence or leave carried as what was
    // replaced says nothing, so the base roster decides — as `costsWithoutSpareCap` reads the same day.
    if (evidence && evidence.type && isContractedWorkOverride({ type: evidence.type }) !== null) return evidence.type === 'spare_shift';
    return getBaseShift(member, parseISODate(date)) === 'SPARE';
}

/**
 * Is `date` a day of a SPARE WEEK as the base roster has it — the days the week's cap of four counts
 * (owner, 22 Nov 2026: the cap follows the week as rostered, not how many of its days were assigned)?
 *
 * WHY THE BASE ROSTER, NOT THE RECORD. A roster upload that assigns a Spare day writes a `shift`, and
 * leave over it keeps only `replacedType: 'shift'` — the same evidence a swapped-in working day leaves,
 * so the record cannot tell an assigned Spare day from any other shift. The base line can: the week is
 * Spare because the member's line says so, whatever was assigned. Read a DAY at a time, so a line Spare
 * only Monday to Thursday caps those days, a mid-week `rosterChanges` move is honoured (`getBaseShift`),
 * and 25 and 26 December (base rest days) are not in it. A Spare turn saved over a day the base roster
 * has at work is therefore NOT a Spare week, and costs a day as that work does.
 *
 * CEA AND CES ONLY, BY THE GRADE HELD ON THE DAY (owner, 21 Nov 2026). Their Spare week is four days'
 * work of 35 hours, which is what the cap is for; a Dispatcher's Spare days each cost one day.
 *
 * Exported so the booking preview's Spare line counts the same days the cap does (admin-al-spare-note.js).
 * @param {any} member @param {string} date
 * @returns {boolean}
 */
export function rosteredSpareDay(member, date) {
    const d = parseISODate(date);
    const role = roleOn(member, d);
    if (role !== 'CEA' && role !== 'CES') return false;
    return getBaseShift(member, d) === 'SPARE';
}

/**
 * The Monday to Saturday of the week holding `date`, as ISO dates. A roster week runs Sunday to
 * Saturday and a Sunday never costs a day, so the days that can cost are the same either way.
 * @param {string} date @returns {string[]}
 */
export function spareWeekDays(date) {
    const d = parseISODate(date);
    const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
    return Array.from({ length: 6 }, (_, i) => formatISO(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i)));
}

/**
 * Has this Spare week already spent its four days BEFORE `date`? The first four days with leave in a
 * week cost a day each, in date order, and any after them cost nothing (owner, 21 Nov 2026: "1 a day,
 * at most 4"). Every day of the week as rostered counts (`rosteredSpareDay`), and only a day that
 * would cost on its own.
 * @param {any} member @param {string} date @param {Map<string, any>|null|undefined} ovByDate
 * @returns {boolean}
 */
function pastSpareWeekCap(member, date, ovByDate) {
    if (!rosteredSpareDay(member, date)) return false;
    let before = 0;
    for (const day of spareWeekDays(date)) {
        if (day >= date) break;
        const ov = ovByDate && typeof ovByDate.get === 'function' ? ovByDate.get(day) : null;
        if (ov?.type === 'annual_leave' && rosteredSpareDay(member, day) && costsWithoutSpareCap(member, day, ovByDate)) before++;
    }
    return before >= SPARE_WEEK_MAX_DAYS;
}

/**
 * Would leave on `date` cost a day ON ITS OWN — every rule but the Spare week's? `consumesEntitlement`
 * is this plus the week's cap; the cap asks this of the week's earlier days, so it cannot recurse.
 * @param {any} member @param {string} date @param {Map<string, any>|null|undefined} ovByDate
 * @returns {boolean}
 */
export function costsWithoutSpareCap(member, date, ovByDate) {
    if (!member || !date) return false;
    if (isSunday(date)) return false;
    // Before the member joined, nothing costs a day — a record's own evidence included (header).
    if (isBeforeMemberStart(member, parseISODate(date))) return false;
    // CHRISTMAS DAY AND BOXING DAY NEVER COST A DAY, FROM 2026 (owner, 5 Nov 2026): the station is
    // closed. The derived Christmas leave (`isChristmasLeaveDay`) writes nothing and never reaches this;
    // this line is for a DOCUMENT recorded there — including one booked as a swapped working day, which
    // the `replacedType` test below would otherwise charge. Earlier years keep the counts they had.
    if (isChristmasClosureDate(date)) return false;

    // The day is (or is about to be) AL-overridden, so the question is what is UNDERNEATH it.
    const ov = ovByDate && typeof ovByDate.get === 'function' ? ovByDate.get(date) : null;
    const base = getBaseShift(member, parseISODate(date));
    // An AL doc has already replaced whatever it covered, so `replacedType` is the only surviving
    // record of it — and so has an ABSENCE carrying a chain, whose `replacedType` the leave written
    // over it will inherit; any other override IS the thing underneath and answers directly.
    // Type alone classifies a reconstructed override: no write path preserves the replaced VALUE, and
    // every type whose value could matter has it pinned by the rules (`correction` is always 'RD').
    // The BASE goes in too: an Other day or a Spare turn on a base rest day is rest-day working, and
    // leave over it is free, like leave over RDW (owner, 10 Nov 2026 — isContractedWorkOverride).
    const contracted = isContractedWorkOverride(contractEvidence(ov), base);
    if (contracted !== null) return contracted;

    // No override information — the base roster decides. (Leave dated before the member joined
    // never gets this far: the start-date test above answers it, evidence or none.)
    return !isRestShift(base);
}

/**
 * The AL dates that consume `member`'s entitlement in `year`.
 *
 * @param {object} args
 * @param {Array<{memberName?:string, type?:string, date?:string}>} args.overrides every override the
 *        page holds — filtered here, so no caller has to remember which fields matter. The AL docs
 *        among them carry `replacedType`, which is how a swapped-in day is still recognised as
 *        contracted work after the AL doc replaced the `shift` doc that said so.
 * @param {any} args.member the team-member OBJECT (needed for the base-shift lookup), not the name
 * @param {string|number} args.year calendar year — the year whose ALLOWANCE is being counted, which
 *        is why next January's moved days are in the answer and this January's moved days are not
 * @param {Set<string>|null} [args.exclude] dates to leave out because the caller is re-accounting
 *        them — the ones a batch is about to overwrite or delete. Omit for "everything on record".
 * @returns {Set<string>} ISO dates, deduplicated
 */
export function countedAlDates({ overrides, member, year, exclude = null }) {
    const y = parseInt(String(year), 10);
    const yearStr = String(y);
    // Next January is read because a day there may come out of THIS year's allowance.
    const nextJanuary = `${y + 1}-01-`;
    const out = /** @type {Set<string>} */ (new Set());
    if (!member || !Array.isArray(overrides) || !Number.isFinite(y)) return out;

    // ONE WINNER PER DATE, resolved across ALL of the member's overrides — not the AL docs alone.
    // Duplicate docs for one date are real (two devices, an offline retry): an orphan AL beside a
    // NEWER non-AL winner must not count. `shouldReplaceOverride` is the resolution every other
    // consumer applies, so this module cannot disagree with them.
    const winnerByDate = /** @type {Map<string, any>} */ (new Map());
    for (const o of overrides) {
        if (!o || o.memberName !== member.name) continue;
        // …and the last days of the December BEFORE, never counted here but possibly sharing a Spare
        // week with this January's first days: the week's four is spent in date order.
        if (!o.date) continue;
        const weekBefore = o.date >= `${y - 1}-12-26` && o.date.startsWith(`${y - 1}-12-`);
        if (!(o.date.startsWith(yearStr) || o.date.startsWith(nextJanuary) || weekBefore)) continue;
        if (exclude && exclude.has(o.date)) continue;
        if (shouldReplaceOverride(winnerByDate.get(o.date), o)) winnerByDate.set(o.date, o);
    }
    for (const [date, winner] of winnerByDate) {
        if (winner.type !== 'annual_leave') continue;
        // The year this day's ALLOWANCE is — its own, or the year before for a moved January day.
        // Asked of the WINNER, so an orphaned copy carrying a stale `leaveYear` cannot move a day.
        if (leaveYearOf({ ...winner, date }) !== y) continue;
        if (!consumesEntitlement(member, date, winnerByDate)) continue;
        out.add(date);
    }
    return out;
}

/**
 * Where a member stands on annual leave for a year.
 *
 * `taken + booked` is the number of days consumed; `remaining` is the entitlement less that total,
 * and may be NEGATIVE — an over-booked member is a real state the banner renders as "N over allowance",
 * so it is reported rather than clamped at zero.
 *
 * @param {object} args
 * @param {Array<{memberName?:string, type?:string, date?:string}>} args.overrides
 * @param {any} args.member the team-member object
 * @param {string|number} args.year
 * @param {string} args.todayStr today as `YYYY-MM-DD` — passed in, never read from a clock
 * @returns {{entitlement:number|null, taken:number, booked:number, remaining:number|null}}
 *   entitlement/remaining are null when the role has no entitlement on record — render neither.
 */
export function alPosition({ overrides, member, year, todayStr }) {
    const entitlement = entitlementFor(member, year, overrides);
    const dates = countedAlDates({ overrides, member, year });

    let taken = 0;
    let booked = 0;
    for (const d of dates) {
        if (d <= todayStr) taken++;
        else booked++;
    }
    // NO ENTITLEMENT ON RECORD PROPAGATES AS null, IT DOES NOT BECOME A NUMBER. `entitlement - taken
    // - booked` on null is `0 - 1 - 0`, an invented figure rendered as confidently as a real one.
    // Taken and booked are still counted: they are facts about recorded days, whatever the entitlement.
    if (entitlement === null) return { entitlement: null, taken, booked, remaining: null };
    return { entitlement, taken, booked, remaining: entitlement - taken - booked };
}

/**
 * How a `remaining` figure is SHOWN — one rule for every surface that prints a balance: the
 * Calendar's leave panel, and Admin's AL banner and its collapsed card's chip.
 *
 * OVER, NOT MINUS (owner: Admin says "3 over" like the Calendar). "-16 REMAINING" read as an error
 * code, so past the allowance the figure is shown WITHOUT its minus and the words say "over"; the
 * tone is the same red.
 *
 * The tone thresholds are the ones every surface already used: nothing left (0 or over) is `none`,
 * one to five days is `low`, anything more is `ok`. Each surface maps the tone onto its own class.
 *
 * Give it a number: a null `remaining` means no entitlement on record (`alPosition`), and the caller
 * shows no figure at all rather than asking for one.
 * @param {number} remaining entitlement less taken and booked — may be negative
 * @returns {{ tone: 'none'|'low'|'ok', over: boolean, figure: string, label: 'Remaining'|'Over', short: 'left'|'over' }}
 *   `figure` the number to print (never with a minus); `label` the figure's caption ("Remaining" /
 *   "Over"); `short` the word after it where the space is a chip's ("12 left" / "3 over").
 */
export function balanceFace(remaining) {
    const over = remaining < 0;
    return {
        tone: remaining <= 0 ? 'none' : remaining <= 5 ? 'low' : 'ok',
        over,
        figure: String(Math.abs(remaining)),
        label: over ? 'Over' : 'Remaining',
        short: over ? 'over' : 'left',
    };
}

/**
 * The January leave days that may come out of the PREVIOUS year's allowance, grouped by January,
 * with where both years stand (the owner's decisions are in leave-year.js's header).
 *
 * A day is listed when its WINNING record is annual leave on a January the choice covers
 * (`offeredJanuaries`) and the day actually spends leave (`consumesEntitlement`). A rest day, a
 * Sunday or a day before the member joined costs nothing in either year, so there is no choice to
 * make and it is not listed.
 *
 * `prevOpen` is the cap — "no more than the previous year has left". A day may move back only while
 * the previous year has at least one day left; a day already moved may always move forward again.
 * Both positions come from `alPosition`, the function the banner reads, so the two cannot disagree.
 * A January whose member has no entitlement on record for either year is left out: there is no
 * figure to judge the cap by.
 *
 * @param {{ overrides: any[], member: any, todayStr: string }} args
 * @returns {Array<{ january: number, prev: number,
 *                   days: Array<{ date: string, from: number }>,
 *                   positions: Record<number, ReturnType<typeof alPosition>>,
 *                   prevOpen: boolean }>}
 */
export function leaveYearChoices({ overrides, member, todayStr }) {
    /** @type {any[]} */
    const out = [];
    if (!member || !Array.isArray(overrides)) return out;
    const winners = winningEntriesOfType(overrides, member.name, 'annual_leave');
    for (const january of offeredJanuaries(todayStr)) {
        const prefix = `${january}-01-`;
        const inJanuary = winners.filter(o => o.date.startsWith(prefix));
        // The winners are all annual leave, so this map is exactly what `consumesEntitlement` reads.
        // It holds EVERY winning leave day, not January's alone: a Spare week over New Year spends its
        // four in date order from the December days (as `countedAlDates` reads the December before).
        const byDate = new Map(winners.map(o => [o.date, o]));
        const days = inJanuary
            .filter(o => consumesEntitlement(member, o.date, byDate))
            .map(o => ({ date: o.date, from: leaveYearOf(o) }));
        if (!days.length) continue;
        const prev = january - 1;
        const prevPos = alPosition({ overrides, member, year: prev, todayStr });
        const ownPos  = alPosition({ overrides, member, year: january, todayStr });
        if (prevPos.remaining === null || ownPos.remaining === null) continue;
        out.push({ january, prev, days, positions: { [prev]: prevPos, [january]: ownPos },
                   prevOpen: prevPos.remaining >= 1 });
    }
    return out;
}

/**
 * A Dispatcher's entitlement split into the two things it is made of — `{ base, lieu }` — or `null`
 * for anybody else, and for a Dispatcher with no entitlement on record.
 *
 * ── WHY THIS IS NOT `entitlement - 22` ──────────────────────────────────────────────────────────
 *
 * The Admin AL banner once subtracted a literal 22 to recover the lieu count, which is right only
 * while the base IS 22: a mid-year joiner's card read `22 base + -8 BH lieu`. The split is DERIVED
 * from the figure `entitlementFor` returns: the base is what a pro-rated year replaces it with, and
 * the lieu count is what the total exceeds it by. `al-entitlement.test.mjs` pins `base + lieu +
 * boxingDay === entitlement` so the parts cannot drift apart in silence.
 *
 * `proRated` is reported because the caption needs to SAY so: "12 base" reads like a mistake beside
 * a colleague's 22 unless it explains itself.
 *
 * @param {{ member: any, year: number|string, overrides: any[] }} args
 * @returns {{ base: number, lieu: number, boxingDay: number, boxingDayYears: number[], proRated: boolean } | null}
 */
export function dispatcherBreakdown({ member, year, overrides }) {
    const y = parseInt(String(year), 10);
    // The grade that decides the YEAR (al-contract.js, owner 16 Nov 2026), not `role` today: the caption
    // must split the figure `entitlementFor` returns, and that figure is a Dispatcher's only then.
    if (!member || allowanceRole(member, y) !== 'Dispatcher') return null;
    const entitlement = entitlementFor(member, y, overrides);
    // A year before the Dispatcher joined has no entitlement on record (getALEntitlement), so there
    // is nothing to split — without this, `entitlement - base` would invent a lieu count from null.
    if (entitlement === null) return null;

    const proRated = member.proRatedAL?.[y] !== undefined;
    const base = dispatcherBaseAL(member, y);   // the figure getALEntitlement starts from — one formula
    // A BOXING DAY IN LIEU IS NOT A BANK-HOLIDAY DAY: it was earned on the year before's Boxing Day
    // (christmas-leave.js), which need not be a bank holiday, so it is kept out of `lieu`, which the
    // caption calls the days "for bank holidays worked".
    // `base + lieu + boxingDay === entitlement` is what the test pins.
    const split = boxingDayLieuSplit(member, y, overrides);
    const boxingDay = split.carried + split.late;
    return { base, lieu: entitlement - base - boxingDay, boxingDay, boxingDayYears: boxingDayYearsOf(y, split), proRated };
}

/**
 * The one line that explains what a member's entitlement is made of, or `null` when it is the plain
 * contract figure and there is nothing to explain. The Admin banner and the Calendar's leave panel
 * both print it, so the two cannot describe the same number differently.
 *
 * A Dispatcher: `22 + 4 for bank holidays worked`, with `(pro-rated)` after the 22 for a joining year
 * and `+ 1 for working Boxing Day 2026` when earned — words, not "base" and "BH lieu", because
 * colleagues have not met the abbreviations. Anybody else: a line only when the figure differs from
 * every colleague's on their grade — a joining year's `proRatedAL` ("Pro-rated for starting part way
 * through 2026"), or a Boxing Day day earned — because a figure unlike everybody else's needs its
 * reason beside it.
 *
 * THE LINE NAMES THE BOXING DAY'S YEAR. The day is usually in the next year's allowance, so "for
 * working Boxing Day" alone, under 2027, reads as a Boxing Day yet to happen. One spent in its own
 * year says so (`lateWords`).
 *
 * @param {{ member: any, year: number|string, overrides: any[] }} args
 * @returns {string|null}
 */
export function entitlementNote({ member, year, overrides }) {
    if (!member) return null;
    const split = dispatcherBreakdown({ member, year, overrides });
    if (split) {
        const parts = [`${split.base}${split.proRated ? ' (pro-rated)' : ''}`, `${split.lieu} for bank holidays worked`];
        for (const by of split.boxingDayYears) parts.push(`1 for working Boxing Day ${by}${lateWords(by, year)}`);
        return parts.join(' + ');
    }
    if (entitlementFor(member, year, overrides) === null) return null;
    const y = parseInt(String(year), 10);
    /** @type {string[]} */ const parts = [];
    if (member.proRatedAL?.[y] !== undefined) parts.push(`Pro-rated for starting part way through ${y}`);
    for (const by of boxingDayYearsOf(y, boxingDayLieuSplit(member, y, overrides))) {
        parts.push(`${parts.length ? 'includes' : 'Includes'} 1 day in lieu for working Boxing Day ${by}${lateWords(by, y)}`);
    }
    return parts.length ? parts.join('; ') : null;
}

/** The Boxing Days whose day in lieu `year` holds, oldest first. @param {number} year @param {{carried: number, late: number}} split */
function boxingDayYearsOf(year, split) {
    return [...(split.carried ? [boxingDayForAllowance(year)] : []), ...(split.late ? [year] : [])];
}

/** A day in lieu spent in its own year says so: under that year's allowance, "for working Boxing Day 2026" alone
 *  would read as a day earned for the year after. @param {number} boxingYear @param {number|string} year */
function lateWords(boxingYear, year) {
    return boxingYear === Number(year) ? ', taken on leave after it that December' : '';
}

/**
 * The member's overrides of one `type`, AFTER resolving which document actually wins each date.
 *
 * ── WHY A LIST CANNOT BE BUILT BY FILTERING ───────────────────────────────────────────────────
 *
 * Duplicate documents for one date are real — two devices, an offline retry. A list that FILTERED
 * the raw collection finds an old orphan `annual_leave` doc under a NEWER `shift` doc, asks only
 * "does this date consume?" — which the winning shift answers yes to — and lists as leave a day whose
 * override no longer is, while the banner beside it correctly leaves it out.
 *
 * The rule is order, not arithmetic: **resolve the winner FIRST, and only then ask what it is.**
 *
 * @param {Array<any>} overrides every override the page holds
 * @param {string} memberName
 * @param {string} type `'annual_leave'` | `'sick'` | …
 * @returns {Array<any>} the winning documents of that type, ascending by date
 */
export function winningEntriesOfType(overrides, memberName, type) {
    if (!Array.isArray(overrides)) return [];
    const winnerByDate = /** @type {Map<string, any>} */ (new Map());
    for (const o of overrides) {
        if (!o || o.memberName !== memberName || !o.date) continue;
        if (shouldReplaceOverride(winnerByDate.get(o.date), o)) winnerByDate.set(o.date, o);
    }
    return [...winnerByDate.values()]
        .filter(o => o.type === type)
        .sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
}

/**
 * SINGLE SOURCE: is `dateStr` a WORKING day for the member? Used by every AL/absence range
 * operation — the two previews (AL/sick rest-day counts) AND the save/entitlement/write paths.
 * Rule (Sunday -> override -> base): Sundays are never worked (uncontracted, CLAUDE.md); an existing
 * override decides the day (worked iff its value is not a rest shift, so a non-rest override like
 * RDW on a base-RD day IS worked); otherwise the base shift decides.
 *
 * Previously reimplemented four times, and the previews counted a base-RD day with an RDW override
 * as REST while the save paths counted it as WORKED. This is the save/write rule, for both.
 * @param {any} memberObj  teamMembers entry
 * @param {string} dateStr  YYYY-MM-DD
 * @param {Map<string, any>|null} [ovByDate]  from buildMemberDateMap. Omit only where there are none to
 *        hand — like `consumesEntitlement`'s, an absent map means "no override", never a crash.
 * @returns {boolean}
 */
export function isWorkingDate(memberObj, dateStr, ovByDate = null) {
    if (isSunday(dateStr)) return false;
    const ov = ovByDate && typeof ovByDate.get === 'function' ? ovByDate.get(dateStr) : null;
    // A Spare turn saved on 25 or 26 December is not work: the two days can never be spare days, in
    // any year (owner, 19 Nov 2026), so it is the rest day underneath.
    if (ov) return !isRestShift(ov.value) && !(ov.value === 'SPARE' && isChristmasRD(parseISODate(dateStr)));
    return !isRestShift(getBaseShift(memberObj, parseISODate(dateStr)));
}
