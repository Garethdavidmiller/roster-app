/**
 * Unit tests for usage-reporter.js — specifically the WRITE-TIME ADMIN EXCLUSION and the recordOpen
 * gate, which keep the developer's own sessions out of the anonymous analytics. The pure maths
 * (shouldCountMonth/shouldCountRolling/monthKey/dayKey) is covered by usage-stats.test.mjs; the
 * reporter's decision layer (WHEN it writes, and that an admin identity writes NOTHING) was not.
 * A regression here silently pollutes staff-usage figures with the developer's test loads.
 *
 * Run: node --experimental-test-module-mocks --test usage-reporter.test.mjs
 */
import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

const _ls = new Map();
/** @type {string[]} */ let _pageViews = [];
/** @type {any[]} */    let _activeAccounts = [];

mock.module('./firebase-client.js', {
    namedExports: {
        recordPageView:     (/** @type {string} */ id) => { _pageViews.push(id); },
        recordActiveAccount: (/** @type {any} */ payload) => { _activeAccounts.push(payload); },
    },
});
mock.module('./ls.js', {
    namedExports: {
        lsGet: (/** @type {string} */ k) => _ls.has(k) ? _ls.get(k) : null,
        lsSet: (/** @type {string} */ k, /** @type {any} */ v) => { _ls.set(k, String(v)); },
    },
});
mock.module('./roster-data.js', {
    namedExports: { CONFIG: { ADMIN_NAMES: ['G. Miller'] } },
});

const { recordUsage, recordOpen } = await import('./usage-reporter.js');

beforeEach(() => { _ls.clear(); _pageViews = []; _activeAccounts = []; });

describe('recordUsage — admin exclusion + page-view/active-account gating', () => {
    test('an ADMIN identity records NOTHING (page view AND active account suppressed)', () => {
        recordUsage('paycalc', 'G. Miller');
        assert.deepEqual(_pageViews, []);
        assert.deepEqual(_activeAccounts, []);
    });

    test('the anonymous calendar with an ADMIN selected member records nothing (identity arg excludes)', () => {
        recordUsage('calendar', null, 'G. Miller');
        assert.deepEqual(_pageViews, []);
    });

    test('a real staff member records a page view AND (first time) an active account', () => {
        recordUsage('paycalc', 'S. Silva');
        assert.deepEqual(_pageViews, ['paycalc']);
        assert.equal(_activeAccounts.length, 1, 'first load this month/window counts the account');
    });

    test('anonymous page view (no member) records the view but NO active account', () => {
        recordUsage('calendar', null);
        assert.deepEqual(_pageViews, ['calendar']);
        assert.deepEqual(_activeAccounts, []);
    });

    test('a second same-day load by the same member does NOT double-count the account', () => {
        recordUsage('paycalc', 'S. Silva');   // first — counts
        recordUsage('paycalc', 'S. Silva');   // same day — deduped
        assert.deepEqual(_pageViews, ['paycalc', 'paycalc'], 'page views always count');
        assert.equal(_activeAccounts.length, 1, 'active account deduped for the window');
    });
});

describe('recordOpen — admin exclusion, no dedup', () => {
    test('an ADMIN identity records no open', () => {
        recordOpen('huddle', 'G. Miller');
        assert.deepEqual(_pageViews, []);
    });
    test('a real staff member records the open', () => {
        recordOpen('huddle', 'S. Silva');
        assert.deepEqual(_pageViews, ['huddle']);
    });
    test('a null identity records anonymously', () => {
        recordOpen('circular', null);
        assert.deepEqual(_pageViews, ['circular']);
    });
    test('every open counts — NO dedup (unlike active accounts)', () => {
        recordOpen('guide-fip', 'S. Silva');
        recordOpen('guide-fip', 'S. Silva');
        assert.deepEqual(_pageViews, ['guide-fip', 'guide-fip']);
    });
});
