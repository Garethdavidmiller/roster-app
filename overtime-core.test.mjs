/**
 * overtime-core.test.mjs — the rules behind Overtime Availability.
 * Run with: node --test overtime-core.test.mjs   (no mocks; part of test:hygiene)
 *
 * WHY THIS RUNS IN test:hygiene RATHER THAN test:functions, despite living under functions/:
 * `overtime-core.js` requires nothing at all, so it loads without functions/node_modules — and the
 * deadline arithmetic is too load-bearing to run only in the Functions deploy workflow. A branch
 * that never touches functions/ can still break the London clock by editing this module, and
 * test:hygiene is the suite that runs on every branch and gates the Hosting deploy.
 *
 * ORGANISED BY THE FAILURE, NOT BY THE FUNCTION. Each block names a way this feature can be wrong
 * in a way nobody would notice:
 *   · a deadline an hour out            → someone in time is refused, or someone late is accepted
 *   · a recomputed historical milestone → last year's window silently acquires this year's policy
 *   · a participant list that moves     → a colleague becomes a non-responder for a week they were
 *                                         never asked about
 *   · an invented answer                → "no response" quietly becomes "not available"
 *   · a silent overwrite                → somebody's declaration disappears and they never know
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const C = require('./functions/overtime-core.js');

/** The wall-clock reading a person in London would see at this instant. */
function londonWallClock(ms) {
    return new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/London', dateStyle: 'short', timeStyle: 'short', hourCycle: 'h23',
    }).format(new Date(ms));
}

// Every date below is real and was checked against the calendar before being written down.
const WEEK_SEP  = '2026-09-05';   // high summer — both deadlines in BST
const WEEK_JAN  = '2027-01-09';   // deep winter — both deadlines in GMT
const WEEK_APR  = '2026-04-11';   // STRADDLES the spring forward (29 Mar 2026)
const WEEK_NOV  = '2026-11-07';   // STRADDLES the autumn back    (25 Oct 2026)

