// @ts-check
/**
 * links-design-library.test.mjs — the import panel and the Recently deleted bin, driven through the
 * listeners the module actually wires (v24.51, when they left links-app.js).
 * Run with: node --test --experimental-test-module-mocks links-design-library.test.mjs
 *
 * WHAT THIS PINS. The split moved two panels across a module boundary, and the boundary is where a
 * refactor goes wrong silently: a context callback never called, a list the coordinator still
 * thinks it owns, a wait that used to be a closure over a map now living somewhere else. So these
 * tests drive the module the way the page does — a click on a row, the Check and Save buttons — and
 * assert on what reached the store and the coordinator, not on what a helper returns.
 *
 * The e2e suite (e2e/pages.spec.js, the `links:` bin and import tests) still covers the panels as a
 * user sees them; this file covers the seam between the library and the coordinator, which a browser
 * test cannot see.
 */

import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// ── A FAKE DOM: elements on demand, listeners recorded so a test can fire them ──────────────────
/** @type {Record<string, any>} */
let _els = {};
function el(/** @type {string} */ id) {
    return (_els[id] ??= {
        id, value: '', hidden: false, disabled: false, textContent: '', className: '', innerHTML: '',
        /** @type {Record<string, Function[]>} */ _on: {},
        addEventListener(/** @type {string} */ t, /** @type {Function} */ fn) { (this._on[t] ??= []).push(fn); },
    });
}
/** @param {string} id @param {string} type @param {any} [ev] */
async function fire(id, type, ev = {}) { for (const fn of el(id)._on[type] ?? []) await fn(ev); }
global.document = /** @type {any} */ ({ getElementById: (/** @type {string} */ id) => el(id) });

// ── MOCKS: the CDN-loading Firebase client, and the overlay (DOM lifecycle) ─────────────────────
/** @type {boolean} */ let _confirmAnswer = true;
mock.module('./firebase-client.js', { namedExports: { serverTimestamp: () => 'SERVER_TS' } });
mock.module('./overlay.js', {
    namedExports: {
        createLightbox: () => ({ open() {}, close() {} }),
        confirmDialog: async () => _confirmAnswer,
    },
});

const { createDesignLibrary } = await import('./links-design-library.js');

/** A recording store and context. @param {{ restore?: Function, create?: Function }} [over] */
function setup(over = {}) {
    _els = {};
    _confirmAnswer = true;
    const calls = /** @type {Record<string, any[]>} */ ({ restore: [], purge: [], create: [], add: [], activate: [], picker: [], status: [] });
    /** @type {any[]} */ const designs = [];
    let open = false;
    let dirty = false;
    const store = {
        restore: over.restore ?? (async (/** @type {string} */ id) => { calls.restore.push(id); return { status: 'ok', updatedAt: null, revision: 2 }; }),
        purge: async (/** @type {string} */ id) => { calls.purge.push(id); return 'removed'; },
        create: over.create ?? (async (/** @type {any} */ payload) => { calls.create.push(payload); return { id: 'new1', updatedAt: null, baseline: { loadedRevision: 1 } }; }),
    };
    const lib = createDesignLibrary({
        store, currentUser: 'G. Miller',
        getDesigns: () => designs,
        addDesign: (d) => { designs.push(d); calls.add.push(d.id); },
        activate: (d) => { calls.activate.push(d.id); open = true; },
        isDirty: () => dirty,
        hasOpenDesign: () => open,
        renderPicker: () => { calls.picker.push(1); },
        refreshLists: async () => {},
        actionStatus: (msg) => { calls.status.push(msg); },
        getHeader: () => null,
    });
    return { lib, calls, designs, setOpen: (/** @type {boolean} */ v) => { open = v; }, setDirty: (/** @type {boolean} */ v) => { dirty = v; } };
}

/** Let the work a listener STARTED finish — the bin's click handler fires restore/purge and does not
 *  return the promise, exactly as a browser event listener would not. */
const settle = () => new Promise(r => setTimeout(r, 10));
/** Click a bin row's button the way the delegated listener sees it, and let it finish.
 *  @param {'.bin-restore'|'.bin-purge'} kind @param {string} id */
const clickBin = async (kind, id) => {
    await fire('designBinList', 'click', {
        target: { closest: (/** @type {string} */ sel) => sel === kind ? { dataset: { id } } : null },
    });
    await settle();
};

const BINNED = (/** @type {string} */ id, /** @type {string} */ name) => ({ id, name, patterns: {}, window: null, deletedAt: null, deletedBy: 'S. Silva' });

