// admin-al-spare-note.test.mjs — the AL preview's Spare-day line.
//
// Two things are pinned here and they fail for different reasons: the SENTENCES have to be English
// in every branch (the defect that shipped for four months was ungrammatical in both at once), and
// the note must never reintroduce the hours claim the owner ruled out on 14 Sep 2026 — a Spare day
// costs exactly one day of annual leave.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spareShiftNote, countSpareDays } from './admin-al-spare-note.js';
import { teamMembers, getBaseShift, isSunday } from './roster-data.js';

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

test('a saved Spare override counts even over a working base', () => {
    const f = /** @type {any} */ (findSpare());
    const spare = new Map([[f.iso, { type: 'spare_shift', value: 'SPARE' }]]);
    assert.equal(countSpareDays(f.m, [f.iso], spare), 1);
    assert.equal(countSpareDays(null, [f.iso], spare), 0, 'no member, no count');
});
