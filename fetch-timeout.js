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
 */

/** Thrown-error `code` when OUR bound fired, as opposed to a network error or an HTTP status. */
export const FETCH_TIMEOUT_CODE = 'myb/fetch-timeout';

/** Fallback budget for a caller that does not name one. Deliberately generous — see the header. */
export const DEFAULT_FETCH_TIMEOUT_MS = 65_000;

/**
 * `fetch`, with a deadline.
 *
 * @param {string} url
 * @param {RequestInit} [options]
 * @param {number} [timeoutMs] budget in ms — pick it from the endpoint's own `timeoutSeconds`
 * @returns {Promise<Response>}
 * @throws {Error} on timeout, with `.code === FETCH_TIMEOUT_CODE`; otherwise whatever fetch threw
 */
export async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS) {
    // No AbortController (very old browser): still better to make the call than to refuse it. The
    // caller loses the bound, which is exactly where it was before this module existed.
    if (typeof AbortController !== 'function') return fetch(url, options);

    const ctrl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; try { ctrl.abort(); } catch { /* noop */ } }, timeoutMs);
    try {
        return await fetch(url, { ...options, signal: ctrl.signal });
    } catch (err) {
        // Distinguish OUR abort from any other failure. Without the `timedOut` flag an abort from
        // elsewhere (a caller's own signal, a navigation) would be misreported as a timeout.
        if (timedOut) {
            const e = new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s`);
            /** @type {any} */ (e).code = FETCH_TIMEOUT_CODE;
            throw e;
        }
        throw err;
    } finally {
        clearTimeout(timer);
    }
}

/** True when `err` is the bound firing rather than a network or HTTP failure. */
export function isFetchTimeout(/** @type {any} */ err) {
    return !!err && err.code === FETCH_TIMEOUT_CODE;
}
