// @ts-check
/**
 * links-adjacency.js — what happens BETWEEN the lines: the order they sit in.
 *
 * Pure. No DOM, no Firebase. Built on the back of the FF18 discussion (.claude/rules/links-design.md →
 * Fatigue factors).
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
 * the others, so the tool lets you turn each on and SHOWS what it cost the rest, rather than blending
 * them into one score that hides the trade. `scoreOrder` returns every figure whatever you optimised for.
 *
 * THE TRAP: **a spare week must not read as a gentle transition.** A spare line carries no times, so
 * the step across it cannot be measured — scored as "no change", an optimiser would park spare weeks
 * between the two harshest lines and report a beautiful number (the false assurance
 * `links-fatigue.js` exists to avoid). Unmeasurable steps are counted and reported SEPARATELY, never
 * folded into the mean.
 *
 * ── THREE MORE RULES ─────────────────────────────────────────────────────────────────────────────
 *
 * **The spare spread is charged UNCONDITIONALLY, not as a switch.** Every other term is a preference;
 * this one protects a guarantee: `generateLink` places the cover weeks evenly, and two ADJACENT spare
 * weeks chain into one long run (FF11 from 9 to 14 — a fatigue finding of the tool's own making). It
 * is the only term that can make a design WORSE than the one the reorder was handed. **Its weight is
 * 3000**, because these terms ACCUMULATE at different rates — comparing per-unit weights (500 "above
 * `variety`'s 400") is the mistake; `cost` holds the measurement. Two tests guard it and neither
 * replaces the other: one pins 3000 against every switch slipping a unit at once, the other drives a
 * real generated design through the real optimiser (1500 passes the first while leaving designs uneven).
 *
 * **Rest across the week boundary is a constraint too.** Minimum rest is a gate the generator applies
 * BEFORE the reorder, so a switch to ignore it would be a switch for undoing the gate. It is charged
 * in every configuration and filtered on.
 *
 * **`variety` and `gentle` are opposite ends of ONE dial, and `variety` must stay on by default.**
 * Minimising the week-to-week step, taken to its limit, IS a long block of the same shift (laid out
 * contiguously, the waves gave 11 straight weeks of mornings then 11 of afternoons; the live roster's
 * longest is 3, `DEFAULT_BLOCK_TARGET`). So `variety` is weighted as a CONSTRAINT (excess × 400): the
 * optimiser alternates by the smallest step available — early → middles → late. `blockRuns` treats a
 * SPARE line as TRANSPARENT and reads the rotation as a CIRCLE, from every line.
 *
 * `runExcess` is a GRADIENT, never a statistic (see it).
 *
 * Deterministic PER ATTEMPT: attempt 0 is the greedy start, so the first press is the canonical
 * design (the roster seed every figure in the docs is measured on); attempt N ≥ 1 is best-of-three
 * seeded shuffles (mulberry32 on the attempt number — **never `Math.random`, never the clock**), so
 * "design 3" is the same design on every device. The spare spread is a FILTER on candidates as well
 * as a weight (see `reorderLines`). If all three fail, the attempt falls back to attempt 0 and the
 * status line says so.
 */
import { DAYS, startMinutes, restBetween, worstCaseWorkedRun, workedRunLengths, DEFAULT_MAX_RUN, isCoverWeek, isRest, MIN_REST_MINUTES } from './links-design.js';

/** The things the order can be TUNED for — one per checkbox on the generator card, whose `key` is
 *  what `reorderLines` and `cost` read. This array does not draw the switches: they are static markup
 *  in links.html, worded there, so a label changed here changes nothing on screen. Rest across the
 *  week boundary is a constraint, like the spare spread — see `cost`. */
export const OBJECTIVES = Object.freeze([
    { key: 'variety',      label: 'Vary the shift type week to week' },
    { key: 'maxRun',       label: 'Cap the shifts in a row' },
    { key: 'gentle',       label: 'Gentle week-to-week change' },
    { key: 'weekends',     label: 'Full weekends off' },
    { key: 'longWeekends', label: 'Long weekends' },
]);

/** Minutes a start time may move between weeks before it counts as a real change. Doubles as the
 *  width of a BLOCK: lines whose working day sits within this of each other are the same sort of
 *  week, which is the same 2h the shift waves and FF19 use. */
export const GENTLE_THRESHOLD_MINUTES = 2 * 60;

