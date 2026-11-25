// @lane unit
/**
 * Unit tests for nav-panel.js — the drawer. The App Notices archive's rules are notice-archive.js's, and
 * are tested in notice-archive.test.mjs (they moved there with the pages' imports, Nov 2026).
 * Run with: node --experimental-test-module-mocks scripts/run-tests.mjs test/nav-panel.test.mjs
 *
 * nav-panel.js imports browser-only modules (notif.js, overlay.js, ls.js) that
 * touch window/navigator at load. They are mocked so the module imports cleanly
 * in Node; ls.js is backed by an in-memory store the tests seed and inspect.
 */

import { test, describe, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
// The REAL isSafeStorageUrl — it lives in the pure, import-free storage-utils.js (firebase-client.js
// re-exports it), so the mock below uses production behaviour directly instead of a hand-copied
// mirror that could drift from the real bucket-allowlist rule.
import { isSafeStorageUrl, officeViewerUrl, resolveDocumentOpenUrl } from '../storage-utils.js';

// Tests live in test/ but address files from the repository root (moved 24 Nov 2026).
const REPO_ROOT_URL = new URL('../', import.meta.url);

// In-memory localStorage backing the ls.js mock — seeded/read directly by tests.
const store = new Map();
// Order of the sign-out steps, recorded by the notif.js mock and the page callbacks.
/** @type {string[]} */
const signOutLog = [];

/** What the Circular read answers — a test that opens one replaces it. @type {() => Promise<any>} */
let latestCircular = async () => null;
/** What the short-lived link answers — null, as the app ships, unless a test says otherwise. @type {() => Promise<any>} */
let signedDocumentUrl = async () => null;
mock.module('../firebase-client.js', {
    namedExports: {
        getLatestCircular:    () => latestCircular(),
        getLatestNewsletter:  async () => null,
        isSafeStorageUrl,   // the real function (see the import note above) — no mirror to keep in sync
        officeViewerUrl,    // the real function — .docx nav links route through it
        resolveDocumentOpenUrl,  // the real rule too: which url a drawer tap actually opens
        // The drawer mints a short-lived url before setting the pre-opened tab's location. `null`
        // is the state the app ships in (no IAM grant), and is what these tests exercise — the
        // stored url must still open, exactly as it did before the endpoint existed.
        fetchSignedDocumentUrl: () => signedDocumentUrl(),
        currentUserAfterBoot: async () => ({ uid: 'u1' }),   // the drawer bell asks (v25.06)
    },
});
/** What the bell's read and its turn-on answer — a test that races them replaces them. @type {() => Promise<string>} */
let peekState = async () => 'off-default';
/** @type {() => Promise<string>} */
let enableNotif = async () => 'on';
mock.module('../notif.js', {
    namedExports: {
        notifSupported:      () => false,
        peekNotifState:      () => peekState(),
        enableNotifications: () => enableNotif(),
        disableNotifications: async () => 'off-default',
        releaseDevicePush:    async () => { signOutLog.push('release'); },
    },
});
/** Body-scroll unlocks the drawer asked for — a close it should not have made shows up here. */
let scrollUnlocks = 0;
/** The drawer's claim on a popstate, which overlay.js asks before it pops its own stack. @type {Array<() => boolean>} */
const popInterceptors = [];
mock.module('../overlay.js', {
    namedExports: {
        lockBodyScroll: () => {}, unlockBodyScroll: () => { scrollUnlocks += 1; },
        suppressNextPop: () => {}, registerPopInterceptor: (/** @type {() => boolean} */ fn) => { popInterceptors.push(fn); },   // v16.23 pop-ownership hooks
        whenHistorySettled: (/** @type {() => void} */ fn) => fn(),
        watchScrollFade: () => () => {},   // the body's "more below" fade — decoration; e2e/pages.spec.js tests it
        pinCloseButton: () => {},          // the coming-soon ✕ kept in reach as it scrolls — layout; e2e/pages.spec.js tests it
        // A tap on a drawer lightbox's backdrop closes it. Which taps count is overlay.js's rule, tested
        // there against the real function; here a click on the backdrop itself is enough.
        closeOnBackdropTap: (/** @type {any} */ overlay, /** @type {() => void} */ close) => {
            overlay.addEventListener('click', (/** @type {any} */ e) => { if (e.target === overlay) close(); });
        },
    },
});
mock.module('../ls.js', {
    namedExports: {
        lsGet: (k)    => (store.has(k) ? store.get(k) : null),
        lsSet: (k, v) => { store.set(k, String(v)); },
        lsDel: (k)    => { store.delete(k); },
    },
});
/** Every open counter the drawer fired, as `[id, identity]` — recorded, so a test can say which ones it expects. @type {Array<[string, any]>} */
const opens = [];
mock.module('../usage-reporter.js', {
    namedExports: {
        recordUsage: () => {},
        recordOpen:  (/** @type {string} */ id, /** @type {any} */ who) => { opens.push([id, who]); },   // the drawer's doc/guide open counters
    },
});

const { initNavPanel, resetNavPanel } = await import('../nav-panel.js');

// ── initNavPanel DOM guard ────────────────────────────────────────────────────

describe('initNavPanel', () => {
    test('returns early without throwing when #navMenuBtn is not found', () => {
        global.document = { getElementById: () => null };
        assert.doesNotThrow(() => initNavPanel({ currentPage: 'calendar' }));
    });

    test('pre-initialised burger causes immediate return with no DOM mutations', () => {
        let mutated = false;
        const burger = {
            dataset: { navPanelInit: '1' }, // already initialised
            setAttribute: () => { mutated = true; },
            getAttribute: () => null,
            addEventListener: () => {},
        };
        global.document = { getElementById: id => id === 'navMenuBtn' ? burger : null };
        // Must not throw, must not mutate the element further
        initNavPanel({ currentPage: 'calendar' });
        assert.equal(mutated, false, 'no DOM mutation should occur when navPanelInit is already set');
    });
});

// ── Sign-out: the push record is released only once the page has committed ────
// Sep 2026 re-review: the release ran BEFORE the page's onSignOut, and Links' onSignOut could still
// be cancelled over unsaved work — leaving a signed-in device with no push record.

/** A generic element stub: records listeners; every other DOM call is inert. */
function fakeEl() {
    /** @type {Record<string, Function>} */
    const on = {};
    return {
        on, dataset: {}, style: {}, textContent: '', firstChild: null,
        classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        addEventListener: (/** @type {string} */ t, /** @type {Function} */ fn) => { on[t] = fn; },
        removeEventListener() {}, setAttribute() {}, removeAttribute() {}, getAttribute: () => null,
        hasAttribute: () => false, focus() {}, remove() {}, appendChild() {},
        querySelector: () => null, querySelectorAll: () => [],
    };
}

/** Initialise the drawer on a fake page and return its Sign out button. */
function mountDrawer(/** @type {any} */ opts) {
    /** @type {Map<string, any>} */
    const els = new Map();
    global.document = /** @type {any} */ ({
        getElementById: (/** @type {string} */ id) => { if (!els.has(id)) els.set(id, fakeEl()); return els.get(id); },
        createElement: () => fakeEl(), body: fakeEl(),
        addEventListener() {}, removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
    });
    // A page that is not the Calendar, so a `./#…` link is a navigation (`_onCalendarPage`).
    const location = { pathname: '/links.html', hash: '', replace() {} };
    global.window = /** @type {any} */ ({ addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false }), setTimeout, clearTimeout, location });
    /** @type {any} */ (global).location = location;
    global.history = /** @type {any} */ ({ pushState() {}, back() {} });
    initNavPanel({ currentPage: 'links', memberName: 'A. Test', ...opts });
    return els.get('navSignOutBtn');
}

