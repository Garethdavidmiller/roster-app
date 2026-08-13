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

describe('what the owner asked for', () => {
    test('four turns open every day; three run to the close — FOUR on a Saturday — to each day\'s OWN window', () => {
        // Sunday joined this rule at v21.01 when it became designed rather than carried, and it is
        // the case most worth the loop: Sunday opens at 07:15 and closes at 23:25, so an opener
        // copied from the Mon–Sat block would pass a bare "four start together" count while
        // standing on the concourse 55 minutes before the first train.
        //
        // Saturday's closer count split from the others at v21.03 (owner: "we only need 3 to
        // close. 4 on a Saturday") — the fourth closer is the events lean carried through to the
        // close-down. Asserted per day rather than in one loop constant precisely because the
        // counts are no longer one figure: a uniform check would have to pick a side and would
        // then be wrong about half the week.
        const CLOSERS_FOR = { weekday: CLOSING_TURNS, sat: SATURDAY_CLOSING_TURNS, sun: CLOSING_TURNS };
        for (const cls of DAY_CLASSES) {
            const open = windowMinutes(WINDOW_FOR[cls].start), close = windowMinutes(WINDOW_FOR[cls].end);
            assert.equal(dutiesOn(cls).filter(t => startMinutes(t) === open).length, OPENING_TURNS,
                `${cls} does not put ${OPENING_TURNS} people on at its open`);
            assert.equal(dutiesOn(cls).filter(t => endMinutesAbs(t) === close).length, CLOSERS_FOR[cls],
                `${cls} does not run ${CLOSERS_FOR[cls]} people to its close`);
        }
    });

    test('FOURTEEN work a Saturday and TEN work a Sunday — the owner\'s figures, exactly', () => {
        // Decisions, not derivations: an event Saturday needs hands regardless of the train count.
        // Exact because a headcount someone chose has no tolerance to hide in.
        assert.equal(dutiesOn('sat').length, SATURDAY_TURNS);
        assert.equal(dutiesOn('sun').length, SUNDAY_TURNS);
    });

    test('Saturday leans LATE where it counts — the EVENING carries more cover than demand', () => {
        // "Slight preference to late on Sat for events."
        //
        // This was asserted as *more turns starting after 11:00* from v21.01 to v21.05, and that
        // proxy was wrong in a way only the timetable could show: Saturday's measured peak is
        // 10:00–11:00, so satisfying the start count dropped the busiest hour of the day to six
        // people. Event crowds are not in the timetable — the same trains run fuller — so the lean
        // has to be a claim about where the COVER goes, not about clock-times on a rota.
        //
        // The claim, and it is a comparison rather than a threshold: Saturday's 17:00–22:00 takes
        // a BIGGER share of its day's cover than of its day's demand, and a weekday's does not.
        // A table rebalanced toward the morning reads identically in every total on the page —
        // headcount, hours, contract — so this is the only place the lean is visible at all.
        const share = (/** @type {'weekday'|'sat'} */ cls) => {
            const open = windowMinutes(WINDOW_FOR[cls].start), close = windowMinutes(WINDOW_FOR[cls].end);
            const hours = [];
            for (let h = Math.floor(open / 60); h < Math.ceil(close / 60); h++) hours.push(h);
            const coverAt = (/** @type {number} */ h) => dutiesOn(cls).reduce((a, t) => {
                const lo = Math.max(startMinutes(t), h * 60), hi = Math.min(endMinutesAbs(t), h * 60 + 60);
                return a + Math.max(0, hi - lo) / 60;
            }, 0);
            const cars = DEC_2026_DEMAND[cls].cars;
            const band = hours.filter(h => h >= 17 && h <= 22);
            const frac = (/** @type {any} */ f) =>
                band.reduce((a, h) => a + f(h), 0) / hours.reduce((a, h) => a + f(h), 0);
            return { cover: frac(coverAt), demand: frac((/** @type {number} */ h) => cars[h]) };
        };
        const sat = share('sat'), wd = share('weekday');
        assert.ok(sat.cover > sat.demand,
            `Saturday evening takes ${(sat.cover * 100).toFixed(1)}% of cover against `
            + `${(sat.demand * 100).toFixed(1)}% of demand — that is not a lean`);
        assert.ok(wd.cover < wd.demand,
            `a WEEKDAY evening also leans (${(wd.cover * 100).toFixed(1)}% cover vs `
            + `${(wd.demand * 100).toFixed(1)}% demand) — then the Saturday lean says nothing`);
    });

    test('THREE finish at the close on a weekday, FOUR on a Saturday — and nothing else finishes near it', () => {
        // The owner's rule, and the half that was missing until v21.06: counting only the turns
        // ending exactly at 23:55 said "three" while four more came off at 23:20, 23:30, 23:45 and
        // 23:50. Those are closers in everything but the arithmetic. So the assertion is two-part —
        // the exact count AT the close, and a clear gap before it.
        const CLOSERS_FOR = { weekday: CLOSING_TURNS, sat: SATURDAY_CLOSING_TURNS, sun: CLOSING_TURNS };
        for (const cls of DAY_CLASSES) {
            const close = windowMinutes(WINDOW_FOR[cls].end);
            const ends = dutiesOn(cls).map(endMinutesAbs);
            assert.equal(ends.filter(e => e === close).length, CLOSERS_FOR[cls]);
            const nearMisses = ends.filter(e => e !== close && e > close - 60);
            assert.deepEqual(nearMisses, [],
                `${cls} has de-facto closers finishing within the hour before ${close}: ${nearMisses}`);
        }
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
        const fewerSpare = { ...buildDefaultTargets(), spareLines: 5 };
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


// ── THE POPULARITY LEVERS (v21.10) ──────────────────────────────────────────────────────────────
//
// Two owner instructions, and neither is checkable by looking at the table: both are properties of
// the whole day, and both are the kind of thing a later retune undoes without noticing. The lates
// were unpopular — booked around with leave, phoned sick, refused as overtime — so a late is now
// deliberately SHORTER than an early, and the evening band is thinner.
describe('a late turn is shorter than an early one', () => {
    const LATE_FROM = 11 * 60;
    const dur = (t) => endMinutesAbs(t) - startMinutes(t);

    for (const cls of DAY_CLASSES) {
        test(`${cls}: one short early, then every late, then every other early`, () => {
            // A STRICT ORDERING, not an average. An average is satisfied by one very short late
            // among six long ones, which is exactly the shape the instruction was aimed at — the
            // member's experience is of the turn they are on, not of the mean.
            const duties = dutiesOn(cls);
            const lates   = duties.filter(t => startMinutes(t) >= LATE_FROM).map(dur);
            const earlies = duties.filter(t => startMinutes(t) <  LATE_FROM).map(dur);
            assert.ok(lates.length >= 3 && earlies.length >= 3, `${cls}: premise — both kinds exist`);

            const lmin = Math.min(...lates), lmax = Math.max(...lates);
            const shorter = earlies.filter(d => d < lmin);
            const longer  = earlies.filter(d => d > lmax);

            assert.equal(shorter.length, 1,
                `${cls}: exactly ONE early is shorter than every late — "most (not all) early starts". ` +
                `Got ${shorter.length}: ${shorter.join(', ')} against a shortest late of ${lmin}`);
            assert.equal(longer.length, earlies.length - 1,
                `${cls}: every OTHER early must be longer than every late (longest ${lmax}); ` +
                `${earlies.length - 1 - longer.length} are not`);
        });

        test(`${cls}: the margin is slight, and it is real`, () => {
            // "Slightly shorter" cuts both ways: a late that is two hours shorter is a different
            // job, and one that is five minutes shorter across the whole set is not a lever. The
            // bound is on the GAP between the longest late and the shortest long early — the two
            // turns a member is actually choosing between.
            const duties = dutiesOn(cls);
            const lates   = duties.filter(t => startMinutes(t) >= LATE_FROM).map(dur);
            const earlies = duties.filter(t => startMinutes(t) <  LATE_FROM).map(dur);
            const lmax = Math.max(...lates);
            const shortestLong = Math.min(...earlies.filter(d => d > lmax));
            assert.ok(shortestLong - lmax >= 5 && shortestLong - lmax <= 60,
                `${cls}: gap of ${shortestLong - lmax} min between the longest late and the shortest ` +
                `long early — wanted 5 to 60`);
            // And the whole set moves, not just the boundary pair.
            const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
            assert.ok(mean(earlies) - mean(lates) >= 30,
                `${cls}: mean early ${mean(earlies)} vs mean late ${mean(lates)} — the set has to move, ` +
                `not just the two turns either side of the boundary`);
        });
    }
});

describe('five on duty at 22:00, and the closers are not four of them by accident', () => {
    for (const cls of DAY_CLASSES) {
        test(`${cls}: exactly ${EVENING_TURNS_FROM_22} are still on at 22:00`, () => {
            // The owner counted seven and asked for five. It is a SEPARATE figure from the closer
            // count, and a retune that satisfies one by moving the other is the failure this pins:
            // three close on a weekday and four on a Saturday, so five at 22:00 is two non-closers
            // on a weekday and one on a Saturday.
            const at22 = dutiesOn(cls).filter(t => startMinutes(t) <= 22 * 60 && endMinutesAbs(t) > 22 * 60);
            assert.equal(at22.length, EVENING_TURNS_FROM_22,
                `${cls}: ${at22.length} on at 22:00 — ${at22.join(', ')}`);

            const close = windowMinutes(WINDOW_FOR[cls].end);
            const closers = at22.filter(t => endMinutesAbs(t) === close).length;
            const expected = cls === 'sat' ? SATURDAY_CLOSING_TURNS : CLOSING_TURNS;
            assert.equal(closers, expected,
                `${cls}: the closers must BE part of the five, not on top of them`);
        });
    }
});

describe('the table is short enough to hold in your head (v21.12)', () => {
    // The owner's ask was readability: "reduce the number of shift start/finish times so that it is
    // easier to understand, whilst keeping the rest of the principles" — then, asked whether the
    // weekend had to match, "weekend shift times can be different to weekday. It is just about
    // reducing the number of times in each type."
    //
    // Every other test in this file pins a rule the table must OBEY. These pin what it must not
    // silently give back: a later retune optimising cover alone will drift straight back to a time
    // per duty, because nothing about the demand curve prefers a shared one. The v21.10 table had
    // 33 rows and 21 distinct weekday times, and read as a wall.

    test('at most TWO people on any one turn in a day', () => {
        // The replacement for v21.10's "no two duties share a time", which was too strong: a count
        // of two is one row saying "two people do this", which is how the table got shorter. Four
        // on one time is the thing that rule was really about — a block of people with the same
        // handover, which is the opener/closer cliff again in the middle of the day.
        for (const cls of DAY_CLASSES) {
            const duties = dutiesOn(cls);
            const counts = new Map();
            for (const t of duties) counts.set(t, (counts.get(t) ?? 0) + 1);
            const over = [...counts].filter(([, n]) => n > 2);
            assert.deepEqual(over, [],
                `${cls} puts more than two people on one turn: ${over.map(([t, n]) => `${t} x${n}`).join(', ')}`);
        }
    });

    test('no day asks a reader to hold more clock times than it does today', () => {
        // Ceilings, not equalities — a retune that finds a SHORTER table is an improvement and must
        // not fail here. Set to what the table achieves, so the only way to trip this is to give
        // readability back. Starts and finishes are counted separately because they are two
        // different columns of the thing a reader scans.
        const CEILING = {
            weekday: { starts: 7, finishes: 9 },
            sat:     { starts: 9, finishes: 9 },
            sun:     { starts: 6, finishes: 7 },
        };
        for (const cls of DAY_CLASSES) {
            const duties = dutiesOn(cls);
            const starts = new Set(duties.map(startMinutes)).size;
            const finishes = new Set(duties.map(endMinutesAbs)).size;
            assert.ok(starts <= CEILING[cls].starts,
                `${cls} now states ${starts} distinct start times, up from ${CEILING[cls].starts}`);
            assert.ok(finishes <= CEILING[cls].finishes,
                `${cls} now states ${finishes} distinct finish times, up from ${CEILING[cls].finishes}`);
        }
    });

    test('Saturday is the weekday, moved in exactly TWO ways', () => {
        // v21.12 could say "one late turned into a fourth closer" — two rows, one sentence. The
        // quarter-hour pass could not keep that shape without the generated design breaching a HARD
        // limit (15 consecutive worked days), so Saturday is searched rather than derived, and the
        // difference is now two moves rather than one:
        //
        //   · the morning body arrives LATER — Saturday's measured peak is 10:00–11:00, a weekday's
        //     is 08:00–09:00, so its long middle starts at 08:30 instead of 07:15
        //   · one late is spent on a FOURTH CLOSER — the events lean, in structural form
        //
        // Asserted as "two bodies move, one of them onto the close" rather than by naming times:
        // naming them would pass on a table where five other rows had also diverged.
        const close = windowMinutes(WINDOW_FOR.sat.end);
        const differing = slots.filter(s => s.weekday !== s.sat);
        const moved = differing.reduce((a, s) => a + Math.abs(s.weekday - s.sat), 0) / 2;
        assert.equal(moved, 2,
            `${moved} bodies move between Mon–Fri and Saturday, not 2: `
            + differing.map(s => `${s.time} (${s.weekday} vs ${s.sat})`).join(', '));
        for (const s of differing) {
            assert.equal(Math.abs(s.weekday - s.sat), 1,
                `${s.time} moves more than one body (${s.weekday} vs ${s.sat}) — that is a redesign, not a lean`);
        }
        const gained = differing.filter(s => s.sat > s.weekday);
        assert.equal(gained.filter(s => endMinutesAbs(s.time) === close).length, 1,
            'exactly one of Saturday\'s extra turns must run to the close — that is the fourth closer');
        assert.equal(differing.filter(s => s.sat < s.weekday).length, 2,
            'and Saturday gives up exactly two turns, one for each move');
    });

    test('Saturday states only TWO times of its own — one per move', () => {
        // What keeps the table readable as mostly one list. If a retune re-diverges the two days the
        // row count climbs straight back toward 33, and this says so before anyone counts the table.
        const weekdayTimes = new Set(slots.filter(s => s.weekday > 0).map(s => s.time));
        const satOnly = slots.filter(s => s.sat > 0 && !weekdayTimes.has(s.time)).map(s => s.time);
        assert.equal(satOnly.length, 2,
            `Saturday states ${satOnly.length} times of its own — ${satOnly.join(', ')}`);
    });

    test('no start or finish is five or ten past the hour (v21.13)', () => {
        // Owner: "ditch the odd start/finish times like 5 or 10 past the hour, unless they are
        // opening or closing." The exemption is exactly the WINDOW'S OWN instants — 06:20 and 23:55
        // Mon–Sat, 07:15 and 23:25 on a Sunday — because those are the station's hours, not a
        // choice this table gets to make. Everything else is a decision, and :05 and :10 read as
        // arbitrary on a roster somebody has to remember.
        const pinned = new Set(DAY_CLASSES.flatMap(cls =>
            [WINDOW_FOR[cls].start, WINDOW_FOR[cls].end]));
        const offenders = [];
        for (const s of slots) {
            for (const half of s.time.split('-')) {
                if (pinned.has(half)) continue;
                if ([5, 10].includes(Number(half.split(':')[1]))) offenders.push(`${s.time} (${half})`);
            }
        }
        assert.deepEqual(offenders, [],
            `these read as arbitrary and are not the window's own hours: ${offenders.join(', ')}`);
    });

    test('and nearly every other time is on the quarter hour', () => {
        // The owner's IDEAL was :00/:15/:30/:45 throughout. That is not reachable while the window
        // opens at 06:20 and closes at 23:55 — see the module header for the arithmetic — so this
        // pins how close it gets rather than pretending it is absolute. A CEILING on the exceptions,
        // so a table that manages more quarters still passes.
        const pinned = new Set(DAY_CLASSES.flatMap(cls =>
            [WINDOW_FOR[cls].start, WINDOW_FOR[cls].end]));
        const off = new Set();
        for (const s of slots) {
            for (const half of s.time.split('-')) {
                if (pinned.has(half)) continue;
                if (![0, 15, 30, 45].includes(Number(half.split(':')[1]))) off.add(half);
            }
        }
        assert.ok(off.size <= 3,
            `${off.size} distinct times are off the quarter hour, up from 3: ${[...off].sort().join(', ')}`);
    });
});
