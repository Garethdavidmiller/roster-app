// @ts-check
/**
 * session.js — Shared auth/session helpers for the write pages (admin.html, settings.html,
 * operations.html, links.html, paycalc.html) and the calendar. Importers vary in what they pull:
 * paycalc uses getSession/clearSession + ensureNamedSession; links uses ensureNamedSession +
 * sessionReady/resolveSession; calendar uses reconcileExpiredIdentity (+ get/clearSession).
 *
 * Owns: session constants, localStorage session read/write/clear, Firebase Auth
 *   sign-in lifecycle (ensureFirebaseSession), and password derivation (getSurname).
 * Does NOT own: login overlay UI (each page builds its own), Firestore writes.
 * Edit here for: session expiry, password derivation rule changes, Firebase Auth strategy.
 *
 * ⚠️ WARNING: changing getSurname will lock out every staff member. Any change
 *   must be accompanied by a password reset for all affected users.
 */

import { auth, authReady, onAuthStateChanged, nameToEmail, normaliseSurname, signInWithEmailAndPassword, createUserWithEmailAndPassword, signInAnonymously, signOut as firebaseSignOut } from './firebase-client.js';
import { surnamePassword, credentialCandidatesFor } from './auth-identity.js';
import { lsGet, lsSet, lsDel } from './ls.js';
import { CONFIG } from './roster-data.js';

/** Auth error codes that mean the credential was DEFINITIVELY rejected — a wrong password, or no
 *  such account — as opposed to a transient/config failure (network, provider-disabled). On these
 *  the sign-in must resolve to 'none' + a re-sign-in prompt REGARDLESS of ENFORCE_NAMED_SESSION,
 *  NEVER an anonymous fallback (PASSWORD_PLAN.md §3.3 — the critical fix: once anyone has a custom
 *  password, an anonymous fallback here would be silently denied every write by the strict B3 rules,
 *  reproducing the v10.94 outage class). `invalid-credential` is the modern email-enumeration-safe
 *  code; `wrong-password`/`invalid-login-credentials`/`user-not-found` cover older SDK phrasings.
 *  @type {Set<string>} */
const _CREDENTIAL_REJECTION_CODES = new Set([
    'auth/wrong-password', 'auth/invalid-credential', 'auth/invalid-login-credentials', 'auth/user-not-found',
]);
/** @param {string|undefined} code */
const _isCredentialRejection = (code) => !!code && _CREDENTIAL_REJECTION_CODES.has(code);
import { dispatchAuth } from './auth-state.js';

/**
 * Feed the auth STORE (ARCHITECTURE_PLAN.md Phase 2). This is a pure side-effect, wrapped so
 * a store error can NEVER break the auth path; `sessionReady` and every existing flow are
 * untouched (session.js still owns the Firebase lifecycle). The store IS now consumed: the 5
 * write coordinators read it at init via `getAuthSnapshot()` + `requirePage()` (auth-policy.js),
 * active now that `ENFORCE_NAMED_SESSION` is on. The full single-owner auth shell (live
 * subscriptions, `sessionReady` re-routed onto the store) is still future work.
 * @param {{ type: string, member?: string|null, error?: string|null }} event
 */
function _feedAuth(event) {
    try { dispatchAuth(event); } catch (e) { console.error('[Auth] store feed failed', e); }
}

/** Translate the resolved Firebase identity (the B0 signals) into a terminal store event. */
function _syncAuthTerminal(/** @type {string} */ name) {
    const id  = getFirebaseIdentity();              // 'named' | 'anonymous' | 'none'
    const err = getFirebaseAuthError() ?? null;
    if (id === 'named')                       _feedAuth({ type: 'NAMED', member: name });
    else if (id === 'anonymous')              _feedAuth({ type: 'ANONYMOUS' });
    else if (err && err.includes('anon:'))    _feedAuth({ type: 'FATAL', error: err });  // even anonymous failed
    else                                      _feedAuth({ type: 'NONE', error: err });
}

