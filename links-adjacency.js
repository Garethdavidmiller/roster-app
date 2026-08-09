// @ts-check
/**
 * links-adjacency.js — what happens BETWEEN the lines: the order they sit in.
 *
 * Pure. No DOM, no Firebase. `LINKS_DEC2026_PLAN.md`, on the back of the FF18 discussion.
 *
 * WHY THIS EXISTS. In a rotating link you work line w one week and line w+1 the next, so a whole
 * class of the design's quality lives in the ORDER of the lines rather than in any line itself:
 *
 *   · how much your working day moves from one week to the next (the FF18 question)
 *   · whether Saturday off is followed by Sunday off — a full weekend
 *   · whether that weekend extends to three or four days
 *   · whether Saturday's late finish runs into Sunday's early start
 *
 * **Reordering the lines is FREE with respect to coverage**, and that is the fact that makes this
 * worth doing. Daily coverage is "how many lines work shift X on day D"; permuting the rows leaves
 * that multiset identical. So none of these objectives can cost a single person's cover — they only
 * compete with EACH OTHER, over the one scarce resource of which line follows which.
 *
 * WHICH IS WHY THEY ARE SWITCHES, NOT A FORMULA (owner, Aug 2026). Turning one on takes freedom from
 * the others, and the honest thing for the tool to do is let you turn each on and SHOW what it cost
 * the rest — not to blend them into a single score that hides the trade. `scoreOrder` returns all
 * four figures whatever you optimised for, so the price is always visible.
 *
 * THE TRAP, and it is the same one this workspace keeps meeting: **a spare week must not read as a
 * gentle transition.** A spare line carries no times, so the step across it cannot be measured — and
 * an optimiser that scored "unmeasurable" as "no change" would learn to park spare weeks between the
 * two harshest lines in the design and report a beautiful number. That is precisely the false
 * assurance `links-fatigue.js` exists to avoid. Unmeasurable steps are counted and reported
 * SEPARATELY, never folded into the mean.
 *
 * ── THREE MORE RULES, MOVED HERE FROM CLAUDE.md's FILE TREE (v20.11) ───────────────────────────
 *
 * **The spare spread is charged UNCONDITIONALLY, not as a switch.** Every other term here is a
 * preference; this one protects a guarantee. `generateLink` places the cover weeks evenly and the
 * reorder used to undo that, because clustering them helped the objectives it had been told about —
 * measured on the live seed it returned gaps 9,3,1,7,4 with two ADJACENT, against the generator's
 * 5,5,5,4,5. Two adjacent spare weeks chain into one long run, taking FF11 from 9 to 14: the tool
 * was reporting a fatigue finding of its own making. It is the only term that can make a design
 * WORSE than the one the reorder was handed.
 *
 * **Its weight is 3000, and the reason it is not 500 is the lesson worth keeping.** 500 was chosen
 * as "above `variety`'s 400" — true per unit, and not the question, because these terms ACCUMULATE.
 * Two units of block excess bid 800, `variety` won, and the default came back uneven. The unit test
 * asserting the priority compared one unit against one unit and passed throughout; **comparing
 * rates between terms that accumulate at different rates is the mistake**, and writing the assertion
 * that way is what made it look settled. 3000 came from measuring 16 design shapes reordered two
 * ways each: total excess 10 at w=500, 7 at 800, 8 at 1200, 7 at 1500, and 0 from 2000 upward — so
 * 3000 sits one step inside the dominating plateau rather than on its edge. Safe to treat as a
 * constraint because excess 0 is ALWAYS reachable (the target is `floor(lines / spares)`) — a
 * dominating weight over an unreachable target sets the optimiser chasing a residual it can never
 * clear. Two tests guard it and neither replaces the other: one pins 3000 against all six switches
 * slipping a unit each, the other drives a real generated design through the real optimiser. The
 * first is necessary and not sufficient — 1500 passes it while still leaving designs uneven.
 *
 * **`variety` and `gentle` are opposite ends of ONE dial, and `variety` must stay on by default.**
 * Minimising the week-to-week step, taken to its limit, IS a long block of the same shift — the
 * smallest possible step is no step at all. Settling each week and laying the waves out contiguously
 * gave a person 11 straight weeks of mornings and 11 of afternoons; the live roster's longest run on
 * much the same shift is 3, which is `DEFAULT_BLOCK_TARGET`. So `variety` is weighted as a
 * CONSTRAINT (excess × 400): the optimiser alternates, but by the smallest step available — early →
 * middles → late rather than early → late. `blockRuns` treats a SPARE line as TRANSPARENT: a cover
 * week interrupts but does not change what you go back to, and counting it as a break would let four
 * spare weeks hide a 20-week block behind a reported maximum of 4.
 *
 * `runExcess` is a GRADIENT, never a statistic — it sums excess over every start (a 14-day run also
 * shows as a 13, a 12…) because a maximum is a plateau the 2-opt cannot climb: measured, it stalled
 * at 8 where a random search found 6.
 *
 * Deterministic PER ATTEMPT: attempt 0 is the greedy start, byte-identical to the pre-v20.07
 * behaviour, so every measured figure in the docs still describes the first press; attempt N ≥ 1 is
 * best-of-three seeded shuffles (mulberry32 on the attempt number — **never `Math.random`, never the
 * clock**), so "design 3" is the same design on every device. The spare spread is a FILTER on
 * candidates as well as a weight: a local search can only pay a price it can find a path away from,
 * and attempt 6's three starts all converged into minima that broke the spread. If all three fail,
 * the attempt falls back to attempt 0 and the status line says so.
 */
