#!/usr/bin/env node
/**
 * typecheck.mjs — Phase 9b CI gate.
 *
 * Runs `tsc --noEmit` and exits with failure on any error.
 * Phase 9b completed: all TS2339 DOM property errors resolved with JSDoc casts.
 */
import { spawnSync } from 'child_process';

const result = spawnSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['tsc', '-p', 'jsconfig.json', '--noEmit'],
    { encoding: 'utf8', stdio: 'pipe' }
);

const output = (result.stdout || '') + (result.stderr || '');
const errorLines = output.split('\n').filter(l => /error TS\d+/.test(l));

if (errorLines.length > 0) {
    process.stdout.write(output);
    process.exit(1);
}
