// @ts-check
// @lane unit
/**
 * links-selector-core.test.mjs — the Links Selector's rules (links-selector-core.js).
 * Run: node scripts/run-tests.mjs test/links-selector-core.test.mjs
 *
 * The page puts a PROPOSAL on DATES, so the one thing it must never get wrong is which line a date falls on: a week off by
 * one would show a colleague somebody else's line and call it theirs. These pin the rotation against the proposals' own
 * grids, the blank days before the start, Christmas, and a choice from the address or the device that names nothing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STARTS, FIRST_MONTH, LAST_MONTH, startDate, lineOn, dayOn, proposalsAtoZ, isCoverLine, lineOptions,
    monthLines, inRange, openingMonth, initialChoice, choiceQuery, shiftTypesInMonth, hasBlankDays, ignoredWords, refusalWords } from '../links-selector-core.js';
import { readFileSync } from 'node:fs';
import { STARTS as NEWLINK_STARTS } from '../newlink-config.js';
import { PROPOSALS, proposalDisplayName } from '../link-designer-proposals.js';
import { DAYS, ROTATING_LINES } from '../link-designer-design.js';

const day = (/** @type {number} */ y, /** @type {number} */ m, /** @type {number} */ d) => new Date(y, m - 1, d);

test('the start is a Sunday, in the month the New CEA Link page says the link starts', () => {
    assert.equal(startDate().getDay(), 0, `${STARTS} is not a Sunday — a link turns on a Sunday`);
    assert.equal(STARTS.slice(0, 7), NEWLINK_STARTS.slice(0, 7), 'the two pages disagree about the month the new link starts');
    assert.deepEqual({ ...FIRST_MONTH }, { year: startDate().getFullYear(), month: startDate().getMonth() });
});

test('before the start every day is blank — never today\'s roster', () => {
    assert.equal(lineOn(7, day(2027, 1, 16)), null);
    assert.equal(lineOn(7, day(2026, 12, 25)), null);
    for (const p of PROPOSALS) assert.deepEqual(dayOn(p, 7, day(2027, 1, 16)), { blank: true });
});

test('the start week is the line chosen; each Sunday moves down one; after the last line, line 1', () => {
    for (let d = 17; d <= 23; d++) assert.equal(lineOn(7, day(2027, 1, d)), 7, `17–23 January is line 7 (the ${d}th)`);
    assert.equal(lineOn(7, day(2027, 1, 24)), 8);
    assert.equal(lineOn(26, day(2027, 1, 24)), 1, 'line 26 goes on to line 1');
    // a whole cycle later the line comes back
    const later = new Date(startDate().getTime());
    later.setDate(later.getDate() + 7 * ROTATING_LINES);
    assert.equal(lineOn(7, later), 7);
    // every line, every start, always 1 to 26
    for (let s = 1; s <= ROTATING_LINES; s++) for (let w = 0; w < 60; w++) {
        const d = day(2027, 1, 17 + w * 7);
        const l = /** @type {number} */ (lineOn(s, d));
        assert.ok(l >= 1 && l <= ROTATING_LINES);
        assert.equal(l, ((s - 1 + w) % ROTATING_LINES) + 1);
    }
});

test('a clock change cannot move a day onto the wrong line', () => {
    // British Summer Time starts on 28 March 2027 and ends on 31 October 2027: the Sunday after each is a new line.
    // 17 January to 28 March is 10 whole weeks, so the Saturday before is still line 10 and that Sunday is line 11.
    assert.equal(lineOn(1, day(2027, 3, 27)), 10);
    assert.equal(lineOn(1, day(2027, 3, 28)), 11, 'the clocks go forward on a Sunday that starts its own week');
    assert.equal(lineOn(1, day(2027, 4, 3)), 11, 'and the week after the change stays one line to its Saturday');
    assert.equal(lineOn(1, day(2027, 4, 4)), 12);
    // 17 January to 31 October is 41 weeks: line (41 mod 26) + 1, and the Saturday before is one line earlier.
    assert.equal(lineOn(1, day(2027, 10, 31)), (41 % 26) + 1);
    assert.equal(lineOn(1, day(2027, 10, 30)), (40 % 26) + 1);
});

test('a day is the proposal\'s own cell, read by weekday from the line it falls on', () => {
    for (const p of PROPOSALS) for (let s = 1; s <= ROTATING_LINES; s++) {
        for (let d = 17; d <= 30; d++) {
            const date = day(2027, 1, d);
            const got = /** @type {any} */ (dayOn(p, s, date));
            assert.equal(got.blank, false);
            assert.equal(got.shift, p.patterns[String(got.line)][DAYS[date.getDay()]], `${p.code} line ${s}, ${d} January`);
            assert.equal(got.christmasLeave, false);
        }
    }
});

