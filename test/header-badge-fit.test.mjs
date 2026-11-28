// @ts-check
// @lane hygiene
/**
 * header-badge-fit.test.mjs — the sub-page header keeps the app's name whole (`fitHeaderBadge`, reached through
 * `wireHeaderLogo` in about-lightbox.js): where the name would be cut, the badge shows its emoji alone. Inter
 * arrives with `font-display: swap`, which changes the name's width without changing the header's box, so a
 * ResizeObserver never sees it — this drives a fake page whose name only overflows once the font has loaded,
 * and holds the re-measure to `document.fonts.ready` and `loadingdone`. A browser test cannot place the swap
 * reliably (the font is served from origin and usually loads before the first measure), so it is pinned here.
 * Part of test:hygiene.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// The minimum page the module needs at import time (overlay-history.js listens on window).
const g = /** @type {any} */ (globalThis);
g.window = globalThis;
g.addEventListener = () => {};
g.history = { state: null, pushState() {}, replaceState() {}, back() {} };
g.location = { href: '', hostname: 'test', search: '' };
g.HTMLElement = class {};
g.ResizeObserver = class { observe() {} };

/** A header whose name is 180 wide in a box 200 wide, until a test widens it. */
function fakePage() {
    /** @type {Set<string>} */ const classes = new Set();
    const name = { clientWidth: 200, scrollWidth: 180 };
    const header = Object.assign(new g.HTMLElement(), {
        dataset: {},
        classList: { add: (/** @type {string} */ c) => classes.add(c), remove: (/** @type {string} */ c) => classes.delete(c) },
        querySelector: (/** @type {string} */ sel) => (sel === 'h1' ? name : sel === '.badge-page' ? {} : null),
    });
    /** @type {Map<string, Function[]>} */ const listeners = new Map();
    /** @type {() => void} */ let resolveReady = () => {};
    /** @type {any} */ const fonts = {
        addEventListener: (/** @type {string} */ type, /** @type {Function} */ fn) => listeners.set(type, [...(listeners.get(type) ?? []), fn]),
    };
    fonts.ready = new Promise(r => { resolveReady = () => r(fonts); });
    g.document = {
        fonts,
        addEventListener() {},
        querySelector: (/** @type {string} */ sel) => (sel === '.app-header' ? header : null),
        getElementById: () => null,
    };
    return { classes, name, resolveReady, fire: (/** @type {string} */ t) => (listeners.get(t) ?? []).forEach(fn => fn()) };
}

const { wireHeaderLogo } = await import('../about-lightbox.js');
const tick = () => new Promise(r => setTimeout(r, 0));

/** @type {ReturnType<typeof fakePage>} */ let p;
beforeEach(() => { p = fakePage(); });

test('premise: measured against the fallback face, the name fits and the badge keeps its words', () => {
    wireHeaderLogo();
    assert.equal(p.classes.has('app-header--tight'), false);
});

test('the header is measured again once the fonts are ready — Inter swapped in, the name now cut', async () => {
    wireHeaderLogo();
    p.name.scrollWidth = 240;              // Inter is wider: the name would be cut, with no change to the header's box
    p.resolveReady();
    await tick();
    assert.equal(p.classes.has('app-header--tight'), true, 'the font swap was never measured: the name stays cut');
});

test('a font that finishes loading later is measured too', async () => {
    wireHeaderLogo();
    p.resolveReady();
    await tick();
    assert.equal(p.classes.has('app-header--tight'), false);
    p.name.scrollWidth = 240;
    p.fire('loadingdone');
    assert.equal(p.classes.has('app-header--tight'), true, 'a later font load was not measured');
    p.name.scrollWidth = 180;
    p.fire('loadingdone');
    assert.equal(p.classes.has('app-header--tight'), false, 'the badge did not get its words back once the name fitted');
});

test('a browser without document.fonts still measures once', () => {
    delete g.document.fonts;
    p.name.scrollWidth = 240;
    assert.doesNotThrow(() => wireHeaderLogo());
    assert.equal(p.classes.has('app-header--tight'), true);
});
