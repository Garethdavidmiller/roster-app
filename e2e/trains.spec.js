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
        await expect(heads.first()).toHaveText(/Stratford-upon-Avon gets a direct train from Marylebone \(the 09:31\)/);
        await expect(page.locator('#trChanges')).toContainText('once Chiltern publishes December’s stops');
        await page.locator('#trChanges .tr-head', { hasText: 'Aylesbury:' }).click();
        await expect(page.locator('[data-view="stations"]')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('#trViewChanges')).toBeHidden();
        await expect(page.locator('#trStationTitle')).toHaveText('Aylesbury');
        await expect(page.locator('#trStation .tr-verdict')).toHaveText('5 more trains a day: 46, was 41.');
        const daily = page.locator('#trStation .tr-st-table tbody tr', { hasText: 'Trains a day' });
        await expect(daily.locator('td').nth(0)).toHaveText('41');
        await expect(daily.locator('td').nth(1)).toHaveText('46');
        // Today two off-peak hours have one Aylesbury train; December fills them. An average of 2
        // hid that, so the range is shown.
        const hourly = page.locator('#trStation .tr-st-table tbody tr', { hasText: 'Off-peak, trains an hour' });
        await expect(hourly.locator('td').nth(0)).toHaveText('1 to 2');
        await expect(hourly.locator('td').nth(1)).toHaveText('2');

        // Coming back rewords the card and recounts it for trains INTO Marylebone.
        await page.locator('[data-sdir="arr"]').click();
        await expect(page.locator('#trStation')).toContainText('Off-peak, gets into Marylebone at');
        await expect(page.locator('#trStation .tr-verdict')).toHaveText('4 more trains a day: 41, was 37.');
        // Train by train: only the trains that change, the rest one tap away.
        await page.locator('#trStation .tr-route-sum').click();
        await expect(page.locator('#trStation .tr-trains tbody tr').first()).toBeVisible();
        await expect(page.locator('#trStation .tr-trains')).not.toContainText('No change');
        const changedRows = await page.locator('#trStation .tr-trains tbody tr').count();
        await page.locator('#trAllTrains').click();
        await expect(page.locator('#trStation .tr-route')).toHaveAttribute('open', '');
        await expect(page.locator('#trStation .tr-trains')).toContainText('No change');
        expect(await page.locator('#trStation .tr-trains tbody tr').count()).toBeGreaterThan(changedRows);
        await expect(page.locator('#trStation .tr-trains')).toContainText('from Parkway');

        // A station trains pass THROUGH cannot be answered for December yet, and says so rather
        // than counting only the trains that end there.
        await page.locator('[data-sdir="dep"]').click();
        await page.locator('#trStationInput').fill('gerr');
        await page.locator('#trStationPicks .tr-pick', { hasText: 'Gerrards Cross' }).click();
        await expect(page.locator('#trStation .tr-verdict')).toContainText('December not known yet');
        await expect(page.locator('#trStation .tr-st-table tbody tr', { hasText: 'Trains a day' }).locator('td').nth(1)).toHaveText('—not known yet');
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
            .toHaveText('The 10:36 to Banbury: Will run to Birmingham Snow Hill.');
        await page.locator('#trLookupInput').fill('noon');
        await expect(page.locator('#trLookupResult')).toContainText('Type a time like 17:15');

        // The `?` panels are wired — the page's caveats live there.
        await page.locator('.btn-card-tips[data-card="changes"]').click();
        await expect(page.locator('#tipsLbTitle')).toHaveText('🔔 What’s changing');
        await expect(page.locator('#tipsLbBody')).toContainText('only stations at the end of a line can be compared');

        expect(errors).toHaveLength(0);
    });

    // Every view at phone width, with the widest content each holds open. The basic-hour grid
    // scrolls inside its own box, and v24.74 shipped with its screen-reader words escaping that box
    // and stretching the PAGE to 444px on a 390px phone — the whole page scrolled sideways.
    for (const width of [360, 390]) {
        test(`no view scrolls the page sideways at ${width}px`, async ({ page }) => {
            await page.setViewportSize({ width, height: 800 });
            await seedSession(page, 'G. Miller');
            await page.goto('/trains.html');
            const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
            await expect(page.locator('#trChanges .tr-head').first()).toBeVisible();
            await page.locator('#trLookupInput').fill('1036');
            expect(await overflow(), 'What’s changing').toBeLessThanOrEqual(1);
            await page.locator('#trChanges .tr-head', { hasText: 'Aylesbury:' }).click();
            await page.locator('#trStation .tr-route-sum').click();
            await page.locator('#trAllTrains').click();
            expect(await overflow(), 'a station, every train').toBeLessThanOrEqual(1);
            await page.locator('[data-view="grid"]').click();
            for (const mode of ['now', 'dec']) {
                await page.locator(`[data-grid="${mode}"]`).click();
                await expect(page.locator('#trPattern .tr-dot').first()).toBeVisible();
                expect(await overflow(), `basic hour, ${mode}`).toBeLessThanOrEqual(1);
            }
        });
    }

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
