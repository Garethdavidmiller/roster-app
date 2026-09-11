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
 * NARROW CONTRACTS, deliberately. A general "the docs describe the code correctly" test cannot be
 * written; these are the mechanical properties that actually failed. Contract 1 grew a wiring half
 * at v21.00: a test file may be listed in CLAUDE.md and still be run by nothing, which is the worst
 * of both — the listing is what a reader checks, and the suite passes by never executing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const read = (/** @type {string} */ f) => readFileSync(new URL(f, import.meta.url), 'utf8');
const CLAUDE = read('./CLAUDE.md');
const FILE_INDEX = read('./docs/FILE_INDEX.md');
// THE ROUTING CORPUS. The one-line-per-file catalogue moved to `docs/FILE_INDEX.md` on 11 Sep 2026
// (it was 64% of a document loaded into every session). Every contract below that asks "is this file
// ROUTED anywhere?" must read BOTH, or the split would silently un-route ~430 files — which is the
// one way this move could have gone wrong and left every suite green.
const ROUTING = CLAUDE + '\n' + FILE_INDEX;
const AI_MAP = read('./docs/AI_MAP.md');

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
// ── KNOWN_LIMITATIONS.md STATES WHAT IS STILL TRUE ─────────────────────────────────────────────
//
// The file promises "intentional constraints and deferred work", so a reader must be able to take
// every heading as: this is still the case and I need to know about it. By 2 Sep 2026 about a fifth
// of it was not — twelve sections explicitly closed, fixed or superseded, the largest of them 14,063
// characters describing a boundary shut since August. A closed limitation left in place does not
// merely waste the reader's time; it makes the whole file's headings unreliable, so the ones that
// ARE live stop being believed.
//
// ARCHITECTURE.md already works this way for its `EXC-*` register: a closed exception is deleted,
// not struck through. This applies the same rule where it was not being applied.
//
// **The exemption list is the important half, and it is by NAME rather than by pattern.** Two
// headings legitimately read as closed:
//
//   · the `apis.google.com` CSP section says "(fixed v17.82)" and is a STANDING CONSTRAINT — the
//     policy must go on allowing those hosts, and it records a false pass where a local
//     `npm run test:csp` is green while CI is red. A rule that deleted it would delete a warning.
//   · the mixed-version cache window is "mitigated, not fully closed (accepted)" — a live trade.
//
// So this guard cannot be a blanket ban on the words: it needs a reason per exemption, written
// down, which is the only form that stays honest. Adding to EXEMPT is a decision somebody makes.
const CLOSED_WORDS = /\b(CLOSED|FIXED|SUPERSEDED|RESOLVED|no longer a limitation|RESTORED)\b/i;
const CLOSED_HEADING_EXEMPT = [
    // "(fixed v17.82)" — the FIX is history, the CONSTRAINT is permanent: CSP must keep allowing
    // apis.google.com and the auth iframe, and the section carries the local-green/CI-red false pass.
    'must allow Firebase Auth',
    // "mitigated, not fully closed (accepted)" — the word is there to say it is NOT closed.
    'Mixed-version cache window',
];
test('KNOWN_LIMITATIONS.md headings state what is still true', () => {
    const doc = read('./docs/KNOWN_LIMITATIONS.md');
    const offenders = doc.split('\n')
        .filter(l => /^#{2,3} /.test(l))
        .filter(l => CLOSED_WORDS.test(l) || l.includes('~~'))
        .filter(l => !CLOSED_HEADING_EXEMPT.some(e => l.includes(e)));
    assert.deepEqual(offenders, [],
        'these headings read as closed, so a reader cannot take the file at its word. Move the\n' +
        'section to ROADMAP_HISTORY.md (or let git hold it), keep any durable lesson in the contract\n' +
        'or module header that owns it, and add a NAMED exemption here only if the heading is\n' +
        'genuinely still live:\n  ' + offenders.join('\n  '));
});

test('every root MODULE is listed in CLAUDE.md and AI_MAP.md', () => {
    const missing = modules
        .filter(f => !ROUTING.includes(f) || !AI_MAP.includes(f))
        .map(f => `${f} — missing from ${!ROUTING.includes(f) ? 'docs/FILE_INDEX.md' : ''}${!ROUTING.includes(f) && !AI_MAP.includes(f) ? ' + ' : ''}${!AI_MAP.includes(f) ? 'docs/AI_MAP.md' : ''}`);
    assert.deepEqual(missing, [],
        'these modules are not routed from both docs, so nothing points a reader at them:\n  ' +
        missing.join('\n  '));
});

test('every runner config is listed in CLAUDE.md', () => {
    const missing = rootFiles.filter(f => f.startsWith('playwright.') && !ROUTING.includes(f));
    assert.deepEqual(missing, [], 'unlisted runner configs: ' + missing.join(', '));
});

test('a doc that says "`symbol` in `file.js`" is right about the file', () => {
    // The docs ROUTE — that is their whole job — and a routing claim is checkable, so check it.
    // Nothing did, and the two this found were both live: `CONDITIONAL_ROWS` was attributed to
    // paycalc-app.js while living in paycalc-periods.js, under a sentence telling the reader to add
    // an array entry there; and `_appendOriginSection` still pointed at operations-reports.js one
    // release after the v21.32 split moved it, written by the same session that did the moving.
    //
    // That is the failure mode this file exists for: prose restating a fact that lives elsewhere,
    // and drifting the moment the fact moves. A stale route is worse than no route — it sends a
    // reader somewhere confidently wrong, and the tree beside it was RIGHT in both cases, so the
    // file disagreed with itself.
    //
    // Deliberately narrow: only the "`sym` in `file.js`" shape, which is unambiguous and mechanical.
    // A looser match would pull in prose that mentions a symbol near a filename for other reasons,
    // acquire an exemption list, and stop guarding.
    //
    // WIDENED BY THREE WORDS (v21.63), because the narrowness had a hole exactly the width of a
    // noun. CLAUDE.md said "`_staleMemberName` FLAG in `calendar-app.js`" — the symbol is in
    // `calendar-member.js`, and the single word "flag" between the symbol and `in` was enough for
    // this pattern to skip it. That is the third instance of this defect class (after
    // CONDITIONAL_ROWS and PILL_TYPES), and the first the guard was live for and missed. Allowing
    // up to three intervening words was measured over both docs before landing: it adds exactly one
    // new match — the defect itself — and no false positives.
    const claims = [];
    for (const doc of ['./CLAUDE.md', './docs/AI_MAP.md']) {
        for (const m of read(doc).matchAll(/`([A-Za-z_$][\w$]*)`\s*(?:\([^)]*\)\s*)?(?:[a-z]+\s+){0,3}in\s+`([\w.-]+\.(?:js|mjs))`/g))
            claims.push({ doc, sym: m[1], file: m[2] });
    }
    assert.ok(claims.length >= 20, `expected many routing claims, found ${claims.length}`);
    const wrong = claims
        .filter(({ file }) => rootFiles.includes(file) || file.startsWith('functions/'))
        .filter(({ sym, file }) => !new RegExp(`\\b${sym.replace(/\$/g, '\\$')}\\b`).test(read('./' + file)))
        .map(({ doc, sym, file }) => `${doc}: \`${sym}\` is not in ${file}`);
    assert.deepEqual(wrong, [],
        'these routing claims send a reader to the wrong file:\n  ' + wrong.join('\n  '));
});

