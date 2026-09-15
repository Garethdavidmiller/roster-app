/**
 * admin-al-week-save.test.mjs — what one week-grid save does about the leave in it.
 * Run: node --test admin-al-week-save.test.mjs   (part of `npm run test:hygiene`)
 *
 * The sequence this pins used to live inside `admin-app.js`'s Save handler, where it could only be
 * reached through a browser. The decisions in it are not DOM decisions — they are about somebody's
 * leave — and two of them are ORDERINGS, which is the class of thing a test can hold and a reader
 * cannot see: the answered-free drop happens before `exclude` is computed, and the over-entitlement
 * check reads the projection's `consuming` rather than re-deriving from the stored record.
 *
 * Organised by what a wrong answer COSTS: a day of leave written that should not have been, a day
 * hidden from the entitlement check, or a bar that does not appear when somebody is being over-booked.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { teamMembers } from './roster-data.js';
import { planAlWeekSave } from './admin-al-week-save.js';

// C. Reen's fixed Mon–Fri line: every weekend is a rest day and every weekday is worked, so
// "working day" and "rest day" are unambiguous with no override at all.
const reen = teamMembers.find(m => m.name === 'C. Reen');
const MON = '2026-06-15';   // worked
const SAT = '2026-06-13';   // base rest day — the day the swap question is asked about
const NO_OV = new Map();

const al = (/** @type {string} */ date, /** @type {any} */ extra = {}) =>
    ({ memberName: 'C. Reen', date, type: 'annual_leave', value: 'AL', note: '', ...extra });

/** 31 recorded days against a 32-day entitlement: one left. */
const oneDayLeft = (() => {
    /** @type {string[]} */ const dates = [];
    for (let d = new Date('2026-03-02T00:00:00'); dates.length < 31; d.setDate(d.getDate() + 1)) {
        const dow = d.getDay();
        if (dow !== 0 && dow !== 6) dates.push(d.toISOString().slice(0, 10));
    }
    return dates.map((date, i) => ({ id: 'x' + i, memberName: 'C. Reen', type: 'annual_leave', date, value: 'AL' }));
})();

describe('a batch with no leave in it is not this module\'s business', () => {
    test('the SAME array comes back — not a copy, so nothing downstream can diverge', () => {
        const toSave = [{ memberName: 'C. Reen', date: MON, type: 'shift', value: '09:00-17:00' }];
        const plan = planAlWeekSave({ member: reen, memberName: 'C. Reen', toSave, ovByDate: NO_OV });
        assert.equal(plan.toSave, toSave);
        assert.deepEqual(plan.skipped, []);
        assert.equal(plan.overage, null);
    });
});

describe('"rest day — free": not written, and NAMED', () => {
    test('the leave is dropped from the batch and returned as skipped', () => {
        const plan = planAlWeekSave({
            member: reen, memberName: 'C. Reen', toSave: [al(MON), al(SAT)],
            ovByDate: NO_OV, swapAnswers: new Map([[SAT, false]]),
        });
        assert.deepEqual(plan.toSave.map(e => e.date), [MON]);
        assert.deepEqual(plan.skipped, [SAT]);
    });

    test('only the LEAVE on that date goes — another row for the same day survives', () => {
        // A save can carry more than one row for a date, and none of the rest was answered "free".
        const correction = { memberName: 'C. Reen', date: SAT, type: 'correction', value: 'RD' };
        const plan = planAlWeekSave({
            member: reen, memberName: 'C. Reen', toSave: [al(SAT), correction],
            ovByDate: NO_OV, swapAnswers: new Map([[SAT, false]]),
        });
        assert.deepEqual(plan.toSave, [correction]);
    });

    test('a day answered SWAPPED is kept — the answer decides, not the calendar', () => {
        const plan = planAlWeekSave({
            member: reen, memberName: 'C. Reen', toSave: [al(SAT)],
            ovByDate: NO_OV, swapAnswers: new Map([[SAT, true]]),
        });
        assert.deepEqual(plan.toSave.map(e => e.date), [SAT]);
        assert.deepEqual(plan.skipped, []);
    });
});

