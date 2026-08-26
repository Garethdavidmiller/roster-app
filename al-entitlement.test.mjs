// @ts-check
/**
 * Tests for al-entitlement.js — which AL days consume entitlement, and where a member stands.
 *
 * ORGANISED BY WHAT A WRONG FIGURE COSTS, not by function. The two directions are not symmetric and
 * a per-function suite would miss why the module exists:
 *
 *   · **counting too MANY** is the shipped defect. The banner told a manager a member had fewer days
 *     left than the save path believed, and the week-grid save could refuse a booking that was
 *     comfortably inside the entitlement. Nothing errors; the number is simply wrong, and it is the
 *     number somebody plans leave against.
 *   · **counting too FEW** is what a careless fix produces — exclude a shade too much and the app
 *     lets a member book past their entitlement with no confirm bar at all.
 *
 * The third block pins the two answers AGREEING, because the divergence, not either rule, is the
 * thing that was actually wrong.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { countedAlDates, alPosition, consumesEntitlement } from './al-entitlement.js';
import { teamMembers, getBaseShift, parseISODate, formatISO, isSunday } from './roster-data.js';
import { isRestShift } from './override-utils.js';

/** A CEA on the main rotation — a real member, so the base roster under each date is real too. */
const MEMBER = teamMembers.find(m => m.role === 'CEA' && !m.hidden && !m.startDate);
assert.ok(MEMBER, 'fixture needs a plain CEA with no start-date suppression');

const al = (date) => ({ memberName: MEMBER.name, type: 'annual_leave', date });

/**
 * Walk forward from `from` collecting dates whose BASE shift is (or is not) a rest day.
 * Uses the app's own `formatISO`/`isSunday` rather than UTC methods, so the fixture does not depend
 * on the machine's timezone — `parseISODate` returns LOCAL noon, and a UTC read of it drifts a day
 * either side of the meridian.
 */
function datesWhere(from, wantRest, n) {
    const out = [];
    const d = parseISODate(from);
    while (out.length < n) {
        const iso = formatISO(d);
        if (!isSunday(iso) && isRestShift(getBaseShift(MEMBER, parseISODate(iso))) === wantRest) out.push(iso);
        d.setDate(d.getDate() + 1);
    }
    return out;
}

const WORKED = datesWhere('2026-03-02', false, 6);
const RESTED = datesWhere('2026-03-02', true, 3);

describe('counting too many — the shipped defect', () => {
    test('a Sunday AL document does not consume a day', () => {
        // 2026-03-01 is a Sunday. Sundays are uncontracted, so a legacy document saying otherwise
        // must not spend entitlement — the write paths refuse one, this stops an old one counting.
        assert.equal(parseISODate('2026-03-01').getUTCDay(), 0, 'fixture date must be a Sunday');
        const got = countedAlDates({
            overrides: [al('2026-03-01'), al(WORKED[0])], member: MEMBER, year: 2026,
        });
        assert.deepEqual([...got], [WORKED[0]]);
    });

    test('AL sitting on a base REST day does not consume a day', () => {
        // The rule admin-al.js had and the other two call sites did not. New dates are filtered
        // through isWorkingDate, which drops rest days — so keeping them here compares unlike with
        // unlike and inflates the projected total into a spurious "over entitlement" confirm.
        const got = countedAlDates({
            overrides: [al(RESTED[0]), al(RESTED[1]), al(WORKED[0])], member: MEMBER, year: 2026,
        });
        assert.deepEqual([...got], [WORKED[0]]);
    });

    test('another member\'s leave, another year, and a non-AL override are all ignored', () => {
        const other = teamMembers.find(m => m.name !== MEMBER.name && m.role === 'CEA');
        const got = countedAlDates({
            overrides: [
                al(WORKED[0]),
                { memberName: other.name, type: 'annual_leave', date: WORKED[1] },
                { memberName: MEMBER.name, type: 'annual_leave', date: '2025-03-03' },
                { memberName: MEMBER.name, type: 'sick', date: WORKED[2] },
            ],
            member: MEMBER, year: 2026,
        });
        assert.deepEqual([...got], [WORKED[0]]);
    });

    test('the same date twice counts once — the return is a SET', () => {
        // Two documents on one date is not two days of leave. A duplicate is possible in the cache
        // mid-save, and counting it would refuse a legitimate booking.
        const got = countedAlDates({ overrides: [al(WORKED[0]), al(WORKED[0])], member: MEMBER, year: 2026 });
        assert.equal(got.size, 1);
    });

    test('a date the batch is overwriting or deleting is left out, so it cannot be counted twice', () => {
        const got = countedAlDates({
            overrides: [al(WORKED[0]), al(WORKED[1]), al(WORKED[2])],
            member: MEMBER, year: 2026,
            exclude: new Set([WORKED[0], WORKED[1]]),
        });
        assert.deepEqual([...got], [WORKED[2]]);
    });
});

