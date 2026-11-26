#!/usr/bin/env node
// @ts-check
/**
 * generate-file-index.mjs — `npm run generate:file-index` — keeps docs/FILE_INDEX.md's tree in step with the
 * modules on disk: a row for every module that has none, and no row for a module that has gone.
 *
 * ── WHAT IT WRITES, AND WHAT IT LEAVES ALONE ─────────────────────────────────────────────────────
 *
 * The index is a curated routing table: each row says what a file is AND where to look next (its tests,
 * its contract), in words somebody chose. Regenerating every row from the code would throw that away, so
 * this does the two mechanical jobs only (26 Nov 2026, the "hand-kept lists" review):
 *
 *   1. A module with no row of its own gets one, written from the opening line of its own header
 *      (`headerSummary`), placed after the row whose name it shares the longest prefix with — a new
 *      `paycalc-foo.js` lands among the `paycalc-` rows. Root modules go in the root of the tree,
 *      `functions/` modules in that folder.
 *   2. A row naming a root or `functions/` script that is no longer on disk is removed.
 *
 * Every other row — the pages, stylesheets, folders, tests and every existing module row — is left
 * byte-for-byte as written. A generated row is a starting point: improve its words by hand like any other,
 * and this will not touch it again.
 *
 * A module with no header to read is refused by name: the header is where a module's reasoning lives
 * (CLAUDE.md → "Current file structure"), so the fix is to write one, not to invent a row.
 *
 * ── RUNNING IT ──────────────────────────────────────────────────────────────────────────────────
 *
 *   npm run generate:file-index     writes the index if anything changed, and names each row
 *
 * `doc-parity.test.mjs` still requires every module to have its own row, and githooks/pre-commit names
 * this command when one is missing. Importing this module writes nothing; only running it as a script does.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const INDEX = 'docs/FILE_INDEX.md';

/** Root files that are deliberately not routed — the same set doc-parity.test.mjs exempts. */
export const NOT_ROUTED = new Set(['eslint.config.js', 'generate-sri.mjs', 'purify.es.mjs']);

/** Is this a root module the index must row? (Tests and runner configs are routed elsewhere.) @param {string} f */
export const isRootModule = (f) => /\.m?js$/.test(f) && !NOT_ROUTED.has(f) && !f.includes('.test.') && !f.startsWith('playwright.');
/** Is this a Functions module the index must row? @param {string} f */
export const isFunctionsModule = (f) => f.endsWith('.js') && !f.includes('.test.');

/** The longest a generated description runs before it is cut at a word. */
const MAX_SUMMARY = 220;

/**
 * The opening line of a module's own header, as a row's description: the first paragraph of its first
 * comment, without the `name.js — ` it usually starts with, to the end of its first sentence.
 * @param {string} src  the module's source
 * @param {string} file the module's name, for the refusal
 * @returns {string}
 */
