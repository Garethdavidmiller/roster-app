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
