/**
 * Unit tests for nav-panel.js: isNoticeExpired() and the App Notices archive (archiveNotice) — both
 * notice-archive.js's, re-exported here and tested through the import every page uses — and the drawer.
 * Run with: node --experimental-test-module-mocks --test nav-panel.test.mjs
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
import { isSafeStorageUrl, officeViewerUrl, resolveDocumentOpenUrl } from './storage-utils.js';

// In-memory localStorage backing the ls.js mock — seeded/read directly by tests.
const store = new Map();
// Order of the sign-out steps, recorded by the notif.js mock and the page callbacks.
/** @type {string[]} */
const signOutLog = [];

mock.module('./firebase-client.js', {
    namedExports: {
        getLatestCircular:    async () => null,
        getLatestNewsletter:  async () => null,
        isSafeStorageUrl,   // the real function (see the import note above) — no mirror to keep in sync
        officeViewerUrl,    // the real function — .docx nav links route through it
        resolveDocumentOpenUrl,  // the real rule too: which url a drawer tap actually opens
        // The drawer mints a short-lived url before setting the pre-opened tab's location. `null`
        // is the state the app ships in (no IAM grant), and is what these tests exercise — the
        // stored url must still open, exactly as it did before the endpoint existed.
        fetchSignedDocumentUrl: async () => null,
        currentUserAfterBoot: async () => ({ uid: 'u1' }),   // the drawer bell asks (v25.06)
    },
});
mock.module('./notif.js', {
    namedExports: {
        notifSupported:      () => false,
        peekNotifState:      async () => 'off-default',
        enableNotifications: async () => 'on',
        disableNotifications: async () => 'off-default',
        releaseDevicePush:    async () => { signOutLog.push('release'); },
    },
});
/** Body-scroll unlocks the drawer asked for — a close it should not have made shows up here. */
let scrollUnlocks = 0;
/** The drawer's claim on a popstate, which overlay.js asks before it pops its own stack. @type {Array<() => boolean>} */
const popInterceptors = [];
mock.module('./overlay.js', {
    namedExports: {
        lockBodyScroll: () => {}, unlockBodyScroll: () => { scrollUnlocks += 1; },
        suppressNextPop: () => {}, registerPopInterceptor: (/** @type {() => boolean} */ fn) => { popInterceptors.push(fn); },   // v16.23 pop-ownership hooks
        whenHistorySettled: (/** @type {() => void} */ fn) => fn(),
        watchScrollFade: () => () => {},   // the body's "more below" fade — decoration; e2e/pages.spec.js tests it
    },
});
mock.module('./ls.js', {
    namedExports: {
        lsGet: (k)    => (store.has(k) ? store.get(k) : null),
        lsSet: (k, v) => { store.set(k, String(v)); },
        lsDel: (k)    => { store.delete(k); },
    },
});
mock.module('./usage-reporter.js', {
    namedExports: {
        recordUsage: () => {},
        recordOpen:  () => {},   // v18.20 — drawer doc/guide open counters (no-op under test)
    },
});

const { isNoticeExpired, archiveNotice, initNavPanel, resetNavPanel } = await import('./nav-panel.js');

const NOTICES_KEY = 'myb_app_notices';
const DAY = 86_400_000;

