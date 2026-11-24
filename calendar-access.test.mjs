/**
 * calendar-access.test.mjs — the Calendar's access gate: the decision, the cards, the grant and the loss.
 * Run: node --experimental-test-module-mocks scripts/run-tests.mjs calendar-access.test.mjs
 *
 * `calendar-access-core.test.mjs` covers the pure decisions. This file covers the part that talks to
 * Firebase and draws the cards, because that is where the failure modes are STATEFUL — a restore that
 * lands late, a sign-in in flight, an access lost mid-read — and none of those is visible from a pure
 * function. Everything asserts on ORDER as much as on outcome.
 *
 * THE STAFF PIN IS RETIRED FROM THE CLIENT (owner, 23 Nov 2026). Its unlock exchange, its card, its
 * Lock and its late grant went, and their tests with them. What replaced them here: a browser still
 * holding a viewer session is NOT granted, and the boot asks the teardown with no argument, so the
 * viewer is signed out (`reconcileExpiredIdentity`, session.js — whose own tests prove the sign-out and
 * the one line the card then says); and the front door has no alternative, and a fallback that is not
 * a PIN card when its form cannot load.
 *
 * The fake DOM is deliberately minimal: this file tests the module's decisions, not its markup. The
 * card's appearance and behaviour under a real browser are e2e's job (`e2e/calendar-access.spec.js`, whose PIN
 * half the e2e pass removes).
 */
