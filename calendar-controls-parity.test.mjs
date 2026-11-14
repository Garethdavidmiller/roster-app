// @ts-check
// calendar-controls-parity.test.mjs — the calendar's control rows have lost a rule to SOURCE ORDER
// three releases running (v22.83, v22.84 twice), and each time the file's own comment warning
// about it was the thing being ignored. The mechanism is always the same: a later rule at equal
// specificity, usually in a media block, silently beats an earlier modifier, and nothing throws.
// No behavioural test can see it — the row renders, every control is present, only the pixels
// move — and a screenshot only catches the widths it happens to be taken at.
//
// So the rules that make the trap impossible are pinned STATICALLY, on the stylesheet's text:
//   1. a control-group modifier is always written `.controls .control-group--…` (specificity 0,2,0,
//      with any further prefix such as `html[data-text-scale]` welcome in FRONT of it), so no bare
//      `.control-group` rule can outrank it;
//   2. no rule declares `gap` on a control group at all — the base rule reads `--cg-gap` and every
//      breakpoint and modifier SETS the variable, which cascades per property and so cannot be
//      lost to a later rule for a different selector;
//   3. the member select never carries a `max-width` under its group: `max-width: 100%` against a
//      shrink-to-fit parent is the cyclic case, Chromium resolves it as `none`, and the select grew
//      past its 200px cap on the desktop (v22.84's first cut);
//   4. the month heading row keeps `flex-wrap: wrap`, the net that stops "September 2026" splitting
//      on the commonest Android width and under text scaling no width query can see;
//   5. every control on the page's navy surfaces names the gold or light focus ring, never leaving
//      the navy fallback to draw on navy;
//   6. the today pulse's literal gold is still --accent-gold's value.
//
// And, beyond the control rows, the scales css-tokens.md states, each found off them in index.css by
// the whole-app review (10 Nov 2026) — this is the stylesheet's only static test, so they live here:
//   7. every transition takes its times and curves from the motion tokens;
//   8. every overlay panel wears a dialog's or a glass sheet's corner, never the card's — and nothing
//      that is not a panel wears a dialog's;
//   9. Team View's arrows wear the month view's button corner;
//  10. no literal z-index reaches the overlay bands — those are the --z-* scale;
//  11. every screen breakpoint that restates the body's padding keeps the safe-area insets;
//  12. the Huddle's pinned column is the viewer's own white;
//  13. Team View's grade tabs and the leave panel's two links wear the button corner, not a pill's;
//  14. the month heading's mark is the app's chevron, and no generated content draws a picker glyph.
//
// Comments are stripped before matching, so a rule can't hide inside one — or be invented by one.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');

/** Every `selector { body }` pair in the sheet, media blocks flattened. */
function rules(/** @type {string} */ text) {
    const out = [];
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let m;
    while ((m = re.exec(text))) {
        const selector = m[1].trim().split('\n').pop()?.trim() ?? '';
        if (selector.startsWith('@')) continue;
        out.push({ selector, body: m[2] });
    }
    return out;
}
const RULES = rules(css);

test('1. every control-group MODIFIER is written under `.controls`, so no bare rule can outrank it', () => {
    const offenders = RULES
        .filter(r => /\.control-group--/.test(r.selector))
        .flatMap(r => r.selector.split(',').map(s => s.trim()))
        .filter(s => /\.control-group--/.test(s) && !/(^|\s)\.controls \.control-group--/.test(s));
    assert.deepEqual(offenders, [], `unprefixed modifier rule(s): ${offenders.join(' | ')}`);
});

test('2. no rule declares `gap` on a control group — it is `--cg-gap`, set, never `gap`, declared', () => {
    const groupRules = RULES.filter(r => /(^|[\s,])\.control-group(--[\w-]+)?\s*$/.test(r.selector)
        || /^\.controls \.control-group(--[\w-]+)?$/.test(r.selector));
    assert.ok(groupRules.length >= 3, 'the base rule and the modifiers are all present');
    const base = groupRules.find(r => r.selector === '.control-group');
    assert.ok(base, 'the base .control-group rule exists');
    assert.match(base.body, /gap:\s*var\(--cg-gap\)/, 'the base rule reads the variable');
    const declared = groupRules.filter(r => /(^|[\s;])gap\s*:/.test(r.body) && !/gap:\s*var\(--cg-gap\)/.test(r.body));
    assert.deepEqual(declared.map(r => r.selector), [],
        'a rule declared `gap` on a control group — set `--cg-gap` instead');
});

