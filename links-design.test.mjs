// Tests for links-design.js — pure link-design maths (no DOM, no Firebase).
// Run: node --test links-design.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    worstCaseWorkedRun,
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
    generateLink,
    groupIntoWaves,
    WAVE_SPAN_MINUTES,
    runDesignChecks,
    dayClass,
    canonicaliseShift,
    normalisePatterns,
    ROTATING_LINES,
    weeklyHours,
    dutyMinutes,
    CONTRACTED_HOURS_PER_WEEK,
} from './links-design.js';
import { CONFIG, weeklyRoster } from './roster-data.js';

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
const SPARE_LINES = 4;   // whole spare WEEKS (v19.58) — a count of lines, not a per-day headcount

test('generatePatterns meets every day-class target exactly', () => {
    const patterns = generatePatterns({ slots: SLOTS, spareLines: SPARE_LINES, lines: 28 });
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
        // Every day shows the SAME spare headcount, because a spare line is spare all week. That
        // equality across day classes is the whole change: the per-day model could and did produce
        // a different figure each day, which the real roster never has.
        assert.equal(spare, SPARE_LINES, `spare on ${d}`);
    }
});

test('a spare line is spare on ALL SEVEN DAYS — never a scattered spare day', () => {
    // The defect this replaced (v19.58, owner): the rotating window slid daily and carried spare as
    // one more segment, so a person was spare on some days and on a timed duty on others. The daily
    // SP headcount came out right, which is why it went unnoticed — the total was correct and the
    // distribution was wrong. The real roster has whole spare weeks only: main lines 1, 7, 12 and 17
    // are SPARE on every day and there is not one scattered spare day in it.
    const patterns = generatePatterns({ slots: SLOTS, spareLines: SPARE_LINES, lines: 28 });
    let full = 0;
    for (let w = 1; w <= 28; w++) {
        const days = DAYS.map(d => patterns[String(w)][d]);
        const n = days.filter(v => v === 'SPARE').length;
        assert.ok(n === 0 || n === 7, `line ${w} has ${n} spare days — a spare line is a whole WEEK`);
        if (n === 7) full++;
    }
    assert.equal(full, SPARE_LINES);
});

test('spare weeks are spread around the wheel, not bunched', () => {
    // The real roster puts them at 1, 7, 12, 17 of 20 — roughly every fifth line. Bunched spare
    // weeks would give one person two cover weeks back to back and everyone else none for months.
    const patterns = generatePatterns({ slots: SLOTS, spareLines: SPARE_LINES, lines: 28 });
    const rows = [];
    for (let w = 1; w <= 28; w++) if (patterns[String(w)].mon === 'SPARE') rows.push(w);
    assert.equal(rows.length, SPARE_LINES);
    const gaps = rows.map((r, i) => (i ? r - rows[i - 1] : r + 28 - rows[rows.length - 1]));
    const ideal = 28 / SPARE_LINES;
    for (const g of gaps) assert.ok(Math.abs(g - ideal) <= 1, `gap ${g} against an even ${ideal}`);
});

test('generatePatterns produces all 28 lines with all 7 days', () => {
    const patterns = generatePatterns({ slots: SLOTS, spareLines: SPARE_LINES, lines: 28 });
    for (let w = 1; w <= 28; w++) {
        const p = patterns[String(w)];
        assert.ok(p, `line ${w}`);
        for (const d of DAYS) assert.ok(typeof p[d] === 'string', `line ${w} ${d}`);
    }
});

test('generatePatterns never produces a short turnaround (forward body-clock rotation)', () => {
    const patterns = generatePatterns({ slots: SLOTS, spareLines: SPARE_LINES, lines: 28 });
    const checks = runDesignChecks(patterns, 28);
    assert.equal(checks.turnarounds.length, 0,
        `expected no turnarounds, got: ${JSON.stringify(checks.turnarounds)}`);
});

// ---------- the settled-week construction (v19.59) ----------