// ── The Admin and Pay pills without gates: kept for nobody signed in ──────────────────────────────
// `isNotOtherStaff` is the one gate `initNavPanel` defaults to TRUE (owner, 23 Nov 2026): a page that passes no
// gates — nobody signed in — must keep Admin and Pay, and only an Other Staff login loses them.
describe('the Other Staff gate defaults to keeping Admin and Pay', () => {
    /** The drawer markup a mount injects. @param {any} opts */
    function injected(opts) {
        /** @type {any[]} */ const made = [];
        global.document = /** @type {any} */ ({
            getElementById: () => fakeEl(),
            createElement: () => { const el = fakeEl(); made.push(el); return el; }, body: fakeEl(),
            addEventListener() {}, removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
        });
        const location = { pathname: '/links.html', hash: '', replace() {} };
        global.window = /** @type {any} */ ({ addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false }), setTimeout, clearTimeout, location });
        /** @type {any} */ (global).location = location;
        global.history = /** @type {any} */ ({ pushState() {}, back() {} });
        initNavPanel({ currentPage: 'links', ...opts });
        return made.map(el => String(el.innerHTML ?? '')).join('');
    }
    test('no gates passed: Admin and Pay are drawn', () => {
        const html = injected({});
        assert.ok(html.includes('./admin.html') && html.includes('./paycalc.html'), 'the drawer was built with both pills');
    });
    // END STAFF PIN IS GONE (owner, 23 Nov 2026): a drawer with nobody signed in draws no footer at all —
    // no Lock button, no "Staff PIN access" — and the option an old caller passed for one is not read.
    test('nobody signed in: no footer, and no staff-PIN button, whatever an old caller passes', () => {
        const html = injected({ memberName: null, onSignOut: null, onLockCalendar: { isViewer: () => true, lock: async () => {} } });
        assert.ok(html.includes('./admin.html'), 'premise: the drawer was built');
        assert.ok(!html.includes('navLockCalendarBtn') && !/staff PIN/i.test(html), 'the End staff PIN button came back');
        assert.ok(!html.includes('nav-panel-footer'), 'a footer was drawn for nobody');
    });
    test('a member: the footer, with Sign out', () => {
        const html = injected({ memberName: 'Q. Example', onSignOut: () => {} });
        assert.ok(html.includes('nav-panel-footer') && html.includes('navSignOutBtn'));
    });
    test('an Other Staff login (isNotOtherStaff false): neither is drawn, Settings still is', () => {
        const html = injected({ memberName: 'Q. Example', isNotOtherStaff: false });
        assert.ok(!html.includes('./admin.html') && !html.includes('./paycalc.html'));
        assert.ok(html.includes('./settings.html'));
    });
});

describe('sign-out releases the device push record only once the page commits', () => {
    beforeEach(() => { signOutLog.length = 0; });

    test('a cancelled sign-out (beforeSignOut → false) releases nothing and signs nobody out', async () => {
        const btn = mountDrawer({ beforeSignOut: async () => false, onSignOut: () => signOutLog.push('signout') });
        await btn.on.click();
        assert.deepEqual(signOutLog, []);
    });

    test('a confirmed sign-out releases WHILE signed in, then signs out', async () => {
        const btn = mountDrawer({ beforeSignOut: async () => true, onSignOut: () => signOutLog.push('signout') });
        await btn.on.click();
        assert.deepEqual(signOutLog, ['release', 'signout']);
    });

    test('a page with no beforeSignOut releases and signs out as before', async () => {
        const btn = mountDrawer({ onSignOut: () => signOutLog.push('signout') });
        await btn.on.click();
        assert.deepEqual(signOutLog, ['release', 'signout']);
    });
    test('a second tap while the first is in flight does nothing — and a Cancel re-arms it (v24.53)', async () => {
        /** @type {(v: boolean) => void} */ let answer = () => {};
        let asked = 0;
        const btn = mountDrawer({
            beforeSignOut: () => { asked += 1; return new Promise(res => { answer = res; }); },
            onSignOut: () => signOutLog.push('signout'),
        });
        const first = btn.on.click();
        await btn.on.click();                       // the double tap, during the close fade
        await new Promise(r => setTimeout(r, 0));
        assert.equal(asked, 1, 'one "Sign out anyway?", not two stacked');
        answer(false); await first;
        assert.deepEqual(signOutLog, [], 'cancelled');
        const again = btn.on.click();
        await new Promise(r => setTimeout(r, 0));
        assert.equal(asked, 2, 'after a Cancel the button works again');
        answer(true); await again;
        assert.deepEqual(signOutLog, ['release', 'signout'], 'and signs out exactly once');
    });
});

describe('resetNavPanel consumes a live drawer entry (v25.06, whole-app review)', () => {
    // It cleared the flag and left the entry, so after a relogin the member's next Back popped an
    // entry nothing claimed — one press swallowed.
    test('reset with the drawer OPEN pops its entry; with the drawer closed, nothing', () => {
        /** The reset clone-replaces the burger; the fake element needs the two calls it makes. */
        const resettable = () => Object.assign(/** @type {any} */ (document.getElementById('navMenuBtn')),
            { cloneNode: () => ({ removeAttribute() {}, setAttribute() {} }), replaceWith() {} });
        mountDrawer({ onSignOut: () => {} });
        let backs = 0;
        global.history = /** @type {any} */ ({ pushState() {}, back() { backs += 1; } });
        resettable().on.click();   // opens: pushes the drawer's entry
        resetNavPanel();
        assert.equal(backs, 1, "the open drawer's entry is consumed");
        mountDrawer({ onSignOut: () => {} });
        global.history = /** @type {any} */ ({ pushState() {}, back() { backs += 1; } });
        resettable();
        resetNavPanel();
        assert.equal(backs, 1, 'a closed drawer has no entry to consume');
    });
});

describe('a drawer-link click with the drawer SHUT closes nothing (48-hour review, Nov 2026)', () => {
    // The document hand-off clicks a drawer link programmatically, and it can run after the drawer
    // closed — under App Notices or the coming-soon panel. Closing again there unlocked the scroll
    // those panels still hold and dropped the drawer's history marker.
    test('shut: no close, no unlock — open: the ordinary close', () => {
        mountDrawer({ onSignOut: () => {} });
        const panel = /** @type {any} */ (document.getElementById('navPanel'));
        const link = { tagName: 'A', getAttribute: () => './#circular', target: '' };
        // Only the generic link selector matches — the hand-off link carries none of the special classes.
        const target = { closest: (/** @type {string} */ sel) => (sel === '.nav-panel-pill, .nav-panel-link' ? link : null) };
        const click = () => panel.on.click({ target, button: 0, preventDefault() {} });
        scrollUnlocks = 0;
        click();
        assert.equal(scrollUnlocks, 0, 'the drawer was shut: nothing to close, nothing to unlock');
        /** @type {any} */ (document.getElementById('navMenuBtn')).on.click();   // open it
        click();
        assert.equal(scrollUnlocks, 1, 'open, the same click closes it for the navigation');
    });
});

