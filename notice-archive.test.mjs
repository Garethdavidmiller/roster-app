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

    test('a null or bare value inside the list is left out, so the panel never reads a field off it', () => {
        store.set(KEY, JSON.stringify([null, notice('kept'), 7, 'text', notice('also')]));
        assert.deepEqual(readArchivedNotices().map(n => n.id), ['kept', 'also']);
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

describe('a RE-POSTED notice replaces its old record (routed from paycalc-3, whole-app review 10 Nov 2026)', () => {
    // The Pay Calculator's Year to Date notice ran twice under ONE archive id, `ytd_2627`: 6 Apr 2026,
    // and again from 28 Aug on a new done key. A device that dismissed both kept the FIRST record —
    // App Notices said "6 Apr 2026", and the record aged out 180 days after the first dismissal,
    // about forty days after the second. Same id, a different date, is a re-post.
    beforeEach(() => { store.clear(); storageThrows = false; });
    const DAY = 86_400_000;
    const RUN_1 = { id: 'ytd_2627', title: 'Enter your Year to Date figures', section: 'Pay', date: '6 Apr 2026', body: 'Run one.' };
    const RUN_2 = { ...RUN_1, date: '28 Aug 2026', body: 'Run two.' };

    test('the re-post\'s record takes the old one\'s place: its date and words, a fresh archivedAt, at the top', () => {
        const longAgo = new Date(Date.now() - 140 * DAY).toISOString();
        store.set(KEY, JSON.stringify([{ ...notice('other'), archivedAt: new Date(Date.now() - DAY).toISOString() },
                                       { ...RUN_1, archivedAt: longAgo }]));
        archiveNotice(RUN_2);
        const listed = readArchivedNotices();
        assert.deepEqual(listed.map(n => n.id), ['ytd_2627', 'other'], 'one record for the id, and it is the newest');
        assert.equal(listed[0].date, '28 Aug 2026');
        assert.equal(listed[0].body, 'Run two.');
        assert.ok(Date.now() - new Date(listed[0].archivedAt).getTime() < 60_000,
            'kept for 180 days from THIS dismissal, not the first run\'s');
    });

    test('the same id with the SAME date is still idempotent — a notice that archives on every showing is not refreshed by it', () => {
        const then = new Date(Date.now() - 10 * DAY).toISOString();
        store.set(KEY, JSON.stringify([{ ...notice('other'), archivedAt: new Date(Date.now() - DAY).toISOString() },
                                       { ...RUN_2, archivedAt: then }]));
        archiveNotice({ ...RUN_2 });
        const listed = readArchivedNotices();
        assert.deepEqual(listed.map(n => n.id), ['other', 'ytd_2627'], 'not moved');
        assert.equal(listed[1].archivedAt, then, 'and not re-stamped');
    });
});
