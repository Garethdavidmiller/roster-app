/**
 * touch-projects.js — WHICH PLAYWRIGHT PROJECTS HAVE A REAL COARSE POINTER.
 *
 * One line of data, in its own file, and the reason is a DEPENDENCY BOUNDARY rather than a design
 * one. `touch-gate-parity.test.mjs` is a static suite in `test:hygiene` — its own header promises
 * "static, no browser, nothing installed" — and its third contract has to compare this list against
 * the projects the Playwright configs declare. It used to reach the list by importing
 * `e2e/helpers.js`, which imports `@playwright/test` at module scope, so on a bare checkout with no
 * `node_modules` the suite died on `ERR_MODULE_NOT_FOUND` instead of running.
 *
 * That is worth more than a tidy-up, because of WHO it broke for. `npm run test:nodeps` exists for
 * exactly one reader: somebody reviewing this repo from a GitHub ZIP, with nothing installed. It is
 * the lane whose whole purpose is to work for a stranger — so the one person positioned to notice
 * it had rotted was the stranger, and that is who found it (external review, 6 Sep 2026). Nobody
 * working in a normal checkout could see it: with `node_modules` present the import resolves and
 * the suite passes.
 *
 * The list lives HERE rather than being read out of `helpers.js` as source text. The test asserts
 * against the REAL exported value; a regex over a source literal would pass just as happily against
 * a comment, and would stop matching at all if somebody rewrote the export — silently, which is the
 * failure mode this whole file exists to prevent.
 *
 * NOTHING may be added to this file that imports anything. That constraint IS the module.
 *
 * Deliberately NOT every non-desktop project: a test that is mobile-chrome-only for a reason that is
 * genuinely engine-neutral (WCAG tap targets) states that reason and keeps its own narrow gate —
 * see `SINGLE_PROJECT_EXEMPT` in touch-gate-parity.test.mjs.
 *
 * THE PROJECTS WITH A REAL COARSE POINTER — i.e. the ones where touch-only UI actually exists.
 *
 * Written once because it was written twice, and the third copy was the one that went wrong: nine
 * day-panel tests were gated to `mobile-chrome` ALONE, so the app's only touch route to what a day
 * IS never once ran on the engine every iPhone uses, while `mobile-safari` sat in CI as a full job.
 * The same gap was found and closed for the 16px-field rule at v22.12; this is the list that stops
 * it being rediscovered a third time.
 */
export const TOUCH_PROJECTS = ['mobile-chrome', 'mobile-safari'];
