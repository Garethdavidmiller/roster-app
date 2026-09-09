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
 * A dot-directory pattern (`**\/.*​/**` and friends) would generalise, and generalising is exactly
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
 * already recorded for `test-fixtures/miller-actuals.js` (AUTH_ARCHITECTURE.md → MILLER_ACTUALS):
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
 * non-markdown files `docs/proposals/` had acquired: the December proposal `.json` designs, their
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

test('a deploy is not triggered by a change that cannot reach the served app', () => {
    // The other half of the same idea, and it has a cost the ignore list does not: deploy-hosting
    // QUEUES rather than cancels, so a no-op deploy delays the next real release by a full run.
    const wf = readFileSync(new URL('./.github/workflows/deploy-hosting.yml', import.meta.url), 'utf8');
    const pathsIgnore = wf.slice(wf.indexOf('paths-ignore:'), wf.indexOf('workflow_dispatch:'));
    for (const dir of TOOLING_DIRS) {
        assert.match(
            pathsIgnore, new RegExp(`'${dir.replace('.', '[.]')}/\\*\\*'`),
            `deploy-hosting.yml's paths-ignore must list '${dir}/**' — it is excluded from the\n` +
            `bundle, so a deploy triggered by it republishes an identical tree and queues in\n` +
            `front of the next real one.`,
        );
    }
});
