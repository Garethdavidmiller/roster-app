#!/usr/bin/env node
/**
 * scripts/test-nodeps.mjs — every suite that runs from a bare checkout, with NOTHING installed.
 * Run: npm run test:nodeps   (or, with no npm at all: node scripts/test-nodeps.mjs)
 *
 * WHY THIS EXISTS. An external reviewer working from a GitHub ZIP reported that they could not
 * count most of the estate as executed, because the archive "doesn't contain the necessary
 * installed dependency trees". That is true of a handful of files and false of every other one —
 * measured, not assumed: a `git archive` of this repo with no `node_modules` anywhere runs the
 * great majority of the suites, and several thousand assertions, on nothing but a Node binary.
 * `npm test` itself is one of them: the whole default lane passes with nothing installed.
 * The tooling was never the obstacle; the repo simply never said so, and a reviewer who cannot
 * tell which suites are runnable reasonably reports the whole estate as unverified. It says so
 * now, in README.md, which is where somebody unzipping an archive actually looks.
 *
 * The figures are deliberately NOT written down here. This script COMPUTES them and prints them
 * on every run — a count in a comment beside the code that derives it is the staleness this repo
 * keeps having to correct (see doc-parity.test.mjs). Run it and read the first line.
 *
 * WHAT NEEDS INSTALLING, AND ONLY THIS:
 *   · the Cloud Functions handler suites — `functions/node_modules`, because they `require()` the
 *     real Admin SDK, and the roster-geometry suite drives the real PDF parser;
 *   · the two rules suites — the Firebase emulator binary plus @firebase/rules-unit-testing;
 *   · lint, typecheck, and every Playwright suite — root `node_modules`.
 *
 * THE EXCLUSION LIST IS DERIVED, NEVER WRITTEN DOWN. It is read out of package.json's own
 * `test:functions` and `test:rules` scripts, so a suite added to either is excluded here
 * automatically and a new zero-dependency suite is picked up with no edit at all. A hand-kept
 * second list is precisely the drift this repo keeps having to correct — the enumerated CSS
 * classes, the rules-doc globs, the hand-listed `node --check`.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

/** Test files named anywhere in a package script — those are the ones with dependencies. */
function namedIn(script) {
    return [...(pkg.scripts?.[script] ?? '').matchAll(/[\w.-]+\.test\.mjs/g)].map(m => m[0]);
}

/**
 * A SUITE DECLARES ITS OWN DEPENDENCY CONTRACT (v22.45, external review). Being listed in
 * `test:functions` used to be the whole answer, and that is too coarse in both directions:
 * `roster-parse-helpers.test.mjs` is listed there purely for convenience and needs nothing, and
 * `roster-geometry.test.mjs` is listed there because ONE block drives the real pdfjs — but that
 * block skips itself by name on a bare checkout, so thirty pure assertions were being left on the
 * table by a runner whose entire job is to run everything that can run. The reviewer measured that
 * by invoking the suite directly, which is exactly the gap.
 *
 * The old answer was a hard-coded exception here, and the header above rightly forbids a
 * hand-kept second list. So the marker lives in the SUITE, next to the `skip:` that makes it true,
 * and this file only reads it: a fact about a file belongs in that file. The exception that was
 * already written down is gone with it, so this is one fewer place to drift, not one more.
 */
const NODEPS_MARKER = '@nodeps-safe';
const selfSkips = (f) => {
    try { return readFileSync(new URL(`../${f}`, import.meta.url), 'utf8').includes(NODEPS_MARKER); }
    catch { return false; }
};
const NEEDS_DEPS = new Set(
    [...namedIn('test:functions'), ...namedIn('test:rules')].filter(f => !selfSkips(f)));

const all = readdirSync(new URL('..', import.meta.url))
    .filter(f => f.endsWith('.test.mjs'))
    .sort();
const runnable = all.filter(f => !NEEDS_DEPS.has(f));

if (!runnable.length) {
    console.error('test-nodeps: no test files found — run this from the repository root.');
    process.exit(1);
}
console.log(`test-nodeps: ${runnable.length} of ${all.length} suites need nothing installed.`);
console.log(`             skipping ${[...NEEDS_DEPS].sort().join(', ')}\n`);

// BOTH experimental flags, and neither needs anything installed. `--experimental-test-module-mocks`
// is what several suites are written against; `--experimental-vm-modules` is what `module-parse`
// needs to build a `vm.SourceTextModule`, and without it that suite SKIPS ITSELF — honestly, with a
// reason, but it still skips. An external reviewer running this lane reported the skip and had to
// go and run that one suite by hand to cover it. A lane whose whole claim is "this runs with
// nothing installed" should not need a footnote, least of all for the suite that catches a fatal
// SyntaxError shipping to a page. Both flags are harmless to every other suite.
const res = spawnSync(process.execPath,
    ['--experimental-test-module-mocks', '--experimental-vm-modules', 'scripts/run-tests.mjs', ...runnable],
    { stdio: 'inherit', cwd: new URL('..', import.meta.url) });
process.exit(res.status ?? 1);
