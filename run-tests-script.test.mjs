// run-tests-script.test.mjs — scripts/run-tests.mjs, tested by running it, and every npm script
// that runs Node's test runner held to it, and every test file's own run line.
//
// The wrapper exists for the one failure `node --test` does not report: a `describe` whose body
// THROWS while being built prints `not ok`, adds nothing to the counts, and the run exits 0. That
// is Node 22. From Node 24 Node fails such a run itself, so the tests below demand the wrapper's own
// message only where plain `node --test` would have passed the file, and the run failing always. Its
// verdicts had no test of their own, though it has already needed one repair when Node's default
// reporter changed. And one lane bypassed it: `test:payslip-local`, the command whose green is
// documented to mean "the real payslip comparison definitely ran", called `node --test` directly —
// so a fixture row that broke the block's BUILD on the one checkout holding the fixture exited 0
// (whole-app check, 10 November 2026). Part of test:hygiene.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WRAPPER = fileURLToPath(new URL('./scripts/run-tests.mjs', import.meta.url));

/**
 * Run `body` as a test file through the wrapper. The scratch folder goes however the test ends.
 * `NODE_TEST_CONTEXT` is removed from the child's environment: this file runs under the test
 * runner, which sets it, and a `node --test` that inherits it reports to a parent over a private
 * protocol instead of printing TAP — so the wrapper would read nothing at all (measured).
 * @param {any} t @param {string} body @param {string[]} [flags]
 */
