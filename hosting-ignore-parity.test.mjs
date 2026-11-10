// @ts-check
/**
 * hosting-ignore-parity.test.mjs — TOOLING IS NOT PART OF THE SERVED APP, and the pattern
 * everybody assumed enforced that did not.
 *
 * ── THE MEASUREMENT (8 Sep 2026) ────────────────────────────────────────────────────────────────
 *
 * `firebase.json`'s ignore list has carried `**\/.*` since the beginning, and it reads like "no
 * dot-files or dot-directories". It is half that. A glob `*` does not cross a `/`, so the pattern
 * matches the dot-ENTRY and never the contents beneath it. Fetched from the live site:
 *
 *     .nojekyll                             404   ← dot-FILE, correctly excluded
 *     .claude/rules/paycalc.md              404   ← but only because of `**\/*.md`
 *     .claude/settings.json                 200   ← SERVED
 *     .claude/hooks/session-start.sh        200   ← SERVED
 *     .github/workflows/deploy-hosting.yml  200   ← SERVED
 *
 * Nothing secret was exposed: the repository is public, and the A2 migration to Workload Identity
 * Federation left no key in the workflows to leak. What was wrong is intent — files nobody meant to
 * publish were being served from the staff app's own domain, which is where a reader assumes
 * everything is deliberate. The two directories are now listed EXPLICITLY.
 *
 * ── WHY EXPLICIT PATHS AND NOT A CLEVERER GLOB ──────────────────────────────────────────────────
 *
 * A dot-directory pattern (`**\/.*\/**` and friends) would generalise, and generalising is exactly
 * what failed here. `**\/.*` was itself the clever pattern, believed for years, wrong the whole
 * time, and believed BECAUSE it looked like it covered the case. An explicit path is one this
 * repository can state with certainty and this test can check by name. The accepted cost is that a
 * future dot-directory needs its own line — and the failing assertion below is what will say so.
 *
 * ── WHAT THIS TEST CANNOT DO ────────────────────────────────────────────────────────────────────
 *
 * It reads the CONFIG, not the deployed bundle, so it proves the entry is present and not that
 * Firebase honoured it — the same limitation `csp-hygiene.test.mjs` has against the real header,
 * and the reason `npm run test:csp` exists beside it. There is no emulator equivalent for the
 * ignore list; the live-URL check above is the only proof, and it is a manual one.
 *
 * And it governs ONE of the app's two origins. The GitHub Pages mirror serves the repo root with no
 * ignore list at all, so both directories stay published there whatever this file says — measured
 * the same day, `.claude/settings.json` returns 200 on the mirror. That is the standing limitation
 * already recorded for the payslip fixture (AUTH_ARCHITECTURE.md → PAYSLIP_ACTUALS) — which is why
 * that file left the repository altogether at v23.71 rather than relying on this list:
 * the exclusion list expresses a decision for Firebase Hosting and cannot express it for the
 * mirror. It goes when the mirror does.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const hostingIgnore = JSON.parse(readFileSync(new URL('./firebase.json', import.meta.url), 'utf8'))
    .hosting.ignore;

/**
 * Directories that hold tooling and can never hold anything the app serves.
 *
 * `docs` joined on 9 Sep 2026 (external review). The estate's documentation was already 404 on
 * Hosting, but only because of the blanket `**\/*.md` rule — which says nothing about the 25
 * non-markdown files `docs/proposals/` (later `docs/links-24/`, removed 7 Nov 2026) had acquired: the December proposal `.json` designs, their
 * paste-ready `.txt` imports, and `tooling/*.mjs` with its `results/*.json`. Those were eligible to
 * be served from the staff domain.
 *
 * Nothing there is secret — the repository is public and the mirror serves them regardless, which
 * is the standing limitation this file's header already describes. The point is the same one the
 * `.claude`/`.github` entries were added for: an annealer's inputs and results are not part of the
 * staff application, and the app's own domain should not offer them. A file-EXTENSION rule is not
 * a directory rule, and the gap between the two is exactly where these landed.
 */
const TOOLING_DIRS = ['.claude', '.github', 'docs'];

test('tooling directories are excluded from the deployed bundle', () => {
    for (const dir of TOOLING_DIRS) {
        assert.ok(
            hostingIgnore.includes(`${dir}/**`),
            `firebase.json's hosting.ignore must list "${dir}/**".\n\n` +
            `\`**/.*\` does NOT cover it: a glob \`*\` does not cross a "/", so that pattern excludes\n` +
            `the "${dir}" entry itself and serves everything beneath it. Measured on the live site\n` +
            `8 Sep 2026 — .claude/settings.json and .github/workflows/*.yml both returned 200.`,
        );
    }
});