describe('the over-entitlement bar', () => {
    test('THE v23.79 REGRESSION, at the save: a declared swap counts toward the year', () => {
        // Two consuming days against one remaining. The swapped rest day is not a `shift` override
        // anywhere yet, so anything re-deriving from the stored record would filter it out as REST
        // and let the member be booked two days with no bar — then charge them both.
        const plan = planAlWeekSave({
            member: reen, memberName: 'C. Reen', toSave: [al(MON), al(SAT)],
            ovByDate: NO_OV, swapAnswers: new Map([[SAT, true]]), overrides: oneDayLeft,
        });
        assert.ok(plan.overage, 'two consuming days against one remaining must raise the bar');
        assert.match(plan.overage.headline, /C\. Reen will be \d+ days? over their 2026 AL entitlement/);
    });

    test('the same booking with that day answered FREE does not warn — it is not being charged', () => {
        const plan = planAlWeekSave({
            member: reen, memberName: 'C. Reen', toSave: [al(MON), al(SAT)],
            ovByDate: NO_OV, swapAnswers: new Map([[SAT, false]]), overrides: oneDayLeft,
        });
        assert.equal(plan.overage, null);
        assert.deepEqual(plan.skipped, [SAT]);
    });

    test('a written day that COSTS NOTHING must not push anybody over', () => {
        // The bar reads the projection's `consuming`, not the batch, and this is where the two
        // differ: leave over an `rdw` rest day IS written — the member gave back overtime, and the
        // calendar should say so — but declining overtime is not leave, so it charges nothing. A
        // check counting the batch would raise a bar against a day nobody is being charged for.
        const ov = new Map([[SAT, { type: 'rdw', value: '08:00-16:00', date: SAT }]]);
        const plan = planAlWeekSave({
            member: reen, memberName: 'C. Reen', toSave: [al(MON), al(SAT)],
            ovByDate: ov, overrides: oneDayLeft,
        });
        assert.deepEqual(plan.toSave.map(e => e.date), [MON, SAT], 'both are written');
        assert.deepEqual(plan.skipped, [], 'nobody was asked about it, so nothing was left alone');
        assert.equal(plan.overage, null, 'only one of the two costs a day — 31 + 1 is the entitlement');
    });

    test('nothing consuming, nothing to check', () => {
        const plan = planAlWeekSave({
            member: reen, memberName: 'C. Reen', toSave: [al(SAT)],
            ovByDate: NO_OV, swapAnswers: new Map([[SAT, false]]), overrides: oneDayLeft,
        });
        assert.equal(plan.overage, null);
    });
});

describe('ORDERING: the drop happens before `exclude` is built', () => {
    // `exclude` names the dates this batch OVERWRITES, so they are not counted twice against the
    // year. A day left alone overwrites nothing — excluding it would hide a day of the member's
    // EXISTING leave from the check, and the bar would not appear when it should.
    // `replacedType: 'shift'` is what makes this record COUNT: leave on a rest day costs nothing
    // unless the member was swapped onto it, and that field is how a previous save recorded exactly
    // that (v23.75). The first cut of this block left it out and FAILED — correctly, because a plain
    // leave record on a rest day is free, so excluding it or not moves no arithmetic and the ordering
    // these tests exist for would have been unobservable either way.
    const recordedSat = { id: 'sat-al', memberName: 'C. Reen', type: 'annual_leave', date: SAT,
                          value: 'AL', replacedType: 'shift' };

    test('a day answered FREE does not excuse its own existing record from the count', () => {
        // 31 elsewhere + this one = 32 recorded. Re-staging SAT and answering "free" writes nothing,
        // so that record stands; booking MON on top is the 33rd day and must warn.
        const plan = planAlWeekSave({
            member: reen, memberName: 'C. Reen',
            toSave: [al(MON), al(SAT, { existingId: 'sat-al' })],
            ovByDate: NO_OV, swapAnswers: new Map([[SAT, false]]),
            overrides: [...oneDayLeft, recordedSat],
        });
        assert.deepEqual(plan.skipped, [SAT]);
        assert.ok(plan.overage, 'the untouched record must still count — 32 already used, 1 more booked');
    });

    test('a day that IS overwritten is excluded, so it is not counted twice', () => {
        // The mirror image, and the reason `exclude` exists: re-saving a day that already holds
        // leave replaces it. Without the exclusion this same booking would read as 33 days.
        const plan = planAlWeekSave({
            member: reen, memberName: 'C. Reen',
            toSave: [al(SAT, { existingId: 'sat-al' })],
            ovByDate: NO_OV, swapAnswers: new Map([[SAT, true]]),
            overrides: [...oneDayLeft, recordedSat],
        });
        assert.equal(plan.overage, null, 'replacing a recorded day is not a new day');
    });

    test('a DELETED leave document is excluded too — it is being removed, not re-counted', () => {
        const plan = planAlWeekSave({
            member: reen, memberName: 'C. Reen', toSave: [al(MON)], toDelete: ['sat-al'],
            ovByDate: NO_OV, overrides: [...oneDayLeft, recordedSat],
        });
        assert.equal(plan.overage, null, 'deleting one day and booking another is a net nil');
    });
});
