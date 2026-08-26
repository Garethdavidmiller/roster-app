// Tests for paycalc-pension.js — the pension-status timeline.
//
// Organised by the two ways a wrong answer here costs a member money, NOT by function. A
// per-function suite would pass on exactly the code that produced the shipped defect: every
// function is trivially correct in isolation, and the bug was that the question being asked had no
// time in it at all.
//
//   REWRITING HISTORY is the shipped defect (v21.64–v21.77). A boolean opt-out made the pension
//   default £0 for every payslip that has ever existed, and because a period whose pension equals
//   the default stores `null`, most historical payslips had no figure of their own to defend them.
//   Reproduced before the fix: a 2025/26 payslip's deduction went £160.78 → £0.00 and its
//   take-home rose £115.92. It is silent, it is retroactive, and it overstates take-home.
//
//   LOSING THE CHANGE is what a careless fix produces — a member who tells the app she has left
//   the scheme and finds her current payslips still charging her for it, or a rejoin that cannot
//   be expressed and so leaves her permanently at £0.
//
// Both directions are asserted for every rule, and the parse boundary is tested from the outside
// like `validateBackup`: what reaches the app from storage is a claim, not a fact.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    parsePensionTimeline, serialisePensionTimeline, isOptedOutAt, withPensionChange,
    withOptOutStartAt, withRejoinAt, optOutStartsAt, migrateLegacyOptOut,
} from './paycalc-pension.js';

describe('rewriting history — the direction that overstates take-home', () => {
    test('a payslip BEFORE the opt-out is untouched by it', () => {
        const tl = withPensionChange([], 56, true);
        assert.equal(isOptedOutAt(tl, 55), false, 'the payslip immediately before must still contribute');
        assert.equal(isOptedOutAt(tl, 37), false, 'the reproduced case: a prior-tax-year payslip');
        assert.equal(isOptedOutAt(tl, 1), false);
    });

    test('the opt-out applies from its own payslip onwards, inclusive', () => {
        const tl = withPensionChange([], 56, true);
        assert.equal(isOptedOutAt(tl, 56), true, 'inclusive — the member named the FIRST payslip with no deduction');
        assert.equal(isOptedOutAt(tl, 57), true);
        assert.equal(isOptedOutAt(tl, 999), true);
    });

    test('no timeline means contributing — never opted out', () => {
        // The state of every member but one, and the answer that changes no stored figure.
        assert.equal(isOptedOutAt([], 56), false);
        assert.equal(isOptedOutAt(parsePensionTimeline(null), 56), false);
        assert.equal(isOptedOutAt(parsePensionTimeline(''), 56), false);
        assert.equal(isOptedOutAt(parsePensionTimeline('[]'), 56), false);
    });

    test('with no payslip in hand the answer is contributing, not the latest state', () => {
        // Callers reach this on the field paint before a period is resolved. Answering "out"
        // because the newest change says so would be the retroactive bug in miniature.
        const tl = withPensionChange([], 56, true);
        assert.equal(isOptedOutAt(tl, null), false);
        assert.equal(isOptedOutAt(tl, undefined), false);
    });

    test('a rejoin restores the scheme WITHOUT restoring it to the months she was out', () => {
        // Auto-enrolment re-enrols opted-out staff about every three years, so this is the
        // expected shape, not an edge case. A single "opted out from" field cannot express it, and
        // un-ticking such a field would hand the scheme default back to P56–P94.
        let tl = withPensionChange([], 56, true);
        tl = withPensionChange(tl, 95, false);
        assert.equal(isOptedOutAt(tl, 55), false, 'before she left');
        assert.equal(isOptedOutAt(tl, 56), true,  'the spell she was out');
        assert.equal(isOptedOutAt(tl, 94), true,  'still out, right up to the rejoin');
        assert.equal(isOptedOutAt(tl, 95), false, 'back in from the payslip she named');
        assert.equal(isOptedOutAt(tl, 120), false);
    });
});