test('and no dev-only root file is DEPLOYED — the hosting ignore list is hand-maintained too', () => {
    // `firebase.json`'s `ignore` is a denylist, so anything new at the root ships to the live site by
    // DEFAULT. Nothing announces that: the file is simply there, publicly fetchable, and the app
    // works exactly as before. `playwright.webkit.mjs` shipped that way at v21.28 while its four
    // siblings were correctly excluded — found by reading the list, which is not a control.
    //
    // Scoped to the two classes that are unambiguously dev-only. Test FILES were already covered by
    // the `**/*.test.mjs` glob; runner configs are named one by one, which is exactly where a new
    // one gets missed.
    const hosting = JSON.parse(readFileSync(new URL('./firebase.json', import.meta.url), 'utf8'));
    const ignore  = new Set(hosting.hosting.ignore);
    const served  = rootFiles
        .filter(f => f.startsWith('playwright.') || f.includes('.test.'))
        .filter(f => !ignore.has(f) && !(f.includes('.test.') && ignore.has('**/*.test.mjs')));
    assert.deepEqual(served, [],
        'these dev-only files are missing from firebase.json → hosting.ignore, so they are served '
        + 'from the live site:\n  ' + served.join('\n  '));
});

test('every root TEST file is listed in CLAUDE.md', () => {
    // The pre-commit hook covers modules on a STAGED commit. It cannot see a file added earlier and
    // never listed, and it does not look at tests at all — which is how `calendar-doc-viewer.test.mjs`
    // reached AI_MAP.md and not CLAUDE.md.
    const missing = tests.filter(f => !ROUTING.includes(f));
    assert.deepEqual(missing, [],
        'these test files exist but CLAUDE.md does not list them:\n  ' + missing.join('\n  '));
});

// The same rule for the BROWSER suite, which contract 1 above cannot see: it walks the repo root,
// and every Playwright spec lives in `e2e/`. So an e2e spec could exist, run on every branch, and
// be absent from the routing table with nothing to say so — which is exactly what happened to
// `calendar-pin.spec.js`. It shipped 35 tests covering the staff PIN (the app's one access
// boundary that a rendered page can check: no roster data in a locked DOM, the splash coming down
// on the locked path, a viewer refused by the protected pages) and was the ONLY spec of eleven
// missing from CLAUDE.md's tree. Found by inventory, not by review, which is the argument for
// checking it mechanically rather than trusting the next reader to notice.
//
// Routing only — this says nothing about whether a spec is RUN, because Playwright discovers specs
// by directory rather than by a list, so there is no second place for one to fall out of.
test('every e2e spec is routed in CLAUDE.md', () => {
    let specs = [];
    try {
        specs = readdirSync(new URL('./e2e/', import.meta.url))
            .filter(f => f.endsWith('.spec.js')).sort();
    } catch { /* no e2e directory in this checkout */ }
    assert.ok(specs.length > 0, 'no e2e specs found — the guard would pass vacuously');
    const missing = specs.filter(f => !ROUTING.includes(f));
    assert.deepEqual(missing, [],
        'these e2e specs exist but CLAUDE.md does not list them:\n  ' + missing.join('\n  '));
});

// A test file that is LISTED and never RUN is worse than one that is neither, because the listing
// is what a reader checks. `links-contract.test.mjs` shipped at v20.98 as the gate on a money-
// affecting rule, was teeth-verified by mutation, was written up in CLAUDE.md as "Part of
// test:hygiene" — and was never added to the runner. It sat green for two releases by not existing
// as far as `npm test` was concerned, and the only reason it was found is that a later edit to the
// same script put the list in front of someone. Contract 1 above cannot see this: listing a file in
// a doc and wiring it into a runner are different acts, and it only checks the first.
//
// Checked against package.json rather than against the doc, because the runner is what actually
// runs. The exemptions are the suites with a home of their own, each named individually so a new
// unrun file cannot arrive by matching a pattern.
const RUNNER_EXEMPT = new Set([
    'firestore.rules.test.mjs',       // npm run test:rules — needs the Firebase emulator binary
    'storage.rules.test.mjs',         // npm run test:rules — same
    'roster-parse-helpers.test.mjs',  // npm run test:functions — needs functions/node_modules
    'functions-surface.test.mjs',     // npm run test:functions — requires functions/index.js
    'overtime-endpoints.test.mjs',    // npm run test:functions — same
]);

test('every root TEST file is actually RUN by one of the npm scripts', () => {
    const pkg = read('./package.json');
    const scripts = JSON.parse(pkg).scripts;
    const wired = Object.entries(scripts)
        .filter(([name]) => name.startsWith('test'))
        .map(([, cmd]) => cmd).join(' ');
    const unrun = tests.filter(f => !RUNNER_EXEMPT.has(f) && !wired.includes(f));
    assert.deepEqual(unrun, [],
        'these test files exist but no npm script runs them — they pass by never executing:\n  ' +
        unrun.join('\n  '));
});

test('and every runner exemption still exists — guard the guard', () => {
    // An exemption for a deleted file is a hole the next same-named file falls into silently.
    const gone = [...RUNNER_EXEMPT].filter(f => !tests.includes(f));
    assert.deepEqual(gone, [], 'exempted files that no longer exist: ' + gone.join(', '));
});

test('the file list itself is non-empty — guard the guard', () => {
    // Every assertion above passes vacuously if the directory read returns nothing.
    assert.ok(modules.length > 60, `expected >60 modules, saw ${modules.length}`);
    assert.ok(tests.length > 60, `expected >60 test files, saw ${tests.length}`);
    assert.ok(CLAUDE.length > 50_000 && AI_MAP.length > 50_000 && FILE_INDEX.length > 50_000,
        'a routing doc came back suspiciously short');
});

