// Tests for links-design.js — pure link-design maths (no DOM, no Firebase).
// Run: node --test links-design.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    DAYS,
    classifyShift,
    normaliseCustomShift,
    startMinutes,
    endMinutes,
    endMinutesAbs,
    MIN_REST_MINUTES,
    calcCoverage,
    calcHourlyCoverage,
    generatePatterns,
    runDesignChecks,
    dayClass,
    canonicaliseShift,
    normalisePatterns,
    ROTATING_LINES,
} from './links-design.js';
import { CONFIG } from './roster-data.js';

// classifyShift hardcodes the Early/Late/Night start-hour boundaries (4/11/21) because links-design.js
// is DELIBERATELY standalone (imports nothing from roster-data — see .claude/rules/links-design.md). The
// same boundaries live in CONFIG (EARLY_START/EARLY_SHIFT/NIGHT_START_THRESHOLD), so if Chiltern ever
// shifts the Early/Late cutoff, the two could silently diverge. This parity test ties them (cross-file
// review E6): it asserts classifyShift's boundaries still match CONFIG — without coupling the modules.
test('classifyShift boundaries stay in sync with CONFIG Early/Late/Night thresholds (E6)', () => {
    const at = (/** @type {number} */ h) => `${String(h).padStart(2, '0')}:00-${String((h + 2) % 24).padStart(2, '0')}:00`;
    const E = CONFIG.EARLY_START_THRESHOLD, L = CONFIG.EARLY_SHIFT_THRESHOLD, N = CONFIG.NIGHT_START_THRESHOLD;
    assert.equal(classifyShift(at(E)),     'early', `hour ${E} (EARLY_START_THRESHOLD) → early`);
    assert.equal(classifyShift(at(L - 1)), 'early', `hour ${L - 1} → early`);
    assert.equal(classifyShift(at(L)),     'late',  `hour ${L} (EARLY_SHIFT_THRESHOLD) → late`);
    assert.equal(classifyShift(at(N - 1)), 'late',  `hour ${N - 1} → late`);
    assert.equal(classifyShift(at(N)),     'night', `hour ${N} (NIGHT_START_THRESHOLD) → night`);
    assert.equal(classifyShift(at(E - 1)), 'night', `hour ${E - 1} → night (pre-Early)`);
});

// ---------- classifyShift ----------

test('classifyShift buckets', () => {
    assert.equal(classifyShift('RD'), 'rd');
    assert.equal(classifyShift('OFF'), 'rd');
    assert.equal(classifyShift(''), 'rd');
    assert.equal(classifyShift('SPARE'), 'spare');
    assert.equal(classifyShift('06:20-14:20'), 'early');
    assert.equal(classifyShift('10:59-18:00'), 'early');
    assert.equal(classifyShift('11:00-19:30'), 'late');
    assert.equal(classifyShift('20:59-23:00'), 'late');
    assert.equal(classifyShift('21:00-05:00'), 'night'); // defensive only — CEAs have no nights
});

// ---------- normaliseCustomShift ----------

test('normaliseCustomShift pads and validates', () => {
    assert.equal(normaliseCustomShift('6:00-14:00'), '06:00-14:00');
    assert.equal(normaliseCustomShift(' 09:30 - 17:30 '), '09:30-17:30');
    assert.equal(normaliseCustomShift('09:30–17:30'), '09:30-17:30'); // en dash
});

test('normaliseCustomShift rejects night starts (CEAs do not work nights)', () => {
    assert.equal(normaliseCustomShift('21:00-05:00'), null);
    assert.equal(normaliseCustomShift('23:30-07:30'), null);
    assert.equal(normaliseCustomShift('03:59-12:00'), null);
    assert.equal(normaliseCustomShift('04:00-12:00'), '04:00-12:00'); // boundary: first valid start
    assert.equal(normaliseCustomShift('20:59-23:59'), '20:59-23:59'); // boundary: last valid start
});

