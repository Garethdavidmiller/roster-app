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

// ── withTimeout — the guard that turns a HANG into a recoverable failure ────────────────────────
// Extracted the same way (source read + eval) so these assertions run against the real code. This
// helper is why a dead-air connection no longer strands the mandatory overlay on "Saving…", and
// since v18.95 the Settings Password card depends on it too, so it is worth pinning down.
const twMatch = /export function withTimeout\(([\s\S]*?)\n}/.exec(SRC);
assert.ok(twMatch, 'withTimeout not found in password-force.js — has it been renamed?');
const withTimeout = new Function(`return function withTimeout(${twMatch[1]}\n}`)();

describe('withTimeout', () => {
    test('passes a value through when the promise settles in time', async () => {
        assert.equal(await withTimeout(Promise.resolve('ok'), 1000), 'ok');
    });

    test('preserves the original rejection rather than masking it as a timeout', async () => {
        const original = Object.assign(new Error('nope'), { code: 'auth/invalid-credential' });
        await assert.rejects(withTimeout(Promise.reject(original), 1000),
                             (/** @type {any} */ e) => e === original);
    });

    // THE point of the helper: a promise that never settles must become a rejection, because the
    // caller's catch/finally are the only things that re-enable the button and reveal the escape.
    test('rejects a never-settling promise with the myb/timeout code', async () => {
        await assert.rejects(withTimeout(new Promise(() => {}), 20),
                             (/** @type {any} */ e) => e.code === 'myb/timeout');
    });

    // Without the clearTimeout, a fast success still leaves a pending timer holding the event loop
    // open — which in a browser is a leak per attempt, and here would hang the test runner.
    test('clears its timer on success so nothing is left pending', async () => {
        await withTimeout(Promise.resolve(1), 60_000);   // would stall exit if the timer survived
    });
});

// ── settleOrTimeout — a slow write is NOT a failed write ────────────────────────────────────────
// The defect this closes (external review, v18.96): Promise.race stops WAITING but does not CANCEL,
// so `updatePassword` could land a second after the UI had announced failure. The member then
// believes their old password still works — during a COMPULSORY migration, which is a lockout.
// The old withTimeout tests proved a hang becomes myb/timeout; none covered a promise that settles
// AFTER the deadline, which is precisely the dangerous case.
const soMatch = /export function settleOrTimeout\(([\s\S]*?)\n}/.exec(SRC);
assert.ok(soMatch, 'settleOrTimeout not found in password-force.js — has it been renamed?');
const settleOrTimeout = new Function(`return function settleOrTimeout(${soMatch[1]}\n}`)();

/** A promise that settles when we say so. */
function deferred() {
    /** @type {any} */ let resolve; /** @type {any} */ let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

describe('settleOrTimeout', () => {
    test('reports success when the operation finishes in time', async () => {
        const r = await settleOrTimeout(Promise.resolve('done'), 1000);
        assert.deepEqual(r, { status: 'ok', value: 'done' });
    });

    test('reports a definite failure, preserving the original error', async () => {
        const original = Object.assign(new Error('nope'), { code: 'auth/weak-password' });
        const r = await settleOrTimeout(Promise.reject(original), 1000);
        assert.equal(r.status, 'failed');
        assert.equal(r.error, original);
    });

    // The distinction the whole fix rests on: 'pending' is NOT 'failed'.
    test('reports PENDING — never failed — when the deadline passes first', async () => {
        const d = deferred();
        const r = await settleOrTimeout(d.promise, 10);
        assert.equal(r.status, 'pending');
        assert.notEqual(r.status, 'failed');
        assert.ok(typeof r.settled?.then === 'function', 'must hand back a handle on the real outcome');
        d.resolve('late');   // tidy up
    });

    test('a LATE SUCCESS is observable through the returned handle', async () => {
        const d = deferred();
        const r = await settleOrTimeout(d.promise, 10);
        assert.equal(r.status, 'pending');
        d.resolve({ statusRecorded: true });
        assert.deepEqual(await r.settled, { status: 'ok', value: { statusRecorded: true } });
    });

    test('a LATE FAILURE is observable, with the real error, so a retry can be offered', async () => {
        const d = deferred();
        const r = await settleOrTimeout(d.promise, 10);
        const original = Object.assign(new Error('server said no'), { code: 'auth/network-request-failed' });
        d.reject(original);
        const late = await r.settled;
        assert.equal(late.status, 'failed');
        assert.equal(late.error, original);
    });

    // A late rejection nobody is listening for must not become an unhandled rejection and take the
    // page down — the tracked promise absorbs it at creation, before the race is even run.
    test('a late rejection the caller ignores does not become an unhandled rejection', async () => {
        const seen = [];
        const onUnhandled = (/** @type {any} */ e) => seen.push(e);
        process.on('unhandledRejection', onUnhandled);
        try {
            const d = deferred();
            const r = await settleOrTimeout(d.promise, 10);
            assert.equal(r.status, 'pending');
            d.reject(new Error('ignored'));           // caller never awaits r.settled
            await new Promise(res => setTimeout(res, 50));
            assert.deepEqual(seen, [], 'a late rejection must be absorbed, not thrown globally');
        } finally {
            process.off('unhandledRejection', onUnhandled);
        }
    });

    test('clears its timer on a fast settle so nothing is left pending', async () => {
        await settleOrTimeout(Promise.resolve(1), 60_000);   // would stall exit if the timer survived
    });
});
