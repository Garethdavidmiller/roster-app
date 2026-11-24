// @ts-check
/**
 * operations-pin-lockout.test.mjs — the staff PIN's station-wide block as Operations reads and words it
 * (operations-pin-lockout.js), and the strip wiring it feeds (operations-attention.js →
 * `reportLoginAccounts`). Run: node scripts/run-tests.mjs operations-pin-lockout.test.mjs (test:hygiene).
 *
 * The property that is easy to lose is the third state: ABSENT is unknown — an older server, or a record
 * it could not read — and must never become "no block". The card wiring is admin-auth.test.mjs's.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readLockout, lockoutWords, lockoutCount, lockoutChangesAt } from './operations-pin-lockout.js';
import { reportLoginAccounts, withdrawLoginAccounts, buildAttentionItems } from './operations-attention.js';

const MIN = 60_000;
const NOW = Date.UTC(2026, 10, 16, 14, 10);          // 14:10 London (GMT)

describe('readLockout — three states, and unknown is not none', () => {
    test('absent or malformed is UNKNOWN; null is none', () => {
        for (const raw of [undefined, 'x', 7, true]) assert.equal(readLockout(raw, NOW), undefined, String(raw));
        assert.equal(readLockout(null, NOW), null);
    });

    test('a running block, and one that ended within the day, are kept', () => {
        const running = readLockout({ active: true, blockedUntil: NOW + 10 * MIN, lastBlockedAt: NOW - 5 * MIN, blocks: 2 }, NOW);
        assert.deepEqual(running, { active: true, blockedUntil: NOW + 10 * MIN, lastBlockedAt: NOW - 5 * MIN, blocks: 2 });
        const ended = readLockout({ active: true, blockedUntil: NOW - MIN, lastBlockedAt: NOW - 16 * MIN, blocks: 1 }, NOW);
        assert.equal(ended?.active, false, 'the page decides "running" by its own clock as well as the server\'s');
    });

    test('a day after the last block, a page left open stops saying it', () => {
        assert.equal(readLockout({ active: false, blockedUntil: NOW - 23 * 60 * MIN, lastBlockedAt: NOW - 24 * 60 * MIN, blocks: 1 }, NOW), null);
    });
});

describe('lockoutWords — what happened, and what the admin can do', () => {
    // THE PIN IS RETIRED (23 Nov 2026): nothing reads it, so the advice is that nothing needs doing — never to
    // change it (OPERATIONS_REFERENCE.md → "Until the server release"). The card and the tip say the same.
    test('running: until when, in London time; that nobody needs the retired PIN; never to change it', async () => {
        const { text, fix } = lockoutWords({ active: true, blockedUntil: NOW + 10 * MIN, lastBlockedAt: NOW - 5 * MIN, blocks: 1 }, NOW);
        assert.equal(text, 'The staff PIN is blocked for everyone until 14:20 — too many wrong entries.');
        assert.equal(fix, 'Nothing to do: it reopens by itself. The staff PIN is retired, so nobody needs it — members sign in with their own password — and there is no need to change it. The next server release removes it.');
        assert.doesNotMatch(fix, /consider changing/i, 'the card still tells the admin to change a PIN nothing reads');
        const { CARD_TIPS } = await import('./operations-tips.js');
        const tip = CARD_TIPS['staff-login'].sections.flatMap((/** @type {any} */ s) => s.items).find((/** @type {any} */ i) => /staff PIN/.test(i.html));
        assert.ok(tip?.html.endsWith(fix), 'the Staff Login Accounts tip no longer gives the card\'s advice');
    });

    test('ended: since when, and how many times', () => {
        const { text } = lockoutWords({ active: false, blockedUntil: NOW - 30 * MIN, lastBlockedAt: NOW - 45 * MIN, blocks: 3 }, NOW);
        assert.equal(text, 'The staff PIN was blocked for everyone 3 times in the last day, most recently from 13:25 — too many wrong entries.');
    });

    test('ONE block that has ended is given its start and its end — "most recently" is for several', () => {
        const { text } = lockoutWords({ active: false, blockedUntil: NOW - 30 * MIN, lastBlockedAt: NOW - 45 * MIN, blocks: 1 }, NOW);
        assert.equal(text, 'The staff PIN was blocked for everyone from 13:25 to 13:40 — too many wrong entries.');
    });

    test('one lifted EARLY (its end the same as its start) is given its start, and no end it never reached', () => {
        // The server's shape for a block a right PIN's refund lifted before its fifteen minutes were up
        // (lockoutSummary, functions/calendar-viewer-auth.js, 18 Nov 2026): when it lifted is kept nowhere.
        const l = readLockout({ active: false, blockedUntil: NOW - 15 * MIN, lastBlockedAt: NOW - 15 * MIN, blocks: 1 }, NOW);
        assert.ok(l, 'still news for its day');
        assert.equal(lockoutWords(/** @type {any} */ (l), NOW).text, 'The staff PIN was blocked for everyone at 13:55 — too many wrong entries.');
    });

    test('a block begun yesterday says so', () => {
        const began = NOW - 16 * 60 * MIN;                       // 22:10 yesterday, for fifteen minutes
        const { text } = lockoutWords({ active: false, blockedUntil: began + 15 * MIN, lastBlockedAt: began, blocks: 1 }, NOW);
        assert.match(text, /from yesterday at 22:10 to yesterday at 22:25/);
        const several = lockoutWords({ active: false, blockedUntil: began + 15 * MIN, lastBlockedAt: began, blocks: 2 }, NOW);
        assert.match(several.text, /most recently from yesterday at 22:10/);
    });

    // A BLOCK THAT RUNS PAST MIDNIGHT (whole-app check, 17 Nov 2026). It lasts fifteen minutes, so one that
    // starts at 23:50 ends at 00:05 — and only the past had words: the end read "yesterday at 00:05".
    test('a running block that ends after midnight ends TOMORROW — in winter and in summer time', () => {
        const winter = Date.UTC(2026, 10, 17, 23, 50);           // 23:50 GMT
        assert.equal(lockoutWords({ active: true, blockedUntil: winter + 15 * MIN, lastBlockedAt: winter, blocks: 1 }, winter + MIN).text,
            'The staff PIN is blocked for everyone until tomorrow at 00:05 — too many wrong entries.');
        const summer = Date.UTC(2026, 6, 1, 22, 50);             // 23:50 BST
        assert.match(lockoutWords({ active: true, blockedUntil: summer + 15 * MIN, lastBlockedAt: summer, blocks: 2 }, summer + MIN).text,
            /until tomorrow at 00:05 — too many wrong entries, 2 times in the last day\.$/);
        assert.match(lockoutWords({ active: false, blockedUntil: winter + 15 * MIN, lastBlockedAt: winter, blocks: 1 }, winter + 60 * MIN).text,
            /from yesterday at 23:50 to 00:05/, 'read after midnight, the start is yesterday and the end today');
    });

    test('calm: no exclamation mark, and no PIN-shaped number', () => {
        const all = JSON.stringify([
            lockoutWords({ active: true, blockedUntil: NOW + MIN, lastBlockedAt: NOW, blocks: 1 }, NOW),
            lockoutWords({ active: false, blockedUntil: NOW - MIN, lastBlockedAt: NOW - 20 * MIN, blocks: 4 }, NOW),
            lockoutWords({ active: false, blockedUntil: NOW - MIN, lastBlockedAt: NOW - 16 * MIN, blocks: 1 }, NOW),
            lockoutWords({ active: true, blockedUntil: Date.UTC(2026, 10, 17, 0, 5), lastBlockedAt: Date.UTC(2026, 10, 16, 23, 50), blocks: 1 }, Date.UTC(2026, 10, 16, 23, 51)),
        ]);
        assert.doesNotMatch(all, /!/);
        assert.doesNotMatch(all.replace(/\d{2}:\d{2}/g, ''), /\b\d{4}\b/);
    });
});

