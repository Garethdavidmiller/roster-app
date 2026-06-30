// @ts-check
/**
 * session.js — Shared auth/session helpers for admin.html, settings.html,
 * operations.html, and paycalc.html (paycalc uses getSession/clearSession only).
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
import { lsGet, lsSet, lsDel } from './ls.js';
import { CONFIG } from './roster-data.js';
import { dispatchAuth } from './auth-state.js';

/**
 * Feed the auth STORE (ARCHITECTURE_PLAN.md Phase 2) — OBSERVING ONLY. This is a pure
 * side-effect: nothing consumes the store yet, so it cannot change any page's behaviour,
 * and it is wrapped so a store error can NEVER break the auth path. `sessionReady` and
 * every existing flow are untouched. (Phase 4+ coordinators will subscribe to the store.)
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
 *
 * Rules (must stay in sync with how passwords were originally set):
 *  - Take everything after the first word (the initial + dot), e.g. "G. Miller" → "Miller"
 *  - Join multi-word surnames without spaces, e.g. "M. De Silva" → "DeSilva"
 *  - Lowercase the result
 *  - Strip ALL non-alpha characters: hyphens, apostrophes, spaces, accents, etc.
 *    e.g. "C. Francisco-Charles" → "franciscocharles"
 *    e.g. "O'Brien" → "obrien"
 *
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
 *   'anonymous' — degraded fallback. Satisfies `request.auth != null` today, but carries NO
 *                 `name` claim, so per-member write isolation (SECURITY_RELEASE_PLAN.md → B2)
 *                 will reject its writes. B1 will use this signal to prompt a re-login instead
 *                 of letting a claim-less session write silently.
 *   'none'      — no Firebase session could be established at all.
 *
 * B0 (SECURITY_RELEASE_PLAN.md) makes this distinction observable and tested without changing
 * any runtime behaviour — the anonymous fallback still happens, so nothing regresses yet.
 * @type {'named' | 'anonymous' | 'none'}
 */
let _fbIdentity = 'none';

/** @type {string | undefined} The auth error code behind the last non-'named' outcome, for diagnostics. */
let _fbAuthError;

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

