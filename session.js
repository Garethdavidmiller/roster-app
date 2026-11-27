// @ts-check
/**
 * session.js — Shared auth/session helpers for every protected page and the Calendar. What each
 * importer pulls varies; grep the import rather than trusting a list here.
 *
 * Owns: session constants, localStorage session read/write/clear, the Firebase Auth sign-in
 *   lifecycle (ensureNamedSession → ensureFirebaseSession), and the expired-identity teardown.
 * Does NOT own: the sign-in UI (login-overlay.js), what a page does when its session fails
 *   (page-session.js), page access (auth-policy.js), Firestore writes, or how an account's email
 *   and surname default are derived (auth-identity.js — its header carries the lock-out warning).
 * Edit here for: session expiry, Firebase Auth strategy.
 */

import { auth, authReady, currentUserAfterBoot, nameToEmail, signInWithEmailAndPassword, signOut as firebaseSignOut, probeResetAtMs } from './firebase-client.js';
import { surnamePassword, credentialCandidatesFor, isCredentialRejection, sessionPredatesReset } from './auth-identity.js';
import { noDefaultKey, planSilentAttempt, afterRecheck, remembersRefusal, sessionStartMs, renewedExpiry, AUTH_RESTORE_TIMEOUT_MS } from './silent-sign-in.js';
import { lsGet, lsSet, lsDel } from './ls.js';
import { CALENDAR_SNAPSHOT } from './storage-keys.js';
import { CONFIG } from './roster-data.js';
import { dispatchAuth } from './auth-state.js';

// A DEFINITIVE credential rejection — a wrong password, or no such account — as opposed to a
// transient/config failure (network, provider-disabled), is `isCredentialRejection` (auth-identity.js),
// the SAME predicate the Settings reauth uses, so the two candidate ladders can't drift. On one the
// sign-in resolves to 'none' + a re-sign-in prompt, NEVER an anonymous fallback (AUTH_AND_SESSIONS.md
// → "A credential rejection never falls back"): the strict B3 rules would silently deny every write an anonymous session made.

/**
 * Feed the auth STORE (AUTH_AND_SESSIONS.md → Architecture, the store). A pure side-effect, wrapped so a store error
 * can NEVER break the auth path; session.js still owns the Firebase lifecycle. The store is read once
 * per page: every named page's `guardNamedSession` (page-session.js) and the Pay Calculator, through
 * `getAuthSnapshot()` + `requirePage()` (auth-policy.js), and the forced password overlay.
 * @param {{ type: string, member?: string|null, error?: string|null }} event
 */
function _feedAuth(event) {
    try { dispatchAuth(event); } catch (e) { console.error('[Auth] store feed failed', e); }
}

/** Translate the resolved Firebase identity (the B0 signals) into a terminal store event — one of
 *  the three `terminalAuthEvent` returns: NAMED, TRANSIENT (nothing could be decided) or NONE (a
 *  refusal). The write pages never fall back to an anonymous session, so the store's `ANONYMOUS`
 *  and `FATAL` events have no producer here. */
function _syncAuthTerminal(/** @type {string} */ name) {
    const ev = terminalAuthEvent({ named: getFirebaseIdentity() === 'named', stalled: _authStartStalled, error: getFirebaseAuthError() ?? null });
    _feedAuth(ev.type === 'NAMED' ? { ...ev, member: name } : ev);
}

/**
 * The store event a resolved sign-in ends on. Pure, so the one rule in it can be pinned:
 *
 * A STALLED START-UP IS NOT A SIGN-OUT (iOS audit B1). When Firebase Auth's own start-up outruns
 * `AUTH_READY_TIMEOUT_MS` — a hanging connection at the station, a captive portal, iOS waking the
 * app on a dead radio — nothing is known about the member either way. As `NONE` it would clear the
 * 60-day local session: a slow network would sign people out. `TRANSIENT` reads as `degraded` and the
 * policy as `pending`, so the page keeps the session, shows its sign-in WITHOUT clearing, and reloads
 * into the identity if it lands late. A genuine refusal (wrong password, no account, a disabled
 * login) is still `NONE`; a failure that could not reach an answer is `TRANSIENT` too (below).
 * @param {{ named: boolean, stalled: boolean, error: string|null }} r
 * @returns {{ type: 'NAMED' } | { type: 'TRANSIENT', error: string } | { type: 'NONE', error: string|null }}
 */
export function terminalAuthEvent({ named, stalled, error }) {
    if (named)   return { type: 'NAMED' };
    if (stalled) return { type: 'TRANSIENT', error: error ?? 'auth/timeout' };
    // NOR IS A FAILURE THAT NEVER REACHED AN ANSWER. A network error, an unreachable reset check,
    // Firebase's own internal error or a rate limit says nothing about the member either; as `NONE`
    // they would clear the 60-day session on a weak connection (AUTH_AND_SESSIONS.md 23: "destroys
    // nothing"). The same codes the retry treats as transient, so the two cannot disagree.
    if (isTransientAuthError(error ?? undefined)) return { type: 'TRANSIENT', error: /** @type {string} */ (error) };
    return { type: 'NONE', error };
}

export const AUTH_KEY    = 'myb_admin_session';
export const SESSION_MS  = 60 * 24 * 60 * 60 * 1000; // 60 days — the ONE session lifetime
export const SESSION_VER = 2; // bump to force all existing sessions to re-login

// 60 DAYS (owner), and NO idle cutoff (AUTH_AND_SESSIONS.md 2) — renewed on each open in the INSTALLED
// app only (`renewInstalledSession`; owner, 26 Nov 2026). The bound is not what
// protects an account: every genuine revocation is immediate and independent of it — `clearSession`
// (which signs Firebase out too), a disabled or deleted account, revoked credentials, the claim
// sweeps. One thing READS this number: Operations → Usage's "signed in within 30 days" (the note
// beside `_appendSignInSection`, operations-usage.js). The forced password step used to wait for it;
// it now asks on an ordinary open too (password-force.js). The idle clock only ever signed out the
// members who use the app least.
// Removed rather than lengthened: a dormant policy gets "restored" by someone who assumes it was
// load-bearing.