// ── WHEN THE WORDS CHANGE BY THE CLOCK ALONE (whole-app check, 17 Nov 2026) ─────────────────────────
// The card judged the block once, as the answer came, so a line drawn during a block went on saying
// "blocked until 14:20" at 15:00. `lockoutChangesAt` is when the card must draw it again.
describe('lockoutChangesAt — the next moment the line would say something else', () => {
    test('a running block: when it ends', () => {
        const l = readLockout({ active: true, blockedUntil: NOW + 10 * MIN, lastBlockedAt: NOW - 5 * MIN, blocks: 1 }, NOW);
        assert.equal(lockoutChangesAt(l, NOW), NOW + 10 * MIN);
        // …after which it reads as ENDED, still counted for the day.
        const after = readLockout({ active: true, blockedUntil: NOW + 10 * MIN, lastBlockedAt: NOW - 5 * MIN, blocks: 1 }, NOW + 10 * MIN);
        assert.equal(after?.active, false);
        assert.equal(lockoutCount(after), 1);
    });

    test('an ended block: London midnight (its times become "yesterday"), then a day after it began', () => {
        const ended = readLockout({ active: false, blockedUntil: NOW - 30 * MIN, lastBlockedAt: NOW - 45 * MIN, blocks: 1 }, NOW);
        assert.equal(lockoutChangesAt(ended, NOW), Date.UTC(2026, 10, 17), 'midnight GMT comes first');
        const tomorrow = Date.UTC(2026, 10, 17, 9);
        const later = readLockout({ active: false, blockedUntil: NOW - 30 * MIN, lastBlockedAt: NOW - 45 * MIN, blocks: 1 }, tomorrow);
        assert.equal(lockoutChangesAt(later, tomorrow), NOW - 45 * MIN + 24 * 60 * MIN, 'then the day runs out');
        assert.equal(readLockout({ active: false, blockedUntil: NOW - 30 * MIN, lastBlockedAt: NOW - 45 * MIN, blocks: 1 }, NOW - 45 * MIN + 24 * 60 * MIN), null,
            '— and the line goes');
    });

    test('in summer time, midnight is the hour before midnight UTC', () => {
        const at = Date.UTC(2026, 6, 1, 12);
        const l = readLockout({ active: false, blockedUntil: at - 30 * MIN, lastBlockedAt: at - 45 * MIN, blocks: 1 }, at);
        assert.equal(lockoutChangesAt(l, at), Date.UTC(2026, 6, 1, 23));
    });

    test('none and unknown: nothing to wait for — and a time is always after now', () => {
        assert.equal(lockoutChangesAt(null, NOW), null);
        assert.equal(lockoutChangesAt(undefined, NOW), null);
        const l = readLockout({ active: true, blockedUntil: NOW + MIN, lastBlockedAt: NOW, blocks: 1 }, NOW);
        assert.ok(/** @type {number} */ (lockoutChangesAt(l, NOW)) > NOW);
    });
});

