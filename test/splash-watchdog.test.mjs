// @ts-check
// splash-watchdog.test.mjs — the RECOVERY CONDITION inside splash-watchdog.js.
//
// ── WHY THIS FILE EXISTS AT ALL ─────────────────────────────────────────────────────────────────
//
// The watchdog is the app's last line: it fires when the ES-module graph never runs, which is
// precisely when nothing else can report a fault. It had no test, and until v20.80 that was
// tolerable because its condition was one line — "is the splash still up?".
//
// It is not one line any more, and the reason is a real hole rather than a refactor. `calendar-app.js`
// dismisses the splash at module-execution time (deliberately — a locked visitor must not be trapped
// behind a loading screen), while the ACCESS DECISION resolves later and asynchronously. So the page
// can reach a state the old condition called healthy — splash gone — while showing nothing at all.
// The watchdog retired at exactly the moment the risky window opened. MEASURED with the auth restore
// held at 3s: splash down at ~700ms, the unlock card at ~3.6s.
//
// The condition is now a judgement with four inputs, and every one of its failure modes is silent in
// the same direction: too strict and the watchdog reloads a healthy page out from under somebody
// mid-read; too loose and it goes back to watching nothing. Both are invisible without assertions.
//
// splash-watchdog.js is a CLASSIC (non-module) IIFE — it cannot be imported, and nothing inside it is
// reachable from outside. So every test here evaluates the WHOLE file, as `<script defer>` does,
// against a fake page, and judges what it DID: whether it stood down, reloaded or drew its panel, and
// what the panel's Reset button removed. Until 25 Nov 2026 `pageIsUsable` and `resetApp` were sliced
// out of the source by brace-matching and run on their own — a copy, which broke on any move of code
// and could not see how the file calls them.
//
// Part of test:hygiene (no mocks).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Tests live in test/ but address files from the repository root (moved 24 Nov 2026).
const REPO_ROOT_URL = new URL('../', import.meta.url);

const ROOT = fileURLToPath(REPO_ROOT_URL);
const SRC = readFileSync(join(ROOT, 'splash-watchdog.js'), 'utf8');

/**
 * Build a fake page with the splash already gone, holding exactly what `pageIsUsable` reads.
 * @param {{ lock?: boolean|string, snapshot?: boolean, skeleton?: boolean, banner?: 'visible'|'hidden'|'absent', display?: 'filled'|'empty'|'absent' }} state
 */
function fakeDocument({ lock = false, snapshot = false, skeleton = false, banner = 'absent', display = 'absent' } = {}) {
    /** @type {Record<string, any>} */
    const byId = {};
    // A lock card is `section.cal-lock` in the slot, whatever its id (`lock` names one; true is the sign-in card's).
    const lockCard = lock ? { id: typeof lock === 'string' ? lock : 'calendarLock', tagName: 'SECTION', className: 'cal-lock' } : null;
    if (lockCard) byId[lockCard.id] = lockCard;
    // The lock slot holds ONE card at a time (calendar-lock-slot.js): the stored roster or the boot
    // skeleton, by their real ids.
    if (snapshot) byId.calendarSnapshot = { id: 'calendarSnapshot' };
    if (skeleton) byId.calendarBooting = { id: 'calendarBooting' };
    if (banner !== 'absent') {
        byId.errorBanner = { classList: { contains: (/** @type {string} */ c) => banner === 'visible' && c === 'visible' } };
    }
    if (display !== 'absent') {
        byId.calendarDisplay = { firstElementChild: display === 'filled' ? { tag: 'div' } : null };
    }
    return {
        getElementById: (/** @type {string} */ id) => byId[id] || null,
        querySelector: (/** @type {string} */ sel) => (sel === 'section.cal-lock' ? lockCard : null),
    };
}

/**
 * Is a page with the splash gone, in this state, judged usable? The whole file runs against it and its
 * window ends: a usable page stands the watchdog down (no reload), anything else is a stuck launch,
 * which spends the session's one reload. @param {Parameters<typeof fakeDocument>[0]} state
 */
