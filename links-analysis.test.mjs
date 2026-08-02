// Tests for links-analysis.js — the read-only analysis panels (Coverage heat map + Design checks)
// extracted from links-app.js. Fake DOM, no module mocks → runs in `npm run test:hygiene`.
// The pure maths is covered by links-design.test.mjs; here we prove the RENDER + the getDesign seam.
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Minimal DOM: getElementById returns a per-id stub element with { innerHTML, style }.
const els = /** @type {Record<string, any>} */ ({});
const el = () => ({ innerHTML: '', style: {} });
function resetDom() { for (const id of ['coverageHeatmap', 'coverageEmptyMsg', 'checksContent']) els[id] = el(); }
resetDom();
global.document = /** @type {any} */ ({ getElementById: (/** @type {string} */ id) => els[id] || null });

const { initLinksAnalysis } = await import('./links-analysis.js');

/** A fully-designed 28-line rotation (every line worked Mon–Fri, rest Sat/Sun). */
function fullPatterns() {
    const p = /** @type {Record<string, any>} */ ({});
    for (let i = 1; i <= 28; i++) {
        p[String(i)] = { sun: 'RD', mon: '06:00-14:00', tue: '06:00-14:00', wed: '06:00-14:00', thu: '06:00-14:00', fri: '06:00-14:00', sat: 'RD' };
    }
    return p;
}

test('empty state (getDesign → null) shows the empty messages and hides the heatmap', () => {
    resetDom();
    const a = initLinksAnalysis({ getDesign: () => null });
    a.renderCoverageChart();
    assert.equal(els.coverageHeatmap.style.display, 'none');
    assert.equal(els.coverageEmptyMsg.style.display, '');   // shown
    a.renderDesignChecks();
    assert.match(els.checksContent.innerHTML, /Load or create a link design/);
});

test('designed state renders the coverage heat map + the checks panel', () => {
    resetDom();
    const design = { patterns: fullPatterns() };
    const a = initLinksAnalysis({ getDesign: () => design });

    a.renderCoverageChart();
    assert.equal(els.coverageHeatmap.style.display, '');       // visible
    assert.equal(els.coverageEmptyMsg.style.display, 'none');
    assert.match(els.coverageHeatmap.innerHTML, /cov-heat/);   // the table rendered
    assert.match(els.coverageHeatmap.innerHTML, /Peak this week/);

    a.renderDesignChecks();
    assert.match(els.checksContent.innerHTML, /check-rows/);
    assert.match(els.checksContent.innerHTML, /All lines designed/); // all 28 filled
    assert.match(els.checksContent.innerHTML, /Shift balance/);
});

test('getDesign is read lazily — a later design change is reflected on the next render', () => {
    resetDom();
    let current = /** @type {any} */ (null);
    const a = initLinksAnalysis({ getDesign: () => current });

    a.renderDesignChecks();
    assert.match(els.checksContent.innerHTML, /Load or create/);       // null → empty message
    current = { patterns: fullPatterns() };
    a.renderDesignChecks();
    assert.match(els.checksContent.innerHTML, /All lines designed/);   // now designed
});

test('an unfilled (all-rest) line is reported by the checks panel', () => {
    resetDom();
    const patterns = fullPatterns();
    patterns['7'] = { sun: 'RD', mon: 'RD', tue: 'RD', wed: 'RD', thu: 'RD', fri: 'RD', sat: 'RD' };
    const a = initLinksAnalysis({ getDesign: () => ({ patterns }) });
    a.renderDesignChecks();
    assert.match(els.checksContent.innerHTML, /Lines not yet designed/);
});

// ─────────────────────────────────────────────────────────────────────────────
// Every row class this panel emits must actually EXIST in links.css (v19.48).
//
// This is the one static guard worth having here, because the failure it catches is silent in
// exactly the way the repo keeps re-learning: v19.46 shipped ~15 rows carrying `check-info`, a class
// no stylesheet defines. Nothing threw, every behavioural test passed (they assert text), and the
// rows simply rendered with no surface at all while every neighbour had one — visible only to
// someone looking at the page, or to computed styles.
//
// A pixel baseline would also catch it, but a class-name typo is a STRING problem and this checks
// the string directly: cheap, deterministic, and immune to the rendering-environment sensitivity
// that keeps the visual suite opt-in.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';

test('every check-row class the panel emits is defined in links.css', () => {
    const js  = readFileSync(new URL('./links-analysis.js', import.meta.url), 'utf8');
    const css = readFileSync(new URL('./links.css', import.meta.url), 'utf8');

    // Collect EVERY `check-*` token the module names, from any class attribute plus the status→class
    // map. Deliberately generic rather than an enumerated list of the classes that exist today: an
    // enumerated list silently stops covering whatever gets added next, which is the same failure
    // mode as a hand-maintained precache list. (The first version listed them; `check-code`,
    // `check-family` and `check-section-meta` arrived one version later and were not covered.)
    /** @type {Set<string>} */
    const used = new Set();
    for (const m of js.matchAll(/class="([^"]*)"/g)) {
        for (const c of m[1].split(/[\s$]+/)) if (/^check-[\w-]+$/.test(c)) used.add(c);
    }
    for (const m of js.matchAll(/const CLS\s*=\s*\{([^}]*)\}/g)) {
        for (const c of m[1].matchAll(/'([\w-]+)'/g)) if (c[1].startsWith('check-')) used.add(c[1]);
    }

    assert.ok(used.size >= 12, `expected to find the row classes, found ${used.size}: ${[...used]}`);
    for (const expected of ['check-code', 'check-family', 'check-section-meta']) {
        assert.ok(used.has(expected), `the scan must reach ${expected}`);
    }
    assert.ok(used.has('check-neutral'), 'the neutral/info surface must be among them');

    // `(?![\w-])`, NOT `\b`. A hyphen is a word boundary, so `\.check-info\b` happily matches inside
    // `.check-info-icon` — which is precisely the pair in this stylesheet, so the first version of
    // this guard passed against the exact bug it was written for. A class name only ends where a
    // character that cannot be part of one begins.
    const missing = [...used].filter(c => !new RegExp(`\\.${c}(?![\\w-])`).test(css));
    assert.deepEqual(missing, [], `class(es) emitted by links-analysis.js with no rule in links.css: ${missing.join(', ')}`);
});
