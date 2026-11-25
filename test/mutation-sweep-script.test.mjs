// mutation-sweep-script.test.mjs — scripts/mutation-sweep.mjs, run, and its manifest, held to its lanes.
// Run: node scripts/run-tests.mjs test/mutation-sweep-script.test.mjs   (part of `npm run test:hygiene`)
//
// The weekly sweep (mutation.yml) breaks each listed WIRING line and expects a test to notice. Two
// ways it could stop meaning anything are checked here, on every branch, rather than on Monday:
//
//   1. THE MANIFEST ROTS. A listed line is edited and the entry no longer applies. Skipped, it would
//      drop out of the table and the sweep would stay green over a guard nobody checks any more; so
//      the sweep refuses a stale entry, and this runs its `--check-only` against the real manifest —
//      the commit that edits a listed line fails here, naming the entry to re-aim.
//   2. THE SWEEP LIES. It reads mutate.mjs's verdict lines, and a sweep that took "no verdict" for
//      "killed", or exited 0 over a survivor, would be a green that proved nothing. So it is run on a
//      scratch manifest whose verdicts are known, and the scratch file must come back unchanged.
//
// And the manifest is held to what mutation.yml installs: every entry's command is one of the Node
// lanes (`test:unit`, `test:hygiene`, `test:functions`), with that lane's own flags, so an entry
// needing a browser or the emulator fails here instead of erroring weekly.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Tests live in test/ but address files from the repository root (moved 24 Nov 2026).
const REPO_ROOT_URL = new URL('../', import.meta.url);
const ROOT = fileURLToPath(REPO_ROOT_URL);
const SWEEP = fileURLToPath(new URL('./scripts/mutation-sweep.mjs', REPO_ROOT_URL));

/** Run the sweep with `args`, from the repository root. */
const sweep = (/** @type {string[]} */ ...args) =>
    spawnSync(process.execPath, [SWEEP, ...args], { cwd: ROOT, encoding: 'utf8', timeout: 120_000 });

describe('the real manifest', async () => {
    const { MUTATIONS } = await import('../scripts/mutation-manifest.mjs');
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    /** The test files an npm script names. @param {string} name */
    const filesOf = (name) => new Set(String(pkg.scripts[name] ?? '').match(/test\/[\w.-]+\.test\.mjs/g) ?? []);
    const LANES = /** @type {const} */ ([
        ['test:unit', ['--experimental-test-module-mocks']],
        ['test:hygiene', []],
        ['test:functions', []],
    ]);

    test('is big enough to be the sweep CLAUDE.md asks for, and every id is its own', () => {
        assert.ok(MUTATIONS.length >= 30, `only ${MUTATIONS.length} entries — the manifest has been gutted`);
        const ids = MUTATIONS.map((/** @type {any} */ m) => m.id);
        assert.equal(new Set(ids).size, ids.length, 'two entries share an id');
    });

    test('every entry still applies, exactly once (`--check-only`) — a stale entry fails the commit that makes it', () => {
        const r = sweep('--check-only');
        assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
        assert.match(r.stdout, new RegExp(`all ${MUTATIONS.length} manifest entries apply`));
    });

    test('every entry runs a Node lane that mutation.yml installs, with that lane\'s own flags', () => {
        const wrong = [];
        for (const m of MUTATIONS) {
            const [bin, ...rest] = m.test;
            const file = rest.find((/** @type {string} */ a) => /^test\/.+\.test\.mjs$/.test(a));
            const lane = LANES.find(([name]) => file && filesOf(name).has(file));
            const flags = rest.slice(0, rest.indexOf('scripts/run-tests.mjs'));
            if (bin !== process.execPath) wrong.push(`${m.id}: runs ${bin}, not this node`);
            else if (!rest.includes('scripts/run-tests.mjs')) wrong.push(`${m.id}: not through scripts/run-tests.mjs`);
            else if (!lane) wrong.push(`${m.id}: ${file ?? 'no test file'} is in none of test:unit, test:hygiene, test:functions`);
            else if (JSON.stringify(flags) !== JSON.stringify(lane[1])) wrong.push(`${m.id}: flags ${JSON.stringify(flags)}, but ${lane[0]} runs ${JSON.stringify(lane[1])}`);
        }
        assert.deepEqual(wrong, [], wrong.join('\n'));
    });
});

