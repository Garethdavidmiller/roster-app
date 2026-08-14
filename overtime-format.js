// @ts-check
/**
 * overtime-format.js — the PURE client side of Overtime: how a window, a phase and a day's answer
 * are put into words, and the one piece of arithmetic the browser is allowed to do about time.
 *
 * No DOM and no Firebase, so every branch is reachable from a Node test. It imports exactly one
 * thing — `getShiftBadge` from `roster-data.js`, which is pure and Node-loadable — because the
 * roster chip is now drawn on BOTH sides of the feature (v20.87: the reviewer's rows gained the
 * roster the member's form always had) and a second copy of that markup is how the override→display
 * ladder drifted apart before v16.48. The invariant this module keeps is Node-testability, not an
 * empty import list; do not add anything that breaks the former.
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

import { getShiftBadge } from './roster-data.js';

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
 * **WIRED at v20.78** — `overtime-app.js` resyncs on `visibilitychange` when this says a deadline is
 * near, one read at a time. The warning that used to sit here (nothing called it, noted v20.69) is
 * kept as a note rather than deleted: it stood for ten releases and was found stale by an external
 * review, and a comment that describes the opposite of the code is worse than no comment at all.
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

/**
 * How long a rostered duty runs, in minutes — overnight-aware.
 *
 * "22:00–07:00" is nine hours, not minus fifteen: an end BEFORE the start means the duty crosses
 * midnight, which is how the roster writes every dispatcher night turn. Returns null for anything
 * that is not a pair of HH:MM times, so an unknown day never pretends to have a length.
 *
 * ── EQUAL TIMES ARE NOT A 24-HOUR DUTY ──────────────────────────────────────────────────────────
 *
 * "08:00–08:00" used to come back as 1440, on the same branch that handles a night turn. Nothing
 * anywhere else in the app reads equal times that way: the member's own custom range refuses
 * `start === end` outright, and the server's `before_after` check treats a non-advancing pair as a
 * transposition. A value like that is malformed, not a round-the-clock shift.
 *
 * The consequence was small and in the wrong direction — 1440 is over the 12-hour gate, so the
 * "Up to 12 hours" pill would be withheld on the strength of a garbage reading. `modesFor` needs a
 * POSITIVE fact to withhold, and null is not one, so returning null offers the pill. Withholding an
 * option is a real cost to the member; offering one on a day whose roster is nonsense is not.
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
 * Structural and order-independent, because the two sides come from different producers — the
 * form's `buildAnswer` and the server's canonicalised copy — whose key ORDER may differ while the
 * answer does not. A `JSON.stringify` comparison would call those different, and the form would
 * mark a day "changed" that the member has not touched.
 * @param {any} a @param {any} b
 */
