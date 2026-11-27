// @ts-check
/**
 * e2e/links-selector.spec.js — the Links Selector (links-selector.html): a proposal drawn as the Calendar draws a month.
 *
 * What only a browser can show: the page admits the admin and refuses everybody else during its beta; the month is the
 * Calendar's grid with the proposal's days in it, blank before the link starts; the two pickers, the month buttons and
 * the swipe move it; the address and this device keep the choice; and a day opens its panel. The rules themselves —
 * which line a date falls on, Christmas, a choice that names nothing — are links-selector-core.test.mjs.
 */
import { test, expect } from './fixtures.js';
import { collectFatalErrors, seedSession } from './helpers.js';
import { CONFIG, teamMembers } from '../roster-data.js';
import { proposalById } from '../link-designer-proposals.js';
import { dayOn } from '../links-selector-core.js';

const ADMIN = CONFIG.ADMIN_NAMES[0];

test.describe('links selector', () => {
    // Before the link starts, so the page opens on its first month, January 2027.
    test.beforeEach(async ({ page }) => { await page.clock.setFixedTime(new Date('2026-11-27T09:00:00Z')); });

    test('the admin sees January 2027: blank before the 17th, the proposal\'s days after it', async ({ page }) => {
        const errors = collectFatalErrors(page);
        await seedSession(page, ADMIN);
        await page.goto('/links-selector.html?proposal=LC-26-T10&line=7');
        await expect(page.locator('.month-year')).toHaveText('January 2027');
        await expect(page.locator('.week-info-text')).toHaveText('Lines 7–9');
        await expect(page.locator('#selectorNote')).toContainText('A proposal, not your roster');
        // 1 to 16 January: a date and nothing else
        await expect(page.locator('.calendar-day.selector-blank')).toHaveCount(16);
        await expect(page.locator('.calendar-day.selector-blank .shift-badge')).toHaveCount(0);
        // 17 to 31 January: the proposal's own days, cell for cell
        const lc = /** @type {any} */ (proposalById('proposal:LC-26-T10'));
        const days = page.locator('.calendar-day[role="button"]');
        await expect(days).toHaveCount(15);
        for (let d = 17; d <= 31; d++) {
            const want = /** @type {any} */ (dayOn(lc, 7, new Date(2027, 0, d)));
            await expect(days.nth(d - 17)).toHaveAttribute('data-detail-shift-value', want.shift);
            await expect(days.nth(d - 17)).toHaveAttribute('data-detail-week', `Line ${want.line}`);
        }
        expect(errors).toEqual([]);
    });

    test('the pickers list the proposals A to Z and all 26 lines, and a choice is kept in the address and on this device', async ({ page }) => {
        await seedSession(page, ADMIN);
        await page.goto('/links-selector.html');
        const proposals = page.locator('#selectorProposal option');
        await expect(proposals).toHaveText(['Balanced V6', 'Level Crossing', 'Middle Ground']);
        await expect(page.locator('#selectorLine option')).toHaveCount(26);
        await expect(page.locator('#selectorLine option').first()).toHaveText('Line 1 · cover week');
        await expect(page).toHaveURL(/\?proposal=MB-26-V6&line=1$/);
        await page.locator('#selectorLine').selectOption('12');
        await expect(page).toHaveURL(/\?proposal=MB-26-V6&line=12$/);
        await expect(page.locator('.week-info-text')).toHaveText('Lines 12–14');
        await page.locator('#selectorProposal').selectOption('proposal:MG-26-T8');
        await expect(page).toHaveURL(/\?proposal=MG-26-T8&line=12$/);
        // a fresh visit with no address of its own reopens where this device left it
        await page.goto('/links-selector.html');
        await expect(page.locator('#selectorProposal')).toHaveValue('proposal:MG-26-T8');
        await expect(page.locator('#selectorLine')).toHaveValue('12');
    });

    test('Next, Prev and the swipe change the month; Start goes back to January 2027', async ({ page }) => {
        await seedSession(page, ADMIN);
        await page.goto('/links-selector.html?proposal=MB-26-V6&line=3');
        // the Calendar's end-of-range button: faded and aria-disabled, never `disabled`, which would drop its focus
        await expect(page.locator('#prevMonth')).toHaveAttribute('aria-disabled', 'true');
        await page.locator('#prevMonth').focus();
        await page.keyboard.press('Enter');
        await expect(page.locator('.month-year')).toHaveText('January 2027');
        await expect(page.locator('#prevMonth')).toBeFocused();
        await page.locator('#nextMonth').click();
        await expect(page.locator('.month-year')).toHaveText('February 2027');
        await expect(page).toHaveTitle(/^February 2027 — Links Selector/);
        // the Calendar's swipe: a drag right to left moves on a month
        const box = /** @type {{ x: number, y: number, width: number, height: number }} */ (await page.locator('#calendarDisplay').boundingBox());
        const y = box.y + box.height / 2;
        for (let attempt = 0; attempt < 4; attempt++) {
            await page.mouse.move(box.x + box.width - 20, y);
            await page.mouse.down();
            await page.mouse.move(box.x + 20, y, { steps: 12 });
            await page.mouse.up();
            try {
                await page.waitForFunction(() => document.querySelectorAll('.month-year').length === 1
                    && document.querySelector('.month-year')?.textContent === 'March 2027', null, { timeout: 5000 });
                break;
            } catch { /* a simulated gesture is sometimes swallowed — e2e/calendar-swipe-redraw.spec.js */ }
        }
        await expect(page.locator('.month-year')).toHaveText('March 2027');
        await page.locator('#prevMonth').click();
        await expect(page.locator('.month-year')).toHaveText('February 2027');
        await page.locator('#selectorStartBtn').click();
        await expect(page.locator('.month-year')).toHaveText('January 2027');
    });

    test('a day opens its panel: the date, the line, the proposal and the shift', async ({ page }) => {
        await seedSession(page, ADMIN);
        await page.goto('/links-selector.html?proposal=MB-26-V6&line=2');
        const mb = /** @type {any} */ (proposalById('proposal:MB-26-V6'));
        const want = /** @type {any} */ (dayOn(mb, 2, new Date(2027, 0, 18)));
        await page.locator('.calendar-day[data-detail-day="Monday 18 January 2027"]').click();
        const panel = page.locator('#dayDetailLightbox');
        await expect(panel).toBeVisible();
        await expect(page.locator('#dayDetailDate')).toHaveText('Monday 18 January 2027');
        await expect(page.locator('#dayDetailWeek')).toHaveText(`Line ${want.line}`);
        await expect(page.locator('#dayDetailWho')).toHaveText('Balanced V6');
        await expect(panel).toContainText('A proposal, not your roster.');
        await page.locator('#dayDetailClose').click();
        await expect(panel).toBeHidden();
    });

    test('Christmas 2027: a day the proposal has you working is annual leave that is never counted', async ({ page }) => {
        await page.clock.setFixedTime(new Date('2027-12-01T09:00:00Z'));
        const mb = /** @type {any} */ (proposalById('proposal:MB-26-V6'));
        // a start line that has Saturday 25 December 2027 as a worked day
        const line = Array.from({ length: 26 }, (_, i) => i + 1).find(l => /** @type {any} */ (dayOn(mb, l, new Date(2027, 11, 25))).christmasLeave);
        expect(line, 'some line works Christmas Day 2027').toBeTruthy();
        await seedSession(page, ADMIN);
        await page.goto(`/links-selector.html?proposal=MB-26-V6&line=${line}`);
        await expect(page.locator('.month-year')).toHaveText('December 2027');
        const xmas = page.locator('.calendar-day[data-detail-day="Saturday 25 December 2027"]');
        await expect(xmas).toHaveAttribute('data-detail-shift-value', 'AL');
        await xmas.click();
        await expect(page.locator('#dayDetailChristmas')).toContainText('Christmas Day: due at work, so this is annual leave');
    });

    test('the keyboard is the Calendar\'s: arrows walk the days, PgDn changes month, Enter opens a day, T comes back', async ({ page }) => {
        await seedSession(page, ADMIN);
        await page.goto('/links-selector.html?proposal=MB-26-V6&line=2');
        await expect(page.locator('#selectorStartDate')).toHaveText('17 Jan');
        // ← → change the month while no day has focus
        await page.locator('h1').click();
        await page.keyboard.press('ArrowRight');
        await expect(page.locator('.month-year')).toHaveText('February 2027');
        await page.keyboard.press('ArrowLeft');
        await expect(page.locator('.month-year')).toHaveText('January 2027');
        // the grid's entry is its first day with a shift; the arrows then walk every day, blank ones included
        const entry = page.locator('.calendar-day[tabindex="0"]');
        await expect(entry).toHaveAttribute('data-detail-day', 'Sunday 17 January 2027');
        await entry.focus();
        await page.keyboard.press('ArrowLeft');
        await expect(page.locator(':focus')).toHaveAttribute('aria-label', /^Saturday 16 — before the new link starts/);
        await page.keyboard.press('Enter');
        await expect(page.locator('#dayDetailLightbox')).toBeHidden();   // a blank day opens nothing
        await page.keyboard.press('ArrowRight');
        await page.keyboard.press('Enter');
        await expect(page.locator('#dayDetailDate')).toHaveText('Sunday 17 January 2027');
        await page.keyboard.press('Escape');
        await expect(page.locator('#dayDetailLightbox')).toBeHidden();
        await page.locator('.calendar-day[tabindex="0"]').focus();
        await page.keyboard.press('PageDown');
        await expect(page.locator('.month-year')).toHaveText('February 2027');
        // the keyboard stays on the grid, as on the Calendar: the next arrow moves a day, not a month
        await expect(page.locator(':focus')).toHaveClass(/calendar-day/);
        await page.keyboard.press('ArrowRight');
        await expect(page.locator('.month-year')).toHaveText('February 2027');
        await expect(page.locator(':focus')).toHaveClass(/calendar-day/);
        await page.locator('h1').click();
        await page.keyboard.press('t');
        await expect(page.locator('.month-year')).toHaveText('January 2027');
    });

    test('a spare day in a cover week says what a cover week is', async ({ page }) => {
        await seedSession(page, ADMIN);
        // line 1 is a cover week in every proposal, so the start week is spare from Monday to Saturday
        await page.goto('/links-selector.html?proposal=LC-26-T10&line=1');
        await expect(page.locator('#selectorLine option').first()).toHaveText('Line 1 · cover week');
        await page.locator('.calendar-day[data-detail-day="Tuesday 19 January 2027"]').click();
        await expect(page.locator('#dayDetailShiftWords')).toHaveText('Spare day');
        await expect(page.locator('#selectorCoverLine')).toHaveText('A cover week: four shifts between Monday and Saturday, set nearer the time, to cover leave and absence.');
        await page.locator('#dayDetailClose').click();
        // a day that is not spare says nothing about cover
        await page.locator('.calendar-day[data-detail-day="Tuesday 26 January 2027"]').click();
        await expect(page.locator('#selectorCoverLine')).toBeHidden();
    });

    test('during the beta a colleague is refused with the app\'s card, and no menu offers them the page', async ({ page }) => {
        const colleague = /** @type {string} */ (teamMembers.find(m => m.role === 'CEA' && !m.hidden && !m.bilingualContract && !CONFIG.ADMIN_NAMES.includes(m.name))?.name);
        await seedSession(page, colleague);
        await page.goto('/links-selector.html');
        await expect(page.locator('#selectorNotForYou')).toBeVisible();
        await expect(page.locator('#selectorNotForYou')).toContainText('isn’t open to you yet');
        await expect(page.locator('.calendar-day')).toHaveCount(0);
        await page.locator('#navMenuBtn').click();
        // not even as the page they are on: a gated pill is drawn only for the people its page admits (nav-destinations.js)
        await expect(page.locator('.nav-panel-pill', { hasText: 'Links Selector' })).toHaveCount(0);
        await page.goto('/admin.html');
        await page.locator('#navMenuBtn').click();
        await expect(page.locator('a.nav-panel-pill', { hasText: 'Links Selector' })).toHaveCount(0);
    });

    test('the admin reaches it from the drawer', async ({ page }) => {
        await seedSession(page, ADMIN);
        await page.goto('/newlink.html');
        await page.locator('#navMenuBtn').click();
        await page.locator('a.nav-panel-pill', { hasText: 'Links Selector' }).click();
        await expect(page).toHaveURL(/links-selector\.html/);
        await expect(page.locator('.calendar-grid')).toBeVisible();
    });
});