/** Format a Date as the notice "D Mon YYYY" string. */
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function noticeDate(daysAgo) {
    const d = new Date(Date.now() - daysAgo * DAY);
    return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
function readArchive() {
    return JSON.parse(store.get(NOTICES_KEY) || '[]');
}

// ── the archive is notice-archive.js's ───────────────────────────────────────

test('the archive calls the pages import from nav-panel.js ARE notice-archive.js\'s', async () => {
    const archive = await import('./notice-archive.js');
    assert.equal(archiveNotice, archive.archiveNotice);
    assert.equal(isNoticeExpired, archive.isNoticeExpired);
});

// ── isNoticeExpired ───────────────────────────────────────────────────────────

describe('isNoticeExpired', () => {
    // FROM A FIXED MIDDAY, NOT THE REAL CLOCK (test audit, 7 Nov 2026). `noticeDate` steps back in
    // whole 24-hour blocks, but the parser dates a notice from LOCAL MIDNIGHT — so across a clock
    // change a "27-day-old" notice read as more than 28 days old in the last hour of certain evenings
    // (23:00–23:59 on Sat 28 Nov 2026 in the no-install lane's Los Angeles time, and on Sat 21 Nov on a
    // London machine), every year. Midday on 15 June has no clock change within 92 days behind it in
    // any zone these lanes use, and is twelve hours from either midnight.
    describe('counted in days, from midday on 15 June', () => {
        beforeEach(() => mock.timers.enable({ apis: ['Date'], now: new Date(2026, 5, 15, 12, 0, 0) }));
        afterEach(() => mock.timers.reset());

        test('27-day-old notice is not expired (28-day default)', () => {
            assert.equal(isNoticeExpired(noticeDate(27)), false);
        });
        test('notice older than 28 days is expired (default)', () => {
            assert.equal(isNoticeExpired(noticeDate(29)), true);
        });
        test('notice exactly 28 days old is expired (boundary)', () => {
            assert.equal(isNoticeExpired(noticeDate(28)), true);
        });
        test('90-day override keeps an 88-day-old notice live', () => {
            assert.equal(isNoticeExpired(noticeDate(88), 90), false);
        });
        test('90-day override expires a 92-day-old notice', () => {
            assert.equal(isNoticeExpired(noticeDate(92), 90), true);
        });
    });
    test('unparseable date is treated as not expired (fail-open)', () => {
        assert.equal(isNoticeExpired('not a date'), false);
    });
    test('a LAST DAY with a one-day window is live all that day and gone from the next midnight (v24.86)', () => {
        // calendar-notices.js ends both October notices with `isNoticeExpired('31 Oct 2026', 1)` —
        // a date rather than a count from posting, because the clocks go back on 25 October and a
        // count would end an hour early. This pins the arithmetic that choice leans on.
        mock.timers.enable({ apis: ['Date'], now: new Date(2026, 9, 31, 23, 59, 59) });
        try {
            assert.equal(isNoticeExpired('31 Oct 2026', 1), false, 'still offered a second before midnight');
            mock.timers.setTime(new Date(2026, 10, 1, 0, 0, 1).getTime());
            assert.equal(isNoticeExpired('31 Oct 2026', 1), true, 'gone a second after it');
        } finally { mock.timers.reset(); }
    });
});

// ── archiveNotice ─────────────────────────────────────────────────────────────

describe('archiveNotice', () => {
    beforeEach(() => store.clear());

    const NEW = { id: 'new', title: 'New', section: 'General', date: '22 Jun 2026', body: 'b' };

    test('legacy record without archivedAt is preserved, not wiped', () => {
        store.set(NOTICES_KEY, JSON.stringify([
            { id: 'old', title: 'Old', section: 'General', date: '1 Jan 2026', body: 'x' },
        ]));
        archiveNotice(NEW);
        const ids = readArchive().map(n => n.id);
        assert.ok(ids.includes('old'), 'legacy entry should survive the migration');
        assert.ok(ids.includes('new'), 'new entry should be added');
    });

    test('migrated legacy record gains an archivedAt stamp', () => {
        store.set(NOTICES_KEY, JSON.stringify([{ id: 'old', title: 'Old', section: 'G', date: '1 Jan 2026', body: 'x' }]));
        archiveNotice(NEW);
        const old = readArchive().find(n => n.id === 'old');
        assert.ok(old.archivedAt, 'migrated record must carry archivedAt');
        assert.ok(Number.isFinite(new Date(old.archivedAt).getTime()));
    });

    test('179-day-old archive entry is retained', () => {
        const ts = new Date(Date.now() - 179 * DAY).toISOString();
        store.set(NOTICES_KEY, JSON.stringify([{ id: 'old', title: 'O', section: 'G', date: '1 Jan 2026', body: 'x', archivedAt: ts }]));
        archiveNotice(NEW);
        assert.ok(readArchive().some(n => n.id === 'old'), '179-day entry should be kept');
    });

    test('181-day-old archive entry is pruned', () => {
        const ts = new Date(Date.now() - 181 * DAY).toISOString();
        store.set(NOTICES_KEY, JSON.stringify([{ id: 'stale', title: 'S', section: 'G', date: '1 Jan 2026', body: 'x', archivedAt: ts }]));
        archiveNotice(NEW);
        assert.ok(!readArchive().some(n => n.id === 'stale'), '181-day entry should be removed');
    });

    test('malformed stored data does not prevent saving a new notice', () => {
        store.set(NOTICES_KEY, 'not json at all');
        archiveNotice(NEW);
        const arr = readArchive();
        assert.ok(Array.isArray(arr));
        assert.ok(arr.some(n => n.id === 'new'));
    });

    test('non-array stored data is treated as empty', () => {
        store.set(NOTICES_KEY, JSON.stringify({ not: 'an array' }));
        archiveNotice(NEW);
        const arr = readArchive();
        assert.deepEqual(arr.map(n => n.id), ['new']);
    });

    test('archiving the same id is idempotent (no duplicate)', () => {
        archiveNotice(NEW);
        archiveNotice(NEW);
        assert.equal(readArchive().filter(n => n.id === 'new').length, 1);
    });

    test('idempotent re-archive still persists migration of legacy entries', () => {
        store.set(NOTICES_KEY, JSON.stringify([
            { id: 'old', title: 'Old', section: 'G', date: '1 Jan 2026', body: 'x' }, // legacy, no archivedAt
            { id: 'new', title: 'New', section: 'G', date: '22 Jun 2026', body: 'b', archivedAt: new Date().toISOString() },
        ]));
        archiveNotice(NEW); // 'new' already present → idempotent path
        const old = readArchive().find(n => n.id === 'old');
        assert.ok(old, 'legacy entry should survive even on the idempotent path');
        assert.ok(old.archivedAt, 'legacy entry should be migrated (archivedAt stamped) and persisted');
    });

    test('archive is capped at 50 entries', () => {
        const many = Array.from({ length: 60 }, (_, i) => ({
            id: `n${i}`, title: 't', section: 'G', date: '1 Jan 2026', body: 'x',
            archivedAt: new Date().toISOString(),
        }));
        store.set(NOTICES_KEY, JSON.stringify(many));
        archiveNotice(NEW);
        assert.equal(readArchive().length, 50);
    });
});

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
        setAttribute() {}, removeAttribute() {}, getAttribute: () => null, hasAttribute: () => false,
        focus() { /** @type {any} */ (global.document).activeElement = el; },
        remove() {}, appendChild() {}, append() {}, querySelector: () => null, querySelectorAll: () => [],
        cloneNode: () => ({ removeAttribute() {}, setAttribute() {} }), replaceWith() {},
    };
    return el;
}

