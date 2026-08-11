// @ts-check
/**
 * overtime-format.js — the PURE client side of Overtime: how a window, a phase and a day's answer
 * are put into words, and the one piece of arithmetic the browser is allowed to do about time.
 *
 * No DOM, no Firebase, no imports — so every branch is reachable from a Node test.
 *
 * ── THE CLIENT CLOCK IS PRESENTATIONAL, AND THAT IS THE WHOLE POINT OF `clockOffset` ────────────
 *
 * The server decides whether a submission is in time; nothing here can change that. But the page
 * still has to SAY whether a form is open, and it can only do that from the device clock — which
 * on a staff phone can be minutes out. So `getMyOvertimeState` returns `serverNow`, and this module
 * turns it into an offset that corrects every later reading.
 *
 * Two rules that are easy to get wrong and expensive to get wrong:
 *
 *  1. **Subtract the round trip.** A naive `serverNow - Date.now()` folds the whole request time
 *     into the offset. On a platform with poor signal that is seconds, and this feature turns on a
 *     12:00 boundary.
 *  2. **Never let the client refuse.** `submitDisposition` returns `'closed'` only when the
 *     corrected clock is past the deadline by MORE than the grace band. Inside it the answer is
 *     `'check-with-server'`: send the request and let the server decide. A client that refuses has
 *     denied somebody who was in time, and they have no recourse — where a server rejection at
 *     least produces a true message.
 */

/**
 * How far past a deadline the corrected clock may read before the client stops offering Submit.
 *
 * Fifteen minutes, and the number is a budget for three things at once: device clock skew (the
 * largest by far — an unsynced phone can be minutes out), the round trip this module already
 * corrects for, and the time a member spends filling the form after the page last refreshed its
 * offset. Being wrong in this direction costs one rejected request; being wrong the other way
 * costs somebody their availability for a week.
 */
export const SUBMIT_GRACE_MS = 15 * 60 * 1000;

/**
 * How close to a deadline the page should re-ask the server for authoritative state.
 *
 * Distinct from the grace band on purpose: this one is about keeping the page HONEST while it sits
 * open (a member who opened the form at 11:50 must not still be told "open" at 12:05), and it is
 * deliberately shorter, so the refresh happens before the boundary rather than after it.
 */
export const DEADLINE_SYNC_WINDOW_MS = 5 * 60 * 1000;

/**
 * Server-minus-client offset in ms, with the round trip removed.
 *
 * @param {number} serverNow  the instant the server reported
 * @param {number} tSend      Date.now() immediately before the request
 * @param {number} tReceive   Date.now() immediately after the response
 * @returns {number} add this to `Date.now()` to get corrected server time
 */
export function clockOffset(serverNow, tSend, tReceive) {
    const rtt = Math.max(0, tReceive - tSend);
    // The server generated `serverNow` somewhere inside the round trip; the midpoint is the least
    // wrong assumption available without a second exchange.
    return (serverNow + rtt / 2) - tReceive;
}

/**
 * What the SUBMIT control should do, given the corrected clock.
 *
 * @param {number} correctedNow
 * @param {number} finalDeadlineAt
 * @returns {'open'|'check-with-server'|'closed'}
 */
export function submitDisposition(correctedNow, finalDeadlineAt) {
    if (correctedNow < finalDeadlineAt) return 'open';
    if (correctedNow < finalDeadlineAt + SUBMIT_GRACE_MS) return 'check-with-server';
    return 'closed';
}

/**
 * True when a deadline is close enough that the page should re-read authoritative state.
 * @param {number} correctedNow
 * @param {number[]} deadlines
 */
export function shouldResyncClock(correctedNow, deadlines) {
    return (deadlines || []).some(d =>
        correctedNow > d - DEADLINE_SYNC_WINDOW_MS && correctedNow < d + DEADLINE_SYNC_WINDOW_MS);
}

// ── Words ───────────────────────────────────────────────────────────────────────────────────────

const DAY_NAMES   = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Parse "YYYY-MM-DD" into its parts without going near a timezone.
 * @param {string} iso
 */
function parts(iso) {
    const [y, m, d] = String(iso).split('-').map(Number);
    return { y, m, d, dow: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}

/**
 * "Sat 5 Sep" — the compact form used in rows and chips.
 * @param {string} iso
 */
export function shortDate(iso) {
    const p = parts(iso);
    return `${DAY_NAMES[p.dow].slice(0, 3)} ${p.d} ${MONTH_SHORT[p.m - 1]}`;
}

/**
 * "Saturday 5 September 2026" — the full form used in headings.
 * @param {string} iso
 */
export function longDate(iso) {
    const p = parts(iso);
    const month = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
        'August', 'September', 'October', 'November', 'December'][p.m - 1];
    return `${DAY_NAMES[p.dow]} ${p.d} ${month} ${p.y}`;
}