function usableWith(state) {
    const page = fakeDocument(state);
    /** @type {Function[]} */ const timers = [];
    let reloads = 0;
    runWatchdog({
        document: { ...page, visibilityState: 'visible', body: { contains: () => false, appendChild() {} },
                    createElement: el, addEventListener() {}, removeEventListener() {} },
        sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
        location: { reload: () => { reloads++; } },
        setTimeout: (/** @type {Function} */ fn) => timers.push(fn),
        clearTimeout() {},
    });
    assert.equal(timers.length, 1, 'the watchdog armed no window');
    /** @type {Function} */ (timers.pop())();
    return reloads === 0;
}

/**
 * Evaluate the whole of splash-watchdog.js with these as its globals — `navigator`, `window` and
 * `caches` included, so a Node global of the same name never answers for the page's.
 * @param {Record<string, any>} globals
 */
function runWatchdog(globals) {
    const g = { navigator: {}, window: {}, caches: undefined, ...globals };
    new Function(...Object.keys(g), SRC)(...Object.values(g));
}

// ── THE WHOLE FILE, RUN AS THE BROWSER RUNS IT (7 Nov 2026, iPhone audit) ───────────────────────
//
// The conditions are judged one page at a time below. What decides WHEN they are asked is
// the file's own top level — the timer, the visibility listener and the reload flag — and that is
// where the iPhone defect was: one 20s timer from load, so a page reloaded while hidden (as every
// Calendar update is) was judged stuck the moment somebody came back to it. So this evaluates the
// whole file, exactly as `<script defer>` does, against a fake page whose clock and visibility the
// test moves by hand. Nothing in the file is restated here.

const RELOAD_KEY = /var RELOAD_KEY = '([^']+)'/.exec(SRC)?.[1] ?? '';
const TIMEOUT_MS = Number(/var TIMEOUT_MS = (\d+);/.exec(SRC)?.[1]);

/** The element most recently given focus, across every fake page. @type {any} */
let lastFocused = null;

/** An element with the surface the watchdog touches, recording what it was given. @param {string} tag */
function el(tag) {
    /** @type {Set<string>} */ const classes = new Set();
    return {
        tag, id: '', textContent: '', type: '', disabled: false,
        /** @type {Record<string, string>} */ style: {},
        /** @type {Record<string, string>} */ attrs: {},
        /** @type {any[]} */ children: [],
        classList: { add: (/** @type {string} */ c) => classes.add(c), remove: (/** @type {string} */ c) => classes.delete(c), contains: (/** @type {string} */ c) => classes.has(c) },
        get firstChild() { return this.children[0] ?? null; },
        get firstElementChild() { return this.children[0] ?? null; },
        setAttribute(/** @type {string} */ k, /** @type {string} */ v) { this.attrs[k] = String(v); },
        appendChild(/** @type {any} */ c) { this.children.push(c); return c; },
        removeChild(/** @type {any} */ c) { this.children = this.children.filter(x => x !== c); return c; },
        /** @type {Record<string, Function[]>} */ listeners: {},
        addEventListener(/** @type {string} */ t, /** @type {Function} */ f) { (this.listeners[t] ||= []).push(f); },
        /** A press: every click listener the file added, run in order. */
        click() { for (const f of this.listeners.click ?? []) f(); },
        focus() { lastFocused = this; },
    };
}

/** Every element at or under `node`. @param {any} node @returns {any[]} */
const allUnder = (node) => [node, ...node.children.flatMap(allUnder)];

/** Every piece of text under an element. @param {any} node @returns {string} */
const textUnder = (node) => [node.textContent, ...node.children.map(textUnder)].join(' ');

