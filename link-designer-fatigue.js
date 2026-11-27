// @ts-check
/**
 * link-designer-fatigue.js — the ORR good-practice FATIGUE FACTORS, assessed against a link design.
 *
 * Source: ORR, *Good practice guidelines — Fatigue Factors*, December 2021 —
 * `orr.gov.uk/sites/default/files/2021-12/good-practice-guidelines-fatigue-factors.pdf`.
 * **TWENTY-FIVE rows** in six families: time of day (3), duty length (4), recovery time (3),
 * intervals between duties (3), cumulative (8), circadian phase shift (4). Twenty are numbered FF1
 * to FF20; the rest are FF8b and four rows the sheet attributes to MRSF rather than numbering.
 *
 * The count was read off the source (Aug 2026), after the docs said 24 and the panel rendered 23 — a
 * disagreement between two numbers is settled by reading the source, never by picking whichever is
 * easier to change. The two MRSF rows added then are not interchangeable:
 *
 *   · **"More than 7 consecutive 8h shifts"** — the tightest consecutive-working rule on the page,
 *     and the one most likely to bite a link whose duties are around eight hours (FF11 allows 13
 *     shifts between 48h breaks; this allows 7).
 *   · **"More than 6 consecutive night or early shifts in a permanent pattern"** — not applicable to
 *     a link, which is a rotating pattern by construction, and rendered saying so. FF15 is its
 *     rotating counterpart, at a threshold of 4.
 *
 * ── A COVER WEEK IS AN UNKNOWN, NOT A NO ────────────────────────────────────────────────────────
 *
 * A plain run scan ENDS a run at a spare day (no times, so it fails any predicate): FF15 once reported
 * a longest early-shift run of 3 with a green tick against a worst case of 6 over a threshold of 4.
 * FF10, FF15 and the 8h rule use `runLengthsWhere` (link-designer-design.js) — `workedRunLengths`'s spare-week
 * budget with the question as a parameter. Two boundaries make it honest rather than merely louder:
 *
 *   · **four, never seven.** Counting a whole cover week fuses the blocks either side (the live
 *     roster read 15 against a true 9).
 *   · **extend, never create** (`requireMatch`): otherwise FF10 reports a run of four made entirely of
 *     unknowns on a design with no duty over twelve hours — a finding about nothing.
 *
 * Where the worst case and the certain figure differ, the row says both: a number the reader cannot
 * take apart is either over-trusted or discounted.
 *
 * WHY THIS IS ITS OWN MODULE, and what it deliberately does NOT do.
 *
 * 1. **It reports factors PRESENT. It does not pass or fail a design.** The ORR is explicit that
 *    these "are not prescriptive limits, but the more a working pattern features these fatigue
 *    factors, the greater the likely need to assess and control potential fatigue risks". A tool
 *    that rendered them red/green would misrepresent the guidance it is quoting. The escalation the
 *    ORR sets out — justify why the factor cannot be avoided, minimise it, then assess and control
 *    the residual risk — is a human process this module feeds, not one it performs.
 *
 * 2. **The greatest risk here is FALSE ASSURANCE**, not a missing rule. A design showing no findings
 *    and being read as approved is worse than no tool at all on a safety-adjacent matter. So every
 *    rule reports its status explicitly — including the ones that are CLEAR and the ones that are
 *    NOT APPLICABLE — rather than silently contributing nothing. Silence must never be the same
 *    shape as compliance.
 *
 * 3. **Unavoidable factors are STANDING characteristics, not findings.** Every 06:20 duty on this
 *    link is an FF2 early start, so FF2 describes the operation rather than the proposal. Flagging
 *    half the rotation on every design is how a check gets ignored; it is reported with a count and
 *    marked `standing`.
 *
 * 4. **A rule whose reading is not ORR's own is marked `confirm: true`** so the UI can say so. The
 *    owner checked MRSF's 7×8h, FF17, FF18 and FF19 against ORR's Managing rail staff fatigue (Aug
 *    2024) on 28 Sep 2026, and only FF19 keeps it — its reading is the owner's choice and more lenient
 *    than ORR's wording (see the row).
 *
 * Hours caveat: SPARE days carry no times, so they add nothing to a count of long duties, and on
 * the duties the rota fixes they add no hours to the 55-hour row either. `hoursAreFloor` says
 * whether a design has a spare day at all, so the UI can say so rather than imply precision — and
 * not say it of a design whose figures are exact. The 55-hour row's VERDICT is not taken on that
 * floor: like every run here, it is taken on a cover week's worst case (`worstHoursInAny7Days`),
 * and the row states both figures.
 */

import { DAYS, ROTATING_LINES, startMinutes, dutyMinutes, runDesignChecks, MIN_REST_MINUTES, worstCaseWorkedRun, runLengthsWhere, SPARE_WORKED_DAYS, spareDrawsOnFour, isRest, CONTRACTED_HOURS_PER_WEEK, hmFromHours } from './link-designer-design.js';
// FF18 is about what happens BETWEEN lines, so it needs the adjacency maths. Direction is fatigue →
// adjacency → design: no cycle (asserted by import-graph.test.mjs).
import { scoreOrder, GENTLE_THRESHOLD_MINUTES } from './link-designer-adjacency.js';
import { normaliseWindow, windowMinutes } from './link-designer-window.js';

/** A day key as a reader names it, for the rows that say where something is — FF8b here, and the
 *  Design checks' short turnarounds (link-designer-analysis.js). */
export const DAY_NAME = /** @type {Record<string, string>} */ ({
    sun: 'Sunday', mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday',
});

