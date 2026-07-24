/**
 * Unit tests for overlay.js: trapFocus, initCardCollapse, lockBodyScroll,
 * and unlockBodyScroll.
 * Run with: node --test overlay.test.mjs
 *
 * overlay.js has no module imports — only browser globals. A minimal stub
 * is provided before the import so the module loads cleanly in Node.
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ── Minimal browser-global stub (must be set before the import) ───────────────

const _bodyClasses = new Set();
const _bodyStyle   = new Map();
let   _lastScrollTo = { x: 0, y: 0 };

global.window = {
    scrollY:             100,
    scrollTo:            (x, y) => { _lastScrollTo = { x, y }; },
    addEventListener:    () => {},
    removeEventListener: () => {},
    matchMedia:          () => ({ matches: false }),
};
global.history = { pushState: () => {}, back: () => {} };
global.document = {
    activeElement: null,
    body: {
        classList: {
            add:      (...cls) => cls.forEach(c => _bodyClasses.add(c)),
            remove:   (...cls) => cls.forEach(c => _bodyClasses.delete(c)),
            contains: cls      => _bodyClasses.has(cls),
        },
        style: {
            setProperty:    (k, v) => _bodyStyle.set(k, v),
            removeProperty: k      => _bodyStyle.delete(k),
        },
    },
    getElementById:      () => null,
    addEventListener:    () => {},
    removeEventListener: () => {},
};
// Run requestAnimationFrame callbacks synchronously so open() tests are simpler.
global.requestAnimationFrame = fn => fn();

const {
    lockBodyScroll, unlockBodyScroll,
    trapFocus, initCardCollapse, createLightbox,
} = await import('./overlay.js');

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Create a minimal focusable element stub. */
function makeBtn({ disabled = false, ariaDisabled = null } = {}) {
    const el = { disabled, wasFocused: false };
    el.getAttribute = attr => (attr === 'aria-disabled' ? ariaDisabled : null);
    el.focus = () => {
        el.wasFocused = true;
        global.document.activeElement = el;
    };
    return el;
}

/** Create a container whose querySelectorAll returns the given elements. */
function makeContainer(children) {
    return { querySelectorAll: () => children };
}

/** Create a minimal element stub for DOM-wiring tests. */
function makeEl({ tagName = 'DIV', classes = [], attrs = {} } = {}) {
    const classList = new Set(classes);
    const _attrs    = { ...attrs };
    const listeners = {};
    return {
        tagName,
        classList: {
            add:      (...cls) => cls.forEach(c => classList.add(c)),
            remove:   (...cls) => cls.forEach(c => classList.delete(c)),
            contains: cls      => classList.has(cls),
            toggle: (cls, force) => {
                if (force !== undefined) {
                    force ? classList.add(cls) : classList.delete(cls);
                    return !!force;
                }
                const had = classList.has(cls);
                had ? classList.delete(cls) : classList.add(cls);
                return !had;
            },
        },
        getAttribute:    attr      => _attrs[attr] ?? null,
        setAttribute:    (attr, v) => { _attrs[attr] = String(v); },
        hasAttribute:    attr      => attr in _attrs,
        addEventListener: (type, fn) => {
            listeners[type] = listeners[type] || [];
            listeners[type].push(fn);
        },
        removeEventListener: (type, fn) => {
            listeners[type] = (listeners[type] || []).filter(f => f !== fn);
        },
        _trigger: (type, evt = {}) => (listeners[type] || []).slice().forEach(fn => fn(evt)),
    };
}

// ── lockBodyScroll / unlockBodyScroll ─────────────────────────────────────────

// lockBodyScroll/unlockBodyScroll are DEPTH-COUNTED (v16.16) via a module-level counter, so
// drain any leaked depth between tests (10 unlocks is far more than any test nests).
function _drainLock() { for (let i = 0; i < 10; i++) unlockBodyScroll(); }

describe('lockBodyScroll', () => {
    beforeEach(() => {
        _drainLock();
        _bodyClasses.clear();
        _bodyStyle.clear();
        global.window.scrollY = 100;
    });

    test('adds lb-open class to body', () => {
        lockBodyScroll();
        assert.equal(_bodyClasses.has('lb-open'), true);
    });

    test('sets --lb-scroll-y to the negative current scroll position', () => {
        global.window.scrollY = 250;
        lockBodyScroll();
        assert.equal(_bodyStyle.get('--lb-scroll-y'), '-250px');
    });
});

