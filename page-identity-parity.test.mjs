/**
 * page-identity-parity.test.mjs — each page's colour is declared ONCE, and everything that wears it
 * agrees (v25.14). No browser: it reads the served stylesheets and the drawer's page list.
 *
 * WHY THIS FILE EXISTS. Until v25.14 every page restated its colour in two hand-written rules — the
 * header badge and the About badge — and the copies had already drifted: Links' About badge had a
 * full-strength border where every other page's was a 35% tint. v25.14 made the colour three tokens
 * each page declares in its own `:root` (shared.css → "Page identity"), read by the header badge,
 * the About badge and the card-title icon tiles. Three things keep that true, one test each:
 *
 *   1. Every card page declares the whole trio, once, at the top level of its own stylesheet. A
 *      missing token is not an error anything reports — the browser falls back to the default, so a
 *      page that forgot `--page-accent-text` reads its About badge in the Calendar's gold on its own
 *      tint, and looks nearly right.
 *   2. No page stylesheet restates a badge's colour. That is exactly the drift the trio replaced,
 *      and it comes back one well-meant rule at a time.
 *   3. The colour a page declares is the colour of the drawer pill that takes you there. The pill you
 *      tap and the badge you arrive at are one identity held in two hand-written places — the page
 *      stylesheets and the drawer's pill rules — so only a check keeps them in step.
 *
 * Admin is the one exception to 2 and 3, by decision: its header badge and its drawer pill are navy
 * with gold text rather than a gold fill (admin.css → #adminBadge says why). It still declares the
 * trio, because its About badge and its card tiles are gold like everything else gold.
 *
 * Part of `npm run test:hygiene`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cardPageFiles, pageStylesheets } from './scripts/app-pages.mjs';

const read = (/** @type {string} */ f) => readFileSync(new URL(`./${f}`, import.meta.url), 'utf8');
const stripComments = (/** @type {string} */ css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

const TRIO = ['--page-accent', '--page-accent-ink', '--page-accent-text'];
const SHEETS = pageStylesheets();
const CARD_PAGES = cardPageFiles();

/** The one page whose badge and pill are worn differently, and why: see the header above. */
const WORN_DIFFERENTLY = 'admin.html';

/**
 * Every rule in a stylesheet, with its nesting depth — a small brace walker, enough for this
 * repo's CSS (no braces inside strings). `@media` blocks come back as rules too, and the rules
 * inside them carry depth 1.
 * @param {string} css
 * @returns {Array<{ selector: string, body: string, depth: number }>}
 */
function rules(css) {
    const s = stripComments(css);
    /** @type {Array<{ selector: string, body: string, depth: number }>} */
    const out = [];
    /** @type {Array<{ selector: string, start: number }>} */
    const open = [];
    let preludeStart = 0;
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (c === '{') {
            open.push({ selector: s.slice(preludeStart, i).trim(), start: i + 1 });
            preludeStart = i + 1;
        } else if (c === '}') {
            const block = open.pop();
            if (block) out.push({ selector: block.selector, body: s.slice(block.start, i), depth: open.length });
            preludeStart = i + 1;
        } else if (c === ';') {
            preludeStart = i + 1;
        }
    }
    return out;
}

/**
 * The page-identity tokens a stylesheet declares in a TOP-LEVEL `:root`, name → value text. A
 * `:root` inside a media query is deliberately not read: the colour would hold at some widths only.
 * @param {string} css
 */
function declaredTrio(css) {
    /** @type {Record<string, string>} */
    const found = {};
    for (const r of rules(css)) {
        if (r.depth !== 0 || r.selector !== ':root') continue;
        for (const m of r.body.matchAll(/(--page-accent(?:-ink|-text)?)\s*:\s*([^;]+);/g)) found[m[1]] = m[2].trim();
    }
    return found;
}

/** A top-level rule's declared value for one property, or undefined. */
function declared(/** @type {string} */ css, /** @type {string} */ selector, /** @type {string} */ prop) {
    const rule = rules(css).find(r => r.depth === 0 && r.selector === selector);
    const m = rule && new RegExp(`(?:^|[;\\s])${prop}\\s*:\\s*([^;]+);`).exec(rule.body);
    return m ? m[1].trim() : undefined;
}

test('shared.css declares the page-identity defaults, and they are the Calendar\'s gold', () => {
    const base = declaredTrio(read('shared.css'));
    assert.deepEqual(Object.keys(base).sort(), [...TRIO].sort(),
        'shared.css :root must declare all three defaults — every rule that wears a page colour reads them');
});

