// @lane hygiene
/**
 * Unit tests for the pure date-range maths in admin-rangepicker.js.
 * Run with: node scripts/run-tests.mjs test/admin-rangepicker.test.mjs
 *
 * getDateRange() feeds the AL and absence save pipelines — an off-by-one
 * here writes a wrong number of override documents to Firestore.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getDateRange } from '../admin-rangepicker.js';

test('getDateRange: empty from returns []', () => {
    assert.deepEqual(getDateRange('', '2026-06-10'), []);
});

test('getDateRange: empty to returns []', () => {
    assert.deepEqual(getDateRange('2026-06-10', ''), []);
});

test('getDateRange: reversed range (to before from) returns null', () => {
    assert.equal(getDateRange('2026-06-12', '2026-06-10'), null);
});

test('getDateRange: single day (from === to) returns that one date', () => {
    assert.deepEqual(getDateRange('2026-06-10', '2026-06-10'), ['2026-06-10']);
});

test('getDateRange: endpoints are inclusive', () => {
    assert.deepEqual(
        getDateRange('2026-06-10', '2026-06-12'),
        ['2026-06-10', '2026-06-11', '2026-06-12']
    );
});

test('getDateRange: crosses a month boundary', () => {
    assert.deepEqual(
        getDateRange('2026-01-30', '2026-02-02'),
        ['2026-01-30', '2026-01-31', '2026-02-01', '2026-02-02']
    );
});

test('getDateRange: crosses a year boundary', () => {
    assert.deepEqual(
        getDateRange('2026-12-31', '2027-01-01'),
        ['2026-12-31', '2027-01-01']
    );
});

test('getDateRange: non-leap February has no Feb 29', () => {
    assert.deepEqual(
        getDateRange('2026-02-28', '2026-03-01'),
        ['2026-02-28', '2026-03-01']
    );
});

test('getDateRange: leap-year February includes Feb 29', () => {
    assert.deepEqual(
        getDateRange('2028-02-28', '2028-03-01'),
        ['2028-02-28', '2028-02-29', '2028-03-01']
    );
});

// THE TWO CLOCK CHANGES RUN IN LONDON TIME, whatever zone the run is in (test audit, 7 Nov 2026).
// Every CI job runs in UTC and the no-install lane in Los Angeles, and neither zone changes its clocks
// on these dates — so a loop that stepped 24 hours instead of one calendar day passed both, and was
// caught only on a machine set to UK time. Node honours a TZ change at runtime; the premise check
// makes sure the zone really does change its clocks here, so the test cannot pass vacuously.
/** Run `fn` with the process clock in `tz`, restoring the previous zone afterwards. */
function inZone(/** @type {string} */ tz, /** @type {() => void} */ fn) {
    const prev = process.env.TZ;
    process.env.TZ = tz;
    try { fn(); } finally { if (prev === undefined) delete process.env.TZ; else process.env.TZ = prev; }
}

test('getDateRange: no skipped/duplicated day across BST spring-forward (29 Mar 2026)', () => {
    inZone('Europe/London', () => {
        assert.notEqual(new Date(2026, 2, 28).getTimezoneOffset(), new Date(2026, 2, 30).getTimezoneOffset(),
            'premise: the clocks go forward in this zone on 29 March 2026');
        assert.deepEqual(
            getDateRange('2026-03-28', '2026-03-30'),
            ['2026-03-28', '2026-03-29', '2026-03-30']
        );
    });
});

test('getDateRange: no skipped/duplicated day across BST fall-back (25 Oct 2026)', () => {
    inZone('Europe/London', () => {
        assert.notEqual(new Date(2026, 9, 24).getTimezoneOffset(), new Date(2026, 9, 26).getTimezoneOffset(),
            'premise: the clocks go back in this zone on 25 October 2026');
        assert.deepEqual(
            getDateRange('2026-10-24', '2026-10-26'),
            ['2026-10-24', '2026-10-25', '2026-10-26']
        );
    });
});

// ── The ✕ Clear button hands keyboard focus back (Nov 2026) ─────────────────────────────────────
// The ✕ hides itself once nothing is chosen, so a keyboard user who pressed it was dropped to <body>.
// These drive the REAL `buildRangePicker` through a fake DOM just large enough for it: elements
// are found by id (the fake does not parse the template, so each id is made on first ask), and
// `focus()` is the only thing that moves `document.activeElement` — so if the handler does not move
// focus, it stays on the ✕, as a real browser's would fall to <body>.

