// @ts-check
// @lane hygiene
/**
 * file-index-generator.test.mjs — `npm run generate:file-index` adds a row for a module that has none and
 * removes the row of a script that has gone, and touches nothing else. Run:
 * node scripts/run-tests.mjs test/file-index-generator.test.mjs   (part of `npm run test:hygiene`)
 *
 * The index is a curated routing table, so what this guards is mostly what the generator must NOT do: rewrite
 * a chosen row, drop a row for a file that exists but is not a module (a runner config — its first version
 * did exactly that), or invent a row for a module with no header to read.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { planIndex, headerSummary, diskOf, INDEX } from '../scripts/generate-file-index.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

/** A small index in the real one's shape. */
const INDEX_TEXT = [
    '# File index', '', '```', 'roster-app/',
    '├── index.html              ← main PWA app',
    '├── paycalc-app.js         ← the Pay page coordinator, in words somebody chose',
    '├── paycalc-calc.js        ← the pay maths',
    '├── gone.js                ← a module that was deleted',
    '├── playwright.config.mjs  ← a runner config: on disk, not a module',
    '├── test/',
    '│   ├── gone.test.mjs ← a test row: never this generator\'s business',
    '└── functions/',
    '    ├── index.js       ← the composition root',
    '    ├── old.js         ← a Functions module that was deleted',
    '    └── package.json',
    '```', '',
].join('\n');

const HEADERS = {
    'paycalc-new.js': '// @ts-check\n/**\n * paycalc-new.js — the new pay helper. It does one more thing.\n *\n * Detail nobody needs in a row.\n */\n',
    'functions/fresh.js': "'use strict';\n\n/**\n * functions/fresh.js — a new server module.\n */\n",
};
const ON_DISK = new Set(['index.html', 'paycalc-app.js', 'paycalc-calc.js', 'paycalc-new.js', 'playwright.config.mjs',
    'functions/index.js', 'functions/fresh.js']);

const disk = {
    rootModules: ['paycalc-app.js', 'paycalc-calc.js', 'paycalc-new.js'],
    functionsModules: ['index.js', 'fresh.js'],
    read: (/** @type {string} */ p) => { if (!(p in HEADERS)) throw new Error(`unexpected read of ${p}`); return HEADERS[/** @type {keyof typeof HEADERS} */ (p)]; },
    exists: (/** @type {string} */ p) => ON_DISK.has(p),
};

test('the real index needs nothing — every module has its row, and no row names a script that has gone', () => {
    const current = readFileSync(new URL(`../${INDEX}`, import.meta.url), 'utf8');
    const { added, removed } = planIndex(current, diskOf(ROOT));
    assert.deepEqual({ added, removed }, { added: [], removed: [] }, 'run `npm run generate:file-index`');
});

test('a module with no row gets one, from its header, among the rows it shares a prefix with', () => {
    const { text, added } = planIndex(INDEX_TEXT, disk);
    assert.deepEqual(added, ['paycalc-new.js', 'functions/fresh.js']);
    const lines = text.split('\n');
    const at = lines.indexOf('├── paycalc-new.js ← the new pay helper.');
    assert.ok(at > 0, `the row is not there, or not in the header's words:\n${text}`);
    assert.match(lines[at - 1], /paycalc-calc\.js/, 'placed after the closest-named row');
    assert.ok(lines.includes('    ├── fresh.js ← a new server module.'), 'a Functions module goes in the functions/ folder, indented');
});

test('a row for a script that has gone is removed — and nothing else is', () => {
    const { text, removed } = planIndex(INDEX_TEXT, disk);
    assert.deepEqual(removed, ['gone.js', 'functions/old.js']);
    for (const kept of ['paycalc-app.js         ← the Pay page coordinator, in words somebody chose', 'playwright.config.mjs',
        'gone.test.mjs', 'index.html', '└── package.json']) {
        assert.ok(text.includes(kept), `"${kept}" was changed or dropped`);
    }
    assert.ok(!text.includes('├── gone.js'), 'the deleted module keeps its row');
});

test('running it twice changes nothing the second time', () => {
    const once = planIndex(INDEX_TEXT, disk).text;
    const twice = planIndex(once, disk);
    assert.equal(twice.text, once);
    assert.deepEqual([twice.added, twice.removed], [[], []]);
});

test('a module with no header is refused by name — never given an invented row', () => {
    assert.throws(() => headerSummary('import x from "./y.js";\n', 'bare.js'), /bare\.js has no header comment/);
});