/**
 * Load splash-watchdog.js into a fake Calendar and hand back the controls of its world.
 *
 * `page` is what is on screen when a window ends: `stuck` (the splash still up over nothing),
 * `blank` (splash gone, nothing rendered), `usable-under-splash` (rendered, splash never came down)
 * or `healthy` (splash gone, Calendar drawn). `store` is the tab's sessionStorage — pass the same Map
 * to two launches and they are a reload in one tab.
 * `world` is what the Reset button meets: the page's address, the service worker registrations and
 * Cache Storage (`navigator`, `location.pathname`, `window.caches`).
 * @param {{ hidden?: boolean, page?: 'stuck'|'blank'|'usable-under-splash'|'healthy', store?: Map<string, string>,
 *           world?: { navigator?: any, caches?: any, path?: string } }} [o]
 */
function launch({ hidden = false, page = 'stuck', store = new Map(), world = {} } = {}) {
    let state = page;
    let reloads = 0;
    /** @type {{ fn: Function, ms: number, live: boolean }[]} */ const timers = [];
    /** @type {Function[]} */ let onVis = [];
    const splash = el('div'); splash.id = 'splash';
    const display = el('div'); display.id = 'calendarDisplay';
    /** @type {any[]} */ const built = [];   // a surface the panel had to build, the splash being gone
    const splashUp = () => state === 'stuck' || state === 'usable-under-splash';
    const document = {
        visibilityState: hidden ? 'hidden' : 'visible',
        body: { contains: (/** @type {any} */ e) => e === splash && splashUp(), appendChild: (/** @type {any} */ e) => { built.push(e); } },
        getElementById(/** @type {string} */ id) {
            if (id === 'splash') return splashUp() ? splash : null;
            if (id === 'calendarDisplay') {
                display.children = (state === 'healthy' || state === 'usable-under-splash') ? [el('div')] : [];
                return display;
            }
            return null;
        },
        querySelector: () => null,
        createElement: el,
        addEventListener(/** @type {string} */ t, /** @type {Function} */ f) { if (t === 'visibilitychange') onVis.push(f); },
        removeEventListener(/** @type {string} */ t, /** @type {Function} */ f) { if (t === 'visibilitychange') onVis = onVis.filter(x => x !== f); },
    };
    const sessionStorage = {
        getItem: (/** @type {string} */ k) => (store.has(k) ? store.get(k) : null),
        setItem: (/** @type {string} */ k, /** @type {string} */ v) => { store.set(k, String(v)); },
        removeItem: (/** @type {string} */ k) => { store.delete(k); },
    };
    const location = { pathname: world.path ?? '/roster-app/index.html', reload: () => { reloads++; } };
    const setTimeout = (/** @type {Function} */ fn, /** @type {number} */ ms) => { timers.push({ fn, ms, live: true }); return timers.length; };
    const clearTimeout = (/** @type {number} */ id) => { if (timers[id - 1]) timers[id - 1].live = false; };
    runWatchdog({ document, sessionStorage, location, setTimeout, clearTimeout,
        navigator: world.navigator ?? {}, window: world.caches ? { caches: world.caches } : {}, caches: world.caches });
    const live = () => timers.filter(t => t.live);
    return {
        store,
        reloads: () => reloads,
        /** The recovery panel is up: a splash surface, re-roled and carrying its title. */
        panel: () => [splash, ...built].some(s => s.attrs.role === 'alertdialog' && /couldn.t finish loading/.test(textUnder(s))),
        /** The surface the panel was drawn on, or null. */
        panelEl: () => [splash, ...built].find(s => s.attrs.role === 'alertdialog') ?? null,
        /** The surfaces the panel had to build, the splash being gone. */
        built: () => built,
        /** The delays of the windows still running. */
        pending: () => live().map(t => t.ms),
        /** Every window ever started, ended or not. */
        armed: () => timers.length,
        /** End the running window now — the timer firing. */
        fire() {
            const t = live().pop();
            assert.ok(t, 'no window is running — the watchdog armed nothing');
            t.live = false;
            t.fn();
        },
        /** The member switches away (`away`) or comes back (`back`); `silently` moves no event. */
        look(/** @type {'away'|'back'} */ dir, { silently = false } = {}) {
            document.visibilityState = dir === 'away' ? 'hidden' : 'visible';
            if (!silently) for (const f of [...onVis]) f();
        },
        /** What the Calendar has drawn by now. @param {typeof page} s */
        setPage(s) { state = s; },
    };
}

