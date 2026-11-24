// @ts-check
// admin-al-projection.js — what an Annual Leave booking WILL do, decided once for every surface.
//
// ── THE PROBLEM THIS EXISTS FOR ────────────────────────────────────────────────────────────────
//
// v23.75 gave the admin a question — "was a working day SWAPPED onto this rest day?" — and wired the
// answer straight to the WRITE. Everything else carried on reading the stored override map, which at
// that moment still says REST. So three layers could describe the same save three different ways:
//
//   the PREVIEW      said "1 rest day skipped" about a day Save was about to count;
//   the WARNING      projected the year's entitlement without the day, so a member with one day left
//                    could be booked two and never see the over-entitlement bar;
//   the WRITE        recorded both days, correctly, and left the balance negative afterwards.
//
// The entitlement maths was right at every step. The disagreement was that each layer asked a
// DIFFERENT QUESTION — "what does the roster say", "what is on record", "what did the admin answer" —
// and only the last one knew about the swap. (External review of v23.78, 14 Sep 2026.)
//
// ── WHAT THIS MODULE IS ────────────────────────────────────────────────────────────────────────
//
// One pure answer to "what will this save mean?", taking the stored state AND the admin's current
// answers, so preview, warning and write cannot disagree again. It decides; it does not render, read
// the DOM, or touch Firestore.
//
// The rule it adds to `consumesEntitlement` is one line, and it is the whole fix:
//
//     a day consumes entitlement if the admin has DECLARED it swapped, or if the record already
//     says it is contracted work.
//
// Both halves are needed. Without the first, a swapped day is invisible until it is written. Without
// the second, a day whose `shift` override is still on record — the week grid's case, where the AL
// that replaces it has not been written yet — would need an answer it has already given.
//
// ── WHY BOTH SURFACES ASK THE SAME MODULE ──────────────────────────────────────────────────────
//
// The range card and the week grid are different UIs over one decision, and they had already drifted
// once: the range path did not re-ask a question an existing `replacedType: 'shift'` had settled, and
// the week grid did. A shared decision layer is the only version of this that stays true, because
// there is no second copy to forget.
//
// ── AND ONE RULE BOTH RANGE CARDS SHARE ────────────────────────────────────────────────────────
//
// `rangeSundayCorrections` is the leave AND absence cards' Sunday rule — which worked Sundays a range
// booking sets as rest days. It lives here, beside what a save will do, so the preview and the receipt
// can name those days before the write instead of calling them "skipped" (whole-app check, 10 Nov 2026).

import { projectAnnualLeaveOverage, parseISODate, isSunday, getBaseShift } from './roster-data.js';
import { isRestShift, isBeforeMemberStart, nextReplacedType, nextLeaveYear, shouldReplaceOverride } from './override-utils.js';
import { WORKED_OVERRIDE_TYPES } from './admin-shift-types.js';
import { swapDecisionDates, rangeWriteDates, absenceHiddenDates, replacedTypeForSwap } from './al-swapped-days.js';
import { consumesEntitlement, countedAlDates, entitlementFor, isWorkingDate, winningEntriesOfType, lowersAllowance,
    spareWeekDays } from './al-entitlement.js';
import { isChristmasClosureDate, allowanceYearsOf } from './christmas-leave.js';
import { carriedFrom, leaveYearOf } from './leave-year.js';

/**
 * Will this one date cost a day of entitlement?
 *
 * The single rule, exported so a caller holding one date (the week grid, row by row) asks exactly
 * what a caller holding a range asks.
 *
 * @param {object} args
 * @param {any} args.member the team-member object
 * @param {string} args.date ISO `YYYY-MM-DD`
 * @param {Map<string, any>|null} [args.ovByDate] the overrides in play. **Pass it** — without it a
 *        swapped-in day already on record reads as a rest day (`consumesEntitlement` says so on its
 *        own signature).
 * @param {boolean} [args.swapped] the admin has DECLARED this a swapped-in working day
 * @returns {boolean}
 */
