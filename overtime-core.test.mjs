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
    test('every planning row appears whether or not any window exists', () => {
        const weeks = C.planningWeekEndings(Date.parse('2026-08-19T09:00:00Z'));
        assert.equal(weeks.length, C.PLANNING_WEEKS);
        assert.ok(weeks.every(C.isSaturday), 'every planning row is a week-ending Saturday');
    });

    test('the horizon starts with THIS week, and each row is seven days on', () => {
        // Wed 19 Aug 2026 → this Sunday–Saturday week ends Sat 22 Aug.
        const weeks = C.planningWeekEndings(Date.parse('2026-08-19T09:00:00Z'));
        assert.equal(weeks[0], '2026-08-22');
        assert.deepEqual(weeks.slice(0, 3), ['2026-08-22', '2026-08-29', '2026-09-05']);
        weeks.forEach((w, i) => assert.equal(w, C.addDays('2026-08-22', i * 7)));
    });

    test('ANSWERABLE_WEEKS really are answerable at every hour of every day', () => {
        // THE reason PLANNING_WEEKS is what it is, expressed as the property rather than a number —
        // and asserted against `ANSWERABLE_WEEKS`, so changing the requirement (six → three, owner,
        // Aug 2026) is one constant and this test follows it rather than being edited to agree.
        //
        // "N weeks ahead" is a count of weeks staff can ANSWER for, and that is not the row count: a
        // window closes 11 days before its Saturday, so row 1 is always behind its own deadline and
        // row 2 goes behind it at Tuesday noon. Measured, a horizon of exactly N rows gave N−2 or
        // N−1 answerable weeks and never N — the requirement was unmeetable while looking satisfied.
        //
        // Sweeping a whole week at two hours catches the Tuesday-noon boundary, which is the only
        // place the count steps down. Asserting the PROPERTY means a future change to the offsets
        // fails here rather than quietly costing a week.
        const START = Date.UTC(2026, 7, 9);            // Sunday 9 Aug 2026
        let worst = Infinity;
        for (let d = 0; d < 7; d++) {
            for (const hour of [9, 13]) {              // either side of the 12:00 London deadline
                const now = START + (d * 86400 + hour * 3600) * 1000;
                const answerable = C.planningWeekEndings(now)
                    .filter(w => C.deriveMilestones(w).finalDeadlineAt > now).length;
                worst = Math.min(worst, answerable);
            }
        }
        assert.ok(worst >= C.ANSWERABLE_WEEKS,
            `only ${worst} answerable weeks at the worst hour of the week, wanted ${C.ANSWERABLE_WEEKS}`);
        // And not WILDLY more than asked for: the horizon is deliberately the requirement plus two,
        // so a change that quietly restored a long reach (the burden the owner cut) fails here too.
        assert.ok(worst <= C.ANSWERABLE_WEEKS + 1,
            `${worst} answerable weeks is more than the requirement — the horizon has grown`);
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

    test('an existing window reads as created for as long as it is OPEN', () => {
        const m = C.deriveMilestones(WEEK_SEP);
        for (const t of [m.initialDeadlineAt - 1, m.initialDeadlineAt, m.finalDeadlineAt - 1]) {
            assert.equal(C.windowRowState(m, t, true), 'created');
        }
    });

    test('and as CREATED-CLOSED once its final deadline has gone', () => {
        // Not a nicety. The horizon's first row is always the current week, whose final deadline is
        // eleven days behind it — so every reviewer, on every visit, was told "Form open" about a
        // week that had closed and whose roster was already published. Two of the six rows were
        // wrong, and always the same two.
        const m = C.deriveMilestones(WEEK_SEP);
        assert.equal(C.windowRowState(m, m.finalDeadlineAt, true), 'created-closed',
            'the boundary belongs to the LATER state, as everywhere else in this module');
        assert.equal(C.windowRowState(m, m.finalDeadlineAt + 9e8, true), 'created-closed');
    });

    test('a week the schedule has already failed to create no longer reads as due tonight', () => {
        // The horizon is the MONITOR over the scheduler, and `not-created` is the one row that
        // tells the reviewer to do nothing. That is right until a run has come and gone without
        // creating the week — after which the same row repeats the same reassurance every day for
        // as long as the fault lasts, and the monitor has become the fault's alibi.
        const m = C.deriveMilestones(WEEK_SEP);
        const t = m.initialDeadlineAt - 1;
        assert.equal(C.windowRowState(m, t, false, false), 'not-created');
        assert.equal(C.windowRowState(m, t, false, true),  'not-created-overdue');
    });

    test('overdue never softens a row that is already reporting something worse', () => {
        // Past the initial deadline the row has a stronger thing to say, and past the final one it
        // is a missed week. An "overdue" flag arriving late must not overwrite either — the flag
        // answers "will the schedule still fix this?", which stops being the question.
        const m = C.deriveMilestones(WEEK_SEP);
        assert.equal(C.windowRowState(m, m.initialDeadlineAt, false, true), 'not-created-initial-passed');
        assert.equal(C.windowRowState(m, m.finalDeadlineAt,   false, true), 'missed');
        // And it can never touch a week that exists — the whole flag is about absence.
        assert.equal(C.windowRowState(m, m.initialDeadlineAt - 1, true, true), 'created');
    });

    test('a closed window is still distinguishable from one that was never created', () => {
        // The two land at the same instant and mean opposite things: one has a week of answers in
        // it, the other means nobody was ever asked. Collapsing them would hide the omission this
        // whole horizon exists to surface.
        const m = C.deriveMilestones(WEEK_SEP);
        assert.notEqual(C.windowRowState(m, m.finalDeadlineAt, true),
                        C.windowRowState(m, m.finalDeadlineAt, false));
    });
});