import { DAYS, startMinutes, endMinutesAbs, worstCaseWorkedRun, workedRunLengths, DEFAULT_MAX_RUN } from './links-design.js';

/** The six things the order can be tuned for. Order matters — it is the display order too. */
export const OBJECTIVES = Object.freeze([
    { key: 'variety',      label: 'Vary the shift type week to week' },
    { key: 'maxRun',       label: 'Cap the shifts in a row' },
    { key: 'gentle',       label: 'Gentle week-to-week change' },
    { key: 'weekends',     label: 'Full weekends off' },
    { key: 'longWeekends', label: 'Long weekends' },
    { key: 'turnarounds',  label: 'Rest across the week boundary' },
]);

/** Minutes a start time may move between weeks before it counts as a real change. Doubles as the
 *  width of a BLOCK: lines whose working day sits within this of each other are the same sort of
 *  week, which is the same 2h the shift waves and FF19 use. */
export const GENTLE_THRESHOLD_MINUTES = 2 * 60;

/** Weeks in a row on much the same shift before it reads as a block. Measured from the live roster:
 *  the main 20-week link's longest is 3 and the bilingual 8-week's is 2. */
export const DEFAULT_BLOCK_TARGET = 3;

/** Rest is RD/OFF only. SPARE is NOT rest — you are on cover and can be called for any shift. */
const isRest = (/** @type {any} */ s) => !s || s === 'RD' || s === 'OFF';

/**
 * The average start time of a line's worked days, or null when it has none that carry a time.
 *
 * A spare line returns null — deliberately. It has no times at all, so "how far did the working day
 * move" has no answer for it; see the module header on why null must not become zero.
 * @param {any} row
 */
export function lineStartProfile(row) {
    if (!row) return null;
    const t = DAYS.map(d => startMinutes(row[d])).filter(v => v !== null);
    return t.length ? t.reduce((a, b) => a + /** @type {number} */ (b), 0) / t.length : null;
}

/**
 * How far the working day moves from `a` to `b`, in minutes, or null if it cannot be measured.
 * Positive = later (the body-clock-friendly direction).
 * @param {any} a
 * @param {any} b
 */
export function weekStep(a, b) {
    const pa = lineStartProfile(a), pb = lineStartProfile(b);
    if (pa === null || pb === null) return null;
    return pb - pa;
}

/**
 * The length of the break spanning the w → w+1 boundary, in days, counting back from Saturday and
 * forward from Sunday.
 *
 * 0 = no full weekend (Sat or Sun is worked). 2 = Sat + Sun. 3 = plus Friday or Monday. 4 = both.
 * A spare day is NOT rest — you are on cover and can be called for any shift.
 *
 * **SUNDAY IS NOT CONTRACTED** (owner, Aug 2026), so `days` and `given` are two different answers and
 * both are returned. A Sunday you do not work is the DEFAULT, not something the design granted you:
 * Sat + Sun off is a two-day break but only ONE contracted day given. Rolled into a single number,
 * a design that simply never rosters Sundays would score as generous with weekends while giving
 * nothing away — which is the same flattery this workspace guards against everywhere else.
 *
 * `days` is what the person experiences and is the right figure for fatigue. `given` is what the
 * design actually cost, and is the right figure for judging the design.
 * @param {any} a - line w
 * @param {any} b - line w+1
 * @returns {{days: number, given: number}}
 */
