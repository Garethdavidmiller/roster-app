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
/** The same colour URL-encoded, as it is written inside an SVG data URI: `stroke='%23001e3c'`. */
const URL_HEX = /%23[0-9a-fA-F]{3,8}(?![0-9a-fA-F])/g;

/** A colour written as oklch() — the form the palette itself uses, so a literal one is a token typed out. */
const OKLCH = /oklch\(/g;
/** The one rule allowed to type an oklch() colour, and why a token cannot carry it. */
const OKLCH_EXEMPT = /** @type {Array<[string, RegExp, string]>} */ ([
    ['index.css', /var\(--today-glow-alpha\)/,
        'the Today cell\'s glow animates its ALPHA through @property, and a static token has no alpha to animate'],
]);

/** A colour written as rgb()/rgba(); group 1 is what is inside the brackets. */
const RGB = /rgba?\(\s*([^)]*)\)/g;
/** Pure black or white, comma or space syntax, any alpha — neutral, like the `black`/`white` keywords. */
const NEUTRAL_RGB = /^(0\s*[, ]\s*0\s*[, ]\s*0|255\s*[, ]\s*255\s*[, ]\s*255)(\s*[,/]|$)/;
/** Coloured rgb() literals each sheet held on 3 Nov 2026 — may only go DOWN (see the rgb() test). */
const RGB_BASELINE = /** @type {Record<string, number>} */ ({ 'index.css': 8, 'links.css': 6, 'shared.css': 3 });

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
 * Where to read a literal's declaration from. A match inside `url(…)` is read from the `url(` itself:
 * a data URI carries its own `;` (`svg+xml;charset=UTF-8`), which `declarationAt` would stop at, and
 * the property — `--caret-chevron:` for the token definitions — would never be seen.
 */