export const AUTH_KEY    = 'myb_admin_session';
export const SESSION_MS  = 30 * 24 * 60 * 60 * 1000; // 30 days — absolute outer bound
export const IDLE_MS     =  7 * 24 * 60 * 60 * 1000; // 7 days — inactivity cutoff
export const SESSION_VER = 2; // bump to force all existing sessions to re-login

/**
 * Derive the login password from a staff member's display name.
 * Delegates to `normaliseSurname` (auth-identity.js) — the SINGLE source for the derivation
 * rules (surname extraction, multi-word join, lowercase, non-alpha strip). Do not re-document
 * or re-implement those rules here; a mismatch would lock members out. surname-parity.test.mjs
 * enforces this stays in sync with the functions-side duplicate.
 * @param {string} fullName - Display name exactly as stored in teamMembers, e.g. "G. Miller"
 * @returns {string} Lowercase password with all non-alpha characters removed
 */
export function getSurname(fullName) {
    return normaliseSurname(fullName);
}

/** @type {(value: any) => void} */
let _sessionResolve;
/**
 * Module-level promise that resolves once the Firebase Auth session for this
 * page is confirmed. Page coordinators call resolveSession(); feature modules
 * import sessionReady and await it instead of reading window._mybSession.
 *
 * Resolves to true (session active), false (session failed or non-auth path),
 * or the boolean returned by ensureFirebaseSession().
 * @type {Promise<boolean>}
 */
export const sessionReady = /** @type {Promise<boolean>} */ (new Promise(r => (_sessionResolve = r)));
/**
 * Call once per page-load from the page coordinator after ensureFirebaseSession().
 * @param {boolean | Promise<boolean>} result - pass the return value of ensureFirebaseSession()
 *   directly (Promise<boolean>) or a plain boolean (false) on the non-auth path.
 *   JS Promise resolution procedure follows the inner Promise, so awaiting sessionReady
 *   always yields the final boolean regardless of which form is passed.
 * @returns {void}
 */
export function resolveSession(result) { _sessionResolve(result); }

/**
 * The Firebase Auth identity that `ensureFirebaseSession` last established on a WRITE
 * page (admin / operations / settings / links / paycalc). The calendar's anonymous read
 * bootstrap (`calendarAuthReady` in calendar-app.js) is a separate path and never touches
 * this — `ensureFirebaseSession` is only called by the write pages.
 *
 *   'named'     — signed in as the member's own account (email === nameToEmail(name)).
 *   'anonymous' — degraded fallback. Satisfies `request.auth != null` but carries NO `name` claim,
 *                 so per-member write isolation (B2/B3, now STRICT) rejects its writes. NOTE: with
 *                 `ENFORCE_NAMED_SESSION` ON (shipped v14.98), the write pages NO LONGER fall back
 *                 to anonymous (ensureFirebaseSession returns 'none' instead — see the enforce
 *                 branch below); the store then prompts a re-login. This value is still produced on
 *                 the flag-OFF path and by the calendar's own anon bootstrap.
 *   'none'      — no Firebase session could be established (or, under enforce, a non-named result).
 *
 * B0 (SECURITY_RELEASE_PLAN.md) made this distinction observable + tested; B1/B2/B3 then made it
 * load-bearing (strict isolation + no-anon-fallback on write pages).
 * @type {'named' | 'anonymous' | 'none'}
 */
let _fbIdentity = 'none';

/** @type {string | undefined} The auth error code behind the last non-'named' outcome, for diagnostics. */
let _fbAuthError;