/** A duty counts as an FF2 "early shift" when it starts in this window (inclusive of 05:00). */
const EARLY_FROM = 5 * 60;
const EARLY_TO   = 7 * 60;      // exclusive — 07:00 itself is not an early start

/**
 * Minutes as `"6h 25m"` or `"4h 08m"` — FF13's shortest rest and FF18's week-to-week step, through
 * `hmFromHours`, the workspace's one hours-and-minutes formatter.
 * @param {number} mins
 * @returns {string}
 */
function _hm(mins) {
    return hmFromHours(Math.round(mins) / 60);
}

// The rest predicate lives in link-designer-design.js, re-exported here; link-designer-adjacency.js reads the same one.
export { isRest };
/** @param {any} s */
export function isWorked(s) { return !isRest(s); }

/**
 * Duty length in minutes, or null when the value carries no times (RD / SPARE / unparseable).
 *
 * A duty whose end is at or before its start has run past midnight, so it gains 24h — `endMinutesAbs`
 * in link-designer-design.js, the ONE place that rule lives (ignoring the case reports a NEGATIVE duty length).
 * @param {any} shift
 */
// Lives in link-designer-design.js beside `endMinutesAbs`, re-exported here: a second copy is precisely the
// failure `endMinutesAbs` was extracted to end.
export { dutyMinutes };

/** Does this duty start in the FF2 early window? @param {any} shift */
export function isEarlyStart(shift) {
    const st = startMinutes(shift);
    return st !== null && st >= EARLY_FROM && st < EARLY_TO;
}

/** Does this duty start before 05:00 (FF3 "very early")? @param {any} shift */
export function isVeryEarlyStart(shift) {
    const st = startMinutes(shift);
    return st !== null && st < EARLY_FROM;
}

/**
 * Does this duty cover any part of 00:00–05:00 (FF1 "night shift")?
 * A CEA link should never produce one; the rule exists so that a design which somehow acquires a
 * night duty says so loudly instead of quietly scoring well on the night-shift factors.
 * @param {any} shift
 */
export function coversNightWindow(shift) {
    const st = startMinutes(shift);
    const len = dutyMinutes(shift);
    if (st === null || len === null) return false;
    // Exact interval overlap, NOT a sampled walk: 15-minute samples missed "23:50-00:05". On the one
    // rule whose job is to be a loud alarm, an answer that depends on where samples fall is worse than none.
    const end = st + len;   // st < 1440 and len <= 1440, so end < 2880 — two windows cover it
    const hits = (/** @type {number} */ from) => st < from + EARLY_FROM && end > from;
    return hits(0) || hits(24 * 60);
}

/**
 * Flatten a design into the circular sequence a PERSON experiences: line 1 Sun→Sat, line 2 Sun→Sat,
 * and so on, wrapping from the last line back to the first. Every fatigue rule here reads that
 * sequence, because the factors are about a person's pattern, not about a line.
 * @param {Object} patterns
 * @param {number} [lines=ROTATING_LINES]
 */
export function toSequence(patterns, lines = ROTATING_LINES) {
    const out = [];
    for (let pos = 1; pos <= lines; pos++) {
        const row = /** @type {Record<string, any>} */ (patterns)?.[String(pos)];
        for (const d of DAYS) out.push({ line: pos, day: d, shift: row?.[d] ?? 'RD' });
    }
    return out;
}

/**
 * Longest run of worked days that is NOT broken by a 48-hour break.
 *
 * FF11 says "more than 13 consecutive shifts without a 48h break" — which is NOT the same as the
 * longest run of consecutive worked days that `runDesignChecks` already reports. A SINGLE rest day
 * is not COUNTED as a 48h break: two rest days together are, and always give more than 48 hours off.
 * One alone usually gives less — not always (an early finish before it and a late start after can
 * leave 49h 10m), so the detail never says it "is not a 48h break". Counting pairs only can OVERSTATE
 * a run, never understate it — the safe direction for a fatigue check. So six on / one off / six on
 * is a 12-shift run for FF11 and two separate 6-day runs for the existing check.
 * @param {Array<{shift: any}>} seq
 */
export function longestRunBetween48hBreaks(seq) {
    const n = seq.length;
    if (!n) return 0;
    // Shifts in the whole cycle — the cap on the answer. A SPARE week contributes four, not seven (or
    // the cap would re-admit the over-count); the four are Monday to Saturday, and a spare Sunday is
    // overtime on top, adding one (`spareDrawsOnFour`).
    const spareWeeks = new Set();
    let spareSundays = 0;
    for (let i = 0; i < n; i++) {
        if (seq[i].shift !== 'SPARE') continue;
        if (spareDrawsOnFour(i)) spareWeeks.add(Math.floor(i / 7));
        else spareSundays++;
    }
    const workedTotal = seq.filter(x => isWorked(x.shift) && x.shift !== 'SPARE').length
        + spareWeeks.size * SPARE_WORKED_DAYS + spareSundays;

    // Does a 48h break exist ANYWHERE in the rotation? If not, the person never gets one, and the
    // answer is every worked day in the cycle — recurring forever. Capping at the sequence LENGTH
    // would both count rest days as shifts and imply the run ends (the six-on/one-off/six-on test).
    let has48 = false;
    for (let i = 0; i < n && !has48; i++) {
        if (isRest(seq[i].shift) && isRest(seq[(i + 1) % n].shift)) has48 = true;
    }
    if (!has48) return workedTotal;

    let best = 0, run = 0, restRun = 0;
    // Per-line budget for the spare weeks — see the SPARE note in the doc comment.
    /** @type {Map<number, number>} */
    const spent = new Map();
    // Two laps so a run spanning the wrap point is measured whole.
    for (let i = 0; i < n * 2; i++) {
        const idx = i % n;
        const s = seq[idx].shift;
        if (s === 'SPARE') {
            // A spare week is FOUR duties, and its three rest days need not be adjacent — so in the
            // worst case it supplies NO 48h break while adding four shifts. Four, and no reset, is
            // the honest ceiling (seven inflates the run; a break would deflate it).
            //
            // Keyed on the UNMODDED index, so the second lap — which measures a run wrapping the
            // cycle end — gets its own budget: next time round it is a fresh spare week. Sharing it
            // would silently truncate exactly the wrapping run the lap is for.
            //
            // The four are Monday to Saturday; a spare SUNDAY is overtime that spends none of them.
            const line = Math.floor(i / 7);
            const used = spent.get(line) || 0;
            const drawsOnFour = spareDrawsOnFour(i);
            if (!drawsOnFour || used < SPARE_WORKED_DAYS) {
                // A spare duty is a SHIFT, so it honours the same reset the worked branch does —
                // without it the bilingual roster read 23 against a true worst case of 15.
                if (restRun >= 2) run = 0;
                if (drawsOnFour) spent.set(line, used + 1);
                restRun = 0;
                run++;
                if (run > best) best = run;
            }
            continue;
        }
        if (isWorked(s)) {
            if (restRun >= 2) run = 0;      // a 48h break resets the count
            restRun = 0;
            run++;
            if (run > best) best = run;
        } else {
            restRun++;
        }
    }
    return Math.min(best, workedTotal);
}

