// @ts-check
/**
 * test-lanes.mjs — which LANE each Node test file runs in, read from the file itself.
 *
 * ── WHY ────────────────────────────────────────────────────────────────────────────────────────
 * Each lane (`npm run test:hygiene`, `test:unit`, …) was a hand-typed list of file names inside one
 * line of package.json, three thousand characters long. Every branch that added a test edited that
 * line, so every merge of two such branches conflicted there (25 Nov 2026: three merges, three
 * conflicts). A fact about a file belongs in that file — the same rule `@nodeps-safe` already follows
 * (scripts/test-nodeps.mjs) — so each test now names its own lane in one line near its top:
 *
 *     // @lane unit
 *     // @lane unit payslip-local        (a file may run in more than one)
 *
 * and package.json names only the lane: `node … scripts/run-tests.mjs --lane unit`. Adding a test is
 * writing that one line in the new file; no shared list is touched.
 *
 * ── THE LANES ──────────────────────────────────────────────────────────────────────────────────
 * The lane decides the node flags and what must be installed, so it is a choice, not a guess: a file
 * that mocks a module needs `unit` (`--experimental-test-module-mocks`), but so do some that do not.
 * A tag naming no lane below, or a test file with none, fails doc-parity.test.mjs, which is what makes
 * "every test runs somewhere" true without a list to keep.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Every lane, and the npm script that runs it. */
export const LANES = Object.freeze({
    hygiene: 'test:hygiene',
    unit: 'test:unit',
    parse: 'test:parse',
    'payslip-local': 'test:payslip-local',
    functions: 'test:functions',
    rules: 'test:rules',
});

/** The lanes a test file's source declares: its first `// @lane …` line, within its first 15 lines.
 *  @param {string} src @returns {string[]} */
export function laneTags(src) {
    const head = src.split('\n').slice(0, 15).join('\n');
    const m = /^\/\/ @lane ([a-z][a-z -]*)$/m.exec(head);
    return m ? m[1].trim().split(/\s+/) : [];
}

/** Every Node test file, `test/…` relative, sorted. @param {string} root @returns {string[]} */
export function testFiles(root) {
    return readdirSync(join(root, 'test')).filter(f => f.endsWith('.test.mjs')).map(f => `test/${f}`).sort();
}

/** The test files that run in `lane`, sorted. Throws for a lane that does not exist, or one with no file in
 *  it: a lane that resolved to nothing would run nothing and pass. @param {string} root @param {string} lane */
export function filesInLane(root, lane) {
    if (!Object.hasOwn(LANES, lane)) throw new Error(`no test lane "${lane}" — the lanes are ${Object.keys(LANES).join(', ')}`);
    const files = testFiles(root).filter(f => laneTags(readFileSync(join(root, f), 'utf8')).includes(lane));
    if (!files.length) throw new Error(`test lane "${lane}" has no test file — a lane that runs nothing passes`);
    return files;
}
