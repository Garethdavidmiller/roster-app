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
import { pageStylesheets } from './scripts/app-pages.mjs';

const read = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');

/** shared.css and every app page's stylesheet, so the tokens are in scope — from scripts/app-pages.mjs
 *  (v25.21: a hand-written seven missed overtime, trains and newlink). */
const APP_CSS = ['shared.css', ...Object.values(pageStylesheets())];

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
// EXACT SELECTORS, one per entry, compared with each selector of a rule's list (test audit, 7 Nov
// 2026). These were substrings, so `.lb-content .picker-opt:focus-visible { outline: none }` — a
// real Tab stop inside every overlay panel — matched '.lb-content' and passed the whole lane.
const NO_INDICATOR_EXEMPT = [
    // Programmatically focused panel wrapper — never a Tab target (see overlay.js).
    '.lb-content:focus',
    '.lb-content:focus-visible',
    // The PDF viewer's panel (newlink.html): the same programmatically focused wrapper, tabindex="-1".
    '.pdf-viewer-panel:focus',
    '.pdf-viewer-panel:focus-visible',
    // #hourlyRate is the only .pfx--readonly field and carries tabindex="-1".
    '.pfx--readonly input:not([type="checkbox"]):not([type="radio"]):focus',
    // The option ROWS carry the ring (`:has(input:focus-visible)` on the row) because the row is
    // what is being chosen; the app-drawn box inside (shared.css, v23.50) would otherwise draw a
    // second ring 10px away. Each of these is a Tab stop with a visible indicator — on the row.
    '.gen-obj input[type="checkbox"]:focus-visible',
    '.bp-mode-opt input[type="radio"]:focus-visible',
    '.hpp-mode-opt input[type="radio"]:focus-visible',
];

/** A selector list split at its top-level commas — not the ones inside `:not(…)` or `[…]`. */
function selectorList(/** @type {string} */ selector) {
    const out = [];
    let depth = 0, start = 0;
    for (let i = 0; i < selector.length; i++) {
        const c = selector[i];
        if (c === '(' || c === '[') depth++;
        else if (c === ')' || c === ']') depth--;
        else if (c === ',' && depth === 0) { out.push(selector.slice(start, i).trim()); start = i + 1; }
    }
    out.push(selector.slice(start).trim());
    return out.filter(Boolean);
}

/** The ways an outline is taken away. `none` and `0` always were; a transparent colour, a zero
 *  width and a `none` style draw exactly as little and passed until the test audit (7 Nov 2026). */
const REMOVES_OUTLINE = [
    /(?:^|[\s;])outline:\s*(?:none|0(?:px|em|rem)?)\b/,
    /(?:^|[\s;])outline:[^;]*\btransparent\b/,
    /(?:^|[\s;])outline-width:\s*0(?:px|em|rem)?\s*(?:!important\s*)?(?:;|$)/,
    /(?:^|[\s;])outline-style:\s*none\b/,
    /(?:^|[\s;])outline-color:\s*transparent\b/,
];

/**
 * Every `:focus` rule in one stylesheet, and the ones that take the outline away and put nothing
 * visible back. Comments are blanked first, keeping line breaks, so a rule's explanation cannot
 * read as its declaration and the line numbers still point at the source.
 * @param {string} css
 */
function focusSuppressions(css) {
    const src = css.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
    /** @type {string[]} */ const offenders = [];
    /** @type {Set<string>} */ const exemptUsed = new Set();
    let rules = 0;
    // Every rule whose selector mentions :focus, captured with its declaration block.
    for (const m of src.matchAll(/([^{}]*:focus(?:-visible)?[^{}]*)\{([^}]*)\}/g)) {
        rules++;
        // After any `;`: a statement or a nested rule's parent declarations can sit before the selector.
        const selector = (m[1].split(';').pop() ?? '').trim().replace(/\s+/g, ' ');
        const body = m[2];
        if (!REMOVES_OUTLINE.some(re => re.test(body))) continue;                     // outline intact
        if (/box-shadow:/.test(body) && !/box-shadow:\s*none/.test(body)) continue; // replaced by a ring
        const notExempt = selectorList(selector).filter(s => !NO_INDICATOR_EXEMPT.includes(s));
        selectorList(selector).filter(s => NO_INDICATOR_EXEMPT.includes(s)).forEach(s => exemptUsed.add(s));
        if (!notExempt.length) continue;
        const line = src.slice(0, m.index).split('\n').length;
        offenders.push(`${line} ${notExempt.join(', ')}`);
    }
    return { rules, offenders, exemptUsed };
}

test('a focus rule that removes the outline must put something visible back', () => {
    const offenders = [];
    for (const file of APP_CSS) {
        for (const o of focusSuppressions(read(file)).offenders) offenders.push(`${file}:${o}`);
    }
    assert.deepEqual(offenders, [],
        'focus rules that leave no visible indicator — if the element is not a Tab stop, add it to NO_INDICATOR_EXEMPT with the reason');
});

