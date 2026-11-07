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
/** @type {any} */ let authCb = null;

mock.module('./firebase-client.js', { namedExports: {
    auth: { get currentUser() { return currentUser; } },
    onAuthStateChanged: (/** @type {any} */ _a, /** @type {any} */ cb) => { log.push('authWatch'); authCb = cb; return () => log.push('authUnwatch'); },
} });
mock.module('./session.js', { namedExports: {
    AUTH_KEY: 'myb_admin_session',
    getSession: () => session,
    clearSession: () => { log.push('clearSession'); session = null; },
} });
mock.module('./auth-policy.js', { namedExports: { requirePage: (/** @type {any} */ _s, /** @type {string} */ page) => { log.push(`requirePage:${page}`); return { decision }; } } });
mock.module('./auth-state.js', { namedExports: { getAuthSnapshot: () => ({}) } });
mock.module('./claim-retry.js', { namedExports: { watchIdentityLoss: (/** @type {any} */ a) => { log.push('watch'); watchArgs = a; return () => {}; } } });
mock.module('./nav-panel.js', { namedExports: { resetNavPanel: () => log.push('resetNavPanel') } });
let lastConfirm = '';
let inFlight = 0;
mock.module('./overlay.js', { namedExports: { confirmDialog: async (/** @type {any} */ o) => { log.push('confirm'); lastConfirm = o.message; return confirmAnswer; }, whenHistorySettled: (/** @type {() => void} */ fn) => fn() } });
mock.module('./slow-save.js', { namedExports: { writesInFlight: () => inFlight } });
mock.module('./login-overlay.js', { namedExports: { initLoginOverlay: (/** @type {any} */ o) => log.push(`login:${o.pageLabel}`) } });

/** sessionStorage for the late-identity reload cap. @type {Map<string,string>} */
const ss = new Map();
global.sessionStorage = /** @type {any} */ ({ getItem: (/** @type {string} */ k) => ss.get(k) ?? null, setItem: (/** @type {string} */ k, /** @type {string} */ v) => { ss.set(k, String(v)); } });
/** A window that records listeners and navigation. @type {Record<string, Function[]>} */
let listeners = {};
global.window = /** @type {any} */ ({
    addEventListener: (/** @type {string} */ t, /** @type {Function} */ fn) => { (listeners[t] ??= []).push(fn); },
    location: { reload: () => log.push('reload'), replace: (/** @type {string} */ to) => log.push(`replace:${to}`) },
});
const fire = (/** @type {string} */ t, /** @type {any} */ e = {}) => (listeners[t] ?? []).forEach(fn => fn(e));
/** A document that records listeners and can be hidden or shown. @type {Record<string, Function[]>} */
let docListeners = {};
global.document = /** @type {any} */ ({
    visibilityState: 'visible',
    addEventListener: (/** @type {string} */ t, /** @type {Function} */ fn) => { (docListeners[t] ??= []).push(fn); },
});
const fireDoc = (/** @type {string} */ t, /** @type {any} */ e = {}) => (docListeners[t] ?? []).forEach(fn => fn(e));
/** Hide or show the page the way iOS does: the state changes, then `visibilitychange` fires. */
const setVisibility = (/** @type {'hidden'|'visible'} */ state) => {
    /** @type {any} */ (global.document).visibilityState = state;
    fireDoc('visibilitychange');
};
/** localStorage for the kept drafts (ls.js reads the global). @type {Map<string,string>} */
const ls = new Map();
global.localStorage = /** @type {any} */ ({
    getItem: (/** @type {string} */ k) => ls.get(k) ?? null,
    setItem: (/** @type {string} */ k, /** @type {string} */ v) => { ls.set(k, String(v)); },
    removeItem: (/** @type {string} */ k) => { ls.delete(k); },
    get length() { return ls.size; },
    key: (/** @type {number} */ i) => [...ls.keys()][i] ?? null,
});

const ps = await import('./page-session.js');

/** Let the on-demand import of the sign-in land (a dynamic import takes more than one tick). POLLED, not
 *  a fixed 50ms: a full unit lane on a busy machine overran that once (48-hour review, Nov 2026). Every
 *  caller expects the sign-in to show, so a bounded wait for it adds nothing a test could pass on. */
const settle = async () => {
    for (let i = 0; i < 100 && !log.some(e => e.startsWith('login:')); i++) await new Promise(r => setTimeout(r, 20));
};

