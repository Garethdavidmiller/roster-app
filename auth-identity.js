// @ts-check
/**
 * auth-identity.js — pure helpers that derive a member's Firebase Auth identity (the synthetic
 * account email + the normalised surname used as the password core) from their teamMembers
 * display name.
 *
 * Extracted from firebase-client.js (v16.50) so they are directly unit-testable: firebase-client.js
 * statically imports the Firebase SDK from the gstatic CDN, which cannot load in a Node test, so
 * anything defined there is only reachable behind a module mock. These functions have NO imports.
 * firebase-client.js re-exports `normaliseSurname` and `nameToEmail`, so an importer may take them
 * from either.
 *
 * A DELIBERATE duplicate of `normaliseSurname`'s core derivation lives in
 * `functions/roster-parse-helpers.js` (`nameToPassword`) — Cloud Functions are CommonJS and cannot
 * import a browser ES module, so unification would need a build step. `surname-parity.test.mjs`
 * asserts the two stay in sync (its source-equivalence check reads THIS file).
 *
 * ⚠️ WARNING: changing this derivation locks out every staff member — it moves the email every
 *   account is looked up by, and the surname default. Never change it without the other two copies
 *   (AUTH_AND_SESSIONS.md 12) and a reset of every affected account.
 */

/**
 * Normalise a display name's surname for Firebase Auth: everything after the first space,
 * lowercased, non-alpha stripped. The ≥6-char password padding is applied SEPARATELY by the
 * password builders (session.js / functions), NOT here.
 *   "G. Miller"            → "miller"
 *   "C. Francisco-Charles" → "franciscocharles"
 * @param {string} fullName
 * @returns {string}
 */
export function normaliseSurname(fullName) {
    return fullName.split(' ').slice(1).join('').toLowerCase().replace(/[^a-z]/g, '');
}

/**
 * Derive a stable Firebase Auth email from a teamMembers display name.
 *
 * Convention: initial.surname@myb-roster.local
 *   "G. Miller"            → "g.miller@myb-roster.local"
 *   "C. Francisco-Charles" → "c.franciscocharles@myb-roster.local"
 *   "L. Atrakimaviciene"   → "l.atrakimaviciene@myb-roster.local"
 *
 * The @myb-roster.local domain is synthetic — these accounts are never used for email delivery.
 * Note: Firebase Auth's distinct error codes for auth/user-not-found vs auth/invalid-credential can
 * reveal whether an account exists for a given email, unless the project's email-enumeration
 * protection folds both into auth/invalid-credential — the case the sign-in copy is written for
 * (PASSWORD_DESIGN.md §3.5).
 *
 * @param {string} fullName - Display name exactly as stored in teamMembers
 * @returns {string} Firebase Auth email address
 */
export function nameToEmail(fullName) {
    const parts   = fullName.split(' ');
    const initial = parts[0].replace(/[^a-zA-Z]/g, '').toLowerCase();
    const surname = normaliseSurname(fullName);
    return `${initial}.${surname}@myb-roster.local`;
}

/**
 * The padded surname password — the account's INITIAL / admin-reset credential. Firebase Auth
 * requires ≥6 chars, so a short surname is repeated to reach the minimum; an empty surname falls
 * back to a run of 'x' (an unusable password that simply won't match any real account — the client
 * never throws here, unlike the functions-side `nameToPassword`). This is the SINGLE client source
 * for the padding (previously inline in session.js); both the sign-in candidate list and the
 * Settings reauth use it via `credentialCandidatesFor`, so the rule exists exactly once.
 *   "G. Miller" → "miller"   ·   "A. Tuck" → "tucktu"   ·   "Madonna" (no surname) → "xxxxxx"
 * @param {string} fullName
 * @returns {string}
 */
export function surnamePassword(fullName) {
    const s = normaliseSurname(fullName);
    return s.length >= 6 ? s : s.padEnd(6, s || 'x');
}

