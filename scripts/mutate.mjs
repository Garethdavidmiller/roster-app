#!/usr/bin/env node
// mutate.mjs — break one line on purpose, run a command, and put the file back.
//
// ── WHY THIS EXISTS ────────────────────────────────────────────────────────────────────────────
//
// CLAUDE.md asks for a mutation before any claim that a guard protects something: delete or invert
// the decisive line, re-run, and if nothing fails the rule is documented rather than protected.
// That discipline has one silent failure mode, and it bit twice in a single session (15 Sep 2026):
//
//   1. THE MUTATION DID NOT APPLY. The search string carried a trailing comment the source does not
//      have, so the edit was a no-op, the suite passed, and the reading was "this guard has no
//      teeth" — about a guard that was working perfectly.
//   2. THE MUTATION APPLIED SOMEWHERE ELSE. `font-size: var(--type-medium); font-weight: 700;
//      color: var(--text-dark);` appears three times in overtime.css. A replace-first hit the week
//      TITLE instead of the deadline it was aimed at, the test correctly passed, and the reading
//      was again "no teeth".
//
// Both produce the same output as a genuinely toothless guard — a green run — and both argue for
// WEAKENING a test that is fine. That is the worst possible direction for a mistake in this repo,
// because the response to "this is not protected" is to write a weaker assertion or delete one.
//
// So: this refuses to run the command unless the edit actually changed the file, and refuses
// outright when the target text is absent or appears more than once. Ambiguity is an error here,
// never a coin toss — `--in` narrows to one CSS rule, function or rules block when a literal repeats.
//
// The mirror image is as wrong, and this tool used to commit it itself: a command that fails for a
// reason of its OWN — a mistyped `-g` title ("No tests found"), a test file that does not exist, a
// browser that is not installed, a binary that is not there — was reported as "the guard has teeth".
// So the command now runs once on the UNCHANGED file first and must pass there, and a command that
// could not start or was killed is never a verdict (whole-app check, 10 November 2026).
//
// ── USE ────────────────────────────────────────────────────────────────────────────────────────
//
//   node scripts/mutate.mjs --file overtime.css \
//     --in '.ot-form-when--lead .ot-form-when-value {' \
//     --find 'font-size: var(--type-medium);' \
//     --replace '' \
//     -- npx playwright test e2e/overtime.spec.js --project=chromium -g 'names BOTH deadlines'
//
// It runs the command twice — unchanged, then mutated — and prints whether the MUTATED run FAILED
// (the guard bit — what you want) or PASSED (it did not). The file is put back however the run ends:
// normally, on a crash, on Ctrl-C, SIGTERM or SIGHUP, and — through a small detached watchdog — when
// the tool itself is killed outright. Until it is back, the original is also kept outside the tree,
// so a run that died with its watchdog is reported by the next one instead of being mutated twice.

import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, realpathSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir, constants } from 'node:os';
import { basename, extname, join } from 'node:path';

const argv = process.argv.slice(2);
const dashdash = argv.indexOf('--');
if (dashdash === -1) die('no command given — put it after `--`');
const opts = argv.slice(0, dashdash);
const cmd = argv.slice(dashdash + 1);
if (!cmd.length) die('no command given after `--`');

const opt = (name) => {
    const i = opts.indexOf(`--${name}`);
    return i === -1 ? null : opts[i + 1];
};

const file = opt('file');
const find = opt('find');
const replace = opt('replace') ?? '';
const within = opt('in');
if (!file) die('--file is required');
if (!find) die('--find is required');

/** @param {string} msg */
function die(msg) {
    console.error(`\n✗ ${msg}\n`);
    process.exit(2);
}

const original = readFileSync(file, 'utf8');

// Narrow to one region first, so a literal that repeats across the file can still be aimed.
let from = 0;
let to = original.length;
if (within) {
    const at = original.indexOf(within);
    if (at === -1) die(`--in text not found in ${file}: ${JSON.stringify(within)}`);
    if (original.indexOf(within, at + 1) !== -1) {
        die(`--in text appears more than once in ${file} — narrow it further`);
    }
    from = at;
    // The region is the BLOCK the anchor names, to its MATCHING `}` (blockEnd says which block). It
    // used to end at the first `}` of any kind, so a line after a nested `if { }` in a function, and
    // every line of a rules `match /x/{id} {` block (whose own `{id}` closed it), was out of reach.
    const close = blockEnd(original, at, within, syntaxOf(file));
    if (close === -1) {
        die(`the block --in names in ${file} never closes, as this tool reads its braces — `
          + 'aim with a different --in.');
    }
    to = close + 1;
}

