// @ts-check
// @lane unit
/**
 * page-session.test.mjs — the shared sign-out and session-loss routines every protected page uses.
 * Run with: node --test --experimental-test-module-mocks test/page-session.test.mjs
 *
 * These drive the module's real functions against recording stand-ins for what they touch — the
 * session, the drawer, the sign-in, the browser's location and its page events — and assert on
 * the ORDER of what happened, because order is the substance here: a sign-out that releases the
 * session before asking about unsaved work is exactly the defect this module was written to end.
 * page-contract-parity.test.mjs proves each coordinator is wired to these; this proves what they do.
 */

import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Tests live in test/ but address files from the repository root (moved 24 Nov 2026).
const REPO_ROOT_URL = new URL('../', import.meta.url);

/** Everything the module did, in order. @type {string[]} */
let log = [];
/** @type {{ name?: string }|null} */ let session = { name: 'A. Member' };
let decision = 'allow';
/** @type {{ uid: string }|null} */ let currentUser = { uid: 'u1' };
let confirmAnswer = true;
/** @type {any} */ let watchArgs = null;
/** @type {any} */ let authCb = null;

mock.module('../firebase-client.js', { namedExports: {
    auth: { get currentUser() { return currentUser; } },
    onAuthStateChanged: (/** @type {any} */ _a, /** @type {any} */ cb) => { log.push('authWatch'); authCb = cb; return () => log.push('authUnwatch'); },
} });
mock.module('../session.js', { namedExports: {
    AUTH_KEY: 'myb_admin_session',
    getSession: () => session,
    clearSession: () => { log.push('clearSession'); session = null; },
    // Recorded into the same log, so its ORDER against the clear is what is asserted (audit A1).
    releasePushForEndingHold: async () => { log.push('releasePush'); },
} });
mock.module('../auth-policy.js', { namedExports: { requirePage: (/** @type {any} */ _s, /** @type {string} */ page) => { log.push(`requirePage:${page}`); return { decision }; } } });
mock.module('../auth-state.js', { namedExports: { getAuthSnapshot: () => ({}) } });
mock.module('../claim-retry.js', { namedExports: { watchIdentityLoss: (/** @type {any} */ a) => { log.push('watch'); watchArgs = a; return () => {}; } } });
mock.module('../nav-panel.js', { namedExports: { resetNavPanel: () => log.push('resetNavPanel') } });
let lastConfirm = '';
/** The whole of the last question asked — title, buttons and danger as well as the message. @type {any} */
let lastAsked = null;
let inFlight = 0;
mock.module('../overlay.js', { namedExports: { confirmDialog: async (/** @type {any} */ o) => { log.push('confirm'); lastConfirm = o.message; lastAsked = o; return confirmAnswer; }, whenHistorySettled: (/** @type {() => void} */ fn) => fn() } });
mock.module('../slow-save.js', { namedExports: { writesInFlight: () => inFlight } });
/** What the shared sign-in was last opened with — RECORDED, so a test can say what the card was told. @type {any} */
let lastLoginOpts = null;
mock.module('../login-overlay.js', { namedExports: { initLoginOverlay: (/** @type {any} */ o) => { lastLoginOpts = o; log.push(`login:${o.pageLabel}`); }, dismissLoginOverlay: () => log.push('dismissLogin') } });
/** Whether the card on screen has a sign-in in flight (its Back link marked busy): read by the no-memory branch. */
let signInInFlight = false;
/** Whether the card's button is held by the 30-second wrong-password lock — disabled, with nothing in flight. */
let lockedOut = false;

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
    querySelector: (/** @type {string} */ sel) => {
        // The card as login-overlay.js leaves it: the button is disabled in flight AND under the lock;
        // only the Back link's busy mark is the round trip alone.
        if (sel === '#loginSubmit') return { hasAttribute: (/** @type {string} */ a) => a === 'disabled' && (signInInFlight || lockedOut) };
        if (sel === '#loginOverlay .login-back--busy') return signInInFlight ? {} : null;
        return null;
    },
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

const ps = await import('../page-session.js');

/** Let the on-demand import of the sign-in land (a dynamic import takes more than one tick). POLLED, not
 *  a fixed 50ms: a full unit lane on a busy machine overran that once (48-hour review, Nov 2026). Every
 *  caller expects the sign-in to show, so a bounded wait for it adds nothing a test could pass on. */
const settle = async () => {
    for (let i = 0; i < 100 && !log.some(e => e.startsWith('login:')); i++) await new Promise(r => setTimeout(r, 20));
};

beforeEach(() => { lastLoginOpts = null; ss.clear(); ls.clear(); docListeners = {}; /** @type {any} */ (global.document).visibilityState = 'visible'; authCb = null; inFlight = 0; lastConfirm = ''; lastAsked = null; log = []; session = { name: 'A. Member' }; decision = 'allow'; currentUser = { uid: 'u1' }; confirmAnswer = true; watchArgs = null; });

