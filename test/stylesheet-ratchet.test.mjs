// @lane hygiene
/**
 * stylesheet-ratchet.test.mjs — an already-large stylesheet may not get larger (v25.23).
 * Run: node scripts/run-tests.mjs test/stylesheet-ratchet.test.mjs   (part of `npm run test:hygiene`)
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

// Tests live in test/ but address files from the repository root (moved 24 Nov 2026).
const REPO_ROOT_URL = new URL('../', import.meta.url);

const here = new URL('.', REPO_ROOT_URL);
/** Newline count — what `wc -l` reports, and what the caps below were measured with. */
const lines = (/** @type {string} */ f) => (readFileSync(new URL(f, here), 'utf8').match(/\n/g) || []).length;

/** Below this a stylesheet is free to grow. The same figure as the module ratchet's. */
const LARGE_THRESHOLD = 900;

/**
 * Measured on 3 Nov 2026 with v25.22 in, + 50, rounded up to the next 50. ⚠️ THESE MAY ONLY GO DOWN.
 */
const CAPS = {
    // 3950 → 3600 (8 Nov 2026, at 3,502): changelog comments cut to their reasons, dead and duplicated
    // rules out.
    // Held at 3600 on 16 Nov 2026, at 3,599 of 3,600: six comments that had become a changelog were cut to
    // their reasons (3,591). The nine lines are kept as room for the next fix rather than taken as a cut,
    // because a sheet at its cap fails on a one-line comment — next time something LEAVES, bring this down.
    // 3600 → 3550 (16 Nov 2026, at 3,493): comments that had become a changelog cut to their reasons; no rule
    // changed (the sheet with its comments stripped is identical).
    // 3550 → 3609 (25 Nov 2026, at 3,453), MOVED, not grown: the About panel's Tips section (`.lightbox-tips`,
    // `.lightbox-tip` and its keyboard-only and touch-only rows, `.lightbox-tip-key`) came here from shared.css,
    // index.html being its only user; raised by the 59 lines it gained, and shared.css's cap came down.
    'index.css':      3609,   // the Calendar: grid, day panel, Team Week View, lock cards, notices
    // 3950 → 3850 (Nov 2026, at 3,781): comments that had become a changelog went back to the reason they
    // left, stale claims were corrected, and the drawer pills' nine colour pairs and the sheet's four ✕
    // colours became one block each.
    // 3850 → 3849 (13 Nov 2026, at 3,849): the dialog's option row (`confirmWithOption`) came in at its cap, and two
    // of the dialog's own comments that had become a changelog made the room — the ceiling follows the sheet down.
    // 3849 → 3800 (16 Nov 2026, at 3,709): thirty-one comments that had become a changelog cut to their reasons;
    // no rule changed (the sheet with its comments stripped is identical).
    // 3800 → 3830 (22 Nov 2026, at 3,826), a deliberate RAISE: the card header's larger-text rule (an em
    // container query, the shared header's own — every card page draws it), the app header's gap, the hint's
    // `text-wrap` and the gold-wash token pair three pages had each copied. The sheet was at 3,799 of 3,800.
    // 3830 → 3855 (24 Nov 2026, at 3,851), MOVED, not grown: the refusal card's parts came here from paycalc.css
    // when Admin gained one too (`.role-card`), and paycalc.css's cap came down by the same 25 lines.
    // 3855 → 3764 (25 Nov 2026, at 3,764), MOVED out: blocks one page uses went to that page's sheet — the
    // About panel's Tips section to index.css, `.help-btn` and `.lightbox-privacy` to paycalc.css (91 lines);
    // those two caps went up by what each gained. At the measured size: the room the sheet had is spent.
    // 3764 → 3772 (26 Nov 2026, at 3,772), a deliberate RAISE of eight lines: the Tips panel's "What these words mean"
    // link (glossary.js), which every page's ? panel can draw, so it can live nowhere else; and the glossary row's
    // button reset in the drawer, one selector added to the circular, newsletter and App Notices rule.
    'shared.css':     3772,   // every page's tokens, controls, overlays, pickers and the drawn checkbox
    // 2700 → 2650 (Nov 2026, at 2,574): the week grid's five-column template and the two blocks that
    // restated the stacked one over it became one rule; dead and inert rules out (css-admin-ops-15).
    // 2650 → 2600 (16 Nov 2026 (tidy-up), at 2,506): comments that had become a changelog cut to their reasons.
    'admin.css':      2600,
    // 2650 → 2150 (22 Nov 2026, at 2,074): comments that had become a changelog cut to their reasons; no rule
    // changed (the sheet with its comments stripped is identical).
    'links.css':      2150,
    // 2150 → 2300 (14 Nov 2026, at 2,244), a deliberate RAISE: the Annual leave sheet card is a new
    // surface and this page's alone — a summary, a fold per person, chips and day rows, in 112 compact
    // lines; the Save's questions, boxes and receipt brought it to 2,288 (v26.13). A dead-rule sweep
    // found nothing to delete first: every class the sheet styles is emitted, the speed-* and al-sheet-*
    // modifiers by template.
    // 2300 → 2250 (16 Nov 2026 (tidy-up), at 2,159): comments that had become a changelog cut to their reasons.
    'operations.css': 2250,
    // 2100 → 1950 on 8 Nov 2026, brought DOWN (2,099 measured lines to 1,891): changelog comments cut
    // to their reasons, and rules that shared.css's `.hidden` or an identical twin already set.
    // 1950 → 1925 (24 Nov 2026, at 1,890): the refusal card's parts moved to shared.css (`.role-card`), Admin's too.
    // 1925 → 1969 (25 Nov 2026, at 1,941), MOVED, not grown: `.help-btn` and `.lightbox-privacy` came here from
    // shared.css, this page being the only user of both; raised by the 44 lines it gained.
    'paycalc.css':    1969,
    'overtime.css':   1900,   // paused since v25.05, kept (owner, 3 Nov 2026); see KNOWN_LIMITATIONS
    // NEW on 18 Nov 2026, at 913, a deliberate RAISE: a phone's larger text — container queries in em that keep
    // the Day control, the weekday totals and a station's card on the screen (css-tokens.md → "Larger text"). The
    // surface is this sheet's alone. A dead-rule sweep found nothing to delete first: every class the sheet styles
    // is emitted, the -- modifiers by template. The block's general argument went to the rules doc, not twice.
    'trains.css':     1000,
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
