'use strict';

/**
 * functions/reset-request-rules.js — the RULES of the password-reset request queue
 * (AUTH_AND_SESSIONS.md → "The reset-request queue"): whether a request is recorded or absorbed as a repeat
 * (`shouldRecordResetRequest`), whether a recorded one pushes or the admin was told just now
 * (`shouldNotifyAdmin`), and the words of that push (`buildResetRequestNotice`).
 *
 * Pure: no Firebase, no clock, requires nothing — so the one piece of judgement in an otherwise
 * mechanical public endpoint, and the whole user-visible product of the feature, are unit-tested in
 * roster-parse-helpers.test.mjs; auth-endpoints.test.mjs drives the endpoint (./reset-request.js) for
 * real. MOVED HERE WHOLE from roster-parse-helpers.js (25 Nov 2026), which had reached its line cap
 * holding three jobs that were not the roster parse.
 */

/**
 * Throttle decision for a password-reset REQUEST (AUTH_AND_SESSIONS.md → "The reset-request queue").
 *
 * PURE so the one piece of judgement in an otherwise mechanical public endpoint is unit-testable.
 * Returns true when the request should be RECORDED (write the doc + count it), false when it should be
 * silently absorbed as a duplicate.
 *
 * Why throttle at all when the collection can't grow (doc id = member name, so at most one row per
 * member — see the endpoint)? Two reasons: a member tapping the link repeatedly should not inflate the
 * `count` the admin reads as "how badly are they stuck", and every recorded request is a potential
 * notification. The endpoint answers with the same body either way, and no sooner than
 * RESET_REQUEST_ANSWER_FLOOR_MS (reset-request.js), so a throttled request cannot be told from a
 * recorded one by its body or its ordinary timing.
 *
 * A missing/unparseable previous timestamp means "never asked" → record.
 *
 * @param {number|null|undefined} lastRequestedAtMs  previous requestedAt in ms, or null
 * @param {number} nowMs
 * @param {number} throttleMs
 * @returns {boolean}
 */
function shouldRecordResetRequest(lastRequestedAtMs, nowMs, throttleMs) {
    const last = Number(lastRequestedAtMs);
    if (!Number.isFinite(last) || last <= 0) return true;   // never asked (or junk) → record
    return (nowMs - last) >= throttleMs;
}

/**
 * Should this recorded request actually PUSH, or has the admin already been told recently?
 *
 * The per-member throttle bounds how often ONE person can ring the phone; it does nothing about a
 * caller walking the roster, which is public, and filing one request per name. Fifty valid requests
 * produced fifty targeted pushes (external review, v18.97). The row-level record is fine — the
 * collection is bounded by construction — but the notifications are not, and a phone buzzing fifty
 * times is both the annoyance and the reason a real request would then be ignored.
 *
 * So: push only when no OTHER row records a notification that was actually SENT inside the window.
 * During a burst the admin gets ONE notification, and because the feature shares a single tag
 * carrying the queue depth, that one is a live summary of the whole queue rather than a fragment of
 * it. A genuine second request later in the day is well outside the window and still pushes.
 *
 * ── WHY THE TIMESTAMPS ARE `notifiedAt` AND NOT `requestedAt` (v21.85, external review) ──────────
 * This used to read the other rows' `requestedAt`, i.e. it treated *another request arrived
 * recently* as *the admin was told recently*. Those are not the same claim, and the gap is a real
 * one: if the first request's push failed — a transient push-service error, or an admin whose only
 * subscription predates the `owner` stamp and is therefore skipped — then the SECOND member inside
 * the window was silenced by a notification that never happened. Nothing was lost (the row is the
 * doorbell and the Operations card is authoritative), but the phone stayed quiet for the whole
 * window, and the log line claimed the opposite.
 *
 * `notifiedAt` is written only after `sendTargetedPush` reports a subscription ACCEPTED the message,
 * so the suppression now rests on evidence rather than on a proxy. Burst protection is unchanged —
 * the first send stamps and the rest coalesce behind it — and the case where NO send succeeds now
 * keeps trying, which is what "fail open" was always supposed to mean here.
 *
 * Still derived from data we already hold, on a collection no client can write, rather than a new
 * "last notified" document: no extra collection, no extra rules surface, and nothing a client could
 * write to suppress the admin's notifications.
 *
 * Fails OPEN — an absent or unreadable timestamp notifies rather than stays silent, because a missed
 * doorbell is worse than a duplicate one. Rows written before v21.85 carry no `notifiedAt` at all,
 * so the transition itself fails open by construction.
 *
 * @param {Array<number|null|undefined>} otherNotifiedAtMs  notifiedAt of every OTHER pending row
 * @param {number} nowMs
 * @param {number} windowMs
 * @returns {boolean} true → send the push
 */
