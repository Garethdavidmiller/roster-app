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
