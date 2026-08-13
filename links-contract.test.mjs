/**
 * links-contract.test.mjs — the generator will not produce a link that pays the wrong hours.
 * Run: node --test links-contract.test.mjs   (no mocks; part of `npm run test:hygiene`)
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────────────────────────
 *
 * Owner, Aug 2026: a generated link must average EXACTLY the contracted week ex-Sunday, and one
 * that does not must not be generated at all. Before v20.98 a shortfall was REPORTED — the
 * Design-checks row, the generator's totals line and the summary chip all said "6h 09m under the
 * 35h contract" — and the design was produced anyway. Reporting is not refusing, and a design that
 * exists gets saved, compared, printed and taken into a room.
 *
 * v20.98 refused a shortfall and allowed a surplus. **v20.99 refuses both** (owner), and the
 * correction is worth keeping in view: a surplus looked like the benign direction because the hours
 * are payable, but a design carrying one has committed the rotation to permanent overtime that was
 * never declared or agreed. So the rule is an EQUALITY, and the consequence — that an equality over
 * whole duties is sometimes unsatisfiable — is asserted below rather than softened with a
 * tolerance, which would put the app straight back to producing a design that is quietly wrong.
 *
 * ── WHY THIS SUITE IS SEPARATE FROM links-design.test.mjs ───────────────────────────────────────
 *
 * That file's fixtures describe a rotation SHAPE and deliberately opt out of this rule (see the
 * note above `SPARE_LINES` there). Keeping the rule's own tests here means the opt-out cannot
 * quietly become the thing under test — and the last case below is a static guard that the APP
 * never passes it, which is the only reason the opt-out is safe to exist.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    generateLink, generatePatterns, weeklyHours, targetExSundayMinutes,
    CONTRACTED_HOURS_PER_WEEK, ROTATING_LINES,
} from './links-design.js';
import { buildRosterTargets } from './links-seed.js';

/**
 * A target table asking for exactly `duties` duties a week, spread over Mon–Sat.
 *
 * The duty is 8h 45m, so FOUR of them are one contracted week (4 x 525 min = 2100 = 35h). That is
 * what makes these fixtures adjustable: a 7-hour Mon–Fri table also pays 35h, but only by working
 * every weekday, which forces the headcount to equal the working lines and leaves no room to vary
 * them — and varying them is the third lever the rule is meant to expose.
 */
const DUTY_MIN = 525;                        // 06:00-14:45
function tableOf(duties) {
    return [{ time: '06:00-14:45', weekday: Math.floor(duties / 5), sat: duties % 5, sun: 0 }];
}
/** The table that pays `working` lines exactly the contracted week, plus `extra` duties. */
const contractExact = (working, extra = 0) => tableOf(working * 4 + extra);

describe('targetExSundayMinutes — what a table actually asks for', () => {
    test('it counts weekdays five times and Saturday once', () => {
        assert.equal(targetExSundayMinutes([{ time: '07:00-14:00', weekday: 1, sat: 1, sun: 0 }]),
            7 * 60 * 6);
    });

    test('SUNDAY TARGETS ARE DISCARDED — they can never help a design reach contract', () => {
        // The failure this prevents is a flattering one: a link that underpays could be made to
        // look compliant by rostering more Sundays, which are not contracted time at all. It is the
        // same exclusion `weeklyHours` makes, arriving from the targets instead of the patterns.
        assert.equal(targetExSundayMinutes([{ time: '07:00-14:00', weekday: 0, sat: 0, sun: 5 }]), 0);
    });

    test('an unreadable time is null, never a silent zero', () => {
        // Zero would read as "these targets ask for nothing" and the caller would refuse for the
        // wrong reason, sending a designer to look at headcounts over a malformed time.
        assert.equal(targetExSundayMinutes([{ time: 'half seven', weekday: 1, sat: 0, sun: 0 }]), null);
    });
});

