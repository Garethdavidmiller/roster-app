// @ts-check
/**
 * team-overlap.js — "Who's on with me?": which colleagues' duties overlap one member's shift, and for
 * how long. Pure: no DOM, no Firestore, no clock. Team Week View (calendar-team-view.js) resolves every
 * shift through the shared ladder and hands this module the TIMES; this module only does the arithmetic.
 *
 * Owns: reading 'HH:MM-HH:MM' as a span of minutes, the overlap of two spans, and the order the card lists
 *   colleagues in.
 * Does NOT own: which shift a member is on (`resolveDayShift` / `getBaseShift`, via Team View), who counts as
 *   a colleague (Team View's filter), or any words on screen.
 *
 * THE RULES, each with the case that makes it necessary (owner, 27 Nov 2026: "if I work 14:00–22:30 and
 * someone else works 06:00–15:00, show 'Together 14:00–15:00'"):
 *
 *   1. A SHIFT THAT ENDS AT OR BEFORE ITS START RUNS INTO THE NEXT DAY. 22:00-06:00 is eight hours ending at
 *      06:00 tomorrow, not a negative span. It is measured from its own day's midnight, so its end is past
 *      1440 minutes.
 *   2. A COLLEAGUE'S OVERNIGHT SHIFT FROM THE DAY BEFORE IS STILL ON IN THE MORNING. Somebody on 22:00-06:00
 *      on Thursday is at work with a Friday 05:00 early for an hour, and that duty is Thursday's, not
 *      Friday's — so the previous day's shift is read too, moved back by a day.
 *   3. THE MEMBER'S OWN OVERNIGHT SHIFT MEETS TOMORROW'S EARLIES. A Friday 21:00-05:00 overlaps a Saturday
 *      04:00 start, so the next day's shift is read too, moved on by a day — and the card says it is
 *      Saturday's.
 *   4. TOUCHING IS NOT OVERLAPPING. A 06:00-14:00 handing over to a 14:00-22:00 shares no minute: the spans
 *      are half-open, [start, end).
 *   5. LONGEST TOGETHER FIRST. The colleague you share most of the shift with is the one you are most
 *      likely looking for; a tie goes to whoever joins you first, then to the order the caller gave (names).
 *   6. A DAY'S TIMES ARE THE TIMES THE CALENDAR SHOWS FOR IT (`workedTimes`, through `hoursSlotTime` in
 *      override-utils.js — the cell's own rule, not a second one). A colleague on Training with no time of
 *      their own on a 06:00–14:00 day is on 06:00–14:00: the ladder carries the base shift's time in
 *      `rdwTime`, and the cell prints it. Reading the value alone called that colleague "not at the same
 *      time" beside a 07:00 start. The member's OWN day is read the same way (calendar-renderer.js), or
 *      their Training day would offer no "Who's on with me" at all.
 *   7. UNKNOWN TIMES ARE NEVER "NOT AT THE SAME TIME". A worked day with no times recorded — Rest Day
 *      Working with no time, a rest-day Other day ('RDW'), a Meeting with none — might overlap or might
 *      not, so it is its own group (`timesUnknown`), never `alsoWorking`, whose words are a claim.
 *
 * The rules 2 and 3 need no special case in the arithmetic: a previous-day shift that does not cross
 * midnight ends at or before 0 once moved back, and a next-day shift starts at or after 1440, so either can
 * only overlap a span that reaches across the same midnight. The tests pin each one, and a mutation of the
 * day offset fails them (team-overlap.test.mjs).
 */

import { SHIFT_TIME_REGEX } from './roster-data.js';
import { hoursSlotTime } from './override-utils.js';

/** Minutes in a day. */
export const DAY_MINUTES = 1440;

/**
 * A 'HH:MM-HH:MM' shift as minutes from its own day's midnight, half-open [start, end). A shift whose end
 * is at or before its start runs into the next day (rule 1), so its `end` is past `DAY_MINUTES`.
 * @param {string|null|undefined} time
 * @returns {{ start: number, end: number } | null}  null for anything that is not a shift time
 */
export function shiftSpan(time) {
    if (typeof time !== 'string' || !SHIFT_TIME_REGEX.test(time.trim())) return null;
    const [a, b] = time.trim().split('-');
    const mins = (/** @type {string} */ hm) => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };
    const start = mins(a);
    let end = mins(b);
    if (end <= start) end += DAY_MINUTES;
    return { start, end };
}

