// @ts-check
// Tests for claim-retry.js — the pure stale-claim self-heal runner extracted from firebase-client.js
// (v18.28). No mocks needed; the runner is Firebase-agnostic (deps injected). Part of test:hygiene.
import { test, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isClaimRetryable, runWithClaimRetry, isAccessFailure } from './claim-retry.js';

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
