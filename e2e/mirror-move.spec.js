// @ts-check
/**
 * mirror-move.spec.js — a desktop at the GitHub Pages mirror is told where the app lives now
 * (mirror-move.js): a line on the sign-in card, and a strip under the header once signed in, each
 * linking to the SAME page at the main address. Nothing on a phone (which has the move notice) and
 * nothing at the main address.
 */
import { test, expect } from './fixtures.js';
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
        await expect(banner.locator('a')).toHaveAttribute('href', 'https://myb-roster.web.app/paycalc.html?payday=2026-12-11#x');
        // Under the header, once: a page start that runs twice does not stack a second.
        await expect(page.locator('header + #mirrorMoveBanner')).toHaveCount(1);
        await expect(page.locator('.mirror-move')).toHaveCount(1);
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
