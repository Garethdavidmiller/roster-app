// admin-al-year.test.mjs — WHICH YEAR the Admin AL figures describe.
//
// Organised by what a wrong answer COSTS, not by input, because every rung is trivially right on
// its own and the defect is always which rung WINS.
//
//   · Too FAR FORWARD is the shipped defect and the quiet one: a manager scrolls the range picker
//     into next year, the banner keeps stating this year's figures, and next year's untouched 32
//     days read as almost spent. Nothing is written wrongly — the save path reads the picked dates
//     — so the only consequence is a leave request refused against a number that was never true.
//   · Too FAR FORWARD BY ACCIDENT is what a careless fix produces: hand the picker's year in
//     unconditionally and it wins from the first paint, taking every case the Change a Shift week
//     has owned since v16.21 — including a manager who came to this card from a week they were
//     already editing. That failure looks identical on screen and is wrong in the other direction.
//
// Teeth-verified by five mutations. Four fail here; the fifth — `!= null` loosened to a truthiness
// test — provably cannot, and the module header says why rather than a test pretending otherwise.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { alFigureYear } from './admin-al-year.js';

const TODAY = new Date(2026, 7, 27);          // 27 Aug 2026
const base  = { pickedFrom: '', pickerViewYear: null, shiftDate: '', today: TODAY };

describe('stating the wrong year — the figures describe a year nobody is looking at', () => {
    test('the picker moved into next year, so the figures are next year\'s', () => {
        assert.equal(alFigureYear({ ...base, pickerViewYear: 2027 }), '2027');
    });

    test('the picker outranks the Change a Shift week — a different card, and the older signal', () => {
        assert.equal(
            alFigureYear({ ...base, pickerViewYear: 2027, shiftDate: '2026-08-01' }),
            '2027',
            'the reported defect: the banner stayed on the week open behind it',
        );
    });

    test('moving BACK is followed too — the year is read, never latched at its highest', () => {
        assert.equal(alFigureYear({ ...base, pickerViewYear: 2026, shiftDate: '2027-01-04' }), '2026');
    });
});

describe('claiming a signal that was never given — the careless fix', () => {
    test('a picker that has not crossed a year yields to the Change a Shift week', () => {
        assert.equal(
            alFigureYear({ ...base, pickerViewYear: null, shiftDate: '2027-01-04' }),
            '2027',
            'passing the picker\'s year unconditionally would take this case from v16.21',
        );
    });

    test('a PICKED start date outranks the month the picker is showing', () => {
        assert.equal(
            alFigureYear({ pickedFrom: '2026-12-20', pickerViewYear: 2027, shiftDate: '', today: TODAY }),
            '2026',
            'someone who picked 20 Dec and then scrolled on to look at January is booking December',
        );
    });

    test('a picked date outranks every other rung at once', () => {
        assert.equal(
            alFigureYear({ pickedFrom: '2028-03-01', pickerViewYear: 2027, shiftDate: '2026-01-01', today: TODAY }),
            '2028',
        );
    });
});

describe('the floor', () => {
    test('nothing on screen implies a year, so it is this one', () => {
        assert.equal(alFigureYear(base), '2026');
    });

    test('null and undefined are absent, not zero', () => {
        assert.equal(alFigureYear({ pickedFrom: null, pickerViewYear: undefined, shiftDate: null, today: TODAY }), '2026');
        assert.equal(alFigureYear({ ...base, pickedFrom: undefined, shiftDate: undefined }), '2026');
    });

    test('a returned year is always the four-character string alPosition takes', () => {
        for (const got of [
            alFigureYear({ ...base, pickedFrom: '2027-05-04' }),
            alFigureYear({ ...base, pickerViewYear: 2027 }),
            alFigureYear({ ...base, shiftDate: '2027-05-04' }),
            alFigureYear(base),
        ]) {
            assert.equal(typeof got, 'string');
            assert.match(got, /^\d{4}$/);
        }
    });
});
