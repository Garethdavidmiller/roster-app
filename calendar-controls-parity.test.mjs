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
