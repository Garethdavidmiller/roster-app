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

test('paycalc: pay period selector is populated', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.goto('/paycalc.html');

    // #periodSelect is in the static HTML but its <option>s are added by JS
    // from getPaydaysAndCutoffs(). toBeAttached() retries until an <option> is
    // present in the DOM — option elements have no bounding box so toBeVisible()
    // is unreliable. Once the first option is attached all options are there
    // (the function is synchronous).
    await expect(page.locator('#periodSelect option').first()).toBeAttached();
    const count = await page.locator('#periodSelect option').count();
    expect(count, '#periodSelect should have pay period options').toBeGreaterThan(10);

    expect(errors, 'Uncaught JS exceptions on paycalc.html').toHaveLength(0);
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
    // Regression guard for the v12.68/69 initApp() restructure. The logged-out
    // tests above never run initApp(), so a real break in the signed-in path
    // (e.g. a throw before initTipsLightbox wires the "?" buttons) would ship
    // unnoticed — clicking "?" would then fall through to the header and toggle
    // the card collapse instead of opening the tips. This test exercises that path.
    const errors = collectFatalErrors(page);

    // Seed a valid session so the page runs initApp() instead of the login overlay.
    // Shape must match session.js: { name, ver: SESSION_VER (2), expiry, lastActivity }.
    await page.addInitScript(() => {
        localStorage.setItem('myb_admin_session', JSON.stringify({
            name: 'G. Miller',
            ver: 2,
            expiry: Date.now() + 30 * 24 * 60 * 60 * 1000,
            lastActivity: Date.now(),
        }));
    });
    await page.goto('/settings.html');

    // Proof that initApp() ran to completion: initCulturalCalendarCard() checks the
    // "none" faith radio synchronously, and initTipsLightbox() runs in the same
    // synchronous tick immediately after — so once this is checked, the "?" buttons
    // are wired and the click below cannot race the wiring.
    await expect(page.locator('input[name="faithCalendar"][value="none"]')).toBeChecked();

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
