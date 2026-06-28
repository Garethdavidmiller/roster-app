/**
 * Smoke tests — verify every app page loads and runs JS without crashing.
 *
 * Philosophy: test the RENDERED output, not the static HTML.
 * Every assertion below targets an element that only exists if JavaScript
 * actually ran and completed (month heading built from roster data,
 * grade options injected from teamMembers, period options from pay schedule).
 * A 404, a CSP violation, a SyntaxError, or a module import failure all
 * produce a blank page with none of those elements — the test fails.
 *
 * Firebase is stubbed at the network layer (see ./fixtures.js): the gstatic
 * Firebase SDK modules are intercepted and served as local no-op stubs, so the
 * suite never depends on a live CDN and verifies our own UI, not Firestore.
 * (Before this, every page's static import of the Firebase SDK meant a slow or
 * blocked CDN on the CI runner aborted the whole module graph — no JS ran and
 * every test timed out. The stub removes that single point of failure.)
 *
 * Run: npx playwright test
 */

import { test, expect } from './fixtures.js';

// Collect uncaught JS exceptions on a page. Firebase network/auth errors are
// filtered out — they're expected when running against localhost with no valid
// referrer, and the app handles them gracefully with no visible effect.
function collectFatalErrors(page) {
    const errors = [];
    page.on('pageerror', err => {
        const msg = err.message || '';
        if (
            msg.includes('FirebaseError') ||
            msg.includes('auth/') ||
            msg.toLowerCase().includes('network request failed') ||
            msg.toLowerCase().includes('failed to fetch') ||
            msg.includes('Not authorised — redirecting')  // intentional throw to halt module after location.replace
        ) return;
        errors.push(msg);
    });
    return errors;
}

// Seed a valid signed-in session before any page script runs. Shape must match
// session.js getSession(): { name, ver: SESSION_VER (2), expiry, lastActivity }.
// Pages with a session guard (paycalc redirects unsigned users to admin.html;
// settings runs its full initApp only when signed in) need this to exercise the
// signed-in path. addInitScript runs on every navigation before page JS.
function seedSession(page, name = 'G. Miller') {
    return page.addInitScript((n) => {
        localStorage.setItem('myb_admin_session', JSON.stringify({
            name: n,
            ver: 2,
            expiry: Date.now() + 30 * 24 * 60 * 60 * 1000,
            lastActivity: Date.now(),
        }));
    }, name);
}

// ── CALENDAR (index.html) ──────────────────────────────────────────────────

test('calendar: renders the current month from roster data', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.goto('/');

    // .month-year is built entirely by JS — if this is visible, the whole
    // roster-data → buildCalendarContainer → renderCalendar pipeline ran.
    await expect(page.locator('.month-year')).toBeVisible();

    // At least one day cell must exist (the calendar grid rendered)
    await expect(page.locator('.calendar-day').first()).toBeVisible();

    expect(errors, 'Uncaught JS exceptions on index.html').toHaveLength(0);
});

test('calendar: member dropdown is populated by JS from teamMembers', async ({ page }) => {
    await page.goto('/');
    const select = page.locator('#teamMemberSelect');
    // Wait for JS to populate options — the select is in static HTML so toBeVisible()
    // would pass immediately before any JS runs. toBeAttached() retries until an
    // <option> element is present in the DOM (option elements have no bounding box).
    await expect(select.locator('option').first()).toBeAttached();
    const count = await select.locator('option').count();
    // Should have more than 5 options (the full team, excluding hidden members)
    expect(count, 'teamMemberSelect should have options from teamMembers').toBeGreaterThan(5);
});

test('calendar: nav drawer opens on burger click', async ({ page }) => {
    await page.goto('/');
    // Wait for app.js to finish initialising before clicking. The burger is in
    // static HTML so it is clickable immediately, but initNavPanel() (which wires
    // the click handler) runs during the same init that populates the member
    // dropdown. Clicking before the handler is attached silently loses the click,
    // and the aria-expanded assertion never re-clicks — so it would time out.
    await expect(page.locator('#teamMemberSelect option').first()).toBeAttached();
    await page.locator('#navMenuBtn').click();
    // nav-panel.js sets aria-expanded="true" when the drawer is open
    await expect(page.locator('#navMenuBtn')).toHaveAttribute('aria-expanded', 'true');
});

