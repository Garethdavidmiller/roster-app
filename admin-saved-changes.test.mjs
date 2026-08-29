/**
 * admin-saved-changes.test.mjs — THE CONTROLS MUST SURVIVE THEIR OWN SUCCESS.
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
mock.module('./admin-override-store.js', {
    namedExports: {
        // Empty AFTER the delete is the worst presentation and the simplest to set up: `renderTable`
        // returns from its `!rows.length` branch before the line that would have hidden the button.
        getAllOverrides: () => [],
        removeFromCache: () => {},
        isTruncated: () => false,
        coversAllStaff: () => true,
        OVERRIDES_QUERY_CAP: 400,
        loadOverrides: async () => {},
    },
});

const { initSavedChanges } = await import('./admin-saved-changes.js');

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
function setup() {
    _checked = [];
    for (const id of PAGE_IDS) {
        const e = el(id);
        e.textContent = '';
        e.innerHTML = '';
        e.value = '';
        e.disabled = false;
        e.className = '';
        e.style = {};
        for (const k of Object.keys(e.dataset)) delete e.dataset[k];
        e.classList.remove('confirming');
    }
    if (!_wiredOnce) {
        _wiredOnce = true;
        initSavedChanges({
            currentIsAdmin: true, currentIsManager: false,
            showError: () => {}, onEditRow: () => {}, onAfterSave: () => {},
            onRenderWeekGrid: () => {}, hasStagedEdits: () => false, formatDate: (/** @type {string} */ s) => s,
        });
    }
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
