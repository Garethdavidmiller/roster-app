#!/usr/bin/env node
/**
 * bump-version.mjs — update the app version in the 2 RUNTIME locations (v16.81).
 *
 * Usage:
 *   node scripts/bump-version.mjs 13.48
 *   npm run bump 13.48
 *
 * The 2 locations are:
 *   1. roster-data.js        — APP_VERSION export (authoritative source; drives every runtime read)
 *   2. service-worker.js     — APP_VERSION const (names the SW cache; the actual freshness lever)
 *
 * (The old 7 pure-comment stamps — the SW line-1 comment and six HTML line-2 comments — were
 *  dropped in the v16.81 debt sweep: they were maintenance-only noise that touched 8 files on
 *  ~half of all commits and conflicted across parallel branches, while carrying no runtime effect.
 *  The runtime version is still shown to staff via the About lightbox, which reads APP_VERSION.)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const newVersion = process.argv[2];

if (!newVersion || !/^\d+\.\d+$/.test(newVersion)) {
    console.error('Usage: node scripts/bump-version.mjs <version>  e.g. 13.48');
    process.exit(1);
}

function patch(file, pattern, replacement) {
    const filePath = join(ROOT, file);
    const src = readFileSync(filePath, 'utf8');
    const patched = src.replace(pattern, replacement);   // String.replace accepts a string OR a function
    if (patched === src) {
        // TWO DIFFERENT FAILURES, and they were reported as one. A no-op replace means either the
        // pattern genuinely did not match (the version line moved or was reshaped — a real problem)
        // or it matched and the file ALREADY says the target, which happens whenever a version
        // conflict is resolved to the value being bumped to. Reporting both as "Pattern not matched"
        // sends the reader hunting for a broken regex that is working correctly.
        if (pattern.test(src)) {
            throw new Error(`${file} already reads ${newVersion} — nothing to bump. `
                + 'If a merge resolution set it by hand, that is the write this script should own: '
                + 'set the line back to the previous version and re-run.');
        }
        throw new Error(`Pattern not matched in ${file}: ${pattern}`);
    }
    writeFileSync(filePath, patched);
    console.log(`  ✓ ${file}`);
}

console.log(`Bumping version to ${newVersion}…`);

// 1. roster-data.js
patch('roster-data.js',
    /export const APP_VERSION = '\d+\.\d+'/,
    `export const APP_VERSION = '${newVersion}'`);

// 2. service-worker.js — APP_VERSION const (names the SW cache).
patch('service-worker.js',
    /const APP_VERSION = '\d+\.\d+'/,
    `const APP_VERSION = '${newVersion}'`);

console.log(`\nDone. Run tests to verify: npm test`);
