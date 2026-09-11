// @ts-nocheck
/**
 * hidden-member-visibility.test.mjs — a leaver is off the roster everywhere it is LISTED.
 *
 * `hidden: true` is how this app retires somebody. Nothing is deleted — their overrides, their pay
 * namespace and their Overtime answers all stay on record — so the flag is the only thing standing
 * between a person who has left and every surface that lists staff.
 *
 * THE EXPENSIVE DIRECTION IS SHOWING THEM, and it is silent. The non-Management hidden rows in the
 * live roster are a CEA, a CES and a Dispatcher — each shares a grade with people who are still
 * here — so a leak does not produce a strange extra category anybody would query. It produces one
 * more name in an existing optgroup, or one more row in an existing grade tab, drawn from their old
 * base pattern in exactly the style of the colleagues either side of them. A manager then books
 * leave against it, or reads a week as covered by somebody who no longer works here. Nothing
 * errors and nothing looks wrong.
 *
 * Refusing too widely is the cheap direction: a current member vanishing from a picker is reported
 * the same morning.
 *
 * ── WHY THIS IS FOUR COPIES AND NOT ONE ────────────────────────────────────────────────────────
 *
 * The rule is written out five times in the served tree: `calendar-member.js`'s own picker (already
 * guarded, in calendar-member.test.mjs), `calendar-team-view.js`'s grade grid, and three places in
 * `admin-app.js`. They AGREE — every one is the same `!m.hidden` predicate — and the last block
 * here asserts that they still do rather than taking it on trust, because a divergence is worse
 * than any single wrong copy: two surfaces would then give different answers to "who is on the
 * roster" with nothing between them to say so.
 *
 * They were left as five rather than folded into one exported predicate deliberately. The sites
 * span three served files and eight expressions (four more sit in `calendar-member.js`'s index
 * lookups), the rule is a single negated flag whose meaning is documented on the field itself in
 * `roster-member-data.js`, and `admin-app.js` is a coordinator already near its ratchet cap.
 * Centralising would edit three served files to save one token each — and would protect nothing on
 * its own, because the mutation that actually walked past every suite was a call site dropping the
 * filter altogether. Only a test sees that. So: a test.
 *
 * ── WHAT IS EXECUTED AND WHAT IS PINNED ────────────────────────────────────────────────────────
 *
 * The Team Week View is EXECUTED. Its graph imports no Firebase and it renders through a single
 * `innerHTML` assignment, so the grid a member actually reads can be built here and searched for
 * names that should not be in it.
 *
 * `admin-app.js`'s three are pinned against its source. They sit inside a 1,600-line `init()`
 * behind the session guard, the login overlay and the Firestore client — reachable only by mocking
 * the coordinator's entire import graph, which would test the mocks. Each pin names one site and
 * was verified by deleting the filter it names.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = f => readFileSync(new URL(`./${f}`, import.meta.url), 'utf8');

// ── A document the render can reach, installed before anything is imported ──────────────────────
// The module touches the DOM in six places and only one matters here: it looks up
// `#calendarDisplay` and assigns the whole week's table to its `innerHTML`. Everything else is
// chrome that guards on a missing element, so a document answering `null` to every other id lets
// the render run untouched.
const _display = { innerHTML: '', setAttribute() {}, querySelector: () => null, contains: () => false };
const _lsStore = new Map();
globalThis.localStorage = {
    getItem: k => (_lsStore.has(k) ? _lsStore.get(k) : null),
    setItem: (k, v) => _lsStore.set(k, String(v)),
    removeItem: k => _lsStore.delete(k),
    key: i => [..._lsStore.keys()][i],
    get length() { return _lsStore.size; },
};
globalThis.document = {
    getElementById: id => (id === 'calendarDisplay' ? _display : null),
    querySelector: () => null,
    createElement: () => ({ id: '', textContent: '', remove() {} }),
    head: { appendChild() {} },
    body: { classList: { toggle() {} } },
    activeElement: null,
};
globalThis.requestAnimationFrame = fn => fn();

const { teamMembers, TEAM_GRADES } = await import('./roster-data.js');
const { initTeamView }  = await import('./calendar-team-view.js');
const { noteKnowledge } = await import('./calendar-data-state.js');

const HIDDEN  = teamMembers.filter(m => m.hidden);
const VISIBLE = teamMembers.filter(m => !m.hidden);

// ───────────────────────────────────────────────────────────────────────────────────────────────
// Preconditions — these tests are only worth anything while the roster can actually leak
// ───────────────────────────────────────────────────────────────────────────────────────────────

describe('preconditions', () => {
    test('the live roster still has hidden rows to leak, and visible ones to lose', () => {
        assert.ok(HIDDEN.length > 0,  'nothing below can fail if no member is hidden');
        assert.ok(VISIBLE.length > 0, 'the roster cannot be entirely hidden');
    });

    test('a hidden row shares a grade with current staff, so a leak would blend in', () => {
        // This is what makes the failure silent rather than obvious, and it is why the tests below
        // check NAMES rather than counting categories.
        const staffedGrades = new Set(VISIBLE.map(m => m.role));
        const blending = HIDDEN.filter(m => staffedGrades.has(m.role)).map(m => `${m.name} (${m.role})`);
        assert.ok(blending.length > 0,
            'expected at least one hidden member in a grade that is still staffed — if that ever '
            + 'stops being true the leak becomes visible, and these tests are still correct');
    });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────
// DRAWING A LEAVER — the Team Week View, executed
// ───────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Renders the team grid for one grade and returns the markup it wrote.
 *
 * The opening grade is whichever role the signed-in member holds, so the grade is chosen by handing
 * `getSelectedMemberIndex` the index of a current member of it — the module's own route, not a
 * reach into its internals. `monthKey` is injected, so the test supplies its own spelling and seeds
 * `calendar-data-state` with the same one: the grid is WITHHELD unless the week's months are known,
 * which is a separate rule with its own suite (calendar-data-state.test.mjs).
 */
