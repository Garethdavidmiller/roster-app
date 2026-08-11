/**
 * page-contract-parity.test.mjs — a new app page joins EVERY contract, or fails here.
 * Run: node --test page-contract-parity.test.mjs   (part of `npm run test:hygiene`)
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────────
 *
 * Adding `overtime.html` was the first new app page since the parity suites were written, and it
 * revealed that most of them carry a HAND-MAINTAINED page list:
 *
 *   csp-meta-parity   SERVED_HTML = ['index.html', … ]
 *   card-header-parity PAGES      = ['admin.html', … ]
 *   page-css-parity   PAGES       = { 'admin.html': 'admin.css', … }
 *   tips-content      PAGES       = [ { js, html }, … ]
 *
 * Every one of them went green against the new page — by not looking at it. The page had no
 * mirrored CSP meta check, no card-header check, no borrowed-class check and no tips-shape check,
 * and nothing said so. That is the same defect the deploy workflow had at v20.55, where a
 * hand-listed `node --check functions/index.js functions/roster-parse-helpers.js` stopped covering
 * three modules that arrived after it: **a hand-maintained list quietly stops covering what arrives
 * later, and its silence is indistinguishable from success.**
 *
 * So this file checks the CHECKERS. It enumerates the served app pages from the filesystem — the one
 * source that cannot fall behind — and asserts each is named in every suite that should be reading
 * it, plus the handful of contracts that live in the app's own files rather than in a test.
 *
 * It deliberately does NOT re-implement any of those checks. It asserts they are POINTED at the
 * page; the suites themselves say whether the page passes.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const read = (/** @type {string} */ f) => readFileSync(new URL(f, import.meta.url), 'utf8');

/**
 * The five printable GUIDES are a different family — no shared.css, no nav drawer, no auth, no
 * analytics id — so they are excluded here and covered by their own rules. Everything else that is
 * a served HTML page at the repo root is an APP page and owes the full contract.
 */
const GUIDES = new Set([
    'guide.html', 'paycalc-guide.html', 'railcard-guide.html', 'fip.html', 'rangers-guide.html',
]);

const APP_PAGES = readdirSync(new URL('.', import.meta.url))
    .filter(f => f.endsWith('.html') && !GUIDES.has(f))
    .sort();

/** index.html is the calendar: a grid, not a stack of cards, and its own special case throughout. */
const CARD_PAGES = APP_PAGES.filter(f => f !== 'index.html');

test('the page list itself is not empty or accidentally filtered to nothing', () => {
    // Guard the guard: every assertion below is "X contains Y", all of which pass vacuously over an
    // empty list. The six app pages are calendar, admin, paycalc, operations, settings, links —
    // plus overtime.
    assert.ok(APP_PAGES.length >= 6, `expected at least six app pages, found ${APP_PAGES.join(', ') || 'none'}`);
    assert.ok(APP_PAGES.includes('index.html'), 'the calendar must be in the list');
});

test('every app page is checked by csp-meta-parity', () => {
    // The meta CSP is the ONLY policy the GitHub Pages mirror gets — it cannot serve headers — so a
    // page missing from this list has no CSP there at all, and nothing would say so.
    const suite = read('./csp-meta-parity.test.mjs');
    const missing = APP_PAGES.filter(p => !suite.includes(`'${p}'`));
    assert.deepEqual(missing, [], 'pages absent from csp-meta-parity\'s SERVED_HTML list');
});

test('every card-bearing page is checked by card-header-parity', () => {
    const suite = read('./card-header-parity.test.mjs');
    const missing = CARD_PAGES.filter(p => !suite.includes(`'${p}'`));
    assert.deepEqual(missing, [], 'pages absent from card-header-parity\'s PAGES list');
});

test('every app page is checked by page-css-parity, against its own stylesheet', () => {
    const suite = read('./page-css-parity.test.mjs');
    const missing = APP_PAGES.filter(p => !suite.includes(`'${p}':`));
    assert.deepEqual(missing, [], 'pages absent from page-css-parity\'s PAGES map');
});

test('every page with a Tips panel is checked by tips-content', () => {
    // Scoped to pages that actually HAVE `?` buttons: requiring an entry for a page with no tips
    // would force a fictional one, which is worse than not checking.
    const suite = read('./tips-content.test.mjs');
    const withTips = APP_PAGES.filter(p => read(`./${p}`).includes('btn-card-tips'));
    const missing = withTips.filter(p => !suite.includes(`'${p}'`));
    assert.deepEqual(missing, [], 'pages with Tips panels absent from tips-content\'s PAGES list');
});

