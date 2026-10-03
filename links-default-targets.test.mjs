/**
 * links-default-targets.test.mjs — the table the generator starts from.
 * Run: node --test links-default-targets.test.mjs   (no mocks; part of `npm run test:hygiene`)
 *
 * ── WHY THIS IS TESTED AT ALL, GIVEN IT IS A LITERAL ────────────────────────────────────────────
 *
 * A hand-written table has no computation to get wrong, which is exactly why it needs pinning: its
 * properties are true by construction and stay true only as long as nobody edits it. Since v24.47
 * the claims are the OWNER'S 26-line rules (`docs/links-26/RULES.md`), one test per rule the table
 * can be held to — the 24-line suite pinned the shape of a table the app had designed itself, and
 * that table is gone (kept only as data, so a stale memory of it is recognised).
 *
 * The one that matters most is the contract. The generator refuses a table that does not pay the
 * contracted week EXACTLY, so a default that drifts by one duty does not render slightly wrong —
 * it makes the Generate button refuse on a page the designer has not touched, which is the failure
 * this default was introduced to remove.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    buildDefaultTargets, DEFAULT_COVER_WEEKS, DEFAULT_SHIFT_TIMES,
    OPENING_TURNS, CLOSING_TURNS, SATURDAY_CLOSING_TURNS, SATURDAY_TURNS, SUNDAY_TURNS,
    TARGET_DAYS_PER_WEEK, EVENING_TURNS_FROM_22,
} from './links-default-targets.js';
import {
    generateLink, weeklyHours, targetExSundayMinutes,
    CONTRACTED_HOURS_PER_WEEK, ROTATING_LINES, startMinutes, endMinutesAbs,
} from './links-design.js';
import { DEFAULT_WINDOW, windowMinutes } from './links-window.js';
import { DEC_2026_DEMAND } from './links-demand.js';
import { buildRosterTargets } from './links-seed.js';
import { sameTargetTable, isSupersededMemory } from './links-default-targets.js';

const { slots, spareLines } = buildDefaultTargets();
const WORKING = ROTATING_LINES - DEFAULT_COVER_WEEKS;

/** Each day class runs to its own window — Sunday's is genuinely different. */
const WINDOW_FOR = {
    weekday: DEFAULT_WINDOW.monSat,
    sat:     DEFAULT_WINDOW.monSat,
    sun:     DEFAULT_WINDOW.sun,
};
const DAY_CLASSES = /** @type {const} */ (['weekday', 'sat', 'sun']);

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

    test('Sunday sits OUTSIDE the contract, so the Sunday headcount cannot break it', () => {
        // The one property that makes a designed Sunday safe to carry in the same table: zero the
        // whole column, or double it, and the ex-Sunday minutes the gate reads are identical.
        // Without this, "add two more Sundays" (v21.01) would have been a contract question.
        const zeroed = slots.map(s => ({ ...s, sun: 0 }));
        assert.equal(targetExSundayMinutes(zeroed), targetExSundayMinutes(slots));
    });
});


