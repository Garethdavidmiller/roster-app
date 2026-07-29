// @ts-check
/**
 * Unit tests for usage-stats.js — the pure date-bucketing + aggregation core of the
 * anonymous usage analytics. No DOM, no Firebase, no mocks (runs in test:hygiene).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    monthKey, prevMonthKey, dayKey, shouldCountMonth, shouldCountRolling,
    recentDayKeys, sumDailyWindow, orderPageCounts, staleDailyKeys,
    ROLLING_WINDOW_DAYS,
    originLabel, originKey, parseOriginKey, summariseOrigins, staleOriginKeys,
} from './usage-stats.js';

const DAY = 86400000;

describe('prevMonthKey', () => {
    test('returns the previous calendar month', () => {
        assert.equal(prevMonthKey(new Date(2026, 5, 30)), '2026-05'); // Jun → May
        assert.equal(prevMonthKey(new Date(2026, 5, 1)),  '2026-05'); // any day of the month
    });
    test('crosses the year boundary (Jan → previous Dec)', () => {
        assert.equal(prevMonthKey(new Date(2026, 0, 15)), '2025-12');
    });
    test('is never equal to this month', () => {
        for (let m = 0; m < 12; m++) {
            const d = new Date(2026, m, 14);
            assert.notEqual(prevMonthKey(d), monthKey(d));
        }
    });
});

describe('monthKey / dayKey', () => {
    test('zero-pads month and day', () => {
        const d = new Date(2026, 0, 5); // 5 Jan 2026 (local)
        assert.equal(monthKey(d), '2026-01');
        assert.equal(dayKey(d), '2026-01-05');
    });
    test('handles a two-digit month/day', () => {
        const d = new Date(2026, 11, 25); // 25 Dec 2026
        assert.equal(monthKey(d), '2026-12');
        assert.equal(dayKey(d), '2026-12-25');
    });
});

describe('shouldCountMonth', () => {
    const now = new Date(2026, 5, 15); // June 2026
    test('true when last counted in a different month', () => {
        assert.equal(shouldCountMonth('2026-05', now), true);
    });
    test('false when already counted this month', () => {
        assert.equal(shouldCountMonth('2026-06', now), false);
    });
    test('true when never counted (null)', () => {
        assert.equal(shouldCountMonth(null, now), true);
    });
});

describe('shouldCountRolling', () => {
    const now = new Date(2026, 5, 15, 12, 0, 0);
    test('true when never counted (0/NaN)', () => {
        assert.equal(shouldCountRolling(0, now), true);
        assert.equal(shouldCountRolling(NaN, now), true);
    });
    test('false when counted within the window', () => {
        assert.equal(shouldCountRolling(now.getTime() - 10 * DAY, now), false);
    });
    test('true when last count is older than the window', () => {
        assert.equal(shouldCountRolling(now.getTime() - 31 * DAY, now), true);
    });
    test('boundary: exactly the window is NOT yet re-counted (strict >)', () => {
        assert.equal(shouldCountRolling(now.getTime() - ROLLING_WINDOW_DAYS * DAY, now), false);
    });
});

describe('recentDayKeys', () => {
    test('returns `days` keys, today first, descending and contiguous', () => {
        const now = new Date(2026, 5, 3); // 3 Jun 2026
        const keys = recentDayKeys(now, 5);
        assert.deepEqual(keys, ['2026-06-03', '2026-06-02', '2026-06-01', '2026-05-31', '2026-05-30']);
    });
    test('defaults to the 30-day window length', () => {
        assert.equal(recentDayKeys(new Date(2026, 5, 15)).length, ROLLING_WINDOW_DAYS);
    });
});

describe('sumDailyWindow', () => {
    const now = new Date(2026, 5, 30); // 30 Jun 2026
    test('sums only buckets inside the window', () => {
        const daily = {
            '2026-06-30': 3,
            '2026-06-15': 2,
            '2026-06-01': 1,
            '2026-05-15': 9, // 46 days ago — outside the 30-day window
        };
        assert.equal(sumDailyWindow(daily, now), 6);
    });
    test('ignores non-numeric / missing values', () => {
        assert.equal(sumDailyWindow({ '2026-06-30': 'x', '2026-06-29': 4 }, now), 4);
    });
    test('empty map sums to 0', () => {
        assert.equal(sumDailyWindow({}, now), 0);
    });
});

describe('orderPageCounts', () => {
    test('sorts by count desc, then page name asc for stability', () => {
        const out = orderPageCounts({ paycalc: 5, admin: 5, calendar: 12, links: 1 });
        assert.deepEqual(out, [
            { page: 'calendar', count: 12 },
            { page: 'admin',    count: 5 },
            { page: 'paycalc',  count: 5 },
            { page: 'links',    count: 1 },
        ]);
    });
    test('coerces values to numbers and tolerates empty input', () => {
        assert.deepEqual(orderPageCounts({ a: '3' }), [{ page: 'a', count: 3 }]);
        assert.deepEqual(orderPageCounts({}), []);
        assert.deepEqual(orderPageCounts(/** @type {any} */ (undefined)), []);
    });
});

