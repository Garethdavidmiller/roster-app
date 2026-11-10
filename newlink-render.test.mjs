// @ts-check
/**
 * newlink-render.test.mjs — every surface the new link page can show, built in Node.
 * Run: node scripts/run-tests.mjs newlink-render.test.mjs   (part of `npm run test:hygiene`)
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
    closesWords, dutyKind, designName, ifYou, renderStatus, renderList, renderCommon, renderFigures,
    renderPersonas, renderPersonaChips, renderWeeks, renderAllWeeks, renderWeeksKey, renderWeeksTabs, renderPack, figuresKey,
    statusPhase, statusHint,
} from './newlink-render.js';
import { PROPOSALS } from './links-proposals.js';
import { COLUMNS, CHANGES, GAINS, COSTS, PERSONAS, NOTES, PACK } from './newlink-data.js';
import { HAVE_YOUR_SAY, CONTACT } from './newlink-config.js';

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
 *  comments stripped. Every surface is in it: the preview banner, the one surface once left out because it named the
 *  admin to S. Silva by design, went on 8 Nov 2026 (owner: "Remove the preview banner as it will be going live soon"). */
const colleagueStates = () => {
    const html = readFileSync(new URL('./newlink.html', import.meta.url), 'utf8');
    return [
        renderStatus({ proposals: PROPOSALS, closes: null }),
        renderStatus({ proposals: PROPOSALS, closes: '2026-11-27', starts: '2027-01-01', timetable: '2026-12-13', today: '2026-12-20' }),
        // the two states the owner added on 10 Nov 2026: a design chosen, before and after the start, and the start come with none
        ...PROPOSALS.map(p => renderStatus({ proposals: PROPOSALS, closes: null, starts: '2027-01', timetable: '2026-12-13', today: '2026-12-20', chosen: designName(p), contact: CONTACT })),
        renderStatus({ proposals: PROPOSALS, closes: null, starts: '2027-01', timetable: '2026-12-13', today: '2027-02-01', chosen: designName(PROPOSALS[0]), contact: CONTACT }),
        renderStatus({ proposals: PROPOSALS, closes: null, starts: '2027-01', timetable: '2026-12-13', today: '2027-01-01', contact: CONTACT }),
        statusHint('open'), statusHint('decided'), statusHint('waiting'),
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

test('the pack: every file is a real link under the base that names its file, and opens in the viewer on this page', () => {
    const html = renderPack(PACK, 'https://example.test/docs/links-26/');
    const links = [...html.matchAll(/<a class="nl-file" href="([^"]+)" data-file="([^"]+)" aria-haspopup="dialog" target="_blank" rel="noopener noreferrer">/g)];
    assert.equal(links.length, PACK.length, 'one link per file, each still a real link (a Ctrl-click still gives a tab)');
    for (const [, href, file] of links) {
        assert.match(href, /^https:\/\/example\.test\/docs\/links-26\/.+\.pdf$/);
        assert.equal(href, `https://example.test/docs/links-26/${file}`, 'data-file is the path the viewer looks the file up by');
    }
    assert.deepEqual(links.map(m => m[2]).sort(), PACK.map(f => f.path).sort(), 'every file in the pack, once');
    // It no longer opens a new tab, so it must not SAY so — to the eye or to a screen reader (owner, 10 Nov 2026).
    assert.doesNotMatch(html, /new tab/);
    assert.match(html, /The files open on this page, and need a connection\./);
});

test('everything it prints is escaped', () => {
    assert.equal(renderList(['<img onerror=x>']), '<ul class="nl-list"><li>&lt;img onerror=x&gt;</li></ul>');
});

test('the status says when the new link starts, apart from the timetable, and who carries on until then', async () => {
    const { startsWords } = await import('./newlink-render.js');
    assert.equal(startsWords('2027-01'), 'in January 2027', 'a month, while the day is not known (owner, 8 Nov 2026)');
    assert.equal(startsWords('2027-01-18'), 'on 18 January 2027', 'a day, once one is set');
    for (const bad of [null, undefined, '', '2027-02-30', '1 Jan', '2027-1-1', '2027-1', '2027-13', '2027-00']) assert.equal(startsWords(bad), null, String(bad));
    const html = renderStatus({ proposals: PROPOSALS, closes: null, starts: '2027-01' });
    assert.match(html, /The new link starts in January\u00a02027, and today’s link carries on until then\. The new timetable comes first, in December\./, 'the month and the year held together');
    // "until then" closes the LINK's sentence (the bug check, 9 Nov 2026): after the timetable's December it read as today's
    // link ending with the timetable
    assert.doesNotMatch(html, /December, and today’s link carries on until then/, 'until then is the link’s start, not the timetable’s');
    assert.match(renderStatus({ proposals: PROPOSALS, closes: null, starts: '2027-01-18' }), /The new link starts on 18\u00a0January 2027, and today’s link carries on until then\./, 'and a day held to its month');
    assert.doesNotMatch(html, /link changes in December/, 'the link does not change with the timetable');
    // An unreadable date says nothing rather than something untrue.
    assert.doesNotMatch(renderStatus({ proposals: PROPOSALS, closes: null, starts: 'soon' }), /starts (on|in)/);
});

// THE LINE FOLLOWS THE DATE (test audit, 7 Nov 2026). It had no date logic, so once the link's start had come it would still
// have said the link "starts on" it and that the timetable "comes first, in December".
test('"Have your say by" goes once the closing date has passed, and not before (owner, 9 Nov 2026)', () => {
    const at = (/** @type {string|null} */ today, /** @type {string|null} */ closes = '2026-11-27') => renderStatus({ proposals: PROPOSALS, closes, today });
    const SAY = /<button type="button" class="nl-inline" data-open-card="nlSay">Have your say<\/button> by <strong>Friday 27 November<\/strong>\./;
    assert.match(at('2026-11-20'), SAY, 'a week before');
    assert.match(at('2026-11-27'), SAY, 'the closing day is the last day for views, so the line still stands on it');
    for (const today of ['2026-11-28', '2027-03-01']) {
        assert.doesNotMatch(at(today), /Have your say|by <strong>/, `on ${today} the date has gone, so the line goes`);
        assert.match(at(today), /<p class="nl-lead">Nothing on this page changes your roster\.<\/p>/, 'and the sentence before it ends cleanly');
    }
    // no date set, or one that cannot be read: "a date to be agreed", whatever the day — it never passes
    for (const closes of [null, '2026-02-30', 'soon']) assert.match(at('2027-06-01', closes), /Have your say<\/button> by <strong>a date to be agreed<\/strong>/);
    // and with no day given (the page always gives one) the line stands, as it did before the date was known
    assert.match(at(null), SAY);
});

test('every long word in a figure heading has a place to break, with a hyphen (the large-text check, 9 Nov 2026)', () => {
    // With a phone's text at 1.3 times, "BALANCED" was wider than its column at 360px and ran into the next heading.
    // newlink.css breaks a heading anywhere as a last resort; a soft hyphen makes the break a word's own. A design renamed
    // into a long new word fails here until HEADING_BREAKS (newlink-render.js) gives it one.
    const head = renderFigures(PERSONAS[0], COLUMNS).match(/<thead>[\s\S]*?<\/thead>/)?.[0] ?? '';
    const words = [...new Set(COLUMNS.flatMap(c => c.match(/[A-Za-z]{7,}/g) ?? []))];
    assert.ok(words.length > 0, 'premise: the headings hold long words');
    for (const w of words) {
        const shown = head.match(new RegExp(w.split('').join('\u00ad?')))?.[0];
        assert.ok(shown?.includes('\u00ad'), `"${w}" has no soft hyphen in its heading`);
        assert.equal(shown?.replace(/\u00ad/g, ''), w, `"${w}" is spelt as it was`);
    }
});

test('the status line keeps its tense as the dates pass, and says nothing once the link may have started', () => {
    const at = (/** @type {string} */ today, starts = '2027-01') => renderStatus({ proposals: PROPOSALS, closes: null, starts, timetable: '2026-12-13', today });
    assert.match(at('2026-11-07'), /today’s link carries on until then\. The new timetable comes first, in December\./);
    assert.match(at('2026-12-12'), /comes first, in December/, 'the day before the timetable change');
    assert.match(at('2026-12-13'), /The new link starts in January\u00a02027, and today’s link carries on until then\. The new timetable started in December\./);
    assert.match(at('2026-12-31'), /started in December/);
    // A MONTH IS REACHED ON ITS FIRST DAY: the day is not known, so from 1 January the line could already be untrue
    for (const today of ['2027-01-01', '2027-01-20', '2027-03-15']) {
        assert.doesNotMatch(at(today), /starts (on|in)|carries on until then|comes first|started in December/,
            `on ${today} the line still speaks of a start that may have come`);
        // …and with nothing chosen by then, the page no longer says nothing is decided (owner, 10 Nov 2026 — the tests below)
        assert.doesNotMatch(at(today), /Nothing is decided/, `on ${today} the page still says nothing is decided`);
    }
    // A DAY, once one is set, is reached on that day and not before
    assert.match(at('2027-01-17', '2027-01-18'), /The new link starts on 18\u00a0January 2027,/);
    assert.doesNotMatch(at('2027-01-18', '2027-01-18'), /starts on/);
});

// \u2500\u2500 THE DECIDED STATE, AND THE SAFETY NET (owner, 10 Nov 2026) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// "Add a 'decided' state." Until then the page had no state for a choice made or a link begun: from 1 January it dropped
// its start sentence and went on saying "Nothing is decided \u2026 Have your say by a date to be agreed" for good.
const SAY = /Have your say|data-open-card="nlSay"|a date to be agreed/;
const state = (/** @type {Record<string, any>} */ o) => renderStatus({ proposals: PROPOSALS, closes: null, starts: '2027-01', timetable: '2026-12-13', contact: CONTACT, ...o });

test('statusPhase: a design on the shortlist decides it; before the start nothing chosen is open; from the start, the page waits', () => {
    const at = (/** @type {string|null} */ today, /** @type {string|null} */ chosen = null, starts = '2027-01') => statusPhase({ proposals: PROPOSALS, chosen, starts, today });
    for (const p of PROPOSALS) assert.deepEqual(at('2026-12-01', designName(p)), { phase: 'decided', chosen: p }, `${designName(p)}, before the start`);
    assert.equal(at('2027-03-01', 'Middle Ground').phase, 'decided', 'and after it \u2014 a decision does not lapse');
    // THE SAFETY NET, ON EACH SIDE OF MIDNIGHT: the last day of December is open, the first of January waits
    assert.equal(at('2026-12-31').phase, 'open');
    assert.equal(at('2027-01-01').phase, 'waiting');
    assert.equal(at('2027-01-17', null, '2027-01-18').phase, 'open', 'a day, once set, is reached on that day');
    assert.equal(at('2027-01-18', null, '2027-01-18').phase, 'waiting');
    assert.equal(at(null).phase, 'open', 'no day given: nothing has come');
    assert.equal(at('2027-06-01', null, 'soon').phase, 'open', 'a start that cannot be read is never reached');
});

test('a name that is not on the shortlist is refused: never shown as chosen, the page goes on as though none were', () => {
    for (const chosen of ['Short Run', 'middle ground', 'Middle Ground \u2014 Dec 2026', 'MG-26-T8', 'proposal:MG-26-T8', ' Middle Ground', '']) {
        assert.equal(statusPhase({ proposals: PROPOSALS, chosen, starts: '2027-01', today: '2026-12-01' }).phase, 'open', JSON.stringify(chosen));
        const html = state({ chosen, today: '2026-12-01' });
        assert.doesNotMatch(html, /has been chosen/, `${JSON.stringify(chosen)} is announced as chosen`);
        assert.match(html, /Nothing is decided\./);
    }
    // and from the start, a refused name waits like no name at all
    assert.equal(statusPhase({ proposals: PROPOSALS, chosen: 'Short Run', starts: '2027-01', today: '2027-01-01' }).phase, 'waiting');
});

test('decided: the design is named as chosen, the start is said, and no view is asked for', () => {
    const before = state({ chosen: 'Middle Ground', today: '2026-12-20' });
    assert.match(before, /<strong>Middle Ground has been chosen\.<\/strong> The new link starts in January\u00a02027, and today\u2019s link carries on until then\. The new timetable started in December\./);
    assert.match(before, /These were the three on the shortlist, in alphabetical order\./);
    assert.doesNotMatch(before, SAY, 'no Have your say, and no closing date');
    assert.doesNotMatch(before, /Nothing is decided/);
    assert.match(before, /<p class="nl-lead">Nothing on this page changes your roster\.<\/p>/, 'the last line ends cleanly');
    // a closing date still to come asks for nothing once the design is chosen
    assert.doesNotMatch(state({ chosen: 'Middle Ground', today: '2026-11-20', closes: '2026-11-27' }), SAY);
    // the start, once it has come: "starts" through a month whose day is not known, "started" after it, or from a set day
    assert.match(state({ chosen: 'Level Crossing', today: '2027-01-01' }), /<strong>Level Crossing has been chosen\.<\/strong> The new link starts in January\u00a02027\.\s/);
    assert.match(state({ chosen: 'Level Crossing', today: '2027-01-31' }), /The new link starts in January\u00a02027\.\s/);
    assert.match(state({ chosen: 'Level Crossing', today: '2027-02-01' }), /The new link started in January\u00a02027\.\s/);
    assert.match(state({ chosen: 'Balanced V6', today: '2027-01-17', starts: '2027-01-18' }), /The new link starts on 18\u00a0January 2027, and today\u2019s link carries on until then\./);
    assert.match(state({ chosen: 'Balanced V6', today: '2027-01-18', starts: '2027-01-18' }), /The new link started on 18\u00a0January 2027\.\s/);
    assert.match(state({ chosen: 'Balanced V6', today: '2027-12-01', starts: '2027-12' }), /The new link starts in December\u00a02027\.\s/, 'December rolls into the next year');
    assert.match(state({ chosen: 'Balanced V6', today: '2028-01-01', starts: '2027-12' }), /The new link started in December\u00a02027\.\s/);
    assert.doesNotMatch(state({ chosen: 'Balanced V6', today: '2027-06-01', starts: 'soon' }), /The new link start/, 'an unreadable start says nothing');
});

test('waiting: from the start with nothing chosen, the page says who will confirm the outcome \u2014 and claims nothing else', () => {
    for (const today of ['2027-01-01', '2027-02-14']) {
        const html = state({ today });
        assert.match(html, new RegExp(`<strong>The outcome will be confirmed by ${CONTACT}\\.</strong>`));
        assert.doesNotMatch(html, /Nothing is decided/, `on ${today} it says nothing is decided`);
        assert.doesNotMatch(html, SAY, `on ${today} it still asks for views`);
        assert.doesNotMatch(html, /has been chosen|starts (on|in)|started (on|in)/, 'it neither invents a decision nor guesses at the start');
        assert.match(html, /These are the three proposals on the shortlist, in alphabetical order\./);
    }
    // the day before, the page is as it was
    const eve = state({ today: '2026-12-31' });
    assert.match(eve, /Nothing is decided\./);
    assert.match(eve, /Have your say<\/button> by <strong>a date to be agreed<\/strong>/);
    // with no contact given, nobody is named and nothing is broken
    assert.match(state({ today: '2027-01-01', contact: '' }), /<strong>The outcome is still to be confirmed\.<\/strong>/);
});

test('the status card\'s hint says "for discussion" only while the page is open', () => {
    assert.equal(statusHint('open'), 'For discussion, not a decision');
    assert.equal(statusHint('decided'), '');
    assert.equal(statusHint('waiting'), '');
    // and the page carries no copy of it to show before the script has decided
    const html = readFileSync(new URL('./newlink.html', import.meta.url), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
    assert.match(html, /<span class="hint" id="nlStatusHint"><\/span>/);
    assert.doesNotMatch(html, /For discussion/);
});
