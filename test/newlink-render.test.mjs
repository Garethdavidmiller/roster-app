// @ts-check
// @lane hygiene
/**
 * newlink-render.test.mjs — every surface the new link page can show, built in Node.
 * Run: node scripts/run-tests.mjs test/newlink-render.test.mjs   (part of `npm run test:hygiene`)
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
    closesWords, dutyKind, designName, ifYou, renderStatus, renderList, renderCommon, renderDiffers, renderFigures,
    renderPersonas, renderPersonaChips, renderWeeks, renderAllWeeks, renderWeeksKey, renderWeeksTabs, renderPack, fileRow, figuresKey,
    statusPhase, statusHint, glanceFile, personaStatus, weeksStatus, weeksTitle, aToZ,
} from '../newlink-render.js';
import { PROPOSALS } from '../links-proposals.js';
import { COLUMNS, CHANGES, GAINS, COSTS, DIFFERS, DIFFER_RULE, PERSONAS, NOTES, PACK } from '../newlink-data.js';
import { HAVE_YOUR_SAY, CONTACT } from '../newlink-config.js';

// Tests live in test/ but address files from the repository root (moved 24 Nov 2026).
const REPO_ROOT_URL = new URL('../', import.meta.url);

const count = (/** @type {string} */ s, /** @type {RegExp} */ re) => (s.match(re) || []).length;
/** The one-page comparison, as newlink-app.js finds it for "Where they differ" — its own helper, not a copy of it. */
const GLANCE = glanceFile(PACK);

test('the weeks card\'s title is counted from the proposals, never typed (the 22 Nov 2026 review)', () => {
    const html = readFileSync(new URL('./newlink.html', REPO_ROOT_URL), 'utf8');
    assert.doesNotMatch(html, /The \d+ weeks/, 'no number of weeks is written into the markup');
    assert.match(html, /<span id="nlWeeksTitle">The weeks<\/span>/, 'the title the coordinator stamps');
    const n = Object.keys(PROPOSALS[0].patterns).length;
    assert.equal(weeksTitle(PROPOSALS), `The ${n} weeks`);
    const longer = { ...PROPOSALS[0], patterns: { ...PROPOSALS[0].patterns, [n + 1]: PROPOSALS[0].patterns[1] } };
    assert.equal(weeksTitle([longer, ...PROPOSALS.slice(1)]), 'The weeks', 'three lengths: no number rather than a wrong one');
});

test('the comparison is found by its file, and is null once the pack no longer has it', () => {
    assert.ok(GLANCE && GLANCE.path.endsWith('at-a-glance.pdf'));
    assert.equal(glanceFile(PACK.filter(f => f !== GLANCE)), null);
});

test('the screen-reader lines for the two choices: one name for the six short answers, and a proposal\'s counted weeks', () => {
    assert.equal(personaStatus(PERSONAS, null), 'Showing the six short answers, below.');
    assert.match(renderPersonas(PERSONAS, COLUMNS, PERSONAS[0].id), /Back to the six short answers/, 'the button names them the same way');
    assert.equal(personaStatus(PERSONAS, 'all'), 'Showing all six, with their figures, below.');
    assert.equal(personaStatus(PERSONAS, 'earlies'), 'Showing what it means if you prefer earlies, with its figures, below.');
    assert.equal(personaStatus(PERSONAS, 'nobody'), '');
    for (const p of PROPOSALS) assert.equal(weeksStatus(p), `Showing ${designName(p)}’s ${Object.keys(p.patterns).length} weeks, below.`);
});

test('the pack lists the three A to Z whatever order the data gives (rule 1)', () => {
    const reversed = [...PACK].reverse();
    const heads = [...renderPack(reversed, 'https://x/').matchAll(/<h3 class="nl-sub">([^<]+)<\/h3>/g)].map(m => m[1]);
    assert.deepEqual(heads, [...aToZ(PROPOSALS).map(designName), 'For all three']);
});

