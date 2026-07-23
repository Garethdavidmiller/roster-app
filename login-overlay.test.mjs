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
 * NOT covered here (deliberate): the DOM wiring of attempt() itself (reading form values, button
 * text, the in-place vs reload onSuccess) is exercised by the Playwright e2e suite (e2e/smoke.spec.js),
 * not this unit file. The email-check trigger marker ("Fix 4") is now IMPLEMENTED — set in each
 * coordinator's onSuccess (e.g. admin-app.js) and consumed by _runEmailCheck. The load-bearing
 * contract — "commit the local session ONLY after auth genuinely resolves, time-boxed" — lives
 * entirely in runNamedSignIn and is fully exercised below.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';

// These only need to exist so login-overlay.js imports cleanly; runNamedSignIn never touches them.
mock.module('./session.js', { namedExports: {
    getSurname: () => '', saveSession: () => {}, clearSession: () => {},
    ensureNamedSession: async () => true, isTransientAuthError: () => false, getFirebaseAuthError: () => null,
    primeAuth: () => {},
} });
mock.module('./ls.js', { namedExports: { lsGet: () => null, lsSet: () => {}, lsDel: () => {} } });
mock.module('./overlay.js', { namedExports: { lockBodyScroll: () => {}, unlockBodyScroll: () => {}, trapFocus: () => {} } });
mock.module('./perf-reporter.js', { namedExports: { markLoginStart: () => {}, clearLoginStart: () => {}, recordPageLatency: () => {} } });

const { runNamedSignIn } = await import('./login-overlay.js');

/** Build a deps object with call-recording session helpers and sensible defaults (enforce ON). */
function makeDeps(over = {}) {
    const calls = { save: 0, clear: 0 };
    const deps = {
        enforce:            true,
        ensureNamedSession: async () => true,
        saveSession:        () => { calls.save++; return true; },
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

    test('enforce ON + named false → NO save, clears, ok:false, kind:credential + reset message', async () => {
        const { deps, calls } = makeDeps({ ensureNamedSession: async () => false });
        const r = await runNamedSignIn(deps);
        assert.equal(r.ok, false);
        assert.equal(r.kind, 'credential', 'a definitive failure drives the client lockout');
        assert.match(/** @type {string} */ (r.error), /Password incorrect.*ask the admin to reset it/);
        assert.equal(calls.save, 0);
        assert.equal(calls.clear, 1);
    });

    test('enforce ON + named false + too-many-requests → kind:ratelimit, distinct message, NOT credential', async () => {
        const { deps } = makeDeps({
            ensureNamedSession: async () => false,
            getAuthError: () => 'auth/too-many-requests',
            isTransient: () => true,
        });
        const r = await runNamedSignIn(deps);
        assert.equal(r.ok, false);
        assert.equal(r.kind, 'ratelimit', 'must NOT count toward the wrong-password lockout');
        assert.match(/** @type {string} */ (r.error), /Too many attempts/);
    });

    test('enforce ON + named false + TRANSIENT error → connection message', async () => {
        const { deps } = makeDeps({
            ensureNamedSession: async () => false,
            getAuthError: () => 'network-request-failed',
            isTransient: () => true,
        });
        const r = await runNamedSignIn(deps);
        assert.equal(r.ok, false);
        assert.equal(r.kind, 'transient');
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
        assert.equal(r.kind, 'timeout');
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

    test('storage blocked (saveSession returns false) → clears, ok:false with storage message', async () => {
        // iOS Private Browsing: lsSet swallows the SecurityError, so saveSession's read-back returns
        // false. runNamedSignIn must fail cleanly (sign back out, explain) instead of returning ok:true
        // and handing off to onSuccess, which would loop back to the overlay (getSession() stays null).
        const { deps, calls } = makeDeps({ saveSession: () => { calls.save++; return false; } });
        const r = await runNamedSignIn(deps);
        assert.equal(r.ok, false);
        assert.equal(r.kind, 'storage');
        assert.match(/** @type {string} */ (r.error), /blocking storage/i);
        assert.equal(calls.save, 1, 'save was attempted');
        assert.equal(calls.clear, 1, 'signed back out so no Firebase identity is stranded');
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
