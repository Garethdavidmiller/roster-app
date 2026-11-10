// mutate-script.test.mjs — scripts/mutate.mjs, tested by running it.
//
// Every "this guard has teeth" claim in the repo rests on that script: CLAUDE.md asks for a mutation
// before any such claim, and the script exists because a hand-rolled edit can miss its target and
// look exactly like a guard with no teeth. So its own refusals are checked here, and so is the one
// way it could still land somewhere else unnoticed: a replacement STRING is a pattern to
// `String.prototype.replace`, so `$'`, `$&`, `` $` `` and `$$` in it expanded (test audit, 7 Nov 2026
// — one mutation of the work-email regex in firestore.rules inserted 270 lines of rules text instead
// of the one-character change asked for). Part of test:hygiene.
//
// The whole-app check of 10 November 2026 added three more: a command that never RAN (not
// installed, no such test, no test matching the title) was reported as "the guard has teeth"; a
// SIGTERM or SIGHUP left the broken line in the working tree; and `--in` ended its region at the
// first `}`, so it could not aim past a nested block or into a rules `match /x/{id} {` block.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MUTATE = fileURLToPath(new URL('./scripts/mutate.mjs', import.meta.url));

/** A scratch file holding `text`, removed however the test ends. */
function scratch(/** @type {any} */ t, /** @type {string} */ text, name = 'target.txt') {
    const dir = mkdtempSync(join(tmpdir(), 'mutate-script-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const file = join(dir, name);
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

/** A `node -e` command in which `fs`, the target's path `f` and its current text `t` are in scope. */
const nodeCmd = (/** @type {string} */ file, /** @type {string} */ body) => [process.execPath, '-e',
    `const fs = require('fs'); const f = ${JSON.stringify(file)}; const t = fs.readFileSync(f, 'utf8'); ${body}`];

/** Run mutate.mjs on `file` (X → Y) with any command. */
const runCmd = (/** @type {string} */ file, /** @type {string[]} */ command) =>
    spawnSync(process.execPath, [MUTATE, '--file', file, '--find', 'X', '--replace', 'Y', '--', ...command],
        { encoding: 'utf8' });

/** The path a run says it keeps the original at while the file is mutated. */
const backupOf = (/** @type {string} */ stdout) => (stdout.match(/the original is also at (.+)$/m) || [])[1];

/** Poll `check` until it is true or `ms` pass; resolves with its last answer. */
async function until(/** @type {() => any} */ check, ms = 10_000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        if (check()) return true;
        await new Promise(r => setTimeout(r, 25));
    }
    return !!check();
}

/** The pid a command wrote, or null — never 0, which `process.kill` reads as the whole group. */
function pidIn(/** @type {string} */ f) {
    try { const n = Number(readFileSync(f, 'utf8')); return n > 0 ? n : null; } catch { return null; }
}

describe('a verdict only from a command that RAN', () => {
    test('a command that cannot start is refused, never read as "the guard has teeth"', (t) => {
        const { file } = scratch(t, 'alpha X omega\n');
        const r = runCmd(file, ['definitely-not-a-command-mutate-script']);
        assert.equal(r.status, 2, r.stdout + r.stderr);
        assert.match(r.stderr, /could not be started/);
        assert.doesNotMatch(r.stdout, /THE COMMAND (FAILED|PASSED)/, 'no verdict may be printed');
        assert.equal(readFileSync(file, 'utf8'), 'alpha X omega\n');
    });

    test('a command that fails on the UNCHANGED file is refused, and never sees the mutation', (t) => {
        // "No tests found" for a mistyped -g title is this shape: it fails mutated or not.
        const { dir, file } = scratch(t, 'alpha X omega\n');
        const seen = join(dir, 'seen.txt');
        const r = runCmd(file, nodeCmd(file, `fs.appendFileSync(${JSON.stringify(seen)}, t); process.exit(3);`));
        assert.equal(r.status, 2, r.stdout + r.stderr);
        assert.match(r.stderr, /exited 3 on the UNCHANGED file/);
        assert.doesNotMatch(r.stdout, /THE COMMAND (FAILED|PASSED)/);
        assert.equal(readFileSync(seen, 'utf8'), 'alpha X omega\n', 'it ran once, on the unchanged file only');
        assert.equal(readFileSync(file, 'utf8'), 'alpha X omega\n');
    });

    test('a command killed on the mutated file gives NO verdict, and the file is put back', (t) => {
        const { file } = scratch(t, 'alpha X omega\n');
        const r = runCmd(file, nodeCmd(file, "if (t.includes('Y')) process.kill(process.pid, 'SIGKILL');"));
        assert.equal(r.status, 2, r.stdout + r.stderr);
        assert.match(r.stderr, /NO VERDICT[\s\S]*SIGKILL/);
        assert.doesNotMatch(r.stdout, /THE COMMAND (FAILED|PASSED)/);
        assert.equal(readFileSync(file, 'utf8'), 'alpha X omega\n');
    });

    test('a command that rewrites the file is refused before anything is mutated', (t) => {
        // Restoring the text read BEFORE that run would silently undo what the command wrote.
        const { file } = scratch(t, 'alpha X omega\n');
        const r = runCmd(file, nodeCmd(file, "fs.writeFileSync(f, t + 'appended\\n');"));
        assert.equal(r.status, 2, r.stdout + r.stderr);
        assert.match(r.stderr, /changed while the command ran/);
        assert.equal(readFileSync(file, 'utf8'), 'alpha X omega\nappended\n', 'what the command wrote is kept');
    });

    test('and the two real verdicts still come out', (t) => {
        const { file } = scratch(t, 'alpha X omega\n');
        const bit = runCmd(file, nodeCmd(file, "process.exit(t.includes('Y') ? 1 : 0);"));
        assert.equal(bit.status, 0, bit.stderr);
        assert.match(bit.stdout, /THE COMMAND FAILED/);
        const toothless = runCmd(file, nodeCmd(file, ''));
        assert.equal(toothless.status, 0, toothless.stderr);
        assert.match(toothless.stdout, /THE COMMAND PASSED/);
        assert.equal(readFileSync(file, 'utf8'), 'alpha X omega\n');
    });
});

describe('the file is put back however the run ends', () => {
    /**
     * Start the tool on a command that passes on the unchanged file and WAITS on the mutated one,
     * writing down any signal it is sent. Its pid is taken as soon as it is known: the scratch
     * folder may be gone by cleanup time, and a command left running holds the tool's stdout open.
     */
    async function startWaiting(/** @type {any} */ t) {
        const { dir, file } = scratch(t, 'alpha X omega\n');
        const pidFile = join(dir, 'pid.txt');
        const stopped = join(dir, 'stopped.txt');
        const tool = spawn(process.execPath, [MUTATE, '--file', file, '--find', 'X', '--replace', 'Y', '--',
            ...nodeCmd(file, "if (!t.includes('Y')) process.exit(0); "
                + "for (const s of ['SIGTERM', 'SIGHUP', 'SIGINT']) process.on(s, () => { "
                + `fs.writeFileSync(${JSON.stringify(stopped)}, s); process.exit(0); }); `
                + `fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setTimeout(() => {}, 20000);`)],
        { stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '';
        tool.stdout.on('data', (b) => { out += b; });
        /** @type {Promise<number | null>} */
        const exited = new Promise(r => tool.on('exit', (c) => r(c)));
        /** @type {number | null} */
        let child = null;
        t.after(() => {
            tool.kill('SIGKILL');
            if (child) try { process.kill(child, 'SIGKILL'); } catch { /* already gone */ }
            const backup = backupOf(out);   // only left when a broken tool failed this test
            if (backup) rmSync(backup, { force: true });
        });
        assert.ok(await until(() => (child = pidIn(pidFile))), 'the mutated run never started');
        assert.equal(readFileSync(file, 'utf8'), 'alpha Y omega\n', 'the command is running on the mutation');
        return { file, tool, exited, backup: () => backupOf(out),
            stoppedBy: () => (existsSync(stopped) ? readFileSync(stopped, 'utf8') : null) };
    }

    for (const [sig, code] of /** @type {const} */ ([['SIGTERM', 143], ['SIGHUP', 129], ['SIGINT', 130]])) {
        test(`${sig}: restored at once, the backup cleared and the command stopped`, async (t) => {
            const run = await startWaiting(t);
            run.tool.kill(sig);
            assert.equal(await run.exited, code, `${sig} ends the tool with 128 + its number`);
            assert.equal(readFileSync(run.file, 'utf8'), 'alpha X omega\n',
                `${sig} left the deliberately broken line in the file`);
            const backup = run.backup();
            assert.ok(backup && !existsSync(backup), 'the backup is named while it exists and cleared after');
            assert.ok(await until(() => run.stoppedBy() === sig), 'the command was left running, unwatched');
        });
    }

    test('SIGKILL, which no handler can catch: the watchdog puts the file back', async (t) => {
        const run = await startWaiting(t);
        run.tool.kill('SIGKILL');
        await run.exited;
        assert.ok(await until(() => readFileSync(run.file, 'utf8') === 'alpha X omega\n'),
            'nothing restored the file after the tool was killed outright');
        const backup = run.backup();
        assert.ok(backup && await until(() => !existsSync(backup)), 'and the backup was cleared');
    });

    test('a run that put its file back stops its watchdog — it cannot act on the NEXT run', async (t) => {
        // Left polling, the watchdog of a finished run sees a later run of the same file — same
        // mutated text, backup at the same path — as its own unfinished one, and restores the file
        // under that run's command, which then reports on the unmutated file.
        const { dir, file } = scratch(t, 'alpha X omega\n');
        const first = run(file, join(dir, 'seen.txt'), '--find', 'X', '--replace', 'Y');
        const backup = backupOf(first.stdout);
        assert.ok(first.status === 0 && backup);
        t.after(() => rmSync(backup, { force: true }));
        writeFileSync(file, 'alpha Y omega\n');   // what a second run's mutated phase looks like on disk
        writeFileSync(backup, 'alpha X omega\n');
        await new Promise(r => setTimeout(r, 500));   // five of the watchdog's polls
        assert.equal(readFileSync(file, 'utf8'), 'alpha Y omega\n', 'a finished run\'s watchdog rewrote the file');
        assert.ok(existsSync(backup), 'and took a backup that was not its own');
    });

    test('a backup left by a run that never finished: the next run refuses and says where it is', (t) => {
        const { dir, file } = scratch(t, 'alpha X omega\n');
        const seen = join(dir, 'seen.txt');
        // X → W here, so nothing this first run left behind could take the state planted below for its own.
        const first = run(file, seen, '--find', 'X', '--replace', 'W');
        const backup = backupOf(first.stdout);
        assert.ok(first.status === 0 && backup && !existsSync(backup), 'an ordinary run names its backup and clears it');
        t.after(() => rmSync(backup, { force: true }));
        rmSync(seen);

        // As if the machine died mid-run: the file holds the mutation, the backup the original.
        writeFileSync(file, 'alpha Y omega\n');
        writeFileSync(backup, 'alpha X omega\n');
        const r = run(file, seen, '--find', 'Y', '--replace', 'Z');
        assert.equal(r.status, 2, r.stdout + r.stderr);
        assert.match(r.stderr, /never finished/);
        assert.ok(r.stderr.includes(backup), 'the refusal names the backup');
        assert.equal(readFileSync(file, 'utf8'), 'alpha Y omega\n', 'and does not treat the mutated text as the original');
        assert.throws(() => readFileSync(seen), /ENOENT/, 'and runs nothing');
    });

    test('…but a backup that matches the file is only a leftover, and is cleared', (t) => {
        const { dir, file } = scratch(t, 'alpha X omega\n');
        const seen = join(dir, 'seen.txt');
        const backup = backupOf(run(file, seen, '--find', 'X', '--replace', 'Y').stdout);
        assert.ok(backup);
        t.after(() => rmSync(backup, { force: true }));
        writeFileSync(backup, 'alpha X omega\n');   // the file was put back; only the backup was left
        const r = run(file, seen, '--find', 'X', '--replace', 'Y');
        assert.equal(r.status, 0, r.stderr);
        assert.ok(!existsSync(backup));
    });
});

describe('--in aims at the whole block it names', () => {
    /** Mutate `text` (a file called `name`) and return what the command saw. */
    function aim(/** @type {any} */ t, /** @type {string} */ name, /** @type {string} */ text, /** @type {string[]} */ opts) {
        const { dir, file } = scratch(t, text, name);
        const seen = join(dir, 'seen.txt');
        const r = run(file, seen, ...opts);
        assert.equal(readFileSync(file, 'utf8'), text, 'the file is put back');
        return { r, seen: r.status === 0 ? readFileSync(seen, 'utf8') : null };
    }

    test('a function: a line AFTER a nested block can be aimed at', (t) => {
        const fn = (/** @type {string} */ ret) => 'function first(a) {\n    return a;\n}\n'
            + `function second(a) {\n    if (a) {\n        a += 1;\n    }\n    ${ret}\n}\n`;
        const { r, seen } = aim(t, 'mod.js', fn('return a;'), ['--in', 'function second(a) {', '--find', 'return a;', '--replace', 'return 0;']);
        assert.equal(r.status, 0, r.stderr);
        assert.equal(seen, fn('return 0;'), 'the second function\'s return, not the first\'s');
        assert.match(r.stdout, /mod\.js:8 \(in the block at lines 4–9\)/, 'and it says where it landed');
    });

    test('a rules block whose own path holds {docId}', (t) => {
        const rules = (/** @type {string} */ last) => 'match /a/{docId} {\n  allow read: if isAdmin();\n}\n'
            + `match /huddles/{docId} {\n  ${last}\n}\n`;
        const { r, seen } = aim(t, 'firestore.rules', rules('allow read: if isAdmin();'),
            ['--in', 'match /huddles/{docId} {', '--find', 'allow read: if isAdmin();', '--replace', 'allow read: if true;']);
        assert.equal(r.status, 0, r.stderr);
        assert.equal(seen, rules('allow read: if true;'));
    });

    test('an anchor written without its `{` still names the block that follows it', (t) => {
        const css = '.a {\n  color: red;\n}\n.b {\n  color: red;\n}\n';
        const { r, seen } = aim(t, 'page.css', css, ['--in', '.a', '--find', 'color: red;', '--replace', 'color: blue;']);
        assert.equal(r.status, 0, r.stderr);
        assert.equal(seen, css.replace('color: red;', 'color: blue;'));
    });

    test('an anchor inside a block reaches the end of that block, nested blocks and all', (t) => {
        const text = 'match /a/{x} {\n  allow read: if a();\n  match /n/{y} {\n  }\n  allow write: if b();\n}\n'
            + 'match /b/{z} {\n  allow write: if b();\n}\n';
        const { r, seen } = aim(t, 'firestore.rules', text,
            ['--in', 'allow read: if a();', '--find', 'allow write: if b();', '--replace', 'allow write: if true;']);
        assert.equal(r.status, 0, r.stderr);
        assert.equal(seen, text.replace('allow write: if b();', 'allow write: if true;'), 'the first block\'s, not the second\'s');
    });

    test('a brace inside a string or a comment does not end the block', (t) => {
        const text = "function f() {\n  const s = '}';\n  // a stray } in a comment\n  return s;\n}\nfunction g() {\n  return s;\n}\n";
        const { r, seen } = aim(t, 'mod.js', text, ['--in', 'function f() {', '--find', 'return s;', '--replace', 'return 0;']);
        assert.equal(r.status, 0, r.stderr);
        assert.equal(seen, text.replace('return s;', 'return 0;'));
    });

    test('a template literal is skipped whole, a template nested in its ${ } included', (t) => {
        // The shape of this repo's HTML builders (admin-saved-changes.js). Reading a template as
        // running to the NEXT backtick ended it at the nested one, and the HTML after was read as code.
        const text = 'function f(o) {\n  const h = `<b>${o ? `<i>${o}</i>` : \'\'}</b> }`;\n  return h;\n}\n'
            + 'function g() {\n  return h;\n}\n';
        const { r, seen } = aim(t, 'mod.js', text, ['--in', 'function f(o) {', '--find', 'return h;', '--replace', 'return 0;']);
        assert.equal(r.status, 0, r.stderr);
        assert.equal(seen, text.replace('return h;', 'return 0;'));
    });

    test('nor does a brace inside a regex literal open one', (t) => {
        const text = 'function f() {\n  const re = /\\{/;\n  return re;\n}\nfunction g() {\n  return re;\n}\n';
        const { r, seen } = aim(t, 'mod.js', text, ['--in', 'function f() {', '--find', 'return re;', '--replace', 'return 0;']);
        assert.equal(r.status, 0, r.stderr);
        assert.equal(seen, text.replace('return re;', 'return 0;'));
    });

    test('in CSS `//` is not a comment, so `url(//host)` does not hide the rule\'s end', (t) => {
        const text = '.a { background: url(//cdn.example/p.png); color: red; }\n.b { color: red; }\n';
        const { r, seen } = aim(t, 'page.css', text, ['--in', '.a {', '--find', 'color: red;', '--replace', 'color: blue;']);
        assert.equal(r.status, 0, r.stderr);
        assert.equal(seen, text.replace('color: red;', 'color: blue;'));
    });

    test('a block that never closes is refused, not guessed at', (t) => {
        const { r } = aim(t, 'mod.js', 'function f() {\n  if (x) {\n    y();\n', ['--in', 'function f() {', '--find', 'y();', '--replace', '']);
        assert.equal(r.status, 2);
        assert.match(r.stderr, /never closes/);
    });
});