/** Mount the drawer on a page whose elements behave, and return the handles a test drives. */
function mountLive() {
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
    initNavPanel({ currentPage: 'links', memberName: 'A. Test', onSignOut: () => {} });
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

const LIGHTBOXES = [
    { name: 'App Notices', link: '.nav-panel-link--notices',     box: 'navNoticesLightbox',    close: 'navNoticesClose' },
    { name: 'coming soon', link: '.nav-panel-link--coming-soon', box: 'navComingSoonLightbox', close: 'navComingSoonClose' },
];

describe('the drawer\'s hand-made lightboxes keep the shared lifecycle\'s promises', () => {
    beforeEach(() => mock.timers.enable({ apis: ['setTimeout'] }));
    afterEach(() => mock.timers.reset());

    for (const lb of LIGHTBOXES) {
        test(`${lb.name}: Escape closes it, and gives the drawer's history entry back`, () => {
            const { $, press, openFromDrawer, page } = mountLive();
            openFromDrawer(lb.link);
            assert.equal($(lb.box).classList.contains('open'), true, 'premise: the lightbox opened');
            press('Escape');
            assert.equal($(lb.box).classList.contains('open'), false, 'Escape did nothing — a keyboard user cannot leave');
            assert.equal(page.backs, 1, 'the shared history entry was not popped');
        });

        test(`${lb.name}: a close whose transitionend never comes still finishes at 500 ms`, () => {
            // iOS suppresses transitionend on a backgrounded tab. Without the fallback the lightbox
            // stays `.visible` over the page with the scroll still locked — the app looks frozen.
            const { $, openFromDrawer } = mountLive();
            openFromDrawer(lb.link);
            $(lb.close).fire('click');
            mock.timers.tick(499);
            assert.equal($(lb.box).classList.contains('visible'), true, 'premise: still fading at 499 ms');
            mock.timers.tick(1);
            assert.equal($(lb.box).classList.contains('visible'), false, 'the lightbox never left the screen');
            assert.equal(scrollUnlocks, 1, 'the page behind stayed locked');
            assert.equal(document.activeElement, $('navMenuBtn'), 'focus was not handed back to the burger');
        });

        test(`${lb.name}: a second ✕ tap during the fade closes nothing more`, () => {
            // Two finishers for one lock: with a dialog open beneath, the second unlock released the
            // page behind it. createLightbox has refused a second close since v21.86; these had not.
            const { $, openFromDrawer, page } = mountLive();
            openFromDrawer(lb.link);
            $(lb.close).fire('click');
            $(lb.close).fire('click');                          // the double tap, mid-fade
            $(lb.box).fire('click', { target: $(lb.box) });     // …and a backdrop tap for good measure
            $(lb.box).fire('transitionend');
            mock.timers.tick(500);
            assert.equal(scrollUnlocks, 1, 'one open, one unlock');
            assert.equal(page.backs, 1, 'one history entry popped');
        });

        test(`${lb.name}: an overlay opened above it owns the keyboard`, () => {
            // A Huddle viewer opened by a notification tap sits over the archive. One Escape used to
            // close both, and Tab was dragged back into the panel the reader could no longer see.
            const { $, press, openFromDrawer, els } = mountLive();
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
            const { $, openFromDrawer, page } = mountLive();
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
