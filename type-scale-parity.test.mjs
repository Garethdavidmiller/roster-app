/**
 * type-scale-parity.test.mjs — the typography scale must actually BE the typography scale.
 *
 * WHY THIS FILE EXISTS. `.claude/rules/css-tokens.md` has documented a `--type-*` scale since v11.77,
 * with a per-element mapping (card title → --type-label, inputs → --type-medium, and so on). Nothing
 * enforced it, and by v19.01 the app CSS held **278 literal px font-sizes against 295 token uses** —
 * `index.css` alone was 98 literal to 26 token. That is not drift, it is an unfinished migration: the
 * scale was written down, applied to paycalc, and never carried across the other pages.
 *
 * v19.02 migrated the 214 literals whose value EXACTLY equalled a token (a value-preserving change —
 * the visual baselines pass untouched). This guard stops them coming back.
 *
 * WHAT IS AND ISN'T POLICED. Only literals that DUPLICATE a token value are a violation. Genuinely
 * off-scale sizes stay legal, because css-tokens.md is explicit that distinct components keep their
 * own sizes — the rule is "don't restate a value that already has a name", not "everything must be on
 * the scale". (The house precedent is v17.72's `--type-badge: 11px`, minted precisely because 11px was
 * the most-repeated off-scale size; there are now zero 11px literals. A repeated off-scale value is a
 * candidate for its OWN token, not for being forced onto an existing one.)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');

/** The seven stylesheets that import shared.css's :root, so the tokens are in scope. The four guide
 *  stylesheets are deliberately excluded — they do not load shared.css and have no --type-* tokens. */
const APP_CSS = ['shared.css', 'index.css', 'admin.css', 'paycalc.css',
    'operations.css', 'settings.css', 'links.css'];

/** Parse the scale from its single source rather than restating it here. */
function typeTokens() {
    const root = read('shared.css');
    const found = new Map();   // '13px' → '--type-label'
    for (const m of root.matchAll(/(--type-[a-z]+):\s*([0-9.]+px)\s*;/g)) found.set(m[2], m[1]);
    return found;
}

test('the --type-* scale is defined once, in shared.css', () => {
    const tokens = typeTokens();
    assert.ok(tokens.size >= 8, `expected the documented scale, found ${tokens.size} tokens`);
    for (const f of APP_CSS.filter(f => f !== 'shared.css')) {
        const defs = [...read(f).matchAll(/--type-[a-z]+:\s*[0-9.]+px/g)];
        assert.deepEqual(defs.map(d => `${f}: ${d[0]}`), [],
            'a page stylesheet redefining a type token would fork the scale');
    }
});

test('no app stylesheet hardcodes a font-size that already has a token', () => {
    const tokens = typeTokens();
    const offenders = [];
    for (const file of APP_CSS) {
        read(file).split('\n').forEach((line, i) => {
            for (const m of line.matchAll(/font-size:\s*([0-9.]+px)(?![0-9])/g)) {
                const tok = tokens.get(m[1]);
                if (tok) offenders.push(`${file}:${i + 1}  ${m[1]} → use var(${tok})`);
            }
        });
    }
    assert.deepEqual(offenders, [],
        'font-size literals that duplicate a token value — restating a size that already has a name is how the scale stopped meaning anything');
});