describe('pageIsUsable — what counts as a working page', () => {
    test('a rendered Calendar is usable', () => {
        assert.equal(usableWith({ display: 'filled' }), true);
    });

    test('an unlock / sign-in card is usable — there is a next step on it', () => {
        // Both v20.12's PIN card and v20.79's member sign-in card carry this id. Neither is a happy
        // outcome, and both are a page the member can act on: reloading over them would be wrong.
        assert.equal(usableWith({ lock: true }), true);
        // …and the card saying the sign-in form could not load, whose id is its own (whole-app review, 24 Nov 2026):
        // an id list missed it, so a working card was reloaded and then covered by the recovery panel.
        assert.equal(usableWith({ lock: 'calendarSignInUnavailable' }), true, 'the sign-in-unavailable card');
    });

    test("the member's own stored roster is usable — it is their shifts, labelled", () => {
        // `calendarSnapshot`, painted before the access decision (CALENDAR_DATA.md 17). Not counting
        // it meant a stored roster still up at 20s was reloaded once and then covered by the
        // recovery panel — the watchdog took away the one thing on screen worth having.
        assert.equal(usableWith({ snapshot: true }), true);
        assert.equal(usableWith({ snapshot: true, display: 'empty' }), true,
            'the empty live container beside it must not outvote it');
    });

    test('a VISIBLE error banner is usable — the app ran and is reporting', () => {
        // calendar-app.js's own catch. Reloading here would destroy the only message on screen.
        assert.equal(usableWith({ banner: 'visible' }), true);
    });

    test('an error banner that is PRESENT but not visible is NOT usable', () => {
        // The banner is static markup in index.html — it exists on every load. Treating its mere
        // presence as a working page would disable the watchdog on every single launch, which is
        // the failure mode nobody would ever notice.
        assert.equal(usableWith({ banner: 'hidden' }), false);
    });

    test('an EMPTY calendar container is NOT usable — this is the blank page (v20.80)', () => {
        // `#calendarDisplay` is static markup too, so existence proves nothing. The whole hole this
        // guard was opened for is a page that has all its containers and none of its content.
        assert.equal(usableWith({ display: 'empty' }), false);
    });

    test('nothing at all is NOT usable', () => {
        assert.equal(usableWith({}), false);
    });

    test('the boot SKELETON does not count as usable', () => {
        // At 20s a skeleton is a load that failed, not one in progress — the bounds inside
        // `resolveAccess` cap the decision far below that. The check reads specific ids and never
        // asks "is anything on the page", which is what keeps this true without a rule for it.
        assert.equal(usableWith({ skeleton: true, display: 'empty' }), false);
    });
});

