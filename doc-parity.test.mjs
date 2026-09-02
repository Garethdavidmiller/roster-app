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
    for (const doc of ['./CLAUDE.md', './AI_MAP.md']) {
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
    const missing = tests.filter(f => !CLAUDE.includes(f));
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
    const missing = specs.filter(f => !CLAUDE.includes(f));
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
    for (const doc of ['./CLAUDE.md', './AI_MAP.md', './KNOWN_LIMITATIONS.md', './OPERATIONS_REFERENCE.md',
                       './SECURITY_RELEASE_PLAN.md', './AUTH_PLAN.md', './PASSWORD_PLAN.md',
                       './ARCHITECTURE.md', './.claude/rules/paycalc.md']) {
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

const REGISTER = read('./VALIDATION_REGISTER.md');
const INDEX = read('./ARCHITECTURE.md');

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

    const docs = [...LIVE_DOCS, './VALIDATION_REGISTER.md', './ARCHITECTURE.md',
        './MAINTENANCE_CALENDAR.md', './AUTH_AND_SESSIONS.md', './CALENDAR_DATA.md',
        './OVERTIME_AVAILABILITY.md', './.claude/rules/paycalc.md'];

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

test('every top-level .md is routed from ARCHITECTURE.md — the index cannot fall behind', () => {
    const mdFiles = readdirSync(new URL('.', import.meta.url))
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
