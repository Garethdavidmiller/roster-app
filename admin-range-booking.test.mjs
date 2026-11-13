/**
 * admin-range-booking.test.mjs — THE SHARED SAVE PATH BEHIND ANNUAL LEAVE AND ABSENCE.
 * Run with: node --experimental-test-module-mocks scripts/run-tests.mjs admin-range-booking.test.mjs
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────────────────────────
 *
 * `admin-range-booking.js` is the skeleton BOTH date-range booking sections are built from — the
 * Annual Leave card and the Absence card are one factory with different config — and it had no
 * test of any kind. Neither did either wrapper. A sweep of the tree found it one of exactly two
 * runtime modules that no unit test and no e2e spec reaches, and it is far the more consequential:
 * it decides which member and which dates reach `recordRangeOverrides`, and it owns every word an
 * admin is shown when that write does not land.
 *
 * That is this repo's own named blind spot — "the rule tested, the wiring not". `recordRangeOverrides`
 * is well covered next door, including both Sunday rules. What was covered by NOTHING is the 90 lines
 * that collect the arguments and interpret the outcome. A perfect writer called with the wrong
 * member writes a perfectly valid override onto the wrong person.
 *
 * ── ORGANISED BY WHAT A WRONG ANSWER COSTS ──────────────────────────────────────────────────────
 *
 * Not by function, because every function here is trivially right in isolation and the failures are
 * all in what gets passed or what happens afterwards.
 *
 *   A. WRITING THE WRONG DAYS. The expensive direction, and silent: an override is a valid document
 *      whatever it says, the card shows a tick, and the error surfaces weeks later as somebody's
 *      leave balance or a shift nobody is covering. The `preSave` veto belongs here too — it is the
 *      AL over-entitlement gate, and a veto that stops vetoing books leave nobody has, with the
 *      confirm bar never shown.
 *   B. A CONTROL THAT NEVER COMES BACK. The exact defect `admin-saved-changes.test.mjs` was written
 *      for, one card up: a button that disables and relabels itself, and restores both somewhere
 *      that does not always run. Here the restore is in a `finally` — which is the fix, so it is
 *      pinned before somebody "simplifies" it back into the `catch`.
 *   C. WHAT THE ADMIN IS TOLD. Five outcomes, five different real situations, and they are NOT
 *      interchangeable. The one that matters most is `partialCommit`: a long range that failed
 *      part-way after earlier chunks committed. Reporting that as a plain failure tells an admin to
 *      retry a write that has already half-landed — the same rule `fetch-timeout.js` states for its
 *      own domain, that a failure must never claim it did not happen.
 *
 * ── THE HARNESS ─────────────────────────────────────────────────────────────────────────────────
 *
 * `admin-overrides.js` is mocked because it imports the gstatic Firebase SDK and cannot load in
 * Node — that is the only reason. Everything else is REAL and deliberately so:
 *
 *   · `roster-data.js` is the real module, so `teamMembers` is the real roster. The save looks a
 *     member up by name to pass `memberObj` into `preSave`; a fixture roster would let that lookup
 *     silently start failing without any test noticing.
 *   · `getDateRange` is the REAL implementation, reached past its own mock via `?real`. It decides
 *     which dates the write receives, which is the load-bearing half of this module. Only
 *     `buildRangePicker` — the widget, which needs `window.matchMedia` and a month grid — is stubbed.
 *   · `status-text.js` is real, so `setStatus`'s glyph split is exercised rather than assumed, and
 *     the fake element composes `textContent` over appended children the way the platform does.
 *
 * The save handler is reached by FIRING THE REAL LISTENER the factory attaches. It is not exported,
 * and the point is the wiring.
 *
 * ── TEETH ───────────────────────────────────────────────────────────────────────────────────────
 *
 * Mutation-verified; each mutation and what caught it is recorded beside the case it belongs to.
 */

import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// ── THE FAKE DOM ────────────────────────────────────────────────────────────────────────────────
// Created on demand so any id the factory reaches for exists and is inspectable.

/** @type {Record<string, any>} */
let _els = {};

function makeEl(/** @type {string} */ id) {
    /** @type {any[]} */ let kids = [];
    let own = '';
    const node = {
        id,
        value: '',
        innerHTML: '',
        className: '',
        disabled: false,
        // `textContent` COMPOSES over children, as the real DOM does. `setStatus` appends an
        // aria-hidden span plus a text node and its whole design rests on `textContent` reading the
        // original string back; a fake storing a flat string would pass against a setStatus that
        // appended nothing at all.
        get textContent() { return own + kids.map((/** @type {any} */ k) => k.textContent).join(''); },
        set textContent(v) { own = String(v ?? ''); kids = []; },
        /** The appended children, so a test can see STRUCTURE (a nowrap span), not only the text. */
        get _kids() { return kids; },
        /** @type {Record<string, Function[]>} */ _on: {},
        addEventListener(/** @type {string} */ t, /** @type {Function} */ fn) { (this._on[t] ??= []).push(fn); },
        appendChild(/** @type {any} */ c) { if (c) kids.push(c); return c; },
        insertAdjacentHTML(/** @type {string} */ _where, /** @type {string} */ html) { this.innerHTML += html; },
        scrollIntoView() {},
        /** Every element handed focus through `querySelector(...)?.focus()`, with the selector that
         *  found it — so a test can see a focus HAND-BACK after the block under it was rebuilt. */
        /** @type {{sel: string, opts: any}[]} */ _focused: [],
        querySelector(/** @type {string} */ sel) {
            return { focus: (/** @type {any} */ opts) => { node._focused.push({ sel, opts }); } };
        },
        /** Whether a fake element "sits inside" this one — set by a test through `_in`. */
        contains(/** @type {any} */ x) { return !!x && x._in === id; },
        ownerDocument: /** @type {any} */ (null),
    };
    node.ownerDocument = /** @type {any} */ (fakeDocument);
    return node;
}
const el = (/** @type {string} */ id) => (_els[id] ??= makeEl(id));

/** A detached node — enough for `setStatus`'s span and text node, and for the receipt's list.
 *  Its `textContent` COMPOSES over appended children, like `makeEl`'s: a receipt `<ul>` built from
 *  `<li>` nodes has to read back as its lines, or a test could not see the lines at all. */