/**
 * Longest run of consecutive worked days, wrapping — delegated to `worstCaseWorkedRun` in
 * link-designer-design.js so there is ONE reading of what a spare week costs a person. A named export for
 * this module's vocabulary; it must never grow its own copy of the rule.
 * @param {Array<{shift:any}>} seq
 */
export function longestWorkedRun(seq) {
    return worstCaseWorkedRun(seq);
}

/**
 * Longest run of consecutive duties satisfying `pred`, wrapping. Used for FF15 (early shifts) and
 * FF10 (12h day shifts).
 * @param {Array<{shift:any}>} seq
 * @param {(shift:any) => boolean} pred
 */
export function longestRunOf(seq, pred) {
    const n = seq.length;
    if (!n) return 0;
    let best = 0, run = 0;
    for (let i = 0; i < n * 2; i++) {
        if (pred(seq[i % n].shift)) { run++; if (run > best) best = run; } else run = 0;
    }
    return Math.min(best, n);
}

/**
 * FF8b — blocks of consecutive early starts followed by fewer than 2 rest days.
 *
 * INTERPRETATION: a "block" is two or more consecutive early starts. A single early start followed
 * by one rest day is not what the factor is describing, and counting it would fire on almost every
 * design. Returns the offending blocks so the UI can name them.
 *
 * CIRCULAR, like every other rule here: a scan from index 0 cuts a block straddling the wrap point
 * into two blocks of one, reported as nothing. The rotation has no start, so the scan begins at the
 * first NON-early day and laps once from there.
 * @param {Array<{shift:any, line:number, day:string}>} seq
 */
export function earlyBlocksWithShortRecovery(seq) {
    const n = seq.length;
    /** @type {Array<{fromLine:number, fromDay:string, blockLength:number, restDays:number}>} */
    const out = [];
    if (!n) return out;

    const origin = seq.findIndex(x => !isEarlyStart(x.shift));
    if (origin === -1) {
        // Every duty in the rotation is an early start — one unbroken block with no recovery at all.
        return [{ fromLine: seq[0].line, fromDay: seq[0].day, blockLength: n, restDays: 0 }];
    }
    const at = (/** @type {number} */ k) => seq[(origin + k) % n];

    let i = 0;
    while (i < n) {
        if (!isEarlyStart(at(i).shift)) { i++; continue; }
        let j = i;
        while (j < n && isEarlyStart(at(j).shift)) j++;
        const blockLen = j - i;
        if (blockLen >= 2) {
            let rest = 0;
            for (let k = j; k < j + 2; k++) {
                if (isRest(at(k).shift)) rest++; else break;
            }
            if (rest < 2) {
                out.push({ fromLine: at(i).line, fromDay: at(i).day, blockLength: blockLen, restDays: rest });
            }
        }
        i = j;
    }
    return out;
}

/**
 * Maximum hours worked in any rolling 7-day window, on the duties the rota FIXES.
 *
 * A FLOOR, not an estimate: SPARE contributes zero because it carries no times. MRSF's threshold is
 * 55h in a 7-day period; the row's verdict is taken on `worstHoursInAny7Days`, and this is the half of
 * the row that is certain.
 * @param {Array<{shift:any}>} seq
 */
export function maxHoursInAny7Days(seq) {
    return Math.round((maxMinutesInAny7Days(seq) / 60) * 10) / 10;
}

/**
 * The same rolling week in whole MINUTES. A 55-hour verdict is taken on minutes, never on the
 * rounded hours: 55h 02m rounds to 55.0, and "more than 55" asked of 55.0 says no.
 * @param {Array<{shift:any}>} seq
 */
function maxMinutesInAny7Days(seq) {
    const n = seq.length;
    let best = 0;
    for (let i = 0; i < n; i++) {
        let mins = 0;
        for (let k = 0; k < 7; k++) mins += dutyMinutes(seq[(i + k) % n].shift) ?? 0;
        if (mins > best) best = mins;
    }
    return best;
}

/**
 * What one worked day of a cover week counts for in the 55-hour worst case: a quarter of the
 * contracted week — 8h 45m. A cover week IS the contracted week, Monday to Saturday (`weeklyHours`
 * counts it as one, owner), and it is worked as four duties, so a quarter each is the app's own
 * reading of the week rather than a figure chosen for this row. Its Sunday is overtime of unknown
 * length on top, and counts the same: one assumption, stated on the row, rather than two.
 */
