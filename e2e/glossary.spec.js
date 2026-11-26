// @ts-check
/**
 * glossary.spec.js — "Words used in the app" (glossary.js): opened from the drawer's Reference zone, and from the foot of
 * a `?` panel that uses one of its words, in the page's own `?` panel (tips-lightbox.js).
 *
 * What only a browser can show: the drawer hands over to the panel without a stray history entry, so Back closes the
 * glossary and leaves the page where it was; the link appears on a panel that uses a word and on no other; and focus is
 * not lost when the link redraws the panel it sits in. The words are glossary.test.mjs's.
 */
import { test, expect } from './fixtures.js';
import { collectFatalErrors, seedSession } from './helpers.js';
import { GLOSSARY, GLOSSARY_TITLE } from '../glossary.js';

test.describe('the glossary', () => {
    test.beforeEach(async ({ page }) => { await page.clock.setFixedTime(new Date('2026-11-16T09:00:00Z')); });

    test('the drawer opens it in the page\'s panel, every word on a line, and Back closes it on the same page', async ({ page }) => {
        const errors = collectFatalErrors(page);
        await seedSession(page, 'G. Miller');
        await page.goto('/settings.html');
        await page.locator('#navMenuBtn').click();
        await page.locator('.nav-panel-link--glossary').click();
        const panel = page.locator('#tipsLightbox');
        await expect(panel).toHaveClass(/open/);
        await expect(page.locator('#tipsLbTitle')).toHaveText(GLOSSARY_TITLE);
        await expect(page.locator('#tipsLbBody .tips-lb-item')).toHaveCount(GLOSSARY.length);
        await expect(page.locator('#tipsLbBody')).toContainText(GLOSSARY[0].line);
        await expect(page.locator('#tipsLbBody .tips-lb-glossary'), 'the glossary does not link to itself').toHaveCount(0);
        await expect(page.locator('.nav-panel.open, .nav-panel[aria-hidden="false"]'), 'the drawer has closed').toHaveCount(0);
        await page.goBack();
        await expect(panel).not.toHaveClass(/open/);
        expect(new URL(page.url()).pathname, 'one Back closed the panel and stayed on the page').toBe('/settings.html');
        expect(errors).toEqual([]);
    });

    test('a ? panel that uses a roster word ends with the link; one that does not, without it', async ({ page }) => {
        const errors = collectFatalErrors(page);
        await seedSession(page, 'G. Miller');
        await page.goto('/newlink.html');
        await expect(page.locator('.nl-name-title').first()).toBeVisible();

        // "What it means if you…" speaks of cover weeks and overtime, and uses none of the glossary's words.
        await page.locator('.btn-card-tips[data-card="means"]').click();
        await expect(page.locator('#tipsLbTitle')).toHaveText('What it means if you…');
        await expect(page.locator('#tipsLbBody .tips-lb-glossary')).toHaveCount(0);
        await page.locator('#tipsLightboxClose').click();
        await expect(page.locator('#tipsLightbox')).not.toHaveClass(/open/);

        // "The weeks" says Spare and RDW.
        await page.locator('.btn-card-tips[data-card="weeks"]').click();
        const link = page.locator('#tipsLbBody .tips-lb-glossary');
        await expect(link).toHaveText(/What these words mean$/);
        await link.click();
        await expect(page.locator('#tipsLbTitle')).toHaveText(GLOSSARY_TITLE);
        await expect(page.locator('#tipsLbBody .tips-lb-item')).toHaveCount(GLOSSARY.length);
        await expect(page.locator('#tipsLightboxClose'), 'focus went to the ✕, not lost with the redrawn link').toBeFocused();
        await page.keyboard.press('Escape');
        await expect(page.locator('#tipsLightbox')).not.toHaveClass(/open/);
        expect(errors).toEqual([]);
    });
});