describe('unlockBodyScroll', () => {
    beforeEach(() => {
        _drainLock();
        _bodyClasses.clear();
        _bodyStyle.clear();
        _lastScrollTo = { x: 0, y: 0 };
        global.window.scrollY = 100;
        lockBodyScroll(); // establish locked state (depth 0→1)
    });

    test('removes lb-open class from body', () => {
        unlockBodyScroll();
        assert.equal(_bodyClasses.has('lb-open'), false);
    });

    test('removes --lb-scroll-y property from body style', () => {
        unlockBodyScroll();
        assert.equal(_bodyStyle.has('--lb-scroll-y'), false);
    });

    test('restores the scroll position saved by lockBodyScroll', () => {
        unlockBodyScroll();
        assert.equal(_lastScrollTo.y, 100);
    });
});

describe('lockBodyScroll — nesting (depth counter, v16.16)', () => {
    beforeEach(() => {
        _drainLock();
        _bodyClasses.clear();
        _bodyStyle.clear();
        _lastScrollTo = { x: 0, y: 0 };
        global.window.scrollY = 100;
    });

    test('a nested lock/unlock keeps the lock until the OUTERMOST unlock', () => {
        lockBodyScroll();                 // outer: depth 0→1, captures scrollY=100
        global.window.scrollY = 0;        // once .lb-open (position:fixed) is applied, scrollY reads 0
        lockBodyScroll();                 // inner: depth 1→2, must NOT re-capture (would clobber to 0)
        assert.equal(_bodyStyle.get('--lb-scroll-y'), '-100px', 'inner lock did not overwrite the baseline');

        unlockBodyScroll();               // inner: depth 2→1, still locked
        assert.equal(_bodyClasses.has('lb-open'), true, 'still locked after the inner unlock');

        unlockBodyScroll();               // outer: depth 1→0, restores
        assert.equal(_bodyClasses.has('lb-open'), false);
        assert.equal(_lastScrollTo.y, 100, 'restored the ORIGINAL scroll position, not 0');
    });

    test('an UNBALANCED second unlock at depth 0 does NOT re-run scrollTo (v16.19 double-unlock guard)', () => {
        lockBodyScroll();                 // depth 0→1, captures scrollY=100
        unlockBodyScroll();               // depth 1→0, restores to 100
        assert.equal(_lastScrollTo.y, 100);
        // Reader scrolls away after the overlay closed; then a stray second unlock fires (Android
        // Back closes the nav drawer mid doc-fetch, then the fetch's own close unlocks again). It
        // must be a no-op — previously it re-ran scrollTo(0, staleOffset=100), yanking the reader back.
        global.window.scrollY = 500;
        _lastScrollTo = { x: 0, y: 0 };
        unlockBodyScroll();               // depth already 0 → must NOT scroll
        assert.equal(_lastScrollTo.y, 0, 'depth-0 unlock re-ran scrollTo with a stale offset');
    });
});

// ── trapFocus ─────────────────────────────────────────────────────────────────

