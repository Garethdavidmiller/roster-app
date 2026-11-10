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
import { isRestShift, isBeforeMemberStart } from './override-utils.js';
import { WORKED_OVERRIDE_TYPES } from './admin-shift-types.js';
import { swapDecisionDates } from './al-swapped-days.js';
import { consumesEntitlement, countedAlDates, entitlementFor, isWorkingDate, winningEntriesOfType } from './al-entitlement.js';
import { isChristmasClosureDate } from './christmas-leave.js';
import { carriedFrom } from './leave-year.js';

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
 * @param {object} args
 * @param {any} args.member the team-member object; without it nothing can be judged
 * @param {string[]} args.dates every date the booking covers
 * @param {Map<string, any>|null} [args.ovByDate] the overrides in play, keyed by date
 * @param {Map<string, boolean>|null} [args.swapAnswers] date → `true` (swapped, counts) /
 *        `false` (genuine rest, free). A date ABSENT is unanswered, which is a state, not a default.
 * @returns {{asked: string[], unanswered: string[], consuming: string[], freeWritten: string[],
 *            skipped: string[], answeredFree: string[], christmas: string[], writing: string[], lieuLost: string[],
 *            counts: {asked:number, unanswered:number, consuming:number, freeWritten:number,
 *                     skipped:number, answeredFree:number, christmas:number, writing:number, lieuLost:number}}}
 */
export function projectAlBooking({ member, dates, ovByDate: given = null, swapAnswers = null }) {
    const empty = { asked: [], unanswered: [], consuming: [], freeWritten: [], skipped: [], answeredFree: [], christmas: [], writing: [], lieuLost: [] };
    if (!member || !Array.isArray(dates)) return { ...empty, counts: _counts(empty) };
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

    for (const date of all) {
        let swapped = false;
        if (askedSet.has(date)) {
            const answer = swapAnswers && typeof swapAnswers.get === 'function' ? swapAnswers.get(date) : undefined;
            if (answer === undefined) { unanswered.push(date); continue; }
            // "rest day — free": not written, by either surface. `answeredFree` is the half of
            // `skipped` that is an ANSWER rather than a range rule — see the block comment above.
            if (answer !== true) { skipped.push(date); answeredFree.push(date); continue; }
            swapped = true;
        } else if (isBeforeMemberStart(member, parseISODate(date)) || !isWorkingDate(member, date, ovByDate)) {
            // Not asked and not worked: a Sunday, a rest day the record already settled, or a day before
            // the member's start date, which the range writer never writes (`rangeWriteDates`).
            skipped.push(date);
            // A Christmas day is never asked because its answer is fixed — see `answeredFree` above.
            if (isChristmasClosureDate(date)) { answeredFree.push(date); christmas.push(date); }
            continue;
        }
        // ONE expression decides whether the day costs anything, for an answered swap and an
        // ordinary working day alike — `willConsume` is the rule, and there is no second copy of it.
        writing.push(date);
        (willConsume({ member, date, ovByDate, swapped }) ? consuming : freeWritten).push(date);
        // The work that day is what earns the day in lieu, and the leave replaces it.
        if (lowersAllowance(member, date, ovByDate)) lieuLost.push(date);
    }

    const out = { asked, unanswered, consuming, freeWritten, skipped, answeredFree, christmas, writing, lieuLost };
    return { ...out, counts: _counts(out) };
}

/**
 * Does leave written on `date` lower the member's allowance — the day in lieu its work earned going
 * with the work? Asked of `entitlementFor` with and without the leave, so every rule that earns a day
 * in lieu (a worked Boxing Day, a Dispatcher's worked bank holiday) answers through the one that
 * grants it, rather than a second copy of either.
 * @param {any} member @param {string} date @param {Map<string, any>|null|undefined} ovByDate
 * @returns {boolean}
 */
function lowersAllowance(member, date, ovByDate) {
    const held = ovByDate && typeof ovByDate.values === 'function' ? [...ovByDate.values()].filter(Boolean) : [];
    const year = date.slice(0, 4);
    const before = entitlementFor(member, year, held);
    if (before === null) return false;
    const leave = { memberName: member.name, date, type: 'annual_leave', value: 'AL', createdAt: { seconds: 4102444800 } };
    const after = entitlementFor(member, year, [...held.filter(o => o.date !== date), leave]);
    return after !== null && after < before;
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
 * How the range card's preview names the days in lieu a booking takes back (7 Nov 2026): Christmas
 * Day and Boxing Day by name, any other bank holiday — a Dispatcher's — by its date.
 * @param {string[]} dates ISO dates, ascending @returns {string}
 */
export function lieuGoesWords(dates) {
    const name = (/** @type {string} */ d) => d.endsWith('-12-25') ? 'Christmas Day' : d.endsWith('-12-26') ? 'Boxing Day'
        : `the bank holiday on ${parseISODate(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}`;
    const names = dates.map(name);
    const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : (names[0] ?? '');
    return dates.length > 1
        ? `${list} recorded as leave, so the days in lieu for working them go`
        : `${list} recorded as leave, so the day in lieu for working it goes`;
}

/** @param {Record<string, string[]>} sets */
function _counts(sets) {
    return {
        asked: sets.asked.length, unanswered: sets.unanswered.length,
        consuming: sets.consuming.length, freeWritten: sets.freeWritten.length,
        skipped: sets.skipped.length, answeredFree: sets.answeredFree.length, christmas: sets.christmas.length,
        writing: sets.writing.length, lieuLost: sets.lieuLost.length,
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
 * @param {Array<{date: string, type: string, value?: string}>} [save.writes] what the save writes
 * @param {Iterable<string>} [save.deleteIds] the ids of the records it deletes
 * @returns {Array<any>}
 */
export function overridesAfterSave(overrides, { memberName, writes = [], deleteIds = [] }) {
    const gone = new Set(deleteIds);
    const kept = (overrides || []).filter(o => !(o && gone.has(o.id)));
    // Later than any real timestamp, so a written day's record is that day's winner.
    const newest = { seconds: 4102444800 };   // 2100-01-01
    return [...kept, ...writes.map(w => ({ memberName, date: w.date, type: w.type, value: w.value ?? '', createdAt: newest }))];
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
    if (after) {
        const before = new Set(overrides), later = new Set(after), touched = new Set();
        for (const o of after) if (o && o.memberName === member.name && !before.has(o)) touched.add(String(o.date).slice(0, 4));
        for (const o of overrides) if (o && o.memberName === member.name && !later.has(o)) touched.add(String(o.date).slice(0, 4));
        for (const y of touched) {
            const was = entitlementFor(member, y, overrides), now = entitlementFor(member, y, after);
            if (was !== null && now !== null && now < was) yearSet.add(y);
        }
    }
    const years = [...yearSet].sort();
    for (const yearStr of years) {
        const entitlement = entitlementFor(member, yearStr, allowance);
        if (entitlement === null) continue;
        const existingALDates = countedAlDates({ overrides, member, year: yearStr, exclude });
        const newALDates = consuming.filter(d => yearFor(d) === yearStr);
        const overage = projectAnnualLeaveOverage({
            name: memberName, year: yearStr, existingALDates, newALDates, entitlement,
        });
        if (overage) return overage;
    }
    return null;
}
