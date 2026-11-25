// @ts-check
/**
 * links-generate.js — the link GENERATOR for links.html: per-shift staffing targets in, a whole
 * rotation out, or a refusal that names why. Pure: no DOM, no Firebase.
 *
 * Owns: `generateLink` and its thin `generatePatterns` wrapper, the two constructions (settled
 *   weeks, and the rotating-window fallback), the waves (`groupIntoWaves`, `WAVE_SPAN_MINUTES`), the
 *   contract gate's arithmetic (`targetExSundayMinutes`) and the minimum-rest repair
 *   (`repairShortRest`).
 * Does NOT own: the shift reading, the rest between two duties (`restBetween`), the rotation length
 *   or any constant — those stay in links-design.js, which this module imports and which imports
 *   nothing. The e2e routes that rewrite `MIN_REST_MINUTES` and `SPARE_WORKED_DAYS` rewrite THAT
 *   file, so the constants must not be copied here: an imported binding is the one they move.
 *   The ORDER of the lines is links-adjacency.js's.
 * Edit here for: the generator algorithm, its refusals, the rest repair.
 * Tested by links-design.test.mjs (the constructions), links-contract.test.mjs (the refusals),
 * links-adjacency.test.mjs and links-default-targets.test.mjs.
 *
 * Moved out of links-design.js on 25 Nov 2026, when that module reached its line cap — the code and
 * every comment beside it unchanged. Its rules that must survive an edit:
 *
 * `generateLink` groups slots into WAVES by start time (within `WAVE_SPAN_MINUTES`, the FF19
 * threshold) and gives each wave a contiguous block of lines, so a line never leaves its wave.
 * Two rules were wrong on the first attempt and both made the link UNFAIR: a wave too small to fund
 * a line is **merged into its nearer neighbour** (two weekend-only slots once held a whole line, so
 * somebody worked two days a week), and a lap is **spread across the week, never front-loaded**.
 * The older rotating construction is kept as a fallback and **refuses** (`no-rest`) when strides
 * cannot fund a lap, rather than shipping the phantom "only moves later" guarantee it used to
 * claim — positions read mod `working`, so every line wrapped front-to-back once a week.
 * Interleaving the waves inside the generator is a WON'T-DO: tried and reverted, it fixes raw block
 * length but puts a late wave's 23:55 Saturday beside a morning wave's 06:20 Sunday. The generator
 * owns the SHAPE; `links-adjacency.js` owns the ORDER. A test fails if the interleave returns.
 *
 * **`generateLink` REFUSES targets that do not pay the contracted week EXACTLY** — the mean
 * `weeklyHours` reports (links-design.js), `short-hours` (v20.98) and
 * `over-hours` (v20.99). The check is on the TARGETS, because the arithmetic is settled before a
 * cell is laid out and no arrangement can rescue a table that asks for the wrong amount of work.
 * A permanent surplus is not a lesser fault than a shortfall: it commits the rotation to overtime
 * it never declared. Read the note at the check before adding a tolerance — an equality over whole
 * duties is sometimes unsatisfiable, and that is the rule working, not a bug.
 */

import { DAYS, ROTATING_LINES, MIN_REST_MINUTES, CONTRACTED_HOURS_PER_WEEK,
         startMinutes, endMinutesAbs, dayClass, restBetween } from './links-design.js';

