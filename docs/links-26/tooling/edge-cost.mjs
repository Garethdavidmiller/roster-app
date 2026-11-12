// EACH ONE'S EDGE, AND ITS COST — the facts behind the at-a-glance sheet's three cards AND the New link page's "Where they
// differ" card (owner, 12 Nov 2026: the page should show what the comparison sheet says, without the sheet). One list, one
// rule, so the PDF in a colleague's hand and the page in their app cannot name different points.
//
// THE RULE (the shortlist sheet's clearBest; both deck audits, 8 Nov 2026): a design's EDGE is a figure better than BOTH of
// the others by more than 5%, its COST one worse than both by more than 5% — the band report-data.mjs's fitCmp calls "about
// the same". Every fact is asserted HERE, so a design that stops fitting one stops the sheet and the page together.
//
// A fact's `key` is its name in both places: glance-sheet.mjs words the sheet's cards from them, newlink-data.mjs the page's,
// and each asserts it words exactly these keys, no more and no fewer. The wording is theirs; the selection is this file's.
//
// SIDE-EFFECT FREE: it counts and asserts, and draws nothing, so the page's generator can read it without printing a PDF.
// The counts it adds to each design (most7, set7, longAny, oneYear, mixed) were glance-sheet.mjs's own until 12 Nov 2026;
// they moved here with the facts that need them, and the sheet reads them from here.
import { TC, C, BV, LC, MG, H, first, mins, perYear, claim } from './what-it-means-data.mjs';
import { h55Worst, assess } from './report-data.mjs';

/** The margin, named once: the page states it beside the points (newlink-data.mjs → DIFFER_RULE), so it cannot name another. */
export const MARGIN = 0.05;
/** Better (or, with `high`, larger) than every one of `rest` by more than MARGIN. @param {number} v @param {number[]} rest */
export const clear = (v, rest, high = false) => rest.every(o => high ? o < (1 - MARGIN) * v : v < (1 - MARGIN) * o);
/** The two designs that are not `c`. */
export const others = c => C.filter(x => x !== c);
/** A figure's worst case: "5 (up to 10)" → 10, "0" → 0. */
export const worstOf = v => { const u = /up to (\d+)/.exec(v); return u ? +u[1] : first(v); };
const lines = c => Object.keys(c.p).length;

// ── COUNTED FROM THE GRIDS, today and the three ─────────────────────────────────────────────────────────────────────
for (const c of [TC, ...C]) {
  const L = lines(c);
  // THE WORST SEVEN DAYS, WHATEVER MAKES THEM (the at-a-glance audit, 9 Nov 2026): hiMin is the worst seven days with the
  // cover weeks placed worst, each duty 8 hours (the proposal sheets' reading); hi35Min the same at 8h 45m; tableMin the
  // set duties alone. glance-sheet.mjs carries the reasoning beside the rows that print them
  const w = h55Worst(c.p, L); c.most7 = w.hiMin; c.most7Long = w.hi35Min; c.set7 = w.tableMin;
  c.longAny = Math.round(perYear(c.p, s => mins(s) > 510));                       // shifts over 8h 30m on any day, Sunday included
  c.oneYear = Math.round(first(c.f.oneTurn) * 52 / L);                            // weeks on one shift time a year, as the shortlist's page 2
  c.assessed = assess(c.p, L);                                                    // the Links workspace's own reading of the rotation
  c.mixed = c.assessed.feel.hybrid;                                               // weeks mixing earlies and lates, in the rotation
}

// ── THE FACTS, design by design, in the order the sheet's cards say them ──────────────────────────────────────────────
const one = c => c.oneYear, wkOff = c => +c.f.weekendsYear, step = c => H(c.f.step), ffW = c => worstOf(c.f.ff), runW = c => worstOf(c.f.run);
const opens = c => c.f.open.split(' · ').map(Number);   // at the open: weekday · Saturday · Sunday, the decks' heads
const fact = (key, ok) => ({ key, ok: !!ok });

