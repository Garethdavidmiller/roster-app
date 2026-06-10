// Tests for links-design.js — pure link-design maths (no DOM, no Firebase).
// Run: node --test links-design.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    DAYS,
    classifyShift,
    normaliseCustomShift,
    startMinutes,
    endMinutes,
    calcCoverage,
    calcHourlyCoverage,
    generatePatterns,
    runDesignChecks,
    dayClass,
} from './links-design.js';

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
    const patterns = generatePatterns({ slots: SLOTS, spare: SPARE, lines: 27 });
    assert.ok(patterns);
    for (const d of DAYS) {
        const cls = dayClass(d);
        const counts = {};
        let spare = 0;
        for (let w = 1; w <= 27; w++) {
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

test('generatePatterns produces all 27 lines with all 7 days', () => {
    const patterns = generatePatterns({ slots: SLOTS, spare: SPARE, lines: 27 });
    for (let w = 1; w <= 27; w++) {
        const p = patterns[String(w)];
        assert.ok(p, `line ${w}`);
        for (const d of DAYS) assert.ok(typeof p[d] === 'string', `line ${w} ${d}`);
    }
});

test('generatePatterns never produces a short turnaround (forward body-clock rotation)', () => {
    const patterns = generatePatterns({ slots: SLOTS, spare: SPARE, lines: 27 });
    const checks = runDesignChecks(patterns, 27);
    assert.equal(checks.turnarounds.length, 0,
        `expected no turnarounds, got: ${JSON.stringify(checks.turnarounds)}`);
});

test('generatePatterns rejects totals over the line count', () => {
    const big = [{ time: '06:20-14:20', weekday: 28, sat: 0, sun: 0 }];
    assert.equal(generatePatterns({ slots: big, lines: 27 }), null);
    // spare pushes it over
    assert.equal(generatePatterns({
        slots: [{ time: '06:20-14:20', weekday: 25, sat: 0, sun: 0 }],
        spare: { weekday: 3, sat: 0, sun: 0 },
        lines: 27,
    }), null);
});

test('generatePatterns rejects invalid input', () => {
    assert.equal(generatePatterns({ slots: [], lines: 27 }), null);
    assert.equal(generatePatterns({ slots: [{ time: 'nonsense', weekday: 1, sat: 0, sun: 0 }], lines: 27 }), null);
    assert.equal(generatePatterns({ slots: [{ time: '06:20-14:20', weekday: -1, sat: 0, sun: 0 }], lines: 27 }), null);
    assert.equal(generatePatterns({ slots: [{ time: '06:20-14:20', weekday: 1.5, sat: 0, sun: 0 }], lines: 27 }), null);
});

test('generatePatterns accepts a many-slot wave profile (real roster shape)', () => {
    // Approximate the live roster: ~14 distinct times across the day.
    const waves = [
        '06:20-13:35', '06:20-13:45', '06:20-14:20', '07:00-16:00',
        '08:00-16:30', '08:00-17:00', '11:00-19:30', '12:00-21:00',
        '13:30-22:00', '14:00-22:30', '15:00-23:30', '15:15-23:55',
    ].map(time => ({ time, weekday: 1, sat: 1, sun: 1 }));
    waves[2].weekday = 2; // 06:20-14:20 ×2
    const patterns = generatePatterns({ slots: waves, spare: { weekday: 4, sat: 4, sun: 4 }, lines: 27 });
    assert.ok(patterns);
    const checks = runDesignChecks(patterns, 27);
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

test('calcHourlyCoverage clamps a wrapping end to midnight (defensive)', () => {
    const patterns = {
        '1': { sun: 'RD', mon: '20:30-04:30', tue: 'RD', wed: 'RD', thu: 'RD', fri: 'RD', sat: 'RD' },
    };
    const hc = calcHourlyCoverage(patterns, 1);
    assert.equal(hc.mon.hours[23], 1);
    assert.equal(hc.mon.hours[2], 0); // not bled into the small hours of the same day
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
