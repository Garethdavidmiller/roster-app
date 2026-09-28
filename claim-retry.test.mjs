// @ts-check
// Tests for claim-retry.js — the pure stale-claim self-heal runner extracted from firebase-client.js
// (v18.28). No mocks needed; the runner is Firebase-agnostic (deps injected). Part of test:hygiene.
import { test, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isClaimRetryable, runWithClaimRetry, isAccessFailure, abandonOnSignOut, SIGNED_OUT_CODE, saveFailureMessage, signedOutLine, watchIdentityLoss,
    runGatedWrite, hasUnconfirmedWrite, _resetUnconfirmedWrites, UNCONFIRMED_CODE, unconfirmedWriteLine } from './claim-retry.js';

// ── watchIdentityLoss (v24.37; narrowed v24.38) — sign-in offered only when the account is really gone ──
describe('watchIdentityLoss', () => {
    /** Manual timers so "settled for settleMs" is a step the test takes, not a real wait. */
    /** @param {{ lost?: boolean }} [o] */
    function setup({ lost = true } = {}) {
        /** @type {Set<(u: any) => void>} */ const subs = new Set();
        /** @type {Map<number, () => void>} */ const timers = new Map();
        let id = 0, fired = 0;
        const state = { lost };
        watchIdentityLoss({
            uid: 'u1',
            watch: cb => { subs.add(cb); return () => subs.delete(cb); },
            stillLost: () => state.lost,
            onLost: () => { fired++; },
            setTimer: fn => { timers.set(++id, fn); return id; },
            clearTimer: t => { timers.delete(t); },
        });
        return {
            emit: (/** @type {any} */ u) => [...subs].forEach(cb => cb(u)),
            settle: () => { const fns = [...timers.values()]; timers.clear(); fns.forEach(f => f()); },
            state, subs, timers, get fired() { return fired; },
        };
    }
    it('fires once when nobody is signed in and it lasts, then detaches', () => {
        const w = setup();
        w.emit({ uid: 'u1' });
        w.emit(null);
        assert.equal(w.fired, 0, 'not before it has lasted');
        w.settle();
        w.emit(null); w.settle();
        assert.equal(w.fired, 1);
        assert.equal(w.subs.size, 0);
    });
    it('SHARED PC: a colleague signing in from another tab (out, then in as them) is left alone', () => {
        const w = setup();
        w.emit(null);
        w.emit({ uid: 'bob' });
        w.settle();
        assert.equal(w.fired, 0, 'the v24.37 regression signed the colleague out here');
        assert.equal(w.timers.size, 0, 'the pending check was cancelled');
    });
    it('a different account alone is never a loss', () => {
        const w = setup();
        w.emit({ uid: 'bob' });
        w.settle();
        assert.equal(w.fired, 0);
    });
    it('a DELIBERATE sign-out (local session already cleared or changed) shows nothing', () => {
        const w = setup({ lost: false });
        w.emit(null); w.settle();
        assert.equal(w.fired, 0);
    });
    it('no account at the start watches nothing', () => {
        let subscribed = false;
        watchIdentityLoss({ uid: null, watch: () => { subscribed = true; return () => {}; }, stillLost: () => true, onLost: () => {} });
        assert.equal(subscribed, false);
    });
});

test('signedOutLine — says unconfirmed and where to check, never "failed"', () => {
    const line = signedOutLine('this delete', 'Saved Changes');
    assert.equal(line, 'You were signed out before this delete was confirmed. Sign in again, then check Saved Changes.');
    assert.doesNotMatch(line, /fail|lost/i);
});

// ── abandonOnSignOut (v24.36) — a save must not wait on an account that has gone ──────────────────
/** A fake onAuthStateChanged: `emit(user)` drives every live subscriber. */
function fakeAuth() {
    /** @type {Set<(u: any) => void>} */ const subs = new Set();
    return {
        watch: (/** @type {(u: any) => void} */ cb) => { subs.add(cb); return () => subs.delete(cb); },
        emit: (/** @type {any} */ u) => [...subs].forEach(cb => cb(u)),
        get live() { return subs.size; },
    };
}
const never = () => new Promise(() => {});

