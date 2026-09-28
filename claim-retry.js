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
 * Is this failure "you are not allowed to read that" rather than "the network is poor"?
 *
 * THE TWO NEED DIFFERENT WORDS, and the app has said so since v20.40 — `calendar-access.js`'s
 * `handleAccessLost` states it plainly: an endless "couldn't update, tap to retry" against an
 * expired session "is a loop the member cannot win, and they would reasonably conclude the app is
 * broken." Telling somebody on a shift to check their signal, when the truth is that their session
 * has gone, sends them to fix the one thing that is not wrong.
 *
 * EXTRACTED AT v23.41 FROM TWO BYTE-IDENTICAL PRIVATE COPIES (`calendar-initial-fetch.js` and
 * `calendar-overrides.js`), because a THIRD consumer arrived — the nav drawer's Circular/Newsletter
 * tap, which was reporting a v23.18 rules refusal as a connection failure on all six non-Calendar
 * pages. A rule with two copies and a third site that needed it and did not have it is a rule with
 * one home and two accidents.
 *
 * Matched on Firestore's own `permission-denied` code PLUS the Calendar gate's local sentinel,
 * because the two arrive by different routes and mean the same thing to the member. `err.message`
 * is read as well as `err.code`: not every rejection that reaches a caller is a FirebaseError —
 * a wrapper may have re-thrown, and the code is what production gives while the message is what a
 * hand-built rejection carries. Anything else — offline, a timeout, a transient 5xx — is a network
 * failure and keeps whatever retry affordance the caller offers, which is right for those.
 *
 * @param {any} err
 * @returns {boolean}
 */
