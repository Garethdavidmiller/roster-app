/**
 * page-contract-parity.test.mjs — a new app page joins EVERY contract, or fails here.
 * Run: node scripts/run-tests.mjs page-contract-parity.test.mjs   (part of `npm run test:hygiene`)
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────────
 *
 * Adding `overtime.html` was the first new app page since the parity suites were written, and it
 * revealed that most of them carry a HAND-MAINTAINED page list:
 *
 *   csp-meta-parity   SERVED_HTML = ['index.html', … ]
 *   card-header-parity PAGES      = ['admin.html', … ]
 *   page-css-parity   PAGES       = { 'admin.html': 'admin.css', … }
 *   tips-content      PAGES       = [ { js, html }, … ]
 *
 * Every one of them went green against the new page — by not looking at it. The page had no
 * mirrored CSP meta check, no card-header check, no borrowed-class check and no tips-shape check,
 * and nothing said so. That is the same defect the deploy workflow had at v20.55, where a
 * hand-listed `node --check functions/index.js functions/roster-parse-helpers.js` stopped covering
 * three modules that arrived after it: **a hand-maintained list quietly stops covering what arrives
 * later, and its silence is indistinguishable from success.**
 *
 * So this file checks the CHECKERS. It enumerates the served app pages from the filesystem — the one
 * source that cannot fall behind — and asserts each is named in every suite that should be reading
 * it, plus the handful of contracts that live in the app's own files rather than in a test.
 *
 * It deliberately does NOT re-implement any of those checks. It asserts they are POINTED at the
 * page; the suites themselves say whether the page passes.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';

const read = (/** @type {string} */ f) => readFileSync(new URL(f, import.meta.url), 'utf8');

// THE PAGE LIST IS scripts/app-pages.mjs (v24.52, external technical-debt review). The three families —
// app pages, the printable guides, the redirect stubs — are declared there, once, and the suites that
// used to keep their own copy now read it. Two things stay HERE: the check that the list matches the
// files on disk (it must not read the list it is checking), and every check of an APP-side list
// (service worker, auth policy, nav, rules, reports, guide back-arrow), which cannot read the list
// because the app has no build step.
import { APP_PAGES as APP_PAGE_ENTRIES, GUIDE_PAGES, REDIRECT_PAGES, servedFiles, cardPageFiles, appPage } from './scripts/app-pages.mjs';
import { admitsStaffPin } from './auth-policy.js';

const GUIDES = new Set(GUIDE_PAGES.map(p => p.file));
const LEGACY_REDIRECTS = new Set(REDIRECT_PAGES.map(p => p.file));
const APP_PAGES = APP_PAGE_ENTRIES.map(p => p.file).sort();

/** index.html is the calendar: a grid, not a stack of cards, and its own special case throughout. */
const CARD_PAGES = cardPageFiles().sort();
/** The id a page goes by in the app's own lists. @param {string} file */
const pageIdOf = (file) => /** @type {any} */ (appPage(file)).id;

/**
 * Does this suite take its pages from scripts/app-pages.mjs — and keep NO copy of its own? (v24.52)
 *
 * Both halves matter. Importing the list proves it is read; the absence of any page filename in the
 * suite's own CODE proves nobody has re-added a hand list beside it, which is how one of these went
 * quietly stale before. Comments are stripped first, because several of these suites explain their
 * history by naming pages in prose.
 * @param {string} suite the suite's source @param {string} helper the export it must use
 */
function readsThePageList(suite, helper) {
    const code = suite.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const imports = new RegExp(`import\\s*\\{[^}]*\\b${helper}\\b[^}]*\\}\\s*from\\s*'(\\.|\\.\\.)/scripts/app-pages\\.mjs'`).test(code);
    // …and USES it, beyond the import line. An import left behind while the list beside it is
    // replaced by `['/']` keeps both halves above true and visits one page (caught by mutation).
    const uses = (code.match(new RegExp(`\\b${helper}\\b`, 'g')) || []).length >= 2;
    const handList = servedFiles().filter(f => code.includes(`'${f}'`) || code.includes(`'/${f}'`));
    return { imports: imports && uses, handList };
}

test('the page list matches the HTML files on disk — in BOTH directions', () => {
    // The one check that must NOT read scripts/app-pages.mjs. Every other suite now takes its pages
    // from that list, so a page left off it would vanish from all of them at once; this is the
    // independent count that catches it, from the one source that cannot fall behind.
    const onDisk = readdirSync(new URL('.', import.meta.url)).filter(f => f.endsWith('.html')).sort();
    const declared = servedFiles().slice().sort();
    assert.deepEqual(onDisk.filter(f => !declared.includes(f)), [],
        'served pages scripts/app-pages.mjs does not declare — add each as an app page, a guide or a redirect');
    assert.deepEqual(declared.filter(f => !onDisk.includes(f)), [],
        'pages scripts/app-pages.mjs declares that do not exist — a rename or a deletion left the entry behind');
    assert.equal(new Set(declared).size, declared.length, 'a page is declared twice');
});

test('each app page\'s declared stylesheet, coordinator and boot shim are real and in use', () => {
    // The list's own facts, verified against the files — or every derived suite inherits a wrong one.
    for (const p of APP_PAGE_ENTRIES) {
        const html = read(`./${p.file}`);
        assert.ok(existsSync(new URL(p.css, import.meta.url)), `${p.file}: ${p.css} does not exist`);
        assert.ok(existsSync(new URL(p.coordinator, import.meta.url)), `${p.file}: ${p.coordinator} does not exist`);
        if (p.boot) {
            assert.ok(html.includes(`src="./${p.boot}"`), `${p.file} does not load its declared boot shim ${p.boot}`);
            assert.ok(read(`./${p.boot}`).includes(p.coordinator), `${p.boot} does not start ${p.coordinator}`);
        } else {
            assert.ok(html.includes(`src="./${p.coordinator}"`), `${p.file} loads no boot shim, so it must load ${p.coordinator} directly`);
        }
        assert.equal(p.cards, p.file !== 'index.html', `${p.file}: only the calendar is not built from cards`);
    }
});

test('the page list itself is not empty or accidentally filtered to nothing', () => {
    // Guard the guard: every assertion below is "X contains Y", all of which pass vacuously over an
    // empty list. The six app pages are calendar, admin, paycalc, operations, settings, links —
    // plus overtime.
    assert.ok(APP_PAGES.length >= 6, `expected at least six app pages, found ${APP_PAGES.join(', ') || 'none'}`);
    assert.ok(APP_PAGES.includes('index.html'), 'the calendar must be in the list');
});

test('every SERVED page is checked by csp-meta-parity', () => {
    // The meta CSP is the ONLY policy the GitHub Pages mirror gets — it cannot serve headers — so a
    // page missing from that suite's list has no CSP there at all. EVERY SERVED PAGE, guides and
    // redirect stubs included: `rangers-guide.html` shipped at v20.05 and was never added to the old
    // hand list. Since v24.52 the suite reads `servedFiles()`, so this asserts it still does.
    const { imports, handList } = readsThePageList(read('./csp-meta-parity.test.mjs'), 'servedFiles');
    assert.ok(imports, 'csp-meta-parity no longer takes its pages from scripts/app-pages.mjs (servedFiles)');
    assert.deepEqual(handList, [], 'csp-meta-parity names pages itself again — read them from the list');
});

test('every card-bearing page is checked by card-header-parity', () => {
    const { imports, handList } = readsThePageList(read('./card-header-parity.test.mjs'), 'cardPageFiles');
    assert.ok(imports, 'card-header-parity no longer takes its pages from scripts/app-pages.mjs (cardPageFiles)');
    assert.deepEqual(handList, [], 'card-header-parity names pages itself again — read them from the list');
});

test('every app page is checked by page-css-parity, against its own stylesheet', () => {
    const { imports, handList } = readsThePageList(read('./page-css-parity.test.mjs'), 'pageStylesheets');
    assert.ok(imports, 'page-css-parity no longer takes its pages from scripts/app-pages.mjs (pageStylesheets)');
    assert.deepEqual(handList, [], 'page-css-parity names pages itself again — read them from the list');
});

test('every page with a Tips panel is checked by tips-content', () => {
    // Scoped to pages that actually HAVE `?` buttons: requiring an entry for a page with no tips
    // would force a fictional one, which is worse than not checking.
    const suite = read('./tips-content.test.mjs');
    const withTips = APP_PAGES.filter(p => read(`./${p}`).includes('btn-card-tips'));
    const missing = withTips.filter(p => !suite.includes(`'${p}'`));
    assert.deepEqual(missing, [], 'pages with Tips panels absent from tips-content\'s PAGES list');
});

