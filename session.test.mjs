/**
 * Unit tests for session.js: constants, getSession, saveSession, clearSession,
 * resolveSession/sessionReady, and getSurname.
 * Run with: node --experimental-test-module-mocks --test session.test.mjs
 *
 * firebase-client.js is mocked (CDN imports, Firebase Auth).
 * ls.js is backed by an in-memory Map so tests can seed and inspect it.
 */

import { test, describe, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// In-memory store backing the ls.js mock.
const store = new Map();
let _signOutCalled = false;
/** When set, the signOut mock REJECTS with this code — the viewer-shed fail-closed tests. */
let _signOutBehavior = 'ok';
/** Ordered log of member-persistence restores (see the mock below). */
let _persistenceRestores = [];

// Controllable Firebase Auth mock state for the ensureFirebaseSession tests below.
// onAuthStateChanged yields _existingUser; each sign-in fn resolves when its behavior is
// 'ok', otherwise rejects with an Error carrying that string as `.code`.
let _existingUser  = null;   // null | { isAnonymous, email }
let _signInBehavior = 'ok';  // 'ok' | error code string
let _createBehavior = 'ok';
let _anonBehavior   = 'ok';
let _createCalled  = false;  // did the code attempt browser-side account creation?
let _anonCalled    = false;  // did the code attempt an anonymous fallback?
let _signInCalls   = 0;      // how many times email/password sign-in was attempted (for retry tests)
let _onAuthSubs    = 0;      // how many times onAuthStateChanged was subscribed (primeAuth/fast-path tests)
/** @type {Promise<void>|null} */
let _signInGate    = null;   // if set, email/password sign-in awaits it before resolving (generation-guard test)
const _authThrow = code => { const e = new Error(code); /** @type {any} */ (e).code = code; throw e; };

// Hoisted so the signOut mock can null currentUser (real Firebase clears it synchronously before
// signOut() resolves — the behaviour the calendar's anon bootstrap depends on), and so tests can
// mutate mockAuth.currentUser directly.
const mockAuth = { currentUser: /** @type {any} */ (null) };

mock.module('./firebase-client.js', {
    namedExports: {
        auth:                           mockAuth,
        authReady:                      Promise.resolve(),
        // Invoke the callback asynchronously with the configured existing user, then return
        // the unsubscribe fn (matching the real onAuthStateChanged contract session.js relies on).
        onAuthStateChanged:             (_auth, cb) => { _onAuthSubs++; Promise.resolve().then(() => cb(_existingUser)); return () => {}; },
        nameToEmail:                    name => name.toLowerCase().replace(/\s+/g, '.') + '@myb.test',
        normaliseSurname:               name => name.split(/\s+/).slice(1).join('').toLowerCase().replace(/[^a-z]/g, ''),
        // _signInBehavior may be a string (same every call) OR a function (callNumber → code),
        // which lets a test model a transient blip that clears on a later retry.
        signInWithEmailAndPassword:     async () => { const n = ++_signInCalls; if (_signInGate) await _signInGate; const b = typeof _signInBehavior === 'function' ? _signInBehavior(n) : _signInBehavior; if (b !== 'ok') _authThrow(b); },
        createUserWithEmailAndPassword: async () => { _createCalled = true; if (_createBehavior !== 'ok') _authThrow(_createBehavior); },
        signInAnonymously:              async () => { _anonCalled = true; if (_anonBehavior !== 'ok') _authThrow(_anonBehavior); },
        signOut:                        async () => {
            _signOutCalled = true;
            if (_signOutBehavior !== 'ok') { const e = new Error(_signOutBehavior); /** @type {any} */ (e).code = _signOutBehavior; throw e; }
            mockAuth.currentUser = null;
        },
        // v20.12: `shedCalendarViewer` re-arms the long-lived MEMBER persistence chain after
        // dropping a shared Calendar viewer. Recorded rather than ignored so the ORDER (sign out,
        // THEN restore persistence) is assertable — reversing it would migrate the shared viewer
        // into IndexedDB, where it survives the browser closing.
        restoreMemberPersistence:       async () => { _persistenceRestores.push('member'); },
    },
});

mock.module('./ls.js', {
    namedExports: {
        lsGet: k      => store.has(k) ? store.get(k) : null,
        lsSet: (k, v) => { store.set(k, String(v)); },
        lsDel: k      => { store.delete(k); },
    },
});

const {
    AUTH_KEY, SESSION_MS, SESSION_VER,
    sessionReady, resolveSession,
    getSurname, getSession, saveSession, clearSession,
    ensureFirebaseSession, getFirebaseIdentity, firebaseSessionIsNamed, getFirebaseAuthError,
    ensureNamedSession, isTransientAuthError, refreshClaimsIfStale, primeAuth,
    reconcileExpiredIdentity, shedCalendarViewer,
} = await import('./session.js');
const { nameToEmail, auth } = await import('./firebase-client.js');
// The real (pure) auth store — session.js feeds it; these tests verify the Phase-2 bridge.
const { getAuthSnapshot, _resetAuthStateForTest } = await import('./auth-state.js');
const { CONFIG } = await import('./roster-data.js');

// ── Constants ─────────────────────────────────────────────────────────────────

describe('constants', () => {
    test('SESSION_MS is exactly 30 days', () => {
        assert.equal(SESSION_MS, 30 * 24 * 60 * 60 * 1000);
    });

    test('SESSION_VER is an integer >= 2', () => {
        assert.ok(Number.isInteger(SESSION_VER) && SESSION_VER >= 2);
    });

    test('AUTH_KEY is a non-empty string', () => {
        assert.ok(typeof AUTH_KEY === 'string' && AUTH_KEY.length > 0);
    });
});

// ── sessionReady / resolveSession ─────────────────────────────────────────────

describe('sessionReady', () => {
    test('sessionReady is a Promise', () => {
        assert.ok(sessionReady instanceof Promise);
    });

    test('resolves with the value passed to resolveSession', async () => {
        resolveSession(true);
        assert.equal(await sessionReady, true);
    });
});

// ── getSurname ────────────────────────────────────────────────────────────────

describe('getSurname', () => {
    test('returns the lowercase surname for a normal name', () => {
        assert.equal(getSurname('G. Miller'), 'miller');
    });

    test('strips hyphens for a hyphenated surname', () => {
        assert.equal(getSurname('C. Francisco-Charles'), 'franciscocharles');
    });

    test('joins a multi-word surname without spaces', () => {
        assert.equal(getSurname('M. De Silva'), 'desilva');
    });
});

// ── getSession ────────────────────────────────────────────────────────────────

describe('getSession', () => {
    /** Write a session to the mock store, accepting field overrides. */
    function writeSession(overrides = {}) {
        const now = Date.now();
        const s = {
            name:   'G. Miller',
            ver:    SESSION_VER,
            expiry: now + SESSION_MS,
            ...overrides,
        };
        store.set(AUTH_KEY, JSON.stringify(s));
        return s;
    }

    beforeEach(() => { store.clear(); _signOutCalled = false; });

    test('returns null when nothing is stored', () => {
        assert.equal(getSession(), null);
    });

    // Regression guard: passive expiry must NOT sign Firebase out. getSession() runs
    // synchronously at module eval on the calendar; an async signOut here would race
    // calendarAuthReady's currentUser check and could leave the page unauthenticated
    // (push/usage/error writes rejected). Firebase signout belongs to clearSession only.
    test('does NOT sign Firebase out on passive expiry (absolute / stale)', () => {
        writeSession({ expiry: Date.now() - 1 });
        getSession();
        assert.equal(_signOutCalled, false, 'absolute expiry must not call signOut');

        writeSession({ ver: SESSION_VER - 1 });
        getSession();
        assert.equal(_signOutCalled, false, 'version-stale must not call signOut');
    });

    test('returns null when stored value is not valid JSON', () => {
        store.set(AUTH_KEY, 'not json');
        assert.equal(getSession(), null);
    });

    test('returns null for an absolutely expired session', () => {
        writeSession({ expiry: Date.now() - 1 });
        assert.equal(getSession(), null);
    });

    test('removes the stored key when the session is absolutely expired', () => {
        writeSession({ expiry: Date.now() - 1 });
        getSession();
        assert.equal(store.has(AUTH_KEY), false);
    });

    test('returns null when the session version is stale', () => {
        writeSession({ ver: SESSION_VER - 1 });
        assert.equal(getSession(), null);
    });

    // The 7-day idle cutoff was removed at v20.41. These two cases replace the four that pinned it,
    // and they pin the property that REPLACED it: 30 days is the only clock, and reading the session
    // does not move it.
    test('a long-untouched session is still valid inside its 30 days', () => {
        // 20 days since the last visit. Under the idle rule this was signed out on day 8 — which hit
        // the members who use the app LEAST, and landed each of them on a password prompt.
        writeSession({ expiry: Date.now() + 10 * 24 * 60 * 60 * 1000,
                       lastActivity: Date.now() - 20 * 24 * 60 * 60 * 1000 });
        const s = getSession();
        assert.ok(s !== null, 'inactivity alone no longer ends a session');
        assert.equal(s.name, 'G. Miller');
    });

    test('a session written before v20.41 still carries lastActivity, and it is ignored', () => {
        // Why no SESSION_VER bump: the old field is inert, so old sessions stay valid. Bumping the
        // version would sign every member out — the exact outcome this change exists to reduce.
        writeSession({ lastActivity: 0 });
        assert.ok(getSession() !== null);
    });

    test('returns the session object for a valid, fresh session', () => {
        writeSession();
        const s = getSession();
        assert.ok(s !== null);
        assert.equal(s.name, 'G. Miller');
    });

    test('reading a session does not WRITE — and cannot extend the 30 days', () => {
        // getSession used to write back on every call to refresh the idle clock. With that clock
        // gone the write has no purpose, and its absence is worth pinning both ways: a localStorage
        // write on every page load of every page, and — the part that would be a real change of
        // policy — any future edit that let a read push `expiry` forward would quietly turn the
        // absolute 30-day bound into a rolling one.
        const written = writeSession();
        const raw = store.get(AUTH_KEY);
        const s = getSession();
        assert.ok(s !== null);
        assert.equal(store.get(AUTH_KEY), raw, 'a read must leave the stored session byte-identical');
        assert.equal(s.expiry, written.expiry, 'and must never move the absolute expiry');
    });

    test('a session expiring in 1 ms is valid until it has elapsed', () => {
        writeSession({ expiry: Date.now() + 1 });
        assert.ok(getSession() !== null);
    });
});

// ── reconcileExpiredIdentity (Finding #9) ─────────────────────────────────────
// A lingering NAMED Firebase identity whose local session has expired must be signed out; a valid
// session, an anonymous identity, and "no user" must all be left alone.

describe('reconcileExpiredIdentity', () => {
    const validSession = () => JSON.stringify({
        name: 'G. Miller', ver: SESSION_VER, expiry: Date.now() + SESSION_MS,
    });

    beforeEach(() => { store.clear(); _signOutCalled = false; _existingUser = null; });
    afterEach(() => { auth.currentUser = null; _existingUser = null; });   // don't leak identity into other tests

    test('signs out a NAMED identity when there is no valid local session', async () => {
        auth.currentUser = /** @type {any} */ ({ isAnonymous: false, email: 'g.miller@myb.test' });
        // store is empty → getSession() null
        await reconcileExpiredIdentity();
        assert.equal(_signOutCalled, true, 'a lingering named identity with no session must be signed out');
        // The calendar's next .then checks auth.currentUser to decide on anon sign-in — signOut must
        // have cleared it so the anon bootstrap runs (no page left without any identity).
        assert.equal(auth.currentUser, null, 'signOut must clear currentUser so the anon bootstrap runs');
    });

    test('COLD restore: signs out a named identity that loads via onAuthStateChanged AFTER authReady (item 7)', async () => {
        // authReady only means persistence is SET — on a cold restore auth.currentUser is still null at
        // that moment and the persisted named user arrives via the FIRST onAuthStateChanged emission.
        // reconcile must wait for that restore and still tear the lingering identity down (otherwise it
        // survives the whole load — the exact gap that made this calendar-only before item 7).
        auth.currentUser = null;                                                     // cold: not populated yet
        _existingUser = { isAnonymous: false, email: nameToEmail('G. Miller') };     // restore emits this
        // store empty → getSession() null (expired local session)
        await reconcileExpiredIdentity();
        assert.equal(_signOutCalled, true, 'a named identity restored AFTER authReady must still be signed out');
    });

    test('COLD restore with a VALID local session → the restored named identity is kept', async () => {
        // Same cold restore, but the local session is still valid → reconcile must NOT sign out.
        auth.currentUser = null;
        _existingUser = { isAnonymous: false, email: nameToEmail('G. Miller') };
        store.set(AUTH_KEY, validSession());
        await reconcileExpiredIdentity();
        assert.equal(_signOutCalled, false, 'a cold-restored identity with a valid session must be kept');
    });

    test('COLD restore that resolves to an ANONYMOUS identity → left alone', async () => {
        auth.currentUser = null;
        _existingUser = { isAnonymous: true };
        await reconcileExpiredIdentity();
        assert.equal(_signOutCalled, false, 'anonymous cold-restored identities are not a privilege leak');
    });

    test('stands down when a login bumped the generation while awaiting authReady', async () => {
        // A named identity with NO local session → reconcile WOULD sign out, UNLESS the generation
        // guard trips because a login started meanwhile. Requesting the SAME identity takes
        // ensureFirebaseSession's matching-user fast path (no signout of its own), isolating the guard.
        auth.currentUser = /** @type {any} */ ({ isAnonymous: false, email: nameToEmail('G. Miller') });
        const p = reconcileExpiredIdentity();          // snapshots _authGen, then awaits authReady
        const login = ensureNamedSession('G. Miller');  // ++_authGen synchronously → supersedes reconcile
        await p;
        await login;
        assert.equal(_signOutCalled, false, 'reconcile must stand down when a login superseded it');
    });

    test('keeps a NAMED identity when a valid local session still exists', async () => {
        auth.currentUser = /** @type {any} */ ({ isAnonymous: false, email: 'g.miller@myb.test' });
        store.set(AUTH_KEY, validSession());
        await reconcileExpiredIdentity();
        assert.equal(_signOutCalled, false, 'a still-valid session must not be torn down');
    });

    test('leaves an ANONYMOUS identity alone (the calendar depends on it)', async () => {
        auth.currentUser = /** @type {any} */ ({ isAnonymous: true });
        await reconcileExpiredIdentity();
        assert.equal(_signOutCalled, false, 'anonymous sessions are not a privilege leak');
    });

    test('no-ops when there is no Firebase user at all', async () => {
        auth.currentUser = null;
        await reconcileExpiredIdentity();
        assert.equal(_signOutCalled, false);
    });
});

// ── ensureFirebaseSession identity tracking (B0) ──────────────────────────────
// B0 (SECURITY_RELEASE_PLAN.md): ensureFirebaseSession now records whether it established
// the member's NAMED identity or only the anonymous fallback, without changing behaviour.
// firebaseSessionIsNamed() is the signal per-member write isolation (B2) will depend on.

describe('ensureFirebaseSession identity tracking', () => {
    beforeEach(() => {
        _existingUser   = null;
        _signInBehavior = 'ok';
        _createBehavior = 'ok';
        _anonBehavior   = 'ok';
        _signOutCalled  = false;
        _createCalled   = false;
        _anonCalled     = false;
        CONFIG.ENFORCE_NAMED_SESSION = false;   // these tests cover the default (flag-off) behaviour
    });

    test("reuses an existing NAMED session for the same member → 'named'", async () => {
        _existingUser = { isAnonymous: false, email: nameToEmail('G. Miller') };
        const ok = await ensureFirebaseSession('G. Miller');
        assert.equal(ok, true);
        assert.equal(getFirebaseIdentity(), 'named');
        assert.equal(firebaseSessionIsNamed(), true);
        assert.equal(_signOutCalled, false, 'a matching named session must not be torn down');
    });

    test("signs in with email/password when there is no existing session → 'named'", async () => {
        const ok = await ensureFirebaseSession('G. Miller');
        assert.equal(ok, true);
        assert.equal(getFirebaseIdentity(), 'named');
    });

    test("self-heals a missing account via createUser → 'named'", async () => {
        _signInBehavior = 'auth/user-not-found';
        _createBehavior = 'ok';
        const ok = await ensureFirebaseSession('G. Miller');
        assert.equal(ok, true);
        assert.equal(getFirebaseIdentity(), 'named');
    });

    test("falls back to anonymous on a NON-credential failure (provider disabled) → 'anonymous', NOT named", async () => {
        // §3.3: only NON-credential errors fall back to anonymous when the flag is off. A CREDENTIAL
        // rejection (invalid-credential) resolves to 'none' — covered by the dedicated test below.
        _signInBehavior = 'auth/operation-not-allowed';
        _anonBehavior   = 'ok';
        const ok = await ensureFirebaseSession('G. Miller');
        assert.equal(ok, true, 'a session exists…');
        assert.equal(getFirebaseIdentity(), 'anonymous', '…but it is the anonymous fallback');
        assert.equal(firebaseSessionIsNamed(), false);
        assert.equal(getFirebaseAuthError(), 'auth/operation-not-allowed');
    });

    test("PASSWORD_PLAN §3.3: a CREDENTIAL rejection does NOT fall back to anonymous even flag-off → 'none'", async () => {
        _signInBehavior = 'auth/invalid-credential';
        _anonBehavior   = 'ok';   // available, but must NOT be used
        const ok = await ensureFirebaseSession('G. Miller');
        assert.equal(ok, false);
        assert.equal(getFirebaseIdentity(), 'none');
        assert.equal(_anonCalled, false, 'a wrong password must never become an anonymous session');
    });

    test('gated dual-attempt: a typed MIXED-CASE surname tries raw then the derived surname → named (2 calls)', async () => {
        // "Miller" ≠ "miller" (Firebase), so attempt 1 fails; attempt 2 (the gated surname) succeeds.
        _signInCalls = 0;
        _signInBehavior = /** @param {number} n */ (n) => (n === 1 ? 'auth/invalid-credential' : 'ok');
        const ok = await ensureFirebaseSession('G. Miller', undefined, 'Miller');
        assert.equal(ok, true);
        assert.equal(getFirebaseIdentity(), 'named');
        assert.equal(_signInCalls, 2, 'raw typed value, then the gated derived surname');
    });

    test('gated dual-attempt: a typed CUSTOM password is the ONLY candidate → one call, no surname fallback', async () => {
        // "Str0ng!pass" does not normalise to the surname, so there is no second attempt.
        _signInCalls = 0;
        _signInBehavior = 'auth/invalid-credential';
        const ok = await ensureFirebaseSession('G. Miller', undefined, 'Str0ng!pass');
        assert.equal(ok, false);
        assert.equal(getFirebaseIdentity(), 'none');
        assert.equal(_signInCalls, 1, 'a non-surname password never triggers the surname attempt');
    });

    test("returns false and 'none' when even anonymous sign-in fails", async () => {
        _signInBehavior = 'auth/invalid-credential';
        _anonBehavior   = 'auth/operation-not-allowed';
        const ok = await ensureFirebaseSession('G. Miller');
        assert.equal(ok, false);
        assert.equal(getFirebaseIdentity(), 'none');
        assert.equal(firebaseSessionIsNamed(), false);
    });

    test('replaces an existing ANONYMOUS session with a named sign-in', async () => {
        _existingUser   = { isAnonymous: true };
        _signInBehavior = 'ok';
        const ok = await ensureFirebaseSession('G. Miller');
        assert.equal(_signOutCalled, true, 'the stale anonymous session must be signed out first');
        assert.equal(getFirebaseIdentity(), 'named');
        assert.ok(ok);
    });

    test('replaces a DIFFERENT named member’s session (shared device) with the new member', async () => {
        _existingUser   = { isAnonymous: false, email: nameToEmail('A. Panchal') };
        _signInBehavior = 'ok';
        const ok = await ensureFirebaseSession('G. Miller');
        assert.equal(_signOutCalled, true, 'the other member’s session must be signed out first');
        assert.equal(getFirebaseIdentity(), 'named');
        assert.ok(ok);
    });
});

// ── ensureFirebaseSession with ENFORCE_NAMED_SESSION on (B1.1) ────────────────
// B1.1 (SECURITY_RELEASE_PLAN.md): with the kill-switch ON, write pages require the member's
// OWN named session — ensureFirebaseSession must NOT create accounts and must NOT fall back to
// an anonymous session; a failed named sign-in returns false / 'none' so the page can prompt a
// re-login. The flag defaults OFF (covered above), so production behaviour is unchanged until
// it is deliberately flipped on.
describe('ensureFirebaseSession with ENFORCE_NAMED_SESSION on', () => {
    beforeEach(() => {
        _existingUser   = null;
        _signInBehavior = 'ok';
        _createBehavior = 'ok';
        _anonBehavior   = 'ok';
        _signOutCalled  = false;
        _createCalled   = false;
        _anonCalled     = false;
        CONFIG.ENFORCE_NAMED_SESSION = true;
    });
    // Restore the default so no other test in the file is affected.
    afterEach(() => { CONFIG.ENFORCE_NAMED_SESSION = false; });

    test('a successful named sign-in still works → named', async () => {
        const ok = await ensureFirebaseSession('G. Miller');
        assert.equal(ok, true);
        assert.equal(getFirebaseIdentity(), 'named');
        assert.equal(_anonCalled, false, 'no anonymous fallback should be attempted');
    });

    test('user-not-found does NOT self-heal — returns false / none, no account created', async () => {
        _signInBehavior = 'auth/user-not-found';
        const ok = await ensureFirebaseSession('G. Miller');
        assert.equal(ok, false);
        assert.equal(getFirebaseIdentity(), 'none');
        assert.equal(_createCalled, false, 'browser-side account creation must NOT run when enforcing');
        assert.equal(_anonCalled, false, 'no anonymous fallback when enforcing');
        assert.equal(getFirebaseAuthError(), 'auth/user-not-found');
    });

    test('invalid-credential does NOT fall back to anonymous — returns false / none', async () => {
        _signInBehavior = 'auth/invalid-credential';
        const ok = await ensureFirebaseSession('G. Miller');
        assert.equal(ok, false);
        assert.equal(getFirebaseIdentity(), 'none');
        assert.equal(_anonCalled, false, 'no anonymous fallback when enforcing');
        assert.equal(firebaseSessionIsNamed(), false);
    });

    test('a matching existing named session is still reused → named', async () => {
        _existingUser = { isAnonymous: false, email: nameToEmail('G. Miller') };
        const ok = await ensureFirebaseSession('G. Miller');
        assert.equal(ok, true);
        assert.equal(getFirebaseIdentity(), 'named');
    });
});

// ── ensureNamedSession + isTransientAuthError (B1.2) ──────────────────────────
describe('isTransientAuthError', () => {
    test('true for connectivity-style codes, false otherwise', () => {
        assert.equal(isTransientAuthError('auth/network-request-failed'), true);
        assert.equal(isTransientAuthError('auth/timeout'), true);
        assert.equal(isTransientAuthError('auth/too-many-requests'), true);
        assert.equal(isTransientAuthError('auth/invalid-credential'), false);
        assert.equal(isTransientAuthError('auth/user-not-found'), false);
        assert.equal(isTransientAuthError(undefined), false);
    });
});

describe('ensureNamedSession', () => {
    beforeEach(() => {
        _existingUser   = null;
        _signInBehavior = 'ok';
        _createBehavior = 'ok';
        _anonBehavior   = 'ok';
        _signOutCalled  = false;
        _createCalled   = false;
        _anonCalled     = false;
        _signInCalls    = 0;
    });
    afterEach(() => { CONFIG.ENFORCE_NAMED_SESSION = false; });

    test('flag OFF: returns ensureFirebaseSession result unchanged (anonymous fallback still counts as ok)', async () => {
        CONFIG.ENFORCE_NAMED_SESSION = false;
        _signInBehavior = 'auth/operation-not-allowed';   // NON-credential failure → anonymous fallback
        const ok = await ensureNamedSession('G. Miller', { delayMs: 0 });
        assert.equal(ok, true, 'flag off → the anonymous fallback keeps it true, no gating');
        assert.equal(_anonCalled, true);
    });

    test('flag ON: a named sign-in succeeds → true, no retries', async () => {
        CONFIG.ENFORCE_NAMED_SESSION = true;
        const ok = await ensureNamedSession('G. Miller', { delayMs: 0 });
        assert.equal(ok, true);
        assert.equal(_signInCalls, 1);
    });

    test('flag ON: a PERSISTENT failure is not retried → false, one attempt', async () => {
        CONFIG.ENFORCE_NAMED_SESSION = true;
        _signInBehavior = 'auth/invalid-credential';
        const ok = await ensureNamedSession('G. Miller', { delayMs: 0, retries: 2 });
        assert.equal(ok, false);
        assert.equal(_signInCalls, 1, 'a credential/account error must not be retried');
        assert.equal(_anonCalled, false);
    });

    test('flag ON: a TRANSIENT failure is retried, then gives up → false after retries+1 attempts', async () => {
        CONFIG.ENFORCE_NAMED_SESSION = true;
        _signInBehavior = 'auth/network-request-failed';
        const ok = await ensureNamedSession('G. Miller', { delayMs: 0, retries: 2 });
        assert.equal(ok, false);
        assert.equal(_signInCalls, 3, 'initial attempt + 2 retries');
    });

    test('flag ON: a TRANSIENT failure that CLEARS on retry → true (recovery path)', async () => {
        CONFIG.ENFORCE_NAMED_SESSION = true;
        _signInBehavior = /** @param {number} call */ (call) => (call === 1 ? 'auth/network-request-failed' : 'ok');
        const ok = await ensureNamedSession('G. Miller', { delayMs: 0, retries: 2 });
        assert.equal(ok, true, 'a momentary blip that clears on the first retry yields a named session');
        assert.equal(_signInCalls, 2, 'failed once, succeeded on the first retry');
    });
});

// ── Phase-2 bridge: ensureNamedSession / clearSession feed the auth store ───────
// The store is OBSERVING ONLY (no production consumer yet); these tests prove session.js
// drives it to the correct terminal state without changing ensureNamedSession's return.
describe('auth-store bridge (Phase 2)', () => {
    beforeEach(() => {
        _existingUser = null; _signInBehavior = 'ok'; _createBehavior = 'ok'; _anonBehavior = 'ok';
        _signOutCalled = false; _createCalled = false; _anonCalled = false; _signInCalls = 0;
        _resetAuthStateForTest();
    });
    afterEach(() => { CONFIG.ENFORCE_NAMED_SESSION = false; });

    test('flag ON: a named sign-in drives the store to named + member', async () => {
        CONFIG.ENFORCE_NAMED_SESSION = true;
        await ensureNamedSession('G. Miller', { delayMs: 0 });
        assert.deepEqual(getAuthSnapshot(), { status: 'named', member: 'G. Miller', error: null });
    });

    test('flag ON: a persistent failure drives the store to signedOut', async () => {
        CONFIG.ENFORCE_NAMED_SESSION = true;
        _signInBehavior = 'auth/invalid-credential';
        const ok = await ensureNamedSession('G. Miller', { delayMs: 0 });
        assert.equal(ok, false, 'return value still reflects the failed named session');
        assert.equal(getAuthSnapshot().status, 'signedOut');
        assert.equal(getAuthSnapshot().error, 'auth/invalid-credential');
    });

    test('flag OFF: the anonymous fallback drives the store to anonymous', async () => {
        CONFIG.ENFORCE_NAMED_SESSION = false;
        _signInBehavior = 'auth/operation-not-allowed';   // NON-credential failure → anonymous fallback
        const ok = await ensureNamedSession('G. Miller', { delayMs: 0 });
        assert.equal(ok, true, 'flag off → the anonymous fallback keeps the return true');
        assert.equal(getAuthSnapshot().status, 'anonymous');
        assert.equal(getAuthSnapshot().member, null);
    });

    test('total failure (even anonymous fails) drives the store to error', async () => {
        CONFIG.ENFORCE_NAMED_SESSION = false;
        _signInBehavior = 'auth/network-request-failed';   // NON-credential → tries anon, which also fails
        _anonBehavior   = 'auth/operation-not-allowed';
        await ensureNamedSession('G. Miller', { delayMs: 0 });
        assert.equal(getAuthSnapshot().status, 'error');
    });

    test('clearSession drives the store to signedOut', () => {
        // Seed a non-signedOut state first, then clear.
        // (ensureNamedSession would set it; here we just confirm clearSession's feed.)
        clearSession();
        assert.equal(getAuthSnapshot().status, 'signedOut');
    });

    test('the bridge does NOT change ensureNamedSession\'s return value (named success → true)', async () => {
        CONFIG.ENFORCE_NAMED_SESSION = true;
        const ok = await ensureNamedSession('G. Miller', { delayMs: 0 });
        assert.equal(ok, true);
    });
});

// ── saveSession ───────────────────────────────────────────────────────────────

describe('saveSession', () => {
    beforeEach(() => store.clear());

    test('writes the member name to the session', () => {
        saveSession('G. Miller');
        const s = JSON.parse(store.get(AUTH_KEY));
        assert.equal(s.name, 'G. Miller');
    });

    test('writes SESSION_VER as the version field', () => {
        saveSession('G. Miller');
        const s = JSON.parse(store.get(AUTH_KEY));
        assert.equal(s.ver, SESSION_VER);
    });

    test('sets expiry approximately SESSION_MS ms in the future', () => {
        const before = Date.now();
        saveSession('G. Miller');
        const s = JSON.parse(store.get(AUTH_KEY));
        assert.ok(s.expiry >= before + SESSION_MS - 50, 'expiry should be at least SESSION_MS ahead');
        assert.ok(s.expiry <= before + SESSION_MS + 50, 'expiry should be at most SESSION_MS + 50ms ahead');
    });

    test('writes NO idle timestamp — there is one clock, and it is `expiry` (v20.41)', () => {
        // Asserted by absence rather than deleted outright: a new session carrying a `lastActivity`
        // again would be the first sign that the idle policy had been reintroduced by halves.
        saveSession('G. Miller');
        const s = JSON.parse(store.get(AUTH_KEY));
        assert.equal('lastActivity' in s, false);
        assert.deepEqual(Object.keys(s).sort(), ['expiry', 'name', 'ver']);
    });

    test('returns true when the write persists (read-back matches)', () => {
        assert.equal(saveSession('G. Miller'), true);
    });

    test('returns false when storage is blocked (write swallowed → read-back mismatch)', () => {
        // Simulate iOS Private Browsing: lsSet swallows the throw, so nothing is stored and the
        // read-back returns null !== payload. runNamedSignIn relies on this to fail sign-in cleanly.
        const orig = store.set.bind(store);
        store.set = () => store;            // no-op write (value never lands)
        try {
            assert.equal(saveSession('G. Miller'), false);
        } finally {
            store.set = orig;
        }
    });
});

// ── clearSession ──────────────────────────────────────────────────────────────

describe('clearSession', () => {
    beforeEach(() => { store.clear(); _signOutCalled = false; });

    test('removes AUTH_KEY from localStorage', () => {
        store.set(AUTH_KEY, '{}');
        clearSession();
        assert.equal(store.has(AUTH_KEY), false);
    });

    test('calls firebase signOut', () => {
        clearSession();
        assert.equal(_signOutCalled, true);
    });
});

// ── refreshClaimsIfStale (B3 claim-refresh sweep) ──────────────────────────────
describe('refreshClaimsIfStale (B3 claim-refresh sweep)', () => {
    /** Set the mocked auth.currentUser to a stub that records getIdToken(force) calls. */
    function withUser() {
        const calls = [];
        auth.currentUser = { getIdToken: async (/** @type {boolean} */ force) => { calls.push(force); } };
        return calls;
    }

    test('epoch 0 / falsy → no refresh, no flag written', async () => {
        store.clear();
        const calls = withUser();
        await refreshClaimsIfStale(0);
        assert.equal(calls.length, 0);
        assert.equal(store.has('myb_claim_epoch'), false);
        auth.currentUser = null;
    });

    test('no live session → no refresh', async () => {
        store.clear();
        auth.currentUser = null;
        await refreshClaimsIfStale(1);
        assert.equal(store.has('myb_claim_epoch'), false);
    });

    test('first sweep for an epoch → force-refreshes once and records the epoch', async () => {
        store.clear();
        const calls = withUser();
        await refreshClaimsIfStale(1);
        assert.deepEqual(calls, [true]);                         // getIdToken(true) exactly once, forced
        assert.equal(store.get('myb_claim_epoch'), '1');
        auth.currentUser = null;
    });

    test('already swept for this epoch → no second refresh', async () => {
        store.clear();
        store.set('myb_claim_epoch', '2');
        const calls = withUser();
        await refreshClaimsIfStale(2);
        assert.equal(calls.length, 0);                           // seen >= epoch → skip
        auth.currentUser = null;
    });

    test('epoch advanced past the recorded one → refreshes again', async () => {
        store.clear();
        store.set('myb_claim_epoch', '1');
        const calls = withUser();
        await refreshClaimsIfStale(2);
        assert.deepEqual(calls, [true]);
        assert.equal(store.get('myb_claim_epoch'), '2');
        auth.currentUser = null;
    });

    test('getIdToken failure is swallowed (best-effort) and the flag is NOT advanced', async () => {
        store.clear();
        auth.currentUser = { getIdToken: async () => { throw new Error('network'); } };
        await refreshClaimsIfStale(1);                           // must not throw
        assert.equal(store.has('myb_claim_epoch'), false);       // flag only set after a successful refresh
        auth.currentUser = null;
    });
});

// ── primeAuth pre-warm + auth.currentUser fast path (login latency, v14.80–83) ──
describe('primeAuth + currentUser fast path', () => {
    beforeEach(() => {
        store.clear();
        _existingUser    = null;
        _signInBehavior  = 'ok';
        _signInCalls     = 0;
        _onAuthSubs      = 0;
        auth.currentUser = null;
        CONFIG.ENFORCE_NAMED_SESSION = false;
    });
    afterEach(() => { auth.currentUser = null; });

    test('primeAuth pre-subscribes the restore once and ensureFirebaseSession consumes it (no 2nd subscription)', async () => {
        _existingUser = { isAnonymous: false, email: nameToEmail('G. Miller') };
        primeAuth();
        // flush the authReady → _restoreFirstAuthUser microtask chain so the eager subscription happens
        for (let i = 0; i < 5; i++) await Promise.resolve();
        assert.equal(_onAuthSubs, 1, 'primeAuth subscribes the first auth-state once, eagerly');

        const ok = await ensureFirebaseSession('G. Miller');
        assert.equal(ok, true);
        assert.equal(getFirebaseIdentity(), 'named');
        assert.equal(_onAuthSubs, 1, 'the primed restore was consumed — no second onAuthStateChanged');

        primeAuth();   // one-shot per page life: a second prime is a no-op
        for (let i = 0; i < 5; i++) await Promise.resolve();
        assert.equal(_onAuthSubs, 1, 'primeAuth is idempotent');
    });

    test('fast path: a live matching named currentUser returns immediately (no restore wait, no sign-in)', async () => {
        auth.currentUser = { isAnonymous: false, email: nameToEmail('G. Miller') };
        _existingUser    = null;   // onAuthStateChanged would yield null — proving we did NOT consult it

        const ok = await ensureFirebaseSession('G. Miller');
        assert.equal(ok, true);
        assert.equal(getFirebaseIdentity(), 'named');
        assert.equal(_onAuthSubs, 0, 'currentUser fast path skips the onAuthStateChanged subscription');
        assert.equal(_signInCalls, 0, 'and skips the sign-in network call entirely');
    });

    test('fast path still VALIDATES identity: an anonymous live session is not reused — signs out + re-auths', async () => {
        auth.currentUser = { isAnonymous: true, email: null };
        _existingUser    = null;
        _signOutCalled   = false;

        const ok = await ensureFirebaseSession('G. Miller');
        assert.equal(ok, true);
        assert.equal(_signOutCalled, true, 'the anonymous live session is signed out, not reused');
        assert.equal(_signInCalls, 1, 'then a fresh named sign-in runs');
        assert.equal(getFirebaseIdentity(), 'named');
    });
});

// ── Generation guard — a stale (timed-out) attempt must not clobber a newer one (v14.87) ──
// runNamedSignIn time-boxes auth but cannot CANCEL the underlying Firebase promise, so a hung attempt
// can resolve LATE — after the user retried and a newer attempt already won. The guard drops the late
// completion's terminal writes so it can't downgrade the winner's identity (which under B1 would
// trigger a spurious re-login).
describe('auth generation guard', () => {
    beforeEach(() => {
        store.clear();
        _existingUser    = null;
        _signInBehavior  = 'ok';
        _signInCalls     = 0;
        _signInGate      = null;
        auth.currentUser = null;
        CONFIG.ENFORCE_NAMED_SESSION = false;
    });
    afterEach(() => { _signInGate = null; auth.currentUser = null; });

    test('a superseded attempt that resumes and FAILS does not clobber the winner’s named identity', async () => {
        // Attempt 1 hangs at sign-in; Attempt 2 starts and wins as 'named'; Attempt 1 then resumes and
        // its sign-in FAILS → without the guard it would fall back to 'anonymous' and overwrite _fbIdentity.
        _signInBehavior = (/** @type {number} */ n) => (n === 1 ? 'auth/invalid-credential' : 'ok');
        /** @type {() => void} */ let releaseGate = () => {};
        _signInGate = new Promise(r => { releaseGate = r; });

        const p1 = ensureFirebaseSession('G. Miller');          // attempt 1 — hangs awaiting the gate
        for (let i = 0; i < 6; i++) await Promise.resolve();    // let it reach the gate
        _signInGate = null;                                     // attempt 2 won't gate

        const ok2 = await ensureFirebaseSession('G. Miller');   // attempt 2 — wins
        assert.equal(ok2, true);
        assert.equal(getFirebaseIdentity(), 'named');

        releaseGate();                                          // attempt 1 resumes → fails → anonymous (STALE)
        await p1;
        assert.equal(getFirebaseIdentity(), 'named', 'the stale attempt must not overwrite the winner');
    });

    test('the latest (current) attempt still writes identity normally', async () => {
        // Sanity: with no superseding attempt, the guard is a pure no-op — identity is published.
        const ok = await ensureFirebaseSession('G. Miller');
        assert.equal(ok, true);
        assert.equal(getFirebaseIdentity(), 'named');
    });

    test('a superseded RETRY does not clobber the winner via the top reset (ENFORCE-on retry loop)', async () => {
        // The bug the v14.91 review caught: ensureNamedSession's retry loop re-enters ensureFirebaseSession
        // with its STALE gen; the unguarded top `_fbIdentity='none'` reset then clobbered a newer winner.
        // Repro: ENFORCE on (so the retry loop runs); attempt 1's first sign-in is TRANSIENT → it enters
        // the loop and waits; attempt 2 wins as 'named'; then attempt 1's delayed retry runs its reset.
        CONFIG.ENFORCE_NAMED_SESSION = true;
        _signInBehavior = (/** @type {number} */ n) => (n === 1 ? 'auth/network-request-failed' : 'ok');

        const p1 = ensureNamedSession('G. Miller', { retries: 1, delayMs: 60 }); // call 1 (transient) → retry loop
        await new Promise(r => setTimeout(r, 10));                                // let attempt 1 reach its setTimeout
        await ensureNamedSession('G. Miller');                                    // attempt 2 (call 2) wins → 'named'
        assert.equal(getFirebaseIdentity(), 'named', 'attempt 2 won');

        await p1;   // attempt 1's delayed retry (call 3) runs — its top reset must be gen-guarded
        assert.equal(getFirebaseIdentity(), 'named',
            'a superseded retry must not reset _fbIdentity to none — the global and the store would disagree');
        CONFIG.ENFORCE_NAMED_SESSION = false;
    });
});

// ── B5: a superseded login must not report a SPURIOUS failure ──────────────────
// A direct ensureFirebaseSession(name) overlapping an in-flight ensureNamedSession(name) bumps
// _authGen and supersedes the login. The login's superseded branch must NOT return a blanket false
// (which the overlay shows as "sign-in failed") when the app genuinely ended up signed in as this
// member — it must report the identity-honest result (auth.currentUser is ground truth; never the
// shared _fbIdentity a newer attempt may have moved).
describe('B5: superseded login is identity-honest, not a spurious failure', () => {
    beforeEach(() => {
        store.clear();
        _existingUser    = null;
        _signInBehavior  = 'ok';
        _signInCalls     = 0;
        _signInGate      = null;
        auth.currentUser = null;
        CONFIG.ENFORCE_NAMED_SESSION = true;   // the live B1 path — the only branch with the hard superseded-false
    });
    afterEach(() => { _signInGate = null; auth.currentUser = null; CONFIG.ENFORCE_NAMED_SESSION = false; });

    test('superseded by a SAME-member direct call, but genuinely signed in → returns true (no spurious failure)', async () => {
        // Login (gen G1) reaches sign-in and parks at the gate. A direct ensureFirebaseSession('G. Miller')
        // (gen G2) then wins off the live session, superseding G1. When G1 resumes and finds itself
        // superseded, the live user IS the member, so it must return true — not the old blanket false.
        /** @type {() => void} */ let releaseGate = () => {};
        _signInGate = new Promise(r => { releaseGate = r; });

        const login = ensureNamedSession('G. Miller', { delayMs: 0 });   // G1 — parks at the gate
        for (let i = 0; i < 6; i++) await Promise.resolve();             // let it reach the gate
        _signInGate = null;                                             // the superseding call won't gate

        // The member's own session is now live (real Firebase populates currentUser on sign-in).
        auth.currentUser = { isAnonymous: false, email: nameToEmail('G. Miller') };
        await ensureFirebaseSession('G. Miller');                       // G2 — supersedes via the fast path
        assert.equal(getFirebaseIdentity(), 'named', 'the direct call won as named');

        releaseGate();
        const ok = await login;
        assert.equal(ok, true, 'a superseded login that IS signed in as the member must not report failure');
        assert.equal(getFirebaseIdentity(), 'named', 'the superseded login published nothing — the winner is intact');
    });

    test('superseded when the live identity is a DIFFERENT member → still returns false (no false positive)', async () => {
        // Same race, but the winner established a DIFFERENT member's session. The superseded login for
        // G. Miller must NOT claim success off someone else's identity — the ground-truth email check rejects it.
        /** @type {() => void} */ let releaseGate = () => {};
        _signInGate = new Promise(r => { releaseGate = r; });

        const login = ensureNamedSession('G. Miller', { delayMs: 0 });   // G1 — parks at the gate
        for (let i = 0; i < 6; i++) await Promise.resolve();
        _signInGate = null;

        auth.currentUser = { isAnonymous: false, email: nameToEmail('A. Panchal') };
        await ensureFirebaseSession('A. Panchal');                       // G2 — wins as a different member
        assert.equal(getFirebaseIdentity(), 'named');

        releaseGate();
        const ok = await login;
        assert.equal(ok, false, 'a superseded login must not report success when the live user is someone else');
    });

    test('superseded by a teardown (currentUser signed out) → returns false', async () => {
        // clearSession supersedes AND signs Firebase out, so the live user is null → the superseded login
        // correctly returns false (the teardown genuinely won; there is no session to claim).
        /** @type {() => void} */ let releaseGate = () => {};
        _signInGate = new Promise(r => { releaseGate = r; });

        const login = ensureNamedSession('G. Miller', { delayMs: 0 });   // G1 — parks at the gate
        for (let i = 0; i < 6; i++) await Promise.resolve();
        _signInGate = null;

        clearSession();                 // ++_authGen (supersede) + firebaseSignOut → currentUser cleared
        assert.equal(auth.currentUser, null);

        releaseGate();
        const ok = await login;
        assert.equal(ok, false, 'a login superseded by an explicit logout must not report success');
    });
});


// ── THE VIEWER→MEMBER TRANSITION MUST FAIL CLOSED (v20.35) ──────────────────────────────────────
//
// `shedCalendarViewer` signs the shared Calendar viewer out BEFORE re-arming the long-lived member
// persistence chain, because `setPersistence` migrates the CURRENT user into the new persistence —
// so doing it the other way round moves the shared viewer into IndexedDB, where it survives the
// browser closing. That is the one property that makes unlocking a shared office PC safe, and the
// ordering was correct and documented from the start.
//
// The ERROR HANDLING quietly undid it. The sign-out sat in a `try/catch` that only warned, and the
// persistence restore then ran regardless — so on the single path where the ordering matters (the
// sign-out fails, the viewer is STILL current) the code did exactly the thing its own comment
// forbade. An external review found it; nothing in the suite would have.
//
// These tests assert the ABSENCE of a call, which is the only shape that can catch it: every
// positive assertion about the happy path passed throughout the period the bug existed.
describe('shedCalendarViewer — fail closed, or the shared viewer goes long-lived', () => {
    const viewer = { uid: 'calendar-viewer', isAnonymous: false, email: null };
    beforeEach(() => {
        store.clear();
        _signOutCalled = false; _signOutBehavior = 'ok'; _persistenceRestores = [];
        _existingUser = null; _signInBehavior = 'ok'; _anonCalled = false;
        mockAuth.currentUser = null;
    });
    afterEach(() => { _signOutBehavior = 'ok'; });

    test('the happy path still signs out THEN restores member persistence', async () => {
        mockAuth.currentUser = viewer;
        await shedCalendarViewer();
        assert.equal(_signOutCalled, true);
        assert.deepEqual(_persistenceRestores, ['member'], 'the chain is re-armed once the viewer is gone');
    });

    test('a FAILED sign-out throws and never touches persistence', async () => {
        mockAuth.currentUser = viewer;
        _signOutBehavior = 'auth/network-request-failed';
        await assert.rejects(() => shedCalendarViewer(), /network-request-failed|sign-out failed/);
        assert.deepEqual(_persistenceRestores, [],
            'restoreMemberPersistence must NOT run — it would migrate the shared viewer into IndexedDB');
    });

    test('a sign-out that RESOLVES but leaves the viewer current is also refused', () => {
        // Belt-and-braces: the invariant is that the viewer is GONE, not that signOut resolved. An
        // SDK that resolved without clearing would otherwise walk straight into the same migration.
        // Modelled by pinning currentUser so the mock's clear has no effect.
        const orig = Object.getOwnPropertyDescriptor(mockAuth, 'currentUser');
        Object.defineProperty(mockAuth, 'currentUser', { configurable: true, get: () => viewer, set: () => {} });
        return assert.rejects(() => shedCalendarViewer(), /still current after sign-out/)
            .then(() => {
                assert.deepEqual(_persistenceRestores, [], 'persistence untouched when the viewer survives');
            })
            .finally(() => {
                if (orig) Object.defineProperty(mockAuth, 'currentUser', orig);
                else delete /** @type {any} */ (mockAuth).currentUser;
            });
    });

    test('a non-viewer identity is left entirely alone', async () => {
        mockAuth.currentUser = { uid: 'someone-else', isAnonymous: false, email: 'a@b.test' };
        await shedCalendarViewer();
        assert.equal(_signOutCalled, false, 'this function only ever sheds the shared viewer');
        assert.deepEqual(_persistenceRestores, []);
    });
});