describe('abandonOnSignOut', () => {
    it('a sign-out while the request is pending rejects with SIGNED_OUT_CODE — the Firestore hang', async () => {
        const a = fakeAuth();
        const p = abandonOnSignOut(never(), { uid: 'u1', watch: a.watch });
        a.emit({ uid: 'u1' });           // the first emission is the current account — not a loss
        a.emit(null);
        await assert.rejects(p, e => /** @type {any} */ (e).code === SIGNED_OUT_CODE);
        assert.equal(a.live, 0, 'the auth listener is detached');
    });
    it('a DIFFERENT account counts as gone too', async () => {
        const a = fakeAuth();
        const p = abandonOnSignOut(never(), { uid: 'u1', watch: a.watch });
        a.emit({ uid: 'u2' });
        await assert.rejects(p, e => /** @type {any} */ (e).code === SIGNED_OUT_CODE);
    });
    it('passes the result and the error through untouched, and detaches', async () => {
        const a = fakeAuth();
        assert.equal(await abandonOnSignOut(Promise.resolve('ok'), { uid: 'u1', watch: a.watch }), 'ok');
        await assert.rejects(abandonOnSignOut(Promise.reject({ code: 'unavailable' }), { uid: 'u1', watch: a.watch }),
            e => /** @type {any} */ (e).code === 'unavailable');
        await new Promise(r => setTimeout(r, 0));
        assert.equal(a.live, 0);
        a.emit(null);                    // a later sign-out reaches nothing
    });
    it('no account at the start → the request is returned unwatched', () => {
        const a = fakeAuth();
        const req = Promise.resolve(1);
        assert.equal(abandonOnSignOut(req, { uid: null, watch: a.watch }), req);
        assert.equal(a.live, 0);
    });
    it('a watcher that reports synchronously on subscribe is handled', async () => {
        const p = abandonOnSignOut(never(), { uid: 'u1', watch: cb => { cb(null); return () => {}; } });
        await assert.rejects(p, e => /** @type {any} */ (e).code === SIGNED_OUT_CODE);
    });
});

// THE WIRING. firebase-client.js cannot load in Node (it imports the SDK from gstatic), so the helper
// above could be perfect and never called: removing it from withClaimRetry left every suite green.
// Every Admin write goes through withClaimRetry, so this is the one line that has to hold.
test('withClaimRetry wraps every request in abandonOnSignOut, watching the live auth state', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('./firebase-client.js', import.meta.url), 'utf8');
    const body = src.slice(src.indexOf('export async function withClaimRetry('), src.indexOf('export const writeWithClaimRetry'));
    assert.match(body, /return abandonOnSignOut\(runWithClaimRetry\(/, 'the retry runs INSIDE the sign-out watch');
    assert.match(body, /uid: auth\.currentUser\?\.uid/, 'the account is captured when the request starts');
    assert.match(body, /onAuthStateChanged\(auth, cb\)/, 'the watch is the real auth state');
});

test('saveFailureMessage — signed-out says unconfirmed, never lost; the other two unchanged', () => {
    const out = saveFailureMessage({ code: SIGNED_OUT_CODE });
    assert.match(out, /signed out/);
    assert.match(out, /Saved Changes/);
    assert.doesNotMatch(out, /lost|not saved/i);
    assert.match(saveFailureMessage({ code: 'permission-denied' }), /sign in again/);
    assert.match(saveFailureMessage({ code: 'unavailable' }), /check your connection/);
    assert.match(saveFailureMessage(undefined), /check your connection/);
});

const PD = 'permission-denied';

test('isClaimRetryable — only the matching code WITH a user', () => {
    assert.equal(isClaimRetryable({ code: PD }, PD, true), true);
    assert.equal(isClaimRetryable({ code: PD }, PD, false), false, 'no user → not retryable');
    assert.equal(isClaimRetryable({ code: 'unavailable' }, PD, true), false, 'wrong code');
    assert.equal(isClaimRetryable(null, PD, true), false, 'no error');
    assert.equal(isClaimRetryable({ code: 'storage/unauthorized' }, 'storage/unauthorized', true), true);
});

test('success on first try — no refresh, no retry, value passes through', async () => {
    let calls = 0, refreshed = 0;
    const out = await runWithClaimRetry(() => { calls++; return Promise.resolve('ok'); }, {
        retryCode: PD, hasUser: () => true, refresh: async () => { refreshed++; },
    });
    assert.equal(out, 'ok');
    assert.equal(calls, 1);
    assert.equal(refreshed, 0);
});