export function willConsume({ member, date, ovByDate = null, swapped = false }) {
    return swapped === true || consumesEntitlement(member, date, ovByDate);
}

/**
 * What a booking of `dates` for `member` will actually do.
 *
 * Four sets, because four things can be true of a date and the preview has been wrong precisely
 * where it collapsed them:
 *
 *   `unanswered`  — a rest day whose question has not been answered. Blocks the save.
 *   `consuming`   — will be written AND will cost a day.
 *   `freeWritten` — will be written and will cost nothing (an `rdw` day: worked, but declining
 *                   overtime is not leave).
 *   `skipped`     — not written at all: Sundays, and rest days answered "free".
 *
 * And one SUBSET of the last, because the two surfaces need different halves of it:
 *
 *   `answeredFree` — asked, and answered "rest day — free". Nothing is written on either surface:
 *                    the day is a rest day, the leave costs nothing, and there is nothing to record.
 *                    CHRISTMAS DAY AND BOXING DAY with no work recorded join it unasked (v25.37):
 *                    their answer is fixed, because leave there never costs a day, so both surfaces
 *                    drop them as they drop a day answered "free", and every receipt names them.
 *   `christmas`    — that subset, so the preview can call them Christmas days, not rest days.
 *
 * The two halves of `skipped` are decided by different things, which is why the subset is named.
 * `answeredFree` is an ANSWER the surface asked for and got; the rest is a rule about days nobody
 * was asked about — a Sunday, or a rest day whose own record already settles it. The week grid is a
 * per-day edit and acts on the answer: it drops `answeredFree` from its batch and writes everything
 * else it was told to write. Reading `skipped` instead would let a rule about RANGES decide what a
 * single deliberate row edit does, and would change silently the next time that rule moves.
 *
 * `skipped` is the one that must never include a date from `consuming`, which is exactly the bug
 * this module was written for: nothing may say "skipped" about a day Save is about to count.
 *
 * And one subset of `writing`, because a day can cost nothing to SPEND and still cost a day:
 *
 *   `lieuLost`   — a day whose WORK earns a day in lieu and that this write turns into leave: a
 *                  worked Boxing Day (christmas-leave.js), or any bank holiday a Dispatcher works
 *                  (roster-data.js). The day in lieu goes with the work, so the allowance drops by
 *                  one (6 Nov 2026 review: the preview called a Boxing Day "recorded at no cost" and
 *                  the warning missed it). Read off the allowance itself (`lowersAllowance`), so a
 *                  Dispatcher's bank holidays are covered by the rule that grants them (7 Nov 2026).
 *                  `projectAlOverage` costs it through the allowance; this names it for the preview.
 *
 * And one more subset of `writing`, because a day can be written and change nothing:
 *
 *   `alreadyBooked` — a day that already HOLDS leave, which the save only writes again at the same
 *                  cost it had (both costing a day, or both free). Counted in `consuming` or
 *                  `freeWritten` as before, so the over-allowance check is unchanged (it never
 *                  charged an existing day twice); named so the preview and the receipt can say
 *                  "2 new days, 3 already booked" where they said "5 days" and the balance fell by 2
 *                  (review, Nov 2026). A rest day's free leave answered "swapped" is NOT in it: its
 *                  cost changes, so it is a new day spent.
 *
 * And the answers about the whole save (review, 21 Nov 2026):
 *
 *   `charged` — how far the balance moves: the cost of every day it can change, after less before.
 *                  The new days charged, except where a Spare week's four moved between days already
 *                  booked and days booked now — the figure the preview and the receipt say.
 *   `byYear`  — `charged` split by the year each day counts in, years that do not move left out. Different from
 *                  `charged` only when a Spare week over New Year moves a charge between December and January.
 *   `spent`   — the sum of the years that rise: what the save takes, a day given back to another year apart.
 *   `capFreed` — how many of the NEW days charged leave THEIR YEAR'S balance where it was, because charging them
 *                  freed a day of the same Spare week already booked: new days charged less `charged`.
 *                  Said "at no cost" with the days written free, so no surface charges them twice.
 *   `writes`  — the leave records as the save will write them, with `swapped`, for `overridesAfterSave`.
 *
 * @param {object} args
 * @param {any} args.member the team-member object; without it nothing can be judged
 * @param {string[]} args.dates every date the booking covers
 * @param {Map<string, any>|null} [args.ovByDate] the overrides in play, keyed by date
 * @param {Map<string, boolean>|null} [args.swapAnswers] date → `true` (swapped, counts) /
 *        `false` (genuine rest, free). A date ABSENT is unanswered, which is a state, not a default.
 * @returns {{asked: string[], unanswered: string[], consuming: string[], freeWritten: string[],
 *            skipped: string[], answeredFree: string[], christmas: string[], writing: string[], lieuLost: string[],
 *            alreadyBooked: string[], charged: number, spent: number, byYear: Array<{year: number, charged: number}>, capFreed: number,
 *            writes: Array<{date: string, type: string, value: string, swapped: boolean}>,
 *            counts: {asked:number, unanswered:number, consuming:number, freeWritten:number,
 *                     skipped:number, answeredFree:number, christmas:number, writing:number, lieuLost:number,
 *                     alreadyBooked:number}}}
 */
