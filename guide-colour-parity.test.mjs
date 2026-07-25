// guide-colour-parity.test.mjs — guards the guide palettes' contract with the app.
//
// The four guide pages deliberately do NOT import shared.css and run their own hardcoded hex
// palettes (offline-print-first, no app chrome). That independence is a documented decision —
// but two pieces of it are CONTRACTS, not free choices, and nothing enforced them until v17.58:
//
//  1. guide-shell.css declares --navy/--gold as MIRRORS of the app brand (its own comment says
//     so). If the brand tokens ever change, or a typo lands in the shell, the guides silently
//     stop matching the app. This test pins them to the brand hex documented in
//     .claude/rules/css-tokens.md → "Brand colours".
//  2. guide-doc.css carries a full second shift-type palette (--sb-*). Its VALUES intentionally
//     diverge from the app tokens (deep print-friendly shades — accepted drift, see the colours
//     review), but the SET must stay complete: a missing entry would silently unstyle a shift
//     badge in the printed guides.
//
// Part of `npm run test:hygiene`. Value changes here should be deliberate: if the brand hex
// genuinely changes, update css-tokens.md's table AND this test in the same commit.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const shell = readFileSync(new URL('./guide-shell.css', import.meta.url), 'utf8');
const doc   = readFileSync(new URL('./guide-doc.css', import.meta.url), 'utf8');

/** Extract a token's value from a stylesheet. @param {string} css @param {string} token */
function tokenValue(css, token) {
    const m = css.match(new RegExp(`${token}\\s*:\\s*([^;]+);`));
    return m ? m[1].trim().split('/*')[0].trim() : null;
}

test('guide-shell brand mirrors match the documented Chiltern brand hex', () => {
    // Source of truth: .claude/rules/css-tokens.md → "Brand colours" table.
    assert.equal(tokenValue(shell, '--navy'), '#001e3c',
        'guide-shell --navy must mirror the brand navy (#001e3c)');
    assert.equal(tokenValue(shell, '--gold'), '#f5c800',
        'guide-shell --gold must mirror the brand gold (#f5c800)');
});

test('guide-doc defines the complete --sb-* shift palette', () => {
    const REQUIRED = ['early', 'late', 'night', 'rest', 'spare', 'rdw', 'al', 'absent', 'other'];
    const missing = REQUIRED.filter(k => !tokenValue(doc, `--sb-${k}`));
    assert.deepEqual(missing, [],
        `guide-doc.css is missing --sb-* shift tokens: ${missing.join(', ')}`);
});

// ── links.css must FORWARD the app's shift colours, never restate them (v18.86) ────────────────
// links.css declared its own hex copies of the app's Early/Late colours, labelled "app early" /
// "app late" — and they had drifted measurably from the tokens they claimed to mirror (the early
// orange 10% darker and 13° off hue, the late blue 6% lighter and 11.5° off) because shared.css
// moved to oklch() while the hex literals stayed behind. Same failure this file already guards for
// the guides. The CONTRACT is forwarding, not a value: assert these resolve THROUGH the app tokens
// so a brand change reaches the Links workspace automatically.
const links = readFileSync(new URL('./links.css', import.meta.url), 'utf8');

test('links.css forwards the app shift tokens instead of hardcoding its own hex', () => {
    /** @type {Array<[string, string]>} token → the shared.css token it must reference */
    const MUST_FORWARD = [
        ['--shift-early-fill', '--orange'],
        ['--shift-late-fill',  '--blue-sky'],
        ['--shift-early-text', '--orange-text'],
        ['--shift-late-text',  '--blue-sky'],   // derived (color-mix) — still tracks the brand blue
    ];
    for (const [token, source] of MUST_FORWARD) {
        const value = tokenValue(links, token);
        assert.ok(value, `links.css must define ${token}`);
        assert.match(value, new RegExp(`var\\(\\s*${source}\\s*\\)`),
            `${token} must resolve through var(${source}) — a hex literal here silently drifts from the app`);
        assert.doesNotMatch(value, /#[0-9a-fA-F]{3,8}/,
            `${token} must not restate a hex value (it is the app's colour, not the Links page's)`);
    }
});
