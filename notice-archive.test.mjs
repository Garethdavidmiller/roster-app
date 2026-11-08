/**
 * notice-archive.test.mjs — the App Notices archive read and written as storage, with no drawer.
 * Run: node --test notice-archive.test.mjs   (part of `npm run test:hygiene`)
 *
 * The archive's write rules (dedupe, the 180-day prune, the legacy migration, the cap) and the posting-
 * date window are also pinned in nav-panel.test.mjs, through nav-panel.js's re-export — the import every
 * page uses. This file holds what the drawer's panel READS (`readArchivedNotices`, which left the drawer
 * with the archive) and the round trip between the two halves. No mocks: `ls.js` is real, over an
 * in-memory `localStorage`, so a storage that throws is the real wrapper's case too.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const KEY = 'myb_app_notices';
/** @type {Map<string, string>} */
const store = new Map();
let storageThrows = false;
const g = /** @type {any} */ (globalThis);
g.localStorage = {
    getItem: (/** @type {string} */ k) => { if (storageThrows) throw new Error('SecurityError'); return store.has(k) ? store.get(k) : null; },
    setItem: (/** @type {string} */ k, /** @type {string} */ v) => { if (storageThrows) throw new Error('SecurityError'); store.set(k, String(v)); },
    removeItem: (/** @type {string} */ k) => { store.delete(k); },
};

const { readArchivedNotices, archiveNotice } = await import('./notice-archive.js');

const notice = (/** @type {string} */ id) => ({ id, title: `Title ${id}`, section: 'Pay', date: '1 Nov 2026', body: `Body ${id}` });

describe('readArchivedNotices — what the App Notices panel lists', () => {
    beforeEach(() => { store.clear(); storageThrows = false; });

    test('an archive never written reads as empty', () => {
        assert.deepEqual(readArchivedNotices(), []);
    });

    test('unreadable storage reads as empty rather than throwing into the panel', () => {
        store.set(KEY, 'not json at all');
        assert.deepEqual(readArchivedNotices(), []);
    });

    test('valid JSON that is not a list reads as empty — the panel\'s forEach must never meet `{}`', () => {
        store.set(KEY, JSON.stringify({ not: 'a list' }));
        assert.deepEqual(readArchivedNotices(), []);
        store.set(KEY, 'null');
        assert.deepEqual(readArchivedNotices(), []);
    });

    test('a device whose storage throws on every access (iOS private mode) reads as empty, and archiving is silent', () => {
        storageThrows = true;
        assert.deepEqual(readArchivedNotices(), []);
        assert.doesNotThrow(() => archiveNotice(notice('a')));
    });

    test('what is archived is what the panel reads back, newest first, once per notice', () => {
        archiveNotice(notice('older'));
        archiveNotice(notice('newer'));
        archiveNotice(notice('older'));   // seen again on another page load
        const listed = readArchivedNotices();
        assert.deepEqual(listed.map(n => n.id), ['newer', 'older']);
        assert.equal(listed[0].body, 'Body newer');
        assert.ok(listed.every(n => typeof n.archivedAt === 'string'), 'every record carries when it was archived');
    });
});
