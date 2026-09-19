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

    test('the two deliberate exclusions are still BOTH there', () => {
        // Named individually so REMOVING one is a visible edit here, with this file's header to read
        // first — and removing one is the good outcome. This half cannot see an exclusion being
        // ADDED; the test below is the half that does, and the name of this one used to claim both.
        assert.ok(exclude.has('service-worker.js'),
            'service-worker.js left the exclude list — if that is deliberate, delete this assertion '
            + 'and the header note with it; if it is not, `npm run typecheck` now reports ~105 errors');
        assert.ok(exclude.has('functions'),
            'functions/ left the exclude list — see this file\'s header for what turning it on costs');
    });

    test('and NOTHING ELSE has joined them', () => {
        // The assertion above is `has`, not `equals` — presence, never exclusivity — so for this
        // file's whole life a THIRD exclusion could be added without failing the test whose name is
        // "exactly those two". Found by mutation (19 Sep 2026): adding `paycalc-calc.js` to the
        // exclude list left every assertion here green, which is precisely the outcome the header
        // says this file exists to prevent — "to stop the gap GROWING without one".
        //
        // The list legitimately holds non-app entries (tooling directories, the test globs, the
        // runner configs, the vendored copy), so this cannot be an equality against a frozen array —
        // that would fail on a new Playwright config, which is not the thing worth stopping. It is
        // a rule about SHAPE instead: a directory or a glob is tooling, a `playwright.*.mjs` is a
        // runner config, and anything else that is a real module at the root has to be argued for
        // HERE, in the file that measures what turning it back on would cost.
        // `test-fixtures` joined at v24.15, deliberately: `roster-pdf.mjs` builds a PDF with
        // `Buffer`, which is Node, and this project's tsc run is configured for the BROWSER modules
        // it ships. Pulling in @types/node to typecheck a test fixture would widen the toolchain
        // for nothing. This assertion is what stopped that happening silently.
        const TOOLING_DIRS = new Set(['node_modules', 'scripts', 'functions', '.claude', 'e2e',
            'experiments', 'docs', 'test-fixtures']);
        const NAMED_FILES = new Set([
            'service-worker.js',   // the decision this file is about
            'purify.es.mjs',       // vendored — not ours to annotate
            'generate-sri.mjs',    // build tooling, not shipped
        ]);
        const unexpected = jsconfig.exclude.filter((/** @type {string} */ e) => {
            if (TOOLING_DIRS.has(e)) return false;
            if (e.includes('*')) return false;                       // the test globs
            if (/^playwright\.[\w.-]*mjs$/.test(e)) return false;    // a runner config
            return !NAMED_FILES.has(e);
        });
        assert.deepEqual(unexpected, [],
            'these joined jsconfig.json\'s exclude list without a decision being recorded — the '
            + 'checker silently stopped reading them:\n  ' + unexpected.join('\n  ')
            + '\nIf the exclusion is deliberate, name it in NAMED_FILES above WITH the reason, and '
            + 'measure what turning it on would cost (this file\'s header shows the format).');
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
