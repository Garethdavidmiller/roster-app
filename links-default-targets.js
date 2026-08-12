// @ts-check
/**
 * links-default-targets.js — the target table the generator starts from when a design has none.
 *
 * ── WHY THIS EXISTS, AND WHY IT IS NOT `links-seed.js` ─────────────────────────────────────────
 *
 * `links-seed.js` MEASURES: it reads the roster people actually work and reports it. That is the
 * right answer to "what do we do today", and it was the wrong thing to start a December 2026
 * proposal from — those duties pay 16 working lines, the new rotation has 19, and since v20.98 the
 * generator refuses the resulting table outright. A designer opening the workspace met a refusal
 * before they had typed anything.
 *
 * This module DESIGNS. It is a proposed shift table built against the December 2026 service in
 * `links-demand.js` and the operating window in `links-window.js`, and it is a starting point to
 * argue with — not a recommendation, not a measurement of anything, and emphatically not a link.
 * Both are reachable from the card, which is the point: measure today, design tomorrow.
 *
 * ── THE FOUR THINGS THE OWNER ASKED FOR, AND WHERE EACH ONE LANDED ─────────────────────────────
 *
 * Owner, Aug 2026: cover the demand, exactly the contracted week Mon–Sat, four turns opening and
 * three closing, and roughly 4.2 days a week worked.
 *
 * The last two are the same statement seen twice, which is what makes the table solvable at all:
 * 35h over 4.2 days is a mean duty of 8h20. So the shape is fixed before a single time is chosen,
 * and the only freedom left is WHERE in the day those duties sit.
 *
 * The arithmetic, written out so an edit can keep it true:
 *
 *     Mon–Fri   14 duties   7,040 min/day  x5 = 35,200
 *     Saturday  10 duties   4,700 min           4,700
 *                                             -------
 *                                              39,900 min = 19 working lines x 35h EXACTLY
 *     80 duties over 19 working lines = 4.21 days a week
 *
 * `19 working lines` is 24 minus five cover weeks, and the cover-week count is therefore not a
 * preference — it is the third term in the equation. Change it and the table no longer pays the
 * contract; `generateLink` will say so, in minutes, in both directions.
 *
 * **The Saturday-to-weekday ratio was not chosen either.** Ten Saturday duties against fourteen
 * weekday ones is 0.71, and Saturday carries 1,266 cars against a weekday's 1,756 — a ratio of
 * 0.72. That the headcount lands on the service almost exactly is the one part of this table that
 * arrived rather than being decided, and it is worth not undoing by rounding Saturday up.
 *
 * ── WHY THE COVER IS BROADLY FLAT, WHICH LOOKS LIKE A FAILURE AND IS NOT ───────────────────────
 *
 * Weekday demand is twin-peaked — 08:00–09:00 (127 cars) and 17:00–18:00 (140) — and the obvious
 * expectation is a design that peaks with it. It cannot, and the reason is arithmetic rather than
 * effort: **the two peaks are about nine hours apart, which is one duty length.** No single turn
 * can be at both. Staffing each peak to its own level would need roughly nine people twice over,
 * and there are fourteen duties in the day, so the two demands are not merely hard to satisfy
 * together, they are more than the day contains.
 *
 * What the table does instead is hold cover flat at seven through the working day and let the load
 * per person rise at the peaks: measured, 20.0 cars per person at 17:00 against 10.7 at the midday
 * trough. That was not settled by taste. A search over start times, minimising the worst hour,
 * returns the same flat profile — it simply reaches it by stacking three starts on 07:00 and three
 * on 15:00, which is not a link anybody would work. The starts here are staggered at twenty- and
 * thirty-minute intervals and come within 0.3 of the optimiser's worst hour.
 *
 * ── SUNDAY IS CARRIED, NOT DESIGNED ────────────────────────────────────────────────────────────
 *
 * The Sunday rows are the live roster's, unchanged. Sunday is not contracted for any grade here, so
 * it is outside the 35h measure entirely and outside what was asked for — and zeroing it would have
 * been a change nobody requested with a loud consequence, since every Sunday hour would then render
 * as uncovered demand on the heat map. Carrying it forward keeps Sunday exactly as it is today,
 * which is the honest default for a column this table has nothing to say about.
 *
 * ── WHAT THIS IS NOT ───────────────────────────────────────────────────────────────────────────
 *
 * It is not a proposal. Nothing here has been through a roster office, a rep, or anyone who has
 * worked a gateline at 17:00 on a Friday. It covers the service and pays the contract, which is the
 * floor for being worth discussing, not evidence of being right. The panels below the grid — hard
 * limits, fatigue factors, the heat map — assess what the generator makes of it, and they are the
 * things to read before anyone takes a printout into a room.
 */

/**
 * How many whole lines are cover weeks. The third term in the contract equation above — not a
 * preference, and not independently adjustable without retuning the duty table with it.
 */
export const DEFAULT_COVER_WEEKS = 5;