function declAnchor(/** @type {string} */ css, /** @type {number} */ at) {
    const u = css.lastIndexOf('url(', at);
    return u > -1 && !css.slice(u, at).includes(')') ? u : at;
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
            // Both spellings (test audit, 7 Nov 2026): the URL-encoded one passed this test for ever,
            // and eight navy chevrons sat in data URIs beside the token made to end that copying.
            for (const m of [...css.matchAll(HEX), ...css.matchAll(URL_HEX)]) {
                const at = declAnchor(css, m.index);
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

    // ── rgb() — the same rule, the other spelling (3 Nov 2026) ─────────────────────────────────
    // The full check that day found ~220 colours written as rgb()/rgba() that this file could not
    // see, because it only read `#…`. Most are pure white or black at some alpha, which is NEUTRAL —
    // the same as the `white`/`black` keywords the app already uses for highlight and shade — and is
    // not a colour choice. The rest are typed tints, nearly all one navy shadow (`rgba(0, 30, 60, …)`)
    // written out rule by rule. They are a RATCHET, not a pardon: each sheet may hold no more coloured
    // rgb() than it did, a sheet not listed may hold none, and a count that falls must come down here.
    test('no app stylesheet adds a coloured rgb() literal — and the ones it held only go down', () => {
        const counts = /** @type {Record<string, number>} */ ({});
        const found = /** @type {Record<string, string[]>} */ ({});
        for (const file of SHEETS) {
            const css = blankComments(readFileSync(file, 'utf8'));
            const prints = printRegions(css);
            for (const m of css.matchAll(RGB)) {
                if (NEUTRAL_RGB.test(m[1].trim())) continue;                    // white or black, any alpha
                const at = m.index;
                if (prints.some(([s, e]) => at >= s && at < e)) continue;      // 4. paper
                const decl = declarationAt(css, at);
                if (decl.split(':')[0].trim().startsWith('--')) continue;        // 1. the definition
                const declStart = css.lastIndexOf(decl, at);
                if (insideVar(decl, at - declStart)) continue;                  // 2. a fallback
                counts[file] = (counts[file] || 0) + 1;
                (found[file] ||= []).push(`${file}:${lineOf(css, at)}  ${m[0]}`);
            }
        }
        const over = SHEETS.filter(f => (counts[f] || 0) > (RGB_BASELINE[f] || 0))
            .map(f => `${f}: ${counts[f]} coloured rgb() literals, ${RGB_BASELINE[f] || 0} allowed\n    ${found[f].join('\n    ')}`);
        assert.deepEqual(over, [],
            'a colour typed as rgb() stops tracking the token system exactly as a hex one does:\n  '
            + over.join('\n  ') + '\nRead a token — for a tint, `color-mix(in oklch, var(--token) N%, transparent)`.');
        const loose = Object.entries(RGB_BASELINE).filter(([f, n]) => (counts[f] || 0) < n)
            .map(([f, n]) => `${f}: holds ${counts[f] || 0}, baseline still says ${n}`);
        assert.deepEqual(loose, [], 'lower these baselines — a ratchet left loose banks the saving:\n  ' + loose.join('\n  '));
    });

    // ── oklch() — the palette's own spelling (test audit, 7 Nov 2026) ───────────────────────────
    // Every token in shared.css is written in oklch(), so a literal one in a rule is a token typed out
    // by hand, and this file could not see it: four sat in the App Notices archive. No ratchet here,
    // because there was nothing to ratchet from — outside a token definition there is one, named below.
    test('no app stylesheet types an oklch() colour into a rule', () => {
        const offenders = [];
        const used = new Set();
        for (const file of SHEETS) {
            const css = blankComments(readFileSync(file, 'utf8'));
            const prints = printRegions(css);
            for (const m of css.matchAll(OKLCH)) {
                const at = m.index;
                if (prints.some(([s, e]) => at >= s && at < e)) continue;      // 4. paper
                const decl = declarationAt(css, at);
                if (decl.split(':')[0].trim().startsWith('--')) continue;        // 1. the definition
                const declStart = css.lastIndexOf(decl, at);
                if (insideVar(decl, at - declStart)) continue;                  // 2. a fallback
                const exempt = OKLCH_EXEMPT.find(([f, re]) => f === file && re.test(decl));
                if (exempt) { used.add(exempt[0]); continue; }
                offenders.push(`${file}:${lineOf(css, at)}  ${decl.trim().slice(0, 90)}`);
            }
        }
        assert.deepEqual(offenders, [],
            'oklch() typed into a rule — define a token in :root and read it with var():\n  ' + offenders.join('\n  '));
        for (const [file, , reason] of OKLCH_EXEMPT) {
            assert.ok(used.has(file), `${file}'s oklch() exemption is no longer used — drop it (${reason})`);
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
        // The URL-encoded spelling is seen, and it is the chevron tokens' definitions that hold it.
        const urlDefs = [...shared.matchAll(URL_HEX)].filter(m => declarationAt(shared, declAnchor(shared, m.index)).trim().startsWith('--'));
        assert.ok(urlDefs.length >= 2, 'the URL-encoded extractor sees neither chevron token — data URIs would pass unread');
        assert.equal([...".a { background: url(\"data:image/svg+xml,%3Csvg stroke='%23ff0000'/%3E\") }".matchAll(URL_HEX)].length, 1,
            'the URL-encoded extractor misses a colour in a data URI');
        assert.equal([...'.a { color: oklch(50% 0.1 20deg) }'.matchAll(OKLCH)].length, 1, 'the oklch() extractor sees nothing');

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

        // rgb(): neutral is white or black only, and the extractor sees a tint.
        assert.match('255, 255, 255, 0.65', NEUTRAL_RGB);
        assert.match('0 0 0 / 0.12', NEUTRAL_RGB);
        assert.doesNotMatch('0, 30, 60, 0.05', NEUTRAL_RGB, 'the navy shadow tint is a COLOUR, not neutral');
        assert.doesNotMatch('255, 200, 0', NEUTRAL_RGB);
        assert.equal([...'a { box-shadow: 0 1px 2px rgba(0, 30, 60, 0.05) }'.matchAll(RGB)].length, 1,
            'the rgb() extractor sees nothing — every sheet would pass');

        // 4 · @media print is exempt, and the region ends where the block ends.
        const sample = '@media print { .a { color: #999; } }\n.b { color: #123456; }';
        const regions = printRegions(sample);
        assert.equal(regions.length, 1, 'the print-region finder found no block');
        const after = sample.indexOf('#123456');
        assert.ok(!regions.some(([s, e]) => after >= s && after < e),
            'the print region swallowed a rule outside it — every literal after a print block would pass');
    });
});