/**
 * Auto-generate the rotating link (lines 1..lines) from per-shift staffing targets.
 *
 * The real roster staffs the day in WAVES — opens around 06:20, a morning
 * build 07:00–08:30, middles 11:00–12:00, afternoons 13:30–14:30, closes
 * 15:00+ running to midnight — so the generator takes a list of shift slots,
 * each with its own time and per-day-class headcount, rather than a single
 * "early" and "late".
 *
 * TWO CONSTRUCTIONS, and the DEFAULT changed at v19.59. `generateLink` tries the
 * settled-week construction first and falls back to the original rotating window
 * only when the targets cannot be met that way. Which one ran is REPORTED, never
 * silent — the two produce visibly different designs.
 *
 * ── 1. SETTLED WEEKS (default, v19.59) ─────────────────────────────────────
 * Measured against the real roster, the old construction was giving people a week
 * nobody at Marylebone has ever worked. Within-week start spread averaged 7h58 and
 * EVERY line exceeded 4h; the real main roster averages 3h44 with 7 of 16 above 4h,
 * because it hands out WEEKS — week 2 is all lates, week 3 all earlies, week 9 all
 * 11:00 middles. FF19 (successive starts more than 2h apart) counted 6 on the real
 * roster and 29 on the generated one. The tool reports FF19, and its own generator
 * was the thing inflating it.
 *
 * So: group the slots into WAVES — start times within `WAVE_SPAN_MINUTES` of each
 * other, the same 2h threshold FF19 uses — give each wave a contiguous BLOCK of
 * lines sized by how much duty it carries, and slide a window inside each block to
 * decide who works which day. A line therefore stays in one wave all week: its exact
 * time can move between 06:20 and 07:15, never between 06:20 and 15:25.
 *
 * Waves rather than exact times, deliberately. Per-TIME blocks are infeasible here —
 * the roster seed produces 23 distinct times over 24 working lines, and several are
 * Saturday-only, so a block per time would need more lines than exist. Waves are also
 * what the real roster does: line 3 works 06:20-14:20 midweek and 06:20-14:00 on the
 * Saturday. Grouping by the FF19 threshold means the within-week movement this
 * construction still allows is, by definition, movement FF19 does not count.
 *
 * ── 2. ROTATING WINDOW (fallback) ──────────────────────────────────────────
 * Picture the lines around a wheel. Each day a window of consecutive lines is on duty
 * and slides forward a few lines, completing exactly one lap per week. Within the
 * window slots run latest-start at the front, earliest at the back.
 *
 * Its documented promise — "a person's week only moves later, never a late finish
 * then an early start" — was NOT TRUE and is now enforced rather than asserted
 * (v19.59). Positions are read mod `working`, so every line wraps from the front of
 * the order to the back exactly once a week; that wrap IS a late-finish-to-early-start
 * step, and it lands on a rest day only when the day's target leaves enough lines
 * resting. At high staffing it does not: with all three slots filling every line of
 * the then-28-line rotation the construction produced **27** short turnarounds, `15:15-23:55` into
 * `06:20-14:20` — 6h25 rest — and the test that "asserted" the promise used a fixture
 * staffing 13 of 24 lines, where the wrap always landed on RD.
 *
 * The strides are no longer near-equal. Each day's stride is capped at
 * `working − (next day's total)`, which is exactly the condition for every wrapping
 * line to be resting the following day, and the lap is distributed in proportion to
 * those caps. When the caps cannot sum to a full lap the targets leave less than one
 * rest day per line per week; the generator REFUSES rather than shipping the phantom
 * guarantee (`fail('no-rest')` in `generateLink`).
 *
 * Daily targets are met EXACTLY by both constructions (the window size equals the
 * target headcount for that day).
 *
 * SPARE IS A WHOLE WEEK, NOT A SCATTER OF DAYS (v19.58, owner). A spare line is
 * spare on all seven days: you are cover, you work four days of that week, and
 * you can be put on any range of shifts. The real roster is built this way —
 * main lines 1, 7, 12 and 17 are `SPARE` on every day, and there is not one
 * scattered spare day anywhere in it.
 *
 * The previous model took a per-day-class spare HEADCOUNT and fed it to the
 * window as one more segment. Because the window slides daily, that gave each
 * person spare on some days and a timed duty on others — the opposite of a
 * spare week, and a shape the roster has never had. Daily SP headcount came out
 * right, which is why it went unnoticed: the total was correct and the
 * distribution was wrong.
 *
 * So `spareLines` whole lines are reserved and spread evenly around the wheel,
 * and the rotation is built over the REMAINING lines. Daily targets are still
 * met exactly — the working lines carry them — and every day now shows exactly
 * `spareLines` on standby, as the real roster does.
 *
 * SUNDAY IS NOT CONTRACTED, and the generator does NOT model that (owner, Aug 2026). Sundays appear
 * on the roster as agreed RDW — overtime by agreement, not contracted hours — but here `sun` is
 * simply a third day class with its own headcount, exactly like `weekday` and `sat`. Nothing in this
 * module, `runDesignChecks` or `links-fatigue.js` treats a Sunday duty as voluntary.
 *
 * That is mostly harmless — the cover still has to be found, and for FATIGUE purposes an hour worked
 * is an hour worked however it is paid — but two readings do change:
 *   · the Sunday column is cover you HOPE to fill, not cover you can require, so a Sunday target the
 *     generator meets exactly is a plan rather than a commitment;
 *   · "weekends off" counts Sat-not-worked plus Sun-not-worked, and a Sunday you do not work is the
 *     DEFAULT. `links-adjacency.js` splits days-off from contracted-days-GIVEN for that reason.
 *
 * A SPARE WEEK'S FOUR DAYS COME FROM MON–SAT. The Sunday of a spare week stays RDW if the roster
 * clerk gives it, on top of the four; it is not one of them. All seven days are still marked SPARE,
 * which is what the real roster does and what "available for cover" means — but a reader should not
 * take the four out of seven.
 *
 * @param {Object} opts
 * @param {Array<{time:string, weekday:number, sat:number, sun:number}>} opts.slots
 *   - one entry per distinct shift time, with target headcounts per day class
 * @param {number} [opts.spareLines=0] - how many WHOLE lines are spare weeks
 * @param {number} [opts.lines=ROTATING_LINES]
 * @param {boolean} [opts.requireContract=true] - see `generateLink`; leave it alone outside the
 *   construction tests
 * @returns {Object|null} patterns for "1".."lines", or null if invalid / any day-class total
 *   exceeds the working lines / the targets cannot pay the contracted week
 */