export function projectAlBooking({ member, dates, ovByDate: given = null, swapAnswers = null }) {
    const empty = { asked: [], unanswered: [], consuming: [], freeWritten: [], skipped: [], answeredFree: [], christmas: [], writing: [], lieuLost: [],
        alreadyBooked: [] };
    if (!member || !Array.isArray(dates)) return { ...empty, charged: 0, spent: 0, byYear: [], capFreed: 0, writes: [], counts: _counts(empty) };
    // Omitted means "nothing in play", as it does for every rule below — `isWorkingDate` alone
    // dereferences the map, and threw on the first ordinary working day without one.
    const ovByDate = given ?? new Map();

    const all = [...new Set(dates)].sort();
    const asked = swapDecisionDates({ dates: all, memberObj: member, ovByDate });
    const askedSet = new Set(asked);

    /** @type {string[]} */ const unanswered = [];
    /** @type {string[]} */ const consuming = [];
    /** @type {string[]} */ const freeWritten = [];
    /** @type {string[]} */ const skipped = [];
    /** @type {string[]} */ const answeredFree = [];
    /** @type {string[]} */ const christmas = [];
    /** @type {string[]} */ const writing = [];
    /** @type {string[]} */ const lieuLost = [];
    /** @type {string[]} */ const alreadyBooked = [];
    /** @type {Set<string>} */ const swappedSet = new Set();

    for (const date of all) {
        if (askedSet.has(date)) {
            const answer = swapAnswers && typeof swapAnswers.get === 'function' ? swapAnswers.get(date) : undefined;
            if (answer === undefined) { unanswered.push(date); continue; }
            // "rest day — free": not written, by either surface. `answeredFree` is the half of
            // `skipped` that is an ANSWER rather than a range rule — see the block comment above.
            if (answer !== true) { skipped.push(date); answeredFree.push(date); continue; }
            swappedSet.add(date);
        } else if (isBeforeMemberStart(member, parseISODate(date)) || !isWorkingDate(member, date, ovByDate)) {
            // Not asked and not worked: a Sunday, a rest day the record already settled, or a day before
            // the member's start date, which the range writer never writes (`rangeWriteDates`).
            skipped.push(date);
            // A Christmas day is never asked because its answer is fixed — see `answeredFree` above.
            if (isChristmasClosureDate(date)) { answeredFree.push(date); christmas.push(date); }
            continue;
        }
        // What each written day COSTS is decided below, once, on the leave as it will stand.
        writing.push(date);
        // The work that day is what earns the day in lieu, and the leave replaces it.
        if (lowersAllowance(member, date, ovByDate)) lieuLost.push(date);
    }

    // EVERY DAY IS COSTED ON THE LEAVE AS IT WILL STAND (review, 21 Nov 2026). Each day above was costed
    // against the leave already SAVED, which cannot see the booking's other new days — and a Spare week
    // spends its four in date order across all of them (`pastSpareWeekCap`), so a whole new week read as
    // six, and a second copy of the cap here charged in a different order from the count, raising a
    // false "over" on a week whose end was already booked. So the booking's own leave is added to the
    // map exactly as the save writes it (`writtenLeave`), and the ONE rule is asked again of every day.
    const afterMap = new Map(ovByDate);
    for (const d of writing) afterMap.set(d, writtenLeave(member.name, d, ovByDate.get(d), swappedSet.has(d)));
    const costs = (/** @type {Map<string, any>} */ map, /** @type {string} */ d) =>
        map.get(d)?.type === 'annual_leave' && consumesEntitlement(member, d, map);
    const charging = writing.filter(d => consumesEntitlement(member, d, afterMap));
    consuming.splice(0, consuming.length, ...charging);
    freeWritten.splice(0, freeWritten.length, ...writing.filter(d => !charging.includes(d)));
    // Already leave, and not a day this save starts charging (a rest day now answered "swapped" is a new
    // day spent). A day already booked that a Spare week's four now leaves free is still already booked.
    alreadyBooked.splice(0, alreadyBooked.length,
        ...writing.filter(d => ovByDate.get(d)?.type === 'annual_leave' && !(costs(afterMap, d) && !costs(ovByDate, d))));
    // What the balance actually moves by: every day whose cost can change — the booking's, and the rest
    // of each Spare week it touches — after less before. Equal to the new days charged, except where a
    // week's four moved between days already booked and days booked now.
    const touched = new Set(writing);
    for (const d of writing) for (const w of spareWeekDays(d)) touched.add(w);
    let charged = 0;
    for (const d of touched) charged += Number(costs(afterMap, d)) - Number(costs(ovByDate, d));
    // …AND BY YEAR (external review of v26.55). A Spare week over New Year spends its four across two allowances,
    // so booking a December day can charge 2026 and give a day back to 2027: nothing moves in total, and each
    // year moves by one. Each day is charged to the year its leave counts in (`leaveYearOf`, a moved January
    // day included), before and after.
    /** @type {Map<number, number>} */ const perYear = new Map();
    const shift = (/** @type {Map<string, any>} */ map, /** @type {string} */ d, /** @type {number} */ by) => {
        if (!costs(map, d)) return;
        const y = leaveYearOf({ ...map.get(d), date: d });
        perYear.set(y, (perYear.get(y) ?? 0) + by);
    };
    for (const d of touched) { shift(afterMap, d, 1); shift(ovByDate, d, -1); }
    const byYear = [...perYear].filter(([, c]) => c !== 0).sort(([a], [b]) => a - b).map(([year, c]) => ({ year, charged: c }));
    // What the save SPENDS — every year's rise, so a day given back to one year never hides a day taken from another.
    const spent = byYear.reduce((n, y) => n + Math.max(0, y.charged), 0);
    // …and the new days the week's four make FREE ON BALANCE (review, 22 Nov 2026). Booking the Monday
    // of a Spare week whose Wednesday to Saturday are already booked charges the Monday and frees the
    // Saturday, so the day is in `consuming` and the balance does not move. Counted here, once, so the
    // preview, the Spare note and the receipt all say "at no cost" of it instead of "uses 1 day" over a
    // headline of "No days". Only a week's cap can free a day that was costing, so it is never negative.
    // Per year: a new day is free on balance only when its OWN year's count does not move. Netted across years, a
    // Monday that charged 2026 and freed a day of 2027 was said "at no cost" (external review of v26.55).
    const newIn = (/** @type {number} */ y) => consuming.filter(d => !alreadyBooked.includes(d)
        && leaveYearOf({ ...afterMap.get(d), date: d }) === y).length;
    const years = new Set([...byYear.map(y => y.year), ...consuming.map(d => leaveYearOf({ ...afterMap.get(d), date: d }))]);
    let capFreed = 0;
    for (const y of years) capFreed += Math.max(0, newIn(y) - Math.max(0, perYear.get(y) ?? 0));

    const out = { asked, unanswered, consuming, freeWritten, skipped, answeredFree, christmas, writing, lieuLost, alreadyBooked };
    return { ...out, charged, spent, byYear, capFreed, writes: writing.map(d => ({ date: d, type: 'annual_leave', value: 'AL', swapped: swappedSet.has(d) })),
        counts: _counts(out) };
}