/**
 * The ordered Firebase Auth password candidates to try for a member who typed `typed` at the login
 * (or Settings reauth) field. PASSWORD_DESIGN.md §3.2:
 *   1. the RAW typed value (leading/trailing whitespace trimmed, otherwise untouched — a chosen
 *      password keeps its case / digits / symbols); and
 *   2. the derived surname password — appended ONLY when the typed value NORMALISES to the member's
 *      surname. This GATE is load-bearing: an ungated surname fallback would sign an attacker typing
 *      ANYTHING into an un-migrated account (the surname attempt would succeed regardless of input).
 *      Gated, it covers exactly what today's local check allows — caps ("Miller") and the <6-char
 *      padding cases ("bibi" → "bibibi") — and grants an attacker nothing the surname doesn't already.
 * Deduped when the two would be byte-identical. An empty typed value yields no candidates.
 * @param {string} fullName
 * @param {string} typed
 * @returns {string[]}
 */
export function credentialCandidatesFor(fullName, typed) {
    const raw = (typeof typed === 'string' ? typed : '').trim();
    /** @type {string[]} */
    const candidates = [];
    if (raw) candidates.push(raw);
    const normTyped = raw.toLowerCase().replace(/[^a-z]/g, '');
    if (normTyped && normTyped === normaliseSurname(fullName)) {
        const sp = surnamePassword(fullName);
        if (sp !== raw) candidates.push(sp);
    }
    return candidates;
}

/**
 * Whether a member has MIGRATED to their own chosen password (PASSWORD_DESIGN.md §6).
 *
 * Migrated ⇔ they have set a password (`passwordSetAt` present) AND it is at least as new as the
 * most recent admin reset (`resetAt`) — a later admin reset returns the account to the surname
 * default and re-flags it un-migrated. Reads Firestore Timestamp-like fields by duck-typing
 * `.toMillis()` (so this stays Firebase-free and unit-testable); a missing/parse-less field is 0.
 *
 * Single source for the Operations Account-status table (`operations-app.js`) and the Settings
 * status chip/nudge (`settings-app.js`) — previously duplicated inline in both, which risked drift.
 *
 * @param {{ passwordSetAt?: any, resetAt?: any }|null|undefined} status  the passwordStatus doc
 * @returns {boolean}
 */
export function isPasswordMigrated(status) {
    const setAt   = status?.passwordSetAt?.toMillis?.() ?? 0;
    const resetAt = status?.resetAt?.toMillis?.() ?? 0;
    return setAt > 0 && setAt >= resetAt;
}

/** The minimum length of a chosen password (PASSWORD_DESIGN.md §4 — Firebase's own floor is 6). */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * Validate a member's CHOSEN password. Returns a staff-facing error sentence, or `null` when valid.
 *
 * The SINGLE source for the rules in PASSWORD_DESIGN.md §4, shared by the Settings Password card and the
 * forced overlay (`password-force.js`, v18.92). It was inline in settings-app.js until the overlay
 * needed the same rules — and two copies of a validation rule is how the Other-day grammar drifted
 * (v18.91). If these two ever disagreed, a member could set a password through one surface that the
 * other would reject, or worse set their surname back through the overlay and be flagged "migrated ✓"
 * while still on a guessable credential.
 *
 * Rule order is preserved from the Settings card so the message a member sees is unchanged: length,
 * then mismatch, then the surname block.
 *
 * @param {string} fullName  the member's display name, for the surname check
 * @param {string} next      the new password (trimmed by the caller or here)
 * @param {string} confirm   the confirmation field
 * @returns {string|null} the error to show, or null when the password is acceptable
 */
