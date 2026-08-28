// @ts-nocheck
/**
 * typecheck-scope.test.mjs — what `npm run typecheck` actually covers, and what it does not.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────────
 *
 * `jsconfig.json` excludes `service-worker.js` and the whole of `functions/`. That is a decision,
 * not an oversight — but nothing said so, and CLAUDE.md's "tsc --noEmit already runs over every
 * `// @ts-check` file" is a true sentence that leaves a reader believing the code is type-checked.
 * 7,300 lines are not, including every Cloud Function and the file KNOWN_LIMITATIONS calls the
 * highest-outage-risk one.
 *
 * ── THE MEASUREMENTS BEHIND LEAVING IT THAT WAY (28 Aug 2026) ───────────────────────────────────
 *
 * Taken by running the checker over each exclusion, rather than estimated:
 *
 * · `functions/` — **447 diagnostics.** The category most likely to be a real defect,
 *   "possibly undefined", was read through: every one sampled was a false positive the checker
 *   cannot narrow (`rosterOrder` guarded by `Number.isInteger` on the line above;
 *   `parts.find(p => p.type === 'year')`, which `Intl.DateTimeFormat` always returns). The rest is
 *   `@param {object}` imprecision and third-party noise from firebase-admin's own dependency types.
 *
 * · `service-worker.js` — **105 diagnostics**, and the standard cheap fix does NOT work: adding a
 *   `webworker` lib reference and a typed `self` alias leaves the count unchanged at 105, because
 *   the errors live in the listener callbacks (`event.request` and `event.waitUntil` on a bare
 *   `Event`, plus 34 implicit-any parameters). It needs ~40 hand annotations in the riskiest file
 *   in the app.
 *
 * · And the hazard a type system would guard is **already guarded better**. The real risk in
 *   `functions/` is the ESM↔CommonJS duplication — `normaliseSurname`, `nameToEmail`,
 *   `isPayCutoffDay`, `deriveHistory` — and those are pinned by parity tests comparing BEHAVIOUR
 *   across the boundary. A drifted implementation with identical signatures passes tsc and fails
 *   those. The SW's own defects have all been lifecycle bugs (precache in `install`, the
 *   double-reload on first claim, `caches.match` preferring the oldest cache); none is a type error.
 *
 * ── WHAT THIS TEST IS FOR ───────────────────────────────────────────────────────────────────────
 *
 * Not to argue the decision — to stop the gap GROWING without one. Adding a ninth `functions/`
 * module or a second worker is free today and silent. This makes it a choice somebody makes.
 *
 * REVISIT when a defect is ever traced to a shape error in either exclusion. That is the same
 * trigger the build-step row uses, and for the same reason: a cost that has never been paid is not
 * evidence, and one that has been is.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const read = (/** @type {string} */ p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const jsconfig = JSON.parse(read('./jsconfig.json'));
const exclude = new Set(jsconfig.exclude);

describe('the type-checker’s scope is a decision, not a drift', () => {

    test('the two deliberate exclusions are still exactly those two', () => {
        // Named individually so ADDING one is a visible edit here, with this file's header to read
        // first. Removing one is equally visible — and is the good outcome.
        assert.ok(exclude.has('service-worker.js'),
            'service-worker.js left the exclude list — if that is deliberate, delete this assertion '
            + 'and the header note with it; if it is not, `npm run typecheck` now reports ~105 errors');
        assert.ok(exclude.has('functions'),
            'functions/ left the exclude list — see this file\'s header for what turning it on costs');
    });

    test('nothing in an excluded area CLAIMS to be checked', () => {
        // The dangerous half-state: a file carrying `// @ts-check` inside an excluded directory
        // reads as covered to anyone opening it, and is not. Today none of them does, which is why
        // the exclusion is honest rather than merely convenient.
        const claiming = [];
        for (const f of readdirSync(new URL('./functions/', import.meta.url))) {
            if (!f.endsWith('.js')) continue;
            if (read(`./functions/${f}`).slice(0, 200).includes('@ts-check')) claiming.push(`functions/${f}`);
        }
        if (read('./service-worker.js').slice(0, 200).includes('@ts-check')) claiming.push('service-worker.js');
        assert.deepEqual(claiming, [],
            'these declare `@ts-check` but sit outside the checker, so the directive does nothing and '
            + 'reads as coverage:\n  ' + claiming.join('\n  ')
            + '\nEither remove them from jsconfig.json\'s exclude list, or drop the directive.');
    });

    test('every OTHER root module is inside the checker and says so', () => {
        // The converse, and the reason this file is not just two assertions: the value of the
        // exclusion list is that everything not on it IS checked. A root module that quietly stops
        // declaring `@ts-check` is checked-in-config and unchecked-in-fact.
        const EXEMPT = new Set([
            'service-worker.js',   // excluded, above
            'eslint.config.js',    // tooling config, not app code
            'guide-back.js',       // a classic script (no module scope) — loaded with a bare <script>
            'purify.es.mjs',       // vendored
        ]);
        const missing = readdirSync(new URL('.', import.meta.url))
            .filter(f => f.endsWith('.js') && !f.includes('.test.') && !EXEMPT.has(f))
            .filter(f => !read(`./${f}`).slice(0, 120).includes('@ts-check'))
            .sort();
        assert.deepEqual(missing, [],
            'these root modules are inside jsconfig\'s scope but do not declare `// @ts-check`, so '
            + 'tsc reads them without checking them:\n  ' + missing.join('\n  '));
    });
});
