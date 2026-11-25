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
import { servedFiles } from './app-pages.mjs';

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

// ── the list ────────────────────────────────────────────────────────────────────────────────────

/** Every generated fact: its name, and the function that writes it. */
export const COPIES = Object.freeze(/** @type {Array<[string, (read: Reader) => Owned]>} */ ([
    ['csp-meta', cspMeta],
]));

/**
 * Every file this script owns, with the content it would write now.
 * @param {Reader} read  the file at a repository-relative path, as it is now
 * @returns {Array<{ copy: string, file: string, content: string }>}
 */
export function buildCopies(read) {
    return COPIES.flatMap(([copy, fn]) => fn(read).map(([file, content]) => ({ copy, file, content })));
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
