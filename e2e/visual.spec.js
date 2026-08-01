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
import { seedSession, seedMember, openRosterReview } from './helpers.js';

// A Wednesday inside G. Miller's rendered roster window — gives a stable "Today" cell and a
// deterministic pay period without depending on the wall clock the suite runs on.
const FIXED_TIME = new Date('2026-07-15T09:00:00Z');

// Pre-dismiss every one-time overlay/notice so no lightbox floats over the captured layout.
// Keys are the real localStorage flags each surface checks (kept in sync with the app).
function dismissOneTimeOverlays(page) {
    return page.addInitScript(() => {
        const flags = {
            'myb_pc_ytd_notice_shown': '1',    // paycalc Year-to-Date notice
            'myb_pc_ns_migrated': '1',         // paycalc legacy data-ownership prompt
            'myb_notif_prompt_done': '1',      // calendar notification prompt strip
            'myb_links_beta_seen': '1',        // links first-visit beta lightbox
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


// ── Operations Usage card ─────────────────────────────────────────────────────────────────────
// The card needs DATA to be worth baselining — the Firebase stub returns none, so without this it
// would lock the empty state and say nothing about the composition (four sections, three bar
// groups, a stacked bar, a legend).
//
// The injection is made LOUD on purpose. A silent string-replace is the wrong shape here: if the
// anchor ever stops matching (a reformat, a signature change) the rewrite no-ops, the card renders
// EMPTY, and the next person to regenerate baselines locks that in — leaving a green test that
// stopped testing anything and nothing to say so. So a missing anchor throws, and the test asserts
// the fixture actually reached the DOM before it captures.
const USAGE_FIXTURE = `
    return {
        month: '2026-07', prevMonth: '2026-06',
        pageCounts: [{page:'calendar',count:1284},{page:'paycalc',count:412},{page:'admin',count:203},
                     {page:'settings',count:96},{page:'operations',count:31},{page:'huddle',count:341},
                     {page:'circular',count:58},{page:'guide-fip',count:12}],
        prevPageCounts: [{page:'calendar',count:1100},{page:'paycalc',count:388}],
        accountsThisMonth: 31, accountsLast30: 34,
        monthsHistory: {'2026-06':29,'2026-07':31},
        origins: [{origin:'web',accounts:22,installed:17},
                  {origin:'pages',accounts:9,installed:9},
                  {origin:'other',accounts:1,installed:0}],
    };`;

/** Serve a firebase-client.js whose usage/sign-in reads return fixed data. Throws if either anchor
 *  is missing, so the fixture can never silently stop applying. @param {import('@playwright/test').Page} page */
function stubUsageReads(page) {
    return page.route('**/firebase-client.js', async route => {
        const res = await route.fetch();
        const src = await res.text();
        const anchors = ['export async function getUsageStats() {', 'export async function getSignInStats() {'];
        for (const a of anchors) {
            if (!src.includes(a)) throw new Error(`visual: usage fixture anchor no longer matches — "${a}". `
                + 'Update it, or this baseline silently degrades to the empty state.');
        }
        const body = src
            .replace(anchors[0], anchors[0] + USAGE_FIXTURE)
            .replace(anchors[1], anchors[1]
                + ' return { last30: 28, last7: 19, last90: 33, total: 41, neverSignedIn: 5 };');
        await route.fulfill({ response: res, body, contentType: 'text/javascript' });
    });
}

test('operations — Usage card, populated (desktop 1280)', async ({ page }) => {
    await stubUsageReads(page);
    await prep(page, { width: 1280, height: 1400 });
    await page.goto('/operations.html');
    await settle(page, '#usageCard');
    await page.evaluate(() => {
        const b = document.getElementById('usageBody');
        if (b && !b.classList.contains('open')) document.getElementById('usageToggleHeader')?.click();
    });
    const card = page.locator('#usageCard');
    // Proof the fixture landed AND the card rendered from it — without these the capture below
    // could quietly be of the empty state. Deliberately NOT a label string: the first version
    // watched for "myb-roster.web.app" and broke the moment v19.26 shortened that label to
    // "web.app" for column alignment. A sentinel should prove the DATA arrived, not police the
    // copy — so: a distinctive fixture NUMBER, plus the row COUNT, both of which survive rewording.
    await expect(card).toContainText('1,284');
    await expect(card.locator('.usage-origins .usage-bar-row')).toHaveCount(3);
    await page.waitForTimeout(400);          // collapse transition + bar widths settle
    await expect(card).toHaveScreenshot('operations-usage-card.png');
});

// ── Operations roster review table ────────────────────────────────────────────────────────────
// The most state-dense surface in the app, and the LAST one with no pixel coverage — because it
// only exists after a successful PDF parse, so no plain page load can reach it. That gap is not
// theoretical: THREE UI defects in this table reached the owner rather than a screenshot diff
// (v19.32–33 — a Skip button wearing the success green while meaning "write nothing", the same
// button stretching full-width when the group wrapped, and a prose line duplicating the buttons
// beneath it). All three were found by hand-rendering it. This makes that permanent.
//
// One capture, every row state the table can produce:
//   Sun/Mon/Sat — DIFF (ticked, will save)      Wed — flagged, GARBLED (no readings → skip-only)
//   Tue — CONFLICT (a seeded manual override)   Thu — flagged with two readings, UNRESOLVED
//                                               Fri — flagged with two readings, RESOLVED
// Thu and Fri are deliberately days G. Miller WORKS: on a base rest day both readings normalise to
// RD and the picker is (correctly) not offered, so a rest day would capture the wrong thing.
test('operations — roster review table, every row state (mobile 390)', async ({ page }) => {
    await prep(page, { width: 390, height: 1500 });
    const { wasParseCalled } = await openRosterReview(page);

    // Resolve the Friday row, so the capture holds a RESOLVED pick beside an unresolved one — the
    // chosen/unchosen button treatment is exactly what was wrong twice.
    await page.locator('.roster-change-row .roster-choice-btn[data-opt="0"]').last().click();

    // SENTINELS — without these the capture could silently be of a table that rendered but lost the
    // feature. The stub reaching the app is not enough: if `choices` ever stops arriving, the rows
    // still render (as plain skip-only) and the next re-baseline would lock in a green test that had
    // quietly stopped covering the picker at all — the failure mode the Usage-card fixture documents.
    expect(wasParseCalled(), 'the parse stub never fired — the function URL probably changed').toBe(true);
    await expect(page.locator('.roster-change-row')).toHaveCount(7);
    await expect(page.locator('.roster-pick')).toHaveCount(3);          // 1 conflict + 2 flagged
    await expect(page.locator('.roster-choice-btn[data-opt="0"].is-chosen')).toHaveCount(1);

    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);          // let the button background transition settle

    // A COLOUR contract this baseline provably cannot hold, so it is asserted directly. Deleting the
    // neutral-Skip rule (the v19.32 defect: Skip wearing the "this will be saved" green while meaning
    // write nothing) does NOT fail the screenshot — verified, not assumed. `--text-mid` sits at L45%
    // and `--success-green` at L48.5%, and pixelmatch's per-pixel delta is luminance-dominated, so a
    // hue-only swap at near-equal lightness falls under the 0.15 threshold that exists to absorb
    // anti-aliasing shimmer. Lowering that threshold to catch one rule would trade a real flake risk
    // across all 16 baselines; reading the computed colour costs nothing and says what is meant.
    // The lesson generalises: a visual baseline covers LAYOUT, not semantics.
    //
    // MUST run after the wait above. Read mid-transition (`transition: background var(--dur-med)`),
    // the two settle to the SAME green but serialise differently — `oklch(...)` vs an interpolated
    // `oklab(...)` — so a string compare called them different and the assertion passed with the rule
    // deleted. A false pass, found only by printing both values.
    const [skipBg, valueBg] = await page.evaluate(() => [
        getComputedStyle(/** @type {Element} */ (document.querySelector('.roster-choice-btn--skip.is-chosen'))).backgroundColor,
        getComputedStyle(/** @type {Element} */ (document.querySelector('.roster-choice-btn[data-opt="0"].is-chosen'))).backgroundColor,
    ]);
    expect(skipBg, 'Skip must not wear the colour that means "this will be saved"').not.toBe(valueBg);

    await expect(page.locator('#rosterReviewSection')).toHaveScreenshot('operations-roster-review.png');
});

// ── Links workspace ───────────────────────────────────────────────────────────────────────────
// The app's most visually complex surface — a 28×7 grid, an hour-by-hour heat map, a paint bar, a
// design picker — and until v19.38 it had no pixel coverage at all. Baselined at DESKTOP, where the
// grid's sticky header and the ≥1024px `overflow-x` drop are load-bearing (see the links rules doc);
// the mobile view is the same grid with horizontal scroll.
//
// A generated design is used rather than the empty state: an all-rest grid locks almost nothing,
// and the heat map — the artefact a coverage gap is spotted on — renders nothing without shifts.
const LINKS_DESIGN = (() => {
    /** @type {Record<string, any>} */
    const patterns = {};
    const shifts = ['06:20-14:20', '07:00-15:00', '11:00-19:30', '14:00-22:30', 'SPARE', 'RD', 'RD'];
    for (let i = 1; i <= 28; i++) {
        /** @type {Record<string, string>} */
        const row = {};
        ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].forEach((d, j) => {
            row[d] = (i % 4 === 0 && (j === 0 || j === 6)) ? 'RD' : shifts[(i + j) % shifts.length];
        });
        patterns[String(i)] = row;
    }
    return patterns;
})();

test('links — design grid + coverage + checks (desktop 1280)', async ({ page }) => {
    await page.addInitScript((pats) => {
        /** @type {any} */ (window).__E2E = /** @type {any} */ (window).__E2E || {};
        /** @type {any} */ (window).__E2E.docs = [{
            id: 'd1', name: 'Option A', updatedBy: 'S. Silva', patterns: pats,
        }];
    }, LINKS_DESIGN);
    await prep(page, { width: 1280, height: 2400 });
    await page.goto('/links.html');

    // Sentinels BEFORE the capture. Without them a regression that dropped the seeded design still
    // renders a plausible page — 28 empty rows and an empty-state heat map — and the next baseline
    // regeneration would lock in a green test covering nothing (the Usage-card lesson, v19.25).
    await expect(page.locator('#linksGridBodyRows tr')).toHaveCount(28);
    await expect(page.locator('tr.row-unfilled')).toHaveCount(0, { timeout: 10000 });
    await expect(page.locator('#coverageHeatmap')).toBeVisible();
    await settle(page, '.links-grid');
    await expect(page).toHaveScreenshot('links-workspace.png');
});

// ── Guide pages (static, auth-free) ────────────────────────────────────────────────────────
// The four guides don't import shared.css and have no Firebase/fractional-grid, so they baseline
// cleanly. These lock the layouts touched by Section C (the .chip/.chip-bar hoist into
// guide-shell.css) and Section D (railcard min-fare + FIP content edits). No prep(): guides need
// no session/clock — just a viewport, fonts, and layout settle.
async function guideSettle(page, ready) {
    await expect(page.locator(ready).first()).toBeVisible();
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
}

test('guide — railcard mobile 390', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 6200 });
    await page.goto('/railcard-guide.html');
    await guideSettle(page, '.chip-bar, .rc');
    await expect(page).toHaveScreenshot('railcard-guide-mobile-390.png');
});

