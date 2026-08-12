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
 * Cover the demand · four turns opening every day · three closing — **four on a Saturday** ·
 * **four cover weeks** ·
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
 * ── THE HANDOVER LANDS ON THE TROUGH — AS THE DAY'S THINNEST HOURS, NOT ITS PEAK (v21.02) ─────
 *
 * The v21.01 table had the day's BIGGEST headcount at 14:00 (8.7 on duty for 79 cars) while 22:00
 * ran 4.7 people for 75 — the owner spotted it the day it shipped. The cause was the handover: the
 * afternoon turns started 12:50–15:00, overlapping the openers (who leave 14:20–15:20) for two
 * hours, and the overlap bulge parked itself on the quietest stretch of the day.
 *
 * The person-minutes in a day are fixed by the contract, so the only question is WHERE the
 * above-average hours sit — and the answer has to respect that every duty is one contiguous
 * 7–9h30 block. Weekday demand is twin-peaked (08:00–09:00 at 127 cars, 17:00–18:00 at 140),
 * the peaks are one duty length apart, so no turn spans both and the day genuinely is two shifts
 * with a changeover between them. What CAN be chosen is how wide the changeover is. So the
 * morning middles are now 7h30 turns that leave at 14:30–15:45, the entire afternoon shift
 * arrives in the 14:35–15:55 band, and the afternoon turns run long — to 23:20–23:50 — so the
 * evening is full to the close. Measured: 14:00–15:00 are the day's LEAST staffed working hours
 * (6.3 on, ~13 cars per person — matching the trough), both peaks hold 7 (~20 cars per person),
 * and 22:00 carries 7 where it carried 4.7. The lever for the peaks themselves is still more
 * duties in the day, not a different arrangement of these ones.
 *
 * Saturday gets the same correction with its lean kept: the late middles start 13:50–14:50, so
 * the rich zone is 14:00–22:00 — the events window — rather than pooling at lunchtime, and the
 * 13:00 hour drops back to ~6 on. Its FOURTH closer (v21.03, owner) is the same lean carried to
 * the end of the day: the extra turn runs 16:15–23:55, taking the close-down hour from ~3.7 on
 * to ~4.8 on the one day the evening is the point. Sunday's openers shorten to 7h–8h so its own
 * handover no longer bulges at 14:00 either.
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

/** Turns through to the close on a weekday and a Sunday. Owner's figure: "we only need 3". */
export const CLOSING_TURNS = 3;

/**
 * Turns through to the close on a SATURDAY. Owner's figure, part of the events lean: the fourth
 * closer is an extra evening body on the one day the evening is the point.
 */
export const SATURDAY_CLOSING_TURNS = 4;

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
    // ── Weekday morning middles — 7h30 turns, off at 14:30–15:45 so the trough is not double-staffed
    Object.freeze({ time: '07:00-14:30', weekday: 1, sat: 0, sun: 0 }),
    Object.freeze({ time: '07:30-15:00', weekday: 1, sat: 0, sun: 0 }),
    Object.freeze({ time: '08:15-15:45', weekday: 1, sat: 0, sun: 0 }),
    // ── Weekday afternoon middles — on 14:35–15:00, long turns holding the evening to 23:50
    Object.freeze({ time: '14:35-23:20', weekday: 1, sat: 0, sun: 0 }),
    Object.freeze({ time: '14:45-23:30', weekday: 1, sat: 0, sun: 0 }),
    Object.freeze({ time: '14:55-23:45', weekday: 1, sat: 0, sun: 0 }),
    Object.freeze({ time: '15:00-23:50', weekday: 1, sat: 0, sun: 0 }),
    // ── Saturday middles — two mornings, four lates starting 13:50–14:50 into the events evening
    Object.freeze({ time: '08:40-16:10', weekday: 0, sat: 1, sun: 0 }),
    Object.freeze({ time: '10:00-17:30', weekday: 0, sat: 1, sun: 0 }),
    Object.freeze({ time: '13:50-22:20', weekday: 0, sat: 1, sun: 0 }),
    Object.freeze({ time: '14:10-22:50', weekday: 0, sat: 1, sun: 0 }),
    Object.freeze({ time: '14:30-23:20', weekday: 0, sat: 1, sun: 0 }),
    Object.freeze({ time: '14:50-23:50', weekday: 0, sat: 1, sun: 0 }),
    // ── Closers — three turns Mon–Sat through to 23:55, plus Saturday's fourth (the events lean
    //    carried to the close-down; weekdays and Sundays need only three)
    Object.freeze({ time: '15:15-23:55', weekday: 1, sat: 1, sun: 0 }),
    Object.freeze({ time: '15:35-23:55', weekday: 1, sat: 1, sun: 0 }),
    Object.freeze({ time: '15:55-23:55', weekday: 1, sat: 1, sun: 0 }),
    Object.freeze({ time: '16:15-23:55', weekday: 0, sat: 1, sun: 0 }),
    // ── Sunday — its own window (07:15–23:25): four short openers, three middles, three closers
    Object.freeze({ time: '07:15-14:15', weekday: 0, sat: 0, sun: 1 }),
    Object.freeze({ time: '07:15-14:35', weekday: 0, sat: 0, sun: 1 }),
    Object.freeze({ time: '07:15-14:55', weekday: 0, sat: 0, sun: 1 }),
    Object.freeze({ time: '07:15-15:15', weekday: 0, sat: 0, sun: 1 }),
    Object.freeze({ time: '10:15-18:15', weekday: 0, sat: 0, sun: 1 }),
    Object.freeze({ time: '13:45-21:45', weekday: 0, sat: 0, sun: 1 }),
    Object.freeze({ time: '15:05-23:05', weekday: 0, sat: 0, sun: 1 }),
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
