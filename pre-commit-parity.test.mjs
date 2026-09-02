/**
 * pre-commit-parity.test.mjs — the enforced hook must be able to READ what it claims to check.
 * Run: node --test pre-commit-parity.test.mjs   (part of `npm run test:hygiene`)
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────────
 *
 * `githooks/pre-commit` is named in CLAUDE.md as part of the enforced development workflow, and it
 * is the ONLY thing in this repository that no other lane can see. CI does not install it. The
 * container these sessions run in does not install it. So nothing in 4,000 passing tests says a
 * word about whether it still works.
 *
 * At v22.47 the five versioned documents moved into `docs/`, and the hook did not follow. Every
 * suite stayed green and the hook broke in FOUR places at once — the module listing, the staged
 * AI_MAP detection, the export-drift diff, and the 0.10 stamp list. Reproduced afterwards in a
 * clone with `core.hooksPath githooks` set: a one-line edit to `ls.js` was refused, naming all 149
 * root modules as undocumented.
 *
 * ── THE TWO FAILURES WERE NOT THE SAME KIND, AND THE QUIET ONE IS WORSE ────────────────────────
 *
 * The module check went LOUD and WRONG: `grep AI_MAP.md` against a path that no longer exists
 * matches nothing, so every module read as undocumented and every commit was refused. Wrong, but
 * unmissable — the first person to commit finds it.
 *
 * The 0.10 stamp check went SILENT. It carried `if (!fs.existsSync(file)) continue`, so the four
 * moved documents were skipped rather than failed: the check ran, passed, and had checked nothing.
 * A developer with the hook installed would have been told their documentation sweep was fine for
 * as long as the paths stayed wrong. That skip is now a failure, and this file exists so the next
 * reorganisation is caught by the test suite rather than by somebody's terminal.
 *
 * ── WHAT THIS FILE DOES NOT DO ─────────────────────────────────────────────────────────────────
 *
 * It does not run the hook, and it does not re-implement any of its checks. Running it would need
 * a scratch clone and a staged tree per case; that is a real test to write one day, but it is not
 * what broke. What broke was the hook pointing at files that are not there — a question a static
 * read answers completely, and the only question whose answer nothing else in the repo holds.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(fileURLToPath(import.meta.url));
const HOOK = join(ROOT, 'githooks/pre-commit');
const src = readFileSync(HOOK, 'utf8');

/** Strip `#` and `//` comment lines — the hook's history is written in prose and mentions the old
 *  root filenames on purpose. Only executable lines are policed. */
const code = src
    .split('\n')
    .filter(l => !/^\s*#/.test(l) && !/^\s*\/\//.test(l))
    .join('\n');

/** The `export DOC_NAME="path"` declarations at the top of the hook. */
const declared = [...src.matchAll(/^export (DOC_[A-Z_]+)="([^"]+)"$/gm)]
    .map(([, name, path]) => ({ name, path }));

describe('the pre-commit hook can read what it checks', () => {
    test('it declares its documentation paths in one place', () => {
        // The point of the single declaration is that the next move is one edit rather than four.
        assert.ok(declared.length >= 5,
            `expected the hook to declare its documents as \`export DOC_*="…"\`, found ${declared.length}`);
    });

    for (const { name, path } of declared) {
        test(`${name} → ${path} exists`, () => {
            assert.ok(existsSync(join(ROOT, path)),
                `githooks/pre-commit reads ${path}, which does not exist. Every check that touches `
                + 'it is now either refusing every commit or silently passing without looking.');
        });
    }

    test('the embedded node scripts read the declared paths, not their own copies', () => {
        // The heredocs are quoted (`<< 'NODEEOF'`), so the shell does not interpolate into them.
        // They must therefore reach for `process.env.DOC_*`; a literal path inside one is a second
        // copy of the answer, free to drift from the first exactly as it did at v22.47.
        for (const doc of ['AI_MAP.md', 'OPERATIONS_REFERENCE.md', 'KNOWN_LIMITATIONS.md', 'ROADMAP.md']) {
            const bare = new RegExp(`(?<!docs/)(?<!DOC_[A-Z_]{0,24})\\b${doc.replace('.', '\\.')}`);
            assert.ok(!bare.test(code),
                `githooks/pre-commit names ${doc} without a path. Use the exported DOC_* variable `
                + '— a hardcoded filename is how the docs/ move broke four checks at once.');
        }
    });

    test('a document it cannot find is a FAILURE, never a skip', () => {
        // This is the whole v22.47 lesson in one assertion. `continue` on a missing file turns a
        // broken path into a green check, and a check that passes without looking is worse than
        // one that is absent — an absent check nobody believes in.
        assert.ok(!/existsSync\(file\)\)\s*continue/.test(code),
            'the 0.10 stamp check skips documents it cannot find. That is how the docs/ move '
            + 'disabled four fifths of it in silence — push the missing file into `stale` instead.');
    });
});

describe('the hook and CI check the same documents', () => {
    // The hook says it "mirrors sw-asset-check.test.mjs exactly", which is the claim that makes it
    // safe to lean on locally. Nothing was checking the claim, and at v22.47 it stopped being true:
    // CI's list had been updated to docs/, the hook's had not.
    const swSrc = readFileSync(join(ROOT, 'sw-asset-check.test.mjs'), 'utf8');
    const ciDocs = [...swSrc.matchAll(/^\s*\{ file: '([^']+\.md)',/gm)].map(m => m[1]);

    test('CI declares a versioned-document list at all', () => {
        assert.ok(ciDocs.length >= 5,
            `expected sw-asset-check.test.mjs to list the versioned docs, found ${ciDocs.length}`);
    });

    test('every document CI version-stamps is one the hook also stamps', () => {
        const hookDocs = new Set(declared.map(d => d.path));
        for (const f of ciDocs) {
            assert.ok(hookDocs.has(f),
                `sw-asset-check.test.mjs stamps ${f} but githooks/pre-commit does not. The hook `
                + 'claims to mirror it; a document in one list and not the other is checked at '
                + 'merge time and not at commit time, which is the wrong way round for a local gate.');
        }
    });

    test('and the reverse — the hook stamps nothing CI leaves unchecked', () => {
        // A document only the hook knows about is checked for whoever installed the hook and for
        // nobody else, so it looks enforced and is not.
        for (const { path: f } of declared) {
            assert.ok(ciDocs.includes(f),
                `githooks/pre-commit stamps ${f} but sw-asset-check.test.mjs does not. Add it there `
                + 'too, or the rule only applies to developers who installed the hook.');
        }
    });
});
