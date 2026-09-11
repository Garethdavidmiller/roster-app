/**
 * admin-saved-changes.test.mjs — THE CONTROLS MUST SURVIVE THEIR OWN SUCCESS, AND THE LIST MUST NOT
 * SAY MORE THAN IT KNOWS.
 * Run with: node --experimental-test-module-mocks --test admin-saved-changes.test.mjs
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────────────────────────
 *
 * This module had no tests at all, and the defect it shipped was not a calculation — it was a
 * button left in a state nothing puts back. `Delete selected` disabled itself, relabelled itself
 * `Deleting 3…`, and restored both only in the `catch`. So it worked exactly ONCE per page load:
 * every subsequent bulk delete met a dead control, and ticking more rows re-showed it in that dead
 * state.
 *
 * Nothing could have caught it. The single-row Delete beside it has the IDENTICAL shape and is
 * perfectly fine, because `renderTable()` rebuilds `#overrideTableBody` and destroys that node —
 * the bulk button lives outside the table body and survives. A reviewer comparing the two sees two
 * matching handlers. A static scan sees sixteen sites of that shape across the app, fifteen of them
 * safe. The only thing that separates them is what runs afterwards, which is exactly what a test
 * that RUNS THE HANDLER can see and nothing else can.
 *
 * ── ORGANISED BY WHAT A DEAD CONTROL COSTS ──────────────────────────────────────────────────────
 *
 * Not by function. Both directions matter and they are not symmetrical:
 *
 *   1. STUCK AFTER SUCCESS — the shipped defect. Silent, and it degrades with use: the first
 *      delete works, so the feature "works", and the manager who tries a second one has no error to
 *      report. Worst when the delete emptied the view, because `renderTable()` returns from its
 *      `!rows.length` branch BEFORE the line that hides the button — a dead "Deleting 3…" sitting
 *      above an empty list.
 *   2. STUCK AFTER FAILURE — what the original `catch` was for, and what a careless `finally` could
 *      undo. Pinned so the fix cannot be simplified into a regression.
 *   3. THE RESTORE MUST NOT OVERREACH. Only the LABEL and `disabled` belong to the handler;
 *      VISIBILITY is the renderer's, and forcing it here would leave a live primary action above a
 *      list with nothing ticked — the same class of defect the v16.19 paycalc fix removed.
 *
 * ── AND BY WHAT AN OVERSTATED LIST COSTS (added later) ──────────────────────────────────────────
 *
 * The file's subject widened, because the module's one stated INVARIANT — it may not claim
 * completeness it does not have — had nothing exercising it, and neither did the role gate beside
 * it. Both are the same failure in different currencies, and both are silent:
 *
 *   4. SHOWING SOMEBODY ELSE'S RECORD. The "All staff" toggle is admin/manager only; gating it on
 *      `selectedMember` alone put it in front of a self-service member — whose own name is always
 *      selected — and handed them every colleague's leave and absence, under a card whose tip says
 *      "your own changes only". That was fixed once already. Two LAYERS hold it (the button is
 *      hidden, and the handler refuses anyway), so each needs its own reachable case: with the
 *      first intact the second can never fire from a real tap.
 *   5. CLAIMING COMPLETENESS. `coversAllStaff()` is asked at RENDER time because the toggle only
 *      STARTS a load. A load that failed, is still running, or was coalesced away leaves the flag
 *      true over a cache holding ONE member — so a manager asking "has anyone else booked that
 *      week?" is answered, confidently, from a list that was never capable of saying. The pure rule
 *      underneath is well covered next door; what was untested is that this render ASKS it.
 *
 * ── THE HARNESS ─────────────────────────────────────────────────────────────────────────────────
 *
 * `firebase-client.js` is mocked (it pulls the gstatic SDK, which cannot load in Node) and so is
 * `admin-override-store.js`, whose module-level cache would otherwise have to be driven through a
 * fake Firestore to say "no rows left". The DOM is a small purpose-built fake: the module reads
 * elements by id and asks `#overrideTableBody` for its ticked rows, which is all it needs.
 *
 * The handler is reached by FIRING THE REAL LISTENER that `initSavedChanges` attaches — not by
 * calling an exported helper, because the export surface does not include it and the bug lived in
 * the wiring, not in a rule.
 */

import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// ── THE FAKE DOM ────────────────────────────────────────────────────────────────────────────────
// Elements are created on demand so any id the module reaches for exists and is inspectable.
// `#overrideTableBody` additionally answers `querySelectorAll('.row-select:checked')` from a list
// the test controls — that selector is how the handler learns which rows to delete.