/**
 * The leave record a save writes on `date`, as `recordRangeOverrides` writes it (admin-overrides.js):
 * what it replaced (`replacedType` — a declared swap records contracted work), and the year a moved
 * January day is charged to (`leaveYear`). The projection and `overridesAfterSave` cost the leave as it
 * will stand with this, so a swapped rest day costs a day there just as it will once saved.
 * @param {string} memberName @param {string} date @param {any} existing the record on the day now
 * @param {boolean} swapped declared a swapped-in working day
 * @returns {any}
 */
function writtenLeave(memberName, date, existing, swapped) {
    return writtenRecord(memberName, { date, type: 'annual_leave', value: 'AL', swapped }, existing);
}

/**
 * Any record a save writes, as the writer builds it (admin-overrides.js): the newest on its day, what it
 * replaced and, for leave, its year. One recipe for `writtenLeave` and `overridesAfterSave`.
 * @param {string} memberName @param {{date: string, type: string, value?: string, swapped?: boolean}} w
 * @param {any} existing the record on the day before the save
 * @returns {any}
 */
function writtenRecord(memberName, w, existing) {
    return { memberName, date: w.date, type: w.type, value: w.value ?? '', createdAt: { seconds: 4102444800 },   // 2100-01-01: the day's winner
        replacedType: w.swapped ? replacedTypeForSwap(existing, w.type) : nextReplacedType(existing, w.type),
        leaveYear: nextLeaveYear(existing, w.type, w.date) };
}



