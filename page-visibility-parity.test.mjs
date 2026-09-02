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
 * Elements hidden by JS at runtime are checked too (v22.30). This file used to say they "cannot be
 * found statically", and that turned out to be true in general and false of the shape this app
 * actually uses: nearly every one is fetched by id into a const and then assigned `.hidden`, which
 * resolves mechanically. Measured at 41 elements. The trap is smaller than it was, not abolished —
 * three things still escape, and they are named rather than implied:
 *
 *   · an element reached by query selector, a loop variable, or a reference passed in from elsewhere;
 *   · a variable name bound to two different ids in one file, which is dropped as AMBIGUOUS rather
 *     than guessed at (`admin-app.js` binds `banner` twice, and guessing produced this contract's
 *     first false positive);
 *   · a `display` written into the element's own inline style, which nothing here reads.
 *
 * The false positives are worth recording, because both were in the CHECKER rather than the app and
 * a guard that cries wolf gets muted: the ambiguous-name one above, and `setsDisplay` matching a
 * selector anywhere in a rule head, so `.login-field label { display: block }` read as a display on
 * `.login-field`. It now requires the selector to be the rule's SUBJECT.
 *
 * ── AND THE OPPOSITE FAULT (v20.80) ─────────────────────────────────────────────────────────────
 *
 * The same file also guards hiding that works TOO well. Three pages hide their entire `.container`
 * until `body.auth-ready`, and their header lives inside it — so until their module graph has loaded
 * and run they are a blank navy screen with nothing on it, not even a burger. That is the intended
 * anti-flash behaviour doing exactly what it should and being indistinguishable from a broken page.
 *
 * So: a page that hides its whole shell must say something in the meantime. Derived from the CSS
 * rather than from a list, because a list is what falls behind — a fourth page that adopts the
 * pattern is caught the moment it does.
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
    // The selector must be the rule's SUBJECT — the last compound in its own comma-separated part.
    // `.login-field label { display: block }` sets display on the LABEL; reading it as a display on
    // `.login-field` reported a hidden element as broken when nothing was wrong with it. Matching
    // the selector anywhere in the head is the looser reading and it is the wrong one.
    const subject = new RegExp(`(^|[\\s>+~])${esc}(?![\\w-])[^\\s>+~]*$`);
    for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
        const decl = m[2].match(/(^|;)\s*display\s*:\s*([a-z-]+)/i);
        if (!decl || decl[2].toLowerCase() === 'none') continue;
        for (const part of m[1].split(',')) {
            // Ignore an at-rule preamble (`@media …`) that the split can leave attached.
            const head = part.trim().replace(/^@[^{]*$/, '');
            if (head && subject.test(head)) return true;
        }
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

/**
 * The ids a MODULE hides at runtime, resolved through `document.getElementById`.
 *
 * The header above says a JS-hidden element "cannot be found statically". That is true in general
 * and false of the shape this app actually uses: nearly every one is fetched by id into a const in
 * the same file and then assigned `.hidden`. 41 of them resolve this way, so the gap the guard
 * declared is mostly closable — measured, not assumed.
 *
 * What stays out of reach, and is left stated rather than half-covered: an element reached through
 * a query selector, a loop variable, or a reference passed in from another module.
 */
function runtimeHiddenIds() {
    /** @type {Map<string, Set<string>>} id → the files that hide it */
    const out = new Map();
    const add = (/** @type {string} */ id, /** @type {string} */ f) => {
        if (!out.has(id)) out.set(id, new Set());
        (out.get(id) || new Set()).add(f);
    };
    const files = readdirSync(new URL('.', import.meta.url))
        .filter(f => f.endsWith('.js') && !f.endsWith('.test.mjs'));
    for (const f of files) {
        let src;
        try { src = read(`./${f}`); } catch { continue; }
        src = src.replace(/\/\*[\s\S]*?\*\//g, ' ');
        src = src.split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
        // A name bound to MORE THAN ONE id in the same file is AMBIGUOUS and is dropped.
        // Scoped names are reused — `admin-app.js` binds `banner` to `#unsavedBanner` in one IIFE
        // and to `#alBanner` in another — and a file-global first-wins map then attributes the
        // second one's `.hidden` to the first. That is not hypothetical: it is exactly what the
        // first cut of this contract reported, a false positive on an element toggled purely
        // through `style.display`. A guard that cries wolf gets muted, so ambiguity loses the
        // element rather than guessing at it.
        /** @type {Map<string, Set<string>>} name → the ids it is bound to */
        const bindings = new Map();
        for (const m of src.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*(?:\/\*\*[^*]*\*\/\s*)?\(?\s*document\.getElementById\(\s*['"]([\w-]+)['"]/g)) {
            if (!bindings.has(m[1])) bindings.set(m[1], new Set());
            (bindings.get(m[1]) || new Set()).add(m[2]);
        }
        for (const m of src.matchAll(/(\w+)\.hidden\s*=/g)) {
            const ids = bindings.get(m[1]);
            if (ids && ids.size === 1) add([...ids][0], f);
        }
        for (const m of src.matchAll(/document\.getElementById\(\s*['"]([\w-]+)['"]\s*\)\s*\.hidden\s*=/g)) {
            add(m[1], f);
        }
    }
    return out;
}

/** Every place an element's start tag can be written: the served pages, and the modules that
 *  inject markup as template literals. */
function markupSources() {
    const files = readdirSync(new URL('.', import.meta.url))
        .filter(f => (f.endsWith('.html') && !GUIDES.has(f)) || (f.endsWith('.js') && !f.endsWith('.test.mjs')));
    /** @type {string[]} */
    const out = [];
    for (const f of files) {
        try { out.push(f.endsWith('.html') ? stripHtml(read(`./${f}`)) : read(`./${f}`)); } catch { /* unreadable */ }
    }
    return out;
}

test('the runtime-hidden extractor still finds elements — guard the guard', () => {
    assert.ok(runtimeHiddenIds().size >= 20,
        'the getElementById → .hidden extractor found almost nothing — it has stopped working, '
        + 'and this contract would then pass by looking at an empty list');
});

// The same rule as the markup contract below, for elements JS hides instead. The trap is
// identical and so is the silence: the code sets `hidden = true`, the property really is true,
// and an author `display` out-specifies the UA rule so the element stays on screen. No
// behavioural test can see it, because nothing is wrong with the behaviour.
//
// Every element is checked against EVERY app stylesheet rather than only the ones its own page
// loads, because a runtime-hidden element is often injected (the nav drawer, the forced-password
// overlay) and so has no page of its own to look up. That is deliberately the stricter reading:
// a shared component's rule lives in shared.css and reaches every page that loads it.
test('a JS-hidden element with a display rule also has its [hidden] companion', () => {
    const sheets = [...new Set(APP_PAGES.flatMap(stylesheetsFor))]
        .map(f => ({ file: f, css: stripCss(read(`./${f}`)) }));
    /** @type {string[]} */
    const broken = [];
    for (const [id, files] of runtimeHiddenIds()) {
        // The element's own classes, where it IS in served markup — a class rule is the commoner
        // way this breaks, since ids rarely carry a display and classes usually do.
        /** @type {Set<string>} */
        const sels = new Set([`#${id}`]);
        // …from the served pages AND from the JS that INJECTS them. The nav drawer, the
        // forced-password overlay and the login overlay build their markup in template literals,
        // so an id-only lookup misses every class they carry — and the class is where a `display`
        // usually lives. Leaving the JS out is what let the first teeth-check pass with the
        // `.pwf-escape[hidden]` companion deleted.
        for (const src of markupSources()) {
            const tag = src.match(new RegExp(`<[a-z][^>]*\\sid="${id}"[^>]*>`));
            const cls = tag && tag[0].match(/\sclass="([^"]+)"/);
            if (cls) for (const c of cls[1].trim().split(/\s+/)) sels.add(`.${c}`);
        }
        for (const sel of sels) {
            for (const { file, css } of sheets) {
                if (!setsDisplay(css, sel)) continue;
                if (hasHiddenCompanion(css, sel)) continue;
                broken.push(`#${id} (hidden by ${[...files].join(', ')}): "${sel}" gets a display rule in `
                    + `${file} with no ${sel}[hidden] companion — it will render in full while the code `
                    + 'believes it is hidden');
            }
        }
    }
    assert.deepEqual(broken, [], `\n  ${broken.join('\n  ')}\n`);
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


// ── A page that hides its whole shell must say something meanwhile (v20.80) ─────────────────────

/** Pages whose own stylesheets hide `.container` until a class arrives. */
function pagesHidingTheirShell() {
    return APP_PAGES.filter(page => stylesheetsFor(page).some(css => {
        const c = stripCss(read(css));
        // The pattern: `.container { … display: none … }` with a `body.<class> .container` rule
        // restoring it. Matching the pair rather than the bare `display:none` keeps this away from
        // an unrelated container that is hidden for good.
        return /\.container\s*\{[^}]*display\s*:\s*none/.test(c) &&
               /body\.[\w-]+\s+\.container\s*\{[^}]*display\s*:/.test(c);
    }));
}

test('the shell-hiding page list is not empty — guard the guard', () => {
    // If the CSS pattern is ever reworded, this fails loudly rather than passing over zero pages,
    // which is the failure mode every derived-list guard in this repo has had to learn.
    assert.ok(pagesHidingTheirShell().length >= 3,
        `expected at least the three known shell-hiding pages, found ${JSON.stringify(pagesHidingTheirShell())}`);
});

test('every page that hides its whole shell carries a boot placeholder', () => {
    for (const page of pagesHidingTheirShell()) {
        const html = stripHtml(read(page));
        assert.ok(/id="bootPlaceholder"/.test(html),
            `${page} hides .container until a class arrives, so it is a BLANK page until its JS ` +
            `runs — measured at 622ms locally with no network, and seconds on a phone. It needs ` +
            `the #bootPlaceholder block (see shared.css .boot-placeholder).`);
        // Outside `.container`, or it would be hidden by the very rule it exists to cover.
        const before = html.slice(0, html.indexOf('id="bootPlaceholder"'));
        assert.ok(!/<main[^>]*class="[^"]*container/.test(before),
            `${page}'s boot placeholder is inside .container, where the hide rule reaches it — it ` +
            `would never be seen, and nothing would say so.`);
    }
});

test('the placeholder is removed by CSS, not by a coordinator', () => {
    // The point of the whole thing is that it survives a page whose JS never arrives. If clearing it
    // ever became a JS call, the one case it was built for would be the one case it fails.
    const shared = stripCss(read('shared.css'));
    assert.ok(/body\.auth-ready\s+\.boot-placeholder\s*\{[^}]*display\s*:\s*none/.test(shared),
        'shared.css no longer hides .boot-placeholder on auth-ready');
    for (const f of ['admin-app.js', 'operations-app.js', 'links-app.js']) {
        assert.ok(!/bootPlaceholder/.test(read(f)),
            `${f} touches #bootPlaceholder — it must be pure CSS in both directions, or a ` +
            `coordinator that never finishes strands it`);
    }
});
