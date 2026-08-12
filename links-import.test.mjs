/**
 * links-import.test.mjs — the design importer, which is a TRUST BOUNDARY.
 * Run: node --test links-import.test.mjs   (no mocks; part of `npm run test:hygiene`)
 *
 * ORGANISED BY THE FAILURE, not by the function. Text pasted from outside is a claim about a
 * design, and the question this suite asks of every case is which of two things happened to a
 * claim that was wrong:
 *
 *   · it was REFUSED, with a message naming where — fine; or
 *   · it became a design anyway, quietly smaller or quieter than the paste said — the whole
 *     hazard, because a proposal missing four duties reads as a lighter week rather than as an
 *     import that went wrong, and every panel downstream then reports confidently about it.
 *
 * The second is what almost every case below is really checking, which is why so many of them
 * assert on WHAT WAS PARSED rather than merely that parsing succeeded.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseCell, parseGrid, parseDesignImport, summariseImport } from './links-import.js';
import { ROTATING_LINES, normalisePatterns } from './links-design.js';

/** A full seven-column row as a tab-separated line. */
const line = (...cells) => cells.join('\t');
const week = (v) => line(v, v, v, v, v, v, v);

describe('one cell — where a proposal loses a duty', () => {
    test('a time is accepted in every shape a person or a spreadsheet writes it', () => {
        // All five are the SAME duty, and they must land on one string — two spellings of one
        // shift would defeat compare mode, the diff outline and every equality the workspace makes.
        for (const t of ['06:20-14:20', '06:20–14:20', '6:20-14:20', '06.20-14.20', '06:20 to 14:20']) {
            assert.deepEqual(parseCell(t), { value: '06:20-14:20' }, t);
        }
    });

    test('a rest day, a spare day and an empty cell each land somewhere real', () => {
        for (const t of ['RD', 'rd', 'Rest', 'REST DAY', 'R']) assert.equal(parseCell(t).value, 'RD', t);
        for (const t of ['SP', 'spare', 'Cover', 'S']) assert.equal(parseCell(t).value, 'SPARE', t);
        assert.equal(parseCell('OFF').value, 'OFF', 'OFF is its own value, not folded into RD');
        // An empty cell is the commonest cell on a roster sheet and means nothing is worked.
        for (const t of ['', '   ', null, undefined]) assert.equal(parseCell(t).value, 'RD', JSON.stringify(t));
    });

    test('NA becomes a rest day AND says so — the app has one non-worked state', () => {
        // Marylebone's Sundays are non-contracted, so a paper roster writes NA for "no Sunday duty"
        // while using RD for a rest day in a contracted week. That distinction cannot survive the
        // import, and the reader is told rather than left to find a grid disagreeing with the sheet.
        const r = parseCell('NA');
        assert.equal(r.value, 'RD');
        assert.match(String(r.assumed), /NA.*RD/);
        // A cell that IS what it stores says nothing — otherwise every rest day would raise a note
        // and the ones that matter would be lost in it.
        assert.equal(parseCell('RD').assumed, undefined);
    });

    test('anything else is REFUSED, never quietly turned into a rest day', () => {
        // The core rule. Defaulting an unreadable cell to RD is the failure this module exists to
        // prevent: the design imports "successfully", one duty lighter, and the hours panel then
        // reports a comfortable average for a week nobody proposed.
        for (const t of ['?', 'TBC', 'early', '25:00-26:00', '06:20', '06:20-', 'x']) {
            const r = parseCell(t);
            assert.ok('error' in r, `${t} was accepted as ${JSON.stringify(r)}`);
        }
    });

    test('a value it returns is one the design layer already accepts', () => {
        // Round-tripped through the app's own canonicaliser rather than compared to a literal —
        // a test asserting its own idea of the format would pass while the app stored something else.
        const patterns = { 1: { sun: parseCell('6:20-14:20').value, mon: parseCell('na').value } };
        assert.deepEqual(normalisePatterns(patterns), { 1: { sun: '06:20-14:20', mon: 'RD' } });
    });
});

