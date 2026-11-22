// @ts-check
/**
 * guide-index-parity.test.mjs — the generated search index is TRUE of the guide pages, and the
 * wiring that serves it cannot silently detach.
 *
 * The staleness contract is the roster-members.json discipline: guide-index.js is committed, so a
 * guide edit that forgets `npm run generate:guide-index` would ship a box confidently answering
 * from LAST month's guides — same words, stale facts, nothing visibly broken. Contract 1
 * regenerates from the HTML and diffs.
 *
 * The others pin what a reader cannot see from any one file: the evidence vocabulary agreeing
 * with guide-sources.test.mjs, the legend never read as a claim, every result id landing on a
 * real anchor, and the one load-bearing UI trick — results are `.nav-panel-link--guide` rows so
 * nav-panel's delegated handler serves them — which a rename in EITHER file would sever with
 * every behavioural test still green.
 *
 * Part of test:hygiene.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildGuideIndex, extractGuideUnits, GUIDE_PAGES, PROVISIONAL_MARKERS } from './scripts/guide-index-lib.mjs';
import { GUIDE_INDEX } from './guide-index.js';
import { searchGuideIndex } from './guide-search.js';
import { NAV_GUIDES } from './nav-destinations.js';

const read = (/** @type {string} */ n) => readFileSync(new URL(`./${n}`, import.meta.url), 'utf8');

test('contract 1 — the committed index matches a fresh generation from the guide HTML', () => {
    assert.deepEqual(GUIDE_INDEX, buildGuideIndex(read),
        'guide-index.js is stale — run `npm run generate:guide-index` in the same commit as the guide change');
});

