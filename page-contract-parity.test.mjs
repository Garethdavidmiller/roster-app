/**
 * page-contract-parity.test.mjs — a new app page joins EVERY contract, or fails here.
 * Run: node --test page-contract-parity.test.mjs   (part of `npm run test:hygiene`)
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
    const { imports, handList } = readsThePageList(read('./e2e/csp.spec.js'), 'APP_PAGES');
    assert.ok(imports, 'e2e/csp.spec.js no longer takes its pages from scripts/app-pages.mjs (APP_PAGES)');
    assert.deepEqual(handList, [], 'e2e/csp.spec.js names pages itself again — read them from the list');
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
 * do differ. Five use `sessionReady`; the Calendar has no Auth session of its own and uses
 * `calendarAuthReady` (NOT `calendarAccessReady` — in `open` mode those are different instants, and
 * gating on access alone fires the writes into a window with no token, which is the v20.22 bug).
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
        .map(c => ({ file: c.file, opts: optionsObjectAfter(c.src, 'initNavPanel({') }));
    assert.ok(callers.length >= 7, `expected every page coordinator, found ${callers.length}`);

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
    const allow = rules.match(/counts\.keys\(\)\.hasOnly\(\[([\s\S]*?)\]\)/);
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
 * @param {string} src @param {string} marker
 */
function optionsObjectAfter(src, marker) {
    const at = src.indexOf(marker);
    if (at === -1) return '';
    let depth = 0;
    const from = at + marker.length - 1;          // the '{' itself
    for (let i = from; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) return src.slice(from, i + 1);
    }
    return src.slice(from);
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
     *   4. it stays a stub: no scripts, no stylesheet links, nothing that gives it a module graph
     *      and an opinion. The moment one grows those it is an app page wearing an exemption.
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

        assert.ok(!/<script/i.test(html), `${page} has a <script> — a redirect stub carries none`);
        assert.ok(!/<link[^>]+rel="stylesheet"/i.test(html),
            `${page} links a stylesheet — a redirect stub styles itself inline or not at all`);
    }
});
