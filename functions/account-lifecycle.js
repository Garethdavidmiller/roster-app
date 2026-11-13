'use strict';

/**
 * functions/account-lifecycle.js — the pure rules Set up accounts and the admin reset apply at the
 * edges of an account's life (sign-in audit, Nov 2026). Requires nothing: no Firebase, no HTTP, so
 * every rule is tested on its own (account-lifecycle.test.mjs) and through the real handlers
 * (auth-endpoints.test.mjs). auth-endpoints.js is the orchestration around them.
 *
 * ── A PASSWORD WRITE THAT THROWS IS EITHER REFUSED OR UNKNOWN (audit E1) ─────────────────────────
 *
 * resetMemberPassword stamps `resetAt` FIRST (AUTH_AND_SESSIONS 23), then writes the password. When
 * that write throws, one of two things is true, and they need opposite remedies:
 *   · Auth REFUSED it, and nothing changed. A stamp left behind shows the member as back on their
 *     surname — Account status "Default", Settings and the forced overlay all say so — while their own
 *     password still works. So the stamp is put back.
 *   · Nobody knows: a network failure, a timeout, an error nothing here recognises. The password may
 *     have changed. The stamp is KEPT — the safe direction: a stale stamp only shows "Default" and asks
 *     for a new password, while a missing one would let an old device sign itself back in with the
 *     surname.
 * So the refusals are an ALLOWLIST, and a short one. What is NOT on it matters as much: the Admin SDK's
 * `updateUser` WRITES and then READS the account back, so `auth/internal-error`, `auth/quota-exceeded`
 * and their like can come from that read, AFTER the password changed. Only a code that cannot arise
 * once the write has landed proves nothing changed: the SDK's own checks of its arguments, made before
 * any request, and the service refusing the password or not finding the account.
 */

/** Auth codes that PROVE a password write changed nothing — the header says why the list is short. */
const PASSWORD_WRITE_REFUSALS = new Set([
    'auth/invalid-password',   // the new password refused — the SDK's length check, or the service's
    'auth/user-not-found',     // no such account: none to sign in to, whatever the stamp says
    // The SDK's checks of what it was handed, before any request leaves:
    'auth/argument-error', 'auth/invalid-uid', 'auth/invalid-display-name', 'auth/invalid-disabled-field',
    'auth/invalid-provider-id',
]);

/**
 * Does this error from a password write PROVE nothing changed? Only a code on the allowlist does;
 * no code, an app or network error, or any other Auth code is an UNKNOWN outcome.
 * @param {any} err
 * @returns {boolean}
 */
function passwordWriteRefused(err) {
    return !!err && typeof err.code === 'string' && PASSWORD_WRITE_REFUSALS.has(err.code);
}

/**
 * What the admin is told when a reset's password write threw: the status, and a sentence that is true
 * in every branch — "nothing was changed" only when the write was refused AND its stamp went back.
 * A refusal is a 4xx (404 for a missing account, as before; 409 otherwise), so Operations shows it as
 * a refusal with its reason; an unknown outcome is a 500 that says resetting again is safe, which it
 * is — the stamp is still there, and a second reset only repeats what the first may have done.
 * @param {string} member
 * @param {any} err  what the password write threw
 * @param {{ restored: boolean }} outcome  whether the stamp was put back (only ever tried on a refusal)
 * @returns {{ status: number, error: string }}
 */
function unwrittenResetAnswer(member, err, { restored }) {
    if (!passwordWriteRefused(err)) {
        return { status: 500, error: `It isn't known whether ${member}'s password changed: Firebase did not confirm it. Resetting again is safe.` };
    }
    const missing = err.code === 'auth/user-not-found';
    const why = missing ? `No Firebase account for "${member}" — run Set up accounts first.`
        : `Firebase refused the new password for ${member} (${err.code}).`;
    return {
        status: missing ? 404 : 409,
        error: restored ? `${why} Nothing was changed.`
            : `${why} Their password did not change, but the reset could not be taken off their record, so the app may ask them to sign in again and choose a new password.`,
    };
}

module.exports = { passwordWriteRefused, unwrittenResetAnswer };
