// @ts-check
/**
 * links-grid-input.test.mjs — the design grid's keyboard rule, and a mouse stroke's bookkeeping.
 * Run: node scripts/run-tests.mjs links-grid-input.test.mjs   (part of `npm run test:hygiene`)
 *
 * The browser half — focus really landing on a cell, a real drag across real buttons, a phone's tap —
 * is e2e/links.spec.js. What can be pinned without one is here: which cell a key reaches, that the
 * Tab stop moves with it, and that a stroke's own click never paints twice or opens the sheet while a
 * keyboard's click always acts.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { cellAfterKey, createGridInput } from './links-grid-input.js';

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const SIZE = { lines: 5, days: DAYS.length };

describe('cellAfterKey — where a key takes the cursor', () => {
    test('the arrows step one cell', () => {
        const at = { pos: 3, day: 3 };
        assert.deepEqual(cellAfterKey('ArrowLeft', at, SIZE), { pos: 3, day: 2 });
        assert.deepEqual(cellAfterKey('ArrowRight', at, SIZE), { pos: 3, day: 4 });
        assert.deepEqual(cellAfterKey('ArrowUp', at, SIZE), { pos: 2, day: 3 });
        assert.deepEqual(cellAfterKey('ArrowDown', at, SIZE), { pos: 4, day: 3 });
    });

    test('and stop at the edges rather than wrap into another line or round the grid', () => {
        assert.deepEqual(cellAfterKey('ArrowLeft', { pos: 2, day: 0 }, SIZE), { pos: 2, day: 0 });
        assert.deepEqual(cellAfterKey('ArrowRight', { pos: 2, day: 6 }, SIZE), { pos: 2, day: 6 });
        assert.deepEqual(cellAfterKey('ArrowUp', { pos: 1, day: 4 }, SIZE), { pos: 1, day: 4 });
        assert.deepEqual(cellAfterKey('ArrowDown', { pos: 5, day: 4 }, SIZE), { pos: 5, day: 4 });
    });

    test('Home and End go to either end of the line, and with Ctrl to either end of the grid', () => {
        const at = { pos: 3, day: 3 };
        assert.deepEqual(cellAfterKey('Home', at, SIZE), { pos: 3, day: 0 });
        assert.deepEqual(cellAfterKey('End', at, SIZE), { pos: 3, day: 6 });
        assert.deepEqual(cellAfterKey('Home', at, { ...SIZE, ctrl: true }), { pos: 1, day: 0 });
        assert.deepEqual(cellAfterKey('End', at, { ...SIZE, ctrl: true }), { pos: 5, day: 6 });
    });

    test('a key the grid does not own is left alone: Enter, Space, Tab and Escape keep their meanings', () => {
        for (const key of ['Enter', ' ', 'Tab', 'Escape', 'a', 'PageDown']) {
            assert.equal(cellAfterKey(key, { pos: 2, day: 2 }, SIZE), null, key);
        }
    });

    test('a position outside the grid is brought back inside it, never carried further out', () => {
        assert.deepEqual(cellAfterKey('ArrowDown', { pos: 9, day: 2 }, SIZE), { pos: 5, day: 2 });
        assert.deepEqual(cellAfterKey('ArrowRight', { pos: 2, day: -1 }, SIZE), { pos: 2, day: 1 });
    });
});

/**
 * A grid body that keeps its listeners, cells that know their place, and a document to release on.
 * `paint` and `edit` RECORD what they are given — a harness that discards cannot see a double paint.
 */