/**
 * "Week ending Saturday 5 September 2026" — how staff name a roster week, in full.
 * @param {string} weekEnding
 */
export function weekLabel(weekEnding) {
    return `Week ending ${longDate(weekEnding)}`;
}

/**
 * "Sun 30 Aug – Sat 5 Sep" — the roster week as a span.
 * @param {string} weekStart
 * @param {string} weekEnding
 */
export function weekSpan(weekStart, weekEnding) {
    return `${shortDate(weekStart)} – ${shortDate(weekEnding)}`;
}

/**
 * A deadline instant, in London wall-clock words: "Tue 18 Aug · 12:00".
 *
 * Formatted through `Intl` in Europe/London rather than the device's own zone, so a phone left on
 * holiday time still shows staff the deadline the roster office means.
 * @param {number} ms
 */
export function deadlineLabel(ms) {
    if (!ms) return '';
    const d = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short',
    }).format(new Date(ms));
    const t = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).format(new Date(ms));
    return `${d} · ${t}`;
}

/**
 * Staff-facing copy for a submission phase. Calm and factual — never a countdown.
 * @param {string} phase
 */
export function phaseCopy(phase) {
    if (phase === 'INITIAL_OPEN') return 'Open — your answers go to the draft roster';
    if (phase === 'FINAL_OPEN')   return 'Open — the draft roster has been planned';
    return 'Closed';
}

/**
 * The Manager row's words for a planning week.
 *
 * `missed` is deliberately blunt. A week whose final deadline went by with no window is not a
 * neutral state to be phrased around: nobody was asked, and the row has to say so plainly enough
 * that it is not read as "nobody was needed".
 * @param {string} state
 * @returns {{ label: string, tone: 'ok'|'warn'|'bad' }}
 */
export function rowStateCopy(state) {
    switch (state) {
        case 'created':                    return { label: 'Created',      tone: 'ok'   };
        case 'not-created':                return { label: 'Not created',  tone: 'warn' };
        case 'not-created-initial-passed': return { label: 'Not created · initial deadline passed', tone: 'bad' };
        default:                           return { label: 'Missed · no availability window was created', tone: 'bad' };
    }
}

/**
 * "1 of 1 received · 0 no response" — and the second clause is never dropped.
 *
 * NO RESPONSE IS NOT "UNAVAILABLE". A member who submitted seven unavailable days HAS responded and
 * counts in `received`; a member who submitted nothing is unknown. Collapsing the two would let a
 * clerk read silence as a decision, which is the one misreading this feature exists to prevent.
 * @param {number} expected
 * @param {number} received
 */
export function countsCopy(expected, received) {
    const noResponse = Math.max(0, expected - received);
    const forms = expected === 1 ? 'form' : 'forms';
    return `${received} of ${expected} ${forms} received · ${noResponse} no response`;
}

/**
 * One day's stored answer, in words. The inverse of what the form writes.
 * @param {any} day
 */
export function answerCopy(day) {
    if (!day || typeof day !== 'object') return 'Not answered';
    switch (day.mode) {
        case 'unavailable':  return 'Not available';
        case 'all_day':      return 'Available all day';
        case 'before':       return `Available before ${day.until}`;
        case 'after':        return `Available after ${day.from}`;
        case 'before_after': return `Available before ${day.until} and after ${day.from}`;
        case 'custom':       return day.nextDay
            ? `Available ${day.start}–${day.end} next day`
            : `Available ${day.start}–${day.end}`;
        default:             return 'Not answered';
    }
}

/**
 * True when a stored answer means the member offered nothing at all that day.
 * @param {any} day
 */
export function isUnavailable(day) {
    return !!day && day.mode === 'unavailable';
}

/**
 * A one-line summary of a whole week's answers, for a list row.
 * Counts rather than enumerates: seven answers do not fit on a phone row, and "available on 3 days"
 * is what a person actually wants from a summary.
 * @param {Record<string, any>} days
 */
export function weekSummary(days) {
    const values = Object.values(days || {});
    if (!values.length) return 'No answers';
    const available = values.filter(d => d && d.mode && d.mode !== 'unavailable').length;
    if (available === 0) return 'Not available on any day';
    if (available === values.length) return 'Available on every day';
    return `Available on ${available} of ${values.length} days`;
}
