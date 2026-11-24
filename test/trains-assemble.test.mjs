// @ts-check
/**
 * trains-assemble.test.mjs — the Trains page's timetable builder joins a train continued on another page only to
 * the ONE continuation that carries it, and stops the build for anything less certain (external review of v26.67).
 * Run: node scripts/run-tests.mjs test/trains-assemble.test.mjs   (part of `npm run test:hygiene`)
 *
 * `assemble.py` took the FIRST later 'f' column with the same time at the same station, so two trains could both be
 * given one continuation's destination; and a train with none was published shortened after a WARN nobody had to
 * read. Each case here runs the real script, under `python3 -I`, on a tiny synthetic book — never the real ones,
 * which are not committed (docs/timetable-dec26/tooling/README.md). Skipped, by name, where python3 is not installed.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../docs/timetable-dec26/tooling/assemble.py', import.meta.url));
const python = spawnSync('python3', ['--version']);
const noPython = python.error ? 'python3 is not installed here' : false;

/** One printed cell. @param {string} crs @param {string} text */
const cell = (crs, text) => ({ crs, name: crs, ad: '', text });
/** A column of the Met book, outward on weekdays. @param {number} page @param {number} col @param {any[]} cells */
const column = (page, col, cells) => ({ page, col, dir: 'out', day: 'SX', op: 'CH', fac: [], notes: [], rows: ['MYB', 'HDM', 'AYS'], cells });
/** A train leaving Marylebone at `t`, reaching Haddenham at `at` and continued overleaf ('e'). */
const continued = (/** @type {number} */ col, /** @type {string} */ t, /** @type {string} */ at) => column(1, col, [cell('MYB', t), cell('HDM', at), cell('', 'e')]);
/** Its continuation overleaf ('f'), from Haddenham at `at` to Aylesbury at `end`. */
const overleaf = (/** @type {number} */ col, /** @type {string} */ at, /** @type {string} */ end) => column(2, col, [cell('', 'f'), cell('HDM', at), cell('AYS', end)]);

/** Run the builder on a Met book of these columns (the main-line book empty). @param {any[]} met */
function assemble(met) {
    const dir = mkdtempSync(join(tmpdir(), 'assemble-'));
    try {
        writeFileSync(join(dir, 'met.json'), JSON.stringify(met));
        writeFileSync(join(dir, 'main.json'), '[]');
        const r = spawnSync('python3', ['-I', SCRIPT, join(dir, 'met.json'), join(dir, 'main.json'), join(dir, 'out.json')], { encoding: 'utf8' });
        const out = r.status === 0 ? JSON.parse(readFileSync(join(dir, 'out.json'), 'utf8')) : null;
        return { status: r.status, stderr: r.stderr, out };
    } finally { rmSync(dir, { recursive: true, force: true }); }
}

describe('assemble.py joins a continued train to exactly one continuation', { skip: noPython }, () => {
    test('the control: one train, one continuation — joined, to its real destination', () => {
        const r = assemble([continued(1, '0700', '0745'), overleaf(1, '0745', '0800')]);
        assert.equal(r.status, 0, r.stderr);
        const [train] = r.out.trains;
        assert.equal(train.dest, 'AYS', 'the train was not joined to its continuation');
        assert.deepEqual(train.calls, ['HDM', 'AYS']);
    });

    test('two trains that match ONE continuation stop the build, naming the columns — neither is given its destination', () => {
        const r = assemble([continued(1, '0700', '0745'), continued(2, '0710', '0745'), overleaf(1, '0745', '0800')]);
        assert.notEqual(r.status, 0, 'both trains were given one continuation\'s destination');
        assert.match(r.stderr, /already joined to another train — met book, page 1, column 2/);
    });

    test('two continuations that match ONE train stop the build too', () => {
        const r = assemble([continued(1, '0700', '0745'), overleaf(1, '0745', '0800'), overleaf(2, '0745', '0805')]);
        assert.notEqual(r.status, 0);
        assert.match(r.stderr, /2 continuations carry its HDM 0745 \(page\/column 2\/1, 2\/2\) — met book, page 1, column 1/);
    });

    test('a train with NO continuation stops the build — never published shortened', () => {
        const r = assemble([continued(1, '0700', '0745')]);
        assert.notEqual(r.status, 0, 'a train ending at Haddenham was published when the book continues it');
        assert.match(r.stderr, /no continuation carries its HDM 0745 — met book, page 1, column 1/);
    });

    test('a continuation no train reaches stops the build — its stops would be lost', () => {
        const r = assemble([continued(1, '0700', '0745'), overleaf(1, '0745', '0800'), overleaf(2, '0915', '0930')]);
        assert.notEqual(r.status, 0);
        assert.match(r.stderr, /a continuation no train on an earlier page reaches — met book, page 2, column 2/);
    });
});
