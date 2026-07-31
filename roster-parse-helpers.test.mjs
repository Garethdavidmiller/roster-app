/**
 * Unit tests for functions/roster-parse-helpers.js
 *
 * Pure functions only — no Firebase, no secrets, no HTTP.
 * Run: node --test roster-parse-helpers.test.mjs
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'module';
import { isCutoffDate, teamMembers } from './roster-data.js';

const require = createRequire(import.meta.url);
const {
    normaliseShift,
    buildWeekDates,
    extractAIJson,
    HEADER_TO_INDEX,
    headerToDayIndex,
    mapColumnHeadersToDates,
    buildSafeEntries,
    applySundayScanCorrections,
    applyColumnScanCrossCheck,
    normaliseScanValue,
    parseStrictIsoDate,
    isPayCutoffDay,
    nameToEmail,
    nameToPassword,
    fileSignatureMatches,
    NOTIFICATION_FEATURES,
    buildPushPayload,
    shouldDeleteSubscription,
    parseSetupActionFlags,
    resolveRosterAuthConfig,
    claimsForTier,
    computeOrphanLabels,

    shouldRecordResetRequest,
    buildResetRequestNotice,
    shouldNotifyAdmin,
    summariseSignIns,} = require('./functions/roster-parse-helpers.js');

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
    test('punctuated paper-roster codes strip to canonical (v16.83)', () => {
        assert.equal(normaliseShift('A/L'),  'AL');
        assert.equal(normaliseShift('A.L.'), 'AL');
        assert.equal(normaliseShift('R.D.'), 'RD');
        assert.equal(normaliseShift('S.P.'), 'SPARE');
        assert.equal(normaliseShift('S/P'),  'SPARE');
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
    test('paid-absence codes HA (hospital appointment), OD, ML (maternity leave) → SICK, case-insensitive, never UNKNOWN', () => {
        assert.equal(normaliseShift('HA'), 'SICK');
        assert.equal(normaliseShift('OD'), 'SICK');
        assert.equal(normaliseShift('ML'), 'SICK');   // maternity leave
        assert.equal(normaliseShift('ha'), 'SICK');
        assert.equal(normaliseShift('od'), 'SICK');
        assert.equal(normaliseShift('ml'), 'SICK');
        assert.equal(normaliseShift('M.L'), 'SICK');  // punctuated paper-roster form
    });
    test('raw sick codes SC/SN and punctuated absence forms → SICK (v16.68 hardening)', () => {
        // The prompt tells the AI to return SICK for SC/SN, but a raw echo must still map —
        // otherwise a genuine absence surfaces as an UNREADABLE cell instead of Absent.
        assert.equal(normaliseShift('SC'), 'SICK');
        assert.equal(normaliseShift('SN'), 'SICK');
        assert.equal(normaliseShift('sc'), 'SICK');
        // Punctuated paper-roster forms.
        assert.equal(normaliseShift('O.D.'), 'SICK');
        assert.equal(normaliseShift('O/D'), 'SICK');
        assert.equal(normaliseShift('H.A'), 'SICK');
        assert.equal(normaliseShift('S/N'), 'SICK');
        // Dot-stripping must NOT swallow dotted time forms (existing behaviour preserved).
        assert.equal(normaliseShift('05.30-11.30'), '05:30-11:30');
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
    test('union course words → UNION (multi-word roster label; "Union course")', () => {
        assert.equal(normaliseShift('Union course'), 'UNION');
        assert.equal(normaliseShift('UNION COURSE'), 'UNION');
        assert.equal(normaliseShift('union course'), 'UNION');
        assert.equal(normaliseShift('Union'), 'UNION');
        assert.equal(normaliseShift('Union  course'), 'UNION');   // OCR double-space tolerated
        assert.equal(normaliseShift('Union course RDW'), 'UNION RDW');
        assert.equal(normaliseShift('RDW Union course'), 'UNION RDW');
    });
    test('meeting words → MEET (roster code "MTG"; also "MEETING")', () => {
        assert.equal(normaliseShift('MTG'), 'MEET');
        assert.equal(normaliseShift('mtg'), 'MEET');
        assert.equal(normaliseShift('Meeting'), 'MEET');
        assert.equal(normaliseShift('MEETING'), 'MEET');
        assert.equal(normaliseShift('Meetings'), 'MEET');
        assert.equal(normaliseShift('MTG RDW'), 'MEET RDW');
        assert.equal(normaliseShift('RDW MTG'), 'MEET RDW');
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
        for (const v of ['TRG', 'Training', 'Induction', 'Assessment', 'TRG RDW', 'Team Day', 'TEAM', 'Union course', 'UNION', 'MTG', 'Meeting']) {
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
    test('skips a BALANCED non-JSON brace pair in the preamble and finds the real object', () => {
        // The pre-fix extractor locked onto the first '{' and threw when its balanced span ({curly})
        // wasn't valid JSON — even though the real object followed. It now keeps scanning.
        const result = extractAIJson('use {curly} placeholders in notes\n{"parsed": [{"Mon": "RD"}]}');
        assert.deepEqual(result, { parsed: [{ Mon: 'RD' }] });
    });
    test('still throws when NO candidate span is valid JSON', () => {
        assert.throws(() => extractAIJson('{nope} and {also nope}'), SyntaxError);
    });
    // REGRESSION (v18.84): the scan used to stop at the first span that PARSED, so a preamble
    // containing a valid JSON literal — "{}" is the realistic one — was returned as the payload and
    // the real roster object discarded. parseRosterPDF then rejected it ("The AI returned an
    // unexpected format") and the whole upload failed even though the AI had answered correctly.
    test('skips a VALID-JSON literal in the preamble and finds the roster object', () => {
        const real = '{"parsed": [{"Mon": "RD"}], "columnHeaders": ["Mon"]}';
        assert.deepEqual(extractAIJson('Blank cells are {} in this output.\n' + real),
            { parsed: [{ Mon: 'RD' }], columnHeaders: ['Mon'] });
        assert.deepEqual(extractAIJson('For example {"a":1} means something.\n' + real),
            { parsed: [{ Mon: 'RD' }], columnHeaders: ['Mon'] });
    });
    test('an object that does not match the roster shape is still returned when nothing better exists', () => {
        // Shape-matching must never turn a previously-working return into a throw: if no span
        // carries parsed[]/columnHeaders[], the first parsed object is returned exactly as before.
        assert.deepEqual(extractAIJson('{"foo": "bar"}'), { foo: 'bar' });
        assert.deepEqual(extractAIJson('note {} here\n{"foo": "bar"}'), {});
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

// ── headerToDayIndex (shared header→index resolver for the 3 parse layers) ──────

describe('headerToDayIndex', () => {
    test('trims and lowercases before lookup', () => {
        assert.equal(headerToDayIndex('  Sun '), 0);
        assert.equal(headerToDayIndex('TUESDAY'), 2);
    });
    test('3-char fallback resolves a long form not in the alias map', () => {
        // "thursd" isn't a key; slice(0,3) = "thu" → 4.
        assert.equal(headerToDayIndex('Thursd'), 4);
    });
    test('exact alias keys resolve directly', () => {
        assert.equal(headerToDayIndex('weds'), 3);
        assert.equal(headerToDayIndex('saturday'), 6);
    });
    test('unrecognised header → undefined', () => {
        assert.equal(headerToDayIndex('Payday'), undefined);
        assert.equal(headerToDayIndex(''), undefined);
    });
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
    test('member-cell keys are read tolerantly when they drift from columnHeaders (v16.84)', () => {
        // Headers are the abbreviated form, but the AI keyed the member's days as full lowercase
        // names. The old exact-header read missed these → filled RD; the tolerant map recovers them.
        const entries = buildSafeEntries(
            [{ memberName: 'G. Miller', sunday: 'AL', monday: '05:30-11:30', tuesday: 'RD',
               wednesday: 'RD', thursday: 'RD', friday: 'RD', saturday: 'RD' }],
            HEADERS, DATES,
        );
        assert.equal(entries[0].shifts['2026-03-29'], 'AL');            // sunday → Sun
        assert.equal(entries[0].shifts['2026-03-30'], '05:30-11:30');  // monday → Mon
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

    test('enforces the length budgets: an over-long caller headline/body is clipped with an ellipsis', () => {
        const longHead = 'Payday Friday and a great many extra words that run well past the forty character title budget';
        const longBody = 'Open the Pay Calculator to estimate your pay for this period and also read a lot of additional text far beyond the eighty character body budget line';
        const p = buildPushPayload({
            feature: 'pay', headline: longHead, body: longBody, url: `${BASE}/paycalc.html`,
        });
        assert.ok(p.title.length <= 40, `title clipped to budget (was ${p.title.length})`);
        assert.ok(p.body.length <= 80, `body clipped to budget (was ${p.body.length})`);
        assert.ok(p.title.endsWith('…') && p.body.endsWith('…'), 'clipped text ends with an ellipsis');
        assert.ok(p.title.startsWith('💷'), 'the leading feature emoji is preserved through the clip');
    });

    test('within-budget headline/body are returned unchanged (no spurious ellipsis)', () => {
        const p = buildPushPayload({ feature: 'huddle', body: 'Tap to read the latest day plan.', baseUrl: BASE });
        assert.equal(p.title, '📋 Latest Huddle');
        assert.equal(p.body, 'Tap to read the latest day plan.');
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

// ── shouldDeleteSubscription (fan-out dead-subscription decision, v16.15/v16.81) ──────────────
describe('shouldDeleteSubscription', () => {
    test('deletes on 410 Gone and 404 Not Found (genuinely dead endpoints)', () => {
        assert.equal(shouldDeleteSubscription(410), true);
        assert.equal(shouldDeleteSubscription(404), true);
    });
    test('does NOT delete on 401 — a VAPID-auth misconfig would wipe the whole collection', () => {
        assert.equal(shouldDeleteSubscription(401), false);
    });
    test('does NOT delete on transient/server errors (5xx, 429, network) or missing status', () => {
        for (const code of [500, 502, 503, 429, 400, 403, undefined, null, 0, NaN])
            assert.equal(shouldDeleteSubscription(code), false, `status ${code} must be kept`);
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

// ── normaliseScanValue + applyColumnScanCrossCheck (the general day-shift defence) ──

describe('normaliseScanValue', () => {
    test('blank tokens normalise to RD', () => {
        for (const t of ['blank', 'BLANK', '', ' - ', 'N/A', 'na', 'RD', 'OFF', 'empty']) {
            assert.equal(normaliseScanValue(t), 'RD', `token "${t}"`);
        }
    });
    test('shift values normalise through the same vocabulary as the row read', () => {
        assert.equal(normaliseScanValue('0530-1130'), '05:30-11:30');
        assert.equal(normaliseScanValue('RDW 06:00-14:00'), 'RDW|06:00-14:00');
        assert.equal(normaliseScanValue('SP'), 'SPARE');
    });
    test('no-signal inputs return null (missing, non-string, unreadable garble)', () => {
        assert.equal(normaliseScanValue(undefined), null);
        assert.equal(normaliseScanValue(null), null);
        assert.equal(normaliseScanValue({}), null);
        assert.equal(normaliseScanValue(() => {}), null);   // inherited-property lookup
        assert.equal(normaliseScanValue('total garble ###'), null);
    });
});

describe('applyColumnScanCrossCheck', () => {
    const DATES = [
        '2026-03-29', '2026-03-30', '2026-03-31',
        '2026-04-01', '2026-04-02', '2026-04-03', '2026-04-04',
    ];
    const HEADERS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    /** Build a shifts map from 7 values (Sun→Sat). */
    const shiftsOf = vals => Object.fromEntries(DATES.map((d, i) => [d, vals[i]]));
    /** Build a columnScan where this member's column values are the 7 given (raw scan grammar). */
    const scanOf = vals => Object.fromEntries(HEADERS.map((h, i) => [h, { 'G. Miller': vals[i] }]));

    // The TRUE week used throughout: blank Wednesday mid-week (the cell the row read drops).
    const TRUE_ROW  = ['RD', '06:00-14:00', '07:00-15:00', 'RD', '08:00-16:00', '09:00-17:00', 'RD'];
    const TRUE_SCAN = ['blank', '06:00-14:00', '07:00-15:00', 'blank', '08:00-16:00', '09:00-17:00', 'blank'];

    test('full agreement → row untouched', () => {
        const entries = [{ memberName: 'G. Miller', shifts: shiftsOf(TRUE_ROW) }];
        applyColumnScanCrossCheck(entries, scanOf(TRUE_SCAN), HEADERS, DATES);
        assert.deepEqual(entries[0].shifts, shiftsOf(TRUE_ROW));
    });

    test('mid-week LEFT drift (blank Wednesday dropped) is repaired to the column scan', () => {
        // The row read skipped the blank Wed: Thu/Fri values slid one day left, Sat empty.
        const drifted = ['RD', '06:00-14:00', '07:00-15:00', '08:00-16:00', '09:00-17:00', 'RD', 'RD'];
        const entries = [{ memberName: 'G. Miller', shifts: shiftsOf(drifted) }];
        applyColumnScanCrossCheck(entries, scanOf(TRUE_SCAN), HEADERS, DATES);
        assert.deepEqual(entries[0].shifts, shiftsOf(TRUE_ROW),
            'the right-shift repair must restore the true week');
    });

    test('RIGHT drift is repaired too (the direction the Sunday pass never caught)', () => {
        // Row misaligned right: every value one day late; Sunday slot shows RD, Monday shows nothing… build it:
        const drifted = ['RD', 'RD', '06:00-14:00', '07:00-15:00', 'RD', '08:00-16:00', '09:00-17:00'];
        const entries = [{ memberName: 'G. Miller', shifts: shiftsOf(drifted) }];
        applyColumnScanCrossCheck(entries, scanOf(TRUE_SCAN), HEADERS, DATES);
        assert.deepEqual(entries[0].shifts, shiftsOf(TRUE_ROW));
    });

    test('an isolated single-cell disagreement is flagged UNREADABLE, not repaired or overwritten', () => {
        const oneOff  = [...TRUE_ROW]; oneOff[4] = '10:00-18:00';   // Thu differs from scan
        const entries = [{ memberName: 'G. Miller', shifts: shiftsOf(oneOff) }];
        applyColumnScanCrossCheck(entries, scanOf(TRUE_SCAN), HEADERS, DATES);
        const thu = entries[0].shifts[DATES[4]];
        assert.ok(thu.startsWith('UNKNOWN|'), `expected UNKNOWN sentinel, got "${thu}"`);
        assert.ok(thu.includes('10:00-18:00') && thu.includes('08:00-16:00'),
            'the sentinel must carry BOTH readings for the admin');
        // Every other day untouched.
        for (const i of [0, 1, 2, 3, 5, 6]) assert.equal(entries[0].shifts[DATES[i]], TRUE_ROW[i]);
    });

    test('scattered multi-cell disagreement with NO clean shift → each cell flagged, none overwritten', () => {
        const messy   = [...TRUE_ROW]; messy[1] = '11:00-19:00'; messy[5] = 'AL';
        const entries = [{ memberName: 'G. Miller', shifts: shiftsOf(messy) }];
        applyColumnScanCrossCheck(entries, scanOf(TRUE_SCAN), HEADERS, DATES);
        assert.ok(entries[0].shifts[DATES[1]].startsWith('UNKNOWN|'));
        assert.ok(entries[0].shifts[DATES[5]].startsWith('UNKNOWN|'));
        assert.equal(entries[0].shifts[DATES[4]], TRUE_ROW[4], 'agreeing cells stay');
    });

    test('fail-open: no columnScan / missing member / unreadable scan values → row untouched', () => {
        const drifted = ['RD', '06:00-14:00', '07:00-15:00', '08:00-16:00', '09:00-17:00', 'RD', 'RD'];
        const a = [{ memberName: 'G. Miller', shifts: shiftsOf(drifted) }];
        applyColumnScanCrossCheck(a, undefined, HEADERS, DATES);
        assert.deepEqual(a[0].shifts, shiftsOf(drifted));

        const b = [{ memberName: 'G. Miller', shifts: shiftsOf(drifted) }];
        applyColumnScanCrossCheck(b, Object.fromEntries(HEADERS.map(h => [h, { 'S. Other': 'RD' }])), HEADERS, DATES);
        assert.deepEqual(b[0].shifts, shiftsOf(drifted));

        const c = [{ memberName: 'G. Miller', shifts: shiftsOf(drifted) }];
        applyColumnScanCrossCheck(c, scanOf(Array(7).fill('### garble ###')), HEADERS, DATES);
        assert.deepEqual(c[0].shifts, shiftsOf(drifted));
    });

    test('too few signalled days (<5) never auto-repairs — flags instead (conservative)', () => {
        const drifted = ['RD', '06:00-14:00', '07:00-15:00', '08:00-16:00', '09:00-17:00', 'RD', 'RD'];
        const entries = [{ memberName: 'G. Miller', shifts: shiftsOf(drifted) }];
        // Only 3 columns carry a signal for this member.
        const partial = { 'Wed': { 'G. Miller': 'blank' }, 'Thu': { 'G. Miller': '08:00-16:00' }, 'Fri': { 'G. Miller': '09:00-17:00' } };
        applyColumnScanCrossCheck(entries, partial, HEADERS, DATES);
        assert.ok(entries[0].shifts[DATES[3]].startsWith('UNKNOWN|'), 'Wed flagged');
        assert.equal(entries[0].shifts[DATES[1]], '06:00-14:00', 'unsignalled days untouched');
    });

    test('cells the row read already flagged UNKNOWN are left alone (no double-flag)', () => {
        const row = [...TRUE_ROW]; row[2] = 'UNKNOWN|smudge';
        const entries = [{ memberName: 'G. Miller', shifts: shiftsOf(row) }];
        applyColumnScanCrossCheck(entries, scanOf(TRUE_SCAN), HEADERS, DATES);
        assert.equal(entries[0].shifts[DATES[2]], 'UNKNOWN|smudge');
    });

    test('agreement in RDW and keyword vocabulary (scan raw forms normalise before comparing)', () => {
        const row  = ['RD', 'RDW|06:00-14:00', 'SPARE', 'RD', 'AL', 'TRG RDW', 'RD'];
        const scan = ['blank', 'RDW 06:00-14:00', 'SP', '-', 'A/L', 'TRG RDW', 'blank'];
        const entries = [{ memberName: 'G. Miller', shifts: shiftsOf(row) }];
        applyColumnScanCrossCheck(entries, scanOf(scan), HEADERS, DATES);
        assert.deepEqual(entries[0].shifts, shiftsOf(row), 'vocabulary differences are not disagreements');
    });

    // ── Rest ↔ Absence resolution (OD/HA reliability) ─────────────────────────────
    test('a Mon–Thu OD block the row read as RD but the column scan read as absence → recorded as Absent', () => {
        // The exact screenshot scenario: a long-term-sick "OD" block that the parsed row missed
        // (read blank→RD) but the column scan caught (OD→SICK). Each such cell must record the
        // absence, not drop it as UNREADABLE.
        const row  = ['RD', 'RD', 'RD', 'RD', 'RD', '09:00-17:00', 'RD'];
        const scan = ['blank', 'OD', 'OD', 'OD', 'OD', '09:00-17:00', 'blank'];
        const entries = [{ memberName: 'G. Miller', shifts: shiftsOf(row) }];
        applyColumnScanCrossCheck(entries, scanOf(scan), HEADERS, DATES);
        assert.deepEqual(entries[0].shifts,
            shiftsOf(['RD', 'SICK', 'SICK', 'SICK', 'SICK', '09:00-17:00', 'RD']),
            'the OD block records as Absent (SICK), never dropped to RD or flagged UNREADABLE');
    });

    test('Rest↔Absent resolves in either read order (SICK row vs RD scan, and vice versa)', () => {
        const row  = ['RD', 'SICK', 'RD', '08:00-16:00', 'RD', 'RD', 'RD'];   // row saw the absence Mon
        const scan = ['blank', 'blank', 'HA', '08:00-16:00', 'blank', 'blank', 'blank']; // scan saw it Tue
        const entries = [{ memberName: 'G. Miller', shifts: shiftsOf(row) }];
        applyColumnScanCrossCheck(entries, scanOf(scan), HEADERS, DATES);
        assert.equal(entries[0].shifts[DATES[1]], 'SICK', 'Mon: SICK(row) ↔ RD(scan) → Absent');
        assert.equal(entries[0].shifts[DATES[2]], 'SICK', 'Tue: RD(row) ↔ HA(scan) → Absent');
    });

    test('a Sunday Rest↔Absent disagreement is NOT auto-resolved (Sunday is non-contracted)', () => {
        const row  = ['RD', 'RD', '06:00-14:00', 'RD', '08:00-16:00', 'RD', 'RD'];
        const scan = ['SICK', 'blank', '06:00-14:00', 'blank', '08:00-16:00', 'blank', 'blank'];
        const entries = [{ memberName: 'G. Miller', shifts: shiftsOf(row) }];
        applyColumnScanCrossCheck(entries, scanOf(scan), HEADERS, DATES);
        assert.ok(entries[0].shifts[DATES[0]].startsWith('UNKNOWN|'), 'Sunday absence must not be recorded');
    });

    test('a flagged cell records BOTH candidate values, so the review table can offer a pick', () => {
        // The prose message names both readings; these are the same two as VALUES. Without them the
        // review row is a dead end — it shows the ambiguity and the admin has to leave the upload and
        // record the day by hand in Change a Shift (owner report, Jul 2026).
        const row  = ['RD', 'AL', 'RD', 'RD', '08:00-16:00', 'RD', 'RD'];
        const scan = ['blank', 'blank', 'blank', 'blank', '08:00-16:00', 'blank', 'blank'];
        const entries = [{ memberName: 'G. Miller', shifts: shiftsOf(row) }];
        const st = applyColumnScanCrossCheck(entries, scanOf(scan), HEADERS, DATES);
        assert.ok(entries[0].shifts[DATES[1]].startsWith('UNKNOWN|'), 'still flagged, still never auto-written');
        assert.deepEqual(st.choices[`G. Miller|${DATES[1]}`], ['AL', 'RD'],
            'row read first, column scan second — the same order the message names them');
    });

    test('an auto-RESOLVED disagreement offers no choice (there is nothing left to ask)', () => {
        const row  = ['RD', 'SICK', 'RD', 'RD', '08:00-16:00', 'RD', 'RD'];
        const scan = ['blank', 'blank', 'blank', 'blank', '08:00-16:00', 'blank', 'blank'];
        const entries = [{ memberName: 'G. Miller', shifts: shiftsOf(row) }];
        const st = applyColumnScanCrossCheck(entries, scanOf(scan), HEADERS, DATES);
        assert.equal(entries[0].shifts[DATES[1]], 'SICK', 'Rest↔Absent still resolves to the absence');
        assert.deepEqual({ ...st.choices }, {}, 'resolved cells must not also appear as an open question');
    });

    test('the "couldn\'t read" message uses app language (Absent), never the internal SICK value', () => {
        // A SICK-vs-AL disagreement is NOT rest↔absence, so it still flags — but the message must
        // say "Absent", not "SICK" (staff-facing wording rule).
        const row  = ['RD', 'SICK', 'RD', 'RD', '08:00-16:00', 'RD', 'RD'];
        const scan = ['blank', 'AL', 'blank', 'blank', '08:00-16:00', 'blank', 'blank'];
        const entries = [{ memberName: 'G. Miller', shifts: shiftsOf(row) }];
        applyColumnScanCrossCheck(entries, scanOf(scan), HEADERS, DATES);
        const flagged = entries[0].shifts[DATES[1]];
        assert.ok(flagged.startsWith('UNKNOWN|'), 'still flagged (SICK vs AL is a real ambiguity)');
        assert.ok(flagged.includes('Absent') && !flagged.includes('SICK'), `message must say Absent, not SICK: "${flagged}"`);
        assert.ok(flagged.includes('AL'), 'and still names the other reading');
    });
});

