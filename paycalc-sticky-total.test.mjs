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
 * with them. No mocks: the module's one import, `wireIosTap` (the bar's tap, since the iPhone audit
 * of 7 Nov 2026), is the real one, so the tap is tested through what it actually runs.
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

/** An element with listeners, dataset, style, a classList and a settable rect. */
function el(/** @type {string} */ id) {
    /** @type {Record<string, Function>} */
    const on = {};
    return {
        id, on, dataset: /** @type {Record<string, string>} */ ({}), style: { transform: '' }, classList: classes(),
        scrolled: 0, offsetHeight: 56, rect: { top: 0, bottom: 0 },
        addEventListener: (/** @type {string} */ t, /** @type {Function} */ fn) => { on[t] = fn; },
        scrollIntoView() { this.scrolled++; },
        getBoundingClientRect() { return this.rect; },
    };
}

/** @type {any} */ let bar;
/** @type {any} */ let card;
/** @type {any} */ let net;
/** @type {any} */ let body;
/** @type {Record<string, Function>} */ let docOn;
/** @type {Record<string, Function>} */ let winOn;
/** @type {number[]} */ let pageScrolls;
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
    winOn = {};
    pageScrolls = [];
    observers = [];
    vv = Object.assign(el('vv'), { height: 800, offsetTop: 0 });
    globalThis.document = /** @type {any} */ ({
        body,
        activeElement: null,
        getElementById: (/** @type {string} */ id) => (id === 'stickyTotal' ? bar : id === 'netDisplay' ? net : null),
        querySelector: (/** @type {string} */ s) => (s === '.result-card' ? card : null),
        addEventListener: (/** @type {string} */ t, /** @type {Function} */ fn) => { docOn[t] = fn; },
    });
    globalThis.window = /** @type {any} */ ({
        IntersectionObserver: globalThis.IntersectionObserver,
        visualViewport: vv,
        innerHeight: 800,
        matchMedia: (/** @type {string} */ q) => ({ matches: q.includes('coarse') ? coarse : q.includes('1024') ? wide : false }),
        addEventListener: (/** @type {string} */ t, /** @type {Function} */ fn) => { winOn[t] = fn; },
        // A scroll of the page moves every rect up by the same amount, as a real one does.
        scrollBy(/** @type {number} */ _x, /** @type {number} */ y) {
            pageScrolls.push(y);
            for (const e of [net, document.activeElement]) {
                if (e?.rect) e.rect = { top: e.rect.top - y, bottom: e.rect.bottom - y };
            }
        },
    });
}

