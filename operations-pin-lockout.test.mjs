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
import { readLockout, lockoutWords, lockoutCount } from './operations-pin-lockout.js';
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
    test('running: until when, in London time; that passwords still work; what to do if it repeats', () => {
        const { text, fix } = lockoutWords({ active: true, blockedUntil: NOW + 10 * MIN, lastBlockedAt: NOW - 5 * MIN, blocks: 1 }, NOW);
        assert.equal(text, 'The staff PIN is blocked for everyone until 14:20 — too many wrong entries.');
        assert.match(fix, /reopens by itself/);
        assert.match(fix, /sign in with their password/);
        assert.match(fix, /consider changing the PIN/);
    });

    test('ended: since when, and how many times', () => {
        const { text } = lockoutWords({ active: false, blockedUntil: NOW - 30 * MIN, lastBlockedAt: NOW - 45 * MIN, blocks: 3 }, NOW);
        assert.equal(text, 'The staff PIN was blocked for everyone 3 times in the last day, most recently from 13:25 — too many wrong entries.');
    });

    test('a block begun yesterday says so', () => {
        const { text } = lockoutWords({ active: false, blockedUntil: NOW - 15 * 60 * MIN, lastBlockedAt: NOW - 16 * 60 * MIN, blocks: 1 }, NOW);
        assert.match(text, /most recently from yesterday at 22:10/);
    });

    test('calm: no exclamation mark, and no PIN-shaped number', () => {
        const all = JSON.stringify([
            lockoutWords({ active: true, blockedUntil: NOW + MIN, lastBlockedAt: NOW, blocks: 1 }, NOW),
            lockoutWords({ active: false, blockedUntil: NOW - MIN, lastBlockedAt: NOW - 20 * MIN, blocks: 4 }, NOW),
        ]);
        assert.doesNotMatch(all, /!/);
        assert.doesNotMatch(all.replace(/\d{2}:\d{2}/g, ''), /\b\d{4}\b/);
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
