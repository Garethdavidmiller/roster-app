/**
 * account-lifecycle.test.mjs — the pure rules at the edges of an account's life
 * (functions/account-lifecycle.js, sign-in audit Nov 2026).
 * Run: node scripts/run-tests.mjs account-lifecycle.test.mjs   (part of `npm run test:functions`;
 * it needs nothing installed, since the module requires only the pure roster-parse-helpers.js).
 *
 * Organised by what a wrong answer COSTS. auth-endpoints.test.mjs drives the handlers that ask these
 * rules for real; this pins the rules at their edges, which the handler tests do not reach.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { passwordWriteRefused, unwrittenResetAnswer, elevatedClaimsLost, ELEVATED_CLAIMS, disabledLeaverUids } =
    require('./functions/account-lifecycle.js');
const { CALENDAR_VIEWER_UID } = require('./functions/calendar-viewer-auth.js');
const { computeOrphanLabels } = require('./functions/roster-parse-helpers.js');

// ── A PASSWORD WRITE THAT THROWS (audit E1) ─────────────────────────────────────────────────────
//
// The costs are not symmetrical. Reading an UNKNOWN outcome as a refusal takes the reset stamp off a
// password that may already be the surname default — and an old device then signs itself back in with
// it. Reading a refusal as unknown only leaves a member shown as "Default" until they choose a
// password. So refusals are an allowlist, and everything else is unknown.
describe('passwordWriteRefused — only what proves nothing changed', () => {
    test('the SDK\'s own checks, and the service refusing the password or not finding the account', () => {
        for (const code of ['auth/invalid-password', 'auth/user-not-found', 'auth/argument-error', 'auth/invalid-uid',
            'auth/invalid-display-name', 'auth/invalid-disabled-field', 'auth/invalid-provider-id']) {
            assert.equal(passwordWriteRefused({ code }), true, code);
        }
    });

    test('everything else is UNKNOWN, so the stamp stays', () => {
        // `updateUser` writes and then READS the account back: a refusal of that read — an internal
        // error, a quota, a permission — can arrive after the password changed.
        for (const err of [{ code: 'auth/internal-error' }, { code: 'auth/quota-exceeded' },
            { code: 'auth/insufficient-permission' }, { code: 'auth/id-token-expired' }, { code: 'app/network-error' },
            { code: 'app/network-timeout' }, new Error('socket hang up'), { code: 9 }, {}, null, undefined,
            'auth/invalid-password', { code: 'AUTH/INVALID-PASSWORD' }]) {
            assert.equal(passwordWriteRefused(/** @type {any} */ (err)), false, JSON.stringify(err));
        }
    });
});

describe('unwrittenResetAnswer — the admin is told what is TRUE, in every branch', () => {
    const M = 'A. Member';   // a fixture name, on no roster

    test('refused, and the stamp put back: a refusal that says nothing was changed', () => {
        const a = unwrittenResetAnswer(M, { code: 'auth/invalid-password' }, { restored: true });
        assert.equal(a.status, 409, 'a 4xx, so Operations shows it as a refusal with its reason');
        assert.equal(a.error, 'Firebase refused the new password for A. Member (auth/invalid-password). Nothing was changed.');
    });

    test('a missing account answers the 404 it always did', () => {
        const a = unwrittenResetAnswer(M, { code: 'auth/user-not-found' }, { restored: true });
        assert.equal(a.status, 404);
        assert.equal(a.error, 'No Firebase account for "A. Member" — run Set up accounts first. Nothing was changed.');
    });

    test('refused, but the stamp could not be put back: NEVER "nothing was changed"', () => {
        for (const code of ['auth/invalid-password', 'auth/user-not-found']) {
            const a = unwrittenResetAnswer(M, { code }, { restored: false });
            assert.ok(a.status >= 400 && a.status < 500, `${code}: still a refusal`);
            assert.doesNotMatch(a.error, /Nothing was changed/);
            assert.match(a.error, /Their password did not change, but the reset could not be taken off their record/);
        }
    });

    test('an unknown outcome is a 500 that says so, and says resetting again is safe', () => {
        for (const err of [new Error('timeout'), { code: 'auth/internal-error' }, undefined]) {
            const a = unwrittenResetAnswer(M, err, { restored: false });
            assert.equal(a.status, 500);
            assert.equal(a.error, "It isn't known whether A. Member's password changed: Firebase did not confirm it. Resetting again is safe.");
        }
        assert.equal(unwrittenResetAnswer(M, { code: 'auth/internal-error' }, { restored: true }).status, 500,
            'an unknown outcome is unknown whatever the caller claims about the stamp');
    });

    test('calm and factual: no exclamation marks', () => {
        for (const [err, restored] of [[{ code: 'auth/invalid-password' }, true], [{ code: 'auth/invalid-password' }, false],
            [{ code: 'auth/user-not-found' }, true], [new Error('x'), false]]) {
            assert.doesNotMatch(unwrittenResetAnswer(M, err, { restored }).error, /!/);
        }
    });
});

