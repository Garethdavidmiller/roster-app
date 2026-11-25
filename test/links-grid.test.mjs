// @ts-check
// @lane hygiene
/**
 * links-grid.test.mjs — what the Links design grid draws around its cells (links-grid.js): the shift
 * list a cell (and the generator's time selects) offer, a line's three totals, and the Cover footer.
 * Run: node scripts/run-tests.mjs test/links-grid.test.mjs   (part of `npm run test:hygiene`)
 *
 * The grid itself — painting, the cell sheet, the empty states — is driven end to end in
 * e2e/links.spec.js. The figures here are checked against the functions that OWN them
 * (`lineTotals`, `weeklyHours`, `hoursFigure`), so the footer cannot state a design's hours a second way.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// overlay.js (imported for the cell sheet's lightbox) listens on `window` as it loads.
/** @type {any} */ (globalThis).window ??= { addEventListener: () => {} };
const { shiftOptionsHtml, totalCellsHtml, coverFootHtml } = await import('../links-grid.js');
const { ROTATING_LINES, CONTRACTED_HOURS_PER_WEEK, calcCoverage, lineTotals, weeklyHours, hoursFigure, hmFromHours } = await import('../links-design.js');
const { coverCellsHtml } = await import('../links-grid-cells.js');

const OFFERED = { early: ['06:20-14:20', '07:15-15:15'], late: ['14:30-22:30'] };
/** The `<option>` values, in order. @param {string} html */
const values = (html) => [...html.matchAll(/<option value="([^"]*)"/g)].map(m => m[1]);
/** The `<optgroup>` labels, in order. @param {string} html */
const groups = (html) => [...html.matchAll(/<optgroup label="([^"]*)"/g)].map(m => m[1]);

describe('the shift list (shiftOptionsHtml)', () => {
    test('the cell sheet offers rest and spare first, then the early and late times, then Custom…', () => {
        const html = shiftOptionsHtml('06:20-14:20', true, OFFERED);
        assert.deepEqual(values(html), ['RD', 'SPARE', '06:20-14:20', '07:15-15:15', '14:30-22:30', '__custom__']);
        assert.deepEqual(groups(html), ['Early (starting before 11:00)', 'Late (starting 11:00 or after)']);
        assert.match(html, /<option value="06:20-14:20" selected>/, 'the current value is selected');
        assert.equal((html.match(/ selected/g) ?? []).length, 1);
    });

    test('the generator\'s list has no rest or spare, and bare group names', () => {
        const html = shiftOptionsHtml('14:30-22:30', false, OFFERED);
        assert.deepEqual(values(html), ['06:20-14:20', '07:15-15:15', '14:30-22:30', '__custom__']);
        assert.deepEqual(groups(html), ['Early', 'Late']);
    });

    test('a current value the lists do not hold is offered, so the sheet can show what the cell holds', () => {
        const sheet = shiftOptionsHtml('05:00-13:00', true, OFFERED);
        assert.deepEqual(groups(sheet)[0], 'Current');
        assert.match(sheet, /<option value="05:00-13:00" selected>05:00-13:00 \(current\)<\/option>/);
        const gen = shiftOptionsHtml('05:00-13:00', false, OFFERED);
        assert.equal(values(gen)[0], '05:00-13:00');
        assert.ok(!groups(gen).includes('Current'));
        for (const known of ['RD', 'SPARE', '06:20-14:20']) {
            assert.ok(!groups(shiftOptionsHtml(known, true, OFFERED)).includes('Current'), `${known} is not "current"`);
        }
    });

    test('an empty list draws no empty group, and values are escaped', () => {
        const html = shiftOptionsHtml('<b>', false, { early: [], late: [] });
        assert.deepEqual(groups(html), []);
        assert.ok(!html.includes('<b>'), 'a value is escaped into the markup');
    });

    test('the custom option is labelled Custom…', () => {
        assert.match(shiftOptionsHtml(null, true, OFFERED), /<option value="__custom__">Custom…<\/option>/);
    });
});

