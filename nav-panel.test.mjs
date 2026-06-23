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

// In-memory localStorage backing the ls.js mock — seeded/read directly by tests.
const store = new Map();

mock.module('./firebase-client.js', {
    namedExports: {
        getLatestCircular: async () => null,
    },
});
mock.module('./notif.js', {
    namedExports: {
        notifSupported:      () => false,
        peekNotifState:      async () => 'off-default',
        enableNotifications: async () => 'on',
        disableNotifications: async () => 'off-default',
    },
});
mock.module('./overlay.js', {
    namedExports: { lockBodyScroll: () => {}, unlockBodyScroll: () => {} },
});
mock.module('./ls.js', {
    namedExports: {
        lsGet: (k)    => (store.has(k) ? store.get(k) : null),
        lsSet: (k, v) => { store.set(k, String(v)); },
        lsDel: (k)    => { store.delete(k); },
    },
});

const { isNoticeExpired, archiveNotice } = await import('./nav-panel.js');

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
        assert.ok(readArchive().length <= 50);
    });
});