export function isAccessFailure(err) {
    const code = err && (err.code || err.message);
    return code === 'permission-denied' || code === 'calendar-access-required'
        || (typeof code === 'string' && code.includes('permission-denied'));
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

/** The code a request rejects with when its account signs out before it settles. */
export const SIGNED_OUT_CODE = 'auth/signed-out-during-request';

/**
 * The one sentence every write surface uses for SIGNED_OUT_CODE (v24.37). "Confirmed", never
 * "failed": the write is held for that account and usually lands when the same member signs back
 * in, so a surface saying "failed — try again" invited a second copy of something already queued.
 * @param {string} what         the thing written, e.g. 'this delete'
 * @param {string} whereToCheck where the reader can see whether it landed
 * @returns {string}
 */
export function signedOutLine(what, whereToCheck) {
    return `You were signed out before ${what} was confirmed. Sign in again, then check ${whereToCheck}.`;
}

// ── ONE WRITE OF UNKNOWN OUTCOME STOPS THE NEXT (v24.39, external review) ──────────────────────
//
// abandonOnSignOut ends the WAIT; it does not cancel the WRITE, which Firestore keeps for that
// account and may still send. Every caller written before v24.36 assumed "rejected = not written",
// and where a save mints fresh document ids — roster import, a long leave range, a new Links design
// — a second attempt then wrote a SECOND copy beside the first, with nothing on screen to say so and
// no rule to stop it (overrides have no uniqueness on member + date). A duplicate override also
// resurfaces later: delete the winning copy and the other one takes its place.
//
// So the rule is made once, here, rather than remembered at every caller: once a write on this page
// has ended unconfirmed, no new write starts until the page is reloaded — and a reload re-reads the
// store, where a write still held for this account shows as pending. Reads are unaffected.

/** The code a write is refused with while an earlier one on this page is unconfirmed. */
export const UNCONFIRMED_CODE = 'writes/unconfirmed';

/** What the reader is told when that happens. */
export const UNCONFIRMED_LINE = 'An earlier change on this page was not confirmed. Reload the page before making another, so what actually saved is on screen.';

let _unconfirmedWrites = 0;

/** @returns {boolean} Has a write on this page ended with its outcome unknown? */
export function hasUnconfirmedWrite() { return _unconfirmedWrites > 0; }

/** Test seam only — a page's state lasts until reload, so nothing in the app resets it. */
export function _resetUnconfirmedWrites() { _unconfirmedWrites = 0; }

/**
 * Run a WRITE through the gate: refused while an earlier write is unconfirmed, and recorded as
 * unconfirmed itself if it ends with SIGNED_OUT_CODE. Pass-through otherwise.
 * @template T
 * @param {() => Promise<T>} run
 * @returns {Promise<T>}
 */
export async function runGatedWrite(run) {
    if (_unconfirmedWrites) throw Object.assign(new Error(UNCONFIRMED_LINE), { code: UNCONFIRMED_CODE });
    try {
        return await run();
    } catch (err) {
        if (/** @type {any} */ (err)?.code === SIGNED_OUT_CODE) _unconfirmedWrites++;
        throw err;
    }
}

/**
 * The line for a write whose outcome is unknown — signed out mid-write, or refused because an
 * earlier one was — or null for any other error, which keeps the caller's own wording.
 * @param {any} err
 * @param {string} what          the thing written, e.g. 'this delete'
 * @param {string} whereToCheck  where the reader can see whether it landed
 * @returns {string|null}
 */
export function unconfirmedWriteLine(err, what, whereToCheck) {
    if (err?.code === SIGNED_OUT_CODE) return signedOutLine(what, whereToCheck);
    if (err?.code === UNCONFIRMED_CODE) return UNCONFIRMED_LINE;
    return null;
}

/**
 * What a failed Admin save tells the person who pressed Save. Three causes, three instructions: an
 * account that went mid-save (the change may still send once they sign back in, so it is called
 * unconfirmed, never lost), a refusal, and everything else.
 * @param {any} err
 * @returns {string}
 */
export function saveFailureMessage(err) {
    if (err?.code === SIGNED_OUT_CODE) return signedOutLine('this change', 'Saved Changes');
    if (err?.code === UNCONFIRMED_CODE) return UNCONFIRMED_LINE;
    if (err?.code === 'permission-denied') return "Couldn't save — you may have been signed out. Please sign in again.";
    return "Couldn't save — check your connection and try again.";
}

/**
 * Stop waiting for a request once the account it was made as is gone.
 *
 * ── WHY (v24.36) ─────────────────────────────────────────────────────────────────────────────────
 *
 * A manager's or member's save sat on "Saving…" for good. Both halves of the cause are in the SDKs,
 * read in node_modules rather than assumed:
 *
 *   1. Firebase Auth signs the user out when a token refresh is REFUSED — `user-token-expired` or
 *      `user-disabled` (`_logoutIfInvalidated`). A refresh token is refused after an admin reset
 *      from Operations, after the member changes their password on another device, and after Set up
 *      accounts takes an account back — each revokes the account's other sessions. The ID token
 *      lasts an hour, so the first write after that hour is the one that finds out.
 *   2. Firestore then switches to the new (signed-out) user and does NOT settle the old user's
 *      commit promises: it keeps them per user, and rejects only `waitForPendingWrites` on a user
 *      change (`syncEngineHandleCredentialChange`). The write stays queued for that account and
 *      sends if the same member signs in again — which is why the earlier report found the change
 *      saved after reopening the app.
 *
 * So `batch.commit()` never answers, and the admin's own account — never reset, never revoked —
 * was the one account that could not see it. This rejects with SIGNED_OUT_CODE the moment the
 * signed-in account stops being `uid`, so the caller's catch runs and says what happened.
 *
 * It does NOT claim the write failed: it may still send when that member signs back in. Callers
 * word it as unconfirmed. With no account at the start there is nothing to lose, and the request is
 * returned unwatched.
 *
 * @template T
 * @param {Promise<T>} request
 * @param {{ uid: string|null|undefined, watch: (cb: (user: { uid: string }|null) => void) => () => void }} deps
 *   `watch` subscribes to auth state and returns an unsubscribe (onAuthStateChanged's shape).
 * @returns {Promise<T>}
 */
export function abandonOnSignOut(request, { uid, watch }) {
    if (!uid) return request;
    /** @type {() => void} */ let stop = () => {};
    let done = false;
    const lost = new Promise((_, reject) => {
        const unsub = watch(user => {
            if (done || (user && user.uid === uid)) return;
            reject(Object.assign(new Error('Signed out before the request settled'), { code: SIGNED_OUT_CODE }));
        });
        // Detach at once if the request already settled while `watch` was subscribing.
        if (done) unsub(); else stop = unsub;
    });
    const settle = () => { done = true; stop(); };
    request.then(settle, settle);
    lost.catch(settle);
    return Promise.race([request, lost]);
}

/**
 * Call `onLost` ONCE when this page's account has GONE — nobody signed in, and still nobody after
 * `settleMs` — while the page's own session still names the member it was opened for (v24.37;
 * narrowed v24.38).
 *
 * The other half of abandonOnSignOut. That one ends the wait and says "sign in again", but a page
 * that has already shown itself has no sign-in box until it is reloaded, so the instruction had
 * nowhere to be followed. The caller shows its sign-in overlay from `onLost`.
 *
 * ── WHY IT WAITS, AND WHY A DIFFERENT ACCOUNT IS NOT A LOSS (v24.38) ─────────────────────────────
 *
 * Firebase shares one signed-in account across every tab of a browser (`_onStorageEvent`). v24.37
 * fired on ANY change, so on a shared PC with Admin left open, a colleague signing in from another
 * tab — which signs the old account out and then the new one in — looked like a revocation here,
 * and this tab's re-login cleared the shared session and signed the COLLEAGUE out. Now:
 *   · a different account arriving is somebody else's sign-in, never ours to undo;
 *   · a sign-out is judged only after it has LASTED `settleMs`, which a sign-out-then-sign-in never
 *     does, and only if `stillLost()` still says so then — the caller answers "no account now, and
 *     the local session still names this page's member". A deliberate Sign out clears that session
 *     first, so it answers false and nothing is shown.
 *
 * @param {{ uid: string|null|undefined, watch: (cb: (user: { uid: string }|null) => void) => () => void,
 *           stillLost: () => boolean, onLost: () => void, settleMs?: number,
 *           setTimer?: (fn: () => void, ms: number) => any, clearTimer?: (id: any) => void }} deps
 * @returns {() => void} unsubscribe
 */
export function watchIdentityLoss({ uid, watch, stillLost, onLost, settleMs = 3000,
                                    setTimer = setTimeout, clearTimer = clearTimeout }) {
    if (!uid) return () => {};
    let fired = false;
    /** @type {any} */ let pending = null;
    /** @type {() => void} */ let stop = () => {};
    const unsub = watch(user => {
        if (fired) return;
        if (user) { if (pending !== null) { clearTimer(pending); pending = null; } return; }   // back, or someone else's sign-in
        if (pending !== null) return;
        pending = setTimer(() => {
            pending = null;
            if (fired || !stillLost()) return;
            fired = true;
            stop();
            onLost();
        }, settleMs);
    });
    stop = () => { if (pending !== null) { clearTimer(pending); pending = null; } unsub(); };
    return stop;
}
