// @ts-check
/**
 * al-contract.js — a member's CONTRACT leave allowance for a year: the grade that decides it, the
 * figure that grade carries, and a Dispatcher's days in lieu for bank holidays worked.
 *
 * Owns: `getALEntitlement`, `allowanceRole`, `dispatcherBaseAL`, `countDispatcherBankHolidaysWorked`,
 *   `countsAsDispatcherBankHoliday`.
 * Does NOT own: the WHOLE allowance — `entitlementFor` (al-entitlement.js) adds the day in lieu for a
 *   worked Boxing Day (christmas-leave.js) on top of this, and is the one door every surface reads.
 *   christmas-leave.test.mjs fails if any module but this one and al-entitlement.js names
 *   `getALEntitlement`.
 *
 * ── WHY IT LEFT roster-data.js (Nov 2026) ───────────────────────────────────────────────────────
 *
 * It was a RULE living in a data module, held at its size cap (coordinator-ratchet.test.mjs), and the
 * owner's "role at the time" decision was about to grow it. The ratchet's v22.50 note named the seam
 * and the one obstacle: `countDispatcherBankHolidaysWorked` reads the base roster, so it had to come
 * too. It reads the roster through `getBaseShift`, as every other consumer does, so nothing here
 * reaches into the pattern tables. roster-data.js does NOT re-export these names: this module imports
 * it, so a re-export would be an import cycle (import-graph.test.mjs).
 *
 * ── THE GRADE THAT DECIDES A YEAR (owner, 16 Nov 2026: "role at the time") ──────────────────────
 *
 * `role` is the grade NOW, and the allowance read it for every year — so a member promoted on
 * 22 November into a grade with no leave on record (Management) read `null` for the whole of a year
 * they spent eleven months in a graded post, and one promoted the other way read the new grade's
 * figure back over years before it. The rule (`allowanceRole`): a year is judged by the grade in
 * force on 31 DECEMBER of it; when that grade has no leave figure here, by the most recent grade held
 * DURING the year that does. A member with no `roleHistory` reads `role`, exactly as before.
 *
 * A Dispatcher's day in lieu is earned on a DAY, so it follows the grade on that day as well: a bank
 * holiday counts when the year's allowance is a Dispatcher's AND the member was a Dispatcher on it
 * (`countsAsDispatcherBankHoliday`). The Boxing Day rule (christmas-leave.js) asks the same predicate,
 * which is what keeps "counted once" true across a change of grade.
 *
 * ── ENTITLEMENTS (calendar year, resets 1 Jan) ──────────────────────────────────────────────────
 *
 *   CES        → 34 days
 *   Dispatcher → 22 days base + 1 day in lieu per bank holiday actually worked that year. "Worked"
 *                means the resolved shift (base roster after overrides) is a worked shift
 *                (`isWorkedShift`): not RD, OFF, SPARE, AL or SICK. A trainee's rostered training day
 *                (`TRG`, `fixedRoster[3]`) IS worked, so a bank holiday on one earns the day — owner,
 *                16 Nov 2026, deliberate.
 *   CEA        → 34 days on a BILINGUAL CONTRACT (`bilingualContract: true`), else 32. The CONTRACT,
 *                never the rosterType: a plain CEA is routinely put on a bilingual LINE until a CEA one
 *                frees up, so the line proves nothing (a CEA on a fixed line is 32 too). Pinned by
 *                roster-data.test.mjs, incl. the line-vs-contract case.
 *   anything else → null: no entitlement on record, never a guessed figure.
 */

import { getBankHolidays, getBaseShift, isBankHoliday, isWorkedShift, formatISO } from './roster-data.js';
import { shouldReplaceOverride, isBeforeMemberStart } from './override-utils.js';
import { roleOn, rolesInRange } from './roster-roles.js';

/** The grades this app holds a leave figure for. Anything else (Management) has none on record. */
const GRADES_WITH_LEAVE = Object.freeze(['CEA', 'CES', 'Dispatcher']);

/**
 * The grade that decides `member`'s leave allowance for `year` (owner, 16 Nov 2026 — header): the
 * grade on 31 December, or, when that grade has no leave figure, the most recent grade held during
 * the year that does. Without a `roleHistory` it is `role`, for every year, as it always was.
 * @param {any} member  teamMembers entry
 * @param {number|string} year
 * @returns {string|undefined}
 */
