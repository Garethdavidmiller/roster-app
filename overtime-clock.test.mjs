/**
 * overtime-clock.test.mjs — WHAT THE EXTRACTION PUT AT RISK.
 * Run with: node --test overtime-clock.test.mjs
 *
 * ── WHY THIS FILE IS SHORT, AND DELIBERATELY NOT A SECOND CLOCK SUITE ───────────────────────────
 *
 * These six functions did not arrive with this module. They were exercised before the split and are
 * exercised after it, by `overtime-format.test.mjs` (the clock block) and `overtime-parity.test.mjs`
 * (the `canRestoreNow` server twin), both of which still pass untouched — which is the whole point
 * of the re-export. Restating those cases here would not add a guard; it would add a second copy of
 * one, and this repo has learned twice what two copies of a rule do to each other.
 *
 * What DID arrive with the split is three structural claims the module header makes, none of which
 * any existing test can see, and each of which fails silently:
 *
 *   1. THE RE-EXPORT IS COMPLETE AND IDENTICAL. Eight modules import these names from
 *      `overtime-format.js`. If the re-export drops one, that is a build error somebody meets
 *      immediately — but if it were ever "tidied" into a re-DECLARATION, every import would still
 *      resolve, every consumer would still run, and two clocks would exist with nothing to say so.
 *      Identity is the assertion, not presence.
 *   2. THIS MODULE IMPORTS NOTHING. That is what lets a deadline decision be tested at the minute
 *      either side of noon with no fixtures and no DOM — and it is exactly the property that decays
 *      the first time somebody needs a date helper in here.
 *   3. THE GRACE BAND NEVER ANSWERS `closed`. The single most consequential branch in the feature:
 *      inside it the client must hand the decision to the server, because the alternative is a
 *      Submit button that quietly is not there for a member who was in time. Pinned at its two
 *      boundaries, which is where an off-by-one lives.
 *
 * Boundary cases use the grace constant rather than a hardcoded 15 minutes, so re-budgeting the
 * band moves the cases instead of breaking them.
 *
 * Teeth-verified by four mutations; recorded beside the cases they belong to.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as clock from './overtime-clock.js';
import * as format from './overtime-format.js';

const { SUBMIT_GRACE_MS, submitDisposition, canRestoreNow } = clock;

/** The six names the split moved. Written out, because deriving them from the module under test
 *  would make the re-export contract below assert that a thing equals itself. */
const MOVED = [
    'SUBMIT_GRACE_MS', 'DEADLINE_SYNC_WINDOW_MS', 'clockOffset',
    'submitDisposition', 'shouldResyncClock', 'canRestoreNow',
];

describe('the re-export is complete and identical', () => {
    test('every moved name is still reachable from overtime-format.js', () => {
        // Eight modules and two suites import from there. This is the contract that lets the split
        // be invisible to all of them.
        const missing = MOVED.filter(n => !(n in format));
        assert.deepEqual(missing, [], `overtime-format.js no longer re-exports: ${missing.join(', ')}`);
    });

    test('they are the SAME objects, not a second declaration', () => {
        // Teeth: replacing the `export { … } from './overtime-clock.js'` line with local copies
        // leaves every import resolving and every consumer running. Only identity can see it.
        for (const n of MOVED) {
            assert.equal(format[n], clock[n],
                `${n} differs between overtime-format.js and overtime-clock.js — the re-export has ` +
                'become a re-declaration, and there are now two clocks');
        }
    });
});

describe('the module stays loadable with no fixtures', () => {
    test('overtime-clock.js imports nothing', () => {
        // Its header's rule 3. Arithmetic over numbers is what lets the boundary cases below exist
        // at all; the first `import` here is the release that ends that, and it will look harmless.
        const src = readFileSync(new URL('./overtime-clock.js', import.meta.url), 'utf8');
        const imports = src.split('\n').filter(l => /^\s*import\b/.test(l));
        assert.deepEqual(imports, [],
            'overtime-clock.js has taken a dependency:\n  ' + imports.join('\n  '));
    });
});

describe('the grace band never answers closed', () => {
    const DEADLINE = Date.UTC(2026, 7, 18, 11, 0, 0);   // a noon London deadline in August

    test('before the deadline the control is simply open', () => {
        assert.equal(submitDisposition(DEADLINE - 1, DEADLINE), 'open');
    });

    test('AT the deadline, and one ms inside the band, it asks the server', () => {
        // Teeth: `<=` in the first comparison makes the deadline instant itself read as `open`,
        // and the whole band still behaves — only this assertion fails.
        assert.equal(submitDisposition(DEADLINE, DEADLINE), 'check-with-server');
        assert.equal(submitDisposition(DEADLINE + 1, DEADLINE), 'check-with-server');
    });

    test('the LAST millisecond of the band still asks the server', () => {
        // The off-by-one that matters. A member on a phone whose clock is fourteen minutes fast is
        // inside the band and in time; answering `closed` here removes their control with no error.
        assert.equal(submitDisposition(DEADLINE + SUBMIT_GRACE_MS - 1, DEADLINE), 'check-with-server');
    });

    test('past the band it closes — the grace is a budget, not an amnesty', () => {
        // Without this the case above passes on a function that never closes at all.
        assert.equal(submitDisposition(DEADLINE + SUBMIT_GRACE_MS, DEADLINE), 'closed');
        assert.equal(submitDisposition(DEADLINE + SUBMIT_GRACE_MS + 60_000, DEADLINE), 'closed');
    });

    test('no instant in the band is ever reported closed', () => {
        // Swept rather than spot-checked: the property is what matters and three hand-picked
        // instants can be right by luck.
        for (let ms = 0; ms < SUBMIT_GRACE_MS; ms += 30_000) {
            assert.notEqual(submitDisposition(DEADLINE + ms, DEADLINE), 'closed',
                `+${ms}ms into the grace band must defer to the server, never refuse`);
        }
    });
});

describe('an unknown restore deadline offers the button', () => {
    // The one branch that runs OPPOSITE to its server twin, on purpose: a wrong refusal here puts a
    // sentence on screen explaining a rule that may not apply, and a false explanation is believed
    // in a way a refused tap is not. Its behavioural parity with the server is held next door by
    // overtime-parity.test.mjs; what is pinned here is that the unknown case stayed generous
    // through the move.
    const DEADLINE = Date.UTC(2026, 7, 18, 11, 0, 0);

    test('an unreadable deadline or clock defers to the endpoint', () => {
        for (const bad of [NaN, undefined, null, 'noon']) {
            assert.equal(canRestoreNow(/** @type {any} */ (bad), DEADLINE - 1, DEADLINE + 1), true);
            assert.equal(canRestoreNow(DEADLINE, DEADLINE - 1, /** @type {any} */ (bad)), true);
        }
    });

    test('an unreadable withdrawal stamp AFTER the deadline refuses', () => {
        // The asymmetry is the point — unknown-deadline is generous, unknown-stamp is not — so the
        // generous case above cannot be passing on a function that simply returns true.
        assert.equal(canRestoreNow(DEADLINE, /** @type {any} */ (NaN), DEADLINE + 1), false);
    });
});
