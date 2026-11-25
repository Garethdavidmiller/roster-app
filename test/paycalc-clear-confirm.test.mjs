// @ts-check
/**
 * paycalc-clear-confirm.test.mjs — the Pay Calculator's two-tap "Clear all entries".
 * Run: node scripts/run-tests.mjs test/paycalc-clear-confirm.test.mjs   (part of `npm run test:hygiene`)
 *
 * @nodeps-safe — runs on a bare checkout with nothing installed.
 *
 * Organised by what a wrong answer costs. The control deletes a payslip's entries, so the expensive
 * direction is a delete nobody confirmed: one tap, a double tap, or a confirm left armed on the
 * payslip before. The cheap direction — a confirm that never takes — is held too, because a guard
 * that ignores every second tap would pass the first half alone. The rendered countdown and the
 * whole page around it are e2e/paycalc.spec.js's ("Clear all entries" needs a second tap…).
 */
import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createClearConfirm, CLEAR_CONFIRM_MIN_MS } from '../paycalc-clear-confirm.js';

/** A fake button: its label, its classes and the click listener the module wires. */
function fakeButton() {
    const cls = new Set();
    /** @type {Function[]} */ const clicks = [];
    return {
        textContent: 'Clear all entries',
        classList: { add: (/** @type {string} */ c) => cls.add(c), remove: (/** @type {string} */ c) => cls.delete(c), contains: (/** @type {string} */ c) => cls.has(c) },
        addEventListener(/** @type {string} */ type, /** @type {Function} */ fn) { if (type === 'click') clicks.push(fn); },
        click() { for (const fn of clicks) fn(); },
    };
}

// performance.now() is the clock (rule 3), and mock.timers does not move it — so it is held here, and
// moved with the timers by `wait`. Date is pinned and never moves: the e2e suites pin it the same way.
let now = 1000;
const realPerformance = globalThis.performance;
/** Let `ms` pass, on the timers and the monotonic clock together. @param {number} ms */
const wait = (ms) => { now += ms; mock.timers.tick(ms); };

/** @type {ReturnType<typeof fakeButton>} */ let btn;
/** @type {number} */ let cleared;
/** @type {{ reset: () => void }} */ let control;
beforeEach(() => {
    now = 1000;
    Object.defineProperty(globalThis, 'performance', { value: { now: () => now }, configurable: true });
    mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: new Date(2026, 10, 25, 12) });
    btn = fakeButton(); cleared = 0;
    control = createClearConfirm(/** @type {any} */ (btn), () => { cleared++; });
});
afterEach(() => {
    mock.timers.reset();
    Object.defineProperty(globalThis, 'performance', { value: realPerformance, configurable: true });
});

describe('a delete nobody confirmed', () => {
    test('one tap only arms it, and says so', () => {
        btn.click();
        assert.equal(cleared, 0);
        assert.equal(btn.textContent, 'Select again to confirm (3)');
        assert.equal(btn.classList.contains('confirming'), true);
    });

    test('a double tap is ONE gesture: the second tap at once confirms nothing, and it stays armed', () => {
        btn.click();
        wait(CLEAR_CONFIRM_MIN_MS - 1);
        btn.click();
        assert.equal(cleared, 0, 'a tap straight after arming does not confirm');
        assert.equal(btn.classList.contains('confirming'), true, 'still armed for a real answer');
    });

    test('three seconds disarm it, counting down a second at a time', () => {
        btn.click();
        wait(1000);
        assert.equal(btn.textContent, 'Select again to confirm (2)');
        wait(1000);
        assert.equal(btn.textContent, 'Select again to confirm (1)');
        wait(1000);
        assert.equal(btn.textContent, 'Clear all entries');
        assert.equal(btn.classList.contains('confirming'), false);
        btn.click();
        assert.equal(cleared, 0, 'the next tap arms afresh rather than confirming');
    });

    test('reset disarms it — a change of payslip, a hidden tab — and its timers go with it', () => {
        btn.click();
        control.reset();
        assert.equal(btn.textContent, 'Clear all entries');
        assert.equal(btn.classList.contains('confirming'), false);
        wait(1000);
        assert.equal(btn.textContent, 'Clear all entries', 'the stopped countdown does not write over the idle label');
        btn.click();
        assert.equal(cleared, 0, 'one tap after a reset only arms');
        wait(5000);
        assert.equal(btn.textContent, 'Clear all entries', 'nothing left over re-labels it');
    });

    test('a re-arm after a reset gets its own three seconds — the old countdown cannot cut it short', () => {
        btn.click();
        control.reset();
        wait(1000);
        btn.click();                                   // armed again, 1s after the first
        wait(2500);                                    // past the FIRST arming's three seconds
        assert.equal(btn.classList.contains('confirming'), true, 'the first arming\'s timer disarmed the second');
        assert.equal(btn.textContent, 'Select again to confirm (1)');
        btn.click();
        assert.equal(cleared, 1, 'and the answer still takes');
    });

    test('the gap is read on the monotonic clock, not Date — which the suites pin', () => {
        // Date never moves here (pinned, as e2e pins it). Measured on Date, no tap could ever count as
        // a second one; on performance.now(), the second tap a second later confirms.
        btn.click();
        now += 1000;   // the monotonic clock moves; Date and the timers do not
        btn.click();
        assert.equal(cleared, 1);
    });
});

describe('a confirm that never takes', () => {
    test('a second tap after the gap clears once, and disarms first', () => {
        let labelAtConfirm = '';
        btn = fakeButton();
        createClearConfirm(/** @type {any} */ (btn), () => { cleared++; labelAtConfirm = btn.textContent; });
        btn.click();
        wait(CLEAR_CONFIRM_MIN_MS);
        btn.click();
        assert.equal(cleared, 1);
        assert.equal(labelAtConfirm, 'Clear all entries', 'disarmed before the clear runs');
        wait(4000);
        assert.equal(cleared, 1, 'nothing fires again');
    });

    test('no button on the page: nothing is wired and reset is harmless', () => {
        const c = createClearConfirm(null, () => { cleared++; });
        c.reset();
        assert.equal(cleared, 0);
    });
});