describe('the strip: one report for the card\'s three items, and a withdraw for unknown', () => {
    /** A strip that records every call. */
    const recorder = () => {
        /** @type {string[]} */ const calls = [];
        return { calls, report: (/** @type {string} */ id, /** @type {number} */ n) => calls.push(`report ${id} ${n}`),
            withdraw: (/** @type {string} */ id) => calls.push(`withdraw ${id}`) };
    };

    test('a known count is reported; an UNKNOWN one is withdrawn, never reported as zero', () => {
        const a = recorder();
        reportLoginAccounts(a, { setUp: 1, leavers: 0, pinLockout: lockoutCount(readLockout(undefined, NOW)) });
        assert.deepEqual(a.calls, ['report accountSetup 1', 'report accountLeavers 0', 'withdraw pinLockout']);
        const b = recorder();
        reportLoginAccounts(b, { setUp: 0, leavers: 0, pinLockout: lockoutCount(readLockout(null, NOW)) });
        assert.deepEqual(b.calls.at(-1), 'report pinLockout 0');
    });

    test('a failed check withdraws all three', () => {
        const r = recorder();
        withdrawLoginAccounts(r);
        assert.deepEqual(r.calls, ['withdraw accountSetup', 'withdraw accountLeavers', 'withdraw pinLockout']);
    });

    test('the item: opens Staff Login Accounts, and its name starts with its pill', () => {
        const [one] = buildAttentionItems({ pinLockout: { count: 1 } });
        assert.equal(one.hash, '#login-accounts');
        assert.equal(one.text, 'Staff PIN blocked: 1 time in the last day');
        assert.equal(buildAttentionItems({ pinLockout: { count: 3 } })[0].text, 'Staff PIN blocked: 3 times in the last day');
        assert.deepEqual(buildAttentionItems({ pinLockout: { count: 0 } }), [], 'none: no item');
    });
});

// ── ONE DAY, ON BOTH SIDES (review D8, Nov 2026) ────────────────────────────────────────────────
// The page's `RECENT_MS` and the server's `LOCKOUT_RECENT_MS` are two copies of one window, with
// nothing that held them together: a page whose day ran longer kept a line the server had dropped,
// and a shorter one took down a line the server still sent — the strip's count and the card's line
// then disagreeing. Asked by BEHAVIOUR at the server's own boundary, so either copy moving fails.
test('the page keeps an ended block for exactly the window the server does', async () => {
    const { createRequire } = await import('node:module');
    const { LOCKOUT_RECENT_MS, lockoutSummary } = createRequire(import.meta.url)('./functions/calendar-viewer-auth.js');
    assert.ok(Number.isFinite(LOCKOUT_RECENT_MS) && LOCKOUT_RECENT_MS > 0, 'premise: the server names a window');
    const endedAt = (/** @type {number} */ age) => ({ active: false, blockedUntil: NOW - age + 15 * MIN, lastBlockedAt: NOW - age, blocks: 1 });
    for (const age of [LOCKOUT_RECENT_MS - 1, LOCKOUT_RECENT_MS]) {
        const server = lockoutSummary({ blocks: [NOW - age], blockedUntil: NOW - age + 15 * MIN }, NOW);
        const page = readLockout(endedAt(age), NOW);
        assert.equal(page === null, server === null,
            `a block ${age} ms old: the server ${server ? 'still reports it' : 'has dropped it'}, the page ${page ? 'still shows it' : 'has dropped it'}`);
    }
    assert.ok(readLockout(endedAt(LOCKOUT_RECENT_MS - 1), NOW), 'premise: the boundary was crossed, not missed');
});
