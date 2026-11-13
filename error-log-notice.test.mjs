// @ts-check
/**
 * error-log-notice.test.mjs — the RULES of the admin's Error Log notification (functions/error-log-notice.js,
 * v26.04), one block per rule in its header. Pure, so it runs in the no-install lane (`npm run test:hygiene`);
 * the sender that asks these rules is driven for real in error-log-notify.test.mjs.
 *
 * What a wrong answer costs, worst first: a notice that names a colleague or quotes an error on a LOCK
 * SCREEN; a phone rung every fifteen minutes through a burst; the same entry announced every hour for
 * ever; and the slow-save readings arriving unannounced — the silence this exists to end.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { DIAGNOSTIC_PREFIX as CLIENT_DIAGNOSTIC_PREFIX } from './client-errors.js';

const require = createRequire(import.meta.url);
const {
    DIAGNOSTIC_PREFIX, NOTICE_GAP_MS, NOTICE_SCAN_LIMIT, isSlowSave, noticeDue, summariseNewEntries, noticeWords,
} = require('./functions/error-log-notice.js');
const { NOTIFICATION_FEATURES, buildPushPayload } = require('./functions/push-notices.js');

const NOW = Date.UTC(2026, 10, 13, 20, 0);
const HOUR = 60 * 60 * 1000;
/** An entry as the Error Log stores it — the fields the reporter writes. */
const entry = (/** @type {string} */ message, extra = {}) => ({
    memberName: 'A. Hared', page: 'admin.html', message, appVersion: '26.03', userAgent: 'x', resolved: false, ...extra,
});
const SLOW = 'Slow save (diagnostic): the save took 8.1s to be confirmed — a save while the phone said it was online';

describe('rule 1 — at most one an hour, counted from the last ATTEMPT', () => {
    const line = { announcedThroughMs: NOW - 5 * HOUR };

    test('the gap is an hour: the promise the owner was given', () => {
        assert.equal(NOTICE_GAP_MS, HOUR);
    });

    test('a notice attempted within the hour waits, whether or not it reached a device', () => {
        assert.equal(noticeDue({ ...line, lastAttemptMs: NOW - HOUR + 1 }, NOW), 'wait');
        assert.equal(noticeDue({ ...line, lastAttemptMs: NOW - 1 }, NOW), 'wait');
    });

    test('an hour after the attempt, it looks again', () => {
        assert.equal(noticeDue({ ...line, lastAttemptMs: NOW - HOUR }, NOW), 'look');
    });

    test('never attempted: it looks', () => {
        assert.equal(noticeDue({ ...line, lastAttemptMs: null }, NOW), 'look');
    });

    test('an attempt stamped a moment AHEAD of this clock still holds, and one far ahead holds no longer than an hour', () => {
        assert.equal(noticeDue({ ...line, lastAttemptMs: NOW + 5_000 }, NOW), 'wait');
        assert.equal(noticeDue({ ...line, lastAttemptMs: NOW + HOUR }, NOW), 'look', 'a clock far out must not hold the notice shut for ever');
    });
});

describe('rule 6 — the first check SEEDS: the backlog is not news', () => {
    test('no record, or a record with no line, seeds', () => {
        assert.equal(noticeDue(null, NOW), 'seed');
        assert.equal(noticeDue({ announcedThroughMs: null, lastAttemptMs: null }, NOW), 'seed');
        assert.equal(noticeDue({ announcedThroughMs: NaN, lastAttemptMs: NOW - 1 }, NOW), 'seed',
            'a broken line seeds — it never waits, and never reads the whole log as new');
    });
});

describe('rules 2–4 — what the entries after the line amount to', () => {
    test('slow saves and errors are counted apart (rule 4)', () => {
        const s = summariseNewEntries([entry(SLOW), entry('TypeError: x is undefined'), entry(SLOW)]);
        assert.deepEqual(s, { errors: 1, slowSaves: 2, more: false, examined: 3 });
    });

    test('a RESOLVED entry is not counted, and is still examined — so the line moves past it (rule 3)', () => {
        const s = summariseNewEntries([entry('boom', { resolved: true }), entry(SLOW, { resolved: true }), entry('bang')]);
        assert.deepEqual(s, { errors: 1, slowSaves: 0, more: false, examined: 3 });
    });

    test('an entry with no readable message is an error, never dropped', () => {
        assert.deepEqual(summariseNewEntries([entry(/** @type {any} */ (undefined))]), { errors: 1, slowSaves: 0, more: false, examined: 1 });
    });

    test('nothing after the line: nothing to count', () => {
        for (const none of [[], undefined, null]) {
            assert.deepEqual(summariseNewEntries(/** @type {any} */ (none)), { errors: 0, slowSaves: 0, more: false, examined: 0 });
        }
    });

    test('one more than the limit PROVES "more than", and the notice covers exactly the limit', () => {
        const flood = Array.from({ length: NOTICE_SCAN_LIMIT + 1 }, () => entry('boom'));
        const s = summariseNewEntries(flood);
        assert.equal(s.more, true);
        assert.equal(s.examined, NOTICE_SCAN_LIMIT, 'the line moves to the last entry this notice covers, never past one it did not');
        assert.equal(summariseNewEntries(flood.slice(0, NOTICE_SCAN_LIMIT)).more, false, 'exactly the limit is not "more than"');
    });
});

