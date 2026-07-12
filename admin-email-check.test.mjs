// @ts-nocheck
/**
 * admin-email-check.test.mjs — the PURE work-email cadence decision (isEmailCheckDue).
 *
 * The overlay flow itself is DOM + Firebase-coupled; this covers the tricky, error-prone part: the
 * "is a confirmation DUE?" heuristic, including the pre-v14.77 legacy `'1'` done-forever flag / junk
 * value handling and the 3-month interval boundary.
 *
 * firebase-client.js statically imports the gstatic Firebase SDK (unimportable in Node), and session.js
 * imports it, so both are mocked to no-ops purely so admin-email-check.js can be imported here.
 */
import { test, describe, mock } from 'node:test';
import assert from 'node:assert/strict';

// overlay.js (transitively imported) registers a top-level `window` popstate listener, so a minimal
// window stub is needed just to import the module graph. isEmailCheckDue itself touches nothing here.
globalThis.window  = { addEventListener: () => {}, removeEventListener: () => {}, matchMedia: () => ({ matches: false }) };
globalThis.history = { pushState: () => {}, back: () => {} };

mock.module('./firebase-client.js', {
    namedExports: { getStaffContact: async () => null, saveStaffContact: async () => {} },
});
mock.module('./session.js', {
    namedExports: { sessionReady: Promise.resolve(true) },
});

const { isEmailCheckDue, EMAIL_CHECK_INTERVAL_MS } = await import('./admin-email-check.js');

const NOW = 1_700_000_000_000;   // fixed 'now' (Nov 2023) so the tests are deterministic
const DAY = 86_400_000;

describe('isEmailCheckDue', () => {
    test('due when never confirmed (null / empty / undefined stamp)', () => {
        assert.equal(isEmailCheckDue(null, NOW), true);
        assert.equal(isEmailCheckDue('', NOW), true);
        assert.equal(isEmailCheckDue(undefined, NOW), true);
    });

    test("due for the legacy pre-v14.77 '1' done-forever flag and other sub-timestamp junk", () => {
        assert.equal(isEmailCheckDue('1', NOW), true);
        assert.equal(isEmailCheckDue('999999999999', NOW), true);   // < 1e12 → treated as legacy/junk
        assert.equal(isEmailCheckDue('abc', NOW), true);            // NaN parse → due
    });

    test('NOT due within the interval; due at or after it', () => {
        assert.equal(isEmailCheckDue(String(NOW - DAY), NOW), false);                          // 1 day ago
        assert.equal(isEmailCheckDue(String(NOW - EMAIL_CHECK_INTERVAL_MS + 1), NOW), false);  // just under 90d
        assert.equal(isEmailCheckDue(String(NOW - EMAIL_CHECK_INTERVAL_MS), NOW), true);       // exactly 90d (>=)
        assert.equal(isEmailCheckDue(String(NOW - 100 * DAY), NOW), true);                     // 100 days ago
    });

    test('a custom interval is honoured', () => {
        const wk = 7 * DAY;
        assert.equal(isEmailCheckDue(String(NOW - 3 * DAY), NOW, wk), false);
        assert.equal(isEmailCheckDue(String(NOW - 8 * DAY), NOW, wk), true);
    });

    test('EMAIL_CHECK_INTERVAL_MS is 90 days', () => {
        assert.equal(EMAIL_CHECK_INTERVAL_MS, 90 * DAY);
    });
});
