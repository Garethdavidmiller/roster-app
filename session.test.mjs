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
const _authThrow = code => { const e = new Error(code); /** @type {any} */ (e).code = code; throw e; };

mock.module('./firebase-client.js', {
    namedExports: {
        auth:                           { currentUser: null },
        authReady:                      Promise.resolve(),
        // Invoke the callback asynchronously with the configured existing user, then return
        // the unsubscribe fn (matching the real onAuthStateChanged contract session.js relies on).
        onAuthStateChanged:             (_auth, cb) => { Promise.resolve().then(() => cb(_existingUser)); return () => {}; },
        nameToEmail:                    name => name.toLowerCase().replace(/\s+/g, '.') + '@myb.test',
        normaliseSurname:               name => name.split(/\s+/).slice(1).join('').toLowerCase().replace(/[^a-z]/g, ''),
        signInWithEmailAndPassword:     async () => { if (_signInBehavior !== 'ok') _authThrow(_signInBehavior); },
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
} = await import('./session.js');
const { nameToEmail } = await import('./firebase-client.js');
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
