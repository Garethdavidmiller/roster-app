/**
 * links-contract.test.mjs — the generator will not produce a link that underpays.
 * Run: node --test links-contract.test.mjs   (no mocks; part of `npm run test:hygiene`)
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────────────────────────
 *
 * Owner, Aug 2026: a generated link must average the contracted week ex-Sunday, and one that falls
 * short must not be generated at all. Before v20.98 the shortfall was REPORTED — the Design-checks
 * row, the generator's totals line and the summary chip all said "6h 09m under the 35h contract" —
 * and the design was produced anyway. Reporting is not refusing, and a design that exists gets
 * saved, compared, printed and taken into a room.
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

    test('OVER the contract is allowed, and that asymmetry is deliberate', () => {
        // Surplus hours get paid as overtime or absorbed by adding lines — the design is workable,
        // and the Design-checks row already says it is over. Refusing it would block the ordinary
        // case of a link built to carry a known surplus. The instruction was "do not generate links
        // that fall SHORT", and that is the whole of it.
        const r = generateLink({ slots: contractExact(WORKING, 4), spareLines: SPARE, lines: LINES });
        assert.ok(r.patterns, `refused: ${r.reason}`);
        const h = weeklyHours(r.patterns, LINES);
        assert.ok(h.exSunday > CONTRACTED_HOURS_PER_WEEK, `expected over contract, got ${h.exSunday}`);
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

    test('MORE SPARE WEEKS can rescue the same targets, and fewer cannot', () => {
        // The gate is per working line, so the shape is a real lever: the same duty spread over
        // fewer working lines pays each of them more. This is the third option a designer has, and
        // it is the one the refusal message names alongside adding and lengthening duties.
        const slots = contractExact(WORKING);
        assert.equal(generateLink({ slots, spareLines: SPARE - 1, lines: LINES }).reason, 'short-hours',
            'one fewer cover week means one more mouth to feed from the same work');
        assert.ok(generateLink({ slots, spareLines: SPARE + 1, lines: LINES }).patterns,
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
        assert.ok(generateLink({ slots: mixed, spareLines: SPARE, lines: LINES }).patterns);

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