/** @type {(value: any) => void} */
let _sessionResolve;
/**
 * Module-level promise that resolves once the Firebase Auth session for this
 * page is confirmed. Page coordinators call resolveSession(); feature modules
 * import sessionReady and await it instead of reading window._mybSession.
 *
 * Resolves to true (session active), false (session failed or non-auth path),
 * or the boolean returned by ensureNamedSession().
 * @type {Promise<boolean>}
 */
export const sessionReady = /** @type {Promise<boolean>} */ (new Promise(r => (_sessionResolve = r)));
/**
 * Call once per page-load from the page coordinator, with what its sign-in answered. Pages call
 * ensureNamedSession(), never ensureFirebaseSession() — that is the sign-in inside it.
 * @param {boolean | Promise<boolean>} result - pass the return value of ensureNamedSession()
 *   directly (Promise<boolean>) or a plain boolean (false) on the non-auth path.
 *   JS Promise resolution procedure follows the inner Promise, so awaiting sessionReady
 *   always yields the final boolean regardless of which form is passed.
 * @returns {void}
 */
export function resolveSession(result) { _sessionResolve(result); }

/**
 * The Firebase Auth identity that `ensureFirebaseSession` last established — on a protected page,
 * or through the Calendar's member card. The Calendar's own access decision (`calendarAuthReady`,
 * calendar-access.js) reads the restored user instead and never consults this.
 *
 *   'named'     — signed in as the member's own account (email === nameToEmail(name)).
 *   'none'      — no named session could be established. There is NO anonymous third value: a
 *                 nameless session satisfies `request.auth != null` and nothing else, and the strict
 *                 rules (B3; the server-set `member` claim) refuse every write it could make
 *                 (AUTH_AND_SESSIONS.md 9). The store prompts a re-login.
 * @type {'named' | 'none'}
 */
let _fbIdentity = 'none';

/** @type {string | undefined} The auth error code behind the last non-'named' outcome, for diagnostics. */
let _fbAuthError;

/** How long a page waits for Firebase Auth to start before treating it as a (transient) failure. */
const AUTH_READY_TIMEOUT_MS = 20000;
/** Monotonic auth-attempt generation (stale-completion guard). `runNamedSignIn` time-boxes the auth
 *  promise but cannot CANCEL the underlying Firebase work, so a timed-out attempt can resolve LATE —
 *  after a newer attempt already won. A superseded attempt (its captured gen ≠ this counter) must drop
 *  ALL its terminal writes so it can't clobber the shared `_fbIdentity`/auth-store to a stale value.
 *  Each `ensureNamedSession` bumps it; `ensureFirebaseSession` inherits or (direct call) bumps. */
let _authGen = 0;
/** The generation an explicit clearSession() took — see the late-landing check in ensureFirebaseSession. */
let _clearedGen = -1;
/** The attempt whose surname recheck got no answer — see the recheck in ensureFirebaseSession. */
let _recheckUnansweredGen = -1;
/** The member the CURRENT generation is signing in — see the same check. @type {string|null} */
let _genName = null;

/**
 * The Firebase identity `ensureFirebaseSession` last established on a write page.
 * Exported for the tests (session.test.mjs), which read the outcome through it; nothing else imports it.
 * @returns {'named' | 'none'}
 */
export function getFirebaseIdentity() { return _fbIdentity; }

/**
 * True only when the active write-page Firebase session is the member's own named account.
 * Exported for the tests; in the app only this module asks it (the claim-refresh sweep below).
 * @returns {boolean}
 */
export function firebaseSessionIsNamed() { return _fbIdentity === 'named'; }

/**
 * True when the LIVE Firebase user is this member's own account — ground truth (`auth.currentUser`), read as
 * the superseded-attempt check in `ensureNamedSession` reads it, never the shared `_fbIdentity` a newer attempt
 * may have moved. The sign-in card asks it before opening the page on a late answer it held back while a retry
 * was in flight: a sign-out since, here or in another tab, has signed Firebase out, and the answer then opens nothing.
 * @param {string} name
 * @returns {boolean}
 */
export function signedInAs(name) {
    const u = auth.currentUser;
    return !!u && !u.isAnonymous && u.email === nameToEmail(name);
}

/**
 * The auth error code behind the last non-'named' `ensureFirebaseSession` outcome, or undefined.
 * @returns {string | undefined}
 */
export function getFirebaseAuthError() { return _fbAuthError; }

/** Ceiling on the IndexedDB auth restore — the one "how long is Firebase allowed to take" number,
 *  defined in silent-sign-in.js (which says why there) and re-exported for this module's importers. */
export { AUTH_RESTORE_TIMEOUT_MS };

/**
 * Resolve the first onAuthStateChanged emission (the IndexedDB session restore) once.
 * Exported so pages that must read `auth.currentUser` after the async restore (e.g.
 * admin-auth.js before calling setupRosterAuth) share ONE implementation instead of
 * hand-rolling their own. Callers wanting the fast path use
 * `auth.currentUser || await restoreFirstAuthUser()`.
 *
 * ── BOUNDED ──────────────────────────────────────────────────────────────────────────────────────
 * The bound belongs in the SHARED primitive, not in whichever coordinator remembered to add one.
 * **It resolves `null` on timeout rather than rejecting, deliberately.** Every call site (grep for
 * `restoreFirstAuthUser`) already handles a null user as the ordinary "nobody is signed in" answer;
 * rejecting would introduce an unhandled rejection where there is no catch, on a path that only fires
 * when something is already wrong. The bound is generous: firing early on a merely-slow restore would
 * tell a signed-in admin their session is missing. 8s is a hang, not a slow phone.
 *
 * It opens no subscription of its own: it delegates to the one boot answer (`authBootstrap` in
 * firebase-client.js), keeping its bound as a ceiling on the shared wait. The value is GROUND TRUTH,
 * not the boot snapshot: a member who signed out after boot is reported as signed out.
 * @param {number} [timeoutMs] override, for tests
 * @returns {Promise<any>} the restored user, or null (no user, or the restore never answered)
 */
