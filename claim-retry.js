// @ts-check
/**
 * claim-retry.js — pure "self-heal a stale-claim rejection once" runner.
 *
 * Extracted from firebase-client.js (v18.28) so the SECURITY-CRITICAL retry DECISION is unit-testable
 * in Node: firebase-client.js pulls the Firebase SDK from the gstatic CDN and cannot load in a test,
 * so the retry logic every Admin/manager write depends on had no direct coverage — only a
 * re-implemented parity copy in admin-roster-upload.test.mjs. This module has no Firebase/DOM
 * dependency; the caller injects `hasUser()` and `refresh()`.
 *
 * Background: a freshly-provisioned or claim-changed manager/admin can appear signed in yet hold a
 * Firebase ID token minted BEFORE their claim existed (Firebase refreshes ID tokens only ~hourly).
 * The per-member override-isolation rule then rejects their on-behalf write with `permission-denied`
 * (or `storage/unauthorized` on the Storage path) until the token naturally refreshes. Forcing one
 * token refresh + one retry picks up the claim immediately, so the user isn't told to "sign out and
 * back in" for what is really a stale token.
 */

/**
 * True iff `err` is the retryable stale-claim rejection AND a user is present.
 * @param {any} err
 * @param {string} retryCode  the SDK error code that indicates a (possibly) stale claim
 * @param {boolean} hasUser
 * @returns {boolean}
 */
export function isClaimRetryable(err, retryCode, hasUser) {
    return !!(err && err.code === retryCode && hasUser);
}

/**
 * Run `fn`; if it rejects with `err.code === retryCode` and a user is present, force a token refresh
 * then retry ONCE. If the refresh itself throws (offline/flaky), re-throw the ORIGINAL error — never
 * let a connectivity error REPLACE a genuine authorisation denial, because callers key their
 * user-facing message on `err.code`. Any non-retryable error re-throws immediately; at most one
 * retry, so a truly forbidden operation still surfaces to the caller's catch.
 *
 * `fn` MUST be re-runnable: a Firestore write thunk must build a FRESH `WriteBatch` each call — a
 * committed (even failed-commit) batch cannot be re-committed. Whatever `fn` returns passes through.
 *
 * @template T
 * @param {() => Promise<T>} fn
 * @param {{ retryCode: string, hasUser: () => boolean, refresh: () => Promise<any> }} deps
 * @returns {Promise<T>}
 */
export async function runWithClaimRetry(fn, { retryCode, hasUser, refresh }) {
    try {
        return await fn();
    } catch (err) {
        // hasUser() is read synchronously immediately before refresh() with no await between, so the
        // signed-in user cannot change underneath us here (single-threaded event loop).
        if (isClaimRetryable(err, retryCode, hasUser())) {
            try {
                await refresh();               // force refresh → pick up the newly-set claim
            } catch {
                throw err;                     // preserve the original permission-denied / unauthorized
            }
            return await fn();                 // retry once with the fresh token
        }
        throw err;
    }
}