export function generatePatterns(opts) {
    return generateLink(opts).patterns;
}

/** Slots whose starts sit within this span are one WAVE — the same threshold FF19 uses, so the
 *  movement a settled week still allows is by definition movement FF19 does not count. */
export const WAVE_SPAN_MINUTES = 2 * 60;

const TARGET_CLASSES = ['weekday', 'sat', 'sun'];
/** How many days of the week carry each day class — the weight a class has in a week's duty total. */
const CLASS_DAYS = /** @type {Record<string, number>} */ ({ weekday: 5, sat: 1, sun: 1 });

/**
 * The ex-Sunday duty a TARGET TABLE asks for, in minutes per week of rotation.
 *
 * Sunday counts are read and deliberately discarded: Sunday is not contracted, so a Sunday duty
 * sits on TOP of the contracted week and can never help a design reach it. Folding it in would let
 * a link that pays people short look compliant by rostering more Sundays — which is the same
 * flattering error `weeklyHours` excludes Sundays to avoid, arriving from the targets instead of
 * from the patterns.
 *
 * Minutes, not hours, because the comparison it feeds is an equality: `working x 35h` is a whole
 * number of minutes, every duty is a whole number of minutes, and rounding to hours first is how
 * "exactly 35" becomes "about 35".
 * @param {Array<Record<string, any>>} slots
 * @returns {number|null} null when a slot carries a time that cannot be read
 */
export function targetExSundayMinutes(slots) {
    let total = 0;
    for (const s of slots || []) {
        const a = startMinutes(s.time), b = endMinutesAbs(s.time);
        if (a === null || b === null) return null;
        total += (b - a) * (CLASS_DAYS.weekday * (s.weekday ?? 0) + CLASS_DAYS.sat * (s.sat ?? 0));
    }
    return total;
}

/**
 * Group slots into waves: each wave holds every slot starting within `span` of its earliest.
 * Pure and deterministic; slots are read in start-time order, so the wave list is stable.
 * @param {Array<{time:string, weekday:number, sat:number, sun:number}>} slots
 * @param {number} [span]
 * @returns {Array<Array<any>>}
 */
export function groupIntoWaves(slots, span = WAVE_SPAN_MINUTES) {
    const sorted = [...(slots || [])]
        .filter(s => s && startMinutes(s.time) !== null)
        .sort((a, b) => /** @type {number} */ (startMinutes(a.time)) - /** @type {number} */ (startMinutes(b.time)));
    /** @type {Array<Array<any>>} */
    const waves = [];
    for (const s of sorted) {
        const cur = waves[waves.length - 1];
        const from = cur ? /** @type {number} */ (startMinutes(cur[0].time)) : 0;
        if (cur && /** @type {number} */ (startMinutes(s.time)) - from <= span) cur.push(s);
        else waves.push([s]);
    }
    return waves;
}

/** Total headcount a group of slots needs on one day class. */
const classTotal = (/** @type {Array<any>} */ group, /** @type {string} */ cls) =>
    group.reduce((a, s) => a + (s[cls] ?? 0), 0);

/** Duties a group of slots generates in a week — the size of the block it has to be given. */
const waveDuty = (/** @type {Array<any>} */ group) =>
    TARGET_CLASSES.reduce((a, c) => a + CLASS_DAYS[c] * classTotal(group, c), 0);

/** The widest a wave has to be to hold its busiest day — the floor on its block. */
const waveNeed = (/** @type {Array<any>} */ group) =>
    Math.max(...TARGET_CLASSES.map(c => classTotal(group, c)));

/**
 * Merge away any wave too small to fund the lines it needs, into whichever neighbour is closer in
 * time. Returns a new wave list; deterministic, and it always terminates because each pass removes
 * one wave.
 *
 * WHY (measured, v19.59). Splitting purely on the 2h span left the roster seed with a wave holding
 * only the two 08:30 weekend slots — 2 duties, but a floor of 1 line, so one whole line existed to
 * work Saturday and Sunday and nothing else. Days worked per line came out 2 to 6 where the real
 * roster runs 3 to 6 clustered at 5, and the old rotating construction — whose single global window
 * shares the work across every line — was FAIRER. A shape improvement paid for with an unfair link
 * is not an improvement.
 *
 * The real roster solves it the same way: line 3 works 06:20-14:20 midweek and 06:20-14:00 on the
 * Saturday, so its weekend duty comes from its own wave rather than from a weekend-only line.
 *
 * Merging widens a wave past the FF19 threshold (06:20…08:30 is 2h10), so the movement inside it can
 * be a factor the panel counts. That is the right way round: the panel reports it, and a link where
 * somebody works two days a week is the worse answer with nothing to report it at all.
 * @param {Array<Array<any>>} waves
 * @param {number} working
 */