export function restoreFirstAuthUser(timeoutMs = AUTH_RESTORE_TIMEOUT_MS) {
    return currentUserAfterBoot(timeoutMs);
}

/** Pre-warmed restore promise from primeAuth(), consumed exactly once by ensureFirebaseSession.
 *  @type {Promise<any>|null} */
let _primedAuthUser = null;
let _authPrimed     = false;

/** Take the pre-warmed restore promise if one is pending (one-shot). Returns null when not primed,
 *  so the caller falls back to a fresh restore. @returns {Promise<any>|null} */
function _consumePrimedAuthUser() {
    const p = _primedAuthUser;
    _primedAuthUser = null;
    return p;
}

/**
 * Pre-warm Firebase Auth restoration BEFORE the user submits the login form — call when the login
 * overlay mounts. It starts `authReady` (persistence setup) and the first `onAuthStateChanged`
 * emission in the background, so the restore overlaps the user's typing.
 *
 * Idempotent and best-effort: a failure resolves to null, so `ensureFirebaseSession` simply does the
 * restore itself. It changes NO security and NO outcome — pure latency overlap. (One-shot per page:
 * `_authPrimed` is not reset after consumption, so only the first sign-in attempt benefits.)
 * @returns {void}
 */
export function primeAuth() {
    if (_authPrimed) return;
    _authPrimed = true;
    _primedAuthUser = Promise.resolve(authReady)
        .then(() => restoreFirstAuthUser())
        .catch(() => null);
}

// The sign-in nobody typed — the device-local memory that a member's account does NOT accept the
// surname default, its six-hourly reset recheck, and the guard on a recheck nobody answered — is
// decided in silent-sign-in.js (pure, with the reasoning). This module reads and writes the memory.

/**
 * Guarantee a live Firebase Auth session for a logged-in member.
 *
 * Firestore Security Rules refuse every write that carries no claim — a member's own needs their
 * bound name (AUTH_AND_SESSIONS.md 4, 9, 19), which only their own signed-in account has.
 * A returning user with a valid 60-day localStorage session skips the login click handler, so
 * without this the Firebase Auth session would never be (re-)established on a normal app open.
 *
 * Strategy:
 * 1. Restore persisted session from IndexedDB — free, no network.
 * 2. signInWithEmailAndPassword — the password candidates, in order.
 * 3. Otherwise 'none'. There is no account self-heal (accounts are provisioned server-side by
 *    Operations → Set up accounts) and no anonymous fallback: the strict rules refuse a session
 *    either would make. The error code from step 2 is exposed via getFirebaseAuthError().
 *
 * @param {string} name - Member display name (exact teamMembers match)
 * @param {number} [_gen] - Internal: the caller's auth-attempt generation (stale-completion guard).
 *   ensureNamedSession passes its generation; omit on a direct call and a fresh one is taken.
 * @param {string} [password] - The password the member TYPED at the login field. When present, the
 *   gated dual-attempt (auth-identity.credentialCandidatesFor, whose header argues the order): the
 *   typed value, or ONLY if it normalises to the surname, the surname first. When ABSENT (a page-load
 *   re-establishment with no typed value), only the derived surname is tried — auto-reauth of an
 *   un-migrated member; a MIGRATED member fails cleanly and the page re-shows the login overlay
 *   (AUTH_AND_SESSIONS.md → "Re-establishing on page load").
 * @returns {Promise<boolean>} true if a Firebase Auth session is active afterwards
 */
