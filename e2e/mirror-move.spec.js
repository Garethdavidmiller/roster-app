// @ts-check
/**
 * mirror-move.spec.js — a desktop at the GitHub Pages mirror is told where the app lives now
 * (mirror-move.js): a line on the sign-in card, and a strip under the header once signed in, each
 * linking to the SAME page at the main address. Nothing on a phone (which has the move notice) and
 * nothing at the main address.
 */
import { test, expect, freshBrowser } from './fixtures.js';
import AxeBuilder from '@axe-core/playwright';
import { seedMemberSession, isTouchProject, asMirror } from './helpers.js';

test.describe('a desktop at the Pages mirror', () => {
    test.beforeEach(({ page: _page }, info) => { test.skip(isTouchProject(info), 'a desktop: a phone has the move notice instead'); });

    test('a sign-in card over the page says where the app lives now, and links to the same page there', async ({ page }) => {
        await asMirror(page);
        await page.addInitScript(() => { window.__E2E = Object.assign(window.__E2E || {}, { authUser: false }); });
        await page.goto('/settings.html');
        const line = page.locator('#loginOverlay .login-mirror');
        await expect(line).toBeVisible();
        await expect(line).toContainText('This is the app’s older address, which will close.');
        await expect(line).not.toContainText('Pay Calculator');
        await expect(line.locator('a')).toHaveAttribute('href', 'https://myb-roster.web.app/settings.html');
    });

    test('the Calendar’s sign-in, in the page, has the strip above it and no second copy', async ({ page }) => {
        await asMirror(page);
        await page.addInitScript(() => { window.__E2E = Object.assign(window.__E2E || {}, { authUser: false }); });
        await page.goto('/');
        await expect(page.locator('#loginOverlay #loginForm')).toBeVisible();
        await expect(page.locator('#mirrorMoveBanner')).toBeVisible();
        await expect(page.locator('#mirrorMoveBanner a')).toHaveAttribute('href', 'https://myb-roster.web.app/');
        await expect(page.locator('.login-mirror')).toHaveCount(0);
    });

    test('the Pay page’s strip links to the Pay page there, and says to move the figures first', async ({ page }) => {
        await asMirror(page);
        await seedMemberSession(page);
        await page.goto('/paycalc.html?payday=2026-12-11#x');
        const banner = page.locator('#mirrorMoveBanner');
        await expect(banner).toBeVisible();
        await expect(banner).toHaveAttribute('role', 'note');
        await expect(banner).toContainText('Move your Pay Calculator figures first');
        await expect(banner.getByRole('link', { name: 'myb-roster.web.app' })).toHaveAttribute('href', 'https://myb-roster.web.app/paycalc.html?payday=2026-12-11#x');
        // Under the header, once: a page start that runs twice does not stack a second.
        await expect(page.locator('header + #mirrorMoveBanner')).toHaveCount(1);
        await expect(page.locator('.mirror-move')).toHaveCount(1);
        // Not tight against the cards (owner, 27 Nov 2026), and on the cards' own edges.
        const fit = await page.evaluate(() => {
            const b = /** @type {HTMLElement} */ (document.getElementById('mirrorMoveBanner')).getBoundingClientRect();
            // The first painted box in the page: the cards are the page's own, so asked by their paint, not a class.
            const card = [...document.querySelectorAll('main *')].map(el => ({ el, r: el.getBoundingClientRect() }))
                .filter(({ el, r }) => r.height > 20 && getComputedStyle(el).backgroundColor !== 'rgba(0, 0, 0, 0)')
                .sort((x, y) => x.r.top - y.r.top)[0].r;
            const main = /** @type {HTMLElement} */ (document.querySelector('main')).getBoundingClientRect();
            return { gap: card.top - b.bottom, left: b.left - main.left, right: main.right - b.right };
        });
        expect(fit.gap).toBeGreaterThanOrEqual(12);
        expect(Math.abs(fit.left)).toBeLessThanOrEqual(1);
        expect(Math.abs(fit.right)).toBeLessThanOrEqual(1);
        // Its Move Your Pay Data link is the first-run banner's, and opens that card on the way.
        await banner.getByRole('link', { name: '💾 Move Your Pay Data' }).click();
        await expect(page.locator('#payTransferBody')).toBeVisible();
    });

    test('both surfaces pass the accessibility scan: the strip on a page, the line on a sign-in card', async ({ page, browser }, info) => {
        // axe's contrast and naming rules on the two surfaces alone (each page's own scan is axe.spec.js's).
        const check = async (/** @type {import('@playwright/test').Page} */ p, /** @type {string} */ sel) => {
            const { violations } = await new AxeBuilder({ page: p }).include(sel).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
            expect(violations.map(v => `${v.id}: ${v.nodes.map(n => n.target).join(', ')}`), sel).toEqual([]);
        };
        await asMirror(page);
        await seedMemberSession(page);
        await page.goto('/paycalc.html');
        await expect(page.locator('#mirrorMoveBanner')).toBeVisible();
        await check(page, '#mirrorMoveBanner');
        // A FRESH browser, not a second tab: the tabs share the signed-in identity, which one cleared key
        // does not end, so a second tab could open Settings still signed in.
        const { context: fresh, page: signedOut } = await freshBrowser(browser, info);
        try {
            await asMirror(signedOut);
            await signedOut.goto('/settings.html');
            await expect(signedOut.locator('.login-mirror')).toBeVisible();
            await check(signedOut, '.login-mirror');
        } finally { await fresh.close(); }
    });

    test('every other page\'s strip says nothing about pay', async ({ page }) => {
        await asMirror(page);
        await seedMemberSession(page);
        await page.goto('/settings.html');
        const banner = page.locator('#mirrorMoveBanner');
        await expect(banner).toBeVisible();
        await expect(banner).not.toContainText('Pay Calculator');
        await expect(banner.locator('a')).toHaveAttribute('href', 'https://myb-roster.web.app/settings.html');
    });
});

test('nothing at the main address', async ({ page }) => {
    await seedMemberSession(page);
    await page.goto('/settings.html');
    await expect(page.locator('h1, .app-header').first()).toBeVisible();
    await expect(page.locator('.mirror-move, .login-mirror')).toHaveCount(0);
});

test('nothing on a phone at the mirror', async ({ page }, info) => {
    test.skip(!isTouchProject(info), 'a phone');
    await asMirror(page);
    await seedMemberSession(page);
    await page.goto('/settings.html');
    await expect(page.locator('.app-header')).toBeVisible();
    await expect(page.locator('.mirror-move, .login-mirror')).toHaveCount(0);
});