describe('trapFocus', () => {
    test('no-op when key is not Tab', () => {
        const btn = makeBtn();
        trapFocus(makeContainer([btn]), { key: 'Enter', shiftKey: false, preventDefault: () => {} });
        assert.equal(btn.wasFocused, false);
    });

    test('no-op when container is null', () => {
        assert.doesNotThrow(() =>
            trapFocus(null, { key: 'Tab', shiftKey: false, preventDefault: () => {} }));
    });

    test('preventDefault and no focus change when container has no focusable elements', () => {
        let prevented = false;
        trapFocus(makeContainer([]), { key: 'Tab', shiftKey: false, preventDefault: () => { prevented = true; } });
        assert.equal(prevented, true);
    });

    test('Tab forward from last element wraps focus to first', () => {
        const first = makeBtn();
        const last  = makeBtn();
        global.document.activeElement = last;
        let prevented = false;
        trapFocus(makeContainer([first, last]), {
            key: 'Tab', shiftKey: false, preventDefault: () => { prevented = true; },
        });
        assert.equal(first.wasFocused, true);
        assert.equal(prevented, true);
    });

    test('Tab forward from a non-last element does not wrap', () => {
        const first  = makeBtn();
        const second = makeBtn();
        const last   = makeBtn();
        global.document.activeElement = second;
        let prevented = false;
        trapFocus(makeContainer([first, second, last]), {
            key: 'Tab', shiftKey: false, preventDefault: () => { prevented = true; },
        });
        assert.equal(first.wasFocused, false);
        assert.equal(prevented, false);
    });

    test('Shift+Tab from first element wraps focus to last', () => {
        const first = makeBtn();
        const last  = makeBtn();
        global.document.activeElement = first;
        let prevented = false;
        trapFocus(makeContainer([first, last]), {
            key: 'Tab', shiftKey: true, preventDefault: () => { prevented = true; },
        });
        assert.equal(last.wasFocused, true);
        assert.equal(prevented, true);
    });

    test('disabled element is excluded from the focusable list', () => {
        const first    = makeBtn();
        const disabled = makeBtn({ disabled: true });
        const last     = makeBtn();
        // Without disabled: focusable = [first, last]; Tab from last wraps to first
        global.document.activeElement = last;
        let prevented = false;
        trapFocus(makeContainer([first, disabled, last]), {
            key: 'Tab', shiftKey: false, preventDefault: () => { prevented = true; },
        });
        assert.equal(first.wasFocused, true);
        assert.equal(prevented, true);
    });

    test('Shift+Tab from the CONTAINER itself wraps to last (panel-focus leak guard)', () => {
        // Default open focus lands on the .lb-content panel (tabindex="-1"), which is outside the
        // focusable set. Without the container-focus branch, Shift+Tab here fires no wrap and the
        // browser walks focus out of the modal into the page behind. It must wrap to `last`.
        const first     = makeBtn();
        const last      = makeBtn();
        const container = makeContainer([first, last]);
        global.document.activeElement = container;
        let prevented = false;
        trapFocus(container, {
            key: 'Tab', shiftKey: true, preventDefault: () => { prevented = true; },
        });
        assert.equal(last.wasFocused, true);
        assert.equal(first.wasFocused, false);
        assert.equal(prevented, true);
    });

    test('Tab from the CONTAINER itself moves to first', () => {
        const first     = makeBtn();
        const last      = makeBtn();
        const container = makeContainer([first, last]);
        global.document.activeElement = container;
        let prevented = false;
        trapFocus(container, {
            key: 'Tab', shiftKey: false, preventDefault: () => { prevented = true; },
        });
        assert.equal(first.wasFocused, true);
        assert.equal(last.wasFocused, false);
        assert.equal(prevented, true);
    });

    test('aria-disabled="true" element is excluded from the focusable list', () => {
        const first        = makeBtn();
        const ariaDisabled = makeBtn({ ariaDisabled: 'true' });
        const last         = makeBtn();
        global.document.activeElement = last;
        let prevented = false;
        trapFocus(makeContainer([first, ariaDisabled, last]), {
            key: 'Tab', shiftKey: false, preventDefault: () => { prevented = true; },
        });
        assert.equal(first.wasFocused, true);
        assert.equal(prevented, true);
    });
});

// ── initCardCollapse ──────────────────────────────────────────────────────────