describe('the London clock — an hour wrong is the whole feature wrong', () => {
    test('a deadline is 12:00 as a person in London reads it, in both halves of the year', () => {
        // The property that matters operationally: staff are told "Tuesday 12:00". Asserting the
        // wall clock rather than an epoch number is what makes this test about the requirement.
        assert.equal(londonWallClock(C.deriveMilestones(WEEK_SEP).initialDeadlineAt), '18/08/2026, 12:00');
        assert.equal(londonWallClock(C.deriveMilestones(WEEK_JAN).initialDeadlineAt), '22/12/2026, 12:00');
    });

    test('and it is a DIFFERENT instant in BST than in GMT', () => {
        // The wall-clock assertion above passes even for a build that ignores timezones entirely,
        // because a naive UTC implementation also reads "12:00" when formatted back in winter.
        // Pinning the absolute instant is what catches it: summer noon is 11:00Z, winter is 12:00Z.
        assert.equal(new Date(C.deriveMilestones(WEEK_SEP).initialDeadlineAt).toISOString(), '2026-08-18T11:00:00.000Z');
        assert.equal(new Date(C.deriveMilestones(WEEK_JAN).initialDeadlineAt).toISOString(), '2026-12-22T12:00:00.000Z');
    });

    test('ONE window can have its two deadlines on opposite sides of a DST change', () => {
        // Spring 2026: the clocks go forward on 29 March, which falls BETWEEN this window's initial
        // (24 Mar) and final (31 Mar) deadlines. A per-window offset computed once and reused for
        // both — the obvious optimisation — puts one of them an hour out.
        const apr = C.deriveMilestones(WEEK_APR);
        assert.equal(new Date(apr.initialDeadlineAt).toISOString(), '2026-03-24T12:00:00.000Z', 'GMT side');
        assert.equal(new Date(apr.finalDeadlineAt).toISOString(),   '2026-03-31T11:00:00.000Z', 'BST side');
        assert.equal(londonWallClock(apr.initialDeadlineAt), '24/03/2026, 12:00');
        assert.equal(londonWallClock(apr.finalDeadlineAt),   '31/03/2026, 12:00');
    });

    test('and the same in the other direction, across the autumn change', () => {
        const nov = C.deriveMilestones(WEEK_NOV);
        assert.equal(new Date(nov.initialDeadlineAt).toISOString(), '2026-10-20T11:00:00.000Z', 'BST side');
        assert.equal(new Date(nov.finalDeadlineAt).toISOString(),   '2026-10-27T12:00:00.000Z', 'GMT side');
    });

    test('the offset helper reports the real GMT/BST values, not a guess', () => {
        assert.equal(C.londonOffsetMinutes(Date.UTC(2026, 0, 15, 12)), 0,  'January is GMT');
        assert.equal(C.londonOffsetMinutes(Date.UTC(2026, 6, 15, 12)), 60, 'July is BST');
    });

    test('noon on the transition SUNDAYS themselves resolves cleanly', () => {
        // The UK moves at 01:00/02:00, so noon is never in a gap or an ambiguous repeated hour —
        // but that is a property of this policy, not of the code, and it is worth pinning.
        assert.equal(new Date(C.londonNoonTimestamp('2026-03-29')).toISOString(), '2026-03-29T11:00:00.000Z');
        assert.equal(new Date(C.londonNoonTimestamp('2026-10-25')).toISOString(), '2026-10-25T12:00:00.000Z');
    });

    test('the two-pass solve is load-bearing at the hours it is NOT yet used with', () => {
        // Honest note, because it changes what this test is for: for 00:00 and 12:00 — the only two
        // hours production uses — a SINGLE pass is already correct everywhere, transition days
        // included. Mutation-testing proved it: deleting the second pass leaves every other clock
        // assertion in this file green.
        //
        // So the guard is here for the next hour somebody adds. 01:00 on spring-forward does not
        // exist (clocks jump 01:00→02:00), and it is the one input where the two solves disagree:
        // one pass lands at 00:00Z — an hour EARLIER than asked for, in the previous local hour —
        // while two passes resolve forward to 02:00 BST, which is what a reader expects. Pinning it
        // is what stops a future deadline time from shipping quietly an hour out.
        assert.equal(new Date(C.londonTimestamp('2026-03-29', 1)).toISOString(), '2026-03-29T01:00:00.000Z');
        assert.equal(londonWallClock(C.londonTimestamp('2026-03-29', 1)), '29/03/2026, 02:00',
            'a gap time resolves FORWARD, not backwards into the previous day');
        // The autumn overlap (01:00 happens twice) resolves to the second, GMT occurrence.
        assert.equal(new Date(C.londonTimestamp('2026-10-25', 1)).toISOString(), '2026-10-25T01:00:00.000Z');
    });

    test('midnight — the retention boundary — is also correct in both halves', () => {
        assert.equal(new Date(C.londonMidnightTimestamp('2026-12-05')).toISOString(), '2026-12-05T00:00:00.000Z');
        assert.equal(new Date(C.londonMidnightTimestamp('2026-07-10')).toISOString(), '2026-07-09T23:00:00.000Z');
    });

    test('londonIsoDate names the LONDON day, not the UTC one', () => {
        // 23:30Z on 4 July is already 5 July in London. The planning horizon starts from "today",
        // so getting this wrong shifts every Manager row by a week for half an hour each night.
        assert.equal(C.londonIsoDate(Date.parse('2026-07-04T23:30:00Z')), '2026-07-05');
        assert.equal(C.londonIsoDate(Date.parse('2026-01-04T23:30:00Z')), '2026-01-04');
    });
});

