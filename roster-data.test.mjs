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
    isChristmasRD,
    isEarlyShift,
    isNightShift,
    getShiftClass,
    getShiftBadge,
    getWeekNumberForDate,
    getRosterForMember,
    getBaseShift,
    isSameDay,
    teamMembers,
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

// ---------------------------------------------------------------------------
// Annual leave entitlement — edge cases
// ---------------------------------------------------------------------------

test('getALEntitlement: bilingual roster CEA gets 32 days', () => {
    assert.equal(getALEntitlement({ role: 'CEA', rosterType: 'bilingual' }), 32);
});

test('getALEntitlement: hidden member still returns correct entitlement', () => {
    assert.equal(getALEntitlement({ role: 'CEA', rosterType: 'main', hidden: true }), 32);
});

// ---------------------------------------------------------------------------
// isChristmasRD
// ---------------------------------------------------------------------------

test('isChristmasRD: 25 Dec is always a rest day', () => {
    assert.ok(isChristmasRD(d(2026, 12, 25)));
});

test('isChristmasRD: 26 Dec is a rest day (can be overridden to RDW via Firestore)', () => {
    assert.ok(isChristmasRD(d(2026, 12, 26)));
});

test('isChristmasRD: 27 Dec is not a Christmas rest day', () => {
    assert.equal(isChristmasRD(d(2026, 12, 27)), false);
});

test('isChristmasRD: 24 Dec is not a Christmas rest day', () => {
    assert.equal(isChristmasRD(d(2026, 12, 24)), false);
});

// ---------------------------------------------------------------------------
// Shift classification — isEarlyShift, isNightShift, getShiftClass
// ---------------------------------------------------------------------------

test('isEarlyShift: 04:00-12:00 is an early shift', () => {
    assert.ok(isEarlyShift('04:00-12:00'));
});

test('isEarlyShift: 06:30-14:30 is an early shift', () => {
    assert.ok(isEarlyShift('06:30-14:30'));
});

test('isEarlyShift: 11:00-19:00 is not an early shift (starts at threshold)', () => {
    assert.equal(isEarlyShift('11:00-19:00'), false);
});

test('isNightShift: 21:00-05:00 is a night shift', () => {
    assert.ok(isNightShift('21:00-05:00'));
});

test('isNightShift: 23:30-07:30 is a night shift', () => {
    assert.ok(isNightShift('23:30-07:30'));
});

test('isNightShift: 14:00-22:00 is not a night shift', () => {
    assert.equal(isNightShift('14:00-22:00'), false);
});

test('getShiftClass: early shift returns "early-shift"', () => {
    assert.equal(getShiftClass('06:00-14:00'), 'early-shift');
});

test('getShiftClass: night shift returns "night-shift"', () => {
    assert.equal(getShiftClass('22:00-06:00'), 'night-shift');
});

test('getShiftClass: late shift returns "late-shift"', () => {
    assert.equal(getShiftClass('14:00-22:00'), 'late-shift');
});

// ---------------------------------------------------------------------------
// getShiftBadge
// ---------------------------------------------------------------------------

test('getShiftBadge: RD returns rest badge', () => {
    const badge = getShiftBadge('RD');
    assert.ok(badge.includes('🏠'), `Expected 🏠 in "${badge}"`);
});

test('getShiftBadge: AL returns annual leave badge', () => {
    const badge = getShiftBadge('AL');
    assert.ok(badge.includes('🏖️'), `Expected 🏖️ in "${badge}"`);
});

test('getShiftBadge: SPARE returns spare badge', () => {
    const badge = getShiftBadge('SPARE');
    assert.ok(badge.includes('📋'), `Expected 📋 in "${badge}"`);
});

test('getShiftBadge: RDW returns RDW badge', () => {
    const badge = getShiftBadge('RDW');
    assert.ok(badge.includes('💼'), `Expected 💼 in "${badge}"`);
});

test('getShiftBadge: early worked shift shows early badge', () => {
    const badge = getShiftBadge('06:00-14:00');
    assert.ok(badge.includes('☀️') && badge.includes('Early'), `Expected early badge in "${badge}"`);
});

// ---------------------------------------------------------------------------
// isSameDay
// ---------------------------------------------------------------------------

test('isSameDay: same date returns true', () => {
    assert.ok(isSameDay(d(2026, 6, 15), d(2026, 6, 15)));
});

test('isSameDay: different dates return false', () => {
    assert.equal(isSameDay(d(2026, 6, 15), d(2026, 6, 16)), false);
});

test('isSameDay: same day different times return true', () => {
    assert.ok(isSameDay(new Date(2026, 5, 15, 0, 0), new Date(2026, 5, 15, 23, 59)));
});

// ---------------------------------------------------------------------------
// getRosterForMember
// ---------------------------------------------------------------------------

test('getRosterForMember: main roster member returns weeklyRoster', () => {
    const member = teamMembers.find(m => m.rosterType === 'main');
    assert.ok(member, 'No main roster member found in teamMembers');
    const roster = getRosterForMember(member);
    assert.ok(roster, 'getRosterForMember returned falsy');
    assert.ok(roster.data, 'Roster has no data property');
});

test('getRosterForMember: fixed roster member returns fixedRoster', () => {
    const member = teamMembers.find(m => m.rosterType === 'fixed');
    assert.ok(member, 'No fixed roster member found in teamMembers');
    const roster = getRosterForMember(member);
    assert.ok(roster, 'getRosterForMember returned falsy');
});

// ---------------------------------------------------------------------------
// getWeekNumberForDate
// ---------------------------------------------------------------------------

test('getWeekNumberForDate: returns a number between 1 and roster cycle length', () => {
    const member = teamMembers.find(m => m.rosterType === 'main');
    assert.ok(member, 'No main roster member found');
    const week = getWeekNumberForDate(d(2026, 3, 17), member);
    assert.ok(typeof week === 'number', 'Expected a number');
    assert.ok(week >= 1 && week <= 20, `Week ${week} out of range for 20-week main roster`);
});

// ---------------------------------------------------------------------------
// getBaseShift
// ---------------------------------------------------------------------------

test('getBaseShift: returns a string for a known member on a weekday', () => {
    const member = teamMembers.find(m => m.rosterType === 'main' && !m.hidden);
    assert.ok(member, 'No visible main roster member found');
    // Any Monday in 2026 — use a stable date
    const shift = getBaseShift(member, d(2026, 3, 16)); // Mon 16 Mar 2026
    assert.ok(typeof shift === 'string' && shift.length > 0, `Expected shift string, got "${shift}"`);
});

test('getBaseShift: fixed-roster member on a weekend returns RD', () => {
    const member = teamMembers.find(m => m.rosterType === 'fixed');
    assert.ok(member, 'No fixed roster member found');
    // Fixed roster is Mon–Fri; Saturday should be RD
    const shift = getBaseShift(member, d(2026, 3, 14)); // Sat 14 Mar 2026
    assert.equal(shift, 'RD');
});
