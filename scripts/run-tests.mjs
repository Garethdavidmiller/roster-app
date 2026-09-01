#!/usr/bin/env node
/**
 * run-tests.mjs — `node --test`, with the ONE failure mode it does not report (v22.19).
 *
 * A `describe` block whose body THROWS while being built — a typo'd helper, a wrong import name,
 * a ReferenceError — is reported in TAP as `not ok N - <suite name>` and then contributes NOTHING
 * to the counts. Node's own summary reads `# pass N  # fail 0`, and **the process exits 0**,
 * because no TEST failed: none was ever defined. So `npm test`, `npm run check` and CI's unit job
 * all go green while a whole block of assertions is missing.
 *
 * That is not hypothetical. It happened on 1 Sep 2026: a new block in `override-utils.test.mjs`
 * used `test(` in a file that imports `it`, so three assertions about clock-time validation never
 * ran — and the mutation they were written to catch survived with the suite reporting success. The
 * only reason it was noticed is that the mutation SHOULD have failed and did not.
 *
 * It is the same shape as the hazards this repo already guards — `doc-parity.test.mjs` fails a
 * suite that is listed and never wired, because "a suite that passes by not existing" is worse
 * than no suite at all. This closes the runtime half of it.
 *
 * Usage: node [node flags] scripts/run-tests.mjs <test files…>  (flags are forwarded)
 */
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
// `process.execArgv` carries the flags the OUTER node was given — `--experimental-vm-modules`,
// `--experimental-test-module-mocks`. Forwarding them is not optional: without it the child runs
// without module mocking, and every suite that mocks an import fails to build… which is exactly the
// failure this wrapper exists to report, so it would be loud rather than silent, but wrong.
const child = spawn(process.execPath, [...process.execArgv, '--test', ...args],
    { stdio: ['inherit', 'pipe', 'inherit'] });

let out = '';
child.stdout.on('data', (b) => { out += b; process.stdout.write(b); });

child.on('close', (code) => {
    // A top-level `not ok` with no indentation is a FILE or SUITE that did not build. Node's own
    // counts and exit code both miss it; the TAP line is the only evidence.
    const broken = out.split('\n').filter(l => /^not ok \d+ - /.test(l));
    if (broken.length && code === 0) {
        process.stderr.write(
            '\n✖ A suite reported `not ok` but the run exited 0 — it FAILED TO BUILD, so its tests\n'
            + '  were never defined and never counted. Almost always a name that does not exist in\n'
            + '  that file (`test` vs `it`, a helper, an import). Look above for the error.\n\n'
            + broken.map(l => '    ' + l).join('\n') + '\n');
        process.exit(1);
    }
    process.exit(code ?? 1);
});