describe('a pasted grid — where a paste loses a COLUMN', () => {
    test('seven columns, or a refusal naming the row', () => {
        // Six columns is not a week with a missing day; it is a paste that lost a separator, and
        // guessing WHICH column is guessing at somebody's rest days.
        const r = parseGrid(line('RD', 'RD', 'RD', 'RD', 'RD', 'RD'));
        assert.equal(r.ok, false);
        assert.match(String(r.error), /Row 1 has 6 day columns/);
    });

    test('TRAILING empty cells survive, because they are rest days', () => {
        // The defect this test was written for. A week ending Friday and Saturday off exports from
        // a spreadsheet as a row with two empty trailing cells, and trimming the LINE before
        // splitting eats them — turning a valid row into a five-column one and refusing it with a
        // message about separators, which sends the reader looking for a fault that is not there.
        const r = parseGrid('06:20-14:20\t06:20-14:20\t06:20-14:20\t06:20-14:20\t06:20-14:20\t\t');
        assert.equal(r.ok, true, r.ok ? '' : r.error);
        assert.deepEqual(r.patterns['1'].fri, 'RD');
        assert.deepEqual(r.patterns['1'].sat, 'RD');
    });

    test('a day-name header row is dropped, not parsed as a week', () => {
        const r = parseGrid(['WK\tSUN\tMON\tTUE\tWED\tTHU\tFRI\tSAT\tHRS', line('1', ...Array(7).fill('RD'), '0')].join('\n'));
        assert.equal(r.ok, true, r.ok ? '' : r.error);
        assert.equal(Object.keys(r.patterns).length, 1);
    });

    test('a leading week number places the row; a trailing hours total is discarded', () => {
        // The hours column is the author's arithmetic about their own sheet. The workspace computes
        // hours from the duties, and carrying a second figure beside the first is how two numbers
        // for one fact end up on a screen.
        const r = parseGrid(line('7', ...Array(7).fill('SP'), '35'));
        assert.equal(r.ok, true, r.ok ? '' : r.error);
        assert.deepEqual(Object.keys(r.patterns), ['7'], 'the stated week number wins over position');
        assert.deepEqual(Object.values(r.patterns[7]), Array(7).fill('SPARE'));
    });

    test('with no numbers, ORDER is the rotation', () => {
        const r = parseGrid([week('RD'), week('SP')].join('\n'));
        assert.equal(r.ok, true, r.ok ? '' : r.error);
        assert.deepEqual(Object.keys(r.patterns), ['1', '2']);
    });

    test('SOME rows numbered is refused, and the message says that rather than something else', () => {
        // It used to report "Week 1 appears twice" here — accurate, and pointing at the wrong
        // problem, because the duplicate is a symptom of the mixed numbering rather than the fault.
        // Numbering is now decided over the whole paste before a cell is read.
        const r = parseGrid([week('RD'), line('1', ...Array(7).fill('RD'), '0')].join('\n'));
        assert.equal(r.ok, false);
        assert.match(String(r.error), /1 of 2 rows are numbered/);
    });

    test('a duplicate or out-of-range week is refused rather than resolved', () => {
        const dup = parseGrid([line('3', ...Array(7).fill('RD'), '0'), line('3', ...Array(7).fill('SP'), '0')].join('\n'));
        assert.equal(dup.ok, false);
        assert.match(String(dup.error), /Week 3 appears twice/);
        const far = parseGrid(line('99', ...Array(7).fill('RD'), '0'));
        assert.equal(far.ok, false);
        assert.match(String(far.error), /outside the .* rotation/);
    });

    test('more weeks than the rotation is refused; FEWER is a warning', () => {
        // The asymmetry is the point. Too many means the paste and the rotation disagree about what
        // is being described. Too few is a half-drafted proposal, which is a real thing to want in
        // the workspace — and the design panels report an unfilled line better than this could.
        const over = parseGrid(Array.from({ length: ROTATING_LINES + 1 }, () => week('RD')).join('\n'));
        assert.equal(over.ok, false);
        assert.match(String(over.error), /rotation is \d+ lines/);

        const under = parseGrid([week('RD'), week('RD')].join('\n'));
        assert.equal(under.ok, true, under.ok ? '' : under.error);
        assert.ok(under.warnings.some(w => /2 of \d+ lines are filled/.test(w)), JSON.stringify(under.warnings));
    });

    test('a bad cell names its week AND its day', () => {
        // "Something in your paste is wrong" about a 168-cell grid is not an error message.
        const r = parseGrid(line('1', 'RD', 'RD', 'RD', 'RD', 'RD', 'RD', 'TBC', '0'));
        assert.equal(r.ok, false);
        assert.match(String(r.error), /Row 1, SAT/);
    });

    test('commas and aligned columns work as well as tabs', () => {
        for (const sep of [',', '   ']) {
            const r = parseGrid(['RD', 'RD', 'RD', 'RD', 'RD', 'RD', 'RD'].join(sep));
            assert.equal(r.ok, true, `${JSON.stringify(sep)}: ${r.ok ? '' : r.error}`);
        }
    });

    test('nothing at all is refused rather than producing an empty design', () => {
        for (const t of ['', '   \n  \n', null]) assert.equal(parseGrid(t).ok, false, JSON.stringify(t));
    });
});