test('the summary is the header\'s first sentence, without the "name — " it starts with, and capped', () => {
    assert.equal(headerSummary(HEADERS['paycalc-new.js'], 'paycalc-new.js'), 'the new pay helper.');
    assert.equal(headerSummary('// Safe wrappers — they never throw.\nlet x;\n', 'ls.js'), 'Safe wrappers — they never throw.',
        'a dash that does not follow the file name stays');
    const long = `/** long.js — ${'word '.repeat(80)}*/`;
    assert.ok(headerSummary(long, 'long.js').length <= 221 && headerSummary(long, 'long.js').endsWith('…'));
});

// ── The placements the first version got wrong (26 Nov 2026 review) ─────────────────────────────

const FOLDERED = [
    '# File index', '', '```', 'roster-app/',
    '├── deploy.js           ← a module',
    '├── experiments/',
    '│   ├── probe.html ← an experiment',
    '├── tide.js             ← another module',
    '├── test/',
    '│   ├── tide.test.mjs ← a test',
    '├── one-a.js / one-b.js ← two modules on one row',
    '└── functions/',
    '    ├── index.js       ← the composition root',
    '    └── last.js        ← the row that closes the folder',
    '```', '',
].join('\n');
const FOLDERED_HEADERS = {
    'export-csv.js': '/** export-csv.js — writes a CSV. */\n',
    'tz.js': '/** tz.js — the time zone helper. */\n',
    'functions/later.js': '/** functions/later.js — runs later. */\n',
};
/** @param {string[]} root @param {string[]} fns @param {Set<string>} [onDisk] */
const folderedDisk = (root, fns, onDisk) => ({
    rootModules: root, functionsModules: fns,
    read: (/** @type {string} */ p) => FOLDERED_HEADERS[/** @type {keyof typeof FOLDERED_HEADERS} */ (p)] ?? (() => { throw new Error(`unexpected read of ${p}`); })(),
    exists: (/** @type {string} */ p) => (onDisk ?? new Set(['deploy.js', 'tide.js', 'one-a.js', 'one-b.js', 'functions/index.js', 'functions/last.js'])).has(p),
});

test('a new row never lands between a folder and its children, nor after a closing └──', () => {
    const { text } = planIndex(FOLDERED, folderedDisk(['deploy.js', 'tide.js', 'one-a.js', 'one-b.js', 'export-csv.js', 'tz.js'], ['index.js', 'last.js', 'later.js']));
    const lines = text.split('\n');
    const at = (/** @type {string} */ s) => lines.findIndex(l => l.includes(s));
    // Each new root row follows a MODULE row — never a folder or one of its children.
    for (const name of ['export-csv.js', 'tz.js']) {
        const before = lines[at(`├── ${name}`) - 1];
        assert.match(before, /^├── [\w.-]+\.m?js\b/, `${name} landed under a folder: after "${before}"`);
    }
    assert.ok(at('tz.js ←') < at('├── test/'), 'tz.js went inside test/');
    assert.ok(at('later.js') < at('└── last.js'), 'a functions/ row went after the └── that closes the folder');
    assert.match(lines[at('later.js')], /^ {4}├── later\.js/);
});

test('a module named second on a shared row has a row — it is never given a duplicate', () => {
    const { added } = planIndex(FOLDERED, folderedDisk(['deploy.js', 'tide.js', 'one-a.js', 'one-b.js'], ['index.js', 'last.js']));
    assert.deepEqual(added, []);
});

test('removing the row that closed a branch passes the └── to the row above it', () => {
    const onDisk = new Set(['deploy.js', 'tide.js', 'one-a.js', 'one-b.js', 'functions/index.js']);
    const { text, removed } = planIndex(FOLDERED, folderedDisk(['deploy.js', 'tide.js', 'one-a.js', 'one-b.js'], ['index.js'], onDisk));
    assert.deepEqual(removed, ['functions/last.js']);
    assert.ok(text.includes('    └── index.js       ← the composition root'), 'the folder no longer ends in └──');
});

test('the summary does not stop at "e.g." and skips a directive comment', () => {
    assert.equal(headerSummary('/** x.js — reads a list, e.g. the roster, and sorts it. More. */\n', 'x.js'),
        'reads a list, e.g. the roster, and sorts it.');
    assert.equal(headerSummary('/* eslint-disable no-console */\n/** y.js — prints a report. */\n', 'y.js'), 'prints a report.');
});
