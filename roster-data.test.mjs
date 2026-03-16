/**
 * Unit tests for roster-data.js utility functions.
 * Run with: node --test roster-data.test.mjs
 *
 * Uses Node's built-in test runner (no dependencies required).
 * Covers: bank holidays, Easter, paydays, cutoffs, AL entitlement, validation.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    getBankHolidays,
    isBankHoliday,
    isChristmasDay,
    isEasterSunday,
    getPaydaysAndCutoffs,
    isPayday,
    isCutoffDate,
    getALEntitlement,
    validateRosterPatterns,
} from './roster-data.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a local-noon Date to match the app's DST-safe convention. */
const d = (year, month, day) => new Date(year, month - 1, day, 12, 0, 0);

// ---------------------------------------------------------------------------
// Bank holidays
// ---------------------------------------------------------------------------

test('getBankHolidays: returns 8 bank holidays for 2026', () => {
    // England has exactly 8 fixed bank holidays in a standard year.
    assert.equal(getBankHolidays(2026).length, 8);
});

test('getBankHolidays: New Year\'s Day 2026 is 1 Jan (weekday — no substitute)', () => {
    // 1 Jan 2026 is a Thursday.
    const bhs = getBankHolidays(2026);
    const newYear = bhs.find(h => h.getMonth() === 0);
    assert.ok(newYear, 'New Year\'s Day not found');
    assert.equal(newYear.getDate(), 1);
});

test('getBankHolidays: Good Friday 2026 is 3 Apr', () => {
    // Easter Sunday 2026 = 5 Apr → Good Friday = 3 Apr.
    const bhs = getBankHolidays(2026);
    const gf = bhs.find(h => h.getMonth() === 3 && h.getDate() === 3);
    assert.ok(gf, 'Good Friday 3 Apr 2026 not found in bank holidays');
});

test('getBankHolidays: Easter Monday 2026 is 6 Apr', () => {
    const bhs = getBankHolidays(2026);
    const em = bhs.find(h => h.getMonth() === 3 && h.getDate() === 6);
    assert.ok(em, 'Easter Monday 6 Apr 2026 not found in bank holidays');
});

test('getBankHolidays: Summer Bank Holiday 2026 is 31 Aug (last Monday in August)', () => {
    // Aug 31 2026 is a Monday.
    const bhs = getBankHolidays(2026);
    const sbh = bhs.find(h => h.getMonth() === 7);
    assert.ok(sbh, 'Summer Bank Holiday not found');
    assert.equal(sbh.getDate(), 31);
});

test('getBankHolidays: returns empty array for year below MIN_YEAR', () => {
    assert.deepEqual(getBankHolidays(2023), []);
});

test('isBankHoliday: 3 Apr 2026 (Good Friday) is a bank holiday', () => {
    assert.ok(isBankHoliday(d(2026, 4, 3)));
});

test('isBankHoliday: 4 Apr 2026 (Saturday before Easter) is not a bank holiday', () => {
    assert.equal(isBankHoliday(d(2026, 4, 4)), false);
});

// ---------------------------------------------------------------------------
// Christmas and Easter
// ---------------------------------------------------------------------------

test('isChristmasDay: 25 Dec returns true', () => {
    assert.ok(isChristmasDay(d(2026, 12, 25)));
});

test('isChristmasDay: 26 Dec returns false', () => {
    assert.equal(isChristmasDay(d(2026, 12, 26)), false);
});

test('isEasterSunday: 5 Apr 2026 is Easter Sunday', () => {
    assert.ok(isEasterSunday(d(2026, 4, 5)));
});

test('isEasterSunday: 6 Apr 2026 (Easter Monday) is not Easter Sunday', () => {
    assert.equal(isEasterSunday(d(2026, 4, 6)), false);
});

// ---------------------------------------------------------------------------
// Paydays and cutoffs
// ---------------------------------------------------------------------------

test('getPaydaysAndCutoffs: 13 Feb 2026 is a payday (known reference date)', () => {
    // CONFIG.FIRST_PAYDAY = 13 Feb 2026.
    assert.ok(isPayday(d(2026, 2, 13)));
});

test('getPaydaysAndCutoffs: 14 Feb 2026 is not a payday', () => {
    assert.equal(isPayday(d(2026, 2, 14)), false);
});

test('getPaydaysAndCutoffs: cutoff for 13 Feb 2026 payday is 7 Feb (previous Saturday)', () => {
    // 13 Feb is Friday → 6 days back = 7 Feb (Saturday).
    assert.ok(isCutoffDate(d(2026, 2, 7)));
});

test('getPaydaysAndCutoffs: 8 Feb 2026 is not a cutoff date', () => {
    assert.equal(isCutoffDate(d(2026, 2, 8)), false);
});

test('getPaydaysAndCutoffs: returns empty paydays for year below MIN_YEAR', () => {
    const result = getPaydaysAndCutoffs(2023);
    assert.deepEqual(result.paydays, []);
    assert.deepEqual(result.cutoffs, []);
});

// ---------------------------------------------------------------------------
// Annual leave entitlement
// ---------------------------------------------------------------------------

test('getALEntitlement: CEA on main roster gets 32 days', () => {
    assert.equal(getALEntitlement({ role: 'CEA', rosterType: 'main' }), 32);
});

test('getALEntitlement: CES gets 34 days', () => {
    assert.equal(getALEntitlement({ role: 'CES', rosterType: 'ces' }), 34);
});

test('getALEntitlement: Dispatcher gets 34 days', () => {
    assert.equal(getALEntitlement({ role: 'Dispatcher', rosterType: 'dispatcher' }), 34);
});

test('getALEntitlement: fixed roster (C. Reen) gets 34 days', () => {
    assert.equal(getALEntitlement({ role: 'CEA', rosterType: 'fixed' }), 34);
});

test('getALEntitlement: null member returns default 32 days', () => {
    assert.equal(getALEntitlement(null), 32);
});

// ---------------------------------------------------------------------------
// Roster pattern validation
// ---------------------------------------------------------------------------

test('validateRosterPatterns: all roster patterns are valid (returns 0 errors)', () => {
    assert.equal(validateRosterPatterns(), 0);
});