test('the dot-file pattern is still there, or the explicit paths are load-bearing alone', () => {
    // `**/.*` is not redundant — it is what keeps `.nojekyll` (measured 404) and any other
    // root dot-FILE out. The explicit directory entries above sit alongside it, not instead of it.
    assert.ok(
        hostingIgnore.includes('**/.*'),
        'the `**/.*` dot-file exclusion was removed; root dot-files like .nojekyll would be served',
    );
});

const deployWorkflow = readFileSync(new URL('./.github/workflows/deploy-hosting.yml', import.meta.url), 'utf8');
/**
 * deploy-hosting.yml's `paths-ignore` entries: EVERY list item in the block, however it is quoted.
 * A reader that saw only the single-quoted style would wave a served path written any other way
 * straight past the checks below.
 */
const pathsIgnore = [...deployWorkflow
    .slice(deployWorkflow.indexOf('paths-ignore:'), deployWorkflow.indexOf('workflow_dispatch:'))
    .matchAll(/^\s*-\s+(.+?)\s*$/gm)].map(m => m[1].replace(/^(['"])(.*)\1$/, '$2'));

/**
 * The three pattern shapes GitHub's path filter and Firebase's ignore list read the same way: a
 * directory's contents (`docs/**`), a plain path (`package.json`) and a file type at any depth
 * (`**\/*.md`). The skip list may use only these. Anything else is a bet on how GitHub reads a glob,
 * which nothing here can test — and `**\/.*`, the obvious one to copy across, loses that bet badly
 * if GitHub's `**\/` swallows the slash: it would then match every file with a dot in its name,
 * index.html included, and no push would deploy again.
 */
const SAME_TO_BOTH = /^(?:[\w.-]+(?:\/[\w.-]+)*\/\*\*|[\w.-]+(?:\/[\w.-]+)*|\*\*\/\*(?:\.[\w-]+)+)$/;

/**
 * The one file the bundle leaves out that must ALWAYS deploy. It is never served itself, but it is
 * the hosting config: the CSP, the headers, the redirects and this exclusion list.
 */
const ALWAYS_DEPLOYS = 'firebase.json';

test('a deploy is not triggered by a change that cannot reach the served app', () => {
    // The other half of the same idea, and it has a cost the ignore list does not: deploy-hosting
    // QUEUES rather than cancels, so a no-op deploy delays the next real release by a full run.
    // Measured 23 Oct 2026, when #1625 — workflows, docs and one test file — spent an 18-minute run
    // republishing v24.91 byte for byte. So the rule covers the whole list rather than a chosen few:
    // whatever the bundle leaves out, the deploy skips, bar the two exceptions declared above.
    const missing = hostingIgnore.filter(entry =>
        entry !== ALWAYS_DEPLOYS && SAME_TO_BOTH.test(entry) && !pathsIgnore.includes(entry));
    assert.deepEqual(missing, [],
        'firebase.json leaves these out of the bundle, but deploy-hosting.yml\'s paths-ignore does not\n' +
        'list them — so a change to one alone republishes an identical site and queues in front of the\n' +
        'next real deploy. Add each to paths-ignore, spelled the same way.');
});

test('the deploy never skips a change to a file a member is served', () => {
    // THE DIRECTION WITH TEETH. A missing entry above costs a wasted run; a WRONG entry here costs a
    // release — a change to a served file would merge, deploy nothing, and leave production on the
    // old version with every check green. The hourly currency check notices only when that change
    // carried the version bump; nothing notices one that did not.
    assert.ok(pathsIgnore.length > 0, 'found no paths-ignore entries in deploy-hosting.yml — has the block moved?');
    const served = pathsIgnore.filter(entry => !hostingIgnore.includes(entry));
    assert.deepEqual(served, [],
        'deploy-hosting.yml skips a deploy for these, but firebase.json does not keep them out of the\n' +
        'bundle — so a change to one is a change to what members are served, and it would never deploy.\n' +
        'Either the file is served and must not be skipped, or it is not and belongs in hosting.ignore too.');
    const unsure = pathsIgnore.filter(entry => !SAME_TO_BOTH.test(entry));
    assert.deepEqual(unsure, [],
        'deploy-hosting.yml skips a deploy for these patterns, but GitHub may not read them the way\n' +
        'Firebase does. Use only a directory\'s contents (dir/**), a plain path, or a file type at any\n' +
        'depth (**/*.ext) — see SAME_TO_BOTH.');
});

test('a change to firebase.json always deploys', () => {
    // firebase.json is in hosting.ignore, being config rather than a page, so the subset rule above
    // would let it into the skip list. It must never be there.
    assert.ok(hostingIgnore.includes(ALWAYS_DEPLOYS), 'firebase.json has left hosting.ignore — re-read this file\'s exceptions');
    assert.ok(!pathsIgnore.includes(ALWAYS_DEPLOYS),
        'deploy-hosting.yml\'s paths-ignore lists firebase.json. It is left out of the bundle because it is\n' +
        'config rather than a page, but it carries the CSP, the headers, the redirects and the exclusion\n' +
        'list itself — a change to it alone would merge and never reach Firebase Hosting.');
});

// ── THE DEPLOY FOLDER IS NOT THE APP (10 Nov 2026) ───────────────────────────────────────────
//
// Hosting's public directory is the repository root, so a deploy uploads whatever the RUNNER's
// folder holds that the ignore list does not name — and the runner's folder holds two things the
// repository does not. Measured on the live site on 10 Nov 2026, after the v25.63 release:
//
//     /.git/HEAD                       200   ← the deploy's own checkout (27–30 files, the whole tree)
//     /gha-creds-<random>.json         200   ← the Google sign-in step's credentials file
//
// The second is the serious one. google-github-actions/auth writes that file INTO THE WORKSPACE (by
// design, so container steps can read it) and the run log prints its name. It holds the address for
// acting as the deploy account and the bearer token that asks GitHub for this run's identity; the
// token is good for fifty minutes from the start of the job. Published, it is a handle on the
// account that can replace the rules, the functions and the site. The action's own documentation
// says to keep `gha-creds-*.json` out of every artefact a job produces.
//
// `**/.*` covered neither: it hides a dot-FILE, not what lies beneath a dot-directory (the gap the
// `.claude/**` and `.github/**` entries above were added for), and the credentials file has no dot.
//
// Two locks, because the first is a list and a list is only as good as its last edit:
//   1. the two entries below, in hosting.ignore;
//   2. scripts/hosting-upload-check.mjs, run by the deploy between the sign-in and the upload, which
//      asks firebase-tools' own lister what is about to go and refuses anything git does not track.
const DEPLOY_FOLDER_ONLY = ['.git/**', '**/gha-creds-*.json'];

test('the deploy checkout and the sign-in file are left out of the bundle', () => {
    for (const entry of DEPLOY_FOLDER_ONLY) {
        assert.ok(hostingIgnore.includes(entry),
            `firebase.json's hosting.ignore must list "${entry}".\n\n` +
            'Without it every Hosting deploy publishes that path on the staff site. For the sign-in\n' +
            'file that means a credential for the deploy account, under a name the public run log prints.');
    }
});

test('the deploy checks its upload list after signing in and before uploading', () => {
    const signIn = deployWorkflow.indexOf('uses: google-github-actions/auth@');
    const check  = deployWorkflow.indexOf('run: node scripts/hosting-upload-check.mjs');
    const deploy = deployWorkflow.indexOf('run: npx firebase deploy --only hosting');
    assert.ok(signIn !== -1 && deploy !== -1,
        'could not find the sign-in step or the deploy step in deploy-hosting.yml — this guard has stopped reading the workflow');
    assert.ok(check !== -1,
        'deploy-hosting.yml no longer runs scripts/hosting-upload-check.mjs. It is what stops a file a tool\n' +
        'dropped beside the app — a credential, a debug log — from being published with it.');
    assert.ok(signIn < check && check < deploy,
        'the upload check must run BETWEEN the sign-in and the deploy: before the sign-in the credentials\n' +
        'file does not exist yet, so a pass would prove nothing about it; after the deploy it is too late.');
});

test('the upload check names exactly the files git does not track', async () => {
    const { strayUploads, MIN_EXPECTED_FILES } = await import('./scripts/hosting-upload-check.mjs');
    const tracked = new Set(['index.html', 'calendar-app.js', 'icons/icon-192.png']);
    assert.deepEqual(
        strayUploads(['index.html', '.git/HEAD', 'calendar-app.js', 'gha-creds-0123456789abcdef.json', 'icons/icon-192.png', 'firestore-debug.log'], tracked),
        ['.git/HEAD', 'gha-creds-0123456789abcdef.json', 'firestore-debug.log'],
        'every upload path git does not track is a stray, whatever it is called — the check is not a list of names');
    assert.deepEqual(strayUploads(['index.html', 'calendar-app.js'], tracked), [], 'a bundle of committed files has no strays');
    assert.ok(MIN_EXPECTED_FILES >= 50, 'the "listing has stopped working" floor must stay well above an empty answer');
});
