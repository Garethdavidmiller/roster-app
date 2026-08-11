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
