/**
 * doc-parity.test.mjs — the documentation is checked, not merely reviewed (v20.11).
 * Run: node --test doc-parity.test.mjs   (part of `npm run test:hygiene`)
 *
 * ── WHY A REVIEW IS NOT ENOUGH ──────────────────────────────────────────────────────────────────
 *
 * `sw-asset-check.test.mjs` already forces the five versioned docs to be **re-stamped** at every
 * 0.10 milestone, and `githooks/pre-commit` enforces the same locally. That is a prompt to look; it
 * verifies nothing. And the record shows looking is not sufficient — every one of these shipped and
 * was found by a human reading, not by a gate:
 *
 *   · the nav-drawer entry said the current page was "omitted" while the code rendered it,
 *     for **ten versions** (v10.57 → v20.06)
 *   · "~90 Ranger and Rover products", pinned in staff-facing copy, changing upstream
 *   · "22 lines" in six present-tense comments after the rotation moved to 24
 *   · a deletion panel promising a 30-day countdown for ten versions after purging was switched off
 *   · four Rangers attributions, each corrected by editing prose in two or three files, each
 *     leaving a copy behind
 *
 * They are one bug: **prose restating a fact that lives somewhere else.** The repo already knows
 * the fix — `ROTATING_LINES` is declared once, `POLICY_SOURCE_CONFIRMED` is the one home for a
 * judgement, the `SECURITY_RELEASE_PLAN.md` status table says "update it HERE and nowhere else".
 * This file applies that discipline to the docs themselves.
 *
 * TWO CONTRACTS, deliberately narrow. A general "the docs describe the code correctly" test cannot
 * be written; these are the two mechanical properties that actually failed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const read = (/** @type {string} */ f) => readFileSync(new URL(f, import.meta.url), 'utf8');
const CLAUDE = read('./CLAUDE.md');
const AI_MAP = read('./AI_MAP.md');

/** Strip fenced code and inline code so a name inside an example is not read as a listing. */
const prose = (/** @type {string} */ s) => s.replace(/```[\s\S]*?```/g, ' ');

// ── CONTRACT 1: every module and test file is LISTED in both routing docs ──────────────────────
//
// The pre-commit hook enforces this for modules on a STAGED commit. It cannot see a file that was
// added in an earlier commit and never listed, and it does not cover test files at all — which is
// how `calendar-doc-viewer.test.mjs` ended up in AI_MAP.md and not in CLAUDE.md.
//
// Listing is checked as a substring of the whole file rather than of the tree, because several
// test files are legitimately grouped onto one line ("a.test.mjs / b.test.mjs / c.test.mjs").

/** Files that are deliberately not routed: tooling that no session needs to find. */
const NOT_ROUTED = new Set([
    'eslint.config.js',      // flat ESLint config; named in the tree under scripts/tooling prose
    'generate-sri.mjs',      // dev utility, run by hand
    'purify.es.mjs',         // vendored third party
]);

const rootFiles = readdirSync(new URL('.', import.meta.url))
    .filter(f => (f.endsWith('.js') || f.endsWith('.mjs')) && !NOT_ROUTED.has(f));
// `playwright.*.mjs` are test-runner CONFIG, routed from CLAUDE.md's tree. AI_MAP is a module map
// and correctly does not carry them — requiring it would be asking the map to describe the harness.
const modules = rootFiles.filter(f => !f.includes('.test.') && !f.startsWith('playwright.'));
const tests = rootFiles.filter(f => f.includes('.test.'));

// MODULES in both, TESTS in CLAUDE.md only. That asymmetry is the real convention, not a
// concession: AI_MAP hangs a test off the module it covers ("Tested by x.test.mjs"), which the
// cross-cutting parity suites have no module to hang from. Requiring them there would force a
// fictional owner for each, which is worse than not listing them.
test('every root MODULE is listed in CLAUDE.md and AI_MAP.md', () => {
    const missing = modules
        .filter(f => !CLAUDE.includes(f) || !AI_MAP.includes(f))
        .map(f => `${f} — missing from ${!CLAUDE.includes(f) ? 'CLAUDE.md' : ''}${!CLAUDE.includes(f) && !AI_MAP.includes(f) ? ' + ' : ''}${!AI_MAP.includes(f) ? 'AI_MAP.md' : ''}`);
    assert.deepEqual(missing, [],
        'these modules are not routed from both docs, so nothing points a reader at them:\n  ' +
        missing.join('\n  '));
});

test('every runner config is listed in CLAUDE.md', () => {
    const missing = rootFiles.filter(f => f.startsWith('playwright.') && !CLAUDE.includes(f));
    assert.deepEqual(missing, [], 'unlisted runner configs: ' + missing.join(', '));
});

test('every root TEST file is listed in CLAUDE.md', () => {
    // The pre-commit hook covers modules on a STAGED commit. It cannot see a file added earlier and
    // never listed, and it does not look at tests at all — which is how `calendar-doc-viewer.test.mjs`
    // reached AI_MAP.md and not CLAUDE.md.
    const missing = tests.filter(f => !CLAUDE.includes(f));
    assert.deepEqual(missing, [],
        'these test files exist but CLAUDE.md does not list them:\n  ' + missing.join('\n  '));
});

test('the file list itself is non-empty — guard the guard', () => {
    // Every assertion above passes vacuously if the directory read returns nothing.
    assert.ok(modules.length > 60, `expected >60 modules, saw ${modules.length}`);
    assert.ok(tests.length > 60, `expected >60 test files, saw ${tests.length}`);
    assert.ok(CLAUDE.length > 50_000 && AI_MAP.length > 50_000, 'a routing doc came back suspiciously short');
});

