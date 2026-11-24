/**
 * css-var-parity.test.mjs — every `var(--x)` a page can reach is DEFINED on that page (v23.13).
 * Run: node scripts/run-tests.mjs test/css-var-parity.test.mjs   (part of `npm run test:hygiene`)
 *
 * ── THE BUG THIS EXISTS FOR ────────────────────────────────────────────────────────────────────
 *
 * v23.09 shipped the Admin year chips styled with `var(--navy)` and `var(--gold)`. Neither token
 * exists on the app pages — they are the GUIDE palette's names for the same two colours, and the
 * app calls them `--primary-blue` and `--accent-gold`. The selected chip rendered with no fill and
 * no ink change, and nothing said so: an undefined custom property does not throw, does not warn,
 * and does not fail a behavioural test, because the element is still there and still readable. It
 * was found by looking at a screenshot, which is the same way `page-css-parity.test.mjs` found the
 * class it guards.
 *
 * Writing the guard measured the estate and found the slip was not a one-off. Seven live uses were
 * undefined on the page that used them, some for many releases: the boot spinner's gold arc
 * (`--gold`, in shared.css, so on every page — it drew white), the Overtime person button's fill and
 * three of its transitions (`--surface-card`, `--ease-out`), the pay calculator's disabled-field
 * ink at five sites (`--text-muted` — it drew full-dark, and the comment beside it promised muted),
 * the Links demand-row rule (`--border`) and the guide chip fill (`--white`, defined by three guide
 * pages and not by the two that load the shell through guide-doc.css). All seven were the same
 * shape: a name that exists SOMEWHERE in the repo, reached for from a file that does not load it.
 *
 * ── WHAT "DEFINED" MEANS HERE ──────────────────────────────────────────────────────────────────
 *
 * A token is available to a page if it is declared in a stylesheet that page `<link>`s, in the
 * page's own HTML, or by a JS module through `style.setProperty` (overlay.js sets `--lb-scroll-y`
 * on the body and shared.css reads it back — that is legitimate, and a guard that could not see it
 * would fail on the day it landed). The stylesheet list is READ FROM EACH PAGE, not kept as a map:
 * the lesson of page-contract-parity is that a hand-maintained page list goes green against a page
 * it has never heard of.
 *
 * A fallback does NOT exempt a use. `var(--navy, #001e3c)` would have hidden the shipped defect
 * just as well, and in this app every token is declared by a stylesheet or set by a module — a
 * fallback here covers the moment before JS sets a value, never the absence of a declaration.
 *
 * A use inside a JS template string (paycalc-breakdown.js writes `var(--text-faint)` into markup)
 * is held to the strictest scope: it must be in shared.css or set by JS, because this test does not
 * know which pages load which module, and a token every page carries is the only one it can vouch
 * for from here.
 *
 * ── WHAT IT CANNOT SEE ─────────────────────────────────────────────────────────────────────────
 *
 * Scope. `--nav-text-muted` is declared on `.nav-panel`, and a `var(--nav-text-muted)` outside the
 * drawer resolves to nothing at runtime while counting as defined here. shared.css already states
 * one such case in prose beside the boot placeholder. Catching it needs a cascade, not a regex.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

// Tests live in test/ but address files from the repository root (moved 24 Nov 2026).
const REPO_ROOT_URL = new URL('../', import.meta.url);

const read = (/** @type {string} */ f) => readFileSync(new URL(f, REPO_ROOT_URL), 'utf8');
const stripCss  = (/** @type {string} */ s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ');
const stripHtml = (/** @type {string} */ s) => s.replace(/<!--[\s\S]*?-->/g, ' ');
const rootFiles = (/** @type {string} */ ext) =>
    readdirSync(new URL('.', REPO_ROOT_URL)).filter((f) => f.endsWith(ext)).sort();

/**
 * Every custom property a stylesheet (or a page's inline style) DECLARES — `--x:` anywhere in the
 * text, media queries and scoped selectors included, because the bug is a name that is never
 * declared at all, not one declared out of scope.
 * @param {string} css
 * @returns {Set<string>}
 */
export function declaredTokens(css) {
    return new Set([...stripCss(css).matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
}

/**
 * Every custom property a text READS via `var()`. A fallback is recorded and deliberately not
 * honoured — see the header.
 * @param {string} text
 * @returns {{ name: string, fallback: boolean }[]}
 */
export function usedTokens(text) {
    return [...stripCss(text).matchAll(/var\(\s*(--[\w-]+)\s*(,)?/g)]
        .map((m) => ({ name: m[1], fallback: m[2] === ',' }));
}

/** Tokens a module sets at runtime: `el.style.setProperty('--x', …)`. */
export function jsDeclaredTokens() {
    const out = new Set();
    for (const f of rootFiles('.js')) {
        for (const m of read(f).matchAll(/setProperty\(\s*['"`](--[\w-]+)/g)) out.add(m[1]);
    }
    return out;
}

/** The stylesheets a page links, in order, as the page writes them. */
export function linkedSheets(/** @type {string} */ html) {
    return [...stripHtml(html).matchAll(
        /<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"|<link[^>]*href="([^"]+\.css)"[^>]*rel="stylesheet"/g,
    )].map((m) => (m[1] || m[2]).replace(/^\.\//, ''));
}

/**
 * The names a page reads and cannot resolve. Pure over its inputs so the teeth test below can hand
 * it a stylesheet that contains the shipped defect.
 * @param {{ html: string, sheets: Record<string, string>, jsTokens: Set<string> }} page
 * @returns {string[]} sorted, deduplicated, each as "--name (file)"
 */
export function unresolvedOnPage({ html, sheets, jsTokens }) {
    const defined = new Set(jsTokens);
    for (const d of declaredTokens(stripHtml(html))) defined.add(d);
    for (const css of Object.values(sheets)) for (const d of declaredTokens(css)) defined.add(d);
    /** @type {Set<string>} */
    const missing = new Set();
    const check = (/** @type {string} */ text, /** @type {string} */ where) => {
        for (const u of usedTokens(text)) if (!defined.has(u.name)) missing.add(`${u.name} (${where})`);
    };
    for (const [name, css] of Object.entries(sheets)) check(css, name);
    check(stripHtml(html), 'inline');
    return [...missing].sort();
}

const JS_TOKENS = jsDeclaredTokens();
const PAGES = rootFiles('.html');

test('every custom property a page reads is declared on that page', () => {
    /** @type {string[]} */
    const problems = [];
    for (const page of PAGES) {
        const html = read(page);
        /** @type {Record<string, string>} */
        const sheets = {};
        for (const s of linkedSheets(html)) sheets[s] = read(s);
        for (const miss of unresolvedOnPage({ html, sheets, jsTokens: JS_TOKENS })) {
            problems.push(`${page}: var(${miss.replace(' (', ') is read by ').replace(/\)$/, '')}, ` +
                `and no stylesheet this page loads declares it. It resolves to nothing and nothing errors.`);
        }
    }
    assert.deepEqual(problems, [], '\n' + problems.join('\n'));
});

test('a custom property written from a JS module is one every page carries', () => {
    const universal = new Set([...declaredTokens(read('shared.css')), ...JS_TOKENS]);
    /** @type {string[]} */
    const problems = [];
    for (const f of rootFiles('.js')) {
        if (f.endsWith('.test.mjs')) continue;
        for (const u of usedTokens(read(f))) {
            if (!universal.has(u.name)) {
                problems.push(`${f} writes var(${u.name}) into markup, and shared.css does not declare it — ` +
                    `this test cannot tell which pages load a module, so a module may only name a shared token.`);
            }
        }
    }
    assert.deepEqual(problems, [], '\n' + problems.join('\n'));
});

// GUARD THE GUARD. Each contract above is one broken regex from vacuous, so the extraction is
// pinned against figures loose enough not to churn and against the exact shapes it must see.
test('the extraction sees declarations, uses, fallbacks, JS-set tokens and the shipped defect', () => {
    const shared = read('shared.css');
    assert.ok(declaredTokens(shared).size > 120, 'shared.css yielded too few tokens — the scan is broken');
    assert.ok(usedTokens(shared).length > 300, 'shared.css yielded too few var() reads');
    assert.ok(declaredTokens(read('guide-shell.css')).has('--white'),
        'guide-shell.css must own --white: it draws .chip, and the document guides define no --white of their own');

    // A fallback is recorded as a use of the FIRST name, and flagged as carrying one.
    assert.deepEqual(usedTokens('a{b:var(--x, var(--y))}'), [
        { name: '--x', fallback: true }, { name: '--y', fallback: false },
    ]);
    // A token set only from JS counts as declared, and the one real case is still wired that way.
    assert.ok(JS_TOKENS.has('--lb-scroll-y'), 'overlay.js no longer sets --lb-scroll-y; update this sentinel');
    assert.ok(usedTokens(shared).some((u) => u.name === '--lb-scroll-y'),
        'shared.css no longer reads --lb-scroll-y; update this sentinel');

    // The v23.09 defect, replayed: a page whose only stylesheet reads the guide palette's names.
    const replay = unresolvedOnPage({
        html: '<link rel="stylesheet" href="admin.css">',
        sheets: { 'admin.css': '.al-year-chip.is-active{background:var(--navy);color:var(--gold, #fc0)}' },
        jsTokens: new Set(),
    });
    assert.deepEqual(replay, ['--gold (admin.css)', '--navy (admin.css)']);
    // …and a comment is not a use: the same text commented out resolves clean.
    assert.deepEqual(unresolvedOnPage({
        html: '', sheets: { 'x.css': '/* var(--navy) */ :root{--a:1} b{c:var(--a)}' }, jsTokens: new Set(),
    }), []);
});

// ── A DYNAMIC-VIEWPORT TOKEN CARRIES ITS OWN FALLBACK (v26.53) ─────────────────────────────────
// v26.52 moved every overlay cap to `max-height: 86vh; max-height: var(--modal-max-h);` with the
// token set to `86dvh`. The `86vh` line looked like a fallback and was not one: a declaration that
// holds a `var()` always parses, so it replaces the line above it, and where `dvh` is unknown
// (Chrome and Android WebView before 108) the token is invalid at computed-value time and the cap
// computes to `none`. So a token whose value uses a dynamic viewport unit (dvh/svh/lvh and their
// width and logical twins) must be declared ONLY inside an `@supports` block that tests the unit,
// and must also be declared, in the same file, with a value that uses none of them.

const DYNAMIC_UNIT = /\d(?:[dsl]v(?:h|w|i|b|min|max))\b/;

/**
 * Every `@supports` block's body span, by brace matching.
 * @param {string} css comment-stripped
 * @returns {{ start: number, end: number, condition: string }[]}
 */
export function supportsBlocks(css) {
    const out = [];
    for (const m of css.matchAll(/@supports\s+([^{]*)\{/g)) {
        let depth = 1;
        let i = /** @type {number} */ (m.index) + m[0].length;
        const start = i;
        for (; i < css.length && depth > 0; i++) {
            if (css[i] === '{') depth++;
            else if (css[i] === '}') depth--;
        }
        out.push({ start, end: i, condition: m[1] });
    }
    return out;
}

/**
 * The dynamic-viewport tokens in one stylesheet that have no working fallback.
 * @param {string} rawCss
 * @param {string} file
 * @returns {string[]}
 */
export function dynamicViewportTokenProblems(rawCss, file) {
    const css = stripCss(rawCss);
    const blocks = supportsBlocks(css);
    /** @type {Map<string, { dynamic: number[], plain: boolean }>} */
    const seen = new Map();
    const problems = [];
    for (const m of css.matchAll(/(--[\w-]+)\s*:\s*([^;}]*)/g)) {
        const name = m[1];
        const entry = seen.get(name) ?? { dynamic: [], plain: false };
        seen.set(name, entry);
        if (!DYNAMIC_UNIT.test(m[2])) { entry.plain = true; continue; }
        const at = /** @type {number} */ (m.index);
        const guarded = blocks.some((b) => at >= b.start && at < b.end && DYNAMIC_UNIT.test(b.condition));
        if (!guarded) {
            problems.push(`${file}: ${name}: ${m[2].trim()} is declared outside an @supports block that ` +
                `tests the unit — in a browser without it every var(${name}) computes to the property's ` +
                `initial value (for max-height, none), and a plain-unit line above the var() does not help.`);
        }
        entry.dynamic.push(at);
    }
    for (const [name, e] of seen) {
        if (e.dynamic.length && !e.plain) {
            problems.push(`${file}: ${name} has no declaration without a dynamic viewport unit, so a ` +
                `browser without one has no value for it at all.`);
        }
    }
    return problems;
}

test('a token defined with a dynamic viewport unit (dvh, svh, lvh…) degrades where the unit is unknown', () => {
    const problems = rootFiles('.css').flatMap((f) => dynamicViewportTokenProblems(read(f), f));
    assert.deepEqual(problems, [], '\n' + problems.join('\n'));

    // The guard is not vacuous: shared.css's cap is the case it exists for.
    const shared = stripCss(read('shared.css'));
    assert.match(shared, /--modal-max-h\s*:\s*86vh/, 'the --modal-max-h fallback declaration has gone');
    assert.ok(supportsBlocks(shared).some((b) => /--modal-max-h\s*:\s*86dvh/.test(shared.slice(b.start, b.end))),
        'the @supports half of --modal-max-h has gone — the cap no longer follows the dynamic viewport');

    // The v26.52 shape, replayed, fails both ways; the fixed shape passes.
    assert.equal(dynamicViewportTokenProblems(':root{--cap:86dvh} .p{max-height:86vh;max-height:var(--cap)}', 'x.css').length, 2);
    assert.deepEqual(dynamicViewportTokenProblems(
        ':root{--cap:86vh} @supports (height: 1dvh) { :root { --cap: 86dvh; } }', 'x.css'), []);
    // An @supports block that tests something else does not count.
    assert.equal(dynamicViewportTokenProblems(
        ':root{--cap:86vh} @supports (display: grid) { :root { --cap: 86dvh; } }', 'x.css').length, 1);
});
