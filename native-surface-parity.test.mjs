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
 * 13. **Having taken the drawing over, the app honours the user's THEME.** This is the counterpart
 *     to every contract above: the OS draws nothing here, so under `forced-colors: active` nothing
 *     is left to state the checked state in the user's own palette unless we do. Measured before
 *     it was written (v23.67, external review) — the checked fill and the tick's `::before` are
 *     both backgrounds, so the UA forced both to `Canvas` and a checked box and an unchecked one
 *     painted with the SAME colours in the SAME pixel counts. Not low contrast: no state at all,
 *     on all 25 of these controls. The block is pinned here for its SHAPE — system colours only,
 *     the `Highlight`/`HighlightText` pair, `opacity: 1` (opacity is not forced, so the disabled
 *     rule's 0.55 would mute the person who asked for contrast), `forced-color-adjust: none` and
 *     the `box-shadow: none` that goes with it. **This file is where four of those five are
 *     actually caught**: the e2e next door proves the PAINTING and so only fails on the defect
 *     itself — a tick drawn in the fill colour, or the block deleted — while the declarations
 *     that make the fix robust rather than merely working are shape, and shape is read here.
 *     Teeth-verified five ways, each mutation confirmed applied before the run.
 *
 * 14. **A CHOSEN control states itself in the theme too, and EVERY forced-colours block is the
 *     theme's** (v25.21). Contract 13 read the FIRST such block in shared.css, so a block anywhere
 *     else could carry a brand token unread. Every chosen fill in the app is a background, which the
 *     theme repaints as Canvas, so until v25.21 a chosen tab, chip or date painted like the ones
 *     beside it; Trains and New link each carried a border rule of their own, and Trains' lost to a
 *     later rule on its in-card tabs. The fix is ONE outline in `Highlight` in shared.css, read off
 *     the aria states — so this checks it is there, covers every state, and is not restated by a
 *     page. `e2e/forced-colors.spec.js` proves the painting on real controls.
 *
 * 15. **No `<input type="date">` is left to the OS** (test audit, 7 Nov 2026). The rule had lived in
 *     `date-picker.js`'s header since v23.37 with nothing behind it: every date input is either in
 *     an `initDatePickers([...])` list or a value holder nobody can reach. Contract 5 gained its
 *     other half the same day — each textarea must be REACHED by a `resize: none`, because the
 *     default is a grip — and contracts 1, 6 and 7 their second spellings (`title='…'`,
 *     `input.type = 'time'`, `window.confirm(`).
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
    // carries no `="`. Either quote (test audit, 7 Nov 2026): `title='Close'` is the same tooltip,
    // and passed. `.`/`$` before it is a property, which the `.title =` rule below reads.
    const attr = /(?<![-\w.$])title=["']/g;
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

/** The rules in one stylesheet that restate the box's size or colour, given the derived handles.
 *  @param {string} css @param {Set<string>} own @param {Set<string>} wrap */
function boxRestatements(css, own, wrap) {
    const offenders = [];
    for (const m of strip(css).matchAll(/([^{}]+)\{([^}]*)\}/g)) {
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
        if (bad.length) offenders.push(`\`${sel}\` sets ${bad.join(', ')}`);
    }
    return offenders;
}

test('no page sets a checkbox or radio\'s size or colour — one recipe, in shared.css', () => {
    const { own, wrap } = checkboxHandles();
    const offenders = [];
    for (const f of CSS) {
        if (f === 'shared.css') continue;
        for (const o of boxRestatements(read(f), own, wrap)) offenders.push(`${f}: ${o}`);
    }
    assert.deepEqual(offenders, [],
        'the box is shared.css\'s (20px, 22 coarse). Recolour with `--check-fill`; do not restate the recipe');
});

test('the checkbox scan finds the boxes it checks — guard the guard', () => {
    // Contract 3 passes on handle sets that came back EMPTY (test audit, 7 Nov 2026): the derived
    // half is what reaches a box by its own class or its row's, so a markup regex that stopped
    // matching would leave only the `input[type=…]` selectors checked, and still read as clean.
    const { own, wrap } = checkboxHandles();
    // 6 and 14 on 7 Nov 2026 (`.day-cb`, `.gen-obj`, `.bp-mode-opt` …); a floor well under both.
    assert.ok(own.size >= 3, `only ${own.size} checkbox/radio classes derived from the markup — the scan is wrong`);
    assert.ok(wrap.size >= 5, `only ${wrap.size} wrapping rows derived from the markup — the scan is wrong`);
    assert.equal(boxRestatements('.gen-obj input { width: 18px; }', own, wrap).length, 1, 'a row\'s box resized');
    assert.equal(boxRestatements('.day-cb { accent-color: red; }', own, wrap).length, 1, 'a box recoloured by its own class');
    assert.equal(boxRestatements('.gen-obj:has(input:checked) { background-color: white; }', own, wrap).length, 0,
        'the ROW\'s background is the row\'s');
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

// ── 13. the forced-colours contract ─────────────────────────────────────────────────────────────
test('the checkbox/radio recipe states itself in the user\'s forced-colours palette', () => {
    const src = strip(read('shared.css'));
    const at = src.indexOf('@media (forced-colors: active)');
    assert.notEqual(at, -1, 'shared.css must carry a @media (forced-colors: active) block for the drawn controls');

    // Brace-match the block: it contains nested rules, so a lazy regex would stop at the first `}`.
    let i = src.indexOf('{', at), depth = 0, end = -1;
    for (let j = i; j < src.length; j++) {
        if (src[j] === '{') depth++;
        else if (src[j] === '}' && --depth === 0) { end = j; break; }
    }
    assert.notEqual(end, -1, 'the forced-colors block is unclosed');
    const block = src.slice(i + 1, end);

    assert.match(block, /input\[type="checkbox"\]/, 'the block must cover the checkbox');
    assert.match(block, /input\[type="radio"\]/,    'the block must cover the radio');

    // Every colour in it is a SYSTEM colour. A var() would resolve to a brand colour and a literal
    // would ignore the theme — either way the user's own palette is not what gets painted.
    const SYSTEM = /^(Canvas|CanvasText|Highlight|HighlightText|GrayText|ButtonFace|ButtonText|LinkText|Field|FieldText|currentColor|none|transparent|inherit)$/;
    for (const m of block.matchAll(/(?:^|[\s;{])(background-color|border-color|color|outline-color)\s*:\s*([^;}]+)/g)) {
        const value = m[2].trim();
        assert.ok(SYSTEM.test(value), `\`${m[1]}: ${value}\` is not a system colour — under forced colours it cannot honour the reader's theme`);
    }
    for (const m of block.matchAll(/(?:^|[\s;{])outline\s*:\s*([^;}]+)/g)) {
        const last = m[1].trim().split(/\s+/).pop() || '';
        assert.ok(SYSTEM.test(last), `\`outline: ${m[1].trim()}\` must end in a system colour`);
    }
    assert.doesNotMatch(block, /var\(--/, 'a brand token inside the forced-colors block defeats the whole point of it');

    // The five declarations that carry the fix. Each is load-bearing for a reason the header gives.
    assert.match(block, /forced-color-adjust:\s*none/,  'without this the UA substitutes our system colours too, and the state vanishes again');
    assert.match(block, /background-color:\s*Highlight\b/,   'the checked fill must be Highlight');
    assert.match(block, /background-color:\s*HighlightText\b/, 'the tick must be HighlightText — the pair guaranteed to contrast in every theme');
    assert.match(block, /opacity:\s*1\b/,               'opacity is NOT forced, so the disabled 0.55 must be reset or it mutes a high-contrast theme');
    assert.match(block, /box-shadow:\s*none/,           'box-shadow is normally forced away; the opt-out restores the brand ring unless it is removed');
});

// ── 14. a chosen control is ringed in the theme's Highlight, and every block is the theme's ─────
test('every forced-colours block uses the theme\'s colours, and shared.css rings a chosen control in Highlight', () => {
    /** The body of every `@media (forced-colors: active)` block in a stylesheet. @param {string} src */
    const blocks = src => {
        const out = [];
        for (let at = src.indexOf('@media (forced-colors: active)'); at !== -1; at = src.indexOf('@media (forced-colors: active)', at + 1)) {
            let i = src.indexOf('{', at), depth = 0;
            for (let j = i; j < src.length; j++) {
                if (src[j] === '{') depth++;
                else if (src[j] === '}' && --depth === 0) { out.push(src.slice(i + 1, j)); break; }
            }
        }
        return out;
    };
    const SYSTEM = /^(Canvas|CanvasText|Highlight|HighlightText|GrayText|ButtonFace|ButtonText|ButtonBorder|LinkText|Field|FieldText|SelectedItem|SelectedItemText|Mark|MarkText|AccentColor|AccentColorText|currentColor|none|transparent|inherit)$/;
    const offenders = [], restated = [];
    for (const f of CSS) {
        for (const block of blocks(strip(read(f)))) {
            if (/var\(--/.test(block)) offenders.push(`${f}: a brand token`);
            for (const m of block.matchAll(/(?:^|[\s;{])(background-color|background|border-color|color|outline-color|fill|stroke)\s*:\s*([^;}]+)/g)) {
                if (!SYSTEM.test(m[2].trim())) offenders.push(`${f}: \`${m[1]}: ${m[2].trim()}\``);
            }
            for (const m of block.matchAll(/(?:^|[\s;{])(outline|border(?:-(?:top|right|bottom|left))?)\s*:\s*([^;}]+)/g)) {
                const last = m[2].trim().split(/\s+/).pop() || '';
                if (!SYSTEM.test(last) && !/^(0|none)$/.test(m[2].trim())) offenders.push(`${f}: \`${m[1]}: ${m[2].trim()}\` does not end in a system colour`);
            }
            if (f !== 'shared.css' && /\[aria-(?:pressed|selected|checked|current)=/.test(block)) restated.push(f);
        }
    }
    assert.deepEqual(offenders, [], 'under forced colours only the reader\'s own palette may be painted');
    assert.deepEqual(restated, [],
        'a page restates the chosen-control rule in its own forced-colours block — shared.css states it for every page, '
        + 'and a page\'s copy is the shape that lost to a later rule on Trains');

    const shared = blocks(strip(read('shared.css'))).join('\n');
    const ring = /([^{}]+)\{[^{}]*outline:\s*2px\s+solid\s+Highlight\b[^{}]*\}/.exec(shared);
    assert.ok(ring, 'shared.css must ring a chosen control in Highlight under forced colours');
    for (const state of ['aria-pressed="true"', 'aria-selected="true"', 'aria-checked="true"', 'aria-current="true"', 'aria-current="page"']) {
        assert.ok(ring[1].includes(state), `the chosen-control ring must cover [${state}]`);
    }
    // Only pressable things — a day row marked `.active` is not a choice.
    assert.match(ring[1], /:is\(button,\s*a,\s*\[role="button"\]/, 'the ring is for things a reader can press');

    // …and a chosen control that takes keyboard focus still SHOWS it (whole-app review, Nov 2026). The ring above
    // out-ranks the app's focus fallback and the theme removes every box-shadow, so focus needs a rule of its own,
    // in the theme's colours, covering the same states. That it paints is e2e/forced-colors.spec.js's to prove.
    const focus = /([^{}]*:focus-visible[^{}]*)\{[^{}]*outline:[^;}]*\bHighlight\b[^{}]*\}/.exec(shared);
    assert.ok(focus, 'under forced colours a chosen control that takes keyboard focus must still show it — the chosen ring hides the fallback');
    for (const state of ['aria-pressed="true"', 'aria-selected="true"', 'aria-checked="true"', 'aria-current="true"', 'aria-current="page"']) {
        assert.ok(focus[1].includes(state), `the focus rule for a chosen control must cover [${state}], as the ring does`);
    }
});

// ── 5. no resize grip ───────────────────────────────────────────────────────────────────────────
test('no stylesheet lets the OS draw a textarea resize grip', () => {
    const offenders = [];
    for (const f of CSS) {
        // `block` and `inline` are the logical spellings of `vertical`/`horizontal`, and passed until
        // the test audit (7 Nov 2026). `none` is the only value that draws no grip.
        for (const m of strip(read(f)).matchAll(/resize\s*:\s*(vertical|horizontal|both|block|inline)/g)) offenders.push(`${f}: resize: ${m[1]}`);
    }
    assert.deepEqual(offenders, [], 'a textarea grows with its content (`field-sizing: content`); the grip is the platform\'s');
});

test('every textarea the app ships has a `resize: none` rule that reaches it', () => {
    // A textarea's DEFAULT is a grip, so forbidding the values above was half the rule: deleting
    // `.li-paste`'s `resize: none` put the browser's grip back and passed (test audit, 7 Nov 2026).
    // Each textarea is found in the markup and named by its class or id, as contract 3 finds boxes.
    const handles = [];
    for (const f of [...HTML, ...JS]) {
        for (const m of strip(read(f)).replace(/<!--[\s\S]*?-->/g, '').matchAll(/<textarea\b[^>]*>/g)) {
            const id = m[0].match(/\bid=["']([^"']+)["']/)?.[1] ?? '';
            const classes = m[0].match(/\bclass=["']([^"']+)["']/)?.[1].split(/\s+/) ?? [];
            handles.push({ where: `${f}: ${m[0].slice(0, 60)}`, id, classes });
        }
        if (/createElement\(\s*['"]textarea['"]/.test(strip(read(f)))) {
            handles.push({ where: `${f}: createElement('textarea') — name it in markup, or teach this scan`, id: '', classes: [] });
        }
    }
    const none = CSS.flatMap(f => [...strip(read(f)).matchAll(/([^{}]+)\{([^}]*)\}/g)]
        .filter(m => /(^|[\s;])resize\s*:\s*none\b/.test(m[2]))
        .map(m => m[1].trim().replace(/\s+/g, ' ')));
    const reaches = (/** @type {{id: string, classes: string[]}} */ h) => none.some(sel =>
        /(?<![\w-])textarea(?![\w-])/.test(sel)
        || (h.id && new RegExp(`#${h.id}(?![\\w-])`).test(sel))
        || h.classes.some(c => new RegExp(`\\.${c}(?![\\w-])`).test(sel)));
    assert.ok(handles.length >= 1, 'no textarea found — the markup scan is wrong');   // three on 7 Nov 2026
    assert.deepEqual(handles.filter(h => !reaches(h)).map(h => h.where), [],
        'these textareas keep the OS resize grip: give each a `resize: none` rule (see .li-paste in links.css)');
});

// ── 6. no time input ────────────────────────────────────────────────────────────────────────────
test('no <input type="time"> is served', () => {
    const offenders = [];
    for (const f of [...HTML, ...JS]) {
        const src = strip(read(f));
        const n = (src.match(/type=["']time["']/g) || []).length;
        if (n) offenders.push(`${f}: ${n}`);
        // …nor one made in code (test audit, 7 Nov 2026): `input.type = 'time'` built the same OS
        // widget and passed, because only the markup spelling was read.
        for (const m of src.matchAll(/\.type\s*=\s*['"`]time['"`]|setAttribute\(\s*['"]type['"]\s*,\s*['"]time['"]/g)) {
            offenders.push(`${f}: ${m[0]}`);
        }
    }
    assert.deepEqual(offenders, [], 'the OS time widget renders 12-hour from the device setting (roster-entry-control.js) — use a text field');
});

// ── 15. no date input the OS draws ──────────────────────────────────────────────────────────────
test('every <input type="date"> is enhanced by date-picker.js, or a value holder nobody can reach', () => {
    // NOTHING GUARDED THIS (test audit, 7 Nov 2026): dropping 'rosterWeekEnding' from Operations'
    // `initDatePickers` list handed that field back to the OS calendar and both lanes stayed green —
    // the e2e sets it through `evaluate`, and only the circular date's trigger is ever looked at.
    // The same scan as contract 2 of select-sheet-parity: every date input is ENHANCED (its id is in
    // an `initDatePickers([...])` list) or is a VALUE HOLDER — `hidden`, or the `fieldpick-native`
    // 1px holder behind a picker the app opens itself (`openDatePicker`), with `tabindex="-1"` and
    // `aria-hidden`.
    const enhanced = new Set();
    for (const f of JS) {
        for (const m of strip(read(f)).matchAll(/\binitDatePickers\(\s*\[([^\]]*)\]/g)) {
            for (const id of m[1].matchAll(/['"]([^'"]+)['"]/g)) enhanced.add(id[1]);
        }
    }
    const found = [], offenders = [];
    for (const f of [...HTML, ...JS]) {
        const src = strip(read(f)).replace(/<!--[\s\S]*?-->/g, '');
        for (const m of src.matchAll(/<input\b[^>]*\btype=["']date["'][^>]*>/g)) {
            const tag = m[0];
            const id = tag.match(/\bid=["']([^"']+)["']/)?.[1] ?? '';
            found.push(id);
            if (id && enhanced.has(id)) continue;
            if (/(?<![-\w])hidden(?![-\w])/.test(tag)) continue;
            if (/\bclass=["'][^"']*\bfieldpick-native\b/.test(tag) && /\btabindex=["']-1["']/.test(tag)
                && /\baria-hidden=["']true["']/.test(tag)) continue;
            offenders.push(`${f}: ${tag}`);
        }
        for (const m of src.matchAll(/\.type\s*=\s*['"`]date['"`]|setAttribute\(\s*['"]type['"]\s*,\s*['"]date['"]/g)) {
            offenders.push(`${f}: ${m[0]} — a date input built in code; name it in markup, or teach this scan`);
        }
    }
    // Ten date inputs and four enhanced ids on 7 Nov 2026; floors under both.
    assert.ok(found.length >= 6 && enhanced.size >= 2,
        `found ${found.length} date inputs and ${enhanced.size} enhanced ids — the scan is wrong`);
    assert.deepEqual(offenders, [],
        'these date inputs open the OS calendar — add the id to an initDatePickers([...]) list, or make it '
        + 'a hidden value holder behind openDatePicker (date-picker.js)');
});

// ── 7. no native dialog ─────────────────────────────────────────────────────────────────────────
test('no module opens a native alert, confirm or prompt', () => {
    const offenders = [];
    for (const f of JS) {
        // No whitespace before the paren: `confirm (` is how the countdown button's PROSE reads
        // ("Tap again to confirm (3)"), and this app never writes a call that way.
        const src = strip(read(f));
        for (const m of src.matchAll(/(?<![\w.$'"`])(alert|confirm|prompt)\(/g)) offenders.push(`${f}: ${m[1]}(`);
        // The lookbehind refuses ANY `.` before the name, which is what spares `deferred.prompt()` —
        // and it spared `window.confirm(` too, the same OS dialog (test audit, 7 Nov 2026). The global
        // object's names are read on their own.
        for (const m of src.matchAll(/\b(?:window|globalThis|self|top|parent)\s*\.\s*(alert|confirm|prompt)\s*\(/g)) offenders.push(`${f}: ${m[0]}`);
    }
    assert.deepEqual(offenders, [], 'use confirmDialog / promptDialog from overlay.js');
});

// ── 8. element-styled inputs exclude the drawn controls ─────────────────────────────────────────
test('a rule that styles bare `input` by element excludes the checkbox and radio', () => {
    const SKIN = /(?:^|[\s;{])(?:width|height|min-height|min-width|padding|border|border-radius|background|background-color|font-size|box-shadow)\s*:/;
    // A bare `input` token: not `input[type=…]`, not `input.class`, not inside `:has(…)` (a row rule).
    const BARE = /(?<![\w[.#-])input(?![\w[.#-])/;
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
