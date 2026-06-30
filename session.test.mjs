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

mock.module('./firebase-client.js', {
    namedExports: {
        auth:                           { currentUser: null },
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
        signOut:                        async () => { _signOutCalled = true; },
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
    AUTH_KEY, SESSION_MS, IDLE_MS, SESSION_VER,
    sessionReady, resolveSession,
    getSurname, getSession, saveSession, clearSession,
    ensureFirebaseSession, getFirebaseIdentity, firebaseSessionIsNamed, getFirebaseAuthError,
    ensureNamedSession, isTransientAuthError, refreshClaimsIfStale, primeAuth,
} = await import('./session.js');
const { nameToEmail, auth } = await import('./firebase-client.js');
// The real (pure) auth store — session.js feeds it; these tests verify the Phase-2 bridge.
const { getAuthSnapshot, _resetAuthState } = await import('./auth-state.js');
const { CONFIG } = await import('./roster-data.js');

// ── Constants ─────────────────────────────────────────────────────────────────

describe('constants', () => {
    test('SESSION_MS is exactly 30 days', () => {
        assert.equal(SESSION_MS, 30 * 24 * 60 * 60 * 1000);
    });

    test('IDLE_MS is exactly 7 days', () => {
        assert.equal(IDLE_MS, 7 * 24 * 60 * 60 * 1000);
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
            name:         'G. Miller',
            ver:          SESSION_VER,
            expiry:       now + SESSION_MS,
            lastActivity: now,
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
    test('does NOT sign Firebase out on passive expiry (absolute / stale / idle)', () => {
        writeSession({ expiry: Date.now() - 1 });
        getSession();
        assert.equal(_signOutCalled, false, 'absolute expiry must not call signOut');

        writeSession({ ver: SESSION_VER - 1 });
        getSession();
        assert.equal(_signOutCalled, false, 'version-stale must not call signOut');

        writeSession({ lastActivity: Date.now() - IDLE_MS - 1 });
        getSession();
        assert.equal(_signOutCalled, false, 'idle expiry must not call signOut');
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

    test('returns null when the session is idle-expired', () => {
        writeSession({ lastActivity: Date.now() - IDLE_MS - 1 });
        assert.equal(getSession(), null);
    });

    test('keeps a session with no lastActivity field (NaN idle check stays active)', () => {
        // Documented edge: Date.now() - undefined = NaN, and NaN > IDLE_MS is false, so a
        // session predating the lastActivity field is treated as active, not idle-expired.
        // (JSON.stringify drops an `undefined` field, so this writes a session without it.)
        writeSession({ lastActivity: undefined });
        const s = getSession();
        assert.ok(s !== null, 'a session without lastActivity must be kept, not purged');
        assert.equal(s.name, 'G. Miller');
    });

    test('returns the session object for a valid, fresh session', () => {
        writeSession();
        const s = getSession();
        assert.ok(s !== null);
        assert.equal(s.name, 'G. Miller');
    });

    test('refreshes lastActivity on every valid read', () => {
        const before = Date.now() - 10_000;
        writeSession({ lastActivity: before });
        const s = getSession();
        assert.ok(s !== null && s.lastActivity > before, 'lastActivity must be bumped forward');
    });

    test('a session expiring in 1 ms is valid until it has elapsed', () => {
        writeSession({ expiry: Date.now() + 1 });
        assert.ok(getSession() !== null);
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

    test("falls back to anonymous on invalid-credential → 'anonymous', NOT named", async () => {
        _signInBehavior = 'auth/invalid-credential';
        _anonBehavior   = 'ok';
        const ok = await ensureFirebaseSession('G. Miller');
        assert.equal(ok, true, 'a session exists…');
        assert.equal(getFirebaseIdentity(), 'anonymous', '…but it is the anonymous fallback');
        assert.equal(firebaseSessionIsNamed(), false);
        assert.equal(getFirebaseAuthError(), 'auth/invalid-credential');
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
        _signInBehavior = 'auth/invalid-credential';   // named fails → anonymous fallback
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
        _resetAuthState();
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
        _signInBehavior = 'auth/invalid-credential';   // named fails → anonymous fallback
        const ok = await ensureNamedSession('G. Miller', { delayMs: 0 });
        assert.equal(ok, true, 'flag off → the anonymous fallback keeps the return true');
        assert.equal(getAuthSnapshot().status, 'anonymous');
        assert.equal(getAuthSnapshot().member, null);
    });

    test('total failure (even anonymous fails) drives the store to error', async () => {
        CONFIG.ENFORCE_NAMED_SESSION = false;
        _signInBehavior = 'auth/invalid-credential';
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

    test('sets lastActivity to approximately now', () => {
        const before = Date.now();
        saveSession('G. Miller');
        const s = JSON.parse(store.get(AUTH_KEY));
        assert.ok(s.lastActivity >= before - 50 && s.lastActivity <= Date.now() + 50);
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
});