/** Resolve the first onAuthStateChanged emission (the IndexedDB session restore) once. */
function _restoreFirstAuthUser() {
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
 * overlap. Tests never call it, so the consume path stays null there and behaviour is unchanged.
 * @returns {void}
 */
export function primeAuth() {
    if (_authPrimed) return;
    _authPrimed = true;
    _primedAuthUser = Promise.resolve(authReady)
        .then(() => _restoreFirstAuthUser())
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
 *    PWAs. The error code from step 2 is stored on window._mybAuthError so it
 *    can be surfaced in diagnostic messages.
 *
 * @param {string} name - Member display name (exact teamMembers match)
 * @returns {Promise<boolean>} true if a Firebase Auth session is active afterwards
 */
export async function ensureFirebaseSession(name) {
    _fbIdentity  = 'none';        // reset; set to 'named'/'anonymous' on the path that wins
    _fbAuthError = undefined;
    await authReady;
    // First auth state for this restore. Fast path: if auth.currentUser is ALREADY populated (a live
    // session — e.g. the SECOND ensureFirebaseSession of an in-place sign-in, where the first call just
    // established it), use it synchronously and skip the onAuthStateChanged wait entirely. It is null
    // synchronously during a cold IndexedDB restore (the common first-load case), so otherwise we wait
    // for the first emission. If the login overlay pre-warmed that via primeAuth() (fired when it
    // mounted), consume the already-in-flight promise so the restore overlapped the user's typing — a
    // pure latency win, no behaviour change. One-shot: a later call does a fresh restore; tests (which
    // never prime, and whose mock currentUser is null) always take the await path.
    const existing = auth.currentUser || await (_consumePrimedAuthUser() || _restoreFirstAuthUser());
    // Only reuse a persisted session when it belongs to the expected user.
    // An anonymous fallback session, or a session for a different member (e.g.
    // Person A was active on a shared browser and Person B now selects their name),
    // must not be reused — sign out and re-authenticate under the correct identity.
    if (existing) {
        if (!existing.isAnonymous && existing.email === nameToEmail(name)) { _fbIdentity = 'named'; return true; }
        await firebaseSignOut(auth);
    }

    const pw         = getSurname(name);
    // Firebase Auth requires ≥6 chars — repeat the derived password string to reach the minimum.
    // padEnd with an empty fill string is a no-op, so fall back to 'x' when pw is empty
    // (a single-token name with no surname would otherwise produce an unusable empty password).
    const fbPassword = pw.length >= 6 ? pw : pw.padEnd(6, pw || 'x');
    const email      = nameToEmail(name);
    let   firstError;

    try {
        await signInWithEmailAndPassword(auth, email, fbPassword);
        _fbIdentity = 'named';
        return true;
    } catch (e) {
        const _e = /** @type {any} */ (e);
        firstError = _e.code;
        console.warn('[Auth] signIn failed:', _e.code, 'for', email);
        // Self-heal a missing account by creating it — UNLESS the B1 named-session
        // requirement is on, in which case accounts must be provisioned server-side
        // (Operations → Set up accounts) and the client must never mint one itself.
        if (_e.code === 'auth/user-not-found' && !CONFIG.ENFORCE_NAMED_SESSION) {
            try {
                await createUserWithEmailAndPassword(auth, email, fbPassword);
                console.warn('[Auth] Created Firebase Auth account for', name);
                _fbIdentity = 'named';
                return true;
            } catch (createErr) {
                const _ce = /** @type {any} */ (createErr);
                console.warn('[Auth] createUser failed:', _ce.code, 'for', email);
                firstError = _ce.code;
            }
        }
        // auth/invalid-credential means the account exists with a different password —
        // attempting createUser would fail with auth/email-already-in-use.
        // Fall through to the fallback below.
    }

    _fbAuthError = firstError;
    // window guard: ensureFirebaseSession is a browser path, but the typeof check lets the
    // unit tests exercise the fallback branch under Node (no window) without throwing.
    if (typeof window !== 'undefined') /** @type {any} */ (window)._mybAuthError = firstError; // surfaced by admin-auth.js in diagnostics

    // B1 (SECURITY_RELEASE_PLAN.md): when the named-session requirement is on, do NOT fall
    // back to an anonymous session — a write page must carry the member's OWN identity. Return
    // failure so the page can prompt a re-login instead of silently writing as a nameless guest.
    // Default (flag off): keep today's anonymous fallback so nothing changes until you flip it on.
    if (CONFIG.ENFORCE_NAMED_SESSION) {
        console.warn('[Auth] Named session not established; anonymous fallback disabled (ENFORCE_NAMED_SESSION). Error:', firstError);
        _fbIdentity = 'none';
        return false;
    }

    // Fallback: anonymous sign-in satisfies `request.auth != null`.
    // Covers: email/password provider disabled (auth/operation-not-allowed),
    // password mismatch on an existing account (auth/email-already-in-use),
    // and any other persistent email/password failure.
    console.warn('[Auth] Falling back to anonymous sign-in. Original error:', firstError);
    try {
        await signInAnonymously(auth);
        console.warn('[Auth] Anonymous session established for', name);
        _fbIdentity = 'anonymous';
        return true;
    } catch (anonErr) {
        const _ae = /** @type {any} */ (anonErr);
        console.error('[Auth] Anonymous sign-in failed:', _ae.code);
        _fbIdentity  = 'none';
        _fbAuthError = `${firstError} + anon:${_ae.code}`;
        if (typeof window !== 'undefined') /** @type {any} */ (window)._mybAuthError = `${firstError} + anon:${_ae.code}`;
        return false;
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
 * @param {{ retries?: number, delayMs?: number }} [opts]
 * @returns {Promise<boolean>} true if it is safe to proceed (named session, or flag off)
 */
export async function ensureNamedSession(name, { retries = 2, delayMs = 300 } = {}) {
    _feedAuth({ type: 'RESOLVE_START', member: name });   // store: resolving (observing only — Phase 2)
    let ok = await ensureFirebaseSession(name);
    if (!CONFIG.ENFORCE_NAMED_SESSION) {
        _syncAuthTerminal(name);
        if (firebaseSessionIsNamed()) refreshClaimsIfStale(CONFIG.CLAIM_EPOCH);   // B3 sweep (fire-and-forget)
        return ok;   // flag off → legacy behaviour, no gating
    }
    let attempt = 0;
    while (!ok && attempt < retries && isTransientAuthError(getFirebaseAuthError())) {
        _feedAuth({ type: 'TRANSIENT', error: getFirebaseAuthError() ?? null });   // store: degraded
        attempt++;
        await new Promise(r => setTimeout(r, delayMs * attempt));
        _feedAuth({ type: 'RETRY' });   // store: resolving again
        ok = await ensureFirebaseSession(name);
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
 * exact "bell stuck off-lapsed" bug calendarAuthReady prevents. A lingering
 * identity is harmless: the rules already accept any authenticated session
 * (anonymous included), so leaving it grants no extra access. Firebase is signed
 * out only on an EXPLICIT clearSession() (user-initiated logout), and
 * ensureFirebaseSession() replaces a mismatched identity on the next login.
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
 */
export function saveSession(name) {
    const now = Date.now();
    lsSet(AUTH_KEY, JSON.stringify({
        name,
        ver:          SESSION_VER,
        expiry:       now + SESSION_MS,
        lastActivity: now,
    }));
}

/** Clear the session from localStorage AND sign out of Firebase Auth. This is the
 *  user-initiated logout path — unlike passive expiry in getSession(), an explicit
 *  logout should fully tear down the Firebase identity too. (No anon-auth bootstrap
 *  races this: the page reloads immediately after, starting auth cleanly.) */
export function clearSession() {
    lsDel(AUTH_KEY);
    firebaseSignOut(auth).catch((/** @type {any} */ err) => console.warn('[Auth] signOut failed:', err));
    _feedAuth({ type: 'SIGN_OUT' });   // store: signedOut (observing only — Phase 2)
}
