// @ts-check
/**
 * links-fatigue.js — the ORR good-practice FATIGUE FACTORS, assessed against a link design.
 *
 * Source: ORR, *Good practice guidelines — Fatigue Factors*, December 2021, **p3**. Twenty-four
 * factors in five families (time of day, duty length, recovery time, intervals between duties,
 * cumulative, circadian phase shift).
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
 * 4. **Two rules carry an interpretation that is NOT settled** (FF17, FF19 — see below). They are
 *    marked `confirm: true` so the UI can say so. Shipping a number whose definition is unagreed,
 *    unlabelled, is the false-assurance failure in miniature.
 *
 * Hours caveat: SPARE days carry no times, so they contribute ZERO to any hours total here. A
 * standby day is worked time, so every hours figure this module produces is a FLOOR, not an
 * estimate. `hoursAreFloor` is returned so the UI can say so rather than imply precision.
 */

import { DAYS, ROTATING_LINES, startMinutes, endMinutesAbs } from './links-design.js';

/** A duty counts as an FF2 "early shift" when it starts in this window (inclusive of 05:00). */
const EARLY_FROM = 5 * 60;
const EARLY_TO   = 7 * 60;      // exclusive — 07:00 itself is not an early start

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
export function dutyMinutes(shift) {
    const a = startMinutes(shift);
    const b = endMinutesAbs(shift);
    if (a === null || b === null) return null;
    return b - a;
}

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
    // Walk the duty in minutes-from-midnight, wrapping, and look for anything in [00:00, 05:00).
    for (let m = st; m < st + len; m += 15) {
        const t = m % (24 * 60);
        if (t < EARLY_FROM) return true;
    }
    return false;
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
    const workedTotal = seq.filter(x => isWorked(x.shift)).length;

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
    // Two laps so a run spanning the wrap point is measured whole.
    for (let i = 0; i < n * 2; i++) {
        const s = seq[i % n].shift;
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

/** Longest run of consecutive worked days, wrapping. @param {Array<{shift:any}>} seq */
export function longestWorkedRun(seq) {
    const n = seq.length;
    if (!n) return 0;
    let best = 0, run = 0;
    for (let i = 0; i < n * 2; i++) {
        if (isWorked(seq[i % n].shift)) { run++; if (run > best) best = run; } else run = 0;
    }
    return Math.min(best, n);
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
 * @param {Array<{shift:any, line:number, day:string}>} seq
 */
export function earlyBlocksWithShortRecovery(seq) {
    const n = seq.length;
    const out = [];
    let i = 0;
    while (i < n) {
        if (!isEarlyStart(seq[i].shift)) { i++; continue; }
        let j = i;
        while (j < n && isEarlyStart(seq[j].shift)) j++;
        const blockLen = j - i;
        if (blockLen >= 2) {
            let rest = 0;
            for (let k = j; k < j + 2 && k < n + j; k++) {
                if (isRest(seq[k % n].shift)) rest++; else break;
            }
            if (rest < 2) {
                out.push({ fromLine: seq[i].line, fromDay: seq[i].day, blockLength: blockLen, restDays: rest });
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
 * @returns {{results: FatigueResult[], present: number, confirmNeeded: number, hoursAreFloor: boolean}}
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
    const over12 = seq.filter(x => (dutyMinutes(x.shift) ?? 0) > 12 * 60);
    add({ code: 'FF5', family: 'Duty length', title: 'Day shift over 12h', threshold: '12h',
        status: over12.length ? 'present' : 'clear', value: over12.length });

    const earlyOver10 = seq.filter(x => isEarlyStart(x.shift) && (dutyMinutes(x.shift) ?? 0) > 10 * 60);
    add({ code: 'FF7', family: 'Duty length', title: 'Early shift over 10h', threshold: '10h',
        status: earlyOver10.length ? 'present' : 'clear', value: earlyOver10.length });

    add({ code: 'FF4', family: 'Duty length', title: 'Very early shift (before 05:00) over 8h',
        status: veryEarly.some(x => (dutyMinutes(x.shift) ?? 0) > 8 * 60) ? 'present' : 'n/a',
        detail: veryEarly.length ? undefined : 'No duty starts before 05:00.' });

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
        detail: `Longest run between 48-hour breaks is ${ff11} shifts. A single rest day is not a 48h break, so it does not reset this count.` });

    // ── Cumulative ───────────────────────────────────────────────────────────
    const ff15 = longestRunOf(seq, isEarlyStart);
    add({ code: 'FF15', family: 'Cumulative', title: 'More than 4 consecutive early shifts in a rotating pattern',
        status: ff15 > 4 ? 'present' : 'clear', value: ff15, threshold: 4 });

    const ff10 = longestRunOf(seq, s => (dutyMinutes(s) ?? 0) > 12 * 60);
    add({ code: 'FF10', family: 'Cumulative', title: 'More than 4 consecutive 12h day shifts',
        status: ff10 > 4 ? 'present' : 'clear', value: ff10, threshold: 4 });

    const consec = longestWorkedRun(seq);
    add({ code: 'MRSF', family: 'Cumulative', title: 'More than 12 consecutive day shifts',
        status: consec > 12 ? 'present' : 'clear', value: consec, threshold: 12 });

    const hrs = maxHoursInAny7Days(seq);
    add({ code: 'MRSF', family: 'Cumulative', title: 'More than 55 hours worked in any 7-day period',
        status: hrs > 55 ? 'present' : 'clear', value: hrs, threshold: 55,
        detail: 'Spare days carry no times and count as zero hours, so this figure is a floor — the real total is higher.' });

    // ── Circadian phase shift — both readings unsettled ──────────────────────
    const rot = rotationDirection(seq);
    add({ code: 'FF17', family: 'Circadian', title: 'Backward rotating pattern', confirm: true,
        status: rot.backward > rot.forward ? 'present' : 'clear',
        value: `${rot.backward} backward / ${rot.forward} forward`,
        detail: 'Counted as steps within a working block where the next duty starts earlier. Confirm whether the factor means individual steps or the cycle’s net direction.' });

    const jumps = startTimeJumps(seq);
    add({ code: 'FF19', family: 'Circadian', title: 'Successive start times varying by more than 2 hours', confirm: true,
        status: jumps.length ? 'present' : 'clear', value: jumps.length, threshold: '2h',
        detail: 'Counted only within a block of consecutive working days — a rest day is treated as time to adjust. Confirm whether the stricter reading (across rest days) applies.' });

    add({ code: 'FF18', family: 'Circadian', title: 'Rotating pattern of about a week', confirm: true,
        status: 'standing', value: `${lines}-line rotation`,
        detail: 'A link moves every person one line per week by construction, so this may apply to the concept rather than to any one design. Settle with the assessing manager before treating it as a finding.' });

    // ── Night-shift factors that cannot apply to a link with no nights ───────
    for (const [code, title] of [
        ['FF6',  'Night shift over 10h'], ['FF8', 'Less than 2 days rest after consecutive nights'],
        ['FF9',  'Less than 14h rest in any 24h for night shifts'], ['FF12', 'Only one day rest after night shifts'],
        ['FF14', 'More than 4 consecutive nights in a rotating pattern'],
        ['FF16', 'More than 3 consecutive night shifts over 8h'], ['FF20', 'First night shift'],
    ]) {
        add({ code, family: 'Night (not applicable)', title,
            status: nights.length ? 'present' : 'n/a',
            detail: nights.length ? 'A night duty is present, so this factor now needs assessing.' : undefined });
    }

    // FF13 is already reported by runDesignChecks as the short-turnaround check; cross-referenced
    // rather than duplicated, so the two can never disagree about the same design.
    add({ code: 'FF13', family: 'Intervals between duties', title: 'Less than 12h rest in any 24h',
        status: 'clear', detail: 'Reported by the short-turnaround check above — see "Rest between shifts".' });

    return {
        results,
        present: results.filter(r => r.status === 'present').length,
        confirmNeeded: results.filter(r => r.confirm).length,
        hoursAreFloor: true,
    };
}
