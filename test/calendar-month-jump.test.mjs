// @ts-check
/**
 * calendar-month-jump.test.mjs — the Calendar's month/year jump picker (calendar-month-jump.js,
 * moved from calendar-app.js on 25 Nov 2026).
 * Run: node --experimental-test-module-mocks scripts/run-tests.mjs test/calendar-month-jump.test.mjs   (part of test:unit)
 *
 * The lightbox lifecycle is overlay.js's and is mocked here (its own suites own it); what is asserted
 * is the picker's contract — the selects it fills, the month Go to month moves to, and the two ways a
 * lost grant stops it moving the month behind the lock card (17 Nov 2026). The journey in a browser
 * is e2e/calendar.spec.js's.
 */
import { test, describe, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/** What the mocked lightbox was asked to do. @type {string[]} */
const lifecycle = [];
/** @type {any} */ let lightboxOpts = null;
mock.module('../overlay.js', { namedExports: {
    createLightbox: (/** @type {any} */ opts) => {
        lightboxOpts = opts;
        return { open: () => { lifecycle.push('open'); opts.onOpen?.(); }, close: () => lifecycle.push('close') };
    },
} });

/** A hand-built element: what the module reads and writes. @param {string} [id] */
function el(id = '') {
    /** @type {Record<string, Function>} */ const on = {};
    return {
        id, value: '', textContent: '', /** @type {any[]} */ children: [], focused: false,
        appendChild(/** @type {any} */ c) { this.children.push(c); return c; },
        addEventListener(/** @type {string} */ type, /** @type {Function} */ fn) { on[type] = fn; },
        fire(/** @type {string} */ type, /** @type {any} */ e = {}) { on[type]?.(e); },
        focus() { this.focused = true; },
    };
}
const els = Object.fromEntries(['monthJumpOverlay', 'monthJumpCard', 'monthJumpMonth', 'monthJumpYear',
    'monthJumpConfirm', 'monthJumpCancel', 'calendarDisplay'].map(id => [id, el(id)]));
const heading = el('heading');
globalThis.document = /** @type {any} */ ({
    getElementById: (/** @type {string} */ id) => els[id] ?? null,
    createElement: () => el(),
    querySelector: (/** @type {string} */ sel) => (sel === '.month-year' ? heading : null),
});

const { CONFIG, MONTH_NAMES } = await import('../roster-data.js');
const { setCalendarAccess } = await import('../calendar-access-state.js');
const { getDisplayMonth, getDisplayYear, setDisplayMonth, setDisplayYear } = await import('../calendar-state.js');
const { initMonthJump } = await import('../calendar-month-jump.js');

/** What the page was asked to do. @type {string[]} */
const page = [];
let access = 'named';
const picker = initMonthJump({
    renderCalendar: () => page.push(`render ${getDisplayMonth()}/${getDisplayYear()}`),
    announceMonthChange: () => page.push('announce'),
    getAccessType: () => access,
});

beforeEach(() => {
    lifecycle.length = 0;
    page.length = 0;
    access = 'named';
    heading.focused = false;
    setDisplayYear(2026); setDisplayMonth(10);
});

describe('the picker', () => {
    test('is built once, with every month and every year the app covers', () => {
        assert.ok(picker, 'guard: the page has the picker');
        assert.deepEqual(els.monthJumpMonth.children.map(o => o.textContent), MONTH_NAMES);
        const years = els.monthJumpYear.children.map(o => Number(o.value));
        assert.equal(years[0], CONFIG.MIN_YEAR);
        assert.equal(years.at(-1), CONFIG.MAX_YEAR);
        assert.equal(lightboxOpts.overlay, els.monthJumpOverlay, 'through the shared lifecycle (createLightbox)');
    });

    test('opens from the month heading by click, Enter or Space — showing the month on screen', () => {
        const onHeading = { closest: (/** @type {string} */ s) => (s === '.month-year' ? {} : null) };
        els.calendarDisplay.fire('click', { target: onHeading });
        let prevented = 0;
        for (const key of ['Enter', ' ', 'a']) els.calendarDisplay.fire('keydown', { target: onHeading, key, preventDefault: () => { prevented++; } });
        els.calendarDisplay.fire('click', { target: { closest: () => null } });
        assert.deepEqual(lifecycle, ['open', 'open', 'open'], 'a click and two keys on the heading; nothing else');
        assert.equal(prevented, 2);
        assert.deepEqual([els.monthJumpMonth.value, els.monthJumpYear.value], ['10', '2026']);
    });

    test('Go to month moves to the chosen month, draws it, announces it and puts focus back on the heading', () => {
        els.monthJumpMonth.value = '2'; els.monthJumpYear.value = '2027';
        els.monthJumpConfirm.fire('click');
        assert.deepEqual([getDisplayMonth(), getDisplayYear()], [2, 2027]);
        assert.deepEqual(lifecycle, ['close']);
        assert.deepEqual(page, ['render 2/2027', 'announce']);
        assert.equal(heading.focused, true);
    });

    test('a locked Calendar\'s Go to month only closes — it must not move the month behind the card', () => {
        access = 'none';
        els.monthJumpMonth.value = '2'; els.monthJumpYear.value = '2027';
        els.monthJumpConfirm.fire('click');
        assert.deepEqual([getDisplayMonth(), getDisplayYear()], [10, 2026]);
        assert.deepEqual(lifecycle, ['close']);
        assert.deepEqual(page, []);
    });

    test('a lost grant closes it; a grant does not', () => {
        setCalendarAccess(true);
        assert.deepEqual(lifecycle, []);
        setCalendarAccess(false);
        assert.deepEqual(lifecycle, ['close']);
    });

    test('Cancel closes', () => {
        els.monthJumpCancel.fire('click');
        assert.deepEqual(lifecycle, ['close']);
    });
});