/** Weeks in a row on much the same shift before it reads as a block. Measured from the live roster:
 *  the main 20-week link's longest is 3 and the bilingual 8-week's is 2. */
export const DEFAULT_BLOCK_TARGET = 3;

// Rest is RD/OFF only — SPARE is NOT rest. `isRest` is links-design.js's, shared with links-fatigue.js.

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
    return _stepBetween(lineStartProfile(a), lineStartProfile(b));
}

/** `weekStep` on two start profiles already read — the reorder reads each line's once. */
function _stepBetween(/** @type {number|null} */ pa, /** @type {number|null} */ pb) {
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
 * Sat + Sun off is a two-day break but only ONE contracted day given — one number would flatter a
 * design that never rosters Sundays.
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
    return restBetween(a.sat, b.sun);   // the ONE reading of a turnaround (links-design.js)
}

/**
 * Split the rotation into BLOCKS — maximal runs of consecutive lines whose working day stays within
 * `span` of the run's first. "How many weeks in a row am I working much the same time."
 *
 * WHY THIS EXISTS (owner). Contiguous shift waves gave **11 straight weeks of mornings then 11 of
 * afternoons**; the live roster's longest block is **3** (bilingual 2). Eleven is not a rota, it is a
 * season, and a long block of lates in particular is the socially punishing one.
 *
 * Anchored to the run's FIRST line, not to each step. A design that drifts an hour later every week
 * is a gradual drift, not a block; being stuck within 2h of the same start for eleven weeks is.
 *
 * SPARE LINES ARE TRANSPARENT — they neither break a block nor count towards one. A cover week does
 * not change what you go back to the week after, and treating it as a break would let four spare
 * weeks hide a 20-week block behind a reported maximum of 4.
 *
 * A PROPERTY OF THE CIRCLE (owner, 10 Nov 2026). An anchored walk round a circle partitions it
 * differently depending on where it starts (06:20, 08:30, 07:15, 09:30 read as 1+3 from the first
 * line and 1+1+2 from the 09:30 line), so it walks from EVERY line and keeps the reading with the most
 * weeks stuck on one shift (longest block first, then the next): the same rotation is charged the
 * same however it is numbered. Its longest block is `longestBlockOf`, the figure a designer is told.
 * @param {Record<string, any>} patterns
 * @param {string[]} order
 * @param {number} [span]
 * @returns {number[]} block lengths, longest first
 */
export function blockRuns(patterns, order, span = GENTLE_THRESHOLD_MINUTES) {
    return _blockRunsOf(order.map(k => lineStartProfile(patterns[k])), span);
}

/** `blockRuns`' walk over start profiles already read — the reorder reads each line's once. */
function _blockRunsOf(/** @type {Array<number|null>} */ prof, /** @type {number} */ span) {
    const vals = /** @type {number[]} */ (prof.filter(v => v !== null));   // spare lines are transparent
    const n = vals.length;
    if (n < 2) return n ? [1] : [];
    /** @type {number[]} */ let worst = [];
    for (let start = 0; start < n; start++) {
        const runs = [];
        let anchor = vals[start], len = 1;
        for (let k = 1; k < n; k++) {
            const v = vals[(start + k) % n];
            if (Math.abs(v - anchor) <= span) { len++; continue; }
            runs.push(len); anchor = v; len = 1;
        }
        runs.push(len);
        runs.sort((a, b) => b - a);
        if (_longerFirst(runs, worst) > 0) worst = runs;
    }
    return worst;
}

/** Compare two partitions sorted longest first: positive when `a` holds the longer blocks. */
function _longerFirst(/** @type {number[]} */ a, /** @type {number[]} */ b) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const d = (a[i] ?? 0) - (b[i] ?? 0);
        if (d) return d;
    }
    return 0;
}

/**
 * The longest BLOCK, as a property of the circle: the longest stretch of consecutive lines whose
 * working day stays within `span` of the stretch's first week, asked from EVERY line in turn and
 * capped at the rotation. Renumbering the rotation cannot change it, and a gradual drift is measured
 * as the stretches it really holds rather than as one block. Spare lines are transparent, as in
 * `blockRuns`. This is the figure the generator's status line names.
 * @param {Record<string, any>} patterns
 * @param {string[]} order
 * @param {number} [span]
 * @returns {number}
 */