test('guide — fip mobile 390', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 6200 });
    await page.goto('/fip.html');
    await guideSettle(page, '.chip-bar, .section-label');
    await expect(page).toHaveScreenshot('fip-guide-mobile-390.png');
});

test('guide — staff/admin desktop 900', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 3600 });
    await page.goto('/guide.html');
    await guideSettle(page, '.content, main, .guide-header');
    await expect(page).toHaveScreenshot('staff-guide-desktop-900.png');
});

test('guide — paycalc-guide desktop 900', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 3600 });
    await page.goto('/paycalc-guide.html');
    await guideSettle(page, '.content, main, .guide-header');
    await expect(page).toHaveScreenshot('paycalc-guide-desktop-900.png');
});

// ── Overlays (v19.03) ─────────────────────────────────────────────────────────
//
// WHY THESE EXIST. Until now the suite baselined ten PAGE surfaces and not one overlay — so the
// login card, About, App Notices, Tips, the dialogs and the password-force block had NO pixel
// coverage at all. That is a large fraction of the app's surface area, and it is precisely where the
// v19.04 audit found real drift: five widths, three viewport caps (85 / 86 / 90vw), two different
// width idioms and six paddings across seven overlays, with no evident reason for any of it.
//
// Any fix to that moves pixels, and nothing would have caught a mistake. So these land FIRST, on the
// CURRENT values, deliberately baselining the drift — that is what makes any consolidation a
// reviewable diff rather than a leap.
//
// Captured at a fixed 900px-tall desktop viewport: the overlay is centred and the page behind it is
// already locked by the surface baselines above, so the frame is stable.

