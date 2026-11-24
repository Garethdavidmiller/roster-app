// @ts-check
/**
 * calendar-keyboard.test.mjs — the Calendar's keyboard grammar: the roving tabindex, the month jump
 * and the swipe-cooldown guard.
 * Run: node --experimental-test-module-mocks scripts/run-tests.mjs test/calendar-keyboard.test.mjs   (part of test:unit)
 *
 * WHY THIS FILE EXISTS (v24.28 review). module-coverage-parity listed calendar-keyboard.js as
 * "driven by e2e/calendar.spec.js (arrow-key navigation and the hover tooltip)". Half of that was
 * true: the tooltip and the Enter hand-over are driven there. No spec presses an arrow key or
 * PageUp/PageDown, so the roving tabindex — the only way a keyboard user moves around the month —
 * had no test at all, behind an exemption that said it did.
 *
 * The module needs a `document` and nothing else, so a hand-built one is enough: cells are objects
 * with the four members the handler touches, and the two sibling imports are mocked (calendar-swipe
 * pulls the whole renderer graph). What is asserted is the observable contract — which cell holds
 * tabindex 0 and focus afterwards, and which month button was clicked — not how it got there.
 */
import { test, describe, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

let cooldown = false;
mock.module('../calendar-swipe.js', { namedExports: { isSwipeCooldown: () => cooldown } });
mock.module('../roster-data.js', { namedExports: { paydayForCutoff: () => null } });

/** A calendar cell with exactly what the handler reads and writes. `stored`: a cell of the member's
 *  stored roster painted in the lock slot before access is decided — not inside #calendarDisplay. */
function cell(/** @type {number} */ i, { otherMonth = false, stored = false } = {}) {
    return {
        i,
        tabindex: '-1',
        dataset: /** @type {Record<string, string>} */ ({}),
        classList: { contains: (/** @type {string} */ c) => c === 'calendar-day' || (otherMonth && c === 'other-month') },
        closest: (/** @type {string} */ sel) => (sel === '#calendarDisplay' && !stored ? {} : null),
        setAttribute(/** @type {string} */ k, /** @type {string} */ v) { if (k === 'tabindex') this.tabindex = v; },
        focus() { doc.activeElement = this; },
    };
}

/** @type {any} */
let doc;
/** @type {(e: any) => void} */
let keydown;
/** @type {string[]} */
let clicked;
/** @type {any[]} */
let cells;

/** Every other document listener, by type — the tooltip's. @type {Record<string, Function[]>} */
const docListeners = {};
/** The tooltip element the module builds. @type {any} */
const tip = { id: '', hidden: true, textContent: '', style: {}, setAttribute() {},
              getBoundingClientRect: () => ({ width: 120, height: 24 }) };
globalThis.document = /** @type {any} */ ({
    addEventListener: (/** @type {string} */ type, /** @type {any} */ fn) => {
        if (type === 'keydown') keydown = fn; else (docListeners[type] ||= []).push(fn);
    },
    get activeElement() { return doc.activeElement; },
    querySelectorAll: () => cells,
    getElementById: (/** @type {string} */ id) => ({ click: () => clicked.push(id) }),
    createElement: () => tip,
    body: { appendChild() {} },
});
doc = { activeElement: null };
// A device whose PRIMARY pointer is fine and hovers — a touchscreen laptop reports its trackpad.
globalThis.window = /** @type {any} */ ({ matchMedia: () => ({ matches: true }), innerWidth: 1280, innerHeight: 800 });

const { initCalendarKeyboard, initCalendarTooltip } = await import('../calendar-keyboard.js');
/** @type {any[]} */
const opened = [];
initCalendarKeyboard({ navigateToPaycalc: () => false, openDayDetail: c => opened.push(c) });

/** Press `key` and report whether the default was prevented. */
function press(/** @type {string} */ key) {
    let prevented = false;
    keydown({ key, preventDefault: () => { prevented = true; } });
    return prevented;
}

beforeEach(() => {
    cooldown = false;
    clicked = [];
    opened.length = 0;
    cells = Array.from({ length: 30 }, (_, i) => cell(i));
    cells[10].tabindex = '0';
    doc.activeElement = cells[10];
});

describe('arrow keys move the ONE tabbable cell (roving tabindex)', () => {
    for (const [key, to] of /** @type {const} */ ([['ArrowRight', 11], ['ArrowLeft', 9], ['ArrowDown', 17], ['ArrowUp', 3]])) {
        test(`${key} moves focus and tabindex 0 from day 10 to day ${to}`, () => {
            assert.equal(press(key), true, 'the page must not scroll under an arrow that moved focus');
            assert.equal(doc.activeElement, cells[to]);
            assert.equal(cells[to].tabindex, '0');
            assert.equal(cells[10].tabindex, '-1', 'the old cell must leave the tab order, or Tab lands on two days');
            assert.equal(cells.filter(c => c.tabindex === '0').length, 1);
        });
    }

    test('off the edge of the month nothing moves, and the key is left to the page', () => {
        doc.activeElement = cells[2];
        assert.equal(press('ArrowUp'), false);
        assert.equal(doc.activeElement, cells[2]);
    });

    test('mid-swipe the move is swallowed — the grid under the focus is about to be replaced', () => {
        cooldown = true;
        press('ArrowRight');
        assert.equal(doc.activeElement, cells[10]);
        assert.equal(cells[11].tabindex, '-1');
    });
});

describe('PageUp / PageDown jump a month through the same buttons a pointer uses', () => {
    test('PageDown clicks #nextMonth, PageUp clicks #prevMonth', () => {
        assert.equal(press('PageDown'), true);
        assert.equal(press('PageUp'), true);
        assert.deepEqual(clicked, ['nextMonth', 'prevMonth']);
    });
});

describe('the handler only answers for a focused day of THIS month', () => {
    test('a focused other-month cell is ignored entirely', () => {
        cells[10] = cell(10, { otherMonth: true });
        doc.activeElement = cells[10];
        assert.equal(press('ArrowRight'), false);
        assert.equal(press('PageDown'), false);
        assert.deepEqual(clicked, []);
    });

    test('focus outside the grid is ignored — the Calendar does not steal page keys', () => {
        doc.activeElement = { classList: { contains: () => false } };
        assert.equal(press('PageDown'), false);
        assert.deepEqual(clicked, []);
    });

    test('Enter on an ordinary day opens that day\'s panel', () => {
        press('Enter');
        assert.deepEqual(opened, [cells[10]]);
    });
});

describe('the stored copy before the grant is READ, never used (whole-app review, Oct 2026)', () => {
    // Since v24.59 the member's own stored roster can be painted in the lock slot with real day
    // cells. PageUp/Down clicked the hidden month buttons and Enter opened a day panel behind the
    // lock card; the arrows must still move, so a screen-reader user can read it.
    beforeEach(() => {
        cells = Array.from({ length: 30 }, (_, i) => cell(i, { stored: true }));
        cells[10].tabindex = '0';
        doc.activeElement = cells[10];
    });

    test('PageDown, PageUp and Enter do nothing, and leave the key to the page', () => {
        assert.equal(press('PageDown'), false);
        assert.equal(press('PageUp'), false);
        assert.equal(press('Enter'), false);
        assert.equal(press(' '), false);
        assert.deepEqual(clicked, []);
        assert.deepEqual(opened, []);
    });

    test('the arrows still move between its cells', () => {
        assert.equal(press('ArrowRight'), true);
        assert.equal(doc.activeElement, cells[11]);
    });
});

describe('the hover tooltip is a MOUSE\'s preview, never a finger\'s (17 Nov 2026)', () => {
    // The media query is about the device's PRIMARY pointer, and a touchscreen laptop answers for its
    // trackpad — so a finger on the screen fired the compatibility mouseover every tap is followed by,
    // and the tip stuck where the finger had been. Pointer events name the input that moved.
    initCalendarTooltip();
    const day = { dataset: { tooltip: 'Early shift 06:00-14:00 · Payday' } };
    const over = (/** @type {any} */ target) => { for (const fn of docListeners.mouseover || []) fn({ target }); };
    const pointer = (/** @type {string} */ pointerType) => { for (const fn of docListeners.pointerover || []) fn({ pointerType }); };
    const onDay = { closest: (/** @type {string} */ sel) => (sel === '.calendar-day[data-tooltip]' ? day : null) };

    test('a mouse over a day shows the day\'s line (premise: the tip works at all)', () => {
        tip.hidden = true;
        pointer('mouse');
        over(onDay);
        assert.equal(tip.hidden, false);
        assert.equal(tip.textContent, day.dataset.tooltip);
    });

    test('a finger on the same day leaves it down, and takes down one a mouse left up', () => {
        pointer('mouse');
        over(onDay);
        assert.equal(tip.hidden, false, 'premise: the mouse put it up');
        pointer('touch');   // the tap's own pointer events come first…
        assert.equal(tip.hidden, true, 'a touch left the mouse\'s tip standing');
        over(onDay);        // …then the compatibility mouseover every tap is followed by
        assert.equal(tip.hidden, true, 'a tap on a touchscreen laptop put the hover tip up');
    });
});