export const COVER_DUTY_MINUTES = CONTRACTED_HOURS_PER_WEEK * 60 / SPARE_WORKED_DAYS;

/** The assumption in words, written once: the row, the Design checks note and the compare card all say it. */
export const COVER_DUTY_WORDS = `a quarter of the contracted week (${hmFromHours(COVER_DUTY_MINUTES / 60)})`;

/**
 * Maximum hours in any rolling 7-day window at a cover week's WORST (17 Nov 2026) — the reading
 * every run in this module takes ("A cover week is an unknown, not a no", link-designer.md); the
 * floor above reads CLEAR on designs that cross 55 when a cover week falls badly.
 *
 * Here a spare day is a duty of `COVER_DUTY_MINUTES`, with the same two bounds the run
 * rules keep: a cover week works FOUR of Monday to Saturday (`spareDrawsOnFour`), placed as badly
 * as the window allows, and its Sunday is worked on top. Asking each window for its own worst is
 * exact for a maximum, for the reason `worstCaseWorkedRun` gives: no two windows need one week's
 * placement at once. And any four days a window can reach lie inside one block of four, so this is
 * the pack's block-placement worst too.
 *
 * The budget is keyed on the UNMODDED position, as FF11's is: a window that laps the rotation
 * meets the next week of a line, which has four duties of its own.
 * @param {Array<{shift:any}>} seq
 * @returns {number} hours, to one decimal
 */
export function worstHoursInAny7Days(seq) {
    return Math.round((worstMinutesInAny7Days(seq) / 60) * 10) / 10;
}

/** `worstHoursInAny7Days` in whole minutes, which the verdict is taken on. @param {Array<{shift:any}>} seq */
function worstMinutesInAny7Days(seq) {
    const n = seq.length;
    let best = 0;
    for (let i = 0; i < n; i++) {
        /** Duties this window has already given each cover week. @type {Map<number, number>} */
        const spent = new Map();
        let mins = 0;
        for (let k = 0; k < 7; k++) {
            const s = seq[(i + k) % n].shift;
            if (s !== 'SPARE') { mins += dutyMinutes(s) ?? 0; continue; }
            if (!spareDrawsOnFour(i + k)) { mins += COVER_DUTY_MINUTES; continue; }   // its Sunday: overtime on top of the four
            const week = Math.floor((i + k) / 7), used = spent.get(week) || 0;
            if (used < SPARE_WORKED_DAYS) { spent.set(week, used + 1); mins += COVER_DUTY_MINUTES; }
        }
        if (mins > best) best = mins;
    }
    return best;
}

/**
 * Minutes as the 55-hour row prints them: hours to one decimal, gaining a second only where one
 * decimal would read 55 beside a figure that is over it — 55h 02m prints as 55.03, never as 55.
 * @param {number} mins
 */
function _hours55(mins) {
    const one = Math.round((mins / 60) * 10) / 10;
    return mins > 55 * 60 && one <= 55 ? Math.round(mins / 0.6) / 100 : one;
}

/**
 * FF19 — successive shift start times varying by more than 2 hours.
 *
 * INTERPRETATION, NOT SETTLED: counted only WITHIN a block of consecutive working days. A rest day
 * between two duties gives time to adjust, so treating them as "successive shifts" would inflate the
 * count on any pattern with scattered rest days. The stricter reading (count across rest days too)
 * roughly triples the figure on the current link. **Confirm which reading applies before relying on
 * the number.**
 * @param {Array<{shift:any, line:number, day:string}>} seq
 */
export function startTimeJumps(seq, thresholdMinutes = 120) {
    const n = seq.length;
    const out = [];
    for (let i = 0; i < n; i++) {
        const a = seq[i], b = seq[(i + 1) % n];
        if (!isWorked(a.shift) || !isWorked(b.shift)) continue;   // within a working block only
        const sa = startMinutes(a.shift), sb = startMinutes(b.shift);
        if (sa === null || sb === null) continue;                  // SPARE has no time to compare
        const delta = Math.abs(sb - sa);
        if (delta > thresholdMinutes) {
            out.push({ line: a.line, day: a.day, from: a.shift, to: b.shift, deltaMinutes: delta });
        }
    }
    return out;
}

/**
 * FF17 — backward rotation.
 *
 * Counted as steps within a working block where the next duty starts EARLIER than the one before it
 * — ORR's own definition (Managing rail staff fatigue, Aug 2024, 7.68), settled by the owner on
 * 28 Sep 2026 (see the FF17 row). A forward-rotating pattern moves later through the week. Reported as
 * a count of backward steps against forward steps, so the pattern's overall direction is visible
 * rather than asserted.
 * @param {Array<{shift:any, line:number, day:string}>} seq
 */
export function rotationDirection(seq) {
    const n = seq.length;
    let backward = 0, forward = 0;
    const steps = [];
    for (let i = 0; i < n; i++) {
        const a = seq[i], b = seq[(i + 1) % n];
        if (!isWorked(a.shift) || !isWorked(b.shift)) continue;
        const sa = startMinutes(a.shift), sb = startMinutes(b.shift);
        if (sa === null || sb === null) continue;
        if (sb < sa) { backward++; steps.push({ line: a.line, day: a.day, from: a.shift, to: b.shift }); }
        else if (sb > sa) forward++;
    }
    return { backward, forward, steps };
}

/** @typedef {{code:string, title:string, family:string, status:'present'|'clear'|'standing'|'n/a',
 *             value?:number|string, threshold?:number|string, detail?:string, confirm?:boolean}} FatigueResult */