test('contract 2 — every drawer guide is represented, and the index names no page the drawer lacks', () => {
    const navGuides = NAV_GUIDES.map(g => g.url.replace(/^\.\//, ''));   // the drawer's list (nav-destinations.js)
    assert.deepEqual([...new Set(GUIDE_INDEX.map(u => u.page))].sort(), [...navGuides].sort());
    assert.deepEqual([...GUIDE_PAGES].sort(), [...navGuides].sort(),
        'GUIDE_PAGES (the generator) and NAV_GUIDES (the drawer) disagree about which guides exist');
});

test('contract 3 — the provisional-marker vocabulary is guide-sources.test.mjs\'s own, both ways', () => {
    // READ, NOT RESTATED (whole-app check, Nov 2026). This contract checked one direction — every
    // marker the extractor knows is named somewhere in guide-sources.test.mjs — and pinned its own
    // lists by value. So when guide-sources gained the FIP guide's conflict callout, the extractor
    // never learned it and nothing failed: the Lithuania and Latvia cards were indexed with no
    // evidence, and the drawer showed no "Source conflict" on either while the Rangers guide's
    // conflicts kept theirs. The list is now read out of that file, so a marker added there fails
    // here until the extractor has it, and one dropped there fails here too.
    const src = read('guide-sources.test.mjs');
    const block = src.match(/const PROVISIONAL = \{([\s\S]*?)\n\};/);
    assert.ok(block, 'guide-sources.test.mjs: its PROVISIONAL marker list was not found — read it from wherever it went');
    /** @type {Record<string, string[]>} */
    const theirs = Object.fromEntries([...block[1].matchAll(/^\s*(\w+):\s*\[([^\]]*)\]/gm)]
        .map(m => [m[1].toLowerCase(), [...m[2].matchAll(/'([^']+)'/g)].map(x => x[1]).sort()]));
    assert.ok(Object.keys(theirs).length >= 2 && Object.values(theirs).every(l => l.length),
        `guide-sources.test.mjs's marker list was read as ${JSON.stringify(theirs)} — the reading is wrong, not the list`);
    const ours = Object.fromEntries(Object.entries(PROVISIONAL_MARKERS)
        .filter(([state]) => state !== 'unconfirmed').map(([state, list]) => [state, [...list].sort()]));
    assert.deepEqual(ours, theirs,
        'scripts/guide-index-lib.mjs and guide-sources.test.mjs name different provisional markers — a claim the '
        + 'page marks provisional would reach the drawer unflagged. Make PROVISIONAL_MARKERS match, in the same commit.');
    // `unconfirmed` is the Rangers guide's Marylebone badge, which guide-sources polices as a badge
    // (its `status--unconfirmed` checks) rather than through that list. Its markers must be badges
    // the Rangers stylesheet really draws, or the state could never be read off a page.
    assert.match(src, /status--unconfirmed/, 'guide-sources.test.mjs no longer polices the unconfirmed badge');
    const rangersCss = read('rangers-guide.css');
    assert.ok(PROVISIONAL_MARKERS.unconfirmed.length > 0, 'the unconfirmed state has no marker');
    for (const cls of PROVISIONAL_MARKERS.unconfirmed) {
        assert.match(cls, /-status--unconfirmed$/, `${cls} is not an unconfirmed status badge`);
        assert.ok(rangersCss.includes(`.${cls}`), `${cls}: rangers-guide.css draws no such badge`);
    }
});

test('contract 4 — every index id is a real anchor in its own page', () => {
    for (const page of GUIDE_PAGES) {
        const html = read(page);
        for (const u of GUIDE_INDEX.filter(u => u.page === page)) {
            assert.ok(html.includes(`id="${u.id}"`), `${page}: index names #${u.id}, page has no such anchor`);
        }
    }
});

test('contract 5 — the key legend is a definition, not a claim: no evidence from it, all real claims kept', () => {
    const by = (/** @type {string} */ id) => GUIDE_INDEX.find(u => u.id === id);
    // The Rangers quick-reference section CONTAINS the legend (which shows every marker as an
    // example) and must carry nothing; the three genuine provisional claims must all survive.
    assert.deepEqual(by('rr-quick')?.e, [], 'the legend was read as a claim');
    assert.deepEqual(by('rr-thames')?.e, ['conflict']);
    assert.deepEqual(by('rr-shakespeare')?.e, ['conflict'], 'the break-of-journey conflict lives on this card');
    assert.deepEqual(by('rc-jcp')?.e, ['draft']);
});

test('contract 6 — a search EXAMPLE is not an answer', () => {
    // The Staff Guide tells the reader to try "boxing day" and "network railcard". Naming them put
    // both phrases into the index, and because a body match scores 1 wherever it appears and ties
    // break on index order — with the Staff Guide indexed first — the top hit for `boxing day`
    // became the paragraph that told you to search for it. Nothing was wrong with the index: it was
    // TRUE of the page, which is exactly why contract 1 could not see this.
    const tip = read('staff-guide.html').match(/<div class="info tip"[^>]*>\s*<strong>Search the guides\./);
    assert.ok(tip && tip[0].includes('data-gs-example'),
        'the search tip lost its data-gs-example marker — its example phrases are indexed again');
    const menu = GUIDE_INDEX.find(u => u.id === 'sg-the-menu');
    assert.ok(menu, 'the Staff Guide Menu section is gone from the index');
    for (const word of ['boxing', 'railcard']) {
        assert.ok(!(menu?.k || '').split(' ').includes(word),
            `the Menu section still indexes "${word}" — the example is being read as content`);
    }
    // And the two queries the guide advertises land on the guide that answers them, not on the advice.
    for (const [q, page] of [['boxing day', 'paycalc-guide.html'], ['network railcard', 'railcard-guide.html']]) {
        const top = searchGuideIndex(GUIDE_INDEX, q)[0];
        assert.equal(top?.page, page, `"${q}" no longer leads to ${page} — it leads to ${top?.page}#${top?.id}`);
    }
});

test('contract 7 — result rows ride nav-panel\'s delegated guide-link handler', () => {
    const ui = read('nav-guide-search.js');
    const nav = read('nav-panel.js');
    // The class the delegated handler dispatches on, present in BOTH files: the renderer must
    // stamp it and the handler must still listen for it.
    assert.ok(ui.includes("'nav-panel-link nav-panel-link--guide"), 'result rows no longer carry the guide-link class');
    assert.ok(nav.includes(".closest('.nav-panel-link--guide')"), 'the delegated handler no longer dispatches on the class');
    assert.ok(ui.includes('dataset.openId'), 'results no longer stamp data-open-id — opens would stop counting');
    // And the lazy boundary: nav-panel must import the UI dynamically, never statically — a
    // static import would put the ~90KB index into every page boot.
    assert.ok(nav.includes("import('./nav-guide-search.js')"), 'the lazy import is gone');
    assert.ok(!/^import .*nav-guide-search/m.test(nav), 'nav-guide-search must not be statically imported');
});

test('contract 5b — the FIP guide\'s Vilnius–Riga conflict reaches the drawer on both its cards', () => {
    // The FIP guide's first Conflict is a claim-level callout on the Lithuania and Latvia cards. Its
    // marker was missing from the extractor's vocabulary, so both cards were indexed as settled and a
    // search for the train, or for either country, showed no "Source conflict" (whole-app check).
    const by = (/** @type {string} */ id) => GUIDE_INDEX.find(u => u.id === id);
    for (const id of ['country-lt', 'country-lv']) {
        assert.ok(read('fip-guide.html').includes(`<details id="${id}"`), `premise: the FIP guide has no ${id} card`);
        assert.deepEqual(by(id)?.e, ['conflict'], `${id}: its unresolved callout is not read as a conflict`);
    }
    for (const q of ['riga', 'vilnius', 'lithuania', 'latvia']) {
        const cards = searchGuideIndex(GUIDE_INDEX, q).filter(r => r.id === 'country-lt' || r.id === 'country-lv');
        assert.ok(cards.length, `"${q}" no longer finds the Lithuania or Latvia card`);
        for (const r of cards) assert.deepEqual(r.evidence, ['conflict'], `"${q}" → ${r.id} arrives without its conflict`);
    }
});

test('contract 8 — evidence-bearing units exist (the extractor has not gone quietly blind)', () => {
    // If a rewrite of the extractor stopped seeing markers entirely, contracts 3 and 5 could pass
    // vacuously on empty lists. At least the three known claims must be found somewhere.
    assert.ok(GUIDE_INDEX.filter(u => u.e.length > 0).length >= 3);
});

test('contract 9 — every FIP country card is a unit of its own, the plain-div ones included', () => {
    // The reverse of contract 4. Contract 4 checks that every index id is an anchor; nothing checked
    // that every country card is in the index, so the "No FIP operator listed" cards — plain divs, not
    // <details> — were left out, and "sweden" found Denmark's card instead (whole-app check, 10 Nov 2026).
    const ids = [...read('fip-guide.html').matchAll(/\bid="(country-[a-z]+)"/g)].map(m => m[1]);
    assert.ok(ids.length > 30, `found only ${ids.length} FIP country cards — the scan is wrong`);
    const indexed = new Set(GUIDE_INDEX.filter(u => u.page === 'fip-guide.html').map(u => u.id));
    assert.deepEqual(ids.filter(id => !indexed.has(id)), [], 'these FIP country cards are not in the search index');
    // …and the drawer finds a country by the names staff type: guides-5 ("Czechia (Czech Republic)")
    // and guides-6 (Ł folds to l).
    for (const [q, id] of [['sweden', 'country-se'], ['finland', 'country-fi'], ['czechia', 'country-cz'], ['lodz', 'country-pl']]) {
        assert.equal(searchGuideIndex(GUIDE_INDEX, q)[0]?.id, id, `"${q}" no longer leads to its own country card`);
    }
});

/**
 * Every opening `<div>` in a page whose class list holds one of `classes`, with its id — read by a scan
 * of this file's own, attribute order ignored, so it does not share a blind spot with the extractor.
 * @param {string} html @param {string[]} classes @returns {string[]}
 */
function cardIds(html, classes) {
    const src = html.replace(/<!--[\s\S]*?-->/g, ' ');
    const ids = [];
    for (const m of src.matchAll(/<div\b([^>]*)>/g)) {
        const id = m[1].match(/(?:^|\s)id="([^"]+)"/)?.[1];
        const cls = (m[1].match(/(?:^|\s)class="([^"]*)"/)?.[1] || '').split(/\s+/);
        if (id && classes.some(c => cls.includes(c))) ids.push(id);
    }
    return ids;
}

test('contract 10 — every Railcard and Rangers card is a unit of its own, however its attributes are ordered', () => {
    // Contract 9's job for the other two card guides. The extractor's card patterns once spelled the
    // attributes out in order, so writing the Gold Card as `<div id="rc-gold" class="rc amber">` dropped
    // it from the drawer's search with every test green: an element a pattern misses is not an error.
    /** @type {Array<[string, string[], number]>} */
    const guides = [
        ['railcard-guide.html', ['rc'], 10],
        ['rangers-guide.html', ['rr-card', 'rr-no-item'], 8],
    ];
    for (const [page, classes, least] of guides) {
        const ids = cardIds(read(page), classes);
        assert.ok(ids.length >= least, `${page}: found only ${ids.length} cards — the scan is wrong`);
        const indexed = new Set(GUIDE_INDEX.filter(u => u.page === page).map(u => u.id));
        assert.deepEqual(ids.filter(id => !indexed.has(id)), [], `${page}: these cards are not in the search index`);
    }
    // …and the extractor itself reads a card whichever attribute comes first, on all three card guides.
    const swaps = [
        ['railcard-guide.html', '<div class="rc amber" id="rc-gold"', '<div id="rc-gold" class="rc amber"', 'rc-gold'],
        ['rangers-guide.html', '<div class="rr-no-item" id="rr-cotswolds"', '<div id="rr-cotswolds" class="rr-no-item"', 'rr-cotswolds'],
        ['fip-guide.html', '<div id="country-se" class="card card-pad not-fip-card mb-8"',
            '<div class="card card-pad not-fip-card mb-8" id="country-se"', 'country-se'],
        ['fip-guide.html', '<details id="country-fr"', '<details class="x" id="country-fr"', 'country-fr'],
    ];
    for (const [page, from, to, id] of swaps) {
        const html = read(page);
        assert.ok(html.includes(from), `premise: ${page} no longer opens #${id} as ${from}`);
        const units = extractGuideUnits(html.replace(from, to), page);
        assert.ok(units.some(u => u.id === id), `${page}: #${id} is no longer a unit once its attributes are reordered`);
    }
});

test('contract 5c — a key legend holds no nested <div>, so blanking it blanks all of it', () => {
    // evidenceOf blanks a legend from `<div class="key"` to the FIRST `</div>`. A <div> nested in the
    // legend would end that blank at its own close, and the rest of the legend's example markers would be
    // read as claims again — contract 5's failure, reached by a markup change rather than an extractor one.
    let legends = 0;
    for (const page of GUIDE_PAGES) {
        const src = read(page).replace(/<!--[\s\S]*?-->/g, ' ');
        for (const m of src.matchAll(/<div class="key"[^>]*>([\s\S]*?)<\/div>/g)) {
            legends++;
            assert.doesNotMatch(m[1], /<div\b/, `${page}: a key legend holds a nested <div>`);
        }
    }
    assert.ok(legends >= 2, `found ${legends} key legends — the Railcard and Rangers guides each have one`);
});