describe('losing the change — the direction that keeps charging her', () => {
    test('a recorded opt-out survives a save/load round trip', () => {
        const tl = withPensionChange([], 56, true);
        const back = parsePensionTimeline(serialisePensionTimeline(tl));
        assert.deepEqual(back, tl);
        assert.equal(isOptedOutAt(back, 60), true);
    });

    test('correcting the date MOVES the boundary rather than adding a second one', () => {
        // She ticks the box, then realises she left two payslips earlier and re-picks.
        let tl = withPensionChange([], 56, true);
        tl = withPensionChange(tl, 54, true);
        assert.equal(tl.length, 1, 'one spell out of the scheme is one change');
        assert.equal(isOptedOutAt(tl, 54), true);
        assert.equal(isOptedOutAt(tl, 53), false);
    });

    test('re-stating what is already true records nothing', () => {
        // Toggling the box off and on again must not accumulate changes, or the timeline grows
        // without bound and every entry is a chance for a later reader to disagree with it.
        let tl = withPensionChange([], 56, true);
        tl = withPensionChange(tl, 70, true);
        assert.deepEqual(tl, [{ from: 56, out: true }]);
        assert.equal(isOptedOutAt(tl, 70), true);
    });

    test('un-ticking while already contributing leaves an empty timeline, not a false record', () => {
        assert.deepEqual(withPensionChange([], 56, false), [], 'a change to the state you were already in is not a change');
        assert.deepEqual(withRejoinAt([], 56), [], 'and there is no spell to end');
    });

    test('a later change is kept, not silently dropped by an earlier correction', () => {
        let tl = withPensionChange([], 56, true);
        tl = withPensionChange(tl, 95, false);
        tl = withPensionChange(tl, 50, true);   // correcting the START of the first spell
        assert.equal(isOptedOutAt(tl, 50), true);
        assert.equal(isOptedOutAt(tl, 95), false, 'the rejoin she recorded must survive');
    });

    test('optOutStartsAt names the current spell, and nothing when she is contributing', () => {
        assert.equal(optOutStartsAt([]), null);
        assert.equal(optOutStartsAt(withPensionChange([], 56, true)), 56);
        let rejoined = withPensionChange([], 56, true);
        rejoined = withPensionChange(rejoined, 95, false);
        assert.equal(optOutStartsAt(rejoined), null, 'she is back in — there is no current spell');
    });
});

describe('the parse boundary — what arrives from storage is a claim', () => {
    // Same discipline as validateBackup: this data outlives app versions, can be hand-edited, and
    // arrives from another device through a pay-data restore. A HALF-read timeline is the danger —
    // it is a perfectly valid timeline that says something else, and it moves the boundary between
    // contributing and not without anything on screen changing.
    const REFUSED = [
        ['not JSON',                 '{oh dear'],
        ['not an array',             '{"from":56,"out":true}'],
        ['a string entry',           '["p56"]'],
        ['null entry',               '[null]'],
        ['missing out',              '[{"from":56}]'],
        ['missing from',             '[{"out":true}]'],
        ['out as a string',          '[{"from":56,"out":"true"}]'],
        ['from as a string',         '[{"from":"56","out":true}]'],
        ['a fractional payslip',     '[{"from":56.5,"out":true}]'],
        ['NaN',                      '[{"from":null,"out":true}]'],
        ['two states for one payslip', '[{"from":56,"out":true},{"from":56,"out":false}]'],
    ];
    for (const [label, raw] of REFUSED) {
        test(`refuses ${label} WHOLE — and refusing means contributing`, () => {
            assert.deepEqual(parsePensionTimeline(raw), []);
            assert.equal(isOptedOutAt(parsePensionTimeline(raw), 60), false);
        });
    }

    test('one bad entry discards the whole timeline, never just itself', () => {
        // The tempting alternative — skip the bad entry, keep the rest — turns "out from 56, back
        // in from 95" into "out from 56" and charges her nothing for ever.
        const raw = '[{"from":56,"out":true},{"from":95,"out":"no"}]';
        assert.deepEqual(parsePensionTimeline(raw), []);
    });

    test('a timeline stored out of order is read in order', () => {
        const tl = parsePensionTimeline('[{"from":95,"out":false},{"from":56,"out":true}]');
        assert.deepEqual(tl, [{ from: 56, out: true }, { from: 95, out: false }]);
        assert.equal(isOptedOutAt(tl, 60), true);
        assert.equal(isOptedOutAt(tl, 100), false);
    });
});