/** @type {Record<string, any>} */
let _els = {};
/** @type {any[]} */
let _checked = [];

function makeEl(/** @type {string} */ id) {
    /** @type {string[]} */ const classes = [];
    /** @type {any[]} */    let kids = [];
    let own = '';
    const node = {
        id,
        value: '',
        innerHTML: '',
        disabled: false,
        hidden: false,
        dataset: /** @type {Record<string, string>} */ ({}),
        style: /** @type {Record<string, string>} */ ({}),
        // `textContent` COMPOSES over appended children, as the real DOM does. That is not padding:
        // `setStatus` builds an `aria-hidden` span plus a text node, and its whole design rests on
        // `textContent` reading back the original string afterwards. A fake that stored a flat
        // string would make every assertion below pass against a `setStatus` that appended nothing.
        get textContent() { return own + kids.map(k => k.textContent).join(''); },
        set textContent(v) { own = String(v ?? ''); kids = []; },
        classList: {
            add: (/** @type {string} */ c) => { if (!classes.includes(c)) classes.push(c); },
            remove: (/** @type {string} */ c) => { const i = classes.indexOf(c); if (i >= 0) classes.splice(i, 1); },
            contains: (/** @type {string} */ c) => classes.includes(c),
        },
        // ATTRIBUTES, because the two-tap confirm now renames the control while armed (v23.16) and
        // a fake with no `getAttribute` would throw inside the handler — aborting the bulk delete
        // this whole suite exists to exercise, in exactly the way the fake DOM's missing `toggle`
        // did to the renderer at v23.12. Kept as a plain map so a test can seed and read one.
        /** @type {Record<string, string>} */ _attrs: {},
        getAttribute(/** @type {string} */ k) { return k in this._attrs ? this._attrs[k] : null; },
        setAttribute(/** @type {string} */ k, /** @type {string} */ v) { this._attrs[k] = String(v); },
        /** @type {Record<string, Function[]>} */ _on: {},
        addEventListener(/** @type {string} */ t, /** @type {Function} */ fn) { (this._on[t] ??= []).push(fn); },
        appendChild(/** @type {any} */ child) { if (child) kids.push(child); return child; },
        querySelectorAll(/** @type {string} */ sel) {
            if (id === 'overrideTableBody' && sel === '.row-select:checked') return _checked;
            return [];
        },
        /** setStatus reaches for this to build its nodes. */
        ownerDocument: null,
    };
    node.ownerDocument = /** @type {any} */ (fakeDocument);
    return node;
}
function el(/** @type {string} */ id) { return (_els[id] ??= makeEl(id)); }

/** Fire a listener the module attached. The bulk handler is only reachable this way. */
async function fire(/** @type {string} */ id, /** @type {string} */ type) {
    for (const fn of _els[id]?._on?.[type] ?? []) await fn({ target: { closest: () => null } });
}

/** A ticked row, as `querySelectorAll('.row-select:checked')` returns it. */
const row = (/** @type {string} */ id) => ({ dataset: { id } });

/** A detached node, enough for `setStatus`'s span and for the month-filter's `<option>`s. */
const detached = (/** @type {string} */ text = '') => ({
    value: '', textContent: text, selected: false, setAttribute() {},
});
const fakeDocument = {
    getElementById: (/** @type {string} */ id) => _els[id] ?? null,
    createElement:  () => detached(),
    createTextNode: (/** @type {string} */ t) => detached(t),
};
global.document = /** @type {any} */ (fakeDocument);

// ── THE MOCKS ───────────────────────────────────────────────────────────────────────────────────
// `writeWithClaimRetry` runs the thunk it is given, so the production retry shape is preserved and
// a test can still make the commit fail.

/** @type {() => Promise<void>} */
let _commit = async () => {};

mock.module('./firebase-client.js', {
    namedExports: {
        db: {},
        doc: () => ({}),
        deleteDoc: async () => {},
        writeBatch: () => ({ delete() {}, commit: () => _commit() }),
        writeWithClaimRetry: (/** @type {Function} */ fn) => fn(),
        COLLECTIONS: { overrides: 'overrides' },
    },
});
/** Rows the store will hand back, and whether it claims to hold EVERY member. Both are `let`s
 *  because the render's two disclosure questions — whose rows are these, and do we know about
 *  everyone — are answered from them, and a fixed mock can only ever exercise one answer. */
/** @type {any[]} */ let _rows = [];
let _coversAll = true;
/** Every `loadOverrides` call, so a test can tell "it fetched first" from "it rendered anyway". */
/** @type {any[]} */ let _loads = [];