function shouldNotifyAdmin(otherNotifiedAtMs, nowMs, windowMs) {
    for (const raw of Array.isArray(otherNotifiedAtMs) ? otherNotifiedAtMs : []) {
        const t = Number(raw);
        if (!Number.isFinite(t) || t <= 0) continue;          // never notified (or junk) → not evidence
        if (t > nowMs) continue;                              // clock skew → ignore, never suppress
        if (nowMs - t < windowMs) return false;               // the admin WAS reached, just now
    }
    return true;
}

/**
 * The headline + body for the admin's "someone asked for a password reset" push
 * (AUTH_AND_SESSIONS.md → "The reset-request queue", the admin push).
 *
 * PURE so the wording — the whole user-visible product of this feature — is unit-testable without a
 * push service, and so the design language's truncation budgets are verifiable rather than assumed.
 *
 * The headline carries the QUEUE DEPTH, not just "someone asked", because the feature shares ONE
 * notification tag: request #2 replaces request #1 on the lock screen. Depth-in-the-headline turns
 * that replacement from lossy into useful — the newest notification always states the current total.
 * The body names the member who just asked (safe to render: the name came from the server-owned
 * activeMembers list, never the request body) and, when others are also waiting, says so rather than
 * implying this one request is the whole queue.
 *
 * `pending` is the number of UNCLEARED rows in `resetRequests`, which is exactly the number on the
 * Operations card's count chip — so the notification and the card can never disagree.
 *
 * Tone follows .claude/rules/notifications.md: calm, factual, no exclamation. Deliberately NOT
 * "urgent"/"locked out" — the admin decides urgency, and a request is not proof of one
 * (AUTH_AND_SESSIONS.md → "The reset-request queue").
 *
 * @param {string} member    display name, from the server-owned roster
 * @param {number} pending   uncleared rows in resetRequests (>= 1 — this request is one of them)
 * @returns {{ headline: string, body: string }}
 */
function buildResetRequestNotice(member, pending) {
    const n = Number.isFinite(Number(pending)) && Number(pending) >= 1 ? Math.floor(Number(pending)) : 1;
    const others = n - 1;
    return {
        // "Reset requests", not "Password reset": a COLLAPSED notification shows the title alone, and
        // "Password reset — 1 waiting" on your own lock screen reads first as something about YOUR
        // password. This also matches the card the notification opens ("Password Reset Requests"), and
        // the body supplies the word "password" for anyone reading the expanded form.
        headline: `Reset requests — ${n} waiting`,
        // ONE wording for any queue (owner, 26 Nov 2026): the same sentence, with the others added
        // when there are any. The longest roster name with 98 others still fits the 80-character body
        // (the push-copy table, documents-endpoints.test.mjs).
        body: `${member} asked for a password reset.`
            + (others > 0 ? ` ${others} other${others === 1 ? '' : 's'} waiting.` : ''),
    };
}

module.exports = {
    shouldRecordResetRequest,
    shouldNotifyAdmin,
    buildResetRequestNotice,
};
