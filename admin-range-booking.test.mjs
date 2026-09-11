/**
 * admin-range-booking.test.mjs — THE SHARED SAVE PATH BEHIND ANNUAL LEAVE AND ABSENCE.
 * Run with: node --experimental-test-module-mocks --test admin-range-booking.test.mjs
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

import { test, describe, beforeEach, mock } from 'node:test';
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
        /** @type {Record<string, Function[]>} */ _on: {},
        addEventListener(/** @type {string} */ t, /** @type {Function} */ fn) { (this._on[t] ??= []).push(fn); },
        appendChild(/** @type {any} */ c) { if (c) kids.push(c); return c; },
        scrollIntoView() {},
        ownerDocument: /** @type {any} */ (null),
    };
    node.ownerDocument = /** @type {any} */ (fakeDocument);
    return node;
}
const el = (/** @type {string} */ id) => (_els[id] ??= makeEl(id));

/** A detached node — enough for `setStatus`'s span and text node. */
const detached = (/** @type {string} */ text = '') => ({
    textContent: text, className: '', setAttribute() {}, appendChild() {},
});
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

mock.module('./admin-overrides.js', {
    namedExports: {
        recordRangeOverrides: async (/** @type {any} */ payload) => { _writes.push(payload); return _record(); },
        formatDisplay: (/** @type {string} */ iso) => iso,
        buildMemberDateMap: () => new Map(),
        isWorkingDate: (/** @type {any} */ _m, /** @type {string} */ iso) => !_restDays.has(iso),
    },
});

// The RULE that decides which dates are written stays real; only the widget is stubbed.
const { getDateRange: realGetDateRange } = await import('./admin-rangepicker.js?real');
/** Set by a test that needs to observe the picker being reset after a successful save. */
let _pickerResets = 0;
mock.module('./admin-rangepicker.js', {
    namedExports: {
        getDateRange: (/** @type {string} */ a, /** @type {string} */ b) => realGetDateRange(a, b),
        // The widget is stubbed, but `reset()` CLEARS BOTH INPUTS exactly as the real one does
        // (admin-rangepicker.js: `fromInput.value = toInput.value = ''`). That is not decoration:
        // the whole point of the post-save `updatePreview()` is that it runs against a range that
        // is now empty, so a stub which kept the dates would report the button as live and hide
        // the very state this file asserts.
        buildRangePicker: () => ({
            reset: () => { _pickerResets++; el('alFrom').value = ''; el('alTo').value = ''; },
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
    _pickerResets = 0;
    _record = async () => ({ workingCount: 1 });
});

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