mock.module('./admin-override-store.js', {
    namedExports: {
        // Default: empty AFTER the delete is the worst presentation and the simplest to set up —
        // `renderTable` returns from its `!rows.length` branch before the line that would have
        // hidden the button.
        getAllOverrides: () => _rows,
        removeFromCache: () => {},
        isTruncated: () => false,
        coversAllStaff: () => _coversAll,
        OVERRIDES_QUERY_CAP: 400,
        loadOverrides: async (/** @type {any} */ opts) => { _loads.push(opts); },
    },
});

const { initSavedChanges, renderTable, resetTableMemberFilter } = await import('./admin-saved-changes.js');

const PAGE_IDS = ['overrideTableBody', 'bulkDeleteBtn', 'listFeedback', 'selectAllOverrides',
                 'overridesMonthFilter', 'fieldMember', 'fieldDate', 'listCount',
                 'showAllOverridesBtn', 'overridesCountChip'];

/**
 * Reset the page between tests IN PLACE, and wire the module exactly once.
 *
 * `initSavedChanges` guards its wiring to once per page life — which is the fix this suite also
 * covers (v21.94) — so the listeners belong to the element OBJECTS that existed at the first call.
 * Rebuilding `_els` would leave every handler mutating detached nodes while the assertions read
 * fresh ones, and each test after the first would pass or fail for the wrong reason. So the
 * properties are cleared rather than the objects replaced.
 */
let _wiredOnce = false;
/**
 * @param {{ isAdmin?: boolean, isManager?: boolean }} [roles]
 */
function setup(roles = {}) {
    _checked = [];
    _rows = [];
    _coversAll = true;
    _loads = [];
    for (const id of PAGE_IDS) {
        const e = el(id);
        e.textContent = '';
        e.innerHTML = '';
        e.value = '';
        e.disabled = false;
        e.className = '';
        e.style = {};
        for (const k of Object.keys(e.dataset)) delete e.dataset[k];
        for (const k of Object.keys(e._attrs)) delete e._attrs[k];
        e.classList.remove('confirming');
    }
    // The bulk button's idle accessible name, as admin.html gives it.
    el('bulkDeleteBtn').setAttribute('aria-label', 'Delete selected changes');
    // Called EVERY time, not only the first. The module applies its deps on every call and guards
    // only the WIRING (`_wired`), which is what lets a test run the same listeners under a
    // different identity — and the identity is the subject of block 4. The comment above still
    // holds: the listeners belong to the element objects from the first call, so `_els` is cleared
    // rather than rebuilt.
    _wiredOnce = true;
    initSavedChanges({
        currentIsAdmin: roles.isAdmin ?? true, currentIsManager: roles.isManager ?? false,
        showError: () => {}, onEditRow: () => {}, onAfterSave: () => {},
        onRenderWeekGrid: () => {}, hasStagedEdits: () => false, formatDate: (/** @type {string} */ s) => s,
    });
    // `_tableShowAllOverrides` is module state and survives a test. Put it back through the
    // module's own reset, or one test's toggle decides the next test's answer.
    resetTableMemberFilter();
}

/** Arm the two-tap confirm, then commit. The first press only arms; the second is the delete. */
async function bulkDelete(/** @type {string[]} */ ids) {
    _checked = ids.map(row);
    await fire('bulkDeleteBtn', 'click');   // arms: sets .confirming
    await fire('bulkDeleteBtn', 'click');   // deletes
}

beforeEach(() => { _commit = async () => {}; setup(); });

// ────────────────────────────────────────────────────────────────────────────────────────────────

describe('1. stuck after SUCCESS — the shipped defect', () => {
    test('the button is usable again after a delete that worked', async () => {
        await bulkDelete(['a', 'b', 'c']);
        const btn = el('bulkDeleteBtn');
        assert.equal(btn.disabled, false,
            'one successful bulk delete left the button disabled for the rest of the page life');
        assert.equal(btn.textContent, 'Delete selected',
            'the button kept its in-flight label — a manager reads "Deleting 3…" on a control that is doing nothing');
    });

    test('a SECOND bulk delete still reaches Firestore', async () => {
        // The cost of the defect, stated as behaviour rather than as button state: the handler
        // returns early on `!checkedRows.length`, but a dead button never fires at all, so the
        // second delete simply never happened. Counting commits is what shows that.
        let commits = 0;
        _commit = async () => { commits += 1; };
        await bulkDelete(['a']);
        await bulkDelete(['b']);
        assert.equal(commits, 2, 'the second bulk delete never committed');
    });

    test('and it is left usable even when the delete emptied the list', async () => {
        // The worst presentation: `renderTable()` takes its `!rows.length` early return BEFORE the
        // line that hides the button, so a dead "Deleting 1…" sits above "No recorded changes yet".
        await bulkDelete(['only-row']);
        assert.match(el('overrideTableBody').innerHTML, /No recorded changes yet/,
            'this test is not exercising the empty-list branch it was written for');
        assert.equal(el('bulkDeleteBtn').disabled, false);
        assert.equal(el('bulkDeleteBtn').textContent, 'Delete selected');
    });
});

