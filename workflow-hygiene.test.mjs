/**
 * Static hygiene guard for the CI workflows.
 * Run: node --test workflow-hygiene.test.mjs   (part of `npm run test:hygiene`)
 *
 * WHY THIS FILE EXISTS. `workflow-lint.yml` validates every workflow's YAML and enforces
 * `timeout-minutes` on every job — but it cannot guard its OWN toolchain, and it only runs when
 * `.github/workflows/**` changes.
 *
 * That combination hides a specific regression. `workflow-lint` parses YAML with PyYAML, which is
 * NOT a documented guarantee of the `ubuntu-latest` image — it is present today, probably
 * transitively via another preinstalled tool, on an image that moves. v19.13 pinned an explicit
 * install. If someone later deletes that step, `workflow-lint` fires (a workflow file changed),
 * PyYAML is still there transitively, the job passes — and the fix is silently gone until a runner
 * refresh fails the job BEFORE it validates anything, which is a baffling way for a workflow-only
 * change to break.
 *
 * So the guard belongs HERE, in the suite that runs on every branch regardless of which files moved.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, rmSync, realpathSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { SPREAD, BASES, BROWSER_REFUSED_PORTS, portFor, devServerPort, devServer } from './e2e/dev-server.mjs';

const WF_DIR = '.github/workflows';
const LINT_WF = join(WF_DIR, 'workflow-lint.yml');
const lintSrc = readFileSync(LINT_WF, 'utf8');

describe('workflow-lint owns its own toolchain', () => {
    test('it installs PyYAML explicitly, and pins the version', () => {
        // `pip install PyYAML` unpinned would still be an improvement on relying on the image, but
        // this repo pins its CI inputs (actions are pinned by SHA) — an unpinned parser is a moving
        // dependency in the job whose entire purpose is catching CI breakage before it lands.
        const install = /pip install[^\n]*PyYAML==\d+\.\d+(\.\d+)?/i.exec(lintSrc);
        assert.ok(install,
            `${LINT_WF} must install a PINNED PyYAML (e.g. 'PyYAML==6.0.2') before parsing YAML. ` +
            'Relying on it being preinstalled couples this job to an ubuntu-latest image detail — ' +
            'and it is the job that protects workflow-only changes, so it fails in the most ' +
            'confusing possible place.');
    });

    test('the install happens BEFORE the step that imports yaml', () => {
        const installAt = lintSrc.search(/pip install[^\n]*PyYAML/i);
        const importAt  = lintSrc.search(/^\s*import yaml\b/m);
        assert.ok(importAt > -1, 'expected the validator to import yaml');
        assert.ok(installAt > -1 && installAt < importAt,
            'the PyYAML install must come before the validator that imports it — otherwise the pin ' +
            'is decorative and the job still depends on whatever the image happens to ship.');
    });

    test('a missing parser reports itself instead of a bare traceback', () => {
        assert.match(lintSrc, /ModuleNotFoundError/,
            'the validator should catch a missing yaml module and say so — an import traceback in ' +
            'the job that lints workflows reads like a broken workflow file, sending the next ' +
            'person to debug the wrong thing.');
    });
});

describe('every workflow job is bounded', () => {
    // Mirrors the check inside workflow-lint.yml deliberately. That one runs only when a workflow
    // file changes and depends on Python + PyYAML being available; this one runs on every branch
    // with no toolchain at all, so the two fail independently rather than sharing a single point of
    // failure. Regex rather than a YAML parse: adding a parser dependency to the unit suite to check
    // one key would be a worse trade than accepting a shallower match.
    const files = readdirSync(WF_DIR).filter(f => /\.ya?ml$/.test(f));

    test('the workflow directory is actually being read', () => {
        assert.ok(files.length >= 5, `expected several workflows, found ${files.length}`);
    });

    for (const file of readdirSync(WF_DIR).filter(f => /\.ya?ml$/.test(f))) {
        test(`${file}: every job declares timeout-minutes`, () => {
            const src = readFileSync(join(WF_DIR, file), 'utf8');
            const jobsAt = src.search(/^jobs:/m);
            assert.ok(jobsAt > -1, `${file} has no jobs: block`);
            const body = src.slice(jobsAt);
            // Top-level job keys are exactly two spaces in; their settings are four.
            const jobs = [...body.matchAll(/^ {2}([A-Za-z_][\w-]*):[ \t]*$/gm)].map(m => m[1]);
            assert.ok(jobs.length > 0, `${file}: no job keys parsed`);

            const unbounded = jobs.filter(name => {
                const start = body.search(new RegExp(`^ {2}${name}:[ \\t]*$`, 'm'));
                const rest  = body.slice(start + 1);
                const next  = rest.search(/^ {2}[A-Za-z_][\w-]*:[ \t]*$/m);
                const block = next === -1 ? rest : rest.slice(0, next);
                return !/^ {4}timeout-minutes:\s*[1-9]\d*\s*$/m.test(block);
            });

            assert.deepEqual(unbounded, [],
                `${file}: job(s) ${unbounded.join(', ')} have no positive timeout-minutes. Without ` +
                "one a job inherits GitHub's 6-hour default, so a hung runner blocks the branch for " +
                'the rest of the day — and on a required check nothing else can merge either.');
        });
    }
});

// ── COMPOSITE ACTIONS MUST STAY INSIDE THE LINTER'S REACH (Aug 2026) ───────────────────────────
// `.github/actions/**` was outside both workflow-lint's trigger and its glob when the first
// composite action was written — so nothing parsed its YAML, and the first one written had a real
// error in it (an unquoted `description:` containing `issues: write`, whose `: ` YAML reads as a
// nested mapping). It was caught by hand, which is not a mechanism.
//
// This lives HERE for the same reason the toolchain checks above do: workflow-lint cannot guard its
// OWN coverage. Drop `.github/actions/**` from its trigger or its glob and the linter still runs,
// still passes, and silently stops looking at actions — which is precisely how the gap opened in
// the first place. This suite runs on every branch regardless of which files moved.
describe('workflow-lint reaches composite actions', () => {
    const ACTIONS_DIR = '.github/actions';
    /** @type {string[]} */
    let actionDirs = [];
    try { actionDirs = readdirSync(ACTIONS_DIR, { withFileTypes: true })
        .filter(d => d.isDirectory()).map(d => d.name); } catch { /* none yet */ }

    test('the trigger fires on a change to an action', () => {
        if (!actionDirs.length) return;    // nothing to cover yet
        // Split on the `jobs:` KEY at column 0 — a bare `.split('jobs:')` cuts at the header
        // comment's "a missing `jobs:` key" instead, landing before the trigger block entirely
        // (which is how the first version of this test failed against a correct workflow).
        const triggers = lintSrc.split(/^jobs:/m)[0];
        assert.match(triggers, /['"]\.github\/actions\/\*\*['"]/,
            'workflow-lint does not TRIGGER on .github/actions/** — an action-only change gets no CI');
    });

    test('the validator actually globs action files', () => {
        if (!actionDirs.length) return;
        assert.match(lintSrc, /glob\.glob\(['"]\.github\/actions\/\*\/action\.ya?ml['"]\)/,
            'workflow-lint does not GLOB .github/actions/*/action.yml — actions are never parsed');
    });

    test('it checks what an action actually has, not what a workflow has', () => {
        if (!actionDirs.length) return;
        // An action has `runs:`, not `on:`/`jobs:`. Running the workflow checks against it would
        // fail every action for missing keys it is not supposed to have — which someone would then
        // "fix" by removing the coverage.
        assert.match(lintSrc, /runs/, 'no `runs:` check for actions');
        assert.match(lintSrc, /shell/,
            'no check that a composite `run:` step declares `shell:` — GitHub rejects that only at '
            + 'call time, i.e. in the middle of whatever the action was meant to be doing');
    });

    test('every composite action on disk declares a shell for each run step', () => {
        // The static half of the same rule, so it holds even if workflow-lint never fires.
        for (const dir of actionDirs) {
            let src;
            try { src = readFileSync(join(ACTIONS_DIR, dir, 'action.yml'), 'utf8'); } catch { continue; }
            const steps = src.split(/^\s*- /m).slice(1);
            for (const st of steps) {
                if (/\n\s*run:/.test(st) || /^\s*run:/.test(st)) {
                    assert.match(st, /shell:/,
                        `${dir}/action.yml has a step with \`run:\` and no \`shell:\``);
                }
            }
        }
    });
});

// ── A DEPLOY FAILURE MUST REACH SOMEBODY, INCLUDING ONE THAT KILLS THE JOB BEFORE ITS STEPS ─────
//
// The reporter was originally the deploy job's own last step under `if: failure()`, and the comment
// beside it said that covered "EVERY step above". It did. What it could not cover is a job that
// never reaches a step: on 14 Aug 2026 the rules deploy failed in `Prepare all required actions`
// because codeload would not serve a pinned action, so every step was skipped, no issue was opened,
// and a failed production deploy sat unnoticed until someone listed the workflow runs by hand.
//
// The fix is structural — a separate job with `needs` + a JOB-level `if: failure()` — and so is
// this guard. It asserts the SHAPE rather than the outcome, because the outcome only occurs during
// an outage: there is no way to make a real setup failure happen on demand in CI, which is exactly
// why the original gap survived review.
describe('a failed deploy is announced, whenever it fails', () => {
    const DEPLOY_WORKFLOWS = ['deploy-rules.yml', 'deploy-hosting.yml', 'deploy-functions.yml', 'deploy-mirror.yml'];

    test('the deploy workflows are all present', () => {
        for (const f of DEPLOY_WORKFLOWS) {
            assert.ok(readFileSync(join(WF_DIR, f), 'utf8').length > 0, `${f} is missing or empty`);
        }
    });

    for (const file of DEPLOY_WORKFLOWS) {
        test(`${file}: the reporter is its own job, gated at JOB level`, () => {
            const src = readFileSync(join(WF_DIR, file), 'utf8');
            const jobsAt = src.search(/^jobs:/m);
            const body = src.slice(jobsAt);

            const start = body.search(/^ {2}report-failure:[ \t]*$/m);
            assert.ok(start > -1,
                `${file}: no report-failure job. A deploy that fails during setup would be silent.`);
            const rest = body.slice(start + 1);
            const next = rest.search(/^ {2}[A-Za-z_][\w-]*:[ \t]*$/m);
            const block = next === -1 ? rest : rest.slice(0, next);

            // `needs` is what makes it run after the deploy; the job-level `if` is what makes it run
            // when the deploy died before its first step. A step-level guard is the defect.
            assert.match(block, /^ {4}needs: (deploy|\[(\w+, )*deploy(, \w+)*\])[ \t]*$/m,
                `${file}: report-failure must declare 'needs: deploy'`);
            // …and when it was CANCELLED, which is how a job that runs out of time ends (10 Nov 2026
            // review). `failure()` alone is false for a cancelled job: the v24.44 deploy cut off at
            // 20m00s told nobody. The spelling matters as much as the shape — GitHub's value is
            // `cancelled`, and a `canceled` here would never match anything.
            assert.match(block, /^ {4}if: failure\(\) \|\| contains\(needs\.\*\.result, 'cancelled'\)[ \t]*$/m,
                `${file}: report-failure needs the JOB-level 'if: failure() || contains(needs.*.result, `
                + "'cancelled')' — a step-level guard could not fire when the job failed during setup, "
                + 'and `failure()` alone does not fire when the deploy ran out of time.');
            assert.match(block, /^ {10}result: \$\{\{ contains\(needs\.\*\.result, 'cancelled'\) && 'cancelled' \|\| 'failure' \}\}[ \t]*$/m,
                `${file}: report-failure must tell the notice how the deploy ended — a deploy cut off `
                + 'part-way is not one that "did not go out"');
            // Without issues:write the reporter runs and the API call fails — a notifier that
            // reports nothing is worse than none, because the workflow still goes green-ish.
            assert.match(block, /^ {6}issues: write[ \t]*$/m,
                `${file}: report-failure must hold issues:write or it cannot open the issue`);
            assert.match(block, /report-deploy-failure/,
                `${file}: report-failure must actually invoke the reporter action`);
        });

        test(`${file}: the reporter is NOT also an in-job step`, () => {
            // Two reporters on one failure comment twice on the same issue, and a channel that
            // repeats itself is one people stop reading. One notifier, covering both classes.
            const src = readFileSync(join(WF_DIR, file), 'utf8');
            const jobsAt = src.search(/^jobs:/m);
            const deployBlock = src.slice(jobsAt).split(/^ {2}report-failure:[ \t]*$/m)[0];
            assert.ok(!/report-deploy-failure/.test(deployBlock),
                `${file}: the deploy job still calls the reporter itself — remove it, the job-level `
                + 'handler already covers every failure the step could see, and more.');
        });
    }

    test('the mirror\'s notice names the release its plan chose, not main\'s tip', () => {
        // 10 Nov 2026 review: the mirror publishes the commit a Hosting run released, while its own
        // run's commit is main's tip — usually a merge Hosting has not released yet. The reporter
        // only waited for the deploy job, so it could not see the plan's choice and named the tip.
        const src = readFileSync(join(WF_DIR, 'deploy-mirror.yml'), 'utf8');
        const block = src.slice(src.search(/^ {2}report-failure:[ \t]*$/m));
        assert.match(block, /^ {4}needs: \[plan, deploy\][ \t]*$/m, 'the reporter must wait for the plan to read its choice');
        assert.match(block, /^ {10}sha: \$\{\{ needs\.plan\.outputs\.sha \|\| 'none' \}\}[ \t]*$/m,
            'the reporter must pass on the commit the plan chose, or `none` when it chose nothing');
        const action = readFileSync('.github/actions/report-deploy-failure/action.yml', 'utf8');
        assert.match(action, /^ {8}SHA: \$\{\{ inputs\.sha \|\| github\.sha \}\}[ \t]*$/m,
            'the action must report the commit it is given, and the run\'s own only when given none');
        assert.match(action, /^ {8}RESULT: \$\{\{ inputs\.result \}\}[ \t]*$/m, 'the action must read how the deploy ended');
    });

    test('a post-deploy read cannot hang until the job runs out of time', () => {
        // A curl with no --max-time against an origin that accepts and never answers waits until
        // the job's own limit cancels it — the silent ending the reporter now catches, but a step
        // that fails by name says what hung. Every curl in every workflow carries a limit.
        for (const f of readdirSync(WF_DIR).filter(n => /\.ya?ml$/.test(n))) {
            const unbounded = readFileSync(join(WF_DIR, f), 'utf8').split('\n')
                .filter(l => !l.trim().startsWith('#') && /\bcurl\s+-/.test(l) && !/--max-time\s+\d+/.test(l));
            assert.deepEqual(unbounded, [], `${f}: a curl with no --max-time`);
        }
    });

    describe('the notice says which commit, and whether the deploy was cut off', () => {
        const script = stepScript(readFileSync('.github/actions/report-deploy-failure/action.yml', 'utf8'),
            'Open or update the deploy-failure issue');
        const HEAD = '1'.repeat(40), RELEASE = '2'.repeat(40);

        /**
         * Runs the reporter's script with `gh` and `git` stubbed and returns the issue body it sent.
         * @param {Record<string, string>} env
         * @param {Record<string, string>} [versions] the APP_VERSION the API holds at each commit
         */
        const notice = (env, versions = {}) => {
            const dir = mkdtempSync(join(tmpdir(), 'reporter-'));
            try {
                const bin = join(dir, 'bin');
                mkdirSync(bin);
                writeFileSync(join(bin, 'git'), '#!/usr/bin/env bash\n[ "$1 $2" = "rev-parse HEAD" ] && echo "$STUB_HEAD" && exit 0\nexit 1\n', { mode: 0o755 });
                writeFileSync(join(bin, 'gh'), `#!/usr/bin/env node
const { appendFileSync, writeFileSync } = require('node:fs');
const a = process.argv.slice(2);
appendFileSync(process.env.GH_LOG, a.join(' ') + '\\n');
if (a[0] === 'api') {
    const m = /^repos\\/[^/]+\\/[^/]+\\/contents\\/roster-data\\.js\\?ref=(\\w+)$/.exec(a[a.length - 1]);
    const v = m && JSON.parse(process.env.STUB_VERSIONS)[m[1]];
    if (!v || !a.includes('Accept: application/vnd.github.raw')) { console.error('gh: HTTP 404'); process.exit(1); }
    process.stdout.write("export const APP_VERSION = '" + v + "';\\n");
} else if (a[0] === 'issue' && (a[1] === 'create' || a[1] === 'comment')) {
    writeFileSync(process.env.GH_BODY, a[a.indexOf('--body') + 1]);
}
`, { mode: 0o755 });
                writeFileSync(join(dir, 'report.sh'), script);
                writeFileSync(join(dir, 'roster-data.js'), "export const APP_VERSION = '25.64';\n");
                writeFileSync(join(dir, 'calls'), '');
                writeFileSync(join(dir, 'body'), '');
                execFileSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', 'report.sh'], { cwd: dir, encoding: 'utf8', stdio: 'pipe',
                    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GH_LOG: join(dir, 'calls'), GH_BODY: join(dir, 'body'),
                        STUB_HEAD: HEAD, STUB_VERSIONS: JSON.stringify(versions), GH_TOKEN: 'stub', GITHUB_REPOSITORY: 'owner/roster-app',
                        TARGET: 'Firebase Hosting', RUN_URL: 'https://example.invalid/run/1', WORKFLOW: 'Deploy Firebase Hosting',
                        SHA: HEAD, RESULT: 'failure', ...env } });
                return { body: readFileSync(join(dir, 'body'), 'utf8'), calls: readFileSync(join(dir, 'calls'), 'utf8') };
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        };

        test('a failed deploy names its own commit and the version checked out', () => {
            const { body, calls } = notice({});
            assert.match(body, /\*\*Firebase Hosting did not deploy\.\*\*/);
            assert.match(body, /this commit did \*\*not\*\* go out/);
            assert.ok(body.includes(`| Commit | \`${HEAD}\` |`), body);
            assert.ok(body.includes('| App version at this commit | `v25.64` |'), body);
            assert.doesNotMatch(calls, /contents\//, 'the checked-out commit needs no API read');
        });

        test('a deploy that was cut off says it may have stopped part-way, not that nothing went out', () => {
            const { body } = notice({ RESULT: 'cancelled' });
            assert.match(body, /did not finish deploying/);
            assert.match(body, /ran out of time, or the run was\s+cancelled/);
            assert.doesNotMatch(body, /did \*\*not\*\* go out/,
                'a deploy cut off part-way may be partly live; "did not go out" would send the reader the wrong way');
        });

        test('another commit is named with ITS version, read at that commit', () => {
            // The mirror's case: main's tip checked out (v25.64), the release being published v25.62.
            const { body, calls } = notice({ TARGET: 'GitHub Pages mirror', SHA: RELEASE }, { [RELEASE]: '25.62' });
            assert.ok(body.includes(`| Commit | \`${RELEASE}\` |`), body);
            assert.ok(body.includes('| App version at this commit | `v25.62` |'), `the version of the checked-out tip was reported:\n${body}`);
            assert.match(calls, new RegExp(`contents/roster-data\\.js\\?ref=${RELEASE}`));
        });

        test('a run that chose nothing says so, and claims no commit or version', () => {
            const { body } = notice({ TARGET: 'GitHub Pages mirror', SHA: 'none' });
            assert.match(body, /stopped before choosing what to publish, so nothing went out/);
            assert.ok(body.includes('| Commit | none — the run stopped before choosing one |'), body);
            assert.ok(body.includes('| App version at this commit | unknown |'), body);
        });

        test('a version it cannot read is "unknown", not "vunknown"', () => {
            const { body } = notice({ SHA: RELEASE });
            assert.ok(body.includes('| App version at this commit | unknown |'), body);
        });
    });
});