function mergeUnfundedWaves(waves, working) {
    let cur = waves.map(w => w.slice());
    for (let guard = 0; cur.length > 1 && guard < waves.length; guard++) {
        const total = cur.reduce((a, w) => a + waveDuty(w), 0);
        if (!total) break;
        const short = cur.findIndex(w => working * waveDuty(w) / total < waveNeed(w));
        if (short < 0) break;
        // Nearest neighbour by the gap between the two waves' adjoining start times.
        const gapBefore = short > 0
            ? /** @type {number} */ (startMinutes(cur[short][0].time)) - /** @type {number} */ (startMinutes(cur[short - 1][cur[short - 1].length - 1].time))
            : Infinity;
        const gapAfter = short < cur.length - 1
            ? /** @type {number} */ (startMinutes(cur[short + 1][0].time)) - /** @type {number} */ (startMinutes(cur[short][cur[short].length - 1].time))
            : Infinity;
        const into = gapBefore <= gapAfter ? short - 1 : short + 1;
        const merged = into < short ? [...cur[into], ...cur[short]] : [...cur[short], ...cur[into]];
        cur = cur.filter((_, i) => i !== short && i !== into);
        cur.splice(Math.min(into, short), 0, merged);
    }
    return cur;
}

/**
 * Share the working lines out between the waves, in proportion to the duty each carries.
 *
 * Two constraints, and the second is the one that decides feasibility: a wave's block can never be
 * smaller than its busiest day, or the window would have to be wider than the block it slides in.
 * Largest-remainder for the proportional part, then deficient waves are raised to that floor and the
 * surplus taken back from whoever has the most slack — deterministic at every step.
 * @param {Array<Array<any>>} waves
 * @param {number} working
 * @returns {number[]|null} lines per wave, or null when the floors cannot fit
 */
function allocateWaveLines(waves, working) {
    const need = waves.map(waveNeed);
    const duties = waves.map(waveDuty);
    const totalDuty = duties.reduce((a, b) => a + b, 0);
    if (totalDuty === 0) return null;

    const raw = duties.map(d => working * d / totalDuty);
    const out = raw.map(Math.floor);
    let left = working - out.reduce((a, b) => a + b, 0);
    const byRemainder = raw
        .map((v, i) => ({ frac: v - Math.floor(v), i }))
        .sort((a, b) => b.frac - a.frac || a.i - b.i);
    for (let k = 0; left > 0; k++, left--) out[byRemainder[k % byRemainder.length].i]++;

    for (let i = 0; i < out.length; i++) if (out[i] < need[i]) out[i] = need[i];
    let over = out.reduce((a, b) => a + b, 0) - working;
    while (over > 0) {
        let best = -1, slack = 0;
        for (let i = 0; i < out.length; i++) {
            const s = out[i] - need[i];
            if (s > slack) { slack = s; best = i; }
        }
        if (best < 0) return null;          // every wave is already at its floor — infeasible
        out[best]--; over--;
    }
    return out.some(n => n <= 0) ? null : out;
}

/**
 * Window starts for a block of `n` lines: strides sum to `n`, one lap per week, and the movement is
 * spread ACROSS the seven days rather than front-loaded into the first few.
 *
 * The obvious `base + (i < rem)` form is wrong for a small block and quietly unfair (v19.59). With
 * n = 3 it gives strides [1,1,1,0,0,0,0], so the window laps in three days and then sits still from
 * Wednesday to Saturday — the same lines work all four of those days and one line catches almost
 * nothing. Measured on the roster seed it produced a line working TWO days a week.
 *
 * `floor((i+1)·n/7) − floor(i·n/7)` distributes the same total evenly (n = 3 → [0,0,1,0,1,0,1]),
 * which shares the work out exactly: all three lines get four days instead of 6/4/2.
 */
function evenStarts(/** @type {number} */ n) {
    /** @type {number[]} */ const starts = [];
    for (let i = 0; i < 7; i++) starts.push(Math.floor(i * n / 7));
    return starts;
}

/**
 * Window starts for the ROTATING fallback, capped so a wrapping line is always resting the next day.
 *
 * A line's position is read mod `working`, so every line wraps from the front of the slot order
 * (latest) to the back (earliest) exactly once a week. That wrap is a late-finish-to-early-start
 * step unless the following day's window has already closed behind it, which is exactly
 * `stride ≤ working − nextTotal`. Distributed in proportion to those caps.
 *
 * Returns null when the caps cannot fund a full lap — the targets then leave under one rest day per
 * line per week, and no phasing can avoid the step. Refusing beats shipping the old promise.
 * @param {number} working
 * @param {number[]} totals - duties on each day, in DAYS order
 * @returns {number[]|null}
 */