// ── Guard the guard (test audit, 7 Nov 2026) ────────────────────────────────────────────────────
// Every assertion above passes if the scan finds no rules at all, which is indistinguishable from
// stylesheets with nothing wrong in them. So: the scan reads the rules that are there, every
// exemption still names a real rule, and each way of removing an outline is seen.
test('the scan finds the focus rules, every exemption is in use, and each removal is seen', () => {
    let rules = 0;
    const used = new Set();
    for (const file of APP_CSS) {
        const r = focusSuppressions(read(file));
        rules += r.rules;
        r.exemptUsed.forEach(s => used.add(s));
    }
    assert.ok(rules >= 100, `only ${rules} :focus rules found across ${APP_CSS.length} stylesheets — the scan is wrong`);
    assert.deepEqual(NO_INDICATOR_EXEMPT.filter(s => !used.has(s)), [],
        'an exemption that names no rule any more would excuse the next rule written with that selector — drop it');

    const caught = (/** @type {string} */ css) => focusSuppressions(css).offenders.length;
    assert.equal(caught('.x:focus-visible { outline: none; }'), 1);
    assert.equal(caught('.x:focus-visible { outline: 0px; }'), 1);
    assert.equal(caught('.x:focus-visible { outline: 2px solid transparent; }'), 1);
    assert.equal(caught('.x:focus-visible { outline-width: 0; }'), 1);
    assert.equal(caught('.x:focus-visible { outline-style: none; }'), 1);
    assert.equal(caught('.x:focus-visible { outline-color: transparent; }'), 1);
    assert.equal(caught('.lb-content .picker-opt:focus-visible { outline: none; }'), 1,
        'an exemption is a selector, not a substring');
    assert.equal(caught('.lb-content:focus, .x:focus { outline: none; }'), 1,
        'an exempt selector does not excuse the rest of its list');
    assert.equal(caught('.lb-content:focus, .lb-content:focus-visible { outline: none; }'), 0);
    assert.equal(caught('.x:focus-visible { outline: none; box-shadow: var(--focus-ring); }'), 0);
    assert.equal(caught('.x:focus-visible { outline: var(--focus-outline); outline-offset: 2px; }'), 0);
    assert.equal(caught('.x:focus-visible { /* not outline: none */ outline: var(--focus-outline); }'), 0);
});

// ── 3. A control on a NAVY surface never wears the navy ring (desktop audit, Nov 2026) ─────────────
// The fallback ring is `--focus-outline` — navy — so a control on navy with no rule of its own is a
// Tab stop with no visible indicator (1:1). These are the shared code's controls on the navy header
// and the opaque navy sheet, and the Pay Calculator's two on navy surfaces of its own (whole-app fix,
// 10 Nov 2026): the help sheet's ✕ and the guide link on the navy page. Each must name a ring drawn for
// a dark surface. A static floor beside the e2e (pages.spec.js → "keyboard focus is visible on the navy
// surfaces"), which reads the computed ring: this one names the rule, that one proves the cascade lets
// it win.
test('the controls on a navy surface name a ring drawn for one', () => {
    /** @type {Record<string, string[]>} each stylesheet → the focus selectors on navy that it owns */
    const ON_NAVY = {
        'shared.css': ['.app-icon:focus-visible', '#iconLightboxClose:focus-visible', '.notice-lb-content .lb-close:focus-visible',
            '#navNoticesClose:focus-visible', '#navComingSoonClose:focus-visible', '.lightbox-bug-link:focus-visible',
            '.lightbox-print-btn:focus-visible', '.notice-cta:focus-visible', '.notice-later:focus-visible',
            '.notice-lb-content .btn-action:focus-visible', '#navNoticesList:focus-visible'],
        'paycalc.css': ['#helpLightboxClose:focus-visible', '.guide-footer-link a:focus-visible'],
    };
    const wrong = [];
    for (const [file, selectors] of Object.entries(ON_NAVY)) {
        const src = read(file).replace(/\/\*[\s\S]*?\*\//g, ' ');
        /** @type {Record<string, string>} */ const ring = {};
        for (const m of src.matchAll(/([^{}]*:focus-visible[^{}]*)\{([^}]*)\}/g)) {
            for (const s of selectorList((m[1].split(';').pop() ?? '').trim().replace(/\s+/g, ' '))) {
                const o = /(?:^|[\s;])outline:\s*([^;]+)/.exec(m[2])?.[1].trim();
                if (o) ring[s] = o;
            }
        }
        wrong.push(...selectors.filter(s => !/^var\(--focus-outline-(?:gold|light)\)$/.test(ring[s] ?? ''))
            .map(s => `${file}: ${s} → ${ring[s] ?? 'no rule: the navy fallback'}`));
    }
    assert.deepEqual(wrong, [], 'a control on navy needs --focus-outline-gold or --focus-outline-light');
});