export function longestBlockOf(patterns, order, span = GENTLE_THRESHOLD_MINUTES) {
    const prof = /** @type {number[]} */ (order.map(k => lineStartProfile(patterns[k])).filter(v => v !== null));
    const n = prof.length;
    let best = 0;
    for (let s = 0; s < n; s++) {
        let len = 1;
        while (len < n && Math.abs(prof[(s + len) % n] - prof[s]) <= span) len++;
        if (len > best) best = len;
    }
    return best;
}

/** Weeks beyond `target` across every over-long block — a smooth gradient, unlike the bare maximum. */
export function blockExcess(/** @type {number[]} */ runs, /** @type {number} */ target) {
    return runs.reduce((a, n) => a + Math.max(0, n - target), 0);
}


/**
 * How far the SPARE weeks have been clustered, for a given order — 0 when they are spread as evenly
 * as the rotation allows.
 *
 * ── WHY THE OPTIMISER NEEDS TO BE TOLD THIS ────────────────────────────────────────────────────
 *
 * `generateLink` **spreads the spare lines evenly around the wheel** (gaps 5, 5, 5, 4, 5 on a
 * historical 24-line seed); a reorder with no objective that cared clustered them (gaps 9, 3, 1, 7, 4,
 * two ADJACENT). Two adjacent spare weeks chain (`worstCaseWorkedRun`), taking FF11 from **9 to 14**
 * on the generator's own output. It is a CONSTRAINT, not a switch: there is no "cluster the spare
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
        if (isCoverWeek(row)) at.push(i);
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
 * counts as **four** duties of seven and not seven (owner: four is what you work, plus possibly an RDW
 * Sunday on top). Counting seven reported the live main roster at 15 consecutive days against a true
 * 9. Do not re-derive it here.
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
 * and a 6 from the one after — the multiplicity that makes the surface climbable. Penalising the
 * MAXIMUM, the optimiser stalled at 8 where a random search found 6. `blockExcess` sums for the same reason.
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
    // The generator's own gate figure, never a copy: a reorder filtering on a different minimum could
    // put back the Saturday-into-Sunday turnaround the gate had just repaired.
    const w = _orderFigures(patterns, order, k => lineStartProfile(patterns[k]),
        opts.minRestMinutes ?? MIN_REST_MINUTES, opts.maxRunTarget ?? DEFAULT_MAX_RUN);
    return {
        // `blocks` is the optimiser's partition (`variety` charges its excess), longest first, so its
        // first entry IS `longestBlock`, the reported figure; both are read round the circle, so
        // renumbering moves neither. How long you stay on much the same shift — the live roster's is 3.
        blocks: w.blocks,
        longestBlock: longestBlockOf(patterns, order, GENTLE_THRESHOLD_MINUTES),
        // Gentle: mean absolute move, and how many weeks move more than the threshold.
        gentleMean: w.gentleMean,
        gentleOver: w.gentleOver,
        gentleWorst: w.abs.length ? Math.round(Math.max(...w.abs)) : 0,
        // Reported, never folded into the mean — see the module header.
        unmeasurable: w.unmeasurable,
        weekends: w.weekends,
        longWeekends: w.longWeekends,
        fourDayBreaks: w.breaks.filter(n => n.days >= 4).length,
        // What the design actually GAVE, Sundays excluded — see breakLength.
        contractedDaysGiven: w.breaks.reduce((a, n) => a + n.given, 0),
        shortBoundary: w.shortBoundary,
        // Consecutive worked days across line boundaries — a spare week counts as FOUR (see
        // longestRunFor). Reported whatever was optimised for, like every other figure here.
        longestRun: longestRunFor(patterns, order),
        // The optimiser's gradient for that cap. NOT for display — see runExcess.
        runExcess: w.runExcess,
        // How evenly the cover weeks are spread. 0 excess = as even as the rotation allows.
        spareExcess: w.spareExcess,
        spareMinGap: w.spare.minGap,
        spareGaps: w.spare.gaps,
    };
}

/**
 * The one walk round an order that both scorers share: every figure `cost` reads, plus the pieces
 * `scoreOrder` reports from (`abs`, `breaks`, `unmeasurable`, `spare`).
 *
 * WHY THE SEARCH DOES NOT CALL `scoreOrder`: a press of Generate scores a few thousand orders, and
 * `scoreOrder` measures figures the search never reads. The search calls this alone, with a
 * `profileOf` that reads each line's profile once per reorder. It is ONE copy of the arithmetic, so
 * the figure a designer is shown and the figure the search chose by cannot drift apart.
 * @param {Record<string, any>} patterns
 * @param {string[]} order
 * @param {(key: string) => number|null} profileOf - a line's `lineStartProfile`
 * @param {number} minRest - minutes
 * @param {number} maxRunTarget
 */
