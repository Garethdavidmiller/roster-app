// admin-al-spare-note.test.mjs — the AL preview's Spare-day line.
//
// Two things are pinned here and they fail for different reasons: the SENTENCES have to be English
// in every branch (the defect that shipped for four months was ungrammatical in both at once), and
// the note must never reintroduce the hours claim the owner ruled out on 14 Sep 2026 — a Spare day
// costs exactly one day of annual leave.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spareShiftNote, countSpareDays, spareDaysOf, spareWeekDaysOf } from './admin-al-spare-note.js';
import { teamMembers, getBaseShift, isSunday } from './roster-data.js';
import { projectAlBooking } from './admin-al-projection.js';

test('no Spare days → no line at all', () => {
    for (const n of [0, -1, NaN, undefined, null]) {
        assert.equal(spareShiftNote(/** @type {any} */ (n), 3), '', `count ${String(n)} should say nothing`);
    }
});

test('a one-day booking says "This is", never "1 of these days"', () => {
    const s = spareShiftNote(1, 1);
    assert.match(s, /^📋 This is a Spare day —/);
    assert.doesNotMatch(s, /of these/, 'a single date has no "these" to be one of');
});

test('one Spare day inside a longer booking agrees in number', () => {
    const s = spareShiftNote(1, 5);
    assert.match(s, /1 of these days is a Spare day/);
    // The shipped defect, exactly: "1 of these day is".
    assert.doesNotMatch(s, /these day\b/, 'singular "day" after "these" is the v11.35 defect');
});

test('several Spare days agree in number on BOTH sides of the verb', () => {
    const s = spareShiftNote(3, 6);
    assert.match(s, /3 of these days are Spare days/);
    // The other half of the same defect: a plural subject with a singular complement.
    assert.doesNotMatch(s, /are an? /, '"are an unconfirmed shift" is not English');
});

test('every branch states the cost, and states it as exactly one day', () => {
    for (const [count, total] of [[1, 1], [1, 5], [4, 9]]) {
        const s = spareShiftNote(count, total);
        assert.match(s, /uses 1 day of annual leave\.$/,
            `spareShiftNote(${count}, ${total}) must close the entitlement question`);
    }
});

test('the hours claim stays gone — a Spare day never costs more than a day', () => {
    for (const [count, total] of [[1, 1], [1, 5], [2, 4], [7, 7]]) {
        const s = spareShiftNote(count, total);
        for (const banned of [/7 hours/, /more than 1 AL day/, /longer than/, /hours/i]) {
            assert.doesNotMatch(s, banned,
                `spareShiftNote(${count}, ${total}) must not reason about shift length`);
        }
        assert.doesNotMatch(s, /⚠/, 'this is information, not a warning');
    }
});