test('normaliseCustomShift rejects a wrapping (over-midnight) shift', () => {
    // Evening start passed the start-hour guard but wraps past midnight — coverage + rest maths
    // break (phantom ~26h rest hides a real short turnaround), so it must be rejected.
    assert.equal(normaliseCustomShift('20:00-04:00'), null);
    assert.equal(normaliseCustomShift('14:00-06:00'), null);
    assert.equal(normaliseCustomShift('12:00-12:00'), null); // zero-length / equal
});

test('normaliseCustomShift rejects garbage', () => {
    assert.equal(normaliseCustomShift(null), null);
    assert.equal(normaliseCustomShift(''), null);
    assert.equal(normaliseCustomShift('hello'), null);
    assert.equal(normaliseCustomShift('25:00-26:00'), null);
    assert.equal(normaliseCustomShift('09:61-17:00'), null);
});

// ---------- start/end minutes ----------

test('startMinutes / endMinutes', () => {
    assert.equal(startMinutes('06:20-14:20'), 6 * 60 + 20);
    assert.equal(endMinutes('06:20-14:20'), 14 * 60 + 20);
    assert.equal(startMinutes('RD'), null);
    assert.equal(endMinutes('SPARE'), null);
});

// ---------- dayClass ----------

test('dayClass maps days to target classes', () => {
    assert.equal(dayClass('sun'), 'sun');
    assert.equal(dayClass('sat'), 'sat');
    for (const d of ['mon', 'tue', 'wed', 'thu', 'fri']) assert.equal(dayClass(d), 'weekday');
});

// ---------- generatePatterns ----------

const SLOTS = [
    { time: '06:20-14:20', weekday: 4, sat: 3, sun: 2 },
    { time: '08:00-16:30', weekday: 3, sat: 2, sun: 1 },
    { time: '11:00-19:30', weekday: 2, sat: 1, sun: 1 },
    { time: '15:15-23:55', weekday: 4, sat: 3, sun: 2 },
];
const SPARE = { weekday: 3, sat: 2, sun: 1 };

test('generatePatterns meets every day-class target exactly', () => {
    const patterns = generatePatterns({ slots: SLOTS, spare: SPARE, lines: 28 });
    assert.ok(patterns);
    for (const d of DAYS) {
        const cls = dayClass(d);
        const counts = {};
        let spare = 0;
        for (let w = 1; w <= 28; w++) {
            const s = patterns[String(w)][d];
            if (s === 'SPARE') spare++;
            else if (s !== 'RD') counts[s] = (counts[s] || 0) + 1;
        }
        for (const slot of SLOTS) {
            assert.equal(counts[slot.time] || 0, slot[cls], `${slot.time} on ${d}`);
        }
        assert.equal(spare, SPARE[cls], `spare on ${d}`);
    }
});

test('generatePatterns produces all 28 lines with all 7 days', () => {
    const patterns = generatePatterns({ slots: SLOTS, spare: SPARE, lines: 28 });
    for (let w = 1; w <= 28; w++) {
        const p = patterns[String(w)];
        assert.ok(p, `line ${w}`);
        for (const d of DAYS) assert.ok(typeof p[d] === 'string', `line ${w} ${d}`);
    }
});

test('generatePatterns never produces a short turnaround (forward body-clock rotation)', () => {
    const patterns = generatePatterns({ slots: SLOTS, spare: SPARE, lines: 28 });
    const checks = runDesignChecks(patterns, 28);
    assert.equal(checks.turnarounds.length, 0,
        `expected no turnarounds, got: ${JSON.stringify(checks.turnarounds)}`);
});

test('generatePatterns rejects totals over the line count', () => {
    const big = [{ time: '06:20-14:20', weekday: 29, sat: 0, sun: 0 }];
    assert.equal(generatePatterns({ slots: big, lines: 28 }), null);
    // spare pushes it over
    assert.equal(generatePatterns({
        slots: [{ time: '06:20-14:20', weekday: 26, sat: 0, sun: 0 }],
        spare: { weekday: 3, sat: 0, sun: 0 },
        lines: 28,
    }), null);
});

