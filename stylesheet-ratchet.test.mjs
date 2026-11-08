/**
 * stylesheet-ratchet.test.mjs — an already-large stylesheet may not get larger (v25.23).
 * Run: node --test stylesheet-ratchet.test.mjs   (part of `npm run test:hygiene`)
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────────
 *
 * `coordinator-ratchet.test.mjs` has held the large JS modules since August 2026, and nothing held
 * the stylesheets. The full check of 3 November 2026 measured index.css at 3,861 lines and shared.css
 * at 3,852, both still growing with every release, with no line anywhere that said "this is large
 * now, and growing it is a decision". This is that line.
 *
 * ── THE SAME MECHANISM, AND ITS RULES ───────────────────────────────────────────────────────────
 *
 * A RATCHET, not a limit — read the module ratchet's header, which argues each of these:
 *   · a cap is SET at the measured size + 50, rounded up to the next 50, so a sheet has 50–99 lines
 *     of room on the day it is set: enough for a fix, nowhere near enough for a new surface;
 *   · caps only go DOWN: when rules leave a sheet, lower its cap in the same commit, or the saving
 *     is banked as headroom and the ratchet loosens while appearing to hold;
 *   · a sheet crossing LARGE_THRESHOLD without a line here fails — becoming large is a decision.
 *
 * ── WHAT A GOOD RESPONSE LOOKS LIKE WHEN THIS FAILS ────────────────────────────────────────────
 *
 * CSS has no "extract the rule into a testable module", so the three responses are different here:
 *
 *   DELETE   — the commonest cause, and the default to look for first. A rule for a class nothing
 *              emits any more, a superseded block left beside its replacement, a comment that has
 *              become a changelog. v25.20 removed four such blocks in one pass.
 *   MOVE     — a rule in the wrong sheet: a page's rule that every page needs belongs in shared.css
 *              (and shared.css's cap goes up by what this one's comes down), or one page's rules
 *              sitting in shared.css belong in that page's sheet.
 *   RAISE    — neither: the surface is genuinely new and genuinely this sheet's. Legitimate, and
 *              DELIBERATE — say why beside the number, as the module ratchet's table does.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const here = new URL('.', import.meta.url);
/** Newline count — what `wc -l` reports, and what the caps below were measured with. */
const lines = (/** @type {string} */ f) => (readFileSync(new URL(f, here), 'utf8').match(/\n/g) || []).length;

/** Below this a stylesheet is free to grow. The same figure as the module ratchet's. */
const LARGE_THRESHOLD = 900;

/**
 * Measured on 3 Nov 2026 with v25.22 in, + 50, rounded up to the next 50. ⚠️ THESE MAY ONLY GO DOWN.
 */
const CAPS = {
    'index.css':      3950,   // the Calendar: grid, day panel, Team Week View, lock cards, notices
    // 3950 → 3850 (Nov 2026, at 3,781): comments that had become a changelog went back to the reason they
    // left, stale claims were corrected, and the drawer pills' nine colour pairs and the sheet's four ✕
    // colours became one block each.
    'shared.css':     3850,   // every page's tokens, controls, overlays, pickers and the drawn checkbox
    'admin.css':      2700,
    'links.css':      2650,
    'operations.css': 2150,
    'paycalc.css':    2100,
    'overtime.css':   1900,   // paused since v25.05, kept (owner, 3 Nov 2026); see KNOWN_LIMITATIONS
};

describe('an already-large stylesheet may not get larger', () => {
    for (const [file, cap] of Object.entries(CAPS)) {
        test(`${file} stays within ${cap} lines`, () => {
            const n = lines(file);
            assert.ok(n <= cap,
                `${file} is ${n} lines, over its ${cap}-line cap.\n\n`
                + 'Look first for rules nothing emits any more, then for rules in the wrong sheet. If the\n'
                + 'growth is a genuinely new surface that belongs here, raise the cap deliberately and\n'
                + 'say why beside it. (This file\'s header has the three responses.)');
        });
    }

    test('every large stylesheet is IN the table — a new one is a decision, not an accident', () => {
        const untracked = readdirSync(here)
            .filter(f => f.endsWith('.css') && !(f in CAPS) && lines(f) > LARGE_THRESHOLD);
        assert.deepEqual(untracked, [],
            `these stylesheets have crossed ${LARGE_THRESHOLD} lines and are not capped:\n  `
            + untracked.map(f => `${f} (${lines(f)})`).join('\n  '));
    });

    test('and the caps are not quietly generous', () => {
        // GUARD THE GUARD — a cap far above its sheet enforces nothing. 200 lines is well past the
        // next-50 rounding, so it can only mean rules left and the cap did not come down with them.
        const slack = Object.entries(CAPS)
            .map(([f, cap]) => [f, cap - lines(f)])
            .filter(([, gap]) => Number(gap) > 200)
            .map(([f, gap]) => `${f} has ${gap} lines of slack — lower its cap`);
        assert.deepEqual(slack, [], 'a cap has drifted above its sheet:\n  ' + slack.join('\n  '));
    });

    test('every capped sheet exists', () => {
        for (const f of Object.keys(CAPS)) assert.ok(lines(f) > 0, `${f} is capped but missing or empty`);
    });
});