// ── 4. An outline in a BASE rule is a focus decision too (whole-app fix, 10 Nov 2026) ────────────────
// Every scan above reads focus rules. An `outline` written on an element's own rule is drawn whether or
// not it is focused — and at the specificity of its class it can outrank the shared fallback ring, so a
// keyboard landing on it changes nothing on screen (the Links armed brush chip, css-links-paycalc-2). So a
// selector whose base rule sets an outline must have a focus rule of its own, which shows its author
// decided what focus looks like on it — or be named here as a decoration that is never a Tab stop.
/** @type {Record<string, string>} selector → why it is not a Tab stop */
const BASE_OUTLINE_DECORATIONS = {
    '.ddc-badge': 'the day panel\'s shift pill: a <span> (calendar-al-lightbox.js); its hairline keeps pale fills off the navy',
    '.ddm-chip': 'the day panel\'s marker chip: a <span> (calendar-al-lightbox.js); its outline is a whisper of gold',
    '.dm-avatar': 'the Links masthead\'s initials badge: an aria-hidden <span> (links.html)',
    '.cell-diff .shift-cell-btn': 'a compare-mode cell that differs: a <span> since v22.60 (links-compare.js), never pressed',
    '.pdf-viewer-page': 'the PDF viewer\'s page: a <div role="group"> holding a canvas (pdf-viewer.js), no tabindex; its hairline edges a dark page on the navy ground',
};

/**
 * Every selector whose base rule sets an outline (`outline`, `-style`, `-width` or `-color`; an offset
 * alone draws nothing), and the base forms of every focus selector (`:focus`, `:focus-visible` and
 * `:focus-within` taken out), across the given stylesheets. Comments are blanked as above.
 * @param {Record<string, string>} sheets file → its CSS
 */
function baseOutlines(sheets) {
    /** @type {{ file: string, line: number, selector: string }[]} */ const found = [];
    /** @type {Set<string>} */ const focusBases = new Set();
    for (const [file, css] of Object.entries(sheets)) {
        const src = css.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
        for (const m of src.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
            const selector = (m[1].split(';').pop() ?? '').trim().replace(/\s+/g, ' ');
            if (!selector || selector.startsWith('@')) continue;
            const outlined = /(?:^|[\s;])outline(?:-style|-width|-color)?\s*:/.test(m[2]);
            for (const s of selectorList(selector)) {
                if (/:focus/.test(s)) { focusBases.add(s.replace(/:focus(?:-visible|-within)?/g, '')); continue; }
                if (outlined) found.push({ file, line: src.slice(0, m.index + m[0].indexOf('{')).split('\n').length, selector: s });
            }
        }
    }
    return { found, focusBases };
}

/** The base-rule outlines in `sheets` with no focus rule of their own. @param {Record<string, string>} sheets */
function unclaimedOutlines(sheets) {
    const { found, focusBases } = baseOutlines(sheets);
    return found.filter(f => !focusBases.has(f.selector));
}

test('an outline set in a base rule has a focus rule beside it, or is a decoration nothing can focus', () => {
    const sheets = Object.fromEntries(APP_CSS.map(f => [f, read(f)]));
    const unclaimed = unclaimedOutlines(sheets).filter(f => !(f.selector in BASE_OUTLINE_DECORATIONS));
    assert.deepEqual(unclaimed.map(f => `${f.file}:${f.line} ${f.selector}`), [],
        'a base-rule outline with no focus rule of its own: give the selector a :focus-visible rule, or, if it is never a '
        + 'Tab stop, name it in BASE_OUTLINE_DECORATIONS with the reason');
    // Guard the guard: the scan sees the outlines that are there, every decoration still names one (an entry that
    // outlived its element would excuse the next rule written with that selector), and each spelling is read.
    const named = new Set(baseOutlines(sheets).found.map(f => f.selector));
    assert.ok(named.size >= 6, `only ${named.size} base-rule outlines found across ${APP_CSS.length} stylesheets — the scan is wrong`);
    assert.deepEqual(Object.keys(BASE_OUTLINE_DECORATIONS).filter(s => !named.has(s)), [],
        'a decoration that names no base-rule outline any more — drop it');
    const caught = (/** @type {string} */ css) => unclaimedOutlines({ 't.css': css }).length;
    assert.equal(caught('.x { outline: 2px solid red; }'), 1);
    assert.equal(caught('.x { outline-color: red; }'), 1);
    assert.equal(caught('.x { outline-width: 2px; }'), 1);
    assert.equal(caught('.x { outline-style: dashed; }'), 1);
    assert.equal(caught('.x { outline-offset: 2px; }'), 0, 'an offset alone draws nothing');
    assert.equal(caught('@media print { .x { outline: 1px solid red; } }'), 1, 'inside an at-rule too');
    assert.equal(caught('.x { outline: 1px solid red; } .x:focus-visible { outline: var(--focus-outline); }'), 0);
    assert.equal(caught('.x, .y { outline: 1px solid red; } .x:focus-visible { outline: var(--focus-outline); }'), 1,
        'a focus rule for one selector of a list does not excuse the rest of it');
});
