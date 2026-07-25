import { test, expect, enforceNamedSession, enableInplaceLogin } from './fixtures.js';
import { collectFatalErrors, seedSession, seedMember, pickFirstMemberAndPassword, DESKTOP_WIDTHS, armEnforcementWithFailingSignIn, signInThroughOverlay } from './helpers.js';

// ── CALENDAR (index.html) ──────────────────────────────────────────────────

test('calendar: renders the current month from roster data', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await seedMember(page);   // saved member → render the grid, not the first-run prompt (H1)
    await page.goto('/');

    // .month-year is built entirely by JS — if this is visible, the whole
    // roster-data → buildCalendarContainer → renderCalendar pipeline ran.
    await expect(page.locator('.month-year')).toBeVisible();

    // At least one day cell must exist (the calendar grid rendered)
    await expect(page.locator('.calendar-day').first()).toBeVisible();

    expect(errors, 'Uncaught JS exceptions on index.html').toHaveLength(0);
});

test('calendar: first run (no saved member, not signed in) shows the choose-your-name prompt', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.goto('/');   // fresh context: no saved member, no session → first run
    // Prompt shows INSTEAD of a rendered roster.
    await expect(page.locator('.first-run-prompt')).toBeVisible();
    await expect(page.locator('.calendar-day')).toHaveCount(0);
    await expect(page.locator('#teamMemberSelect option').first()).toHaveText('— Choose your name —');
    // No default member leaked onto the print header (stampPrintDate + beforeprint must respect first run).
    expect(await page.locator('.header').getAttribute('data-member-name'),
        'first run must not stamp a member on the print header').toBeNull();
    // Picking a name renders the real calendar and clears the prompt (index 0 is the placeholder).
    await page.locator('#teamMemberSelect').selectOption({ index: 1 });
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    await expect(page.locator('.first-run-prompt')).toHaveCount(0);
    expect(errors, 'Uncaught JS exceptions on first-run calendar').toHaveLength(0);
});

test('calendar: first-run pick survives a failed localStorage write (iOS private mode)', async ({ page }) => {
    const errors = collectFatalErrors(page);
    // Simulate iOS Safari private mode: writing the selected-member key throws, so it never persists.
    // The in-memory backstop must still clear the first-run prompt and show the picked member's
    // calendar — otherwise the prompt re-appears on every render and the app is a dead-end.
    await page.addInitScript(() => {
        const realSet = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
            if (key === 'myb_roster_selected_member') throw new Error('QuotaExceededError (simulated private mode)');
            return realSet.call(this, key, value);
        };
    });
    await page.goto('/');
    await expect(page.locator('.first-run-prompt')).toBeVisible();
    await page.locator('#teamMemberSelect').selectOption({ index: 1 });
    // Pick sticks despite the write failure — calendar renders and the prompt is gone.
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    await expect(page.locator('.first-run-prompt')).toHaveCount(0);
    expect(errors, 'Uncaught JS exceptions in private-mode first-run').toHaveLength(0);
});

test('calendar: a removed saved member falls back to the calendar + stale banner, NOT the first-run prompt', async ({ page }) => {
    // Saved member that no longer exists in the roster (e.g. a leaver who was removed).
    await page.addInitScript(() => localStorage.setItem('myb_roster_selected_member', 'Z. Nonexistent'));
    await page.goto('/');
    // Regression: this must render the fallback (default) calendar, not the choose-your-name prompt —
    // the stale case had a saved member at load, so it's not a true first run.
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    await expect(page.locator('.first-run-prompt')).toHaveCount(0);
    await expect(page.locator('#errorBanner')).toContainText('no longer in the roster');
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

// Guide links navigate in the SAME window (v18.81 — was target="_blank", which from the installed
// PWA wrapped every guide in Android's Chrome Custom Tab / iOS's in-app Safari chrome: the "extra
// header at the top of all the guides" staff report). Assert: no popup, the SAME tab lands on the
// guide (after the drawer-close + open-counter defer), and the guide's ← back returns to the app.
test('calendar: a drawer guide link navigates same-tab (no new tab / Custom Tab)', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#teamMemberSelect option').first()).toBeAttached();
    await page.locator('#navMenuBtn').click();
    const guide = page.locator('.nav-panel-link--guide', { hasText: 'Staff & Admin Guide' });
    await expect(guide).toBeVisible();
    await expect(guide).not.toHaveAttribute('target', '_blank');
    let popupSeen = false;
    page.context().once('page', () => { popupSeen = true; });
    await guide.click();
    await page.waitForURL(/guide\.html/, { timeout: 4000 });     // same tab, after the ~120ms defer
    expect(popupSeen, 'no popup/new tab must open').toBe(false);
    await expect(page.locator('.page-header h1')).toContainText('Staff & Admin Guide');
});

