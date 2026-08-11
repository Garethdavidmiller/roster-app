/**
 * overtime-format.test.mjs — the client's words and its clock.
 * Run with: node --test overtime-format.test.mjs   (no mocks; part of test:hygiene)
 *
 * Two things are under test and only one of them looks important.
 *
 * The CLOCK is the important one. `clockOffset` and `submitDisposition` decide whether a member is
 * offered a Submit button in the minutes around a noon deadline — and the failure mode is not an
 * error, it is a button that quietly is not there.
 *
 * The WORDS matter for one specific reason: `countsCopy` is where "no response" and "not available"
 * could be collapsed into each other. Everything else in the feature keeps them apart; a summary
 * line that read "0 unavailable" would undo all of it in the one place a clerk actually looks.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    clockOffset, submitDisposition, shouldResyncClock, SUBMIT_GRACE_MS, DEADLINE_SYNC_WINDOW_MS,
    shortDate, longDate, weekLabel, weekSpan, deadlineLabel, phaseCopy, rowStateCopy,
    countsCopy, answerCopy, isUnavailable, weekSummary,
} from './overtime-format.js';

describe('the corrected clock', () => {
    test('a zero-latency exchange gives the raw difference', () => {
        // t=1000 out, t=1000 back, server said 5000 → we are 4000ms behind.
        assert.equal(clockOffset(5000, 1000, 1000), 4000);
    });

    test('the ROUND TRIP is removed, not folded into the offset', () => {
        // Sent at 1000, answered at 1400 (400ms round trip), server said 5000. The server generated
        // that reading around t=1200 our time, so the offset is 3800 — not the naive 3600.
        //
        // 200ms of error is not pedantry here: it is the difference between a submission landing on
        // either side of 12:00:00 for somebody who pressed the button at the last moment.
        assert.equal(clockOffset(5000, 1000, 1400), 3800);
    });

    test('a clock running FAST yields a negative offset', () => {
        assert.equal(clockOffset(1000, 5000, 5000), -4000);
    });

    test('a nonsense round trip cannot make the offset worse', () => {
        // tReceive before tSend should not happen, but a device that adjusts its clock mid-request
        // can produce it. Clamping keeps the answer merely wrong rather than wildly wrong.
        assert.equal(clockOffset(5000, 2000, 1000), 4000);
    });
});

describe('what the Submit button may do', () => {
    const DEADLINE = 1_000_000;

    test('before the deadline it is simply open', () => {
        assert.equal(submitDisposition(DEADLINE - 1, DEADLINE), 'open');
    });

    test('AT the deadline, and through the grace band, it asks the server rather than refusing', () => {
        // THE most important assertion in this file. A client that renders "closed" from its own
        // clock has denied somebody who was in time, and left them no recourse at all — where a
        // server rejection at least produces a true message they can act on.
        assert.equal(submitDisposition(DEADLINE, DEADLINE), 'check-with-server');
        assert.equal(submitDisposition(DEADLINE + SUBMIT_GRACE_MS - 1, DEADLINE), 'check-with-server');
    });

    test('well past the band it finally reads closed', () => {
        assert.equal(submitDisposition(DEADLINE + SUBMIT_GRACE_MS, DEADLINE), 'closed');
    });

    test('the grace band is generous enough to cover real device clock skew', () => {
        // Sized for skew first and round trip second. A one-minute band would be arithmetically
        // tidy and would refuse a phone that is ninety seconds fast.
        assert.ok(SUBMIT_GRACE_MS >= 10 * 60 * 1000);
    });

    test('the resync window is SHORTER than the grace band, and that ordering is deliberate', () => {
        // Resync happens BEFORE the boundary so the page corrects itself while it still matters;
        // the grace band is the wider net for the moment after. If resync were the wider of the two
        // the page would refresh only after it had already gone stale.
        assert.ok(DEADLINE_SYNC_WINDOW_MS < SUBMIT_GRACE_MS);
    });
});

describe('when to re-ask the server', () => {
    const D = 1_000_000;

    test('it resyncs either side of a deadline', () => {
        assert.equal(shouldResyncClock(D - 1000, [D]), true);
        assert.equal(shouldResyncClock(D + 1000, [D]), true);
    });

    test('and not when every deadline is far away', () => {
        assert.equal(shouldResyncClock(D - DEADLINE_SYNC_WINDOW_MS * 2, [D]), false);
        assert.equal(shouldResyncClock(D, []), false);
        assert.equal(shouldResyncClock(D, null), false);
    });

    test('ANY nearby deadline triggers it, not just the first', () => {
        // A member can have two open weeks whose deadlines fall on the same Tuesday — one closing,
        // one opening. Checking only the earliest would leave the page stale for the other.
        assert.equal(shouldResyncClock(D, [D + 9_000_000, D]), true);
    });
});

describe('counts — where no response could be lost', () => {
    test('no response is stated as its own number, always', () => {
        assert.equal(countsCopy(1, 1), '1 of 1 form received · 0 no response');
        assert.equal(countsCopy(24, 21), '21 of 24 forms received · 3 no response');
    });

    test('a whole team that has not answered still reads as no response, never as unavailable', () => {
        assert.equal(countsCopy(24, 0), '0 of 24 forms received · 24 no response');
    });

    test('the count never goes negative if received somehow exceeds expected', () => {
        // Can only happen with stale data mid-refresh, but "-1 no response" would look like a bug in
        // the figures rather than in the timing, and a clerk would rightly stop trusting the card.
        assert.equal(countsCopy(1, 2), '2 of 1 form received · 0 no response');
    });

    test('the singular/plural agrees with the EXPECTED count, which is the beta case', () => {
        // A restricted-beta window has one participant. "1 of 1 forms" reads as a bug.
        assert.match(countsCopy(1, 0), /1 form received/);
        assert.match(countsCopy(2, 0), /2 forms received/);
    });
});

describe('answers in words', () => {
    test('every stored mode has copy, and it names the concrete times', () => {
        assert.equal(answerCopy({ mode: 'unavailable' }), 'Not available');
        assert.equal(answerCopy({ mode: 'all_day' }), 'Available all day');
        assert.equal(answerCopy({ mode: 'before', until: '07:00' }), 'Available before 07:00');
        assert.equal(answerCopy({ mode: 'after', from: '15:00' }), 'Available after 15:00');
        assert.equal(answerCopy({ mode: 'before_after', until: '07:00', from: '15:00' }),
            'Available before 07:00 and after 15:00');
        assert.equal(answerCopy({ mode: 'custom', start: '18:00', end: '23:00', nextDay: false }),
            'Available 18:00–23:00');
    });

    test('an overnight period SAYS next day', () => {
        // Without it, "22:00–02:00" reads as a four-hour gap in the middle of the night rather than
        // as availability that crosses midnight.
        assert.equal(answerCopy({ mode: 'custom', start: '22:00', end: '02:00', nextDay: true }),
            'Available 22:00–02:00 next day');
    });

    test('an absent or unrecognised answer reads as NOT ANSWERED, never as unavailable', () => {
        // The same invariant as the counts, one level down. Defaulting to "Not available" here
        // would silently answer on somebody's behalf in a Manager's own view.
        for (const bad of [null, undefined, {}, { mode: 'nonsense' }, 'all_day']) {
            assert.equal(answerCopy(bad), 'Not answered');
        }
    });

    test('isUnavailable is true only for an explicit unavailable answer', () => {
        assert.equal(isUnavailable({ mode: 'unavailable' }), true);
        assert.equal(isUnavailable({ mode: 'all_day' }), false);
        assert.equal(isUnavailable(null), false, 'no answer is not an unavailable answer');
    });
});

describe('week summaries', () => {
    const week = (...modes) => Object.fromEntries(modes.map((m, i) => [`d${i}`, { mode: m }]));

    test('all, none and some each read differently', () => {
        assert.equal(weekSummary(week('all_day', 'all_day')), 'Available on every day');
        assert.equal(weekSummary(week('unavailable', 'unavailable')), 'Not available on any day');
        assert.equal(weekSummary(week('all_day', 'unavailable', 'after')), 'Available on 2 of 3 days');
    });

    test('an empty week says so rather than claiming nobody is available', () => {
        assert.equal(weekSummary({}), 'No answers');
        assert.equal(weekSummary(null), 'No answers');
    });
});

describe('dates and deadlines', () => {
    test('dates are named the way staff name them', () => {
        assert.equal(shortDate('2026-09-05'), 'Sat 5 Sep');
        assert.equal(longDate('2026-09-05'), 'Saturday 5 September 2026');
        assert.equal(weekLabel('2026-09-05'), 'Week ending Saturday 5 September 2026');
        assert.equal(weekSpan('2026-08-30', '2026-09-05'), 'Sun 30 Aug – Sat 5 Sep');
    });

    test('a deadline is shown in LONDON time, whatever the device is set to', () => {
        // A phone left on holiday time must still show staff the deadline the roster office means.
        // 11:00Z in August is 12:00 BST.
        assert.equal(deadlineLabel(Date.parse('2026-08-18T11:00:00Z')), 'Tue 18 Aug · 12:00');
        // …and 12:00Z in December is 12:00 GMT — the same words, a different instant.
        assert.equal(deadlineLabel(Date.parse('2026-12-22T12:00:00Z')), 'Tue 22 Dec · 12:00');
    });

    test('a missing deadline renders as nothing rather than as 1970', () => {
        assert.equal(deadlineLabel(0), '');
        assert.equal(deadlineLabel(undefined), '');
    });

    test('month and year boundaries do not shift the day name', () => {
        assert.equal(shortDate('2027-01-01'), 'Fri 1 Jan');
        assert.equal(shortDate('2028-02-29'), 'Tue 29 Feb');
    });
});

describe('states in words', () => {
    test('each phase has calm, factual copy and no countdown', () => {
        assert.match(phaseCopy('INITIAL_OPEN'), /^Open/);
        assert.match(phaseCopy('FINAL_OPEN'), /^Open/);
        assert.equal(phaseCopy('CLOSED'), 'Closed');
        for (const p of ['INITIAL_OPEN', 'FINAL_OPEN', 'CLOSED']) {
            assert.equal(/!/.test(phaseCopy(p)), false, 'no exclamation marks — the app is calm');
        }
    });

    test('a missing window says nobody was ASKED, not that nobody was needed', () => {
        // The wording is the whole guard. "No form" phrased neutrally invites the reading that none
        // was required, which is exactly the conclusion this row exists to prevent.
        const missed = rowStateCopy('missed');
        assert.match(missed.label, /no availability window was created/);
        assert.equal(missed.tone, 'bad');
    });

    test('the four states have distinct labels and escalating tone', () => {
        const labels = ['created', 'not-created', 'not-created-initial-passed', 'missed'].map(rowStateCopy);
        assert.equal(new Set(labels.map(l => l.label)).size, 4);
        assert.deepEqual(labels.map(l => l.tone), ['ok', 'warn', 'bad', 'bad']);
    });

    test('an unknown state falls back to the LOUDEST reading, not the quietest', () => {
        // Fail noisy. An unrecognised state is a bug, and a bug that renders as "Created" hides
        // itself; one that renders as "Missed" gets reported.
        assert.equal(rowStateCopy('something-new').tone, 'bad');
    });
});
