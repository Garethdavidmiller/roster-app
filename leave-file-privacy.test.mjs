// @ts-check
/**
 * leave-file-privacy.test.mjs — A LEAVE FILE NEVER ENTERS THE TREE.
 * Run: node scripts/run-tests.mjs leave-file-privacy.test.mjs   (part of `npm run test:hygiene`)
 *
 * A leave file names every colleague against their dates of leave (al-leave-file.js), and the
 * answers file beside it names the personal exceptions in matching them. The repository is public,
 * and the GitHub Pages mirror serves every committed file at HTTP 200 with no ignore list, so the
 * only rule BOTH origins obey is that the file is never committed. Three locks, each tested here:
 *
 *   1. `scripts/make-leave-file.mjs` refuses to WRITE inside the repository (`isOutsideRepo`) — also
 *      through a symlinked folder or file, and for a name that merely begins with two dots;
 *   2. `.gitignore` excludes `*.leave.json` and `*.local.json`, wherever the file lands, so one
 *      copied in by hand is not picked up by `git add -A`;
 *   3. and if one is committed anyway, this fails: no tracked file may BE a leave file. A real one
 *      always carries a full 64-character seal, so the needle is the format marker AND a full seal —
 *      which a plan's example (`"digest": "sha256:…"`) never has. The needles are built from the
 *      module's own constant, so this file does not match itself.
 *
 * Needs nothing installed. When `git` is not on the path, the git-side checks say so and are skipped
 * rather than passing silently.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { LEAVE_FILE_FORMAT } from './al-leave-file.js';
import { isOutsideRepo } from './scripts/make-leave-file.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));

/** @param {string[]} args @returns {string|null} git's output, or null when git cannot run here */
function git(args) {
    try { return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return null; }
}
const inCheckout = git(['rev-parse', '--is-inside-work-tree'])?.trim() === 'true';

test('.gitignore excludes leave files and answers files, as whole lines', () => {
    const lines = readFileSync(join(ROOT, '.gitignore'), 'utf8').split('\n').map(l => l.trim());
    for (const rule of ['*.leave.json', '*.local.json']) {
        assert.ok(lines.includes(rule), `the \`${rule}\` rule is gone from .gitignore — it is what keeps a leave file out of the\n`
            + 'public repository (and so off the Pages mirror) if one is ever copied into the tree. Put it back.');
    }
});

test('and git agrees, at the root and deep in a served folder', { skip: !inCheckout && 'git is not available here' }, () => {
    for (const path of ['leave-2026.leave.json', 'docs/leave-2026-as-of-2026-11-06.leave.json', 'scripts/answers.local.json']) {
        // `check-ignore` exits 0 for an ignored path and 1 for one git would track.
        assert.notEqual(git(['check-ignore', '-q', path]), null, `git would track ${path}`);
    }
});

test('no TRACKED file is a real leave file', { skip: !inCheckout && 'git is not available here' }, () => {
    const tracked = (git(['ls-files', '-z']) ?? '').split('\0').filter(Boolean);
    assert.ok(tracked.length > 200, `only ${tracked.length} tracked files listed — the listing is broken`);
    // Built from the constant, so neither needle is written out in this file.
    const marker = new RegExp(`"format"\\s*:\\s*"${LEAVE_FILE_FORMAT.replace(/[-]/g, '\\-')}"`);
    const seal = new RegExp(['"digest"', '\\s*:\\s*', '"sha256:[0-9a-f]{64}"'].join(''));
    const BINARY = new Set(['.png', '.jpg', '.jpeg', '.ico', '.gif', '.webp', '.woff', '.woff2', '.pdf', '.zip', '.gz', '.xlsx', '.mp4']);
    const offenders = [];
    for (const f of tracked) {
        if (BINARY.has(extname(f).toLowerCase())) continue;
        let text;
        try { text = readFileSync(join(ROOT, f), 'utf8'); } catch { continue; }   // a submodule or a deleted file
        if (extname(f) === '.json') {
            try { if (JSON.parse(text)?.format === LEAVE_FILE_FORMAT) { offenders.push(f); continue; } } catch { /* not JSON */ }
        }
        if (marker.test(text) && seal.test(text)) offenders.push(f);
    }
    assert.deepEqual(offenders, [],
        'these tracked files are, or contain, a leave file — personal data, which the Pages mirror serves.\n'
        + 'Remove them from git (and from history if they were pushed), and keep leave files outside the repository.');
});

test('the needles still find a real leave file — guard the guard', () => {
    const marker = new RegExp(`"format"\\s*:\\s*"${LEAVE_FILE_FORMAT.replace(/[-]/g, '\\-')}"`);
    const seal = new RegExp(['"digest"', '\\s*:\\s*', '"sha256:[0-9a-f]{64}"'].join(''));
    const real = JSON.stringify({ format: LEAVE_FILE_FORMAT, version: 1, digest: `sha256:${'c'.repeat(64)}` }, null, 1);
    assert.ok(marker.test(real) && seal.test(real));
    // …and not a plan's example, whose seal is elided.
    const example = `{ "format": "${LEAVE_FILE_FORMAT}", "digest": "sha256:…" }`;
    assert.ok(!(marker.test(example) && seal.test(example)));
});

test('the script will not write inside the repository — by any route', () => {
    const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'leave-privacy-')));
    try {
        assert.equal(isOutsideRepo(join(ROOT, 'x.leave.json')), false, 'the repository root');
        assert.equal(isOutsideRepo(join(ROOT, 'docs', 'not', 'yet', 'there', 'x.leave.json')), false, 'a folder that does not exist yet');
        // A name that only BEGINS with two dots is inside, not above: `..x` is not `..`.
        assert.equal(isOutsideRepo(join(ROOT, '..x.leave.json')), false, 'a name beginning with two dots');
        assert.equal(isOutsideRepo(join(tmp, 'x.leave.json')), true, 'a temporary folder');
        assert.equal(isOutsideRepo(join(ROOT, '..', 'outside-the-repo.leave.json')), true, 'the folder above');
        // A folder that is a symlink INTO the repository.
        symlinkSync(ROOT, join(tmp, 'into-repo'));
        assert.equal(isOutsideRepo(join(tmp, 'into-repo', 'x.leave.json')), false, 'through a symlinked folder');
        // A FILE that is a symlink into the repository: writing to it writes there, existing or not.
        mkdirSync(join(tmp, 'plain'));
        symlinkSync(join(ROOT, 'test-results', 'never-made.leave.json'), join(tmp, 'plain', 'dangling.leave.json'));
        symlinkSync(join(ROOT, 'package.json'), join(tmp, 'plain', 'existing.leave.json'));
        assert.equal(isOutsideRepo(join(tmp, 'plain', 'dangling.leave.json')), false, 'a dangling symlinked file');
        assert.equal(isOutsideRepo(join(tmp, 'plain', 'existing.leave.json')), false, 'a symlinked file');
    } finally {
        rmSync(tmp, { recursive: true, force: true });
    }
});