// ── ADMIN (admin.html) ────────────────────────────────────────────────────

test('admin: login overlay renders with JS-populated grade options', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.goto('/admin.html');

    // Login overlay must be visible (no session in test environment)
    await expect(page.locator('#loginOverlay')).toBeVisible();

    // Grade select — static HTML has only a placeholder; JS adds one option per grade.
    // If JS didn't run the grade list would be empty, login would be unusable.
    const gradeCount = await page.locator('#loginGrade option').count();
    expect(gradeCount, '#loginGrade should have JS-added grade options').toBeGreaterThan(1);

    expect(errors, 'Uncaught JS exceptions on admin.html').toHaveLength(0);
});

// ── PAY CALCULATOR (paycalc.html) ─────────────────────────────────────────

test('paycalc (signed in): pay period selector is populated', async ({ page }) => {
    const errors = collectFatalErrors(page);

    // paycalc.html has a session guard that redirects unsigned-in users to
    // admin.html?redirect=paycalc (added after this suite was first written).
    // Seed a session so the page runs its own init and builds the period <select>.
    await seedSession(page);
    await page.goto('/paycalc.html');

    // Proof we were NOT redirected — the guard let us through.
    await expect(page).toHaveURL(/paycalc\.html$/);

    // #periodSelect is in the static HTML but its <option>s are added by JS
    // from getPeriods(). toBeAttached() retries until an <option> is present in
    // the DOM — option elements have no bounding box so toBeVisible() is
    // unreliable. Once the first option is attached all options are there
    // (the function is synchronous).
    await expect(page.locator('#periodSelect option').first()).toBeAttached();
    const count = await page.locator('#periodSelect option').count();
    expect(count, '#periodSelect should have pay period options').toBeGreaterThan(10);

    expect(errors, 'Uncaught JS exceptions on paycalc.html').toHaveLength(0);
});

// Desktop layout regression: the two-column grid must keep the right-column card
// stack compact. The bug (fixed v14.32): #hoursCard shared grid row 4 with the
// short #settingsCard, so the tall Hours card inflated row 4 and left a large
// blank gap under Settings before Payslip could appear. A passing maths/unit
// suite never caught it — only a rendered desktop viewport does.
for (const width of [1280, 1440]) {
    test(`paycalc desktop @${width}px: compact right column, no horizontal overflow`, async ({ page }) => {
        await page.setViewportSize({ width, height: 1000 });
        await seedSession(page);
        // Suppress the one-time notices so we measure the underlying layout.
        await page.addInitScript(() => {
            localStorage.setItem('myb_pc_pay_welcome_shown', '1');
            localStorage.setItem('myb_pc_ytd_notice_shown', '1');
            localStorage.setItem('myb_pc_ns_migrated', '1');
        });
        await page.goto('/paycalc.html');
        await expect(page.locator('#settingsCard')).toBeVisible();
        // The roster-assist hint loads asynchronously and changes the Hours card
        // height, which redistributes the spanning grid; let the layout settle so
        // the measurement is stable rather than catching a mid-render frame.
        await page.waitForTimeout(800);

        const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, 'no horizontal overflow on desktop').toBeLessThanOrEqual(1);

        // The gap between Settings and the next right-column card guards the v14.32
        // bug: #hoursCard sharing a single grid row with #settingsCard inflated that
        // row to the tall Hours card's height, leaving ~530px of dead space under
        // Settings. The row-span fix keeps it small. Threshold is deliberately loose
        // (catches the half-screen bug, tolerates the small content-dependent
        // distribution inherent to spanning a tall card across the right stack).
        const gap = await page.evaluate(() => {
            const s = document.getElementById('settingsCard').getBoundingClientRect();
            const p = document.getElementById('payslipCard').getBoundingClientRect();
            return p.top - (s.top + s.height);
        });
        expect(gap, 'no half-screen gap under Settings (the v14.32 grid bug)').toBeLessThan(160);

        // The sticky result card is the primary desktop output — must be on-screen.
        await expect(page.locator('.result-card')).toBeInViewport();
    });
}