/** Monotonic auth-attempt generation (stale-completion guard, SECURITY_RELEASE_PLAN.md prep for B1/B3).
 *  `runNamedSignIn` time-boxes the auth promise but cannot CANCEL the underlying Firebase work, so a
 *  timed-out attempt can resolve LATE — after the user retried and a newer attempt already won. A
 *  superseded attempt (its captured gen ≠ this counter) must drop ALL its terminal writes so it can't
 *  clobber the shared `_fbIdentity`/auth-store to a stale value (which under B1 could cause a spurious
 *  re-login). Each `ensureNamedSession` bumps it; `ensureFirebaseSession` inherits or (direct call) bumps. */
let _authGen = 0;

/**
 * The Firebase identity `ensureFirebaseSession` last established on a write page.
 * @returns {'named' | 'anonymous' | 'none'}
 */
export function getFirebaseIdentity() { return _fbIdentity; }

/**
 * True only when the active write-page Firebase session is the member's own named account —
 * NOT the anonymous fallback. This is the signal per-member write isolation (B2) depends on.
 * @returns {boolean}
 */
export function firebaseSessionIsNamed() { return _fbIdentity === 'named'; }

/**
 * The auth error code behind the last non-'named' `ensureFirebaseSession` outcome, or undefined.
 * @returns {string | undefined}
 */
export function getFirebaseAuthError() { return _fbAuthError; }

/**
 * Resolve the first onAuthStateChanged emission (the IndexedDB session restore) once.
 * Exported so pages that must read `auth.currentUser` after the async restore (e.g.
 * admin-auth.js before calling setupRosterAuth) share ONE implementation instead of
 * hand-rolling their own — a past divergence let a cold-restore fix miss the copy.
 * Callers wanting the fast path use `auth.currentUser || await restoreFirstAuthUser()`.
 * @returns {Promise<any>}
 */
