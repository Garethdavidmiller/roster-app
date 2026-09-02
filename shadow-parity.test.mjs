/**
 * shadow-parity.test.mjs — the box-shadow rule has a NUMBER in it, and the number was wrong.
 *
 * `.claude/rules/css-tokens.md` says existing shadows are deliberately NOT routed through
 * `--shadow-1/2/3`, because forcing varied hand-rolled recipes onto three presets would restyle
 * depth across the app — a redesign, not hygiene. Right rule. But from v17.58 to v22.32 it opened
 * with "~120 hand-rolled `rgba()` shadows", and that figure was never true of what the sentence
 * describes: ~120 was every `box-shadow` DECLARATION in the tree — including the 27 already on the
 * tokens, the 21 focus rings on their own tokens, and every `none` — while the hand-rolled recipes
 * the rule is about numbered 28 in the app stylesheets. A reader was told the migration was four
 * times the size it is, which is the kind of figure that stops anyone starting it.
 *
 * Same defect class as `doc-parity.test.mjs` guards: prose restating a fact that lives in the
 * files. So the figure is now MEASURED here, and the doc must state what the measurement says.
 *
 * Two contracts, in opposite directions:
 *   1. The doc's figure equals the count — the sentence cannot fall behind the stylesheets again.
 *   2. The count does not GROW — "use the `--shadow-*` tokens for NEW shadows" has been the rule
 *      since v17.58 and nothing enforced it. A ratchet, like `coordinator-ratchet.test.mjs`:
 *      removing one is free, adding one fails here, and the doc's figure comes down with the count.
 *
 * WHAT COUNTS. A `box-shadow` whose value carries a literal `rgba(`/`rgb(` colour and no token. Not
 * counted: `none`, the `--shadow-*` presets, the `--focus-*` rings (focus-ring-parity owns those),
 * and recipes built entirely from colour tokens (`var(--gold-glow)`, an `oklch(...)` today glow, an
 * inset rule in `var(--primary-blue)`) — those already move with the palette, which is what a token
 * is for. Comments are stripped first, so a recipe quoted in a comment is not a recipe.
 *
 * SCOPE. The eight stylesheets that load shared.css, where the tokens are in scope. The guide
 * stylesheets carry 15 more hand-rolled shadows and have no `--shadow-*` to route to; that is a
 * separate decision (they do not import shared.css at all), and counting them here would make the
 * app figure answer a question about the guides.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');

/** The stylesheets that import shared.css's :root, so `--shadow-*` is in scope. */
const APP_CSS = ['shared.css', 'index.css', 'admin.css', 'paycalc.css',
    'operations.css', 'settings.css', 'links.css', 'overtime.css'];

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** @param {string} value the declaration's value, trimmed */
function isHandRolled(value) {
    if (value === 'none' || value.startsWith('none ')) return false;
    if (value.includes('var(--shadow') || value.includes('var(--focus')) return false;
    return /\brgba?\(/.test(value);
}

/** Every hand-rolled shadow in the app stylesheets, as `file: value`. */
function handRolledShadows() {
    const out = [];
    for (const f of APP_CSS) {
        const css = stripComments(read(f));
        for (const m of css.matchAll(/box-shadow\s*:\s*([^;}]+)/g)) {
            const value = m[1].trim();
            if (isHandRolled(value)) out.push(`${f}: ${value}`);
        }
    }
    return out;
}

/** The figure the doc states, from the one sentence that states it. */
function documentedCount() {
    const doc = read('.claude/rules/css-tokens.md');
    const m = doc.match(/\*\*(\d+)\*\* hand-rolled `rgba\(\)` shadows/);
    assert.ok(m, 'css-tokens.md no longer states the hand-rolled shadow count in the form this ' +
        'test reads — `**N** hand-rolled `rgba()` shadows`. Keep the sentence, or move this reader.');
    return Number(m[1]);
}

test('the --shadow-* presets are defined once, in shared.css', () => {
    const root = stripComments(read('shared.css'));
    for (const t of ['--shadow-1', '--shadow-2', '--shadow-3']) {
        assert.match(root, new RegExp(`${t}:\\s*[^;]+;`), `${t} missing from shared.css`);
    }
    for (const f of APP_CSS.filter(f => f !== 'shared.css')) {
        assert.doesNotMatch(stripComments(read(f)), /--shadow-[123]:/,
            `${f} redefines a shadow preset — that forks the depth system`);
    }
});

test('css-tokens.md states the hand-rolled shadow count the stylesheets actually carry', () => {
    const measured = handRolledShadows().length;
    assert.equal(documentedCount(), measured,
        `css-tokens.md says ${documentedCount()} hand-rolled shadows; the eight app stylesheets carry ` +
        `${measured}. Change the figure in the doc — it is a measurement, and this is the measurement.`);
});

test('no NEW hand-rolled shadow — new depth uses the --shadow-* tokens', () => {
    // The ratchet. The figure in the doc IS the cap: it is checked against the count above, so it
    // can only ever be moved down, and moving it up requires editing a sentence that says why the
    // rule exists — which is the moment to notice you are about to break it.
    const shadows = handRolledShadows();
    assert.ok(shadows.length <= 28,
        `a hand-rolled box-shadow has been added (${shadows.length} against a ceiling of 28). New ` +
        'shadows use var(--shadow-1|2|3) — see css-tokens.md. If a fourth preset is genuinely ' +
        'needed, add it to shared.css rather than a one-off recipe:\n  ' + shadows.join('\n  '));
});

test('the ceiling is not quietly generous', () => {
    // GUARD THE GUARD: if shadows are migrated to the tokens, bring the ceiling down with them, or
    // the ratchet above becomes headroom for new one-offs.
    const n = handRolledShadows().length;
    assert.ok(28 - n <= 5, `the ceiling (28) is ${28 - n} above the count (${n}) — lower it`);
});