describe('migrating the v21.64 boolean', () => {
    test('a member who never opted out gets no timeline', () => {
        assert.deepEqual(migrateLegacyOptOut(false, 53), []);
    });

    test('the flag becomes a change dated to the current tax year, restoring earlier years', () => {
        const tl = migrateLegacyOptOut(true, 53);
        assert.deepEqual(tl, [{ from: 53, out: true }]);
        assert.equal(isOptedOutAt(tl, 37), false, 'the reproduced 2025/26 payslip is given back its pension');
        assert.equal(isOptedOutAt(tl, 53), true,  'and she is still out where she said she was');
    });

    test('with no period grid to date it against, the migration records nothing', () => {
        // Fails towards CONTRIBUTING — the state that alters no stored figure. A migration that
        // guessed a payslip number here would impose a £0 on whatever it happened to pick.
        assert.deepEqual(migrateLegacyOptOut(true, null), []);
    });
});

// ── THE TWO EDITS THE SETTINGS CARD ACTUALLY MAKES (v21.80) ──────────────────────────────────────
//
// `withPensionChange` records a change AT a payslip. The card does not do that — it MOVES the start
// of a spell, or ENDS one — and wiring the raw primitive to both controls produced two silent
// failures, in opposite directions and both invisible on screen:
//
//   · Re-picking a LATER payslip did nothing at all. The earlier "out" change still stood in front
//     of it, so the select read one payslip and every figure went on using another, until a reload
//     put the select back and the disagreement disappeared without ever being seen.
//   · Un-ticking ERASED the spell instead of ending it — dated, as the handler did, to the spell's
//     own start. So the rejoin the module exists to make expressible was unreachable from the page
//     that instructs the member to record one.
describe('moving the start of a spell', () => {
    test('re-picking a LATER payslip moves the start forward', () => {
        const tl = withOptOutStartAt([{ from: 40, out: true }], 50);
        assert.deepEqual(tl, [{ from: 50, out: true }]);
        assert.equal(isOptedOutAt(tl, 45), false, 'the payslips she has taken back are contributing again');
        assert.equal(isOptedOutAt(tl, 50), true);
    });

    test('re-picking an EARLIER payslip moves it back', () => {
        assert.deepEqual(withOptOutStartAt([{ from: 40, out: true }], 30), [{ from: 30, out: true }]);
    });

    test('re-picking the same payslip changes nothing', () => {
        // Every keystroke in the pension field re-states the pair, so this runs constantly.
        assert.deepEqual(withOptOutStartAt([{ from: 40, out: true }], 40), [{ from: 40, out: true }]);
    });

    test('a spell that has already ENDED is left alone — this is a new one', () => {
        const tl = withOptOutStartAt([{ from: 40, out: true }, { from: 50, out: false }], 60);
        assert.deepEqual(tl, [{ from: 40, out: true }, { from: 50, out: false }, { from: 60, out: true }]);
        assert.equal(isOptedOutAt(tl, 45), true,  'the first spell is history and stays');
        assert.equal(isOptedOutAt(tl, 55), false);
        assert.equal(isOptedOutAt(tl, 60), true);
    });
});

describe('ending a spell — the rejoin', () => {
    test('un-ticking on a LATER payslip records the rejoin there', () => {
        const tl = withRejoinAt([{ from: 40, out: true }], 50);
        assert.deepEqual(tl, [{ from: 40, out: true }, { from: 50, out: false }]);
        assert.equal(isOptedOutAt(tl, 45), true,  'the months she was out keep their £0');
        assert.equal(isOptedOutAt(tl, 50), false);
    });

    test('un-ticking on the payslip she ticked on ERASES it — the mistake she just made', () => {
        assert.deepEqual(withRejoinAt([{ from: 40, out: true }], 40), []);
    });

    test('un-ticking while viewing an EARLIER payslip erases too, rather than doing nothing', () => {
        // A rejoin before the spell began is not a statement anyone can act on, and the alternative
        // — leave the timeline as it is — springs the tick back on the next load with no
        // explanation, which is the shape of every silent disagreement in this file.
        assert.deepEqual(withRejoinAt([{ from: 40, out: true }], 35), []);
    });

    test('erasing removes only the CURRENT spell, never the history behind it', () => {
        const tl = withRejoinAt([{ from: 20, out: true }, { from: 30, out: false }, { from: 40, out: true }], 40);
        assert.deepEqual(tl, [{ from: 20, out: true }, { from: 30, out: false }]);
        assert.equal(isOptedOutAt(tl, 25), true, 'the earlier spell is still on record');
        assert.equal(isOptedOutAt(tl, 45), false);
    });

    test('un-ticking when she is already contributing records nothing', () => {
        const already = [{ from: 40, out: true }, { from: 50, out: false }];
        assert.deepEqual(withRejoinAt(already, 60), already);
        assert.deepEqual(withRejoinAt([], 60), []);
    });
});
