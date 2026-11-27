// @ts-check
// @lane hygiene
/**
 * link-designer-grid-cells.test.mjs — what one cell of a Link Designer grid says (link-designer-grid-cells.js).
 * Run: node scripts/run-tests.mjs test/link-designer-grid-cells.test.mjs   (part of `npm run test:hygiene`)
 *
 * The editable grid and the compare grids are drawn from these, so a name fixed here reaches both —
 * the compare grids' cells said "RD" for a year after the editable grid's said "RD, rest day".
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DAY_LABELS, shiftLabel, cellName, cellAriaName, emptyPattern, isUnfilledPattern, editCellHtml, compareCellHtml, coverCellsHtml } from '../link-designer-grid-cells.js';
import { DAYS, classifyShift, calcCoverage } from '../link-designer-design.js';

describe('a cell says what it shows, then what that stands for (rule 1)', () => {
    test('labels: two times on two lines, RD for any rest, SP for spare', () => {
        assert.equal(shiftLabel('06:20-14:20'), '06:20\n14:20');
        for (const rest of ['RD', 'OFF', '', null, undefined]) assert.equal(shiftLabel(rest), 'RD');
        assert.equal(shiftLabel('SPARE'), 'SP');
    });
    test('names', () => {
        assert.equal(cellName('RD'), 'RD, rest day');
        assert.equal(cellName('OFF'), 'RD, rest day');
        assert.equal(cellName('SPARE'), 'SP, spare');
        assert.equal(cellName('06:20-14:20'), '06:20-14:20');
        assert.equal(cellAriaName('3', 'mon', 'RD'), 'Line 3 Mon: RD, rest day');
        assert.deepEqual(DAY_LABELS.map(l => l.toLowerCase()), DAYS, 'one label per day, in DAYS order');
    });
});

describe('the markup', () => {
    test('an editable cell is a button the grid input can address', () => {
        const html = editCellHtml('2', 'sat', 'SPARE', classifyShift);
        assert.equal(html, '<td class="shift-cell"><button class="shift-cell-btn type-spare" data-pos="2" data-day="sat" aria-label="Line 2 Sat: SP, spare">SP</button></td>');
    });
    test('a compare cell is not a control, and carries its name on a role that reads it (rule 2)', () => {
        const html = compareCellHtml('5', 'sun', 'RD', true, classifyShift);
        assert.doesNotMatch(html, /<button|tabindex/);
        assert.match(html, /^<td class="shift-cell cell-diff"><span class="shift-cell-btn type-rd" role="img" aria-label="Line 5 Sun: RD, rest day">RD<\/span><\/td>$/);
        assert.doesNotMatch(compareCellHtml('5', 'sun', 'RD', false, classifyShift), /cell-diff/);
    });
    test('names are escaped: a cell holds whatever an import put there', () => {
        assert.match(editCellHtml('1', 'mon', '<b>"x"</b>', classifyShift), /aria-label="Line 1 Mon: &lt;b&gt;&quot;x&quot;&lt;\/b&gt;">&lt;b&gt;/);
    });
    test('the cover row counts each day, and shows night and spare only when present', () => {
        const cov = calcCoverage({ 1: { ...emptyPattern(), mon: '06:20-14:20', tue: 'SPARE' }, 2: { ...emptyPattern(), mon: '14:00-22:00' } }, 2);
        const html = coverCellsHtml(/** @type {any} */ (cov));
        assert.equal((html.match(/<td class="cov-cell">/g) ?? []).length, DAYS.length);
        assert.match(html, /<span class="cov-num">2<\/span><span class="cov-label-e"> E:1<\/span> <span class="cov-label-l">L:1<\/span><\/td>/, 'Monday');
        assert.match(html, /<span class="cov-num">1<\/span><span class="cov-label-e"> E:0<\/span> <span class="cov-label-l">L:0<\/span> <span class="cov-label-s">SP:1<\/span>/, 'Tuesday');
        assert.doesNotMatch(html, /cov-label-n/);
    });
});

describe('an all-rest line is not yet designed (rule 3)', () => {
    test('rest and OFF only, or nothing at all', () => {
        assert.equal(isUnfilledPattern(emptyPattern()), true);
        assert.equal(isUnfilledPattern({ mon: 'OFF' }), true);
        assert.equal(isUnfilledPattern(undefined), true);
        assert.equal(isUnfilledPattern({ ...emptyPattern(), sat: 'SPARE' }), false);
    });
});
