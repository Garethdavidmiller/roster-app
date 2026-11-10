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
 *
 * EVERYTHING IS CHECKED BEFORE ANYTHING IS WRITTEN (whole-app check, 10 November 2026). It used to
 * write `roster-data.js` and then discover a problem with `service-worker.js`, leaving the two
 * disagreeing — and its own advice for that case failed the same way on the other file. And it took
 * any `digits.digits`: `25.7` read as 25.70 to CI and the hook but as 25.07 to the worker's version
 * ordering, so a 25.69 worker could sweep the newer release's cache; `25.640` outranked every later
 * 25.xx. A version is now exactly two decimals, above the one both files already agree on.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const newVersion = process.argv[2];

/** @param {string} msg */
function refuse(msg) {
    console.error(`✗ ${msg}\n  Nothing was written.`);
    process.exit(1);
}

if (!newVersion || !/^\d+\.\d{2}$/.test(newVersion)) {
    console.error('Usage: node scripts/bump-version.mjs <version>  e.g. 13.48 — exactly two decimals:'
        + ' 25.70, never 25.7 (the service worker would order that as 25.07).');
    process.exit(1);
}

/** "25.07" → 2507. Both parts are integers, so this is the one ordering every reader of it agrees on. */
const hundredths = (/** @type {string} */ v) => {
    const [whole, frac] = v.split('.');
    return Number(whole) * 100 + Number(frac);
};

const LOCATIONS = [
    // 1. roster-data.js — the APP_VERSION export every runtime read uses.
    { file: 'roster-data.js', pattern: /export const APP_VERSION = '(\d+\.\d+)'/, line: (/** @type {string} */ v) => `export const APP_VERSION = '${v}'` },
    // 2. service-worker.js — the APP_VERSION const that names the SW cache.
    { file: 'service-worker.js', pattern: /const APP_VERSION = '(\d+\.\d+)'/, line: (/** @type {string} */ v) => `const APP_VERSION = '${v}'` },
];

const read = LOCATIONS.map(loc => {
    const src = readFileSync(join(ROOT, loc.file), 'utf8');
    const m = loc.pattern.exec(src);
    if (!m) refuse(`the APP_VERSION line was not found in ${loc.file} (${loc.pattern}) — has it moved?`);
    return { ...loc, src, current: /** @type {RegExpExecArray} */ (m)[1] };
});

const [first, second] = read;
if (first.current !== second.current) {
    // A merge resolution that set one of them by hand. Which one is right is the question the
    // reader must answer; this script will not guess, and a half-bump is worse than none.
    refuse(`${first.file} reads ${first.current} but ${second.file} reads ${second.current}. Set both to\n`
        + '  the version on main (git show origin/main:roster-data.js | grep APP_VERSION), then re-run.');
}
const current = first.current;
if (!/^\d+\.\d{2}$/.test(current)) {
    refuse(`the current version ${current} is not two decimals — correct both files by hand first.`);
}
if (hundredths(newVersion) <= hundredths(current)) {
    refuse(`${newVersion} is not above the current ${current}. The version names the service-worker`
        + ' cache, so it only ever goes up.');
}

console.log(`Bumping version ${current} → ${newVersion}…`);
for (const loc of read) {
    // A function replacement, so nothing in the line is read as a `$` pattern.
    writeFileSync(join(ROOT, loc.file), loc.src.replace(loc.pattern, () => loc.line(newVersion)));
    console.log(`  ✓ ${loc.file}`);
}
console.log(`\nDone. Run tests to verify: npm test`);