describe('staleDailyKeys', () => {
    test('returns keys outside the retention window', () => {
        const now = new Date(2026, 5, 30);
        const daily = {
            '2026-06-30': 1, // today — keep
            '2026-06-01': 1, // 29 days ago — keep
            '2026-04-01': 1, // ~90 days ago — stale
            '2026-05-10': 1, // 51 days ago — stale
        };
        const stale = staleDailyKeys(daily, now).sort();
        assert.deepEqual(stale, ['2026-04-01', '2026-05-10']);
    });
    test('nothing stale when all within retention', () => {
        const now = new Date(2026, 5, 30);
        assert.deepEqual(staleDailyKeys({ '2026-06-30': 1, '2026-06-29': 2 }, now), []);
    });
});

// ── ORIGIN / MIGRATION TRACKING (v19.23) ──────────────────────────────────────
// The point of these counters is to answer "how far through the move off the GitHub Pages mirror
// are we", so the number that matters is UNIQUE ACCOUNTS PER ADDRESS. Everything here defends that:
// a key that cannot be parsed must never be counted as a date, and the installed figure must be a
// subset of the accounts figure rather than a parallel one that could exceed it.
describe('origin labels', () => {
    test('each served address maps to a short stable label', () => {
        assert.equal(originLabel('myb-roster.web.app'), 'web');
        assert.equal(originLabel('garethdavidmiller.github.io'), 'pages');
        assert.equal(originLabel('myb-roster.firebaseapp.com'), 'fb');
    });
    test('anything else is "other" — never a raw hostname', () => {
        // A raw hostname as a Firestore map key would nest on its dots, and would let the key space
        // grow without bound. localhost and a future custom domain both land here until named.
        assert.equal(originLabel('localhost'), 'other');
        assert.equal(originLabel('roster.chilternrailways.co.uk'), 'other');
        assert.equal(originLabel(''), 'other');
        assert.equal(originLabel(undefined), 'other');
    });
    test('matching is case-insensitive and exact — a look-alike host is not "web"', () => {
        assert.equal(originLabel('MYB-Roster.Web.App'), 'web');
        assert.equal(originLabel('evil-myb-roster.web.app.example.com'), 'other');
    });
});

describe('origin keys', () => {
    test('round-trip, with and without the installed marker', () => {
        assert.deepEqual(parseOriginKey(originKey('2026-07-29', 'web')),
            { day: '2026-07-29', origin: 'web', installed: false });
        assert.deepEqual(parseOriginKey(originKey('2026-07-29', 'pages', true)),
            { day: '2026-07-29', origin: 'pages', installed: true });
    });
    test('an unparseable key returns null rather than a bogus date', () => {
        for (const k of ['', 'web', '2026-07-29', 'notadate|web', '2026-7-9|web',
                         '2026-07-29|web|browser', '2026-07-29|web|pwa|extra']) {
            assert.equal(parseOriginKey(k), null, k);
        }
    });
});

describe('summarising the migration picture', () => {
    const NOW = new Date(2026, 6, 29);          // 29 Jul 2026
    const daily = {
        '2026-07-29|web': 12, '2026-07-29|web|pwa': 9,
        '2026-07-28|web': 4,  '2026-07-28|web|pwa': 4,
        '2026-07-29|pages': 5, '2026-07-29|pages|pwa': 5,
        '2026-05-01|web': 999,                   // outside the 30-day window
        'junk-key': 7,                            // must never be counted
    };

    test('sums each address over the window, busiest first', () => {
        assert.deepEqual(summariseOrigins(daily, NOW), [
            { origin: 'web',   accounts: 16, installed: 13 },
            { origin: 'pages', accounts: 5,  installed: 5 },
        ]);
    });
    test('a day outside the window is excluded', () => {
        // 999 would dwarf everything — if the window were ignored the ordering would flip too.
        assert.equal(summariseOrigins(daily, NOW).find(r => r.origin === 'web').accounts, 16);
    });
    test('installed can never exceed accounts for a well-formed day', () => {
        const rows = summariseOrigins(daily, NOW);
        for (const r of rows) assert.ok(r.installed <= r.accounts, `${r.origin}: ${r.installed} > ${r.accounts}`);
    });
    test('empty and missing input are the empty picture, not a crash', () => {
        assert.deepEqual(summariseOrigins({}, NOW), []);
        assert.deepEqual(summariseOrigins(undefined, NOW), []);
    });
});

describe('origin retention', () => {
    const NOW = new Date(2026, 6, 29);
    test('keys past the retention window are swept', () => {
        const daily = { '2026-07-29|web': 1, '2026-05-01|web': 1 };
        assert.deepEqual(staleOriginKeys(daily, NOW), ['2026-05-01|web']);
    });
    test('an unparseable key is swept too — summariseOrigins would ignore it for ever', () => {
        // Otherwise a single malformed writer could grow the doc without bound and nothing would
        // ever remove it, because the reader silently skips exactly the keys it cannot parse.
        assert.deepEqual(staleOriginKeys({ 'junk': 1, '2026-07-29|web': 1 }, NOW), ['junk']);
    });
});
