// refresh-visual-script.test.mjs — scripts/refresh-visual-baselines.mjs, RUN in a scratch repository.
//
// The committed baselines are CI's render, and the script could only draw them from the local one,
// while the lane's own comment and README said to take them from the pull request's `visual-diffs`
// artifact. It now copies each failed screenshot's CI render out of the unzipped artifact, into the
// lane its folder names. Its local mode also said "nothing had drifted" about a lane that had not
// run, and exited 0 when baselines changed but the run itself had failed (whole-app check,
// 10 November 2026). A fake `npx` stands in for Playwright. Part of test:hygiene; skips without git.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('./scripts/refresh-visual-baselines.mjs', import.meta.url));
const skip = spawnSync('git', ['--version']).status === 0 ? false : 'git is not installed here — the script was not run';

/** A scratch repository holding one committed baseline per lane, and a copy of the script. */
function repo(/** @type {any} */ t) {
    const dir = mkdtempSync(join(tmpdir(), 'refresh-visual-script-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const git = (/** @type {string[]} */ ...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid',
        '-c', 'commit.gpgsign=false', ...a], { cwd: dir, stdio: 'ignore' });
    mkdirSync(join(dir, 'scripts'));
    copyFileSync(SCRIPT, join(dir, 'scripts', 'refresh-visual-baselines.mjs'));
    mkdirSync(join(dir, 'e2e', 'visual-baselines', 'webkit'), { recursive: true });
    writeFileSync(join(dir, 'e2e/visual-baselines/calendar.png'), 'chromium-old');
    writeFileSync(join(dir, 'e2e/visual-baselines/webkit/calendar.png'), 'webkit-old');
    git('init', '-q');
    git('add', '-A');
    git('commit', '-qm', 'baselines');
    const put = (/** @type {Record<string, string>} */ files) => {
        for (const [p, body] of Object.entries(files)) {
            mkdirSync(dirname(join(dir, p)), { recursive: true });
            writeFileSync(join(dir, p), body);
        }
    };
    const read = (/** @type {string} */ p) => readFileSync(join(dir, p), 'utf8');
    /** @param {string[]} args @param {Record<string, string>} [env] */
    const run = (args, env = {}) => spawnSync(process.execPath, ['scripts/refresh-visual-baselines.mjs', ...args],
        { cwd: dir, encoding: 'utf8', env: { ...process.env, ...env } });
    return { dir, put, read, run };
}

test('each failed screenshot\'s CI render replaces its baseline, each lane in its own folder', { skip }, (t) => {
    const r = repo(t);
    r.put({
        'art/test-results/visual-calendar-desktop-visual/calendar-actual.png': 'chromium-ci',
        'art/test-results/visual-calendar-desktop-visual/calendar-expected.png': 'chromium-old',
        'art/test-results/visual-calendar-desktop-visual/calendar-diff.png': 'diff',
        'art/test-results/visual-webkit-calendar-mobile-safari/calendar-actual.png': 'webkit-ci',
        'art/test-results/visual-team-week-visual/team-actual.png': 'new-screenshot',
    });
    const res = r.run(['art']);
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.equal(r.read('e2e/visual-baselines/calendar.png'), 'chromium-ci');
    assert.equal(r.read('e2e/visual-baselines/webkit/calendar.png'), 'webkit-ci', 'the WebKit render went to the WebKit folder');
    assert.equal(r.read('e2e/visual-baselines/team.png'), 'new-screenshot', 'a new screenshot gets its baseline from CI too');
    for (const p of ['e2e/visual-baselines/calendar.png', 'e2e/visual-baselines/webkit/calendar.png', 'e2e/visual-baselines/team.png']) {
        assert.ok(res.stdout.includes(p), `the run must name ${p}`);
    }
});

test('a render it cannot place, two renders for one baseline, or no renders at all: refused, nothing written', { skip }, (t) => {
    /** @type {[string, Record<string, string>, RegExp][]} */
    const cases = [
        ['a folder that names no visual project', { 'art/test-results/pages-calendar-chromium/calendar-actual.png': 'x' }, /not from a visual lane/],
        ['two renders for one baseline', {
            'art/test-results/visual-a-visual/calendar-actual.png': 'x',
            'art/test-results/visual-b-visual/calendar-actual.png': 'y',
        }, /two renders/],
        ['no actuals', { 'art/test-results/visual-a-visual/calendar-diff.png': 'x' }, /no \*-actual\.png/],
    ];
    for (const [what, files, why] of cases) {
        const r = repo(t);
        r.put(files);
        const res = r.run(['art']);
        assert.equal(res.status, 1, `${what}: ${res.stdout}${res.stderr}`);
        assert.match(res.stderr, why, `${what}: refused for the wrong reason`);
        assert.equal(r.read('e2e/visual-baselines/calendar.png'), 'chromium-old', `${what}: a baseline was written`);
    }
});

test('the local run never says "nothing had drifted" about a lane that did not run cleanly', { skip }, (t) => {
    /** A fake `npx` that does `body` instead of running Playwright. */
    const withNpx = (/** @type {any} */ r, /** @type {string} */ body) => {
        const bin = join(r.dir, 'bin');
        mkdirSync(bin);
        writeFileSync(join(bin, 'npx'), `#!/usr/bin/env node\n${body}\n`);
        chmodSync(join(bin, 'npx'), 0o755);
        return { PATH: `${bin}${delimiter}${process.env.PATH}` };
    };
    const failed = repo(t);
    const a = failed.run([], withNpx(failed, 'process.exit(3);'));
    assert.equal(a.status, 3);
    assert.doesNotMatch(a.stdout, /nothing had drifted/);
    assert.match(a.stdout, /FAILED/);

    const killed = repo(t);
    const b = killed.run([], withNpx(killed, "process.kill(process.pid, 'SIGKILL');"));
    assert.equal(b.status, 1);
    assert.match(b.stderr, /did not run/);

    const partial = repo(t);
    const c = partial.run([], withNpx(partial,
        "require('fs').writeFileSync('e2e/visual-baselines/calendar.png', 'chromium-local'); process.exit(1);"));
    assert.equal(c.status, 1, 'baselines changed, but the run failed — that is not a clean refresh');
    assert.match(c.stdout, /e2e\/visual-baselines\/calendar\.png/);
    assert.match(c.stdout, /may be incomplete/);
});
