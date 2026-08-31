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
import { buildGuideIndex, GUIDE_PAGES, PROVISIONAL_MARKERS } from './scripts/guide-index-lib.mjs';
import { GUIDE_INDEX } from './guide-index.js';

const read = (/** @type {string} */ n) => readFileSync(new URL(`./${n}`, import.meta.url), 'utf8');

test('contract 1 — the committed index matches a fresh generation from the guide HTML', () => {
    assert.deepEqual(GUIDE_INDEX, buildGuideIndex(read),
        'guide-index.js is stale — run `npm run generate:guide-index` in the same commit as the guide change');
});

test('contract 2 — every drawer guide is represented, and the index names no page the drawer lacks', () => {
    const nav = read('nav-panel.js');
    // NAV_GUIDES rows are exactly the url entries that also carry an openId — NAV_PAGES has none.
    const navGuides = [...nav.matchAll(/url: '\.\/([a-z-]+\.html)',\s*openId:/g)].map(m => m[1]);
    assert.deepEqual([...new Set(GUIDE_INDEX.map(u => u.page))].sort(), [...navGuides].sort());
    assert.deepEqual([...GUIDE_PAGES].sort(), [...navGuides].sort(),
        'GUIDE_PAGES (the generator) and NAV_GUIDES (the drawer) disagree about which guides exist');
});

test('contract 3 — the provisional-marker vocabulary mirrors guide-sources.test.mjs', () => {
    // Restated by value, as tests pin constants: if guide-sources gains a marker dialect, the
    // extractor must learn it in the same commit or a provisional claim becomes invisible here.
    const src = read('guide-sources.test.mjs');
    for (const cls of [...PROVISIONAL_MARKERS.draft, ...PROVISIONAL_MARKERS.conflict]) {
        assert.ok(src.includes(`'${cls}'`), `guide-sources.test.mjs does not pin marker ${cls}`);
    }
    assert.deepEqual(PROVISIONAL_MARKERS.draft, ['rr-card--draft', 'rc-unsourced']);
    assert.deepEqual(PROVISIONAL_MARKERS.conflict, ['rr-card--conflict', 'rr-unresolved']);
    assert.deepEqual(PROVISIONAL_MARKERS.unconfirmed, ['myb-status--unconfirmed']);
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

test('contract 6 — result rows ride nav-panel\'s delegated guide-link handler', () => {
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

test('contract 7 — evidence-bearing units exist (the extractor has not gone quietly blind)', () => {
    // If a rewrite of the extractor stopped seeing markers entirely, contracts 3 and 5 could pass
    // vacuously on empty lists. At least the three known claims must be found somewhere.
    assert.ok(GUIDE_INDEX.filter(u => u.e.length > 0).length >= 3);
});