beforeEach(() => { ss.clear(); ls.clear(); docListeners = {}; /** @type {any} */ (global.document).visibilityState = 'visible'; authCb = null; inFlight = 0; lastConfirm = ''; log = []; session = { name: 'A. Member' }; decision = 'allow'; currentUser = { uid: 'u1' }; confirmAnswer = true; watchArgs = null; });

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

    test('a session that could not be DECIDED (a stalled start-up) is kept: the sign-in shows over it, nothing is cleared', async () => {
        decision = 'pending';
        await ps.guardNamedSession({ page: 'settings', pageLabel: 'Settings', member: 'A. Member', established: Promise.resolve(false) });
        await settle();
        assert.deepEqual(log, ['requirePage:settings', 'authWatch', 'login:Settings'],
            'no clearSession, no resetNavPanel — a slow network is not a sign-out');
        assert.deepEqual(session, { name: 'A. Member' }, 'the 60-day session survives the stall');
    });

    test('…and when THIS member\'s identity lands late, the page reloads into it; anybody else\'s does not', async () => {
        decision = 'pending';
        await ps.guardNamedSession({ page: 'links', pageLabel: 'Links', member: 'A. Member', established: false });
        await settle();
        log = [];
        authCb(null);
        authCb({ isAnonymous: true, email: null });
        authCb({ isAnonymous: false, email: 'someone.else@example.test' });
        assert.deepEqual(log, [], 'nobody, the shared viewer and a colleague are all not this page\'s member');
        const { nameToEmail } = await import('./auth-identity.js');
        authCb({ isAnonymous: false, email: nameToEmail('A. Member') });
        assert.deepEqual(log, ['authUnwatch', 'reload'], 'the identity the page belongs to: stop watching, reload into it');
    });

    test('…but only ONCE per two minutes: a second late landing leaves the sign-in up rather than looping (24-hour review)', async () => {
        decision = 'pending';
        const { nameToEmail } = await import('./auth-identity.js');
        const me = { isAnonymous: false, email: nameToEmail('A. Member') };
        await ps.guardNamedSession({ page: 'links', pageLabel: 'Links', member: 'A. Member', established: false });
        await settle();
        log = [];
        authCb(me);
        assert.deepEqual(log, ['authUnwatch', 'reload'], 'the first landing reloads');
        // The same tab, loaded again seconds later into the same stall, with the same late landing.
        await ps.guardNamedSession({ page: 'links', pageLabel: 'Links', member: 'A. Member', established: false });
        await settle();
        log = [];
        authCb(me);
        assert.deepEqual(log, ['authUnwatch'], 'no second reload inside the window — the overlay stays, and can sign them in');
        assert.equal(ps.lateReloadAllowed(Date.now() + ps.LATE_RELOAD_GAP_MS + 1), true, 'and the cap lifts after the gap');
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

    test('a save still on its way is asked about, even with nothing unsaved on screen (v24.56)', async () => {
        inFlight = 1;
        confirmAnswer = false;
        assert.equal(await ps.askBeforeSignOut(() => false)(), false, 'a Cancel keeps the session so the save can land');
        assert.match(lastConfirm, /still be on its way/);
        assert.doesNotMatch(lastConfirm, /unsaved/);
        await ps.askBeforeSignOut(() => true)();
        assert.match(lastConfirm, /unsaved changes/, 'with both, the one question names both');
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

    test('the browser\'s "Leave site?" stands down once a sign-out has been answered', async () => {
        // A fresh copy of the module, signed out HERE. This test used to rely on running after the
        // one above (signOutAndLeave marks the page as leaving in module state), and failed when run
        // on its own (test audit, 7 Nov 2026). Asking first proves it is the sign-out that stands
        // the warning down, not a warning that never asks.
        const fresh = await import('./page-session.js?leave-answered');
        listeners = {};
        fresh.warnOnUnload(() => true);
        const ask = () => { const e = { prevented: false, returnValue: undefined, preventDefault() { this.prevented = true; } }; fire('beforeunload', e); return e.prevented; };
        assert.equal(ask(), true, 'unsaved work and no sign-out yet: the browser asks');
        fresh.signOutAndLeave({ to: './' });
        assert.equal(ask(), false, 'an answered sign-out must not be asked about a second time');
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

    test('another member signing in on ANOTHER TAB does not get this page back — the Pay Calculator case', async () => {
        // The page was built for A. B signs in elsewhere while this page still shows A, the page is
        // left, and B presses Back. Comparing only at pagehide would record B and let A's page
        // through. A fresh copy of the module, built for A HERE: this test used to inherit the guard
        // the test above installed, and failed when run on its own (test audit, 7 Nov 2026).
        const fresh = await import('./page-session.js?other-tab');
        listeners = {}; log = [];
        session = { name: 'A. Member' };
        fresh.reloadIfRestoredForSomeoneElse();
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

    test('another TAB signing out, or in as somebody else, reloads this one — a renewal does not', () => {
        listeners = {}; log = [];
        const stored = (/** @type {string|null} */ n) => n === null ? null : JSON.stringify({ name: n, ver: 3, expiry: 1 });
        const change = (/** @type {string|null} */ from, /** @type {string|null} */ to, key = 'myb_admin_session') => {
            session = to === null ? null : { name: to };
            fire('storage', { key, oldValue: stored(from), newValue: stored(to) });
        };
        // The guard installed above (module state) already listens; a fresh copy proves it alone.
        return import('./page-session.js?storage').then((fresh) => {
            fresh.reloadIfRestoredForSomeoneElse();
            change('A. Member', 'A. Member');
            assert.deepEqual(log, [], 'the same member re-saving the session is not a change');
            change('A. Member', 'A. Member', 'myb_something_else');
            assert.deepEqual(log, [], 'an unrelated key is ignored');
            change('A. Member', null);
            assert.deepEqual(log, ['reload'], 'signed out in another tab: this tab must not keep their data');
            log = [];
            change('A. Member', 'B. Member');
            assert.deepEqual(log, ['reload'], 'a colleague signed in elsewhere: this tab would write on their token');
            log = [];
            change(null, 'B. Member');
            assert.deepEqual(log, ['reload'], 'a signed-out (or PIN) tab follows a sign-in elsewhere');
        });
    });
});

// ── LEAVING BY A LINK THE APP DRAWS (iPhone audit, Nov 2026) ─────────────────────────────────────
// A phone never shows the browser's "Leave site?", so these are the only question an iPhone gets.
// The About panel's links joined the drawer's: Admin's "View staff roster" left staged edits behind
// without one, because the guard looked for `.nav-panel` alone.
describe('leaving by a drawer or About-panel link (askBeforeLeavingByDrawer)', () => {
    /** A tap on a link at `href`, inside `zone` ('.nav-panel', '#iconLightbox', or neither).
     *  @param {{ href: string, zone?: string, target?: string }} o */
    function tapOn({ href, zone = '#iconLightbox', target = '' }) {
        /** @type {any} */ const link = {
            target,
            getAttribute: (/** @type {string} */ n) => (n === 'href' ? href : null),
            closest: (/** @type {string} */ sel) => (sel === 'a[href]' ? link : sel === zone ? {} : null),
            click: () => log.push(`follow:${href}`),
        };
        const e = { target: { closest: (/** @type {string} */ sel) => link.closest(sel) }, prevented: false,
            preventDefault() { this.prevented = true; }, stopPropagation() {} };
        fireDoc('click', e);
        return e;
    }
    const answered = () => new Promise(r => setTimeout(r, 0));

    test('an About-panel link asks first — Cancel stays, Leave follows the link', async () => {
        const fresh = await import('./page-session.js?about-link');
        fresh.askBeforeLeavingByDrawer(() => true);
        confirmAnswer = false;
        assert.equal(tapOn({ href: './' }).prevented, true, 'held while the question is open');
        await answered();
        assert.deepEqual(log, ['confirm'], 'Cancel: the page and its work stay');
        assert.match(lastConfirm, /unsaved changes\. Leave this page anyway\?/);
        log = []; confirmAnswer = true;
        tapOn({ href: './staff-guide.html?from=admin.html' });
        await answered();
        assert.deepEqual(log, ['confirm', 'follow:./staff-guide.html?from=admin.html'], 'Leave: the link itself is followed');
    });

    test('the drawer\'s links still ask', async () => {
        const fresh = await import('./page-session.js?drawer-link');
        fresh.askBeforeLeavingByDrawer(() => true);
        assert.equal(tapOn({ href: './', zone: '.nav-panel' }).prevented, true);
        await answered();
        assert.deepEqual(log, ['confirm', 'follow:./']);
    });

    test('Report a bug never asks: "#" until About opens it, mail after — nor does a new tab', async () => {
        const fresh = await import('./page-session.js?not-leaving');
        fresh.askBeforeLeavingByDrawer(() => true);
        for (const t of [{ href: '#' }, { href: 'mailto:help@example.test?subject=Bug' }, { href: 'MAILTO:x@example.test' },
            { href: 'https://www.nationalrail.co.uk/', target: '_blank' }]) {
            assert.equal(tapOn(t).prevented, false, `${t.href} leaves the page where it is`);
        }
        await answered();
        assert.deepEqual(log, [], 'nothing asked, nothing followed by the guard');
    });

    test('a link anywhere else on the page, or a page with nothing unsaved, is not asked about', async () => {
        const fresh = await import('./page-session.js?elsewhere');
        let dirty = true;
        fresh.askBeforeLeavingByDrawer(() => dirty);
        assert.equal(tapOn({ href: './', zone: '#somewhereElse' }).prevented, false, 'the page\'s own links have their own questions');
        dirty = false;
        assert.equal(tapOn({ href: './' }).prevented, false, 'clean: nothing to ask about');
        await answered();
        assert.deepEqual(log, []);
    });
});