describe('the frozen timetable', () => {
    test('every milestone lands on the weekday the roster process expects', () => {
        const m = C.deriveMilestones(WEEK_SEP);
        assert.equal(C.isoDayOfWeek(m.weekStart), 0, 'week starts Sunday');
        assert.equal(C.isoDayOfWeek(m.draftRosterDate), 4, 'draft roster Thursday');
        assert.equal(C.isoDayOfWeek(m.finalRosterDate), 4, 'final roster Thursday');
        assert.equal(C.isoDayOfWeek(C.londonIsoDate(m.initialDeadlineAt)), 2, 'initial deadline Tuesday');
        assert.equal(C.isoDayOfWeek(C.londonIsoDate(m.finalDeadlineAt)), 2, 'final deadline Tuesday');
    });

    test('the worked example from the specification, exactly', () => {
        const m = C.deriveMilestones('2026-09-05');
        assert.equal(m.weekStart, '2026-08-30');
        assert.equal(C.londonIsoDate(m.initialDeadlineAt), '2026-08-18');
        assert.equal(m.draftRosterDate, '2026-08-20');
        assert.equal(C.londonIsoDate(m.finalDeadlineAt), '2026-08-25');
        assert.equal(m.finalRosterDate, '2026-08-27');
    });

    test('retention is 13 whole weeks, so it lands on a Saturday too', () => {
        const m = C.deriveMilestones(WEEK_SEP);
        assert.equal(C.londonIsoDate(m.retentionUntil), '2026-12-05');
        assert.equal(C.isoDayOfWeek('2026-12-05'), 6);
    });

    test('a stamped policyVersion travels with the stored dates', () => {
        // The pair is what makes an old window readable: the dates say what happened, the version
        // says which rules produced them. Storing dates without the version would leave a future
        // reader unable to tell a policy change from a bug.
        assert.equal(C.deriveMilestones(WEEK_SEP).policyVersion, C.POLICY_VERSION);
    });

    test('week arithmetic survives month, year and leap boundaries', () => {
        assert.equal(C.addDays('2026-12-30', 7), '2027-01-06');
        assert.equal(C.addDays('2028-02-28', 1), '2028-02-29', 'leap year');
        assert.equal(C.addDays('2027-02-28', 1), '2027-03-01', 'non-leap');
        assert.equal(C.deriveMilestones('2027-01-02').weekStart, '2026-12-27', 'week spans the new year');
    });

    test('the seven week dates are Sunday to Saturday and contiguous', () => {
        const d = C.weekDates('2026-08-30');
        assert.equal(d.length, 7);
        assert.equal(d[0], '2026-08-30');
        assert.equal(d[6], '2026-09-05');
        assert.deepEqual(d.map(C.isoDayOfWeek), [0, 1, 2, 3, 4, 5, 6]);
    });
});

describe('phase boundaries — where "in time" is decided', () => {
    const m = C.deriveMilestones(WEEK_SEP);

    test('the three phases tile time with no gap and no overlap', () => {
        assert.equal(C.phaseFor(m, m.initialDeadlineAt - 1), 'INITIAL_OPEN');
        assert.equal(C.phaseFor(m, m.initialDeadlineAt),     'FINAL_OPEN', 'exactly 12:00 is the LATER phase');
        assert.equal(C.phaseFor(m, m.finalDeadlineAt - 1),   'FINAL_OPEN');
        assert.equal(C.phaseFor(m, m.finalDeadlineAt),       'CLOSED',     'exactly 12:00 is the LATER phase');
        assert.equal(C.phaseFor(m, m.finalDeadlineAt + 1),   'CLOSED');
    });

    test('one millisecond decides it, in both directions', () => {
        // Not pedantry: staff submit at 11:59 on the Tuesday, and the difference between accepted
        // and refused has to be a fact rather than a rounding.
        assert.notEqual(C.phaseFor(m, m.initialDeadlineAt - 1), C.phaseFor(m, m.initialDeadlineAt));
        assert.notEqual(C.phaseFor(m, m.finalDeadlineAt - 1),   C.phaseFor(m, m.finalDeadlineAt));
    });

    test('both open phases accept writes; closed does not', () => {
        assert.equal(C.isOpenPhase('INITIAL_OPEN'), true);
        assert.equal(C.isOpenPhase('FINAL_OPEN'),   true, 'a first submission is still allowed after the initial deadline');
        assert.equal(C.isOpenPhase('CLOSED'),       false);
    });
});