describe('waves', () => {
    test('slots within the FF19 threshold of each other are one wave', () => {
        const waves = groupIntoWaves([
            { time: '06:20-14:20', weekday: 2, sat: 1, sun: 1 },
            { time: '08:00-16:30', weekday: 2, sat: 1, sun: 1 },
            { time: '15:15-23:55', weekday: 2, sat: 1, sun: 1 },
        ]);
        assert.equal(waves.length, 2);
        assert.deepEqual(waves[0].map(s => s.time), ['06:20-14:20', '08:00-16:30']);
        assert.equal(WAVE_SPAN_MINUTES, 120);
    });

    test('a wave too small to fund one line is merged into its nearer neighbour', () => {
        // The roster seed produced exactly this: the two 08:30 weekend-only slots sat 30 minutes off
        // the morning wave and 2h30 off the middles, but 2h10 from the morning wave's FIRST slot —
        // so the span rule cut them adrift and one whole line existed to work Sat and Sun only.
        const slots = [
            { time: '06:20-14:20', weekday: 6, sat: 4, sun: 3 },
            { time: '08:30-16:30', weekday: 0, sat: 1, sun: 1 },
            { time: '15:15-23:55', weekday: 6, sat: 4, sun: 3 },
        ];
        assert.equal(groupIntoWaves(slots).length, 3, 'the raw span rule strands 08:30');
        const built = generateLink({ slots, spareLines: 4, lines: 28 });
        assert.equal(built.mode, 'settled');
        assert.equal(built.waves, 2, 'the stranded wave is merged, not left to hold a line of its own');
    });
});

describe('settled weeks', () => {
    /** Worked days for each line that is not a spare week. */
    const workedDays = (/** @type {any} */ p, n = 28) => {
        const out = [];
        for (let w = 1; w <= n; w++) {
            const row = p[String(w)];
            if (DAYS.every(d => row[d] === 'SPARE')) continue;
            out.push(DAYS.filter(d => row[d] !== 'RD' && row[d] !== 'OFF').length);
        }
        return out;
    };
    /** Widest gap between a line's earliest and latest start in one week. */
    const spreads = (/** @type {any} */ p, n = 28) => {
        const out = [];
        for (let w = 1; w <= n; w++) {
            const st = DAYS.map(d => startMinutes(p[String(w)][d])).filter(v => v !== null);
            if (st.length >= 2) out.push(Math.max(...st) - Math.min(...st));
        }
        return out;
    };

    test('a line stays inside its wave all week, so its start never moves more than the wave span', () => {
        // This is the whole point. Measured on the roster seed, the old construction gave a mean
        // within-week spread of 7h58 with EVERY line above 4h; the real main roster averages 3h44.
        // Nobody at Marylebone works a week that starts 15:25 on the Sunday and 06:20 on the
        // Wednesday, and the generator was producing 28 of them.
        const p = generatePatterns({ slots: SLOTS, spareLines: SPARE_LINES, lines: 28 });
        for (const s of spreads(p)) {
            assert.ok(s <= WAVE_SPAN_MINUTES, `within-week start spread ${s} exceeds one wave`);
        }
    });

    test('settled weeks still meet every day-class target exactly', () => {
        const p = generatePatterns({ slots: SLOTS, spareLines: SPARE_LINES, lines: 28 });
        for (const d of DAYS) {
            const cls = dayClass(d);
            const counts = {};
            for (let w = 1; w <= 28; w++) {
                const v = p[String(w)][d];
                if (v !== 'RD' && v !== 'SPARE') counts[v] = (counts[v] || 0) + 1;
            }
            for (const slot of SLOTS) assert.equal(counts[slot.time] || 0, slot[cls], `${slot.time} on ${d}`);
        }
    });

    test('settled weeks cost no fairness — the load spread is no wider than the fallback\'s', () => {
        // A shape improvement paid for with an unfair link is not an improvement, and the first TWO
        // attempts at this construction were both less fair than the thing they replaced: one gave a
        // whole line to a weekend-only wave, the other lapped a small block in three days and then
        // held the window still for four. Both produced somebody working two days a week.
        //
        // The claim is comparative, deliberately. An absolute floor ("nobody under 3 days") is a fact
        // about the TARGETS — these ones average 3.3 days a line — not about the construction, and it
        // would pass or fail on the fixture rather than on the code.
        const s = workedDays(generateLink({ slots: SLOTS, spareLines: SPARE_LINES, lines: 28 }).patterns);
        const r = workedDays(generateLink({ slots: SLOTS, spareLines: SPARE_LINES, lines: 28, settled: false }).patterns);
        const sum = (/** @type {number[]} */ a) => a.reduce((x, y) => x + y, 0);
        const span = (/** @type {number[]} */ a) => Math.max(...a) - Math.min(...a);
        assert.equal(sum(s), sum(r), 'both constructions place exactly the same total duty');
        assert.ok(span(s) <= span(r), `settled spans ${span(s)} days against the fallback's ${span(r)}`);
    });

    test('a lap is spread across the week, never front-loaded into the first few days', () => {
        // n = 3 under the old rule gave strides [1,1,1,0,0,0,0]: the window laps by Tuesday and then
        // sits still to Saturday, so the same lines work all four of those days.
        const slots = [{ time: '06:20-14:20', weekday: 2, sat: 1, sun: 1 }];
        const p = generatePatterns({ slots, spareLines: 0, lines: 3 });
        const days = [];
        for (let w = 1; w <= 3; w++) days.push(DAYS.filter(d => p[String(w)][d] !== 'RD').length);
        assert.deepEqual(days, [4, 4, 4], 'all three lines carry the same load');
    });

    test('it reports WHICH construction ran — the two give different designs', () => {
        const settled = generateLink({ slots: SLOTS, spareLines: SPARE_LINES, lines: 28 });
        const rotating = generateLink({ slots: SLOTS, spareLines: SPARE_LINES, lines: 28, settled: false });
        assert.equal(settled.mode, 'settled');
        assert.equal(rotating.mode, 'rotating');
        assert.notDeepEqual(settled.patterns, rotating.patterns);
        // generatePatterns keeps its old contract — patterns or null, nothing else.
        assert.deepEqual(generatePatterns({ slots: SLOTS, spareLines: SPARE_LINES, lines: 28 }), settled.patterns);
    });
});

