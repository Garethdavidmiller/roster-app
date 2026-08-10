/**
 * Tests for fetch-timeout.js — the bound on every Cloud Function call.
 * Run with: node --test fetch-timeout.test.mjs   (no mocks; part of test:hygiene)
 *
 * The cases are chosen around the one thing a bound gets WRONG in practice: mistaking somebody
 * else's abort for its own, and so telling a caller "timed out" when the truth was a cancelled
 * navigation or a network failure. Callers branch on `isFetchTimeout` to decide whether to say a
 * write "may still have gone through", so a misclassification here writes the wrong message onto a
 * screen an admin acts on.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fetchWithTimeout, isFetchTimeout, FETCH_TIMEOUT_CODE, DEFAULT_FETCH_TIMEOUT_MS } from './fetch-timeout.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

/** A fetch that resolves after `ms`, honouring an abort signal the way the platform does. */
function slowFetch(ms, value = { ok: true }) {
    return (_url, opts) => new Promise((resolve, reject) => {
        const t = setTimeout(() => resolve(value), ms);
        opts?.signal?.addEventListener('abort', () => {
            clearTimeout(t);
            const e = new Error('The operation was aborted');
            e.name = 'AbortError';
            reject(e);
        });
    });
}

describe('fetchWithTimeout', () => {
    test('passes the response straight through when the call answers in time', async () => {
        globalThis.fetch = slowFetch(5, { ok: true, status: 200 });
        const r = await fetchWithTimeout('https://example.test', {}, 200);
        assert.equal(r.status, 200);
    });

    test('rejects with the timeout code when the call outlives the budget', async () => {
        globalThis.fetch = slowFetch(500);
        await assert.rejects(
            () => fetchWithTimeout('https://example.test', {}, 30),
            (err) => {
                assert.equal(err.code, FETCH_TIMEOUT_CODE);
                assert.match(err.message, /timed out/i);
                return true;
            });
    });

    test('a NETWORK failure is not reported as a timeout', () => {
        // The distinction the callers' copy depends on: a network error means the request did not
        // land, a timeout means it may have. Collapsing the two would tell an admin to go and check
        // Account status after a failure that never reached the server.
        globalThis.fetch = () => Promise.reject(new TypeError('Failed to fetch'));
        return assert.rejects(
            () => fetchWithTimeout('https://example.test', {}, 1000),
            (err) => {
                assert.ok(!isFetchTimeout(err), 'a network error must not classify as a timeout');
                assert.equal(err.name, 'TypeError');
                return true;
            });
    });

    test("somebody ELSE's abort is not reported as a timeout either", async () => {
        // An abort from a navigation or a caller's own controller arrives as the same AbortError our
        // own bound produces. Only the `timedOut` flag can tell them apart — without it every
        // cancelled request would claim the server might still be working on it.
        globalThis.fetch = (_url, opts) => new Promise((_resolve, reject) => {
            void opts;
            const e = new Error('aborted elsewhere');
            e.name = 'AbortError';
            reject(e);
        });
        await assert.rejects(
            () => fetchWithTimeout('https://example.test', {}, 5000),
            (err) => {
                assert.ok(!isFetchTimeout(err), 'a foreign abort must not classify as our timeout');
                assert.equal(err.message, 'aborted elsewhere');
                return true;
            });
    });

    test('the request is actually aborted, not merely abandoned', async () => {
        // Abandoning would leave the connection open and the server working with nobody listening.
        let sawAbort = false;
        globalThis.fetch = (_url, opts) => new Promise((_resolve, reject) => {
            opts?.signal?.addEventListener('abort', () => {
                sawAbort = true;
                const e = new Error('aborted'); e.name = 'AbortError'; reject(e);
            });
        });
        await assert.rejects(() => fetchWithTimeout('https://example.test', {}, 20));
        assert.ok(sawAbort, 'the signal must reach fetch');
    });

    test('a caller-supplied option survives — the signal is added, nothing is replaced', async () => {
        /** @type {any} */ let seen;
        globalThis.fetch = (_url, opts) => { seen = opts; return Promise.resolve({ ok: true }); };
        await fetchWithTimeout('https://example.test',
            { method: 'POST', headers: { 'X-T': '1' }, body: 'hi' }, 500);
        assert.equal(seen.method, 'POST');
        assert.equal(seen.headers['X-T'], '1');
        assert.equal(seen.body, 'hi');
        assert.ok(seen.signal, 'the abort signal must be attached');
    });

    test('the default budget clears the slowest endpoint ceiling it is used for', () => {
        // 65s against a 60s server ceiling. A default BELOW a server timeout is the failure mode the
        // module header warns about: the client reports a failure the server has not had.
        assert.ok(DEFAULT_FETCH_TIMEOUT_MS >= 60_000);
    });

    test('isFetchTimeout is safe on null/undefined/plain errors', () => {
        assert.equal(isFetchTimeout(null), false);
        assert.equal(isFetchTimeout(undefined), false);
        assert.equal(isFetchTimeout(new Error('nope')), false);
    });
});

describe('no AbortController (very old browser)', () => {
    const realAC = globalThis.AbortController;
    beforeEach(() => { /** @type {any} */ (globalThis).AbortController = undefined; });
    afterEach(()  => { globalThis.AbortController = realAC; });

    test('still makes the call rather than refusing it', async () => {
        // Losing the bound is exactly where these call sites were before this module existed;
        // refusing the request instead would be a regression for those users.
        globalThis.fetch = () => Promise.resolve({ ok: true, status: 200 });
        const r = await fetchWithTimeout('https://example.test', {}, 10);
        assert.equal(r.status, 200);
    });
});
