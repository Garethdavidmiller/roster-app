/**
 * admin-al-projection.test.mjs — the three layers of an AL booking must agree.
 * Run: node scripts/run-tests.mjs test/admin-al-projection.test.mjs   (part of `npm run test:hygiene`)
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
import { readFileSync } from 'node:fs';

import { teamMembers, formatISO, getBaseShift, getPatternShift, isWorkedShift, getBankHolidays, isBankHoliday } from '../roster-data.js';
import { projectAlBooking, willConsume, projectAlOverage, overridesAfterSave, lieuGoesWords, rangeSundayCorrections, projectAbsenceRange, yearShiftWords } from '../admin-al-projection.js';
import { consumesEntitlement, countedAlDates, entitlementFor } from '../al-entitlement.js';
import { isRestShift } from '../override-utils.js';
import { planAlWeekSave } from '../admin-al-week-save.js';

// Tests live in test/ but address files from the repository root (moved 24 Nov 2026).
const REPO_ROOT_URL = new URL('../', import.meta.url);

// An INVENTED member on fixed pattern 1, the Mon–Fri 12:00–19:00 line: every weekend is a rest day and every weekday is
// worked, which makes "working day" and "rest day" unambiguous without any override at all.
const fixedCea = { name: 'F. Fixture', role: 'CEA', rosterType: 'fixed', currentWeek: 1 };
const MON = '2026-06-15';   // working
const SAT = '2026-06-13';   // base rest day
const SUN = '2026-06-14';   // Sunday — never holds AL
const NO_OV = new Map();

describe('projectAlBooking — a declared swap reaches every layer', () => {
    test('an unanswered rest day is neither counted nor skipped', () => {
        const p = projectAlBooking({ member: fixedCea, dates: [MON, SAT], ovByDate: NO_OV });
        assert.deepEqual(p.unanswered, [SAT]);
        assert.deepEqual(p.consuming, [MON]);
        // THE POINT: it must not be reported as skipped either. It has no answer yet, and a
        // date the reader is about to decide is not a date the app has decided.
        assert.equal(p.skipped.length, 0, 'an unanswered day is a question, not a skip');
    });

    test('answered SWAPPED: the rest day consumes, and is never called skipped', () => {
        const p = projectAlBooking({
            member: fixedCea, dates: [MON, SAT], ovByDate: NO_OV,
            swapAnswers: new Map([[SAT, true]]),
        });
        assert.deepEqual(p.consuming.sort(), [SAT, MON].sort());
        assert.equal(p.counts.consuming, 2);
        assert.equal(p.counts.skipped, 0, 'nothing may say "skipped" about a day Save will count');
        // And the v23.78 rule — the one this replaces — still says the opposite about that day,
        // which is what made the defect invisible.
        assert.equal(consumesEntitlement(fixedCea, SAT, NO_OV), false);
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
            member: fixedCea, dates: [MON, SAT, SUN], ovByDate: NO_OV,
            swapAnswers: new Map([[SAT, false]]),
        });
        assert.deepEqual(p.writing, [MON], 'only the contracted day is written');
        assert.equal(p.counts.writing, 1);
        assert.deepEqual(p.skipped.sort(), [SAT, SUN].sort(), 'both free days are written nowhere');
        assert.deepEqual(p.freeWritten, [], 'nothing here is written free of charge');
    });

    test('answered FREE: the rest day is skipped and costs nothing', () => {
        const p = projectAlBooking({
            member: fixedCea, dates: [MON, SAT], ovByDate: NO_OV,
            swapAnswers: new Map([[SAT, false]]),
        });
        assert.deepEqual(p.consuming, [MON]);
        assert.deepEqual(p.skipped, [SAT]);
    });

    test('a Sunday is skipped and never asked about', () => {
        const p = projectAlBooking({ member: fixedCea, dates: [SUN], ovByDate: NO_OV });
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

describe('alreadyBooked — leave written again is not a new day (review, Nov 2026)', () => {
    const TUE = '2026-06-16', WED = '2026-06-17';
    const leave = (/** @type {string} */ date, /** @type {Record<string, any>} */ extra = {}) =>
        ({ id: `l${date}`, memberName: fixedCea.name, date, type: 'annual_leave', value: 'AL', source: 'manual', createdAt: { seconds: 1 }, ...extra });

    test('two of three working days already leave: they are counted, and named as already booked', () => {
        const ovByDate = new Map([[MON, leave(MON)], [TUE, leave(TUE)]]);
        const p = projectAlBooking({ member: fixedCea, dates: [MON, TUE, WED], ovByDate });
        assert.deepEqual(p.consuming, [MON, TUE, WED], 'the over-allowance check is unchanged: every day still costs');
        assert.deepEqual(p.alreadyBooked, [MON, TUE]);
        assert.equal(p.counts.alreadyBooked, 2);
    });

    test('a rest day whose free leave is answered SWAPPED is a new day spent, not one already booked', () => {
        const ovByDate = new Map([[SAT, leave(SAT)]]);
        assert.equal(consumesEntitlement(fixedCea, SAT, ovByDate), false, 'premise: the leave there costs nothing now');
        const p = projectAlBooking({ member: fixedCea, dates: [SAT], ovByDate, swapAnswers: new Map([[SAT, true]]) });
        assert.deepEqual(p.consuming, [SAT]);
        assert.deepEqual(p.alreadyBooked, [], 'its cost changes, so the balance falls by it');
    });

    test('a shift on the day, or nothing, is a new day', () => {
        const ovByDate = new Map([[MON, { ...leave(MON), type: 'shift', value: '12:00-19:00' }]]);
        const p = projectAlBooking({ member: fixedCea, dates: [MON, TUE], ovByDate });
        assert.deepEqual(p.alreadyBooked, []);
    });
});

describe('willConsume — the one rule both surfaces ask', () => {
    test('a declared swap consumes; the same day without the answer does not', () => {
        assert.equal(willConsume({ member: fixedCea, date: SAT, ovByDate: NO_OV, swapped: true }), true);
        assert.equal(willConsume({ member: fixedCea, date: SAT, ovByDate: NO_OV }), false);
    });

    test('a working day consumes with or without the flag', () => {
        assert.equal(willConsume({ member: fixedCea, date: MON, ovByDate: NO_OV }), true);
        assert.equal(willConsume({ member: fixedCea, date: MON, ovByDate: NO_OV, swapped: true }), true);
    });
});