describe('the rotating fallback no longer promises rest it cannot give', () => {
    // Documented for years as "a person's week only moves later, never a late finish then an early
    // start; asserted by tests". It was not true. Positions are read mod `working`, so every line
    // wraps from the front of the slot order to the back once a week, and that wrap IS the step —
    // it lands on a rest day only while the targets leave lines resting. The test that asserted it
    // staffed 13 of 24 lines, where the wrap always fell on RD.
    const DENSE = [
        { time: '06:20-14:20', weekday: 9, sat: 9, sun: 9 },
        { time: '11:00-19:30', weekday: 9, sat: 9, sun: 9 },
        { time: '15:15-23:55', weekday: 10, sat: 10, sun: 10 },
    ];

    test('at full staffing the old construction produced 27 short turnarounds — it now REFUSES', () => {
        const r = generateLink({ slots: DENSE, spareLines: 0, lines: 28, settled: false });
        assert.equal(r.patterns, null);
        assert.equal(r.reason, 'no-rest', 'refused for the real reason, not as a generic bad-input');
    });

    test('where it CAN run, no line finishes late and starts early the next morning', () => {
        // Teeth: with near-equal strides this fixture is fine, so the assertion that matters is the
        // one above. Here we only pin that the capped strides did not break the ordinary case.
        const r = generateLink({ slots: SLOTS, spareLines: SPARE_LINES, lines: 28, settled: false });
        assert.equal(r.mode, 'rotating');
        assert.equal(runDesignChecks(r.patterns, 28).turnarounds.length, 0);
    });

    test('a settled design survives the same dense targets the fallback refuses', () => {
        // Each line sits in one wave, so "everybody works seven days" costs nothing in body-clock
        // movement — which is exactly why settled is tried first.
        const s = generateLink({ slots: DENSE, spareLines: 0, lines: 28 });
        assert.equal(s.mode, 'settled');
        for (let w = 1; w <= 28; w++) {
            const st = DAYS.map(d => startMinutes(s.patterns[String(w)][d])).filter(v => v !== null);
            assert.ok(Math.max(...st) - Math.min(...st) <= WAVE_SPAN_MINUTES, `line ${w} leaves its wave`);
        }
    });
});

