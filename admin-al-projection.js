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

import { getALEntitlement, projectAnnualLeaveOverage } from './roster-data.js';
import { swapDecisionDates } from './al-swapped-days.js';
import { consumesEntitlement, countedAlDates, isWorkingDate } from './al-entitlement.js';

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
 * `skipped` is the one that must never include a date from `consuming`, which is exactly the bug
 * this module was written for: nothing may say "skipped" about a day Save is about to count.
 *
 * @param {object} args
 * @param {any} args.member the team-member object; without it nothing can be judged
 * @param {string[]} args.dates every date the booking covers
 * @param {Map<string, any>|null} [args.ovByDate] the overrides in play, keyed by date
 * @param {Map<string, boolean>|null} [args.swapAnswers] date → `true` (swapped, counts) /
 *        `false` (genuine rest, free). A date ABSENT is unanswered, which is a state, not a default.
 * @returns {{asked: string[], unanswered: string[], consuming: string[], freeWritten: string[],
 *            skipped: string[], writing: string[],
 *            counts: {asked:number, unanswered:number, consuming:number, freeWritten:number,
 *                     skipped:number, writing:number}}}
 */
export function projectAlBooking({ member, dates, ovByDate = null, swapAnswers = null }) {
    const empty = { asked: [], unanswered: [], consuming: [], freeWritten: [], skipped: [], writing: [] };
    if (!member || !Array.isArray(dates)) return { ...empty, counts: _counts(empty) };

    const all = [...new Set(dates)].sort();
    const asked = swapDecisionDates({ dates: all, memberObj: member, ovByDate });
    const askedSet = new Set(asked);

    /** @type {string[]} */ const unanswered = [];
    /** @type {string[]} */ const consuming = [];
    /** @type {string[]} */ const freeWritten = [];
    /** @type {string[]} */ const skipped = [];
    /** @type {string[]} */ const writing = [];

    for (const date of all) {
        let swapped = false;
        if (askedSet.has(date)) {
            const answer = swapAnswers && typeof swapAnswers.get === 'function' ? swapAnswers.get(date) : undefined;
            if (answer === undefined) { unanswered.push(date); continue; }
            if (answer !== true) { skipped.push(date); continue; }   // "rest day — free": not written
            swapped = true;
        } else if (!isWorkingDate(member, date, /** @type {any} */ (ovByDate))) {
            // Not asked and not worked: a Sunday, or a rest day the record already settled.
            skipped.push(date);
            continue;
        }
        // ONE expression decides whether the day costs anything, for an answered swap and an
        // ordinary working day alike — `willConsume` is the rule, and there is no second copy of it.
        writing.push(date);
        (willConsume({ member, date, ovByDate, swapped }) ? consuming : freeWritten).push(date);
    }

    const out = { asked, unanswered, consuming, freeWritten, skipped, writing };
    return { ...out, counts: _counts(out) };
}

/** @param {Record<string, string[]>} sets */
function _counts(sets) {
    return {
        asked: sets.asked.length, unanswered: sets.unanswered.length,
        consuming: sets.consuming.length, freeWritten: sets.freeWritten.length,
        skipped: sets.skipped.length, writing: sets.writing.length,
    };
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
 * @returns {{over:number, projectedTotal:number, headline:string, detail:string}|null}
 */
export function projectAlOverage({ member, memberName, overrides, consuming, exclude = null }) {
    if (!member || !Array.isArray(consuming) || !consuming.length) return null;
    const years = [...new Set(consuming.map(d => d.substring(0, 4)))].sort();
    for (const yearStr of years) {
        const entitlement = getALEntitlement(member, parseInt(yearStr, 10), overrides);
        if (entitlement === null) continue;
        const existingALDates = countedAlDates({ overrides, member, year: yearStr, exclude });
        const newALDates = consuming.filter(d => d.startsWith(yearStr));
        const overage = projectAnnualLeaveOverage({
            name: memberName, year: yearStr, existingALDates, newALDates, entitlement,
        });
        if (overage) return overage;
    }
    return null;
}