describe('window creation validation', () => {
    const ctx = { nowMs: Date.parse('2026-08-01T09:00:00Z'), maxRosterYear: 2030 };

    test('accepts a real upcoming Saturday', () => {
        assert.deepEqual(C.validateWeekEnding('2026-09-05', ctx), { ok: true });
    });

    test('rejects a non-Saturday', () => {
        assert.equal(C.validateWeekEnding('2026-09-04', ctx).error, 'not-saturday');
    });

    test('rejects a date that does not exist, rather than rolling it into the next month', () => {
        // '2026-02-30' parses happily through Date and becomes 2 March. Without the round-trip
        // check, a window would be created for a week nobody asked for.
        assert.equal(C.validateWeekEnding('2026-02-30', ctx).error, 'invalid-date');
        assert.equal(C.validateWeekEnding('2026-13-05', ctx).error, 'invalid-date');
        assert.equal(C.validateWeekEnding('not-a-date', ctx).error, 'invalid-date');
    });

    test('rejects a week whose final deadline has already gone', () => {
        // Creating one would produce a form nobody could ever submit to — an empty week that reads
        // as apathy rather than as the mistake it is.
        const late = { nowMs: Date.parse('2026-08-26T09:00:00Z'), maxRosterYear: 2030 };
        assert.equal(C.validateWeekEnding('2026-09-05', late).error, 'final-deadline-passed');
    });

    test('a week whose INITIAL deadline has passed is still creatable', () => {
        const between = { nowMs: Date.parse('2026-08-19T09:00:00Z'), maxRosterYear: 2030 };
        assert.deepEqual(C.validateWeekEnding('2026-09-05', between), { ok: true });
    });

    test('rejects beyond the roster horizon, using the horizon it is GIVEN', () => {
        // The ceiling arrives from the generated server config, never a literal in the Functions
        // code — otherwise the next MAX_YEAR bump moves the client and leaves the server behind.
        assert.equal(C.validateWeekEnding('2031-01-04', ctx).error, 'beyond-horizon');
        assert.deepEqual(C.validateWeekEnding('2031-01-04', { ...ctx, maxRosterYear: 2032 }), { ok: true });
    });
});

describe('the missing window — the failure nothing else catches', () => {
    test('six rows appear whether or not any window exists', () => {
        const weeks = C.planningWeekEndings(Date.parse('2026-08-19T09:00:00Z'));
        assert.equal(weeks.length, C.PLANNING_WEEKS);
        assert.ok(weeks.every(C.isSaturday), 'every planning row is a week-ending Saturday');
    });

    test('the horizon starts with THIS week, and each row is seven days on', () => {
        // Wed 19 Aug 2026 → this Sunday–Saturday week ends Sat 22 Aug.
        const weeks = C.planningWeekEndings(Date.parse('2026-08-19T09:00:00Z'));
        assert.equal(weeks[0], '2026-08-22');
        assert.deepEqual(weeks, ['2026-08-22', '2026-08-29', '2026-09-05', '2026-09-12', '2026-09-19', '2026-09-26']);
    });

    test('on a Saturday, THAT Saturday is still the current week', () => {
        assert.equal(C.planningWeekEndings(Date.parse('2026-08-22T09:00:00Z'))[0], '2026-08-22');
    });

    test('on the Sunday after, the horizon has moved on by exactly one week', () => {
        assert.equal(C.planningWeekEndings(Date.parse('2026-08-23T09:00:00Z'))[0], '2026-08-29');
    });

    test('a row escalates as its deadlines pass, and a missed week does NOT disappear', () => {
        // The escalation is the whole point of the horizon. If a missed week silently dropped off
        // at its final deadline, the omission would erase its own evidence.
        const m = C.deriveMilestones(WEEK_SEP);
        assert.equal(C.windowRowState(m, m.initialDeadlineAt - 1, false), 'not-created');
        assert.equal(C.windowRowState(m, m.initialDeadlineAt,     false), 'not-created-initial-passed');
        assert.equal(C.windowRowState(m, m.finalDeadlineAt,       false), 'missed');
        assert.equal(C.windowRowState(m, m.finalDeadlineAt + 9e8, false), 'missed', 'still visible days later');
    });

    test('an existing window reads as created at every point in its life', () => {
        const m = C.deriveMilestones(WEEK_SEP);
        for (const t of [m.initialDeadlineAt - 1, m.initialDeadlineAt, m.finalDeadlineAt, m.finalDeadlineAt + 9e8]) {
            assert.equal(C.windowRowState(m, t, true), 'created');
        }
    });
});