test('generatePatterns rejects totals over the line count', () => {
    const big = [{ time: '06:20-14:20', weekday: 29, sat: 0, sun: 0 }];
    assert.equal(generatePatterns({ slots: big, lines: 28 }), null);
    // Spare LINES reduce what is left to carry the targets, so a total that would fit in 28 can
    // still be refused — 26 duties cannot fit in the 25 working lines left by 3 spare weeks.
    assert.equal(generatePatterns({
        slots: [{ time: '06:20-14:20', weekday: 26, sat: 0, sun: 0 }],
        spareLines: 3,
        lines: 28,
    }), null);
    // …and it fits with one fewer spare week.
    assert.ok(generatePatterns({
        slots: [{ time: '06:20-14:20', weekday: 26, sat: 0, sun: 0 }],
        spareLines: 2,
        lines: 28,
    }));
});

test('generatePatterns rejects an impossible spare-line count', () => {
    assert.equal(generatePatterns({ slots: SLOTS, spareLines: 28, lines: 28 }), null);   // nothing left to work
    assert.equal(generatePatterns({ slots: SLOTS, spareLines: -1, lines: 28 }), null);
    assert.equal(generatePatterns({ slots: SLOTS, spareLines: 1.5, lines: 28 }), null);
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
    const patterns = generatePatterns({ slots: waves, spareLines: 4, lines: 28 });
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

// The live main and bilingual rosters are the regression pin for this: they reported 15 and 14
// consecutive worked days until v19.79 because a spare week counted as SEVEN. Four duties in seven
// days cannot fill a week, so a spare week always contains a rest day and can never fuse the blocks
// either side of it. 13 consecutive days is Chiltern's roster limit, so a check reporting
// 15 was not being cautious — it reported a breach that does not exist on the roster people work.
describe('worstCaseWorkedRun — a spare week is four duties, not seven', () => {
    const wk = (...d) => Object.fromEntries(DAYS.map((k, i) => [k, d[i]]));
    const W = '06:20-14:20', R = 'RD', S = 'SPARE';
    const seqOf = (...weeks) => {
        const out = [];
        weeks.forEach((w, i) => DAYS.forEach(d => out.push({ shift: w[d] })));
        return out;
    };

    test('a spare week does not bridge the blocks either side of it', () => {
        const worked = wk(W, W, W, W, W, W, W);
        // 7/7 counting gives 21. The truth is 7 + at most 4 = 11.
        assert.equal(worstCaseWorkedRun(seqOf(worked, wk(S, S, S, S, S, S, S), worked, wk(R, R, R, R, R, R, R))), 11);
    });

    test('two adjacent spare weeks chain to eight, and are not clamped to four', () => {
        const spare = wk(S, S, S, S, S, S, S), rest = wk(R, R, R, R, R, R, R);
        assert.equal(worstCaseWorkedRun(seqOf(rest, spare, spare, rest)), 8);
    });

    test('the budget is per WEEK, so one spare week caps at four however you enter it', () => {
        assert.equal(worstCaseWorkedRun(seqOf(wk(R, R, R, R, R, R, R), wk(S, S, S, S, S, S, S))), 4);
    });

    test('a design with no spare weeks is untouched by the rule', () => {
        assert.equal(worstCaseWorkedRun(seqOf(wk(R, W, W, W, W, W, R), wk(R, W, W, W, W, W, R))), 5);
    });

    test('an all-worked design with no rest anywhere still reports the whole cycle', () => {
        const worked = wk(W, W, W, W, W, W, W);
        assert.equal(worstCaseWorkedRun(seqOf(worked, worked)), 14);
    });
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
        // Literal copies kept in step by a comment is how a grid renders one number of rows while
        // the checks examine another.
        //
        // This deliberately does NOT assert the VALUE. It did (`=== 28`), and when the rotation
        // moved to 22 at v19.98 that assertion failed for the one reason a test never should: it
        // was pinning a business decision that had legitimately changed, so the only available fix
        // was to edit the expectation — which is not a check, it is a chore. The value is owned by
        // `links-design.js` and the owner; what belongs in a test is that every window in this
        // module DEFAULTS to it, whatever it is. `links-rotation-parity.test.mjs` covers the other
        // half — that nothing else writes the number down.
        assert.equal(typeof ROTATING_LINES, 'number');
        assert.ok(ROTATING_LINES > 0);
        const all = {};
        for (let i = 1; i <= ROTATING_LINES; i++) all[String(i)] = { sun: 'RD', mon: '06:00-14:00', tue: 'RD', wed: 'RD', thu: 'RD', fri: 'RD', sat: 'RD' };
        assert.equal(runDesignChecks(all).totalWeeks, ROTATING_LINES);
        assert.equal(calcCoverage(all).mon.early, ROTATING_LINES);
    });
});


