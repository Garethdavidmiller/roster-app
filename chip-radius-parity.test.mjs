/**
 * chip-radius-parity.test.mjs — a chip must not wear the lightbox/panel corner.
 *
 * WHY THIS FILE EXISTS. `shared.css` defines `--radius-xl: 20px` for "large lightbox/panel cards"
 * and `--radius-pill: 999px` for "fully-rounded pills/chips". By v19.05, TWELVE chip rules were
 * using the panel token — and nothing noticed, because on a short element the two are
 * indistinguishable: when corner radii exceed the box height CSS scales them proportionally, so on a
 * 20px-tall chip both resolve to the same 10px fully-rounded corner. They only diverge above ~40px
 * tall, which no chip is.
 *
 * That invisibility is the whole problem. It is the same defect v18.90 fixed in the other direction
 * (four overlays wearing `--radius-lg`, the CARD radius), where the note was that "a token hides
 * that in a way a literal wouldn't" — `--radius-lg` reads like it belongs to a large panel. Here it
 * ran the opposite way and stayed hidden a release longer.
 *
 * The contract: a rule whose selector names a badge/chip/pill/tag may not set
 * `border-radius: var(--radius-xl)`. Off-scale literals are NOT policed — `.conf-badge` (3px) and
 * `.legacy-pill`/`.source-pill` (8px) are deliberately squarer, which reads as "data tag, not pill",
 * and flattening them would change meaning rather than tidy it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
const APP_CSS = ['shared.css', 'index.css', 'admin.css', 'paycalc.css',
    'operations.css', 'settings.css', 'links.css'];

/** Rule blocks whose SELECTOR names a chip-family element. Comments are stripped first so a
 *  mention of "badge" in prose can't drag an unrelated rule into the check. */
const CHIP_RULE = /([^{}]*(?:badge|chip|pill|tag)[^{}]*)\{([^}]*)\}/gi;

test('no chip wears the lightbox/panel radius (--radius-xl)', () => {
    const offenders = [];
    for (const file of APP_CSS) {
        const css = read(file).replace(/\/\*[\s\S]*?\*\//g, '');
        for (const m of css.matchAll(CHIP_RULE)) {
            if (/border-radius\s*:\s*var\(--radius-xl\)/.test(m[2])) {
                offenders.push(`${file}: ${m[1].trim().replace(/\s+/g, ' ').slice(0, 60)}`);
            }
        }
    }
    assert.deepEqual(offenders, [],
        'chips using --radius-xl (the lightbox/panel corner) — use --radius-pill. They look identical below ~40px tall, which is exactly why this drifts unnoticed');
});

test('the overlay family still uses --radius-xl (the swap did not overreach)', () => {
    // Guards the opposite mistake: a blanket find-and-replace that dragged the real panel/dialog
    // corners onto the pill token would pass the test above while restyling every overlay.
    const uses = APP_CSS.reduce((n, f) =>
        n + [...read(f).matchAll(/var\(--radius-xl\)/g)].length, 0);
    assert.ok(uses >= 8,
        `only ${uses} uses of --radius-xl remain — the dialog/panel family should still be using it`);
});
