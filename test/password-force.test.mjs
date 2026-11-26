// @lane unit
/**
 * Unit tests for the PURE gate in password-force.js — `shouldForcePasswordSet` — and for the save sequence and
 * deadline helpers it shares with Settings (`runPasswordSave`, `withTimeout`, `settleOrTimeout`, own-password.js).
 *
 * Run: node --experimental-test-module-mocks scripts/run-tests.mjs test/password-force.test.mjs
 *
 * WHY THIS IS THE PART WORTH TESTING. The overlay itself is DOM wiring; the gate is where a mistake
 * has consequences. Each of its four conditions prevents a specific failure that is either invisible
 * or unrecoverable:
 *   · `flagOn`     — the kill switch. If it leaked, turning the feature off wouldn't turn it off.
 *   · `occasion`   — a confirmed sign-in or an ordinary open, and nothing else. Without it a member is ambushed
 *                    mid-task on an ordinary page load (the v14.77 "Fix 4" defect).
 *   · `authStatus` — must be exactly 'named'. An anonymous (calendar) or soft-failed (paycalc)
 *                    identity cannot call updatePassword, so showing a HARD BLOCK to one traps the
 *                    member with no way through. This is the lockout case.
 *   · `!migrated`  — nothing to compel once they've set their own password.
 *
 * Importing password-force.js pulls in firebase-client.js (and so the gstatic SDK) and overlay.js (which
 * needs a browser `window`), so those two modules are replaced with inert stand-ins and the REAL password-force.js is imported and its exported gate called.
 * The gate reads neither; they exist only so the module links. Until 25 Nov 2026 the gate was cut
 * out of the source text by a regex and run through `new Function` — a copy, which broke whenever the
 * function moved or gained a line the regex did not expect.
 */