describe('1b. the accessible NAME travels with the label (v23.16, external review)', () => {
    test('while armed it says so, and after the delete it says what it said before', async () => {
        _checked = ['a'].map(row);
        await fire('bulkDeleteBtn', 'click');   // arms
        assert.equal(el('bulkDeleteBtn').getAttribute('aria-label'), 'Confirm delete selected changes',
            'a destructive two-step control has to announce that its meaning changed');
        await fire('bulkDeleteBtn', 'click');   // deletes
        assert.equal(el('bulkDeleteBtn').getAttribute('aria-label'), 'Delete selected changes',
            'and change back — the glyph returning with the name still saying Confirm is the shipped shape');
    });

    test('a FAILED delete puts the name back too', async () => {
        _commit = async () => { throw Object.assign(new Error('nope'), { code: 'unavailable' }); };
        await bulkDelete(['a']);
        assert.equal(el('bulkDeleteBtn').getAttribute('aria-label'), 'Delete selected changes');
    });
});

describe('2. stuck after FAILURE — what the original catch was for', () => {
    test('a failed delete leaves the button pressable, so the admin can retry', async () => {
        _commit = async () => { throw Object.assign(new Error('nope'), { code: 'unavailable' }); };
        await bulkDelete(['a', 'b']);
        assert.equal(el('bulkDeleteBtn').disabled, false);
        assert.equal(el('bulkDeleteBtn').textContent, 'Delete selected');
    });

    test('and it says what went wrong, without the glyph being announced', async () => {
        _commit = async () => { throw Object.assign(new Error('nope'), { code: 'unavailable' }); };
        await bulkDelete(['a']);
        // `setStatus` puts the ⚠ in an `aria-hidden` span; `textContent` still reads back the whole
        // string, which is the property that let the migration happen without touching assertions.
        assert.match(el('listFeedback').textContent, /You appear to be offline/);
        assert.equal(el('listFeedback').className, 'list-feedback error');
    });
});

describe('3. the restore must not overreach', () => {
    test('it puts back the LABEL and leaves VISIBILITY to the renderer', async () => {
        // Forcing `display` here would leave a live primary action above a list with nothing
        // ticked — the same defect the v16.19 paycalc fix removed, arriving from the other side.
        // With the list now empty, nothing is ticked, so the button must not have been re-shown.
        el('bulkDeleteBtn').style.display = 'none';
        await bulkDelete(['a']);
        assert.equal(el('bulkDeleteBtn').style.display, 'none',
            'the handler re-showed the button; `_updateBulkDeleteVisibility` owns that decision');
    });

    test('an empty selection does nothing at all — no arm, no commit', async () => {
        let commits = 0;
        _commit = async () => { commits += 1; };
        _checked = [];
        await fire('bulkDeleteBtn', 'click');
        await fire('bulkDeleteBtn', 'click');
        assert.equal(commits, 0);
        assert.equal(el('bulkDeleteBtn').classList.contains('confirming'), false,
            'a press with nothing ticked armed the confirm, so the NEXT press would delete blind');
    });
});

// ────────────────────────────────────────────────────────────────────────────────────────────────
// WHO MAY SEE WHOSE RECORD, AND WHAT THE LIST IS ENTITLED TO CLAIM.
//
// Both blocks below drive the REAL listeners and the REAL render, because both defects are wiring:
// the rules they lean on (who is admin, does the cache cover everyone) are trivially right in
// isolation, and what shipped wrong was which of them the render asked.
//
// The observable is `#listCount`. It is not a proxy chosen for convenience — it is the sentence the
// card puts on screen, it names the population ("(all staff)"), and it is computed from the same
// `memberFilter` that decides which rows get built. A list that counts five has five on it.

/** A saved change, as `getAllOverrides()` hands them over. */
const change = (/** @type {string} */ who, /** @type {string} */ date) =>
    ({ id: `${who}-${date}`, memberName: who, date, type: 'annual_leave', value: 'AL', source: 'manual' });