// ── v16.69 cross-check hardening: copied-scan safety, OFF equivalence, RDW upgrade ──

describe('applyColumnScanCrossCheck — review-fix hardening', () => {
    const DATES = [
        '2026-03-29', '2026-03-30', '2026-03-31',
        '2026-04-01', '2026-04-02', '2026-04-03', '2026-04-04',
    ];
    const HEADERS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const shiftsOf = vals => Object.fromEntries(DATES.map((d, i) => [d, vals[i]]));
    const scanOf   = vals => Object.fromEntries(HEADERS.map((h, i) => [h, { 'G. Miller': vals[i] }]));

    test('PIPELINE ORDER: a columnScan lazily COPIED from a drifted row must not reverse the Sunday repair', () => {
        // True week: blank Sunday, then m t w th f s. Row read is the classic full-row LEFT drift.
        const drifted  = ['06:00-14:00', '07:00-15:00', '08:00-16:00', 'RD', '09:00-17:00', '10:00-18:00', 'RD'];
        const trueWeek = ['RD', '06:00-14:00', '07:00-15:00', '08:00-16:00', 'RD', '09:00-17:00', '10:00-18:00'];
        const entries  = [{ memberName: 'G. Miller', shifts: shiftsOf(drifted) }];
        // The model copied columnScan from its own (drifted) row read.
        const copiedScan = scanOf(drifted);
        // Production order (index.js): cross-check FIRST (copied scan agrees → no-op) …
        applyColumnScanCrossCheck(entries, copiedScan, HEADERS, DATES);
        assert.deepEqual(entries[0].shifts, shiftsOf(drifted), 'copied scan must be a no-op');
        // … THEN the Sunday corrections (sundayScan says blank, Sat empty → Case-A right-shift).
        applySundayScanCorrections(entries, { 'G. Miller': 'blank' }, true, DATES);
        assert.deepEqual(entries[0].shifts, shiftsOf(trueWeek),
            'the Case-A repair must land LAST and stand — reversing it was the v16.68 review finding');
    });

    test('OFF in the row read is equivalent to RD in the scan — no false UNREADABLE flood on CES rosters', () => {
        const row  = ['OFF', '06:00-14:00', 'OFF', 'OFF', '07:00-15:00', 'OFF', 'OFF'];
        const scan = ['blank', '06:00-14:00', 'OFF', 'blank', '07:00-15:00', '-', 'blank'];
        const entries = [{ memberName: 'G. Miller', shifts: shiftsOf(row) }];
        applyColumnScanCrossCheck(entries, scanOf(scan), HEADERS, DATES);
        assert.deepEqual(entries[0].shifts, shiftsOf(row), 'OFF days must not be flagged');
    });

    test('RDW marker dropped by the ROW read is upgraded from the scan (per-cell, no flag)', () => {
        const row  = ['RD', '06:00-14:00', 'RD', 'RD', '08:00-16:00', 'RD', 'RD'];
        const scan = ['blank', 'RDW 06:00-14:00', 'blank', 'blank', '08:00-16:00', 'blank', 'blank'];
        const entries = [{ memberName: 'G. Miller', shifts: shiftsOf(row) }];
        applyColumnScanCrossCheck(entries, scanOf(scan), HEADERS, DATES);
        assert.equal(entries[0].shifts[DATES[1]], 'RDW|06:00-14:00', 'row upgraded to the RDW form');
        assert.equal(entries[0].shifts[DATES[4]], '08:00-16:00', 'agreeing plain time untouched');
    });

    test('RDW marker dropped by the SCAN keeps the row value (no downgrade, no flag)', () => {
        const row  = ['RD', 'RDW|06:00-14:00', 'RD', 'RD', '08:00-16:00', 'RD', 'RD'];
        const scan = ['blank', '06:00-14:00', 'blank', 'blank', '08:00-16:00', 'blank', 'blank'];
        const entries = [{ memberName: 'G. Miller', shifts: shiftsOf(row) }];
        applyColumnScanCrossCheck(entries, scanOf(scan), HEADERS, DATES);
        assert.equal(entries[0].shifts[DATES[1]], 'RDW|06:00-14:00', 'row RDW preserved');
    });
});

