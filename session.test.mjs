/**
 * Unit tests for session.js: constants, getSession, saveSession, clearSession,
 * resolveSession/sessionReady, and getSurname.
 * Run with: node --experimental-test-module-mocks --test session.test.mjs
 *
 * firebase-client.js is mocked (CDN imports, Firebase Auth).
 * ls.js is backed by an in-memory Map so tests can seed and inspect it.
 */

import { test, describe, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// In-memory store backing the ls.js mock.
const store = new Map();
let _signOutCalled = false;

mock.module('./firebase-client.js', {
    namedExports: {
        auth:                           { currentUser: null },
        authReady:                      Promise.resolve(),
        onAuthStateChanged:             () => () => {},
        nameToEmail:                    name => name.toLowerCase().replace(/\s+/g, '.') + '@myb.test',
        normaliseSurname:               name => name.split(/\s+/).slice(1).join('').toLowerCase().replace(/[^a-z]/g, ''),
        signInWithEmailAndPassword:     async () => {},
        createUserWithEmailAndPassword: async () => {},
        signInAnonymously:              async () => {},
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
} = await import('./session.js');

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