import { test, describe, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { withTimeout, settleOrTimeout, runPasswordSave, SAVE_TIMEOUT_MS } from '../own-password.js';

// Tests live in test/ but address files from the repository root (moved 24 Nov 2026).
const REPO_ROOT_URL = new URL('../', import.meta.url);

// The SDK is unreachable in Node, and overlay.js needs a browser `window` to load; the gate reads neither.
const sdkCall = () => { throw new Error('the gate under test called the Firebase client'); };
mock.module('../firebase-client.js', { namedExports: {
    getPasswordStatus: sdkCall, changeOwnPassword: sdkCall, reauthenticateWithPassword: sdkCall,
} });
// overlay.js wires a `window` listener when it loads; the gate locks no scroll.
mock.module('../overlay.js', { namedExports: { lockBodyScroll() {}, unlockBodyScroll() {} } });
const PASSWORD_FORCE = await import('../password-force.js');
const { shouldForcePasswordSet } = PASSWORD_FORCE;

/** The state of a member who SHOULD be compelled — each test varies one field from this. */
const COMPEL = /** @type {const} */ ({ flagOn: true, occasion: 'sign-in', authStatus: 'named', migrated: false });

describe('shouldForcePasswordSet', () => {
    test('compels a named, un-migrated member who just signed in', () => {
        assert.equal(shouldForcePasswordSet(COMPEL), true);
    });

    test('the kill switch wins over everything', () => {
        assert.equal(shouldForcePasswordSet({ ...COMPEL, flagOn: false }), false);
    });

    test('an ordinary open compels too — the installed app no longer signs anyone out (owner, 26 Nov 2026)', () => {
        assert.equal(shouldForcePasswordSet({ ...COMPEL, occasion: 'open' }), true);
    });

    test('never without an occasion — a sign-in or an open, nothing else', () => {
        for (const occasion of [null, undefined, 'mid-task', '']) {
            assert.equal(shouldForcePasswordSet({ ...COMPEL, occasion: /** @type {any} */ (occasion) }), false, String(occasion));
        }
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
// This helper is why a dead-air connection no longer strands the mandatory overlay on "Saving…", and
// since v18.95 the Settings Password card depends on it too, so it is worth pinning down.
// Both helpers moved to own-password.js with the save sequence (settings review, Nov 2026), which loads
// in plain Node, so they are IMPORTED now rather than extracted — and password-force.js must still
// re-export them, because the sign-in card imports `withTimeout` from there.
test('password-force.js still re-exports the two deadline helpers the sign-in card reads', () => {
    // Asked of the loaded module, so it is the very function the sign-in card gets, not a line of text.
    assert.equal(PASSWORD_FORCE.withTimeout, withTimeout);
    assert.equal(PASSWORD_FORCE.settleOrTimeout, settleOrTimeout);
});
/**
 * Run `fn` with setTimeout/clearTimeout spied (the extracted helpers resolve both from globalThis
 * at call time), and report which timers were armed and which were cleared.
 * @param {() => Promise<any>} fn
 */
async function spyTimers(fn) {
    const realSet = globalThis.setTimeout, realClear = globalThis.clearTimeout;
    /** @type {any[]} */ const handles = [];
    /** @type {any[]} */ const cleared = [];
    globalThis.setTimeout = /** @type {any} */ ((/** @type {any[]} */ ...a) => { const h = realSet(...a); handles.push(h); return h; });
    globalThis.clearTimeout = /** @type {any} */ ((/** @type {any} */ h) => { cleared.push(h); realClear(h); });
    try { await fn(); } finally {
        globalThis.setTimeout = realSet;
        globalThis.clearTimeout = realClear;
        for (const h of handles) realClear(h);   // never leave a 60s timer behind, pass or fail
    }
    return { handles, cleared: cleared.filter(h => handles.includes(h)) };
}

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

    // Without the clearTimeout, a fast success still leaves a pending timer — a leak per attempt in
    // a browser. This used to assert it by "would stall the runner", which cannot fail: node --test
    // exits with the timer still pending (v24.28 review, mutation-verified). So spy on the timer.
    test('clears its timer on success so nothing is left pending', async () => {
        const { cleared, handles } = await spyTimers(() => withTimeout(Promise.resolve(1), 60_000));
        assert.equal(handles.length, 1, 'expected exactly one deadline timer');
        assert.deepEqual(cleared, handles, 'the deadline timer must be cleared once the promise settles');
    });
});

// ── settleOrTimeout — a slow write is NOT a failed write ────────────────────────────────────────
// The defect this closes (external review, v18.96): Promise.race stops WAITING but does not CANCEL,
// so `updatePassword` could land a second after the UI had announced failure. The member then
// believes their old password still works — during a COMPULSORY migration, which is a lockout.
// The old withTimeout tests proved a hang becomes myb/timeout; none covered a promise that settles
// AFTER the deadline, which is precisely the dangerous case.

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
        const { cleared, handles } = await spyTimers(() => settleOrTimeout(Promise.resolve(1), 60_000));
        assert.equal(handles.length, 1, 'expected exactly one deadline timer');
        assert.deepEqual(cleared, handles, 'the deadline timer must be cleared once the promise settles');
    });
});

