/**
 * admin-al-projection.test.mjs — the three layers of an AL booking must agree.
 * Run: node --test admin-al-projection.test.mjs   (part of `npm run test:hygiene`)
 *
 * ── WHAT THIS PINS ─────────────────────────────────────────────────────────────────────────────
 *
 * v23.78 shipped the swapped-day question wired only to the WRITE, so the preview, the
 * over-entitlement warning and the save could each describe the same booking differently. The tests
 * below are the three statements that were false, written as the external review described them:
 *
 *   1. a newly declared swapped rest day MUST reach the over-entitlement projection;
 *   2. nothing may be reported as "skipped" when the save is going to count it;
 *   3. the two surfaces must ask about the same days.
 *
 * Every one of them fails against the v23.78 rule (`consumesEntitlement` alone), which is the only
 * reason to believe they are protecting anything.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { teamMembers } from './roster-data.js';
import { projectAlBooking, willConsume, projectAlOverage } from './admin-al-projection.js';
import { consumesEntitlement } from './al-entitlement.js';

// C. Reen is the fixed Mon–Fri 12:00–19:00 line: every weekend is a rest day and every weekday is
// worked, which makes "working day" and "rest day" unambiguous without any override at all.
const reen = teamMembers.find(m => m.name === 'C. Reen');
const MON = '2026-06-15';   // working
const SAT = '2026-06-13';   // base rest day
const SUN = '2026-06-14';   // Sunday — never holds AL
const NO_OV = new Map();

describe('projectAlBooking — a declared swap reaches every layer', () => {
    test('an unanswered rest day is neither counted nor skipped', () => {
        const p = projectAlBooking({ member: reen, dates: [MON, SAT], ovByDate: NO_OV });
        assert.deepEqual(p.unanswered, [SAT]);
        assert.deepEqual(p.consuming, [MON]);
        // THE POINT: it must not be reported as skipped either. It has no answer yet, and a
        // date the reader is about to decide is not a date the app has decided.
        assert.equal(p.skipped.length, 0, 'an unanswered day is a question, not a skip');
    });

    test('answered SWAPPED: the rest day consumes, and is never called skipped', () => {
        const p = projectAlBooking({
            member: reen, dates: [MON, SAT], ovByDate: NO_OV,
            swapAnswers: new Map([[SAT, true]]),
        });
        assert.deepEqual(p.consuming.sort(), [SAT, MON].sort());
        assert.equal(p.counts.consuming, 2);
        assert.equal(p.counts.skipped, 0, 'nothing may say "skipped" about a day Save will count');
        // And the v23.78 rule — the one this replaces — still says the opposite about that day,
        // which is what made the defect invisible.
        assert.equal(consumesEntitlement(reen, SAT, NO_OV), false);
    });

    test('WRITING is every day the save will touch, and a FREE answer is not one of them', () => {
        // Added by the v23.82 regression sweep, which found this half of the contract unasserted:
        // making `writing.push` conditional on the day having been ASKED left all eleven tests
        // green. Nothing in production reads `writing` today — it is declared output and a count —
        // so that was a contract gap rather than a live defect, and the cheap moment to close it is
        // before somebody builds on it.
        //
        // WRITTEN AND CHARGED ARE TWO QUESTIONS, and the three answers here are all different.
        // MON is contracted: written, and it costs a day. SAT is a base rest day answered "no swap",
        // and the save writes NOTHING on it — the rule al-swapped-days.js exists for, since a stray
        // booking on a genuine rest day is what the whole question is there to stop. SUN is skipped
        // for a different reason again: Sundays cannot hold annual leave at all.
        //
        // The first draft of this test asserted SAT into `writing`, on the reading that a free day
        // is recorded and merely costs nothing. It is not, and the suite said so.
        const p = projectAlBooking({
            member: reen, dates: [MON, SAT, SUN], ovByDate: NO_OV,
            swapAnswers: new Map([[SAT, false]]),
        });
        assert.deepEqual(p.writing, [MON], 'only the contracted day is written');
        assert.equal(p.counts.writing, 1);
        assert.deepEqual(p.skipped.sort(), [SAT, SUN].sort(), 'both free days are written nowhere');
        assert.deepEqual(p.freeWritten, [], 'nothing here is written free of charge');
    });

    test('answered FREE: the rest day is skipped and costs nothing', () => {
        const p = projectAlBooking({
            member: reen, dates: [MON, SAT], ovByDate: NO_OV,
            swapAnswers: new Map([[SAT, false]]),
        });
        assert.deepEqual(p.consuming, [MON]);
        assert.deepEqual(p.skipped, [SAT]);
    });

    test('a Sunday is skipped and never asked about', () => {
        const p = projectAlBooking({ member: reen, dates: [SUN], ovByDate: NO_OV });
        assert.deepEqual(p.asked, []);
        assert.deepEqual(p.skipped, [SUN]);
        assert.equal(p.counts.writing, 0);
    });

    test('no member, no projection — and no throw', () => {
        const p = projectAlBooking({ member: null, dates: [MON] });
        assert.equal(p.counts.writing, 0);
        assert.equal(p.counts.asked, 0);
    });
});

describe('willConsume — the one rule both surfaces ask', () => {
    test('a declared swap consumes; the same day without the answer does not', () => {
        assert.equal(willConsume({ member: reen, date: SAT, ovByDate: NO_OV, swapped: true }), true);
        assert.equal(willConsume({ member: reen, date: SAT, ovByDate: NO_OV }), false);
    });

    test('a working day consumes with or without the flag', () => {
        assert.equal(willConsume({ member: reen, date: MON, ovByDate: NO_OV }), true);
        assert.equal(willConsume({ member: reen, date: MON, ovByDate: NO_OV, swapped: true }), true);
    });
});

describe('projectAlOverage — the warning the manager did not get', () => {
    // ONE day of entitlement left: her 2026 allowance is 32 and 31 days are already recorded.
    // Weekdays only, walked forward from 2 March until there are exactly 31 — her fixed Mon–Fri line
    // works every one of them, so each is unambiguously a consuming day with no override needed.
    const usedDates = [];
    for (let d = new Date('2026-03-02T00:00:00'); usedDates.length < 31; d.setDate(d.getDate() + 1)) {
        const dow = d.getDay();
        if (dow !== 0 && dow !== 6) usedDates.push(d.toISOString().slice(0, 10));
    }
    const existing = usedDates.map((date, i) => ({
        id: 'x' + i, memberName: 'C. Reen', type: 'annual_leave', date, value: 'AL',
    }));

    test('THE REGRESSION: one day left, a working day AND a declared swapped rest day → the bar appears', () => {
        const p = projectAlBooking({
            member: reen, dates: [MON, SAT], ovByDate: NO_OV,
            swapAnswers: new Map([[SAT, true]]),
        });
        const overage = projectAlOverage({
            member: reen, memberName: 'C. Reen', overrides: existing, consuming: p.consuming,
        });
        assert.ok(overage, 'two consuming days against one remaining must raise the confirmation');
        assert.match(overage.headline, /C\. Reen will be \d+ days? over their 2026 AL entitlement/);
    });

    test('and WITHOUT the answer the projection is one day, so the same booking does not warn', () => {
        // Not a defect: an unanswered day cannot be saved at all. This is here to show the two
        // figures genuinely differ, which is what made the v23.78 bug silent.
        const p = projectAlBooking({ member: reen, dates: [MON, SAT], ovByDate: NO_OV });
        assert.deepEqual(p.consuming, [MON]);
    });

    test('no entitlement on record → no bar, and no throw', () => {
        const stranger = { name: 'X. Unknown', role: 'Management', rosterType: 'main', currentWeek: 1 };
        assert.equal(projectAlOverage({
            member: stranger, memberName: 'X. Unknown', overrides: [], consuming: [MON],
        }), null);
    });

    test('nothing to charge → nothing to check', () => {
        assert.equal(projectAlOverage({
            member: reen, memberName: 'C. Reen', overrides: existing, consuming: [],
        }), null);
    });
});

describe('answeredFree — the half of `skipped` that is an ANSWER (v23.88, external review)', () => {
    // The week grid wrote annual leave on a rest day answered "rest day — free" and let it cost
    // nothing, while the AL card wrote nothing at all: one answer, two meanings, and a Calendar
    // showing AL on a day the manager had just called a genuine rest day. The grid now drops those
    // dates from its batch — and it must read THIS set rather than `skipped`, which also holds days
    // nobody was asked about.
    test('a rest day answered "free" is answeredFree, is skipped, and is not written', () => {
        const p = projectAlBooking({ member: reen, dates: [SAT], ovByDate: NO_OV,
            swapAnswers: new Map([[SAT, false]]) });
        assert.deepEqual(p.answeredFree, [SAT]);
        assert.deepEqual(p.skipped, [SAT]);
        assert.deepEqual(p.writing, []);
        assert.deepEqual(p.consuming, []);
        assert.equal(p.counts.answeredFree, 1);
    });

    test('answered "swapped" is in neither — it is written, and it costs a day', () => {
        const p = projectAlBooking({ member: reen, dates: [SAT], ovByDate: NO_OV,
            swapAnswers: new Map([[SAT, true]]) });
        assert.deepEqual(p.answeredFree, []);
        assert.deepEqual(p.writing, [SAT]);
        assert.deepEqual(p.consuming, [SAT]);
    });

    test('an UNANSWERED rest day is neither — it blocks the save instead', () => {
        const p = projectAlBooking({ member: reen, dates: [SAT], ovByDate: NO_OV, swapAnswers: new Map() });
        assert.deepEqual(p.unanswered, [SAT]);
        assert.deepEqual(p.answeredFree, []);
        assert.deepEqual(p.skipped, []);
    });

    test('a SUNDAY is skipped and is NOT answeredFree — nobody was asked about it', () => {
        const p = projectAlBooking({ member: reen, dates: [SUN], ovByDate: NO_OV, swapAnswers: new Map() });
        assert.deepEqual(p.skipped, [SUN]);
        assert.deepEqual(p.answeredFree, [], 'a day nobody was asked about is not an answer');
    });

    // NOT EVERY UNASKED REST DAY IS SKIPPED, which is the other half of the distinction. A rest day
    // carrying an `rdw` override is voluntary work, so the question is never asked (al-swapped-days.js)
    // — but it IS a worked day, so both surfaces write the leave, and `willConsume` is what stops it
    // costing anything. A grid that dropped its write would make a deliberate tap do nothing.
    test('a rest day carrying rdw is WRITTEN and costs nothing — asked about by nobody, skipped by nobody', () => {
        const ov = new Map([[SAT, { type: 'rdw', value: '08:00-16:00', date: SAT }]]);
        const p = projectAlBooking({ member: reen, dates: [SAT], ovByDate: ov, swapAnswers: new Map() });
        assert.deepEqual(p.asked, [], 'voluntary work is never asked about');
        assert.deepEqual(p.writing, [SAT]);
        assert.deepEqual(p.freeWritten, [SAT]);
        assert.deepEqual(p.consuming, []);
        assert.deepEqual(p.answeredFree, [], 'nothing was asked, so nothing was answered');
        assert.deepEqual(p.skipped, []);
    });

    test('a mixed booking separates them, and every set stays disjoint from consuming', () => {
        const p = projectAlBooking({ member: reen, dates: [MON, SAT, SUN], ovByDate: NO_OV,
            swapAnswers: new Map([[SAT, false]]) });
        assert.deepEqual(p.consuming, [MON]);
        assert.deepEqual(p.answeredFree, [SAT]);
        assert.deepEqual(p.skipped, [SAT, SUN]);
        assert.deepEqual(p.writing, [MON]);
        for (const d of p.answeredFree) assert.equal(p.consuming.includes(d), false);
        assert.equal(p.counts.answeredFree, 1);
        assert.equal(p.counts.skipped, 2);
    });
});