describe('the generator refuses to underpay', () => {
    const LINES = 24, SPARE = 5, WORKING = LINES - SPARE;

    test('targets that pay exactly the contract are BUILT', () => {
        const r = generateLink({ slots: contractExact(WORKING), spareLines: SPARE, lines: LINES });
        assert.ok(r.patterns, `refused: ${r.reason}`);
        const h = weeklyHours(r.patterns, LINES);
        assert.equal(h.exSunday, CONTRACTED_HOURS_PER_WEEK, 'and the design it built really does pay it');
        assert.equal(h.workingLines, WORKING);
    });

    test('one minute short is refused — "exactly" is meant literally', () => {
        // The comparison is in whole minutes on both sides, so there is no rounding to hide in.
        // A tolerance here is how "exactly 35" becomes "about 35", and about-35 is what the app
        // already reported for four releases while producing the design anyway.
        // ONE MINUTE, exactly: every duty but one is the full 8h 45m, and a single duty is 8h 44m.
        const exact = contractExact(WORKING)[0];
        const slots = [
            { ...exact, sat: exact.sat - 1 },
            { time: '06:00-14:44', weekday: 0, sat: 1, sun: 0 },
        ];
        const r = generateLink({ slots, spareLines: SPARE, lines: LINES });
        assert.equal(r.patterns, null);
        assert.equal(r.reason, 'short-hours');
        assert.equal(r.needMinutes - r.askedMinutes, 1, 'short by one minute and refused for it');
    });

    test('OVER the contract is refused too — the rule is an equality, not a floor (v20.99)', () => {
        // v20.98 allowed a surplus, reasoning that those hours get paid as overtime or absorbed by
        // adding lines. Owner, Aug 2026: no. A link IS the contracted week, and a design carrying a
        // permanent surplus has quietly committed the rotation to overtime nobody agreed to — which
        // is the same class of fault as a shortfall, arriving from the other side.
        const r = generateLink({ slots: contractExact(WORKING, 4), spareLines: SPARE, lines: LINES });
        assert.equal(r.patterns, null);
        assert.equal(r.reason, 'over-hours');
        assert.equal(r.askedMinutes - r.needMinutes, 4 * DUTY_MIN, 'over by exactly the four extra duties');
        assert.equal(r.working, WORKING);
    });

    test('one minute OVER is refused, exactly as one minute short is', () => {
        // The mirror of the case above it. Written out rather than folded into a loop because the
        // asymmetry that used to exist here was a deliberate decision, and a single case reading
        // "both directions" would not show that BOTH boundaries are now tight.
        const exact = contractExact(WORKING)[0];
        const slots = [
            { ...exact, sat: exact.sat - 1 },
            { time: '06:00-14:46', weekday: 0, sat: 1, sun: 0 },   // one minute LONGER
        ];
        const r = generateLink({ slots, spareLines: SPARE, lines: LINES });
        assert.equal(r.reason, 'over-hours');
        assert.equal(r.askedMinutes - r.needMinutes, 1);
    });

    test('AN EXACT FIT IS NOT ALWAYS REACHABLE, and the refusal is the rule working', () => {
        // The cost of an equality over whole duties, pinned so nobody discovers it as a mystery.
        // Nineteen working lines need 39,900 minutes; an 8-hour duty is 480, and 39,900/480 is not a
        // whole number — so with ONLY that shift time in the table, every possible target set is
        // refused, one side or the other. Both neighbours are asserted, because the interesting
        // claim is not "this one fails" but "there is nothing between them".
        const eight = (n) => [{ time: '06:00-14:00', weekday: Math.floor(n / 5), sat: n % 5, sun: 0 }];
        const need = WORKING * CONTRACTED_HOURS_PER_WEEK * 60;
        const n = Math.floor(need / 480);                       // 83 duties = 39,840
        assert.ok(n * 480 < need && (n + 1) * 480 > need, 'fixture premise: no whole number of duties fits');
        assert.equal(generateLink({ slots: eight(n), spareLines: SPARE, lines: LINES }).reason, 'short-hours');
        assert.equal(generateLink({ slots: eight(n + 1), spareLines: SPARE, lines: LINES }).reason, 'over-hours');
    });

    test('the refusal carries the SIZE of the gap, which is its only actionable content', () => {
        // A caller told merely "short" cannot say by how much, and the gap is the one number a
        // designer can act on: it converts "you are short" into "you need this many more duties".
        const r = generateLink({ slots: contractExact(WORKING, -1), spareLines: SPARE, lines: LINES });
        assert.equal(r.reason, 'short-hours');
        assert.equal(r.needMinutes, WORKING * CONTRACTED_HOURS_PER_WEEK * 60);
        assert.equal(r.needMinutes - r.askedMinutes, DUTY_MIN, 'exactly the one duty that is missing');
        assert.equal(r.working, WORKING);
    });

    test('THE COVER-WEEK COUNT MOVES THE TARGET IN BOTH DIRECTIONS', () => {
        // The gate is per working line, so the shape is a real lever: the same duty spread over
        // fewer working lines pays each of them more. It is the third option each refusal message
        // names — and since v20.99 it can overshoot as easily as it can fall short, so the same
        // table now fails on BOTH sides of the count it was built for. That is the honest picture:
        // cover weeks are not a way to rescue a table, they are part of what the table has to match.
        const slots = contractExact(WORKING);
        assert.equal(generateLink({ slots, spareLines: SPARE - 1, lines: LINES }).reason, 'short-hours',
            'one fewer cover week means one more mouth to feed from the same work');
        assert.equal(generateLink({ slots, spareLines: SPARE + 1, lines: LINES }).reason, 'over-hours',
            'one more cover week leaves the rest above contract');
    });

    test('`generatePatterns` inherits the refusal — it is the same door', () => {
        // The thin wrapper keeps the old signature, so a caller that never learned about the gate
        // must not be able to walk round it.
        assert.equal(generatePatterns({ slots: contractExact(WORKING, -1), spareLines: SPARE, lines: LINES }), null);
    });

    test('MIXED SHIFT LENGTHS are summed per slot — the roster has nine of them, not one', () => {
        // The fixtures above use ONE duty length, which is convenient and could hide the assumption
        // that matters most here: the live roster runs 18 shift times of NINE distinct lengths, from
        // 7h 15m to 9h 10m. A gate that counted DUTIES rather than minutes would pass a table of
        // short turns and fail a table of long ones, both by the same margin.
        //
        // This table is five real roster times in five different lengths, summing to exactly the
        // contracted week across 19 working lines.
        const mixed = [
            { time: '06:20-13:35', weekday: 0, sat: 4, sun: 0 },   // 7h 15m
            { time: '06:20-14:20', weekday: 1, sat: 2, sun: 0 },   // 8h 00m
            { time: '08:00-16:30', weekday: 1, sat: 4, sun: 0 },   // 8h 30m
            { time: '15:15-23:55', weekday: 7, sat: 3, sun: 0 },   // 8h 40m
            { time: '14:45-23:55', weekday: 3, sat: 4, sun: 0 },   // 9h 10m
        ];
        assert.equal(targetExSundayMinutes(mixed), WORKING * CONTRACTED_HOURS_PER_WEEK * 60,
            'fixture premise: five different lengths adding to the contracted week exactly');
        // `requireRest: false` — this fixture is about the MINUTES, and it staffs a 23:55 closer in
        // front of an 06:20 open on nearly every line, which no rearrangement can rest. The rest
        // gate is exercised on its own terms in links-design.test.mjs.
        assert.ok(generateLink({ slots: mixed, spareLines: SPARE, lines: LINES, requireRest: false }).patterns);

        // And the SAME NUMBER of duties, one of them ten minutes shorter, is refused. Duty count is
        // identical; only minutes moved. A duty-counting gate cannot tell these two apart.
        const trimmed = mixed.map(s => s.time === '06:20-14:20' ? { ...s, time: '06:20-14:10' } : s);
        const before = mixed.reduce((a, s) => a + 5 * s.weekday + s.sat, 0);
        const after = trimmed.reduce((a, s) => a + 5 * s.weekday + s.sat, 0);
        assert.equal(before, after, 'premise: the two tables ask for the same number of duties');
        const r = generateLink({ slots: trimmed, spareLines: SPARE, lines: LINES });
        assert.equal(r.reason, 'short-hours');
        assert.equal(r.needMinutes - r.askedMinutes, 10 * (5 * 1 + 2), 'ten minutes off seven duties');
    });

    test('THE LIVE SEED IS REFUSED AT the current rotation, which is the point of the feature', () => {
        // Not a fixture — the real roster's own duties. They pay 16 working lines exactly 35h, and
        // the December 2026 link widens to 24. The same work over more lines cannot reach contract,
        // and until v20.98 the generator produced that design without hesitating.
        const seed = buildRosterTargets();
        const r = generateLink({ slots: seed.slots, spareLines: seed.spareLines, lines: ROTATING_LINES });
        assert.equal(r.patterns, null);
        assert.equal(r.reason, 'short-hours');
        assert.ok(r.needMinutes > r.askedMinutes);
    });
});

