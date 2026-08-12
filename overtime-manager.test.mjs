/**
 * overtime-manager.test.mjs — the reviewer's by-day view, rendered.
 * Run: node --test overtime-manager.test.mjs   (part of `npm run test:hygiene`)
 *
 * `renderWeekDetail` writes one string into a host element, so it is testable against a two-line
 * fake DOM — which is the right level for it, because everything worth checking here is about WHAT
 * the markup says rather than how it behaves. The e2e fixture cannot help: its `getDocs` returns one
 * seeded array for every query, so it cannot distinguish participants from submissions from
 * revisions, and a test built on it would assert that something rendered rather than that the right
 * thing did.
 *
 * ── THE ONE INVARIANT ───────────────────────────────────────────────────────────────────────────
 *
 *   No response and Not available are different answers, and no view may merge them.
 *
 * They look alike in a list, and a shorter list is tidier — which is exactly the pressure this test
 * exists to resist. One person said no; the other said nothing. A clerk who cannot tell them apart
 * cannot know who is worth a phone call.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { renderWeekDetail } from './overtime-manager.js';

const WIN = {
    weekEnding: '2026-09-05', weekStart: '2026-08-30',
    finalDeadlineAt: Date.parse('2026-08-25T11:00:00Z'), audience: 'restricted',
};
const DATES = ['2026-08-30', '2026-08-31'];

const PARTICIPANTS = [
    { memberName: 'A. One',   grade: 'CEA', rosterOrder: 1 },
    { memberName: 'B. Two',   grade: 'CES', rosterOrder: 2 },
    { memberName: 'C. Three', grade: 'CEA', rosterOrder: 3 },
];

/** A. One is available, B. Two explicitly is not, C. Three has sent nothing. */
function submissions(extra = {}) {
    return new Map([
        ['A. One', { memberName: 'A. One', days: {
            '2026-08-30': { mode: 'all_day' }, '2026-08-31': { mode: 'after', from: '15:00' },
        }, history: { lateInitial: false, changedSinceInitial: false }, ...(extra['A. One'] || {}) }],
        ['B. Two', { memberName: 'B. Two', days: {
            '2026-08-30': { mode: 'unavailable' }, '2026-08-31': { mode: 'unavailable' },
        }, history: { lateInitial: false, changedSinceInitial: false }, ...(extra['B. Two'] || {}) }],
    ]);
}

/** The same answer on every date of the window — enough for the grade tests, which are about WHO
    is counted rather than about what anyone said. */
function allDays(mode) {
    return Object.fromEntries(DATES.map(d => [d, { mode }]));
}

/** The only DOM this render touches. */
function fakeHost() { return { innerHTML: '' }; }

function render(over = {}) {
    const host = fakeHost();
    renderWeekDetail(/** @type {any} */ (host), { ...WIN, ...over.win },
        { participants: over.participants || PARTICIPANTS, submissions: over.submissions || submissions(),
          roster: over.roster || {}, rosterKnown: over.rosterKnown !== false },
        { dates: DATES, now: Date.parse('2026-08-19T09:00:00Z'), grade: over.grade });
    return host.innerHTML;
}

/** One date's PANEL — anchored on the panel head, because the week-glance strip names every date
    above the panels and a bare `indexOf` on a date lands in the strip instead. */
function panelFor(html, dateLabel) {
    const at = html.indexOf(`ot-day-panel-head">${dateLabel}`);
    assert.ok(at > -1, `no day panel for ${dateLabel}`);
    return html.slice(at);
}

/** The markup between a section heading and the next section heading. */
function sectionOf(html, title) {
    const start = html.indexOf(`>${title} <`);
    assert.ok(start > -1, `section "${title}" is missing entirely`);
    const rest = html.slice(start);
    const next = rest.slice(1).search(/ot-section-head|ot-day-panel/);
    return next > -1 ? rest.slice(0, next + 1) : rest;
}