function cappedStarts(working, totals) {
    const cap = totals.map((_, i) => Math.max(0, working - totals[(i + 1) % 7]));
    const capSum = cap.reduce((a, b) => a + b, 0);
    if (capSum < working) return null;

    const raw = cap.map(c => working * c / capSum);
    const stride = raw.map(Math.floor);
    let left = working - stride.reduce((a, b) => a + b, 0);
    const byRemainder = raw
        .map((v, i) => ({ frac: v - Math.floor(v), i }))
        .sort((a, b) => b.frac - a.frac || a.i - b.i);
    // Only ever hand a spare unit to a day still under its cap; capSum ≥ working guarantees one exists.
    for (let guard = 0; left > 0 && guard < 7 * working; guard++) {
        const { i } = byRemainder[guard % 7];
        if (stride[i] < cap[i]) { stride[i]++; left--; }
    }
    if (left > 0) return null;

    /** @type {number[]} */ const starts = [];
    let acc = 0;
    for (let i = 0; i < 7; i++) { starts.push(acc); acc += stride[i]; }
    return starts;
}

/**
 * THE WAVES ARE DEALT IN CONTIGUOUS BLOCKS, AND INTERLEAVING THEM HERE WAS TRIED AND REVERTED
 * (v19.60). Read this before "fixing" it again.
 *
 * Laying the waves out contiguously means every morning line, then every middles line, then every
 * afternoon line — and since you move one line a week, that is **11 consecutive weeks of mornings
 * followed by 11 of afternoons** (owner: "a bit excessive and would be unpopular"; the live roster's
 * longest run on much the same shift is 3). The obvious fix is to deal them interleaved, and it does
 * take the raw output from 11 to 2.
 *
 * It is still the wrong place to fix it, measured both ways on the real roster seed:
 *
 *                          raw block   raw short turnarounds   with every switch on
 *   interleaved here            2               2              block 3 · 95min · 8 weekends · 5 long
 *   contiguous (kept)          11               0              block 3 · 95min · 8 weekends · 7 long
 *
 * Alternating waves puts a late wave's 23:55 Saturday next to a morning wave's 06:20 Sunday — a 6h25
 * turnaround the construction had been free of. And it constrains the reorder into a WORSE local
 * optimum: two fewer long weekends for no gain, because both routes reach a longest block of 3
 * anyway.
 *
 * The order of the lines belongs to ONE place — `links-adjacency.js` — and its `variety` objective,
 * on by default, is what keeps the blocks short. That objective has to exist regardless, because
 * `gentle` pulls the other way and would otherwise re-block whatever the generator handed it.
 */

/** Which rows are spare weeks — spread evenly around the wheel so no one gets two cover weeks
 *  back to back. (The real roster's 1/7/12/17 of 20 is roughly, not exactly, even.) */
function spareRowSet(/** @type {number} */ spareLines, /** @type {number} */ lines) {
    const rows = new Set();
    for (let i = 0; i < spareLines; i++) rows.add(Math.round((i * lines) / spareLines) + 1);
    return rows;
}

/**
 * Walk the `lines` rows, filling spare weeks with SPARE and handing every other row to `dayValue`,
 * which is given the row's index within the working rotation.
 * @param {number} lines
 * @param {Set<any>} spareRows
 * @param {(wIndex:number, dayIndex:number, day:string) => string} dayValue
 */
function layOutRows(lines, spareRows, dayValue) {
    /** @type {Record<string, any>} */
    const patterns = {};
    let wIndex = 0;
    for (let row = 1; row <= lines; row++) {
        /** @type {Record<string, any>} */
        const p = {};
        if (spareRows.has(row)) {
            for (const d of DAYS) p[d] = 'SPARE';
            patterns[String(row)] = p;
            continue;
        }
        DAYS.forEach((d, i) => { p[d] = dayValue(wIndex, i, d); });
        patterns[String(row)] = p;
        wIndex++;
    }
    return patterns;
}

/** Pick the slot a position lands on, walking `group` in order against that day class's targets. */
function slotAt(/** @type {Array<any>} */ group, /** @type {string} */ cls, /** @type {number} */ pos) {
    let cum = 0;
    for (const seg of group) {
        const n = seg[cls] ?? 0;
        if (pos < cum + n) return seg.time;
        cum += n;
    }
    return 'RD';
}