// ── CONTRACT 1d: AI_MAP gives every module its OWN ENTRY, not merely a mention ─────────────────
//
// Contract 1 asks whether a module's NAME appears in AI_MAP.md. That is satisfied by a row in the
// quick-decision table, or by a passing reference inside another module's entry — neither of which
// is the thing AI_MAP exists to provide. CLAUDE.md's tree says "See AI_MAP.md for full module
// descriptions and export lists", so a module with no entry is a routing DEAD END reached through a
// pointer that promised otherwise, and contract 1 goes green over it.
//
// Measured 8 Sep 2026, auditing the file: FOUR modules had no entry. `install-prompt.js` and
// `text-scale.js` appeared only as a quick-table row, though both carry real design reasoning that
// CLAUDE.md's tree routes to at length. `admin-boot.js` and `settings-boot.js` had nothing at all,
// while three of their four identical siblings each carried a near-identical paragraph — an
// incomplete set and a fact written three times, which is the pair of failures this file's own
// size section keeps arguing against.
//
// Headings may GROUP modules (`a.js` / `b.js` / `c.js`), which is how the six boot shims and the
// Overtime cluster are entried, so the check reads every backticked module name out of every `###`
// heading rather than expecting one heading per file.
test('every module has its own AI_MAP entry, not just a mention', () => {
    const entried = new Set();
    for (const [, heading] of AI_MAP.matchAll(/\n### (.+)/g)) {
        for (const [, mod] of heading.matchAll(/`(?:functions\/)?([A-Za-z0-9_.-]+\.m?js)`/g)) entried.add(mod);
    }
    assert.ok(entried.size > 100, `only ${entried.size} entried modules — the heading scan is wrong`);

    const modules = [
        ...readdirSync(new URL('.', import.meta.url)),
        ...readdirSync(new URL('./functions/', import.meta.url)),
    ].filter(f => f.endsWith('.js') && !f.endsWith('.test.js') && !NOT_ROUTED.has(f));
    assert.ok(modules.length > 100, `only ${modules.length} modules found — the scan is wrong`);

    const noEntry = modules.filter(m => !entried.has(m)).sort();
    assert.deepEqual(noEntry, [],
        'these modules are NAMED in AI_MAP.md but have no entry of their own, so a reader sent ' +
        'there for the full description finds a table row or somebody else\'s paragraph:\n  ' +
        noEntry.join('\n  ') +
        '\nGive each one a `### ` entry, or add it to an existing grouped heading.');
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
const LIVE_DOCS = ['./CLAUDE.md', './docs/AI_MAP.md', './docs/ROADMAP.md', './docs/KNOWN_LIMITATIONS.md',
    // DATA_MODEL.md joined on the day it was split out of CLAUDE.md. Material does not stop being
    // live because it moved to a quieter file, and a schema document is exactly where a hardcoded
    // count would go unread for longest — it is consulted a field at a time, so nobody reads far
    // enough to notice the total is wrong. It passed the rule on arrival, which is the moment to
    // adopt one rather than after it has drifted.
    './docs/DATA_MODEL.md',
    './docs/OPERATIONS_REFERENCE.md', './.claude/rules/links-design.md', './.claude/rules/css-tokens.md',
    // README.md is the only one of these written for somebody who has never seen the repo, which
    // makes it the one most likely to be believed and the least likely to be reread. It joined at
    // v22.32, when it was written to tell an external reviewer which lanes run with nothing
    // installed — a claim that is worthless the moment it is out of date.
    './README.md',
    // THE FEATURE CONTRACTS, added 6 Sep 2026 by the document sweep. They were the docs with the
    // best claim to this guard and the only live ones without it: a contract is nothing but a table
    // of symbol names pointing at module headers, so a rename turns every row into a dead end — and
    // CLAUDE.md's own rule is that "a contract nobody updates is worse than none, because it is
    // believed". They passed on the day they were added, which is the moment to adopt a guard
    // rather than after it has drifted. `ARCHITECTURE.md` joins for the same reason: it is the
    // index, so a name it gets wrong misroutes every reader who starts there.
    './docs/CALENDAR_DATA.md', './docs/AUTH_AND_SESSIONS.md', './docs/ARCHITECTURE.md',
    // DECISIONS.md joined on the day it was split out of ROADMAP.md (8 Sep 2026), for the reason
    // DATA_MODEL.md did: material does not stop being live because it moved to a quieter file, and
    // every line in it was under this guard yesterday as part of ROADMAP.md. A split that silently
    // drops a guard is how the estate loses coverage without anything failing.
    './docs/DECISIONS.md'];

// ── CONTRACT 1c: AI_MAP KNOWS every export — the other direction of 1b ─────────────────────────
//
// 1b catches a doc naming a symbol the code does not have. This catches the opposite and commoner
// failure: code gaining an export the map never hears about. At v21.62 that was **70 exports, 8.6%
// of the surface**, and the distribution was the tell — not one documented export had been deleted,
// so the gap was not carelessness, it was structural. `githooks/pre-commit` computed only REMOVED
// exports, so ADDING one — the common case — passed cleanly every time. The hook now checks both
// directions; this is the backstop for anything that lands without passing through it.
//
// The bar is deliberately LOW: a mention anywhere in AI_MAP.md, not a well-formed entry. A stricter
// test would need to know what a good description looks like, would argue with judgement calls, and
// would be waived. "Can a reader find this name in the map at all?" is mechanical and is the
// question that actually failed.
//
// EXEMPT are the test seams and internal markers that a map SHOULD not carry — each named, so the
// list stays a decision rather than a drift.
const EXPORT_COVERAGE_EXEMPT = new Set([
    '_resetForTest',            // sw-register.js — test seam
    '_triggerAutoOpen',         // calendar-huddle-viewer.js — test seam
    '_setSelectPeriod',         // paycalc-periods.js — test seam
    '_hasStagedEdits',          // admin-week-editor.js — test seam
    '_saveOverrideBatches',     // admin-roster-upload.js — internal, documented by behaviour
]);
test('every root export is findable in AI_MAP', () => {
    const files = readdirSync(new URL('.', import.meta.url))
        .filter(f => /\.js$/.test(f) && !f.includes('.test.') && f !== 'service-worker.js');
    const missing = [];
    for (const f of files) {
        const src = read('./' + f);
        const names = new Set();
        for (const m of src.matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z0-9_$]+)/gm))
            names.add(m[1]);
        for (const m of src.matchAll(/^export\s*\{([^}]*)\}/gm))
            for (const part of m[1].split(',')) {
                const seg = part.trim();
                if (!seg || seg.startsWith('//')) continue;
                const as = seg.match(/\bas\s+([A-Za-z0-9_$]+)/);
                const name = as ? as[1] : seg.split(/\s+/)[0];
                if (name && name !== 'default' && /^[A-Za-z_$]/.test(name)) names.add(name);
            }
        for (const n of names) {
            if (EXPORT_COVERAGE_EXEMPT.has(n)) continue;
            if (!AI_MAP.includes(n)) missing.push(`${f}: ${n}`);
        }
    }
    assert.deepEqual(missing, [],
        `these exports exist and AI_MAP.md has never heard of them:\n  ${missing.join('\n  ')}\n\n`
        + 'Add each to its module\'s entry. If a symbol is genuinely internal (a test seam), name it\n'
        + 'in EXPORT_COVERAGE_EXEMPT with the reason, so the exclusion is a decision and not a gap.');
});

// ── CONTRACT 1b: no live doc NAMES a symbol the code does not have ─────────────────────────────
//
// The v21.17 documentation review found six defects and every one was the same shape: a name or a
// count, restated in prose, describing something that had since moved. Two were identifiers:
//
//   `hadController`   — named in BOTH AI_MAP.md and CLAUDE.md as the service worker's first-install
//                       guard. The real variable is `suppressNextClaim`, and the code comment beside
//                       it explains that keying on the controller alone (which is what the docs
//                       described) was WRONG and fixed at v16.88. So two docs agreed with each other
//                       and disagreed with the code, for thirty releases.
//   `_csReturnFocus`  — AI_MAP described the coming-soon lightbox capturing `document.activeElement`
//                       and restoring it on close. No such function has ever existed; focus actually
//                       returns to the burger.
//
// Neither is catchable by reading, because both sentences are plausible and internally consistent.
// Both are catchable in two seconds by asking whether the string appears in the source at all.
//
// ── IT JUDGES THE SENTENCE, NOT THE NAME ───────────────────────────────────────────────────────
//
// A doc must be able to say "`links-legal.js` until v19.91", "do not add back `initFromRosters`",
// "no `refreshNavIdentity` needed". Those are the docs doing their job. So a name is only a problem
// when the line makes no claim about it being gone — which is judged by the line, and needs no
// exemption list. That distinction is what keeps this guard from acquiring one, and an exemption
// list is how a guard stops guarding (see the note on OWNED_COUNTS below).

/** A line that marks a name as historical, absent or unwanted may name it freely. */
const HISTORICAL = new RegExp([
    'never existed', 'no longer', 'used to', 'was named', 'renamed', 'until v', 'pre-v', 'before v',
    'removed', 'retired', 'dropped', 'deleted', 'do not add back', "don't add back", 'not needed',
    'is not', 'former', 'old ', 'replaced', 'superseded', 'instead of', 'rather than', 'gone',
    'this described', 'has never', 'survived', 'stale', 'no such',
    // "no `X` needed" / "no `X` required" — naming a thing precisely to say it is absent.
    'no `[^`]+` (?:needed|required)',
].join('|'), 'i');

/**
 * Words that look like identifiers and belong to somebody else's vocabulary — a Firebase SDK call,
 * an npm term, a hosting-platform filename.
 *
 * NOT an exemption list, and the difference decides whether this guard survives. An exemption list
 * holds OUR names that the guard would rightly flag, and it grows every time somebody would rather
 * silence the test than fix the doc — which is how a guard stops guarding (see OWNED_COUNTS). This
 * holds names that were never ours to have, so it grows only when the docs start discussing a new
 * third party. If you find yourself adding one of our own symbols here, the doc is wrong.
 */
const EXTERNAL_VOCAB = new Set([
    'getBlob',        // a Firebase Storage SDK call, discussed as an option we did not take
    'devDependency',  // npm
    '_headers',       // the Netlify/Cloudflare convention, named when comparing hosting platforms
    'auth_time',      // a Firebase ID-token claim the server reads; ours to consume, never to define
]);

