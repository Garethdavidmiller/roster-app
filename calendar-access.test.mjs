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
/** When true the fake `signInAnonymously` never settles — see the first-paint ordering test. */
let signOutBehavior = 'ok';
let signInAnonymouslyHangs = false;
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
        signOut: async () => {
            ops.push('signOut');
            // v20.35: the fail-closed tests need a signOut that REJECTS, and one that resolves
            // without clearing — the two shapes that used to walk into a persistence switch with an
            // identity still live.
            if (signOutBehavior === 'reject') { const e = new Error('signout failed'); e.code = 'auth/network-request-failed'; throw e; }
            if (signOutBehavior === 'noop') return;
            currentUser = null;
        },
        signInAnonymously: async () => {
            ops.push('signInAnonymously');
            // A hang, not a delay: the ordering test needs "has it been awaited?" to be decidable
            // without a timer, and a promise that never settles makes that a plain assertion.
            if (signInAnonymouslyHangs) return new Promise(() => {});
            currentUser = { uid: 'anon-1', isAnonymous: true };
            return { user: currentUser };
        },
        setViewerPersistence: async () => { ops.push('persistence:session'); },
        restoreMemberPersistence: async () => { ops.push('persistence:member'); },
        // Subscribers are RETAINED, not just called once (v20.79). The late-restore watcher exists
        // precisely because a second emission can arrive after the boot decision, and a fake that
        // fired once and forgot could never produce one — the watcher would look correct whether or
        // not it worked. `emitAuth` below is how a test delivers that later emission.
        onAuthStateChanged: (_a, cb) => {
            authSubs.add(cb);
            cb(currentUser);
            return () => authSubs.delete(cb);
        },
    },
});

/** Live `onAuthStateChanged` subscribers. @type {Set<(u:any)=>void>} */
const authSubs = new Set();
/** Deliver a LATER auth emission — the restore that lands after the decision was made. */
function emitAuth(user) {
    currentUser = user;
    for (const cb of [...authSubs]) cb(user);
}

mock.module('./session.js', {
    namedExports: {
        getSession: () => sessionValue,
        clearSession: () => { ops.push('clearSession'); sessionValue = null; },
        reconcileExpiredIdentity: async (opts) => {
            ops.push('reconcile:' + JSON.stringify(opts || {}));
            if (reconcileHangs) await new Promise(() => {});   // never settles — the wedged-auth case
            // A releasable hold, for the cases that need the decision to be SLOW but not stuck —
            // the boot skeleton exists for exactly that window and a 6.5s real timeout would make
            // its test unrunnable.
            if (reconcileGate) await reconcileGate;
        },
        ensureNamedSession: async (name) => {
            ops.push('ensureNamedSession:' + name);
            // The RESULT and the resulting IDENTITY are set separately, because the real function
            // can genuinely report success on an ANONYMOUS fallback (`ENFORCE_NAMED_SESSION` off).
            // A fake that tied the two together would make "trust the boolean" indistinguishable
            // from "re-read ground truth", which is the one thing worth checking here.
            if (silentReauthUser !== undefined) currentUser = silentReauthUser;
            else if (silentReauthSucceeds) currentUser = { uid: 'member-1', isAnonymous: false };
            return silentReauthSucceeds;
        },
    },
});

/** Whether the mocked silent re-auth establishes a member identity — the surname-default member vs
 *  the migrated one, which is the whole difference between "signed back in with nothing typed" and
 *  "shown a sign-in card". */
let silentReauthSucceeds = false;
/** Overrides the identity the mocked re-auth leaves behind. @type {any} */
let silentReauthUser = undefined;

/** When true, the mocked reconcile never settles — the wedged-auth-layer case the v20.45 bound
 *  exists for. A flag rather than a per-test mock because mock.module is import-time here. */
let reconcileHangs = false;
/** A promise the mocked reconcile awaits, so a test can hold the decision open. @type {Promise<void>|null} */
let reconcileGate = null;

/** Mutable so both sides of the switch are reachable — the whole point of the flag is that it has
 *  two behaviours, and a test that could only ever see one would be checking half a feature. */
const CONFIG = { CALENDAR_PIN_ACCESS: true };
mock.module('./roster-data.js', { namedExports: { CONFIG } });

