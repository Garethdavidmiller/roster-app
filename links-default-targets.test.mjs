/**
 * links-default-targets.test.mjs — the table the generator starts from.
 * Run: node --test links-default-targets.test.mjs   (no mocks; part of `npm run test:hygiene`)
 *
 * ── WHY THIS IS TESTED AT ALL, GIVEN IT IS A LITERAL ────────────────────────────────────────────
 *
 * A hand-written table has no computation to get wrong, which is exactly why it needs pinning: its
 * properties are true by construction and stay true only as long as nobody edits it. Every claim
 * below is a claim the module HEADER makes and the workspace copy REPEATS — four openers, three
 * closers, the contracted week, 14 on a Saturday, 10 on a Sunday — and each of them survives an
 * edit that breaks it, silently and in prose, for as long as nobody re-runs the arithmetic by hand.
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
    OPENING_TURNS, CLOSING_TURNS, SATURDAY_TURNS, SUNDAY_TURNS, TARGET_DAYS_PER_WEEK,
} from './links-default-targets.js';
import {
    generateLink, weeklyHours, targetExSundayMinutes,
    CONTRACTED_HOURS_PER_WEEK, ROTATING_LINES, startMinutes, endMinutesAbs,
} from './links-design.js';
import { DEFAULT_WINDOW, windowMinutes } from './links-window.js';
import { DEC_2026_DEMAND } from './links-demand.js';

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

describe('what the owner asked for', () => {
    test('four turns open the station and three run to the close — on EVERY day, to its OWN window', () => {
        // Sunday joined this rule at v21.01 when it became designed rather than carried, and it is
        // the case most worth the loop: Sunday opens at 07:15 and closes at 23:25, so an opener
        // copied from the Mon–Sat block would pass a bare "four start together" count while
        // standing on the concourse 55 minutes before the first train.
        for (const cls of DAY_CLASSES) {
            const open = windowMinutes(WINDOW_FOR[cls].start), close = windowMinutes(WINDOW_FOR[cls].end);
            assert.equal(dutiesOn(cls).filter(t => startMinutes(t) === open).length, OPENING_TURNS,
                `${cls} does not put ${OPENING_TURNS} people on at its open`);
            assert.equal(dutiesOn(cls).filter(t => endMinutesAbs(t) === close).length, CLOSING_TURNS,
                `${cls} does not run ${CLOSING_TURNS} people to its close`);
        }
    });

    test('FOURTEEN work a Saturday and TEN work a Sunday — the owner\'s figures, exactly', () => {
        // Decisions, not derivations: an event Saturday needs hands regardless of the train count.
        // Exact because a headcount someone chose has no tolerance to hide in.
        assert.equal(dutiesOn('sat').length, SATURDAY_TURNS);
        assert.equal(dutiesOn('sun').length, SUNDAY_TURNS);
    });

    test('Saturday leans LATE — more turns start at 11:00 or after than before it', () => {
        // "Slight preference to late on Sat for events." Strict inequality is the whole claim: a
        // 7/7 split is no preference at all, and a table quietly rebalanced toward the morning
        // reads identically in every total (headcount, hours, contract) — this is the only place
        // the lean is visible.
        const starts = dutiesOn('sat').map(startMinutes);
        const late = starts.filter(m => m >= 11 * 60).length;
        assert.ok(late > starts.length - late,
            `Saturday has ${late} late starts against ${starts.length - late} early — not a late lean`);
    });

    test('a working line averages about 4.2 days Mon–Sat', () => {
        // At four cover weeks this is EXACT — (5x14 + 14) / 20 = 4.2 with no rounding anywhere,
        // which is the arithmetic reason 4 became the default. The tolerance stays a tenth rather
        // than an equality because the owner's word was "roughly" and the exactness is a property
        // of these figures, not of the requirement: a tenth still fails on any whole duty moved.
        const perWeek = (5 * dutiesOn('weekday').length + dutiesOn('sat').length) / WORKING;
        assert.ok(Math.abs(perWeek - TARGET_DAYS_PER_WEEK) < 0.1,
            `${perWeek.toFixed(2)} days a week is not roughly ${TARGET_DAYS_PER_WEEK}`);
    });

    test('and the mean duty is what 35h over that many days implies', () => {
        // 35h over 4.2 days is a mean turn of exactly 8h20, and at these figures the table lands on
        // it exactly (42,000 / 84 = 500). The step that makes the table solvable rather than
        // over-constrained. Ten minutes of tolerance rather than an equality, for the same reason
        // as the case above — the exactness belongs to these figures, and funding an extra duty by
        // shortening the others is caught by the days-per-week case before this one blurs.
        const mean = targetExSundayMinutes(slots) /
            (5 * dutiesOn('weekday').length + dutiesOn('sat').length);
        assert.ok(Math.abs(mean - (CONTRACTED_HOURS_PER_WEEK * 60) / TARGET_DAYS_PER_WEEK) < 10,
            `mean duty ${mean.toFixed(1)} min is not roughly 35h / ${TARGET_DAYS_PER_WEEK}`);
    });
});

describe('the shape of the day', () => {
    test('every duty sits inside its OWN day\'s operating window', () => {
        // A duty starting before the station opens or finishing after it closes is not a design
        // decision, it is a typo — and the heat map would draw it as cover in an hour the window
        // says is shut, which is the one thing `links-demand.js` is written to keep believable.
        // Sunday is checked against the Sunday window, which is the check that has teeth: every
        // Mon–Sat time fits inside Mon–Sat's span trivially, but 06:20 or 23:55 on a Sunday is
        // outside its 07:15–23:25 day.
        for (const cls of DAY_CLASSES) {
            const open = windowMinutes(WINDOW_FOR[cls].start), close = windowMinutes(WINDOW_FOR[cls].end);
            for (const t of dutiesOn(cls)) {
                assert.ok(startMinutes(t) >= open, `${t} starts before the ${cls} open`);
                assert.ok(endMinutesAbs(t) <= close, `${t} finishes after the ${cls} close`);
            }
        }
    });

    test('NO DUTY IS SHORTER THAN SEVEN HOURS OR LONGER THAN NINE AND A HALF', () => {
        // The mean is fixed by the contract, so the only way to get a wrong shape past the gate is
        // at the extremes: two very long turns paid for by several very short ones averages
        // correctly and is not a link anyone would work. The live roster runs 7h15 to 9h10; this
        // allows a little either side and refuses anything beyond it. Sunday included — it has no
        // contract gate behind it, so this is the only bound its durations have.
        for (const cls of DAY_CLASSES) {
            for (const t of dutiesOn(cls)) {
                const mins = endMinutesAbs(t) - startMinutes(t);
                assert.ok(mins >= 420 && mins <= 570, `${t} is ${mins} minutes — outside 7h–9h30`);
            }
        }
    });

    test('the openers do not all walk off at the same minute, nor the closers all arrive at one', () => {
        // Staggering is the reason the openers carry different lengths rather than one. A single
        // finish time makes the middle of the day a cliff rather than a handover, and it is
        // invisible in every total on the page — the hours, the headcount and the contract are all
        // identical either way.
        for (const cls of DAY_CLASSES) {
            const open = windowMinutes(WINDOW_FOR[cls].start), close = windowMinutes(WINDOW_FOR[cls].end);
            const ends = dutiesOn(cls).filter(t => startMinutes(t) === open).map(endMinutesAbs);
            assert.equal(new Set(ends).size, ends.length, `${cls} openers share a finish time`);
            const starts = dutiesOn(cls).filter(t => endMinutesAbs(t) === close).map(startMinutes);
            assert.equal(new Set(starts).size, starts.length, `${cls} closers share a start time`);
        }
    });

    test('THE BIGGEST HEADCOUNT OF A DAY NEVER SITS ON ITS QUIETEST HOURS (v21.02, owner report)', () => {
        // The v21.01 table shipped with the day's staffing PEAK at 14:00 — 8.7 on duty for 79 cars,
        // one of the quietest hours — while 22:00 ran 4.7 people for 75. The owner saw it the day
        // it shipped. The cause was a wide shift handover: afternoon turns starting 12:50–15:00
        // overlapped openers who leave 14:20–15:20, and the bulge parked on the trough.
        //
        // The property, not the fix: find each day's most-staffed hour and require the DEMAND in
        // that hour to be at or above the staffed day's median. That is deliberately about the
        // argmax rather than any named hour — a future retune that moves the bulge from 14:00 to
        // some other trough fails just the same, and a table whose maximum genuinely sits on a busy
        // hour passes however the middles move. Every total on the page (hours, headcount, the
        // contract) is identical either way, which is why nothing else can see this.
        const coverAt = (/** @type {string} */ cls, /** @type {number} */ h) =>
            dutiesOn(cls).reduce((a, t) => {
                const lo = Math.max(startMinutes(t), h * 60), hi = Math.min(endMinutesAbs(t), h * 60 + 60);
                return a + Math.max(0, hi - lo) / 60;
            }, 0);
        for (const cls of DAY_CLASSES) {
            const demand = DEC_2026_DEMAND[cls === 'weekday' ? 'weekday' : cls].cars;
            const open = windowMinutes(WINDOW_FOR[cls].start), close = windowMinutes(WINDOW_FOR[cls].end);
            const hours = [];
            for (let h = Math.ceil(open / 60); h < close / 60; h++) hours.push(h);
            const busiest = hours.reduce((a, h) => coverAt(cls, h) > coverAt(cls, a) ? h : a, hours[0]);
            const sorted = hours.map(h => demand[h]).sort((a, b) => a - b);
            const median = sorted[Math.floor(sorted.length / 2)];
            assert.ok(demand[busiest] >= median,
                `${cls}: the most-staffed hour is ${busiest}:00 (${coverAt(cls, busiest).toFixed(1)} on) `
                + `but its demand ${demand[busiest]} cars is below the day's median ${median} — `
                + `the handover bulge is parked on a trough again`);
        }
    });

    test('Saturday\'s events lean points at the EVENING, not at lunchtime', () => {
        // The late lean is a decision about where extra bodies go, and "late start" alone does not
        // deliver it: a turn starting 12:00 counts as late in the start-time test while pooling its
        // hours over the 13:00 trough and going home before the evening. So the lean is asserted
        // where it is meant to land — every hour from 17:00 to 21:00 carries at least the cover the
        // 13:00 hour does. Demand cannot arbitrate this one (events are not in the timetable),
        // which is why it is a shape rule rather than a demand-proportion rule.
        const coverAt = (/** @type {number} */ h) =>
            dutiesOn('sat').reduce((a, t) => {
                const lo = Math.max(startMinutes(t), h * 60), hi = Math.min(endMinutesAbs(t), h * 60 + 60);
                return a + Math.max(0, hi - lo) / 60;
            }, 0);
        for (let h = 17; h <= 21; h++) {
            assert.ok(coverAt(h) >= coverAt(13),
                `Saturday ${h}:00 has ${coverAt(h).toFixed(1)} on against ${coverAt(13).toFixed(1)} at `
                + `13:00 — the events lean is pooling at lunchtime instead of the evening`);
        }
    });

    test('a weekday and the Saturday carry the SAME minutes — 14 turns each, 7,000 apiece', () => {
        // The symmetry the header's arithmetic rests on: 7,000 minutes each, so the split of the
        // 42,000 stays legible (5 + 1 equal days). Not a requirement anyone stated — but if an edit
        // breaks it the header's worked example is silently wrong, and that example is what the
        // next person will re-derive the table from.
        const mins = (cls) => dutiesOn(cls).reduce((a, t) => a + endMinutesAbs(t) - startMinutes(t), 0);
        assert.equal(mins('weekday'), mins('sat'));
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
