/**
 * THE ENTRY ANIMATION MUST NOT BE FROZEN BY SPECIFICITY (v22.64).
 *
 * `shared.css` owns one entry animation for every lightbox: `.lb-content` rests at `scale(0.88)`
 * and `.lb-overlay.open .lb-content` takes it to `scale(1)`. That winning rule is three classes —
 * specificity (0,3,0) — so ANY id-level rule on the same panel that sets `transform` beats it and
 * the panel never scales up.
 *
 * That had happened FIVE times: #dayDetailContent, #alLightboxContent, #iconLightboxContent,
 * #navComingSoonContent and #noticeYtdContent each carried `transform: scale(0.85)`, so all five
 * rendered permanently at 85% — 272px of a 320px panel, every glyph 15% under the type scale — and
 * the spring entrance never played on any of them. The About panel is on all seven pages.
 *
 * NOTHING COULD SEE IT. No behavioural test looks at a computed transform; every element is present
 * and readable, so axe passes and the e2e assertions pass; and the visual baselines were generated
 * WITH the fossil, so they encoded it as correct. It was found by measuring the computed transform
 * of an overlay that was already `.open`, which is the only way it is visible at all.
 *
 * This guard is static because the defect is static: a declaration at the wrong specificity. It is
 * cheaper and more deterministic than a pixel baseline, and it fails on the line that causes it.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const SHEETS = readdirSync('.').filter(f => f.endsWith('.css') && !f.startsWith('guide-') && f !== 'guide.css');
/** Strip comments so a commented-out rule is not read as a live one. */
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

describe('lightbox panels keep the shared entry animation', () => {
    test('no id-level rule sets a transform on a lightbox panel', () => {
        const offenders = [];
        for (const f of SHEETS) {
            const css = strip(readFileSync(f, 'utf8'));
            // An id block whose selector names a lightbox panel, containing a transform.
            const re = /(^|\})\s*(#[A-Za-z][\w-]*)\s*\{([^}]*)\}/g;
            let m;
            while ((m = re.exec(css))) {
                const [, , sel, body] = m;
                if (!/transform\s*:/.test(body)) continue;
                // Only panels: the element createLightbox is handed as `content`.
                if (!/Content$|Card$|LightboxContent$/.test(sel.slice(1))) continue;
                offenders.push(`${f} ${sel}`);
            }
        }
        assert.deepEqual(offenders, [],
            'These id-level rules set `transform` on a lightbox panel, which out-specifies '
            + '`.lb-overlay.open .lb-content { transform: scale(1) }` (0,3,0) and freezes the panel '
            + 'at its resting scale — it never grows to full size and the entrance never plays. '
            + 'Set the SIZE with `width`, and leave `transform` to shared.css.');
    });

    test('the shared rule the guard depends on is still there', () => {
        // If shared.css stops driving the animation this way, the rule above is guarding nothing —
        // and would keep passing, which is the failure mode a parity test has to rule out.
        const shared = strip(readFileSync('shared.css', 'utf8'));
        assert.match(shared, /\.lb-content\s*\{[^}]*transform:\s*scale\(0?\.\d+\)/,
            '.lb-content no longer sets a resting scale — the entry animation has moved and this '
            + 'guard now protects nothing');
        assert.match(shared, /\.lb-overlay\.open\s+\.lb-content\s*\{[^}]*transform:\s*scale\(1\)/,
            'the .open rule that takes a panel to full size is gone');
    });
});
