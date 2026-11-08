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
import { CHANGES, PACK } from '../newlink-data.js';
import { teamMembers } from '../roster-data.js';

test.describe('new link', () => {
    test('the admin sees the preview, the three proposals A to Z, and no recommendation anywhere', async ({ page }) => {
        const errors = collectFatalErrors(page);
        await seedSession(page, 'G. Miller');
        await page.goto('/newlink.html');

        await expect(page.locator('#nlPreview')).toBeVisible();
        // the admin is told who else can see it: the one named previewer (CONFIG.NEWLINK_PREVIEW)
        await expect(page.locator('#nlPreview')).toContainText('Preview — only you and S. Silva can see this page.');
        // the stand-in audience: everyone on a normal CEA contract, listed for the admin to check — and nobody on a CEA
        // bilingual contract, which keeps its own links (owner, 8 Nov 2026: "This link will only apply to people with the
        // normal CEA contract and NOT the bilingual contract who will still have their own links")
        await expect(page.locator('#nlPreview')).toContainText('everyone on a normal CEA contract');
        await expect(page.locator('#nlPreview')).toContainText('those on a CEA bilingual contract keep their own links');
        const bilingual = teamMembers.filter(m => m.role === 'CEA' && m.bilingualContract && !m.hidden).map(m => m.name);
        expect(bilingual.length, 'a CEA bilingual contract on the roster for the page to leave out').toBeGreaterThan(0);
        for (const name of bilingual) await expect(page.locator('#nlPreview .nl-preview-who')).not.toContainText(name);
        await expect(page.locator('.nl-name-title')).toHaveText(['Balanced V6', 'Level Crossing', 'Middle Ground']);
        await expect(page.locator('#nlStatus')).toContainText('Have your say by a date to be agreed');
        // EVENLY: nothing on the page names a recommendation (owner, 2 Nov 2026: "No, three evenly")
        await expect(page.locator('main')).not.toContainText(/recommend/i);
        // what has changed since Short Run was shown, and what all three share — gains AND costs
        await expect(page.locator('#nlChangesList li')).toHaveCount(CHANGES.length);   // every line the data holds, however many
        await expect(page.locator('.nl-side--gain li').first()).toBeVisible();
        await expect(page.locator('.nl-side--cost li').first()).toBeVisible();
        expect(errors).toEqual([]);
    });

    // The page passes TODAY to the status line (test audit, 7 Nov 2026). The tenses are renderStatus's unit tests; what only
    // a browser can show is that the page hands it the real date — before this it had no date logic at all, and once the
    // link's start had come it would still have said the link "starts on" it.
    for (const [day, says, never] of /** @type {[string, RegExp|null, RegExp][]} */ ([
        ['2026-12-20T09:00:00Z', /The new link starts in January\s2027\. The new timetable started in December, and today’s link carries on until then\./, /comes first/],
        ['2027-01-04T09:00:00Z', null, /starts (on|in)|carries on until then/],
    ])) {
        test(`the status line on ${day.slice(0, 10)} speaks of the dates as they then are`, async ({ page }) => {
            await page.clock.setFixedTime(new Date(day));
            await seedSession(page, 'G. Miller');
            await page.goto('/newlink.html');
            const status = page.locator('#nlStatus');
            await expect(status).toContainText('Nothing is decided.');
            if (says) await expect(status).toContainText(says);
            await expect(status).not.toContainText(never);
        });
    }

    // AN INSTALLED APP IS NOT RELOADED WHEN IT IS REOPENED (iPhone audit, Nov 2026): iOS keeps it resident for days, and
    // the status was worked out once, at load. It is drawn again whenever the page comes back — and only when the day
    // has moved, so a tile holding focus on a same-day return keeps it.
    test('the status line is drawn again when the page comes back on a later day', async ({ page }) => {
        const setVisibility = (/** @type {'hidden'|'visible'} */ state) => page.evaluate((s) => {
            Object.defineProperty(document, 'visibilityState', { value: s, configurable: true });
            document.dispatchEvent(new Event('visibilitychange'));
        }, state);
        await page.clock.setFixedTime(new Date('2026-12-20T09:00:00Z'));
        await seedSession(page, 'G. Miller');
        await page.goto('/newlink.html');
        const status = page.locator('#nlStatus');
        await expect(status).toContainText('The new timetable started in December, and today’s link carries on until then.');

        // The same day: nothing is redrawn, so the tile with focus still has it.
        await status.locator('.nl-name').first().focus();
        await setVisibility('hidden');
        await page.clock.setFixedTime(new Date('2026-12-20T11:00:00Z'));
        await setVisibility('visible');
        await expect(status.locator('.nl-name').first()).toBeFocused();

        // A fortnight later, the link has started: the sentence about it goes.
        await setVisibility('hidden');
        await page.clock.setFixedTime(new Date('2027-01-04T09:00:00Z'));
        await setVisibility('visible');
        await expect(status).not.toContainText(/starts (on|in)|carries on until then/);
        await expect(status).toContainText('Nothing is decided.');
        await expect(status.locator('.nl-name'), 'the tiles are drawn again, and still open their weeks').toHaveCount(3);
        await status.locator('.nl-name').first().click();
        await expect(page.locator('#nlWeeksStatus')).toContainText('Showing Balanced V6’s');
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
        await expect(panel.locator('thead th')).toHaveText(['Today', 'Balanced V6', 'Level Crossing', 'Middle Ground']);
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
        // the first A to Z, never the recommendation — the page presents the three evenly
        await expect(chosen.locator('caption')).toContainText('Balanced V6');
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
            // THE LEFT-HAND GRID IS BALANCED V6 (owner, 8 Nov 2026: "make the balanced v5 option as the left hand grid on
            // desktop. I must not be seen to be favouring my designs over Sara's"). A to Z puts it there; this keeps it there
            const grids = await Promise.all((await weeks.locator('.nl-weeks-one').all())
                .map(async g => ({ x: (await g.boundingBox())?.x ?? 0, name: await g.locator('caption').innerText() })));
            expect(grids.sort((a, b) => a.x - b.x)[0].name).toContain('Balanced V6');
            return;
        }
        // A PHONE: the chosen one only, under tabs that change it
        await expect(weeks.locator('.nl-weeks-one:not(.is-chosen)').first()).toBeHidden();
        await page.locator('[data-design="proposal:LC-26-T10"]').click();
        await expect(page.locator('[data-design="proposal:LC-26-T10"]')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('[data-design="proposal:LC-26-T10"]')).toBeFocused();
        await expect(chosen.locator('caption')).toContainText('Level Crossing');
        await expect(chosen.locator('tbody tr')).toHaveCount(26);
        // ...and the tabs stay in reach while the weeks scroll beneath them (a card with `overflow: hidden` would let
        // them scroll away — the cascade decides this, so only a browser can see it)
        await chosen.locator('tbody tr').nth(18).scrollIntoViewIfNeeded();
        await page.evaluate(() => window.scrollBy(0, 200));
        const tabs = await page.locator('#nlWeeksTabs').boundingBox();
        expect(tabs && tabs.y >= -1 && tabs.y < 4).toBe(true);
    });

    test('a label that wraps does not knock its tile out of line: the names share a foot, the seven icons a line', async ({ page }) => {
        // Desktop audit, Nov 2026: "Common Ground" wraps at every desktop width, so its "See its weeks" sat 18px lower than
        // its neighbours'; at 1024 "Swap for overtime" wraps, and its emoji rose above the other six.
        await seedSession(page, 'G. Miller');
        for (const width of [1024, 1366]) {
            await page.setViewportSize({ width, height: 900 });
            await page.goto('/newlink.html');
            await expect(page.locator('.nl-name-title')).toHaveCount(3);
            const feet = await page.locator('.nl-name-go').evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().bottom)));
            expect(new Set(feet).size, `at ${width}px the three "See its weeks" sit on one line: ${feet}`).toBe(1);
            const icons = await page.locator('.nl-tile-icon').evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().top)));
            expect(icons.length, 'the seven ways of working').toBe(7);
            expect(new Set(icons).size, `at ${width}px the seven icons share one line: ${icons}`).toBe(1);
        }
    });

    test('the pack opens each PDF in a new tab from where docs/ is served', async ({ page }) => {
        await seedSession(page, 'G. Miller');
        await page.goto('/newlink.html');
        const links = page.locator('#nlPackList a.nl-file');
        await expect(links).toHaveCount(PACK.length);   // what the generated data lists — since 8 Nov 2026 each shortlisted link's presentation and proposal sheet, and the rules
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

        // the tile for Middle Ground opens Middle Ground's weeks, even with the weeks card folded
        await page.locator('#nlWeeksChevron').click();
        await expect(page.locator('#nlWeeksBody')).not.toHaveClass(/\bopen\b/);
        await page.locator('[data-open-weeks="proposal:MG-26-T8"]').click();
        await expect(page.locator('#nlWeeksBody')).toHaveClass(/\bopen\b/);
        await expect(page.locator('#nlWeeksPanel .is-chosen caption')).toContainText('Middle Ground');
        await expect(page.locator('[data-design="proposal:MG-26-T8"]')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('#nlWeeksPanel .is-chosen caption')).toBeInViewport();

        // "Have your say" at the top opens its card, folded or not, and takes the reader there
        await page.locator('#nlSayChevron').click();
        await expect(page.locator('#nlSayBody')).not.toHaveClass(/\bopen\b/);
        await page.locator('#nlStatus [data-open-card="nlSay"]').click();
        await expect(page.locator('#nlSayBody')).toHaveClass(/\bopen\b/);
        await expect(page.locator('#nlSayCard h2')).toBeFocused();
        // who leads the change: Sara Silva, as the RMT rep — never the admin; and how the choice is made is left vague (owner, 4 Nov
        // 2026). Named in full, as colleagues know her, not as the roster spells her (owner, 8 Nov 2026)
        await expect(page.locator('#nlSayList')).toContainText('Tell Sara Silva or your manager what worries you');
        await expect(page.locator('#nlSayList')).toContainText('Sara Silva, the RMT rep, is leading the change.');
        await expect(page.locator('#nlSayCard')).not.toContainText(/admin|managers decide/i);
        await expect(page.locator('#nlSayCard')).toBeInViewport();

        // the drawer's logo opens About — it threw, while the page took initAboutLightbox's object for a function
        await page.locator('#navMenuBtn').click();
        await page.locator('#navPanelBrand').click();
        await expect(page.locator('#iconLightbox')).toBeVisible();
        await expect(page.locator('#iconLightbox .lightbox-badge')).toHaveText('🔁 New link');
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

    // WHO DECIDES IS NEVER SAID TO BE THE ADMIN — ANYWHERE ON THE PAGE, IN ANY STATE IT SHOWS (test audit, 7 Nov 2026,
    // LNK-8). The test above reads only the Have-your-say card, so "The admin will choose one of the three." added after
    // "Nothing is decided." in the status line passed every lane. This reads the page's whole text as it opens and with
    // every way of working drawn in full — the changes, what all three share, the notes, the six personas and all three
    // proposals' weeks are all in it then (the weeks are drawn for all three; the tabs only choose which one shows). The
    // one place allowed to name the admin is the preview banner, which tells a PREVIEWER who else can see the page:
    // S. Silva is told "only you and the admin can see this page", which is why the test reads as her too.
    for (const reader of ['G. Miller', 'S. Silva']) {
        test(`nothing names the admin, or managers, as the ones who decide — read as ${reader}`, async ({ page }) => {
            await seedSession(page, reader);
            await page.goto('/newlink.html');
            await expect(page.locator('.nl-name-title')).toHaveCount(3);
            const pageText = () => page.evaluate(() => {
                const main = /** @type {HTMLElement} */ (document.getElementById('newlinkMain').cloneNode(true));
                main.querySelector('#nlPreview')?.remove();
                return (main.textContent || '').replace(/\s+/g, ' ');
            });
            const opened = await pageText();
            expect(opened, 'premise: the status line, the changes and the notes are on the page').toContain('Nothing is decided.');
            expect(opened, 'as the page opens').not.toMatch(/admin|managers decide/i);

            await page.locator('[data-persona="all"]').click();
            await expect(page.locator('#nlPersonaPanel .nl-persona')).toHaveCount(6);
            expect(await pageText(), 'with all six ways of working drawn').not.toMatch(/admin|managers decide/i);
        });
    }

    test('the admin reaches it from the drawer', async ({ page }) => {
        await seedSession(page, 'G. Miller');
        await page.goto('/admin.html');
        await page.locator('#navMenuBtn').click();
        const pill = page.locator('.nav-panel-pill--newlink');
        await expect(pill).toBeVisible();
        await pill.click();
        await expect(page).toHaveURL(/newlink\.html$/);
        await expect(page.locator('.nl-name-title').first()).toHaveText('Balanced V6');
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
        await expect(page.locator('.nl-name-title').first()).toHaveText('Balanced V6');
        await expect(page.locator('#nlPreview')).toContainText('Preview — only you and the admin can see this page.');
    });
});