// ── applyColumnScanCrossCheck — coverage stats (v16.70) ───────────────────────

describe('applyColumnScanCrossCheck coverage stats', () => {
    const DATES = [
        '2026-03-29', '2026-03-30', '2026-03-31',
        '2026-04-01', '2026-04-02', '2026-04-03', '2026-04-04',
    ];
    const HEADERS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const shiftsOf = vals => Object.fromEntries(DATES.map((d, i) => [d, vals[i]]));
    const ROW = ['RD', '06:00-14:00', 'RD', 'RD', '07:00-15:00', 'RD', 'RD'];

    test('missing columnScan → { checked: 0 } (the fail-open the review UI must surface)', () => {
        const entries = [{ memberName: 'G. Miller', shifts: shiftsOf(ROW) }];
        const st = applyColumnScanCrossCheck(entries, undefined, HEADERS, DATES);
        assert.equal(st.checked, 0);
        assert.equal(st.total, 1);
        // No scan ⇒ no disagreements ⇒ nothing for the review table to offer as a pick.
        assert.deepEqual({ ...st.choices }, {});
    });

    test('full scan coverage → checked === total', () => {
        const entries = [{ memberName: 'G. Miller', shifts: shiftsOf(ROW) }];
        const scan = Object.fromEntries(HEADERS.map((h, i) => [h, { 'G. Miller': ROW[i] === 'RD' ? 'blank' : ROW[i] }]));
        const st = applyColumnScanCrossCheck(entries, scan, HEADERS, DATES);
        assert.equal(st.checked, 1);
        assert.equal(st.total, 1);
        assert.deepEqual({ ...st.choices }, {}, 'the two reads agree everywhere — nothing to resolve');
    });

    test('a member with <5 signalled days does not count as checked (partial)', () => {
        const entries = [
            { memberName: 'G. Miller',   shifts: shiftsOf(ROW) },
            { memberName: 'L. Springer', shifts: shiftsOf(ROW) },
        ];
        // Full coverage for Miller; only 2 columns carry Springer.
        const scan = Object.fromEntries(HEADERS.map((h, i) => {
            const col = { 'G. Miller': ROW[i] === 'RD' ? 'blank' : ROW[i] };
            if (h === 'Mon' || h === 'Thu') col['L. Springer'] = ROW[i];
            return [h, col];
        }));
        const st = applyColumnScanCrossCheck(entries, scan, HEADERS, DATES);
        assert.equal(st.checked, 1);
        assert.equal(st.total, 2);
    });
});

