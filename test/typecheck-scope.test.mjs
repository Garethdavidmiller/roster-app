// @ts-nocheck
/**
 * typecheck-scope.test.mjs — what `npm run typecheck` actually covers, and what it does not.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────────
 *
 * `jsconfig.json` excludes `service-worker.js` and the whole of `functions/`. For the worker that is
 * still a gap, and a decision; for `functions/` it is no longer a gap at all (25 Nov 2026): the Cloud
 * Functions have a project of their own, `functions/jsconfig.json` — CommonJS on Node, the same
 * `strict` — and `npm run typecheck` (scripts/typecheck.mjs) runs it beside the root one. The root
 * exclusion stays because the root project is the BROWSER's (DOM lib, no Node types), and checking
 * the Functions there would be checking them against the wrong platform.
 *
 * ── THE MEASUREMENTS ────────────────────────────────────────────────────────────────────────────
 *
 * · `functions/` — 447 diagnostics when first measured (28 Aug 2026); 599 on 25 Nov 2026 under the
 *   first cut of the new project, of which 280 were the checker reading the JS of untyped packages
 *   (`maxNodeModuleJsDepth`, which a jsconfig.json sets to 2 by default; the project sets 0). The
 *   remaining 319, across 24 files, were fixed in the code's own JSDoc: real `@param`/`@returns`
 *   types and typedefs, type predicates on the filters that drop nulls, `unknown` caught values read
 *   through `fieldsOf` (functions/caught.js), declarations for `web-push` (functions/web-push.d.ts).
 *   None was a defect at run time — the "possibly undefined" class was, as first sampled, narrowing
 *   the checker could not see — and the project now reports none. That it CAN report one is the
 *   point: a wrong argument, a misspelt property or a dropped field now fails before a deploy.
 *
 * · `service-worker.js` — **105 diagnostics** on 28 Aug 2026, 117 on 25 Nov 2026, and the standard
 *   cheap fix does NOT work: adding a `webworker` lib reference and a typed `self` alias leaves the
 *   count unchanged, because the errors live in the listener callbacks (`event.request` and
 *   `event.waitUntil` on a bare `Event`, plus dozens of implicit-any parameters). It needs ~40 hand
 *   annotations in the riskiest file in the app, every one of them a version bump, and its defects
 *   have all been lifecycle bugs (precache in `install`, the double-reload on first claim,
 *   `caches.match` preferring the oldest cache); none is a type error. Still excluded.
 *
 * ── WHAT THIS TEST IS FOR ───────────────────────────────────────────────────────────────────────
 *
 * Not to argue the decision — to stop the gap GROWING without one, and to stop the Functions
 * project being quietly loosened: a strict flag switched off, the include narrowed, or the gate
 * script no longer running it would each read as "checked" while checking less.
 *
 * REVISIT the worker when a defect is ever traced to a shape error in it. That is the same trigger
 * the build-step row uses, and for the same reason: a cost that has never been paid is not
 * evidence, and one that has been is.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

// Tests live in test/ but address files from the repository root (moved 24 Nov 2026).
const REPO_ROOT_URL = new URL('../', import.meta.url);

const read = (/** @type {string} */ p) => readFileSync(new URL(p, REPO_ROOT_URL), 'utf8');
const jsconfig = JSON.parse(read('./jsconfig.json'));
const exclude = new Set(jsconfig.exclude);

