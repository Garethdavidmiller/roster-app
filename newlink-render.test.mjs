// @ts-check
/**
 * newlink-render.test.mjs — every surface the December link page can show, built in Node.
 * Run: node --test newlink-render.test.mjs   (part of `npm run test:hygiene`)
 *
 * The page's three rules (newlink-render.js header) are properties of its HTML, so they are tested on the HTML the real
 * builders produce from the real data: EVENLY (A to Z, no recommendation, in every state), NOT YOUR ROSTER (each
 * proposal's weeks flagged, numbered and never dated) and TEACH IN PLACE (a sentence before every table, every figure
 * tied to its label for a screen reader). e2e/newlink.spec.js drives the same builders through the real page.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    closesWords, dutyKind, designName, ifYou, renderStatus, renderPreviewBanner, renderList, renderCommon, renderFigures,
    renderPersonas, renderPersonaChips, renderWeeks, renderWeeksKey, renderWeeksTabs, renderPack,
} from './newlink-render.js';
import { PROPOSALS } from './links-proposals.js';
import { COLUMNS, CHANGES, GAINS, COSTS, PERSONAS, NOTES, PACK } from './newlink-data.js';

const count = (/** @type {string} */ s, /** @type {RegExp} */ re) => (s.match(re) || []).length;

test('the closing date: words for a real day, "a date to be agreed" for anything else', () => {
    assert.equal(closesWords(null), 'a date to be agreed');
    assert.equal(closesWords('2026-11-20'), 'Friday 20 November');
    assert.equal(closesWords('20 November'), 'a date to be agreed');
    // the rollover trap: new Date reads 31 February as 3 March and says nothing
    assert.equal(closesWords('2026-02-31'), 'a date to be agreed');
    assert.equal(closesWords('2026-13-01'), 'a date to be agreed');
});

test('a duty\'s kind follows the pack\'s line: an early starts before 11:00', () => {
    assert.equal(dutyKind('06:20-14:50'), 'early');
    assert.equal(dutyKind('10:59-19:00'), 'early');
    assert.equal(dutyKind('11:00-19:00'), 'late');
    assert.equal(dutyKind('15:45-23:55'), 'late');
    assert.equal(dutyKind('RD'), 'rest');
    assert.equal(dutyKind('SPARE'), 'cover');
    assert.equal(dutyKind('TRG'), 'unknown');
});

test('EVENLY: the status names the three A to Z, each once, in the same tile', () => {
    const html = renderStatus({ proposals: PROPOSALS, closes: null });
    const names = [...html.matchAll(/<span class="nl-name-title">([^<]+)<\/span>/g)].map(m => m[1]);
    assert.deepEqual(names, ['Even Step', 'In Step', 'Short Run']);
    assert.equal(count(html, /class="nl-name"/g), 3, 'one tile each, the same class for all three');
    assert.match(html, /Nothing is decided/);
    assert.match(html, /a date to be agreed/);
});

test('EVENLY: no state of the page names a recommendation', () => {
    const states = [
        renderStatus({ proposals: PROPOSALS, closes: null }),
        renderList(CHANGES), renderCommon({ gains: GAINS, costs: COSTS }), renderList(NOTES),
        renderPersonas(PERSONAS, COLUMNS, null), renderPersonas(PERSONAS, COLUMNS, 'all'),
        renderPersonaChips(PERSONAS, null), renderWeeksTabs(PROPOSALS, PROPOSALS[0].id), renderPack(PACK, 'https://x/'),
        ...PROPOSALS.map(renderWeeks),
    ].join('\n');
    assert.doesNotMatch(states, /recommend/i);
});

test('NOT YOUR ROSTER: each proposal\'s weeks are flagged, numbered 1 to 26, and never dated', () => {
    for (const p of PROPOSALS) {
        const html = renderWeeks(p);
        assert.match(html, /A proposal — not your roster/, `${designName(p)}: the flag`);
        const body = html.slice(html.indexOf('<tbody>'), html.indexOf('</tbody>'));
        assert.equal(count(body, /<tr[ >]/g), 26, `${designName(p)}: 26 weeks`);
        const weeks = [...body.matchAll(/<th scope="row">(\d+)<\/th>/g)].map(m => +m[1]);
        assert.deepEqual(weeks, Array.from({ length: 26 }, (_, i) => i + 1), 'numbered in order');
        assert.equal(count(body, /class="nl-wk-cover"/g), 5, `${designName(p)}: five cover weeks`);
        assert.doesNotMatch(html, /\b\d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)|\b20\d\d\b/, 'no date anywhere');
        assert.doesNotMatch(html, /\btitle="/, 'no tooltip — invisible on a phone');
        assert.ok(html.includes(p.ref), 'the code that matches the printed sheet');
        // every timed cell wears the kind the pack counts it as
        for (const m of body.matchAll(/<td class="nl-d nl-d--(early|late)"><span>(\d\d:\d\d)<\/span><span class="visually-hidden"> to <\/span><span>(\d\d:\d\d)<\/span>/g)) {
            assert.equal(dutyKind(`${m[2]}-${m[3]}`), m[1]);
        }
    }
    assert.match(renderWeeksKey(), /starts before 11:00/);
});