describe('the bin is the library\'s, and the coordinator reaches it through the interface', () => {
    beforeEach(() => {});

    test('setBin / addToBin / upsertBin keep one list, newest first, no duplicates', () => {
        const { lib } = setup();
        lib.setBin([BINNED('a', 'A')]);
        lib.addToBin(BINNED('b', 'B'));
        lib.upsertBin(BINNED('a', 'A again'));
        assert.deepEqual(lib.binList().map((/** @type {any} */ d) => d.id), ['a', 'b']);
        assert.equal(lib.binList()[0].name, 'A again');
    });

    test('a restore into an EMPTY workspace opens the design; into an open one it only lists it', async () => {
        const { lib, calls, setOpen } = setup();
        lib.setBin([BINNED('a', 'Alpha'), BINNED('b', 'Beta')]);
        await clickBin('.bin-restore', 'a');
        assert.deepEqual(calls.restore, ['a']);
        assert.deepEqual(calls.add, ['a']);
        assert.deepEqual(calls.activate, ['a'], 'nothing was open, so the restored design opens');
        assert.deepEqual(lib.binList().map((/** @type {any} */ d) => d.id), ['b']);
        setOpen(true);
        await clickBin('.bin-restore', 'b');
        assert.deepEqual(calls.activate, ['a'], 'a design is open now — the restore must not replace it');
        assert.equal(calls.picker.length, 1);
    });

    test('a restore of a design whose AUTOMATIC move is still in flight waits for it (v24.48)', async () => {
        const { lib, calls } = setup();
        lib.setBin([BINNED('old', 'Old 24')]);
        let land = () => {};
        lib.trackBinMove('old', new Promise(r => { land = () => r('moved'); }));
        await clickBin('.bin-restore', 'old');
        assert.deepEqual(calls.restore, [], 'it must not reach the store while the move is pending');
        land();
        await settle();
        assert.deepEqual(calls.restore, ['old']);
    });

    test('the duplicate-name rule holds on the way back from the bin', async () => {
        const { lib, calls, designs } = setup();
        designs.push({ id: 'live', name: 'Alpha' });
        lib.setBin([BINNED('a', 'Alpha')]);
        await clickBin('.bin-restore', 'a');
        assert.deepEqual(calls.restore, [], 'two designs of one name cannot be told apart in the list');
        assert.match(el('designBinStatus').textContent, /already a design called/);
    });

    test('remove for good asks first, and a cancel touches nothing', async () => {
        const { lib, calls } = setup();
        lib.setBin([BINNED('a', 'Alpha')]);
        _confirmAnswer = false;
        await clickBin('.bin-purge', 'a');
        assert.deepEqual(calls.purge, []);
        _confirmAnswer = true;
        await clickBin('.bin-purge', 'a');
        assert.deepEqual(calls.purge, ['a']);
        assert.deepEqual(lib.binList(), []);
    });
});

describe('import: check first, then save as a NEW design', () => {
    const GOOD = JSON.stringify({ name: 'Option A', patterns: { 1: { sun: 'RD', mon: '06:20-14:20', tue: 'SP', wed: 'RD', thu: 'RD', fri: 'RD', sat: 'RD' } } });

    test('unparseable text is refused and Save never appears', async () => {
        const { lib } = setup();
        await lib.openImport();
        el('linksImportText').value = '{oops';
        await fire('linksImportCheck', 'click');
        assert.equal(el('linksImportSave').hidden, true);
        assert.match(el('linksImportStatus').className, /li-status--bad/);
    });

    test('a good paste is checked, saved through the store, added and opened', async () => {
        const { lib, calls } = setup();
        await lib.openImport();
        el('linksImportText').value = GOOD;
        await fire('linksImportCheck', 'click');
        assert.equal(el('linksImportSave').hidden, false, 'Save appears only after a successful check');
        assert.equal(el('linksImportName').value, 'Option A', 'the pasted name fills an empty field');
        await fire('linksImportSave', 'click');
        assert.equal(calls.create.length, 1);
        assert.equal(calls.create[0].name, 'Option A');
        assert.deepEqual(calls.add, ['new1']);
        assert.deepEqual(calls.activate, ['new1']);
    });

    test('editing the paste after a check disarms Save — no saving one design having checked another', async () => {
        const { lib } = setup();
        await lib.openImport();
        el('linksImportText').value = GOOD;
        await fire('linksImportCheck', 'click');
        await fire('linksImportText', 'input');
        assert.equal(el('linksImportSave').hidden, true);
    });

    test('with unsaved work open, a declined confirm opens nothing', async () => {
        const { lib, setDirty } = setup();
        setDirty(true);
        _confirmAnswer = false;
        el('linksImportText').value = 'left over';
        await lib.openImport();
        assert.equal(el('linksImportText').value, 'left over', 'the panel was not reset or opened');
    });
});
