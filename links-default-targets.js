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
 * ── THE TIMES ARE OPTIMISED AGAINST THE DEMAND CURVE, UNDER HARD RULES (v21.06, v21.10) ───────
 *
 * Owner reports drove this. First, the day's biggest headcount sat on one of its quietest hours.
 * Second, SEVEN weekday turns finished between 23:20 and 23:55 — three real closers plus four in
 * all but name, against an instruction of three. Third (v21.10): **late turns are unpopular** —
 * booked around with annual leave, phoned sick, refused as overtime — and seven people were still
 * on at 22:00 when five is enough.
 *
 * So the times are not hand-placed. They are searched, on a five-minute grid, minimising the
 * squared distance between each hour's COVER and its share of the day's DEMAND, subject to rules
 * that are not negotiable:
 *
 *   · exactly 4 on at the open, every day, and no shadow-opener starting minutes after them
 *   · exactly 3 through to the close (4 on a Saturday), and NOTHING ELSE finishing after 22:45 —
 *     the rule that keeps "three close" from meaning seven
 *   · exactly 5 on duty at 22:00, every day (`EVENING_TURNS_FROM_22`)
 *   · **one short early, then every late, then every other early** — see below
 *   · every duty 7h to 9h30, on the grid, inside its own day's window
 *   · two people either start together or a quarter of an hour apart — likewise for finishes
 *   · at most TWO people on any one turn in a day — a row with a count of four hands four people
 *     the same handover, which is the cliff rule again away from the edges of the day
 *   · the day's totals unchanged: 7,000 minutes Mon–Fri and Saturday alike, so the contract,
 *     the 4.2 days and the cover-week count all stay exactly where they were
 *
 * ── FEWER TIMES, BECAUSE A TABLE NOBODY CAN HOLD IS NOT A PROPOSAL (v21.12) ────────────────────
 *
 * Owner: *"is there any way to reduce the number of shift start/finish times so that it is easier
 * to understand, whilst keeping the rest of the principles we have established?"* — and then, on
 * being asked whether the weekend had to match the weekday: *"weekend shift times can be different
 * to weekday. It is just about reducing the number of times in each type."*
 *
 * So the reduction is per DAY CLASS, and it is a second objective rather than a relaxed first one.
 * Every rule above is still a hard gate; what changed is that among the tables satisfying them,
 * the search now prefers the one asking a reader to hold fewer clock times — allowing two people
 * on a turn, and nudging Saturday's times onto the weekday's wherever that costs nothing.
 *
 * Measured, v21.10 → v21.13:
 *
 *                       rows   Mon–Fri times   Sat times   Sun times
 *     before             33         21             20          14
 *     after              19         16             18          13
 *
 * **The cost is close to nothing, which is the part worth checking rather than trusting.** Held to
 * within 10% of the shipped demand fit as a hard bound, the search reached 19 rows, and the
 * WORST-STAFFED HOUR of each day — what anyone actually feels — moved by at most a tenth of a
 * person. The generated design came out BETTER on every quality measure the panels report: no hard
 * limit breached, the longest run of worked days down from 10 to 8, three fatigue factors present
 * instead of four, and a full weekend off for 6 lines in 24 rather than 5.
 *
 * ── NO :05 AND NO :10 — THE CLOCK A PERSON HAS TO REMEMBER (v21.13) ────────────────────────────
 *
 * Owner: *"ditch the odd start/finish times like 5 or 10 past the hour, unless they are opening or
 * closing. Ideally it would be at 00, 15, 30 or 45, but I realise that may not be possible."*
 *
 * Both halves are honoured, and the second one has a limit that is arithmetic rather than effort.
 * A duty's LENGTH modulo fifteen is decided by which end of it is pinned to the window, and the
 * window does not sit on a quarter:
 *
 *     opener  = gridFinish − 06:20   ≡ 10   (mod 15)
 *     closer  = 23:55 − gridStart    ≡ 10   (mod 15)
 *     middle  = grid − grid          ≡  0   (mod 15)
 *
 * So a day's total is ≡ 10 × (openers + closers). Mon–Fri has 4 + 3 = 7 of them, giving ≡ 10, and
 * 7,000 ≡ 10 — reachable. **Saturday has 4 + 4 = 8, giving ≡ 5 against the same 7,000 ≡ 10, and no
 * re-split of the contract fixes it**: 5W + S = 42,000 with W ≡ 10 and S ≡ 5 has no solution. A
 * fully quarter-hour Saturday would need a different closer count or a different station opening
 * time, and both are somebody else's decision.
 *
 * What that costs, measured rather than assumed: forcing the whole table onto the quarter hour
 * pushed it to 22–25 rows and a weekday worst hour of 2.74–3.24 people, against 2.63 here. So the
 * rule shipped is the owner's FIRM half — **no :05 and no :10 anywhere except the window's own
 * open and close** — with the quarter hour as a strong preference: **50 of the table's 54
 * start/finish instances land on :00, :15, :30 or :45**, and the three that do not are :20, :25
 * and :40, which are ordinary things to say out loud. Both halves are pinned by
 * `links-default-targets.test.mjs`, the second as a ceiling so a tidier table still passes.
 *
 * The two-row Saturday of v21.12 did not survive this, and the reason is worth keeping. Deriving
 * Saturday from the weekday by a single same-length swap — which is what made "Saturday is the
 * weekday with one late turned into a fourth closer" true — forced a duty distribution whose
 * generated design ran **15 consecutive worked days**, breaching a HARD limit. Every seed tried it
 * and every seed breached. A sentence that is easy to remember is not worth a design that cannot be
 * run, so Saturday is searched again and differs by two moves rather than one (below).
 *
 * ── A LATE IS SHORTER THAN AN EARLY. THAT IS THE POINT OF IT (v21.10) ──────────────────────────
 *
 * The lever the owner asked for against the popularity problem is length: a late turn should be
 * *slightly* shorter than most early starts, so that taking one buys something back. The rule is a
 * strict ordering rather than an average, because an average can be satisfied by one outlier while
 * most lates stay long:
 *
 *     ONE early, and only one, is shorter than EVERY late.
 *     EVERY OTHER early is longer than EVERY late.
 *
 * "Most (not all) early starts", exactly: the short early is the one open turn that finishes in the
 * early afternoon, and it is deliberately kept — an unbroken block of long earlies is its own
 * recruitment problem. The margin is deliberately small. On a weekday the longest late is 8h10 and
 * the shortest long early is 8h25: fifteen minutes, which is what "slightly" has to mean when the
 * day's minutes are fixed. Across the whole turn it comes to about an hour — a weekday late
 * averages 7h45 against an early's 8h55.
 *
 * The Sunday non-closer cap moved from 22:15 to 22:25 in the same pass, and that is arithmetic
 * rather than preference: with two turns required past 22:00 and finishes fifteen minutes apart, a
 * 22:15 cap leaves exactly one shape and it fits the curve badly. 22:25 is still a clear hour
 * before the 23:25 close — the bound the tests hold every day to — so "three close" still means
 * three, and the standing rule did not have to be weakened to fit the new one.
 *
 * Demand is counted INSIDE the window, which matters at the edges: hour 06 is forty minutes long
 * on a Mon–Sat, and charging it a full hour of movements made the open look permanently starved.
 *
 * ── WHY THE RESULT IS STILL FAIRLY FLAT, AND WHY THAT IS NOT THE SEARCH GIVING UP ──────────────
 *
 * ── WHAT THE NEW RULES COST, MEASURED (v21.10) ────────────────────────────────────────────────
 *
 * Taking two bodies out of the 22:00 band and ordering the durations both narrow the search, and
 * the demand fit is the thing that pays for it. Measured on the same objective: a weekday's fit
 * worsens from 34.8 to 38.1 (about 9%), Saturday's is unchanged at 10.2→10.3, and Sunday's goes
 * 10.6→16.5. That is the trade the owner asked for, stated rather than buried — a table that
 * covers the service slightly less evenly, in exchange for a late turn people will take.
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
 * search values Saturday's 17:00–22:00 at 1.25x its demand share. The claim that follows is a
 * COMPARISON, not a threshold: Saturday's evening takes a bigger share of its day's cover than of
 * its day's demand, and a weekday's takes a smaller one. Saturday leans to the evening; a weekday
 * does not.
 *
 * **The four percentages that used to sit in this paragraph are gone (v21.12), and how they went
 * is the lesson.** They were measured at v21.06, printed here, and left alone — so when v21.10
 * retuned the whole table they became wrong by more than two points while still reading as a
 * measurement, and nothing failed, because the test asserts the COMPARISON and prints the live
 * figures in its own failure message. A number in prose beside a rule is a second copy of that
 * rule which nothing checks; the rule is here, the numbers are in `links-default-targets.test.mjs`
 * where they are recomputed on every run.
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
 * How many are still on duty at 22:00 — every day (v21.10).
 *
 * Owner's figure: "5 are enough from 2200, you have seven." Seven is what v21.06 built, and on a
 * weekday it was four turns running to 22:45 plus the three closers. The closers were right; the
 * band beneath them was not.
 *
 * It is a SEPARATE figure from the closer count and has to stay one. Three close on a weekday and
 * four on a Saturday, so the same five at 22:00 means two non-closers on a weekday and one on a
 * Saturday — which is also what carries the Saturday events lean into the late evening without
 * adding a body to it.
 */
