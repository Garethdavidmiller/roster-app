// @ts-check
/**
 * team-week-start.test.mjs — WHICH WEEK the team grid opens on, by what a wrong answer costs.
 *
 * The two directions are not symmetrical, and the shipped defect was the first one.
 *
 * MOVING A READER WHO DID NOT ASK TO MOVE is silent: the grid renders perfectly, every shift on it
 * is real, and nothing says the surface changed the subject. Somebody checking December's cover
 * tapped Team View and read THIS week's roster believing it was December's — the report that
 * produced this rule. A wrong answer here is not an error state, it is a confident one.
 *
 * REFUSING TO MOVE is the mistake a careless fix makes in the other direction: opening on the 1st
 * for a reader who is on the current month drags them off today for no reason, which is the same
 * complaint with the sign flipped and affects nearly every reader nearly every time.
 *
 * `today` is injected, so the clock branch is tested at its boundary rather than whenever the suite
 * happens to run. Part of test:hygiene.
 *
 * Teeth-verified five ways. The dep guard is the one worth recording: weakened to a bare `!displayed`
 * check, a malformed month produces `new Date(2026, undefined, 1)` — an INVALID DATE, which flows
 * into the grid's week state and crashes the test reporter outright rather than failing an
 * assertion. It is a real guard, not defensive decoration.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { weekStartForMonth } from './calendar-team-view.js';

/** Local midnight, so an assertion can compare against what the rule returns. */
const at = (y, m, d) => { const x = new Date(y, m, d); x.setHours(0, 0, 0, 0); return x; };

describe('moving a reader who did not ask to move', () => {
    test('a month that is not this one opens on ITS first week, not on today', () => {
        const today = at(2026, 8, 11);                       // Fri 11 Sep 2026
        const got   = weekStartForMonth({ month: 11, year: 2026 }, today);
        // 1 Dec 2026 is a Tuesday, so its week starts Sun 29 Nov — the calendar grid's own first
        // row for December, leading days included. Asserted as a DATE, not an offset.
        assert.deepEqual(got, at(2026, 10, 29));
    });

    test('a month in another YEAR moves too — the year is half the question', () => {
        const today = at(2026, 8, 11);
        // Same month NUMBER as today, different year: a rule comparing only the month would
        // answer "this week" and strand the reader a year away.
        assert.deepEqual(weekStartForMonth({ month: 8, year: 2027 }, today), at(2027, 7, 29));
        assert.deepEqual(weekStartForMonth({ month: 8, year: 2025 }, today), at(2025, 7, 31));
    });

    test('the week it opens on CONTAINS the 1st', () => {
        // Swept rather than spot-checked: the property is what matters, and one hand-picked month
        // can be right by luck. Every month of a year, against a fixed today.
        const today = at(2026, 8, 11);
        for (let m = 0; m < 12; m++) {
            if (m === 8) continue;                            // today's own month — other block
            const start = weekStartForMonth({ month: m, year: 2026 }, today);
            const end   = new Date(start); end.setDate(end.getDate() + 6);
            const first = at(2026, m, 1);
            assert.ok(start <= first && first <= end, `${m}: week ${start} – ${end} must contain 1st`);
            assert.equal(start.getDay(), 0, `${m}: must start on a Sunday`);
            assert.equal(start.getHours(), 0, `${m}: must be local midnight`);
        }
    });
});

describe('refusing to move', () => {
    test('the month containing today opens on TODAY\'s week, not on the 1st', () => {
        const today = at(2026, 8, 11);                       // Fri 11 Sep 2026 → week of Sun 6 Sep
        assert.deepEqual(weekStartForMonth({ month: 8, year: 2026 }, today), at(2026, 8, 6));
        // And that is NOT the month's first week, or the assertion above proves nothing.
        assert.notDeepEqual(at(2026, 8, 6), weekStartForMonth({ month: 7, year: 2026 }, today));
    });

    test('a today in a week that STRADDLES the month boundary still opens on today\'s week', () => {
        // Tue 1 Sep 2026 — its week starts Sun 30 Aug, in the PREVIOUS month. The rule must key on
        // the displayed month matching today's, never on the returned week's month.
        const today = at(2026, 8, 1);
        assert.deepEqual(weekStartForMonth({ month: 8, year: 2026 }, today), at(2026, 7, 30));
    });

    test('no displayed month is the old answer — a caller that cannot say has not asked', () => {
        const today = at(2026, 8, 11);
        for (const bad of [null, undefined, {}, { month: 8 }, { year: 2026 }, { month: '8', year: 2026 }]) {
            assert.deepEqual(weekStartForMonth(/** @type {any} */ (bad), today), at(2026, 8, 6),
                `${JSON.stringify(bad)} must fall back to today's week`);
        }
    });
});
