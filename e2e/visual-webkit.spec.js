/**
 * visual-webkit.spec.js — A SMALL SET OF PIXELS UNDER SAFARI'S ENGINE.
 * Run: `npm run test:visual:webkit` (config: playwright.visual-webkit.mjs).
 *
 * ── WHY, IN ONE SENTENCE ────────────────────────────────────────────────────────────────────────
 *
 * iOS BEHAVIOUR is well proven here and iOS APPEARANCE was not proven at all: `npm run test:webkit`
 * runs the whole smoke suite under this engine, while every one of the 45 pixel baselines is
 * Chromium's. A Safari-only rendering difference — a control sized differently, a flex line
 * breaking where Blink does not, a font metric moving a row — had nothing looking at it, in an app
 * whose staff are half on iPhones.
 *
 * ── WHY THIS HANDFUL ────────────────────────────────────────────────────────────────────────────
 *
 * The v23.01 review named the set and the reason it must stay a set: it costs CI time on every
 * branch. These are the surfaces where an engine difference would actually reach a member —
 * the roster they read, the panel they open on a day, the drawer they navigate by, the take-home
 * figure, the admin week grid, and one guide as a representative of the five.
 *
 * ── AND ONE THAT IS DELIBERATELY ABSENT ─────────────────────────────────────────────────────────
 *
 * **The mobile Calendar month grid is NOT here, and its absence is the point.** `visual.spec.js`
 * excludes it from the Chromium lane for a measured reason: at 390px the seven columns are
 * 390/7 = 55.71px, and a fractional grid rasterises with run-to-run sub-pixel variation that
 * shifts the whole frame ~1px — a 25-run stress put it at ~60% flake, which no threshold fixes.
 * Nothing about a second engine repairs that; if anything WebKit's text rasterisation is the less
 * byte-stable of the two on this container. **A flaky baseline is worse than none**, so the month
 * grid's pixels stay locked at desktop width in the Chromium lane, and its mobile layout stays
 * covered by the geometry assertions in the responsive and calendar specs — which is where a
 * fractional-grid surface belongs.
 *
 * The Calendar IS represented here, by the surface a member actually reads a day from: the day
 * detail panel. That is a fixed-width overlay, so it has none of the grid's instability.
 *
 * ── WHAT THIS IS NOT ────────────────────────────────────────────────────────────────────────────
 *
 * Playwright's WebKit is the engine, not Safari and not an iPhone. It cannot show standalone PWA
 * chrome, the home-screen install, ITP eviction or Safari's own UI — `playwright.webkit.mjs` says
 * the same thing at greater length, and the real-device checklist the same review asks for is a
 * separate item that no automation replaces.
 *
 * Baselines live under `e2e/visual-baselines/webkit/` and are a different engine's pixels: they
 * will never equal their Chromium twins, and are not meant to. Regenerate with
 * `npm run test:visual:webkit -- --update-snapshots=all`, then `git status` the folder and revert
 * anything you cannot explain — the `=all` trap the Chromium lane documents applies identically.
 */

import { test, expect } from './fixtures.js';
import { prep, settle } from './visual-harness.js';

// The device's own viewport (iPhone 13, 390×844) is what the config supplies. Where a surface is
// taller than the screen the test grows the viewport rather than using `fullPage`, for the reason
// `visual.spec.js` records: a fullPage shot resizes to scrollHeight at capture time, and a
// sub-pixel-unstable height rounds differently between runs and shifts the whole frame.

test('calendar day panel — the surface a member reads a day from', async ({ page }) => {
    await prep(page);
    await page.goto('/');
    await settle(page, '.calendar-day');
    // OPENED BY A TAP, and the cell is chosen rather than indexed. Two things learned by getting
    // this wrong first:
    //
    //   · A TAP is the real route here. This is a touch device, so there is no hover tooltip for a
    //     click to raise — the reason the Chromium twin uses the keyboard does not apply — and
    //     v23.59 made a click open the panel on every pointer type.
    //   · **Never index blindly into the grid.** `nth(24)` landed on a pay CUT-OFF day, where Enter
    //     correctly jumps to the calculator instead of opening the panel (v23.07). The panel never
    //     appeared and it read like a WebKit difference; it was a test that did not know which day
    //     it had picked, and it would have failed on Chromium in exactly the same way. Excluding
    //     `.payday`/`.cutoff` states the requirement instead of hoping.
    const cell = page.locator('.calendar-day:not(.other-month):not(.payday):not(.cutoff)').nth(10);
    await cell.click();
    await expect(page.locator('#dayDetailContent')).toBeVisible();
    // Past the 500ms entry transition, so this is the panel at rest and not mid-spring.
    await page.evaluate(() => new Promise(r => setTimeout(r, 600)));
    await expect(page.locator('#dayDetailContent')).toHaveScreenshot('wk-day-detail.png');
});

test('team week view — the seven-column roster', async ({ page }) => {
    await prep(page, { width: 390, height: 1400 });
    await page.goto('/');
    await settle(page, '.calendar-day');
    await page.locator('#teamViewBtn').click();
    await settle(page, '.team-week-text');
    await page.evaluate(() => new Promise(r => setTimeout(r, 300)));
    await expect(page).toHaveScreenshot('wk-team-view.png');
});

test('nav drawer — the way every page is reached', async ({ page }) => {
    await prep(page);
    await page.goto('/');
    await settle(page, '.calendar-day');
    await page.locator('#navMenuBtn').click();
    await expect(page.locator('.nav-panel')).toBeVisible();
    await page.evaluate(() => new Promise(r => setTimeout(r, 400)));
    await expect(page.locator('.nav-panel')).toHaveScreenshot('wk-nav-drawer.png');
});

test('paycalc — the take-home figure and its sticky bar', async ({ page }) => {
    await prep(page, { width: 390, height: 1600 });
    await page.goto('/paycalc.html');
    await settle(page, '#netDisplay');
    await page.evaluate(() => new Promise(r => setTimeout(r, 400)));
    // The RESULT card rather than the page: the sticky bar's position depends on scroll, which is
    // a behaviour the smoke suite already asserts. What an engine can change here is the £ figure's
    // own metrics and the card's composition around it.
    await expect(page.locator('#summary')).toHaveScreenshot('wk-paycalc-result.png');
});

test('admin — the week grid a manager edits', async ({ page }) => {
    await prep(page, { width: 390, height: 1800 });
    await page.goto('/admin.html');
    await settle(page, '.week-grid-header, .day-row');
    await page.evaluate(() => new Promise(r => setTimeout(r, 400)));
    // The week grid alone. Its header and rows are separate grids sharing explicit tracks
    // (`--wg-base-col`/`--wg-time-col`, v22.22), which is exactly the kind of thing an engine can
    // resolve differently — and the defect it replaced was a header 34px out of step with the
    // column it labels.
    await expect(page.locator('.week-grid-header').first()).toBeVisible();
    await expect(page.locator('#weekGrid')).toHaveScreenshot('wk-admin-week-grid.png');
});

test('a guide — the shared shell, one representative of five', async ({ page }) => {
    await prep(page, { width: 390, height: 1400 });
    await page.goto('/railcard-guide.html');
    await settle(page, 'h1');
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => new Promise(r => setTimeout(r, 300)));
    // The guides load NONE of the app's stylesheets — `guide-shell.css` restates the scrollbar,
    // `::selection`, `::placeholder` and `caret-color` for exactly that reason — so they are the
    // part of the app most able to drift on one engine without the other noticing.
    await expect(page).toHaveScreenshot('wk-guide-railcard.png');
});