describe('the type-checker’s scope is a decision, not a drift', () => {

    test('the two deliberate exclusions are still BOTH there', () => {
        // Named individually so REMOVING one is a visible edit here, with this file's header to read
        // first — and removing one is the good outcome. This half cannot see an exclusion being
        // ADDED; the test below is the half that does, and the name of this one used to claim both.
        assert.ok(exclude.has('service-worker.js'),
            'service-worker.js left the exclude list — if that is deliberate, delete this assertion '
            + 'and the header note with it; if it is not, `npm run typecheck` now reports ~117 errors');
        assert.ok(exclude.has('functions'),
            'functions/ left the ROOT exclude list — it is checked by functions/jsconfig.json, against '
            + 'Node; the root project is the browser\'s, and would check it against the DOM');
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
        // `test` joined on 24 Nov 2026, when the unit suites moved out of the root into test/: the
        // folder replaces the two `*.test.*` globs that excluded them from the root before.
        const TOOLING_DIRS = new Set(['node_modules', 'scripts', 'functions', '.claude', 'e2e',
            'experiments', 'docs', 'test-fixtures', 'test']);
        const NAMED_FILES = new Set([
            'service-worker.js',   // the decision this file is about
            'purify.es.mjs',       // vendored — not ours to annotate
            'pdfjs',               // vendored PDF.js, minified (pdf-viewer.js loads it by URL) — not ours to annotate
            'generate-sri.mjs',    // build tooling, not shipped
        ]);
        const unexpected = jsconfig.exclude.filter((/** @type {string} */ e) => {
            if (TOOLING_DIRS.has(e)) return false;
            if (e.includes('*')) return false;                       // a glob is tooling by shape
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
        // The dangerous half-state: a file carrying `// @ts-check` while outside every project reads
        // as covered to anyone opening it, and is not. The worker is the one such area left (the
        // Functions have their own project, pinned below).
        const claiming = [];
        if (read('./service-worker.js').slice(0, 200).includes('@ts-check')) claiming.push('service-worker.js');
        assert.deepEqual(claiming, [],
            'these declare `@ts-check` but sit outside the checker, so the directive does nothing and '
            + 'reads as coverage:\n  ' + claiming.join('\n  ')
            + '\nEither remove them from jsconfig.json\'s exclude list, or drop the directive.');
    });

    describe('the Cloud Functions are checked, by a project of their own (25 Nov 2026)', () => {
        const fnConfig = JSON.parse(read('./functions/jsconfig.json'));
        const opts = fnConfig.compilerOptions || {};
        const fnModules = readdirSync(new URL('./functions/', REPO_ROOT_URL)).filter(f => f.endsWith('.js'));

        test('strict, checking JavaScript, for Node and CommonJS', () => {
            assert.equal(opts.checkJs, true, 'functions/jsconfig.json no longer sets checkJs — it checks nothing');
            assert.equal(opts.strict, true, 'functions/jsconfig.json is no longer strict');
            assert.equal(opts.noEmit, true, 'functions/jsconfig.json would EMIT — a type-check must write nothing');
            assert.deepEqual(opts.types, ['node'], 'the Functions are type-checked against Node\'s types');
            assert.equal(opts.module, 'nodenext', 'the Functions are CommonJS on Node, resolved as Node does');
        });

        test('no strict flag is switched off underneath `strict`', () => {
            // `strict: true` beside `noImplicitAny: false` reads as strict and is not. Each of these is
            // a family member `strict` turns on; setting any of them false is a loosening.
            const STRICT_FAMILY = ['noImplicitAny', 'strictNullChecks', 'strictFunctionTypes',
                'strictBindCallApply', 'strictPropertyInitialization', 'noImplicitThis',
                'useUnknownInCatchVariables', 'alwaysStrict', 'strictBuiltinIteratorReturn'];
            const off = STRICT_FAMILY.filter(k => opts[k] === false);
            assert.deepEqual(off, [], `functions/jsconfig.json switches off: ${off.join(', ')}`);
        });

        test('every functions/*.js is inside it', () => {
            assert.ok((fnConfig.include || []).includes('*.js'),
                'functions/jsconfig.json no longer includes `*.js` — a module it does not name is not checked');
            const excluded = (fnConfig.exclude || []).filter(e => e !== 'node_modules');
            assert.deepEqual(excluded, [], 'functions/jsconfig.json excludes something besides node_modules');
            assert.ok(fnModules.length > 20, `only ${fnModules.length} functions modules found — the scan is wrong`);
        });

        test('and none of them opts out', () => {
            // A `@ts-nocheck` turns a file off; a `@ts-ignore` / `@ts-expect-error` turns a line off.
            // The Functions reached zero without any, and the first one is a decision for here.
            const opting = fnModules.filter(f => /@ts-(nocheck|ignore|expect-error)\b/.test(read(`./functions/${f}`)));
            assert.deepEqual(opting, [], `these switch the checker off for a file or a line: ${opting.join(', ')}`);
        });

        test('`npm run typecheck` runs BOTH projects, and refuses without the Functions install', () => {
            const gate = read('./scripts/typecheck.mjs');
            assert.match(gate, /config: 'jsconfig\.json'/, 'scripts/typecheck.mjs no longer runs the root project');
            assert.match(gate, /config: 'functions\/jsconfig\.json'/, 'scripts/typecheck.mjs no longer runs the Functions project');
            assert.match(gate, /functions\/node_modules\/firebase-functions\/package\.json/,
                'scripts/typecheck.mjs no longer refuses a tree without the Functions install — its '
                + 'missing-module diagnostics would read as defects');
            assert.equal(JSON.parse(read('./package.json')).scripts.typecheck, 'node scripts/typecheck.mjs');
        });
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
        const missing = readdirSync(new URL('.', REPO_ROOT_URL))
            .filter(f => f.endsWith('.js') && !f.includes('.test.') && !EXEMPT.has(f))
            .filter(f => !read(`./${f}`).slice(0, 120).includes('@ts-check'))
            .sort();
        assert.deepEqual(missing, [],
            'these root modules are inside jsconfig\'s scope but do not declare `// @ts-check`, so '
            + 'tsc reads them without checking them:\n  ' + missing.join('\n  '));
    });
});
