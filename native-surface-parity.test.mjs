// @ts-check
/**
 * native-surface-parity.test.mjs — THE OS DRAWS NOTHING THE APP CAN DRAW ITSELF.
 *
 * The rule had been stated four times, once per control, and each time only for that control:
 * `select-sheet.js` for the `<select>` popup, `date-picker.js` for `<input type="date">`,
 * `roster-entry-control.js` for `<input type="time">`, `overlay.js` for `alert`/`confirm`/`prompt`.
 * An audit on 9 Sep 2026 then counted what was still the platform's: 25 checkboxes and radios (an
 * `accent-color` tint over the OS's own box, tick and animation — five of them the radios that pick
 * which PAY figure the calculator shows), 47 `title` tooltips (30 of them duplicating an
 * `aria-label`; all of them invisible on a touch screen, which is where the staff are), three
 * textarea resize grips, and every scrollbar.
 *
 * Each of those had been a decision written as a COMMENT. A comment guards nothing: the
 * `<input type="time">` ban lived in two module headers and would have survived a third
 * `type="time"` being typed anywhere else. This file is the guard for the whole class.
 *
 * ── WHAT EACH CONTRACT PROTECTS ────────────────────────────────────────────────────────────────
 *
 *  1. No `title` attribute anywhere served. A `title` is an OS tooltip — the platform's font,
 *     delay and box, and nothing at all on touch. Where the text mattered it now lives in the
 *     row; where it duplicated an `aria-label` or visible text it is gone (DECISIONS.md →
 *     Tooltips). `document.title` and object-literal `title:` keys are not attributes and pass.
 *  2. No `accent-color`. It was the tint over an OS widget; the widget is drawn in shared.css now.
 *  3. No page sets a checkbox's or radio's `width`, `height` or colour. One recipe, in shared.css;
 *     a page recolours through `--check-fill`, and a page that restates the box has forked it.
 *     The handles this checks are DERIVED from the markup — every checkbox/radio's own class and
 *     the class of the label or box wrapping it — so a new one joins the check by existing.
 *  4. shared.css actually draws them: `appearance: none` on both input types. Without this,
 *     contract 3 would be forbidding pages from sizing a control nobody had replaced.
 *  5. No OS resize grip on a textarea (`resize: vertical|horizontal|both`).
 *  6. No `<input type="time">` — the OS widget renders 12-hour from the device's format setting
 *     whatever the page locale says (measured, roster-entry-control.js), and every other time in
 *     the app is 24-hour.
 *  7. No `alert(`, `confirm(` or `prompt(` — `confirmDialog`/`promptDialog` in overlay.js are the
 *     replacements. The install prompt's `deferred.prompt()` is a METHOD on the OS event and is
 *     the one OS dialog the app is supposed to open; a preceding `.` excludes it.
 *  9. The password field's own OS buttons are suppressed — Edge's `::-ms-reveal`/`::-ms-clear`
 *     and Safari's `::-webkit-credentials-auto-fill-button`. The app draws `.login-pw-toggle` in
 *     that exact corner and reserves 62px for it, so the platform's lands under the app's.
 * 10. Autofill cannot repaint a field. Chrome and Safari override `--field-bg` with their own
 *     yellow; an `!important` inset shadow is the only thing that covers it. The FOCUS half is
 *     what this pins hardest: that shadow must restate `--focus-ring`, or an autofilled field
 *     loses its focus indicator and no other suite can see it (focus-ring-parity reads
 *     stylesheets for `outline`/`box-shadow` recipes, not for which selector wins).
 * 11. `::selection`, `::placeholder` and `caret-color` are declared in BOTH stylesheets that need
 *     them. The guides load no app stylesheet, so a rule added only to shared.css reaches seven
 *     pages of twelve — the way `--scroll-thumb` had to be minted twice at v23.50.
 * 12. Every served page sets `spellcheck="false"` on `<body>`. Nothing in this app takes prose:
 *     the fields are hours, minutes, rates, money, times, a tax code, names and an address, and a
 *     dictionary underline under any of them is the OS drawing on the app's data. On `<body>` it
 *     inherits, so the fields built in JS are covered without 42 attributes. The two legacy
 *     redirect stubs carry no fields and are exempt by name.
 *
 *  8. A page that styles inputs BY ELEMENT excludes the two the app draws. `.field input { width:
 *     100% }` reached the pay calculator's toggles and mode radios the moment their per-site sizes
 *     were removed, and rendered a checkbox as a full-width navy bar — found by looking, since
 *     every test was green. It is the `.controls select` / `.fieldpick` rule from select-sheet.js
 *     in reverse: an element selector cannot know what the recipe replaced, so it says so.
 *
 * What it cannot see: the surfaces that are the platform's by nature — the file picker, the print
 * dialog, Web Push, the install prompt, and the keyboard with its AutoFill bar. Those are correct
 * and the audit says so; this file is about the ones that were a choice. Note the line contract 10
 * draws through autofill, because the first version of this paragraph put the whole of it on the
 * platform's side: OFFERING a saved password is the platform's and is left alone; REPAINTING the
 * app's own field to say so is not, and is covered.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const ROOT = new URL('./', import.meta.url);
const read = (/** @type {string} */ f) => readFileSync(new URL(f, ROOT), 'utf8');
const strip = (/** @type {string} */ s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const HTML = readdirSync(ROOT).filter(f => f.endsWith('.html'));
const CSS  = readdirSync(ROOT).filter(f => f.endsWith('.css'));
/** Served root modules — not the tests, not the e2e specs, not the functions. */
const JS   = readdirSync(ROOT).filter(f => f.endsWith('.js') && !f.endsWith('.test.mjs'));

// ── 1. no title attribute ───────────────────────────────────────────────────────────────────────
test('no served page and no module puts a `title` attribute on anything', () => {
    const offenders = [];
    // `(?<![-\w])` keeps `data-cs-title="…"` and `subtitle="…"` out; `<title>` is an element and
    // carries no `="`.
    const attr = /(?<![-\w])title="/g;
    for (const f of HTML) {
        const n = (read(f).match(attr) || []).length;
        if (n) offenders.push(`${f}: ${n} title attribute${n === 1 ? '' : 's'}`);
    }
    for (const f of JS) {
        const src = strip(read(f));
        const n = (src.match(attr) || []).length;
        if (n) offenders.push(`${f}: ${n} title="…" in emitted markup`);
        for (const m of src.matchAll(/(\b[A-Za-z_$][\w$]*)\.title\s*=(?!=)/g)) {
            if (m[1] === 'document') continue;   // the tab, not a tooltip
            offenders.push(`${f}: ${m[0].trim()} — sets a tooltip on an element`);
        }
        for (const m of src.matchAll(/setAttribute\(\s*['"]title['"]/g)) {
            offenders.push(`${f}: ${m[0]} — sets a tooltip on an element`);
        }
    }
    assert.deepEqual(offenders, [],
        'a `title` attribute is an OS tooltip — invisible on every phone. Put the words in the row, '
        + 'the `?` panel or the accessible name (DECISIONS.md → Tooltips)');
});

// ── 2. no accent-color ──────────────────────────────────────────────────────────────────────────
test('no stylesheet tints an OS-drawn control with accent-color', () => {
    const offenders = CSS.filter(f => /accent-color\s*:/.test(strip(read(f))));
    assert.deepEqual(offenders, [], 'the checkbox and radio are drawn in shared.css; recolour with --check-fill');
});

// ── 3 + 4. one recipe, and the recipe exists ────────────────────────────────────────────────────
/** The class handles the markup gives its checkboxes and radios — the input's own class, and the
 *  class of the element wrapping it — read from every page and every module that emits one. */
function checkboxHandles() {
    const own = new Set(), wrap = new Set();
    for (const f of [...HTML, ...JS]) {
        const src = read(f);
        for (const m of src.matchAll(/<input\b[^>]*type="(?:checkbox|radio)"[^>]*>/g)) {
            const cls = m[0].match(/\bclass="([^"]+)"/);
            if (cls) for (const c of cls[1].split(/\s+/)) own.add(c);
            const before = src.slice(Math.max(0, m.index - 240), m.index);
            const w = [...before.matchAll(/<(?:label|div|span|td|li)\b[^>]*\bclass="([^"]+)"/g)].pop();
            if (w) for (const c of w[1].split(/\s+/)) wrap.add(c);
        }
    }
    return { own, wrap };
}

test('no page sets a checkbox or radio\'s size or colour — one recipe, in shared.css', () => {
    const { own, wrap } = checkboxHandles();
    const offenders = [];
    for (const f of CSS) {
        if (f === 'shared.css') continue;
        for (const m of strip(read(f)).matchAll(/([^{}]+)\{([^}]*)\}/g)) {
            const body = m[2];
            // `.gen-obj:has(input:checked)` styles the ROW the box sits in — its background is the
            // row's. Only a selector that reaches the input itself is about the box.
            const sel = m[1].trim().replace(/\s+/g, ' ').replace(/:has\([^)]*\)/g, '');
            const aboutABox = /input\[type="?(?:checkbox|radio)"?\]/.test(sel)
                || [...own].some(c => new RegExp(`\\.${c}(?![\\w-])`).test(sel))
                || [...wrap].some(c => new RegExp(`\\.${c}(?![\\w-])[^,]*\\binput\\b`).test(sel));
            if (!aboutABox) continue;
            const bad = ['width', 'height', 'accent-color', 'background-color', 'border-radius']
                .filter(p => new RegExp(`(^|[\\s;])${p}\\s*:`).test(body));
            if (bad.length) offenders.push(`${f}: \`${sel}\` sets ${bad.join(', ')}`);
        }
    }
    assert.deepEqual(offenders, [],
        'the box is shared.css\'s (20px, 22 coarse). Recolour with `--check-fill`; do not restate the recipe');
});

test('shared.css draws the checkbox and the radio', () => {
    const src = strip(read('shared.css'));
    const rule = [...src.matchAll(/([^{}]+)\{([^}]*)\}/g)].find(m =>
        /input\[type="checkbox"\]/.test(m[1]) && /input\[type="radio"\]/.test(m[1])
        && /(^|[\s;])appearance\s*:\s*none/.test(m[2]));
    assert.ok(rule, 'shared.css must carry `appearance: none` for both input[type="checkbox"] and input[type="radio"]');
    assert.match(src, /input\[type="checkbox"\]\[hidden\]/, 'the recipe sets display, so `[hidden]` must be restated (page-visibility-parity)');
    assert.match(src, /print-color-adjust:\s*exact/, 'the checked fill is a background — it must survive printing');
});

