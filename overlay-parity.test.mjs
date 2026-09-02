/**
 * overlay-parity.test.mjs — the lightbox lifecycle rules, enforced (v22.38).
 *
 * `CLAUDE.md` has carried three rules about overlays for years, and NOTHING checked any of them:
 * every `.lb-overlay` is built with `createLightbox`; a close control is a `<button>`, never a
 * `<span>`; and only the TOPMOST overlay answers the keyboard (v19.53). This repo has parity tests
 * for focus rings, shadows, chip radii, the type scale, CSP metas and card headers — and none for
 * the surface every one of those rules was written about.
 *
 * The gap was not theoretical. The audit that prompted this file found the Huddle viewer, the app's
 * one documented hand-rolled lifecycle, missing BOTH of the behaviours `createLightbox` grew after
 * it was written: the topmost-overlay guard (v19.53) and the already-closing guard (v21.86). It is
 * an exception to the "use createLightbox" rule, and it had quietly become an exception to the two
 * rules that are about behaviour rather than construction. That is what an exception costs when
 * nothing watches it.
 *
 * WHAT THIS CANNOT SEE. It reads source, so it cannot tell you an overlay BEHAVES correctly — only
 * that it is wired to the thing that behaves correctly, or that it declares itself an exception and
 * carries the guards by hand. The behaviour itself is `overlay.test.mjs` and `overlay-history.test.mjs`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const here = new URL('.', import.meta.url);
const read = (/** @type {string} */ f) => readFileSync(new URL(f, here), 'utf8');
const files = readdirSync(here);
/**
 * Comments are not code. Stripped before any structural scan, the way this repo's other parity
 * guards do it — the first cut of the double-close contract read a 400-character window after the
 * function head, and the six-line comment explaining the guard pushed the guard itself out of view.
 * A guard that fails on well-commented code is a guard that gets deleted.
 */
const stripComments = (/** @type {string} */ src) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const HTML = files.filter(f => f.endsWith('.html'));
const JS = files.filter(f => f.endsWith('.js') && !f.endsWith('.test.js'));

/**
 * Overlays that do NOT go through `createLightbox`, each with the reason CLAUDE.md gives.
 * An entry here is a decision, not a workaround — adding one should feel like a decision.
 */
const HAND_ROLLED = {
    huddleViewer: 'full-bleed panel: no backdrop-click close, and the viewer owns its own '
        + 'auto-open sequencing from the #huddle hash',
};

/**
 * Modules that hand-roll a lifecycle, and so must carry the guards `createLightbox` provides.
 *
 * Matched on the IMPORT, not on the word appearing anywhere: `about-lightbox.js` mentions
 * `dismissOverlay` in a comment explaining the fade fallback, and a bare word match called that a
 * hand-rolled lifecycle and demanded guards of a module that correctly uses `createLightbox`.
 */
const handRolledModules = () => JS.filter(f => f !== 'overlay.js'
    && /import\s*\{[^}]*\bdismissOverlay\b[^}]*\}\s*from\s*'\.\/overlay\.js'/.test(read(f)));

test('every .lb-overlay in a served page is built with createLightbox', () => {
    /** @type {string[]} */ const problems = [];
    for (const page of HTML) {
        const html = read(page);
        // The id and the class can appear in either order on the tag.
        for (const m of html.matchAll(/<div\b[^>]*\blb-overlay\b[^>]*>/g)) {
            const id = (m[0].match(/id="([^"]+)"/) || [])[1];
            if (!id) { problems.push(`${page}: an .lb-overlay with no id — nothing can wire it`); continue; }
            if (id in HAND_ROLLED) continue;
            const owners = JS.filter(f => read(f).includes(`'${id}'`) || read(f).includes(`"${id}"`));
            if (!owners.length) { problems.push(`${page}: #${id} is not referenced by any module`); continue; }
            if (!owners.some(f => /\bcreateLightbox\b/.test(read(f)))) {
                problems.push(`${page}: #${id} is owned by ${owners.join(', ')}, none of which imports `
                    + 'createLightbox — a hand-written lifecycle drifts from the shared one');
            }
        }
    }
    assert.deepEqual(problems, [], 'lightboxes not on the shared lifecycle:\n  ' + problems.join('\n  '));
});