// ── A TIER TAKEN AWAY (audit D3) ────────────────────────────────────────────────────────────────
//
// Missing a loss leaves a removed admin or manager their tier for up to an hour. Inventing one signs a
// member out of every device for nothing — on every Set up accounts run, for every account it reads —
// so the "nothing lost" cases matter as much as the losses.
describe('elevatedClaimsLost — what a re-stamp takes away', () => {
    const base = { name: 'A. Member', member: 'A. Member' };
    const tier = (/** @type {object} */ extra = {}) => ({ ...base, ...extra });

    test('each elevated claim, taken away, is reported', () => {
        assert.deepEqual(ELEVATED_CLAIMS, ['admin', 'manager', 'linksDesigner']);
        for (const k of ELEVATED_CLAIMS) {
            assert.deepEqual(elevatedClaimsLost(tier({ [k]: true }), tier()), [k], k);
        }
        assert.deepEqual(elevatedClaimsLost(tier({ admin: true, linksDesigner: true }), tier()), ['admin', 'linksDesigner']);
        assert.deepEqual(elevatedClaimsLost(tier({ admin: true }), tier({ manager: true })), ['admin'], 'admin → manager is a loss');
        assert.deepEqual(elevatedClaimsLost({ admin: true }, tier()), ['admin'], 'a hand-set claim counts as held');
    });

    test('the same tier, or a higher one, loses nothing', () => {
        const same = [tier(), tier({ manager: true }), tier({ admin: true, linksDesigner: true })];
        for (const t of same) assert.deepEqual(elevatedClaimsLost(t, { ...t }), [], JSON.stringify(t));
        assert.deepEqual(elevatedClaimsLost(tier(), tier({ manager: true })), [], 'member → manager');
        assert.deepEqual(elevatedClaimsLost(tier(), tier({ admin: true })), [], 'member → admin');
        assert.deepEqual(elevatedClaimsLost(tier({ manager: true }), tier({ admin: true })), [],
            'manager → admin: admin outranks manager, and the two are never stamped together');
        assert.deepEqual(elevatedClaimsLost(tier({ linksDesigner: true }), tier({ manager: true, linksDesigner: true })), []);
    });

    test('an account with nothing before — new, or taken back — loses nothing', () => {
        for (const before of [undefined, null, {}, 'admin']) {
            assert.deepEqual(elevatedClaimsLost(/** @type {any} */ (before), tier()), [], JSON.stringify(before));
        }
    });

    test('only `true` counts as held, as the rules read it', () => {
        assert.deepEqual(elevatedClaimsLost(tier({ admin: 'true', manager: 1, linksDesigner: false }), tier()), []);
        assert.deepEqual(elevatedClaimsLost(tier({ manager: true }), tier({ manager: 'true' })), ['manager'],
            'a stamp the rules would not believe is not the tier kept');
    });
});

// ── LEAVERS ALREADY DISABLED (audit D2) ─────────────────────────────────────────────────────────
//
// Too narrow, and a leaver's phone goes on receiving every broadcast. Too wide is worse: a current
// member's records deleted silences their phone, and the shared PIN account's silences the station.
describe('disabledLeaverUids — the leavers the sweep has already disabled', () => {
    const active = new Set(['a.member@myb-roster.local']);

    test('a disabled roster-domain account off the roster', () => {
        assert.deepEqual(disabledLeaverUids([{ uid: 'u1', email: 'x.gone@myb-roster.local', disabled: true }], active), ['u1']);
    });

    test('never an ENABLED one — that is the sweep\'s own to disable, and it is listed there', () => {
        const users = [{ uid: 'u1', email: 'x.gone@myb-roster.local', disabled: false }, { uid: 'u2', email: 'y.gone@myb-roster.local' }];
        assert.deepEqual(disabledLeaverUids(users, active), []);
    });

    test('never a current member, another domain, an account with no email, or the shared PIN account', () => {
        const users = [
            { uid: 'm', email: 'a.member@myb-roster.local', disabled: true },
            { uid: 'g', email: 'someone@gmail.com', disabled: true },
            { uid: 'n', disabled: true },
            { uid: CALENDAR_VIEWER_UID, email: 'linked@myb-roster.local', disabled: true },
            { uid: 'v', email: 'linked2@myb-roster.local', disabled: true, customClaims: { calendarViewer: true } },
            { email: 'no.uid@myb-roster.local', disabled: true },
        ];
        assert.deepEqual(disabledLeaverUids(users, active), []);
    });

    test('exactly the accounts the sweep would take, were they enabled — one filter, not two', () => {
        const users = [
            { uid: 'a', email: 'x.gone@myb-roster.local', disabled: true },
            { uid: 'b', email: 'a.member@myb-roster.local', disabled: true },
            { uid: CALENDAR_VIEWER_UID, email: 'z@myb-roster.local', disabled: true },
            { uid: 'c', email: 'q@example.com', disabled: true },
        ];
        const sweepWouldTake = computeOrphanLabels(users.map((u) => ({ ...u, disabled: false })), active).map((o) => o.uid);
        assert.deepEqual(disabledLeaverUids(users, active), sweepWouldTake);
    });

    test('an empty or missing list is nothing', () => {
        assert.deepEqual(disabledLeaverUids([], active), []);
        assert.deepEqual(disabledLeaverUids(undefined, active), []);
        assert.deepEqual(disabledLeaverUids([null, undefined], active), []);
    });
});