describe('who was asked — the frozen population', () => {
    const ELIGIBLE = [
        { name: 'A. One',   grade: 'CEA', startDate: null,         rosterOrder: 3 },
        { name: 'B. Two',   grade: 'CES', startDate: null,         rosterOrder: 1 },
        { name: 'C. Three', grade: 'CEA', startDate: '2026-09-02', rosterOrder: 2 },  // mid-week starter
        { name: 'D. Four',  grade: 'CEA', startDate: '2026-08-30', rosterOrder: 0 },  // starts ON the Sunday
    ];

    test('a mid-week starter is excluded from that week and included in the next', () => {
        // A deliberate PRODUCT rule, not an implementation shortcut: every participant answers all
        // seven days, and asking somebody to declare availability for days before they were
        // employed is incoherent. The alternative — a four-day part week — leaks into the schema,
        // the counts and the reminders everywhere.
        const thisWeek = C.selectParticipants(ELIGIBLE, { weekStart: '2026-08-30', audience: 'all' });
        assert.equal(thisWeek.some(p => p.memberName === 'C. Three'), false);
        const nextWeek = C.selectParticipants(ELIGIBLE, { weekStart: '2026-09-06', audience: 'all' });
        assert.equal(nextWeek.some(p => p.memberName === 'C. Three'), true);
    });

    test('somebody starting ON the week-start Sunday IS included', () => {
        // The boundary is inclusive: their first day is the first day of the week being asked about.
        const p = C.selectParticipants(ELIGIBLE, { weekStart: '2026-08-30', audience: 'all' });
        assert.equal(p.some(x => x.memberName === 'D. Four'), true);
    });

    test('the restricted audience narrows to the server-owned admin entitlement', () => {
        const p = C.selectParticipants(ELIGIBLE,
            { weekStart: '2026-08-30', audience: 'restricted', adminNames: ['A. One'] });
        assert.deepEqual(p.map(x => x.memberName), ['A. One']);
    });

    test('restricted with no admin entitlement supplied yields nobody, not everybody', () => {
        // Fail CLOSED. A missing config must not silently create an all-staff window while the
        // page is still hidden from staff — the one rollout mistake that cannot be undone quietly.
        assert.deepEqual(C.selectParticipants(ELIGIBLE, { weekStart: '2026-08-30', audience: 'restricted' }), []);
    });

    test('participants come out in roster order, so a Manager list stays familiar', () => {
        const p = C.selectParticipants(ELIGIBLE, { weekStart: '2026-09-06', audience: 'all' });
        assert.deepEqual(p.map(x => x.rosterOrder), [0, 1, 2, 3]);
    });

    test('the batch bound is below the Firestore limit, with the parent write accounted for', () => {
        // Creation is 1 parent + N participants in ONE batch, because a partly-created window has a
        // frozen population that is a lie.
        assert.ok(C.MAX_PARTICIPANTS_PER_WINDOW + 1 <= 500);
    });

    test('a nameless or malformed entry is dropped rather than becoming a blank participant', () => {
        const junk = [{ grade: 'CEA' }, { name: '', grade: 'CEA' }, null];
        assert.deepEqual(C.selectParticipants(junk, { weekStart: '2026-08-30', audience: 'all' }), []);
    });
});

describe('generated names must be safe as Firestore document ids', () => {
    test('the real roster passes', () => {
        const { overtimeEligibleMembers } = require('./functions/roster-members.json');
        assert.ok(overtimeEligibleMembers.length > 0, 'the generated list must not be empty');
        for (const m of overtimeEligibleMembers) {
            assert.ok(C.isSafeDocId(m.name), `"${m.name}" cannot be a Firestore path segment`);
        }
    });

    test('and the shapes a future starter could break it with do not', () => {
        // Applied to GENERATED data in CI, so an unusual name fails the build rather than corrupting
        // a write path in production.
        assert.equal(C.isSafeDocId(''), false);
        assert.equal(C.isSafeDocId('A/B'), false);
        assert.equal(C.isSafeDocId('.'), false);
        assert.equal(C.isSafeDocId('..'), false);
        assert.equal(C.isSafeDocId('__proto__'), false);
        assert.equal(C.isSafeDocId('x'.repeat(1501)), false);
        assert.equal(C.isSafeDocId("O'Néill-Smith"), true, 'ordinary punctuation and accents are fine');
    });

    test('every generated member carries the fields the snapshot needs', () => {
        const { overtimeEligibleMembers } = require('./functions/roster-members.json');
        for (const m of overtimeEligibleMembers) {
            assert.equal(typeof m.grade, 'string');
            assert.ok(Number.isInteger(m.rosterOrder));
            assert.ok(m.startDate === null || C.isValidIsoDate(m.startDate), `bad startDate for ${m.name}`);
        }
    });

    test('the generated list is roster PARTICIPATION, not "has an account"', () => {
        // activeMembers contains every manager-only account by design. Deriving participants from it
        // would put H. Croft in the expected population and report him as a non-responder forever.
        const { overtimeEligibleMembers, activeMembers, roles } = require('./functions/roster-members.json');
        const eligible = new Set(overtimeEligibleMembers.map(m => m.name));
        for (const manager of roles.manager) {
            assert.equal(eligible.has(manager), false, `${manager} is a reviewer, never a participant`);
            assert.ok(activeMembers.includes(manager), 'and is still an active ACCOUNT — the two lists differ on purpose');
        }
    });
});