describe('counting too few — what a careless fix produces', () => {
    test('an ordinary worked day DOES consume a day', () => {
        const got = countedAlDates({ overrides: [al(WORKED[0])], member: MEMBER, year: 2026 });
        assert.deepEqual([...got], [WORKED[0]], 'the base case must survive every exclusion above');
    });

    test('with no exclusion set, nothing is excluded', () => {
        // `exclude` defaults to null. Treating a missing set as "exclude everything" would silently
        // report a member as having used no leave at all.
        const got = countedAlDates({ overrides: WORKED.map(al), member: MEMBER, year: 2026 });
        assert.equal(got.size, WORKED.length);
    });

    test('a year given as a number matches the same dates as the string form', () => {
        // Call sites pass `yearStr` from an input value; the banner used parseInt. A silent mismatch
        // here would report zero days used.
        const asNum = countedAlDates({ overrides: [al(WORKED[0])], member: MEMBER, year: 2026 });
        const asStr = countedAlDates({ overrides: [al(WORKED[0])], member: MEMBER, year: '2026' });
        assert.deepEqual([...asNum], [...asStr]);
        assert.equal(asNum.size, 1);
    });

    test('no member and no overrides give an empty set rather than throwing', () => {
        assert.equal(countedAlDates({ overrides: [], member: MEMBER, year: 2026 }).size, 0);
        assert.equal(countedAlDates({ overrides: [al(WORKED[0])], member: null, year: 2026 }).size, 0);
        assert.equal(countedAlDates({ overrides: null, member: MEMBER, year: 2026 }).size, 0);
    });
});

describe('the position a manager reads', () => {
    test('taken is on or before today, booked is after — and TODAY counts as taken', () => {
        // The boundary is the whole reason the date is a parameter. Reading a clock instead would
        // make this case untestable, which is how a boundary goes wrong unnoticed.
        const [d1, d2, d3] = WORKED;
        const p = alPosition({ overrides: [al(d1), al(d2), al(d3)], member: MEMBER, year: 2026, todayStr: d2 });
        assert.equal(p.taken, 2, 'd1 and d2 — today is taken, not booked');
        assert.equal(p.booked, 1);
    });

    test('remaining subtracts BOTH, and goes negative rather than clamping', () => {
        // An over-booked member is a real state the banner renders as "N over limit". Clamping at
        // zero would hide it behind a calm "Limit reached".
        const p = alPosition({ overrides: WORKED.map(al), member: MEMBER, year: 2026, todayStr: WORKED[0] });
        assert.equal(p.remaining, p.entitlement - p.taken - p.booked);

        const many = datesWhere('2026-01-05', false, p.entitlement + 2).map(al);
        const p2 = alPosition({ overrides: many, member: MEMBER, year: 2026, todayStr: '2026-01-01' });
        assert.equal(p2.remaining, -2, 'two days over must report as -2, not 0');
    });

    test('BOTH halves of the projection ask the same question', () => {
        // `projectAnnualLeaveOverage` adds new days to existing ones. Filtering only the existing
        // set — which is what fixing one call site alone produces — makes a rest day already on
        // record free while the identical day being booked now is not, and the member meets a
        // confirm bar for leave they are not spending.
        const existing = countedAlDates({ overrides: [al(RESTED[0])], member: MEMBER, year: 2026 });
        assert.equal(existing.size, 0, 'existing rest-day AL is free');
        assert.equal(consumesEntitlement(MEMBER, RESTED[0]), false, 'and so is the same day being booked');
        assert.equal(consumesEntitlement(MEMBER, WORKED[0]), true);
        assert.equal(consumesEntitlement(MEMBER, '2026-03-01'), false, 'a Sunday, on both sides');
        assert.equal(consumesEntitlement(null, WORKED[0]), false);
        assert.equal(consumesEntitlement(MEMBER, ''), false);
    });

    test('leave dated before the member joined never counts — via the rest-day rule, not its own', () => {
        // The calendar added an explicit start-date test at v17.41 because ITS balance disagreed
        // with ITS grid; it had no rest-day test. Here such a check would be dead code, and this
        // test exists to pin the MECHANISM that makes it dead: `getBaseShift` returns 'RD' before a
        // member's startDate. If that ever stops being true, this fails and names the reason —
        // which a redundant `isBeforeMemberStart` guard never could, because nothing can kill it.
        const joiner = teamMembers.find(m => m.startDate && !m.hidden);
        assert.ok(joiner, 'fixture needs a member with a startDate');
        const before = formatISO(new Date(joiner.startDate.getTime() - 14 * 86_400_000));

        assert.equal(getBaseShift(joiner, parseISODate(before)), 'RD',
            'the mechanism: pre-start days are suppressed to RD, which is what excludes them');
        assert.equal(consumesEntitlement(joiner, before), false);
        const got = countedAlDates({
            overrides: [{ memberName: joiner.name, type: 'annual_leave', date: before }],
            member: joiner, year: before.slice(0, 4),
        });
        assert.equal(got.size, 0, 'and the set builder agrees, because it asks the same predicate');
    });

    test('the banner and the cap check now count the SAME days', () => {
        // The divergence itself, pinned. Before this module the banner had neither the rest-day test
        // nor a shared implementation, so these two totals could differ with nothing to notice.
        const overrides = [...RESTED.map(al), ...WORKED.map(al), al('2026-03-01')];
        const capChecksAgainst = countedAlDates({ overrides, member: MEMBER, year: 2026 });
        const banner = alPosition({ overrides, member: MEMBER, year: 2026, todayStr: '2026-06-01' });
        assert.equal(banner.taken + banner.booked, capChecksAgainst.size);
        assert.equal(capChecksAgainst.size, WORKED.length, 'and both drop the rest days and the Sunday');
    });
});