describe('rules 4–5 — the words: counts, and nothing a lock screen should not show', () => {
    test('one error, one slow save, and both together', () => {
        assert.deepEqual(noticeWords({ errors: 1, slowSaves: 0, more: false }),
            { headline: 'Error Log — 1 new', body: '1 error. Tap to open the Error Log.' });
        assert.deepEqual(noticeWords({ errors: 0, slowSaves: 1, more: false }),
            { headline: 'Error Log — 1 new', body: '1 slow save. Tap to open the Error Log.' });
        assert.deepEqual(noticeWords({ errors: 2, slowSaves: 3, more: false }),
            { headline: 'Error Log — 5 new', body: '2 errors and 3 slow saves. Tap to open the Error Log.' });
    });

    test('nothing to tell says nothing', () => {
        assert.equal(noticeWords({ errors: 0, slowSaves: 0, more: false }), null);
    });

    test('a flood says so, without a split of part of it', () => {
        assert.deepEqual(noticeWords({ errors: 60, slowSaves: 40, more: true }),
            { headline: `Error Log — ${NOTICE_SCAN_LIMIT}+ new`, body: `More than ${NOTICE_SCAN_LIMIT} new entries. Tap to open the Error Log.` });
    });

    test('from the entries to the payload, no name, page or message reaches the notice (rule 5)', () => {
        const entries = [
            entry('TypeError: cannot read memberName of K. Jedlinski', { memberName: 'K. Jedlinski', page: 'paycalc.html' }),
            entry(`${SLOW} · A. Hared's week`, { memberName: 'A. Hared' }),
        ];
        const words = noticeWords(summariseNewEntries(entries));
        assert.ok(words);
        const payload = buildPushPayload({ feature: 'errorLog', ...words, url: 'https://myb-roster.web.app/operations.html#error-log' });
        const shown = JSON.stringify(payload);
        for (const secret of ['Jedlinski', 'Hared', 'paycalc', 'TypeError', 'memberName', 'took 8.1s']) {
            assert.ok(!shown.includes(secret), `"${secret}" reached the notification: ${shown}`);
        }
    });

    test('through the REAL builder: the feature emoji leads, and the worst case fits the budgets untouched', () => {
        const worst = noticeWords({ errors: 50, slowSaves: 49, more: false });
        assert.ok(worst);
        const p = buildPushPayload({ feature: 'errorLog', ...worst, url: 'https://myb-roster.web.app/operations.html#error-log' });
        assert.equal(p.title, '🐛 Error Log — 99 new');
        assert.equal(p.body, '50 errors and 49 slow saves. Tap to open the Error Log.');
        assert.equal(p.tag, 'error-log');
        assert.ok(!p.title.endsWith('…') && !p.body.endsWith('…'), 'clipped: the words outgrew the budgets');
        const flood = noticeWords({ errors: 0, slowSaves: 0, more: true });
        assert.ok(flood);
        const f = buildPushPayload({ feature: 'errorLog', ...flood, url: 'https://myb-roster.web.app/operations.html#error-log' });
        assert.ok(!f.title.endsWith('…') && !f.body.endsWith('…'), 'the flood notice was clipped');
    });
});

describe('the parts it shares with the rest of the app', () => {
    test('a slow save is spelt as the client spells it (client-errors.js)', () => {
        assert.equal(DIAGNOSTIC_PREFIX, CLIENT_DIAGNOSTIC_PREFIX,
            'the server counts slow saves by the prefix the reporter writes: two spellings would count every slow save as an error');
        assert.equal(isSlowSave(SLOW), true);
        assert.equal(isSlowSave('Slow saves are fine'), false);
        assert.equal(isSlowSave(/** @type {any} */ (null)), false);
    });

    test('its row in the one table: 🐛, its own tag, the url passed at the call, the words composed here', () => {
        const row = NOTIFICATION_FEATURES.errorLog;
        assert.equal(row.emoji, '🐛', 'the Error Log\'s own emoji, on the Operations strip');
        assert.equal(row.tag, 'error-log');
        assert.equal('hashPath' in row, false, 'the url is passed at the call (sw-asset-check finds it there)');
        assert.equal('defaultHeadline' in row, false, 'the headline carries a count, composed by noticeWords');
    });

    test('the table moved, and its old home still hands every sender the same builder (v26.04)', () => {
        const old = require('./functions/roster-parse-helpers.js');
        assert.equal(old.buildPushPayload, buildPushPayload);
        assert.equal(old.NOTIFICATION_FEATURES, NOTIFICATION_FEATURES);
    });
});