describe('the watchdog stands down on the RIGHT condition', () => {
    test('it no longer retires on the splash alone', () => {
        // The regression this file exists for. Before v20.80 the guard was
        // `if (!splash || …|| splash.classList.contains('hidden')) return;` — a bare early return on
        // the splash. It must now be a conjunction with the page check. The stand-down became a call
        // at 7 Nov 2026 (it clears the reload flag, below), so the shape read here moved with it;
        // the two cases after this one RUN the file, which this regex never could.
        assert.ok(/pageIsUsable\(\)/.test(SRC), 'the watchdog no longer consults pageIsUsable()');
        assert.ok(/if \(!splashUp && pageIsUsable\(\)\) \{ standDown\(\); return; \}/.test(SRC),
            'the stand-down is not "splash gone AND something usable" — a splash-only guard is the ' +
            'exact condition that retired the watchdog at the moment the blank window opened');
    });

    test('a splash that has gone over a BLANK page is still judged stuck — run, not read', () => {
        const w = launch({ page: 'blank' });
        w.fire();
        assert.equal(w.reloads(), 1, 'the blank window after the splash is the hole v20.80 closed');
    });

    test('and a usable page under a splash that never came down is stuck too', () => {
        const w = launch({ page: 'usable-under-splash' });
        w.fire();
        assert.equal(w.reloads(), 1, 'a splash still up hides whatever is underneath it');
    });

    test('the recovery panel is built where the splash has already gone — run, not read', () => {
        const store = new Map([[RELOAD_KEY, '1']]);   // this launch's reload already spent
        const w = launch({ page: 'blank', store });
        w.fire();
        assert.equal(w.panel(), true, 'the blank page detected the fault and then had nowhere to say so');
    });

    test('the panel is an alertdialog a screen reader can NAME, and focus moves into it', () => {
        // The role was switched on an element that had been on the page all along, with no name and
        // no focus move — the case least likely to be announced, at the one moment the app has
        // nothing else to offer. Both surfaces: the splash reused, and one built where it had gone.
        for (const page of /** @type {const} */ (['stuck', 'blank'])) {
            const w = launch({ page, store: new Map([[RELOAD_KEY, '1']]) });   // its one reload spent
            lastFocused = null;
            w.fire();
            const dlg = w.panelEl();
            assert.ok(dlg, `${page}: no recovery panel`);
            const byId = (/** @type {string} */ id) => allUnder(dlg).find(n => n.id === id);
            assert.match(textUnder(byId(dlg.attrs['aria-labelledby']) ?? el('none')), /couldn.t finish loading/,
                `${page}: the dialog is not named from its title`);
            assert.match(textUnder(byId(dlg.attrs['aria-describedby']) ?? el('none')), /took too long/,
                `${page}: the dialog is not described by its explanation`);
            assert.equal(dlg.attrs['aria-modal'], 'true');
            assert.equal(lastFocused?.textContent, 'Reload', `${page}: focus did not move to the dialog's first action`);
            assert.ok(allUnder(dlg).includes(lastFocused), `${page}: the focused control is not inside the dialog`);
        }
    });

    test('the recovery panel can be built where the splash has already gone', () => {
        // The other half: the blank-page case has no splash left to overwrite, so `showRecovery`
        // has to create its own surface. Without this the new condition would detect the fault and
        // then have nowhere to report it — and the surface must cover the screen, because what is
        // under it is a layout that did not finish.
        const w = launch({ page: 'blank', store: new Map([[RELOAD_KEY, '1']]) });
        w.fire();
        const [surface] = w.built();
        assert.ok(surface, 'showRecovery built no surface of its own');
        assert.equal(w.panelEl(), surface, 'the panel was not drawn on the surface it built');
        assert.match(surface.style.cssText ?? '', /position:fixed;inset:0/,
            'the built surface is not full-screen — it would render into a broken layout');
    });
});

