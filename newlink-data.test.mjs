// @ts-check
/**
 * newlink-data.test.mjs — the new link page says what the pack says.
 * Run: node --test newlink-data.test.mjs   (part of `npm run test:hygiene`)
 *
 * `newlink-data.js` is GENERATED from the pack's own figures (docs/links-26/tooling/newlink-data.mjs, reading
 * what-it-means-data.mjs — the same module the one-page sheet prints from). The danger with a generated copy is the one
 * every copy has: the source moves and the copy does not. A rota re-searched, a figure re-counted, a sentence corrected
 * in the tooling — and staff read the old one in the app while the PDF in their hand says the new one.
 *
 * So the first test runs the generator in `--check` mode, which recomputes everything — every figure, every asserted
 * sentence — and fails unless the committed file is byte-for-byte what it would write now. It takes ~10s, because it is
 * the whole computation; that is the price of a check that cannot be fooled by a figure that merely LOOKS plausible.
 * The rest pin the shape the page relies on.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { COLUMNS, CHANGES, GAINS, COSTS, PERSONAS, NOTES, PACK } from './newlink-data.js';
import { PROPOSALS } from './links-proposals.js';

// fileURLToPath, never `.pathname`: a checkout whose path holds a space reads as %20 and the generator is not found
const here = (/** @type {string} */ f) => fileURLToPath(new URL(f, import.meta.url));

// The generator reads the colleague decks' pay figures back with `unzip` (what-it-means-data.mjs), as the one-page sheet
// does. Every CI runner has it; a machine without it SKIPS the comparison and says why, rather than failing on a missing
// tool or passing as though the comparison had run (the payslip lane's rule: absent is a skip, broken is a failure).
const NO_UNZIP = spawnSync('unzip', ['-v'], { stdio: 'ignore' }).error
    ? 'unzip is not installed — the generator reads the colleague decks back with it, so the comparison cannot run here (CI runs it)'
    : false;

test('newlink-data.js is exactly what the generator writes from the pack today', { skip: NO_UNZIP }, () => {
    try {
        execFileSync(process.execPath, [here('./docs/links-26/tooling/newlink-data.mjs'), '--check'], { encoding: 'utf8', stdio: 'pipe' });
    } catch (e) {
        const err = /** @type {{ stderr?: string, stdout?: string, message: string }} */ (e);
        assert.fail(`${(err.stderr || err.stdout || err.message).trim()}\n(A claim that no longer holds stops the generator too — its message names the sentence.)`);
    }
});

test('its columns are today and the built-in proposals, in the same order — A to Z', () => {
    const names = PROPOSALS.map(p => p.name.replace(/ — Dec 2026$/, ''));
    assert.deepEqual([...COLUMNS], ['Today', ...names]);
    assert.deepEqual(names, [...names].sort(), 'the page presents the three evenly, which means alphabetically');
});

test('six ways of working, each a sentence and rows of four figures, and only a proposal is ever marked best', () => {
    assert.equal(PERSONAS.length, 6);
    assert.equal(new Set(PERSONAS.map(p => p.id)).size, 6, 'persona ids are unique (they become element ids)');
    for (const p of PERSONAS) {
        assert.match(p.who, /^…/, `${p.id}: "who" finishes the sentence "What it means if you…"`);
        assert.ok(p.gist.length > 20 && p.icon && p.chip, `${p.id}: a sentence, an emoji and a label`);
        assert.ok(p.rows.length >= 2, `${p.id}: has figures`);
        for (const r of p.rows) {
            assert.equal(r.cells.length, COLUMNS.length, `${p.id} / ${r.label}: one figure per column`);
            assert.equal(r.cells[0].best, false, `${p.id} / ${r.label}: today is for scale and never ranked`);
            assert.ok(r.cells.every(c => c.text.trim()), `${p.id} / ${r.label}: no empty figure`);
        }
    }
    // the swap rows are left unranked on purpose (the sheet's deep review, 1 Nov 2026) — and the notes say so
    const swap = PERSONAS.find(p => p.id === 'swap');
    assert.ok(swap && swap.rows.every(r => r.cells.every(c => !c.best)), 'no swap row is marked');
    assert.ok(NOTES.some(n => /swap rows are not marked/.test(n)));
    // EVENLY: the green lands on each of the three somewhere, not on one of them everywhere
    for (let i = 1; i < COLUMNS.length; i++) {
        assert.ok(PERSONAS.some(p => p.rows.some(r => r.cells[i].best)), `${COLUMNS[i]} is the best of the three for somebody`);
    }
});

test('what all three share comes as gains AND costs, never one without the other', () => {
    assert.ok(GAINS.length >= 3 && COSTS.length >= 3);
    assert.ok(CHANGES.length >= 3, 'the drafted "what has changed" lines');
});

test('nothing in it names a recommendation (owner, 2 Nov 2026: "No, three evenly")', () => {
    const all = JSON.stringify({ COLUMNS, CHANGES, GAINS, COSTS, PERSONAS, NOTES, PACK });
    assert.doesNotMatch(all, /recommend/i);
});

test('every pack file is a PDF the repository holds, under docs/links-26', () => {
    assert.ok(PACK.length >= 4);
    for (const f of PACK) {
        assert.match(f.path, /^[\w-]+(\/[\w-]+)?\.pdf$/, `${f.path}: a relative path, no climbing out of docs/links-26`);
        assert.ok(existsSync(here(`./docs/links-26/${f.path}`)), `${f.path} is not in docs/links-26`);
        assert.ok(f.pages > 0, `${f.path}: its pages are counted`);
    }
    // what a colleague is handed and nothing more: no shortlist sheet (it recommends), no managers' deck
    assert.ok(PACK.every(f => !/shortlist|for-managers|what-it-means/.test(f.path)), 'the pack the page offers is the colleague pack');
});