test('generatePatterns rejects invalid input', () => {
    assert.equal(generatePatterns({ slots: [], lines: 28 }), null);
    assert.equal(generatePatterns({ slots: [{ time: 'nonsense', weekday: 1, sat: 0, sun: 0 }], lines: 28 }), null);
    assert.equal(generatePatterns({ slots: [{ time: '06:20-14:20', weekday: -1, sat: 0, sun: 0 }], lines: 28 }), null);
    assert.equal(generatePatterns({ slots: [{ time: '06:20-14:20', weekday: 1.5, sat: 0, sun: 0 }], lines: 28 }), null);
});

test('generatePatterns accepts a many-slot wave profile (real roster shape)', () => {
    // Approximate the live roster: ~14 distinct times across the day.
    const waves = [
        '06:20-13:35', '06:20-13:45', '06:20-14:20', '07:00-16:00',
        '08:00-16:30', '08:00-17:00', '11:00-19:30', '12:00-21:00',
        '13:30-22:00', '14:00-22:30', '15:00-23:30', '15:15-23:55',
    ].map(time => ({ time, weekday: 1, sat: 1, sun: 1 }));
    waves[2].weekday = 2; // 06:20-14:20 ×2
    const patterns = generatePatterns({ slots: waves, spare: { weekday: 4, sat: 4, sun: 4 }, lines: 28 });
    assert.ok(patterns);
    const checks = runDesignChecks(patterns, 28);
    assert.equal(checks.turnarounds.length, 0);
});

// ---------- calcCoverage ----------

test('calcCoverage counts per type per day', () => {
    const patterns = {
        '1': { sun: 'RD', mon: '06:20-14:20', tue: 'SPARE', wed: '15:15-23:55', thu: 'RD', fri: 'RD', sat: 'RD' },
        '2': { sun: '06:20-14:20', mon: 'RD', tue: 'RD', wed: 'RD', thu: 'RD', fri: 'RD', sat: 'RD' },
    };
    const cov = calcCoverage(patterns, 2);
    assert.equal(cov.mon.early, 1);
    assert.equal(cov.tue.spare, 1);
    assert.equal(cov.wed.late, 1);
    assert.equal(cov.sun.early, 1);
    assert.equal(cov.mon.rd, 1);
});

// ---------- calcHourlyCoverage ----------

test('calcHourlyCoverage counts on-duty heads per hour', () => {
    const patterns = {
        '1': { sun: 'RD', mon: '06:20-14:20', tue: 'RD', wed: 'RD', thu: 'RD', fri: 'RD', sat: 'RD' },
        '2': { sun: 'RD', mon: '08:00-16:30', tue: 'RD', wed: 'RD', thu: 'RD', fri: 'RD', sat: 'RD' },
        '3': { sun: 'RD', mon: 'SPARE',       tue: 'RD', wed: 'RD', thu: 'RD', fri: 'RD', sat: 'RD' },
    };
    const hc = calcHourlyCoverage(patterns, 3);
    assert.equal(hc.mon.hours[5], 0);   // nobody before 06:00
    assert.equal(hc.mon.hours[6], 1);   // 06:20 start covers the 06:00 hour
    assert.equal(hc.mon.hours[8], 2);   // both on
    assert.equal(hc.mon.hours[14], 2);  // 06:20-14:20 still on at 14:00, 08:00-16:30 on
    assert.equal(hc.mon.hours[15], 1);  // first shift ended 14:20
    assert.equal(hc.mon.hours[16], 1);  // 16:00 hour — ends 16:30
    assert.equal(hc.mon.hours[17], 0);
    assert.equal(hc.mon.spare, 1);
    assert.equal(hc.tue.hours.every(n => n === 0), true);
});

// ---------- the midnight-crossing guard (v19.47) ----------
//
// Nothing in the CEA link reaches any of this — duties finish 23:55, and normaliseCustomShift
// rejects a wrapping value outright — so these tests exist to stop a LATENT rule that fails
// silently towards "compliant" from being relied on later. Both defects ran the same way: a
// wrapping duty looked SAFER than it is.