export function breakLength(a, b) {
    if (!a || !b) return { days: 0, given: 0 };
    if (!isRest(a.sat) || !isRest(b.sun)) return { days: 0, given: 0 };
    let days = 2, given = 1;                 // Sat is contracted; Sun is not
    if (isRest(a.fri)) { days++; given++; }
    if (isRest(b.mon)) { days++; given++; }
    return { days, given };
}

/**
 * Rest in minutes between line w's Saturday duty and line w+1's Sunday duty, or null when either
 * day is not a timed duty.
 *
 * This is the one turnaround `runDesignChecks` cannot see from inside a single line: it is the
 * transition the ROTATION creates, and it exists only because of which line follows which.
 * @param {any} a
 * @param {any} b
 */
export function boundaryRest(a, b) {
    if (!a || !b) return null;
    const end = endMinutesAbs(a.sat), start = startMinutes(b.sun);
    if (end === null || start === null) return null;
    return (24 * 60 - end) + start;
}

/**
 * Split the rotation into BLOCKS — maximal runs of consecutive lines whose working day stays within
 * `span` of the run's first. "How many weeks in a row am I working much the same time."
 *
 * WHY THIS EXISTS (v19.60, owner). Settling each week fixed one problem and created its opposite:
 * every line sat in one shift wave, but the waves were laid onto the lines in contiguous blocks, so
 * moving one line a week gave **11 straight weeks of mornings then 11 of afternoons**. The live
 * roster's longest block is **3** (bilingual 2). Eleven is not a rota, it is a season, and a long
 * block of lates in particular is the socially punishing one.
 *
 * Anchored to the run's FIRST line, not to each step. A design that drifts an hour later every week
 * is a gradual drift, not a block; being stuck within 2h of the same start for eleven weeks is.
 *
 * SPARE LINES ARE TRANSPARENT — they neither break a block nor count towards one. A cover week is a
 * genuine interruption, but it does not change what you go back to the week after, and treating it
 * as a break would let four spare weeks hide a 20-week block behind a reported maximum of 4. That is
 * the flattering reading, and it is the one this workspace keeps having to refuse.
 * @param {Record<string, any>} patterns
 * @param {string[]} order
 * @param {number} [span]
 * @returns {number[]} block lengths, in order
 */
export function blockRuns(patterns, order, span = GENTLE_THRESHOLD_MINUTES) {
    const prof = order.map(k => lineStartProfile(patterns[k]));
    const idx = prof.map((v, i) => (v === null ? -1 : i)).filter(i => i >= 0);
    if (idx.length < 2) return idx.length ? [1] : [];

    // Start the walk at a real boundary so the cyclic partition is canonical rather than an artefact
    // of starting at line 1. If every line is within span of its predecessor there is no boundary,
    // and the honest answer is one block covering the whole rotation.
    const n = idx.length;
    let start = -1;
    for (let k = 0; k < n; k++) {
        const prev = /** @type {number} */ (prof[idx[(k - 1 + n) % n]]);
        const here = /** @type {number} */ (prof[idx[k]]);
        if (Math.abs(here - prev) > span) { start = k; break; }
    }
    if (start < 0) return [n];

    const runs = [];
    let anchor = null, len = 0;
    for (let k = 0; k < n; k++) {
        const v = /** @type {number} */ (prof[idx[(start + k) % n]]);
        if (anchor === null) { anchor = v; len = 1; continue; }
        if (Math.abs(v - anchor) <= span) { len++; continue; }
        runs.push(len); anchor = v; len = 1;
    }
    runs.push(len);
    return runs;
}

/** Weeks beyond `target` across every over-long block — a smooth gradient, unlike the bare maximum. */
export function blockExcess(/** @type {number[]} */ runs, /** @type {number} */ target) {
    return runs.reduce((a, n) => a + Math.max(0, n - target), 0);
}