describe('initCardCollapse', () => {
    let header, body, chevron;

    beforeEach(() => {
        header  = makeEl({ tagName: 'DIV' });
        body    = makeEl();
        chevron = makeEl();
        global.document.getElementById = id => {
            if (id === 'hdr') return header;
            if (id === 'bdy') return body;
            if (id === 'chv') return chevron;
            return null;
        };
    });

    test('no-op without throwing when header is not found', () => {
        assert.doesNotThrow(() => initCardCollapse('missing-hdr', 'bdy'));
    });

    test('no-op without throwing when body is not found', () => {
        assert.doesNotThrow(() => initCardCollapse('hdr', 'missing-bdy'));
    });

    test('clicking header adds open class to body', () => {
        initCardCollapse('hdr', 'bdy');
        header._trigger('click');
        assert.equal(body.classList.contains('open'), true);
    });

    test('clicking header twice returns body to closed state', () => {
        initCardCollapse('hdr', 'bdy');
        header._trigger('click');
        header._trigger('click');
        assert.equal(body.classList.contains('open'), false);
    });

    test('aria-expanded starts false and reflects toggle state', () => {
        initCardCollapse('hdr', 'bdy');
        assert.equal(header.getAttribute('aria-expanded'), 'false');
        header._trigger('click');
        assert.equal(header.getAttribute('aria-expanded'), 'true');
        header._trigger('click');
        assert.equal(header.getAttribute('aria-expanded'), 'false');
    });

    test('aria-expanded initialises to true when body already has open class', () => {
        body = makeEl({ classes: ['open'] });
        global.document.getElementById = id => id === 'hdr' ? header : id === 'bdy' ? body : null;
        initCardCollapse('hdr', 'bdy');
        assert.equal(header.getAttribute('aria-expanded'), 'true');
    });

    test('Enter key triggers toggle', () => {
        initCardCollapse('hdr', 'bdy');
        header._trigger('keydown', { key: 'Enter', preventDefault: () => {} });
        assert.equal(body.classList.contains('open'), true);
    });

    test('Space key triggers toggle', () => {
        initCardCollapse('hdr', 'bdy');
        header._trigger('keydown', { key: ' ', preventDefault: () => {} });
        assert.equal(body.classList.contains('open'), true);
    });

    test('other keys do not trigger toggle', () => {
        initCardCollapse('hdr', 'bdy');
        header._trigger('keydown', { key: 'ArrowDown', preventDefault: () => {} });
        assert.equal(body.classList.contains('open'), false);
    });

    test('chevron gains open class when body opens', () => {
        initCardCollapse('hdr', 'bdy', 'chv');
        header._trigger('click');
        assert.equal(chevron.classList.contains('open'), true);
    });

    test('chevron loses open class when body closes', () => {
        initCardCollapse('hdr', 'bdy', 'chv');
        header._trigger('click'); // open
        header._trigger('click'); // close
        assert.equal(chevron.classList.contains('open'), false);
    });

    test('onToggle callback receives the new open state', () => {
        const states = [];
        initCardCollapse('hdr', 'bdy', null, open => states.push(open));
        header._trigger('click');
        header._trigger('click');
        assert.deepEqual(states, [true, false]);
    });

    test('non-button/anchor header receives role=button', () => {
        initCardCollapse('hdr', 'bdy'); // header is DIV
        assert.equal(header.getAttribute('role'), 'button');
    });

    test('non-button/anchor header receives tabindex=0', () => {
        initCardCollapse('hdr', 'bdy');
        assert.equal(header.getAttribute('tabindex'), '0');
    });

    test('button header does not receive role=button', () => {
        header.tagName = 'BUTTON';
        initCardCollapse('hdr', 'bdy');
        assert.equal(header.getAttribute('role'), null);
    });

    test('header gets aria-controls pointing to body id', () => {
        initCardCollapse('hdr', 'bdy');
        assert.equal(header.getAttribute('aria-controls'), 'bdy');
    });
});

// ── createLightbox — re-open during the close fade (review F1) ─────────────────

describe('createLightbox — re-open during the close fade', () => {
    beforeEach(() => { _drainLock(); _bodyClasses.clear(); global.document.activeElement = null; });

    function build() {
        const overlay  = makeEl({ classes: [] });
        const content  = makeEl({});
        const closeBtn = makeEl({});
        const lb = createLightbox({ overlay, content, closeBtn });
        return { overlay, content, lb };
    }

    test('re-opening while still fading out re-shows the overlay instead of silently no-opping', () => {
        const { overlay, lb } = build();
        lb.open();
        assert.equal(overlay.classList.contains('visible'), true);
        assert.equal(overlay.classList.contains('open'), true);
        assert.equal(_bodyClasses.has('lb-open'), true, 'scroll locked while open');

        lb.close();   // matchMedia matches:false → animated close: .open removed, .visible remains, finish pending
        assert.equal(overlay.classList.contains('open'), false);
        assert.equal(overlay.classList.contains('visible'), true, 'still visible mid-fade');

        lb.open();    // re-open DURING the fade — must complete the pending close then re-show
        assert.equal(overlay.classList.contains('open'), true, 're-opened, not dropped');
        assert.equal(overlay.classList.contains('visible'), true);
        assert.equal(_bodyClasses.has('lb-open'), true, 'still locked exactly once (balanced)');

        // The ORIGINAL close's pending transitionend must now be an idempotent no-op — it must not
        // hide the freshly re-opened overlay or double-unlock scroll.
        overlay._trigger('transitionend');
        assert.equal(overlay.classList.contains('visible'), true, 'stale finisher does not hide the re-opened overlay');
        assert.equal(_bodyClasses.has('lb-open'), true, 'stale finisher does not release the lock');

        // A real close now fully tears down and unlocks.
        lb.close();
        overlay._trigger('transitionend');
        assert.equal(overlay.classList.contains('visible'), false, 'closed');
        assert.equal(_bodyClasses.has('lb-open'), false, 'unlocked after the real close');
    });

    test('a normal open → transitionend-settled close → re-open still works (scroll balanced)', () => {
        const { overlay, lb } = build();
        lb.open();
        lb.close();
        overlay._trigger('transitionend');   // close settles normally
        assert.equal(overlay.classList.contains('visible'), false);
        assert.equal(_bodyClasses.has('lb-open'), false);
        lb.open();                            // fresh open after a clean close
        assert.equal(overlay.classList.contains('open'), true);
        assert.equal(_bodyClasses.has('lb-open'), true);
    });
});
