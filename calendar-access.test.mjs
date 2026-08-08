/**
 * calendar-access.test.mjs — the unlock exchange and the viewer session lifecycle.
 * Run: node --experimental-test-module-mocks --test calendar-access.test.mjs
 *
 * `calendar-access-core.test.mjs` covers the pure decisions. This file covers the part that talks to
 * the network and to Firebase, because that is where the failure modes are STATEFUL — a half-signed-
 * in browser, a persistence mode left in the wrong place, a token accepted without its claim — and
 * none of those is visible from a pure function.
 *
 * Everything asserts on ORDER as much as on outcome. Two of the three security properties here are
 * orderings rather than values:
 *   · sign out the old identity BEFORE switching persistence (or the old one migrates into the new
 *     mode — which for the viewer means surviving the browser closing, the one thing that must not
 *     happen);
 *   · verify the CLAIM before granting anything (a token without it signs in perfectly and then has
 *     every read denied, leaving an unlocked-looking Calendar with no shifts on it).
 *
 * The fake DOM is deliberately minimal: this file tests the module's decisions, not its markup. The
 * card's appearance and behaviour under a real browser are e2e's job (`e2e/calendar-pin.spec.js`).
 */
import { test, describe, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ── Fakes ───────────────────────────────────────────────────────────────────────────────────────

/** Ordered log of every auth-affecting operation, so ORDER can be asserted, not just outcome. */
let ops = [];
let currentUser = null;
/** What `getIdTokenResult()` will report. */
let tokenClaims = { calendarViewer: true };
let sessionValue = null;
/** Queue of fetch outcomes: `{ ok, status, json }` or an Error to throw. */
let fetchQueue = [];
let lastFetchBody = null;

const auth = { get currentUser() { return currentUser; } };

mock.module('./firebase-client.js', {
    namedExports: {
        auth,
        signInWithCustomToken: async (_a, token) => {
            ops.push('signIn:' + token);
            if (token === 'BAD_TOKEN') { const e = new Error('bad'); e.code = 'auth/invalid-custom-token'; throw e; }
            currentUser = {
                uid: 'calendar-viewer', isAnonymous: false,
                getIdTokenResult: async () => ({ claims: tokenClaims }),
            };
            return { user: currentUser };
        },
        signOut: async () => { ops.push('signOut'); currentUser = null; },
        setViewerPersistence: async () => { ops.push('persistence:session'); },
        restoreMemberPersistence: async () => { ops.push('persistence:member'); },
        onAuthStateChanged: (_a, cb) => { cb(currentUser); return () => {}; },
    },
});

mock.module('./session.js', {
    namedExports: {
        getSession: () => sessionValue,
        reconcileExpiredIdentity: async (opts) => { ops.push('reconcile:' + JSON.stringify(opts || {})); },
    },
});

mock.module('./roster-data.js', {
    namedExports: { CONFIG: { CALENDAR_PIN_ACCESS: true } },
});

const {
    unlockWithPin, getAccessType, isViewerMode, initCalendarAccess, lockCalendar, handleAccessLost,
} = await import('./calendar-access.js');

// A DOM just rich enough for the module to build and query its card.
/** @param {boolean} online */
function setOnline(online) {
    Object.defineProperty(globalThis, 'navigator', {
        value: { onLine: online }, configurable: true, writable: true,
    });
}

function fakeDom() {
    /** @type {any} */
    const nodes = new Map();
    const el = (id) => {
        if (!nodes.has(id)) nodes.set(id, mkEl(id));
        return nodes.get(id);
    };
    function mkEl(id) {
        return {
            id, value: '', textContent: '', disabled: false, hidden: false,
            _attrs: new Map(), _children: [], _listeners: new Map(), classList: mkClassList(),
            innerHTML: '',
            setAttribute(k, v) { this._attrs.set(k, v); if (k === 'hidden') this.hidden = true; },
            removeAttribute(k) { this._attrs.delete(k); if (k === 'hidden') this.hidden = false; },
            getAttribute(k) { return this._attrs.has(k) ? this._attrs.get(k) : null; },
            appendChild(c) { this._children.push(c); return c; },
            remove() {},
            focus() {},
            addEventListener(t, fn) { this._listeners.set(t, fn); },
            querySelector(sel) { return el(sel.replace('#', '')); },
        };
    }
    function mkClassList() {
        const set = new Set();
        return { add: (c) => set.add(c), remove: (c) => set.delete(c), toggle: (c, on) => (on ? set.add(c) : set.delete(c)), contains: (c) => set.has(c), _set: set };
    }
    globalThis.document = {
        body: mkEl('body'),
        getElementById: (id) => (nodes.has(id) ? nodes.get(id) : null),
        createElement: () => mkEl('created'),
        querySelector: (sel) => el(sel),
    };
    globalThis.window = { matchMedia: () => ({ matches: false }), location: { replace() {}, reload() {} } };
    // Node 22 defines `navigator` as a getter-only global, so a plain assignment throws. The
    // module only reads `navigator.onLine`, so redefining the property is both sufficient and the
    // only thing that works here.
    setOnline(true);
    return { el, nodes };
}

beforeEach(() => {
    ops = [];
    currentUser = null;
    tokenClaims = { calendarViewer: true };
    sessionValue = null;
    fetchQueue = [];
    lastFetchBody = null;
    fakeDom();
    // Reset the module's own access state between tests. `_accessType` is module-level (it has to
    // be — the whole app asks one module "may this browser see the roster?"), so without this a
    // successful unlock in one test would leave every later test starting from `viewer` and the
    // "stays locked" assertions would pass for the wrong reason.
    handleAccessLost();
    globalThis.fetch = async (_url, opts) => {
        lastFetchBody = opts && opts.body ? JSON.parse(opts.body) : null;
        const next = fetchQueue.shift();
        if (next instanceof Error) throw next;
        return next || { ok: true, status: 200, json: async () => ({ token: 'GOOD_TOKEN' }) };
    };
});

// ── The exchange ────────────────────────────────────────────────────────────────────────────────

describe('unlockWithPin — the happy path', () => {
    test('a correct PIN signs in as the viewer and grants access', async () => {
        const r = await unlockWithPin('1234');
        assert.deepEqual(r, { ok: true });
        assert.equal(getAccessType(), 'viewer');
        assert.equal(isViewerMode(), true);
    });

    test('THE ORDER: sign out, THEN switch persistence, THEN sign in', async () => {
        // If persistence were switched while another identity was current, `setPersistence` would
        // MIGRATE that identity into the new mode. For the viewer that means session-only becomes
        // whatever was there before — and the shared office session survives the browser closing,
        // which is the single property the whole feature rests on.
        currentUser = { uid: 'someone-else', isAnonymous: false };
        await unlockWithPin('1234');
        const relevant = ops.filter(o => o === 'signOut' || o === 'persistence:session' || o.startsWith('signIn:'));
        assert.deepEqual(relevant, ['signOut', 'persistence:session', 'signIn:GOOD_TOKEN']);
    });

    test('the PIN is sent as the request body and nothing else is', async () => {
        await unlockWithPin('4821');
        assert.deepEqual(lastFetchBody, { pin: '4821' });
    });
});

describe('unlockWithPin — every failure leaves the Calendar LOCKED', () => {
    test('a malformed PIN never reaches the network', async () => {
        let called = false;
        globalThis.fetch = async () => { called = true; return { ok: true, status: 200, json: async () => ({}) }; };
        const r = await unlockWithPin('12');
        assert.equal(r.ok, false);
        assert.equal(called, false, 'a short PIN was sent to the server');
        assert.equal(getAccessType(), 'none');
    });

    test('a rejected PIN (401) stays locked and says so without naming a number', async () => {
        fetchQueue = [{ ok: false, status: 401, json: async () => ({}) }];
        const r = await unlockWithPin('0000');
        assert.equal(r.ok, false);
        assert.equal(r.kind, 'rejected');
        assert.equal(getAccessType(), 'none');
        assert.equal(/\d/.test(r.message), false);
    });

    test('a throttled attempt (429) is distinguishable from a wrong PIN', async () => {
        // The member needs to know that waiting will help, which "PIN not recognised" would not say.
        fetchQueue = [{ ok: false, status: 429, json: async () => ({}) }];
        const r = await unlockWithPin('1234');
        assert.equal(r.kind, 'throttled');
        assert.equal(getAccessType(), 'none');
    });

    test('a thrown fetch is a network failure, and is RECOVERABLE', async () => {
        fetchQueue = [new Error('offline-ish')];
        const r = await unlockWithPin('1234');
        assert.equal(r.kind, 'network');
        assert.equal(getAccessType(), 'none');
        // The next attempt must work — a transport failure must not poison module state.
        fetchQueue = [];
        assert.deepEqual(await unlockWithPin('1234'), { ok: true });
    });

    test('a 200 with NO token is a server failure, not a silent success', async () => {
        fetchQueue = [{ ok: true, status: 200, json: async () => ({}) }];
        const r = await unlockWithPin('1234');
        assert.equal(r.ok, false);
        assert.equal(getAccessType(), 'none');
        assert.equal(ops.some(o => o.startsWith('signIn:')), false);
    });

    test('a 200 with UNPARSEABLE json is a server failure', async () => {
        fetchQueue = [{ ok: true, status: 200, json: async () => { throw new Error('not json'); } }];
        assert.equal((await unlockWithPin('1234')).ok, false);
        assert.equal(getAccessType(), 'none');
    });

    test('OFFLINE is caught before the request, with words that help', async () => {
        setOnline(false);
        let called = false;
        globalThis.fetch = async () => { called = true; return { ok: true, status: 200, json: async () => ({}) }; };
        const r = await unlockWithPin('1234');
        assert.equal(r.kind, 'offline');
        assert.equal(called, false);
        assert.match(r.message, /online/i);
    });

    test('a custom-token sign-in failure leaves NO half-authenticated state', async () => {
        fetchQueue = [{ ok: true, status: 200, json: async () => ({ token: 'BAD_TOKEN' }) }];
        const r = await unlockWithPin('1234');
        assert.equal(r.ok, false);
        assert.equal(r.kind, 'auth');
        assert.equal(getAccessType(), 'none');
        assert.equal(currentUser, null, 'a failed sign-in left a user behind');
        assert.ok(ops.includes('signOut'), 'the failed attempt was not cleaned up');
    });
});

describe('THE CLAIM IS VERIFIED — a token is not trusted for what it says on the tin', () => {
    test('a token that signs in but carries NO viewer claim is refused', async () => {
        // This is the quietest possible failure if it is not checked: sign-in succeeds, the Calendar
        // renders, and every override read is denied — so the member sees an unlocked Calendar with
        // no shifts on it and no error anywhere. Better to stay locked and say so.
        tokenClaims = {};
        const r = await unlockWithPin('1234');
        assert.equal(r.ok, false);
        assert.equal(getAccessType(), 'none');
        assert.equal(currentUser, null, 'the claimless identity was left signed in');
    });

    test('a token carrying the claim as a STRING is refused — `true` means true', async () => {
        tokenClaims = { calendarViewer: 'true' };
        assert.equal((await unlockWithPin('1234')).ok, false);
        assert.equal(getAccessType(), 'none');
    });

    test('a token carrying MEMBER claims instead of the capability is refused', async () => {
        tokenClaims = { name: 'G. Miller', admin: true };
        assert.equal((await unlockWithPin('1234')).ok, false);
        assert.equal(getAccessType(), 'none');
    });
});

// ── Boot ────────────────────────────────────────────────────────────────────────────────────────

describe('initCalendarAccess', () => {
    test('a live named session starts the Calendar with NO PIN', async () => {
        sessionValue = { name: 'G. Miller' };
        currentUser = { uid: 'member-1', isAnonymous: false };
        let started = 0;
        const type = await initCalendarAccess({ onGranted: () => { started++; } });
        assert.equal(type, 'named');
        assert.equal(started, 1);
        assert.equal(document.getElementById('calendarLock'), null, 'the PIN card was built for a member');
    });

    test('a restored VIEWER session starts the Calendar with no PIN', async () => {
        currentUser = { uid: 'calendar-viewer', isAnonymous: false };
        let started = 0;
        const type = await initCalendarAccess({ onGranted: () => { started++; } });
        assert.equal(type, 'viewer');
        assert.equal(started, 1);
    });

    test('nothing at all → locked, and the workspace is NEVER started', async () => {
        let started = 0;
        const type = await initCalendarAccess({ onGranted: () => { started++; } });
        assert.equal(type, 'none');
        assert.equal(started, 0, 'the Calendar was built while locked');
    });

    test('an ANONYMOUS identity is locked out — the old bootstrap grants nothing', async () => {
        currentUser = { uid: 'anon', isAnonymous: true };
        let started = 0;
        assert.equal(await initCalendarAccess({ onGranted: () => { started++; } }), 'none');
        assert.equal(started, 0);
    });

    test('it asks reconcile to PRESERVE the viewer — otherwise the PIN is demanded every load', async () => {
        // `reconcileExpiredIdentity`'s default is to sign out any non-anonymous identity with no
        // local session, which is the viewer's exact shape. Without the flag the Calendar would
        // tear down its own access on every single navigation.
        currentUser = { uid: 'calendar-viewer', isAnonymous: false };
        await initCalendarAccess({ onGranted: () => {} });
        assert.ok(ops.some(o => o === 'reconcile:{"preserveCalendarViewer":true}'),
            `reconcile was not asked to preserve the viewer: ${JSON.stringify(ops)}`);
    });

    test('a workspace callback that THROWS does not stop access resolving', async () => {
        // The gate's job is the decision. A rendering fault downstream is the coordinator's problem,
        // and swallowing the decision with it would leave the page locked with no card and no cause.
        sessionValue = { name: 'G. Miller' };
        currentUser = { uid: 'member-1', isAnonymous: false };
        const type = await initCalendarAccess({ onGranted: () => { throw new Error('render blew up'); } });
        assert.equal(type, 'named');
    });
});

describe('lockCalendar + handleAccessLost', () => {
    test('locking signs the viewer out', async () => {
        await unlockWithPin('1234');
        assert.equal(isViewerMode(), true);
        ops = [];
        await lockCalendar();
        assert.ok(ops.includes('signOut'));
    });

    test('locking is a NO-OP for a member — it can never touch a real session', async () => {
        sessionValue = { name: 'G. Miller' };
        currentUser = { uid: 'member-1', isAnonymous: false };
        await initCalendarAccess({ onGranted: () => {} });
        ops = [];
        await lockCalendar();
        assert.deepEqual(ops, [], 'lockCalendar signed a member out');
        assert.equal(getAccessType(), 'named');
    });

    test('losing access mid-session drops back to locked rather than looping on retry', async () => {
        // A Firestore `permission-denied` after the Calendar is open means the session expired, not
        // that the network is poor. Left as a sync-chip retry it is a loop the member cannot win.
        await unlockWithPin('1234');
        handleAccessLost();
        assert.equal(getAccessType(), 'none');
    });

    test('handleAccessLost is a no-op when already locked', () => {
        handleAccessLost();
        assert.equal(getAccessType(), 'none');
    });
});

describe('the viewer↔member race', () => {
    test('unlocking is REFUSED once a member has signed in behind the card', async () => {
        // Reachable through "Sign in instead", or through another tab. The unlock ladder begins by
        // clearing whoever is current, so going ahead would sign a real member out and put a shared
        // capability in their place — an identity DOWNGRADE triggered by a stale button.
        let reloads = 0;
        globalThis.window.location.reload = () => { reloads++; };
        sessionValue = { name: 'G. Miller' };
        currentUser = { uid: 'member-1', isAnonymous: false };
        ops = [];

        const r = await unlockWithPin('1234');
        assert.equal(r.ok, true);
        assert.equal(reloads, 1, 'it should reload into the named decision, not unlock');
        assert.equal(ops.filter(o => o === 'signOut').length, 0, 'the member was signed out');
        assert.equal(ops.some(o => o.startsWith('signIn:')), false, 'a viewer token was still redeemed');
    });

    test('a VIEWER holding a stale local session may still unlock', async () => {
        // The guard is about a live MEMBER identity, not about a session record. A viewer whose
        // browser still holds an expired-but-present session must not be locked out of re-unlocking.
        sessionValue = { name: 'G. Miller' };
        currentUser = { uid: 'calendar-viewer', isAnonymous: false };
        assert.deepEqual(await unlockWithPin('1234'), { ok: true });
    });
});
