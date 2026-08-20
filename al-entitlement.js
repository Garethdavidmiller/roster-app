// @ts-check
/**
 * Which annual-leave days count against a member's entitlement for a year — and, from that, where
 * they stand: taken, booked, remaining.
 *
 * ── WHY THIS IS A MODULE AND NOT FOUR FILTERS ───────────────────────────────────────────────────
 *
 * `projectAnnualLeaveOverage` (roster-data.js) has been shared since it was written. What was never
 * shared is the thing FEEDING it — the set of existing AL dates — and by v21.45 that set was being
 * built by hand in FOUR places, in three different ways:
 *
 *   · admin-app.js `updateALBanner`     — member + annual_leave + year + !isSunday
 *   · admin-app.js week-grid save       — the same, plus the dates this batch overwrites or deletes
 *   · admin-al.js  pre-save cap check   — the same, PLUS a rest-day test
 *   · calendar-al-lightbox.js (v21.46)  — the same, PLUS a start-date test, and no rest-day test
 *
 * So the app answered one question four times and could disagree with itself: the banner said a
 * member had fewer days left than the save path believed, and the manager reading "0 left" was told
 * something the app itself would not act on. That is the failure worth preventing — not the
 * duplication, which is merely how it happened. Note what the shape of it did: each site was fixed
 * where its own bug was REPORTED, so every one ended up holding a different subset of the rules and
 * none of them was wrong on purpose.
 *
 * ── THE TWO RULES, AND THE THIRD THAT IS ALREADY IMPLIED ────────────────────────────────────────
 *
 * **A Sunday never counts.** Sundays are uncontracted for every grade, so AL cannot be booked on
 * one and a legacy document that says otherwise must not consume entitlement. This is the read-side
 * face of the policy declared as `SUNDAY_FORBIDDEN_TYPES` in override-utils.js; the write paths
 * refuse, and this makes sure a document that got in before they did cannot spend a day.
 *
 * **A day whose BASE shift is a rest day never counts.** A member does not spend annual leave on a
 * day they were not working. The rule matters because the two halves of the question are resolved
 * differently: NEW dates are filtered through `isWorkingDate`, which already excludes rest days, so
 * an existing-AL set that keeps them is comparing unlike with unlike — the projected total comes out
 * high and a booking well inside the entitlement meets a spurious "over entitlement" confirm bar.
 * `admin-al.js` had this and carried the reasoning; the other three did not have it at all.
 *
 * **A day before the member joined never counts — and it needs no rule of its own.** The calendar
 * added an explicit `isBeforeMemberStart` test at v17.41 because its balance disagreed with its own
 * grid. That was the right fix THERE, where there was no rest-day test; here it would be dead code,
 * because `getBaseShift` already returns `'RD'` for every date before `startDate`, so the rest-day
 * rule answers it. It is written down rather than coded because a redundant guard is worse than
 * none: nothing can make it fail, so nothing tells you when it stops being redundant. The test
 * pins the MECHANISM — if `getBaseShift` ever stops suppressing pre-start days, it fails there.
 *
 * ── THE TAKEN / BOOKED SPLIT IS TODAY, NOT THE DEADLINE ─────────────────────────────────────────
 *
 * `alPosition` splits the counted days at `todayStr` — on or before today is TAKEN, after is BOOKED.
 * Both consume entitlement and `remaining` subtracts both; the split exists only because a manager
 * reads the two differently. Passing the date in rather than reading a clock keeps the whole module
 * pure, which is what lets the boundary (a day that is today) be tested at all.
 */

import { getALEntitlement, getBaseShift, isSunday, parseISODate } from './roster-data.js';
import { isRestShift, isContractedWorkOverride } from './override-utils.js';