export const EVENING_TURNS_FROM_22 = 5;

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
 * Read it in THREE blocks (v21.13), and their sizes are the point: **eleven** turns Monday to
 * Saturday alike, then **Saturday's own two**, then **Sunday's six**. Saturday's block IS the whole
 * of its difference from a weekday, one row per move. Inside each block: **openers** start at their
 * own day's window open and stagger by their FINISH, because a link where four people walk off at
 * the same minute hands the afternoon a cliff rather than a handover; **middles** roll through the
 * day, and there are only two morning arrival times in the entire table; **closers** all finish at
 * the window close and stagger by their start, for the same reason in reverse.
 *
 * **Saturday is the weekday, moved in exactly two ways** (v21.13; it was one until the clock-time
 * rule made that unrunnable — see above), and its two own rows are those two moves. Its morning
 * body arrives LATER, at 08:30 instead of 07:15, because Saturday's measured peak is 10:00–11:00
 * where a weekday's is 08:00–09:00; and one late is spent on a FOURTH CLOSER, which is the events
 * lean in structural form. Two bodies move, one of them onto the close. Everything else about the
 * two days is the same eleven rows.
 *
 * A row with a zero in a column is a duty that day does not have. Two people may share a row (the
 * count says how many) but no more than two: three or four on one time is a block of people with
 * the same handover, which is the cliff rule again in the middle of the day.
 *
 * @type {ReadonlyArray<Readonly<{time: string, weekday: number, sat: number, sun: number}>>}
 */
