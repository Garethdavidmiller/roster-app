// bump-version-script.test.mjs — scripts/bump-version.mjs, tested by RUNNING it on a scratch copy.
//
// Nothing ran the bump script, and every version-ordering test fed it canonical NN.NN strings only.
// It accepted `25.7` — 25.70 to CI and the hook, 25.07 to the service worker's ordering — and a
// version LOWER than the current one; and when one file already held the target (a merge
// resolution) it wrote the other first and then stopped, leaving the two disagreeing (whole-app
// check, 10 November 2026). The script resolves both files from its own folder, so each case copies
// it beside two scratch version files and runs the real code. Part of test:hygiene.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('./scripts/bump-version.mjs', import.meta.url));

/**
 * Bump a scratch tree whose two files read `rd` and `sw`; report the exit and what each file says now.
 * @param {any} t @param {string} rd @param {string} sw @param {string} [arg]
 */
function bump(t, rd, sw, arg) {
    const dir = mkdtempSync(join(tmpdir(), 'bump-version-script-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    mkdirSync(join(dir, 'scripts'));
    copyFileSync(SCRIPT, join(dir, 'scripts', 'bump-version.mjs'));
    writeFileSync(join(dir, 'roster-data.js'), `// header\nexport const APP_VERSION = '${rd}';\nexport const X = 1;\n`);
    writeFileSync(join(dir, 'service-worker.js'), `// header\nconst APP_VERSION = '${sw}';\nconst CACHE = 'v' + APP_VERSION;\n`);
    const r = spawnSync(process.execPath, [join(dir, 'scripts', 'bump-version.mjs'), ...(arg ? [arg] : [])], { encoding: 'utf8' });
    const at = (/** @type {string} */ f) => (readFileSync(join(dir, f), 'utf8').match(/APP_VERSION = '([^']*)'/) || [])[1];
    return { status: r.status, out: r.stdout + r.stderr, rd: at('roster-data.js'), sw: at('service-worker.js'),
        rdText: readFileSync(join(dir, 'roster-data.js'), 'utf8') };
}

test('a two-decimal version above the current one is written to both files, and nothing else changes', (t) => {
    const r = bump(t, '25.69', '25.69', '25.70');
    assert.equal(r.status, 0, r.out);
    assert.deepEqual([r.rd, r.sw], ['25.70', '25.70']);
    assert.equal(r.rdText, "// header\nexport const APP_VERSION = '25.70';\nexport const X = 1;\n");
});

test('a version that is not exactly two decimals is refused: 25.7 is 25.07 to the worker', (t) => {
    for (const bad of ['25.7', '25.640', '25', 'v25.70', '25.70.1']) {
        const r = bump(t, '25.69', '25.69', bad);
        assert.equal(r.status, 1, `${bad} must be refused`);
        assert.deepEqual([r.rd, r.sw], ['25.69', '25.69'], `${bad}: nothing may be written`);
    }
    assert.equal(bump(t, '25.69', '25.69').status, 1, 'and no version at all');
});

test('a version that is not ABOVE the current one is refused — the version names the cache', (t) => {
    for (const notAbove of ['25.36', '25.63', '24.99']) {
        const r = bump(t, '25.63', '25.63', notAbove);
        assert.equal(r.status, 1, `${notAbove} over 25.63 must be refused`);
        assert.match(r.out, /not above the current 25\.63/);
        assert.deepEqual([r.rd, r.sw], ['25.63', '25.63']);
    }
    assert.equal(bump(t, '25.99', '25.99', '26.00').status, 0, 'crossing a whole number is fine');
});

test('two files that disagree are refused BEFORE either is written', (t) => {
    // The merge-resolution case, both ways round: the old script wrote one and then stopped.
    for (const [rd, sw] of [['25.65', '25.64'], ['25.64', '25.65']]) {
        const r = bump(t, rd, sw, '25.65');
        assert.equal(r.status, 1, r.out);
        assert.match(r.out, /reads 25\.6\d but service-worker\.js reads 25\.6\d/);
        assert.deepEqual([r.rd, r.sw], [rd, sw], 'neither file was touched');
    }
});
