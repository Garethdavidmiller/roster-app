// The two readings of a cover week, and why a sheet has to print both.
//
// ── THE QUESTION ────────────────────────────────────────────────────────────────────────────────
// A cover week is SPARE on all seven days and worked on four of them (`SPARE_WORKED_DAYS`), and
// nothing in the link says WHICH four — the roster clerk places them. Every run-based rule therefore
// has a range rather than an answer, and the app's own modules report the top of it: a cover day is
// an unknown, so it counts towards the run, capped at four a week, and never supplies a break.
//
// That ceiling is CORRECT and it is reachable. Enumerated (22 Sep 2026): of the 35 ways to place
// four duties in seven days, exactly 10 leave no two rest days together, and those 10 are precisely
// the placements that reproduce the app's figure. It is not an over-count — the v19.79 defect was,
// and this is what replaced it.
//
// But it is reachable only by SPLITTING the cover week day-on-day-off. Work the four together —
// which is what a cover week looks like on the roster — and the three rest days are necessarily
// together too, so the week always supplies a 48-hour break and can never BRIDGE the blocks either
// side of it. Measured on the same designs, that is the difference between FF11 at 15 and at 9.
//
// So a single number was answering a question nobody asked. A sheet that prints only the ceiling
// flags designs that are clear as rostered; one that prints only the block reading is the
// false-assurance failure `links-fatigue.js` names as its dominant risk. Both, labelled, is the
// only honest shape — and the GAP between them is itself the finding, because it says how much of
// a design's fatigue exposure is a property of the link and how much is a question for the roster
// office.
//
// ── WHAT "AS ROSTERED" MEANS HERE ───────────────────────────────────────────────────────────────
// The four duties worked as one consecutive block, on Monday to Saturday — the contracted days, and
// the only days the four can be (owner, 31 Oct 2026; `spareDrawsOnFour` in links-design.js). That is
// three placements (the block starting Mon, Tue or Wed). The Sunday is not one of the four, but it
// can be worked on top as overtime, so each cover week has six arrangements and a rotation with k
// cover weeks has 6^k. This returns the WORST of them — still a ceiling, but the worst ceiling
// inside the reading, not a best case — and the best, so a caller can say when the reading is a
// range rather than a number. Until v25.03 the block could also start on the Sunday, four
// placements and no overtime, which put a Sunday inside the four.
//
// The worst always works the Sunday and the best never does, because a day worked can only lengthen
// a run or take away a 48-hour break, and adds hours; so each is found over the 3^k block placements
// alone, Sunday worked or not, rather than over all 6^k (`placementCombos`).
//
// ── WHY IT MATERIALISES RATHER THAN RE-IMPLEMENTS ───────────────────────────────────────────────
// Every figure here comes out of the app's OWN scanners (`longestRunBetween48hBreaks`,
// `worstCaseWorkedRun`, `runLengthsWhere`) run over a grid whose cover weeks have been placed. A
// second implementation of "what is a run" is exactly the drift `longestWorkedRun`'s header was
// written to forbid, and the numbers on a proposal sheet have to come from one reading of the rule.
// The only thing this module decides is WHICH days of a cover week are worked; the counting is theirs.
//
// So a placement keeps its worked days SPARE and makes the others rest days. The scanners then read
// those days exactly as they read any cover day: an unknown that counts towards whatever a row asks
// (a run of 8-hour duties, of early starts), and that may EXTEND a run but not CREATE one
// (`requireMatch`). Until 31 Oct 2026 the worked days were a typed sentinel duty instead — one per
// question, so a row could not go quiet on the cover week — which the scanners could not tell from a
// real duty. That let a cover week alone make a run, and once its Sunday could be worked that run
// was five early starts, over FF15's four, on designs whose early starts never run past four.
import { DAYS, SPARE_WORKED_DAYS, spareDrawsOnFour, runLengthsWhere, worstCaseWorkedRun, dutyMinutes } from '../../../links-design.js';
import { LINES } from './link.mjs';   // 26 lines: the app's ROTATING_LINES is still 24
import { longestRunBetween48hBreaks, isEarlyStart, toSequence } from '../../../links-fatigue.js';

