// admin-shift-types.test.mjs — the shift-type table, and what a Saved Changes row prints.
//
// `rowValueText` exists because the Admin page's list of everything ever recorded was printing the
// stored value beside a badge that already said it: "Absent  SICK", "Annual Leave  AL". The first is
// not merely redundant — `SICK` is a word this app does not put in front of staff.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TYPES, PILL_TYPES, rowValueText } from './admin-shift-types.js';

test('a fixed type prints nothing — its value only repeats the badge', () => {
    for (const [type, meta] of Object.entries(TYPES)) {
        if (!meta.fixed) continue;
        assert.equal(rowValueText(type, meta.fixedValue), '',
            `${type} carries a derivable value and must not print it twice`);
    }
});

test('SICK never reaches the screen', () => {
    // The specific defect, named: the absence row read "Absent  SICK" on the Admin page.
    assert.equal(rowValueText('sick', 'SICK'), '');
    assert.equal(TYPES.sick.label, 'Absent', 'the visible word for an absence is "Absent"');
});

test('a value that CARRIES something is always kept', () => {
    // Times and Other-family flavours are the whole reason the column exists.
    assert.equal(rowValueText('shift', '08:00-16:30'), '08:00-16:30');
    assert.equal(rowValueText('rdw', '09:00-17:00'), '09:00-17:00');
    assert.equal(rowValueText('other', 'TRG RDW 09:00-17:00'), 'TRG RDW 09:00-17:00');
    // Legacy types are not `fixed`, so they keep their times too.
    assert.equal(rowValueText('allocated', '06:00-14:00'), '06:00-14:00');
});

test('it fails toward SHOWING — a row that contradicts its own type stays visible', () => {
    // Hiding this would make a real data inconsistency invisible on the one page that lists it.
    assert.equal(rowValueText('sick', 'SOMETHING-ELSE'), 'SOMETHING-ELSE');
    assert.equal(rowValueText('annual_leave', '08:00-16:30'), '08:00-16:30');
    assert.equal(rowValueText('a-type-added-later', 'WHATEVER'), 'WHATEVER');
});

test('a missing value is empty text, never "undefined" on screen', () => {
    assert.equal(rowValueText('shift', /** @type {any} */ (undefined)), '');
    assert.equal(rowValueText('shift', /** @type {any} */ (null)), '');
});

test('the rule is the `fixed` flag, so a type added later needs no edit here', () => {
    // If this ever fails, a fixed type has been given a value that is not its fixedValue — which
    // would mean the table itself disagrees about what the type means.
    for (const type of PILL_TYPES) {
        const meta = TYPES[type];
        if (!meta?.fixed) continue;
        assert.ok(meta.fixedValue, `${type} is fixed but declares no fixedValue`);
    }
});
