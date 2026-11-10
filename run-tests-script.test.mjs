// run-tests-script.test.mjs — scripts/run-tests.mjs, tested by running it, and every npm script
// that runs Node's test runner held to it.
//
// The wrapper exists for the one failure `node --test` does not report: a `describe` whose body
// THROWS while being built prints `not ok`, adds nothing to the counts, and the run exits 0. Its
// verdicts had no test of their own, though it has already needed one repair when Node's default
// reporter changed. And one lane bypassed it: `test:payslip-local`, the command whose green is
// documented to mean "the real payslip comparison definitely ran", called `node --test` directly —
// so a fixture row that broke the block's BUILD on the one checkout holding the fixture exited 0
// (whole-app check, 10 November 2026). Part of test:hygiene.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
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
    return spawnSync(process.execPath, [...flags, WRAPPER, file], { encoding: 'utf8', env });
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
        assert.match(r.stderr, /FAILED TO BUILD/);
        assert.match(r.stderr, /payslip integration/, 'the message names the suite that did not build');
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
        assert.match(r.stderr, /FAILED TO BUILD/);
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
