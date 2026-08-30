/**
 * links-fatigue.test.mjs — the ORR p3 fatigue factors, assessed against a link design.
 * Run: node --test links-fatigue.test.mjs   (part of `npm run test:hygiene`)
 *
 * WHY THE WEIGHTING HERE. This module's output goes in front of a manager assessing a roster
 * proposal for fatigue. The dangerous failure is not a wrong number — it is a design that shows NO
 * findings and is read as approved. So the cases below lean hard on:
 *
 *   · the boundaries (05:00 is early, 07:00 is not — an off-by-one here silently reclassifies a
 *     whole morning);
 *   · FF11 being genuinely DIFFERENT from the consecutive-worked-days check it looks like;
 *   · the night factors flipping from "not applicable" to "present" the moment a night duty
 *     appears, because that is the one case where silence would be indistinguishable from safety.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    isRest, isWorked, dutyMinutes, isEarlyStart, isVeryEarlyStart, coversNightWindow,
    toSequence, longestRunBetween48hBreaks, longestWorkedRun, longestRunOf,
    earlyBlocksWithShortRecovery, maxHoursInAny7Days, startTimeJumps, rotationDirection,
    assessFatigue,
} from './links-fatigue.js';

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
/** Build patterns from an array of 7-day arrays. */
const design = (...weeks) => {
    const p = {};
    weeks.forEach((w, i) => { p[String(i + 1)] = Object.fromEntries(DAYS.map((d, j) => [d, w[j]])); });
    return p;
};
const RD = 'RD';
const EARLY = '06:20-14:20';
const LATE  = '15:25-23:55';
const SPARE = 'SPARE';
const MID   = '11:00-19:30';

describe('dutyMinutes', () => {
    test('a normal duty', () => assert.equal(dutyMinutes('06:20-14:20'), 8 * 60));
    test('a duty ending exactly on the hour', () => assert.equal(dutyMinutes('15:25-23:55'), 8 * 60 + 30));
    test('RD and SPARE carry no times', () => {
        assert.equal(dutyMinutes('RD'), null);
        assert.equal(dutyMinutes('SPARE'), null);
        assert.equal(dutyMinutes(''), null);
    });
    test('a duty running past midnight gains 24h rather than going negative', () => {
        // Nothing on the current link does this — duties finish 23:55 — but a designer can type one,
        // and the naive subtraction reports MINUS 15.5 hours.
        assert.equal(dutyMinutes('16:00-00:30'), 8 * 60 + 30);
        assert.equal(dutyMinutes('22:00-06:00'), 8 * 60);
    });
});

describe('start-time classification — the boundaries are the whole rule', () => {
    test('FF2 early window is 05:00 inclusive to 07:00 exclusive', () => {
        assert.equal(isEarlyStart('05:00-13:00'), true, '05:00 is an early start');
        assert.equal(isEarlyStart('06:59-14:00'), true);
        assert.equal(isEarlyStart('07:00-15:00'), false, '07:00 is NOT an early start');
        assert.equal(isEarlyStart('04:59-13:00'), false, 'before 05:00 is FF3, not FF2');
    });
    test('FF3 is strictly before 05:00', () => {
        assert.equal(isVeryEarlyStart('04:59-13:00'), true);
        assert.equal(isVeryEarlyStart('05:00-13:00'), false);
    });
    test('a value with no parseable time is neither', () => {
        for (const s of ['RD', 'SPARE', 'OFF', '']) {
            assert.equal(isEarlyStart(s), false);
            assert.equal(isVeryEarlyStart(s), false);
        }
    });
});

describe('coversNightWindow (FF1)', () => {
    test('an ordinary early or late duty does not', () => {
        assert.equal(coversNightWindow(EARLY), false);
        assert.equal(coversNightWindow(LATE), false);
    });
    test('a duty finishing 23:55 does not — the link ends before midnight', () => {
        assert.equal(coversNightWindow('15:25-23:55'), false);
    });
    test('a duty crossing midnight does', () => {
        assert.equal(coversNightWindow('16:00-00:30'), true);
        assert.equal(coversNightWindow('22:00-06:00'), true);
    });
    test('a duty starting inside the window does', () => {
        assert.equal(coversNightWindow('03:00-11:00'), true);
    });
});