describe('the availability schema — never invent an answer', () => {
    const DATES = C.weekDates('2026-08-30');
    const week = (fill) => Object.fromEntries(DATES.map(d => [d, fill]));

    test('all six modes round-trip unchanged', () => {
        const modes = [
            { mode: 'unavailable' },
            { mode: 'all_day' },
            { mode: 'before', until: '07:00' },
            { mode: 'after', from: '15:00' },
            { mode: 'before_after', until: '07:00', from: '15:00' },
            { mode: 'custom', start: '18:00', end: '23:00', nextDay: false },
        ];
        for (const m of modes) {
            const r = C.normaliseDays(week(m), DATES);
            assert.equal(r.ok, true, `${m.mode} should be valid`);
            assert.deepEqual(r.days[DATES[0]], m, `${m.mode} must survive verbatim`);
            // …and a second pass must be a fixed point, or a saved form would drift each time it is
            // read and re-submitted — the round-trip asymmetry class of defect.
            assert.deepEqual(C.normaliseDays(r.days, DATES).days, r.days);
        }
    });

    test('overnight custom is accepted and its nextDay flag is DERIVED, not trusted', () => {
        const ok = C.normaliseDays(week({ mode: 'custom', start: '22:00', end: '02:00', nextDay: true }), DATES);
        assert.equal(ok.ok, true);
        // A client claiming 18:00–23:00 is overnight would store a 29-hour availability window.
        const lying = C.normaliseDays(week({ mode: 'custom', start: '18:00', end: '23:00', nextDay: true }), DATES);
        assert.equal(lying.error, 'next-day-mismatch');
        const alsoLying = C.normaliseDays(week({ mode: 'custom', start: '22:00', end: '02:00', nextDay: false }), DATES);
        assert.equal(alsoLying.error, 'next-day-mismatch');
    });

    test('a zero-length custom period is refused', () => {
        assert.equal(C.normaliseDays(week({ mode: 'custom', start: '08:00', end: '08:00', nextDay: false }), DATES).error,
            'custom-zero-length');
    });

    test('a transposed before_after pair is refused rather than stored as nonsense', () => {
        // "before 15:00 and after 07:00" covers the day twice; it is a swapped pair, not an answer.
        assert.equal(C.normaliseDays(week({ mode: 'before_after', until: '15:00', from: '07:00' }), DATES).error,
            'before-after-inverted');
        assert.equal(C.normaliseDays(week({ mode: 'before_after', until: '07:00', from: '07:00' }), DATES).ok, true,
            'touching boundaries are allowed — the member simply has no gap');
    });

    test('both boundaries of before_after are mandatory', () => {
        assert.equal(C.normaliseDays(week({ mode: 'before_after', until: '07:00' }), DATES).error, 'bad-time');
        assert.equal(C.normaliseDays(week({ mode: 'before_after', from: '15:00' }), DATES).error, 'bad-time');
    });

    test('a partial week is REFUSED, never completed', () => {
        // The invariant this protects: no response is unknown, never "not available". Filling the
        // gaps here would put words in somebody's mouth about their own life.
        const partial = { ...week({ mode: 'all_day' }) };
        delete partial[DATES[3]];
        assert.equal(C.normaliseDays(partial, DATES).error, 'wrong-day-count');
    });

    test('a week with the right COUNT but a wrong date is refused', () => {
        // The count check alone would pass a week silently shifted by one day — the days would all
        // be answered and every one of them would belong to a different roster week.
        const shifted = Object.fromEntries(C.weekDates('2026-08-31').map(d => [d, { mode: 'all_day' }]));
        const r = C.normaliseDays(shifted, DATES);
        assert.equal(r.error, 'missing-day');
        assert.equal(r.date, DATES[0]);
    });

    test('unknown fields and unknown modes are rejected, not quietly dropped', () => {
        // Dropping would store an answer the member did not give, from a client this server does
        // not understand.
        assert.equal(C.normaliseDays(week({ mode: 'all_day', reason: 'childcare' }), DATES).error, 'unknown-field');
        assert.equal(C.normaliseDays(week({ mode: 'maybe' }), DATES).error, 'bad-mode');
        assert.equal(C.normaliseDays(week({ mode: 'after', from: '15:00', until: '07:00' }), DATES).error, 'unknown-field');
    });

    test('malformed and out-of-range times are rejected', () => {
        for (const bad of ['7:00', '07:0', '24:00', '23:60', '0700', '', null, 700]) {
            assert.equal(C.normaliseDays(week({ mode: 'after', from: bad }), DATES).error, 'bad-time', `${bad}`);
        }
    });

    test('a non-object week, or a day that is not an object, is refused', () => {
        assert.equal(C.normaliseDays(null, DATES).error, 'days-not-object');
        assert.equal(C.normaliseDays([], DATES).error, 'days-not-object');
        assert.equal(C.normaliseDays(week('all_day'), DATES).error, 'day-not-object');
        assert.equal(C.normaliseDays(week(['all_day']), DATES).error, 'day-not-object');
    });

    test('output key order is the week order regardless of input order', () => {
        // Canonical ordering is what lets daysEqual be a stable stringify rather than a deep walk —
        // and what stops a reordered client payload counting as a genuine amendment.
        const reversed = Object.fromEntries([...DATES].reverse().map(d => [d, { mode: 'all_day' }]));
        assert.deepEqual(Object.keys(C.normaliseDays(reversed, DATES).days), DATES);
    });

    test('every declared mode is exercised by this suite', () => {
        // A mode added to the schema without a test would otherwise ship unvalidated.
        const covered = new Set(['unavailable', 'all_day', 'before', 'after', 'before_after', 'custom']);
        assert.deepEqual(Object.keys(C.AVAILABILITY_MODES).sort(), [...covered].sort());
    });
});

