// @ts-check
/**
 * links-fatigue.js — the ORR good-practice FATIGUE FACTORS, assessed against a link design.
 *
 * Source: ORR, *Good practice guidelines — Fatigue Factors*, December 2021 —
 * `orr.gov.uk/sites/default/files/2021-12/good-practice-guidelines-fatigue-factors.pdf`.
 * **TWENTY-FIVE rows** in six families: time of day (3), duty length (4), recovery time (3),
 * intervals between duties (3), cumulative (8), circadian phase shift (4). Twenty are numbered FF1
 * to FF20; the rest are FF8b and four rows the sheet attributes to MRSF rather than numbering.
 *
 * **The count was wrong in the docs (24) AND in this module (23), and neither was the answer.** From
 * v19.46 the header said 24 and the panel rendered 23, with the gap logged as unresolvable because
 * the source could not be reached from this environment. It became reachable in Aug 2026, and the
 * sheet says 25. The two rows nobody had implemented were both MRSF rows in the Cumulative family,
 * and they are not interchangeable:
 *
 *   · **"More than 7 consecutive 8h shifts"** — the tightest consecutive-working rule on the page,
 *     and the one most likely to bite a link whose duties are around eight hours. FF11 allows 13
 *     shifts between 48h breaks; this allows 7. It was simply absent, so the panel was silent about
 *     the rule most likely to have something to say.
 *   · **"More than 6 consecutive night or early shifts in a permanent pattern"** — not applicable to
 *     a link, which is a rotating pattern by construction, and rendered saying so. FF15 is its
 *     rotating counterpart, at a threshold of 4.
 *
 * The lesson is the one this module already states about statuses, now applied to itself: a
 * disagreement between two numbers is not settled by picking whichever is easier to change. It is
 * settled by reading the source — and until somebody does, neither number is evidence.
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
 * 4. **Three rules carry an interpretation that is NOT settled** (FF17, FF18, FF19 — see below;
 *    this said "two" and named FF17/FF19 until v20.11, while the code has carried the flag on all
 *    three since v19.46). They are
 *    marked `confirm: true` so the UI can say so. Shipping a number whose definition is unagreed,
 *    unlabelled, is the false-assurance failure in miniature.
 *
 * Hours caveat: SPARE days carry no times, so they contribute ZERO to any hours total here. A
 * standby day is worked time, so every hours figure this module produces is a FLOOR, not an
 * estimate. `hoursAreFloor` is returned so the UI can say so rather than imply precision.
 */

import { DAYS, ROTATING_LINES, startMinutes, dutyMinutes, runDesignChecks, MIN_REST_MINUTES, worstCaseWorkedRun, SPARE_WORKED_DAYS } from './links-design.js';
// FF18 is the one factor here whose subject is what happens BETWEEN lines, so it is the one that
// needs the adjacency maths. Direction is fatigue → adjacency → design; `links-adjacency.js` imports
// only from `links-design.js`, so this adds no cycle (asserted by import-graph.test.mjs).
import { scoreOrder, GENTLE_THRESHOLD_MINUTES } from './links-adjacency.js';

/** A duty counts as an FF2 "early shift" when it starts in this window (inclusive of 05:00). */
const EARLY_FROM = 5 * 60;
const EARLY_TO   = 7 * 60;      // exclusive — 07:00 itself is not an early start

/**
 * Minutes as `"6h 25m"` — the shape this panel already used for FF13's shortest-rest figure, now
 * written once and shared with FF18's week-to-week step (v19.69). Deliberately keeps the `0m` tail
 * rather than trimming it, so adopting it changed no existing output.
 * @param {number} mins
 * @returns {string}
 */