/** A DOM element with only what buildRangePicker touches. */
class FakeEl {
    constructor(/** @type {string} */ id = '') {
        this.id = id;
        /** @type {FakeEl[]} */ this.children = [];
        /** @type {FakeEl|null} */ this.parentNode = null;
        /** @type {Record<string, string>} */ this.attrs = {};
        /** @type {Record<string, string>} */ this.dataset = {};
        /** @type {Record<string, Function[]>} */ this.listeners = {};
        this.style = {};
        this.className = ''; this.textContent = ''; this.value = '';
        const cls = new Set();
        this.classList = {
            add: (/** @type {string[]} */ ...c) => c.forEach(x => cls.add(x)),
            remove: (/** @type {string[]} */ ...c) => c.forEach(x => cls.delete(x)),
            toggle: (/** @type {string} */ c, /** @type {boolean} */ on) => (on ? cls.add(c) : cls.delete(c), on),
            contains: (/** @type {string} */ c) => cls.has(c),
        };
    }
    set innerHTML(_html) { this.children.forEach(c => { c.parentNode = null; }); this.children = []; }
    get tabIndex() { return Number(this.attrs.tabindex ?? -1); }
    set tabIndex(n) { this.attrs.tabindex = String(n); }
    setAttribute(/** @type {string} */ k, /** @type {string} */ v) { this.attrs[k] = String(v); }
    appendChild(/** @type {FakeEl} */ c) { c.parentNode = this; this.children.push(c); return c; }
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(c => c !== this); this.parentNode = null; }
    contains(/** @type {FakeEl|null} */ el) { for (let e = el; e; e = e.parentNode) if (e === this) return true; return false; }
    /** `[data-iso="…"]` and `[tabindex="…"]` — the two selectors the picker asks. */
    querySelector(/** @type {string} */ sel) {
        const m = /^\[([\w-]+)="([^"]*)"\]$/.exec(sel);
        if (!m) throw new Error(`fake DOM: unsupported selector ${sel}`);
        const read = (/** @type {FakeEl} */ e) => (m[1] === 'data-iso' ? e.dataset.iso : e.attrs[m[1]]);
        return this.children.find(c => read(c) === m[2]) ?? null;
    }
    addEventListener(/** @type {string} */ t, /** @type {Function} */ fn) { (this.listeners[t] ??= []).push(fn); }
    dispatchEvent(/** @type {Event} */ e) { (this.listeners[e.type] || []).forEach(fn => fn(e)); return true; }
    /** A click BUBBLES, as a real one does: the picker listens on the grid, not on each day. */
    click() { const e = { type: 'click', target: this }; for (let el = /** @type {FakeEl|null} */ (this); el; el = el.parentNode) el.dispatchEvent(/** @type {any} */ (e)); }
    closest(/** @type {string} */ sel) {
        if (sel !== '[data-iso]') throw new Error(`fake DOM: unsupported selector ${sel}`);
        for (let el = /** @type {FakeEl|null} */ (this); el; el = el.parentNode) if (el.dataset.iso) return el;
        return null;
    }
    focus() { fakeDoc.activeElement = this; }
}

const fakeDoc = {
    /** @type {any} */ activeElement: null,
    /** @type {Map<string, FakeEl>} */ byId: new Map(),
    getElementById(/** @type {string} */ id) {
        if (!this.byId.has(id)) this.byId.set(id, new FakeEl(id));
        return this.byId.get(id);
    },
    createElement: () => new FakeEl(),
    addEventListener() {},
};

/** Build a picker on the fake DOM, run `fn`, and put the real globals back. */
async function withPicker(/** @type {(p: { clear: FakeEl, grid: FakeEl, from: FakeEl }) => void} */ fn) {
    const prev = { document: globalThis.document, window: globalThis.window };
    fakeDoc.byId.clear(); fakeDoc.activeElement = null;
    globalThis.document = /** @type {any} */ (fakeDoc);
    globalThis.window = /** @type {any} */ ({ matchMedia: () => ({ matches: true }) });
    try {
        const { buildRangePicker } = await import('../admin-rangepicker.js');
        buildRangePicker('al');
        fn({ clear: fakeDoc.getElementById('alRpClear'), grid: fakeDoc.getElementById('alRpGrid'), from: fakeDoc.getElementById('alFrom') });
    } finally {
        globalThis.document = prev.document; globalThis.window = prev.window;
    }
}

test('Clear: focus on the ✕ moves to the calendar’s one Tab stop, not <body>', async () => {
    await withPicker(({ clear, grid, from }) => {
        const days = grid.children.filter(c => c.dataset.iso);
        days[3].click();                                    // pick a start, so the ✕ shows
        assert.equal(from.value, days[3].dataset.iso, 'premise: the start was picked');
        assert.ok(clear.classList.contains('visible'), 'premise: the ✕ is showing');
        clear.focus();
        clear.click();
        assert.equal(from.value, '', 'the range is cleared');
        assert.ok(!clear.classList.contains('visible'), 'premise: the ✕ has hidden itself');
        const stop = grid.children.find(c => c.tabIndex === 0);
        assert.ok(stop, 'premise: the calendar has a Tab stop');
        assert.equal(fakeDoc.activeElement, stop, 'focus is on the calendar’s Tab stop');
    });
});

test('Clear: a press that did not hold focus leaves focus where it was', async () => {
    await withPicker(({ clear, grid }) => {
        grid.children.filter(c => c.dataset.iso)[3].click();
        const elsewhere = new FakeEl('elsewhere');
        elsewhere.focus();
        clear.click();
        assert.equal(fakeDoc.activeElement, elsewhere);
    });
});
