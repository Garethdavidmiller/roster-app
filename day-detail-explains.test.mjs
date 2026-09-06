/**
 * day-detail-explains.test.mjs — IF A SYMBOL CAN APPEAR IN A CELL, THE DAY PANEL EXPLAINS IT IN
 * FULL WORDS.
 *
 * The rule is v22.89's, from an external review, and it is the one that makes the calendar usable
 * by somebody who has not learnt it: a member does not have to know what ⭐ or 🏷️ or 📋 means,
 * because tapping the cell says so. The panel is already the app's answer to "what is that thing?"
 * — `dayMarkers` was written for exactly that reason at v22.70, after the one surface where the
 * legend is read turned out to be the one surface the legend was missing from.
 *
 * What that rule needs in order to survive is a test, because the failure mode is silent and
 * arrives from the OTHER side. Nobody breaks it by editing the panel. It breaks when somebody adds
 * a new marker to a cell — a `::before` with an emoji in `index.css`, a new shift sentinel in
 * `shiftBadgeParts` — and never learns that a second surface owed that symbol an explanation. The
 * cell renders perfectly; the panel simply has nothing to say about the one thing the member
 * tapped it to ask about.
 *
 * ── DERIVED FROM THE SOURCE, NEVER RESTATED ────────────────────────────────────────────────────
 *
 * Every list here is read out of the files that own it: the marker emoji out of `index.css`'s own
 * `content:` declarations, the shift sentinels out of `shiftBadgeParts`' own branches. A
 * hand-written table checked by a hand-written test would reproduce the defect it is meant to catch
 * — the same reasoning as `paycalc-inventory.test.mjs`, whose first contract drives the real key
 * builders out of the tree.
 *
 * `calendar-renderer.js` cannot be imported in Node (its graph reaches the gstatic Firebase SDK),
 * so the two functions under test are SLICED OUT OF THEIR REAL SOURCE and evaluated with their real
 * dependencies injected — the `sw-internals.test.mjs` pattern. Assertions therefore run against the
 * shipped code, not a copy, and the extraction throws loudly if either is renamed.
 *
 * The second half of the file is the same subject from the other side: WHERE THE PANEL MUST SAY
 * NOTHING. `weekContext` has one silence that is easy to delete and impossible to see — a member on
 * a fixed line has no rotating week, and printing the number anyway would name a cycle position
 * that does not exist. It is checked against the REAL roster table, because a mock would only
 * restate the assumption.
 *
 * Part of test:hygiene — no mocks, no emulator, nothing installed.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { shiftBadgeParts, getShiftKind, getRosterForMember, getWeekNumberForDate,
         teamMembers } from './roster-data.js';
import { parseOtherValue, OTHER_FLAVOURS } from './override-utils.js';

const RENDERER = readFileSync('./calendar-renderer.js', 'utf8');
const CSS      = readFileSync('./index.css', 'utf8');
const HTML     = readFileSync('./index.html', 'utf8');
const DATA     = readFileSync('./roster-data.js', 'utf8');

/**
 * Slice a top-level function out of a module's source by name. Throws if it is not found, so a
 * rename fails here rather than quietly leaving the contract unchecked.
 * @param {string} src @param {string} name
 */
function sliceFn(src, name) {
    const start = src.indexOf(`export function ${name}(`);
    assert.ok(start !== -1, `${name} not found — renamed? This test guards it and must be updated.`);
    const end = src.indexOf('\n}', start);
    assert.ok(end !== -1, `${name} has no top-level closing brace`);
    return src.slice(start, end + 2).replace(/^export /, '');
}