// ── EVERY WAY OUT OF THE DRAWER TAKES ITS HISTORY ENTRY WITH IT (whole-app check, Nov 2026) ──────────
// The drawer pushes one entry when it opens. A page pill REPLACES it with the destination; everything
// else that left by a link only FORGOT it, so a same-URL entry stayed behind and the next Back press did
// nothing: every Daily Huddle opened from the drawer, every guide or page opened in a new tab.
describe('every way out of the drawer takes its history entry with it', () => {
    /** The drawer on a page at `pathname`, opened, and a click on one of its links. @param {string} pathname */
    function openDrawerAt(pathname) {
        // The module keeps its flags between mounts: clear them against an empty page.
        global.document = /** @type {any} */ ({ getElementById: () => null, addEventListener() {}, removeEventListener() {} });
        resetNavPanel();
        mountDrawer({ onSignOut: () => {} });
        const did = { backs: 0, replaced: /** @type {string[]} */ ([]), prevented: false };
        const location = { pathname, hash: '', replace: (/** @type {string} */ to) => { did.replaced.push(to); } };
        Object.assign(/** @type {any} */ (global.window), { location });
        /** @type {any} */ (global).location = location;
        global.history = /** @type {any} */ ({ pushState() {}, back() { did.backs += 1; } });
        /** @type {any} */ (document.getElementById('navMenuBtn')).on.click();   // open: the drawer pushes its entry
        /** @param {{ href?: string, tagName?: string, ctrlKey?: boolean, guide?: boolean }} link */
        const click = ({ href = '', tagName = 'A', ctrlKey = false, guide = false }) => {
            const el = { tagName, target: '', href: `https://example.test/${href.replace(/^\.\//, '')}`, dataset: {},
                getAttribute: (/** @type {string} */ a) => (a === 'href' ? href : null) };
            const wanted = guide ? '.nav-panel-link--guide' : '.nav-panel-pill, .nav-panel-link';
            /** @type {any} */ (document.getElementById('navPanel')).on.click({
                target: { closest: (/** @type {string} */ sel) => (sel === wanted ? el : null) },
                button: 0, ctrlKey, preventDefault: () => { did.prevented = true; } });
            return did;
        };
        return { click, location };
    }

    for (const path of ['/', '/index.html', '/roster-app/']) {
        test(`the Daily Huddle on the Calendar (${path}) pops the drawer's entry, then sets the hash`, () => {
            const { click, location } = openDrawerAt(path);
            const did = click({ href: './#huddle' });
            assert.equal(did.backs, 1, 'the entry was forgotten, not popped — Back then does nothing once');
            assert.equal(location.hash, '#huddle', 'a hash change under this page, not a navigation');
            assert.deepEqual(did.replaced, [], '`./#huddle` from /index.html would be a path change and a reload');
            assert.equal(did.prevented, true);
        });
    }

    test('from any other page it REPLACES the drawer\'s entry with the Calendar, as a page pill does', () => {
        const did = openDrawerAt('/settings.html').click({ href: './#huddle' });
        assert.deepEqual(did.replaced, ['https://example.test/#huddle']);
        assert.equal(did.backs, 0, 'the page is leaving — nothing to pop');
    });

    test('a click that leaves this page where it is pops the entry: a new tab, the "you are here" pill, a guide', () => {
        assert.equal(openDrawerAt('/settings.html').click({ href: './admin.html', ctrlKey: true }).backs, 1, 'a page opened in a new tab');
        assert.equal(openDrawerAt('/settings.html').click({ tagName: 'SPAN' }).backs, 1, 'the inert pill for this page');
        assert.equal(openDrawerAt('/settings.html').click({ href: './fip-guide.html', ctrlKey: true, guide: true }).backs, 1, 'a guide in a new tab');
        const pill = openDrawerAt('/settings.html').click({ href: './admin.html' });
        assert.deepEqual([pill.backs, pill.replaced.length], [0, 1], 'and a plain pill still replaces it, unchanged');
    });
});

// ── The drawer's two hand-made lightboxes (test audit, 7 Nov 2026) ─────────────────────────────────
// App Notices and the coming-soon panel run their own lifecycle — they share the drawer's history
// entry, so createLightbox cannot own them — and nothing here had ever opened one: deleting their
// 500 ms fallback, or breaking Escape, passed this file. overlay-parity finds a hand-rolled overlay by
// its dismissOverlay import, which these do not have, so it could not see them either. Driven
// through the real drawer: the burger opens it, a tap on the panel's link opens the lightbox.

/** An element with a working classList, several listeners per event (`once` honoured), and focus. */
function liveEl(/** @type {string[]} */ classes = []) {
    const cls = new Set(classes);
    /** @type {Map<string, string>} */
    const attrs = new Map();
    /** @type {Record<string, Array<{ fn: Function, once: boolean }>>} */
    const listeners = {};
    /** @type {any} */
    const el = {
        dataset: {}, style: {}, textContent: '', hidden: false, firstChild: null,
        classList: {
            add: (/** @type {string[]} */ ...c) => c.forEach(x => cls.add(x)),
            remove: (/** @type {string[]} */ ...c) => c.forEach(x => cls.delete(x)),
            toggle: (/** @type {string} */ c, /** @type {boolean} */ force) => {
                const on = force ?? !cls.has(c); if (on) cls.add(c); else cls.delete(c); return on;
            },
            contains: (/** @type {string} */ c) => cls.has(c),
        },
        addEventListener: (/** @type {string} */ t, /** @type {Function} */ fn, /** @type {any} */ opts) => {
            (listeners[t] ??= []).push({ fn, once: !!opts?.once });
        },
        removeEventListener: (/** @type {string} */ t, /** @type {Function} */ fn) => {
            listeners[t] = (listeners[t] ?? []).filter(l => l.fn !== fn);
        },
        fire: (/** @type {string} */ t, /** @type {any} */ ev = {}) => {
            for (const l of [...(listeners[t] ?? [])]) { if (l.once) el.removeEventListener(t, l.fn); l.fn(ev); }
        },
        // Attributes are KEPT, so a test can read what the drawer set (the lock button's `hidden`, below).
        setAttribute: (/** @type {string} */ k, /** @type {any} */ v) => { attrs.set(k, String(v)); },
        removeAttribute: (/** @type {string} */ k) => { attrs.delete(k); },
        getAttribute: (/** @type {string} */ k) => attrs.get(k) ?? null, hasAttribute: (/** @type {string} */ k) => attrs.has(k),
        focus() { /** @type {any} */ (global.document).activeElement = el; },
        remove() {}, appendChild() {}, append() {}, querySelector: () => null, querySelectorAll: () => [],
        cloneNode: () => ({ removeAttribute() {}, setAttribute() {} }), replaceWith() {},
    };
    return el;
}

/** Mount the drawer on a page whose elements behave, and return the handles a test drives.
 *  @param {any} [opts] more `initNavPanel` options */
