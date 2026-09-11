// @ts-check
/**
 * WHEN A PICK IS APPLIED — organised by what a wrong answer COSTS.
 *
 * `openOptionSheet` reports a tapped row to its caller, and the WHEN is a rule with two failure
 * directions that are not symmetrical:
 *
 *   TOO EARLY is the dangerous one and it is intermittent. The sheet's close issues a
 *   `history.back()` whose popstate arrives later; a caller that opens a dialog before that echo
 *   pushes an entry the traversal then pops, so the dialog closes itself the instant it opened.
 *   The Links grid editor opens `promptDialog` from exactly this callback. Nothing errors, and it
 *   depends on how fast the browser answers, so it does not reproduce on demand.
 *
 *   TOO LATE only costs time — but it cost every pick in the app 320 ms for six releases, a fixed
 *   timer standing in for two events the overlay already reports (v23.61 replaced it).
 *
 * So the contract pinned here is ORDER, not duration: the caller's preview fires on the tap, the
 * pick fires when — and only when — the lightbox's close() promise has resolved, and a dismissed
 * sheet fires neither. The lightbox is a fake with a hand-held promise, because the moment being
 * tested is the gap between two events, and a real fade would close it before an assertion ran.
 *
 * Part of test:hygiene. Run: node --test select-sheet-pick.test.mjs
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ── A FAKE DOCUMENT, just enough for the sheet to build itself and a row to be tapped ─────────────
function fakeEl(/** @type {string} */ tag) {
    const classes = new Set();
    /** @type {Record<string, string>} */ const attrs = {};
    /** @type {Record<string, Function[]>} */ const listeners = {};
    /** @type {any} */
    const el = {
        tagName: tag.toUpperCase(),
        get className() { return [...classes].join(' '); },
        set className(v) { classes.clear(); String(v).split(/\s+/).filter(Boolean).forEach(c => classes.add(c)); },
        classList: { add: (/** @type {string} */ c) => classes.add(c), remove: (/** @type {string} */ c) => classes.delete(c), contains: (/** @type {string} */ c) => classes.has(c) },
        dataset: {},
        children: /** @type {any[]} */ ([]),
        parentNode: /** @type {any} */ (null),
        textContent: '',
        disabled: false,
        type: '',
        setAttribute(/** @type {string} */ k, /** @type {string} */ v) { attrs[k] = String(v); },
        getAttribute(/** @type {string} */ k) { return attrs[k] ?? null; },
        appendChild(/** @type {any} */ c) { el.children.push(c); c.parentNode = el; return c; },
        append(/** @type {any[]} */ ...cs) { cs.forEach(c => el.appendChild(c)); },
        insertBefore(/** @type {any} */ c) { el.children.unshift(c); c.parentNode = el; return c; },
        addEventListener(/** @type {string} */ t, /** @type {Function} */ fn) { (listeners[t] ??= []).push(fn); },
        removeEventListener() {},
        dispatchEvent(/** @type {any} */ ev) { (listeners[ev.type] ?? []).forEach(fn => fn(ev)); return true; },
        /** `.closest('.picker-opt[data-value]')` — the only selector the click handler uses. */
        closest(/** @type {string} */ sel) {
            assert.equal(sel, '.picker-opt[data-value]', 'the handler asks for the row selector');
            /** @type {any} */ let n = el;
            while (n) { if (n.classList?.contains('picker-opt') && n.dataset?.value !== undefined) return n; n = n.parentNode; }
            return null;
        },
        _fire(/** @type {string} */ t, /** @type {any} */ ev = {}) { (listeners[t] ?? []).forEach(fn => fn(ev)); },
    };
    return el;
}

/** @type {any} */ let body;
/** @type {any} */ global.document = { createElement: fakeEl, body: null };

// ── A FAKE LIGHTBOX whose close() promise the test holds ────────────────────────────────────────
/** @type {Array<() => void>} */ let _landers = [];
let _opens = 0, _closes = 0;
const fakeLightbox = () => ({
    open() { _opens++; },
    close() { _closes++; return new Promise(res => { _landers.push(() => res()); }); },
});
const land = () => { const fns = _landers; _landers = []; fns.forEach(fn => fn()); };
const microtasks = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

/* The sheet appends itself to `document.body`. The list is found BY CLASS, not by child index:
   it was `content.children[2]` until v23.68, and adding the search box between the head and the
   list moved it — a positional handle breaks on a change that is correct, and the failure reads
   as a product bug rather than as a test reaching for the wrong thing. */
const sheetList = () => {
    const overlay = body.children[body.children.length - 1];
    return overlay.children[0].children.find(
        (/** @type {any} */ c) => c.classList.contains('picker-list'));
};
function rows() {
    const list = sheetList();
    return /** @type {any[]} */ (list.children.flatMap((/** @type {any} */ g) => g.children.filter((/** @type {any} */ c) => c.classList.contains('picker-opt'))));
}
const tap = (/** @type {any} */ row) => { sheetList().onclick({ target: row }); };

let mod;
let _n = 0;
beforeEach(async () => {
    body = fakeEl('body');
    global.document.body = body;
    _landers = []; _opens = 0; _closes = 0;
    // A fresh module per test: the sheet is a module-level singleton.
    mod = await import(`./select-sheet.js?pick=${++_n}`);
});

