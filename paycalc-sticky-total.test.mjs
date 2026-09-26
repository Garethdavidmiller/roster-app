// @ts-check
/**
 * paycalc-sticky-total.test.mjs — the bar that keeps the take-home figure on screen.
 * Run: node --test paycalc-sticky-total.test.mjs   (part of `npm run test:hygiene`)
 *
 * WHY THIS FILE EXISTS (v24.28 review). module-coverage-parity counted paycalc-sticky-total.js as
 * "named" only because coordinator-ratchet.test.mjs mentions it in a COMMENT; nothing loaded it. Its
 * own header says the visual-viewport behaviour "is not reproducible in headless or e2e", which is
 * true of a real iOS keyboard and not of the state machine that reacts to one. That part is pure
 * wiring over four browser APIs, and every guard in it is the fix to a reported iOS defect — so each
 * is pinned here against a hand-built DOM, in the terms the header states it:
 *
 *   · the bar shows whenever the figure is OFF-SCREEN, in either direction (v16.69);
 *   · init is single-shot and never disconnects the observer (the v16.19 frozen-bar bug);
 *   · on a touch device the bar is PINNED above the soft keyboard, not hidden (v21.65), and the
 *     translate COMPOSES with the desktop centring rule rather than replacing it;
 *   · moving between fields (focusout → focusin) never un-pins it (v16.19).
 *
 * What stays device-only is whether iOS reports those viewport numbers — not what this code does
 * with them. No imports, no mocks: the module has none.
 */
import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

/** A classList that can be read back. */
function classes() {
    const set = new Set();
    return {
        set,
        toggle: (/** @type {string} */ c, /** @type {boolean} */ on) => { on ? set.add(c) : set.delete(c); },
        contains: (/** @type {string} */ c) => set.has(c),
    };
}

/** An element with listeners, dataset, style and a classList. */
function el(/** @type {string} */ id) {
    /** @type {Record<string, Function>} */
    const on = {};
    return {
        id, on, dataset: /** @type {Record<string, string>} */ ({}), style: { transform: '' }, classList: classes(),
        scrolled: 0,
        addEventListener: (/** @type {string} */ t, /** @type {Function} */ fn) => { on[t] = fn; },
        scrollIntoView() { this.scrolled++; },
    };
}

/** @type {any} */ let bar;
/** @type {any} */ let card;
/** @type {any} */ let net;
/** @type {any} */ let body;
/** @type {Record<string, Function>} */ let docOn;
/** @type {any[]} */ let observers;
/** @type {any} */ let vv;
let coarse = true;
let wide = false;

globalThis.requestAnimationFrame = /** @type {any} */ ((/** @type {Function} */ fn) => fn());
globalThis.IntersectionObserver = /** @type {any} */ (class {
    /** @param {Function} cb */
    constructor(cb) { this.cb = cb; this.targets = []; this.disconnected = false; observers.push(this); }
    observe(/** @type {any} */ t) { this.targets.push(t); }
    disconnect() { this.disconnected = true; }
    fire(/** @type {boolean} */ isIntersecting) { this.cb([{ isIntersecting }]); }
});

function setup({ withNet = true } = {}) {
    bar = el('stickyTotal');
    card = el('result-card');
    net = withNet ? el('netDisplay') : null;
    body = { classList: classes() };
    docOn = {};
    observers = [];
    vv = Object.assign(el('vv'), { height: 800, offsetTop: 0 });
    globalThis.document = /** @type {any} */ ({
        body,
        getElementById: (/** @type {string} */ id) => (id === 'stickyTotal' ? bar : id === 'netDisplay' ? net : null),
        querySelector: (/** @type {string} */ s) => (s === '.result-card' ? card : null),
        addEventListener: (/** @type {string} */ t, /** @type {Function} */ fn) => { docOn[t] = fn; },
    });
    globalThis.window = /** @type {any} */ ({
        IntersectionObserver: globalThis.IntersectionObserver,
        visualViewport: vv,
        innerHeight: 800,
        matchMedia: (/** @type {string} */ q) => ({ matches: q.includes('coarse') ? coarse : q.includes('1024') ? wide : false }),
    });
}