// ── HOURS A WEEK (v20.04) ────────────────────────────────────────────────────────────────────────
//
// Added because the panel could not answer the most basic question anybody asks of a roster — does
// it give people their contracted hours? — and the answer turned out to matter: the seeded 24-line
// design comes back six hours a week short, which nothing on the page had ever said.
//
// The two exclusions are what these tests are really for. Both are easy to "simplify" away, and
// each simplification produces a plausible number that is wrong in a specific direction: counting
// Sundays FLATTERS the design (it reports contracted hours using time that is not contracted), and
// dividing by all the lines DEFLATES it (it charges the average with cover weeks of zero).
describe('weeklyHours', () => {
    const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    const rowOf = (o) => Object.fromEntries(DAY_KEYS.map(d => [d, o[d] ?? 'RD']));
    const SPARE = Object.fromEntries(DAY_KEYS.map(d => [d, 'SPARE']));

    test('THE LIVE MAIN ROSTER COMES TO EXACTLY 35 HOURS — the check on the check', () => {
        // Not a fixture: the real roster, which is built to the contract. If this drifts, the
        // measure has gone wrong before any design is judged by it — and a design being judged by a
        // broken yardstick is worse than having no yardstick, because it looks like an answer.
        const main = {};
        for (let w = 1; w <= CONFIG.MAIN_ROSTER_WEEKS; w++) main[String(w)] = weeklyRoster[w];
        const wh = weeklyHours(main, CONFIG.MAIN_ROSTER_WEEKS);
        assert.equal(wh.exSunday, CONTRACTED_HOURS_PER_WEEK,
            `the live roster's working lines must come to the contracted week; got ${wh.exSunday}`);
        assert.equal(wh.coverLines, 4, 'premise: the main cycle has four spare weeks');
    });

    test('SUNDAYS ARE EXCLUDED — counting them would flatter every design', () => {
        // One line: 5 × 7h Mon–Fri = 35 exactly, plus a 7h Sunday on top. Ex-Sunday must stay 35;
        // an implementation that folds Sunday in reports 42 and calls an over-run a healthy week.
        const p = { 1: rowOf({ mon: '09:00-16:00', tue: '09:00-16:00', wed: '09:00-16:00',
            thu: '09:00-16:00', fri: '09:00-16:00', sun: '09:00-16:00' }) };
        const wh = weeklyHours(p, 1);
        assert.equal(wh.exSunday, 35, 'Sunday is not contracted and must not count towards 35');
        assert.equal(wh.all, 42, 'it is still real work, and is still reported');
        assert.equal(wh.sundayHours, 7);
        assert.equal(wh.sundayDuties, 1);
    });

    test('COVER WEEKS LEAVE THE DENOMINATOR — they carry no times, so they cannot be averaged', () => {
        // Two identical 35h lines and two cover weeks. The answer is 35 — what a normal week on this
        // link looks like. Dividing by all four lines gives 17.5, a week nobody works.
        const line = rowOf({ mon: '09:00-16:00', tue: '09:00-16:00', wed: '09:00-16:00',
            thu: '09:00-16:00', fri: '09:00-16:00' });
        const wh = weeklyHours({ 1: line, 2: line, 3: SPARE, 4: SPARE }, 4);
        assert.equal(wh.exSunday, 35);
        assert.equal(wh.workingLines, 2);
        assert.equal(wh.coverLines, 2);
        assert.equal(wh.lines, 4, 'the full length is still reported, so the exclusion is visible');
    });

    test('an empty design is null, never zero', () => {
        // "0 hours a week" reads as a finding about the design. It is not one — there is no design.
        const wh = weeklyHours({}, 24);
        assert.equal(wh.exSunday, null);
        assert.equal(wh.all, null);
        assert.equal(wh.workingLines, 0);
    });

    test('an unreadable duty is COUNTED as unreadable, not silently skipped', () => {
        // Silently skipping it makes a design full of malformed times report a comfortable low
        // average with nothing to say why — the panel prints this count so the floor is visible.
        const p = { 1: rowOf({ mon: '09:00-16:00', tue: 'gibberish', wed: '09:00-16:00' }) };
        const wh = weeklyHours(p, 1);
        assert.equal(wh.unreadable, 1);
        assert.equal(wh.duties, 2);
        assert.equal(wh.exSunday, 14, 'the readable duties still count');
    });

    // ── A WHOLE LINE NOBODY COULD READ IS THE DANGEROUS ONE (v20.08, external review P2) ────────
    // The case above — a stray unreadable cell on an otherwise-readable line — is visible: the line
    // stays in the denominator, its average drops, and `unreadable` says why. A line where EVERY
    // worked cell is unreadable behaves completely differently and looks identical in that count: it
    // contributes no minutes and is excluded from `workingLines`, so it leaves the average
    // arithmetically untouched. Twenty good lines averaging exactly 35.00 beside one line that was
    // never measured is the worst thing this figure can do, because the tick is earned honestly by
    // the lines it did read.
    test('a line with NO readable time is counted as unmeasured, not quietly dropped', () => {
        const good = rowOf({ mon: '09:00-16:00', tue: '09:00-16:00', wed: '09:00-16:00',
            thu: '09:00-16:00', fri: '09:00-16:00' });            // exactly 35
        const opaque = rowOf({ mon: 'gibberish', tue: 'gibberish' });
        const wh = weeklyHours({ 1: good, 2: good, 3: opaque }, 3);

        // The trap, stated as an assertion: the average is untouched and would read as a clean pass.
        assert.equal(wh.exSunday, 35, 'premise: the readable lines really do come to the contract');
        assert.equal(wh.workingLines, 2, 'the opaque line is not one of the lines that was measured');

        assert.equal(wh.unreadableLines, 1, 'the unmeasured LINE must be counted, not just its cells');
        assert.equal(wh.complete, false, 'a figure computed over fewer lines than the design has is partial');
    });

    test('`complete` is true for every design that could be fully measured', () => {
        // The mirror image, and the one that keeps the flag useful: if it were false in ordinary
        // cases the panel would wear a permanent asterisk and the real one would mean nothing.
        const good = rowOf({ mon: '09:00-16:00', fri: '09:00-16:00' });
        for (const [label, p, lines] of /** @type {[string, any, number][]} */ ([
            ['a plain design', { 1: good, 2: good }, 2],
            ['a design with cover weeks', { 1: good, 2: SPARE }, 2],
            ['a design with one stray bad cell on a readable line',
                { 1: rowOf({ mon: '09:00-16:00', tue: 'gibberish' }) }, 1],
            ['an empty design', {}, 4],
        ])) {
            assert.equal(weeklyHours(p, lines).complete, true, label);
            assert.equal(weeklyHours(p, lines).unreadableLines, 0, label);
        }
    });

    test('rest days and cover days add no hours, and a duty past midnight is not negative', () => {
        const p = { 1: rowOf({ mon: '22:00-06:00', tue: 'SPARE', wed: 'RD', thu: 'OFF' }) };
        const wh = weeklyHours(p, 1);
        assert.equal(dutyMinutes('22:00-06:00'), 8 * 60, 'premise: one reading of a wrapping duty');
        assert.equal(wh.exSunday, 8);
        assert.equal(wh.duties, 1, 'SPARE is not a timed duty');
    });
});
