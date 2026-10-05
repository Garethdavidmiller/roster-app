// @ts-check
/**
 * page-session.test.mjs — the shared sign-out and session-loss routines every protected page uses.
 * Run with: node --test --experimental-test-module-mocks page-session.test.mjs
 *
 * These drive the module's real functions against recording stand-ins for what they touch — the
 * session, the drawer, the sign-in, the browser's location and its page events — and assert on
 * the ORDER of what happened, because order is the substance here: a sign-out that releases the
 * session before asking about unsaved work is exactly the defect this module was written to end.
 * page-contract-parity.test.mjs proves each coordinator is wired to these; this proves what they do.
 */

import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

/** Everything the module did, in order. @type {string[]} */
let log = [];
/** @type {{ name?: string }|null} */ let session = { name: 'A. Member' };
let decision = 'allow';
/** @type {{ uid: string }|null} */ let currentUser = { uid: 'u1' };
let confirmAnswer = true;
/** @type {any} */ let watchArgs = null;

mock.module('./firebase-client.js', { namedExports: {
    auth: { get currentUser() { return currentUser; } },
    onAuthStateChanged: () => () => {},
} });
mock.module('./session.js', { namedExports: {
    getSession: () => session,
    clearSession: () => { log.push('clearSession'); session = null; },
} });
mock.module('./auth-policy.js', { namedExports: { requirePage: (/** @type {any} */ _s, /** @type {string} */ page) => { log.push(`requirePage:${page}`); return { decision }; } } });
mock.module('./auth-state.js', { namedExports: { getAuthSnapshot: () => ({}) } });
mock.module('./claim-retry.js', { namedExports: { watchIdentityLoss: (/** @type {any} */ a) => { log.push('watch'); watchArgs = a; return () => {}; } } });
mock.module('./nav-panel.js', { namedExports: { resetNavPanel: () => log.push('resetNavPanel') } });
mock.module('./overlay.js', { namedExports: { confirmDialog: async () => { log.push('confirm'); return confirmAnswer; } } });
mock.module('./login-overlay.js', { namedExports: { initLoginOverlay: (/** @type {any} */ o) => log.push(`login:${o.pageLabel}`) } });

/** A window that records listeners and navigation. @type {Record<string, Function[]>} */
let listeners = {};
global.window = /** @type {any} */ ({
    addEventListener: (/** @type {string} */ t, /** @type {Function} */ fn) => { (listeners[t] ??= []).push(fn); },
    location: { reload: () => log.push('reload'), replace: (/** @type {string} */ to) => log.push(`replace:${to}`) },
});
const fire = (/** @type {string} */ t, /** @type {any} */ e = {}) => (listeners[t] ?? []).forEach(fn => fn(e));

const ps = await import('./page-session.js');

/** Let the on-demand import of the sign-in land (a dynamic import takes more than one tick). */
const settle = () => new Promise(r => setTimeout(r, 50));

beforeEach(() => { log = []; session = { name: 'A. Member' }; decision = 'allow'; currentUser = { uid: 'u1' }; confirmAnswer = true; watchArgs = null; });

describe('guardNamedSession', () => {
    test('an unconfirmed own session: clear, tear down the drawer, THEN the sign-in — and no watch', async () => {
        decision = 'login';
        await ps.guardNamedSession({ page: 'links', pageLabel: 'Links', member: 'A. Member', established: Promise.resolve() });
        await settle();   // the default sign-in is loaded on demand
        assert.deepEqual(log, ['requirePage:links', 'clearSession', 'resetNavPanel', 'login:Links']);
    });

    test('a confirmed session is watched, and its LATER loss runs the same sign-in', async () => {
        await ps.guardNamedSession({ page: 'overtime', pageLabel: 'Overtime', member: 'A. Member', established: true });
        assert.deepEqual(log, ['requirePage:overtime', 'watch']);
        assert.equal(watchArgs.uid, 'u1');
        currentUser = null;
        assert.equal(watchArgs.stillLost(), true, 'no Firebase user, and the page still belongs to this member');
        session = { name: 'Someone Else' };
        assert.equal(watchArgs.stillLost(), false, 'a different member signed in here — not this page\'s loss');
        session = { name: 'A. Member' };
        log = [];
        watchArgs.onLost();
        await settle();
        assert.deepEqual(log, ['clearSession', 'resetNavPanel', 'login:Overtime']);
    });

    test('a page with its own sign-in (Admin) gets that, not the shared one', async () => {
        decision = 'login';
        await ps.guardNamedSession({ page: 'admin', pageLabel: 'Admin', member: 'A. Member', established: null,
            signIn: () => log.push('adminLogin') });
        assert.deepEqual(log, ['requirePage:admin', 'clearSession', 'resetNavPanel', 'adminLogin']);
    });

    test('it waits for the session to settle before deciding', async () => {
        /** @type {() => void} */ let settle = () => {};
        const done = ps.guardNamedSession({ page: 'settings', pageLabel: 'Settings', member: 'A. Member', established: new Promise(r => { settle = () => r(undefined); }) });
        await new Promise(r => setTimeout(r, 0));
        assert.deepEqual(log, [], 'nothing is decided while the Firebase session is still being established');
        settle();
        await done;
        assert.deepEqual(log, ['requirePage:settings', 'watch']);
    });
});