test('Christmas: a day the proposal has you working is uncounted leave; anything else is rest; a Sunday never leave', () => {
    for (const p of PROPOSALS) for (let s = 1; s <= ROTATING_LINES; s++) {
        for (const date of [day(2027, 12, 25), day(2027, 12, 26), day(2028, 12, 25), day(2028, 12, 26)]) {
            const line = /** @type {number} */ (lineOn(s, date));
            const pattern = p.patterns[String(line)][DAYS[date.getDay()]];
            const got = /** @type {any} */ (dayOn(p, s, date));
            const due = date.getDay() !== 0 && pattern !== 'RD' && pattern !== 'SPARE';
            assert.equal(got.christmasLeave, due, `${p.code} line ${s}, ${date.toDateString()} (${pattern})`);
            assert.equal(got.shift, due ? 'AL' : 'RD');
        }
    }
    // 26 December 2027 is a Sunday: rest for everybody, whatever the line says
    assert.equal(day(2027, 12, 26).getDay(), 0);
});

test('the proposals A to Z, as the New CEA Link page lists them; the cover weeks are the all-spare lines', () => {
    assert.deepEqual(proposalsAtoZ().map(proposalDisplayName), ['Balanced V6', 'Level Crossing', 'Middle Ground']);
    for (const p of PROPOSALS) {
        const opts = lineOptions(p);
        assert.equal(opts.length, ROTATING_LINES);
        assert.deepEqual(opts.map(o => o.value), Array.from({ length: ROTATING_LINES }, (_, i) => String(i + 1)));
        for (const [i, o] of opts.entries()) {
            // the app's rule: spare Monday to Saturday, whatever the Sunday (link-designer-design.js → isCoverWeek)
            const cover = DAYS.every(d => d === 'sun' || p.patterns[String(i + 1)][d] === 'SPARE');
            assert.equal(isCoverLine(p, i + 1), cover);
            assert.equal(o.label, cover ? `Week ${i + 1} · cover week` : `Week ${i + 1}`);
        }
    }
});

test('a month\'s header lines: January from the 17th, a wrap past line 26, nothing for a month before the start', () => {
    assert.deepEqual(monthLines(7, 2027, 0), { first: 7, last: 9 });
    assert.deepEqual(monthLines(26, 2027, 0), { first: 26, last: 2 });
    assert.equal(monthLines(7, 2026, 11), null);
});

test('the months the page shows, and the one it opens on', () => {
    assert.ok(inRange(2027, 0) && inRange(2028, 11));
    assert.ok(!inRange(2026, 11) && !inRange(2029, 0));
    assert.deepEqual(openingMonth(day(2026, 11, 27)), { ...FIRST_MONTH }, 'before the link: its first month');
    assert.deepEqual(openingMonth(day(2027, 6, 3)), { year: 2027, month: 5 }, 'during it: this month');
    assert.deepEqual(openingMonth(day(2030, 1, 1)), { ...LAST_MONTH }, 'after the range: its last month');
});

test('the opening choice: the address, then this device, then the first proposal on line 1 — and nothing guessed', () => {
    const first = proposalsAtoZ()[0];
    assert.deepEqual(initialChoice('', null), { proposalId: first.id, line: 1, ignored: [] });
    assert.deepEqual(initialChoice('?proposal=LC-26-T10&line=7', null), { proposalId: 'proposal:LC-26-T10', line: 7, ignored: [] });
    assert.deepEqual(initialChoice('', { proposal: 'MG-26-T8', line: 12 }), { proposalId: 'proposal:MG-26-T8', line: 12, ignored: [] });
    // the address wins, half by half: a link naming only a line keeps the proposal this device last showed
    assert.deepEqual(initialChoice('?line=3', { proposal: 'MG-26-T8', line: 12 }), { proposalId: 'proposal:MG-26-T8', line: 3, ignored: [] });
    // a choice that names nothing is ignored, never guessed at
    for (const bad of ['?proposal=XX&line=0', '?proposal=proposal:LC-26-T10&line=27', '?line=7.5', '?line=-1', '?line=1e1']) {
        const got = initialChoice(bad, null);
        assert.equal(got.proposalId, first.id, bad);
        assert.equal(got.line, 1, bad);
    }
    // what the ADDRESS named and could not be shown is reported, half by half; what this device kept never is
    assert.deepEqual(initialChoice('?proposal=XX&line=0', null).ignored, ['proposal', 'line']);
    assert.deepEqual(initialChoice('?proposal=XX&line=4', null).ignored, ['proposal']);
    assert.deepEqual(initialChoice('?proposal=LC-26-T10&line=27', null).ignored, ['line']);
    assert.deepEqual(initialChoice('?proposal=&line=', null).ignored, ['proposal', 'line']);
    assert.deepEqual(initialChoice('', { proposal: 42, line: '12' }), { proposalId: first.id, line: 12, ignored: [] });
    assert.equal(choiceQuery(/** @type {any} */ (PROPOSALS[0]), 9), `?proposal=${PROPOSALS[0].code}&line=9`);
});

