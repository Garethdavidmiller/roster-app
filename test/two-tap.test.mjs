// @ts-check
/**
 * two-tap.test.mjs — the two-tap destructive control (two-tap.js), and a feedback line's one fade
 * (feedback-line.js), driven directly.
 * Run with: node scripts/run-tests.mjs test/two-tap.test.mjs   (part of `npm run test:hygiene`)
 *
 * Both left admin-booked-periods.js on 25 Nov 2026. The lists that use them are still driven through
 * their own suites (admin-booked-periods.test.mjs, admin-saved-changes.test.mjs); this pins the control
 * itself, so a change to it fails here, under its own name, before it fails three lists at once.
 *
 * The double-tap minimum is measured on `performance.now()` (two-tap.js says why), which the timer
 * mock does not move, so `advance` moves both together.
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { twoTap, disarmConfirm, TWO_TAP_MIN_MS } from '../two-tap.js';
import { holdFeedback, fadeFeedback } from '../feedback-line.js';

let _now = 1000;
const advance = (/** @type {number} */ ms) => { _now += ms; mock.timers.tick(ms); };
beforeEach(() => { mock.timers.enable({ apis: ['setTimeout'] }); mock.method(performance, 'now', () => _now); });
afterEach(() => { mock.timers.reset(); mock.restoreAll(); });

/** The parts of a button the control touches: its classes, text, data, attributes and `disabled`. */
function button(/** @type {string} */ label = 'Delete this day') {
    /** @type {Set<string>} */ const classes = new Set();
    /** @type {Record<string, string>} */ const attrs = { 'aria-label': label };
    return /** @type {any} */ ({
        textContent: '✕', disabled: false, dataset: /** @type {Record<string, string>} */ ({}),
        classList: { add: (/** @type {string} */ c) => classes.add(c), remove: (/** @type {string} */ c) => classes.delete(c),
                     contains: (/** @type {string} */ c) => classes.has(c) },
        getAttribute: (/** @type {string} */ k) => attrs[k] ?? null,
        setAttribute: (/** @type {string} */ k, /** @type {string} */ v) => { attrs[k] = String(v); },
    });
}

describe('twoTap — the first tap arms, and only a considered second one confirms', () => {
    it('arms on the first tap: shows the armed text, says its meaning changed, confirms nothing', () => {
        const b = button();
        assert.equal(twoTap(b, 'Delete?', '✕'), false);
        assert.equal(b.textContent, 'Delete?');
        assert.ok(b.classList.contains('confirming'));
        assert.equal(b.getAttribute('aria-label'), 'Confirm delete this day', 'the accessible name says it is now asking');
    });

    it('the second tap of a double tap confirms nothing, and the control stays armed for a real answer', () => {
        const b = button();
        twoTap(b, 'Delete?', '✕');
        advance(TWO_TAP_MIN_MS - 1);
        assert.equal(twoTap(b, 'Delete?', '✕'), false);
        assert.equal(b.textContent, 'Delete?');
        advance(1);
        assert.equal(twoTap(b, 'Delete?', '✕'), true, 'a tap once the minimum has passed confirms');
    });

    it('re-arms for a new selection, with its own minimum and count — the count asked about is the count deleted', () => {
        const b = button('Delete selected');
        assert.equal(twoTap(b, 'Delete 2?', 'Delete selected', 'Confirm delete 2', 'a|b'), false, 'arms');
        advance(TWO_TAP_MIN_MS);
        assert.equal(twoTap(b, 'Delete 3?', 'Delete selected', 'Confirm delete 3', 'a|b|c'), false,
            'a changed selection re-arms rather than deleting what was never asked about');
        assert.equal(b.textContent, 'Delete 3?');
        assert.equal(b.getAttribute('aria-label'), 'Confirm delete 3');
        assert.equal(twoTap(b, 'Delete 3?', 'Delete selected', 'Confirm delete 3', 'a|b|c'), false, 'the re-arm has its own minimum');
        advance(TWO_TAP_MIN_MS);
        assert.equal(twoTap(b, 'Delete 3?', 'Delete selected', 'Confirm delete 3', 'a|b|c'), true);
    });

    it('disarms itself after five seconds — but never while disabled, which is how a delete in flight is marked', () => {
        const idle = button();
        twoTap(idle, 'Delete?', '✕');
        advance(5000);
        assert.equal(idle.textContent, '✕');
        assert.equal(idle.getAttribute('aria-label'), 'Delete this day', 'the idle name is back, not "Confirm confirm …"');

        const busy = button();
        twoTap(busy, 'Delete?', '✕');
        busy.disabled = true;
        busy.textContent = '…';
        advance(5000);
        assert.equal(busy.textContent, '…', 'a slow delete keeps its "…"');
    });

    it('disarmConfirm puts label, class and name back together, and stops the countdown', () => {
        const b = button();
        twoTap(b, 'Delete?', '✕');
        disarmConfirm(b, '✕');
        assert.equal(b.textContent, '✕');
        assert.ok(!b.classList.contains('confirming'));
        assert.equal(b.getAttribute('aria-label'), 'Delete this day');
        assert.equal(b.armTimer, undefined);
        // Re-armed, the earlier countdown cannot take the new question down early.
        twoTap(b, 'Delete?', '✕');
        advance(4999);
        assert.equal(b.textContent, 'Delete?');
    });
});

describe('feedback-line — one fade per line, cancelled by every later write', () => {
    it('a fade returns the line to its idle class', () => {
        const el = /** @type {any} */ ({ className: 'feedback success' });
        fadeFeedback(el, 'feedback', 6000);
        advance(5999);
        assert.equal(el.className, 'feedback success');
        advance(1);
        assert.equal(el.className, 'feedback');
    });

    it('holdFeedback stops an earlier message\'s fade taking a later one down', () => {
        const el = /** @type {any} */ ({ className: 'feedback success' });
        fadeFeedback(el, 'feedback', 6000);
        advance(3000);
        holdFeedback(el);
        el.className = 'feedback error';   // the later message, which must be read
        advance(10_000);
        assert.equal(el.className, 'feedback error');
    });

    it('a second fade replaces the first rather than running beside it', () => {
        const el = /** @type {any} */ ({ className: 'feedback success' });
        fadeFeedback(el, 'feedback', 2000);
        advance(1000);
        fadeFeedback(el, 'feedback', 6000);
        advance(1500);
        assert.equal(el.className, 'feedback success', 'the first fade was cancelled');
        advance(4500);
        assert.equal(el.className, 'feedback');
    });

    it('a missing line is no error', () => {
        assert.doesNotThrow(() => { holdFeedback(null); fadeFeedback(undefined, 'feedback', 10); });
    });
});
