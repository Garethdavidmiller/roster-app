/**
 * Unit tests for nav-panel.js pure-ish exports: isNoticeExpired() and the
 * App Notices archive (archiveNotice).
 * Run with: node --experimental-test-module-mocks --test nav-panel.test.mjs
 *
 * nav-panel.js imports browser-only modules (notif.js, overlay.js, ls.js) that
 * touch window/navigator at load. They are mocked so the module imports cleanly
 * in Node; ls.js is backed by an in-memory store the tests seed and inspect.
 */

import { test, describe, mock, beforeEach } from 'node:test';
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
mock.module('./overlay.js', {
    namedExports: {
        lockBodyScroll: () => {}, unlockBodyScroll: () => {},
        suppressNextPop: () => {}, registerPopInterceptor: () => {},   // v16.23 pop-ownership hooks
        whenHistorySettled: (/** @type {() => void} */ fn) => fn(),
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

const { isNoticeExpired, archiveNotice, initNavPanel } = await import('./nav-panel.js');

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

// ── isNoticeExpired ───────────────────────────────────────────────────────────

describe('isNoticeExpired', () => {
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
    test('unparseable date is treated as not expired (fail-open)', () => {
        assert.equal(isNoticeExpired('not a date'), false);
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
    global.window = /** @type {any} */ ({ addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false }), setTimeout, clearTimeout });
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
});