describe('projectAlOverage — the warning the manager did not get', () => {
    // ONE day of entitlement left: a CEA's 2026 allowance is 32 and 31 days are already recorded.
    // Weekdays only, walked forward from 2 March until there are exactly 31 — the fixed Mon–Fri line
    // works every one of them, so each is unambiguously a consuming day with no override needed.
    const usedDates = [];
    for (let d = new Date('2026-03-02T00:00:00'); usedDates.length < 31; d.setDate(d.getDate() + 1)) {
        const dow = d.getDay();
        if (dow !== 0 && dow !== 6) usedDates.push(formatISO(d));
    }
    const existing = usedDates.map((date, i) => ({
        id: 'x' + i, memberName: 'F. Fixture', type: 'annual_leave', date, value: 'AL',
    }));

    test('THE REGRESSION: one day left, a working day AND a declared swapped rest day → the bar appears', () => {
        const p = projectAlBooking({
            member: fixedCea, dates: [MON, SAT], ovByDate: NO_OV,
            swapAnswers: new Map([[SAT, true]]),
        });
        const overage = projectAlOverage({
            member: fixedCea, memberName: 'F. Fixture', overrides: existing, consuming: p.consuming,
        });
        assert.ok(overage, 'two consuming days against one remaining must raise the confirmation');
        assert.match(overage.headline, /F\. Fixture will be \d+ days? over their 2026 annual leave allowance/);
    });

    test('and WITHOUT the answer the projection is one day, so the same booking does not warn', () => {
        // Not a defect: an unanswered day cannot be saved at all. This is here to show the two
        // figures genuinely differ, which is what made the v23.78 bug silent.
        const p = projectAlBooking({ member: fixedCea, dates: [MON, SAT], ovByDate: NO_OV });
        assert.deepEqual(p.consuming, [MON]);
        // …and the check the name promises, which this never ran (test audit, 7 Nov 2026).
        assert.equal(projectAlOverage({
            member: fixedCea, memberName: 'The member', overrides: existing, consuming: p.consuming,
        }), null, 'one consuming day against one remaining must fit');
    });

    test('premise: the fixture leaves exactly ONE day of the year\'s allowance', () => {
        // Every case in this block assumes it, and nothing checked it (test audit, 7 Nov 2026).
        assert.equal(entitlementFor(fixedCea, '2026', existing), usedDates.length + 1);
        assert.equal(countedAlDates({ overrides: existing, member: fixedCea, year: '2026' }).size, usedDates.length);
    });

    test('no entitlement on record → no bar, and no throw', () => {
        const stranger = { name: 'X. Unknown', role: 'Management', rosterType: 'main', currentWeek: 1 };
        assert.equal(projectAlOverage({
            member: stranger, memberName: 'X. Unknown', overrides: [], consuming: [MON],
        }), null);
    });

    test('nothing to charge → nothing to check', () => {
        assert.equal(projectAlOverage({
            member: fixedCea, memberName: 'F. Fixture', overrides: existing, consuming: [],
        }), null);
    });

    // v25.18: a January day moved back to last year's allowance keeps that year when it is booked
    // over again (`nextLeaveYear`), so the warning must charge it THERE — not to the year its date is in.
    test('a re-booked January day already moved to 2026 is charged to 2026, not 2027', () => {
        const JAN = '2027-01-05';   // a Tuesday on the Mon–Fri line
        const moved = { id: 'jan', memberName: 'F. Fixture', type: 'annual_leave', date: JAN, value: 'AL', leaveYear: 2026 };
        // 2026 has ONE day left before the move is counted; the move spends it, so 2026 is exactly full
        // and re-booking the same day must not warn — it is the same day, already counted there.
        const overrides = [...existing, moved];
        assert.equal(projectAlOverage({ member: fixedCea, memberName: 'F. Fixture', overrides, consuming: [JAN] }), null);
        // With 2026 at its limit BEFORE the move, the moved day puts it one over, and re-booking it
        // reports that. It does NOT show which year the re-booked day is charged to, though: the
        // moved day is already in 2026's EXISTING count, so 2026 is over either way (test audit,
        // 7 Nov 2026 — charging new days by their own date's year left this green).
        assert.ok(!existing.some(e => e.date === '2026-04-15'), 'fixture: the extra 2026 day is a new one');
        const full = [...existing, { id: 'x31', memberName: 'F. Fixture', type: 'annual_leave', date: '2026-04-15', value: 'AL' }];
        const over = projectAlOverage({ member: fixedCea, memberName: 'F. Fixture', overrides: [...full, moved], consuming: [JAN] });
        assert.ok(over, 'charged to 2026, which the moved day has put one over');
        assert.match(over.headline, /2026 annual leave allowance/);
        // The bucket itself: a save that OVERWRITES the moved day re-accounts it (`exclude`), so it
        // is out of the existing count and in this save's — and only charging it to 2026 finds 2026
        // one over. Charged to 2027, the year of its date, the save would pass with no warning.
        const resaved = projectAlOverage({ member: fixedCea, memberName: 'The member', overrides: [...full, moved],
            consuming: [JAN], exclude: new Set([JAN]) });
        assert.ok(resaved, 'the re-saved January day was not charged to 2026, the year it was moved to');
        assert.match(resaved.headline, /1 day over their 2026 annual leave allowance/);
    });
});

