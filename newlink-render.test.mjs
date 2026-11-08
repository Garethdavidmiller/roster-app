// @ts-check
/**
 * newlink-render.test.mjs — every surface the new link page can show, built in Node.
 * Run: node --test newlink-render.test.mjs   (part of `npm run test:hygiene`)
 *
 * The page's three rules (newlink-render.js header) are properties of its HTML, so they are tested on the HTML the real
 * builders produce from the real data: EVENLY (A to Z, no recommendation, in every state), NOT YOUR ROSTER (each
 * proposal's weeks flagged, numbered and never dated) and TEACH IN PLACE (a sentence before every table, every figure
 * tied to its label for a screen reader). e2e/newlink.spec.js drives the same builders through the real page.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    closesWords, dutyKind, designName, ifYou, renderStatus, renderPreviewBanner, renderList, renderCommon, renderFigures,
    renderPersonas, renderPersonaChips, renderWeeks, renderAllWeeks, renderWeeksKey, renderWeeksTabs, renderPack, figuresKey,
} from './newlink-render.js';
import { PROPOSALS } from './links-proposals.js';
import { COLUMNS, CHANGES, GAINS, COSTS, PERSONAS, NOTES, PACK } from './newlink-data.js';
import { HAVE_YOUR_SAY } from './newlink-config.js';

const count = (/** @type {string} */ s, /** @type {RegExp} */ re) => (s.match(re) || []).length;

test('the weeks card\'s title names the proposals\' own length — a typed number, so it is pinned to the rotas', () => {
    const html = readFileSync(new URL('./newlink.html', import.meta.url), 'utf8');
    const n = Number(/<\/span> The (\d+) weeks<\/h2>/.exec(html)?.[1]);
    assert.ok(n > 0, 'the weeks card\'s title carries a number of weeks');
    for (const p of PROPOSALS) assert.equal(Object.keys(p.patterns).length, n, `${designName(p)} has ${n} weeks, as the title says`);
});

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
    // the built-in list is A to Z too since 5 Nov 2026, so the renderer is handed them out of order: the sort must be its own
    const shuffled = [PROPOSALS[2], PROPOSALS[0], PROPOSALS[1]];
    assert.notDeepEqual(shuffled.map(p => p.name), [...shuffled.map(p => p.name)].sort(), 'the fixture no longer tests the sort');
    const html = renderStatus({ proposals: shuffled, closes: null });
    const names = [...html.matchAll(/<span class="nl-name-title">([^<]+)<\/span>/g)].map(m => m[1]);
    assert.deepEqual(names, ['Balanced V6', 'Level Crossing', 'Middle Ground']);
    assert.equal(count(html, /class="nl-name"/g), 3, 'one tile each, the same class for all three');
    assert.match(html, /Nothing is decided/);
    assert.match(html, /a date to be agreed/);
});

/** Every state a COLLEAGUE can be shown, from the real builders and the real data — and the page's own static markup,
 *  comments stripped. The preview banner is the one surface left out: it is the previewers' own, and names the admin to
 *  S. Silva by design. */
const colleagueStates = () => {
    const html = readFileSync(new URL('./newlink.html', import.meta.url), 'utf8');
    return [
        renderStatus({ proposals: PROPOSALS, closes: null }),
        renderStatus({ proposals: PROPOSALS, closes: '2026-11-27', starts: '2027-01-01', timetable: '2026-12-13', today: '2026-12-20' }),
        renderList(CHANGES), renderCommon({ gains: GAINS, costs: COSTS }), renderList(NOTES), renderList(HAVE_YOUR_SAY),
        renderPersonas(PERSONAS, COLUMNS, null), renderPersonas(PERSONAS, COLUMNS, 'all'),
        ...PERSONAS.map(p => renderPersonas(PERSONAS, COLUMNS, p.id)),
        renderPersonaChips(PERSONAS, null), renderWeeksTabs(PROPOSALS, PROPOSALS[0].id), renderPack(PACK, 'https://x/'),
        ...PROPOSALS.map(renderWeeks), ...PROPOSALS.map(p => renderAllWeeks(PROPOSALS, p.id)), renderWeeksKey(),
        html.slice(html.indexOf('<main'), html.indexOf('</main>')).replace(/<!--[\s\S]*?-->/g, ''),
    ].join('\n');
};

test('EVENLY: no state of the page names a recommendation', () => {
    assert.doesNotMatch(colleagueStates(), /recommend/i);
});

