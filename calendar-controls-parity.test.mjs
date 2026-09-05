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
//      on the commonest Android width and under text scaling no width query can see.
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
    assert.ok(groupRules.length >= 3, 'the base rule, the breakpoint override and the modifiers are all present');
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
