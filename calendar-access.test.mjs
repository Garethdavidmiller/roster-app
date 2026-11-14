/**
 * calendar-access.test.mjs — the unlock exchange and the viewer session lifecycle.
 * Run: node --experimental-test-module-mocks scripts/run-tests.mjs calendar-access.test.mjs
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
 * The third kind is not an ordering but a REFUSAL TO CLAIM: `lockCalendar` reloads, and the reload
 * is what a person reads as proof. So a sign-out that did not take must throw rather than reload —
 * a button reporting success it did not achieve is worse than one that fails visibly.
 *
 * The fake DOM is deliberately minimal: this file tests the module's decisions, not its markup. The
 * card's appearance and behaviour under a real browser are e2e's job (`e2e/calendar-pin.spec.js`).
 */
import { test, describe, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// ── Fakes ───────────────────────────────────────────────────────────────────────────────────────

/** Ordered log of every auth-affecting operation, so ORDER can be asserted, not just outcome. */
let ops = [];
let currentUser = null;
/** What `getIdTokenResult()` will report. */
let tokenClaims = { calendarViewer: true };
/** WHO the minted token signs in as, overriding the viewer shape. The fake hardcoded the viewer
 *  uid, so `isViewerUser(cred.user)` — the second half of the claim check — could never be false
 *  and deleting it left the whole file green (measured). A token's SUBJECT is the server's answer
 *  as much as its claims are, and this is the seam that lets a test disagree with it.
 *  @type {any} */
let tokenUser = undefined;
/** The real SDK tells `onAuthStateChanged` subscribers about a custom-token sign-in at once, before
 *  the unlock has checked the claim. Opt-in, so the tests written before cal-data-10 are unchanged. */
let emitOnSignIn = false;
let sessionValue = null;
/** session.js's sign-in/sign-out generation: a test moves it to say "a sign-in has begun". */
let authGenValue = 0;
/** Queue of fetch outcomes: `{ ok, status, json }` or an Error to throw. */
let fetchQueue = [];
let signOutBehavior = 'ok';
/** Lets a 'held' sign-out finish. @type {(v?: any) => void} */
let releaseSignOut = () => {};
let lastFetchBody = null;

const auth = { get currentUser() { return currentUser; } };

mock.module('./firebase-client.js', {
    namedExports: {
        auth,
        signInWithCustomToken: async (_a, token) => {
            ops.push('signIn:' + token);
            if (token === 'BAD_TOKEN') { const e = new Error('bad'); e.code = 'auth/invalid-custom-token'; throw e; }
            currentUser = tokenUser !== undefined ? tokenUser : {
                uid: 'calendar-viewer', isAnonymous: false,
                getIdTokenResult: async () => ({ claims: tokenClaims }),
            };
            if (emitOnSignIn) for (const cb of [...authSubs]) cb(currentUser);
            return { user: currentUser };
        },
        signOut: async () => {
            ops.push('signOut');
            // v20.35: the fail-closed tests need a signOut that REJECTS, and one that resolves
            // without clearing — the two shapes that used to walk into a persistence switch with an
            // identity still live.
            if (signOutBehavior === 'reject') { const e = new Error('signout failed'); e.code = 'auth/network-request-failed'; throw e; }
            if (signOutBehavior === 'noop') return;
            // cal-data-10: the real SDK clears `currentUser` only once its queue runs, so a sign-out
            // in flight still reads as the old user. 'held' keeps it there until the test releases it.
            if (signOutBehavior === 'held') await new Promise(r => { releaseSignOut = r; });
            currentUser = null;
        },
        // A RECORDER, not a feature. The Calendar no longer signs anybody in anonymously (the
        // `CALENDAR_PIN_ACCESS` switch that did was retired v24.34), so nothing should call this.
        // It stays in the fake so that re-introducing the call is SEEN by the "no session at all"
        // assertions below rather than failing as an unrelated import error.
        signInAnonymously: async () => {
            ops.push('signInAnonymously');
            currentUser = { uid: 'anon-1', isAnonymous: true };
            return { user: currentUser };
        },
        setViewerPersistence: async () => { ops.push('persistence:session'); },
        // The boot's own persistence choice (firebase-client.js). The unlock waits for it before its
        // switch (sign-in check, 11 Nov 2026); a thenable so a test can hold it (`bootGate`).
        authBootstrap: { then: (/** @type {any} */ res, /** @type {any} */ rej) => (bootGate || Promise.resolve({ user: null, persistence: 'none' })).then(res, rej) },
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
        // The shared boot authority (v21.29). The Calendar's access decision used to open its OWN
        // subscription here with its OWN 6s ceiling, stacked BEHIND the reconcile's 6.5s one — so a
        // wedged auth layer held the decision for ~12.5s. It now waits on the one boot restore and
        // reads ground truth, which is what this fake models: `bootRestoreHangs` is the wedged case.
        currentUserAfterBoot: async (timeoutMs = 8000) => {
            if (currentUser) return currentUser;
            if (bootRestoreHangs) {
                await new Promise(r => setTimeout(r, timeoutMs));
                bootWaitedMs += timeoutMs;
            }
            return currentUser || null;
        },
    },
});

/** When true the boot restore never answers — the degraded case both bounds existed for. */
let bootRestoreHangs = false;
/** A held boot persistence choice (`authBootstrap`), or null for one settled long ago. @type {Promise<any>|null} */
let bootGate = null;
/** Total time the fake boot restore was made to wait, so a STACKED bound is measurable. */
let bootWaitedMs = 0;

/** Live `onAuthStateChanged` subscribers. @type {Set<(u:any)=>void>} */
const authSubs = new Set();
/** Deliver a LATER auth emission — the restore that lands after the decision was made. */
function emitAuth(user) {
    currentUser = user;
    for (const cb of [...authSubs]) cb(user);
}

/** Every `initLoginOverlay` call the module makes — the front door is the shared card mounted
 *  INLINE (v23.19), and this is the seam: the real module imports the Firebase SDK through
 *  perf-reporter, and its form is proven in a browser (e2e/calendar-pin.spec.js). Here it records
 *  where it was asked to mount and what alternative it was given, and paints a marker into the host
 *  so `lastPanelHtml` can tell the sign-in card from the PIN card. @type {any[]} */
let loginMounts = [];
let loginDismissals = 0;   // calls to dismissLoginOverlay (cal-data-9)
let loginBusy = false;     // the form's OWN sign-in is in flight (its back link wears .login-back--busy)
mock.module('./login-overlay.js', {
    namedExports: {
        initLoginOverlay: (opts) => {
            loginMounts.push(opts);
            if (opts.host) opts.host.innerHTML = '<div id="loginCard">SIGN-IN CARD</div>';
            // The real form is one #loginOverlay either way: inside the slot when inline, on <body>
            // as a full-screen dialog when not.
            const form = domEl('loginOverlay');
            if (opts.host) form.classList.add('login-overlay--inline');
            form.querySelector = (/** @type {string} */ sel) => (sel === '.login-back--busy' && loginBusy ? {} : null);
        },
        dismissLoginOverlay: () => { loginDismissals++; },
    },
});

mock.module('./session.js', {
    namedExports: {
        ACCESS_DECISION_BUDGET_MS: 6500,   // the real constant lives in session.js since v24.96
        getSession: () => sessionValue,
        authGeneration: () => authGenValue,
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
            if (silentGate) await silentGate;
            // The RESULT and the resulting IDENTITY are set separately, because the real function
            // once could report success on an ANONYMOUS fallback (the `ENFORCE_NAMED_SESSION` switch,
            // retired v24.34), and ground truth is what the module must read either way. A fake that
            // tied the two together would make "trust the boolean" indistinguishable
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
/** The same, for the silent re-establishment — the boot AWAITS that attempt (up to
 *  `SILENT_BEFORE_CARD_MS`) before putting a card up. @type {Promise<void>|null} */
let silentGate = null;

// The hand-over releases this device's push record before it drops the session (Sep 2026
// re-review) — recorded into `ops`, so the ORDER against `clearSession` is what is asserted.
mock.module('./notif.js', { namedExports: { releaseDevicePush: async () => { ops.push('releasePush'); } } });

// The overlay Back stack (overlay.js), recorded: the front door's PIN card takes one entry, and Back
// (`pressBack`) runs the newest handler as overlay.js's popstate listener does (sign-in check, 11 Nov 2026).
/** @type {Function[]} */ let backStack = [];
const pressBack = () => { const fn = backStack.pop(); fn?.(); };
mock.module('./overlay.js', { namedExports: {
    _pushOverlayState: (/** @type {Function} */ fn) => { if (!backStack.includes(fn)) { backStack.push(fn); ops.push('backEntry:push'); } },
    _clearOverlayHistory: (/** @type {Function} */ fn) => { const i = backStack.lastIndexOf(fn); if (i >= 0) { backStack.splice(i, 1); ops.push('backEntry:clear'); } },
} });

// A storage the cards can read (real `ls.js`, real keys) — a mocked `lsGet` would let a module read
// a key nobody writes and the test would still pass.
/** @type {Map<string,string>} */
const store = new Map();
globalThis.localStorage = /** @type {any} */ ({
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
});

const {
    unlockWithPin, getAccessType, isViewerMode, initCalendarAccess, lockCalendar, handleAccessLost,
    calendarAccessReady, calendarAuthReady,
} = await import('./calendar-access.js');

// The three cards live in calendar-lock-cards.js since v23.54. Imported AFTER calendar-access.js,
// whose module scope wires their collaborators — a card reached before that would have no deps.
const { showSignInPanel, resetUnlockFailures } = await import('./calendar-lock-cards.js');
// The slot, so a test can ask WHICH card is standing where the Calendar goes. Real, not mocked —
// it touches only the fake DOM, and the whole point of asking is that the answer is the shipped one.
const { lockCardId } = await import('./calendar-lock-slot.js');
// The switch the PIN hint follows — real, so the test sets the very object the card reads.
const { CONFIG } = await import('./roster-data.js');

// A DOM just rich enough for the module to build and query its card.
/** @param {boolean} online */
function setOnline(online) {
    Object.defineProperty(globalThis, 'navigator', {
        value: { onLine: online }, configurable: true, writable: true,
    });
}

/** The element factory of the CURRENT fake DOM — see the note in `beforeEach`. @type {any} */
let domEl = () => null;

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
            // The real property the module reads after an `await` to check the slot has not moved on.
            get isConnected() { return !this._removed; },
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
    globalThis.window = {
        matchMedia: () => ({ matches: false }),
        location: { hash: '', replace(url) { ops.push('replace:' + url); }, reload() { ops.push('reload'); } },
    };
    globalThis.history = { state: null, replaceState(_s, _t, url) { ops.push('replaceState:' + url); } };
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

// ── WAITING FOR THE LAZY OVERLAY, WITHOUT GUESSING A DURATION ──────────────────────────────────
//
// `calendar-access.js` imports `login-overlay.js` LAZILY, so every path that raises a sign-in card
// completes one or more `await`s after the call that triggered it. Four places here used to wait a
// flat 20ms for that. It is the wrong shape of wait twice over: on an idle machine it is ~20ms of
// dead time per site, and on a loaded one — an external reviewer hit exactly this on 19 Sep 2026,
// running the estate in parallel — 20ms is simply not enough and the suite reports a Calendar
// regression that is not there. A timing guess cannot tell "slow" from "broken", and a test that
// fails under load teaches people to re-run rather than to read.
//
// Both helpers below wait on the NUMBER OF AWAIT POINTS rather than on the clock, which is the
// property that actually settles this: a dynamic import of an already-mocked module resolves in a
// task, not after an interval, so draining tasks is deterministic no matter how contended the CPU
// is. `waitFor` additionally stops the moment its condition holds, so the common case is faster
// than the old sleep as well as steadier.

/** One macrotask turn — drains the microtask queue behind it too. */
const turn = () => new Promise(r => setTimeout(r, 0));

/**
 * Drain `n` task turns. Use where there is no observable condition to wait for — the `beforeEach`
 * below, which has to let a PREVIOUS test's pending mount land before it clears `loginMounts`, and
 * cannot assert that a mount is coming because most tests leave none pending.
 * @param {number} [n]
 */
async function drainTurns(n = 6) { for (let i = 0; i < n; i++) await turn(); }

/**
 * Wait until `predicate()` holds, then return. Fails with what it was waiting for rather than with
 * whatever assertion happened to run next against a half-mounted card.
 * @param {() => boolean} predicate
 * @param {string} what   named in the failure message
 * @param {number} [maxTurns]
 */
async function waitFor(predicate, what, maxTurns = 400) {
    for (let i = 0; i < maxTurns; i++) {
        if (predicate()) return;
        await turn();
    }
    throw new Error(`waited ${maxTurns} task turns for ${what}, and it never happened`);
}

beforeEach(async () => {
    // Reset the module's access state FIRST and let it settle. `handleAccessLost` on a test that
    // ended `named` now routes through the (async) sign-in front door, and its mount would
    // otherwise land in the NEXT test's `loginMounts` after that test had reset them.
    handleAccessLost();
    await drainTurns();
    ops = [];
    currentUser = null;
    tokenClaims = { calendarViewer: true };
    tokenUser = undefined;
    emitOnSignIn = false;
    sessionValue = null;
    authGenValue = 0;
    signOutBehavior = 'ok';
    silentReauthSucceeds = false;
    silentReauthUser = undefined;
    reconcileGate = null;
    silentGate = null;
    bootGate = null;
    backStack = [];
    authSubs.clear();
    store.clear();
    fetchQueue = [];
    lastFetchBody = null;
    loginMounts = [];
    loginDismissals = 0;
    loginBusy = false;
    ({ el: domEl } = fakeDom());
    // (`_accessType` is module-level — the whole app asks one module "may this browser see the
    // roster?" — so without the reset above a successful unlock in one test would leave every later
    // test starting from `viewer` and the "stays locked" assertions would pass for the wrong reason.)
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
describe('the render gate and the WRITE gate open at the same instant', () => {
    test('a granted member resolves BOTH promises — no sign-in is left in flight', async () => {
        // The two promises were split at v20.18 for an anonymous `open` mode that painted before
        // its sign-in landed. That mode was retired at v24.34 (the `CALENDAR_PIN_ACCESS` switch),
        // so every grant now holds a real user — but the WRITERS (error reporter, usage counters,
        // push renewal) still await `calendarAuthReady`, and a grant that forgot to release it
        // would silence all of them while the Calendar looked perfectly healthy.
        sessionValue = { name: 'G. Miller' };
        currentUser = { uid: 'member-1', isAnonymous: false };
        let accessResolved = false, authResolved = false;
        calendarAccessReady.then(() => { accessResolved = true; });
        calendarAuthReady.then(() => { authResolved = true; });
        await Promise.resolve();
        assert.equal(accessResolved, false,
            'a previous test already granted access — move this describe back to the top of the file');

        assert.equal(await initCalendarAccess({ onGranted: () => {} }), 'named');
        await Promise.resolve(); await Promise.resolve();

        assert.equal(accessResolved, true, 'the render gate did not open on a grant');
        assert.equal(authResolved, true, 'the WRITE gate stayed shut on a grant — every writer would go silent');
        assert.equal(ops.includes('signInAnonymously'), false, 'a member was given an anonymous session');
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

    test('the switch waits for the BOOT\'s own persistence choice to land (sign-in check, 11 Nov 2026)', async () => {
        // Reproduced with the real SDK in both engines: a start-up slow enough that the PIN was typed
        // first ended with the boot's member chain landing AFTER the switch, migrating the viewer
        // into IndexedDB — the PIN outlived the browser. Nothing may switch until the boot has.
        /** @type {(v: any) => void} */ let settle = () => {};
        bootGate = new Promise(r => { settle = r; });
        const pending = unlockWithPin('1234');
        await drainTurns();
        assert.ok(!ops.includes('persistence:session'), 'persistence switched while the boot\'s own choice was still to land');
        assert.ok(!ops.some(o => o.startsWith('signIn:')), 'a viewer was signed in before the boot settled');
        settle({ user: null, persistence: 'indexeddb' });
        assert.deepEqual(await pending, { ok: true });
        assert.ok(ops.includes('persistence:session'));
    });

    // THE CARD THAT ASKED HAS GONE (review, 11 Nov 2026): Back or "Sign in instead" mid-exchange left it
    // granting under the card that replaced it, or switching persistence under a member's sign-in.
    test('an exchange whose card has gone changes nothing — no sign-out, no switch, no grant', async () => {
        currentUser = { uid: 'someone-else', isAnonymous: false };
        const r = await unlockWithPin('1234', () => false);
        assert.equal(r.ok, false);
        assert.equal(getAccessType(), 'none');
        assert.deepEqual(ops.filter(o => o === 'signOut' || o.startsWith('persistence:') || o.startsWith('signIn:')), [],
            'the exchange acted for a card that was no longer on screen');
    });

    test('a member who signed in during the wait for start-up is reloaded into — never signed out for the PIN', async () => {
        /** @type {(v: any) => void} */ let settle = () => {};
        bootGate = new Promise(r => { settle = r; });
        const pending = unlockWithPin('1234');
        await drainTurns();
        sessionValue = { name: 'G. Miller' };                 // "Sign in instead", or another tab
        currentUser = { uid: 'uid-miller', isAnonymous: false };
        settle({ user: null, persistence: 'indexeddb' });
        assert.deepEqual(await pending, { ok: true });
        assert.ok(ops.includes('reload'), 'the page did not reload into the member');
        assert.deepEqual(ops.filter(o => o === 'signOut' || o.startsWith('persistence:') || o.startsWith('signIn:')), [],
            'the member was signed out for the shared PIN');
    });

    test('a boot that never settles fails CLOSED: still locked, nothing switched, honest about why', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        bootGate = new Promise(() => {});                 // the degraded case: start-up wedged
        const pending = unlockWithPin('1234');
        // setImmediate, not `drainTurns`: that waits on setTimeout, which this test has frozen.
        for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r));
        t.mock.timers.tick(20000);
        const r = await pending;
        assert.equal(r.ok, false);
        assert.equal(getAccessType(), 'none');
        assert.ok(!ops.includes('persistence:session'), 'persistence switched without the boot having settled');
        assert.doesNotMatch(r.message, /not recognised/, 'the PIN was right — "not recognised" would be a lie');
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

    test('a rejected PIN (401) stays locked and says so without naming a number', async (t) => {
        // MOCK TIMERS for every refused exchange (test audit, 7 Nov 2026). A refusal is classified
        // from its status and its body is never read, and `fetchWithTimeout` keeps its 15s deadline
        // armed until a body read — harmless in a browser, but on the real clock it held this file
        // open for fifteen seconds after its last test.
        t.mock.timers.enable({ apis: ['setTimeout'] });
        fetchQueue = [{ ok: false, status: 401, json: async () => ({}) }];
        const r = await unlockWithPin('0000');
        assert.equal(r.ok, false);
        assert.equal(r.kind, 'rejected');
        assert.equal(getAccessType(), 'none');
        assert.equal(/\d/.test(r.message), false);
    });

    test('a throttled attempt (429) is distinguishable from a wrong PIN', async (t) => {
        // The member needs to know that waiting will help, which "PIN not recognised" would not say.
        t.mock.timers.enable({ apis: ['setTimeout'] });   // a refused exchange — see the 401 test
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

    // ── THE OTHER HALF OF THE SAME LINE (v23.63) ────────────────────────────────────────────────
    //
    // `res2?.claims?.[CALENDAR_VIEWER_CLAIM] !== true || !isViewerUser(cred.user)` is two questions,
    // and the three cases above only ever asked the first. The fake minted every token as the viewer
    // uid, so `isViewerUser` was true in every test in this file and deleting that half left all 71
    // green (measured). A guard nothing can make fire is documentation.
    //
    // The two are not redundant. The claim says what the token may DO; the uid says WHO it is, and
    // the app asks that question separately everywhere afterwards — `session.js` sheds a viewer by
    // uid before restoring member persistence, `reconcileExpiredIdentity` preserves one by uid, and
    // `lockCalendar` decides whether its sign-out took by uid. Granting `'viewer'` to an identity
    // `isViewerUser` does not recognise puts `getAccessType()` and every one of those in permanent
    // disagreement about the same browser — and the quietest consequence is Lock: it signs out, asks
    // `isViewerUser(auth.currentUser)`, gets `false` because this was never the viewer, and reloads
    // reporting success. Somebody walks away from a shared machine on a session that did not end.
    test('a token carrying the RIGHT claim under the WRONG uid is refused', async () => {
        tokenUser = {
            uid: 'member-1', isAnonymous: false,
            getIdTokenResult: async () => ({ claims: { calendarViewer: true } }),
        };
        const r = await unlockWithPin('1234');
        assert.equal(r.ok, false, 'a non-viewer identity was granted the shared capability');
        assert.equal(getAccessType(), 'none');
        assert.equal(currentUser, null, 'the wrong-uid identity was left signed in');
    });

    test('and an ANONYMOUS identity carrying it is refused too — that is the belt', async () => {
        // `isViewerUser` requires non-anonymous as well as the uid, and its own header says why:
        // every caller uses it to decide whether an identity may be PRESERVED across
        // `reconcileExpiredIdentity`, so a predicate that could return true for an unverified one
        // turns that preservation into a bypass. The claim check cannot see this at all.
        tokenUser = {
            uid: 'calendar-viewer', isAnonymous: true,
            getIdTokenResult: async () => ({ claims: { calendarViewer: true } }),
        };
        assert.equal((await unlockWithPin('1234')).ok, false);
        assert.equal(getAccessType(), 'none');
        assert.equal(currentUser, null);
    });

    test('the viewer itself still gets in — or the two above would pass on a gate that refuses everyone', async () => {
        tokenUser = {
            uid: 'calendar-viewer', isAnonymous: false,
            getIdTokenResult: async () => ({ claims: { calendarViewer: true } }),
        };
        assert.equal((await unlockWithPin('1234')).ok, true);
        assert.equal(getAccessType(), 'viewer');
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

    // ── THE FRONT DOOR IS SIGN-IN FIRST (v23.19, owner decision) ────────────────────────────────
    //
    // Most people opening the app are staff with a password; the PIN is for the shared PC and for
    // visiting or agency staff. So a browser holding NOTHING gets the member sign-in card, and the
    // PIN is one tap behind it — not the other way round, as it was from v20.12 to v23.18.

    test('nothing at all → the SIGN-IN card first, mounted inline, with the PIN one tap behind it', async () => {
        await initCalendarAccess({ onGranted: () => {} });
        assert.equal(loginMounts.length, 1, 'the shared sign-in card was not mounted');
        const m = loginMounts[0];
        assert.equal(m.host, lastPanel(), 'the card was not mounted INTO the lock slot (inline), but as a modal over it');
        assert.ok(lastPanelHtml().includes('SIGN-IN CARD'));
        assert.ok(!lastPanelHtml().includes('calLockPin'), 'the PIN field was on the front door');
        assert.match(m.alternative?.label || '', /staff PIN/i, 'no route to the PIN from the front door');
        assert.match(m.alternative?.hint || '', /agency/i, 'the card does not say who the PIN is for');
        // …and what it opens: the roster and the documents the ☰ menu offers (CALENDAR_DATA.md 15), as the
        // staff guide says. It named the Huddle alone, so a visitor read it as no route to the others. The
        // Newsletter follows its menu button, in both states — the test below.
        for (const doc of ['Daily Huddle', 'Weekly Retail Circular']) {
            assert.ok((m.alternative?.hint || '').includes(doc), `the PIN's hint does not say it opens the ${doc}`);
        }

        // The alternative swaps the cards IN PLACE — one slot, no reload, no second panel.
        m.alternative.onSelect();
        assert.ok(lastPanelHtml().includes('calLockPin'), 'taking the alternative did not show the PIN card');
        assert.ok(!lastPanelHtml().includes('SIGN-IN CARD'), 'the sign-in card is still up under the PIN card');
        assert.ok(m.host._removed, 'the previous card was not taken down');
    });

    // THE NEWSLETTER IS NAMED ONLY WHILE ITS ☰ BUTTON IS (CONFIG.NEWSLETTER_IN_MENU — hidden by the owner on
    // 14 Nov 2026, none having come out since July). A visitor promised it would find no way to it. Both
    // states, through the real front door: the card reads the switch when it is built, so setting it is enough.
    for (const inMenu of [true, false]) {
        test(`the PIN's hint names the Marylebone Newsletter only while the menu offers it (switch ${inMenu ? 'on' : 'off'})`, async () => {
            const committed = CONFIG.NEWSLETTER_IN_MENU;
            CONFIG.NEWSLETTER_IN_MENU = inMenu;
            try {
                await initCalendarAccess({ onGranted: () => {} });
                const hint = loginMounts[0]?.alternative?.hint || '';
                assert.match(hint, /the Daily Huddle, the Weekly Retail Circular/, `the hint lost the other documents: "${hint}"`);
                assert.equal(hint.includes('Marylebone Newsletter'), inMenu,
                    `with the Newsletter's button ${inMenu ? 'shown' : 'hidden'} the hint reads: "${hint}"`);
            } finally {
                CONFIG.NEWSLETTER_IN_MENU = committed;
            }
        });
    }

    test('the PIN card\'s "Sign in instead" returns to the sign-in card, in place', async () => {
        await initCalendarAccess({ onGranted: () => {} });
        loginMounts[0].alternative.onSelect();
        const back = document.getElementById('calLockSignIn');
        assert.ok(back, 'the PIN card offers no way back to sign-in');
        back._listeners.get('click')();
        await waitFor(() => loginMounts.length === 2, 'the sign-in card to re-mount');
        assert.equal(loginMounts.length, 2, 'sign-in was not re-mounted');
        assert.ok(lastPanelHtml().includes('SIGN-IN CARD'));
        assert.ok(!lastPanelHtml().includes('calLockPin'));
    });

    // Back on a phone LEFT THE APP from the PIN card the front door had just opened (sign-in check,
    // 11 Nov 2026). It now takes one entry on the Back stack every overlay uses, and gives it back
    // when it leaves by its own route, so Back never later lands on a card that has gone.
    describe('Back from the front door\'s PIN card', () => {
        test('returns to the sign-in card, in place', async () => {
            await initCalendarAccess({ onGranted: () => {} });
            loginMounts[0].alternative.onSelect();
            assert.equal(backStack.length, 1, 'the PIN card took no Back entry — Back leaves the app');
            pressBack();
            await waitFor(() => loginMounts.length === 2, 'the sign-in card to re-mount');
            assert.ok(lastPanelHtml().includes('SIGN-IN CARD'), 'Back did not return to the sign-in card');
        });

        test('"Sign in instead" gives the entry back', async () => {
            await initCalendarAccess({ onGranted: () => {} });
            loginMounts[0].alternative.onSelect();
            document.getElementById('calLockSignIn')._listeners.get('click')();
            assert.equal(backStack.length, 0, 'a Back entry was left for a card that has gone');
        });

        test('an unlock gives the entry back — Back then has nothing of the card left to find', async () => {
            await initCalendarAccess({ onGranted: () => {} });
            loginMounts[0].alternative.onSelect();
            assert.deepEqual(await unlockWithPin('1234'), { ok: true });
            assert.equal(backStack.length, 0, 'the unlocked Calendar kept a Back entry for the PIN card');
        });

        test('the PIN card a station PC opens with (`#staff-pin`) takes none — there is nowhere to go back to', async () => {
            globalThis.window.location.hash = '#staff-pin';
            await initCalendarAccess({ onGranted: () => {} });
            assert.ok(lastPanelHtml().includes('id="calLockPin"'));
            assert.equal(backStack.length, 0);
        });
    });

    test('`#staff-pin` is consumed even when a SESSION is held — a member never carries it', async () => {
        // v23.19 consumed the hash only on the locked path, so a member with a session who opened a
        // station PC's bookmark kept `#staff-pin` in the address bar of their own Calendar.
        globalThis.window.location.hash = '#staff-pin';
        sessionValue = { name: 'G. Miller' };
        currentUser = { uid: 'member-1', isAnonymous: false };
        assert.equal(await initCalendarAccess({ onGranted: () => {} }), 'named');
        assert.ok(ops.some(o => o.startsWith('replaceState:')), 'the hash was left in the address bar');
        assert.equal(loginMounts.length, 0);
        assert.ok(!lastPanelHtml().includes('id="calLockPin"'), 'a member was shown the PIN card');
    });

    test('the front door keeps whatever is up until the sign-in card is READY', async () => {
        // v23.19 mounted the empty slot first and fetched the module second — a blank navy page for
        // as long as the fetch took, where the PIN card used to draw at once. The slot must not be
        // emptied before the card can fill it: on a "Sign in instead" swap the PIN card stays up
        // until the overlay module has arrived.
        globalThis.window.location.hash = '#staff-pin';
        await initCalendarAccess({ onGranted: () => {} });
        const pinCard = lastPanel();
        assert.ok(lastPanelHtml().includes('id="calLockPin"'));
        document.getElementById('calLockSignIn')._listeners.get('click')();
        // Synchronously after the tap: the PIN card is STILL there — nothing was torn down ahead
        // of the import.
        assert.equal(pinCard._removed, false, 'the PIN card was taken down before the sign-in card existed');
        await waitFor(() => pinCard._removed === true, 'the PIN card to come down behind the sign-in card');
        assert.equal(pinCard._removed, true);
        assert.ok(lastPanelHtml().includes('SIGN-IN CARD'));
    });

    test('`#staff-pin` asks for the PIN card FIRST, and the hash is consumed', async () => {
        // The one way to land on the PIN card directly: a "Use the staff PIN instead" sign-out
        // reloads with it, and a station PC can bookmark it. It must not survive the boot — a
        // member who then signs in would otherwise carry it in the address bar.
        globalThis.window.location.hash = '#staff-pin';
        await initCalendarAccess({ onGranted: () => {} });
        assert.ok(lastPanelHtml().includes('calLockPin'), 'the hash did not bring the PIN card first');
        assert.equal(loginMounts.length, 0, 'the sign-in card was mounted as well');
        assert.ok(ops.some(o => o.startsWith('replaceState:')), 'the hash was left in the address bar');
        assert.ok(!ops.some(o => o.includes('#staff-pin')), 'the replaced URL still carries the hash');
    });

    // …AND SO DOES A PAGE IN THIS TAB THAT ENDED THE PIN (audit B3). Its card said "go back and enter
    // the PIN"; the phone's Back reached the Calendar with no hash, and the member sign-in card. The
    // mark is staff-pin-ended.js's, read and removed once by the boot (`takePinFirst`), as the hash is.
    describe('a page in this tab that ended the PIN asks for the PIN card too — its one-tab mark', () => {
        const MARK = 'myb_staff_pin_ended';
        /** @type {Map<string,string>} */ const tab = new Map();
        beforeEach(() => {
            tab.clear();
            /** @type {any} */ (globalThis).sessionStorage = { getItem: (/** @type {string} */ k) => tab.get(k) ?? null,
                setItem: (/** @type {string} */ k, /** @type {string} */ v) => { tab.set(k, String(v)); }, removeItem: (/** @type {string} */ k) => { tab.delete(k); } };
        });
        afterEach(() => { delete /** @type {any} */ (globalThis).sessionStorage; });

        test('the PIN card first, and the mark is gone — read once, with no hash to rewrite', async () => {
            tab.set(MARK, '1');
            await initCalendarAccess({ onGranted: () => {} });
            assert.ok(lastPanelHtml().includes('calLockPin'), 'the tab that ended the PIN was sent to the member sign-in card');
            assert.equal(loginMounts.length, 0, 'the sign-in card was mounted as well');
            assert.equal(tab.has(MARK), false, 'the mark outlived the boot that read it');
            assert.equal(ops.some(o => o.startsWith('replaceState:')), false, 'the address was rewritten with no hash in it');
        });

        test('a member\'s held session still gets their own card — and the mark goes all the same', async () => {
            tab.set(MARK, '1');
            sessionValue = { name: 'G. Miller' };
            await initCalendarAccess({ onGranted: () => {} });
            assert.ok(lastPanelHtml().includes('calLockWho'), 'a member was not offered their own sign-in');
            assert.ok(!lastPanelHtml().includes('id="calLockPin"'), 'a member was sent to the staff PIN (CALENDAR_DATA 11)');
            assert.equal(tab.has(MARK), false);
        });

        test('no mark: the front door, as before — and storage that throws (iOS private mode) costs only the mark', async () => {
            await initCalendarAccess({ onGranted: () => {} });
            await waitFor(() => loginMounts.length === 1, 'the front door to mount');
            handleAccessLost(); await drainTurns(); loginMounts = [];
            const refuse = () => { throw new Error('SecurityError'); };
            /** @type {any} */ (globalThis).sessionStorage = { getItem: refuse, setItem: refuse, removeItem: refuse };
            await initCalendarAccess({ onGranted: () => {} });
            await waitFor(() => loginMounts.length === 1, 'the front door to mount with storage refusing');
        });
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
        // The lost-identity case, which is not always a race: on an iPhone the identity's IndexedDB
        // read can fail while the 60-day local session survives (not Safari's seven-day rule, which
        // deletes the session too — KNOWN_LIMITATIONS → "One interaction to expect on iOS"). Offering
        // them the shared PIN would answer the wrong question — and would hand them a capability
        // with no `name`, so the drawer would show their name while every write failed.
        sessionValue = { name: 'G. Miller' };
        const type = await initCalendarAccess({ onGranted: () => {} });
        assert.equal(type, 'none');
        const html = lastPanelHtml();
        assert.ok(!html.includes('id="calLockPin"'), 'a member was shown the PIN field');
        assert.equal(document.getElementById('calLockWho')?.textContent, 'Calendar · G. Miller',
            'the card does not say who it is for');
        assert.ok(html.includes('calLockPinInstead'), 'the PIN was not left reachable underneath');
        assert.ok(ops.some(o => o === 'ensureNamedSession:G. Miller'),
            `the silent re-establishment was never attempted: ${JSON.stringify(ops)}`);
        // v21.62: by the time the card exists, silence has already failed — so it renders in its
        // final, ACTIONABLE state. The old two-state card held a disabled "Signing you in…" button
        // for the length of a round trip that, for a migrated member, could only fail.
        assert.ok(html.includes('Sign in →'), 'the card is not immediately actionable');
        assert.ok(!html.includes('Signing you in'), 'the disabled limbo state is back');
        assert.ok(!html.includes('disabled'), 'the sign-in button is disabled on arrival');
    });

    test("the member card's Sign in hands the overlay the name the card already shows (v23.58)", async () => {
        // The heading says "Calendar · G. Miller". Until v23.58 the button under it opened a form
        // that asked them to pick their grade and then their own name from the whole roster — on
        // the routine way back in for every migrated iPhone member. The overlay's own behaviour
        // (pre-selecting, dispatching `input`, focusing the password) is a browser matter and is
        // pinned in e2e/calendar-pin.spec.js; THIS pins the wiring, which is the half a unit test
        // can see and the half that silently regresses if somebody rebuilds the call.
        sessionValue = { name: 'G. Miller' };
        await initCalendarAccess({ onGranted: () => {} });
        await new Promise(r => setTimeout(r, 0));   // let the silent attempt settle
        loginMounts = [];
        const btn = document.getElementById('calLockSubmit');
        assert.ok(btn, 'the member card has no Sign in button');
        // The handler is async — it awaits a dynamic import before mounting — so await the promise
        // it returns rather than guessing at how many turns the loader needs.
        await btn._listeners.get('click')();
        assert.equal(loginMounts.length, 1, 'the shared sign-in was not mounted');
        assert.equal(loginMounts[0].presetName, 'G. Miller',
            'the overlay was opened without the name the card is already showing');
        assert.equal(loginMounts[0].host, undefined, 'the come-back sign-in is the modal, not inline');
        // The label is the subtitle's prefix ("Calendar · Sign in"), a bare page name on every other
        // page and on this page's own front door. "the Calendar" read "the Calendar · Sign in".
        assert.equal(loginMounts[0].pageLabel, 'Calendar', 'the come-back form is not labelled as the Calendar\'s other forms are');
    });

    // cal-data-9 (10 Nov 2026). A grant takes the SLOT down, and the come-back card's form is not in
    // the slot — it is a full-screen dialog on <body>. A slow restore that landed while it was open
    // granted and built the Calendar behind a form still asking for a password nobody needed.
    describe('a grant that lands while the come-back card\'s sign-in form is open', () => {
        async function openTheForm() {
            sessionValue = { name: 'G. Miller' };
            await initCalendarAccess({ onGranted: () => {} });
            await new Promise(r => setTimeout(r, 0));   // let the silent attempt settle
            await document.getElementById('calLockSubmit')._listeners.get('click')();
            assert.equal(loginMounts.at(-1)?.host, undefined, 'premise: the full-screen form is up');
        }

        test('takes the form down with the card', async () => {
            await openTheForm();
            emitAuth({ uid: 'member-1', isAnonymous: false });   // the slow restore lands
            assert.equal(getAccessType(), 'named', 'premise: granted');
            assert.equal(loginDismissals, 1, 'the full-screen sign-in stayed over a Calendar already granted');
        });

        test('…but not while the form\'s OWN sign-in is in flight — its success reloads, and that runs the forced set-password step', async () => {
            await openTheForm();
            loginBusy = true;                                     // the member pressed Sign in; Firebase signs them in
            emitAuth({ uid: 'member-1', isAnonymous: false });
            assert.equal(getAccessType(), 'named');
            assert.equal(loginDismissals, 0, 'the form went before the reload that runs the forced set-password step');
        });

        test('and never the front door\'s INLINE card — that one goes with the slot', async () => {
            await initCalendarAccess({ onGranted: () => {} });    // nothing held: the inline sign-in card
            assert.ok(loginMounts.at(-1)?.host, 'premise: the inline card is up');
            await unlockWithPin('1234');                          // the PIN instead
            assert.equal(getAccessType(), 'viewer');
            assert.equal(loginDismissals, 0, 'the inline card was dismissed as though it were the dialog — '
                + 'its scroll unlock is unpaired, and would release another overlay\'s lock');
        });
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
        await alt._listeners.get('click')();

        assert.ok(ops.includes('clearSession'), `the stale named session survived: ${JSON.stringify(ops)}`);
        // The member is leaving a device they may be handing to a stranger: their push record goes
        // WHILE they are still signed in (only its owner may delete it), so it is released first.
        assert.ok(ops.includes('releasePush') && ops.indexOf('releasePush') < ops.indexOf('clearSession'),
            `the push record was not released before sign-out — targeted notices follow the member: ${JSON.stringify(ops)}`);
        assert.equal(reloaded, 1, 'nothing was rebuilt, so the drawer keeps the previous name');
        assert.ok(ops.indexOf('clearSession') < ops.lastIndexOf('reload'),
            'reloaded before clearing — the reload would restore the session it was meant to drop');
        assert.equal(sessionValue, null, 'the local session was not actually dropped');
        // v23.19: the reload lands on the sign-in card unless it says otherwise. The tap said PIN —
        // REWRITTEN into the address, not navigated to (sign-in check, 11 Nov 2026): setting the hash
        // pushed a history entry, and Back after the reload then went nowhere.
        assert.ok(ops.includes('replaceState:./#staff-pin'),
            `the reload will show the sign-in card — the tap asked for the PIN: ${JSON.stringify(ops)}`);
        assert.ok(ops.indexOf('replaceState:./#staff-pin') < ops.lastIndexOf('reload'), 'the address was rewritten after the reload began');
        assert.notEqual(globalThis.window.location.hash, '#staff-pin', 'the hash was NAVIGATED to — that pushes a Back entry');
    });

    test('the silent re-establishment GRANTS when it works — and NO sign-in surface is ever shown', async () => {
        // `ensureNamedSession` with no password tries only the surname default, so for anyone who has
        // not chosen their own password this is a complete recovery with no interaction at all.
        //
        // ── AND SINCE v21.62, WITH NOTHING SHOWN AT ALL ─────────────────────────────────────────
        // The attempt used to run behind the member card's disabled "Signing you in…" state, so
        // every recovering member SAW a sign-in screen flash — which, with the start ladder showing
        // 56% of restores over a second, was a routine experience and the substance of the "keeps
        // asking for my password" complaints. It now runs behind the boot skeleton: the card is
        // built only when silence fails, so a recovery shows a skeleton that fills in, nothing more.
        sessionValue = { name: 'G. Miller' };
        silentReauthSucceeds = true;
        let started = 0;
        const type = await initCalendarAccess({ onGranted: () => { started++; } });
        assert.equal(type, 'named', 'a recovery completed during boot reports as the boot decision');
        assert.equal(getAccessType(), 'named');
        assert.equal(started, 1);
        assert.ok(!lastPanelHtml().includes('cal-lock-card'),
            'a sign-in card was built for a member whose recovery needed nothing typed');
        assert.ok(lastPanelHtml().includes('cal-boot-grid'), 'the waiting happened behind the skeleton');
        assert.equal(_panelIsDown(), true, 'the skeleton was left up after the grant');
    });

    test('a silent re-auth that reports success but lands ANONYMOUS grants nothing', async () => {
        // `ensureNamedSession` could once return true for an anonymous fallback (the
        // `ENFORCE_NAMED_SESSION` switch, retired v24.34), and an anonymous identity is exactly what
        // v20.12 stopped honouring. So the result is read from `decideAccess` against ground truth,
        // never from the boolean.
        sessionValue = { name: 'G. Miller' };
        silentReauthSucceeds = true;
        silentReauthUser = { uid: 'anon', isAnonymous: true };
        await initCalendarAccess({ onGranted: () => {} });
        assert.equal(getAccessType(), 'none');
        assert.ok(lastPanelHtml().includes('cal-lock-card'),
            'no sign-in card followed the refused anonymous recovery');
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
        emitAuth({ uid: 'calendar-viewer', isAnonymous: false, getIdTokenResult: async () => ({ claims: { calendarViewer: true } }) });
        await new Promise(r => setTimeout(r, 0));
        // `none`, not merely "not named" (restored, sign-in check 11 Nov 2026 — v25.68 had loosened
        // it): a member's session is held, so the shared code is not this browser's way back.
        assert.equal(getAccessType(), 'none', 'a late PIN session was granted over a held member session');
    });

    test('a PIN session restored AT START-UP under a member\'s held session gets the member their own way in (audit F1)', async () => {
        // The start-up twin of the late case above, which the boot used to miss: a member's identity
        // did not restore, the tab ALSO held a PIN session, and `decideAccess` ranked the PIN first —
        // the member read the station's Calendar, and a later loss showed them the PIN card. Now the
        // boot answers `none`, and the member's own silent sign-in runs before any card goes up.
        const viewerUser = () => ({ uid: 'calendar-viewer', isAnonymous: false, getIdTokenResult: async () => ({ claims: { calendarViewer: true } }) });
        for (const succeeds of [false, true]) {
            handleAccessLost(); await drainTurns();
            ops = []; authSubs.clear(); loginMounts = [];
            sessionValue = { name: 'G. Miller' };
            currentUser = viewerUser();                   // restored at boot, inside the decision
            silentReauthSucceeds = succeeds;
            const type = await initCalendarAccess({ onGranted: () => {} });
            await drainTurns();
            assert.ok(ops.includes('ensureNamedSession:G. Miller'), 'the member\'s own silent sign-in never ran');
            if (succeeds) {
                assert.equal(type, 'named', 'the member\'s own sign-in did not win');
            } else {
                assert.equal(type, 'none', 'the staff PIN was granted over a member\'s held session');
                assert.equal(getAccessType(), 'none');
                assert.ok(!lastPanelHtml().includes('id="calLockPin"'), 'a member was put in front of the staff PIN');
                assert.ok(lastPanelHtml().includes('calLockPinInstead'), 'the member\'s own card did not follow');
            }
        }
    });

    test('a late PIN session does not overtake a member\'s silent sign-in (sign-in check, 11 Nov 2026)', async () => {
        // The reproduced sequence: a member's session is held, their silent sign-in is still out, and
        // the browser's old PIN session restores meanwhile. Granting it ended, when the sign-in failed,
        // at the PIN card ("Calendar access has expired. Enter the staff PIN") in front of a member —
        // and when it succeeded, with the member signed in to a VIEWER's Calendar until a reload.
        const viewerUser = { uid: 'calendar-viewer', isAnonymous: false, getIdTokenResult: async () => ({ claims: { calendarViewer: true } }) };
        for (const succeeds of [false, true]) {
            handleAccessLost(); await drainTurns();
            ops = []; authSubs.clear(); currentUser = null; loginMounts = [];
            sessionValue = { name: 'G. Miller' };
            silentReauthSucceeds = succeeds;
            /** @type {() => void} */ let release = () => {};
            silentGate = new Promise(r => { release = r; });
            const decided = initCalendarAccess({ onGranted: () => {} });
            await drainTurns();
            emitAuth(viewerUser);                          // the old PIN session restores, late
            await drainTurns();
            assert.equal(getAccessType(), 'none', `the PIN session was granted under the member (silent sign-in ${succeeds ? 'succeeding' : 'failing'})`);
            release();
            await decided; await drainTurns();
            if (succeeds) assert.equal(getAccessType(), 'named', 'the member\'s own sign-in did not win');
            else {
                assert.equal(getAccessType(), 'none');
                assert.ok(!lastPanelHtml().includes('id="calLockPin"'), 'a member was put in front of the staff PIN');
                assert.ok(lastPanelHtml().includes('calLockPinInstead'), 'the member\'s own card (with the PIN one tap behind it) did not follow');
            }
            silentGate = null;
        }
    });

    // cal-data-10 (10 Nov 2026, the owner's question with a decided default): a staff-PIN session
    // that restored after the decision was ignored for the rest of the page load — a station PC on a
    // bad connection showed the sign-in card although it held a session the boot would have granted.
    describe('a STAFF-PIN session that restores late', () => {
        const viewer = (/** @type {any} */ claims) => ({ uid: 'calendar-viewer', isAnonymous: false, getIdTokenResult: async () => ({ claims }) });

        test('is honoured — as the viewer, the way a late member identity is honoured', async () => {
            let started = 0;
            assert.equal(await initCalendarAccess({ onGranted: () => { started++; } }), 'none');
            emitAuth(viewer({ calendarViewer: true }));
            await new Promise(r => setTimeout(r, 0));
            assert.equal(getAccessType(), 'viewer', 'a PIN session the browser holds was ignored');
            assert.equal(started, 1);
        });

        test('…but not once a sign-in has BEGUN since — a typed one saves its session only when it succeeds (review, 11 Nov 2026)', async () => {
            assert.equal(await initCalendarAccess({ onGranted: () => {} }), 'none');
            authGenValue++;                                       // a member submits the sign-in card
            emitAuth(viewer({ calendarViewer: true }));           // …and the PIN session restores under it
            await new Promise(r => setTimeout(r, 0));
            assert.equal(getAccessType(), 'none', 'the PIN was granted underneath a member\'s sign-in');
        });

        test('…only once its token carries the claim — the check the unlock itself makes', async () => {
            assert.equal(await initCalendarAccess({ onGranted: () => {} }), 'none');
            emitAuth(viewer({}));
            await new Promise(r => setTimeout(r, 0));
            assert.equal(getAccessType(), 'none', 'a token without the claim unlocked the Calendar');
        });

        test('…and never on the PIN card\'s own sign-in: that exchange checks the claim and grants ONCE', async () => {
            globalThis.window.location.hash = '#staff-pin';
            let grants = 0;
            await initCalendarAccess({ onGranted: () => {}, onEveryGrant: () => { grants++; } });
            emitOnSignIn = true;                                  // the SDK announces the sign-in at once
            const result = await unlockWithPin('1234');
            await new Promise(r => setTimeout(r, 0));
            assert.equal(result.ok, true);
            assert.equal(getAccessType(), 'viewer');
            assert.equal(grants, 1, 'the watcher granted on the exchange\'s sign-in as well — the gate was rebuilt twice');
        });

        test('…and an exchange still out when the restored session is granted stands down — no sign-out, no second grant', async () => {
            globalThis.window.location.hash = '#staff-pin';
            let grants = 0;
            await initCalendarAccess({ onGranted: () => {}, onEveryGrant: () => { grants++; } });
            /** @type {(v: any) => void} */ let answer = () => {};
            globalThis.fetch = (/** @type {any} */ _u, /** @type {any} */ opts) => (opts?.method === 'POST'
                ? new Promise(r => { answer = r; })
                : Promise.resolve({ ok: false, status: 405, json: async () => ({}) }));
            const exchange = unlockWithPin('1234');               // the PIN typed; the exchange is slow
            emitAuth(viewer({ calendarViewer: true }));           // …and the browser's own PIN session restores
            await new Promise(r => setTimeout(r, 0));
            assert.equal(getAccessType(), 'viewer', 'premise: the restored session was granted');
            ops = [];
            answer({ ok: true, status: 200, json: async () => ({ token: 'GOOD_TOKEN' }) });
            assert.equal((await exchange).ok, true);
            assert.deepEqual(ops.filter(o => o === 'signOut' || o.startsWith('signIn:')), [],
                'the exchange signed a working session out to sign in again');
            assert.equal(grants, 1);
        });

        test('…and one an exchange signed out while its claim was being read is not granted after', async () => {
            globalThis.window.location.hash = '#staff-pin';
            await initCalendarAccess({ onGranted: () => {} });
            /** @type {(v: any) => void} */ let claimsLand = () => {};
            emitAuth({ uid: 'calendar-viewer', isAnonymous: false, getIdTokenResult: () => new Promise(r => { claimsLand = r; }) });
            tokenClaims = {};                                     // the exchange that starts meanwhile is refused its claim
            const result = await unlockWithPin('1234');
            assert.equal(result.ok, false, 'premise: the exchange failed, and signed everybody out');
            claimsLand({ claims: { calendarViewer: true } });     // the first session's slow check lands
            await new Promise(r => setTimeout(r, 0));
            assert.equal(getAccessType(), 'none', 'a session the exchange had signed out was granted');
        });

        test('…nor one whose claim lands while the exchange is still signing it out — the exchange grants, once', async () => {
            globalThis.window.location.hash = '#staff-pin';
            let grants = 0;
            await initCalendarAccess({ onGranted: () => {}, onEveryGrant: () => { grants++; } });
            /** @type {(v: any) => void} */ let claimsLand = () => {};
            emitAuth({ uid: 'calendar-viewer', isAnonymous: false, getIdTokenResult: () => new Promise(r => { claimsLand = r; }) });
            signOutBehavior = 'held';
            ops = [];
            const exchange = unlockWithPin('1234');               // the PIN typed meanwhile
            await waitFor(() => ops.includes('signOut'), 'the exchange to start signing the restored session out');
            claimsLand({ claims: { calendarViewer: true } });     // the restored session's check lands now
            await turn();
            assert.equal(getAccessType(), 'none',
                'the restored session was granted while the exchange was signing it out — and the exchange grants again');
            releaseSignOut();
            assert.equal((await exchange).ok, true);
            assert.equal(getAccessType(), 'viewer');
            assert.equal(grants, 1, 'the Calendar was granted twice');
        });

        test('…nor, when the exchange\'s own sign-in is announced, a claim read that outlasts the exchange\'s grant', async () => {
            globalThis.window.location.hash = '#staff-pin';
            let grants = 0;
            await initCalendarAccess({ onGranted: () => {}, onEveryGrant: () => { grants++; } });
            /** @type {null | ((v: any) => void)} */ let watcherRead = null;
            tokenUser = {
                uid: 'calendar-viewer', isAnonymous: false,
                // The watcher reads first and its answer is slow; the exchange's own read is not.
                getIdTokenResult: () => (watcherRead ? Promise.resolve({ claims: { calendarViewer: true } })
                    : new Promise(r => { watcherRead = r; })),
            };
            emitOnSignIn = true;
            assert.equal((await unlockWithPin('1234')).ok, true);
            assert.ok(watcherRead, 'premise: the watcher was told of the exchange\'s sign-in and is reading its claim');
            assert.equal(grants, 1, 'premise: the exchange granted');
            /** @type {(v: any) => void} */ (watcherRead)({ claims: { calendarViewer: true } });
            await turn();
            assert.equal(grants, 1, 'the watcher granted the same session a second time — the gate was rebuilt twice');
        });
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
        // cal-data-11: its one spoken line is WRITTEN once the region is in the document, not built
        // into it — a live region is read only for what changes after it is in the accessibility tree.
        assert.ok(skeleton.includes('role="status"></p>'), 'the status region was created with its words already in it');
        assert.equal(lastPanel().querySelector('[role="status"]').textContent, 'Loading the roster…',
            'the skeleton says nothing to a screen reader');

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

    test('locking lands on the PIN card, not the sign-in card — this is a PIN machine', async () => {
        await unlockWithPin('1234');
        ops = [];
        await lockCalendar();
        assert.ok(ops.includes('replaceState:./#staff-pin'), `the next person gets the sign-in card: ${JSON.stringify(ops)}`);
    });

    test('locking RELOADS, whatever path the Calendar was opened at (v24.89)', async () => {
        // It ended in `location.replace('./#staff-pin')`, and this file asserted exactly that — but a
        // fake `location` has no path, so it could not see that from `/` (how the station opens the
        // Calendar) the target differs by its fragment alone and the browser loads nothing. The
        // viewer was signed out and the roster stayed up. The address is now rewritten in place and
        // the page reloaded; the browser half is e2e/calendar-pin.spec.js, locking from `/`.
        await unlockWithPin('1234');
        ops = [];
        await lockCalendar();
        const at = ops.indexOf('replaceState:./#staff-pin');
        assert.ok(at >= 0 && ops.indexOf('reload') > at, `rewrite the address, THEN reload: ${JSON.stringify(ops)}`);
        assert.ok(!ops.some(o => o.startsWith('replace:')), 'a fragment-only navigation is the defect, not a reload');
    });

    // ── LOCK MUST NOT REPORT SUCCESS IT DID NOT ACHIEVE (v20.39, audit §13) ─────────────────────
    //
    // The other two cases above prove the button works. This is the one that costs something, and
    // it is invisible from every one of them: the reload is what a person READS as "locked", so a
    // sign-out that did not take turns the reload into a lie. `decideAccess` re-runs against ground
    // truth, sees the viewer still current, and returns `viewer` — the roster comes back on screen
    // for whoever sits down next at the shared station PC, with the person who pressed Lock already
    // out of the building.
    //
    // The two shapes are NOT held by the same line, which is why both are here: `await signOut()`
    // covers only a REJECTION, and the assertion beneath it covers an SDK that resolves without
    // clearing. Deleting the assertion leaves the rejection case green.
    test('a sign-out that RESOLVES without clearing refuses to reload', async () => {
        await unlockWithPin('1234');
        assert.equal(isViewerMode(), true);
        ops = [];
        signOutBehavior = 'noop';   // resolves; `currentUser` stays the viewer
        await assert.rejects(() => lockCalendar(), /not locked/,
            'lockCalendar resolved with the viewer still signed in');
        assert.ok(!ops.some(o => o === 'reload' || o.startsWith('replace')),
            'the page reloaded as though it had locked — the next person gets the roster');
        assert.equal(isViewerMode(), true,
            'and the app must not pretend otherwise in its own state either');
    });

    test('a REJECTED sign-out does not reload either', async () => {
        // The half held by the `await` rather than by the assertion. Pinned so a future "best
        // effort" catch cannot quietly restore the v20.39 defect from the other side.
        await unlockWithPin('1234');
        ops = [];
        signOutBehavior = 'reject';
        await assert.rejects(() => lockCalendar());
        assert.ok(!ops.some(o => o === 'reload' || o.startsWith('replace')), 'a failed sign-out still reloaded');
    });

    test('losing access mid-session drops back to locked rather than looping on retry', async () => {
        // A Firestore `permission-denied` after the Calendar is open means the session expired, not
        // that the network is poor. Left as a sync-chip retry it is a loop the member cannot win.
        await unlockWithPin('1234');
        handleAccessLost();
        assert.equal(getAccessType(), 'none');
    });

    test('a VIEWER losing access gets the PIN card back, with the reason on it', async () => {
        await unlockWithPin('1234');
        handleAccessLost();
        assert.ok(lastPanelHtml().includes('calLockPin'));
        assert.match(document.getElementById('calLockMsg').textContent, /expired/i);
    });

    test('a MEMBER losing access gets their own card — never the PIN (CALENDAR_DATA.md 11)', async () => {
        // Until v23.19 this path showed the PIN card to everyone, which sent a signed-in member to a
        // shared code — the one thing the member card exists to prevent, reached from a different
        // direction. The way back in is the way they came in.
        sessionValue = { name: 'G. Miller' };
        currentUser = { uid: 'member-1', isAnonymous: false };
        await initCalendarAccess({ onGranted: () => {} });
        assert.equal(getAccessType(), 'named');
        handleAccessLost();
        assert.equal(getAccessType(), 'none');
        assert.ok(!lastPanelHtml().includes('id="calLockPin"'), 'a member was sent to the staff PIN');
        assert.ok(lastPanelHtml().includes('calLockWho'), 'the member card was not shown');
        assert.match(document.getElementById('calLockWhy').textContent, /expired/i, 'the card does not say why it is up');
    });

    test('a MEMBER whose SESSION has also gone gets the sign-in card, with the reason on it', async () => {
        sessionValue = { name: 'G. Miller' };
        currentUser = { uid: 'member-1', isAnonymous: false };
        await initCalendarAccess({ onGranted: () => {} });
        sessionValue = null;   // expired and cleared by the time the read was refused
        loginMounts = [];
        // The fake's `document.querySelector` keys on the raw selector while `getElementById` keys on
        // the id, so create the node under the id the module will look up.
        const grid = /** @type {any} */ (document.querySelector('calendarDisplay'));
        grid.hidden = false;
        handleAccessLost();
        // The roster goes off screen SYNCHRONOUSLY — before the sign-in module is awaited — because
        // this path arrives with a Calendar on screen and a refused read behind it.
        assert.equal(grid.hidden, true, 'the workspace stayed visible while the sign-in card loaded');
        await waitFor(() => loginMounts.length === 1, 'the expired-session sign-in card to mount');
        assert.equal(loginMounts.length, 1, 'the sign-in card was not shown: ' + JSON.stringify(loginMounts.map(m => [m.pageLabel, m.notice, !!m.host])));
        assert.match(loginMounts[0].notice || '', /expired/i, 'the card does not say why it is up');
        assert.ok(!lastPanelHtml().includes('id="calLockPin"'), 'a member was sent to the staff PIN');
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

    test('a member\'s HELD session under the PIN card reloads too — the PIN is never granted over it (audit F1)', async () => {
        // This asserted the opposite until the sign-in audit (Nov 2026): "a viewer holding a stale
        // local session may still unlock". But a held session IS a member — one whose identity did not
        // restore, with the viewer's token in the tab — and unlocking put the station's Calendar where
        // their own belongs (CALENDAR_DATA.md 11). The reload asks the boot, which now answers `none`
        // for exactly this and offers their own card, with the PIN one deliberate tap behind it.
        let reloads = 0;
        globalThis.window.location.reload = () => { reloads++; };
        for (const who of [{ uid: 'calendar-viewer', isAnonymous: false }, null]) {
            sessionValue = { name: 'G. Miller' };
            currentUser = who;
            ops = []; reloads = 0;
            // `{ ok: true }` is also what an unlock returns, so the reload is counted and the exchange
            // checked for: a station PC sent down the wrong one of the two is the failure either way.
            assert.deepEqual(await unlockWithPin('1234'), { ok: true });
            assert.equal(reloads, 1, `the PIN was not handed back to the boot (identity: ${who ? 'the viewer' : 'none'})`);
            assert.equal(getAccessType(), 'none', 'the staff PIN was granted over a member\'s held session');
            assert.deepEqual(ops.filter(o => o === 'signOut' || o.startsWith('persistence:') || o.startsWith('signIn:')), [],
                'the exchange went ahead under a member\'s session');
            // …nor is the PIN sent: an attempt the server counts against the station's limit, for an
            // unlock that cannot be used.
            assert.equal(lastFetchBody, null, 'the PIN was sent for an unlock that could not go ahead');
        }
    });

    test('…and the member card\'s "Use the staff PIN instead" still UNLOCKS: it drops the session first', async () => {
        // The hand-over is the deliberate way from a held session to the PIN. It clears the session
        // before its reload (the test above it in "initCalendarAccess"), so the PIN card it lands on
        // finds nothing held and the exchange goes ahead — a station PC is never stranded by the reload.
        let reloads = 0;
        globalThis.window.location.reload = () => { reloads++; };
        sessionValue = { name: 'G. Miller' };
        await initCalendarAccess({ onGranted: () => {} });
        await drainTurns();
        const alt = document.getElementById('calLockPinInstead');
        assert.ok(alt, 'the member card offers no route to the staff PIN');
        await alt._listeners.get('click')();
        assert.equal(reloads, 1, 'the hand-over did not reload');
        assert.equal(sessionValue, null, 'the hand-over kept the session');
        ops = [];
        assert.deepEqual(await unlockWithPin('1234'), { ok: true });
        assert.equal(reloads, 1, 'the PIN card the hand-over leads to reloaded instead of unlocking');
        assert.ok(ops.some(o => o.startsWith('signIn:')), 'the PIN was never exchanged for a viewer token');
        assert.equal(getAccessType(), 'viewer');
    });
});

describe('a visitor with nothing is locked — there is no open, anonymous Calendar', () => {
    // Until v24.34 a `CALENDAR_PIN_ACCESS` switch could turn this path into an ungated Calendar on
    // an anonymous session. The rules had long since stopped letting that session read anything, so
    // the switch was retired rather than kept as a rollback that would show a wrong roster.

    test('the visitor gets the card and no session at all', async () => {
        let started = 0;
        assert.equal(await initCalendarAccess({ onGranted: () => { started++; } }), 'none');
        assert.equal(started, 0);
        assert.equal(getAccessType(), 'none');
        assert.equal(ops.includes('signInAnonymously'), false,
            'an anonymous session was created while the Calendar was locked — it grants nothing '
            + 'under the rules and would be a round trip for a token no rule accepts');
    });

    test('a HUNG reconcile cannot hold the Calendar at a blank page (v20.45)', async (t) => {
        // The wedged-auth case. `reconcileExpiredIdentity` awaits the first auth emission with no
        // timeout of its own, and it runs BEFORE `firstAuthUser` — so until v20.45 the 6-second
        // ceiling that exists for exactly this sat behind an unbounded wait on the same emission
        // and could never fire. The decision must still resolve: a locked Calendar is recoverable,
        // a page that never decides is not.
        t.mock.timers.enable({ apis: ['setTimeout'] });
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
            assert.equal(settled, 'none', 'the decision must resolve despite the hung reconcile');
        } finally {
            reconcileHangs = false;
        }
    });

    test('the reconcile and the boot restore SHARE one budget — a slow first step shortens the second (v21.29)', async (t) => {
        // The two waits used to be sequential bounds, so a wedged auth layer held the decision for
        // ~12.5s. `bootRestoreHangs` and `bootWaitedMs` were declared for exactly this and never set
        // (test audit, 7 Nov 2026): handing the restore a fresh, full budget brought the stacked wait
        // back with every test green. Here the reconcile is slow, not stuck — 4s of the 6.5s — and
        // the restore never answers, so it may have only the 2.5s that is left.
        t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: new Date(2026, 10, 7, 12) });
        // `turn` is a setTimeout, which is mocked here; an immediate is not.
        const settle = async () => { for (let i = 0; i < 12; i++) await new Promise(r => setImmediate(r)); };
        bootRestoreHangs = true;
        bootWaitedMs = 0;
        reconcileGate = new Promise(r => setTimeout(() => r(undefined), 4000));
        try {
            /** @type {string|null} */ let settled = null;
            initCalendarAccess({ onGranted: () => {} }).then(v => { settled = v; });
            await settle();
            t.mock.timers.tick(4000);   // the reconcile answers, 4s into the budget
            await settle();
            assert.equal(settled, null, 'guard: the restore is still waiting');
            t.mock.timers.tick(2500);   // the budget is spent
            await settle();
            assert.equal(bootWaitedMs, 2500, 'the boot restore was not given what was LEFT of the budget');
            // The decision is made; what follows it (the sign-in card's lazy import) needs real
            // turns, not time, so the clock goes back before waiting on the outcome.
            t.mock.timers.reset();
            await waitFor(() => settled !== null, 'the access decision to settle');
            assert.equal(settled, 'none');
        } finally {
            bootRestoreHangs = false;
            bootWaitedMs = 0;
        }
    });
});

// ── ONE GRANT, AFTER THE CONFIRMATION (the provisional paint, retired 26 Sep 2026) ─────────────
//
// From v22.97 a returning member's boot granted TWICE: a member-scoped "provisional" paint before
// Firebase confirmed the stored identity, then the real grant. It was retired by owner decision
// (DECISIONS.md → "The provisional paint") — its cache read queued behind the same Auth start-up it
// was meant to overtake — and both defects it shipped came from that doubled grant: a scoped read
// marking months known for everyone, and the one-shot `onGranted` spent while access was still
// `none`. This pins the shape that replaced it, at the point the coordinator hangs off.
describe('a returning named member is granted ONCE, and only after the identity confirms', () => {
    test('nothing before the confirmation; then onEveryGrant and onGranted once each, reading `named`', async () => {
        const grid = domEl('calendarDisplay');   // created first: the module only hides what exists
        sessionValue = { name: 'G. Miller' };
        store.set('myb_roster_selected_member', 'G. Miller');   // the retired fast path's own trigger
        let release = () => {};
        reconcileGate = new Promise(r => { release = () => r(undefined); });
        /** @type {string[]} */
        const seen = [];
        const done = initCalendarAccess({
            onGranted: () => { seen.push(`onGranted:${getAccessType()}`); },
            onEveryGrant: (/** @type {any} */ ...args) => { seen.push(`every(${args.length}):${getAccessType()}`); },
        });
        await Promise.resolve(); await Promise.resolve();
        assert.deepEqual(seen, [], 'something was granted while the stored identity was still unconfirmed');
        assert.equal(grid.hidden, true, 'the workspace was shown before the confirmation');
        currentUser = { uid: 'member-1', isAnonymous: false };
        release();
        assert.equal(await done, 'named');
        assert.deepEqual(seen, ['every(0):named', 'onGranted:named'],
            'one grant, carrying no scope, with `named` already readable to the one-shot hook');
        assert.equal(grid.hidden, false);
        assert.equal(lockCardId(), null, 'a card was left standing over the granted Calendar');
    });
});

// ── The cards' own rules — three of which had NOTHING checking them ─────────────────────────────
//
// Found by mutation when `calendar-lock-cards.js` was split out at v23.54 and its header wrote the
// rules down: deleting the post-import access re-check, and deleting the line that clears the PIN
// field on a failure, both left this whole file green. Writing an invariant in a header is not
// protecting it — that is this repo's own stated discipline, and these are the tests it asks for.
//
// The third mutation, deleting `hideLockPanel()` from the member card, also survived — and there
// the CODE was fine and the header was wrong. `mountLockCard` calls `unmountLockCard` itself, so
// one-card-at-a-time is the SLOT's guarantee, not these calls'. `hideLockPanel` is here to disarm
// the PIN card's backoff timer, which the slot knows nothing about. The header now says so.
describe('the cards themselves', () => {
    test('a card must not mount over a Calendar that was granted while it loaded', () => {
        // The sign-in card awaits a dynamic import, and access can arrive during it — the
        // late-identity watcher, or a silent re-auth landing. Mounting afterwards puts a sign-in
        // form over a working Calendar, which is the one outcome this path must not have. The race
        // is forced deterministically: start the card, let it reach its `await`, then grant.
        const pending = showSignInPanel();
        return unlockWithPin('1234')
            .then(() => pending)
            .then(() => {
                assert.equal(getAccessType(), 'viewer', 'the grant did not happen — the race is not being tested');
                assert.ok(!lastPanelHtml().includes('SIGN-IN CARD'),
                    'a sign-in card was mounted over a granted Calendar');
            });
    });

    test('a failed unlock CLEARS the PIN field', async (t) => {
        // On a shared PC a PIN left in a form field is readable by the next person through devtools
        // or autofill — and on a failure a cleared field is what the member wants anyway, since
        // they are retyping it. Asserted on the real form handler, not on `unlockWithPin`.
        t.mock.timers.enable({ apis: ['setTimeout'] });   // a refused exchange — see the 401 test
        globalThis.window.location.hash = '#staff-pin';
        await initCalendarAccess({ onGranted: () => {} });
        const input = document.getElementById('calLockPin');
        const form  = document.getElementById('calLockForm');
        assert.ok(input && form, 'the PIN card is not up');
        input.value = '0000';
        fetchQueue = [{ ok: false, status: 401, json: async () => ({}) }];
        await form._listeners.get('submit')({ preventDefault() {} });
        assert.equal(input.value, '', 'the PIN was left in the field after a rejected attempt');
        assert.equal(getAccessType(), 'none');
    });

    // THE CARD ASKS WHETHER IT IS STILL THERE (review, 11 Nov 2026), through the real form handler: Back or
    // "Sign in instead" while an exchange was out left it granting under the sign-in card.
    test('"Sign in instead" while the exchange is out: the exchange stands down — no grant, no switch', async () => {
        globalThis.window.location.hash = '#staff-pin';
        await initCalendarAccess({ onGranted: () => {} });
        /** @type {(v: any) => void} */ let answer = () => {};
        globalThis.fetch = (/** @type {any} */ _u, /** @type {any} */ opts) => (opts?.method === 'POST'
            ? new Promise(r => { answer = r; })
            : Promise.resolve({ ok: false, status: 405, json: async () => ({}) }));
        document.getElementById('calLockPin').value = '1234';
        const pressed = document.getElementById('calLockForm')._listeners.get('submit')({ preventDefault() {} });
        await drainTurns();
        document.getElementById('calLockSignIn')._listeners.get('click')();   // the card is replaced
        await waitFor(() => loginMounts.length === 1, 'the sign-in card to mount');
        ops = [];
        answer({ ok: true, status: 200, json: async () => ({ token: 'GOOD_TOKEN' }) });
        await pressed;
        assert.equal(getAccessType(), 'none', 'the PIN was granted under the sign-in card');
        assert.deepEqual(ops.filter(o => o === 'signOut' || o.startsWith('persistence:') || o.startsWith('signIn:')), [],
            'the exchange went on for a card that was no longer on screen');
    });

    // cal-data-7 (10 Nov 2026). `attemptBackoffMs` is unit-tested, and nothing pressed the card after a
    // third failure: the field's input handler set the button from the digits alone, so retyping them
    // lifted the delay at once — the helper was tested, the wiring was not.
    describe('the delay after repeated failures', () => {
        /** The PIN card up, every exchange refused, POSTs counted (the warm-up is a GET). The failure
         *  count lives for the page load (a grant resets it), so a refusal in an earlier test would
         *  make this one's third press the fourth. */
        async function pinCard() {
            resetUnlockFailures();
            globalThis.window.location.hash = '#staff-pin';
            await initCalendarAccess({ onGranted: () => {} });
            const input = document.getElementById('calLockPin');
            const form  = document.getElementById('calLockForm');
            const submit = document.getElementById('calLockSubmit');
            const card = { exchanges: 0, submit, answer: /** @type {any} */ (null),
                type: (/** @type {string} */ v) => { input.value = v; input._listeners.get('input')(); },
                press: () => form._listeners.get('submit')({ preventDefault() {} }) };
            globalThis.fetch = async (/** @type {any} */ _u, /** @type {any} */ opts) => {
                if (opts?.method !== 'POST') return { ok: false, status: 405, json: async () => ({}) };
                card.exchanges++;
                return card.answer ?? { ok: false, status: 401, json: async () => ({}) };
            };
            return card;
        }

        test('retyping the PIN does not lift it — and it ends when it says it does', async (t) => {
            t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
            const card = await pinCard();
            for (let i = 0; i < 3; i++) { card.type('0000'); await card.press(); }
            assert.equal(card.exchanges, 3, 'premise: three refused attempts');
            card.type('0000');
            assert.equal(card.submit.disabled, true, 'four digits typed straight back in lifted the two-second delay');
            await card.press();
            assert.equal(card.exchanges, 3, 'a fourth attempt went out inside the delay');
            t.mock.timers.tick(2000);
            assert.equal(card.submit.disabled, false, 'the button stayed off after the delay ended');
            await card.press();
            assert.equal(card.exchanges, 4);
        });

        test('the button counts down, and the reason stays on screen while it does (sign-in check, 11 Nov 2026)', async (t) => {
            // Until v25.77 the first keystroke wiped the message and the button sat greyed out for up
            // to 20 seconds with no words at all.
            t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
            const card = await pinCard();
            for (let i = 0; i < 3; i++) { card.type('0000'); await card.press(); }
            assert.equal(card.submit.textContent, 'Try again in 2s', 'a held button with no words');
            card.type('1');
            assert.match(document.getElementById('calLockMsg').textContent, /not recognised/, 'typing during the delay wiped the reason');
            t.mock.timers.tick(1000);
            assert.equal(card.submit.textContent, 'Try again in 1s');
            t.mock.timers.tick(1000);
            assert.equal(card.submit.textContent, 'Unlock Calendar →', 'the button did not come back');
        });

        test('only a WRONG PIN counts: three dropped connections start no delay', async (t) => {
            // A bad connection is not the member mistyping; slowing their retry only made it worse.
            t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
            const card = await pinCard();
            globalThis.fetch = async (/** @type {any} */ _u, /** @type {any} */ opts) => {
                if (opts?.method !== 'POST') return { ok: true, status: 204, json: async () => ({}) };
                card.exchanges++;
                throw new TypeError('Failed to fetch');
            };
            for (let i = 0; i < 3; i++) { card.type('0000'); await card.press(); }
            card.type('0000');
            assert.equal(card.submit.disabled, false, 'a connection failure started the wrong-PIN delay');
            await card.press();
            assert.equal(card.exchanges, 4);
            // …and they were not COUNTED either: the first wrong PIN after them is the first.
            globalThis.fetch = async (/** @type {any} */ _u, /** @type {any} */ opts) => {
                if (opts?.method !== 'POST') return { ok: true, status: 204, json: async () => ({}) };
                card.exchanges++;
                return { ok: false, status: 401, json: async () => ({}) };
            };
            card.type('0000'); await card.press();
            card.type('0000');
            assert.equal(card.submit.disabled, false, 'four dropped connections were counted as wrong PINs');
        });

        test('a delay\'s timer still pending does not re-enable the button during the next exchange', async (t) => {
            t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
            const card = await pinCard();
            for (let i = 0; i < 3; i++) { card.type('0000'); await card.press(); }
            t.mock.timers.setTime(1_000_000 + 5000);   // the delay is over, its timer not yet run (a busy page)
            card.type('0000');
            /** @type {(v: any) => void} */ let land = () => {};
            card.answer = new Promise(r => { land = r; });   // the fourth exchange is slow (a cold start)
            const inFlight = card.press();
            await Promise.resolve();
            t.mock.timers.tick(0);                       // …and the old timer runs now
            assert.equal(card.submit.disabled, true, 'the button came back on under "Unlocking…"');
            land({ ok: false, status: 401, json: async () => ({}) });
            await inFlight;
        });
    });

    test('a SUCCESSFUL unlock clears it too — the field is emptied on every path', async () => {
        globalThis.window.location.hash = '#staff-pin';
        await initCalendarAccess({ onGranted: () => {} });
        const input = document.getElementById('calLockPin');
        const form  = document.getElementById('calLockForm');
        input.value = '1234';
        await form._listeners.get('submit')({ preventDefault() {} });
        assert.equal(input.value, '', 'a correct PIN was left in the field');
        assert.equal(getAccessType(), 'viewer');
    });
});

// ── WHETHER ACCESS IS HELD LIVES IN ONE PLACE, AND THIS MODULE WRITES IT (Calendar step 2, v25.74) ──
//
// Until v25.74 this module kept its own answer (`named`, `viewer` or `none`) while the roster reads
// and the documents each kept a flag, set by hand from the coordinator's hooks. Now there is one
// copy, calendar-access-state.js: `grant` writes it, `handleAccessLost` shuts it, and both gates read
// it. What that leaves THIS module to get right is ORDER, twice over, and one piece of memory:
//   · a grant writes after the card has gone and before either hook runs;
//   · a loss shuts before a card goes up;
//   · and the card is still owed when a refused read has shut the state before calling here.
// The state and the document gate are loaded for REAL below. Nothing is mocked between this module
// and what it writes, because the write is the thing under test.
const { hasCalendarAccess, grantNumber, setCalendarAccess, onCalendarAccess } = await import('./calendar-access-state.js');
const { onDocumentAccess, hasDocumentAccess, _clearDocumentSubscribersForTests } = await import('./calendar-doc-access.js');

describe('the one access state: a grant writes it, a loss shuts it first', () => {
    /** State listeners this block added, taken off before the next test. @type {(() => void)[]} */
    let offs = [];
    const listen = (/** @type {(w: { open: boolean, changed: boolean }) => void} */ fn) => { offs.push(onCalendarAccess(fn)); };
    beforeEach(() => {
        for (const off of offs) off();
        offs = [];
        _clearDocumentSubscribersForTests();   // the documents' subscribers too, and FIRST: none hears the shut
        setCalendarAccess(false);
    });

    test('a member\'s grant: the workspace is back BEFORE the documents are told, and both hooks find every gate open', async () => {
        const grid = domEl('calendarDisplay');   // created first: the module only hides what exists
        sessionValue = { name: 'G. Miller' };
        currentUser = { uid: 'member-1', isAnonymous: false };
        /** @type {string[]} */ const order = [];
        // The documents are told from INSIDE the write, and a document a locked tap was waiting for
        // opens there and then: over the Calendar, never over a workspace still hidden.
        onDocumentAccess(open => order.push(`documents:${open}:hidden=${grid.hidden}`));
        assert.equal(await initCalendarAccess({
            onEveryGrant: () => order.push(`every:${hasCalendarAccess()}:${hasDocumentAccess()}:${getAccessType()}`),
            onGranted:    () => order.push(`granted:${hasCalendarAccess()}:${hasDocumentAccess()}:${getAccessType()}`),
        }), 'named');
        assert.deepEqual(order, ['documents:true:hidden=false', 'every:true:true:named', 'granted:true:true:named'],
            'the first render (onGranted) and a re-unlock\'s repaint (onEveryGrant) must find the gates already open');
    });

    test('a PIN unlock: the card has GONE before the documents are told', async () => {
        globalThis.window.location.hash = '#staff-pin';
        /** @type {string[]} */ const order = [];
        await initCalendarAccess({
            onEveryGrant: () => order.push(`every:${hasCalendarAccess()}`),
            onGranted:    () => order.push(`granted:${hasCalendarAccess()}`),
        });
        assert.notEqual(lockCardId(), null, 'premise: the PIN card is standing');
        assert.equal(hasCalendarAccess(), false, 'premise: nothing is granted yet');
        onDocumentAccess(open => order.push(`documents:${open}:card=${lockCardId()}`));
        await unlockWithPin('1234');
        assert.deepEqual(order, ['documents:true:card=null', 'every:true', 'granted:true'],
            'a held document would have opened over a card about to be taken away');
    });

    test('`getAccessType` reads `none` the moment the state shuts, before anybody calls this module', async () => {
        await unlockWithPin('1234');
        assert.equal(getAccessType(), 'viewer');
        // What a refused month read does (calendar-overrides.js), before it tells anybody.
        setCalendarAccess(false);
        assert.equal(getAccessType(), 'none', 'this module still reported access over gates that had shut');
        assert.equal(isViewerMode(), false);
    });

    test('an open state this module never granted is not reported as access of any kind', () => {
        setCalendarAccess(true);
        assert.equal(getAccessType(), 'none');
        handleAccessLost();
        assert.equal(hasCalendarAccess(), false, 'handleAccessLost left a gate open because it had no card to show');
    });

    test('a VIEWER\'s card is still owed after a refused read has ALREADY shut the state', async () => {
        await unlockWithPin('1234');
        setCalendarAccess(false);   // the read shut first…
        handleAccessLost();         // …and then asked for the card
        assert.ok(lastPanelHtml().includes('calLockPin'), 'the state was already shut, so no card went up — the roster stayed on screen');
        assert.match(document.getElementById('calLockMsg').textContent, /expired/i);
    });

    test('a MEMBER\'s card is their own after a refused read has already shut the state — never the PIN', async () => {
        sessionValue = { name: 'G. Miller' };
        currentUser = { uid: 'member-1', isAnonymous: false };
        await initCalendarAccess({ onGranted: () => {} });
        setCalendarAccess(false);
        handleAccessLost();
        assert.ok(lastPanelHtml().includes('calLockWho'), 'the member card was not shown');
        assert.ok(!lastPanelHtml().includes('id="calLockPin"'), 'which card is owed was read from a state that could no longer say — a member was sent to the staff PIN');
    });

    test('`handleAccessLost` shuts the state ITSELF, and before the card goes up', async () => {
        // The first load's route: nobody has shut anything when this is called. Until v25.74 this
        // function shut nothing, and relied on a wrapper in the coordinator to have closed both gates.
        await unlockWithPin('1234');
        assert.equal(lockCardId(), null, 'premise: no card over a granted Calendar');
        /** @type {string[]} */ const seen = [];
        listen(({ open, changed }) => seen.push(`state:${open}:${changed}:card=${lockCardId()}`));
        onDocumentAccess(open => seen.push(`documents:${open}:card=${lockCardId()}`));
        handleAccessLost();
        assert.equal(hasCalendarAccess(), false, 'the lock card went up over gates still open');
        assert.deepEqual(seen.sort(), ['documents:false:card=null', 'state:false:true:card=null'],
            'the card was up before the gates had shut');
        assert.notEqual(lockCardId(), null, 'no card went up');
    });

    test('a second `handleAccessLost` writes nothing and says nothing twice', async () => {
        await unlockWithPin('1234');
        handleAccessLost();
        const card = lastPanel();
        let writes = 0;
        listen(() => { writes++; });
        handleAccessLost();
        assert.equal(writes, 0);
        assert.equal(lastPanel(), card, 'a second card was built');
    });

    test('a re-unlock is a NEW grant', async () => {
        await unlockWithPin('1234');
        const first = grantNumber();
        handleAccessLost();
        assert.equal(grantNumber(), first, 'losing access counted as a grant');
        await unlockWithPin('1234');
        assert.equal(grantNumber(), first + 1, 'a read still out from before the lock would settle under the new grant');
        assert.equal(getAccessType(), 'viewer');
    });
});
