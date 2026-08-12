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
    countsCopy, answerCopy, answerTone, answerAnchorStale, isUnavailable, weekSummary, asAtLine,
    modesFor, submitFailureCopy, shiftSpanMinutes, sameAnswer, deadlineLines, receiptLine,
    declaredAgo,
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
        // "in total" is load-bearing (owner, Aug 2026): the declaration caps the member's WHOLE
        // day at twelve hours, rostered duty included. The chip is the reviewer's only sight of
        // this answer and carries no roster beside it, so the qualifier cannot be left implicit —
        // without it, "up to 12 hours" against an 07:00–15:00 duty reads as either a 12-hour
        // extension or a 12-hour total, and those differ by eight hours of somebody's day.
        assert.equal(answerCopy({ mode: 'twelve_hours' }), 'Available for up to 12 hours in total');
        assert.match(answerCopy({ mode: 'twelve_hours' }), /in total/);
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

    // ── The roster moving under a saved answer ──────────────────────────────────────────────────
    //
    // The stored schema keeps concrete times so a roster change cannot re-point a declaration. That
    // is right, and it means a saved answer can quietly stop describing the day it was made about.
    // These pin the three ways of getting the detection wrong: missing it, inventing it, and
    // claiming it when the roster is simply unknown.
    describe('a saved answer whose shift has moved', () => {
        const shift = (start, end) => ({ hasTime: true, start, end, shift: `${start}-${end}`, isRest: false });
        const rest  = { hasTime: false, start: '', end: '', shift: 'RD', isRest: true };

        test('a boundary that no longer matches the roster is flagged', () => {
            assert.equal(answerAnchorStale({ mode: 'after', from: '15:00' }, shift('07:00', '20:00')), true);
            assert.equal(answerAnchorStale({ mode: 'before', until: '07:00' }, shift('12:00', '20:00')), true);
            assert.equal(answerAnchorStale(
                { mode: 'before_after', until: '07:00', from: '15:00' }, shift('07:00', '20:00')), true,
                'either half moving is enough');
        });

        test('a boundary that still matches is NOT flagged', () => {
            assert.equal(answerAnchorStale({ mode: 'after', from: '15:00' }, shift('07:00', '15:00')), false);
            assert.equal(answerAnchorStale({ mode: 'before', until: '07:00' }, shift('07:00', '15:00')), false);
            assert.equal(answerAnchorStale(
                { mode: 'before_after', until: '07:00', from: '15:00' }, shift('07:00', '15:00')), false);
        });

        test('a shift that has become a REST DAY is flagged — the anchor is gone entirely', () => {
            // The tempting shortcut is to compare times and skip when there are none, which silently
            // passes exactly the largest change a roster can make to somebody's day.
            assert.equal(answerAnchorStale({ mode: 'after', from: '15:00' }, rest), true);
        });

        test('an answer carrying nothing from the roster is never flagged', () => {
            // unavailable and all_day have no boundary; a custom range is the member's own times,
            // which the roster never supplied and so cannot invalidate.
            for (const day of [{ mode: 'unavailable' }, { mode: 'all_day' },
                { mode: 'custom', start: '18:00', end: '23:00', nextDay: false }]) {
                assert.equal(answerAnchorStale(day, shift('07:00', '15:00')), false, JSON.stringify(day));
                assert.equal(answerAnchorStale(day, rest), false, JSON.stringify(day));
            }
        });

        test('UNKNOWN roster is not a changed roster', () => {
            // `null` is what the form holds when the context read failed. Telling a member their
            // answer is out of date on the strength of a failed query would be the same invention
            // this feature refuses everywhere else — and it would fire on all seven days at once.
            assert.equal(answerAnchorStale({ mode: 'after', from: '15:00' }, null), false);
            assert.equal(answerAnchorStale({ mode: 'after', from: '15:00' }, undefined), false);
        });

        test('no answer at all is not a stale answer', () => {
            assert.equal(answerAnchorStale(null, shift('07:00', '15:00')), false);
            assert.equal(answerAnchorStale({}, shift('07:00', '15:00')), false);
        });
    });

    // ── The tone, which is the same invariant expressed in colour ───────────────────────────────
    //
    // `answerCopy` is careful never to render an absent answer as "Not available". `answerTone`
    // decides what that chip LOOKS like, so it can undo that care without changing a word: paint
    // `none` and `no` alike and a Manager scanning a column of chips cannot tell somebody who
    // declined from somebody who never replied — which is precisely the distinction the day panel's
    // three sections exist to preserve.
    test('the three tones are three, and none of them collapses into another', () => {
        assert.equal(answerTone({ mode: 'unavailable' }), 'no');
        assert.equal(answerTone({ mode: 'all_day' }), 'yes');
        assert.equal(answerTone(null), 'none');
        assert.equal(new Set(['no', 'yes', 'none']).size, 3);
    });

    test('every mode that offers ANY time reads as available, not just all_day', () => {
        // A partial offer is an offer. Toning "Available after 15:00" as `no` would hide real
        // cover from the one view that exists to find it.
        for (const day of [
            { mode: 'all_day' },
            { mode: 'before', until: '07:00' },
            { mode: 'after', from: '15:00' },
            { mode: 'before_after', until: '07:00', from: '15:00' },
            { mode: 'custom', start: '18:00', end: '23:00' },
        ]) assert.equal(answerTone(day), 'yes', JSON.stringify(day));
    });

    test('a malformed answer tones as NONE — the honest state, never as a decision', () => {
        // Matches `answerCopy`'s "Not answered" for the same inputs. If these two ever disagreed,
        // a chip would read "Not answered" in the colour of a definite answer.
        for (const bad of [undefined, {}, { mode: '' }, 'all_day', 7]) {
            assert.equal(answerTone(bad), 'none', JSON.stringify(bad));
            assert.equal(answerCopy(bad), 'Not answered', JSON.stringify(bad));
        }
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
        // Both open phases must SAY they are open — that is the one fact a member needs from this
        // line, and it has to survive a rewrite of the rest of it.
        assert.match(phaseCopy('INITIAL_OPEN'), /open/i);
        assert.match(phaseCopy('FINAL_OPEN'), /open/i);
        assert.equal(phaseCopy('CLOSED'), 'Closed');
        for (const p of ['INITIAL_OPEN', 'FINAL_OPEN', 'CLOSED']) {
            assert.equal(/!/.test(phaseCopy(p)), false, 'no exclamation marks — the app is calm');
        }
    });

    test('the printed sheet states when the data was READ, not when it was printed', () => {
        // A sheet of names is acted on away from the screen, and availability keeps changing until
        // the final deadline — so the one thing paper must carry is its own age. "As at" is the
        // honest framing: it is stamped at render, and a page left open for an hour then printed
        // would otherwise claim a freshness its contents do not have.
        const line = asAtLine(Date.parse('2026-08-11T10:00:00Z'));
        assert.match(line, /as at/i);
        assert.match(line, /11 Aug/, 'it names the actual moment, not just "recently"');
        assert.match(line, /11:00/, 'in London wall-clock, like every other time on the page');
        assert.match(line, /final deadline/, 'and says what will make it stale');
    });

    test('and it carries no POSITIONAL word — it is written for a page it never sees', () => {
        // It said "the final deadline above" and the deadline prints on the next line DOWN. Invisible
        // while writing the sentence, obvious on the page. This copy is authored in a module with no
        // layout, so directions are a standing hazard rather than a one-off slip.
        assert.equal(/\b(above|below|left|right|opposite)\b/i.test(asAtLine(Date.now())), false);
    });

    test('and the two open phases are DISTINGUISHABLE, or the line is decoration', () => {
        assert.notEqual(phaseCopy('INITIAL_OPEN'), phaseCopy('FINAL_OPEN'));
    });

    test('no phase names the DRAFT ROSTER — a document the member never receives', () => {
        // The reported defect, pinned. "Open — the draft roster has been planned" was DATE-accurate
        // (for a week ending Sat 22 Aug the draft really is Thu 6 Aug) and still wrong: the draft is
        // an internal artefact of the roster office, and "the roster" to staff means the one that
        // comes out on the Thursday. So the line announced that the thing they were waiting for had
        // already happened, five days before they saw anything.
        //
        // Scoped to the member's phase line, not to the whole app: the REVIEWER's surfaces and the
        // operations doc may say "draft roster" freely, because that is their document.
        for (const p of ['INITIAL_OPEN', 'FINAL_OPEN', 'CLOSED']) {
            assert.equal(/draft/i.test(phaseCopy(p)), false, `phaseCopy('${p}') names the draft roster`);
        }
    });

    test('a missing window says nobody was ASKED, not that nobody was needed', () => {
        // The wording is the whole guard. "No form" phrased neutrally invites the reading that none
        // was required, which is exactly the conclusion this row exists to prevent.
        const missed = rowStateCopy('missed');
        assert.match(missed.label, /no form was opened/);
        // WINDOW is our word for the stored record, never the reviewer's. The page calls it a
        // form everywhere a person can see, and this label was the one place it leaked.
        for (const st of ['created', 'not-created', 'not-created-initial-passed', 'missed']) {
            assert.doesNotMatch(rowStateCopy(st).label, /window/i, st);
        }
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

describe('which modes a day may offer', () => {
    // The rule lived in overtime-roster.js — which imports the Firebase SDK, so no test could
    // reach it — and its untested branch was wrong in production shape: an overnight duty offered
    // anchors the server refuses. Moving the rule here is what made this suite possible; these
    // cases are why it was needed.
    const timed     = { hasTime: true,  overnight: false, start: '06:00', end: '14:00', rosteredMinutes: 480 };
    const night     = { hasTime: true,  overnight: true,  start: '22:00', end: '07:00', rosteredMinutes: 540 };
    const rest      = { hasTime: false, overnight: false, start: '',      end: '', rosteredMinutes: 0 };

    test('a plain timed duty offers everything', () => {
        assert.deepEqual(modesFor(timed),
            ['unavailable', 'all_day', 'twelve_hours', 'before', 'after', 'before_after', 'custom']);
    });

    test('no context, or no duty time, offers only the unanchored four', () => {
        assert.deepEqual(modesFor(null), ['unavailable', 'all_day', 'twelve_hours', 'custom']);
        assert.deepEqual(modesFor(rest), ['unavailable', 'all_day', 'twelve_hours', 'custom']);
    });

    test('"Up to 12 hours" is withheld ONLY where the day already reaches 12 rostered hours', () => {
        // The owner's rule: the pill appears on days where 12 hours has not already been rostered
        // as extra. A 12-hour RDW already agreed IS 720 effective minutes, so it gates the same way
        // a 12-hour ordinary shift would. The boundary is exact — 719 minutes still leaves a minute
        // to offer, which is silly in practice and correct on principle, and testing one minute
        // either side is what pins the comparison operator.
        const twelveUp = { ...timed, rosteredMinutes: 720 };
        const justUnder = { ...timed, rosteredMinutes: 719 };
        assert.equal(modesFor(twelveUp).includes('twelve_hours'), false);
        assert.ok(modesFor(justUnder).includes('twelve_hours'));
        // Everything else about the day is untouched — the gate removes ONE offer, never reshapes
        // the list around it.
        assert.deepEqual(modesFor(twelveUp),
            ['unavailable', 'all_day', 'before', 'after', 'before_after', 'custom']);
    });

    test('an UNKNOWN day length is not "already rostered 12 hours" — the pill shows', () => {
        // The gate needs a positive fact to fire. `rosteredMinutes` is null when the roster could
        // not be read; hiding the pill there would punish a failed Firestore query with a narrower
        // form, which is the wrong direction — the declaration anchors to no roster time, so it is
        // safe to offer regardless (the same reasoning that keeps all_day and custom).
        assert.ok(modesFor({ hasTime: false, overnight: false, rosteredMinutes: null }).includes('twelve_hours'));
        assert.ok(modesFor({ hasTime: true, overnight: false, start: '06:00', end: '14:00' }).includes('twelve_hours'),
            'a context predating the field entirely must behave as unknown, not as zero');
    });

    test('an overnight duty offers NO "after" and NO "before & after"', () => {
        // Dispatchers are the only grade rostered across midnight. On a 22:00–07:00 day, `end`
        // names the NEXT morning: "After 07:00" would store hours the member never declared, and
        // "Before & after duty" stores until > from — which the server refuses outright
        // (`before-after-inverted`), so the button was an offer that could never be saved.
        // Verified end-to-end before the fix: the request carried {until:'22:00', from:'07:00'}
        // and the real normaliseDay returned the refusal.
        const modes = modesFor(night);
        assert.equal(modes.includes('after'), false);
        assert.equal(modes.includes('before_after'), false);
        // The pre-duty gap that day is real, so "Before 22:00" survives — the fix narrows the
        // offers to the ones that are TRUE, it does not gut the day.
        assert.ok(modes.includes('before'));
        assert.ok(modes.includes('custom'));
    });
});

describe('how long a duty runs', () => {
    test('a same-day duty is end minus start', () => {
        assert.equal(shiftSpanMinutes('06:00', '14:00'), 480);
        assert.equal(shiftSpanMinutes('15:15', '23:55'), 520);
    });

    test('an overnight duty crosses midnight rather than going negative', () => {
        // 22:00–07:00 is how the roster writes every dispatcher night turn. Getting this wrong
        // does not error — it returns minus-900, which is not >= 720, so the 12-hour pill would
        // show on a day that might genuinely reach twelve hours. The failure would be an OFFER
        // that should have been withheld, invisible in any log.
        assert.equal(shiftSpanMinutes('22:00', '07:00'), 540);
        assert.equal(shiftSpanMinutes('22:30', '09:00'), 630);
    });

    test('anything that is not a pair of times has no length', () => {
        assert.equal(shiftSpanMinutes('', ''), null);
        assert.equal(shiftSpanMinutes('SPARE', '14:00'), null);
        assert.equal(shiftSpanMinutes(null, undefined), null);
    });

    test('equal times are malformed, not a 24-hour duty', () => {
        // This returned 1440 until v20.86, sharing the overnight branch. Nothing else in the app
        // reads equal times that way — the custom range refuses start === end outright, and the
        // server treats a non-advancing before/after pair as transposed.
        assert.equal(shiftSpanMinutes('08:00', '08:00'), null);
        assert.equal(shiftSpanMinutes('00:00', '00:00'), null);
    });

    test('and null means the 12-hour offer STANDS, which is the safe direction', () => {
        // The consequence of the old 1440 was 1440 >= 720, so the pill was WITHHELD on the
        // strength of a garbage reading. `modesFor` needs a positive fact to withhold; asserting
        // the null alone would not have caught that, because null is also what a rest day's
        // unknown length looks like and the two must behave the same.
        const malformed = { hasTime: true, overnight: false, start: '08:00', end: '08:00',
            rosteredMinutes: shiftSpanMinutes('08:00', '08:00') };
        assert.ok(modesFor(malformed).includes('twelve_hours'),
            'withholding an option costs the member something; offering one on a nonsense roster does not');
    });
});

describe('the two deadlines a member has', () => {
    const INITIAL = Date.parse('2026-08-18T11:00:00Z');
    const FINAL   = Date.parse('2026-08-25T11:00:00Z');

    test('both dates show, and they are different Tuesdays', () => {
        // The whole defect: only the FINAL date was ever printed, so the one deadline that decides
        // whether an answer is used was left to be inferred from a sentence.
        const text = deadlineLines('INITIAL_OPEN', INITIAL, FINAL).map(l => l.text).join(' | ');
        assert.match(text, /18 Aug/, 'the initial deadline must appear');
        assert.match(text, /25 Aug/, 'so must the final one');
    });

    test('before the first deadline, the FIRST one leads', () => {
        const lines = deadlineLines('INITIAL_OPEN', INITIAL, FINAL);
        const lead = lines.filter(l => l.lead);
        assert.equal(lead.length, 1, 'exactly one date is the one to act on');
        assert.match(lead[0].text, /18 Aug/);
    });

    test('after it, the FINAL one leads and the first turns past-tense', () => {
        const lines = deadlineLines('FINAL_OPEN', INITIAL, FINAL);
        const lead = lines.filter(l => l.lead);
        assert.equal(lead.length, 1);
        assert.match(lead[0].text, /25 Aug/);
        // The passed deadline STAYS. Dropping it would leave a member who missed it with no sign
        // that they had, which is the same silence the whole change is undoing.
        const past = lines.find(l => /18 Aug/.test(l.text));
        assert.ok(past, 'the passed deadline is still stated');
        assert.match(past.text, /were due/, 'and stated as passed');
    });

    test('a closed week names one date and offers no deadline to act on', () => {
        const lines = deadlineLines('CLOSED', INITIAL, FINAL);
        assert.equal(lines.length, 1);
        assert.match(lines[0].text, /Closed/);
        assert.equal(lines.filter(l => l.lead).length, 0,
            'nothing on a closed form is still to come');
    });

    test('no line names a document the member never sees', () => {
        // The v20.70 rule, which these lines are the newest place to break: "the draft roster" is
        // the roster office's own artefact and staff never receive it.
        for (const phase of ['INITIAL_OPEN', 'FINAL_OPEN', 'CLOSED']) {
            for (const l of deadlineLines(phase, INITIAL, FINAL)) {
                assert.doesNotMatch(l.text, /draft/i, `"${l.text}" names the draft roster`);
            }
        }
    });
});

describe('how old a declaration is', () => {
    const NOW = Date.parse('2026-08-20T09:00:00Z');
    const daysBefore = (n) => NOW - n * 86_400_000;

    test('today, yesterday, then a count', () => {
        // Relative and coarse on purpose. A clerk needs "recent" or "a while ago"; an exact
        // timestamp reads as precision about something approximate and forces them to subtract.
        assert.equal(declaredAgo(daysBefore(0), NOW), 'today');
        assert.equal(declaredAgo(daysBefore(1), NOW), 'yesterday');
        assert.equal(declaredAgo(daysBefore(19), NOW), '19 days ago');
    });

    test('nothing to date renders nothing, not "unknown"', () => {
        // The caller omits the element entirely. An "unknown" would be a statement about the
        // declaration where there is none to make.
        assert.equal(declaredAgo(0, NOW), null);
        assert.equal(declaredAgo(null, NOW), null);
        assert.equal(declaredAgo(daysBefore(3), 0), null);
    });

    test('a timestamp in the FUTURE is refused rather than rendered as "today"', () => {
        // Reachable: the row uses the corrected server clock and the stamp comes from the server,
        // but a clock correction landing between the two can invert them by a few seconds. "In 0
        // days" is meaningless and "today" would be a guess dressed as a fact.
        assert.equal(declaredAgo(NOW + 60_000, NOW), null);
    });
});

describe('the receipt for a submitted form', () => {
    test('an unsubmitted form has no receipt at all', () => {
        // Not an empty string — the caller renders nothing, so a form nobody has submitted must
        // not carry hollow chrome that looks like a receipt with the words missing.
        assert.equal(receiptLine(null), null);
        assert.equal(receiptLine({ currentRevision: 0 }), null);
    });

    test('a submitted one says when it was last updated', () => {
        const line = receiptLine({ currentRevision: 2, updatedAt: Date.parse('2026-08-18T08:42:00Z') });
        assert.match(line, /Submitted/);
        assert.match(line, /18 Aug/);
    });

    test('with no timestamp it still says submitted rather than nothing', () => {
        // A head written by an older schema, or a partial read. "Submitted" is the fact worth
        // keeping; the time is the detail. Losing the whole receipt over a missing minute would
        // tell the member something false about the important half.
        assert.equal(receiptLine({ currentRevision: 1 }), 'Submitted');
    });
});

describe('are two stored answers the same declaration', () => {
    test('key order does not make a change', () => {
        // The two sides come from different producers — the form's buildAnswer and the server's
        // canonicalised copy — whose key order may differ while the answer does not. A stringify
        // comparison would paint an untouched day cream ("you are changing a saved answer").
        assert.ok(sameAnswer({ mode: 'before', until: '15:15' }, { until: '15:15', mode: 'before' }));
    });

    test('a real difference is a difference, and absent is not equal to present', () => {
        assert.equal(sameAnswer({ mode: 'all_day' }, { mode: 'unavailable' }), false);
        assert.equal(sameAnswer({ mode: 'before', until: '15:15' }, { mode: 'before', until: '16:15' }), false);
        assert.equal(sameAnswer({ mode: 'all_day' }, null), false);
        assert.ok(sameAnswer(null, undefined), 'both absent IS the same (no declaration either side)');
    });
});

describe('what a failed submit says', () => {
    test('a refusal that names a day names the day — and never blames the connection', () => {
        // The server returns which date it refused; until v20.75 the client threw that away and
        // said "Check your connection and try again" — advice that cannot help, because a refusal
        // IS a response: the connection provably works.
        const copy = submitFailureCopy('bad-time', 'Wed 2 Sep');
        assert.match(copy, /Wed 2 Sep/);
        assert.doesNotMatch(copy, /connection/i);
    });

    test('a network failure is the one case that DOES talk about the connection', () => {
        assert.match(submitFailureCopy('network', null), /connection/i);
    });

    test('an unknown server code no longer claims the connection is at fault', () => {
        assert.doesNotMatch(submitFailureCopy('write-failed', null), /connection/i);
        assert.doesNotMatch(submitFailureCopy('something-new', null), /connection/i);
        // But it still shows the code — a member reporting "it says something-new" is diagnosable.
        assert.match(submitFailureCopy('something-new', null), /something-new/);
    });
});