export async function ensureFirebaseSession(name, _gen, password) {
    // Generation guard (see `_authGen`). ensureNamedSession passes its generation in; a direct call
    // (e.g. tests) takes a fresh one. A superseded attempt drops its terminal writes via `commit`/
    // `recordError` so a late completion can't clobber a newer attempt's identity/diagnostics.
    const gen = _gen ?? ++_authGen;
    if (_gen == null) _genName = name;
    const fresh = () => gen === _authGen;
    /** Publish the winning identity, then return `result` — only if this attempt is still current.
     *  @param {'named'|'none'} identity @param {boolean} result @returns {boolean} */
    const commit = (identity, result) => { if (fresh()) _fbIdentity = identity; return result; };
    /** Record auth-error diagnostics for the CURRENT attempt only. @param {string|undefined} code */
    const recordError = (code) => {
        if (!fresh()) return;
        _fbAuthError = code;   // read via getFirebaseAuthError() (admin-auth.js, login-overlay.js, operations-app.js)
    };

    // Reset for this attempt — but ONLY while it is still current. A SUPERSEDED retry must NOT run
    // this reset: commit/recordError below are gen-guarded, but an unguarded reset would clobber the
    // winner's `_fbIdentity` to 'none' and leave the store reading 'named' while the global reads 'none'.
    if (fresh()) { _fbIdentity = 'none'; _fbAuthError = undefined; }
    // BOUNDED. `authReady` waits on Firebase Auth's own start-up, which has no limit of its own; with
    // the browser's storage wedged it never settled, and every protected page sat with sessionReady
    // pending — no sign-in offered, no error. A timeout is TRANSIENT, so ensureNamedSession still
    // retries it before the page falls back to its sign-in.
    /** @type {any} */ let _readyTimer;
    const _ready = await Promise.race([
        authReady.then(() => true),
        new Promise(r => { _readyTimer = setTimeout(() => r(false), AUTH_READY_TIMEOUT_MS); }),
    ]);
    clearTimeout(_readyTimer);
    if (!_ready) { recordError('auth/timeout'); if (fresh()) _authStartStalled = true; return commit('none', false); }
    // First auth state for this restore. Fast path: if auth.currentUser is ALREADY populated (a live
    // session — e.g. the SECOND ensureFirebaseSession of an in-place sign-in), use it synchronously.
    // It is null during a cold IndexedDB restore, so otherwise we wait for the first emission.
    // Priming overlaps the WAIT with the user's typing; the VALUE is always read fresh: the primed
    // promise may be minutes old, so on a shared device a second member's sign-in could read the
    // first member's restored user out of it. Awaiting it purely for its TIMING keeps the latency win
    // with none of the hazard. `await null` is a no-op, so the un-primed path is unchanged.
    await _consumePrimedAuthUser();
    const existing = auth.currentUser || await restoreFirstAuthUser();
    // Gen-guard EVERY shared-auth mutation from here down: a SUPERSEDED attempt resuming after this
    // long await — the sign-out on the mismatch path, or the signInWithEmailAndPassword calls on the
    // cold-load path — would otherwise replace the WINNING attempt's session on the shared `auth`,
    // leaving the store reading 'named' for the winner while auth.currentUser holds someone else
    // (silent permission-denied writes). The matching-user fast path stays safe for a stale gen:
    // commit() no-ops the global write.
    // NOT when a password was TYPED: that is an explicit sign-in, and a restored session for the same
    // member is no proof the typed password is right — this path would renew an expired 60-day session
    // with ANY password during the boot window. So the typed password always goes to Firebase below.
    const sameMember = !!existing && !existing.isAnonymous && existing.email === nameToEmail(name);
    if (password == null && sameMember) return commit('named', true);
    if (!fresh()) return commit('none', false);
    // Only reuse a persisted session when it belongs to the expected user.
    // An anonymous fallback session, or a session for a different member (e.g.
    // Person A was active on a shared browser and Person B now selects their name),
    // must not be reused — sign out and re-authenticate under the correct identity.
    //
    // THE SAME MEMBER'S RESTORED ACCOUNT IS NOT SIGNED OUT FIRST. One mistyped password would destroy
    // a working sign-in — and Firebase shares one account across a browser's tabs, so every other tab
    // would run its relogin and clear the shared 60-day session. The typed password is still SENT
    // (above) and a wrong one still ends this attempt 'none'; Firebase leaves the current user as it
    // was on a refusal and replaces it on a success. A wrong password still never renews an expired
    // local session (AUTH_AND_SESSIONS 1): a failed attempt with none held for this member clears
    // (`runNamedSignIn`'s `keepsLocalSession`), and `clearSession` signs the restored account out.
    if (existing && !sameMember) {
        // A sign-out the browser cannot complete ENDS this attempt; it must never reject it
        // (sessions-4) — every write page hands this promise to resolveSession() with no catch.
        // Nothing is signed in past it. The code is TRANSIENT: a stored account the browser could not
        // delete (the SDK's auth/internal-error) says nothing about the member, and the SDK has already
        // dropped it from memory, so ensureNamedSession's retry finds nobody to sign out.
        try {
            await firebaseSignOut(auth);
        } catch (err) {
            console.warn('[Auth] could not sign out the account restored here — sign-in attempt ended:',
                /** @type {any} */ (err)?.code ?? /** @type {any} */ (err)?.message);
            recordError('auth/previous-user-shed-failed');
            return commit('none', false);
        }
        // Re-check the generation AFTER the sign-out await: an attempt superseded DURING
        // firebaseSignOut would otherwise run the sign-in calls below and replace the WINNING
        // attempt's session on the shared `auth` — every strict-rules write is then permission-denied
        // until the next page load (writeWithClaimRetry cannot heal a wrong-identity token).
        if (!fresh()) return commit('none', false);
    }

    const email = nameToEmail(name);
    // The ordered password candidates to try (AUTH_AND_SESSIONS.md → "The gated dual-attempt" and "Re-establishing on page load"). WITH a typed password
    // (login overlay): raw typed → derived surname (gated on the typed value normalising to the
    // surname). WITHOUT one (page-load re-establishment): the derived surname only, while this device
    // has not seen it refused, or a reset recheck is due — and a recheck nobody answered is asked once
    // per attempt (silent-sign-in.js has why).
    const plan = password == null
        ? planSilentAttempt({ surname: surnamePassword(name), stored: lsGet(noDefaultKey(name)), now: Date.now(), unansweredThisAttempt: _recheckUnansweredGen === gen })
        : { candidates: credentialCandidatesFor(name, password), recheck: false, held: false };
    if (plan.held) { recordError('auth/reset-check-unavailable'); return commit('none', false); }
    const { candidates, recheck } = plan;
    let   lastError;
    let   nonCredentialStop = false;   // true → we stopped on a NON-credential error (network etc.)

    for (const candidate of candidates) {
        if (!fresh()) return commit('none', false);
        // NOT A SESSION THE LAST RESET WAS AIMED AT (AUTH_AND_SESSIONS.md 23). A silent re-sign-in on
        // a session older than the member's last admin reset is exactly the lost phone the reset was
        // meant to sign out — and the reset just made the surname valid again. It is asked BEFORE
        // signing in because the sign-in itself announces and stores the user: asked afterwards, the
        // Calendar's late-identity watcher would grant the phone first. A TYPED sign-in never reaches
        // this (password != null).
        //   · predates the reset → refuse, end the local session, make the holder type a password
        //   · could not be confirmed → do not sign in silently, but DESTROY NOTHING: it is treated
        //     like a sign-in that could not reach the server, which is what it nearly always is
        //   · the probe says the password is wrong → remembered and stopped (below), never re-sent
        if (password == null) {
            const resetAt = await probeResetAtMs(email, candidate, name, 5000);
            if (!fresh()) return commit('none', false);
            // A flagged device's recheck: noted, stopped at a refused surname, or held (`afterRecheck`).
            const after = recheck ? afterRecheck(resetAt) : null;
            if (after?.note) lsSet(noDefaultKey(name), String(Date.now()));
            if (after?.stop) break;
            if (after?.unanswered) _recheckUnansweredGen = gen;
            // THE PROBE IS A SIGN-IN, SO ITS REFUSAL IS ONE. Going on to the SDK sign-in with the same
            // surname would send two wrong-password requests a load from the station's one address,
            // whose shared throttle is why the flag exists. Stop, remember it, and record a refusal's
            // code. 'credential' also covers no such account and a DISABLED one, which the probe cannot
            // tell apart from a wrong password: both get the flag and the code `auth/invalid-credential`
            // — on purpose (`isRestCredentialRejection` says why).
            if (resetAt === 'credential') {
                lsSet(noDefaultKey(name), String(Date.now()));
                lastError = 'auth/invalid-credential';
                break;
            }
            if (resetAt === null || resetAt === 'throttled') {
                recordError(resetAt === 'throttled' ? 'auth/too-many-requests' : 'auth/reset-check-unavailable');
                console.warn('[Auth] silent sign-in held — could not confirm the last password reset');
                return commit('none', false);
            }
            if (sessionPredatesReset(_sessionCreatedMs(), resetAt)) {
                // NAMED, as every other refusal here is, so getFirebaseAuthError() and Operations'
                // banner can tell it apart. Not transient — the session is gone, so nothing retries.
                recordError('auth/session-predates-reset');
                lsDel(AUTH_KEY);
                lsDel(CALENDAR_SNAPSHOT);
                // The device the reset was meant to sign out stops receiving that member's notices too.
                // No identity is current here, so the release drops the browser subscription instead.
                releasePushForEndingHold();
                console.warn('[Auth] silent sign-in refused — this device signed in before the last password reset');
                return commit('none', false);
            }
        }
        try {
            await signInWithEmailAndPassword(auth, email, candidate);
            // LANDED AFTER A SIGN-OUT. The login overlay's bound (SIGN_IN_GIVE_UP_MS) gives up, calls
            // clearSession(), and tells the member it failed — but the request can still land, leaving
            // Firebase signed in with no app session behind it on a shared device. Undo it only when a
            // clearSession() is the LAST thing that happened: a newer sign-in attempt superseding this
            // one owns the account and must be left alone.
            // The same holds when the attempt that superseded this one is for a DIFFERENT member:
            // landing late, this sign-in replaced theirs on the shared `auth`, so their page would
            // write with this account's token. Signing it out hands their page the identity-loss
            // sign-in instead — unless their sign-in has already landed on top, when it is theirs.
            const supersededByOther = _genName !== name
                && !(auth.currentUser?.email && auth.currentUser.email.toLowerCase() !== email.toLowerCase());
            if (!fresh() && (_authGen === _clearedGen || supersededByOther)) {
                await firebaseSignOut(auth).catch(() => {});
                return false;
            }
            // The surname default WORKED — the account is on it (or back on it, after an admin
            // reset), so the silent recovery must be re-armed for this device.
            if (candidate === surnamePassword(name)) lsDel(noDefaultKey(name));
            return commit('named', true);
        } catch (e) {
            const _e = /** @type {any} */ (e);
            lastError = _e.code;
            // The code only: the account's email IS the member's name, and the console of a shared PC
            // is readable by whoever opens its developer tools next.
            console.warn('[Auth] signIn failed:', _e.code);
            // The surname default was definitively REJECTED for an account that exists — a migrated
            // member. Remember it, so later implicit attempts stop repeating a doomed request.
            if (candidate === surnamePassword(name) && remembersRefusal(_e.code)) lsSet(noDefaultKey(name), String(Date.now()));
            // A definitive credential rejection for THIS candidate → try the next one (if any). A
            // NON-credential error (network / provider-disabled) → stop; it isn't a password problem.
            if (!isCredentialRejection(_e.code)) { nonCredentialStop = true; break; }
        }
    }

    recordError(lastError);   // diagnostics (current attempt only)

    // No named session. Resolve to 'none' + a re-sign-in prompt — NEVER anonymous, whichever way it
    // failed (AUTH_AND_SESSIONS.md → "A credential rejection never falls back"): a nameless session would satisfy `request.auth != null` and
    // nothing else, so the strict rules would silently deny every write it made. Definitive rejections
    // and NON-credential failures differ only in what the caller does next — `ensureNamedSession`
    // retries a transient code and nothing else.
    console.warn(nonCredentialStop
        ? '[Auth] Named session not established (non-credential failure). Error:'
        : '[Auth] Credential rejected (definitive). Error:', lastError);
    return commit('none', false);
}