// ── CONTRACT 2: no doc restates a count that a constant owns ───────────────────────────────────
//
// `links-rotation-parity.test.mjs` proved this works for ONE number, after the rotation length was
// found restated in ~15 places. The failure generalises: a count written into prose renders
// perfectly while describing something that no longer exists, and nothing anywhere reads prose for
// a number.
//
// Scoped to counts a CONSTANT owns, and phrased as "the doc must not state the figure", not "the
// doc must not mention the subject" — a doc may say "the rotation length" freely; what it may not
// do is write the number.

/** `[constant, its live value, a regex for the prose form that restates it]`. */
const OWNED_COUNTS = [
    // ROTATING_LINES already has links-rotation-parity.test.mjs; the others had nothing.
    // Scoped to a DELETION countdown specifically. The first draft matched any "N-day window" and
    // flagged the links welcome notice (14 days), the clientErrors retention (90) and the usage
    // dedup window (30) — three unrelated figures with three different owners. A guard that cries
    // wolf gets an exemption list, and an exemption list is how a guard stops guarding.
    ['SOFT_DELETE_RETENTION_DAYS', 'links-deletion.js',
        /\b(?:removed for good|purged|destroyed|restorable|kept in the bin)\s+(?:for\s+|after\s+|in\s+)?(\d+)\s*days?\b|\b(\d+)[- ]day (?:countdown|retention)\b/gi,
        'the soft-delete retention period is DORMANT — nothing acts on it and nothing may promise it to a user'],
    ['MAX_CONSECUTIVE_WORKED_DAYS', 'links-limits.js',
        /\blimit of (\d+) consecutive\b/gi,
        'the consecutive-day limit is owned by links-limits.js'],
    ['CONTRACTED_HOURS_PER_WEEK', 'links-design.js',
        /\bcontracted (?:week|hours) of (\d+)\b/gi,
        'the contracted week is owned by links-design.js'],
];

/** The docs a staff member or a session actually reads. Plans record history and are exempt. */
const LIVE_DOCS = ['./CLAUDE.md', './AI_MAP.md', './ROADMAP.md', './KNOWN_LIMITATIONS.md',
    './OPERATIONS_REFERENCE.md', './.claude/rules/links-design.md', './.claude/rules/css-tokens.md'];

test('no live doc restates a count that a constant owns', () => {
    const problems = [];
    for (const [name, home, re] of OWNED_COUNTS) {
        for (const doc of LIVE_DOCS) {
            let text;
            try { text = prose(read(doc)); } catch { continue; }
            for (const m of text.matchAll(re)) {
                // A doc stating the RULE has to be able to name the number it forbids. Judged on
                // the sentence, so "Do not describe a 30-day window" passes and a bare promise of
                // one does not.
                const start = text.lastIndexOf('.', m.index) + 1;
                const sentence = text.slice(start, text.indexOf('.', m.index + m[0].length) + 1);
                if (/\b(?:do not|don't|never|must not|no longer|dormant|suspended|stopped|switched off)\b/i.test(sentence)) continue;
                problems.push(`${doc}: "${m[0].trim()}" writes down a figure ${name} owns (${home})`);
            }
        }
    }
    assert.deepEqual(problems, [],
        'a count restated in prose renders perfectly while describing something that no longer ' +
        'exists, and nothing reads prose for a number:\n  ' + problems.join('\n  '));
});

test('the count patterns still match something somewhere — guard the guard', () => {
    // If every pattern silently stopped matching, the test above would pass forever. The patterns
    // are checked against text that SHOULD trip them, so a regex broken by an edit fails here
    // rather than going quiet.
    const fixtures = [
        'each row said removed for good in 30 days',
        'against a limit of 13 consecutive worked days',
        'a contracted week of 35 hours',
    ];
    OWNED_COUNTS.forEach(([name, , re], i) => {
        re.lastIndex = 0;
        assert.ok(re.test(fixtures[i]),
            `the pattern for ${name} no longer matches its own example — it has stopped guarding anything`);
    });
});

// ── CONTRACT 3: the tree ROUTES, it does not explain ───────────────────────────────────────────
//
// The property that keeps CLAUDE.md loadable. It is stated as a rule at the top of the tree, and a
// rule with no gate is how the tree reached 136k characters and 208 version references in the first
// place. Two cheap, objective limits — neither is a style opinion:
//
//   · no single entry may exceed ~1,600 characters. Past that it has stopped being a pointer.
//   · the tree may not accumulate release history. A handful of version stamps is fine (they date
//     a decision); dozens means the changelog has moved back in.
test('the CLAUDE.md file tree stays a routing table', () => {
    const tree = (CLAUDE.match(/```[\s\S]*?```/) || [''])[0];
    assert.ok(tree.length > 10_000, 'the file tree was not found — this test is checking nothing');

    const entries = tree.split('\n').filter(l => /^[│├└]/.test(l) && l.includes('←'));
    assert.ok(entries.length > 150, `expected >150 routed entries, found ${entries.length}`);

    const tooLong = entries
        .filter(l => l.length > 1600)
        .map(l => `${l.replace(/^[│├└─\s]+/, '').split('←')[0].trim()} (${l.length} chars)`);
    assert.deepEqual(tooLong, [],
        'these entries have stopped being pointers. Move the reasoning into the module header and ' +
        'leave a routing line:\n  ' + tooLong.join('\n  '));

    const stamps = (tree.match(/v\d+\.\d+/g) || []).length;
    assert.ok(stamps < 90,
        `the tree carries ${stamps} version references — it was 208 before v20.11, which is a ` +
        'changelog living in a routing table, loaded into every session. Release history belongs ' +
        'in git and the plan docs.');
});
