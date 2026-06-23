#!/usr/bin/env node
/**
 * bump-version.mjs — update the app version in all 9 mandatory locations (per CLAUDE.md).
 *
 * Usage:
 *   node scripts/bump-version.mjs 13.48
 *   npm run bump 13.48
 *
 * The 9 locations are:
 *   1. roster-data.js        — APP_VERSION export (authoritative source)
 *   2. service-worker.js     — line 1 comment
 *   3. service-worker.js     — APP_VERSION const
 *   4. index.html            — line 2 comment
 *   5. admin.html            — line 2 comment
 *   6. paycalc.html          — line 2 comment
 *   7. operations.html       — line 2 comment
 *   8. settings.html         — line 2 comment
 *   9. links.html            — line 2 comment
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
    const patched = typeof replacement === 'function'
        ? src.replace(pattern, replacement)
        : src.replace(pattern, replacement);
    if (patched === src) {
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

// 2. service-worker.js — line 1 comment
patch('service-worker.js',
    /\/\/ MYB Roster — Service Worker v\d+\.\d+/,
    `// MYB Roster — Service Worker v${newVersion}`);

// 3. service-worker.js — APP_VERSION const
patch('service-worker.js',
    /const APP_VERSION = '\d+\.\d+'/,
    `const APP_VERSION = '${newVersion}'`);

// 4–9. HTML page comments (each has a unique page name, so we match the version suffix)
for (const file of ['index.html', 'admin.html', 'paycalc.html', 'operations.html', 'settings.html', 'links.html']) {
    patch(file,
        /(<!-- MYB Roster[^>]* v)\d+\.\d+( -->)/,
        (_, pre, post) => `${pre}${newVersion}${post}`);
}

console.log(`\nDone. Run tests to verify: npm test`);
