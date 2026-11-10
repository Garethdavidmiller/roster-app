// links-generator-targets.test.mjs — the generator card's target table and its saved staffing setups,
// driven through the REAL module: its listeners, its state and the sentences it writes.
//
// Until Nov 2026 this module had no unit test, because it imports the Firebase client, and every
// defect the whole-app review found in it was a SEQUENCE — two keystrokes, a setup changed between
// two reads, a press during a write that cannot finish — which neither the pure rules it renders
// (`links-target-sets.test.mjs`) nor a one-edit e2e could reach. Three imports are replaced, so this
// file needs module mocks (the test:unit lane): the Firebase client by a small in-memory server that
// records every write and runs the real setups store's transactions, the overlay's dialogs by
// scripted answers, and the select sheet by nothing. The DOM is plain objects that keep their
// listeners, so a test fires the events a designer would.
import { test, describe, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ── localStorage, for `ls.js` (each design's working table is remembered there) ────────────────────
const stored = new Map();
globalThis.localStorage = /** @type {any} */ ({
    getItem: (/** @type {string} */ k) => (stored.has(k) ? stored.get(k) : null),
    setItem: (/** @type {string} */ k, /** @type {string} */ v) => { stored.set(k, String(v)); },
    removeItem: (/** @type {string} */ k) => { stored.delete(k); },
});

// ── the DOM: one stand-in per id, keeping its listeners ───────────────────────────────────────────
/** @type {Map<string, any>} */
let els = new Map();
function el(/** @type {string} */ id) {
    if (!els.has(id)) {
        /** @type {Record<string, Function[]>} */ const listeners = {};
        els.set(id, {
            id, value: '', max: '', hidden: false, disabled: false, textContent: '', innerHTML: '', className: '',
            dataset: {}, listeners, classList: { toggle() {}, add() {}, remove() {} },
            addEventListener(/** @type {string} */ type, /** @type {Function} */ fn) { (listeners[type] ||= []).push(fn); },
            setAttribute() {}, closest() { return null; },
        });
    }
    return els.get(id);
}
globalThis.document = /** @type {any} */ ({ getElementById: el, querySelectorAll: () => [] });
/** Fire an event at an element, awaiting each listener the way the browser would not need to. */
async function fire(/** @type {string} */ id, /** @type {string} */ type, event = {}) {
    for (const fn of el(id).listeners[type] ?? []) await fn(event);
}
/** A count box in the table, as the delegated listeners on the tbody receive it. */
function countBox(/** @type {number} */ slot, /** @type {string} */ cls, /** @type {string} */ value) {
    return {
        value, dataset: { slot: String(slot), class: cls }, classList: { toggle() {} },
        closest(/** @type {string} */ sel) { return sel === '.gen-slot-count' ? this : null; },
    };
}
/** Let the queued promise chains (a list read, a save) run to the end. */
const settle = () => new Promise(r => setImmediate(r));

// ── the server: the setups collection, every write that reached it, and how it misbehaves ──────────
const server = {
    /** @type {Map<string, any>} */ sets: new Map(),
    clock: 1,
    /** @type {Array<{op: string, id?: string, payload?: any}>} */ writes: [],
    /** `addDoc` never settles — the SDK's behaviour offline, where it resolves only on the server's ack. */
    hangAdd: false,
    /** @type {any} an error every transaction throws */ txFails: null,
};
const stamp = () => { const n = ++server.clock; return { toMillis: () => n }; };
const SILVA = { name: 'Winter', createdBy: 'S. Silva', updatedBy: 'S. Silva', spareLines: 5,
    slots: [{ time: '06:20-14:20', weekday: 3, sat: 2, sun: 1 }, { time: '15:25-23:55', weekday: 3, sat: 2, sun: 1 }] };
const MINE = { name: 'Spring', createdBy: 'M. Robson', updatedBy: 'M. Robson', spareLines: 4,
    slots: [{ time: '07:15-15:45', weekday: 2, sat: 1, sun: 1 }] };

mock.module('./firebase-client.js', { namedExports: {
    db: {},
    COLLECTIONS: { linkTargetSets: 'linkTargetSets' },
    collection: () => ({ path: 'linkTargetSets' }),
    doc: (/** @type {any} */ _db, /** @type {string} */ _path, /** @type {string} */ id) => ({ id }),
    serverTimestamp: () => 'SERVER_TS',
    getDocs: async () => ({
        forEach: (/** @type {Function} */ fn) => { for (const [id, data] of server.sets) fn({ id, data: () => data }); },
    }),
    addDoc: (/** @type {any} */ _col, /** @type {any} */ payload) => {
        server.writes.push({ op: 'add', payload });
        if (server.hangAdd) return new Promise(() => {});
        const id = `new-${server.writes.length}`;
        server.sets.set(id, { ...payload, updatedAt: stamp() });
        return Promise.resolve({ id });
    },
    runTransaction: async (/** @type {any} */ _db, /** @type {Function} */ fn) => {
        if (server.txFails) throw server.txFails;
        /** @type {Function[]} */ const commit = [];
        await fn({
            get: async (/** @type {any} */ ref) => ({ exists: () => server.sets.has(ref.id), data: () => server.sets.get(ref.id) }),
            set: (/** @type {any} */ ref, /** @type {any} */ payload) => commit.push(() => {
                server.writes.push({ op: 'set', id: ref.id, payload });
                server.sets.set(ref.id, { ...payload, updatedAt: stamp() });
            }),
            delete: (/** @type {any} */ ref) => commit.push(() => {
                server.writes.push({ op: 'delete', id: ref.id });
                server.sets.delete(ref.id);
            }),
        });
        for (const c of commit) c();
    },
    writeWithClaimRetry: (/** @type {Function} */ fn) => fn(),
} });

/** What the dialogs answer, and what they were asked. */
const dialogs = { confirm: true, /** @type {string|null} */ prompt: null, /** @type {string[]} */ asked: [], prompted: 0 };
mock.module('./overlay.js', { namedExports: {
    confirmDialog: async (/** @type {any} */ o) => { dialogs.asked.push(o.message); return dialogs.confirm; },
    promptDialog: async () => { dialogs.prompted++; return dialogs.prompt; },
    createLightbox: () => ({}),
} });
mock.module('./select-sheet.js', { namedExports: { enhanceSelect: () => {} } });

const { createTargetPanel } = await import('./links-generator-targets.js');

/** A fresh card for M. Robson (not the admin), with the setups list read and on screen. */
async function openCard() {
    els = new Map();
    el('genSpareLines').max = '25';
    const panel = createTargetPanel({
        getActiveDesignId: () => 'd1', currentUser: 'M. Robson', isAdmin: false,
        sessionReady: Promise.resolve(), buildShiftOptions: () => '', defaultSlotTime: '06:20-14:20',
    });
    await settle();
    return panel;
}
/** Pick a setup in the picker, as the select's change does. */
async function pick(/** @type {string} */ id) {
    el('genSetSelect').value = id;
    await fire('genSetSelect', 'change');
}
const hint = () => String(el('genSetHint').textContent);
/** The table as this device remembers it. */
const remembered = () => JSON.parse(stored.get('myb_links_gen_d1') ?? 'null');

beforeEach(() => {
    stored.clear();
    server.sets = new Map([['W', { ...SILVA, updatedAt: stamp() }], ['S', { ...MINE, updatedAt: stamp() }]]);
    server.writes = []; server.hangAdd = false; server.txFails = null;
    dialogs.confirm = true; dialogs.prompt = null; dialogs.asked = []; dialogs.prompted = 0;
});

// ── WHERE THE TABLE IS, relative to the setup it came from (whole-app review, Nov 2026) ─────────────
describe('the sets row says where the table is relative to the setup', () => {
    test('a second edit after Use setup still reads as changed — not as never loaded', async () => {
        // Each edit refreshed the row and THEN cleared the setup's id with the name, so the first
        // keystroke read "You have changed the table since loading it" and the second "Press Use
        // setup to bring these shift times into the table", offering to load it over the work.
        await openCard();
        await pick('W');
        await fire('genSetLoadBtn', 'click');
        assert.match(hint(), /still matches it/);
        await fire('genSlotRows', 'input', { target: countBox(0, 'weekday', '7') });
        assert.match(hint(), /You have changed the table since loading it/, 'first edit');
        await fire('genSlotRows', 'input', { target: countBox(0, 'weekday', '72') });
        assert.match(hint(), /You have changed the table since loading it/, 'second edit');
        assert.doesNotMatch(hint(), /Press Use setup/);
        await fire('genSpareLines', 'input', { target: Object.assign(el('genSpareLines'), { value: '6' }) });
        assert.match(hint(), /You have changed the table since loading it/, 'an edit of another kind');
        // The NAME still drops on an edit (header rule 2): the note must not call this the setup.
        assert.equal(remembered().setName, '');
        assert.equal(remembered().setId, 'W', 'the setup it came from is remembered with the table');
    });

    test('typed back to the setup\'s own numbers, it matches again', async () => {
        await openCard();
        await pick('W');
        await fire('genSetLoadBtn', 'click');
        await fire('genSlotRows', 'input', { target: countBox(0, 'weekday', '7') });
        await fire('genSlotRows', 'input', { target: countBox(0, 'weekday', '3') });
        assert.match(hint(), /still matches it/);
    });

    test('"still matches" is asked of the setup as it stands now, not of the copy taken at load', async () => {
        // The owner overwrote the setup; this page re-read the list. The table was untouched here,
        // so "you have changed the table" would be false too — and would offer Save changes, pushing
        // the old numbers over the new. Use setup is the true next step.
        const panel = await openCard();
        await pick('W');
        await fire('genSetLoadBtn', 'click');
        assert.match(hint(), /still matches it/, 'premise: loaded and matching');
        server.sets.set('W', { ...SILVA, slots: [{ time: '06:20-14:20', weekday: 9, sat: 9, sun: 9 }], updatedAt: stamp() });
        await fire('genSetRetryBtn', 'click');
        await settle();
        await pick('W');
        assert.doesNotMatch(hint(), /still matches/, `the table is ${JSON.stringify(panel.getTable().slots)}`);
        assert.doesNotMatch(hint(), /You have changed the table/);
        assert.match(hint(), /Press Use setup/);
        dialogs.asked = [];
        await fire('genSetLoadBtn', 'click');
        assert.deepEqual(dialogs.asked, [], 'nothing was changed here, so Use setup does not ask');
        assert.deepEqual(panel.getTable().slots, [{ time: '06:20-14:20', weekday: 9, sat: 9, sun: 9 }]);
        assert.match(hint(), /still matches it/);
    });

    test('deleting the setup the table came from stops the row and the stored stamp naming it', async () => {
        await openCard();
        await pick('S');
        await fire('genSetLoadBtn', 'click');
        await fire('genSlotRows', 'input', { target: countBox(0, 'weekday', '5') });
        assert.equal(remembered().setId, 'S', 'premise: the edited table remembers its setup');
        await fire('genSetDeleteBtn', 'click');
        assert.deepEqual(server.writes.map(w => w.op), ['delete']);
        assert.equal(remembered().setId, '', 'a deleted setup is no longer where the table came from');
        assert.equal(remembered().setName, '');
    });
});

// ── THE BOX SHOWS WHAT THE TABLE HOLDS (whole-app review, Nov 2026) ─────────────────────────────────
// The handlers keep a whole, non-negative count and cap the cover weeks, and left the typed text in
// the box: 99 cover weeks on screen over a table holding 25, -3 or 2.7 over 0 or 2. Written back when
// the typing ends (`change`), so the box never fights a keystroke (`input` leaves it alone).
describe('a number box shows what the table holds once the typing is over', () => {
    test('cover weeks over the cap', async () => {
        const panel = await openCard();
        const box = Object.assign(el('genSpareLines'), { value: '99' });
        await fire('genSpareLines', 'input', { target: box });
        assert.equal(panel.getTable().spareLines, 25, 'premise: the table holds the capped figure');
        assert.equal(box.value, '99', 'while typing, the box is left alone');
        await fire('genSpareLines', 'change', { target: box });
        assert.equal(box.value, '25');
    });

    test('a negative or a fractional headcount', async () => {
        const panel = await openCard();
        for (const [typed, held] of [['-3', '0'], ['2.7', '2']]) {
            const box = countBox(0, 'sat', typed);
            await fire('genSlotRows', 'input', { target: box });
            assert.equal(String(panel.getTable().slots[0].sat), held, `premise: ${typed} is held as ${held}`);
            assert.equal(box.value, typed, 'while typing, the box is left alone');
            await fire('genSlotRows', 'change', { target: box });
            assert.equal(box.value, held, `${typed} is shown as ${held}`);
        }
    });
});