test('no live doc names a symbol the source does not contain', () => {
    // Every file a doc could legitimately be naming something from.
    const here = new URL('.', import.meta.url);
    const dirs = [['.', /\.(?:js|mjs|css|html|json|rules)$/], ['functions', /\.js$/],
        ['e2e', /\.js$/], ['scripts', /\.mjs$/]];
    let corpus = '';
    for (const [dir, re] of dirs) {
        let names = [];
        try { names = readdirSync(new URL(dir, here)); } catch { continue; }
        for (const n of names.filter(f => re.test(f))) {
            // THIS FILE IS NOT PART OF THE CORPUS, and leaving it in defeated the guard entirely on
            // the first run. The comment above quotes `hadController` and `_csReturnFocus` as the
            // defects that motivated the check — so the moment it was written, both strings existed
            // in the source it searches, and neither could ever be flagged again. Verified by
            // mutation: restoring both original sentences produced zero failures until this line.
            // Any file whose job is to QUOTE names rather than use them belongs out here.
            if (n === 'doc-parity.test.mjs') continue;
            try { corpus += read(`./${dir === '.' ? '' : dir + '/'}${n}`) + '\n'; } catch { /* unreadable */ }
        }
    }

    // camelCase or _private, 5+ chars — long enough to be a real identifier rather than a word.
    const IDENT = /`(_?[a-z][A-Za-z0-9_]{4,})`/g;
    const problems = [];
    for (const doc of LIVE_DOCS) {
        let text;
        try { text = read(doc); } catch { continue; }
        const lines = text.split('\n');
        lines.forEach((line, i) => {
            // The PREVIOUS line counts too. Markdown prose wraps, so "the names ... / survived" puts
            // the marker one line above the identifier — which flagged a correct historical note in
            // links-design.md on the first run.
            const context = `${lines[i - 1] || ''} ${line}`;
            if (HISTORICAL.test(context)) return;
            for (const m of line.matchAll(IDENT)) {
                if (EXTERNAL_VOCAB.has(m[1]) || corpus.includes(m[1])) continue;
                problems.push(`${doc}: \`${m[1]}\` is named as current and appears nowhere in the source`);
            }
        });
    }
    assert.deepEqual(problems, [],
        'a name restated in prose reads perfectly while describing something that moved:\n  '
        + problems.join('\n  '));
});

test('the symbol guard would catch the two defects that motivated it — guard the guard', () => {
    // Without this the test above passes forever if IDENT or HISTORICAL breaks. The fixtures are
    // the real sentences, verbatim from the docs as they stood before v21.17.
    const IDENT = /`(_?[a-z][A-Za-z0-9_]{4,})`/g;
    const shouldFlag = [
        '- **First-install guard (v16.09):** `hadController` is captured before registering; the controllerchange fired by the first install is swallowed.',
        '- **Coming-soon lightbox (v10.69):** `_csReturnFocus` captures `document.activeElement` before opening.',
    ];
    const shouldPass = [
        '| `links-limits.js` | the HARD limits (v19.80; named `links-legal.js` until v19.91) |',
        '**Do not add back** `buildDefaultDesign` — that path was removed at v12.43.',
        'deferred past sign-in so it renders once — no `refreshNavIdentity` needed.',
        'This is also why `minInstances` (a standing cost) is not needed.',
    ];
    for (const line of shouldFlag) {
        assert.ok(!HISTORICAL.test(line), `a live claim must not read as historical: ${line.slice(0, 60)}`);
        assert.ok([...line.matchAll(IDENT)].length > 0, `the identifier pattern must match: ${line.slice(0, 60)}`);
    }
    for (const line of shouldPass) {
        assert.ok(HISTORICAL.test(line), `a historical mention must be allowed: ${line.slice(0, 70)}`);
    }
    // And the vocabulary list stays what it says it is. A name that IS in our source has no business
    // here — it would mean somebody silenced the guard rather than fixing the doc.
    const ours = read('./firebase-client.js') + read('./roster-data.js') + read('./session.js');
    for (const w of EXTERNAL_VOCAB) {
        assert.ok(!new RegExp(`\\b${w}\\b`).test(ours),
            `${w} is one of ours — EXTERNAL_VOCAB is for other people's vocabulary, not an exemption list`);
    }
});

// ── CONTRACT 1e: a symbol is WHERE the doc says it is ──────────────────────────────────────────
//
// 1b asks whether a name exists in the source AT ALL. This asks the neighbouring question — does it
// exist in the FILE the sentence names — and the gap between them is not academic. A line-by-line
// audit of the whole markdown estate (v23.44) found twelve stale claims, and FOUR were this shape.
// Every one of them passed 1b, because the symbol was perfectly real; it had simply moved:
//
//   `HUDDLE_PUSH_PAUSED`     — OPERATIONS_REFERENCE said `functions/index.js`. The v20.55 domain
//                              split moved it to `functions/documents.js`. This is the one that
//                              cost something: it is a BREAK-GLASS instruction for stopping Huddle
//                              pushes, so being wrong costs most at exactly the moment it is read.
//   `RESET_REQUESTS_ENABLED` — PASSWORD_DESIGN, same split, now `functions/auth-endpoints.js`.
//                              Also an incident switch.
//   `pruneOldHuddles`        — DATA_MODEL, same split, now `functions/documents.js`.
//   the Welcome lightbox     — three docs describing a paycalc lightbox retired at v19.36.
//
// ONE refactor produced the first three, and nothing failed. That is the argument for this being a
// gate rather than a habit: a domain split is a normal, well-reviewed change, and it silently
// invalidates every sentence that named the old home. The reviewer of that split had no reason to
// grep the documentation estate, and the docs' own reviewers had no reason to suspect the split.
//
// ── IT READS THE PHRASE, NOT THE LINE ──────────────────────────────────────────────────────────
//
// A location claim is local: "`X` in `y.js`", "`X` is `true` in `y.js`". So the match is a symbol,
// a SHORT gap that crosses no clause boundary, then the filename — and the negation test reads only
// the same clause. Both bounds are load-bearing and both were measured. Judging the whole LINE
// skipped 29 of 65 real claims, because a "never" three clauses away is about something else; and
// letting the gap cross a full stop or an "and" produced two false flags on prose that was correct
// (`NAV_PAGES`. Add name to `CONFIG.LINKS_DESIGNERS` in `roster-data.js` is two separate true
// statements). No exemption list, for the reason 1b gives.
//
// It runs over EVERY markdown file except the ones whose job is the past — wider than LIVE_DOCS,
// which is the point: `RESET_REQUESTS_ENABLED` was in PASSWORD_DESIGN.md, and a plan document is
// where a location claim goes stale longest because nobody reads it end to end.

/**
 * Docs whose subject is the past may name an old home freely — that is what they are for.
 * MEASURED AND NOT LOAD-BEARING TODAY: removing this line changes nothing, because none of
 * them currently names a symbol at a file it has left. It is a statement of SCOPE, kept so a
 * history doc recording "`X` was in `functions/index.js` before the split" cannot be made to
 * fail by writing the truth. Do not read the passing mutation as a reason to delete it.
 */
const PAST_DOCS = /ROADMAP_HISTORY|LOGIN_INCIDENT|docs\/proposals|experiments\//;

/** leading-underscore · lowerCamel with an inner capital · UPPER_SNAKE. */
const LOCATABLE = String.raw`_[A-Za-z][A-Za-z0-9_]{3,}|[a-z][a-z0-9]*[A-Z][A-Za-z0-9_]*|[A-Z][A-Z0-9]*_[A-Z0-9_]+`;
/** A gap that crosses no clause boundary. It may carry one backticked token ("is `true` in"). */
const SAME_CLAUSE = String.raw`[^,;().!?—·|]{0,40}?`;
const LOCATION_CLAIM = new RegExp(
    '`(' + LOCATABLE + ')(?:\\(\\))?`(' + SAME_CLAUSE + ')\\bin `([a-z0-9-]+/)?([A-Za-z0-9._-]+\\.(?:js|mjs|css|rules|json))`', 'g');