import { test, describe, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// ── Fakes ───────────────────────────────────────────────────────────────────────────────────────

/** Ordered log of every auth-affecting operation, so ORDER can be asserted, not just outcome. */
let ops = [];
let currentUser = null;
let sessionValue = null;
let signOutBehavior = 'ok';
/** Whether the sign-in form's module fails to load (`lazyImport`, sw-register.js) — the case the
 *  front door's non-PIN fallback is for. */
let formLoadFails = false;

const auth = { get currentUser() { return currentUser; } };

/** Runs inside `letViewerWritesGo`, so a test can change the identity mid-wait. @type {null | (() => any)} */
let duringViewerWrites = null;
mock.module('./firebase-client.js', {
    namedExports: {
        auth,
        signOut: async () => {
            ops.push('signOut');
            // v20.35: the fail-closed tests need a signOut that REJECTS, and one that resolves
            // without clearing — the two shapes that used to walk into a persistence switch with an
            // identity still live.
            if (signOutBehavior === 'reject') { const e = new Error('signout failed'); e.code = 'auth/network-request-failed'; throw e; }
            if (signOutBehavior === 'noop') return;
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
 *  perf-reporter, and its form is proven in a browser (e2e/calendar-access.spec.js). Here it records
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

// The cards' lazy import (sw-register.js), with one seam: `formLoadFails` makes the sign-in form's
// module fail to load, the first visit on a connection that drops mid-boot — the case the front door's
// fallback exists for. calendar-lock-cards.js is the only module in this graph that imports it.
mock.module('./sw-register.js', { namedExports: {
    lazyImport: async (/** @type {() => Promise<any>} */ load) => {
        if (formLoadFails) throw new Error('Failed to fetch dynamically imported module');
        return load();
    },
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
    getAccessType, initCalendarAccess, handleAccessLost,
    calendarAccessReady, calendarAuthReady, finishSignIn, _resetPageForTest,
} = await import('./calendar-access.js');
const accessModule = await import('./calendar-access.js');

// The three cards live in calendar-lock-cards.js since v23.54. Imported AFTER calendar-access.js,
// whose module scope wires their collaborators — a card reached before that would have no deps.
const { showSignInPanel, SIGN_IN_UNAVAILABLE_LINE } = await import('./calendar-lock-cards.js');
// The slot, so a test can ask WHICH card is standing where the Calendar goes. Real, not mocked —
// it touches only the fake DOM, and the whole point of asking is that the answer is the shipped one.
const { lockCardId, showBootSkeleton } = await import('./calendar-lock-slot.js');

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
    // EMPTY THE GROUND TRUTH BEFORE ANYTHING ELSE (F1, 21 Nov 2026). A wait a test armed and did not
    // see out — `afterSignInSettles` polls a sign-in on a real 200 ms timer — re-reads the session
    // and the identity when it fires. It fired here, in the drain below, under the LAST test's
    // member session, and granted `named` into the next test: "a STAFF-PIN session that restores
    // late" read `named` about 1 run in 6 on a busy machine. With nothing held here it decides
    // nothing; and the fresh page below moves the module's access epoch, so it cannot grant in the
    // next test either (calendar-access.js → `_accessEpoch`) — nor can a late silent sign-in.
    // Each test is a fresh PAGE, too: a grant in one would otherwise make the next one's sign-in reload.
    _resetPageForTest();
    sessionValue = null;
    currentUser = null;
    loginBusy = false;
    // Then reset the module's access state and let it settle. `handleAccessLost` on a test that
    // ended `named` routes through the (async) sign-in front door, and its mount would
    // otherwise land in the NEXT test's `loginMounts` after that test had reset them.
    handleAccessLost();
    await drainTurns();
    ops = [];
    currentUser = null;
    sessionValue = null;
    signOutBehavior = 'ok';
    formLoadFails = false;
    silentReauthSucceeds = false;
    silentReauthUser = undefined;
    reconcileGate = null;
    silentGate = null;
    authSubs.clear();
    store.clear();
    loginMounts = [];
    loginDismissals = 0;
    loginBusy = false;
    ({ el: domEl } = fakeDom());
    // (`_grantedAs` is module-level — the whole app asks one module "may this browser see the
    // roster?" — so without the reset above a grant in one test would leave every later test
    // starting granted and the "stays locked" assertions would pass for the wrong reason.)
    // No network call is expected from this module now that the PIN exchange has gone: one is a fault.
    globalThis.fetch = async (/** @type {any} */ url) => { ops.push('fetch:' + url); return { ok: false, status: 500, json: async () => ({}) }; };
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

// ── THE PIN IS GONE FROM THIS MODULE (owner, 23 Nov 2026) ─────────────────────────────────────────
describe('the staff PIN\'s unlock and Lock are gone from the client', () => {
    test('the module exports no way to unlock with, or end, a PIN', () => {
        for (const gone of ['unlockWithPin', 'lockCalendar', 'isViewerMode']) {
            assert.equal(gone in accessModule, false, `${gone} came back`);
        }
    });
});

describe('initCalendarAccess', () => {
    test('a live named session starts the Calendar with no card', async () => {
        sessionValue = { name: 'G. Miller' };
        currentUser = { uid: 'member-1', isAnonymous: false };
        let started = 0;
        const type = await initCalendarAccess({ onGranted: () => { started++; } });
        assert.equal(type, 'named');
        assert.equal(started, 1);
        assert.equal(document.getElementById('calendarLock'), null, 'a card was built for a member');
    });

    // THE TEARDOWN (owner, 23 Nov 2026). A browser still holding a staff-PIN viewer session is not
    // granted, and the boot asks `reconcileExpiredIdentity` with NO argument — its default signs the
    // viewer out, and the sign-in card says why (session.test.mjs and login-overlay.test.mjs prove those).
    test('a restored VIEWER session is NOT granted, and the boot asks the teardown to keep nothing', async () => {
        currentUser = { uid: 'calendar-viewer', isAnonymous: false, getIdTokenResult: async () => ({ claims: { calendarViewer: true } }) };
        let started = 0;
        const type = await initCalendarAccess({ onGranted: () => { started++; } });
        assert.equal(type, 'none', 'the retired staff PIN opened the Calendar');
        assert.equal(started, 0);
        assert.deepEqual(ops.filter(o => o.startsWith('reconcile:')), ['reconcile:{}'],
            'the boot asked the teardown to keep something — a leftover PIN session would survive it');
        await waitFor(() => loginMounts.length === 1, 'the sign-in card');
        assert.equal(loginMounts[0].host, lastPanel(), 'the front door is not the inline sign-in card');
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

    test('nothing at all → the SIGN-IN card, mounted inline, with no other way in', async () => {
        await initCalendarAccess({ onGranted: () => {} });
        assert.equal(loginMounts.length, 1, 'the shared sign-in card was not mounted');
        const m = loginMounts[0];
        assert.equal(m.host, lastPanel(), 'the card was not mounted INTO the lock slot (inline), but as a modal over it');
        assert.ok(lastPanelHtml().includes('SIGN-IN CARD'));
        // "Use the staff PIN instead" went with the PIN (owner, 23 Nov 2026).
        assert.equal(m.alternative ?? null, null, `the front door offers another way in: ${JSON.stringify(m.alternative)}`);
    });





    // A `#staff-pin` bookmark or address from before the retirement is HARMLESS: nothing reads it.
    test('`#staff-pin` in the address changes nothing — the front door, or a member\'s own grant', async () => {
        globalThis.window.location.hash = '#staff-pin';
        await initCalendarAccess({ onGranted: () => {} });
        await waitFor(() => loginMounts.length === 1, 'the front door');
        assert.equal(loginMounts[0].alternative ?? null, null);
        assert.equal(lockCardId(), 'calendarLock', 'something other than the sign-in card stands in the slot');
        handleAccessLost(); await drainTurns(); loginMounts = []; _resetPageForTest();
        sessionValue = { name: 'G. Miller' };
        currentUser = { uid: 'member-1', isAnonymous: false };
        assert.equal(await initCalendarAccess({ onGranted: () => {} }), 'named');
        assert.deepEqual(ops.filter(o => o.startsWith('replaceState:') || o.startsWith('replace:') || o === 'reload'), [],
            'the hash moved the address or reloaded the page');
    });


    test('the front door keeps whatever is up until the sign-in card is READY', async () => {
        // v23.19 mounted the empty slot first and fetched the module second — a blank navy page for
        // as long as the fetch took. The slot must not be emptied before the card can fill it.
        showBootSkeleton();
        const skeleton = lastPanel();
        const pending = showSignInPanel();
        // Synchronously after the call: the skeleton is STILL there — nothing was torn down ahead of
        // the import.
        assert.equal(skeleton._removed, false, 'the skeleton was taken down before the sign-in card existed');
        await pending;
        assert.equal(skeleton._removed, true);
        assert.ok(lastPanelHtml().includes('SIGN-IN CARD'));
    });




    test('an ANONYMOUS identity is locked out — the old bootstrap grants nothing', async () => {
        currentUser = { uid: 'anon', isAnonymous: true };
        let started = 0;
        assert.equal(await initCalendarAccess({ onGranted: () => { started++; } }), 'none');
        assert.equal(started, 0);
    });

    test('it asks reconcile with NO argument, whoever is held — the default is the teardown', async () => {
        // Until the PIN was retired this asserted `{ preserveCalendarViewer: true }`. Any argument now
        // would be a way to keep something the teardown should end.
        for (const held of [null, { name: 'G. Miller' }]) {
            ops = []; sessionValue = held; currentUser = null;
            handleAccessLost(); await drainTurns(); _resetPageForTest();
            await initCalendarAccess({ onGranted: () => {} });
            assert.deepEqual(ops.filter(o => o.startsWith('reconcile:')), ['reconcile:{}'], JSON.stringify(held));
        }
    });


    test('a member with a SESSION but no identity gets their own sign-in card', async () => {
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
        assert.ok(!/staff PIN/i.test(html), 'the member card still offers the staff PIN');
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
        // pinned in e2e/calendar-access.spec.js; THIS pins the wiring, which is the half a unit test
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

    // K1 (review, 21 Nov 2026). The come-back card opens the MODAL form, whose way back — "← Back to
    // roster" and Escape — went to `./`: the page it is on, reloading into the same card.
    test('the come-back form\'s way back is the come-back card, in place — its button and Escape, never a reload', async () => {
        sessionValue = { name: 'G. Miller' };
        await initCalendarAccess({ onGranted: () => {} });
        await new Promise(r => setTimeout(r, 0));   // let the silent attempt settle
        const signIn = document.getElementById('calLockSubmit');
        await signIn._listeners.get('click')();
        const form = loginMounts.at(-1);
        assert.equal(form?.host, undefined, 'premise: the full-screen form is up');
        assert.equal(form.alternative?.label, '← Back', 'the form kept its link to `./`, the page it is already on');
        ops = [];
        let focused = 0;
        signIn.focus = () => { focused++; };
        form.alternative.onSelect();
        assert.equal(loginDismissals, 1, 'the form stayed up');
        assert.equal(lockCardId(), 'calendarLock', 'the come-back card is not where the form left it');
        assert.equal(focused, 1, 'focus was not given back to the card\'s Sign in');
        // …and Escape goes to the same place, ahead of the form's own (which follows the link).
        const onKey = document.getElementById('loginOverlay')._listeners.get('keydown');
        assert.ok(onKey, 'nothing catches Escape before the form\'s own handler reloads the page');
        let stopped = 0;
        const press = (/** @type {string} */ key) => onKey({ key, stopImmediatePropagation() { stopped++; } });
        press('Tab');
        assert.equal(stopped, 0, 'a key other than Escape was taken from the form (its focus trap needs Tab)');
        press('Escape');
        assert.equal(stopped, 1, 'the form\'s own Escape still ran, and reloads');
        assert.equal(loginDismissals, 2);
        // Mid-sign-in, Escape is still kept from the form's handler, and does nothing — as the form's own does.
        loginBusy = true;
        press('Escape');
        assert.equal(stopped, 2);
        assert.equal(loginDismissals, 2, 'Escape took the form down under its own sign-in');
        assert.deepEqual(ops.filter(o => o === 'reload' || o.startsWith('replace')), [], 'the way back reloaded the page');
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

        test('…but not while the form\'s OWN sign-in is in flight — its success grants, after the forced set-password step\'s marker is written', async () => {
            await openTheForm();
            loginBusy = true;                                     // the member pressed Sign in; Firebase signs them in
            emitAuth({ uid: 'member-1', isAnonymous: false });
            assert.equal(getAccessType(), 'none', 'the restore granted under the form\'s own sign-in — the first grant ran before its marker was written');
            assert.equal(loginDismissals, 0, 'the form went before its own sign-in had finished');
        });

        test('and never the front door\'s INLINE card — that one goes with the slot', async () => {
            await initCalendarAccess({ onGranted: () => {} });    // nothing held: the inline sign-in card
            assert.ok(loginMounts.at(-1)?.host, 'premise: the inline card is up');
            sessionValue = { name: 'G. Miller' };                 // a member's identity lands late
            emitAuth({ uid: 'member-1', isAnonymous: false });
            assert.equal(getAccessType(), 'named');
            assert.equal(loginDismissals, 0, 'the inline card was dismissed as though it were the dialog — '
                + 'its scroll unlock is unpaired, and would release another overlay\'s lock');
        });
    });


    test('the member card offers no way to the staff PIN — "Sign out and use the staff PIN" went with it', async () => {
        sessionValue = { name: 'A. Person' };
        await initCalendarAccess({ onGranted: () => {} });
        await new Promise(r => setTimeout(r, 0));
        const html = lastPanelHtml();
        assert.ok(html.includes('calLockWho'), 'premise: the member card is up');
        assert.ok(!html.includes('calLockPinInstead') && !/staff PIN/i.test(html), 'the member card still leads to the staff PIN');
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
                assert.ok(lastPanelHtml().includes('calLockWho'), 'the member\'s own card did not follow');
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
                assert.ok(lastPanelHtml().includes('calLockWho'), 'the member\'s own card did not follow');
            }
            silentGate = null;
        }
    });

    // cal-data-10 is reversed (owner, 23 Nov 2026): a staff-PIN session that restores after the decision
    // was granted as the viewer; now it opens nothing, as one restored in time does not.
    test('a leftover STAFF-PIN session that restores late is not granted', async () => {
        let started = 0;
        assert.equal(await initCalendarAccess({ onGranted: () => { started++; } }), 'none');
        emitAuth({ uid: 'calendar-viewer', isAnonymous: false, getIdTokenResult: async () => ({ claims: { calendarViewer: true } }) });
        await drainTurns();
        assert.equal(getAccessType(), 'none', 'a late PIN session opened the Calendar');
        assert.equal(started, 0);
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

    test('the skeleton\'s one line is written once the skeleton has been DRAWN, not in the task that mounted it', async () => {
        // A live region put on the page and filled in the same task arrives with its words already in
        // it — a region created with text, which no screen reader speaks. Writing on the line after the
        // mount, as the skeleton did until 17 Nov 2026, is the same task (speakAfterMount).
        showBootSkeleton();
        const status = lastPanel().querySelector('[role="status"]');
        assert.equal(status.textContent, '', 'the words went in with the region, so they are never announced');
        await turn();
        assert.equal(status.textContent, 'Loading the roster…', 'the skeleton says nothing to a screen reader');
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

describe('handleAccessLost', () => {








    test('losing access mid-session drops back to locked rather than looping on retry', async () => {
        // A Firestore `permission-denied` after the Calendar is open means the session expired, not
        // that the network is poor. Left as a sync-chip retry it is a loop the member cannot win.
        sessionValue = { name: 'G. Miller' };
        currentUser = { uid: 'member-1', isAnonymous: false };
        assert.equal(await initCalendarAccess({ onGranted: () => {} }), 'named');
        handleAccessLost();
        assert.equal(getAccessType(), 'none');
    });


    test('a MEMBER losing access gets their own card (CALENDAR_DATA.md 11)', async () => {
        // Until v23.19 this path showed the PIN card to everyone; the way back in is the member's own.
        sessionValue = { name: 'G. Miller' };
        currentUser = { uid: 'member-1', isAnonymous: false };
        await initCalendarAccess({ onGranted: () => {} });
        assert.equal(getAccessType(), 'named');
        handleAccessLost();
        assert.equal(getAccessType(), 'none');
        assert.ok(lastPanelHtml().includes('calLockWho'), 'the member card was not shown');
        // Its reason is a live region mounted in this task: written a task later, or never spoken.
        assert.equal(document.getElementById('calLockWhy').textContent, '',
            'the reason went in with the card, so it is never announced (speakAfterMount, calendar-lock-slot.js)');
        await turn();
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
    });

    test('handleAccessLost is a no-op when already locked', () => {
        handleAccessLost();
        assert.equal(getAccessType(), 'none');
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

// ── The cards' own rules ─────────────────────────────────────────────────────────────────────────
//
// Found by mutation when `calendar-lock-cards.js` was split out at v23.54 and its header wrote the
// rules down: deleting the post-import access re-check left this whole file green. Writing an
// invariant in a header is not protecting it. One-card-at-a-time is the SLOT's guarantee
// (`mountLockCard` calls `unmountLockCard` itself). The PIN card's rules went with it (23 Nov 2026);
// the front door's fallback, which was the PIN card, is pinned here instead.
describe('the cards themselves', () => {
    test('a card must not mount over a Calendar that was granted while it loaded', () => {
        // The sign-in card awaits a dynamic import, and access can arrive during it — the
        // late-identity watcher, or a silent re-auth landing. Mounting afterwards puts a sign-in
        // form over a working Calendar, which is the one outcome this path must not have. The race
        // is forced deterministically: start the card, let it reach its `await`, then grant.
        const pending = showSignInPanel();
        sessionValue = { name: 'G. Miller' };
        emitAuth({ uid: 'member-1', isAnonymous: false });   // the restore lands — but nothing is watching yet
        return initCalendarAccess({ onGranted: () => {} })
            .then(() => pending)
            .then(() => {
                assert.equal(getAccessType(), 'named', 'the grant did not happen — the race is not being tested');
                assert.ok(!lastPanelHtml().includes('SIGN-IN CARD'),
                    'a sign-in card was mounted over a granted Calendar');
            });
    });






    // THE FRONT DOOR ALWAYS LEAVES A WAY FORWARD (rule 3 of calendar-lock-cards.js). When the sign-in
    // form's module cannot load, it fell back to the PIN card, which needed nothing fetched. With the
    // PIN gone, it says what happened and offers a reload — never an empty slot, and never a PIN.
    test('the sign-in form cannot load: a short card says so and offers a reload — not a PIN', async () => {
        formLoadFails = true;
        await initCalendarAccess({ onGranted: () => {} });
        assert.equal(loginMounts.length, 0, 'premise: the form did not load');
        assert.equal(lockCardId(), 'calendarSignInUnavailable', 'the slot was left empty, or held something else');
        const html = lastPanelHtml();
        assert.ok(!/calLockPin|staff PIN/i.test(html), 'the fallback is the PIN card again');
        const why = document.getElementById('calLockUnavailableWhy');
        assert.equal(why.textContent, '', 'the line went in with the card, so it is never announced');
        await turn();
        assert.equal(why.textContent, SIGN_IN_UNAVAILABLE_LINE);
        const retry = document.getElementById('calLockSubmit');
        assert.match(html, /id="calLockSubmit"[^>]*>Try again</, 'no way to try again');
        ops = [];
        retry._listeners.get('click')();
        assert.deepEqual(ops, ['reload'], 'Try again does not reload the page');
    });

    test('…but not over a Calendar granted while the form was failing to load', async () => {
        formLoadFails = true;
        sessionValue = { name: 'G. Miller' };
        currentUser = { uid: 'member-1', isAnonymous: false };
        assert.equal(await initCalendarAccess({ onGranted: () => {} }), 'named');
        await showSignInPanel();
        assert.equal(lockCardId(), null, 'a fallback card went up over a granted Calendar');
    });

});

// ── WHETHER ACCESS IS HELD LIVES IN ONE PLACE, AND THIS MODULE WRITES IT (Calendar step 2, v25.74) ──
//
// Until v25.74 this module kept its own answer (`named`, then also `viewer`, or `none`) while the roster reads
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
    /** A member's grant at boot — the one grant there is since the staff PIN was retired. */
    async function grantMember() {
        sessionValue = { name: 'G. Miller' };
        currentUser = { uid: 'member-1', isAnonymous: false };
        assert.equal(await initCalendarAccess({ onGranted: () => {} }), 'named');
    }

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

    test('a late identity\'s grant: the card has GONE before the documents are told', async () => {
        /** @type {string[]} */ const order = [];
        await initCalendarAccess({
            onEveryGrant: () => order.push(`every:${hasCalendarAccess()}`),
            onGranted:    () => order.push(`granted:${hasCalendarAccess()}`),
        });
        await waitFor(() => lockCardId() !== null, 'the sign-in card');
        assert.equal(hasCalendarAccess(), false, 'premise: nothing is granted yet');
        onDocumentAccess(open => order.push(`documents:${open}:card=${lockCardId()}`));
        sessionValue = { name: 'G. Miller' };
        emitAuth({ uid: 'member-1', isAnonymous: false });
        assert.deepEqual(order, ['documents:true:card=null', 'every:true', 'granted:true'],
            'a held document would have opened over a card about to be taken away');
    });


    test('`getAccessType` reads `none` the moment the state shuts, before anybody calls this module', async () => {
        await grantMember();
        assert.equal(getAccessType(), 'named');
        // What a refused month read does (calendar-overrides.js), before it tells anybody.
        setCalendarAccess(false);
        assert.equal(getAccessType(), 'none', 'this module still reported access over gates that had shut');
    });

    test('an open state this module never granted is not reported as access of any kind', () => {
        setCalendarAccess(true);
        assert.equal(getAccessType(), 'none');
        handleAccessLost();
        assert.equal(hasCalendarAccess(), false, 'handleAccessLost left a gate open because it had no card to show');
    });


    test('a MEMBER\'s card is still owed, and their own, after a refused read has ALREADY shut the state', async () => {
        sessionValue = { name: 'G. Miller' };
        currentUser = { uid: 'member-1', isAnonymous: false };
        await initCalendarAccess({ onGranted: () => {} });
        setCalendarAccess(false);
        handleAccessLost();
        assert.ok(lastPanelHtml().includes('calLockWho'), 'the state was already shut, so no card went up — the roster stayed on screen');
    });

    test('`handleAccessLost` shuts the state ITSELF, and before the card goes up', async () => {
        // The first load's route: nobody has shut anything when this is called. Until v25.74 this
        // function shut nothing, and relied on a wrapper in the coordinator to have closed both gates.
        await grantMember();
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
        await grantMember();
        handleAccessLost();
        const card = lastPanel();
        let writes = 0;
        listen(() => { writes++; });
        handleAccessLost();
        assert.equal(writes, 0);
        assert.equal(lastPanel(), card, 'a second card was built');
    });

    test('a re-grant is a NEW grant', async () => {
        await grantMember();
        const first = grantNumber();
        handleAccessLost();
        assert.equal(grantNumber(), first, 'losing access counted as a grant');
        // The late-identity watcher is armed only by a boot that ends locked: a fresh page, then.
        _resetPageForTest(); sessionValue = null; currentUser = null;
        await initCalendarAccess({ onGranted: () => {} });
        sessionValue = { name: 'G. Miller' };
        emitAuth({ uid: 'member-1', isAnonymous: false });
        assert.equal(grantNumber(), first + 1, 'a read still out from before the lock would settle under the new grant');
        assert.equal(getAccessType(), 'named');
    });

});

// ── A SIGN-IN ON A CARD GRANTS IN PLACE (ROADMAP_HISTORY → "Calendar sign-in without the reload") ──
//
// Until v26.40 both cards' sign-ins reloaded the page, and the reload did three jobs: it rebuilt what
// the page had built at load for nobody, it ran the forced set-password step, and it carried a document
// tap the lock held. `finishSignIn` now grants in place on a page that has never been granted, which
// does all three; anything else still reloads. These drive the ORDERS it could get wrong
// (.claude/rules/calendar.md): which hook runs before which, a restore landing under the form's own
// sign-in, and a grant that happened first.
describe('a sign-in on a card grants in place, or reloads', () => {
    /** @param {string[]} seen */
    function hooks(seen) {
        return {
            onGranted: () => seen.push('onGranted'),
            onEveryGrant: () => seen.push('onEveryGrant'),
            onSignedInInPlace: () => seen.push(`signedIn:${getAccessType()}`),
        };
    }
    /** What the sign-in core leaves behind on success: the saved session and the member's identity. */
    function signedIn(name = 'G. Miller') {
        sessionValue = { name };
        currentUser = { uid: 'member-1', isAnonymous: false };
    }

    test('the front door: no reload, the page\'s rebuild BEFORE the grant, the first grant\'s steps once', async () => {
        const seen = [];
        await initCalendarAccess(hooks(seen));                // nothing held: the inline sign-in card
        const card = loginMounts.at(-1);
        assert.ok(card?.host, 'premise: the inline front-door card is up');
        signedIn();
        await card.onSuccess('G. Miller');
        assert.ok(!ops.includes('reload'), `a sign-in on a never-granted page reloaded it: ${JSON.stringify(ops)}`);
        assert.equal(getAccessType(), 'named');
        assert.deepEqual(seen, ['signedIn:none', 'onEveryGrant', 'onGranted'],
            'the menu was rebuilt after the Calendar appeared, or the first grant\'s steps did not run');
        assert.equal(lockCardId(), null, 'the sign-in card stayed where the Calendar goes');
    });

    test('the come-back card: a restore landing under the form waits, and the form\'s success grants ONCE and takes it down', async () => {
        const seen = [];
        sessionValue = { name: 'G. Miller' };                 // a session whose identity did not restore
        await initCalendarAccess(hooks(seen));
        await new Promise(r => setTimeout(r, 0));
        await document.getElementById('calLockSubmit')._listeners.get('click')();
        const form = loginMounts.at(-1);
        assert.equal(form?.host, undefined, 'premise: the full-screen form is up');
        loginBusy = true;                                     // Sign in pressed: Firebase signs them in
        emitAuth({ uid: 'member-1', isAnonymous: false });
        assert.deepEqual(seen, [], 'a grant ran before the sign-in finished');
        await form.onSuccess('G. Miller');
        assert.ok(!ops.includes('reload'), `reloaded: ${JSON.stringify(ops)}`);
        assert.deepEqual(seen, ['signedIn:none', 'onEveryGrant', 'onGranted']);
        assert.equal(loginDismissals, 1, 'the full-screen form stayed over the Calendar its own sign-in opened');
    });

    test('a page granted before — a member, then lost — RELOADS, and rebuilds nothing in place', async () => {
        const seen = [];
        signedIn();
        await initCalendarAccess(hooks(seen));                // a member's grant built the Calendar
        sessionValue = null;                                  // the session went with the access
        handleAccessLost();
        await drainTurns();
        seen.length = 0;
        signedIn();
        assert.equal(finishSignIn(), 'reload');
        assert.ok(ops.includes('reload'), 'a Calendar built for one grant was handed to the next in place');
        assert.deepEqual(seen, [], 'the page was rebuilt in place AND reloaded');
        assert.equal(getAccessType(), 'none');
    });


    test('a grant that landed DURING the sign-in (the silent attempt) is not repeated — the success reloads', async () => {
        const seen = [];
        sessionValue = { name: 'G. Miller' };
        /** @type {(v?: any) => void} */ let release = () => {};
        silentGate = new Promise(r => { release = r; });       // the silent attempt outlives the card's bound
        silentReauthSucceeds = true;
        const boot = initCalendarAccess(hooks(seen));
        await waitFor(() => lockCardId() === 'calendarLock' || !!document.getElementById('calLockSubmit')?._listeners?.get('click'), 'the come-back card', 4000);
        await boot;
        release();                                            // …and lands while the member types
        await waitFor(() => getAccessType() === 'named', 'the late silent grant');
        assert.deepEqual(seen, ['onEveryGrant', 'onGranted']);
        signedIn();
        assert.equal(finishSignIn(), 'reload');
        assert.deepEqual(seen, ['onEveryGrant', 'onGranted'], 'the first grant\'s steps ran twice');
    });

    test('a late SILENT sign-in landing while the card\'s own sign-in is in flight waits for it — the form\'s success grants in place, once (review, 20 Nov 2026)', async () => {
        const seen = [];
        sessionValue = { name: 'G. Miller' };
        /** @type {(v?: any) => void} */ let release = () => {};
        silentGate = new Promise(r => { release = r; });
        silentReauthSucceeds = true;
        const boot = initCalendarAccess(hooks(seen));
        await waitFor(() => !!document.getElementById('calLockSubmit')?._listeners?.get('click'), 'the come-back card', 4000);
        await boot;
        await document.getElementById('calLockSubmit')._listeners.get('click')();
        const form = loginMounts.at(-1);
        loginBusy = true;                                     // Sign in pressed…
        release();                                            // …and the silent attempt lands meanwhile
        await new Promise(r => setTimeout(r, 450));
        assert.equal(getAccessType(), 'none', 'the silent attempt granted under the form — the first grant ran before the forced-step marker');
        signedIn();
        await form.onSuccess('G. Miller');
        assert.ok(!ops.includes('reload'), `reloaded: ${JSON.stringify(ops)}`);
        assert.deepEqual(seen, ['signedIn:none', 'onEveryGrant', 'onGranted']);
        loginBusy = false;                                    // the form's attempt settles
        await new Promise(r => setTimeout(r, 450));
        assert.deepEqual(seen, ['signedIn:none', 'onEveryGrant', 'onGranted'], 'the waiting grant ran a second time');
    });

    test('an identity that lands under a sign-in which then FAILS is granted once the attempt settles (review, 20 Nov 2026)', async () => {
        const seen = [];
        sessionValue = { name: 'G. Miller' };
        await initCalendarAccess(hooks(seen));
        await new Promise(r => setTimeout(r, 0));
        await document.getElementById('calLockSubmit')._listeners.get('click')();
        loginBusy = true;                                     // Sign in pressed: Firebase signs them in…
        emitAuth({ uid: 'member-1', isAnonymous: false });
        await new Promise(r => setTimeout(r, 450));
        assert.equal(getAccessType(), 'none', 'granted under the form');
        loginBusy = false;                                    // …but the attempt times out: no onSuccess
        await waitFor(() => getAccessType() === 'named', 'the grant once the attempt settled', 2000);
        assert.deepEqual(seen, ['onEveryGrant', 'onGranted'], 'a live identity was left locked out');
        assert.ok(!ops.includes('reload'));
    });

    test('a sign-in whose live identity does not decide `named` reloads, so the boot decides', async () => {
        const seen = [];
        await initCalendarAccess(hooks(seen));
        sessionValue = { name: 'G. Miller' };
        currentUser = null;                                   // the identity is not there after all
        assert.equal(finishSignIn(), 'reload');
        assert.deepEqual(seen, []);
        assert.equal(getAccessType(), 'none');
    });

    // F1 (21 Nov 2026), found as a flaky test: a grant that WAITED could land after the page had been
    // granted and LOST since, re-granting in place a page granted before, with the identity the rules
    // had just refused. Mocked timers, so the wait runs when the test says and not before.
    test('a grant that waited for the form\'s sign-in to settle does not land after a later grant was LOST', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        const flush = async () => { for (let i = 0; i < 12; i++) await new Promise(r => setImmediate(r)); };
        const seen = [];
        sessionValue = { name: 'G. Miller' };                 // a session whose identity did not restore
        const boot = initCalendarAccess(hooks(seen));
        await flush();
        assert.equal(await boot, 'none', 'premise: the come-back card');
        await document.getElementById('calLockSubmit')._listeners.get('click')();
        const form = loginMounts.at(-1);
        loginBusy = true;                                     // Sign in pressed…
        emitAuth({ uid: 'member-1', isAnonymous: false });    // …and an identity lands: the watcher waits
        await form.onSuccess('G. Miller');                    // the form's success grants, in place
        assert.deepEqual(seen, ['signedIn:none', 'onEveryGrant', 'onGranted'], 'premise: granted once');
        handleAccessLost();                                   // a refused read, moments later
        loginBusy = false;                                    // the form's attempt settles…
        t.mock.timers.tick(200);                              // …and the wait looks again
        await flush();
        assert.equal(getAccessType(), 'none', 'the wait re-granted, in place, the access the rules had just refused');
        assert.deepEqual(seen, ['signedIn:none', 'onEveryGrant', 'onGranted']);
    });

    test('nor does a silent sign-in that outlived its bound, once the page has been granted and lost since', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        const flush = async () => { for (let i = 0; i < 12; i++) await new Promise(r => setImmediate(r)); };
        const seen = [];
        sessionValue = { name: 'G. Miller' };
        /** @type {(v?: any) => void} */ let release = () => {};
        silentGate = new Promise(r => { release = r; });       // the silent attempt hangs…
        silentReauthSucceeds = true;
        const boot = initCalendarAccess(hooks(seen));
        await flush();
        t.mock.timers.tick(4000);                             // …past the card's bound
        assert.equal(await boot, 'none', 'premise: the come-back card, the silent attempt still out');
        emitAuth({ uid: 'member-1', isAnonymous: false });    // the restore lands and is granted
        assert.equal(getAccessType(), 'named', 'premise: granted by the watcher');
        handleAccessLost();                                   // …and lost
        release();                                            // the silent attempt succeeds, late
        await flush();
        assert.equal(getAccessType(), 'none', 'the late silent success re-granted a page whose access had just been refused');
        assert.deepEqual(seen, ['onEveryGrant', 'onGranted']);
    });

    test('the cards hand their success to `finishSignIn` — neither reloads by itself', async () => {
        await initCalendarAccess({ onGranted: () => {} });
        signedIn();
        await loginMounts.at(-1).onSuccess('G. Miller');      // the front door's
        assert.equal(getAccessType(), 'named');
        assert.ok(!ops.includes('reload'));
    });
});
