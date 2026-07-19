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
