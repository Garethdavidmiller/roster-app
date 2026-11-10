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
 * The e2e suite (e2e/links.spec.js, the `links:` bin and import tests) still covers the panels as a
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
/** Every confirm's message, in order. @type {string[]} */ let _confirmed = [];
mock.module('./firebase-client.js', { namedExports: { serverTimestamp: () => 'SERVER_TS' } });
mock.module('./overlay.js', {
    namedExports: {
        // Runs the lifecycle callbacks a real lightbox runs, so a panel's open/closed state is real.
        createLightbox: (/** @type {any} */ o) => ({ open() { o.onOpen?.(); }, close() { o.onClose?.(); } }),
        confirmDialog: async (/** @type {any} */ o) => { _confirmed.push(o?.message ?? ''); return _confirmAnswer; },
    },
});

const { createDesignLibrary } = await import('./links-design-library.js');
const { PROPOSALS } = await import('./links-proposals.js');

/** A recording store and context.
 *  @param {{ restore?: Function, create?: Function, purge?: Function, binIfStill?: Function, activeId?: () => any }} [over] */
function setup(over = {}) {
    _els = {};
    _confirmAnswer = true;
    _confirmed = [];
    const calls = /** @type {Record<string, any[]>} */ ({ restore: [], purge: [], create: [], add: [], activate: [], picker: [], status: [], tone: [], removed: [] });
    /** @type {any[]} */ const designs = [];
    let open = false;
    let dirty = false;
    const store = {
        restore: over.restore ?? (async (/** @type {string} */ id) => { calls.restore.push(id); return { status: 'ok', updatedAt: null, revision: 2 }; }),
        purge: over.purge ?? (async (/** @type {string} */ id) => { calls.purge.push(id); return 'removed'; }),
        create: over.create ?? (async (/** @type {any} */ payload) => { calls.create.push(payload); return { id: 'new1', updatedAt: null, baseline: { loadedRevision: 1 } }; }),
        binIfStill: over.binIfStill ?? (async () => 'moved'),
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
        actionStatus: (msg, tone) => { calls.status.push(msg); calls.tone.push(tone); },
        getHeader: () => null,
        removeDesigns: (ids) => { calls.removed.push([...ids]); },
        ...(over.activeId ? { activeId: over.activeId } : {}),
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

    test('a move that FAILED does not fail the restore that was waiting for it', async () => {
        const { lib, calls } = setup();
        lib.setBin([BINNED('old', 'Old 24')]);
        lib.trackBinMove('old', Promise.reject(new Error('offline')));
        await clickBin('.bin-restore', 'old');
        assert.deepEqual(calls.restore, ['old']);
        assert.match(el('designBinStatus').textContent, /restored/);
    });

    // The store's half of this is pinned in links-design-store.test.mjs; this is the WIRING — the
    // restored entry the coordinator receives must be built from `res.data`, because the bin row
    // here is the stale copy a colleague's save has since replaced (whole-app review, Oct 2026).
    test('a restored design is built from the server\'s copy, never from the stale bin row', async () => {
        const theirs = { 1: { sun: 'RD', mon: '07:15-15:15', tue: 'RD', wed: 'RD', thu: 'RD', fri: 'RD', sat: 'RD' } };
        const { lib, designs } = setup({
            restore: async () => ({ status: 'ok', updatedAt: null, revision: 10,
                data: { name: 'Alpha', patterns: theirs, window: null } }),
        });
        lib.setBin([{ ...BINNED('a', 'Alpha'), patterns: { 1: { sun: 'RD', mon: 'RD', tue: 'RD', wed: 'RD', thu: 'RD', fri: 'RD', sat: 'RD' } } }]);
        await clickBin('.bin-restore', 'a');
        assert.equal(designs.length, 1);
        assert.deepEqual(designs[0].patterns, theirs,
            'the server holds the colleague\'s newer patterns; pairing the bin row with revision 10 lets the next save overwrite them silently');
        assert.equal(designs[0].revision, 10);
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

// ── WHOLE-APP FIX, NOV 2026 ─────────────────────────────────────────────────────────────────────
const GOOD_IMPORT = JSON.stringify({ name: 'Option A', patterns: { 1: { sun: 'RD', mon: '06:20-14:20', tue: 'SP', wed: 'RD', thu: 'RD', fri: 'RD', sat: 'RD' } } });
/** Paste, check, and press Save; returns the Save's promise. */
const importIt = async (/** @type {any} */ lib, name = '') => {
    await lib.openImport();
    el('linksImportText').value = GOOD_IMPORT;
    await fire('linksImportCheck', 'click');
    if (name) el('linksImportName').value = name;
    return fire('linksImportSave', 'click');
};

describe('import: what a create that had to WAIT is called, and where it lands', () => {
    test('one QUEUED in this browser is not announced as a success (links-design-8)', async () => {
        // The ordinary Save in that state says it is in this browser, without the success colour;
        // the import said "Imported …" in green, with nothing to say it existed only here.
        const { lib, calls } = setup({ create: async () => ({ id: 'q1', updatedAt: null, queued: true, baseline: { loadedRevision: 1 } }) });
        await importIt(lib);
        assert.match(calls.status.at(-1), /Saved in this browser — it uploads the next time Links is open here with a connection/);
        assert.notEqual(calls.tone.at(-1), 'ok', 'not in the success colour');
        assert.notEqual(calls.tone.at(-1), 'err', 'and not as an error either');
    });

    test('…while one the server confirmed is, in the success colour', async () => {
        const { lib, calls } = setup();
        await importIt(lib);
        assert.doesNotMatch(calls.status.at(-1), /in this browser/);
        assert.equal(calls.tone.at(-1), 'ok');
    });

    test('one that lands after the panel was CLOSED is listed, never opened over the work in front (links-design-2)', async () => {
        // An online create resolves on the server's answer, so on a weak connection the designer
        // can close the panel and go back to their design while it waits. Opening the import when
        // it landed replaced whatever they had edited since.
        /** @type {() => void} */ let land = () => {};
        const { lib, calls } = setup({ create: () => new Promise(r => { land = () => r({ id: 'late1', updatedAt: null, baseline: { loadedRevision: 1 } }); }) });
        const saving = importIt(lib);
        await settle();
        await fire('linksImportCancel', 'click');
        land();
        await saving;
        assert.deepEqual(calls.add, ['late1'], 'the design exists, so it is in the list');
        assert.deepEqual(calls.activate, [], 'and it is NOT opened over the design the designer went back to');
        assert.match(calls.status.at(-1), /not opened/);
    });
});

describe('a saved design may not take a shortlisted proposal\'s name (links-design-6)', () => {
    // The proposals sit in the same picker and the same Compare chips as the saved designs, so a
    // design called "Balanced V6 — Dec 2026" beside the proposal of that name is the "cannot be told
    // apart in the list" case the naming rule exists to refuse. The rule was asked of saved designs only.
    test('an import refuses it, naming the proposal — whatever its case', async () => {
        const { lib, calls } = setup();
        await importIt(lib, PROPOSALS[0].name.toLowerCase());
        assert.deepEqual(calls.create, []);
        assert.match(el('linksImportStatus').textContent, /already a shortlisted proposal called/);
    });

    test('a binned design that has one comes back all the same — refusing would strand it — and is told to rename', async () => {
        // A proposal cannot be renamed, so "rename that one first" has no answer here: the restore
        // goes ahead, and the line says what to do about the clash.
        const name = PROPOSALS[0].name;
        const { lib, calls } = setup({ restore: async () => ({ status: 'ok', updatedAt: null, revision: 3, data: { name, patterns: {}, window: null } }) });
        lib.setBin([BINNED('b', name)]);
        await clickBin('.bin-restore', 'b');
        assert.equal(calls.add.length, 1);
        assert.match(el('designBinStatus').textContent, /shortlisted proposal has the same name — rename/);
    });
});

describe('the bin: one action at a time on a row (links-design-9)', () => {
    test('a second tap on Restore before the first answers runs nothing, and the bin says "restored"', async () => {
        // It ran a second restore, which found the design already live and reported, in the error
        // style and over the success line, that "someone else" had restored it.
        let asked = 0;
        /** @type {(v: any) => void} */ let answer = () => {};
        const { lib } = setup({ restore: () => { asked++; return new Promise(r => { answer = r; }); } });
        lib.setBin([BINNED('a', 'Alpha')]);
        await clickBin('.bin-restore', 'a');
        await clickBin('.bin-restore', 'a');
        answer({ status: 'ok', updatedAt: null, revision: 2 });
        await settle();
        assert.equal(asked, 1);
        assert.equal(el('designBinStatus').textContent, '“Alpha” restored.');
    });

    test('…and Remove for good on that row asks nothing until the restore has answered', async () => {
        /** @type {(v: any) => void} */ let answer = () => {};
        let purged = 0;
        const { lib } = setup({ restore: () => new Promise(r => { answer = r; }), purge: async () => { purged++; return 'restored-elsewhere'; } });
        lib.setBin([BINNED('a', 'Alpha')]);
        await clickBin('.bin-restore', 'a');
        await clickBin('.bin-purge', 'a');
        assert.deepEqual(_confirmed, [], 'no confirm while the row is busy');
        answer({ status: 'ok', updatedAt: null, revision: 2 });
        await settle();
        assert.equal(purged, 0);
    });

    test('a double tap on Remove for good asks once', async () => {
        const { lib } = setup();
        lib.setBin([BINNED('a', 'Alpha')]);
        const ev = { target: { closest: (/** @type {string} */ sel) => sel === '.bin-purge' ? { dataset: { id: 'a' } } : null } };
        fire('designBinList', 'click', ev);
        fire('designBinList', 'click', ev);   // before the first has answered
        await settle();
        assert.equal(_confirmed.length, 1, 'two confirms stacked, and two removals behind them');
    });

    test('a Restore button says WHICH design it restores, as Remove for good does', () => {
        const { lib } = setup();
        lib.setBin([BINNED('a', 'Alpha')]);
        lib.renderBinList();
        assert.match(el('designBinList').innerHTML, /class="bin-restore[^"]*"[^>]*aria-label="Restore Alpha"/);
    });
});

describe('Keep only the shortlist warns about unsaved work only when the open design moves (links-design-10)', () => {
    // `removeDesigns` replaces the working copy only when the open design is one of those moving, so
    // "Your unsaved changes to the open design will be lost" was false for every other open design.
    const OLD = { id: 'old1', name: 'Old', updatedBy: 'S. Silva', updatedAt: { toMillis: () => Date.UTC(2026, 8, 1) } };
    const RECENT = { id: 'new1', name: 'Recent', updatedBy: 'G. Miller', updatedAt: { toMillis: () => Date.UTC(2026, 10, 9) } };
    const press = async (/** @type {any} */ activeId) => {
        const s = setup({ activeId });
        s.designs.push(OLD, RECENT);
        s.setDirty(true);
        _confirmAnswer = false;   // read the dialog, then decline it
        await fire('keepShortlistBtn', 'click');
        await settle();
        return _confirmed.at(-1) ?? '';
    };
    test('the open design is a recent one, so nothing of it is lost', async () => {
        assert.doesNotMatch(await press(() => 'new1'), /will be lost/);
    });
    test('the open design is one of those moving: the warning stands', async () => {
        assert.match(await press(() => 'old1'), /will be lost/);
    });
    test('an unsaved copy of a proposal has no saved id, and is not moving either', async () => {
        assert.doesNotMatch(await press(() => null), /will be lost/);
    });
    test('with no way to tell which design is open, it still warns — the safe direction', async () => {
        assert.match(await press(undefined), /will be lost/);
    });
});