const MINE   = [change('G. Miller', '2026-09-01'), change('G. Miller', '2026-09-02')];
const THEIRS = [change('S. Silva', '2026-09-03'), change('S. Silva', '2026-09-04'), change('S. Silva', '2026-09-05')];

/** Put a member in the page's member field, the way the Admin page always has one selected. */
function selectMember(/** @type {string} */ name) { el('fieldMember').value = name; }

describe('4. showing a colleague’s record to somebody who may not see it', () => {
    test('LAYER 1 — a self-service member is never offered the "All staff" toggle', () => {
        // Their own name is always selected, so `!selectedMember` is false for exactly the person
        // the gate exists for. Gating on it alone is what shipped, under a card whose tip says
        // "your own changes only" a few lines further down the page.
        setup({ isAdmin: false, isManager: false });
        selectMember('G. Miller');
        _rows = [...MINE, ...THEIRS];
        renderTable();
        assert.equal(el('showAllOverridesBtn').hidden, true,
            'a self-service member was offered the All-staff toggle');
    });

    test('...and a manager still is — this is a gate, not a removal', () => {
        setup({ isAdmin: false, isManager: true });
        selectMember('G. Miller');
        _rows = [...MINE, ...THEIRS];
        renderTable();
        assert.equal(el('showAllOverridesBtn').hidden, false,
            'the toggle managers use daily was hidden from them');
    });

    test('LAYER 2 — and if the control is reached anyway, the handler refuses', async () => {
        // Defence in depth, and the only way to exercise it is to fire the listener directly: with
        // layer 1 intact the button is hidden, so no tap can get here. That is precisely why it
        // needs its own case — a hidden button is still a live listener on a real page.
        setup({ isAdmin: false, isManager: false });
        selectMember('G. Miller');
        _rows = [...MINE, ...THEIRS];
        renderTable();
        assert.equal(el('listCount').textContent, '2 saved changes',
            'the member-only list is not what this case started from');

        await fire('showAllOverridesBtn', 'click');

        assert.equal(el('listCount').textContent, '2 saved changes',
            'a self-service member was shown every colleague’s recorded leave and absence');
        assert.equal(el('overridesCountChip').textContent, '2');
        assert.deepEqual(_loads, [], 'and it must not even go and FETCH everybody');
    });

    test('the same tap DOES work for a manager, so the refusal is about the role', async () => {
        setup({ isAdmin: false, isManager: true });
        selectMember('G. Miller');
        _rows = [...MINE, ...THEIRS];
        renderTable();
        await fire('showAllOverridesBtn', 'click');
        assert.equal(el('listCount').textContent, '5 saved changes (all staff)');
    });
});

describe('5. claiming a completeness the cache does not have', () => {
    test('the flag alone does not make it an all-staff list', async () => {
        // The scenario the module header describes: the toggle flips the flag and STARTS a load;
        // that load fails, or is still in flight, or was coalesced away. Any later re-render — here
        // the month filter, an ordinary unrelated action — must not draw the one member it holds
        // and label it everybody.
        setup({ isAdmin: true });
        selectMember('G. Miller');
        _rows = [...MINE];        // the cache holds ONE member
        _coversAll = false;       // ...and knows it
        renderTable();

        await fire('showAllOverridesBtn', 'click');
        assert.deepEqual(_loads, [{ everyone: true }], 'the toggle must fetch the collection first');
        // The load never lands.
        await fire('overridesMonthFilter', 'change');

        assert.equal(el('listCount').textContent, '2 saved changes',
            'the list called one member’s rows "(all staff)" — a manager asking who else booked that week gets a confident no');
        assert.equal(el('showAllOverridesBtn').textContent, 'All staff',
            'and the button agreed with it, which is what makes the wrong answer unquestionable');
    });

    test('and once the load HAS landed, the same flag renders every member', async () => {
        // The other direction, without which the case above would be satisfied by a toggle that
        // simply never worked.
        setup({ isAdmin: true });
        selectMember('G. Miller');
        _rows = [...MINE];
        _coversAll = false;
        renderTable();
        await fire('showAllOverridesBtn', 'click');

        _rows = [...MINE, ...THEIRS];   // the load returned
        _coversAll = true;
        await fire('overridesMonthFilter', 'change');

        assert.equal(el('listCount').textContent, '5 saved changes (all staff)');
        assert.equal(el('showAllOverridesBtn').textContent, 'This member only');
    });
});
