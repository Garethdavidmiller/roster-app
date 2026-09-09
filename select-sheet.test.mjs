// @ts-check
/**
 * THE DROPDOWN THAT REPLACED THE OS ONE — organised by what a wrong answer COSTS.
 *
 * `select-sheet.js` sits between a `<select>` every consumer still reads and a sheet the reader
 * actually uses, and the two ways it can be wrong are not symmetrical:
 *
 *   SHOWING A LIST THAT IS NOT THE SELECT'S is the expensive direction and it is SILENT. The face
 *   keeps a name that has been removed, or the sheet offers a member the page has just dropped, and
 *   nothing errors — the reader picks, the value goes nowhere the consumer expects, and the roster
 *   on screen belongs to somebody else. Every one of those is a stale-read bug, which is why the
 *   options are read on OPEN and the trigger repaints on a rebuild.
 *
 *   FAILING TO REPORT A PICK costs a tap and is visible at once.
 *
 * The pure readers are tested against a fake DOM. The one thing a unit test cannot see — that the
 * trigger is actually reachable and the sheet actually opens — is `e2e/pages.spec.js`, because that
 * is precisely the wiring gap that shipped in the Links picker and passed every unit test.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readGroups, triggerLabel, widestOptionLabel } from './select-sheet.js';

/** A fake `<select>`; `children` is what readGroups walks, `options`/`selectedIndex` what the face reads. */
function fakeSelect(spec) {
    const options = [];
    const children = spec.map(node => {
        if (node.group) {
            const kids = node.options.map(o => mkOption(o));
            options.push(...kids);
            return { tagName: 'OPTGROUP', label: node.group, children: kids };
        }
        const o = mkOption(node);
        options.push(o);
        return o;
    });
    const sel = { children, options, selectedIndex: options.findIndex(o => o.selected), value: '' };
    sel.value = options[sel.selectedIndex]?.value ?? '';
    return sel;
}
const mkOption = (o) => ({
    tagName: 'OPTION', value: o.value ?? '', textContent: o.label ?? '',
    disabled: !!o.disabled, selected: !!o.selected, dataset: o.meta ? { meta: o.meta } : {},
});

describe('showing a list that is not the select\'s — the silent direction', () => {
    test('every option reaches the sheet, in the select\'s own order', () => {
        const sel = fakeSelect([{ value: 'a', label: 'A. Hared' }, { value: 'b', label: 'G. Miller' }, { value: 'c', label: 'M. Robson' }]);
        const groups = readGroups(sel);
        assert.equal(groups.length, 1);
        assert.deepEqual(groups[0].options.map(o => o.value), ['a', 'b', 'c']);
        assert.deepEqual(groups[0].options.map(o => o.label), ['A. Hared', 'G. Miller', 'M. Robson']);
    });

    test('optgroups become titled groups and keep their members together', () => {
        const sel = fakeSelect([
            { group: 'CEA', options: [{ value: '1', label: 'A. Hared' }, { value: '2', label: 'G. Miller' }] },
            { group: 'Dispatcher', options: [{ value: '3', label: 'J. Davies' }] },
        ]);
        const groups = readGroups(sel);
        assert.deepEqual(groups.map(g => g.label), ['CEA', 'Dispatcher']);
        assert.deepEqual(groups.map(g => g.options.length), [2, 1]);
        assert.equal(groups[1].options[0].label, 'J. Davies');
    });

    test('a loose option before a group is not swallowed by it — the first-run placeholder is one', () => {
        // populateTeamMemberDropdown puts "— Choose your name —" ahead of the role optgroups. A
        // reader that only walked <optgroup>s would drop it, and a first-run visitor would open the
        // sheet to a list with no way to see they had chosen nothing.
        const sel = fakeSelect([
            { value: '', label: '— Choose your name —', disabled: true, selected: true },
            { group: 'CEA', options: [{ value: '1', label: 'A. Hared' }] },
        ]);
        const groups = readGroups(sel);
        assert.equal(groups.length, 2);
        assert.equal(groups[0].label, '');
        assert.equal(groups[0].options[0].label, '— Choose your name —');
        assert.equal(groups[0].options[0].disabled, true, 'a disabled option stays unpickable in the sheet');
        assert.equal(groups[1].label, 'CEA');
    });

    test('an EMPTY group is dropped, so the sheet never draws a heading over nothing', () => {
        const sel = fakeSelect([{ group: 'Empty', options: [] }, { group: 'CEA', options: [{ value: '1', label: 'A. Hared' }] }]);
        assert.deepEqual(readGroups(sel).map(g => g.label), ['CEA']);
    });

    test('a select with no options yields no groups — the caller renders its own empty state', () => {
        assert.deepEqual(readGroups(fakeSelect([])), []);
    });

    test('data-meta becomes the row\'s second line, and its absence is an empty string not undefined', () => {
        const sel = fakeSelect([{ value: 'a', label: 'Option A', meta: 'Saved 8 Sept' }, { value: 'b', label: 'Option B' }]);
        const [g] = readGroups(sel);
        assert.equal(g.options[0].meta, 'Saved 8 Sept');
        assert.equal(g.options[1].meta, '');
    });
});