// ── THE SUITE MUST NOT RUN TWICE, AND MUST NOT SKIP ITSELF (1 Sep 2026) ────────────────────────────
//
// Two separate ways this repo burned a full ten-job suite on nothing, on 1 Sep 2026:
//
//   1. `push` and `pull_request` both trigger e2e.yml, so a pushed branch with a PR open ran
//      everything twice over one tree — and a merge cancelled neither, leaving four WebKit jobs
//      grinding on a PR that no longer existed.
//   2. Resetting the branch after a merge (`git checkout -B <branch> origin/main`, force-push)
//      pushed a commit that had gone green minutes earlier and was already on main. Full re-run.
//
// The fixes are a `concurrency` group and a `guard` job. Both are asserted HERE rather than left
// to review because both fail SILENTLY and in opposite directions — a broken concurrency key just
// costs money, while a broken guard reports a green suite that ran nothing, on a branch somebody
// is about to merge.
//
// The job list is read FROM THE FILE, never written down here. A hand-kept list is how a job added
// next year opts out of the guard by simply not being mentioned — the failure mode this repo has
// hit with the enumerated CSS class list, the `paths:` globs and the hand-listed `node --check`.
describe('e2e.yml runs once per branch, and only on new work', () => {
    const E2E = join(WF_DIR, 'e2e.yml');
    const src = readFileSync(E2E, 'utf8');
    const jobsAt = src.search(/^jobs:/m);
    const body = src.slice(jobsAt);

    /** Every top-level job key, taken from the file itself. */
    const jobs = [...body.matchAll(/^ {2}([A-Za-z_][\w-]*):[ \t]*$/gm)].map(m => m[1]);

    /** @param {string} name */
    const blockOf = (name) => {
        const start = body.search(new RegExp(`^ {2}${name}:[ \\t]*$`, 'm'));
        const rest = body.slice(start + 1);
        const next = rest.search(/^ {2}[A-Za-z_][\w-]*:[ \t]*$/m);
        return next === -1 ? rest : rest.slice(0, next);
    };

    test('the job list actually parsed', () => {
        assert.ok(jobs.length >= 5, `expected e2e.yml's jobs, parsed ${jobs.length}`);
        assert.ok(jobs.includes('guard'), 'no guard job in e2e.yml');
    });

    test('a superseded run is cancelled', () => {
        const group = /^concurrency:\n {2}group: (.+)$/m.exec(src);
        assert.ok(group, 'e2e.yml declares no concurrency group — a push and its PR run in full, twice');
        assert.match(src, /^ {2}cancel-in-progress: true$/m,
            'the concurrency group must cancel in progress; queueing them still runs both');
    });

    test('the version guard cannot fail a branch that has already landed', () => {
        // THE CONCURRENCY GROUP DOES NOT COVER THIS, which is why the escape exists in the job.
        // It cancels a push run against its own PR run only while both are in flight; the ordinary
        // working sequence — push, wait for green, THEN open the PR and merge — separates them by a
        // whole CI cycle, so the PR run starts with nothing to cancel and then races the merge.
        // Twice on 6 Sep 2026 that run compared the branch against a main which by then contained
        // it (`main is v22.99 . this branch is v22.99`) and sent a failure email for a release that
        // was correct.
        //
        // Ancestry cannot detect it — main squash-merges, so the branch's commits are never
        // ancestors however completely it has landed, and a `pull_request` checkout is a merge
        // commit that was on neither side. Only the CONTENT answers, so that is what is pinned:
        // a two-dot diff against main's tip, restricted to the served files the branch touched.
        const job = blockOf('version');
        // Flags may sit between `--name-only` and the refs (`--no-renames`, pinned by the next test).
        const landed = /git diff --name-only(?: --[a-z-]+)* origin\/main HEAD --/.exec(job);
        assert.ok(landed,
            'the version job no longer checks whether its change is already on main by CONTENT. '
            + 'Without it, any PR merged while its pull_request run is in flight fails a guard it '
            + 'cannot satisfy — and a version guard that cries wolf is one somebody starts bumping '
            + 'past without reading, which is the job\'s own stated reason for existing.');
        // And the escape must sit BEFORE the comparison, or it cannot prevent the failure.
        assert.ok(landed.index < job.indexOf('does not exceed main'),
            'the already-landed escape runs after the version comparison, so the comparison still fails first');
    });

    test('the version job clones history without file contents, and its diffs never need any', () => {
        // 3 Nov 2026: a full clone of this repository is 1.4 GB — every version of every file on every
        // branch, mostly superseded screenshot baselines — and the job's checkout drifted from 39 s to
        // 254 s across one afternoon, until v25.22's PR run was cancelled by the 5-minute limit while
        // still downloading. The job needs commits and trees, and one file on main, which `git show`
        // fetches on demand. Rename detection reads file CONTENTS: a diff without --no-renames would
        // quietly start downloading them again, one round trip per renamed pair.
        const job = blockOf('version');
        assert.match(job, /^ +filter: blob:none[ \t]*$/m,
            'the version job clones every version of every file again: 1.4 GB against a 5-minute limit');
        const diffs = job.split('\n').filter(l => !l.trim().startsWith('#') && /\bgit diff\b/.test(l));
        assert.ok(diffs.length >= 2, `expected the fork-point diff and the landed check, found ${diffs.length}`);
        for (const d of diffs) {
            assert.match(d, /--no-renames/,
                `${d.trim()}\nRename detection needs file contents the blob-less clone does not hold, and `
                + 'it judged a served file moved under docs/ by its new, excluded path alone.');
        }
    });

    test('the version job reads main\'s file from disk, never through a pipe that can close early', () => {
        // 7 Nov 2026 review. `git show origin/main:roster-data.js | grep -m1` let grep exit at its
        // first match while git was still writing a file larger than a pipe's buffer: SIGPIPE, exit
        // 141 under pipefail, and the job ended there with nothing printed — about 1 run in 180.
        const script = blockOf('version').split('\n').filter(l => !l.trim().startsWith('#')).join('\n');
        assert.doesNotMatch(script, /git show[^\n|]*\|/,
            'the version job pipes `git show` into a reader again; grep -m1 stops reading at its '
            + 'first match, and git can then die of SIGPIPE and take the job with it, silently');
        assert.match(script, /git show origin\/main:roster-data\.js > "\$RUNNER_TEMP\/[\w.-]+"/,
            'main\'s roster-data.js must be written to a file under $RUNNER_TEMP and read from there');
    });

    test('the version comparison RUNS: an equal or lower version is refused, a higher one passes', () => {
        // Read, the comparison looked right; it had never been run. Changing `-le` to `-lt` passed
        // every check in this file (test audit, 7 Nov 2026) — and that is the v22.29 incident: one
        // version shipped twice, service-worker.js byte-identical across two releases, and devices
        // that took the first never install the second. So the job's own two lines are executed here.
        const lines = blockOf('version').split('\n').map(l => l.trim());
        const fn = lines.find(l => l.startsWith('hundredths()'));
        const cmp = lines.find(l => l.startsWith('if [ "$(hundredths "$OURS")"'));
        assert.ok(fn && cmp, 'the version job no longer defines hundredths() and compares versions with it');
        const verdict = (/** @type {string} */ ours, /** @type {string} */ main) => execFileSync('bash',
            ['-c', `${fn}\nOURS="$1"; MAIN="$2"\n${cmp} echo refused; else echo allowed; fi`, 'version-job', ours, main],
            { encoding: 'utf8' }).trim();
        assert.equal(verdict('25.45', '25.45'), 'refused', 'the same version twice is the v22.29 incident');
        assert.equal(verdict('25.44', '25.45'), 'refused', 'a version behind main');
        assert.equal(verdict('25.46', '25.45'), 'allowed');
        assert.equal(verdict('26.00', '25.99'), 'allowed', 'a 0.01 bump across a whole number');
        assert.equal(verdict('25.10', '25.09'), 'allowed', 'the minor is hundredths: 10 is above 09');
    });

    test('the concurrency key collides a push with its own pull_request', () => {
        // The point of the whole change. `github.ref` is refs/heads/<branch> on a push and
        // refs/pull/<n>/merge on a PR, so keying on it alone puts the two events in different
        // groups and cancels nothing — a fix that reads as correct and does not work.
        const group = /^concurrency:\n {2}group: (.+)$/m.exec(src)[1];
        assert.match(group, /github\.head_ref/,
            `the concurrency group is ${group} — without github.head_ref a push and its pull_request `
            + 'land in different groups, which is the duplication this was added to stop');
        assert.ok(!/github\.ref\s*}}/.test(group),
            `the concurrency group is ${group} — github.ref carries the refs/pull/<n>/merge form on a `
            + 'PR, so it can never match the same branch pushed; use github.ref_name as the fallback');
    });

    test('every job is gated on the guard — including one added later', () => {
        const ungated = jobs.filter(n => n !== 'guard' && !/^ {4}needs: guard[ \t]*$/m.test(blockOf(n)));
        assert.deepEqual(ungated, [],
            `e2e.yml job(s) ${ungated.join(', ')} do not declare 'needs: guard', so they run on a `
            + 'commit that is already on main. Add the needs + if pair used by every sibling job.');
    });

    test('the gate reads the guard, and fails OPEN if the guard is missing its answer', () => {
        // `!= 'true'` and not `== 'false'`: if the guard job errors, its output is the empty
        // string. Under `!= 'true'` the suite runs anyway (a wasted run). Under `== 'false'`
        // every job would skip and the run would go green having tested nothing — which is the
        // one outcome nobody would look at twice.
        for (const name of jobs.filter(n => n !== 'guard')) {
            const block = blockOf(name);
            const gate = /^ {4}if: (.+)$/m.exec(block);
            assert.ok(gate, `${name}: no job-level if — 'needs: guard' alone skips it when guard fails`);
            assert.match(gate[1], /needs\.guard\.outputs\.skip\s*!=\s*'true'/,
                `${name}: the gate is ${gate[1]} — it must be \`needs.guard.outputs.skip != 'true'\`. `
                + "An `== 'false'` test skips the whole suite whenever the guard cannot answer.");
            assert.match(gate[1], /!cancelled\(\)/,
                `${name}: the gate must carry !cancelled() — without it a failed guard skips this job `
                + 'silently, and with always() instead the job runs on through a cancelled run, '
                + 'defeating the concurrency group above.');
        }
    });

    test('the guard only ever skips a push, and treats an unreadable answer as new work', () => {
        const block = blockOf('guard');
        assert.match(block, /"\$EVENT" != "push"/,
            'the guard must exempt every non-push event outright — a pull_request tests a merge '
            + 'preview that is not on main by construction, and asking the API about it invites a '
            + 'wrong skip on the run people actually read');
        assert.match(block, /\|\|\s*echo unknown/,
            'the compare call must fall back to `unknown` on failure. Without it a transient API '
            + 'error makes `status` empty, and an empty case is one careless glob away from '
            + 'matching the skip branch.');
        assert.match(block, /identical\|behind\)/,
            'the guard must skip only `identical` (this IS main) and `behind` (an ancestor of main). '
            + '`ahead` and `diverged` are work main has not seen.');
        assert.ok(!/skip=true/.test(block.split(/identical\|behind\)/)[0]),
            'nothing may set skip=true before the compare has been read');
    });

    test('the guard is cheap enough to sit on the critical path', () => {
        // It runs before all seven siblings, so a checkout or an npm install here would be paid by
        // every real run to catch the rare redundant one. One API call, no repository.
        const block = blockOf('guard');
        assert.ok(!/actions\/checkout/.test(block),
            'the guard must not check out the repository — the compare API answers without it, and '
            + 'this job delays every genuine run by however long it takes');
        assert.ok(!/npm ci/.test(block), 'the guard must not install dependencies');
    });
});

// ── THE CHROMIUM SUITE RUNS ONE JOB PER PROJECT (3 Nov 2026) ──────────────────────────────────────
//
// `smoke` ran both Playwright projects in one job and had reached 25.1 minutes of a 30-minute limit,
// so each project became its own job. That turns a list Playwright used to read for itself — every
// project in playwright.config.mjs — into one written out in e2e.yml's matrix, and a project added to
// the config but not to the matrix would silently stop running in CI while every job stayed green.
// So the matrix is held to the config here, both read from their files, never restated.
describe('the Chromium suite runs one job per project, and no project is left out', () => {
    const e2e = readFileSync(join(WF_DIR, 'e2e.yml'), 'utf8');
    const body = e2e.slice(e2e.search(/^jobs:/m));
    const start = body.search(/^ {2}smoke:[ \t]*$/m);
    const rest = body.slice(start + 1);
    const next = rest.search(/^ {2}[A-Za-z_][\w-]*:[ \t]*$/m);
    const smoke = next === -1 ? rest : rest.slice(0, next);

    const cfg = readFileSync('playwright.config.mjs', 'utf8');
    const projectsBlock = cfg.slice(cfg.search(/^\s*projects:\s*\[/m));
    const configProjects = [...projectsBlock.slice(0, projectsBlock.search(/^\s*\],?\s*$/m))
        .matchAll(/name:\s*'([^']+)'/g)].map(m => m[1]);

    test('both lists actually parsed', () => {
        assert.ok(start !== -1, 'no smoke job in e2e.yml');
        assert.ok(configProjects.length >= 2, `expected playwright.config.mjs's projects, parsed ${configProjects.length}`);
    });

    test('the matrix names exactly the config\'s projects', () => {
        const m = /^\s+project:\s*\[([^\]]*)\]/m.exec(smoke);
        assert.ok(m, 'smoke has no project matrix: the whole suite is back in one job, against the limit it outgrew');
        const matrix = m[1].split(',').map(s => s.trim()).filter(Boolean);
        assert.deepEqual([...matrix].sort(), [...configProjects].sort(),
            `e2e.yml runs ${matrix.join(', ')}; playwright.config.mjs defines ${configProjects.join(', ')}. `
            + 'A project in the config but not the matrix never runs in CI; one in the matrix but not the config fails its job.');
    });

    test('each job runs its own project, and a failure never cancels the other half', () => {
        assert.match(smoke, /npm run test:e2e -- --project=\$\{\{ matrix\.project \}\}/,
            'each job must pass its matrix project to Playwright, or both jobs run the whole suite');
        assert.match(smoke, /^\s+fail-fast:\s*false\s*$/m,
            'with fail-fast on, a red half cancels the green one, and its report is lost');
    });

    test('each half uploads its report under its own name', () => {
        // Two jobs uploading one artifact name: whichever lands second fails its upload, so the report
        // for the half that broke can be the one that is lost.
        assert.match(smoke, /name: playwright-report-\$\{\{ matrix\.project \}\}/,
            'the report artifact must carry the project, or the two halves collide');
    });
});

// ── THE WEBKIT LANE RUNS EVERY PROJECT, AND EVERY SHARD OF EACH (3 Nov 2026) ─────────────────────
//
// The webkit job lists its jobs one by one: the iPhone project four ways, the desktop one two
// (e2e.yml says why). So the hazard the Chromium guard above names has a second form here, a shard
// left out of the list. List shards 1, 2 and 4 of 4 and a quarter of the iPhone tests never run,
// while all three jobs go green. The list is held to playwright.webkit.mjs's projects, and each
// project's shards to 1 to N of N.
describe('the WebKit lane runs every project, and every shard of each', () => {
    const e2e = readFileSync(join(WF_DIR, 'e2e.yml'), 'utf8');
    const body = e2e.slice(e2e.search(/^jobs:/m));
    const start = body.search(/^ {2}webkit:[ \t]*$/m);
    const rest = body.slice(start + 1);
    const next = rest.search(/^ {2}[A-Za-z_][\w-]*:[ \t]*$/m);
    const job = next === -1 ? rest : rest.slice(0, next);
    const entries = [...job.matchAll(/^\s+- \{ project: ([\w-]+), shard: (\d+), shards: (\d+) \}\s*$/gm)]
        .map(m => ({ project: m[1], shard: Number(m[2]), shards: Number(m[3]) }));

    const cfg = readFileSync('playwright.webkit.mjs', 'utf8');
    const projectsBlock = cfg.slice(cfg.search(/^\s*projects:\s*\[/m));
    const configProjects = [...projectsBlock.slice(0, projectsBlock.search(/^\s*\],?\s*$/m))
        .matchAll(/name:\s*'([^']+)'/g)].map(m => m[1]);

    test('both lists actually parsed', () => {
        assert.ok(start !== -1, 'no webkit job in e2e.yml');
        assert.ok(entries.length >= 2,
            `expected the webkit job's "- { project: …, shard: …, shards: … }" entries, parsed ${entries.length}`);
        assert.ok(configProjects.length >= 2, `expected playwright.webkit.mjs's projects, parsed ${configProjects.length}`);
    });

    test('the list names exactly the config\'s projects', () => {
        const listed = [...new Set(entries.map(e => e.project))].sort();
        assert.deepEqual(listed, [...configProjects].sort(),
            `e2e.yml's webkit job runs ${listed.join(', ')}; playwright.webkit.mjs defines ${configProjects.join(', ')}. `
            + 'A project in the config but not the list never runs in CI.');
    });

    test('each project runs shards 1 to N of N, once each', () => {
        for (const project of configProjects) {
            const mine = entries.filter(e => e.project === project);
            const totals = [...new Set(mine.map(e => e.shards))];
            assert.equal(totals.length, 1,
                `${project}: its entries disagree on how many shards there are (${totals.join(', ')})`);
            const shards = mine.map(e => e.shard).sort((a, b) => a - b);
            assert.deepEqual(shards, Array.from({ length: totals[0] }, (_, i) => i + 1),
                `${project} runs shards ${shards.join(', ')} of ${totals[0]}: a shard missing from the list never `
                + 'runs, and every job still goes green');
        }
    });

    test('each job runs its own shard, and a failure never cancels another', () => {
        assert.match(job, /--project=\$\{\{ matrix\.project \}\} --shard=\$\{\{ matrix\.shard \}\}\/\$\{\{ matrix\.shards \}\}/,
            'the command must read the shard count from the entry, or it disagrees with the number of jobs');
        assert.match(job, /^\s+fail-fast:\s*false\s*$/m,
            'with fail-fast on, one red shard cancels the others, and their reports are lost');
        assert.match(job, /name: playwright-report-webkit-\$\{\{ matrix\.project \}\}-shard\$\{\{ matrix\.shard \}\}/,
            'the report artifact must carry the project and the shard, or two jobs collide');
    });
});

// ── A DEPLOY QUEUES; IT IS NEVER CANCELLED, AND NEVER RACES ITSELF (1 Sep 2026) ────────────────
//
// Two pushes to main used to deploy in parallel, each spending ~11 minutes on tests first. Nothing
// ordered them, so the slower-testing FIRST push released second and staff got the older tree —
// both runs green, nothing anywhere reporting it. A `concurrency` group with
// `cancel-in-progress: false` serialises them, so the last tree to arrive is the last one live.
//
// EVERY CONTRACT HERE IS ABOUT A ONE-WORD EDIT THAT LOOKS LIKE TIDYING:
//   `false` → `true`      interrupts a deploy mid-flight (and a functions deploy is not atomic —
//                         some functions on the new code, the rest on the old).
//   adding `github.ref`   reads as more precise and re-admits the race, because `workflow_dispatch`
//                         carries no branch restriction and there is only one Firebase project.
//   one shared group      serialises three deploys that are designed to run in parallel — slower
//                         every release, safer in no respect.
// None of the three fails anything at the time it is made, which is why they are pinned rather
// than reviewed.
describe('the deploy workflows serialise rather than race', () => {
    const DEPLOYS = ['deploy-hosting.yml', 'deploy-functions.yml', 'deploy-rules.yml', 'deploy-mirror.yml'];

    /** @param {string} file */
    const concurrencyOf = (file) => {
        const src = readFileSync(join(WF_DIR, file), 'utf8');
        const m = /^concurrency:\n {2}group: (.+)\n {2}cancel-in-progress: (\S+)/m.exec(src);
        return m ? { group: m[1].trim(), cancel: m[2].trim() } : null;
    };

    for (const file of DEPLOYS) {
        test(`${file}: declares a concurrency group`, () => {
            assert.ok(concurrencyOf(file),
                `${file} has no concurrency group, so two pushes to main deploy in parallel and the `
                + 'one that finishes its tests last is the one that goes live — which is not '
                + 'necessarily the newer tree.');
        });

        test(`${file}: QUEUES — it must never cancel a deploy in flight`, () => {
            const { cancel } = concurrencyOf(file);
            assert.equal(cancel, 'false',
                `${file}: cancel-in-progress is '${cancel}'. A superseded TEST run is worth `
                + 'cancelling (e2e.yml does); a superseded DEPLOY is not — cancelling interrupts a '
                + 'release that is already going out. Queue instead, and let the newer run follow.');
        });

        test(`${file}: the group is ref-independent`, () => {
            const { group } = concurrencyOf(file);
            assert.ok(!/github\.(ref|ref_name|sha|head_ref)/.test(group),
                `${file}: the group is ${group}. There is one Firebase project, so two deploys `
                + 'racing is a hazard whatever ref they came from — and workflow_dispatch here has '
                + 'no branch restriction, so a manual dispatch off a branch would run straight into '
                + 'a main deploy. Keying on the ref looks more precise and reopens exactly that.');
        });
    }

    test('the three deploys do NOT share one group', () => {
        // They touch different targets and are meant to fire together; CLAUDE.md's backend-first
        // ordering note is written against them running in parallel. A shared "deploy" group would
        // serialise all three on every release and buy nothing.
        //
        // RESOLVE `github.workflow` BEFORE COMPARING. The first version of this test compared the
        // group strings verbatim and failed against correct workflows: all three read
        // `${{ github.workflow }}`, which is one string here and three different values at run
        // time. Comparing the template rather than what GitHub computes tests the wrong thing —
        // and it would have gone on being wrong in the other direction too, passing happily on
        // three groups that all resolved to the same value by some other route.
        const groups = DEPLOYS.map((f) => {
            const src = readFileSync(join(WF_DIR, f), 'utf8');
            const name = /^name:\s*(.+)$/m.exec(src)[1].trim();
            return concurrencyOf(f).group.replace(/\$\{\{\s*github\.workflow\s*\}\}/g, name);
        });
        assert.equal(new Set(groups).size, DEPLOYS.length,
            `the deploy workflows resolve to a shared concurrency group (${groups.join(' | ')}), `
            + 'which serialises three deploys that are designed to run in parallel');
    });

    test('a deploy can never queue behind, or be cancelled by, a test run', () => {
        // The groups are distinguished by github.workflow, i.e. each workflow's `name:`. Two
        // workflows sharing a name would collapse into one group — and e2e.yml cancels, so a
        // collision there would let a test run cancel a release.
        const names = readdirSync(WF_DIR).filter(f => /\.ya?ml$/.test(f)).map(f => {
            const n = /^name:\s*(.+)$/m.exec(readFileSync(join(WF_DIR, f), 'utf8'));
            return n ? n[1].trim() : f;
        });
        assert.equal(new Set(names).size, names.length,
            `two workflows share a 'name:' (${names.join(' | ')}), so their \${{ github.workflow }} `
            + 'concurrency groups collapse into one. e2e.yml cancels in progress, so a collision '
            + 'with it would let a test run cancel a deploy.');
    });
});

