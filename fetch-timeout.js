// @ts-check
/**
 * fetch-timeout.js — a bound on every call the app makes to a Cloud Function.
 *
 * Owns: `fetchWithTimeout`, and the one rule for choosing a budget.
 * Does NOT own: what a caller SAYS when the bound fires — see the warning below, which is the part
 *   that actually matters and the part a shared helper cannot decide for you.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────────
 * Five client calls reached Cloud Functions through a bare `fetch()` with no bound (external review,
 * v20.52). A stalled transport never rejects, so the awaiting UI simply stops: the reset-request
 * button sits on "Sending…" for ever, "Set up accounts" never reports, the roster upload never
 * returns to the review table. None of those are wrong ANSWERS — they are the absence of an answer,
 * which is worse, because the member cannot tell a slow network from a broken app and their only
 * move is to reload and possibly repeat the action.
 *
 * The Calendar's PIN exchange (`calendar-access.js`) has had its own bound since v20.45 and keeps
 * it: that path is live and mid-soak, and consolidating it onto this helper is churn on the one
 * file that has just been stabilised. It should adopt this once the PIN rollout is finished.
 *
 * ── CHOOSING A BUDGET: ABOVE THE SERVER'S OWN TIMEOUT, NEVER BELOW ──────────────────────────────
 * Each function declares `timeoutSeconds` (functions/index.js). A client that gives up FIRST turns a
 * slow-but-succeeding operation into a reported failure — which for `setupRosterAuth` or
 * `resetMemberPassword` means telling an admin that a change did not happen while the server is
 * still making it happen. So the budget is the server's ceiling plus headroom, and it is chosen per
 * endpoint rather than shared:
 *
 *   requestPasswordReset  30s server → 35s      parseRosterPDF     120s server → 130s
 *   resetMemberPassword   60s server → 65s      setupRosterAuth    120s server → 130s
 *   getSignInStats        60s server → 65s
 *
 * That makes the bound long by UI standards, and that is the correct trade: it exists to end an
 * INFINITE wait, not to make a slow call feel fast.
 *
 * ── ⚠️ A TIMEOUT ON A STATE-CHANGING CALL DOES NOT MEAN IT DID NOT HAPPEN ────────────────────────
 * `AbortController` stops us WAITING; it does not stop the server WORKING. A `resetMemberPassword`
 * that times out may still reset the password a second later. So a caller must never turn this
 * error into "that failed" for a write — it has to say it could not confirm, and tell the reader how
 * to check. This is the same distinction `password-force.js` draws between `withTimeout` (safe for
 * reads and idempotent re-auth) and `settleOrTimeout` (required for a write), written down there
 * after the v18.96 review found the honest-reporting bug it prevents. Reads may say "failed" freely.
 *
 * ── THREE OUTCOMES, NOT TWO (v20.56) ────────────────────────────────────────────────────────────
 * A caller may now pass its OWN `signal` — before this, `{...options, signal: ctrl.signal}` silently
 * DROPPED it, so no caller could cancel a request at all and the "caller abort" case existed only in
 * theory. Now it exists, and it has to be told apart from our bound, because the two want opposite
 * copy on screen:
 *
 *   FETCH_TIMEOUT_CODE   our budget expired  → "may still have gone through — go and check"
 *   FETCH_ABORTED_CODE   the caller cancelled → say nothing, or "cancelled"; the user did this
 *   anything else        network / HTTP       → the request did not land
 *
 * The middle one is NOT proof the write did not happen either — aborting stops us listening, not the
 * server working — but it is the one case where the user already knows why, and a scary
 * "your form may have been saved" fired by their own navigation is noise that trains people to
 * ignore the message when it matters. When BOTH fire, the timeout wins: it is the outcome that asks
 * the reader to go and check, and over-checking is the safe direction.
 */

/** Thrown-error `code` when OUR bound fired, as opposed to a network error or an HTTP status. */
export const FETCH_TIMEOUT_CODE = 'myb/fetch-timeout';

/** Thrown-error `code` when the CALLER's own signal aborted the request. Never our bound. */
export const FETCH_ABORTED_CODE = 'myb/fetch-aborted';

/** Fallback budget for a caller that does not name one. Deliberately generous — see the header. */
export const DEFAULT_FETCH_TIMEOUT_MS = 65_000;

/** @returns {Error} the caller-cancelled error, tagged so `isFetchAborted` can spot it. */
function abortedError() {
    const e = new Error('Request cancelled');
    /** @type {any} */ (e).code = FETCH_ABORTED_CODE;
    return e;
}

/**
 * `fetch`, with a deadline — and, since v20.56, with the caller's own `signal` honoured.
 *
 * @param {string} url
 * @param {RequestInit} [options] `options.signal`, when supplied, can cancel the request; the
 *   resulting error carries `FETCH_ABORTED_CODE`, never `FETCH_TIMEOUT_CODE`.
 * @param {number} [timeoutMs] budget in ms — pick it from the endpoint's own `timeoutSeconds`
 * @returns {Promise<Response>}
 * @throws {Error} `.code === FETCH_TIMEOUT_CODE` when our budget expired, `FETCH_ABORTED_CODE` when
 *   the caller cancelled; otherwise whatever fetch threw
 */
export async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS) {
    const callerSignal = options.signal || null;

    // No AbortController (very old browser): still better to make the call than to refuse it. The
    // caller loses the bound, which is exactly where it was before this module existed.
    if (typeof AbortController !== 'function') return fetch(url, options);

    // Already cancelled before we started — never open the connection at all.
    if (callerSignal && callerSignal.aborted) throw abortedError();

    const ctrl = new AbortController();
    let timedOut = false;
    const onCallerAbort = () => { try { ctrl.abort(); } catch { /* noop */ } };
    if (callerSignal) callerSignal.addEventListener('abort', onCallerAbort);
    const timer = setTimeout(() => { timedOut = true; try { ctrl.abort(); } catch { /* noop */ } }, timeoutMs);
    try {
        return await fetch(url, { ...options, signal: ctrl.signal });
    } catch (err) {
        // Three-way, and the ORDER is the policy: when the caller cancelled AND our budget expired,
        // the timeout wins, because "go and check" is the safe direction to be wrong in.
        if (timedOut) {
            const e = new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s`);
            /** @type {any} */ (e).code = FETCH_TIMEOUT_CODE;
            throw e;
        }
        // Ours did not fire, so an abort that reached us came from the caller's signal. Anything
        // else — a network failure, a foreign abort we were never given — passes straight through.
        if (callerSignal && callerSignal.aborted) throw abortedError();
        throw err;
    } finally {
        clearTimeout(timer);
        if (callerSignal) callerSignal.removeEventListener('abort', onCallerAbort);
    }
}

/** True when `err` is the bound firing rather than a network or HTTP failure. */
export function isFetchTimeout(/** @type {any} */ err) {
    return !!err && err.code === FETCH_TIMEOUT_CODE;
}

/** True when `err` is the CALLER's own cancellation — never our bound. */
export function isFetchAborted(/** @type {any} */ err) {
    return !!err && err.code === FETCH_ABORTED_CODE;
}
