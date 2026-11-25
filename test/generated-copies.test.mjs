// @ts-check
// @lane hygiene
/**
 * generated-copies.test.mjs — every copy `npm run generate:copies` writes is committed as it would
 * write it now. Run: node scripts/run-tests.mjs test/generated-copies.test.mjs   (part of `npm run test:hygiene`)
 *
 * scripts/generate-copies.mjs writes the facts this repo needs in more than one file from the one
 * place each is edited (its header lists them). Its output is committed, because nothing runs at
 * deploy or in the browser — so the one way a copy can still be wrong is that somebody edited the
 * source and did not run the generator, or edited a generated region by hand. Either fails here,
 * naming the file, the first line that differs, and the command. The hook (githooks/pre-commit) makes
 * the same comparison over the commit as staged.
 *
 * This file checks CURRENCY only. Whether a copy is RIGHT — the meta CSP being the header minus what
 * a <meta> cannot carry, say — stays in the suite that owns that rule (the generator's header names
 * each one), checked by an independent reading so a bug in the generator cannot pass for a current
 * file.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { buildCopies, COPIES, firstDifference } from '../scripts/generate-copies.mjs';

// Tests live in test/ but address files from the repository root (moved 24 Nov 2026).
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (/** @type {string} */ f) => readFileSync(join(ROOT, f), 'utf8');

const built = buildCopies(read);

test('every generated fact owns at least one file, and each file is checked once', () => {
    // Guard the guard: a copy whose function returned nothing would make its checks below vacuous.
    for (const [copy] of COPIES)
        assert.ok(built.some(b => b.copy.split(' + ').includes(copy)), `${copy} writes no file — generate-copies.mjs is checking nothing for it`);
    const files = built.map(b => b.file);
    assert.equal(new Set(files).size, files.length, 'buildCopies returned a file twice — the second would undo the first');
});

for (const { copy, file, content } of built) {
    test(`${file} is current (${copy})`, () => {
        const have = read(file);
        assert.ok(have === content,
            `${file} is not what npm run generate:copies writes (${copy}) — run it and commit the result. `
            + `If you edited a GENERATED region by hand, edit its source instead.\n  first difference at ${firstDifference(have, content)}`);
    });
}
