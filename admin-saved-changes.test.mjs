/**
 * admin-saved-changes.test.mjs — THE CONTROLS MUST SURVIVE THEIR OWN SUCCESS, AND THE LIST MUST NOT
 * SAY MORE THAN IT KNOWS.
 * Run with: node --experimental-test-module-mocks scripts/run-tests.mjs admin-saved-changes.test.mjs
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

import { test, describe, beforeEach, afterEach, mock } from 'node:test';
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
        /** What was appended, in order — the rendered cards, so a test can read the list's ORDER. */
        get _kids() { return kids; },
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
/** Document ids every committed delete removed, in order. @type {string[]} */
let _deleted = [];
/** The size of every delete — one transaction each, v25.89 — that reached its commit, in order. @type {number[]} */
let _batchSizes = [];
/** What each delete was handed: the rows AS SHOWN, which the store compares with the server. @type {any[][]} */
let _handed = [];
/** The verdict of a long bulk delete's whole-list pre-check (`staleDeleteVerdict`). @type {string|null} */
let _staleVerdict = null;
/** Refuse only the Nth delete call (a colleague racing a later chunk), or every one when 0. */
let _refuseOnCall = 0;
/** Every removeFromCache call's ids. @type {string[][]} */
let _removed = [];

/** v24.38: the delete paths refuse up front when nobody is signed in. */
const _mockAuth = { currentUser: /** @type {any} */ ({ uid: 'admin' }) };

mock.module('./firebase-client.js', {
    namedExports: {
        db: {},
        auth: _mockAuth,
        writeWithClaimRetry: (/** @type {Function} */ fn) => fn(),
        COLLECTIONS: { overrides: 'overrides' },
    },
});
/** Rows the store will hand back, and whether it claims to hold EVERY member. Both are `let`s
 *  because the render's two disclosure questions — whose rows are these, and do we know about
 *  everyone — are answered from them, and a fixed mock can only ever exercise one answer. */
/** @type {any[]} */ let _rows = [];
/** @type {string|null} */ let _refuseDelete = null;
let _coversAll = true;
/** Every `loadOverrides` call, so a test can tell "it fetched first" from "it rendered anyway". */
/** @type {any[]} */ let _loads = [];
/** Whether the selected member's records have been READ, and whether their last read failed — the
 *  two answers that tell an unread member from one with nothing recorded (block 9). */
let _authority = true;
let _loadFailed = false;

/** The store's rule, over the mocked rows: the MANUAL records of the day that the deleted one OUTRANKS
 *  (v24.53). The real function is tested against a seeded cache in admin-override-store.test.mjs,
 *  block 5; this copy only lets the receipt be checked here. @param {string[]} ids */
const _withManualDuplicates = (ids) => {
    const ms = (/** @type {any} */ o) => o.createdAt ?? 0;
    const out = new Set(ids);
    for (const id of ids) {
        const r = _rows.find(o => o.id === id);
        if (r && (r.source || '') !== 'roster_import') _rows.filter(o => o.id !== r.id && o.memberName === r.memberName && o.date === r.date && (o.source || '') !== 'roster_import' && ms(r) >= ms(o)).forEach(o => out.add(o.id));
    }
    return out;
};

