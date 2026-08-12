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
 * ── THE TIMES ARE OPTIMISED AGAINST THE DEMAND CURVE, UNDER HARD RULES (v21.06) ───────────────
 *
 * Two owner reports drove this. First, the day's biggest headcount sat on one of its quietest
 * hours. Second — and this is what the earlier fix caused — SEVEN weekday turns finished between
 * 23:20 and 23:55, which is three real closers plus four in all but name, against an instruction
 * of three.
 *
 * So the times are no longer hand-placed. They are searched, on a five-minute grid, minimising the
 * squared distance between each hour's COVER and its share of the day's DEMAND, subject to rules
 * that are not negotiable:
 *
 *   · exactly 4 on at the open, every day, and no shadow-opener starting minutes after them
 *   · exactly 3 through to the close (4 on a Saturday), and NOTHING ELSE finishing after 22:45
 *     (22:15 on a Sunday) — the rule that keeps "three close" from meaning seven
 *   · every duty 7h to 9h30, on the grid, inside its own day's window
 *   · two people either start together or a quarter of an hour apart — likewise for finishes
 *   · the day's totals unchanged: 7,000 minutes Mon–Fri and Saturday alike, so the contract,
 *     the 4.2 days and the cover-week count all stay exactly where they were
 *
 * Demand is counted INSIDE the window, which matters at the edges: hour 06 is forty minutes long
 * on a Mon–Sat, and charging it a full hour of movements made the open look permanently starved.
 *
 * ── WHY THE RESULT IS STILL FAIRLY FLAT, AND WHY THAT IS NOT THE SEARCH GIVING UP ──────────────
 *
 * Weekday demand is twin-peaked — 08:00–09:00 and 17:00–18:00 — about NINE HOURS apart, which is
 * one duty length. A genuinely two-humped cover curve would need the morning turns to end before
 * the afternoon ones begin, and 14 duties averaging 8h20 cannot do that inside a 17h35 window
 * without leaving a hole in the middle of the afternoon: two blocks of 500 minutes span 1,000 of
 * the 1,055 minutes the station is open. So the achievable range is roughly 6 to 8 people, and the
 * search spends it where it buys most — the 16:00–18:00 shoulder and the peaks — while thinning
 * the 11:00–14:00 slack it used to over-staff. The lever for the peaks themselves is more duties
 * in the day, not a different arrangement of these ones.
 *
 * ── THE SATURDAY LEAN IS A WEIGHT ON THE EVENING, NOT A RULE ABOUT START TIMES ─────────────────
 *
 * v21.01–v21.05 expressed "slight preference to late for events" as *more turns starting after
 * 11:00*. That proxy fought the timetable: Saturday's measured peak is 10:00–11:00, and satisfying
 * the start count dropped the busiest hour of the day to six people. Event crowds are not in the
 * timetable at all — the same trains run fuller — so the honest expression is a WEIGHT: the
 * search values Saturday's 17:00–22:00 at 1.25x its demand share. Measured on the result, that
 * band carries 36.9% of Saturday's cover against 34.7% of its demand, while the weekday's carries
 * 35.9% against 36.7%. Saturday leans to the evening; a weekday does not. That is the assertion
 * the test makes, because it is the claim that is actually true.
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
    // ── Mon–Fri: four on at the open, staggered finishes
    Object.freeze({ time: '06:20-13:25', weekday: 1, sat: 0, sun: 0 }),
    Object.freeze({ time: '06:20-14:20', weekday: 1, sat: 0, sun: 0 }),
    Object.freeze({ time: '06:20-14:35', weekday: 1, sat: 0, sun: 0 }),
    Object.freeze({ time: '06:20-14:50', weekday: 1, sat: 0, sun: 0 }),
    // ── Mon–Fri morning middles — into the 08:00–09:00 peak
    Object.freeze({ time: '07:00-15:05', weekday: 1, sat: 0, sun: 0 }),
    Object.freeze({ time: '07:00-16:25', weekday: 1, sat: 0, sun: 0 }),
    Object.freeze({ time: '08:20-17:50', weekday: 1, sat: 0, sun: 0 }),
    // ── Mon–Fri afternoon middles — across the heavier evening peak, all off by 22:45
    Object.freeze({ time: '13:35-22:45', weekday: 1, sat: 0, sun: 0 }),
    Object.freeze({ time: '14:30-22:45', weekday: 1, sat: 0, sun: 0 }),
    Object.freeze({ time: '14:50-22:45', weekday: 1, sat: 0, sun: 0 }),
    Object.freeze({ time: '15:05-22:45', weekday: 1, sat: 0, sun: 0 }),
    // ── Mon–Fri closers — THREE, and nothing else finishes near them
    Object.freeze({ time: '14:50-23:55', weekday: 1, sat: 0, sun: 0 }),
    Object.freeze({ time: '15:55-23:55', weekday: 1, sat: 0, sun: 0 }),
    Object.freeze({ time: '16:10-23:55', weekday: 1, sat: 0, sun: 0 }),
    // ── Saturday: four on at the open
    Object.freeze({ time: '06:20-13:20', weekday: 0, sat: 1, sun: 0 }),
    Object.freeze({ time: '06:20-13:35', weekday: 0, sat: 1, sun: 0 }),
    Object.freeze({ time: '06:20-15:00', weekday: 0, sat: 1, sun: 0 }),
    Object.freeze({ time: '06:20-15:40', weekday: 0, sat: 1, sun: 0 }),
    // ── Saturday morning middles — the 10:00–11:00 peak is the day's busiest
    Object.freeze({ time: '07:00-14:00', weekday: 0, sat: 1, sun: 0 }),
    Object.freeze({ time: '08:15-17:45', weekday: 0, sat: 1, sun: 0 }),
    Object.freeze({ time: '08:30-18:00', weekday: 0, sat: 1, sun: 0 }),
    // ── Saturday afternoon middles, all off by 22:45
    Object.freeze({ time: '13:40-22:45', weekday: 0, sat: 1, sun: 0 }),
    Object.freeze({ time: '14:00-22:45', weekday: 0, sat: 1, sun: 0 }),
    Object.freeze({ time: '14:55-22:45', weekday: 0, sat: 1, sun: 0 }),
    // ── Saturday closers — FOUR, the events lean carried to the close-down
    Object.freeze({ time: '14:25-23:55', weekday: 0, sat: 1, sun: 0 }),
    Object.freeze({ time: '15:40-23:55', weekday: 0, sat: 1, sun: 0 }),
    Object.freeze({ time: '16:05-23:55', weekday: 0, sat: 1, sun: 0 }),
    Object.freeze({ time: '16:45-23:55', weekday: 0, sat: 1, sun: 0 }),
    // ── Sunday — its own window (07:15–23:25): four open, three middles, three close
    Object.freeze({ time: '07:15-14:20', weekday: 0, sat: 0, sun: 1 }),
    Object.freeze({ time: '07:15-14:40', weekday: 0, sat: 0, sun: 1 }),
    Object.freeze({ time: '07:15-15:30', weekday: 0, sat: 0, sun: 1 }),
    Object.freeze({ time: '07:15-15:50', weekday: 0, sat: 0, sun: 1 }),
    Object.freeze({ time: '09:20-18:20', weekday: 0, sat: 0, sun: 1 }),
    Object.freeze({ time: '14:55-22:15', weekday: 0, sat: 0, sun: 1 }),
    Object.freeze({ time: '15:10-22:15', weekday: 0, sat: 0, sun: 1 }),
    Object.freeze({ time: '14:30-23:25', weekday: 0, sat: 0, sun: 1 }),
    Object.freeze({ time: '15:50-23:25', weekday: 0, sat: 0, sun: 1 }),
    Object.freeze({ time: '16:20-23:25', weekday: 0, sat: 0, sun: 1 }),
]);

