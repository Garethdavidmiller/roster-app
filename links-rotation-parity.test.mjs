/**
 * links-rotation-parity.test.mjs — the rotation LENGTH is declared once and stated nowhere (v19.98).
 * Run: node --test links-rotation-parity.test.mjs   (part of `npm run test:hygiene`)
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────────────────────────
 *
 * `ROTATING_LINES` was made the single declaration at v19.38, and the comment above it says so:
 * "it was a literal in three files kept in step by a comment". Then the December 2026 plan changed
 * and the rotation went **28 → 22**, and the sweep found the number restated in two more classes of
 * place that the v19.38 pass had not looked at:
 *
 *   1. **`links-compare.js` held its own `const TOTAL_POS = 28;`** — a fourth copy, missed by the
 *      very sweep that was supposed to end them, because the module was extracted from the
 *      coordinator afterwards and took the literal with it. Compare mode would have rendered 28 rows
 *      beside a 22-row grid, six of them rest days no analysis counted, and nothing would throw.
 *
 *   2. **Roughly fifteen copies in PROSE** — the grid card's title, the empty state, four tips
 *      entries, the generator's totals and its Apply confirm, plus `max` attributes in the markup.
 *      Every one renders perfectly while describing a link that does not exist.
 *
 * Both failure modes are silent, and neither is reachable from a behavioural test: the compare
 * literal agreed with the constant for a year, and no assertion anywhere reads UI prose for a number.
 * So the contract is static, and it is written to catch the NEXT change of length rather than this
 * one — moving 22 to 23 should fail here loudly instead of leaving prose behind again.
 *
 * ── WHAT IS AND IS NOT POLICED ─────────────────────────────────────────────────────────────────
 *
 * Comments are stripped before matching. Half of these files are a written record of the 28-line era
 * — `links-seed.js` explains the 22-line sample applied to a 28-line design, `links-window.js`
 * describes a 28-line design that rendered no gaps — and that history is the most useful thing in
 * them. A guard that forced those to be rewritten would be deleting the reasoning to satisfy itself.
 *
 * `LEGACY_DOC_ID = 'combined-28'` is a Firestore document ID, not a length. It is allowlisted by
 * exact string: renaming it would orphan the one legacy document in the collection.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { ROTATING_LINES } from './links-design.js';

const read = (/** @type {string} */ f) => readFileSync(new URL(`./${f}`, import.meta.url), 'utf8');

/** Every Links module, discovered rather than listed — an enumerated list stops covering what
 *  arrives after it, which is the failure `.claude/rules/links-design.md`'s own `paths:` glob and
 *  `selectBackupKeys`'s prefix scan were both written up for. */
const LINKS_JS = readdirSync(new URL('.', import.meta.url))
    .filter(f => /^links-[\w-]+\.js$/.test(f) || f === 'links-app.js');

/**
 * Strip comments so the guard reads CODE and STRINGS, never the history above them.
 *
 * Line comments are only stripped when `//` starts the line (after whitespace). A trailing-comment
 * strip would have to distinguish `// note` from the `//` inside a URL, and getting that wrong
 * silently REMOVES source from the scan — a guard that quietly stops looking is worse than one that
 * occasionally has to be argued with.
 */
