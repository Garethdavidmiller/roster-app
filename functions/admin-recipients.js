'use strict';

/**
 * functions/admin-recipients.js — WHO a notice meant for the admin may go to. One rule, every sender.
 *
 * Three notices are addressed to the admin and to nobody else: the reset-request doorbell
 * (./reset-request.js), the Error Log notice (./error-log-notify.js) and the staff-PIN lockout notice
 * (./pin-lockout.js). Each starts from the admin NAMES in roster-members.json `roles.admin` and has to
 * turn them into accounts. Until Nov 2026 two of them did it two ways: the Error Log asked that the
 * account be enabled and carry the `admin` claim, and the doorbell took whatever account held the
 * admin's derived address. That is the same question answered strictly in one place and loosely in
 * the other, and the loose answer is the one that names a locked-out colleague on a lock screen.
 *
 * ── THE RULE ─────────────────────────────────────────────────────────────────────────────────────
 *
 * An admin name's own account (the address `nameToEmail` derives), ENABLED, carrying `admin === true`
 * strictly. Anything else is dropped with a warning, never replaced:
 *   · no account, or a lookup that failed → dropped: an unresolvable admin must not become "everyone";
 *   · disabled → dropped: a disabled account's devices are not the admin's any more;
 *   · no `admin` claim → dropped: an account Set up accounts has not made an admin (registered from
 *     outside, or never stamped) is not the admin, whatever address it sits at.
 * An empty answer sends nothing — `sendTargetedPush` never widens, and neither does this.
 *
 * `firebase-admin/auth` is required at CALL time, not at load, so a test that stands a fresh fake in
 * `require.cache` for each case is the one this function asks (error-log-notify.test.mjs does).
 */

const { nameToEmail } = require('./roster-parse-helpers');

/**
 * The accounts an admin notice may go to: each admin name's own account, enabled, with the `admin` claim.
 * @param {string[]|undefined} names  roster-members.json roles.admin
 * @param {string} logTag  the sender's log prefix, e.g. '[errorLog]'
 * @returns {Promise<string[]>} uids, in the order of `names`; never anyone not named
 */
async function enabledAdminUids(names, logTag) {
    const { getAuth } = require('firebase-admin/auth');
    const uids = [];
    for (const name of names || []) {
        try {
            const user = await getAuth().getUserByEmail(nameToEmail(name));
            if (user && user.uid && !user.disabled && user.customClaims && user.customClaims.admin === true) uids.push(user.uid);
            else console.warn(`${logTag} not an enabled admin account, so not told:`, name);
        } catch (e) {
            console.warn(`${logTag} could not resolve the admin account for`, name, e && e.code);
        }
    }
    return uids;
}

module.exports = { enabledAdminUids };