describe('the opt-out is not a back door', () => {
    test('the APP never disables the contract gate', () => {
        // The only reason `requireContract` may exist. `links-design.test.mjs` passes it because its
        // fixtures describe a rotation shape rather than a week's work; if the coordinator ever
        // passed it, every real Generate would be ungated and nothing else would say so.
        const app = readFileSync(new URL('./links-app.js', import.meta.url), 'utf8');
        assert.equal(/requireContract/.test(app), false,
            'links-app.js mentions requireContract — the app must never opt out of the contract gate');
        // Same guard for the rest gate (v21.11), and for the same reason. It exists so construction
        // fixtures — several of which staff every line every day, which no arrangement can rest —
        // can still exercise the constructions. A design the app hands a designer is one somebody
        // could be rostered to, and there is no reading of that where 11h45 between turns is fine.
        assert.equal(/requireRest/.test(app), false,
            'links-app.js mentions requireRest — the app must never opt out of the minimum-rest gate');
    });

    test('and leaving it out is the SAFE default', () => {
        // A caller who has never heard of the flag gets the gate. Written as its own case because
        // the default is the whole protection: an unsafe default with a careful app would hold
        // exactly until the second call site.
        const slots = contractExact(19, -1);
        assert.equal(generateLink({ slots, spareLines: 5, lines: 24 }).reason, 'short-hours');
        assert.ok(generateLink({ slots, spareLines: 5, lines: 24, requireContract: false }).patterns,
            'the flag must still work, or the tests that rely on it are asserting nothing');
    });
});