/**
 * How far the SPARE weeks have been clustered, for a given order — 0 when they are spread as evenly
 * as the rotation allows.
 *
 * ── WHY THE OPTIMISER NEEDS TO BE TOLD THIS (v20.02) ───────────────────────────────────────────
 *
 * `generateLink` reserves whole spare lines and **spreads them evenly around the wheel** — measured
 * on the live seed at 24 lines / 5 spare it places them at 1, 6, 11, 15, 20 (gaps 5, 5, 5, 4, 5).
 * The reorder then ran over the top of that with no objective that cared, and clustering spare weeks
 * happened to help the ones it did care about: the same design came back at 1, 4, 5, 12, 16 — gaps
 * 9, 3, 1, 7, 4, with two spare weeks ADJACENT.
 *
 * That is not cosmetic. Two adjacent spare weeks chain (the first week's four duties at its end, the
 * second's four at its start — `worstCaseWorkedRun` documents exactly this), so the reorder was
 * taking FF11 from **9 to 14** on the generator's own output and pushing it past the threshold the
 * panel reports against. The generator got it right and the optimiser undid it, silently, because
 * the objectives it was given had nothing to say about spare weeks.
 *
 * It is a CONSTRAINT, not a switch. Every other objective here is a preference a designer may not
 * want; an even spread of cover is a property the generator already guarantees, and the reorder's
 * job is to improve the order without destroying what it was handed. There is no "cluster the spare
 * weeks" design anyone would ask for.
 *
 * The measure is the shortfall against the largest gap that always fits — `floor(lines / spares)` —
 * summed over the cyclic gaps, so an adjacency (gap 1) is punished far harder than a gap one short.
 * Returns 0 when there are fewer than two spare weeks: nothing to spread.
 *
 * @param {Record<string, any>} patterns
 * @param {string[]} order
 * @returns {{ excess: number, gaps: number[], minGap: number }}
 */
export function spareSpread(patterns, order) {
    /** @type {number[]} */ const at = [];
    order.forEach((k, i) => {
        const row = patterns[k];
        if (row && DAYS.every(d => row[d] === 'SPARE')) at.push(i);
    });
    if (at.length < 2) return { excess: 0, gaps: [], minGap: order.length };
    const gaps = at.map((v, i) => (i ? v - at[i - 1] : v - at[at.length - 1] + order.length));
    const target = Math.floor(order.length / at.length);
    return {
        excess: gaps.reduce((a, g) => a + Math.max(0, target - g), 0),
        gaps,
        minGap: Math.min(...gaps),
    };
}

/**
 * The longest run of consecutive worked days this order produces, across line boundaries.
 *
 * Delegates to `worstCaseWorkedRun`, which is the ONE reading of a run in this app — so a SPARE week
 * counts as **four** duties of seven and not seven (owner: you are marked spare all week because you
 * are available for cover, but four is what you work, plus possibly an RDW Sunday on top). Counting
 * seven is what reported the live main roster at 15 consecutive days against a true 9, and it is the
 * mistake most easily repeated by anything that measures runs. Do not re-derive it here.
 *
 * @param {Record<string, any>} patterns
 * @param {string[]} order
 */
export function longestRunFor(patterns, order) {
    return worstCaseWorkedRun(runSequence(patterns, order));
}

/** One person's journey through the rotation in this order, seven days per line. */
function runSequence(/** @type {Record<string, any>} */ patterns, /** @type {string[]} */ order) {
    /** @type {Array<{shift: any}>} */ const seq = [];
    for (const k of order) {
        const row = patterns[k] || {};
        for (const d of DAYS) seq.push({ shift: row[d] });
    }
    return seq;
}

/**
 * The optimiser's GRADIENT for the run cap — total excess over the target across every starting day.
 *
 * Not a statistic, and deliberately not reported: a run of 8 shows up again as a 7 from the next day
 * and a 6 from the one after, so long runs count many times over. That multiplicity is the point —
 * it is what makes the surface climbable. Penalising the MAXIMUM instead leaves almost every pair
 * swap scoring identically, and the optimiser stalled at 8 on the live seed where a random search
 * found 6 (measured, at 6 and 30 passes). `blockExcess` sums for the same reason.
 *
 * @param {Record<string, any>} patterns
 * @param {string[]} order
 * @param {number} target
 */
export function runExcess(patterns, order, target) {
    return workedRunLengths(runSequence(patterns, order))
        .reduce((a, n) => a + Math.max(0, n - target), 0);
}

/**
 * Score one ordering of the lines. Returns every figure regardless of what was optimised for, so
 * the cost of an objective is always visible beside its benefit.
 *
 * @param {Record<string, any>} patterns
 * @param {string[]} order - line keys, in rotation order
 * @param {{minRestMinutes?: number, maxRunTarget?: number}} [opts]
 */
