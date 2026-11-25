// @lane hygiene
/**
 * notice-archive.test.mjs — the App Notices archive read and written as storage, with no drawer.
 * Run: node scripts/run-tests.mjs test/notice-archive.test.mjs   (part of `npm run test:hygiene`)
 *
 * Everything about the archive is here, and the pages import it from here: the posting-date window
 * (`isNoticeExpired`), the write rules (dedupe, the 180-day prune, the legacy migration, the cap), what
 * the drawer's panel READS (`readArchivedNotices`) and the round trip between the two halves. The write
 * rules and the window lived in nav-panel.test.mjs, through a re-export nothing uses any more (Nov 2026).
 * No module mocks: `ls.js` is real, over an in-memory `localStorage`, so a storage that throws is the real
 * wrapper's case too; `mock.timers` fixes the clock where a test needs one.
 */
import { test, describe, mock, beforeEach, afterEach } from 'node:test';
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

const { readArchivedNotices, archiveNotice, isNoticeExpired, noticeDateInFull, reviseArchivedNotice } = await import('../notice-archive.js');

const NOTICES_KEY = KEY;
const DAY = 86_400_000;
/** Format a Date as the notice "D Mon YYYY" string. */
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function noticeDate(/** @type {number} */ daysAgo) {
    const d = new Date(Date.now() - daysAgo * DAY);
    return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
/** The stored archive, as written — the write rules are about what reaches storage. @returns {any[]} */
function readArchive() {
    return JSON.parse(store.get(NOTICES_KEY) || '[]');
}

const notice = (/** @type {string} */ id) => ({ id, title: `Title ${id}`, section: 'Pay', date: '1 Nov 2026', body: `Body ${id}` });

describe('readArchivedNotices — what the App Notices panel lists', () => {
    beforeEach(() => { store.clear(); storageThrows = false; });

    test('an archive never written reads as empty', () => {
        assert.deepEqual(readArchivedNotices(), []);
    });

    test('a notice archived more than 180 days ago is not listed, though nothing has been written since (review, 21 Nov 2026)', () => {
        const ago = (/** @type {number} */ days) => new Date(Date.now() - days * 86_400_000).toISOString();
        store.set(KEY, JSON.stringify([{ ...notice('recent'), archivedAt: ago(10) }, { ...notice('old'), archivedAt: ago(300) },
                                       { ...notice('legacy') }]));
        assert.deepEqual(readArchivedNotices().map(n => n.id), ['recent', 'legacy'],
            'the 300-day-old one goes; a legacy record with no date is kept, as the next write stamps it');
    });

    test('read and write agree on a record whose archivedAt cannot be read: neither keeps it (24-hour check)', () => {
        store.set(KEY, JSON.stringify([{ ...notice('kept'), archivedAt: new Date().toISOString() }, { ...notice('garbled'), archivedAt: 'not a date' }]));
        assert.deepEqual(readArchivedNotices().map(n => n.id), ['kept'], 'the panel listed a record the next write drops');
        archiveNotice(notice('new'));
        assert.deepEqual(readArchivedNotices().map(n => n.id), ['new', 'kept'], 'premise: the write drops it too');
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
    beforeEach(() => { store.clear(); storageThrows = false; });

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

describe('a posting date shown in full, and a record corrected in place (App Notices review, 24 Nov 2026)', () => {
    beforeEach(() => { store.clear(); storageThrows = false; });

    test('the month is written in full for the reader, and only for the reader', () => {
        assert.equal(noticeDateInFull('22 Oct 2026'), '22 October 2026');
        assert.equal(noticeDateInFull('9 Nov 2026'), '9 November 2026');
        assert.equal(noticeDateInFull('1 Sep 2026'), '1 September 2026');
        // Anything it cannot read comes back as given — never "Invalid Date", never blank.
        assert.equal(noticeDateInFull('16 November 2026'), '16 November 2026');
        assert.equal(noticeDateInFull(''), '');
    });
    test('…because the stored form is the expiry key, and a month in full is never read as one', () => {
        // The trap that keeps the stored date short: respelt, the notice would never end.
        assert.equal(isNoticeExpired('16 November 2026', 1), false, 'a full month never expires — so it must never be stored');
        assert.equal(isNoticeExpired('16 Nov 2020', 1), true);
    });
    test('a record already archived takes the corrected words, and keeps its place and its age', () => {
        const at = '2026-11-20T09:00:00.000Z';
        store.set(KEY, JSON.stringify([
            { id: 'a', title: 'A', section: 'G', date: '1 Nov 2026', body: 'a', archivedAt: at },
            { id: 'tt', title: 'Old title', section: 'Trains', date: '16 Nov 2026', body: 'starts on Sunday', archivedAt: at },
        ]));
        reviseArchivedNotice({ id: 'tt', date: '16 Nov 2026', title: 'New title', body: 'runs from Sunday' });
        const after = readArchive();
        assert.deepEqual(after.map(n => n.id), ['a', 'tt'], 'same place');
        assert.equal(after[1].title, 'New title');
        assert.equal(after[1].body, 'runs from Sunday');
        assert.equal(after[1].archivedAt, at, 'same age: it is not a new showing');
        assert.equal(after[0].body, 'a', 'nothing else touched');
    });
    test('another date under the same id is a different run, and is left alone', () => {
        store.set(KEY, JSON.stringify([{ id: 'tt', title: 'T', section: 'G', date: '1 Oct 2026', body: 'old run', archivedAt: new Date().toISOString() }]));
        reviseArchivedNotice({ id: 'tt', date: '16 Nov 2026', title: 'X', body: 'Y' });
        assert.equal(readArchive()[0].body, 'old run');
    });
    test('a device that never archived it gets nothing, and one already correct is not written', () => {
        reviseArchivedNotice({ id: 'tt', date: '16 Nov 2026', title: 'X', body: 'Y' });
        assert.equal(store.has(KEY), false, 'no archive was invented');
        const json = JSON.stringify([{ id: 'tt', title: 'X', section: 'G', date: '16 Nov 2026', body: 'Y', archivedAt: '2026-11-20T09:00:00.000Z' }]);
        store.set(KEY, json);
        let writes = 0;
        const set = g.localStorage.setItem;
        g.localStorage.setItem = (/** @type {string} */ k, /** @type {string} */ v) => { writes++; set(k, v); };
        try { reviseArchivedNotice({ id: 'tt', date: '16 Nov 2026', title: 'X', body: 'Y' }); }
        finally { g.localStorage.setItem = set; }
        assert.equal(writes, 0);
    });
    test('storage that throws, or holds nonsense, never makes it throw', () => {
        store.set(KEY, '{not json');
        assert.doesNotThrow(() => reviseArchivedNotice({ id: 'tt', date: '16 Nov 2026', title: 'X', body: 'Y' }));
        store.set(KEY, JSON.stringify([null, 3, { id: 'tt', date: '16 Nov 2026', title: 'T', body: 'B' }]));
        reviseArchivedNotice({ id: 'tt', date: '16 Nov 2026', title: 'X', body: 'Y' });
        assert.equal(readArchive()[2].body, 'Y', 'a null or bare member beside it does not stop the correction');
        storageThrows = true;
        assert.doesNotThrow(() => reviseArchivedNotice({ id: 'tt', date: '16 Nov 2026', title: 'X', body: 'Y' }));
    });
});