/** Auth error codes worth a quiet retry — a momentary connectivity blip rather than a real
 *  credential/account problem. A persistent code (user-not-found / invalid-credential) is not
 *  retried; it needs a human (re-login or admin break-glass). @type {Set<string>} */
const _TRANSIENT_AUTH_CODES = new Set([
    'auth/network-request-failed', 'auth/timeout', 'auth/too-many-requests', 'auth/internal-error',
    // The pre-sign-in reset check could not get an answer: transient, so a blip is retried as a blip
    // on the sign-in itself is; and NAMED, so a probe that has stopped working shows wherever a
    // sign-in error surfaces.
    'auth/reset-check-unavailable',
    // The account restored here could not be signed out before a member's sign-in (sessions-4) — the
    // same storage failure the SDK itself reports as auth/internal-error, above; named for what happened.
    'auth/previous-user-shed-failed',
]);

/** @param {string|undefined} code @returns {boolean} */
export function isTransientAuthError(code) { return !!code && _TRANSIENT_AUTH_CODES.has(code); }

/** Set when Firebase Auth's own START-UP outran AUTH_READY_TIMEOUT_MS. Every retry would wait on
 *  that same unsettled start-up again, so `ensureNamedSession` does not retry it: two retries
 *  turned the 20s bound into ~61s before the page offered its sign-in. */
