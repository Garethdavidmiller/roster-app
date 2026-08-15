/**
 * links-target-hours.test.mjs — the generator card's verdict on a target table.
 * Run: node --test links-target-hours.test.mjs   (part of `npm run test:hygiene`)
 *
 * ── WHY THIS SUITE EXISTS, AND WHY IT IS SHAPED LIKE THIS ───────────────────────────────────────
 *
 * The MEASUREMENT under this verdict — `targetExSundayMinutes` — has been covered by two suites
 * since v20.98. The verdict itself had none, and the defect was in the verdict: at v21.07 the tick
 * passed anything within half an hour, so a table twenty minutes short wore a green "on target
 * (35h)" and then met a red refusal on the next press.
 *
 * So this file is organised around the two ways a verdict can be wrong, not around the functions:
 *
 *   TOO KIND   — the tick is greener than the gate. The shipped defect. A designer is told the
 *                table is ready and finds out otherwise by pressing Generate, which is the one
 *                moment the card exists to save them from.
 *   TOO HARSH  — the tick refuses something the gate would build, or the empty states report a
 *                fault where there is only an empty table. Quieter, and it wastes a designer's
 *                afternoon hunting a problem that is not there.
 *
 * The tick's agreement with the gate is asserted BY CONSTRUCTION where it can be — the same
 * `targetExSundayMinutes` both use — and by a paired case where it cannot.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { assessTargetHours, targetHoursLines, targetProvenanceNote } from './links-target-hours.js';
import { CONTRACTED_HOURS_PER_WEEK, ROTATING_LINES, targetExSundayMinutes } from './links-design.js';

/** A table that pays the contract EXACTLY, built from the contract rather than hand-tuned — so it
 *  stays exact if the rotation length or the contracted week ever changes. */
function exactTable({ spareLines = 5, totalLines = ROTATING_LINES } = {}) {
    const working = totalLines - spareLines;
    // One 7-hour weekday duty per working line, five days a week = 35h. Saturday and Sunday empty.
    return { slots: [{ time: '07:00-14:00', weekday: working, sat: 0, sun: 0 }], spareLines, totalLines };
}

describe('too kind — the tick must never be greener than the gate', () => {
    test('an EXACT table is on target, and the FIGURE is the contract', () => {
        const t = exactTable();
        const a = assessTargetHours(t.slots, t);
        assert.equal(a.onTarget, true);
        assert.equal(a.diffMinutes, 0);
        assert.equal(targetHoursLines(a).tone, 'ok');
        // The value string, not just the tone. Asserting only the tone let a mutation that divided
        // the average by the WORKING lines survive — it kept the tick green and quietly printed
        // "44h 13m each" beside it, which is the card contradicting itself in one row.
        assert.equal(targetHoursLines(a).value, `${CONTRACTED_HOURS_PER_WEEK}h 00m each`);
    });

    test('the average divides by the WHOLE rotation — the Design-checks row\'s figure', () => {
        // Rule 2's second half, and the one a reader is least likely to notice going wrong: each
        // spare week counts as a full contracted week and the divisor is every line. Get it wrong
        // and the generator card predicts one number while the finished design reports another,
        // four seconds apart. Checked across spare counts so a divisor swap cannot coincide.
        for (const spareLines of [0, 3, 5, 8]) {
            const t = exactTable({ spareLines });
            const a = assessTargetHours(t.slots, t);
            assert.equal(a.hoursPerLine, CONTRACTED_HOURS_PER_WEEK,
                `spare=${spareLines}: an exact table averages exactly the contract, whatever the spare count`);
        }
    });

    test('THE v21.07 DEFECT: twenty minutes short is NOT on target', () => {
        // The exact case that shipped. Under the old half-hour tolerance this read green and then
        // met a red refusal. If this test ever passes again with `onTarget: true`, the tick has
        // reacquired a tolerance the generator does not have.
        const t = exactTable();
        const slots = [...t.slots, { time: '07:00-07:20', weekday: 0, sat: 1, sun: 0 }];
        const a = assessTargetHours(slots, t);
        assert.equal(a.onTarget, false, 'a table 20 minutes OVER must not wear the green tick');
        assert.equal(a.diffMinutes, 20);
        assert.equal(targetHoursLines(a).tone, 'off');
    });

    test('one minute out either way is off target', () => {
        // The boundary, from both sides. A tolerance reintroduced as "±1" would pass the case above
        // and fail here, so both directions are pinned.
        const t = exactTable();
        for (const [time, sign] of [['07:00-07:01', 1], ['06:59-14:00', -1]]) {
            const slots = sign > 0
                ? [...t.slots, { time, weekday: 1, sat: 0, sun: 0 }]
                : [{ time, weekday: t.slots[0].weekday, sat: 0, sun: 0 }];
            const a = assessTargetHours(slots, t);
            assert.equal(a.onTarget, false, `${time} must be off target`);
        }
    });

    test('an unreadable time that COUNTS blocks the tick, whatever the minutes say', () => {
        // A garbled duty asked for by somebody makes the total unknowable, and unknowable is not
        // on target. Asserting `askedMinutes` is null as well pins WHY, so a future change that
        // computed a number here could not quietly satisfy the tick.
        const t = exactTable();
        const slots = [...t.slots, { time: 'half seven', weekday: 1, sat: 0, sun: 0 }];
        const a = assessTargetHours(slots, t);
        assert.equal(a.onTarget, false);
        assert.equal(a.askedMinutes, null);
        assert.equal(a.unreadable, 1);
    });

    test('the tick agrees with the GATE by construction, not by coincidence', () => {
        // The property the module exists to guarantee: `onTarget` is exactly "the gate's own
        // measure equals the requirement". Checked against `targetExSundayMinutes` directly, so a
        // reimplementation of the arithmetic inside this module would fail here.
        for (const spareLines of [0, 3, 5, 8]) {
            const t = exactTable({ spareLines });
            const a = assessTargetHours(t.slots, t);
            assert.equal(a.askedMinutes, targetExSundayMinutes(t.slots),
                `spare=${spareLines}: the assessment must report the GATE's minutes`);
            assert.equal(a.onTarget, targetExSundayMinutes(t.slots) === a.neededMinutes);
        }
    });
});