function stripComments(/** @type {string} */ src) {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

/** HTML comments carry the same design notes; markup is what is being checked. */
const stripHtmlComments = (/** @type {string} */ s) => s.replace(/<!--[\s\S]*?-->/g, '');

describe('the rotation length is declared exactly once', () => {
    test('links-design.js is the only module that assigns it a number', () => {
        const decl = /\bconst\s+(\w*(?:ROTATING|TOTAL_POS|LINES)\w*)\s*=\s*(\d+)\s*;/g;
        /** @type {string[]} */ const offenders = [];
        for (const f of LINKS_JS) {
            for (const m of stripComments(read(f)).matchAll(decl)) {
                if (f === 'links-design.js' && m[1] === 'ROTATING_LINES') continue;
                offenders.push(`${f}: const ${m[1]} = ${m[2]}`);
            }
        }
        assert.deepEqual(offenders, [],
            'a Links module has written the rotation length down again instead of importing '
            + 'ROTATING_LINES — this is exactly how links-compare.js came to render 28 rows beside a '
            + `22-row grid:\n  ${offenders.join('\n  ')}`);
    });

    test('every module that needs the length imports it', () => {
        // The mirror-image failure: a module could satisfy the rule above by inlining the number at
        // its use sites instead of in a const. Any module naming TOTAL_POS must have imported
        // ROTATING_LINES to build it.
        for (const f of LINKS_JS) {
            const code = stripComments(read(f));
            if (!/\bTOTAL_POS\b/.test(code)) continue;
            assert.match(code, /ROTATING_LINES/,
                `${f} uses TOTAL_POS without importing ROTATING_LINES`);
        }
    });
});

describe('the length is never STATED — not in code, not in prose', () => {
    /**
     * A number immediately qualified by "line(s)", or a bare "of N" ceiling. Both are how the
     * rotation length actually appeared in the strings this pass removed.
     */
    const STATED = /\b(\d{1,3})[\s-]lines?\b/gi;

    /** `combined-28` is a Firestore doc id (LEGACY_DOC_ID) — a name, not a count. */
    const ALLOW_SUBSTRINGS = ['combined-28'];
    const deAllow = (/** @type {string} */ s) =>
        ALLOW_SUBSTRINGS.reduce((acc, a) => acc.split(a).join(''), s);

    test('no Links module states a line count as a literal', () => {
        /** @type {string[]} */ const offenders = [];
        for (const f of LINKS_JS) {
            const code = deAllow(stripComments(read(f)));
            for (const m of code.matchAll(STATED)) {
                // A number that happens to equal the current rotation is still a literal — it is
                // right today and wrong on the next change, which is the whole failure mode.
                offenders.push(`${f}: "${m[0].trim()}"`);
            }
        }
        assert.deepEqual(offenders, [],
            `interpolate ROTATING_LINES instead of writing the number:\n  ${offenders.join('\n  ')}`);
    });

    test('links.html states it only through a stamped span', () => {
        const html = deAllow(stripHtmlComments(read('links.html')));
        const offenders = [...html.matchAll(STATED)].map(m => `"${m[0].trim()}"`);
        assert.deepEqual(offenders, [],
            'static markup cannot interpolate, so the count belongs in a `.js-rotating-lines` span '
            + `that links-app.js stamps at init:\n  ${offenders.join('\n  ')}`);
    });

    test('the stamped spans exist, carry the right value, and are actually stamped', () => {
        // Three separate ways this can be hollow: no spans at all (the prose check would pass
        // vacuously), spans whose static fallback has gone stale, or spans nothing writes to.
        const html = read('links.html');
        const spans = [...html.matchAll(/class="js-rotating-lines"[^>]*>(\d+)</g)].map(m => m[1]);
        assert.ok(spans.length >= 3, `expected the count in several places, found ${spans.length}`);
        for (const v of spans) {
            assert.equal(Number(v), ROTATING_LINES,
                'the static fallback in links.html has drifted from ROTATING_LINES');
        }
        assert.match(stripComments(read('links-app.js')), /querySelectorAll\('\.js-rotating-lines'\)/,
            'nothing stamps the spans, so the markup is a hand-maintained copy again');
    });

    test('the numeric ceilings in the markup are stamped too', () => {
        // `max` on the spare-lines and long-weekends inputs is the rotation length (and one below
        // it). Left static, a shrunk rotation leaves a control that accepts a value the generator
        // will then refuse.
        const app = stripComments(read('links-app.js'));
        assert.match(app, /getElementById\('genSpareLines'\)\?\.setAttribute\('max'/);
        assert.match(app, /getElementById\('objLongTarget'\)\?\.setAttribute\('max'/);
    });
});
