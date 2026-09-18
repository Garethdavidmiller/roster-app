#!/usr/bin/env node
// refresh-visual-baselines.mjs — update ONLY the visual baselines that actually failed, and say which.
//
// ── WHY THIS EXISTS ────────────────────────────────────────────────────────────────────────────
//
// The `visual` lane reports drift on a pull request and never gates, which is right: pixel diffs are
// environment-sensitive. The problem was the REMEDY it printed — `npm run test:visual --
// --update-snapshots=all`, then read `git status` and revert anything you cannot explain.
//
// On 14 Sep 2026 that rewrote **21 baselines for ONE real change**. The other twenty were
// sub-tolerance rendering noise on pages the change could not reach, and the only thing standing
// between them and the commit was somebody reasoning correctly about which surfaces their diff could
// possibly touch. Get that wrong — or skip it, which is the likelier failure — and twenty unreviewed
// baselines land under cover of one reviewed one. The repo has a note saying this already happened
// once, at v19.62.
//
// A BARE `--update-snapshots` rewrites only the baselines whose comparison FAILED. When you have
// changed a page and the lane has flagged it, that is exactly the set you want, and it needs no
// revert step and no judgement: 3 files instead of 21, in the run that produced this script.
//
// `=all` still earns its place, in the narrower case its own warning describes — a baseline that
// drifted INSIDE the tolerance still passes, so a bare update can never refresh it. That is a
// deliberate sweep, not the everyday "I changed a page" case, and it is the wrong default for it.
//
// This does one run, prints the baselines it changed BY NAME, and reminds you they are images that
// still want looking at. It deliberately does NOT commit: a regenerated baseline is a claim that the
// new pixels are correct, and only a person can make that claim.

import { execFileSync, spawnSync } from 'node:child_process';

const run = (/** @type {string} */ cmd, /** @type {string[]} */ args) =>
    spawnSync(cmd, args, { stdio: 'inherit', encoding: 'utf8' });

/** Baselines that differ from HEAD right now, as repo-relative paths. */
const changed = () =>
    execFileSync('git', ['status', '--porcelain', '--', 'e2e/visual-baselines/'], { encoding: 'utf8' })
        .split('\n').map(l => l.slice(3).trim()).filter(Boolean);

const before = changed();
if (before.length) {
    console.error('\n⚠ e2e/visual-baselines/ already has uncommitted changes:');
    before.forEach(f => console.error(`    ${f}`));
    console.error('\n  Commit or discard them first — otherwise this cannot tell you what IT changed,\n'
                + '  which is the one thing it is for.\n');
    process.exit(1);
}

console.log('\nRunning the visual lane, updating only the baselines that FAIL…\n');
const res = run('npx', ['playwright', 'test', '--config=playwright.visual.mjs', '--update-snapshots']);

const after = changed();
console.log('\n' + '─'.repeat(78));
if (!after.length) {
    console.log('No baseline changed — nothing had drifted.');
    // A non-zero exit here is a real failure (a spec threw, the browser died), not drift.
    process.exit(res.status === 0 ? 0 : res.status ?? 1);
}
console.log(`${after.length} baseline${after.length === 1 ? '' : 's'} updated:\n`);
after.forEach(f => console.log(`    ${f}`));
console.log('\nEach one is a claim that the new pixels are RIGHT. Open them before committing —');
console.log('a baseline is the only test in the repo that cannot tell you what it is asserting.\n');
// AND SAY WHAT THIS RUN COULD NOT SEE. Updating only the FAILED baselines is the right default
// (the header argues it), but it makes this list silently incomplete for a change that stayed
// inside the tolerance — measured at v23.82, where a control moved 240px, the comparison passed,
// and two of the release's three stale baselines were never named here. Somebody who has just
// changed a layout needs to know that before they read this list as the whole answer.
console.log('Changed WHERE something sits rather than what it says? A small element can move a long');
console.log('way and still pass the ratio, and this run updates only the baselines that FAILED.');
console.log('Re-check those pages with:  npx playwright test --config=playwright.visual.mjs \\');
console.log('                              --update-snapshots=all -g "<the page>"\n');
process.exit(0);
