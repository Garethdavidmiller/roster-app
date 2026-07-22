// @ts-check
// Tests for claim-retry.js — the pure stale-claim self-heal runner extracted from firebase-client.js
// (v18.28). No mocks needed; the runner is Firebase-agnostic (deps injected). Part of test:hygiene.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isClaimRetryable, runWithClaimRetry } from './claim-retry.js';

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
