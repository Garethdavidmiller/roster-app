#!/usr/bin/env node
/**
 * typecheck.mjs — CI type-check gate.
 *
 * Runs `tsc --noEmit` against jsconfig.json and exits non-zero on ANY failure:
 * a real TypeScript diagnostic, OR an abnormal tooling failure (the compiler
 * could not launch, was killed, or crashed before emitting diagnostics).
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
 */
import { spawnSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';

// The project-local compiler binary, invoked through the current Node
// executable — that avoids depending on `npx` being able to launch, which,
// when it could not, was what made an even earlier version of this gate fail
// open.
const localTsc = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url));

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
        + `  This project type-checks with ${pinned} against jsconfig.json. Running \`npx tsc\`\n`
        + '  instead resolves a DIFFERENT compiler, and on an uninstalled tree it reports missing\n'
        + '  devDependencies as errors — noise that reads like application defects. This gate used\n'
        + '  to do that for you; it no longer will.\n\n'
        + '  For a real answer:  npm ci && npm run typecheck\n\n'
        + '  Everything else can be verified with nothing installed — see README.md, or run\n'
        + '  `npm test` and `node scripts/test-nodeps.mjs` right now.');
    process.exit(1);
}

const result = spawnSync(process.execPath, [localTsc, '-p', 'jsconfig.json', '--noEmit'],
    { encoding: 'utf8' });

const output = (result.stdout || '') + (result.stderr || '');

// Source of truth is the process result, not a regex over stdout.
if (result.error || result.status !== 0) {
    if (output) process.stdout.write(output);
    if (result.error) console.error('[typecheck] tsc failed to run:', result.error.message);
    process.exit(result.status ?? 1);
}