// ── shouldRecordResetRequest — the throttle on the public reset-request endpoint ────────────────
// The one piece of judgement in an otherwise mechanical endpoint, so it lives here as a pure
// function. Note what it is NOT for: the collection cannot grow past the roster (the doc id IS the
// member name), so this is not the flood defence — it stops repeat taps inflating the `count` the
// admin reads as "how stuck is this person", and stops each tap being a notification.
describe('shouldRecordResetRequest', () => {
    const TEN_MIN = 10 * 60 * 1000;
    const NOW = 1_700_000_000_000;

    test('records a first-ever request', () => {
        assert.equal(shouldRecordResetRequest(null, NOW, TEN_MIN), true);
        assert.equal(shouldRecordResetRequest(undefined, NOW, TEN_MIN), true);
    });

    test('absorbs a repeat inside the window', () => {
        assert.equal(shouldRecordResetRequest(NOW - 1000, NOW, TEN_MIN), false);
        assert.equal(shouldRecordResetRequest(NOW - (TEN_MIN - 1), NOW, TEN_MIN), false);
    });

    test('records again once the window has passed (boundary is inclusive)', () => {
        assert.equal(shouldRecordResetRequest(NOW - TEN_MIN, NOW, TEN_MIN), true);
        assert.equal(shouldRecordResetRequest(NOW - (TEN_MIN + 1), NOW, TEN_MIN), true);
    });

    // Fail OPEN on junk: a member who cannot sign in must never be blocked from asking because a
    // stored timestamp was unreadable. Recording a duplicate costs the admin one extra row; refusing
    // to record leaves them with no way to ask at all.
    test('treats junk or impossible timestamps as never-asked', () => {
        for (const bad of [NaN, 'yesterday', {}, 0, -1, null]) {
            assert.equal(shouldRecordResetRequest(/** @type {any} */ (bad), NOW, TEN_MIN), true,
                `${String(bad)} should be treated as never-asked`);
        }
    });

    // A device clock ahead of the server would make (now - last) negative.
    test('a future timestamp does not permanently block requests… it absorbs, never throws', () => {
        assert.equal(shouldRecordResetRequest(NOW + 60_000, NOW, TEN_MIN), false);
    });
});

