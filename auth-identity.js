// @ts-check
/**
 * auth-identity.js — pure helpers that derive a member's Firebase Auth identity (the synthetic
 * account email + the normalised surname used as the password core) from their teamMembers
 * display name.
 *
 * Extracted from firebase-client.js (v16.50) so they are directly unit-testable: firebase-client.js
 * statically imports the Firebase SDK from the gstatic CDN, which cannot load in a Node test, so
 * anything defined there is only reachable behind a module mock. These functions have NO imports.
 * firebase-client.js re-exports both so existing importers (session.js's getSurname) are unaffected.
 *
 * A DELIBERATE duplicate of `normaliseSurname`'s core derivation lives in
 * `functions/roster-parse-helpers.js` (`nameToPassword`) — Cloud Functions are CommonJS and cannot
 * import a browser ES module, so unification would need a build step. `surname-parity.test.mjs`
 * asserts the two stay in sync (its source-equivalence check reads THIS file). If the derivation
 * ever changes, update BOTH places AND reset every staff member's password (see session.js).
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
 * reveal whether an account exists for a given email; documented in KNOWN_LIMITATIONS.md.
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