/**
 * ── THE SWAPPED DAY (v21.55) ────────────────────────────────────────────────────────────────────
 *
 * A swap moves a member's CONTRACTED day onto a date the rotating roster calls a rest day. The two
 * halves of the app used to answer that differently — `isWorkingDate` (which decides what gets
 * WRITTEN) reads the override, `consumesEntitlement` (which decides what it COSTS) read only the
 * base roster — so booking leave on a swapped-in day wrote the AL and charged nothing. Free leave,
 * silently, with the banner and the save path agreeing on the wrong figure because both asked the
 * base roster.
 *
 * Two of these cases pull in OPPOSITE directions and that is the whole design: `shift` and `rdw`
 * are indistinguishable to "is somebody at work?" and are opposites to "did this cost a day?".
 * A fix that reused `WORKED_OVERRIDE_TYPES` would pass every test above and charge a member a day
 * of annual leave for declining overtime.
 *
 * CONFIRMED BY THE OWNER, 26 Aug 2026 (VAL-AL-001 — an inference until then, and the reason this
 * block existed on reasoning rather than policy). The operational answer is NARROWER than the rule
 * these tests pin: leave reaches a rest day only where a member SWAPPED working days and then books
 * the swapped-in day off. The `rdw` case below therefore guards a path the roster office does not
 * use — and is kept anyway, because without it the day falls through to the base roster, which
 * calls it rest and would charge for declining overtime.
 */
