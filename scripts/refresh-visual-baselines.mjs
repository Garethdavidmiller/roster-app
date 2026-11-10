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
// This prints the baselines it changed BY NAME, and reminds you they are images that still want
// looking at. It deliberately does NOT commit: a regenerated baseline is a claim that the new pixels
// are correct, and only a person can make that claim.
//
// ── TWO SOURCES, AND ONLY ONE IS THE RENDER THE LANE COMPARES AGAINST (10 November 2026) ──────
//
// The committed baselines are CI's render. A container's differs even on the same browser build and
// Ubuntu — it breaks some lines of Inter a word differently (KNOWN_LIMITATIONS.md → "The Playwright
// upgrade — the baselines come from CI's render") — so a baseline drawn here fails on CI. This script
// used to draw them here and nothing else, while the lane's comment, README and CLAUDE.md said to take
// them from the pull request's `visual-diffs` artifact. So:
//
//   node scripts/refresh-visual-baselines.mjs <the unzipped artifact folder>
//       copies each failed screenshot's CI render (`<name>-actual.png`) over its baseline: from the
//       Chromium lane (`visual-diffs`) into e2e/visual-baselines/, from the WebKit lane
//       (`visual-diffs-webkit`) into e2e/visual-baselines/webkit/. Check the artifact's digest on the
//       run page before unzipping it.
//   npm run test:visual:refresh
//       with no folder, redraws the FAILED Chromium baselines from THIS machine's render: a way to see
//       a change locally, not what to commit where CI's render disagrees.

import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

const run = (/** @type {string} */ cmd, /** @type {string[]} */ args) =>
    spawnSync(cmd, args, { stdio: 'inherit', encoding: 'utf8' });

/** @param {string} msg */
function refuse(msg) {
    console.error(`\n✗ ${msg}\n  Nothing was written.\n`);
    process.exit(1);
}

/** Every file under `dir`. @param {string} dir @returns {string[]} */
const walk = (dir) => readdirSync(dir, { withFileTypes: true })
    .flatMap(e => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);

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

const artifact = process.argv[2];
/** @type {number} */
let runStatus = 0;
if (artifact) {
    // Which lane a render belongs to is the project name Playwright appends to its test's folder
    // (`<spec>-<title>-<project>`, then `-retryN`): `visual` is the Chromium lane, `mobile-safari`
    // the WebKit one. A render from anywhere else is refused rather than guessed at.
    const LANES = { visual: 'e2e/visual-baselines', 'mobile-safari': 'e2e/visual-baselines/webkit' };
    if (!existsSync(artifact)) refuse(`${artifact} does not exist — give the folder the artifact unzipped into.`);
    const actuals = walk(artifact).filter(f => f.endsWith('-actual.png'));
    if (!actuals.length) refuse(`no *-actual.png under ${artifact} — is it the UNZIPPED visual-diffs artifact of the run that flagged the drift?`);
    /** @type {Map<string, string>} baseline → the CI render that replaces it */
    const plan = new Map();
    for (const actual of actuals) {
        const folder = basename(dirname(actual)).replace(/-(retry|repeat)\d+$/, '');
        const lane = /** @type {keyof typeof LANES | undefined} */ (Object.keys(LANES).find(p => folder.endsWith(`-${p}`)));
        if (!lane) refuse(`${actual} is not from a visual lane (its folder names no visual project) — refusing to guess where it goes.`);
        const baseline = join(LANES[/** @type {keyof typeof LANES} */ (lane)], basename(actual).replace(/-actual\.png$/, '.png'));
        if (plan.has(baseline)) refuse(`the artifact holds two renders for ${baseline} — refusing to choose between them.`);
        plan.set(baseline, actual);
    }
    console.log(`\nCopying ${plan.size} CI render${plan.size === 1 ? '' : 's'} from ${artifact}…`);
    for (const [baseline, actual] of plan) copyFileSync(actual, baseline);
} else {
    console.log('\nRunning the visual lane, updating only the baselines that FAIL…');
    console.log('(This is THIS machine\'s render. For a pull request, pass its unzipped visual-diffs artifact.)\n');
    const res = run('npx', ['playwright', 'test', '--config=playwright.visual.mjs', '--update-snapshots']);
    if (res.error || res.status === null) {
        // Not "nothing had drifted": nothing was compared at all.
        console.error(`\n✗ The visual lane did not run (${res.error ? res.error.message : `killed by ${res.signal}`}).`);
        process.exit(1);
    }
    runStatus = res.status;
}

const after = changed();
console.log('\n' + '─'.repeat(78));
if (!after.length) {
    if (runStatus !== 0) {
        // A spec threw or the browser died: a real failure, and not drift. It is not "nothing drifted".
        console.log(`No baseline changed, and the run FAILED (exit ${runStatus}) for a reason other than drift — read the output above.`);
        process.exit(runStatus);
    }
    console.log('No baseline changed — nothing had drifted.');
    process.exit(0);
}
console.log(`${after.length} baseline${after.length === 1 ? '' : 's'} updated:\n`);
after.forEach(f => console.log(`    ${f}`));
if (runStatus !== 0) {
    console.log(`\nThe run itself FAILED as well (exit ${runStatus}): a spec threw or the browser died, so this list`);
    console.log('may be incomplete. Fix that and run again before trusting it.');
}
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
console.log('                              --update-snapshots=all -g "<the page>"');
console.log('(a local render: use it to SEE the drift, and commit CI\'s render of it.)\n');
process.exit(runStatus);