// ── buildResetRequestNotice — the admin's push wording (Phase 2) ────────────────────────────────
// The notification IS the product of this feature, so its text is asserted rather than eyeballed.
// It is also the only place the queue depth is user-visible outside the Operations card, and the
// two must agree — the endpoint feeds both from the same resetRequests count.
describe('buildResetRequestNotice', () => {
    test('a single waiting request names the member and does not mention others', () => {
        const n = buildResetRequestNotice('S. Silva', 1);
        assert.equal(n.headline, 'Reset requests — 1 waiting');
        assert.equal(n.body, 'S. Silva asked for a password reset.');
        assert.ok(!/other/.test(n.body));
    });

    test('the headline carries the queue depth, because the tag makes each push REPLACE the last', () => {
        assert.equal(buildResetRequestNotice('S. Silva', 3).headline, 'Reset requests — 3 waiting');
        assert.equal(buildResetRequestNotice('S. Silva', 12).headline, 'Reset requests — 12 waiting');
    });

    test('names the member who just asked, and counts the OTHERS (not the total) in the body', () => {
        assert.equal(buildResetRequestNotice('S. Silva', 2).body,
                     'S. Silva asked for a reset. 1 other waiting.');
        assert.equal(buildResetRequestNotice('S. Silva', 4).body,
                     'S. Silva asked for a reset. 3 others waiting.');
    });

    // Fail SAFE, never throw: this runs inside the public endpoint's success path, and the caller
    // already degrades a failed count read to 1. A junk value must produce a sane notification, not
    // "NaN waiting" — and certainly not an exception that loses the notification.
    test('coerces junk, zero and negative counts to a single waiting request', () => {
        for (const bad of [0, -5, NaN, null, undefined, 'lots', {}]) {
            const n = buildResetRequestNotice('S. Silva', /** @type {any} */ (bad));
            assert.equal(n.headline, 'Reset requests — 1 waiting', `${String(bad)} → 1`);
            assert.ok(!/NaN|undefined|null/.test(n.headline + n.body));
        }
    });

    test('a fractional count is floored rather than rendered with a decimal point', () => {
        assert.equal(buildResetRequestNotice('S. Silva', 2.7).headline, 'Reset requests — 2 waiting');
    });

    // The design language's truncation budgets (.claude/rules/notifications.md): title <= ~40 chars
    // INCLUDING the leading emoji, body <= ~80. buildPushPayload clips past those, so anything that
    // trips this test would reach a real phone silently ellipsised.
    test('stays inside the design language budgets for the longest realistic inputs', () => {
        const longest = teamMembers.reduce((a, m) => (m.name.length > a.length ? m.name : a), '');
        for (const pending of [1, 2, 10, 99]) {
            const n = buildResetRequestNotice(longest, pending);
            assert.ok(`🙋 ${n.headline}`.length <= 40, `title too long: ${n.headline}`);
            assert.ok(n.body.length <= 80, `body too long: ${n.body}`);
        }
    });

    // Tone rules, asserted rather than trusted: calm and factual, no exclamation, exactly one emoji
    // and it leads the TITLE (never the body).
    test('follows the notification tone rules', () => {
        const n = buildResetRequestNotice('S. Silva', 2);
        assert.ok(!/!/.test(n.headline + n.body), 'no exclamation marks');
        assert.ok(!/\p{Extended_Pictographic}/u.test(n.headline + n.body),
                  'the emoji is added by buildPushPayload, never baked into the text');
        assert.ok(!/urgent|immediately|locked out/i.test(n.headline + n.body),
                  'a request is not proof of urgency — the admin decides (PASSWORD_PLAN §13)');
    });
});