const region = original.slice(from, to);
const hits = region.split(find).length - 1;
if (hits === 0) {
    die(`--find text is NOT PRESENT${within ? ' in that region' : ''} of ${file}.\n`
      + `  A mutation that cannot apply looks exactly like a guard with no teeth.\n`
      + `  Looked for: ${JSON.stringify(find)}`);
}
if (hits > 1) {
    die(`--find text appears ${hits} times${within ? ' in that region' : ''} of ${file}.\n`
      + `  Refusing to guess which one you meant — pass --in to narrow it.`);
}

// The replacement is INSERTED AS WRITTEN — passed as a function, because a replacement STRING is a
// pattern to `String.prototype.replace`: `$'`, `$&`, `` $` `` and `$$` in it expand. A mutation of
// the work-email regex in firestore.rules, whose text holds `$'`, inserted 270 lines of rules text
// instead of the one-character change asked for: a third way for the mutation to land somewhere
// else, silently, and the one this tool had no check for (test audit, 7 Nov 2026;
// mutate-script.test.mjs).
const mutated = original.slice(0, from) + region.replace(find, () => replace) + original.slice(to);
if (mutated === original) {
    die('the edit changed nothing (find and replace are identical?)');
}
const lineOf = (/** @type {number} */ i) => original.slice(0, i).split('\n').length;
const where = `${file}:${lineOf(from + region.indexOf(find))}`
    + (within ? ` (in the block at lines ${lineOf(from)}–${lineOf(to - 1)})` : '');

// ── THE ORIGINAL, KEPT OUTSIDE THE TREE WHILE THE FILE IS MUTATED ──────────────────────────────
// Not beside the file: a stray file in the tree can itself fail the command (a suite that lists the
// directory), which would read as teeth. A backup still here when a run starts means an earlier run
// never put its file back, so this one refuses rather than treat the mutated text as the original.
const target = realpathSync(file);
const backupDir = join(tmpdir(), 'mutate-mjs');
const backup = join(backupDir,
    `${basename(target)}.${createHash('sha256').update(target).digest('hex').slice(0, 16)}.orig`);
if (existsSync(backup)) {
    if (readFileSync(backup, 'utf8') === original) {
        unlinkSync(backup);   // the file is already back; the backup is all that was left over
    } else {
        die(`${file} may still hold an earlier mutation — a run that never finished left its backup:\n`
          + `    ${backup}\n`
          + '  That run is still going, or it was killed before it could put the file back. If none is\n'
          + `  running, compare the two, restore with  cp '${backup}' '${file}'  (or discard your copy\n`
          + '  with git checkout), delete the backup, and re-run.');
    }
}

/** @type {'clean' | 'mutated' | 'restored'} */
let state = 'clean';
/** @type {import('node:child_process').ChildProcess | null} */
let watchdog = null;
/** Put the original back — once, and only if this run changed the file. @returns {boolean} */
const restore = () => {
    if (state !== 'mutated') return false;
    writeFileSync(file, original);
    state = 'restored';
    try { unlinkSync(backup); } catch { /* already gone */ }
    // Its only job is a restore this run has now done itself. Left polling, it could act on the NEXT
    // run of the same file — the same mutated text and a backup at the same path look like its own.
    try { watchdog?.kill(); } catch { /* already gone */ }
    return true;
};
process.on('exit', restore);

/** @type {import('node:child_process').ChildProcess | null} */
let running = null;
// A handler, not Node's default: the default for these three is to die AT ONCE, which skipped the
// restore and left the deliberately broken line in the working tree, silently (SIGTERM is what a
// command runner's timeout sends). The command is stopped too, rather than left running unwatched.
for (const sig of /** @type {const} */ (['SIGINT', 'SIGTERM', 'SIGHUP'])) {
    process.on(sig, () => {
        if (running) { try { running.kill(sig); } catch { /* already gone */ } }
        const wasMutated = restore();
        console.error(`\n✗ ${sig} — stopped with no verdict; `
            + `${wasMutated ? `${file} restored` : `${file} was not changed`}.\n`);
        process.exit(128 + (constants.signals[sig] ?? 0));
    });
}

console.log(`\n▸ 1 of 2 — the command on the UNCHANGED file; it must pass, or a later failure proves nothing.`);
console.log(`▸ running: ${cmd.join(' ')}\n`);
const before = await runCommand();
if (before.error || before.signal || before.status !== 0) {
    die(`the command ${how(before)} on the UNCHANGED file, so a failure with the mutation would prove\n`
      + '  nothing about the guard. Make it pass first (a mistyped -g title, a missing test file, a\n'
      + `  browser that is not installed) and re-run. ${file} was not touched.`);
}
if (readFileSync(file, 'utf8') !== original) {
    die(`${file} changed while the command ran — refusing to mutate a file that is moving.`);
}

