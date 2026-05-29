#!/usr/bin/env node
/**
 * generate-sri.mjs — Fetch CDN resources and compute SRI hashes.
 *
 * Usage:
 *   node generate-sri.mjs           # print hashes and snippets, change nothing
 *   node generate-sri.mjs --apply   # also patch source files in-place
 *
 * Run after upgrading any CDN dependency version. Commit the updated source
 * files (app-huddle-viewer.js, huddle.js, index.html) alongside the version bump.
 *
 * Requires Node 18+ (global fetch, node:crypto).
 *
 * Files patched by --apply:
 *   app-huddle-viewer.js  — DOMPurify import URL pinned to resolved version
 *   index.html            — <link rel="modulepreload" integrity="..."> added/updated
 *   huddle.js             — s.integrity set on mammoth script injection
 */

import { createHash }        from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join }     from 'node:path';
import { fileURLToPath }     from 'node:url';

const ROOT  = dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes('--apply');

// ── CDN resources to hash ─────────────────────────────────────────────────────
// DOMPurify: @3 is a floating tag — the resolved URL after redirect contains the
// pinned version (e.g. @3.2.4). That pinned URL is what gets written back to
// app-huddle-viewer.js and the modulepreload link in index.html.
const CDN = [
    {
        key: 'dompurify',
        url: 'https://cdn.jsdelivr.net/npm/dompurify@3/dist/purify.es.mjs',
        type: 'esmodule',
        usedIn: 'app-huddle-viewer.js',
    },
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

const { dompurify: dp, mammoth: mm } = results;

// ── Print summary ─────────────────────────────────────────────────────────────
console.log('\n── DOMPurify ──────────────────────────────────────────────────────');
console.log(`Resolved URL : ${dp.resolvedUrl}`);
console.log(`Hash         : ${dp.hash}`);
console.log('\nAdd to index.html <head> (after shared.css link):');
console.log(`  <link rel="modulepreload" integrity="${dp.hash}" crossorigin="anonymous" href="${dp.resolvedUrl}">`);

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

// 1. app-huddle-viewer.js — pin DOMPurify URL
{
    const path = join(ROOT, 'app-huddle-viewer.js');
    let src = readFileSync(path, 'utf8');
    src = src.replace(
        /https:\/\/cdn\.jsdelivr\.net\/npm\/dompurify@[^\s'"]+/g,
        dp.resolvedUrl
    );
    writeFileSync(path, src);
    console.log(`✓  app-huddle-viewer.js — DOMPurify URL → ${dp.resolvedUrl}`);
}

// 2. index.html — add or update <link rel="modulepreload"> for DOMPurify
{
    const path = join(ROOT, 'index.html');
    let html = readFileSync(path, 'utf8');
    const preload = `    <link rel="modulepreload" integrity="${dp.hash}" crossorigin="anonymous" href="${dp.resolvedUrl}">`;

    if (/cdn\.jsdelivr\.net\/npm\/dompurify/.test(html)) {
        // Update existing preload line
        html = html.replace(
            /\s*<link rel="modulepreload"[^>]*cdn\.jsdelivr\.net\/npm\/dompurify[^>]*>/,
            `\n${preload}`
        );
        console.log('✓  index.html — DOMPurify modulepreload updated');
    } else {
        // Insert after shared.css link
        html = html.replace(
            /(<link rel="stylesheet" href="shared\.css">)/,
            `$1\n${preload}`
        );
        console.log('✓  index.html — DOMPurify modulepreload inserted');
    }
    writeFileSync(path, html);
}

// 3. huddle.js — set s.integrity on mammoth script injection
{
    const path = join(ROOT, 'huddle.js');
    let src = readFileSync(path, 'utf8');

    if (/s\.integrity\s*=/.test(src)) {
        // Update existing integrity line
        src = src.replace(
            /s\.integrity\s*=\s*'sha384-[^']*'/,
            `s.integrity   = '${mm.hash}'`
        );
        console.log('✓  huddle.js — mammoth integrity updated');
    } else {
        // Insert integrity line after s.crossOrigin
        src = src.replace(
            /(s\.crossOrigin\s*=\s*'anonymous';)/,
            `$1\n                    s.integrity   = '${mm.hash}';`
        );
        console.log('✓  huddle.js — mammoth integrity inserted');
    }
    writeFileSync(path, src);
}

console.log('\nDone. Review changes with `git diff` before committing.');
