// @ts-check
/**
 * silent-sign-in.js — the RULES of the sign-in nobody typed: what a page load may try for a member
 * whose 60-day local session has no Firebase identity behind it, when a device that has seen the
 * surname refused still asks whether an admin reset ended its session (AUTH_AND_SESSIONS 23), and when
 * the session it re-establishes BEGAN — the start that reset is compared with (`sessionStartMs`).
 *
 * Pure: no storage, no Firebase, no clock of its own. session.js (`ensureFirebaseSession`) reads and
 * writes the memory below and hands the time in, so every rule here runs in a Node test with plain
 * values (session.test.mjs). It was session.js's own until that file reached its size cap
 * (coordinator-ratchet.test.mjs) — the ratchet's EXTRACT: a rule that would be wrong if it were wrong.
 *
 * ── THE MEMORY: A MEMBER'S ACCOUNT DOES NOT ACCEPT THE SURNAME (v21.62) ─────────────────────────
 *
 * Every implicit re-establishment — a page load with a live session but no Firebase identity — used
 * to fire the derived surname at Firebase unconditionally. For a MIGRATED member that is a
 * GUARANTEED wrong-password, once per locked load, from every affected device: pure cost, and two
 * real harms. First, the actionable "enter your password" state waits behind a round trip that can
 * only fail. Second — and the reason this is a flag rather than a tidy-up — Firebase's abuse
 * protection throttles by IP as well as by account, and the whole station sits behind ONE corporate
 * NAT address (the same fact the retired staff PIN's throttles were sized against): enough doomed
 * attempts from enough migrated members' devices and the throttle starts rejecting CORRECT typed
 * passwords with `auth/too-many-requests`, which reads to staff as "the app keeps asking and won't
 * take my password".
 *
 * The flag is set only on a wrong-password-class rejection of the SURNAME candidate — never on
 * `auth/user-not-found`, where the account simply doesn't exist yet and a later provisioning would
 * make the surname valid (`remembersRefusal`). The reset probe in front of the sign-in is a sign-in
 * too, and ANY refusal of it sets the flag without the SDK being asked (session.js) — a wrong
 * password, but also no such account (EMAIL_NOT_FOUND, sent only with email-enumeration protection
 * off) and a DISABLED account (USER_DISABLED), which it records as `auth/invalid-credential` as well.
 * That is deliberate: neither can take the surname until an admin acts, and creating, re-enabling or
 * resetting an account all stamp a reset the old session predates anyway (AUTH_AND_SESSIONS 23), so a
 * device flagged for either costs no more than the rule below (`isRestCredentialRejection`,
 * auth-identity.js). It is cleared the moment any sign-in SUCCEEDS with the
 * surname (the admin break-glass reset returns an account to the default, and the member's next typed
 * surname both signs them in and re-arms the silent recovery). A stale flag therefore costs exactly
 * one typed sign-in, ever. Typed passwords are NEVER gated by it — it suppresses only the implicit,
 * nothing-typed attempt that cannot succeed.
 *
 * ── …AND IT STILL ASKS ABOUT A RESET, EVERY SIX HOURS (sign-in check, 11 Nov 2026) ──────────────
 *
 * With no surname to try, the reset check in front of it never ran either, and an admin reset left
 * a flagged device's session standing. So the flag holds WHEN it last asked ('1' from before v25.77
 * reads as long ago), and a device asks again once `RESET_RECHECK_MS` has passed (`planSilentAttempt`).
 * What the answer does is `afterRecheck`: a refused surname or a throttle is an answer and is noted —
 * after a THROTTLED answer too, or every load asked again and kept the station's lock-out going — and
 * a refused surname stops there, because the SDK sign-in would only repeat the same doomed request.
 * NO answer is not noted (the next load would read it as refused), and it is asked once per sign-in
 * attempt, not again on each of its retries: three requests a load to a server that had not answered one.
 */

import { isCredentialRejection } from './auth-identity.js';

/** How long anything waits for Firebase Auth to restore or sign in before it stops waiting: 8s, the
 *  sign-in budget the login freeze settled on. ONE number for "how long is Firebase allowed to take",
 *  rather than a different guess per call site — the boot restore (`currentUserAfterBoot` and the first
 *  emission's own bound, firebase-client.js), `restoreFirstAuthUser` (session.js, which re-exports it)
 *  and a typed sign-in's deadline (`runNamedSignIn`, login-core.js). It lives HERE because this module
 *  is pure and imports only auth-identity.js, so all three can import it without a cycle and without
 *  pulling the Firebase SDK into login-core.js's Node tests. (password-force.js's `SAVE_TIMEOUT_MS`
 *  matches it, and is its own constant.) */
export const AUTH_RESTORE_TIMEOUT_MS = 8000;

/** The memory's storage key, per member: localStorage `myb_auth_nodefault_<name>`, holding WHEN the
 *  surname was last refused or asked about. @param {string} name @returns {string} */
export const noDefaultKey = (name) => 'myb_auth_nodefault_' + name;

/** How often a FLAGGED device still asks whether an admin reset ended its session (invariant 23). */
export const RESET_RECHECK_MS = 6 * 3_600_000;

/**
 * What the silent attempt may try for one member, given what this device remembers.
 * @param {{ surname: string, stored: string|null, now: number, unansweredThisAttempt: boolean }} p
 *   `surname` — the member's surname default (`surnamePassword`); `stored` — the memory as read, or
 *   null; `unansweredThisAttempt` — a recheck already asked in THIS sign-in attempt got no answer
 * @returns {{ candidates: string[], recheck: boolean, held: boolean }}  `held`: ask nothing more in
 *   this attempt (session.js records `auth/reset-check-unavailable`, so it ends TRANSIENT)
 */