export function sameAnswer(a, b) {
    return stableStringify(a ?? null) === stableStringify(b ?? null);
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
 * The line that makes a PRINTED availability sheet honest about its own age.
 *
 * "As at", not "printed at", and the difference is the whole point. What matters to somebody
 * ringing round from a sheet of paper is when the availability was READ — not when the paper came
 * out of the tray. A page left open for an hour and then printed would carry a timestamp an hour
 * newer than its own contents, which is the one direction this must not be wrong in.
 *
 * So it is stamped at render and never refreshed on `beforeprint`. (That event is also absent on
 * iOS Safari, so a refresh would be inconsistent as well as misleading.)
 * @param {number} nowMs corrected server time at the moment the workspace was rendered
 */
export function asAtLine(nowMs) {
    // No directional word. It said "the final deadline above" and the deadline prints on the NEXT
    // line down — the kind of thing that is invisible while writing the sentence and obvious on the
    // page. Positional references are a standing hazard here, because this line is authored for a
    // layout it is never seen in.
    return `Availability as at ${deadlineLabel(nowMs)} — it can change until the final deadline.`;
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
 * claim about any document. The lines beneath state the dates, so this one names none — and that
 * rule still holds after v20.86 added the second date: what it forbids is two lines naming the SAME
 * Tuesday, which is how a member stops reading either.
 * @param {string} phase
 */
export function phaseCopy(phase) {
    if (phase === 'INITIAL_OPEN') return 'Open — answer now to be included when this week is planned';
    if (phase === 'FINAL_OPEN')   return 'Still open — planning has started, so a change now may not fit';
    return 'Closed';
}

/**
 * Every line a member's form head carries about time, in order.
 *
 * ── THE DEADLINE THAT MATTERS WAS THE ONE NOT ON SCREEN ─────────────────────────────────────────
 *
 * A window has two deadlines and they are eleven and eighteen days out, a week apart. Until v20.86
 * the form printed the FINAL one — "Closes Tue 25 Aug · 12:00" — and left the first to be inferred
 * from "answer now to be included when this week is planned". So the only date on the page was the
 * later one, and a member reading it would reasonably conclude they had until then.
 *
 * They do, technically: a submission at the final deadline is accepted. But it arrives after the
 * week has been planned, which is the whole distinction the two deadlines exist to draw, and the
 * page was quietly pointing at the wrong one. An answer that is accepted and too late to be used is
 * the worst outcome this feature can produce — everyone believes it worked.
 *
 * Both dates now show, in the order they arrive, with the live one first. After the first deadline
 * the same line stays and turns past-tense rather than vanishing: "answers were due" tells a member
 * where they stand, where dropping the line would leave them thinking they had never missed
 * anything. Neither line is a countdown, and neither names a document (see phaseCopy).
 *
 * @param {string} phase
 * @param {number} initialDeadlineAt
 * @param {number} finalDeadlineAt
 * @returns {{ text: string, lead: boolean }[]} `lead` marks the date that is still to come — the
 *   one the member can still act on, which is the ONLY one worth emphasising
 */
export function deadlineLines(phase, initialDeadlineAt, finalDeadlineAt) {
    if (phase === 'CLOSED') {
        return [{ text: `Closed ${deadlineLabel(finalDeadlineAt)}`, lead: false }];
    }
    const prose = { text: phaseCopy(phase), lead: false };
    if (phase === 'FINAL_OPEN') {
        return [
            prose,
            { text: `Answers were due ${deadlineLabel(initialDeadlineAt)}`, lead: false },
            { text: `Changes close ${deadlineLabel(finalDeadlineAt)}`, lead: true },
        ];
    }
    return [
        prose,
        { text: `Answers due ${deadlineLabel(initialDeadlineAt)}`, lead: true },
        { text: `Changes close ${deadlineLabel(finalDeadlineAt)}`, lead: false },
    ];
}

/**
 * How long ago a declaration was made, in the words a person would use.
 *
 * ── AN ANSWER'S AGE IS PART OF WHAT IT MEANS ────────────────────────────────────────────────────
 *
 * The reviewer's row showed WHO, WHAT they are rostered and WHAT they said, and nothing about WHEN
 * they said it. Mid-week sickness is the case that breaks on: "G. Miller · Available all day" could
 * have been written nineteen days ago, before a roster the member has since seen and planned
 * around, and the row looked exactly as fresh as one written this morning.
 *
 * Deliberately RELATIVE and coarse. An exact timestamp reads as precision about a thing whose value
 * is approximate — what a clerk needs is "recent" or "a while ago", and a date forces them to do
 * the subtraction. Days, because this feature's whole clock is days: nothing here turns on hours.
 *
 * Returns null when there is nothing to date, so a caller renders nothing rather than "unknown".
 * @param {number|null|undefined} ms when the declaration was last changed
 * @param {number} nowMs corrected server time
 * @returns {string|null}
 */
export function declaredAgo(ms, nowMs) {
    if (!ms || !nowMs || ms > nowMs) return null;
    const days = Math.floor((nowMs - ms) / 86_400_000);
    if (days === 0) return 'today';
    if (days === 1) return 'yesterday';
    return `${days} days ago`;
}

/**
 * The standing receipt for a submitted form: "Submitted · updated Tue 18 Aug · 09:42".
 *
 * A member who reloads used to have only the green day rows to go on. Those are a correct signal
 * and a weak one — they say what each answer IS, not that the form was ever accepted, and the
 * confirmation that did say so (`✓ Availability submitted`) lives in a feedback line that does not
 * survive the reload. So the strongest evidence on screen was an inference from seven colours.
 *
 * Returns null when there is nothing to receipt, so the caller renders nothing rather than an empty
 * chrome — an unsubmitted form must not carry a hollow receipt.
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
        // The same week, after the overnight that did not come. A reassurance is only worth giving
        // while it is true, and this one repeats itself daily for as long as the schedule is broken —
        // so the row would keep promising the fix right up to the deadline it then missed. Naming
        // the Create button is deliberate: the reviewer cannot restart a scheduled job, and the
        // button beside this label works whether or not anyone ever diagnoses why the job stopped.
        case 'not-created-overdue':        return { label: 'Did not open overnight · create it here', tone: 'bad' };
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
 * Which availability modes a day may offer.
 *
 * MOVED here from overtime-roster.js at v20.75 — that module imports the Firebase SDK, so this
 * rule was unreachable from a Node test, and it turned out to be wrong in a way only a test pins:
 *
 * ── AN OVERNIGHT DUTY OFFERS NO "AFTER" AND NO "BEFORE & AFTER" ─────────────────────────────────
 *
 * Dispatchers are the only grade rostered across midnight (22:00–07:00, 22:30–09:00 — and their
 * late turns ending past midnight, 15:30–00:30). On such a day `end` is the NEXT morning, and both
 * anchored offers built from it are wrong:
 *
 *   "After 07:00"          stores `from: 07:00` on THAT date — a morning the member is still on
 *                          duty from the night before-last's perspective, and hours they never
 *                          declared. The English reads as "after my shift"; the record is not.
 *   "Before & after duty"  stores `until: 22:00, from: 07:00` — which the server REFUSES
 *                          (`before-after-inverted`: until > from reads as a transposed pair). The
 *                          button was offered and every press ended in a failed submit.
 *
 * "Before 22:00" is still sound — the pre-duty gap that day is real — so it stays. The rest of the
 * day's freedom is expressible with Custom times, which the member types themselves.
 *
 * The roster-derived shortcuts exist ONLY where an authoritative duty time is known. Without one
 * there is no boundary to anchor to, and offering them anyway would either invent one or quietly
 * attach one from a base roster nobody has verified.
 *
 * ── "UP TO 12 HOURS" IS OFFERED UNLESS THE DAY ALREADY REACHES 12 (v20.83, owner) ───────────────
 *
 * Twelve hours is the ceiling of a turn, so the declaration means "I will work up to a 12-hour
 * day" — a full 12-hour turn on a rest day, or extending a rostered duty to 12 hours total on a
 * worked one. The one day it is meaningless is a day whose EFFECTIVE roster already reaches
 * 720 minutes — including a 12-hour RDW already agreed as extra — because there is nothing left
 * to offer; on that day the pill is withheld.
 *
 * The gate needs a POSITIVE fact to fire: `rosteredMinutes` is null when the day's length is
 * unknown, and unknown is not "already rostered 12 hours", so the pill shows. That is the same
 * direction every unknown resolves on this page — withhold what would ANCHOR to an unverified
 * roster (the before/after shortcuts), keep what anchors to nothing (this, all-day, custom).
 *
 * ── ONE BOTH-SIDES ANSWER PER DAY (v21.22, owner) ───────────────────────────────────────────────
 *
 * On a normal worked day, "Any time around my shift" (all_day) and "Before & after duty" said the
 * SAME thing to a roster clerk — free both sides of the duty — and the owner's review named the
 * pair as the confusion it was. The one that stays is `before_after`, because it stores the clock
 * times the member actually declared: a later roster change leaves their answer saying what they
 * said (flagged by `answerAnchorStale`), which is the schema's own philosophy, where all_day
 * silently re-points at whatever the shift becomes. all_day is KEPT everywhere before_after cannot
 * be offered — rest/spare days (nothing to anchor to), overnight duties (before_after is refused
 * by the server as inverted) and unknown rosters — so every day still has a both-sides answer,
 * and a SAVED all_day on a worked day still renders (the form re-adds a stored mode to the list).
 *
 * The same review settled why this stays a single-select at all: twelve hours is the ceiling every
 * plan is subject to, not something a member grants — so "before & after AND up to 12 hours" adds
 * nothing to "before & after". The form now says so (the cap note in overtime-form.js), and the
 * 12-hour pill is worded as what it really is: willingness for the LONGEST day allowed.
 * @param {{hasTime?: boolean, overnight?: boolean, rosteredMinutes?: number|null}|null} ctx
 * @returns {string[]}
 */
export function modesFor(ctx) {
    const twelve = Number.isFinite(ctx?.rosteredMinutes) && /** @type {number} */ (ctx?.rosteredMinutes) >= 720
        ? [] : ['twelve_hours'];
    if (!ctx || !ctx.hasTime) return ['unavailable', 'all_day', ...twelve, 'custom'];
    if (ctx.overnight) return ['unavailable', 'all_day', ...twelve, 'before', 'custom'];
    return ['unavailable', ...twelve, 'before', 'after', 'before_after', 'custom'];
}

/**
 * What a failed submit should SAY. Pure, so every branch is pinned by a test.
 *
 * Until v20.75 every code that was not timeout/conflict/closed got "Check your connection and try
 * again" — including the server's own validation refusals, where the connection is provably fine
 * (a refusal IS a response). Telling somebody to check their connection when the server has just
 * told us which DAY it refused is worse than unhelpful: they retry the same payload and fail the
 * same way, with the actual remedy — re-choose that day — never mentioned.
 *
 * `dayLabel` is the server's `date` field put into words; when present it names the remedy. The
 * caller pairs it with `focusDay`, so the message and the scroll agree about where the problem is.
 * @param {string} code
 * @param {string|null} dayLabel e.g. "Wed 2 Sep", or null when the refusal names no day
 * @returns {string}
 */
export function submitFailureCopy(code, dayLabel) {
    if (dayLabel) return `Your answer for ${dayLabel} couldn't be accepted — choose that day again and resubmit.`;
    switch (code) {
        case 'network':    return 'Couldn\'t reach the server. Check your connection and try again.';
        case 'no-session': return 'Your sign-in has expired. Reload the page and sign in again.';
        // Server-side refusals: the request ARRIVED, so connection advice would be a false lead.
        case 'write-failed': return 'The server couldn\'t save just now. Try again in a moment.';
        // NOT a fault and NOT retryable, so it must not read like either (v21.20). The member is no
        // longer being asked for this week — somebody decided that, and telling them to "try again"
        // would send them round a loop the server will refuse every time.
        case 'withdrawn':    return 'You\'re no longer being asked about this week. Speak to a Manager if that\'s wrong.';
        case 'not-a-participant': return 'This week isn\'t open to you. Speak to a Manager if that\'s wrong.';
        default:           return `Couldn't save (${code}). Try again in a moment.`;
    }
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
        // "IN TOTAL" IS THE WHOLE MEANING (owner, Aug 2026). The declaration is that the member's
        // duty that day may run to twelve hours including whatever is already rostered — not that
        // they will work a twelve-hour turn on top of it. A reviewer reading "up to 12 hours" beside
        // a 07:00–15:00 duty could plan either, and the two differ by eight hours of somebody's day.
        // The chip has to carry the qualifier alone, because unlike the form's button it has no
        // roster context beside it to disambiguate.
        case 'twelve_hours': return 'Available for up to 12 hours in total';
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
 * ⚠️ THE SAME RULE EXISTS SERVER-SIDE, in `functions/overtime-core.js` (`isWithdrawn`). It has to:
 * the endpoints count the withdrawn to keep `expected` honest, and the reviewer's browser reads the
 * participant documents DIRECTLY from Firestore — the same CommonJS/ESM boundary `normaliseSurname`
 * sits on. Both are one field test against `true` and neither may loosen to a truthiness check,
 * because the failure is silent and points the wrong way: a record that is not withdrawn read AS
 * withdrawn removes a person the reviewer is supposed to be chasing.
 * @param {any} participant
 */
export function isWithdrawn(participant) {
    return !!participant && participant.withdrawn === true;
}

/**
 * "Stopped by H. Croft, Wed 12 Aug" — the caption that makes an exclusion visible.
 *
 * The by-WHOM half is not decoration. This is the one action on the page that removes a person from
 * a count, so a line reading only "not being asked" would be an unattributable change to somebody
 * else's record. Either half may be missing without the line becoming wrong — it simply says less.
 *
 * The words avoid "withdrawn" on purpose: that is the field name, and the reviewer's question is
 * whether this person is still being ASKED. `withdrawn` stays in the data and out of the copy.
 * @param {any} participant
 */
export function withdrawnLine(participant) {
    if (!isWithdrawn(participant)) return '';
    const by = typeof participant.withdrawnBy === 'string' && participant.withdrawnBy
        ? ` by ${participant.withdrawnBy}` : '';
    const when = participant.withdrawnAt
        ? `, ${shortDate(new Date(participant.withdrawnAt).toISOString().slice(0, 10))}` : '';
    return `Stopped${by}${when}`;
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
 * The reviewer's views used to ask `!isUnavailable(day)`, which is not the same predicate and
 * differs on exactly the input that matters: a MISSING day. `!isUnavailable(undefined)` is true, so
 * a member whose submission somehow lacked a date would have been counted and listed as available,
 * with no answer chip beside their name to say otherwise. The server normalises all seven days, so
 * this cannot fire today — but "cannot fire today" is the wrong safeguard for a list somebody rings
 * round from, and the failure direction is the bad one: it manufactures availability.
 *
 * So the answer must be a known mode that is not `unavailable`. Unknown is never positive.
 * @param {any} day
 */
export function isAvailableAnswer(day) {
    if (!day || typeof day !== 'object' || typeof day.mode !== 'string') return false;
    return day.mode !== 'unavailable' && day.mode !== '';
}

/**
 * One day's roster, as the REST of the app draws it: the shared shift badge plus the duty times.
 *
 * `getShiftBadge` is the app's one badge builder — the calendar, Team View, the admin week grid and
 * the roster-review table all render from it — so a Rest day here wears the identical 🏠 Rest chip
 * it wears on the calendar. Writing a second set of words for the same fact is how the
 * override→display ladder drifted, one surface at a time, before v16.48.
 *
 * Lived in `overtime-roster.js` until v20.87. It moved because the REVIEWER's rows now draw it too,
 * and that module imports the Firebase SDK — so importing it would have made `overtime-manager.js`
 * unloadable in Node, which is the one thing that module's header says it must stay.
 *
 * Returns HTML, and every value in it is app-derived (a shift constant, or a roster time already
 * matched against the shift-range pattern) — no member input reaches this string.
 * @param {{shift: string, hasTime: boolean, start: string, end: string}|null} ctx
 * @returns {string}
 */
export function rosterBadge(ctx) {
    if (!ctx) return `<span class="ot-day-unknown">Roster unavailable</span>`;
    return getShiftBadge(ctx.shift)
        + (ctx.hasTime ? `<span class="ot-day-time">${ctx.start}–${ctx.end}</span>` : '');
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