// ── summariseSignIns — the exact unique-account count (v18.96) ──────────────────────────────────
// The Usage card's "active accounts" is device-deduped, so a member on a phone AND a laptop counts
// twice. This is the exact counterpart, and every judgement that could silently distort a headcount
// lives in this pure function — so it is asserted rather than eyeballed in a Cloud Function log.
describe('summariseSignIns', () => {
    const DAY = 24 * 60 * 60 * 1000;
    const NOW = 1_700_000_000_000;
    /** The roster allowlist most tests use. */
    const ROSTER = new Set(['a.one@myb-roster.local', 'b.two@myb-roster.local',
                            'c.three@myb-roster.local', 'd.four@myb-roster.local',
                            'e.five@myb-roster.local']);
    /** @param {string} email @param {number|null} agoDays @param {boolean} [disabled] */
    const user = (email, agoDays, disabled = false) => ({
        email,
        disabled,
        metadata: { lastSignInTime: agoDays === null ? null : new Date(NOW - agoDays * DAY).toUTCString() },
    });

    test('counts each account once, in every window it qualifies for', () => {
        const stats = summariseSignIns([
            user('a.one@myb-roster.local', 1),      // within 7 and 30
            user('b.two@myb-roster.local', 20),     // within 30 only
            user('c.three@myb-roster.local', 200),  // neither
        ], NOW, ROSTER);
        assert.deepEqual(stats, { total: 3, last7: 1, last30: 2, neverSignedIn: 0 });
    });

    // Uniqueness is a property of the DATA here, not something the function enforces — Firebase has
    // one record per account no matter how many devices signed in on it. That is the whole reason
    // this route exists, so pin it: many sign-ins on one account is still one account.
    test('one account is one account however many devices it signed in from', () => {
        const stats = summariseSignIns([user('a.one@myb-roster.local', 0)], NOW, ROSTER);
        assert.equal(stats.total, 1);
        assert.equal(stats.last30, 1);
    });

    // The actionable number: provisioned by Set up accounts, never used. Firebase leaves
    // lastSignInTime empty for those. Treating it as an old sign-in would hide exactly the people
    // worth chasing.
    test('an account that has never signed in is counted as such, not as a stale sign-in', () => {
        const stats = summariseSignIns([
            user('a.one@myb-roster.local', null),
            { email: 'b.two@myb-roster.local' },                       // no metadata at all
            { email: 'c.three@myb-roster.local', metadata: {} },       // metadata, no field
            { email: 'd.four@myb-roster.local', metadata: { lastSignInTime: 'not a date' } },
        ], NOW, ROSTER);
        assert.deepEqual(stats, { total: 4, last7: 0, last30: 0, neverSignedIn: 4 });
    });

    // A leaver is not a provisioned account waiting to be used. Counting them in `total` would
    // permanently depress the "N of M" ratio the card shows.
    test('disabled (leaver) accounts are ignored entirely, including in the total', () => {
        const stats = summariseSignIns([
            user('a.one@myb-roster.local', 1),
            user('b.two@myb-roster.local', 1, /* disabled */ true),
            user('c.three@myb-roster.local', null, /* disabled */ true),
        ], NOW, ROSTER);
        assert.deepEqual(stats, { total: 1, last7: 1, last30: 1, neverSignedIn: 0 });
    });

    // THE v18.97 FIX (external review). Disabling leavers is a MANUAL admin action ("Set up accounts
    // → Disable accounts for leavers"); until it is run — or if it failed on one account — an ENABLED
    // account exists for someone no longer on the roster. Filtering on "not disabled" counted them,
    // inflating both the total and the never-signed-in figure on a card that says "exact".
    test('an ENABLED account that is no longer on the roster is excluded', () => {
        const stats = summariseSignIns([
            user('a.one@myb-roster.local', 1),
            user('gone.leaver@myb-roster.local', 400),      // enabled orphan, sweep not yet run
            user('never.leaver@myb-roster.local', null),    // enabled orphan, never used
        ], NOW, ROSTER);
        assert.deepEqual(stats, { total: 1, last7: 1, last30: 1, neverSignedIn: 0 });
    });

    test('a non-roster account of any kind in the project is excluded', () => {
        const stats = summariseSignIns([
            user('a.one@myb-roster.local', 1),
            user('someone@gmail.com', 1),
            user('service-account@example.com', null),
        ], NOW, ROSTER);
        assert.deepEqual(stats, { total: 1, last7: 1, last30: 1, neverSignedIn: 0 });
    });

    // Mirrors recordUsage's write-time CONFIG.ADMIN_NAMES filter — the figures must reflect real
    // staff, not the developer's own testing, or the two halves of the card would disagree. The
    // caller omits admins from the allowlist rather than passing a separate denylist.
    test('admins are excluded by absence from the allowlist, case-insensitively', () => {
        const stats = summariseSignIns([
            user('G.Miller@MYB-Roster.local', 1),   // admin: not in ROSTER
            user('A.One@MYB-Roster.local', 1),      // roster member, mixed case
        ], NOW, ROSTER);
        assert.deepEqual(stats, { total: 1, last7: 1, last30: 1, neverSignedIn: 0 });
    });

    test('an account with no email is skipped rather than counted as never-signed-in', () => {
        const stats = summariseSignIns([{ metadata: { lastSignInTime: null } }], NOW, ROSTER);
        assert.deepEqual(stats, { total: 0, last7: 0, last30: 0, neverSignedIn: 0 });
    });

    // Inclusive boundary, same convention as shouldRecordResetRequest.
    test('the window boundary is inclusive', () => {
        assert.equal(summariseSignIns([user('a.one@myb-roster.local', 7)],  NOW, ROSTER).last7,  1);
        assert.equal(summariseSignIns([user('a.one@myb-roster.local', 30)], NOW, ROSTER).last30, 1);
        // One second past each boundary both accounts drop out of their OWN window — but the
        // 7-day one is still comfortably inside 30 days, so it moves down a band rather than away.
        const justOver = summariseSignIns(
            [user('a.one@myb-roster.local', 30), user('b.two@myb-roster.local', 7)], NOW + 1000, ROSTER);
        assert.equal(justOver.last7,  0);
        assert.equal(justOver.last30, 1);
    });

    // Clock skew must never make a real member vanish from the count.
    test('a future sign-in timestamp counts as recent, not as an error', () => {
        const stats = summariseSignIns([user('a.one@myb-roster.local', -5)], NOW, ROSTER);
        assert.deepEqual(stats, { total: 1, last7: 1, last30: 1, neverSignedIn: 0 });
    });

    test('an empty or junk user list yields zeroes rather than throwing', () => {
        for (const bad of [[], null, undefined, 'nope', {}]) {
            assert.deepEqual(summariseSignIns(/** @type {any} */ (bad), NOW, ROSTER),
                             { total: 0, last7: 0, last30: 0, neverSignedIn: 0 });
        }
        assert.deepEqual(summariseSignIns([null, undefined], NOW, ROSTER),
                         { total: 0, last7: 0, last30: 0, neverSignedIn: 0 });
    });

    // Fail CLOSED on a missing allowlist: a visibly-wrong zero beats a plausible number counted from
    // an unknown population on a card whose whole claim is exactness.
    test('a missing or empty allowlist counts nothing rather than everything', () => {
        const users = [user('a.one@myb-roster.local', 1), user('b.two@myb-roster.local', null)];
        for (const list of [new Set(), null, undefined]) {
            assert.deepEqual(summariseSignIns(users, NOW, /** @type {any} */ (list)),
                             { total: 0, last7: 0, last30: 0, neverSignedIn: 0 });
        }
    });

    // last7 is by construction a subset of last30, and both of last30+never <= total. A future
    // refactor that broke the nesting would produce a card claiming more recent than total users.
    test('the counts stay internally consistent', () => {
        const stats = summariseSignIns([
            user('a.one@myb-roster.local', 0), user('b.two@myb-roster.local', 6),
            user('c.three@myb-roster.local', 29), user('d.four@myb-roster.local', 400),
            user('e.five@myb-roster.local', null),
        ], NOW, ROSTER);
        assert.ok(stats.last7 <= stats.last30, 'last7 must be a subset of last30');
        assert.ok(stats.last30 + stats.neverSignedIn <= stats.total, 'windows cannot exceed the total');
        assert.deepEqual(stats, { total: 5, last7: 2, last30: 3, neverSignedIn: 1 });
    });
});