/** The same clause saying the symbol is NOT there — a prohibition, an absence, a move. */
const NOT_A_LOCATION_CLAIM = /\b(never|not|no|don't|cannot|can't|nothing|instead|rather|without|moved|used to|removed|retired|unlike)\b/i;

/** Where a bare filename in a doc could live. */
const SOURCE_ROOTS = ['', 'functions/', 'e2e/', 'scripts/', 'test-fixtures/'];

/** Every markdown file that is not about the past. */
function locatableDocs(dir = '.', out = []) {
    const here = new URL('.', import.meta.url);
    let entries = [];
    try { entries = readdirSync(new URL(dir, here), { withFileTypes: true }); } catch { return out; }
    for (const e of entries) {
        if (e.name === 'node_modules' || e.name === '.git') continue;
        const p = dir === '.' ? e.name : `${dir}/${e.name}`;
        if (e.isDirectory()) locatableDocs(p, out);
        else if (e.name.endsWith('.md') && !PAST_DOCS.test(p)) out.push(p);
    }
    return out;
}

/**
 * Every location claim a doc makes, as {doc, line, sym, path} — or null where the sentence does not
 * claim a location, or names a file this repo does not have (another project's, an illustration).
 */
function locationClaims(/** @type {string} */ doc, /** @type {string} */ text) {
    const out = [];
    text.split('\n').forEach((line, i) => {
        for (const m of line.matchAll(LOCATION_CLAIM)) {
            const [, sym, gap, dir, file] = m;
            if (/\b(and|or|but)\b/i.test(gap)) continue;          // the name binds to the other clause
            const lead = line.slice(Math.max(0, m.index - 34), m.index).split(/[.!?—·|]/).pop();
            if (NOT_A_LOCATION_CLAIM.test(lead + gap)) continue;
            let path = null;
            if (dir) { if (existsSync(new URL(dir + file, import.meta.url))) path = dir + file; }
            else for (const r of SOURCE_ROOTS) {
                if (existsSync(new URL(r + file, import.meta.url))) { path = r + file; break; }
            }
            if (path) out.push({ doc, line: i + 1, sym, path });
        }
    });
    return out;
}

test('a symbol is in the file the doc says it is in', () => {
    const problems = [];
    for (const doc of locatableDocs()) {
        let text;
        try { text = read('./' + doc); } catch { continue; }
        for (const c of locationClaims(doc, text)) {
            if (read('./' + c.path).includes(c.sym)) continue;
            problems.push(`${c.doc}:${c.line}  \`${c.sym}\` is named as living in ${c.path} — it is not there`);
        }
    }
    assert.deepEqual(problems, [],
        'one refactor moves a symbol and every sentence naming its old home is quietly wrong:\n  '
        + problems.join('\n  '));
});

test('the location guard catches the domain-split defects that motivated it — guard the guard', () => {
    // Verbatim from the three docs as they stood before v23.44. Without this the test above passes
    // for ever if LOCATION_CLAIM stops matching — and its first cut DID: `()` inside the backticks
    // and a backticked word in the gap meant it caught none of the three it was written for.
    const shipped = [
        ['docs/OPERATIONS_REFERENCE.md', '**Push notifications paused?** If `HUDDLE_PUSH_PAUSED` is `true` in `functions/index.js`, Huddle ingestion succeeds but no push is sent.'],
        ['docs/DATA_MODEL.md', 'Auto-prunes: docs older than **3 months** (Firestore doc + Storage file) are deleted by `pruneOldHuddles()` in `functions/index.js`, awaited at the end of every `ingestHuddle` run.'],
        ['docs/PASSWORD_DESIGN.md', 'the public function stayed callable. `RESET_REQUESTS_ENABLED` in `functions/index.js` now closes it with a 503.'],
    ];
    for (const [doc, line] of shipped) {
        const claims = locationClaims(doc, line);
        assert.equal(claims.length, 1, `the shipped defect must be read as one location claim: ${line.slice(0, 70)}`);
        assert.equal(claims[0].path, 'functions/index.js');
        assert.ok(!read('./functions/index.js').includes(claims[0].sym),
            `${claims[0].sym} has returned to index.js — re-point this fixture at a defect that is still a defect`);
    }

    // And the sentences that must NOT be read as location claims. Each is real prose from the docs
    // that an earlier cut of this guard flagged, and each fails for a different reason.
    const notClaims = [
        // a PROHIBITION — the symbol is named precisely because it must not be there
        ['CLAUDE.md', '**Never call `localStorage` directly** in `calendar-app.js`, `admin-app.js`, or `paycalc-app.js`.'],
        // a CONJUNCTION — the name belongs to the first clause, the file to the second
        ['docs/AI_MAP.md', 'single source for paycalc `numVal()` and the HPP rate read in `paycalc-hpp.js`'],
        // a SENTENCE BOUNDARY — two true statements, read as one false one
        ['CLAUDE.md', '`linksDesignerOnly: true` in `NAV_PAGES`. Add name to `CONFIG.LINKS_DESIGNERS` in `roster-data.js` to grant access'],
    ];
    for (const [doc, line] of notClaims) {
        const bad = locationClaims(doc, line).filter(c => !read('./' + c.path).includes(c.sym));
        assert.deepEqual(bad, [], `correct prose must not be flagged: ${line.slice(0, 72)}`);
    }

    // The guard must actually be looking at something. A pattern that silently stops matching reads
    // exactly like a clean estate — the failure mode this whole file exists to close.
    let total = 0;
    for (const doc of locatableDocs()) {
        try { total += locationClaims(doc, read('./' + doc)).length; } catch { /* unreadable */ }
    }
    assert.ok(total > 50, `only ${total} location claims found — the pattern has stopped reading the docs`);
});

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

test('every command README.md tells a reviewer to run actually exists', () => {
    // README.md's whole purpose is to hand a stranger a command that works first time. A command
    // that has been renamed makes the page worse than absent: it reads as authoritative, fails,
    // and confirms the belief it was written to correct — that this repo cannot be run without a
    // full install. Nothing else checks it, because npm scripts are strings and prose is prose.
    const readme = read('./README.md');
    const pkg = JSON.parse(read('./package.json'));
    const problems = [];

    const scripts = [...readme.matchAll(/`?\bnpm run ([a-z0-9:]+)/g)].map(m => m[1]);
    for (const s of new Set(scripts)) {
        if (!(s in (pkg.scripts ?? {}))) problems.push(`npm run ${s} — no such script in package.json`);
    }
    // `npm test` is the headline claim of the page; it is a script too.
    if (/`npm test`|npm test\b/.test(readme) && !('test' in (pkg.scripts ?? {}))) {
        problems.push('npm test — no such script in package.json');
    }
    const files = [...readme.matchAll(/`?\bnode (scripts\/[\w.-]+)/g)].map(m => m[1]);
    for (const f of new Set(files)) {
        if (!existsSync(new URL('./' + f, import.meta.url))) problems.push(`node ${f} — no such file`);
    }
    assert.deepEqual(problems, [],
        'README.md names a command that does not exist:\n  ' + problems.join('\n  '));
});