export function validateNewPassword(fullName, next, confirm) {
    const n = (typeof next === 'string' ? next : '').trim();
    const c = (typeof confirm === 'string' ? confirm : '').trim();
    if (n.length < MIN_PASSWORD_LENGTH) return `Your new password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
    if (n !== c) return 'The two new passwords don’t match.';
    // Block choosing the surname back — otherwise "migrated ✓" is a lie for that member. The
    // `surname &&` guard matters: normaliseSurname('') === '' for a single-word display name, and
    // without it ANY all-digits/symbols password (whose alpha part is also '') would be rejected as
    // "your surname".
    const surname = normaliseSurname(fullName || '');
    if (surname && n.toLowerCase().replace(/[^a-z]/g, '') === surname) return 'Choose something other than your surname.';
    return null;
}

/**
 * Which field a `validateNewPassword` refusal is ABOUT, so both surfaces send the caret there. Derived
 * exactly, never from "the two boxes differ": a short new password with an empty Confirm box differs
 * too, and Settings sent the caret to Confirm while its message spoke of the new one (sign-in check,
 * 11 Nov 2026 — the forced change had its own exact copy since v18.94; this is now the one).
 * @param {string} next  the new password, trimmed  @param {string} confirm  the confirmation, trimmed
 * @returns {'new'|'confirm'}
 */
export function newPasswordProblemField(next, confirm) {
    return next.length >= MIN_PASSWORD_LENGTH && next !== confirm ? 'confirm' : 'new';
}

/**
 * What to say when CHANGING a password fails, and which field to return to — ONE ladder for Settings →
 * Password and the forced change (sign-in check, 11 Nov 2026: the two copies had drifted apart). Each
 * surface keeps only what is its own: `auth/requires-recent-login`, whose remedy differs by surface.
 * Ordered by CAUSE, then by STAGE: a failure after re-authentication succeeded is never "current
 * password incorrect", which sent members to an admin reset over a network blip.
 * @param {string} code  the Firebase error code, '' for none
 * @param {boolean} reauthed  whether re-authentication had already succeeded (or was not needed)
 * @returns {{ message: string, focus: 'current'|'new'|null, escape?: true }}  `escape`: no retyping gets
 *   past it — a rate limit, or no connection (a hang reads as one) — so the forced change offers its way out
 */
export function passwordChangeFailure(code, reauthed) {
    if (code === 'auth/too-many-requests') return { message: 'Too many attempts — wait a few minutes and try again.', focus: null, escape: true };
    if (code === 'auth/network-request-failed' || code === 'myb/timeout') return { message: 'Couldn’t connect — check your connection and try again.', focus: null, escape: true };
    if (code === 'auth/weak-password') return { message: 'That password is too weak — choose a longer one.', focus: 'new' };
    if (code === 'auth/missing-password') return { message: 'Enter your current password.', focus: 'current' };
    if (!reauthed && isCredentialRejection(code)) return { message: 'Current password incorrect — try again, or ask the admin to reset it.', focus: 'current' };
    if (!reauthed) return { message: 'Couldn’t verify your current password — try again shortly.', focus: null };
    return { message: 'Your password wasn’t updated — try again shortly.', focus: null };
}

/**
 * Firebase Auth error codes that mean the supplied credentials are DEFINITIVELY wrong — as opposed to
 * a transient failure (network / rate-limit / provider outage / requires-recent-login). Only on one of
 * these should a candidate-ladder try the NEXT password: a non-credential failure must stop
 * immediately, or the surname fallback would be retried needlessly (duplicate traffic, worse
 * rate-limiting, a misleading final error). `invalid-credential` is the modern
 * email-enumeration-safe code; the others cover older SDK phrasings.
 *
 * Single source shared by the sign-in candidate ladder (session.js) AND the Settings reauth
 * (firebase-client.js `reauthenticateWithPassword`) so the two can't drift (PASSWORD_DESIGN.md §3.2).
 * @type {Set<string>}
 */
export const CREDENTIAL_REJECTION_CODES = new Set([
    'auth/wrong-password', 'auth/invalid-credential', 'auth/invalid-login-credentials', 'auth/user-not-found',
]);

/** @param {string|undefined} code @returns {boolean} true iff `code` is a definitive credential rejection */
export function isCredentialRejection(code) {
    return !!code && CREDENTIAL_REJECTION_CODES.has(code);
}

/**
 * WAS THIS DEVICE'S SESSION CREATED BEFORE THE MEMBER'S LAST ADMIN RESET? (Oct 2026 production
 * review.) An admin reset sets the password back to the surname default and revokes refresh tokens —
 * and a device that still held the 60-day local session then signed straight back in with that same
 * surname on its next page load, because the no-typed-password path tries exactly that. "Sign them out
 * of their other devices" was undone by the device it was aimed at: a lost phone came back in.
 *
 * So a silent (no-typed-password) re-sign-in is refused when the server's `resetAt` is newer than the
 * session it is re-establishing. A session created by typing a password after the reset is newer, and
 * passes; every older device has to type one.
 *
 * FAILS CLOSED when the reset time is UNKNOWN (`null`: the read failed, timed out or came from the
 * offline cache). The surname sign-in it guards has just reached the server, so an unknown answer is
 * rare, and its cost is one typed password — the alternative cost is the hole this closes.
 *
 * @param {number|null} sessionCreatedMs  when this device's local session was created (device clock)
 * @param {number|null} resetAtMs         server `resetAt` in ms; 0 = never reset; null = unknown
 * @returns {boolean} true = refuse the silent sign-in
 */
export function sessionPredatesReset(sessionCreatedMs, resetAtMs) {
    if (resetAtMs === 0) return false;
    if (resetAtMs == null || !Number.isFinite(resetAtMs)) return true;
    if (sessionCreatedMs == null || !Number.isFinite(sessionCreatedMs)) return true;
    return sessionCreatedMs < resetAtMs;
}

/**
 * Read the member's `resetAt` out of a Firestore REST document (Oct 2026, bug check of the reset
 * refusal). The silent re-sign-in now asks BEFORE it signs in — see `probeResetAtMs` in
 * firebase-client.js for why — so it reads `passwordStatus/{name}` through the REST API, whose
 * answer is `{ fields: { resetAt: { timestampValue: "…" } } }`.
 * @param {number} status  the HTTP status of the read
 * @param {any} body       its parsed JSON, or null
 * @returns {number|null}  ms since epoch; 0 = never reset (no document, or no `resetAt`); null = unknown
 */
export function resetAtFromRestDoc(status, body) {
    if (status === 404) return 0;
    if (status !== 200 || !body || typeof body !== 'object') return null;
    const v = body.fields?.resetAt?.timestampValue;
    if (v === undefined) return 0;
    const ms = Date.parse(String(v));
    return Number.isFinite(ms) ? ms : null;
}

/**
 * Did the Identity Toolkit REST sign-in refuse because Google is THROTTLING this account (v24.70)?
 * Different from both a rejection and a failure to answer: retrying would only extend the lock-out it
 * is reporting, so the caller holds the silent sign-in under the throttle's own code.
 * @param {number} status
 * @param {any} body
 * @returns {boolean}
 */
export function isRestThrottled(status, body) {
    return status === 400 && /^TOO_MANY_ATTEMPTS/.test(String(body?.error?.message || ''));
}

/**
 * Did the Identity Toolkit REST sign-in REJECT the credential (as opposed to failing to answer)?
 * A rejection is not "unknown": the caller lets the ordinary SDK sign-in run and fail exactly as it
 * always has, so the remembered-migrated-member logic keeps working.
 * @param {number} status
 * @param {any} body
 * @returns {boolean}
 */
export function isRestCredentialRejection(status, body) {
    if (status !== 400) return false;
    const m = String(body?.error?.message || '');
    return /^(INVALID_LOGIN_CREDENTIALS|INVALID_PASSWORD|EMAIL_NOT_FOUND|USER_DISABLED)/.test(m);
}
