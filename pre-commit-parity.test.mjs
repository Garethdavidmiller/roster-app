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

// STAMPED is a SUBSET of declared, and the two stopped being the same set on 11 Sep 2026.
//
// Every `DOC_*` used to be a version-stamped document, so "the hook declares it" and "the hook
// stamps it" were interchangeable and this file used one for the other. Then the one-line-per-file
// catalogue moved to `docs/FILE_INDEX.md`: the hook must KNOW that path, because the module check
// greps it, and it must NOT stamp it, because like every other file under docs/ it carries no
// version. Treating declaration as stamping made the parity tests below demand that CI stamp a
// document nobody stamps — a real failure, of a rule that had quietly become two rules.
//
// So the stamped set is derived from the hook's own stamp check (the `{ file: …, re: … }` rows)
// rather than from the variable list. A doc the hook references without stamping is now a category
// that exists, and it is invisible to the three parity assertions, which is correct: they are about
// version stamps.
const _stampedPaths = new Set(
    [...src.matchAll(/\{ file: process\.env\.(DOC_[A-Z_]+)\s*,/g)]
        .map(m => (declared.find(d => d.name === m[1]) || {}).path)
        .filter(Boolean));
const stamped = declared.filter(d => _stampedPaths.has(d.path));

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

// ── THE SAME LESSON, ONE STEP ALONG: THE TOOL IT CANNOT FIND (v23.63) ──────────────────────────
//
// The stamp check was fixed for documents and the ESLint step was left with exactly the defect,
// one layer down — it skipped on a missing BINARY rather than a missing file. `git rev-parse
// --show-toplevel` is the WORKTREE root when the commit is made from one, a worktree has no
// `node_modules` (gitignored, so `git worktree add` never copies it and nobody installs into a
// throwaway checkout), and the probe was a bare `./node_modules/.bin/eslint`. So from every
// `.claude/worktrees/*` tree the step printed one line and passed having linted nothing.
//
// Measured, not inferred: with the hook installed and a `no-undef` staged, a commit from a worktree
// was accepted, printing "(node_modules/.bin/eslint not found — run: npm install)". After the fix
// the same commit is refused, naming the error, with eslint resolved out of the main checkout.
//
// Nothing else can see this. CI does not install the hook; a container that never ran
// `core.hooksPath` does not run it; and the one lane that DOES exercise it — a session committing
// from a worktree, which is how this whole sweep was run — reads the skip as success.
describe('a step the hook cannot RUN is not a step that passed', () => {
    test('ESLint is resolved from the main checkout too, not only the current tree', () => {
        // `--git-common-dir` is the only thing in git that names the main checkout from inside a
        // worktree. Requiring it by name is blunt, and blunt is right here: the alternative is
        // asserting on a shell expression, and the failure this guards is somebody simplifying the
        // candidate list back to one entry because it looks redundant in an ordinary checkout.
        assert.match(code, /--git-common-dir/,
            'githooks/pre-commit resolves ESLint without consulting `git rev-parse '
            + '--git-common-dir`, so from a worktree — which never has node_modules — the lint step '
            + 'is skipped and the commit passes unlinted.');
        assert.ok(!/\[\[\s*-x\s*"\.\/node_modules\/\.bin\/eslint"\s*\]\]\s*;\s*then/.test(code),
            'the ESLint probe tests only ./node_modules/.bin/eslint. That path does not exist in a '
            + 'git worktree, and the else branch does not fail — so every worktree commit is '
            + 'unlinted with nothing to say so.');
    });

    test('and when it truly cannot be found, the hook SAYS the check did not run', () => {
        // Deliberately not a refusal: a bare clone with no install must stay committable, which is
        // the same posture `npm run test:nodeps` takes about the test suite. What is not acceptable
        // is a line that reads as advice ("run: npm install") when it is in fact a report that this
        // commit was never checked. The wording is pinned because softening it is a one-word edit
        // and the whole value of the branch is that a person reads it and believes it.
        const elseBranch = code.slice(code.lastIndexOf('ESLINT_BIN'));
        assert.match(elseBranch, /DID NOT RUN/,
            'the ESLint fallback no longer states that the check DID NOT RUN. A missing tool has to '
            + 'read as an unchecked commit, not as a suggestion to install something.');
        assert.match(elseBranch, /NOT linted/,
            'the ESLint fallback no longer says the staged JS was not linted — which is the only '
            + 'fact a reader of that line needs.');
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
        const hookDocs = new Set(stamped.map(d => d.path));
        for (const f of ciDocs) {
            assert.ok(hookDocs.has(f),
                `sw-asset-check.test.mjs stamps ${f} but githooks/pre-commit does not. The hook `
                + 'claims to mirror it; a document in one list and not the other is checked at '
                + 'merge time and not at commit time, which is the wrong way round for a local gate.');
        }
    });

    // ── AND THE SAME PATTERN, NOT MERELY THE SAME FILES (v23.27) ────────────────────────────────
    //
    // The two lists agreed on WHICH documents carry a stamp and nothing compared HOW each one is
    // found. That gap cost a commit: CLAUDE.md's row was renamed from "Current app version" to
    // "Documentation milestone", `sw-asset-check.test.mjs` was updated in the same change, and the
    // hook — the one lane neither CI nor a fresh container runs — kept the old pattern and refused
    // every commit with "no version stamp found". The failure direction is the merciful one here
    // (a refusal, loudly, at the moment you type `git commit`), but the opposite rename would be
    // silent: a hook regex matching something CI's does not means the local gate is passing on a
    // line nobody else reads.
    test('and looks for the stamp the same WAY', () => {
        const rx = /\{ file: ([^,]+),\s*re: (\/[^\n]*?\/)[,\s]/g;
        /** @param {string} text @param {(k:string)=>string} resolve */
        const patterns = (text, resolve) => {
            /** @type {Record<string,string>} */ const out = {};
            for (const m of text.matchAll(rx)) out[resolve(m[1].trim())] = m[2];
            return out;
        };
        const byEnv = Object.fromEntries(stamped.map(d => [`process.env.${d.name}`, d.path]));
        const hookRes = patterns(src, k => byEnv[k] ?? k);
        const ciRes = patterns(swSrc, k => k.replace(/^'|'$/g, ''));

        for (const [file, re] of Object.entries(ciRes)) {
            assert.equal(hookRes[file], re,
                `githooks/pre-commit looks for ${file}'s version stamp with ${hookRes[file]} while `
                + `sw-asset-check.test.mjs uses ${re}. One of them is reading a line the other is `
                + 'not — rename the row in both, in the same commit.');
        }
    });

    test('and the reverse — the hook stamps nothing CI leaves unchecked', () => {
        // A document only the hook knows about is checked for whoever installed the hook and for
        // nobody else, so it looks enforced and is not.
        for (const { path: f } of stamped) {
            assert.ok(ciDocs.includes(f),
                `githooks/pre-commit stamps ${f} but sw-asset-check.test.mjs does not. Add it there `
                + 'too, or the rule only applies to developers who installed the hook.');
        }
    });
});

describe('and something actually installs it', () => {
    /**
     * The hook being CORRECT and the hook being RUN are different properties, and this repo had the
     * second one wrong for a whole release. Git will not run a hook out of a tracked directory
     * unless `core.hooksPath` says so; CI installs no hooks, and the remote container starts from a
     * bare clone every time. So every commit of v22.47 — including the ones that broke the hook —
     * was made straight past it.
     *
     * The session-start hook now sets it. This is the contract that stops that line being deleted
     * as tidy-up, because nothing else would notice: the hook would simply stop running, and a hook
     * that never runs looks exactly like a hook that always passes.
     */
    const startSrc = readFileSync(join(ROOT, '.claude/hooks/session-start.sh'), 'utf8');

    test('the session-start hook points git at githooks/', () => {
        assert.match(startSrc, /git config core\.hooksPath githooks/,
            '.claude/hooks/session-start.sh must set core.hooksPath — without it the pre-commit '
            + 'hook is checked in, documented, and never executed by anybody.');
    });

    test('it does so before the remote-only early exit', () => {
        // A local checkout needs the hook MORE than the container does — that is where a person
        // commits. Putting the install after the `CLAUDE_CODE_REMOTE` guard would silently make it
        // container-only, which is half of the problem it was written to fix.
        const install = startSrc.indexOf('git config core.hooksPath githooks');
        const earlyExit = startSrc.search(/if \[ "\$\{CLAUDE_CODE_REMOTE:-\}" != "true" \]/);
        assert.ok(install > -1 && earlyExit > -1, 'expected both the install and the remote guard');
        assert.ok(install < earlyExit,
            'the core.hooksPath install sits after the remote-only early exit, so a local checkout '
            + 'never gets it — the environment where somebody is actually committing.');
    });

    test('and it cannot abort the session if git refuses', () => {
        // `set -euo pipefail` is at the top of that file. An unguarded `git config` failure would
        // stop the session starting, which is a worse outcome than an uninstalled hook.
        const line = startSrc.split('\n').find(l => l.includes('git config core.hooksPath githooks'));
        assert.match(line, /if |\|\||2>\/dev\/null/,
            'the core.hooksPath install must be guarded — under `set -e` a bare failure aborts the '
            + 'whole session-start script');
    });
});
