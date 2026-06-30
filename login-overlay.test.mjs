/**
 * Unit tests for the login-overlay.js sign-in CORE: runNamedSignIn().
 * Run with: node --experimental-test-module-mocks --test login-overlay.test.mjs
 *
 * WHY THIS EXISTS: the suite covered session helpers and overlay presence, but NOT the sign-in
 * click path — which is exactly where the v14.72–75 login-freeze regressions lived (local session
 * saved before auth completed; no timeout on the auth step). See LOGIN_INCIDENT.md.
 *
 * login-overlay.js imports session.js (→ firebase-client → CDN), ls.js and overlay.js (DOM/window),
 * so those are mocked just enough for the module to import in Node. The logic under test
 * (runNamedSignIn) is DOM-free and takes ALL its dependencies as arguments, so the tests drive it
 * directly with recording stubs — no fake DOM, no real Firebase.
 *
 * NOT covered here (deliberate): the email-check trigger marker ("Fix 4" in the review) was deferred
 * and is not implemented, and the DOM wiring of attempt() (reading form values, button text). The
 * load-bearing contract — "commit the local session ONLY after auth genuinely resolves, time-boxed"
 * — lives entirely in runNamedSignIn and is fully exercised below.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';

// These only need to exist so login-overlay.js imports cleanly; runNamedSignIn never touches them.
mock.module('./session.js', { namedExports: {
    getSurname: () => '', saveSession: () => {}, clearSession: () => {},
    ensureNamedSession: async () => true, isTransientAuthError: () => false, getFirebaseAuthError: () => null,
} });
mock.module('./ls.js', { namedExports: { lsGet: () => null, lsSet: () => {}, lsDel: () => {} } });
mock.module('./overlay.js', { namedExports: { lockBodyScroll: () => {}, unlockBodyScroll: () => {}, trapFocus: () => {} } });

const { runNamedSignIn } = await import('./login-overlay.js');

/** Build a deps object with call-recording session helpers and sensible defaults (enforce ON). */
function makeDeps(over = {}) {
    const calls = { save: 0, clear: 0 };
    const deps = {
        enforce:            true,
        ensureNamedSession: async () => true,
        saveSession:        () => { calls.save++; },
        clearSession:       () => { calls.clear++; },
        getAuthError:       () => null,
        isTransient:        () => false,
        timeoutMs:          8000,
        ...over,
    };
    return { deps, calls };
}

describe('runNamedSignIn — local session committed ONLY after auth resolves', () => {
    test('success (named resolves true) → saves session, ok:true, never clears', async () => {
        const { deps, calls } = makeDeps({ ensureNamedSession: async () => true });
        const r = await runNamedSignIn(deps);
        assert.deepEqual(r, { ok: true });
        assert.equal(calls.save, 1);
        assert.equal(calls.clear, 0);
    });

    test('enforce ON + named false → NO save, clears, ok:false with provisioning message', async () => {
        const { deps, calls } = makeDeps({ ensureNamedSession: async () => false });
        const r = await runNamedSignIn(deps);
        assert.equal(r.ok, false);
        assert.match(/** @type {string} */ (r.error), /Ask your manager to set up your account/);
        assert.equal(calls.save, 0);
        assert.equal(calls.clear, 1);
    });

    test('enforce ON + named false + TRANSIENT error → connection message', async () => {
        const { deps } = makeDeps({
            ensureNamedSession: async () => false,
            getAuthError: () => 'network-request-failed',
            isTransient: () => true,
        });
        const r = await runNamedSignIn(deps);
        assert.equal(r.ok, false);
        assert.match(/** @type {string} */ (r.error), /reach sign-in — check your connection/);
    });

    test('enforce OFF never blocks on named → saves + ok even when named is false', async () => {
        const { deps, calls } = makeDeps({ enforce: false, ensureNamedSession: async () => false });
        const r = await runNamedSignIn(deps);
        assert.deepEqual(r, { ok: true });
        assert.equal(calls.save, 1);
        assert.equal(calls.clear, 0);
    });

    test('auth TIMEOUT (never resolves) → NO save, clears, ok:false (the core freeze fix)', async () => {
        const { deps, calls } = makeDeps({ ensureNamedSession: () => new Promise(() => {}), timeoutMs: 30 });
        const r = await runNamedSignIn(deps);
        assert.equal(r.ok, false);
        assert.match(/** @type {string} */ (r.error), /complete sign-in — check your connection/);
        assert.equal(calls.save, 0, 'must NOT write a local session on timeout (no half-signed-in state)');
        assert.equal(calls.clear, 1);
    });

    test('auth THROWS → treated as not signed in: NO save, clears, ok:false', async () => {
        const { deps, calls } = makeDeps({ ensureNamedSession: async () => { throw new Error('auth blew up'); } });
        const r = await runNamedSignIn(deps);
        assert.equal(r.ok, false);
        assert.equal(calls.save, 0);
        assert.equal(calls.clear, 1);
    });

    test('while auth is still PENDING the session is not saved (the half-signed-in regression)', async () => {
        /** @type {(v: boolean) => void} */ let resolveAuth = () => {};
        const { deps, calls } = makeDeps({
            ensureNamedSession: () => new Promise(res => { resolveAuth = res; }),
            timeoutMs: 5000,
        });
        const p = runNamedSignIn(deps);
        await Promise.resolve();   // let microtasks run — auth has NOT resolved yet
        assert.equal(calls.save, 0, 'session must not be saved while auth is pending');
        resolveAuth(true);
        assert.deepEqual(await p, { ok: true });
        assert.equal(calls.save, 1);
    });
});
