#!/usr/bin/env node
// mutation-sweep.mjs — every WIRING mutation in the manifest, run through mutate.mjs, in one table.
//
// ── WHY THIS EXISTS ────────────────────────────────────────────────────────────────────────────
//
// CLAUDE.md names the risk "the rule tested, the wiring not": a helper can be perfect and the answer
// still wrong, because the production line that calls it passed the wrong argument, was never called,
// ran in the wrong access context, or had its result discarded. The estate tests rules thoroughly;
// what it cannot see by reading itself is whether a test would notice the CALL going wrong. A
// mutation can: break the line, run the narrowest test that should care, and see if it fails.
//
// Done once, by hand, that proves a guard on the day. Done weekly from a manifest, it keeps proving
// it: a refactor that moves the assertion off the entry point, a mock that starts discarding, a test
// narrowed to the helper again — each turns a KILLED mutant into a SURVIVOR, and the sweep goes red.
//
// ── WHAT IT REFUSES ────────────────────────────────────────────────────────────────────────────
//
// It is not a second mutation engine. Every edit goes through scripts/mutate.mjs, which already
// refuses the two ways a mutation lies (absent target, ambiguous target), runs the command on the
// UNCHANGED file first so a command that fails on its own is never read as teeth, and always puts
// the file back. This script adds only what a LIST needs:
//
//   · A STALE ENTRY FAILS, never skips. `--check` asks mutate.mjs whether each edit still applies,
//     before anything runs. A find string a refactor removed would otherwise be reported, at best, as
//     an error buried in a long log, and at worst dropped from the table — the manifest rotting in
//     silence is exactly the failure a sweep exists to prevent. `test/mutation-sweep-script.test.mjs`
//     runs that check on every branch, so a stale entry fails `npm test` on the commit that makes it.
//   · A SURVIVOR FAILS. The exit code is the sweep's verdict: 0 only when every mutant was killed.
//   · NO VERDICT IS A FAILURE TOO. A command that could not start, was killed, or failed on the
//     unchanged file says nothing about the guard, and is reported as an ERROR beside the survivors.
//
// It runs the entries ONE AT A TIME, never in parallel: a mutated file is read by every suite that
// imports it, so two entries at once would each be testing the other's mutant.
//
// ── USE ────────────────────────────────────────────────────────────────────────────────────────
//
//   npm run test:mutation                         # the whole manifest (weekly: mutation.yml)
//   node scripts/mutation-sweep.mjs --check-only  # does every entry still apply? (seconds, no tests)
//   node scripts/mutation-sweep.mjs --only pay-reminder-own-account,doc-door
//   node scripts/mutation-sweep.mjs --verbose     # each run's full output, as it happens
//   node scripts/mutation-sweep.mjs --manifest <file.mjs>   # another manifest (the script's own test)

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const MUTATE = fileURLToPath(new URL('./mutate.mjs', import.meta.url));

const argv = process.argv.slice(2);
const flag = (/** @type {string} */ name) => argv.includes(`--${name}`);
const value = (/** @type {string} */ name) => {
    const i = argv.indexOf(`--${name}`);
    return i === -1 ? null : argv[i + 1] ?? null;
};

const manifestPath = resolve(process.cwd(), value('manifest') ?? fileURLToPath(new URL('./mutation-manifest.mjs', import.meta.url)));
const only = value('only') ? new Set(String(value('only')).split(',').map(s => s.trim()).filter(Boolean)) : null;
const checkOnly = flag('check-only');
const verbose = flag('verbose');

/**
 * @typedef {{ id: string, file: string, in?: string, find: string, replace: string,
 *             test: string[], breaks: string }} Entry
 */

const { MUTATIONS } = /** @type {{ MUTATIONS: Entry[] }} */ (await import(pathToFileURL(manifestPath).href));
const problems = shapeProblems(MUTATIONS);
if (problems.length) {
    console.error(`\n✗ ${manifestPath} is malformed:\n  ${problems.join('\n  ')}\n`);
    process.exit(1);
}
if (only) {
    const unknown = [...only].filter(id => !MUTATIONS.some(m => m.id === id));
    if (unknown.length) {
        console.error(`\n✗ --only names no such entry: ${unknown.join(', ')}\n`);
        process.exit(1);
    }
}
const entries = MUTATIONS.filter(m => !only || only.has(m.id));

/**
 * Everything wrong with a manifest's SHAPE, before any file is touched. A misspelt key is not a
 * mutation that "did nothing": it is a manifest that cannot say what it means, and it fails here.
 * @param {unknown} list
 * @returns {string[]}
 */
function shapeProblems(list) {
    if (!Array.isArray(list) || list.length === 0) return ['MUTATIONS is not a non-empty array'];
    const out = [];
    const seen = new Set();
    const KEYS = new Set(['id', 'file', 'in', 'find', 'replace', 'test', 'breaks']);
    for (const [i, m] of list.entries()) {
        const at = `entry ${i}${m && typeof m.id === 'string' ? ` (${m.id})` : ''}`;
        if (!m || typeof m !== 'object') { out.push(`${at}: not an object`); continue; }
        for (const k of Object.keys(m)) if (!KEYS.has(k)) out.push(`${at}: unknown key "${k}"`);
        for (const k of ['id', 'file', 'find', 'breaks']) {
            if (typeof m[k] !== 'string' || !m[k].trim()) out.push(`${at}: "${k}" must be a non-empty string`);
        }
        if (typeof m.replace !== 'string') out.push(`${at}: "replace" must be a string ('' deletes)`);
        if ('in' in m && (typeof m.in !== 'string' || !m.in)) out.push(`${at}: "in", when given, must be a non-empty string`);
        if (!Array.isArray(m.test) || m.test.length === 0 || m.test.some(a => typeof a !== 'string')) {
            out.push(`${at}: "test" must be a non-empty array of strings (a command and its arguments)`);
        } else {
            for (const a of m.test) {
                if (/^test\/.+\.test\.mjs$/.test(a) && !existsSync(resolve(ROOT, a))) out.push(`${at}: test file ${a} does not exist`);
            }
        }
        if (typeof m.file === 'string' && !existsSync(resolve(ROOT, m.file))) out.push(`${at}: file ${m.file} does not exist`);
        if (typeof m.id === 'string') {
            if (seen.has(m.id)) out.push(`${at}: duplicate id`);
            seen.add(m.id);
        }
    }
    return out;
}