describe('longestRunBetween48hBreaks (FF11) — NOT the same rule as consecutive worked days', () => {
    test('a single rest day does not reset the count, but two do', () => {
        // six on, ONE off, six on: FF11 sees a 12-shift run; the consecutive-days check sees 6.
        const oneOff = design([EARLY, EARLY, EARLY, EARLY, EARLY, EARLY, RD],
                              [EARLY, EARLY, EARLY, EARLY, EARLY, EARLY, RD]);
        const seqA = toSequence(oneOff, 2);
        assert.equal(longestWorkedRun(seqA), 6, 'the existing check counts consecutive worked days');
        // No two rest days sit together anywhere here, so there is NO 48h break in the rotation at
        // all: the answer is every worked day in the cycle (12), not the sequence length (14, which
        // would count the rest days as shifts) and not 6.
        assert.equal(longestRunBetween48hBreaks(seqA), 12, 'FF11 counts shifts between 48h breaks');

        // five on, TWO off: the 48h break resets it, so both agree.
        const twoOff = design([EARLY, EARLY, EARLY, EARLY, EARLY, RD, RD],
                              [EARLY, EARLY, EARLY, EARLY, EARLY, RD, RD]);
        const seqB = toSequence(twoOff, 2);
        assert.equal(longestWorkedRun(seqB), 5);
        assert.equal(longestRunBetween48hBreaks(seqB), 5);
    });
    test('an all-worked rotation is capped at its own length, not doubled by the wrap lap', () => {
        const all = design([EARLY, EARLY, EARLY, EARLY, EARLY, EARLY, EARLY]);
        assert.equal(longestRunBetween48hBreaks(toSequence(all, 1)), 7);
        assert.equal(longestWorkedRun(toSequence(all, 1)), 7);
    });
    test('a rotation with NO 48h break anywhere returns every worked day, not the cycle length', () => {
        // The person never gets a 48h break at all. Reporting the sequence length would count rest
        // days as shifts; reporting the longest worked run would imply the break exists.
        const noBreak = design([EARLY, EARLY, RD, EARLY, EARLY, RD, EARLY]);
        const seq = toSequence(noBreak, 1);
        assert.equal(longestWorkedRun(seq), 3, 'wraps: fri, sun, mon');
        assert.equal(longestRunBetween48hBreaks(seq), 5, 'five worked days, no 48h break in the cycle');
    });

    test('an all-rest rotation is zero', () => {
        const none = design([RD, RD, RD, RD, RD, RD, RD]);
        assert.equal(longestRunBetween48hBreaks(toSequence(none, 1)), 0);
    });
    test('a run spanning the wrap point is measured whole', () => {
        // Worked at the end of line 1 and the start of line 2 — a person passes straight through.
        const wrap = design([RD, RD, RD, RD, RD, EARLY, EARLY], [EARLY, EARLY, RD, RD, RD, RD, RD]);
        assert.equal(longestWorkedRun(toSequence(wrap, 2)), 4);
    });
});

describe('earlyBlocksWithShortRecovery (FF8b)', () => {
    test('a block of 2+ earlies with fewer than 2 rest days after is flagged', () => {
        const d = design([EARLY, EARLY, EARLY, RD, LATE, LATE, RD]);
        const out = earlyBlocksWithShortRecovery(toSequence(d, 1));
        assert.equal(out.length, 1);
        assert.equal(out[0].blockLength, 3);
        assert.equal(out[0].restDays, 1);
    });
    test('a block followed by 2 rest days is not flagged', () => {
        const d = design([EARLY, EARLY, EARLY, RD, RD, LATE, LATE]);
        assert.deepEqual(earlyBlocksWithShortRecovery(toSequence(d, 1)), []);
    });
    test('a SINGLE early start is not a block — counting it would fire on nearly every design', () => {
        const d = design([EARLY, RD, LATE, LATE, LATE, RD, RD]);
        assert.deepEqual(earlyBlocksWithShortRecovery(toSequence(d, 1)), []);
    });
});

describe('maxHoursInAny7Days (MRSF 55h)', () => {
    test('sums duty lengths across a rolling week', () => {
        const d = design([EARLY, EARLY, EARLY, EARLY, EARLY, EARLY, EARLY]);   // 7 x 8h
        assert.equal(maxHoursInAny7Days(toSequence(d, 1)), 56);
    });
    test('SPARE contributes zero, so the figure is a FLOOR not an estimate', () => {
        const d = design([EARLY, EARLY, EARLY, 'SPARE', 'SPARE', 'SPARE', 'SPARE']);
        assert.equal(maxHoursInAny7Days(toSequence(d, 1)), 24,
            'four standby days count as zero hours — the real total is higher');
    });
    test('rest days contribute zero', () => {
        const d = design([EARLY, RD, RD, RD, RD, RD, RD]);
        assert.equal(maxHoursInAny7Days(toSequence(d, 1)), 8);
    });
});