function mountLive(opts = {}) {
    /** @type {Map<string, any>} */
    const els = new Map([
        ['navComingSoonLightbox', liveEl(['lb-overlay'])],   // the classes the injected markup gives them
        ['navNoticesLightbox',    liveEl(['lb-overlay'])],
    ]);
    /** @type {Function[]} */
    const keydown = [];
    /** @type {Function[]} */
    const popstate = [];
    const page = {
        backs: 0,
        /** Every open `.lb-overlay` this page holds — what `_overlayAbove` reads. */
        openOverlays: () => [...els.values()].filter(e => e.classList.contains('lb-overlay') && e.classList.contains('open')),
        /** A popstate reaching the drawer's own window listener. */
        popstate: () => popstate.slice().forEach(fn => fn({})),
    };
    global.document = /** @type {any} */ ({
        activeElement: null,
        getElementById: (/** @type {string} */ id) => { if (!els.has(id)) els.set(id, liveEl()); return els.get(id); },
        createElement: () => liveEl(), body: liveEl(),
        addEventListener: (/** @type {string} */ t, /** @type {Function} */ fn) => { if (t === 'keydown') keydown.push(fn); },
        removeEventListener: (/** @type {string} */ t, /** @type {Function} */ fn) => {
            const i = keydown.indexOf(fn); if (t === 'keydown' && i !== -1) keydown.splice(i, 1);
        },
        querySelectorAll: (/** @type {string} */ sel) => (sel === '.lb-overlay.open' ? page.openOverlays() : []),
        querySelector: (/** @type {string} */ sel) => (sel === '.lb-overlay.open' ? page.openOverlays()[0] ?? null : null),
    });
    global.window = /** @type {any} */ ({
        addEventListener: (/** @type {string} */ t, /** @type {Function} */ fn) => { if (t === 'popstate') popstate.push(fn); },
        removeEventListener() {}, matchMedia: () => ({ matches: false }),
        setTimeout: (/** @type {any[]} */ ...a) => setTimeout(...a), clearTimeout: (/** @type {any} */ t) => clearTimeout(t) });
    // `state` is the entry the page is ON — what the drawer reads to tell its own entry from another's.
    global.history = /** @type {any} */ ({ state: null, pushState(/** @type {any} */ s) { this.state = s; }, back() { page.backs += 1; } });
    global.requestAnimationFrame = /** @type {any} */ ((/** @type {Function} */ fn) => { fn(); return 0; });
    resetNavPanel();   // the module keeps its flags between mounts — start each test from a closed drawer
    initNavPanel({ currentPage: 'links', memberName: 'A. Test', onSignOut: () => {}, ...opts });
    const $ = (/** @type {string} */ id) => document.getElementById(id);
    /** Fire a key at every document keydown listener, as the browser would; true if one prevented it. */
    const press = (/** @type {string} */ key) => {
        let prevented = false;
        for (const fn of [...keydown]) fn({ key, shiftKey: false, preventDefault: () => { prevented = true; } });
        return prevented;
    };
    /** Open the drawer, then tap the link whose class is `linkClass`. */
    const openFromDrawer = (/** @type {string} */ linkClass) => {
        /** @type {any} */ ($('navMenuBtn')).fire('click');
        const trigger = { dataset: { csTitle: 'Rail Staff Travel' } };
        /** @type {any} */ ($('navPanel')).fire('click',
            { target: { closest: (/** @type {string} */ sel) => (sel === linkClass ? trigger : null) }, button: 0, preventDefault() {} });
        page.backs = 0;
        scrollUnlocks = 0;
    };
    return { $, press, openFromDrawer, page, els };
}

// The info panel (`#navComingSoonLightbox`) is reached by a document tap the drawer answers in place: here the
// document gate refusing, which answers at once. (A `comingSoon` link reached it too, until the extension point
// was removed for want of a user, Nov 2026.)
const LIGHTBOXES = [
    { name: 'App Notices', link: '.nav-panel-link--notices',  box: 'navNoticesLightbox',    close: 'navNoticesClose',    opts: {} },
    { name: 'info panel',  link: '.nav-panel-link--circular', box: 'navComingSoonLightbox', close: 'navComingSoonClose', opts: { canReadDocuments: () => false } },
];

describe('the drawer\'s hand-made lightboxes keep the shared lifecycle\'s promises', () => {
    beforeEach(() => mock.timers.enable({ apis: ['setTimeout'] }));
    afterEach(() => mock.timers.reset());

    for (const lb of LIGHTBOXES) {
        test(`${lb.name}: Escape closes it, and gives the drawer's history entry back`, () => {
            const { $, press, openFromDrawer, page } = mountLive(lb.opts);
            openFromDrawer(lb.link);
            assert.equal($(lb.box).classList.contains('open'), true, 'premise: the lightbox opened');
            press('Escape');
            assert.equal($(lb.box).classList.contains('open'), false, 'Escape did nothing — a keyboard user cannot leave');
            assert.equal(page.backs, 1, 'the shared history entry was not popped');
        });

        test(`${lb.name}: a close whose transitionend never comes still finishes at 500 ms`, () => {
            // iOS suppresses transitionend on a backgrounded tab. Without the fallback the lightbox
            // stays `.visible` over the page with the scroll still locked — the app looks frozen.
            const { $, openFromDrawer } = mountLive(lb.opts);
            openFromDrawer(lb.link);
            $(lb.close).fire('click');
            mock.timers.tick(499);
            assert.equal($(lb.box).classList.contains('visible'), true, 'premise: still fading at 499 ms');
            mock.timers.tick(1);
            assert.equal($(lb.box).classList.contains('visible'), false, 'the lightbox never left the screen');
            assert.equal(scrollUnlocks, 1, 'the page behind stayed locked');
            assert.equal(document.activeElement, $('navMenuBtn'), 'focus was not handed back to the burger');
        });

        test(`${lb.name}: a child's transitionend does not finish the fade; the panel's own does`, () => {
            // transitionend BUBBLES (lightbox review R1-4): the ✕'s press easing back reached the panel's
            // listener and finished its fade early, so the panel vanished instead of fading out.
            const { $, openFromDrawer } = mountLive(lb.opts);
            openFromDrawer(lb.link);
            $(lb.close).fire('click');
            $(lb.box).fire('transitionend', { target: $(lb.close) });
            assert.equal($(lb.box).classList.contains('visible'), true, 'a child\'s transition ended the panel\'s fade');
            assert.equal(scrollUnlocks, 0, 'and released the page under a panel still on screen');
            $(lb.box).fire('transitionend', { target: $(lb.box) });
            assert.equal($(lb.box).classList.contains('visible'), false, 'the panel\'s own fade still finishes it');
            assert.equal(scrollUnlocks, 1);
        });

        test(`${lb.name}: under reduced motion the close finishes at once`, () => {
            // shared.css turns the fade off, so no transitionend comes: waiting for the 500 ms fallback left
            // an invisible layer over the page swallowing every tap, with the scroll still locked (R1-10).
            const { $, openFromDrawer } = mountLive(lb.opts);
            /** @type {any} */ (global.window).matchMedia = (/** @type {string} */ q) => ({ matches: q.includes('reduced-motion') });
            openFromDrawer(lb.link);
            $(lb.close).fire('click');
            assert.equal($(lb.box).classList.contains('visible'), false, 'a reduced-motion close waited for a fade that never runs');
            assert.equal(scrollUnlocks, 1, 'the page behind stayed locked');
            assert.equal(document.activeElement, $('navMenuBtn'), 'focus was not handed back to the burger');
        });

        test(`${lb.name}: a second ✕ tap during the fade closes nothing more`, () => {
            // Two finishers for one lock: with a dialog open beneath, the second unlock released the
            // page behind it. createLightbox has refused a second close since v21.86; these had not.
            const { $, openFromDrawer, page } = mountLive(lb.opts);
            openFromDrawer(lb.link);
            $(lb.close).fire('click');
            $(lb.close).fire('click');                          // the double tap, mid-fade
            $(lb.box).fire('click', { target: $(lb.box) });     // …and a backdrop tap for good measure
            $(lb.box).fire('transitionend', { target: $(lb.box) });
            mock.timers.tick(500);
            assert.equal(scrollUnlocks, 1, 'one open, one unlock');
            assert.equal(page.backs, 1, 'one history entry popped');
        });

        test(`${lb.name}: an overlay opened above it owns the keyboard`, () => {
            // A Huddle viewer opened by a notification tap sits over the archive. One Escape used to
            // close both, and Tab was dragged back into the panel the reader could no longer see.
            const { $, press, openFromDrawer, els } = mountLive(lb.opts);
            openFromDrawer(lb.link);
            const viewer = liveEl(['lb-overlay', 'open']);
            els.set('huddleViewer', viewer);
            assert.equal(press('Tab'), false, 'Tab was trapped into the lightbox underneath');
            assert.notEqual(document.activeElement, $(lb.close));
            press('Escape');
            assert.equal($(lb.box).classList.contains('open'), true, 'one Escape closed the lightbox under the viewer too');
            viewer.classList.remove('open');                    // the viewer closes; now this one is on top
            press('Escape');
            assert.equal($(lb.box).classList.contains('open'), false, 'and once on top, Escape reaches it again');
        });

        // …and Back: a dialog over it (the app-update question, the unsaved-work offer) owns its own Back,
        // and the echo of its own Cancel. Both LAND on the drawer's entry, which the lightbox shares; it
        // used to take every pop for its own while open — closing underneath, the dialog left standing.
        test(`${lb.name}: a pop that lands on the drawer's entry is the dialog's above it — one that leaves it is its own`, () => {
            const { $, openFromDrawer, page } = mountLive(lb.opts);
            openFromDrawer(lb.link);
            const own = history.state;
            const claims = () => popInterceptors.some(fn => fn());
            /** @type {any} */ (history).state = own;            // a dialog above was popped
            assert.equal(claims(), false, 'the drawer claimed the dialog\'s Back: the dialog would stay on screen');
            page.popstate();
            assert.equal($(lb.box).classList.contains('open'), true, 'a pop above it closed the lightbox underneath');
            /** @type {any} */ (history).state = null;           // Back with nothing above: the drawer's entry goes
            assert.equal(claims(), true);
            page.popstate();
            assert.equal($(lb.box).classList.contains('open'), false, 'its own Back must still close it');
        });
    }
});