function _orderFigures(patterns, order, profileOf, minRest, maxRunTarget) {
    /** @type {number[]} */ const steps = [];
    /** @type {Array<{days: number, given: number}>} */ const breaks = [];
    let unmeasurable = 0, shortBoundary = 0;
    for (let i = 0; i < order.length; i++) {
        const ka = order[i], kb = order[(i + 1) % order.length];
        const a = patterns[ka], b = patterns[kb];
        const step = _stepBetween(profileOf(ka), profileOf(kb));
        if (step === null) unmeasurable++; else steps.push(step);
        breaks.push(breakLength(a, b));
        const rest = boundaryRest(a, b);
        if (rest !== null && rest < minRest) shortBoundary++;
    }
    const abs = steps.map(Math.abs);
    const spare = spareSpread(patterns, order);
    return {
        blocks: _blockRunsOf(order.map(k => profileOf(k)), GENTLE_THRESHOLD_MINUTES),
        gentleMean: abs.length ? Math.round(abs.reduce((x, y) => x + y, 0) / abs.length) : 0,
        gentleOver: abs.filter(v => v > GENTLE_THRESHOLD_MINUTES).length,
        weekends: breaks.filter(n => n.days >= 2).length,
        longWeekends: breaks.filter(n => n.days >= 3).length,
        shortBoundary,
        runExcess: runExcess(patterns, order, maxRunTarget),
        spareExcess: spare.excess,
        abs, breaks, unmeasurable, spare,
    };
}

/**
 * Turn a scorecard into a single number for the optimiser, given which objectives are ON.
 *
 * LOWER IS BETTER. An objective that is off contributes nothing at all — not a small weight — so a
 * switch genuinely means "ignore this", and a designer who turns everything off gets their order
 * back untouched rather than a silent re-sort by whatever was left.
 * @param {Pick<ReturnType<typeof scoreOrder>, 'spareExcess'|'blocks'|'runExcess'|'gentleMean'|'gentleOver'|'weekends'|'longWeekends'|'shortBoundary'>} s
 *   a scorecard — `scoreOrder`'s, or the search's `_orderFigures`
 * @param {Record<string, boolean>} on
 * @param {number} [longWeekendTarget]
 * @param {number} [blockTarget] - weeks in a row on much the same shift before it costs
 *
 * NOTE the run cap takes NO target here, unlike the other two, deliberately: the run gradient is a
 * reduction over per-day run lengths that are NOT reported (`runExcess`), so its target is applied
 * while the sequence is walked — `scoreOrder` takes `maxRunTarget` and this reads the result.
 */
export function cost(s, on, longWeekendTarget = 4, blockTarget = DEFAULT_BLOCK_TARGET) {
    let c = 0;
    // AN EVEN SPREAD OF COVER IS NOT A SWITCH — it is charged unconditionally, and heavily.
    //
    // It protects a property the GENERATOR established (spare lines spread around the wheel; see the
    // module header).
    //
    // THE WEIGHT HAS TO DOMINATE, NOT MERELY LEAD. At 500 ("above `variety`") two units of block excess
    // bid 800 and `variety` outbid it: gaps 7,6,5,6 where 6,6,6,6 was available. These terms ACCUMULATE
    // at different rates, so comparing per-unit weights is the mistake.
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
    // (Adjacencies were already prevented at 500; the weight buys the last of the evenness, which is
    // what was asked for.)
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
    // WEIGHT CHOSEN BY MEASUREMENT, on the live seed with the cover weeks held evenly, everything else on:
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
    // three or four more full weekends is a thing staff actually feel. An OWNER decision, not a tuning
    // exercise (KNOWN_LIMITATIONS.md → "The run cap cannot always reach its target"). So it is a firm PREFERENCE: alone it reaches the 6
    // target, with the full set 8, and the status line says so rather than implying a guarantee.
    if (on.maxRun)       c += (s.runExcess ?? 0) * 40;
    if (on.gentle)       c += s.gentleMean + s.gentleOver * 60;
    if (on.weekends)     c += -s.weekends * 120;
    // Only the SHORTFALL is penalised. Rewarding every long weekend without limit would spend the
    // whole rest budget on a handful of lines and leave the rest of the rotation with none — "now
    // and again" is the requirement, not "as many as possible".
    if (on.longWeekends) c += Math.max(0, longWeekendTarget - s.longWeekends) * 240;
    // REST ACROSS THE WEEK BOUNDARY IS CHARGED UNCONDITIONALLY TOO. Minimum rest is a GATE (owner:
    // "That would never be allowed by Chiltern"), applied before this module sees the design; as a
    // switch, unticked, the reorder put a 23:55 Saturday finish before a 07:15 Sunday start in 45 of 64
    // combinations. `reorderLines` also FILTERS on it, because a weight can always be outbid.
    c += (s.shortBoundary ?? 0) * 600;
    return c;
}