/**
 * Repair every turnaround shorter than the minimum rest, by SWAPPING TWO LINES' DUTIES ON ONE DAY.
 *
 * ── WHY A SWAP, AND WHY WITHIN A SINGLE DAY COLUMN (v21.11) ────────────────────────────────────
 *
 * Owner, Aug 2026: "It keeps offering me a gap of 11 hours 45 minutes between a shift. That would
 * never be allowed by Chiltern." It was right — the generated default put a Sunday 09:05–18:35 in
 * front of a Monday 06:20 open, 11h45 apart against a 12-hour minimum — and the app only REPORTED
 * it, in the Design checks, after building it. A minimum rest period is not an observation about a
 * design; it is a condition of one being legal, which is the same class of statement as the
 * contract, and the contract is refused rather than reported.
 *
 * The construction cannot easily be taught the rule: it is a sliding window whose stride arithmetic
 * decides feasibility, and adding a per-cell constraint to it risks making ordinary tables
 * unbuildable for reasons no message could explain. So the repair runs AFTER, and it is a swap
 * because a swap is the one edit that **changes nothing anybody asked for**. Exchanging two lines'
 * duties in the same day column leaves that day's headcount on every shift time exactly as it was,
 * so the targets, the contract, the coverage heat map and the demand fit are all untouched by
 * construction rather than by re-checking. Only WHO works WHICH duty moves.
 *
 * ── WHAT IT WILL AND WILL NOT TRADE ────────────────────────────────────────────────────────────
 *
 * Timed↔timed swaps are tried first: they leave both lines' days-worked unchanged, so nothing moves
 * but the two shift times. Only if none fixes the breach does it try timed↔rest, which moves a duty
 * between two lines and shifts each one's week by a day. The rotation's AVERAGE days worked is
 * unchanged either way — the duty still exists — but an individual line's is not, which is why it
 * is the second choice and not the first.
 *
 * SPARE lines are never touched. A spare week is a whole week (v19.58); swapping a duty into one
 * would silently turn a cover week into a working week with six spare days, which is a different
 * thing wearing the same word.
 *
 * A swap is only accepted when it breaks nothing else: all four adjacencies it can affect — either
 * side of both moved cells — must come out at or above the minimum. Otherwise the repair would
 * "fix" a breach by walking it to another line, which reads as success and is not.
 *
 * @param {Record<string, any>} patterns  MUTATED in place — the caller owns a fresh object
 * @param {number} lines
 * @param {number} [minRest]
 * @returns {{repaired: number, remaining: Array<{line:number, day:string, rest:number}>}}
 */
export function repairShortRest(patterns, lines = ROTATING_LINES, minRest = MIN_REST_MINUTES) {
    const at = (/** @type {number} */ w, /** @type {string} */ d) => patterns[String(w)]?.[d] ?? 'RD';
    const set = (/** @type {number} */ w, /** @type {string} */ d, /** @type {string} */ v) => {
        if (patterns[String(w)]) patterns[String(w)][d] = v;
    };
    /** A whole-week cover line — never a candidate, in either direction. */
    const isSpareLine = (/** @type {number} */ w) => DAYS.every(d => at(w, d) === 'SPARE');
    /** The cell BEFORE (w, d) in the rotation: the previous day, wrapping to the previous line. */
    const prevOf = (/** @type {number} */ w, /** @type {string} */ d) => {
        const i = DAYS.indexOf(d);
        return i > 0 ? { w, d: DAYS[i - 1] } : { w: ((w - 2 + lines) % lines) + 1, d: DAYS[6] };
    };
    const nextOf = (/** @type {number} */ w, /** @type {string} */ d) => {
        const i = DAYS.indexOf(d);
        return i < 6 ? { w, d: DAYS[i + 1] } : { w: (w % lines) + 1, d: DAYS[0] };
    };
    /** Is the rest either side of this cell acceptable? */
    const okAround = (/** @type {number} */ w, /** @type {string} */ d) => {
        const p = prevOf(w, d), n = nextOf(w, d);
        const before = restBetween(at(p.w, p.d), at(w, d));
        const after  = restBetween(at(w, d), at(n.w, n.d));
        return (before === null || before >= minRest) && (after === null || after >= minRest);
    };

    const breaches = () => {
        const out = [];
        for (let w = 1; w <= lines; w++) {
            for (const d of DAYS) {
                const n = nextOf(w, d);
                const rest = restBetween(at(w, d), at(n.w, n.d));
                if (rest !== null && rest < minRest) out.push({ line: n.w, day: n.d, rest });
            }
        }
        return out;
    };

    let repaired = 0;
    // Bounded by the cell count: each pass either fixes one breach or stops. A swap can in
    // principle re-open an earlier one, so the loop re-measures from scratch rather than walking a
    // stale list — and the guard is what makes "cannot repair" a decision instead of a hang.
    for (let guard = 0; guard < lines * DAYS.length; guard++) {
        const bad = breaches();
        if (!bad.length) break;
        let done = false;
        // Either duty of the pair can move: the LATER first, as before; the EARLIER only if no swap of it works (Nov 2026).
        for (const { w, d } of [{ w: bad[0].line, d: bad[0].day }, prevOf(bad[0].line, bad[0].day)]) {
            if (done || isSpareLine(w)) continue;         // cannot move a cover week's day
            const mine = at(w, d);
            // Timed partners first (both lines keep their days-worked), then rest days.
            for (const wantTimed of [true, false]) {
                for (let u = 1; u <= lines && !done; u++) {
                    if (u === w || isSpareLine(u)) continue;
                    const theirs = at(u, d);
                    if (theirs === mine) continue;
                    const theirsTimed = startMinutes(theirs) !== null;
                    if (theirsTimed !== wantTimed) continue;
                    set(w, d, theirs); set(u, d, mine);
                    if (okAround(w, d) && okAround(u, d)) { done = true; repaired++; }
                    else { set(w, d, mine); set(u, d, theirs); }
                }
                if (done) break;
            }
        }
        if (!done) break;                             // no swap fixes it — the caller refuses
    }
    return { repaired, remaining: breaches() };
}

