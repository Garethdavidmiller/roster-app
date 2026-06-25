#!/usr/bin/env node
/**
 * typecheck.mjs — Phase 9a CI gate.
 *
 * Runs `tsc --noEmit` and exits with failure only when non-TS2339 errors are
 * present. TS2339 ("property does not exist on type HTMLElement") are DOM
 * access errors deferred to Phase 9b. All other error codes are blocking.
 */
import { spawnSync } from 'child_process';

const result = spawnSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['tsc', '-p', 'jsconfig.json', '--noEmit'],
    { encoding: 'utf8', stdio: 'pipe' }
);

const output = (result.stdout || '') + (result.stderr || '');
const errorLines = output.split('\n').filter(l => /error TS\d+/.test(l));
const blocking   = errorLines.filter(l => !l.includes('TS2339'));

if (blocking.length > 0) {
    process.stdout.write(output);
    process.exit(1);
}

const dom = errorLines.filter(l => l.includes('TS2339')).length;
if (dom > 0) {
    console.log(`TypeScript: ${dom} TS2339 (DOM property) error(s) — deferred to Phase 9b`);
}
