// @ts-check
// @lane hygiene
/**
 * trains-assemble.test.mjs — the Trains page's timetable builder joins a train continued on another page only to
 * the ONE continuation that carries it, and stops the build for anything less certain (external review of v26.67).
 * Run: node scripts/run-tests.mjs test/trains-assemble.test.mjs   (part of `npm run test:hygiene`)
 *
 * `assemble.py` took the FIRST later 'f' column with the same time at the same station, so two trains could both be
 * given one continuation's destination; and a train with none was published shortened after a WARN nobody had to
 * read; and one printing only the joining station published the train as ending there (review of v26.69). Since the
 * review of v26.79 it also keeps one copy of a train printed twice only when the copies agree, and refuses a cell that
 * is not a time. Each case here runs the real script, under `python3 -I`, on a tiny synthetic book — never the real
 * ones, which are not committed (docs/timetable-dec26/tooling/README.md). Skipped, by name, where python3 is not installed.
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

/** Run the builder on a Met book of these columns (the main-line book empty unless given). @param {any[]} met @param {any[]} [main] */
function assemble(met, main = []) {
    const dir = mkdtempSync(join(tmpdir(), 'assemble-'));
    try {
        writeFileSync(join(dir, 'met.json'), JSON.stringify(met));
        writeFileSync(join(dir, 'main.json'), JSON.stringify(main));
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

    test('a continuation that adds no station stops the build — never published as ending where it joins', () => {
        // Only the joining station, or that station twice (its arrival and departure): either way the book continues
        // the train and the page would have it terminate at Haddenham (external review of v26.69).
        for (const cells of [[cell('', 'f'), cell('HDM', '0745')], [cell('', 'f'), cell('HDM', '0745'), cell('HDM', '0747')]]) {
            const r = assemble([continued(1, '0700', '0745'), column(2, 1, cells)]);
            assert.notEqual(r.status, 0, 'a continued train was published as terminating where it joins its continuation');
            assert.match(r.stderr, /its continuation \(page\/column 2\/1\) adds no station after HDM 0745 — met book, page 1, column 1/);
        }
    });

    test('a continuation that is continued AGAIN names the train, not its third column as an orphan', () => {
        // Over three pages: page 1 → page 2 (itself continued, 'e') → page 3. Only one break is joined (review of v26.69).
        const middle = column(2, 1, [cell('', 'f'), cell('HDM', '0745'), cell('AYS', '0800'), cell('', 'e')]);
        const last = column(3, 1, [cell('', 'f'), cell('AYS', '0800'), cell('HDM', '0815')]);
        const r = assemble([continued(1, '0700', '0745'), middle, last]);
        assert.notEqual(r.status, 0);
        assert.match(r.stderr, /its continuation \(page\/column 2\/1\) is continued again — a train over three pages, which assemble\.py does not join — met book, page 1, column 1/);
    });

    test('a continuation no train reaches stops the build — its stops would be lost', () => {
        const r = assemble([continued(1, '0700', '0745'), overleaf(1, '0745', '0800'), overleaf(2, '0915', '0930')]);
        assert.notEqual(r.status, 0);
        assert.match(r.stderr, /a continuation no train on an earlier page reaches — met book, page 2, column 2/);
    });
});

