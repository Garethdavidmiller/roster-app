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
        { participants: over.participants || PARTICIPANTS, submissions: over.submissions || submissions() },
        { dates: DATES, now: Date.parse('2026-08-19T09:00:00Z') });
    return host.innerHTML;
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

    test('the short-notice warning is always present', () => {
        // Submitted availability is a record of what somebody said before a cut-off, not a standing
        // promise. Wherever the data is read, the note is read with it.
        assert.match(render(), /Confirm directly[\s\S]*with the employee before arranging short-notice cover/);
    });
});

describe('change markers', () => {
    test('a change after the initial deadline is flagged', () => {
        const html = render({ submissions: submissions({
            'A. One': { history: { lateInitial: false, changedSinceInitial: true } } }) });
        assert.match(html, /Changed since initial deadline/);
    });

    test('a late first submission is flagged', () => {
        const html = render({ submissions: submissions({
            'A. One': { history: { lateInitial: true, changedSinceInitial: false } } }) });
        assert.match(html, /Submitted after initial deadline/);
        assert.equal(/Changed since initial deadline/.test(html), false);
    });

    test('late WINS over changed when a history somehow carries both', () => {
        // `deriveHistory` cannot produce both — late means there is no initial revision, so there is
        // nothing to have changed from — which is exactly why the earlier version of this test had
        // no teeth: swapping the `else if` for a second `if` changed nothing it looked at.
        //
        // The guard still matters, because this render takes `history` from a caller. Two chips
        // saying different things about one submission would read as two separate events.
        const html = render({ submissions: submissions({
            'A. One': { history: { lateInitial: true, changedSinceInitial: true } } }) });
        assert.match(html, /Submitted after initial deadline/);
        assert.equal(/Changed since initial deadline/.test(html), false,
            'a late submission must not ALSO be flagged as changed');
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