/**
 * The TIMES a resolved day is worked, or null when it is not a worked day with times. Takes the shared
 * ladder's answer (`resolveDayShift` → `{ shift, rdwTime }`), never a raw roster value, and reads it by
 * rule 6: the time the Calendar cell shows in its hours slot (`hoursSlotTime`), when that is a shift time.
 *   · a timed shift — its own value;
 *   · Rest Day Working — the time the change recorded (`rdwTime`); none recorded, no times;
 *   · an Other day (Training, Induction…) — its own time, or on a working day with none, the base shift's
 *     (the ladder puts either in `rdwTime`); a rest-day Other with no time ('RDW'), or a Meeting or Union
 *     day with none, has no times.
 * Rest, Spare, annual leave and an absence are never worked (`isWorkedShift`'s list), so never listed.
 * @param {{ shift: string, rdwTime?: string }} day
 * @returns {string|null}
 */
export function workedTimes({ shift, rdwTime }) {
    if (typeof shift !== 'string') return null;
    const time = hoursSlotTime(shift, rdwTime);
    return SHIFT_TIME_REGEX.test(time) ? time : null;
}

/** 'HH:MM' for a minute count, on the 24-hour clock whatever day it falls in.
 *  @param {number} minutes @returns {string} */
export function clockAt(minutes) {
    const m = ((minutes % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** A shift time written for reading: two-digit hours and an en dash — '6:00-14:00' → '06:00–14:00'.
 *  @param {string} time @returns {string} */
export function rangeText(time) {
    const span = shiftSpan(time);
    return span ? `${clockAt(span.start)}–${clockAt(span.end)}` : time;
}

/**
 * @template K
 * @typedef {{ key: K, prev?: string|null, day?: string|null, next?: string|null, worksDay?: boolean }} Colleague
 *   `prev`/`day`/`next` — the colleague's worked TIMES (`workedTimes`) on the day before, the day and the
 *   day after; `worksDay` — whether they are on a worked shift that day at all, times or not (rule 7).
 */
/**
 * @typedef {{ day: -1|0|1, time: string, from: string, to: string, minutes: number, at: number }} Together
 *   one stretch together: whose day the colleague's shift belongs to (−1 the day before, 0 the day, +1 the
 *   day after), that shift, and the shared stretch as clock times. `at` is its start in minutes from the
 *   day's midnight, for ordering.
 */

/**
 * WHO IS ON WITH a member whose shift is `mine`, from the colleagues given.
 * @template K
 * @param {string} mine  the member's TIMES that day ('HH:MM-HH:MM')
 * @param {Colleague<K>[]} colleagues  in the order a tie should keep (the caller sorts by name)
 * @returns {{ together: { key: K, minutes: number, spans: Together[] }[], alsoWorking: K[], timesUnknown: K[] }}
 *   `together` — every colleague who shares at least one minute, longest together first (rule 5);
 *   `alsoWorking` — the rest who are working that day at times that share no minute, in the order given;
 *   `timesUnknown` — the rest who are working that day with no times recorded, in the order given (rule 7).
 */
export function whoIsOnWith(mine, colleagues) {
    const me = shiftSpan(mine);
    if (!me) return { together: [], alsoWorking: [], timesUnknown: [] };
    /** @type {{ key: K, minutes: number, first: number, spans: Together[] }[]} */
    const together = [];
    /** @type {K[]} */
    const alsoWorking = [];
    /** @type {K[]} */
    const timesUnknown = [];
    for (const c of colleagues) {
        /** @type {Together[]} */
        const spans = [];
        for (const [day, time] of /** @type {[-1|0|1, string|null|undefined][]} */ ([[-1, c.prev], [0, c.day], [1, c.next]])) {
            const s = shiftSpan(time);
            if (!s || !time) continue;
            const offset = day * DAY_MINUTES;               // rules 2 and 3: a neighbouring day's shift, moved to this day's clock
            const from = Math.max(me.start, s.start + offset);
            const to   = Math.min(me.end,   s.end   + offset);
            if (to <= from) continue;                       // rule 4: touching ends share no minute
            spans.push({ day, time, from: clockAt(from), to: clockAt(to), minutes: to - from, at: from });
        }
        if (spans.length) {
            spans.sort((a, b) => a.at - b.at);
            together.push({ key: c.key, minutes: spans.reduce((n, s) => n + s.minutes, 0), first: spans[0].at, spans });
        } else if (c.worksDay) {
            (shiftSpan(c.day) ? alsoWorking : timesUnknown).push(c.key);   // rule 7
        }
    }
    // Rule 5. Array.prototype.sort is stable, so equal stretches keep the caller's (name) order.
    together.sort((a, b) => b.minutes - a.minutes || a.first - b.first);
    return { together: together.map(({ key, minutes, spans }) => ({ key, minutes, spans })), alsoWorking, timesUnknown };
}
