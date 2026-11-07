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

// Every app stylesheet. NOTE the filter reads `guide-*`, and the guide sheets are actually
// named `*-guide.css`, so those five ARE scanned — over-coverage, not a hole (no guide page
// has a lightbox), and left as it is deliberately rather than narrowed. `css-hex-parity`
// needed the other spelling, because for THAT rule scanning them is a false positive.
const SHEETS = readdirSync('.').filter(f => f.endsWith('.css') && !f.startsWith('guide-') && f !== 'guide.css');
/** Strip comments so a commented-out rule is not read as a live one. */
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * Every rule in one stylesheet that sets a transform on a lightbox panel at id level — with the
 * counts the guard-the-guard test below reads.
 *
 * ANY rule that sets a transform and whose selector names a panel — not only a bare
 * `#panelContent { … }`. Until 19 Sep 2026 this matched the bare form alone, which is the shape the
 * five fossils happened to take, and a mutation audit walked straight past it:
 * `#iconLightbox .lb-content { transform: scale(0.85) }` is (1,1,0), still beats the shared (0,3,0)
 * rule, freezes the panel in exactly the same way, and was invisible here. Guard the RULE, not the
 * spelling the defect arrived in.
 *
 * EVERY SELECTOR OF THE LIST (test audit, 7 Nov 2026). This read only the LAST LINE of a rule's
 * selector, so `#dayDetailContent,\n.dd-unused { transform: scale(0.85) }` — the first fossil, put
 * back on two lines — passed: the scan saw `.dd-unused` and nothing else. What comes before the
 * selector inside the capture is at most a statement ended by `;` (an `@import`), so the selector is
 * whatever follows the last one.
 * @param {string} css  comment-stripped
 */
function panelTransforms(css) {
    const offenders = [];
    let rules = 0, transforms = 0;
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selector = (m[1].split(';').pop() ?? '').trim().replace(/\s+/g, ' ');
        const body = m[2];
        if (selector.startsWith('@') || !selector) continue;       // a media block's head
        rules++;
        if (!/transform\s*:/.test(body)) continue;
        transforms++;
        // Only panels: the element createLightbox is handed as `content`. A panel is named
        // either by its own id or by an id that CONTAINS it (`#iconLightbox .lb-content`).
        for (const one of selector.split(',').map(s => s.trim()).filter(Boolean)) {
            const ids = one.match(/#[A-Za-z][\w-]*/g) ?? [];
            const namesPanel = ids.some(id => /(Content|Card)$/.test(id.slice(1)))
                || (ids.length > 0 && /\.lb-content\b/.test(one));
            if (namesPanel) offenders.push(one);
        }
    }
    return { rules, transforms, offenders };
}

describe('lightbox panels keep the shared entry animation', () => {
    test('no id-level rule sets a transform on a lightbox panel', () => {
        const offenders = [];
        for (const f of SHEETS) {
            for (const o of panelTransforms(strip(readFileSync(f, 'utf8'))).offenders) offenders.push(`${f} ${o}`);
        }
        assert.deepEqual(offenders, [],
            'These id-level rules set `transform` on a lightbox panel, which out-specifies '
            + '`.lb-overlay.open .lb-content { transform: scale(1) }` (0,3,0) and freezes the panel '
            + 'at its resting scale — it never grows to full size and the entrance never plays. '
            + 'Set the SIZE with `width`, and leave `transform` to shared.css.');
    });

    test('the scan reads the stylesheets, and sees a frozen panel in every shape — guard the guard', () => {
        // The assertion above passes on a scan that reads nothing (test audit, 7 Nov 2026), so: it
        // reads the rules that are there, sees the transforms among them, and catches each spelling.
        let rules = 0, transforms = 0;
        for (const f of SHEETS) {
            const r = panelTransforms(strip(readFileSync(f, 'utf8')));
            rules += r.rules; transforms += r.transforms;
        }
        assert.ok(SHEETS.length >= 10, `only ${SHEETS.length} stylesheets found`);
        assert.ok(rules >= 1000, `only ${rules} rules read — the rule scan is wrong`);
        assert.ok(transforms >= 20, `only ${transforms} transform rules seen — the scan cannot see what it guards`);

        const caught = (/** @type {string} */ css) => panelTransforms(css).offenders.length;
        assert.equal(caught('#dayDetailContent { transform: scale(0.85); }'), 1);
        assert.equal(caught('#iconLightbox .lb-content { transform: scale(0.85); }'), 1);
        assert.equal(caught('#dayDetailContent, .dd-unused { transform: scale(0.85); }'), 1);
        assert.equal(caught('#dayDetailContent,\n.dd-unused { transform: scale(0.85); }'), 1, 'a selector list on two lines');
        assert.equal(caught('.dd-unused,\n#dayDetailContent { transform: scale(0.85); }'), 1, 'the panel first or last');
        assert.equal(caught('@import url("x.css");\n#dayDetailContent { transform: scale(0.85); }'), 1);
        assert.equal(caught('.lb-overlay.open .lb-content { transform: scale(1); }'), 0, 'the shared rule is not an offender');
        assert.equal(caught('#dayDetailContent { width: 340px; }'), 0);
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
