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
import { fetchWithTimeout, isFetchTimeout, isFetchAborted, FETCH_TIMEOUT_CODE, FETCH_ABORTED_CODE, DEFAULT_FETCH_TIMEOUT_MS } from './fetch-timeout.js';

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

describe('caller-supplied signal (v20.56)', () => {
    // Before v20.56 `{...options, signal: ctrl.signal}` silently DROPPED a caller's signal, so this
    // whole category could not happen — and the "foreign abort" test above was guarding a case no
    // call site could produce. Now a caller can genuinely cancel, and the copy that follows differs:
    // a timeout says "may still have gone through", a cancellation says nothing alarming at all.

    test("the caller's signal actually reaches fetch and can cancel the request", async () => {
        const caller = new AbortController();
        globalThis.fetch = slowFetch(1000);
        const p = fetchWithTimeout('https://example.test', { signal: caller.signal }, 5000);
        caller.abort();
        await assert.rejects(p, (err) => {
            assert.ok(isFetchAborted(err), 'a caller cancellation must classify as aborted');
            assert.ok(!isFetchTimeout(err), 'and must NOT classify as our timeout');
            assert.equal(err.code, FETCH_ABORTED_CODE);
            return true;
        });
    });

    test('an already-aborted signal never opens the connection', async () => {
        const caller = new AbortController();
        caller.abort();
        let called = false;
        globalThis.fetch = () => { called = true; return Promise.resolve({ ok: true }); };
        await assert.rejects(
            () => fetchWithTimeout('https://example.test', { signal: caller.signal }, 5000),
            (err) => isFetchAborted(err));
        assert.equal(called, false, 'fetch must not run for an already-cancelled request');
    });

    test('OUR timeout still classifies as a timeout even when a caller signal is present', async () => {
        // The regression this guards: wiring the caller signal in such a way that every abort looks
        // like the caller's, which would silence exactly the message a write depends on.
        const caller = new AbortController();
        globalThis.fetch = slowFetch(1000);
        await assert.rejects(
            () => fetchWithTimeout('https://example.test', { signal: caller.signal }, 20),
            (err) => {
                assert.ok(isFetchTimeout(err), 'our bound must still win when it is the one that fired');
                assert.ok(!isFetchAborted(err));
                return true;
            });
    });

    test('when BOTH fire, the timeout wins — "go and check" is the safe direction', async () => {
        // The reader must be told the write may have landed; being told "cancelled" would let a
        // committed submission go unchecked.
        //
        // Two timers racing does NOT test this — whichever callback lands first, the catch block
        // usually observes only one condition, so the precedence is never exercised (an earlier
        // version of this test passed against a build with the checks in the WRONG order). So the
        // stub aborts the caller signal from inside its own abort handler: by the time our catch
        // runs, `timedOut` and `callerSignal.aborted` are both true, deterministically.
        const caller = new AbortController();
        globalThis.fetch = (_url, opts) => new Promise((_resolve, reject) => {
            opts?.signal?.addEventListener('abort', () => {
                caller.abort();
                const e = new Error('aborted'); e.name = 'AbortError'; reject(e);
            });
        });
        await assert.rejects(
            () => fetchWithTimeout('https://example.test', { signal: caller.signal }, 15),
            (err) => {
                assert.ok(isFetchTimeout(err), 'the timeout classification must take precedence');
                assert.ok(!isFetchAborted(err));
                return true;
            });
    });

    test('a network failure with a caller signal present is still neither', async () => {
        const caller = new AbortController();
        globalThis.fetch = () => Promise.reject(new TypeError('Failed to fetch'));
        await assert.rejects(
            () => fetchWithTimeout('https://example.test', { signal: caller.signal }, 1000),
            (err) => {
                assert.ok(!isFetchTimeout(err));
                assert.ok(!isFetchAborted(err), 'an untouched signal must not make a network error look cancelled');
                return true;
            });
    });

    test('the abort listener is removed on success, so a later caller abort is inert', async () => {
        // A retained listener on a long-lived caller signal leaks one closure per request, and worse,
        // aborts a controller belonging to a request that already finished.
        const caller = new AbortController();
        let removed = false;
        const realRemove = caller.signal.removeEventListener.bind(caller.signal);
        caller.signal.removeEventListener = (...args) => { removed = true; return realRemove(...args); };
        globalThis.fetch = () => Promise.resolve({ ok: true, status: 200 });
        const r = await fetchWithTimeout('https://example.test', { signal: caller.signal }, 500);
        assert.equal(r.status, 200);
        assert.ok(removed, 'the caller-abort listener must be detached once the call settles');
    });

    test('isFetchAborted is safe on null/undefined/plain errors', () => {
        assert.equal(isFetchAborted(null), false);
        assert.equal(isFetchAborted(undefined), false);
        assert.equal(isFetchAborted(new Error('nope')), false);
        assert.equal(isFetchAborted({ code: FETCH_TIMEOUT_CODE }), false);
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
