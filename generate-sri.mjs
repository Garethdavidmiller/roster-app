#!/usr/bin/env node
/**
 * generate-sri.mjs — Fetch CDN resources and compute SRI hashes.
 *
 * Usage:
 *   node generate-sri.mjs           # print hash and snippet, change nothing
 *   node generate-sri.mjs --apply   # also patch huddle.js in-place
 *
 * Run after upgrading the Mammoth CDN version. Commit the updated huddle.js
 * alongside the version bump.
 *
 * DOMPurify is self-hosted at ./purify.es.mjs — it is NOT managed here.
 * To upgrade DOMPurify: `npm pack dompurify@<ver>`, extract
 * package/dist/purify.es.mjs, replace this file, update the version comment
 * in app-huddle-viewer.js.
 *
 * Requires Node 18+ (global fetch, node:crypto).
 *
 * Files patched by --apply:
 *   huddle.js  — s.integrity set on mammoth script injection
 */

import { createHash }        from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join }     from 'node:path';
import { fileURLToPath }     from 'node:url';

const ROOT  = dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes('--apply');

// ── CDN resources to hash ─────────────────────────────────────────────────────
// Update the URL here when upgrading Mammoth, then re-run --apply.
const CDN = [
    {
        key: 'mammoth',
        url: 'https://cdn.jsdelivr.net/npm/mammoth@1.12.0/mammoth.browser.min.js',
        type: 'script',
        usedIn: 'huddle.js',
    },
];

// ── Fetch + hash ──────────────────────────────────────────────────────────────
async function fetchSRI(url) {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const buf  = Buffer.from(await res.arrayBuffer());
    const hash = createHash('sha384').update(buf).digest('base64');
    return { hash: `sha384-${hash}`, resolvedUrl: res.url };
}

const results = {};
for (const item of CDN) {
    process.stdout.write(`Fetching ${item.url} ... `);
    try {
        const { hash, resolvedUrl } = await fetchSRI(item.url);
        results[item.key] = { ...item, hash, resolvedUrl };
        console.log('✓');
    } catch (e) {
        console.error(`✗  ${e.message}`);
        process.exit(1);
    }
}

const { mammoth: mm } = results;

// ── Print summary ─────────────────────────────────────────────────────────────
console.log('\n── mammoth ────────────────────────────────────────────────────────');
console.log(`URL  : ${mm.resolvedUrl}`);
console.log(`Hash : ${mm.hash}`);
console.log('\nAdd to huddle.js mammoth script injection:');
console.log(`  s.integrity = '${mm.hash}';`);

if (!APPLY) {
    console.log('\nRun with --apply to update source files automatically.');
    process.exit(0);
}

// ── Patch source files ────────────────────────────────────────────────────────
console.log('\nPatching source files...');

// huddle.js — set s.integrity on mammoth script injection
{
    const path = join(ROOT, 'huddle.js');
    let src = readFileSync(path, 'utf8');

    if (/s\.integrity\s*=/.test(src)) {
        src = src.replace(
            /s\.integrity\s*=\s*'sha384-[^']*'/,
            `s.integrity   = '${mm.hash}'`
        );
        console.log('✓  huddle.js — mammoth integrity updated');
    } else {
        src = src.replace(
            /(s\.crossOrigin\s*=\s*'anonymous';)/,
            `$1\n                    s.integrity   = '${mm.hash}';`
        );
        console.log('✓  huddle.js — mammoth integrity inserted');
    }
    writeFileSync(path, src);
}

console.log('\nDone. Review changes with `git diff` before committing.');