export function allowanceRole(member, year) {
    if (!member) return undefined;
    const y = Number(year);
    const yearEnd = new Date(y, 11, 31);
    const atYearEnd = roleOn(member, yearEnd);
    if (!member.roleHistory?.length || GRADES_WITH_LEAVE.includes(String(atYearEnd))) return atYearEnd;
    const held = rolesInRange(member, new Date(y, 0, 1), yearEnd);
    for (let i = held.length - 1; i >= 0; i--) {
        if (GRADES_WITH_LEAVE.includes(String(held[i].role))) return held[i].role;
    }
    return atYearEnd;
}

/**
 * Does the Dispatcher bank-holiday rule count `date` — a bank holiday, on or after the member's start,
 * in a year whose allowance is a Dispatcher's, on which they WERE a Dispatcher? Whether it was worked
 * is the caller's question. christmas-leave.js asks this too (`allowanceForBoxingDay`), so a Boxing
 * Day this rule counts is never counted again there.
 * @param {any} member  teamMembers entry
 * @param {Date} date
 * @returns {boolean}
 */
export function countsAsDispatcherBankHoliday(member, date) {
    if (!member || !isBankHoliday(date)) return false;
    // A day before the member joined earns nothing, whatever a record says about it (review, 16 Nov 2026).
    if (isBeforeMemberStart(member, date)) return false;
    return allowanceRole(member, date.getFullYear()) === 'Dispatcher' && roleOn(member, date) === 'Dispatcher';
}

/**
 * Count how many UK bank holidays a Dispatcher actually worked in a given year, after applying
 * overrides. Each one `countsAsDispatcherBankHoliday` admits and the day's winning value is worked
 * earns 1 day in lieu.
 *
 * @param {any}    member   — teamMembers entry
 * @param {number} year     — calendar year to check
 * @param {Array<any>}  overrides — flat array of override objects { memberName, date, value, ... }
 * @returns {number}  count of bank holidays on which the member worked
 */
export function countDispatcherBankHolidaysWorked(member, year, overrides) {
    // Build a date → winning-override lookup for this member, applying shouldReplaceOverride
    // precedence (manual beats roster_import; within a class, newer createdAt wins). A plain
    // last-in-array-wins map let a stale roster_import shadow a manual RDW on a bank-holiday date,
    // miscounting the dispatcher's lieu-day entitlement depending on Firestore result order.
    const overrideMap = new Map();
    for (const o of overrides || []) {
        if (o.memberName === member.name && o.date) {
            if (shouldReplaceOverride(overrideMap.get(o.date), o)) overrideMap.set(o.date, o);
        }
    }

    let lieuDays = 0;
    for (const bh of getBankHolidays(year)) {
        if (!countsAsDispatcherBankHoliday(member, bh)) continue;
        // Use local-time date string to match Firestore override keys (YYYY-MM-DD)
        const dateStr = formatISO(bh);

        // Override takes precedence; fall back to base roster.
        // NOTE: getBaseShift applies isChristmasRD, so 25 and 26 Dec always read 'RD' from the base
        // roster even when a dispatcher is due to work. A Christmas bank holiday counts only when an
        // override records the member AT WORK that day — any worked value (isWorkedShift), not only RDW.
        // A trainee's rostered 'TRG' is worked, so it earns the day (owner, 16 Nov 2026 — header).
        const shift = overrideMap.has(dateStr)
            ? overrideMap.get(dateStr).value
            : getBaseShift(member, bh);

        if (isWorkedShift(shift)) lieuDays++;
    }
    return lieuDays;
}

/** A Dispatcher's leave for `year` BEFORE any day in lieu: the joining year's transcribed `proRatedAL`,
 *  else 22. The one figure the allowance (getALEntitlement) and its caption's split (dispatcherBreakdown,
 *  al-entitlement.js) both start from, so the two cannot diverge. @param {any} member @param {number} year */
export function dispatcherBaseAL(member, year) { return member?.proRatedAL?.[year] ?? 22; }