export function planSilentAttempt({ surname, stored, now, unansweredThisAttempt }) {
    // A FLAG IS A FLAG, WHATEVER TIME IT CARRIES (external audit of v26.92). A marker that is not a time
    // read as 0, so it never came due, and one dated in the FUTURE (a clock that ran ahead when it was
    // written) waited until six hours past that future moment. Either way the device kept no session it
    // could check and never asked about a reset. A marker that cannot be a past time is DUE, read as
    // long ago — as '1' from before v25.77 always was — and a recheck that is answered writes a real time.
    const at = Number(stored);
    const flaggedAt = !stored ? 0 : (Number.isFinite(at) && at > 0 && at <= now ? at : 1);
    const recheck = flaggedAt > 0 && now - flaggedAt > RESET_RECHECK_MS;
    if (recheck && unansweredThisAttempt) return { candidates: [], recheck, held: true };
    // Empty candidates fall through to session.js's definitive-rejection branch, exactly as a
    // no-surname name always has.
    return { candidates: surname && (!stored || recheck) ? [surname] : [], recheck, held: false };
}

/**
 * What a recheck's reset-probe answer does — only ever asked on a recheck.
 * @param {number|null|'credential'|'throttled'} resetAt  `probeResetAtMs`'s answer
 * @returns {{ note: boolean, stop: boolean, unanswered: boolean }}  `note`: write the memory again,
 *   now; `stop`: end the attempt here; `unanswered`: hold the rest of this attempt's retries
 */
export function afterRecheck(resetAt) {
    return { note: resetAt === 'credential' || resetAt === 'throttled', stop: resetAt === 'credential', unanswered: resetAt === null };
}

/**
 * Does this rejection of the SURNAME candidate teach the device that the account has moved on? A
 * definitive credential rejection does — never `auth/user-not-found` (see the header).
 * @param {string|undefined} code @returns {boolean}
 */
export function remembersRefusal(code) {
    return isCredentialRejection(code) && code !== 'auth/user-not-found';
}

// ── WHEN A SESSION BEGAN IS THE SERVER'S ANSWER, WHERE IT CAN BE HAD (sign-in audit A2, Nov 2026) ──
//
// Before a silent sign-in, the session's start is compared with the server's `resetAt`
// (`sessionPredatesReset`, AUTH_AND_SESSIONS 23). It was stamped from the DEVICE clock, so a phone a
// day ahead at sign-in made a reset later that same day look OLDER than the session, and the surname
// signed it straight back in — the lost phone the reset was aimed at. Firebase records every sign-in
// on its own clock (`metadata.lastSignInTime`), so that is the start, with two conditions: the account
// must be THIS member's (another account's record says nothing about this session), and the record must
// be within `SIGN_IN_CLOCK_SKEW_MS` of the device clock (anything further is not this sign-in's record).
// Otherwise the device clock, as before. The expiry is counted from the same start.

/** How far the server's record of a sign-in may stand from the device clock and still date the session. */
export const SIGN_IN_CLOCK_SKEW_MS = 3 * 86_400_000;

/**
 * When a session saved NOW began (see the block above).
 * @param {{ email?: string|null, metadata?: { lastSignInTime?: string|null } }|null|undefined} user  `auth.currentUser`
 * @param {string} email  the member's own account (`nameToEmail`)
 * @param {number} now    the device clock
 * @returns {number}
 */
export function sessionStartMs(user, email, now) {
    const at = user && user.email === email ? Date.parse(user.metadata?.lastSignInTime ?? '') : NaN;
    return Number.isFinite(at) && Math.abs(now - at) <= SIGN_IN_CLOCK_SKEW_MS ? at : now;
}

// ── THE INSTALLED APP STAYS SIGNED IN (owner, 26 Nov 2026) ───────────────────────────────────────
//
// A session lasts `SESSION_MS` from sign-in in a browser tab or on a desktop (the owner's choice; a
// station PC is not a shared browser — each colleague has their own Windows login). In the app installed on a phone's home screen it is RENEWED each time the app opens with the
// member's own Firebase identity live: "If it is on someone's personal mobile, why am I asking them to
// sign in every 60 days." Nobody installs the app on a shared station PC, and the work phones are one
// person each (owner), so the installed app is the personal phone.
//
// What keeps that safe is that the renewal asks Firebase, never the device: it happens only once the
// member's own account has been restored AND the server has issued its token within the hour
// (`renewWhenServerVouches`, session.js), so a disabled account stops renewing within the hour,
// revoked credentials or a sign-out end it as they always did, and an admin reset still signs
// the phone out (`sessionPredatesReset` compares the session's START, which renewal never moves). A
// session that has already ended is never revived, and a renewal writes at most once a day.

/** The least a renewal moves the expiry — so an app opened every few minutes writes once a day. */
export const RENEW_STEP_MS = 86_400_000;

/**
 * The new expiry for a session opened now, or null when nothing should be written.
 * @param {{ expiry: unknown, installed: boolean, now: number, sessionMs: number }} input
 *   `expiry` the stored expiry; `installed` the app is running from the home screen.
 * @returns {number|null}
 */
export function renewedExpiry({ expiry, installed, now, sessionMs }) {
    if (!installed) return null;                                  // a tab or a desktop keeps the fixed lifetime
    if (typeof expiry !== 'number' || !Number.isFinite(expiry) || now >= expiry) return null;   // never revive an ended session
    const next = now + sessionMs;
    return next - expiry >= RENEW_STEP_MS ? next : null;
}