describe('answeredFree — the half of `skipped` that is an ANSWER (v23.88, external review)', () => {
    // The week grid wrote annual leave on a rest day answered "rest day — free" and let it cost
    // nothing, while the AL card wrote nothing at all: one answer, two meanings, and a Calendar
    // showing AL on a day the manager had just called a genuine rest day. The grid now drops those
    // dates from its batch — and it must read THIS set rather than `skipped`, which also holds days
    // nobody was asked about.
    test('a rest day answered "free" is answeredFree, is skipped, and is not written', () => {
        const p = projectAlBooking({ member: fixedCea, dates: [SAT], ovByDate: NO_OV,
            swapAnswers: new Map([[SAT, false]]) });
        assert.deepEqual(p.answeredFree, [SAT]);
        assert.deepEqual(p.skipped, [SAT]);
        assert.deepEqual(p.writing, []);
        assert.deepEqual(p.consuming, []);
        assert.equal(p.counts.answeredFree, 1);
    });

    test('answered "swapped" is in neither — it is written, and it costs a day', () => {
        const p = projectAlBooking({ member: fixedCea, dates: [SAT], ovByDate: NO_OV,
            swapAnswers: new Map([[SAT, true]]) });
        assert.deepEqual(p.answeredFree, []);
        assert.deepEqual(p.writing, [SAT]);
        assert.deepEqual(p.consuming, [SAT]);
    });

    test('an UNANSWERED rest day is neither — it blocks the save instead', () => {
        const p = projectAlBooking({ member: fixedCea, dates: [SAT], ovByDate: NO_OV, swapAnswers: new Map() });
        assert.deepEqual(p.unanswered, [SAT]);
        assert.deepEqual(p.answeredFree, []);
        assert.deepEqual(p.skipped, []);
    });

    test('a SUNDAY is skipped and is NOT answeredFree — nobody was asked about it', () => {
        const p = projectAlBooking({ member: fixedCea, dates: [SUN], ovByDate: NO_OV, swapAnswers: new Map() });
        assert.deepEqual(p.skipped, [SUN]);
        assert.deepEqual(p.answeredFree, [], 'a day nobody was asked about is not an answer');
    });

    // NOT EVERY UNASKED REST DAY IS SKIPPED, which is the other half of the distinction. A rest day
    // carrying an `rdw` override is voluntary work, so the question is never asked (al-swapped-days.js)
    // — but it IS a worked day, so both surfaces write the leave, and `willConsume` is what stops it
    // costing anything. A grid that dropped its write would make a deliberate tap do nothing.
    test('a rest day carrying rdw is WRITTEN and costs nothing — asked about by nobody, skipped by nobody', () => {
        const ov = new Map([[SAT, { type: 'rdw', value: '08:00-16:00', date: SAT }]]);
        const p = projectAlBooking({ member: fixedCea, dates: [SAT], ovByDate: ov, swapAnswers: new Map() });
        assert.deepEqual(p.asked, [], 'voluntary work is never asked about');
        assert.deepEqual(p.writing, [SAT]);
        assert.deepEqual(p.freeWritten, [SAT]);
        assert.deepEqual(p.consuming, []);
        assert.deepEqual(p.answeredFree, [], 'nothing was asked, so nothing was answered');
        assert.deepEqual(p.skipped, []);
    });

    test('a mixed booking separates them, and every set stays disjoint from consuming', () => {
        const p = projectAlBooking({ member: fixedCea, dates: [MON, SAT, SUN], ovByDate: NO_OV,
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

describe('Christmas Day and Boxing Day — never asked, never written, named as themselves (v25.37)', () => {
    // The Mon–Fri line has the member DUE at work on Christmas Day 2026 (a Friday) and resting on Boxing
    // Day (a Saturday). The answer on both is the same and fixed — leave there never costs a day, and
    // somebody due at work already HAS it, shown from the roster — so neither may be asked about.
    const EVE = '2026-12-24', XMAS = '2026-12-25', BOXING = '2026-12-26';

    test('neither day is asked about, written or counted, whatever the pattern says', () => {
        const p = projectAlBooking({ member: fixedCea, dates: [EVE, XMAS, BOXING], ovByDate: NO_OV });
        assert.deepEqual(p.asked, [], 'a question whose answer is fixed is not a question');
        assert.deepEqual(p.writing, [EVE]);
        assert.deepEqual(p.consuming, [EVE]);
        assert.deepEqual(p.christmas, [XMAS, BOXING]);
        // `answeredFree` is what BOTH surfaces drop from the write — the week grid's plan filters on
        // it — so a Christmas day must be in it, or the grid would write leave the range card skips.
        assert.deepEqual(p.answeredFree, [XMAS, BOXING]);
        assert.ok(p.christmas.every(d => p.skipped.includes(d)), 'a SUBSET of skipped — the preview subtracts it');
        assert.equal(p.counts.christmas, 2);
    });

    test('work already recorded there is replaced at no cost — the leave is still written', () => {
        const ov = new Map([[BOXING, { type: 'rdw', value: '06:00-14:00' }]]);
        const p = projectAlBooking({ member: fixedCea, dates: [BOXING], ovByDate: ov });
        assert.deepEqual(p.writing, [BOXING]);
        assert.deepEqual(p.freeWritten, [BOXING]);
        assert.deepEqual(p.consuming, []);
        assert.deepEqual(p.christmas, []);
    });

    test('before 2026 nothing changes: Christmas Day 2025 is asked about like any other rest day', () => {
        const p = projectAlBooking({ member: fixedCea, dates: ['2025-12-25'], ovByDate: NO_OV });
        assert.deepEqual(p.asked, ['2025-12-25']);
        assert.deepEqual(p.christmas, []);
    });
});

describe('the day in lieu reaches the over-entitlement warning (v25.37)', () => {
    // A CEA due at work on Boxing Day 2026 with 32 days of 2027 leave recorded — the whole contract
    // figure. Working that Boxing Day earns a 33rd, in the NEXT year's allowance (owner, 15 Nov
    // 2026), so one more 2027 day is inside the allowance; without the work it is one over. The
    // warning reads the allowance through `entitlementFor`, and this is the test that would notice it
    // reading the contract figure instead.
    const BOXING = new Date(2026, 11, 26);
    const cea = teamMembers.find(m => m.role === 'CEA' && !m.hidden && !m.startDate && !m.proRatedAL
        && m.bilingualContract !== true && !['RD', 'OFF', 'SPARE'].includes(getPatternShift(m, BOXING)));
    /** Working days the member's pattern has in `year`, from March. @param {number} year @param {number} n */
    const workdays = (year, n) => {
        /** @type {string[]} */ const out = [];
        for (let d = new Date(year, 2, 2); out.length < n; d.setDate(d.getDate() + 1)) {
            if (d.getDay() !== 0 && isWorkedShift(getBaseShift(cea, d)) && getBaseShift(cea, d) !== 'SPARE') out.push(formatISO(d));
        }
        return out;
    };
    const used = workdays(2027, 33);
    const asLeave = (/** @type {string[]} */ dates) => dates.map((date, i) => ({ id: 'c' + i, memberName: cea.name, type: 'annual_leave', date, value: 'AL' }));
    const recorded = asLeave(used.slice(0, 32));
    const worked = { id: 'bx', memberName: cea.name, type: 'rdw', date: '2026-12-26', value: '06:00-14:00' };

    test('the fixture is what it says: a 32-day CEA, due at work on Boxing Day', () => {
        assert.ok(cea, 'needs a plain CEA due at work on Boxing Day 2026');
        assert.equal(recorded.length, 32);
    });

    test('without the worked Boxing Day, one more day is over', () => {
        assert.ok(projectAlOverage({ member: cea, memberName: cea.name, overrides: recorded, consuming: [used[32]] }));
    });

    test('with it, the same day is inside the allowance', () => {
        assert.equal(projectAlOverage({ member: cea, memberName: cea.name, overrides: [...recorded, worked], consuming: [used[32]] }), null);
    });

    test('…and the year of the Boxing Day itself gains nothing: one more 2026 day at the limit is over', () => {
        const in2026 = workdays(2026, 33);
        assert.ok(projectAlOverage({ member: cea, memberName: cea.name, overrides: [...asLeave(in2026.slice(0, 32)), worked],
            consuming: [in2026[32]] }), 'the day in lieu is 2027\'s, so 2026 is still at 32');
    });

    // LEAVE WRITTEN OVER THE WORKED BOXING DAY TAKES THE DAY IN LIEU BACK (6 Nov 2026 review) — from
    // the year that holds it, 2027 (15 Nov 2026). One day left there (33 − 32), and a booking over
    // that one day AND the worked Boxing Day: the leave on 26 Dec is free, but it replaces the work
    // that earned the 33rd day, so the save ends one over. Costed against the allowance before the
    // save, the preview called 26 Dec "recorded at no cost", no bar appeared, and the member was −1
    // afterwards. These run the range card's own composition — projectAlBooking, then
    // overridesAfterSave of what it writes, then projectAlOverage.
    const rangeCard = (/** @type {any[]} */ overrides, /** @type {string[]} */ dates) => {
        const ovByDate = new Map(overrides.map(o => [o.date, o]));
        const proj = projectAlBooking({ member: cea, dates, ovByDate });
        return { proj, overage: projectAlOverage({ member: cea, memberName: cea.name, overrides, consuming: proj.consuming,
            after: overridesAfterSave(overrides, { memberName: cea.name, writes: proj.writing.map(date => ({ date, type: 'annual_leave', value: 'AL' })) }) }) };
    };

    test('the preview names a worked Boxing Day the leave replaces, and does not call it free', () => {
        const { proj } = rangeCard([...recorded, worked], ['2026-12-26', used[32]]);
        assert.deepEqual(proj.lieuLost, ['2026-12-26']);
        assert.ok(proj.freeWritten.includes('2026-12-26'), 'premise: the leave itself costs nothing');
        assert.equal(proj.counts.lieuLost, 1);
    });

    test('a Boxing Day with no work on record loses nothing, so it is not named', () => {
        assert.deepEqual(rangeCard(recorded, ['2026-12-26', used[32]]).proj.lieuLost, []);
    });

    test('booking over the worked Boxing Day with one day left raises the bar: the save ends one over', () => {
        const { overage } = rangeCard([...recorded, worked], ['2026-12-26', used[32]]);
        assert.ok(overage, 'the save takes back the day in lieu, so the one day left is gone');
        assert.equal(overage.over, 1);
        assert.match(overage.detail, /33 days used of 32 allowed in 2027/);
    });

    test('booking over the worked Boxing Day ALONE can leave the next year over: it spends nothing there', () => {
        // 33 days of 2027 leave against 33 (32 and the day in lieu). The booking is one free day in
        // 2026, and still takes 2027 to 33 of 32 — the year the save touches only through the lieu.
        const { overage } = rangeCard([...asLeave(used.slice(0, 33)), worked], ['2026-12-26']);
        assert.ok(overage, 'the day in lieu is 2027\'s, and the save takes it back');
        assert.match(overage.detail, /33 days used of 32 allowed in 2027/);
    });

    test('booking the one day left WITHOUT touching Boxing Day still fits', () => {
        assert.equal(rangeCard([...recorded, worked], [used[32]]).overage, null);
    });

    test('the range card hands the warning the allowance after the save', () => {
        // The wiring, not the helper: without `after` the range card costs against the allowance as it
        // was, and everything above stays green while the page misses the day.
        const src = readFileSync(new URL('./admin-al.js', REPO_ROOT_URL), 'utf8');
        const call = src.slice(src.indexOf('projectAlOverage({'), src.indexOf('});', src.indexOf('projectAlOverage({')));
        // Since 21 Nov 2026 the writes are the projection's own (`writes`, with each day's swap), so the
        // after picture records what each day replaced exactly as the save will.
        assert.match(call, /after:\s*overridesAfterSave\(getAllOverrides\(\),[\s\S]*\bwrites\b/,
            'admin-al.js must pass `after: overridesAfterSave(getAllOverrides(), { … writes })` to projectAlOverage');
        assert.match(src, /const \{[^}]*\bwrites\b[^}]*\} = projectAlBooking\(/, '…and `writes` must be the projection\'s');
    });
});

// ── A DISPATCHER'S BANK HOLIDAY EARNS A DAY IN LIEU TOO (7 Nov 2026 review) ──────────────────────
// Leave over a bank holiday a Dispatcher works takes that day in lieu back, exactly as leave over a
// worked Boxing Day does — and unlike Boxing Day the leave itself is charged. The preview named only
// Boxing Day, so it said "1 day" for a booking that left the member two down. `lieuLost` is now read
// off the allowance, so it covers every rule that earns a day in lieu.
describe('the preview names every day in lieu a booking takes back', () => {
    const disp = teamMembers.find(m => m.role === 'Dispatcher' && !m.hidden && !m.startDate && !m.proRatedAL && !m.rosterChanges);
    const at = (/** @type {string} */ iso) => new Date(`${iso}T12:00:00`);
    const bh = getBankHolidays(2026).map(formatISO)
        .find(iso => at(iso).getMonth() < 11 && at(iso).getDay() !== 0 && isWorkedShift(getBaseShift(disp, at(iso))));

    test('the fixture is a Dispatcher rostered on a 2026 bank holiday', () => {
        assert.ok(disp, 'a plain Dispatcher');
        assert.ok(bh, 'a bank holiday they work by pattern');
    });

    test('leave on a bank holiday the Dispatcher works is CHARGED and takes the day in lieu back', () => {
        const proj = projectAlBooking({ member: disp, dates: [bh], ovByDate: new Map() });
        assert.deepEqual(proj.consuming, [bh], 'the leave itself costs a day');
        assert.deepEqual(proj.lieuLost, [bh], 'and so does the day in lieu it loses');
    });

    test('a worked Christmas Day takes its bank-holiday day in lieu with it, though the leave is free', () => {
        const worked = { id: 'x', memberName: disp.name, type: 'rdw', date: '2026-12-25', value: '06:00-14:00' };
        const proj = projectAlBooking({ member: disp, dates: ['2026-12-25'], ovByDate: new Map([['2026-12-25', worked]]) });
        assert.deepEqual(proj.lieuLost, ['2026-12-25']);
    });

    test('a CEA\'s ordinary bank holiday earns nothing in lieu, so nothing is named', () => {
        const cea = teamMembers.find(m => m.role === 'CEA' && !m.hidden && !m.startDate && !m.rosterChanges
            && isWorkedShift(getBaseShift(m, at(bh))));
        assert.ok(cea, 'a CEA rostered on that bank holiday');
        assert.deepEqual(projectAlBooking({ member: cea, dates: [bh], ovByDate: new Map() }).lieuLost, []);
    });

    test('the words name each day: Christmas and Boxing Day by name, any other by its date', () => {
        assert.equal(lieuGoesWords(['2026-12-26']), 'Boxing Day recorded as leave, so the day in lieu for working it goes');
        assert.equal(lieuGoesWords(['2026-12-25', '2026-12-26']),
            'Christmas Day and Boxing Day recorded as leave, so the days in lieu for working them go');
        assert.equal(lieuGoesWords(['2026-08-31']), 'the bank holiday on 31 August recorded as leave, so the day in lieu for working it goes');
    });
});

// ── AN ABSENCE TAKES THE DAY IN LIEU BACK TOO (review of v26.22) ─────────────────────────────────
// Recorded over a day whose WORK earned a day in lieu, an absence removes that work exactly as leave
// does, so the allowance falls. The Absence card checked nothing; `projectAbsenceRange` is the range
// card's own composition — the writer's dates, the allowance after them, nothing spent — so only a
// FALLING allowance can raise the bar. People here are INVENTED names on real patterns.
describe('projectAbsenceRange — an absence over work that earned a day in lieu', () => {
    const BOXING = new Date(2026, 11, 26);
    const pattern = teamMembers.find(m => m.role === 'CEA' && !m.hidden && !m.startDate && !m.proRatedAL && !m.rosterChanges
        && m.bilingualContract !== true && !['RD', 'OFF', 'SPARE'].includes(getPatternShift(m, BOXING)));
    const person = { ...pattern, name: 'Z. Invented' };
    /** Working days the pattern has in `year`, from March, skipping bank holidays. @param {number} year @param {number} n */
    const workdays = (year, n) => {
        /** @type {string[]} */ const out = [];
        for (let d = new Date(year, 2, 2); out.length < n; d.setDate(d.getDate() + 1)) {
            if (d.getDay() !== 0 && !isBankHoliday(d) && isWorkedShift(getBaseShift(person, d)) && getBaseShift(person, d) !== 'SPARE') out.push(formatISO(d));
        }
        return out;
    };
    const in2027 = workdays(2027, 34);
    const asLeave = (/** @type {string[]} */ dates) => dates.map((date, i) => ({ id: 'z' + i, memberName: person.name, type: 'annual_leave', date, value: 'AL' }));
    const worked = { id: 'zbx', memberName: person.name, type: 'rdw', date: '2026-12-26', value: '06:00-14:00' };
    const run = (/** @type {any[]} */ overrides, /** @type {string[]} */ dates) => projectAbsenceRange({ member: person,
        memberName: person.name, overrides, ovByDate: new Map(overrides.map(o => [o.date, o])), dates });

    test('the fixture: a 32-day CEA pattern due at work on Boxing Day 2026, and 33 working days in 2027', () => {
        assert.ok(pattern, 'needs a plain CEA due at work on Boxing Day 2026');
        assert.equal(entitlementFor(person, 2027, [worked]), 33, '32, and the worked Boxing Day\'s day in lieu');
    });

    test('at the next year\'s limit, an absence over the worked Boxing Day raises the bar and names the day', () => {
        const r = run([...asLeave(in2027.slice(0, 33)), worked], ['2026-12-26']);
        assert.deepEqual(r.writing, ['2026-12-26']);
        assert.deepEqual(r.lieuLost, ['2026-12-26']);
        assert.ok(r.overage, 'the absence takes back the day in lieu, so 33 of 33 becomes 33 of 32');
        assert.equal(r.overage.detail, 'Boxing Day recorded as absent, so the day in lieu for working it goes · 33 days used of 32 allowed in 2027');
    });

    test('with a day to spare, the day in lieu is named and the save is not stopped', () => {
        const r = run([...asLeave(in2027.slice(0, 32)), worked], ['2026-12-26']);
        assert.deepEqual(r.lieuLost, ['2026-12-26']);
        assert.equal(r.overage, null);
    });

    test('a Boxing Day with no work on record is not written, and loses nothing', () => {
        const r = run(asLeave(in2027.slice(0, 33)), ['2026-12-26']);
        assert.deepEqual(r.writing, []);
        assert.equal(r.overage, null);
    });

    test('ONLY A FALLING ALLOWANCE WARNS: a member already over is not stopped by an absence that lowers nothing', () => {
        const r = run(asLeave(in2027.slice(0, 33)), [in2027[33]]);   // 33 of 32 already, absent on an ordinary day
        assert.deepEqual(r.writing, [in2027[33]], 'premise: the day is written');
        assert.deepEqual(r.lieuLost, []);
        assert.equal(r.overage, null);
    });

    test('leave the absence replaces is no longer counted: losing the day in lieu and a day of leave together still fits', () => {
        // At the limit (33 of 33). The absence takes the Boxing Day lieu (→ 32) and replaces one day of
        // 2027 leave (→ 32 used): exactly at the limit, so no bar. Counted twice, it read "1 day over".
        const r = run([...asLeave(in2027.slice(0, 33)), worked], ['2026-12-26', in2027[0]]);
        assert.deepEqual(r.lieuLost, ['2026-12-26']);
        assert.equal(r.overage, null);
    });

    test('a Dispatcher\'s worked bank holiday: an absence on it at the limit raises the bar', () => {
        const disp = teamMembers.find(m => m.role === 'Dispatcher' && !m.hidden && !m.startDate && !m.proRatedAL && !m.rosterChanges);
        const at = (/** @type {string} */ iso) => new Date(`${iso}T12:00:00`);
        const bh = getBankHolidays(2026).map(formatISO)
            .find(iso => at(iso).getMonth() < 11 && at(iso).getDay() !== 0 && isWorkedShift(getBaseShift(disp, at(iso))));
        assert.ok(disp && bh, 'premise: a plain Dispatcher pattern rostered on a 2026 bank holiday');
        const d = { ...disp, name: 'Y. Invented' };
        const allowance = /** @type {number} */ (entitlementFor(d, 2026, []));
        /** @type {string[]} */ const leave = [];
        for (let x = new Date(2026, 0, 2); leave.length < allowance; x.setDate(x.getDate() + 1)) {
            if (x.getDay() !== 0 && !isBankHoliday(x) && isWorkedShift(getBaseShift(d, x)) && getBaseShift(d, x) !== 'SPARE') leave.push(formatISO(x));
        }
        const ovs = leave.map((date, i) => ({ id: 'y' + i, memberName: d.name, type: 'annual_leave', date, value: 'AL' }));
        const r = projectAbsenceRange({ member: d, memberName: d.name, overrides: ovs, ovByDate: new Map(ovs.map(o => [o.date, o])), dates: [bh] });
        assert.deepEqual(r.lieuLost, [bh]);
        assert.ok(r.overage, 'at the limit, the bank holiday\'s day in lieu going leaves them one over');
        assert.equal(r.overage.over, 1);
    });

    test('the leave card\'s words are unchanged, and the Absence card says "absent"', () => {
        assert.equal(lieuGoesWords(['2026-12-26']), 'Boxing Day recorded as leave, so the day in lieu for working it goes');
        assert.equal(lieuGoesWords(['2026-12-25', '2026-12-26'], 'absent'),
            'Christmas Day and Boxing Day recorded as absent, so the days in lieu for working them go');
    });
});

// The JSDoc called `ovByDate` optional and defaulted it to null; `isWorkingDate` then dereferenced
// it and threw on the first ordinary working day (whole-app check, 10 Nov 2026).
// ── WHAT AN ABSENCE RANGE LEAVES AS IT IS, FOR THE CARD TO NAME (review, Nov 2026) ────────────────
// A rest day holding Rest Day Working or leave that cost nothing is not written (al-swapped-days.js →
// absenceHiddenDates): an absence there never shows, and would hide what does. The projection hands
// those days to the card, so the preview and the receipt can name them, and counts only what is written.
describe('projectAbsenceRange — the days it leaves as they are', () => {
    const FRI = '2026-06-12';   // worked on fixed pattern 1; SAT above is its rest day
    const rdw = { id: 'f-rdw', memberName: fixedCea.name, date: SAT, type: 'rdw', value: '07:00-15:00', source: 'manual' };
    const run = (/** @type {any[]} */ rows) => projectAbsenceRange({ member: fixedCea, memberName: fixedCea.name, overrides: rows,
        ovByDate: new Map(rows.map(o => [o.date, o])), dates: [FRI, SAT] });

    test('a rest day\'s Rest Day Working is left alone, named, and not counted as an absence day', () => {
        const r = run([rdw]);
        assert.deepEqual(r.writing, [FRI]);
        assert.deepEqual(r.leftAlone, [SAT]);
    });

    test('free leave on it the same; a bare rest day is a rest day, not a day left alone', () => {
        assert.deepEqual(run([{ ...rdw, type: 'annual_leave', value: 'AL' }]).leftAlone, [SAT]);
        const bare = run([]);
        assert.deepEqual(bare.writing, [FRI]);
        assert.deepEqual(bare.leftAlone, [], 'nothing on the day to hide');
    });

    test('named even when nothing is written, so a range of only such days says why it records nothing', () => {
        const r = projectAbsenceRange({ member: fixedCea, memberName: fixedCea.name, overrides: [rdw], ovByDate: new Map([[SAT, rdw]]), dates: [SAT] });
        assert.deepEqual(r.writing, []);
        assert.deepEqual(r.leftAlone, [SAT]);
    });
});

describe('projectAlBooking — an omitted override map means "nothing in play"', () => {
    test('it does not throw, and answers exactly as an empty map does', () => {
        const omitted = projectAlBooking({ member: fixedCea, dates: [MON, SAT, SUN] });
        assert.deepEqual(omitted, projectAlBooking({ member: fixedCea, dates: [MON, SAT, SUN], ovByDate: new Map() }));
        assert.deepEqual(omitted.consuming, [MON]);
    });
});

// THE SUNDAY RULE BOTH RANGE CARDS WRITE BY (admin.md → "Sunday RD corrections"), stated once so the
// preview and the receipt can name the days the save changes (whole-app check, 10 Nov 2026).
describe('rangeSundayCorrections — the worked Sundays a range booking sets as rest days', () => {
    /** A member and a Sunday their BASE roster works, and one it rests — found, never written down. */
    const sundays = (() => {
        for (const m of teamMembers.filter(x => !x.hidden)) {
            let worked = null, rest = null;
            for (let i = 0; i < 400 && !(worked && rest); i++) {
                const d = new Date(2026, 5, 7 + i);
                if (d.getDay() !== 0) continue;
                const iso = formatISO(d);
                // The rule's own predicate: a Spare Sunday is not a rest day, so it is "worked" here.
                if (!isRestShift(getBaseShift(m, d))) worked ??= iso; else rest ??= iso;
            }
            if (worked && rest) return { m, worked, rest };
        }
        return null;
    })();

    test('premise: a member with a worked and a rested Sunday', () => {
        assert.ok(sundays, 'nobody on the roster works a Sunday — the cases below prove nothing');
    });

    test('a worked Sunday is set; a rested Sunday and every weekday are not', () => {
        const { m, worked, rest } = /** @type {any} */ (sundays);
        assert.deepEqual(rangeSundayCorrections({ dates: [worked, rest, MON], memberObj: m, ovByDate: NO_OV }), [worked]);
    });

    test('not over a day already at rest, nor over worked overtime it would erase', () => {
        const { m, worked } = /** @type {any} */ (sundays);
        const on = (/** @type {any} */ ov) => rangeSundayCorrections({ dates: [worked], memberObj: m, ovByDate: new Map([[worked, ov]]) });
        assert.deepEqual(on({ type: 'correction', value: 'RD' }), []);
        assert.deepEqual(on({ type: 'rdw', value: '08:00-16:00' }), []);
        assert.deepEqual(on({ type: 'shift', value: '08:00-16:00' }), []);
        // …but leave or an absence on a Sunday is masked, as it always was (v12.61).
        assert.deepEqual(on({ type: 'annual_leave', value: 'AL' }), [worked]);
    });

    test('no member, no dates — nothing to say', () => {
        assert.deepEqual(rangeSundayCorrections({ dates: [MON], memberObj: null }), []);
        assert.deepEqual(rangeSundayCorrections({ dates: /** @type {any} */ (null), memberObj: fixedCea }), []);
    });
});


// ── A SPARE WEEK COSTS AT MOST FOUR, ACROSS A WHOLE BOOKING (owner, 21 Nov 2026) ──────────────────
// Each new day is costed against the leave already SAVED, which cannot see the booking's other new
// days — so without the week pass a whole new Spare week previewed, warned and saved as six.
describe('booking a Spare week charges at most four days', () => {
    const M = { name: 'Spare Week Tester', rosterType: 'main', currentWeek: 1, role: 'CEA' };
    const WEEK = ['2027-03-08', '2027-03-09', '2027-03-10', '2027-03-11', '2027-03-12', '2027-03-13'];
    const al = (/** @type {string} */ date) => ({ id: `al-${date}`, memberName: M.name, date, type: 'annual_leave', value: 'AL' });

    test('a whole new Spare week: four charged, two written free', () => {
        const p = projectAlBooking({ member: M, dates: WEEK, ovByDate: new Map() });
        assert.deepEqual(p.consuming, WEEK.slice(0, 4));
        assert.deepEqual(p.freeWritten, WEEK.slice(4));
        assert.deepEqual(p.writing, WEEK, 'every day is still written — only the count changes');
    });

    test('days already saved in the week take their share of the four first', () => {
        const saved = new Map(WEEK.slice(0, 2).map(d => [d, al(d)]));
        const p = projectAlBooking({ member: M, dates: WEEK.slice(2), ovByDate: saved });
        assert.deepEqual(p.consuming, WEEK.slice(2, 4), 'two saved, so two more cost');
        assert.deepEqual(p.freeWritten, WEEK.slice(4));
    });

    test('the warning counts what the save will charge: a whole week is four days over an allowance of one', () => {
        // The member has used all but one day of 2027 elsewhere (invented working days in April).
        const ent = /** @type {number} */ (entitlementFor(M, 2027, []));
        const others = [];
        for (let d = new Date(2027, 3, 1); others.length < ent - 1; d.setDate(d.getDate() + 1)) {
            const iso = formatISO(d), base = getBaseShift(M, new Date(d));
            if (d.getDay() !== 0 && !isRestShift(base) && base !== 'SPARE' && !isBankHoliday(new Date(d))) others.push(al(iso));
        }
        const p = projectAlBooking({ member: M, dates: WEEK, ovByDate: new Map() });
        const o = projectAlOverage({ member: M, memberName: M.name, overrides: others, consuming: p.consuming });
        assert.equal(o?.over, 3, `four charged against one left — not six (${o?.detail})`);
    });

    /** Invented weekday leave in 2027 until `n` days are counted, never on a Spare, rest day or bank holiday. */
    const fillTo = (/** @type {any[]} */ ovs, /** @type {number} */ n) => {
        for (let d = new Date(2027, 4, 1); countedAlDates({ overrides: ovs, member: M, year: 2027 }).size < n; d.setDate(d.getDate() + 1)) {
            const base = getBaseShift(M, new Date(d));
            if (d.getDay() !== 0 && !isRestShift(base) && base !== 'SPARE' && !isBankHoliday(new Date(d))) ovs.push(al(formatISO(d)));
        }
        return ovs;
    };

    test('a Spare week over New Year: the December days take the four, and January\'s cost nothing', () => {
        const NY = ['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02'];
        let member = null;
        for (let w = 1; w <= 20 && !member; w++) {
            const m = { ...M, currentWeek: w };
            if (NY.every(d => getBaseShift(m, new Date(`${d}T12:00:00`)) === 'SPARE')) member = m;
        }
        assert.ok(member, 'premise: some week of the cycle is Spare over New Year 2026/27');
        const saved = NY.map(d => ({ ...al(d), memberName: member.name }));
        assert.equal(countedAlDates({ overrides: saved, member, year: 2026 }).size, 4);
        assert.equal(countedAlDates({ overrides: saved, member, year: 2027 }).size, 0,
            'January\'s two are the week\'s fifth and sixth, even though the year counted alone has only them');
        const p = projectAlBooking({ member, dates: NY, ovByDate: new Map() });
        assert.deepEqual(p.freeWritten, NY.slice(4));
    });

    test('leave over an absence: the absent day is still a Spare day, so the week costs four, not five', () => {
        const absent = { id: 's1', memberName: M.name, date: WEEK[0], type: 'sick', value: 'SICK' };
        const p = projectAlBooking({ member: M, dates: WEEK, ovByDate: new Map([[WEEK[0], absent]]) });
        assert.equal(p.consuming.length, 4);
        assert.equal(p.charged, 4);
    });

    test('booking the rest of a week whose end is already saved: charged 2, and no false warning at the allowance', () => {
        const ovs = fillTo([al(WEEK[4]), al(WEEK[5])], 30);
        const p = projectAlBooking({ member: M, dates: WEEK, ovByDate: new Map(ovs.map(o => [o.date, o])) });
        assert.equal(p.charged, 2, 'four after, two before — the saved Friday and Saturday become the free ones');
        const after = overridesAfterSave(ovs, { memberName: M.name, writes: p.writes });
        assert.equal(countedAlDates({ overrides: after, member: M, year: 2027 }).size, 32);
        assert.equal(projectAlOverage({ member: M, memberName: M.name, overrides: ovs, consuming: p.consuming, after }), null,
            'exactly at the allowance, so nothing over it');
    });

    test('the week grid re-saving one day of a full Spare week at the allowance warns of nothing', () => {
        const ovs = fillTo(WEEK.map(al), 32);
        const plan = planAlWeekSave({ member: M, memberName: M.name, overrides: ovs, ovByDate: new Map(ovs.map(o => [o.date, o])),
            toSave: [{ memberName: M.name, date: WEEK[0], type: 'annual_leave', value: 'AL', existingId: `al-${WEEK[0]}` }] });
        assert.equal(plan.overage, null);
    });

    // THE BALANCE IS THE WHOLE WEEK, NOT THE DAYS BOOKED (review, 22 Nov 2026). Booking the Monday of a
    // week whose Wednesday to Saturday are saved charges the Monday and frees the Saturday: `consuming`
    // says Monday and `charged` says nothing moved. Without the pass over the rest of the week the
    // booking touches (`touched`), `charged` read the Monday alone and said 1.
    test('one day of a week whose other four are saved: charged nothing, and the day is said free on balance', () => {
        const saved = new Map(WEEK.slice(2).map(d => [d, al(d)]));
        const p = projectAlBooking({ member: M, dates: [WEEK[0]], ovByDate: saved });
        assert.deepEqual(p.consuming, [WEEK[0]], 'premise: the Monday is the week\'s first, so it is one of the four');
        assert.deepEqual(p.alreadyBooked, [], 'a new day, not one already booked');
        assert.equal(p.charged, 0, 'the Saturday stops costing, so the balance does not move');
        assert.equal(p.capFreed, 1, 'and the preview, the Spare line and the receipt say the Monday is at no cost');
        // The balance agrees: four counted before the save, four after.
        const ovs = [...saved.values()];
        const after = overridesAfterSave(ovs, { memberName: M.name, writes: p.writes });
        assert.equal(countedAlDates({ overrides: after, member: M, year: 2027 }).size,
            countedAlDates({ overrides: ovs, member: M, year: 2027 }).size + p.charged);
    });

    test('a booking that charges every new day frees nothing', () => {
        assert.equal(projectAlBooking({ member: M, dates: WEEK, ovByDate: new Map() }).capFreed, 0);
        const saved = new Map(WEEK.slice(0, 2).map(d => [d, al(d)]));
        assert.equal(projectAlBooking({ member: M, dates: WEEK.slice(2), ovByDate: saved }).capFreed, 0);
    });

    test('a Spare week a roster upload partly assigned still charges four for the whole week (owner, 22 Nov 2026)', () => {
        // The Friday and Saturday the upload gave named shifts — past the four, so they are the days the
        // old rule charged as shifts, a week of six. Leave over them records `replacedType: 'shift'`.
        const assigned = new Map(WEEK.slice(4).map(d => [d, { id: `s-${d}`, memberName: M.name, date: d, type: 'shift', value: '06:00-14:00', source: 'roster_import' }]));
        const p = projectAlBooking({ member: M, dates: WEEK, ovByDate: assigned });
        assert.deepEqual([p.consuming, p.freeWritten, p.charged], [WEEK.slice(0, 4), WEEK.slice(4), 4]);
    });

    // A SPARE WEEK OVER NEW YEAR SPENDS ITS FOUR ACROSS TWO ALLOWANCES (external review of v26.55). The four go in
    // date order, so a change to a December day moves a charge onto a January one, or back. Both directions were
    // silent: a removal made 2027's count rise with no warning, and a booking that moved a day from 2027 to 2026
    // was said to be "at no cost".
    const NY = ['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02'];
    const nyMember = () => {
        for (let w = 1; w <= 20; w++) {
            const m = { ...M, currentWeek: w };
            if (NY.every(d => getBaseShift(m, new Date(`${d}T12:00:00`)) === 'SPARE')) return m;
        }
        assert.fail('premise: some week of the cycle is Spare over New Year 2026/27');
    };
    /** 2027 leave elsewhere until the year counts `n`, for `member` (fillTo, but for any member). */
    const fill2027 = (/** @type {any} */ member, /** @type {any[]} */ ovs, /** @type {number} */ n) => {
        for (let d = new Date(2027, 4, 1); countedAlDates({ overrides: ovs, member, year: 2027 }).size < n; d.setDate(d.getDate() + 1)) {
            const base = getBaseShift(member, new Date(d));
            if (d.getDay() !== 0 && !isRestShift(base) && base !== 'SPARE' && !isBankHoliday(new Date(d)))
                ovs.push({ ...al(formatISO(d)), memberName: member.name });
        }
        return ovs;
    };

    test('removing a December day of a New Year Spare week warns when January\'s allowance goes over', () => {
        const member = nyMember();
        const nyAl = (/** @type {string} */ d) => ({ ...al(d), memberName: member.name });
        const ovs = NY.map(nyAl);
        const ent = /** @type {number} */ (entitlementFor(member, 2027, ovs));
        fill2027(member, ovs, ent);
        assert.equal(countedAlDates({ overrides: ovs, member, year: 2027 }).size, ent, 'premise: 2027 is exactly at its allowance');
        const ovByDate = new Map(ovs.map(o => [o.date, o]));
        // The Monday deleted outright, and the Monday turned into a shift: either way 1 January becomes the week's fourth.
        for (const [how, args] of /** @type {Array<[string, any]>} */ ([
            ['deleted', { toSave: [], toDelete: [`al-${NY[0]}`] }],
            ['turned into a shift', { toSave: [{ memberName: member.name, date: NY[0], type: 'shift', value: '06:00-14:00', existingId: `al-${NY[0]}` }] }],
        ])) {
            const plan = planAlWeekSave({ member, memberName: member.name, overrides: ovs, ovByDate, ...args });
            assert.ok(plan.overage, `${how}: 2027 goes to ${ent + 1} of ${ent}, and the save must say so`);
            assert.equal(plan.overage.over, 1, how);
            assert.match(plan.overage.headline + plan.overage.detail, /2027/, how);
        }
    });

    test('a New Year Spare week change that leaves every year within its allowance warns of nothing', () => {
        const member = nyMember();
        const nyAl = (/** @type {string} */ d) => ({ ...al(d), memberName: member.name });
        const ovs = NY.map(nyAl);
        const ovByDate = new Map(ovs.map(o => [o.date, o]));
        const plan = planAlWeekSave({ member, memberName: member.name, overrides: ovs, ovByDate, toSave: [], toDelete: [`al-${NY[0]}`] });
        assert.equal(plan.overage, null, '2027 rises to 1, nowhere near its allowance');
    });

    test('booking a December day that moves a charge out of January is said per year, not "at no cost"', () => {
        const member = nyMember();
        const saved = new Map(NY.slice(2).map(d => [d, { ...al(d), memberName: member.name }]));
        assert.equal(countedAlDates({ overrides: [...saved.values()], member, year: 2026 }).size, 2, 'premise: 2 from 2026');
        assert.equal(countedAlDates({ overrides: [...saved.values()], member, year: 2027 }).size, 2, 'premise: 2 from 2027');
        const p = projectAlBooking({ member, dates: [NY[0]], ovByDate: saved });
        assert.equal(p.charged, 0, 'the combined total does not move');
        assert.equal(p.capFreed, 0, 'but 2026 has one day less, so the Monday is not free');
        assert.deepEqual(p.byYear, [{ year: 2026, charged: 1 }, { year: 2027, charged: -1 }]);
        assert.equal(p.spent, 1);
        assert.equal(yearShiftWords(p.byYear), '1 day from 2026, 1 day back to 2027');
        // The allowances agree with what is said.
        const ovs = [...saved.values()];
        const after = overridesAfterSave(ovs, { memberName: member.name, writes: p.writes });
        assert.equal(countedAlDates({ overrides: after, member, year: 2026 }).size, 3);
        assert.equal(countedAlDates({ overrides: after, member, year: 2027 }).size, 1);
    });

    test('a week inside one year still says the freed day is at no cost, with nothing per year to add', () => {
        const saved = new Map(WEEK.slice(2).map(d => [d, al(d)]));
        const p = projectAlBooking({ member: M, dates: [WEEK[0]], ovByDate: saved });
        assert.equal(p.capFreed, 1);
        assert.equal(p.spent, 0);
        assert.equal(yearShiftWords(p.byYear), '', 'one year, so the headline\'s figure is the whole story');
    });

    test('a Dispatcher\'s Spare days are not capped: each costs one (owner, 21 Nov 2026)', () => {
        let disp = null;
        for (let w = 1; w <= 10 && !disp; w++) {
            const m = { name: 'Dispatch Tester', rosterType: 'dispatcher', currentWeek: w, role: 'Dispatcher' };
            if (WEEK.filter(d => getBaseShift(m, new Date(`${d}T12:00:00`)) === 'SPARE').length > 4) disp = m;
        }
        assert.ok(disp, 'premise: a Dispatcher week with more than four Spare days');
        const spare = WEEK.filter(d => getBaseShift(disp, new Date(`${d}T12:00:00`)) === 'SPARE');
        const p = projectAlBooking({ member: disp, dates: spare, ovByDate: new Map() });
        assert.deepEqual(p.consuming, spare);
        assert.deepEqual(p.freeWritten, []);
    });
});