/**
 * The CONTRACT annual leave entitlement for a staff member in a given year, by the grade that decides
 * that year (`allowanceRole`). For a Dispatcher it is dynamic: a 22-day base (a joining year's
 * `proRatedAL` replaces it) plus one day in lieu for every bank holiday worked as a Dispatcher. A CEA
 * or a CES year is a fixed figure, or the joining year's `proRatedAL`.
 *
 * NOT THE WHOLE ALLOWANCE — read it through `entitlementFor` (al-entitlement.js), which from 2027 adds
 * the day in lieu earned by working the Boxing Day before, when due at work (christmas-leave.js).
 * `christmas-leave.test.mjs` fails if any other module calls this directly.
 *
 * @param {any}    member    - teamMembers entry
 * @param {number} [year]    - calendar year; defaults to current year
 * @param {Array<any>}  [overrides] - all override objects for this member; defaults to []
 * @returns {number|null} null when there is no entitlement on record for this member — the member
 *   could not be resolved at all, no grade they held that year has a leave figure here, or the year
 *   ended before they joined. Callers must TEST for it and refuse to render, never coerce: `null -
 *   taken - booked` is a plausible NUMBER, not NaN, so the one arithmetic that looks harmless is the
 *   one that invents a balance.
 */
export function getALEntitlement(member, year = new Date().getFullYear(), overrides = []) {
    if (!member) return null;   // unresolved member — see the null convention below

    // NO ALLOWANCE FOR A YEAR BEFORE THE MEMBER JOINED (whole-app review, 10 Nov 2026). Such a year
    // read the full contract figure with all of it remaining — on the Calendar's leave panel, whose
    // year arrows reach back to MIN_YEAR, and in the January carry-back, which offered a January
    // starter the year before they arrived as somewhere to take their leave from. It is no
    // entitlement on record, so both fall into the em-dash state they already draw for null.
    if (member.startDate instanceof Date && year < member.startDate.getFullYear()) return null;

    const role = allowanceRole(member, year);

    // A DISPATCHER'S LIEU DAYS ARE EARNED, SO PRO-RATING MUST NOT REMOVE THEM (v22.50, owner
    // decision). The 22 is an allowance a part-year deserves part of; a lieu day is owed because a
    // specific day was worked, and arriving late in the year does not make that day less worked. So
    // this branch comes FIRST and `proRatedAL` scales only the base. It used to be checked above and
    // returned outright, so a mid-year Dispatcher's joining year skipped the lieu count and read two
    // days short — with nothing to say so, because a wrong leave balance still renders and still
    // books against. Cases and the reasoning: roster-data.test.mjs.
    if (role === 'Dispatcher') {
        return dispatcherBaseAL(member, year) + countDispatcherBankHolidaysWorked(member, year, overrides);
    }
    // Pro-rated entitlement takes priority for joiners in every other role, where the whole figure
    // IS an allowance and there is no earned component to protect.
    if (member.proRatedAL && member.proRatedAL[year] !== undefined) return member.proRatedAL[year];
    if (role === 'CES') return 34;
    // A CEA's entitlement follows the CONTRACT THEY HOLD, NOT THE LINE THEY ARE ON (owner, 6 Sep
    // 2026): a bilingual contract is 34 days, every other CEA 32, whatever pattern they work.
    //
    // **`rosterType === 'bilingual'` IS THE WRONG TEST AND IT LOOKS RIGHT** — a plain CEA is
    // routinely put on a bilingual line until a CEA one frees up, so the line is a rota fact and
    // keying on it would quietly hand that person two days they are not owed. The line-vs-contract
    // case is pinned in roster-data.test.mjs.
    //
    // The June 2026 correction was RIGHT about a CEA on a fixed line (32) and wrong to generalise: it
    // collapsed every CEA to 32 and took two days from the genuine bilingual contracts, unnoticed,
    // because a wrong balance still renders and still books.
    if (role === 'CEA') return member.bilingualContract === true ? 34 : 32;
    // NO ENTITLEMENT ON RECORD REFUSES RATHER THAN GUESSING (v22.45). This used to fall through to
    // `return 32`, so a Management row — or any role added later — would have been handed a CEA's
    // leave: a complete, plausible figure belonging to somebody else. A Management row is on no staff
    // picker (`hidden: true`; calendar-member.test.mjs pins it), and since the role-at-the-time rule a
    // manager who held a graded post during a year reads that grade's figure for it instead.
    // `null`, never 0: a zero is a claim about their leave and this function has none to make.
    return null;
}