describe('the 26-line rules (docs/links-26/RULES.md) — the table meets every one it can be held to', () => {
    const at = (/** @type {'weekday'|'sat'|'sun'} */ cls, /** @type {number} */ min) =>
        dutiesOn(cls).filter(t => startMinutes(t) <= min && endMinutesAbs(t) > min).length;

    test('26 lines and FIVE cover weeks — 21 working lines', () => {
        assert.equal(ROTATING_LINES, 26);
        assert.equal(spareLines, 5);
        assert.equal(WORKING, 21);
    });

    test('H3: 44,100 Monday-to-Saturday minutes — 21 working lines × 35h, exactly', () => {
        assert.equal(targetExSundayMinutes(slots), 44_100);
    });

    test('the ceiling: 219 contracted days a year or fewer (cover weeks count four days)', () => {
        const duties = 5 * dutiesOn('weekday').length + dutiesOn('sat').length;
        const days = (duties + 4 * spareLines) / ROTATING_LINES * 365 / 7;
        assert.ok(days <= 219, `${days.toFixed(1)} days a year is over the ceiling`);
        assert.equal(duties, 89);
    });

    test('S1/S2: at least four on at the open and three through to the close, every day', () => {
        for (const cls of DAY_CLASSES) {
            const open = windowMinutes(WINDOW_FOR[cls].start), close = windowMinutes(WINDOW_FOR[cls].end);
            assert.ok(dutiesOn(cls).filter(t => startMinutes(t) === open).length >= OPENING_TURNS, `${cls} open`);
            const closers = dutiesOn(cls).filter(t => endMinutesAbs(t) === close).length;
            assert.ok(closers >= CLOSING_TURNS, `${cls} close`);
        }
        assert.equal(dutiesOn('sat').filter(t => endMinutesAbs(t) === windowMinutes(WINDOW_FOR.sat.end)).length,
            SATURDAY_CLOSING_TURNS);
    });

    test('S3: at least five still on at 22:00 — someone finishing AT 22:00 does not count', () => {
        for (const cls of DAY_CLASSES) assert.ok(at(cls, 22 * 60) >= EVENING_TURNS_FROM_22, `${cls}: ${at(cls, 22 * 60)}`);
    });

    test('S4 and F1: ten on a Sunday, fourteen on a Saturday — the owner\'s figures, exactly', () => {
        assert.equal(dutiesOn('sun').length, SUNDAY_TURNS);
        assert.equal(dutiesOn('sat').length, SATURDAY_TURNS);
    });

    test('S5: the ticket office — two identical earlies and two identical lates, every day', () => {
        const office = { weekday: ['06:20-14:20', '14:00-22:30'], sat: ['06:20-14:50', '14:30-22:00'] };
        for (const [cls, times] of Object.entries(office)) {
            for (const t of times) assert.ok(dutiesOn(/** @type {any} */ (cls)).filter(x => x === t).length >= 2, `${cls} ${t}`);
        }
        assert.ok(dutiesOn('sun').filter(t => t.startsWith('07:15-')).length >= 2, 'Sunday: two starting 07:15');
        assert.ok(dutiesOn('sun').filter(t => t.endsWith('-22:30')).length >= 2, 'Sunday: two finishing 22:30');
    });

    test('S8: every Sunday duty is between 8 and 9 hours', () => {
        for (const t of dutiesOn('sun')) {
            const len = endMinutesAbs(t) - startMinutes(t);
            assert.ok(len >= 480 && len <= 540, `${t} is ${len} minutes`);
        }
    });

    test('S9: no more shift times than today (18)', () => {
        assert.ok(DEFAULT_SHIFT_TIMES.length <= 18, `${DEFAULT_SHIFT_TIMES.length} times`);
    });

    test('F3: every weekday closer starts at 15:45', () => {
        const close = windowMinutes(WINDOW_FOR.weekday.end);
        for (const t of dutiesOn('weekday').filter(x => endMinutesAbs(x) === close)) assert.equal(t.slice(0, 5), '15:45');
    });

    test('the days-a-week figure is what the table actually averages', () => {
        const perWeek = (5 * dutiesOn('weekday').length + dutiesOn('sat').length) / WORKING;
        assert.ok(Math.abs(perWeek - TARGET_DAYS_PER_WEEK) < 1e-9);
    });
});

describe('the shape of the day', () => {
    test('every duty sits inside its OWN day\'s operating window', () => {
        // Sunday is the case with teeth: 06:20 or 23:55 is outside its 07:15–23:25 day.
        for (const cls of DAY_CLASSES) {
            const open = windowMinutes(WINDOW_FOR[cls].start), close = windowMinutes(WINDOW_FOR[cls].end);
            for (const t of dutiesOn(cls)) {
                assert.ok(startMinutes(t) >= open, `${t} starts before the ${cls} open`);
                assert.ok(endMinutesAbs(t) <= close, `${t} finishes after the ${cls} close`);
            }
        }
    });
});