/** Turns on at the open, every day the station opens. Owner's figure. */
export const OPENING_TURNS = 4;

/** Turns through to the close, every day. Owner's figure. */
export const CLOSING_TURNS = 3;

/**
 * The mean days a week a working line is on duty Mon–Sat. Owner's figure, and the one that fixes
 * the mean duty length at 35h / this.
 */
export const TARGET_DAYS_PER_WEEK = 4.2;

/**
 * The table itself.
 *
 * Read it in four blocks. **Openers** all start at 06:20 and are staggered by their FINISH, because
 * a link where four people walk off at the same minute hands the afternoon a cliff rather than a
 * handover. **Morning and afternoon middles** roll through at twenty- to thirty-minute intervals.
 * **Closers** all finish at 23:55 and stagger by their start, for the same reason in reverse.
 * **Sunday** is the live roster's own column, carried whole (see the header).
 *
 * A row with a zero in a column is a duty that day does not have — Saturday's turns are genuinely
 * shorter than a weekday's, which is why most rows serve one day class and not both. Where the two
 * days do share a time they share the row, which is what keeps this to a readable length.
 *
 * @type {ReadonlyArray<Readonly<{time: string, weekday: number, sat: number, sun: number}>>}
 */
const TABLE = Object.freeze([
    // ── Openers — four on at 06:20, staggered finishes
    Object.freeze({ time: '06:20-13:40', weekday: 0, sat: 1, sun: 0 }),
    Object.freeze({ time: '06:20-14:00', weekday: 0, sat: 1, sun: 0 }),
    Object.freeze({ time: '06:20-14:20', weekday: 1, sat: 1, sun: 0 }),
    Object.freeze({ time: '06:20-14:40', weekday: 1, sat: 1, sun: 0 }),
    Object.freeze({ time: '06:20-15:00', weekday: 1, sat: 0, sun: 0 }),
    Object.freeze({ time: '06:20-15:20', weekday: 1, sat: 0, sun: 0 }),
    // ── Morning middles — into the 08:00–09:00 peak and through the midday trough
    Object.freeze({ time: '07:00-15:20', weekday: 1, sat: 0, sun: 0 }),
    Object.freeze({ time: '07:30-15:50', weekday: 1, sat: 0, sun: 0 }),
    Object.freeze({ time: '08:00-15:20', weekday: 0, sat: 1, sun: 0 }),
    Object.freeze({ time: '08:00-16:20', weekday: 1, sat: 0, sun: 0 }),
    Object.freeze({ time: '08:50-16:10', weekday: 0, sat: 1, sun: 0 }),
    // ── Afternoon middles — on before the 17:00 peak, off across the evening
    Object.freeze({ time: '13:20-21:40', weekday: 1, sat: 0, sun: 0 }),
    Object.freeze({ time: '13:50-22:10', weekday: 1, sat: 0, sun: 0 }),
    Object.freeze({ time: '14:20-22:40', weekday: 1, sat: 0, sun: 0 }),
    Object.freeze({ time: '14:30-21:50', weekday: 0, sat: 1, sun: 0 }),
    Object.freeze({ time: '14:50-23:10', weekday: 1, sat: 0, sun: 0 }),
    // ── Closers — three through to 23:55, staggered starts
    Object.freeze({ time: '15:15-23:55', weekday: 1, sat: 1, sun: 0 }),
    Object.freeze({ time: '15:35-23:55', weekday: 1, sat: 1, sun: 0 }),
    Object.freeze({ time: '15:55-23:55', weekday: 1, sat: 1, sun: 0 }),
    // ── Sunday — the live roster's column, carried unchanged
    Object.freeze({ time: '07:15-15:45', weekday: 0, sat: 0, sun: 3 }),
    Object.freeze({ time: '08:30-16:30', weekday: 0, sat: 0, sun: 1 }),
    Object.freeze({ time: '13:00-21:00', weekday: 0, sat: 0, sun: 1 }),
    Object.freeze({ time: '14:30-23:25', weekday: 0, sat: 0, sun: 3 }),
]);

/** Every distinct shift time this table proposes, in the order it lists them. */
export const DEFAULT_SHIFT_TIMES = Object.freeze(TABLE.map(s => s.time));

/**
 * The default target table, as a FRESH mutable copy.
 *
 * A copy every time, and that is load-bearing rather than tidy: the generator card edits these
 * objects in place — a typed count assigns `slot.weekday`, the ✕ button splices the array — so
 * handing out the frozen table would make the first keystroke a silent no-op in production and a
 * thrown `TypeError` under strict mode. `buildRosterTargets` returns fresh objects for the same
 * reason, which is why the two are interchangeable at the call site.
 *
 * @returns {{ slots: Array<{time: string, weekday: number, sat: number, sun: number}>, spareLines: number }}
 */
export function buildDefaultTargets() {
    return {
        slots: TABLE.map(s => ({ time: s.time, weekday: s.weekday, sat: s.sat, sun: s.sun })),
        spareLines: DEFAULT_COVER_WEEKS,
    };
}