/**
 * Generate a link, reporting WHICH construction produced it.
 *
 * `generatePatterns` is the thin wrapper that returns only the patterns; it keeps the older
 * signature, which the construction tests are written against — the page itself calls this one,
 * because the mode matters — the two constructions give visibly different designs, and a designer who
 * is not told which they got cannot account for the difference.
 *
 * @param {Object} opts
 * @param {Array<{time:string, weekday:number, sat:number, sun:number}>} opts.slots
 * @param {number} [opts.spareLines=0]
 * @param {number} [opts.lines=ROTATING_LINES]
 * @param {boolean} [opts.settled=true]
 * @param {boolean} [opts.requireContract=true] refuse targets that do not pay the contracted week EXACTLY - false forces the rotating fallback (for comparison)
 * @param {boolean} [opts.requireRest=true] refuse a design that cannot give everyone the minimum rest between turns. The SAME kind of opt-out as `requireContract` and for the same callers: construction fixtures describe a rotation SHAPE, and several deliberately staff every line every day, which no arrangement can rest. Never passed by the app - `links-contract.test.mjs` fails if it ever is.
 * @returns {{patterns: Object|null, mode: 'settled'|'rotating'|null, waves: number,
 *            reason: string|null, askedMinutes?: number, needMinutes?: number, working?: number,
 *            shortRest?: number, shortRestCount?: number}}
 *   The extra fields accompany a REFUSAL and nothing else. `askedMinutes`/`needMinutes`/`working`
 *   belong to `short-hours` and `over-hours`, `shortRest`/`shortRestCount` to `short-rest`. They are
 *   the whole actionable content of those refusals — a caller told merely that the targets are wrong
 *   cannot say by how much, and the gap is the only number a designer can do anything with.
 */
