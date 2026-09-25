'use strict';

/**
 * functions/member-identity.js — WHICH member a verified ID token speaks for, or none.
 * Requires only `nameToEmail`. No Firebase, no HTTP.
 *
 * ── WHY THIS EXISTS (v24.23 — critical; external audit 25 Sep 2026) ─────────────────────────────
 *
 * Every member endpoint took the member from `decoded.name`. That field is not ours alone: Firebase
 * fills an ID token's `name` from the account's DISPLAY NAME whenever no custom claim overrides it,
 * and any session may set its own display name. Anonymous sign-in is enabled, so a stranger could
 * sign in anonymously, call itself "G. Miller", and submit Overtime availability as him or mint
 * document links through the member door. The shared PIN account was worse: it was created WITH a
 * display name, so every PIN token already carried a `name`.
 *
 * THE BINDING — the same one `firestore.rules` now applies (`isMember`): a `name` is believed only
 * when the session signed in with a PASSWORD and its email is the one that name derives to. Member
 * accounts are provisioned on exactly that email and Firebase allows one account per email, so only
 * the real member's account can pass. The rules and this file are two copies of one rule, which is
 * why both are tested against every roster name.
 *
 * It returns the NAME rather than a boolean so a caller cannot check the binding and then read the
 * unchecked field anyway: the only way to a member name from a token is through here.
 *
 * ── AND THE SERVER-ONLY CLAIM (v24.27) ──────────────────────────────────────────────────────────
 *
 * The binding left one door: a name with no account yet could be registered by anybody at its
 * derived email, and that account passed it. `member` is a custom claim setupRosterAuth stamps, equal
 * to the name, which nothing a client can do produces — so it is required here too, exactly as
 * `isMember()` requires it. KNOWN_LIMITATIONS.md → "The member claim".
 */

const { nameToEmail } = require('./roster-parse-helpers');

/**
 * The member a decoded ID token genuinely belongs to, or `null`.
 * @param {any} claims  a verified, decoded ID token
 * @returns {string|null}
 */
function memberNameFromClaims(claims) {
    if (!claims || typeof claims !== 'object') return null;
    const name = claims.name;
    if (typeof name !== 'string' || !name) return null;
    if (claims.firebase?.sign_in_provider !== 'password') return null;
    if (typeof claims.email !== 'string' || !claims.email) return null;
    if (claims.member !== name) return null;
    return claims.email.toLowerCase() === nameToEmail(name).toLowerCase() ? name : null;
}

module.exports = { memberNameFromClaims };