describe('the app\'s own JSON', () => {
    const good = { name: 'Option A', patterns: { 1: { sun: 'RD', mon: '06:20-14:20', tue: 'SP', wed: 'RD', thu: 'RD', fri: 'RD', sat: 'RD' } } };

    test('a design round-trips, name and all', () => {
        const r = parseDesignImport(JSON.stringify(good));
        assert.equal(r.ok, true, r.ok ? '' : r.error);
        assert.equal(r.name, 'Option A');
        assert.equal(r.patterns['1'].mon, '06:20-14:20');
        assert.equal(r.patterns['1'].tue, 'SPARE');
    });

    test('JSON that parses but is not a design is refused AS JSON', () => {
        // Falling through to the grid parser would report "not a time" about a line of JSON — an
        // accurate sentence sending the reader to entirely the wrong place.
        const r = parseDesignImport('{"nope":1}');
        assert.equal(r.ok, false);
        assert.match(String(r.error), /no “patterns”/);
        assert.match(String(parseDesignImport('{oops').error), /not valid/);
    });

    test('a line key that is not a line number, or is out of range, is refused', () => {
        assert.match(String(parseDesignImport('{"patterns":{"x":{}}}').error), /not a line number/);
        assert.match(String(parseDesignImport('{"patterns":{"999":{}}}').error), /outside the/);
    });

    test('an unreadable cell inside JSON is refused too', () => {
        // The JSON path is not a trusted path. It is the same claim in a different notation.
        const bad = { patterns: { 1: { ...good.patterns[1], sat: 'maybe' } } };
        assert.match(String(parseDesignImport(JSON.stringify(bad)).error), /Line 1, SAT/);
    });

    test('a grid keeps its trailing empty cells through THIS entry point too', () => {
        // The same defect as the grid test above, one level up, and it survived the fix: this
        // function trimmed the whole paste to decide "is there anything here", then handed the
        // trimmed text on — eating the trailing tabs of the LAST line. That is the row most likely
        // to have them, and the UI calls this function, not `parseGrid`. A mutation putting the
        // trim back passed the entire suite until this case existed.
        const r = parseDesignImport('06:20-14:20\t06:20-14:20\t06:20-14:20\t06:20-14:20\t06:20-14:20\t\t');
        assert.equal(r.ok, true, r.ok ? '' : r.error);
        assert.equal(r.patterns['1'].sat, 'RD');
    });

    test('a grid still reaches the grid parser, with a grid-shaped error', () => {
        const r = parseDesignImport(line('RD', 'RD'));
        assert.equal(r.ok, false);
        assert.match(String(r.error), /day columns/);
    });
});

describe('the summary shown before the save', () => {
    test('it counts, and it does not judge', () => {
        // Deliberately no hours, no coverage, no verdict — the workspace's own panels assess a
        // design, and a second opinion computed here would compete with `runDesignChecks`. The
        // first time the two disagreed nobody would know which to believe.
        const { patterns } = /** @type {any} */ (parseGrid([week('RD'), week('SP'), line(...Array(7).fill('06:20-14:20'))].join('\n')));
        const s = summariseImport(patterns);
        assert.deepEqual(s, { filled: 3, lines: ROTATING_LINES, worked: 7, spare: 7, rest: 7 });
        assert.deepEqual(Object.keys(s).sort(), ['filled', 'lines', 'rest', 'spare', 'worked'],
            'a verdict, an average or a score has been added — see the module header');
    });
});
