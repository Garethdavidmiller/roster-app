// @ts-check
/**
 * overtime-format.js — the PURE client side of Overtime: how a window, a phase and a day's answer
 * are put into words, and the one piece of arithmetic the browser is allowed to do about time.
 *
 * No DOM and no Firebase, so every branch is reachable from a Node test. Everything it imports is
 * pure and Node-loadable: `roster-data.js` (`getShiftBadge` — one roster chip on BOTH sides of the
 * feature), `date-format.js`, `overtime-phase.js`, `overtime-sunday-release.js` and
 * `overtime-clock.js`. The invariant this module keeps is Node-testability, not an
 * empty import list; do not add anything that breaks the former.
 *
 * ── THE CLIENT CLOCK IS PRESENTATIONAL, AND THAT IS THE WHOLE POINT OF `clockOffset` ────────────
 *
 * The server decides whether a submission is in time. The page still has to SAY whether a form is
 * open, from a device clock that can be minutes out, so `getMyOvertimeState` returns `serverNow`
 * and the offset corrects every later reading.
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

// WHERE THE WEEK STANDS lives in overtime-phase.js; re-exported here, and `deadlineLabel` imported
// for the words here that print a deadline.
import { deadlineLabel } from './overtime-phase.js';
export { deadlineLabel, phaseCopy, phaseChip, phaseTone, deadlineLines } from './overtime-phase.js';
import { getShiftBadge, formatISO, isSunday } from './roster-data.js';
import { releaseRequestLine } from './overtime-sunday-release.js';
import { printedStamp, londonDate, londonClock, MONTH_ABB, MONTH_NAMES, DAY_NAMES_FULL } from './date-format.js';

// THE CLOCK — the six decisions a member's own clock may make about a deadline — lives in
// overtime-clock.js, re-exported here. The rule all six obey (the client never refuses what the
// server would accept) is in its header.
export {
    SUBMIT_GRACE_MS, DEADLINE_SYNC_WINDOW_MS, clockOffset, submitDisposition, shouldResyncClock,
    canRestoreNow,
} from './overtime-clock.js';

/**
 * Has this day been ANSWERED, or merely started?
 *
 * A picked mode with nothing behind it (a custom row with one time typed) is not answered:
 * submitting it would put a half-declaration under somebody's name — the same wrong as pre-filling.
 *
 * `start === end` is unfinished rather than a 24-hour offer, for the reason `shiftSpanMinutes`
 * refuses the same pair below.
 *
 * @param {{ mode?: string, start?: string, end?: string }|null|undefined} answer
 * @returns {boolean}
 */
export function dayUnfinished(answer) {
    if (!answer || !answer.mode) return true;
    return answer.mode === 'custom' && (!answer.start || !answer.end || answer.start === answer.end);
}

/**
 * Which of a window's dates are still unanswered, IN WINDOW ORDER.
 *
 * One list answers both questions the form asks — how many are outstanding, and which one an error
 * should walk to — so the count can never disagree with the day it points at.
 *
 * @param {Record<string, any>} answers
 * @param {string[]} dates the window's dates, in order
 * @returns {string[]}
 */
export function unfinishedDates(answers, dates) {
    return dates.filter(d => dayUnfinished(answers?.[d]));
}

/**
 * What a re-read after a TIMED-OUT submission can actually establish.
 *
 * FOUR outcomes, and the last two are the point. `AbortController` stops us waiting; it does not
 * stop the server writing — so when the re-read itself fails there is no honest answer, and
 * reporting "it did not save" invites a second, contradictory submission.
 *
 * `gone`: a member WITHDRAWN from the week between a timed-out submission and its re-read no longer
 * sees the window, so our mutation id cannot be found — that is not "it didn't reach the server".
 *
 * `not-saved` therefore means what it says: **the week is still ours and our answer is not in it.**
 *
 * A `saved` verdict requires OUR mutation id, never merely the presence of a submission: every
 * device a member owns shares one Firebase uid, so a submission from their other tab is
 * indistinguishable from ours by anything else.
 *
 * @param {boolean} stateOk did the re-read succeed at all?
 * @param {{ lastMutationId?: string }|null|undefined} freshSubmission the re-read submission for this week
 * @param {string|null} pendingMutationId the id of the submission whose response we never saw
 * @param {boolean} [windowPresent=true] did the re-read still return this week to this member?
 * @returns {'saved'|'not-saved'|'unknown'|'gone'}
 */