test('and the README command reader still finds them — guard the guard', () => {
    // If the extraction above silently stopped matching, the contract would pass for ever while
    // the page rotted. Pin that it sees the two commands the page is built around.
    const readme = read('./README.md');
    const found = [...readme.matchAll(/`?\bnpm run ([a-z0-9:]+)/g)].map(m => m[1]);
    assert.ok(found.length >= 3, `only ${found.length} npm scripts read out of README.md`);
    assert.match(readme, /node scripts\/test-nodeps\.mjs/,
        'the no-install lane is the point of the page — if it is gone, so is the reason for it');
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
//   · no single entry may exceed the cap below. Past that it has stopped being a pointer.
//
// THE CAP IS A RATCHET, AND IT CAME DOWN ON 2 Sep 2026 (1,600 -> 900). 1,600 was set when the tree
// was being rescued from 136k characters, and it did its job — but it was so far above the tree's
// own behaviour that only SIX entries ever touched it, so in practice it enforced nothing while
// reading as though it did. An external review then measured what that permitted: 361 entries,
// 155,386 characters, 52% of a file loaded into EVERY session, with 113,742 of those characters
// sitting in entries over 400 when routing needs about 80.
//
// Thirty-seven entries were rewritten as routing lines. Every one was checked first against its own
// module header — the v20.11 discipline, that reasoning moves BEFORE the pointer is cut — and the
// five whose reasoning was NOT already beside the code were handled separately rather than trimmed
// blind. The measurement that sorted them took three attempts and got it wrong twice, in opposite
// directions; the working version is in the commit message.
//
// 900 is deliberately just above the largest survivor, not a round number: a cap with slack is a
// cap nobody meets. Shrinking an entry is free. RAISING this number is a decision somebody makes
// and defends, exactly like `coordinator-ratchet.test.mjs`. The next pass should bring it to ~600.
const TREE_ENTRY_CAP = 900;
//   · the tree may not accumulate release history. A handful of version stamps is fine (they date
//     a decision); dozens means the changelog has moved back in.
test('the CLAUDE.md file tree stays a routing table', () => {
    const tree = (FILE_INDEX.match(/```[\s\S]*?```/) || [''])[0];
    assert.ok(tree.length > 10_000, 'the file tree was not found — this test is checking nothing');

    const entries = tree.split('\n').filter(l => /^[│├└]/.test(l) && l.includes('←'));
    assert.ok(entries.length > 150, `expected >150 routed entries, found ${entries.length}`);

    const tooLong = entries
        .filter(l => l.length > TREE_ENTRY_CAP)
        .map(l => `${l.replace(/^[│├└─\s]+/, '').split('←')[0].trim()} (${l.length} chars)`);
    assert.deepEqual(tooLong, [],
        'these entries have stopped being pointers. Move the reasoning into the module header and ' +
        'leave a routing line:\n  ' + tooLong.join('\n  '));

    // ONE ENTRY PER FILE. A tree is a routing table, and a table with two rows for one file sends
    // a reader to two different descriptions of it — which is exactly what happened: two sessions
    // running in parallel each documented `select-sheet-parity.test.mjs` when they added it, both
    // squash-merged, and CLAUDE.md carried both rows (v23.38 and v23.40 wording) until v23.45.
    // Nothing could see it — the "every test file is listed" contract below is satisfied MORE than
    // once, and a duplicate reads as a normal entry unless you are looking for it. This is the
    // parallel-session failure mode that survives a green suite, so it is checked rather than
    // remembered.
    const names = entries
        .map(l => l.replace(/^[│├└─\s]+/, '').split('←')[0].trim())
        .filter(n => n && !n.endsWith('/'));          // a directory may legitimately recur
    const seen = new Map();
    for (const n of names) seen.set(n, (seen.get(n) || 0) + 1);
    const doubled = [...seen].filter(([, c]) => c > 1).map(([n, c]) => `${n} (${c} entries)`);
    assert.deepEqual(doubled, [],
        'these files are routed more than once. Merge them into a single entry — two rows for one ' +
        'file is two descriptions that will drift:\n  ' + doubled.join('\n  '));

    const stamps = (tree.match(/v\d+\.\d+/g) || []).length;
    assert.ok(stamps < 90,
        `the tree carries ${stamps} version references — it was 208 before v20.11, which is a ` +
        'changelog living in a routing table, loaded into every session. Release history belongs ' +
        'in git and the plan docs.');
});

// ── CONTRACT 3b: the ARCHITECTURE TABLE is held to the tree's own limits ───────────────────────
//
// The v20.11 sweep proved the "routing, not changelog" rule works, then guarded ONLY the tree — and
// the pressure went next door. Measured at v21.62: the tree was 44% of CLAUDE.md and carried 89
// version references under a cap of 90; the architecture table, a quarter of its size, carried 96
// under no cap at all, with rows of 5,100 and 3,379 characters — three and two times the limit the
// tree enforces on itself, in the same always-loaded file, at the same cost per session.
//
// The 5,100-char row was the tell: it restated EIGHT invariants that `CALENDAR_DATA.md` (3/4/11/12)
// and `AUTH_AND_SESSIONS.md` (7–10) were written to own, both of which open by saying other
// documents must link here rather than repeat. A contract nobody routes to is a contract that gets
// restated, and a restatement is what drifts.
//
// Same two limits as CONTRACT 3, for the same reason. A row may stay long enough to state a
// decision; past ~1,600 characters it has stopped being a decision and become a retrospective, and
// the argument belongs in the module header where an editor is already looking.
test('the CLAUDE.md architecture table states decisions, not retrospectives', () => {
    const lines = CLAUDE.split('\n');
    const start = lines.findIndex(l => l.includes('Architecture decisions — never change'));
    assert.ok(start > 0, 'the architecture table was not found — this test is checking nothing');
    const end = lines.findIndex((l, i) => i > start + 3 && l.startsWith('## '));
    const rows = lines.slice(start, end).filter(l => l.startsWith('|'));
    assert.ok(rows.length > 40, `expected the full table, found ${rows.length} rows`);

    const tooLong = rows
        .filter(l => l.length > 1600)
        .map(l => `${(l.split('|')[1] || '').replace(/\*/g, '').trim().slice(0, 60)} (${l.length} chars)`);
    assert.deepEqual(tooLong, [],
        'these rows have stopped stating a decision and become design retrospectives. Move the\n' +
        'reasoning into the module header (that is what the v20.11 tree sweep did) and leave the\n' +
        'rule:\n  ' + tooLong.join('\n  '));

    const stamps = (rows.join('\n').match(/v\d+\.\d+/g) || []).length;
    assert.ok(stamps < 105,
        `the architecture table carries ${stamps} version references. A handful date a decision; ` +
        'this many is a changelog living in a rules table, loaded into every session. Release ' +
        'history belongs in git and the plan docs.');
});

// ── CONTRACT 3bb: CLAUDE.md has a TOTAL size, and nothing was bounding it ──────────────────────
//
// Contracts 3 and 3b cap what any ONE entry or row may cost. Neither caps what the FILE costs, and
// the file is loaded into every session regardless of the task — so total size is the number that
// actually converts into a bill, and it was the only one nobody was watching.
//
// Measured 11 Sep 2026, and the tree is the demonstration. The v20.11 sweep rescued it from 136k
// characters (54% of the file) and left a per-entry cap to hold it there. Every entry has obeyed
// that cap ever since; not one is over 900. The tree is now 185k characters and 59% of the file.
// It grew 36% under a rule that was working exactly as written, because a per-entry cap does not
// bound a file that keeps gaining entries — 416 of them now.
//
// The same pass also shows what per-entry caps do instead of restraining: they become targets. At
// the time of writing the five longest tree entries are 887, 885, 884, 882 and 881 against a cap of
// 900, and the longest architecture row is 1,594 against 1,600 — six characters of headroom. Both
// sections are packed against their ceilings, which is the coordinator-ratchet pathology one
// document up, and is why the answer here is a RATCHET rather than a limit.
//
// So: a ceiling on the whole file, set just above where it stands, in the spirit of
// `coordinator-ratchet.test.mjs` — room for an edit that is not a new section, and no more.
// Shrinking CLAUDE.md is free and always will be. RAISING this number is a decision somebody makes
// and defends in the commit that raises it, and the defence has to answer the question the ratchet
// exists to ask: what did a reader gain, on every task, for the cost they now pay on every task?
//
// The remedy when it fails is never to trim prose evenly. It is the v20.11 discipline: find the
// reasoning that has drifted back in from a module header, move it BACK beside the code, and leave
// the pointer. That is what worked last time, and it is the only edit that reduces the total
// without losing anything.
// 140,000 since the catalogue left for `docs/FILE_INDEX.md` on 11 Sep 2026 (was 320,000 against a
// 312,675 file). The external review's objection to the first version of this cap was exactly right:
// a ratchet set just above the current size prevents deterioration and preserves the problem for
// ever. The catalogue was ~200k of that, it is a LOOKUP TABLE rather than something read top to
// bottom, and no session needs all ~430 entries to do one task. CLAUDE.md is now ~128k; this leaves
// room for a section, not for another catalogue. The same rules apply: shrinking is free, raising is
// a decision defended in the commit that raises it.
const CLAUDE_MD_CAP = 140_000;
test('CLAUDE.md stays affordable — it is loaded into every session', () => {
    const chars = CLAUDE.length;
    assert.ok(chars > 100_000, 'CLAUDE.md was not read — this test is checking nothing');
    assert.ok(chars <= CLAUDE_MD_CAP,
        `CLAUDE.md is ${chars.toLocaleString()} characters, over the ${CLAUDE_MD_CAP.toLocaleString()} ratchet.\n` +
        'This file is loaded into EVERY session, so this is a cost paid on every task regardless of\n' +
        'relevance. Do not trim evenly: find reasoning that has drifted back in from a module header,\n' +
        'move it back beside the code, and leave the routing line (the v20.11 discipline). If the\n' +
        'growth is genuinely new routing, raise the ratchet IN THE SAME COMMIT and say in the message\n' +
        'what a reader gains on every task for what they now pay on every task.');
});

// ── CONTRACT 3c: the repo-derived counts are COUNTED, never written down ────────────────────────
//
// `OWNED_COUNTS` guards counts a CONSTANT owns. These are different: nobody declares them anywhere,
// they grow silently with the repo, and the one place they appear is the "when a build step earns
// its keep" row — whose entire purpose is to hold the threshold for the bundler decision.
//
// At v21.62 every figure in that row was wrong: 5 boot shims (6), "~35" preload entries (47 and
// 52), "~110" precache (162), "~70" `@ts-check` files (124), "~70" modules (127). Two were out by
// ~80%, and every one understated the cost — i.e. all in the direction that makes the no-build
// trade look cheaper than it is. A threshold row nobody re-measures decays toward the day it was
// written, and that is exactly the row where being wrong changes an architectural decision.
//
// So the row now states no figures and this test derives them. If a future reader wants the
// numbers, the assertion message below prints them, current.
test('no doc writes down a repo-derived count that grows with the repo', () => {
    const root = readdirSync(new URL('.', import.meta.url));
    const js = root.filter(f => /\.js$/.test(f) && !f.includes('.test.'));
    const sw = read('./service-worker.js');
    const listLen = (name) => {
        const block = (sw.match(new RegExp(`${name} = \\[([\\s\\S]*?)\\];`)) || ['', ''])[1];
        return (block.match(/"\.\//g) || []).length;
    };
    const actual = {
        bootShims:  root.filter(f => /-boot\.js$/.test(f)).length,
        precache:   ['CORE_ASSETS', 'SUPPLEMENTARY_ASSETS', 'FONT_ASSETS', 'ICON_ASSETS']
            .reduce((n, name) => n + listLen(name), 0),
        modules:    js.length,
        tsChecked:  js.filter(f => read('./' + f).includes('@ts-check')).length,
    };
    // Guard the guard: a derivation that silently returned 0 would make this test vacuous.
    for (const [k, v] of Object.entries(actual)) assert.ok(v > 0, `${k} derived as ${v} — the counter is broken`);

    // The build-threshold row may describe the COST, but may not state its SIZE.
    const row = CLAUDE.split('\n').find(l => l.includes('When a build step earns its keep')) || '';
    assert.ok(row, 'the build-threshold row was not found — this test is checking nothing');
    const figures = row.match(/[~]?\d{2,4}(?=[- ]?(?:entry|entries|files?|modules?|shims?|KB))/g) || [];
    assert.deepEqual(figures, [],
        `the build-threshold row states ${figures.join(', ')} — these grow with the repo and were ` +
        'all wrong at v21.62. Let this test derive them instead. Current values: ' +
        JSON.stringify(actual));
});

// ── CONTRACT 3d: a doc may not write down the SIZE of a roster-owned list ──────────────────────
//
// Found by a line-by-line read on 28 Aug 2026, twelve days after `N. Sobers` was added as a seventh
// manager. Nine sentences across `SECURITY_RELEASE_PLAN.md` and `KNOWN_LIMITATIONS.md` still said
// six, and two derived figures moved with them ("7 of the 50 active accounts", "7 people opening
// Settings → Password"). One of those sentences is the C5 chase-list — "chase the 6 managers
// directly" — so a milestone built from it would have reported complete with a privileged account
// still on the surname default.
//
// Nothing caught it. `roster-members.json` is CI-locked against `roster-data.js`, so the CODE could
// not drift; the prose is what drifted, and prose is what a person acts on. CONTRACT 3c guards the
// counts that grow with the REPO; this guards the ones that grow with the ROSTER, which move for a
// different reason (somebody was promoted) and are read by somebody doing an access review.
//
// Narrow on purpose, matching this file's own rule about guards that cry wolf: only the phrasings
// that actually appeared, and only where the number is the size of a list this repo declares.
test('no doc writes down the size of a roster-owned list', () => {
    const members = JSON.parse(read('./functions/roster-members.json'));
    const actual = {
        manager:  members.roles.manager.length,
        admin:    members.roles.admin.length,
        designer: members.roles.designer.length,
        active:   members.activeMembers.length,
        served:   readdirSync(new URL('.', import.meta.url)).filter(f => /\.html$/.test(f)).length,
    };
    for (const [k, v] of Object.entries(actual)) assert.ok(v > 0, `${k} derived as ${v} — the counter is broken`);
    actual.privileged = actual.admin + actual.manager;

    /** [regex, the key it must equal, what the number is]. Capture group 1 is the figure. */
    const CLAIMS = [
        [/(\d+)\s+managers\b/gi,                                   'manager',    'the manager tier'],
        [/(\d+)\s+management accounts\b/gi,                        'manager',    'the manager tier'],
        [/MANAGER_NAMES`?\s*\((\d+)\s+names\)/gi,                'manager',    'the manager tier'],
        [/(\d+)\s+PRIVILEGED accounts\b/gi,                        'privileged', 'admin + managers'],
        [/concentrated in (\d+) of the \d+ active accounts/gi,      'privileged', 'admin + managers'],
        [/concentrated in \d+ of the (\d+) active accounts/gi,      'active',     'the active roster'],
        [/all (?:ten|eleven|twelve|\d+) served pages/gi,             'served',     'the served HTML pages'],
        [/all (?:ten|eleven|twelve|\d+) `<meta>` CSPs/gi,            'served',     'the served HTML pages'],
    ];
    const WORD = { ten: 10, eleven: 11, twelve: 12 };
    const wrong = [];
    for (const doc of ['./CLAUDE.md', './docs/AI_MAP.md', './docs/KNOWN_LIMITATIONS.md', './docs/OPERATIONS_REFERENCE.md',
                       './docs/SECURITY_RELEASE_PLAN.md', './docs/AUTH_PLAN.md', './docs/PASSWORD_DESIGN.md',
                       './docs/ARCHITECTURE.md', './.claude/rules/paycalc.md']) {
        const lines = read(doc).split('\n');
        lines.forEach((line, i) => {
            for (const [re, key, what] of CLAIMS) {
                for (const m of line.matchAll(re)) {
                    const said = WORD[(m[1] || m[0].match(/ten|eleven|twelve/i)?.[0] || '').toLowerCase()]
                        ?? Number(m[1] ?? (m[0].match(/\d+/) || [])[0]);
                    if (!Number.isFinite(said) || said === actual[key]) continue;
                    wrong.push(`${doc.replace('./', '')}:${i + 1} says ${said} for ${what} — it is ${actual[key]}`);
                }
            }
        });
    }
    assert.deepEqual(wrong, [],
        'a doc states the size of a list this repo declares, and the list has moved:\n  ' +
        wrong.join('\n  ') +
        '\nThese are read by somebody doing an access review or working a chase-list. Derive the ' +
        'number or drop it; do not re-write it.');
});