test('every close control is a <button type="button">, never a <span>', () => {
    /** @type {string[]} */ const problems = [];
    for (const f of [...HTML, ...JS]) {
        const src = read(f);
        for (const m of src.matchAll(/<(\w+)\b([^>]*\bclass="[^"]*\blb-close\b[^"]*"[^>]*)>/g)) {
            const [, tag, attrs] = m;
            // A <span> is not keyboard-focusable, so the overlay becomes mouse-only.
            if (tag !== 'button') problems.push(`${f}: <${tag}> used as a close control — not focusable`);
            // Without an explicit type a button inside a form submits it.
            else if (!/\btype="button"/.test(attrs)) problems.push(`${f}: .lb-close with no type="button"`);
        }
    }
    assert.deepEqual(problems, [], 'close-control defects:\n  ' + problems.join('\n  '));
});

test('a hand-rolled lifecycle still obeys the topmost-overlay rule', () => {
    // CALLED, not merely imported. The first cut tested for the NAME, and deleting the guard line
    // while leaving the import — which is exactly what a careless edit does — passed it. A guard
    // satisfied by an unused import is a guard satisfied by nothing.
    const missing = handRolledModules().filter(f => !/_isTopOverlay\s*\(/.test(stripComments(read(f))));
    assert.deepEqual(missing, [],
        'these modules dismiss an overlay themselves but never ask whether they are on top, so one '
        + 'Escape closes them AND whatever is stacked over them, and Tab is dragged into a panel the '
        + 'reader cannot see (the v19.53 rule):\n  ' + missing.join('\n  '));
});

test('a hand-rolled lifecycle refuses a second close', () => {
    // `createLightbox` returns early when a close is already in flight (v21.86). A hand-rolled one
    // without that runs two finishers for one lock, and the scroll-lock depth goes negative-by-one
    // — the page behind an overlay that is still open starts scrolling.
    /** @type {string[]} */ const problems = [];
    for (const f of handRolledModules()) {
        const src = stripComments(read(f));
        // The guard must sit at the TOP of the close function, before the state it reads is cleared.
        const close = src.match(/function close\w*\(\)\s*\{([\s\S]{0,400}?)\bdismissOverlay\b/);
        if (!close) { problems.push(`${f}: no close function found calling dismissOverlay`); continue; }
        if (!/\bif\s*\(\s*!?\w+\s*\)\s*return\b/.test(close[1])) {
            problems.push(`${f}: its close has no already-closing guard before dismissOverlay`);
        }
    }
    assert.deepEqual(problems, [], 'double-close defects:\n  ' + problems.join('\n  '));
});

test('the exceptions are real, and the scan found the overlays — guard the guard', () => {
    // An exception naming an element that no longer exists is an exemption nobody can see is dead.
    const allHtml = HTML.map(read).join('\n');
    for (const [id, why] of Object.entries(HAND_ROLLED)) {
        assert.ok(allHtml.includes(`id="${id}"`), `HAND_ROLLED names #${id}, which no page contains`);
        assert.ok(why.length > 20, `#${id}'s exception needs a reason, not a label`);
    }
    // If the element scan silently stopped matching, every contract above would pass on nothing.
    const found = HTML.flatMap(p => [...read(p).matchAll(/<div\b[^>]*\blb-overlay\b[^>]*>/g)]);
    assert.ok(found.length >= 15, `only ${found.length} .lb-overlay elements found — the scan is wrong`);
    assert.ok(handRolledModules().length >= 1, 'no hand-rolled lifecycle found — the scan is wrong');
});