export function reconcileVerdict(stateOk, freshSubmission, pendingMutationId, windowPresent = true) {
    if (!stateOk) return 'unknown';
    if (!windowPresent) return 'gone';
    const last = freshSubmission?.lastMutationId;
    return last && last === pendingMutationId ? 'saved' : 'not-saved';
}

/**
 * Did a WRITE end without saying whether it happened? A timeout, a cut-off answer, or an error the
 * server did not name (`http-5xx` — a function out of time answers so) may each have been written, so
 * only a re-read can tell — never "it failed". Every Overtime write asks this.
 * @param {{ ok: boolean, code?: string, status?: number }} r
 */
export const writeOutcomeUnknown = (r) => !r.ok && (r.code === 'timeout' || r.code === 'network'
    || (Number(r.status) >= 500 && r.code === `http-${r.status}`));

/**
 * Did WE win the write the server is now refusing as a conflict?
 *
 * Almost always not — somebody else saved — but the exception is this member's own timed-out
 * request landing late, and the two want opposite words: "your earlier submission did save, review
 * it" against "we have not overwritten a newer version". The server tells them apart by returning
 * the id that won; nothing on the client can.
 *
 * @param {string|null} pendingMutationId
 * @param {string|null|undefined} lastMutationId the id the server says is stored
 * @returns {boolean}
 */
export function conflictIsOurs(pendingMutationId, lastMutationId) {
    return !!pendingMutationId && lastMutationId === pendingMutationId;
}


/**
 * How long a rostered duty runs, in minutes — overnight-aware.
 *
 * "22:00–07:00" is nine hours, not minus fifteen: an end BEFORE the start means the duty crosses
 * midnight, which is how the roster writes every dispatcher night turn. Returns null for anything
 * that is not a pair of HH:MM times, so an unknown day never pretends to have a length.
 *
 * EQUAL TIMES ARE NOT A 24-HOUR DUTY: "08:00–08:00" is malformed (the custom range refuses
 * `start === end` too), so it is null — and `offersFullTwelve` needs a POSITIVE fact to withhold.
 * @param {string|null|undefined} start @param {string|null|undefined} end
 * @returns {number|null}
 */
export function shiftSpanMinutes(start, end) {
    const re = /^([01]\d|2[0-3]):([0-5]\d)$/;
    const s = typeof start === 'string' ? start.match(re) : null;
    const e = typeof end === 'string' ? end.match(re) : null;
    if (!s || !e) return null;
    const sm = Number(s[1]) * 60 + Number(s[2]);
    const em = Number(e[1]) * 60 + Number(e[2]);
    if (em === sm) return null;
    return em > sm ? em - sm : em + 1440 - sm;
}

/**
 * Are two stored day answers the same declaration?
 *
 * Structural and order-independent: the form's transitions (overtime-answer.js) and the server's
 * canonicalised copy may differ in key ORDER while the answer does not.
 * @param {any} a @param {any} b
 */
export function sameAnswer(a, b) {
    return stableStringify(a ?? null) === stableStringify(b ?? null);
}

// ── Words ───────────────────────────────────────────────────────────────────────────────────────

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
    return `${DAY_NAMES_FULL[p.dow].slice(0, 3)} ${p.d} ${MONTH_ABB[p.m - 1]}`;
}

/**
 * "Saturday 5 September 2026" — the full form used in headings.
 * @param {string} iso
 */