function rig() {
    /** @type {Record<string, Function[]>} */ const on = {};
    /** @type {Record<string, Function[]>} */ const docOn = {};
    const doc = /** @type {any} */ ({ activeElement: null, addEventListener: (/** @type {string} */ t, /** @type {Function} */ fn) => { (docOn[t] ??= []).push(fn); } });
    /** @type {any} */ (globalThis).document = doc;
    const makeCells = () => {
        /** @type {any[]} */ const out = [];
        for (let p = 1; p <= SIZE.lines; p++) {
            for (const d of DAYS) {
                /** @type {any} */ const c = { dataset: { pos: String(p), day: d }, attrs: {} };
                c.closest = () => c;
                c.setAttribute = (/** @type {string} */ k, /** @type {any} */ v) => { c.attrs[k] = String(v); };
                c.focus = () => { doc.activeElement = c; };
                out.push(c);
            }
        }
        return out;
    };
    let cells = makeCells();
    const tbody = /** @type {any} */ ({
        addEventListener: (/** @type {string} */ t, /** @type {Function} */ fn) => { (on[t] ??= []).push(fn); },
        querySelector: (/** @type {string} */ sel) => {
            const m = /data-pos="([^"]+)"\]\[data-day="([^"]+)"/.exec(sel);
            return m ? cells.find(c => c.dataset.pos === m[1] && c.dataset.day === m[2]) ?? null : null;
        },
        querySelectorAll: (/** @type {string} */ sel) => sel.includes('[tabindex="0"]') ? cells.filter(c => c.attrs.tabindex === '0') : cells,
        contains: (/** @type {any} */ el) => cells.includes(el),
        set innerHTML(_) { cells = makeCells(); },
    });
    /** @type {string[]} */ const painted = [];
    /** @type {string[]} */ const edited = [];
    const state = { armed: true };
    const grid = createGridInput(tbody, {
        lines: SIZE.lines, days: DAYS, ready: () => true, armed: () => state.armed,
        paint: (pos, day) => { painted.push(`${pos}/${day}`); },
        edit: cell => { edited.push(`${cell.dataset.pos}/${cell.dataset.day}`); },
    });
    const cell = (/** @type {number} */ pos, /** @type {string} */ day) => cells.find(c => c.dataset.pos === String(pos) && c.dataset.day === day);
    const fire = (/** @type {string} */ type, /** @type {any} */ ev) => { for (const fn of on[type] ?? []) fn({ preventDefault() {}, ...ev }); };
    const release = (/** @type {string} */ type = 'pointerup') => { for (const fn of docOn[type] ?? []) fn({}); };
    const MOUSE = { pointerType: 'mouse', button: 0, pointerId: 1 };
    const tick = () => new Promise(r => setTimeout(r, 0));
    return { grid, doc, fire, release, cell, painted, edited, state, MOUSE, tick };
}

describe('a mouse stroke paints every cell it crosses, and only a mouse', () => {
    test('the press paints at once, and the click that ends it is spent — one cell, one paint', () => {
        const { fire, release, cell, painted, edited, MOUSE } = rig();
        fire('pointerdown', { ...MOUSE, target: cell(1, 'mon') });
        release();
        fire('click', { target: cell(1, 'mon'), detail: 1 });
        assert.deepEqual(painted, ['1/mon']);
        assert.deepEqual(edited, []);
    });

    test('with the button held, every cell the pointer enters is painted', () => {
        const { fire, cell, painted, MOUSE } = rig();
        fire('pointerdown', { ...MOUSE, target: cell(2, 'tue') });
        for (const d of ['wed', 'thu', 'fri']) fire('pointerover', { ...MOUSE, buttons: 1, target: cell(2, d) });
        assert.deepEqual(painted, ['2/tue', '2/wed', '2/thu', '2/fri']);
    });

    test('no button held means the stroke is over (a release outside the window), and it stays over', () => {
        const { fire, cell, painted, MOUSE } = rig();
        fire('pointerdown', { ...MOUSE, target: cell(2, 'tue') });
        fire('pointerover', { ...MOUSE, buttons: 0, target: cell(2, 'wed') });
        fire('pointerover', { ...MOUSE, buttons: 1, target: cell(2, 'thu') });
        assert.deepEqual(painted, ['2/tue']);
    });

    test('after the release, passing over cells paints nothing', () => {
        const { fire, release, cell, painted, MOUSE } = rig();
        fire('pointerdown', { ...MOUSE, target: cell(3, 'sun') });
        release();
        fire('pointerover', { ...MOUSE, buttons: 1, target: cell(3, 'mon') });
        assert.deepEqual(painted, ['3/sun']);
    });

    test('a touch or pen press paints nothing — the tap\'s click paints its one cell, as before', () => {
        for (const pointerType of ['touch', 'pen']) {
            const { fire, release, cell, painted } = rig();
            fire('pointerdown', { pointerType, button: 0, pointerId: 7, target: cell(1, 'sat') });
            fire('pointerover', { pointerType, buttons: 1, pointerId: 7, target: cell(1, 'fri') });
            assert.deepEqual(painted, [], `${pointerType}: a scroll that began on a cell must not paint`);
            release();
            fire('click', { target: cell(1, 'sat'), detail: 1 });
            assert.deepEqual(painted, ['1/sat'], pointerType);
        }
    });

    test('a right button, or a press with a modifier, is not a stroke', () => {
        const { fire, cell, painted, MOUSE } = rig();
        fire('pointerdown', { ...MOUSE, button: 2, target: cell(1, 'mon') });
        fire('pointerdown', { ...MOUSE, ctrlKey: true, target: cell(1, 'tue') });
        fire('pointerdown', { ...MOUSE, shiftKey: true, target: cell(1, 'wed') });
        assert.deepEqual(painted, []);
    });

    test('a press with no brush armed paints nothing, and its click opens the sheet', () => {
        const { fire, release, cell, painted, edited, state, MOUSE } = rig();
        state.armed = false;
        fire('pointerdown', { ...MOUSE, target: cell(4, 'thu') });
        release();
        fire('click', { target: cell(4, 'thu'), detail: 1 });
        assert.deepEqual(painted, []);
        assert.deepEqual(edited, ['4/thu']);
    });

    test('Escape mid-stroke: the stroke\'s own click does not open the sheet, and the next click does', () => {
        const { fire, release, cell, painted, edited, state, MOUSE } = rig();
        fire('pointerdown', { ...MOUSE, target: cell(1, 'mon') });
        state.armed = false;   // the document's Escape handler disarmed the brush
        release();
        fire('click', { target: cell(1, 'mon'), detail: 1 });
        assert.deepEqual(edited, [], 'the release of a paint stroke opened the sheet');
        fire('click', { target: cell(1, 'mon'), detail: 1 });
        assert.deepEqual(painted, ['1/mon']);
        assert.deepEqual(edited, ['1/mon']);
    });

    test('a keyboard\'s click (detail 0) is never a stroke\'s — it always acts', () => {
        const { fire, cell, painted, MOUSE } = rig();
        fire('pointerdown', { ...MOUSE, target: cell(1, 'mon') });
        fire('click', { target: cell(1, 'tue'), detail: 0 });
        assert.deepEqual(painted, ['1/mon', '1/tue']);
    });

    test('a release off the grid sends no click here, and the next click is not swallowed for it', async () => {
        const { fire, release, cell, painted, tick, MOUSE } = rig();
        fire('pointerdown', { ...MOUSE, target: cell(1, 'mon') });
        release();
        await tick();
        fire('click', { target: cell(2, 'mon'), detail: 1 });
        assert.deepEqual(painted, ['1/mon', '2/mon']);
    });

    test('a cancelled pointer ends the stroke too', () => {
        const { fire, release, cell, painted, MOUSE } = rig();
        fire('pointerdown', { ...MOUSE, target: cell(1, 'mon') });
        release('pointercancel');
        fire('pointerover', { ...MOUSE, buttons: 1, target: cell(1, 'tue') });
        assert.deepEqual(painted, ['1/mon']);
    });
});