// ── A NOTIFICATION TAPPED WITH THE DRAWER OPEN (18 Nov 2026) ─────────────────────────────────────────────
// A tap is a hash navigation of the page, pushed ON TOP of the drawer's entry, and it fires popstate. The drawer
// took that for Back and closed, leaving its entry beneath the tap's; the page then took the tap's entry back off,
// so the reader was left ON the drawer's entry, and after the viewer closed one Back did nothing. Driven through
// the drawer's own popstate listener: `land` makes an entry current at an address, as the browser does, and pops.
describe('a notification tapped with the drawer open leaves no dead Back', () => {
    const HOME = 'https://example.test/';
    /** The drawer opened on the Calendar; `entry` is the state of the history entry it pushed. */
    function openOnCalendar() {
        const live = mountLive();
        /** @type {any} */ (global).location = { href: HOME, pathname: '/', hash: '' };
        /** @type {any} */ (live.$('navMenuBtn')).fire('click');
        live.page.backs = 0;
        return { ...live, entry: history.state };
    }
    /** @param {ReturnType<typeof openOnCalendar>} live @param {any} state @param {string} href */
    const land = (live, state, href) => {
        /** @type {any} */ (history).state = state;
        /** @type {any} */ (global.location).href = href;
        live.page.popstate();
    };

    test('the tap closes the drawer, and when the page\'s Back lands on the drawer\'s entry the drawer steps off it', () => {
        const live = openOnCalendar();
        assert.ok(live.entry?.mybNavPanel, 'premise: the drawer pushed its own entry');
        land(live, null, `${HOME}#circular`);                    // the tap: a hash pushed above the drawer's entry
        assert.equal(live.$('navPanel').classList.contains('open'), false, 'the tap closes the drawer, as before');
        assert.equal(live.page.backs, 0, 'nothing is stepped on the tap itself: the page takes the tap\'s entry off');
        land(live, live.entry, HOME);                            // the page's Back lands on the drawer's entry
        assert.equal(live.page.backs, 1, 'left there, the next Back press would do nothing');
        land(live, null, HOME);                                  // the step lands
        assert.equal(live.page.backs, 1, 'one step, once');
    });

    test('a viewer the page opened above the entry keeps its own Back: the drawer\'s entry goes when the viewer closes', () => {
        const live = openOnCalendar();
        land(live, null, `${HOME}#huddle`);
        land(live, { mybOverlay: true }, HOME);                  // the page's Back landed, and its viewer pushed at once
        assert.equal(live.page.backs, 0, 'a step now would close the viewer the page has just opened');
        land(live, live.entry, HOME);                            // the viewer closes: its Back lands on the drawer's entry
        assert.equal(live.page.backs, 1);
    });

    test('a real Back with the drawer open closes it and leaves nothing to step off', () => {
        const live = openOnCalendar();
        land(live, null, HOME);                                  // Back: the entry beneath, at the address it was pushed at
        assert.equal(live.$('navPanel').classList.contains('open'), false);
        land(live, live.entry, HOME);                            // Forward onto the entry Back took
        assert.equal(live.page.backs, 0, 'an entry Back already took is never stepped off');
    });
});

// ── A CLOSE BEFORE THE FIRST FRAME (15 Nov 2026) ─────────────────────────────────────────────────────
// Each panel fades in on the next frame and moves focus to its ✕ 60 ms later, and a close can come
// first: an Escape before a slow engine draws, or a tab that runs no frames while hidden. Run late, the
// frame faded the closed panel back in over the page and the timer moved focus into it; and the close
// waited 500 ms for a fade that never ran, an invisible layer swallowing every tap. createLightbox
// learnt this in v26.12; these two hand-roll their lifecycle, so they had to learn it separately. The
// frames are HELD here, so each test says when they run. The drawer's own 60 ms focus is the last pair.
describe('a close before the first frame keeps the panel closed', () => {
    beforeEach(() => mock.timers.enable({ apis: ['setTimeout'] }));
    afterEach(() => mock.timers.reset());

    /** Hold every frame until the test runs them. @returns {Function[]} */
    const holdFrames = () => {
        /** @type {Function[]} */ const frames = [];
        global.requestAnimationFrame = /** @type {any} */ ((/** @type {Function} */ fn) => { frames.push(fn); return 0; });
        return frames;
    };

    for (const lb of LIGHTBOXES) {
        test(`${lb.name}: closed before it faded in, it goes at once and stays gone`, () => {
            const { $, openFromDrawer } = mountLive(lb.opts);
            const frames = holdFrames();
            openFromDrawer(lb.link);
            assert.equal($(lb.box).classList.contains('visible'), true, 'premise: the tap opened the panel');
            assert.equal($(lb.box).classList.contains('open'), false, 'premise: its first frame has not run');
            $(lb.close).fire('click');
            assert.equal($(lb.box).classList.contains('visible'), false, 'a panel that never faded in waited for a fade that never ran');
            assert.equal(scrollUnlocks, 1, 'the page behind stayed locked');
            assert.equal(document.activeElement, $('navMenuBtn'), 'focus was not handed back to the burger');
            frames.splice(0).forEach(fn => fn());
            assert.equal($(lb.box).classList.contains('open'), false, 'the late frame faded the closed panel back in');
            mock.timers.tick(60);
            assert.equal(document.activeElement, $('navMenuBtn'), 'a 60 ms timer moved focus into a panel that had closed');
            mock.timers.tick(500);
            assert.equal(scrollUnlocks, 1, 'one open, one unlock');
        });

        test(`${lb.name}: a frame nothing closed still fades it in, and its ✕ takes the focus`, () => {
            const { $, openFromDrawer } = mountLive(lb.opts);
            const frames = holdFrames();
            openFromDrawer(lb.link);
            frames.splice(0).forEach(fn => fn());
            assert.equal($(lb.box).classList.contains('open'), true, 'an open panel never faded in');
            mock.timers.tick(60);
            assert.equal(document.activeElement, $(lb.close), 'the open panel\'s ✕ never took the focus');
        });
    }

    test('the drawer: closed inside 60 ms, its ✕ does not take the focus', () => {
        const { $ } = mountLive();
        /** @type {any} */ ($('navMenuBtn')).fire('click');
        /** @type {any} */ ($('navPanelClose')).fire('click');
        assert.equal(document.activeElement, $('navMenuBtn'), 'premise: the close handed focus to the burger');
        mock.timers.tick(60);
        assert.equal(document.activeElement, $('navMenuBtn'), 'the 60 ms timer moved focus into the closed drawer');
    });

    test('the drawer: left open, its ✕ takes the focus at 60 ms', () => {
        const { $ } = mountLive();
        /** @type {any} */ ($('navMenuBtn')).fire('click');
        mock.timers.tick(60);
        assert.equal(document.activeElement, $('navPanelClose'), 'the open drawer\'s ✕ never took the focus');
    });
});