test('overlay — About lightbox (calendar, desktop 1280)', async ({ page }) => {
    await prep(page, { width: 1280, height: 900 });
    await page.goto('/');
    await settle(page, '.calendar-day');
    await page.locator('.title-icon').first().click();
    await expect(page.locator('#iconLightbox')).toBeVisible();
    // The open transition finishes before capture (createLightbox's .visible -> .open).
    await page.evaluate(() => new Promise(r => setTimeout(r, 400)));
    await expect(page).toHaveScreenshot('overlay-about-desktop-1280.png');
});

test('overlay — App Notices (calendar, desktop 1280)', async ({ page }) => {
    await prep(page, { width: 1280, height: 900 });
    await page.goto('/');
    await settle(page, '.calendar-day');
    await page.locator('#navMenuBtn').click();
    await page.locator('.nav-panel-link--notices').first().click();
    await expect(page.locator('#navNoticesLightbox')).toBeVisible();
    await page.evaluate(() => new Promise(r => setTimeout(r, 400)));
    await expect(page).toHaveScreenshot('overlay-notices-desktop-1280.png');
});

test('overlay — login card (admin, signed out, desktop 1280)', async ({ page }) => {
    await page.clock.setFixedTime(FIXED_TIME);
    await page.setViewportSize({ width: 1280, height: 900 });
    await dismissOneTimeOverlays(page);   // NO seedSession — we want the signed-out overlay
    await page.goto('/admin.html');
    await settle(page, '#loginCard');
    await expect(page).toHaveScreenshot('overlay-login-desktop-1280.png');
});

// Tips is one of the two overlays the v19.04 size consolidation MOVES (360px -> 340px), so it is
// baselined here on the OLD value first: the next run's expected/actual/diff PNGs are the
// before/after evidence for that change rather than a claim about it.
test('overlay — Tips panel (settings, desktop 1280)', async ({ page }) => {
    await prep(page, { width: 1280, height: 900 });
    await page.goto('/settings.html');
    await settle(page, '.card');
    await page.locator('.btn-card-tips').first().click();
    await expect(page.locator('#tipsLightbox')).toBeVisible();
    await page.evaluate(() => new Promise(r => setTimeout(r, 400)));
    await expect(page).toHaveScreenshot('overlay-tips-desktop-1280.png');
});