describe('the swapped day — a day the base roster gets wrong', () => {
    // Deliberately NO replacedValue field: no write path has ever produced one and the rules
    // would refuse it — a fixture carrying it certifies behaviour production data can never have
    // (the v21.56 sweep found the first cut of these tests doing exactly that).
    const withUnder = (date, replacedType) => new Map([[date, {
        memberName: MEMBER.name, type: 'annual_leave', value: 'AL', date, replacedType,
    }]]);

    test('a swapped-IN day costs a day, though the base roster calls it rest', () => {
        // The shipped bug: AL written, nothing charged.
        assert.equal(consumesEntitlement(MEMBER, RESTED[0], withUnder(RESTED[0], 'shift')), true);
    });

    test('but OVERTIME on the same rest day still costs nothing', () => {
        // The opposite direction, and the reason `rdw` is not in CONTRACTED_WORK_TYPES: declining
        // overtime you volunteered for is not taking leave. Owner-confirmed as a path that does not
        // arise in practice (see the block header) — which makes this a guard, not a workflow.
        assert.equal(consumesEntitlement(MEMBER, RESTED[0], withUnder(RESTED[0], 'rdw')), false);
    });

    test('a swapped-OUT day costs nothing, though the base roster calls it worked', () => {
        // From the TYPE alone — a correction's value is pinned to 'RD' by the rules, and no write
        // path preserves the replaced VALUE, so the type must be enough or this rule is dead code.
        assert.equal(
            consumesEntitlement(MEMBER, WORKED[0], withUnder(WORKED[0], 'correction')), false);
    });

    test('leave recorded over an ABSENCE still costs a day on a working date', () => {
        // `sick` says nothing about the contract, so it must answer "unknown" and let the base
        // roster decide. Returning false for it would be this same bug in a new place.
        assert.equal(consumesEntitlement(MEMBER, WORKED[0], withUnder(WORKED[0], 'sick')), true);
    });

    test('a re-save keeps the original context, so a day cannot stop costing on the second Save', () => {
        // nextReplacedType inherits when the type is unchanged; this pins the read side of that.
        assert.equal(consumesEntitlement(MEMBER, RESTED[0], withUnder(RESTED[0], 'shift')), true);
        assert.equal(consumesEntitlement(MEMBER, RESTED[0], withUnder(RESTED[0], 'annual_leave')),
            false, 'and an AL that lost its context falls back to the base roster, not to true');
    });

    test('EVERY AL written before v21.55 counts exactly as it did', () => {
        // The fallback is what makes this shippable without a migration: no replacedType anywhere
        // ⇒ the base roster decides ⇒ every existing balance is unchanged on the day it deploys.
        const noInfo = (d) => new Map([[d, { memberName: MEMBER.name, type: 'annual_leave', value: 'AL', date: d }]]);
        for (const d of WORKED) assert.equal(consumesEntitlement(MEMBER, d, noInfo(d)), true, d);
        for (const d of RESTED) assert.equal(consumesEntitlement(MEMBER, d, noInfo(d)), false, d);
        // …and with no map at all, which is how three of the four call sites used to ask.
        assert.equal(consumesEntitlement(MEMBER, WORKED[0]), true);
        assert.equal(consumesEntitlement(MEMBER, RESTED[0]), false);
    });

    test('countedAlDates reads replacedType off the AL documents themselves', () => {
        const got = countedAlDates({
            overrides: [
                { ...al(RESTED[0]), replacedType: 'shift' },   // swapped in  → counts
                { ...al(RESTED[1]), replacedType: 'rdw' },     // overtime    → does not
                al(RESTED[2]),                                  // no context  → base says rest
                al(WORKED[0]),                                  // plain working day
            ],
            member: MEMBER, year: 2026,
        });
        assert.deepEqual([...got].sort(), [RESTED[0], WORKED[0]].sort());
    });
});

describe('the chain survives passing through an absence (v21.56)', () => {
    test('swap → sick → AL still costs a day', () => {
        // Two routine operations: the member swapped in, went off sick, and the day was later
        // reclassified as leave. Recording `sick` as what the AL replaced would discard the
        // `shift` underneath it — and `sick` carries no contract information, so the day fell
        // back to the base roster and the leave went free.
        const m = new Map([[RESTED[0], {
            memberName: MEMBER.name, type: 'annual_leave', value: 'AL',
            date: RESTED[0], replacedType: 'shift',
        }]]);
        assert.equal(consumesEntitlement(MEMBER, RESTED[0], m), true);
    });
});

describe('one winner per date (v21.56)', () => {
    test('an orphan AL beside a NEWER non-AL winner does not count', () => {
        // Two-device / offline-retry duplicates are a real population (the v16.23 lightbox fix
        // names them). The date's WINNER is the correction, so the day is not leave at all —
        // counting the orphan made the banner disagree with the calendar lightbox, which resolves
        // winners first.
        const got = countedAlDates({
            overrides: [
                { memberName: MEMBER.name, type: 'annual_leave', value: 'AL', date: WORKED[0],
                  source: 'manual', createdAt: new Date(2026, 0, 1) },
                { memberName: MEMBER.name, type: 'correction', value: 'RD', date: WORKED[0],
                  source: 'manual', createdAt: new Date(2026, 5, 1) },
            ],
            member: MEMBER, year: 2026,
        });
        assert.equal(got.size, 0);
    });

    test('of two duplicate AL docs, the NEWER answers — not fetch order', () => {
        const older = { memberName: MEMBER.name, type: 'annual_leave', value: 'AL', date: RESTED[0],
            source: 'manual', createdAt: new Date(2026, 0, 1) };                       // no context
        const newer = { memberName: MEMBER.name, type: 'annual_leave', value: 'AL', date: RESTED[0],
            source: 'manual', createdAt: new Date(2026, 5, 1), replacedType: 'shift' }; // swapped in
        const a = countedAlDates({ overrides: [older, newer], member: MEMBER, year: 2026 });
        const b = countedAlDates({ overrides: [newer, older], member: MEMBER, year: 2026 });
        assert.equal(a.size, 1, 'the newer doc carries the swap, so the day costs');
        assert.equal(b.size, 1, 'and the answer must not depend on iteration order');
    });
});
