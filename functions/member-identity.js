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

/**
 * Whether an existing account at a roster email must be TAKEN BACK before its claims are stamped
 * (v24.24): only when it carries NO custom claim. Only the Admin SDK or the console can set one, so
 * any claim means this server or an admin touched it. Not `name`: that would also reset an admin
 * given `{ admin: true }` by hand — the recovery admin-auth.js suggests — mid-click. Lives here
 * beside the claim it protects; setupRosterAuth (auth-endpoints.js) is the caller.
 * @param {{ customClaims?: Record<string, any>|null }} user
 * @returns {boolean}
 */
function mustReclaim(user) {
    const c = user && user.customClaims;
    return !c || Object.keys(c).length === 0;
}

/**
 * The `updateUser` field that removes every sign-in method but the password from an account being
 * TAKEN BACK or re-enabled (v24.56, auth review): resetting the password of an account somebody else
 * held left any other method they had linked working. Empty when there is nothing to remove.
 * @param {{ providerData?: Array<{ providerId: string }> }} user
 * @returns {{ providersToUnlink?: string[] }}
 */
function unlinkOtherProviders(user) {
    const others = ((user && user.providerData) || []).map((p) => p && p.providerId)
        .filter((id) => id && id !== 'password');
    return others.length ? { providersToUnlink: others } : {};
}

/**
 * The OTHER member an existing account's claims belong to, or `null` when they are this address's own
 * (whole-app check, 10 Nov 2026). setupRosterAuth stamps a roster name's claims onto whatever account
 * holds that name's email, and adopted any account already carrying a claim — so an account that came
 * to hold a not-yet-provisioned colleague's address (an email change, wherever the project allows
 * one) would have been handed that colleague's identity and tier. The test is the ADDRESS: the member
 * named in the claims must derive to this account's own email. A member renamed with a spelling that
 * still derives it is the same person, and an account an admin gave `{ admin: true }` names nobody.
 * A claimed name that derives no address at all is treated as somebody else's — never assumed ours.
 * @param {{ email?: string, customClaims?: Record<string, any>|null }} user
 * @returns {string|null}
 */
function claimedByAnotherMember(user) {
    const c = user && user.customClaims;
    if (!c || typeof c !== 'object') return null;
    const claimed = [c.member, c.name].find((n) => typeof n === 'string' && n) || null;
    if (!claimed) return null;
    let derived = '';
    try { derived = nameToEmail(claimed); } catch (_) { /* underivable: not this address's */ }
    const own = typeof user.email === 'string' ? user.email.toLowerCase() : '';
    return derived && own && derived.toLowerCase() === own ? null : claimed;
}

module.exports = { memberNameFromClaims, mustReclaim, claimedByAnotherMember, unlinkOtherProviders };
