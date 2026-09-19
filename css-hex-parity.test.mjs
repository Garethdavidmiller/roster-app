// @ts-nocheck
/**
 * css-hex-parity.test.mjs — "never hardcode hex" was an architecture decision with nothing behind it.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────────
 *
 * CLAUDE.md's architecture table has carried this row for most of the app's life:
 *
 *     CSS variables for all colours | Defined in `:root`. Never hardcode hex anywhere in CSS or JS.
 *
 * Nothing enforced it. Found by a mutation audit of every guard in the repo (19 Sep 2026): putting
 * `.mutant-probe { color: #ff0000; background: #123456; }` into `index.css` and running the WHOLE
 * hygiene lane passed. `guide-colour-parity.test.mjs` covers the guide stylesheets and four named
 * `links.css` tokens; the seven app stylesheets had no cover at all, which is where the palette
 * actually lives.
 *
 * That matters more here than the usual tidiness argument, because this app repaints itself from
 * tokens in two directions nobody sees while writing a rule: the three-surface model recolours a
 * control when it becomes active, and `.claude/rules/css-tokens.md` is the one place the Chiltern
 * brand values are stated. A hex typed into a declaration is invisible to both — it renders
 * perfectly and simply stops tracking the system, which is the same failure shape as the ~80
 * hand-written focus recipes `focus-ring-parity.test.mjs` was written for.
 *
 * ── WHAT IS ALLOWED, AND WHY EACH ONE IS NOT A COLOUR CHOICE ────────────────────────────────────
 *
 * The rule as written ("never, anywhere") would fail on day one against 21 existing literals, and
 * reading them is what produced these four exemptions. None is a loophole; each is a place where a
 * hex is either the DEFINITION of the system or not a colour at all.
 *
 *   1. A CUSTOM PROPERTY DEFINITION — `--nav-text: #ffffff`, `--cov-early: #1a7fc1`. This is where
 *      a colour is supposed to exist. The rule is "read the token", so the token has to say
 *      something. Forbidding it here would leave nowhere legal to state a value.
 *
 *   2. A `var()` FALLBACK — `var(--surface, #fff)`. The token is still the source; the literal is
 *      the behaviour when it is missing, which is exactly the case a token cannot cover.
 *
 *   3. A MASK CHANNEL — `mask-image: linear-gradient(to bottom, #000 …)`. `#000` there is an alpha
 *      ramp, not a colour: it never paints, and swapping it for a brand token would be meaningless.
 *
 *   4. INSIDE `@media print` — paper is a different medium. The screen palette (a navy canvas,
 *      tinted surfaces, gold accents) is wrong on a mono printer, and the print greys have no
 *      screen token to read because no screen surface wants them. The alternative — a `--print-*`
 *      token set — is a reasonable thing to want one day and is NOT what this guard is for; it
 *      would be a design change to shipped CSS, not a check.
 *
 * ── AND THE JS HALF, WHICH HAS EXACTLY ONE EXEMPTION ────────────────────────────────────────────
 *
 * `splash-watchdog.js` writes `#001e3c` and `#f5c800` into inline styles, and must. It is a CLASSIC
 * script whose entire purpose is to run when the module graph or the stylesheet did NOT load, so a
 * `var(--navy)` there would resolve to nothing on the one launch it exists for. It is named below
 * with that reason rather than pattern-exempted, so a SECOND file claiming the same licence has to
 * argue for it here.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

/**
 * The app stylesheets, DERIVED rather than listed — a new page's sheet is covered the day it lands.
 * The guide sheets have their own palette guard (`guide-colour-parity.test.mjs`), which checks the
 * brand mirrors against the documented hex and so legitimately holds literals.
 */
const SHEETS = readdirSync('.')
    .filter(f => f.endsWith('.css'))
    // The guide sheets are `<name>-guide.css`, NOT `guide-<name>.css` — a filter written the other
    // way round silently scans them (it flagged 16 rangers-guide.css literals on the first run) and
    // would fail this suite against a palette another guard deliberately states in hex.
    .filter(f => !/^guide[-.]|-guide\.css$/.test(f))
    .sort();

