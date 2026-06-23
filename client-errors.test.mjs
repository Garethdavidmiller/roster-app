/**
 * Unit tests for client-errors.js (pure error-log ordering/retention).
 * Run with: node --test client-errors.test.mjs
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    CLIENT_ERROR_RETENTION_MS,
    isResolvedErrorExpired,
    expiredResolvedIds,
    orderClientErrors,
} from './client-errors.js';

const NOW = 1_700_000_000_000;
/** Build a fake Firestore-Timestamp-shaped object. */
const ts = ms => ({ toMillis: () => ms });
/** A record `daysAgo` old, optionally resolved `resolvedDaysAgo` days ago. */
function rec(id, daysAgo, { resolved = false, resolvedDaysAgo } = {}) {
    const r = { id, resolved, timestamp: ts(NOW - daysAgo * 86_400_000) };
    if (resolvedDaysAgo !== undefined) r.resolvedAt = ts(NOW - resolvedDaysAgo * 86_400_000);
    return r;
}

describe('isResolvedErrorExpired', () => {
    test('unresolved record is never expired', () => {
        assert.equal(isResolvedErrorExpired(rec('a', 200, { resolved: false }), NOW), false);
    });
    test('resolved <90 days ago is not expired', () => {
        assert.equal(isResolvedErrorExpired(rec('a', 200, { resolved: true, resolvedDaysAgo: 89 }), NOW), false);
    });
    test('resolved >90 days ago is expired', () => {
        assert.equal(isResolvedErrorExpired(rec('a', 200, { resolved: true, resolvedDaysAgo: 91 }), NOW), true);
    });
    test('resolved with NO resolvedAt is never expired (left alone)', () => {
        assert.equal(isResolvedErrorExpired({ id: 'a', resolved: true, timestamp: ts(NOW - 200 * 86_400_000) }, NOW), false);
    });
    test('retention is measured from resolution, not the error time', () => {
        // Error is 200 days old but was only resolved 10 days ago → keep.
        assert.equal(isResolvedErrorExpired(rec('a', 200, { resolved: true, resolvedDaysAgo: 10 }), NOW), false);
    });
});

describe('expiredResolvedIds', () => {
    test('returns only ids resolved past the window', () => {
        const resolved = [
            rec('keep', 200, { resolved: true, resolvedDaysAgo: 30 }),
            rec('drop', 200, { resolved: true, resolvedDaysAgo: 120 }),
            { id: 'nostamp', resolved: true, timestamp: ts(NOW - 300 * 86_400_000) }, // no resolvedAt
        ];
        assert.deepEqual(expiredResolvedIds(resolved, NOW), ['drop']);
    });
});

describe('orderClientErrors', () => {
    test('every unresolved record comes before any resolved record', () => {
        const unresolved = [rec('u-old', 50), rec('u-new', 1)];
        const resolved   = [rec('r-new', 2, { resolved: true, resolvedDaysAgo: 1 })];
        const out = orderClientErrors(unresolved, resolved, NOW);
        assert.deepEqual(out.map(e => e.id), ['u-new', 'u-old', 'r-new']);
    });
    test('a backlog of resolved records can never hide an old unresolved one', () => {
        const unresolved = [rec('u-ancient', 365)];
        const resolved   = Array.from({ length: 50 }, (_, i) => rec(`r${i}`, i, { resolved: true, resolvedDaysAgo: 1 }));
        const out = orderClientErrors(unresolved, resolved, NOW);
        assert.equal(out[0].id, 'u-ancient', 'the unresolved record must be first, not buried');
    });
    test('expired resolved records are excluded from the output', () => {
        const resolved = [
            rec('fresh', 5, { resolved: true, resolvedDaysAgo: 5 }),
            rec('stale', 5, { resolved: true, resolvedDaysAgo: 200 }),
        ];
        const out = orderClientErrors([], resolved, NOW);
        assert.deepEqual(out.map(e => e.id), ['fresh']);
    });
    test('resolved list is capped by resolvedLimit', () => {
        const resolved = Array.from({ length: 40 }, (_, i) => rec(`r${i}`, i, { resolved: true, resolvedDaysAgo: 1 }));
        const out = orderClientErrors([], resolved, NOW, { resolvedLimit: 10 });
        assert.equal(out.length, 10);
    });
    test('records sort newest-first within each group', () => {
        const out = orderClientErrors([rec('a', 9), rec('b', 1), rec('c', 5)], [], NOW);
        assert.deepEqual(out.map(e => e.id), ['b', 'c', 'a']);
    });
    test('retention window constant is 90 days', () => {
        assert.equal(CLIENT_ERROR_RETENTION_MS, 90 * 24 * 60 * 60 * 1000);
    });
});