// ── CONTRACT 5: the register IDs resolve, and the index knows every document ────────────────────
//
// v21.38 introduced two stable ID spaces so that a doubt is WRITTEN DOWN ONCE and cited everywhere
// else — `VAL-*` in VALIDATION_REGISTER.md (the app asserts this on unchecked evidence) and `EXC-*`
// in ARCHITECTURE.md §3 (deployed differs from documented target). The whole value of an ID is that
// it resolves. A citation of `VAL-PAY-007` that matches nothing is strictly worse than the paragraph
// it replaced, because it LOOKS like a reference and reads as authoritative.
//
// The failure is silent in both directions and neither is visible while reading: a row can be closed
// and deleted while three documents still point at it, and an ID can be duplicated in two families
// so that "see VAL-OT-001" is ambiguous. Nothing about either shows up in prose.
//
// The index gets the same treatment for the same reason — a routing table that has fallen behind
// routes you nowhere, and its silence is indistinguishable from success. Its doc list is derived
// from the FILESYSTEM here rather than from a hand list, because a hand-maintained checker of a
// hand-maintained index is two lists that can drift together.

const REGISTER = read('./docs/VALIDATION_REGISTER.md');
const INDEX = read('./docs/ARCHITECTURE.md');

/** Docs that are deliberately not in the index: the index itself, and the two the repo generates. */
const INDEX_EXEMPT = new Set(['ARCHITECTURE.md']);

