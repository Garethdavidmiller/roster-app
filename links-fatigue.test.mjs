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

    test('the two unsettled interpretations are flagged for confirmation', () => {
        const a = assessFatigue(GOOD, 2);
        const flagged = a.results.filter(r => r.confirm).map(r => r.code).sort();
        assert.deepEqual(flagged, ['FF17', 'FF18', 'FF19']);
        assert.equal(a.confirmNeeded, 3);
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