describe('one Tab stop, which the arrow keys move', () => {
    test('render makes exactly one cell tabbable — the first, before anything has been used', () => {
        const { grid, cell } = rig();
        grid.render('');
        assert.equal(cell(1, 'sun').attrs.tabindex, '0');
        assert.equal(cell(1, 'mon').attrs.tabindex, '-1');
        assert.equal(cell(SIZE.lines, 'sat').attrs.tabindex, '-1');
    });

    test('an arrow moves focus, and the Tab stop goes with it', () => {
        const { grid, doc, fire, cell } = rig();
        grid.render('');
        fire('keydown', { key: 'ArrowDown', target: cell(1, 'sun') });
        fire('keydown', { key: 'ArrowRight', target: cell(2, 'sun') });
        assert.equal(doc.activeElement, cell(2, 'mon'));
        assert.equal(cell(2, 'mon').attrs.tabindex, '0');
        assert.equal(cell(1, 'sun').attrs.tabindex, '-1');
        assert.equal(cell(2, 'sun').attrs.tabindex, '-1');
    });

    test('Shift, Alt and Meta leave the arrows to the browser', () => {
        const { grid, doc, fire, cell } = rig();
        grid.render('');
        for (const mod of ['shiftKey', 'altKey', 'metaKey']) fire('keydown', { key: 'ArrowRight', [mod]: true, target: cell(1, 'sun') });
        assert.equal(doc.activeElement, null);
    });

    test('a re-render keeps the Tab stop where it was — and keyboard focus, if a cell held it', () => {
        const { grid, doc, fire, cell } = rig();
        grid.render('');
        fire('keydown', { key: 'End', target: cell(1, 'sun') });
        assert.equal(doc.activeElement, cell(1, 'sat'));
        grid.render('');   // every cell is a new element now
        assert.equal(cell(1, 'sat').attrs.tabindex, '0');
        assert.equal(doc.activeElement, cell(1, 'sat'), 'focus fell out of the grid on a re-render');
    });

    test('a click moves the Tab stop to the clicked cell, though Safari never focuses it', () => {
        const { grid, fire, cell, state } = rig();
        grid.render('');
        state.armed = false;
        fire('click', { target: cell(3, 'wed'), detail: 1 });
        assert.equal(cell(3, 'wed').attrs.tabindex, '0');
        assert.equal(cell(1, 'sun').attrs.tabindex, '-1');
    });
});
