/**
 * admin-period-dates.test.mjs — the four pure answers behind the Recorded-dates lists.
 * Run: node --test admin-period-dates.test.mjs   (part of `npm run test:hygiene`)
 *
 * ── ORGANISED BY WHAT A WRONG ANSWER COSTS ─────────────────────────────────────────────────────
 *
 * `isRestGap` decides whether two bookings either side of a date are ONE period or TWO, and the two
 * ways of being wrong are not symmetrical:
 *
 *   MERGING WRONGLY is the expensive one. Call a day a gap when the member was rostered to work it
 *   and the list states a single unbroken run of leave across a day they actually worked. Nothing
 *   errors, the box looks tidier than the truth, and a manager reads it as one holiday.
 *
 *   SPLITTING WRONGLY only costs tidiness — two short rows where one belonged.
 *
 * So the merge direction is pinned against a day the REAL roster says is worked, and the split
 * direction against a Sunday and a real rest day. Nothing here is hardcoded to a member or a date:
 * both are found by scanning the actual roster, so a roster edit cannot quietly turn an assertion
 * into a tautology.
 *
 * These functions existed for a long time nested inside `admin-app.js`'s `init()`, where no test
 * could reach them; the v23.54 extraction is what made this file possible.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { addDays, isRestGap, fmtPeriodDate, fmtPeriodRange } from './admin-period-dates.js';
import { teamMembers, getBaseShift, isSunday, parseISODate } from './roster-data.js';
import { isRestShift } from './override-utils.js';

const member = teamMembers.find(m => !m.hidden && !m.managerOnly && m.rosterType === 'main');

/** Find a real date in 2026 whose BASE shift satisfies `pred`, skipping Sundays (they have their
 *  own rule). Scanning beats a literal: a roster edit moves the pattern, and a hardcoded date would
 *  either start failing for the wrong reason or start passing for one. */
function scan(pred) {
    for (let m = 0; m < 12; m++) {
        for (let d = 1; d <= 28; d++) {
            const iso = `2026-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            if (isSunday(iso)) continue;
            if (pred(getBaseShift(member, parseISODate(iso)))) return iso;
        }
    }
    throw new Error('no suitable date in the real roster');
}

const WORKED  = scan(s => !isRestShift(s) && /^\d{2}:\d{2}-/.test(s));
const RESTDAY = scan(s => isRestShift(s));
const SUNDAY  = '2026-06-21';

describe('isRestGap — merging two periods that were never one', () => {
    test('a day the member was ROSTERED TO WORK is not a gap', () => {
        // The expensive direction. Saying yes here joins two separate bookings into one run of
        // leave straddling a day that was worked.
        assert.equal(isRestGap(WORKED, member), false);
    });

    test('a member the roster cannot resolve is not a gap either', () => {
        // An unresolved member gives no base shift, so there is no evidence the day was free.
        // Absence of evidence must not read as a rest day — fail towards splitting.
        assert.equal(isRestGap(WORKED, null), false);
        assert.equal(isRestGap(RESTDAY, null), false);
    });
});

describe('isRestGap — splitting a period that really was continuous', () => {
    test('a Sunday is always a gap, whoever it is', () => {
        // Sundays are uncontracted for every grade, so leave is never recorded on one and a Sunday
        // between two booked weeks interrupted nothing. True even with no member at all.
        assert.equal(isRestGap(SUNDAY, member), true);
        assert.equal(isRestGap(SUNDAY, null), true);
    });

    test("a day the member's own base roster gives them off is a gap", () => {
        assert.equal(isRestGap(RESTDAY, member), true);
    });
});

describe('addDays — stepping a date without falling off a month or a year', () => {
    test('forward and back within a month', () => {
        assert.equal(addDays('2026-06-15', 1), '2026-06-16');
        assert.equal(addDays('2026-06-15', -1), '2026-06-14');
    });

    test('across a month end, a year end, and a leap day', () => {
        assert.equal(addDays('2026-01-31', 1), '2026-02-01');
        assert.equal(addDays('2026-12-31', 1), '2027-01-01');
        assert.equal(addDays('2027-01-01', -1), '2026-12-31');
        assert.equal(addDays('2028-02-28', 1), '2028-02-29', '2028 is a leap year');
    });

    test('it does not mutate its input', () => {
        const d = '2026-06-15';
        addDays(d, 30);
        assert.equal(d, '2026-06-15');
    });
});

describe('the wording a manager reads', () => {
    test('a single date names its day, date and month', () => {
        assert.equal(fmtPeriodDate('2026-06-15'), 'Mon 15 Jun');
    });

    test('a range inside ONE month names the month once, at the end', () => {
        assert.equal(fmtPeriodRange('2026-06-15', '2026-06-19'), 'Mon 15 – Fri 19 Jun');
    });

    test('a range that CROSSES a month names both, or the reader cannot date the start', () => {
        assert.equal(fmtPeriodRange('2026-06-29', '2026-07-03'), 'Mon 29 Jun – Fri 3 Jul');
    });

    test('a single-day range still reads as a range, not as a bare date', () => {
        assert.equal(fmtPeriodRange('2026-06-15', '2026-06-15'), 'Mon 15 – Mon 15 Jun');
    });

    test('a range crossing a YEAR end names both months (same month NUMBER, different year)', () => {
        // The same-month branch compares getMonth() alone, so a December→December range a year
        // apart would collapse to one month label. Not reachable from the list — it merges
        // consecutive dates — but the branch is one comparison away from being wrong, and this
        // pins which side of it the code is on.
        assert.equal(fmtPeriodRange('2026-12-30', '2027-01-02'), 'Wed 30 Dec – Sat 2 Jan');
    });
});
