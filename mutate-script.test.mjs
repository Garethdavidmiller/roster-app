// mutate-script.test.mjs — scripts/mutate.mjs, tested by running it.
//
// Every "this guard has teeth" claim in the repo rests on that script: CLAUDE.md asks for a mutation
// before any such claim, and the script exists because a hand-rolled edit can miss its target and
// look exactly like a guard with no teeth. So its own refusals are checked here, and so is the one
// way it could still land somewhere else unnoticed: a replacement STRING is a pattern to
// `String.prototype.replace`, so `$'`, `$&`, `` $` `` and `$$` in it expanded (test audit, 7 Nov 2026
// — one mutation of the work-email regex in firestore.rules inserted 270 lines of rules text instead
// of the one-character change asked for). Part of test:hygiene.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MUTATE = fileURLToPath(new URL('./scripts/mutate.mjs', import.meta.url));

/** A scratch file holding `text`, removed however the test ends. */
function scratch(/** @type {any} */ t, /** @type {string} */ text) {
    const dir = mkdtempSync(join(tmpdir(), 'mutate-script-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const file = join(dir, 'target.txt');
    writeFileSync(file, text);
    return { dir, file };
}

/** Run mutate.mjs against `file`. The command it runs copies the file aside, so the test can read
 *  exactly what a real command would have seen while the mutation was applied. */
function run(/** @type {string} */ file, /** @type {string} */ seen, /** @type {string[]} */ ...opts) {
    const copy = `require('fs').copyFileSync(${JSON.stringify(file)}, ${JSON.stringify(seen)})`;
    return spawnSync(process.execPath, [MUTATE, '--file', file, ...opts, '--', process.execPath, '-e', copy],
        { encoding: 'utf8' });
}

test('the replacement is inserted exactly as written, $ sequences included, and the file is put back', (t) => {
    const { dir, file } = scratch(t, 'alpha X omega\n');
    const seen = join(dir, 'seen.txt');
    for (const replacement of ["$'", '$&', '$`', '$$', '$1']) {
        const r = run(file, seen, '--find', 'X', '--replace', replacement);
        assert.equal(r.status, 0, r.stderr);
        assert.equal(readFileSync(seen, 'utf8'), `alpha ${replacement} omega\n`,
            `the command must see ${JSON.stringify(replacement)} as written, not expanded as a replace pattern`);
        assert.equal(readFileSync(file, 'utf8'), 'alpha X omega\n', 'and the original is restored afterwards');
    }
});

test('it refuses an absent target, an ambiguous one and an edit that changes nothing — and runs nothing', (t) => {
    const { dir, file } = scratch(t, 'one two two\n');
    const seen = join(dir, 'seen.txt');
    for (const [find, replace, why] of [
        ['three', 'x', /NOT PRESENT/],
        ['two', 'x', /appears 2 times/],
        ['one', 'one', /changed nothing/],
    ]) {
        const r = run(file, seen, '--find', /** @type {string} */ (find), '--replace', /** @type {string} */ (replace));
        assert.equal(r.status, 2, `${find} → ${replace}: refused`);
        assert.match(r.stderr, /** @type {RegExp} */ (why));
        assert.equal(readFileSync(file, 'utf8'), 'one two two\n', 'a refusal leaves the file alone');
    }
    assert.throws(() => readFileSync(seen), /ENOENT/, 'no refusal may run the command it was given');
});
