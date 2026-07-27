/**
 * focus-ring-parity.test.mjs — the focus indicator is the app's only INVISIBLE design system.
 *
 * WHY THIS FILE EXISTS. Every other visual convention in the app has something watching it: the
 * card headers have card-header-parity, the palettes have guide-colour-parity, page composition has
 * the visual baselines. Focus rings have nothing, and they are the one treatment none of those
 * could ever catch — a focus ring is only drawn while a keyboard user is on the element, so it is
 * absent from every screenshot, and axe cannot evaluate indicator quality (it has no rule for it).
 * That combination is why the recipes drifted into ~80 hand-written literals across seven
 * stylesheets, and why two Tab-reachable inputs sat with `outline: none` and nothing in its place
 * without anyone noticing.
 *
 * Two contracts, both static (part of test:hygiene, no browser needed):
 *   1. The recipes come from the tokens, so retuning focus is a one-line change rather than a sweep.
 *   2. A rule that removes the outline must put something visible back — you can never Tab onto an
 *      element in this app and have no idea where you are.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');

/** The seven stylesheets that import shared.css's :root, so the tokens are in scope. */
const APP_CSS = ['shared.css', 'index.css', 'admin.css', 'paycalc.css',
    'operations.css', 'settings.css', 'links.css'];

/** shared.css defines the tokens; matching the literal there is the definition, not a use. */
const TOKEN_DEFS = /--focus-(ring|outline|outline-gold|outline-light): [^;]+;/g;

// ── 1. The recipes live in tokens ───────────────────────────────────────────────────────────────
test('no app stylesheet hardcodes a focus recipe that has a token', () => {
    /** Each literal and the token that replaces it. */
    const RECIPES = [
        ['box-shadow: 0 0 0 4px var(--focus-ring-color)', '--focus-ring'],
        ['outline: 2px solid var(--primary-blue)',        '--focus-outline'],
        ['outline: 2px solid var(--accent-gold)',         '--focus-outline-gold'],
        ['outline: 2px solid rgba(255, 255, 255, 0.85)',  '--focus-outline-light'],
    ];
    const offenders = [];
    for (const file of APP_CSS) {
        // Strip the :root definitions first — they are the one legitimate home for the literals.
        const src = read(file).replace(TOKEN_DEFS, '');
        src.split('\n').forEach((line, i) => {
            for (const [literal, token] of RECIPES) {
                if (line.includes(literal)) offenders.push(`${file}:${i + 1} → use var(${token})`);
            }
        });
    }
    assert.deepEqual(offenders, [],
        'hardcoded focus recipes — retuning focus should be one token edit, not a sweep of every stylesheet');
});

test('the focus tokens are defined exactly once, in shared.css', () => {
    for (const token of ['--focus-ring', '--focus-outline', '--focus-outline-gold', '--focus-outline-light']) {
        const defs = APP_CSS.flatMap(f =>
            [...read(f).matchAll(new RegExp(`(?<![-\\w])${token}:`, 'g'))].map(() => f));
        assert.deepEqual(defs, ['shared.css'], `${token} must be defined once, in shared.css`);
    }
});

// ── 2. Nothing focusable is left without an indicator ───────────────────────────────────────────
// `outline: none` inside a :focus / :focus-visible rule is how a focus indicator disappears. It is
// legitimate ONLY when something visible replaces it (a box-shadow ring) or when the element is not
// a Tab stop at all. Both exemptions are named below, so a NEW suppression has to be argued for
// rather than merely typed.
const NO_INDICATOR_EXEMPT = [
    // Programmatically focused panel wrapper — never a Tab target (see overlay.js).
    '.lb-content',
    // #hourlyRate is the only .pfx--readonly field and carries tabindex="-1".
    '.pfx--readonly input',
];

test('a focus rule that removes the outline must put something visible back', () => {
    const offenders = [];
    for (const file of APP_CSS) {
        const src = read(file);
        // Every rule whose selector mentions :focus, captured with its declaration block.
        for (const m of src.matchAll(/([^{}]*:focus(?:-visible)?[^{}]*)\{([^}]*)\}/g)) {
            const selector = m[1].replace(/\/\*[\s\S]*?\*\//g, '').trim().replace(/\s+/g, ' ');
            const body = m[2];
            if (!/outline:\s*(none|0)\b/.test(body)) continue;                          // outline intact
            if (/box-shadow:/.test(body) && !/box-shadow:\s*none/.test(body)) continue; // replaced by a ring
            if (NO_INDICATOR_EXEMPT.some(s => selector.includes(s))) continue;
            const line = src.slice(0, m.index).split('\n').length;
            offenders.push(`${file}:${line} ${selector}`);
        }
    }
    assert.deepEqual(offenders, [],
        'focus rules that leave no visible indicator — if the element is not a Tab stop, add it to NO_INDICATOR_EXEMPT with the reason');
});