const declaredIds = (/** @type {string} */ src, /** @type {RegExp} */ re) =>
    [...src.matchAll(re)].map(m => m[1]);

test('every VAL-* and EXC-* id cited anywhere resolves to a declared row', () => {
    // Declared = the row's own leading cell in its register, `| **VAL-PAY-001** |`.
    const declared = new Set([
        ...declaredIds(REGISTER, /\|\s*\*\*(VAL-[A-Z]+-\d{3})\*\*\s*\|/g),
        ...declaredIds(INDEX, /\|\s*\*\*(EXC-\d{3})\*\*\s*\|/g),
    ]);
    assert.ok(declared.size >= 10,
        `only ${declared.size} ids declared — the row pattern has changed and this test is ` +
        'checking nothing');

    const docs = [...LIVE_DOCS, './docs/VALIDATION_REGISTER.md', './docs/ARCHITECTURE.md',
        './docs/MAINTENANCE_CALENDAR.md', './docs/AUTH_AND_SESSIONS.md', './docs/CALENDAR_DATA.md',
        './docs/OVERTIME_AVAILABILITY.md', './.claude/rules/paycalc.md'];

    /** @type {string[]} */ const dangling = [];
    for (const doc of docs) {
        for (const [, id] of read(doc).matchAll(/\b((?:VAL-[A-Z]+|EXC)-\d{3})\b/g)) {
            if (!declared.has(id)) dangling.push(`${doc.replace('./', '')} cites ${id}`);
        }
    }
    assert.deepEqual([...new Set(dangling)].sort(), [],
        'these citations resolve to nothing. Either the row was closed and its citations were not ' +
        'followed, or the id was mistyped:\n  ' + [...new Set(dangling)].join('\n  '));
});

test('no id is declared twice — an ambiguous citation is not a citation', () => {
    const all = [
        ...declaredIds(REGISTER, /\|\s*\*\*(VAL-[A-Z]+-\d{3})\*\*\s*\|/g),
        ...declaredIds(INDEX, /\|\s*\*\*(EXC-\d{3})\*\*\s*\|/g),
    ];
    const dupes = all.filter((id, i) => all.indexOf(id) !== i);
    assert.deepEqual([...new Set(dupes)], [],
        `declared more than once: ${[...new Set(dupes)].join(', ')}. Ids are never reused — a ` +
        'closed row keeps its id and moves to Closed.');
});

test('every doc is routed from ARCHITECTURE.md — the index cannot fall behind', () => {
    // Scans `docs/`, where the documentation moved. It scanned the repo ROOT until then, and
    // leaving it there would have been the worst kind of pass: the root now holds README.md and
    // CLAUDE.md alone, both exempt, so the guard would have gone green over an empty list while
    // twenty-four documents went unchecked. The `> 15` floor below is what would have caught it.
    const mdFiles = readdirSync(new URL('./docs/', import.meta.url))
        .filter(f => f.endsWith('.md') && !INDEX_EXEMPT.has(f));
    assert.ok(mdFiles.length > 15, `found only ${mdFiles.length} docs — the scan is wrong`);

    const missing = mdFiles.filter(f => !INDEX.includes(f));
    assert.deepEqual(missing, [],
        'these documents exist and the index does not mention them, so nothing sends a reader to ' +
        'them:\n  ' + missing.join('\n  '));
});

test('the index still carries its exceptions table and its vocabulary — guard the guard', () => {
    // Both are the point of the file. An index that lost either would still pass every test above,
    // because those only check that it NAMES things.
    assert.match(INDEX, /##\s*3\s*·\s*Current production exceptions/,
        'the EXC table is gone — that is the section that says what is actually deployed');
    for (const label of ['CURRENT', 'TEMPORARY', 'VALIDATION', 'DEFERRED']) {
        assert.ok(new RegExp(`\\*\\*${label}\\*\\*`).test(INDEX),
            `the status vocabulary no longer defines ${label}`);
    }
});


// ── AN API EXAMPLE IS A CLAIM ABOUT THE API ────────────────────────────────────────────────────

test('the roster-parse example obeys the week contract it illustrates', () => {
    // OPERATIONS_REFERENCE's `parseRosterPDF` response example stated `weekEnding: "2026-04-05"` —
    // a SUNDAY — over a `dates` array that ran Monday to Saturday and did not end on the stated
    // week ending (v22.39 external review). The validator was right the whole time; the reference
    // material a reader checks their own payload against was not, which is the direction that
    // costs somebody an afternoon.
    //
    // Checked against `buildWeekDates` rather than re-stated here, so the example cannot drift
    // from the builder — the same discipline as every other contract in this file. The helper
    // requires nothing, so this stays in the no-install lane.
    const require = createRequire(import.meta.url);
    const { buildWeekDates } = require('./functions/roster-parse-helpers.js');

    const doc = readFileSync('./docs/OPERATIONS_REFERENCE.md', 'utf8');
    const block = doc.match(/```json\n(\{[\s\S]*?"weekEnding"[\s\S]*?)\n```/);
    assert.ok(block, 'the parseRosterPDF response example has moved or lost its json fence');
    const example = JSON.parse(block[1]);

    assert.deepEqual(example.dates, buildWeekDates(example.weekEnding),
        'the example\u2019s dates are not the seven the builder produces for its own weekEnding');
    assert.equal(new Date(example.weekEnding + 'T12:00:00Z').getUTCDay(), 6,
        `weekEnding ${example.weekEnding} is not a Saturday`);
    for (const date of Object.keys(example.parsed?.[0]?.shifts || {})) {
        assert.ok(example.dates.includes(date), `${date} is not one of the week's own dates`);
    }
});