/** Every distinct shift time this table proposes, in the order it lists them. */
export const DEFAULT_SHIFT_TIMES = Object.freeze(TABLE.map(s => s.time));

/**
 * Are two target tables the SAME table? Order-insensitive on rows (compared by time), exact on
 * counts and cover weeks — a table is a set of claims about the week, not a sequence.
 *
 * @param {{ slots: Array<{time: string, weekday: number, sat: number, sun: number}>, spareLines: number }|null} a
 * @param {{ slots: Array<{time: string, weekday: number, sat: number, sun: number}>, spareLines: number }|null} b
 */
export function sameTargetTable(a, b) {
    if (!a || !b || a.spareLines !== b.spareLines || a.slots.length !== b.slots.length) return false;
    const key = (/** @type {any} */ s) => `${s.time}|${s.weekday}|${s.sat}|${s.sun}`;
    const as = a.slots.map(key).sort(), bs = b.slots.map(key).sort();
    return as.every((k, i) => k === bs[i]);
}

/**
 * Should a REMEMBERED table be superseded by the current default?
 *
 * The generator remembers each device's working table (v19.38) and prefers the memory over the
 * default forever — which is right for a table somebody tuned, and wrong for one the app stored on
 * its own: from v19.38 to v21.00 the default WAS the roster seed, so every device that ever opened
 * the workspace remembered the seed untouched, and when the designed default replaced it at v21.00
 * those devices never saw it. The owner met exactly that — a card reading 29h 53m against a default
 * that pays 35h 00m — and reasonably read the stale memory as the new table being wrong (v21.05).
 *
 * "Never customised" is decided by CONTENT, deterministically: a memory that equals the roster
 * seed is the old auto-stored default; one that equals the current default carries no information.
 * Anything else is somebody's work and is kept — this must never discard a table a designer edited,
 * which is why it compares whole tables rather than guessing from timestamps.
 *
 * The seed is passed IN (`buildRosterTargets()` at the call site) rather than imported, so this
 * module keeps importing nothing and stays a leaf.
 *
 * @param {{ slots: Array<{time: string, weekday: number, sat: number, sun: number}>, spareLines: number }} remembered
 * @param {{ slots: Array<{time: string, weekday: number, sat: number, sun: number}>, spareLines: number }} rosterSeed
 */
export function isSupersededMemory(remembered, rosterSeed) {
    return sameTargetTable(remembered, rosterSeed) || sameTargetTable(remembered, buildDefaultTargets());
}

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
