#!/usr/bin/env node
/**
 * typecheck.mjs — CI type-check gate.
 *
 * Runs `tsc --noEmit` against EACH project below, and exits non-zero on ANY failure in any of them:
 * a real TypeScript diagnostic, OR an abnormal tooling failure (the compiler could not launch, was
 * killed, or crashed before emitting diagnostics).
 *
 * ── THE PROJECTS (two since 25 Nov 2026) ───────────────────────────────────────────────────────
 *
 *   · `jsconfig.json` — the browser modules (`// @ts-check`, DOM lib).
 *   · `functions/jsconfig.json` — the Cloud Functions: CommonJS on Node, every `functions/*.js`, with
 *     the same `strict`. Its types come from `functions/node_modules` (firebase-admin,
 *     firebase-functions, the Anthropic SDK, and the lockfile's `@types/node`), so it needs that
 *     install as well as the root one. Until this date the Functions were excluded from the checker
 *     entirely; `typecheck-scope.test.mjs` records the decision and pins both projects.
 *
 * Every project is run, even after one fails, so a report names every broken project at once rather
 * than one per push. The answer is still a single exit status.
 *
 * The gate is fail-CLOSED. It trusts the child process's exit status as the
 * source of truth — NOT merely the presence of `error TS\d+` lines in stdout.
 * A regex-only check is fail-open: if tsc never runs (missing binary, killed
 * process, npm-level error with no TS-formatted output) there are no matching
 * lines and the gate would falsely report success. `tsc --noEmit` exits 0 only
 * when the project is clean, so the exit status already covers both real
 * diagnostics and tooling failures.
 *
 * ── IT REFUSES RATHER THAN FALLING BACK TO `npx tsc` (v22.32) ──────────────
 *
 * It used to fall back to `npx tsc` when the project-local compiler was
 * missing. In CI that branch never ran, because CI installs. The only person
 * it ever served was someone type-checking a tree with no `node_modules` — and
 * there it did real harm. Measured on a bare checkout: npx fetched an unpinned
 * compiler and reported two `Cannot find module` diagnostics against
 * `eslint.config.js`, for devDependencies that were simply not installed.
 * Those are artefacts of the missing install, not application defects, and
 * they are indistinguishable from real ones in a report. An external reviewer
 * discounted the whole run for exactly that reason, which was the correct
 * call — a gate whose output has to be discounted is worse than one that
 * declines to answer.
 *
 * So: no compiler, no verdict. The refusal is fail-closed like every other
 * failure here, and it names the install that produces a trustworthy answer.
 * The SAME holds for the Functions project's own install: without it every
 * `require('firebase-admin/…')` reads as a missing module — the identical
 * class of noise — so a missing `functions/node_modules` is refused too, never
 * checked and reported.
 */
import { spawnSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';

const at = (/** @type {string} */ rel) => fileURLToPath(new URL(`../${rel}`, import.meta.url));

// The project-local compiler binary, invoked through the current Node
// executable — that avoids depending on `npx` being able to launch, which,
// when it could not, was what made an even earlier version of this gate fail
// open.
const localTsc = at('node_modules/typescript/bin/tsc');

if (!existsSync(localTsc)) {
    // Read the pin rather than restating it, so this message cannot go stale.
    let pinned = 'the version in package.json';
    try {
        const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
        const v = pkg.devDependencies?.typescript;
        if (v) pinned = `typescript@${v}`;
    } catch { /* the message is still useful without it */ }

    console.error(
        `[typecheck] ${localTsc} is not installed, so there is no verdict to give.\n\n`
        + `  This project type-checks with ${pinned} against jsconfig.json and functions/jsconfig.json.\n`
        + '  Running `npx tsc` instead resolves a DIFFERENT compiler, and on an uninstalled tree it reports\n'
        + '  missing devDependencies as errors — noise that reads like application defects. This gate used\n'
        + '  to do that for you; it no longer will.\n\n'
        + '  For a real answer:  npm ci && npm ci --prefix functions && npm run typecheck\n\n'
        + '  Everything else can be verified with nothing installed — see README.md, or run\n'
        + '  `npm test` and `node scripts/test-nodeps.mjs` right now.');
    process.exit(1);
}

/**
 * Each project, and the installed packages its types come from. A project whose packages are
 * missing is REFUSED (above), never run: its diagnostics would be the install's, not the code's.
 * @type {Array<{ config: string, needs: string[], install: string }>}
 */
const PROJECTS = [
    { config: 'jsconfig.json', needs: [], install: 'npm ci' },
    {
        config: 'functions/jsconfig.json',
        needs: ['functions/node_modules/firebase-admin/package.json',
                'functions/node_modules/firebase-functions/package.json',
                'functions/node_modules/@types/node/package.json'],
        install: 'npm ci --prefix functions',
    },
];

const missing = PROJECTS.flatMap(p => p.needs.filter(f => !existsSync(at(f)))
    .map(f => ({ config: p.config, file: f, install: p.install })));
if (missing.length) {
    console.error(
        `[typecheck] ${missing[0].config} cannot be checked: ${missing.map(m => m.file).join(', ')} `
        + `${missing.length === 1 ? 'is' : 'are'} not installed, so there is no verdict to give.\n\n`
        + '  That project\'s types come from its own install. Without it every require of the Firebase\n'
        + '  SDKs reads as a missing module — noise that reads like application defects — so this gate\n'
        + '  declines to answer rather than report it.\n\n'
        + `  For a real answer:  ${[...new Set(missing.map(m => m.install))].join(' && ')} && npm run typecheck`);
    process.exit(1);
}

let failed = 0;
for (const { config } of PROJECTS) {
    const result = spawnSync(process.execPath, [localTsc, '-p', config, '--noEmit'],
        { encoding: 'utf8', cwd: at('') });
    const output = (result.stdout || '') + (result.stderr || '');

    // Source of truth is the process result, not a regex over stdout.
    if (result.error || result.status !== 0) {
        failed++;
        console.error(`[typecheck] ${config} — FAILED`);
        if (output) process.stdout.write(output);
        if (result.error) console.error('[typecheck] tsc failed to run:', result.error.message);
    } else {
        console.log(`[typecheck] ${config} — clean`);
    }
}
if (failed) process.exit(1);
