// @ts-check
/**
 * links-default-targets.js — the target table the generator starts from when a design has none.
 *
 * ── WHY THIS EXISTS, AND WHY IT IS NOT `links-seed.js` ─────────────────────────────────────────
 *
 * `links-seed.js` MEASURES: it reads the roster people actually work and reports it. That is the
 * right answer to "what do we do today", and the wrong thing to start a December 2026 proposal from
 * — today's duties pay fewer working lines than the new link has, and the generator refuses the
 * resulting table outright. This module DESIGNS: a starting table that pays the contract exactly,
 * so Generate works on a card nobody has touched. Both are one button apart on the card, because
 * a proposal wants both: measure today, design tomorrow.
 *
 * ── 26 LINES (v24.47): THE TABLE IS NOW THE SHORTLIST'S, NOT THE APP'S ────────────────────────
 *
 * From 1 Oct 2026 the December link is 26 lines with FIVE cover weeks (owner), so 21 working lines
 * and a contract of 21 × 35h = 44,100 Monday-to-Saturday minutes. The rules every 26-line design is
 * judged against are `docs/links-26/RULES.md`, set by the owner — and this table is not invented
 * here any more. It is the duty table of **Second Edition (SE-26-F1)**, one of the three designs the
 * owner shortlisted on 3 Oct 2026; Even Keel and Short Run run the same day totals. A default that
 * the owner's own shortlist already satisfies is a better starting point than a fourth table the app
 * designed by itself, which is what the 24-line default was (v21.00–v21.13).
 *
 *     Mon–Fri   15 duties   7,440 min/day  ×5 = 37,200
 *     Saturday  14 duties                       6,900
 *                                              -------
 *                                               44,100 min = 21 working lines × 35h EXACTLY
 *     89 duties a week → (89 + 4 × 5) ÷ 26 × 365 ÷ 7 = 218.6 contracted days a year (ceiling 219)
 *
 * What it meets, from RULES.md: at least four on at the open and three at the close every day;
 * at least five still on at 22:00; ten on a Sunday, every Sunday duty 8–9 hours; the ticket office's
 * two identical early and late pairs; fifteen shift times (the cap is eighteen); fourteen on a
 * Saturday; every weekday closer starting 15:45. `links-default-targets.test.mjs` pins each one.
 *
 * The 24-line table is GONE, not kept for reference (owner, 3 Oct 2026: "we can delete any 24 line
 * specific code"). A device that remembered it keeps that memory — it is no longer recognised as an
 * old default — and the generator refuses it with the hours gap named; one tap on "Use the
 * recommended Dec 2026 staffing" replaces it.
 *
 * ── WHAT THIS IS NOT ───────────────────────────────────────────────────────────────────────────
 *
 * It is not a link. The generator arranges this table its own way, which is not how Second Edition
 * arranged it — Second Edition itself is a built-in proposal (`links-proposals.js`). The panels
 * below the grid assess what the generator makes of it; read them before anyone takes a printout
 * into a room.
 */

/**
 * How many whole lines are cover weeks. The third term in the contract equation above — not a
 * preference, and not independently adjustable without retuning the duty table with it.
 */
export const DEFAULT_COVER_WEEKS = 5;

/** At least this many on at the open, every day the station opens (RULES.md S1). */
export const OPENING_TURNS = 4;

/** At least this many through to the close, every day (RULES.md S2). */
export const CLOSING_TURNS = 3;

/**
 * At least this many still on duty at 22:00, every day (RULES.md S3). Someone finishing AT 22:00
 * does not count.
 */
export const EVENING_TURNS_FROM_22 = 5;

/** Through to the close on a Saturday. Second Edition runs three, which is the S2 minimum. */
export const SATURDAY_CLOSING_TURNS = 3;

/** People working a Saturday. Owner's figure (RULES.md F1). */
export const SATURDAY_TURNS = 14;

/** People working a Sunday. Owner's figure (RULES.md S4). Outside the contracted measure. */
export const SUNDAY_TURNS = 10;

/** Mean days a week a working line is on duty Mon–Sat: 89 duties over 21 working lines. */
export const TARGET_DAYS_PER_WEEK = 89 / 21;

/**
 * The table itself — Second Edition's duties, one row per time, counts per day class. Read across:
 * the weekday's 15, Saturday's 14, Sunday's 10. The ticket office is the two 06:20-14:20 and two
 * 14:00-22:30 on a weekday (06:20-14:50 / 14:30-22:00 on a Saturday; 07:15 starts and 22:30
 * finishes on a Sunday).
 *
 * @type {ReadonlyArray<Readonly<{time: string, weekday: number, sat: number, sun: number}>>}
 */
const TABLE = Object.freeze([
    Object.freeze({ time: '06:20-14:00', weekday: 0, sat: 3, sun: 0 }),
    Object.freeze({ time: '06:20-14:20', weekday: 2, sat: 0, sun: 0 }),
    Object.freeze({ time: '06:20-14:50', weekday: 3, sat: 2, sun: 0 }),
    Object.freeze({ time: '07:00-16:00', weekday: 2, sat: 0, sun: 0 }),
    Object.freeze({ time: '07:15-15:45', weekday: 0, sat: 0, sun: 4 }),
    Object.freeze({ time: '08:00-16:30', weekday: 0, sat: 2, sun: 0 }),
    Object.freeze({ time: '09:00-18:00', weekday: 0, sat: 0, sun: 1 }),
    Object.freeze({ time: '12:00-20:00', weekday: 1, sat: 0, sun: 0 }),
    Object.freeze({ time: '14:00-22:30', weekday: 2, sat: 2, sun: 0 }),
    Object.freeze({ time: '14:30-22:00', weekday: 0, sat: 2, sun: 0 }),
    Object.freeze({ time: '14:30-22:30', weekday: 0, sat: 0, sun: 2 }),
    Object.freeze({ time: '15:00-22:30', weekday: 2, sat: 0, sun: 0 }),
    Object.freeze({ time: '15:15-23:25', weekday: 0, sat: 0, sun: 3 }),
    Object.freeze({ time: '15:15-23:55', weekday: 0, sat: 3, sun: 0 }),
    Object.freeze({ time: '15:45-23:55', weekday: 3, sat: 0, sun: 0 }),
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