mkdirSync(backupDir, { recursive: true });
writeFileSync(backup, original);
watchdog = startWatchdog();
state = 'mutated';   // before the write: a crash part-way through it must still restore
writeFileSync(file, mutated);
console.log(`\n▸ 2 of 2 — mutated ${where} — ${JSON.stringify(find)} → ${JSON.stringify(replace)}`);
console.log(`▸ until it is put back, the original is also at ${backup}`);
console.log(`▸ running: ${cmd.join(' ')}\n`);

const after = await runCommand();
restore();

console.log('\n' + '─'.repeat(78));
if (after.error || after.signal) {
    die(`NO VERDICT — the command ${how(after)} on the mutated file, so it said nothing about the\n`
      + `  guard. ${file} restored.`);
}
if (after.status === 0) {
    console.log('✗ THE COMMAND PASSED with the line removed — this guard does NOT protect that line.');
    console.log('  Before weakening anything: check the mutation hit what you aimed at. Two of this');
    console.log('  repo\'s three "no teeth" findings were a mutation landing somewhere else.');
} else {
    console.log('✓ THE COMMAND FAILED, which is what you want — the guard has teeth.');
}
console.log(`${file} restored.\n`);
// This tool's own exit code reports whether it RAN, not what the mutation proved: a non-zero here
// would read as a broken check in any wrapper, and the interesting result is the line above. A run
// that gave no verdict — refused, never started, killed — exits non-zero for the same reason.
process.exit(0);

/**
 * Run the command with this terminal; resolve with how it ended. Never rejects: a command that
 * could not START (ENOENT) is reported as `error`, never as a failing exit status.
 * @returns {Promise<{ error?: Error & { code?: string }, status?: number | null, signal?: string | null }>}
 */
function runCommand() {
    return new Promise((resolve) => {
        try {
            running = spawn(cmd[0], cmd.slice(1), { stdio: 'inherit' });
        } catch (error) {
            resolve({ error: /** @type {Error} */ (error) });
            return;
        }
        running.once('error', (error) => resolve({ error }));
        running.once('exit', (status, signal) => resolve({ status, signal }));
    }).finally(() => { running = null; });
}

/** @param {{ error?: Error & { code?: string }, status?: number | null, signal?: string | null }} r */
function how(r) {
    if (r.error) return `could not be started (${r.error.code || r.error.message})`;
    if (r.signal) return `was killed by ${r.signal} before it finished`;
    return `exited ${r.status}`;
}

/**
 * SIGKILL cannot be handled — a runner's last resort when SIGTERM is not enough, or a whole process
 * group killed at once. A detached process in its own group outlives that, and when this one is
 * gone it puts the original back: only if the backup is still there (nothing restored it) and the
 * file still holds exactly the mutated text (nothing has edited it since). This run stops it once it
 * has restored the file itself.
 * @returns {import('node:child_process').ChildProcess | null}
 */
function startWatchdog() {
    const source = `
const fs = require('fs'), crypto = require('crypto');
const [parent, file, backup, mutatedHash] = process.argv.slice(1);
const alive = () => { try { process.kill(Number(parent), 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const timer = setInterval(() => {
    if (alive()) return;
    clearInterval(timer);
    try {
        if (!fs.existsSync(backup)) return;
        if (crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== mutatedHash) return;
        fs.writeFileSync(file, fs.readFileSync(backup));
        fs.unlinkSync(backup);
    } catch { /* the backup stays, and the next run reports it */ }
}, 100);`;
    const mutatedHash = createHash('sha256').update(mutated).digest('hex');
    try {
        const child = spawn(process.execPath, ['-e', source, String(process.pid), target, backup, mutatedHash],
            { detached: true, stdio: 'ignore' });
        child.on('error', () => { /* the backup alone still makes a missed restore visible */ });
        child.unref();
        return child;
    } catch {
        return null;   // the backup alone still makes a missed restore visible to the next run
    }
}

/**
 * Which comments and strings a file has, by extension — so a brace inside one is not counted. CSS,
 * HTML and JSON have no `//` comment (`url(//host)` is not one); only JavaScript has regex literals.
 * @param {string} path
 */
function syntaxOf(path) {
    const ext = extname(path).toLowerCase();
    const js = ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx'].includes(ext);
    return { lineComments: js || ext === '.rules', templates: js, regexes: js };
}

/**
 * Where the region `--in` names ends. An anchor that OPENS a block — it leaves a `{` open
 * (`match /x/{id} {`, `} else {`), or a `{` directly follows it (`.rule`, `function f(a)`) — names
 * that block, to its matching `}`. Any other anchor sits INSIDE a block, and names the rest of it,
 * nested blocks included (at the top level of a file, the rest of the file). Returns the index of
 * the closing `}`, the last index of the file for the rest-of-file case, or -1 when the block the
 * anchor opens never closes.
 * @param {string} text @param {number} at @param {string} anchor @param {ReturnType<typeof syntaxOf>} syntax
 */