test('every app page is scanned by the accessibility gate', () => {
    // axe.spec.js also carries a hand-written page list, and a page missing from it is a page with
    // no a11y gate at all — which no other check would notice.
    const suite = read('./e2e/axe.spec.js');
    // The calendar is reached at the app ROOT (`goto('/')`), not by filename — every other page is
    // visited by name.
    const missing = APP_PAGES.filter(p => p !== 'index.html' && !suite.includes(`/${p}'`));
    assert.deepEqual(missing, [], 'pages never visited by e2e/axe.spec.js');
    assert.match(suite, /goto\('\/'\)/, 'the calendar must still be scanned at the app root');
});

test('every app page is visited by the deployed-CSP proof', () => {
    // `csp-meta-parity` is STATIC — it compares two files. e2e/csp.spec.js is the RUNTIME counterpart:
    // it serves the app from the Firebase Hosting emulator so the real firebase.json header is
    // enforced by Chromium. Its hand list missed `overtime.html` for six releases; since v24.52 it
    // reads scripts/app-pages.mjs, and this asserts it still does.
    // It visits the GUIDES too, and dropping them would leave the import of APP_PAGES standing.
    const suite = read('./e2e/csp.spec.js');
    for (const helper of ['APP_PAGES', 'GUIDE_PAGES']) {
        const { imports } = readsThePageList(suite, helper);
        assert.ok(imports, `e2e/csp.spec.js no longer takes its pages from scripts/app-pages.mjs (${helper})`);
    }
    assert.deepEqual(readsThePageList(suite, 'APP_PAGES').handList, [], 'e2e/csp.spec.js names pages itself again — read them from the list');
});

test('csp-hygiene holds every app page\'s network calls to the CSP', () => {
    // Its hand list never had overtime.html, so that page's origins were never checked (found v24.52).
    const { imports, handList } = readsThePageList(read('./csp-hygiene.test.mjs'), 'APP_PAGES');
    assert.ok(imports, 'csp-hygiene no longer takes its pages from scripts/app-pages.mjs (APP_PAGES)');
    assert.deepEqual(handList, [], 'csp-hygiene names pages itself again — read them from the list');
});

test('no test or script writes out a whole family of pages again', () => {
    // The page list exists so no TEST keeps its own copy. A copy is recognisable: a single array or
    // Set literal naming EVERY guide, or every app page. A deliberate subset (four pages that share
    // one property) is not a copy and is not flagged. Found at v24.52 by this rule's absence: after
    // six suites moved over, four more — and the guide search generator — still spelled the five
    // guides out, and the generator's list was a second source of truth of its own.
    const families = { guides: GUIDE_PAGES.map(p => p.file), 'app pages': APP_PAGE_ENTRIES.map(p => p.file) };
    const root = new URL('.', import.meta.url);
    const files = [
        // Tests and tooling only: the app's OWN lists (service worker, nav, policy) are hand-written by
        // design — no build step — and are checked against the page list by the tests above.
        ...readdirSync(root).filter(f => f.endsWith('.test.mjs')),
        ...readdirSync(new URL('./e2e/', root)).filter(f => f.endsWith('.js')).map(f => `e2e/${f}`),
        ...readdirSync(new URL('./scripts/', root)).filter(f => /\.m?js$/.test(f) && f !== 'app-pages.mjs').map(f => `scripts/${f}`),
    ];
    const offenders = [];
    for (const f of files) {
        const code = read(`./${f}`).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
        for (const lit of code.match(/\[[^[\]]*\]/g) || []) {
            for (const [name, members] of Object.entries(families)) {
                if (members.every(m => lit.includes(`'${m}'`) || lit.includes(`'/${m}'`))) offenders.push(`${f}: ${name}`);
            }
        }
    }
    assert.deepEqual(offenders, [], 'a full page family written out by hand — import it from scripts/app-pages.mjs');
});

test('every app page has at least one visual-regression baseline', () => {
    // The Overtime page shipped with none, and six composition defects reached production together
    // as a result — a duplicate page title, a gold banner, a gold tab slab, an uncoloured header
    // chip, a width 80px off its stated family. Every one was visible in a screenshot and invisible
    // to every other suite, because they check that tokens are USED, never that the right one was
    // chosen. Deliberately "at least one": coverage here is per SURFACE, not per page, so the
    // count is a judgement — but zero never is.
    const suite = read('./e2e/visual.spec.js');
    const missing = APP_PAGES.filter(p => (p === 'index.html'
        ? !/goto\('\/(index\.html)?'\)/.test(suite)
        : !suite.includes(`/${p}'`)));
    assert.deepEqual(missing, [], 'pages with no baseline in e2e/visual.spec.js');
    // Guard the guard: a baseline named in the spec but never generated fails silently on a fresh
    // clone (Playwright writes it and passes), so the committed PNGs are checked too.
    const shots = readdirSync(new URL('./e2e/visual-baselines/', import.meta.url));
    assert.ok(shots.some(f => f.startsWith('overtime-')),
        'no committed Overtime baseline — the spec references one that does not exist on disk');
});

test('every app page carries the noindex meta', () => {
    // Staff-only app. This meta is the only de-index signal the headerless mirror gets.
    const missing = APP_PAGES.filter(p => !/name="robots"[^>]*noindex/.test(read(`./${p}`)));
    assert.deepEqual(missing, [], 'pages without a robots noindex meta');
});

test('every app page opts out of algorithmic dark mode', () => {
    // The app has no dark theme; a force-dark browser inverts the off-white cards and leaves the
    // navy, which is a real staff report rather than a hypothetical.
    const missing = APP_PAGES.filter(p => !/name="color-scheme"[^>]*only light/.test(read(`./${p}`)));
    assert.deepEqual(missing, [], 'pages without `color-scheme: only light`');
});

/**
 * The page's header — the `<header>` holding the burger — and what was open around it. Only the
 * elements that take a header's banner role away are tracked (HTML-AAM: a header inside main, article,
 * aside, nav or section is not the page's banner). Comments are stripped: pages discuss `<main>` in prose.
 * @param {string} html
 */
function pageHeader(html) {
    const src = html.replace(/<!--[\s\S]*?-->/g, ' ');
    /** @type {string[]} */
    const open = [];
    let mainAt = -1;
    /** @type {{ at: number, inside: string[] } | null} */
    let header = null;
    for (const m of src.matchAll(/<(\/?)(main|article|aside|nav|section|header)\b[^>]*>/gi)) {
        const tag = m[2].toLowerCase();
        if (m[1]) { const i = open.lastIndexOf(tag); if (i >= 0) open.splice(i); continue; }
        if (tag === 'main' && mainAt < 0) mainAt = /** @type {number} */ (m.index);
        if (tag === 'header' && src.slice(m.index, src.indexOf('</header>', m.index)).includes('id="navMenuBtn"')) {
            header = { at: /** @type {number} */ (m.index), inside: [...open] };
        }
        open.push(tag);
    }
    return { mainAt, header };
}

test('every app page\'s header is its banner landmark: before <main>, never inside it', () => {
    // CLAUDE.md → "Semantic elements": screen readers depend on the landmarks. Inside <main> the header
    // is no banner, so a screen reader lists none and reads the burger and the page's <h1> as main
    // content. Admin, Operations and Links had it there until the whole-app check (Nov 2026), because
    // `.container` hid it until sign-in and placed it in its grid; their stylesheets do both now.
    for (const page of APP_PAGES) {
        const { mainAt, header } = pageHeader(read(`./${page}`));
        assert.ok(header, `${page}: no <header> holds the burger (#navMenuBtn), so this check measured nothing`);
        assert.ok(mainAt >= 0, `${page}: no <main> element`);
        assert.deepEqual(header.inside, [], `${page}: the header sits inside <${header.inside.join('>, <')}>, so it is ` +
            'not the page\'s banner landmark. Put it before <main>, as settings.html does.');
        assert.ok(header.at < mainAt, `${page}: the header comes after <main>; every page puts it first`);
    }
});

test('every app page loads shared.css and its own stylesheet, and no other page\'s', () => {
    for (const page of APP_PAGES) {
        const html = read(`./${page}`);
        // `./shared.css` or bare `shared.css` — admin.html uses the bare form and the rest do not.
        // A cosmetic inconsistency, not a defect, so the assertion accepts both rather than
        // provoking a churn commit across six pages to satisfy a regex.
        assert.match(html, /href="\.?\/?shared\.css"/, `${page} does not load shared.css`);
        const own = page.replace(/\.html$/, '.css');
        // index.html's stylesheet is index.css; every page follows the same naming.
        assert.match(html, new RegExp(`href="\\.?/?${own.replace('.', '\\.')}"`), `${page} does not load its own ${own}`);
    }
});

