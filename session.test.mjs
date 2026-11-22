/**
 * Unit tests for session.js: constants, getSession, saveSession, clearSession,
 * resolveSession/sessionReady, and the Firebase sign-in lifecycle.
 * Run with: node --experimental-test-module-mocks scripts/run-tests.mjs session.test.mjs
 *
 * firebase-client.js is mocked (CDN imports, Firebase Auth).
 * ls.js is backed by an in-memory Map so tests can seed and inspect it.
 */

import { test, describe, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// In-memory store backing the ls.js mock.
const store = new Map();
let _signOutCalled = false;
/** When set, the signOut mock REJECTS with this code — the viewer-shed fail-closed tests. A function
 *  of the call number gives each call its own answer ('ok' or a code). @type {string | ((n: number) => string)} */
let _signOutBehavior = 'ok';
let _signOutCalls = 0;
/** Ordered log of member-persistence restores (see the mock below). */
let _persistenceRestores = [];

// Controllable Firebase Auth mock state for the ensureFirebaseSession tests below.
// onAuthStateChanged yields _existingUser; each sign-in fn resolves when its behaviour is
// 'ok', otherwise rejects with an Error carrying that string as `.code`.
let _existingUser  = null;   // null | { isAnonymous, email }
let _signInBehavior = 'ok';  // 'ok' | error code string
let _createCalled  = false;  // did the code attempt browser-side account creation? (must never)
let _anonCalled    = false;  // did the code attempt an anonymous fallback? (must never)
let _signInCalls   = 0;      // how many times email/password sign-in was attempted (for retry tests)
/** Every password the sign-in mock was handed, in order — the fake RECORDS rather than discards, so
 *  a test can say which candidate went first (v26.12). Reset by the tests that read it. @type {string[]} */
let _signInPasswords = [];
let _onAuthSubs    = 0;      // how many times onAuthStateChanged was subscribed (primeAuth/fast-path tests)
/** Live onAuthStateChanged subscribers, so a test can deliver a LATER emission. @type {Set<Function>} */
const _authCbs = new Set();
let _authUnsubs    = 0;      // how many times the returned unsubscribe was called (restore-bound tests)
let _authNeverEmits = false; // when true the mock NEVER calls back — models a Firebase restore that hangs
let _authEmitDelayMs = 0;    // when >0 the mock answers this late — models a restore that arrives after the bound
/** The server's last admin reset for the member, as `probeResetAtMs` reports it: 0 = never, null =
 *  could not be confirmed, 'credential' = password rejected, a number = ms. Default 0 so every other
 *  test is unaffected. */
let _resetAtMs = /** @type {number|null|'credential'|'throttled'} */ (0);
let _probeCalls = 0;
/** @type {Promise<void>|null} */
let _signInGate    = null;   // if set, email/password sign-in awaits it before resolving (generation-guard test)
/** If set, a sign-out awaits it before its promise settles — the account is gone at once, as the SDK
 *  drops it at the call, and only the answer waits (the generation guard's sign-out race). @type {Promise<void>|null} */
let _signOutGate   = null;
/** If set, the reset probe awaits it before answering (the generation guard's probe race). @type {Promise<void>|null} */
let _probeGate     = null;
/** Every forced token refresh an account signed in by the fake was asked for, by its email. @type {string[]} */
const _idTokenForced = [];
const _authThrow = code => { const e = new Error(code); /** @type {any} */ (e).code = code; throw e; };

// Hoisted so the signOut mock can null currentUser (real Firebase clears it synchronously before
// signOut() resolves — the behaviour the calendar's anon bootstrap depends on), and so tests can
// mutate mockAuth.currentUser directly.
const mockAuth = { currentUser: /** @type {any} */ (null) };

/** The ONE boot restore, memoised — the mock's model of `authBootstrap` (v21.29).
 *  Reset via `_resetBootRestore()` between tests that count subscriptions. @type {Promise<void>|null} */
let _bootRestore = null;
const _resetBootRestore = () => { _bootRestore = null; };
/** The resolver of a boot restore modelled as HUNG (`_authNeverEmits`), kept so a test's teardown can
 *  end it (test audit, 7 Nov 2026). Unreleased, the hung restore held every caller's bound timer to
 *  its full length after the test had finished — 8 s for the reconcile that `holdsStaffPin(60)`
 *  races, which waits on `restoreFirstAuthUser()` at its default bound — and the file ran 8.7 s for
 *  0.7 s of tests. @type {null | (() => void)} */
let _releaseHungRestore = null;
/** Teardown for a test that hung the restore: end it with nobody signed in, and let whatever was
 *  waiting on it finish NOW, so it cannot run on into the next test's state. */
async function _settleHungRestore() {
    const release = _releaseHungRestore;
    _releaseHungRestore = null;
    if (!release) return;
    mockAuth.currentUser = null;
    release();
    await new Promise(r => setImmediate(r));
}
/** Subscribe once, on the first caller; every later caller awaits the same promise. Emission sets
 *  `currentUser` BEFORE resolving, which is what the real SDK does and what makes reading ground
 *  truth afterwards correct rather than lossy. */
function _bootOnce() {
    if (!_bootRestore) {
        _bootRestore = new Promise(resolve => {
            _onAuthSubs++;
            if (_authNeverEmits) { _releaseHungRestore = resolve; return; }   // never settles within the test — each caller's own bound decides; teardown ends it
            const emit = () => { mockAuth.currentUser = _existingUser; _authUnsubs++; resolve(); };
            if (_authEmitDelayMs) setTimeout(emit, _authEmitDelayMs);
            else Promise.resolve().then(emit);
        });
    }
    return _bootRestore;
}

mock.module('./firebase-client.js', {
    namedExports: {
        auth:                           mockAuth,
        authReady:                      Promise.resolve(),
        // The shared boot authority (v21.29). Returns GROUND TRUTH after the one restore, never the
        // remembered emission — see the real implementation in firebase-client.js for why.
        currentUserAfterBoot:           async (timeoutMs = 8000) => {
            if (mockAuth.currentUser) return mockAuth.currentUser;
            /** @type {any} */ let timer;
            await Promise.race([_bootOnce(), new Promise(r => { timer = setTimeout(r, timeoutMs); })]);
            clearTimeout(timer);
            return mockAuth.currentUser || null;
        },
        // Invoke the callback asynchronously with the configured existing user, then return
        // the unsubscribe fn (matching the real onAuthStateChanged contract session.js relies on).
        onAuthStateChanged:             (_auth, cb) => { _onAuthSubs++; _authCbs.add(cb); if (!_authNeverEmits) { if (_authEmitDelayMs) setTimeout(() => cb(_existingUser), _authEmitDelayMs); else Promise.resolve().then(() => cb(_existingUser)); } return () => { _authUnsubs++; _authCbs.delete(cb); }; },
        nameToEmail:                    name => name.toLowerCase().replace(/\s+/g, '.') + '@myb.test',
        normaliseSurname:               name => name.split(/\s+/).slice(1).join('').toLowerCase().replace(/[^a-z]/g, ''),
        // _signInBehavior may be a string (same every call) OR a function (callNumber, password → code),
        // which lets a test model a transient blip that clears on a later retry, or an ACCOUNT that
        // accepts one password and refuses every other.
        // A sign-in that SUCCEEDS leaves its account signed in, as the real SDK does — without it
        // `auth.currentUser` stayed whatever a test left there, so the late-sign-in guard's check of
        // WHOSE account is signed in had nothing to read, and inverting it changed no outcome.
        signInWithEmailAndPassword:     async (/** @type {any} */ _auth, /** @type {string} */ email, /** @type {string} */ pw) => {
            const n = ++_signInCalls; _signInPasswords.push(pw);
            if (_signInGate) await _signInGate;
            const b = typeof _signInBehavior === 'function' ? _signInBehavior(n, pw) : _signInBehavior;
            if (b !== 'ok') _authThrow(b);
            mockAuth.currentUser = { isAnonymous: false, email, getIdToken: async (/** @type {boolean} */ force) => { if (force) _idTokenForced.push(email); return 'token'; } };
        },
        // RECORDERS, not features. session.js no longer imports either (the account self-heal and the
        // anonymous fallback both ran only with `ENFORCE_NAMED_SESSION` off, retired v24.34). They
        // stay in the fake so that re-introducing either call is SEEN by the `_createCalled` /
        // `_anonCalled` assertions rather than failing as an unrelated import error.
        createUserWithEmailAndPassword: async () => { _createCalled = true; },
        signInAnonymously:              async () => { _anonCalled = true; mockAuth.currentUser = { isAnonymous: true }; },
        signOut:                        async () => {
            _signOutCalled = true;
            const b = typeof _signOutBehavior === 'function' ? _signOutBehavior(++_signOutCalls) : _signOutBehavior;
            if (b !== 'ok') { const e = new Error(b); /** @type {any} */ (e).code = b; throw e; }
            mockAuth.currentUser = null;
            if (_signOutGate) await _signOutGate;
        },
        // v20.12: `shedCalendarViewer` re-arms the long-lived MEMBER persistence chain after
        // dropping a shared Calendar viewer. Recorded rather than ignored so the ORDER (sign out,
        // THEN restore persistence) is assertable — reversing it would migrate the shared viewer
        // into IndexedDB, where it survives the browser closing.
        restoreMemberPersistence:       async () => { _persistenceRestores.push('member'); },
        probeResetAtMs:                 async () => { _probeCalls++; if (_probeGate) await _probeGate; return _resetAtMs; },
    },
});

// The push release an ending hold triggers (whole-app review, Oct 2026) — recorded WITH the identity
// current at the time, because the delete must happen while the departing member still holds it.
/** @type {any[]} */
const _pushReleases = [];
/** Runs INSIDE the release, so a test can land a login while it is in flight. @type {null | (() => any)} */
let _duringPushRelease = null;
mock.module('./notif.js', {
    namedExports: { releaseDevicePush: async () => { _pushReleases.push(auth.currentUser); if (_duringPushRelease) await _duringPushRelease(); } },
});

mock.module('./ls.js', {
    namedExports: {
        lsGet: k      => store.has(k) ? store.get(k) : null,
        lsSet: (k, v) => { store.set(k, String(v)); },
        lsDel: k      => { store.delete(k); },
    },
});

const {
    AUTH_KEY, SESSION_MS, SESSION_VER, AUTH_RESTORE_TIMEOUT_MS, restoreFirstAuthUser,
    sessionReady, resolveSession,
    getSession, saveSession, clearSession,
    ensureFirebaseSession, getFirebaseIdentity, firebaseSessionIsNamed, getFirebaseAuthError,
    ensureNamedSession, isTransientAuthError, refreshClaimsIfStale, primeAuth,
    reconcileExpiredIdentity, shedCalendarViewer,
} = await import('./session.js');
const { nameToEmail, auth } = await import('./firebase-client.js');
const { CONFIG } = await import('./roster-data.js');
// The SAME instance session.js imports: what reconcile tells it is what these tests hear.
const { onStaffPinEnded } = await import('./staff-pin-ended.js');
// The real (pure) auth store — session.js feeds it; these tests verify the Phase-2 bridge.
const { getAuthSnapshot, _resetAuthStateForTest } = await import('./auth-state.js');
const { CALENDAR_SNAPSHOT } = await import('./storage-keys.js');
// The REAL viewer uid — session.js imports `isViewerUser` from this module rather than keeping a
// second copy, so a fixture built from the constant cannot drift out of agreement with the predicate
// that decides whether an identity may be preserved.
const { CALENDAR_VIEWER_UID } = await import('./calendar-access-core.js');

// EVERY test is a fresh page load. The boot restore is memoised for a page's lifetime (v21.29) —
// which is the point of it — so one carried between tests would let an earlier test's identity
// answer a later test's question. Root-level, because that mistake is silent: the tests that caught
// it failed with "the stale anonymous session must be signed out first", which reads like a
// sign-out bug rather than a fixture leak.
// It clears `currentUser` too, because the mock now SETS it on emission — as the real SDK does,
// and as reading ground truth afterwards requires. Without that, a restored identity survived into
// the next test and answered its fast path.
beforeEach(() => {
    _resetBootRestore();
    mockAuth.currentUser = null;
    // The no-surname-default memory (v21.62) is DESIGNED to persist across page loads, which makes
    // it exactly the kind of state that leaks between tests: an implicit-rejection test would
    // silently empty the candidate ladder for every later implicit sign-in in the file. Cleared
    // here rather than per-describe so a new sign-in test can never inherit it by forgetting to.
    for (const k of [...store.keys()]) if (k.startsWith('myb_auth_nodefault_')) store.delete(k);
});

/** Wait until the sign-in mock has actually been ENTERED `n` times.
 *
 *  Replaces `for (let i = 0; i < 6; i++) await Promise.resolve()` (v21.29). Counting microtask
 *  ticks was never a synchronisation — it was a guess about how many awaits sat between
 *  `ensureFirebaseSession` and its sign-in call, and it silently became wrong the moment the boot
 *  restore stopped being a fresh subscription. The failure it produced was a superseded-attempt
 *  test reporting the WINNER as failed, which reads like a generation-guard bug. Wait for the
 *  event instead. */
async function signInEntered(n = 1, tries = 500) {
    for (let i = 0; i < tries && _signInCalls < n; i++) await new Promise(r => setTimeout(r, 1));
    if (_signInCalls < n) throw new Error(`sign-in was never entered ${n}x (saw ${_signInCalls})`);
}

// ── Constants ─────────────────────────────────────────────────────────────────

describe('constants', () => {
    test('SESSION_MS is exactly 60 days', () => {
        // 30 days until v20.47. Pinned as a literal on purpose: the value is a POLICY decision (how
        // long a member stays signed in on a device they hold), so a change to it must be a
        // deliberate two-line edit rather than something that rides along with a refactor. Several
        // things downstream reason FROM this number — the forced-password rollout window, and the
        // Usage card's sign-in figure — so a silent change would leave true-sounding prose behind it.
        assert.equal(SESSION_MS, 60 * 24 * 60 * 60 * 1000);
    });

    test('SESSION_VER is an integer >= 2', () => {
        assert.ok(Number.isInteger(SESSION_VER) && SESSION_VER >= 2);
    });

    test('AUTH_KEY is a non-empty string', () => {
        assert.ok(typeof AUTH_KEY === 'string' && AUTH_KEY.length > 0);
    });
});

// ── restoreFirstAuthUser: the bound ───────────────────────────────────────────
//
// Bounded at v20.52 (external review). It used to wait for ever for the first onAuthStateChanged
// emission, so every awaiting coordinator waited for ever with it. The property to pin is not
// "there is a timeout" but what the timeout DOES: resolve null, the answer every caller is already
// built to handle, rather than reject into two call sites that have no catch.
//
// ── AND SINCE v21.29 IT DELEGATES ───────────────────────────────────────────────────────────────
//
// It no longer opens a subscription of its own — it awaits the ONE boot restore
// (`currentUserAfterBoot` → `authBootstrap`). So the assertion that used to matter here ("it
// detaches its listener") has been replaced by the one that matters now: **N callers subscribe
// ONCE.** That is the property the change exists to deliver, and the old detach assertion could
// not have caught its absence — three modules each detaching their own listener passed it
// perfectly, which is exactly the state that produced the ~12.5s Calendar tail.
//
// The DETACH itself is now a property of `authBootstrap`, in firebase-client.js, which imports the
// gstatic SDK and so cannot load in Node. Noted rather than silently dropped.

describe('restoreFirstAuthUser', () => {
    beforeEach(() => {
        _authNeverEmits = false; _authEmitDelayMs = 0; _authUnsubs = 0; _onAuthSubs = 0;
        _existingUser = null; mockAuth.currentUser = null; _resetBootRestore();
    });
    afterEach(async () => { _authNeverEmits = false; _authEmitDelayMs = 0; mockAuth.currentUser = null; await _settleHungRestore(); });

    test('resolves with the restored user', async () => {
        _existingUser = { isAnonymous: false, email: 'g.miller@myb.test' };
        const u = await restoreFirstAuthUser();
        assert.equal(u, _existingUser);
    });

    test('a restore that NEVER answers resolves null at the bound', async () => {
        // The whole point: before this, an unanswered restore hung the caller for ever.
        _authNeverEmits = true;
        const t0 = Date.now();
        const u = await restoreFirstAuthUser(60);
        assert.equal(u, null, 'a hung restore must read as "nobody is signed in", not hang');
        assert.ok(Date.now() - t0 >= 55, 'it must actually have waited for the bound');
    });

    test('a LATE emission after the bound changes nothing', async () => {
        // Firebase answering at 9s must not overturn an answer already given at 8.
        _existingUser = { isAnonymous: false, email: 'late@myb.test' };
        _authEmitDelayMs = 80;
        const u = await restoreFirstAuthUser(20);
        assert.equal(u, null, 'the bound wins — the late user must not appear');
        await new Promise(r => setTimeout(r, 120));   // let the late emission land, harmlessly
    });

    test('MANY callers share ONE boot restore — the stacked-timeout fix', async () => {
        // THE regression this change exists to prevent. Before v21.29 each caller opened its own
        // subscription with its own ceiling, and on the Calendar two of them ran in sequence: 6.5s
        // for the reconcile, then a further 6s for the access decision's own restore. Neither bound
        // was wrong; adding them was, and nothing measured the addition.
        _existingUser = { isAnonymous: false, email: 'shared@myb.test' };
        const users = await Promise.all([
            restoreFirstAuthUser(), restoreFirstAuthUser(), restoreFirstAuthUser(),
        ]);
        assert.deepEqual(users, [_existingUser, _existingUser, _existingUser]);
        assert.equal(_onAuthSubs, 1, 'three callers must produce ONE subscription, not three');
    });

    test('a timed-out caller does not leave a second subscription behind', async () => {
        // The other half: timing out must not make the NEXT caller start again from scratch, or the
        // sharing evaporates in precisely the degraded case it was built for.
        _authEmitDelayMs = 80;
        _existingUser = { isAnonymous: false, email: 'slow@myb.test' };
        assert.equal(await restoreFirstAuthUser(20), null, 'first caller gives up at its bound');
        assert.equal(await restoreFirstAuthUser(200), _existingUser, 'the second sees the same restore land');
        assert.equal(_onAuthSubs, 1, 'still one subscription across both');
    });

    test('ground truth beats the remembered emission — a signed-out member stays signed out', async () => {
        // Returning `authBootstrap`'s snapshot would resurrect an identity that has since gone, and
        // `ensureFirebaseSession` would then believe a session exists when it does not.
        _existingUser = { isAnonymous: false, email: 'gone@myb.test' };
        assert.equal(await restoreFirstAuthUser(), _existingUser);
        mockAuth.currentUser = null;                       // signed out after boot
        assert.equal(await restoreFirstAuthUser(30), null, 'the boot snapshot must not bring them back');
    });

    test('the default bound is generous enough to be a hang, not a slow phone', () => {
        // Firing early on a merely-slow restore would tell a signed-in admin their session is gone.
        assert.equal(AUTH_RESTORE_TIMEOUT_MS, 8000);
    });

    test('ONE number: the boot restore and the typed sign-in\'s deadline import it, and spell no copy (review, Nov 2026)', async () => {
        // Three literal 8000s stood beside this constant; a change to one would have left two behind.
        const { readFileSync } = await import('node:fs');
        const silent = await import('./silent-sign-in.js');
        assert.equal(silent.AUTH_RESTORE_TIMEOUT_MS, AUTH_RESTORE_TIMEOUT_MS, 'session.js re-exports the one definition');
        for (const file of ['firebase-client.js', 'login-core.js']) {
            const src = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
            assert.match(src, /import \{[^}]*\bAUTH_RESTORE_TIMEOUT_MS\b[^}]*\} from '\.\/silent-sign-in\.js'/, `${file} does not import the shared bound`);
            assert.doesNotMatch(src, /\b8000\b|\b8_000\b/, `${file} spells its own 8000 again`);
        }
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

    test('a record with no NAME is no session, and is cleared (sign-in check, 11 Nov 2026)', () => {
        // Every caller derives the account from the name, so a nameless record threw inside
        // `ensureNamedSession` and the page offered no sign-in at all.
        for (const name of [undefined, '', '   ', 42]) {
            writeSession({ name });
            assert.equal(getSession(), null, `a session named ${JSON.stringify(name)} was accepted`);
            assert.equal(store.has(AUTH_KEY), false, 'the unusable record was left in storage');
        }
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

    // AN UNREADABLE EXPIRY IS AN EXPIRED ONE, NEVER AN ETERNAL ONE (v22.43).
    //
    // `Date.now() > undefined` is false, and so is every comparison against NaN — so each of these
    // used to pass the expiry check and hand back a session that could never expire. The 60-day cap
    // is the app's ONLY automatic revocation: nothing else ends a session but an explicit sign-out
    // or a disabled account. So of all the shapes corrupt storage can take, the one that must not
    // slip through is the one that switches that cap off.
    for (const [label, expiry] of [
        ['missing',        undefined],
        ['NaN',            NaN],
        ['a junk string',  'soon'],
        ['an ISO string',  new Date(Date.now() + 1000).toISOString()],
        ['an object',      {}],
        ['Infinity',       Infinity],
    ]) {
        test(`an expiry that is ${label} is treated as expired`, () => {
            writeSession({ expiry });
            assert.equal(getSession(), null, `expiry ${JSON.stringify(expiry)} must not grant a session`);
            assert.equal(store.get(AUTH_KEY), undefined, 'and the unusable session is cleared');
        });
    }

    test('…while a normal session is completely unaffected', () => {
        // The other direction: this must not become a fail-closed that closes on everybody.
        writeSession();
        assert.equal(getSession()?.name, 'G. Miller');
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
    // and they pin the property that REPLACED it: the absolute expiry is the only clock, and reading the session
    // does not move it.
    test('a long-untouched session is still valid inside its absolute window', () => {
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

    test('reading a session does not WRITE — and cannot extend the absolute expiry', () => {
        // getSession used to write back on every call to refresh the idle clock. With that clock
        // gone the write has no purpose, and its absence is worth pinning both ways: a localStorage
        // write on every page load of every page, and — the part that would be a real change of
        // policy — any future edit that let a read push `expiry` forward would quietly turn the
        // absolute bound into a rolling one.
        const written = writeSession();
        const raw = store.get(AUTH_KEY);
        const s = getSession();
        assert.ok(s !== null);
        assert.equal(store.get(AUTH_KEY), raw, 'a read must leave the stored session byte-identical');
        assert.equal(s.expiry, written.expiry, 'and must never move the absolute expiry');
    });

    test('a session expiring in 1 ms is valid until it has elapsed', (t) => {
        // The clock is FROZEN, and that is the point of the test rather than a convenience: on a
        // real clock, "valid until 1 ms from now" is only true if the read lands inside the same
        // millisecond, so a busy CI runner failed it (the v24.52 pull-request run, 5 Oct 2026).
        // Frozen, it asks the question it means — is expiry exclusive of the moment before it? —
        // and then steps the clock past it to prove the boundary is real.
        const now = Date.now();
        t.mock.method(Date, 'now', () => now);
        writeSession({ expiry: now + 1 });
        assert.ok(getSession() !== null, 'one millisecond before expiry, the session is valid');
        t.mock.method(Date, 'now', () => now + 2);
        assert.equal(getSession(), null, 'once it has elapsed, it is not');
    });
});

// ── reconcileExpiredIdentity (Finding #9) ─────────────────────────────────────
// A lingering NAMED Firebase identity whose local session has expired must be signed out; a valid
// session, an anonymous identity, and "no user" must all be left alone.

describe('reconcileExpiredIdentity', () => {
    const validSession = () => JSON.stringify({
        name: 'G. Miller', ver: SESSION_VER, expiry: Date.now() + SESSION_MS,
    });

    beforeEach(() => { store.clear(); _signOutCalled = false; _existingUser = null; _duringPushRelease = null; });
    afterEach(() => { auth.currentUser = null; _existingUser = null; _duringPushRelease = null; });   // don't leak identity into other tests

    test('releases the push record BEFORE the sign-out, while the expired member still holds it', async () => {
        _pushReleases.length = 0;
        const member = { isAnonymous: false, email: 'g.miller@myb.test' };
        auth.currentUser = /** @type {any} */ (member);
        await reconcileExpiredIdentity();
        assert.equal(_pushReleases.length, 1, 'an ending hold releases this device\'s push record');
        assert.equal(_pushReleases[0], member, 'and does it while the departing member is still the identity');
        assert.equal(_signOutCalled, true);
    });

    test('a sign-in that lands WHILE the push release runs is never signed straight out', async () => {
        // The release is a network round trip, and it is awaited BEFORE the sign-out — so a member
        // signing in on this device can complete inside it. The re-check after the release is the only
        // thing that stands reconcile down, and nothing exercised it (test audit, 7 Nov 2026: deleting
        // that line left all 127 tests here green). Without it the new member is signed out the moment
        // their sign-in lands, by a teardown that was about somebody else.
        auth.currentUser = /** @type {any} */ ({ isAnonymous: false, email: 'g.miller@myb.test' });
        _duringPushRelease = () => { store.set(AUTH_KEY, validSession()); };   // the login commits mid-release
        await reconcileExpiredIdentity();
        assert.equal(_signOutCalled, false, 'a login that landed during the release was signed out by the teardown');
    });

    test('a PIN unlock that lands WHILE the release runs is not signed out either (sign-in check, 11 Nov 2026)', async () => {
        // The Calendar's unlock moves no session generation, so the re-check above could not see it:
        // the sign-out after the release signed out whoever was current by then — the new viewer.
        auth.currentUser = /** @type {any} */ ({ isAnonymous: false, email: 'g.miller@myb.test' });
        _duringPushRelease = () => { auth.currentUser = /** @type {any} */ ({ uid: 'calendar-viewer', isAnonymous: false }); };
        await reconcileExpiredIdentity();
        assert.equal(_signOutCalled, false, 'the viewer that unlocked during the release was signed out');
    });

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

    // ── WHAT THE SIGN-IN CARD IS TOLD (v25.78) ──────────────────────────────────────────────────
    //
    // The page's sign-in card says "the roster is locked again" when arriving ended the staff PIN
    // (login-overlay.js → `sayStaffPinEnded`). It hears it through staff-pin-ended.js, and this
    // function is the only thing that tells it. Saying it to somebody whose MEMBER identity was ended
    // would be untrue: they never had the PIN. ORDER MATTERS in this file: the signal is sticky for
    // the module's life (a page's life, in the browser), so this runs before any viewer teardown.
    test('ending a MEMBER\'s lingering identity is not the staff PIN: the card is not told', async () => {
        let told = 0;
        const stop = onStaffPinEnded(() => { told += 1; });
        auth.currentUser = /** @type {any} */ ({ uid: 'uid-miller', isAnonymous: false, email: 'g.miller@myb.test' });
        await reconcileExpiredIdentity();
        assert.equal(_signOutCalled, true, 'the member identity WAS ended — the case this test is about');
        await Promise.resolve();
        assert.equal(told, 0, 'a member whose session expired never had the PIN; the card must not say it ended');
        stop();
    });

    // ── preserveCalendarViewer: the DEFAULT is the security half (v20.12) ──────────────────────
    //
    // The shared Calendar viewer is a non-anonymous Firebase identity with NO local session by
    // construction — exactly the shape this function exists to tear down — so the Calendar asks for
    // it to be kept, or the staff PIN would be demanded on every navigation. Six protected
    // coordinators (admin, settings, operations, links, paycalc, overtime) call this BARE and take
    // the default; the two pages that admit the PIN opt in — `calendar-access.js`, and Trains through
    // `holdsStaffPin` (v24.84, tested below), which calls it bare too once a member is signed in.
    //
    // PRESERVING TOO MUCH is the expensive direction and it is silent. Flip the default and a
    // station PC that entered the PIN and then opened Admin keeps that identity live instead of
    // shedding it — nothing errors, nothing renders differently, and the page's own login overlay
    // (driven by getSession(), which is null either way) still appears, so every end-to-end
    // assertion about the PAGE refusing goes on passing. Only an assertion about the IDENTITY can
    // see it. PRESERVING TOO LITTLE costs a PIN entry on the Calendar: visible, and self-correcting.
    //
    // The block the flag was missing until now was a VIEWER fixture, not a bare call — the cases
    // above call bare all the time, but always with a named identity, where the flag cannot bite.
    const viewerUser = { uid: CALENDAR_VIEWER_UID, isAnonymous: false, email: null };

    // These two run BEFORE any other viewer teardown here, because what they watch is sticky (see
    // "WHAT THE SIGN-IN CARD IS TOLD" above): the first is the only moment a card can be waiting.
    test('a sign-out that FAILS ends nothing, and no card is told the roster is locked', async () => {
        let told = 0;
        const stop = onStaffPinEnded(() => { told += 1; });
        auth.currentUser = /** @type {any} */ (viewerUser);
        _signOutBehavior = 'auth/network-request-failed';
        try {
            await reconcileExpiredIdentity();
        } finally { _signOutBehavior = 'ok'; }
        assert.equal(_signOutCalled, true, 'the sign-out WAS attempted — the case this test is about');
        await Promise.resolve();
        assert.equal(told, 0, 'the roster is still open behind them; saying it is locked would be untrue');
        stop();
    });

    test('ending the PIN tells the card — waiting, or mounted after — and one broken card stops no other', async () => {
        // A listener that throws is registered FIRST, so the one after it is told only if the throw
        // is contained (staff-pin-ended.js → `noteStaffPinEnded`). It is also inside reconcile's own
        // try, where an escaped throw would be logged as a failed sign-out.
        onStaffPinEnded(() => { throw new Error('a broken card'); });
        let waiting = 0;
        const stopWaiting = onStaffPinEnded(() => { waiting += 1; });   // the card is up first: the usual order
        auth.currentUser = /** @type {any} */ (viewerUser);
        await reconcileExpiredIdentity();
        assert.equal(auth.currentUser, null, 'the teardown landed — the case this test is about');
        assert.equal(waiting, 1, 'a card already up hears it when the teardown lands, once, despite the broken one');

        // A card mounted AFTER the teardown still hears it — on a microtask, never inside the subscribe.
        let late = 0;
        onStaffPinEnded(() => { late += 1; });
        assert.equal(late, 0, 'never synchronously inside the call that subscribed');
        await Promise.resolve();
        assert.equal(late, 1);

        // …and a card gone before that microtask (signed in, rebuilt) is not called at all.
        let gone = 0;
        const stopGone = onStaffPinEnded(() => { gone += 1; });
        stopGone();
        await Promise.resolve();
        assert.equal(gone, 0, 'unsubscribing must cancel a call already queued');

        // The waiting card was told once and is not told again by a later teardown.
        auth.currentUser = /** @type {any} */ (viewerUser);
        await reconcileExpiredIdentity();
        await Promise.resolve();
        assert.equal(waiting, 1, 'each card is told once');
        stopWaiting();
    });

    test('the DEFAULT sheds the shared viewer — a bare call is a protected page, not the Calendar', async () => {
        auth.currentUser = /** @type {any} */ (viewerUser);
        // store empty → no local session, which is the viewer's permanent condition
        await reconcileExpiredIdentity();
        assert.equal(_signOutCalled, true,
            'a PIN identity must not survive into Admin/Settings/Operations/Links/Pay/Overtime');
        assert.equal(auth.currentUser, null, 'and must actually be gone, not merely decided against');
    });

    // The PIN owns no push record, so a release there could only drop THIS BROWSER's own subscription —
    // a member who used the PIN on their own phone found notifications off after signing back in — and
    // it held up the "locked again" notice by up to two seconds (audit C3). A member's is still released.
    test('shedding the PIN releases NO push record — there is none, and the browser\'s subscription is not its to drop', async () => {
        _pushReleases.length = 0;
        auth.currentUser = /** @type {any} */ (viewerUser);
        await reconcileExpiredIdentity();
        assert.equal(_signOutCalled, true, 'premise: the PIN was signed out here');
        await new Promise(r => setTimeout(r, 20));   // a release is a dynamic import: give it time to land
        assert.equal(_pushReleases.length, 0, 'the staff PIN\'s teardown dropped the browser\'s push subscription');
    });

    // ENDING THE PIN LEAVES THIS TAB'S CALENDAR A MARK (audit B3): the card says "go back and enter the
    // PIN", and the phone's Back carries no `#staff-pin`. staff-pin-ended.js writes it as it tells the
    // card; the Calendar's boot takes it once (calendar-access.test.mjs drives that half).
    test('ending the PIN leaves a one-tab mark, read once; a member\'s teardown leaves none; a sign-in forgets it', async () => {
        const { takeStaffPinEndedMark, forgetStaffPinEnded } = await import('./staff-pin-ended.js');
        /** @type {Map<string,string>} */ const tab = new Map();
        /** @type {any} */ (globalThis).sessionStorage = { getItem: (/** @type {string} */ k) => tab.get(k) ?? null,
            setItem: (/** @type {string} */ k, /** @type {string} */ v) => { tab.set(k, String(v)); }, removeItem: (/** @type {string} */ k) => { tab.delete(k); } };
        try {
            auth.currentUser = /** @type {any} */ ({ uid: 'uid-miller', isAnonymous: false, email: 'g.miller@myb.test' });
            await reconcileExpiredIdentity();
            assert.equal(takeStaffPinEndedMark(), false, 'a member whose session expired never had the PIN');
            auth.currentUser = /** @type {any} */ (viewerUser);
            await reconcileExpiredIdentity();
            assert.equal(auth.currentUser, null, 'premise: the PIN was signed out here');
            assert.equal(takeStaffPinEndedMark(), true, 'the Calendar in this tab was not told the PIN ended');
            assert.equal(takeStaffPinEndedMark(), false, 'read once: the mark outlived the boot that took it');
            auth.currentUser = /** @type {any} */ (viewerUser);
            await reconcileExpiredIdentity();
            forgetStaffPinEnded();
            assert.equal(tab.size, 0, 'a member signed in here, and the mark still sent the next Calendar to the PIN box');
            const refuse = () => { throw new Error('SecurityError'); };
            /** @type {any} */ (globalThis).sessionStorage = { getItem: refuse, setItem: refuse, removeItem: refuse };
            auth.currentUser = /** @type {any} */ (viewerUser);
            await reconcileExpiredIdentity();   // iOS private mode: no mark, and nothing thrown
            assert.equal(takeStaffPinEndedMark(), false);
        } finally { delete /** @type {any} */ (globalThis).sessionStorage; }
    });

    // A PAGE WITH NO SIGN-IN CARD SAYS IT TOO (audit C1): paused Overtime offers none, and only a card
    // listened, so it signed the PIN out in silence. Its line: the card's own sentence and way back, in a
    // status region that is in the page — empty — before the teardown lands, so the words are announced.
    test('sayStaffPinEndedIn: the region is there at once and empty; the teardown fills it with the card\'s words and the PIN box', async () => {
        const { sayStaffPinEndedIn, STAFF_PIN_ENDED_NOTICE, BACK_TO_PIN, forgetStaffPinEnded } = await import('./staff-pin-ended.js');
        forgetStaffPinEnded();   // earlier tests here ended the PIN; this page has not, yet
        const made = (/** @type {string} */ tag) => {
            /** @type {any} */ const el = { tag, kids: /** @type {any[]} */ ([]), attrs: /** @type {Record<string,string>} */ ({}), isConnected: true,
                setAttribute(/** @type {string} */ k, /** @type {string} */ v) { el.attrs[k] = v; },
                appendChild(/** @type {any} */ c) { el.kids.push(c); return c; },
                append(/** @type {any[]} */ ...xs) { el.kids.push(...xs); } };
            return el;
        };
        /** @type {any} */ (globalThis).document = { createElement: made };
        try {
            const host = made('div');
            sayStaffPinEndedIn(host);
            const region = host.kids[0];
            assert.equal(region?.attrs.role, 'status', 'no live region was put in the page before the teardown');
            assert.deepEqual(region.kids, [], 'the region said something before the PIN had ended');
            auth.currentUser = /** @type {any} */ (viewerUser);
            await reconcileExpiredIdentity();
            await new Promise(r => setTimeout(r, 0));   // the words go in once the region has been drawn (below)
            const [line] = region.kids;
            assert.equal(line?.kids[0], STAFF_PIN_ENDED_NOTICE + ' ', 'the page did not say the PIN ended');
            assert.equal(line.kids[1].href, BACK_TO_PIN);
            assert.equal(BACK_TO_PIN, './#staff-pin', 'the way back is not the Calendar\'s PIN box');
            assert.equal(sayStaffPinEndedIn(null)(), undefined, 'a page with nowhere to say it draws nothing and throws nothing');
        } finally { delete /** @type {any} */ (globalThis).document; }
    });

    // …AND IS HEARD WHEN THE PIN ENDED FIRST (17 Nov 2026). The usual order is region, then teardown, and a
    // write then is a change. But a page drawn AFTER the teardown — paused Overtime reached a second time,
    // or drawn late — met a listener that ran on a microtask of the very task that put the region there:
    // the same task, so a region created with its words, which nobody hears. The words now wait for the
    // browser to draw the region empty (`speakAfterMount`, status-text.js): a frame, and then a task.
    test('sayStaffPinEndedIn: when the PIN has ALREADY ended, the words wait for the region to be drawn — and stop() cancels them', async () => {
        const { sayStaffPinEndedIn, STAFF_PIN_ENDED_NOTICE, forgetStaffPinEnded } = await import('./staff-pin-ended.js');
        forgetStaffPinEnded();
        const made = (/** @type {string} */ tag) => {
            /** @type {any} */ const el = { tag, kids: /** @type {any[]} */ ([]), attrs: /** @type {Record<string,string>} */ ({}), isConnected: true,
                setAttribute(/** @type {string} */ k, /** @type {string} */ v) { el.attrs[k] = v; },
                appendChild(/** @type {any} */ c) { el.kids.push(c); return c; },
                append(/** @type {any[]} */ ...xs) { el.kids.push(...xs); } };
            return el;
        };
        /** @type {Array<(t: number) => void>} */ const frames = [];
        /** @type {any} */ (globalThis).document = { createElement: made };
        /** @type {any} */ (globalThis).requestAnimationFrame = (/** @type {(t: number) => void} */ cb) => { frames.push(cb); return frames.length; };
        const drawFrame = () => { for (const cb of frames.splice(0)) cb(0); };
        const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };   // every microtask of this task
        try {
            auth.currentUser = /** @type {any} */ (viewerUser);
            await reconcileExpiredIdentity();   // the PIN ends BEFORE the page draws its region

            const host = made('div');
            sayStaffPinEndedIn(host);
            const region = host.kids[0];
            await settle();
            assert.deepEqual(region.kids, [],
                'written in the task that put the region on the page — a live region created with its words is read by nobody');
            assert.equal(frames.length, 1, 'nothing waited for the browser to draw the region');
            drawFrame();
            assert.deepEqual(region.kids, [], 'written inside the frame, before the region it fills has been drawn');
            await new Promise(r => setTimeout(r, 0));
            assert.equal(region.kids[0]?.kids[0], STAFF_PIN_ENDED_NOTICE + ' ', 'the page never said the PIN ended');

            // stop() between the listener and the frame: nothing is written (the page has moved on).
            const host2 = made('div');
            const stop = sayStaffPinEndedIn(host2);
            await settle();
            stop();
            drawFrame();
            await new Promise(r => setTimeout(r, 0));
            assert.deepEqual(host2.kids[0].kids, [], 'a line was written after the page stopped listening');

            // The region taken off the page before it is drawn: nothing is written into a detached box.
            const host3 = made('div');
            sayStaffPinEndedIn(host3);
            await settle();
            host3.kids[0].isConnected = false;
            drawFrame();
            await new Promise(r => setTimeout(r, 0));
            assert.deepEqual(host3.kids[0].kids, [], 'a line was written into a region no longer on the page');
        } finally {
            delete /** @type {any} */ (globalThis).document;
            delete /** @type {any} */ (globalThis).requestAnimationFrame;
            forgetStaffPinEnded();
        }
    });

    test('an explicit opts object with the flag ABSENT is still a teardown', async () => {
        // A caller that passes options for some other reason must not inherit preservation.
        auth.currentUser = /** @type {any} */ (viewerUser);
        await reconcileExpiredIdentity({});
        assert.equal(_signOutCalled, true);
    });

    test('only the Calendar\'s opt-in keeps it — and only for the viewer itself', async () => {
        // The visible direction, pinned so a fix for the above cannot be "never preserve".
        auth.currentUser = /** @type {any} */ (viewerUser);
        await reconcileExpiredIdentity({ preserveCalendarViewer: true });
        assert.equal(_signOutCalled, false, 'the Calendar would otherwise re-demand the PIN on every open');

        // …and the opt-in is scoped to the viewer UID. A named identity whose session has expired is
        // torn down even on the Calendar, or the flag becomes a general amnesty.
        _signOutCalled = false;
        auth.currentUser = /** @type {any} */ ({ uid: 'uid-miller', isAnonymous: false, email: 'g.miller@myb.test' });
        await reconcileExpiredIdentity({ preserveCalendarViewer: true });
        assert.equal(_signOutCalled, true, 'preserveCalendarViewer must never preserve a MEMBER identity');
    });
});

// ── ensureFirebaseSession identity tracking (B0) ──────────────────────────────
// B0 (SECURITY_RELEASE_PLAN.md): ensureFirebaseSession now records whether it established
// the member's NAMED identity or none at all (the anonymous fallback it once recorded went with the
// `ENFORCE_NAMED_SESSION` switch, retired v24.34).
// firebaseSessionIsNamed() is the signal per-member write isolation (B2) will depend on.

describe('ensureFirebaseSession identity tracking', () => {
    beforeEach(() => {
        _existingUser   = null;
        _signInBehavior = 'ok';
        _signOutCalled  = false;
        _createCalled   = false;
        _anonCalled     = false;
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

    test("a NON-credential failure (provider disabled) → false / 'none', NEVER an anonymous session", async () => {
        // Until v24.34 this was the one path that fell back to `signInAnonymously` (with the
        // `ENFORCE_NAMED_SESSION` switch off). The strict rules refuse every write such a session
        // could make, so a "success" here would be a page that looks signed in and saves nothing.
        _signInBehavior = 'auth/operation-not-allowed';
        const ok = await ensureFirebaseSession('G. Miller');
        assert.equal(ok, false, 'a nameless session must not be reported as a session');
        assert.equal(getFirebaseIdentity(), 'none');
        assert.equal(firebaseSessionIsNamed(), false);
        assert.equal(getFirebaseAuthError(), 'auth/operation-not-allowed');
        assert.equal(_anonCalled, false, 'no anonymous fallback');
    });

    test("PASSWORD_DESIGN §3.3: a CREDENTIAL rejection does NOT fall back to anonymous → 'none'", async () => {
        _signInBehavior = 'auth/invalid-credential';
        const ok = await ensureFirebaseSession('G. Miller');
        assert.equal(ok, false);
        assert.equal(getFirebaseIdentity(), 'none');
        assert.equal(_anonCalled, false, 'a wrong password must never become an anonymous session');
    });

    /** An account that accepts exactly one password, as Firebase does — the fake answers by WHAT it
     *  is handed, not by call number, so the ORDER of the attempts is what a test sees.
     *  @param {string} password */
    const accountWithPassword = (password) => (/** @type {number} */ _n, /** @type {string} */ pw) =>
        (pw === password ? 'ok' : 'auth/invalid-credential');

    test('gated dual-attempt (v26.12): a typed MIXED-CASE surname signs an un-migrated member in with ONE request — the default first', async () => {
        // The account is on its surname default "miller". Raw-first sent "Miller" ahead of it — a
        // request that could never succeed, and a wrong password logged at Google.
        _signInCalls = 0; _signInPasswords = [];
        _signInBehavior = accountWithPassword('miller');
        const ok = await ensureFirebaseSession('G. Miller', undefined, 'Miller');
        assert.equal(ok, true);
        assert.equal(getFirebaseIdentity(), 'named');
        assert.deepEqual(_signInPasswords, ['miller'], 'the default first, and nothing after it');
    });

    test('gated dual-attempt (v26.12): a SHORT surname typed as the form asks signs in with ONE request — the padded default', async () => {
        // "Your surname in lowercase", says the form. For a surname under six letters that is never
        // the password: the default is padded ("bibi" → "bibibi"). Every such sign-in paid a doomed
        // first request before v26.12.
        _signInCalls = 0; _signInPasswords = [];
        _signInBehavior = accountWithPassword('bibibi');
        const ok = await ensureFirebaseSession('T. Bibi', undefined, 'bibi');
        assert.equal(ok, true);
        assert.equal(getFirebaseIdentity(), 'named');
        assert.deepEqual(_signInPasswords, ['bibibi']);
    });

    test('gated dual-attempt: a member with a CHOSEN password who types their surname is refused after both — the typed value is still tried', async () => {
        // The pair is unchanged, so what can sign in is unchanged: the default is refused (the
        // account has moved on), the typed value is tried after it, and both refusals end in 'none'.
        _signInCalls = 0; _signInPasswords = [];
        _signInBehavior = accountWithPassword('a-chosen-passphrase');
        const ok = await ensureFirebaseSession('G. Miller', undefined, 'Miller');
        assert.equal(ok, false);
        assert.equal(getFirebaseIdentity(), 'none');
        assert.deepEqual(_signInPasswords, ['miller', 'Miller']);
    });

    test('gated dual-attempt: a NETWORK failure on the default stops there — the typed value is not sent behind it', async () => {
        // §3.2's other half: the second attempt follows only a definitive rejection.
        _signInCalls = 0; _signInPasswords = [];
        _signInBehavior = 'auth/network-request-failed';
        const ok = await ensureFirebaseSession('G. Miller', undefined, 'Miller');
        assert.equal(ok, false);
        assert.deepEqual(_signInPasswords, ['miller']);
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

// ── the no-surname-default memory (v21.62) ────────────────────────────────────
// Every implicit re-establishment used to fire the derived surname unconditionally — for a
// MIGRATED member a GUARANTEED wrong-password, once per locked load, from every device, all of it
// through the station's ONE NAT address. Firebase's abuse protection throttles by IP as well as by
// account, so enough of those and a member's CORRECT typed password starts bouncing with
// `auth/too-many-requests` — which staff experience as "the app keeps asking and won't take my
// password". The tests are organised by the two ways the memory could be WRONG: firing when it
// cannot succeed (the defect it exists to stop), and suppressing an attempt that COULD succeed
// (a stale flag after provisioning or an admin reset — which is why user-not-found never sets it
// and a surname success always clears it).
describe('the no-surname-default memory (v21.62)', () => {
    const FLAG = 'myb_auth_nodefault_G. Miller';
    beforeEach(() => {
        _existingUser   = null;
        _signInBehavior = 'ok';
        _signInCalls    = 0;
        _anonCalled     = false;
    });

    test('a rejected implicit surname is remembered, and the next implicit attempt fires NOTHING', async () => {
        _signInBehavior = 'auth/invalid-credential';
        assert.equal(await ensureFirebaseSession('G. Miller'), false);
        assert.equal(_signInCalls, 1, 'the first attempt is genuine — the device cannot know yet');
        assert.ok(Number(store.get(FLAG)) > Date.now() - 60_000, 'the rejection was not remembered, with when');

        // The next locked load on this device: same doomed candidate, so no request at all.
        assert.equal(await ensureFirebaseSession('G. Miller'), false);
        assert.equal(_signInCalls, 1, 'the doomed surname attempt was repeated');
        assert.equal(getFirebaseIdentity(), 'none');
        assert.equal(_anonCalled, false, 'an empty ladder must resolve as a definitive rejection, never anonymous');
    });

    test('user-not-found does NOT set it — provisioning would make the surname valid', async () => {
        _signInBehavior = 'auth/user-not-found';
        assert.equal(await ensureFirebaseSession('G. Miller'), false);
        assert.ok(!store.has(FLAG), 'an unprovisioned account was remembered as migrated');
        // And the attempt genuinely repeats — after Set up accounts runs, this is the recovery.
        assert.equal(await ensureFirebaseSession('G. Miller'), false);
        assert.equal(_signInCalls, 2, 'the implicit attempt was suppressed with no flag set');
    });

    test('a sign-in that SUCCEEDS with the surname clears it — the admin-reset recovery costs one typed login', async () => {
        store.set(FLAG, '1');   // this device believes the member is migrated…
        // …but the admin has since reset the account to the default, and the member types their
        // surname at the overlay (which is what the reset flow tells them to do).
        const ok = await ensureFirebaseSession('G. Miller', undefined, 'miller');
        assert.equal(ok, true);
        assert.ok(!store.has(FLAG), 'the memory outlived the surname default becoming valid again');
        // The silent recovery is re-armed: the next implicit attempt fires and succeeds.
        _signInCalls = 0;
        mockAuth.currentUser = null;
        assert.equal(await ensureFirebaseSession('G. Miller'), true);
        assert.equal(_signInCalls, 1, 'the implicit attempt stayed suppressed after the surname worked');
    });

    // A FLAGGED device never tried the surname, so the reset check in front of it never ran either,
    // and an admin reset left its 60-day session standing (invariant 23; sign-in check, 11 Nov 2026).
    describe('…and a flagged device still asks about a reset, at most every 6 hours', () => {
        const AUTH_KEY_ = 'myb_admin_session';
        beforeEach(() => { _probeCalls = 0; _resetAtMs = 0; });
        afterEach(() => { _resetAtMs = 0; store.delete(AUTH_KEY_); store.delete(FLAG); });
        const sessionFrom = (/** @type {number} */ ms) =>
            store.set(AUTH_KEY_, JSON.stringify({ name: 'G. Miller', ver: 2, expiry: ms + 60 * 86_400_000, createdAt: ms }));

        test('a reset newer than the session ends it — with no SDK sign-in', async () => {
            store.set(FLAG, '1');                                 // a flag from before v25.77: long ago
            sessionFrom(Date.now() - 3 * 86_400_000);
            _resetAtMs = Date.now() - 86_400_000;
            assert.equal(await ensureFirebaseSession('G. Miller'), false);
            assert.equal(_probeCalls, 1, 'the flagged device never asked about the reset');
            assert.equal(_signInCalls, 0);
            assert.equal(store.has(AUTH_KEY_), false, 'the reset left this device\'s session standing');
        });

        test('a surname still refused notes when it asked, and fires nothing more', async () => {
            store.set(FLAG, String(Date.now() - 7 * 3_600_000));
            sessionFrom(Date.now() - 86_400_000);
            _resetAtMs = 'credential';
            assert.equal(await ensureFirebaseSession('G. Miller'), false);
            assert.equal(_probeCalls, 1);
            assert.equal(_signInCalls, 0, 'the recheck repeated the doomed sign-in after the probe had answered');
            assert.ok(Number(store.get(FLAG)) > Date.now() - 60_000, 'the flag did not note the recheck');
            assert.equal(store.has(AUTH_KEY_), true, 'nothing was reset, so nothing may be ended');
            // Asked within the 6 hours: nothing at all.
            assert.equal(await ensureFirebaseSession('G. Miller'), false);
            assert.equal(_probeCalls, 1, 'a flagged device asked again inside 6 hours');
        });

        // The station's addresses share one lock-out, so a recheck must not keep it going (review, 11 Nov 2026).
        test('a THROTTLED recheck notes when it asked too, so the next load does not ask again', async () => {
            store.set(FLAG, String(Date.now() - 7 * 3_600_000));
            sessionFrom(Date.now() - 86_400_000);
            _resetAtMs = 'throttled';
            assert.equal(await ensureFirebaseSession('G. Miller'), false);
            assert.equal(_probeCalls, 1);
            assert.ok(Number(store.get(FLAG)) > Date.now() - 60_000, 'a throttled recheck was not noted');
            assert.equal(await ensureFirebaseSession('G. Miller'), false);
            assert.equal(_probeCalls, 1, 'the next load asked again while the station was throttled');
        });

        test('an UNANSWERED recheck is asked once per attempt, not on each retry — and the next attempt asks again', async () => {
            store.set(FLAG, String(Date.now() - 7 * 3_600_000));
            sessionFrom(Date.now() - 86_400_000);
            _resetAtMs = null;
            assert.equal(await ensureNamedSession('G. Miller', { delayMs: 0, retries: 2 }), false);
            assert.equal(_probeCalls, 1, `one attempt and its retries asked ${_probeCalls} times`);
            assert.equal(getFirebaseAuthError(), 'auth/reset-check-unavailable', 'it must end transient, keeping the 60-day session');
            assert.ok(Number(store.get(FLAG)) < Date.now() - 6 * 3_600_000, 'no answer was noted as one, so the next load would read it as refused');
            assert.equal(await ensureNamedSession('G. Miller', { delayMs: 0, retries: 0 }), false);
            assert.equal(_probeCalls, 2, 'a new sign-in attempt did not ask');
        });
    });

    test('a typed password is NEVER gated by it — and a custom-password success does not clear it', async () => {
        store.set(FLAG, '1');
        const ok = await ensureFirebaseSession('G. Miller', undefined, 'Str0ng!pass');
        assert.equal(ok, true);
        assert.equal(_signInCalls, 1, 'the typed attempt was suppressed — the flag may only gate implicit ones');
        assert.equal(store.get(FLAG), '1',
            'a custom-password success cleared the memory — the surname is still wrong for this account');
    });
});

// ── silent-sign-in.js — the same rules, as plain values (extracted from session.js, Nov 2026) ─────
// The describe above drives them through the real sign-in; this pins each rule on its own, so a change
// to one says which rule moved rather than which sign-in now behaves differently.
const silentRules = await import('./silent-sign-in.js');
const { noDefaultKey, RESET_RECHECK_MS, planSilentAttempt, afterRecheck, remembersRefusal } = silentRules;
describe('silent-sign-in.js — what the sign-in nobody typed may try', () => {
    const NOW = 1_800_000_000_000;
    const plan = (/** @type {string|null} */ stored, unansweredThisAttempt = false, surname = 'miller') =>
        planSilentAttempt({ surname, stored, now: NOW, unansweredThisAttempt });

    test('the memory is per member, under the key the sign-in tests read', () => {
        assert.equal(noDefaultKey('G. Miller'), 'myb_auth_nodefault_G. Miller');
    });

    test('nothing remembered: the surname, and no recheck', () => {
        assert.deepEqual(plan(null), { candidates: ['miller'], recheck: false, held: false });
    });

    test('refused within six hours: nothing at all — the request could only fail', () => {
        assert.deepEqual(plan(String(NOW - RESET_RECHECK_MS + 1)), { candidates: [], recheck: false, held: false });
    });

    test('refused more than six hours ago — or a pre-v25.77 "1" — asks again about a reset', () => {
        assert.deepEqual(plan(String(NOW - RESET_RECHECK_MS - 1)), { candidates: ['miller'], recheck: true, held: false });
        assert.deepEqual(plan('1'), { candidates: ['miller'], recheck: true, held: false });
    });

    test('six hours means six hours, written out — the tests above lean on the constant (review, Nov 2026)', () => {
        // Measured against the constant, a constant of a few milliseconds passed them all, and a
        // flagged device asked on every load: from the station's one address, the request pattern
        // Firebase throttles, refusing members' CORRECT typed passwords (this module's header).
        const HOUR = 60 * 60 * 1000;
        assert.equal(plan(String(NOW - HOUR)).recheck, false, 'asked again an hour after a refusal');
        assert.equal(plan(String(NOW - 6 * HOUR)).recheck, false, 'asked again AT six hours — the rule is "more than"');
        assert.equal(plan(String(NOW - 6 * HOUR - 1)).recheck, true, 'not asked once six hours had passed');
    });

    test('a recheck this attempt already asked, unanswered, is held — but only a recheck', () => {
        assert.deepEqual(plan('1', true), { candidates: [], recheck: true, held: true });
        assert.deepEqual(plan(null, true), { candidates: ['miller'], recheck: false, held: false }, 'nothing remembered is not a recheck');
    });

    test('a name with no surname to try tries nothing', () => {
        assert.deepEqual(plan(null, false, ''), { candidates: [], recheck: false, held: false });
    });

    test('a recheck\'s answer: a refusal is noted and stops, a throttle is noted, no answer is held', () => {
        assert.deepEqual(afterRecheck('credential'), { note: true, stop: true, unanswered: false });
        assert.deepEqual(afterRecheck('throttled'), { note: true, stop: false, unanswered: false });
        assert.deepEqual(afterRecheck(null), { note: false, stop: false, unanswered: true });
        assert.deepEqual(afterRecheck(NOW), { note: false, stop: false, unanswered: false });
    });

    test('a session starts at the server\'s record of the sign-in — within three days of the device, on the member\'s own account', () => {
        const { sessionStartMs, SIGN_IN_CLOCK_SKEW_MS } = silentRules;
        const me = 'g.miller@myb-roster.local';
        const user = (/** @type {number} */ at, email = me) => ({ email, metadata: { lastSignInTime: new Date(at).toUTCString() } });
        assert.equal(sessionStartMs(user(NOW - SIGN_IN_CLOCK_SKEW_MS), me, NOW), NOW - SIGN_IN_CLOCK_SKEW_MS, 'three days away is still this sign-in');
        assert.equal(sessionStartMs(user(NOW + SIGN_IN_CLOCK_SKEW_MS), me, NOW), NOW + SIGN_IN_CLOCK_SKEW_MS);
        assert.equal(sessionStartMs(user(NOW - SIGN_IN_CLOCK_SKEW_MS - 1000), me, NOW), NOW, 'further is not');
        assert.equal(sessionStartMs(user(NOW - 1000, 's.silva@myb-roster.local'), me, NOW), NOW, 'another account says nothing about this session');
        for (const odd of [null, undefined, {}, { email: me }, { email: me, metadata: { lastSignInTime: 'not a date' } }]) {
            assert.equal(sessionStartMs(odd, me, NOW), NOW, JSON.stringify(odd));
        }
    });

    // THE ALLOWANCE IS THREE DAYS — PINNED IN DAYS, NOT IN THE CONSTANT (17 Nov 2026). Every line above is
    // written in SIGN_IN_CLOCK_SKEW_MS, so the allowance could become two days or four with all of them
    // still green. Two would hand a phone whose clock is between two and three days out back to its own
    // clock — the reset-dodge this exists to close (silent-sign-in.js, sign-in audit A2); four would trust
    // a record further from the device than the module accepts as this sign-in's own.
    test('the clock allowance is three days, either side, to the minute', () => {
        const { sessionStartMs } = silentRules;
        const DAY = 86_400_000, MINUTE = 60_000;
        const me = 'g.miller@myb-roster.local';
        const user = (/** @type {number} */ at) => ({ email: me, metadata: { lastSignInTime: new Date(at).toUTCString() } });
        assert.equal(sessionStartMs(user(NOW - 3 * DAY), me, NOW), NOW - 3 * DAY, 'a record three days behind the device still dates the session');
        assert.equal(sessionStartMs(user(NOW + 3 * DAY), me, NOW), NOW + 3 * DAY, 'and three days ahead');
        assert.equal(sessionStartMs(user(NOW - 3 * DAY - MINUTE), me, NOW), NOW, 'a minute more than three days behind does not');
        assert.equal(sessionStartMs(user(NOW + 3 * DAY + MINUTE), me, NOW), NOW, 'nor a minute more than three days ahead');
    });

    test('only a definitive refusal of an account that EXISTS is remembered', () => {
        for (const code of ['auth/invalid-credential', 'auth/wrong-password', 'auth/invalid-login-credentials']) assert.equal(remembersRefusal(code), true, code);
        for (const code of ['auth/user-not-found', 'auth/network-request-failed', 'auth/too-many-requests', undefined]) assert.equal(remembersRefusal(code), false, String(code));
    });
});

// ── ensureFirebaseSession requires the member's OWN named session (B1.1) ──────
// B1.1 (SECURITY_RELEASE_PLAN.md): write pages require the member's OWN named session —
// ensureFirebaseSession must NOT create accounts and must NOT fall back to an anonymous session;
// a failed named sign-in returns false / 'none' so the page can prompt a re-login. This was the
// `ENFORCE_NAMED_SESSION: true` branch; the switch was retired at v24.34 and it is the only one.
describe('ensureFirebaseSession never self-heals or falls back (B1.1)', () => {
    beforeEach(() => {
        _existingUser   = null;
        _signInBehavior = 'ok';
        _signOutCalled  = false;
        _createCalled   = false;
        _anonCalled     = false;
    });

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
        assert.equal(_createCalled, false, 'browser-side account creation must NOT run');
        assert.equal(_anonCalled, false, 'no anonymous fallback');
        assert.equal(getFirebaseAuthError(), 'auth/user-not-found');
    });

    test('invalid-credential does NOT fall back to anonymous — returns false / none', async () => {
        _signInBehavior = 'auth/invalid-credential';
        const ok = await ensureFirebaseSession('G. Miller');
        assert.equal(ok, false);
        assert.equal(getFirebaseIdentity(), 'none');
        assert.equal(_anonCalled, false, 'no anonymous fallback');
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
        _signOutCalled  = false;
        _createCalled   = false;
        _anonCalled     = false;
        _signInCalls    = 0;
    });

    test('a named sign-in succeeds → true, no retries', async () => {
        const ok = await ensureNamedSession('G. Miller', { delayMs: 0 });
        assert.equal(ok, true);
        assert.equal(_signInCalls, 1);
    });

    test('a PERSISTENT failure is not retried → false, one attempt', async () => {
        _signInBehavior = 'auth/invalid-credential';
        const ok = await ensureNamedSession('G. Miller', { delayMs: 0, retries: 2 });
        assert.equal(ok, false);
        assert.equal(_signInCalls, 1, 'a credential/account error must not be retried');
        assert.equal(_anonCalled, false);
    });

    test('a TRANSIENT failure is retried, then gives up → false after retries+1 attempts', async () => {
        _signInBehavior = 'auth/network-request-failed';
        const ok = await ensureNamedSession('G. Miller', { delayMs: 0, retries: 2 });
        assert.equal(ok, false);
        assert.equal(_signInCalls, 3, 'initial attempt + 2 retries');
    });

    test('a RATE LIMIT is not retried — another request only adds to it (v24.56)', async () => {
        _signInBehavior = 'auth/too-many-requests';
        const ok = await ensureNamedSession('G. Miller', { delayMs: 0, retries: 2 });
        assert.equal(ok, false);
        assert.equal(_signInCalls, 1, 'one attempt: the station shares one address, and retries spend its budget');
    });

    test('a TRANSIENT failure that CLEARS on retry → true (recovery path)', async () => {
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
        _existingUser = null; _signInBehavior = 'ok';
        _signOutCalled = false; _createCalled = false; _anonCalled = false; _signInCalls = 0;
        _resetAuthStateForTest();
    });

    test('a named sign-in drives the store to named + member', async () => {
        await ensureNamedSession('G. Miller', { delayMs: 0 });
        assert.deepEqual(getAuthSnapshot(), { status: 'named', member: 'G. Miller', error: null });
    });

    test('a persistent failure drives the store to signedOut', async () => {
        _signInBehavior = 'auth/invalid-credential';
        const ok = await ensureNamedSession('G. Miller', { delayMs: 0 });
        assert.equal(ok, false, 'return value still reflects the failed named session');
        assert.equal(getAuthSnapshot().status, 'signedOut');
        assert.equal(getAuthSnapshot().error, 'auth/invalid-credential');
    });

    test('a NON-credential failure drives the store to signedOut — never anonymous', async () => {
        // The ENTRY POINT every write page calls. With the retired `ENFORCE_NAMED_SESSION` switch off
        // this path landed on an anonymous session, returned true, and the page proceeded to writes
        // the rules then refused. It must now end at the sign-in prompt.
        _signInBehavior = 'auth/operation-not-allowed';   // not a credential rejection, not transient
        const ok = await ensureNamedSession('G. Miller', { delayMs: 0 });
        assert.equal(ok, false, 'a page must not proceed as though signed in');
        assert.equal(getAuthSnapshot().status, 'signedOut');
        assert.equal(getAuthSnapshot().error, 'auth/operation-not-allowed');
        assert.equal(_anonCalled, false, 'no anonymous fallback');
    });

    test('clearSession drives the store to signedOut', async () => {
        // Seed a non-signedOut state first, then clear. This comment promised the seed for a long
        // time without doing it, so the store went from `initialising` — never the state a real
        // sign-out leaves (test audit, 7 Nov 2026).
        await ensureNamedSession('G. Miller', { delayMs: 0 });
        assert.equal(getAuthSnapshot().status, 'named', 'the seed');
        clearSession();
        assert.equal(getAuthSnapshot().status, 'signedOut');
    });

    test('the bridge does NOT change ensureNamedSession\'s return value (named success → true)', async () => {
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
        // `createdAt` (Oct 2026) is not a second clock: it is written once and never moves, and it
        // exists only to be compared with the server's last reset (`sessionPredatesReset`).
        assert.deepEqual(Object.keys(s).sort(), ['createdAt', 'expiry', 'name', 'ver']);
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

    test('deletes the Calendar\'s copy of the member\'s own roster (v24.59) — every sign-out ends here', () => {
        store.set('myb_cal_snapshot', '{}');
        clearSession();
        assert.equal(store.has('myb_cal_snapshot'), false, 'a shared device must not keep it past the session');
    });

    test('and so does a session that has EXPIRED on read', () => {
        store.set(AUTH_KEY, JSON.stringify({ name: 'G. Miller', ver: 99, expiry: 1 }));
        store.set('myb_cal_snapshot', '{}');
        assert.equal(getSession(), null);
        assert.equal(store.has('myb_cal_snapshot'), false);
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
        _signOutCalled   = false;
        _authEmitDelayMs = 0;
        _resetBootRestore();   // the boot restore is memoised (v21.29) — a stale one hides a subscription
        auth.currentUser = null;
    });
    afterEach(() => { auth.currentUser = null; _authEmitDelayMs = 0; });

    test('primeAuth pre-subscribes the restore once and ensureFirebaseSession reuses it (no 2nd subscription)', async () => {
        // The restore is STILL IN FLIGHT when the sign-in starts — the cold-restore case primeAuth
        // exists for. Without the delay the emission populates `currentUser` during the flush, the
        // sign-in takes the fast path, and this test passes without the primed promise doing
        // anything at all (it did exactly that until v21.29, and the leaked promise then answered a
        // LATER test's sign-in with a stale identity — which is how the value-vs-wait bug surfaced).
        _existingUser    = { isAnonymous: false, email: nameToEmail('G. Miller') };
        _authEmitDelayMs = 30;
        primeAuth();
        await new Promise(r => setTimeout(r, 5));   // let the eager subscription happen
        assert.equal(_onAuthSubs, 1, 'primeAuth subscribes the first auth-state once, eagerly');

        const ok = await ensureFirebaseSession('G. Miller');
        assert.equal(ok, true);
        assert.equal(getFirebaseIdentity(), 'named');
        assert.equal(_onAuthSubs, 1, 'the primed wait was reused — no second onAuthStateChanged');

        primeAuth();   // one-shot per page life: a second prime is a no-op
        await new Promise(r => setTimeout(r, 5));
        assert.equal(_onAuthSubs, 1, 'primeAuth is idempotent');
        _authEmitDelayMs = 0;
    });

    test('a primed restore supplies the TIMING, never the identity (shared device)', async () => {
        // Priming happens when the login overlay MOUNTS, so its promise can be minutes old by the
        // time somebody signs in — and on a shared device the person who signs in may not be the
        // person whose session was restored. Reading the identity out of that promise would hand
        // the second member the first member's user object.
        // A FRESH module instance, because priming is one-shot per module life (`_authPrimed` is
        // never reset). In file order the test above had already spent the shared instance's prime,
        // so `primeAuth()` here did nothing, there was no primed promise to misread, and reading the
        // identity out of it survived the whole file while failing this test run alone
        // (test audit, 7 Nov 2026).
        const s = await import('./session.js?primed-timing');
        _existingUser = { isAnonymous: false, email: nameToEmail('A. Panchal') };
        s.primeAuth();
        await new Promise(r => setTimeout(r, 5));
        mockAuth.currentUser = null;                    // A. Panchal has since been signed out
        _existingUser        = null;

        const ok = await s.ensureFirebaseSession('G. Miller');
        assert.equal(ok, true);
        assert.equal(s.getFirebaseIdentity(), 'named');
        assert.equal(_signOutCalled, false, 'nobody was signed in, so nothing needed signing out');
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

    test('a TYPED password is always checked — a live matching session is not proof of it (Sep 2026 review)', async () => {
        // The fast path answered 'named' for any typed password whenever the restored Firebase user
        // was this member, so during the boot window a WRONG password renewed an expired 60-day
        // session. A typed password is an explicit sign-in, so it goes to Firebase every time.
        auth.currentUser = { isAnonymous: false, email: nameToEmail('G. Miller') };
        _signInBehavior  = 'auth/invalid-credential';
        const ok = await ensureFirebaseSession('G. Miller', undefined, 'not-the-password');
        assert.equal(ok, false, 'a wrong typed password must not sign anybody in');
        assert.ok(_signInCalls >= 1, 'the typed password was actually checked');
    });

    test('…and a MISTYPED password leaves the member\'s working sign-in as it was — no sign-out first (review, Nov 2026)', async () => {
        // Signing the restored account out before the typed password destroyed a sign-in that worked,
        // and every other tab of the browser then saw nobody and cleared the shared 60-day session.
        const restored = { isAnonymous: false, email: nameToEmail('G. Miller') };
        auth.currentUser = restored;
        _signOutCalled   = false;
        _signInCalls     = 0;
        _signInPasswords = [];
        _signInBehavior  = 'auth/invalid-credential';
        const ok = await ensureFirebaseSession('G. Miller', undefined, 'Not-the-Passw0rd');
        assert.equal(ok, false, 'a wrong typed password must still fail');
        assert.deepEqual(_signInPasswords, ['Not-the-Passw0rd'], 'the typed password was sent to Firebase, and only it');
        assert.equal(getFirebaseIdentity(), 'none', 'never a success on the strength of the restored session');
        assert.equal(getFirebaseAuthError(), 'auth/invalid-credential');
        assert.equal(_signOutCalled, false, 'the same member\'s restored account was signed out before the password was checked');
        assert.equal(auth.currentUser, restored, 'a refusal must leave the account that was signed in');
    });

    test('…while ANOTHER member\'s restored account is still signed out before the typed password', async () => {
        auth.currentUser = { isAnonymous: false, email: nameToEmail('S. Silva') };
        _signOutCalled   = false;
        _signInBehavior  = 'auth/invalid-credential';
        assert.equal(await ensureFirebaseSession('G. Miller', undefined, 'Not-the-Passw0rd'), false);
        assert.equal(_signOutCalled, true, 'a colleague\'s account stayed signed in under this member\'s sign-in');
        assert.equal(auth.currentUser, null);
    });

    test('…and a RIGHT typed password on a live matching session still signs in', async () => {
        auth.currentUser = { isAnonymous: false, email: nameToEmail('G. Miller') };
        _signInBehavior  = 'ok';
        const ok = await ensureFirebaseSession('G. Miller', undefined, 'the-password');
        assert.equal(ok, true);
        assert.equal(_signInCalls, 1);
        assert.equal(getFirebaseIdentity(), 'named');
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
    });
    afterEach(() => { _signInGate = null; _signOutGate = null; _probeGate = null; _signInBehavior = 'ok'; auth.currentUser = null; });

    test('a superseded attempt that resumes and FAILS does not clobber the winner’s named identity', async () => {
        // Attempt 1 hangs at sign-in; Attempt 2 starts and wins as 'named'; Attempt 1 then resumes and
        // its sign-in FAILS → without the guard it would resolve 'none' and overwrite _fbIdentity.
        _signInBehavior = (/** @type {number} */ n) => (n === 1 ? 'auth/invalid-credential' : 'ok');
        /** @type {() => void} */ let releaseGate = () => {};
        _signInGate = new Promise(r => { releaseGate = r; });

        const p1 = ensureFirebaseSession('G. Miller');          // attempt 1 — hangs awaiting the gate
        await signInEntered(1);                                 // let it reach the gate
        _signInGate = null;                                     // attempt 2 won't gate

        const ok2 = await ensureFirebaseSession('G. Miller');   // attempt 2 — wins
        assert.equal(ok2, true);
        assert.equal(getFirebaseIdentity(), 'named');

        releaseGate();                                          // attempt 1 resumes → fails → none (STALE)
        await p1;
        assert.equal(getFirebaseIdentity(), 'named', 'the stale attempt must not overwrite the winner');
    });

    test('a sign-in that lands AFTER clearSession() is signed straight back out (v24.38)', async () => {
        /** @type {() => void} */ let releaseGate = () => {};
        _signInGate = new Promise(r => { releaseGate = r; });
        const login = ensureNamedSession('G. Miller', { delayMs: 0 });   // parks at the gate
        await signInEntered(1);
        clearSession();                                                   // the overlay's timeout gives up
        _signOutCalled = false;
        releaseGate();                                                    // …and the request lands anyway
        assert.equal(await login, false, 'still reported as not signed in');
        assert.equal(_signOutCalled, true, 'and Firebase is not left signed in behind a cleared session');
    });

    test('a sign-in for one member that lands after ANOTHER member\'s attempt is signed back out (v24.56)', async () => {
        // Shared device: X's silent re-auth hangs; Y signs in and wins; X's request lands late and
        // would replace Y's account under Y's page.
        /** @type {() => void} */ let releaseGate = () => {};
        _signInGate = new Promise(r => { releaseGate = r; });
        const late = ensureFirebaseSession('G. Miller');
        await signInEntered(1);
        _signInGate = null;
        assert.equal(await ensureNamedSession('S. Boyle', { delayMs: 0 }), true);
        _signOutCalled = false;
        releaseGate();
        assert.equal(await late, false);
        assert.equal(_signOutCalled, true, 'the late account must not stand under the other member\'s page');
    });

    test('the same member\'s late sign-in is left alone — it is the account the winner wants', async () => {
        /** @type {() => void} */ let releaseGate = () => {};
        _signInGate = new Promise(r => { releaseGate = r; });
        const late = ensureFirebaseSession('G. Miller');
        await signInEntered(1);
        _signInGate = null;
        assert.equal(await ensureNamedSession('G. Miller', { delayMs: 0 }), true);
        _signOutCalled = false;
        releaseGate();
        await late;
        assert.equal(_signOutCalled, false);
    });

    // ── WHOSE account is signed in decides it, and every await is followed by the same question ──
    // The guard above asks two things of a superseded attempt: did ANOTHER member's attempt supersede
    // it, and is the account signed in now THIS attempt's own? Its tests could not ask the second
    // until the fake left a successful sign-in's account signed in, as the SDK does. And each await
    // in the attempt is followed by "am I still current?" — so each test below parks the attempt at
    // one await while another member signs in, and then lets it go on.

    test('the winner\'s sign-in landing ON TOP of a late one is left alone — the account is theirs (v24.56)', async () => {
        // A's silent re-auth and Q's sign-in are both on their way. A's lands, then Q's lands on top of
        // it, and only then does A look. The account signed in is Q's: signing "the late one" out now
        // would sign Q out under Q's own page.
        _resetAtMs = 0;
        /** @type {() => void} */ let releaseA = () => {};
        /** @type {() => void} */ let releaseQ = () => {};
        _signInGate = new Promise(r => { releaseA = r; });
        const late = ensureFirebaseSession('A. Person');
        await signInEntered(1);
        _signInGate = new Promise(r => { releaseQ = r; });
        const winner = ensureNamedSession('Q. Example', { delayMs: 0 });
        await signInEntered(2);
        _signInGate = null;
        _signOutCalled = false;
        releaseA();        // A's request lands first…
        releaseQ();        // …and Q's lands on top of it, before A has looked
        assert.equal(await winner, true);
        await late;
        assert.equal(_signOutCalled, false, 'the winner was signed out by the attempt it superseded');
        assert.equal(auth.currentUser?.email, nameToEmail('Q. Example'));
        assert.equal(getFirebaseIdentity(), 'named');
    });

    test('an attempt superseded while the restore is still answering does not sign the winner out', async () => {
        // A's attempt waits for the stored account to be restored; Q signs in meanwhile. When the
        // restore answers, the account it reads is Q's — and A, superseded, must leave it alone rather
        // than sign it out to make room for its own.
        _resetBootRestore();
        _authNeverEmits = true;
        try {
            const late = ensureFirebaseSession('A. Person');
            for (let i = 0; i < 100 && !_releaseHungRestore; i++) await new Promise(r => setTimeout(r, 1));
            assert.ok(_releaseHungRestore, 'premise: the attempt is waiting on the restore');
            auth.currentUser = { isAnonymous: false, email: nameToEmail('Q. Example') };
            assert.equal(await ensureFirebaseSession('Q. Example'), true, 'Q wins, off the live session');
            _signOutCalled = false;
            const release = /** @type {() => void} */ (_releaseHungRestore);
            _releaseHungRestore = null;
            release();
            assert.equal(await late, false);
            assert.equal(_signOutCalled, false, 'the superseded attempt signed the winner out');
            assert.equal(auth.currentUser?.email, nameToEmail('Q. Example'));
            assert.equal(_signInCalls, 0);
        } finally { _authNeverEmits = false; await _settleHungRestore(); }
    });

    test('an attempt superseded while it signs the previous account out never signs in after it (v16.69)', async () => {
        // A third member's account is on the device. A's typed sign-in signs it out first, and Q signs in
        // while that sign-out is still settling. A must stop there: a typed sign-in has no reset check
        // after this point to catch it, so it would put A's account over Q's.
        _resetAtMs = 0;
        auth.currentUser = { isAnonymous: false, email: nameToEmail('R. Sample') };
        /** @type {() => void} */ let releaseSignOut = () => {};
        _signOutGate = new Promise(r => { releaseSignOut = r; });
        _signOutCalled = false;
        const late = ensureNamedSession('A. Person', { delayMs: 0, password: 'Person' });
        for (let i = 0; i < 100 && !_signOutCalled; i++) await new Promise(r => setTimeout(r, 1));
        assert.equal(_signOutCalled, true, 'premise: the attempt is signing the previous account out');
        _signOutGate = null;
        assert.equal(await ensureNamedSession('Q. Example', { delayMs: 0 }), true);
        releaseSignOut();
        assert.equal(await late, false);
        assert.equal(_signInCalls, 1, 'the superseded attempt signed in after its sign-out');
        assert.equal(auth.currentUser?.email, nameToEmail('Q. Example'));
    });

    test('a TYPED sign-in superseded between its two passwords never tries the second (v16.69)', async () => {
        // "Person" typed for A. Person is tried as the surname default first, then as typed. The first is
        // refused only after Q has signed in, and A's second try would put A's account over Q's.
        _resetAtMs = 0;
        _signInBehavior = (/** @type {number} */ n) => (n === 1 ? 'auth/invalid-credential' : 'ok');
        /** @type {() => void} */ let releaseGate = () => {};
        _signInGate = new Promise(r => { releaseGate = r; });
        const late = ensureNamedSession('A. Person', { delayMs: 0, password: 'Person' });
        await signInEntered(1);
        _signInGate = null;
        assert.equal(await ensureNamedSession('Q. Example', { delayMs: 0 }), true);   // sign-in 2
        _signOutCalled = false;
        releaseGate();                                                               // A's first is refused
        assert.equal(await late, false);
        assert.equal(_signInCalls, 2, 'the superseded attempt went on to its second password');
        assert.equal(_signOutCalled, false);
        assert.equal(auth.currentUser?.email, nameToEmail('Q. Example'));
    });

    test('a silent attempt superseded while its reset check is out never signs in afterwards (v16.69)', async () => {
        _resetAtMs = 0;
        const probesBefore = _probeCalls;
        /** @type {() => void} */ let releaseProbe = () => {};
        _probeGate = new Promise(r => { releaseProbe = r; });
        const late = ensureFirebaseSession('A. Person');                // parks in its reset check
        for (let i = 0; i < 100 && _probeCalls === probesBefore; i++) await new Promise(r => setTimeout(r, 1));
        assert.equal(_probeCalls, probesBefore + 1, 'premise: the attempt is in its reset check');
        _probeGate = null;
        assert.equal(await ensureNamedSession('Q. Example', { delayMs: 0 }), true);
        _signOutCalled = false;
        releaseProbe();
        assert.equal(await late, false);
        assert.equal(_signInCalls, 1, 'the superseded attempt signed in after its check');
        assert.equal(_signOutCalled, false);
        assert.equal(auth.currentUser?.email, nameToEmail('Q. Example'));
    });

    test('the latest (current) attempt still writes identity normally', async () => {
        // Sanity: with no superseding attempt, the guard is a pure no-op — identity is published.
        const ok = await ensureFirebaseSession('G. Miller');
        assert.equal(ok, true);
        assert.equal(getFirebaseIdentity(), 'named');
    });

    test('a superseded RETRY does not clobber the winner via the top reset (the retry loop)', async () => {
        // The bug the v14.91 review caught: ensureNamedSession's retry loop re-enters ensureFirebaseSession
        // with its STALE gen; the unguarded top `_fbIdentity='none'` reset then clobbered a newer winner.
        // Repro: attempt 1's first sign-in is TRANSIENT → it enters
        // the loop and waits; attempt 2 wins as 'named'; then attempt 1's delayed retry runs its reset.
        _signInBehavior = (/** @type {number} */ n) => (n === 1 ? 'auth/network-request-failed' : 'ok');

        const p1 = ensureNamedSession('G. Miller', { retries: 1, delayMs: 60 }); // call 1 (transient) → retry loop
        await new Promise(r => setTimeout(r, 10));                                // let attempt 1 reach its setTimeout
        await ensureNamedSession('G. Miller');                                    // attempt 2 (call 2) wins → 'named'
        assert.equal(getFirebaseIdentity(), 'named', 'attempt 2 won');

        await p1;   // attempt 1's delayed retry (call 3) runs — its top reset must be gen-guarded
        assert.equal(getFirebaseIdentity(), 'named',
            'a superseded retry must not reset _fbIdentity to none — the global and the store would disagree');
    });
});

// ── What a named sign-in does once it lands — and what it never says ────────────────────────────
describe('a named sign-in, after it lands', () => {
    beforeEach(() => {
        store.clear();
        _existingUser    = null;
        _signInBehavior  = 'ok';
        _signInCalls     = 0;
        _signInGate      = null;
        _resetAtMs       = 0;
        _idTokenForced.length = 0;
        auth.currentUser = null;
    });
    afterEach(() => { _signInBehavior = 'ok'; auth.currentUser = null; });

    test('refreshes its token ONCE for a new claim epoch — the sweep is wired in, not only written', async () => {
        // refreshClaimsIfStale is tested on its own above; this is the call that runs it. Without it a
        // device keeps a token minted before a new claim until the hourly refresh, and a manager's
        // first on-behalf writes are refused in that hour.
        assert.equal(await ensureNamedSession('A. Person', { delayMs: 0 }), true);
        await new Promise(r => setImmediate(r));   // the sweep is fire-and-forget
        assert.deepEqual(_idTokenForced, [nameToEmail('A. Person')], 'no forced refresh after a named sign-in');
        assert.equal(store.get('myb_claim_epoch'), String(CONFIG.CLAIM_EPOCH));
        // …and once only: the next sign-in on this device asks for nothing more.
        assert.equal(await ensureNamedSession('A. Person', { delayMs: 0 }), true);
        await new Promise(r => setImmediate(r));
        assert.equal(_idTokenForced.length, 1);
    });

    test('a failed sign-in logs its code, never the account: the email IS the member\'s name', async () => {
        // A station PC's console is readable by whoever opens its developer tools next.
        _signInBehavior = 'auth/invalid-credential';
        /** @type {string[]} */ const lines = [];
        const w = console.warn;
        console.warn = (/** @type {any[]} */ ...a) => { lines.push(a.map(String).join(' ')); };
        try {
            assert.equal(await ensureFirebaseSession('A. Person'), false);
        } finally { console.warn = w; }
        assert.ok(lines.some(l => l.includes('auth/invalid-credential')), 'premise: the refusal was logged');
        assert.deepEqual(lines.filter(l => l.includes(nameToEmail('A. Person')) || l.includes('Person')), [],
            'a member\'s name or account reached the console');
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
    });
    afterEach(() => { _signInGate = null; auth.currentUser = null; });

    test('superseded by a SAME-member direct call, but genuinely signed in → returns true (no spurious failure)', async () => {
        // Login (gen G1) reaches sign-in and parks at the gate. A direct ensureFirebaseSession('G. Miller')
        // (gen G2) then wins off the live session, superseding G1. When G1 resumes and finds itself
        // superseded, the live user IS the member, so it must return true — not the old blanket false.
        /** @type {() => void} */ let releaseGate = () => {};
        _signInGate = new Promise(r => { releaseGate = r; });

        const login = ensureNamedSession('G. Miller', { delayMs: 0 });   // G1 — parks at the gate
        await signInEntered(1);                                          // let it reach the gate
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
        // Wait until the login has REACHED the gate (test audit, 7 Nov 2026). This waited six
        // microtask ticks, which is not long enough: the login had not got to sign-in, the gate was
        // cleared before it parked, and the race this test names never happened — so dropping the
        // identity check below (`return ok;`) left it green. The sibling test above waits this way.
        await signInEntered(1);
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
        // Wait until the login has REACHED the gate (test audit, 7 Nov 2026). This waited six
        // microtask ticks, which is not long enough: the login had not got to sign-in, the gate was
        // cleared before it parked, and the race this test names never happened — so dropping the
        // identity check below (`return ok;`) left it green. The sibling test above waits this way.
        await signInEntered(1);
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

    test('it is viewer-shed.js\'s, re-exported unchanged — the same function every test here drives', async () => {
        // Moved out whole in Nov 2026 (session.js's cap); session.js's sign-in is still its one caller.
        assert.equal((await import('./viewer-shed.js')).shedCalendarViewer, shedCalendarViewer);
    });

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

    test('NO current user still re-arms member persistence (Sep 2026 review)', async () => {
        // The viewer may already be gone — reconcile signs it out when its session has lapsed — but
        // the SESSION-only persistence its unlock set is still in force. Returning early here left
        // the member who then signed in on session persistence, lost when the browser closed.
        mockAuth.currentUser = null;
        await shedCalendarViewer();
        assert.equal(_signOutCalled, false, 'nobody to sign out');
        assert.deepEqual(_persistenceRestores, ['member']);
    });

    test('a non-viewer identity is left entirely alone', async () => {
        mockAuth.currentUser = { uid: 'someone-else', isAnonymous: false, email: 'a@b.test' };
        await shedCalendarViewer();
        assert.equal(_signOutCalled, false, 'this function only ever sheds the shared viewer');
        assert.deepEqual(_persistenceRestores, []);
    });

    test('a member sign-in that cannot shed the viewer is ABANDONED — it never carries on past it', async () => {
        // The CALL SITE, not the helper. Every test above drives shedCalendarViewer directly, so the
        // `return` after a failed shed in ensureFirebaseSession could be deleted with this file green
        // (test audit, 7 Nov 2026) — and the sign-in then carried on with the shared viewer still the
        // current identity, which is the state this whole block exists to refuse.
        mockAuth.currentUser = viewer;
        _signOutBehavior = 'auth/network-request-failed';
        _signInCalls = 0;
        const ok = await ensureFirebaseSession('G. Miller');
        assert.equal(ok, false, 'the sign-in reports that it failed');
        assert.equal(_signInCalls, 0, 'no member credential is presented while the viewer is still current');
        assert.deepEqual(_persistenceRestores, [], 'and persistence is never re-armed');
        assert.equal(getFirebaseAuthError(), 'auth/viewer-shed-failed', 'the failure is named for what happened');
        assert.notEqual(getFirebaseIdentity(), 'named');
        // A browser that could not sign the PIN out says nothing about the MEMBER, so — like its twin,
        // previous-user-shed-failed — it is transient: the 60-day session stands (sign-in check, 11 Nov 2026).
        assert.equal(isTransientAuthError('auth/viewer-shed-failed'), true, 'a storage fault ended the member\'s session');
    });
});

// ── A RESTORED ACCOUNT THIS BROWSER CANNOT SIGN OUT (sessions-4, Nov 2026) ──────────────────────
// Before a member signs in, an account restored here that is not theirs — an old anonymous one,
// another member's — is signed out. That one sign-out was the only one in the file left uncaught, so
// when the browser could not delete the stored account (the SDK rethrows that as auth/internal-error)
// `ensureNamedSession` REJECTED: and every write page hands that promise to `resolveSession()` with no
// catch, so `sessionReady` rejected, no sign-in was offered and every await of it threw.
describe('a restored account this browser cannot sign out', () => {
    beforeEach(() => {
        store.clear(); _resetAuthStateForTest();
        _existingUser = { isAnonymous: false, email: nameToEmail('A. Panchal') };
        _signInBehavior = 'ok'; _signInCalls = 0; _signOutCalls = 0;
    });
    afterEach(() => { _signOutBehavior = 'ok'; _existingUser = null; });

    test('ends the attempt instead of rejecting, and presents no credential past it', async () => {
        _signOutBehavior = 'auth/internal-error';
        const ok = await ensureNamedSession('G. Miller', { delayMs: 1 });   // must RESOLVE
        assert.equal(ok, false);
        assert.equal(_signInCalls, 0, 'nothing is signed in while the other account is still current');
        assert.equal(getFirebaseAuthError(), 'auth/previous-user-shed-failed', 'named for what happened');
        // A failed local sign-out says nothing about the member, so it is TRANSIENT: the page keeps the
        // 60-day session and shows its sign-in without clearing it (terminalAuthEvent).
        assert.equal(getAuthSnapshot().status, 'degraded');
    });

    test('and is retried: once the account is gone, the member is signed in', async () => {
        // The SDK clears the account from memory before the storage delete that failed, so a retry
        // normally finds nobody to sign out. Modelled here as the second sign-out going through.
        _signOutBehavior = (n) => (n === 1 ? 'auth/internal-error' : 'ok');
        const ok = await ensureNamedSession('G. Miller', { delayMs: 1 });
        assert.equal(ok, true);
        assert.equal(_signInCalls, 1);
        assert.equal(getAuthSnapshot().status, 'named');
    });
});

// ── A PAGE THAT ADMITS THE STAFF PIN KEEPS IT, AND ONLY IT (v24.84) ─────────────────────────────
//
// The Trains page reads the station PIN since v24.84 (owner, 22 Oct 2026). Before, it ran the bare
// reconcile every protected page runs, and that signed the PIN out on arrival: the station PC met a
// member sign-in, and lost the PIN it had unlocked the Calendar with. `holdsStaffPin` is the page's
// question; these pin both halves of its answer, because each failure is silent on its own page —
// keeping too much leaves an expired member's privileges live behind a page that renders the same,
// and keeping too little shows a sign-in to a station that should not need one.
const { holdsStaffPin, signOutStaffPin } = await import('./session.js');
describe('holdsStaffPin / signOutStaffPin — the station PIN on a page that admits it', () => {
    const viewer = { uid: CALENDAR_VIEWER_UID, isAnonymous: false, email: null };
    beforeEach(() => {
        store.clear();
        _signOutCalled = false; _signOutBehavior = 'ok';
        _existingUser = null; _authNeverEmits = false; _authEmitDelayMs = 0;
        _resetBootRestore();
        mockAuth.currentUser = null;
    });
    afterEach(async () => { _signOutBehavior = 'ok'; _authNeverEmits = false; mockAuth.currentUser = null; await _settleHungRestore(); });

    test('the PIN, with no member: held, and NOT signed out', async () => {
        mockAuth.currentUser = viewer;
        assert.equal(await holdsStaffPin(), true);
        assert.equal(_signOutCalled, false, 'the station would be asked for the PIN again on the way back');
        assert.equal(mockAuth.currentUser, viewer);
    });

    test('a member identity that outlived its session is still torn down, and is not the PIN', async () => {
        mockAuth.currentUser = { uid: 'uid-miller', isAnonymous: false, email: 'g.miller@myb.test' };
        assert.equal(await holdsStaffPin(), false);
        assert.equal(_signOutCalled, true, 'admitting the PIN must not become an amnesty for an expired member');
    });

    test('a member with a session outranks the PIN, and nobody at all holds nothing', async () => {
        saveSession('G. Miller');
        mockAuth.currentUser = viewer;
        assert.equal(await holdsStaffPin(), false, 'the member path decides a member\'s page');
        store.clear();
        mockAuth.currentUser = null;
        assert.equal(await holdsStaffPin(), false);
        assert.equal(_signOutCalled, false);
    });

    test('a PIN session restoring AFTER the answer still reaches the page, once (sign-in check, 11 Nov 2026)', async () => {
        // Trains stood at its sign-in for good when the station PC's PIN session restored late; the
        // Calendar has honoured a late one since cal-data-10.
        let late = 0;
        assert.equal(await holdsStaffPin(60, () => { late++; }), false, 'premise: nothing held at the decision');
        const v = { ...viewer, getIdTokenResult: async () => ({ claims: { calendarViewer: true } }) };
        mockAuth.currentUser = v;
        for (const cb of [..._authCbs]) cb(v);
        await new Promise(r => setTimeout(r, 0));
        assert.equal(late, 1, 'a PIN session that restored late was ignored');
        for (const cb of [..._authCbs]) cb(v);
        await new Promise(r => setTimeout(r, 0));
        assert.equal(late, 1, 'the late answer ran twice');
    });

    test('…but not without the claim, and never over a member\'s session', async () => {
        let late = 0;
        assert.equal(await holdsStaffPin(60, () => { late++; }), false);
        const bare = { ...viewer, getIdTokenResult: async () => ({ claims: {} }) };
        mockAuth.currentUser = bare;
        for (const cb of [..._authCbs]) cb(bare);
        await new Promise(r => setTimeout(r, 0));
        assert.equal(late, 0, 'a token without the claim reached the page');
        saveSession('G. Miller');
        const v = { ...viewer, getIdTokenResult: async () => ({ claims: { calendarViewer: true } }) };
        mockAuth.currentUser = v;
        for (const cb of [..._authCbs]) cb(v);
        await new Promise(r => setTimeout(r, 0));
        assert.equal(late, 0, 'the PIN was handed a member\'s page');
    });

    test('…nor once a sign-in has BEGUN under it (review, 11 Nov 2026)', async () => {
        // A typed sign-in saves its session only when it succeeds, so `getSession()` alone let a restore
        // landing under it start Trains for the PIN — and then, once the sign-in landed, for the member.
        let late = 0;
        assert.equal(await holdsStaffPin(60, () => { late++; }), false, 'premise: nothing held at the decision');
        /** @type {(v?: any) => void} */ let release = () => {};
        _signInGate = new Promise(r => { release = r; });
        const signingIn = ensureNamedSession('G. Miller', { password: 'miller', retries: 0, delayMs: 0 });
        const v = { ...viewer, getIdTokenResult: async () => ({ claims: { calendarViewer: true } }) };
        mockAuth.currentUser = v;
        for (const cb of [..._authCbs]) cb(v);
        await new Promise(r => setTimeout(r, 0));
        assert.equal(late, 0, 'the PIN page started underneath a member\'s sign-in');
        release(); _signInGate = null;
        await signingIn;
        for (const cb of [..._authCbs]) cb(v);
        await new Promise(r => setTimeout(r, 0));
        assert.equal(late, 0, 'the watcher outlived the sign-in that superseded it');
    });

    test('…nor when a sign-in BEGINS while the PIN\'s token is being read — the check after the read (audit C4)', async () => {
        // The check above runs as the restore lands; the token read after it is a round trip, and a
        // typed sign-in can begin inside it — the v25.77 Trains double start. The PIN is kept current
        // here (a browser that cannot sign it out), so only the generation can say the page moved on.
        let late = 0;
        assert.equal(await holdsStaffPin(60, () => { late++; }), false, 'premise: nothing held at the decision');
        /** @type {(v: any) => void} */ let answer = () => {};
        const token = new Promise(r => { answer = r; });   // ONE read for every watcher, so answering it reaches ours
        const v = { ...viewer, getIdTokenResult: () => token };
        mockAuth.currentUser = v;
        for (const cb of [..._authCbs]) cb(v);   // the restore lands: the first check passes, the read starts
        _signOutBehavior = 'auth/internal-error';
        await ensureNamedSession('G. Miller', { password: 'miller', retries: 0, delayMs: 0 });   // a sign-in begins
        assert.equal(mockAuth.currentUser, v, 'premise: the PIN is still current when its token answers');
        answer({ claims: { calendarViewer: true } });
        await new Promise(r => setTimeout(r, 0));
        assert.equal(late, 0, 'the PIN page started under a sign-in that began while its token was read');
    });

    test('…and once a sign-in or sign-out has begun, the watcher UNSUBSCRIBES at the next emission — it does not linger', async () => {
        // The early stand-down is the only unsubscribe on that path: without it every later emission of
        // the page's life — each token refresh, each sign-in — kept running a watcher that could only
        // ever return.
        const before = new Set(_authCbs);
        assert.equal(await holdsStaffPin(60, () => {}), false, 'premise: nothing held at the decision');
        const ours = [..._authCbs].filter(cb => !before.has(cb));
        assert.equal(ours.length, 1, 'premise: the late-viewer watcher subscribed once');
        const unsubsBefore = _authUnsubs;
        clearSession();   // a sign-out moves the generation, as a sign-in does
        ours[0](null);
        assert.equal(_authCbs.has(ours[0]), false, 'the watcher stood down without unsubscribing');
        assert.equal(_authUnsubs, unsubsBefore + 1, 'exactly one unsubscribe');
        ours[0](null);
        assert.equal(_authUnsubs, unsubsBefore + 1, 'a second emission unsubscribed again');
    });

    test('a restore that never arrives answers within the budget — no PIN, never a hang', async () => {
        _authNeverEmits = true;
        const started = Date.now();
        assert.equal(await holdsStaffPin(60), false);
        assert.ok(Date.now() - started < 1000, 'the page would sit blank waiting for Firebase');
    });

    test('Lock signs the PIN out and resolves; a member is never touched', async () => {
        mockAuth.currentUser = viewer;
        await signOutStaffPin();
        assert.equal(_signOutCalled, true);
        assert.equal(mockAuth.currentUser, null);
        _signOutCalled = false;
        mockAuth.currentUser = { uid: 'uid-miller', isAnonymous: false, email: 'g.miller@myb.test' };
        await signOutStaffPin();
        assert.equal(_signOutCalled, false, 'Lock is for the station PIN only');
    });

    test('a Lock whose sign-out RESOLVES with the PIN still current is refused, not reported', () => {
        // The station walks away believing it locked. Modelled by pinning currentUser, as above.
        const orig = Object.getOwnPropertyDescriptor(mockAuth, 'currentUser');
        Object.defineProperty(mockAuth, 'currentUser', { configurable: true, get: () => viewer, set: () => {} });
        return assert.rejects(() => signOutStaffPin(), /still current after sign-out/)
            .finally(() => {
                if (orig) Object.defineProperty(mockAuth, 'currentUser', orig);
                else delete /** @type {any} */ (mockAuth).currentUser;
            });
    });
});

const { terminalAuthEvent } = await import('./session.js');
describe('terminalAuthEvent — a stalled start-up is TRANSIENT, not a sign-out (v24.61, iOS audit B1)', () => {
    test('a named identity is NAMED', () => {
        assert.deepEqual(terminalAuthEvent({ named: true, stalled: false, error: null }), { type: 'NAMED' });
    });
    test('Firebase\'s start-up outrunning its bound is TRANSIENT → degraded → pending: the page keeps the session', () => {
        assert.deepEqual(terminalAuthEvent({ named: false, stalled: true, error: 'auth/timeout' }), { type: 'TRANSIENT', error: 'auth/timeout' });
        assert.deepEqual(terminalAuthEvent({ named: false, stalled: true, error: null }), { type: 'TRANSIENT', error: 'auth/timeout' }, 'a stall with no recorded code is still named as one');
    });
    test('a genuine refusal is NONE, with its code — that one does sign out', () => {
        assert.deepEqual(terminalAuthEvent({ named: false, stalled: false, error: 'auth/invalid-credential' }), { type: 'NONE', error: 'auth/invalid-credential' });
        assert.deepEqual(terminalAuthEvent({ named: false, stalled: false, error: null }), { type: 'NONE', error: null });
    });
    // Whole-app review, Oct 2026: three retries on a weak connection ended as NONE, and every write
    // page then cleared the 60-day session — a slow network signing people out by another route.
    test('a failure that never reached an answer is TRANSIENT as well — the session is kept', () => {
        for (const code of ['auth/network-request-failed', 'auth/reset-check-unavailable', 'auth/internal-error', 'auth/too-many-requests']) {
            assert.deepEqual(terminalAuthEvent({ named: false, stalled: false, error: code }), { type: 'TRANSIENT', error: code }, code);
        }
    });
});

// ── AN ADMIN RESET SIGNS OTHER DEVICES OUT, AND THEY STAY OUT (Oct 2026 production review) ───────
// A reset sets the password back to the surname and revokes refresh tokens. The device it was aimed
// at — a lost phone still holding the 60-day local session — then re-signed in SILENTLY with that
// same surname on its next load, because the no-typed-password path tries exactly that. These pin
// the refusal: a silent re-sign-in on a session older than the last reset ends the session instead.
describe('a silent re-sign-in after an admin reset', () => {
    const NOW = Date.now();
    beforeEach(() => {
        _existingUser = null;
        _signInBehavior = 'ok';
        _signInCalls = 0;
        _signOutCalled = false;
        _resetAtMs = 0;
        _probeCalls = 0;
    });
    afterEach(() => { _resetAtMs = 0; store.delete(AUTH_KEY); });
    const sessionCreatedAt = (/** @type {number} */ ms) =>
        store.set(AUTH_KEY, JSON.stringify({ name: 'G. Miller', ver: SESSION_VER, expiry: ms + SESSION_MS, createdAt: ms }));

    test('a session OLDER than the reset is refused BEFORE any sign-in, and ended', async () => {
        // The order is the fix (same-day bug check): a sign-in announces and stores the user, so a
        // refusal that came after it let the Calendar's late-identity watcher grant the phone first,
        // and a reload mid-check came back through the stored user. The SDK must never be reached.
        sessionCreatedAt(NOW - 3 * 86_400_000);
        store.set(CALENDAR_SNAPSHOT, '{"member":"G. Miller"}');
        _resetAtMs = NOW - 86_400_000;
        const releasedBefore = _pushReleases.length;
        assert.equal(await ensureFirebaseSession('G. Miller'), false);
        assert.equal(_probeCalls, 1, 'the reset was asked about');
        assert.equal(_signInCalls, 0, 'and the app never signed in — nothing was announced or stored');
        assert.equal(store.has(AUTH_KEY), false, 'the local session survived — the next load would try again');
        // The member's own stored roster goes with the session it belongs to (CALENDAR_DATA.md 17):
        // the lost phone the reset was aimed at must not go on showing it, labelled, to whoever has it.
        assert.equal(store.has(CALENDAR_SNAPSHOT), false, 'the refused device kept the member\'s stored roster');
        assert.equal(getFirebaseIdentity(), 'none');
        // NAMED (Nov 2026 review): this refusal recorded no code, so it read as a sign-in that ended for
        // no reason. Its own code, and not a transient one — the session is gone; nothing may retry it.
        assert.equal(getFirebaseAuthError(), 'auth/session-predates-reset');
        assert.equal(isTransientAuthError('auth/session-predates-reset'), false);
        assert.equal(terminalAuthEvent({ named: false, stalled: false, error: getFirebaseAuthError() }).type, 'NONE');
        // The device the reset was meant to sign out stops receiving that member's notices too.
        // Fire-and-forget behind a dynamic import, so give it a few turns of the loop to land.
        for (let i = 0; i < 50 && _pushReleases.length === releasedBefore; i++) await new Promise(r => setTimeout(r, 5));
        assert.equal(_pushReleases.length, releasedBefore + 1, 'the refused device releases its push record');
    });

    test('a session created AFTER the reset (the member typed a password since) is let through', async () => {
        _resetAtMs = NOW - 3 * 86_400_000;
        sessionCreatedAt(NOW - 86_400_000);
        assert.equal(await ensureFirebaseSession('G. Miller'), true);
        assert.equal(store.has(AUTH_KEY), true);
    });

    test('never reset: unaffected', async () => {
        sessionCreatedAt(NOW - 30 * 86_400_000);
        assert.equal(await ensureFirebaseSession('G. Miller'), true);
    });

    test('an UNKNOWN reset time does not sign in silently — but destroys nothing', async () => {
        // A slow read on station signal is not evidence of a reset: the member keeps their session and
        // their stored roster, exactly as when the sign-in itself cannot reach the server.
        sessionCreatedAt(NOW - 86_400_000);
        store.set(CALENDAR_SNAPSHOT, '{"kept":true}');
        _resetAtMs = null;
        assert.equal(await ensureFirebaseSession('G. Miller'), false);
        assert.equal(_signInCalls, 0);
        assert.equal(store.has(AUTH_KEY), true, 'the session stays for the next attempt');
        assert.equal(store.has(CALENDAR_SNAPSHOT), true, 'and so does the stored roster');
        // Named, and transient (v24.70 bug check): an unrecorded hold left the page with no error to
        // read and no retry, so a Calendar on station signal stayed locked until the next full load.
        assert.equal(getFirebaseAuthError(), 'auth/reset-check-unavailable');
        store.delete(CALENDAR_SNAPSHOT);
    });

    test('a THROTTLED probe is held under the throttle\'s own code, and never reaches the SDK', async () => {
        // Retrying a throttled password check would only extend the lock-out it is reporting.
        sessionCreatedAt(NOW - 86_400_000);
        _resetAtMs = 'throttled';
        assert.equal(await ensureFirebaseSession('G. Miller'), false);
        assert.equal(_signInCalls, 0);
        assert.equal(getFirebaseAuthError(), 'auth/too-many-requests');
        assert.equal(store.has(AUTH_KEY), true, 'nothing is destroyed');
    });

    test('a surname the probe says is WRONG stops there: remembered, and never sent again to the SDK (review, Nov 2026)', async () => {
        // The probe IS a password sign-in. Going on to the SDK with the same surname sent a second
        // doomed request from the station's one shared address, the throttle the memory exists to spare.
        const FLAG_ = 'myb_auth_nodefault_G. Miller';
        sessionCreatedAt(NOW - 86_400_000);
        _resetAtMs = 'credential';
        _signInBehavior = 'auth/wrong-password';
        assert.equal(store.has(FLAG_), false, 'premise: this device has never seen the surname refused');
        assert.equal(await ensureFirebaseSession('G. Miller'), false);
        assert.equal(_probeCalls, 1, 'the reset was asked about, which is the one request');
        assert.equal(_signInCalls, 0, 'the refused surname was sent to the SDK as well');
        assert.ok(Number(store.get(FLAG_)) > Date.now() - 60_000, 'the refusal was not remembered, with when');
        assert.equal(getFirebaseIdentity(), 'none');
        assert.equal(getFirebaseAuthError(), 'auth/invalid-credential', 'a refusal, under the code the SDK\'s would carry');
        assert.equal(terminalAuthEvent({ named: false, stalled: false, error: getFirebaseAuthError() ?? null }).type, 'NONE');
        assert.equal(store.has(AUTH_KEY), true, 'nothing was reset, so the session is not ended here');
        // The next load: the flag holds, so nothing at all is asked.
        assert.equal(await ensureFirebaseSession('G. Miller'), false);
        assert.equal(_probeCalls + _signInCalls, 1, 'a flagged device asked again inside 6 hours');
        store.delete(FLAG_);
    });

    test('a session written before `createdAt` existed is dated from its expiry', async () => {
        store.set(AUTH_KEY, JSON.stringify({ name: 'G. Miller', ver: SESSION_VER, expiry: NOW - 3 * 86_400_000 + SESSION_MS }));
        _resetAtMs = NOW - 86_400_000;
        assert.equal(await ensureFirebaseSession('G. Miller'), false);
        // …and the LET-THROUGH half, which is the one that proves the expiry is read at all. A missing
        // creation time fails closed (`sessionPredatesReset`), so the refusal above held with the
        // expiry ignored entirely (test audit, 7 Nov 2026).
        store.set(AUTH_KEY, JSON.stringify({ name: 'G. Miller', ver: SESSION_VER, expiry: NOW - 86_400_000 + SESSION_MS }));
        _resetAtMs = NOW - 3 * 86_400_000;
        assert.equal(await ensureFirebaseSession('G. Miller'), true, 'dated from its expiry, it began AFTER the reset');
    });

    test('a TYPED password is never refused by it — that is how the member gets back in', async () => {
        sessionCreatedAt(NOW - 3 * 86_400_000);
        _resetAtMs = NOW - 86_400_000;
        assert.equal(await ensureFirebaseSession('G. Miller', undefined, 'miller'), true);
        assert.equal(_probeCalls, 0, 'a typed password is not probed at all');
    });

    test('saveSession records when the session began', () => {
        saveSession('G. Miller');
        const s = JSON.parse(store.get(AUTH_KEY));
        assert.ok(Math.abs(s.createdAt - Date.now()) < 5000);
        assert.equal(s.expiry - s.createdAt, SESSION_MS);
    });

    // ── THE START IS THE SERVER'S, NOT A WRONG DEVICE CLOCK (audit A2) ──────────────────────────────
    // A phone a day ahead at sign-in stamped its start a day late, so a reset made later that day looked
    // OLDER than the session, and the surname signed the phone the reset was aimed at straight back in.
    const signedInAt = (/** @type {number} */ ms, email = nameToEmail('G. Miller')) => {
        mockAuth.currentUser = { uid: 'uid-miller', isAnonymous: false, email, metadata: { lastSignInTime: new Date(ms).toUTCString() } };
    };
    const saved = () => JSON.parse(store.get(AUTH_KEY));
    const toSecond = (/** @type {number} */ ms) => Math.floor(ms / 1000) * 1000;   // all a UTC string keeps

    test('a device clock a day AHEAD: the session starts when the server says the member signed in', () => {
        const server = toSecond(Date.now() - 86_400_000);
        signedInAt(server);
        saveSession('G. Miller');
        assert.equal(saved().createdAt, server, 'the session was dated by a device clock a day ahead');
        assert.equal(saved().expiry, server + SESSION_MS, 'and its 60 days are counted from the same start');
    });

    test('…and a day BEHIND, the same', () => {
        const server = toSecond(Date.now() + 86_400_000);
        signedInAt(server);
        saveSession('G. Miller');
        assert.equal(saved().createdAt, server);
    });

    test('no record of the sign-in, another member\'s account, a record days away, or nobody: the device clock, as before', () => {
        for (const [why, set] of /** @type {const} */ ([
            ['no metadata', () => { mockAuth.currentUser = { uid: 'uid-miller', isAnonymous: false, email: nameToEmail('G. Miller') }; }],
            ['another account', () => signedInAt(Date.now() - 86_400_000, nameToEmail('S. Silva'))],
            ['four days away', () => signedInAt(Date.now() - 4 * 86_400_000)],
            ['nobody signed in', () => { mockAuth.currentUser = null; }],
        ])) {
            set();
            const before = Date.now();
            saveSession('G. Miller');
            assert.ok(saved().createdAt >= before && saved().createdAt <= Date.now(), `${why}: not dated by the device clock`);
        }
    });

    test('THE CASE ITSELF: signed in on a clock a day ahead, reset that afternoon — the surname does not sign it back in', async () => {
        const signedIn = toSecond(Date.now() - 86_400_000);   // the server's clock; the device's said "now"
        signedInAt(signedIn);
        saveSession('G. Miller');
        mockAuth.currentUser = null;                          // the reset revoked the account's tokens
        _resetAtMs = signedIn + 2 * 3_600_000;                // made two hours after the sign-in
        assert.equal(await ensureFirebaseSession('G. Miller'), false);
        assert.equal(_signInCalls, 0, 'the surname signed the phone the reset was aimed at straight back in');
        assert.equal(store.has(AUTH_KEY), false, 'and its session was left standing');
    });
});