test('TEACH IN PLACE: every figure is tied to its label and its column for a screen reader', () => {
    for (const p of PERSONAS) {
        const html = renderFigures(p, COLUMNS);
        const ids = new Set([...html.matchAll(/ id="([^"]+)"/g)].map(m => m[1]));
        const cells = [...html.matchAll(/<td headers="([^"]+)"/g)].map(m => m[1].split(' '));
        assert.equal(cells.length, p.rows.length * COLUMNS.length, `${p.id}: every figure is a cell`);
        for (const refs of cells) for (const r of refs) assert.ok(ids.has(r), `${p.id}: headers="${r}" points at nothing`);
        // the bold green is exactly the generator's, and never on today
        const best = p.rows.reduce((n, r) => n + r.cells.filter(c => c.best).length, 0);
        assert.equal(count(html, /class="nl-best"/g), best, `${p.id}: one mark per best cell`);
        assert.equal(count(html, /, the best of the three/g), best, `${p.id}: the mark is said, not only coloured`);
    }
});

test('the sentence comes before the figures, in every state of the choice', () => {
    const none = renderPersonas(PERSONAS, COLUMNS, null);
    assert.equal(count(none, /<li>/g), 6, 'nothing chosen: the six one-line answers');
    assert.doesNotMatch(none, /<table/, 'and no table until one is chosen');
    for (const p of PERSONAS) {
        const one = renderPersonas(PERSONAS, COLUMNS, p.id);
        assert.equal(count(one, /<table/g), 1, `${p.id}: its own table`);
        assert.ok(one.indexOf('nl-gist') < one.indexOf('<table'), `${p.id}: the sentence first`);
        assert.ok(one.includes(ifYou(p.who)), `${p.id}: headed "If you …"`);
    }
    assert.equal(count(renderPersonas(PERSONAS, COLUMNS, 'all'), /<table/g), 6, 'Everything: all six');
});

test('the tiles: one per way of working and Everything, exactly one pressed', () => {
    const none = renderPersonaChips(PERSONAS, null);
    assert.equal(count(none, /<button /g), 7);
    assert.equal(count(none, /aria-pressed="true"/g), 0);
    const one = renderPersonaChips(PERSONAS, 'lates');
    assert.equal(count(one, /aria-pressed="true"/g), 1);
    assert.match(one, /data-persona="lates" aria-pressed="true"/);
    const tabs = renderWeeksTabs(PROPOSALS, PROPOSALS[1].id);
    assert.equal(count(tabs, /aria-pressed="true"/g), 1);
    assert.match(tabs, new RegExp(`data-design="${PROPOSALS[1].id}" aria-pressed="true"`));
});

test('the pack: every file opens in a new tab, with no opener, under the base', () => {
    const html = renderPack(PACK, 'https://example.test/docs/links-26/');
    const links = [...html.matchAll(/<a class="nl-file" href="([^"]+)" target="_blank" rel="noopener noreferrer">/g)].map(m => m[1]);
    assert.equal(links.length, PACK.length);
    for (const href of links) assert.match(href, /^https:\/\/example\.test\/docs\/links-26\/.+\.pdf$/);
    assert.match(html, /opens in a new tab/, 'said to a screen reader, not only shown');
});

test('everything it prints is escaped', () => {
    assert.equal(renderList(['<img onerror=x>']), '<ul class="nl-list"><li>&lt;img onerror=x&gt;</li></ul>');
    const banner = renderPreviewBanner({ audience: ['<b>x</b>'], decided: true });
    assert.doesNotMatch(banner, /<b>x<\/b>/);
    assert.match(banner, /the 1 people|the 1 people on the new link/);
});