describe('too harsh — it must not refuse or alarm where there is nothing wrong', () => {
    test('an unreadable time on a row asking for NOBODY is still DECLARED', () => {
        // Kept in this block because the RISK here is harshness — a red tick is correct, and a
        // red tick that explains nothing is the harsh version. The extraction is what showed the
        // card and the gate disagreed about which rows count.
        // `targetExSundayMinutes` bails on any unreadable time before it looks at the counts, so
        // Generate refuses this table — and the old card reported `unreadable: 0`, leaving a red
        // tick beside a note that never mentioned the row responsible. Following the gate is the
        // only reading under which the note explains the refusal it sits beside.
        const t = exactTable();
        const slots = [...t.slots, { time: 'gibberish', weekday: 0, sat: 0, sun: 0 }];
        const a = assessTargetHours(slots, t);
        assert.equal(a.onTarget, false, 'the gate refuses this table, so the tick must not be green');
        assert.equal(a.unreadable, 1, 'and the count must name it, or nothing explains the refusal');
        assert.match(targetHoursLines(a).note, /1 shift not counted \(unreadable time\)/);
    });

    test('SUNDAY time is excluded from the comparison, not counted toward the contract', () => {
        // Sunday is not contracted for any grade. Adding Sunday duty must move neither the total
        // nor the verdict, or a table would be reported as contracted using time that is not.
        const t = exactTable();
        const withSunday = [...t.slots, { time: '09:00-17:00', weekday: 0, sat: 0, sun: 6 }];
        const a = assessTargetHours(withSunday, t);
        assert.equal(a.onTarget, true);
        assert.equal(a.diffMinutes, 0);
    });

    test('an EMPTY table reports empty, never "0h 00m"', () => {
        // A zero figure reads as a finding about the targets rather than as an empty table.
        const a = assessTargetHours([], { spareLines: 5, totalLines: ROTATING_LINES });
        assert.equal(a.hoursPerLine, null);
        const { value, tone, note } = targetHoursLines(a);
        assert.equal(value, '—');
        assert.equal(tone, 'none');
        assert.match(note, /add a shift/);
    });

    test('a Sunday-ONLY table does not claim there are no shifts', () => {
        // It lands in the same empty branch (Sundays are excluded), so the wording has to
        // distinguish "no Mon–Sat hours" from "no shifts at all" — there ARE shifts.
        const a = assessTargetHours([{ time: '09:00-17:00', weekday: 0, sat: 0, sun: 6 }],
            { spareLines: 5, totalLines: ROTATING_LINES });
        const { note } = targetHoursLines(a);
        assert.match(note, /no Mon–Sat hours/);
        assert.doesNotMatch(note, /add a shift/);
    });

    test('a table whose times are ALL unreadable says so, not "no hours yet"', () => {
        // Found by the bug-check on this very extraction: it used to land on the same message as an
        // empty table, sending a designer looking for missing COUNTS when the fault is the TIMES.
        // The same defect as the silently-uncounted row above, one state over.
        const a = assessTargetHours(
            [{ time: 'nope', weekday: 3, sat: 0, sun: 0 }, { time: 'also nope', weekday: 2, sat: 1, sun: 0 }],
            { spareLines: 5, totalLines: ROTATING_LINES });
        assert.equal(a.empty, 'all-unreadable');
        const { note } = targetHoursLines(a);
        assert.match(note, /no shift times could be read — check the 2 times/);
        assert.doesNotMatch(note, /no Mon–Sat hours/);
    });

    test('every line spare is its own message, not a shortfall', () => {
        const a = assessTargetHours([], { spareLines: ROTATING_LINES, totalLines: ROTATING_LINES });
        assert.equal(targetHoursLines(a).note, 'every line is a spare week');
    });
});