test('S. SILVA LEADS: no state a colleague sees says the admin, or the managers, choose (test audit, 7 Nov 2026)', () => {
    // Owner, 4 Nov 2026: S. Silva, as the RMT rep, leads the change, and the admin is in charge of neither the change nor
    // the choice (newlink-config.js header). newlink-config.test.mjs holds the Have-your-say words to that, and only those:
    // "The admin will choose one of the three." added to the status card passed every unit suite. The same two
    // patterns, over everything else.
    const words = colleagueStates();
    assert.ok(words.includes('Nothing is decided.'), 'the status card was not rendered — this would check nothing');
    assert.doesNotMatch(words, /\badmin\b|G\. Miller|managers decide/i);
    assert.doesNotMatch(words, /final call|\bdecides?\b|decided by|goes to the managers/i);
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

test('the review\'s fixes stay fixed (2 Nov 2026)', () => {
    // a label row labels ITS row group, so its header scope is rowgroup — not colgroup
    for (const p of PERSONAS) {
        const html = renderFigures(p, COLUMNS);
        assert.equal(count(html, /scope="colgroup"/g), 0, `${p.id}: no colgroup scope`);
        assert.equal(count(html, /<th colspan="\d+" scope="rowgroup"/g), p.rows.length, `${p.id}: every label row is a rowgroup header`);
        // the key under the table says only what the table uses
        const key = figuresKey(p);
        assert.equal(/Green/.test(key), p.rows.some(r => r.cells.some(c => c.best)), `${p.id}: the green key appears exactly when a green does`);
        assert.equal(/Up to/.test(key), p.rows.some(r => r.cells.some(c => /up to/.test(c.text))), `${p.id}: the "up to" key likewise`);
    }
    // every pack link has a name of its own, not three "The presentation"s (WCAG 2.4.4)
    const names = [...renderPack(PACK, 'https://x/').matchAll(/<span class="nl-file-name">([\s\S]*?)<\/span><span class="nl-file-meta">/g)]
        .map(m => m[1].replace(/<[^>]+>/g, '').trim());
    assert.equal(names.length, PACK.length);
    assert.equal(new Set(names).size, names.length, `pack links share a name: ${names.join(' | ')}`);
    // the canonical term: absence, never sickness
    assert.doesNotMatch(renderWeeksKey() + renderCommon({ gains: GAINS, costs: COSTS }), /\bsick/i);
    // the name tiles look pressable, so they are: one button per proposal, opening its weeks
    const status = renderStatus({ proposals: PROPOSALS, closes: null });
    assert.deepEqual([...status.matchAll(/<button type="button" class="nl-name" data-open-weeks="([^"]+)"/g)].map(m => m[1]), ['proposal:MB-26-V6', 'proposal:LC-26-T10', 'proposal:MG-26-T8']);
});

test('the improvements review stays applied (2 Nov 2026)', () => {
    const status = renderStatus({ proposals: PROPOSALS, closes: null });
    // the tiles name the three and nothing else — the sheet code lives on the weeks' caption, beside its grid
    assert.doesNotMatch(status, /nl-name-ref/);
    for (const p of PROPOSALS) assert.ok(!status.includes(p.ref), `${designName(p)}: no sheet code on its tile`);
    // what a proposal IS, counted from the rotas, at the top — before any card says "cover week"
    const weeks = Object.keys(PROPOSALS[0].patterns).length;
    const cover = Object.values(PROPOSALS[0].patterns).filter(r => Object.values(r).every(v => v === 'SPARE')).length;
    assert.match(status, new RegExp(`Each is ${weeks} weeks long: ${weeks - cover} set weeks, and ${cover} <strong>cover weeks</strong>`));
    // "Have your say" is a way to its card
    assert.match(status, /<button type="button" class="nl-inline" data-open-card="nlSay">Have your say<\/button>/);
    // the headings are nouns the lines complete; "gives up" turned the costs upside down
    const common = renderCommon({ gains: GAINS, costs: COSTS });
    assert.match(common, /What everyone gains/);
    assert.match(common, /What it costs everyone/);
    assert.doesNotMatch(common, /gives up/i);
    // a way back from a chosen answer, which says where it goes — and none when the six are already showing
    assert.doesNotMatch(renderPersonas(PERSONAS, COLUMNS, null), /data-persona-reset/);
    for (const chosen of [PERSONAS[0].id, 'all']) assert.equal(count(renderPersonas(PERSONAS, COLUMNS, chosen), /data-persona-reset/g), 1, `${chosen}: one way back`);
    // the key says Sunday is overtime, where the weeks show Sunday shifts
    assert.match(renderWeeksKey(), /Sunday shifts are overtime/);
});

test('EVENLY, again: every proposal\'s weeks are drawn, A to Z, the chosen one marked and each one flagged', () => {
    for (const chosen of PROPOSALS) {
        const html = renderAllWeeks(PROPOSALS, chosen.id);
        assert.deepEqual([...html.matchAll(/data-weeks="([^"]+)"/g)].map(m => m[1]), ['proposal:MB-26-V6', 'proposal:LC-26-T10', 'proposal:MG-26-T8'], 'all three, A to Z');
        assert.deepEqual([...html.matchAll(/class="nl-weeks-one is-chosen" data-weeks="([^"]+)"/g)].map(m => m[1]), [chosen.id], 'exactly the chosen one marked');
        assert.equal(count(html, /A proposal — not your roster/g), PROPOSALS.length, 'a flag on each, so any one cropped still says what it is');
    }
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
    assert.deepEqual([...tabs.matchAll(/data-design="([^"]+)"/g)].map(m => m[1]), ['proposal:MB-26-V6', 'proposal:LC-26-T10', 'proposal:MG-26-T8'], 'the tabs A to Z too');
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

test('the preview banner names everyone else who can see the page — never "only you" when somebody else can', () => {
    const base = { audience: ['A. One', 'B. Two'], decided: false };
    assert.match(renderPreviewBanner(base), /Preview — only you can see this page\./);
    // The admin reading it, and S. Silva (CONFIG.NEWLINK_PREVIEW, v25.33): each is told about the other.
    assert.match(renderPreviewBanner({ ...base, others: ['S. Silva'] }), /Preview — only you and S\. Silva can see this page\./);
    assert.match(renderPreviewBanner({ ...base, others: ['the admin'] }), /Preview — only you and the admin can see this page\./);
    assert.match(renderPreviewBanner({ ...base, others: ['the admin', 'A. One', 'B. Two'] }),
        /only you and the admin, A\. One and B\. Two can see this page\./, 'UK lists: no comma before the "and"');
    assert.doesNotMatch(renderPreviewBanner({ ...base, others: ['<b>x</b>'] }), /<b>x<\/b>/);
});

test('everything it prints is escaped', () => {
    assert.equal(renderList(['<img onerror=x>']), '<ul class="nl-list"><li>&lt;img onerror=x&gt;</li></ul>');
    const banner = renderPreviewBanner({ audience: ['<b>x</b>'], decided: true });
    assert.doesNotMatch(banner, /<b>x<\/b>/);
    assert.match(banner, /the 1 people|the 1 people on the new link/);
});

test('the status says when the new link starts, apart from the timetable, and who carries on until then', async () => {
    const { startsWords } = await import('./newlink-render.js');
    assert.equal(startsWords('2027-01'), 'in January 2027', 'a month, while the day is not known (owner, 8 Nov 2026)');
    assert.equal(startsWords('2027-01-18'), 'on 18 January 2027', 'a day, once one is set');
    for (const bad of [null, undefined, '', '2027-02-30', '1 Jan', '2027-1-1', '2027-1', '2027-13', '2027-00']) assert.equal(startsWords(bad), null, String(bad));
    const html = renderStatus({ proposals: PROPOSALS, closes: null, starts: '2027-01' });
    assert.match(html, /The new link starts in January\u00a02027\. The new timetable comes first, in December, and today’s link carries on until then\./, 'the month and the year held together');
    assert.match(renderStatus({ proposals: PROPOSALS, closes: null, starts: '2027-01-18' }), /The new link starts on 18\u00a0January 2027\./, 'and a day held to its month');
    assert.doesNotMatch(html, /link changes in December/, 'the link does not change with the timetable');
    // An unreadable date says nothing rather than something untrue.
    assert.doesNotMatch(renderStatus({ proposals: PROPOSALS, closes: null, starts: 'soon' }), /starts (on|in)/);
});

// THE LINE FOLLOWS THE DATE (test audit, 7 Nov 2026). It had no date logic, so once the link's start had come it would still
// have said the link "starts on" it and that the timetable "comes first, in December".
test('the status line keeps its tense as the dates pass, and says nothing once the link may have started', () => {
    const at = (/** @type {string} */ today, starts = '2027-01') => renderStatus({ proposals: PROPOSALS, closes: null, starts, timetable: '2026-12-13', today });
    assert.match(at('2026-11-07'), /The new timetable comes first, in December, and today’s link carries on until then\./);
    assert.match(at('2026-12-12'), /comes first, in December/, 'the day before the timetable change');
    assert.match(at('2026-12-13'), /The new link starts in January\u00a02027\. The new timetable started in December, and today’s link carries on until then\./);
    assert.match(at('2026-12-31'), /started in December/);
    // A MONTH IS REACHED ON ITS FIRST DAY: the day is not known, so from 1 January the line could already be untrue
    for (const today of ['2027-01-01', '2027-01-20', '2027-03-15']) {
        assert.doesNotMatch(at(today), /starts (on|in)|carries on until then|comes first|started in December/,
            `on ${today} the line still speaks of a start that may have come`);
        assert.match(at(today), /Nothing is decided\./, 'and the rest of the status is unchanged');
    }
    // A DAY, once one is set, is reached on that day and not before
    assert.match(at('2027-01-17', '2027-01-18'), /The new link starts on 18\u00a0January 2027\./);
    assert.doesNotMatch(at('2027-01-18', '2027-01-18'), /starts on/);
});