test('3. the member select carries no max-width under its group (the cyclic-percentage case)', () => {
    const offenders = RULES.filter(r => /control-group--stacked\s+select/.test(r.selector) && /max-width/.test(r.body));
    assert.deepEqual(offenders.map(r => r.selector), []);
});

test('4. the month heading row wraps — the net for the longest month name and for text scaling', () => {
    const header = RULES.find(r => r.selector === '.calendar-header');
    assert.ok(header, 'the base .calendar-header rule exists');
    assert.match(header.body, /flex-wrap:\s*wrap/);
});

// The app-wide fallback ring is NAVY, so a control on the Calendar's navy glass with no rule of its own
// is a Tab stop with no visible indicator: the leave panel's two links were, measured at 1.0–1.8:1
// (whole-app review, Nov 2026). shared.css's navy controls are focus-ring-parity.test.mjs's; these are
// the page's. This names the rule; e2e/calendar.spec.js proves the cascade lets it win.
test('5. every control on the Calendar\'s navy surfaces names a ring drawn for a dark one', () => {
    const ON_NAVY = ['.title-icon:focus-visible', '.top-prompt-action:focus-visible', '.top-prompt-dismiss:focus-visible',
        '#dayDetailClose:focus-visible', '#alLightboxClose:focus-visible', '#teamInfoClose:focus-visible',
        '#huddleViewerClose:focus-visible', '.day-detail-pay-btn:focus-visible', '.day-detail-leave-btn:focus-visible',
        '.al-lb-yearbtn:focus-visible', '.al-lb-link:focus-visible'];
    /** @type {Record<string, string>} */ const ring = {};
    for (const m of css.matchAll(/([^{}]*:focus-visible[^{}]*)\{([^}]*)\}/g)) {
        const outline = /(?:^|[\s;])outline:\s*([^;]+)/.exec(m[2])?.[1].trim();
        if (!outline) continue;
        for (const s of m[1].trim().replace(/\s+/g, ' ').split(',')) ring[s.trim()] = outline;
    }
    const wrong = ON_NAVY.filter(s => !/^var\(--focus-outline-(?:gold|light)\)$/.test(ring[s] ?? ''))
        .map(s => `${s} → ${ring[s] ?? 'no rule: the navy fallback'}`);
    assert.deepEqual(wrong, [], 'a control on navy needs --focus-outline-gold or --focus-outline-light');
});

// The today pulse animates the gold's ALPHA, so it carries the token's channels as a literal (index.css
// says why it is not forwarded). A restated copy drifts from the token it mirrors (css-tokens.md); this
// is the line that notices.
test('6. the today pulse\'s gold is --accent-gold\'s own value, restated exactly', () => {
    const shared = readFileSync(new URL('./shared.css', import.meta.url), 'utf8');
    const token = /--accent-gold:\s*oklch\(([^)]+)\)/.exec(shared)?.[1].trim();
    const pulse = RULES.find(r => r.selector === '.calendar-day.today.today-pulse');
    assert.ok(token && pulse, 'the token and the pulse rule are both found');
    const copy = /oklch\(([^/)]+)\/\s*var\(--today-glow-alpha\)\)/.exec(pulse.body)?.[1].trim();
    assert.equal(copy, token, 'the pulse restates a gold that is no longer --accent-gold');
});

// ── THE SCALES (whole-app review, 10 Nov 2026) ───────────────────────────────────────────────────────

/**
 * Every style rule with the at-rules it sits inside, outermost first, its selector list whole. `rules()`
 * above flattens media blocks, which is right for 1–6 and wrong where the CONTEXT is the point (a print
 * block, a hover gate).
 */
function nestedRules(/** @type {string} */ text) {
    /** @type {{ selector: string, body: string, at: string[] }[]} */ const out = [];
    /** @type {string[]} */ const open = [];
    let start = 0;
    for (let i = 0; i < text.length; i++) {
        if (text[i] === '}') { open.pop(); start = i + 1; continue; }
        if (text[i] !== '{') continue;
        const prelude = text.slice(start, i).trim();
        start = i + 1;
        if (prelude.startsWith('@')) { open.push(prelude); continue; }
        const end = text.indexOf('}', i);
        out.push({ selector: prelude.replace(/\s+/g, ' '), body: text.slice(i + 1, end), at: [...open] });
        i = end;
        start = end + 1;
    }
    return out;
}
const NESTED = nestedRules(css).filter(r => !r.at.some(a => a.startsWith('@keyframes')));
/** One declared value, or undefined. */
const declared = (/** @type {string} */ body, /** @type {string} */ prop) =>
    new RegExp(`(?:^|[\\s;])${prop}\\s*:\\s*([^;]+)`).exec(body)?.[1].trim();