function _hm(mins) {
    const m = Math.round(mins);
    return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** @param {any} s */
export function isRest(s) { return !s || s === 'RD' || s === 'OFF'; }
/** @param {any} s */
export function isWorked(s) { return !isRest(s); }

/**
 * Duty length in minutes, or null when the value carries no times (RD / SPARE / unparseable).
 *
 * A duty whose end is at or before its start has run past midnight, so it gains 24h — handled by
 * `endMinutesAbs` in links-design.js, which is the ONE place that rule lives (v19.47; this module
 * carried its own copy of the expression for one version). Nothing in the current CEA link runs past
 * midnight — duties finish 23:55 — but a designer can type one, and the version of this rule that
 * ignores the case reports a NEGATIVE duty length rather than failing.
 * @param {any} shift
 */
// MOVED to links-design.js at v20.04 and re-exported here, so every existing importer and test is
// untouched. It belongs beside `endMinutesAbs`: `weeklyHours` needs the same reading of a duty's
// length, that module cannot import this one (this one imports it), and a second copy is precisely
// the failure `endMinutesAbs` was extracted to end.
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
    // Exact interval overlap, NOT a sampled walk. The first version stepped through the duty in
    // 15-minute hops and asked whether any sample landed before 05:00, which meant a duty that
    // crossed midnight by less than one step was missed: "23:50-00:05" returned false while
    // "23:00-00:10" returned true. On the one rule whose whole job is to be a loud alarm, an answer
    // that depends on where the samples happen to fall is worse than no rule.
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
 * is not a 48h break, so a pattern of six on / one off / six on is a 12-shift run for FF11 and two
 * separate 6-day runs for the existing check. They coincide on the current link only because its
 * rest days happen to come in pairs.
 * @param {Array<{shift: any}>} seq
 */
export function longestRunBetween48hBreaks(seq) {
    const n = seq.length;
    if (!n) return 0;
    // Shifts in the whole cycle. A SPARE week contributes four, not seven — it is the ceiling this
    // function's answer is capped at, so counting all seven here would let the cap re-admit the
    // very over-count the body was fixed to remove (v19.79).
    const spareWeeks = new Set();
    for (let i = 0; i < n; i++) if (seq[i].shift === 'SPARE') spareWeeks.add(Math.floor(i / 7));
    const workedTotal = seq.filter(x => isWorked(x.shift) && x.shift !== 'SPARE').length
        + spareWeeks.size * SPARE_WORKED_DAYS;

    // Does a 48h break exist ANYWHERE in the rotation? If not, the person never gets one, and the
    // answer is every worked day in the cycle — recurring forever. Capping at the sequence LENGTH
    // (as a first draft of this did) both overstates it, by counting rest days as shifts, and
    // understates it, by implying the run ends. Caught by the six-on/one-off/six-on test.
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
            // worst case it supplies NO 48h break at all while still adding four shifts. Counting
            // all seven as shifts (what this did to v19.78) inflated the run; counting the week as
            // a break would deflate it. Four, and no reset, is the honest ceiling.
            //
            // Keyed on the UNMODDED index, so the second lap gets its own budget. That is not a
            // detail: the second lap exists to measure a run that wraps the cycle end, and on the
            // next time round the wheel it is genuinely a fresh spare week with four fresh duties.
            // Sharing the budget would silently truncate exactly the wrapping run the lap is for.
            const line = Math.floor(i / 7);
            const used = spent.get(line) || 0;
            if (used < SPARE_WORKED_DAYS) {
                // A spare duty is a SHIFT, so it must honour the same reset the worked branch does.
                // Omitting this line chained the run straight through a real 48h break and put the
                // bilingual roster at 23 against a true worst case of 15 — caught by walking the
                // roster by hand, because the wrong answer was still plausible.
                if (restRun >= 2) run = 0;
                spent.set(line, used + 1);
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
 * links-design.js (v19.79) so there is ONE reading of what a spare week costs a person.
 *
 * It used to count a spare week as seven worked days, which fused the blocks either side of it:
 * the live main roster reported 15 against a true ceiling of 9. Kept as a named export because it
 * is this module's vocabulary, but it must never grow its own copy of the rule again — the two
 * checks disagreeing about the same roster is exactly the failure `endMinutesAbs` was extracted to
 * end.
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
 * CIRCULAR, like every other rule here. The first version scanned index 0 → n and so cut any block
 * straddling the rotation's wrap point in half: two earlies on the last day of line 28 and the first
 * day of line 1, followed by a single rest day, became two blocks of one and were reported as
 * nothing at all. The rotation has no start — the person on line 28 goes to line 1 next week — so
 * the scan begins at the first NON-early day and laps once from there.
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
 * Maximum hours worked in any rolling 7-day window.
 *
 * FLOOR, not an estimate: SPARE contributes zero because it carries no times. MRSF's threshold is
 * 55h in a 7-day period.
 * @param {Array<{shift:any}>} seq
 */
export function maxHoursInAny7Days(seq) {
    const n = seq.length;
    if (!n) return 0;
    let best = 0;
    for (let i = 0; i < n; i++) {
        let mins = 0;
        for (let k = 0; k < 7; k++) mins += dutyMinutes(seq[(i + k) % n].shift) ?? 0;
        if (mins > best) best = mins;
    }
    return Math.round((best / 60) * 10) / 10;
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
 * INTERPRETATION, NOT SETTLED: counted as steps within a working block where the next duty starts
 * EARLIER than the one before it. A forward-rotating pattern moves later through the week, which is
 * the principle the generator already encodes. Reported as a count of backward steps against forward
 * steps, so the pattern's overall direction is visible rather than asserted. **Confirm whether the
 * factor is about individual steps or the cycle's net direction.**
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
 * Assess a design against the p3 fatigue factors.
 *
 * @param {Object} patterns - { "1".."N": { sun..sat } }
 * @param {number} [lines=ROTATING_LINES]
 * @returns {{results: FatigueResult[], present: number, standing: number, confirmNeeded: number, hoursAreFloor: boolean}}
 */
export function assessFatigue(patterns, lines = ROTATING_LINES) {
    const seq = toSequence(patterns, lines);
    const timed = seq.filter(x => startMinutes(x.shift) !== null);

    /** @type {FatigueResult[]} */
    const results = [];
    const add = (/** @type {FatigueResult} */ r) => results.push(r);

    // ── Time of day ──────────────────────────────────────────────────────────
    const nights = seq.filter(x => coversNightWindow(x.shift));
    add({ code: 'FF1', family: 'Time of day', title: 'Night shift covering 00:00–05:00',
        status: nights.length ? 'present' : 'n/a',
        value: nights.length,
        detail: nights.length
            ? `${nights.length} duty(s) reach into 00:00–05:00 — CEAs do not work nights, so this needs checking`
            : 'No duty reaches into 00:00–05:00. CEAs do not work nights.' });

    const earlies = seq.filter(x => isEarlyStart(x.shift));
    add({ code: 'FF2', family: 'Time of day', title: 'Early shift starting 05:00–07:00',
        status: earlies.length ? 'standing' : 'clear',
        value: earlies.length,
        detail: earlies.length
            ? `${earlies.length} of ${timed.length} timed duties. Unavoidable on this link — the day starts at 06:20 — so this is a property of the operation, not of the design.`
            : 'No duty starts between 05:00 and 07:00.' });

    const veryEarly = seq.filter(x => isVeryEarlyStart(x.shift));
    add({ code: 'FF3', family: 'Time of day', title: 'Very early shift starting before 05:00',
        status: veryEarly.length ? 'present' : 'clear', value: veryEarly.length });

    // ── Duty length ──────────────────────────────────────────────────────────
    // NOT APPLICABLE and CLEAR are different answers, and conflating them is the false-assurance
    // failure in miniature: with a very early duty present but none over 8h, the first version said
    // "not applicable" — directly contradicting the FF3 row two lines above, which had just counted
    // those same duties. The reassuring label was the wrong one.
    const veryEarlyOver8 = veryEarly.filter(x => (dutyMinutes(x.shift) ?? 0) > 8 * 60);
    add({ code: 'FF4', family: 'Duty length', title: 'Very early shift (before 05:00) over 8h', threshold: '8h',
        status: veryEarlyOver8.length ? 'present' : (veryEarly.length ? 'clear' : 'n/a'),
        value: veryEarly.length ? veryEarlyOver8.length : undefined,
        detail: veryEarly.length
            ? `${veryEarly.length} duty(s) start before 05:00; ${veryEarlyOver8.length} of them run over 8h.`
            : 'No duty starts before 05:00.' });

    const over12 = seq.filter(x => (dutyMinutes(x.shift) ?? 0) > 12 * 60);
    add({ code: 'FF5', family: 'Duty length', title: 'Day shift over 12h', threshold: '12h',
        status: over12.length ? 'present' : 'clear', value: over12.length });

    const earlyOver10 = seq.filter(x => isEarlyStart(x.shift) && (dutyMinutes(x.shift) ?? 0) > 10 * 60);
    add({ code: 'FF7', family: 'Duty length', title: 'Early shift over 10h', threshold: '10h',
        status: earlyOver10.length ? 'present' : 'clear', value: earlyOver10.length });

    // ── Recovery time ────────────────────────────────────────────────────────
    const ff8b = earlyBlocksWithShortRecovery(seq);
    add({ code: 'FF8b', family: 'Recovery time', title: 'Fewer than 2 days rest after a block of early starts',
        status: ff8b.length ? 'present' : 'clear', value: ff8b.length, threshold: '2 days',
        detail: ff8b.length
            ? `Worst: a block of ${Math.max(...ff8b.map(b => b.blockLength))} early starts followed by ${Math.min(...ff8b.map(b => b.restDays))} rest day(s).`
            : 'Every block of 2+ consecutive early starts is followed by at least 2 rest days.' });

    const ff11 = longestRunBetween48hBreaks(seq);
    add({ code: 'FF11', family: 'Recovery time', title: 'More than 13 consecutive shifts without a 48h break',
        status: ff11 > 13 ? 'present' : 'clear', value: ff11, threshold: 13,
        detail: `Longest run between 48-hour breaks is ${ff11} shifts. A single rest day is not a 48h break, so it does not reset this count.`
            + (seq.some(x => x.shift === 'SPARE')
                ? ` A spare week is 4 duties of 7, and its rest days need not fall together — so in the worst case it adds 4 shifts and no break.`
                : '') });

    // ── Cumulative ───────────────────────────────────────────────────────────
    const ff10 = longestRunOf(seq, s => (dutyMinutes(s) ?? 0) > 12 * 60);
    add({ code: 'FF10', family: 'Cumulative', title: 'More than 4 consecutive 12h day shifts',
        status: ff10 > 4 ? 'present' : 'clear', value: ff10, threshold: 4 });

    const ff15 = longestRunOf(seq, isEarlyStart);
    add({ code: 'FF15', family: 'Cumulative', title: 'More than 4 consecutive early shifts in a rotating pattern',
        status: ff15 > 4 ? 'present' : 'clear', value: ff15, threshold: 4 });

    const consec = longestWorkedRun(seq);
    add({ code: 'MRSF', family: 'Cumulative', title: 'More than 12 consecutive day shifts',
        status: consec > 12 ? 'present' : 'clear', value: consec, threshold: 12 });

    const hrs = maxHoursInAny7Days(seq);
    add({ code: 'MRSF', family: 'Cumulative', title: 'More than 55 hours worked in any 7-day period',
        status: hrs > 55 ? 'present' : 'clear', value: hrs, threshold: 55,
        detail: 'Spare days carry no times and count as zero hours, so this figure is a floor — the real total is higher.' });

    // ── THE TWO ROWS THAT WERE MISSING (v21.97) ─────────────────────────────
    // Added when the ORR source was read for the first time. It carries FOUR MRSF rows in this
    // family; this module implemented two. See the header — neither 23 nor 24 was the right count.

    // "More than 7 consecutive 8h shifts". The tightest consecutive-working rule on the page and
    // the one most likely to bite THIS link, whose duties are around eight hours: FF11 allows 13
    // shifts between 48h breaks, and this allows 7. It is marked `confirm` because "8h shifts" has
    // more than one defensible reading and the choice changes what fires.
    //
    // Read here as EIGHT HOURS OR MORE, which is the direction that reports rather than the one
    // that stays quiet — a nine-hour duty is not less fatiguing than an eight-hour one, and this
    // module's stated failure mode is false assurance, not noise. The alternatives are "about 8h"
    // (a band nobody has drawn) and "exactly 8h" (which would exclude most of this link and make
    // the row silent on the designs it exists for).
    const eightPlus = longestRunOf(seq, s => (dutyMinutes(s) ?? 0) >= 8 * 60);
    add({ code: 'MRSF', family: 'Cumulative', title: 'More than 7 consecutive 8h shifts', confirm: true,
        status: eightPlus > 7 ? 'present' : 'clear', value: eightPlus, threshold: 7,
        detail: `Longest run of duties of 8 hours or more is ${eightPlus}. Read as eight hours OR MORE; `
            + 'confirm whether the guidance means that, a band around 8h, or exactly 8h — the reading changes what this reports. '
            + 'Spare days carry no times, so they break a run here rather than extending it, which makes this figure a floor.' });

    // "More than 6 consecutive night or early shifts in a permanent pattern". NOT APPLICABLE to a
    // link, and it renders saying so rather than being left out. A link is a rotating pattern by
    // construction — everyone moves one line a week — so the permanent-pattern rule cannot apply,
    // and FF15 above is its rotating counterpart at a threshold of 4. Omitting it would leave the
    // panel quietly two rows short of the source it cites, which is how the count went wrong in
    // the first place; the module's own rule is that not-applicable, clear and standing are three
    // different answers and none of them is silence.
    add({ code: 'MRSF', family: 'Cumulative', title: 'More than 6 consecutive night or early shifts in a permanent pattern',
        status: 'n/a', value: 'rotating pattern',
        detail: 'This link is a rotating pattern, so the permanent-pattern rule does not apply. '
            + 'FF15 above is the rotating equivalent, and its threshold is lower (4).' });

    // ── Circadian phase shift — both readings unsettled ──────────────────────
    const rot = rotationDirection(seq);
    add({ code: 'FF17', family: 'Circadian', title: 'Backward rotating pattern', confirm: true,
        status: rot.backward > rot.forward ? 'present' : 'clear',
        value: `${rot.backward} backward / ${rot.forward} forward`,
        detail: 'Counted as steps within a working block where the next duty starts earlier. Confirm whether the factor means individual steps or the cycle’s net direction.' });

    // FF18 — THE CADENCE IS STANDING, THE STEP IS THE DESIGN CHOICE (v19.69).
    //
    // This row reported a HARDCODED `standing` from v19.46 to v19.68, which broke this module's own
    // "never hardcode a status" rule for the second time (FF13 was the first, v19.48). It was
    // written when the plan read the factor as being about the weekly CADENCE — and since a link
    // moves everyone one line a week by construction, that reading makes every design identical and
    // the row informationless.
    //
    // The owner corrected that reading (Aug 2026): the concern FF18 names is the SIZE OF THE STEP.
    // A rotation whose consecutive lines sit close together asks far less of the body clock than one
    // where they do not. The cadence is fixed; the step is a real design choice — and since v19.58
    // it is measurable, by the same `scoreOrder` the generator's line-order switches optimise.
    //
    // So the row now reports THIS design: the typical week-to-week move, the worst one, and how many
    // of the boundaries exceed two hours.
    //
    // WHY THE STATUS STAYS `standing` WHEN IT IS MEASURABLE, rather than turning `present` above
    // some figure: the ORR gives no threshold for FF18, and inventing one would be exactly the
    // pass/fail rendering this panel must never produce. A weekly rotation IS present in every link,
    // unavoidably, which is what `standing` means. The measurement belongs in the value, where it
    // informs without pretending to adjudicate. The derived branch is REAL: a design with no timed
    // lines at all (every line SPARE) has no measurable step, and a row that cannot be computed does
    // not get to claim anything — that is `n/a`, and it is what the FF13 lesson was about.
    //
    // The 2h figure is not invented either: it is the ORR's own FF19 threshold, and the week
    // boundary is precisely the "across rest days" reading FF19's own detail flags as unconfirmed.
    // Hence `confirm: true` stays on this row.
    const ff18Order = Object.keys(patterns || {}).sort((a, b) => Number(a) - Number(b));
    const adj = scoreOrder(patterns, ff18Order);
    // Measurable iff at least one BOUNDARY actually produced a step. Derived from the boundaries
    // walked, never from `lines`: `scoreOrder` iterates the keys the design really has, while
    // `lines` is what the caller CLAIMS it has, and those differ in the ordinary case of a design
    // that is not fully filled in. The first version tested `adj.unmeasurable < lines`, so an EMPTY
    // design (0 keys, 0 unmeasurable, 28 claimed) passed as measurable and reported "typically
    // 0h 0m a week" — a confident figure about a design with no shifts in it, which is precisely
    // the flattery this module exists to prevent. Found by the v19.70 regression pass, not by the
    // v19.69 tests, because those all passed `lines` equal to the key count.
    const stepMeasurable = ff18Order.length - adj.unmeasurable > 0;
    add({ code: 'FF18', family: 'Circadian', title: 'Rotating pattern of about a week', confirm: true,
        status: stepMeasurable ? 'standing' : 'n/a',
        value: stepMeasurable
            ? `${lines}-line rotation · typically ${_hm(adj.gentleMean)} a week`
            : `${lines}-line rotation`,
        // Both the chip and the sentence read the SAME constant `scoreOrder` counted against, so the
        // stated threshold cannot drift from the one actually applied.
        threshold: stepMeasurable ? `${GENTLE_THRESHOLD_MINUTES / 60}h` : undefined,
        detail: stepMeasurable
            ? `A link moves every person one line per week by construction, so the weekly cadence itself is unavoidable — what a design controls is how far the working day moves at each step. Here the typical move is ${_hm(adj.gentleMean)}, the largest is ${_hm(adj.gentleWorst)}, and ${adj.gentleOver} of ${lines} line boundaries move by more than ${GENTLE_THRESHOLD_MINUTES / 60} hours.${adj.unmeasurable ? ` ${adj.unmeasurable} boundaries carry no times (spare weeks) and are excluded rather than counted as no change.` : ''} Settle the reading with the assessing manager: on the cadence alone no design can avoid this factor.`
            : `No line carries a start time, so the week-to-week step cannot be measured. The ${lines}-line weekly cadence still applies.` });

    const jumps = startTimeJumps(seq);
    add({ code: 'FF19', family: 'Circadian', title: 'Successive start times varying by more than 2 hours', confirm: true,
        status: jumps.length ? 'present' : 'clear', value: jumps.length, threshold: '2h',
        detail: 'Counted only within a block of consecutive working days — a rest day is treated as time to adjust. Confirm whether the stricter reading (across rest days) applies.' });

    // ── Night-shift factors that cannot apply to a link with no nights ───────
    for (const [code, title] of [
        ['FF6',  'Night shift over 10h'], ['FF8', 'Less than 2 days rest after consecutive nights'],
        ['FF9',  'Less than 14h rest in any 24h for night shifts'], ['FF12', 'Only one day rest after night shifts'],
        ['FF14', 'More than 4 consecutive nights in a rotating pattern'],
        ['FF16', 'More than 3 consecutive night shifts over 8h'], ['FF20', 'First night shift'],
    ]) {
        // FAMILY IS 'Night shifts', not 'Night (not applicable)' (v19.52). The family names a group;
        // whether it APPLIES is per-row `status` and changes with the design. Baking the verdict into
        // the group name meant the UI, which renders the family as a heading, printed
        // "Night (not applicable)" above seven rows that had all just turned `present` — an
        // all-clear headline over the exact state this family exists to make loud.
        add({ code, family: 'Night shifts', title,
            status: nights.length ? 'present' : 'n/a',
            detail: nights.length ? 'A night duty is present, so this factor now needs assessing.' : undefined });
    }

    // FF13 IS the short-turnaround check, so the rule is read from runDesignChecks rather than
    // reimplemented — the two must never disagree about the same design.
    //
    // The status was hardcoded `clear` for one version, which is worse than the silence this module's
    // header warns about: a design with a 6h25m turnaround showed the short-turnaround check in amber
    // and, directly beneath it, FF13 with a GREEN TICK. An affirmative all-clear on a factor that is
    // present. Never hardcode a status here — if a factor cannot be computed, it does not get a tick.
    const ff13 = runDesignChecks(patterns, lines).turnarounds;
    const worst = ff13.length ? Math.min(...ff13.map(t => t.restMinutes)) : null;
    add({ code: 'FF13', family: 'Intervals between duties', title: 'Less than 12h rest in any 24h',
        status: ff13.length ? 'present' : 'clear', value: ff13.length, threshold: `${MIN_REST_MINUTES / 60}h`,
        detail: ff13.length
            ? `Shortest rest between consecutive duties is ${_hm(/** @type {number} */(worst))}. Same finding as the short-turnaround check above — one rule, reported twice.`
            : 'Every pair of consecutive duties has at least 12 hours between them. Same rule as the short-turnaround check above.' });

    return {
        results,
        present: results.filter(r => r.status === 'present').length,
        // Counted SEPARATELY from `present`, never added to it: a standing characteristic of the
        // operation (every 06:20 duty is an FF2 early) is not a finding about this design, and one
        // combined total would say that it was.
        standing: results.filter(r => r.status === 'standing').length,
        confirmNeeded: results.filter(r => r.confirm).length,
        hoursAreFloor: true,
    };
}