// One-time notices must not stack: with legacy data pending AND the welcome notice
// unseen, only the data-ownership prompt (highest priority) should open — not both.
test('paycalc: one-time notices do not stack (data-ownership prompt wins)', async ({ page }) => {
    await seedSession(page);   // signs in as a real member (G. Miller)
    await page.addInitScript(() => {
        // Genuine unnamespaced legacy pay data → migration pending. Welcome unseen →
        // without the priority guard, both the welcome AND data-ownership lightboxes
        // would call .open() in the same startup tick.
        localStorage.setItem('myb_pc_rate', '20.74');
        localStorage.removeItem('myb_pc_pay_welcome_shown');
        localStorage.removeItem('myb_pc_ns_migrated');
    });
    await page.goto('/paycalc.html');

    await expect(page.locator('#dataOwnerLightbox.visible')).toBeVisible();
    await expect(page.locator('.lb-overlay.visible'), 'exactly one overlay open').toHaveCount(1);
    await expect(page.locator('#welcomeLightbox.visible'), 'welcome suppressed').toHaveCount(0);
});

// ── SETTINGS (settings.html) ──────────────────────────────────────────────

test('settings: login overlay renders with JS-populated grade options', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.goto('/settings.html');

    await expect(page.locator('#loginOverlay')).toBeVisible();

    const gradeCount = await page.locator('#loginGrade option').count();
    expect(gradeCount, '#loginGrade should have JS-added grade options').toBeGreaterThan(1);

    expect(errors, 'Uncaught JS exceptions on settings.html').toHaveLength(0);
});

test('settings (signed in): card "?" button opens the Tips lightbox, not the card', async ({ page }) => {
    // Regression guard for the per-card Tips wiring. The logged-out tests above
    // never run initApp(), so a break in the signed-in path (e.g. a throw before
    // initCardCollapse wires the Work Email header) would ship unnoticed —
    // clicking "?" would then fall through to the header and toggle the card
    // collapse instead of opening the tips. This test exercises that path.
    const errors = collectFatalErrors(page);

    // Seed a valid session so the page runs initApp() instead of the login overlay.
    await seedSession(page);
    await page.goto('/settings.html');

    // Proof that initApp() → initContactCard() → initCardCollapse() ran: the
    // collapse helper sets aria-expanded on the Work Email header synchronously
    // (to "false" since the card starts collapsed). The static HTML has no
    // aria-expanded attribute, so its presence proves the signed-in init wired
    // the header — meaning the "?" handler is in place and the click below
    // cannot race the wiring. (The earlier "none" faith-radio anchor was removed
    // when the cultural calendar card was retired at v13.23.)
    await expect(page.locator('#contactToggleHeader')).toHaveAttribute('aria-expanded', 'false');

    // The Work Email card starts collapsed and the tips overlay starts hidden.
    await expect(page.locator('#tipsLightbox')).toBeHidden();
    await expect(page.locator('#contactBody')).not.toHaveClass(/\bopen\b/);

    await page.locator('.btn-card-tips[data-card="work-email"]').click();

    // The Tips lightbox must open with the right content …
    await expect(page.locator('#tipsLightbox')).toBeVisible();
    await expect(page.locator('#tipsLbTitle')).toHaveText('Work Email');
    // … and the card MUST NOT have toggled open (the reported bug symptom).
    await expect(page.locator('#contactBody')).not.toHaveClass(/\bopen\b/);

    expect(errors, 'Uncaught JS exceptions on signed-in settings.html').toHaveLength(0);
});

// ── OPERATIONS (operations.html) ──────────────────────────────────────────

test('operations: JS runs and redirects unauthenticated users to admin.html', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.goto('/operations.html');
    // operations-app.js redirects immediately when no admin session exists —
    // landing on admin.html proves the module loaded and executed without crashing.
    await expect(page).toHaveURL(/admin\.html/);
    expect(errors, 'Uncaught JS exceptions triggering operations redirect').toHaveLength(0);
});

// ── LINKS (links.html) ────────────────────────────────────────────────────

test('links: JS runs and redirects unauthenticated users to admin.html', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.goto('/links.html');
    // links-app.js redirects immediately when the user is not a links designer —
    // landing on admin.html proves the module loaded and executed without crashing.
    await expect(page).toHaveURL(/admin\.html/);
    expect(errors, 'Uncaught JS exceptions triggering links redirect').toHaveLength(0);
});