// "Use these tokens, not inline cubic-bezier(...) or a bare `ease`" (css-tokens.md). Seven transitions
// had a literal time or a written-out `ease`; the swipe hint's 0.4s was also restated in calendar-app.js.
// Leaving the curve out keeps the CSS default, which the app's other sheets do throughout, so that is
// allowed; writing one out is not. Keyframe animations are a different vocabulary and are not read.
test('7. every transition takes its times and curves from the motion tokens', () => {
    const offenders = NESTED.flatMap(r => [...r.body.matchAll(/transition(?:-duration|-delay|-timing-function)?\s*:\s*([^;]+)/g)]
        .map(d => d[1].trim())
        .filter(value => value !== 'none')
        .filter(value => {
            const bare = value.replace(/var\([^()]*\)/g, '');
            return /(?:^|[\s,])[\d.]+m?s\b/.test(bare) || /cubic-bezier|steps\(/.test(bare)
                || /\b(?:ease(?:-in|-out|-in-out)?|linear|step-start|step-end)\b/.test(bare);
        })
        .map(value => `${r.selector} → ${value}`));
    assert.ok(NESTED.filter(r => /transition\s*:/.test(r.body)).length >= 10, 'the transitions are found');
    assert.deepEqual(offenders, [], 'a literal time or a written-out curve: use --dur-* and --ease-*');
});

// "An overlay never wears the card radius" — the document viewer did, on --radius-lg, the corner of the
// cards beneath it. The panels are read from the markup, so a new one is held to this without being named.
// And the other way round: --radius-xl is a dialog's corner, which the grade tabs and the leave panel's
// links borrowed to look like pills (chip-radius-parity.test.mjs reads names, and theirs say neither).
test('8. every overlay panel wears a dialog\'s or a glass sheet\'s corner, never the card\'s — and only a panel wears a dialog\'s', () => {
    const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
    const panels = [...html.matchAll(/<[a-z]+\b[^>]*\bclass="[^"]*\blb-content\b[^"]*"[^>]*>/g)]
        .map(m => /\bid="([^"]+)"/.exec(m[0])?.[1]).filter(Boolean).map(id => `#${id}`);
    const worn = NESTED.flatMap(r => r.selector.split(',').map(s => s.trim())
        .filter(s => panels.includes(s))
        .map(s => ({ s, radius: declared(r.body, 'border-radius') }))
        .filter(x => x.radius));
    assert.ok(worn.length >= 5, `the page's own panels and their corners are found (${worn.map(x => x.s).join(' ')})`);
    const wrong = worn.filter(x => !/^var\(--radius-(?:xl|panel)\)$/.test(x.radius ?? '')).map(x => `${x.s} → ${x.radius}`);
    assert.deepEqual(wrong, [], 'an overlay panel takes --radius-xl (a dialog) or --radius-panel (a glass sheet)');
    const borrowed = NESTED.filter(r => /var\(--radius-xl\)/.test(r.body))
        .filter(r => !r.selector.split(',').map(s => s.trim()).every(s => panels.includes(s))).map(r => r.selector);
    assert.deepEqual(borrowed, [], 'a dialog\'s corner on something that is not a panel: a pill is --radius-pill');
});

// "A TAB is a button … the Calendar's controls" (css-tokens.md → Corners): Team View's Prev/Next kept the
// 10px the month view's arrows gave up at v25.12, so one pair of arrows had two corners.
test('9. Team View\'s arrows wear the month view\'s button corner', () => {
    const corner = (/** @type {string} */ sel) => NESTED.filter(r => r.selector.split(',').map(s => s.trim()).includes(sel))
        .map(r => declared(r.body, 'border-radius')).filter(Boolean).pop();
    assert.equal(corner('.controls button'), 'var(--radius-button)', 'premise: the month view\'s arrows');
    assert.equal(corner('.tv-week-nav'), corner('.controls button'));
});

