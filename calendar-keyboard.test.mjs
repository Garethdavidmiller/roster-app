// @ts-check
/**
 * calendar-keyboard.test.mjs — the Calendar's keyboard grammar: the roving tabindex, the month jump
 * and the swipe-cooldown guard.
 * Run: node --experimental-test-module-mocks --test calendar-keyboard.test.mjs   (part of test:unit)
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
mock.module('./calendar-swipe.js', { namedExports: { isSwipeCooldown: () => cooldown } });
mock.module('./roster-data.js', { namedExports: { paydayForCutoff: () => null } });

/** A calendar cell with exactly what the handler reads and writes. */
function cell(/** @type {number} */ i, { otherMonth = false } = {}) {
    return {
        i,
        tabindex: '-1',
        dataset: /** @type {Record<string, string>} */ ({}),
        classList: { contains: (/** @type {string} */ c) => c === 'calendar-day' || (otherMonth && c === 'other-month') },
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

globalThis.document = /** @type {any} */ ({
    addEventListener: (/** @type {string} */ type, /** @type {any} */ fn) => { if (type === 'keydown') keydown = fn; },
    get activeElement() { return doc.activeElement; },
    querySelectorAll: () => cells,
    getElementById: (/** @type {string} */ id) => ({ click: () => clicked.push(id) }),
});
doc = { activeElement: null };

const { initCalendarKeyboard } = await import('./calendar-keyboard.js');
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
