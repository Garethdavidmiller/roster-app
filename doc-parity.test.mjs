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

// ── CONTRACT 2b: no live doc states a SUITE SIZE ───────────────────────────────────────────────
//
// Contract 2 above guards counts a CONSTANT owns. A test count has no owner to check against — it
// is whatever the suite happens to contain — which makes it strictly worse, not exempt: it goes
// stale on **every commit that adds a test**, which in this repo is most of them.
//
// Both live examples were written accurately and rotted anyway. CLAUDE.md said "~2310 tests across
// 92 root test files" when the real figure had reached 2,358; KNOWN_LIMITATIONS.md still said "76
// root test files, ~1926 tests" from a much older release. An external reviewer counted the real
// ones and reported the drift, which is the tell: the number cost a reader time and told them
// nothing they could act on.
//
// **The fix is not to update the numbers, it is to stop writing them.** Nobody decides anything
// from a suite size, and the useful property — that every test file is routed from CLAUDE.md — is
// already enforced structurally by CONTRACT 1 above. Removing the figures makes that guarantee the
// only claim the docs make about the suite, and it is one that cannot drift.
//
// Deliberately narrow: it matches a number attached to TESTS or TEST FILES, not any number near the
// word "test". A doc may say "the suite is broad", may name a single suite, and may state a
// threshold a test enforces — what it may not do is write down how many there are.
test('no live doc states how many tests or test files exist', () => {
    const SUITE_SIZE = [
        /(?<![.\d])\b(?:~|approx\.?\s*|about\s+)?[\d,]{2,}\s*(?:passing\s+)?tests?\b/gi,
        /\b[\d,]{2,}\s*(?:root\s+)?test\s+files?\b/gi,
        /\b[\d,]{2,}\s*(?:spec|suite)s?\b/gi,
    ];
    const problems = [];
    for (const doc of LIVE_DOCS) {
        let text;
        // RAW, not prose(). CONTRACT 2 strips fenced code because a filename inside an example is
        // not a listing — but a suite size inside a fence is still a suite size, and the first
        // draft of THIS contract used prose() and therefore could not see the line that prompted
        // it: CLAUDE.md's figure sits in the ```npm test``` block. Teeth-verification caught that
        // (reintroducing the count did not fail the test), which is the only reason it is not
        // still decorative — the same written-but-never-called shape as the v20.12 sweep.
        try { text = read(doc); } catch { continue; }
        for (const re of SUITE_SIZE) {
            re.lastIndex = 0;
            for (const m of text.matchAll(re)) {
                // Same sentence-scoped escape as CONTRACT 2: a doc stating the RULE must be able to
                // name the shape it forbids.
                const start = text.lastIndexOf('.', m.index) + 1;
                const sentence = text.slice(start, text.indexOf('.', m.index + m[0].length) + 1);
                if (/\b(?:do not|don't|never|must not|no longer|stop writing)\b/i.test(sentence)) continue;
                problems.push(`${doc}: "${m[0].trim()}" — a suite size goes stale on the next commit that adds a test`);
            }
        }
    }
    assert.deepEqual(problems, [],
        'remove the figure rather than updating it; CONTRACT 1 already guarantees every test file ' +
        'is routed, which is the part a reader can act on:\n  ' + problems.join('\n  '));
});

test('the suite-size patterns still match their own examples — guard the guard', () => {
    // Without this, a regex broken by an edit would leave CONTRACT 2b passing for ever. The
    // fixtures are the two forms that actually shipped and rotted.
    const shipped = ['~2310 tests across 92 root test files', '76 root test files, ~1926 tests'];
    // And the false positive the first draft produced: a VERSION is not a count. "the v18.95 tests
    // missed" matched as "95 tests", which is how a guard earns an exemption list and stops guarding.
    const notCounts = ['the v18.95 tests missed', 'fixed in v20.35 tests'];
    for (const fixture of shipped) {
        const hit = [/(?<![.\d])\b(?:~|approx\.?\s*|about\s+)?[\d,]{2,}\s*(?:passing\s+)?tests?\b/gi,
                     /\b[\d,]{2,}\s*(?:root\s+)?test\s+files?\b/gi]
            .some(re => { re.lastIndex = 0; return re.test(fixture); });
        assert.ok(hit, `the suite-size patterns no longer match "${fixture}" — they have stopped guarding`);
    }
    for (const fixture of notCounts) {
        const re = /(?<![.\d])\b(?:~|approx\.?\s*|about\s+)?[\d,]{2,}\s*(?:passing\s+)?tests?\b/gi;
        assert.equal(re.test(fixture), false, `"${fixture}" is a VERSION, not a suite size — the pattern must not fire`);
    }
});

// ── CONTRACT 2c: no doc miscounts the GUIDE PAGES ──────────────────────────────────────────────
//
// The same failure as CONTRACT 2, with a list rather than a constant as its owner, and it had
// already happened: `rangers-guide.html` shipped as the FIFTH guide at v20.05, and half a year of
// releases later there were still SEVEN places calling them four — `guide-shell.css` and `guide-back.js` in both routing
// docs, the guide-pages and css-tokens rules, and an AI_MAP line that enumerated the four by name
// and simply omitted the new one. Every one described a file that all five pages load.
//
// The tell is in CLAUDE.md's own tree, which carries the note "the fifth, added v20.05, which this
// line still called 'four' until v20.32". So the miscount WAS found, one copy of it was corrected,
// and the sweep stopped there — which is the documented shape of every attribution bug in this repo
// ("each corrected by editing prose in two or three files, each leaving a copy behind").
//
// SCOPED TO TOTALS BY REQUIRING THE WORD "all". A subset claim is legitimate and common — "the two
// document-style guides" load `guide-doc.css`, and that is true — so a bare "N guides" pattern would
// fire on correct prose, acquire an exemption list, and stop guarding. "all N guides" is only ever a
// claim about every one of them.
//
// The truth comes from NAV_GUIDES, which is what the drawer renders and what
// `firestore-contract-parity.test.mjs` already checks the analytics ids against — so this compares
// the docs to the same source the app uses, not to a number typed here.
const NAV_PANEL = read('./nav-panel.js');

/** How many guides the app actually has, read from the list the drawer renders. */
function guideCount() {
    const block = NAV_PANEL.match(/const NAV_GUIDES\s*=\s*\[([\s\S]*?)\n\];/);
    assert.ok(block, 'NAV_GUIDES not found in nav-panel.js — this test is checking nothing');
    return [...block[1].matchAll(/url:\s*'\.\/[^']+\.html'/g)].length;
}

const NUMBER_WORD = {
    two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

test('no doc states a guide-page total that disagrees with NAV_GUIDES', () => {
    const real = guideCount();
    assert.ok(real >= 4, `expected at least 4 guides, read ${real} from NAV_GUIDES`);

    // Every doc that describes the guide chrome. `guide-pages.md` is the rules file for these pages
    // and carried two of the seven, so the list is deliberately wider than LIVE_DOCS.
    const DOCS = [...LIVE_DOCS, './.claude/rules/guide-pages.md'];
    const RE = /\ball\s+(\d+|two|three|four|five|six|seven|eight|nine|ten)\s+(?:app\s+)?guides?(?:\s+pages?)?\b/gi;

    const problems = [];
    for (const doc of DOCS) {
        let text;
        try { text = read(doc); } catch { continue; }
        for (const m of text.matchAll(RE)) {
            const n = NUMBER_WORD[m[1].toLowerCase()] ?? Number(m[1]);
            if (n === real) continue;
            // A doc recording what USED to be true is not making a claim about today. Judged on the
            // sentence, like CONTRACT 2 — so "it said four until v20.32" passes and a live
            // "all four guides share this" does not.
            const start = text.lastIndexOf('.', m.index) + 1;
            const sentence = text.slice(start, text.indexOf('.', m.index + m[0].length) + 1);
            if (/\b(?:until|used to|previously|at the time|was written|no longer|do not|don't|never|must not)\b/i.test(sentence)) continue;
            problems.push(`${doc}: "${m[0].trim()}" — there are ${real}`);
        }
    }
    assert.deepEqual(problems, [],
        `NAV_GUIDES has ${real} entries. A doc that miscounts them describes a file every guide ` +
        'loads, and reads as correct:\n  ' + problems.join('\n  '));
});

test('the guide-count guard still matches the form that shipped — guard the guard', () => {
    // The exact strings that were live at v20.54, one per file they came from. If the pattern is
    // ever loosened or tightened past these, it has stopped covering the bug it was written for.
    const RE = /\ball\s+(\d+|two|three|four|five|six|seven|eight|nine|ten)\s+(?:app\s+)?guides?(?:\s+pages?)?\b/gi;
    for (const shipped of [
        'shared chrome for all 4 guide pages (header + gold brand rule',
        'the page you came from, all 4 guides) | `guide-back.js` |',
        'All four guide pages share one chrome for consistent behaviour',
        'all six app pages + all four guides — the guides do not',
    ]) {
        RE.lastIndex = 0;
        assert.ok(RE.test(shipped), `the pattern no longer matches "${shipped}"`);
    }
    // And the subset claims it must NOT fire on — these are true and must stay sayable.
    for (const fine of [
        'the two document-style guides additionally load `guide-doc.css`',
        'guide-print.js, shared by three of the guides',
    ]) {
        RE.lastIndex = 0;
        assert.equal(RE.test(fine), false, `"${fine}" is a subset, not a total — the pattern must not fire`);
    }
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
