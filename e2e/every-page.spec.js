/**
 * every-page.spec.js — EVERY PAGE THE APP SERVES OPENS: past its boot, its content on screen, and
 * nothing thrown on the way. One test per page, read from scripts/app-pages.mjs, so a page added to
 * the app is checked here without anybody remembering to add it.
 *
 * ── A FILE OF ITS OWN BECAUSE IT IS THE RELEASE GATE'S SAFARI CHECK (owner, 17 Nov 2026) ─────────
 *
 * The Hosting deploy runs THIS FILE on the iPhone's engine before it releases anything
 * (deploy-hosting.yml → `safari`, beside the signed-in journeys' iPhone half). It cannot run the
 * whole WebKit suite there: in branch CI that is nine jobs, the longest over twenty minutes, and the
 * release would wait for all of them. So it asks the one question a release must not get wrong on
 * an iPhone: does every page still START? A module Safari's engine will not run takes its whole page
 * with it, and an installed phone updates INTO that version. The branch run that would have caught it
 * tested the branch; this tests the tree being released, which is main after the merge.
 *
 * Every engine runs it on branches too, with the rest of the smoke suite. The gate selects it by its
 * FILE NAME (workflow-hygiene.test.mjs holds the name and the job together), so a test added here
 * gates every release from then on: put only what an iPhone must never ship without in this file,
 * and nothing slow. The whole file took about a minute on the iPhone project when it was written.
 *
 * WHAT "OPENS" MEANS, page by page:
 *   - an app page marks itself usable (`waitForPageSettled`, which also knows the two pages that
 *     settle on something else — the paused Overtime page's notice among them);
 *   - the Calendar is opened by a signed-in member, so it must draw the month, not a sign-in card;
 *   - a guide shows its <main> text;
 *   - an old address lands on the page it now points to.
 * And on every one, NO UNCAUGHT EXCEPTION from the first byte to the settled page (`pageerror`: a
 * throw, or a rejected promise nothing handled). Console messages are not counted: a page reports a
 * failed read there and carries on, which is the app working, and the stubbed Firebase makes reads
 * fail that never would against the real one.
 */
import { test, expect } from './fixtures.js';
import { seedSession, seedMember, seedMemberSession, waitForPageSettled } from './helpers.js';
import { APP_PAGES, GUIDE_PAGES, REDIRECT_PAGES } from '../scripts/app-pages.mjs';

/**
 * Every uncaught exception the page throws, collected from before its first byte.
 * @param {import('@playwright/test').Page} page @returns {string[]}
 */
function thrownBy(page) {
    /** @type {string[]} */ const thrown = [];
    page.on('pageerror', e => thrown.push(e.message));
    return thrown;
}

for (const p of APP_PAGES) {
    test(`${p.file} opens and settles, with nothing thrown`, async ({ page }) => {
        const thrown = thrownBy(page);
        if (p.id === 'calendar') {
            // A member with a Firebase identity, so the Calendar has a roster to draw. With a local
            // session alone it settles on its sign-in card, which would prove far less about the page.
            await seedMember(page);
            await seedMemberSession(page);
        } else {
            await seedSession(page, 'G. Miller');
        }
        await page.goto(p.url);
        await waitForPageSettled(page);
        if (p.id === 'calendar') {
            await expect(page.locator('#calLockWhy'), 'a signed-in member is asked to sign in').toHaveCount(0);
            expect(await page.locator('.calendar-day[data-detail-day]').count(),
                'the Calendar settled without drawing a month').toBeGreaterThanOrEqual(28);
        }
        expect(thrown, `${p.file} threw while it opened`).toEqual([]);
    });
}

for (const g of GUIDE_PAGES) {
    test(`${g.file} opens, with nothing thrown`, async ({ page }) => {
        const thrown = thrownBy(page);
        await page.goto(g.url);
        const main = page.locator('main');
        await expect(main).toBeVisible();
        expect(((await main.textContent()) ?? '').trim().length, `${g.file} shows no text`).toBeGreaterThan(500);
        expect(thrown, `${g.file} threw while it opened`).toEqual([]);
    });
}

for (const r of REDIRECT_PAGES) {
    const target = r.to.replace(/^\.\//, '');
    test(`${r.file}, an old address, lands on ${target}`, async ({ page }) => {
        const thrown = thrownBy(page);
        await page.goto(`/${r.file}`);
        await expect(page).toHaveURL(new RegExp(`/${target.replace(/\./g, '\\.')}$`));
        await expect(page.locator('main')).toBeVisible();
        expect(thrown, `${r.file} threw on its way to ${target}`).toEqual([]);
    });
}
