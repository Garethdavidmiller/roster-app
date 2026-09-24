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
// The four duties worked as one consecutive block. On seven days that is four placements (the block
// starting Sun, Mon, Tue or Wed), and each cover week is placed independently, so a rotation with
// k cover weeks has 4^k arrangements. This returns the WORST of them — still a ceiling, but the
// worst ceiling inside the reading, not a best case. It also returns the best arrangement, so a
// caller can say when the reading is a range rather than a number.
//
// ── WHY IT MATERIALISES RATHER THAN RE-IMPLEMENTS ───────────────────────────────────────────────
// Every figure here comes out of the app's OWN scanners (`longestRunBetween48hBreaks`,
// `worstCaseWorkedRun`, `runLengthsWhere`) run over a grid whose cover weeks have been replaced by
// real days. A second implementation of "what is a run" is exactly the drift `longestWorkedRun`'s
// header was written to forbid, and the numbers on a proposal sheet have to come from one reading
// of the rule. The only thing this module decides is what a cover day IS; the counting is theirs.
//
// The sentinel duty is per-question, because a cover duty's TIMES are unknown too: a row that asks
// "how many 8-hour duties in a row" must assume a cover duty is one, and a row that asks about
// early starts must assume it is early. Handing every row the same sentinel would let a rule go
// quiet on the cover week, which is the v21.98 defect one level down.
import { DAYS, SPARE_WORKED_DAYS, ROTATING_LINES, runLengthsWhere, worstCaseWorkedRun, dutyMinutes } from '../../../links-design.js';
import { longestRunBetween48hBreaks, isEarlyStart, toSequence } from '../../../links-fatigue.js';

/** The block placements of a cover week's four duties: true = worked. */
export const BLOCK_PLACEMENTS = [0, 1, 2, 3].map(start =>
    [...Array(7)].map((_, i) => i >= start && i < start + SPARE_WORKED_DAYS));

/** Sentinel duties, one per question a run row can ask. Times are otherwise meaningless here. */
export const COVER_AS = {
    worked: '09:00-17:00',     // any duty — for the plain run and 48h-break rows
    eightPlus: '09:00-17:00',  // exactly 8h, so it counts as "8 hours or more"
    twelvePlus: '06:00-19:00', // 13h, so it counts as "over 12h"
    early: '06:00-14:00',      // starts inside 05:00–07:00
};

/** Line keys of the cover weeks, in order. */
export function coverLines(patterns, lines = ROTATING_LINES) {
    return Object.keys(patterns).sort((a, b) => a - b).slice(0, lines)
        .filter(k => DAYS.every(d => patterns[k][d] === 'SPARE'));
}

/**
 * The grid with every cover week's SPARE days replaced by real ones, under `combo` — one
 * BLOCK_PLACEMENTS index per cover week, in `coverLines` order.
 */
export function materialise(patterns, lines, combo, coverDuty) {
    const covers = coverLines(patterns, lines);
    const at = new Map(covers.map((k, i) => [k, BLOCK_PLACEMENTS[combo[i]]]));
    const out = {};
    for (const k of Object.keys(patterns).sort((a, b) => a - b).slice(0, lines)) {
        const place = at.get(k);
        out[k] = place
            ? Object.fromEntries(DAYS.map((d, i) => [d, place[i] ? coverDuty : 'RD']))
            : { ...patterns[k] };
    }
    return out;
}

/** Every combination of block placements across the cover weeks. */
function combos(n) {
    let acc = [[]];
    for (let i = 0; i < n; i++) acc = acc.flatMap(c => BLOCK_PLACEMENTS.map((_, j) => [...c, j]));
    return acc;
}

/**
 * Run each question over every arrangement and keep the worst and the best.
 *
 * `requireMatch` is honoured the way `runLengthsWhere` honours it, and it has to be done HERE: on a
 * materialised grid the sentinel is a real match, so a design containing no 12-hour duty anywhere
 * would otherwise report a run of four made entirely of cover days — a finding about nothing, which
 * is the thing that flag exists to prevent.
 */
export function asRosteredRuns(patterns, lines = ROTATING_LINES) {
    const covers = coverLines(patterns, lines);
    const real = toSequence(patterns, lines).filter(x => x.shift !== 'SPARE');
    const hasReal = pred => real.some(x => pred(x.shift));

    const QUESTIONS = {
        ff11: { as: COVER_AS.worked, run: seq => longestRunBetween48hBreaks(seq) },
        consecDays: { as: COVER_AS.worked, run: seq => worstCaseWorkedRun(seq) },
        eightPlus: { as: COVER_AS.eightPlus, pred: s => (dutyMinutes(s) ?? 0) >= 8 * 60 },
        twelvePlus: { as: COVER_AS.twelvePlus, pred: s => (dutyMinutes(s) ?? 0) > 12 * 60 },
        early: { as: COVER_AS.early, pred: isEarlyStart },
    };

    const all = combos(covers.length);
    const out = {};
    for (const [key, q] of Object.entries(QUESTIONS)) {
        if (q.pred && !hasReal(q.pred)) { out[key] = { worst: 0, best: 0 }; continue; }
        const scan = q.run ?? (seq => {
            const lens = runLengthsWhere(seq, q.pred, { requireMatch: true });
            return lens.length ? Math.max(...lens) : 0;
        });
        const vals = all.map(c => scan(toSequence(materialise(patterns, lines, c, q.as), lines)));
        out[key] = { worst: Math.max(...vals), best: Math.min(...vals) };
    }
    out.arrangements = all.length;
    out.coverWeeks = covers.length;
    return out;
}
