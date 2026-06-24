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

/**
 * Module-level promise that resolves once the Firebase Auth session for this
 * page is confirmed. Page coordinators call resolveSession(); feature modules
 * import sessionReady and await it instead of reading window._mybSession.
 *
 * Resolves to true (session active), false (session failed or non-auth path),
 * or the boolean returned by ensureFirebaseSession().
 * @type {Promise<boolean>}
 */
let _sessionResolve;
export const sessionReady = new Promise(r => (_sessionResolve = r));
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
    await authReady;
    // auth.currentUser is null synchronously even when a session exists in
    // IndexedDB. Wait for the first onAuthStateChanged to get the real state.
    const existing = await new Promise(resolve => {
        const unsub = onAuthStateChanged(auth, user => { unsub(); resolve(user); });
    });
    // Only reuse a persisted session when it belongs to the expected user.
    // An anonymous fallback session, or a session for a different member (e.g.
    // Person A was active on a shared browser and Person B now selects their name),
    // must not be reused — sign out and re-authenticate under the correct identity.
    if (existing) {
        if (!existing.isAnonymous && existing.email === nameToEmail(name)) return true;
        await firebaseSignOut(auth);
    }

    const pw         = getSurname(name);
    // Firebase Auth requires ≥6 chars — repeat the derived password string to reach the minimum.
    const fbPassword = pw.length >= 6 ? pw : pw.padEnd(6, pw);
    const email      = nameToEmail(name);
    let   firstError;

    try {
        await signInWithEmailAndPassword(auth, email, fbPassword);
        return true;
    } catch (e) {
        firstError = e.code;
        console.warn('[Auth] signIn failed:', e.code, 'for', email);
        if (e.code === 'auth/user-not-found') {
            try {
                await createUserWithEmailAndPassword(auth, email, fbPassword);
                console.warn('[Auth] Created Firebase Auth account for', name);
                return true;
            } catch (createErr) {
                console.warn('[Auth] createUser failed:', createErr.code, 'for', email);
                firstError = createErr.code;
            }
        }
        // auth/invalid-credential means the account exists with a different password —
        // attempting createUser would fail with auth/email-already-in-use.
        // Fall through to anonymous sign-in directly.
    }

    // Fallback: anonymous sign-in satisfies `request.auth != null`.
    // Covers: email/password provider disabled (auth/operation-not-allowed),
    // password mismatch on an existing account (auth/email-already-in-use),
    // and any other persistent email/password failure.
    console.warn('[Auth] Falling back to anonymous sign-in. Original error:', firstError);
    window._mybAuthError = firstError; // surfaced by admin-auth.js in diagnostics
    try {
        await signInAnonymously(auth);
        console.warn('[Auth] Anonymous session established for', name);
        return true;
    } catch (anonErr) {
        console.error('[Auth] Anonymous sign-in failed:', anonErr.code);
        window._mybAuthError = `${firstError} + anon:${anonErr.code}`;
        return false;
    }
}

/**
 * Read and validate the current localStorage session. Returns null if
 * missing, absolutely expired (30 days), version-stale, or idle (7 days).
 * Auto-touches lastActivity on every valid call so opening the app resets
 * the idle clock — no separate touchSession() needed.
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

/** Persist a new session for the named user (30-day absolute expiry, idle clock starts now). */
export function saveSession(name) {
    const now = Date.now();
    lsSet(AUTH_KEY, JSON.stringify({
        name,
        ver:          SESSION_VER,
        expiry:       now + SESSION_MS,
        lastActivity: now,
    }));
}

/** Clear the session from localStorage and sign out of Firebase Auth. */
export function clearSession() {
    lsDel(AUTH_KEY);
    firebaseSignOut(auth).catch(err => console.warn('[Auth] signOut failed:', err));
}