let _authStartStalled = false;

/** Transient, AND worth retrying a moment later. A rate limit is not (another request only adds to
 *  it — the station NAT shares one address), and neither is a stalled start-up (above). */
function _worthRetrying() {
    const code = getFirebaseAuthError();
    return isTransientAuthError(code) && code !== 'auth/too-many-requests' && !_authStartStalled;
}

/**
 * Ensure the member's OWN named Firebase session for a write page (B1.2).
 *
 * A failed named sign-in is retried a couple of times ONLY if the error looks transient (a network
 * blip), then this returns whether the named session is genuinely active. Persistent failures (no
 * account / wrong password) are not retried — the caller prompts a re-login or routes to admin
 * break-glass.
 *
 * @param {string} name
 * @param {{ retries?: number, delayMs?: number, password?: string }} [opts] - `password` is the
 *   member's TYPED login password (login overlay); omit on a page-load re-establishment (the
 *   derived surname is tried automatically). Threaded to `ensureFirebaseSession`.
 * @returns {Promise<boolean>} true if it is safe to proceed (a named session is active)
 */
export async function ensureNamedSession(name, { retries = 2, delayMs = 300, password } = {}) {
    const gen = ++_authGen;   // generation guard — a superseded attempt must not publish a stale terminal state
    _genName = name;
    _feedAuth({ type: 'RESOLVE_START', member: name });   // store: resolving
    _authStartStalled = false;
    let ok = await ensureFirebaseSession(name, gen, password);
    let attempt = 0;
    // `gen === _authGen` stops a superseded attempt from continuing to retry (and dispatching stale events).
    while (!ok && attempt < retries && gen === _authGen && _worthRetrying()) {
        _feedAuth({ type: 'TRANSIENT', error: getFirebaseAuthError() ?? null });   // store: degraded
        attempt++;
        await new Promise(r => setTimeout(r, delayMs * attempt));
        _feedAuth({ type: 'RETRY' });   // store: resolving again
        ok = await ensureFirebaseSession(name, gen, password);
    }
    if (gen !== _authGen) {
        // Superseded by a newer attempt — MUST NOT publish terminal state (the newer attempt owns
        // `_fbIdentity`/the store). But do NOT report a SPURIOUS failure (B5): a direct
        // `ensureFirebaseSession(name)` overlapping this login supersedes us even though our own
        // sign-in succeeded. Report success only if BOTH this attempt reached a named session AND the
        // LIVE Firebase user really is this member — ground truth, never the shared `_fbIdentity`. A
        // teardown that superseded us (clearSession) also signs Firebase out, so this returns false.
        const u = auth.currentUser;
        return ok && !!u && !u.isAnonymous && u.email === nameToEmail(name);
    }
    _syncAuthTerminal(name);
    const named = firebaseSessionIsNamed();
    if (named) refreshClaimsIfStale(CONFIG.CLAIM_EPOCH);   // B3 sweep (fire-and-forget; one-shot per device)
    return ok && named;
}

/** Device-level localStorage key recording the last CONFIG.CLAIM_EPOCH this device refreshed for. */
const CLAIM_EPOCH_KEY = 'myb_claim_epoch';

/**
 * B3 claim-refresh sweep (AUTH_AND_SESSIONS.md → "Write isolation (B0–B3)"). Force a one-time ID-token refresh per
 * device when `CONFIG.CLAIM_EPOCH` advances, so a session holding a token minted BEFORE a custom
 * claim existed picks it up immediately instead of waiting for the ~hourly auto-refresh. Best-effort
 * and idempotent: one refresh per device per bump, only on a live (named) session, errors swallowed.
 * Fire-and-forget — never blocks page load; the refreshed token is used by the NEXT request.
 * @param {number} epoch  CONFIG.CLAIM_EPOCH
 * @returns {Promise<void>}
 */
export async function refreshClaimsIfStale(epoch) {
    try {
        if (!epoch) return;
        const seen = parseInt(lsGet(CLAIM_EPOCH_KEY) || '0', 10) || 0;
        if (seen >= epoch) return;
        const user = auth.currentUser;
        if (!user) return;                          // no live session — nothing to refresh
        await user.getIdToken(true);                // mint a fresh token carrying current claims
        lsSet(CLAIM_EPOCH_KEY, String(epoch));      // record: this device has swept for this epoch
    } catch { /* best-effort — the token self-heals on the ~hourly refresh cycle */ }
}

/**
 * Read and validate the current localStorage session. Returns null if missing, absolutely expired
 * (60 days) or version-stale. PURELY A READ (AUTH_AND_SESSIONS.md 2).
 *
 * ⚠️ Passive expiry only clears localStorage — it does NOT sign Firebase out.
 * getSession() runs synchronously at module eval on every page (incl. the calendar), before the
 * auth restore has settled. An async firebaseSignOut fired here would race the Calendar's access
 * decision (`decideAccess` reads the restored user) and could drop a still-valid identity
 * mid-decision. Firebase is signed out only on an EXPLICIT clearSession(), by the coordinated
 * `reconcileExpiredIdentity()` below, and ensureFirebaseSession() replaces a mismatched identity on
 * the next login.
 *
 * ⚠️ A lingering Firebase identity is NOT harmless: a named/admin/manager/designer identity retains
 * real access at the FIREBASE layer (all staff emails, on-behalf override writes, admin uploads,
 * Link Designer writes) after the local app session expired, reachable on a shared device via devtools.
 * `reconcileExpiredIdentity()` is the COORDINATED teardown, run AFTER the auth restore; the Calendar
 * calls it on virtually every launch, and every protected page's coordinator at init (grep for the
 * call rather than trusting a list here). (Finding #9)
 */