describe('semantic equality of two weeks', () => {
    const DATES = C.weekDates('2026-08-30');
    const week = (fill) => C.normaliseDays(Object.fromEntries(DATES.map(d => [d, fill])), DATES).days;

    test('identical content is equal, different content is not', () => {
        assert.equal(C.daysEqual(week({ mode: 'all_day' }), week({ mode: 'all_day' })), true);
        assert.equal(C.daysEqual(week({ mode: 'all_day' }), week({ mode: 'unavailable' })), false);
    });

    test('a single changed minute on a single day counts as different', () => {
        const a = week({ mode: 'after', from: '15:00' });
        const b = { ...a, [DATES[2]]: { mode: 'after', from: '15:30' } };
        assert.equal(C.daysEqual(a, b), false);
    });
});

describe('concurrency — a stale client must never win silently', () => {
    const DATES = C.weekDates('2026-08-30');
    const norm = (fill) => C.normaliseDays(Object.fromEntries(DATES.map(d => [d, fill])), DATES).days;
    const ALL_DAY = norm({ mode: 'all_day' });
    const NONE    = norm({ mode: 'unavailable' });

    test('a first submission creates revision 1', () => {
        assert.deepEqual(C.decideSubmission(null, ALL_DAY, 0), { action: 'create', revision: 1 });
    });

    test('a first submission claiming a baseline is a conflict, not a create', () => {
        // Their client believes a revision exists that does not — pointed at another window, or at
        // state that was removed. Creating anyway would silently accept a confused caller.
        assert.equal(C.decideSubmission(null, ALL_DAY, 3).action, 'conflict');
    });

    test('a genuine amendment on a current baseline appends the next revision', () => {
        const head = { currentRevision: 2, days: ALL_DAY };
        assert.deepEqual(C.decideSubmission(head, NONE, 2), { action: 'append', revision: 3 });
    });

    test('a genuine amendment on a STALE baseline conflicts and reports what is current', () => {
        const head = { currentRevision: 4, days: ALL_DAY };
        assert.deepEqual(C.decideSubmission(head, NONE, 2), { action: 'conflict', expected: 4 });
    });

    test('an identical retry succeeds and creates nothing — EVEN with a stale baseline', () => {
        // This is the timeout path. The first attempt committed; its response was lost; the client
        // retries with the baseline it last confirmed. Refusing would tell somebody their
        // availability was rejected when it is saved, correct, and already what they wanted.
        const head = { currentRevision: 4, days: ALL_DAY };
        assert.deepEqual(C.decideSubmission(head, ALL_DAY, 4), { action: 'noop', revision: 4 });
        assert.deepEqual(C.decideSubmission(head, ALL_DAY, 1), { action: 'noop', revision: 4 });
    });

    test('the no-op check comes BEFORE the conflict check, and that order is the feature', () => {
        // Reversing them turns every timeout retry into a 409 — the single most likely moment for a
        // member to be told something false about their own submission.
        const head = { currentRevision: 9, days: ALL_DAY };
        assert.equal(C.decideSubmission(head, ALL_DAY, 0).action, 'noop');
    });
});

