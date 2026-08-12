/**
 * links-default-targets.test.mjs — the table the generator starts from.
 * Run: node --test links-default-targets.test.mjs   (no mocks; part of `npm run test:hygiene`)
 *
 * ── WHY THIS IS TESTED AT ALL, GIVEN IT IS A LITERAL ────────────────────────────────────────────
 *
 * A hand-written table has no computation to get wrong, which is exactly why it needs pinning: its
 * properties are true by construction and stay true only as long as nobody edits it. Every claim
 * below is a claim the module HEADER makes and the workspace copy REPEATS — four openers, three
 * closers, the contracted week, 4.2 days — and each of them survives an edit that breaks it,
 * silently and in prose, for as long as nobody re-runs the arithmetic by hand.
 *
 * The one that matters most is the contract. Since v20.98 the generator refuses a table that does
 * not pay the contracted week EXACTLY, so a default that drifts by one duty does not render
 * slightly wrong — it makes the Generate button refuse on a page the designer has not touched,
 * which is the failure this default was introduced to remove.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    buildDefaultTargets, DEFAULT_COVER_WEEKS, DEFAULT_SHIFT_TIMES,
    OPENING_TURNS, CLOSING_TURNS, TARGET_DAYS_PER_WEEK,
} from './links-default-targets.js';
import {
    generateLink, weeklyHours, targetExSundayMinutes,
    CONTRACTED_HOURS_PER_WEEK, ROTATING_LINES, startMinutes, endMinutesAbs,
} from './links-design.js';
import { DEFAULT_WINDOW, windowMinutes } from './links-window.js';
import { buildRosterTargets } from './links-seed.js';

const { slots, spareLines } = buildDefaultTargets();
const WORKING = ROTATING_LINES - DEFAULT_COVER_WEEKS;
const OPEN = windowMinutes(DEFAULT_WINDOW.monSat.start);
const CLOSE = windowMinutes(DEFAULT_WINDOW.monSat.end);

/** Duties of a given day class in the table, expanded one entry per person. */
const dutiesOn = (cls) => slots.flatMap(s => Array(s[cls]).fill(s.time));

describe('the contract — the property that decides whether the card works on arrival', () => {
    test('the table pays the contracted week EXACTLY at its own cover-week count', () => {
        assert.equal(targetExSundayMinutes(slots), WORKING * CONTRACTED_HOURS_PER_WEEK * 60);
    });

    test('so the generator BUILDS from it, untouched, which the roster seed cannot', () => {
        // The whole reason this module exists. Asserted through `generateLink` rather than by
        // re-checking the minutes, because "the arithmetic is right" and "the button works" are
        // different claims and only the second one is what a designer meets.
        const r = generateLink({ slots, spareLines, lines: ROTATING_LINES });
        assert.ok(r.patterns, `refused: ${r.reason}`);
        assert.equal(weeklyHours(r.patterns, ROTATING_LINES).exSunday, CONTRACTED_HOURS_PER_WEEK);
    });

    test('the cover-week count is not free — one either side is refused, in opposite directions', () => {
        // The header calls the cover-week count the third term in the equation rather than a
        // preference. This is that claim: the same duty over one fewer working line overshoots, and
        // over one more falls short. Both are pinned so a future edit to `DEFAULT_COVER_WEEKS`
        // alone — leaving the table as it is — fails here rather than in front of a designer.
        assert.equal(generateLink({ slots, spareLines: spareLines + 1, lines: ROTATING_LINES }).reason,
            'over-hours', 'one more cover week leaves fewer lines to pay the same work');
        assert.equal(generateLink({ slots, spareLines: spareLines - 1, lines: ROTATING_LINES }).reason,
            'short-hours', 'one fewer cover week spreads the same work over more lines');
    });
});

describe('what the owner asked for', () => {
    test('four turns open the station, on Mon–Fri AND on Saturday', () => {
        for (const cls of ['weekday', 'sat']) {
            assert.equal(dutiesOn(cls).filter(t => startMinutes(t) === OPEN).length, OPENING_TURNS,
                `${cls} does not put ${OPENING_TURNS} people on at the open`);
        }
    });

    test('three turns run through to the close, on both', () => {
        for (const cls of ['weekday', 'sat']) {
            assert.equal(dutiesOn(cls).filter(t => endMinutesAbs(t) === CLOSE).length, CLOSING_TURNS,
                `${cls} does not run ${CLOSING_TURNS} people to the close`);
        }
    });

    test('a working line averages about 4.2 days Mon–Sat', () => {
        // "Roughly", to a tenth — the figure is a mean over 19 lines and 80 duties, so it can only
        // land on multiples of 1/19 and an exact 4.2 is not reachable. A tenth is tight enough that
        // adding or removing a single duty (0.05) shows up within two.
        const perWeek = (5 * dutiesOn('weekday').length + dutiesOn('sat').length) / WORKING;
        assert.ok(Math.abs(perWeek - TARGET_DAYS_PER_WEEK) < 0.1,
            `${perWeek.toFixed(2)} days a week is not roughly ${TARGET_DAYS_PER_WEEK}`);
    });

    test('and that is the SAME statement as the contract, which is why both hold at once', () => {
        // 35h over 4.2 days is a mean duty of 8h20. Stated as its own case because it is the step
        // that makes the table solvable rather than over-constrained, and a reader who has not seen
        // it will try to satisfy the two requirements separately.
        const all = [...Array(5).fill(dutiesOn('weekday')).flat(), ...dutiesOn('sat')];
        const mean = targetExSundayMinutes(slots) / all.length;
        assert.ok(Math.abs(mean - (CONTRACTED_HOURS_PER_WEEK * 60) / TARGET_DAYS_PER_WEEK) < 5,
            `mean duty ${mean} min is not 35h / ${TARGET_DAYS_PER_WEEK}`);
    });
});

