/**
 * Unit tests for functions/roster-parse-helpers.js
 *
 * Pure functions only — no Firebase, no secrets, no HTTP.
 * Run: node --test roster-parse-helpers.test.mjs
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'module';
import { isCutoffDate } from './roster-data.js';

const require = createRequire(import.meta.url);
const {
    normaliseShift,
    buildWeekDates,
    extractAIJson,
    HEADER_TO_INDEX,
    mapColumnHeadersToDates,
    buildSafeEntries,
    applySundayScanCorrections,
    parseStrictIsoDate,
    isPayCutoffDay,
    nameToEmail,
    nameToPassword,
    fileSignatureMatches,
    NOTIFICATION_FEATURES,
    buildPushPayload,
    parseSetupActionFlags,
    resolveRosterAuthConfig,
    claimsForTier,
    computeOrphanLabels,
} = require('./functions/roster-parse-helpers.js');

// ── fileSignatureMatches ──────────────────────────────────────────────────────

describe('fileSignatureMatches', () => {
    const pdf  = Buffer.from('%PDF-1.7\n%âãÏÓ\n', 'binary');
    const docx = Buffer.from([0x50, 0x4B, 0x03, 0x04, 0x14, 0x00]); // ZIP local-file header

    test('accepts real PDF bytes claimed as pdf', () => assert.equal(fileSignatureMatches(pdf, 'pdf'), true));
    test('accepts real DOCX (ZIP) bytes claimed as docx', () => assert.equal(fileSignatureMatches(docx, 'docx'), true));
    test('rejects PDF bytes claimed as docx', () => assert.equal(fileSignatureMatches(pdf, 'docx'), false));
    test('rejects DOCX bytes claimed as pdf', () => assert.equal(fileSignatureMatches(docx, 'pdf'), false));
    test('rejects an empty buffer', () => assert.equal(fileSignatureMatches(Buffer.alloc(0), 'pdf'), false));
    test('rejects a too-short buffer', () => assert.equal(fileSignatureMatches(Buffer.from([0x25, 0x50]), 'pdf'), false));
    test('rejects random bytes', () => assert.equal(fileSignatureMatches(Buffer.from([0, 1, 2, 3, 4]), 'pdf'), false));
    test('rejects null / undefined', () => {
        assert.equal(fileSignatureMatches(null, 'pdf'), false);
        assert.equal(fileSignatureMatches(undefined, 'docx'), false);
    });
    test('rejects an unknown fileType', () => assert.equal(fileSignatureMatches(pdf, 'txt'), false));
});

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
    test('time-FIRST RDW (paper-roster order) → pipe encoding, RDW not dropped', () => {
        assert.equal(normaliseShift('14:30-22:00 RDW'), 'RDW|14:30-22:00');
        assert.equal(normaliseShift('1430-2200 RDW'), 'RDW|14:30-22:00');
    });
    test('a bare time (no RDW) does NOT get RDW-encoded', () => {
        assert.equal(normaliseShift('14:30-22:00'), '14:30-22:00');
    });
    test('time-first RDW with a TRAILING annotation keeps RDW (not dropped to a plain shift)', () => {
        // "06:00-12:00 RDW GER": the anchored rdwMatch rejects the trailing " GER", so it fell to
        // the leading-time extractor and returned a PLAIN shift, silently losing the RDW overtime
        // marker → the day was saved as normal pay (v16.19 pay-loss fix).
        assert.equal(normaliseShift('06:00-12:00 RDW GER'), 'RDW|06:00-12:00');
        assert.equal(normaliseShift('0600-1200 GER RDW'), 'RDW|06:00-12:00');
    });
    test('a leading time with a NON-RDW annotation stays a plain shift', () => {
        assert.equal(normaliseShift('06:00-12:00 GER'), '06:00-12:00');
    });
    test('a trailing word merely CONTAINING "rdw" as a substring does NOT force an RDW encode', () => {
        // \bRDW\b is word-boundaried, so "HARDWARE" (…hARDWare…) must not trigger the RDW branch.
        assert.equal(normaliseShift('06:00-12:00 HARDWARE FAULT'), '06:00-12:00');
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
    test('garbage string → UNKNOWN sentinel (flagged for review, not silently RD)', () => {
        // A non-empty value normaliseShift can't parse is NOT defaulted to RD — when the base is
        // also RD that would classify as MATCH and silently drop a real shift. It's flagged UNKNOWN
        // so the review surfaces it (skip-only, never written). The raw text rides along for display.
        assert.equal(normaliseShift('XYZZY'), 'UNKNOWN|XYZZY');
    });
    test('valid leading time with a trailing code → extracts the time (not silently dropped to RD)', () => {
        assert.equal(normaliseShift('06:00-12:00 GER'), '06:00-12:00');
        assert.equal(normaliseShift('0600-1200 CEA16'), '06:00-12:00');
    });
    test('trailing content after an OUT-OF-RANGE leading time → UNKNOWN (surfaced, not silent RD)', () => {
        assert.equal(normaliseShift('29:00-12:00 GER'), 'UNKNOWN|29:00-12:00 GER');
    });
    test('night shift time', () => {
        assert.equal(normaliseShift('22:00-06:00'), '22:00-06:00');
    });
    test('boundary clock values accepted (00:00 and 23:59)', () => {
        assert.equal(normaliseShift('00:00-23:59'), '00:00-23:59');
    });
    test('out-of-range hours/minutes → UNKNOWN (surfaced, not a bogus shift nor a silent RD)', () => {
        assert.equal(normaliseShift('29:75-88:90'), 'UNKNOWN|29:75-88:90');
    });
    test('out-of-range hour only → UNKNOWN', () => {
        assert.equal(normaliseShift('24:00-10:00'), 'UNKNOWN|24:00-10:00');
    });
    test('out-of-range minute only → UNKNOWN', () => {
        assert.equal(normaliseShift('06:60-10:00'), 'UNKNOWN|06:60-10:00');
    });
    test('RDW with out-of-range time → UNKNOWN (surfaced, not a bogus shift)', () => {
        assert.equal(normaliseShift('RDW 25:00-30:00'), 'UNKNOWN|RDW 25:00-30:00');
    });
    test('whitespace-only string → RD (genuinely blank, not flagged)', () => {
        assert.equal(normaliseShift('   '), 'RD');
    });
    test('paid-absence codes HA (hospital appointment) and OD → SICK, case-insensitive, never UNKNOWN', () => {
        assert.equal(normaliseShift('HA'), 'SICK');
        assert.equal(normaliseShift('OD'), 'SICK');
        assert.equal(normaliseShift('ha'), 'SICK');
        assert.equal(normaliseShift('od'), 'SICK');
    });
    test('training words → TRG (case-insensitive, all aliases)', () => {
        assert.equal(normaliseShift('TRG'), 'TRG');
        assert.equal(normaliseShift('Training'), 'TRG');
        assert.equal(normaliseShift('TRAIN'), 'TRG');
        assert.equal(normaliseShift('trg'), 'TRG');
    });
    test('induction words → IND', () => {
        assert.equal(normaliseShift('Induction'), 'IND');
        assert.equal(normaliseShift('IND'), 'IND');
    });
    test('assessment words → ASSESS', () => {
        assert.equal(normaliseShift('Assess'), 'ASSESS');
        assert.equal(normaliseShift('Assessment'), 'ASSESS');
        assert.equal(normaliseShift('ASSESSMENTS'), 'ASSESS');
    });
    test('team day words → TEAM (the one multi-word roster label; "Team Day")', () => {
        assert.equal(normaliseShift('Team Day'), 'TEAM');
        assert.equal(normaliseShift('TEAM DAY'), 'TEAM');
        assert.equal(normaliseShift('team day'), 'TEAM');
        assert.equal(normaliseShift('Team'), 'TEAM');
        assert.equal(normaliseShift('Team  Day'), 'TEAM');   // OCR double-space tolerated
    });
    test('training/team rest-day marker preserved, either order → canonical "FLAVOUR RDW"', () => {
        assert.equal(normaliseShift('TRG RDW'), 'TRG RDW');
        assert.equal(normaliseShift('Training RDW'), 'TRG RDW');
        assert.equal(normaliseShift('RDW TRG'), 'TRG RDW');
        assert.equal(normaliseShift('IND RDW'), 'IND RDW');
        assert.equal(normaliseShift('ASSESS RDW'), 'ASSESS RDW');
        assert.equal(normaliseShift('Team Day RDW'), 'TEAM RDW');
        assert.equal(normaliseShift('RDW Team Day'), 'TEAM RDW');
    });
    test('training/team values never become UNKNOWN (they were UNREADABLE before v15.34)', () => {
        for (const v of ['TRG', 'Training', 'Induction', 'Assessment', 'TRG RDW', 'Team Day', 'TEAM']) {
            assert.ok(!normaliseShift(v).startsWith('UNKNOWN|'), v);
        }
    });
    test('a TIMED training cell is unexpected (roster never sets times) → UNKNOWN, surfaced for review', () => {
        assert.equal(normaliseShift('TRG 08:00-16:00'), 'UNKNOWN|TRG 08:00-16:00');
    });
    test('an unknown word with an RDW marker is still UNKNOWN (not swallowed by the training grammar)', () => {
        assert.equal(normaliseShift('XYZ RDW'), 'UNKNOWN|XYZ RDW');
    });
    test('bare RDW is unaffected by the training grammar (still the review sentinel)', () => {
        assert.equal(normaliseShift('RDW'), 'RDW');
    });
    test('UNKNOWN sentinel strips pipe chars from the raw text (so PREFIX|value stays decodable)', () => {
        assert.equal(normaliseShift('A|B|C'), 'UNKNOWN|A B C');
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

    // ── Day-shift repair (the Sonnet-5 blank-Sunday left-shift) ──
    // Full-week entries: dates[0]=Sun … dates[6]=Sat.
    const fullWeek = (vals) => ({ memberName: 'G. Miller', shifts: Object.fromEntries(DATES.map((d, i) => [d, vals[i]])) });

    test('Case A day-shift: scan=blank, Sun has a value, Sat empty → RIGHT-shift the whole week', () => {
        // AI dropped the blank Sunday and shifted everything one day LEFT:
        //   parsed = [Sun=Mon's, Mon=Tue's, Tue=Wed's, …, Fri=Sat's, Sat=RD]
        const entries = [fullWeek(['06:00-14:00', '07:00-15:00', 'RD', '08:00-16:00', 'RD', 'AL', 'RD'])];
        applySundayScanCorrections(entries, { 'G. Miller': 'blank' }, true, DATES);
        const s = entries[0].shifts;
        assert.equal(s[DATES[0]], 'RD',           'Sunday → RD (the blank)');
        assert.equal(s[DATES[1]], '06:00-14:00',  'Monday takes the value the AI mis-placed in Sunday');
        assert.equal(s[DATES[2]], '07:00-15:00',  'Tuesday ← old Monday');
        assert.equal(s[DATES[3]], 'RD',           'Wednesday ← old Tuesday');
        assert.equal(s[DATES[4]], '08:00-16:00',  'Thursday ← old Wednesday');
        assert.equal(s[DATES[5]], 'RD',           'Friday ← old Thursday');
        assert.equal(s[DATES[6]], 'AL',           'Saturday ← old Friday (the value that had been pushed to Fri)');
    });

    test('Case A but Saturday OCCUPIED → cannot cleanly reverse; only Sunday is set to RD', () => {
        const entries = [fullWeek(['06:00-14:00', '07:00-15:00', 'RD', 'RD', 'RD', 'RD', '09:00-17:00'])];
        applySundayScanCorrections(entries, { 'G. Miller': 'blank' }, true, DATES);
        const s = entries[0].shifts;
        assert.equal(s[DATES[0]], 'RD',           'Sunday honoured as blank');
        assert.equal(s[DATES[1]], '07:00-15:00',  'Mon–Sat left as-is (no unsafe shift)');
        assert.equal(s[DATES[6]], '09:00-17:00',  'occupied Saturday preserved');
    });

    test('correctly-read blank Sunday (parsed Sun already RD) is untouched — no false shift', () => {
        const entries = [fullWeek(['RD', '06:00-14:00', '07:00-15:00', 'RD', 'RD', 'RD', 'RD'])];
        applySundayScanCorrections(entries, { 'G. Miller': 'blank' }, true, DATES);
        const s = entries[0].shifts;
        assert.equal(s[DATES[1]], '06:00-14:00', 'Monday unchanged');
        assert.equal(s[DATES[2]], '07:00-15:00', 'Tuesday unchanged');
    });

    test('day-shift where the leaked value is AL/SPARE (not a time) is still repaired', () => {
        const entries = [fullWeek(['SPARE', '06:00-14:00', 'RD', 'RD', 'RD', 'RD', 'RD'])];
        applySundayScanCorrections(entries, { 'G. Miller': 'blank' }, true, DATES);
        const s = entries[0].shifts;
        assert.equal(s[DATES[0]], 'RD',          'Sunday → RD');
        assert.equal(s[DATES[1]], 'SPARE',       'Monday ← the SPARE the AI mis-placed in Sunday');
        assert.equal(s[DATES[2]], '06:00-14:00', 'Tuesday ← old Monday');
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

// ── isPayCutoffDay vs isCutoffDate cross-check ────────────────────────────────
// Guards against the two implementations silently drifting out of sync.
// isPayCutoffDay() uses UTC arithmetic (Cloud Run timezone-safe);
// isCutoffDate() derives from getPaydaysAndCutoffs() via a Set lookup.

describe('isPayCutoffDay agrees with isCutoffDate over full 2026 calendar year', () => {
    test('all dates Jan–Dec 2026 agree', () => {
        const mismatches = [];
        for (let month = 0; month < 12; month++) {
            const daysInMonth = new Date(2026, month + 1, 0).getDate();
            for (let day = 1; day <= daysInMonth; day++) {
                const d = new Date(2026, month, day);
                const fromHelper = isPayCutoffDay(d);
                const fromRoster = isCutoffDate(d);
                if (fromHelper !== fromRoster) {
                    const iso = `${2026}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                    mismatches.push(`${iso}: isPayCutoffDay=${fromHelper} isCutoffDate=${fromRoster}`);
                }
            }
        }
        assert.deepEqual(mismatches, [], `Implementations disagree on ${mismatches.length} date(s):\n${mismatches.join('\n')}`);
    });
});

// ── buildPushPayload (notification design language) ───────────────────────────
describe('buildPushPayload', () => {
    const BASE = 'https://myb-roster.web.app';

    test('huddle: "📋 Latest Huddle", huddle tag, scope-relative #huddle deep link', () => {
        const p = buildPushPayload({ feature: 'huddle', body: 'Tap to read the latest day plan.', baseUrl: BASE });
        assert.equal(p.title, '📋 Latest Huddle');
        assert.equal(p.tag, 'huddle');
        assert.equal(p.url, `${BASE}/#huddle`);
        assert.equal(p.body, 'Tap to read the latest day plan.');
    });

    test('circular and newsletter use their feature emoji + "Latest" headline', () => {
        const c = buildPushPayload({ feature: 'circular', body: 'x', baseUrl: BASE });
        assert.equal(c.title, '📰 Latest Retail Circular');
        assert.equal(c.url, `${BASE}/#circular`);
        const n = buildPushPayload({ feature: 'newsletter', body: 'x', baseUrl: BASE });
        assert.equal(n.title, '🗞️ Latest Marylebone Newsletter');
        assert.equal(n.url, `${BASE}/#newsletter`);
    });

    test('pay (event): caller-supplied headline + url, pay-reminder tag', () => {
        const p = buildPushPayload({
            feature: 'pay',
            headline: 'Payday Friday — hours cutoff today',
            body: 'Open the Pay Calculator to estimate your 28 March pay.',
            url: `${BASE}/paycalc.html?payday=2026-03-28`,
        });
        assert.equal(p.title, '💷 Payday Friday — hours cutoff today');
        assert.equal(p.tag, 'pay-reminder');
        assert.equal(p.url, `${BASE}/paycalc.html?payday=2026-03-28`);
    });

    test('unknown feature throws', () => {
        assert.throws(() => buildPushPayload({ feature: 'bogus', body: 'x', baseUrl: BASE }), /Unknown notification feature/);
    });

    test('event feature without headline/url throws (no silent bad payload)', () => {
        assert.throws(() => buildPushPayload({ feature: 'pay', body: 'x', baseUrl: BASE }), /No headline/);
    });

    test('design-language invariants hold for every feature: one leading emoji, no exclamation, title within budget', () => {
        for (const [key, f] of Object.entries(NOTIFICATION_FEATURES)) {
            const title = f.defaultHeadline ? `${f.emoji} ${f.defaultHeadline}` : `${f.emoji} Payday Friday — hours cutoff today`;
            assert.ok(title.startsWith(f.emoji), `${key} title must lead with its feature emoji`);
            assert.ok(!title.includes('!'), `${key} title must not use an exclamation mark`);
            assert.ok(title.length <= 40, `${key} title "${title}" exceeds the 40-char budget (${title.length})`);
            assert.ok(typeof f.tag === 'string' && f.tag.length > 0, `${key} must have a stable tag`);
        }
    });
});

// ── parseStrictIsoDate ──────────────────────────────────────────────────────────
describe('parseStrictIsoDate', () => {
    test('accepts a real date and returns UTC-noon', () => {
        const d = parseStrictIsoDate('2026-04-11');
        assert.ok(d instanceof Date);
        assert.equal(d.getUTCFullYear(), 2026);
        assert.equal(d.getUTCMonth() + 1, 4);
        assert.equal(d.getUTCDate(), 11);
        assert.equal(d.getUTCHours(), 12);
    });
    test('rejects bad format', () => {
        for (const bad of ['2026/04/11', '11-04-2026', '2026-4-11', 'x', '', '2026-04-11T00:00'])
            assert.equal(parseStrictIsoDate(bad), null, bad);
    });
    test('rejects JS-normalised impossible dates', () => {
        assert.equal(parseStrictIsoDate('2026-02-30'), null); // would normalise to 2026-03-02
        assert.equal(parseStrictIsoDate('2025-02-29'), null); // 2025 not a leap year
        assert.equal(parseStrictIsoDate('2026-13-01'), null);
        assert.equal(parseStrictIsoDate('2026-00-10'), null);
    });
    test('accepts a valid leap day', () => {
        assert.ok(parseStrictIsoDate('2028-02-29') instanceof Date);
    });
    test('non-string input → null', () => {
        assert.equal(parseStrictIsoDate(null), null);
        assert.equal(parseStrictIsoDate(20260411), null);
    });
});

// ── setupRosterAuth pure decision helpers (B4) ────────────────────────────────
// The onRequest handler uses the Firebase Admin SDK and can't run in the sandbox; these are the
// pure decision functions it delegates to, so the B4 logic is covered here.

describe('parseSetupActionFlags', () => {
    test('parsed JSON body (application/json) → flags read straight off req.body', () => {
        assert.deepEqual(parseSetupActionFlags({ removeOrphans: true, confirmOrphanRemoval: true }, null),
            { removeOrphans: true, confirmOrphanRemoval: true });
        assert.deepEqual(parseSetupActionFlags({ removeOrphans: false }, null),
            { removeOrphans: false, confirmOrphanRemoval: false });
        assert.deepEqual(parseSetupActionFlags({}, null),
            { removeOrphans: false, confirmOrphanRemoval: false });
    });
    test('a wrong-shape req.body (non-JSON Content-Type) falls back to rawBody JSON', () => {
        // firebase-functions gives a bogus single-key object for a form-urlencoded body; the raw
        // body still holds the real JSON — the flags must come from there, not be dropped.
        const bogus = { '{"removeOrphans":true,"confirmOrphanRemoval":true}': '' };
        assert.deepEqual(parseSetupActionFlags(bogus, '{"removeOrphans":true,"confirmOrphanRemoval":true}'),
            { removeOrphans: true, confirmOrphanRemoval: true });
    });
    test('rawBody is used when req.body is empty/undefined', () => {
        assert.deepEqual(parseSetupActionFlags(undefined, '{"removeOrphans":true}'),
            { removeOrphans: true, confirmOrphanRemoval: false });
        assert.deepEqual(parseSetupActionFlags(null, Buffer.from('{"removeOrphans":true,"confirmOrphanRemoval":true}')),
            { removeOrphans: true, confirmOrphanRemoval: true });
    });
    test('a real parsed body with removeOrphans present is NOT overridden by rawBody', () => {
        // If req.body already exposes the boolean, trust it (don't re-parse a possibly-stale rawBody).
        assert.deepEqual(parseSetupActionFlags({ removeOrphans: false }, '{"removeOrphans":true}'),
            { removeOrphans: false, confirmOrphanRemoval: false });
    });
    test('malformed rawBody → flags default off (fail-safe: no sweep), never throws', () => {
        assert.deepEqual(parseSetupActionFlags(undefined, 'not json {{{'),
            { removeOrphans: false, confirmOrphanRemoval: false });
        assert.deepEqual(parseSetupActionFlags(undefined, ''),
            { removeOrphans: false, confirmOrphanRemoval: false });
    });
    test('only strict boolean true counts (truthy strings/1 do not enable)', () => {
        assert.deepEqual(parseSetupActionFlags({ removeOrphans: 'true', confirmOrphanRemoval: 1 }, null),
            { removeOrphans: false, confirmOrphanRemoval: false });
    });
    test('an array body is treated as no-body (falls through to rawBody/empty)', () => {
        assert.deepEqual(parseSetupActionFlags(['x'], null),
            { removeOrphans: false, confirmOrphanRemoval: false });
    });
});

describe('resolveRosterAuthConfig', () => {
    const GOOD = {
        activeMembers: ['G. Miller', 'A. Staff', 'S. Silva', 'S. Stewart'],
        roles: { admin: ['G. Miller'], manager: ['S. Stewart'], designer: ['G. Miller', 'S. Silva'] },
    };
    test('valid config returns the lists + a deduped processMembers union', () => {
        const r = resolveRosterAuthConfig(GOOD);
        assert.equal(r.error, undefined);
        assert.deepEqual(r.admin, ['G. Miller']);
        assert.deepEqual(r.manager, ['S. Stewart']);
        assert.deepEqual(r.designer, ['G. Miller', 'S. Silva']);
        // processMembers = union(active, admin, manager, designer), deduped, no duplicates.
        assert.deepEqual([...r.processMembers].sort(), ['A. Staff', 'G. Miller', 'S. Silva', 'S. Stewart']);
    });
    test('a role-holder MISSING from activeMembers is still unioned in (lockout guard)', () => {
        const r = resolveRosterAuthConfig({
            activeMembers: ['A. Staff'],
            roles: { admin: ['G. Miller'], manager: [], designer: ['S. Silva'] },
        });
        assert.equal(r.error, undefined);
        assert.ok(r.processMembers.includes('G. Miller'), 'admin unioned in even if absent from activeMembers');
        assert.ok(r.processMembers.includes('S. Silva'), 'designer unioned in too');
    });
    test('empty activeMembers → error (fail closed)', () => {
        assert.equal(resolveRosterAuthConfig({ activeMembers: [], roles: { admin: ['G. Miller'] } }).error, 'missing-active-members');
        assert.equal(resolveRosterAuthConfig({ roles: { admin: ['G. Miller'] } }).error, 'missing-active-members');
        assert.equal(resolveRosterAuthConfig(null).error, 'missing-active-members');
    });
    test('empty admin list → error (would lock out admin)', () => {
        assert.equal(resolveRosterAuthConfig({ activeMembers: ['A. Staff'], roles: { admin: [] } }).error, 'empty-admin');
        assert.equal(resolveRosterAuthConfig({ activeMembers: ['A. Staff'], roles: {} }).error, 'empty-admin');
        assert.equal(resolveRosterAuthConfig({ activeMembers: ['A. Staff'] }).error, 'empty-admin');
    });
    test('missing manager/designer lists default to empty (not an error)', () => {
        const r = resolveRosterAuthConfig({ activeMembers: ['A. Staff'], roles: { admin: ['G. Miller'] } });
        assert.equal(r.error, undefined);
        assert.deepEqual(r.manager, []);
        assert.deepEqual(r.designer, []);
    });
});

describe('claimsForTier', () => {
    const sets = (a, m, d) => ({ adminSet: new Set(a), managerSet: new Set(m), designerSet: new Set(d) });
    test('plain member → { name } only', () => {
        assert.deepEqual(claimsForTier('A. Staff', sets([], [], [])), { name: 'A. Staff' });
    });
    test('admin → { name, admin }', () => {
        assert.deepEqual(claimsForTier('G. Miller', sets(['G. Miller'], [], [])), { name: 'G. Miller', admin: true });
    });
    test('manager → { name, manager }', () => {
        assert.deepEqual(claimsForTier('S. Stewart', sets([], ['S. Stewart'], [])), { name: 'S. Stewart', manager: true });
    });
    test('admin OUTRANKS manager — a member in both gets admin only, never manager', () => {
        const c = claimsForTier('G. Miller', sets(['G. Miller'], ['G. Miller'], []));
        assert.deepEqual(c, { name: 'G. Miller', admin: true });
        assert.equal(c.manager, undefined);
    });
    test('linksDesigner is additive — an admin who is also a designer gets both', () => {
        assert.deepEqual(claimsForTier('G. Miller', sets(['G. Miller'], [], ['G. Miller'])),
            { name: 'G. Miller', admin: true, linksDesigner: true });
    });
    test('an ordinary designer (S. Silva) → { name, linksDesigner } (no admin/manager)', () => {
        assert.deepEqual(claimsForTier('S. Silva', sets([], [], ['S. Silva'])),
            { name: 'S. Silva', linksDesigner: true });
    });
});

describe('computeOrphanLabels', () => {
    const active = new Set(['g.miller@myb-roster.local', 'a.staff@myb-roster.local']);
    test('flags a @myb-roster.local account not in the active set', () => {
        const users = [{ uid: 'u1', email: 'leaver@myb-roster.local', displayName: 'B. Gone' }];
        assert.deepEqual(computeOrphanLabels(users, active), [{ uid: 'u1', label: 'B. Gone' }]);
    });
    test('never flags an active member, an already-disabled account, a non-@myb-roster email, or an email-less account', () => {
        const users = [
            { uid: 'u1', email: 'g.miller@myb-roster.local', displayName: 'G. Miller' }, // active → keep
            { uid: 'u2', email: 'old@myb-roster.local', disabled: true },                // already disabled → skip
            { uid: 'u3', email: 'someone@gmail.com' },                                   // not our domain → skip
            { uid: 'u4' },                                                               // no email → skip
        ];
        assert.deepEqual(computeOrphanLabels(users, active), []);
    });
    test('falls back to email as the label when displayName is absent', () => {
        const users = [{ uid: 'u9', email: 'leaver@myb-roster.local' }];
        assert.deepEqual(computeOrphanLabels(users, active), [{ uid: 'u9', label: 'leaver@myb-roster.local' }]);
    });
    test('empty / missing user list → []', () => {
        assert.deepEqual(computeOrphanLabels([], active), []);
        assert.deepEqual(computeOrphanLabels(undefined, active), []);
    });
});