describe('superseding a stale memory — the v21.05 report', () => {
    // The generator remembers each device's table and prefers the memory forever. Right for a
    // table somebody tuned; wrong for the one the app stored on its own — from v19.38 to v21.00
    // the default WAS the roster seed, so every older device kept showing July's 29h 53m table
    // while a fresh one showed the designed default at 35h 00m. The owner read that stale memory
    // as "the new set doesn't average 35". These cases pin the discard rule's one hard boundary:
    // it may only ever discard a table the app itself wrote.

    test('the roster seed and the current default are superseded — nobody wrote either by hand', () => {
        assert.equal(isSupersededMemory(buildRosterTargets(), buildRosterTargets()), true);
        assert.equal(isSupersededMemory(buildDefaultTargets(), buildRosterTargets()), true);
    });

    test('ONE touched count keeps the memory — an edited table is somebody\'s work', () => {
        const edited = buildRosterTargets();
        edited.slots[0].weekday += 1;
        assert.equal(isSupersededMemory(edited, buildRosterTargets()), false);
        const fewerSpare = { ...buildDefaultTargets(), spareLines: 4 };
        assert.equal(isSupersededMemory(fewerSpare, buildRosterTargets()), false);
    });

    test('sameTargetTable ignores row ORDER and nothing else', () => {
        const a = buildDefaultTargets();
        const b = buildDefaultTargets();
        b.slots.reverse();
        assert.equal(sameTargetTable(a, b), true, 'a table is a set of claims, not a sequence');
        const c = buildDefaultTargets();
        c.slots.pop();
        assert.equal(sameTargetTable(a, c), false);
        assert.equal(sameTargetTable(a, null), false);
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
        for (const cls of DAY_CLASSES) {
            assert.ok(dutiesOn(cls).length <= WORKING,
                `${cls} asks for ${dutiesOn(cls).length} of ${WORKING} working lines`);
        }
    });

    test('DEFAULT_SHIFT_TIMES lists every time in the table, and nothing else', () => {
        // The coordinator feeds this list into the shift dropdowns, so a time in the table that is
        // missing here renders as a value the designer can see and cannot re-select.
        assert.deepEqual([...DEFAULT_SHIFT_TIMES].sort(), [...new Set(slots.map(s => s.time))].sort());
    });

    test('no time appears in two rows — shared times share a row', () => {
        // The generator tolerates duplicates, but the card renders one row per slot: a time split
        // across two rows shows the designer two counts for one shift, and editing either looks
        // like editing the shift. Kept as a table invariant so a future edit appends safely.
        const times = slots.map(s => s.time);
        assert.equal(new Set(times).size, times.length,
            'duplicate time rows: ' + times.filter((t, i) => times.indexOf(t) !== i).join(', '));
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
        for (const cls of DAY_CLASSES) {
            assert.ok(dutiesOn(cls).length <= WORKING,
                `${cls} asks for ${dutiesOn(cls).length} of ${WORKING} working lines`);
        }
    });

    test('DEFAULT_SHIFT_TIMES lists every time in the table, and nothing else', () => {
        // The coordinator feeds this list into the shift dropdowns, so a time in the table that is
        // missing here renders as a value the designer can see and cannot re-select.
        assert.deepEqual([...DEFAULT_SHIFT_TIMES].sort(), [...new Set(slots.map(s => s.time))].sort());
    });

    test('no time appears in two rows — shared times share a row', () => {
        // The generator tolerates duplicates, but the card renders one row per slot: a time split
        // across two rows shows the designer two counts for one shift, and editing either looks
        // like editing the shift. Kept as a table invariant so a future edit appends safely.
        const times = slots.map(s => s.time);
        assert.equal(new Set(times).size, times.length,
            'duplicate time rows: ' + times.filter((t, i) => times.indexOf(t) !== i).join(', '));
    });
});