export function getSession() {
    try {
        const raw = lsGet(AUTH_KEY);
        if (!raw) return null;
        const s = JSON.parse(raw);
        // FAIL CLOSED ON AN UNREADABLE EXPIRY. `Date.now() > undefined` is false, and so is every
        // comparison against NaN — so a session missing its `expiry` would NEVER expire. The 60-day
        // cap is the app's only automatic revocation, so storage that has been corrupted, truncated
        // or hand-edited is treated as an expired session rather than an eternal one.
        // The Calendar's own-roster copy goes with the session it belongs to.
        if (!Number.isFinite(s.expiry) || Date.now() > s.expiry) { lsDel(AUTH_KEY); lsDel(CALENDAR_SNAPSHOT); return null; }
        if ((s.ver || 1) < SESSION_VER) { lsDel(AUTH_KEY); lsDel(CALENDAR_SNAPSHOT); return null; }
        // …and so is one with no NAME: every caller derives the account from it, so
        // `ensureNamedSession(undefined)` threw and the page offered no sign-in at all.
        if (typeof s.name !== 'string' || !s.name.trim()) { lsDel(AUTH_KEY); lsDel(CALENDAR_SNAPSHOT); return null; }
        // Nothing HERE extends `expiry` — a read stays a read; only `renewInstalledSession` moves it, in
        // the installed app, once the member's own account is restored. Older sessions
        // still carry a `lastActivity` field; it is simply ignored, which is why no SESSION_VER bump
        // is needed (bumping it would sign every member out).
        return s;
    } catch { return null; }
}

/** When this device's local session was created, or null when there is none. Sessions written before
 *  `createdAt` existed derive it from their absolute expiry. @returns {number|null} */
function _sessionCreatedMs() {
    try {
        const s = JSON.parse(lsGet(AUTH_KEY) || 'null');
        if (!s) return null;
        if (Number.isFinite(s.createdAt)) return s.createdAt;
        return Number.isFinite(s.expiry) ? s.expiry - SESSION_MS : null;
    } catch { return null; }
}


/**
 * Persist a new session for the named user — `SESSION_MS` from sign-in (renewed later only in the
 * installed app, `renewInstalledSession`), and nothing else.
 * @param {string} name
 * @returns {boolean} true if the session actually persisted; false when storage is blocked
 *   (e.g. iOS Safari Private Browsing — lsSet swallows the SecurityError, so nothing is written).
 *   The caller (runNamedSignIn) fails the sign-in cleanly on false instead of proceeding to a
 *   reload loop where Firebase is signed in but getSession() forever returns null.
 */
export function saveSession(name) {
    const now = sessionStartMs(auth.currentUser, nameToEmail(name), Date.now());
    const payload = JSON.stringify({
        name,
        ver:    SESSION_VER,
        expiry: now + SESSION_MS,
        // When the session began — the server's record of this sign-in where it can be had, never a
        // wrong device clock (`sessionStartMs`, audit A2) — compared with the server's `resetAt` before
        // any silent re-sign-in (`sessionPredatesReset`). Older sessions derive it from `expiry`.
        createdAt: now,
    });
    lsSet(AUTH_KEY, payload);
    return lsGet(AUTH_KEY) === payload;
}

/** Clear the session from localStorage AND sign out of Firebase Auth. This is the
 *  user-initiated logout path — unlike passive expiry in getSession(), an explicit
 *  logout should fully tear down the Firebase identity too. (No anon-auth bootstrap
 *  races this: the page reloads immediately after, starting auth cleanly.) */
export function clearSession() {
    // Bump the generation so an explicit sign-out SUPERSEDES any in-flight ensureNamedSession:
    // its `gen === _authGen` guard then fails and it won't dispatch a late terminal NAMED after
    // this SIGN_OUT (which would leave the store `named` while the local session is cleared —
    // e.g. the login-overlay 8s-timeout path that calls clearSession while an attempt runs on).
    _clearedGen = ++_authGen;
    lsDel(AUTH_KEY);
    // EVERY sign-out ends here, so this is where the Calendar's copy of the member's own roster is
    // deleted (calendar-snapshot.js). A shared device must not keep it past the session.
    lsDel(CALENDAR_SNAPSHOT);
    firebaseSignOut(auth).catch((/** @type {any} */ err) => console.warn('[Auth] signOut failed:', err));
    _feedAuth({ type: 'SIGN_OUT' });   // store: signedOut
}

/**
 * Sign out a Firebase identity that has OUTLIVED its local app session (Finding #9).
 *
 * getSession() clears only localStorage on passive expiry — the IndexedDB-persisted Firebase identity
 * survives with its real Firestore privileges. This is the COORDINATED teardown the getSession() note
 * prescribes: run AFTER authReady — never an async signOut inside the synchronous getSession(). If the
 * restored user is NAMED but there is no valid local session, sign it out.
 *
 * The calendar is the PWA `start_url`, so this runs on virtually every launch; every protected page's
 * coordinator ALSO calls it at init, so a direct deep-link tears the identity down immediately.
 * Reading `auth.currentUser` alone would miss a COLD restore (authReady only sets persistence — the
 * persisted user loads via the first onAuthStateChanged emission), so this resolves that restore
 * before deciding.
 *
 * Login-safe: snapshots `_authGen` and stands down if a login/logout transition (both bump it) started
 * meanwhile, and re-checks getSession() so a just-completed login (which writes a fresh session) is
 * never torn down. Anonymous identities are left alone.
 * @returns {Promise<void>}
 */