test('the closing date: words for a real day, "a date to be agreed" for anything else', () => {
    assert.equal(closesWords(null), 'a date to be agreed');
    assert.equal(closesWords('2026-11-20'), 'Friday 20 November 2026', 'with its year, as every dated line in the app');
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
    // the app's own classes (CLAUDE.md → Shift types): a night is never drawn as a late (the 22 Nov 2026 review)
    assert.equal(dutyKind('20:59-05:00'), 'late');
    assert.equal(dutyKind('21:00-05:00'), 'night');
    assert.equal(dutyKind('03:59-12:00'), 'night');
    assert.equal(dutyKind('04:00-12:00'), 'early');
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
    const html = readFileSync(new URL('./newlink.html', REPO_ROOT_URL), 'utf8');
    return [
        renderStatus({ proposals: PROPOSALS, closes: null }),
        renderStatus({ proposals: PROPOSALS, closes: '2026-11-27', starts: '2027-01-01', timetable: '2026-12-13', today: '2026-12-20' }),
        // the two states the owner added on 10 Nov 2026: a design chosen, before and after the start, and the start come with none
        ...PROPOSALS.map(p => renderStatus({ proposals: PROPOSALS, closes: null, starts: '2027-01', timetable: '2026-12-13', today: '2026-12-20', chosen: designName(p), contact: CONTACT })),
        renderStatus({ proposals: PROPOSALS, closes: null, starts: '2027-01', timetable: '2026-12-13', today: '2027-02-01', chosen: designName(PROPOSALS[0]), contact: CONTACT }),
        renderStatus({ proposals: PROPOSALS, closes: null, starts: '2027-01', timetable: '2026-12-13', today: '2027-01-01', contact: CONTACT }),
        statusHint('open'), statusHint('decided'), statusHint('waiting'),
        renderList(CHANGES), renderCommon({ gains: GAINS, costs: COSTS }), renderList(NOTES), renderList(HAVE_YOUR_SAY),
        renderDiffers({ differs: DIFFERS, rule: DIFFER_RULE, glance: GLANCE, base: 'https://x/' }),
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

// A COVER WEEK IS SPARE MONDAY TO SATURDAY; ITS SUNDAY IS NOT ASKED ABOUT (25 Nov 2026). This page counted one only when all
// SEVEN days were SPARE, while `isCoverWeek` (links-design.js) — the hours, the contracted-days ceiling, the spare spread —
// ignores Sunday on purpose. So a cover week written with a rest-day Sunday was drawn as six loose "Cover" cells and left
// out of the count at the top of the page. The shortlist writes every cover Sunday SPARE, so it is rewritten here.
test('a cover week with a rest-day Sunday is drawn as a cover week, and counted', () => {
    const restSunday = PROPOSALS.map(p => ({
        ...p,
        patterns: Object.fromEntries(Object.entries(p.patterns).map(([w, row]) =>
            [w, Object.values(row).every(v => v === 'SPARE') ? { ...row, sun: 'RD' } : row])),
    }));
    const before = renderStatus({ proposals: PROPOSALS, closes: null }).match(/(\d+) <strong>cover weeks<\/strong>/);
    assert.ok(before, 'the shape sentence was not rendered — this would check nothing');
    for (const p of restSunday) {
        const body = renderWeeks(p);
        assert.equal(count(body, /class="nl-wk-cover"/g), 5, `${designName(p)}: five cover weeks, their Sundays rest days`);
        assert.equal(count(body, /<tr class="nl-wk-cover"><th scope="row">\d+<\/th><td class="nl-d nl-d--rest">/g), 5,
            `${designName(p)}: the rest-day Sunday keeps its own cell`);
        assert.equal(count(body, /<td colspan="6" class="nl-d nl-d--cover">Cover week<\/td>/g), 5, 'and the cover spans Monday to Saturday');
    }
    const after = renderStatus({ proposals: restSunday, closes: null }).match(/(\d+) <strong>cover weeks<\/strong>/);
    assert.ok(after, 'a rest-day Sunday made the page stop saying what a proposal is');
    assert.equal(after[1], before[1], 'the same cover weeks, counted the same');
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
    assert.match(status, new RegExp(`Each proposal is ${weeks} weeks long: ${weeks - cover} weeks of set shifts, and\\s+${cover} <strong>cover weeks</strong>`));
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
    const differ = renderDiffers({ differs: [{ design: '<b>X</b>', better: ['<i>a</i>'], worse: ['"b" & c'] }], rule: '<u>r</u>', glance: null, base: '' });
    assert.ok(!/<b>X|<i>a|<u>r/.test(differ), 'a design, a point and the rule are all escaped');
    assert.match(differ, /&lt;b&gt;X&lt;\/b&gt;/);
    const row = fileRow({ design: '<s>', label: '<x>', path: 'a"b.pdf', pages: 1 }, 'https://x/');
    assert.ok(!/<s>|<x>|a"b/.test(row), 'a file row escapes its design, label and path');
});

test('WHERE THEY DIFFER, EVENLY: each of the three A to Z, a "better" and a "worse" panel each, in that order (12 Nov 2026)', () => {
    // backwards in, A to Z out: the order is the page's rule, never the data's
    const html = renderDiffers({ differs: [...DIFFERS].reverse(), rule: DIFFER_RULE, glance: GLANCE, base: 'https://x/' });
    const names = [...html.matchAll(/<h3 class="nl-sub" id="nlDiffer-[a-z0-9-]+">([^<]+)<\/h3>/g)].map(m => m[1]);
    assert.deepEqual(names, COLUMNS.slice(1), 'the shortlist A to Z, each once');
    // the same two panels for every one — the shape favours none — and drawn as "Whichever is chosen" draws a gain and a cost
    const panels = [...html.matchAll(/<div class="nl-side nl-side--(gain|cost)">\s*<h4 class="nl-side-h"><span aria-hidden="true">(✅|➖)<\/span> (Better|Worse) than the other two<\/h4>/g)];
    assert.deepEqual(panels.map(m => m[1]), names.flatMap(() => ['gain', 'cost']), 'better, then worse, for each');
    assert.ok(panels.every(m => (m[1] === 'gain') === (m[2] === '✅' && m[3] === 'Better')), 'the tick and the word go with the colour');
    // every point is printed, under its own design
    for (const d of DIFFERS) {
        const own = html.slice(html.indexOf(`>${d.design}</h3>`), html.indexOf('</section>', html.indexOf(`>${d.design}</h3>`)));
        for (const s of [...d.better, ...d.worse]) assert.ok(own.includes(s.replace(/&/g, '&amp;')), `${d.design}: "${s}" is under its name`);
    }
    // each section is named by its heading, and the ids are unique
    const ids = [...html.matchAll(/aria-labelledby="(nlDiffer-[a-z0-9-]+)"/g)].map(m => m[1]);
    assert.equal(new Set(ids).size, DIFFERS.length);
    for (const id of ids) assert.match(html, new RegExp(`<h3 class="nl-sub" id="${id}">`));
});

test('WHERE THEY DIFFER says its rule beneath the points, and offers the comparison as the pack offers a file', () => {
    const html = renderDiffers({ differs: DIFFERS, rule: DIFFER_RULE, glance: GLANCE, base: 'https://example.test/docs/links-26/' });
    assert.ok(html.indexOf('nl-differ-one') < html.indexOf('nl-note'), 'the rule comes after the points it explains');
    assert.ok(html.includes(`<p class="nl-note">${DIFFER_RULE}</p>`));
    assert.ok(GLANCE, 'premise: the pack holds the one-page comparison');
    // THE SAME ROW AS THE PACK CARD'S, so it opens in the viewer by its data-file (newlink-app.js) and looks the same
    assert.ok(html.includes(`<ul class="nl-files">${fileRow(GLANCE, 'https://example.test/docs/links-26/')}</ul>`));
    assert.ok(renderPack(PACK, 'https://example.test/docs/links-26/').includes(fileRow(GLANCE, 'https://example.test/docs/links-26/')),
        'the pack card draws the same file with the same row');
    // no comparison in the pack: no row, rather than a link to nothing
    const none = renderDiffers({ differs: DIFFERS, rule: DIFFER_RULE, glance: null, base: 'https://x/' });
    assert.doesNotMatch(none, /nl-file/);
    assert.match(none, /nl-note/);
});

test('the status says when the new link starts, apart from the timetable, and who carries on until then', async () => {
    const { startsWords } = await import('../newlink-render.js');
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
    const SAY = /<button type="button" class="nl-inline" data-open-card="nlSay">Have your say<\/button> by <strong>Friday 27 November 2026<\/strong>\./;
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
    const html = readFileSync(new URL('./newlink.html', REPO_ROOT_URL), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
    assert.match(html, /<span class="hint" id="nlStatusHint"><\/span>/);
    assert.doesNotMatch(html, /For discussion/);
});

test('the weeks key explains a night only where a proposal has one, and names the printed sheets\' "line" and "SP"', () => {
    assert.doesNotMatch(renderWeeksKey(PROPOSALS), /Night/, 'none of the three has a night');
    assert.match(renderWeeksKey(PROPOSALS), /Late — starts at 11:00 or after/);
    const withNight = { ...PROPOSALS[0], patterns: { ...PROPOSALS[0].patterns, 2: { ...PROPOSALS[0].patterns[2], mon: '21:30-05:30' } } };
    const key = renderWeeksKey([withNight]);
    assert.match(key, /nl-d--night[\s\S]*Night — starts at 21:00 or after, or before 04:00/);
    assert.match(key, /Late — starts from 11:00 to 20:59/, 'the late line no longer claims every start from 11:00');
    assert.match(renderWeeks(withNight), /<td class="nl-d nl-d--night">/, 'the cell is drawn as a night');
    assert.match(renderWeeksKey(), /called a <strong>line<\/strong>[\s\S]*marked <strong>SP<\/strong>/);
});

test('the status card keeps "Have your say" past the closing date while nothing is decided — only its "by" goes (owner, 22 Nov 2026)', () => {
    const open = (today) => renderStatus({ proposals: PROPOSALS, closes: '2026-12-04', starts: '2027-01', today });
    assert.match(open('2026-12-04'), /Have your say<\/button> by <strong>Friday 4 December 2026<\/strong>/, 'on the closing day itself');
    assert.doesNotMatch(open('2026-12-05'), /Have your say/, 'the day after: no "by" a day that has gone');
    assert.equal(statusPhase({ proposals: PROPOSALS, starts: '2027-01', today: '2026-12-05' }).phase, 'open',
        'and the page is still open, so the coordinator keeps the Have your say card (newlink-app.js drawStatus)');
});

test('a cover week falling badly includes its Sunday, and a link is explained, where the phrase is first met', () => {
    const html = renderStatus({ proposals: PROPOSALS, closes: null });
    assert.match(html, /A <strong>link<\/strong> is the set of weeks everyone works through in turn/);
    assert.match(html, /those four shifts land in the worst place, and its\s+Sunday is worked as overtime too/);
    assert.match(NOTES.join(' '), /with its Sunday worked as overtime too/);
});