test('permission-denied with a user → refresh once then retry succeeds', async () => {
    let calls = 0, refreshed = 0;
    const out = await runWithClaimRetry(() => {
        calls++;
        if (calls === 1) return Promise.reject({ code: PD });
        return Promise.resolve('healed');
    }, { retryCode: PD, hasUser: () => true, refresh: async () => { refreshed++; } });
    assert.equal(out, 'healed');
    assert.equal(calls, 2, 'ran twice (original + one retry)');
    assert.equal(refreshed, 1, 'refreshed exactly once');
});

test('at most ONE retry — a second permission-denied surfaces to the caller', async () => {
    let calls = 0;
    await assert.rejects(
        runWithClaimRetry(() => { calls++; return Promise.reject({ code: PD }); }, {
            retryCode: PD, hasUser: () => true, refresh: async () => {},
        }),
        (e) => /** @type {any} */ (e).code === PD,
    );
    assert.equal(calls, 2, 'original + one retry, then gives up');
});

test('no user → not retried, original error re-thrown, no refresh', async () => {
    let calls = 0, refreshed = 0;
    await assert.rejects(
        runWithClaimRetry(() => { calls++; return Promise.reject({ code: PD }); }, {
            retryCode: PD, hasUser: () => false, refresh: async () => { refreshed++; },
        }),
        (e) => /** @type {any} */ (e).code === PD,
    );
    assert.equal(calls, 1);
    assert.equal(refreshed, 0);
});

test('non-retryable error re-throws immediately (offline etc.)', async () => {
    let calls = 0, refreshed = 0;
    await assert.rejects(
        runWithClaimRetry(() => { calls++; return Promise.reject({ code: 'unavailable' }); }, {
            retryCode: PD, hasUser: () => true, refresh: async () => { refreshed++; },
        }),
        (e) => /** @type {any} */ (e).code === 'unavailable',
    );
    assert.equal(calls, 1);
    assert.equal(refreshed, 0);
});

test('a FAILED refresh preserves the ORIGINAL permission-denied (never masked by the refresh error)', async () => {
    // The security-critical invariant: a genuine auth denial must not be reported to staff as a
    // connectivity problem just because the token refresh happened to fail.
    let calls = 0;
    await assert.rejects(
        runWithClaimRetry(() => { calls++; return Promise.reject({ code: PD, marker: 'ORIGINAL' }); }, {
            retryCode: PD, hasUser: () => true,
            refresh: async () => { throw { code: 'network-request-failed' }; },
        }),
        (e) => /** @type {any} */ (e).code === PD && /** @type {any} */ (e).marker === 'ORIGINAL',
    );
    assert.equal(calls, 1, 'fn not retried when the refresh itself failed');
});

test('storage/unauthorized path uses the same runner with its own code', async () => {
    let calls = 0;
    const out = await runWithClaimRetry(() => {
        calls++;
        if (calls === 1) return Promise.reject({ code: 'storage/unauthorized' });
        return Promise.resolve('uploaded');
    }, { retryCode: 'storage/unauthorized', hasUser: () => true, refresh: async () => {} });
    assert.equal(out, 'uploaded');
    assert.equal(calls, 2);
});