const { initPaycalcStickyTotal, stickyBarShows, scrollToClearBar } = await import('./paycalc-sticky-total.js');

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

    // THE TAP iOS CANCELLED (the iPhone audit, 7 Nov 2026): with the keypad up, the keyboard's
    // dismissal shifts the viewport and the tap never becomes a click — the bar took two taps,
    // exactly while the member was typing. The touch alone must now do it, and let go of the field.
    test('a tap whose click never comes still takes you to the result, and lets go of the field', () => {
        initPaycalcStickyTotal();
        let blurred = 0;
        document.activeElement = /** @type {any} */ ({ tagName: 'INPUT', blur: () => { blurred++; } });
        bar.on.touchstart({ touches: [{ clientX: 5, clientY: 5 }] });
        bar.on.touchend({ preventDefault() {} });
        assert.equal(card.scrolled, 1, 'the touch alone must reach the result');
        assert.equal(blurred, 1, 'and the keyboard goes down, as a native tap would have taken it');
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

// ── THE KEYBOARD COVERS THE LAYOUT VIEWPORT WITHOUT SHRINKING IT (the iPhone audit, 7 Nov 2026) ──
//
// Two failures, and the rules that answer them are pure:
//   · typing on the Overtime / Rest Day Working rows put the £ behind the keys while the observer
//     still called it "in view" — so no bar came, the moment the live figure mattered most;
//   · where the bar did come, pinned above the keyboard, it sat on the box being typed in, because
//     iOS scrolls a focused box to just above the keyboard — exactly where the bar now is.
describe('stickyBarShows — with the keyboard up, only what is above the keys is on screen', () => {
    const visual = { top: 0, height: 500 };   // an 800px layout viewport, a 300px keyboard

    test('keyboard down: the observer\'s answer, both ways', () => {
        assert.equal(stickyBarShows({ inLayoutView: true, keyboardUp: false }), false);
        assert.equal(stickyBarShows({ inLayoutView: false, keyboardUp: false }), true);
    });
    test('THE DEFECT: the £ behind the keys shows the bar, though the observer calls it in view', () => {
        assert.equal(stickyBarShows({ inLayoutView: true, keyboardUp: true, figure: { top: 620, bottom: 660 }, visual }), true);
    });
    test('the £ above the keys needs no bar', () => {
        assert.equal(stickyBarShows({ inLayoutView: true, keyboardUp: true, figure: { top: 300, bottom: 340 }, visual }), false);
    });
    test('the £ scrolled off the top shows it too', () => {
        assert.equal(stickyBarShows({ inLayoutView: false, keyboardUp: true, figure: { top: -200, bottom: -160 }, visual }), true);
    });
    test('the top edge keeps the observer\'s 8px inset, so the two answers meet at one line', () => {
        assert.equal(stickyBarShows({ inLayoutView: true, keyboardUp: true, figure: { top: -32, bottom: 8 }, visual }), true);
        assert.equal(stickyBarShows({ inLayoutView: true, keyboardUp: true, figure: { top: -31, bottom: 9 }, visual }), false);
    });
    test('a visual viewport panned down the page is measured where it is', () => {
        const panned = { top: 200, height: 500 };   // iOS pans the visible area while the keys are up
        assert.equal(stickyBarShows({ inLayoutView: true, keyboardUp: true, figure: { top: 100, bottom: 140 }, visual: panned }), true);
        assert.equal(stickyBarShows({ inLayoutView: true, keyboardUp: true, figure: { top: 400, bottom: 440 }, visual: panned }), false);
    });
    test('without both rects the observer decides — visualViewport is feature-detected', () => {
        assert.equal(stickyBarShows({ inLayoutView: true, keyboardUp: true, figure: null, visual }), false);
        assert.equal(stickyBarShows({ inLayoutView: false, keyboardUp: true, figure: { top: 0, bottom: 40 }, visual: null }), true);
    });
});

describe('scrollToClearBar — the box being typed in sits above the bar', () => {
    const visual = { top: 0, height: 500 };   // the bar's bottom is the visual viewport's bottom
    const barHeight = 56;                      // so its top is at 444

    test('a box already clear of the bar is left where it is', () => {
        // bottom 436 + the 8px gap = 444, the bar's top: touching, not covered
        assert.equal(scrollToClearBar({ field: { top: 392, bottom: 436 }, visual, barHeight }), 0);
    });
    test('a box under the bar moves up by exactly the overlap, plus the gap', () => {
        // bottom 480, gap 8, bar top 444 → 44px
        assert.equal(scrollToClearBar({ field: { top: 436, bottom: 480 }, visual, barHeight }), 44);
    });
    test('never so far that the box\'s own top leaves the visible area', () => {
        // a 440px-tall box whose bottom is under the bar wants 34px, but only 30 - 8 = 22 is above it
        assert.equal(scrollToClearBar({ field: { top: 30, bottom: 470 }, visual, barHeight }), 22);
    });
    test('a panned visual viewport moves the bar with it', () => {
        assert.equal(scrollToClearBar({ field: { top: 636, bottom: 680 }, visual: { top: 200, height: 500 }, barHeight }), 44);
    });
});

describe('the wiring: with the keyboard up, the visible area decides and the box is cleared once', () => {
    /** Focus `field` and raise a 300px keyboard, as on a phone. */
    function typeIn(/** @type {any} */ field) {
        document.activeElement = field;
        docOn.focusin({ target: field });
        vv.height = 500;
        vv.on.resize();
    }

    test('THE DEFECT: the observer says "in view", the £ is behind the keys — the bar shows', () => {
        initPaycalcStickyTotal();
        observers[0].fire(true);                       // in the layout viewport…
        assert.ok(!bar.classList.contains('visible'));
        net.rect = { top: 620, bottom: 660 };          // …but below the keys
        const ot = Object.assign(el('otH'), { tagName: 'INPUT', rect: { top: 200, bottom: 244 } });
        typeIn(ot);
        assert.ok(bar.classList.contains('visible'), 'the £ is behind the keyboard, so the bar must carry it');
        assert.ok(body.classList.contains('sticky-active'));
    });

    test('the £ above the keys: no bar, whatever the keyboard', () => {
        initPaycalcStickyTotal();
        observers[0].fire(true);
        net.rect = { top: 300, bottom: 340 };
        typeIn(Object.assign(el('satH'), { tagName: 'INPUT', rect: { top: 100, bottom: 144 } }));
        assert.ok(!bar.classList.contains('visible'));
    });

    test('the box being typed in, under the bar, is scrolled clear of it — once', () => {
        initPaycalcStickyTotal();
        observers[0].fire(true);
        net.rect = { top: 620, bottom: 660 };
        const rdw = Object.assign(el('rdwH'), { tagName: 'INPUT', rect: { top: 436, bottom: 480 } });
        typeIn(rdw);                                   // iOS has put it just above the keys
        assert.deepEqual(pageScrolls, [44], 'moved up by the overlap with the bar, plus the gap');
        // The member scrolls it back under on purpose: not fought.
        rdw.rect = { top: 436, bottom: 480 };
        winOn.scroll();
        vv.on.scroll();
        assert.deepEqual(pageScrolls, [44], 'one correction per focus, never a tug of war');
    });

    test('a new focus may be cleared again', () => {
        mock.timers.enable({ apis: ['setTimeout'] });
        try {
            initPaycalcStickyTotal();
            observers[0].fire(true);
            net.rect = { top: 620, bottom: 660 };
            const a = Object.assign(el('otH'), { tagName: 'INPUT', rect: { top: 436, bottom: 480 } });
            typeIn(a);
            docOn.focusout();
            const b = Object.assign(el('otM'), { tagName: 'INPUT', rect: { top: 440, bottom: 484 } });
            document.activeElement = b;
            docOn.focusin({ target: b });              // field to field: the keyboard stays up
            assert.deepEqual(pageScrolls, [44, 48]);
        } finally { mock.timers.reset(); }
    });

    test('a button with focus is never scrolled for', () => {
        initPaycalcStickyTotal();
        observers[0].fire(true);
        net.rect = { top: 620, bottom: 660 };
        typeIn(Object.assign(el('otH'), { tagName: 'INPUT', rect: { top: 200, bottom: 244 } }));
        document.activeElement = /** @type {any} */ (Object.assign(el('b'), { tagName: 'BUTTON', rect: { top: 436, bottom: 480 } }));
        winOn.scroll();
        assert.deepEqual(pageScrolls, []);
    });

    test('scrolling the PAGE with the keys up re-decides, though the observer stays silent', () => {
        initPaycalcStickyTotal();
        observers[0].fire(true);
        net.rect = { top: 620, bottom: 660 };
        typeIn(Object.assign(el('satH'), { tagName: 'INPUT', rect: { top: 100, bottom: 144 } }));
        assert.ok(bar.classList.contains('visible'));
        net.rect = { top: 300, bottom: 340 };          // the member scrolls the £ up into view
        winOn.scroll();
        assert.ok(!bar.classList.contains('visible'));
    });

    test('keyboard down again: the observer decides once more', () => {
        mock.timers.enable({ apis: ['setTimeout'] });
        try {
            initPaycalcStickyTotal();
            observers[0].fire(true);
            net.rect = { top: 620, bottom: 660 };
            typeIn(Object.assign(el('otH'), { tagName: 'INPUT', rect: { top: 200, bottom: 244 } }));
            assert.ok(bar.classList.contains('visible'));
            document.activeElement = null;
            docOn.focusout();
            vv.height = 800;
            mock.timers.tick(300);
            assert.ok(!bar.classList.contains('visible'), 'the £ is in the layout viewport and nothing covers it');
        } finally { mock.timers.reset(); }
    });
});