test('every app page carries the noindex meta', () => {
    // Staff-only app. This meta is the only de-index signal the headerless mirror gets.
    const missing = APP_PAGES.filter(p => !/name="robots"[^>]*noindex/.test(read(`./${p}`)));
    assert.deepEqual(missing, [], 'pages without a robots noindex meta');
});

test('every app page opts out of algorithmic dark mode', () => {
    // The app has no dark theme; a force-dark browser inverts the off-white cards and leaves the
    // navy, which is a real staff report rather than a hypothetical.
    const missing = APP_PAGES.filter(p => !/name="color-scheme"[^>]*only light/.test(read(`./${p}`)));
    assert.deepEqual(missing, [], 'pages without `color-scheme: only light`');
});

test('every app page loads shared.css and its own stylesheet, and no other page\'s', () => {
    for (const page of APP_PAGES) {
        const html = read(`./${page}`);
        // `./shared.css` or bare `shared.css` — admin.html uses the bare form and the rest do not.
        // A cosmetic inconsistency, not a defect, so the assertion accepts both rather than
        // provoking a churn commit across six pages to satisfy a regex.
        assert.match(html, /href="\.?\/?shared\.css"/, `${page} does not load shared.css`);
        const own = page.replace(/\.html$/, '.css');
        // index.html's stylesheet is index.css; every page follows the same naming.
        assert.match(html, new RegExp(`href="\\.?/?${own.replace('.', '\\.')}"`), `${page} does not load its own ${own}`);
    }
});

test('every app page boots through a shim rather than an inline module', () => {
    // CSP `script-src 'self'` blocks inline module scripts outright, so an inline `init()` does not
    // degrade — the page simply never starts. index.html is the exception: it loads its coordinator
    // directly plus the classic splash watchdog.
    for (const page of CARD_PAGES) {
        const html = read(`./${page}`);
        assert.match(html, /<script type="module" src="\.\/[a-z-]+-boot\.js"><\/script>/,
            `${page} has no *-boot.js bootstrap`);
        assert.equal(/<script type="module">/.test(html), false,
            `${page} carries an inline module script, which CSP blocks`);
    }
});

test('every app page and its assets are registered in the service worker', () => {
    // An unregistered page is not merely un-cached: the offline fallback chain routes by filename,
    // so it would fall through to the calendar's HTML while asking for its own.
    const sw = read('./service-worker.js');
    for (const page of APP_PAGES) {
        assert.ok(sw.includes(`'${page}'`) || sw.includes(`"./${page}"`), `${page} is not in the SW asset lists`);
        const css = page.replace(/\.html$/, '.css');
        assert.ok(sw.includes(`'${css}'`) || sw.includes(`"./${css}"`), `${css} is not in the SW asset lists`);
    }
});

test('every app page has an auth-policy entry, so none falls back to the fail-closed default', () => {
    // `requirePage` fails closed on an unknown page name — safe, but it means a missing entry looks
    // like "admin required" rather than like a mistake, and the page is simply unreachable.
    const policy = read('./auth-policy.js');
    const pageIds = APP_PAGES.map(p => (p === 'index.html' ? 'calendar' : p.replace(/\.html$/, '')));
    const missing = pageIds.filter(id => !new RegExp(`^\\s{4}${id}:\\s*\\{`, 'm').test(policy));
    assert.deepEqual(missing, [], 'page ids with no PAGE_POLICIES entry');
});

test('every app page has a nav pill, so the drawer is a complete map', () => {
    // The drawer renders the CURRENT page as an inert pill rather than omitting it, which is what
    // keeps the row the same shape everywhere. A page with no entry breaks that on its own surface.
    const nav = read('./nav-panel.js');
    const pageIds = APP_PAGES.map(p => (p === 'index.html' ? 'calendar' : p.replace(/\.html$/, '')));
    const missing = pageIds.filter(id => !nav.includes(`id: '${id}'`));
    assert.deepEqual(missing, [], 'page ids with no NAV_PAGES entry');
});

test('every app page records its own usage under an id the rules allow', () => {
    // Fire-and-forget writes: an id the rules reject fails SILENTLY, and the Usage card simply
    // under-reports for as long as nobody notices. firestore-contract-parity checks the two lists
    // against each other; this checks that the page is in them at all.
    const rules = read('./firestore.rules');
    const allow = rules.match(/counts\.keys\(\)\.hasOnly\(\[([\s\S]*?)\]\)/);
    assert.ok(allow, 'analytics counts allowlist not found');
    for (const page of APP_PAGES) {
        const id = page === 'index.html' ? 'calendar' : page.replace(/\.html$/, '');
        assert.ok(allow[1].includes(`'${id}'`), `analytics id '${id}' is not allowed by firestore.rules`);
    }
});