describe('endMinutesAbs — one reading of a duty that runs past midnight', () => {
    test('an ordinary duty is unchanged', () => {
        assert.equal(endMinutesAbs('06:20-14:20'), 14 * 60 + 20);
        assert.equal(endMinutesAbs('15:15-23:55'), 23 * 60 + 55);
    });
    test('a wrapping duty gains 24h rather than going backwards', () => {
        assert.equal(endMinutesAbs('20:30-04:30'), 28 * 60 + 30);
        assert.equal(endMinutesAbs('22:00-00:30'), 24 * 60 + 30);
    });
    test('no times, no answer', () => {
        for (const s of ['RD', 'OFF', 'SPARE', '', null, undefined, 42]) assert.equal(endMinutesAbs(s), null);
    });
});

test('calcHourlyCoverage puts a wrapping duty’s small hours on the NEXT day', () => {
    const patterns = {
        '1': { sun: 'RD', mon: '20:30-04:30', tue: 'RD', wed: 'RD', thu: 'RD', fri: 'RD', sat: 'RD' },
    };
    const hc = calcHourlyCoverage(patterns, 1);
    assert.equal(hc.mon.hours[20], 1, 'on duty from 20:30');
    assert.equal(hc.mon.hours[23], 1, 'still on at 23:00');
    assert.equal(hc.mon.hours[2], 0, 'and NOT in the small hours of its own day');
    // The half of this that the old clamp threw away: those hours are real people on duty.
    assert.equal(hc.tue.hours[0], 1);
    assert.equal(hc.tue.hours[4], 1, '04:30 finish covers the 04:00 hour');
    assert.equal(hc.tue.hours[5], 0);
});

test('calcHourlyCoverage wraps Saturday’s spill round to Sunday', () => {
    const patterns = {
        '1': { sun: 'RD', mon: 'RD', tue: 'RD', wed: 'RD', thu: 'RD', fri: 'RD', sat: '21:00-01:00' },
    };
    const hc = calcHourlyCoverage(patterns, 1);
    assert.equal(hc.sat.hours[23], 1);
    assert.equal(hc.sun.hours[0], 1, 'the week is circular — Saturday night spills into Sunday');
    assert.equal(hc.sun.hours[1], 0);
});

test('a wrapping duty eats the rest that follows it, instead of being credited a phantom day of it', () => {
    const patterns = {};
    for (let w = 1; w <= 3; w++) {
        patterns[String(w)] = { sun: 'RD', mon: 'RD', tue: 'RD', wed: 'RD', thu: 'RD', fri: 'RD', sat: 'RD' };
    }
    patterns['1'].mon = '20:00-04:00';   // finishes 04:00 Tuesday
    patterns['1'].tue = '06:20-14:20';   // back on 2h20m later
    const checks = runDesignChecks(patterns, 3);
    const t = checks.turnarounds.find(x => x.fromDay === 'mon');
    // The old `(1440 - end) + start` read 04:00 as this-morning and returned 1580 min (26h), which
    // is above the 12h floor — so the most dangerous turnaround the module can express was the one
    // it reported as fine.
    assert.ok(t, 'a 2h20m turnaround must be flagged');
    assert.equal(t.restMinutes, 140);
    assert.ok(t.restMinutes < MIN_REST_MINUTES);
});

// ---------- runDesignChecks ----------

test('runDesignChecks finds a short turnaround across a line boundary', () => {
    // Line 1 Sat late finish, line 2 Sun early start — the cross-boundary weekend.
    const patterns = {};
    for (let w = 1; w <= 3; w++) {
        patterns[String(w)] = { sun: 'RD', mon: 'RD', tue: 'RD', wed: 'RD', thu: 'RD', fri: 'RD', sat: 'RD' };
    }
    patterns['1'].sat = '15:15-23:55';
    patterns['2'].sun = '06:20-14:20';
    const checks = runDesignChecks(patterns, 3);
    assert.equal(checks.turnarounds.length, 1);
    assert.equal(checks.turnarounds[0].fromLine, 1);
    assert.equal(checks.turnarounds[0].toLine, 2);
    assert.equal(checks.turnarounds[0].restMinutes, (24 * 60 - (23 * 60 + 55)) + (6 * 60 + 20));
});

