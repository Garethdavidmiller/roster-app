// @ts-check
/**
 * newlink.spec.js — the December link page (newlink.html): the three shortlisted proposals, presented evenly, to the
 * admin while it is a preview.
 *
 * What only a browser can show: that the page REACHES its admin and turns everybody else away, that the two choices on it
 * redraw what they say they do, and that a proposal's weeks are drawn as a proposal. The words and figures themselves
 * are pinned in Node (newlink-render.test.mjs, newlink-data.test.mjs); this drives the real page through them.
 */
import { test, expect } from './fixtures.js';
import { collectFatalErrors, seedSession } from './helpers.js';

test.describe('december link', () => {
    test('the admin sees the preview, the three proposals A to Z, and no recommendation anywhere', async ({ page }) => {
        const errors = collectFatalErrors(page);
        await seedSession(page, 'G. Miller');
        await page.goto('/newlink.html');

        await expect(page.locator('#nlPreview')).toBeVisible();
        await expect(page.locator('#nlPreview')).toContainText('Preview — only you can see this page');
        // the stand-in audience: every CEA on the roster, listed for the admin to check
        await expect(page.locator('#nlPreview')).toContainText('every CEA on the roster');
        await expect(page.locator('.nl-name-title')).toHaveText(['Even Step', 'In Step', 'Short Run']);
        await expect(page.locator('#nlStatus')).toContainText('Have your say by a date to be agreed');
        // EVENLY: nothing on the page names a recommendation (owner, 2 Nov 2026: "No, three evenly")
        await expect(page.locator('main')).not.toContainText(/recommend/i);
        // what has changed since Short Run was shown, and what all three share — gains AND costs
        await expect(page.locator('#nlChangesList li')).toHaveCount(5);
        await expect(page.locator('.nl-side--gain li').first()).toBeVisible();
        await expect(page.locator('.nl-side--cost li').first()).toBeVisible();
        expect(errors).toEqual([]);
    });

    test('choosing a way of working shows its sentence and figures; Everything shows all six; pressing again goes back', async ({ page }) => {
        await seedSession(page, 'G. Miller');
        await page.goto('/newlink.html');

        const panel = page.locator('#nlPersonaPanel');
        // nothing chosen: the six one-line answers
        await expect(panel.locator('.nl-gists li')).toHaveCount(6);

        const earlies = page.locator('[data-persona="earlies"]');
        await earlies.click();
        await expect(earlies).toHaveAttribute('aria-pressed', 'true');
        await expect(earlies).toBeFocused();   // the redraw keeps focus on the pressed tile
        await expect(panel.locator('.nl-persona')).toHaveCount(1);
        await expect(panel.locator('.nl-persona-h')).toHaveText(/If you prefer earlies/);
        await expect(panel.locator('thead th')).toHaveText(['Today', 'Even Step', 'In Step', 'Short Run']);
        await expect(panel.locator('.nl-best').first()).toBeVisible();

        await page.locator('[data-persona="all"]').click();
        await expect(panel.locator('.nl-persona')).toHaveCount(6);
        await expect(earlies).toHaveAttribute('aria-pressed', 'false');

        await page.locator('[data-persona="all"]').click();
        await expect(panel.locator('.nl-gists li')).toHaveCount(6);
    });

    test('the weeks are drawn as a proposal, 26 to a design, and the tabs change the design', async ({ page }) => {
        await seedSession(page, 'G. Miller');
        await page.goto('/newlink.html');

        const weeks = page.locator('#nlWeeksPanel');
        await expect(weeks.locator('.nl-flag')).toHaveText(/A proposal — not your roster/);
        await expect(weeks.locator('caption')).toContainText('Even Step');
        await expect(weeks.locator('tbody tr')).toHaveCount(26);
        await expect(weeks.locator('tbody tr.nl-wk-cover')).toHaveCount(5);
        // numbered, never dated
        await expect(weeks.locator('tbody th').first()).toHaveText('1');

        await page.locator('[data-design="proposal:IS-26-T4"]').click();
        await expect(page.locator('[data-design="proposal:IS-26-T4"]')).toHaveAttribute('aria-pressed', 'true');
        await expect(weeks.locator('caption')).toContainText('In Step');
        await expect(weeks.locator('tbody tr')).toHaveCount(26);
    });

    test('the pack opens each PDF in a new tab from where docs/ is served', async ({ page }) => {
        await seedSession(page, 'G. Miller');
        await page.goto('/newlink.html');
        const links = page.locator('#nlPackList a.nl-file');
        await expect(links).toHaveCount(7);
        for (const a of await links.all()) {
            await expect(a).toHaveAttribute('target', '_blank');
            await expect(a).toHaveAttribute('href', /^https:\/\/garethdavidmiller\.github\.io\/roster-app\/docs\/links-26\/.+\.pdf$/);
        }
    });

    test('a member who is not the admin is sent back to the roster, and never sees the pill', async ({ page }) => {
        await seedSession(page, 'S. Silva');   // a Links designer, not the admin
        await page.goto('/newlink.html');
        await expect(page).toHaveURL(/\/$|\/index\.html$/);
        await page.locator('#navMenuBtn').click();
        await expect(page.locator('.nav-panel-pill--newlink')).toHaveCount(0);
    });

    test('the admin reaches it from the drawer', async ({ page }) => {
        await seedSession(page, 'G. Miller');
        await page.goto('/admin.html');
        await page.locator('#navMenuBtn').click();
        const pill = page.locator('.nav-panel-pill--newlink');
        await expect(pill).toBeVisible();
        await pill.click();
        await expect(page).toHaveURL(/newlink\.html$/);
        await expect(page.locator('.nl-name-title').first()).toHaveText('Even Step');
    });
});
