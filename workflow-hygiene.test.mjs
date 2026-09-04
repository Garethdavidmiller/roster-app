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
    const DEPLOYS = ['deploy-hosting.yml', 'deploy-functions.yml', 'deploy-rules.yml'];

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
// without noticing. Asserted here rather than trusted.
describe('deploy workflows only run from main', () => {
    for (const wf of ['deploy-hosting.yml', 'deploy-functions.yml', 'deploy-rules.yml']) {
        test(`${wf} gates its deploy job on refs/heads/main`, () => {
            const src = readFileSync(new URL(`.github/workflows/${wf}`, import.meta.url), 'utf8');
            assert.match(src, /if:\s*github\.ref == 'refs\/heads\/main'/,
                `${wf} must gate its deploy job on main — without it a manual dispatch from a `
                + 'branch can displace a pending main deploy and land production on that branch');
        });
    }
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
describe('the visual lane never gates, and never goes quiet', () => {
    const src = readFileSync(join(WF_DIR, 'e2e.yml'), 'utf8');
    const jobsAt = src.search(/^jobs:/m);
    const body = src.slice(jobsAt);
    const start = body.search(/^ {2}visual:[ \t]*$/m);
    const rest = start === -1 ? '' : body.slice(start + 1);
    const nextJob = rest.search(/^ {2}[A-Za-z_][\w-]*:[ \t]*$/m);
    const job = nextJob === -1 ? rest : rest.slice(0, nextJob);

    test('the visual job exists', () => {
        assert.ok(start > -1, 'e2e.yml has no `visual:` job');
    });

    test('it cannot fail a build on a rendering difference', () => {
        assert.match(job, /^ {4}continue-on-error: true[ \t]*$/m,
            'the visual job must stay continue-on-error. Baselines are captured on one machine and '
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
        assert.match(job, /<!-- visual-baseline-drift -->/,
            'the notifier must carry a stable HTML marker, or it posts a fresh comment per push '
            + 'instead of updating one');
        assert.match(job, /gh pr comment/,
            'the visual job must actually say something on the pull request');
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
    const exclusion = (() => {
        const from = e2eSrc.indexOf('RUNTIME=$(');
        assert.ok(from > -1, 'the version job no longer builds a RUNTIME file list');
        const m = /grep -vE "([^"]+)"/.exec(e2eSrc.slice(from));
        assert.ok(m, 'the version job no longer filters its file list');
        return new RegExp(m[1]);
    })();
    /** True when the guard would DEMAND a version bump for a change to this path. */
    const needsBump = (/** @type {string} */ path) => !exclusion.test(path);

    test('a change that cannot reach a device is exempt', () => {
        for (const f of ['package.json', 'package-lock.json', 'jsconfig.json', 'eslint.config.js',
                         'playwright.config.mjs', 'playwright.visual.mjs', 'githooks/pre-commit',
                         'docs/AI_MAP.md', 'CLAUDE.md', 'workflow-hygiene.test.mjs',
                         'e2e/pages.spec.js', 'scripts/bump-version.mjs']) {
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
                         'firebase.json', 'firestore.rules', 'storage.rules']) {
            assert.equal(needsBump(f), true,
                `${f} is exempt from the version guard. If that was done to quiet a failing job, `
                + 'it disarmed the guard for precisely the files it exists to protect.');
        }
    });

    test('and the guard still fails the branch rather than warning', () => {
        // A guard that prints and exits 0 is a comment. This one is the reason the v22.29 duplicate
        // could not happen again, and only a non-zero exit delivers that.
        const job = e2eSrc.slice(e2eSrc.indexOf('  version:'), e2eSrc.indexOf('  unit:'));
        assert.match(job, /::error::/, 'the version job must annotate the failure');
        assert.match(job, /exit 1/, 'the version job must FAIL, not warn');
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