function renderTeamGrid(grade) {
    const idx = teamMembers.findIndex(m => !m.hidden && m.role === grade);
    assert.ok(idx >= 0, `no current member holds the grade ${grade} — cannot open that tab`);

    const monthKey = (y, m) => `${y}-${String(m + 1).padStart(2, '0')}`;
    const now = new Date();
    for (let i = -2; i <= 2; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
        noteKnowledge([monthKey(d.getFullYear(), d.getMonth())], 'authoritative');
    }

    _display.innerHTML = '';
    const tv = initTeamView({
        rosterOverridesCache: new Map(),
        ensureOverridesCached() {},
        monthKey,
        clearFetchedMonth() {},
        getSelectedMemberIndex: () => idx,
        isFirstRun: () => false,
        renderCalendar() {},
        _pushOverlayState() {},
        _clearOverlayHistory() {},
    });
    tv.restoreTeamView();
    assert.ok(tv.isGridShown(),
        `the ${grade} grid withheld its shift data — the harness, not the rule, is wrong`);
    return _display.innerHTML;
}

/** The names the rendered grid actually puts in its row headings. */
const rowNames = html => [...html.matchAll(/class="tv-name-col">([^<]*)</g)]
    .map(m => m[1])
    .filter(n => n !== 'Name');

describe('the Team Week View never draws somebody who has left', () => {
    for (const grade of TEAM_GRADES) {
        test(`${grade}: no hidden row appears in the grid`, () => {
            const names = rowNames(renderTeamGrid(grade));
            assert.ok(names.length > 0, `the ${grade} grid drew no rows at all`);
            const leaked = HIDDEN.filter(m => names.includes(m.name)).map(m => `${m.name} (${m.role})`);
            assert.deepEqual(leaked, [],
                `these rows are hidden and were drawn in the ${grade} grid anyway:\n  ` + leaked.join('\n  '));
        });

        test(`${grade}: every CURRENT member of the grade is drawn, and nobody else`, () => {
            // Without this the leak test above is satisfied by a grid that draws nobody — and
            // filtering too hard is the other way this rule goes wrong.
            const names    = rowNames(renderTeamGrid(grade)).sort();
            const expected = VISIBLE.filter(m => m.role === grade).map(m => m.name).sort();
            assert.deepEqual(names, expected,
                `the ${grade} grid must list every current ${grade} and nobody else`);
        });
    }

    test('a grade whose only members are hidden draws the empty state, not their names', () => {
        // Management is exactly that grade today — every row carries `hidden: true`. It has no tab
        // of its own (TEAM_GRADES is a fixed three), which is the belt; this is the braces, and it
        // is what the filter would have to be doing for the belt to matter.
        const allHiddenGrades = [...new Set(HIDDEN.map(m => m.role))]
            .filter(role => !VISIBLE.some(m => m.role === role));
        assert.ok(allHiddenGrades.length > 0, 'expected at least one wholly-hidden grade (Management)');
        for (const role of allHiddenGrades) {
            assert.ok(!TEAM_GRADES.includes(role),
                `${role} has no current staff but has a grade tab — it would render a grid of leavers`);
        }
    });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────
// OFFERING A LEAVER — admin.html's staff pickers, pinned at source
// ───────────────────────────────────────────────────────────────────────────────────────────────

describe('admin.html never offers somebody who has left', () => {
    const src = read('admin-app.js');

    test('the optgroup LIST is built from current members only', () => {
        // Dropping the filter here leaks no name — the per-role list below still refuses — it adds
        // an empty "Management" optgroup to every staff picker on the page. Cheap and visible, and
        // pinned because the fix for it sits one character from the expensive one.
        assert.match(src, /const roles = \[\.\.\.new Set\(teamMembers\.filter\(m => !m\.hidden\)\.map\(m => m\.role\)\)\]/,
            'the optgroup roles must come from non-hidden members — otherwise a grade with nobody '
            + 'left in it still gets a heading in every picker');
    });

    test('the members inside each optgroup are filtered — this is the leak', () => {
        assert.match(src, /teamMembers\.filter\(m => m\.role === role && !m\.hidden\)/,
            'populateMemberDropdown must omit hidden members; without it a leaver is offered in the '
            + 'Change a Shift, Annual Leave and Absence pickers, beside real colleagues');
    });

    test('a SAVED member name is re-checked against the roster before it is restored', () => {
        // The saved name outlives the person. Restoring one that is no longer selectable blanks the
        // staff picker (v12.32) — and the moment the option existed again it would silently re-point
        // the page at a leaver.
        assert.match(src, /teamMembers\.find\(m => m\.name === _savedMember && !m\.hidden\)/,
            'the restored member must still be selectable; a stale name is rejected, not trusted');
    });

    test('every LIST admin-app.js builds out of the roster asks about `hidden`', () => {
        // A guard on three named expressions is worth nothing if a fourth arrives. The rule is
        // about lists, not lookups: `.filter` produces a set of people somebody will be shown,
        // while `.find(m => m.name === …)` resolves ONE record by name and must keep working for a
        // leaver (a manager still reads their saved changes and their entitlement).
        const lists = [...src.matchAll(/teamMembers\.filter\([^\n]*/g)].map(m => m[0]);
        assert.ok(lists.length >= 2, 'expected the two picker lists — has the dropdown moved?');
        const unfiltered = lists.filter(expr => !/hidden/.test(expr));
        assert.deepEqual(unfiltered, [],
            'admin-app.js builds a list of members without asking about `hidden`:\n  ' + unfiltered.join('\n  '));
    });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────
// THE FOUR COPIES SAY THE SAME THING
// ───────────────────────────────────────────────────────────────────────────────────────────────

describe('the copies agree', () => {
    test('the team grid filters on `hidden` alone, exactly as the admin pickers do', () => {
        const tv = read('calendar-team-view.js');
        assert.match(tv, /\.filter\(m => !m\.hidden && m\.role === grade\)/,
            'the team grid must filter on `hidden` alone — the same predicate the pickers use');
    });

    test('no surface excludes managerOnly rows on its own', () => {
        // If one surface starts treating managerOnly as a second reason to omit somebody and
        // another does not, the two give different answers to the same question. Today they are
        // kept out of both because every Management row ALSO carries `hidden`, which is a coupling
        // worth stating rather than discovering.
        for (const f of ['calendar-team-view.js', 'admin-app.js', 'calendar-member.js']) {
            assert.doesNotMatch(read(f), /managerOnly/,
                `${f} has grown its own managerOnly rule — every listing surface must agree, so `
                + 'either all of them exclude it or none of them do');
        }
    });

    test('managerOnly rows are hidden rows, which is the only reason they stay out of the lists', () => {
        const leaky = teamMembers.filter(m => m.managerOnly && !m.hidden).map(m => m.name);
        assert.deepEqual(leaky, [],
            'these accounts are managerOnly and NOT hidden, so every picker and the team grid would '
            + 'offer them as staff with no roster of their own:\n  ' + leaky.join('\n  '));
    });
});