/**
 * What a booking does to each year, when it does different things to two (external review of v26.55): "1 day from
 * 2026, 1 day back to 2027". A Spare week over New Year spends its four in date order, so a December day can take
 * a day from one year and give one back to the next. '' when no year gets a day back — then the headline's
 * figure is the whole story, as it is for every booking inside one year.
 * @param {Array<{year: number, charged: number}>|undefined} byYear `projectAlBooking`'s
 * @returns {string}
 */
export function yearShiftWords(byYear) {
    if (!Array.isArray(byYear) || !byYear.some(y => y.charged < 0)) return '';
    const n = (/** @type {number} */ c) => `${c} day${c === 1 ? '' : 's'}`;
    return byYear.map(y => y.charged > 0 ? `${n(y.charged)} from ${y.year}` : `${n(-y.charged)} back to ${y.year}`).join(', ');
}

/**
 * The Sundays a RANGE booking — leave or absence — sets as rest days. A Sunday in the range whose
 * BASE roster is a worked shift gets a `correction`/RD written beside the booking, so the shift does
 * not show through the leave on the Calendar (.claude/rules/admin.md → "Sunday RD corrections") —
 * unless the day already holds a rest value, or a worked record (`WORKED_OVERRIDE_TYPES`) the
 * correction would erase. It is `recordRangeOverrides`'s rule (admin-overrides.js), stated here so
 * the preview and the receipt name the days the save will change; the writer writes them only beside
 * at least one day of the booking itself, which the caller checks.
 * @param {{ dates: string[], memberObj: any, ovByDate?: Map<string, any>|null }} args
 * @returns {string[]} the Sundays, in the order given
 */
export function rangeSundayCorrections({ dates, memberObj, ovByDate = null }) {
    if (!memberObj || !Array.isArray(dates)) return [];
    return dates.filter(d => {
        if (!isSunday(d) || isRestShift(getBaseShift(memberObj, parseISODate(d)))) return false;
        const ov = ovByDate && typeof ovByDate.get === 'function' ? ovByDate.get(d) : null;
        return !(ov && (isRestShift(ov.value) || WORKED_OVERRIDE_TYPES.has(ov.type)));
    });
}