describe('withdrawal — the one exception to the freeze, and its bounds', () => {
    // The freeze is what makes a response rate mean anything. Its unchosen consequence is that a
    // LEAVER stays in every open week as a permanent non-responder, so the reviewer chasing
    // outstanding forms chases somebody who no longer works here, every week, until the horizon
    // rolls past them. Withdrawal is the narrow answer, and its bounds are the whole design.

    test('it is allowed while the form is open, in EITHER phase', () => {
        const m = C.deriveMilestones(WEEK_SEP);
        assert.equal(C.canChangeParticipation(m, m.initialDeadlineAt - 1).ok, true, 'INITIAL_OPEN');
        assert.equal(C.canChangeParticipation(m, m.initialDeadlineAt).ok, true, 'FINAL_OPEN');
        // Deliberately NOT the `INITIAL_OPEN`-only rule that governs ADDING somebody. Adding late
        // manufactures a non-responder for a deadline that pre-dates the invitation; removing
        // somebody creates no record at all, so the reason to be strict is simply absent.
        //
        // RESTORING is a different question and has its own rule — see the block below. Withdrawing
        // takes a record away; restoring puts one back, and that is where a false claim can appear.
    });

    test('a CLOSED week refuses it — that week is a record, not a work list', () => {
        // Somebody who was employed, was asked, and did not answer is accurately recorded as
        // exactly that. Editing it afterwards changes a historical response rate to make a past
        // week look tidier, and this feature's whole value is that its history cannot be tidied.
        const m = C.deriveMilestones(WEEK_SEP);
        assert.deepEqual(C.canChangeParticipation(m, m.finalDeadlineAt), { ok: false, error: 'closed' });
        assert.deepEqual(C.canChangeParticipation(m, m.retentionUntil), { ok: false, error: 'expired' });
        // `expired` outranks `closed` — every expired week is also closed, and the caller wants the
        // more specific reason.
        assert.equal(C.canChangeParticipation(m, m.retentionUntil + 9e8).error, 'expired');
    });

    describe('restoring is NOT the mirror of withdrawing (v21.26, external review)', () => {
        // ── THE DEFECT ──────────────────────────────────────────────────────────────────────────
        //
        // Withdraw before the initial deadline → let it pass → restore. The person is now expected
        // for a week whose first deadline they were never asked about, so the moment they submit,
        // `deriveHistory` finds nothing accepted before it and marks them "submitted after initial
        // deadline". True of the data, false of the person, on the screen a reviewer uses to judge
        // who is responsive.
        const m = C.deriveMilestones(WEEK_SEP);
        const before = m.initialDeadlineAt - 60_000;
        const after  = m.initialDeadlineAt + 60_000;

        test('before the initial deadline, any withdrawal may be undone', () => {
            // Nothing has been decided yet, so putting somebody back claims nothing about them.
            assert.equal(C.canRestoreParticipant(m, before - 60_000, before).ok, true);
        });

        test('after it, a withdrawal made AFTER it is still an ordinary undo', () => {
            // The case worth keeping: an accidental press, or a leaver who turned out to be
            // staying. Their history across the deadline is untouched, so nothing false is claimed.
            assert.equal(C.canRestoreParticipant(m, after, after + 60_000).ok, true);
        });

        test('after it, a withdrawal made BEFORE it is refused', () => {
            // The defect itself. They join from the next week instead — which is exactly what the
            // app already does with a newly eligible member (`addMissingParticipants` returns early
            // outside INITIAL_OPEN), so this makes one principle out of two.
            assert.deepEqual(C.canRestoreParticipant(m, before, after),
                { ok: false, error: 'restore-window-passed' });
        });

        test('the boundary is the deadline instant itself, tested either side', () => {
            // A minute out here is a person wrongly marked late, or wrongly refused a restore.
            assert.equal(C.canRestoreParticipant(m, m.initialDeadlineAt + 1, after).ok, true);
            assert.equal(C.canRestoreParticipant(m, m.initialDeadlineAt, after).ok, false,
                'a withdrawal AT the deadline is not after it');
        });

        test('an unreadable stamp refuses, because the two ways of being wrong are not equal', () => {
            // `withdrawnAt` has been written beside the flag since the feature shipped, so this
            // should be unreachable. If it happens we cannot tell which side of the deadline it
            // fell — and refusing blocks an undo (visible, recoverable next week) where allowing
            // re-creates the false "late" marker the rule exists to prevent.
            // The NUMERIC STRING is the case that matters and the only one the type check earns
            // its place on: `null`, `undefined`, `NaN` and prose all compare false against a number
            // anyway, so a test made only of those passes with the guard deleted (found by mutation
            // — the first version of this test had exactly that hole). A string coerces, and
            // '9999999999999' would sail past the comparison as a withdrawal in the year 2286.
            for (const bad of [null, undefined, NaN, 'yesterday', String(after + 1000), '']) {
                assert.equal(C.canRestoreParticipant(m, /** @type {any} */ (bad), after).ok, false,
                    `${String(bad)} was treated as a readable stamp`);
            }
            // …and it does NOT refuse before the deadline, where the stamp is not consulted at all.
            assert.equal(C.canRestoreParticipant(m, null, before).ok, true);
        });

        test('it still inherits every bound withdrawal has', () => {
            // A closed or expired week refuses a restore for the reasons it refuses everything
            // else, and those answers must not be masked by the new one — a reviewer reading
            // "restore window passed" on a week that is simply closed would go looking for the
            // wrong thing.
            assert.equal(C.canRestoreParticipant(m, after, m.finalDeadlineAt).error, 'closed');
            assert.equal(C.canRestoreParticipant(m, after, m.retentionUntil).error, 'expired');
        });
    });

    test('a missing window is refused rather than throwing mid-request', () => {
        assert.deepEqual(C.canChangeParticipation(null, 0), { ok: false, error: 'no-window' });
    });

    test('withdrawn is a STRICT true, and an absent field is not withdrawn', () => {
        // Both halves matter and they fail in opposite directions. A truthiness check would read a
        // string or a timestamp as withdrawal and remove somebody the reviewer must chase; and
        // every participant document written before this feature existed has no field at all, so
        // treating "missing" as anything but present would empty every current week.
        assert.equal(C.isWithdrawn({ withdrawn: true }), true);
        for (const v of [undefined, null, false, 0, '', 'true', 1, {}]) {
            assert.equal(C.isWithdrawn({ withdrawn: v }), false, `withdrawn: ${JSON.stringify(v)}`);
        }
        assert.equal(C.isWithdrawn({ memberName: 'A. One' }), false, 'a legacy record is not withdrawn');
        assert.equal(C.isWithdrawn(null), false);
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

    test('the restricted audience is the admin, and only the admin', () => {
        const p = C.selectParticipants(ELIGIBLE, { weekStart: '2026-08-30',
            audience: 'restricted', adminNames: ['A. One'] });
        assert.deepEqual(p.map(x => x.memberName), ['A. One']);
    });

    test('restricted with no admin list supplied yields nobody, not everybody', () => {
        // Fail CLOSED. A missing config must not silently create an all-staff window while the
        // page is still hidden from staff — the one rollout mistake that cannot be undone quietly.
        assert.deepEqual(C.selectParticipants(ELIGIBLE, { weekStart: '2026-08-30', audience: 'restricted' }), []);
    });

    test('NO audience makes a manager a participant — checked against every audience there is', () => {
        // The invariant, not one branch of it. A manager REVIEWS: the right comes from the `manager`
        // claim, so they already see every week's answers without being in any of them. A manager in
        // the frozen population is recorded as expected to answer and is therefore a non-responder
        // for that week for ever — and frozen means it cannot be corrected afterwards.
        //
        // Enumerating the audiences rather than naming two is what makes this hold for the NEXT one:
        // a third audience added without thinking about managers fails here instead of in a window.
        const roster = [
            { name: 'A. One',  grade: 'CEA',        rosterOrder: 1, hidden: false, managerOnly: false },
            { name: 'M. Boss', grade: 'Management', rosterOrder: 2, hidden: true,  managerOnly: true  },
        ];
        for (const audience of C.AUDIENCES) {
            const chosen = C.selectParticipants(roster, {
                weekStart: '2026-08-30', audience,
                // The manager named as an admin too — the strongest form of the test. Even an
                // entitlement that WOULD select them must not, because the flag is what decides.
                adminNames: ['A. One', 'M. Boss'],
            }).map(x => x.memberName);
            assert.equal(chosen.includes('M. Boss'), false, `audience "${audience}" selected a manager`);
        }
    });

    test('a LEAVER is in nobody\'s window, whichever audience is in force', () => {
        const roster = [{ name: 'X. Gone', grade: 'CEA', rosterOrder: 1, hidden: true, managerOnly: false }];
        for (const audience of C.AUDIENCES) {
            assert.deepEqual(
                C.selectParticipants(roster, { weekStart: '2026-08-30', audience, adminNames: ['X. Gone'] }),
                [], `audience "${audience}" selected a leaver`);
        }
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
        const { overtimeRoster } = require('./functions/roster-members.json');
        assert.ok(overtimeRoster.length > 0, 'the generated list must not be empty');
        for (const m of overtimeRoster) {
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
        const { overtimeRoster } = require('./functions/roster-members.json');
        for (const m of overtimeRoster) {
            assert.equal(typeof m.grade, 'string');
            assert.ok(Number.isInteger(m.rosterOrder));
            assert.ok(m.startDate === null || C.isValidIsoDate(m.startDate), `bad startDate for ${m.name}`);
        }
    });

    test('the generated list states WHO EXISTS, flags and all — the decision is not baked in', () => {
        // It used to carry the decision instead: `!hidden && !managerOnly` applied at generation, in
        // a file that cannot express a second audience and does not look like policy. The behaviour
        // is the same; the rule is now somewhere it can be read, argued with and tested.
        const { overtimeRoster } = require('./functions/roster-members.json');
        for (const m of overtimeRoster) {
            assert.equal(typeof m.hidden, 'boolean', `${m.name} has no hidden flag`);
            assert.equal(typeof m.managerOnly, 'boolean', `${m.name} has no managerOnly flag`);
        }
        assert.ok(overtimeRoster.some(m => m.managerOnly), 'the managers are IN the roster as people');
    });

    test('no audience asks a manager, against the REAL roster and every audience there is', () => {
        // The fixture version of this is above; this one is the same invariant asserted against the
        // data that actually ships, because the fixture cannot notice a manager gaining a flag.
        // Every manager is deliberately still an active ACCOUNT — they sign in and review. Being an
        // account and being expected to answer are different things, and this is where they part.
        const { overtimeRoster, activeMembers, roles } = require('./functions/roster-members.json');
        for (const audience of C.AUDIENCES) {
            const asked = new Set(C.selectParticipants(overtimeRoster, {
                weekStart: '2026-08-30', audience, adminNames: roles.admin,
            }).map(p => p.memberName));
            for (const manager of roles.manager) {
                assert.equal(asked.has(manager), false,
                    `${manager} was asked by audience "${audience}" — a reviewer, never a participant`);
                assert.ok(activeMembers.includes(manager),
                    'and is still an active ACCOUNT — the two differ on purpose');
            }
        }
    });

    test('the restricted beta asks the admin AND every invited member — no more, no fewer', () => {
        // The live configuration, checked end to end on real data. Zero would mean windows that read
        // "0 of 0 received" (a finished week, not an empty one); a name missing means somebody was
        // invited and never asked — a page with no form on it. Both are invisible until somebody
        // opens a week, which is why this asserts the exact set rather than a count.
        const { overtimeRoster, roles, overtimeBeta } = require('./functions/roster-members.json');
        const asked = C.selectParticipants(overtimeRoster, {
            weekStart: '2026-08-30', audience: 'restricted',
            adminNames: roles.admin, betaNames: overtimeBeta,
        }).map(p => p.memberName);
        assert.deepEqual([...asked].sort(), [...roles.admin, ...overtimeBeta].sort());
    });

    test('an invited beta member must actually EXIST in the roster', () => {
        // The invitation is a name typed into CONFIG, and a typo is silent in the direction that
        // matters: `selectParticipants` simply never matches it, so the member is invited on paper
        // and asked nothing. Nothing else in the system would notice.
        const { overtimeRoster, overtimeBeta } = require('./functions/roster-members.json');
        const names = new Set(overtimeRoster.map(m => m.name));
        for (const n of overtimeBeta) {
            assert.ok(names.has(n), `beta member "${n}" is not on the roster — a typo, or a leaver`);
        }
    });

    test('a beta invitation cannot smuggle in somebody stage 1 excludes', () => {
        // Stage 1 binds every audience, and the beta list is stage 2. Naming a manager (or a
        // leaver) here must change nothing — otherwise the invitation becomes a second, unreviewed
        // route into a population that reports non-responders for ever.
        const roster = [
            { name: 'A. One',  grade: 'CEA',        rosterOrder: 1, hidden: false, managerOnly: false },
            { name: 'M. Boss', grade: 'Management', rosterOrder: 2, hidden: true,  managerOnly: true  },
            { name: 'X. Gone', grade: 'CEA',        rosterOrder: 3, hidden: true,  managerOnly: false },
        ];
        const asked = C.selectParticipants(roster, {
            weekStart: '2026-08-30', audience: 'restricted',
            adminNames: [], betaNames: ['A. One', 'M. Boss', 'X. Gone'],
        }).map(p => p.memberName);
        assert.deepEqual(asked, ['A. One']);
    });
});

describe('the availability schema — never invent an answer', () => {
    const DATES = C.weekDates('2026-08-30');
    const week = (fill) => Object.fromEntries(DATES.map(d => [d, fill]));

    test('all seven modes round-trip unchanged', () => {
        const modes = [
            { mode: 'unavailable' },
            { mode: 'all_day' },
            // Self-contained like all_day — the twelve is the ceiling of a turn, not a clock
            // boundary, so there is nothing for a roster change to invalidate and nothing extra to
            // validate. The client-side OFFER gate (rostered < 12h) is deliberately not re-checked
            // here; the declaration is valid whatever the roster later becomes.
            { mode: 'twelve_hours' },
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

    describe('the willingness flag rides ALONGSIDE a window (v21.24)', () => {
        // The availability/willingness split. `twelve_hours` said HOW LONG in a control whose every
        // other option said WHEN, so the two competed; `fullTwelve` is a separate axis and can
        // therefore accompany any window without overlapping it.
        const AVAILABLE = [
            { mode: 'all_day' },
            { mode: 'before', until: '07:00' },
            { mode: 'after', from: '15:00' },
            { mode: 'before_after', until: '07:00', from: '15:00' },
            { mode: 'custom', start: '18:00', end: '23:00', nextDay: false },
        ];

        test('every available mode accepts it, and it survives the round trip', () => {
            for (const m of AVAILABLE) {
                const day = { ...m, fullTwelve: true };
                const r = C.normaliseDays(week(day), DATES);
                assert.equal(r.ok, true, `${m.mode} should accept the flag`);
                assert.deepEqual(r.days[DATES[0]], day, `${m.mode} must keep it verbatim`);
                // Fixed point, like every other answer — a saved form must not drift when it is
                // read back and re-submitted.
                assert.deepEqual(C.normaliseDays(r.days, DATES).days, r.days);
            }
        });

        test('FALSE is stored as an absence, never as a declared no', () => {
            // An unticked box has said nothing. Storing `fullTwelve: false` would make answers
            // written before this field structurally different from identical ones written after,
            // for a difference nobody expressed — and would need a migration to keep them
            // comparable. Same reasoning as a restored participant losing `withdrawn` outright.
            const r = C.normaliseDays(week({ mode: 'all_day', fullTwelve: false }), DATES);
            assert.equal(r.ok, true);
            assert.deepEqual(r.days[DATES[0]], { mode: 'all_day' });
            assert.equal('fullTwelve' in r.days[DATES[0]], false);
        });

        test('"not available" refuses it — the one mode it cannot mean anything beside', () => {
            const r = C.normaliseDays(week({ mode: 'unavailable', fullTwelve: true }), DATES);
            assert.equal(r.ok, false);
            assert.equal(r.error, 'unknown-field');
        });

        test('and it is type-checked, like every other field', () => {
            for (const bad of ['yes', 1, null, {}]) {
                const r = C.normaliseDays(week({ mode: 'all_day', fullTwelve: bad }), DATES);
                assert.equal(r.ok, false, `fullTwelve: ${JSON.stringify(bad)} was accepted`);
            }
        });

        test('an answer WITHOUT it is unchanged — this is additive, not a new requirement', () => {
            // The field is optional in the true sense: every form submitted before v21.24 stays
            // valid, and a client that never sends it keeps working for ever.
            const r = C.normaliseDays(week({ mode: 'before_after', until: '07:00', from: '15:00' }), DATES);
            assert.equal(r.ok, true);
            assert.equal('fullTwelve' in r.days[DATES[0]], false);
        });

        test('the retired twelve_hours mode still parses, because revisions are immutable', () => {
            // It is no longer offered by any client, but answers stored under it exist until their
            // retention window ends and must keep loading. Deleting it from the table would make
            // real records unreadable rather than tidy the schema.
            const r = C.normaliseDays(week({ mode: 'twelve_hours' }), DATES);
            assert.equal(r.ok, true);
            assert.deepEqual(r.days[DATES[0]], { mode: 'twelve_hours' });
        });
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
        // The new fieldless mode inherits the same strictness — a client smuggling a boundary onto
        // it is a version mismatch, not a richer answer.
        assert.equal(C.normaliseDays(week({ mode: 'twelve_hours', until: '19:00' }), DATES).error, 'unknown-field');
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
        const covered = new Set(['unavailable', 'all_day', 'twelve_hours', 'before', 'after', 'before_after', 'custom']);
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

describe('when the schedule last ran — the boundary a stuck week is measured against', () => {
    // 05:00 Europe/London, matching autoCreateOvertimeWindows' cron. Nothing is stored about the
    // job's runs, so this instant is the only thing the horizon can hold a missing week against.

    test('it is 05:00 as a person in London reads it, in both halves of the year', () => {
        for (const ms of [Date.parse('2026-09-05T09:00:00Z'), Date.parse('2027-01-09T09:00:00Z')]) {
            assert.match(londonWallClock(C.lastSchedulerRun(ms)), /, 05:00$/);
        }
    });

    test("before 05:00 it is YESTERDAY's run, not today's", () => {
        const beforeFive = Date.parse('2026-09-05T02:00:00Z');   // 03:00 London
        assert.equal(new Date(C.lastSchedulerRun(beforeFive)).toISOString(),
            '2026-09-04T04:00:00.000Z');                          // 05:00 BST on the 4th
    });

    test('at exactly 05:00 the run has happened — the boundary belongs to the later state', () => {
        const fiveExactly = Date.parse('2026-09-05T04:00:00Z');
        assert.equal(C.lastSchedulerRun(fiveExactly), fiveExactly);
        assert.equal(C.lastSchedulerRun(fiveExactly - 1),
            Date.parse('2026-09-04T04:00:00Z'), 'one millisecond earlier is still yesterday');
    });

    test('the previous run is found by CALENDAR day, so a clock change cannot move it an hour', () => {
        // Both UK transitions are Sundays: 29 Mar and 25 Oct 2026. On each of those mornings the
        // previous day's 05:00 is NOT 24 hours before today's, and subtracting a day in
        // milliseconds — the obvious way to write this — is wrong in opposite directions on the two
        // dates. Every other hour of the year agrees, which is exactly why it would ship.
        const springMorning = Date.parse('2026-03-29T03:30:00Z');  // 04:30 BST, before 05:00
        assert.equal(new Date(C.lastSchedulerRun(springMorning)).toISOString(),
            '2026-03-28T05:00:00.000Z', 'spring: naive minus-24h lands an hour early');

        const autumnMorning = Date.parse('2026-10-25T04:30:00Z');  // 04:30 GMT, before 05:00
        assert.equal(new Date(C.lastSchedulerRun(autumnMorning)).toISOString(),
            '2026-10-24T04:00:00.000Z', 'autumn: naive minus-24h lands an hour late');
    });

    test('a week still missing at the last boundary is exactly what the job was due to create', () => {
        // The horizon does not re-implement the decision; it re-runs the scheduler's own function at
        // the scheduler's own last boundary. This is that equivalence, asserted rather than assumed —
        // if they could differ, a healthy schedule would be accused or a broken one excused.
        const now = Date.parse('2026-08-11T09:00:00Z');
        const last = C.lastSchedulerRun(now);
        const due = C.weeksNeedingWindows(last, [], { maxRosterYear: 2030 });
        assert.ok(due.length, 'fixture no longer exercises this');
        // With everything that run was due to create now present, nothing is overdue.
        assert.deepEqual(C.weeksNeedingWindows(last, due, { maxRosterYear: 2030 }), []);
    });
});

describe('weeksNeedingWindows — what the scheduler will create', () => {
    // A Tuesday, so "this week's Saturday" is a live week with deadlines already behind it.
    const NOW = Date.parse('2026-08-11T04:00:00Z');
    const HORIZON = () => C.planningWeekEndings(NOW);

    test('it is EXACTLY the weeks the Manager Create button offers', () => {
        // The single most important property, and the reason this function exists rather than the
        // scheduler having its own idea. If the two lists could differ, a week could be offered by
        // neither — which is the silent failure the whole feature is arranged around.
        const byButton = HORIZON().filter(w =>
            C.validateWeekEnding(w, { nowMs: NOW, maxRosterYear: 2030 }).ok);
        assert.deepEqual(
            C.weeksNeedingWindows(NOW, [], { maxRosterYear: 2030 }),
            byButton);
        assert.ok(byButton.length >= 3, `expected several creatable weeks, got ${byButton.length}`);
    });

    test('a week already created is not offered again', () => {
        const all = C.weeksNeedingWindows(NOW, [], { maxRosterYear: 2030 });
        const rest = C.weeksNeedingWindows(NOW, [all[0]], { maxRosterYear: 2030 });
        assert.deepEqual(rest, all.slice(1));
    });

    test('every existing week means nothing is due — the ordinary daily run', () => {
        const all = C.weeksNeedingWindows(NOW, [], { maxRosterYear: 2030 });
        assert.deepEqual(C.weeksNeedingWindows(NOW, all, { maxRosterYear: 2030 }), []);
    });

    test('a week past its FINAL deadline is never created, however early the horizon starts', () => {
        // The one case where creating would do harm: a form nobody could ever submit to, which
        // reads as apathy rather than as a mistake. The current week's Saturday is the example —
        // its final deadline was eleven days ago.
        const due = C.weeksNeedingWindows(NOW, [], { maxRosterYear: 2030 });
        const first = HORIZON()[0];
        assert.ok(NOW >= C.deriveMilestones(first).finalDeadlineAt, 'fixture no longer exercises this');
        assert.ok(!due.includes(first));
    });

    test('a week past only its INITIAL deadline IS still created', () => {
        // Deliberate, and the opposite of the case above: members can still declare before the
        // final cut-off, and a late form beats no form. It also matches the button, which offers
        // that week — the equivalence in the first test is what makes this safe to assert.
        const w = HORIZON()[1];
        const m = C.deriveMilestones(w);
        assert.ok(NOW >= m.initialDeadlineAt && NOW < m.finalDeadlineAt, 'fixture no longer exercises this');
        assert.ok(C.weeksNeedingWindows(NOW, [], { maxRosterYear: 2030 }).includes(w));
    });

    test('nothing beyond the supported roster horizon is created', () => {
        // maxRosterYear comes from the generated config; a year past it has no roster to be
        // available for, so a window there would ask about weeks the app cannot even display.
        const due = C.weeksNeedingWindows(NOW, [], { maxRosterYear: 2020 });
        assert.deepEqual(due, []);
    });

    test('it tolerates a missing or odd existing-list rather than throwing mid-run', () => {
        // The caller passes whatever Firestore returned. A throw here would take out the whole
        // scheduled run, including the weeks that were perfectly creatable.
        const all = C.weeksNeedingWindows(NOW, [], { maxRosterYear: 2030 });
        assert.deepEqual(C.weeksNeedingWindows(NOW, null, { maxRosterYear: 2030 }), all);
        assert.deepEqual(C.weeksNeedingWindows(NOW, new Set(all), { maxRosterYear: 2030 }), []);
    });
});

describe('push notices — the words and the one morning, each wrong-able silently', () => {
    // The builder that enforces the truncation budgets lives beside the other notification rules;
    // requiring it here makes the budget assertion the REAL one rather than a re-implementation.
    const { buildPushPayload } = require('./functions/roster-parse-helpers.js');
    const M = C.deriveMilestones('2026-09-05');   // BST week — initial deadline Tue 18 Aug 12:00 London
    const WINTER = C.deriveMilestones('2027-01-16');   // GMT week, so the label is exercised on both offsets

    describe('reminderDue — the reminder fires on ONE morning, and only once', () => {
        const sent = 0, never = 0;
        test('due: inside 24 hours of an INITIAL_OPEN deadline, never sent', () => {
            assert.equal(C.reminderDue(M, never, M.initialDeadlineAt - 7 * 3600_000), true);
            assert.equal(C.reminderDue(M, never, M.initialDeadlineAt - C.REMINDER_LOOKAHEAD_MS), true,
                'the boundary itself is due — the 05:00 run must not slip through a strict <');
        });
        test('not due: the morning BEFORE — 31 hours out at the previous 05:00 run', () => {
            assert.equal(C.reminderDue(M, never, M.initialDeadlineAt - 31 * 3600_000), false);
        });
        test('not due: already stamped — the re-run and second-instance guard', () => {
            assert.equal(C.reminderDue(M, M.initialDeadlineAt - 8 * 3600_000, M.initialDeadlineAt - 7 * 3600_000), false);
        });
        test('not due: the deadline has passed — the phase moved and the question is closed', () => {
            assert.equal(C.reminderDue(M, sent, M.initialDeadlineAt + 60_000), false);
        });
        test('not due: an expired window, whatever its clock says', () => {
            assert.equal(C.reminderDue({ ...M, retentionUntil: 1 }, 0, M.initialDeadlineAt - 3600_000), false);
        });
    });

    describe('the labels say LONDON, in both halves of the year', () => {
        test('a BST deadline renders as 12:00, not the server zone', () => {
            // On a UTC server this instant is 11:00 — printing the server zone is the failure mode.
            assert.equal(C.londonDeadlineLabel(M.initialDeadlineAt), 'Tue 18 Aug · 12:00');
        });
        test('a GMT deadline also renders 12:00 — noon London is the definition, not an offset', () => {
            assert.match(C.londonDeadlineLabel(WINTER.initialDeadlineAt), / · 12:00$/);
        });
    });

    describe('the two notices fit the design language without clipping', () => {
        // A clipped deadline is worse than none: "Answer by Tue 18 Au…" reads as complete and says
        // the wrong thing. So both notices are asserted THROUGH the real builder, whose ellipsis is
        // the failure signature.
        for (const [name, notice] of [
            ['asked',    C.askedNotice(M)],
            ['reminder', C.reminderNotice(M)],
        ]) {
            test(`${name}: inside the title and body budgets, unclipped`, () => {
                const p = buildPushPayload({
                    feature: 'overtime', headline: notice.headline, body: notice.body,
                    url: 'https://myb-roster.web.app/overtime.html',
                });
                assert.ok(p.title.startsWith('⏱️ '), 'the feature emoji leads');
                assert.ok(p.title.length <= 40, `title ${p.title.length} > 40: ${p.title}`);
                assert.ok(!p.title.includes('…') && !p.body.includes('…'), `clipped: ${p.title} / ${p.body}`);
                assert.equal(p.tag, 'overtime');
            });
        }
        test('the reminder names the week and the time, from the same label the asked notice uses', () => {
            assert.equal(C.reminderNotice(M).body,
                'Initial answers for week ending Sat 5 Sep are due by 12:00 today.');
            assert.match(C.askedNotice(M).body, /Answer by Tue 18 Aug · 12:00\.$/);
        });

        // ── THE ASKED NOTICE MAY NOT NAME A DEADLINE ALREADY BEHIND THE READER (v21.56) ─────────
        //
        // A window created after its initial deadline is a SUPPORTED path — the horizon's "first
        // deadline has passed" row invites exactly that, because a late form beats no form. The
        // notice used to interpolate the initial deadline unconditionally, telling everyone asked
        // by a late-opened week to answer by a moment days in the past — the identical error
        // direction the v21.54 reminder fix shipped for.
        test('asked BEFORE the initial deadline names the initial deadline', () => {
            assert.match(C.askedNotice(M, M.initialDeadlineAt - 60_000).body,
                /Answer by Tue 18 Aug · 12:00\.$/);
        });
        test('asked AFTER the initial deadline names the FINAL deadline — a moment still ahead', () => {
            const body = C.askedNotice(M, M.initialDeadlineAt + 60_000).body;
            assert.match(body, /Answer by Tue 25 Aug · 12:00\.$/,
                'the final deadline (a week later) is the one that can still be met');
            assert.ok(!body.includes('18 Aug'), 'the passed deadline must not appear');
        });
        test('and it still fits the budgets in the late-created form', () => {
            const n = C.askedNotice(M, M.initialDeadlineAt + 60_000);
            const p = buildPushPayload({ feature: 'overtime', headline: n.headline, body: n.body,
                url: 'https://myb-roster.web.app/overtime.html' });
            assert.ok(!p.title.includes('…') && !p.body.includes('…'), `clipped: ${p.body}`);
        });

        // ── THE REMINDER MAY NOT SAY THE FORM CLOSES (v21.54, external review P1) ───────────────
        //
        // It did, for one release, and two tests asserted the wrong sentence word for word — which
        // is the failure worth naming: coverage protected the implementation faithfully while the
        // product claim underneath it was false. A string equality cannot tell you that; it only
        // tells you nobody changed it by accident.
        //
        // Noon is the INITIAL deadline. `phaseFor` then returns FINAL_OPEN and `isOpenPhase` is
        // still true, so a member may make a FIRST submission or amend one for another week. The
        // error runs in the dangerous direction: it tells somebody who missed noon not to bother,
        // manufacturing the permanent non-response the reminder exists to prevent.
        //
        // So this asserts the RULE, in both directions, against the phase machine rather than
        // against a sentence: no closure language while the window is still open, and the time it
        // names really is the initial deadline.
        test('it never says the form CLOSES, because at that moment it does not', () => {
            const { body, headline } = C.reminderNotice(M);
            const justAfterNoon = M.initialDeadlineAt + 60_000;
            assert.equal(C.phaseFor(M, justAfterNoon), 'FINAL_OPEN',
                'the premise: the deadline the reminder names is NOT the end of the window');
            assert.equal(C.isOpenPhase(C.phaseFor(M, justAfterNoon)), true,
                'and the form still accepts answers after it');
            for (const word of [/\bcloses?\b/i, /\bclosing\b/i, /\blast chance\b/i, /\bfinal\b/i]) {
                assert.ok(!word.test(body), `reminder body claims closure: ${body}`);
                assert.ok(!word.test(headline), `reminder headline claims closure: ${headline}`);
            }
            assert.match(body, /\bdue by\b/, 'it states a due time instead');
            // The time it quotes is the INITIAL deadline, not the final one — naming the wrong
            // deadline would be accurate about closure and wrong about the day.
            assert.ok(body.includes(C.londonDeadlineLabel(M.initialDeadlineAt).split('·')[1].trim()));
        });
    });
});