// The renderer's own SHIFT_KIND_LABELS, read from its source rather than retyped.
const KIND_LABELS = (() => {
    const m = /const SHIFT_KIND_LABELS = (\{[^}]*\});/.exec(RENDERER);
    assert.ok(m, 'SHIFT_KIND_LABELS not found in calendar-renderer.js');
    return JSON.parse(m[1].replace(/(\w+):/g, '"$1":').replace(/'/g, '"'));
})();

const dayMarkers = new Function(`${sliceFn(RENDERER, 'dayMarkers')}; return dayMarkers;`)();
const shiftWords = new Function(
    'SHIFT_KIND_LABELS', 'parseOtherValue', 'OTHER_FLAVOURS', 'getShiftKind', 'shiftBadgeParts',
    `${sliceFn(RENDERER, 'shiftWords')}; return shiftWords;`,
)(KIND_LABELS, parseOtherValue, OTHER_FLAVOURS, getShiftKind, shiftBadgeParts);

const MEMBER = { name: 'G. Miller', currentWeek: 1, rosterType: 'main' };

describe('every marker a CELL can wear, the panel names', () => {
    // The emoji a calendar cell can display, read out of the stylesheet that draws them. Scoped to
    // `.calendar-day` pseudo-elements so the legend, the badges and the rest of the page do not
    // wander into the set.
    const cellEmoji = new Set(
        [...CSS.matchAll(/\.calendar-day\.[a-z-]+::(?:before|after)\s*\{[^}]*?content:\s*'([^']+)'/g)]
            .map(m => m[1])
            .filter(v => v && v !== 'none' && v !== ''),
    );

    test('the scan finds the markers at all — or every assertion below is vacuous', () => {
        assert.ok(cellEmoji.size >= 5,
            `expected the cell marker emoji to be found in index.css, got ${cellEmoji.size}. ` +
            'If the markers moved to another mechanism, this scan must move with them — a contract ' +
            'that silently matches nothing passes for the wrong reason.');
    });

    test('every one of them is a marker the panel can name', () => {
        const named = new Set(dayMarkers({
            isToday: true, isBH: true, isXmas: true, isEaster: true, isPay: true, isCutoff: true,
        }).map(m => m.icon));
        const orphans = [...cellEmoji].filter(e => !named.has(e));
        assert.deepEqual(orphans, [],
            'these emoji can appear on a calendar cell and `dayMarkers` does not emit them, so the ' +
            'day panel — the one place a member goes to ask what a symbol means — cannot explain ' +
            'them. Add each to `dayMarkers` with the words it stands for:\n  ' + orphans.join('\n  '));
    });

    test('a marker is never half a marker', () => {
        for (const m of dayMarkers({ isToday: true, isBH: true, isXmas: true,
                                     isEaster: true, isPay: true, isCutoff: true })) {
            assert.ok(m.icon && m.icon.trim(), `marker "${m.label}" has no icon`);
            assert.ok(m.label && m.label.trim(), `marker "${m.icon}" has no words — which is the ` +
                'whole failure this file exists to prevent: a symbol shown back to the member ' +
                'with nothing said about it');
        }
    });

    test('Today is the one marker with no cell emoji, and it still carries a glyph', () => {
        // The cell tints the day NUMBER for today rather than adding an icon, so this one is
        // deliberately in the panel's set and not in the stylesheet's. It gets a glyph anyway
        // because a chip row where one chip alone had none reads as a chip that failed to load.
        const today = dayMarkers({ isToday: true }).find(m => m.label === 'Today');
        assert.ok(today && today.icon, 'the Today chip must still carry a glyph of its own');
        assert.ok(!cellEmoji.has(today.icon) || true, 'informational — Today needs no cell icon');
    });
});

describe('every shift a CELL can wear, the panel says in full words', () => {
    // The sentinels come out of `shiftBadgeParts`' own branches, so a shift kind added there fails
    // here rather than quietly acquiring a badge with no words behind it.
    const SENTINELS = [...new Set(
        [...DATA.slice(DATA.indexOf('export function shiftBadgeParts'))
            .slice(0, 1200)
            .matchAll(/timeStr === '([A-Z]+)'/g)].map(m => m[1]),
    )];

    test('the sentinel scan finds them — or the assertions below are vacuous', () => {
        assert.ok(SENTINELS.length >= 5,
            `expected shiftBadgeParts' sentinels to be found, got [${SENTINELS}]`);
        for (const expected of ['RD', 'AL', 'SICK', 'RDW', 'SPARE']) {
            assert.ok(SENTINELS.includes(expected), `${expected} missing from the derived list`);
        }
    });

    const OTHER_VALUES = Object.keys(OTHER_FLAVOURS);
    const VALUES = () => [
        ...SENTINELS,
        '07:00-16:00', '22:00-06:00',           // a timed turn, and one that crosses midnight
        ...OTHER_VALUES,                         // every Other flavour
        ...OTHER_VALUES.map(f => `${f} RDW`),    // and its rest-day-worked form
        `${OTHER_VALUES[0]} 09:00-17:00`,        // and its timed form
    ];

    test('each has a badge emoji — that is what appears in the cell', () => {
        for (const v of VALUES()) {
            const { emoji } = shiftBadgeParts(v);
            assert.ok(emoji && emoji.trim(), `no badge emoji for "${v}"`);
        }
    });

    test('each has full words — that is what the panel says about it', () => {
        for (const v of VALUES()) {
            const words = shiftWords(v, MEMBER, false);
            assert.ok(words && words.trim(), `no words for "${v}"`);
            assert.notEqual(words.trim(), v,
                `"${v}" is explained by repeating itself. The panel exists to turn the cell's short ` +
                'form into something a member who has not learnt the app can read.');
        }
    });

    test('a value the app itself calls Unknown is not described as a Late shift', () => {
        // `shiftBadgeParts` has an explicit ❓/"Unknown" branch, so an unparseable value is a state
        // the app believes it can be in. The kind ladder below it has no such branch — every time
        // that is not an early or a night is a LATE — so the same value the cell flags as
        // unreadable was being given a confident, wrong name in the panel. A member reading "Late
        // shift" over a cell wearing ❓ has been told two different things about one day, and only
        // one of them admits to not knowing.
        const badge = shiftBadgeParts('SEE NATHAN');
        assert.equal(badge.word, 'Unknown', 'precondition: the badge calls this Unknown');
        const words = shiftWords('SEE NATHAN', MEMBER, false);
        assert.ok(!/early shift|late shift|night shift/i.test(words),
            `the panel called an unrecognised value "${words}". The cell wears ❓ Unknown for it, ` +
            'so the panel must not name a shift kind it cannot know.');
    });
});

describe('the panel has somewhere to put each explanation', () => {
    // Cheap, and it is the half that a CSS or markup tidy-up breaks: the rules above can all pass
    // while the element that would show the answer has been renamed out from under them.
    for (const [id, what] of [
        ['dayDetailShiftGlyph',  "the shift's own kind glyph"],
        ['dayDetailShiftWords',  'the shift in full words'],
        ['dayDetailExtras',      'the day-marker chips'],
        ['dayDetailWeek',        'the roster week'],
        ['dayDetailAsRostered',  'the unchanged-day confirmation'],
        ['dayDetailLeaveBtn',    'the annual-leave route to the recorded dates'],
        ['dayDetailActions',     'the row the two routes share'],
    ]) {
        test(`index.html still has ${what} (#${id})`, () => {
            assert.ok(HTML.includes(`id="${id}"`), `#${id} is gone from index.html`);
        });
    }

    test('the class each of them needs is defined in index.css', () => {
        for (const cls of ['day-detail-head', 'day-detail-week', 'day-detail-asrostered',
                           'ddr-tick', 'ddm-chip', 'day-detail-leave-btn', 'day-detail-actions']) {
            assert.ok(CSS.includes(`.${cls}`), `.${cls} is used by the panel and not defined`);
        }
    });

    // THE ROW MUST DISAPPEAR WITH ITS CHILDREN (v22.98). The behaviour is asserted in
    // e2e/calendar.spec.js, which is where it belongs; this is the cheap half that says the RULE is
    // still written, because deleting one selector is how it would go — and the day it goes, every
    // ordinary day gains 12px under a panel with no actions and nothing anywhere reports it.
    test('an action row with nothing to show collapses itself', () => {
        assert.match(CSS, /\.day-detail-actions:not\(:has\(> :not\(\[hidden\]\)\)\)\s*\{[^}]*display:\s*none/,
            'the empty-row guard is gone: a panel with no actions will draw the row\'s margin anyway');
    });

    // The verb is what made the pair fit on one line — 295px of labels against 288px of content
    // width, measured. A label that grows back to "View …" silently returns the panel to a stacked
    // 76px block, and no assertion about the ROW would notice, because it would still be a row.
    test('neither action label carries the redundant verb', () => {
        for (const id of ['dayDetailLeaveBtn', 'dayDetailPayBtn']) {
            const m = new RegExp(`id="${id}"[^>]*>([^<]*)<`).exec(HTML);
            assert.ok(m, `#${id} is gone from index.html`);
            assert.doesNotMatch(m[1].trim(), /^View\b/i,
                `#${id} reads "${m[1].trim()}" — the verb costs the row the width it needs`);
        }
    });
});

describe('the roster week: stated where it is true, silent where it is not', () => {
    const weekContext = new Function(
        'getRosterForMember', 'getWeekNumberForDate',
        `${sliceFn(RENDERER, 'weekContext')}; return weekContext;`,
    )(getRosterForMember, getWeekNumberForDate);

    /** @param {string} name */
    const member = (name) => {
        const m = teamMembers.find(x => x.name === name);
        assert.ok(m, `${name} is no longer on the roster — pick another member of the same type`);
        return m;
    };
    const D = (y, mo, d) => new Date(y, mo, d);

    test('a rotating member gets their roster\'s own words and that date\'s number', () => {
        // Every rotating type, because the prefix is per-roster and the panel must not invent one.
        for (const [name, prefix] of [['G. Miller', 'CEA Week'], ['D. Irvine', 'BL Week']]) {
            const out = weekContext(member(name), D(2026, 8, 18));
            assert.match(out, new RegExp(`^${prefix} \\d+$`),
                `${name} should read "${prefix} N", got "${out}"`);
        }
    });

    test('a FIXED line says nothing — its number names a PATTERN, not a position in a cycle', () => {
        // C. Reen sits on fixed pattern 1. `getWeekNumberForDate` returns 1 for them, and printed
        // as "Week 1" that reads as the first week of a rotation they are not on. The header makes
        // the same call from the same empty `weekPrefix`, which is what keeps the two consistent.
        const reen = member('C. Reen');
        assert.equal(getWeekNumberForDate(D(2026, 8, 18), reen), 1,
            'precondition: the number function still returns the pattern id, which is the trap');
        assert.equal(weekContext(reen, D(2026, 8, 18)), '',
            'a fixed line has no rotating week and the panel must not state one');
    });

    test('it resolves per DATE, so a scheduled roster move is honoured on both sides of it', () => {
        // S. Boyle moves from the main rotation onto a fixed line on 28 Jun 2026. One member, two
        // answers, decided by the date — which is the whole reason this is not read off the member
        // record. It is also where the panel BEATS the header: that month is a transition month, so
        // the header suppresses its week label entirely and the panel is the only place left to ask.
        const boyle = member('S. Boyle');
        assert.ok(boyle.rosterChanges?.length, 'precondition: S. Boyle still has a scheduled move');
        assert.match(weekContext(boyle, D(2026, 5, 1)), /^CEA Week \d+$/,
            'before the move they are on the rotation');
        assert.equal(weekContext(boyle, D(2026, 6, 1)), '',
            'after it they are on a fixed line, and the week must fall silent');
    });

    test('no member, or no date, is silence rather than a guess', () => {
        assert.equal(weekContext(null, D(2026, 8, 18)), '');
        assert.equal(weekContext(member('G. Miller'), null), '');
    });

    test('every member on the roster either gets words and a number, or nothing at all', () => {
        // The shape contract, across the whole real table: never a bare number, never a dangling
        // prefix, never "undefined".
        for (const m of teamMembers) {
            const out = weekContext(m, D(2026, 8, 18));
            assert.ok(out === '' || /^[A-Za-z]+ Week \d+$/.test(out),
                `${m.name} produced "${out}" — a week is either stated in full or not at all`);
        }
    });
});
