/**
 * Unit tests for the PURE gate in password-force.js — `shouldForcePasswordSet`.
 *
 * Run: node --test password-force.test.mjs   (no mocks — the gate takes plain values)
 *
 * WHY THIS IS THE PART WORTH TESTING. The overlay itself is DOM wiring; the gate is where a mistake
 * has consequences. Each of its four conditions prevents a specific failure that is either invisible
 * or unrecoverable:
 *   · `flagOn`     — the kill switch. If it leaked, turning the feature off wouldn't turn it off.
 *   · `hasMarker`  — restricts the overlay to real sign-ins. Without it a member is ambushed
 *                    mid-task on an ordinary page load (the v14.77 "Fix 4" defect).
 *   · `authStatus` — must be exactly 'named'. An anonymous (calendar) or soft-failed (paycalc)
 *                    identity cannot call updatePassword, so showing a HARD BLOCK to one traps the
 *                    member with no way through. This is the lockout case.
 *   · `!migrated`  — nothing to compel once they've set their own password.
 *
 * Importing password-force.js pulls in firebase-client.js (and so the gstatic SDK) — which is exactly
 * why the gate is exported separately from the module's DOM/Firebase work. This test imports it
 * through a source read + eval of the one function, the sw-internals.test.mjs technique, so it runs
 * in plain Node with no mocks and still asserts the REAL code rather than a copy.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Extract the real function from source and evaluate it standalone. Throws loudly if it is renamed
// or reshaped, so this can never silently drift into testing nothing.
const SRC = readFileSync(new URL('./password-force.js', import.meta.url), 'utf8');
const match = /export function shouldForcePasswordSet\(([\s\S]*?)\n}/.exec(SRC);
assert.ok(match, 'shouldForcePasswordSet not found in password-force.js — has it been renamed?');
const shouldForcePasswordSet = new Function(`return function shouldForcePasswordSet(${match[1]}\n}`)();

/** The state of a member who SHOULD be compelled — each test varies one field from this. */
const COMPEL = { flagOn: true, hasMarker: true, authStatus: 'named', migrated: false };

describe('shouldForcePasswordSet', () => {
    test('compels a named, un-migrated member who just signed in', () => {
        assert.equal(shouldForcePasswordSet(COMPEL), true);
    });

    test('the kill switch wins over everything', () => {
        assert.equal(shouldForcePasswordSet({ ...COMPEL, flagOn: false }), false);
    });

    test('never without the one-shot sign-in marker (no mid-task ambush)', () => {
        assert.equal(shouldForcePasswordSet({ ...COMPEL, hasMarker: false }), false);
    });

    test('never for an already-migrated member', () => {
        assert.equal(shouldForcePasswordSet({ ...COMPEL, migrated: true }), false);
    });

    // THE lockout guard. 'named' is the only status where updatePassword can succeed, so it is the
    // only status where a hard block is satisfiable. Asserted over every status the machine can be
    // in (auth-state-core.js AUTH_STATUSES) rather than a couple of examples, so a new status added
    // to the state machine defaults to NOT compelling instead of silently trapping people.
    test('ONLY a named identity is ever compelled — every other status is skipped', () => {
        for (const status of ['initialising', 'resolving', 'anonymous', 'signedOut', 'degraded', 'error']) {
            assert.equal(shouldForcePasswordSet({ ...COMPEL, authStatus: status }), false,
                `${status} must not be compelled — updatePassword cannot succeed, so the block would be unsatisfiable`);
        }
        assert.equal(shouldForcePasswordSet({ ...COMPEL, authStatus: 'named' }), true);
    });

    test('a bogus/absent status is not compelled (fails closed)', () => {
        for (const status of ['NAMED', 'Named', '', undefined, null]) {
            assert.equal(shouldForcePasswordSet({ ...COMPEL, authStatus: /** @type {any} */ (status) }), false);
        }
    });
});
