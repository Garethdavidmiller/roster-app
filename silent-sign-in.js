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
 * NAT address (the same fact `calendar-viewer-auth.js` sizes its throttles against): enough doomed
 * attempts from enough migrated members' devices and the throttle starts rejecting CORRECT typed
 * passwords with `auth/too-many-requests`, which reads to staff as "the app keeps asking and won't
 * take my password".
 *
 * The flag is set only on a wrong-password-class rejection of the SURNAME candidate — never on
 * `auth/user-not-found`, where the account simply doesn't exist yet and a later provisioning would
 * make the surname valid (`remembersRefusal`). It is cleared the moment any sign-in SUCCEEDS with the
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
    const flaggedAt = Number(stored) || 0;
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