// ── THE 8-SECOND BUDGET COVERS THE WHOLE OPEN (whole-app check, Nov 2026) ─────────────────────────────
// The drawer opens a blank tab on the tap and gives it a location once the Circular is read. The read
// raced 8 s; the short-lived link after it did not — its own timeout starts only once a session and an
// ID token are in hand, and a token refresh on a weak signal is bounded only by the SDK's own network
// timeout, tens of seconds. All that time the blank tab sat there and both document links were dead.
describe('opening the latest Circular stays inside its 8-second budget', () => {
    const STORED = 'https://firebasestorage.googleapis.com/v0/b/myb-roster.appspot.com/o/x.pdf?alt=media&token=e2e';
    beforeEach(() => { mock.timers.enable({ apis: ['setTimeout'] }); opens.length = 0; });
    afterEach(() => { mock.timers.reset(); latestCircular = async () => null; signedDocumentUrl = async () => null; });
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

    test('a short-lived link that has not answered by then gives way to the stored url', async () => {
        const { $ } = mountLive();
        /** @type {string[]} */ const opened = [];
        /** @type {any} */ (global.window).open = () => ({ opener: null, close() {}, location: { set href(/** @type {string} */ v) { opened.push(String(v)); } } });
        latestCircular = async () => ({ storageUrl: STORED, fileType: 'pdf', storagePath: 'circulars/x.pdf' });
        signedDocumentUrl = () => new Promise(r => setTimeout(() => r(null), 30_000));   // a token refresh stuck on a weak signal
        /** @type {any} */ ($('navMenuBtn')).fire('click');
        const link = liveEl(['nav-panel-link', 'nav-panel-link--circular']);
        /** @type {any} */ ($('navPanel')).fire('click', {
            target: { closest: (/** @type {string} */ sel) => (sel === '.nav-panel-link--circular' ? link : null) }, button: 0, preventDefault() {} });
        await flush();
        mock.timers.tick(7_999); await flush();
        assert.deepEqual(opened, [], 'premise: nothing opens before the budget is spent');
        mock.timers.tick(1); await flush();
        assert.deepEqual(opened, [STORED], 'the blank tab waited past the 8 s budget for a link it does not need');
        assert.equal(link.classList.contains('nav-panel-link--loading'), false, 'and both document links are live again');
        // Counted once, as the Circular, against the SIGNED-IN name (the open counters' admin exclusion reads it —
        // usage-reporter.js), and only now that the document has genuinely opened.
        assert.deepEqual(opens, [['circular', 'A. Test']], 'the open is counted once, against the session');
    });

    // AN UPLOADED DOCUMENT WHOSE LINK THE APP REFUSES IS NOT "NONE UPLOADED" (whole-app check, 17 Nov 2026).
    // The drawer's fallback said the link's own "No Weekly Retail Circular has been uploaded yet", which sent the member
    // away believing there was nothing to read, and nobody told the admin the link was broken.
    test('a Circular whose stored link is refused says it can\'t be opened, and to tell the admin', async () => {
        const { $ } = mountLive();
        let closed = 0;
        /** @type {any} */ (global.window).open = () => ({ opener: null, close() { closed++; }, location: { set href(/** @type {string} */ _v) { throw new Error('a refused link was opened'); } } });
        latestCircular = async () => ({ storageUrl: 'https://example.invalid/x.pdf', fileType: 'pdf', storagePath: 'circulars/x.pdf' });
        /** @type {any} */ ($('navMenuBtn')).fire('click');
        const link = liveEl(['nav-panel-link', 'nav-panel-link--circular']);
        link.dataset.csTitle = 'Weekly Retail Circular';
        link.dataset.csBody = 'No Weekly Retail Circular has been uploaded yet — a new one usually arrives on a Friday.';
        /** @type {any} */ ($('navPanel')).fire('click', {
            target: { closest: (/** @type {string} */ sel) => (sel === '.nav-panel-link--circular' ? link : null) }, button: 0, preventDefault() {} });
        await flush();
        assert.equal(closed, 1, 'the blank tab is closed');
        assert.deepEqual(opens, [], 'a document that did not open is not counted');
        assert.equal($('navComingSoonBody').textContent, 'The latest Weekly Retail Circular can’t be opened — please tell the admin.');
    });

    test('a tap the document gate refuses opens no tab and counts nothing', async () => {
        const { $ } = mountLive({ canReadDocuments: () => false });
        let tabs = 0;
        /** @type {any} */ (global.window).open = () => { tabs++; return null; };
        /** @type {any} */ ($('navMenuBtn')).fire('click');
        const link = liveEl(['nav-panel-link', 'nav-panel-link--circular']);
        /** @type {any} */ ($('navPanel')).fire('click', {
            target: { closest: (/** @type {string} */ sel) => (sel === '.nav-panel-link--circular' ? link : null) }, button: 0, preventDefault() {} });
        await flush();
        assert.equal(tabs, 0, 'refused before the blank tab, which would close a second later');
        assert.deepEqual(opens, [], 'nothing opened, so nothing is counted');
    });
});

