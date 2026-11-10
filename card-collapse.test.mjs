/**
 * card-collapse.test.mjs — the deep link that opens a collapsed card by name (`openCardNamedByHash`), and
 * overlay.js still handing out both card functions.
 * Run: node scripts/run-tests.mjs card-collapse.test.mjs   (part of `npm run test:hygiene`)
 *
 * `initCardCollapse` is tested by overlay.test.mjs, through overlay.js's re-export. The deep link had no
 * Node test, and its rules are the kind that look right and are not: it opens the card through the SAME
 * click a tap makes, it corrects the scroll each time the page GROWS rather than after a guessed delay
 * (card-collapse.js has the measurements that retired the timer), the first real gesture stops it for
 * good, and the watch ends by itself. No DOM: plain stubs for the handful of globals it reads in a call.
 */
import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

/** @type {Map<string, Set<Function>>} */
const winListeners = new Map();
/** @type {Map<string, any>} */
const elements = new Map();
/** @type {any[]} */
let observers = [];

const g = /** @type {any} */ (globalThis);
g.window = {
    location: { hash: '' },
    addEventListener: (/** @type {string} */ type, /** @type {Function} */ fn) => {
        if (!winListeners.has(type)) winListeners.set(type, new Set());
        winListeners.get(type)?.add(fn);
    },
    removeEventListener: (/** @type {string} */ type, /** @type {Function} */ fn) => { winListeners.get(type)?.delete(fn); },
    matchMedia: () => ({ matches: false }),
};
g.history = { pushState() {}, back() {} };
g.document = { getElementById: (/** @type {string} */ id) => elements.get(id) ?? null };
g.MouseEvent = class { constructor(/** @type {string} */ type, /** @type {object} */ init) { this.type = type; Object.assign(this, init); } };
class FakeResizeObserver {
    constructor(/** @type {Function} */ cb) { this.cb = cb; this.targets = /** @type {any[]} */ ([]); this.disconnected = false; observers.push(this); }
    observe(/** @type {any} */ t) { this.targets.push(t); }
    disconnect() { this.disconnected = true; }
}

const { openCardNamedByHash, initCardCollapse } = await import('./card-collapse.js');

/** A card, its body and its toggle, registered under the ids the deep link looks up. */
function mountCard({ open = false } = {}) {
    const card = { scrolls: /** @type {any[]} */ ([]), scrollIntoView(/** @type {any} */ opts) { this.scrolls.push(opts); } };
    const body = { classList: { contains: (/** @type {string} */ c) => c === 'open' && open } };
    const toggle = { events: /** @type {any[]} */ ([]), dispatchEvent(/** @type {any} */ e) { this.events.push(e); return true; } };
    elements.set('payCard', card);
    elements.set('payBody', body);
    elements.set('payToggle', toggle);
    return { card, body, toggle };
}
/** Fire every window listener for one event type, as a real gesture would. */
const gesture = (/** @type {string} */ type) => [...(winListeners.get(type) ?? [])].forEach(fn => fn());

describe('openCardNamedByHash — the deep link that opens a collapsed card', () => {
    beforeEach(() => {
        elements.clear();
        winListeners.clear();
        observers = [];
        g.ResizeObserver = FakeResizeObserver;
        g.window.location.hash = '#payCard';
        mock.timers.enable({ apis: ['setTimeout'] });
    });
    afterEach(() => { mock.timers.reset(); });

    test('a fragment naming another card does nothing at all', () => {
        const { card, toggle } = mountCard();
        g.window.location.hash = '#someOtherCard';
        assert.equal(openCardNamedByHash('payCard', 'payBody', 'payToggle'), false);
        assert.deepEqual([card.scrolls.length, toggle.events.length, observers.length], [0, 0, 0]);
    });

    test('a card that is not on the page is reported, not acted on', () => {
        assert.equal(openCardNamedByHash('payCard', 'payBody', 'payToggle'), false);
        assert.equal(observers.length, 0, 'nothing is watched for a card that is not there');
    });

    test('a collapsed card opens through its toggle — the click a tap makes — and goes to the top', () => {
        const { card, toggle } = mountCard();
        assert.equal(openCardNamedByHash('payCard', 'payBody', 'payToggle'), true);
        assert.equal(toggle.events.length, 1);
        assert.equal(toggle.events[0].type, 'click');
        assert.equal(toggle.events[0].bubbles, true, 'the click bubbles, as a real one does, so the header handler sees it');
        assert.deepEqual(card.scrolls, [{ block: 'start' }]);
    });

    test('a card already open is not toggled shut', () => {
        const { card, toggle } = mountCard({ open: true });
        assert.equal(openCardNamedByHash('payCard', 'payBody', 'payToggle'), true);
        assert.equal(toggle.events.length, 0);
        assert.equal(card.scrolls.length, 1, 'still brought to the top');
    });

    test('every growth of the page brings the card back to the top, until the first real gesture', () => {
        const { card } = mountCard();
        openCardNamedByHash('payCard', 'payBody', 'payToggle');
        const [ro] = observers;
        assert.ok(ro, 'the page body is watched for growth');
        ro.cb();
        ro.cb();
        assert.equal(card.scrolls.length, 3, 'one scroll at once, one per growth');
        gesture('wheel');
        assert.equal(ro.disconnected, true, 'a gesture stops the watch');
        ro.cb();
        assert.equal(card.scrolls.length, 3, 'and nobody reading is yanked back up');
        for (const type of ['wheel', 'touchstart', 'keydown']) {
            assert.equal(winListeners.get(type)?.size ?? 0, 0, `the ${type} listener is removed with it`);
        }
    });

    test('a touch or a key counts as a gesture too', () => {
        for (const type of ['touchstart', 'keydown']) {
            winListeners.clear();
            observers = [];
            mountCard();
            openCardNamedByHash('payCard', 'payBody', 'payToggle');
            gesture(type);
            assert.equal(observers[0].disconnected, true, `${type} stops the watch`);
        }
    });

    test('the watch is bounded: still listening after a second, ended by itself well before a minute', () => {
        mountCard();
        openCardNamedByHash('payCard', 'payBody', 'payToggle');
        const [ro] = observers;
        mock.timers.tick(1000);
        assert.equal(ro.disconnected, false, 'growth still arriving ~a second in must still be followed');
        mock.timers.tick(59_000);
        assert.equal(ro.disconnected, true, 'a settled page is not watched for ever');
        assert.equal(winListeners.get('wheel')?.size ?? 0, 0, 'the gesture listeners go with it');
    });

    test('with no ResizeObserver it still makes one late correction', () => {
        delete g.ResizeObserver;
        const { card } = mountCard();
        openCardNamedByHash('payCard', 'payBody', 'payToggle');
        assert.equal(card.scrolls.length, 1);
        mock.timers.tick(400);
        assert.equal(card.scrolls.length, 2);
    });
});

describe('overlay.js still hands out the card functions', () => {
    test('its re-exports ARE card-collapse.js\'s, so every page that imports them from overlay.js is unchanged', async () => {
        const overlay = await import('./overlay.js');
        assert.equal(overlay.initCardCollapse, initCardCollapse);
        assert.equal(overlay.openCardNamedByHash, openCardNamedByHash);
    });
});