function runWrapped(t, body, flags = []) {
    const dir = mkdtempSync(join(tmpdir(), 'run-tests-script-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const file = join(dir, 'case.test.mjs');
    writeFileSync(file, body);
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const wrapped = spawnSync(process.execPath, [...flags, WRAPPER, file], { encoding: 'utf8', env });
    // What plain `node --test` makes of the same file. Node 22 exits 0 on a suite that fails to
    // build — the gap the wrapper exists for. From Node 24 Node fails the run itself, so there the
    // wrapper has nothing to add and prints no message of its own (measured, 10 November 2026: CI
    // runs Node 24 and failed the old assertions; this container runs Node 22).
    const raw = spawnSync(process.execPath, [...flags, '--test', '--test-reporter=tap', file], { encoding: 'utf8', env });
    return Object.assign(wrapped, { rawStatus: raw.status });
}

const HEAD = "import { describe, test, mock } from 'node:test';\nimport assert from 'node:assert/strict';\n";

describe('the wrapper\'s verdicts', () => {
    test('a suite that fails to BUILD fails the run, though no test inside it failed', (t) => {
        const r = runWrapped(t, HEAD
            + "describe('payslip integration', () => {\n"
            + "  const rows = Object.entries({ '2026-01-16': null }).map(([d, v]) => ({ d, gross: v.gross }));\n"
            + "  for (const p of rows) test(p.d, () => {});\n"
            + "});\n"
            + "test('an unrelated test that passes', () => {});\n");
        assert.equal(r.status, 1, r.stdout + r.stderr);
        if (r.rawStatus === 0) {
            // Node let the run pass, so the wrapper is what failed it, and it must say why.
            assert.match(r.stderr, /FAILED TO BUILD/);
            assert.match(r.stderr, /payslip integration/, 'the message names the suite that did not build');
        } else {
            // Node failed the run itself; its own report, passed through, names the suite.
            assert.match(r.stdout, /^not ok \d+ - payslip integration$/m, 'Node\'s report names the suite that did not build');
        }
    });

    test('a failing `todo` test is NOT a build failure — Node passes it by design', (t) => {
        // TAP prints it as `not ok N - name # TODO`. Treating that as a suite that did not build
        // failed the lane for a test its author had marked as not done yet.
        const r = runWrapped(t, HEAD
            + "test('written before the code', { todo: 'next release' }, () => { assert.fail('not yet'); });\n"
            + "test('a test that passes', () => {});\n");
        assert.equal(r.status, 0, r.stdout + r.stderr);
        assert.doesNotMatch(r.stderr, /FAILED TO BUILD/);
    });

    test('but a suite NAMED "… # TODO" that fails to build is still caught', (t) => {
        // A `#` inside a name is escaped as `\#`; only the runner's own directive is unescaped.
        const r = runWrapped(t, HEAD
            + "describe('payroll # TODO list', () => { throw new Error('no such helper'); });\n"
            + "test('a test that passes', () => {});\n");
        assert.equal(r.status, 1, r.stdout + r.stderr);
        if (r.rawStatus === 0) assert.match(r.stderr, /FAILED TO BUILD/);
    });

    test('an ordinary failing test fails, and a clean file passes', (t) => {
        assert.equal(runWrapped(t, HEAD + "test('wrong', () => { assert.equal(1, 2); });\n").status, 1);
        assert.equal(runWrapped(t, HEAD + "test('right', () => { assert.equal(1, 1); });\n").status, 0);
    });

    test('the outer node\'s flags reach the runner — module mocking is not silently off', (t) => {
        const body = HEAD + "test('mock.module exists', () => { assert.equal(typeof mock.module, 'function'); });\n";
        assert.equal(runWrapped(t, body, ['--experimental-test-module-mocks']).status, 0,
            'with the flag given to the wrapper, the suite must see module mocking');
        assert.equal(runWrapped(t, body).status, 1,
            'without it the same suite fails — so the pass above is the flag arriving, not luck');
    });
});

describe('every npm script that runs Node\'s test runner goes through the wrapper', () => {
    const scripts = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).scripts;

    test('no script calls `node --test` directly', () => {
        // `--test` as a flag of its own: `--test-reporter` and `--test-name-pattern` are not it.
        const direct = Object.entries(scripts)
            .filter(([, cmd]) => /(^|\s)--test(\s|$)/.test(String(cmd)))
            .map(([name]) => name);
        assert.deepEqual(direct, [],
            'these npm scripts run `node --test` without scripts/run-tests.mjs, so a suite that fails '
            + 'to BUILD reports `# fail 0` and exits 0 there:\n  ' + direct.join('\n  '));
    });

    test('guard the guard — the wrapped scripts were actually found', () => {
        // The lanes that should all be wrapped; if the check above stopped seeing them it would pass
        // over nothing.
        for (const name of ['test:hygiene', 'test:parse', 'test:unit', 'test:functions', 'test:rules', 'test:payslip-local']) {
            assert.match(String(scripts[name]), /scripts\/run-tests\.mjs/, `${name} no longer runs through the wrapper`);
        }
    });
});

describe('every test file\'s own run line goes through the wrapper', () => {
    // A test file's header is where somebody copies the command to run that one file. Until
    // 10 November 2026, 141 headers said `node --test <file>`: on Node 22, the runner that exits 0
    // when a block fails to BUILD, so it was handed out for the exact file a reader was debugging.
    const ROOT = fileURLToPath(new URL('.', import.meta.url));
    const files = readdirSync(ROOT).filter((f) => f.endsWith('.test.mjs'));
    const text = (f) => readFileSync(join(ROOT, f), 'utf8');
    const bare = /node (?:--[a-z-]+ )*--test [\w.-]+\.test\.mjs/;

    test('no header tells a reader to run its file with bare `node --test`', () => {
        const offenders = files.filter((f) => bare.test(text(f)));
        assert.deepEqual(offenders, [],
            'these files name `node --test <file>` as the way to run them; name '
            + '`node [flags] scripts/run-tests.mjs <file>` instead:\n  ' + offenders.join('\n  '));
    });

    test('guard the guard — the headers that name the wrapper were found', () => {
        // On a clean tree the check above finds nothing, so it cannot tell a working pattern from a
        // broken one: show it both shapes of run line. Assembled, or this file would be the offender.
        const T = '--test';
        assert.match(` * Run with: node --experimental-test-module-mocks ${T} some.test.mjs`, bare);
        assert.match(` * Run: node ${T} some.test.mjs   (part of \`npm run test:hygiene\`)`, bare);
        assert.doesNotMatch(' * Run: node --experimental-test-module-mocks scripts/run-tests.mjs some.test.mjs', bare);
        const wrapped = files.filter((f) => /node (?:--[a-z-]+ )*scripts\/run-tests\.mjs [\w.-]+\.test\.mjs/.test(text(f)));
        assert.ok(files.length > 100, `only ${files.length} test files found beside this one`);
        assert.ok(wrapped.length * 2 > files.length,
            `only ${wrapped.length} of ${files.length} test files name the wrapper — the scan is not reading them`);
    });
});