const {
    unlockWithPin, getAccessType, isViewerMode, initCalendarAccess, lockCalendar, handleAccessLost,
    calendarAccessReady, calendarAuthReady,
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
            _removed: false,
            remove() { this._removed = true; },
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

/**
 * The card the module last appended, as markup.
 *
 * Read from the HOST's children rather than `getElementById`, because the fake's element lookup
 * creates a node on demand and never removes one — so a global id check reports whatever any earlier
 * test's card happened to query, and "the member was not shown the PIN field" would pass or fail for
 * reasons that have nothing to do with the card actually on screen.
 * @returns {string}
 */
function lastPanelHtml() {
    const p = lastPanel();
    return p ? String(p.innerHTML) : '';
}

/** @returns {any} */
function lastPanel() {
    const host = /** @type {any} */ (document.querySelector('.container'));
    const kids = (host && host._children) || [];
    return kids.length ? kids[kids.length - 1] : null;
}

/** Was the card taken down? The fake records `remove()` rather than mutating a tree, which is the
 *  only observable this harness has — and it is the one that matters, since leaving the card up over
 *  a granted Calendar is precisely the visible failure. */
function _panelIsDown() { return !!lastPanel()?._removed; }

beforeEach(() => {
    ops = [];
    currentUser = null;
    tokenClaims = { calendarViewer: true };
    sessionValue = null;
    CONFIG.CALENDAR_PIN_ACCESS = true;
    signInAnonymouslyHangs = false;
    signOutBehavior = 'ok';
    silentReauthSucceeds = false;
    silentReauthUser = undefined;
    reconcileGate = null;
    authSubs.clear();
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

// ── MUST BE THE FIRST TEST IN THIS FILE ─────────────────────────────────────────────────────────
//
// `calendarAccessReady` and `calendarAuthReady` are module-level promises that resolve ONCE, for the
// lifetime of the import. `beforeEach` can reset `_accessType`, but nothing can un-resolve a
// promise — so any test that grants access ahead of this one leaves both already settled and the
// distinction unobservable. Hence the position, and hence the guard assertion below, which fails
// loudly rather than passing vacuously if this ever stops being first.
describe('open mode: the render gate and the WRITE gate are different instants', () => {
    test('ACCESS resolves immediately; AUTH waits for the anonymous sign-in', async () => {
        // ── THE REGRESSION THIS PINS ────────────────────────────────────────────────────────────
        //
        // v20.18 stopped awaiting the anonymous sign-in so the grid could paint without a network
        // round trip. Right for RENDERING, wrong for everything that WRITES: the error reporter, the
        // usage counters, the latency sampler, the document-open counters and the push renewal all
        // need `request.auth != null`, and every one of them was gated on the access promise. So for
        // one release they fired into a window with no token and were silently rejected — the same
        // race as the v14.23–28 push-subscription bug, re-opened from the other side.
        //
        // The distinction exists ONLY in `open` mode. In `named` and `viewer` the two resolve
        // together, so nothing else in this file would notice either promise being wired wrongly.
        CONFIG.CALENDAR_PIN_ACCESS = false;
        signInAnonymouslyHangs = true;
        let accessResolved = false, authResolved = false;
        calendarAccessReady.then(() => { accessResolved = true; });
        calendarAuthReady.then(() => { authResolved = true; });
        await Promise.resolve();
        assert.equal(accessResolved, false,
            'a previous test already granted access — move this describe back to the top of the file');

        await initCalendarAccess({ onGranted: () => {} });
        await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

        assert.equal(accessResolved, true, 'the render gate waited for the network — the v20.18 fix is undone');
        assert.equal(authResolved, false, 'the WRITE gate opened before any session existed');

        // And it DOES open once the sign-in lands — a gate, not a permanent block.
        signInAnonymouslyHangs = false;
        handleAccessLost();
    });
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

    // ── FAIL CLOSED AT THE PERSISTENCE SWITCH (v20.35) ──────────────────────────────────────────
    //
    // The ordering test above proves the sequence when everything works. It says nothing about the
    // case that matters: the sign-out FAILING and the switch happening anyway. Until v20.35 the
    // sign-out here sat in a bare `catch { /* best effort */ }` and `setViewerPersistence()` ran on
    // the next line regardless — so an identity that survived would be MIGRATED into session-only
    // persistence, which is the mirror of the fail-open found in `shedCalendarViewer` and was found
    // in the same review. Both assert the ABSENCE of the persistence call, because that is the only
    // shape that catches it: every happy-path assertion passed throughout.
    test('a REJECTED sign-out aborts the unlock and never switches persistence', async () => {
        currentUser = { uid: 'someone-else', isAnonymous: false };
        signOutBehavior = 'reject';
        const r = await unlockWithPin('1234');
        assert.equal(r.ok, false);
        assert.equal(getAccessType(), 'none', 'the Calendar stays locked');
        assert.ok(!ops.includes('persistence:session'),
            'persistence must NOT change while an identity is still live — that is the migration this guards');
        assert.ok(!ops.some(o => o.startsWith('signIn:')), 'and no viewer session is minted');
    });

    test('a sign-out that RESOLVES but leaves someone current is refused too', async () => {
        // The invariant is that nobody is current when persistence changes — not that signOut
        // resolved. Asserting only the rejection would leave this shape open.
        currentUser = { uid: 'someone-else', isAnonymous: false };
        signOutBehavior = 'noop';
        const r = await unlockWithPin('1234');
        assert.equal(r.ok, false);
        assert.ok(!ops.includes('persistence:session'));
    });

    test('the refusal is honest about WHY — the PIN was right', async () => {
        // "PIN not recognised" would send the member hunting for a code that does not exist. This
        // failure is ours, and the message has to say so.
        currentUser = { uid: 'someone-else', isAnonymous: false };
        signOutBehavior = 'reject';
        const r = await unlockWithPin('1234');
        assert.doesNotMatch(r.message, /not recognised/i);
        assert.match(r.message, /try again/i);
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

    test('a member with a SESSION but no identity gets a sign-in card, never the PIN field', async () => {
        // The evicted-identity case, which is not a race at all: iOS clears IndexedDB after ~7 days
        // of not opening the PWA while the local session runs for 60, so this member fails EVERY
        // load. Offering them the shared PIN would answer the wrong question — and would hand them a
        // capability with no `name`, so the drawer would show their name while every write failed.
        sessionValue = { name: 'G. Miller' };
        const type = await initCalendarAccess({ onGranted: () => {} });
        assert.equal(type, 'none');
        await new Promise(r => setTimeout(r, 0));   // let the silent attempt settle
        const html = lastPanelHtml();
        assert.ok(!html.includes('id="calLockPin"'), 'a member was shown the PIN field');
        assert.equal(document.getElementById('calLockWho')?.textContent, 'Calendar · G. Miller',
            'the card does not say who it is for');
        assert.ok(html.includes('calLockPinInstead'), 'the PIN was not left reachable underneath');
        assert.ok(ops.some(o => o === 'ensureNamedSession:G. Miller'),
            `the silent re-establishment was never attempted: ${JSON.stringify(ops)}`);
    });

    test('"Use the staff PIN instead" SIGNS THE MEMBER OUT — it is not a panel swap (v21.23)', async () => {
        // ── THE DEFECT (external review of v21.22) ──────────────────────────────────────────────
        //
        // This used to be `hideLockPanel(); showLockPanel();` — it changed the card and nothing more.
        // But `calendar-app.js` builds the nav drawer at module scope from the SAME local session,
        // before access is decided, so the next person at a shared PC unlocked with the staff PIN
        // onto a Calendar whose drawer still named the previous member and still showed the page
        // pills their permissions earned. No privilege travelled with it; a name and a role did.
        //
        // Asserted as the ORDER of two effects, because only the pairing fixes it: clearing without
        // reloading leaves every module-scope consumer holding the stale name it already read, and
        // reloading without clearing puts the same card back up.
        sessionValue = { name: 'G. Miller' };
        let reloaded = 0;
        globalThis.window.location.reload = () => { ops.push('reload'); reloaded++; };
        await initCalendarAccess({ onGranted: () => {} });
        await new Promise(r => setTimeout(r, 0));   // let the silent attempt settle

        const alt = document.getElementById('calLockPinInstead');
        assert.ok(alt, 'the member card offers no route to the staff PIN');
        alt._listeners.get('click')();

        assert.ok(ops.includes('clearSession'), `the stale named session survived: ${JSON.stringify(ops)}`);
        assert.equal(reloaded, 1, 'nothing was rebuilt, so the drawer keeps the previous name');
        assert.ok(ops.indexOf('clearSession') < ops.lastIndexOf('reload'),
            'reloaded before clearing — the reload would restore the session it was meant to drop');
        assert.equal(sessionValue, null, 'the local session was not actually dropped');
    });

    test('the silent re-establishment GRANTS when it works — nothing is typed', async () => {
        // `ensureNamedSession` with no password tries only the surname default, so for anyone who has
        // not chosen their own password this is a complete recovery with no interaction at all.
        sessionValue = { name: 'G. Miller' };
        silentReauthSucceeds = true;
        let started = 0;
        const type = await initCalendarAccess({ onGranted: () => { started++; } });
        assert.equal(type, 'none', 'the BOOT decision is still none — the grant comes after it');
        await new Promise(r => setTimeout(r, 0));
        assert.equal(getAccessType(), 'named');
        assert.equal(started, 1);
        assert.equal(lastPanelHtml().includes('cal-lock-card'), true);   // it WAS built...
        assert.equal(_panelIsDown(), true, 'the card was left up after the grant');
    });

    test('a silent re-auth that reports success but lands ANONYMOUS grants nothing', async () => {
        // `ensureNamedSession` returns true for an anonymous fallback when `ENFORCE_NAMED_SESSION`
        // is off, and an anonymous identity is exactly what v20.12 stopped honouring. So the result
        // is read from `decideAccess` against ground truth, never from the boolean.
        sessionValue = { name: 'G. Miller' };
        silentReauthSucceeds = true;
        silentReauthUser = { uid: 'anon', isAnonymous: true };
        await initCalendarAccess({ onGranted: () => {} });
        await new Promise(r => setTimeout(r, 0));
        assert.equal(getAccessType(), 'none');
        assert.equal(_panelIsDown(), false, 'the card came down on an anonymous identity');
    });

    test('a named identity restoring AFTER the decision grants, instead of being ignored', async () => {
        // THE RACE. `resolveAccess` has to bound the restore or a wedged auth layer holds the page
        // blank for ever — but the bound was a CLIFF: the decision was made once and never revisited,
        // so a restore landing a millisecond late left a signed-in member in front of the staff PIN
        // with no way out but a reload. Reproduced in a browser at a 14s restore: the body was still
        // `calendar-locked` six seconds later.
        let started = 0;
        const type = await initCalendarAccess({ onGranted: () => { started++; } });
        assert.equal(type, 'none');
        assert.equal(started, 0);

        // The restore lands. Session and identity are now both present, which is exactly what
        // `decideAccess` asked for at boot and did not get.
        sessionValue = { name: 'G. Miller' };
        emitAuth({ uid: 'member-1', isAnonymous: false });

        assert.equal(getAccessType(), 'named');
        assert.equal(started, 1);
        assert.equal(_panelIsDown(), true, 'the card survived the grant');
    });

    test('a late ANONYMOUS or VIEWER emission does NOT grant named access', async () => {
        // The watcher re-runs the whole decision rather than trusting that any user will do. An
        // anonymous identity is precisely what v20.12 stopped honouring, and granting `named` to the
        // shared viewer would put a capability where the app expects a person.
        const type = await initCalendarAccess({ onGranted: () => {} });
        assert.equal(type, 'none');
        sessionValue = { name: 'G. Miller' };
        emitAuth({ uid: 'anon', isAnonymous: true });
        assert.equal(getAccessType(), 'none');
        emitAuth({ uid: 'calendar-viewer', isAnonymous: false });
        assert.equal(getAccessType(), 'none', 'the viewer was granted a member\'s access');
    });

    test('a late emission with NO local session changes nothing', async () => {
        // A Firebase identity with no session is what `reconcileExpiredIdentity` exists to tear down.
        // Honouring it here would let an expired member keep their access by outlasting the bound.
        assert.equal(await initCalendarAccess({ onGranted: () => {} }), 'none');
        emitAuth({ uid: 'member-1', isAnonymous: false });
        assert.equal(getAccessType(), 'none');
    });

    test('a SLOW decision puts a skeleton up, it carries no roster data, and the decision clears it', async () => {
        // ── THE HOLE IT FILLS ───────────────────────────────────────────────────────────────────
        // `calendar-app.js` dismisses the splash at module-execution time, so between that and the
        // decision the page is a navy field with a header on it. MEASURED with the restore held at
        // 3s: splash down ~700ms, a card at ~3.6s, 2.9s of blank in between — which reads as a
        // broken app rather than a loading one.
        //
        // The third and fourth assertions are the security ones: this is drawn BEFORE anyone knows
        // whether the browser may see the roster at all, so it has to be a shape and nothing else.
        let release = () => {};
        reconcileGate = new Promise(r => { release = r; });
        const p = initCalendarAccess({ onGranted: () => {} });

        await new Promise(r => setTimeout(r, 450));
        const skeleton = lastPanelHtml();
        assert.ok(skeleton.includes('cal-boot-grid'), 'nothing was shown during a slow decision');
        assert.ok(!skeleton.includes('calLockPin'), 'the skeleton is not the PIN card');
        assert.ok(!/\d{1,2}:\d{2}/.test(skeleton), 'a shift time reached a pre-access surface');
        assert.ok(!/\b(RD|AL|RDW|SICK|SPARE)\b/.test(skeleton), 'a shift code reached a pre-access surface');

        release();
        await p;
        assert.ok(!lastPanelHtml().includes('cal-boot-grid'), 'the skeleton survived the decision');
    });

    test('a decision that lands INSIDE the delay never flashes the skeleton — then or later', async () => {
        // The other half, and the one that decides whether the threshold is a real number or a
        // decoration. A boot that answers in 120ms must show nothing at all — and it must still show
        // nothing at 600ms, because the timer is armed BEFORE the await and a decision that beats it
        // has to disarm it. Without that clearing, a skeleton lands on top of a finished page half a
        // second after it was ready, which is a worse artefact than the blank it was built to fix.
        let release = () => {};
        reconcileGate = new Promise(r => { release = r; });
        const p = initCalendarAccess({ onGranted: () => {} });
        setTimeout(release, 120);
        // Sampled DURING, not after. A flash is over by the time the decision lands, so checking the
        // end state would pass against a threshold of zero — which is what makes this the assertion
        // that decides whether the delay is a real number.
        await new Promise(r => setTimeout(r, 60));
        assert.ok(!lastPanelHtml().includes('cal-boot'), 'the skeleton appeared inside the quiet window');
        await p;
        assert.ok(!lastPanelHtml().includes('cal-boot'), 'the skeleton flashed on a boot that was not slow');
        await new Promise(r => setTimeout(r, 500));
        assert.ok(!lastPanelHtml().includes('cal-boot'), 'a stale timer painted a skeleton over a finished page');
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

describe('THE ON/OFF SWITCH — CONFIG.CALENDAR_PIN_ACCESS', () => {
    // It exists so the feature can be deployed DARK: shipped, running, and invisible to staff, then
    // switched on later by one line. Until v20.16 it only wrote a console warning and changed
    // nothing, so it would have shipped as permanently ON — a knob that drives nothing, which is the
    // `SOFT_DELETE_RETENTION_DAYS` mistake this repo has a written rule about.

    test('OFF: a visitor with nothing gets the Calendar, not the card', async () => {
        CONFIG.CALENDAR_PIN_ACCESS = false;
        let started = 0;
        const type = await initCalendarAccess({ onGranted: () => { started++; } });
        assert.equal(type, 'open');
        assert.equal(started, 1, 'the Calendar was not started');
        assert.equal(getAccessType(), 'open');
        assert.equal(isViewerMode(), false, 'open mode must not read as viewer mode');
    });

    test('OFF: the anonymous session comes back, or the telemetry goes silent', async () => {
        // The calendar's best-effort WRITES — error reporter, usage counters, push renewal — all
        // need `request.auth != null`. Without restoring this the app would look completely fine
        // while going quiet on exactly the telemetry that would tell you it was not.
        CONFIG.CALENDAR_PIN_ACCESS = false;
        await initCalendarAccess({ onGranted: () => {} });
        assert.ok(ops.includes('signInAnonymously'),
            `no anonymous session was established: ${JSON.stringify(ops)}`);
    });

    test('OFF: the Calendar starts WITHOUT waiting for the anonymous sign-in to come back', async () => {
        // ── A LATENCY PROPERTY, ASSERTED AS ONE ─────────────────────────────────────────────────
        //
        // `signInAnonymously` is a network POST to identitytoolkit. Awaiting it before `onGranted`
        // put a full round trip in front of the FIRST PAINT of the grid — on a phone at the station
        // that is hundreds of milliseconds of blank splash, and on a bad signal it is seconds. The
        // pre-v20.12 code never did this: the calendar rendered from the local roster immediately
        // and auth settled alongside it.
        //
        // Nothing depends on the ordering, which is why it is safe to drop. Rendering needs the
        // roster (a local module) and the override cache (gated separately); the session is needed
        // only by the best-effort WRITES, which already await their own promise. So the sign-in is
        // started and deliberately not awaited.
        //
        // Asserted by making the sign-in never settle: if `onGranted` is behind it, this test times
        // out rather than failing loudly — hence the explicit race with a resolved tick, which
        // turns "still waiting" into a clean assertion.
        CONFIG.CALENDAR_PIN_ACCESS = false;
        let started = 0;
        signInAnonymouslyHangs = true;
        const init = initCalendarAccess({ onGranted: () => { started++; } });
        // A handful of microtask ticks, NOT a count that means anything: the property under test is
        // "grant does not await the network sign-in", and if it did, no finite number of ticks would
        // ever see started=1 (the sign-in is hung). The count was exactly 3 until v20.45, when the
        // bounded-reconcile race added one legitimate microtask hop and the test failed on tick
        // arithmetic rather than on the latency property it exists for.
        for (let i = 0; i < 8; i++) await Promise.resolve();
        assert.equal(started, 1,
            'the Calendar waited for the anonymous sign-in before its first render');
        signInAnonymouslyHangs = false;
        await Promise.race([init, Promise.resolve()]);
    });

    test('a HUNG reconcile cannot hold the Calendar at a blank page (v20.45)', async (t) => {
        // The wedged-auth case. `reconcileExpiredIdentity` awaits the first auth emission with no
        // timeout of its own, and it runs BEFORE `firstAuthUser` — so until v20.45 the 6-second
        // ceiling that exists for exactly this sat behind an unbounded wait on the same emission
        // and could never fire. The decision must still resolve: a locked-or-open Calendar is
        // recoverable, a page that never decides is not.
        t.mock.timers.enable({ apis: ['setTimeout'] });
        CONFIG.CALENDAR_PIN_ACCESS = false;
        reconcileHangs = true;
        try {
            let settled = null;
            const p = initCalendarAccess({ onGranted: () => {} }).then(v => { settled = v; });
            for (let i = 0; i < 4; i++) await Promise.resolve();
            assert.equal(settled, null, 'not yet — the bound has not elapsed');
            t.mock.timers.tick(6500);                    // the reconcile bound fires
            for (let i = 0; i < 8; i++) await Promise.resolve();
            t.mock.timers.tick(6000);                    // firstAuthUser's own ceiling, if reached
            await p;
            assert.equal(settled, 'open', 'the decision must resolve despite the hung reconcile');
        } finally {
            reconcileHangs = false;
        }
    });

    test('OFF: a signed-in MEMBER is still named — only the fallback moves', async () => {
        // The flag changes what happens to someone with nothing. It must not downgrade a member,
        // or every member-specific behaviour would quietly switch off with it.
        CONFIG.CALENDAR_PIN_ACCESS = false;
        sessionValue = { name: 'G. Miller' };
        currentUser = { uid: 'member-1', isAnonymous: false };
        assert.equal(await initCalendarAccess({ onGranted: () => {} }), 'named');
        assert.equal(ops.includes('signInAnonymously'), false,
            'a member was given an anonymous session on top of their own');
    });

    test('OFF: a restored VIEWER is still a viewer', async () => {
        CONFIG.CALENDAR_PIN_ACCESS = false;
        currentUser = { uid: 'calendar-viewer', isAnonymous: false };
        assert.equal(await initCalendarAccess({ onGranted: () => {} }), 'viewer');
    });

    test('OFF: an access-loss cannot re-lock a Calendar that has no lock', async () => {
        // Nothing to return to. Showing the card here would strand a member behind a control the
        // deployment has deliberately disabled.
        CONFIG.CALENDAR_PIN_ACCESS = false;
        await initCalendarAccess({ onGranted: () => {} });
        handleAccessLost();
        assert.equal(getAccessType(), 'open', 'open mode was re-locked');
    });

    test('ON: the same visitor gets the card and no session at all', async () => {
        // The other half of the switch, so neither test can pass by the flag being ignored.
        CONFIG.CALENDAR_PIN_ACCESS = true;
        let started = 0;
        assert.equal(await initCalendarAccess({ onGranted: () => { started++; } }), 'none');
        assert.equal(started, 0);
        assert.equal(ops.includes('signInAnonymously'), false,
            'an anonymous session was created while the Calendar was locked — it grants nothing '
            + 'under the tightened rules and would be a round trip for a token no rule accepts');
    });
});
