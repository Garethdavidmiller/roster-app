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
// never a coin toss — `--in` narrows to one CSS rule or one function when a literal repeats.
//
// ── USE ────────────────────────────────────────────────────────────────────────────────────────
//
//   node scripts/mutate.mjs --file overtime.css \
//     --in '.ot-form-when--lead .ot-form-when-value {' \
//     --find 'font-size: var(--type-medium);' \
//     --replace '' \
//     -- npx playwright test e2e/overtime.spec.js --project=chromium -g 'names BOTH deadlines'
//
// It prints whether the command FAILED (the guard bit — what you want) or PASSED (it did not), and
// restores the file either way, including on a crash or a Ctrl-C.

import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

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
    // A CSS rule ends at its first `}`; anything else runs to the end of the file. Good enough to
    // disambiguate, and it fails loudly below if the region does not hold exactly one match.
    const close = original.indexOf('}', at);
    to = close === -1 ? original.length : close + 1;
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

const mutated = original.slice(0, from) + region.replace(find, replace) + original.slice(to);
if (mutated === original) {
    die('the edit changed nothing (find and replace are identical?)');
}

let restored = false;
const restore = () => {
    if (restored) return;
    restored = true;
    writeFileSync(file, original);
};
process.on('exit', restore);
process.on('SIGINT', () => { restore(); process.exit(130); });

writeFileSync(file, mutated);
console.log(`\n▸ mutated ${file} — ${JSON.stringify(find)} → ${JSON.stringify(replace)}`);
console.log(`▸ running: ${cmd.join(' ')}\n`);

const res = spawnSync(cmd[0], cmd.slice(1), { stdio: 'inherit', encoding: 'utf8' });
restore();

console.log('\n' + '─'.repeat(78));
if (res.status === 0) {
    console.log('✗ THE COMMAND PASSED with the line removed — this guard does NOT protect that line.');
    console.log('  Before weakening anything: check the mutation hit what you aimed at. Two of this');
    console.log('  repo\'s three "no teeth" findings were a mutation landing somewhere else.');
} else {
    console.log('✓ THE COMMAND FAILED, which is what you want — the guard has teeth.');
}
console.log(`${file} restored.\n`);
// This tool's own exit code reports whether it RAN, not what the mutation proved: a non-zero here
// would read as a broken check in any wrapper, and the interesting result is the line above.
process.exit(0);
