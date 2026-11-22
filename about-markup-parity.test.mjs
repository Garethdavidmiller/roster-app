// @ts-check
/**
 * about-markup-parity.test.mjs — every app page's About panel carries the ids about-lightbox.js reads.
 * Run: node scripts/run-tests.mjs about-markup-parity.test.mjs   (part of `npm run test:hygiene` — needs nothing installed)
 *
 * `initAboutLightbox` looks its parts up BY ID and degrades quietly when one is missing: no version, no
 * update line, a bug link that does nothing. Three pages once named their bug link differently and
 * passed the id in (`bugLinkId`), so the shared module could not say what a page had to carry. Now there
 * is one set of ids, read here off about-lightbox.js itself (every `getElementById('…')` it makes) and
 * required inside every app page's `#iconLightbox` — so a page that renames one, or a lookup added to the
 * module without the markup, fails here rather than as a silent dead control.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { APP_PAGES } from './scripts/app-pages.mjs';

const read = (/** @type {string} */ f) => readFileSync(new URL(`./${f}`, import.meta.url), 'utf8');

/** Ids about-lightbox.js looks up that a page need not carry, each with its reason. */
const OPTIONAL = Object.freeze({
    lightboxPrintBtn: 'the print button is page-specific: only the pages with something to print carry it',
    appIcon: 'the header logo, not part of the panel — wireHeaderLogo wires it, and the Calendar\'s is its own',
});

/** Every id the module looks up, from its own source. */
const lookedUp = [...read('about-lightbox.js').matchAll(/getElementById\('([\w-]+)'\)/g)].map(m => m[1]);
const REQUIRED = lookedUp.filter(id => !(id in OPTIONAL));

/** The `<div id="iconLightbox" …>…</div>` element, by balancing its divs. */
function aboutPanel(/** @type {string} */ html) {
    const at = html.indexOf('id="iconLightbox"');
    if (at === -1) return '';
    const start = html.lastIndexOf('<div', at);
    let depth = 0;
    for (const m of html.slice(start).matchAll(/<div\b|<\/div>/g)) {
        depth += m[0] === '</div>' ? -1 : 1;
        if (depth === 0) return html.slice(start, start + /** @type {number} */ (m.index) + m[0].length);
    }
    return html.slice(start);
}

test('the module\'s lookups are read, and each optional one is still a lookup', () => {
    assert.ok(REQUIRED.includes('iconLightbox') && REQUIRED.includes('bugReportLink') && REQUIRED.length >= 5,
        `read ${lookedUp} from about-lightbox.js — re-read this test`);
    for (const id of Object.keys(OPTIONAL)) assert.ok(lookedUp.includes(id), `OPTIONAL names '${id}', which about-lightbox.js no longer looks up — drop it`);
});

test('every app page\'s #iconLightbox carries every id about-lightbox.js reads', () => {
    /** @type {string[]} */ const missing = [];
    for (const { file } of APP_PAGES) {
        const panel = aboutPanel(read(file));
        assert.ok(panel, `${file} has no #iconLightbox`);
        for (const id of REQUIRED) if (!panel.includes(`id="${id}"`)) missing.push(`${file}: #${id}`);
    }
    assert.deepEqual(missing, [], 'an About panel missing a part the shared module looks up — that part is silently dead there');
});
