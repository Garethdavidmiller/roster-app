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
 * A regex-only check is fail-open: if tsc never runs (missing npx, killed
 * process, npm-level error with no TS-formatted output) there are no matching
 * lines and the gate would falsely report success. `tsc --noEmit` exits 0 only
 * when the project is clean, so the exit status already covers both real
 * diagnostics and tooling failures.
 */
import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';

// Prefer the project-local compiler binary. Invoking it directly through the
// current Node executable avoids depending on `npx` being able to launch —
// which, when it could not, was exactly what made the old gate fail open.
const localTsc = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url));

const result = existsSync(localTsc)
    ? spawnSync(process.execPath, [localTsc, '-p', 'jsconfig.json', '--noEmit'], { encoding: 'utf8' })
    : spawnSync(
        process.platform === 'win32' ? 'npx.cmd' : 'npx',
        ['tsc', '-p', 'jsconfig.json', '--noEmit'],
        { encoding: 'utf8' }
    );

const output = (result.stdout || '') + (result.stderr || '');

// Source of truth is the process result, not a regex over stdout.
if (result.error || result.status !== 0) {
    if (output) process.stdout.write(output);
    if (result.error) console.error('[typecheck] tsc failed to run:', result.error.message);
    process.exit(result.status ?? 1);
}