test('it is third person — a manager books on somebody else\'s behalf from this card', () => {
    for (const [count, total] of [[1, 1], [1, 5], [2, 4]]) {
        assert.doesNotMatch(spareShiftNote(count, total), /\byou\b|\byou're\b|\byour\b/i);
    }
});

// ── countSpareDays — a day is Spare only while it is STILL Spare (v24.44, owner-reported) ──────
// The owner's Spare week was turned into real shifts by a roster upload; booking one of those days
// off still said "This is a Spare day — the shift not yet assigned". The count read the base roster.

/** A CEA/CES member and a non-Sunday date whose BASE shift is Spare. */
function findSpare() {
    for (const m of teamMembers) {
        if (m.hidden || m.managerOnly || (m.role !== 'CEA' && m.role !== 'CES')) continue;
        for (let i = 0; i < 400; i++) {
            const d = new Date(2026, 0, 1 + i);
            const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            if (!isSunday(iso) && getBaseShift(m, d) === 'SPARE') return { m, iso };
        }
    }
    return null;
}

test('a base Spare day with nothing over it counts', () => {
    const f = findSpare();
    assert.ok(f, 'fixture: no member has a non-Sunday Spare day in 2026');
    assert.equal(countSpareDays(f.m, [f.iso], new Map()), 1);
    assert.equal(countSpareDays(f.m, [f.iso], null), 1);
});

test('a Spare day a roster upload has since ASSIGNED does not count', () => {
    const f = /** @type {any} */ (findSpare());
    const assigned = new Map([[f.iso, { type: 'shift', value: '06:00-14:00', source: 'roster_import' }]]);
    assert.equal(countSpareDays(f.m, [f.iso], assigned), 0,
        'the shift has been assigned, so the note would describe a day that no longer exists');
});

/** A CEA/CES member and a non-Sunday date whose BASE shift is a worked time — not Spare. */
function findWorked() {
    for (const m of teamMembers) {
        if (m.hidden || m.managerOnly || (m.role !== 'CEA' && m.role !== 'CES')) continue;
        for (let i = 0; i < 400; i++) {
            const d = new Date(2026, 0, 1 + i);
            const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            if (!isSunday(iso) && /^\d\d:\d\d-\d\d:\d\d$/.test(String(getBaseShift(m, d)))) return { m, iso };
        }
    }
    return null;
}

test('a saved Spare override counts even over a working base', () => {
    // Over a WORKED base, as the name says (test audit, 7 Nov 2026). This used the Spare-base fixture
    // above, so a count that also demanded a Spare base underneath stayed green.
    const f = /** @type {any} */ (findWorked());
    assert.ok(f, 'fixture: no member has a non-Sunday worked day in 2026');
    const spare = new Map([[f.iso, { type: 'spare_shift', value: 'SPARE' }]]);
    assert.equal(countSpareDays(f.m, [f.iso], new Map()), 0, 'premise: the base alone is not Spare');
    assert.equal(countSpareDays(f.m, [f.iso], spare), 1);
    assert.equal(countSpareDays(null, [f.iso], spare), 0, 'no member, no count');
});

// ── …AND ONLY WHILE IT COSTS A DAY (whole-app check, 10 Nov 2026) ───────────────────────────────
// Leave over a Spare turn saved on a base REST day is free, like leave over RDW (owner, 10 Nov 2026),
// and the booking records it at no cost. The note says each day it counts "still uses 1 day of annual
// leave", so it said that about a day the same preview called free.

/** A CEA/CES member and a non-Sunday BASE REST day in November 2026 (clear of 25/26 December). */
function findRest() {
    for (const m of teamMembers) {
        if (m.hidden || m.managerOnly || (m.role !== 'CEA' && m.role !== 'CES')) continue;
        for (let i = 0; i < 30; i++) {
            const d = new Date(2026, 10, 1 + i);
            const iso = `2026-11-${String(d.getDate()).padStart(2, '0')}`;
            if (!isSunday(iso) && getBaseShift(m, d) === 'RD') return { m, iso };
        }
    }
    return null;
}

test('a Spare turn saved on a base rest day is not counted — the booking charges nothing for it', () => {
    const f = findRest();
    assert.ok(f, 'fixture: no member has a non-Sunday rest day in November 2026');
    const spare = new Map([[f.iso, { type: 'spare_shift', value: 'SPARE' }]]);
    const booked = projectAlBooking({ member: f.m, dates: [f.iso], ovByDate: spare });
    assert.deepEqual([booked.consuming, booked.freeWritten], [[], [f.iso]], 'premise: the booking records the day at no cost');
    assert.equal(countSpareDays(f.m, [f.iso], spare), 0,
        'the note would say "It still uses 1 day of annual leave" about a day the booking does not charge');
});

test('over a month of Spare turns, the note counts exactly the days the booking charges', () => {
    const f = /** @type {any} */ (findRest());
    const dates = Array.from({ length: 30 }, (_, i) => `2026-11-${String(i + 1).padStart(2, '0')}`);
    const spare = new Map(dates.map(d => [d, { type: 'spare_shift', value: 'SPARE' }]));
    const booked = projectAlBooking({ member: f.m, dates, ovByDate: spare });
    assert.ok(booked.consuming.length > 0 && booked.freeWritten.length > 0, 'premise: the month holds working days and rest days');
    // Since 21 Nov 2026 a Spare week stops costing at four, so the Spare days BOOKED can outnumber
    // the days CHARGED — and the note is handed both (admin-al.js), so each must be right.
    const spareDays = spareDaysOf(f.m, dates, spare);
    assert.equal(countSpareDays(f.m, dates, spare), spareDays.length);
    assert.equal(spareDays.filter(d => booked.consuming.includes(d)).length, booked.consuming.length,
        'every day the booking charges is a Spare day the note counts');
    assert.deepEqual([...booked.consuming, ...booked.freeWritten].filter(d => spareDays.includes(d)).sort(), spareDays,
        'and every Spare day it counts is written, charged or free');
});

// A SPARE WEEK USES AT MOST FOUR (owner, 21 Nov 2026). When the booking charges fewer Spare days
// than it holds, "Each still uses 1 day" is no longer true, so the note says the cap and the figure.
test('a booking past a Spare week\'s four says the cap and what it does use', () => {
    assert.equal(spareShiftNote(6, 6, 4),
        '📋 6 of these days are Spare days — on standby, with the shift not yet assigned. A Spare week uses at most 4 days of annual leave, so they use 4 days.');
    assert.match(spareShiftNote(2, 2, 0), /, counting the days already booked that week, so they use none\.$/);
    assert.match(spareShiftNote(3, 3, 2), /counting the days already booked that week, so they use 2 days\.$/,
        'three Spare days charging two: the reason is the earlier booking, and the note says so');
    assert.match(spareShiftNote(1, 1, 0), /^📋 This is a Spare day — .* this week's 4 are already booked, so it uses none\.$/);
    assert.doesNotMatch(spareShiftNote(6, 6, 4), /Each still uses 1 day/);
    assert.equal(spareShiftNote(3, 6, 3), spareShiftNote(3, 6), 'charged in full reads as before');
});

// ── THE CAP SENTENCE COUNTS THE WEEK AS ROSTERED (owner, 22 Nov 2026) ──────────────────────────────
// The cap counts every day of a base Spare week, assigned or not; the note counted only the days still
// Spare, so a week with one assigned day read "5 of these days are Spare days … so they use 3 days"
// under a headline of 4, and a booking of assigned days alone that the cap freed had no line at all.
const SPARE_M = { name: 'Spare Week Tester', rosterType: 'main', currentWeek: 1, role: 'CEA' };
const SPARE_WEEK = ['2027-03-08', '2027-03-09', '2027-03-10', '2027-03-11', '2027-03-12', '2027-03-13'];
const assignedShift = (/** @type {string} */ date) => ({ id: `s-${date}`, memberName: SPARE_M.name, date, type: 'shift', value: '06:00-14:00', source: 'roster_import' });

test('the note\'s figure for a partly assigned week is the week\'s, as the headline\'s is', () => {
    // Tuesday assigned by the roster upload, the whole week booked: five Spare days, six in the week, four charged.
    const ov = new Map([[SPARE_WEEK[1], assignedShift(SPARE_WEEK[1])]]);
    assert.equal(spareDaysOf(SPARE_M, SPARE_WEEK, ov).length, 5, 'premise: five are still Spare');
    const week = spareWeekDaysOf(SPARE_M, SPARE_WEEK, ov);
    assert.deepEqual([week.dates, week.weeks], [SPARE_WEEK, 1], 'all six are days of the Spare week');
    const p = projectAlBooking({ member: SPARE_M, dates: SPARE_WEEK, ovByDate: ov });
    assert.equal(p.charged, 4, 'premise: the headline says four');
    const charged = week.dates.filter(d => p.consuming.includes(d)).length - p.capFreed;
    assert.equal(spareShiftNote(5, 6, charged, { days: 6, weeks: 1 }),
        '📋 5 of these days are Spare days — on standby, with the shift not yet assigned. A Spare week uses at most 4 days of annual leave, so the 6 days booked in that week use 4 days.');
});

test('a booking of assigned days alone that the cap frees still says why it costs nothing', () => {
    // One assigned day, the week's other four already booked: free on balance, so the line is the reason.
    assert.equal(spareShiftNote(0, 1, 0, { days: 1, weeks: 1 }),
        '📋 This day is in a Spare week, with its shift since assigned. A Spare week uses at most 4 days of annual leave, and this week\'s 4 are already booked, so it uses none.');
    assert.match(spareShiftNote(0, 3, 1, { days: 2, weeks: 1 }),
        /^📋 2 of these days are in a Spare week, with their shifts since assigned\. .*counting the days already booked that week, so they use 1 day\.$/);
    assert.match(spareShiftNote(0, 12, 8, { days: 12, weeks: 2 }), /in Spare weeks, .* so they use 8 days\.$/);
    // …and assigned days the cap does NOT free cost as shifts do: nothing to explain, so no line.
    assert.equal(spareShiftNote(0, 2, 2, { days: 2, weeks: 1 }), '');
    assert.equal(spareShiftNote(0, 2, 0, { days: 0, weeks: 0 }), '');
});

test('spareWeekDaysOf counts the base week, not the record, and leaves a Dispatcher out', () => {
    const ov = new Map(SPARE_WEEK.map(d => [d, assignedShift(d)]));
    assert.deepEqual(spareDaysOf(SPARE_M, SPARE_WEEK, ov), [], 'premise: nothing is still Spare');
    assert.deepEqual(spareWeekDaysOf(SPARE_M, SPARE_WEEK, ov).dates, SPARE_WEEK);
    assert.deepEqual(spareWeekDaysOf({ ...SPARE_M, role: 'Dispatcher' }, SPARE_WEEK, ov), { dates: [], weeks: 0 });
    assert.deepEqual(spareWeekDaysOf(null, SPARE_WEEK, ov), { dates: [], weeks: 0 });
});

// ── DAYS ALREADY BOOKED ARE NOT CHARGED AGAIN (external review of v26.58) ──────────────────────────
// The headline counts them apart, so the line's figure is the new days'. The real card is
// admin-range-booking.test.mjs block P; this is the sentence on its own.
test('with days already booked, the line\'s figure is the new days\', and a re-booking charges none', () => {
    assert.equal(spareShiftNote(6, 6, 0, { days: 6, weeks: 1, held: 4 }),
        '📋 6 of these days are Spare days — on standby, with the shift not yet assigned. A Spare week uses at most 4 days of annual leave, counting the days already booked that week, so the 2 new days use none.');
    assert.match(spareShiftNote(6, 6, 0, { days: 6, weeks: 1, held: 5 }), /so the new day uses none\.$/);
    assert.equal(spareShiftNote(1, 1, 0, { days: 1, weeks: 1, held: 1 }),
        '📋 This is a Spare day — on standby, with the shift not yet assigned. It is already booked, so booking it again uses no more annual leave.');
    assert.match(spareShiftNote(6, 6, 0, { days: 6, weeks: 1, held: 6 }), /They are already booked, so booking them again uses no more annual leave\.$/);
    assert.equal(spareShiftNote(0, 1, 0, { days: 1, weeks: 1, held: 1 }), '', 'an assigned day already booked: nothing to explain');
    assert.equal(spareShiftNote(3, 6, 1, { days: 3, weeks: 1, held: 2 }), spareShiftNote(3, 6), 'the new day charged in full reads as before');
    assert.equal(spareShiftNote(6, 6, 4, { days: 6, weeks: 1, held: 0 }), spareShiftNote(6, 6, 4, { days: 6, weeks: 1 }), 'none held reads as before');
});
