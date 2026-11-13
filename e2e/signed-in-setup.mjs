// @ts-check
/**
 * e2e/signed-in-setup.mjs — the signed-in lane's accounts, made the way production makes them. Run by
 * scripts/signed-in.mjs inside the emulator session, before Playwright starts.
 *
 * Production has one way to create staff accounts: an admin presses Operations → Set up accounts,
 * which calls `setupRosterAuth`, which reads the server-owned roster (functions/roster-members.json)
 * and stamps each account's claims with `claimsForTier`. So that is what runs here — the REAL function,
 * through the Functions emulator. The only account made by hand is the admin who presses the button,
 * exactly as the very first admin had to be made in the console, and even that one is made with the
 * server's own helpers (`nameToEmail`, `nameToPassword`, `claimsForTier`), so no name, email, password
 * or claim shape is re-typed in this lane. A change to any of them reaches these tests unchanged.
 *
 * Idempotent: a second run finds the admin already there and `setupRosterAuth` re-claims every
 * account as it stands, which is its documented behaviour.
 */
import { createRequire } from 'node:module';
import { PROJECT, EMULATOR, REGION } from './signed-in-env.mjs';

export default async function provisionAccounts() {
    process.env.FIREBASE_AUTH_EMULATOR_HOST = EMULATOR.auth;
    process.env.FIRESTORE_EMULATOR_HOST = EMULATOR.firestore;
    // The server's own modules, from the Functions package — the code that runs in production.
    const require = createRequire(new URL('../functions/package.json', import.meta.url));
    const { initializeApp, getApps } = require('firebase-admin/app');
    const { getAuth } = require('firebase-admin/auth');
    const helpers = require('./roster-parse-helpers.js');
    const rosterMembers = require('./roster-members.json');

    if (!getApps().length) initializeApp({ projectId: PROJECT });
    const cfg = helpers.resolveRosterAuthConfig(rosterMembers);
    if (cfg.error) throw new Error(`signed-in setup: the server roster config is broken (${cfg.error})`);

    const adminName = cfg.admin[0];
    const email = helpers.nameToEmail(adminName);
    const password = helpers.nameToPassword(adminName);
    let user;
    try {
        user = await getAuth().createUser({ email, password, displayName: adminName });
    } catch (/** @type {any} */ err) {
        if (err.code !== 'auth/email-already-exists') throw err;
        user = await getAuth().getUserByEmail(email);
    }
    await getAuth().setCustomUserClaims(user.uid, helpers.claimsForTier(adminName, {
        adminSet: new Set(cfg.admin), managerSet: new Set(cfg.manager), designerSet: new Set(cfg.designer),
    }));

    const signIn = await fetch(`http://${EMULATOR.auth}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=e2e`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password, returnSecureToken: true }),
    });
    const { idToken } = await signIn.json();
    if (!idToken) throw new Error(`signed-in setup: the admin could not sign in to the Auth emulator (HTTP ${signIn.status})`);

    const setup = await fetch(`http://${EMULATOR.functions}/${PROJECT}/${REGION}/setupRosterAuth`, {
        method: 'POST',
        headers: { authorization: `Bearer ${idToken}`, 'content-type': 'application/json' },
        body: '{}',
    });
    const result = await setup.json().catch(() => ({}));
    if (!setup.ok || (result.failed && result.failed.length)) {
        throw new Error(`signed-in setup: setupRosterAuth answered HTTP ${setup.status}: ${JSON.stringify(result)}`);
    }
}

/**
 * Put these members' passwords back to their surname default, and their accounts back in use, through
 * the Auth emulator's owner API. A journey that sets a password of its own — or disables an account,
 * as a leaver's is — changes it, and the next test must meet the account as a first-time member
 * would — the sign-in card, the surname, the "set your own" screen — or its result would depend on
 * the order the tests ran in.
 * @param {string[]} names
 */
export async function resetPasswords(names) {
    const require = createRequire(new URL('../functions/package.json', import.meta.url));
    const helpers = require('./roster-parse-helpers.js');
    const base = `http://${EMULATOR.auth}/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts`;
    const owner = { authorization: 'Bearer owner', 'content-type': 'application/json' };
    for (const name of names) {
        const lookup = await fetch(`${base}:lookup`, { method: 'POST', headers: owner, body: JSON.stringify({ email: [helpers.nameToEmail(name)] }) });
        const localId = (await lookup.json()).users?.[0]?.localId;
        if (!localId) throw new Error(`resetPasswords: no account for ${name} — did the setup run?`);
        const update = await fetch(`${base}:update`, { method: 'POST', headers: owner,
            body: JSON.stringify({ localId, password: helpers.nameToPassword(name), disableUser: false }) });
        if (!update.ok) throw new Error(`resetPasswords: could not reset ${name}: HTTP ${update.status}`);
    }
}

/**
 * Disable a member's account the way the leaver sweep does — `updateUser(uid, { disabled: true })`
 * through the Admin SDK, the server's own package, here against the Auth emulator. The beforeEach puts
 * it back in use (`resetPasswords`).
 * @param {string} name
 */
export async function disableAccount(name) {
    process.env.FIREBASE_AUTH_EMULATOR_HOST = EMULATOR.auth;
    const require = createRequire(new URL('../functions/package.json', import.meta.url));
    const { initializeApp, getApps } = require('firebase-admin/app');
    const { getAuth } = require('firebase-admin/auth');
    const helpers = require('./roster-parse-helpers.js');
    if (!getApps().length) initializeApp({ projectId: PROJECT });
    const user = await getAuth().getUserByEmail(helpers.nameToEmail(name));
    await getAuth().updateUser(user.uid, { disabled: true });
}