describe('the words a designer acts on', () => {
    test('the gap is a TOTAL and names the equality', () => {
        // Rule 3. The per-line average divides by the whole rotation, so an hour of missing duty
        // reads "0h 02m" — a figure that makes a refusal look like a rounding error.
        const t = exactTable();
        const slots = [{ time: '07:00-13:00', weekday: t.slots[0].weekday, sat: 0, sun: 0 }];
        const a = assessTargetHours(slots, t);
        const { note } = targetHoursLines(a);
        // The EXACT total, not a shape. A `doesNotMatch` on the per-line figure was too weak: a
        // mutation dividing the gap by the rotation printed "3h 57m short in total" and survived,
        // because it neither matched the guard nor was checked against anything. One hour per
        // working line per weekday, missing five days a week = 95h across the table.
        const missingHours = 1 * t.slots[0].weekday * 5;
        assert.equal(note,
            `${missingHours}h 00m short in total — Generate needs it exact · over ${t.slots[0].weekday} working lines`);
    });

    test('over and short are named as themselves', () => {
        const t = exactTable();
        const over  = assessTargetHours([...t.slots, { time: '07:00-08:00', weekday: 1, sat: 0, sun: 0 }], t);
        assert.match(targetHoursLines(over).note, /over in total/);
        const short = assessTargetHours([{ time: '07:00-13:30', weekday: t.slots[0].weekday, sat: 0, sun: 0 }], t);
        assert.match(targetHoursLines(short).note, /short in total/);
    });

    test('the working-line count is stated, and singular reads correctly', () => {
        const t = exactTable({ spareLines: ROTATING_LINES - 1 });
        const a = assessTargetHours(t.slots, t);
        assert.match(targetHoursLines(a).note, /over 1 working line\b/);
    });

    test('unreadable shifts are declared rather than silently dropped', () => {
        const t = exactTable();
        const a = assessTargetHours([...t.slots, { time: 'nope', weekday: 2, sat: 0, sun: 0 }], t);
        const { note } = targetHoursLines(a);
        assert.match(note, /1 shift not counted \(unreadable time\)/);
        // …and with no readable total it must NOT claim what the gate would do.
        assert.doesNotMatch(note, /needs it exact/);
    });

    test('the on-target line names the contract figure', () => {
        const t = exactTable();
        assert.equal(targetHoursLines(assessTargetHours(t.slots, t)).note,
            `on target (${CONTRACTED_HOURS_PER_WEEK}h) · over ${ROTATING_LINES - 5} working lines`);
    });
});

describe('the provenance note', () => {
    test('nothing to say when the table IS the default', () => {
        assert.equal(targetProvenanceNote({ fromMemory: true, differsFromDefault: false }), null);
        assert.equal(targetProvenanceNote({ fromMemory: false, differsFromDefault: true }), null);
    });

    test('a loaded SET is named, because "remembered" tells the designer nothing', () => {
        const note = targetProvenanceNote({ fromMemory: true, differsFromDefault: true, setName: 'Set A' });
        assert.match(note, /saved set “Set A”/);
    });

    test('without a set it says where the table came from, and both forms offer the way back', () => {
        const note = targetProvenanceNote({ fromMemory: true, differsFromDefault: true });
        assert.match(note, /your device remembers/);
        for (const n of [note, targetProvenanceNote({ fromMemory: true, differsFromDefault: true, setName: 'X' })]) {
            assert.match(n, /Back to the demand-based default/);
            assert.match(n, /anything you change here is kept/);
        }
    });
});