/**
 * What an ABSENCE range does to the leave ALLOWANCE (review of v26.22). An absence spends no leave,
 * but written over a day whose WORK earned a day in lieu — a worked Boxing Day (whose day goes into
 * the NEXT year's allowance), a Dispatcher's worked bank holiday — it takes that day back, exactly as
 * leave over it does: the day is no longer worked. The Absence card checked nothing, so the allowance
 * fell without a word, while the week grid already asked (`planAlWeekSave`'s no-leave path).
 *
 * This is that same check for a range, with no second copy of any rule in it: the dates are the
 * writer's own (`rangeWriteDates`, and the Sundays `rangeSundayCorrections` sets), the allowance after
 * the save is `overridesAfterSave`, and `projectAlOverage` is given NOTHING spent — so only a year
 * whose allowance FALLS is checked, and an absence elsewhere never raises the bar. `exclude` is every
 * written date: leave the absence replaces is no longer counted.
 *
 * …AND THE DAYS IT LEAVES AS THEY ARE, BECAUSE AN ABSENCE WOULD NOT SHOW THERE (review, Nov 2026):
 * `leftAlone`, the rest days holding a record the Calendar DOES show — Rest Day Working, leave — which
 * the writer passes over (`absenceHiddenDates`, al-swapped-days.js), named so the manager can deal
 * with each in Change a Shift.
 *
 * @param {object} args
 * @param {any} args.member the team-member object; without it nothing is judged
 * @param {string} args.memberName the name, for the message
 * @param {Array<any>} args.overrides every override the page holds
 * @param {Map<string, any>|null} [args.ovByDate] the member's overrides in play, keyed by date
 * @param {string[]} args.dates every date the range covers
 * @returns {{ writing: string[], lieuLost: string[], leftAlone: string[],
 *             overage: {over:number, projectedTotal:number, headline:string, detail:string}|null }}
 *   `writing` the dates recorded as absent; `lieuLost` those whose day in lieu goes, for the preview;
 *   `leftAlone` the days named as left as they are (above); `overage` the confirmation message, its
 *   detail naming the days in lieu, or null.
 */
export function projectAbsenceRange({ member, memberName, overrides, ovByDate = null, dates }) {
    if (!member || !Array.isArray(dates)) return { writing: [], lieuLost: [], leftAlone: [], overage: null };
    const ov = ovByDate ?? new Map();
    const absent = { type: 'sick', value: 'SICK' };
    const writing = rangeWriteDates({ type: absent.type, dates, memberObj: member, ovByDate: ov });
    const leftAlone = absenceHiddenDates({ dates, memberObj: member, ovByDate: ov });
    if (!writing.length) return { writing, lieuLost: [], leftAlone, overage: null };
    const writes = [...writing.map(date => ({ date, ...absent })),
        ...rangeSundayCorrections({ dates, memberObj: member, ovByDate: ov }).map(date => ({ date, type: 'correction', value: 'RD' }))];
    const lieuLost = writing.filter(date => lowersAllowance(member, date, ov, absent));
    const overage = projectAlOverage({ member, memberName, overrides, consuming: [], exclude: new Set(writing),
        after: overridesAfterSave(overrides, { memberName, writes }) });
    return { writing, lieuLost, leftAlone,
        overage: overage && lieuLost.length ? { ...overage, detail: `${lieuGoesWords(lieuLost, 'absent')} · ${overage.detail}` } : overage };
}

/**
 * How the range cards' previews name the days in lieu a booking takes back (7 Nov 2026): Christmas
 * Day and Boxing Day by name, any other bank holiday — a Dispatcher's — by its date. `as` is what the
 * day is recorded as: leave on the leave card, absent on the Absence card.
 * @param {string[]} dates ISO dates, ascending @param {'leave'|'absent'} [as] @returns {string}
 */
export function lieuGoesWords(dates, as = 'leave') {
    const name = (/** @type {string} */ d) => d.endsWith('-12-25') ? 'Christmas Day' : d.endsWith('-12-26') ? 'Boxing Day'
        : `the bank holiday on ${parseISODate(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}`;
    const names = dates.map(name);
    const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : (names[0] ?? '');
    return dates.length > 1
        ? `${list} recorded as ${as}, so the days in lieu for working them go`
        : `${list} recorded as ${as}, so the day in lieu for working it goes`;
}