test('the key\'s month: the kinds of day drawn, read through dayOn, and the blank days before the start', () => {
    // every month in range, every proposal and line: the types are exactly the kinds of day the grid draws
    for (const p of PROPOSALS) for (const line of [1, 2, 7, 26]) for (let n = 0; n < 24; n++) {
        const year = 2027 + Math.floor(n / 12), month = n % 12;
        const want = new Set();
        for (let d = 1; d <= new Date(year, month + 1, 0).getDate(); d++) {
            const day = /** @type {any} */ (dayOn(p, line, new Date(year, month, d)));
            if (!day.blank && (day.shift === 'SPARE' || day.shift === 'AL')) want.add(day.shift);
        }
        assert.deepEqual([...shiftTypesInMonth(p, line, year, month)].sort(), [...want].sort(), `${p.code} line ${line}, ${year}-${month + 1}`);
    }
    // line 1 is a cover week from the start, so January has spare days and February (lines 3 to 7) depends on the line
    assert.ok(shiftTypesInMonth(PROPOSALS[0], 1, 2027, 0).has('SPARE'));
    // AL only ever at Christmas
    for (const p of PROPOSALS) for (let m = 0; m < 11; m++) assert.ok(!shiftTypesInMonth(p, 3, 2027, m).has('AL'));
    // blank days: January 2027 only
    assert.equal(hasBlankDays(2027, 0), true);
    assert.equal(hasBlankDays(2027, 1), false);
    assert.equal(hasBlankDays(2028, 0), false);
});

test('a shared link that named nothing here says so, and what is shown instead', () => {
    assert.equal(ignoredWords([], 'Balanced V6', 1), '');
    assert.match(ignoredWords(['proposal'], 'Balanced V6', 4), /names a proposal that isn’t on the shortlist, so this shows Balanced V6\.$/);
    assert.match(ignoredWords(['line'], 'Level Crossing', 1), new RegExp(`names a week that isn’t one of the ${ROTATING_LINES}, so this shows week 1\\.$`));
    assert.match(ignoredWords(['proposal', 'line'], 'Balanced V6', 1), /a proposal and a week that aren’t here, so this shows Balanced V6 from week 1\.$/);
});

test('the refusal card tells each reader what is true for them — never "not yet" to somebody it will never admit', () => {
    assert.match(refusalWords({ otherStaff: true, inAudience: false }).title, /for the CEA roster/);
    assert.match(refusalWords({ otherStaff: false, inAudience: false }).title, /doesn’t apply to your contract/);
    assert.match(refusalWords({ otherStaff: false, inAudience: true }).title, /isn’t open to you yet/);
    // Other Staff wins over the audience: it has no line at all, whatever else is true
    assert.match(refusalWords({ otherStaff: true, inAudience: true }).title, /for the CEA roster/);
});

test('only the reader waiting for the beta is sent to New CEA Link — the one page of the two they may open', () => {
    const waiting = refusalWords({ otherStaff: false, inAudience: true });
    assert.equal(waiting.newlink, true);
    assert.match(waiting.why, /compare the proposals on the New CEA Link page\.$/);
    assert.equal(refusalWords({ otherStaff: false, inAudience: false }).newlink, false, 'outside the audience: New CEA Link refuses them too');
    assert.equal(refusalWords({ otherStaff: true, inAudience: false }).newlink, false, 'an Other Staff login has no roster line');
    assert.equal(refusalWords({ otherStaff: true, inAudience: true }).newlink, false);
});