export function generateLink({ slots, spareLines = 0, lines = ROTATING_LINES, settled = true,
                               requireContract = true, requireRest = true }) {
    const fail = (/** @type {string} */ reason) => ({ patterns: null, mode: null, waves: 0, reason });

    if (!Array.isArray(slots) || slots.length === 0) return fail('no-slots');
    if (!Number.isInteger(spareLines) || spareLines < 0 || spareLines >= lines) return fail('bad-spare-lines');

    const working = lines - spareLines;
    /** @type {Record<string, number>} */
    const totalFor = {};
    for (const cls of TARGET_CLASSES) {
        let total = 0;
        for (const s of /** @type {Array<Record<string, any>>} */ (slots)) {
            const n = s[cls] ?? 0;
            if (!Number.isInteger(n) || n < 0) return fail('bad-target');
            if (startMinutes(s.time) === null) return fail('bad-time');
            total += n;
        }
        // The spare lines cannot carry a timed duty, so the targets have to fit
        // in what is left. Checked against `working`, not `lines`.
        if (total > working) return fail('over-capacity');
        totalFor[cls] = total;
    }

    // ── THE CONTRACT IS A CONSTRAINT ON THE TARGETS, NOT A REPORT ON THE RESULT (v20.98) ────────
    //
    // Owner, Aug 2026: a generated link must average exactly the contracted week ex-Sunday, and one
    // that falls short must not be produced at all.
    //
    // It is checked HERE, against the targets, rather than against the finished patterns — and the
    // difference is not tidiness. The arithmetic is settled before a single cell is laid out: the
    // duty a target table asks for is fixed, the working lines are fixed, and every construction
    // places exactly those duties on exactly those lines. So no arrangement can rescue a short
    // table, and a check on the output would be re-measuring an answer already determined by the
    // input — reporting a build failure for what is really a decision about how much work there is.
    //
    // BOTH DIRECTIONS (v20.99, owner). v20.98 refused only a short table, on the reasoning that a
    // surplus is workable — it gets paid as overtime or absorbed by adding lines. That was the wrong
    // reading of the instruction. The rule is not a floor, it is an equality: a link IS the
    // contracted week, and a design carrying a permanent surplus is a design that has quietly
    // committed the rotation to overtime it never declared. Both refusals therefore say the same
    // thing in opposite directions, which is why they share their arithmetic and their fields and
    // differ only in the verb the caller uses.
    //
    // ⚠️ AN EQUALITY OVER WHOLE DUTIES IS NOT ALWAYS SATISFIABLE, and that is not a defect to
    // tolerance away. `working x 35h` is a fixed number of minutes; a target table can only move in
    // steps of one duty, so a set of shift times whose lengths do not combine to that total has NO
    // valid table — the generator will refuse everything until a duty is lengthened, shortened or a
    // cover week is added or removed. The refusal names the gap in both directions precisely so the
    // designer can see which of those to reach for. A tolerance would hide the same problem behind a
    // design that is silently a few hours out, which is what v20.98 replaced.
    //
    // MINUTES, and an exact comparison. `working x 35h` is a whole number of minutes and every duty
    // is a whole number of minutes, so "exactly" can be meant literally; rounding to hours first is
    // how exactly-35 quietly becomes about-35.
    // ── THE OPT-OUT, AND WHY IT IS NOT A BACK DOOR ──────────────────────────────────────────────
    //
    // `requireContract` defaults ON, so every real call is gated: `links-app.js` never passes it,
    // and `links-contract.test.mjs` fails if it ever does. What passes `false` is the
    // CONSTRUCTION tests — wave containment, spare spread, turnarounds, fairness — whose fixtures
    // describe a rotation shape rather than a week's worth of work.
    //
    // Making those fixtures carry 35 hours was tried first and rejected: an exact-fit target set
    // exists, but adopting it would change which waves merge and how the load spreads, which are
    // the very things those tests assert. Altering a scenario to satisfy an unrelated rule leaves
    // the test green and no longer about what it says it is about.
    if (requireContract) {
        const askedMin = targetExSundayMinutes(/** @type {any} */ (slots));
        if (askedMin === null) return fail('bad-time');
        const needMin = working * CONTRACTED_HOURS_PER_WEEK * 60;
        if (askedMin !== needMin) {
            const reason = askedMin < needMin ? 'short-hours' : 'over-hours';
            return { ...fail(reason), askedMinutes: askedMin, needMinutes: needMin, working };
        }
    }

    const spareRows = spareRowSet(spareLines, lines);
    // A slot nobody works on any day is dropped before grouping — it would otherwise claim a wave,
    // and a wave with no duty has no lines to give it.
    const used = slots.filter(s => TARGET_CLASSES.reduce((a, c) => a + (/** @type {any} */ (s)[c] ?? 0), 0) > 0);
    const waves = mergeUnfundedWaves(groupIntoWaves(used), working);

    if (settled && waves.length) {
        const alloc = allocateWaveLines(waves, working);
        if (alloc) {
            // Each wave owns a contiguous block of the working rotation, and slides its own window
            // inside it. A line therefore never leaves its wave, which is what makes the week settled.
            /** @type {Array<{group:Array<any>, n:number, starts:number[]}>} */
            const plans = waves.map((w, i) => ({ group: w, n: alloc[i], starts: evenStarts(alloc[i]) }));
            /** @type {Array<[number, number]>} */
            const owner = [];
            plans.forEach((plan, wi) => { for (let k = 0; k < plan.n; k++) owner.push([wi, k]); });

            const patterns = layOutRows(lines, spareRows, (wIndex, i, d) => {
                const [wi, idx] = owner[wIndex];
                const plan = plans[wi];
                const pos = ((idx - plan.starts[i]) % plan.n + plan.n) % plan.n;
                return slotAt(plan.group, dayClass(d), pos);
            });
            return _restChecked(patterns, 'settled', waves.length, lines, requireRest);
        }
    }

    // Fallback: the original rotating window, with the rest-feasible stride caps.
    const totals = DAYS.map(d => totalFor[dayClass(d)]);
    const starts = cappedStarts(working, totals);
    if (!starts) return fail('no-rest');

    // Front-to-back window order: latest start first, earliest last, so a person's position moves
    // front-ward through their week and their shifts progress earliest → latest.
    const sorted = [.../** @type {Array<Record<string, any>>} */ (slots)]
        .sort((a, b) => /** @type {number} */ (startMinutes(b.time)) - /** @type {number} */ (startMinutes(a.time)));

    const patterns = layOutRows(lines, spareRows, (wIndex, i, d) => {
        const pos = ((wIndex - starts[i]) % working + working) % working;
        return slotAt(sorted, dayClass(d), pos);
    });
    return _restChecked(patterns, 'rotating', waves.length, lines, requireRest);
}

/**
 * The last gate before a design leaves the generator: no turnaround under the minimum rest.
 *
 * It REPAIRS first and refuses only if it cannot (v21.11). The refusal names the shortest remaining
 * gap because that is the whole actionable content — a designer told merely that the rest is wrong
 * cannot see which pair of times to move, and the fix is always a shift time rather than anything
 * about the rotation.
 *
 * @param {Record<string, any>} patterns @param {'settled'|'rotating'} mode
 * @param {number} waves @param {number} lines @param {boolean} requireRest
 */
function _restChecked(patterns, mode, waves, lines, requireRest) {
    // The REPAIR runs either way — a shape fixture is no reason to hand back a turnaround that could
    // have been swapped out. Only the REFUSAL is opt-out-able.
    const { remaining } = repairShortRest(patterns, lines);
    if (requireRest && remaining.length) {
        const worst = remaining.reduce((a, b) => (b.rest < a.rest ? b : a));
        return {
            patterns: null, mode: null, waves: 0, reason: 'short-rest',
            shortRest: worst.rest, shortRestCount: remaining.length,
        };
    }
    return { patterns, mode, waves, reason: null };
}

