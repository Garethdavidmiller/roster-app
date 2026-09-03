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

/**
 * The five printable GUIDES are a different family — no shared.css, no nav drawer, no auth, no
 * analytics id — so they are excluded here and covered by their own rules. Everything else that is
 * a served HTML page at the repo root is an APP page and owes the full contract.
 */
const GUIDES = new Set([
    'staff-guide.html', 'paycalc-guide.html', 'railcard-guide.html', 'fip-guide.html', 'rangers-guide.html',
]);

/**
 * A THIRD family (v22.48): a served page that is nothing but a redirect to a renamed one. It has no
 * script, no stylesheet, no nav and no identity, so it owes none of the app contract — but it is a
 * served page, so it owes the two rules that are about being fetchable at all, and a contract of its
 * own further down.
 *
 * These exist because `firebase.json` speaks for ONE of the app's two origins. Its 301s cover the
 * canonical URL; the GitHub Pages mirror serves no redirect rules and no headers, and it is where
 * most staff still open the app — so a renamed page's old URL simply 404s there. The redirect is
 * therefore written into the HTML, the same reason the CSP is mirrored into a `<meta>` on every page.
 *
 * The set is written down rather than derived: "a page with no scripts" would also describe a page
 * whose module tag somebody deleted by accident, which is precisely the failure the app contract
 * exists to catch. Being a redirect has to be a DECISION, not an inference.
 */
const LEGACY_REDIRECTS = new Set(['guide.html', 'fip.html']);

const APP_PAGES = readdirSync(new URL('.', import.meta.url))
    .filter(f => f.endsWith('.html') && !GUIDES.has(f) && !LEGACY_REDIRECTS.has(f))
    .sort();

/** index.html is the calendar: a grid, not a stack of cards, and its own special case throughout. */
const CARD_PAGES = APP_PAGES.filter(f => f !== 'index.html');

test('the page list itself is not empty or accidentally filtered to nothing', () => {
    // Guard the guard: every assertion below is "X contains Y", all of which pass vacuously over an
    // empty list. The six app pages are calendar, admin, paycalc, operations, settings, links —
    // plus overtime.
    assert.ok(APP_PAGES.length >= 6, `expected at least six app pages, found ${APP_PAGES.join(', ') || 'none'}`);
    assert.ok(APP_PAGES.includes('index.html'), 'the calendar must be in the list');
});

test('every app page is checked by csp-meta-parity', () => {
    // The meta CSP is the ONLY policy the GitHub Pages mirror gets — it cannot serve headers — so a
    // page missing from this list has no CSP there at all, and nothing would say so.
    const suite = read('./csp-meta-parity.test.mjs');
    const missing = APP_PAGES.filter(p => !suite.includes(`'${p}'`));
    assert.deepEqual(missing, [], 'pages absent from csp-meta-parity\'s SERVED_HTML list');
});

test('every card-bearing page is checked by card-header-parity', () => {
    const suite = read('./card-header-parity.test.mjs');
    const missing = CARD_PAGES.filter(p => !suite.includes(`'${p}'`));
    assert.deepEqual(missing, [], 'pages absent from card-header-parity\'s PAGES list');
});

test('every app page is checked by page-css-parity, against its own stylesheet', () => {
    const suite = read('./page-css-parity.test.mjs');
    const missing = APP_PAGES.filter(p => !suite.includes(`'${p}':`));
    assert.deepEqual(missing, [], 'pages absent from page-css-parity\'s PAGES map');
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
    // `csp-meta-parity` (checked above) is STATIC — it compares two files. This one is the RUNTIME
    // counterpart: e2e/csp.spec.js serves the app from the Firebase Hosting emulator so the real
    // firebase.json header is applied and enforced by Chromium. Its page list is hand-written, and
    // `overtime.html` was missing from it for six releases — so the one run that proves the real
    // policy lets the app work had never opened the app's newest page.
    const suite = read('./e2e/csp.spec.js');
    const missing = APP_PAGES.filter(p => (p === 'index.html'
        ? !/'\/'/.test(suite)              // the calendar is visited at the app root
        : !suite.includes(`'/${p}'`)));
    assert.deepEqual(missing, [], 'pages absent from e2e/csp.spec.js\'s PAGES list');
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
    const pageIds = APP_PAGES.map(p => (p === 'index.html' ? 'calendar' : p.replace(/\.html$/, '')));
    const missing = pageIds.filter(id => !new RegExp(`^\\s{4}${id}:\\s*\\{`, 'm').test(policy));
    assert.deepEqual(missing, [], 'page ids with no PAGE_POLICIES entry');
});

test('every app page has a nav pill, so the drawer is a complete map', () => {
    // The drawer renders the CURRENT page as an inert pill rather than omitting it, which is what
    // keeps the row the same shape everywhere. A page with no entry breaks that on its own surface.
    const nav = read('./nav-panel.js');
    const pageIds = APP_PAGES.map(p => (p === 'index.html' ? 'calendar' : p.replace(/\.html$/, '')));
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
        const id = page === 'index.html' ? 'calendar' : page.replace(/\.html$/, '');
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
        const id = page === 'index.html' ? 'calendar' : page.replace(/\.html$/, '');
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