/** @param {Record<string, string[]>} sets */
function _counts(sets) {
    return {
        asked: sets.asked.length, unanswered: sets.unanswered.length,
        consuming: sets.consuming.length, freeWritten: sets.freeWritten.length,
        skipped: sets.skipped.length, answeredFree: sets.answeredFree.length, christmas: sets.christmas.length,
        writing: sets.writing.length, lieuLost: sets.lieuLost.length, alreadyBooked: sets.alreadyBooked.length,
    };
}

/**
 * The overrides as they will stand once a save lands — what the ALLOWANCE is read from.
 *
 * A save can move the allowance as well as spend it (6 Nov 2026 review). Working a Boxing Day the
 * pattern was due to work earns a day in lieu (`boxingDayLieuDays`), so leave written over that work
 * takes the day back, deleting the work does the same, and recording it gives the day. Costed against
 * the allowance BEFORE the save, the range card let a member with two days left book two days and end
 * one over, and the week grid raised "1 day over" about a save that left them exactly at their limit.
 *
 * The writes are added as the newest records on their dates, so `shouldReplaceOverride` makes them
 * the winners there exactly as the real documents will be: a manual write is the newest manual
 * record, and manual beats a roster import whatever its age.
 *
 * @param {Array<any>} overrides every override in play
 * @param {object} save
 * @param {string} save.memberName whose records the writes are
 * @param {Array<{date: string, type: string, value?: string, swapped?: boolean}>} [save.writes] what the save
 *        writes; `swapped` marks a rest day declared a swapped-in working day, as the writer reads it
 * @param {Iterable<string>} [save.deleteIds] the ids of the records it deletes
 * @returns {Array<any>}
 */
export function overridesAfterSave(overrides, { memberName, writes = [], deleteIds = [] }) {
    const gone = new Set(deleteIds);
    const kept = (overrides || []).filter(o => !(o && gone.has(o.id)));
    // AS THE WRITER WRITES THEM (review, 21 Nov 2026): what each replaced, a declared swap included, so
    // leave over a swapped rest day costs here as it will once saved, and a Spare week's four is spent
    // here as the count will spend it. The record each replaces is the day's winner before the save.
    /** @type {Map<string, any>} */ const before = new Map();
    for (const o of overrides || []) {
        if (o && o.memberName === memberName && o.date && shouldReplaceOverride(before.get(o.date), o)) before.set(o.date, o);
    }
    return [...kept, ...writes.map(w => writtenRecord(memberName, w, before.get(w.date)))];
}

/**
 * Would these consuming dates put the member over their entitlement in any year they touch?
 *
 * Runs per calendar YEAR because a booking can span New Year and each year caps separately. Returns
 * the FIRST overage found, or null.
 *
 * **`consuming` is the caller's projection, not a re-derivation.** That is the point: the range card
 * builds it from `projectAlBooking`, the week grid from its batch plus each row's answer, and both
 * therefore warn about exactly what they are going to write.
 *
 * A null entitlement means no figure is on record, and a bar raised against a number the app does not
 * have is worse than no bar (v22.45) — the year is skipped and the write still goes ahead. Refusing
 * to judge is not refusing to record.
 *
 * @param {object} args
 * @param {any} args.member the team-member object
 * @param {string} args.memberName the name, for the message
 * @param {Array<any>} args.overrides every override the page holds
 * @param {string[]} args.consuming the dates this save will charge
 * @param {Set<string>|null} [args.exclude] dates being overwritten or deleted, so the existing
 *        count does not charge for them twice
 * @param {Array<any>|null} [args.after] the overrides as they will stand once the save lands
 *        (`overridesAfterSave`). The ALLOWANCE is read from these, because a save can move it — a
 *        worked Boxing Day's day in lieu comes and goes with the work — and a year whose allowance
 *        it moves is checked even when nothing in that year is spent. Omitted, the stored overrides.
 * @returns {{over:number, projectedTotal:number, headline:string, detail:string}|null}
 */