/** The days of a week, by index, that can hold one of a cover week's four duties: Monday to Saturday. */
const FOUR_DAYS = DAYS.map((_, i) => i).filter(spareDrawsOnFour);

/** The block placements of a cover week's four duties, inside `FOUR_DAYS`: true = worked. */
export const BLOCK_PLACEMENTS = FOUR_DAYS.slice(0, FOUR_DAYS.length - SPARE_WORKED_DAYS + 1).map(start =>
    DAYS.map((_, i) => i >= start && i < start + SPARE_WORKED_DAYS));

/** Line keys of the cover weeks, in order. */
export function coverLines(patterns, lines = LINES) {
    return Object.keys(patterns).sort((a, b) => a - b).slice(0, lines)
        .filter(k => DAYS.every(d => patterns[k][d] === 'SPARE'));
}

/**
 * The grid with every cover week placed under `combo` — one BLOCK_PLACEMENTS index per cover week,
 * in `coverLines` order: its worked days become `coverDuty`, the rest rest days. `sundayWorked`
 * works every cover week's Sunday as well, the overtime on top of its four. A `coverDuty` of
 * 'SPARE' leaves the worked days unknown, for the run scanners (the header says why); a timed duty
 * gives them hours, for the 55-hour row (`h55Worst`).
 */
export function materialise(patterns, lines, combo, coverDuty, sundayWorked = false) {
    const covers = coverLines(patterns, lines);
    const at = new Map(covers.map((k, i) => [k, BLOCK_PLACEMENTS[combo[i]]]));
    const out = {};
    for (const k of Object.keys(patterns).sort((a, b) => a - b).slice(0, lines)) {
        const place = at.get(k);
        out[k] = place
            ? Object.fromEntries(DAYS.map((d, i) => [d, place[i] || (sundayWorked && !spareDrawsOnFour(i)) ? coverDuty : 'RD']))
            : { ...patterns[k] };
    }
    return out;
}

/** Every combination of block placements across `n` cover weeks — the Sunday is the caller's. */
export function placementCombos(n) {
    let acc = [[]];
    for (let i = 0; i < n; i++) acc = acc.flatMap(c => BLOCK_PLACEMENTS.map((_, j) => [...c, j]));
    return acc;
}

/** The longest run of days satisfying `pred` — the app's scan, `requireMatch` and all. */
const longestWhere = pred => seq => {
    const lens = runLengthsWhere(seq, pred, { requireMatch: true });
    return lens.length ? Math.max(...lens) : 0;
};

/** Run each question over every arrangement and keep the worst and the best. */
export function asRosteredRuns(patterns, lines = LINES) {
    const covers = coverLines(patterns, lines);
    const QUESTIONS = {
        ff11: seq => longestRunBetween48hBreaks(seq),
        consecDays: seq => worstCaseWorkedRun(seq),
        eightPlus: longestWhere(s => (dutyMinutes(s) ?? 0) >= 8 * 60),
        twelvePlus: longestWhere(s => (dutyMinutes(s) ?? 0) > 12 * 60),
        early: longestWhere(isEarlyStart),
    };
    // the worst with every cover week's Sunday worked as overtime, the best with none (the header says why)
    const all = placementCombos(covers.length);
    const grids = sunday => all.map(c => toSequence(materialise(patterns, lines, c, 'SPARE', sunday), lines));
    const worst = grids(true), best = grids(false);
    const out = {};
    for (const [key, scan] of Object.entries(QUESTIONS)) {
        out[key] = { worst: Math.max(...worst.map(scan)), best: Math.min(...best.map(scan)) };
    }
    out.arrangements = all.length * 2 ** covers.length;   // 6^k: three blocks, and the Sunday worked or not
    out.coverWeeks = covers.length;
    return out;
}
