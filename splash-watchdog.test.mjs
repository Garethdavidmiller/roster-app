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
// splash-watchdog.js is a CLASSIC (non-module) IIFE — it cannot be imported. So this uses the same
// technique as sw-internals.test.mjs: read the source, slice the function out BY NAME, and evaluate
// that exact source in a sandbox. The assertions run against the file's REAL code, there is no
// duplicate copy to drift, and a rename makes the extraction throw rather than silently pass.
//
// Part of test:hygiene (no mocks).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(ROOT, 'splash-watchdog.js'), 'utf8');

/** Slice a top-level `function <name>(…) { … }` out of source by brace-matching.
 *  @param {string} src @param {string} name */
function extractFn(src, name) {
    const start = src.indexOf(`function ${name}(`);
    assert.ok(start >= 0, `splash-watchdog.js no longer defines function ${name}() — update this test`);
    let i = src.indexOf('{', start);
    for (let depth = 0; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) { i++; break; }
    }
    return src.slice(start, i);
}

/**
 * Build a fake `document` exposing only what `pageIsUsable` reads.
 * @param {{ lock?: boolean, banner?: 'visible'|'hidden'|'absent', display?: 'filled'|'empty'|'absent' }} state
 */
function fakeDocument({ lock = false, banner = 'absent', display = 'absent' } = {}) {
    /** @type {Record<string, any>} */
    const byId = {};
    if (lock) byId.calendarLock = { id: 'calendarLock' };
    if (banner !== 'absent') {
        byId.errorBanner = { classList: { contains: (/** @type {string} */ c) => banner === 'visible' && c === 'visible' } };
    }
    if (display !== 'absent') {
        byId.calendarDisplay = { firstElementChild: display === 'filled' ? { tag: 'div' } : null };
    }
    return { getElementById: (/** @type {string} */ id) => byId[id] || null };
}

/** The real source, evaluated with an injected `document`. @param {any} document */
function usableWith(document) {
    // eslint-disable-next-line no-new-func
    return new Function('document', `${extractFn(SRC, 'pageIsUsable')}\nreturn pageIsUsable();`)(document);
}

describe('pageIsUsable — what counts as a working page', () => {
    test('a rendered Calendar is usable', () => {
        assert.equal(usableWith(fakeDocument({ display: 'filled' })), true);
    });

    test('an unlock / sign-in card is usable — there is a next step on it', () => {
        // Both v20.12's PIN card and v20.79's member sign-in card carry this id. Neither is a happy
        // outcome, and both are a page the member can act on: reloading over them would be wrong.
        assert.equal(usableWith(fakeDocument({ lock: true })), true);
    });

    test('a VISIBLE error banner is usable — the app ran and is reporting', () => {
        // calendar-app.js's own catch. Reloading here would destroy the only message on screen.
        assert.equal(usableWith(fakeDocument({ banner: 'visible' })), true);
    });

    test('an error banner that is PRESENT but not visible is NOT usable', () => {
        // The banner is static markup in index.html — it exists on every load. Treating its mere
        // presence as a working page would disable the watchdog on every single launch, which is
        // the failure mode nobody would ever notice.
        assert.equal(usableWith(fakeDocument({ banner: 'hidden' })), false);
    });

    test('an EMPTY calendar container is NOT usable — this is the blank page (v20.80)', () => {
        // `#calendarDisplay` is static markup too, so existence proves nothing. The whole hole this
        // guard was opened for is a page that has all its containers and none of its content.
        assert.equal(usableWith(fakeDocument({ display: 'empty' })), false);
    });

    test('nothing at all is NOT usable', () => {
        assert.equal(usableWith(fakeDocument()), false);
    });

    test('the boot SKELETON does not count as usable', () => {
        // At 20s a skeleton is a load that failed, not one in progress — the bounds inside
        // `resolveAccess` cap the decision far below that. The check reads specific ids and never
        // asks "is anything on the page", which is what keeps this true without a rule for it.
        assert.equal(usableWith(fakeDocument({ display: 'empty' })), false);
    });
});