export function restoreFirstAuthUser() {
    return new Promise(resolve => {
        const unsub = onAuthStateChanged(auth, (/** @type {any} */ user) => { unsub(); resolve(user); });
    });
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
 * overlay mounts. It kicks off `authReady` (persistence setup) and the first `onAuthStateChanged`
 * emission (the IndexedDB session restore) in the background, so by the time the user finishes
 * typing their password `ensureFirebaseSession` skips straight to the sign-in network call instead
 * of first paying for that setup + restore. The restore overlaps the user's typing.
 *
 * Idempotent and best-effort: a failure here resolves to null, so `ensureFirebaseSession` simply
 * does the restore itself, exactly as before. It changes NO security and NO outcome — pure latency
 * overlap: the consume path resolves to null whenever nothing was primed, so behaviour is identical
 * whether or not `primeAuth()` ran. (One-shot per page: `_authPrimed` is not reset after consumption,
 * so only the first sign-in attempt on a page benefits from the pre-warm.)
 * @returns {void}
 */
export function primeAuth() {
    if (_authPrimed) return;
    _authPrimed = true;
    _primedAuthUser = Promise.resolve(authReady)
        .then(() => restoreFirstAuthUser())
        .catch(() => null);
}

/**
 * Guarantee a live Firebase Auth session for a logged-in member.
 *
 * Firestore Security Rules require `request.auth != null` for every write.
 * The login click handler signs in to Firebase — but a returning user with a
 * valid 30-day localStorage session skips that handler, so on a normal app open
 * the Firebase Auth session was never (re-)established.
 *
 * Strategy (each step falls through to the next on failure):
 * 1. Restore persisted session from IndexedDB — free, no network.
 * 2. signInWithEmailAndPassword — normal path.
 * 3. createUserWithEmailAndPassword — account doesn't exist yet (self-heal).
 * 4. signInAnonymously — fallback when email/password provider is disabled in
 *    Firebase Console, or account has a mismatched password. Anonymous sessions
 *    satisfy `request.auth != null` and are stable across page loads on Android
 *    PWAs. The error code from step 2 is exposed via getFirebaseAuthError() so
 *    it can be surfaced in diagnostic messages.
 *
 * @param {string} name - Member display name (exact teamMembers match)
 * @param {number} [_gen] - Internal: the caller's auth-attempt generation (stale-completion guard).
 *   ensureNamedSession passes its generation; omit on a direct call and a fresh one is taken.
 * @param {string} [password] - The password the member TYPED at the login field. When present, the
 *   gated dual-attempt (auth-identity.credentialCandidatesFor) is used: the raw typed value, then
 *   the derived surname ONLY if the typed value normalises to the surname. When ABSENT (a page-load
 *   re-establishment with no typed value), only the derived surname is tried — auto-reauth of an
 *   un-migrated member; a MIGRATED member fails cleanly and the page re-shows the login overlay
 *   (PASSWORD_PLAN.md §3.4).
 * @returns {Promise<boolean>} true if a Firebase Auth session is active afterwards
 */
export async function ensureFirebaseSession(name, _gen, password) {
    // Generation guard (see `_authGen`). ensureNamedSession passes its generation in; a direct call
    // (e.g. tests) takes a fresh one. A superseded attempt drops its terminal writes via `commit`/
    // `recordError` so a late completion can't clobber a newer attempt's identity/diagnostics.
    const gen = _gen ?? ++_authGen;
    const fresh = () => gen === _authGen;
    /** Publish the winning identity, then return `result` — only if this attempt is still current.
     *  @param {'named'|'anonymous'|'none'} identity @param {boolean} result @returns {boolean} */
    const commit = (identity, result) => { if (fresh()) _fbIdentity = identity; return result; };
    /** Record auth-error diagnostics for the CURRENT attempt only. @param {string|undefined} code */
    const recordError = (code) => {
        if (!fresh()) return;
        _fbAuthError = code;   // read via getFirebaseAuthError() (admin-auth.js, operations-app.js)
    };

    // Reset for this attempt — but ONLY while it is still current. A SUPERSEDED retry (ensureNamedSession
    // re-enters ensureFirebaseSession with its now-stale gen after a newer attempt already won) must NOT
    // run this reset: commit/recordError below are gen-guarded, but an unguarded reset here would clobber
    // the winner's `_fbIdentity` to 'none' and leave it stuck there (the store would read 'named' while
    // the global reads 'none' — the exact disagreement the guard exists to prevent). Found in review.
    if (fresh()) { _fbIdentity = 'none'; _fbAuthError = undefined; }
    await authReady;
    // First auth state for this restore. Fast path: if auth.currentUser is ALREADY populated (a live
    // session — e.g. the SECOND ensureFirebaseSession of an in-place sign-in, where the first call just
    // established it), use it synchronously and skip the onAuthStateChanged wait entirely. It is null
    // synchronously during a cold IndexedDB restore (the common first-load case), so otherwise we wait
    // for the first emission. If the login overlay pre-warmed that via primeAuth() (fired when it
    // mounted), consume the already-in-flight promise so the restore overlapped the user's typing — a
    // pure latency win, no behaviour change. One-shot: a later call does a fresh restore; tests (which
    // never prime, and whose mock currentUser is null) always take the await path.
    const existing = auth.currentUser || await (_consumePrimedAuthUser() || restoreFirstAuthUser());
    // Gen-guard EVERY shared-auth mutation from here down (like commit/recordError/the reset above):
    // a SUPERSEDED attempt resuming after this long await — the sign-out below on the mismatch path,
    // but equally the signInWithEmailAndPassword / signInAnonymously calls further down on the
    // no-persisted-session (cold load) path — would otherwise replace the WINNING attempt's
    // freshly-established session on the shared `auth`, leaving the store reading 'named' for the
    // winner while auth.currentUser holds someone else (silent permission-denied writes). The
    // matching-user fast path below stays safe for a stale gen: commit() no-ops the global write.
    if (existing && !existing.isAnonymous && existing.email === nameToEmail(name)) return commit('named', true);
    if (!fresh()) return commit('none', false);
    // Only reuse a persisted session when it belongs to the expected user.
    // An anonymous fallback session, or a session for a different member (e.g.
    // Person A was active on a shared browser and Person B now selects their name),
    // must not be reused — sign out and re-authenticate under the correct identity.
    if (existing) {
        await firebaseSignOut(auth);
        // Re-check the generation AFTER the sign-out await (v16.69 review fix): an attempt
        // superseded DURING firebaseSignOut would otherwise resume and run the sign-in calls
        // below, replacing the WINNING attempt's freshly-established session on the shared
        // `auth` — the store says 'named' for the winner while auth.currentUser holds someone
        // else, so every strict-rules write is permission-denied until the next page load
        // (writeWithClaimRetry cannot heal a wrong-identity token). Mirrors the fresh() check
        // above; commit() already no-ops for a stale gen, but the auth mutation itself must
        // not happen either.
        if (!fresh()) return commit('none', false);
    }

    const email = nameToEmail(name);
    // The ordered password candidates to try (PASSWORD_PLAN.md §3.2–3.4). WITH a typed password
    // (login overlay): raw typed → derived surname (gated on the typed value normalising to the
    // surname). WITHOUT one (page-load re-establishment): the derived surname only (auto-reauth of
    // an un-migrated member; a migrated member fails cleanly here → 'none' → overlay re-shown).
    const candidates = password != null
        ? credentialCandidatesFor(name, password)
        : (surnamePassword(name) ? [surnamePassword(name)] : []);
    let   lastError;
    let   nonCredentialStop = false;   // true → we stopped on a NON-credential error (network etc.)

    for (const candidate of candidates) {
        if (!fresh()) return commit('none', false);
        try {
            await signInWithEmailAndPassword(auth, email, candidate);
            return commit('named', true);
        } catch (e) {
            const _e = /** @type {any} */ (e);
            lastError = _e.code;
            console.warn('[Auth] signIn failed:', _e.code, 'for', email);
            // Self-heal a missing account by creating it — UNLESS the B1 named-session requirement
            // is on (accounts are provisioned server-side then; dead code under the current
            // flag=true). Always seeds the CANONICAL surname password, never a typed custom value.
            if (_e.code === 'auth/user-not-found' && !CONFIG.ENFORCE_NAMED_SESSION) {
                try {
                    await createUserWithEmailAndPassword(auth, email, surnamePassword(name));
                    console.warn('[Auth] Created Firebase Auth account for', name);
                    return commit('named', true);
                } catch (createErr) {
                    const _ce = /** @type {any} */ (createErr);
                    console.warn('[Auth] createUser failed:', _ce.code, 'for', email);
                    lastError = _ce.code;
                }
            }
            // A definitive credential rejection for THIS candidate → try the next one (if any). A
            // NON-credential error (network / provider-disabled) → stop; it isn't a password problem.
            if (!_isCredentialRejection(_e.code)) { nonCredentialStop = true; break; }
        }
    }

    recordError(lastError);   // diagnostics (current attempt only)

    // Every candidate was DEFINITIVELY rejected (wrong password / no account). Resolve to 'none' +
    // a re-sign-in prompt — NEVER anonymous, REGARDLESS of ENFORCE_NAMED_SESSION (PASSWORD_PLAN.md
    // §3.3, the critical fix: a migrated member whose surname no longer works, or a mistyped
    // password, must not land on a nameless anonymous session the strict rules then silently deny).
    if (!nonCredentialStop) {
        console.warn('[Auth] Credential rejected (definitive); no anonymous fallback. Error:', lastError);
        return commit('none', false);
    }

    // A NON-credential failure (network blip, auth/operation-not-allowed, …). Under enforce, still
    // no anonymous fallback — a write page needs the member's identity. Flag off → anonymous keeps
    // the app working through a transient network problem (today's behaviour, unchanged).
    if (CONFIG.ENFORCE_NAMED_SESSION) {
        console.warn('[Auth] Named session not established; anonymous fallback disabled (ENFORCE_NAMED_SESSION). Error:', lastError);
        return commit('none', false);
    }
    console.warn('[Auth] Falling back to anonymous sign-in. Original error:', lastError);
    try {
        await signInAnonymously(auth);
        console.warn('[Auth] Anonymous session established for', name);
        return commit('anonymous', true);
    } catch (anonErr) {
        const _ae = /** @type {any} */ (anonErr);
        console.error('[Auth] Anonymous sign-in failed:', _ae.code);
        recordError(`${lastError} + anon:${_ae.code}`);
        return commit('none', false);
    }
}

/** Auth error codes worth a quiet retry — a momentary connectivity blip rather than a real
 *  credential/account problem. A persistent code (user-not-found / invalid-credential) is not
 *  retried; it needs a human (re-login or admin break-glass). @type {Set<string>} */
const _TRANSIENT_AUTH_CODES = new Set([
    'auth/network-request-failed', 'auth/timeout', 'auth/too-many-requests', 'auth/internal-error',
]);

/** @param {string|undefined} code @returns {boolean} */
export function isTransientAuthError(code) { return !!code && _TRANSIENT_AUTH_CODES.has(code); }

/**
 * Ensure the member's OWN named Firebase session for a write page (B1.2).
 *
 * - When `CONFIG.ENFORCE_NAMED_SESSION` is **off** (default): returns exactly what
 *   `ensureFirebaseSession` returns (true if any session — incl. the anonymous fallback — is
 *   active), so callers behave identically to today.
 * - When **on**: a failed named sign-in is retried a couple of times ONLY if the error looks
 *   transient (a network blip), then returns whether the named session is genuinely active.
 *   Persistent failures (no account / wrong password) are not retried — the caller prompts a
 *   re-login or routes to admin break-glass.
 *
 * @param {string} name
 * @param {{ retries?: number, delayMs?: number, password?: string }} [opts] - `password` is the
 *   member's TYPED login password (login overlay); omit on a page-load re-establishment (the
 *   derived surname is tried automatically). Threaded to `ensureFirebaseSession`.
 * @returns {Promise<boolean>} true if it is safe to proceed (named session, or flag off)
 */
export async function ensureNamedSession(name, { retries = 2, delayMs = 300, password } = {}) {
    const gen = ++_authGen;   // generation guard — a superseded attempt must not publish a stale terminal state
    _feedAuth({ type: 'RESOLVE_START', member: name });   // store: resolving (observing only — Phase 2)
    let ok = await ensureFirebaseSession(name, gen, password);
    if (!CONFIG.ENFORCE_NAMED_SESSION) {
        if (gen === _authGen) {   // not superseded by a newer attempt → safe to publish the terminal state
            _syncAuthTerminal(name);
            if (firebaseSessionIsNamed()) refreshClaimsIfStale(CONFIG.CLAIM_EPOCH);   // B3 sweep (fire-and-forget)
        }
        return ok;   // flag off → legacy behaviour, no gating
    }
    let attempt = 0;
    // `gen === _authGen` stops a superseded attempt from continuing to retry (and dispatching stale events).
    while (!ok && attempt < retries && gen === _authGen && isTransientAuthError(getFirebaseAuthError())) {
        _feedAuth({ type: 'TRANSIENT', error: getFirebaseAuthError() ?? null });   // store: degraded
        attempt++;
        await new Promise(r => setTimeout(r, delayMs * attempt));
        _feedAuth({ type: 'RETRY' });   // store: resolving again
        ok = await ensureFirebaseSession(name, gen, password);
    }
    if (gen !== _authGen) {
        // Superseded by a newer attempt — MUST NOT publish terminal state (the newer attempt owns
        // `_fbIdentity`/the store). But do NOT report a SPURIOUS failure (B5): a direct
        // `ensureFirebaseSession(name)` overlapping this login bumps `_authGen` at entry, superseding
        // us even though our own sign-in genuinely succeeded. Report success only if BOTH this attempt
        // reached a named session (`ok` ⟺ named under enforce) AND the LIVE Firebase user really is
        // this member — read `auth.currentUser` (ground truth), never the shared `_fbIdentity` a newer
        // attempt may have moved to a different identity. This publishes nothing, so it cannot clobber
        // the winner; it only stops the overlay showing "sign-in failed" when we ARE signed in. A
        // teardown that superseded us (clearSession / timeout → clearSession) also signs Firebase out,
        // so `auth.currentUser` is null there and this correctly still returns false.
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
 * B3 claim-refresh sweep (SECURITY_RELEASE_PLAN.md → B3). Force a one-time ID-token refresh per
 * device when `CONFIG.CLAIM_EPOCH` advances, so a session holding a token minted BEFORE a custom
 * claim existed (e.g. the B2 `manager` claim) picks it up immediately instead of waiting for the
 * ~hourly auto-refresh — the deterministic "every active token carries its correct-tier claim"
 * precondition the B3 strict rule needs. Best-effort and idempotent: gated by a localStorage epoch
 * flag (one refresh per device per bump), acts only on a live (named) session, and swallows any
 * error (a stale token self-heals on the normal refresh cycle). Fire-and-forget — never blocks page
 * load; the refreshed token is used by the NEXT request.
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
 * Read and validate the current localStorage session. Returns null if
 * missing, absolutely expired (30 days), version-stale, or idle (7 days).
 * Auto-touches lastActivity on every valid call so opening the app resets
 * the idle clock — no separate touchSession() needed.
 *
 * ⚠️ Passive expiry only clears localStorage — it does NOT sign Firebase out.
 * getSession() runs synchronously at module eval on every page (incl. the
 * calendar). The calendar's `calendarAuthReady` checks `auth.currentUser` to
 * decide whether to sign in anonymously; if getSession() fired an async
 * firebaseSignOut here it would race that check and could leave the page with
 * no Firebase identity, so its best-effort writes (push-subscription renewal,
 * usage, error reporter) get rejected by the `request.auth != null` rule — the
 * exact "bell stuck off-lapsed" bug calendarAuthReady prevents. Firebase is signed
 * out only on an EXPLICIT clearSession() (user-initiated logout), and
 * ensureFirebaseSession() replaces a mismatched identity on the next login.
 *
 * ⚠️ A lingering Firebase identity is NOT harmless post-B3/H2/B4: a named/admin/manager/designer
 * identity retains real extra access at the FIREBASE layer (read all staff emails, on-behalf override
 * writes, admin uploads, Links writes) even after the local app session expired. The exposure is a
 * shared device where someone reaches the persisted credential via devtools / a direct SDK call.
 * `reconcileExpiredIdentity()` (below) is the COORDINATED teardown — run AFTER the auth restore, not an
 * async signOut inside this synchronous getSession() (which would race the calendar's anon bootstrap).
 * The calendar (the PWA start_url) calls it on virtually every launch, AND every protected coordinator
 * (admin/settings/operations/links/paycalc) now calls it at init (review item 7), so a lingering expired
 * identity is dropped even on a direct deep-link to a protected page — no longer only on the next login
 * or the next calendar open. (Finding #9)
 */
export function getSession() {
    try {
        const raw = lsGet(AUTH_KEY);
        if (!raw) return null;
        const s = JSON.parse(raw);
        if (Date.now() > s.expiry) { lsDel(AUTH_KEY); return null; }
        if ((s.ver || 1) < SESSION_VER) { lsDel(AUTH_KEY); return null; }
        // Idle check. Missing lastActivity: Date.now() - undefined = NaN, NaN > IDLE_MS = false → kept active.
        if (Date.now() - s.lastActivity > IDLE_MS) {
            lsDel(AUTH_KEY); return null;
        }
        // Refresh lastActivity on every valid page-load check.
        s.lastActivity = Date.now();
        lsSet(AUTH_KEY, JSON.stringify(s));
        return s;
    } catch { return null; }
}

/**
 * Persist a new session for the named user (30-day absolute expiry, idle clock starts now).
 * @param {string} name
 * @returns {boolean} true if the session actually persisted; false when storage is blocked
 *   (e.g. iOS Safari Private Browsing — lsSet swallows the SecurityError, so nothing is written).
 *   The caller (runNamedSignIn) fails the sign-in cleanly on false instead of proceeding to a
 *   reload loop where Firebase is signed in but getSession() forever returns null.
 */
export function saveSession(name) {
    const now = Date.now();
    const payload = JSON.stringify({
        name,
        ver:          SESSION_VER,
        expiry:       now + SESSION_MS,
        lastActivity: now,
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
    ++_authGen;
    lsDel(AUTH_KEY);
    firebaseSignOut(auth).catch((/** @type {any} */ err) => console.warn('[Auth] signOut failed:', err));
    _feedAuth({ type: 'SIGN_OUT' });   // store: signedOut (observing only — Phase 2)
}

/**
 * Sign out a Firebase identity that has OUTLIVED its local app session (Finding #9).
 *
 * getSession() clears only localStorage on passive expiry — the IndexedDB-persisted Firebase identity
 * survives, so a NAMED/admin/manager/designer session keeps its real Firestore privileges (read all
 * staff emails, on-behalf override writes, admin uploads, Links writes) after the app session expired.
 * This is the COORDINATED teardown the getSession() note prescribes: run it AFTER authReady — never an
 * async signOut inside the synchronous getSession(), which would race the calendar's anon bootstrap. If
 * the restored user is NAMED but there is no valid local session, sign it out; the caller re-establishes
 * an anonymous session where it needs one (the calendar) once this resolves.
 *
 * The calendar is the PWA `start_url`, so this runs on virtually every launch — the dominant path by
 * which an expired session's lingering privileges are dropped. Every protected coordinator (admin,
 * settings, operations, links, paycalc) ALSO calls it at init (review item 7), so a direct deep-link
 * to a protected page tears the identity down immediately rather than waiting for the next login or
 * calendar open. Reading `auth.currentUser` alone would miss a COLD restore (authReady only sets
 * persistence — the persisted user loads via the first onAuthStateChanged emission), so this resolves
 * that restore before deciding.
 *
 * Login-safe: snapshots `_authGen` and stands down if a login/logout transition (both bump it) started
 * meanwhile, and re-checks getSession() so a just-completed login (which writes a fresh session) is
 * never torn down. Anonymous identities are left alone — the calendar depends on them.
 * @returns {Promise<void>}
 */
export async function reconcileExpiredIdentity() {
    const gen = _authGen;
    try { await authReady; } catch { return; }
    // `authReady` only guarantees persistence is SET — on a COLD restore the IndexedDB-persisted user
    // has not loaded yet, so reading auth.currentUser right here can be `null` and MISS a lingering
    // identity entirely (it would then survive that whole page load). Resolve the first restore
    // emission (or use the already-live user) so a lingering identity is reliably seen — the same
    // `auth.currentUser || await restoreFirstAuthUser()` pattern ensureFirebaseSession uses. This is
    // what lets reconcile run reliably from a protected page opened by a direct deep-link, not just
    // the calendar (review item 7). Skip the restore wait if a newer login/logout already superseded us.
    const u = auth.currentUser || (gen === _authGen ? await restoreFirstAuthUser().catch(() => null) : null);
    if (gen !== _authGen) return;                    // a login/logout now owns the identity — stand down
    if (!u || u.isAnonymous || getSession()) return; // no lingering NAMED identity, or a valid session exists
    try {
        await firebaseSignOut(auth);
        console.warn('[Auth] Signed out a Firebase identity whose local session had expired (Finding #9).');
    } catch (err) {
        console.warn('[Auth] expired-identity signOut failed:', /** @type {any} */ (err)?.message);
    }
}
