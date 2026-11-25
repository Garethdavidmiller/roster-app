#!/usr/bin/env node
// @ts-check
/**
 * generate-copies.mjs — `npm run generate:copies` — WRITE the facts this repo keeps in more than one
 * file, from the one place each is edited.
 *
 * ── WHY ────────────────────────────────────────────────────────────────────────────────────────
 *
 * The app has no build step (CLAUDE.md → "No bundler"), so a fact two files need is written in both,
 * and a "parity" test used to fail when somebody edited one and forgot the other. That catches the
 * drift after the fact and still leaves a human to make every copy by hand. Where a script can write
 * the second copy, it now does: the copy cannot drift, and there is one place to edit. This is the
 * pattern `npm run generate:roster-members` and `npm run generate:ai-map` already follow — the
 * output is COMMITTED, nothing runs at deploy or in the browser, and a test fails, naming this
 * command, when the committed output is not what this script would write now.
 *
 * ── WHAT IT WRITES, AND FROM WHERE ─────────────────────────────────────────────────────────────
 *
 * Each entry in COPIES below is one fact. Its function is handed `read(path)` — the file as it is
 * now — and returns every file it owns with its whole new content. Most own a REGION of a
 * hand-written file, and leave everything else in that file byte-for-byte alone.
 *
 *   csp-meta   every served page's <meta http-equiv="Content-Security-Policy">, from the
 *              Content-Security-Policy HEADER in firebase.json, minus the directives a <meta> CSP
 *              cannot carry. The GitHub Pages mirror serves no headers, so the <meta> is the only
 *              policy it applies (csp-meta-parity.test.mjs said why; now this file does).
 *
 *   module-preloads
 *              every app page's <link rel="modulepreload"> tags, between its GENERATED markers: the
 *              Firebase SDK modules firebase-client.js imports statically, at the version it pins
 *              (every page), then — for a page whose scripts/app-pages.mjs entry says `preloads` —
 *              its whole local static import graph. Without the hints the browser discovers modules
 *              in a waterfall, one level at a time (each page's comment above its preloads). They
 *              were hand-kept lists of up to ninety lines that sw-asset-check.test.mjs held to the graph.
 *
 *   sdk-version
 *              `FIREBASE_SDK_VERSION` in service-worker.js — the name of the worker's SDK cache — from
 *              the version firebase-client.js imports. A worker on the old name would warm the old
 *              SDK's files while every page imports the new one's.
 *
 * ── RUNNING IT ─────────────────────────────────────────────────────────────────────────────────
 *
 *   npm run generate:copies     writes whatever is out of date, and names each file it wrote
 *
 * A changed SERVED file (an .html, .js or .css the app serves) still needs a version bump, exactly
 * as a hand edit would (CLAUDE.md → "Version bumping").
 *
 * Checked by generated-copies.test.mjs (CI) and by githooks/pre-commit (the commit, as staged).
 * Importing this module writes nothing; only running it as a script does.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { APP_PAGES, servedFiles } from './app-pages.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** @typedef {(path: string) => string} Reader */
/** @typedef {Array<[file: string, content: string]>} Owned */

/**
 * Replace the ONE match of `re` in `src`, or throw saying which file has changed shape. A pattern
 * that matched nothing would leave the copy unwritten and the check green, so a miss is an error.
 * @param {string} src @param {RegExp} re @param {(m: RegExpMatchArray) => string} by @param {string} file @param {string} what
 */