describe('the watchdog stands down on the RIGHT condition', () => {
    test('it no longer retires on the splash alone', () => {
        // The regression this file exists for, asserted against the source because the timing that
        // produces it cannot be reached in a unit test. Before v20.80 the guard was
        // `if (!splash || …|| splash.classList.contains('hidden')) return;` — a bare early return on
        // the splash. It must now be a conjunction with the page check.
        assert.ok(/pageIsUsable\(\)/.test(SRC), 'the watchdog no longer consults pageIsUsable()');
        assert.ok(/if \(!splashUp && pageIsUsable\(\)\) return;/.test(SRC),
            'the stand-down is not "splash gone AND something usable" — a splash-only guard is the ' +
            'exact condition that retired the watchdog at the moment the blank window opened');
    });

    test('the recovery panel can be built where the splash has already gone', () => {
        // The other half: the blank-page case has no splash left to overwrite, so `showRecovery`
        // has to create its own surface. Without this the new condition would detect the fault and
        // then have nowhere to report it.
        const fn = extractFn(SRC, 'showRecovery');
        assert.ok(/createElement\('div'\)/.test(fn), 'showRecovery cannot build a surface of its own');
        assert.ok(/position:fixed/.test(fn), 'the built surface is not full-screen — it would render into a broken layout');
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
    const SW = readFileSync(new URL('./service-worker.js', import.meta.url), 'utf8');
    const fn = extractFn(SRC, 'resetApp');

    test('the cache prefix still matches what the service worker names its caches', () => {
        const prefix = fn.match(/k\.indexOf\('([^']+)'\)\s*===\s*0/)?.[1];
        assert.ok(prefix, 'resetApp no longer filters caches by prefix — it is origin-wide again');
        // Both cache names the SW creates: the versioned app cache and the SDK cache.
        for (const decl of ['CACHE_NAME', 'SDK_CACHE_NAME']) {
            const name = SW.match(new RegExp('const ' + decl + '\\s*=\\s*`([^`$]*)'))?.[1];
            assert.ok(name, `${decl} not found in service-worker.js`);
            assert.ok(name.startsWith(prefix),
                `the SW names a cache "${name}…" which does not start with resetApp's "${prefix}" — ` +
                'the reset would leave it in place and appear to do nothing');
        }
    });

    // ── THE SW FILTER IS RUN, NOT READ ──────────────────────────────────────────────────────────
    // These three used to assert on the SOURCE — that it called `getRegistrations`, that it had a
    // `.filter(`, that it mentioned `r.scope`. Every one of them passed against the bug an external
    // review found: the filter asked whether a registration's scope was a PREFIX of our directory,
    // and a root-scoped worker belonging to a different app on the Pages origin is a prefix of
    // everything. So the reset unregistered it — which is precisely what the filter was added to
    // stop. A test that reads the code can only confirm the author's intention; it cannot see the
    // set that comes out. This one runs the real function over a real registration list.

    /** Run the real `resetApp` against a fake SW/cache world and report what it removed.
     *  @param {{path?: string, regs: {scope: string, script?: string|null, slot?: string}[]}} world */
    async function reset({ path = '/roster-app/index.html', regs }) {
        /** @type {string[]} */ const unregistered = [];
        const navigator = {
            serviceWorker: {
                getRegistrations: async () => regs.map(r => {
                    const worker = r.script === null ? null : { scriptURL: 'https://x.invalid' + (r.script ?? '/roster-app/service-worker.js') };
                    return {
                        scope: 'https://x.invalid' + r.scope,
                        active: (r.slot ?? 'active') === 'active' ? worker : null,
                        waiting: r.slot === 'waiting' ? worker : null,
                        installing: r.slot === 'installing' ? worker : null,
                        unregister: async () => { unregistered.push(r.scope + '@' + (r.script ?? '/roster-app/service-worker.js')); },
                    };
                }),
            },
        };
        const window = {}; // no `caches` — this block is about service workers only
        const location = { pathname: path, reload() {} };
        const sessionStorage = { removeItem() {} };
        // `resetApp` returns nothing — it is a fire-and-forget recovery that ends in a reload — so
        // the observable result is what it DID, read after the microtask queue has drained. The
        // internal 4-second reload timer is stubbed out; letting it run would prove nothing here
        // and is covered by its own reasoning in the module.
        new Function('navigator', 'window', 'location', 'sessionStorage', 'setTimeout',
            `${fn}\nresetApp();`
        )(navigator, window, location, sessionStorage, () => 0);
        for (let i = 0; i < 8; i++) await Promise.resolve();
        return unregistered;
    }

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

    test('the cache filter still fails towards doing LESS', () => {
        // Unlike the SW filter this one is a name prefix with no lifecycle to it, and the test
        // above already pins it against the SW's own constants. What is asserted here is only the
        // direction of its failure.
        assert.match(fn, /catch \(_e\) \{ return false; \}/,
            'an unparseable script URL must be skipped, not swept');
    });
});