export function projectAlOverage({ member, memberName, overrides, consuming, exclude = null, after = null }) {
    if (!member || !Array.isArray(consuming)) return null;
    // WHICH YEAR EACH DAY WILL SPEND (v25.18). Its own — unless it is a January day already moved to
    // the year before, which a re-save carries forward (`nextLeaveYear`), so it is charged there.
    const winners = new Map(winningEntriesOfType(overrides, member.name, 'annual_leave').map(o => [o.date, o]));
    const yearFor = (/** @type {string} */ d) => String(carriedFrom(winners.get(d), d) ?? d.substring(0, 4));
    const yearSet = new Set(consuming.map(yearFor));
    const allowance = after ?? overrides;
    // …AND EVERY YEAR WHOSE ALLOWANCE THE SAVE LOWERS (6 Nov 2026 review), spent in or not: deleting a
    // worked Boxing Day can leave a member over with nothing booked in the same save. LOWERS, not
    // moves (7 Nov 2026 review): recording the work RAISES the allowance, and a member already over
    // was told they would be "1 day over — 34 used of 33" by a save that spends nothing and leaves
    // them better off. A year this save spends in is checked above whichever way its allowance went.
    // A changed record touches every year it can reach (`allowanceYearsOf`): its own, and for a
    // Boxing Day the NEXT year too, whose allowance holds that day's lieu (owner, 15 Nov 2026).
    if (after) {
        const before = new Set(overrides), later = new Set(after), touched = new Set();
        const touch = (/** @type {any} */ o) => { for (const y of allowanceYearsOf(member, String(o.date))) touched.add(String(y)); };
        for (const o of after) if (o && o.memberName === member.name && !before.has(o)) touch(o);
        for (const o of overrides) if (o && o.memberName === member.name && !later.has(o)) touch(o);
        for (const y of touched) {
            const was = entitlementFor(member, y, overrides), now = entitlementFor(member, y, after);
            if (was !== null && now !== null && now < was) yearSet.add(y);
        }
        // …AND EVERY YEAR WHOSE COUNTED LEAVE RISES, booked in or not (external review of v26.55). A Spare week
        // spends its four in date order, so removing a December day of a week over New Year moves a charge onto
        // a January day: nothing is booked in that year and its allowance is unchanged, yet it can go over. So
        // each year a changed record's Spare week reaches is counted before and after the save.
        const reached = new Set();
        const reach = (/** @type {any} */ o) => { for (const d of spareWeekDays(String(o.date))) reached.add(d.substring(0, 4)); };
        for (const o of after) if (o && o.memberName === member.name && !before.has(o)) reach(o);
        for (const o of overrides) if (o && o.memberName === member.name && !later.has(o)) reach(o);
        for (const y of reached) {
            if (countedAlDates({ overrides: after, member, year: y }).size > countedAlDates({ overrides, member, year: y }).size) yearSet.add(y);
        }
    }
    const years = [...yearSet].sort();
    for (const yearStr of years) {
        const entitlement = entitlementFor(member, yearStr, allowance);
        if (entitlement === null) continue;
        // WITH THE LEAVE AS IT WILL STAND, COUNT IT AS IT WILL STAND (review, 21 Nov 2026): a Spare week
        // spends its four in date order across saved and new days alike, so "saved + new" double-charged a
        // week whose end was booked and raised a false "2 days over". The after picture carries what each
        // written day replaced (`overridesAfterSave`), so it is the count the year will have. Without it —
        // no caller here omits it now — saved and new days are added as before.
        const existingALDates = after ? countedAlDates({ overrides: after, member, year: yearStr })
            : countedAlDates({ overrides, member, year: yearStr, exclude });
        const newALDates = after ? [] : consuming.filter(d => yearFor(d) === yearStr);
        const overage = projectAnnualLeaveOverage({
            name: memberName, year: yearStr, existingALDates, newALDates, entitlement,
        });
        if (overage) return overage;
    }
    return null;
}