test('the refusal card states no count of proposals — the shortlist is PROPOSALS, and a number here drifts from it', () => {
    const NUMBER = /\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+proposals?\b/i;
    for (const who of [{ otherStaff: false, inAudience: true }, { otherStaff: false, inAudience: false }, { otherStaff: true, inAudience: false }]) {
        const { title, why } = refusalWords(who);
        assert.doesNotMatch(`${title} ${why}`, NUMBER);
    }
});

// THE COPIED SENTENCES. The day panel says three things in another page's words, so a colleague reading both pages meets
// one explanation, not two. They are copies — the Calendar's and New CEA Link's modules are not this page's to import
// (newlink-boundary.test.mjs) — so this holds each copy to its source: reword one and this fails until both agree.
test('the day panel\'s Christmas, cover-week and Sunday lines are the Calendar\'s and New CEA Link\'s own words', () => {
    const app = readFileSync(new URL('../links-selector-app.js', import.meta.url), 'utf8');
    const calendar = readFileSync(new URL('../calendar-al-lightbox.js', import.meta.url), 'utf8');
    const tips = readFileSync(new URL('../newlink-tips.js', import.meta.url), 'utf8');
    const weeksKey = readFileSync(new URL('../newlink-render.js', import.meta.url), 'utf8');
    const panel = readFileSync(new URL('../links-selector-tips.js', import.meta.url), 'utf8');
    const christmas = ': due at work, so this is annual leave. It does not come off the allowance.';
    assert.ok(calendar.includes(christmas) && app.includes(christmas), 'the Christmas line');
    const cover = 'four shifts between Monday and Saturday, set nearer the time, to cover leave and absence.';
    assert.ok(tips.includes(cover) && app.includes(`A cover week: ${cover}`), 'the cover-week line');
    assert.ok(panel.includes(`shows as Spare: ${cover}`), 'the ? panel\'s cover-week line');
    assert.ok(weeksKey.includes('Sunday shifts are overtime.') && app.includes("'Sunday shifts are overtime.'"), 'the Sunday line');
    assert.ok(panel.includes("html: 'Sunday shifts are overtime.'"), 'the ? panel\'s Sunday line');
});

// THE TWO WAYS BETWEEN THE PAGES (owner, 28 Nov 2026: "a link from New CEA Link to Links Selector and vice versa"). Each page
// names the other in the other's own address words, and draws the way across as the same row — so these hold the words and
// the recipe to one another: rename a parameter, or restyle one row, and this fails until both agree.
test('New CEA Link and the Links Selector send each other the proposal in the other\'s own words', async () => {
    const { selectorHref, SELECTOR_URL } = await import('../newlink-render.js');
    for (const p of PROPOSALS) {
        const href = selectorHref(p);
        assert.ok(href.startsWith(`${SELECTOR_URL}?`), href);
        // the Links Selector reads exactly that proposal from it, and says nothing about a line it did not name
        assert.deepEqual(initialChoice(href.slice(href.indexOf('?')), null), { proposalId: p.id, line: 1, ignored: [] });
    }
    const app = readFileSync(new URL('../links-selector-app.js', import.meta.url), 'utf8');
    const newlinkApp = readFileSync(new URL('../newlink-app.js', import.meta.url), 'utf8');
    const word = newlinkApp.match(/const WEEKS_PARAM = '([a-z]+)';/)?.[1];
    assert.ok(word, 'newlink-app.js names its WEEKS_PARAM');
    assert.ok(app.includes(`const NEWLINK_WEEKS = './newlink.html?${word}=';`), 'the Links Selector sends New CEA Link its own word');
});

test('the two rows are one recipe: the Links Selector\'s way out is drawn as New CEA Link\'s file row', () => {
    const block = (/** @type {string} */ css, /** @type {string} */ selector) => {
        const at = css.indexOf(`\n${selector} {`);
        assert.ok(at >= 0, `${selector} has a rule`);
        return Object.fromEntries(css.slice(at, css.indexOf('}', at)).split('\n').slice(1)
            .map(l => l.replace(/\/\*.*?\*\//g, '').trim()).filter(l => l.includes(':')).map(l => l.replace(/;$/, '').split(/:\s*/)));
    };
    const nl = block(readFileSync(new URL('../newlink.css', import.meta.url), 'utf8'), '.nl-file');
    const sel = block(readFileSync(new URL('../links-selector.css', import.meta.url), 'utf8'), '.selector-onward');
    for (const prop of ['display', 'align-items', 'gap', 'padding', 'border', 'border-radius', 'background', 'box-shadow', 'color', 'font-weight', 'text-decoration', 'transition']) {
        assert.equal(sel[prop], nl[prop], prop);
    }
});