test('runDesignChecks counts weekends off across the wrap', () => {
    const patterns = {};
    for (let w = 1; w <= 3; w++) {
        patterns[String(w)] = { sun: 'RD', mon: 'RD', tue: 'RD', wed: 'RD', thu: 'RD', fri: 'RD', sat: 'RD' };
    }
    // all rest → every weekend off
    assert.equal(runDesignChecks(patterns, 3).weekendsOff, 3);
    patterns['2'].sun = '06:20-14:20'; // breaks the line1-sat→line2-sun weekend
    assert.equal(runDesignChecks(patterns, 3).weekendsOff, 2);
});

test('runDesignChecks longest stretch wraps the cycle', () => {
    const patterns = {
        '1': { sun: '06:20-14:20', mon: '06:20-14:20', tue: 'RD', wed: 'RD', thu: 'RD', fri: 'RD', sat: '06:20-14:20' },
        '2': { sun: '08:00-16:30', mon: 'RD', tue: 'RD', wed: 'RD', thu: 'RD', fri: 'RD', sat: 'RD' },
    };
    // Wrap: line2 Sat(RD)… line1 starts cycle. Worked run: line1 sat → line2 sun = 2;
    // line1 sun+mon = 2. Longest = 2.
    assert.equal(runDesignChecks(patterns, 2).longestStretch, 2);
});

test('runDesignChecks flags lines that are entirely rest days as unfilled', () => {
    const patterns = {
        '1': { sun: 'RD', mon: '06:20-14:20', tue: '06:20-14:20', wed: '06:20-14:20', thu: '06:20-14:20', fri: '06:20-14:20', sat: 'RD' },
        '2': { sun: 'RD', mon: 'RD', tue: 'RD', wed: 'RD', thu: 'RD', fri: 'RD', sat: 'RD' }, // unfilled
        '3': { sun: 'SPARE', mon: 'RD', tue: 'RD', wed: 'RD', thu: 'RD', fri: 'RD', sat: 'RD' }, // SPARE counts as filled
    };
    const checks = runDesignChecks(patterns, 3);
    assert.deepEqual(checks.unfilledLines, [2]);
});

test('runDesignChecks reports no unfilled lines when every line works at least once', () => {
    const patterns = {};
    for (let w = 1; w <= 5; w++) {
        patterns[String(w)] = { sun: 'RD', mon: '06:20-14:20', tue: 'RD', wed: 'RD', thu: 'RD', fri: 'RD', sat: 'RD' };
    }
    assert.deepEqual(runDesignChecks(patterns, 5).unfilledLines, []);
});

