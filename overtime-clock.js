// @ts-check
/**
 * overtime-clock.js — WHETHER AN ACTION IS STILL ALLOWED, which is not the same job as saying when.
 *
 * Left `overtime-format.js` at v23.69, when that module stood eleven lines under its ratchet cap.
 * The split is along a line its own header already drew: it is "the PURE client side of Overtime — a
 * window, a phase and a day's answer put into words", and these six are not words. They are the
 * DECISIONS a member's own clock is allowed to make about a deadline, and every one of them can
 * remove a control from somebody's screen.
 *
 * That is why they are worth separating rather than merely worth moving. The words about time —
 * `deadlineLabel`, `deadlineLines`, `printedLabel`, `asAtLine`, `declaredAgo` — stay next door,
 * because being wrong there produces a sentence somebody can see and query. Being wrong HERE
 * produces an absence: a Submit button that quietly is not there, on a phone whose clock nobody
 * checked, for a member who was in time.
 *
 * ── THE RULE THAT GOVERNS ALL SIX ───────────────────────────────────────────────────────────────
 *
 * **The client never refuses what the server would accept.** It may offer less than the server
 * allows — an extra request costs nothing — and it may never offer less than the member is owed.
 * Every asymmetry below runs that way and each says so at the branch:
 *
 *   · `SUBMIT_GRACE_MS` keeps Submit live for fifteen minutes PAST the deadline, because the cost
 *     of being wrong in that direction is one rejected request, and the cost the other way is
 *     somebody's availability for a week.
 *   · `submitDisposition` never answers `closed` inside that band — it answers
 *     `check-with-server`, handing the decision to the only clock that is authoritative.
 *   · `canRestoreNow` returns TRUE when it cannot tell, and the comment on that branch is the
 *     argument: a wrong refusal here puts a SENTENCE on screen explaining a rule that may not
 *     apply, and a false explanation is worse than a refused tap — the tap costs a moment, the
 *     sentence is believed. It runs opposite to the server's unknown case on purpose.
 *
 * ── WHAT MOVING THIS MUST NOT BREAK ─────────────────────────────────────────────────────────────
 *
 * 1. `overtime-format.js` RE-EXPORTS all six, so every consumer and both existing suites are
 *    untouched — the same device `admin-roster-upload.js` uses for `roster-review-states.js`.
 *    Do not "tidy" the re-export away without moving all eight import sites in the same commit.
 * 2. `canRestoreNow` has a SERVER twin and `overtime-parity.test.mjs` compares the two by
 *    BEHAVIOUR over a table of states. Moving the function does not move that obligation.
 * 3. Nothing here may import anything. It is arithmetic over numbers, which is what lets it be
 *    tested at the boundaries that matter — the minute either side of noon — with no fixtures.
 *
 * Tested by overtime-clock.test.mjs; the words half stays in overtime-format.test.mjs.
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
 * May this withdrawal be undone? The CLIENT copy of the rule (v21.26).
 *
 * ⚠️ THE SAME RULE EXISTS SERVER-SIDE, in `functions/overtime-core.js` (`canRestoreParticipant`),
 * and THAT one is the protection — this copy only decides what the panel OFFERS. The pattern is
 * `canOverwriteTargetSet` in the Links workspace: the button asks the client, the write asks the
 * server, and the client is allowed to be wrong only in the direction of offering less.
 *
 * Kept in step by `overtime-parity.test.mjs`, which compares BEHAVIOUR over a table of states
 * rather than source text — the drift here is silent in the usual way, because a client that
 * quietly loosens would put the button back on a case the server refuses, and the reviewer would
 * meet a refusal instead of an explanation.
 *
 * Full reasoning — including why an unreadable stamp refuses — is in the server module's header.
 * @param {number} initialDeadlineAt
 * @param {number|null|undefined} withdrawnAtMs
 * @param {number} nowMs
 * @returns {boolean}
 */
export function canRestoreNow(initialDeadlineAt, withdrawnAtMs, nowMs) {
    // AN UNKNOWN DEADLINE ASKS THE SERVER — the one branch that is client-only, and it runs the
    // opposite way to the server's unknown case on purpose. The server refuses an unreadable
    // `withdrawnAt` because it is the protection and a wrong yes writes a false record. Here a
    // wrong no puts a SENTENCE on screen — "stopped before the first deadline" — explaining a
    // refusal that may not exist, and a false explanation is worse than a refused tap: the tap
    // costs a moment, the sentence is believed. So when this client cannot tell, it offers the
    // button and lets the endpoint answer.
    if (!Number.isFinite(initialDeadlineAt) || !Number.isFinite(nowMs)) return true;
    if (nowMs <= initialDeadlineAt) return true;
    if (!Number.isFinite(withdrawnAtMs)) return false;
    return /** @type {number} */ (withdrawnAtMs) > initialDeadlineAt;
}