/** @type {ReadonlyArray<{ c: any, edge: ReadonlyArray<{ key: string, ok: boolean }>, cost: ReadonlyArray<{ key: string, ok: boolean }> }>} */
export const EDGE_COST = [
  { c: BV,
    edge: [
      fact('shortestRuns', clear(+BV.f.block, others(BV).map(c => +c.f.block)) && clear(+BV.f.blockUpTo, others(BV).map(c => +c.f.blockUpTo))),
      fact('most34Breaks', clear(BV.long34, others(BV).map(c => c.long34), true)),
      fact('fiveAtSatOpen', opens(BV)[1] === 5 && others(BV).every(c => opens(c)[1] === 4)),
    ],
    cost: [
      fact('fewestOneTime', clear(one(BV), others(BV).map(one)) && BV.mixed > 0 && others(BV).every(c => c.mixed === 0)),
      fact('biggestStep', clear(step(BV), others(BV).map(step), true)),
      fact('mostSingles', clear(BV.singles, others(BV).map(c => c.singles), true)),
      fact('fewestWeekends', clear(wkOff(BV), others(BV).map(wkOff))),
      fact('mostIfCoverBad', clear(ffW(BV), others(BV).map(ffW), true) && clear(runW(BV), others(BV).map(runW), true)),
    ] },
  // "however a cover week falls" is the claim: on the set duties all three work five days in a row at most
  { c: LC,
    edge: [
      fact('noFatigueOr55', ffW(LC) === 0 && others(LC).every(c => ffW(c) > 0) && LC.most7 <= 55 * 60 && LC.most7Long <= 55 * 60),
      fact('fewestDaysInRow', clear(runW(LC), others(LC).map(runW))),
      fact('gentlestStep', clear(step(LC), others(LC).map(step))),
      fact('fewestSingles', clear(LC.singles, others(LC).map(c => c.singles)) && LC.singles === TC.singles),
      fact('most0620', clear(+LC.f.open0620, others(LC).map(c => +c.f.open0620), true)),
    ],
    cost: [
      fact('fewest34Breaks', clear(LC.long34, others(LC).map(c => c.long34))),
    ] },
  { c: MG,
    edge: [
      fact('noShiftOver830', MG.longAny === 0 && others(MG).every(c => c.longAny > 0)
        && ['closerWk', 'closerSat', 'closerSun'].every(k => !MG.f[k].includes('–') && H(MG.f[k]) === 490)),
      fact('closestSatFit', clear(+MG.f.fitSat, others(MG).map(c => +c.f.fitSat))),
    ],
    cost: [
      fact('fewestShortEarlies', clear(+MG.f.shortYear, others(MG).map(c => +c.f.shortYear))),
      fact('fourAtOpenEveryDay', opens(MG).every(x => x === 4) && others(MG).every(c => opens(c).some(x => x > 4))),
      fact('leastSundayPay', clear(MG.sundayLoss, others(MG).map(c => c.sundayLoss), true)),
    ] },
];
claim('the edges and costs are written for the shortlist, A to Z', EDGE_COST.map(e => e.c.name).join() === C.map(c => c.name).join());
for (const { c, edge, cost } of EDGE_COST) for (const f of [...edge, ...cost]) claim(`${c.name}: ${f.key}, by the 5% rule`, f.ok);
// AND WHAT THE RULE LEAVES OUT (the at-a-glance sheet's first print claimed both): within 5%, so neither place may
claim('Middle Ground’s leave worst case and shortest Sundays are not edges or costs by the 5% rule, so neither card claims them',
  !clear(+MG.f.leaveWorst, others(MG).map(c => +c.f.leaveWorst), true) && !clear(H(MG.f.sunHours), others(MG).map(c => H(c.f.sunHours))));

/**
 * Whether a consumer words exactly a design's facts, no more and no fewer.
 * @param {string} name  the design @param {'edge'|'cost'} side @param {ReadonlyArray<string>} keys  the keys it words
 */
export const wordsExactly = (name, side, keys) => {
  const want = EDGE_COST.find(e => e.c.name === name)?.[side].map(f => f.key) ?? [];
  return [...keys].sort().join() === [...want].sort().join();
};
