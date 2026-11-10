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
 * ── WHICH YEAR A DAY BELONGS TO IS ITS OWN — UNLESS IT IS A JANUARY DAY MOVED BACK (v25.18) ─────
 *
 * A day counts against the year of its date, except a January leave day carrying `leaveYear`: that
 * one counts against the year before (leave-year.js has the owner's decision and the reasoning). So
 * `countedAlDates` for a year reads the NEXT January too, and every day is counted towards
 * `leaveYearOf` its winning record — never towards the year its date merely starts with. One rule,
 * here, is what keeps the Admin banner, the booking cap and the Calendar's leave panel agreeing about
 * a moved day; a surface that still filtered by date prefix would count it twice, once in each year.
 *
 * ── THE TAKEN / BOOKED SPLIT IS TODAY, NOT THE DEADLINE ─────────────────────────────────────────
 *
 * `alPosition` splits the counted days at `todayStr` — on or before today is TAKEN, after is BOOKED.
 * Both consume entitlement and `remaining` subtracts both; the split exists only because a manager
 * reads the two differently. Passing the date in rather than reading a clock keeps the whole module
 * pure, which is what lets the boundary (a day that is today) be tested at all.
 */

import { getALEntitlement, dispatcherBaseAL, getBaseShift, isSunday, parseISODate } from './roster-data.js';
import { isRestShift, isContractedWorkOverride, contractEvidence, shouldReplaceOverride } from './override-utils.js';
import { leaveYearOf, offeredJanuaries } from './leave-year.js';
import { isChristmasClosureDate, boxingDayLieuDays } from './christmas-leave.js';

/**
 * A member's WHOLE annual-leave allowance for a year — the one door every surface reads it through
 * (v25.37). The contract figure is `getALEntitlement` (roster-data.js); on top of it goes the day in
 * lieu earned by working a Boxing Day the member was due to work (`boxingDayLieuDays`,
 * christmas-leave.js). No entitlement on record stays `null` — a day is not added to nothing, which
 * would make it a number (v22.45).
 *
 * It is not inside `getALEntitlement` because christmas-leave.js imports roster-data.js, so
 * roster-data.js cannot import it back (christmas-leave.js's header). A second door would be a
 * surface that quietly leaves the earned day out, so christmas-leave.test.mjs fails if any module
 * but this one calls `getALEntitlement`.
 * @param {any} member  teamMembers entry
 * @param {number|string} year
 * @param {Array<any>} [overrides] the member's overrides
 * @returns {number|null}
 */
export function entitlementFor(member, year, overrides = []) {
    const y = parseInt(String(year), 10);
    const contract = getALEntitlement(member, y, overrides);
    if (contract === null) return null;
    return contract + boxingDayLieuDays(member, y, overrides);
}

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
    // CHRISTMAS DAY AND BOXING DAY NEVER COST A DAY, FROM 2026 (v25.37, owner 5 Nov 2026). The
    // station is closed, so leave on either day is free. The Christmas leave a member due at work is
    // SHOWN (`isChristmasLeaveDay`, christmas-leave.js) writes nothing and so never reaches this function;
    // this line is for a DOCUMENT somebody recorded there — including one booked as a swapped working
    // day, which the `replacedType` test below would otherwise charge. The depot's spreadsheet marks
    // both days Closed, so the two agree. Earlier years keep the counts they always had.
    if (isChristmasClosureDate(date)) return false;

    // The day is (or is about to be) AL-overridden, so the question is what is UNDERNEATH it.
    const ov = ovByDate && typeof ovByDate.get === 'function' ? ovByDate.get(date) : null;
    const base = getBaseShift(member, parseISODate(date));
    // An AL doc has already replaced whatever it covered, so `replacedType` is the only surviving
    // record of it — and so has an ABSENCE carrying a chain, whose `replacedType` the leave written
    // over it will inherit (review A2); any other override IS the thing underneath and answers directly.
    // Type alone classifies a reconstructed override: no write path preserves the replaced VALUE,
    // and it is not needed — every type whose value could matter has that value pinned by the
    // rules (`correction` is always 'RD'), which is why isContractedWorkOverride classifies
    // `correction` by type (v21.56 — the first cut read a `replacedValue` nothing ever wrote).
    // The BASE goes in too: an Other day or a Spare turn on a base rest day is rest-day working, and
    // leave over it is free, like leave over RDW (owner, 10 Nov 2026 — isContractedWorkOverride).
    const contracted = isContractedWorkOverride(contractEvidence(ov), base);
    if (contracted !== null) return contracted;

    // No override information — the base roster decides, which is what this function did for every
    // date before v21.55 and still does for every AL written before it. This also settles leave
    // dated before the member joined: `getBaseShift` returns 'RD' for every such date, so no
    // separate start-date test belongs here (see the header).
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
    // Next January is read because a day there may come out of THIS year's allowance (v25.18).
    const nextJanuary = `${y + 1}-01-`;
    const out = /** @type {Set<string>} */ (new Set());
    if (!member || !Array.isArray(overrides) || !Number.isFinite(y)) return out;

    // ONE WINNER PER DATE, resolved across ALL of the member's overrides — not the AL docs alone
    // (v21.56, external sweep). Duplicate docs for one date are a real population (two devices, an
    // offline retry — the v16.23 lightbox fix names them), and the first cut last-write-wins'd over
    // just the AL docs: an orphan AL beside a NEWER non-AL winner still counted, and which of two
    // duplicate ALs answered depended on fetch iteration order. `shouldReplaceOverride` is the same
    // resolution every other consumer applies, so this module can no longer disagree with them.
    const winnerByDate = /** @type {Map<string, any>} */ (new Map());
    for (const o of overrides) {
        if (!o || o.memberName !== member.name) continue;
        if (!o.date || !(o.date.startsWith(yearStr) || o.date.startsWith(nextJanuary))) continue;
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
 * and may be NEGATIVE — an over-booked member is a real state the banner renders as "N over limit",
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
    // NO ENTITLEMENT ON RECORD PROPAGATES AS null, IT DOES NOT BECOME A NUMBER (v22.45).
    // `entitlement - taken - booked` on a null entitlement is a NUMBER — `0 - 1 - 0` — because
    // null coerces to 0. So the one arithmetic that looks harmless is the one that would invent a
    // remaining figure out of nothing and render it as confidently as a real one. Taken and booked
    // are still counted: those are facts about days actually recorded, true whatever the
    // entitlement is, and a caller may want them.
    if (entitlement === null) return { entitlement: null, taken, booked, remaining: null };
    return { entitlement, taken, booked, remaining: entitlement - taken - booked };
}

/**
 * The January leave days that may come out of the PREVIOUS year's allowance, grouped by January,
 * with where both years stand (v25.18 — the owner's decisions are in leave-year.js's header).
 *
 * A day is listed when its WINNING record is annual leave on a January the choice covers
 * (`offeredJanuaries`) and the day actually spends leave (`consumesEntitlement`). A rest day, a
 * Sunday or a day before the member joined costs nothing in either year, so there is no choice to
 * make and it is not listed.
 *
 * `prevOpen` is the cap — "no more than the previous year has left". A day may move back only while
 * the previous year has at least one day left; a day already moved may always move forward again.
 * Both positions come from `alPosition`, the function the banner reads, so the panel and the banner
 * cannot disagree about whether a year has room. A January whose member has no entitlement on
 * record for either year is left out: there is no figure to judge the cap by (v22.45's rule).
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
        // The winners are all annual leave, so this map is exactly what `consumesEntitlement` reads
        // for these dates: what the leave replaced, if anything (`replacedType`).
        const byDate = new Map(inJanuary.map(o => [o.date, o]));
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
 * The Admin AL banner subtracted a literal 22 to recover the lieu count, which is right only while
 * the base IS 22. For a mid-year joiner it is their pro-rated figure, so the subtraction went
 * negative and the card rendered `22 base + -8 BH lieu` — a nonsense line about a real person, on
 * the surface a manager reads to decide whether somebody can take a day off. It had been wrong for
 * B. Toth since she joined in June (as `-10`, when the pro-rata still suppressed her lieu days
 * entirely) and nothing failed, because a caption is not a calculation and nothing was checking it.
 *
 * The split is DERIVED from the same figure `entitlementFor` returns rather than recomputed: the
 * base is what a pro-rated year replaces it with, and the lieu count is whatever the total exceeds
 * it by. That keeps one formula, and `al-entitlement.test.mjs` pins `base + lieu + boxingDay ===
 * entitlement` so the parts cannot drift apart in silence — which is the failure this function
 * exists to end.
 *
 * `proRated` is reported because the caption needs to SAY so. "12 base" reads like a mistake beside
 * a colleague's 22 unless it explains itself.
 *
 * @param {{ member: any, year: number|string, overrides: any[] }} args
 * @returns {{ base: number, lieu: number, boxingDay: number, proRated: boolean } | null}
 */
export function dispatcherBreakdown({ member, year, overrides }) {
    if (!member || member.role !== 'Dispatcher') return null;
    const y = parseInt(String(year), 10);
    const entitlement = entitlementFor(member, y, overrides);
    // A year before the Dispatcher joined has no entitlement on record (getALEntitlement), so there
    // is nothing to split — without this, `entitlement - base` would invent a lieu count from null.
    if (entitlement === null) return null;

    const proRated = member.proRatedAL?.[y] !== undefined;
    const base = dispatcherBaseAL(member, y);   // the figure getALEntitlement starts from — one formula
    // A BOXING DAY IN LIEU IS NOT A BANK-HOLIDAY DAY (v25.37) — in 2026 Boxing Day is a Saturday and
    // no bank holiday at all — so it is reported on its own and kept out of `lieu`, which the caption
    // labels "BH lieu". `base + lieu + boxingDay === entitlement` is what the test pins.
    const boxingDay = boxingDayLieuDays(member, y, overrides);
    return { base, lieu: entitlement - base - boxingDay, boxingDay, proRated };
}

/**
 * The one line that explains what a member's entitlement is made of, or `null` when it is the plain
 * contract figure and there is nothing to explain. The Admin banner and the Calendar's leave panel
 * both print it, so the two cannot describe the same number differently — which is how the panel's
 * own `22 base + …` sum would have filed a Boxing Day in lieu under "BH lieu" (v25.37).
 *
 * A Dispatcher: `22 base + 4 BH lieu`, with `(pro-rated)` for a joining year and `+ 1 Boxing Day in
 * lieu` when earned. Anybody else: a line only when they earned the Boxing Day day (christmas-leave.js
 * → `boxingDayLieuDays`), because a figure one higher than every colleague's needs its reason beside it.
 *
 * @param {{ member: any, year: number|string, overrides: any[] }} args
 * @returns {string|null}
 */
export function entitlementNote({ member, year, overrides }) {
    if (!member) return null;
    const split = dispatcherBreakdown({ member, year, overrides });
    if (split) {
        const parts = [`${split.base} base${split.proRated ? ' (pro-rated)' : ''}`, `${split.lieu} BH lieu`];
        if (split.boxingDay) parts.push(`${split.boxingDay} Boxing Day in lieu`);
        return parts.join(' + ');
    }
    if (entitlementFor(member, year, overrides) === null) return null;
    const boxing = boxingDayLieuDays(member, year, overrides);
    return boxing ? `Includes ${boxing} day in lieu for working Boxing Day` : null;
}

/**
 * The member's overrides of one `type`, AFTER resolving which document actually wins each date.
 *
 * ── WHY A LIST CANNOT BE BUILT BY FILTERING ───────────────────────────────────────────────────
 *
 * Duplicate documents for one date are a real population here — two devices, an offline retry — and
 * `countedAlDates` above already resolves them, because getting the ENTITLEMENT wrong is obviously
 * serious. The Recorded-dates LIST filtered the raw collection instead, which produces a subtler
 * version of the same defect: an old orphan `annual_leave` doc sitting under a NEWER `shift` doc is
 * not the day's override at all, but a filter finds it, and the list then asks only "does this date
 * consume?" — which the winning shift answers YES to. So the date appeared in **Recorded Annual
 * Leave** for a day whose override is no longer annual leave, while the banner above it, working
 * from the winner map, correctly left it out. (External review of v23.78.)
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
 * Previously reimplemented four times: the AL/sick PREVIEWS used an older fall-through form that
 * counted a base-RD day with a non-rest (RDW) override as a REST day, while the save/entitlement
 * paths counted it as WORKED - so the preview under-reported vs what the booking actually wrote.
 * Consolidating onto this (the save/write rule) fixes that drift.
 * @param {any} memberObj  teamMembers entry
 * @param {string} dateStr  YYYY-MM-DD
 * @param {Map<string, any>} ovByDate  from buildMemberDateMap
 * @returns {boolean}
 */
export function isWorkingDate(memberObj, dateStr, ovByDate) {
    if (isSunday(dateStr)) return false;
    const ov = ovByDate.get(dateStr);
    if (ov) return !isRestShift(ov.value);
    return !isRestShift(getBaseShift(memberObj, parseISODate(dateStr)));
}