const { initPaycalcStickyTotal } = await import('./paycalc-sticky-total.js');

beforeEach(() => { coarse = true; wide = false; setup(); });

describe('the bar shows exactly while the figure is off-screen', () => {
    test('it watches the £ figure itself, not the whole card', () => {
        initPaycalcStickyTotal();
        assert.equal(observers.length, 1);
        assert.deepEqual(observers[0].targets, [net]);
    });

    test('figure out of view → bar visible and the page padded; back in view → both cleared', () => {
        initPaycalcStickyTotal();
        observers[0].fire(false);
        assert.ok(bar.classList.contains('visible'));
        assert.ok(body.classList.contains('sticky-active'));
        observers[0].fire(true);
        assert.ok(!bar.classList.contains('visible'));
        assert.ok(!body.classList.contains('sticky-active'));
    });

    test('init is single-shot, and nothing ever disconnects the observer (the v16.19 frozen bar)', () => {
        initPaycalcStickyTotal();
        initPaycalcStickyTotal();
        assert.equal(observers.length, 1, 'a second init must not stack a second observer');
        assert.equal(observers[0].disconnected, false);
    });

    test('a page without the bar is a no-op, not a throw', () => {
        setup();
        bar = null;
        assert.doesNotThrow(() => initPaycalcStickyTotal());
        assert.equal(observers.length, 0);
    });

    test('tapping the bar scrolls to the result', () => {
        initPaycalcStickyTotal();
        bar.on.click();
        assert.equal(card.scrolled, 1);
    });
});

describe('on a touch device the bar rides ABOVE the soft keyboard (v21.65)', () => {
    /** Focus a field and raise a 300px keyboard. */
    function keyboardUp() {
        docOn.focusin({ target: { tagName: 'INPUT' } });
        vv.height = 500;
        vv.on.resize();
    }

    test('it is pinned — translated up by the keyboard gap — not hidden', () => {
        initPaycalcStickyTotal();
        keyboardUp();
        assert.ok(bar.classList.contains('keyboard-up'));
        assert.equal(bar.style.transform, 'translateY(-300px)');
    });

    test('on a wide touch screen the translate COMPOSES with the desktop centring', () => {
        wide = true;
        initPaycalcStickyTotal();
        keyboardUp();
        assert.equal(bar.style.transform, 'translateX(-50%) translateY(-300px)',
            'a bare translateY throws the bar to the left edge on an iPad');
    });

    test('a fine pointer never pins — a desktop window resize is not a keyboard', () => {
        coarse = false;
        initPaycalcStickyTotal();
        keyboardUp();
        assert.ok(!bar.classList.contains('keyboard-up'));
        assert.equal(bar.style.transform, '');
    });

    test('moving field to field (focusout → focusin) keeps it pinned', () => {
        mock.timers.enable({ apis: ['setTimeout'] });
        try {
            initPaycalcStickyTotal();
            keyboardUp();
            docOn.focusout();
            docOn.focusin({ target: { tagName: 'INPUT' } });
            mock.timers.tick(300);
            assert.ok(bar.classList.contains('keyboard-up'), 'tabbing between hours fields un-pinned the bar');
        } finally {
            mock.timers.reset();
        }
    });

    test('leaving the fields for good un-pins it once the keyboard is down', () => {
        mock.timers.enable({ apis: ['setTimeout'] });
        try {
            initPaycalcStickyTotal();
            keyboardUp();
            docOn.focusout();
            mock.timers.tick(300);
            assert.ok(!bar.classList.contains('keyboard-up'));
            assert.equal(bar.style.transform, '');
        } finally {
            mock.timers.reset();
        }
    });
});