// ── shouldNotifyAdmin — one push per burst, not one per name (v18.97) ───────────────────────────
// The per-member throttle bounds how often ONE person can ring the admin's phone. It does nothing
// about a caller walking the PUBLIC roster and filing one request per name, which produced one
// targeted push each (external review). Fifty buzzes is both the nuisance and the reason a genuine
// request would then be ignored.
describe('shouldNotifyAdmin', () => {
    const FIVE_MIN = 5 * 60 * 1000;
    const NOW = 1_700_000_000_000;

    test('notifies when this is the only request', () => {
        assert.equal(shouldNotifyAdmin([], NOW, FIVE_MIN), true);
    });

    test('notifies when every other request is older than the window', () => {
        assert.equal(shouldNotifyAdmin([NOW - FIVE_MIN, NOW - 86_400_000], NOW, FIVE_MIN), true);
    });

    // The burst case: the roster is public, so fifty valid names can be filed in seconds. The first
    // rings; the rest ride on it — and because the feature shares one notification tag carrying the
    // queue depth, that first push stays an accurate summary of the whole queue.
    test('stays silent when another request landed inside the window', () => {
        assert.equal(shouldNotifyAdmin([NOW - 1000], NOW, FIVE_MIN), false);
        assert.equal(shouldNotifyAdmin([NOW - (FIVE_MIN - 1)], NOW, FIVE_MIN), false);
    });

    test('one recent request among many old ones is enough to coalesce', () => {
        assert.equal(shouldNotifyAdmin([NOW - 86_400_000, NOW - 2000, NOW - 90_000_000], NOW, FIVE_MIN), false);
    });

    // Fail OPEN throughout: a missed doorbell is worse than a duplicate one, and this must never be
    // the reason a locked-out member goes unnoticed.
    test('unreadable timestamps are not treated as evidence of a recent push', () => {
        for (const bad of [null, undefined, NaN, 0, -1, 'soon', {}]) {
            assert.equal(shouldNotifyAdmin([/** @type {any} */ (bad)], NOW, FIVE_MIN), true,
                `${String(bad)} should not suppress the notification`);
        }
    });

    test('a junk list yields a notification rather than throwing', () => {
        for (const bad of [null, undefined, 'nope', {}, 42]) {
            assert.equal(shouldNotifyAdmin(/** @type {any} */ (bad), NOW, FIVE_MIN), true);
        }
    });

    // A device clock ahead of the server must not silence the admin indefinitely.
    test('a future timestamp never suppresses the notification', () => {
        assert.equal(shouldNotifyAdmin([NOW + 600_000], NOW, FIVE_MIN), true);
    });

    test('the window boundary is exclusive — exactly one window old notifies again', () => {
        assert.equal(shouldNotifyAdmin([NOW - FIVE_MIN], NOW, FIVE_MIN), true);
    });
});
