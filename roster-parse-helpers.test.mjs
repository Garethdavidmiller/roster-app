/**
 * Unit tests for functions/roster-parse-helpers.js
 *
 * Pure functions only — no Firebase, no secrets, no HTTP.
 * Run: node --test roster-parse-helpers.test.mjs
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
    normaliseShift,
    buildWeekDates,
    extractAIJson,
    HEADER_TO_INDEX,
    mapColumnHeadersToDates,
    buildSafeEntries,
    applySundayScanCorrections,
    huddleDayLabel,
    isPayCutoffDay,
    nameToEmail,
    nameToPassword,
} = require('./functions/roster-parse-helpers.js');

// ── normaliseShift ────────────────────────────────────────────────────────────

describe('normaliseShift', () => {
    test('already-formatted time passes through', () => {
        assert.equal(normaliseShift('05:30-11:30'), '05:30-11:30');
    });
    test('raw digits without separators', () => {
        assert.equal(normaliseShift('0530-1130'), '05:30-11:30');
    });
    test('dot separators in time', () => {
        assert.equal(normaliseShift('05.30-11.30'), '05:30-11:30');
    });
    test('space between start and end time', () => {
        assert.equal(normaliseShift('05:30 11:30'), '05:30-11:30');
    });
    test('en-dash separator', () => {
        assert.equal(normaliseShift('05:30–11:30'), '05:30-11:30');
    });
    test('RD passes through', () => {
        assert.equal(normaliseShift('RD'), 'RD');
    });
    test('AL passes through', () => {
        assert.equal(normaliseShift('AL'), 'AL');
    });
    test('SPARE passes through', () => {
        assert.equal(normaliseShift('SPARE'), 'SPARE');
    });
    test('SP normalised to SPARE', () => {
        assert.equal(normaliseShift('SP'), 'SPARE');
    });
    test('SICK passes through', () => {
        assert.equal(normaliseShift('SICK'), 'SICK');
    });
    test('OFF passes through', () => {
        assert.equal(normaliseShift('OFF'), 'OFF');
    });
    test('plain RDW sentinel passes through', () => {
        assert.equal(normaliseShift('RDW'), 'RDW');
    });
    test('RDW with colon-formatted time → pipe encoding', () => {
        assert.equal(normaliseShift('RDW 14:30-22:00'), 'RDW|14:30-22:00');
    });
    test('RDW with raw digit time → pipe encoding', () => {
        assert.equal(normaliseShift('RDW 1430-2200'), 'RDW|14:30-22:00');
    });
    test('lowercase input normalised', () => {
        assert.equal(normaliseShift('al'), 'AL');
    });
    test('empty string → RD', () => {
        assert.equal(normaliseShift(''), 'RD');
    });
    test('non-string input → RD', () => {
        assert.equal(normaliseShift(null), 'RD');
        assert.equal(normaliseShift(undefined), 'RD');
        assert.equal(normaliseShift(42), 'RD');
    });
    test('garbage string → RD', () => {
        assert.equal(normaliseShift('XYZZY'), 'RD');
    });
    test('night shift time', () => {
        assert.equal(normaliseShift('22:00-06:00'), '22:00-06:00');
    });
    test('boundary clock values accepted (00:00 and 23:59)', () => {
        assert.equal(normaliseShift('00:00-23:59'), '00:00-23:59');
    });
    test('out-of-range hours/minutes → RD (not a bogus shift)', () => {
        assert.equal(normaliseShift('29:75-88:90'), 'RD');
    });
    test('out-of-range hour only → RD', () => {
        assert.equal(normaliseShift('24:00-10:00'), 'RD');
    });
    test('out-of-range minute only → RD', () => {
        assert.equal(normaliseShift('06:60-10:00'), 'RD');
    });
    test('RDW with out-of-range time → RD (not a bogus shift)', () => {
        assert.equal(normaliseShift('RDW 25:00-30:00'), 'RD');
    });
});

// ── buildWeekDates ────────────────────────────────────────────────────────────

describe('buildWeekDates', () => {
    test('returns 7 dates', () => {
        const dates = buildWeekDates('2026-04-04');
        assert.equal(dates.length, 7);
    });
    test('first date is the Sunday before weekEnding', () => {
        const dates = buildWeekDates('2026-04-04'); // Saturday
        assert.equal(dates[0], '2026-03-29'); // Sunday
    });
    test('last date equals weekEnding', () => {
        const dates = buildWeekDates('2026-04-04');
        assert.equal(dates[6], '2026-04-04');
    });
    test('dates are consecutive', () => {
        const dates = buildWeekDates('2026-04-04');
        for (let i = 1; i < 7; i++) {
            const prev = new Date(dates[i - 1] + 'T12:00:00Z');
            const curr = new Date(dates[i]     + 'T12:00:00Z');
            assert.equal(curr - prev, 86_400_000, `gap between index ${i - 1} and ${i}`);
        }
    });
    test('works across month boundary', () => {
        const dates = buildWeekDates('2026-05-02'); // Saturday in May
        assert.equal(dates[0], '2026-04-26'); // Sunday in April
        assert.equal(dates[6], '2026-05-02');
    });
});

// ── extractAIJson ─────────────────────────────────────────────────────────────

describe('extractAIJson', () => {
    test('clean JSON parses correctly', () => {
        const result = extractAIJson('{"foo": "bar"}');
        assert.deepEqual(result, { foo: 'bar' });
    });
    test('JSON with preamble text', () => {
        const result = extractAIJson('Here is the output:\n{"foo": "bar"}');
        assert.deepEqual(result, { foo: 'bar' });
    });
    test('JSON with trailing text', () => {
        const result = extractAIJson('{"foo": "bar"}\nDone.');
        assert.deepEqual(result, { foo: 'bar' });
    });
    test('JSON wrapped in markdown fences', () => {
        const result = extractAIJson('```json\n{"foo": "bar"}\n```');
        assert.deepEqual(result, { foo: 'bar' });
    });
    test('throws SyntaxError when no JSON found', () => {
        assert.throws(() => extractAIJson('no json here'), SyntaxError);
    });
    test('throws SyntaxError on invalid JSON', () => {
        assert.throws(() => extractAIJson('{bad json}'), SyntaxError);
    });
    test('nested object', () => {
        const result = extractAIJson('{"parsed": [{"memberName": "G. Miller", "Mon": "RD"}]}');
        assert.equal(result.parsed[0].memberName, 'G. Miller');
    });
});

// ── HEADER_TO_INDEX ───────────────────────────────────────────────────────────

describe('HEADER_TO_INDEX', () => {
    test('sun → 0', () => assert.equal(HEADER_TO_INDEX['sun'], 0));
    test('sunday → 0', () => assert.equal(HEADER_TO_INDEX['sunday'], 0));
    test('mon → 1', () => assert.equal(HEADER_TO_INDEX['mon'], 1));
    test('saturday → 6', () => assert.equal(HEADER_TO_INDEX['saturday'], 6));
    test('thurs → 4', () => assert.equal(HEADER_TO_INDEX['thurs'], 4));
});

// ── mapColumnHeadersToDates ───────────────────────────────────────────────────

describe('mapColumnHeadersToDates', () => {
    const DATES = [
        '2026-03-29', // Sun
        '2026-03-30', // Mon
        '2026-03-31', // Tue
        '2026-04-01', // Wed
        '2026-04-02', // Thu
        '2026-04-03', // Fri
        '2026-04-04', // Sat
    ];

    test('full week maps correctly', () => {
        const { columnDates, error } = mapColumnHeadersToDates(
            ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], DATES,
        );
        assert.equal(error, null);
        assert.deepEqual(columnDates, DATES);
    });
    test('Mon–Sat only (no Sunday)', () => {
        const { columnDates, error } = mapColumnHeadersToDates(
            ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], DATES,
        );
        assert.equal(error, null);
        assert.deepEqual(columnDates, DATES.slice(1));
    });
    test('long-form header names', () => {
        const { columnDates, error } = mapColumnHeadersToDates(
            ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'], DATES,
        );
        assert.equal(error, null);
        assert.deepEqual(columnDates, DATES);
    });
    test('mixed abbreviations', () => {
        const { columnDates, error } = mapColumnHeadersToDates(
            ['Sun', 'Mon', 'Tues', 'Weds', 'Thurs', 'Fri', 'Sat'], DATES,
        );
        assert.equal(error, null);
        assert.deepEqual(columnDates, DATES);
    });
    test('unrecognised header returns error', () => {
        const { columnDates, error } = mapColumnHeadersToDates(['Sun', 'Xyz'], DATES);
        assert.notEqual(error, null);
        assert.equal(columnDates, null);
        assert.match(error, /unrecognised/i);
    });
    test('duplicate headers return error', () => {
        const { columnDates, error } = mapColumnHeadersToDates(
            ['Mon', 'Mon', 'Wed', 'Thu', 'Fri', 'Sat'], DATES,
        );
        assert.notEqual(error, null);
        assert.equal(columnDates, null);
        assert.match(error, /duplicate/i);
    });
    test('case-insensitive matching', () => {
        const { error } = mapColumnHeadersToDates(['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'], DATES);
        assert.equal(error, null);
    });
});

// ── buildSafeEntries ──────────────────────────────────────────────────────────

describe('buildSafeEntries', () => {
    const DATES = [
        '2026-03-29', '2026-03-30', '2026-03-31',
        '2026-04-01', '2026-04-02', '2026-04-03', '2026-04-04',
    ];
    const HEADERS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    test('basic entry is built correctly', () => {
        const entries = buildSafeEntries(
            [{ memberName: 'G. Miller', Sun: 'RD', Mon: '05:30-11:30', Tue: '05:30-11:30', Wed: 'RD', Thu: '05:30-11:30', Fri: 'RD', Sat: 'RD' }],
            HEADERS, DATES,
        );
        assert.equal(entries.length, 1);
        assert.equal(entries[0].memberName, 'G. Miller');
        assert.equal(entries[0].shifts['2026-03-30'], '05:30-11:30');
        assert.equal(entries[0].shifts['2026-03-29'], 'RD');
    });
    test('shift values are normalised', () => {
        const entries = buildSafeEntries(
            [{ memberName: 'L. Springer', Mon: '0530-1130', Sun: 'RD', Tue: 'RD', Wed: 'RD', Thu: 'RD', Fri: 'RD', Sat: 'RD' }],
            HEADERS, DATES,
        );
        assert.equal(entries[0].shifts['2026-03-30'], '05:30-11:30');
    });
    test('missing key defaults to RD', () => {
        const entries = buildSafeEntries(
            [{ memberName: 'N. Tuck', Mon: 'AL' }], // all other days omitted
            HEADERS, DATES,
        );
        assert.equal(entries[0].shifts['2026-03-29'], 'RD'); // Sun missing → RD
        assert.equal(entries[0].shifts['2026-03-30'], 'AL'); // Mon present
    });
    test('empty memberName is skipped', () => {
        const entries = buildSafeEntries(
            [{ memberName: '', Mon: 'RD' }],
            HEADERS, DATES,
        );
        assert.equal(entries.length, 0);
    });
    test('all 7 dates present in shifts', () => {
        const entries = buildSafeEntries(
            [{ memberName: 'A. Hared', Sun: 'RD', Mon: 'RD', Tue: 'RD', Wed: 'RD', Thu: 'RD', Fri: 'RD', Sat: 'RD' }],
            HEADERS, DATES,
        );
        assert.equal(Object.keys(entries[0].shifts).length, 7);
    });
    test('memberName is trimmed', () => {
        const entries = buildSafeEntries(
            [{ memberName: '  G. Miller  ', Mon: 'RD', Sun: 'RD', Tue: 'RD', Wed: 'RD', Thu: 'RD', Fri: 'RD', Sat: 'RD' }],
            HEADERS, DATES,
        );
        assert.equal(entries[0].memberName, 'G. Miller');
    });
});

// ── applySundayScanCorrections ────────────────────────────────────────────────

describe('applySundayScanCorrections', () => {
    const DATES = [
        '2026-03-29', '2026-03-30', '2026-03-31',
        '2026-04-01', '2026-04-02', '2026-04-03', '2026-04-04',
    ];
    const SUN_DATE = '2026-03-29';

    test('Case A: sundayScan=blank but parsed has time → corrects to RD', () => {
        const entries = [{ memberName: 'G. Miller', shifts: { [SUN_DATE]: '06:00-14:00' } }];
        applySundayScanCorrections(entries, { 'G. Miller': 'blank' }, true, DATES);
        assert.equal(entries[0].shifts[SUN_DATE], 'RD');
    });
    test('Case A: sundayScan=RD also triggers correction', () => {
        const entries = [{ memberName: 'G. Miller', shifts: { [SUN_DATE]: '06:00-14:00' } }];
        applySundayScanCorrections(entries, { 'G. Miller': 'RD' }, true, DATES);
        assert.equal(entries[0].shifts[SUN_DATE], 'RD');
    });
    test('Case B: sundayScan has RDW but parsed has plain time → adds RDW prefix', () => {
        const entries = [{ memberName: 'G. Miller', shifts: { [SUN_DATE]: '06:00-14:00' } }];
        applySundayScanCorrections(entries, { 'G. Miller': 'RDW 06:00-14:00' }, true, DATES);
        assert.equal(entries[0].shifts[SUN_DATE], 'RDW|06:00-14:00');
    });
    test('no change when sundayScan and parsed agree (plain time)', () => {
        const entries = [{ memberName: 'G. Miller', shifts: { [SUN_DATE]: '06:00-14:00' } }];
        applySundayScanCorrections(entries, { 'G. Miller': '06:00-14:00' }, true, DATES);
        assert.equal(entries[0].shifts[SUN_DATE], '06:00-14:00');
    });
    test('no change when no Sunday column', () => {
        const entries = [{ memberName: 'G. Miller', shifts: { [SUN_DATE]: '06:00-14:00' } }];
        applySundayScanCorrections(entries, { 'G. Miller': 'blank' }, false, DATES);
        assert.equal(entries[0].shifts[SUN_DATE], '06:00-14:00');
    });
    test('no change when member not in sundayScan', () => {
        const entries = [{ memberName: 'G. Miller', shifts: { [SUN_DATE]: '06:00-14:00' } }];
        applySundayScanCorrections(entries, { 'L. Springer': 'blank' }, true, DATES);
        assert.equal(entries[0].shifts[SUN_DATE], '06:00-14:00');
    });
    test('null sundayScan is handled gracefully', () => {
        const entries = [{ memberName: 'G. Miller', shifts: { [SUN_DATE]: '06:00-14:00' } }];
        assert.doesNotThrow(() =>
            applySundayScanCorrections(entries, null, true, DATES),
        );
    });
});

// ── huddleDayLabel ────────────────────────────────────────────────────────────

describe('huddleDayLabel', () => {
    test("same day → Today's", () => {
        const now = new Date(2026, 3, 6); // April 6 2026 (Monday)
        assert.equal(huddleDayLabel('2026-04-06', now), "Today's");
    });
    test("next day → Tomorrow's", () => {
        const now = new Date(2026, 3, 6); // April 6
        assert.equal(huddleDayLabel('2026-04-07', now), "Tomorrow's");
    });
    test('two days ahead → weekday name', () => {
        const now = new Date(2026, 3, 6); // Monday April 6
        // April 8 2026 is Wednesday
        assert.equal(huddleDayLabel('2026-04-08', now), "Wednesday's");
    });
    test('past date uses weekday name', () => {
        const now = new Date(2026, 3, 8); // Wednesday April 8
        // April 6 is Monday — two days in the past
        assert.equal(huddleDayLabel('2026-04-06', now), "Monday's");
    });
});

// ── isPayCutoffDay ────────────────────────────────────────────────────────────

describe('isPayCutoffDay', () => {
    // First payday: 13 Feb 2026 → cutoff: 7 Feb 2026 (Saturday)
    test('Feb 7 2026 is a cutoff day', () => {
        assert.equal(isPayCutoffDay(new Date(2026, 1, 7)), true);
    });
    // Second payday: 13 Mar 2026 → cutoff: 7 Mar 2026 (Saturday)
    test('Mar 7 2026 is a cutoff day', () => {
        assert.equal(isPayCutoffDay(new Date(2026, 2, 7)), true);
    });
    // Third payday: 10 Apr 2026 → cutoff: 4 Apr 2026 (Saturday)
    test('Apr 4 2026 is a cutoff day', () => {
        assert.equal(isPayCutoffDay(new Date(2026, 3, 4)), true);
    });
    test('Feb 8 2026 (Sunday after cutoff) is not a cutoff day', () => {
        assert.equal(isPayCutoffDay(new Date(2026, 1, 8)), false);
    });
    test('Feb 6 2026 (Friday before cutoff) is not a cutoff day', () => {
        assert.equal(isPayCutoffDay(new Date(2026, 1, 6)), false);
    });
    test('Jan 1 2026 (before first payday) is not a cutoff day', () => {
        assert.equal(isPayCutoffDay(new Date(2026, 0, 1)), false);
    });
    // 28-day cycle: May 2 2026 is next after Apr 4
    test('May 2 2026 is a cutoff day', () => {
        assert.equal(isPayCutoffDay(new Date(2026, 4, 2)), true);
    });
    // 28-day cycle: May 30 2026 is next after May 2 → Jun 5 payday
    test('May 30 2026 is a cutoff day', () => {
        assert.equal(isPayCutoffDay(new Date(2026, 4, 30)), true);
    });
    test('May 29 2026 (Friday before cutoff) is not a cutoff day', () => {
        assert.equal(isPayCutoffDay(new Date(2026, 4, 29)), false);
    });
});

// ── nameToEmail ───────────────────────────────────────────────────────────────

describe('nameToEmail', () => {
    test('G. Miller', () => {
        assert.equal(nameToEmail('G. Miller'), 'g.miller@myb-roster.local');
    });
    test('N. Tuck', () => {
        assert.equal(nameToEmail('N. Tuck'), 'n.tuck@myb-roster.local');
    });
    test('C. Francisco-Charles', () => {
        assert.equal(nameToEmail('C. Francisco-Charles'), 'c.franciscocharles@myb-roster.local');
    });
    test('F. Mohamed', () => {
        assert.equal(nameToEmail('F. Mohamed'), 'f.mohamed@myb-roster.local');
    });
});

// ── nameToPassword ────────────────────────────────────────────────────────────

describe('nameToPassword', () => {
    test('G. Miller → miller', () => {
        assert.equal(nameToPassword('G. Miller'), 'miller');
    });
    test('short surname padded to 6 chars: N. Tuck → tucktu', () => {
        assert.equal(nameToPassword('N. Tuck'), 'tucktu');
    });
    test('long surname unchanged: C. Francisco-Charles', () => {
        assert.equal(nameToPassword('C. Francisco-Charles'), 'franciscocharles');
    });
    test('hyphen removed from surname', () => {
        assert.equal(nameToPassword('R. Forrester-Blackstock'), 'forresterblackstock');
    });
    test('result always ≥ 6 chars', () => {
        // "Li" would be 2 chars — padded
        const pw = nameToPassword('A. Li');
        assert.ok(pw.length >= 6, `expected ≥6 chars, got "${pw}"`);
    });
});
