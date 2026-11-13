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
 *
 * ── A TIER TAKEN AWAY STOPS AT ONCE (audit D3) ──────────────────────────────────────────────────
 *
 * setCustomUserClaims replaces an account's claims, but a token already issued carries the old ones
 * until it renews — up to an hour, in which a member just taken off the admin, manager or designer
 * list still has that tier. So when Set up accounts takes one away, it revokes the account's refresh
 * tokens: `requireAdmin` verifies with `checkRevoked`, so the Cloud Functions refuse the old tier at
 * once (the Firestore rules read the token itself, and catch up when it renews). Never for the same
 * tier or a higher one: a revocation signs the member out of every device.
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

/** The claims a tier adds above `name`/`member` — what a re-stamp can take away (the header, D3). */
const ELEVATED_CLAIMS = Object.freeze(['admin', 'manager', 'linksDesigner']);

/**
 * Which elevated claims an account HELD before a re-stamp and will not hold after it. Only `true`
 * counts as held, as the rules read it. An account with nothing before — new, or taken back — loses
 * nothing, and neither does one whose tier stays or RISES: manager → admin drops `manager` only on
 * paper, because admin outranks it and claimsForTier never stamps both.
 * @param {Record<string, any>|null|undefined} before  the account's customClaims, as read before the stamp
 * @param {Record<string, any>} after                  the claims being stamped (claimsForTier)
 * @returns {string[]}  in ELEVATED_CLAIMS order; empty when nothing is taken away
 */
function elevatedClaimsLost(before, after) {
    if (!before || typeof before !== 'object') return [];
    const has = (/** @type {any} */ c, /** @type {string} */ k) => !!c && c[k] === true;
    return ELEVATED_CLAIMS.filter((k) => has(before, k) && !has(after, k) && !(k === 'manager' && has(after, 'admin')));
}

module.exports = { passwordWriteRefused, unwrittenResetAnswer, elevatedClaimsLost, ELEVATED_CLAIMS };