mock.module('./admin-override-store.js', {
    namedExports: {
        // Default: empty AFTER the delete is the worst presentation and the simplest to set up —
        // `renderTable` returns from its `!rows.length` branch before the line that would have
        // hidden the button.
        getAllOverrides: () => _rows,
        // v25.89: a delete is ONE transaction in the store — compared with what the page showed and
        // deleted together (admin-override-store.test.mjs, block 6, drives the real one). Here it stands
        // for that: `_refuseDelete`, when set, is the line it refuses with before deleting anything, on
        // every call or only the `_refuseOnCall`-th; `_commit` stands for its commit.
        deleteIfUnchanged: async (/** @type {any[]} */ items) => {
            _handed.push(items);
            if (_refuseDelete && (!_refuseOnCall || _handed.length === _refuseOnCall)) {
                throw Object.assign(new Error(_refuseDelete), { code: 'overrides/delete-refused', line: _refuseDelete });
            }
            const ids = items.map(x => (typeof x === 'string' ? x : x.id));
            _batchSizes.push(ids.length); await _commit(); _deleted.push(...ids);
        },
        asShown: (/** @type {string[]} */ ids) => ids.map(id => _rows.find(o => o.id === id) ?? id),
        staleDeleteVerdict: async () => _staleVerdict,
        DELETE_REFUSED: 'overrides/delete-refused',
        removeFromCache: (/** @type {string[]} */ ids) => { _removed.push([...ids]); },
        isTruncated: () => false,
        coversAllStaff: () => _coversAll,
        hasOverrideAuthorityFor: () => _authority,
        loadFailedFor: () => _loadFailed,
        OVERRIDES_QUERY_CAP: 400,
        loadOverrides: async (/** @type {any} */ opts) => { _loads.push(opts); },
        withManualDuplicates: _withManualDuplicates,
        // The store's chunking over that copy — each picked row with the copies it outranks, never split
        // across two chunks (v25.89). The real one is driven against a seeded cache in admin-override-store.test.mjs.
        deleteChunks: (/** @type {string[]} */ picked, /** @type {number} */ size) => {
            const seen = new Set(), chunks = /** @type {string[][]} */ ([]);
            for (const id of picked) {
                const day = [..._withManualDuplicates([id])].filter(x => !seen.has(x));
                day.forEach(x => seen.add(x));
                const last = chunks.at(-1);
                if (!day.length) continue;
                if (last && last.length + day.length <= size) last.push(...day); else chunks.push(day);
            }
            return chunks;
        },
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
/** What each delete handed the week grid (`onOwnWrite`, admin-own-write.js), in order. @type {any[][]} */
let _ownWrites = [];
/** The order the week grid and `onAfterSave` heard about a delete. @type {string[]} */
let _order = [];
/** The days the week grid answers it cleared, given what it was handed. @type {(rows: any[]) => string[]} */
let _clears = () => [];
/**
 * @param {{ isAdmin?: boolean, isManager?: boolean }} [roles]
 */
function setup(roles = {}) {
    _checked = [];
    _rows = [];
    _coversAll = true;
    _authority = true;
    _loadFailed = false;
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
    _ownWrites = []; _order = []; _clears = () => [];
    initSavedChanges({
        currentIsAdmin: roles.isAdmin ?? true, currentIsManager: roles.isManager ?? false,
        showError: () => {}, onEditRow: () => {}, onAfterSave: () => { _order.push('afterSave'); },
        // RECORDED, not discarded: what a delete hands the week grid is the claim block 16 checks.
        onOwnWrite: (/** @type {any[]} */ rows) => { _ownWrites.push(rows); _order.push('week'); return _clears(rows); },
        formatDate: (/** @type {string} */ s) => s,
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

beforeEach(() => { _commit = async () => {}; _deleted = []; _batchSizes = []; _handed = []; _staleVerdict = null; _refuseOnCall = 0; _removed = []; _mockAuth.currentUser = { uid: 'admin' }; setup(); });

// The two-tap confirm disarms after 5 s and the list feedback fades after 6 s, both on REAL timers
// nothing here waits for — so they held the process open after the last test, 6.3 s of wall for
// ~200 ms of tests (test audit, 7 Nov 2026). Mocked file-wide, they are fake timers the reset
// throws away; the one test that steps through the five seconds still mocks its own (`t.mock`).
// Not `--test-force-exit`, which has silently dropped tests in this repo.
beforeEach(() => { mock.timers.enable({ apis: ['setTimeout'] }); });
afterEach(() => { mock.timers.reset(); });

// ────────────────────────────────────────────────────────────────────────────────────────────────

describe('0. signed out (v24.38)', () => {
    test('a bulk delete with nobody signed in says so, sends nothing, and leaves the button usable', async () => {
        let commits = 0;
        _commit = async () => { commits++; };
        _mockAuth.currentUser = null;
        await bulkDelete(['a', 'b']);
        assert.equal(commits, 0, 'nothing reaches Firestore');
        assert.match(el('listFeedback').textContent, /signed out/, 'not "check your connection"');
        assert.equal(el('bulkDeleteBtn').disabled, false);
    });
});

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

describe('1c. the confirm is armed for ONE selection (v25.06, whole-app review)', () => {
    // "⚠ Delete 1?" deleted whatever was ticked by the second tap: arm with one row, press Select
    // all (or tick two more) inside the five seconds, and all three went, under a label naming one.
    test('changing the selection disarms, and the next tap re-arms for the new count', async () => {
        _checked = ['a'].map(row);
        await fire('bulkDeleteBtn', 'click');
        assert.equal(el('bulkDeleteBtn').textContent, '⚠ Delete 1?');
        _checked = ['a', 'b', 'c'].map(row);
        await fire('selectAllOverrides', 'change');
        assert.equal(el('bulkDeleteBtn').textContent, 'Delete selected', 'the armed label must not survive a new selection');
        await fire('bulkDeleteBtn', 'click');
        assert.deepEqual(_deleted, [], 'the tap after a selection change arms — it never deletes');
        assert.equal(el('bulkDeleteBtn').textContent, '⚠ Delete 3?');
        await fire('bulkDeleteBtn', 'click');
        assert.deepEqual([..._deleted].sort(), ['a', 'b', 'c']);
    });
    test('a selection that changed with no change event still needs its own confirm', async () => {
        _checked = ['a'].map(row);
        await fire('bulkDeleteBtn', 'click');            // armed for ['a']
        _checked = ['a', 'b'].map(row);                  // a redraw, say — nothing announced it
        await fire('bulkDeleteBtn', 'click');
        assert.deepEqual(_deleted, [], 'armed for one row, it must not delete two');
        assert.equal(el('bulkDeleteBtn').textContent, '⚠ Delete 2?');
    });
    test('a re-arm keeps its own five seconds (48-hour review, Nov 2026)', async (t) => {
        // Re-arming inside the window became a designed path above — and the FIRST arm's timer was
        // never cancelled, so it disarmed the new confirm early and the confirming tap re-armed instead.
        t.mock.timers.enable({ apis: ['setTimeout'] });
        _checked = ['a'].map(row);
        await fire('bulkDeleteBtn', 'click');                 // t=0: armed for one (its timer due at 5s)
        t.mock.timers.tick(4000);
        _checked = ['a', 'b', 'c'].map(row);
        await fire('selectAllOverrides', 'change');
        await fire('bulkDeleteBtn', 'click');                 // t=4s: re-armed for three (due at 9s)
        t.mock.timers.tick(1500);                             // t=5.5s: the first arm's 5s has passed
        assert.equal(el('bulkDeleteBtn').textContent, '⚠ Delete 3?', 'still asking, 1.5s into its own window');
        await fire('bulkDeleteBtn', 'click');
        assert.deepEqual([..._deleted].sort(), ['a', 'b', 'c'], 'the confirming tap deletes');
    });
    test('…and so does a re-arm made WHILE armed, with no disarm in between (10 Nov 2026)', async (t) => {
        // The case above re-arms through a disarm (a change event), which stops the first timer itself;
        // this one does not, so only the re-arm can stop it — the shared helper's own clear.
        t.mock.timers.enable({ apis: ['setTimeout'] });
        _checked = ['a'].map(row);
        await fire('bulkDeleteBtn', 'click');                 // t=0: armed for one (due at 5s)
        t.mock.timers.tick(4000);
        _checked = ['a', 'b'].map(row);                       // a redraw — nothing announced it
        await fire('bulkDeleteBtn', 'click');                 // t=4s: re-armed for two (due at 9s)
        t.mock.timers.tick(1500);
        assert.equal(el('bulkDeleteBtn').textContent, '⚠ Delete 2?', 'the first arm\'s timer disarmed the second');
    });
});

describe('1b. the accessible NAME travels with the label (v23.16, external review)', () => {
    test('while armed it says so, and after the delete it says what it said before', async () => {
        _checked = ['a'].map(row);
        await fire('bulkDeleteBtn', 'click');   // arms
        assert.equal(el('bulkDeleteBtn').getAttribute('aria-label'), 'Confirm delete 1 selected change',
            'a destructive two-step control has to announce that its meaning changed');
        await fire('bulkDeleteBtn', 'click');   // deletes
        assert.equal(el('bulkDeleteBtn').getAttribute('aria-label'), 'Delete selected changes',
            'and change back — the glyph returning with the name still saying Confirm is the shipped shape');
    });

    // WCAG 2.5.3 Label in Name, the rule axe 4.14 runs (72-hour review, 6 Nov 2026): the armed button
    // SHOWS a count, so its name must carry "delete N" as the same words in the same order — it said
    // "Confirm delete selected changes" under "⚠ Delete 3?". axe's word rule restated small:
    // case-folded, a bracketed aside dropped, anything not a letter or a digit a gap (the ⚠ included).
    test('the armed name contains what the armed button shows, for one and for many', async () => {
        const words = (/** @type {string} */ t) => t.normalize('NFKD').toLowerCase().replace(/\([^()]*\)/g, ' ')
            .split(/[^\p{L}\p{N}]+/u).filter(Boolean);
        const contains = (/** @type {string} */ name, /** @type {string} */ shown) => {
            const n = words(name), v = words(shown);
            return n.some((_, i) => v.every((w, j) => n[i + j] === w));
        };
        for (const ids of [['a'], ['a', 'b', 'c']]) {
            _checked = ids.map(row);
            await fire('selectAllOverrides', 'change');   // a fresh selection starts disarmed
            await fire('bulkDeleteBtn', 'click');         // arms
            const shown = el('bulkDeleteBtn').textContent, name = el('bulkDeleteBtn').getAttribute('aria-label');
            assert.equal(shown, `⚠ Delete ${ids.length}?`);
            assert.ok(contains(name, shown), `the button shows "${shown}" but is named "${name}"`);
            assert.match(name, /^Confirm delete/, 'and the name still says its meaning changed');
        }
    });

    test('re-armed for a new selection while armed, the name follows the new count — it once read "Confirm confirm …"', async () => {
        _checked = ['a'].map(row);
        await fire('bulkDeleteBtn', 'click');             // armed for one
        _checked = ['a', 'b'].map(row);                   // a redraw — nothing announced it
        await fire('bulkDeleteBtn', 'click');             // re-armed for two, while still armed
        assert.equal(el('bulkDeleteBtn').getAttribute('aria-label'), 'Confirm delete 2 selected changes');
        await fire('bulkDeleteBtn', 'click');             // deletes
        assert.equal(el('bulkDeleteBtn').getAttribute('aria-label'), 'Delete selected changes');
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


// ── 6. A pre-v24.48 DUPLICATE goes with the row that was deleted (external review, Oct 2026) ──────
// Two manual records for one member and date — left by two editors saving at once before fixed ids.
// Deleting only the newer from Saved Changes let the older resurface as the day's value (here, annual
// leave reappearing under a rest-day correction somebody had just removed). The week editor's delete
// already took both; these two controls did not.
describe('6. deleting a day takes its older duplicate with it, from both Saved Changes controls', () => {
    const DUPES = () => [
        { id: 'old-al', memberName: 'G. Miller', date: '2026-06-16', type: 'annual_leave', value: 'AL', source: 'manual', createdAt: 1000 },
        { id: 'new-rd', memberName: 'G. Miller', date: '2026-06-16', type: 'correction', value: 'RD', source: 'manual', createdAt: 2000 },
        { id: 'import', memberName: 'G. Miller', date: '2026-06-16', type: 'shift', value: '06:20-14:20', source: 'roster_import' },
    ];

    test('the row ✕ deletes the older copy too, keeps the import, and says so', async () => {
        _rows = DUPES();
        const btn = makeEl('row-delete'); btn.dataset.id = 'new-rd';
        const target = { closest: (/** @type {string} */ sel) => sel === '.btn-delete' ? btn : null };
        for (const fn of el('overrideTableBody')._on.click ?? []) await fn({ target });   // arms
        for (const fn of el('overrideTableBody')._on.click ?? []) await fn({ target });   // deletes
        assert.deepEqual([..._deleted].sort(), ['new-rd', 'old-al']);
        assert.match(el('listFeedback').textContent, /1 older copy of the same day/);
    });

    test('the row ✕ on the STALE copy deletes only that copy, and claims no older one (v24.53)', async () => {
        _rows = DUPES();
        const btn = makeEl('row-delete'); btn.dataset.id = 'old-al';
        const target = { closest: (/** @type {string} */ sel) => sel === '.btn-delete' ? btn : null };
        for (const fn of el('overrideTableBody')._on.click ?? []) await fn({ target });   // arms
        for (const fn of el('overrideTableBody')._on.click ?? []) await fn({ target });   // deletes
        assert.deepEqual([..._deleted], ['old-al'], 'the newer record is what the day shows — it stays');
        assert.doesNotMatch(el('listFeedback').textContent, /older cop/);
    });

    test('Delete selected does the same for every picked row', async () => {
        _rows = DUPES();
        await bulkDelete(['new-rd']);
        assert.deepEqual([..._deleted].sort(), ['new-rd', 'old-al'], 'the import is not a duplicate and stays');
        assert.match(el('listFeedback').textContent, /Deleted 1 saved change, and 1 older copy/);
    });
});

// ── 7 · a stale delete is refused, from both controls (Oct 2026 production review) ──────────────────
// The store re-reads what a delete removes (admin-override-store.test.mjs, block 6). What only this
// file can show is that BOTH Saved Changes controls ask it, and that a refusal deletes nothing and
// says why rather than "check your connection".
describe('7. a delete over a colleague\'s newer edit is refused, and says so', () => {
    const ROW = () => [{ id: 'm_2026-06-16_G.%20Miller', memberName: 'G. Miller', date: '2026-06-16', type: 'annual_leave', value: 'AL', source: 'manual' }];
    const LINE = 'Someone else has changed this since your list loaded, so nothing was deleted.';
    afterEach(() => { _refuseDelete = null; });

    test('the row ✕', async () => {
        _rows = ROW(); _refuseDelete = LINE;
        const btn = makeEl('row-delete'); btn.dataset.id = ROW()[0].id;
        const target = { closest: (/** @type {string} */ sel) => sel === '.btn-delete' ? btn : null };
        for (const fn of el('overrideTableBody')._on.click ?? []) await fn({ target });   // arms
        for (const fn of el('overrideTableBody')._on.click ?? []) await fn({ target });   // tries
        assert.deepEqual(_deleted, [], 'a refused delete removed something');
        assert.match(el('listFeedback').textContent, /Someone else has changed this/);
    });

    test('Delete selected', async () => {
        _rows = ROW(); _refuseDelete = LINE;
        await bulkDelete([ROW()[0].id]);
        assert.deepEqual(_deleted, []);
        assert.match(el('listFeedback').textContent, /Someone else has changed this/);
    });
});


// ── A LONG BULK DELETE IS CHUNKED (Oct 2026 review) ─────────────────────────────────────────────
// Firestore refuses a batch of more than 500 writes, so "select all" over a long list failed outright
// and read as a connection problem.
describe('8. a bulk delete larger than one batch', () => {
    const many = (/** @type {number} */ n) => Array.from({ length: n }, (_, i) => `r${i}`);

    test('commits in batches no larger than 200, and deletes every row', async () => {
        const ids = many(450);
        await bulkDelete(ids);
        assert.deepEqual(_batchSizes, [200, 200, 50]);
        assert.equal(_deleted.length, 450);
    });

    test('a later batch failing takes off the list only what WAS deleted', async () => {
        let n = 0;
        _commit = async () => { if (++n === 2) throw new Error('network'); };
        await bulkDelete(many(450));
        assert.deepEqual(_removed, [many(200)], 'the first batch is gone from the server, so from the list too');
        assert.match(el('listFeedback').textContent, /Deleted 200 of 450/, 'a part-way stop says how far it got');
    });

    // v25.89: each chunk is its own transaction, so a colleague's edit racing a LATER chunk refuses it
    // after an earlier one has landed. The refusal's own line says "nothing was deleted" — untrue here.
    test('a colleague\'s edit refusing a LATER chunk is reported as part done, never as "nothing was deleted"', async () => {
        _refuseDelete = 'Someone else has changed this since your list loaded, so nothing was deleted.'; _refuseOnCall = 2;
        try { await bulkDelete(many(450)); } finally { _refuseDelete = null; }
        const said = el('listFeedback').textContent;
        assert.deepEqual(_removed, [many(200)]);
        assert.match(said, /Deleted 200 of 450 before it stopped — the rest are still listed\. Someone else has changed one of them since your list loaded\./);
        assert.doesNotMatch(said, /nothing was deleted/, 'it claimed nothing was deleted after 200 were');
    });

    test('signed out while a LATER chunk was sending: the outcome is unknown, and it says so — never "the rest are still listed" (v25.89, review)', async () => {
        // A sign-out ends the WAIT, not the write (claim-retry.js): the chunk in flight can still land, so
        // the part-done count — and "the rest are still listed" — could be untrue the moment it was shown.
        let n = 0;
        _commit = async () => { if (++n === 2) throw Object.assign(new Error('signed out'), { code: 'auth/signed-out-during-request' }); };
        await bulkDelete(many(450));
        const said = el('listFeedback').textContent;
        assert.match(said, /You were signed out before this delete was confirmed\. Sign in again, then check Saved Changes\./);
        assert.doesNotMatch(said, /still listed/, 'it promised rows were still there while a chunk was still sending');
        assert.deepEqual(_removed, [many(200)], 'what did land still leaves the list');
    });

    test('a ticked day and the older copy it hides go in ONE chunk — a stop between chunks cannot split them (v25.89, review)', async () => {
        // The 200th ticked row has an older manual copy. The copies used to follow every ticked row, so the
        // row filled the first chunk and its copy fell into the second: refused there, the copy resurfaced as
        // the day's value under "Deleted 200 of 200".
        const ticked = many(200);
        _rows = [...ticked.map(id => ({ id, memberName: `M${id}`, date: '2026-06-16', type: 'shift', value: '07:00-15:00', source: 'manual', createdAt: 2 })),
            { id: 'r199-old', memberName: 'Mr199', date: '2026-06-16', type: 'shift', value: '06:00-14:00', source: 'manual', createdAt: 1 }];
        _refuseDelete = 'Someone else has changed this since your list loaded, so nothing was deleted.'; _refuseOnCall = 2;
        try { await bulkDelete(ticked); } finally { _refuseDelete = null; }
        const chunkOf = (/** @type {string} */ id) => _handed.findIndex(c => c.some((/** @type {any} */ x) => (typeof x === 'string' ? x : x.id) === id));
        assert.equal(chunkOf('r199'), chunkOf('r199-old'), 'a ticked row and the copy it hides were sent in different chunks');
        assert.ok(!_deleted.includes('r199'), 'the row was deleted while the copy it hides stayed behind');
        assert.match(el('listFeedback').textContent, /Deleted 199 of 200 before it stopped/);
    });

    test('a list of several chunks is checked WHOLE first: something already changed refuses it before any chunk', async () => {
        _staleVerdict = 'Someone else has changed this since your list loaded, so nothing was deleted.';
        await bulkDelete(many(450));
        assert.deepEqual(_deleted, [], 'a chunk was deleted although the list was already known to be stale');
        assert.deepEqual(_handed, []);
        assert.match(el('listFeedback').textContent, /nothing was deleted/);
    });
});

// ── WHAT A DELETE COMPARES IS WHAT THE PERSON SAW (v25.89) ─────────────────────────────────────────
describe('8b. both controls hand the store the rows as they were SHOWN', () => {
    test('the row ✕ — the record, not just its id, captured at the press', async () => {
        const row = { id: 'm_2026-06-16_G.%20Miller', memberName: 'G. Miller', date: '2026-06-16', type: 'annual_leave', value: 'AL', source: 'manual' };
        _rows = [row];
        const btn = makeEl('row-delete'); btn.dataset.id = row.id;
        const target = { closest: (/** @type {string} */ sel) => sel === '.btn-delete' ? btn : null };
        for (const fn of el('overrideTableBody')._on.click ?? []) await fn({ target });   // arms
        for (const fn of el('overrideTableBody')._on.click ?? []) await fn({ target });   // deletes
        assert.deepEqual(_handed, [[row]]);
    });

    test('Delete selected', async () => {
        const row = { id: 'a', memberName: 'G. Miller', date: '2026-06-16', type: 'annual_leave', value: 'AL', source: 'manual' };
        _rows = [row];
        await bulkDelete(['a']);
        assert.deepEqual(_handed, [[row]]);
    });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE WHOLE-APP CHECK (10 Nov 2026): what the list may say about an unread member, the order it is
// in, the toolbar after a render, a refusal's wording, the month default, the fade, and a stored date
// printed into markup. Each case below fails on the code before the fix.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** Arm and then press a row's ✕, as two taps reach the delegated listener. @param {string} id */
async function rowDelete(id) {
    const btn = makeEl(`row-delete-${id}`); btn.dataset.id = id;
    const target = { closest: (/** @type {string} */ sel) => sel === '.btn-delete' ? btn : null };
    for (const fn of el('overrideTableBody')._on.click ?? []) await fn({ target });   // arms
    for (const fn of el('overrideTableBody')._on.click ?? []) await fn({ target });   // deletes
}
/** The dates of the rendered rows, top to bottom, read out of each card's markup. */
const renderedDates = () => el('overrideTableBody')._kids.map((/** @type {any} */ c) => /data-date="([^"]*)"/.exec(c.innerHTML)?.[1]);

describe('9. an empty list for a member whose records were never read says so', () => {
    test('still loading: the loading state, never "No recorded changes"', () => {
        setup({ isAdmin: true });
        selectMember('S. Silva');
        _rows = [...MINE];          // the cache holds somebody else
        _authority = false;         // S. Silva's read has not landed
        renderTable();
        assert.doesNotMatch(el('overrideTableBody').innerHTML, /No recorded changes/);
        assert.match(el('overrideTableBody').innerHTML, /Loading saved changes/);
        assert.equal(el('listCount').textContent, 'Loading…', 'not "0 saved changes"');
        assert.equal(el('overridesCountChip').textContent, '');
    });

    test('a failed read says so, and its Retry asks for THAT member — by click or by key', async () => {
        setup({ isAdmin: true });
        selectMember('S. Silva');
        _authority = false; _loadFailed = true;
        renderTable();
        assert.match(el('overrideTableBody').innerHTML, /Couldn't load saved changes\./);
        assert.equal(el('listCount').textContent, 'Error');
        const target = { closest: (/** @type {string} */ sel) => sel === '[data-retry-member]' ? {} : null };
        for (const fn of el('overrideTableBody')._on.click ?? []) await fn({ target });
        for (const fn of el('overrideTableBody')._on.keydown ?? []) await fn({ target, key: 'Enter', preventDefault() {} });
        assert.deepEqual(_loads, [{ everyone: false, member: 'S. Silva' }, { everyone: false, member: 'S. Silva' }]);
    });

    test('the lasting case: All staff turned back off after both reads failed keeps the failure and its Retry', async () => {
        setup({ isAdmin: true });
        selectMember('S. Silva');
        _authority = false; _loadFailed = true; _coversAll = false;
        await fire('showAllOverridesBtn', 'click');    // on: starts a collection read (which fails)
        await fire('showAllOverridesBtn', 'click');    // off again: the member's list is drawn
        assert.doesNotMatch(el('overrideTableBody').innerHTML, /No recorded changes/);
        assert.match(el('overrideTableBody').innerHTML, /↻ Retry/);
    });

    test('a member who HAS been read and has nothing still gets the empty sentence', () => {
        setup({ isAdmin: true });
        selectMember('S. Silva');
        renderTable();
        assert.match(el('overrideTableBody').innerHTML, /No recorded changes yet for S\. Silva/);
    });

    test('rows a capped all-staff read left in the cache are still listed', () => {
        setup({ isAdmin: false, isManager: false });
        selectMember('S. Silva');
        _rows = [...THEIRS]; _authority = false;
        renderTable();
        assert.equal(el('listCount').textContent, '3 saved changes');
    });
});

describe('10. the list is newest first, whatever order the cache is in', () => {
    test('a member\'s read, which arrives in id order, is listed by date', () => {
        setup({ isAdmin: false, isManager: false });    // "All months": nothing filtered away
        selectMember('G. Miller');
        _rows = ['2026-09-02', '2026-11-20', '2026-01-05', '2026-10-01'].map(d => change('G. Miller', d));
        renderTable();
        assert.deepEqual(renderedDates(), ['2026-11-20', '2026-10-01', '2026-09-02', '2026-01-05']);
    });

    test('everybody\'s rows on one date are in name order, and the cache itself is not reordered', () => {
        setup({ isAdmin: false, isManager: false });
        _rows = [change('S. Silva', '2026-09-01'), change('A. Adams', '2026-09-01'), change('G. Miller', '2026-09-03')];
        const before = _rows.map(o => o.id);
        renderTable();   // no member selected: everyone's rows
        assert.deepEqual(renderedDates(), ['2026-09-03', '2026-09-01', '2026-09-01']);
        assert.match(el('overrideTableBody')._kids[1].innerHTML, /A\. Adams/);
        assert.deepEqual(_rows.map(o => o.id), before, 'sorting the cache in place would reorder every other reader');
    });
});

describe('11. the toolbar starts again with every render', () => {
    test('an emptying bulk delete leaves no live "Delete selected" and no ticked "Select all"', async () => {
        el('bulkDeleteBtn').style.display = 'inline-block';   // shown, as ticking rows shows it
        el('selectAllOverrides').checked = true;
        await bulkDelete(['only-row']);
        assert.match(el('overrideTableBody').innerHTML, /No recorded changes yet/, 'premise: the delete emptied the list');
        assert.equal(el('bulkDeleteBtn').style.display, 'none');
        assert.equal(el('selectAllOverrides').checked, false);
    });

    test('a re-render with rows left takes "Select all" out of its dash state', () => {
        setup({ isAdmin: false, isManager: false });
        selectMember('G. Miller');
        _rows = [...MINE];
        el('selectAllOverrides').indeterminate = true;   // one of two ticked…
        renderTable();                                     // …and the rows were rebuilt
        assert.equal(el('selectAllOverrides').indeterminate, false);
    });
});

describe('12. a refused delete is not blamed on the connection', () => {
    const REFUSED = () => Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });

    test('the row ✕', async () => {
        _rows = [change('G. Miller', '2026-09-01')];
        _commit = async () => { throw REFUSED(); };
        await rowDelete('G. Miller-2026-09-01');
        assert.match(el('listFeedback').textContent, /Could not delete — you may have been signed out/);
        assert.doesNotMatch(el('listFeedback').textContent, /connection/);
    });

    test('Delete selected, whole and part-way', async () => {
        _commit = async () => { throw REFUSED(); };
        await bulkDelete(['a']);
        assert.match(el('listFeedback').textContent, /Bulk delete failed — you may have been signed out/);
        let n = 0;
        _commit = async () => { if (++n === 2) throw REFUSED(); };
        await bulkDelete(Array.from({ length: 250 }, (_, i) => `r${i}`));
        assert.match(el('listFeedback').textContent, /Deleted 200 of 250 before it stopped — the rest are still listed\. You may have been signed out/);
    });

    test('an ordinary failure still points at the connection', async () => {
        _commit = async () => { throw new Error('network'); };
        await bulkDelete(['a']);
        assert.match(el('listFeedback').textContent, /check your connection/);
    });
});

describe('13. every member starts on this month, as the Tip says', () => {
    test('a member with nothing this month does not take the default away from the next one', () => {
        setup({ isAdmin: true });
        const now = new Date();
        const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const chosen = () => el('overridesMonthFilter')._kids.find((/** @type {any} */ o) => o.selected)?.value ?? '';
        _rows = [change('G. Miller', '2025-01-05'), change('S. Silva', `${ym}-05`)];
        selectMember('G. Miller');
        resetTableMemberFilter();
        assert.equal(chosen(), '', 'premise: nothing this month for the first member, so "All months"');
        selectMember('S. Silva');
        resetTableMemberFilter();
        assert.equal(chosen(), ym, 'the next member starts on this month again');
    });
});

describe('14. one fade per feedback line', () => {
    // Its OWN clock, as block 1c's re-arm case has: run after that case, the file-wide fake clock no
    // longer fires the fade, and this passed with the guard deleted — vacuous, and only in a full run.
    test('a refusal three seconds after a delete is still showing when the delete\'s fade comes due', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        _rows = [change('G. Miller', '2026-09-01'), change('G. Miller', '2026-09-02')];
        await rowDelete('G. Miller-2026-09-01');                      // t=0: deleted, its fade due at 6s
        assert.equal(el('listFeedback').className, 'list-feedback success');
        t.mock.timers.tick(3000);
        _refuseDelete = 'Someone else has changed this since your list loaded, so nothing was deleted.';
        try { await rowDelete('G. Miller-2026-09-02'); } finally { _refuseDelete = null; }   // t=3s: refused
        t.mock.timers.tick(3500);                                     // t=6.5s: the first fade is due
        assert.equal(el('listFeedback').className, 'list-feedback error', 'the refusal was taken down by the earlier fade');
        t.mock.timers.tick(10_000);
        assert.equal(el('listFeedback').className, 'list-feedback error', 'and an error has no fade of its own');
    });

    test('premise: a success on its own does fade', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        _rows = [change('G. Miller', '2026-09-01')];
        await rowDelete('G. Miller-2026-09-01');
        t.mock.timers.tick(6000);
        assert.equal(el('listFeedback').className, 'list-feedback', 'the clock this block relies on must fire');
    });
});

describe('15. a stored date is escaped where the row prints it', () => {
    test('markup in a date reaches the page as text', () => {
        setup({ isAdmin: false, isManager: false });
        selectMember('G. Miller');
        _rows = [{ id: 'x', memberName: 'G. Miller', date: '<img src=x>', type: 'annual_leave', value: 'AL', source: 'manual' }];
        renderTable();
        assert.doesNotMatch(el('overrideTableBody')._kids[0].innerHTML, /<img/);
    });
});

// ── 16 · THE WEEK GRID FOLLOWS THE PAGE'S OWN DELETE (Nov 2026, review) ────────────────────────────────
// Both controls used to leave the week grid alone whenever a change was staged there, so a row went on
// comparing with a record this page had just deleted, and the week's next Save refused the admin's own
// work as "Someone else has changed …". Each now hands the week what it deleted (`onOwnWrite`,
// admin-own-write.js, which is unit-tested and driven in e2e/admin.spec.js); what only this file can see is
// that each control HANDS it the right rows — after the cache has dropped them — and says what came back.
describe('16. the week grid follows the page\'s own delete, and a cleared change is named', () => {
    const LINE = 'Your unsaved change to Tue 1 Sep in Change a Shift was cleared, because that day has just changed. Set it again if you still want it.';

    test('the row ✕ hands the week the rows it deleted, as SHOWN — the older copy too — once the cache has dropped them', async () => {
        _rows = [change('G. Miller', '2026-09-01')];
        await rowDelete('G. Miller-2026-09-01');
        assert.deepEqual(_ownWrites, [[change('G. Miller', '2026-09-01')]]);
        assert.deepEqual(_removed, [['G. Miller-2026-09-01']], 'premise: the cache dropped it');
        assert.deepEqual(_order, ['week', 'afterSave'], 'after the week, `onAfterSave` asks whether anything is still staged');
    });

    test('a change it cleared is named on the line, which then stays until the next message', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        _rows = [change('G. Miller', '2026-09-01')];
        _clears = () => ['2026-09-01'];
        await rowDelete('G. Miller-2026-09-01');
        assert.equal(el('listFeedback').textContent, `✓ Deleted: G. Miller — 2026-09-01 (Annual Leave). ${LINE}`);
        t.mock.timers.tick(10_000);
        assert.equal(el('listFeedback').className, 'list-feedback success', 'the line faded before it could be read');
    });

    test('Delete selected hands the week every row it deleted, and names what it cleared', async () => {
        _rows = [change('G. Miller', '2026-09-01'), change('G. Miller', '2026-09-02')];
        _clears = () => ['2026-09-01'];
        await bulkDelete(['G. Miller-2026-09-01', 'G. Miller-2026-09-02']);
        assert.deepEqual(_ownWrites, [[change('G. Miller', '2026-09-01'), change('G. Miller', '2026-09-02')]]);
        assert.equal(el('listFeedback').textContent, `✓ Deleted 2 saved changes. ${LINE}`);
    });

    test('a ticked delete that stops part way hands the week only what landed, and still names what it cleared', async () => {
        // One member each, so no two rows are copies of one day and the chunks are simply 200, 200 and 50.
        const many = Array.from({ length: 450 }, (_, i) => ({ ...change(`M${i}`, '2026-09-01'), id: `r${i}` }));
        _rows = many;
        let n = 0;
        _commit = async () => { if (++n === 2) throw new Error('network'); };
        _clears = () => ['2026-09-01'];
        await bulkDelete(many.map(r => r.id));
        assert.deepEqual(_ownWrites, [many.slice(0, 200)], 'the week was handed rows that are still on the server');
        assert.match(el('listFeedback').textContent, /^⚠ Deleted 200 of 450 before it stopped — the rest are still listed\. .* Your unsaved change to Tue 1 Sep in Change a Shift was cleared/);
    });

    test('a refused delete hands the week nothing: nothing changed', async () => {
        _rows = [change('G. Miller', '2026-09-01')];
        _refuseDelete = 'Someone else has changed this since your list loaded, so nothing was deleted.';
        try { await rowDelete('G. Miller-2026-09-01'); await bulkDelete(['G. Miller-2026-09-01']); } finally { _refuseDelete = null; }
        assert.deepEqual(_ownWrites, []);
    });
});
