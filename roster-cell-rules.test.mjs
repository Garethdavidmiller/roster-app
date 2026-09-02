/**
 * roster-cell-rules.test.mjs — the guards between "the PDF said X" and "we wrote Y".
 *
 * `normaliseCellValue` carries three rules, each of which exists because of a real defect, and it
 * had NO test of its own. That is not an oversight anybody could have noticed: it was extracted
 * from `computeCellStates` at v19.32 and moved into this module at v22.17, and the extraction that
 * gave it a SECOND consumer — the in-place entry control, where a person now types a value — is
 * exactly the change that makes the guards matter more. `admin-roster-upload.test.mjs` mentions it
 * once, in a comment.
 *
 * Organised by what a wrong answer COSTS, because the four are not equivalent:
 *
 *   WRITING A DAY THE APP FORBIDS is silent. A Sunday annual leave lands in Firestore looking
 *   perfectly valid, is suppressed on the calendar by a later layer (so nothing appears wrong),
 *   and still consumes entitlement. This block is the one with teeth.
 *
 *   CHARGING LEAVE AGAINST A REST DAY is the v16.19 overpay guard: a blanket Mon–Fri "OD", or an
 *   "AL" scrawled across a week on the paper roster, consuming entitlement for the rest days inside
 *   it. Also silent, and it costs the member days they never took.
 *
 *   LOSING THE OVERTIME is the v16.23 marker rule: strip `RDW|` from the saved form and a weekday
 *   rest-day-worked import writes a plain `shift`, so the premium disappears from the calendar
 *   badge AND from the pay calculator's RDW pre-fill. Silent, and it costs money.
 *
 *   REFUSING A LEGITIMATE VALUE is the loud direction — a worked Sunday time rewritten to a rest
 *   day would erase somebody's overtime, but it shows up the moment anyone looks at the review.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseCellValue, shiftValueToOverrideType, isZeroLengthRange } from './roster-cell-rules.js';

// 2026-09-06 is a Sunday; 2026-09-07 a Monday. Real dates, so `isSunday` is doing real work.
const SUN = '2026-09-06';
const MON = '2026-09-07';

describe('writing a day the app forbids', () => {
    for (const forbidden of ['AL', 'SICK']) {
        test(`a Sunday ${forbidden} becomes a rest day, whatever the base says`, () => {
            // Both base shapes: a Sunday the member is rostered off, and one they are rostered on.
            assert.equal(normaliseCellValue(forbidden, 'RD', SUN).value, 'RD');
            assert.equal(normaliseCellValue(forbidden, '06:00-14:00', SUN).value, 'RD');
        });
    }

    test('an Other-family day on a Sunday becomes a rest day too', () => {
        // Sundays can never be training days (CLAUDE.md, confirmed Jul 2026).
        assert.equal(normaliseCellValue('TRG', 'RD', SUN).value, 'RD');
        assert.equal(normaliseCellValue('TEAM RDW', 'RD', SUN).value, 'RD');
    });

    test('the same value on a MONDAY is untouched — the guard is about Sundays, not about AL', () => {
        assert.equal(normaliseCellValue('AL', '06:00-14:00', MON).value, 'AL');
        assert.equal(normaliseCellValue('TRG', '06:00-14:00', MON).value, 'TRG');
    });

    test('a rewritten Sunday cannot then be typed as the thing it claimed to be', () => {
        // The guard and the type mapping have to agree, or the value says RD and the type says AL.
        assert.equal(shiftValueToOverrideType('AL', 'RD', SUN), 'correction');
        assert.equal(shiftValueToOverrideType('SICK', 'RD', SUN), 'correction');
    });
});

describe('charging leave against a rest day (the v16.19 overpay guard)', () => {
    test('AL on a base rest day becomes RD — a week-long scrawl must not eat entitlement', () => {
        assert.equal(normaliseCellValue('AL', 'RD', MON).value, 'RD');
    });

    test('an absence on a base rest day becomes RD — the blanket Mon–Fri "OD" case', () => {
        assert.equal(normaliseCellValue('SICK', 'RD', MON).value, 'RD');
    });

    test('OFF counts as a rest day for this rule, not as a separate kind of day', () => {
        // The roster's bilingual line writes OFF where the others write RD; a guard that read only
        // 'RD' would let every OFF day take leave.
        assert.equal(normaliseCellValue('AL', 'OFF', MON).value, 'RD');
        assert.equal(normaliseCellValue('SICK', 'OFF', MON).value, 'RD');
    });

    test('AL on a WORKING day is left alone — the guard must not swallow real leave', () => {
        assert.equal(normaliseCellValue('AL', '06:00-14:00', MON).value, 'AL');
        assert.equal(normaliseCellValue('SICK', '14:00-22:00', MON).value, 'SICK');
    });

    test('only AL and absence are caught — a worked shift on a rest day is RDW, not an error', () => {
        assert.equal(normaliseCellValue('06:00-14:00', 'RD', MON).value, '06:00-14:00');
        assert.equal(normaliseCellValue('SPARE', 'RD', MON).value, 'SPARE');
    });
});

describe('losing the overtime (the v16.23 marker rule)', () => {
    test('value is STRIPPED and display KEEPS the marker — they are different questions', () => {
        // The stripped form is what gets compared against stored plain-time docs, so a re-import
        // does not churn; the marked form is what gets SAVED, and carries the premium.
        const r = normaliseCellValue('RDW|14:30-22:00', 'RD', MON);
        assert.equal(r.value, '14:30-22:00', 'compares against a stored plain time');
        assert.equal(r.display, 'RDW|14:30-22:00', 'saved WITH the marker, or the premium is lost');
    });

    test('and the marked form types as rdw, not as a plain shift', () => {
        assert.equal(shiftValueToOverrideType('RDW|14:30-22:00', 'RD', MON), 'rdw');
    });

    test('a value the guards rewrote to RD drops the marker — RDW|RD is not a thing', () => {
        // A Sunday RDW-encoded AL: rewritten to RD, so the marker must not survive onto it.
        assert.equal(normaliseCellValue('RDW|AL', 'RD', SUN).display, 'RD');
    });

    test('an unmarked time keeps display and value identical', () => {
        const r = normaliseCellValue('06:00-14:00', 'RD', MON);
        assert.equal(r.value, r.display);
    });
});

describe('refusing a legitimate value', () => {
    test('a worked Sunday TIME survives untouched — it becomes RDW downstream', () => {
        // The Sunday rule forbids AL, absence and Other. It does not forbid WORKING a Sunday;
        // rewriting this to RD would erase somebody's overtime.
        assert.equal(normaliseCellValue('09:00-17:00', 'RD', SUN).value, '09:00-17:00');
        assert.equal(shiftValueToOverrideType('09:00-17:00', 'RD', SUN), 'rdw');
    });

    test('an explicit rest day stays a rest day', () => {
        assert.equal(normaliseCellValue('RD', '06:00-14:00', MON).value, 'RD');
        assert.equal(normaliseCellValue('OFF', '06:00-14:00', MON).value, 'RD', 'OFF normalises to RD');
    });

    test('the two guards compose in the order that keeps both true', () => {
        // A Sunday AL on a base REST day is caught by either rule alone; asserting it proves
        // neither cancels the other, which a reordering could do.
        assert.equal(normaliseCellValue('AL', 'RD', SUN).value, 'RD');
    });
});

describe('a zero-length range reaches pay as twenty-four hours', () => {
    test('equal start and end is caught, marked or not', () => {
        assert.equal(isZeroLengthRange('06:00-06:00'), true);
        assert.equal(isZeroLengthRange('RDW|06:00-06:00'), true);
    });

    test('an overnight shift is NOT caught — end before start is ordinary on this roster', () => {
        assert.equal(isZeroLengthRange('22:00-06:00'), false);
        assert.equal(isZeroLengthRange('06:00-14:00'), false);
    });

    test('a non-time value is not a range', () => {
        for (const v of ['AL', 'RD', 'SPARE', 'TRG RDW', '']) assert.equal(isZeroLengthRange(v), false);
    });
});