/**
 * Run mutate.mjs for one entry, from the repository root. Its output is kept, and shown on a failure
 * of any kind (or as it happens, under --verbose).
 * @param {Entry} m @param {boolean} check
 * @returns {Promise<{ status: number | null, out: string }>}
 */
function runMutate(m, check) {
    const args = [MUTATE, '--file', m.file, ...(m.in ? ['--in', m.in] : []),
        '--find', m.find, '--replace', m.replace, ...(check ? ['--check'] : []), '--', ...m.test];
    return new Promise((done) => {
        const child = spawn(process.execPath, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '';
        const keep = (/** @type {Buffer} */ b) => { out += b; if (verbose && !check) process.stdout.write(b); };
        child.stdout.on('data', keep);
        child.stderr.on('data', keep);
        child.on('error', (e) => done({ status: null, out: out + `\n${e.message}` }));
        child.on('close', (status) => done({ status, out }));
    });
}

// Signals reach the child too (same process group); mutate.mjs restores its file on each. This
// script only has to stop starting new entries and say so.
let stopping = false;
for (const sig of /** @type {const} */ (['SIGINT', 'SIGTERM', 'SIGHUP'])) {
    process.on(sig, () => { stopping = true; });
}

// ── 1 · DOES EVERY ENTRY STILL APPLY? ──────────────────────────────────────────────────────────
const stale = [];
for (const m of entries) {
    const r = await runMutate(m, true);
    if (r.status !== 0) stale.push({ m, out: r.out.trim() });
}
if (stale.length) {
    console.error(`\n✗ ${stale.length} STALE manifest entr${stale.length === 1 ? 'y' : 'ies'} — the line each one breaks is no longer there exactly once.`);
    console.error('  A stale entry is never skipped: fix its find/in to aim at the line as it now reads (or retire the');
    console.error('  entry in the same commit as the code it guarded), then re-run.\n');
    for (const { m, out } of stale) console.error(`  · ${m.id} (${m.file})\n${indent(out, 6)}\n`);
    process.exit(1);
}
console.log(`✓ all ${entries.length} manifest entr${entries.length === 1 ? 'y applies' : 'ies apply'}, each exactly once.`);
if (checkOnly) process.exit(0);

// ── 2 · RUN EACH MUTANT ────────────────────────────────────────────────────────────────────────
/** @type {{ m: Entry, verdict: 'killed' | 'SURVIVED' | 'ERROR', secs: string, out: string }[]} */
const results = [];
for (const [i, m] of entries.entries()) {
    if (stopping) break;
    const started = Date.now();
    process.stdout.write(`[${String(i + 1).padStart(2)}/${entries.length}] ${m.id} … `);
    const r = await runMutate(m, false);
    const verdict = r.status === 0 && /THE COMMAND FAILED/.test(r.out) ? 'killed'
        : r.status === 0 && /THE COMMAND PASSED/.test(r.out) ? 'SURVIVED'
        : 'ERROR';
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`${verdict} (${secs}s)`);
    results.push({ m, verdict, secs, out: r.out });
}

const width = Math.max(...results.map(r => r.m.id.length), 2);
console.log('\n' + 'verdict   '.padEnd(10) + 'id'.padEnd(width + 2) + 'what this mutant would break for a person');
console.log('─'.repeat(10 + width + 2 + 60));
for (const r of results) console.log(r.verdict.padEnd(10) + r.m.id.padEnd(width + 2) + r.m.breaks);

const survived = results.filter(r => r.verdict === 'SURVIVED');
const errored = results.filter(r => r.verdict === 'ERROR');
for (const r of [...survived, ...errored]) {
    console.error(`\n── ${r.verdict}: ${r.m.id} — ${r.m.file}\n   ${JSON.stringify(r.m.find)} → ${JSON.stringify(r.m.replace)}`
        + `\n   ${r.m.test.join(' ')}\n${indent(tail(r.out, 40), 3)}`);
}
const killed = results.length - survived.length - errored.length;
console.log(`\n${killed} killed · ${survived.length} survived · ${errored.length} gave no verdict`
    + (stopping ? ` · stopped early after ${results.length} of ${entries.length}` : '') + '\n');
if (survived.length) {
    console.error('A SURVIVOR is a wiring line no test would notice breaking. Before weakening anything, check the');
    console.error('mutation still hits the line it was written for; then give it a test through the ENTRY POINT.');
}
process.exit(survived.length || errored.length || stopping ? 1 : 0);

/** @param {string} s @param {number} n */
function indent(s, n) { return s.split('\n').map(l => ' '.repeat(n) + l).join('\n'); }
/** The last `n` lines of a run's output — where its verdict and any failing assertion are. */
function tail(/** @type {string} */ s, /** @type {number} */ n) { return s.trim().split('\n').slice(-n).join('\n'); }