test('shared.css\'s badge rules and the card-title tile read the page\'s tokens', () => {
    // The other half of the wiring. The page declares; these rules must READ — a badge rule that
    // went back to a literal gold would make every page gold while every declaration stayed right.
    const shared = read('shared.css');
    assert.equal(declared(shared, '.badge-page', 'background'), 'var(--page-accent)');
    assert.equal(declared(shared, '.badge-page', 'color'), 'var(--page-accent-ink)');
    assert.equal(declared(shared, '.lightbox-badge', 'color'), 'var(--page-accent-text)');
    assert.match(declared(shared, '.lightbox-badge', 'background') ?? '', /var\(--page-accent\)/);
    // The tile's selector is the exact shape card-header-parity.test.mjs pins in the markup, so the
    // two halves are each held by text: change either and one of the two files fails.
    const tile = '.card-header h2 > span[aria-hidden="true"]:first-child';
    const bg = declared(shared, tile, 'background');
    assert.ok(bg, `shared.css must keep the tile rule on exactly ${tile}`);
    assert.match(bg, /^color-mix\(in oklch, var\(--page-accent\) \d+%, white\)$/,
        'the tile is the page\'s colour mixed with WHITE — an oklch mix towards --surface drags every tint blue');
});

test('every card page declares its colour — all three tokens, once — at the top of its own stylesheet', () => {
    for (const page of CARD_PAGES) {
        const css = read(SHEETS[page]);
        const trio = declaredTrio(css);
        const missing = TRIO.filter(t => !(t in trio));
        assert.deepEqual(missing, [],
            `${SHEETS[page]} must declare ${missing.join(', ')} in a top-level :root. A missing token is ` +
            'silently the default — the Calendar\'s gold — so the page looks nearly right and is not.');
        for (const t of TRIO) {
            const count = [...stripComments(css).matchAll(new RegExp(`${t}\\s*:`, 'g'))].length;
            assert.equal(count, 1, `${SHEETS[page]} declares ${t} ${count} times — a page's colour is declared once`);
        }
    }
});

test('no page stylesheet restates a badge colour — the shared rules read the page\'s tokens', () => {
    // The header badge ids are read from the pages themselves, not listed here, so a page added
    // later is covered the day it ships.
    const ids = CARD_PAGES.flatMap(p => [...read(p).matchAll(/class="badge-page"[^>]*\bid="([\w-]+)"/g)].map(m => m[1]));
    assert.ok(ids.length >= CARD_PAGES.length, `expected a header badge on every card page, found ${ids.join(', ')}`);
    const BADGE = new RegExp(`\\.lightbox-badge|\\.badge-page|${ids.map(id => `#${id}\\b`).join('|')}`);
    const COLOUR = /(?:^|[;\s])(?:background(?:-color)?|color|border(?:-color)?)\s*:/;
    const offenders = [];
    for (const sheet of new Set(Object.values(SHEETS))) {
        for (const r of rules(read(sheet))) {
            if (r.selector.startsWith('@') || !BADGE.test(r.selector) || !COLOUR.test(r.body)) continue;
            if (sheet === SHEETS[WORN_DIFFERENTLY] && r.selector === '#adminBadge') continue;
            offenders.push(`${sheet}: ${r.selector}`);
        }
    }
    assert.deepEqual(offenders, [],
        'a page sets its colour in its :root trio, and shared.css\'s badge rules read it. A page rule ' +
        'colouring a badge is the hand-written copy the trio replaced, and copies drift.');
});

test('the colour a page declares is the colour of the drawer pill that takes you there', () => {
    // The drawer's page list is read as TEXT: nav-panel.js is a browser module and is not imported.
    const nav = read('nav-panel.js');
    /** @type {Record<string, string>} */
    const pillFor = {};
    for (const m of nav.matchAll(/url:\s*'\.\/([\w-]*\.html)?'\s*,\s*colorClass:\s*'(nav-panel-pill--[\w-]+)'/g)) {
        pillFor[m[1] || 'index.html'] = m[2];
    }
    const shared = read('shared.css');
    const base = declaredTrio(shared);
    const pages = ['index.html', ...CARD_PAGES.filter(p => p !== WORN_DIFFERENTLY)];
    for (const page of pages) {
        const pill = pillFor[page];
        assert.ok(pill, `${page} has no drawer pill in nav-panel.js's NAV_PAGES`);
        // The Calendar declares nothing: its colour IS the shared default.
        const trio = page === 'index.html' ? base : declaredTrio(read(SHEETS[page]));
        assert.equal(declared(shared, `.${pill}`, 'background'), trio['--page-accent'],
            `${page}: the drawer pill .${pill} and the page's --page-accent must be the same colour`);
        assert.equal(declared(shared, `.${pill}`, 'color'), trio['--page-accent-ink'],
            `${page}: the drawer pill's text and the page's --page-accent-ink must match`);
    }
});
