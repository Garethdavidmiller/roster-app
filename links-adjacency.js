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
 */
import { DAYS, startMinutes, endMinutesAbs } from './links-design.js';

/** The four things the order can be tuned for. Order matters — it is the display order too. */
export const OBJECTIVES = Object.freeze([
    { key: 'gentle',       label: 'Gentle week-to-week change' },
    { key: 'weekends',     label: 'Full weekends off' },
    { key: 'longWeekends', label: 'Long weekends' },
    { key: 'turnarounds',  label: 'Rest across the week boundary' },
]);

/** Minutes a start time may move between weeks before it counts as a real change. */
export const GENTLE_THRESHOLD_MINUTES = 2 * 60;

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
 * Score one ordering of the lines. Returns every figure regardless of what was optimised for, so
 * the cost of an objective is always visible beside its benefit.
 *
 * @param {Record<string, any>} patterns
 * @param {string[]} order - line keys, in rotation order
 * @param {{minRestMinutes?: number}} [opts]
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

    const abs = steps.map(Math.abs);
    return {
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
 */
export function cost(s, on, longWeekendTarget = 4) {
    let c = 0;
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
 * Reorder the lines to suit the objectives that are switched on.
 *
 * DETERMINISTIC — no randomness anywhere. The same design and the same switches always give the same
 * order, so a designer can re-run it and get their design back rather than a different one, and two
 * designers comparing notes are comparing the same thing.
 *
 * A greedy nearest-neighbour pass followed by repeated pair swaps (a bounded 2-opt). Exact ordering
 * is a travelling-salesman problem over 28 nodes; this is not optimal and does not pretend to be —
 * it is a large improvement on an arbitrary order, which is what the designs actually start from.
 *
 * @param {Record<string, any>} patterns
 * @param {object} [opts]
 * @param {Record<string, boolean>} [opts.on] - which objectives are enabled
 * @param {number} [opts.longWeekendTarget]
 * @param {number} [opts.passes] - improvement sweeps
 * @returns {{order: string[], before: ReturnType<typeof scoreOrder>, after: ReturnType<typeof scoreOrder>, changed: boolean}}
 */
export function reorderLines(patterns, { on = {}, longWeekendTarget = 4, passes = 6 } = {}) {
    const keys = Object.keys(patterns || {}).sort((a, b) => Number(a) - Number(b));
    const before = scoreOrder(patterns, keys);
    const anyOn = OBJECTIVES.some(o => on[o.key]);
    // Everything off means leave it alone. Re-sorting by an empty objective set would hand back a
    // different design for no stated reason, which is worse than doing nothing.
    if (!anyOn || keys.length < 3) return { order: keys, before, after: before, changed: false };

    const scoreOf = (/** @type {string[]} */ ord) => cost(scoreOrder(patterns, ord), on, longWeekendTarget);

    // Greedy: keep the first line where it is and repeatedly take whichever remaining line makes the
    // best next step. Starting from line 1 rather than the best possible start keeps it stable.
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

    // Bounded 2-opt: swap pairs while it helps. Fixed sweep count, so runtime is predictable.
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

    const after = scoreOrder(patterns, order);
    return { order, before, after, changed: order.some((k, i) => k !== keys[i]) };
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
