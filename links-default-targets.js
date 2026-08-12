// @ts-check
/**
 * links-default-targets.js — the target table the generator starts from when a design has none.
 *
 * ── WHY THIS EXISTS, AND WHY IT IS NOT `links-seed.js` ─────────────────────────────────────────
 *
 * `links-seed.js` MEASURES: it reads the roster people actually work and reports it. That is the
 * right answer to "what do we do today", and it was the wrong thing to start a December 2026
 * proposal from — those duties pay 16 working lines, the new rotation has 19, and the generator
 * refuses the resulting table outright. A designer opening the workspace met a refusal before they
 * had typed anything.
 *
 * This module DESIGNS. It is a proposed shift table built against the December 2026 service in
 * `links-demand.js` and the operating window in `links-window.js`, and it is a starting point to
 * argue with — not a recommendation, not a measurement of anything, and emphatically not a link.
 * Both are reachable from the card, which is the point: measure today, design tomorrow.
 *
 * ── THE OWNER'S FIGURES (Aug 2026), AND WHERE EACH ONE LANDED ──────────────────────────────────
 *
 * Cover the demand · four turns opening and three closing, every day · **four cover weeks** ·
 * roughly 4.2 days a week worked Mon–Sat, averaging exactly the contracted week · **14 working on
 * a Saturday**, with a slight preference to LATE turns for events · **10 working on a Sunday**.
 *
 * The Saturday and Sunday headcounts are decisions, not derivations — an event Saturday needs
 * hands regardless of what the train count says — and everything else then follows from three
 * constraints meeting: the contract is exact, Saturday is fixed at 14, and four cover weeks leave
 * 20 working lines. So the weekday count is the derived one, and at these figures NOTHING rounds:
 *
 *     (5 x weekday + 14) / 20  =  4.2   →   weekday = 14, exactly
 *
 *     Mon–Fri   14 duties   7,000 min/day  x5 = 35,000
 *     Saturday  14 duties   7,000 min           7,000
 *                                             -------
 *                                              42,000 min = 20 working lines x 35h EXACTLY
 *     84 duties over 20 working lines = 4.2 days a week EXACTLY, mean turn 8h20 EXACTLY
 *
 * A weekday and the Saturday carry the SAME total minutes — 7,000 each — which is what keeps the
 * split of the 42,000 legible (five-and-one equal days). The cover-week count is therefore not a
 * preference — it is the third term in the equation. Change it alone and the table no longer pays
 * the contract; `generateLink` will say so, in minutes, in both directions.
 *
 * ── HOW THE WEEKDAY MEETS ITS TWO PEAKS ────────────────────────────────────────────────────────
 *
 * Weekday demand is twin-peaked — 08:00–09:00 (127 cars) and 17:00–18:00 (140) — and the peaks
 * are about nine hours apart, one duty length, so no turn can be at both. The fourteen turns split
 * 3 morning / 4 afternoon middles around the openers and closers (the evening peak is the heavier
 * one), and both peaks land at ~19–20 cars per person against ~10 in the midday trough. A flatter
 * answer does not exist at this headcount; the lever for the peaks is more duties in the day, not
 * a different arrangement of these ones.
 *
 * ── SATURDAY LEANS LATE, ON PURPOSE ────────────────────────────────────────────────────────────
 *
 * Eight of the fourteen Saturday turns start at 11:00 or later against six earlies — the owner's
 * "slight preference to late for events". Measured against the timetable that puts the richest
 * cover at 13:00–19:00 (~8–9 cars per person, against ~15–17 in the morning), which is where an
 * event afternoon actually bites. The morning is not starved to do it: four turns still open the
 * station and the 08:00–10:00 hours hold ~16.
 *
 * ── SUNDAY IS DESIGNED NOW, NOT CARRIED ────────────────────────────────────────────────────────
 *
 * Until v21.01 the Sunday column was the live roster's, copied unchanged, because nothing had been
 * asked of it. The owner has now asked: **ten on a Sunday** (the roster works eight). Sunday gets
 * the same shape as the other days — four on at the 07:15 open, three through to the 23:25 close,
 * three middles spread across a demand curve that is nearly flat from 09:00 to 23:00. Sunday is
 * not contracted for any grade here, so none of this touches the 35h measure; the ex-Sunday
 * arithmetic above is unchanged by it. The five December 2026 movements after the 23:25 close
 * remain OUTSIDE the window — that is the standing Sunday boundary question `links-demand.js`
 * keeps visible, and adding people inside the window does not answer it.
 *
 * ── WHAT THIS IS NOT ───────────────────────────────────────────────────────────────────────────
 *
 * It is not a proposal. Nothing here has been through a roster office, a rep, or anyone who has
 * worked a gateline at 17:00 on a Friday. It covers the service and pays the contract, which is
 * the floor for being worth discussing, not evidence of being right. The panels below the grid —
 * hard limits, fatigue factors, the heat map — assess what the generator makes of it, and they are
 * the things to read before anyone takes a printout into a room.
 */

/**
 * How many whole lines are cover weeks. The third term in the contract equation above — not a
 * preference, and not independently adjustable without retuning the duty table with it.
 */
export const DEFAULT_COVER_WEEKS = 4;