// ── runPasswordSave — the ONE save sequence behind both password surfaces (settings review, Nov 2026) ──
// Settings' card and the forced change each wrote it out, with the deadline declared twice. What a
// caller relies on: the stage a failure came from, a slow write reported as PENDING (never failed),
// the re-auth skipped when the forced change has no current password, and the write COUNTED while it
// runs — Settings did not count it, so neither the update reload nor a sign-out could see it.
describe('runPasswordSave', () => {
    /** A recording harness: what was called, with what, and how often `track` was handed a promise. */
    function harness({ reauth = async () => {}, change = async () => ({ stamp: Promise.resolve(true) }) } = {}) {
        /** @type {any[]} */ const calls = [];
        /** @type {Promise<any>[]} */ const tracked = [];
        return {
            calls, tracked,
            deps: {
                reauthenticate: (/** @type {string} */ m, /** @type {string} */ t) => { calls.push(['reauth', m, t]); return reauth(); },
                change: (/** @type {string} */ m, /** @type {string} */ n) => { calls.push(['change', m, n]); return change(); },
                track: /** @type {any} */ ((/** @type {Promise<any>} */ p) => { tracked.push(p); return p; }),
            },
        };
    }

    test('re-authenticates with the typed password, then changes it, and reports ok with the change\'s value', async () => {
        const h = harness();
        const r = await runPasswordSave({ member: 'G. Miller', current: 'miller', next: 'new-pass-9', ...h.deps });
        assert.equal(r.status, 'ok');
        assert.deepEqual(h.calls, [['reauth', 'G. Miller', 'miller'], ['change', 'G. Miller', 'new-pass-9']]);
        assert.ok(/** @type {any} */ (r).value?.stamp, 'the stamp handle reaches the caller');
    });

    test('the WRITE is counted while it runs — the promise the change returned, not a copy', async () => {
        /** @type {any} */ let release;
        const change = () => new Promise(r => { release = r; });
        const h = harness({ change });
        const p = runPasswordSave({ member: 'G. Miller', current: 'miller', next: 'new-pass-9', ...h.deps, ms: 1000 });
        await new Promise(r => setImmediate(r));
        assert.equal(h.tracked.length, 1, 'the change was never handed to `track`, so writesInFlight cannot see it');
        release({ stamp: Promise.resolve(true) });
        assert.equal((await p).status, 'ok');
    });

    test('no current password (the forced change straight after a sign-in) skips the re-auth', async () => {
        const h = harness();
        const r = await runPasswordSave({ member: 'G. Miller', current: null, next: 'new-pass-9', ...h.deps });
        assert.equal(r.status, 'ok');
        assert.deepEqual(h.calls.map(c => c[0]), ['change']);
    });

    test('a refused re-auth is a failure of the FIRST stage, and nothing is changed', async () => {
        const err = Object.assign(new Error('no'), { code: 'auth/invalid-credential' });
        const h = harness({ reauth: async () => { throw err; } });
        const r = /** @type {any} */ (await runPasswordSave({ member: 'G. Miller', current: 'wrong', next: 'new-pass-9', ...h.deps }));
        assert.deepEqual([r.status, r.error, r.reauthed], ['failed', err, false]);
        assert.deepEqual(h.calls.map(c => c[0]), ['reauth'], 'the password was changed behind a refused re-auth');
    });

    test('a write refused AFTER the re-auth says so — it must never read as a wrong current password', async () => {
        const err = Object.assign(new Error('no'), { code: 'auth/internal-error' });
        const h = harness({ change: async () => { throw err; } });
        const r = /** @type {any} */ (await runPasswordSave({ member: 'G. Miller', current: 'miller', next: 'new-pass-9', ...h.deps }));
        assert.deepEqual([r.status, r.error, r.reauthed], ['failed', err, true]);
    });

    test('a re-auth that HANGS becomes a timed-out failure — it changed nothing, so that is true', async () => {
        const h = harness({ reauth: () => new Promise(() => {}) });
        const r = /** @type {any} */ (await runPasswordSave({ member: 'G. Miller', current: 'miller', next: 'new-pass-9', ...h.deps, ms: 20 }));
        assert.deepEqual([r.status, r.error?.code, r.reauthed], ['failed', 'myb/timeout', false]);
    });

    test('a write that passes its deadline is PENDING, and its late outcome is handed back', async () => {
        /** @type {any} */ let release;
        const h = harness({ change: () => new Promise(r => { release = r; }) });
        const r = /** @type {any} */ (await runPasswordSave({ member: 'G. Miller', current: 'miller', next: 'new-pass-9', ...h.deps, ms: 20 }));
        assert.equal(r.status, 'pending', 'a slow write was reported as failed — the member would retry a password that has changed');
        release({ stamp: Promise.resolve(true) });
        assert.equal((await r.settled).status, 'ok');
    });

    test('one deadline for both surfaces, and it is the sign-in\'s 8 seconds', () => {
        assert.equal(SAVE_TIMEOUT_MS, 8000);
        for (const f of ['password-force.js', 'settings-password-card.js']) {
            assert.doesNotMatch(readFileSync(new URL(`./${f}`, REPO_ROOT_URL), 'utf8'), /SAVE_TIMEOUT_MS\s*=/, `${f} declares its own deadline again`);
        }
    });
});