export async function reconcileExpiredIdentity() {
    const gen = _authGen;
    try { await authReady; } catch { return; }
    // `authReady` only guarantees persistence is SET — on a COLD restore the persisted user has not
    // loaded yet, so auth.currentUser can be `null` here and MISS a lingering identity. Resolve the
    // first restore emission (or use the already-live user), as ensureFirebaseSession does. Skip the
    // restore wait if a newer login/logout already superseded us.
    const u = auth.currentUser || (gen === _authGen ? await restoreFirstAuthUser().catch(() => null) : null);
    if (gen !== _authGen) return;                    // a login/logout now owns the identity — stand down
    if (!u || u.isAnonymous) return;                 // no lingering NAMED identity
    const live = getSession();
    // A valid session is never ended here. In the installed app it is RENEWED — only now, with the
    // member's own account restored (silent-sign-in.js → "The installed app stays signed in").
    if (live) { void renewWhenServerVouches(live, u); return; }
    // Release this device's push record FIRST, while the expired member is still the identity — the
    // delete is theirs to make, and after the sign-out nobody can.
    await releasePushForEndingHold();
    // …or anybody else did, by a route that moves no generation (the sign-out below signs out
    // whoever is current, which could be somebody new).
    if (gen !== _authGen || getSession() || auth.currentUser !== u) return;
    try {
        await firebaseSignOut(auth);
        console.warn('[Auth] Signed out a Firebase identity whose local session had expired (Finding #9).');
    } catch (err) {
        console.warn('[Auth] expired-identity signOut failed:', /** @type {any} */ (err)?.message);
    }
}

/** Running from the home screen, not a browser tab: the personal phone (silent-sign-in.js says why). */
function installedApp() {
    try {
        return globalThis.matchMedia?.('(display-mode: standalone)')?.matches === true
            || /** @type {any} */ (globalThis.navigator)?.standalone === true;
    } catch { return false; }
}

/** How recently the server must have issued the account's token for a renewal to count it as live. */
const TOKEN_FRESH_MS = 65 * 60_000;

/**
 * Renew only once the SERVER has vouched for the account: a token issued within the hour. The user
 * `reconcileExpiredIdentity` restores comes from this device's own storage, and a disabled account is
 * refused only when its token next refreshes — which `getIdTokenResult` does when the one held has
 * expired. So a leaver's phone stops renewing within the hour of the account being disabled, and their
 * session then ends as it always did. Fire-and-forget; never throws.
 * @param {{ name: string, expiry: number }} live @param {any} u
 * @returns {Promise<boolean>} whether the session was renewed
 */
export async function renewWhenServerVouches(live, u) {
    try {
        if (!installedApp()) return false;   // a tab or a desktop: no token work at all
        const r = await u.getIdTokenResult();
        if (!(Date.now() - Date.parse(r?.issuedAtTime ?? '') < TOKEN_FRESH_MS)) return false;
        if (auth.currentUser !== u || getSession()?.name !== live.name) return false;   // somebody else since
        return renewInstalledSession(live, u, { installed: true });
    } catch { return false; }
}

/**
 * In the installed app, move a live session's expiry to `SESSION_MS` from now — at most once a day, and
 * only for the member's OWN restored account (`renewedExpiry`, silent-sign-in.js). Its START is written
 * as it was: the reset check compares that (`sessionPredatesReset`), and a session saved before
 * `createdAt` existed derives its start from its expiry, which would otherwise move with it.
 * Exported for its test. Never throws.
 * @param {{ name: string, expiry: number }} session  the live session, as `getSession()` returned it
 * @param {{ email?: string|null, isAnonymous?: boolean }|null|undefined} user  the restored Firebase user
 * @param {{ installed?: boolean, now?: number }} [opts]  for tests
 * @returns {boolean} whether the session was renewed
 */
export function renewInstalledSession(session, user, { installed = installedApp(), now = Date.now() } = {}) {
    try {
        if (!user || user.isAnonymous || user.email !== nameToEmail(session.name)) return false;
        const next = renewedExpiry({ expiry: session.expiry, installed, now, sessionMs: SESSION_MS });
        if (next === null) return false;
        const createdAt = _sessionCreatedMs();
        const payload = JSON.stringify({ ...session, expiry: next, ...(createdAt === null ? {} : { createdAt }) });
        lsSet(AUTH_KEY, payload);
        return lsGet(AUTH_KEY) === payload;
    } catch { return false; }
}

/**
 * Release this device's push record for a member whose hold on it is ending WITHOUT a sign-out — an
 * expired session's lingering identity, or a session the last password reset refused. Without it, on
 * a station PC the departed member's targeted notices — a reset request naming
 * a colleague, for the admin — went on arriving there indefinitely: no next member ever comes to take
 * it over. Loaded on demand, so the session module does not carry the Web Push code;
 * `releaseDevicePush` bounds its own wait and never throws. Exported for the two other ends of a hold
 * (audit A1), page-session.js's and login-overlay.js's, which do not await it.
 * @returns {Promise<void>}
 */
export async function releasePushForEndingHold() {
    try {
        const { releaseDevicePush } = await import('./notif.js');
        await releaseDevicePush();
    } catch (err) {
        console.warn('[Auth] could not release this device\'s push record:', /** @type {any} */ (err)?.message);
    }
}

/** The whole access decision's deadline, in ms — the Calendar's (`resolveAccess`), and Trains' wait
 *  for its own; it lives here so calendar-access.js and trains-app.js share one value. */
export const ACCESS_DECISION_BUDGET_MS = 6500;