describe('the shape of the day', () => {
    test('every Mon–Sat duty sits inside the operating window', () => {
        // A duty starting before the station opens or finishing after it closes is not a design
        // decision, it is a typo — and the heat map would draw it as cover in an hour the window
        // says is shut, which is the one thing `links-demand.js` is written to keep believable.
        for (const cls of ['weekday', 'sat']) {
            for (const t of dutiesOn(cls)) {
                assert.ok(startMinutes(t) >= OPEN, `${t} starts before the ${cls} open`);
                assert.ok(endMinutesAbs(t) <= CLOSE, `${t} finishes after the ${cls} close`);
            }
        }
    });

    test('NO DUTY IS SHORTER THAN SEVEN HOURS OR LONGER THAN NINE AND A HALF', () => {
        // The mean is fixed by the contract, so the only way to get a wrong shape past the gate is
        // at the extremes: two very long turns paid for by several very short ones averages
        // correctly and is not a link anyone would work. The live roster runs 7h15 to 9h10; this
        // allows a little either side and refuses anything beyond it.
        for (const cls of ['weekday', 'sat']) {
            for (const t of dutiesOn(cls)) {
                const mins = endMinutesAbs(t) - startMinutes(t);
                assert.ok(mins >= 420 && mins <= 570, `${t} is ${mins} minutes — outside 7h–9h30`);
            }
        }
    });

    test('the openers do not all walk off at the same minute, nor the closers all arrive at one', () => {
        // Staggering is the reason the openers carry four different lengths rather than one. A
        // single finish time makes the middle of the day a cliff rather than a handover, and it is
        // invisible in every total on the page — the hours, the headcount and the contract are all
        // identical either way.
        for (const cls of ['weekday', 'sat']) {
            const ends = dutiesOn(cls).filter(t => startMinutes(t) === OPEN).map(endMinutesAbs);
            assert.equal(new Set(ends).size, ends.length, `${cls} openers share a finish time`);
            const starts = dutiesOn(cls).filter(t => endMinutesAbs(t) === CLOSE).map(startMinutes);
            assert.equal(new Set(starts).size, starts.length, `${cls} closers share a start time`);
        }
    });

    test('Saturday is staffed in proportion to Saturday, not to a weekday', () => {
        // The header claims the Saturday headcount landed on the service rather than being chosen.
        // If a later edit rounds Saturday up to match Mon–Fri, this is what says so.
        const ratio = dutiesOn('sat').length / dutiesOn('weekday').length;
        assert.ok(ratio > 0.6 && ratio < 0.85, `Saturday is ${(ratio * 100).toFixed(0)}% of a weekday`);
    });
});

describe('the mechanics', () => {
    test('every call returns a FRESH, mutable table', () => {
        // The generator card edits these objects in place — a typed count assigns `slot.weekday`,
        // the ✕ button splices the array. Handing out the frozen module-level table would make the
        // first keystroke a silent no-op in production and a TypeError under strict mode.
        const a = buildDefaultTargets(), b = buildDefaultTargets();
        assert.notEqual(a.slots, b.slots);
        assert.notEqual(a.slots[0], b.slots[0]);
        a.slots[0].weekday = 99;
        a.slots.splice(1, 1);
        assert.notEqual(b.slots[0].weekday, 99, 'an edit to one copy reached another');
        assert.equal(buildDefaultTargets().slots.length, b.slots.length, 'a splice shortened the source');
    });

    test('no day asks for more people than there are working lines', () => {
        // `generateLink` refuses with `over-capacity` before it looks at hours, so this would be a
        // refusal reported as the wrong problem.
        for (const cls of ['weekday', 'sat', 'sun']) {
            assert.ok(dutiesOn(cls).length <= WORKING,
                `${cls} asks for ${dutiesOn(cls).length} of ${WORKING} working lines`);
        }
    });

    test('DEFAULT_SHIFT_TIMES lists every time in the table, and nothing else', () => {
        // The coordinator feeds this list into the shift dropdowns, so a time in the table that is
        // missing here renders as a value the designer can see and cannot re-select.
        assert.deepEqual([...DEFAULT_SHIFT_TIMES].sort(), [...new Set(slots.map(s => s.time))].sort());
    });

    test('Sunday IS the live roster\'s column, entry for entry', () => {
        // The header says Sunday is carried rather than designed, and this compares it against the
        // roster seed rather than against a list written out here — so it is the same fact, read
        // from the same place, not a second copy that can drift.
        //
        // Written as an equality on the whole column, which is the correction that matters: the
        // first version of this test only asserted that Sunday was non-empty and that every time it
        // named was a real roster time, and a mutation zeroing ONE of the four rows sailed through
        // it. Sunday is outside the contract measure, so nothing else in this file — or in the app —
        // would have said a word: the heat map would simply show three fewer people on a Sunday.
        const sundayOf = (/** @type {{time: string, sun: number}[]} */ table) => Object.fromEntries(
            table.filter(s => s.sun > 0).map(s => [s.time, s.sun]));
        assert.deepEqual(sundayOf(slots), sundayOf(buildRosterTargets().slots));
    });
});