// ── A PRODUCTION DEPLOY RUNS ONLY FROM `main` (v22.32, external review) ─────────────────────────
//
// All three deploy workflows accept `workflow_dispatch`, which carries no branch restriction, and
// their concurrency groups QUEUE — but GitHub keeps one pending run per group, so a newer pending
// run displaces the previous one. Across branches that means a manual dispatch of branch C can
// displace a pending `main` B and leave production finishing on C while main holds the newer tree.
//
// The guard is one `if:` per workflow, which is exactly the kind of line a later edit removes
// without noticing. Asserted here rather than trusted. It stops C DEPLOYING; it cannot stop C
// displacing B, because a run joins the queue before any job's condition is read (10 Nov 2026
// review). So each workflow also has a `not-main` job that turns such a run red and says what to do,
// instead of letting it finish green having deployed nothing while B is lost.
describe('deploy workflows only run from main', () => {
    for (const wf of ['deploy-hosting.yml', 'deploy-functions.yml', 'deploy-rules.yml', 'deploy-mirror.yml']) {
        test(`${wf} gates its deploy job on refs/heads/main`, () => {
            const src = readFileSync(new URL(`.github/workflows/${wf}`, import.meta.url), 'utf8');
            assert.match(src, /if:\s*github\.ref == 'refs\/heads\/main'/,
                `${wf} must gate its deploy job on main — without it a manual dispatch from a `
                + 'branch deploys that branch to production');
        });

        test(`${wf}: a run from another branch fails and says what to do`, () => {
            const src = readFileSync(join(WF_DIR, wf), 'utf8');
            const start = src.search(/^ {2}not-main:[ \t]*$/m);
            assert.ok(start > -1, `${wf}: no not-main job, so a branch run that displaced a waiting main deploy goes green`);
            const rest = src.slice(start + 1);
            const next = rest.search(/^ {2}[A-Za-z_][\w-]*:[ \t]*$/m);
            const job = next === -1 ? rest : rest.slice(0, next);
            assert.match(job, /^ {4}if: github\.ref != 'refs\/heads\/main'[ \t]*$/m, `${wf}: not-main must run exactly when the deploy does not`);
            assert.match(job, /::error title=Nothing was (deployed|published)::[^\n]*Run workflow, on main/, `${wf}: not-main must say what to do`);
            assert.match(job, /^\s+exit 1[ \t]*$/m, `${wf}: not-main must FAIL the run — a green run that did nothing is the silence it exists to end`);
            assert.match(job, /^ {4}permissions: \{\}[ \t]*$/m, `${wf}: not-main needs no token at all`);
        });
    }
});

/**
 * The script of the step called `name`: its `run: |` block scalar, dedented. Refuses to reach past
 * the step into the next one, so a step that lost its script fails here rather than lending another's.
 * @param {string} src a workflow's source
 * @param {string} name the step's `name:`
 */
function stepScript(src, name) {
    const lines = src.split('\n');
    const at = lines.findIndex(l => l.trim() === `- name: ${name}`);
    assert.ok(at >= 0, `no step is named "${name}"`);
    const runAt = lines.findIndex((l, i) => i > at && /^\s*run: \|\s*$/.test(l));
    assert.ok(runAt > at && !lines.slice(at + 1, runAt).some(l => /^\s*- (name|uses):/.test(l)),
        `the "${name}" step has no \`run: |\` script of its own`);
    const indent = lines[runAt + 1].match(/^\s*/)[0].length;
    const body = [];
    for (let i = runAt + 1; i < lines.length; i++) {
        if (lines[i].trim() && lines[i].match(/^\s*/)[0].length < indent) break;
        body.push(lines[i].slice(indent));
    }
    return body.join('\n');
}

/**
 * A stand-in for `gh api`, written into `bin`. It answers from the JSON fixture named by $GH_STUB —
 * workflow runs filtered by the query's branch, event, status and per_page the way the API filters
 * them, the Pages build type, and how main compares with a commit — applies `--jq` with the real jq,
 * and appends every path it is asked for to $GH_LOG. Anything else is an error, so a script that
 * starts asking a new question fails its test instead of being answered by accident.
 * @param {string} bin
 */
function writeGhStub(bin) {
    writeFileSync(join(bin, 'gh'), `#!/usr/bin/env node
const { readFileSync, appendFileSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const args = process.argv.slice(2);
if (args[0] !== 'api') { console.error('stub gh: only "gh api" is stubbed'); process.exit(2); }
const path = args[1];
appendFileSync(process.env.GH_LOG, path + '\\n');
const jq = args.includes('--jq') ? args[args.indexOf('--jq') + 1] : '.';
const fx = JSON.parse(readFileSync(process.env.GH_STUB, 'utf8'));
const [p, query = ''] = path.split('?');
const q = new URLSearchParams(query);
let body, m;
if (/^repos\\/[^/]+\\/[^/]+\\/actions\\/workflows\\/[^/]+\\/runs$/.test(p)) {
    let runs = fx.runs;
    if (q.has('branch')) runs = runs.filter(r => r.head_branch === q.get('branch'));
    if (q.has('event')) runs = runs.filter(r => r.event === q.get('event'));
    if (q.has('status')) runs = runs.filter(r => r.conclusion === q.get('status') || r.status === q.get('status'));
    if (q.has('per_page')) runs = runs.slice(0, Number(q.get('per_page')));
    body = { workflow_runs: runs };
} else if (/^repos\\/[^/]+\\/[^/]+\\/pages$/.test(p)) {
    body = { build_type: fx.build_type };
} else if ((m = /^repos\\/[^/]+\\/[^/]+\\/compare\\/(.+)\\.\\.\\.main$/.exec(p)) && m[1] in fx.on_main) {
    body = { status: fx.on_main[m[1]] };
} else {
    console.error('gh: HTTP 404: Not Found (' + path + ')');
    process.exit(1);
}
process.stdout.write(execFileSync('jq', ['-r', jq], { input: JSON.stringify(body) }));
`, { mode: 0o755 });
}