// ── NO TEXT-ENTRY FIELD MAY SIT UNDER 16px ON TOUCH, INCLUDING ONE THAT DOES NOT EXIST YET ──────
//
// The rule is old — css-tokens.md has said "never below 16px on a focusable field" since v11.77,
// because iOS force-zooms the page when you focus one — and there IS a guard: the `@a11y` sweep in
// e2e/pages.spec.js walks every `input, select, textarea` on every page at a phone width.
//
// It missed `.picker-search-input` completely, and the reason is structural rather than an
// oversight. That input is created LAZILY: `select-sheet.js` only builds it when a sheet carries
// `SEARCH_FROM` options or more, so on a page at rest it is not in the DOM at all, and the sweep
// skips a zero-box element even when it is. Anything a runtime scan reaches for has to have been
// built by the time it looks — which makes a DOM scan structurally unable to see a control that
// appears on a tap, and lazily-built controls are exactly where this app has been heading (the
// picker sheet, the guide search, the date picker).
//
// So it shipped at 14px for one release, with the comment DIRECTLY ABOVE it stating the 16px rule.
// That is the one kind of comment worse than no comment, and no lane could see it: the computed
// style is right on every page the sweep visits, the visual baselines never open a long sheet, and
// axe has no rule for a focus zoom.
//
// This reads the STYLESHEET instead, so laziness is irrelevant. It resolves `var(--type-*)` to the
// declared px and flags any text-entry rule under 16 — UNLESS a `@media (pointer: coarse)` block
// raises the same selector, which is the app's established pattern for controls that are dense on
// a mouse and comfortable on a thumb (`.gen-input`, `.hhmm-field input`). Checkbox/radio and the
// `::before`/`::after` pseudo-elements are out of scope: they carry no text and cannot be typed in,
// so no focus zoom follows.
test('no text-entry field is under 16px without a coarse-pointer override', () => {
    const px = new Map();                       // --type-* → number
    for (const file of APP_CSS) {
        for (const m of read(file).matchAll(/(--type-[a-z]+):\s*([0-9.]+)px/g)) px.set(m[1], parseFloat(m[2]));
    }
    assert.ok(px.size > 3, 'no type tokens resolved — this test is checking nothing');

    const offenders = [];
    for (const file of APP_CSS) {
        const css = read(file).replace(/\/\*[\s\S]*?\*\//g, '');
        // Selectors raised inside a coarse-pointer block — the legitimate escape.
        // BRACE-MATCHED, not regex-delimited: a coarse block contains nested rules, so a lazy
        // `}` match ends it at the FIRST inner close and every selector after that is invisible —
        // which is how the first cut of this test reported `.gen-input` as an offender when
        // links.css raises it correctly eleven lines in.
        const coarse = new Set();
        for (const open of [...css.matchAll(/@media[^{]*pointer:\s*coarse[^{]*\{/g)]) {
            let depth = 1, i = open.index + open[0].length;
            const from = i;
            while (i < css.length && depth > 0) {
                if (css[i] === '{') depth++;
                else if (css[i] === '}') depth--;
                i++;
            }
            for (const r of css.slice(from, i - 1).matchAll(/([^{}]+)\{([^}]*)\}/g)) {
                if (/font-size/.test(r[2])) for (const sel of r[1].split(',')) coarse.add(sel.trim());
            }
        }
        for (const rule of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
            const sel = rule[1].trim().replace(/\s+/g, ' ');
            // Text-entry only: an element/class naming an input or textarea, never a pseudo-element,
            // and never the checkbox/radio family, which cannot receive typed text.
            if (!/\b(input|textarea)\b|-input\b/i.test(sel)) continue;
            if (/::(before|after|placeholder|-webkit-)/.test(sel)) continue;
            if (/checkbox|radio/i.test(sel)) continue;
            const fs = rule[2].match(/font-size:\s*([^;]+);/);
            if (!fs) continue;
            const raw = fs[1].trim();
            const tok = raw.match(/var\((--type-[a-z]+)/);
            const size = tok ? px.get(tok[1]) : (/^([0-9.]+)px/.test(raw) ? parseFloat(raw) : null);
            if (size == null || size >= 16) continue;
            if (sel.split(',').some(s => coarse.has(s.trim()))) continue;   // raised on touch
            offenders.push(`${file}  ${sel.slice(0, 64)}  →  ${raw} = ${size}px`);
        }
    }
    assert.deepEqual(offenders, [],
        'these fields will force-zoom the page when focused on iOS. Either use var(--type-medium)\n' +
        '(16px), or raise the same selector in a @media (pointer: coarse) block — and if you take the\n' +
        'second route, put it BELOW the rule it must beat; this repo has broken that three times:\n  ' +
        offenders.join('\n  '));
});