describe('a line\'s three totals (totalCellsHtml)', () => {
    const cells = (/** @type {string} */ html) => [...html.matchAll(/<td class="([^"]*)"[^>]*>([^<]*)<\/td>/g)].map(m => ({ cls: m[1], text: m[2] }));

    test('an unfilled line is three dashes, with no reason to read', () => {
        for (const t of [undefined, /** @type {any} */ ({ unfilled: true })]) {
            const html = totalCellsHtml(t);
            assert.deepEqual(cells(html).map(c => c.text), ['—', '—', '—']);
            assert.ok(!html.includes('aria-label'));
        }
    });

    test('a cover week is the contracted week, muted, its days unknown — and the reason ADDS to the figure', () => {
        const contracted = CONTRACTED_HOURS_PER_WEEK * 60;
        const html = totalCellsHtml({ exSundayMinutes: contracted, allMinutes: contracted, days: null, assumed: true, unreadable: 0, unfilled: false });
        const c = cells(html);
        assert.deepEqual(c.map(x => x.text), [hmFromHours(CONTRACTED_HOURS_PER_WEEK), hmFromHours(CONTRACTED_HOURS_PER_WEEK), '—']);
        assert.ok(c.every(x => x.cls.includes('tot-assumed')));
        assert.match(html, new RegExp(`aria-label="${hmFromHours(CONTRACTED_HOURS_PER_WEEK)}\\. Cover week — counted as the contracted week`));
        assert.match(html, /aria-label="Not known\. A cover week does not record which days it works"/);
    });

    test('a floor is flagged, and says why', () => {
        const html = totalCellsHtml({ exSundayMinutes: 600, allMinutes: 600, days: 3, assumed: false, unreadable: 1, loneSpare: 2, unfilled: false });
        assert.ok(cells(html).every(x => x.cls.includes('tot-uncertain')));
        assert.ok(!html.includes('tot-same'), 'a floor is never muted as a repeat');
        assert.match(html, /1 duty time on this line could not be read, and 2 spare days on this line carry no times, so these totals are a floor/);
    });

    test('a line with no Sunday duty mutes the repeated figure, and only that one', () => {
        const c = cells(totalCellsHtml({ exSundayMinutes: 2100, allMinutes: 2100, days: 5, assumed: false, unreadable: 0, unfilled: false }));
        assert.deepEqual(c.map(x => x.cls.includes('tot-same')), [false, true, false]);
        assert.deepEqual(c.map(x => x.text), [hmFromHours(35), hmFromHours(35), '5']);
        const sunday = cells(totalCellsHtml({ exSundayMinutes: 2100, allMinutes: 2580, days: 5, assumed: false, unreadable: 0, unfilled: false }));
        assert.ok(sunday.every(x => !x.cls.includes('tot-same')));
    });
});

describe('the Cover footer (coverFootHtml)', () => {
    /** A small real design: a timed line, a Sunday line, a cover week, the rest undrawn. */
    const patterns = {
        1: { sun: 'RD', mon: '06:20-14:20', tue: '06:20-14:20', wed: '06:20-14:20', thu: '06:20-14:20', fri: '06:20-14:20', sat: 'RD' },
        2: { sun: '14:30-22:30', mon: 'RD', tue: '14:30-22:30', wed: '14:30-22:30', thu: '14:30-22:30', fri: 'RD', sat: '14:30-22:30' },
        3: { sun: 'SPARE', mon: 'SPARE', tue: 'SPARE', wed: 'SPARE', thu: 'SPARE', fri: 'SPARE', sat: 'SPARE' },
    };
    const cov = calcCoverage(patterns), totals = lineTotals(patterns, ROTATING_LINES);

    test('it is the Cover label, the day counts, then the three averages', () => {
        const html = coverFootHtml(cov, totals, patterns);
        assert.ok(html.startsWith(`<tr><td class="col-pos cov-foot-label">Cover</td>${coverCellsHtml(cov)}`));
        assert.equal((html.match(/class="tot-cell tot-avg"/g) ?? []).length, 3);
    });

    test('the hours averages are weeklyHours\', over the whole rotation; the days average over the working lines', () => {
        const html = coverFootHtml(cov, totals, patterns);
        const nums = [...html.matchAll(/<span class="tot-avg-num">([^<]*)<\/span>/g)].map(m => m[1]);
        const wh = weeklyHours(patterns, ROTATING_LINES);
        assert.deepEqual(nums, [hoursFigure(wh).hm ?? '—', hoursFigure(wh, 'all').hm ?? '—', String(totals.daysAverage ?? '')]);
        assert.match(html, new RegExp(`over ${ROTATING_LINES} lines`));
        assert.match(html, new RegExp(`over ${totals.daysLines} working line${totals.daysLines === 1 ? '' : 's'}`));
        assert.notEqual(totals.daysLines, ROTATING_LINES, 'the fixture must tell the two divisors apart');
    });

    test('without the per-line totals there are no averages', () => {
        assert.ok(!coverFootHtml(cov, undefined, patterns).includes('tot-avg'));
    });
});