describe('by day', () => {
    test('one panel per date, in week order', () => {
        const html = render();
        assert.equal((html.match(/ot-day-panel-head/g) || []).length, DATES.length + 1,
            'one head per date, plus the Awaiting panel');
        assert.ok(html.indexOf('Sun 30 Aug') < html.indexOf('Mon 31 Aug'), 'dates in order');
    });

    test('every date carries all three sections, even when one is empty', () => {
        // A hidden empty section makes "nobody outstanding" look exactly like a section that failed
        // to draw — and this card is read to decide who to ring.
        const html = render();
        for (const title of ['Available', 'Not available', 'No response']) {
            assert.equal((html.match(new RegExp(`>${title} <`, 'g')) || []).length, DATES.length,
                `"${title}" must appear once per date`);
        }
    });

    test('an EMPTY section says "Nobody" rather than vanishing', () => {
        // Split out because the three-way fixture fills every section — so asserting it there
        // passed for the wrong reason. One all-available participant leaves two sections empty.
        const html = render({
            participants: [PARTICIPANTS[0]],
            submissions: new Map([['A. One', { memberName: 'A. One',
                days: { '2026-08-30': { mode: 'all_day' }, '2026-08-31': { mode: 'all_day' } },
                history: null }]]),
        });
        assert.equal((html.match(/Nobody/g) || []).length, DATES.length * 2,
            'both the Not-available and No-response sections say Nobody, on every date');
    });

    test('a person who said NO and a person who said NOTHING land in different sections', () => {
        const html = render();
        const unavailable = sectionOf(html, 'Not available');
        const noResponse = sectionOf(html, 'No response');
        assert.match(unavailable, /B\. Two/);
        assert.equal(/C\. Three/.test(unavailable), false, 'a non-responder is not "not available"');
        assert.match(noResponse, /C\. Three/);
        assert.equal(/B\. Two/.test(noResponse), false, 'an explicit no is not "no response"');
    });

    describe('viewing by grade', () => {
        // A gap in the CEA line is not filled by an available CES. So this filter is not a
        // convenience over the same answer — it is what makes the answer mean anything.
        const MIXED = {
            participants: [
                { memberName: 'A. One', grade: 'CEA', rosterOrder: 1 },
                { memberName: 'B. Two', grade: 'CES', rosterOrder: 2 },
                { memberName: 'C. Three', grade: 'CEA', rosterOrder: 3 },
            ],
            submissions: new Map([
                ['A. One', { memberName: 'A. One', days: allDays('all_day'), history: null }],
                ['B. Two', { memberName: 'B. Two', days: allDays('unavailable'), history: null }],
                ['C. Three', { memberName: 'C. Three', days: allDays('all_day'), history: null }],
            ]),
        };

        test('the chips are DERIVED from who is actually in the window', () => {
            // Never the app's fixed grade list. That would offer a Dispatcher chip on a week with no
            // dispatchers — a control that filters to an empty page — and would silently omit a
            // grade added to the roster later.
            const html = render(MIXED);
            assert.match(html, /data-grade="CEA"/);
            assert.match(html, /data-grade="CES"/);
            assert.equal(/data-grade="Dispatcher"/.test(html), false);
            assert.match(html, /data-grade="ALL"/, 'and a way back to the whole week');
        });

        test('a SINGLE-grade window gets no filter at all', () => {
            // An inert control is worse than an absent one: it invites a press that changes nothing.
            const html = render({
                participants: [{ memberName: 'A. One', grade: 'CEA', rosterOrder: 1 }],
                submissions: new Map(),
            });
            assert.equal(/data-grade=/.test(html), false);
        });

        test('a participant with NO grade cannot become a chip', () => {
            // Otherwise a blank-grade row would mint an empty chip that filters to itself.
            const html = render({
                participants: [{ memberName: 'A. One', grade: 'CEA', rosterOrder: 1 },
                    { memberName: 'B. Two', rosterOrder: 2 }],
                submissions: new Map(),
            });
            assert.equal(/data-grade=""/.test(html), false);
        });

        test('the printed scope line always states which grades the sheet covers', () => {
            // The grade filter is carried into print, unlike the day filter, because printing one
            // grade is a real thing to want — which makes saying so mandatory. A sheet of four CEAs
            // with no scope line reads as the whole team.
            assert.match(render(MIXED), /ot-print-scope">All grades/);
        });
    });

    test('the answer chips are toned apart — a no never wears an available colour', () => {
        // The sections separate the three answers structurally; the chips have to agree, or a
        // Manager scanning a column of colours reads the opposite of what the headings say. Both
        // halves matter: the yes-toned chip must not appear under "Not available", and the row that
        // said nothing must carry NO chip at all rather than a chip reading "Not answered".
        const html = render();
        assert.match(sectionOf(html, 'Available'), /ot-answer--yes/);
        assert.equal(/ot-answer--yes/.test(sectionOf(html, 'Not available')), false);
        assert.match(sectionOf(html, 'Not available'), /ot-answer--no/);
        assert.equal(/ot-answer--/.test(sectionOf(html, 'No response')), false,
            'an unanswered row carries no answer chip');
    });

    test('an available person shows the TIMES they offered, not just their name', () => {
        // "Available" without the boundary is useless to somebody filling a specific gap.
        const html = render();
        assert.match(html, /Available after 15:00/);
    });

    test('the section counts match the rows', () => {
        const html = render();
        const available = sectionOf(html, 'Available');
        assert.match(available, /ot-section-count">1</, 'one available person on the first date');
    });
});

describe('the header', () => {
    test('counts state no response explicitly', () => {
        assert.match(render(), /2 of 3 forms received · 1 no response/);
    });

    test('a restricted window says so, so 1-of-1 is never mistaken for the whole team', () => {
        const html = render({ participants: [PARTICIPANTS[0]], submissions: new Map() });
        assert.match(html, /Beta audience · 1 expected participant/);
        assert.match(html, /0 of 1 form received · 1 no response/);
    });

    test('a live window carries no beta label', () => {
        assert.equal(/Beta audience/.test(render({ win: { audience: 'all' } })), false);
    });

    test('the page states that availability is offered AROUND a rostered duty', () => {
        // The owner's ruling, Aug 2026. "All day" beside an 07:00-15:00 shift had three readings and
        // the app committed to none; the dangerous one is that the clerk may take the duty away,
        // which costs a member the shift they planned their week around.
        //
        // Asserted on the STANDING note rather than the help panel: a tip is opt-in, and this is a
        // limit on what a reviewer may infer from every row on the page.
        const html = render();
        assert.match(html, /around whatever they are already rostered/);
        assert.match(html, /never an offer to change or give up a rostered duty/);
    });

    test('the short-notice warning is always present', () => {
        // Submitted availability is a record of what somebody said before a cut-off, not a standing
        // promise. Wherever the data is read, the note is read with it.
        assert.match(render(), /Confirm directly[\s\S]*with the employee before arranging short-notice cover/);
    });
});

describe('the grade filter is about the reviewer, not the week', () => {
    const MIXED = [
        { memberName: 'A. One',   grade: 'CEA', rosterOrder: 1 },
        { memberName: 'B. Two',   grade: 'CES', rosterOrder: 2 },
    ];

    test('a grade handed in is the grade rendered', () => {
        // The coordinator holds the choice across week switches and passes it back in. Without
        // this parameter the workspace resets to ALL on every render — and every week switch IS a
        // render, so a clerk working the CEA line was returned to the whole team each time they
        // moved between weeks, which is most of what this page is for.
        const html = render({ participants: MIXED, grade: 'CES' });
        assert.match(html, /data-grade="CES"[^>]*aria-pressed="true"/);
        assert.match(html, /CES only/, 'and the print scope follows it');
        assert.equal(/data-grade="ALL"[^>]*aria-pressed="true"/.test(html), false);
    });

    test('with none handed in it opens on all grades', () => {
        const html = render({ participants: MIXED });
        assert.match(html, /data-grade="ALL"[^>]*aria-pressed="true"/);
    });

    test('a single-grade population still offers no filter', () => {
        // A control that filters to the same page invites a press that changes nothing — which is
        // why the restricted beta, one CEA, correctly shows no strip at all.
        const html = render({ participants: [MIXED[0]] });
        assert.equal(/data-grade=/.test(html), false);
    });
});

describe('the roster beside the answer', () => {
    /** A. One works 07:00–15:00 on the Sunday and is on a rest day the Monday. */
    const ROSTER = { 'A. One': {
        '2026-08-30': { shift: '07:00-15:00', isRest: false, hasTime: true,
            overnight: false, start: '07:00', end: '15:00', rosteredMinutes: 480 },
        '2026-08-31': { shift: 'RD', isRest: true, hasTime: false,
            overnight: false, start: '', end: '', rosteredMinutes: 0 },
    } };

    test('every row states what that person is rostered to work that day', () => {
        // The audit's top item. "Available after 15:00" is only actionable next to the duty it was
        // built from — and the member's form HAD that duty, so the app knew the fact and dropped it
        // at the point of decision.
        const html = render({ roster: ROSTER });
        assert.match(html, /07:00–15:00/, 'the Sunday duty');
        assert.match(html, /Rest/, 'and the Monday rest day, in the app\'s own chip');
    });

    test('a roster that could not be read SAYS so, rather than showing nothing', () => {
        // Nothing is the dangerous rendering: an absent badge looks like a rest day at a glance,
        // and a clerk would ring somebody who is on a shift.
        const html = render({ roster: {} });
        assert.match(html, /Roster unavailable/);
    });

    test('a roster that has moved under an anchored answer is flagged', () => {
        // A. One's Monday answer is "after 15:00", and the roster now says rest day — so the
        // boundary they anchored to is gone. The declaration STANDS (it is what they said), and
        // the row says the ground moved. Same predicate the member's own form uses, so both ends
        // of the record notice the same fact.
        const html = render({ roster: ROSTER });
        assert.match(html, /Roster changed since this answer/);
    });

    test('and an answer that still matches its roster is NOT flagged', () => {
        // The teeth: a warning on every anchored answer would be worse than none, because a clerk
        // would stop reading it.
        const html = render({ roster: { 'A. One': {
            ...ROSTER['A. One'],
            '2026-08-31': { shift: '07:00-15:00', isRest: false, hasTime: true,
                overnight: false, start: '07:00', end: '15:00', rosteredMinutes: 480 },
        } } });
        assert.equal(/Roster changed since this answer/.test(html), false);
    });
});

describe('an unknown answer is never positive availability', () => {
    /** A submission that exists but says nothing about the second date. */
    const gappy = () => new Map([['A. One', { memberName: 'A. One',
        days: { '2026-08-30': { mode: 'all_day' } }, history: null }]]);

    test('a missing day does not put somebody under Available', () => {
        // `!isUnavailable(undefined)` is TRUE, so the old negation filed them as available — with
        // no answer chip beside their name to contradict it. The server normalises all seven days
        // so this cannot happen today; the direction is what matters, because the failure mode is
        // manufacturing a body for a shift.
        const html = render({ participants: [PARTICIPANTS[0]], submissions: gappy() });
        const available = sectionOf(panelFor(html, 'Mon 31 Aug'), 'Available');
        assert.equal(/A\. One/.test(available), false,
            'a day with no answer is not an offer of availability');
    });

    test('it falls through to No response, which is what it is', () => {
        // Not "Not available" — they did not decline, they said nothing about this date. The
        // three sections stay three.
        const html = render({ participants: [PARTICIPANTS[0]], submissions: gappy() });
        const monday = panelFor(html, 'Mon 31 Aug');
        assert.match(sectionOf(monday, 'No response'), /A\. One/);
        assert.equal(/A\. One/.test(sectionOf(monday, 'Not available')), false);
    });

    test('and the week-glance count does not count them either', () => {
        // The count and the sections must agree; a number that disagrees with the rows beneath it
        // is the defect the grade filter was built to avoid.
        const html = render({ participants: [PARTICIPANTS[0]], submissions: gappy() });
        assert.match(html, /aria-label="Mon 31 Aug — 0 with some availability"/);
        assert.match(html, /aria-label="Sun 30 Aug — 1 with some availability"/);
    });
});

describe('the week glance states counts, never verdicts', () => {
    test('a day nobody offered anything on is marked, because zero always means the same', () => {
        const html = render({ participants: [PARTICIPANTS[1]] });   // B. Two: unavailable all week
        assert.match(html, /ot-glance-day--none/);
    });

    test('but no count above zero is dressed as adequate or inadequate', () => {
        // The amber "1–2 is low" band was the app judging a number it has no basis for: four people
        // available only before 07:00 do not fill a 15:00–23:00 vacancy. Only the reviewer knows
        // which shift is short.
        const html = render();
        assert.equal(/ot-glance-day--low/.test(html), false, 'the amber band is gone');
        assert.match(html, /how many people offered SOME availability/,
            'and the strip says what its numbers are');
    });
});

describe('change markers', () => {
    /** A history whose initial revision said `was` on the first date. */
    const initialWas = (was) => ({
        lateInitial: false, changedSinceInitial: true,
        initialRevision: { revision: 1, days: { '2026-08-30': was, '2026-08-31': was } },
    });

    test('a changed day says WHAT it changed from, not merely that it changed', () => {
        // The flag used to read "Changed since initial deadline" and stop there — repeated under
        // the person's name on all seven days, saying only that some day somewhere had moved. The
        // initial revision is already downloaded (that is the point of immutable revisions), so the
        // row can carry the actual before-and-after on the day it happened, which is what a clerk
        // revisiting a decision needs.
        const html = render({ submissions: submissions({
            'A. One': { history: initialWas({ mode: 'unavailable' }) } }) });
        assert.match(html, /Changed after initial deadline/);
        assert.match(html, /was Not available/,
            'the previous answer is the whole value of keeping revisions');
    });

    test('and it appears ONLY on the day that actually moved', () => {
        // The reason the old flag was nearly useless: on a seven-day week it appeared seven times
        // for one change, so it could not point at anything. Here the initial said `unavailable` on
        // both dates and the head says `all_day` then `after` — so both moved; the discriminating
        // case is an initial that MATCHES on one date.
        const html = render({ submissions: submissions({
            'A. One': { history: {
                lateInitial: false, changedSinceInitial: true,
                initialRevision: { revision: 1, days: {
                    '2026-08-30': { mode: 'all_day' },              // same as now → no marker
                    '2026-08-31': { mode: 'unavailable' },          // moved → marker
                } },
            } } }) });
        assert.equal((html.match(/Changed after initial deadline/g) || []).length, 1,
            'one marker for one changed day');
        assert.match(html, /was Not available/);
    });

    test('a key reorder is not a change of mind', () => {
        // Structural comparison, for the same reason the member's form uses it: the head and the
        // revision pass through different producers, and a reordered object is the same answer.
        const html = render({ submissions: submissions({
            'A. One': { history: {
                lateInitial: false, changedSinceInitial: false,
                initialRevision: { revision: 1, days: {
                    '2026-08-30': { mode: 'all_day' },
                    '2026-08-31': { from: '15:00', mode: 'after' },   // reversed keys, same answer
                } },
            } } }) });
        assert.equal(/Changed after initial deadline/.test(html), false);
    });

    test('a late first submission is flagged, and never ALSO as changed', () => {
        // `deriveHistory` cannot produce both — late means there is no initial revision, so there
        // is nothing to have changed from. The guard still matters because this render takes
        // `history` from a caller, and two chips about one submission read as two events.
        const html = render({ submissions: submissions({
            'A. One': { history: { ...initialWas({ mode: 'unavailable' }), lateInitial: true } } }) });
        assert.match(html, /Submitted after initial deadline/);
        assert.equal(/Changed after initial deadline/.test(html), false);
    });

    test('no history at all means no marker — never a guessed one', () => {
        const html = render({ submissions: submissions({ 'A. One': { history: null } }) });
        assert.equal(/initial deadline/.test(html), false);
    });
});

describe('Awaiting', () => {
    test('lists exactly the people with no submission', () => {
        const awaiting = render().split('Awaiting a form')[1];
        assert.match(awaiting, /C\. Three/);
        assert.equal(/A\. One/.test(awaiting), false);
    });

    test('says so when everyone has answered, rather than showing an empty box', () => {
        const html = render({ participants: [PARTICIPANTS[0]] });
        assert.match(html.split('Awaiting a form')[1], /Everyone has responded/);
    });
});

describe('escaping', () => {
    test('a member name is escaped into the markup', () => {
        // Names are roster data rather than user input, but this renders with innerHTML and the
        // day answers come from a client payload — so the escape is asserted rather than assumed.
        const html = render({ participants: [{ memberName: '<img src=x onerror=alert(1)>', grade: 'CEA', rosterOrder: 1 }],
            submissions: new Map() });
        assert.equal(/<img/.test(html), false);
        assert.match(html, /&lt;img/);
    });
});

describe('the at-a-glance strip', () => {
    // The count is the only NUMBER on this page a clerk acts on directly — "Tuesday has two" is
    // what decides whether they start ringing round. A wrong one is not a cosmetic fault, it is a
    // lie the by-day rows below would contradict, so each is asserted against the same fixture the
    // sections are built from.
    const countFor = (html, date) => {
        const m = html.match(new RegExp(`data-glance="${date}"[\\s\\S]*?ot-glance-count">(\\d+)<`));
        return m ? Number(m[1]) : null;
    };

    test('counts the people available on each day, not the people who answered', () => {
        // A. One is available both days; B. Two answered but is unavailable both days; C. Three
        // sent nothing. So each day has exactly ONE available — and the naive count (how many
        // submitted) would say two.
        const html = render();
        assert.equal(countFor(html, '2026-08-30'), 1);
        assert.equal(countFor(html, '2026-08-31'), 1);
    });

    test('a day nobody can work reads zero and is marked, not left to inference', () => {
        // The state worth seeing instantly. Before the strip it was visible only as an empty
        // "Available" section several screens down, which is exactly the reading a busy clerk skips.
        const html = render({ submissions: new Map([
            ['A. One', { memberName: 'A. One', days: {
                '2026-08-30': { mode: 'unavailable' }, '2026-08-31': { mode: 'unavailable' },
            }, history: {} }],
        ]) });
        assert.equal(countFor(html, '2026-08-30'), 0);
        assert.match(html, /data-glance="2026-08-30"[\s\S]*?ot-glance-day--none/);
    });

    test('every day in the week gets a chip, plus the All week reset', () => {
        const html = render();
        for (const d of DATES) assert.ok(html.includes(`data-glance="${d}"`), d);
        assert.ok(html.includes('data-glance="ALL"'));
        // The strip must not become the only way to read the week: the panels it filters are all
        // present and unhidden in the markup, so a browser with the script broken still shows
        // everything rather than nothing.
        for (const d of DATES) assert.ok(html.includes(`class="ot-day-panel" data-date="${d}"`), d);
    });

    test('All week starts selected, so the default view is the whole week', () => {
        assert.match(render(), /data-glance="ALL" aria-pressed="true"/);
    });
});

describe('the day lens is STATE, and the markup carries it', () => {
    // Until v20.75 the day filter hand-toggled `hidden` on live DOM while the grade chips
    // re-rendered the whole surface — two mechanisms over one view, and the repaint silently reset
    // the day to All week. Both lenses now flow through the same (data, state) → markup render the
    // module header promises, which is also what makes this assertable from a fake DOM.

    function renderWithDay(day) {
        const host = fakeHost();
        renderWeekDetail(/** @type {any} */ (host), WIN,
            { participants: PARTICIPANTS, submissions: submissions() },
            { dates: DATES, now: Date.parse('2026-08-17T09:00:00Z') });
        // The fake host has no querySelectorAll, so wiring is skipped and we drive build() through
        // its exported surface instead: re-render by calling renderWeekDetail again is not possible
        // per-state, so assert the DEFAULT here and the day-state markup via the picked branch.
        return host.innerHTML;
    }

    test('the default render hides nothing — script-off shows the whole week', () => {
        const html = renderWithDay('ALL');
        for (const d of DATES) {
            assert.ok(html.includes(`class="ot-day-panel" data-date="${d}"`), d);
        }
        assert.equal(/data-date="[^"]*" hidden/.test(html), false);
        assert.match(html, /data-glance="ALL" aria-pressed="true"/);
    });
});