const detached = (/** @type {string} */ text = '') => {
    /** @type {any[]} */ const kids = [];
    let own = String(text);
    return {
        get textContent() { return own + kids.map((/** @type {any} */ k) => k.textContent).join(''); },
        set textContent(v) { own = String(v ?? ''); kids.length = 0; },
        get _kids() { return kids; },
        className: '', setAttribute() {},
        appendChild(/** @type {any} */ c) { if (c) kids.push(c); return c; },
    };
};
const fakeDocument = {
    getElementById: (/** @type {string} */ id) => _els[id] ?? null,
    createElement:  () => detached(),
    createTextNode: (/** @type {string} */ t) => detached(t),
};
global.document = /** @type {any} */ (fakeDocument);

// ── THE MOCKS ───────────────────────────────────────────────────────────────────────────────────

/** Every call the save made, so a test can read the PAYLOAD rather than a summary line. */
/** @type {any[]} */ let _writes = [];
/** What `recordRangeOverrides` does this time: a count, or a throw. */
/** @type {() => Promise<{workingCount:number}>} */
let _record = async () => ({ workingCount: 1 });

/** Dates the section treats as non-working (rest days), by ISO string. */
/** @type {Set<string>} */ let _restDays = new Set();
/** Whether `isWorkingDate` is the real rule rather than `_restDays` (block H). */
let _realWorkingDate = false;
const { isWorkingDate: realIsWorkingDate } = await import('./al-entitlement.js');
/** The member's overrides as `buildMemberDateMap` returns them — empty unless a test seeds one. */
/** @type {Map<string, any>} */ let _ovMap = new Map();

mock.module('./admin-overrides.js', {
    namedExports: {
        recordRangeOverrides: async (/** @type {any} */ payload) => { _writes.push(payload); return _record(); },
        formatDisplay: (/** @type {string} */ iso) => iso,
        buildMemberDateMap: () => _ovMap,
        // Rest days come from `_restDays` — unless a block asks for the REAL rule (block H), which
        // knows a Sunday is never worked; the stand-in would count every Sunday as a working day.
        isWorkingDate: (/** @type {any} */ m, /** @type {string} */ iso, /** @type {any} */ map) =>
            _realWorkingDate ? realIsWorkingDate(m, iso, map) : !_restDays.has(iso),
        isSaveInFlight: () => _otherSaveInFlight,
        setSaveInFlight: (/** @type {boolean} */ on) => { _lockCalls.push(on); },
        hasOverrideAuthorityFor: () => _authority,
        // admin-al.js reads every override for its allowance check; block H wires the real card.
        getAllOverrides: () => [],
    },
});
/** v24.38: the page-wide write lock the range cards share with Change a Shift. */
let _otherSaveInFlight = false;
/** @type {boolean[]} */ let _lockCalls = [];
/** Whether the member's records have been READ, and whether their last read failed (block F). The
 *  store itself pulls the gstatic SDK, so its one answer this module asks is stood in for. */
let _authority = true;
let _loadFailed = false;
mock.module('./admin-override-store.js', { namedExports: { loadFailedFor: () => _loadFailed, DELETE_REFUSED: 'overrides/delete-refused' } });

// The RULE that decides which dates are written stays real; only the widget is stubbed.
const { getDateRange: realGetDateRange } = await import('./admin-rangepicker.js?real');
/** Set by a test that needs to observe the picker being reset after a successful save. */
let _pickerResets = 0;
/** What each `reset` was asked to keep — a save keeps the month on screen (block K). @type {any[]} */
let _resetArgs = [];
mock.module('./admin-rangepicker.js', {
    namedExports: {
        getDateRange: (/** @type {string} */ a, /** @type {string} */ b) => realGetDateRange(a, b),
        // The widget is stubbed, but `reset()` CLEARS BOTH INPUTS exactly as the real one does
        // (admin-rangepicker.js: `fromInput.value = toInput.value = ''`). That is not decoration:
        // the whole point of the post-save `updatePreview()` is that it runs against a range that
        // is now empty, so a stub which kept the dates would report the button as live and hide
        // the very state this file asserts.
        buildRangePicker: () => ({
            reset: (/** @type {any} */ o) => { _pickerResets++; _resetArgs.push(o); el('alFrom').value = ''; el('alTo').value = ''; },
        }),
    },
});

const { createRangeBookingSection } = await import('./admin-range-booking.js');
const { teamMembers } = await import('./roster-data.js');

/** A real, visible member — looked up rather than hardcoded, so a roster edit moves the case. */
const MEMBER = /** @type {any} */ (teamMembers.find(m => !m.hidden && !m.managerOnly)).name;

/** The member `<select>` the factory is handed. Not looked up by id — it is injected. */
function memberSelect(/** @type {string} */ value) {
    return /** @type {any} */ ({ value, options: [{ value, selected: false }] });
}

/**
 * Wire a section with sensible defaults, returning the handles a test needs.
 * Overrides are shallow-merged so a case states only the thing it is about.
 */
function wire(/** @type {any} */ over = {}) {
    // The factory resolves all five elements by id at wiring time, so they must EXIST first —
    // `getElementById` returning null is what the real page would never do.
    for (const id of ['alFrom', 'alTo', 'alPreview', 'alSaveBtn', 'alFeedback']) el(id);
    const sel = memberSelect(over.member ?? MEMBER);
    const calls = /** @type {Record<string, any[]>} */ ({ onClick: [], preSave: [], afterSave: [], showSuccess: [], jump: [] });
    const section = createRangeBookingSection({
        prefix: 'al',
        memberSelect: sel,
        syncMemberDisplay: () => {},
        populateMemberDropdown: () => {},
        lastMember: null,
        previewClass: 'al-preview',
        overrideType: 'annual_leave',
        overrideValue: 'AL',
        savingLabel: 'Record Annual Leave',
        logLabel: 'AL',
        validateRange: () => null,
        renderReady: () => '<p>ready</p>',
        successFeedback: (/** @type {number} */ n, /** @type {string} */ m) => `✓ Recorded ${n} days for ${m}`,
        successToast: (/** @type {number} */ n, /** @type {string} */ m) => `Recorded ${n} days for ${m}`,
        getCurrentUser: over.getCurrentUser ?? (() => 'A. Admin'),
        onClick: () => { calls.onClick.push(true); },
        preSave: over.preSave ?? (() => { calls.preSave.push(true); return false; }),
        afterSave: () => { calls.afterSave.push(true); },
        showSuccess: (/** @type {string} */ t) => { calls.showSuccess.push(t); },
        showInChangeAShift: (/** @type {string} */ m, /** @type {string} */ d) => { calls.jump.push([m, d]); },
        ...(over.cfg ?? {}),
    });
    return { section, sel, calls };
}