const GROUPS = [{ label: '', options: [
    { value: 'a', label: 'A. Hared',  meta: '', disabled: false },
    { value: 'b', label: 'G. Miller', meta: '', disabled: false },
] }];

describe('too EARLY — the pick must wait for the close to land', () => {
    test('the pick is not reported while the close is still landing, and is reported once it has', async () => {
        /** @type {string[]} */ const picked = [];
        mod.openOptionSheet({ title: 't', groups: GROUPS, current: 'a', createLightbox: fakeLightbox, onPick: (/** @type {string} */ v) => picked.push(v) });
        assert.equal(_opens, 1);
        tap(rows()[1]);
        assert.equal(_closes, 1, 'the tap closes the sheet');
        await microtasks();
        assert.deepEqual(picked, [], 'NOT yet — the close has not landed. This is the whole test');
        land();
        await microtasks();
        assert.deepEqual(picked, ['b'], 'and exactly once when it has');
    });

    test('a factory whose close() returns nothing still reports the pick (the fakes elsewhere)', async () => {
        /** @type {string[]} */ const picked = [];
        const voidLightbox = () => ({ open() {}, close() {} });
        mod.openOptionSheet({ title: 't', groups: GROUPS, createLightbox: voidLightbox, onPick: (/** @type {string} */ v) => picked.push(v) });
        tap(rows()[0]);
        await microtasks();
        assert.deepEqual(picked, ['a']);
    });
});

describe('the preview fires ON THE TAP — that is what makes a pick read as instant', () => {
    test('onPreview runs synchronously with the value, before the close has landed', async () => {
        /** @type {string[]} */ const previewed = [];
        /** @type {string[]} */ const picked = [];
        mod.openOptionSheet({ title: 't', groups: GROUPS, createLightbox: fakeLightbox,
            onPreview: (/** @type {string} */ v) => previewed.push(v), onPick: (/** @type {string} */ v) => picked.push(v) });
        tap(rows()[1]);
        assert.deepEqual(previewed, ['b'], 'synchronously, on the tap');
        assert.deepEqual(picked, [], 'while the pick still waits');
        land(); await microtasks();
        assert.deepEqual(picked, ['b']);
    });

    test('enhanceSelect paints the trigger face on the tap and applies the value on the landing', async () => {
        const options = [
            { tagName: 'OPTION', value: 'a', textContent: 'A. Hared',  disabled: false, dataset: {} },
            { tagName: 'OPTION', value: 'b', textContent: 'G. Miller', disabled: false, dataset: {} },
        ];
        /** @type {any} */ let trigger = null;
        /** @type {string[]} */ const dispatched = [];
        // A real <select> moves `selectedIndex` when `value` is assigned, and `paint()` reads the
        // face from selectedIndex — so the stub must too, or the repaint reads the old row.
        const select = /** @type {any} */ ({
            ...fakeEl('select'),
            id: 'who', options, children: options, selectedIndex: 0, tabIndex: 0,
            get value() { return options[this.selectedIndex]?.value ?? ''; },
            set value(v) { this.selectedIndex = options.findIndex(o => o.value === v); },
            parentNode: { insertBefore(/** @type {any} */ btn) { trigger = btn; } },
        });
        const listeners = /** @type {Record<string, Function[]>} */ ({});
        select.addEventListener = (/** @type {string} */ t, /** @type {Function} */ fn) => { (listeners[t] ??= []).push(fn); };
        select.dispatchEvent = (/** @type {any} */ ev) => { dispatched.push(ev.type); (listeners[ev.type] ?? []).forEach(fn => fn(ev)); return true; };

        mod.enhanceSelect(select, { title: 'Who', createLightbox: fakeLightbox });
        assert.ok(trigger, 'a trigger was inserted');
        const face = trigger.children[0];
        assert.equal(face.textContent, 'A. Hared');

        trigger._fire('click');
        tap(rows()[1]);
        assert.equal(face.textContent, 'G. Miller', 'the face shows the pick the instant it is tapped');
        assert.equal(select.value, 'a', 'the VALUE has not moved yet');
        assert.deepEqual(dispatched, [], 'and nothing downstream has been told');

        land(); await microtasks();
        assert.equal(select.value, 'b');
        assert.deepEqual(dispatched, ['input', 'change'], 'a user\'s own pick fires both, in this order');
        assert.equal(face.textContent, 'G. Miller', 'the repaint from the select agrees');
    });
});

describe('a cancel is not a pick', () => {
    test('closing the sheet without tapping a row reports nothing, ever', async () => {
        /** @type {string[]} */ const picked = [];
        /** @type {string[]} */ const previewed = [];
        mod.openOptionSheet({ title: 't', groups: GROUPS, createLightbox: fakeLightbox,
            onPreview: (/** @type {string} */ v) => previewed.push(v), onPick: (/** @type {string} */ v) => picked.push(v) });
        // The lightbox's own close (✕, backdrop, Escape, Back) — not a row.
        land(); await microtasks();
        assert.deepEqual(picked, []);
        assert.deepEqual(previewed, []);
    });
});