// "A TAB is a button" (css-tokens.md → Corners), and the owner's decision (10 Nov 2026) for the two the
// review found as pills: Team View's grade tabs and the leave panel's two links. At about 30px tall a
// pill reads as a tag; every other tab in the app, and the month view's controls, wear the 12px button.
test('13. Team View\'s grade tabs and the leave panel\'s two links wear the button corner', () => {
    const corner = (/** @type {string} */ sel) => NESTED.filter(r => r.selector.split(',').map(s => s.trim()).includes(sel))
        .map(r => declared(r.body, 'border-radius')).filter(Boolean).pop();
    assert.equal(corner('.grade-tab'), 'var(--radius-button)', 'a grade tab is a tab, and a tab is a button');
    assert.equal(corner('.al-lb-link'), 'var(--radius-button)', 'the leave panel\'s links are its two actions');
});

// The overlay bands are `--z-*` tokens in shared.css. A literal there is a guess about everybody else's
// layer: the month jump's 7000 sat under the drawer (7800) and the slow-save notice (7500). The small
// literals left are stacking WITHIN a cell, a header or a table, and stay well under the bands.
test('10. no literal z-index reaches the overlay bands — those are the --z-* scale', () => {
    const literal = NESTED.flatMap(r => [...r.body.matchAll(/z-index\s*:\s*(-?\d+)/g)].map(m => ({ s: r.selector, z: Number(m[1]) })));
    assert.ok(literal.length >= 3, 'the local stacking literals are found');
    assert.deepEqual(literal.filter(x => x.z >= 100).map(x => `${x.s} → ${x.z}`), []);
});

// The body's padding is where the notch and the home bar are kept clear. A screen breakpoint that restates
// it must restate the insets too: the desktop block's plain `padding: 16px` dropped all four.
test('11. every screen breakpoint that restates the body\'s padding keeps the safe-area insets', () => {
    const body = NESTED.filter(r => r.selector === 'body' && !r.at.some(a => /\bprint\b/.test(a)));
    const sides = ['top', 'right', 'bottom', 'left'];
    /** @type {string[]} */ const lost = [];
    for (const r of body) {
        const short = declared(r.body, 'padding');
        if (short) for (const side of sides) if (!short.includes(`env(safe-area-inset-${side})`)) lost.push(`${r.at.join(' ') || 'base'} → padding (${side})`);
        for (const side of sides) {
            const long = declared(r.body, `padding-${side}`);
            if (long && !long.includes(`env(safe-area-inset-${side})`)) lost.push(`${r.at.join(' ') || 'base'} → padding-${side}`);
        }
    }
    assert.ok(body.length >= 4, 'the base rule and the breakpoints are found');
    assert.deepEqual(lost, [], 'a breakpoint dropped a safe-area inset');
});

// The pinned first column must be opaque (the scrolled cells pass under it) and the same white as the
// viewer: the card off-white it wore is the tint-on-white this file's own Huddle notes call a defect.
test('12. the Huddle\'s pinned column is the viewer\'s own white', () => {
    const fill = (/** @type {string} */ sel) => NESTED.filter(r => r.selector === sel)
        .map(r => declared(r.body, 'background')).filter(Boolean).pop();
    assert.equal(fill('#huddleViewer'), 'white', 'premise: the viewer is white');
    assert.equal(fill('#huddleViewerBody .huddle-shift-col'), fill('#huddleViewer'));
});

// "The picker chevrons are tokens" (css-tokens.md): the month heading opens the month jump, and its mark
// was "▾", a character Inter does not carry, so each device drew its own triangle from a fallback font
// beside a member picker wearing `--caret-chevron` (laptop polish, 13 Nov 2026). Measured in a browser:
// the glyph's width followed the fallback face, 24.1px under serif and 28.9px under monospace at 48px.
test('14. the month heading\'s mark is the app\'s chevron, and no generated content draws a picker glyph', () => {
    const mark = NESTED.filter(r => r.selector === '.month-year::after' && !r.at.some(a => /\bprint\b/.test(a)));
    assert.ok(mark.length >= 1, 'premise: the heading draws a mark');
    assert.ok(mark.some(r => (declared(r.body, 'background') || '').includes('var(--caret-chevron)')),
        'the heading\'s mark is --caret-chevron, the mark every picker wears');
    const glyphs = NESTED.filter(r => /content\s*:[^;]*[▾▼▿⌄⏷]/.test(r.body)).map(r => r.selector);
    assert.deepEqual(glyphs, [], 'a picker mark drawn as a character takes whatever font the device has');
});