export function scoreOrder(patterns, order, opts = {}) {
    const minRest = opts.minRestMinutes ?? 12 * 60;
    const steps = [], breaks = [];
    let unmeasurable = 0, shortBoundary = 0;

    for (let i = 0; i < order.length; i++) {
        const a = patterns[order[i]], b = patterns[order[(i + 1) % order.length]];
        const step = weekStep(a, b);
        if (step === null) unmeasurable++; else steps.push(step);
        breaks.push(breakLength(a, b));
        const rest = boundaryRest(a, b);
        if (rest !== null && rest < minRest) shortBoundary++;
    }

    const runs = blockRuns(patterns, order, GENTLE_THRESHOLD_MINUTES);
    const abs = steps.map(Math.abs);
    const spare = spareSpread(patterns, order);
    return {
        // How long you stay on much the same shift. The live roster's longest is 3.
        blocks: runs,
        longestBlock: runs.length ? Math.max(...runs) : 0,
        // Gentle: mean absolute move, and how many weeks move more than the threshold.
        gentleMean: abs.length ? Math.round(abs.reduce((a, b) => a + b, 0) / abs.length) : 0,
        gentleOver: abs.filter(v => v > GENTLE_THRESHOLD_MINUTES).length,
        gentleWorst: abs.length ? Math.round(Math.max(...abs)) : 0,
        // Reported, never folded into the mean — see the module header.
        unmeasurable,
        weekends: breaks.filter(n => n.days >= 2).length,
        longWeekends: breaks.filter(n => n.days >= 3).length,
        fourDayBreaks: breaks.filter(n => n.days >= 4).length,
        // What the design actually GAVE, Sundays excluded — see breakLength.
        contractedDaysGiven: breaks.reduce((a, n) => a + n.given, 0),
        shortBoundary,
        // Consecutive worked days across line boundaries — a spare week counts as FOUR (see
        // longestRunFor). Reported whatever was optimised for, like every other figure here.
        longestRun: longestRunFor(patterns, order),
        // The optimiser's gradient for that cap. NOT for display — see runExcess.
        runExcess: runExcess(patterns, order, opts.maxRunTarget ?? DEFAULT_MAX_RUN),
        // How evenly the cover weeks are spread. 0 excess = as even as the rotation allows.
        spareExcess: spare.excess,
        spareMinGap: spare.minGap,
        spareGaps: spare.gaps,
    };
}

/**
 * Turn a scorecard into a single number for the optimiser, given which objectives are ON.
 *
 * LOWER IS BETTER. An objective that is off contributes nothing at all — not a small weight — so a
 * switch genuinely means "ignore this", and a designer who turns everything off gets their order
 * back untouched rather than a silent re-sort by whatever was left.
 * @param {ReturnType<typeof scoreOrder>} s
 * @param {Record<string, boolean>} on
 * @param {number} [longWeekendTarget]
 * @param {number} [blockTarget] - weeks in a row on much the same shift before it costs
 *
 * NOTE the run cap takes NO target here, unlike the other two, and the asymmetry is real rather than
 * an oversight. `blocks` and `longWeekends` are reported as arrays and counts, so their shortfall
 * against a target can be worked out afterwards from what `scoreOrder` returned. The run gradient
 * cannot: it is a reduction over ~170 per-day run lengths that are deliberately NOT reported (see
 * `runExcess` on why), so the target has to be applied while the sequence is being walked.
 * `scoreOrder` therefore takes `maxRunTarget` and this function reads the result.
 */
