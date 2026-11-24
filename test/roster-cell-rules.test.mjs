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
import { normaliseCellValue, shiftValueToOverrideType, isZeroLengthRange } from '../roster-cell-rules.js';

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

    test('an Other day printed WITH TIMES on a Sunday is Sunday work at those times (6 Nov 2026 review)', () => {
        // A Sunday is never an Other day, but MTG over 10:00-14:00 is four hours worked on one.
        // Until v25.38 it arrived as the bare time and was saved as rest-day working; made RD, it was
        // dropped on a rest Sunday and turned a ROSTERED Sunday into rest. Both bases, both orders.
        for (const base of ['RD', '06:00-14:00']) {
            const n = normaliseCellValue('MEET 10:00-14:00', base, SUN);
            assert.equal(n.value, '10:00-14:00', `base ${base}`);
            assert.equal(n.guarded, null, 'recorded, so not reported as refused');
        }
        assert.equal(normaliseCellValue('TRG RDW 09:00-17:00', 'RD', SUN).value, '09:00-17:00');
        assert.equal(shiftValueToOverrideType('MEET 10:00-14:00', SUN), 'rdw', 'never an `other` record on a Sunday');
        assert.equal(shiftValueToOverrideType('10:00-14:00', SUN), 'rdw', 'and never a correction to rest');
    });

    test('a BARE Other day on a Sunday is refused under its OWN reason, so the review holds it (owner, 7 Nov 2026)', () => {
        // "You can't have training or a meeting on a Sunday": not leave, which means not at work,
        // but a roster that cannot be right. `computeCellStates` holds every such row, whatever the
        // base says — admin-roster-upload.test.mjs drives that through the state machine.
        for (const base of ['RD', '06:00-14:00']) {
            assert.equal(normaliseCellValue('MEET', base, SUN).value, 'RD', `base ${base}`);
            assert.equal(normaliseCellValue('MEET', base, SUN).guarded, 'sunday-other', `base ${base}`);
            assert.equal(normaliseCellValue('TRG RDW', base, SUN).guarded, 'sunday-other', `base ${base}`);
        }
        assert.equal(normaliseCellValue('AL', '06:00-14:00', SUN).guarded, 'sunday', 'leave keeps the plain Sunday reason');
    });

    test('a SPARE on 25 or 26 December is refused under its own reason, in any year (owner, 19 Nov 2026)', () => {
        // "Christmas days and Boxing days cannot be spare days even if they fall in a usually spare week."
        // 26 December 2027 is a Sunday, whose own guard lets a Spare turn through — this one does not.
        for (const date of ['2026-12-25', '2026-12-26', '2027-12-26', '2030-12-25']) {
            const n = normaliseCellValue('SPARE', 'RD', date);
            assert.deepEqual([n.value, n.guarded], ['RD', 'christmas-spare'], date);
        }
        // CONTROLS: the days either side keep their Spare turn, and a Christmas shift is not this guard's.
        assert.deepEqual(normaliseCellValue('SPARE', '06:00-14:00', '2026-12-24'), { value: 'SPARE', display: 'SPARE', guarded: null });
        assert.equal(normaliseCellValue('SPARE', 'RD', '2026-12-27').guarded, null, 'a Sunday Spare turn stands');
        assert.equal(normaliseCellValue('13:30-21:00', 'RD', '2026-12-26').guarded, null);
    });

    test('an Other day on 25 or 26 December is refused under its own reason, times or not (review, 21 Nov 2026)', () => {
        // Owner, Jul 2026: Boxing Day can never be a training or Other day; nobody works 25 December.
        for (const date of ['2026-12-25', '2026-12-26', '2030-12-25']) {
            for (const v of ['TRG', 'MEET', 'TEAM RDW', 'IND 09:00-17:00', 'ASSESS RDW 10:00-14:00']) {
                const n = normaliseCellValue(v, '06:00-14:00', date);
                assert.deepEqual([n.value, n.guarded], ['RD', 'christmas-other'], `${v} on ${date}`);
            }
        }
        // CONTROLS: Christmas Eve keeps its Training day, and a worked Boxing Day is not this guard's.
        assert.deepEqual(normaliseCellValue('TRG', '06:00-14:00', '2026-12-24'), { value: 'TRG', display: 'TRG', guarded: null });
        assert.equal(normaliseCellValue('13:30-21:00', 'RD', '2026-12-26').guarded, null);
    });

    test('…and on a SUNDAY 25 or 26 December too — the Sunday guard must not turn it into worked hours first (review, 22 Nov 2026)', () => {
        // Boxing Day 2027 and Christmas Day 2033 are Sundays. The Sunday guard turns a TIMED Other day
        // into Sunday work at its times, and the Christmas guard used to ask only after it had: a
        // Training day printed with times there was recorded as worked hours, guarded by nothing.
        for (const date of ['2027-12-26', '2033-12-25']) {
            for (const base of ['RD', '06:00-14:00']) {
                for (const v of ['TRG', 'MEET', 'TRG 09:00-17:00', 'MEET 10:00-14:00', 'MEET RDW 10:00-14:00', 'RDW|TRG 09:00-17:00']) {
                    const n = normaliseCellValue(v, base, date);
                    assert.deepEqual(n, { value: 'RD', display: 'RD', guarded: 'christmas-other' }, `${v} on ${date}, base ${base}`);
                }
            }
        }
        // CONTROLS: an ordinary Sunday keeps both Sunday answers — timed is Sunday work, bare is refused.
        assert.deepEqual(normaliseCellValue('TRG 09:00-17:00', 'RD', '2027-12-19'), { value: '09:00-17:00', display: '09:00-17:00', guarded: null });
        assert.equal(normaliseCellValue('TRG', 'RD', '2027-12-19').guarded, 'sunday-other');
        // …and a plain worked Sunday Boxing Day is still not this guard's.
        assert.equal(normaliseCellValue('13:30-21:00', 'RD', '2027-12-26').guarded, null);
    });

    test('the same value on a MONDAY is untouched — the guard is about Sundays, not about AL', () => {
        assert.equal(normaliseCellValue('AL', '06:00-14:00', MON).value, 'AL');
        assert.equal(normaliseCellValue('TRG', '06:00-14:00', MON).value, 'TRG');
    });

    test('a rewritten Sunday cannot then be typed as the thing it claimed to be', () => {
        // The guard and the type mapping have to agree, or the value says RD and the type says AL.
        assert.equal(shiftValueToOverrideType('AL', SUN), 'correction');
        assert.equal(shiftValueToOverrideType('SICK', SUN), 'correction');
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
        assert.equal(shiftValueToOverrideType('RDW|14:30-22:00', MON), 'rdw');
    });

    test('a caller still passing the old base-shift argument is refused, never silently undated', () => {
        // The base shift was an argument nobody read (whole-app fix, Nov 2026). A three-argument call
        // left behind would put a shift where the DATE belongs, and the Sunday rule would quietly stop
        // applying — a Sunday AL typed as annual leave. Loud instead.
        assert.throws(() => shiftValueToOverrideType('AL', /** @type {any} */ ('RD')), /not an ISO date/);
        assert.equal(shiftValueToOverrideType('AL', null), 'annual_leave', 'no date is still allowed');
        assert.equal(shiftValueToOverrideType('AL', SUN), 'correction', 'and the Sunday rule still reads the date');
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
        assert.equal(shiftValueToOverrideType('09:00-17:00', SUN), 'rdw');
    });

    test('an explicit rest day stays a rest day', () => {
        assert.equal(normaliseCellValue('RD', '06:00-14:00', MON).value, 'RD');
        assert.equal(normaliseCellValue('OFF', '06:00-14:00', MON).value, 'RD', 'OFF normalises to RD');
    });

    test('the two guards compose in the order that keeps both true', () => {
        // A Sunday AL on a base REST day is caught by either rule alone; asserting it proves
        // neither cancels the other, which a reordering could do.
        const r = normaliseCellValue('AL', 'RD', SUN);
        assert.equal(r.value, 'RD');
        // The value cannot show the ORDER — either guard alone gives RD — so it is the reported guard
        // that does (test audit, 7 Nov 2026). Sunday runs first; a row named 'rest-day' instead would
        // ask "was it a swapped working day?" about a Sunday.
        assert.equal(r.guarded, 'sunday', 'the guard that actually moved the value is the one named');
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
