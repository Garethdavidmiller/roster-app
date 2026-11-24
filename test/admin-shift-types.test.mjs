// admin-shift-types.test.mjs — the shift-type table, and what a Saved Changes row prints.
//
// `rowValueText` exists because the Admin page's list of everything ever recorded was printing the
// stored value beside a badge that already said it: "Absent  SICK", "Annual Leave  AL". The first is
// not merely redundant — `SICK` is a word this app does not put in front of staff.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TYPES, PILL_TYPES, rowValueText, pillName, typePillHtml } from '../admin-shift-types.js';
import { OTHER_FLAVOURS } from '../override-utils.js';

// Tests live in test/ but address files from the repository root (moved 24 Nov 2026).
const REPO_ROOT_URL = new URL('../', import.meta.url);

test('a fixed type prints nothing — its value only repeats the badge', () => {
    for (const [type, meta] of Object.entries(TYPES)) {
        if (!meta.fixed) continue;
        assert.equal(rowValueText(type, meta.fixedValue), '',
            `${type} carries a derivable value and must not print it twice`);
    }
});

test('SICK never reaches the screen', () => {
    // The specific defect, named: the absence row read "Absent  SICK" on the Admin page.
    assert.equal(rowValueText('sick', 'SICK'), '');
    assert.equal(TYPES.sick.label, 'Absent', 'the visible word for an absence is "Absent"');
});

test('a value that CARRIES something is always kept', () => {
    // Times and Other-family flavours are the whole reason the column exists.
    assert.equal(rowValueText('shift', '08:00-16:30'), '08:00-16:30');
    assert.equal(rowValueText('rdw', '09:00-17:00'), '09:00-17:00');
});

test('an Other day prints its WORD, never its code — as the save receipt does', () => {
    // This pinned the raw code ("TRG RDW 09:00-17:00") until Nov 2026, while the receipt, the week grid
    // and the leave sheet check all said "Training". The words are OTHER_FLAVOURS', every one of them.
    assert.equal(rowValueText('other', 'TRG RDW 09:00-17:00'), 'Training RDW 09:00-17:00');
    assert.equal(rowValueText('other', 'MEET 10:00-14:00'), 'Meeting 10:00-14:00');
    assert.equal(rowValueText('other', 'IND RDW'), 'Induction RDW');
    for (const [code, f] of Object.entries(OTHER_FLAVOURS)) assert.equal(rowValueText('other', code), f.full, code);
    // A value the grammar cannot read is printed as stored: the fail-toward-showing rule below.
    assert.equal(rowValueText('other', 'TRG 25:00-26:00'), 'TRG 25:00-26:00');
});

test('it fails toward SHOWING — a row that contradicts its own type stays visible', () => {
    // Hiding this would make a real data inconsistency invisible on the one page that lists it.
    assert.equal(rowValueText('sick', 'SOMETHING-ELSE'), 'SOMETHING-ELSE');
    assert.equal(rowValueText('annual_leave', '08:00-16:30'), '08:00-16:30');
    assert.equal(rowValueText('a-type-added-later', 'WHATEVER'), 'WHATEVER');
});

test('a missing value is empty text, never "undefined" on screen', () => {
    assert.equal(rowValueText('shift', /** @type {any} */ (undefined)), '');
    assert.equal(rowValueText('shift', /** @type {any} */ (null)), '');
});

test('the rule is the `fixed` flag, so a type added later needs no edit here', () => {
    // If this ever fails, a fixed type has been given a value that is not its fixedValue — which
    // would mean the table itself disagrees about what the type means.
    for (const type of PILL_TYPES) {
        const meta = TYPES[type];
        if (!meta?.fixed) continue;
        assert.ok(meta.fixedValue, `${type} is fixed but declares no fixedValue`);
    }
});

// ── EACH TYPE PILL IS NAMED IN FULL, AND KEEPS ITS SHORT LABEL (review, Nov 2026) ───────────────────
// "RDW" had no name but its letters, and "Rest Day Working" was in the ? tips alone. The visible labels
// stay as they are (AL stays AL, .claude/rules/admin.md); the expansion is the accessible name, which
// LEADS with what the pill shows wherever it can, so a voice user still says what they see (WCAG 2.5.3).
test('every pill\'s name holds both what it shows and its full name', () => {
    for (const type of PILL_TYPES) {
        const { pill, label } = TYPES[type], name = pillName(type);
        assert.ok(new RegExp(`(^|\\s)${pill}(\\s|,|$)`).test(name), `${type}: "${name}" does not contain what the pill shows, "${pill}"`);
        assert.ok(name.includes(label), `${type}: "${name}" does not say its full name, "${label}"`);
    }
    assert.equal(pillName('rdw'), 'RDW, Rest Day Working');
    assert.equal(pillName('annual_leave'), 'AL, Annual Leave');
    assert.equal(pillName('correction'), 'Set as Rest Day', 'the full label already holds "Rest Day": said once');
    assert.equal(pillName('shift'), 'Shift');
});

test('the pill shows its short label, and carries a name only where the name says more', () => {
    for (const type of PILL_TYPES) {
        const html = typePillHtml(type), { pill } = TYPES[type];
        assert.ok(html.endsWith(`>${pill}</button>`), `${type}: the visible label must stay "${pill}"`);
        assert.ok(html.includes(`data-type="${type}"`) && html.includes(`pill-${type}`) && html.includes('aria-pressed="false"'), type);
        const named = /aria-label="([^"]*)"/.exec(html)?.[1] ?? null;
        assert.equal(named, pillName(type) === pill ? null : pillName(type), type);
    }
    assert.match(typePillHtml('rdw'), /aria-label="RDW, Rest Day Working">RDW<\/button>$/);
});

// ── Every type has its colour rule in admin.css (Nov 2026) ──────────────────────────────────────
// `typePillHtml` names each pill `.pill-<type>`, and a Saved Changes row names its badge
// `.lpill-<type>` (admin-saved-changes.js). Neither is checked anywhere else: a type added to the
// table without its rule draws as an uncoloured pill or badge, and nothing fails. Read as text, with
// comments stripped so a selector only mentioned in a comment does not count.
const adminCss = readFileSync(new URL('./admin.css', REPO_ROOT_URL), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
/** Does admin.css hold a rule whose selector is exactly `sel` (it opens a `{` block)? @param {string} sel */
const hasRule = (sel) => new RegExp(`(^|[\\s,}])${sel.replace(/[.]/g, '\\.')}\\s*\\{`).test(adminCss);

test('every pill type has its .pill-<type> and .pill-<type>.active rule in admin.css', () => {
    const missing = PILL_TYPES.flatMap(t => [`.pill-${t}`, `.pill-${t}.active`]).filter(sel => !hasRule(sel));
    assert.deepEqual(missing, [], `admin.css has no rule for ${missing.join(', ')} — add it beside the other .pill-* colours`);
});

test('every type in TYPES has its .lpill-<type> rule in admin.css', () => {
    const missing = Object.keys(TYPES).map(t => `.lpill-${t}`).filter(sel => !hasRule(sel));
    assert.deepEqual(missing, [], `admin.css has no rule for ${missing.join(', ')} — add it beside the other .lpill-* colours`);
});
