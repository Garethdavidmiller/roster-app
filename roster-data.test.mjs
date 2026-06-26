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
    getShiftKind,
    getShiftClass,
    getShiftBadge,
    getWeekNumberForDate,
    getRosterForMember,
    resolveMemberRoster,
    getBaseShift,
    isSameDay,
    teamMembers,
    computeEaster,
    escapeHtml,
    parseSmartFloat,
    avatarInitials,
    avatarHue,
    getSpecialDayBadges,
    isSunday,
    CONFIG,
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

test('getALEntitlement: Dispatcher base entitlement is 22 days (no BH worked)', () => {
    // Dispatchers earn 22 base days + 1 lieu day per bank holiday actually worked.
    // A member with no valid roster (no currentWeek) works no bank holidays, so returns 22.
    assert.equal(getALEntitlement({ role: 'Dispatcher', rosterType: 'dispatcher' }), 22);
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

// ---------------------------------------------------------------------------
// isChristmasRD
// ---------------------------------------------------------------------------

test('isChristmasRD: 25 Dec is always a rest day', () => {
    assert.ok(isChristmasRD(d(2026, 12, 25)));
});

test('isChristmasRD: 26 Dec is a rest day (can be overridden to RDW via Firestore)', () => {
    assert.ok(isChristmasRD(d(2026, 12, 26)));
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

test('isEarlyShift: 11:00-19:00 is not an early shift (starts at threshold)', () => {
    assert.equal(isEarlyShift('11:00-19:00'), false);
});

test('isNightShift: 21:00-05:00 is a night shift', () => {
    assert.ok(isNightShift('21:00-05:00'));
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
// getShiftKind
// ---------------------------------------------------------------------------

test('getShiftKind: 04:00 start is early (lower boundary)', () => {
    assert.equal(getShiftKind('04:00-12:00'), 'early');
});

test('getShiftKind: 10:59 start is early (upper boundary)', () => {
    assert.equal(getShiftKind('10:59-18:59'), 'early');
});

test('getShiftKind: 11:00 start is late (boundary)', () => {
    assert.equal(getShiftKind('11:00-19:00'), 'late');
});

test('getShiftKind: 20:59 start is late (upper boundary)', () => {
    assert.equal(getShiftKind('20:59-04:59'), 'late');
});

test('getShiftKind: 21:00 start is night (boundary)', () => {
    assert.equal(getShiftKind('21:00-05:00'), 'night');
});

test('getShiftKind: 03:59 start is night (wraps past midnight)', () => {
    assert.equal(getShiftKind('03:59-11:59'), 'night');
});

test('getShiftKind: permanentShift early wins over a late time', () => {
    assert.equal(getShiftKind('14:30-22:30', { permanentShift: 'early' }), 'early');
});

test('getShiftKind: permanentShift late wins over an early time', () => {
    assert.equal(getShiftKind('06:00-14:00', { permanentShift: 'late' }), 'late');
});

test('getShiftKind: member without permanentShift falls back to time-based', () => {
    assert.equal(getShiftKind('06:00-14:00', { name: 'X' }), 'early');
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
    assert.equal(roster.type, 'main', 'Roster type should be main');
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

// Pinned exact-value tests.  The reference date for the main roster is
// Sun 8 Feb 2026 (G. Miller on Week 3).  The noon helper avoids DST issues.

test('getWeekNumberForDate: G. Miller on the main reference date (8 Feb 2026) → week 3', () => {
    const miller = teamMembers.find(m => m.name === 'G. Miller');
    assert.ok(miller, 'G. Miller not found');
    assert.equal(getWeekNumberForDate(d(2026, 2, 8), miller), 3);
});

test('getWeekNumberForDate: G. Miller one week after reference (15 Feb 2026) → week 4', () => {
    const miller = teamMembers.find(m => m.name === 'G. Miller');
    assert.ok(miller);
    assert.equal(getWeekNumberForDate(d(2026, 2, 15), miller), 4);
});

test('getWeekNumberForDate: G. Miller one week before reference (1 Feb 2026) → week 2', () => {
    const miller = teamMembers.find(m => m.name === 'G. Miller');
    assert.ok(miller);
    assert.equal(getWeekNumberForDate(d(2026, 2, 1), miller), 2);
});

test('getWeekNumberForDate: G. Miller 8 weeks after reference (5 Apr 2026) → week 11', () => {
    const miller = teamMembers.find(m => m.name === 'G. Miller');
    assert.ok(miller);
    assert.equal(getWeekNumberForDate(d(2026, 4, 5), miller), 11);
});

test('getWeekNumberForDate: T. Nsuala (week 20) advances past cycle end → wraps to week 1', () => {
    // T. Nsuala is on week 20 as of the reference date.  One week later she wraps to 1.
    const nsuala = teamMembers.find(m => m.name === 'T. Nsuala');
    assert.ok(nsuala, 'T. Nsuala not found');
    assert.equal(getWeekNumberForDate(d(2026, 2, 8),  nsuala), 20); // on reference date
    assert.equal(getWeekNumberForDate(d(2026, 2, 15), nsuala),  1); // wraps
});

test('getWeekNumberForDate: L. Springer (week 1) goes back before reference → wraps to week 20', () => {
    const springer = teamMembers.find(m => m.name === 'L. Springer');
    assert.ok(springer, 'L. Springer not found');
    assert.equal(getWeekNumberForDate(d(2026, 2, 8), springer),  1); // on reference date
    assert.equal(getWeekNumberForDate(d(2026, 2, 1), springer), 20); // wraps backward
});

// CES roster — separate reference date (Sun 15 Feb 2026, F. Mohamed on CES Week 1)

test('getWeekNumberForDate: F. Mohamed on CES reference date (15 Feb 2026) → week 1', () => {
    const mohamed = teamMembers.find(m => m.name === 'F. Mohamed');
    assert.ok(mohamed, 'F. Mohamed not found');
    assert.equal(getWeekNumberForDate(d(2026, 2, 15), mohamed), 1);
});

test('getWeekNumberForDate: F. Mohamed one week after CES reference (22 Feb 2026) → week 2', () => {
    const mohamed = teamMembers.find(m => m.name === 'F. Mohamed');
    assert.ok(mohamed);
    assert.equal(getWeekNumberForDate(d(2026, 2, 22), mohamed), 2);
});

test('getWeekNumberForDate: F. Mohamed one week before CES reference (8 Feb 2026) → wraps to week 10', () => {
    // CES cycle is 10 weeks.  Week 1 minus 1 = week 10.
    const mohamed = teamMembers.find(m => m.name === 'F. Mohamed');
    assert.ok(mohamed);
    assert.equal(getWeekNumberForDate(d(2026, 2, 8), mohamed), 10);
});

// ---------------------------------------------------------------------------
// resolveMemberRoster — scheduled roster transitions
// ---------------------------------------------------------------------------

test('resolveMemberRoster: returns member unchanged when no rosterChanges', () => {
    const member = { name: 'X', rosterType: 'main', currentWeek: 3 };
    assert.strictEqual(resolveMemberRoster(member, d(2026, 7, 1)), member);
});

test('resolveMemberRoster: keeps base fields before the first change date', () => {
    const member = {
        name: 'X', rosterType: 'fixed', currentWeek: 1,
        rosterChanges: [{ from: new Date(2026, 6, 1), rosterType: 'ces', currentWeek: 4 }],
    };
    const eff = resolveMemberRoster(member, d(2026, 6, 30)); // 30 Jun — before 1 Jul
    assert.equal(eff.rosterType, 'fixed');
    assert.equal(eff.currentWeek, 1);
});

test('resolveMemberRoster: applies the change on the from date (inclusive)', () => {
    const member = {
        name: 'X', rosterType: 'fixed', currentWeek: 1,
        rosterChanges: [{ from: new Date(2026, 6, 1), rosterType: 'ces', currentWeek: 4 }],
    };
    const eff = resolveMemberRoster(member, d(2026, 7, 1)); // 1 Jul — on the boundary
    assert.equal(eff.rosterType, 'ces');
    assert.equal(eff.currentWeek, 4);
});

// ---------------------------------------------------------------------------
// B. Khalil — real new-starter transition (fixed → CES on 1 Jul 2026)
// ---------------------------------------------------------------------------

test('B. Khalil: RD before his 9 Jun 2026 start date', () => {
    const k = teamMembers.find(m => m.name === 'B. Khalil');
    assert.ok(k, 'B. Khalil not found in teamMembers');
    assert.equal(getBaseShift(k, d(2026, 6, 8)), 'RD'); // 8 Jun — day before start
});

test('B. Khalil: fixed 12:00-19:00 on a June weekday', () => {
    const k = teamMembers.find(m => m.name === 'B. Khalil');
    assert.equal(getBaseShift(k, d(2026, 6, 9)), '12:00-19:00'); // 9 Jun is a Tuesday
});

test('B. Khalil: rests at weekends in June', () => {
    const k = teamMembers.find(m => m.name === 'B. Khalil');
    assert.equal(getBaseShift(k, d(2026, 6, 13)), 'RD'); // 13 Jun is a Saturday
});

test('B. Khalil: follows the CES roster from 1 July 2026', () => {
    const k = teamMembers.find(m => m.name === 'B. Khalil');
    assert.equal(getRosterForMember(k, d(2026, 7, 1)).type, 'ces');
    assert.equal(getRosterForMember(k, d(2026, 6, 30)).type, 'fixed');
});

// ---------------------------------------------------------------------------
// getBaseShift
// ---------------------------------------------------------------------------

test('getBaseShift: returns a valid shift for a known member on a weekday', () => {
    const member = teamMembers.find(m => m.rosterType === 'main' && !m.hidden);
    assert.ok(member, 'No visible main roster member found');
    // Any Monday in 2026 — use a stable date
    const shift = getBaseShift(member, d(2026, 3, 16)); // Mon 16 Mar 2026
    assert.ok(
        /^\d{2}:\d{2}-\d{2}:\d{2}$/.test(shift) || ['RD', 'SPARE', 'OFF'].includes(shift),
        `Expected a valid shift string, got "${shift}"`
    );
});

test('getBaseShift: fixed-roster member on a weekend returns RD', () => {
    const member = teamMembers.find(m => m.rosterType === 'fixed');
    assert.ok(member, 'No fixed roster member found');
    // Fixed roster is Mon–Fri; Saturday should be RD
    const shift = getBaseShift(member, d(2026, 3, 14)); // Sat 14 Mar 2026
    assert.equal(shift, 'RD');
});

test('getBaseShift: startDate suppression — returns RD before member joins', () => {
    // M. Okeke has startDate = new Date(2026, 3, 20) = 20 Apr 2026
    const member = teamMembers.find(m => m.name === 'M. Okeke');
    assert.ok(member, 'M. Okeke not found in teamMembers');
    // One day before startDate
    const shiftBefore = getBaseShift(member, d(2026, 4, 19)); // 19 Apr 2026
    assert.equal(shiftBefore, 'RD', 'Expected RD for date before startDate');
    // On startDate itself — should return normal shift (not suppressed)
    const shiftOn = getBaseShift(member, d(2026, 4, 20)); // 20 Apr 2026
    assert.ok(shiftOn !== undefined, 'Expected a value on startDate');
});

// Regression: v13.97 — getBaseShift previously accessed member.startDate without
// a null guard; a null/undefined member would throw TypeError. Sibling helpers
// (getWeekNumberForDate, getRosterForMember, getALEntitlement) all guard !member.
test('getBaseShift: null member returns RD without throwing', () => {
    assert.equal(getBaseShift(null, d(2026, 3, 16)), 'RD');
});

test('getBaseShift: undefined member returns RD without throwing', () => {
    assert.equal(getBaseShift(undefined, d(2026, 3, 16)), 'RD');
});

test('getBaseShift: Christmas Day (Dec 25) always returns RD regardless of roster', () => {
    // isChristmasRD() is applied before base roster lookup — Dec 25 is always RD.
    const member = teamMembers.find(m => m.rosterType === 'main' && !m.hidden);
    assert.ok(member, 'No visible main roster member found');
    assert.equal(getBaseShift(member, d(2026, 12, 25)), 'RD');
});

// ---------------------------------------------------------------------------
// getALEntitlement
// ---------------------------------------------------------------------------

test('getALEntitlement: proRatedAL overrides standard entitlement for the joining year', () => {
    // M. Okeke has proRatedAL: { 2026: 23 }; standard CEA entitlement is 32
    const member = teamMembers.find(m => m.name === 'M. Okeke');
    assert.ok(member, 'M. Okeke not found in teamMembers');
    assert.equal(getALEntitlement(member, 2026), 23, 'Expected pro-rated AL of 23 for joining year');
    assert.equal(getALEntitlement(member, 2027), 32, 'Expected standard CEA AL of 32 from year after joining');
});

// ---------------------------------------------------------------------------
// computeEaster
// ---------------------------------------------------------------------------

test('computeEaster: 2026 Easter Sunday is 5 April', () => {
    const e = computeEaster(2026);
    assert.equal(e.getMonth(), 3);  // April = month index 3
    assert.equal(e.getDate(), 5);
});

test('computeEaster: 2025 Easter Sunday is 20 April', () => {
    const e = computeEaster(2025);
    assert.equal(e.getMonth(), 3);
    assert.equal(e.getDate(), 20);
});

test('computeEaster: 2024 Easter Sunday is 31 March', () => {
    const e = computeEaster(2024);
    assert.equal(e.getMonth(), 2);  // March = month index 2
    assert.equal(e.getDate(), 31);
});

// ---------------------------------------------------------------------------
// escapeHtml
// ---------------------------------------------------------------------------

test('escapeHtml: null returns empty string', () => {
    assert.equal(escapeHtml(null), '');
});

test('escapeHtml: undefined returns empty string', () => {
    assert.equal(escapeHtml(undefined), '');
});

test('escapeHtml: plain string with no special chars is unchanged', () => {
    assert.equal(escapeHtml('Hello world'), 'Hello world');
});

test('escapeHtml: escapes < and >', () => {
    assert.equal(escapeHtml('<b>bold</b>'), '&lt;b&gt;bold&lt;/b&gt;');
});

test('escapeHtml: escapes &', () => {
    assert.equal(escapeHtml('fish & chips'), 'fish &amp; chips');
});

test('escapeHtml: escapes double-quotes', () => {
    assert.equal(escapeHtml('"quoted"'), '&quot;quoted&quot;');
});

test('escapeHtml: escapes all four special chars together', () => {
    assert.equal(escapeHtml('<a href="x">&</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
});

test('escapeHtml: number is coerced to string', () => {
    assert.equal(escapeHtml(42), '42');
});

// ---------------------------------------------------------------------------
// parseSmartFloat
// ---------------------------------------------------------------------------

test('parseSmartFloat: empty/null/undefined returns 0', () => {
    assert.equal(parseSmartFloat(''), 0);
    assert.equal(parseSmartFloat(null), 0);
    assert.equal(parseSmartFloat(undefined), 0);
});

test('parseSmartFloat: plain numeric string parses', () => {
    assert.equal(parseSmartFloat('20.74'), 20.74);
    assert.equal(parseSmartFloat('  21.81 '), 21.81);
});

test('parseSmartFloat: unparseable string returns 0', () => {
    assert.equal(parseSmartFloat('abc'), 0);
});

test('parseSmartFloat: iOS smart minus is normalised so parseFloat succeeds', () => {
    // U+2212 MINUS SIGN — raw parseFloat('−5') returns NaN; the strip fixes it.
    assert.equal(parseSmartFloat('−5'), -5);
});

test('parseSmartFloat: curly quote is stripped before parse', () => {
    // A trailing curly quote must not break an otherwise-valid number.
    assert.equal(parseSmartFloat('20.74’'), 20.74);
});

// ---------------------------------------------------------------------------
// avatarInitials
// ---------------------------------------------------------------------------

test('avatarInitials: null returns "?"', () => {
    assert.equal(avatarInitials(null), '?');
});

test('avatarInitials: empty string returns "?"', () => {
    assert.equal(avatarInitials(''), '?');
});

test('avatarInitials: "G. Miller" → "GM"', () => {
    assert.equal(avatarInitials('G. Miller'), 'GM');
});

test('avatarInitials: "C. Reen" → "CR"', () => {
    assert.equal(avatarInitials('C. Reen'), 'CR');
});

test('avatarInitials: single word uses first letter only', () => {
    assert.equal(avatarInitials('Alice'), 'A');
});

test('avatarInitials: hyphenated surname uses first letter of last token', () => {
    // 'C. Francisco-Charles' → parts = ['C.','Francisco-Charles'], first='C', last='F'
    assert.equal(avatarInitials('C. Francisco-Charles'), 'CF');
});

test('avatarInitials: result is always uppercase', () => {
    const initials = avatarInitials('g. miller');
    assert.equal(initials, initials.toUpperCase());
});

// ---------------------------------------------------------------------------
// avatarHue
// ---------------------------------------------------------------------------

test('avatarHue: returns a CSS oklch() string', () => {
    const colour = avatarHue('G. Miller');
    assert.match(colour, /^oklch\(52% 0\.12 \d+(\.\d+)?deg\)$/);
});

test('avatarHue: same name always produces the same colour', () => {
    assert.equal(avatarHue('G. Miller'), avatarHue('G. Miller'));
});

test('avatarHue: different names produce different hues (probabilistic)', () => {
    // Not exhaustive — just a basic sanity check that the hash varies
    assert.notEqual(avatarHue('G. Miller'), avatarHue('C. Reen'));
});

test('avatarHue: empty/null name returns a valid oklch string (h=0)', () => {
    assert.match(avatarHue(''), /^oklch\(52% 0\.12 0deg\)$/);
    // null: length is 0, h stays 0
    assert.match(avatarHue(null), /^oklch\(52% 0\.12 0deg\)$/);
});

// ---------------------------------------------------------------------------
// getSpecialDayBadges
// ---------------------------------------------------------------------------

// 2026-02-13 is the first payday (Friday). Cutoff = Sat 7 Feb 2026.
const PAYDAY_2026   = new Date(2026, 1, 13, 12, 0, 0);  // Feb 13
const CUTOFF_2026   = new Date(2026, 1,  7, 12, 0, 0);  // Feb 7 (Saturday before Feb 13)
const EASTER_2026   = new Date(2026, 3,  5, 12, 0, 0);  // Apr 5 — Easter Sunday
const XMAS_2026     = new Date(2026, 11, 25, 12, 0, 0); // Dec 25
const PLAIN_WEEKDAY = new Date(2026, 5, 17, 12, 0, 0);  // Jun 17 (Wednesday, no special day)

test('getSpecialDayBadges: plain weekday returns empty array', () => {
    const badges = getSpecialDayBadges(PLAIN_WEEKDAY, '2026-06-17');
    assert.deepEqual(badges, []);
});

test('getSpecialDayBadges: payday includes 💷 badge', () => {
    const badges = getSpecialDayBadges(PAYDAY_2026, '2026-02-13');
    assert.ok(badges.some(b => b.icon === '💷'), 'Expected payday badge');
});

test('getSpecialDayBadges: cutoff date includes ✂️ badge', () => {
    const badges = getSpecialDayBadges(CUTOFF_2026, '2026-02-07');
    assert.ok(badges.some(b => b.icon === '✂️'), 'Expected cutoff badge');
});

test('getSpecialDayBadges: Good Friday is a bank holiday — includes ⭐ badge', () => {
    const goodFriday = new Date(2026, 3, 3, 12, 0, 0); // Apr 3 2026
    const badges = getSpecialDayBadges(goodFriday, '2026-04-03');
    assert.ok(badges.some(b => b.icon === '⭐'), 'Expected bank holiday badge');
});

test('getSpecialDayBadges: Easter Sunday includes 🐣 badge', () => {
    const badges = getSpecialDayBadges(EASTER_2026, '2026-04-05');
    assert.ok(badges.some(b => b.icon === '🐣'), 'Expected Easter Sunday badge');
});

test('getSpecialDayBadges: Christmas Day includes 🎄 badge', () => {
    const badges = getSpecialDayBadges(XMAS_2026, '2026-12-25');
    assert.ok(badges.some(b => b.icon === '🎄'), 'Expected Christmas Day badge');
});

test('getSpecialDayBadges: Christmas Day is also a bank holiday — includes both 🎄 and ⭐', () => {
    const badges = getSpecialDayBadges(XMAS_2026, '2026-12-25');
    assert.ok(badges.some(b => b.icon === '🎄'), '🎄 badge missing');
    assert.ok(badges.some(b => b.icon === '⭐'), '⭐ badge missing');
});

test('getSpecialDayBadges: returns objects with icon and title fields', () => {
    const badges = getSpecialDayBadges(PAYDAY_2026, '2026-02-13');
    for (const b of badges) {
        assert.ok(typeof b.icon  === 'string', 'icon should be a string');
        assert.ok(typeof b.title === 'string', 'title should be a string');
    }
});

// ---------------------------------------------------------------------------
// isSunday
// ---------------------------------------------------------------------------

test('isSunday: returns true for a known Sunday', () => {
    assert.equal(isSunday('2026-06-14'), true);  // June 14 2026 is Sunday
});

test('isSunday: returns true for another Sunday', () => {
    assert.equal(isSunday('2026-06-21'), true);  // June 21 2026 is Sunday
});

test('isSunday: returns false for Monday', () => {
    assert.equal(isSunday('2026-06-15'), false);  // June 15 2026 is Monday
});

test('isSunday: returns false for Saturday', () => {
    assert.equal(isSunday('2026-06-20'), false);  // June 20 2026 is Saturday
});

test('isSunday: returns false for a mid-week day', () => {
    assert.equal(isSunday('2026-06-17'), false);  // June 17 2026 is Wednesday
});

// ---------------------------------------------------------------------------
// teamMembers roster integrity
// ---------------------------------------------------------------------------

const ROSTER_CYCLE_LENGTHS = {
    main:       CONFIG.MAIN_ROSTER_WEEKS,
    bilingual:  CONFIG.BILINGUAL_ROSTER_WEEKS,
    fixed:      1,
    ces:        CONFIG.CES_ROSTER_WEEKS,
    dispatcher: CONFIG.DISPATCHER_ROSTER_WEEKS,
};
const VALID_ROSTER_TYPES = new Set(Object.keys(ROSTER_CYCLE_LENGTHS));
const VALID_ROLES        = new Set(['CEA', 'CES', 'Dispatcher', 'Management']);

test('every teamMember has a valid rosterType', () => {
    const bad = teamMembers.filter(m => !VALID_ROSTER_TYPES.has(m.rosterType));
    assert.deepEqual(
        bad.map(m => m.name), [],
        `Members with invalid rosterType:\n  ${bad.map(m => `${m.name}: '${m.rosterType}'`).join('\n  ')}`
    );
});

test('every teamMember has a valid role', () => {
    const bad = teamMembers.filter(m => !VALID_ROLES.has(m.role));
    assert.deepEqual(
        bad.map(m => m.name), [],
        `Members with invalid role:\n  ${bad.map(m => `${m.name}: '${m.role}'`).join('\n  ')}`
    );
});

test('every teamMember.currentWeek is in range for their rosterType', () => {
    const bad = teamMembers.filter(m => {
        const len = ROSTER_CYCLE_LENGTHS[m.rosterType];
        return len === undefined || m.currentWeek < 1 || m.currentWeek > len;
    });
    assert.deepEqual(
        bad.map(m => m.name), [],
        `Members whose currentWeek is out of range:\n  ${bad.map(m =>
            `${m.name}: week ${m.currentWeek}, rosterType ${m.rosterType} (max ${ROSTER_CYCLE_LENGTHS[m.rosterType]})`
        ).join('\n  ')}`
    );
});

test('every teamMember.startDate is a Date instance when present', () => {
    const bad = teamMembers.filter(m => m.startDate !== undefined && !(m.startDate instanceof Date));
    assert.deepEqual(
        bad.map(m => m.name), [],
        `Members with non-Date startDate:\n  ${bad.map(m => `${m.name}: ${m.startDate}`).join('\n  ')}`
    );
});

test('every teamMember.rosterChanges is sorted ascending by from date', () => {
    const bad = [];
    for (const m of teamMembers) {
        if (!m.rosterChanges || m.rosterChanges.length < 2) continue;
        for (let i = 1; i < m.rosterChanges.length; i++) {
            if (m.rosterChanges[i].from <= m.rosterChanges[i - 1].from) {
                bad.push(`${m.name}: entry ${i} is not after entry ${i - 1}`);
                break;
            }
        }
    }
    assert.deepEqual(bad, [], `rosterChanges not sorted ascending:\n  ${bad.join('\n  ')}`);
});

test('every rosterChanges entry has a valid rosterType and currentWeek', () => {
    const bad = [];
    for (const m of teamMembers) {
        if (!m.rosterChanges) continue;
        for (const change of m.rosterChanges) {
            const len = ROSTER_CYCLE_LENGTHS[change.rosterType];
            if (!VALID_ROSTER_TYPES.has(change.rosterType)) {
                bad.push(`${m.name}: rosterChanges entry has invalid rosterType '${change.rosterType}'`);
            } else if (change.currentWeek < 1 || change.currentWeek > len) {
                bad.push(`${m.name}: rosterChanges entry currentWeek ${change.currentWeek} out of range for ${change.rosterType} (max ${len})`);
            }
        }
    }
    assert.deepEqual(bad, [], `Invalid rosterChanges entries:\n  ${bad.join('\n  ')}`);
});