test('every app page boots through a shim rather than an inline module', () => {
    // CSP `script-src 'self'` blocks inline module scripts outright, so an inline `init()` does not
    // degrade — the page simply never starts. index.html is the exception: it loads its coordinator
    // directly plus the classic splash watchdog.
    for (const page of CARD_PAGES) {
        const html = read(`./${page}`);
        assert.match(html, /<script type="module" src="\.\/[a-z-]+-boot\.js"><\/script>/,
            `${page} has no *-boot.js bootstrap`);
        assert.equal(/<script type="module">/.test(html), false,
            `${page} carries an inline module script, which CSP blocks`);
    }
});

test('every app page and its assets are registered in the service worker', () => {
    // An unregistered page is not merely un-cached: the offline fallback chain routes by filename,
    // so it would fall through to the calendar's HTML while asking for its own.
    const sw = read('./service-worker.js');
    for (const page of APP_PAGES) {
        assert.ok(sw.includes(`'${page}'`) || sw.includes(`"./${page}"`), `${page} is not in the SW asset lists`);
        const css = page.replace(/\.html$/, '.css');
        assert.ok(sw.includes(`'${css}'`) || sw.includes(`"./${css}"`), `${css} is not in the SW asset lists`);
    }
});

test('every app page has an auth-policy entry, so none falls back to the fail-closed default', () => {
    // `requirePage` fails closed on an unknown page name — safe, but it means a missing entry looks
    // like "admin required" rather than like a mistake, and the page is simply unreachable.
    const policy = read('./auth-policy.js');
    const pageIds = APP_PAGES.map(pageIdOf);
    const missing = pageIds.filter(id => !new RegExp(`^\\s{4}${id}:\\s*\\{`, 'm').test(policy));
    assert.deepEqual(missing, [], 'page ids with no PAGE_POLICIES entry');
});

