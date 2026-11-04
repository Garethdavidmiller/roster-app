// @ts-check
/**
 * newlink.spec.js — the new link page (newlink.html): the three shortlisted proposals, presented evenly, to the
 * admin while it is a preview.
 *
 * What only a browser can show: that the page REACHES its admin and turns everybody else away, that the two choices on it
 * redraw what they say they do, and that a proposal's weeks are drawn as a proposal. The words and figures themselves
 * are pinned in Node (newlink-render.test.mjs, newlink-data.test.mjs); this drives the real page through them.
 */
import { test, expect } from './fixtures.js';
import { collectFatalErrors, seedSession } from './helpers.js';

test.describe('new link', () => {
    test('the admin sees the preview, the three proposals A to Z, and no recommendation anywhere', async ({ page }) => {
        const errors = collectFatalErrors(page);
        await seedSession(page, 'G. Miller');
        await page.goto('/newlink.html');

        await expect(page.locator('#nlPreview')).toBeVisible();
        // the admin is told who else can see it: the one named previewer (CONFIG.NEWLINK_PREVIEW)
        await expect(page.locator('#nlPreview')).toContainText('Preview — only you and S. Silva can see this page.');
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

        // and a way back that says where it goes, landing on the tile that was chosen
        await earlies.click();
        await page.locator('[data-persona-reset]').click();
        await expect(panel.locator('.nl-gists li')).toHaveCount(6);
        await expect(earlies).toHaveAttribute('aria-pressed', 'false');
        await expect(earlies).toBeFocused();
    });

    test('the weeks are drawn as a proposal, 26 to a design: one at a time on a phone, all three side by side when wide', async ({ page }) => {
        await seedSession(page, 'G. Miller');
        await page.goto('/newlink.html');

        const weeks = page.locator('#nlWeeksPanel');
        await expect(weeks.locator('.nl-weeks-one')).toHaveCount(3);
        const chosen = weeks.locator('.nl-weeks-one.is-chosen');
        await expect(chosen.locator('.nl-flag')).toHaveText(/A proposal — not your roster/);
        await expect(chosen.locator('caption')).toContainText('Even Step');
        await expect(chosen.locator('tbody tr')).toHaveCount(26);
        await expect(chosen.locator('tbody tr.nl-wk-cover')).toHaveCount(5);
        // numbered, never dated
        await expect(chosen.locator('tbody th').first()).toHaveText('1');
        // the key comes before the weeks, and says Sunday is overtime
        await expect(page.locator('#nlWeeksKey')).toContainText('Sunday shifts are overtime');
        const keyBox = await page.locator('#nlWeeksKey').boundingBox();
        const panelBox = await weeks.boundingBox();
        expect(keyBox && panelBox && keyBox.y < panelBox.y).toBe(true);
        // each swatch wears its cells' edge — a `border` shorthand after the kind's colour once reset it to the text colour
        for (const kind of ['early', 'late']) {
            const edge = (/** @type {string} */ sel) => page.locator(sel).first().evaluate(n => getComputedStyle(n).borderTopColor);
            expect(await edge(`#nlWeeksKey .nl-swatch.nl-d--${kind}`), kind).toBe(await edge(`#nlWeeksPanel .is-chosen td.nl-d--${kind}`));
        }

        if ((page.viewportSize()?.width ?? 0) >= 1024) {
            // WIDE: the three side by side, no tabs — no proposal gets the first look
            await expect(page.locator('#nlWeeksTabs')).toBeHidden();
            const boxes = await Promise.all((await weeks.locator('.nl-weeks-one').all()).map(b => b.boundingBox()));
            expect(boxes.every(b => b && Math.abs(b.y - /** @type {any} */ (boxes[0]).y) < 2)).toBe(true);
            expect(boxes.map(b => b?.x)).toEqual([...boxes.map(b => b?.x)].sort((a, b) => (a ?? 0) - (b ?? 0)));
            return;
        }
        // A PHONE: the chosen one only, under tabs that change it
        await expect(weeks.locator('.nl-weeks-one:not(.is-chosen)').first()).toBeHidden();
        await page.locator('[data-design="proposal:IS-26-T4"]').click();
        await expect(page.locator('[data-design="proposal:IS-26-T4"]')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('[data-design="proposal:IS-26-T4"]')).toBeFocused();
        await expect(chosen.locator('caption')).toContainText('In Step');
        await expect(chosen.locator('tbody tr')).toHaveCount(26);
        // ...and the tabs stay in reach while the weeks scroll beneath them (a card with `overflow: hidden` would let
        // them scroll away — the cascade decides this, so only a browser can see it)
        await chosen.locator('tbody tr').nth(18).scrollIntoViewIfNeeded();
        await page.evaluate(() => window.scrollBy(0, 200));
        const tabs = await page.locator('#nlWeeksTabs').boundingBox();
        expect(tabs && tabs.y >= -1 && tabs.y < 4).toBe(true);
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

    test('a member who is neither the admin nor a previewer is sent back to the roster, and never sees the pill', async ({ page }) => {
        await seedSession(page, 'M. Robson');   // a Links designer: not enough — only the admin and CONFIG.NEWLINK_PREVIEW
        await page.goto('/newlink.html');
        await expect(page).toHaveURL(/\/$|\/index\.html$/);
        await page.locator('#navMenuBtn').click();
        await expect(page.locator('.nav-panel-pill--newlink')).toHaveCount(0);
    });

    test('a name tile opens that proposal\'s weeks, and the two logos do what they say', async ({ page }) => {
        const errors = collectFatalErrors(page);
        await seedSession(page, 'G. Miller');
        await page.goto('/newlink.html');

        // the tile for Short Run opens Short Run's weeks, even with the weeks card folded
        await page.locator('#nlWeeksChevron').click();
        await expect(page.locator('#nlWeeksBody')).not.toHaveClass(/\bopen\b/);
        await page.locator('[data-open-weeks="proposal:SR-26-F1"]').click();
        await expect(page.locator('#nlWeeksBody')).toHaveClass(/\bopen\b/);
        await expect(page.locator('#nlWeeksPanel .is-chosen caption')).toContainText('Short Run');
        await expect(page.locator('[data-design="proposal:SR-26-F1"]')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('#nlWeeksPanel .is-chosen caption')).toBeInViewport();

        // "Have your say" at the top opens its card, folded or not, and takes the reader there
        await page.locator('#nlSayChevron').click();
        await expect(page.locator('#nlSayBody')).not.toHaveClass(/\bopen\b/);
        await page.locator('#nlStatus [data-open-card="nlSay"]').click();
        await expect(page.locator('#nlSayBody')).toHaveClass(/\bopen\b/);
        await expect(page.locator('#nlSayCard h2')).toBeFocused();
        // who leads the change: S. Silva, as the RMT rep — never the admin; and how the choice is made is left vague (owner, 4 Nov 2026)
        await expect(page.locator('#nlSayList')).toContainText('S. Silva, the RMT rep, is leading the change.');
        await expect(page.locator('#nlSayCard')).not.toContainText(/admin|managers decide/i);
        await expect(page.locator('#nlSayCard')).toBeInViewport();

        // the drawer's logo opens About — it threw, while the page took initAboutLightbox's object for a function
        await page.locator('#navMenuBtn').click();
        await page.locator('#navPanelBrand').click();
        await expect(page.locator('#iconLightbox')).toBeVisible();
        await expect(page.locator('#iconLightbox .lightbox-badge')).toHaveText('New link');
        await page.locator('#iconLightboxClose').click();

        // the header logo goes back to the Calendar, as its alt text has always said — and the test waits
        // for the Calendar to DRAW: it used to end the moment the URL changed, with the Calendar's modules
        // still loading through the suite's routes, which failed it once in a full run (v25.20). Its grid
        // or its member card, whichever this harness earns: there is no Firebase identity here, so the
        // Calendar asks this member to sign in again, which is the right answer to that.
        await expect(page.locator('#appIcon')).toHaveAttribute('role', 'button');
        await page.locator('#appIcon').click();
        await expect(page).toHaveURL(/\/$/);
        await expect(page.locator('.calendar-day, #calLockWhy:not(:empty)').first()).toBeVisible();
        expect(errors).toEqual([]);
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

    // S. Silva is the new link's contact (newlink-config.js → CONTACT), and may see the preview before colleagues do
    // (owner, 4 Nov 2026: "open up the new links page to S. Silva"; CONFIG.NEWLINK_PREVIEW).
    test('S. Silva reaches it from the drawer too, and the banner names the admin as the one other reader', async ({ page }) => {
        await seedSession(page, 'S. Silva');
        await page.goto('/admin.html');
        await page.locator('#navMenuBtn').click();
        const pill = page.locator('.nav-panel-pill--newlink');
        await expect(pill).toBeVisible();
        await pill.click();
        await expect(page).toHaveURL(/newlink\.html$/);
        await expect(page.locator('.nl-name-title').first()).toHaveText('Even Step');
        await expect(page.locator('#nlPreview')).toContainText('Preview — only you and the admin can see this page.');
    });
});
