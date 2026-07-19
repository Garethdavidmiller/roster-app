// Visual-regression baseline suite (Section B / F-VIS). Run OPT-IN via `npm run test:visual`
// (config: playwright.visual.mjs) — excluded from the smoke run because pixel diffs are
// environment-sensitive. Locks the composition of every key surface (including the accepted
// desktop "voids") so a CSS/layout change like the Section C token sweep can't silently
// restyle a page. When an intentional visual change lands, regenerate the affected baseline
// with `npm run test:visual -- --update-snapshots` and eyeball the new PNG in review.
//
// Determinism: the clock is pinned so the calendar + pay period are fixed; Firebase is stubbed
// (fixtures.js) so reads are empty; a fixed member is seeded; every one-time overlay is
// pre-dismissed; fonts + layout are awaited before capture. See playwright.visual.mjs.
//
// CAPTURE STRATEGY — fixed tall viewport, NOT fullPage. A fullPage screenshot resizes the page
// to scrollHeight at capture time; when that height is sub-pixel-unstable it rounds differently
// between runs, shifting the WHOLE frame ~1px. Instead each test sizes its viewport tall enough
// to contain the page and captures the viewport: a fixed frame with no resize, reproducible.
// Content shorter than the viewport just leaves deterministic navy below (which also locks the
// desktop "voids" we care about). Bump a height here if a page grows past its frame.
//
// EXCLUDED — mobile calendar (index.html @390px): its 7-column month grid has fractional column
// widths (390/7 = 55.71px), which Chromium rasterises with run-to-run sub-pixel variation (a ~1px
// whole-grid shift → ~12% diff) that no settle-wait or threshold can stabilise — a known limit of
// pixel-exact diffing on fractional-grid layouts, verified in review (25-run stress: ~60% flake).
// A flaky baseline is worse than none, so mobile-calendar coverage stays with the geometry-based
// e2e responsive/calendar specs; the calendar's pixels are still locked at desktop width below.

import { test, expect } from './fixtures.js';
import { seedSession, seedMember } from './helpers.js';

// A Wednesday inside G. Miller's rendered roster window — gives a stable "Today" cell and a
// deterministic pay period without depending on the wall clock the suite runs on.
const FIXED_TIME = new Date('2026-07-15T09:00:00Z');

// Pre-dismiss every one-time overlay/notice so no lightbox floats over the captured layout.
// Keys are the real localStorage flags each surface checks (kept in sync with the app).
function dismissOneTimeOverlays(page) {
    return page.addInitScript(() => {
        const flags = {
            'myb_pc_pay_welcome_shown': '1',   // paycalc welcome lightbox
            'myb_pc_ytd_notice_shown': '1',    // paycalc Year-to-Date notice
            'myb_pc_ns_migrated': '1',         // paycalc legacy data-ownership prompt
            'myb_notif_prompt_done': '1',      // calendar notification prompt strip
            'myb_links_beta_seen': '1',        // links first-visit beta lightbox
            'myb_email_check_done_G. Miller': '1', // operations/admin work-email overlay
        };
        for (const [k, v] of Object.entries(flags)) {
            try { localStorage.setItem(k, v); } catch { /* iOS private mode — ignore */ }
        }
    });
}

// Common deterministic setup: pin the clock, size the viewport (tall enough to contain the
// page — see CAPTURE STRATEGY above), seed a signed-in member, silence overlays.
// setFixedTime (not clock.install) pins Date/now WITHOUT freezing the timer queue — install()
// halts setTimeout, which stalls paycalc's timer-driven init (0 cards, never auth-ready).
async function prep(page, { width, height }) {
    await page.clock.setFixedTime(FIXED_TIME);
    await page.setViewportSize({ width, height });
    await seedSession(page, 'G. Miller');
    await seedMember(page, 'G. Miller');
    await dismissOneTimeOverlays(page);
}

// Wait for the app to settle DETERMINISTICALLY: the key element visible, network idle (stubbed
// reads resolved), web fonts fully loaded (no FOUT metric shift), then two animation frames so
// the final layout has painted before we capture.
async function settle(page, ready) {
    await expect(page.locator(ready).first()).toBeVisible();
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
}

test('calendar — desktop 1280', async ({ page }) => {
    await prep(page, { width: 1280, height: 900 });
    await page.goto('/index.html');
    await settle(page, '.legend, .calendar-legend, footer');
    await expect(page).toHaveScreenshot('calendar-desktop-1280.png');
});

test('paycalc — desktop 1440 (signed in)', async ({ page }) => {
    await prep(page, { width: 1440, height: 2700 });
    await page.goto('/paycalc.html');
    await settle(page, '#settingsCard, #hoursCard');
    await expect(page).toHaveScreenshot('paycalc-desktop-1440.png');
});

test('paycalc — mobile 390 (signed in)', async ({ page }) => {
    await prep(page, { width: 390, height: 4400 });
    await page.goto('/paycalc.html');
    await settle(page, '#settingsCard, #hoursCard');
    await expect(page).toHaveScreenshot('paycalc-mobile-390.png');
});

test('admin — desktop 1280 (signed in)', async ({ page }) => {
    await prep(page, { width: 1280, height: 1200 });
    await page.goto('/admin.html');
    await settle(page, '.card');
    await expect(page).toHaveScreenshot('admin-desktop-1280.png');
});

test('operations — desktop 1280 (signed in)', async ({ page }) => {
    await prep(page, { width: 1280, height: 900 });
    await page.goto('/operations.html');
    await settle(page, '#huddleUploadCard');
    await expect(page).toHaveScreenshot('operations-desktop-1280.png');
});

test('settings — mobile 390 (signed in)', async ({ page }) => {
    await prep(page, { width: 390, height: 900 });
    await page.goto('/settings.html');
    await settle(page, '.card');
    await expect(page).toHaveScreenshot('settings-mobile-390.png');
});