describe('startTimeJumps (FF19) — the interpretation is deliberate', () => {
    test('counts a >2h swing between consecutive WORKING days', () => {
        const d = design([EARLY, LATE, RD, RD, RD, RD, RD]);   // 06:20 → 15:25 = 9h05
        assert.equal(startTimeJumps(toSequence(d, 1)).length, 1);
    });
    test('does NOT count across a rest day — a rest day is time to adjust', () => {
        const d = design([EARLY, RD, LATE, RD, RD, RD, RD]);
        assert.equal(startTimeJumps(toSequence(d, 1)).length, 0,
            'the stricter reading would count this; which applies is an open question, so the ' +
            'module documents the choice rather than hiding it');
    });
    test('a swing inside the threshold is not counted', () => {
        const d = design(['06:20-14:20', '08:00-16:00', RD, RD, RD, RD, RD]);   // 1h40
        assert.equal(startTimeJumps(toSequence(d, 1)).length, 0);
    });
    test('SPARE breaks the comparison rather than counting as a jump', () => {
        const d = design([EARLY, 'SPARE', LATE, RD, RD, RD, RD]);
        assert.equal(startTimeJumps(toSequence(d, 1)).length, 0);
    });
});

describe('rotationDirection (FF17)', () => {
    test('a forward-rotating block reports no backward steps', () => {
        const d = design([EARLY, MID, LATE, RD, RD, RD, RD]);
        const r = rotationDirection(toSequence(d, 1));
        assert.equal(r.backward, 0);
        assert.equal(r.forward, 2);
    });
    test('a backward-rotating block is counted', () => {
        const d = design([LATE, MID, EARLY, RD, RD, RD, RD]);
        const r = rotationDirection(toSequence(d, 1));
        assert.equal(r.backward, 2);
        assert.equal(r.forward, 0);
    });
});

describe('the 8h-shift run counts a cover week as an UNKNOWN, not a break', () => {
    // Found regression-checking v21.97, which ADDED this rule and got it wrong in the one direction
    // this module says it must never fail in. The rule used a plain run scan, so a spare day — which
    // has no times and therefore fails a ">= 8h" test — BROKE the run. On the shipped default design
    // that reported 5 with a green tick, against a worst case of 8 and a threshold of 7.
    //
    // A cover week is four duties whose times are not yet assigned. In the worst case they are 8h
    // duties, and the person works straight through. Reporting otherwise makes the factor go quiet
    // exactly when a cover week sits in the middle of a long stretch.
    const SHORT = '09:00-15:00';   // 6h — a real duty that does NOT count
    const spareWeek = () => [SPARE, SPARE, SPARE, SPARE, SPARE, SPARE, SPARE];
    const runOf = (d) => {
        const a = assessFatigue(d, 3);
        return a.results.find(r => r.title.includes('7 consecutive 8h'));
    };

    test('a cover week EXTENDS a block of 8h duties rather than ending it', () => {
        const d = design(
            [RD, RD, RD, EARLY, EARLY, EARLY, EARLY],
            spareWeek(),
            [EARLY, EARLY, EARLY, EARLY, RD, RD, RD],
        );
        // 4 certain + the cover week's FOUR = 8. A plain scan gives 4, which is the defect.
        assert.equal(runOf(d).value, 8);
        assert.equal(runOf(d).status, 'present', '8 is over the threshold of 7');
    });

    test('and it supplies FOUR, never seven — the run stops INSIDE the cover week', () => {
        // Two opposite errors are excluded by the same number. Counting all seven would fuse the
        // blocks either side into 12 — the v19.79 defect, which reported the live roster at 15
        // against a true 9. And the run cannot reach the block BEYOND the cover week at all: three
        // of that week's days are rest days wherever they fall, so they always break the chain.
        // That is why the answer is 8 and not 4 + 4 + 4.
        const d = design(
            [RD, RD, RD, EARLY, EARLY, EARLY, EARLY],
            spareWeek(),
            [EARLY, EARLY, EARLY, EARLY, RD, RD, RD],
        );
        assert.equal(runOf(d).value, 8, 'not 12 (seven spare days) and not 4 (a spare day as a break)');
    });

    test('a duty UNDER eight hours still breaks it — the predicate is real', () => {
        const d = design(
            [RD, RD, RD, RD, EARLY, EARLY, EARLY],
            [SHORT, RD, RD, RD, RD, RD, RD],
            [RD, RD, RD, RD, RD, RD, RD],
        );
        assert.equal(runOf(d).value, 3, 'the 6h duty is not an 8h shift and ends the run');
    });

    test('the detail states the CERTAIN figure as well as the worst case', () => {
        // The status comes from the worst case, so the reader is owed the other number — otherwise
        // a design is reported over the threshold on duties whose times nobody has chosen yet, with
        // nothing on screen saying so.
        const d = design(
            [RD, RD, RD, EARLY, EARLY, EARLY, EARLY],
            spareWeek(),
            [EARLY, EARLY, EARLY, EARLY, RD, RD, RD],
        );
        const r = runOf(d);
        assert.match(r.detail, /worst case/i);
        assert.match(r.detail, /\b4 of them are certain\b/);
    });

    test('FF15 has the same shape, and its false-clear was LIVE on the shipped default', () => {
        // Measured at v21.98: the default design reported a longest early-shift run of 3 with a
        // green tick, against a worst case of 6 and a threshold of 4. Same cause, different row —
        // which is why the spare rule is one shared helper rather than three copies.
        const d = design(
            [RD, RD, RD, EARLY, EARLY, EARLY, EARLY],
            spareWeek(),
            [EARLY, EARLY, EARLY, EARLY, RD, RD, RD],
        );
        const ff15 = assessFatigue(d, 3).results.find(r => r.code === 'FF15');
        assert.equal(ff15.value, 8);
        assert.equal(ff15.status, 'present');
    });

    test('a cover week EXTENDS a run and never CREATES one', () => {
        // The other half. This design contains no duty over twelve hours at all, so FF10 must read
        // ZERO — not four, which is what a cover week's own days would score as unknowns that might
        // be anything. A finding about nothing is how a panel teaches its reader to skip a row.
        const d = design(
            [RD, RD, RD, EARLY, EARLY, EARLY, EARLY],
            spareWeek(),
            [EARLY, EARLY, EARLY, EARLY, RD, RD, RD],
        );
        const ff10 = assessFatigue(d, 3).results.find(r => r.code === 'FF10');
        assert.equal(ff10.value, 0, 'no 12h duty exists, so no run of them can');
        assert.equal(ff10.status, 'clear');
    });

    test('a design of NOTHING BUT cover weeks reports no run for any of the three', () => {
        // The degenerate case the requireMatch rule is really for: every day is an unknown, so
        // every predicate would match in the worst case and every row would fire at once.
        const d = design(spareWeek(), spareWeek(), spareWeek());
        const a = assessFatigue(d, 3);
        for (const code of ['FF10', 'FF15']) {
            assert.equal(a.results.find(r => r.code === code).value, 0, `${code} invented a run`);
        }
        assert.equal(a.results.find(r => r.title.includes('7 consecutive 8h')).value, 0);
    });

    test('with no cover week at all the two figures agree, and it says nothing about them', () => {
        const d = design(
            [RD, RD, RD, RD, EARLY, EARLY, EARLY],
            [EARLY, EARLY, RD, RD, RD, RD, RD],
            [RD, RD, RD, RD, RD, RD, RD],
        );
        const r = runOf(d);
        assert.equal(r.value, 5);
        assert.doesNotMatch(r.detail, /worst case/i, 'no cover week, so there is nothing to qualify');
    });
});