export function headerSummary(src, file) {
    const lines = src.split('\n');
    let i = 0;
    while (i < lines.length && (/^\s*$/.test(lines[i]) || /^\s*\/\/\s*@ts-/.test(lines[i]) || /^\s*['"]use strict['"];?\s*$/.test(lines[i])
        || /^\s*\/[*/]\s*(?:eslint|global)\b.*?(?:\*\/)?\s*$/.test(lines[i]))) i++;   // a directive, not a description
    const text = [];
    if (/^\s*\/\*/.test(lines[i] ?? '')) {
        for (; i < lines.length; i++) {
            const t = lines[i].replace(/^\s*\/\*\*?/, '').replace(/\*\/.*$/, '').replace(/^\s*\*\s?/, '').trim();
            if (!t && text.length) break;
            if (t) text.push(t);
            if (/\*\//.test(lines[i])) break;
        }
    } else {
        for (; i < lines.length && /^\s*\/\//.test(lines[i]); i++) {
            const t = lines[i].replace(/^\s*\/\/\s?/, '').trim();
            if (!t && text.length) break;
            if (t) text.push(t);
        }
    }
    let s = text.join(' ').replace(/\s+/g, ' ').trim();
    if (!s) throw new Error(`${file} has no header comment to describe it — write one (what it is, what it owns), then run this again`);
    const dash = s.indexOf(' — ');
    if (dash >= 0 && dash < 80 && s.slice(0, dash).includes(file.replace(/^.*\//, '').replace(/\.m?js$/, ''))) s = s.slice(dash + 3);
    const stop = s.search(/(?<!\b(?:e\.g|i\.e|etc))\.\s/);   // "e.g. " and "i.e. " do not end a sentence
    if (stop > 8) s = s.slice(0, stop + 1);   // never at an "e.g." in the first few words
    if (s.length > MAX_SUMMARY) s = s.slice(0, s.lastIndexOf(' ', MAX_SUMMARY - 1)) + '…';
    return s;
}

/**
 * The first file a tree row names, every file it names before its `←` (`a.js / b.js` is one row for two),
 * and where the row sits. @param {string} line
 */
function rowOf(line) {
    const m = /^((?:[│ ] {3})*)([├└])── (\S+)/.exec(line);
    if (!m) return null;
    const head = line.slice(m[0].length - m[3].length).split(' ← ')[0];
    return { indent: m[1], branch: m[2], name: m[3], names: head.split(/\s*\/\s+|\s+\/\s*|\s+/).filter(Boolean) };
}

/** Shared leading characters of two names. @param {string} a @param {string} b */
const common = (a, b) => { let n = 0; while (n < a.length && n < b.length && a[n] === b[n]) n++; return n; };

/**
 * The index with a row added for every module that has none, and the rows of modules that have gone taken out.
 * @param {string} index  docs/FILE_INDEX.md as it is
 * @param {{ rootModules: string[], functionsModules: string[], read: (path: string) => string, exists: (path: string) => boolean }} disk
 * @returns {{ text: string, added: string[], removed: string[] }}
 */
export function planIndex(index, { rootModules, functionsModules, read, exists }) {
    const lines = index.split('\n');
    const open = lines.indexOf('```');
    const close = lines.indexOf('```', open + 1);
    if (open < 0 || close < 0) throw new Error(`${INDEX}: the file tree's \`\`\` block was not found`);
    const fnAt = lines.findIndex((l, k) => k > open && k < close && /^[├└]── functions\/\s*$/.test(l));
    if (fnAt < 0) throw new Error(`${INDEX}: the tree has no \`functions/\` folder row`);
    const fnEnd = (() => { let k = fnAt + 1; while (k < close && /^ {4}/.test(lines[k])) k++; return k; })();

    /** @type {Array<{ at: number, section: 'root'|'functions', name: string, names: string[], branch: string }>} */
    const rows = [];
    for (let k = open + 1; k < close; k++) {
        const r = rowOf(lines[k]);
        if (!r) continue;
        const row = { at: k, name: r.name, names: r.names, branch: r.branch };
        if (r.indent === '' && k !== fnAt) rows.push({ ...row, section: 'root' });
        else if (k > fnAt && k < fnEnd && r.indent === '    ') rows.push({ ...row, section: 'functions' });
    }
    const has = (/** @type {string} */ section, /** @type {string} */ name) => rows.some(r => r.section === section && r.names.includes(name));
    const isModuleName = (/** @type {string} */ n) => /^[\w.-]+\.m?js$/.test(n);

    // GONE means not on disk — never merely "not a module the index must row": a runner config or a
    // vendored file has a row too, and keeps it while it exists.
    const removed = rows.filter(r => isModuleName(r.name) && !exists(r.section === 'root' ? r.name : `functions/${r.name}`));
    /** @type {Map<number, string[]>} lines to insert AFTER a line index */
    const after = new Map();
    const added = [];
    for (const [section, names, indent] of /** @type {const} */ ([['root', rootModules, ''], ['functions', functionsModules, '    ']])) {
        // Only a MODULE row is a neighbour: after a folder row (`test/`, `docs/`) the new row would sit between
        // the folder and its children and read as one of them.
        const own = rows.filter(r => r.section === section && !removed.includes(r) && isModuleName(r.name));
        for (const name of names.filter(n => !has(section, n)).sort()) {
            const path = section === 'root' ? name : `functions/${name}`;
            const summary = headerSummary(read(path), path);
            const best = own.reduce((b, r) => (common(r.name, name) >= common(b.name, name) ? r : b), own[0]);
            // Never after a `└──`, which closes its branch: the new `├──` row goes just before it instead.
            const at = best ? (best.branch === '└' ? best.at - 1 : best.at) : (section === 'root' ? open : fnAt);
            after.set(at, [...(after.get(at) ?? []), `${indent}├── ${name} ← ${summary}`]);
            added.push(path);
        }
    }
    const gone = new Set(removed.map(r => r.at));
    // Taking out the row that closed a branch passes the `└──` to the nearest surviving row above it at the
    // same depth, so the tree still ends where it ends.
    for (const r of removed.filter(x => x.branch === '└')) {
        const depth = rowOf(lines[r.at])?.indent ?? '';
        for (let k = r.at - 1; k > open; k--) {
            const above = rowOf(lines[k]);
            if (!above || gone.has(k) || above.indent !== depth) continue;
            if (after.has(k)) break;   // a row is being added beneath it, and that row closes nothing
            lines[k] = lines[k].slice(0, depth.length) + '└' + lines[k].slice(depth.length + 1);
            break;
        }
    }
    const out = [];
    for (let k = 0; k < lines.length; k++) {
        if (!gone.has(k)) out.push(lines[k]);
        for (const row of after.get(k) ?? []) out.push(row);
    }
    return { text: out.join('\n'), added, removed: removed.map(r => (r.section === 'root' ? r.name : `functions/${r.name}`)) };
}

/**
 * The files git tracks in one folder, or every file there when git cannot say (a tree with no `.git`):
 * a scratch module nobody committed must not be given a row. @param {string} root @param {string} dir
 */
function filesIn(root, dir) {
    try {
        const out = execFileSync('git', ['ls-files', '--', dir ? `${dir}/` : '.'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
        return out.split('\n').filter(Boolean).map(p => (dir ? p.slice(dir.length + 1) : p)).filter(p => !p.includes('/'));
    } catch {
        return existsSync(join(root, dir)) ? readdirSync(join(root, dir)) : [];
    }
}

/** The repository as it is on disk. @param {string} root */
export function diskOf(root) {
    return {
        rootModules: filesIn(root, '').filter(isRootModule),
        functionsModules: filesIn(root, 'functions').filter(isFunctionsModule),
        read: (/** @type {string} */ p) => readFileSync(join(root, p), 'utf8'),
        exists: (/** @type {string} */ p) => existsSync(join(root, p)),
    };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    const current = readFileSync(join(ROOT, INDEX), 'utf8');
    const { text, added, removed } = planIndex(current, diskOf(ROOT));
    if (text === current) {
        console.log(`${INDEX} already has a row for every module, and none for a module that has gone.`);
    } else {
        writeFileSync(join(ROOT, INDEX), text);
        for (const a of added) console.log(`  + ${a}  (from its header — improve the words by hand if they need it)`);
        for (const r of removed) console.log(`  − ${r}  (no longer on disk)`);
    }
}