// ── A SECOND COLUMN AT THE SAME TIME TO THE SAME END (external review of v26.79) ──────────────────────
// The duplicate check keyed on time, day and end, never the stops, and matched within one book as well as
// across the two: a second 08:00 to Aylesbury by another route was dropped, and the build ended cleanly.
describe('assemble.py keeps one copy of a train only when the copies agree', { skip: noPython }, () => {
    const viaHdm = (/** @type {number} */ col) => column(1, col, [cell('MYB', '0800'), cell('HDM', '0845'), cell('AYS', '0900')]);
    test('two columns in one book at one time to one end, stopping differently, stop the build naming both', () => {
        const viaHwy = column(1, 2, [cell('MYB', '0800'), cell('HWY', '0840'), cell('AYS', '0910')]);
        const r = assemble([viaHdm(1), viaHwy]);
        assert.notEqual(r.status, 0, 'one of two different trains was dropped');
        assert.match(r.stderr, /two trains at 0800 to the same end stop differently — met book, page 1, column 1, and met book, page 1, column 2/);
    });

    test('across the books, a train printed in both is one row, the main-line copy, when their times agree', () => {
        // The main-line book prints its own stations too; only the ones both print are compared.
        const main = column(1, 1, [cell('MYB', '0800'), cell('HWY', '0830'), cell('HDM', '0845'), cell('AYS', '0900')]);
        const r = assemble([viaHdm(1)], [main]);
        assert.equal(r.status, 0, r.stderr);
        assert.equal(r.out.trains.length, 1);
        assert.equal(r.out.trains[0].src, 'main');
        assert.equal(r.out.trains[0].at, undefined, 'where a row came from is the build\'s, not the page\'s');
    });

    test('across the books, a call only the Met book prints is kept — the row is the union, in time order', () => {
        // External review of v26.87: the main-line copy alone was kept, so High Wycombe was dropped and the build ended cleanly.
        const met = column(1, 1, [cell('MYB', '0800'), cell('HWY', '0830'), cell('AYS', '0900')]);
        const main = column(1, 1, [cell('MYB', '0800'), cell('AYS', '0900')]);
        const r = assemble([met], [main]);
        assert.equal(r.status, 0, r.stderr);
        assert.equal(r.out.trains.length, 1);
        assert.deepEqual(r.out.trains[0].calls, ['HWY', 'AYS'], 'a call printed in one book was lost');
        assert.deepEqual(r.out.trains[0].stops, [['HWY', '0830'], ['AYS', '0900']]);
        assert.equal(r.out.trains[0].src, 'main');
    });

    // TWO ROUTES ARE NOT TWO PRINTINGS (external review of v26.92). Side by side on purpose: a test that only asks
    // for extra calls to survive rewards merging too much. Both copies leave at 08:00 and reach Aylesbury at 09:00.
    test('the SAME route, one book leaving out a call: one train, every call kept', () => {
        const met = column(1, 1, [cell('MYB', '0800'), cell('HWY', '0830'), cell('AYS', '0900')]);
        const main = column(1, 1, [cell('MYB', '0800'), cell('GER', '0820'), cell('HWY', '0830'), cell('AYS', '0900')]);
        const r = assemble([met], [main]);
        assert.equal(r.status, 0, r.stderr);
        assert.deepEqual(r.out.trains[0].calls, ['GER', 'HWY', 'AYS']);
    });

    test('via Amersham in one book and via High Wycombe in the other: two trains — the build stops, naming both', () => {
        const met = column(1, 1, [cell('MYB', '0800'), cell('AMR', '0835'), cell('AYS', '0900')]);
        const main = column(1, 1, [cell('MYB', '0800'), cell('HWY', '0830'), cell('AYS', '0900')]);
        const r = assemble([met], [main]);
        assert.notEqual(r.status, 0, 'one train was published calling at High Wycombe and then Amersham');
        assert.match(r.stderr, /go by different routes \(via Amersham and via High Wycombe\) — met book, page 1, column 1, and main book, page 1, column 1/);
    });

    test('and coming in to London, the union keeps travel order', () => {
        const met = { ...column(1, 1, [cell('AYS', '0700'), cell('HWY', '0730'), cell('MYB', '0800')]), dir: 'ret', rows: ['AYS', 'HWY', 'MYB'] };
        const main = { ...column(1, 1, [cell('AYS', '0700'), cell('HDM', '0715'), cell('MYB', '0800')]), dir: 'ret', rows: ['AYS', 'HDM', 'MYB'] };
        const r = assemble([met], [main]);
        assert.equal(r.status, 0, r.stderr);
        assert.deepEqual(r.out.trains[0].calls, ['AYS', 'HDM', 'HWY']);
    });

    test('two calls at one minute, one from each book, stop the build — the times cannot settle their order', () => {
        const met = column(1, 1, [cell('MYB', '0800'), cell('HWY', '0830'), cell('AYS', '0900')]);
        const main = column(1, 1, [cell('MYB', '0800'), cell('HDM', '0830'), cell('AYS', '0900')]);
        const r = assemble([met], [main]);
        assert.notEqual(r.status, 0, 'two stations at one minute were put in an order nobody printed');
        assert.match(r.stderr, /cannot be put in one order of calls — met book, page 1, column 1, and main book, page 1, column 1/);
    });

    test('a call one book bars a passenger from, and the other prints plain, stops the build — only the book can say', () => {
        // The Met book prints High Wycombe as pick-up only ('u'): nobody from London may get off there. The union must
        // not add it back from the main-line book's plain time.
        const met = column(1, 1, [cell('MYB', '0800'), cell('HWY', '0830u'), cell('AYS', '0900')]);
        const main = column(1, 1, [cell('MYB', '0800'), cell('HWY', '0830'), cell('AYS', '0900')]);
        const r = assemble([met], [main]);
        assert.notEqual(r.status, 0, 'a barred call came back as one a passenger can use');
        assert.match(r.stderr, /cannot be put in one order of calls — met book, page 1, column 1, and main book, page 1, column 1/);
    });

    test('a barred call both books agree on stays out, and the build goes on', () => {
        const met = column(1, 1, [cell('MYB', '0800'), cell('HWY', '0830u'), cell('AYS', '0900')]);
        const main = column(1, 1, [cell('MYB', '0800'), cell('AYS', '0900')]);
        const r = assemble([met], [main]);
        assert.equal(r.status, 0, r.stderr);
        assert.deepEqual(r.out.trains[0].calls, ['AYS']);
        assert.equal(r.out.trains[0].barred, undefined, 'the build\'s own bookkeeping stays out of the page\'s data');
    });

    test('a train printed twice in the main-line book, after its union with the Met copy, is still one train', () => {
        // The second printing is judged against the first as printed, not against the union, which holds a Met call.
        const met = column(1, 1, [cell('MYB', '0800'), cell('HWY', '0830'), cell('AYS', '0900')]);
        const main = (/** @type {number} */ col) => column(1, col, [cell('MYB', '0800'), cell('AYS', '0900')]);
        const r = assemble([met], [main(1), main(2)]);
        assert.equal(r.status, 0, r.stderr);
        assert.equal(r.out.trains.length, 1);
        assert.deepEqual(r.out.trains[0].calls, ['HWY', 'AYS']);
    });

    test('across the books, copies whose times disagree stop the build', () => {
        const main = column(1, 1, [cell('MYB', '0800'), cell('HDM', '0845'), cell('AYS', '0910')]);
        const r = assemble([viaHdm(1)], [main]);
        assert.notEqual(r.status, 0);
        assert.match(r.stderr, /met book, page 1, column 1, and main book, page 1, column 1/);
    });
});

// ── EVERY PRINTED TIME IS A TIME (external review of v26.79) ──────────────────────────────────────────
describe('assemble.py refuses a cell that is not a time, by book, page and column', { skip: noPython }, () => {
    test('four digits that are no time stop the build — 0861 is not a departure', () => {
        const r = assemble([column(1, 3, [cell('MYB', '0861'), cell('AYS', '0930')])]);
        assert.notEqual(r.status, 0);
        assert.match(r.stderr, /'0861' at MYB is not a time — met book, page 1, column 3/);
    });

    test('a letter outside the key stops the build at the Marylebone end too — 0800z is not 0800', () => {
        const r = assemble([column(1, 3, [cell('MYB', '0800z'), cell('AYS', '0900')])]);
        assert.notEqual(r.status, 0);
        assert.match(r.stderr, /unknown time letter '0800z' at MYB.* — met book, page 1, column 3/);
    });

    test('and on a continuation, the continuation is named', () => {
        const r = assemble([continued(1, '0700', '0745'), overleaf(1, '0745', '2400')]);
        assert.notEqual(r.status, 0);
        assert.match(r.stderr, /'2400' at AYS is not a time — met book, page 2, column 1/);
    });
});