test('every coordinator that signs a member in also runs the forced set-password step', () => {
    // `login-overlay.js` sets a ONE-SHOT marker on every confirmed sign-in, and `password-force.js`
    // consumes it on the next authorised load of the page that ran it. A coordinator that mounts
    // the sign-in but never runs the step leaves the marker to whichever page the member opens
    // next — or, on the Calendar (which had no login until v23.19), to nobody: the member signs in
    // on the app's front door and is never asked to choose a password. Found at v23.19 by review,
    // when the front door became the place most members sign in.
    const coordinators = APP_PAGE_ENTRIES.map(p => p.coordinator);
    const signsIn = coordinators.filter(f => existsSync(new URL(f, import.meta.url)) && /initLoginOverlay\(/.test(read(f)));
    assert.ok(signsIn.length >= 6, `expected every protected page's coordinator to mount the sign-in; found ${signsIn.length}`);
    const missing = signsIn.filter(f => !/initPasswordForce\(/.test(read(f)));
    assert.deepEqual(missing, [], 'coordinators that sign a member in but never run initPasswordForce');
});

// ── The after-auth wiring: the calls whose failure is INVISIBLE ────────────────────────────────
//
// Three writers run once per page from its coordinator, and all three are fire-and-forget writes to
// Firestore collections whose rules require `request.auth != null`. Called before an identity
// exists, every write is silently rejected — so the ERROR LOG LOOKS HEALTHY BECAUSE IT IS BROKEN,
// the Usage card simply under-reports, and the latency samples thin out. None of those failures
// raises anything, appears in the UI, or turns a test red. CLAUDE.md gives `initErrorReporter` its
// own architecture row saying "never call it bare"; AUTH_AND_SESSIONS.md makes it invariant 13.
//
// NOTHING CHECKED ANY OF IT until this block. Measured, not assumed (16 Sep 2026): deleting
// `initErrorReporter();` from `calendar-app.js` left the whole unit estate green, and every chromium
// test in `e2e/calendar.spec.js` with it. e2e cannot see it — the page renders identically whether
// the reporter is installed or not, which is the entire problem.
//
// So this pins two things: that each coordinator calls all three, and that the call sits INSIDE
// that page's auth barrier rather than at module scope. The second half is what makes it a wiring
// test and not a spelling test — moving the call one line above the barrier keeps the string
// present and breaks the behaviour, which is the shape every defect in this area has taken.
const WIRED_AFTER_AUTH = ['initErrorReporter', 'recordUsage', 'recordPageLatency'];

/**
 * The promise each page hangs that wiring on. Written down per page rather than inferred, because
 * "some promise" is exactly the assertion that would pass on the wrong one — and the pages really
 * do differ. Most use `sessionReady`; the Calendar has no Auth session of its own and uses
 * `calendarAuthReady` (NOT `calendarAccessReady` — they were different instants in the anonymous
 * `open` mode, retired v24.34, where gating on access alone fired the writes into a window with no
 * token: the v20.22 bug. Every grant now holds a real user, so the two coincide, but the write gate
 * is still the promise a writer waits on — calendar-access.js says why).
 *
 * `paycalc.html` is the one `soft` page: it owns its auth chain locally and has no `sessionReady`,
 * so its barrier is the `afterAuth` closure that `ensureNamedSession(...).finally()` invokes. That
 * indirection is checked rather than trusted by the test below, which is the whole reason this
 * entry may name a local closure at all.
 */
/** Declared per page in scripts/app-pages.mjs (`authBarrier`) since v24.52. @type {Record<string, string>} */
const COORDINATOR_AUTH_BARRIER = Object.fromEntries(APP_PAGE_ENTRIES.map(p => [p.file, p.authBarrier]));

const coordinatorFor = (/** @type {string} */ page) => /** @type {any} */ (appPage(page)).coordinator;

/** Blank out comments and strings, preserving every byte offset, so a call named in prose or in a
 *  message string is never mistaken for a call site. */
function codeOnly(/** @type {string} */ src) {
    const out = src.split('');
    let i = 0;
    while (i < src.length) {
        const two = src.slice(i, i + 2);
        if (two === '//') { while (i < src.length && src[i] !== '\n') out[i++] = ' '; continue; }
        if (two === '/*') { const end = src.indexOf('*/', i + 2); const stop = end === -1 ? src.length : end + 2;
            while (i < stop) { if (src[i] !== '\n') out[i] = ' '; i++; } continue; }
        const q = src[i];
        if (q === '"' || q === "'" || q === '`') {
            out[i++] = ' ';
            while (i < src.length && src[i] !== q) { if (src[i] === '\\') { out[i++] = ' '; if (i < src.length) out[i++] = ' '; continue; }
                if (src[i] !== '\n') out[i] = ' '; i++; }
            if (i < src.length) out[i++] = ' ';
            continue;
        }
        i++;
    }
    return out.join('');
}

const CLOSERS = { ')': '(', ']': '[', '}': '{' };

/** The offset of the innermost `{` enclosing `i`, or -1 at module scope. */
function enclosingBrace(/** @type {string} */ src, /** @type {number} */ i) {
    let depth = 0;
    for (let j = i; j >= 0; j--) {
        if (src[j] === '}') depth++;
        else if (src[j] === '{') { if (depth === 0) return j; depth--; }
    }
    return -1;
}

/**
 * The head of the statement that position `i` sits in, walking backwards and skipping balanced
 * bracket groups whole. Skipping is what lets a call in a CHAINED link find its root: Overtime's
 * `recordPageLatency` lives in a `.finally()` several links along from `sessionReady.then(`, and a
 * walk that stopped at the first `}` it met would never reach the barrier that owns the chain.
 */
function statementHead(/** @type {string} */ src, /** @type {number} */ i) {
    let j = i;
    while (j >= 0) {
        const c = src[j];
        if (c in CLOSERS) {
            const open = CLOSERS[/** @type {keyof typeof CLOSERS} */ (c)];
            let depth = 0;
            for (; j >= 0; j--) {
                if (src[j] === c) depth++;
                else if (src[j] === open) { depth--; if (depth === 0) break; }
            }
            j--; continue;
        }
        if (c === ';' || c === '{' || c === '}') break;
        j--;
    }
    return src.slice(j + 1, i + 1);
}

/** Every offset at which `name(` is CALLED (not imported) in already-comment-stripped source. */
function callSites(/** @type {string} */ code, /** @type {string} */ name) {
    /** @type {number[]} */ const hits = [];
    const re = new RegExp(`\\b${name}\\s*\\(`, 'g');
    for (let m; (m = re.exec(code)); ) hits.push(m.index);
    return hits;
}

test('every app page coordinator installs the error reporter and both telemetry writers', () => {
    /** @type {string[]} */ const missing = [];
    for (const page of APP_PAGES) {
        const file = coordinatorFor(page);
        assert.ok(existsSync(new URL(file, import.meta.url)), `${page} has no coordinator ${file}`);
        const code = codeOnly(read(`./${file}`));
        for (const fn of WIRED_AFTER_AUTH) {
            if (!callSites(code, fn).length) missing.push(`${file} never calls ${fn}()`);
        }
    }
    assert.deepEqual(missing, [], 'coordinators missing a fire-and-forget writer whose absence nothing else can detect');
});

test('each after-auth writer runs INSIDE its page\'s auth barrier, never bare', () => {
    // AT LEAST ONE call site per writer must sit inside the barrier — not every one. A second,
    // deliberate call on another path is legitimate and exists today: `paycalc-app.js` records a
    // page view from `_showUnsupportedRole`, the withheld-calculator branch, which is a real view by
    // a real member and should be counted. Requiring EVERY site to be barrier-enclosed would fail on
    // that and invite someone to loosen this test rather than look — the outcome CLAUDE.md warns
    // about. What must never happen is the barrier-enclosed site ceasing to exist.
    /** @type {string[]} */ const bare = [];
    for (const page of APP_PAGES) {
        const file    = coordinatorFor(page);
        const barrier = COORDINATOR_AUTH_BARRIER[/** @type {keyof typeof COORDINATOR_AUTH_BARRIER} */ (page)];
        assert.ok(barrier, `${page} declares no auth barrier — add one to COORDINATOR_AUTH_BARRIER with its reason`);
        const code = codeOnly(read(`./${file}`));
        for (const fn of WIRED_AFTER_AUTH) {
            const inside = callSites(code, fn).some((at) => {
                const brace = enclosingBrace(code, at);
                if (brace === -1) return false;                       // module scope: bare by definition
                return statementHead(code, brace - 1).includes(barrier);
            });
            if (!inside) bare.push(`${file}: ${fn}() never runs inside ${barrier}`);
        }
    }
    assert.deepEqual(bare, [], 'after-auth writers called outside the page\'s auth barrier — every write they make will be rejected by the rules, silently');
});

test('paycalc\'s local barrier is itself driven by the session, not merely named that', () => {
    // The one entry in COORDINATOR_AUTH_BARRIER that names a local closure instead of a shared
    // promise. `afterAuth` is a variable name and a variable name proves nothing, so the indirection
    // is checked here: it must be handed to `ensureNamedSession(...)`. Without this, renaming any
    // arrow function to `afterAuth` would satisfy the test above.
    const code = codeOnly(read('./paycalc-app.js'));
    assert.match(code, /ensureNamedSession\([^)]*\)[\s\S]{0,400}?\.finally\(\s*afterAuth\s*\)/,
        'paycalc-app.js no longer hands afterAuth to ensureNamedSession — the barrier named in COORDINATOR_AUTH_BARRIER is not a barrier');
});

test('every app page has a nav pill, so the drawer is a complete map', () => {
    // The drawer renders the CURRENT page as an inert pill rather than omitting it, which is what
    // keeps the row the same shape everywhere. A page with no entry breaks that on its own surface.
    const nav = read('./nav-panel.js');
    const pageIds = APP_PAGES.map(pageIdOf);
    const missing = pageIds.filter(id => !nav.includes(`id: '${id}'`));
    assert.deepEqual(missing, [], 'page ids with no NAV_PAGES entry');
});

test('the station PIN is asked for where the policy admits it, and nowhere else (v24.84)', () => {
    // `staffPin` in auth-policy.js is the one answer to "where may the station PIN go?", and a
    // coordinator agrees with it in BOTH directions or the answer is a story. Asking where it is not
    // admitted keeps the PIN on a page that may show member data, and that page still shows its own
    // sign-in, so nothing on screen changes; admitting it without asking signs the PIN out on arrival,
    // which is the bug the flag was added to fix. The Calendar is the one page whose PIN gate is its
    // own module (calendar-access.js), not a coordinator asking. And no coordinator may keep the PIN
    // by hand: `preserveCalendarViewer` goes through `holdsStaffPin`, behind the policy.
    /** @type {string[]} */ const problems = [];
    for (const page of APP_PAGES) {
        const file = coordinatorFor(page);
        const id = pageIdOf(page);
        const code = codeOnly(read(`./${file}`));
        const asks = callSites(code, 'holdsStaffPin').length > 0;
        if (/\bpreserveCalendarViewer\b/.test(code)) problems.push(`${file} keeps the PIN by hand — ask holdsStaffPin, behind the policy`);
        if (asks && !admitsStaffPin(id)) problems.push(`${file} asks for the PIN, but auth-policy.js does not admit it on '${id}'`);
        if (asks && !callSites(code, 'admitsStaffPin').length) problems.push(`${file} asks for the PIN without consulting the policy`);
        if (!asks && admitsStaffPin(id) && id !== 'calendar') problems.push(`${file}: the policy admits the PIN on '${id}', but the page never asks — it signs the PIN out`);
    }
    assert.deepEqual(problems, []);
});

test('a role-gated pill is gated from EVERY coordinator, not just its own page', () => {
    // The bug this exists for, found by the owner rather than by this suite. `NAV_PAGES` filters the
    // Overtime pill on an `isOvertimeReviewer` option — and exactly one of the seven coordinators
    // that call `initNavPanel` passed it. Everywhere else it defaulted to false, so the pill showed
    // only on the Overtime page itself: the one page you are already on. The feature was reachable
    // by typing its URL and by nothing else.
    //
    // The test above passes on precisely that code, because a pill EXISTING and a pill being
    // REACHABLE are different claims and it only ever checked the first. That is the same shape as
    // every other defect this suite was written for — a hand-maintained list going green by not
    // being looked at — so the miss belongs here rather than in a comment somewhere.
    const nav = read('./nav-panel.js');
    // Derive the gate names from the filter chain itself, so a fourth gate added later is covered
    // without anyone remembering to extend this list.
    const gates = [...nav.matchAll(/\.filter\(p => !p\.(\w+) \|\| (\w+)\)/g)].map(m => ({ flag: m[1], option: m[2] }));
    assert.ok(gates.length >= 3, `expected the NAV_PAGES gate chain, found ${gates.length}`);

    /**
     * The OPTIONS OBJECT of each `initNavPanel({ … })` call, by brace-matching from the call.
     *
     * Not a file-wide regex. The first cut searched the whole module for `option:` and reported
     * links-app.js as a hole — where `isAdmin` is passed as ES6 property SHORTHAND and is perfectly
     * correct. A guard that cries wolf on valid code gets an exemption list and then stops guarding,
     * which is the failure mode this whole suite exists to avoid.
     */
    const callers = readdirSync(new URL('.', import.meta.url))
        .filter(f => f.endsWith('-app.js'))
        .map(f => ({ file: f, src: read(`./${f}`) }))
        .filter(c => c.src.includes('initNavPanel({'))
        // EVERY call in the file, not the first (7 Nov 2026 review). The Pay Calculator draws its
        // drawer twice — a rare unsupported-role path first, then the one every member gets — and
        // reading only the first left the second unguarded: removing a gate from it stayed green.
        .flatMap(c => optionsObjectsAfter(c.src, 'initNavPanel({').map((opts, i) => ({ file: i ? `${c.file} (call ${i + 1})` : c.file, opts })));
    assert.ok(new Set(callers.map(c => c.file.split(' ')[0])).size >= 7, `expected every page coordinator, found ${callers.length}`);

    // An option that NAMES a policy function must be handed that function's ANSWER (test audit,
    // 7 Nov 2026). Passing the key was all this checked, so `canOpenOvertime: !!member` on Trains — the
    // pill drawn for any signed-in member while Overtime is paused — stayed green, and so would the
    // shorthand `canOpenOvertime,`, which hands over the function itself: always truthy.
    const policyFns = new Set([...read('./auth-policy.js').matchAll(/^export function (\w+)\(/gm)].map(m => m[1]));
    assert.ok(gates.filter(g => policyFns.has(g.option)).length >= 2,
        'no gate option is an auth-policy function any more — the value check below would check nothing');

    /** @type {string[]} */
    const holes = [];
    for (const { flag, option } of gates) {
        // Every coordinator needs the option, not only the gated page's own: ANY page can render the
        // drawer that contains the gated pill, so a coordinator that omits it hides the destination
        // from its own surface.
        assert.ok(nav.includes(`${flag}: true`), `no NAV_PAGES entry uses ${flag}`);
        for (const { file, opts } of callers) {
            // `key:` or bare shorthand `key,` / `key }` — both are passing it.
            if (!new RegExp(`(^|[\\s,{])${option}\\s*[:,}]`).test(opts)) {
                holes.push(`${file} never passes \`${option}\` — the ${flag} pill is invisible there`);
            } else if (policyFns.has(option) && !new RegExp(`(^|[\\s,{])${option}\\s*:\\s*${option}\\(`).test(opts)) {
                holes.push(`${file} passes \`${option}\` without calling \`${option}(…)\` — the ${flag} pill no longer asks the policy`);
            }
        }
    }
    assert.deepEqual(holes, [], `\n  ${holes.join('\n  ')}\n`);
});

test('every app page records its own usage under an id the rules allow', () => {
    // Fire-and-forget writes: an id the rules reject fails SILENTLY, and the Usage card simply
    // under-reports for as long as nobody notices. firestore-contract-parity checks the two lists
    // against each other; this checks that the page is in them at all.
    const rules = read('./firestore.rules');
    const allow = rules.match(/function pvCountIds\(\) \{\s*return \[([\s\S]*?)\];/);
    assert.ok(allow, 'analytics counts allowlist not found');
    for (const page of APP_PAGES) {
        const id = pageIdOf(page);
        assert.ok(allow[1].includes(`'${id}'`), `analytics id '${id}' is not allowed by firestore.rules`);
    }
});

test('every app page has a name and an emoji on the Operations reporting cards', () => {
    // The counter working and the counter being READABLE are two different things, and only the
    // first has ever been checked. `PAGE_META` in operations-reports.js drives BOTH the Usage card
    // and the App Speed card, and both fall back to the raw page id plus a generic 📄 when a page
    // is missing from it — so `overtime` sat lower-case among six title-case names from v20.59 to
    // v20.85.
    //
    // What makes it worth a guard rather than a fix is the DELAY. A new page has almost no traffic,
    // so it sorts to the bottom of a bar chart or off it entirely; the defect only becomes visible
    // once the page is used enough to matter, by which point nobody connects it to the release that
    // added it. Nothing errors, and the number itself is right the whole time.
    const src = read('./operations-reports.js');
    const meta = src.match(/const PAGE_META = \{([\s\S]*?)\n\};/);
    assert.ok(meta, 'PAGE_META not found in operations-reports.js');
    for (const page of APP_PAGES) {
        const id = pageIdOf(page);
        const row = new RegExp(`\\b${id}\\s*:\\s*\\{([^}]*)\\}`).exec(meta[1]);
        assert.ok(row, `'${id}' has no PAGE_META entry — both Operations cards would print the raw id`);
        // An entry with an empty label is the same defect wearing a key, and an empty emoji leaves
        // the row out of step with every other one on a card whose whole idiom is emoji + name.
        assert.match(row[1], /emoji:\s*'[^']+'/, `PAGE_META.${id} has no emoji`);
        assert.match(row[1], /label:\s*'[^']+'/, `PAGE_META.${id} has no label`);
    }
});

/**
 * The `{ … }` argument that follows `marker` in `src`, by balancing braces.
 *
 * Deliberately not a regex: these option objects contain nested arrow functions with their own
 * braces (`onSignOut: () => { … }`), so a lazy `\{[\s\S]*?\}` stops at the first inner close and a
 * greedy one runs to the end of the file. Both give a wrong answer that still LOOKS like an answer.
 * @param {string} src @param {string} marker @param {number} [searchFrom] where to start looking
 */
function optionsObjectAfter(src, marker, searchFrom = 0) {
    const at = src.indexOf(marker, searchFrom);
    if (at === -1) return '';
    let depth = 0;
    const from = at + marker.length - 1;          // the '{' itself
    for (let i = from; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) return src.slice(from, i + 1);
    }
    return src.slice(from);
}

/**
 * Every options object in the file, one per occurrence of `marker` — a coordinator may call
 * `initNavPanel` more than once, and each call draws a drawer somebody sees.
 * @param {string} src @param {string} marker @returns {string[]}
 */
function optionsObjectsAfter(src, marker) {
    /** @type {string[]} */
    const all = [];
    for (let at = src.indexOf(marker); at !== -1; at = src.indexOf(marker, at + marker.length)) {
        all.push(optionsObjectAfter(src, marker, at));
    }
    return all;
}


test("a pill's GATE and the page policy's ROLE agree — in both directions", () => {
    // Two lists answer "may this person use this page": the `NAV_PAGES` gate decides whether the
    // pill is DRAWN, and `PAGE_POLICIES.role` decides whether the page lets them STAY. Nothing has
    // ever checked they say the same thing, and the two ways they can disagree are not equally
    // visible:
    //
    //   pill shown, policy forbids  → the member taps and is bounced. Annoying, and obvious.
    //   pill HIDDEN, policy allows  → the feature is reachable by typing its URL and by nothing
    //                                 else. Silent, and it has already happened once in this app
    //                                 (the Overtime pill, by a different mechanism — see the
    //                                 reachability test above). Nobody reports a page they do not
    //                                 know exists.
    //
    // Deliberately checks the CORRESPONDENCE, not the values: which role maps to which gate is a
    // product decision that changes (Overtime's list collapses at full launch), but "role-gated
    // page ⇔ gated pill" is the invariant underneath it and does not.
    const nav    = read('./nav-panel.js');
    const policy = read('./auth-policy.js');

    // Page ids that carry a role in PAGE_POLICIES — i.e. not every named member may be there.
    const policiesBlock = policy.slice(policy.indexOf('PAGE_POLICIES = Object.freeze({'));
    const roleGated = new Set(
        [...policiesBlock.matchAll(/^\s{4}(\w+):\s*\{[^}]*role:\s*\[/gm)].map(m => m[1]));
    assert.ok(roleGated.size >= 3,
        `expected several role-gated pages in PAGE_POLICIES, found ${[...roleGated]}`);

    // Page ids whose NAV_PAGES entry carries one of the flags the filter chain applies.
    const gateFlags = [...nav.matchAll(/\.filter\(p => !p\.(\w+) \|\| \w+\)/g)].map(m => m[1]);
    assert.ok(gateFlags.length >= 3, `expected the NAV_PAGES gate chain, found ${gateFlags.length}`);
    const navEntries = [...nav.matchAll(/\{\s*id:\s*'(\w+)'[^}]*\}/g)];
    const navIds   = new Set(navEntries.map(m => m[1]));
    const navGated = new Set(navEntries.filter(m => gateFlags.some(f => m[0].includes(`${f}: true`)))
                                       .map(m => m[1]));
    assert.ok(navGated.size >= 3, `expected several gated pills, found ${[...navGated]}`);

    // `guides` and `paycalc` have policies but no pill of their own, so only ids present in BOTH
    // vocabularies are compared — the question is about pages the drawer offers.
    const shown  = [...roleGated].filter(id => navIds.has(id) && !navGated.has(id));
    const hidden = [...navGated].filter(id => !roleGated.has(id));

    assert.deepEqual(shown, [],
        'these pages restrict who may STAY but their pill is offered to everyone, so the member '
        + 'taps it and is bounced: ' + shown.join(', '));
    assert.deepEqual(hidden, [],
        'these pills are hidden from people the page would ADMIT, so the feature is reachable only '
        + 'by typing its URL: ' + hidden.join(', '));
});

test('every app page marks itself USABLE, so the App Speed figure covers all of them', () => {
    /*
     * `markPageReady()` stamps the "usable" milestone the App Speed card reports — the moment the
     * page's own content is on screen, which is the only one of the three timings that describes
     * what a member waits for (the other two, "appears" and "code loaded", are the browser's).
     *
     * It is recorded ONLY by pages that call it, and until v21.71 two never did: paycalc and
     * settings. The card discloses the smaller total honestly, so nothing read as broken — but the
     * omission was the worst possible shape. The pay calculator does the MOST work before it is
     * usable (restore the saved hours, resolve the period, calculate), so the page most likely to
     * feel slow was the one page absent from the measurement of slowness. A staff report of "the
     * calculator is laggy" had no figure that could confirm or deny it.
     *
     * Asserted per COORDINATOR rather than per page, because that is where the call belongs and
     * where a new page would forget it. The import is checked too: a call with no import is a
     * ReferenceError at run time, which on the calendar's path would take the whole boot down.
     */
    const coordinators = readdirSync(new URL('.', import.meta.url))
        .filter(f => f.endsWith('-app.js'))
        .sort();
    assert.ok(coordinators.length >= 7, `expected every page coordinator, found ${coordinators.length}`);

    /** @type {string[]} */
    const missing = [];
    for (const file of coordinators) {
        const src = read(`./${file}`);
        // Comments are stripped first: several coordinators DISCUSS markPageReady in prose next to
        // the call, so a bare substring match would pass on a file that only mentions it.
        const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
        // ARGUMENTS ALLOWED (v21.99). This matched `markPageReady()` with EMPTY parentheses, so the
        // moment the Calendar started passing what served its grid, the guard reported the busiest
        // page in the app as never marking itself usable — a false alarm about the one page the
        // contract most exists for. The property is that the page CALLS it; what it passes is the
        // recorder's business.
        const calls    = /markPageReady\s*\(/.test(code);
        const imported = /import\s*\{[^}]*\bmarkPageReady\b[^}]*\}\s*from\s*'\.\/perf-reporter\.js'/.test(code);
        if (!calls) missing.push(`${file} never calls markPageReady()`);
        else if (!imported) missing.push(`${file} calls markPageReady() without importing it`);
    }
    assert.deepEqual(missing, [], `App Speed "usable" is blind on these pages:\n  ${missing.join('\n  ')}`);
});

test('every app page can be returned to from a guide', () => {
    /**
     * The guides navigate in the SAME TAB (v18.81), so their visible ← is the only way back in an
     * installed iOS PWA — there is no browser chrome. `nav-panel.js` appends `?from=<this page>`
     * and `guide-back.js` retargets the arrow, but only for pages in its ALLOWLIST, and that list
     * is hand-kept.
     *
     * `overtime.html` was missing from it from the day the page shipped (found in the v22.47
     * external review). It had the drawer like every other page, so it sent `?from=overtime.html`
     * and the arrow silently kept its authored default — a reviewer who opened a guide from
     * Overtime was returned to the calendar. NOTHING FAILS on an unrecognised `from`, deliberately:
     * that is what stops a crafted value becoming the back arrow, and it is also what made a
     * legitimate omission invisible.
     *
     * The allowlist cannot be derived at run time without giving up that protection, so it is
     * pinned from out here instead, against the filesystem — the one list that cannot fall behind.
     */
    const back = read('./guide-back.js');
    const listed = new Set([...back.matchAll(/^\s*'([a-z-]+\.html)':\s*\{/gm)].map(m => m[1]));

    assert.ok(listed.size >= 6,
        `guide-back.js DESTINATIONS parsed as ${listed.size} entries — the shape changed and this `
        + 'guard is now reading nothing. Fix the match before trusting it.');

    const unreachable = APP_PAGES.filter(p => !listed.has(p));
    assert.deepEqual(unreachable, [],
        'these pages open guides but a guide cannot return to them — guide-back.js DESTINATIONS is '
        + `missing ${unreachable.join(', ')}. The ← keeps its authored default and lands the reader `
        + 'on a page they were not on.');

    // BOTH DIRECTIONS (3 Sep 2026, external review). The first cut asserted only that every app page is
    // LISTED, which leaves an entry for a page that has since been renamed or deleted sitting there
    // for ever — and this guard exists precisely to stop a hand-kept list drifting from the app.
    // Catching drift in one direction while permitting it in the other is the same defect wearing a
    // test. A stale entry is quieter than a missing one, not harmless: it is dead code that reads as
    // deliberate, and the next person to rename a page has no way to know the old name is still
    // being honoured.
    const orphaned = [...listed].filter(p => !APP_PAGES.includes(p));
    assert.deepEqual(orphaned, [],
        `guide-back.js can return to ${orphaned.join(', ')}, which is not an app page any more. `
        + 'Remove the entry — a destination for a page that no longer exists is a redirect nobody '
        + 'will notice is wrong.');
});

test('every guide has a chip bar, driven by exactly one script, whose chips all lead somewhere (v25.80)', () => {
    /**
     * Since v25.80 all five guides carry the "Jump to section" bar, and nothing else measures a guide's
     * sticky stack: guide-back.js's header-only measurement went with the last guide that had no bar.
     * So a guide without a bar, or with a bar and no script, lands every search result under its
     * header. One script per bar, too: the FIP guide's own script carries the same blocks woven into
     * its finder, and a page loading it AND the shared one would bind every chip twice — two scrolls,
     * two focus moves, two observers writing the margins.
     *
     * And a chip whose target id is missing is not an error anywhere: the script quietly leaves it out
     * of the scrollspy and its click does nothing, so a mistyped id ships as a dead button.
     */
    const OWN_SCRIPT = { 'fip-guide.html': './fip-guide.js' };
    for (const { file } of GUIDE_PAGES) {
        const html = read(`./${file}`);
        const bar = html.match(/<nav class="chip-bar" aria-label="Jump to section">([\s\S]*?)<\/nav>/);
        assert.ok(bar, `${file} has no "Jump to section" chip bar`);

        const scripts = ['./guide-chips.js', ...Object.values(OWN_SCRIPT)]
            .filter(src => html.includes(`<script src="${src}" defer></script>`));
        const expected = OWN_SCRIPT[/** @type {keyof typeof OWN_SCRIPT} */ (file)] ?? './guide-chips.js';
        assert.deepEqual(scripts, [expected],
            `${file} must load exactly one chip-bar script, ${expected}; it loads ${JSON.stringify(scripts)}`);

        const targets = [...bar[1].matchAll(/<button class="chip" type="button" data-target="([^"]+)">/g)].map(m => m[1]);
        const chips = (bar[1].match(/<button\b/g) || []).length;
        assert.ok(targets.length >= 3, `${file}: the chip bar parsed as ${targets.length} chips — read the markup again`);
        assert.equal(targets.length, chips, `${file}: a chip is not a <button class="chip" type="button" data-target>`);
        const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
        const dead = targets.filter(id => !main.includes(`id="${id}"`));
        assert.deepEqual(dead, [], `${file}: these chips lead to no id inside <main>, so tapping them does nothing`);
    }
});

test('a legacy redirect page is a redirect, and points somewhere real', () => {
    /**
     * The category above is an EXEMPTION from the app contract, and an exemption nobody checks
     * becomes an exemption to everything — this repo has written that sentence about the Huddle
     * viewer's lightbox and about hand-maintained page lists. So the redirects owe their own rules.
     *
     * Four of them, and each is the way this file could quietly stop working:
     *   1. it actually redirects, in the HTML — a Firebase 301 would leave the mirror on a 404;
     *   2. the destination EXISTS, so a second rename cannot leave a redirect pointing at nothing;
     *   3. the URL is RELATIVE, or it breaks under the mirror's `/roster-app/` sub-path — the one
     *      origin the file is written for;
     *   4. it stays a stub: no stylesheet links, and nothing that gives it a module graph and an
     *      opinion. The moment one grows those it is an app page wearing an exemption.
     *   5. ONE script, and only the shared one (owner, 10 Nov 2026): `legacy-redirect.js`, which
     *      carries the #fragment and the ?query the meta refresh drops. A classic script, after the
     *      canonical link it reads, so it has run before the page finishes and the refresh fires.
     */
    assert.ok(LEGACY_REDIRECTS.size > 0, 'no legacy redirects declared — drop the category too');

    for (const page of LEGACY_REDIRECTS) {
        const html = read(`./${page}`);

        const refresh = html.match(/<meta\s+http-equiv="refresh"\s+content="0;\s*url=([^"]+)"/i);
        assert.ok(refresh, `${page} has no <meta http-equiv="refresh"> — on the Pages mirror, which `
            + 'serves no redirect rules, this file IS the redirect and it does nothing without it');

        const target = refresh[1];
        assert.match(target, /^\.\//,
            `${page} redirects to "${target}", which is not relative. The mirror serves the app from `
            + 'a /roster-app/ sub-path, so an absolute path lands outside it.');
        assert.ok(existsSync(new URL(target.replace(/^\.\//, './'), import.meta.url)),
            `${page} redirects to ${target}, which does not exist. A rename moved the destination `
            + 'and left the redirect behind — the 404 this file was written to prevent.');

        const canonical = html.match(/<link\s+rel="canonical"\s+href="([^"]+)"/i);
        assert.equal(canonical?.[1], target,
            `${page}'s canonical link must name the same destination as its refresh`);

        const scripts = [...html.matchAll(/<script\b[^>]*>/gi)].map(m => m[0]);
        assert.deepEqual(scripts, ['<script src="./legacy-redirect.js">'],
            `${page} carries ${JSON.stringify(scripts)} — a redirect stub carries exactly one script, the shared ` +
            'legacy-redirect.js, as a classic script (a module would wait for the parse, and the refresh with it)');
        assert.ok(html.indexOf('<script src="./legacy-redirect.js">') > html.indexOf('<link rel="canonical"'),
            `${page} loads legacy-redirect.js before its canonical link, which is where the script reads the ` +
            'destination from — it would find nothing and leave the page to its refresh');
        assert.ok(!/<link[^>]+rel="stylesheet"/i.test(html),
            `${page} links a stylesheet — a redirect stub styles itself inline or not at all`);
    }
});

// ── SIGNING OUT, AND LOSING THE SESSION (page-session.js, v24.52) ──────────────────────────────────
//
// Each coordinator used to assemble these for itself, and three of the differences were defects:
// Admin and Overtime signed out BEFORE asking about unsaved work, only the Pay Calculator guarded
// Back against the back/forward cache, and Overtime never noticed a session revoked mid-visit. The
// routines are now one module; these tests hold every page to it, so the next page cannot be the
// one that hand-rolls a slightly different copy. What the routines DO is page-session.test.mjs.

/** A coordinator's code with comments stripped, so prose about the old way is not mistaken for it. */
const codeOf = (/** @type {string} */ f) => read(`./${f}`).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('every page reloads when Back restores it for a different member', () => {
    const missing = APP_PAGE_ENTRIES.filter(p => !/\breloadIfRestoredForSomeoneElse\(\)/.test(codeOf(p.coordinator)));
    assert.deepEqual(missing.map(p => p.coordinator), [],
        'coordinators that never install page-session.js\'s back/forward-cache guard');
});

test('every page signs out through signOutAndLeave — never a hand-rolled clear-and-navigate', () => {
    for (const p of APP_PAGE_ENTRIES) {
        const code = codeOf(p.coordinator);
        assert.match(code, /onSignOut:[^\n]*signOutAndLeave\(/, `${p.coordinator}: onSignOut must call signOutAndLeave`);
        // Clear-then-navigate is the shape that came back as a hand-rolled sign-out. (Admin's
        // `?logout` escape hatch clears without navigating, and is not a sign-out.)
        assert.doesNotMatch(code, /clearSession\(\);?\s*(window\.)?location\.(href|reload|replace|assign)/,
            `${p.coordinator} clears the session and leaves by hand — use signOutAndLeave`);
    }
});

test('a page with unsaved work warns through warnOnUnload AND asks before a sign-out releases anything', () => {
    // The two go together: the browser's "Leave site?" covers closing the tab, and askBeforeSignOut
    // covers the drawer — which signs out BEFORE the page unloads, so the first alone came too late.
    for (const p of APP_PAGE_ENTRIES) {
        const code = codeOf(p.coordinator);
        assert.doesNotMatch(code, /addEventListener\(\s*'beforeunload'/,
            `${p.coordinator} registers its own beforeunload — use warnOnUnload, which stands down after an answered sign-out`);
        if (/\bwarnOnUnload\(/.test(code)) {
            assert.match(code, /beforeSignOut:[^\n]*askBeforeSignOut\(/,
                `${p.coordinator} tracks unsaved work but signs out without asking about it`);
        }
    }
});

// …AND ASKS BEFORE THE DRAWER OR THE ABOUT PANEL LEAVES (iPhone audit, Nov 2026). `warnOnUnload` is the
// browser's own prompt, and a phone never shows it, so on an iPhone it protects nothing. Overtime called
// it alone, and a half-filled availability form was dropped by any drawer pill or About-panel link
// without a word. A page that tracks unsaved work for the unload prompt asks in the page as well.
// (Links kept an older guard of its own, exempt here by name, until Nov 2026: it navigated by itself on
// "Leave", so the drawer's own handling never ran. It uses the shared one now, and nothing is exempt.)
test('a page that warns on unload also asks before a drawer or About-panel link leaves', () => {
    for (const p of APP_PAGE_ENTRIES) {
        const code = codeOf(p.coordinator);
        if (!/\bwarnOnUnload\(/.test(code)) continue;
        assert.match(code, /\baskBeforeLeavingByDrawer\(/,
            `${p.coordinator} warns on unload but lets the drawer's and the About panel's links leave without asking — call askBeforeLeavingByDrawer with the same isDirty`);
    }
});

test('every page with a named sign-in follows it with guardNamedSession', () => {
    // The Calendar (the staff PIN) and the Pay Calculator (a SOFT policy that never asks for a login)
    // are the two deliberate exceptions — their own headers say why. Everybody else re-asks for a
    // sign-in when their own session cannot be confirmed AND when it goes later.
    const EXEMPT = new Set(['calendar-app.js', 'paycalc-app.js']);
    for (const p of APP_PAGE_ENTRIES) {
        const code = codeOf(p.coordinator);
        assert.doesNotMatch(code, /\bwatchIdentityLoss\(/, `${p.coordinator} watches for session loss itself — use guardNamedSession`);
        if (EXEMPT.has(p.coordinator)) continue;
        assert.match(code, new RegExp(`guardNamedSession\\(\\{\\s*page:\\s*'${p.id}'`),
            `${p.coordinator} never runs guardNamedSession for its own page`);
    }
});

// ── THE CONTENT STARTS BELOW THE iOS STATUS BAR, ON EVERY PAGE (v24.60) ──────────────────────────
// `black-translucent` let the navy run up under the status bar, which recent iOS (reported on the
// iPhone 18 Pro, installed app, Oct 2026) answers with a soft blur along the top edge — and the header
// logo and title sat inside it, so every page's brand drew blurred. `black` makes iOS draw its own
// solid bar and start the page beneath it, clear of the blur. One value on every served page that sets
// it, because a page left on the old value is the one a member reports next.
test('every page asks iOS for a SOLID status bar, never black-translucent', () => {
    const pages = readdirSync(new URL('.', import.meta.url)).filter(f => f.endsWith('.html'));
    const set = pages.filter(f => /apple-mobile-web-app-status-bar-style/.test(read(f)));
    assert.ok(set.length >= 7, `only ${set.length} pages set a status bar style — the app pages are expected to`);
    for (const f of set) {
        const m = read(f).match(/apple-mobile-web-app-status-bar-style"\s+content="([^"]+)"/);
        assert.equal(m?.[1], 'black', `${f}: status bar style is "${m?.[1]}" — black-translucent puts the header under iOS's top-edge blur`);
    }
});

// ── A PAGE iOS MAY RUN FROM THE HOME SCREEN INSTALLS THE APP, NOT ITSELF (iPhone audit, 7 Nov 2026) ──
// `apple-mobile-web-app-capable` lets an iPhone open a page added to the Home Screen as an app of its
// own. The five guides carried it with their own titles ("Quick Guide", "Pay Guide", …) and no
// manifest, and the Staff Guide's install box told iPhone readers to Add to Home Screen from that very
// page — which installed the GUIDE: its own icon and its own storage, signed out, with no roster in
// it. The app's manifest (start_url and scope are the app root) and the app pages' own label make the
// install the app wherever it is made from. Read from every served page, so a new one joins on arrival.
test('every page iOS may run from the Home Screen links the app manifest, under the app\'s label', () => {
    const manifest = JSON.parse(read('./manifest.json'));
    assert.equal(manifest.start_url, './', 'the manifest no longer starts at the app root — an install from a sub-page would open that page');
    assert.equal(manifest.scope, './', 'the manifest no longer covers the whole app');
    const titleOf = (/** @type {string} */ html) => /<meta name="apple-mobile-web-app-title" content="([^"]+)">/.exec(html)?.[1];
    const label = titleOf(read('./index.html'));
    assert.ok(label, 'the Calendar has no home-screen label to compare against');
    const pages = servedFiles().filter(f => /<meta name="apple-mobile-web-app-capable" content="yes">/.test(read(`./${f}`)));
    assert.ok(pages.length >= 14, `only ${pages.length} pages ask to run from the Home Screen — the app pages and the five guides do`);
    for (const f of pages) {
        const html = read(`./${f}`).replace(/<!--[\s\S]*?-->/g, ' ');
        assert.match(html, /<link rel="manifest" href="(\.\/)?manifest\.json">/,
            `${f} may run from the Home Screen but links no manifest — added there, it installs itself as an app of its own`);
        assert.equal(titleOf(html), label, `${f}: its home-screen label is not the app's, so its icon would name a different app`);
    }
});

// ── A NEW PASSWORD IS FILED UNDER SOMEBODY'S NAME (iPhone audit, 7 Nov 2026) ─────────────────────
// A password manager files a password under the username field in the SAME <form>. The sign-in card
// got a real form and a hidden username in Oct 2026 (login-overlay.js); the two places a member
// CHANGES their password — the Settings card and the forced set-password overlay — had neither, so
// iCloud Keychain saved a new password on nobody's name, or offered nothing at all. So: every
// `autocomplete="new-password"` field, in any served page or in markup a module writes, sits inside a
// <form> that also holds an `autocomplete="username"` input. Read from the files, so the next one joins.
// (Whether Keychain then offers to save it is a device check — no browser here has a Keychain.)
test('every new-password field shares a form with a username field', () => {
    const sources = [...servedFiles(), ...readdirSync(new URL('.', import.meta.url))
        .filter(f => f.endsWith('.js') && !f.includes('.test.'))];
    let fields = 0;
    for (const f of sources) {
        const src = (f.endsWith('.js') ? codeOf(f) : read(`./${f}`)).replace(/<!--[\s\S]*?-->/g, ' ');
        // Only the attribute spelling can be checked against its form, so it must be the only one.
        assert.equal((src.match(/new-password/g) || []).length, (src.match(/autocomplete="new-password"/g) || []).length,
            `${f} names new-password some other way (a property, setAttribute) — write it in the markup, where its form can be seen`);
        for (const m of src.matchAll(/autocomplete="new-password"/g)) {
            fields += 1;
            const at = /** @type {number} */ (m.index);
            const open = src.lastIndexOf('<form', at), shut = src.indexOf('</form>', at);
            assert.ok(open > src.lastIndexOf('</form>', at) && shut > at,
                `${f}: a new-password field outside any <form> — a password manager has nothing to file it under`);
            assert.match(src.slice(open, shut), /<input[^>]*autocomplete="username"/,
                `${f}: a new-password field whose form has no username field — saved, it belongs to nobody`);
        }
    }
    assert.ok(fields >= 4, `found ${fields} new-password fields — Settings and the forced overlay have two each`);
});

// ── THE SUB-PAGE HEADER LOGO HAS ONE WIRING (48-hour review, Nov 2026) ───────────────────────────
// `wireHeaderLogo` (about-lightbox.js, v25.06) replaced five hand-written copies, and the copies were
// the defect: Trains and Overtime shipped a "Back to calendar" logo that nothing wired. The December
// link page was written alongside that change and arrived with a sixth. A module reaching for the logo
// itself is how a seventh arrives, so only the helper may; a page that must ask first passes a handler.
test('only about-lightbox.js wires the sub-page header logo', () => {
    const offenders = readdirSync(new URL('.', import.meta.url))
        .filter(f => f.endsWith('.js') && f !== 'about-lightbox.js')
        .filter(f => /['"#]appIcon\b|function\s+wireHeaderLogo\b/.test(codeOf(f)));
    assert.deepEqual(offenders, [], 'wire the header logo with wireHeaderLogo() from about-lightbox.js');
});

// ── AN UNCONFIRMED WRITE HOLDS AN UPDATE'S RELOAD, ON EVERY PAGE THAT ASKS (v25.21, docs audit) ───────
// AUTH_AND_SESSIONS invariant 22 said "the service worker does not reload the page while it stands",
// and claim-retry.js and slow-save.js each have a test proving their half. The WIRING had none: Admin
// and Settings counted the state in their busy checks, Operations and Links did not, and every suite
// stayed green — the "rule tested, the wiring not" shape CLAUDE.md names. In a second tab Firestore
// keeps a pending write in memory only, so the reload those two pages took could lose it.
//
// So: a page whose service-worker registration declares a busy check (`isBusy` — it has work a reload
// could cost) must consult the unconfirmed state in that check AND in its reload decision —
// `writesInFlight()` (which counts it) or `hasUnconfirmedWrite()`. A const it names is read too.
const RELOAD_HOLD_EXEMPT = {
    'overtime-app.js': 'its writes are Cloud Function calls with their own reconciliation (OVERTIME_AVAILABILITY invariant 4), never runGatedWrite',
};
/** The top-level properties of the object passed to `registerServiceWorker({ … })`, comments skipped. */
function swRegistrationProps(/** @type {string} */ src) {
    const at = src.indexOf('registerServiceWorker({');
    if (at < 0) return null;
    /** @type {Record<string, string>} */
    const props = {};
    let depth = 0, start = 0, quote = '';
    const take = (/** @type {number} */ end) => {
        const t = src.slice(start, end).replace(/\/\/[^\n]*/g, '').trim();
        const name = t.match(/^(?:async\s+)?([A-Za-z_$][\w$]*)/)?.[1];
        if (name) props[name] = t;
    };
    for (let i = at + 'registerServiceWorker('.length; i < src.length; i++) {
        const c = src[i];
        if (quote) { if (c === '\\') i++; else if (c === quote) quote = ''; continue; }
        if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); continue; }
        if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i) + 1; continue; }
        if (c === '\'' || c === '"' || c === '`') { quote = c; continue; }
        if ('({['.includes(c)) { if (++depth === 1) start = i + 1; continue; }
        if (')}]'.includes(c)) { if (--depth === 0) { take(i); break; } continue; }
        if (c === ',' && depth === 1) { take(i); start = i + 1; }
    }
    return props;
}
test('every page with a busy check holds an update while a write is unconfirmed', () => {
    const HOLDS = /\b(?:writesInFlight|hasUnconfirmedWrite)\(\)/;
    let checked = 0;
    for (const p of APP_PAGE_ENTRIES) {
        const src = codeOf(p.coordinator);
        const props = swRegistrationProps(src);
        if (!props?.isBusy || RELOAD_HOLD_EXEMPT[p.coordinator]) continue;
        // One level of indirection: `isBusy: _opsBusy` is read through `const _opsBusy = …;`.
        const withDefs = (/** @type {string} */ t) => t + [...t.matchAll(/\b([A-Za-z_$][\w$]*)\b/g)]
            .map(m => src.match(new RegExp(`const ${m[1].replace(/\$/g, '\\$')}\\s*=[^;]*;`))?.[0] ?? '').join('\n');
        assert.match(withDefs(props.isBusy), HOLDS,
            `${p.coordinator}: its isBusy check does not count an unconfirmed write — a notification tap or an update could take the page away from it`);
        assert.ok(props.beforeReload, `${p.coordinator}: declares isBusy but no beforeReload — the update reload asks nothing`);
        assert.match(withDefs(props.beforeReload), HOLDS,
            `${p.coordinator}: its update reload does not wait for an unconfirmed write (AUTH_AND_SESSIONS invariant 22)`);
        checked++;
    }
    assert.ok(checked >= 4, `only ${checked} pages declare a busy check — this test is checking almost nothing`);
});

test('Settings holds an update while a password save, or its "own password" record, is on its way (sign-in check, 11 Nov 2026)', () => {
    // The record was dropped by a reload in the moment after "updated", and the card then said "still on
    // your surname". It is counted where it STARTS (review, 11 Nov 2026: the forced change, on any page,
    // was not counted) — `changeOwnPassword` registers it, and `writesInFlight` counts what is registered;
    // both halves are behaviour-tested (firebase-client.test.mjs, slow-save.test.mjs). This pins the page.
    const src = codeOf('settings-app.js');
    const busy = src.match(/const _busy = ([^;]*);/)?.[1] ?? '';
    assert.match(busy, /_passwordSaving/, 'the busy check forgot the password save itself');
    assert.match(busy, /writesInFlight\(\) > 0/, 'the busy check does not count writes on their way, the record among them');
    const reg = swRegistrationProps(src) ?? {};
    for (const k of ['beforeReload', 'isBusy']) assert.match(reg[k] ?? '', /_busy/, `${k} does not ask the shared busy check`);
});

// ── A MESSAGE BOX THAT HIDES WHILE EMPTY IS NEVER ITS OWN LIVE REGION (review, 11 Nov 2026) ──────────
// Each box is display:none while empty, which takes it out of the accessibility tree, and a region only
// announces changes made while it is in the tree. "Show the box, then write" was pinned here as the cure,
// but both happen in one task, before the tree is next updated — the order changed nothing. The region
// is the box's always-rendered parent (calendar-lock-cards.js → `say` has the reasoning).
test('every sign-in message box that hides while empty sits inside a live region, and is not one itself', () => {
    const boxes = [['login-overlay.js', 'loginError'], ['login-overlay.js', 'loginStatus'], ['login-overlay.js', 'loginResetStatus'],
        ['password-force.js', 'pwfError'], ['calendar-lock-cards.js', 'calLockMsg']];
    for (const [file, id] of boxes) {
        const m = codeOf(file).match(new RegExp(`<div ([^>]*)><div ([^>]*\\bid="${id}"[^>]*)></div></div>`));
        assert.ok(m, `${file}: #${id} is not the only child of a wrapper — nothing is in the tree to hear it appear`);
        assert.match(m[1], /aria-live="polite"/, `${file}: #${id}'s wrapper is not a live region`);
        assert.doesNotMatch(m[2], /aria-live|role=/, `${file}: #${id} is a live region itself — hidden while empty, it cannot announce`);
    }
});

// ── EVERY PAGE TIDIES AN EXPIRED SIGN-IN AWAY AS IT STARTS (sign-in check, 11 Nov 2026) ─────────────
// A Firebase identity whose 60-day local session has ended must not stay live on a page reached by a
// deep link. Each coordinator asks `reconcileExpiredIdentity` as it starts — with its DEFAULT, which signs
// the staff PIN out too (AUTH_AND_SESSIONS 24) — except the Calendar's access gate, which admits the PIN
// and asks it to keep a viewer. Deleting the call from Settings or Operations left every suite green.
test('every page asks reconcileExpiredIdentity as it starts, and only the Calendar keeps a PIN viewer', () => {
    for (const p of APP_PAGE_ENTRIES) {
        const file = p.id === 'calendar' ? 'calendar-access.js' : p.coordinator;
        const args = [...codeOf(file).matchAll(/\breconcileExpiredIdentity\(([^)]*)\)/g)].map(m => m[1].trim());
        assert.ok(args.length > 0, `${file}: never asks reconcileExpiredIdentity — an expired identity stays live there`);
        if (p.id === 'calendar') {
            assert.ok(args.every(a => /preserveCalendarViewer:\s*true/.test(a)), `${file}: the Calendar must keep a PIN viewer (${args})`);
        } else {
            assert.deepEqual(args.filter(Boolean), [], `${file}: only the Calendar may ask to keep a PIN viewer (Trains asks holdsStaffPin first)`);
        }
    }
});