// ── A WINDOW IS 20 SECONDS OF THE PAGE BEING SEEN (7 Nov 2026, iPhone audit) ─────────────────────
//
// The Calendar takes its splash down in a requestAnimationFrame, and a hidden page runs none — so a
// page reloaded while hidden (every Calendar update is, on purpose) cannot look healthy until it is
// looked at. Judged on a timer from load, a member coming back more than 20s later met a reload they
// had not asked for, or, with the tab's one reload already spent, a flash of "couldn't finish
// loading" over a page that was fine. Both directions are asserted: a hidden page is never judged,
// and a page stuck in plain view still gets its one reload and then the panel.
describe('the watch — only a page that has been SEEN for a whole window is judged stuck', () => {
    test('guard the guard — the file arms one window of the length it declares', () => {
        assert.ok(RELOAD_KEY && TIMEOUT_MS >= 10_000, 'the reload key or the window length was not read from the file');
        assert.deepEqual(launch().pending(), [TIMEOUT_MS]);
    });

    test('a page HIDDEN when its window ends is not judged — no reload, no panel, no flag', () => {
        const w = launch({ page: 'stuck' });
        w.look('away');
        w.fire();
        assert.equal(w.reloads(), 0, 'reloaded a page nobody could see, and so could not have finished');
        assert.equal(w.panel(), false);
        assert.equal(w.store.has(RELOAD_KEY), false, 'a reload was spent on a page that was never judged');
        assert.deepEqual(w.pending(), [], 'and nothing is timed while nobody is looking');
    });

    test('a page hidden with NO event at all is still not judged — the state is read when the window ends', () => {
        // The listener is not the only witness: a window that ends on a hidden page is not judged
        // whether or not anything announced the look away.
        const w = launch({ page: 'stuck' });
        w.look('away', { silently: true });
        w.fire();
        assert.equal(w.reloads(), 0, 'reloaded a hidden page because no visibilitychange had said so');
        assert.equal(w.panel(), false);
    });

    test('looking again starts a FRESH window from that moment, and a page still stuck at its end is judged', () => {
        const w = launch({ page: 'stuck' });
        w.look('away');
        w.fire();
        w.look('back');
        assert.deepEqual(w.pending(), [TIMEOUT_MS], 'the window runs from the return, not from load');
        w.fire();
        assert.equal(w.reloads(), 1, 'a page stuck in plain view after its fresh window is still recovered');
    });

    test('an update that reloaded the page WHILE HIDDEN is found healthy once it is looked at', () => {
        // The reported case: `reloadWhileHidden` loads the Calendar out of sight, its splash cannot
        // come down until a frame runs, and the member returns minutes later.
        const w = launch({ page: 'stuck', hidden: true });
        w.fire();                       // the window ends with the splash still up — no frame has run
        assert.equal(w.reloads(), 0);
        w.setPage('healthy');           // the first frame after the return takes the splash down
        w.look('back');
        w.fire();
        assert.equal(w.reloads(), 0, 'a healthy page was reloaded out from under the member');
        assert.equal(w.panel(), false, 'the recovery panel flashed over a page that was fine');
        assert.deepEqual(w.pending(), [], 'and the watch has stood down');
    });

    test('a look away DURING the window, back before its end, restarts the window from the return', () => {
        const w = launch({ page: 'stuck' });
        w.look('away');
        w.look('back');
        assert.equal(w.armed(), 2, 'the return did not start a window of its own');
        assert.deepEqual(w.pending(), [TIMEOUT_MS], 'and the window from load was not left running beside it');
    });

    test('a window that ends in view after a look away with no event for the return still starts again', () => {
        // A frozen page resumed: its overdue timer can run before the queued visibilitychange does,
        // with the state already reading visible. It was hidden during the window, so it is not judged.
        const w = launch({ page: 'stuck' });
        w.look('away');
        w.look('back', { silently: true });
        w.fire();
        assert.equal(w.reloads(), 0, 'judged a window the page spent partly out of sight');
        assert.deepEqual(w.pending(), [TIMEOUT_MS], 'a fresh window runs from now instead');
    });

    test('a healthy check gives the reload back — one reload per STUCK launch, not one per tab', () => {
        const store = new Map([[RELOAD_KEY, '1']]);   // an earlier stuck launch in this tab spent it
        const healthy = launch({ page: 'healthy', store });
        healthy.fire();
        assert.equal(store.has(RELOAD_KEY), false, 'the flag outlived a healthy load, so the next stuck launch gets no reload');
        assert.deepEqual(healthy.pending(), [], 'and the watch stands down');
        const next = launch({ page: 'stuck', store });   // a later launch in the same tab, stuck
        next.fire();
        assert.equal(next.reloads(), 1, 'the later stuck launch was sent straight to the panel');
    });

    test('a healthy page is taken as healthy while hidden too — only the STUCK verdict waits', () => {
        const store = new Map([[RELOAD_KEY, '1']]);
        const w = launch({ page: 'healthy', hidden: true, store });
        w.fire();
        assert.equal(store.has(RELOAD_KEY), false);
        assert.deepEqual(w.pending(), [], 'a healthy page waited for a look it did not need');
    });

    test('a page stuck in plain view gets exactly ONE reload, and then the panel', () => {
        const store = new Map();
        const first = launch({ page: 'stuck', store });
        first.fire();
        assert.equal(first.reloads(), 1);
        assert.equal(first.panel(), false, 'the panel came before the reload that might have fixed it');
        assert.deepEqual(first.pending(), []);
        const second = launch({ page: 'stuck', store });   // the reload came back stuck
        second.fire();
        assert.equal(second.reloads(), 0, 'a second automatic reload — the loop the flag exists to stop');
        assert.equal(second.panel(), true, 'a launch still stuck after its reload was left with no way out');
    });
});