// ── END STAFF PIN IS GONE (owner, 23 Nov 2026) ────────────────────────────────────────────────────────
// The staff PIN's way out of the drawer went with the PIN. A drawer with no member draws no footer at
// all — no Lock button, no "Staff PIN access" — and the option that drew one is not read.
// ── A REFRESH NEVER PAINTS OVER A TAP — IN FLIGHT, OR AFTER ITS ANSWER (24-hour check, 22 Nov 2026) ───────
// The drawer closed and reopened during a slow toggle started a refresh numbered ABOVE the tap's, whose read
// began before the toggle settled and answered after it: the old 🔕 was painted over the tap's 🔔 — the
// symptom `_bellGen` was written for, back through a second door.
describe('the bell: a drawer reopened during a slow toggle never paints the state from before the tap', () => {
    afterEach(() => { peekState = async () => 'off-default'; enableNotif = async () => 'on'; });
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    /** A promise and the hand that settles it. */
    const deferred = () => { /** @type {(v: any) => void} */ let resolve = () => {}; const p = new Promise(r => { resolve = r; }); return { p, resolve }; };

    /** Open the drawer on an "off" bell, tap it with a slow turn-on, close and reopen with a slow read. */
    async function tapThenReopen() {
        const { $ } = mountLive();
        const bell = /** @type {any} */ ($('navNotifBell'));
        /** @type {any} */ ($('navMenuBtn')).fire('click');
        await flush();
        assert.equal(bell.dataset.notifState, 'off-default', 'premise: the bell opens on "off"');
        const toggle = deferred();
        enableNotif = () => toggle.p;
        bell.fire('click');
        assert.equal(bell.dataset.notifState, 'loading', 'premise: the tap shows its working glyph');
        /** @type {any} */ ($('navPanelClose')).fire('click');
        const read = deferred();
        peekState = () => read.p;   // a read begun before the toggle settled: it will answer the OLD state
        /** @type {any} */ ($('navMenuBtn')).fire('click');
        await flush();
        return { bell, toggle, read };
    }

    test('the reopen\'s read answering AFTER the toggle settles does not undo it', async () => {
        const { bell, toggle, read } = await tapThenReopen();
        toggle.resolve('on'); await flush();
        assert.equal(bell.dataset.notifState, 'on', 'premise: the tap painted its answer');
        read.resolve('off-default'); await flush();
        assert.equal(bell.dataset.notifState, 'on', 'a read from before the tap painted 🔕 over a device just subscribed');
        assert.equal(bell.getAttribute('aria-pressed'), 'true');
    });

    test('the reopen\'s read answering WHILE the toggle is in flight leaves the working glyph alone', async () => {
        const { bell, toggle, read } = await tapThenReopen();
        read.resolve('off-default'); await flush();
        assert.equal(bell.dataset.notifState, 'loading', 'a refresh painted over a tap still in flight');
        toggle.resolve('on'); await flush();
        assert.equal(bell.dataset.notifState, 'on');
    });

    test('control, the first door: a tap during the OPEN\'s own slow read is not undone when that read answers', async () => {
        const { $ } = mountLive();
        const bell = /** @type {any} */ ($('navNotifBell'));
        bell.dataset.notifState = 'off-default';   // as an earlier refresh left it
        const read = deferred();
        peekState = () => read.p;
        /** @type {any} */ ($('navMenuBtn')).fire('click');
        await flush();   // the open's refresh is now reading
        const toggle = deferred();
        enableNotif = () => toggle.p;
        bell.fire('click');
        toggle.resolve('on'); await flush();
        read.resolve('off-default'); await flush();
        assert.equal(bell.dataset.notifState, 'on', 'the open\'s read, begun before the tap, painted over its answer');
    });

    test('a toggle that errors still restores the real state, once the tap has let go', async () => {
        const { $ } = mountLive();
        const bell = /** @type {any} */ ($('navNotifBell'));
        /** @type {any} */ ($('navMenuBtn')).fire('click');
        await flush();
        enableNotif = async () => { throw new Error('push service down'); };
        peekState = async () => 'off-lapsed';
        const warn = console.warn; console.warn = () => {};
        try { bell.fire('click'); await flush(); } finally { console.warn = warn; }
        assert.equal(bell.dataset.notifState, 'off-lapsed', 'the failed tap left the bell on its working glyph');
        assert.equal(bell.disabled, false);
    });
});

// ── A SLOW DOCUMENT READ BELONGS TO THE DRAWER IT WAS TAPPED IN (review, 21 Nov 2026) ─────────────────────
// `resetNavPanel` + `initNavPanel` rebuild the drawer (a sign-in in place). A Circular read from the OLD drawer
// that answers afterwards must not close the NEW one's state from under it: its classes stayed "open" while the
// module said shut, and Escape stopped working. Both answers are held — the failure fallback and the new-tab close.
describe('a document read that answers after the drawer was rebuilt leaves the new drawer alone', () => {
    const STORED = 'https://firebasestorage.googleapis.com/v0/b/myb-roster.appspot.com/o/x.pdf?alt=media&token=e2e';
    afterEach(() => { latestCircular = async () => null; });
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

    /** @param {any} answer what the old drawer's read finally answers */
    async function rebuildDuringRead(answer) {
        const { $, press, els } = mountLive();
        /** @type {any} */ (global.window).open = () => ({ opener: null, close() {}, location: { set href(/** @type {string} */ _v) {} } });
        /** @type {(v: any) => void} */ let settle = () => {};
        latestCircular = () => new Promise(r => { settle = r; });
        /** @type {any} */ ($('navMenuBtn')).fire('click');
        const link = liveEl(['nav-panel-link', 'nav-panel-link--circular']);
        link.dataset.csTitle = 'Weekly Retail Circular';
        /** @type {any} */ ($('navPanel')).fire('click', {
            target: { closest: (/** @type {string} */ sel) => (sel === '.nav-panel-link--circular' ? link : null) }, button: 0, preventDefault() {} });
        await flush();
        // THE REBUILD, as the page does it: the old drawer's elements leave the page, and the burger is replaced.
        const oldPanel = /** @type {any} */ ($('navPanel'));
        for (const id of ['navPanel', 'navPanelOverlay', 'navComingSoonLightbox', 'navNoticesLightbox']) {
            const el = /** @type {any} */ ($(id));
            el.remove = () => { el.isConnected = false; els.delete(id); };
        }
        /** @type {any} */ ($('navMenuBtn')).cloneNode = () => liveEl();
        /** @type {any} */ ($('navMenuBtn')).replaceWith = (/** @type {any} */ fresh) => { els.set('navMenuBtn', fresh); };
        resetNavPanel();
        initNavPanel({ currentPage: 'links', memberName: 'B. Test', onSignOut: () => {} });
        assert.equal(oldPanel.isConnected, false, 'premise: the old drawer has left the page');
        const panel = /** @type {any} */ ($('navPanel'));
        assert.notEqual(panel, oldPanel, 'premise: a new drawer was built');
        /** @type {any} */ ($('navMenuBtn')).fire('click');
        assert.equal(panel.classList.contains('open'), true, 'premise: the new drawer is open');
        settle(answer); await flush();
        assert.equal(panel.classList.contains('open'), true, 'the new drawer was closed by the old one\'s read');
        press('Escape');
        assert.equal(panel.classList.contains('open'), false, 'Escape no longer closes the new drawer: its state was closed under it');
    }

    test('no document — the failure fallback is dropped', () => rebuildDuringRead(null));
    test('a document that opens in its tab — the old drawer\'s close is dropped', () =>
        rebuildDuringRead({ storageUrl: STORED, fileType: 'pdf', storagePath: 'circulars/x.pdf' }));
});

