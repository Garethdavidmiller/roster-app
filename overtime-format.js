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
 *
 * ⚠️ **NOTHING CALLS `shouldResyncClock` YET** (noted v20.69). The rule and its tests are here; the
 * page does not re-read state while it sits open. The consequence is bounded rather than absent: a
 * member submitting after a boundary they were not told about is still SENT (the grace band), and
 * past it the server's own "this form closed" is what they see — so the cost is a stale phase line,
 * not a lost declaration. Wire it or delete it; leaving a rule that reads as though it were in force
 * is the thing to avoid.
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
    // The comma `en-GB` inserts ("Tue, 18 Aug") reads as a stray separator beside the app's own
    // "·" dividers, so it goes. The weekday still leads, because a deadline staff act on is named
    // by its day of the week first.
    const d = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short',
    }).format(new Date(ms)).replace(',', '')
        // en-GB abbreviates September to FOUR letters ("Sept") and every other month to three, so
        // a column of deadlines came out ragged — "Tue 25 Aug" above "Tue 1 Sept". One month
        // behaving differently reads as a mistake in a list, so it is trimmed to match.
        .replace(/\bSept\b/, 'Sep');
    const t = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).format(new Date(ms));
    return `${d} · ${t}`;
}

/**
 * Staff-facing copy for a submission phase. Calm and factual — never a countdown.
 *
 * ── IT MAY NOT NAME A DOCUMENT THE MEMBER NEVER SEES ────────────────────────────────────────────
 *
 * This said "your answers go to the draft roster" and "the draft roster has been planned", and the
 * second one was read — correctly — as wrong. The DATES were right: for a week ending Sat 22 Aug the
 * draft is Thu 6 Aug and the final roster Thu 13 Aug, so on 11 Aug the draft genuinely had been
 * planned. The problem is that "the draft roster" is an internal artefact of the roster office. Staff
 * do not receive it. What they call "the roster" is the one that comes out on Thursday — the FINAL
 * one — so a line announcing that the roster has been planned, five days before they see anything,
 * reads as a straightforward untruth about the document they are waiting for.
 *
 * So these lines now describe the MEMBER'S OWN POSITION and name nothing they cannot see:
 *
 *   before the first deadline   answering now gets you counted from the start
 *   after it, before the final  you can still change it, and later is worse
 *
 * "Planning has started" is safe to say because that is the definition of the first deadline, not a
 * claim about any document. The line beneath already states when changes close, so this one does not
 * repeat a date. Keep it that way: two lines both naming the same Tuesday is how a member stops
 * reading either.
 * @param {string} phase
 */
export function phaseCopy(phase) {
    if (phase === 'INITIAL_OPEN') return 'Open — answer now to be included when this week is planned';
    if (phase === 'FINAL_OPEN')   return 'Still open — planning has started, so a change now may not fit';
    return 'Closed';
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
        // "Form open" rather than "Created": a reviewer cares that staff can answer, not that a
        // document was written. And nothing here says WINDOW any more — that is our word for the
        // record, never theirs. The page calls it a form everywhere a person can see.
        case 'created':                    return { label: 'Form open',    tone: 'ok'   };
        // A created week whose final deadline has gone. The horizon's FIRST row is always the
        // current week, and its deadline is eleven days behind it — so before this existed, every
        // reviewer was told "Form open" about a week that had closed and whose roster was already
        // published. Neutral tone, not a warning: a closed week is the normal end state, and the
        // availability is still worth reading as the record of what was planned from.
        case 'created-closed':             return { label: 'Form closed',  tone: 'done' };
        // The scheduler opens this overnight, so the row must not read as a demand. It said
        // "Not created" beside a prominent Create button, which asks a manager to do a job the
        // system now does — they would either do it redundantly or assume something was broken.
        case 'not-created':                return { label: 'Opens automatically overnight', tone: 'warn' };
        // Still opens automatically, but late enough to be worth a look: the first deadline has
        // gone, so anyone answering now misses the draft roster.
        case 'not-created-initial-passed': return { label: 'No form yet · first deadline has passed', tone: 'bad' };
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
 * Has the roster moved out from under a saved answer that was anchored to it?
 *
 * Three of the six modes store a boundary taken from the member's duty times — "available after my
 * shift" is stored as `15:00`, never as a reference, so that a later roster change cannot silently
 * re-point what somebody declared. That is the right storage rule and it creates this question: the
 * declaration stands, but it may no longer describe the day the member was picturing.
 *
 * The form answers it by SAYING SO rather than by changing anything. Re-anchoring the answer would
 * be the app editing a declaration nobody re-made; showing nothing would leave a member to notice a
 * two-digit difference between a badge and a button.
 *
 * **Unknown roster is not a changed roster.** `shift` is null when the context could not be read at
 * all, and this returns false there — accusing a member of a stale answer on the strength of a
 * failed Firestore query would be the same invention this feature refuses everywhere else.
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
        // The other three carry nothing taken from the roster: unavailable and all_day have no
        // boundary at all, and a custom range is the member's own times, which the roster never
        // supplied and therefore cannot invalidate.
        default:             return false;
    }
}

/**
 * Which of the three badge tones an answer wears — the visual half of `answerCopy`.
 *
 * THREE, not two, and for the same reason the reviewer's day panel has three sections: a person who
 * said no and a person who said nothing are opposites, and a badge that painted them alike would
 * undo in colour what the sections are careful to separate in structure. `none` is deliberately the
 * odd one out visually (unfilled) rather than a third fill — an absent answer is not a quieter
 * answer.
 * @param {any} day
 * @returns {'yes'|'no'|'none'}
 */
export function answerTone(day) {
    if (!day || typeof day !== 'object' || !day.mode) return 'none';
    if (day.mode === 'unavailable') return 'no';
    return 'yes';
}

/**
 * The three derived facts a Manager needs about how a submission MOVED — computed from the
 * immutable revisions, never from a stored flag.
 *
 * ⚠️ A DELIBERATE DUPLICATE of `deriveHistory` in `functions/overtime-core.js`. Cloud Functions are
 * CommonJS and cannot import a browser ES module, which is the same boundary `normaliseSurname` and
 * the payday cutoffs sit on. `overtime-parity.test.mjs` runs BOTH implementations over the same
 * cases and fails if they disagree — because a drift here is silent: the Manager view would simply
 * stop flagging a change, and a flag that is absent looks exactly like a change that never happened.
 *
 * @param {Array<{revision:number, days:object, acceptedAt:number}>} revisions
 * @param {Record<string, any>|null} headDays
 * @param {number} initialDeadlineAt
 * @returns {{ initialRevision: any, lateInitial: boolean, changedSinceInitial: boolean }}
 */
export function deriveHistory(revisions, headDays, initialDeadlineAt) {
    const sorted = [...(revisions || [])].sort((a, b) => a.revision - b.revision);
    const before = sorted.filter(r => r.acceptedAt < initialDeadlineAt);
    const initialRevision = before.length ? before[before.length - 1] : null;
    const hasSubmission = sorted.length > 0;
    return {
        initialRevision,
        // No submission at all is NOT a late submission — it is no response, and the two are
        // different answers everywhere else in this feature too.
        lateInitial: hasSubmission && !initialRevision,
        changedSinceInitial: !!(initialRevision && headDays
            && stableStringify(initialRevision.days) !== stableStringify(headDays)),
    };
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