// ── isAccessFailure ─────────────────────────────────────────────────────────────────────────────
//
// ORGANISED BY WHAT A WRONG ANSWER COSTS, and the two directions are not the same size.
//
// SAYING "NETWORK" TO A REFUSED READER is the expensive one, and it is what shipped: from v23.18,
// when the document collections began requiring a claim, the nav drawer told a member on five pages
// to check a signal that was fine. That is the loop `calendar-access.js` describes — the member
// retries, the retry fails identically, and the app looks broken. Nothing errors and nothing in the
// UI is out of place; the sentence is simply about the wrong thing.
//
// SAYING "SIGN IN AGAIN" TO SOMEBODY OFFLINE is cheaper but not free: it sends a member to re-enter
// a password over a connection that cannot carry the sign-in either, and it teaches them that the
// message is noise. So the classifier must be NARROW — an access refusal is a specific, recognisable
// answer, and everything else keeps the retry.
describe('isAccessFailure', () => {
    describe('a refusal must be recognised — the direction that shipped wrong', () => {
        it('recognises Firestore\'s own permission-denied code', () => {
            assert.equal(isAccessFailure({ code: 'permission-denied' }), true);
        });
        it('recognises the Calendar gate\'s local sentinel, which never reaches Firestore', () => {
            assert.equal(isAccessFailure({ code: 'calendar-access-required' }), true);
        });
        it('recognises a rejection carrying the code in its MESSAGE, not as a code', () => {
            // Not every rejection that reaches a caller is a FirebaseError — a wrapper may have
            // re-thrown, and `fetch-timeout.js` already documents that shape for the endpoints.
            assert.equal(isAccessFailure(new Error('permission-denied')), true);
        });
        it('recognises a denial wrapped in a longer sentence', () => {
            assert.equal(isAccessFailure({ code: 'firestore/permission-denied (read)' }), true);
        });
    });

    describe('a network fault must NOT be dressed as a refusal', () => {
        it('an offline rejection is not an access failure', () => {
            assert.equal(isAccessFailure({ code: 'unavailable' }), false);
        });
        it('the drawer\'s own 8s document timeout is not an access failure', () => {
            // The literal the nav drawer rejects with — pinned here because that timeout and a
            // refusal arrive at the SAME catch, and only one of them may blame the session.
            assert.equal(isAccessFailure(new Error('doc-fetch-timeout')), false);
        });
        it('a deadline-exceeded is not an access failure', () => {
            assert.equal(isAccessFailure({ code: 'deadline-exceeded' }), false);
        });
        it('an unauthenticated code is NOT matched — it is a different answer with different words', () => {
            assert.equal(isAccessFailure({ code: 'unauthenticated' }), false);
        });
    });

    describe('nothing at all is not a refusal', () => {
        for (const empty of [null, undefined, {}, '', 0]) {
            it(`${JSON.stringify(empty)} is not an access failure`, () => {
                assert.equal(isAccessFailure(empty), false);
            });
        }
    });
});

// ── runGatedWrite (v24.39, external review) — an unconfirmed write stops the next ──────────────────
describe('runGatedWrite', () => {
    it('passes results and ordinary errors through, and leaves the gate open', async () => {
        _resetUnconfirmedWrites();
        assert.equal(await runGatedWrite(async () => 'ok'), 'ok');
        await assert.rejects(runGatedWrite(async () => { throw Object.assign(new Error('x'), { code: 'unavailable' }); }));
        assert.equal(hasUnconfirmedWrite(), false, 'a plain failure is not unconfirmed');
    });
    it('a write ended by a sign-out closes the gate; the next is refused BEFORE it runs', async () => {
        _resetUnconfirmedWrites();
        await assert.rejects(runGatedWrite(async () => { throw Object.assign(new Error('gone'), { code: SIGNED_OUT_CODE }); }),
            e => /** @type {any} */ (e).code === SIGNED_OUT_CODE);
        assert.equal(hasUnconfirmedWrite(), true);
        let ran = false;
        await assert.rejects(runGatedWrite(async () => { ran = true; }), e => /** @type {any} */ (e).code === UNCONFIRMED_CODE);
        assert.equal(ran, false, 'a refused write never reaches Firestore — that is the duplicate prevented');
        _resetUnconfirmedWrites();
    });
    it('unconfirmedWriteLine names both codes and leaves others to the caller', () => {
        assert.match(unconfirmedWriteLine({ code: SIGNED_OUT_CODE }, 'this delete', 'Saved Changes') ?? '', /signed out/);
        assert.match(unconfirmedWriteLine({ code: UNCONFIRMED_CODE }, 'x', 'y') ?? '', /Reload the page/);
        assert.equal(unconfirmedWriteLine({ code: 'unavailable' }, 'x', 'y'), null);
    });
});

test('WIRING: every write, the document commit and the push record are bounded by the account', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('./firebase-client.js', import.meta.url), 'utf8');
    assert.match(src, /export function writeWithClaimRetry\(fn\) \{ return runGatedWrite\(\(\) => withClaimRetry\(fn\)\); \}/);
    assert.match(src, /guardCommit: \(\/\*\* @type \{Promise<any>\} \*\/ p\) => abandonOnSignOut\(p,/);
    assert.match(src, /await abandonOnSignOut\(setDoc\(doc\(db, COLLECTIONS\.pushSubscriptions, id\), data\)/);
});
