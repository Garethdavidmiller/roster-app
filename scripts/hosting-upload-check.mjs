#!/usr/bin/env node
// @ts-check
// hosting-upload-check.mjs — what `firebase deploy --only hosting` is ABOUT TO UPLOAD, checked before it does.
//
// ── WHY THIS EXISTS (10 Nov 2026) ────────────────────────────────────────────────────────────
//
// Hosting's public directory is the repository root (`"public": "."`), so a deploy uploads whatever
// the runner's folder holds that `hosting.ignore` does not name. Two things in that folder were
// never named, and both were being served from the staff site after every release:
//
//   · `.git/` — the deploy's own checkout. `**/.*` hides a dot-FILE, not what lies beneath a
//     dot-directory (the same gap `.claude/**` and `.github/**` were added for on 8 Sep 2026).
//   · `gha-creds-<random>.json` — the file the Google sign-in step writes INTO THE WORKSPACE. It
//     holds the address for acting as the deploy account and the bearer token that asks GitHub for
//     this run's identity, and the run log prints its name. Published, it is a handle on the deploy
//     account for as long as that token lives.
//
// Both are now in `hosting.ignore` (hosting-ignore-parity.test.mjs pins them). This is the second
// lock, and it is deliberately not a list: it asks firebase-tools' OWN lister what the deploy would
// upload, and refuses anything git does not track. The next file a tool drops beside the app — a
// debug log, a cache, a credential by another name — fails the deploy instead of being published.
//
// It runs AFTER the sign-in step and BEFORE the deploy, so the credentials file is on disk when the
// question is asked: a pass means the ignore list really excludes it, here, on this runner.
//
// The lister is firebase-tools' internal `lib/listFiles` — the function its Hosting deploy calls.
// An internal path can move in a firebase-tools release; if it does, this fails LOUDLY rather than
// passing by having checked nothing, and the deploy stops until somebody points it at the new one.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

/** A real bundle is hundreds of files. Far fewer means the lister or the config stopped answering. */
export const MIN_EXPECTED_FILES = 100;

/**
 * The files a deploy would upload that are NOT committed to the repository.
 * @param {string[]} upload   paths the deploy would upload, relative to the public directory
 * @param {Set<string>} tracked  every path git tracks
 * @returns {string[]} the strays, in the order given
 */
export function strayUploads(upload, tracked) {
    return upload.filter((p) => !tracked.has(p));
}

function main() {
    const hosting = JSON.parse(readFileSync('firebase.json', 'utf8')).hosting;
    if ((hosting.public ?? '.') !== '.') {
        // The tracked-file comparison below assumes upload paths and `git ls-files` paths share a root.
        console.error('::error::hosting.public is no longer "." — hosting-upload-check.mjs must be taught the new root before it can vouch for the upload.');
        process.exit(1);
    }
    /** @type {(cwd: string, ignore?: string[]) => string[]} */ let listFiles;
    try {
        ({ listFiles } = createRequire(import.meta.url)('firebase-tools/lib/listFiles'));
        if (typeof listFiles !== 'function') throw new Error('listFiles is not a function');
    } catch (err) {
        console.error(`::error::Could not load firebase-tools' file lister (lib/listFiles) — ${/** @type {Error} */ (err).message}. `
            + 'The upload cannot be checked, so the deploy stops here.');
        process.exit(1);
    }
    const upload = listFiles('.', hosting.ignore ?? []);
    const tracked = new Set(execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
        .split('\0').filter(Boolean));
    if (upload.length < MIN_EXPECTED_FILES || tracked.size < MIN_EXPECTED_FILES) {
        console.error(`::error::Only ${upload.length} files to upload and ${tracked.size} tracked — the listing has stopped working, so nothing is vouched for.`);
        process.exit(1);
    }
    const strays = strayUploads(upload, tracked);
    if (strays.length) {
        console.error(`::error::Hosting would upload ${strays.length} file(s) that are not part of the committed app. Nothing was deployed.`);
        // Names only, and only the first few: one of them may be a credentials file, whose NAME is
        // already in this log but whose listing here adds nothing a reader needs beyond the shape.
        for (const p of strays.slice(0, 20)) console.error(`  ${p}`);
        if (strays.length > 20) console.error(`  … and ${strays.length - 20} more`);
        console.error('Add the path to hosting.ignore in firebase.json (and to hosting-ignore-parity.test.mjs), or stop the tool writing it into the workspace.');
        process.exit(1);
    }
    console.log(`Hosting will upload ${upload.length} files, every one of them committed.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