// ── The two readers of a shift string must agree about what a time IS (v19.38) ──────────────────
describe('canonical shift form', () => {
    test('classifyShift and startMinutes can no longer disagree — for ANY input', () => {
        // THE BUG THIS PINS, and the strongest form of it. classifyShift used to read the hour with
        // slice(0,2), which is looser than the strict parser the coverage maths uses — so
        // "6:00-14:00" was a perfectly ordinary early to one reader and unreadable to the other. The
        // shift counted in the day totals and the early/late balance while being ABSENT from the
        // hourly heat map and exempt from every short-turnaround check: silent, and in the worst
        // direction, since the heat map is what a coverage gap is spotted on.
        const everything = [
            '06:20-14:20', '14:00-22:00', '04:00-12:00', '20:59-23:59',
            '6:00-14:00', '9:5-17:00', '25:00-30:00', 'nonsense', '',
            'SPARE', 'RD', 'OFF', null, undefined, 7,
        ];
        for (const v of everything) {
            const cls = classifyShift(/** @type {any} */ (v));
            if (cls === 'early' || cls === 'late') {
                assert.notEqual(startMinutes(v), null,
                    `${JSON.stringify(v)} is classified ${cls} but has no readable start time`);
            }
        }
    });

    test('canonicalising makes a legacy unpadded value readable by both', () => {
        assert.equal(classifyShift('6:00-14:00'), 'night', 'unpadded is NOT trusted as a normal early');
        const fixed = canonicaliseShift('6:00-14:00');
        assert.equal(fixed, '06:00-14:00');
        assert.equal(classifyShift(fixed), 'early');
        assert.notEqual(startMinutes(fixed), null);
    });

    test('a value that cannot be canonicalised is visible, not silent', () => {
        // "9:5-17:00" has a single-digit MINUTE and cannot be repaired safely — 9:5 is either 9:05
        // or 9:50, and guessing would invent a shift time. So it is left alone and falls to 'night',
        // which the grid footer renders as an `N:` count. CEAs never work nights, so any N: at all is
        // a visible "something here is wrong" flag. Do NOT map it to 'rd' — that hides it again.
        //
        // This case was found BY this suite: the first version of the invariant above asserted only
        // that canonicalised values were readable, and it failed on exactly this input.
        assert.equal(canonicaliseShift('9:5-17:00'), '9:5-17:00', 'not repaired — the minute is ambiguous');
        assert.equal(classifyShift('9:5-17:00'), 'night', 'but never passed off as a normal early');
    });

    test('canonicaliseShift leaves non-times and impossible times untouched', () => {
        for (const v of ['SPARE', 'RD', 'OFF', '', 'nonsense', '25:00-30:00', '10:99-11:00'])
            assert.equal(canonicaliseShift(v), v);
        assert.equal(canonicaliseShift(null), null);
        assert.equal(canonicaliseShift(undefined), undefined);
        assert.equal(canonicaliseShift(7), 7, 'a non-string passes through unharmed');
    });

    test('normalisePatterns fixes a whole design and mutates nothing', () => {
        const input = { '1': { mon: '6:00-14:00', tue: 'SPARE', wed: 'RD' }, '2': { mon: '07:00-15:00' } };
        const frozen = JSON.stringify(input);
        const out = normalisePatterns(input);
        assert.equal(out['1'].mon, '06:00-14:00');
        assert.equal(out['1'].tue, 'SPARE');
        assert.equal(out['2'].mon, '07:00-15:00');
        assert.equal(JSON.stringify(input), frozen, 'input is not mutated');
    });

    test('normalisePatterns survives the junk a legacy document can hold', () => {
        const out = normalisePatterns({ '1': null, '2': 'not-an-object', '3': { mon: '6:00-14:00' }, '4': {} });
        assert.deepEqual(Object.keys(out).sort(), ['3', '4'], 'unusable rows are dropped, not crashed on');
        assert.equal(out['3'].mon, '06:00-14:00');
        assert.equal(normalisePatterns(null) && Object.keys(normalisePatterns(null)).length, 0);
    });

    test('a canonicalised legacy design becomes visible to the coverage heat map', () => {
        // End-to-end of the defect: the same design, before and after.
        const legacy = { '1': { sun: 'RD', mon: '6:00-14:00', tue: 'RD', wed: 'RD', thu: 'RD', fri: 'RD', sat: 'RD' } };
        // Before canonicalising, the strict classifier refuses to call it an early — it lands in
        // `night`, the visible N: bucket — and it is absent from the heat map. Both readers agree it
        // is not a normal shift, which is the point: the OLD behaviour had them disagreeing.
        assert.equal(calcCoverage(legacy, 1).mon.early, 0);
        assert.equal(calcCoverage(legacy, 1).mon.night, 1, 'flagged, not silently counted as early');
        assert.equal(Math.max(...calcHourlyCoverage(legacy, 1).mon.hours), 0, 'and absent from the heat map');
        const fixed = normalisePatterns(legacy);
        assert.equal(calcCoverage(fixed, 1).mon.early, 1, 'a real early once canonicalised…');
        assert.equal(Math.max(...calcHourlyCoverage(fixed, 1).mon.hours), 1, '…and present in the heat map');
    });
});

describe('the rotation length is declared once', () => {
    test('ROTATING_LINES is the default for every window in this module', () => {
        // Three literal 28s (links-app's pair, links-analysis's pair, these defaults) kept in step by
        // a comment is how a grid renders one number of rows while the checks examine another.
        assert.equal(ROTATING_LINES, 28);
        const all = {};
        for (let i = 1; i <= ROTATING_LINES; i++) all[String(i)] = { sun: 'RD', mon: '06:00-14:00', tue: 'RD', wed: 'RD', thu: 'RD', fri: 'RD', sat: 'RD' };
        assert.equal(runDesignChecks(all).totalWeeks, ROTATING_LINES);
        assert.equal(calcCoverage(all).mon.early, ROTATING_LINES);
    });
});
