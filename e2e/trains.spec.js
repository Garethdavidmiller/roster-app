// @ts-check
/**
 * e2e/trains.spec.js — the Trains page, driven through the real coordinator (trains-app.js).
 *
 * trains-change.test.mjs proves the RULES on small tables. This proves the WIRING: that the page
 * the admin opens actually renders those answers for the chosen day and direction, that the
 * lookup reaches them, and that the preview stays a preview — nobody else is shown the pill, and
 * a member who types the URL is sent back to the roster. Deleting the `renderChoice` call from a
 * button handler, or passing the wrong direction to `changeLabel`, leaves every unit test green.
 */
import { test, expect } from './fixtures.js';
import { collectFatalErrors, seedSession } from './helpers.js';

test.describe('trains', () => {
    test('the admin sees the change, and the day and direction choices drive every card', async ({ page }) => {
        const errors = collectFatalErrors(page);
        // A Wednesday, so the page opens on Weekdays.
        await page.clock.setFixedTime(new Date('2026-10-07T09:00:00Z'));
        await seedSession(page, 'G. Miller');
        await page.goto('/trains.html');

        await expect(page.locator('#trCountdown')).toHaveText('New timetable · 67 days to go');
        await expect(page.locator('#trTotals tbody tr').first()).toContainText('146');
        await expect(page.locator('#trTotals tbody tr').first()).toContainText('157');
        await expect(page.locator('[data-day="SX"]')).toHaveAttribute('aria-pressed', 'true');

        // A route's own list, with the rerouted train shown on its own side only.
        const banbury = page.locator('#trRoutes .tr-route', { has: page.locator('.tr-route-name', { hasText: /^Banbury$/ }) });
        await banbury.locator('.tr-route-sum').click();
        const row1036 = banbury.locator('.tr-trains tbody tr', { hasText: '10:36' });
        await expect(row1036).toContainText('Now runs to Birmingham Snow Hill');
        await expect(row1036.locator('td').nth(1)).toHaveText('—none');

        // Arriving rewords the card and the chips.
        await page.locator('[data-dir="arr"]').click();
        await expect(page.locator('[data-dir="arr"]')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('#trRoutesTitle')).toHaveText('Where trains come from');
        await expect(page.locator('#trRoutes')).toContainText('Now comes from Banbury, 09:12');

        // Saturdays: a different basic hour (Birmingham gains a :32).
        await page.locator('[data-dir="dep"]').click();
        await page.locator('[data-day="SO"]').click();
        const bmo = page.locator('#trPattern tbody tr', { hasText: 'Birmingham Moor Street' });
        await expect(bmo).toContainText(':02 :32');
        await expect(bmo).toContainText('Changed');

        // The lookup answers the exact train in a sentence, for the day now chosen.
        await page.locator('[data-day="SX"]').click();
        await page.locator('#trLookupInput').fill('1036');
        await expect(page.locator('#trLookupResult .tr-answer').first())
            .toHaveText('The 10:36 to Banbury: Now runs to Birmingham Snow Hill.');
        await page.locator('#trLookupInput').fill('noon');
        await expect(page.locator('#trLookupResult')).toContainText('Type a time like 17:15');

        expect(errors).toHaveLength(0);
    });

    test('the pill is offered to the admin only, and a member who types the URL goes to the roster', async ({ page }) => {
        await seedSession(page, 'G. Miller');
        await page.goto('/settings.html');
        await page.locator('#navMenuBtn').click();
        await expect(page.locator('.nav-panel-pill--trains')).toHaveCount(1);

        await seedSession(page, 'C. Reen');
        await page.goto('/settings.html');
        await page.locator('#navMenuBtn').click();
        await expect(page.locator('.nav-panel-pill--trains')).toHaveCount(0);

        await page.goto('/trains.html');
        await expect(page).not.toHaveURL(/trains\.html/);
    });
});