/**
 * A tiny seeded PRNG (mulberry32). Exists so ATTEMPTS below are reproducible: the same attempt
 * number always shuffles the same way, on every device. Never `Math.random`: two designers on
 * attempt 3 must be looking at the same design.
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
 * DETERMINISTIC PER ATTEMPT, so pressing Generate again can offer another arrangement (owner): the
 * 2-opt's result depends on where it STARTS. Attempt 0 starts from the greedy order (the first press,
 * which every measured figure in the docs describes); attempt N ≥ 1 from three seeded shuffles, best
 * by cost — different local minima, same coverage. The same design, switches and attempt number give
 * the same order on any device: the seed is the attempt counter, never `Math.random` or the clock.
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
    // Measured against the CHOSEN run target, not the default, so a scorecard handed back is never
    // measured against a target the caller did not ask for.
    const before = scoreOrder(patterns, keys, { maxRunTarget });
    const anyOn = OBJECTIVES.some(o => on[o.key]);
    // Everything off means leave it alone. Re-sorting by an empty objective set would hand back a
    // different design for no stated reason, which is worse than doing nothing.
    if (!anyOn || keys.length < 3) return { order: keys, before, after: before, changed: false, attempt };

    // Each line's start profile is read ONCE per reorder, not three times per candidate, and a
    // candidate is scored on what `cost` reads and nothing more (see `_orderFigures`).
    const profiles = new Map(keys.map(k => [k, lineStartProfile(patterns[k])]));
    const profileOf = (/** @type {string} */ k) => profiles.get(k) ?? null;
    const scoreOf = (/** @type {string[]} */ ord) =>
        cost(_orderFigures(patterns, ord, profileOf, MIN_REST_MINUTES, maxRunTarget), on, longWeekendTarget, blockTarget);

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
        // the best next step. Attempt 0 must keep producing the exact design every doc figure was
        // measured on.
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

    // THE SPARE SPREAD IS A FILTER HERE, NOT JUST A WEIGHT: attempt 6's three shuffled starts all
    // converged into minima carrying gaps 6,7,6,5 — a local search can only pay a price it can find a
    // path away from. A candidate that breaks the even spread is not a worse candidate, it is not a
    // candidate. If every start fails, fall back to the canonical greedy design: a duplicate of design
    // 1 is a dull answer, an uneven one is a broken promise.
    //
    // MINIMUM REST IS A FILTER TOO: the generator's rest gate runs BEFORE this order is chosen, so a
    // candidate with more short Saturday-into-Sunday turnarounds than it was handed is not a candidate.
    //
    // And if attempt 0 itself fails either filter, the order it was HANDED is kept: the generator's
    // own order already keeps both promises.

    const scored = starts.map(s => {
        const r = twoOpt(s);
        const sc = scoreOrder(patterns, r.order, { maxRunTarget });
        return { ...r, spareExcess: sc.spareExcess ?? 0, shortBoundary: sc.shortBoundary };
    });
    let best = null;
    for (const c of scored.filter(c => c.spareExcess === 0 && c.shortBoundary <= before.shortBoundary)) {
        if (!best || c.cost < best.cost) best = c;
    }
    if (!best && attempt !== 0) {
        return reorderLines(patterns, { on, longWeekendTarget, blockTarget, maxRunTarget, passes, attempt: 0 });
    }
    if (!best) return { order: keys, before, after: before, changed: false, attempt };
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