// ── THE DOCUMENT LINKS ON A PAGE THAT PASSES NO GATE (review, 22 Nov 2026) ───────────────────────────────
// `canReadDocuments` defaulted to "yes", and Pay and Trains passed none. Offline the read answers from the
// device's cache without asking a rule (calendar-doc-access.js), so a drawer wired for nobody opened what an
// earlier visitor's session had left there. The default now asks for a named session — `memberName` — and
// Pay and Trains pass gates of their own.
describe('the drawer\'s documents: a named session, or the page\'s own gate', () => {
    const STORED = 'https://firebasestorage.googleapis.com/v0/b/myb-roster.appspot.com/o/x.pdf?alt=media&token=e2e';
    beforeEach(() => { mock.timers.enable({ apis: ['setTimeout'] }); opens.length = 0; });
    afterEach(() => { mock.timers.reset(); latestCircular = async () => null; signedDocumentUrl = async () => null; });
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    /** Tap the drawer's Circular row; say how many tabs were asked for and what the info panel says. */
    async function tapCircular(/** @type {any} */ opts) {
        const { $ } = mountLive(opts);
        let tabs = 0, reads = 0;
        latestCircular = async () => { reads++; return { storageUrl: STORED, fileType: 'pdf', storagePath: 'circulars/x.pdf' }; };
        /** @type {any} */ (global.window).open = () => { tabs++; return { opener: {}, close() {}, location: {} }; };
        /** @type {any} */ ($('navMenuBtn')).fire('click');
        const link = liveEl(['nav-panel-link', 'nav-panel-link--circular']);
        link.dataset.csTitle = 'Weekly Retail Circular';
        /** @type {any} */ ($('navPanel')).fire('click', {
            target: { closest: (/** @type {string} */ sel) => (sel === '.nav-panel-link--circular' ? link : null) }, button: 0, preventDefault() {} });
        await flush();
        return { tabs, reads, said: $('navComingSoonBody').textContent };
    }

    test('no gate and nobody signed in: refused before any tab or read', async () => {
        const got = await tapCircular({ memberName: null, onSignOut: null });
        assert.equal(got.reads, 0, 'a drawer wired for nobody read the documents — offline, the cache answers without a rule');
        assert.equal(got.tabs, 0);
        assert.match(got.said, /^Sign in to read the Weekly Retail Circular\.$/);
    });

    test('no gate and a member signed in: the read goes ahead, as on every named page', async () => {
        const got = await tapCircular({});
        assert.equal(got.reads, 1, 'the default refused a member on a page with a named session');
        assert.equal(got.tabs, 1);
    });

    test('a page\'s own gate decides, in both directions, whoever the drawer was wired for', async () => {
        assert.equal((await tapCircular({ canReadDocuments: () => false })).reads, 0);
        assert.equal((await tapCircular({ memberName: null, onSignOut: null, canReadDocuments: () => true })).reads, 1,
            'a page whose own gate admits the reader must reach the documents, whoever the drawer was wired for');
    });

    test('Pay and Trains pass a gate of their own at every drawer they wire', async () => {
        const { readFileSync } = await import('node:fs');
        for (const file of ['paycalc-app.js', 'trains-app.js']) {
            const src = readFileSync(new URL(`./${file}`, REPO_ROOT_URL), 'utf8');
            const calls = src.split('initNavPanel({').slice(1).map(rest => rest.slice(0, rest.indexOf('});')));
            assert.ok(calls.length > 0, `${file}: no initNavPanel call found`);
            for (const call of calls) assert.match(call, /canReadDocuments:/, `${file}: a drawer wired with no document gate`);
        }
    });
});

describe('the pre-opened tab is cut off from this page', () => {
    beforeEach(() => mock.timers.enable({ apis: ['setTimeout'] }));
    afterEach(() => { mock.timers.reset(); latestCircular = async () => null; });
    test('its opener is cleared at once, before the document is read', async () => {
        const { $ } = mountLive();
        /** @type {any} */ const tab = { opener: { a: 'this page' }, close() {}, location: {} };
        /** @type {any} */ (global.window).open = () => tab;
        latestCircular = () => new Promise(() => {});                // still reading
        /** @type {any} */ ($('navMenuBtn')).fire('click');
        const link = liveEl(['nav-panel-link', 'nav-panel-link--circular']);
        /** @type {any} */ ($('navPanel')).fire('click', {
            target: { closest: (/** @type {string} */ sel) => (sel === '.nav-panel-link--circular' ? link : null) }, button: 0, preventDefault() {} });
        assert.equal(tab.opener, null, 'the document tab could script this page (and its signed-in session) through window.opener');
    });
});

describe('a slow read that lands after the drawer was rebuilt touches nothing of the new one', () => {
    beforeEach(() => mock.timers.enable({ apis: ['setTimeout'] }));
    afterEach(() => { mock.timers.reset(); latestCircular = async () => null; });
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    test('a failure answered into a panel no longer on the page opens no info panel and closes nothing', async () => {
        const { $ } = mountLive();
        /** @type {any} */ (global.window).open = () => ({ opener: null, close() {}, location: {} });
        /** @type {(e: any) => void} */ let fail = () => {};
        latestCircular = () => new Promise((_r, reject) => { fail = reject; });
        /** @type {any} */ ($('navMenuBtn')).fire('click');
        const link = liveEl(['nav-panel-link', 'nav-panel-link--circular']);
        /** @type {any} */ ($('navPanel')).fire('click', {
            target: { closest: (/** @type {string} */ sel) => (sel === '.nav-panel-link--circular' ? link : null) }, button: 0, preventDefault() {} });
        await flush();
        /** @type {any} */ ($('navPanel')).isConnected = false;        // a rebuild removed this drawer
        scrollUnlocks = 0;
        fail(new Error('network'));
        await flush();
        assert.equal($('navComingSoonBody').textContent, '', 'the old drawer\'s answer opened an info panel over the new one');
        assert.equal(scrollUnlocks, 0, 'and unlocked a scroll it no longer holds');
    });
});

describe('the Newsletter the drawer opens is kept for the ☰ menu', () => {
    beforeEach(() => mock.timers.enable({ apis: ['setTimeout'] }));
    afterEach(() => mock.timers.reset());
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    test('its issue date is recorded, as the Calendar\'s own check records it', async () => {
        const { $ } = mountLive();
        /** @type {any} */ (global.window).open = () => ({ opener: null, close() {}, location: {} });
        store.delete('myb_newsletter_latest');
        /** @type {any} */ ($('navMenuBtn')).fire('click');
        const link = liveEl(['nav-panel-link', 'nav-panel-link--newsletter']);
        /** @type {any} */ ($('navPanel')).fire('click', {
            target: { closest: (/** @type {string} */ sel) => (sel === '.nav-panel-link--newsletter' ? link : null) }, button: 0, preventDefault() {} });
        await flush();
        // The mock answers "none uploaded" — the server's own null, which is an answer and is kept as one.
        assert.equal(store.get('myb_newsletter_latest'), '', 'the drawer\'s read said nothing to the menu that offers it');
    });
});

describe('a refusal from the server asks for a sign-in, and never for a PIN, on every page', () => {
    beforeEach(() => mock.timers.enable({ apis: ['setTimeout'] }));
    afterEach(() => { mock.timers.reset(); latestCircular = async () => null; });
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    for (const pathname of ['/', '/index.html', '/trains.html']) {
        test(`on ${pathname}`, async () => {
            const { $ } = mountLive();
            /** @type {any} */ (global.window).location = { pathname };
            /** @type {any} */ (global.window).open = () => ({ opener: null, close() {}, location: {} });
            latestCircular = async () => { throw Object.assign(new Error('refused'), { code: 'permission-denied' }); };
            /** @type {any} */ ($('navMenuBtn')).fire('click');
            const link = liveEl(['nav-panel-link', 'nav-panel-link--circular']);
            /** @type {any} */ ($('navPanel')).fire('click', {
                target: { closest: (/** @type {string} */ sel) => (sel === '.nav-panel-link--circular' ? link : null) }, button: 0, preventDefault() {} });
            await flush();
            const said = $('navComingSoonBody').textContent;
            assert.match(said, /may have ended/, 'premise: an access refusal');
            assert.match(said, /Sign in again/);
            assert.doesNotMatch(said, /PIN|on the Calendar/, 'the drawer sent its reader to the retired staff PIN');
        });
    }
});