// ── THE MIRROR PUBLISHES ONLY A RELEASE THIS REPOSITORY MADE (whole-app review, 10 Nov 2026) ────
//
// deploy-mirror.yml used to recognise "a commit Hosting released" by three things a stranger can
// supply: the triggering workflow's NAME, its branch name and its conclusion. A fork's pull request
// that renames a one-step workflow "Deploy Firebase Hosting" and calls its branch `main` ends
// `success`, on `main`, at the fork's commit — and once Pages deploys from the workflow, the mirror
// most staff open would publish it (a manual run picked it too, being the newest "success on main").
// Nothing is run on GitHub here, so the plan step's own script is run, with `gh` stubbed and a run
// list in which the stranger's run is the newest of all.
describe('the Pages mirror publishes only a release this repository made', () => {
    const script = stepScript(readFileSync(join(WF_DIR, 'deploy-mirror.yml'), 'utf8'), 'Decide what to publish');
    const OURS = 1001, THEIRS = 2002;
    const A = 'a'.repeat(40), B = 'b'.repeat(40), C = 'c'.repeat(40), F = 'f'.repeat(40);
    const run = (/** @type {object} */ r) => ({ head_branch: 'main', status: 'completed', conclusion: 'success',
        head_repository: { id: OURS, full_name: 'owner/roster-app' }, ...r });
    const stranger = { id: THEIRS, full_name: 'stranger/roster-app' };
    // Newest first, as the API lists them.
    const RUNS = [
        run({ run_number: 46, event: 'pull_request', head_sha: F, head_repository: stranger }),
        run({ run_number: 45, event: 'workflow_dispatch', head_sha: B }),
        run({ run_number: 44, event: 'push', head_sha: A }),
        run({ run_number: 43, event: 'push', head_sha: C, conclusion: 'failure' }),
    ];
    // How main compares with each commit. `main` itself compares as identical, as it would on GitHub.
    const ON_MAIN = { [A]: 'ahead', [B]: 'identical', [C]: 'ahead', [F]: 'behind', main: 'identical' };

    /**
     * Runs the plan step once.
     * @param {Record<string, string>} env what GitHub would put in the step's env
     * @param {{ runs?: object[], build_type?: string }} [fixture]
     */
    const plan = (env, fixture = {}) => {
        const dir = mkdtempSync(join(tmpdir(), 'mirror-plan-'));
        try {
            const bin = join(dir, 'bin');
            mkdirSync(bin);
            writeGhStub(bin);
            writeFileSync(join(dir, 'plan.sh'), script);
            writeFileSync(join(dir, 'fixture.json'), JSON.stringify({ runs: RUNS, build_type: 'workflow', on_main: ON_MAIN, ...fixture }));
            writeFileSync(join(dir, 'out'), '');
            writeFileSync(join(dir, 'calls'), '');
            const vars = { PATH: `${bin}:${process.env.PATH}`, GH_STUB: join(dir, 'fixture.json'), GH_LOG: join(dir, 'calls'),
                GITHUB_OUTPUT: join(dir, 'out'), GITHUB_REPOSITORY: 'owner/roster-app', GH_TOKEN: 'stub', REPO_ID: String(OURS),
                EVENT: 'workflow_run', ATTEMPT: '1', RUN_CONCLUSION: '', RUN_BRANCH: '', RUN_SHA: '', RUN_EVENT: '',
                RUN_REPO_ID: '', RUN_REPO: '', ...env };
            let status = 0, out = '';
            try {
                out = execFileSync('bash', ['--noprofile', '--norc', '-e', 'plan.sh'], { cwd: dir, env: vars, encoding: 'utf8', stdio: 'pipe' });
            } catch (/** @type {any} */ e) {
                status = e.status;
                out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
            }
            const outputs = Object.fromEntries(readFileSync(join(dir, 'out'), 'utf8').split('\n').filter(Boolean)
                .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
            const calls = readFileSync(join(dir, 'calls'), 'utf8').split('\n').filter(Boolean);
            return { status, out, outputs, calls };
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    };
    /** A finished Hosting run, as the workflow_run event describes it. */
    const finished = (/** @type {Record<string, string>} */ r) => ({ RUN_CONCLUSION: 'success', RUN_BRANCH: 'main',
        RUN_EVENT: 'push', RUN_REPO_ID: String(OURS), RUN_REPO: 'owner/roster-app', ...r });

    test('a release from a push to main is published, once main is checked to hold it', () => {
        const r = plan(finished({ RUN_SHA: A }));
        assert.equal(r.status, 0, r.out);
        assert.deepEqual(r.outputs, { sha: A, go: 'true' }, r.out);
        assert.ok(r.calls.some(c => c.startsWith(`repos/owner/roster-app/compare/${A}...main`)),
            'the plan must ask how main compares with the commit before publishing it');
    });

    test('so is a release somebody started by hand', () => {
        const r = plan(finished({ RUN_SHA: B, RUN_EVENT: 'workflow_dispatch' }));
        assert.deepEqual(r.outputs, { sha: B, go: 'true' }, r.out);
    });

    test('a fork\'s pull request named like the deploy, on a branch called main, publishes nothing and asks nothing', () => {
        // The attack itself. It must stand down before any question is asked, so that a stranger's
        // run can neither publish nor make the plan FAIL — a failure posts on the owner's deploy-failure
        // thread, and the stranger could repeat it with every push to the pull request.
        const r = plan(finished({ RUN_SHA: F, RUN_EVENT: 'pull_request', RUN_REPO_ID: String(THEIRS), RUN_REPO: 'stranger/roster-app' }));
        assert.equal(r.status, 0, r.out);
        assert.deepEqual(r.outputs, { go: 'false' }, `the stranger's commit was accepted:\n${r.out}`);
        assert.match(r.out, /::warning::.*pull_request event in stranger\/roster-app/, 'the stand-down must say whose run it was');
        assert.deepEqual(r.calls, [], 'nothing may be asked about a run nobody here started');
    });

    test('the event alone is enough to refuse: a pull-request run is never a release, whatever its repository', () => {
        const r = plan(finished({ RUN_SHA: A, RUN_EVENT: 'pull_request' }));
        assert.deepEqual(r.outputs, { go: 'false' }, r.out);
    });

    test('and so is the repository: a push event whose head is another repository is refused', () => {
        // GitHub does not produce this today; the check must still hold on its own, so that neither
        // half of the provenance test leans on the other.
        const r = plan(finished({ RUN_SHA: A, RUN_REPO_ID: String(THEIRS), RUN_REPO: 'stranger/roster-app' }));
        assert.deepEqual(r.outputs, { go: 'false' }, r.out);
    });

    test('a run that failed, or released another branch, still publishes nothing', () => {
        assert.deepEqual(plan(finished({ RUN_SHA: C, RUN_CONCLUSION: 'failure' })).outputs, { go: 'false' });
        assert.deepEqual(plan(finished({ RUN_SHA: A, RUN_BRANCH: 'claude/feature' })).outputs, { go: 'false' });
    });

    test('a commit main does not hold is refused, loudly, even from this repository', () => {
        const r = plan(finished({ RUN_SHA: F }));
        assert.equal(r.status, 1, `a commit main does not contain was published:\n${r.out}`);
        assert.match(r.out, /::error::Commit f{40} is not on this repository's main \(main is 'behind' from it\)/);
        assert.equal(r.outputs.go, undefined, r.out);
    });

    test('anything but a full commit SHA is refused, even one main "holds"', () => {
        // The checkout takes `ref:` as given, so `main` would publish main's tip — the tree the gate
        // may have refused, which is the one thing this workflow exists to stop.
        const r = plan(finished({ RUN_SHA: 'main' }));
        assert.equal(r.status, 1, r.out);
        assert.equal(r.outputs.go, undefined, r.out);
    });

    test('a manual run publishes the newest release this repository made, never the stranger\'s newer run', () => {
        // The newest successful run "on main" is the stranger's (46), and the old query asked for
        // exactly that. Push (44) and hand (45) are asked for separately; the later of the two wins.
        const r = plan({ EVENT: 'workflow_dispatch' });
        assert.equal(r.status, 0, r.out);
        assert.deepEqual(r.outputs, { sha: B, go: 'true' }, `the manual run published the wrong commit:\n${r.out}`);
        for (const ev of ['push', 'workflow_dispatch']) {
            assert.ok(r.calls.some(c => /\/actions\/workflows\/deploy-hosting\.yml\/runs\?/.test(c) && c.includes(`event=${ev}`)),
                `the manual run must ask for ${ev} runs by event, or pull-request runs can fill the page`);
        }
    });

    test('a manual run takes a push release when that is the newer one', () => {
        const r = plan({ EVENT: 'workflow_dispatch' }, { runs: [run({ run_number: 47, event: 'push', head_sha: C }), ...RUNS] });
        assert.deepEqual(r.outputs, { sha: C, go: 'true' }, r.out);
    });

    test('a manual run refuses a newest release from another repository, whatever its event says', () => {
        // GitHub does not produce this today. If it ever did, quietly taking the older release
        // beneath it would leave the mirror behind Hosting, so the run stops and says so.
        const r = plan({ EVENT: 'workflow_dispatch' },
            { runs: [run({ run_number: 48, event: 'workflow_dispatch', head_sha: F, head_repository: stranger }), ...RUNS] });
        assert.equal(r.status, 1, `a run from another repository was taken:\n${r.out}`);
        assert.match(r.out, /did not come from this repository/);
        assert.equal(r.outputs.go, undefined, r.out);
    });

    test('a manual run with no release to publish fails rather than publishing something', () => {
        const r = plan({ EVENT: 'workflow_dispatch' }, { runs: [RUNS[0], RUNS[3]] });
        assert.equal(r.status, 1, r.out);
        assert.match(r.out, /There is no successful Hosting release on main to publish/);
    });

    test('a re-run publishes the newest release, not the older one it was first given', () => {
        // Re-running replays the event: this run was first given A, and B has been released since.
        const r = plan({ ...finished({ RUN_SHA: A }), ATTEMPT: '2' });
        assert.deepEqual(r.outputs, { sha: B, go: 'true' }, `a re-run put the mirror back on an older release:\n${r.out}`);
    });

    test('while Pages still builds from the branch, nothing is published and main is not asked', () => {
        const r = plan(finished({ RUN_SHA: A }), { build_type: 'legacy' });
        assert.equal(r.status, 0, r.out);
        assert.deepEqual(r.outputs, { go: 'false' }, r.out);
        assert.ok(!r.calls.some(c => c.includes('/compare/')), 'the inert workflow must not gain a new way to fail');
    });
});

// ── A RE-RUN NEVER PUTS AN OLDER TREE LIVE (whole-app review, 10 Nov 2026) ──────────────────────
//
// A re-run replays its run's own commit, up to 30 days later, and the deploy-failure notice used to
// say "re-run the workflow". Release A fails, B deploys, A is re-run: A's older tree goes live over
// B with a green run — and for Rules that is older SECURITY rules, with nothing watching. The three
// deploys now call one action that stops a re-run once a newer run of the same workflow exists. Its
// script is run here against a stubbed run list, and its wiring is held in each deploy job.
describe('a re-run never puts an older tree live', () => {
    const ACTION = '.github/actions/refuse-overtaken-rerun/action.yml';
    const script = stepScript(readFileSync(ACTION, 'utf8'), 'Stop a re-run that a newer run of this workflow has overtaken');
    const REF = 'owner/roster-app/.github/workflows/deploy-functions.yml@refs/heads/main';
    const run = (/** @type {number} */ n, /** @type {string} */ event, branch = 'main') => ({ run_number: n, event, head_branch: branch,
        status: 'completed', conclusion: 'failure', head_sha: String(n % 10).repeat(40) });

    /**
     * @param {Record<string, string>} env
     * @param {object[]} runs newest first, as the API lists them
     */
    const check = (env, runs) => {
        const dir = mkdtempSync(join(tmpdir(), 'rerun-'));
        try {
            const bin = join(dir, 'bin');
            mkdirSync(bin);
            writeGhStub(bin);
            writeFileSync(join(dir, 'check.sh'), script);
            writeFileSync(join(dir, 'fixture.json'), JSON.stringify({ runs, on_main: {} }));
            writeFileSync(join(dir, 'calls'), '');
            const vars = { ...process.env, PATH: `${bin}:${process.env.PATH}`, GH_STUB: join(dir, 'fixture.json'), GH_LOG: join(dir, 'calls'),
                GITHUB_REPOSITORY: 'owner/roster-app', GH_TOKEN: 'stub', ATTEMPT: '2', RUN_NUMBER: '44', WORKFLOW_REF: REF,
                WORKFLOW: 'Deploy Firebase Functions', ...env };
            let status = 0, out = '';
            try {
                out = execFileSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', 'check.sh'], { cwd: dir, env: vars, encoding: 'utf8', stdio: 'pipe' });
            } catch (/** @type {any} */ e) {
                status = e.status;
                out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
            }
            return { status, out, calls: readFileSync(join(dir, 'calls'), 'utf8').split('\n').filter(Boolean) };
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    };

    test('a first attempt passes straight through, asking nothing', () => {
        const r = check({ ATTEMPT: '1' }, [run(45, 'push'), run(44, 'push')]);
        assert.equal(r.status, 0, r.out);
        assert.deepEqual(r.calls, [], 'the queue keeps first attempts in order; they need no question');
    });

    test('a re-run of the newest run deploys, asking about this workflow by file', () => {
        const r = check({}, [run(44, 'push'), run(40, 'workflow_dispatch')]);
        assert.equal(r.status, 0, r.out);
        assert.match(r.out, /still the newest run/);
        for (const ev of ['push', 'workflow_dispatch']) {
            assert.ok(r.calls.includes(`repos/owner/roster-app/actions/workflows/deploy-functions.yml/runs?branch=main&event=${ev}&per_page=1`),
                `expected a question about ${ev} runs of deploy-functions.yml, got:\n${r.calls.join('\n')}`);
        }
    });

    test('a re-run that a newer push has overtaken stops, and says what to do', () => {
        const r = check({}, [run(45, 'push'), run(44, 'push')]);
        assert.equal(r.status, 1, `an overtaken re-run went ahead:\n${r.out}`);
        assert.match(r.out, /::error title=A newer deploy has overtaken this run::This is a re-run of run #44, and run #45/);
        assert.match(r.out, /Run workflow, on main/);
    });

    test('so does one that a newer run started by hand has overtaken', () => {
        const r = check({}, [run(46, 'workflow_dispatch'), run(44, 'push')]);
        assert.equal(r.status, 1, r.out);
    });

    test('runs on other branches, and a stranger\'s pull-request runs, overtake nothing', () => {
        // A branch run deploys nothing; a pull-request run named like a deploy is anybody's to start,
        // and must not be a way to block the owner's re-run.
        const r = check({}, [run(48, 'pull_request'), run(47, 'workflow_dispatch', 'claude/branch'), run(44, 'push')]);
        assert.equal(r.status, 0, r.out);
    });

    test('a re-run that cannot tell which workflow it is stops rather than guessing', () => {
        const r = check({ WORKFLOW_REF: 'owner/roster-app/somewhere-else' }, [run(44, 'push')]);
        assert.equal(r.status, 1, r.out);
        assert.match(r.out, /Cannot check this re-run/);
    });

    for (const wf of ['deploy-hosting.yml', 'deploy-functions.yml', 'deploy-rules.yml']) {
        test(`${wf}: the check runs right after the checkout, before any credential, and can read the runs`, () => {
            const src = readFileSync(join(WF_DIR, wf), 'utf8');
            const deploy = src.slice(src.search(/^ {2}deploy:[ \t]*$/m), src.search(/^ {2}not-main:[ \t]*$/m));
            const checkout = deploy.indexOf('uses: actions/checkout@');
            const guard = deploy.indexOf('uses: ./.github/actions/refuse-overtaken-rerun');
            const signIn = deploy.indexOf('uses: google-github-actions/auth@');
            assert.ok(guard > -1, `${wf}: the deploy job no longer checks a re-run — an old run re-run would put its older tree live`);
            assert.ok(checkout > -1 && checkout < guard && guard < signIn,
                `${wf}: the re-run check must come after the checkout (it is a local action) and before the sign-in`);
            assert.ok(!/- name:|- uses:/.test(deploy.slice(checkout + 1, deploy.lastIndexOf('- name:', guard))),
                `${wf}: nothing may run between the checkout and the re-run check — a refused re-run should cost nothing`);
            assert.match(deploy, /^ {6}actions: read\b/m, `${wf}: listing the workflow's runs needs actions: read, or the check fails every re-run`);
        });
    }

    test('the failure notice no longer sends the reader to Re-run first', () => {
        const action = readFileSync('.github/actions/report-deploy-failure/action.yml', 'utf8');
        assert.match(action, /choose \*\*Run workflow\*\* on"/, 'step 2 must recommend Run workflow on main');
        assert.match(action, /\*\*Re-run\*\* is fine only while this is the newest run/, 'and say when a re-run is safe');
    });
});

// ── THE VISUAL LANE IS REPORT-ONLY, AND THEREFORE HAS TO SPEAK (2 Sep 2026) ────────────────────
//
// Two halves of one decision, and each is worthless without the other.
//
// The lane must NOT gate: pixel diffs are environment-sensitive, and a release blocked on a
// renderer difference nobody can act on teaches everyone to skip the check. So `continue-on-error`.
//
// But a non-blocking job on a green run is INDISTINGUISHABLE from a passing one. The diffs were
// uploaded as an artifact from the day the job was written, and a real drift still went unread for
// eight releases (v22.38 → v22.45) — nobody opens a zip on a run that says it passed. A signal you
// have to go looking for is not a signal.
//
// So the job now comments on the pull request, and these contracts hold the pairing together: drop
// `continue-on-error` and a rendering difference starts blocking releases; drop the notifier and the
// lane goes quiet again, with nothing failing to say so. Both are one-line edits.
// The WebKit lane (`visual-webkit`) joined at the v24.28 review: it had the same continue-on-error
// posture and NEITHER voice, so a drifted Safari baseline was exactly the unread artifact this block
// was written about. Same contracts, its own marker and check name so the two lanes never overwrite
// each other's report.
for (const [JOB, MARKER, CHECK] of [
    ['visual', '<!-- visual-baseline-drift -->', 'visual baselines'],
    ['visual-webkit', '<!-- visual-baseline-drift-webkit -->', 'visual baselines (webkit)'],
]) describe(`the ${JOB} lane never gates, and never goes quiet`, () => {
    const src = readFileSync(join(WF_DIR, 'e2e.yml'), 'utf8');
    const jobsAt = src.search(/^jobs:/m);
    const body = src.slice(jobsAt);
    const start = body.search(new RegExp(`^ {2}${JOB}:[ \\t]*$`, 'm'));
    const rest = start === -1 ? '' : body.slice(start + 1);
    const nextJob = rest.search(/^ {2}[A-Za-z_][\w-]*:[ \t]*$/m);
    const job = nextJob === -1 ? rest : rest.slice(0, nextJob);

    test(`the ${JOB} job exists`, () => {
        assert.ok(start > -1, `e2e.yml has no \`${JOB}:\` job`);
    });

    test('it cannot fail a build on a rendering difference', () => {
        assert.match(job, /^ {4}continue-on-error: true[ \t]*$/m,
            `the ${JOB} job must stay continue-on-error. Baselines are captured on one machine and `
            + 'compared on another; making them blocking gates every release on renderer noise.');
    });

    test('the comparison CAPTURES its outcome instead of swallowing it', () => {
        // A bare `|| true` keeps the job green and discards the one fact the notifier needs. The
        // outcome has to reach a step output or there is nothing to report on.
        assert.match(job, /^ {8}id: compare[ \t]*$/m,
            'the comparison step needs an `id` so its outcome can be read downstream');
        assert.match(job, /drifted=true[\s\S]{0,200}GITHUB_OUTPUT|GITHUB_OUTPUT[\s\S]{0,200}drifted=true/,
            'the comparison step must write a `drifted` output — otherwise its result is discarded '
            + 'and the run is green whether or not the baselines matched');
    });

    test('and it says so where somebody is already looking', () => {
        assert.match(job, /^ {6}pull-requests: write[ \t]*$/m,
            'without pull-requests:write the notifier runs and the API call fails — a notifier that '
            + 'reports nothing is worse than none, because the run still goes green');
        assert.ok(job.includes(`MARKER='${MARKER}'`),
            'the notifier must carry a stable HTML marker, or it posts a fresh comment per push '
            + 'instead of updating one');
        assert.match(job, /gh pr comment/,
            `the ${JOB} job must actually say something on the pull request`);
    });

    test('the notifier cannot become the failure it is reporting', () => {
        // It runs when something has ALREADY gone wrong (or when it is reassuring you that nothing
        // has). Every write is guarded — and errexit is turned OFF rather than merely left unsaid.
        // GitHub runs `run:` steps as `bash -e {0}`, so a script that simply omits `set -e` still
        // gets it: the first draft of this contract asserted the absence of `set -e` and was
        // therefore checking nothing at all. Only an explicit `set +e` is load-bearing.
        assert.match(job, /^ {10}set \+e\b/m,
            'the notifier must `set +e` explicitly — GitHub invokes run: steps as `bash -e`, so '
            + 'without it an unguarded gh failure abandons the rest of the report');
        for (const call of ['gh pr comment', 'gh api --method PATCH']) {
            const re = new RegExp(`${call}[\\s\\S]{0,400}?\\|\\| echo "::warning::`);
            assert.match(job, re,
                `${call} must end in \`|| echo "::warning::…"\` — this step must never turn a `
                + 'reportable drift into a failed one');
        }
    });

    test('and it says so to a machine, as a check whose conclusion IS the drift', () => {
        // The job is continue-on-error, so its own conclusion is `success` either way. The check
        // run is the only field a script can read the drift from; `neutral` keeps it non-blocking.
        assert.ok(job.includes(`-f name='${CHECK}'`), `the ${JOB} job must publish its own "${CHECK}" check run`);
        assert.match(job, /^ {6}checks: write[ \t]*$/m, 'publishing a check run needs checks: write');
        assert.match(job, /CONCLUSION=neutral/, 'a drift must conclude neutral — visible, never blocking');
    });
});


describe('the version guard exempts only what cannot go stale', () => {
    /**
     * The `version` job refuses a branch that changes a served file while claiming a version main
     * already has — the v22.29 double-ship, which produces no merge conflict and leaves
     * `service-worker.js` byte-identical across two releases.
     *
     * Its exclusion list is the whole rule, and it can be wrong in two directions that are nothing
     * alike.
     *
     * TOO NARROW cries wolf. `package.json` registering a new test suite failed the job at v22.56
     * — a false alarm, and a version guard that fires on changes needing no bump is one somebody
     * learns to bump past without reading. That is how the guard stops working while staying green.
     *
     * TOO WIDE is silent and is the direction with teeth. Widening the list to quiet a failure is
     * the obvious fix under time pressure, and exempting `.js`, `firebase.json` or the rules would
     * disarm the guard for exactly the files it exists for, with nothing to show for it.
     *
     * The criterion, stated once so the list can be reasoned about rather than pattern-matched:
     * **can a stale copy of this file reach a member's device?** Only what the service worker
     * caches can, plus what carries policy at the edge.
     */
    const e2eSrc = readFileSync(join(WF_DIR, 'e2e.yml'), 'utf8');
    // Found by the diff it filters, whatever the list is assigned to, and reported INSIDE a test: an
    // assertion thrown while this block is being set up registers none of its tests, and a run
    // narrowed with --test-name-pattern then passes having checked nothing (10 Nov 2026).
    const exclusion = (() => {
        const from = e2eSrc.indexOf('--name-only --no-renames origin/main...HEAD');
        const m = from > -1 ? /grep -z?vE "([^"]+)"/.exec(e2eSrc.slice(from)) : null;
        return m ? new RegExp(m[1]) : null;
    })();
    /** True when the guard would DEMAND a version bump for a change to this path. */
    const needsBump = (/** @type {string} */ path) => {
        assert.ok(exclusion, 'the version job no longer filters the files it diffs against main with grep -vE');
        return !exclusion.test(path);
    };

    test('the version job\'s exclusion list is found', () => {
        assert.ok(exclusion, 'the version job no longer filters the files it diffs against main with grep -vE');
    });

    test('a change that cannot reach a device is exempt', () => {
        for (const f of ['package.json', 'package-lock.json', 'jsconfig.json', 'eslint.config.js',
                         'playwright.config.mjs', 'playwright.visual.mjs', 'githooks/pre-commit',
                         'docs/AI_MAP.md', 'CLAUDE.md', 'workflow-hygiene.test.mjs',
                         'e2e/pages.spec.js', 'scripts/bump-version.mjs',
                         // 10 Nov 2026 review: tooling the app never fetches.
                         '.gitignore', '.prettierrc', '.firebaserc', '.nojekyll', 'generate-sri.mjs']) {
            assert.equal(needsBump(f), false,
                `${f} cannot go stale on a device — the service worker does not cache it — so `
                + 'demanding a version bump for it is a false alarm, and false alarms are how this '
                + 'guard gets bumped past unread');
        }
    });

    test('everything a member can actually be served STILL demands one', () => {
        for (const f of ['paycalc-app.js', 'roster-data.js', 'service-worker.js', 'index.html',
                         'paycalc.css', 'shared.css', 'manifest.json',
                         // Not cached, but policy at the edge: the CSP header, the cache rules and
                         // the security rules all change what a device is allowed to do.
                         'firebase.json', 'firestore.rules', 'storage.rules',
                         // A file INSIDE a dot-directory is served (hosting-ignore-parity measured it):
                         // only a NAME starting with a dot is exempt, never a path beneath one.
                         '.well-known/assetlinks.json', 'icons/.cache/icon.png']) {
            assert.equal(needsBump(f), true,
                `${f} is exempt from the version guard. If that was done to quiet a failing job, `
                + 'it disarmed the guard for precisely the files it exists to protect.');
        }
    });

    test('it exempts whatever the Hosting deploy skips, except where a stale copy can still reach a device', () => {
        // THE THIRD LIST (10 Nov 2026 review). deploy-hosting.yml's paths-ignore answers "can a change
        // to this alone reach the served app?" and hosting-ignore-parity holds it to firebase.json.
        // This exclusion answers nearly the same question for the version, and was held to neither:
        // generate-sri.mjs, skipped by the deploy, still demanded a bump here. So every pattern the
        // deploy skips must be exempt here too, unless it is named below with the reason it is not.
        const hosting = readFileSync(join(WF_DIR, 'deploy-hosting.yml'), 'utf8');
        const skips = [...hosting.slice(hosting.indexOf('paths-ignore:'), hosting.indexOf('workflow_dispatch:'))
            .matchAll(/^\s*-\s+(.+?)\s*$/gm)].map(m => m[1].replace(/^(['"])(.*)\1$/, '$2'));
        assert.ok(skips.length > 20, `only ${skips.length} paths-ignore entries read — the reader has stopped matching`);
        /** @type {Record<string, string>} */
        const STILL_BUMPS = {
            'functions/**': 'a Functions change is versioned (CLAUDE.md → Version bumping)',
            'firestore.rules': 'security rules are versioned (CLAUDE.md → Version bumping)',
            'storage.rules': 'security rules are versioned (CLAUDE.md → Version bumping)',
            'firestore.indexes.json': 'left for the owner to decide (10 Nov 2026 review); it demands a bump until then',
            '**/*.pdf': 'the Pages mirror serves the whole tree, and the service worker keeps what the app opens',
            '**/*.jpg': 'the Pages mirror serves the whole tree, and the service worker keeps what the app opens',
            '**/*.jpeg': 'the Pages mirror serves the whole tree, and the service worker keeps what the app opens',
            '**/*.zip': 'the Pages mirror serves the whole tree, and the service worker keeps what the app opens',
        };
        // Never committed, so never in a diff: either answer would be right.
        const NEVER_COMMITTED = ['.git/**', 'example-payslips/**', 'playwright-report/**', 'test-results/**'];
        /** A path that pattern matches — the three shapes hosting-ignore-parity allows the skip list. */
        const sample = (/** @type {string} */ p) => p.endsWith('/**') ? `${p.slice(0, -2)}x.js` : p.startsWith('**/*') ? `x${p.slice(4)}` : p;
        for (const p of Object.keys(STILL_BUMPS)) assert.ok(skips.includes(p), `${p} is no longer skipped by the deploy — drop it from the list here`);
        for (const p of skips) {
            if (NEVER_COMMITTED.includes(p)) continue;
            assert.equal(needsBump(sample(p)), p in STILL_BUMPS, p in STILL_BUMPS
                ? `${sample(p)} is exempt from the version guard, but ${STILL_BUMPS[p]}`
                : `deploy-hosting.yml skips a deploy for ${p}, so a change to it alone cannot reach a device — but the version `
                    + `guard still demands a bump for ${sample(p)}. Exempt it in e2e.yml's version job, or name it here with a reason.`);
        }
    });

    test('and so does EVERY file the service worker precaches, read from the worker itself', () => {
        // The list above is a sample, and a sample proves only itself (whole-app review, I5):
        // appending `|[.]png$|[.]woff2$` to the exclusion passed every assertion in this block,
        // while the icons and the font are precached into the version cache — a changed icon
        // shipped without a bump stays the OLD icon on every device that already has this version.
        // So the corpus is the warm-up's own arrays, derived the way sw-asset-check derives them:
        // from the fetchInBatches calls, not from array names typed here.
        const sw = readFileSync('service-worker.js', 'utf8');
        const arrayOf = (/** @type {string} */ n) =>
            sw.match(new RegExp(`const ${n}\\s*=\\s*\\[([\\s\\S]*?)\\];`))?.[1] ?? '';
        const warmed = [...sw.matchAll(/fetchInBatches\(([\s\S]*?),\s*\w+\s*=>/g)]
            .flatMap(m => [...m[1].matchAll(/([A-Z_]+_ASSETS)/g)].map(x => x[1]));
        const served = warmed
            .flatMap(n => arrayOf(n).split('\n').filter(l => !l.trim().startsWith('//')))
            .flatMap(l => [...l.matchAll(/['"]\.\/([^'"]+)['"]/g)].map(m => m[1]));
        assert.ok(served.length > 100,
            `only ${served.length} precached files found — the warm-up scan has stopped matching`);
        for (const ext of ['.js', '.css', '.html', '.png', '.woff2', '.json']) {
            assert.ok(served.some(f => f.endsWith(ext)), `the precache scan found no ${ext} file`);
        }
        const exempt = served.filter(f => !needsBump(f));
        assert.deepEqual(exempt, [],
            `the version guard exempts files the service worker precaches: ${exempt.join(', ')}. `
            + 'A change to one of these reaches devices only through a new version cache.');
    });

    test('and the guard still fails the branch rather than warning', () => {
        // A guard that prints and exits 0 is a comment. This one is the reason the v22.29 duplicate
        // could not happen again, and only a non-zero exit delivers that.
        const job = e2eSrc.slice(e2eSrc.indexOf('  version:'), e2eSrc.indexOf('  unit:'));
        assert.match(job, /::error::/, 'the version job must annotate the failure');
        assert.match(job, /exit 1/, 'the version job must FAIL, not warn');
    });

    // RUN, NOT READ (10 Nov 2026 review). The landed check was asserted by regex and never run, and it
    // handed its file list to git through an unquoted $( ): `new feature/app.js` became two paths that
    // exist nowhere, the diff came back empty, and an unbumped served change passed as "landed". So the
    // job's own script runs here, in a throwaway repository with a bare `origin`, on a branch off main.
    describe('run against a real repository', () => {
        const script = stepScript(e2eSrc, 'A runtime change must claim a version main has not');
        const GIT_ENV = { GIT_AUTHOR_NAME: 'ci', GIT_AUTHOR_EMAIL: 'ci@example.invalid', GIT_COMMITTER_NAME: 'ci',
            GIT_COMMITTER_EMAIL: 'ci@example.invalid', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
        const MAIN = { 'roster-data.js': "export const APP_VERSION = '25.64';\n", 'index.html': '<p>one</p>\n' };

        /**
         * Builds main, then a branch that writes `files` (with `bump` as its version), and — with
         * `alsoOnMain` — gives main the same files, as a squash merge would. Runs the job's script there.
         * @param {Record<string, string>} files
         * @param {{ bump?: string, alsoOnMain?: boolean, failLandedDiff?: boolean }} [o]
         */
        const verdict = (files, o = {}) => {
            const dir = realpathSync(mkdtempSync(join(tmpdir(), 'version-guard-')));
            const work = join(dir, 'work');
            const env = { ...process.env, ...GIT_ENV };
            const git = (/** @type {string[]} */ ...args) => execFileSync('git', args, { cwd: work, env, stdio: 'pipe' });
            const write = (/** @type {Record<string, string>} */ fs) => {
                for (const [f, body] of Object.entries(fs)) {
                    mkdirSync(dirname(join(work, f)), { recursive: true });
                    writeFileSync(join(work, f), body);
                }
            };
            try {
                mkdirSync(work);
                execFileSync('git', ['init', '-q', '--bare', '-b', 'main', join(dir, 'origin.git')], { env, stdio: 'pipe' });
                git('init', '-q', '-b', 'main');
                git('remote', 'add', 'origin', join(dir, 'origin.git'));
                write(MAIN);
                git('add', '-A');
                git('commit', '-qm', 'main');
                git('push', '-q', 'origin', 'main');
                git('checkout', '-qb', 'feature');
                const mine = o.bump ? { ...files, 'roster-data.js': `export const APP_VERSION = '${o.bump}';\n` } : files;
                write(mine);
                git('add', '-A');
                git('commit', '-qm', 'feature');
                if (o.alsoOnMain) {
                    git('checkout', '-q', 'main');
                    write(mine);
                    git('add', '-A');
                    git('commit', '-qm', 'the same change, squash-merged');
                    git('push', '-q', 'origin', 'main');
                    git('checkout', '-q', 'feature');
                }
                writeFileSync(join(dir, 'version.sh'), script);
                const bin = join(dir, 'bin');
                mkdirSync(bin);
                // A git that fails the landed check's comparison and nothing else, for the one case
                // that cannot be produced honestly: that comparison failing.
                const real = execFileSync('bash', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
                writeFileSync(join(bin, 'git'), '#!/usr/bin/env bash\n'
                    + 'if [ "$1" = diff ] && [[ " $* " == *" origin/main HEAD "* ]]; then echo "fatal: simulated" >&2; exit 128; fi\n'
                    + `exec ${JSON.stringify(real)} "$@"\n`, { mode: 0o755 });
                const PATH = o.failLandedDiff ? `${bin}:${process.env.PATH}` : process.env.PATH;
                try {
                    return { status: 0, out: execFileSync('bash', ['-e', join(dir, 'version.sh')],
                        { cwd: work, env: { ...env, PATH, RUNNER_TEMP: dir }, encoding: 'utf8', stdio: 'pipe' }) };
                } catch (/** @type {any} */ e) {
                    return { status: e.status, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
                }
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        };

        test('tooling the app never fetches needs no bump', () => {
            const r = verdict({ '.gitignore': 'x\n', '.prettierrc': '{}\n', '.firebaserc': '{}\n', '.nojekyll': '', 'generate-sri.mjs': '//\n' });
            assert.equal(r.status, 0, `a change to tooling alone failed the guard:\n${r.out}`);
            assert.match(r.out, /No served file changed/);
        });

        test('a served change without a bump is refused, and with one it passes', () => {
            const refused = verdict({ 'index.html': '<p>two</p>\n' });
            assert.equal(refused.status, 1, refused.out);
            assert.match(refused.out, /::error::This branch changes served files but its version \(v25\.64\) does not exceed main/);
            const bumped = verdict({ 'index.html': '<p>two</p>\n' }, { bump: '25.65' });
            assert.equal(bumped.status, 0, bumped.out);
            assert.match(bumped.out, /v25\.65 is above v25\.64/);
        });

        test('a served file whose name has a space in it is still checked, not waved through as landed', () => {
            const r = verdict({ 'new feature/app.js': 'export {};\n' });
            assert.equal(r.status, 1, `an unbumped served change passed:\n${r.out}`);
            assert.doesNotMatch(r.out, /it has landed/);
        });

        test('a name git would read as a pattern is matched as a name', () => {
            // `:(glob)z` is pathspec magic for "a file called z". Matched as a pattern it finds nothing to
            // compare, which reads as "landed"; literally, it is the new file it is.
            const r = verdict({ ':(glob)z': 'export {};\n' });
            assert.equal(r.status, 1, `an unbumped served change passed:\n${r.out}`);
        });

        test('a branch main already carries is let through, by content', () => {
            const r = verdict({ 'index.html': '<p>two</p>\n' }, { alsoOnMain: true });
            assert.equal(r.status, 0, r.out);
            assert.match(r.out, /it has landed/);
        });

        test('a comparison with main that fails is not taken for "landed"', () => {
            const r = verdict({ 'index.html': '<p>two</p>\n' }, { failLandedDiff: true });
            assert.equal(r.status, 1, `a failed comparison let an unbumped change through:\n${r.out}`);
            assert.match(r.out, /does not exceed main/);
        });
    });
});

describe('the dependency audit separates a finding from an outage', () => {
    // WHY THIS BLOCK EXISTS. `npm audit` exits non-zero both when it FINDS a high-severity
    // advisory and when it cannot REACH npm's audit service, so `--audit-level=high` gates on a
    // signal that cannot tell them apart. On 4 Sep 2026 a ~20-minute npm outage skipped a Functions
    // deploy with nothing wrong with the code — an unknown laundered into a finding.
    //
    // The logic now lives in ONE place, scripts/audit-functions-deps.sh, because two callers want
    // opposite POLICIES on an unknown and a duplicated 30-line shell script is how they drift:
    // the weekly monitor must fail (one run a week IS the coverage), the deploy gate must not
    // (npm's uptime should not veto an emergency release). Both say "did NOT run", so neither a
    // red job nor a green one can be mistaken for a verdict on the dependencies.
    //
    // These contracts are STATIC because this suite runs on a bare Node binary — the script needs
    // `npm` and `jq`. Its behaviour was verified by execution against stubbed reports (unreachable,
    // clean, vulnerable, empty, non-JSON) under both policies, 11 cases; what is pinned here is the
    // wiring those cases cannot see: that both callers still use it, and with the right policy.
    const AUDIT_SH = 'scripts/audit-functions-deps.sh';
    const shSrc = readFileSync(AUDIT_SH, 'utf8');
    const callers = {
        // path                                   → the policy that path must declare
        '.github/workflows/deploy-functions.yml': '0',
        '.github/workflows/functions-audit.yml':  '1',
    };

    test('a real high or critical advisory fails, and that is not configurable', () => {
        assert.match(shSrc, /\.metadata\.vulnerabilities\.critical/,
            'the verdict must be read from the report, not inferred from the exit code');
        assert.match(shSrc, /\.metadata\.vulnerabilities\.high/,
            'high must be read as well as critical — high is the level this gate was set at');
        const findingBranch = shSrc.slice(shSrc.indexOf('if [ "$crit" -gt 0 ]'));
        assert.match(findingBranch, /exit 1/,
            'a found advisory must FAIL. Fail-open on an unreachable service is the point of this '
            + 'script; fail-open on a finding would delete it.');
        assert.doesNotMatch(findingBranch, /AUDIT_UNKNOWN_IS_FAILURE/,
            'the finding branch must not consult the unknown-policy knob. The knob exists to decide '
            + 'what SILENCE means; letting it reach a real advisory would make the deploy path able '
            + 'to ship a known critical CVE by setting one environment variable.');
    });

    test('an unknown is announced as an unknown under BOTH policies', () => {
        const unknown = shSrc.slice(shSrc.indexOf('if [ -z "$report" ]'),
                                    shSrc.indexOf('crit=$('));
        assert.match(unknown, /::error title=Dependency audit did NOT run/,
            'the failing policy must say the check did not RUN — a bare failure here reads as a '
            + 'vulnerability, which is the confusion this whole change removes');
        assert.match(unknown, /::warning title=Dependency audit did NOT run/,
            'the proceeding policy must still announce itself. Proceeding silently would launder '
            + 'an unknown into a clean bill of health — silence is not success.');
    });

    test('a report it cannot interpret is a failure, not a clean bill of health', () => {
        // FOUND BY THE REGRESSION CHECK, and introduced by this very rewrite: with the counts read
        // out of the report, a metadata block of {"critical":{"count":3}} made `[ "$crit" -gt 0 ]`
        // error, the `if` false, and the script exit 0 — three critical advisories reported as
        // clean. `set -e` is deliberately off (the unknown branch needs it that way), so nothing
        // stopped it. The old --audit-level gate could not have this bug, which is precisely why a
        // rewrite of a security gate gets checked rather than trusted.
        assert.match(shSrc, /\*\[!0-9\]\*/,
            'the counts must be validated as integers before they are compared');
        const guard = shSrc.slice(shSrc.indexOf('case "${crit}${high}"'));
        assert.match(guard.slice(0, guard.indexOf('esac')), /exit 1/,
            'an uninterpretable report must FAIL. It is not the unknown branch — the audit RAN, we '
            + 'simply cannot read it, and guessing at a shape change is how a real CVE ships.');
    });

    test('a missing or broken toolchain blames us, and stops, under both policies', () => {
        assert.match(shSrc, /"\$tool" --version/,
            'the tools must be proven to RUN. `command -v` passes for a jq that exists and is '
            + 'broken, and a broken jq lands in the unknown branch exactly like an absent one — so '
            + 'the deploy path would warn-and-proceed for ever, blaming npm for our own runner.');
        const tools = shSrc.slice(shSrc.indexOf('for tool in'), shSrc.indexOf('report=$('));
        assert.match(tools, /exit 2/,
            'a toolchain failure must exit distinctly from both a finding (1) and a clean run (0)');
        assert.doesNotMatch(tools, /AUDIT_UNKNOWN_IS_FAILURE/,
            'neither policy may soften this: an unknown policy is about npm being unreachable, and '
            + 'our own missing tool is not that');
    });

    test('the script refuses to guess a policy the caller did not state', () => {
        // This pins the CONDITION, not the message. The first cut asserted only that the wording
        // was present, and a mutation that wrapped the whole guard in `if false` sailed through
        // with the string still sitting in dead code — a test passing on the evidence of a thing
        // rather than the thing.
        assert.match(shSrc, /if \[ -z "\$\{AUDIT_UNKNOWN_IS_FAILURE:-\}" \]; then/,
            'the unset check must be a live condition on the variable itself');
        assert.match(shSrc, /AUDIT_UNKNOWN_IS_FAILURE must be set/,
            'and it must say what the caller has to do');
        assert.doesNotMatch(shSrc, /\$\{AUDIT_UNKNOWN_IS_FAILURE:(=|-[^}])/,
            'no default may be substituted for the variable. A default silently picks a policy for '
            + 'a caller that never considered it — and the safe-LOOKING default (fail on unknown) '
            + 'is the one that re-creates the outage-blocks-deploy bug on the deploy path.');
    });

    for (const [wf, policy] of Object.entries(callers)) {
        const wfSrc = readFileSync(wf, 'utf8');
        const role = policy === '1' ? 'weekly monitor' : 'deploy gate';

        test(`${wf} (${role}) uses the shared script, not its own copy`, () => {
            assert.match(wfSrc, new RegExp(AUDIT_SH.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
                `${wf} must call ${AUDIT_SH}. A second copy of this logic is how the two policies `
                + 'drift apart, and the drift is invisible until an npm outage.');
            assert.doesNotMatch(wfSrc, /--audit-level/,
                '`--audit-level=high` gates on the exit code that cannot distinguish a CVE from an '
                + 'outage. Restoring it re-opens the bug this script was written to close.');
        });

        test(`${wf} states its unknown-policy explicitly as ${policy}`, () => {
            const m = /AUDIT_UNKNOWN_IS_FAILURE:\s*'([01])'/.exec(wfSrc);
            assert.ok(m, `${wf} must set AUDIT_UNKNOWN_IS_FAILURE — the script refuses without it`);
            assert.equal(m[1], policy, policy === '1'
                ? 'the weekly monitor is the only run that week; an audit that did not happen must '
                  + 'not pass as a clean week'
                : 'the deploy gate must not block a release on npm being reachable — that is the '
                  + '4 Sep 2026 outage, in which a correct tree could not ship');
        });
    }
});

describe('every workflow that installs also caches the install', () => {
    // `cache: npm` caches ~/.npm (the tarball store), NOT node_modules — `npm ci` still unpacks and
    // links everything, so it removes fetch time and not install time. It is free and strictly
    // better; it is NOT a cure for a slow install, and deploy-hosting still spent 6m05s installing
    // WITH it enabled (measured 4 Sep 2026). Guarded because a missing one is invisible: the job
    // just takes longer, which reads as ordinary CI slowness rather than as a missing line.
    for (const f of readdirSync(WF_DIR).filter(n => n.endsWith('.yml'))) {
        const src = readFileSync(join(WF_DIR, f), 'utf8');
        if (!/npm ci\b/.test(src)) continue;
        test(`${f} caches npm`, () => {
            assert.match(src, /cache:\s*'?npm'?/,
                `${f} runs 'npm ci' with no npm cache on any setup-node step. Add `
                + "`cache: 'npm'` — it is keyed on the lockfile, so a dependency change still "
                + 'invalidates it.');
        });
    }
});

// ── THE LOCAL TEST SERVER NEVER PICKS A PORT THE BROWSER REFUSES (3 Nov 2026) ──────────────────────
//
// e2e/dev-server.mjs derives each checkout's port, base + (path hash % SPREAD), so two worktrees USUALLY
// get two ports; when they do not, e2e/server-identity.mjs refuses the other checkout's server
// (server-identity.test.mjs). Chromium refuses port 4045 outright (net::ERR_UNSAFE_PORT, before
// any request) and 4001 + 44 is 4045: one checkout path in 120 failed EVERY browser test with an error
// naming no file of ours, and nothing guarded it. These read the bases from the configs and try every
// value the hash can take, so no future base, spread or refused port escapes them by not being listed.
describe('the local test server never picks a port the browser refuses', () => {
    const bases = [...new Set(readdirSync('.')
        .filter(f => /^playwright\..*\.mjs$/.test(f))
        .flatMap(f => [...readFileSync(f, 'utf8').matchAll(/devServer\((\d+)\)/g)].map(m => Number(m[1]))))].sort((a, b) => a - b);
    /** Each base's block (6 Nov 2026), and the port in it before any refused-port move — the
     *  formula reconstructed here from the configs' own bases, independently of the module. */
    const raw = (/** @type {number} */ base, /** @type {number} */ n) => base + bases.indexOf(base) * SPREAD + (n % SPREAD);

    test('the configs\' bases were actually read, and each has a block in the module', () => {
        assert.ok(bases.length >= 3, `expected the smoke, offline and visual-webkit bases, read ${bases.join(', ') || 'none'}`);
        assert.deepEqual([...BASES].sort((a, b) => a - b), bases,
            'e2e/dev-server.mjs BASES must list exactly the base ports the playwright configs pass to devServer()');
        assert.ok(bases.some(b => BROWSER_REFUSED_PORTS.some(p => p >= raw(b, 0) && p < raw(b, 0) + SPREAD)),
            'premise: a refused port lies in some base\'s block — if not, the move below is never exercised');
    });

    test('no two configs, in any two checkouts, can land on one port (6 Nov 2026 review)', () => {
        // The bases are one apart and each used to draw from the 120 ports above it, so one checkout's
        // offline server and another's smoke server could share a port and adopt each other — 120 of
        // the 122 reachable ports were reachable from more than one config. The test above this one
        // compared moved ports with unmoved ones and never configs with each other, so it stayed green.
        const reach = new Map(bases.map(b => [b, new Set(Array.from({ length: 0x10000 }, (_, n) => portFor(b, n)))]));
        for (const a of bases) for (const b of bases) {
            if (a >= b) continue;
            const shared = [...reach.get(a)].filter(p => reach.get(b).has(p));
            assert.deepEqual(shared.slice(0, 5), [],
                `bases ${a} and ${b} can both derive port${shared.length > 1 ? 's' : ''} ${shared.slice(0, 5).join(', ')}${shared.length > 5 ? ` (${shared.length} in all)` : ''}: two checkouts' servers on one port collide, and one of the two runs is refused`);
        }
    });

    test('no value the path hash can take gives a refused port', () => {
        for (const base of bases) {
            assert.ok(!BROWSER_REFUSED_PORTS.includes(base), `base ${base} is refused, and CI uses the base unchanged`);
            for (let n = 0; n <= 0xffff; n++) {
                const port = portFor(base, n);
                if (BROWSER_REFUSED_PORTS.includes(port)) assert.fail(`base ${base}, hash ${n}: port ${port} is one the browser refuses`);
            }
        }
    });

    test('only a refused port moves, and never onto a port another checkout uses', () => {
        // Moving to the NEXT port would land on another checkout's, and two checkouts on one port is a
        // collision — refused now by server-identity.mjs, but still a lost run for whoever came second.
        const unmoved = new Set();
        const moved = new Set();
        for (const base of bases) {
            for (let n = 0; n <= 0xffff; n++) {
                if (BROWSER_REFUSED_PORTS.includes(raw(base, n))) moved.add(portFor(base, n));
                else {
                    assert.equal(portFor(base, n), raw(base, n), `base ${base}, hash ${n}: a port that was fine must not change`);
                    unmoved.add(raw(base, n));
                }
            }
        }
        assert.ok(moved.size > 0, 'premise: some hash lands on a refused port');
        for (const port of moved) assert.ok(!unmoved.has(port), `a refused port moved to ${port}, which an unaffected checkout uses`);
    });

    test('a checkout whose path hashes to 4045 is served elsewhere — the real functions, from a real directory', () => {
        // The entry point, not only the helper: find a directory the old formula sends to 4045, stand in it,
        // and ask devServerPort and devServer for the port and the command that would start the server.
        const parent = realpathSync(mkdtempSync(join(tmpdir(), 'devport-')));
        let dir = '';
        for (let i = 0; !dir; i++) {
            const candidate = join(parent, `c${i}`);
            if (raw(4001, createHash('sha256').update(candidate).digest().readUInt16BE(0)) === 4045) dir = candidate;
        }
        mkdirSync(dir);
        const was = process.cwd();
        const ci = process.env.CI;
        const pinned = process.env.E2E_DEV_PORT;
        delete process.env.CI;   // CI keeps the base port by design; this is the local derivation
        delete process.env.E2E_DEV_PORT;   // a pin would pass these checks without deriving anything
        try {
            process.chdir(dir);
            const port = devServerPort(4001);
            assert.notEqual(port, 4045, `${dir} still gets the port the browser refuses`);
            const { baseURL, webServer } = devServer(4001);
            assert.equal(baseURL, `http://127.0.0.1:${port}`);
            assert.match(webServer.command, new RegExp(`-p ${port} `), 'the server must bind the port the tests open');
        } finally {
            process.chdir(was);
            if (ci !== undefined) process.env.CI = ci;
            if (pinned !== undefined) process.env.E2E_DEV_PORT = pinned;
            rmSync(parent, { recursive: true, force: true });
        }
    });
});

// ── THE DEPLOY GATE SURVIVES ONE TRANSIENT FAILURE, AND SAYS IT DID (v23.45) ────────────────────
//
// `playwright.config.mjs` is the DEPLOY GATE's config as well as branch CI's, so a single flaky
// test there does not cost a re-run — it costs a release. v23.42 merged, its gate failed on
// `route.fetch: read ECONNRESET` against the local webServer on the 1,130th test, and the version
// staff are served stayed behind until somebody re-ran the job by hand.
//
// The retry is a ONE-TOKEN edit in either direction and its whole justification lives in a comment,
// which is the shape this file already pins for the concurrency rules. Both halves are asserted:
// CI retries (or the gate is one socket reset from blocking a release) and local does NOT (or a
// developer's own flake is hidden from the person best placed to fix it).
describe('the smoke config retries in CI and nowhere else', () => {
    const cfg = readFileSync('playwright.config.mjs', 'utf8');
    // COMMENTS STRIPPED BEFORE MATCHING, and the first cut of this test is why: the comment beside
    // the setting cites `playwright.webkit.mjs` as precedent and QUOTES the expression, so the
    // regex matched prose about the rule while the rule itself said `retries: 0`. Reverting the
    // line left this suite green — a guard satisfied by its own justification. Same stripping, and
    // same reason, as card-header-parity and links-rotation-parity.
    const code = cfg.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

    test('one retry under CI', () => {
        assert.match(code, /retries:\s*process\.env\.CI\s*\?\s*1\s*:\s*0/,
            'playwright.config.mjs must read `retries: process.env.CI ? 1 : 0`. A bare `retries: 0` '
            + 'puts the production deploy one transient socket reset away from not shipping; a bare '
            + '`retries: 1` hides a flake from the developer who could still reproduce it.');
    });

    test('the reasoning names the failure it was written for', () => {
        // Not a style rule. The previous comment asserted the suite was deterministic BECAUSE the
        // CDN dependency was gone — true of the network and false of the webServer — and that
        // sentence is what made the old setting look already-decided. Whoever changes this next
        // should meet the measurement, not the conclusion.
        assert.match(cfg, /ECONNRESET/,
            'keep the measured failure in the comment beside `retries` — it is the evidence that '
            + 'the gate\'s failures are not all real failures.');
    });
});

// ── The currency canary must be able to tell a deploy from a fault ──────────────────────────────
//
// `production-currency.yml` is the one workflow whose failure mode is CREDIBILITY. It emails the
// owner, and it is wrong exactly when a release is slower than its window — so its false alarms
// arrive on a good day, which is the fastest way to teach someone to ignore a channel. It has now
// done that twice (7 Sep, 19 Sep 2026), both times losing a race to a deploy it could not see.
//
// The fix is the stand-down: ask whether a Hosting deploy is in flight. Every assertion below is on
// a way that ask can be present and NOT WORK, because that is the whole risk here — a guard that
// fails open looks identical to a guard that is not needed, and this one already shipped once with
// `$GITHUB_TOKEN` unset, where `set -u` killed the subshell and `|| true` swallowed it.
describe('the currency canary stands down for a deploy in flight', () => {
    const CURRENCY_WF = join(WF_DIR, 'production-currency.yml');
    const src = readFileSync(CURRENCY_WF, 'utf8');
    // The prose explains the trap at length and names every identifier while doing it. Match the
    // script, not its justification — the same stripping the concurrency and retry rules use.
    const code = src.split('\n').map(l => l.replace(/^(\s*)#.*$/, '$1')).join('\n');

    test('the stand-down is actually in the script, not only in the comment', () => {
        assert.match(code, /actions\/workflows\/\$HOSTING_WORKFLOW\/runs/,
            'production-currency.yml no longer asks the Actions API whether a Hosting deploy is '
            + 'running. Without it the only defence is DEPLOY_WINDOW_S, which is a guess at a '
            + 'duration nobody controls — and the next slow deploy wins the race again.');
        assert.match(code, /exit 0/, 'the stand-down must exit BEFORE the stale verdict');
    });

    test('the token it authenticates with is passed in, because a run step is not given one', () => {
        // The failure this pins is invisible: GITHUB_REPOSITORY is exported automatically and
        // GITHUB_TOKEN is not, so under `set -u` the expansion kills the subshell, `|| true`
        // catches it, IN_FLIGHT is empty, and the run reports exactly as it did before. A guard
        // that never fires and never says so.
        assert.match(code, /GITHUB_TOKEN:\s*\$\{\{\s*github\.token\s*\}\}/,
            'the compare step must declare GITHUB_TOKEN in its own `env:` block');
        assert.match(code, /permissions:[\s\S]*?\n\s+actions: read/,
            'reading workflow runs needs `actions: read`; without it the query 403s and the '
            + 'stand-down fails open on every run');
    });

    test('it keys on the workflow FILE, and that file exists', () => {
        // A display-name match ("Hosting" in r['name']) reads fine and stops working silently the
        // day somebody retitles the deploy. The filename is what the repo keys on everywhere else,
        // and it is checkable from here — which is the entire reason to prefer it. Both deploys it
        // waits for: Hosting, and since Oct 2026 the gated Pages mirror that follows it.
        for (const key of ['HOSTING_WORKFLOW', 'PAGES_WORKFLOW']) {
            const m = code.match(new RegExp(`${key}:\\s*(\\S+)`));
            assert.ok(m, `the stand-down must name ${key} by file`);
            assert.ok(readdirSync(WF_DIR).includes(m[1]),
                `production-currency.yml stands down for ${m[1]}, which is not in ${WF_DIR}. The `
                + 'deploy workflow was renamed and the canary now sees no deploy, ever.');
        }
    });

    test('the gated-mirror stand-down asks whether Pages really deploys from the workflow', () => {
        // Without the build_type question, "both origins behind while Hosting runs" would also
        // excuse a mirror whose BRANCH build is broken — the masking v24.23 removed.
        assert.match(code, /\/pages"[^\n]*build_type/, 'the second stand-down must read the Pages build_type');
        assert.match(code, /"\$BUILD_TYPE" = "workflow"/, 'and act only when it is "workflow"');
        assert.match(code, /\n\s+pages: read/, 'reading the Pages settings needs `pages: read`');
    });

    test('the poll cannot outlive the job that runs it, every read hanging', () => {
        // The window and the timeout are two numbers in two places that mean one thing. Raise the
        // window alone and a slow-but-successful deploy becomes a CANCELLED run, which reports
        // neither stale nor current — the canary goes silent in the exact case it was raised for.
        //
        // COUNTED FROM THE SCRIPT, READ BY READ (6 Nov 2026). This compared the timeout with the
        // window plus five minutes, which is not what a poll costs: every pass sleeps AND makes its
        // reads, each up to its own --max-time. When main started being re-read on every pass the
        // worst case grew by 25 × 30s, past the 55-minute limit, and this stayed green.
        const window = Number(code.match(/DEPLOY_WINDOW_S=(\d+)/)?.[1]);
        const poll = Number(code.match(/POLL_S=(\d+)/)?.[1]);
        const timeout = Number(code.match(/timeout-minutes:\s*(\d+)/)?.[1]);
        const maxTime = (/** @type {string} */ fn) =>
            Number(code.match(new RegExp(`${fn}\\(\\)\\s*\\{[^}]*?--max-time (\\d+)`))?.[1]);
        const origin = maxTime('version_of'), main = maxTime('expected_on_main');
        assert.ok([window, poll, timeout, origin, main].every(Number.isFinite),
            'the window, the poll, the timeout and both read limits must be read from the script');
        const loop = code.match(/while \{[^\n]*DEPLOY_WINDOW_S[^\n]*\n([\s\S]*?)\n\s*done\b/);
        assert.ok(loop, 'the poll loop must be found');
        const before = code.slice(0, code.indexOf(loop[0]));
        const count = (/** @type {string} */ s, /** @type {RegExp} */ re) => (s.match(re) ?? []).length;
        const firstReads = count(before.slice(before.indexOf('WEB="')), /\$\(version_of /g);
        const passOrigins = count(loop[1], /\$\(version_of /g);
        const passMain = count(loop[1], /^\s*refresh_expected\s*$/gm);
        assert.ok(firstReads >= 2 && passOrigins >= 2 && passMain === 1, 'the reads are counted where they are made');
        const passes = Math.ceil(window / poll);
        const worst = firstReads * origin + passes * (poll + passOrigins * origin + passMain * main);
        // Five minutes on top: the checkout, the stand-down's own reads and the issue step, which
        // must still RUN after a failure — the whole point of the alert.
        assert.ok(timeout * 60 >= worst + 300,
            `with every read hanging the poll alone takes ${worst}s (${passes} passes of ${poll}s `
            + `sleep + ${passOrigins} origin reads of ${origin}s + ${passMain} read of main of ${main}s, `
            + `after ${firstReads} first reads), so timeout-minutes (${timeout}) must be at least `
            + `${Math.ceil((worst + 300) / 60)}. A cancelled job skips the issue step and tells nobody.`);
    });

    test('a release merging at the end of the window, while Hosting still deploys, is not an alarm', () => {
        // RUN, NOT READ (6 Nov 2026). Re-reading main fixed one false alarm and made another:
        // v25.41 merging in the last minute, with Hosting still deploying v25.40 and the mirror on
        // v25.40, moved EXPECTED past both origins, and neither stand-down matched. A regex cannot
        // see that, so this runs the compare step's own script, with curl and sleep replaced by
        // stubs that answer from a simulated clock, through each case the stand-down must tell apart.
        const lines = src.split('\n');
        const at = lines.findIndex(l => /- name: Compare every served origin against main/.test(l));
        assert.ok(at >= 0, 'the compare step must be found');
        const runAt = lines.findIndex((l, i) => i > at && /^\s*run: \|\s*$/.test(l));
        const indent = lines[runAt + 1].match(/^\s*/)[0].length;
        const body = [];
        for (let i = runAt + 1; i < lines.length; i++) {
            if (lines[i].trim() && lines[i].match(/^\s*/)[0].length < indent) break;
            body.push(lines[i].slice(indent));
        }
        const dir = mkdtempSync(join(tmpdir(), 'currency-'));
        try {
            const bin = join(dir, 'bin');
            mkdirSync(bin);
            writeFileSync(join(dir, 'compare.sh'), body.join('\n'));
            // The clock advances only by `sleep`; each read answers for the moment it is made.
            writeFileSync(join(bin, 'sleep'), '#!/usr/bin/env bash\nt=$(cat "$SIMCLOCK"); echo $(( t + ${1%%.*} )) > "$SIMCLOCK"\n', { mode: 0o755 });
            writeFileSync(join(bin, 'curl'), [
                '#!/usr/bin/env bash',
                'url="${@: -1}"; t=$(cat "$SIMCLOCK")',
                "ver() { printf \"export const APP_VERSION = '%s';\\n\" \"$1\"; }",
                // An optional third stage ($4 at, $5 value): main can move TWICE inside one wait.
                'pick() { if [ -n "${5:-}" ] && [ "$t" -ge "$4" ]; then echo "$5"; elif [ "$t" -ge "$2" ]; then echo "$3"; else echo "$1"; fi; }',
                'case "$url" in',
                '  *contents/roster-data.js*) ver "$(pick "$START_V" "$MAIN_AT" "$MAIN_V" "${MAIN2_AT:-}" "${MAIN2_V:-}")" ;;',
                '  https://myb-roster.web.app/roster-data.js) ver "$(pick "$WEB_V0" "$WEB_AT" "$WEB_V1")" ;;',
                '  https://garethdavidmiller.github.io/roster-app/roster-data.js) ver "$(pick "$PAGES_V0" "$PAGES_AT" "$PAGES_V1")" ;;',
                // One run of whichever workflow is asked about: by default a push here, and
                // RUN_EVENT / RUN_REPO_ID make it somebody else's (10 Nov 2026 review).
                '  */actions/workflows/*/runs*) printf \'{"workflow_runs":[{"status":"%s","event":"%s","head_repository":{"id":%s},"html_url":"https://example.invalid/run/1"}]}\\n\' "$RUN_STATUS" "${RUN_EVENT:-push}" "${RUN_REPO_ID:-1001}" ;;',
                '  */pages) printf \'{"build_type":"%s"}\\n\' "${BUILD_TYPE:-legacy}" ;;',
                '  *) exit 22 ;;',
                'esac',
            ].join('\n') + '\n', { mode: 0o755 });
            const NEVER = 999999;
            /** @param {Record<string, string|number>} c */
            const run = (c) => {
                writeFileSync(join(dir, 'clock'), '0');
                writeFileSync(join(dir, 'roster-data.js'), `export const APP_VERSION = '${c.START_V}';\n`);
                writeFileSync(join(dir, 'out'), '');
                const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, SIMCLOCK: join(dir, 'clock'),
                    GITHUB_OUTPUT: join(dir, 'out'), GITHUB_TOKEN: 'stub', GITHUB_REPOSITORY: 'owner/repo', REPO_ID: '1001',
                    HOSTING_WORKFLOW: 'deploy-hosting.yml', PAGES_WORKFLOW: 'deploy-mirror.yml',
                    ...Object.fromEntries(Object.entries(c).map(([k, v]) => [k, String(v)])) };
                try {
                    return { status: 0, out: execFileSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', 'compare.sh'], { cwd: dir, env, encoding: 'utf8', stdio: 'pipe' }) };
                } catch (/** @type {any} */ e) {
                    return { status: e.status, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
                }
            };
            // The false alarm itself: main moves in the last minute; Hosting still on 25.39 and deploying.
            const late = run({ START_V: '25.40', MAIN_V: '25.41', MAIN_AT: 1450, WEB_V0: '25.39', WEB_V1: '25.39', WEB_AT: NEVER,
                PAGES_V0: '25.40', PAGES_V1: '25.40', PAGES_AT: NEVER, RUN_STATUS: 'in_progress' });
            assert.equal(late.status, 0, `a release merging at the end of the window was reported:\n${late.out}`);
            assert.match(late.out, /Standing down/, 'it must stand down for the deploy in flight, not pass by accident');
            // The case accepting START must not hide: mid-release when the run begins, then web.app
            // reaches the new main while the mirror stays on START.
            const stuck = run({ START_V: '25.40', MAIN_V: '25.41', MAIN_AT: 120, WEB_V0: '25.39', WEB_V1: '25.41', WEB_AT: 600,
                PAGES_V0: '25.40', PAGES_V1: '25.40', PAGES_AT: NEVER, RUN_STATUS: 'in_progress' });
            assert.equal(stuck.status, 1, `a mirror stuck a version behind a current web.app went unreported:\n${stuck.out}`);
            assert.match(stuck.out, /pages:v25\.40/);
            // A stale production with nothing deploying is still the alarm it exists to raise.
            const stale = run({ START_V: '25.40', MAIN_V: '25.40', MAIN_AT: NEVER, WEB_V0: '25.39', WEB_V1: '25.39', WEB_AT: NEVER,
                PAGES_V0: '25.40', PAGES_V1: '25.40', PAGES_AT: NEVER, RUN_STATUS: 'completed' });
            assert.equal(stale.status, 1, `a stale web.app with no deploy running passed:\n${stale.out}`);
            assert.match(stale.out, /web\.app:v25\.39/);
            // And 6 Nov's first false alarm stays fixed: Hosting mid-deploy when the run began, then
            // a merge, and the mirror AHEAD of the version the run began with.
            const ahead = run({ START_V: '25.39', MAIN_V: '25.40', MAIN_AT: 120, WEB_V0: '25.38', WEB_V1: '25.40', WEB_AT: 900,
                PAGES_V0: '25.39', PAGES_V1: '25.40', PAGES_AT: 180, RUN_STATUS: 'in_progress' });
            assert.equal(ahead.status, 0, `the 6 Nov case reported again:\n${ahead.out}`);
            assert.match(ahead.out, /Both origins are serving v25\.40/);
            // TWO merges inside one wait (7 Nov 2026 review): v25.41 at 600s and v25.42 at 1450s,
            // with Hosting on 25.40 and deploying, and the mirror on 25.41 — neither START nor the
            // main of the moment, and a healthy release train reported stale.
            const twice = run({ START_V: '25.40', MAIN_V: '25.41', MAIN_AT: 600, MAIN2_V: '25.42', MAIN2_AT: 1450,
                WEB_V0: '25.39', WEB_V1: '25.40', WEB_AT: 900, PAGES_V0: '25.40', PAGES_V1: '25.41', PAGES_AT: 660,
                RUN_STATUS: 'in_progress' });
            assert.equal(twice.status, 0, `two merges in one wait were reported:\n${twice.out}`);
            assert.match(twice.out, /Standing down/);
            // A STRANGER'S RUN IS NOT A DEPLOY IN FLIGHT (10 Nov 2026 review). A fork's pull request
            // can keep a run named like the deploy going, on a branch it called main; asking by
            // branch alone stood the alarm down for it while web.app really was stale.
            const fork = run({ START_V: '25.40', MAIN_V: '25.40', MAIN_AT: NEVER, WEB_V0: '25.39', WEB_V1: '25.39', WEB_AT: NEVER,
                PAGES_V0: '25.40', PAGES_V1: '25.40', PAGES_AT: NEVER, RUN_STATUS: 'in_progress', RUN_EVENT: 'pull_request', RUN_REPO_ID: '2002' });
            assert.equal(fork.status, 1, `a stranger's pull-request run stood the stale-production alarm down:\n${fork.out}`);
            assert.match(fork.out, /web\.app:v25\.39/);
            // …nor one from this repository that a pull request started.
            const ownPr = run({ START_V: '25.40', MAIN_V: '25.40', MAIN_AT: NEVER, WEB_V0: '25.39', WEB_V1: '25.39', WEB_AT: NEVER,
                PAGES_V0: '25.40', PAGES_V1: '25.40', PAGES_AT: NEVER, RUN_STATUS: 'in_progress', RUN_EVENT: 'pull_request' });
            assert.equal(ownPr.status, 1, `a pull-request run counted as a deploy in flight:\n${ownPr.out}`);
            // …nor one whose head is another repository, whatever event it claims: each half of the
            // test must hold on its own.
            const foreign = run({ START_V: '25.40', MAIN_V: '25.40', MAIN_AT: NEVER, WEB_V0: '25.39', WEB_V1: '25.39', WEB_AT: NEVER,
                PAGES_V0: '25.40', PAGES_V1: '25.40', PAGES_AT: NEVER, RUN_STATUS: 'in_progress', RUN_REPO_ID: '2002' });
            assert.equal(foreign.status, 1, `another repository's run counted as a deploy in flight:\n${foreign.out}`);
            // The gated mirror's stand-down asks the same question of the same runs.
            const forkMirror = run({ START_V: '25.40', MAIN_V: '25.40', MAIN_AT: NEVER, WEB_V0: '25.40', WEB_V1: '25.40', WEB_AT: NEVER,
                PAGES_V0: '25.39', PAGES_V1: '25.39', PAGES_AT: NEVER, BUILD_TYPE: 'workflow', RUN_STATUS: 'in_progress',
                RUN_EVENT: 'pull_request', RUN_REPO_ID: '2002' });
            assert.equal(forkMirror.status, 1, `a stranger's run stood the stale-mirror alarm down:\n${forkMirror.out}`);
            assert.match(forkMirror.out, /pages:v25\.39/);
            // And the mirror's OWN deploy — a workflow_run event — still is one: a query narrowed to
            // pushes would have stopped this stand-down working at all.
            const mirrorDeploying = run({ START_V: '25.40', MAIN_V: '25.40', MAIN_AT: NEVER, WEB_V0: '25.40', WEB_V1: '25.40', WEB_AT: NEVER,
                PAGES_V0: '25.39', PAGES_V1: '25.39', PAGES_AT: NEVER, BUILD_TYPE: 'workflow', RUN_STATUS: 'in_progress', RUN_EVENT: 'workflow_run' });
            assert.equal(mirrorDeploying.status, 0, `the mirror's own deploy in flight was reported:\n${mirrorDeploying.out}`);
            assert.match(mirrorDeploying.out, /the gated mirror follows Hosting\. Standing down/);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('it re-reads main while it waits, and reports the main it judged against', () => {
        // 6 Nov 2026, the third false alarm, and the first that was not a race with a slow deploy:
        // the version this run expected was read ONCE, from the commit it checked out. v25.40
        // merged two minutes into the 25-minute poll, the Pages mirror (built straight from main)
        // served it a minute later, and the run then reported the mirror stale for being AHEAD.
        const loop = code.match(/while \{[^\n]*DEPLOY_WINDOW_S[^\n]*\n([\s\S]*?)\n\s*done\b/);
        assert.ok(loop, 'the poll loop must be found');
        assert.match(loop[1], /^\s*refresh_expected\s*$/m,
            'the poll must ask main for its version on every pass, or a merge during the window '
            + 'makes an origin that is AHEAD read as stale');
        assert.match(code, /contents\/roster-data\.js\?ref=main/, 'and it must ask main, through the API');
        const out = 'echo "expected=$EXPECTED" >> "$GITHUB_OUTPUT"';
        assert.equal(code.split(out).length - 1, 1, 'the expected version is written to the step output once');
        assert.ok(code.indexOf(out) > code.indexOf(loop[0]) + loop[0].length,
            'and AFTER the poll, so the issue names the version the verdict was reached against');
    });

    test('only a failure of the comparison itself reaches the issue', () => {
        // 7 Nov 2026 review — the same fix live-health.yml took in Oct 2026. A bare `failure()` is
        // true when ANY earlier step failed, so a checkout that could not run filed "staff are not
        // being served the current version", naming no version, about origins nobody had read.
        const issue = code.match(/- name: Say so, once, in an issue\n([\s\S]*?)\n\s*run: \|/);
        assert.ok(issue, 'the issue step must be found');
        assert.match(issue[1], /^\s*if:\s*failure\(\)\s*&&\s*steps\.compare\.outcome\s*==\s*'failure'\s*$/m,
            'the issue step must run only when the compare step itself failed');
        assert.match(code, /^\s*id:\s*compare\s*$/m, 'and the compare step must keep the id it is read by');
    });
});

// ── The live check looks twice before it tells anybody (6 Nov 2026) ─────────────────────────────
//
// live-health.yml reports on the deploy-failure thread, which emails the owner. Three of its four
// alerts from 6 Oct to 2 Nov were one GitHub Pages 503 in one run, gone by the next, so a failed
// first look is now followed by a second a minute later, and only a second failure is reported
// (owner decision). Every assertion below is on a way that design can be present and NOT WORK: a
// second look that never runs, one that runs at once inside the same blip, one whose failure is
// swallowed, an alert gate that stops listening, and a time limit that turns the worst outage —
// a site that hangs — into a CANCELLED job, which reaches nobody.
describe('the live check looks twice before it reports', () => {
    const LIVE_WF = join(WF_DIR, 'live-health.yml');
    const src = readFileSync(LIVE_WF, 'utf8');
    // The script, not its justification: the comments name every identifier while explaining them.
    const code = src.split('\n').map(l => l.replace(/^(\s*)#.*$/, '$1')).join('\n');
    const step = code.match(/- name: Open the live site on both origins\n([\s\S]*?)(?=\n\s*- name:)/);
    const body = step ? step[1] : '';
    const script = (body.match(/run: \|\n([\s\S]*?)\n\s*env:/) || [])[1] || '';
    const lines = script.split('\n').map(l => l.trim()).filter(Boolean);
    const limitOf = (block, indent) =>
        Number((new RegExp(`^ {${indent}}timeout-minutes:\\s*(\\d+)\\s*$`, 'm').exec(block) || [])[1]);

    test('the site step is found, and keeps the id the alert step reads', () => {
        assert.ok(step, `${LIVE_WF}: the "Open the live site on both origins" step was not found`);
        assert.match(body, /^\s*id:\s*site\s*$/m, 'the site step must keep `id: site`: the alert step reads its outcome');
        assert.ok(lines.length > 0, 'the site step\'s `run: |` script was not found');
        assert.doesNotMatch(body, /continue-on-error/,
            'no continue-on-error on the site step: a failure would then read as success to `failure()`, and the alert would never run');
    });

    test('a pass ends the step; a failure is followed, after a pause, by one more look', () => {
        assert.equal(lines[0], 'if npm run test:live; then exit 0; fi',
            'the first look comes first, and a first look that passes ends the step at once');
        assert.match(lines[1] || '', /^echo "::warning::/,
            'a failed first look leaves a warning on the run, so a blip is recorded even though nobody is emailed');
        assert.equal(lines[2], 'sleep "$SECOND_LOOK_AFTER_S"',
            'the step pauses before the second look; looking again at once looks inside the same blip');
        assert.equal(lines.filter(l => /npm run test:live/.test(l)).length, 2, 'exactly two looks, no more');
        const pause = Number((/SECOND_LOOK_AFTER_S:\s*'(\d+)'/.exec(body) || [])[1]);
        assert.ok(pause >= 30 && pause <= 300,
            `SECOND_LOOK_AFTER_S is ${pause}. Under 30 seconds it is still the same blip; over five minutes a real outage waits longer than it needs to.`);
    });

    test('the second look decides, and nothing can swallow it', () => {
        // The tail of the script, line for line. `|| true`, `; exit 0` or a dropped final line all
        // turn a site that failed twice into a green run, and each one fails this.
        const tail = lines.slice(3);
        const shape = [/^if npm run test:live; then$/, /^echo "::notice::/, /^exit 0$/, /^fi$/, /^exit 1$/];
        assert.equal(tail.length, shape.length,
            `after the pause the script must be exactly: the second look, a notice, exit 0, fi, exit 1 — found:\n  ${tail.join('\n  ')}`);
        shape.forEach((re, i) => assert.match(tail[i], re,
            `line ${i + 4} of the site script must match ${re}; a second look that fails has to fail the step`));
    });

    test('the site step runs out of time before the job does', () => {
        // A page may take its whole 150 s test timeout to fail, so one look at a site that hangs is
        // ~15 minutes. A JOB that runs out is cancelled and the alert step never runs; a STEP that
        // runs out fails by name and the alert does run (the 23 Oct 2026 install timeout, recorded
        // as a failure). So the step's limit must be the one that is reached.
        //
        // EVERY STEP BEFORE IT THAT DOES WORK IS COUNTED (6 Nov 2026 review). This counted only the
        // system libraries' 8 minutes and called the rest "five minutes for everything else" — but
        // `npm ci` (7 minutes, 4 Sep) and a browser download on a cache miss (9–25 minutes, 7 Oct)
        // had no limits at all, so a slow setup could spend the job before a hung site was cut off.
        // A step that installs or runs something must carry its own limit, and the job must cover
        // all of them plus the site step and five minutes for the quick steps and the alert.
        //
        // AND SO MUST EVERY OTHER STEP BUT THE ALERT (7 Nov 2026 review). Counting only `run:` and
        // local actions left out the checkout, setup-node's npm cache and the browser cache — all
        // downloads, none limited — and the report upload, which runs AFTER the site step and BEFORE
        // the alert. Any of them stalling in a GitHub-side incident spent the job's time unseen.
        const stepLimit = limitOf(body, 8);
        const jobLimit = limitOf(code, 4);
        assert.ok(stepLimit >= 10,
            `the site step needs its own timeout-minutes of at least 10 (found ${stepLimit}): two looks and the pause take about three minutes, and a hung site must still be cut off by THIS limit`);
        const steps = code.slice(code.indexOf('steps:')).split(/\n(?=\s*- (?:name|uses):)/)
            .filter(s => /^\s*- (?:name|uses):/.test(s));
        const nameOf = (/** @type {string} */ s) => s.match(/- (?:name|uses): (.*)/)?.[1] ?? s.trim().slice(0, 60);
        const alertAt = steps.findIndex(s => /- name: Say so, once, in an issue/.test(s));
        assert.equal(alertAt, steps.length - 1, 'the alert step must be found, and must be the last step');
        const others = steps.slice(0, alertAt).filter(s => !/- name: Open the live site on both origins/.test(s));
        for (const want of ['actions/checkout', 'actions/setup-node', 'actions/cache', 'npm ci', 'actions/upload-artifact']) {
            assert.ok(others.some(s => s.includes(want)), `the ${want} step must be found among the steps counted`);
        }
        const unbounded = others.filter(s => !(limitOf(s, 8) > 0)).map(nameOf);
        assert.deepEqual(unbounded, [],
            `every step but the alert needs its own timeout-minutes; these have none, so the job can run out before the site step does: ${unbounded.join(', ')}`);
        const rest = others.reduce((n, s) => n + limitOf(s, 8), 0);
        assert.ok(rest + stepLimit + 5 <= jobLimit,
            `the job limit (${jobLimit}) must cover every other step (${rest} minutes between them), the site step's ${stepLimit} and five minutes for the alert. Otherwise the job runs out first, and a hung site is never reported.`);
    });

    test('the scheduled looks demand a DIRECT connection — the value live.spec.js reads', () => {
        // Test audit, 7 Nov 2026: setting it to '0' passed every workflow test, and the scheduled
        // check would then accept RELAYED passes — real bytes fetched by curl, but no API-key referrer
        // check and no live Firebase round trip, reported green at 03:00 with nobody reading the mode
        // line. The value is read from the spec rather than typed here, so the two cannot drift.
        const spec = readFileSync('e2e/live.spec.js', 'utf8');
        const wanted = (/process\.env\.LIVE_REQUIRE_DIRECT\s*===\s*'([^']*)'/.exec(spec) || [])[1];
        assert.ok(wanted, 'e2e/live.spec.js no longer compares LIVE_REQUIRE_DIRECT with a literal — this test reads that literal');
        const set = (/^\s*LIVE_REQUIRE_DIRECT:\s*'([^']*)'\s*$/m.exec(body) || [])[1];
        assert.equal(set, wanted,
            `the site step must set LIVE_REQUIRE_DIRECT: '${wanted}' in its own env (found ${set === undefined ? 'nothing' : `'${set}'`}); anything else lets a relayed pass through on a schedule`);
    });

    test('the direct probe takes any HTTP answer as a connection — the page checks judge the status', () => {
        // workflows-9 (10 Nov 2026 review): anything but a 200 from web.app's robots.txt read as "could
        // not reach the internet", so web.app answering 404 or 5xx for everything — the outage this check
        // exists for — failed all six tests on that assertion before any page opened, the mirror among
        // them. Only a navigation that THROWS is no connection; an HTTP error is an answer to judge.
        const spec = readFileSync('e2e/live.spec.js', 'utf8');
        const probe = spec.slice(spec.indexOf('async function canReachDirectly'), spec.indexOf('function curlFetch'));
        assert.ok(probe.includes('probe.goto('), 'the direct probe was not found in e2e/live.spec.js');
        assert.doesNotMatch(probe, /\.status\(\)/,
            'the probe judges the answer\'s status, so an error page from web.app reads as "no connection"');
    });

    test('only a failure of the site check itself reaches the issue', () => {
        // The whole-app review's fix (Oct 2026): a runner that could not install used to post "the
        // live site failed" about a site nobody had opened.
        assert.match(code, /if:\s*failure\(\)\s*&&\s*steps\.site\.outcome\s*==\s*'failure'/,
            'the alert step must run only when the site step itself failed');
    });

    test('a person running the check by hand still gets the first answer', () => {
        const cfg = readFileSync('playwright.live.mjs', 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
        assert.match(cfg, /^\s*retries:\s*0\s*,/m,
            'playwright.live.mjs must keep `retries: 0`. The second look is the scheduled run\'s decision about whom to email; a Playwright retry would report a page that recovered as "flaky" inside a green run, the softened answer this config exists to refuse.');
    });
});

// ── A run-script that dedents out of its own block scalar ───────────────────────────────────────
//
// THE BUG THIS EXISTS FOR WAS MADE TWICE IN ONE SESSION, BOTH TIMES WHILE FIXING SOMETHING ELSE.
// A `run: |` block scalar ends at the first line indented LESS than the block. Pipe a script into
// `python3 -c "` and write its body at column 0 — which is what Python requires — and the scalar
// terminates mid-command: the rest of the step becomes top-level YAML keys, and the whole workflow
// is unparseable. It does not look wrong. The shell is valid, the Python is valid, and the file
// reads correctly to a person.
//
// `workflow-lint.yml` catches it, and it is the right place for a real parse. But it only fires on
// a push that touched `.github/workflows/**`, so the answer arrives after a push rather than before
// one — and this suite runs on a bare checkout with NO node_modules (the `nodeps` lane), so it has
// no YAML parser to call. What it can do without one is check the single structural property that
// this class of mistake violates, which is enough to catch it at the keyboard.
describe('every run-script stays inside its own block scalar', () => {

    /** Lines that open a block scalar, with the indent their body must not go below. */
    const BLOCK = /^(\s*)(run|if|body|script|query|value|description):\s*[|>][-+]?\d*\s*$/;

    test('no continuation line dedents below the block it belongs to', () => {
        // WHAT ENDS A BLOCK SCALAR: the first non-blank line indented less than the body. That is
        // not the bug on its own — every `run: |` in the repo ends that way, at the next step. The
        // bug is ending there and landing on something that is NOT YAML, because the author was
        // writing a shell script and the parser was reading keys.
        //
        // So the classification is the whole test, and the first cut of it got this backwards in
        // both directions: it passed anything word-shaped, which is exactly what `import sys, json`
        // is, and failed every dedented COMMENT, which is legal YAML anywhere. It reported nine
        // offences that were fine while missing the one that was not.
        const ENDS_CLEANLY = [
            /^\s*#/,                          // a comment — legal at any indent
            /^\s*-\s/,                        // a sequence entry
            /^\s*-?\s*['"\w][\w.$/'"-]*\s*:(\s|$)/,   // a mapping key, quoted or not
        ];
        /** @type {string[]} */
        const offences = [];
        for (const f of readdirSync(WF_DIR).filter(n => /\.ya?ml$/.test(n))) {
            const lines = readFileSync(join(WF_DIR, f), 'utf8').split('\n');
            for (let i = 0; i < lines.length; i++) {
                const open = lines[i].match(BLOCK);
                if (!open) continue;
                const openIndent = open[1].length;
                // The body's indent is set by its first non-blank line, per the YAML spec.
                let j = i + 1;
                while (j < lines.length && lines[j].trim() === '') j++;
                if (j >= lines.length) continue;
                const bodyIndent = lines[j].match(/^\s*/)[0].length;
                if (bodyIndent <= openIndent) continue;   // an empty block; the real parser judges it
                for (; j < lines.length; j++) {
                    if (lines[j].trim() === '') continue;
                    if (lines[j].match(/^\s*/)[0].length >= bodyIndent) continue;
                    if (ENDS_CLEANLY.some(re => re.test(lines[j]))) break;   // the block ended, fine
                    offences.push(`${f}:${j + 1}  "${lines[j].slice(0, 60)}"`);
                    break;
                }
            }
        }
        assert.deepEqual(offences, [],
            'a line dedents out of its own `run: |` block and is not YAML, so the scalar ENDS '
            + 'there and the workflow no longer parses:\n  ' + offences.join('\n  ')
            + '\n\nThis is almost always an embedded `python3 -c "` script written at column 0 — '
            + 'which is where Python needs it. Indenting the body is not the fix. Use a one-liner, '
            + 'jq, or a script file in scripts/.');
    });

    test('the scan is really reading the workflows', () => {
        // Every assertion above is a deepEqual against [], which passes on an empty scan. Pin the
        // machinery to something that IS there, or a renamed directory reports a clean bill.
        const files = readdirSync(WF_DIR).filter(n => /\.ya?ml$/.test(n));
        assert.ok(files.length >= 8, `only ${files.length} workflows found in ${WF_DIR}`);
        const anyBlock = files.some(f =>
            readFileSync(join(WF_DIR, f), 'utf8').split('\n').some(l => BLOCK.test(l)));
        assert.ok(anyBlock, 'no `run: |` block found at all — the opener regex has stopped matching');
    });
});

describe('a stalled apt mirror costs a retry, not the job (23–24 Oct 2026)', () => {
    /**
     * Every job that runs a browser installs ~26 MB of GTK/GStreamer libraries and fonts from apt,
     * which no cache can hold. On 22 Oct that step ran for 9 minutes on one job and until the job's
     * own limit on three, while a sibling's copy took 14 seconds; on 23–24 Oct it stalled on seven
     * steps across three runs, two of them the deploy's own gate. Every test that had run had passed.
     *
     * #1625 (23 Oct) gave the step a limit of its own, 8 minutes, so a stall FAILS the job by name
     * instead of the job being cancelled — and tried a retry it had to take out: the timed-out step's
     * apt ran as root under sudo, a kill from the runner's user could not reach it, and it kept the
     * package lock, so the retry died in under a second. The next day moved the install into ONE
     * composite action, .github/actions/install-browser-deps, shaped around that failure: the clock
     * runs INSIDE sudo (root signals root), only the DOWNLOAD phase is bounded (no dpkg is ever
     * interrupted, nothing holds a lock afterwards, apt resumes the partial files), and the install
     * then runs from the local cache. The package list is Playwright's own (`install-deps --dry-run`).
     *
     * The shape is held for every workflow AND for the action, so a job added later cannot bring the
     * raw step back and a budget edit cannot quietly outgrow the step's limit:
     *   · the browser download never installs the libraries itself (`install --with-deps`);
     *   · no workflow runs `npx playwright install-deps` directly — every install goes through the
     *     action, or it has no second attempt;
     *   · each calling step has a limit of its own (8 minutes or less) inside its job's, names its
     *     browser, may not continue past a failure, and runs on every path;
     *   · in the action, `timeout` wraps apt AS ROOT, only the download phase is bounded, the final
     *     install is not, and the attempts' worst case fits inside those 8 minutes.
     *
     * Read as text, not YAML, like the rest of this file: the suite runs with nothing installed.
     */
    const files = readdirSync(WF_DIR).filter(f => /\.ya?ml$/.test(f));
    const MAX_MINUTES = 8;
    const ACTION_USE = './.github/actions/install-browser-deps';
    const ACTION_DIR = join(WF_DIR, '..', 'actions', 'install-browser-deps');

    /** Each job's own block, keyed by name: top-level job keys sit two spaces in under `jobs:`. */
    function jobsOf(/** @type {string} */ src) {
        const body = src.slice(Math.max(0, src.search(/^jobs:/m)));
        const heads = [...body.matchAll(/^ {2}([A-Za-z_][\w-]*):[ \t]*$/gm)];
        return heads.map((h, i) => ({ name: h[1], src: body.slice(h.index, heads[i + 1]?.index ?? body.length) }));
    }
    /** Each step as its block of lines. Steps sit six spaces in throughout this repo's workflows;
     *  a comment line belongs to no step, and anything shallower than a step's body ends it. */
    function stepsOf(/** @type {string} */ src) {
        /** @type {string[][]} */ const steps = [];
        /** @type {string[] | null} */ let cur = null;
        for (const line of src.split('\n')) {
            if (/^ {6}- /.test(line)) { cur = [line]; steps.push(cur); }
            else if (/^\s*(#.*)?$/.test(line)) continue;
            else if (cur && /^ {8,}\S/.test(line)) cur.push(line);
            else cur = null;
        }
        return steps.map(lines => lines.filter(l => !/^\s*#/.test(l)).join('\n'));
    }
    /** A step's own key, on the dash line or at the step's body indent; null when it has none. */
    const field = (/** @type {string} */ step, /** @type {string} */ key) =>
        new RegExp(`^(?: {6}- | {8})${key}:[ \\t]*(.*?)[ \\t]*$`, 'm').exec(step)?.[1] ?? null;

    /** Every bounded install found, so the last contract can prove the scan saw them. */
    let bounded = 0;

    for (const file of files) {
        const src = readFileSync(join(WF_DIR, file), 'utf8');

        test(`${file}: no browser install brings its own libraries`, () => {
            const offenders = stepsOf(src).filter(s => /npx playwright install\b[^\n]*--with-deps/.test(s))
                .map(s => field(s, 'name') ?? s.split('\n')[0].trim());
            assert.deepEqual(offenders, [],
                'these install the browser AND its apt libraries in one unbounded step, so a stalled '
                + 'mirror there can still eat the job: download the browser alone (`npx playwright '
                + 'install <browser>`) and let the bounded action install the libraries');
        });

        test(`${file}: no step installs the libraries outside the action`, () => {
            const offenders = stepsOf(src).filter(s => /npx playwright install-deps\b/.test(s))
                .map(s => field(s, 'name') ?? s.split('\n')[0].trim());
            assert.deepEqual(offenders, [],
                'these run `npx playwright install-deps` directly, which has no second attempt when the '
                + `mirror stalls: use \`uses: ${ACTION_USE}\` with \`browser:\` instead`);
        });

        test(`${file}: every install of the libraries is bounded, inside its job's own limit`, () => {
            /** @type {string[]} */ const faults = [];
            for (const job of jobsOf(src)) {
                const jobLimit = Number(/^ {4}timeout-minutes:[ \t]*(\d+)/m.exec(job.src)?.[1]);
                for (const step of stepsOf(job.src)) {
                    if (field(step, 'uses') !== ACTION_USE) continue;
                    const name = `${job.name} › ${field(step, 'name') ?? 'an unnamed step'}`;
                    const limit = Number(field(step, 'timeout-minutes'));
                    if (!(limit > 0 && limit <= MAX_MINUTES)) {
                        faults.push(`${name}: needs a timeout-minutes of ${MAX_MINUTES} or less (has ${field(step, 'timeout-minutes')})`);
                    } else if (!(jobLimit > limit + 1)) {
                        faults.push(`${name}: its ${limit} minutes leave no room inside the job's ${jobLimit} — the job would be cancelled before the step could fail by name`);
                    }
                    if (field(step, 'continue-on-error') !== null) faults.push(`${name}: must FAIL the job on a stall, not continue past it`);
                    if (field(step, 'if') !== null) faults.push(`${name}: must run on every path — a cache hit and a cache miss both need the libraries (has if: ${field(step, 'if')})`);
                    const browser = /^ {10}browser:[ \t]*(\S+)/m.exec(step)?.[1] ?? null;
                    if (!/^(chromium|webkit)$/.test(browser ?? '')) faults.push(`${name}: must name its browser (with: browser: chromium | webkit; has ${browser})`);
                    bounded += 1;
                }
            }
            assert.deepEqual(faults, [], faults.join('\n'));
        });
    }

    test('the scan found the installs it is about', () => {
        // Runs after the per-file tests above (node:test runs a describe's tests in order). Every
        // contract above passes on a scan that matched nothing, so pin it to what IS there: the eight
        // jobs that install a browser as of 23 Oct 2026 — the smoke, webkit, csp, visual and
        // visual-webkit jobs, the release gate, the live health check and the offline proof.
        assert.ok(bounded >= 8, `found ${bounded} bounded installs of the libraries; expected at least 8`);
    });

    describe('the action itself', () => {
        const action = readFileSync(join(ACTION_DIR, 'action.yml'), 'utf8');
        const script = readFileSync(join(ACTION_DIR, 'install.sh'), 'utf8');

        test('is a composite action whose step names its shell and runs the script', () => {
            assert.match(action, /^\s+using:\s*composite\s*$/m, 'runs.using must be composite');
            assert.match(action, /^\s+shell:\s*bash\s*$/m, 'a composite run step needs its shell, or GitHub rejects it at call time');
            assert.match(action, /install\.sh/, 'the step must run install.sh, where the shape is held');
        });

        test('takes the package list from Playwright, and falls back to the plain command if that output moves', () => {
            assert.match(script, /npx playwright install-deps --dry-run "\$BROWSER"/, 'the list must be Playwright\'s own, not a copy kept here');
            assert.match(script, /exec timeout -k \d+ "[^"]+" npx playwright install-deps "\$BROWSER"/, 'the fallback is the plain command, still bounded');
            // …and as ROOT where there is a sudo to go through: the plain command spawns `sudo apt-get`
            // itself, and a clock started by the runner's user could not kill that apt (23 Oct 2026).
            assert.match(script, /exec sudo -n env "PATH=\$PATH" timeout -k \d+ "[^"]+" npx playwright install-deps "\$BROWSER"/, 'the fallback\'s clock must run as root too');
        });

        test('reads the package list in BOTH shapes Playwright has printed, through the real parser', () => {
            // Playwright 1.63 (3 Nov 2026) replaced the dry run's printed apt command with a simulated
            // install, and the parser read neither shape: every WebKit job fell back to the plain
            // command — one clock, no resume — and a slow mirror then killed two before any test ran.
            // So the script's own parse_dry_run is run here, on each shape, not a copy of its regex.
            const parse = (/** @type {string} */ out) => execFileSync('bash', [join(ACTION_DIR, 'install.sh'), '--parse'],
                { input: out, env: { ...process.env, BROWSER: 'webkit' }, encoding: 'utf8' }).trim();
            assert.equal(parse('sudo -- sh -c "apt-get install -y --no-install-recommends libwoff1 libopus0 gstreamer1.0-libav"\n'),
                'libwoff1 libopus0 gstreamer1.0-libav', 'Playwright up to 1.56 printed the command it would run');
            assert.equal(parse('Missing system dependencies (3):\n  gstreamer1.0-libav\n  libopus0\n  libwoff1\n'),
                'gstreamer1.0-libav libopus0 libwoff1', 'Playwright 1.63 prints the missing packages, one per indented line');
            assert.equal(parse('All system dependencies are installed.\n'), '-', 'nothing missing is its own answer, not a parse failure');
            assert.equal(parse('A shape nobody has seen yet\n'), '', 'an unknown shape reads as nothing, which is what sends the script to the fallback');
        });

        test('the clock runs as root around apt, and only the download phase is bounded', () => {
            assert.match(script, /^if \[ "\$\(id -u\)" = "0" \]; then asroot\(\) \{ "\$@"; \}; else asroot\(\) \{ sudo -n "\$@"; \}; fi$/m,
                'asroot must be sudo on a runner — a timeout started by the runner\'s user cannot kill root\'s apt (23 Oct 2026)');
            assert.match(script, /^ {8}asroot timeout -k \d+ "\$secs" "\$@" && \{/m, 'the bounded attempt must start timeout AS ROOT around the command');
            assert.match(script, /^attempt "[^"]*" "\$UPDATE_SECONDS" apt-get [^\n]*\bupdate\b/m, 'apt-get update goes through the bounded attempt');
            assert.match(script, /^attempt "[^"]*" "\$ATTEMPT_SECONDS" apt-get [^\n]*--download-only/m, 'the download phase goes through the bounded attempt');
            const finals = script.split('\n').filter(l => /^asroot apt-get\b/.test(l) && /\binstall\b/.test(l) && !/--download-only/.test(l));
            assert.equal(finals.length, 1, 'exactly one install from the local cache, run as root and under no timeout of its own');
            assert.ok(!/timeout/.test(finals[0]), 'the final install must not be cut off mid-dpkg');
            const bare = script.split('\n').filter(l => /^\s*(sudo -n )?timeout\b/.test(l) && /apt-get/.test(l));
            assert.deepEqual(bare, [], 'every timeout around apt goes through asroot');
        });

        test('a mirror that stalls is left behind once, for the next one that serves the whole archive', () => {
            // 6 Nov 2026: apt moves to the next mirror only on an ERROR, so a mirror that trickles was
            // never left — three runners spent all three attempts at ~70 KB/s on the Azure mirror while a
            // sibling fetched the same files in 14 s. The script's own function is run here, on a copy of
            // GitHub's list and on the shapes it must refuse, not a copy of its awk.
            const dir = mkdtempSync(join(tmpdir(), 'mirrors-'));
            const leave = (/** @type {string} */ list) => {
                const f = join(dir, 'apt-mirrors.txt');
                writeFileSync(f, list);
                const out = execFileSync('bash', [join(ACTION_DIR, 'install.sh'), '--leave-mirror', f],
                    { env: { ...process.env, BROWSER: 'webkit' }, encoding: 'utf8' }).trim();
                return { out, after: readFileSync(f, 'utf8') };
            };
            try {
                const AZ = 'http://azure.archive.ubuntu.com/ubuntu/\tpriority:1\n', ARC = 'https://archive.ubuntu.com/ubuntu/\tpriority:2\n',
                    SEC = 'https://security.ubuntu.com/ubuntu/\tpriority:3\n';
                let r = leave(AZ + ARC + SEC);
                assert.equal(r.out, 'http://azure.archive.ubuntu.com/ubuntu/', 'the stalled first mirror is the one left');
                assert.equal(r.after, ARC + SEC, 'the next attempt fetches from archive.ubuntu.com, the security mirror kept behind it');
                r = leave(ARC + AZ);
                assert.equal(r.out, 'http://azure.archive.ubuntu.com/ubuntu/', 'the first mirror is the lowest PRIORITY, as apt orders them, not the first line');
                assert.equal(r.after, ARC);
                r = leave(AZ + SEC);
                assert.equal(r.out, '', 'never down to the security mirror alone, which serves only its own pocket');
                assert.equal(r.after, AZ + SEC, 'and the list is then left as it was');
                r = leave(AZ);
                assert.deepEqual([r.out, r.after], ['', AZ], 'a single mirror is kept');
                assert.equal(execFileSync('bash', [join(ACTION_DIR, 'install.sh'), '--leave-mirror', join(dir, 'none.txt')],
                    { env: { ...process.env, BROWSER: 'webkit' }, encoding: 'utf8' }), '', 'no list, nothing to do');
            } finally { rmSync(dir, { recursive: true, force: true }); }
            // …and the attempt loop leaves a mirror only on a CUT-OFF (exit 124), once per job
            assert.match(script, /if \[ "\$rc" = 124 \] && \[ -z "\$\{MIRROR_LEFT:-\}" \]; then\n\s+MIRROR_LEFT=\$\(leave_stalled_mirror \/etc\/apt\/apt-mirrors\.txt\)/,
                'a cut-off attempt must leave its mirror, once');
        });

        test('the attempts\' worst case fits inside the calling step\'s limit', () => {
            const attempts = Number(/^ {2}attempts:\n(?:[^\n]*\n)*?\s+default:\s*'(\d+)'/m.exec(action)?.[1]);
            const perAttempt = Number(/^ {2}attempt-seconds:\n(?:[^\n]*\n)*?\s+default:\s*'(\d+)'/m.exec(action)?.[1]);
            const scriptAttempts = Number(/^ATTEMPTS="\$\{ATTEMPTS:-(\d+)\}"/m.exec(script)?.[1]);
            const scriptPer = Number(/^ATTEMPT_SECONDS="\$\{ATTEMPT_SECONDS:-(\d+)\}"/m.exec(script)?.[1]);
            const update = Number(/^UPDATE_SECONDS="\$\{UPDATE_SECONDS:-(\d+)\}"/m.exec(script)?.[1]);
            assert.ok(attempts > 1 && perAttempt > 0 && update > 0, `the defaults must be readable (attempts ${attempts}, per attempt ${perAttempt}s, update ${update}s)`);
            assert.equal(scriptAttempts, attempts, 'action.yml and install.sh must agree on the attempts');
            assert.equal(scriptPer, perAttempt, 'action.yml and install.sh must agree on the seconds per attempt');
            // Every attempt at both phases stalling: each cut-off costs its cap, up to 5 s of kill grace
            // (`timeout -k 5`) and the 3 s pause; then Playwright's dry run and the apt.conf write
            // (~15 s), and the install from cache (measured at 15–30 s; allowed 60).
            const worst = attempts * (update + perAttempt + 8) + 15 + 60;
            assert.ok(worst <= MAX_MINUTES * 60,
                `worst case ${worst}s does not fit inside the calling step's ${MAX_MINUTES} minutes — shrink the attempts, not the step's limit`);
        });
    });
});

// ── EVERY LANE RUNS ITS OWN COMMAND (test audit, 7 Nov 2026) ───────────────────────────────────────
// Each of these was replaced with `echo skipped` and every workflow suite stayed green: the job still
// existed, still ran, still went green. The rules lane matters most — it is the only place the real
// `buildOverrideWrite` output meets the rules for a change that touches no rules file, because
// deploy-rules fires only on a rules change and the Hosting deploy never runs the rules suite.
describe('every CI lane runs the command it is there for', () => {
    /** One job's block from a workflow file. @param {string} file @param {string} name */
    const jobOf = (file, name) => {
        const src = readFileSync(join(WF_DIR, file), 'utf8');
        const body = src.slice(src.search(/^jobs:/m));
        const start = body.search(new RegExp(`^ {2}${name}:[ \\t]*$`, 'm'));
        assert.ok(start > -1, `${file} has no ${name} job`);
        const rest = body.slice(start + 1);
        const next = rest.search(/^ {2}[A-Za-z_][\w-]*:[ \t]*$/m);
        return (next === -1 ? rest : rest.slice(0, next)).split('\n').filter(l => !l.trim().startsWith('#')).join('\n');
    };
    const LANES = /** @type {[string, string, string][]} */ ([
        ['e2e.yml', 'unit', 'npm run check'],
        ['e2e.yml', 'nodeps', 'npm run test:nodeps'],
        ['e2e.yml', 'functions', 'npm run test:functions'],
        ['e2e.yml', 'rules', 'npm run test:rules'],
        ['e2e.yml', 'smoke', 'npm run test:e2e'],
        ['e2e.yml', 'csp', 'npm run test:csp'],
        ['deploy-hosting.yml', 'deploy', 'npm run check'],
        ['deploy-hosting.yml', 'deploy', 'npm run test:e2e'],
        ['deploy-hosting.yml', 'deploy', 'npm run test:csp'],
    ]);
    for (const [file, job, cmd] of LANES) {
        test(`${file} → ${job} runs ${cmd}`, () => {
            const esc = cmd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            assert.match(jobOf(file, job), new RegExp(`^\\s*(?:run:\\s*)?${esc}(?:\\s|$)`, 'm'),
                `${file}'s ${job} job no longer runs \`${cmd}\` — the lane can go green having checked nothing`);
        });
    }
});

// ── THE RACE DETECTOR FILES WHAT IT FINDS, ONCE, AND COUNTS ONLY RACES (10 Nov 2026 review) ─────
//
// race-detector.yml found races and could not file them: it has no checkout, and gh's issue and
// label commands look for one, so every call failed, a warning went to a green hourly log, and no
// `ci-race` issue could appear — which reads as "no races", the very question DECISIONS.md is waiting
// on. It also counted an ordinary double push as a "superseded" race, and would have re-posted each
// instance every hour. Its step is run here with real Python and a `gh` that, like the real one with
// no checkout, refuses issue and label commands unless GH_REPO names the repository.
describe('the race detector files what it finds, once, and counts only races', () => {
    const script = stepScript(readFileSync(join(WF_DIR, 'race-detector.yml'), 'utf8'),
        'Find commits where the branch-head run beat the merge-result run');
    const [R, S, D, E] = ['a', 'b', 'd', 'e'].map(c => c.repeat(40));
    const at = (/** @type {string} */ hms) => `2026-11-09T${hms}Z`;
    const tests = (/** @type {string} */ sha, /** @type {string} */ event, /** @type {string} */ conclusion, /** @type {string} */ queued) =>
        ({ name: 'Tests', head_sha: sha, event, conclusion, created_at: at(queued), run_started_at: at(queued),
            head_branch: 'claude/x', html_url: `https://example.invalid/${sha[0]}-${event}` });
    const RUNS = [
        // The race, consequential: the push run was queued 4 minutes AFTER the merge-result run, cancelled it, and passed.
        tests(R, 'pull_request', 'cancelled', '11:49:00'), tests(R, 'push', 'success', '11:53:00'),
        // The race, superseded: queued after it too, then cancelled by the next push to the branch.
        tests(S, 'pull_request', 'cancelled', '12:00:00'), tests(S, 'push', 'cancelled', '12:03:00'),
        // NOT a race — a double push: D's push run was queued first and cancelled by its own merge-result
        // run, which E's push then cancelled; E's own pair then ran the designed way.
        tests(D, 'push', 'cancelled', '13:00:00'), tests(D, 'pull_request', 'cancelled', '13:00:05'),
        tests(E, 'push', 'cancelled', '13:05:00'), tests(E, 'pull_request', 'success', '13:05:04'),
        // Another workflow's runs are not this one's business.
        { ...tests(D, 'pull_request', 'cancelled', '13:00:05'), name: 'Deploy Firebase Hosting' },
    ];
    const ghStub = `#!/usr/bin/env node
const { readFileSync, appendFileSync, writeFileSync } = require('node:fs');
const a = process.argv.slice(2);
appendFileSync(process.env.GH_LOG, a.slice(0, 2).join(' ') + '\\n');
if (a[0] === 'api') { process.stdout.write(readFileSync(process.env.STUB_RUNS, 'utf8')); process.exit(0); }
if (!process.env.GH_REPO) { console.error('failed to run git: fatal: not a git repository (or any of the parent directories): .git'); process.exit(1); }
if (a[0] === 'issue' && a[1] === 'list') { process.stdout.write(process.env.STUB_EXISTING ? process.env.STUB_EXISTING + '\\n' : ''); process.exit(0); }
if (a[0] === 'issue' && a[1] === 'view') { process.stdout.write(process.env.STUB_KNOWN || ''); process.exit(0); }
if (a[0] === 'label' && a[1] === 'create') process.exit(0);
if (a[0] === 'issue' && (a[1] === 'create' || a[1] === 'comment')) {
    if (process.env.STUB_FAIL_FILE) { console.error('HTTP 502'); process.exit(1); }
    writeFileSync(process.env.GH_BODY, a.slice(0, 3).join(' ') + '\\n' + a[a.indexOf('--body') + 1]);
    process.exit(0);
}
console.error('stub gh: unexpected ' + a.join(' ')); process.exit(2);
`;
    /** @param {Record<string, string>} [env] */
    const detect = (env = {}) => {
        const dir = mkdtempSync(join(tmpdir(), 'race-'));
        try {
            const bin = join(dir, 'bin');
            mkdirSync(bin);
            writeFileSync(join(bin, 'gh'), ghStub, { mode: 0o755 });
            writeFileSync(join(dir, 'detect.sh'), script);
            writeFileSync(join(dir, 'runs-fixture.json'), JSON.stringify({ workflow_runs: RUNS }));
            writeFileSync(join(dir, 'calls'), '');
            writeFileSync(join(dir, 'body'), '');
            /** @type {Record<string, string|undefined>} */
            const vars = { ...process.env, PATH: `${bin}:${process.env.PATH}`, GH_LOG: join(dir, 'calls'), GH_BODY: join(dir, 'body'),
                STUB_RUNS: join(dir, 'runs-fixture.json'), GH_TOKEN: 'stub', REPO: 'owner/roster-app', ...env };
            delete vars.GH_REPO;   // the workflow's env does not set it; the script must
            let status = 0, out = '';
            try {
                out = execFileSync('bash', ['-e', 'detect.sh'], { cwd: dir, env: vars, encoding: 'utf8', stdio: 'pipe' });
            } catch (/** @type {any} */ e) {
                status = e.status;
                out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
            }
            return { status, out, body: readFileSync(join(dir, 'body'), 'utf8'),
                calls: readFileSync(join(dir, 'calls'), 'utf8').split('\n').filter(Boolean) };
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    };
    const short = (/** @type {string} */ sha) => `\`${sha.slice(0, 9)}\``;

    test('it files the two races in a new issue, and creates the label first', () => {
        const r = detect();
        assert.equal(r.status, 0, r.out);
        assert.match(r.body, /^issue create /, `no issue was filed:\n${r.out}`);
        assert.ok(r.body.includes(`**consequential** · ${short(R)}`), r.body);
        assert.ok(r.body.includes(`**superseded** · ${short(S)}`), r.body);
        assert.ok(r.calls.indexOf('label create') > -1 && r.calls.indexOf('label create') < r.calls.indexOf('issue create'),
            `the label must exist before the issue that carries it:\n${r.calls.join('\n')}`);
    });

    test('a double push is not a race', () => {
        const r = detect();
        for (const sha of [D, E]) assert.ok(!r.body.includes(short(sha)), `${short(sha)} was counted as a race:\n${r.body}`);
    });

    test('an instance the open issue already records is not posted again', () => {
        const r = detect({ STUB_EXISTING: '7', STUB_KNOWN: `- **consequential** · ${short(R)} on \`claude/x\` …` });
        assert.match(r.body, /^issue comment 7\n/, `the open issue was not commented on:\n${r.out}`);
        assert.ok(!r.body.includes(short(R)), 'an instance already on the issue was posted again');
        assert.ok(r.body.includes(short(S)), 'the new instance must still be posted');
    });

    test('when every instance is already recorded, nothing is posted', () => {
        const r = detect({ STUB_EXISTING: '7', STUB_KNOWN: `${short(R)}\n${short(S)}` });
        assert.equal(r.status, 0, r.out);
        assert.equal(r.body, '', 'a comment repeating what the issue already says was posted');
        assert.match(r.out, /No new wrong-way races/);
    });

    test('an instance it cannot file fails the run instead of warning a green log', () => {
        const r = detect({ STUB_FAIL_FILE: '1' });
        assert.equal(r.status, 1, `a race that could not be filed left the run green:\n${r.out}`);
        assert.match(r.out, /::error::could not create the tracking issue/);
    });
});

// ── A LANE UPLOADS THE FOLDER ITS OWN PLAYWRIGHT CONFIG WRITES (10 Nov 2026 review) ──────────────
//
// live-health.yml and offline.yml uploaded `playwright-report/` on failure, and their configs report
// to the log only — only the html reporter writes that folder — so a failure left no artefact and
// the traces `retain-on-failure` keeps in `test-results/` went with the runner. The rule, for every
// job and every upload of Playwright output: `test-results/` is always written, `playwright-report/`
// only by a config with the html reporter. Each lane's config is read from the npm script it runs,
// and a config without a reporter of its own inherits one from the base it spreads.
describe('a lane uploads the folder its own Playwright config writes', () => {
    const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts;
    /** The config an npm script runs Playwright with, or null for a script that does not. @param {string} name */
    const configOf = (name) => {
        const cmd = scripts[name] ?? '';
        if (!/\bplaywright test\b/.test(cmd)) return null;
        return /--config[= ](\S+?\.mjs)/.exec(cmd)?.[1] ?? 'playwright.config.mjs';
    };
    /** Whether a config writes the html report, itself or through the base it spreads. @param {string} file @returns {boolean} */
    const writesHtml = (file) => {
        const src = readFileSync(file, 'utf8');
        const reporter = /^\s*reporter:[^\n]*$/m.exec(src);
        if (reporter) return /'html'/.test(reporter[0]);
        const base = /^import base from '\.\/(playwright[\w.-]*\.mjs)';/m.exec(src);
        return base ? writesHtml(base[1]) : false;
    };

    test('the reading itself works: the smoke config writes html, the live one does not', () => {
        assert.equal(configOf('test:e2e'), 'playwright.config.mjs');
        assert.equal(configOf('test:live'), 'playwright.live.mjs');
        assert.equal(writesHtml('playwright.config.mjs'), true);
        assert.equal(writesHtml('playwright.webkit.mjs'), true, 'the WebKit config inherits the smoke config\'s reporter');
        assert.equal(writesHtml('playwright.live.mjs'), false);
    });

    let uploads = 0;
    for (const wf of readdirSync(WF_DIR).filter(f => /\.ya?ml$/.test(f))) {
        const src = readFileSync(join(WF_DIR, wf), 'utf8');
        const body = src.slice(src.search(/^jobs:/m));
        const starts = [...body.matchAll(/^ {2}([A-Za-z_][\w-]*):[ \t]*$/gm)];
        starts.forEach((s, i) => {
            const job = body.slice(s.index, starts[i + 1]?.index ?? body.length);
            const configs = [...new Set([...job.matchAll(/npm run (test:[\w:]+)/g)].map(m => configOf(m[1])).filter(c => c !== null))];
            const steps = job.split(/\n(?= {6}- )/).filter(st => /uses: actions\/upload-artifact@/.test(st)
                && /(playwright-report|test-results)\//.test(st));
            for (const step of steps) {
                uploads++;
                test(`${wf} → ${s[1]}: its upload holds what ${configs.join(', ') || 'its config'} writes`, () => {
                    assert.ok(configs.length, `${wf} → ${s[1]} uploads Playwright output but runs no Playwright lane`);
                    if (/test-results\//.test(step)) return;
                    const silent = configs.filter(c => !writesHtml(c));
                    assert.deepEqual(silent, [],
                        `${wf} → ${s[1]} uploads only playwright-report/, which ${silent.join(', ')} never writes — `
                        + 'a failure would leave no artefact. Upload test-results/, where retain-on-failure keeps the traces.');
                });
            }
        });
    }

    test('the uploads were found', () => {
        assert.ok(uploads >= 8, `only ${uploads} Playwright uploads found across the workflows — the scan has stopped matching`);
    });
});

// ── THE LIVE-SITE ALERT DOES NOT SEND ITS READER AWAY FROM AN OUTAGE (10 Nov 2026 review) ─────────
//
// The direct-connection probe reads web.app's robots.txt, and anything but a 200 — web.app answering
// 404 or 5xx for everything, the worst outage there is — failed every page on that assertion before
// any page opened. The issue's first hint then said such a failure was "a TLS or DNS answer, not an
// app one". The hint must leave the outage possible and say how to tell.
describe('the live-site alert does not send its reader away from an outage', () => {
    const src = readFileSync(join(WF_DIR, 'live-health.yml'), 'utf8');
    const hint = src.slice(src.indexOf('"1. The run\'s log names the page'), src.indexOf('"2. A stuck splash'));

    test('the hint was found', () => {
        assert.ok(hint.length > 50, 'the first hint of the live-site issue was not found');
    });

    test('a failed direct probe is not ruled out as the outage, and the reader is told how to tell', () => {
        assert.doesNotMatch(hint, /an app one/, 'the hint rules the app out for a failure the site itself can cause');
        assert.match(hint, /web\.app itself is answering with an error/, 'the hint must name the site answering with an error as a cause');
        assert.match(hint, /robots\.txt in a private window/, 'the hint must say how to tell the two apart');
    });
});

// ── A DEPLOY JOB LEAVES NO GIT TOKEN ON DISK (10 Nov 2026 review) ────────────────────────────────
//
// The checkout's default keeps the job's token on disk for the whole job, where every dependency's
// install script can read it — and nothing in a deploy job uses it: the Hosting upload check only
// lists files, and the re-run check asks the API with the token it is handed. The mirror's deploy
// job already said `persist-credentials: false`; the other three now do too.
describe('a deploy job leaves no git token on disk', () => {
    for (const wf of ['deploy-hosting.yml', 'deploy-functions.yml', 'deploy-rules.yml', 'deploy-mirror.yml']) {
        test(`${wf}: the deploy job's checkout keeps no credentials`, () => {
            const src = readFileSync(join(WF_DIR, wf), 'utf8');
            const from = src.search(/^ {2}deploy:[ \t]*$/m);
            assert.ok(from > -1, `${wf} has no deploy job`);
            const rest = src.slice(from + 1);
            const job = rest.slice(0, rest.search(/^ {2}[A-Za-z_][\w-]*:[ \t]*$/m));
            const at = job.indexOf('uses: actions/checkout@');
            assert.ok(at > -1, `${wf}: the deploy job has no checkout`);
            const tail = job.slice(at + 1);
            const step = tail.slice(0, tail.search(/\n\s*- (name|uses):/));
            assert.match(step, /^\s+persist-credentials: false[ \t]*$/m,
                `${wf}: the deploy job's checkout leaves the token on disk for every install script in the job to read`);
        });
    }
});

