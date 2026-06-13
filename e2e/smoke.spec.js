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
 * Firebase connection errors are intentionally ignored: the app is offline-
 * first and Firebase is unavailable in the local test environment (the API key
 * is restricted to specific referrer domains). We verify the UI, not Firestore.
 *
 * Run: npx playwright test
 */

import { test, expect } from '@playwright/test';

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
            msg.toLowerCase().includes('failed to fetch')
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
