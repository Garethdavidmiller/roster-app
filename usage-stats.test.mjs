// @ts-check
/**
 * Unit tests for usage-stats.js — the pure date-bucketing + aggregation core of the
 * anonymous usage analytics. No DOM, no Firebase, no mocks (runs in test:hygiene).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    monthKey, dayKey, shouldCountMonth, shouldCountRolling,
    recentDayKeys, sumDailyWindow, orderPageCounts, staleDailyKeys,
    ROLLING_WINDOW_DAYS,
} from './usage-stats.js';

const DAY = 86400000;

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