// ── 5. no resize grip ───────────────────────────────────────────────────────────────────────────
test('no stylesheet lets the OS draw a textarea resize grip', () => {
    const offenders = [];
    for (const f of CSS) {
        for (const m of strip(read(f)).matchAll(/resize\s*:\s*(vertical|horizontal|both)/g)) offenders.push(`${f}: resize: ${m[1]}`);
    }
    assert.deepEqual(offenders, [], 'a textarea grows with its content (`field-sizing: content`); the grip is the platform\'s');
});

// ── 6. no time input ────────────────────────────────────────────────────────────────────────────
test('no <input type="time"> is served', () => {
    const offenders = [];
    for (const f of [...HTML, ...JS]) {
        const n = (strip(read(f)).match(/type=["']time["']/g) || []).length;
        if (n) offenders.push(`${f}: ${n}`);
    }
    assert.deepEqual(offenders, [], 'the OS time widget renders 12-hour from the device setting (roster-entry-control.js) — use a text field');
});

// ── 7. no native dialog ─────────────────────────────────────────────────────────────────────────
test('no module opens a native alert, confirm or prompt', () => {
    const offenders = [];
    for (const f of JS) {
        // No whitespace before the paren: `confirm (` is how the countdown button's PROSE reads
        // ("Tap again to confirm (3)"), and this app never writes a call that way.
        for (const m of strip(read(f)).matchAll(/(?<![\w.$'"\`])(alert|confirm|prompt)\(/g)) offenders.push(`${f}: ${m[1]}(`);
    }
    assert.deepEqual(offenders, [], 'use confirmDialog / promptDialog from overlay.js');
});

// ── 8. element-styled inputs exclude the drawn controls ─────────────────────────────────────────
test('a rule that styles bare `input` by element excludes the checkbox and radio', () => {
    const SKIN = /(?:^|[\s;{])(?:width|height|min-height|min-width|padding|border|border-radius|background|background-color|font-size|box-shadow)\s*:/;
    // A bare `input` token: not `input[type=…]`, not `input.class`, not inside `:has(…)` (a row rule).
    const BARE = /(?<![\w\[.#-])input(?![\w\[.#-])/;
    const offenders = [];
    for (const f of CSS) {
        if (f.includes('guide')) continue;   // the guides carry no form controls the app draws
        for (const m of strip(read(f)).matchAll(/([^{}]+)\{([^}]*)\}/g)) {
            const sel = m[1].trim().replace(/\s+/g, ' ').replace(/:has\([^)]*\)/g, '');
            if (!BARE.test(sel) || !SKIN.test(m[2])) continue;
            if (/input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\)/.test(sel)) continue;
            offenders.push(`${f}: \`${sel.slice(0, 90)}\``);
        }
    }
    assert.deepEqual(offenders, [],
        'write it as `input:not([type="checkbox"]):not([type="radio"])` — an element selector reaches the '
        + 'app-drawn box and out-specifies or ties the recipe (paycalc\'s `.field input` did exactly that)');
});

// ── 9. the password field's own OS buttons ──────────────────────────────────────────────────────
test('the OS password reveal and credentials buttons are suppressed', () => {
    const shared = strip(read('shared.css'));
    const missing = [];
    for (const sel of ['::-ms-reveal', '::-ms-clear', '::-webkit-credentials-auto-fill-button', '::-webkit-contacts-auto-fill-button']) {
        if (!shared.includes(sel)) missing.push(sel);
    }
    assert.deepEqual(missing, [],
        'Edge and Safari draw their own button in the corner `.login-pw-toggle` already occupies');
    // The strong-password button is a platform FEATURE, not a duplicate of anything the app draws.
    // Suppressing it would take away a keychain password and offer nothing back — that is the line
    // v23.50 drew, and this asserts the line rather than trusting the comment beside it.
    assert.ok(!shared.includes('::-webkit-strong-password-auto-fill-button'),
        'leave Safari\'s strong-password offer alone — the app draws no alternative to it');
});

// ── 10. autofill may not repaint the field, and may not eat the focus ring ───────────────────────
test('autofill is pinned to --field-bg, and its focus state keeps the ring', () => {
    const shared = strip(read('shared.css'));
    const rules = [...shared.matchAll(/([^{}]*:-webkit-autofill[^{}]*)\{([^}]*)\}/g)];
    assert.ok(rules.length >= 2, 'expected a resting autofill rule and a focus-visible one');

    const resting = rules.find(r => !r[1].includes(':focus-visible'));
    assert.ok(resting && /-webkit-box-shadow[^;]*inset[^;]*var\(--field-bg\)/.test(resting[2]),
        'the resting fill must be an inset shadow pinned to --field-bg — the UA background is !important, so nothing else covers it');
    assert.ok(/!important/.test(resting[2]), 'the UA autofill background is itself !important');

    const focused = rules.find(r => r[1].includes(':focus-visible'));
    assert.ok(focused, 'an autofilled field can be focused; that state needs its own rule');
    assert.ok(/var\(--focus-ring\)/.test(focused[2]),
        'the focus shadow must RESTATE --focus-ring — otherwise covering the yellow removes the focus indicator, '
        + 'which is the app\'s only invisible design system (focus-ring-parity.test.mjs)');
});

// ── 11. selection, placeholder and caret — in both stylesheets that need them ────────────────────
test('::selection, ::placeholder and caret-color are declared for the app AND the guides', () => {
    // The guides deliberately load no app stylesheet, so shared.css reaches 7 of the 12 served
    // pages. Both files, or the other five keep the platform's colours.
    const missing = [];
    for (const f of ['shared.css', 'guide-shell.css']) {
        const css = strip(read(f));
        for (const decl of ['::selection', '::placeholder', 'caret-color']) {
            if (!css.includes(decl)) missing.push(`${f}: ${decl}`);
        }
    }
    assert.deepEqual(missing, [], 'a rule added only to shared.css misses every guide page');

    // ::selection sets a background and NOT a colour: one rule serves the light cards and the navy
    // drawer, and naming a text colour would force one of the two to be unreadable.
    for (const f of ['shared.css', 'guide-shell.css']) {
        const m = strip(read(f)).match(/::selection\s*\{([^}]*)\}/);
        assert.ok(m, `${f}: no ::selection rule`);
        assert.ok(!/(?:^|[\s;])color\s*:/.test(m[1]),
            `${f}: ::selection must not set \`color\` — the selected text keeps its own, which is what lets one tint serve both surface families`);
    }
});

// ── 12. no dictionary underlines on data ────────────────────────────────────────────────────────
test('every served page turns spellcheck off at the body', () => {
    // The two legacy redirect stubs (v22.48) carry no fields at all — they are a <meta refresh>
    // and a link. page-contract-parity gives them their own contract for the same reason.
    const LEGACY = ['guide.html', 'fip.html'];
    const offenders = [];
    for (const f of HTML) {
        if (LEGACY.includes(f)) continue;
        const body = read(f).match(/<body[^>]*>/);
        if (!body) { offenders.push(`${f}: no <body>`); continue; }
        if (!/spellcheck\s*=\s*["']false["']/.test(body[0])) offenders.push(`${f}: ${body[0]}`);
    }
    assert.deepEqual(offenders, [],
        'nothing here takes prose — hours, times, rates, money, a tax code, names, an address. '
        + 'On <body> it inherits, so a field built in JS is covered without an attribute of its own');
});