describe('the face — what the trigger says the value is', () => {
    test('it shows the SELECTED option\'s text, never the value', () => {
        // The value is an id ("3"); the face is what a person reads. Showing the value would be
        // both wrong and plausible-looking, which is the worst combination.
        const sel = fakeSelect([{ value: '2', label: 'A. Hared' }, { value: '3', label: 'G. Miller', selected: true }]);
        assert.equal(triggerLabel(sel), 'G. Miller');
    });

    test('an empty select falls back to the placeholder rather than an empty button', () => {
        assert.equal(triggerLabel(fakeSelect([]), 'Choose your name'), 'Choose your name');
    });

    test('an option with only whitespace counts as empty — a blank face is a broken-looking control', () => {
        assert.equal(triggerLabel(fakeSelect([{ value: 'x', label: '   ', selected: true }]), 'Pick one'), 'Pick one');
    });
});


// ── THE CONTROL MUST NOT RESIZE WHEN ITS VALUE CHANGES (v23.39, owner report) ──────────────────
//
// A `<select>` sizes to its widest option; the trigger button that replaced it sized to the name
// it was showing, so the Calendar's picker changed width as you switched member and the whole
// control row re-centred. `widestOptionLabel` is what the hidden sizer renders, and the direction
// that costs something is UNDER-reporting: a sizer narrower than the real widest option puts the
// control back to moving, silently, because nothing about the page fails.
describe('widestOptionLabel — what the trigger is sized to', () => {
    test('reports the longest option, not the selected one', () => {
        const sel = fakeSelect([
            { value: 'a', label: 'A. Ng', selected: true },
            { value: 'b', label: 'R. Forrester-Blackstock' },
            { value: 'c', label: 'S. Silva' },
        ]);
        assert.equal(widestOptionLabel(sel), 'R. Forrester-Blackstock');
        // …and it does not move when the selection does. That is the whole property.
        sel.selectedIndex = 2;
        sel.value = 'c';
        assert.equal(widestOptionLabel(sel), 'R. Forrester-Blackstock');
        assert.equal(triggerLabel(sel), 'S. Silva');
    });

    test('reads the same option text the face does, so the two cannot disagree', () => {
        const sel = fakeSelect([{ value: 'a', label: '  G. Miller  ', selected: true }]);
        // Both trim; a sizer that kept the padding would size to text the face never shows.
        assert.equal(widestOptionLabel(sel), 'G. Miller');
        assert.equal(triggerLabel(sel), 'G. Miller');
    });

    test('falls back to the placeholder before the options arrive', () => {
        // Half these selects are populated after boot. Collapsing to '' would let the control
        // start at zero width and jump the moment the roster lands.
        assert.equal(widestOptionLabel(fakeSelect([]), 'Choose your name'), 'Choose your name');
    });

    test('spans an optgroup, because the widest name is usually inside one', () => {
        // The member selects group by grade. A walker that only saw top-level options would size
        // to the placeholder and the control would move again.
        const sel = fakeSelect([
            { value: '', label: '— Choose your name —', selected: true },
            { group: 'CEA', options: [{ value: 'b', label: 'R. Forrester-Blackstock' }] },
        ]);
        assert.equal(widestOptionLabel(sel), 'R. Forrester-Blackstock');
    });
});
