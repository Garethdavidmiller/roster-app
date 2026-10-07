// @ts-check
/**
 * scripts/app-pages.mjs — THE ONE LIST OF THE APP'S PAGES, for the tests and tools.
 *
 * ── WHY ────────────────────────────────────────────────────────────────────────────────────────
 *
 * Adding a page used to mean editing about eight hand-kept lists, and the TESTS carried several of
 * them: csp-meta-parity, card-header-parity, page-css-parity, select-sheet-parity, csp-hygiene and
 * the deployed-CSP proof each spelled the pages out again. `page-contract-parity.test.mjs` existed to
 * notice when one fell behind — and one HAD: csp-hygiene read six of the seven app pages and never
 * Overtime, so the network calls that page makes were never checked against the CSP. A list a test
 * keeps for itself is a list that test can be wrong about without failing (external technical-debt
 * review, 5 Oct 2026). Those suites now READ this file instead.
 *
 * ── WHAT IT IS NOT ─────────────────────────────────────────────────────────────────────────────
 *
 * Not a runtime file, and nothing in the app imports it. The app has no build step, so the lists
 * that live IN the app — the service worker's precache, the auth policy, the nav pills, the
 * analytics ids the Firestore rules allow, the Operations report names, the guide back-arrow
 * allowlist — stay written out where they are, because each is the real contract in its own file.
 * What changes is that `page-contract-parity.test.mjs` checks every one of them against THIS list.
 * It is not a security control either: who may open a page is `auth-policy.js` and the rules.
 *
 * ── THE SAFEGUARD THAT KEEPS IT HONEST ─────────────────────────────────────────────────────────
 *
 * One list read by every check has one failure mode the scattered lists did not: a page left off
 * it would vanish from all of them at once. So `page-contract-parity.test.mjs` still enumerates
 * the HTML files ON DISK and fails on any page this list does not declare, in either direction.
 * That check deliberately does not read from here.
 *
 * ── ADDING A PAGE ──────────────────────────────────────────────────────────────────────────────
 *
 * Add its entry below; then run `node --test page-contract-parity.test.mjs`, which names every
 * app-side list (service worker, auth policy, nav, rules, reports, guide back-arrow) the page has
 * not joined yet.
 */

/**
 * @typedef {object} AppPage
 * @property {string} file         the served HTML file
 * @property {'app'} kind
 * @property {string} id           the page id the app uses — auth-policy, nav pills, analytics
 * @property {string} url          how a browser test reaches it ('/' for the calendar, the app root)
 * @property {string} css          the page's own stylesheet
 * @property {string} coordinator  the page's main module
 * @property {string|null} boot    its CSP bootstrap shim (`null`: the calendar loads its coordinator directly)
 * @property {boolean} cards       built from `.card` blocks (the calendar is a grid, not cards)
 * @property {string} authBarrier  what its coordinator waits on before any write — see
 *                                 page-contract-parity's "each after-auth writer runs INSIDE its page's auth barrier"
 */
/** @typedef {{ file: string, kind: 'guide', url: string }} GuidePage */
/** @typedef {{ file: string, kind: 'redirect', to: string }} RedirectPage */

/** @param {string} file @param {string} id @param {Partial<AppPage>} [more] @returns {AppPage} */
const app = (file, id, more = {}) => ({
    file, kind: 'app', id, url: `/${file}`, css: file.replace(/\.html$/, '.css'),
    coordinator: `${id}-app.js`, boot: `${id}-boot.js`, cards: true, authBarrier: 'sessionReady', ...more,
});

/** The eight app pages. Order is the nav drawer's, for readability only. @type {ReadonlyArray<AppPage>} */
export const APP_PAGES = Object.freeze([
    app('index.html', 'calendar', { url: '/', css: 'index.css', boot: null, cards: false, authBarrier: 'calendarAuthReady' }),
    app('admin.html', 'admin'),
    // paycalc names a LOCAL closure as its barrier, handed to ensureNamedSession — checked as such.
    app('paycalc.html', 'paycalc', { authBarrier: 'afterAuth' }),
    app('operations.html', 'operations'),
    app('settings.html', 'settings'),
    app('links.html', 'links'),
    app('overtime.html', 'overtime'),
    app('trains.html', 'trains'),
]);

/** The printable guides — no shared.css, no drawer, no auth, no analytics id. In the drawer's order,
 *  which the guide search index is built in (scripts/guide-index-lib.mjs reads this list).
 *  @type {ReadonlyArray<GuidePage>} */
export const GUIDE_PAGES = Object.freeze(
    ['staff-guide.html', 'paycalc-guide.html', 'railcard-guide.html', 'rangers-guide.html', 'fip-guide.html']
        .map(file => /** @type {GuidePage} */ ({ file, kind: 'guide', url: `/${file}` })));

/**
 * Pages that are nothing but a redirect to a renamed one, written into the HTML because the GitHub
 * Pages mirror serves no redirect rules. Being one is a DECISION, never an inference — "a page with
 * no script" also describes a page whose module tag somebody deleted by accident.
 * @type {ReadonlyArray<RedirectPage>}
 */
export const REDIRECT_PAGES = Object.freeze([
    { file: 'guide.html', kind: 'redirect', to: './staff-guide.html' },
    { file: 'fip.html', kind: 'redirect', to: './fip-guide.html' },
]);

/** Every served HTML file, all three kinds. @returns {string[]} */
export const servedFiles = () => [...APP_PAGES, ...GUIDE_PAGES, ...REDIRECT_PAGES].map(p => p.file);

/** The app pages built from cards — every app page but the calendar. @returns {string[]} */
export const cardPageFiles = () => APP_PAGES.filter(p => p.cards).map(p => p.file);

/** `{ 'admin.html': 'admin.css', … }` for every app page. @returns {Record<string, string>} */
export const pageStylesheets = () => Object.fromEntries(APP_PAGES.map(p => [p.file, p.css]));

/** The app page declared for a file, or undefined. @param {string} file */
export const appPage = (file) => APP_PAGES.find(p => p.file === file);