/** Root JS modules — the app's own code, not tooling, tests or vendored copies. */
const MODULES = readdirSync('.')
    .filter(f => (f.endsWith('.js') || f.endsWith('.mjs')))
    .filter(f => !f.includes('.test.') && f !== 'purify.es.mjs' && f !== 'eslint.config.js'
        && f !== 'generate-sri.mjs' && !f.startsWith('playwright.'))
    .sort();

/** The ONE module allowed to write a colour, with the reason it cannot read a token. */
const JS_EXEMPT = new Map([
    ['splash-watchdog.js',
        'a CLASSIC script that runs when the module graph or the stylesheet did not load — a '
        + 'var(--token) would resolve to nothing on the exact launch it exists to rescue'],
]);

const HEX = /#[0-9a-fA-F]{3,8}\b/g;

/** Blank out comments, keeping every byte and newline so offsets and line numbers still hold. */
const blankComments = (/** @type {string} */ src) =>
    src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));

const lineOf = (/** @type {string} */ src, /** @type {number} */ index) =>
    src.slice(0, index).split('\n').length;

/**
 * The `@media … print …` regions of a stylesheet, as [start, end) offsets.
 * Brace-matched rather than regexed, so a nested rule cannot end the block early.
 */
function printRegions(/** @type {string} */ css) {
    const out = [];
    const re = /@media([^{]*)\{/g;
    let m;
    while ((m = re.exec(css))) {
        if (!/\bprint\b/.test(m[1])) continue;
        let depth = 1;
        let i = re.lastIndex;
        while (i < css.length && depth > 0) {
            if (css[i] === '{') depth++;
            else if (css[i] === '}') depth--;
            i++;
        }
        out.push([m.index, i]);
    }
    return out;
}

/**
 * The declaration surrounding an offset — back to the previous `;`/`{`, forward to the next `;`/`}`.
 * Good enough because this only has to name the PROPERTY and see the value around one literal.
 */
function declarationAt(/** @type {string} */ css, /** @type {number} */ index) {
    let start = index;
    while (start > 0 && !'{;}'.includes(css[start - 1])) start--;
    let end = index;
    while (end < css.length && !'{;}'.includes(css[end])) end++;
    return css.slice(start, end);
}

/**
 * Is the hex at `offsetInDecl` inside a `var(…)` group? Paren-depth scan rather than a regex, so a
 * nested `var(--a, var(--b, #fff))` is answered correctly.
 */
function insideVar(/** @type {string} */ decl, /** @type {number} */ offsetInDecl) {
    let depth = 0;
    const varDepths = [];
    for (let i = 0; i < offsetInDecl; i++) {
        if (decl[i] === '(') {
            depth++;
            if (/var\s*$/.test(decl.slice(Math.max(0, i - 4), i))) varDepths.push(depth);
        } else if (decl[i] === ')') {
            if (varDepths[varDepths.length - 1] === depth) varDepths.pop();
            depth--;
        }
    }
    return varDepths.length > 0;
}

describe('colours come from tokens, not from literals typed into a rule', () => {

    test('no app stylesheet states a colour as a hex literal', () => {
        const offenders = [];
        for (const file of SHEETS) {
            const css = blankComments(readFileSync(file, 'utf8'));
            const prints = printRegions(css);
            for (const m of css.matchAll(HEX)) {
                const at = m.index;
                if (prints.some(([s, e]) => at >= s && at < e)) continue;      // 4. paper
                const decl = declarationAt(css, at);
                const prop = decl.split(':')[0].trim();
                if (prop.startsWith('--')) continue;                            // 1. the definition
                if (/^(-webkit-)?mask(-image)?$/.test(prop)) continue;          // 3. an alpha ramp
                const declStart = css.lastIndexOf(decl, at);
                if (insideVar(decl, at - declStart)) continue;                  // 2. a fallback
                offenders.push(`${file}:${lineOf(css, at)}  ${decl.trim().slice(0, 90)}`);
            }
        }
        assert.deepEqual(offenders, [],
            'hex literals in an app stylesheet — a colour typed into a rule stops tracking the '
            + 'token system, and nothing renders wrongly to say so:\n  ' + offenders.join('\n  ')
            + '\nDefine a token in :root and read it with var(). The four exemptions (a token '
            + 'definition, a var() fallback, a mask channel, @media print) are in this file\'s header.');
    });

    test('no JS module writes a colour into a style', () => {
        const offenders = [];
        for (const file of MODULES) {
            if (JS_EXEMPT.has(file)) continue;
            const src = readFileSync(file, 'utf8')
                .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
                .split('\n')
                .map(l => l.replace(/\/\/.*$/, ''))       // line comments explain; they do not paint
                .join('\n');
            for (const m of src.matchAll(HEX)) {
                offenders.push(`${file}:${lineOf(src, m.index)}  ${m[0]}`);
            }
        }
        assert.deepEqual(offenders, [],
            'hex literals in JS — set a class, or read the token with getComputedStyle; a colour '
            + 'built in JS is invisible to every stylesheet guard:\n  ' + offenders.join('\n  ')
            + '\nIf the module genuinely cannot read a token (see splash-watchdog.js), add it to '
            + 'JS_EXEMPT with that reason.');
    });

    test('every JS exemption is still a real file with a real reason', () => {
        for (const [file, reason] of JS_EXEMPT) {
            assert.ok(MODULES.includes(file), `${file} is exempted but no longer exists`);
            assert.ok(reason.length > 40 && / /.test(reason),
                `${file}'s exemption is a placeholder, not a reason`);
            assert.match(readFileSync(file, 'utf8'), HEX,
                `${file} no longer contains a hex literal — drop the exemption rather than leaving `
                + 'a licence nobody is using');
        }
    });

    // ── Guard the guard ────────────────────────────────────────────────────────────────────────
    // Every assertion above passes if the extractor finds NOTHING, which is indistinguishable from
    // a stylesheet with no literals. These pin the machinery to literals that ARE there, so a
    // broken regex or an over-eager exemption fails loudly instead of reporting a clean sheet.
    test('the extractor and each exemption are demonstrably working', () => {
        assert.ok(SHEETS.length >= 7, `expected the app stylesheets, found ${SHEETS.length}`);
        assert.ok(MODULES.length >= 40, `expected the root modules, found ${MODULES.length}`);

        const shared = blankComments(readFileSync('shared.css', 'utf8'));
        assert.match(shared, HEX, 'shared.css has literals (in token definitions) — the regex sees none');

        // 1 · a token definition is exempt, and is the reason shared.css passes at all.
        const defs = [...shared.matchAll(HEX)]
            .filter(m => declarationAt(shared, m.index).trim().startsWith('--'));
        assert.ok(defs.length > 0, 'no token definition found — exemption 1 is not being exercised');

        // 2 · a var() fallback is exempt. index.css carries `var(--surface, #fff)`.
        assert.ok(insideVar('background: var(--surface, #fff)', 'background: var(--surface, '.length),
            'the var()-fallback detector no longer sees a fallback');
        assert.ok(!insideVar('background: #fff', 'background: '.length),
            'the var()-fallback detector calls a bare literal a fallback — everything would pass');

        // 3 · a mask channel is exempt, and only a mask channel.
        assert.match('-webkit-mask-image', /^(-webkit-)?mask(-image)?$/);
        assert.doesNotMatch('background-image', /^(-webkit-)?mask(-image)?$/);

        // 4 · @media print is exempt, and the region ends where the block ends.
        const sample = '@media print { .a { color: #999; } }\n.b { color: #123456; }';
        const regions = printRegions(sample);
        assert.equal(regions.length, 1, 'the print-region finder found no block');
        const after = sample.indexOf('#123456');
        assert.ok(!regions.some(([s, e]) => after >= s && after < e),
            'the print region swallowed a rule outside it — every literal after a print block would pass');
    });
});
