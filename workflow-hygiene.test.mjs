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
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

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
    const DEPLOY_WORKFLOWS = ['deploy-rules.yml', 'deploy-hosting.yml', 'deploy-functions.yml'];

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
            assert.match(block, /^ {4}needs: deploy[ \t]*$/m,
                `${file}: report-failure must declare 'needs: deploy'`);
            assert.match(block, /^ {4}if: failure\(\)[ \t]*$/m,
                `${file}: report-failure needs a JOB-level 'if: failure()' — a step-level guard is `
                + 'exactly what could not fire when the job failed during setup.');
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