describe('the sweep, on a scratch manifest whose verdicts are known', () => {
    /** A scratch folder with a target file and a manifest built from `entries(target)`. */
    function scratch(/** @type {any} */ t, /** @type {(target: string, dir: string) => object[]} */ entries) {
        const dir = mkdtempSync(join(tmpdir(), 'mutation-sweep-'));
        t.after(() => rmSync(dir, { recursive: true, force: true }));
        const target = join(dir, 'target.txt');
        writeFileSync(target, 'alpha GUARD omega\n');
        const manifest = join(dir, 'manifest.mjs');
        writeFileSync(manifest, `export const MUTATIONS = ${JSON.stringify(entries(target, dir), null, 2)};\n`);
        return { dir, target, manifest };
    }
    /** A command that fails exactly when the target no longer holds GUARD — a guard with teeth. */
    const bites = (/** @type {string} */ target) => [process.execPath, '-e',
        `process.exit(require('fs').readFileSync(${JSON.stringify(target)}, 'utf8').includes('GUARD') ? 0 : 1)`];
    /** A command that never notices — a guard with none. */
    const blind = () => [process.execPath, '-e', ''];
    const entry = (/** @type {string} */ id, /** @type {string} */ file, /** @type {string[]} */ cmd, find = 'GUARD') =>
        ({ id, file, find, replace: 'gone', test: cmd, breaks: `what ${id} would break` });

    test('every mutant killed → exit 0, and the file is put back', (t) => {
        const { target, manifest } = scratch(t, (f) => [entry('one', f, bites(f)), entry('two', f, bites(f))]);
        const r = sweep('--manifest', manifest);
        assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
        assert.match(r.stdout, /2 killed · 0 survived · 0 gave no verdict/);
        assert.equal(readFileSync(target, 'utf8'), 'alpha GUARD omega\n');
    });

    test('a SURVIVOR fails the sweep and is named, with what it would break', (t) => {
        const { target, manifest } = scratch(t, (f) => [entry('caught', f, bites(f)), entry('missed', f, blind())]);
        const r = sweep('--manifest', manifest);
        assert.equal(r.status, 1, 'a surviving mutant must fail the sweep');
        assert.match(r.stdout, /^killed\s+caught\b/m);
        assert.match(r.stdout, /^SURVIVED\s+missed\s+what missed would break$/m);
        assert.equal(readFileSync(target, 'utf8'), 'alpha GUARD omega\n');
    });

    test('a STALE entry fails before anything runs — it is never skipped', (t) => {
        const { dir, manifest } = scratch(t, (f, d) => [
            entry('fine', f, [process.execPath, '-e', `require('fs').writeFileSync(${JSON.stringify(join(d, 'ran'))}, '1')`]),
            entry('stale', f, bites(f), 'NOT THERE'),
        ]);
        const r = sweep('--manifest', manifest);
        assert.equal(r.status, 1);
        assert.match(r.stderr, /1 STALE manifest entry/);
        assert.match(r.stderr, /· stale \(/);
        assert.ok(!existsSync(join(dir, 'ran')), 'no entry may run while any entry is stale');
    });

    test('an AMBIGUOUS find is stale too', (t) => {
        const { manifest } = scratch(t, (f) => [entry('twice', f, bites(f), 'a')]);
        const r = sweep('--manifest', manifest, '--check-only');
        assert.equal(r.status, 1);
        assert.match(r.stderr, /appears \d+ times/);
    });

    test('a command that fails on the UNCHANGED file is no verdict, and fails the sweep', (t) => {
        const { manifest } = scratch(t, (f) => [entry('broken', f, [process.execPath, '-e', 'process.exit(3)'])]);
        const r = sweep('--manifest', manifest);
        assert.equal(r.status, 1);
        assert.match(r.stdout, /^ERROR\s+broken\b/m);
        assert.match(r.stdout, /0 killed · 0 survived · 1 gave no verdict/);
    });

    test('a malformed entry, or an --only naming nothing, is refused outright', (t) => {
        const { manifest } = scratch(t, (f) => [{ ...entry('typo', f, bites(f)), replcae: 'x' }]);
        const bad = sweep('--manifest', manifest);
        assert.equal(bad.status, 1);
        assert.match(bad.stderr, /unknown key "replcae"/);
        const { manifest: fine } = scratch(t, (f) => [entry('real', f, bites(f))]);
        const none = sweep('--manifest', fine, '--only', 'imaginary');
        assert.equal(none.status, 1);
        assert.match(none.stderr, /--only names no such entry: imaginary/);
    });
});