/** Put a range on screen and refresh the preview, as the date listeners would. */
function setRange(/** @type {any} */ section, /** @type {string} */ from, /** @type {string} */ to) {
    el('alFrom').value = from;
    el('alTo').value   = to;
    section.updatePreview();
}

/** Fire the save button's real listener and await it. */
async function save() {
    for (const fn of _els.alSaveBtn?._on?.click ?? []) await fn({});
}

beforeEach(() => {
    _els = {};
    _writes = [];
    _restDays = new Set();
    _ovMap = new Map();
    _pickerResets = 0;
    _resetArgs = [];
    _record = async () => ({ workingCount: 1 });
    _otherSaveInFlight = false;
    _lockCalls = [];
    _authority = true;
    _loadFailed = false;
    _realWorkingDate = false;
    // A successful save fades its receipt after 7 s on a REAL timer, and nothing here waits for it
    // — so it held the process open after the last test, 7.3 s of wall for ~250 ms of tests (test
    // audit, 7 Nov 2026). Mocked, it is a fake timer the reset below throws away. Not
    // `--test-force-exit`, which has silently dropped tests in this repo.
    mock.timers.enable({ apis: ['setTimeout'] });
});
afterEach(() => { mock.timers.reset(); });

// ════════════════════════════════════════════════════════════════════════════════════════════════
// A. WRITING THE WRONG DAYS
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe('writing the wrong days', () => {
    test('the write carries the member and the dates that are on screen', async () => {
        const { section } = wire();
        setRange(section, '2026-10-05', '2026-10-07');
        await save();

        assert.equal(_writes.length, 1);
        const w = _writes[0];
        assert.equal(w.memberName, MEMBER);
        // The DATES are the assertion that matters — a wrong range is the silent corruption.
        assert.deepEqual(w.dates, ['2026-10-05', '2026-10-06', '2026-10-07']);
        assert.equal(w.type,  'annual_leave');
        assert.equal(w.value, 'AL');
    });

    test('waits for a Change-a-Shift save still sending, and holds the page lock while it writes (v24.38)', async () => {
        // Both paths replace the same day's record; run together they left two documents for it.
        const { section } = wire();
        setRange(section, '2026-10-05', '2026-10-07');
        _otherSaveInFlight = true;
        await save();
        assert.equal(_writes.length, 0, 'nothing written while the other save is in flight');
        _otherSaveInFlight = false;
        await save();
        assert.equal(_writes.length, 1);
        assert.deepEqual(_lockCalls, [true, false], 'the lock is taken for the write and always released');
    });

    test('a range EDITED after wiring is re-read at save time, not captured at wiring', async () => {
        // Teeth: hoisting `const dates = getDates()` out of the handler passes every other case in
        // this file — the first range written is the first range chosen — and books the wrong week
        // for anyone who corrects their dates before pressing Save.
        const { section } = wire();
        setRange(section, '2026-10-05', '2026-10-06');
        setRange(section, '2026-11-02', '2026-11-03');
        await save();
        assert.deepEqual(_writes[0].dates, ['2026-11-02', '2026-11-03']);
    });

    test('`changedBy` is read at the CLICK, because the audit trail names a person', async () => {
        // The config documents `getCurrentUser` as a LIVE getter. Freezing it at wiring time records
        // whoever was signed in when the page loaded — on a shared station PC, the wrong person, on
        // a record whose whole purpose is to say who made the change.
        let who = 'First. Admin';
        const { section } = wire({ getCurrentUser: () => who });
        setRange(section, '2026-10-05', '2026-10-05');
        who = 'Second. Admin';
        await save();
        assert.equal(_writes[0].changedBy, 'Second. Admin');
    });

    test('a preSave veto writes NOTHING — it is the over-entitlement gate', async () => {
        const { section } = wire({ preSave: () => true });
        setRange(section, '2026-10-05', '2026-10-09');
        await save();
        assert.equal(_writes.length, 0, 'a vetoed save must not reach Firestore');
    });

    test('a veto leaves NO "Saving…" state behind', async () => {
        // Named by the external review, and not implied by "writes nothing": a veto that had already
        // disabled the button and relabelled it would leave the AL confirm bar sitting above a dead
        // control — the member is asked to confirm and then cannot. The guard runs BEFORE the
        // Saving state is set, and this is what pins that ordering.
        const { section } = wire({ preSave: () => true });
        setRange(section, '2026-10-05', '2026-10-09');
        await save();
        const btn = el('alSaveBtn');
        // NOT `=== 'Record Annual Leave'`: the idle label is page markup, and the handler only
        // writes a label when it actually runs, so an untouched button reads empty here. The claim
        // is that it never entered the Saving state — which is what a dead control looks like.
        assert.doesNotMatch(btn.textContent, /Saving/, 'the veto path entered the Saving state');
        assert.equal(btn.disabled, false, 'the confirm bar must not be shown above a dead button');
    });

    test('a preSave that allows still writes — the veto is not the default', async () => {
        // Without this the case above passes on a save path that is simply broken.
        const { section } = wire({ preSave: () => false });
        setRange(section, '2026-10-05', '2026-10-05');
        await save();
        assert.equal(_writes.length, 1);
    });

    test('no member and no dates each write nothing', async () => {
        const a = wire({ member: '' });
        setRange(a.section, '2026-10-05', '2026-10-06');
        await save();
        assert.equal(_writes.length, 0, 'no member selected');

        _els = {}; _writes = [];
        const b = wire();
        b.section.updatePreview();          // no range set at all
        await save();
        assert.equal(_writes.length, 0, 'no dates selected');
    });

    test('an end date BEFORE the start writes nothing', async () => {
        // The real getDateRange returns null here. A stub returning [] would make this pass for the
        // wrong reason, which is why the rule is imported past its own mock.
        const { section } = wire();
        setRange(section, '2026-10-09', '2026-10-05');
        await save();
        assert.equal(_writes.length, 0);
    });

    test('onClick runs even when the guard early-returns', async () => {
        // Its whole reason for sitting above the guard: the AL section captures and RESETS the
        // over-limit-confirmed flag there. If it stopped running on the early-return path, a
        // confirmation given for one range would still be armed for the next.
        const { section, calls } = wire({ member: '' });
        setRange(section, '2026-10-05', '2026-10-06');
        await save();
        assert.equal(calls.onClick.length, 1);
        assert.equal(_writes.length, 0);
    });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// B. A CONTROL THAT NEVER COMES BACK
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe('a control that never comes back', () => {
    test('after a FAILED save the button is usable again', async () => {
        const { section } = wire();
        setRange(section, '2026-10-05', '2026-10-06');
        _record = async () => { throw new Error('nope'); };
        await save();

        const btn = el('alSaveBtn');
        assert.equal(btn.textContent, 'Record Annual Leave', 'the label must be restored');
        assert.equal(btn.disabled, false, 'a failed save must leave the range retryable');
    });

    test('after a SUCCESSFUL save the label is restored', async () => {
        const { section } = wire();
        setRange(section, '2026-10-05', '2026-10-06');
        await save();
        assert.equal(el('alSaveBtn').textContent, 'Record Annual Leave');
    });

    test('the restore does not force `disabled` — updatePreview governs it', async () => {
        // A success CLEARS the range, so the correct end state is disabled-with-an-empty-preview.
        // A `finally` that set `disabled = false` outright would leave a live primary action over a
        // card with nothing selected.
        const { section } = wire();
        setRange(section, '2026-10-05', '2026-10-06');
        await save();
        assert.equal(_pickerResets, 1, 'a successful save clears the range');
        assert.equal(el('alSaveBtn').disabled, true, 'no range selected ⇒ nothing to save');
    });

    test('while a save is HELD, a preview refresh does not re-arm Save, and a second tap writes nothing', async () => {
        // v24.26. updatePreview runs on a swap answer, a date change and admin-app's _refreshAlPreview,
        // and it set `disabled` from the form alone — so during a slow save Save came back live under
        // its "Saving…" label. The held save's documents are not in the cache yet, so a second tap
        // booked every day again: leave counted twice.
        const { section } = wire();
        setRange(section, '2026-10-05', '2026-10-06');
        /** @type {(v: any) => void} */ let release = () => {};
        _record = () => new Promise((r) => { release = r; });
        const first = save();
        await Promise.resolve();
        section.updatePreview();
        assert.equal(el('alSaveBtn').disabled, true, 'Save stays disabled while the first save waits');
        _record = async () => ({ workingCount: 2 });   // a second write, if one happens, lands at once
        await save();
        assert.equal(_writes.length, 1, 'the second tap must not write the range again');
        release({ workingCount: 2 });
        await first;
        assert.equal(el('alSaveBtn').textContent, 'Record Annual Leave', 'and it recovers when the save lands');
    });

    test('a save the range makes pointless leaves the button alive', async () => {
        // Every day in the range is a rest day: `workingCount` comes back 0, the write is a no-op,
        // and the range is deliberately KEPT so the admin can adjust it rather than re-enter it.
        const { section } = wire();
        _restDays = new Set(['2026-10-05', '2026-10-06']);
        setRange(section, '2026-10-05', '2026-10-06');
        // The preview disables Save when there are no working days; the handler is still the thing
        // under test, so fire it directly.
        _record = async () => ({ workingCount: 0 });
        await save();
        assert.equal(el('alSaveBtn').textContent, 'Record Annual Leave');
        assert.equal(_pickerResets, 0, 'a no-op save must not clear the range');
    });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// C. WHAT THE ADMIN IS TOLD
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe('what the admin is told', () => {
    /** Run a save whose write rejects with `err`, and return the feedback element. */
    async function failWith(/** @type {any} */ err) {
        const { section } = wire();
        setRange(section, '2026-10-05', '2026-10-06');
        _record = async () => { throw err; };
        await save();
        return el('alFeedback');
    }

    test('a PARTIAL commit must not say the write did not happen', async () => {
        // The one that matters most. Earlier chunks of a long range committed; the connection then
        // dropped. Told "couldn't save", an admin retries and double-books. The message must leave
        // the admin checking rather than repeating.
        const fb = await failWith(Object.assign(new Error('boom'), { partialCommit: true }));
        assert.match(fb.textContent, /may already be saved/i);
        assert.doesNotMatch(fb.textContent, /couldn't save/i);
        assert.equal(fb.className, 'feedback error');
    });

    // A COLLEAGUE'S CHANGE, NOT THE CONNECTION (v25.90). Each part of a long range is checked against the
    // server; a later part refused because somebody changed one of its days, after earlier parts landed,
    // is said as exactly that — "the connection dropped" would send the admin looking at their signal.
    test('a later part REFUSED over a colleague\'s change says so — some days saved, nothing about the connection', async () => {
        const fb = await failWith(Object.assign(new Error('changed'), { partialCommit: true, code: 'overrides/delete-refused', line: 'x' }));
        assert.match(fb.textContent, /Someone else has changed a day in this range/);
        assert.match(fb.textContent, /some days are saved/);
        assert.doesNotMatch(fb.textContent, /connection/i);
        assert.equal(fb.className, 'feedback error');
    });

    test('a FIRST part refused writes nothing, and its own line — naming the day — is what is shown', async () => {
        const line = 'Someone else has changed Mon 5 Oct since the page loaded, so nothing was saved. Reload the page to see the latest, then try again.';
        const fb = await failWith(Object.assign(new Error(line), { code: 'overrides/delete-refused', line }));
        assert.equal(fb.textContent, '⚠ ' + line);
    });

    test('a cache that never loaded says RELOAD, not retry', async () => {
        // recordRangeOverrides refused to write against an empty cache — retrying in place would
        // meet the same empty cache. Only a reload changes the answer.
        const fb = await failWith(Object.assign(new Error('cache/load-failed'), {}));
        assert.match(fb.textContent, /reload/i);
    });

    test('an expired session says so, rather than blaming the connection', async () => {
        const fb = await failWith(new Error('auth/session-expired'));
        assert.match(fb.textContent, /signed out/i);
    });

    test('an unrecognised failure falls back to the connection message', async () => {
        const fb = await failWith(new Error('something nobody has seen'));
        assert.match(fb.textContent, /connection/i);
    });

    test('the four failure messages are all DIFFERENT', async () => {
        // Each exists because it sends the admin somewhere different. A refactor that collapsed two
        // of them would pass every individual case above.
        const seen = [];
        for (const e of [
            Object.assign(new Error('boom'), { partialCommit: true }),
            new Error('cache/load-failed'),
            new Error('auth/session-expired'),
            new Error('generic'),
        ]) { _els = {}; seen.push((await failWith(e)).textContent); }
        assert.equal(new Set(seen).size, 4, seen.join(' | '));
    });

    test('no working days is reported as a NON-event, never as a success', async () => {
        const { section } = wire();
        setRange(section, '2026-10-05', '2026-10-06');
        _record = async () => ({ workingCount: 0 });
        await save();
        const fb = el('alFeedback');
        assert.match(fb.textContent, /no working days/i);
        assert.equal(fb.className, 'feedback error');
        assert.doesNotMatch(fb.textContent, /recorded/i);
    });

    test('a success names the count and the member, and fires the toast', async () => {
        // The card resets and scrolls away, so the bottom toast is the confirmation that survives —
        // the inline feedback alone can end up off-screen.
        const { section, calls } = wire();
        setRange(section, '2026-10-05', '2026-10-07');
        _record = async () => ({ workingCount: 3 });
        await save();

        const fb = el('alFeedback');
        assert.equal(fb.className, 'feedback success');
        assert.match(fb.textContent, /3/);
        assert.match(fb.textContent, new RegExp(MEMBER.replace('.', '\\.')));
        assert.equal(calls.showSuccess.length, 1, 'the bottom toast must fire too');
        assert.equal(calls.afterSave.length, 1, 'the AL banner and boxes must be refreshed');
        assert.deepEqual(calls.jump[0], [MEMBER, '2026-10-05'], 'Change a Shift jumps to what was recorded');
    });

    test('a failure RETAINS the range — there is nothing to re-enter', async () => {
        // Also named by the review. Only a SUCCESS clears the picker; a failed save must leave the
        // dates exactly as chosen, because the admin's next act is to retry or adjust, and a
        // 60-day AL range re-entered by hand is how a retry becomes a different booking.
        for (const err of [new Error('generic'), new Error('cache/load-failed'),
                           new Error('auth/session-expired')]) {
            _els = {}; _pickerResets = 0;
            const { section } = wire();
            setRange(section, '2026-10-05', '2026-10-09');
            _record = async () => { throw err; };
            await save();
            assert.equal(_pickerResets, 0, `${err.message}: the range must be kept`);
            assert.equal(el('alFrom').value, '2026-10-05');
            assert.equal(el('alSaveBtn').disabled, false, `${err.message}: still retryable`);
        }
    });

    test('a FAILED save refreshes nothing and jumps nowhere', async () => {
        // Without this the success case above cannot distinguish "ran the success path" from "ran
        // both paths".
        const { section, calls } = wire();
        setRange(section, '2026-10-05', '2026-10-06');
        _record = async () => { throw new Error('nope'); };
        await save();
        assert.equal(calls.afterSave.length, 0);
        assert.equal(calls.jump.length, 0);
        assert.equal(calls.showSuccess.length, 0);
    });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// D. THE SWAP QUESTION'S ANSWERS REACH THE BUTTON AND THE BAR
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe('the swap answers', () => {
    const REST = '2026-10-09';
    /** Tap one of the preview's answer buttons through the real delegated listener. */
    const answer = (/** @type {string} */ date, /** @type {'yes'|'no'} */ a) => {
        const target = { closest: () => ({ dataset: { date, answer: a } }) };
        for (const fn of el('alPreview')._on.click ?? []) fn({ target });
    };

    test('changing an answer dismisses a showing over-limit bar (review A19)', () => {
        // The bar was computed for the OLD answers; "Save anyway" then booked the new ones unchecked.
        let dismissed = 0;
        const { section } = wire({ cfg: { swapQuestion: () => [REST], beforePreview: () => { dismissed++; } } });
        setRange(section, REST, REST);
        answer(REST, 'yes');
        assert.equal(dismissed, 1);
    });

    test('a REFRESH under a focused answer hands focus back too (48-hour review, Nov 2026)', () => {
        // The preview is now also rebuilt when the member's records arrive — and a keyboard user on an
        // answer button at that moment dropped to <body>; only the click path handed focus back.
        const { section } = wire({ cfg: { swapQuestion: () => [REST] } });
        setRange(section, REST, REST);
        el('alPreview')._focused.length = 0;
        /** @type {any} */ (fakeDocument).activeElement = { _in: 'alPreview', matches: (/** @type {string} */ q) => q === '.swapday-opt',
            dataset: { date: REST, answer: 'yes' } };
        try { section.updatePreview(); } finally { delete /** @type {any} */ (fakeDocument).activeElement; }
        assert.deepEqual(el('alPreview')._focused,
            [{ sel: `.swapday-opt[data-date="${REST}"][data-answer="yes"]`, opts: { preventScroll: true } }]);
    });

    test('an answer hands keyboard focus to the same answer in the rebuilt block (whole-app review)', () => {
        // The preview is rebuilt under the pressed button, which dropped a keyboard user's focus to
        // <body>. The hand-back must find the SAME day and the SAME answer, and must not scroll.
        const { section } = wire({ cfg: { swapQuestion: () => [REST] } });
        setRange(section, REST, REST);
        answer(REST, 'no');
        assert.deepEqual(el('alPreview')._focused,
            [{ sel: `.swapday-opt[data-date="${REST}"][data-answer="no"]`, opts: { preventScroll: true } }]);
    });

    test('Save stays off when every day resolves to nothing written (review A2)', () => {
        // A rest day holding an absence passes `isWorkingDate` (its value is not a rest value), so
        // the old "any working day?" test armed Save for a range that, answered "free", writes nothing.
        const { section } = wire({ cfg: {
            swapQuestion: () => [REST],
            project: (/** @type {any} */ { swapAnswers }) => ({ counts: { writing: swapAnswers.get(REST) ? 1 : 0 } }),
        } });
        setRange(section, REST, REST);
        answer(REST, 'no');
        assert.equal(el('alSaveBtn').disabled, true, 'answered free: nothing to record');
        answer(REST, 'yes');
        assert.equal(el('alSaveBtn').disabled, false, 'answered swapped: one day to record');
    });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// E. THE RECEIPT NAMES WHAT IT LEFT ALONE, AND WHO IT WAS FOR (polish round 2)
// ════════════════════════════════════════════════════════════════════════════════════════════════
//
// .claude/rules/admin.md → "AL on a rest day is ASKED about": "Rest day — free" means nothing is written, and the
// save receipt NAMES the days it left alone — on BOTH surfaces. The week grid did (v23.88, and the
// kept-leave wording at v23.93); this card said only "Recorded N days", so a rest day answered free
// vanished from the one line the manager reads after pressing Save. These run the REAL projection
// and the REAL swap question (`admin-al.js` wires exactly these two), through the real listener.

const { projectAlBooking } = await import('./admin-al-projection.js');
const { swapDecisionDates } = await import('./al-swapped-days.js');
const { getBaseShift, parseISODate } = await import('./roster-data.js');
const { isRestShift } = await import('./override-utils.js');

describe('the receipt names the rest days it left alone', () => {
    const MEMBER_OBJ = /** @type {any} */ (teamMembers.find(m => m.name === MEMBER));
    const iso = (/** @type {Date} */ d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    /** A working weekday followed by a non-Sunday rest day, found from the roster, never written down. */
    const pair = (() => {
        for (let i = 0; i < 200; i++) {
            const a = new Date(2026, 9, 1 + i), b = new Date(2026, 9, 2 + i);
            if (a.getDay() === 0 || b.getDay() === 0) continue;
            if (isRestShift(getBaseShift(MEMBER_OBJ, parseISODate(iso(a))))) continue;
            if (!isRestShift(getBaseShift(MEMBER_OBJ, parseISODate(iso(b))))) continue;
            return { work: iso(a), rest: iso(b) };
        }
        return null;
    })();

    const realAlCfg = { cfg: {
        swapQuestion: (/** @type {any} */ a) => swapDecisionDates(a),
        project: (/** @type {any} */ { dates, memberObj, ovByDate, swapAnswers }) =>
            projectAlBooking({ member: memberObj, dates, ovByDate, swapAnswers }),
    } };
    const answer = (/** @type {string} */ date, /** @type {'yes'|'no'} */ ans) => {
        const target = { closest: () => ({ dataset: { date, answer: ans } }) };
        for (const fn of el('alPreview')._on.click ?? []) fn({ target });
    };
    const answerFree = (/** @type {string} */ date) => answer(date, 'no');

    test('the roster offers the case (a working day followed by a rest day)', () => {
        assert.ok(pair, `no working day followed by a rest day for ${MEMBER} — the cases below prove nothing`);
    });

    test('a rest day answered "free" is NAMED in the receipt, and was not written', async () => {
        // Teeth: replacing `_showSaved(…, leftAlone)` with the old bare setStatus, or returning []
        // from `_leftAloneLines`, fails here — the receipt is back to the count alone.
        const { work, rest } = /** @type {any} */ (pair);
        const { section } = wire(realAlCfg);
        setRange(section, work, rest);
        answerFree(rest);
        assert.equal(el('alSaveBtn').disabled, false, 'answered: the working day is recordable');
        await save();

        assert.deepEqual(_writes[0].swappedDates, [], 'answered free: nothing declared swapped');
        const fb = el('alFeedback');
        assert.equal(fb.className, 'feedback success');
        assert.match(fb.textContent, new RegExp(`${rest} — rest day, no leave recorded`),
            "the left-alone day must be named, in the week grid's own words");
        assert.doesNotMatch(fb.textContent, new RegExp(`${work} — rest day`), 'the recorded day is not a rest day');
    });

    test('a rest day that ALREADY held leave is named as kept, not as clear (v23.93 wording)', async () => {
        // The Calendar will go on showing leave there; "no leave recorded" would contradict it.
        const { work, rest } = /** @type {any} */ (pair);
        _ovMap = new Map([[rest, { id: 'old1', date: rest, type: 'annual_leave', value: 'AL' }]]);
        const { section } = wire(realAlCfg);
        setRange(section, work, rest);
        answerFree(rest);
        await save();
        const text = el('alFeedback').textContent;
        assert.match(text, new RegExp(`${rest} — rest day; the leave already recorded here was left as it is`));
        assert.doesNotMatch(text, /no leave recorded/);
    });

    // THE MIRROR OF THE "FREE" CASE (test audit, 7 Nov 2026). Only "free" was ever saved, and it
    // expects [] — so the write could send an empty list for every answer, and the toast would quietly
    // count one day fewer than the preview and the allowance bar had just shown.
    test('a rest day answered "swapped" is written AS swapped', async () => {
        const { work, rest } = /** @type {any} */ (pair);
        const { section } = wire(realAlCfg);
        setRange(section, work, rest);
        answer(rest, 'yes');
        await save();
        assert.equal(_writes.length, 1, 'premise: the save ran');
        assert.deepEqual(_writes[0].swappedDates, [rest], 'the declared swap never reached the write');
    });

    test('the allowance check is handed the same answers the save is about to write', async () => {
        // The check projects this save; until the write runs, a declared swap exists nowhere else.
        // Handed an empty map, it under-counts by every swapped day — the v23.79 regression.
        const { work, rest } = /** @type {any} */ (pair);
        /** @type {any[]} */ const seen = [];
        const { section } = wire({ ...realAlCfg, preSave: (/** @type {any} */ a) => { seen.push(a); return false; } });
        setRange(section, work, rest);
        answer(rest, 'yes');
        await save();
        assert.equal(seen.length, 1, 'premise: the check ran once');
        assert.equal(seen[0].swapAnswers.get(rest), true, 'the check was not told about the swap');
        assert.deepEqual(seen[0].dates, [work, rest]);
    });

    test('a range with no rest day adds no receipt lines', async () => {
        const { work } = /** @type {any} */ (pair);
        const { section } = wire(realAlCfg);
        setRange(section, work, work);
        await save();
        assert.doesNotMatch(el('alFeedback').textContent, /rest day/);
    });
});

describe("the receipt keeps the member's name on one line", () => {
    test('the name is its own nowrap span, and the sentence reads back whole', async () => {
        // Teeth: `setStatus(feedbackEl, text)` alone (the old line) leaves no `.feedback-name` child.
        // "Recorded 4 days of Annual Leave for R. / Forrester-Blackstock" broke at 390px.
        const { section } = wire();
        setRange(section, '2026-10-05', '2026-10-06');
        _record = async () => ({ workingCount: 2 });
        await save();
        const fb = el('alFeedback');
        assert.equal(fb.textContent, `✓ Recorded 2 days for ${MEMBER}`, 'the sentence is unchanged');
        const name = fb._kids.find((/** @type {any} */ k) => k.className === 'feedback-name');
        assert.ok(name, 'the member name must be wrapped so CSS can keep it on one line');
        assert.equal(name.textContent, MEMBER);
    });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE WHOLE-APP CHECK (10 Nov 2026). Each case below fails on the code before the fix.
// ════════════════════════════════════════════════════════════════════════════════════════════════

const iso10 = (/** @type {Date} */ d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** Whether `m` works `date` on the base roster. @param {any} m @param {string} date */
const works = (m, date) => !isRestShift(getBaseShift(m, parseISODate(date)));

// F. ONE PICTURE OF THE MEMBER: a save decides nothing from records that have not been read. The
// preview, the allowance check, the answers and the receipt were all decided from the cache as it
// stood at the click while the write waited for the read and decided again — so the click refuses,
// as the week grid's does, in its words.
describe('F. a save on a member whose records have not been read is refused, not half-decided', () => {
    test('still loading: nothing is checked, nothing is written, and it says so', async () => {
        const { section, calls } = wire();
        setRange(section, '2026-10-05', '2026-10-07');
        _authority = false;
        await save();
        assert.equal(_writes.length, 0, 'the write must not run on two pictures of the member');
        assert.equal(calls.preSave.length, 0, 'the allowance check must not run on records that have not arrived');
        assert.match(el('alFeedback').textContent, /Still loading this member's saved changes — try again in a moment/);
        assert.equal(el('alFeedback').className, 'feedback error');
    });

    test('a read that failed says to reload, not to wait', async () => {
        const { section } = wire();
        setRange(section, '2026-10-05', '2026-10-07');
        _authority = false; _loadFailed = true;
        await save();
        assert.equal(_writes.length, 0);
        assert.match(el('alFeedback').textContent, /Couldn't load this member's saved changes — reload the page/);
    });

    test('once the read has landed, the same press books', async () => {
        const { section } = wire();
        setRange(section, '2026-10-05', '2026-10-07');
        _authority = false;
        await save();
        _authority = true;
        await save();
        assert.equal(_writes.length, 1);
    });
});

// G. THE CLICK ACTS ON THE RECORD AS IT STANDS NOW. A period deleted from the list under a drawn
// preview turns a settled rest day into an unasked one; the old click wrote the other days and left
// it out without a word. It is asked, by redrawing the question, and the save refuses until answered.
describe('G. a rest day that needs the question at the click is asked, never silently left out', () => {
    const MEMBER_OBJ = /** @type {any} */ (teamMembers.find(m => m.name === MEMBER));
    const pair = (() => {
        for (let i = 0; i < 200; i++) {
            const a = new Date(2026, 9, 1 + i), b = new Date(2026, 9, 2 + i);
            if (a.getDay() === 0 || b.getDay() === 0) continue;
            if (works(MEMBER_OBJ, iso10(a)) && !works(MEMBER_OBJ, iso10(b))) return { work: iso10(a), rest: iso10(b) };
        }
        return null;
    })();
    const realAlCfg = { cfg: {
        swapQuestion: (/** @type {any} */ a) => swapDecisionDates(a),
        project: (/** @type {any} */ { dates, memberObj, ovByDate, swapAnswers }) =>
            projectAlBooking({ member: memberObj, dates, ovByDate, swapAnswers }),
    } };
    const answer = (/** @type {string} */ date, /** @type {'yes'|'no'} */ a) => {
        const target = { closest: () => ({ dataset: { date, answer: a } }) };
        for (const fn of el('alPreview')._on.click ?? []) fn({ target });
    };

    test('the record under the drawn preview goes, and the save asks instead of writing', async () => {
        assert.ok(pair, 'premise: a working day followed by a rest day');
        const { work, rest } = /** @type {any} */ (pair);
        // The rest day holds a recorded swap, so nothing is asked and the preview counts it.
        _ovMap = new Map([[rest, { id: 'old', date: rest, type: 'annual_leave', value: 'AL', replacedType: 'shift' }]]);
        const { section } = wire(realAlCfg);
        setRange(section, work, rest);
        assert.equal(el('alSaveBtn').disabled, false, 'premise: nothing to answer, so Save is live');
        assert.doesNotMatch(el('alPreview').innerHTML, /swapday-ask/, 'premise: no question on screen');
        _ovMap = new Map();          // the period is deleted from the list below; the preview is not redrawn
        await save();
        assert.equal(_writes.length, 0, 'four days written and the fifth dropped without a word');
        assert.match(el('alFeedback').textContent, new RegExp(`${rest}: say whether this rest day was a swapped working day`));
        assert.match(el('alPreview').innerHTML, new RegExp(`swapday-ask[\\s\\S]*data-date="${rest}"`), 'the question is on screen now');
        assert.equal(el('alSaveBtn').disabled, true, 'and Save waits for it');
        answer(rest, 'yes');
        await save();
        assert.deepEqual(_writes[0]?.swappedDates, [rest], 'answered, it books');
    });
});

// H. A WORKED SUNDAY IS SET AS A REST DAY, AND THE CARDS SAY SO. The writer puts a `correction`/RD on
// every worked Sunday in a leave or absence range (admin.md); the preview called it "rest day skipped"
// and the receipt said nothing, so a "Set as Rest Day" row nobody asked for appeared in Saved Changes.
// The REAL cards, wired as the page wires them.
const { initALSection } = await import('./admin-al.js');
const { initSickSection } = await import('./admin-sick.js');
describe('H. the Sunday a range sets as a rest day is named in the preview and the receipt', () => {
    beforeEach(() => { _realWorkingDate = true; });   // the cards' own rest-day count, Sundays included
    /** A Saturday and Monday worked either side of a worked Sunday, found from the roster. */
    const weekend = (() => {
        for (const m of teamMembers.filter(x => !x.hidden && !x.managerOnly)) {
            for (let i = 0; i < 365; i++) {
                const sun = new Date(2026, 9, 4 + i);
                if (sun.getDay() !== 0) continue;
                const sat = new Date(sun.getFullYear(), sun.getMonth(), sun.getDate() - 1);
                const mon = new Date(sun.getFullYear(), sun.getMonth(), sun.getDate() + 1);
                if ([sat, sun, mon].every(d => works(m, iso10(d)))) return { m, dates: [sat, sun, mon].map(iso10) };
            }
        }
        return null;
    })();
    /** The page's own deps for both cards, inert where a test does not read them. */
    const deps = (/** @type {string} */ name) => ({
        alMember: memberSelect(name), sickMember: memberSelect(name),
        syncMemberDisplay() {}, syncSickMemberDisplay() {}, populateMemberDropdown() {}, lastMember: null,
        updateALBanner() {}, updateALBookedBox() {}, updateSickBookedBox() {}, setALPickerYear() {},
        getCurrentUser: () => 'A. Admin', showALConfirm() {}, hideALConfirm() {}, showInChangeAShift() {}, showSuccess() {},
    });
    const open = (/** @type {string} */ prefix, /** @type {string} */ from, /** @type {string} */ to) => {
        el(prefix + 'From').value = from; el(prefix + 'To').value = to;
        for (const fn of el(prefix + 'To')._on.change ?? []) fn();
    };

    test('premise: some member works a Saturday, the Sunday after it and the Monday', () => {
        assert.ok(weekend, 'no worked Sunday between two worked days on the roster — the cases below prove nothing');
    });

    test('Annual Leave: the preview names it, and does not count it as a rest day skipped', () => {
        const { m, dates } = /** @type {any} */ (weekend);
        for (const id of ['alFrom', 'alTo', 'alPreview', 'alSaveBtn', 'alFeedback']) el(id);
        initALSection(/** @type {any} */ (deps(m.name)));
        open('al', dates[0], dates[2]);
        assert.match(el('alPreview').innerHTML, /1 Sunday set as a rest day/);
        assert.doesNotMatch(el('alPreview').innerHTML, /rest day skipped/);
    });

    test('Absence: the same', () => {
        const { m, dates } = /** @type {any} */ (weekend);
        for (const id of ['sickFrom', 'sickTo', 'sickPreview', 'sickSaveBtn', 'sickFeedback']) el(id);
        initSickSection(/** @type {any} */ (deps(m.name)));
        open('sick', dates[0], dates[2]);
        assert.match(el('sickPreview').innerHTML, /1 Sunday set as a rest day/);
        assert.doesNotMatch(el('sickPreview').innerHTML, /rest day skipped/);
    });

    test('the receipt names the Sunday the writer set — and only when the writer says it did', async () => {
        const { m, dates } = /** @type {any} */ (weekend);
        const run = async (/** @type {number} */ sundayCount) => {
            _els = {}; _writes = [];
            _record = async () => ({ workingCount: 2, sundayCount });
            const { section } = wire({ member: m.name });
            setRange(section, dates[0], dates[2]);
            await save();
            return el('alFeedback').textContent;
        };
        assert.match(await run(1), new RegExp(`${dates[1]} — Sunday, set as a rest day`));
        assert.doesNotMatch(await run(0), /Sunday/, 'a correction the writer did not make is not reported');
    });
});

// I. ONE FADE PER FEEDBACK LINE. The success fade was the card's own timer, and the line is shared
// with the list below that reports its deletes; a later message could be taken down by an earlier
// message's fade — including an error, or a receipt that is meant never to time out.
describe('I. a message on the feedback line is never taken down by an earlier one\'s fade', () => {
    test('premise: a plain success fades after seven seconds', async () => {
        const { section } = wire();
        setRange(section, '2026-10-05', '2026-10-06');
        await save();
        assert.equal(el('alFeedback').className, 'feedback success');
        mock.timers.tick(7000);
        assert.equal(el('alFeedback').className, 'feedback');
    });

    test('a refusal three seconds after a success is still up when the success\'s fade comes due', async () => {
        const { section } = wire();
        setRange(section, '2026-10-05', '2026-10-06');
        await save();                                     // t=0: success, its fade due at 7s
        mock.timers.tick(3000);
        setRange(section, '2026-10-05', '2026-10-06');
        _otherSaveInFlight = true;
        await save();                                     // t=3s: refused — another save is sending
        mock.timers.tick(4500);                           // t=7.5s
        assert.equal(el('alFeedback').className, 'feedback error');
        assert.match(el('alFeedback').textContent, /Another change is still saving/);
    });

    test('a fade started elsewhere on the same line does not hide a receipt that names days', async () => {
        const { fadeFeedback } = await import('./admin-booked-periods.js');
        const { section } = wire({ cfg: { swapQuestion: () => [], project: () => ({ counts: { writing: 1 }, answeredFree: ['2026-10-06'] }) } });
        fadeFeedback(el('alFeedback'), 'feedback', 6000);    // the list below reported a delete
        setRange(section, '2026-10-05', '2026-10-06');
        await save();                                         // a receipt with a named day: no fade
        mock.timers.tick(10_000);
        assert.equal(el('alFeedback').className, 'feedback success');
    });
});

// J. A REFUSED WRITE IS A SIGN-IN PROBLEM, NOT THE CONNECTION — the week grid's own wording.
describe('J. a refused write is worded as the week grid words it', () => {
    test('permission-denied', async () => {
        const { section } = wire();
        setRange(section, '2026-10-05', '2026-10-06');
        _record = async () => { throw Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' }); };
        await save();
        assert.match(el('alFeedback').textContent, /Couldn't save — you may have been signed out\. Please sign in again\./);
        assert.doesNotMatch(el('alFeedback').textContent, /connection/);
    });
});

// K. A SAVE CLEARS THE RANGE AND KEEPS THE MONTH (owner's decided default, 10 Nov 2026), so the
// banner above stays on the year just booked rather than switching under "✓ Recorded".
describe('K. a save keeps the picker on the month it was showing', () => {
    test('the reset after a save keeps the view', async () => {
        const { section } = wire();
        setRange(section, '2026-10-05', '2026-10-06');
        await save();
        assert.deepEqual(_resetArgs, [{ keepView: true }]);
    });
});