export function cost(s, on, longWeekendTarget = 4, blockTarget = DEFAULT_BLOCK_TARGET) {
    let c = 0;
    // AN EVEN SPREAD OF COVER IS NOT A SWITCH — it is charged unconditionally, and heavily.
    //
    // Every other term here is a preference a designer may reasonably not want. This one protects a
    // property the GENERATOR already established: it reserves whole spare lines and spreads them
    // around the wheel, and before v20.02 the reorder cheerfully undid that because clustering them
    // helped the objectives it was told about. Two adjacent spare weeks chain into one long run, so
    // the reorder was taking FF11 from 9 to 14 on the generator's own output — past the threshold
    // the panel reports against — with nothing on screen to say the order had done it.
    //
    // THE WEIGHT HAS TO DOMINATE, NOT MERELY LEAD — and the first attempt did not.
    //
    // It was written at 500, with a comment claiming it was "weighted above `variety`, the previous
    // heaviest". Per unit it was. But these terms ACCUMULATE at different rates: two units of block
    // excess bid 800, so `variety` simply outbid it, and the default (every switch on) came back with
    // gaps of 7,6,5,6 where 6,6,6,6 was available. Comparing per-unit weights between terms that
    // accumulate differently is the mistake; the comment read as though the question had been settled.
    // Caught before release, in this same version — 500 never reached a device.
    //
    // Measured across 16 design shapes (20/22/24/28 lines × 3/4/5/6 cover weeks), each reordered with
    // every switch on and with `variety` alone — 32 runs, total excess against a perfect spread:
    //
    //     w=500  10      w=1500  7      w=2000  0      w=3000  0      w=5000  0
    //     w=800   7      w=1200  8
    //
    // The dominating plateau begins at 2000 and nothing above it behaves differently, so this sits
    // one step inside rather than on its edge. Everything below is a local outcome, not a rule: 800
    // and 1200 look almost as good in total and still leave whole shapes uneven.
    //
    // The cost of dominating is real and small: 273 worked-day run-length across those 32 runs
    // against 267 at w=500, i.e. about a fifth of a day per design. Say that out loud rather than
    // presenting the constraint as free.
    //
    // What makes it SAFE to treat as a constraint at all is that `spareSpread` targets
    // `floor(lines / spares)`. Gaps as equal as the rotation allows are then always ≥ target, so
    // excess 0 is reachable for every shape — the optimiser can never be told to chase a residual it
    // cannot clear, which is what a dominating weight over an unreachable target would do.
    //
    // NOTE the harm this term was written for — two adjacent cover weeks chaining into one long run —
    // was already prevented at 500 (zero adjacencies in all 32 runs, at every weight tried). What the
    // weight buys is the last of the evenness, which is what was actually asked for.
    c += (s.spareExcess ?? 0) * 3000;
    // Variety is the heaviest of the SWITCHES, because it works as a constraint rather than a
    // preference: keep the blocks short, and let the other objectives arrange things inside that.
    // Gentle pulls the opposite way — minimising the week-to-week step, taken to its limit, IS a
    // block — so with both on the optimiser alternates, but alternates by the smallest step it can
    // (early → middles → late rather than early → late), which is the answer that serves both.
    if (on.variety)      c += blockExcess(s.blocks, blockTarget) * 400;
    // Only the EXCESS over the target costs, so the optimiser has no reason to trade anything away
    // once the cap is met — the aim is "no more than N", not "as few as possible", and treating it
    // as the latter would spend the other objectives' freedom on a number nobody asked to minimise.
    // WEIGHT CHOSEN BY MEASUREMENT — AND THE MEASUREMENT WAS RE-TAKEN, because the first one was
    // partly the spare-spread bug talking.
    //
    // 40 was originally justified as: 100/150/300 reach run 7 but take FF11 to 14 and weekends down
    // to 4, so pushing the cap harder makes the design worse on the factor the panel reports. With
    // the cover weeks now held evenly (above), that is no longer what happens. Re-measured on the
    // live seed, everything else on:
    //
    //     w= 40  run 8 · FF11 11 · 9 weekends off      w=200  run 6 · FF11 16 · 6 weekends
    //     w=100  run 7 · FF11 11 · 7 weekends          w=300  run 6 · FF11  9 · 6 weekends
    //     w=150  run 6 · FF11  9 · 5 weekends          w=600  run 6 · FF11 10 · 6 weekends
    //
    // READ THE FF11 COLUMN AS NOISE, NOT AS A CURVE. It goes 11, 11, 9, 16, 9, 10 — this is a
    // heuristic 2-opt landing in different local minima, so no single FF11 figure there is a
    // property of the weight, and quoting one as a consequence would be over-claiming from a search
    // that bounces. The stable finding is the WEEKENDS column: every weight that reaches the 6-day
    // target costs 3–4 full weekends off across the rotation.
    //
    // 40 is kept on that trade — a longest run of 8 sits well inside the 13-day company limit, and
    // three or four more full weekends is a thing staff actually feel. It is an OWNER decision
    // rather than a tuning exercise, which is why the alternative is written down here instead of
    // being quietly adopted. See LINKS_DEC2026_PLAN.md → the run cap.
    //
    // So this is deliberately a firm PREFERENCE rather than the near-absolute weight `variety`
    // carries. With the switch on alone it reaches the 6 target; with the full set on it reaches 8,
    // and the status line says so rather than letting the box imply a guarantee it did not deliver
    // (the rotating fallback's phantom "never a late finish then an early start" is what that
    // mistake looks like when nobody checks).
    if (on.maxRun)       c += (s.runExcess ?? 0) * 40;
    if (on.gentle)       c += s.gentleMean + s.gentleOver * 60;
    if (on.weekends)     c += -s.weekends * 120;
    // Only the SHORTFALL is penalised. Rewarding every long weekend without limit would spend the
    // whole rest budget on a handful of lines and leave the rest of the rotation with none — "now
    // and again" is the requirement, not "as many as possible".
    if (on.longWeekends) c += Math.max(0, longWeekendTarget - s.longWeekends) * 240;
    if (on.turnarounds)  c += s.shortBoundary * 600;
    return c;
}