// ── THE RESET'S BLAST RADIUS (v21.86) ───────────────────────────────────────────────────────────
//
// "Reset app" used to unregister EVERY service worker registration on the origin and delete EVERY
// Cache Storage entry. On a dedicated origin that is merely blunt. The GitHub Pages mirror is not
// one — `garethdavidmiller.github.io` can host any number of other pages — so a member tapping
// Reset there would take out an unrelated app's offline data, with no warning and no way back.
//
// The scoping introduces a DRIFT RISK that nothing else in the repo can see: the cache filter is a
// string prefix, and the caches it must match are named in service-worker.js. Rename them and Reset
// silently stops clearing anything, which presents as "the reset button does nothing" on precisely
// the broken device that needed it.
describe('Reset app clears THIS app, and still clears it', () => {
    const SW = readFileSync(new URL('./service-worker.js', REPO_ROOT_URL), 'utf8');

    /**
     * A stuck launch whose one reload is spent, so the recovery panel is up; then its Reset button,
     * pressed. Reports which registrations were unregistered and which caches deleted, read after the
     * microtask queue has drained — the reset returns nothing, it ends in a reload. Its 4-second
     * fallback reload is only queued on the fake clock, never run.
     * @param {{ path?: string, regs?: {scope: string, script?: string|null, slot?: string, url?: string}[], cacheNames?: string[] }} world
     */
    async function pressReset({ path = '/roster-app/index.html', regs = [], cacheNames }) {
        /** @type {string[]} */ const unregistered = [];
        /** @type {string[]} */ const deleted = [];
        const navigator = {
            serviceWorker: {
                getRegistrations: async () => regs.map(r => {
                    const scriptURL = r.url ?? 'https://x.invalid' + (r.script ?? '/roster-app/service-worker.js');
                    const worker = r.script === null ? null : { scriptURL };
                    return {
                        scope: 'https://x.invalid' + r.scope,
                        active: (r.slot ?? 'active') === 'active' ? worker : null,
                        waiting: r.slot === 'waiting' ? worker : null,
                        installing: r.slot === 'installing' ? worker : null,
                        unregister: async () => { unregistered.push(r.scope + '@' + (r.url ?? r.script ?? '/roster-app/service-worker.js')); },
                    };
                }),
            },
        };
        const caches = cacheNames && { keys: async () => [...cacheNames], delete: async (/** @type {string} */ k) => { deleted.push(k); return true; } };
        const w = launch({ page: 'stuck', store: new Map([[RELOAD_KEY, '1']]), world: { navigator, caches, path } });
        w.fire();
        const button = allUnder(w.panelEl() ?? el('none')).find(n => /^Still stuck\?/.test(n.textContent));
        assert.ok(button, 'the recovery panel has no Reset button');
        button.click();
        for (let i = 0; i < 8; i++) await Promise.resolve();
        return { unregistered, deleted, reloads: w.reloads() };
    }
    /** @param {Parameters<typeof pressReset>[0]} world */
    const reset = async (world) => (await pressReset(world)).unregistered;

    test('the caches it clears are the ones the service worker names, and no one else\'s', async () => {
        // Both cache names the SW creates: the versioned app cache and the SDK cache, each read off the
        // SW's own declaration with an example version on the end.
        const ours = ['CACHE_NAME', 'SDK_CACHE_NAME'].map(decl => {
            const name = SW.match(new RegExp('const ' + decl + '\\s*=\\s*`([^`$]*)'))?.[1];
            assert.ok(name, `${decl} not found in service-worker.js`);
            return name + '1.0';
        });
        const theirs = ['other-app-v3', 'workbox-precache-v2', 'roster-myb-v1'];
        const { deleted, reloads } = await pressReset({ cacheNames: [...theirs, ...ours] });
        assert.deepEqual(deleted, ours,
            'the reset leaves a cache the SW names in place and appears to do nothing, or takes another app\'s');
        assert.equal(reloads, 1, 'the reset ends in exactly one reload');
    });

    // ── THE SW FILTER IS RUN, NOT READ ──────────────────────────────────────────────────────────
    // These three used to assert on the SOURCE — that it called `getRegistrations`, that it had a
    // `.filter(`, that it mentioned `r.scope`. Every one of them passed against the bug an external
    // review found: the filter asked whether a registration's scope was a PREFIX of our directory,
    // and a root-scoped worker belonging to a different app on the Pages origin is a prefix of
    // everything. So the reset unregistered it — which is precisely what the filter was added to
    // stop. A test that reads the code can only confirm the author's intention; it cannot see the
    // set that comes out. This one runs the real function over a real registration list.

    test('another app\'s ROOT-scoped worker survives — the case a scope prefix could not see', async () => {
        // `/` is a prefix of `/roster-app/` by definition, so the old rule swept it. On the Pages
        // mirror that is somebody else's offline data, deleted with no warning and no way back.
        const gone = await reset({ regs: [
            { scope: '/', script: '/sw.js' },
            { scope: '/roster-app/', script: '/roster-app/service-worker.js' },
        ]});
        assert.deepEqual(gone, ['/roster-app/@/roster-app/service-worker.js'],
            "only this app's own worker may be unregistered");
    });

    test('and OUR worker is still removed — a filter that removes nothing is not a fix', async () => {
        const gone = await reset({ regs: [{ scope: '/roster-app/', script: '/roster-app/service-worker.js' }] });
        assert.equal(gone.length, 1);
    });

    test('it is found wherever it sits in the lifecycle', async () => {
        // A registration mid-update has its new worker in `waiting` or `installing` and nothing in
        // `active`. Consulting only `active` would leave the broken registration in place on the
        // one page state most likely to have prompted the reset.
        for (const slot of ['active', 'waiting', 'installing']) {
            const gone = await reset({ regs: [{ scope: '/roster-app/', slot }] });
            assert.equal(gone.length, 1, `a ${slot} worker was not recognised as ours`);
        }
    });

    test('a registration with no worker at all is left alone', async () => {
        // Nothing identifies it, and the filter fails towards doing LESS — the right way round for
        // a destructive action. The cost is a reset that occasionally under-clears; the alternative
        // is deleting somebody else's data.
        const gone = await reset({ regs: [{ scope: '/roster-app/', script: null }] });
        assert.deepEqual(gone, []);
    });

    test('a sibling app in a NEIGHBOURING directory is untouched', async () => {
        const gone = await reset({ regs: [
            { scope: '/other-app/', script: '/other-app/service-worker.js' },
            { scope: '/roster-app-two/', script: '/roster-app-two/service-worker.js' },
        ]});
        assert.deepEqual(gone, []);
    });

    test('a worker whose script address cannot be read is skipped, not swept', async () => {
        // The direction of the filter's failure: what cannot be identified is left alone.
        const gone = await reset({ regs: [{ scope: '/roster-app/', url: 'not a url' }] });
        assert.deepEqual(gone, [], 'an unparseable script URL must be skipped, not swept');
    });
});
