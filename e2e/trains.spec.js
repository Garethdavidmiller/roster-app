// @ts-check
/**
 * e2e/trains.spec.js — the Trains page, driven through the real coordinator (trains-app.js).
 *
 * trains-change.test.mjs proves the RULES on small tables. This proves the WIRING: that the page
 * the admin opens actually renders those answers for the chosen day and direction, that the
 * views and lookup reach them, and that the preview stays a preview — nobody else is shown the pill, and
 * a member who types the URL is sent back to the roster. Opening the wrong view from a headline, or
 * summarising the wrong direction for Coming back, leaves every unit test green.
 */
import { test, expect } from './fixtures.js';
import { collectFatalErrors, seedSession } from './helpers.js';

test.describe('trains', () => {
    test('the admin sees what changes, opens a station from it, and the day drives every view', async ({ page }) => {
        const errors = collectFatalErrors(page);
        // A Wednesday, so the page opens on Weekdays.
        await page.clock.setFixedTime(new Date('2026-10-07T09:00:00Z'));
        await seedSession(page, 'G. Miller');
        await page.goto('/trains.html');

        await expect(page.locator('#trCountdown')).toHaveText('67 days to go');
        await expect(page.locator('#trTotals tbody tr').first()).toContainText('146');
        await expect(page.locator('#trTotals tbody tr').first()).toContainText('157');
        await expect(page.locator('[data-day="SX"]')).toHaveAttribute('aria-pressed', 'true');

        // What's changing: sentences, biggest first, and a tap opens that station.
        const heads = page.locator('#trChanges .tr-head');
        await expect(heads.first()).toHaveText(/Stratford-upon-Avon gets direct trains \(1 a day\)/);
        await expect(page.locator('#trChanges')).toContainText('once Chiltern publishes December’s stops');
        await page.locator('#trChanges .tr-head', { hasText: 'Aylesbury:' }).click();
        await expect(page.locator('[data-view="stations"]')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('#trViewChanges')).toBeHidden();
        await expect(page.locator('#trStationTitle')).toHaveText('Aylesbury');
        await expect(page.locator('#trStation .tr-verdict')).toHaveText('5 more trains a day — the off-peak hour stays the same.');
        const daily = page.locator('#trStation .tr-st-table tbody tr', { hasText: 'Trains a day' });
        await expect(daily.locator('td').nth(0)).toHaveText('41');
        await expect(daily.locator('td').nth(1)).toHaveText('46');

        // Coming back rewords the card and recounts it for trains INTO Marylebone.
        await page.locator('[data-sdir="arr"]').click();
        await expect(page.locator('#trStation')).toContainText('Gets into Marylebone at');
        await expect(page.locator('#trStation .tr-verdict')).toHaveText('4 more trains a day — the off-peak hour stays the same.');
        await page.locator('#trStation .tr-route-sum').click();
        await expect(page.locator('#trStation .tr-trains tbody tr').first()).toBeVisible();

        // A station trains pass THROUGH cannot be answered for December yet, and says so rather
        // than counting only the trains that end there.
        await page.locator('[data-sdir="dep"]').click();
        await page.locator('#trStationInput').fill('gerr');
        await page.locator('#trStationPicks .tr-pick', { hasText: 'Gerrards Cross' }).click();
        await expect(page.locator('#trStation .tr-verdict')).toContainText('December stops not published yet');
        await expect(page.locator('#trStation .tr-st-table tbody tr', { hasText: 'Trains a day' }).locator('td').nth(1)).toHaveText('—none');
        await expect(page.locator('#trStation .tr-route')).toHaveCount(0);

        // The basic hour: today's stops as dots, and Saturdays' December hour gains a :32 to Birmingham.
        await page.locator('[data-view="grid"]').click();
        await page.locator('[data-grid="now"]').click();
        const ger = page.locator('#trPattern tbody tr', { hasText: 'Gerrards Cross' });
        await expect(ger.locator('.tr-dot')).toHaveCount(3);
        await page.locator('[data-day="SO"]').click();
        await page.locator('[data-grid="dec"]').click();
        await expect(page.locator('#trPattern thead')).toContainText(':32');
        await expect(page.locator('#trPattern')).toContainText('stops are not published yet');

        // The lookup answers the exact train in a sentence, for the day now chosen.
        await page.locator('[data-day="SX"]').click();
        await page.locator('[data-view="changes"]').click();
        await page.locator('#trLookupInput').fill('1036');
        await expect(page.locator('#trLookupResult .tr-answer').first())
            .toHaveText('The 10:36 to Banbury: Now runs to Birmingham Snow Hill.');
        await page.locator('#trLookupInput').fill('noon');
        await expect(page.locator('#trLookupResult')).toContainText('Type a time like 17:15');

        // The `?` panels are wired — the page's caveats live there.
        await page.locator('.btn-card-tips[data-card="changes"]').click();
        await expect(page.locator('#tipsLbTitle')).toHaveText('🔔 What’s changing');
        await expect(page.locator('#tipsLbBody')).toContainText('only stations at the end of a line can be compared');

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