/**
 * Does a single date consume `member`'s entitlement if AL is recorded on it?
 *
 * Exported because BOTH halves of the overage projection have to ask it. `projectAnnualLeaveOverage`
 * adds existing days to new ones, so filtering only the existing set makes the two sides count
 * differently — a rest day already on record is free while the identical day being booked right now
 * is not, and the member meets a confirm bar for leave they are not spending. `admin-al.js` avoids
 * this by routing new dates through `isWorkingDate`; the week-grid save has no such filter, so it
 * calls this directly.
 *
 * @param {any} member the team-member object
 * @param {string} date ISO `YYYY-MM-DD`
 * @param {Map<string, any>|null} [ovByDate] the overrides in play, keyed by date. Omit only where
 *        there genuinely are none to hand — without it a swapped-in day reads as a rest day.
 * @returns {boolean}
 */
export function consumesEntitlement(member, date, ovByDate = null) {
    if (!member || !date) return false;
    if (isSunday(date)) return false;

    // The day is (or is about to be) AL-overridden, so the question is what is UNDERNEATH it.
    const ov = ovByDate && typeof ovByDate.get === 'function' ? ovByDate.get(date) : null;
    // An AL doc has already replaced whatever it covered, so `replacedType` is the only surviving
    // record of it; any other override IS the thing underneath and answers directly.
    const under = ov && ov.type === 'annual_leave'
        ? (ov.replacedType ? { type: ov.replacedType, value: ov.replacedValue } : null)
        : ov;
    const contracted = isContractedWorkOverride(under);
    if (contracted !== null) return contracted;

    // No override information — the base roster decides, which is what this function did for every
    // date before v21.55 and still does for every AL written before it. This also settles leave
    // dated before the member joined: `getBaseShift` returns 'RD' for every such date, so no
    // separate start-date test belongs here (see the header).
    return !isRestShift(getBaseShift(member, parseISODate(date)));
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
 * @param {string|number} args.year calendar year
 * @param {Set<string>|null} [args.exclude] dates to leave out because the caller is re-accounting
 *        them — the ones a batch is about to overwrite or delete. Omit for "everything on record".
 * @returns {Set<string>} ISO dates, deduplicated
 */
export function countedAlDates({ overrides, member, year, exclude = null }) {
    const yearStr = String(year);
    const out = /** @type {Set<string>} */ (new Set());
    if (!member || !Array.isArray(overrides)) return out;

    // Keyed by date so `consumesEntitlement` can read the AL doc's own `replacedType`. Built from
    // the AL docs alone: any other override for the date has, by definition, been superseded by the
    // AL doc, so feeding it here would answer about a day that no longer exists.
    const alByDate = /** @type {Map<string, any>} */ (new Map());
    for (const o of overrides) {
        if (!o || o.memberName !== member.name || o.type !== 'annual_leave') continue;
        if (!o.date || !o.date.startsWith(yearStr)) continue;
        if (exclude && exclude.has(o.date)) continue;
        alByDate.set(o.date, o);
    }
    for (const [date] of alByDate) {
        if (!consumesEntitlement(member, date, alByDate)) continue;
        out.add(date);
    }
    return out;
}

/**
 * Where a member stands on annual leave for a year.
 *
 * `taken + booked` is the number of days consumed; `remaining` is the entitlement less that total,
 * and may be NEGATIVE — an over-booked member is a real state the banner renders as "N over limit",
 * so it is reported rather than clamped at zero.
 *
 * @param {object} args
 * @param {Array<{memberName?:string, type?:string, date?:string}>} args.overrides
 * @param {any} args.member the team-member object
 * @param {string|number} args.year
 * @param {string} args.todayStr today as `YYYY-MM-DD` — passed in, never read from a clock
 * @returns {{entitlement:number, taken:number, booked:number, remaining:number}}
 */
export function alPosition({ overrides, member, year, todayStr }) {
    const entitlement = getALEntitlement(member, parseInt(String(year), 10), overrides);
    const dates = countedAlDates({ overrides, member, year });

    let taken = 0;
    let booked = 0;
    for (const d of dates) {
        if (d <= todayStr) taken++;
        else booked++;
    }
    return { entitlement, taken, booked, remaining: entitlement - taken - booked };
}