describe('assessFatigue — the report as a whole', () => {
    /** A deliberately gentle design: forward-rotating, short blocks, generous rest. */
    const GOOD = design(
        [RD, EARLY, EARLY, MID, LATE, RD, RD],
        [RD, EARLY, EARLY, MID, LATE, RD, RD],
    );

    test('a clean design still reports every factor — silence is never the same shape as compliance', () => {
        const a = assessFatigue(GOOD, 2);
        const codes = a.results.map(r => r.code);
        for (const c of ['FF1', 'FF2', 'FF3', 'FF5', 'FF7', 'FF8b', 'FF11', 'FF15', 'FF17', 'FF19'])
            assert.ok(codes.includes(c), `${c} must appear in the report even when clear`);
        assert.ok(a.results.every(r => ['present', 'clear', 'standing', 'n/a'].includes(r.status)));
    });

    test('FF2 is reported as STANDING, not as a finding — it is unavoidable on this link', () => {
        const a = assessFatigue(GOOD, 2);
        const ff2 = a.results.find(r => r.code === 'FF2');
        assert.equal(ff2.status, 'standing');
        assert.equal(ff2.value, 4);
        assert.match(ff2.detail, /property of the operation/);
    });

    test('the night factors are NOT APPLICABLE until a night duty appears — then all of them flip', () => {
        const a = assessFatigue(GOOD, 2);
        const nightCodes = ['FF6', 'FF8', 'FF9', 'FF12', 'FF14', 'FF16', 'FF20'];
        for (const c of nightCodes)
            assert.equal(a.results.find(r => r.code === c).status, 'n/a', `${c} while no nights`);
        assert.equal(a.results.find(r => r.code === 'FF1').status, 'n/a');

        // One duty crossing midnight, and the whole night family becomes live.
        const withNight = design(
            [RD, EARLY, EARLY, MID, '16:00-00:30', RD, RD],
            [RD, EARLY, EARLY, MID, LATE, RD, RD],
        );
        const b = assessFatigue(withNight, 2);
        assert.equal(b.results.find(r => r.code === 'FF1').status, 'present');
        for (const c of nightCodes)
            assert.equal(b.results.find(r => r.code === c).status, 'present',
                `${c} must stop reading as "not applicable" once a night duty exists`);
    });

    test('every unsettled interpretation is flagged for confirmation', () => {
        // The count has moved twice and the NAME of this test moved with it the second time. It
        // read "the two unsettled interpretations" while asserting three codes — the module header
        // records the same slip — so it is now named for the property rather than the number, and
        // the number lives only in the assertion.
        //
        // The fourth is the v21.97 MRSF row: "more than 7 consecutive 8h shifts" has more than one
        // defensible reading of "8h shifts", and the module takes the one that reports rather than
        // the one that stays quiet. An unlabelled number whose definition is unagreed is this
        // module's false-assurance failure in miniature.
        const a = assessFatigue(GOOD, 2);
        const flagged = a.results.filter(r => r.confirm).map(r => r.code).sort();
        assert.deepEqual(flagged, ['FF17', 'FF18', 'FF19', 'MRSF']);
        assert.equal(a.confirmNeeded, 4);
    });

    test('a punishing design reports the cumulative factors', () => {
        const HARD = design(
            [EARLY, EARLY, EARLY, EARLY, EARLY, EARLY, EARLY],
            [EARLY, EARLY, EARLY, EARLY, EARLY, EARLY, RD],
        );
        const a = assessFatigue(HARD, 2);
        const by = (c) => a.results.filter(r => r.code === c);
        assert.equal(by('FF15')[0].status, 'present', '13 consecutive earlies');
        assert.ok(a.results.some(r => r.title.includes('55 hours') && r.status === 'present'));
        assert.ok(a.present > 0);
    });

    test('an empty design does not throw', () => {
        const a = assessFatigue({}, 4);
        assert.ok(a.results.length > 0);
        assert.equal(a.results.find(r => r.code === 'FF2').value, 0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// The v19.48 regression pass. Every one of these is a defect the module SHIPPED
// with at v19.46, and every one of them failed the same way: it made a design
// look better than it is. That is the exact failure the module's own header
// calls its dominant risk, so each gets a test from both sides.
// ─────────────────────────────────────────────────────────────────────────────

describe('FF13 is read from the real turnaround check, never hardcoded', () => {
    const RD = 'RD';
    const three = (mutate) => {
        const p = design([RD, RD, RD, RD, RD, RD, RD], [RD, RD, RD, RD, RD, RD, RD], [RD, RD, RD, RD, RD, RD, RD]);
        mutate(p);
        return p;
    };

    test('a genuine short turnaround must not show a green tick', () => {
        // 15:15–23:55 then 06:20 the next morning is 6h25m of rest. For one version FF13 rendered
        // `clear` — an affirmative all-clear sitting directly beneath the amber short-turnaround
        // row it is supposed to be the same finding as.
        const p = three(q => { q['1'].mon = '15:15-23:55'; q['1'].tue = '06:20-14:20'; });
        const ff13 = assessFatigue(p, 3).results.find(r => r.code === 'FF13');
        assert.equal(ff13.status, 'present');
        assert.equal(ff13.value, 1);
        assert.match(ff13.detail, /6h 25m/);
    });

    test('and a design with no short turnaround still reports clear', () => {
        const p = three(q => { q['1'].mon = '06:20-14:20'; q['1'].tue = '06:20-14:20'; });
        assert.equal(assessFatigue(p, 3).results.find(r => r.code === 'FF13').status, 'clear');
    });
});

describe('FF4 distinguishes NOT APPLICABLE from CLEAR', () => {
    const RD = 'RD';
    test('very early duties present but none over 8h → clear, not "not applicable"', () => {
        const p = design(['04:00-10:00', RD, RD, RD, RD, RD, RD], [RD, RD, RD, RD, RD, RD, RD]);
        const r = assessFatigue(p, 2).results;
        assert.equal(r.find(x => x.code === 'FF3').status, 'present', 'FF3 counts the very-early duty');
        // …so FF4 saying "not applicable" would directly contradict the row above it.
        assert.equal(r.find(x => x.code === 'FF4').status, 'clear');
    });
    test('no very early duty at all → genuinely not applicable', () => {
        const p = design(['06:20-14:20', RD, RD, RD, RD, RD, RD], [RD, RD, RD, RD, RD, RD, RD]);
        assert.equal(assessFatigue(p, 2).results.find(x => x.code === 'FF4').status, 'n/a');
    });
    test('a very early duty over 8h → present', () => {
        const p = design(['04:00-13:00', RD, RD, RD, RD, RD, RD], [RD, RD, RD, RD, RD, RD, RD]);
        assert.equal(assessFatigue(p, 2).results.find(x => x.code === 'FF4').status, 'present');
    });
});

describe('earlyBlocksWithShortRecovery laps the rotation', () => {
    const RD = 'RD', E = '06:20-14:20', L = '11:00-19:00';
    test('a block straddling the wrap point is one block, not two halves', () => {
        // Last day of line 3 and first day of line 1 are earlies, then a SINGLE rest day. Scanning
        // 0 → n split this into two blocks of one and reported nothing at all.
        const p = design([E, RD, L, RD, RD, RD, RD], [RD, RD, RD, RD, RD, RD, RD], [RD, RD, RD, RD, RD, RD, E]);
        const blocks = earlyBlocksWithShortRecovery(toSequence(p, 3));
        assert.equal(blocks.length, 1);
        assert.equal(blocks[0].blockLength, 2);
        assert.equal(blocks[0].restDays, 1);
        assert.equal(blocks[0].fromLine, 3, 'the block STARTS on line 3, not line 1');
    });
    test('two rest days after the straddling block is still recovery', () => {
        const p = design([E, RD, RD, L, RD, RD, RD], [RD, RD, RD, RD, RD, RD, RD], [RD, RD, RD, RD, RD, RD, E]);
        assert.deepEqual(earlyBlocksWithShortRecovery(toSequence(p, 3)), []);
    });
    test('an all-early rotation is one block with no recovery', () => {
        const p = design([E, E, E, E, E, E, E]);
        const blocks = earlyBlocksWithShortRecovery(toSequence(p, 1));
        assert.equal(blocks.length, 1);
        assert.equal(blocks[0].blockLength, 7);
        assert.equal(blocks[0].restDays, 0);
    });
});

describe('coversNightWindow is exact, not sampled', () => {
    test('a duty crossing midnight by minutes still counts', () => {
        // The 15-minute sampling walk answered this by where its samples happened to land:
        // "23:00-00:10" was caught and "23:50-00:05" was not.
        assert.equal(coversNightWindow('23:50-00:05'), true);
        assert.equal(coversNightWindow('23:00-00:10'), true);
        assert.equal(coversNightWindow('23:59-00:01'), true);
    });
    test('a duty that stops at midnight does not', () => {
        assert.equal(coversNightWindow('15:25-23:55'), false);
        assert.equal(coversNightWindow('16:00-00:00'), false, 'ends exactly at midnight — no night minutes');
    });
    test('the 05:00 boundary is exclusive at the far end', () => {
        assert.equal(coversNightWindow('20:00-05:00'), true, 'runs right up to 05:00');
        assert.equal(coversNightWindow('05:00-13:00'), false);
        assert.equal(coversNightWindow('04:59-13:00'), true);
    });
});

test('the night family is a GROUP NAME, not a verdict (v19.52)', () => {
    // `family` was 'Night (not applicable)'. links-analysis.js renders the family as a heading, so
    // the moment a design acquired a night duty — the one state this family exists to make loud —
    // it printed an all-clear headline over seven rows that had all just turned `present`.
    // Applicability is per-row `status` and moves with the design; the group name does not.
    const D = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    const mk = (...weeks) => {
        const p = {};
        weeks.forEach((w, i) => { p[String(i + 1)] = Object.fromEntries(D.map((d, j) => [d, w[j]])); });
        return p;
    };
    const RD = 'RD';
    const nightless = assessFatigue(mk(['06:20-14:20', RD, RD, RD, RD, RD, RD], [RD, RD, RD, RD, RD, RD, RD]), 2);
    const withNight = assessFatigue(mk(['22:00-06:00', RD, RD, RD, RD, RD, RD], [RD, RD, RD, RD, RD, RD, RD]), 2);

    for (const [label, res] of [['nightless', nightless], ['withNight', withNight]]) {
        const fams = new Set(res.results.map(r => r.family));
        for (const f of fams) {
            assert.doesNotMatch(f, /not applicable|n\/a|clear|present/i,
                `${label}: family "${f}" states a verdict — that belongs in status, not the group name`);
        }
    }
    // The family string is STABLE across both states — it is the rows underneath that change.
    const famOf = (res) => res.results.find(r => r.code === 'FF6').family;
    assert.equal(famOf(nightless), famOf(withNight));
    // …and the statuses really do flip, so the test above is not vacuous.
    assert.equal(nightless.results.find(r => r.code === 'FF6').status, 'n/a');
    assert.equal(withNight.results.find(r => r.code === 'FF6').status, 'present');
});

// ── FF18 — the row that reported a hardcoded status for 23 versions (v19.69) ─────────────────────
// It said `standing` no matter what the design did, from v19.46 to v19.68, which broke this
// module's own "never hardcode a status" rule for the second time (FF13 was the first, v19.48).
// It was written when the factor was read as being about the weekly CADENCE — true of every link,
// so the row could never say anything. The owner corrected the reading: the concern is the SIZE OF
// THE STEP, which is a design choice and, since v19.58, measurable.
//
// So the cases below pin the two things a hardcoded status could not do: RESPOND to the design, and
// REFUSE to answer when it cannot be computed.
describe('FF18 — the week-to-week step', () => {
    const ff18 = (/** @type {any} */ d) => assessFatigue(d, Object.keys(d).length).results.find(r => r.code === 'FF18');

    test('the reported step RESPONDS to the design — the whole point of the fix', () => {
        // Every line the same shift: the working day never moves week to week.
        const flat = ff18(design(
            [RD, EARLY, EARLY, EARLY, EARLY, EARLY, RD],
            [RD, EARLY, EARLY, EARLY, EARLY, EARLY, RD],
            [RD, EARLY, EARLY, EARLY, EARLY, EARLY, RD],
        ));
        // Alternating early/late: the largest step this vocabulary allows.
        const swinging = ff18(design(
            [RD, EARLY, EARLY, EARLY, EARLY, EARLY, RD],
            [RD, LATE,  LATE,  LATE,  LATE,  LATE,  RD],
            [RD, EARLY, EARLY, EARLY, EARLY, EARLY, RD],
        ));
        assert.notEqual(flat.value, swinging.value, 'a hardcoded row would report the same for both');
        assert.match(String(flat.value), /0h 0m/);
        // The rotation LAPS — line 3 → line 1 is a boundary like any other — so the three steps are
        // 9h05, 9h05 and 0, giving a mean of 6h03 and a worst of 9h05. Asserting the mean alone
        // would have hidden the lap; the first draft of this test expected 9h05 and was wrong.
        assert.match(String(swinging.value), /typically 6h 3m/);
        assert.match(String(swinging.detail), /largest is 9h 5m/);
        assert.match(String(swinging.detail), /2 of 3 line boundaries move by more than 2 hours/);
    });

    test('the CADENCE stays `standing` however gentle the step — it is not a pass/fail row', () => {
        const gentle = ff18(design(
            [RD, EARLY, EARLY, EARLY, EARLY, EARLY, RD],
            [RD, EARLY, EARLY, EARLY, EARLY, EARLY, RD],
        ));
        // `standing`, never `clear`: a weekly rotation IS present in every link. Turning it
        // `present` above some figure would invent a threshold the ORR does not give, which is the
        // pass/fail rendering this panel exists to avoid.
        assert.equal(gentle.status, 'standing');
    });

    test('a design with no times at all REFUSES to answer rather than claiming a step', () => {
        const allSpare = ff18(design(
            ['SPARE', 'SPARE', 'SPARE', 'SPARE', 'SPARE', 'SPARE', 'SPARE'],
            ['SPARE', 'SPARE', 'SPARE', 'SPARE', 'SPARE', 'SPARE', 'SPARE'],
        ));
        // n/a, NOT clear and NOT standing-with-a-zero: an unmeasurable step reported as "no change"
        // is the flattery this module exists to prevent — and it is exactly how a spare week could
        // otherwise be made to look like a gentle transition.
        assert.equal(allSpare.status, 'n/a');
        assert.doesNotMatch(String(allSpare.value), /typically/);
    });

    test('spare boundaries are excluded and SAID to be, never counted as no change', () => {
        const withSpare = ff18(design(
            [RD, EARLY, EARLY, EARLY, EARLY, EARLY, RD],
            ['SPARE', 'SPARE', 'SPARE', 'SPARE', 'SPARE', 'SPARE', 'SPARE'],
            [RD, LATE, LATE, LATE, LATE, LATE, RD],
        ));
        assert.equal(withSpare.status, 'standing');
        assert.match(String(withSpare.detail), /carry no times \(spare weeks\) and are excluded/);
    });

    // The v19.69 cases all passed `lines` EQUAL to the key count, so none of them could see this:
    // the measurability guard was `unmeasurable < lines`, comparing boundaries walked against the
    // count the CALLER claims. A partly-built design has fewer keys than lines, and an empty one has
    // none — which sailed through as "measurable" and reported a confident 0h 0m about a design with
    // no shifts in it. Found by the v19.70 regression pass.
    test('a design with FEWER lines than claimed does not invent a measurement', () => {
        const empty = assessFatigue({}, 28).results.find(r => r.code === 'FF18');
        assert.equal(empty.status, 'n/a');
        assert.doesNotMatch(String(empty.value), /typically/);

        // …and the same design part-built DOES measure, so the guard is not simply always-off.
        const partial = assessFatigue(design(
            [RD, EARLY, EARLY, EARLY, EARLY, EARLY, RD],
            [RD, LATE,  LATE,  LATE,  LATE,  LATE,  RD],
        ), 28).results.find(r => r.code === 'FF18');
        assert.equal(partial.status, 'standing');
        assert.match(String(partial.value), /typically/);
    });

    test('the stated threshold is the one actually counted against', () => {
        const d = ff18(design(
            [RD, EARLY, EARLY, EARLY, EARLY, EARLY, RD],
            [RD, LATE,  LATE,  LATE,  LATE,  LATE,  RD],
        ));
        assert.equal(d.threshold, '2h');
        assert.match(String(d.detail), /more than 2 hours/);
    });
});

// ── A SPARE WEEK IS FOUR DUTIES, NOT SEVEN (v19.79) ─────────────────────────────────────────────
// Both run checks counted a spare week as seven worked days, justified in a comment as
// "over-reporting is the safe direction for a fatigue check". It is not. A 7/7 spare week BRIDGES
// the blocks either side of it and fuses them into one phantom run — the live main roster reported
// 15 and the bilingual 14, against true ceilings of 9 and 8. Since 13 consecutive days is a HARD
// ceiling on the UK railway, that is not caution: it reports a breach that does not exist on the
// roster people work today, and every reader who knows the real link then discounts the row.
//
// Nothing in this suite caught it, because nothing here used SPARE at all. That is the gap these
// cases close, and each one pins a DIRECTION — over-count on one side, under-count on the other.
describe('spare weeks in the run checks', () => {
    const SPARE_WK = [SPARE, SPARE, SPARE, SPARE, SPARE, SPARE, SPARE];
    const WORKED_WK = [EARLY, EARLY, EARLY, EARLY, EARLY, EARLY, EARLY];
    const REST_WK = [RD, RD, RD, RD, RD, RD, RD];

    test('a spare week CANNOT bridge the blocks either side of it — the exact v19.78 defect', () => {
        // Two full worked weeks with a spare week between them. Counted as 7/7 the answer is 21;
        // four duties in seven days cannot fill a week, so the true ceiling is 7 + 4 = 11.
        const seq = toSequence(design(WORKED_WK, SPARE_WK, WORKED_WK, REST_WK), 4);
        assert.equal(longestWorkedRun(seq), 11);
    });

    test('a spare week on its own contributes at most four consecutive days', () => {
        const seq = toSequence(design(REST_WK, SPARE_WK, REST_WK), 3);
        assert.equal(longestWorkedRun(seq), 4);
    });

    test('two ADJACENT spare weeks legitimately chain to eight', () => {
        // The first week's four duties at its end, the second's four at its start. This is the
        // bilingual roster, whose spare weeks are 1 and 8 of 8 and so wrap into each other — so it
        // must NOT be clamped to four, or the check under-reports the real chain.
        const seq = toSequence(design(REST_WK, SPARE_WK, SPARE_WK, REST_WK), 4);
        assert.equal(longestWorkedRun(seq), 8);
    });

    test('a design with no spare weeks is completely unaffected', () => {
        const seq = toSequence(design(
            [RD, EARLY, EARLY, EARLY, EARLY, EARLY, RD],
            [RD, LATE, LATE, LATE, LATE, LATE, RD],
        ), 2);
        assert.equal(longestWorkedRun(seq), 5);
    });

    test('FF11: a spare duty following a real 48h break RESETS the count', () => {
        // Found by hand-walking the bilingual roster: the first version of the SPARE branch
        // incremented the run without honouring the reset the worked branch does, so the count ran
        // straight through a genuine 48h break and reported 23 where the true answer is 15. The
        // wrong number was entirely plausible, which is why it needs a test and not a reading.
        const seq = toSequence(design(
            [EARLY, EARLY, EARLY, EARLY, EARLY, RD, RD],   // 5 shifts, then a 48h break
            SPARE_WK,                                       // 4 duties — a NEW count, not a continuation
            REST_WK,
        ), 3);
        assert.equal(longestRunBetween48hBreaks(seq), 5);
    });

    test('FF11: a spare week supplies no 48h break of its own', () => {
        // Its three rest days need not be adjacent, so in the worst case the week gives four
        // shifts and no break at all — the run carries through it into the following week.
        const seq = toSequence(design(
            [RD, RD, EARLY, EARLY, EARLY, EARLY, EARLY],   // 48h break, then 5
            SPARE_WK,                                       // +4, no break
            [EARLY, EARLY, RD, RD, RD, RD, RD],             // +2, then a break
        ), 3);
        assert.equal(longestRunBetween48hBreaks(seq), 11);
    });
});