export function longDate(iso) {
    const p = parts(iso);
    return `${DAY_NAMES_FULL[p.dow]} ${p.d} ${MONTH_NAMES[p.m - 1]} ${p.y}`;
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
 * The seven Sunday→Saturday ISO dates of a roster week — the one client copy, for the member's form
 * and the reviewer's workspace alike. Mirrors the server's `weekDates`, which is authoritative. UTC
 * arithmetic throughout, so no device time zone can move a date.
 * @param {string} weekStart
 */
export function weekDates(weekStart) {
    const [y, m, d] = String(weekStart).split('-').map(Number);
    return Array.from({ length: 7 }, (_, i) => new Date(Date.UTC(y, m - 1, d + i)).toISOString().slice(0, 10));
}

/**
 * When a printed sheet came out of the tray: "Tue 8 Sep 2026 · 14:07".
 *
 * Its own formatter rather than a `deadlineLabel` with a flag: the YEAR is the difference. A
 * deadline is read within days; a printout goes in a folder and must be told from last year's.
 * London wall-clock, as `deadlineLabel`: the sheet is a roster-office document.
 * @param {number} ms
 */
export function printedLabel(ms) {
    if (!ms) return '';
    // `printedStamp` owns the WHOLE line including the word "Printed", so every printable surface
    // words it alike. London for both halves (`londonClock`, not `formatClock`), like the deadlines.
    return printedStamp(londonDate(ms), londonClock(ms));
}

/**
 * The line that makes a PRINTED availability sheet honest about its own age.
 *
 * "As at", not "printed at": what matters is when the availability was READ. A page left open for
 * an hour and then printed must not claim to be an hour newer than its contents — so it is stamped
 * at render and never refreshed on `beforeprint` (absent on iOS Safari anyway).
 * @param {number} nowMs corrected server time at the moment the workspace was rendered
 */
export function asAtLine(nowMs) {
    // No directional word ("above"/"below"): this line is authored for a layout it is never seen in.
    return `Availability as at ${deadlineLabel(nowMs)} — it can change until the final deadline.`;
}

/**
 * How long ago a declaration was made, in the words a person would use.
 *
 * AN ANSWER'S AGE IS PART OF WHAT IT MEANS: an answer from nineteen days ago may predate a roster
 * the member has since planned around. Deliberately RELATIVE and coarse — a clerk needs "recent" or
 * "a while ago" — in London DATES, because "yesterday" names the day before, not 24 hours.
 *
 * Returns null when there is nothing to date, so a caller renders nothing rather than "unknown".
 * @param {number|null|undefined} ms when the declaration was last changed
 * @param {number} nowMs corrected server time
 * @returns {string|null}
 */
export function declaredAgo(ms, nowMs) {
    if (!ms || !nowMs || ms > nowMs) return null;
    // CALENDAR days in London, not elapsed 24-hour blocks, which err toward FRESHER — the costly
    // direction. Both dates sit at local noon, so the rounding absorbs a clock change.
    const days = Math.round((londonDate(nowMs).getTime() - londonDate(ms).getTime()) / 86_400_000);
    // Retention deletes a window ~13 weeks after its Saturday, so an age past 120 days is a corrupt
    // or missing timestamp. Better absent than absurd.
    if (days > 120) return null;
    if (days === 0) return 'today';
    if (days === 1) return 'yesterday';
    return `${days} days ago`;
}

/**
 * The standing receipt for a submitted form: "Submitted · updated Tue 18 Aug · 09:42".
 *
 * The day rows say what each answer IS, not that the form was accepted, and the `✓` feedback line
 * does not survive a reload — so this receipt does. Null when there is nothing to receipt: an
 * unsubmitted form must not carry a hollow receipt.
 * @param {any} submission the member's own submission head, or null
 * @returns {string|null}
 */
export function receiptLine(submission) {
    if (!submission?.currentRevision) return null;
    const when = submission.updatedAt || submission.firstAcceptedAt;
    return when ? `Submitted · updated ${deadlineLabel(when)}` : 'Submitted';
}

/**
 * The Manager row's words for a planning week.
 *
 * `missed` is deliberately blunt. A week whose final deadline went by with no window is not a
 * neutral state to be phrased around: nobody was asked, and the row has to say so plainly enough
 * that it is not read as "nobody was needed".
 * @param {string} state
 * @returns {{ label: string, tone: 'ok'|'warn'|'bad'|'done' }}
 */
export function rowStateCopy(state) {
    switch (state) {
        // "Form open", never "window" — that is our word for the record, never theirs.
        case 'created':                    return { label: 'Form open',    tone: 'ok'   };
        // A created week whose final deadline has gone. Neutral tone: a closed week is the normal end
        // state, and still worth reading as the record of what was planned from.
        case 'created-closed':             return { label: 'Form closed',  tone: 'done' };
        // The scheduler opens this overnight, so the row must not read as a demand.
        case 'not-created':                return { label: 'Opens automatically overnight', tone: 'warn' };
        // After the overnight that did not come. Naming the Create button is deliberate: the reviewer
        // cannot restart a scheduled job, and the button works whatever stopped it.
        case 'not-created-overdue':        return { label: 'Did not open overnight · create it here', tone: 'bad' };
        // Still opens automatically, but late enough to be worth a look: the first deadline has
        // gone, so anyone answering now misses the draft roster.
        case 'not-created-initial-passed': return { label: 'No form yet · first deadline has passed', tone: 'bad' };
        // Past the last roster year the app holds (`CONFIG.MAX_YEAR`): the server refuses to make it,
        // overnight or by hand, until the admin raises the year — so no promise, and no button.
        case 'not-created-beyond-roster':  return { label: 'Cannot open · past the end of the app\'s roster · tell the admin', tone: 'bad' };
        default:                           return { label: 'Missed · no form was opened, so nobody was asked', tone: 'bad' };
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
 * Which availability modes a day may offer.
 *
 * AN OVERNIGHT DUTY OFFERS NO "AFTER" AND NO "BEFORE & AFTER": its `end` is the NEXT morning, so
 * "After" would store a boundary on the wrong day and "Before & after" an inverted pair the server
 * refuses. "Before" stays (OVERTIME_AVAILABILITY.md → "Overnight duties").
 *
 * The roster-derived shortcuts exist ONLY where an authoritative duty time is known; offering them
 * otherwise would invent a boundary or take one from an unverified base roster.
 *
 * THE 12-HOUR ANSWER IS NO LONGER A MODE (owner): willingness is the `fullTwelve` flag
 * (`offersFullTwelve`). `answerCopy` still renders a saved `twelve_hours`, and the form still shows
 * it when it is what somebody saved.
 *
 * ONE BOTH-SIDES ANSWER PER DAY (owner): on a worked day `before_after` replaces `all_day`, because
 * it stores the clock times actually declared (a later roster change is flagged by
 * `answerAnchorStale`, never silently re-pointed). all_day is KEPT wherever before_after cannot be
 * offered — rest/spare days, overnight duties, unknown rosters — and a SAVED all_day still renders.
 *
 * It stays a single-select because twelve hours is the ceiling every plan is held to, not something a
 * member grants — the form states it (the cap note); willingness for that longest day is the tick.
 * @param {{hasTime?: boolean, overnight?: boolean, rosteredMinutes?: number|null}|null} ctx
 * @returns {string[]}
 */
export function modesFor(ctx) {
    if (!ctx || !ctx.hasTime) return ['unavailable', 'all_day', 'custom'];
    if (ctx.overnight) return ['unavailable', 'all_day', 'before', 'custom'];
    return ['unavailable', 'before', 'after', 'before_after', 'custom'];
}

/**
 * Whether this day should ASK the willingness question at all. A day whose EFFECTIVE roster already
 * reaches 720 minutes has nothing left to give; every other day may be asked, a rest day included.
 *
 * It needs a POSITIVE fact to withhold: an unreadable length (null) is not "already rostered 12
 * hours", so the tick shows — withhold what would ANCHOR to an unverified roster, keep what anchors
 * to nothing.
 * @param {{rosteredMinutes?: number|null}|null} ctx
 */
export function offersFullTwelve(ctx) {
    return !(Number.isFinite(ctx?.rosteredMinutes) && /** @type {number} */ (ctx?.rosteredMinutes) >= 720);
}

/**
 * What a failed submit should SAY. Pure, so every branch is pinned by a test.
 *
 * A server refusal IS a response, so connection advice there is a false lead. `dayLabel` is the
 * server's `date` field put into words; when present it names the remedy — re-choose that day. The
 * caller pairs it with `focusDay`, so the message and the scroll agree about where the problem is.
 * @param {string} code
 * @param {string|null} dayLabel e.g. "Wed 2 Sep", or null when the refusal names no day
 * @returns {string}
 */
export function submitFailureCopy(code, dayLabel) {
    if (dayLabel) return `Your answer for ${dayLabel} couldn't be accepted — choose that day again and resubmit.`;
    switch (code) {
        // Nothing left the phone: its sign-in could not be refreshed for want of a network.
        // Never "reload" — that throws the unsent answers away. (`network` and a code-less 5xx
        // never arrive here: the form reconciles them, `writeOutcomeUnknown`.)
        case 'offline':    return 'Couldn\'t reach the server, so nothing was sent. Check your connection and try again — your answers are still here.';
        case 'no-session': return 'Your sign-in has expired. Reload the page and sign in again.';
        // Server-side refusals: the request ARRIVED, so connection advice would be a false lead.
        case 'write-failed': return 'The server couldn\'t save just now. Try again in a moment.';
        // NOT a fault and NOT retryable: "try again" would loop on a refusal every time.
        case 'withdrawn':    return 'You\'re no longer being asked about this week. Speak to your manager if that\'s wrong.';
        case 'not-a-participant': return 'This week isn\'t open to you. Speak to your manager if that\'s wrong.';
        case 'no-window':  return 'This week is no longer open, so nothing was saved.';   // gone: "try again" loops
        default:           return `Couldn't save. Try again in a moment — if it keeps happening, tell the admin (code: ${code}).`;
    }
}

/**
 * One day's stored answer, in words. The inverse of what the form writes.
 * @param {any} day
 */
export function answerCopy(day) {
    const base = answerWindowCopy(day);
    // The willingness rides on the END of the window, never in place of it: the window is where a
    // duty may sit, the suffix how far it may run. It attaches ONLY to a real availability window —
    // the server refuses `fullTwelve` beside `unavailable`, and a chip drawing an impossible state
    // makes a reviewer doubt the rest of the panel.
    const attaches = !!day && typeof day === 'object' && day.fullTwelve === true
        && WINDOW_MODES.has(day.mode);
    return attaches ? `${base} · would work up to 12 hours` : base;
}

/** The modes that describe a window a duty could sit in — everything except "not available". */
const WINDOW_MODES = new Set(['all_day', 'twelve_hours', 'before', 'after', 'before_after', 'custom']);

/** The WINDOW half, alone. @param {any} day */
function answerWindowCopy(day) {
    if (!day || typeof day !== 'object') return 'Not answered';
    switch (day.mode) {
        case 'unavailable':  return 'Not available';
        case 'all_day':      return 'Available all day';
        // "IN TOTAL" IS THE WHOLE MEANING (owner, Aug 2026): twelve hours including whatever is
        // already rostered, not a twelve-hour turn on top. "FOR A FULL", matching the button the
        // member pressed: the chip follows the BUTTON, never the other way round — the record states
        // what the person was shown when they chose it.
        case 'twelve_hours': return 'Available for a full 12 hours in total';
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
 * True when a frozen participant record has been withdrawn from its week.
 *
 * ⚠️ THE SAME RULE EXISTS SERVER-SIDE, in `functions/overtime-core.js` (`isWithdrawn`): the reviewer's
 * browser reads the participant documents DIRECTLY from Firestore. Both are one field test against
 * `true` and neither may loosen to a truthiness check — a record wrongly read AS withdrawn removes a
 * person the reviewer is supposed to be chasing.
 * @param {any} participant
 */
export function isWithdrawn(participant) {
    return !!participant && participant.withdrawn === true;
}


/**
 * "Stopped by H. Croft, Wed 12 Aug" — the caption that makes an exclusion visible.
 *
 * The by-WHOM half is not decoration: this is the one action that removes a person from a count, so
 * it must be attributable. Either half may be missing — the line simply says less. The words avoid
 * "withdrawn" on purpose: that is the field name; the reviewer's question is whether this person is
 * still being ASKED.
 * @param {any} participant
 */
export function withdrawnLine(participant) {
    if (!isWithdrawn(participant)) return '';
    const by = typeof participant.withdrawnBy === 'string' && participant.withdrawnBy
        ? ` by ${participant.withdrawnBy}` : '';
    const when = participant.withdrawnAt
        // LONDON's date, not UTC's: a stop between midnight and 1am in summer is not the day before.
        ? `, ${shortDate(formatISO(londonDate(participant.withdrawnAt)))}` : '';
    return `Stopped${by}${when}`;
}

/**
 * Until when a Stop asking pressed NOW can be undone — the one promise the confirmation and the
 * panel note make. Restoring is not the mirror of withdrawing: somebody stopped on or
 * before the first deadline can be put back only until it, anybody stopped after it while the week
 * is open (`canRestoreNow`; OVERTIME_AVAILABILITY.md). An unknown deadline under-promises.
 * @param {number} initialDeadlineAt @param {number} nowMs
 */
export function putBackWindow(initialDeadlineAt, nowMs) {
    if (Number.isFinite(initialDeadlineAt) && initialDeadlineAt > 0 && Number.isFinite(nowMs)) {
        return nowMs > initialDeadlineAt ? 'while the week is open' : `until the first deadline, ${deadlineLabel(initialDeadlineAt)}`;
    }
    return 'until the first deadline';
}

/**
 * True when a stored answer means the member offered nothing at all that day.
 * @param {any} day
 */
export function isUnavailable(day) {
    return !!day && day.mode === 'unavailable';
}

/**
 * True when a stored answer offers SOMETHING — the positive question, asked positively.
 *
 * Never `!isUnavailable(day)`: that is true for a MISSING day, and would manufacture availability on
 * a list somebody rings round from. The answer must be a KNOWN mode that is not `unavailable` — a
 * mode this build cannot read (a newer release's, seen by a cached older client) is never positive.
 * @param {any} day
 */
export function isAvailableAnswer(day) {
    if (!day || typeof day !== 'object' || typeof day.mode !== 'string') return false;
    // WINDOW_MODES is exactly "known, and not `unavailable`"; consulting it stops this drifting from
    // the mode list.
    return WINDOW_MODES.has(day.mode);
}

/**
 * One day's roster, as the REST of the app draws it: the shared shift badge plus the duty times.
 *
 * `getShiftBadge` is the app's one badge builder — the calendar, Team View, the admin week grid and
 * the roster-review table all render from it — so a Rest day here wears the identical 🏠 Rest chip
 * it wears on the calendar. It lives here, not in `overtime-roster.js` (Firebase), so
 * `overtime-manager.js` stays loadable in Node.
 *
 * Returns HTML, and every value in it is app-derived (a shift constant, or a roster time already
 * matched against the shift-range pattern) — no member input reaches this string.
 * @param {{shift: string, hasTime: boolean, start: string, end: string, permanentShift?: string}|null} ctx
 * @returns {string}
 */
export function rosterBadge(ctx) {
    if (!ctx) return `<span class="ot-day-unknown">Roster unavailable</span>`;
    // ADMIN'S BADGE, NOT THE CALENDAR'S (owner): the TIME in the pill (`showTime`), as admin's
    // Change-a-Shift row draws it — the options beside it ("Before 06:20 / After 14:20") are about the
    // time. Same option and string admin passes, so one shift never renders two ways.
    return getShiftBadge(ctx.shift, { showTime: true, member: { permanentShift: ctx.permanentShift } });
}

/**
 * Has the roster moved out from under a saved answer that was anchored to it?
 *
 * Three modes store a boundary taken from the duty times as a clock time (`15:00`), never a
 * reference, so a later roster change cannot re-point a declaration. The form SAYS SO rather than
 * re-anchoring — that would edit a declaration nobody re-made.
 *
 * **Unknown roster is not a changed roster.** `shift` null (unreadable context) returns false.
 *
 * @param {any} day the stored answer
 * @param {{hasTime?: boolean, start?: string, end?: string}|null} shift the CURRENT roster context
 * @returns {boolean}
 */
export function answerAnchorStale(day, shift) {
    if (!day || typeof day !== 'object' || !shift) return false;
    switch (day.mode) {
        // A rest day has no boundary to compare against, so a shift-anchored answer has lost its
        // anchor entirely — which is exactly the case worth flagging, not one to skip.
        case 'before':       return !shift.hasTime || day.until !== shift.start;
        case 'after':        return !shift.hasTime || day.from  !== shift.end;
        case 'before_after': return !shift.hasTime || day.until !== shift.start || day.from !== shift.end;
        // The other three carry nothing taken from the roster, so it cannot invalidate them.
        default:             return false;
    }
}

/**
 * Which of the three badge tones an answer wears — the visual half of `answerCopy`.
 *
 * THREE, not two: a person who said no and a person who said nothing are opposites. `none` is
 * unfilled rather than a third fill — an absent answer is not a quieter answer.
 * @param {any} day
 * @returns {'yes'|'no'|'none'}
 */
export function answerTone(day) {
    if (!day || typeof day !== 'object' || !day.mode) return 'none';
    if (day.mode === 'unavailable') return 'no';
    // An UNREADABLE answer is not a green one — the same answer as `isAvailableAnswer`, since the
    // chip's colour and its section are read together.
    return WINDOW_MODES.has(day.mode) ? 'yes' : 'none';
}

/**
 * The three derived facts a Manager needs about how a submission MOVED — computed from the
 * immutable revisions, never from a stored flag.
 *
 * ⚠️ A DELIBERATE DUPLICATE of `deriveHistory` in `functions/overtime-core.js` (CommonJS cannot import
 * a browser ES module). `overtime-parity.test.mjs` runs BOTH over the same cases — a drift is silent,
 * since an absent flag looks exactly like a change that never happened.
 *
 * A form that OPENED at or after the initial deadline has no initial boundary — see the server copy.
 *
 * @param {Array<{revision:number, days:object, acceptedAt:number}>} revisions
 * @param {Record<string, any>|null} headDays
 * @param {number} initialDeadlineAt
 * @param {number} [openedAt] when the window was created; 0/absent = unknown, and the rule applies
 * @returns {{ initialRevision: any, lateInitial: boolean, changedSinceInitial: boolean,
 *   dayChangedAt: Record<string, number> }}
 */
export function deriveHistory(revisions, headDays, initialDeadlineAt, openedAt = 0) {
    const sorted = [...(revisions || [])].sort((a, b) => a.revision - b.revision);
    const applies = !(openedAt >= initialDeadlineAt);
    const before = applies ? sorted.filter(r => r.acceptedAt < initialDeadlineAt) : [];
    const initialRevision = before.length ? before[before.length - 1] : null;
    const hasSubmission = sorted.length > 0;
    return {
        initialRevision,
        // No submission at all is NOT a late submission — it is no response, and the two are
        // different answers everywhere else in this feature too.
        lateInitial: applies && hasSubmission && !initialRevision,
        changedSinceInitial: !!(initialRevision && headDays
            && stableStringify(initialRevision.days) !== stableStringify(headDays)),
        dayChangedAt: dayChangedAt(sorted),
    };
}

/**
 * When each individual DATE's answer last changed — the form's one `updatedAt` would report every
 * day as fresh when only one was edited. DERIVED, NOT STORED, by OVERTIME_AVAILABILITY.md invariant 8's reasoning.
 *
 * A day's answer "changes" when it first appears and whenever its stored shape differs from the
 * revision before it — structurally: a reordered object is not a change of mind.
 *
 * Returns `{}` when there are no revisions; the caller then falls back to the whole-form timestamp.
 * @param {any[]} sortedRevisions revisions in ascending `revision` order
 * @returns {Record<string, number>} date → epoch ms
 */
function dayChangedAt(sortedRevisions) {
    /** @type {Record<string, number>} */
    const changedAt = {};
    /** @type {Record<string, string>} */
    const seen = {};
    for (const r of sortedRevisions) {
        const days = r?.days;
        if (!days || typeof days !== 'object') continue;
        for (const date of Object.keys(days)) {
            const shape = stableStringify(days[date]);
            if (seen[date] === shape) continue;
            seen[date] = shape;
            changedAt[date] = r.acceptedAt;
        }
    }
    return changedAt;
}

/**
 * Order-independent structural comparison, so a reordered object is not read as a change.
 * @param {any} v
 * @returns {string}
 */
function stableStringify(v) {
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
    return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`;
}

/** The grades a sheet or a copied summary covers: "All grades" or "CES only". @param {string} grade */
export function gradeScopeLabel(grade) {
    return grade === 'ALL' ? 'All grades' : `${grade} only`;
}

/** The reviewer's flag, worded once — `releaseRequestLine` owns it, so the copy and the screen match. */
const RELEASE_LABEL = releaseRequestLine({ releaseRequested: true });

/**
 * The reviewer's clipboard summary — the whole week or one day, as PLAIN TEXT for the rostering
 * conversation the clerk is about to have somewhere else (email, the rostering system, a phone
 * call). A formatter over EXACTLY what the workspace renders: the caller hands in the same
 * (already grade-filtered, withdrawn-excluded) participants and submissions the panels were built
 * from, so the copy can never disagree with the screen.
 *
 * THE THREE SECTIONS ARE ALWAYS NAMED, EMPTY OR NOT. "No response" absent from a summary reads as
 * "nobody outstanding" — the exact merge the whole feature forbids. An empty section says "nobody".
 *
 * A REQUEST TO COME OFF A SUNDAY IS A FOURTH LINE, NEVER FOLDED INTO THE ANSWER: it is about
 * CONTRACTED work, a second thing said about the day (invariant 1). Named on every Sunday ("nobody"
 * in words) and on any other day only if somebody asked.
 *
 * IT STATES ITS GRADE AND ITS AGE, AS THE SHEET DOES — a CES-only copy must not pass for the team.
 *
 * @param {{ weekEnding: string, dates: string[], participants: any[], submissions: Map<string, any>,
 *   day?: string, grade?: string, asAt?: number }} arg  `day` narrows to one date ('ALL' = week);
 *   `grade` is the lens the participants were filtered by; `asAt` when the data was read
 * @returns {string}
 */
export function weekAvailabilitySummary({ weekEnding, dates, participants, submissions, day = 'ALL', grade = 'ALL', asAt = 0 }) {
    const scope = (day && day !== 'ALL') ? [day] : dates;
    const lines = [`Overtime availability — ${weekLabel(weekEnding)}`, gradeScopeLabel(grade),
        ...(asAt ? [asAtLine(asAt)] : [])];
    for (const date of scope) {
        /** @type {string[]} */ const avail = [];
        /** @type {string[]} */ const unavail = [];
        /** @type {string[]} */ const none = [];
        for (const p of participants) {
            const sub = submissions.get(p.memberName);
            const d = sub?.days?.[date];
            // The same three-valued, positively-asked split as the By-day panels — a day neither
            // answer claims is No response, never Available.
            if (isAvailableAnswer(d)) avail.push(`${p.memberName} (${answerCopy(d).replace(/^Available /, '')})`);
            else if (isUnavailable(d)) unavail.push(p.memberName);
            else none.push(p.memberName);
        }
        lines.push('', shortDate(date),
            `  Available: ${avail.length ? avail.join(' · ') : 'nobody'}`,
            `  Not available: ${unavail.length ? unavail.join(' · ') : 'nobody'}`,
            `  No response: ${none.length ? none.join(' · ') : 'nobody'}`);
        const askedOff = participants
            .filter(p => releaseRequestLine(submissions.get(p.memberName)?.days?.[date]))
            .map(p => p.memberName);
        if (askedOff.length || isSunday(date)) {
            lines.push(`  ${RELEASE_LABEL}: ${askedOff.length ? askedOff.join(' · ') : 'nobody'}`);
        }
    }
    return lines.join('\n');
}

/**
 * The reminder-audit line: did the deadline-morning reminder to non-responders go out, without
 * reading Cloud Function logs? The scheduler (functions/overtime.js) stamps `reminderSentAt`.
 *
 * The stamp is CLAIMED before the send (two overlapping runs must not both send), so alone it says
 * only that a send was ATTEMPTED. What the send reached is recorded after it:
 * `outstanding` is how many had said nothing (leaving out anyone that run had just asked), and
 * `accepted` how many DEVICES took the push. Null = not recorded (every stamp from before Nov
 * 2026), which is unknown, never zero.
 *
 * Once stamped: none outstanding → not needed; accepted → sent, which reaches only devices with
 * notifications on; nothing accepted → reached nobody (a warning while the week is live); outcome
 * not recorded → attempted. Unstamped: due (INITIAL_OPEN) → when to expect it; FINAL_OPEN → warn,
 * while the fact is actionable; CLOSED → nothing, or every window from before the reminder existed
 * would wear a permanent false alarm.
 *
 * @param {string} phase @param {number} initialDeadlineAt @param {number|null|undefined} reminderSentAt
 * @param {number|null} [outstanding] @param {number|null} [accepted]
 * @returns {{ text: string, tone: 'ok'|'note'|'warn' }|null}
 */
export function reminderLine(phase, initialDeadlineAt, reminderSentAt, outstanding = null, accepted = null) {
    if (reminderSentAt) {
        const when = deadlineLabel(reminderSentAt);
        if (!Number.isInteger(outstanding) || !Number.isInteger(accepted)) return { text: `Reminder to non-responders attempted ${when}.`, tone: 'note' };
        if (outstanding === 0) return { text: `No reminder was needed on ${when}.`, tone: 'ok' };
        if (/** @type {number} */ (accepted) > 0) return { text: `Reminder to non-responders sent ${when}, to those with notifications switched on.`, tone: 'ok' };
        return phase === 'CLOSED'
            ? { text: `The reminder on ${when} reached nobody.`, tone: 'note' }
            : { text: `The reminder on ${when} reached nobody — contact non-responders directly.`, tone: 'warn' };
    }
    if (phase === 'INITIAL_OPEN') return { text: 'Non-responders are reminded on the morning of the initial deadline.', tone: 'note' };
    if (phase === 'FINAL_OPEN') return { text: 'No non-responder reminder is recorded for this week.', tone: 'warn' };
    return null;
}
