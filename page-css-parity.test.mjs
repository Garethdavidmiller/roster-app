/**
 * page-css-parity.test.mjs — a page may only use classes its OWN stylesheets define (v20.09).
 * Run: node --test page-css-parity.test.mjs   (part of `npm run test:hygiene`)
 *
 * ── THE BUG THIS EXISTS FOR ─────────────────────────────────────────────────────────────────────
 *
 * `settings.html` carried `<p class="card-explainer">` from v19.16 to v20.08. That class was defined
 * in **paycalc.css**, which settings.html does not load — so the Pay Calculator Data card's one
 * explanatory paragraph rendered at browser-default size and colour, with no line-height and the
 * wrong margin, for nine releases.
 *
 * **Nothing could have caught it.** An absent class does not throw, does not warn, and does not fail
 * a behavioural test — the paragraph is still present and still readable, just not styled. The
 * visual suite does not baseline settings at desktop, and even where it does, a first baseline
 * captures whatever renders and calls it correct. It was found by looking at a screenshot.
 *
 * This is the same failure `links-analysis.test.mjs` guards inside one module (v19.48: ~15 rows
 * shipped on `check-info`, a class no stylesheet defined) — one level up, and across files rather
 * than within one.
 *
 * ── WHY IT IS SCOPED TO CROSS-PAGE BORROWING, NOT "EVERY CLASS EXISTS" ──────────────────────────
 *
 * A general "every class in this HTML is defined somewhere" test would be mostly false positives:
 * state classes are added by JS (`.open`, `.visible`), some classes are hooks with no styling at
 * all, and third-party/utility names come and go. It would need an allowlist long enough to hide
 * the one case that matters.
 *
 * The case that matters is narrow and precisely detectable: a class that IS defined, in exactly one
 * PAGE-SPECIFIC stylesheet, used by a page that does not load that stylesheet. That is always a
 * mistake — either the class belongs in `shared.css`, or the markup belongs on the other page.
 * There is no legitimate third reading, which is what makes the test cheap and quiet.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/** The six app pages and the page-specific stylesheet each one loads. `shared.css` is universal. */
const PAGES = {
    'index.html':      'index.css',
    'admin.html':      'admin.css',
    'paycalc.html':    'paycalc.css',
    'operations.html': 'operations.css',
    'settings.html':   'settings.css',
    'links.html':      'links.css',
};

const read = (/** @type {string} */ f) => readFileSync(new URL(f, import.meta.url), 'utf8');

/** Strip comments so a class named only in prose is not read as a definition or a use. */
const stripCss  = (/** @type {string} */ s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ');
const stripHtml = (/** @type {string} */ s) => s.replace(/<!--[\s\S]*?-->/g, ' ');

/**
 * Every class SELECTOR a stylesheet defines. Deliberately includes classes inside media queries and
 * compound selectors — a rule that only applies at one breakpoint is still a definition, and the
 * bug is about the file being absent entirely, not about which rules within it match.
 * @param {string} css
 * @returns {Set<string>}
 */
function definedClasses(css) {
    const out = new Set();
    // Selector text only: everything before a `{`, so a class-looking token inside a declaration
    // value (a url, a content string) is never mistaken for a definition.
    for (const m of stripCss(css).matchAll(/([^{}]*)\{/g)) {
        for (const c of m[1].matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) out.add(c[1]);
    }
    return out;
}

/**
 * Every class a page's static markup APPLIES. Only `class="..."` attributes — classes a page's JS
 * adds at runtime are out of scope here (they are the general problem this test declines to solve).
 * @param {string} html
 * @returns {Set<string>}
 */
function usedClasses(html) {
    const out = new Set();
    for (const m of stripHtml(html).matchAll(/\sclass="([^"]*)"/g)) {
        for (const c of m[1].split(/\s+/)) if (c) out.add(c);
    }
    return out;
}

const SHARED = definedClasses(read('./shared.css'));
/** @type {Record<string, Set<string>>} */
const PAGE_CSS = {};
for (const css of Object.values(PAGES)) PAGE_CSS[css] = definedClasses(read(css));

test('no page uses a class defined only in ANOTHER page\'s stylesheet', () => {
    /** @type {string[]} */
    const problems = [];

    for (const [html, ownCss] of Object.entries(PAGES)) {
        const used = usedClasses(read(html));
        for (const cls of used) {
            if (SHARED.has(cls) || PAGE_CSS[ownCss].has(cls)) continue;
            // Not defined anywhere this page loads. Is it defined in some OTHER page's CSS?
            const elsewhere = Object.entries(PAGE_CSS)
                .filter(([css, set]) => css !== ownCss && set.has(cls))
                .map(([css]) => css);
            if (elsewhere.length) {
                problems.push(
                    `${html} uses ".${cls}", which is defined only in ${elsewhere.join(' + ')} — a ` +
                    `file it does not load. It renders unstyled and nothing errors. Move the rule to ` +
                    `shared.css, or move the markup.`);
            }
        }
    }

    assert.deepEqual(problems, [], '\n' + problems.join('\n'));
});

// GUARD THE GUARD. Every assertion above is a `continue` away from vacuous: an extraction bug that
// returned no definitions would pass the moment nothing was "defined elsewhere" either, and an
// extraction bug that returned no USES would pass unconditionally. Both are pinned with figures
// loose enough not to churn and tight enough to catch an empty set.
test('the extraction actually found selectors and classes', () => {
    assert.ok(SHARED.size > 120, `shared.css yielded only ${SHARED.size} classes — the selector scan is broken`);
    for (const [css, set] of Object.entries(PAGE_CSS)) {
        assert.ok(set.size > 10, `${css} yielded only ${set.size} classes`);
    }
    for (const html of Object.keys(PAGES)) {
        assert.ok(usedClasses(read(html)).size > 20, `${html} yielded too few used classes`);
    }
    // And the fixed bug, named: settings.html really does use it, and shared.css really defines it.
    assert.ok(usedClasses(read('./settings.html')).has('card-explainer'),
        'settings.html no longer uses .card-explainer — if the markup went, this sentinel should too');
    assert.ok(SHARED.has('card-explainer'),
        '.card-explainer must live in shared.css: paycalc.html and settings.html both use it');
});