const TABLE = Object.freeze([
    // ── MON–SAT — the eleven turns both run. Four on at the 06:20 open, staggered finishes;
    //    the FIRST is the short early. Then two morning arrival times, then the lates and closers.
    Object.freeze({ time: '06:20-13:30', weekday: 1, sat: 1, sun: 0 }),   // 7h10 — THE short early
    Object.freeze({ time: '06:20-14:45', weekday: 1, sat: 1, sun: 0 }),   // 8h25
    Object.freeze({ time: '06:20-15:30', weekday: 1, sat: 1, sun: 0 }),   // 9h10
    Object.freeze({ time: '06:20-15:45', weekday: 1, sat: 1, sun: 0 }),   // 9h25
    Object.freeze({ time: '07:15-16:30', weekday: 1, sat: 0, sun: 1 }),   // 9h15
    Object.freeze({ time: '07:15-16:45', weekday: 2, sat: 2, sun: 1 }),   // 9h30 — all three days
    Object.freeze({ time: '14:15-22:00', weekday: 2, sat: 2, sun: 0 }),   // 7h45
    Object.freeze({ time: '15:15-22:45', weekday: 2, sat: 1, sun: 0 }),   // 7h30 ← one of these is Saturday's move
    Object.freeze({ time: '15:45-23:55', weekday: 1, sat: 1, sun: 0 }),   // 8h10
    Object.freeze({ time: '16:00-23:55', weekday: 1, sat: 1, sun: 0 }),   // 7h55
    Object.freeze({ time: '16:15-23:55', weekday: 1, sat: 1, sun: 0 }),   // 7h40
    // ── SATURDAY'S OWN TWO — the whole of the difference, one row per move.
    Object.freeze({ time: '08:30-18:00', weekday: 0, sat: 1, sun: 1 }),   // 9h30 — the later morning body
    Object.freeze({ time: '16:40-23:55', weekday: 0, sat: 1, sun: 0 }),   // 7h15 — the fourth closer
    // ── SUNDAY'S OWN SIX — its window is different (07:15–23:25), so most of these have to be.
    Object.freeze({ time: '07:15-14:15', weekday: 0, sat: 0, sun: 1 }),   // 7h00 — Sunday's short early
    Object.freeze({ time: '07:15-15:30', weekday: 0, sat: 0, sun: 1 }),   // 8h15
    Object.freeze({ time: '14:15-22:25', weekday: 0, sat: 0, sun: 2 }),   // 8h10
    Object.freeze({ time: '15:15-23:25', weekday: 0, sat: 0, sun: 1 }),   // 8h10
    Object.freeze({ time: '15:45-23:25', weekday: 0, sat: 0, sun: 1 }),   // 7h40
    Object.freeze({ time: '16:20-23:25', weekday: 0, sat: 0, sun: 1 }),   // 7h05
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