function blockEnd(text, at, anchor, syntax) {
    let open = 0;
    for (const [, ch] of braces(anchor, 0, syntax)) {
        if (ch === '{') open++;
        else if (open > 0) open--;   // a `}` closing something before the anchor is not its own
    }
    let start = at + anchor.length;
    let depth = open > 0 ? 1 : 0;   // only the innermost brace the anchor leaves open matters
    if (!depth) {
        const lead = /^\s*\{/.exec(text.slice(start));
        if (lead) { depth = 1; start += lead[0].length; }
    }
    const inside = depth === 0;
    for (const [i, ch] of braces(text, start, syntax)) {
        if (ch === '{') { depth++; continue; }
        if (depth === 0) return i;   // `inside` only: the block the anchor sits in closes here
        depth--;
        if (depth === 0 && !inside) return i;
    }
    return inside ? text.length - 1 : -1;
}

/**
 * Every `{` and `}` from `start` on that is CODE: not inside a comment, a string, a template literal
 * (nor its `${ }`, whose braces balance among themselves) or a regex literal. A quote that is never
 * closed ends at its line, so a stray apostrophe swallows one line, never the rest of the file.
 * @param {string} text @param {number} start @param {ReturnType<typeof syntaxOf>} syntax
 * @returns {Generator<[number, string]>}
 */
function* braces(text, start, syntax) {
    // 'template' while inside `…`; inside one of its ${ }, the count of braces opened there. A
    // template nested in a ${ } is the common case in this repo's HTML builders, so it is a stack.
    /** @type {Array<'template' | number>} */
    const stack = [];
    let i = start;
    while (i < text.length) {
        const c = text[i];
        const n = text[i + 1];
        const top = stack[stack.length - 1];
        if (top === 'template') {
            if (c === '\\') i += 2;
            else if (c === '`') { stack.pop(); i++; }
            else if (c === '$' && n === '{') { stack.push(0); i += 2; }
            else i++;
            continue;
        }
        if (c === '/' && n === '*') { const e = text.indexOf('*/', i + 2); i = e === -1 ? text.length : e + 2; continue; }
        if (c === '/' && n === '/' && syntax.lineComments) { const e = text.indexOf('\n', i); i = e === -1 ? text.length : e + 1; continue; }
        if (c === '"' || c === "'") { i = stringEnd(text, i); continue; }
        if (c === '`' && syntax.templates) { stack.push('template'); i++; continue; }
        if (c === '/' && syntax.regexes && regexCanStart(text, i)) {
            const e = regexEnd(text, i);
            if (e !== -1) { i = e; continue; }
        }
        if (c === '{' || c === '}') {
            if (typeof top !== 'number') yield [i, c];
            else if (c === '{') stack[stack.length - 1] = top + 1;
            else if (top === 0) stack.pop();   // the `}` that closes the ${
            else stack[stack.length - 1] = top - 1;
        }
        i++;
    }
}

/** Index just past the string opening at `i` (a quote that never closes stops at its line's end). */
function stringEnd(/** @type {string} */ text, /** @type {number} */ i) {
    const quote = text[i];
    for (let j = i + 1; j < text.length; j++) {
        if (text[j] === '\\') { j++; continue; }
        if (text[j] === quote) return j + 1;
        if (text[j] === '\n') return j;
    }
    return text.length;
}

/** Whether a `/` at `i` begins a regex literal rather than dividing: decided by what precedes it. */
function regexCanStart(/** @type {string} */ text, /** @type {number} */ i) {
    let j = i - 1;
    while (j >= 0 && /\s/.test(text[j])) j--;
    if (j < 0) return true;
    if ('(,=:[!&|?{};+-*%<>~^'.includes(text[j])) return true;
    const word = /[A-Za-z_$]+$/.exec(text.slice(Math.max(0, j - 11), j + 1));
    return !!word && /^(return|typeof|case|do|else|in|of|new|delete|void|throw|instanceof|yield|await)$/.test(word[0]);
}

/** Index just past the regex literal opening at `i`, or -1 when it is not one (it meets a line end). */
function regexEnd(/** @type {string} */ text, /** @type {number} */ i) {
    let inClass = false;
    for (let j = i + 1; j < text.length; j++) {
        const c = text[j];
        if (c === '\\') { j++; continue; }
        if (c === '\n') return -1;
        if (inClass) { if (c === ']') inClass = false; continue; }
        if (c === '[') { inClass = true; continue; }
        if (c === '/') {
            let k = j + 1;
            while (k < text.length && /[a-z]/i.test(text[k])) k++;
            return k;
        }
    }
    return -1;
}
