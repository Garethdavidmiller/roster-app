/**
 * page-visibility-parity.test.mjs — `hidden` must actually hide.
 * Run: node --test page-visibility-parity.test.mjs   (part of `npm run test:hygiene`)
 *
 * ── THE TRAP ────────────────────────────────────────────────────────────────────────────────────
 *
 * The `hidden` attribute works by a UA stylesheet rule of roughly `[hidden] { display: none }`.
 * That is an ATTRIBUTE selector at the lowest possible weight, so ANY author rule that sets
 * `display` on the same element out-specifies it — and the element renders in full while every
 * piece of code around it believes it is hidden.
 *
 * Nothing errors. Nothing warns. No behavioural test catches it, because the JS is correct: it set
 * `hidden = true` and the property really is true. It is visible only by looking at the page.
 *
 * This app has hit it at least twice — `index.css` carries a comment naming both:
 *
 *     "…is `display: flex`, so `nav.controls[hidden]` rendered in full. This is the same trap
 *      `.win-editor[hidden]` hit on the links page…"
 *
 * — and hit it a third time on the Overtime page, where the tab strip and a fixed bottom confirm
 * bar were both permanently on screen. Three occurrences of one defect, each found by eye, is the
 * point at which it earns a static guard rather than another comment.
 *
 * ── WHAT IS CHECKED ─────────────────────────────────────────────────────────────────────────────
 *
 * For every element in a served app page that carries the `hidden` attribute in the MARKUP, if any
 * stylesheet that page loads sets a non-`none` `display` on a selector matching it, that stylesheet
 * must also carry the companion `[hidden]` rule.
 *
 * Scoped to markup-`hidden` because that is the mechanical, checkable case. An element hidden only
 * by JS at runtime cannot be found statically — which is a limit worth stating rather than papering
 * over: this guard shrinks the trap, it does not abolish it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const read = (/** @type {string} */ f) => readFileSync(new URL(f, import.meta.url), 'utf8');

const GUIDES = new Set(['guide.html', 'paycalc-guide.html', 'railcard-guide.html', 'fip.html', 'rangers-guide.html']);
const APP_PAGES = readdirSync(new URL('.', import.meta.url))
    .filter(f => f.endsWith('.html') && !GUIDES.has(f)).sort();

/** Strip CSS comments so a selector discussed in prose is not read as a rule. */
const stripCss = (/** @type {string} */ s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ');
/** Strip HTML comments so example markup in a comment is not read as an element. */
const stripHtml = (/** @type {string} */ s) => s.replace(/<!--[\s\S]*?-->/g, ' ');

/** The stylesheets a page actually loads, in order. */
function stylesheetsFor(page) {
    const html = read(`./${page}`);
    return [...html.matchAll(/<link rel="stylesheet" href="\.?\/?([a-z-]+\.css)"/g)].map(m => m[1]);
}

/**
 * Every id and class on an element whose start tag carries a bare `hidden` attribute.
 * `hidden="until-found"` is deliberately included — it hides too.
 */
function hiddenSelectors(html) {
    /** @type {Set<string>} */
    const out = new Set();
    for (const tag of stripHtml(html).match(/<[a-z][^>]*>/g) || []) {
        if (!/\shidden(\s|>|=)/.test(tag)) continue;
        const id = tag.match(/\sid="([^"]+)"/);
        if (id) out.add(`#${id[1]}`);
        const cls = tag.match(/\sclass="([^"]+)"/);
        if (cls) for (const c of cls[1].trim().split(/\s+/)) out.add(`.${c}`);
    }
    return out;
}

/**
 * Does `css` set a NON-none display on a rule whose selector list contains exactly `selector`
 * (not merely as a substring — `.ot-tab` must not match `.ot-tabs`)?
 */
function setsDisplay(css, selector) {
    const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // A rule head containing the selector as a whole token, then a body with `display:` other
    // than none. `[^{}]*` keeps the match inside one rule.
    const re = new RegExp(`(^|[,{}\\s])${esc}(?![\\w-])[^{}]*\\{([^}]*)\\}`, 'gm');
    for (const m of css.matchAll(re)) {
        const body = m[2];
        const decl = body.match(/(^|;)\s*display\s*:\s*([a-z-]+)/i);
        if (decl && decl[2].toLowerCase() !== 'none') return true;
    }
    return false;
}

/** Does `css` carry a companion rule that restores hiding for this selector? */
function hasHiddenCompanion(css, selector) {
    const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`${esc}\\[hidden\\]`).test(css)
        // A page-wide `[hidden] { display: none !important }` covers everything on that sheet.
        || /(^|[,{}\s])\[hidden\][^{}]*\{[^}]*display\s*:\s*none\s*!important/m.test(css);
}

test('the page and selector lists are not empty — guard the guard', () => {
    assert.ok(APP_PAGES.length >= 6);
    const anyHidden = APP_PAGES.some(p => hiddenSelectors(read(`./${p}`)).size > 0);
    assert.ok(anyHidden, 'no markup-hidden elements found at all — the extractor has stopped working');
});

test('a markup-hidden element with a display rule also has its [hidden] companion', () => {
    /** @type {string[]} */
    const broken = [];
    for (const page of APP_PAGES) {
        const html = read(`./${page}`);
        const sheets = stylesheetsFor(page).map(f => ({ file: f, css: stripCss(read(`./${f}`)) }));
        for (const sel of hiddenSelectors(html)) {
            for (const { file, css } of sheets) {
                if (!setsDisplay(css, sel)) continue;
                if (hasHiddenCompanion(css, sel)) continue;
                broken.push(`${page}: "${sel}" gets a display rule in ${file} with no ${sel}[hidden] companion `
                    + '— the element will render in full while the code believes it is hidden');
            }
        }
    }
    assert.deepEqual(broken, [], `\n  ${broken.join('\n  ')}\n`);
});

test('the fixes that prompted this guard are still in place', () => {
    // Named individually so that removing one fails HERE, with its history attached, rather than
    // only inside the general sweep above where it would read as an anonymous regression.
    assert.match(stripCss(read('./index.css')), /#calendarControls\[hidden\]/,
        'the calendar controls fix (nav.controls rendered in full behind display:flex)');
    assert.match(stripCss(read('./overtime.css')), /\.ot-tabs\[hidden\]/,
        'the Overtime tab strip fix');
    assert.match(stripCss(read('./overtime.css')), /\.ot-confirm-bar\[hidden\]/,
        'the Overtime confirm bar fix — a FIXED bottom bar, so it covered content on every page view');
});