/**
 * A tiny seeded PRNG (mulberry32). Exists so ATTEMPTS below are reproducible: the same attempt
 * number always shuffles the same way, on every device. `Math.random` here would quietly convert
 * "deterministic per attempt" into "random per press", which is precisely the property being
 * protected — two designers on attempt 3 must be looking at the same design.
 * @param {number} seed
 */
function mulberry32(seed) {
    let a = seed | 0;
    return function () {
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Reorder the lines to suit the objectives that are switched on.
 *
 * DETERMINISTIC PER ATTEMPT (v20.07 — was flatly deterministic, which made the Generate button a
 * dead end: pressing it again returned the identical design, so a designer could never ask "is
 * there another arrangement?" without changing a target they did not want to change — the owner's
 * report). The 2-opt is a local search, and a local search's result is a function of where it
 * STARTS: attempt 0 starts from the greedy order exactly as before (byte-identical output, so every
 * measured figure in the docs still describes the first press), and attempt N ≥ 1 starts from three
 * seeded shuffles instead, keeping the best of the three by cost. Different attempts land in
 * different local minima — different designs, same coverage.
 *
 * What was deliberately KEPT from the old rule is reproducibility, because that was always the
 * point of the determinism: the same design, switches and attempt number give the same order on any
 * device, so a designer can get a variant back by pressing Generate the same number of times, and
 * two designers comparing "design 3" are comparing the same thing. The seed comes from the attempt
 * counter, never from `Math.random` or the clock.
 *
 * A greedy nearest-neighbour pass (attempt 0) followed by repeated pair swaps (a bounded 2-opt).
 * Exact ordering is a travelling-salesman problem; this is not optimal and does not pretend to be —
 * it is a large improvement on an arbitrary order, which is what the designs actually start from.
 *
 * @param {Record<string, any>} patterns
 * @param {object} [opts]
 * @param {Record<string, boolean>} [opts.on] - which objectives are enabled
 * @param {number} [opts.longWeekendTarget]
 * @param {number} [opts.blockTarget] - weeks in a row on much the same shift before it costs
 * @param {number} [opts.maxRunTarget] - consecutive worked days before it costs
 * @param {number} [opts.passes] - improvement sweeps
 * @param {number} [opts.attempt] - 0 = the canonical greedy-start design; N ≥ 1 = the Nth seeded variant
 * @returns {{order: string[], before: ReturnType<typeof scoreOrder>, after: ReturnType<typeof scoreOrder>, changed: boolean, attempt: number}}
 */
export function reorderLines(patterns, { on = {}, longWeekendTarget = 4, blockTarget = DEFAULT_BLOCK_TARGET,
    maxRunTarget = DEFAULT_MAX_RUN, passes = 6, attempt = 0 } = {}) {
    const keys = Object.keys(patterns || {}).sort((a, b) => Number(a) - Number(b));
    // Measured against the CHOSEN run target, not the default. Nothing on screen reads `runExcess`
    // today, so this changes no visible figure — but a scorecard handed back to the caller measured
    // against a target the caller did not ask for is a trap set for whoever displays it next.
    const before = scoreOrder(patterns, keys, { maxRunTarget });
    const anyOn = OBJECTIVES.some(o => on[o.key]);
    // Everything off means leave it alone. Re-sorting by an empty objective set would hand back a
    // different design for no stated reason, which is worse than doing nothing.
    if (!anyOn || keys.length < 3) return { order: keys, before, after: before, changed: false, attempt };

    const scoreOf = (/** @type {string[]} */ ord) =>
        cost(scoreOrder(patterns, ord, { maxRunTarget }), on, longWeekendTarget, blockTarget);

    // Bounded 2-opt from a given start: swap pairs while it helps. Fixed sweep count, so runtime is
    // predictable. Mutates and returns its input — callers hand it a fresh array.
    const twoOpt = (/** @type {string[]} */ order) => {
        let current = scoreOf(order);
        for (let pass = 0; pass < passes; pass++) {
            let improved = false;
            for (let i = 0; i < order.length - 1; i++) {
                for (let j = i + 1; j < order.length; j++) {
                    const trial = order.slice();
                    [trial[i], trial[j]] = [trial[j], trial[i]];
                    const c = scoreOf(trial);
                    if (c < current) { order.splice(0, order.length, ...trial); current = c; improved = true; }
                }
            }
            if (!improved) break;
        }
        return { order, cost: current };
    };

    /** @type {string[][]} */
    let starts;
    if (attempt === 0) {
        // Greedy: keep the first line where it is and repeatedly take whichever remaining line makes
        // the best next step. Starting from line 1 rather than the best possible start keeps it
        // stable. This is the ORIGINAL path, untouched — attempt 0 must keep producing the exact
        // design every doc figure was measured on.
        const remaining = keys.slice(1);
        const order = [keys[0]];
        while (remaining.length) {
            let bestI = 0, bestC = Infinity;
            for (let i = 0; i < remaining.length; i++) {
                const trial = [...order, remaining[i], ...remaining.filter((_, j) => j !== i)];
                const c = scoreOf(trial);
                if (c < bestC) { bestC = c; bestI = i; }
            }
            order.push(remaining.splice(bestI, 1)[0]);
        }
        starts = [order];
    } else {
        // Three seeded shuffles per attempt, best-of by cost. Three rather than one because a single
        // shuffled start can land in a markedly poor minimum, and rather than many because each
        // start pays a full 2-opt; three keeps a press comfortably fast while smoothing the floor.
        // The seed mixes attempt and restart index with large odd constants so consecutive attempts
        // do not walk near-identical shuffles.
        const RESTARTS = 3;
        starts = [];
        for (let r = 0; r < RESTARTS; r++) {
            const rand = mulberry32((attempt * 0x9E3779B1 + r * 0x85EBCA77) | 0);
            const s = keys.slice();
            for (let i = s.length - 1; i > 0; i--) {
                const j = Math.floor(rand() * (i + 1));
                [s[i], s[j]] = [s[j], s[i]];
            }
            starts.push(s);
        }
    }

    // THE SPARE SPREAD IS A FILTER HERE, NOT JUST A WEIGHT — found by measurement before this
    // shipped. On the live seed, attempt 6's three shuffled starts all converged into minima the
    // 2-opt could not climb out of, and the best of them carried cover-week gaps 6,7,6,5: the
    // w=3000 weight made it EXPENSIVE, but a local search can only pay a price it can find a path
    // away from. An even cover spread is the one property v20.02 promised the reorder can never
    // undo, so a candidate that breaks it is not a worse candidate — it is not a candidate.
    // If every start fails (never observed, but a shuffle owes no guarantees), fall back to the
    // canonical greedy design, whose spread the 128-configuration sweep holds: a duplicate of
    // design 1 is a dull answer, an uneven one is a broken promise.
    const scored = starts.map(s => {
        const r = twoOpt(s);
        return { ...r, spareExcess: scoreOrder(patterns, r.order, { maxRunTarget }).spareExcess ?? 0 };
    });
    let best = null;
    for (const c of scored.filter(c => c.spareExcess === 0)) {
        if (!best || c.cost < best.cost) best = c;
    }
    if (!best && attempt !== 0) {
        return reorderLines(patterns, { on, longWeekendTarget, blockTarget, maxRunTarget, passes, attempt: 0 });
    }
    if (!best) best = scored[0];   // attempt 0 itself failed the filter — ship it anyway, see above
    const order = best.order;

    const after = scoreOrder(patterns, order, { maxRunTarget });
    return { order, before, after, changed: order.some((k, i) => k !== keys[i]), attempt };
}

/**
 * Apply an order, renumbering the lines 1..N.
 * @param {Record<string, any>} patterns
 * @param {string[]} order
 */
export function applyOrder(patterns, order) {
    /** @type {Record<string, any>} */
    const out = {};
    order.forEach((key, i) => { out[String(i + 1)] = patterns[key]; });
    return out;
}