/** Turns on at the open, every day the station opens. Owner's figure. */
export const OPENING_TURNS = 4;

/** Turns through to the close, every day. Owner's figure. */
export const CLOSING_TURNS = 3;

/** People working a Saturday. Owner's figure — an events decision, not a derivation. */
export const SATURDAY_TURNS = 14;

/** People working a Sunday. Owner's figure. Outside the contracted measure entirely. */
export const SUNDAY_TURNS = 10;

/**
 * The mean days a week a working line is on duty Mon–Sat. Owner's figure ("roughly"), and with
 * Saturday fixed at 14 it is what derives the weekday count of 13 — the true mean is 79/19 ≈ 4.16.
 */
export const TARGET_DAYS_PER_WEEK = 4.2;

/**
 * The table itself.
 *
 * Read each day class in three blocks. **Openers** all start at the window open and are staggered
 * by their FINISH, because a link where four people walk off at the same minute hands the
 * afternoon a cliff rather than a handover. **Middles** roll through the day. **Closers** all
 * finish at the window close and stagger by their start, for the same reason in reverse.
 *
 * A row with a zero in a column is a duty that day does not have — a Saturday turn is genuinely
 * shorter than a weekday's and a Sunday runs to a different window, which is why most rows serve
 * one day class. Where two days do share a time they share the row, which is what keeps this to a
 * readable length.
 *
 * @type {ReadonlyArray<Readonly<{time: string, weekday: number, sat: number, sun: number}>>}
 */
const TABLE = Object.freeze([
    // ── Mon–Sat openers — the same four turns both days, staggered finishes
    Object.freeze({ time: '06:20-14:20', weekday: 1, sat: 1, sun: 0 }),
    Object.freeze({ time: '06:20-14:40', weekday: 1, sat: 1, sun: 0 }),
    Object.freeze({ time: '06:20-15:00', weekday: 1, sat: 1, sun: 0 }),
    Object.freeze({ time: '06:20-15:20', weekday: 1, sat: 1, sun: 0 }),
    // ── Weekday middles — three into the morning peak, four across the heavier evening one
    Object.freeze({ time: '07:00-15:20', weekday: 1, sat: 0, sun: 0 }),
    Object.freeze({ time: '07:45-16:05', weekday: 1, sat: 0, sun: 0 }),
    Object.freeze({ time: '08:30-16:50', weekday: 1, sat: 0, sun: 0 }),
    Object.freeze({ time: '12:50-21:10', weekday: 1, sat: 0, sun: 0 }),
    Object.freeze({ time: '13:40-21:40', weekday: 1, sat: 0, sun: 0 }),
    Object.freeze({ time: '14:20-22:40', weekday: 1, sat: 0, sun: 0 }),
    Object.freeze({ time: '15:00-23:00', weekday: 1, sat: 0, sun: 0 }),
    // ── Saturday middles — seven, leaning late for events (five of them start 12:00 or after)
    Object.freeze({ time: '08:40-16:40', weekday: 0, sat: 1, sun: 0 }),
    Object.freeze({ time: '10:00-18:20', weekday: 0, sat: 1, sun: 0 }),
    Object.freeze({ time: '12:00-20:20', weekday: 0, sat: 1, sun: 0 }),
    Object.freeze({ time: '13:00-21:20', weekday: 0, sat: 1, sun: 0 }),
    Object.freeze({ time: '14:00-22:20', weekday: 0, sat: 1, sun: 0 }),
    Object.freeze({ time: '14:40-22:40', weekday: 0, sat: 1, sun: 0 }),
    Object.freeze({ time: '15:00-23:20', weekday: 0, sat: 1, sun: 0 }),
    // ── Mon–Sat closers — the same three turns both days, staggered starts, through to 23:55
    Object.freeze({ time: '15:15-23:55', weekday: 1, sat: 1, sun: 0 }),
    Object.freeze({ time: '15:35-23:55', weekday: 1, sat: 1, sun: 0 }),
    Object.freeze({ time: '15:55-23:55', weekday: 1, sat: 1, sun: 0 }),
    // ── Sunday — its own window (07:15–23:25): four openers, three middles, three closers
    Object.freeze({ time: '07:15-14:45', weekday: 0, sat: 0, sun: 1 }),
    Object.freeze({ time: '07:15-15:00', weekday: 0, sat: 0, sun: 1 }),
    Object.freeze({ time: '07:15-15:15', weekday: 0, sat: 0, sun: 1 }),
    Object.freeze({ time: '07:15-15:35', weekday: 0, sat: 0, sun: 1 }),
    Object.freeze({ time: '10:00-18:00', weekday: 0, sat: 0, sun: 1 }),
    Object.freeze({ time: '12:45-20:45', weekday: 0, sat: 0, sun: 1 }),
    Object.freeze({ time: '14:30-22:30', weekday: 0, sat: 0, sun: 1 }),
    Object.freeze({ time: '15:25-23:25', weekday: 0, sat: 0, sun: 1 }),
    Object.freeze({ time: '15:45-23:25', weekday: 0, sat: 0, sun: 1 }),
    Object.freeze({ time: '16:05-23:25', weekday: 0, sat: 0, sun: 1 }),
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