function replaceOne(src, re, by, file, what) {
    const all = [...src.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'))];
    if (all.length !== 1) {
        throw new Error(`${file}: expected ONE ${what}, found ${all.length} — generate-copies.mjs cannot place the copy`);
    }
    const m = all[0];
    const at = /** @type {number} */ (m.index);
    return src.slice(0, at) + by(m) + src.slice(at + m[0].length);
}

// ── csp-meta ────────────────────────────────────────────────────────────────────────────────────

/** Directives a <meta http-equiv="Content-Security-Policy"> cannot express: browsers ignore them
 *  there, so writing them would imply a protection the mirror does not get. */
export const META_INCOMPATIBLE = Object.freeze(['frame-ancestors', 'report-uri', 'report-to', 'sandbox']);

/** The firebase.json Content-Security-Policy header value. @param {Reader} read */
export function headerCsp(read) {
    const fb = JSON.parse(read('firebase.json'));
    for (const h of fb.hosting?.headers ?? [])
        for (const kv of h.headers ?? [])
            if (kv.key === 'Content-Security-Policy') return String(kv.value);
    throw new Error('firebase.json: no Content-Security-Policy header to copy');
}

/** The header with the meta-incompatible directives taken out, every other byte kept.
 *  @param {string} header */
export function metaCspFor(header) {
    if (header.includes('"')) throw new Error('firebase.json: the CSP header holds a double quote, which would end the <meta> attribute');
    return header.split(';').map(s => s.trim()).filter(Boolean)
        .filter(d => !META_INCOMPATIBLE.includes(d.split(/\s+/)[0].toLowerCase()))
        .map(d => `${d};`).join(' ');
}

const CSP_COMMENT = '<!-- CSP mirrors the firebase.json header so the GitHub Pages mirror (which cannot serve HTTP headers) '
    + 'gets the same policy, and the CSP travels with the HTML through the SW cache. GENERATED: edit the header in '
    + 'firebase.json and run npm run generate:copies, never this line. -->';

/** @param {Reader} read @returns {Owned} */
function cspMeta(read) {
    const meta = metaCspFor(headerCsp(read));
    return servedFiles().map(file => {
        const src = read(file);
        const count = (src.match(/http-equiv=["']Content-Security-Policy["']/gi) || []).length;
        if (count !== 1) throw new Error(`${file}: carries ${count} CSP <meta> tags, not one`);
        // The comment line above the tag is part of the copy: it is what tells an editor not to edit.
        const out = replaceOne(src,
            /^([ \t]*)<!-- CSP mirrors the firebase\.json header[^\n]*-->\n([ \t]*)<meta http-equiv="Content-Security-Policy" content="[^"]*">/m,
            m => `${m[1]}${CSP_COMMENT}\n${m[2]}<meta http-equiv="Content-Security-Policy" content="${meta}">`,
            file, 'CSP comment line followed by its <meta> tag');
        return /** @type {[string, string]} */ ([file, out]);
    });
}

// ── module-preloads and sdk-version ─────────────────────────────────────────────────────────────

/**
 * The ONE Firebase SDK version firebase-client.js imports, and the SDK modules it imports STATICALLY
 * (`from '…'`). A dynamic `import('…')` — firebase-storage, lazy on purpose — has no `from`, so it is
 * never preloaded. Sorted, so the tags do not move when an import line does.
 * @param {Reader} read @returns {{ version: string, modules: string[] }}
 */
export function firebaseSdk(read) {
    const client = read('firebase-client.js');
    const versions = [...new Set([...client.matchAll(/gstatic\.com\/firebasejs\/([\d.]+)\//g)].map(m => m[1]))];
    if (versions.length !== 1) throw new Error(`firebase-client.js imports ${versions.length} Firebase SDK versions (${versions.join(', ')}), not one`);
    const modules = [...new Set([...client.matchAll(/\bfrom\s*['"]https:\/\/www\.gstatic\.com\/firebasejs\/[\d.]+\/(firebase-[a-z]+)\.js['"]/g)].map(m => m[1]))].sort();
    if (!modules.length) throw new Error('firebase-client.js imports no Firebase SDK module statically — the reading is wrong');
    return { version: versions[0], modules };
}

/**
 * The transitive set of LOCAL (`./`) static module deps reachable from `entry`, the entry included.
 * Comments are stripped first: a path written in a JSDoc ("re-exported from './foo.js'") would
 * otherwise add a phantom module. `://` is kept so a URL is not mangled. A file that cannot be read
 * is a module that does not exist, and the page's own import of it fails louder than this would.
 * @param {Reader} read @param {string} entry @returns {Set<string>}
 */
export function staticLocalGraph(read, entry) {
    const seen = new Set();
    /** @param {string} file */
    const walk = (file) => {
        if (seen.has(file)) return;
        seen.add(file);
        let src;
        try { src = read(file); } catch { return; }
        src = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
        const deps = [
            ...[...src.matchAll(/\bfrom\s*["']([^"']+)["']/g)].map(m => m[1]),       // import … from / export … from, multi-line too
            ...[...src.matchAll(/^\s*import\s*["']([^"']+)["']/gm)].map(m => m[1]),  // side-effect imports
        ];
        for (const p of deps) if (p.startsWith('./')) walk(p.slice(2));
    };
    walk(entry);
    return seen;
}

/** The local modules a page preloads: its graph from the module the HTML loads, minus a boot shim
 *  (the script tag itself, already being fetched), `.js` only. Sorted.
 *  @param {Reader} read @param {import('./app-pages.mjs').AppPage} page */
export function localPreloads(read, page) {
    const graph = staticLocalGraph(read, page.boot ?? page.coordinator);
    if (page.boot) graph.delete(page.boot);
    return [...graph].filter(f => f.endsWith('.js')).sort();
}

const PRELOADS_BEGIN = '<!-- GENERATED module preloads: npm run generate:copies writes every line down to the END marker, '
    + 'from firebase-client.js and this page\'s imports. Never edit them by hand. -->';
const PRELOADS_END = '<!-- END GENERATED module preloads -->';

/** @param {Reader} read @returns {Owned} */
function modulePreloads(read) {
    const { version, modules } = firebaseSdk(read);
    const sdk = modules.map(m => `<link rel="modulepreload" href="https://www.gstatic.com/firebasejs/${version}/${m}.js" crossorigin>`);
    return APP_PAGES.map(page => {
        const tags = [...sdk, ...(page.preloads ? localPreloads(read, page).map(f => `<link rel="modulepreload" href="./${f}">`) : [])];
        const out = replaceOne(read(page.file),
            /^([ \t]*)<!-- GENERATED module preloads[^\n]*-->\n[\s\S]*?^[ \t]*<!-- END GENERATED module preloads -->/m,
            m => [PRELOADS_BEGIN, ...tags, PRELOADS_END].map(l => m[1] + l).join('\n'),
            page.file, 'GENERATED module preloads region');
        // A hint outside the markers is a hand-kept list again, checked by nothing.
        const all = (out.match(/rel="modulepreload"/g) || []).length;
        if (all !== tags.length) {
            throw new Error(`${page.file}: ${all - tags.length} <link rel="modulepreload"> outside its GENERATED region — `
                + 'delete it, or set `preloads` on the page in scripts/app-pages.mjs');
        }
        return /** @type {[string, string]} */ ([page.file, out]);
    });
}

/** @param {Reader} read @returns {Owned} */
function sdkVersion(read) {
    const { version } = firebaseSdk(read);
    const out = replaceOne(read('service-worker.js'), /^const FIREBASE_SDK_VERSION = '[^']*';[^\n]*$/m,
        () => `const FIREBASE_SDK_VERSION = '${version}'; // GENERATED from firebase-client.js by npm run generate:copies`,
        'service-worker.js', 'FIREBASE_SDK_VERSION declaration');
    return [['service-worker.js', out]];
}

// ── the list ────────────────────────────────────────────────────────────────────────────────────

/** Every generated fact: its name, and the function that writes it. */
export const COPIES = Object.freeze(/** @type {Array<[string, (read: Reader) => Owned]>} */ ([
    ['csp-meta', cspMeta],
    ['module-preloads', modulePreloads],
    ['sdk-version', sdkVersion],
]));

/**
 * Every file this script owns, ONCE, with the content it would write now. The copies run in order,
 * and each reads the files as the ones before it left them: a page carries both its CSP <meta> and
 * its preloads, and building each from the file on disk would let the second undo the first.
 * @param {Reader} read  the file at a repository-relative path, as it is now
 * @returns {Array<{ copy: string, file: string, content: string }>}  `copy` names every fact in the file
 */
export function buildCopies(read) {
    /** @type {Map<string, { copies: string[], content: string }>} */
    const out = new Map();
    const current = (/** @type {string} */ p) => out.get(p)?.content ?? read(p);
    for (const [copy, fn] of COPIES) {
        for (const [file, content] of fn(current)) {
            out.set(file, { copies: [...(out.get(file)?.copies ?? []), copy], content });
        }
    }
    return [...out].map(([file, { copies, content }]) => ({ copy: copies.join(' + '), file, content }));
}

/** The line where two texts first differ, for a failure message. @param {string} have @param {string} want */
export function firstDifference(have, want) {
    const a = have.split('\n'), b = want.split('\n');
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    // A generated line can be long (a whole CSP), so show it from just before the first differing column.
    const x = a[i] ?? '', y = b[i] ?? '';
    let c = 0;
    while (c < x.length && c < y.length && x[c] === y[c]) c++;
    const from = Math.max(0, c - 60);
    const clip = (/** @type {string|undefined} */ s) => (s === undefined ? '(end of file)'
        : (from ? '…' : '') + s.slice(from, from + 140) + (s.length > from + 140 ? '…' : ''));
    return `line ${i + 1}, column ${c + 1}\n    committed: ${clip(a[i])}\n    generated: ${clip(b[i])}`;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    const read = (/** @type {string} */ p) => readFileSync(join(ROOT, p), 'utf8');
    const written = [];
    for (const { copy, file, content } of buildCopies(read)) {
        if (read(file) === content) continue;
        writeFileSync(join(ROOT, file), content);
        written.push(`  ${file}  (${copy})`);
    }
    console.log(written.length ? `Written:\n${written.join('\n')}` : 'Every generated copy is already current.');
}