/**
 * What a cover week can add to a run in the worst case — one clause, so every row that qualifies a
 * figure says it the same way. Its four duties are Monday to Saturday, and its Sunday can be worked
 * on top as overtime (`spareDrawsOnFour`).
 */
const COVER_WEEK_ADDS = `a cover week can supply up to ${SPARE_WORKED_DAYS} more on Monday to Saturday, and one on its `
    + 'Sunday as overtime, whose times are not yet assigned';

/**
 * The sentence a spare-aware run owes its reader: the worst case is the number on screen, so say how
 * much of it is certain and where the rest came from. Written once because three rows need it and a
 * fourth will; silent when there is nothing to qualify, so a design with no cover week reads clean.
 * @param {number} worst @param {number} certain @param {string} what
 */
function _spareCaveat(worst, certain, what) {
    if (worst === certain) return `Longest run of ${what} is ${worst}.`;
    return `Longest run of ${what} is ${worst} in the worst case — ${certain} of them are certain, and ${COVER_WEEK_ADDS}.`;
}

/**
 * Assess a design against the p3 fatigue factors.
 *
 * @param {Object} patterns - { "1".."N": { sun..sat } }
 * @param {number} [lines=ROTATING_LINES]
 * @param {{ window?: any }} [opts] - the design's staffed window, which FF2's sentence names; the
 *   default window when it is not given
 * @returns {{results: FatigueResult[], present: number, standing: number, confirmNeeded: number, hoursAreFloor: boolean}}
 */