describe('derived history — the flags nobody stores', () => {
    const DATES = C.weekDates('2026-08-30');
    const norm = (fill) => C.normaliseDays(Object.fromEntries(DATES.map(d => [d, fill])), DATES).days;
    const A = norm({ mode: 'all_day' });
    const B = norm({ mode: 'unavailable' });
    const DEADLINE = 1000;
    const rev = (n, days, at) => ({ revision: n, days, acceptedAt: at });

    test('with nothing submitted, nothing is late and nothing changed', () => {
        const h = C.deriveHistory([], null, DEADLINE);
        assert.equal(h.initialRevision, null);
        assert.equal(h.lateInitial, false, 'no submission is NOT a late submission — it is no response');
        assert.equal(h.changedSinceInitial, false);
    });

    test('the planning state is the LAST revision before the deadline, not the first', () => {
        const revs = [rev(1, A, 100), rev(2, B, 500), rev(3, A, 5000)];
        assert.equal(C.deriveHistory(revs, A, DEADLINE).initialRevision.revision, 2);
    });

    test('a first submission after the deadline is late, with no invented earlier state', () => {
        const h = C.deriveHistory([rev(1, A, 5000)], A, DEADLINE);
        assert.equal(h.lateInitial, true);
        assert.equal(h.initialRevision, null, 'no fabricated initial snapshot');
        assert.equal(h.changedSinceInitial, false, 'there is nothing to have changed FROM');
    });

    test('changed-since-initial compares the cut-off state with the CURRENT state', () => {
        const revs = [rev(1, A, 100), rev(2, B, 5000)];
        assert.equal(C.deriveHistory(revs, B, DEADLINE).changedSinceInitial, true);
    });

    test('changed and then changed BACK is not flagged as changed', () => {
        // The clerk planned against A and the current answer is A. Flagging it would send them to
        // re-read a form that says exactly what they already acted on. The revisions still prove
        // the intermediate change if it is ever needed.
        const revs = [rev(1, A, 100), rev(2, B, 5000), rev(3, A, 6000)];
        const h = C.deriveHistory(revs, A, DEADLINE);
        assert.equal(h.changedSinceInitial, false);
        assert.equal(h.initialRevision.revision, 1);
    });

    test('a revision accepted exactly ON the deadline counts as AFTER it', () => {
        // Same half-open boundary as phaseFor. If the two disagreed, a submission could be accepted
        // as in-time and then derived as late.
        assert.equal(C.deriveHistory([rev(1, A, DEADLINE)], A, DEADLINE).lateInitial, true);
        assert.equal(C.deriveHistory([rev(1, A, DEADLINE - 1)], A, DEADLINE).lateInitial, false);
    });

    test('revisions arriving out of order are still read in revision order', () => {
        const revs = [rev(3, A, 6000), rev(1, A, 100), rev(2, B, 500)];
        assert.equal(C.deriveHistory(revs, A, DEADLINE).initialRevision.revision, 2);
    });

    test('revision ids sort lexically in revision order', () => {
        // The ids ARE the ordering when read back from Firestore; '10' sorting before '9' would
        // silently make the tenth revision look like the earliest.
        const ids = [1, 2, 9, 10, 11, 100].map(C.revisionId);
        assert.deepEqual([...ids].sort(), ids);
    });
});