describe('signing out', () => {
    test('with no unsaved work, nothing is asked', async () => {
        assert.equal(await ps.askBeforeSignOut(() => false)(), true);
        assert.deepEqual(log, []);
    });

    test('with unsaved work, the answer decides — and a Cancel touches nothing', async () => {
        confirmAnswer = false;
        assert.equal(await ps.askBeforeSignOut(() => true)(), false);
        confirmAnswer = true;
        assert.equal(await ps.askBeforeSignOut(() => true)(), true);
        assert.deepEqual(log, ['confirm', 'confirm'], 'asking clears nothing — the drawer releases only after a yes');
    });

    test('the browser\'s "Leave site?" asks only while there is unsaved work', () => {
        listeners = {};
        let dirty = true;
        ps.warnOnUnload(() => dirty);
        const ask = () => { const e = { prevented: false, preventDefault() { this.prevented = true; } }; fire('beforeunload', e); return e.prevented; };
        assert.equal(ask(), true);
        dirty = false;
        assert.equal(ask(), false);
    });

    test('the session is cleared BEFORE leaving, and leaving never adds a history entry', () => {
        ps.signOutAndLeave({ to: './' });
        assert.deepEqual(log, ['clearSession', 'replace:./']);
        log = []; session = { name: 'A. Member' };
        ps.signOutAndLeave();
        assert.deepEqual(log, ['clearSession', 'reload'], 'no destination: this page shows its own sign-in');
    });

    test('the browser\'s "Leave site?" stands down once a sign-out has been answered', () => {
        // Runs after the two tests above, deliberately: signOutAndLeave has now marked the page as
        // leaving, and module state is not reset between tests.
        listeners = {};
        ps.warnOnUnload(() => true);
        const e = { prevented: false, returnValue: undefined, preventDefault() { this.prevented = true; } };
        fire('beforeunload', e);
        assert.equal(e.prevented, false, 'an answered sign-out must not be asked about a second time');
    });
});

describe('back/forward cache', () => {
    test('a page restored for a different member — or for nobody — reloads; for the same one it does not', () => {
        listeners = {};
        ps.reloadIfRestoredForSomeoneElse();
        ps.reloadIfRestoredForSomeoneElse();   // a coordinator re-entered by an in-place sign-in
        assert.equal((listeners.pageshow ?? []).length, 1, 'installed once, however often it is called');

        fire('pageshow', { persisted: true });
        assert.deepEqual(log, [], 'same member: the restored page is theirs');
        fire('pageshow', { persisted: false });
        session = null;
        fire('pageshow', { persisted: false });
        assert.deepEqual(log, [], 'an ordinary load is not a restore');
        fire('pageshow', { persisted: true });
        assert.deepEqual(log, ['reload'], 'signed out since: the page must not come back with their data');
    });

    test('another member signing in on ANOTHER TAB does not get this page back — the Pay Calculator case', () => {
        // The page was built for A (the guard was installed above with A signed in, then A signed
        // out and the restore reloaded). Re-arm the scenario: B signs in elsewhere while this page
        // still shows A, the page is left, and B presses Back. Comparing only at pagehide would
        // record B and let A's page through.
        log = [];
        session = { name: 'B. Member' };
        fire('pagehide');
        fire('pageshow', { persisted: true });
        assert.deepEqual(log, ['reload'], 'the page was built for A; B must not be shown it');
    });

    test('a page signed into IN PLACE, then signed out elsewhere, does not come back with that member\'s data', async () => {
        // Built for nobody (the sign-in screen), then the member signs in without a reload — so the
        // built-for identity is null and so is the session after the sign-out. Only the identity at
        // pagehide sees that the page was SHOWING somebody. A fresh copy of the module, because the
        // guard installs once per page and this scenario starts from a signed-out load.
        const fresh = await import('./page-session.js?in-place');
        listeners = {}; log = [];
        session = null;
        fresh.reloadIfRestoredForSomeoneElse();
        session = { name: 'A. Member' };     // the in-place sign-in
        fire('pagehide');
        session = null;                      // signed out on another page or tab
        fire('pageshow', { persisted: true });
        assert.deepEqual(log, ['reload']);
    });
});