describe('guardNamedSession', () => {
    test('an unconfirmed own session: clear, tear down the drawer, THEN the sign-in — and no watch', async () => {
        decision = 'login';
        await ps.guardNamedSession({ page: 'links', pageLabel: 'Links', member: 'A. Member', established: Promise.resolve() });
        await settle();   // the default sign-in is loaded on demand
        assert.deepEqual(log, ['requirePage:links', 'releasePush', 'clearSession', 'resetNavPanel', 'login:Links'],
            'this device\'s push record goes first, as at every other end of a hold (audit A1)');
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
        assert.deepEqual(log, ['releasePush', 'clearSession', 'resetNavPanel', 'login:Overtime'],
            'an identity lost mid-visit releases this device\'s push record too (audit A1)');
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
        const { nameToEmail } = await import('../auth-identity.js');
        authCb({ isAnonymous: false, email: nameToEmail('A. Member') });
        assert.deepEqual(log, ['authUnwatch', 'reload'], 'the identity the page belongs to: stop watching, reload into it');
    });

    test('…but only ONCE per two minutes: a second late landing leaves the sign-in up rather than looping (24-hour review)', async () => {
        decision = 'pending';
        const { nameToEmail } = await import('../auth-identity.js');
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
        assert.equal(ps.lateReloadAllowed(Date.now() + ps.LATE_RELOAD_GAP_MS + 1), 'reload', 'and the cap lifts after the gap');
    });

    // ── A TAB THAT CANNOT REMEMBER A RELOAD NEVER RELOADS BY ITSELF (external review, 23 Nov 2026) ──────
    // One reload per page load was allowed there, and a reload IS a new page load: three fresh loads a
    // second apart each allowed another, so a start-up that stalled every time flashed the card away in a
    // loop. Now no load reloads by itself; the card says the sign-in is back and offers Try again.
    test('with sessionStorage THROWING, no fresh page load reloads by itself — the reviewer\'s three loads a second apart', async () => {
        const real = global.sessionStorage;
        const refuse = () => { const e = new Error('The operation is insecure.'); e.name = 'SecurityError'; throw e; };
        global.sessionStorage = /** @type {any} */ ({ getItem: refuse, setItem: refuse });
        try {
            const now = Date.now();
            for (let load = 0; load < 3; load++) {
                const fresh = await import(`../page-session.js?load-${load}`);   // each a fresh page load
                assert.equal(fresh.lateReloadAllowed(now + load * 1000), 'no-memory', `load ${load + 1}: no reload it could not count`);
            }
        } finally { global.sessionStorage = real; }
    });

    test('…and when the identity lands there, the card says so and offers Try again, rather than reloading', async () => {
        const real = global.sessionStorage;
        const refuse = () => { throw new Error('SecurityError'); };
        global.sessionStorage = /** @type {any} */ ({ getItem: refuse, setItem: refuse });
        try {
            decision = 'pending';
            const { nameToEmail } = await import('../auth-identity.js');
            await ps.guardNamedSession({ page: 'links', pageLabel: 'Links', member: 'A. Member', established: false });
            await settle();
            log = [];
            authCb({ isAnonymous: false, email: nameToEmail('A. Member') });
            await settle();
            assert.deepEqual(log, ['authUnwatch', 'dismissLogin', 'login:Links'], 'no reload: the card is drawn again');
            assert.equal(lastLoginOpts.notice, ps.LATE_IDENTITY_NOTICE);
            assert.equal(lastLoginOpts.alternative?.label, 'Try again');
            log = [];
            lastLoginOpts.alternative.onSelect();
            assert.deepEqual(log, ['reload'], 'Try again is the colleague\'s own reload');
        } finally { global.sessionStorage = real; }
    });

    test('…but a sign-in already in flight on the card is left to finish: nothing is redrawn under it', async () => {
        const real = global.sessionStorage;
        const refuse = () => { throw new Error('SecurityError'); };
        global.sessionStorage = /** @type {any} */ ({ getItem: refuse, setItem: refuse });
        signInInFlight = true;
        try {
            decision = 'pending';
            const { nameToEmail } = await import('../auth-identity.js');
            await ps.guardNamedSession({ page: 'links', pageLabel: 'Links', member: 'A. Member', established: false });
            await settle();
            log = [];
            authCb({ isAnonymous: false, email: nameToEmail('A. Member') });
            await settle();
            assert.deepEqual(log, ['authUnwatch']);
        } finally { global.sessionStorage = real; signInInFlight = false; }
    });

    // THE 30-SECOND LOCK IS NOT A SIGN-IN IN FLIGHT (review, 24 Nov 2026): it disables the button too, and the
    // check read the button — so a member who had mistyped three times was never told the sign-in was back.
    test('…and a card merely locked after three wrong passwords is still drawn again with the notice', async () => {
        const real = global.sessionStorage;
        const refuse = () => { throw new Error('SecurityError'); };
        global.sessionStorage = /** @type {any} */ ({ getItem: refuse, setItem: refuse });
        lockedOut = true;
        try {
            decision = 'pending';
            const { nameToEmail } = await import('../auth-identity.js');
            await ps.guardNamedSession({ page: 'links', pageLabel: 'Links', member: 'A. Member', established: false });
            await settle();
            log = [];
            lastLoginOpts = null;
            authCb({ isAnonymous: false, email: nameToEmail('A. Member') });
            await settle();
            assert.deepEqual(log, ['authUnwatch', 'dismissLogin', 'login:Links'], 'the lock was taken for a sign-in in flight');
            assert.equal(lastLoginOpts?.notice, ps.LATE_IDENTITY_NOTICE);
        } finally { global.sessionStorage = real; lockedOut = false; }
    });

    test('the shared sign-in after a LOST session names the member and says they were signed out (review, Nov 2026)', async () => {
        // It said nothing and asked for grade and name again, which read like a fault rather than a sign-out.
        await ps.guardNamedSession({ page: 'links', pageLabel: 'Links', member: 'A. Member', established: true });
        currentUser = null;
        watchArgs.onLost();
        await settle();
        assert.equal(lastLoginOpts?.presetName, 'A. Member', 'the card was not for the member it lost');
        assert.equal(lastLoginOpts?.notice, ps.SIGNED_OUT_NOTICE, 'the card did not say why it was up');
        assert.equal(ps.SIGNED_OUT_NOTICE, 'You’ve been signed out on this device. Sign in again to carry on.');
        assert.equal(lastLoginOpts?.about, null, 'a page that passes no `about` gets none');
    });

    test('…and so does one that could not be confirmed at load, which is cleared too', async () => {
        decision = 'login';
        await ps.guardNamedSession({ page: 'settings', pageLabel: 'Settings', member: 'A. Member', established: Promise.resolve() });
        await settle();
        assert.equal(lastLoginOpts?.presetName, 'A. Member');
        assert.equal(lastLoginOpts?.notice, ps.SIGNED_OUT_NOTICE);
    });

    test('…but an UNDECIDED session, which is kept, is not told it was signed out — only who the card is for', async () => {
        decision = 'pending';
        await ps.guardNamedSession({ page: 'settings', pageLabel: 'Settings', member: 'A. Member', established: false });
        await settle();
        assert.equal(lastLoginOpts?.presetName, 'A. Member');
        assert.equal(lastLoginOpts?.notice, '', 'a slow network was described as a sign-out');
    });

    test('a page whose own card explains it (Trains) has the same explanation on the card a lost session gets', async () => {
        const about = { lines: ['What this page is.'] };
        decision = 'login';
        await ps.guardNamedSession({ page: 'trains', pageLabel: 'Trains', member: 'A. Member', established: null, about });
        await settle();
        assert.equal(lastLoginOpts?.about, about);
    });

    test('…and Trains is WIRED to pass it: the explanation its card at load carries (the wiring, read from source)', async () => {
        // The rule above is the helper's; this is the call site. Without `about` a member who lost their
        // session mid-visit met a card that did not say what the page is, where the page's own card did. ONE
        // `about` now feeds both, through the start-up (page-start.test.mjs: the card and the guard are each
        // handed it), so the call site has one thing to pass.
        const { readFileSync } = await import('node:fs');
        const src = readFileSync(new URL('./trains-app.js', REPO_ROOT_URL), 'utf8');
        assert.match(src, /startPage\(\{[^}]*about: \{ \.\.\.SIGN_IN_ABOUT, footnote: SHARED_SCREEN \}/, 'the cards Trains opens do not say what the page is, or end on the shared-screen line');
        const start = readFileSync(new URL('./page-start.js', REPO_ROOT_URL), 'utf8');
        assert.match(start, /initLoginOverlay\(\{[^}]*about: spec\.about/, 'premise: the start-up\'s card at load carries the page\'s explanation');
        assert.match(start, /guardNamedSession\(\{[^}]*about: spec\.about/, 'the card a lost session gets does not say what the page is');
    });

    // EVERY PAGE GETS THE SHARED CARD (external review of v26.67). Admin and Overtime passed a card of their own,
    // which never heard `back`: on a tab that could not reload by itself, the sign-in came back and they showed no
    // "signed in again" and no Try again. Now they pass what differs — Admin its explanation, Overtime what it
    // clears first — and the card is the shared one, notice and Try again included.
    test('a page that clears something first (Overtime) has it cleared before EACH card, the "signed in again" one too', async () => {
        const real = global.sessionStorage;
        const refuse = () => { throw new Error('SecurityError'); };
        global.sessionStorage = /** @type {any} */ ({ getItem: refuse, setItem: refuse });
        try {
            decision = 'pending';
            const { nameToEmail } = await import('../auth-identity.js');
            await ps.guardNamedSession({ page: 'overtime', pageLabel: 'Overtime', member: 'A. Member', established: false,
                beforeSignIn: () => log.push('standDown') });
            await settle();
            assert.deepEqual(log.slice(-2), ['standDown', 'login:Overtime'], 'cleared, then the card');
            assert.equal(lastLoginOpts?.presetName, 'A. Member', 'the card is for the member');
            log = [];
            authCb({ isAnonymous: false, email: nameToEmail('A. Member') });
            await settle();
            assert.deepEqual(log, ['authUnwatch', 'dismissLogin', 'standDown', 'login:Overtime']);
            assert.equal(lastLoginOpts?.notice, ps.LATE_IDENTITY_NOTICE, 'Overtime did not say the sign-in was back');
            assert.equal(lastLoginOpts?.alternative?.label, 'Try again');
        } finally { global.sessionStorage = real; }
    });

    test('…and Admin and Overtime are WIRED to the shared card: no card of their own (the wiring, read from source)', async () => {
        // Through the start-up now (page-start.js), which hands `about` and `beforeSignInAgain` to guardNamedSession
        // as `about` and `beforeSignIn` — and nothing else, so no page can pass a card of its own.
        const { readFileSync } = await import('node:fs');
        for (const [file, wants] of /** @type {Array<[string, RegExp]>} */ ([
            ['admin-app.js', /startPage\(\{[^}]*about: ADMIN_SIGN_IN_ABOUT/],
            ['overtime-app.js', /beforeSignInAgain: \(\) => review\.standDown\(\{ clear: true \}\)/],
        ])) {
            const src = readFileSync(new URL(`./${file}`, REPO_ROOT_URL), 'utf8');
            assert.match(src, wants, `${file} no longer passes what its card needs to the start-up`);
            assert.doesNotMatch(src, /guardNamedSession\(/, `${file} guards its session by hand again`);
        }
        const start = readFileSync(new URL('./page-start.js', REPO_ROOT_URL), 'utf8');
        const call = start.slice(start.indexOf('guardNamedSession({'), start.indexOf('});', start.indexOf('guardNamedSession({')));
        assert.match(call, /beforeSignIn: spec\.beforeSignInAgain/, 'the start-up no longer hands the page\'s put-away step to the lost-session card');
        assert.doesNotMatch(call, /signIn:/, 'the start-up passes a card of its own, which never says "signed in again"');
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
        // It says the work is lost, under a title of its own (confirm review, Nov 2026).
        assert.deepEqual({ ...lastAsked }, { title: 'Sign out without saving?', message: 'You have unsaved changes. If you sign out now they will be lost.',
            confirmLabel: 'Sign out', cancelLabel: 'Keep editing', danger: true });
    });

    test('a save still on its way is asked about, even with nothing unsaved on screen (v24.56)', async () => {
        inFlight = 1;
        confirmAnswer = false;
        assert.equal(await ps.askBeforeSignOut(() => false)(), false, 'a Cancel keeps the session so the save can land');
        assert.match(lastConfirm, /A change is still saving — if you sign out now it may be lost/);
        assert.doesNotMatch(lastConfirm, /unsaved/);
        assert.equal(lastAsked.title, 'Sign out now?');
        assert.equal(lastAsked.cancelLabel, 'Stay signed in', 'nothing is being edited, so nothing to keep editing');
        await ps.askBeforeSignOut(() => true)();
        assert.match(lastConfirm, /unsaved changes on this page will be lost too/, 'with both, the one question names both');
        assert.equal(lastAsked.cancelLabel, 'Keep editing');
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
        const fresh = await import('../page-session.js?leave-answered');
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
        const fresh = await import('../page-session.js?other-tab');
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
        const fresh = await import('../page-session.js?in-place');
        listeners = {}; log = [];
        session = null;
        fresh.reloadIfRestoredForSomeoneElse();
        session = { name: 'A. Member' };     // the in-place sign-in
        fire('pagehide');
        session = null;                      // signed out on another page or tab
        fire('pageshow', { persisted: true });
        assert.deepEqual(log, ['reload']);
    });

    test('a page signed into IN PLACE and told so (rebaseRestoreGuard) is not reloaded on Back for the same member', async () => {
        // The harmless case the guard used to pay for: built for nobody, signed in without a reload,
        // left, and come back to with the same member still signed in. Unrebased it reloads (the
        // first half proves the premise); rebased it is that member's page and comes straight back.
        const unrebased = await import('../page-session.js?not-rebased');
        listeners = {}; log = [];
        session = null;
        unrebased.reloadIfRestoredForSomeoneElse();
        session = { name: 'A. Member' };
        fire('pagehide');
        fire('pageshow', { persisted: true });
        assert.deepEqual(log, ['reload'], 'the premise: without it, the page loaded for nobody is reloaded');

        const rebased = await import('../page-session.js?rebased');
        listeners = {}; log = [];
        session = null;
        rebased.reloadIfRestoredForSomeoneElse();
        session = { name: 'A. Member' };     // the in-place sign-in…
        rebased.rebaseRestoreGuard();        // …and the page rebuilt for them
        fire('pagehide');
        fire('pageshow', { persisted: true });
        assert.deepEqual(log, [], 'their own page comes back without a reload');
    });

    test('a rebased page still reloads for anybody else, or for nobody', async () => {
        // Rebasing must only ever narrow the reloads to the member the page was rebuilt for.
        for (const [later, why] of /** @type {const} */ ([[null, 'signed out since'], ['B. Member', 'a colleague signed in since']])) {
            const fresh = await import(`../page-session.js?rebased-${later ?? 'nobody'}`);
            listeners = {}; log = [];
            session = null;
            fresh.reloadIfRestoredForSomeoneElse();
            session = { name: 'A. Member' };
            fresh.rebaseRestoreGuard();
            fire('pagehide');
            session = later === null ? null : { name: later };
            fire('pageshow', { persisted: true });
            assert.deepEqual(log, ['reload'], why);
        }
    });

    test('rebasing before the guard is installed does nothing', async () => {
        const fresh = await import('../page-session.js?rebase-first');
        listeners = {}; log = [];
        session = { name: 'A. Member' };
        fresh.rebaseRestoreGuard();
        assert.deepEqual(listeners, {}, 'installs nothing of its own');
        session = null;
        fresh.reloadIfRestoredForSomeoneElse();   // the guard, installed for nobody, ignores the earlier call
        session = { name: 'A. Member' };
        fire('pagehide');
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
        return import('../page-session.js?storage').then((fresh) => {
            fresh.reloadIfRestoredForSomeoneElse();
            change('A. Member', 'A. Member');
            assert.deepEqual(log, [], 'the same member re-saving the session is not a change');
            // Another key's OWN values, as any write in another tab carries them — a notice flag set for
            // the first time, a draft autosaved. Read as a session they name nobody, which is not this
            // tab's member, so without the key filter every such write would reload this page. (This
            // used to send the member's own session JSON under the other key: the names matched with or
            // without the filter, and deleting it stayed green.)
            fire('storage', { key: 'myb_notice_seen', oldValue: null, newValue: '1' });
            fire('storage', { key: 'myb_some_draft', oldValue: JSON.stringify({ rows: 2 }), newValue: JSON.stringify({ rows: 3 }) });
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

    test('a reload because the identity changed is never stopped by "Leave site?" — and still keeps the draft (review, 15 Nov 2026)', async () => {
        // "Stay" on that question kept the page up, still drawn for a member who had signed out in
        // another tab. Nobody answered a leave, so the work is still kept as a draft for them.
        const fresh = await import('../page-session.js?identity-reload');
        listeners = {}; docListeners = {};
        const slot = { keep: () => log.push('keep'), forget: () => log.push('forget') };
        fresh.warnOnUnload(() => true);
        fresh.keepDraftWhenHidden(() => true, slot);
        fresh.reloadIfRestoredForSomeoneElse();
        const ask = () => { const e = { prevented: false, returnValue: undefined, preventDefault() { this.prevented = true; } }; fire('beforeunload', e); return e.prevented; };
        assert.equal(ask(), true, 'the premise: unsaved work is asked about');
        session = null;
        fire('storage', { key: 'myb_admin_session', oldValue: JSON.stringify({ name: 'A. Member', ver: 3, expiry: 1 }), newValue: null });
        assert.deepEqual(log, ['reload']);
        assert.equal(ask(), false, 'the reload goes through');
        log = [];
        fire('pagehide');
        assert.deepEqual(log, ['keep'], 'not a discard: the member gets their work back when they sign in again');

        const restored = await import('../page-session.js?identity-restore');
        listeners = {}; log = []; session = { name: 'A. Member' };
        restored.warnOnUnload(() => true);
        restored.reloadIfRestoredForSomeoneElse();
        session = { name: 'B. Member' };
        fire('pageshow', { persisted: true });
        assert.deepEqual(log, ['reload']);
        assert.equal(ask(), false, 'a page restored for somebody else reloads unasked too');
    });
});

// ── LEAVING BY A LINK THE APP DRAWS (iPhone audit, Nov 2026) ─────────────────────────────────────
// A phone never shows the browser's "Leave site?", so these are the only question an iPhone gets.
// The About panel's links joined the drawer's: Admin's "Calendar" link (once "View staff roster") left staged edits behind
// without one, because the guard looked for `.nav-panel` alone.
describe('leaving by a drawer or About-panel link (askBeforeLeavingByDrawer)', () => {
    /** A tap on a link at `href`, inside `zone` ('.nav-panel', '#iconLightbox', or neither). `click`
     *  holds what a real click carries — `button` and the modifier keys — when a test needs them.
     *  @param {{ href: string, zone?: string, target?: string, click?: Record<string, any> }} o */
    function tapOn({ href, zone = '#iconLightbox', target = '', click = {} }) {
        /** @type {any} */ const link = {
            target,
            getAttribute: (/** @type {string} */ n) => (n === 'href' ? href : null),
            closest: (/** @type {string} */ sel) => (sel === 'a[href]' ? link : sel === zone ? {} : null),
            click: () => log.push(`follow:${href}`),
        };
        const e = { ...click, target: { closest: (/** @type {string} */ sel) => link.closest(sel) }, prevented: false,
            preventDefault() { this.prevented = true; }, stopPropagation() {} };
        fireDoc('click', e);
        return e;
    }
    const answered = () => new Promise(r => setTimeout(r, 0));

    test('an About-panel link asks first — Cancel stays, Leave follows the link', async () => {
        const fresh = await import('../page-session.js?about-link');
        fresh.askBeforeLeavingByDrawer(() => true);
        confirmAnswer = false;
        assert.equal(tapOn({ href: './' }).prevented, true, 'held while the question is open');
        await answered();
        assert.deepEqual(log, ['confirm'], 'Cancel: the page and its work stay');
        assert.deepEqual({ ...lastAsked }, { ...fresh.LEAVE_QUESTION }, 'the one leave question');
        log = []; confirmAnswer = true;
        tapOn({ href: './staff-guide.html?from=admin.html' });
        await answered();
        assert.deepEqual(log, ['confirm', 'follow:./staff-guide.html?from=admin.html'], 'Leave: the link itself is followed');
    });

    test('the drawer\'s links still ask', async () => {
        const fresh = await import('../page-session.js?drawer-link');
        fresh.askBeforeLeavingByDrawer(() => true);
        assert.equal(tapOn({ href: './', zone: '.nav-panel' }).prevented, true);
        await answered();
        assert.deepEqual(log, ['confirm', 'follow:./']);
    });

    test('Report a bug never asks: "#" until About opens it, mail after — nor does a new tab', async () => {
        const fresh = await import('../page-session.js?not-leaving');
        fresh.askBeforeLeavingByDrawer(() => true);
        for (const t of [{ href: '#' }, { href: 'mailto:help@example.test?subject=Bug' }, { href: 'MAILTO:x@example.test' },
            { href: 'https://www.nationalrail.co.uk/', target: '_blank' }]) {
            assert.equal(tapOn(t).prevented, false, `${t.href} leaves the page where it is`);
        }
        await answered();
        assert.deepEqual(log, [], 'nothing asked, nothing followed by the guard');
    });

    test('a click that opens the link in a new tab or window is not asked about — "Leave" could not honour it (routed from shared-ui)', async () => {
        // Ctrl/Cmd-click on a drawer pill with staged edits asked "Leave this page anyway?", and Leave
        // then re-clicked the link with no modifier — so THIS tab went, and the work with it (seen in
        // Chromium, Nov 2026). A new tab, a new window or a download leaves the page where it is.
        const fresh = await import('../page-session.js?new-tab');
        fresh.askBeforeLeavingByDrawer(() => true);
        for (const click of [{ button: 0, ctrlKey: true }, { button: 0, metaKey: true }, { button: 0, shiftKey: true },
            { button: 0, altKey: true }, { button: 1 }]) {
            assert.equal(tapOn({ href: './', zone: '.nav-panel', click }).prevented, false, JSON.stringify(click));
        }
        await answered();
        assert.deepEqual(log, [], 'nothing asked, nothing followed by the guard');
        // CONTROL: the plain click a tap, Enter or the guard's own re-click makes is still asked about,
        // and so is a click built in code with no `button` at all.
        assert.equal(tapOn({ href: './', zone: '.nav-panel', click: { button: 0 } }).prevented, true);
        assert.equal(tapOn({ href: './', zone: '.nav-panel' }).prevented, true);
        await answered();
        assert.deepEqual(log, ['confirm', 'confirm', 'follow:./', 'follow:./']);
    });

    test('a link anywhere else on the page, or a page with nothing unsaved, is not asked about', async () => {
        const fresh = await import('../page-session.js?elsewhere');
        let dirty = true;
        fresh.askBeforeLeavingByDrawer(() => dirty);
        assert.equal(tapOn({ href: './', zone: '#somewhereElse' }).prevented, false, 'the page\'s own links have their own questions');
        dirty = false;
        assert.equal(tapOn({ href: './' }).prevented, false, 'clean: nothing to ask about');
        await answered();
        assert.deepEqual(log, []);
    });
});

// ── KEEPING UNSAVED WORK WHEN THE PAGE IS HIDDEN (iPhone audit, Nov 2026) ───────────────────────
// ── LEAVING BY ONE CONTROL (review, 15 Nov 2026) ─────────────────────────────────────────────────
// The Operations header logo was the one way off that page that did not ask: a phone never shows
// the browser's own question, so a tap discarded a leave sheet's answers without a word.
describe('leaving by one control (leaveAfterAsking) — the Operations header logo', () => {
    const ask = () => { const e = { prevented: false, returnValue: undefined, preventDefault() { this.prevented = true; } }; fire('beforeunload', e); return e.prevented; };

    test('with unsaved work it asks first: Cancel stays, Leave goes — and the browser does not ask again', async () => {
        const fresh = await import('../page-session.js?logo');
        listeners = {};
        fresh.warnOnUnload(() => true);
        confirmAnswer = false;
        await fresh.leaveAfterAsking(() => true, () => log.push('go'));
        assert.deepEqual(log, ['confirm'], 'Cancel: the page and its work stay');
        assert.deepEqual({ ...lastAsked }, { ...fresh.LEAVE_QUESTION }, 'the drawer\'s own question');
        assert.equal(ask(), true, 'still unsaved, still asked about');
        log = []; confirmAnswer = true;
        await fresh.leaveAfterAsking(() => true, () => log.push('go'));
        assert.deepEqual(log, ['confirm', 'go']);
        assert.equal(ask(), false, 'answered: the unload warning stands aside, as it does for the drawer');
    });

    test('the leave question says the work is lost, and is asked as a destructive one (confirm review, Nov 2026)', () => {
        // "Leave" deletes the draft (`keepDraftWhenHidden`), so the question may not read as if the work comes back.
        assert.deepEqual({ ...ps.LEAVE_QUESTION }, { title: 'Leave without saving?', message: 'Your unsaved changes on this page will be lost.',
            confirmLabel: 'Leave without saving', cancelLabel: 'Keep editing', danger: true });
    });

    test('a move WITHIN a page asks its own question — nothing is left, only the changes go (review, 22 Nov 2026)', () => {
        assert.deepEqual({ ...ps.DISCARD_QUESTION }, { title: 'Discard your unsaved changes?', message: 'They will be lost if you move on now.',
            confirmLabel: 'Discard changes', cancelLabel: 'Keep editing', danger: true });
        assert.equal(ps.DISCARD_QUESTION.cancelLabel, ps.LEAVE_QUESTION.cancelLabel, 'one safe word on every question');
        assert.doesNotMatch(Object.values(ps.DISCARD_QUESTION).join(' '), /\bleave\b/i, 'the member leaves nothing');
    });

    test('a leave answered ELSEWHERE (a notification\'s Open it) stands the browser\'s question and the draft aside', async () => {
        const fresh = await import('../page-session.js?answered-elsewhere');
        listeners = {}; docListeners = {};
        fresh.warnOnUnload(() => true);
        fresh.keepDraftWhenHidden(() => true, { keep: () => log.push('keep'), forget: () => log.push('forget') });
        assert.equal(ask(), true, 'premise: unsaved work is asked about');
        assert.equal((listeners[fresh.LEAVE_ANSWERED] ?? []).length, 1, 'listened for once, however many routines need it');
        fire(fresh.LEAVE_ANSWERED);
        assert.equal(ask(), false, 'the browser does not ask a second time');
        fire('pagehide');
        assert.deepEqual(log, ['forget'], 'and no draft is kept of the work left behind');
        // sw-register.js sends it by name (it may not import this module), so the two spellings are one.
        const sw = readFileSync(new URL('./sw-register.js', REPO_ROOT_URL), 'utf8');
        assert.ok(sw.includes(`window.dispatchEvent(new Event('${fresh.LEAVE_ANSWERED}'))`),
            'sw-register.js no longer announces an answered notification question by the name this module listens for');
    });

    test('with nothing unsaved it simply goes, asking nothing', async () => {
        const fresh = await import('../page-session.js?logo-clean');
        await fresh.leaveAfterAsking(() => false, () => log.push('go'));
        assert.deepEqual(log, ['go']);
    });
});

describe('keepDraftWhenHidden — the trigger for unsaved-draft.js', () => {
    const slot = { keep: () => log.push('keep'), forget: () => log.push('forget') };

    test('hidden while dirty keeps the work; hidden while clean forgets it; coming back does neither', async () => {
        const fresh = await import('../page-session.js?draft-hide');
        let dirty = true;
        fresh.keepDraftWhenHidden(() => dirty, slot);
        setVisibility('hidden');
        assert.deepEqual(log, ['keep'], 'iOS sends this before it may discard the page');
        setVisibility('visible');
        assert.deepEqual(log, ['keep'], 'showing the page again keeps and forgets nothing');
        dirty = false;
        setVisibility('hidden');
        assert.deepEqual(log, ['keep', 'forget'], 'saved or discarded since: the copy is not work any more');
    });

    test('a navigation away keeps it too — a swipe back on a phone asks nothing', async () => {
        const fresh = await import('../page-session.js?draft-pagehide');
        listeners = {};
        fresh.keepDraftWhenHidden(() => true, slot);
        fire('pagehide');
        assert.deepEqual(log, ['keep']);
    });

    test('an ANSWERED sign-out or Leave keeps nothing, however much is still unsaved — both were a discard', async () => {
        const signedOut = await import('../page-session.js?draft-signed-out');
        listeners = {};
        signedOut.keepDraftWhenHidden(() => true, slot);
        signedOut.signOutAndLeave({ to: './' });
        log = [];
        fire('pagehide');
        assert.deepEqual(log, ['forget']);

        const left = await import('../page-session.js?draft-left');
        listeners = {}; docListeners = {};
        left.askBeforeLeavingByDrawer(() => true);
        left.keepDraftWhenHidden(() => true, slot);
        /** @type {any} */ const link = { target: '', getAttribute: () => './', closest: (/** @type {string} */ s) => (s === 'a[href]' ? link : s === '.nav-panel' ? {} : null), click() {} };
        fireDoc('click', { target: { closest: (/** @type {string} */ s) => link.closest(s) }, preventDefault() {}, stopPropagation() {} });
        await new Promise(r => setTimeout(r, 0));
        log = [];
        fire('pagehide');
        assert.deepEqual(log, ['forget'], '"Leave" answered: the draft must not offer the work back');
    });

    test('a draft that cannot be written does not stop the page going away', async () => {
        const fresh = await import('../page-session.js?draft-throws');
        const realError = console.error;
        /** @type {any[]} */ const said = [];
        console.error = (...a) => { said.push(a[0]); };
        try {
            fresh.keepDraftWhenHidden(() => true, { keep: () => { throw new Error('quota'); }, forget: () => {} });
            assert.doesNotThrow(() => setVisibility('hidden'));
            assert.equal(said.length, 1, 'said once, to the console');
        } finally { console.error = realError; }
    });
});

// ── COMING BACK TO A PAGE LEFT OPEN (iPhone audit, Nov 2026) ─────────────────────────────────────
describe('onReturnToPage — an installed app is not reloaded when it is reopened', () => {
    const realNow = Date.now;
    const at = (/** @type {number} */ t) => { Date.now = () => t; };
    const T0 = 1_800_000_000_000, MIN = 60_000;

    test('it runs only after `afterMs` away, measured from the hide', async () => {
        const fresh = await import('../page-session.js?return-after');
        /** @type {number[]} */ const ran = [];
        try {
            at(T0);
            fresh.onReturnToPage(5 * MIN, (away) => ran.push(away));
            setVisibility('hidden');
            at(T0 + 4 * MIN); setVisibility('visible');
            assert.deepEqual(ran, [], 'four minutes is a glance at another app');
            setVisibility('hidden');
            at(T0 + 10 * MIN); setVisibility('visible');
            assert.deepEqual(ran, [6 * MIN], 'six minutes since THAT hide: it runs, told how long');
        } finally { Date.now = realNow; }
    });

    test('a second hide does not restart the clock, and a page shown without being hidden runs nothing', async () => {
        const fresh = await import('../page-session.js?return-clock');
        /** @type {number[]} */ const ran = [];
        try {
            at(T0);
            fresh.onReturnToPage(5 * MIN, (away) => ran.push(away));
            setVisibility('visible');
            assert.deepEqual(ran, [], 'never hidden: nothing to come back from');
            setVisibility('hidden');
            at(T0 + 3 * MIN); setVisibility('hidden');
            at(T0 + 5 * MIN); setVisibility('visible');
            assert.deepEqual(ran, [5 * MIN], 'measured from the FIRST hide');
        } finally { Date.now = realNow; }
    });

    test('a return through the back/forward cache counts — once', async () => {
        const fresh = await import('../page-session.js?return-bfcache');
        listeners = {};
        /** @type {number[]} */ const ran = [];
        try {
            at(T0);
            fresh.onReturnToPage(0, (away) => ran.push(away));
            fire('pagehide');
            at(T0 + 2 * MIN);
            fire('pageshow', { persisted: false });
            assert.deepEqual(ran, [], 'an ordinary load is not a return');
            fire('pageshow', { persisted: true });
            setVisibility('visible');
            assert.deepEqual(ran, [2 * MIN], 'the restore, and not again for the visibility event after it');
        } finally { Date.now = realNow; }
    });
});

// ── unsaved-draft.js — THE KEPT COPY ITSELF ──────────────────────────────────────────────────────
// The module's own suite lives here, beside the trigger that writes it: its rules are the five in
// its header, and each test below names the one it holds. The browser half — a real hide, a reload
// and the question on screen — is e2e/admin-unsaved-work.spec.js and e2e/links.spec.js.
const ud = await import('../unsaved-draft.js');

describe('unsaved-draft.js', () => {
    const NOW = new Date(2026, 10, 7, 14, 20).getTime();
    const HOUR = 60 * 60 * 1000;
    const stored = (/** @type {any} */ over = {}) => ud.encodeDraft({ page: 'admin', by: 'A. Member', scope: { member: 'A. Member', date: '2026-12-07' },
        data: { rows: [{ date: '2026-12-08', type: 'sick' }] }, savedAt: NOW - HOUR, ...over });
    const reader = { page: 'admin', by: 'A. Member', now: NOW };

    test('one key per page per member, and no two names can share one (rule 2)', () => {
        assert.equal(ud.draftKey('admin', 'G. Miller'), 'myb_draft_admin_G.%20Miller');
        assert.notEqual(ud.draftKey('admin', 'G. Miller'), ud.draftKey('links', 'G. Miller'));
        assert.notEqual(ud.draftKey('admin', 'G. Miller'), ud.draftKey('admin', 'G Miller'));
        assert.ok(ud.draftKey('admin', 'G. Miller').startsWith(ud.DRAFT_PREFIX));
        assert.ok(!ud.DRAFT_PREFIX.startsWith('myb_pc_'), 'not the Pay Calculator\'s member data, which has its own ownership prompt');
    });

    test('a stored draft reads back for its own page and member only (rule 2)', () => {
        const d = ud.decodeDraft(stored(), reader);
        assert.equal(d?.by, 'A. Member');
        assert.deepEqual(d?.data, { rows: [{ date: '2026-12-08', type: 'sick' }] });
        assert.equal(ud.decodeDraft(stored(), { ...reader, by: 'B. Member' }), null, 'a colleague on the same phone is offered nothing');
        assert.equal(ud.decodeDraft(stored(), { ...reader, page: 'links' }), null);
        assert.equal(ud.decodeDraft(stored({ by: 'B. Member' }), reader), null, 'the name inside is checked, not only the key');
        assert.equal(ud.decodeDraft(stored(), { ...reader, by: '' }), null, 'nobody signed in: nothing');
    });

    test('a day, then gone — and a draft whose age cannot be judged is not offered either (rule 4)', () => {
        assert.ok(ud.decodeDraft(stored({ savedAt: NOW - ud.DRAFT_MAX_AGE_MS + 1 }), reader), 'just inside a day');
        assert.equal(ud.decodeDraft(stored({ savedAt: NOW - ud.DRAFT_MAX_AGE_MS - 1 }), reader), null, 'just over a day');
        assert.ok(ud.decodeDraft(stored({ savedAt: NOW + 60_000 }), reader), 'a clock nudged back a minute is not a draft from another day');
        assert.equal(ud.decodeDraft(stored({ savedAt: NOW + 2 * HOUR }), reader), null, 'dated hours ahead: its age is unknowable');
        const base = JSON.parse(stored());
        for (const raw of [null, '', '{', '"x"', JSON.stringify({ ...base, v: 2 }), JSON.stringify({ ...base, savedAt: 'today' }),
            JSON.stringify({ ...base, data: null }), JSON.stringify({ ...base, scope: 'x' })]) {
            assert.equal(ud.decodeDraft(raw, reader), null, `not a draft: ${raw}`);
        }
    });

    test('the question is a 24-hour time, and says yesterday when it is', () => {
        assert.equal(ud.restoreQuestion(NOW, NOW + HOUR), 'Restore your unsaved changes from 14:20?');
        const lateLastNight = new Date(2026, 10, 6, 23, 50).getTime();
        assert.equal(ud.restoreQuestion(lateLastNight, new Date(2026, 10, 7, 7, 0).getTime()), 'Restore your unsaved changes from 23:50 yesterday?');
        assert.equal(ud.restoreQuestion(new Date(2026, 10, 7, 9, 5).getTime(), NOW), 'Restore your unsaved changes from 09:05?');
    });

    test('a Links baseline read back is exact only when it says so — anything else is UNKNOWN, never "no baseline" (rule 5)', () => {
        assert.deepEqual(ud.draftBaseline({ loadedRevision: 4, loadedUpdatedAt: 1_750_000_000_000, baselineUnknown: false }),
            { loadedRevision: 4, loadedUpdatedAt: 1_750_000_000_000, baselineUnknown: false });
        assert.deepEqual(ud.draftBaseline({ loadedRevision: null, loadedUpdatedAt: 1_750_000_000_000, baselineUnknown: false }),
            { loadedRevision: null, loadedUpdatedAt: 1_750_000_000_000, baselineUnknown: false }, 'a design saved before revisions: its timestamp is the baseline');
        for (const raw of [undefined, null, {}, { loadedRevision: 4, baselineUnknown: true }, { loadedRevision: '4', loadedUpdatedAt: 'x', baselineUnknown: false },
            { loadedRevision: null, loadedUpdatedAt: null, baselineUnknown: false }, { loadedRevision: NaN, baselineUnknown: false }]) {
            assert.equal(ud.draftBaseline(raw).baselineUnknown, true, `${JSON.stringify(raw)} must read as unknown`);
        }
    });

    // An Admin row's kept record, and how a restore compares it, are override-compare.js's
    // (`keptRecord` / `sameKeptRecord`, tested in override-utils.test.mjs beside `sameOverrideRecord`).

    test('what Admin says after a restore names the days it left as saved', () => {
        assert.equal(ud.weekRestoredLine(2, []), 'Your unsaved changes are back — check them, then select Save changes.');
        assert.equal(ud.weekRestoredLine(1, ['8 Dec 2026']),
            'Your unsaved changes are back — check them, then select Save changes. 8 Dec 2026 was left as saved, because it has changed since.');
        assert.equal(ud.weekRestoredLine(1, ['8 Dec 2026', '9 Dec 2026']),
            'Your unsaved changes are back — check them, then select Save changes. 8 Dec 2026, 9 Dec 2026 were left as saved, because they have changed since.');
        assert.equal(ud.weekRestoredLine(0, ['8 Dec 2026']), 'Your unsaved changes were not put back: 8 Dec 2026 has changed since.');
        assert.equal(ud.weekRestoredLine(0, []), 'There were no unsaved changes to put back.');
    });

    describe('the slot', () => {
        const KEY = 'myb_draft_admin_A.%20Member';
        /** @param {string} by @param {number} [t] */
        const slotFor = (by, t = NOW) => ud.createDraftSlot({ page: 'admin', by, now: () => t });
        /** @type {any[]} */ let asked = [];
        /** What the page's confirmDialog answers: true Restore, false Discard, null a dismissal. */
        const ask = (/** @type {boolean|null} */ answer) => async (/** @type {any} */ o) => { asked.push(o); return answer; };
        beforeEach(() => { asked = []; });

        test('keep, then peek; a colleague\'s slot on the same phone sees none of it; forget deletes it', () => {
            const mine = slotFor('A. Member');
            mine.keep({ member: 'A. Member', date: '2026-12-07' }, { rows: [{ date: '2026-12-08', type: 'sick' }] });
            assert.ok(ls.has(KEY));
            assert.deepEqual(mine.peek()?.scope, { member: 'A. Member', date: '2026-12-07' });
            assert.equal(slotFor('B. Member').peek(), null, 'never across members');
            assert.ok(ls.has(KEY), 'and a colleague\'s load leaves it alone');
            mine.forget();
            assert.equal(ls.has(KEY), false);
        });

        test('a clean hide cannot delete an EARLIER page life\'s draft before it has been answered (rule 3)', async () => {
            ls.set(KEY, stored());
            const next = slotFor('A. Member');   // the next load, still reading what the offer waits for
            next.forget();
            assert.ok(ls.has(KEY), 'hidden while it loaded: the draft must still be offered');
            assert.equal(await next.offer({ ask: ask(false), apply: () => {} }), 'discarded');
            next.keep({ member: 'A. Member', date: '2026-12-07' }, { rows: [] });
            next.forget();
            assert.equal(ls.has(KEY), false, 'once answered, the slot holds this page\'s own work and may forget it');
        });

        test('a clean hide in one tab cannot delete the copy ANOTHER tab kept (rule 3, v26.03)', () => {
            // Two tabs open at once, neither with a draft waiting. The second keeps a copy of work that exists nowhere
            // else — a save its memory-only queue may never send — and then the first, clean, goes into the background.
            const first = slotFor('A. Member'), second = slotFor('A. Member');
            second.keep({ member: 'A. Member', date: '2026-12-07' }, { rows: [{ date: '2026-12-08', type: 'sick' }] });
            first.forget();
            assert.ok(ls.has(KEY), 'the first tab deleted the copy the second had just kept');
            second.forget();
            assert.equal(ls.has(KEY), false, 'the tab that kept it may still forget it');
            ls.set(KEY, stored());   // kept before the mark existed: forgotten as it always was
            first.forget();
            assert.equal(ls.has(KEY), false);
        });

        test('Discard deletes it; Restore puts it back, then deletes it — asked once, in the app\'s words (rule 1)', async () => {
            ls.set(KEY, stored());
            /** @type {any[]} */ const applied = [];
            assert.equal(await slotFor('A. Member').offer({ ask: ask(false), apply: (d) => applied.push(d) }), 'discarded');
            assert.deepEqual(applied, [], 'Discard applies nothing');
            assert.equal(ls.has(KEY), false);
            ls.set(KEY, stored());
            assert.equal(await slotFor('A. Member').offer({ ask: ask(true), apply: (d) => applied.push(d) }), 'restored');
            assert.deepEqual(applied.map(d => d.data.rows[0].type), ['sick']);
            assert.equal(ls.has(KEY), false, 'cleared after a restore: the work is the page\'s again');
            assert.deepEqual(asked[1], { title: 'Unsaved changes', message: 'Restore your unsaved changes from 13:20?', confirmLabel: 'Restore', cancelLabel: 'Discard',
                dismissResult: null });
        });

        test('a question put away unanswered — a tap outside it, Escape, Back — keeps the draft, still unanswered (rule 1)', async () => {
            ls.set(KEY, stored());
            const slot = slotFor('A. Member');
            /** @type {any[]} */ const applied = [];
            assert.equal(await slot.offer({ ask: ask(null), apply: (d) => applied.push(d) }), 'unanswered');
            assert.equal(asked[0].dismissResult, null, 'the dialog must be told a dismissal is not Discard');
            assert.deepEqual(applied, [], 'nothing is put back');
            assert.ok(ls.has(KEY), 'a tap on the backdrop deleted the kept work');
            slot.forget();   // a clean hide in the same page life
            assert.ok(ls.has(KEY), 'still unanswered, so a clean hide may not delete it (rule 3)');
            assert.ok(slotFor('A. Member').peek(), 'and the next load asks again');
        });

        test('a Restore that could not be put back keeps the draft for the next load', async () => {
            ls.set(KEY, stored());
            assert.equal(await slotFor('A. Member').offer({ ask: ask(true), apply: () => false }), 'kept');
            assert.ok(ls.has(KEY));
            const realError = console.error;
            console.error = () => {};
            try {
                assert.equal(await slotFor('A. Member').offer({ ask: ask(true), apply: () => { throw new Error('no grid'); } }), 'kept');
            } finally { console.error = realError; }
            assert.ok(ls.has(KEY));
        });

        // AN ANSWER DELETES ONLY THE COPY IT WAS ASKED ABOUT (external review, 14 Nov 2026). Two tabs share
        // one slot, and the question waits for a person: going to the first tab to answer it is exactly what
        // hides the second, which keeps a NEWER copy of its own work then. Answering the old question used to
        // delete whatever the slot held by then — the only copy of work an iPhone may yet discard.
        describe('another tab keeps a newer copy while this one is still being answered', () => {
            const KEPT_LATER = { member: 'A. Member', date: '2026-12-14' };
            /** The second tab's copy, kept at the moment the first tab's question is answered (or put back). */
            const keepInAnotherTab = () => slotFor('A. Member', NOW + 60_000).keep(KEPT_LATER, { rows: [{ date: '2026-12-15', type: 'rdw' }] });
            const storedScope = () => { assert.ok(ls.has(KEY), "the other tab's newer copy was deleted"); return JSON.parse(String(ls.get(KEY))).scope; };

            for (const [answer, outcome] of /** @type {[boolean, string][]} */ ([[false, 'discarded'], [true, 'restored']])) {
                test(`${answer ? 'Restore' : 'Discard'} leaves the newer copy where it is`, async () => {
                    ls.set(KEY, stored());
                    const slot = slotFor('A. Member');
                    const asking = async () => { keepInAnotherTab(); return answer; };
                    assert.equal(await slot.offer({ ask: asking, apply: () => {} }), outcome);
                    assert.ok(ls.has(KEY), `${answer ? 'Restore' : 'Discard'} of the old question deleted the other tab's newer copy`);
                    assert.deepEqual(storedScope(), KEPT_LATER);
                    slot.forget();   // and this tab, clean, cannot delete it either (rule 3)
                    assert.ok(ls.has(KEY));
                });
            }

            test('a Restore still being put back leaves a copy kept meanwhile', async () => {
                ls.set(KEY, stored());
                const apply = async () => { await Promise.resolve(); keepInAnotherTab(); };
                assert.equal(await slotFor('A. Member').offer({ ask: ask(true), apply }), 'restored');
                assert.deepEqual(storedScope(), KEPT_LATER, 'the newer copy went when the old one was put back');
            });

            test('a draft that has all since saved is deleted only while it is still the one that was read', async () => {
                ls.set(KEY, stored());
                const unsaved = () => { keepInAnotherTab(); return null; };
                assert.equal(await slotFor('A. Member').offer({ ask: ask(true), apply: () => {}, unsaved }), 'saved');
                assert.deepEqual(storedScope(), KEPT_LATER);
            });

            test('with no other tab, each answer still deletes the copy it answered', async () => {
                for (const [answer, outcome] of /** @type {[boolean, string][]} */ ([[false, 'discarded'], [true, 'restored']])) {
                    ls.set(KEY, stored());
                    assert.equal(await slotFor('A. Member').offer({ ask: ask(answer), apply: () => {} }), outcome);
                    assert.equal(ls.has(KEY), false, `${outcome}: the answered copy was left behind`);
                }
            });
        });

        // WORK A SAVE HAS SINCE LANDED IS NOT UNSAVED (rule 6, v25.97). A page hidden while its save was
        // still waiting kept that save's rows; once the save landed, the next load asked about them anyway,
        // and Restore then named each day as changed since — about the member's own save.
        test('all of it landed since: deleted with no question (rule 6)', async () => {
            ls.set(KEY, stored());
            /** @type {any[]} */ const applied = [];
            assert.equal(await slotFor('A. Member').offer({ ask: ask(true), apply: (d) => applied.push(d), unsaved: () => null }), 'saved');
            assert.deepEqual(asked, [], 'asked "Restore your unsaved changes?" about changes that were saved');
            assert.deepEqual(applied, []);
            assert.equal(ls.has(KEY), false, 'and nothing is left to ask about next time');
        });

        test('part of it landed since: only what is still unsaved is asked about and put back (rule 6)', async () => {
            ls.set(KEY, stored({ data: { rows: [{ date: '2026-12-08', type: 'sick' }, { date: '2026-12-09', type: 'annual_leave' }] } }));
            /** @type {any[]} */ const applied = [];
            const unsaved = (/** @type {any} */ d) => ({ ...d.data, rows: d.data.rows.filter((/** @type {any} */ r) => r.date !== '2026-12-08') });
            assert.equal(await slotFor('A. Member').offer({ ask: ask(true), apply: (d) => applied.push(d), unsaved }), 'restored');
            assert.equal(asked.length, 1);
            assert.deepEqual(applied.map(d => d.data.rows.map((/** @type {any} */ r) => r.date)), [['2026-12-09']], 'the landed day was put back as unsaved');
        });

        test('a hook that cannot answer is no answer: the whole draft is asked about (rule 6)', async () => {
            ls.set(KEY, stored());
            /** @type {any[]} */ const applied = [];
            const realError = console.error;
            console.error = () => {};
            try {
                assert.equal(await slotFor('A. Member').offer({ ask: ask(true), apply: (d) => applied.push(d), unsaved: () => { throw new Error('records not read'); } }), 'restored');
            } finally { console.error = realError; }
            assert.deepEqual(applied.map(d => d.data.rows.length), [1], 'work a broken check could not account for was dropped');
        });

        test('nothing kept, nothing asked — and a draft past its day is deleted when it is read (rule 4)', async () => {
            assert.equal(await slotFor('A. Member').offer({ ask: ask(true), apply: () => {} }), 'none');
            assert.deepEqual(asked, []);
            ls.set(KEY, stored({ savedAt: NOW - ud.DRAFT_MAX_AGE_MS - HOUR }));
            assert.equal(slotFor('A. Member').peek(), null);
            assert.equal(ls.has(KEY), false);
        });

        // A DAY, THEN GONE — FOR EVERY DRAFT ON THE DEVICE (whole-app check, Nov 2026). A draft was read,
        // and so deleted when stale, only through the slot that owns its key: a colleague's staged week
        // left on the station PC by somebody who never opened that page there again stayed for good.
        test('creating any slot sweeps every draft on the device that nobody can be offered — and leaves a live one (rule 4)', () => {
            const colleague = 'myb_draft_admin_B.%20Colleague', unreadable = 'myb_draft_admin_D.%20Fourth';
            const live = 'myb_draft_links_C.%20Third', ahead = 'myb_draft_links_E.%20Fifth';
            ls.set(colleague, ud.encodeDraft({ page: 'admin', by: 'B. Colleague', scope: { member: 'B. Colleague', date: '2026-12-07' },
                data: { rows: [{ date: '2026-12-08', type: 'sick' }] }, savedAt: NOW - ud.DRAFT_MAX_AGE_MS - HOUR }));
            ls.set(unreadable, '{not json');
            ls.set(live, ud.encodeDraft({ page: 'links', by: 'C. Third', scope: {}, data: { patterns: { 1: {} } }, savedAt: NOW - HOUR }));
            ls.set(ahead, ud.encodeDraft({ page: 'links', by: 'E. Fifth', scope: {}, data: { patterns: { 1: {} } }, savedAt: NOW + 2 * HOUR }));
            ls.set('myb_pc_a_member_settings', 'kept');
            slotFor('A. Member');
            assert.equal(ls.has(colleague), false, 'a colleague\'s day-old staged week stayed on the shared PC');
            assert.equal(ls.has(unreadable), false, 'unreadable: no page can ever offer it');
            assert.equal(ls.has(ahead), false, 'dated ahead of the clock: its age cannot be judged, so it is never offered');
            assert.ok(ls.has(live), 'inside its day: still its own member\'s to be offered (rule 2)');
            assert.equal(ls.get('myb_pc_a_member_settings'), 'kept', 'only drafts are swept');
            ls.delete(live); ls.delete('myb_pc_a_member_settings');
        });

        test('nobody signed in keeps nothing', () => {
            slotFor('').keep({}, { rows: [] });
            assert.equal(ls.size, 0);
        });

        test('a draft the page could not put back WHOLE is neither offered nor kept — and a test that throws says no', async () => {
            const grid = (/** @type {any} */ d) => !!d.patterns && Object.keys(d.patterns).length > 0;
            const LKEY = 'myb_draft_links_A.%20Member';
            ls.set(LKEY, ud.encodeDraft({ page: 'links', by: 'A. Member', scope: { design: 'd1' }, data: { patterns: {} }, savedAt: NOW }));
            const slot = ud.createDraftSlot({ page: 'links', by: 'A. Member', now: () => NOW, usable: grid });
            assert.equal(await slot.offer({ ask: ask(true), apply: () => {} }), 'none', 'an empty grid, saved, would wipe the shared design');
            assert.deepEqual(asked, []);
            assert.equal(ls.has(LKEY), false);
            ls.set(LKEY, ud.encodeDraft({ page: 'links', by: 'A. Member', scope: { design: 'd1' }, data: { patterns: { 1: { mon: 'RD' } } }, savedAt: NOW }));
            assert.ok(ud.createDraftSlot({ page: 'links', by: 'A. Member', now: () => NOW, usable: grid }).peek(), 'a whole one is offered');
            assert.equal(ud.createDraftSlot({ page: 'links', by: 'A. Member', now: () => NOW, usable: () => { throw new Error('x'); } }).peek(), null);
        });
    });

    test('END TO END IN NODE: hidden while dirty, the next page life asks — and only its own member', async () => {
        const fresh = await import('../page-session.js?draft-e2e');
        const first = ud.createDraftSlot({ page: 'links', by: 'A. Member', now: () => NOW });
        fresh.keepDraftWhenHidden(() => true, { keep: () => first.keep({ design: 'd1' }, { patterns: { 1: { mon: 'RD' } } }), forget: () => first.forget() });
        setVisibility('hidden');
        assert.equal(ud.createDraftSlot({ page: 'links', by: 'B. Member', now: () => NOW }).peek(), null);
        /** @type {any[]} */ const back = [];
        const next = ud.createDraftSlot({ page: 'links', by: 'A. Member', now: () => NOW + HOUR });
        assert.equal(await next.offer({ ask: async () => true, apply: (d) => back.push(d.scope.design) }), 'restored');
        assert.deepEqual(back, ['d1']);
    });
});