export function assessFatigue(patterns, lines = ROTATING_LINES, { window: win } = {}) {
    // A missing patterns object reads as all-rest everywhere — `toSequence` already did; the FF18
    // `scoreOrder` and FF13 `runDesignChecks` below dereference it raw, so normalise it once here.
    patterns = patterns || {};
    const seq = toSequence(patterns, lines);
    const timed = seq.filter(x => startMinutes(x.shift) !== null);
    // Hours are a FLOOR only where a spare day is counted at zero (the header's caveat) — never the
    // constant `true`, which told an exact design its "real totals are higher". A worked cell with no
    // readable time also counts zero; the hours row names those, and an import refuses them.
    const hoursAreFloor = seq.some(x => x.shift === 'SPARE');

    /** @type {FatigueResult[]} */
    const results = [];
    const add = (/** @type {FatigueResult} */ r) => results.push(r);

    // ── Time of day ──────────────────────────────────────────────────────────
    const nights = seq.filter(x => coversNightWindow(x.shift));
    add({ code: 'FF1', family: 'Time of day', title: 'Night shift covering 00:00–05:00',
        status: nights.length ? 'present' : 'n/a',
        value: nights.length,
        detail: nights.length
            ? `${nights.length} dut${nights.length === 1 ? 'y reaches' : 'ies reach'} into 00:00–05:00 — this link has no night shifts, so ${nights.length === 1 ? 'it needs' : 'they need'} checking.`
            : 'No duty reaches into 00:00–05:00. Customer Experience Ambassadors (CEAs) do not work nights.' });

    const earlies = seq.filter(x => isEarlyStart(x.shift));
    // The opening is the DESIGN's window, not a fixed 06:20. `standing` means "from the operation, not
    // from this design" (point 3 above), true only while the opening itself falls in 05:00–07:00;
    // opened earlier or later, these starts are this design's own and count as `present`. Three
    // sentences, one per case.
    const opens = normaliseWindow(win).monSat.start;
    const opensMin = windowMinutes(opens);
    const opensEarly = opensMin !== null && opensMin >= EARLY_FROM && opensMin < EARLY_TO;
    const opensBefore = opensMin !== null && opensMin < EARLY_FROM;
    const ff2Count = `${earlies.length} of ${timed.length} timed duties.`;
    add({ code: 'FF2', family: 'Time of day', title: 'Early shift starting 05:00–07:00',
        status: earlies.length ? (opensEarly ? 'standing' : 'present') : 'clear',
        value: earlies.length,
        detail: earlies.length
            ? (opensEarly
                ? `${ff2Count} Unavoidable on this link — the station opens at ${opens} Monday to Saturday — so this is a property of the operation, not of the design.`
                : opensBefore
                    ? `${ff2Count} The staffed window opens at ${opens} Monday to Saturday, before 05:00, so the opening does not need these starts — they come from this design.`
                    : `${ff2Count} The staffed window opens at ${opens} Monday to Saturday, so these starts come before the opening — they come from this design, not from the operation.`)
            : 'No duty starts between 05:00 and 07:00.' });

    const veryEarly = seq.filter(x => isVeryEarlyStart(x.shift));
    add({ code: 'FF3', family: 'Time of day', title: 'Very early shift starting before 05:00',
        status: veryEarly.length ? 'present' : 'clear', value: veryEarly.length });

    // ── Duty length ──────────────────────────────────────────────────────────
    // NOT APPLICABLE and CLEAR are different answers: with a very early duty present but none over 8h
    // this is CLEAR, or it contradicts the FF3 row above, which counted those same duties.
    const veryEarlyOver8 = veryEarly.filter(x => (dutyMinutes(x.shift) ?? 0) > 8 * 60);
    add({ code: 'FF4', family: 'Duty length', title: 'Very early shift (before 05:00) over 8h', threshold: '8h',
        status: veryEarlyOver8.length ? 'present' : (veryEarly.length ? 'clear' : 'n/a'),
        value: veryEarly.length ? veryEarlyOver8.length : undefined,
        detail: veryEarly.length
            ? (veryEarly.length === 1
                ? `1 duty starts before 05:00, and it ${veryEarlyOver8.length ? 'runs' : 'does not run'} over 8h.`
                : `${veryEarly.length} duties start before 05:00; ${veryEarlyOver8.length} of them ${veryEarlyOver8.length === 1 ? 'runs' : 'run'} over 8h.`)
            : 'No duty starts before 05:00.' });

    const over12 = seq.filter(x => (dutyMinutes(x.shift) ?? 0) > 12 * 60);
    add({ code: 'FF5', family: 'Duty length', title: 'Day shift over 12h', threshold: '12h',
        status: over12.length ? 'present' : 'clear', value: over12.length });

    const earlyOver10 = seq.filter(x => isEarlyStart(x.shift) && (dutyMinutes(x.shift) ?? 0) > 10 * 60);
    add({ code: 'FF7', family: 'Duty length', title: 'Early shift over 10h', threshold: '10h',
        status: earlyOver10.length ? 'present' : 'clear', value: earlyOver10.length });

    // ── Recovery time ────────────────────────────────────────────────────────
    const ff8b = earlyBlocksWithShortRecovery(seq);
    // The WORST block is ONE block, chosen by a stated rule — the fewest rest days after it, then the
    // longest — and described whole, never figures from two blocks describing one that does not exist.
    const ff8bWorst = ff8b.reduce((w, b) =>
        (b.restDays < w.restDays || (b.restDays === w.restDays && b.blockLength > w.blockLength) ? b : w), ff8b[0]);
    add({ code: 'FF8b', family: 'Recovery time', title: 'Fewer than 2 days rest after a block of early starts',
        status: ff8b.length ? 'present' : 'clear', value: ff8b.length, threshold: '2 days',
        detail: ff8bWorst
            ? `Worst: a block of ${ff8bWorst.blockLength} early starts from line ${ff8bWorst.fromLine} ${DAY_NAME[ff8bWorst.fromDay] ?? ff8bWorst.fromDay}, `
              + `followed by ${ff8bWorst.restDays === 0 ? 'no rest day' : `${ff8bWorst.restDays} rest day${ff8bWorst.restDays === 1 ? '' : 's'}`}.`
            : 'Every block of 2+ consecutive early starts is followed by at least 2 rest days.' });

    const ff11 = longestRunBetween48hBreaks(seq);
    add({ code: 'FF11', family: 'Recovery time', title: 'More than 13 consecutive shifts without a 48h break',
        status: ff11 > 13 ? 'present' : 'clear', value: ff11, threshold: 13,
        detail: `Longest run between two-day breaks is ${ff11} shifts. A two-day break is two rest days together, always more than 48 hours off. A single rest day does not reset this count, even when the shifts either side leave 48 hours, so it can only overstate a run.`
            + (seq.some(x => x.shift === 'SPARE')
                ? ` A cover week is ${SPARE_WORKED_DAYS} duties on Monday to Saturday, and its Sunday can be worked as overtime on top; its rest days need not fall together — so in the worst case it adds ${SPARE_WORKED_DAYS + 1} shifts and no break.`
                : '') });

    // ── Cumulative ───────────────────────────────────────────────────────────
    // FF10 and FF15 measure runs with `runLengthsWhere`, never a plain scan, and `requireMatch`: see
    // the header ("A cover week is an unknown, not a no").
    // A 12-HOUR shift is twelve hours or more: "more than twelve" never fired on exactly-12h days,
    // the commonest 12h duty there is.
    const is12h = (/** @type {any} */ s) => (dutyMinutes(s) ?? 0) >= 12 * 60;
    const runs10 = runLengthsWhere(seq, is12h, { requireMatch: true });
    const ff10 = runs10.length ? Math.max(...runs10) : 0;
    add({ code: 'FF10', family: 'Cumulative', title: 'More than 4 consecutive 12h day shifts',
        status: ff10 > 4 ? 'present' : 'clear', value: ff10, threshold: 4,
        detail: _spareCaveat(ff10, longestRunOf(seq, is12h), '12-hour day shifts') });

    const runs15 = runLengthsWhere(seq, isEarlyStart, { requireMatch: true });
    const ff15 = runs15.length ? Math.max(...runs15) : 0;
    add({ code: 'FF15', family: 'Cumulative', title: 'More than 4 consecutive early shifts in a rotating pattern',
        status: ff15 > 4 ? 'present' : 'clear', value: ff15, threshold: 4,
        detail: _spareCaveat(ff15, longestRunOf(seq, isEarlyStart), 'early shifts') });

    const consec = longestWorkedRun(seq);
    add({ code: 'MRSF', family: 'Cumulative', title: 'More than 12 consecutive day shifts',
        status: consec > 12 ? 'present' : 'clear', value: consec, threshold: 12 });

    // THE VERDICT IS ON A COVER WEEK'S WORST CASE (17 Nov 2026), as every run above is — on the floor,
    // Balanced V6 read CLEAR at 50.9 while a cover week falling badly comes to over 60. The figure shown
    // is the worst case, the floor beside it in the sentence, as `_spareCaveat` does for a run. Both are
    // MINUTES first: the verdict is never asked of a rounded figure (`_hours55`).
    const floor7 = maxMinutesInAny7Days(seq), worst7 = worstMinutesInAny7Days(seq), over55 = worst7 > 55 * 60;
    // The cover week's duties, from the constant and in ONE clause for both sentences.
    const coverDuties = `its ${SPARE_WORKED_DAYS} duties on Monday to Saturday`;
    add({ code: 'MRSF', family: 'Cumulative', title: 'More than 55 hours worked in any 7-day period',
        status: over55 ? 'present' : 'clear', value: _hours55(worst7), threshold: 55,
        detail: !hoursAreFloor ? undefined
            : worst7 === floor7
                ? `A cover week's times are not yet assigned. Counted at its worst — ${coverDuties} placed as badly as they can be, and its Sunday worked as overtime, each as ${COVER_DUTY_WORDS} — it makes no seven days longer than this.`
                : `${_hours55(worst7)} hours in the worst case, and ${_hours55(floor7)} on the duties the link fixes. A cover week's times are not yet assigned, so ${coverDuties} are placed as badly as they can be and its Sunday is worked as overtime, each counted as ${COVER_DUTY_WORDS}.`
                  + (over55 && floor7 <= 55 * 60 ? ' Over 55 only if a cover week falls that way — and the worst case is what is reported, as for every run in this panel.' : '') });

    // ── THE ORR SHEET'S OTHER TWO MRSF ROWS (see the header) ────────────────

    // "More than 7 consecutive 8h shifts" — read as EIGHT HOURS OR MORE, the direction that reports
    // rather than stays quiet (a nine-hour duty is not less fatiguing; "exactly 8h" would silence the
    // row on this link). Settled by the owner on 28 Sep 2026, so no `confirm`.
    // `runLengthsWhere`, NOT `longestRunOf` — the difference is the whole row: a plain scan treats a
    // cover week as a BREAK, and the default design read 5 with a green tick against a worst case of 8
    // over a threshold of 7.
    const runs8 = runLengthsWhere(seq, s => (dutyMinutes(s) ?? 0) >= 8 * 60, { requireMatch: true });
    const eightPlus = runs8.length ? Math.max(...runs8) : 0;
    const certain8 = longestRunOf(seq, s => (dutyMinutes(s) ?? 0) >= 8 * 60);
    // SETTLED 28 Sep 2026 (owner): "8h shifts" means eight hours or more — the reading this row already took.
    add({ code: 'MRSF', family: 'Cumulative', title: 'More than 7 consecutive 8h shifts',
        status: eightPlus > 7 ? 'present' : 'clear', value: eightPlus, threshold: 7,
        detail: `Longest run of duties of 8 hours or more is ${eightPlus}`
            + (eightPlus !== certain8
                ? ` in the worst case — ${certain8} of them are certain, and ${COVER_WEEK_ADDS}. The worst case is what is reported, `
                  + 'because a factor that goes quiet when a cover week sits in the middle of a long stretch is the '
                  + 'one thing this panel must not do.'
                : '.')
            + ' An 8h shift is read as eight hours or more (confirmed 28 Sep 2026): a nine-hour duty is no less'
            + ' tiring than an eight-hour one.' });

    // "More than 6 consecutive night or early shifts in a permanent pattern". NOT APPLICABLE to a
    // link (a rotating pattern by construction; FF15 is its rotating counterpart), and it renders
    // saying so rather than being left out: not-applicable, clear and standing are three different
    // answers and none of them is silence.
    add({ code: 'MRSF', family: 'Cumulative', title: 'More than 6 consecutive night or early shifts in a permanent pattern',
        status: 'n/a', value: 'rotating pattern',
        detail: 'This link is a rotating pattern, so the permanent-pattern rule does not apply. '
            + 'FF15 above is the rotating equivalent, and its threshold is lower (4).' });

    // ── Circadian phase shift ────────────────────────────────────────────────
    // FF17 SETTLED 28 Sep 2026: ORR's Managing rail staff fatigue (Aug 2024, 7.68) defines backward
    // rotation as starting a shift earlier than the previous one and forward as later, and asks for
    // forward-rotating patterns (7.67) — the step count below is that definition, applied per step.
    const rot = rotationDirection(seq);
    add({ code: 'FF17', family: 'Circadian', title: 'Backward rotating pattern',
        status: rot.backward > rot.forward ? 'present' : 'clear',
        value: `${rot.backward} backward / ${rot.forward} forward`,
        detail: 'ORR defines backward rotation as starting a shift earlier than the previous one, and asks for forward-rotating patterns (Managing rail staff fatigue, 7.67–7.68). Counted as steps within a working block; present when backward steps outnumber forward ones.' });

    // FF18 — THE CADENCE IS STANDING, THE STEP IS EXTRA INFORMATION.
    //
    // NEVER HARDCODE THIS STATUS (it was, twice, in this module). The row reports THIS design's
    // week-to-week step — typical, worst, and how many boundaries exceed 2h (the ORR's own FF19
    // threshold) — by the same `scoreOrder` the line-order switches optimise. It stays `standing` when
    // measurable, never `present` above some figure: the ORR gives no threshold for FF18, and inventing
    // one is the pass/fail rendering this panel must never produce. A design with no timed line has no
    // measurable step and claims nothing: `n/a`.
    // Lines 1..lines, like every other rule here — NOT the keys the design carries: a design saved at an
    // older, longer rotation stores surplus lines. A missing line is unmeasurable, not skipped.
    const ff18Order = Array.from({ length: lines }, (_, i) => String(i + 1));
    const adj = scoreOrder(patterns, ff18Order);
    // Measurable iff at least one BOUNDARY actually produced a step — an empty design must never report
    // "typically 0h 0m a week".
    const stepMeasurable = ff18Order.length - adj.unmeasurable > 0;
    // NOT-APPLICABLE only when no line carries a time at all: a part-built design whose drawn lines are
    // not NEIGHBOURS (1, 3, 5) measures no boundary but stays `standing`, saying why.
    const anyTimed = timed.length > 0;
    // FF18 SETTLED 28 Sep 2026 (owner, on ORR's text): ORR's concern is how OFTEN a person's shift type
    // changes — rapid (about two days per shift type) or slow (about 21) rotation "may be preferable to
    // a rotating shift pattern that changes about once a week" (Managing rail staff fatigue, Aug 2024,
    // 7.68). A weekly link changes about once a week by construction, so the row stays `standing` for
    // every link; the week-to-week step above is kept as extra information, not as the definition.
    add({ code: 'FF18', family: 'Circadian', title: 'Rotating pattern of about a week',
        status: stepMeasurable || anyTimed ? 'standing' : 'n/a',
        value: stepMeasurable
            ? `${lines}-line rotation · typically ${_hm(adj.gentleMean)} a week`
            : `${lines}-line rotation`,
        // Both the chip and the sentence read the SAME constant `scoreOrder` counted against, so the
        // stated threshold cannot drift from the one actually applied.
        threshold: stepMeasurable ? `${GENTLE_THRESHOLD_MINUTES / 60}h` : undefined,
        detail: stepMeasurable
            ? `ORR's concern is how often a person's shift type changes: rotating about once a week is less preferable than rapid (about two days per shift type) or slow (about 21 days) rotation (Managing rail staff fatigue, 7.68). A link moves every person one line a week by construction, so this applies to every link. What a design does control is how far the working day moves at each weekly step — shown as extra information: here the typical move is ${_hm(adj.gentleMean)}, the largest is ${_hm(adj.gentleWorst)}, and ${adj.gentleOver} of ${lines} line boundaries move by more than ${GENTLE_THRESHOLD_MINUTES / 60} hours.${adj.unmeasurable ? ` ${adj.unmeasurable} boundaries carry no times (spare or unfilled weeks) and are excluded rather than counted as no change.` : ''}`
            : anyTimed
                ? `No two neighbouring lines both carry start times yet, so the week-to-week step cannot be measured. The ${lines}-line weekly cadence still applies.`
                : `No line carries a start time, so the week-to-week step cannot be measured. The ${lines}-line weekly cadence still applies.` });

    // FF19 keeps `confirm` deliberately (28 Sep 2026). The owner chose this reading — a rest day resets it
    // — because ORR's literal wording ("avoid consecutive duties with large variations in start times",
    // Managing rail staff fatigue, 7.71) counts across rest days, and on that reading every link with early
    // and late weeks has the factor, so it would stop telling designs apart. The reading is the owner's,
    // not ORR's, and an assessing manager should see that — which is what the flag is for.
    const jumps = startTimeJumps(seq);
    add({ code: 'FF19', family: 'Circadian', title: 'Successive start times varying by more than 2 hours', confirm: true,
        status: jumps.length ? 'present' : 'clear', value: jumps.length, threshold: '2h',
        detail: 'Counted only within a block of consecutive working days — a rest day is treated as time to adjust. ORR’s wording is stricter (“avoid consecutive duties with large variations in start times”, Managing rail staff fatigue, 7.71): counted across rest days, every link with early and late weeks has this factor.' });

    // ── Night-shift factors that cannot apply to a link with no nights ───────
    for (const [code, title] of [
        ['FF6',  'Night shift over 10h'], ['FF8', 'Less than 2 days rest after consecutive nights'],
        ['FF9',  'Less than 14h rest in any 24h for night shifts'], ['FF12', 'Only one day rest after night shifts'],
        ['FF14', 'More than 4 consecutive nights in a rotating pattern'],
        ['FF16', 'More than 3 consecutive night shifts over 8h'], ['FF20', 'First night shift'],
    ]) {
        // FAMILY IS 'Night shifts', not 'Night (not applicable)': the family is a heading, and whether
        // it APPLIES is per-row `status` — a verdict in the name would print an all-clear over rows
        // that had turned `present`.
        add({ code, family: 'Night shifts', title,
            status: nights.length ? 'present' : 'n/a',
            detail: nights.length ? 'A night duty is present, so this factor now needs assessing.' : undefined });
    }

    // FF13 IS the short-turnaround check, so the rule is read from runDesignChecks rather than
    // reimplemented — the two must never disagree about the same design.
    //
    // Never hardcode a status here (a hardcoded `clear` put FF13's GREEN TICK beneath an amber 6h25m
    // turnaround) — if a factor cannot be computed, it does not get a tick.

    const ff13 = runDesignChecks(patterns, lines).turnarounds;
    const worst = Math.min(...ff13.map(t => t.restMinutes));   // read only when there is one
    // A negative shortest rest is an OVERLAP (a duty past midnight into a next-day start before its own
    // finish) and is said as one — as a signed figure it read "-2h -30m" for 1h 30m.
    const shortest = worst < 0
        ? `Two consecutive duties overlap: the second starts ${_hm(-worst)} before the first ends.`
        : `Shortest rest between consecutive duties is ${_hm(worst)}.`;
    add({ code: 'FF13', family: 'Intervals between duties', title: 'Less than 12h rest in any 24h',
        status: ff13.length ? 'present' : 'clear', value: ff13.length, threshold: `${MIN_REST_MINUTES / 60}h`,
        detail: ff13.length
            ? `${shortest} Same finding as the short-turnaround check above — one rule, reported twice.`
            : `Every pair of consecutive duties has at least ${MIN_REST_MINUTES / 60} hours between them. Same rule as the short-turnaround check above.` });

    return {
        results,
        present: results.filter(r => r.status === 'present').length,
        // Counted SEPARATELY from `present`, never added to it: a standing characteristic of the
        // operation (every 06:20 duty is an FF2 early) is not a finding about this design, and one
        // combined total would say that it was.
        standing: results.filter(r => r.status === 'standing').length,
        confirmNeeded: results.filter(r => r.confirm).length,
        hoursAreFloor,
    };
}
