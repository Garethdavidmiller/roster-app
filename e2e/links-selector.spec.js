// @ts-check
/**
 * e2e/links-selector.spec.js — the Links Selector (links-selector.html): a proposal drawn as the Calendar draws a month.
 *
 * What only a browser can show: the page admits New CEA Link's audience and refuses everybody else; the month is the
 * Calendar's grid with the proposal's days in it, blank before the link starts; the two pickers, the month buttons and
 * the swipe move it; the address and this device keep the choice; and a day opens its panel. The rules themselves —
 * which line a date falls on, Christmas, a choice that names nothing — are links-selector-core.test.mjs.
 */
import { test, expect } from './fixtures.js';
import { collectFatalErrors, seedSession } from './helpers.js';
import { CONFIG, teamMembers } from '../roster-data.js';
import { proposalById } from '../link-designer-proposals.js';
import { dayOn } from '../links-selector-core.js';
// links-selector-app.js → WELCOME_KEY (the coordinator is not importable outside a page); the first-visit test fails if the two part.
const WELCOME_KEY = 'myb_links_selector_welcome_seen';

const ADMIN = CONFIG.ADMIN_NAMES[0];

test.describe('links selector', () => {
    // Before the link starts, so the page opens on its first month, January 2027.
    test.beforeEach(async ({ page }) => {
        await page.clock.setFixedTime(new Date('2026-11-27T09:00:00Z'));
        // Past the first visit, whose ? panel opens by itself (tested on its own, below).
        await page.addInitScript((key) => localStorage.setItem(key, '1'), WELCOME_KEY);
    });

    test('the admin sees January 2027: blank before the 17th, the proposal\'s days after it', async ({ page }) => {
        const errors = collectFatalErrors(page);
        await seedSession(page, ADMIN);
        await page.goto('/links-selector.html?proposal=LC-26-T10&line=7');
        await expect(page.locator('.month-year')).toHaveText('January 2027');
        await expect(page.locator('.week-info-text')).toHaveText('Weeks 7–9');
        await expect(page.locator('#selectorNote')).toContainText('A proposal, not your roster');
        // 1 to 16 January: a date and nothing else
        await expect(page.locator('.calendar-day.selector-blank')).toHaveCount(16);
        await expect(page.locator('.calendar-day.selector-blank .shift-badge')).toHaveCount(0);
        // and no month before the link draws today's ring, so the key does not name it
        await expect(page.locator('#selectorLegendToday')).toBeHidden();
        // 17 to 31 January: the proposal's own days, cell for cell
        const lc = /** @type {any} */ (proposalById('proposal:LC-26-T10'));
        const days = page.locator('.calendar-day[role="button"]');
        await expect(days).toHaveCount(15);
        for (let d = 17; d <= 31; d++) {
            const want = /** @type {any} */ (dayOn(lc, 7, new Date(2027, 0, d)));
            await expect(days.nth(d - 17)).toHaveAttribute('data-detail-shift-value', want.shift);
            await expect(days.nth(d - 17)).toHaveAttribute('data-detail-week', `Week ${want.line}`);
        }
        expect(errors).toEqual([]);
    });

    test('the pickers list the proposals A to Z and all 26 lines, and a choice is kept in the address and on this device', async ({ page }) => {
        await seedSession(page, ADMIN);
        await page.goto('/links-selector.html');
        const proposals = page.locator('#selectorProposal option');
        await expect(proposals).toHaveText(['Balanced V6', 'Level Crossing', 'Middle Ground']);
        await expect(page.locator('#selectorLine option')).toHaveCount(26);
        await expect(page.locator('#selectorLine option').first()).toHaveText('Week 1 · cover week');
        await expect(page).toHaveURL(/\?proposal=MB-26-V6&line=1$/);
        await page.locator('#selectorLine').selectOption('12');
        await expect(page).toHaveURL(/\?proposal=MB-26-V6&line=12$/);
        await expect(page.locator('.week-info-text')).toHaveText('Weeks 12–14');
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
        await expect(page.locator('#dayDetailWeek')).toHaveText(`Week ${want.line}`);
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
        await expect(page.locator('#selectorLine option').first()).toHaveText('Week 1 · cover week');
        await page.locator('.calendar-day[data-detail-day="Tuesday 19 January 2027"]').click();
        await expect(page.locator('#dayDetailShiftWords')).toHaveText('Spare day');
        await expect(page.locator('#selectorCoverLine')).toHaveText('A cover week: four shifts between Monday and Saturday, set nearer the time, to cover leave and absence.');
        await page.locator('#dayDetailClose').click();
        // a day that is not spare says nothing about cover
        await page.locator('.calendar-day[data-detail-day="Tuesday 26 January 2027"]').click();
        await expect(page.locator('#selectorCoverLine')).toBeHidden();
    });

    test('the key follows the month, by the Calendar\'s own rule — on a press and after a swipe', async ({ page }) => {
        await seedSession(page, ADMIN);
        // line 1: a cover week from the start, so January has spare days and blank ones
        await page.goto('/links-selector.html?proposal=LC-26-T10&line=1');
        const shown = (/** @type {string} */ id) => page.locator(`#${id}`);
        await expect(shown('selectorLegendBlank')).toBeVisible();
        await expect(shown('legend-spare')).toBeVisible();
        await expect(shown('legend-al')).toBeHidden();
        await expect(shown('legend-christmas')).toBeHidden();
        // February: no blank days, and lines 3 to 7 hold no cover week (lines 1, 6, 11, 16, 21 are the cover weeks)
        await page.locator('#nextMonth').click();
        await expect(page.locator('.month-year')).toHaveText('February 2027');
        const lc = /** @type {any} */ (proposalById('proposal:LC-26-T10'));
        const febSpare = Array.from({ length: 28 }, (_, i) => /** @type {any} */ (dayOn(lc, 1, new Date(2027, 1, i + 1))).shift).includes('SPARE');
        await expect(shown('selectorLegendBlank')).toBeHidden();
        await expect(shown('legend-spare')).toBeVisible({ visible: febSpare });
        // Easter Sunday 2027 is 28 March: its key shows in March only
        await page.locator('#nextMonth').click();
        await expect(shown('legend-easter')).toBeVisible();
        // a swipe back to February takes the 🐣 away, as the Calendar's swipe commit does
        const box = /** @type {{ x: number, y: number, width: number, height: number }} */ (await page.locator('#calendarDisplay').boundingBox());
        const y = box.y + box.height / 2;
        for (let attempt = 0; attempt < 4; attempt++) {
            await page.mouse.move(box.x + 20, y);
            await page.mouse.down();
            await page.mouse.move(box.x + box.width - 20, y, { steps: 12 });
            await page.mouse.up();
            try {
                await page.waitForFunction(() => document.querySelectorAll('.month-year').length === 1
                    && document.querySelector('.month-year')?.textContent === 'February 2027', null, { timeout: 5000 });
                break;
            } catch { /* a simulated gesture is sometimes swallowed — e2e/calendar-swipe-redraw.spec.js */ }
        }
        await expect(page.locator('.month-year')).toHaveText('February 2027');
        await expect(shown('legend-easter')).toBeHidden();
    });

    test('in December the key names Christmas, and Christmas leave on a line that works it', async ({ page }) => {
        await page.clock.setFixedTime(new Date('2027-12-01T09:00:00Z'));
        const mb = /** @type {any} */ (proposalById('proposal:MB-26-V6'));
        const line = Array.from({ length: 26 }, (_, i) => i + 1).find(l => /** @type {any} */ (dayOn(mb, l, new Date(2027, 11, 25))).christmasLeave);
        await seedSession(page, ADMIN);
        await page.goto(`/links-selector.html?proposal=MB-26-V6&line=${line}`);
        await expect(page.locator('.month-year')).toHaveText('December 2027');
        await expect(page.locator('#legend-christmas')).toBeVisible();
        await expect(page.locator('#legend-al')).toBeVisible();
        await expect(page.locator('#selectorLegendBlank')).toBeHidden();
    });

    test('open: a colleague on a normal CEA contract is admitted and offered it in the drawer', async ({ page }) => {
        // CONFIG.LINKS_SELECTOR_OPEN (owner, 28 Nov 2026): New CEA Link's audience, not the admin alone
        const colleague = /** @type {string} */ (teamMembers.find(m => m.role === 'CEA' && !m.hidden && !m.bilingualContract && !CONFIG.ADMIN_NAMES.includes(m.name))?.name);
        await seedSession(page, colleague);
        await page.goto('/links-selector.html?proposal=MB-26-V6&line=3');
        await expect(page.locator('#selectorNotForYou')).toHaveCount(0);
        await expect(page.locator('.calendar-day[role="button"]').first()).toBeVisible();
        await page.goto('/admin.html');
        await page.locator('#navMenuBtn').click();
        await expect(page.locator('a.nav-panel-pill', { hasText: 'Links Selector' })).toHaveCount(1);
    });

    test('a colleague outside its audience is refused with the app\'s card, and no menu offers them the page', async ({ page }) => {
        const bilingual = /** @type {string} */ (teamMembers.find(m => m.bilingualContract && !m.hidden && !CONFIG.ADMIN_NAMES.includes(m.name))?.name);
        await seedSession(page, bilingual);
        await page.goto('/links-selector.html');
        await expect(page.locator('#selectorNotForYou')).toBeVisible();
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
    test('a shared link that names nothing here says so, until the next choice — and the address keeps its hash', async ({ page }) => {
        await seedSession(page, ADMIN);
        await page.goto('/links-selector.html?proposal=XX-99&line=4#top');
        const note = page.locator('#selectorLinkNote');
        await expect(note).toBeVisible();
        await expect(note).toHaveText('The link you opened names a proposal that isn’t on the shortlist, so this shows Balanced V6.');
        // the address is put right at once, so a link copied now is the view on screen; the hash is the page's, not ours
        await expect(page).toHaveURL(/\?proposal=MB-26-V6&line=4#top$/);
        await page.locator('#selectorLine').selectOption('9');
        await expect(note).toBeHidden();
        await expect(page).toHaveURL(/\?proposal=MB-26-V6&line=9#top$/);
        // a good link says nothing
        await page.goto('/links-selector.html?proposal=LC-26-T10&line=2');
        await expect(note).toBeHidden();
    });

    test('a Sunday shift says it is overtime; a Sunday rest day says nothing', async ({ page }) => {
        await seedSession(page, ADMIN);
        await page.goto('/links-selector.html?proposal=MB-26-V6&line=2');
        const mb = /** @type {any} */ (proposalById('proposal:MB-26-V6'));
        // the premise, from the proposal itself: on line 2 the 31st is a worked Sunday and the 24th a rest day
        expect(/** @type {any} */ (dayOn(mb, 2, new Date(2027, 0, 31))).shift).toMatch(/^\d\d:\d\d-/);
        expect(/** @type {any} */ (dayOn(mb, 2, new Date(2027, 0, 24))).shift).toBe('RD');
        await page.locator('.calendar-day[data-detail-day="Sunday 31 January 2027"]').click();
        await expect(page.locator('#selectorSundayLine')).toHaveText('Sunday shifts are overtime.');
        await page.locator('#dayDetailClose').click();
        await page.locator('.calendar-day[data-detail-day="Sunday 24 January 2027"]').click();
        await expect(page.locator('#selectorSundayLine')).toBeHidden();
    });

    test('the Today key shows only in the month that draws today\'s ring', async ({ page }) => {
        // before the link starts no month draws today, so the key never names it (the first test, January 2027); once it
        // runs, today's month has the ring and the key, and the next month has neither
        await page.clock.setFixedTime(new Date('2027-03-10T09:00:00Z'));
        await seedSession(page, ADMIN);
        await page.goto('/links-selector.html');
        await expect(page.locator('.month-year')).toHaveText('March 2027');
        await expect(page.locator('.calendar-day.today')).toHaveCount(1);
        await expect(page.locator('#selectorLegendToday')).toBeVisible();
        await page.locator('#nextMonth').click();
        await expect(page.locator('.month-year')).toHaveText('April 2027');
        await expect(page.locator('#selectorLegendToday')).toBeHidden();
    });

    test('on paper it says which proposal and line it shows', async ({ page }) => {
        await seedSession(page, ADMIN);
        await page.goto('/links-selector.html?proposal=LC-26-T10&line=5');
        const lc = /** @type {any} */ (proposalById('proposal:LC-26-T10'));
        await page.emulateMedia({ media: 'print' });
        await expect(page.locator('#selectorPrintHead')).toBeVisible();
        await expect(page.locator('#selectorPrintChoice')).toContainText(`Level Crossing (${lc.ref}) · starting in week 5 · a proposal, not a roster`);
        await expect(page.locator('#selectorNote')).toBeHidden();
    });

    test('a colleague whose contract keeps its own link is told so, not "not yet"', async ({ page }) => {
        const bilingual = /** @type {string} */ (teamMembers.find(m => m.bilingualContract && !m.hidden && !CONFIG.ADMIN_NAMES.includes(m.name))?.name);
        await seedSession(page, bilingual);
        await page.goto('/links-selector.html');
        await expect(page.locator('#selectorNotForYou')).toContainText('doesn’t apply to your contract');
        await expect(page.locator('#selectorNotForYou')).not.toContainText('yet');
        // New CEA Link is not theirs either, so the card offers no way there
        await expect(page.locator('#selectorNotForYouNewlink')).toHaveCount(0);
    });
    test('Next is the faded end at December 2028, and stays there', async ({ page }) => {
        await seedSession(page, ADMIN);
        await page.goto('/links-selector.html?proposal=MB-26-V6&line=1');
        for (let n = 0; n < 23; n++) await page.locator('#nextMonth').click();
        await expect(page.locator('.month-year')).toHaveText('December 2028');
        await expect(page.locator('#nextMonth')).toHaveAttribute('aria-disabled', 'true');
        // pressed anyway (Playwright waits on an aria-disabled button unless forced): a true no-op
        await page.locator('#nextMonth').click({ force: true });
        await expect(page.locator('.month-year')).toHaveText('December 2028');
        await expect(page.locator('#prevMonth')).toHaveAttribute('aria-disabled', 'false');
    });

    test('a cover week\'s Sunday, and Boxing Day due at work, each say what they are', async ({ page }) => {
        await seedSession(page, ADMIN);
        // line 1 is a cover week in every proposal: its Sunday is the start day itself
        await page.goto('/links-selector.html?proposal=MB-26-V6&line=1');
        await page.locator('.calendar-day[data-detail-day="Sunday 17 January 2027"]').click();
        await expect(page.locator('#selectorCoverLine')).toHaveText('The Sunday of a cover week. Its four shifts fall between Monday and Saturday.');
        await page.locator('#dayDetailClose').click();
        // Boxing Day 2028, on a line that has it at work — found from the proposal itself
        const mb = /** @type {any} */ (proposalById('proposal:MB-26-V6'));
        let line = 0;
        for (let l = 1; l <= 26 && !line; l++) if (/** @type {any} */ (dayOn(mb, l, new Date(2028, 11, 26))).christmasLeave) line = l;
        expect(line, 'some line has Boxing Day 2028 at work').toBeGreaterThan(0);
        await page.goto(`/links-selector.html?proposal=MB-26-V6&line=${line}`);
        for (let n = 0; n < 23; n++) await page.locator('#nextMonth').click();
        await page.locator('.calendar-day[data-detail-day="Tuesday 26 December 2028"]').click();
        await expect(page.locator('#dayDetailChristmas')).toHaveText('Boxing Day: due at work, so this is annual leave. It does not come off the allowance.');
    });

    test('coming back to the app with a day open: closing it gives the keyboard back to that day', async ({ page }) => {
        await seedSession(page, ADMIN);
        await page.goto('/links-selector.html?proposal=MB-26-V6&line=2');
        const day = page.locator('.calendar-day[data-detail-day="Monday 25 January 2027"]');
        await day.focus();
        await page.keyboard.press('Enter');
        await expect(page.locator('#dayDetailLightbox')).toBeVisible();
        // the app is put away and brought back (an installed app is reopened, not reloaded)
        await page.evaluate(() => {
            for (const state of ['hidden', 'visible']) {
                Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
                document.dispatchEvent(new Event('visibilitychange'));
            }
        });
        await page.locator('#dayDetailClose').click();
        await expect(page.locator('#dayDetailLightbox')).toBeHidden();
        await expect(page.locator('.calendar-day[data-detail-day="Monday 25 January 2027"]')).toBeFocused();
        // and a return with no panel open keeps the focused day, not the month's first
        await page.keyboard.press('ArrowRight');
        await expect(page.locator('.calendar-day[data-detail-day="Tuesday 26 January 2027"]')).toBeFocused();
        await page.evaluate(() => {
            for (const state of ['hidden', 'visible']) {
                Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
                document.dispatchEvent(new Event('visibilitychange'));
            }
        });
        await expect(page.locator('.calendar-day[data-detail-day="Tuesday 26 January 2027"]')).toBeFocused();
    });
    test('the two pages lead to each other, each opening the other on the proposal in hand', async ({ page }) => {
        await seedSession(page, ADMIN);
        // New CEA Link → the Links Selector: on the top card, and under the proposal whose weeks are shown
        await page.goto('/newlink.html');
        await expect(page.locator('#nlStatus .nl-onward')).toHaveAttribute('href', './links-selector.html');
        const row = page.locator('.nl-weeks-one.is-chosen .nl-onward');
        await expect(row).toContainText('See it as a calendar');
        const mg = page.locator('.nl-weeks-one[data-weeks="proposal:MG-26-T8"] .nl-onward');
        await expect(mg).toHaveAttribute('href', './links-selector.html?proposal=MG-26-T8');
        await page.goto('/links-selector.html?proposal=MG-26-T8');
        await expect(page.locator('#selectorProposal')).toHaveValue('proposal:MG-26-T8');
        // …and back: the way out names the proposal shown, and follows the picker
        const onward = page.locator('#selectorOnward');
        await expect(onward).toHaveAttribute('href', './newlink.html?weeks=MG-26-T8');
        await page.locator('#selectorProposal').selectOption('proposal:LC-26-T10');
        await expect(onward).toHaveAttribute('href', './newlink.html?weeks=LC-26-T10');
        await onward.click();
        await expect(page).toHaveURL(/newlink\.html\?weeks=LC-26-T10$/);
        // New CEA Link opens on that proposal's weeks, its card open and in view
        await expect(page.locator('.nl-weeks-one.is-chosen')).toHaveAttribute('data-weeks', 'proposal:LC-26-T10');
        await expect(page.locator('#nlWeeksCard')).toBeInViewport();
    });

    test('a New CEA Link address that names no proposal opens the page as it always does', async ({ page }) => {
        await seedSession(page, ADMIN);
        await page.goto('/newlink.html?weeks=ZZ-99');
        await expect(page.locator('.nl-weeks-one.is-chosen')).toHaveAttribute('data-weeks', 'proposal:MB-26-V6');
        await expect(page.locator('#nlStatusCard')).toBeInViewport();
    });
    test('the month\'s name opens the Calendar\'s month picker, with this page\'s two years', async ({ page }) => {
        await seedSession(page, ADMIN);
        await page.goto('/links-selector.html?proposal=MB-26-V6&line=3');
        await expect(page.locator('.month-year')).toHaveText('January 2027');
        await expect(page.locator('.month-year')).toHaveAttribute('role', 'button');
        await page.locator('.month-year').click();
        await expect(page.locator('#monthJumpOverlay')).toBeVisible();
        await expect(page.locator('#monthJumpYear option')).toHaveText(['2027', '2028']);
        await expect(page.locator('#monthJumpMonth')).toHaveValue('0');
        await page.locator('#monthJumpMonth').selectOption('6');
        await page.locator('#monthJumpYear').selectOption('2028');
        await page.locator('#monthJumpConfirm').click();
        await expect(page.locator('#monthJumpOverlay')).toBeHidden();
        await expect(page.locator('.month-year')).toHaveText('July 2028');
        await expect(page).toHaveTitle(/^July 2028 — Links Selector/);
        // the note beside it names the proposal's weeks, as the Calendar's names the roster's
        await expect(page.locator('.week-info-text')).toHaveText(/^Weeks \d/);
        // and the keyboard opens it too, as on the Calendar
        await page.locator('.month-year').focus();
        await page.keyboard.press('Enter');
        await expect(page.locator('#monthJumpOverlay')).toBeVisible();
        await expect(page.locator('#monthJumpMonth')).toHaveValue('6');
        await page.locator('#monthJumpCancel').click();
        await expect(page.locator('.month-year')).toHaveText('July 2028');
    });
});

// A FIRST VISIT (owner, 28 Nov 2026: "nothing to say what it is and how to use it"): the ? panel opens by itself, once, and
// the ? opens it again whenever it is wanted.
test.describe('links selector — the first visit', () => {
    /** A device that has never opened the page: the seeders mark the panel seen for every other spec (helpers.js), so it is
     *  cleared ONCE, behind a sentinel — cleared on every load, a reload would be a first visit again. @param {import('@playwright/test').Page} page */
    const firstVisit = (page) => page.addInitScript((key) => {
        try { if (sessionStorage.getItem('__e2e_selector_first_visit')) return; sessionStorage.setItem('__e2e_selector_first_visit', '1'); } catch { /* private mode */ }
        localStorage.removeItem(key);
    }, WELCOME_KEY);

    test('the ? panel opens by itself on a first visit, never again, and the ? reopens it', async ({ page }) => {
        await page.clock.setFixedTime(new Date('2026-11-27T09:00:00Z'));
        await seedSession(page, ADMIN);
        await firstVisit(page);
        await page.goto('/links-selector.html');
        const panel = page.locator('#tipsLightbox');
        await expect(panel).toBeVisible();
        await expect(page.locator('#tipsLbTitle')).toHaveText('How to read the Links Selector');
        await expect(panel).toContainText('A proposal, not your roster.');
        await expect(panel).toContainText('Sunday 17 January 2027 (date not final)');
        expect(await page.evaluate((key) => localStorage.getItem(key), WELCOME_KEY)).toBe('1');
        await page.locator('#tipsLightboxClose').click();
        await expect(panel).toBeHidden();
        // the next visit opens on the month, not the panel
        await page.reload();
        await expect(page.locator('.calendar-grid')).toBeVisible();
        await expect(panel).toBeHidden();
        // and the ? beside the note opens it again
        await page.locator('#selectorNoteBox .btn-card-tips').click();
        await expect(panel).toBeVisible();
        await expect(page.locator('#tipsLbTitle')).toHaveText('How to read the Links Selector');
    });

    test('a colleague the page refuses is not shown it', async ({ page }) => {
        const colleague = /** @type {string} */ (teamMembers.find(m => m.bilingualContract && !m.hidden && !CONFIG.ADMIN_NAMES.includes(m.name))?.name);
        await seedSession(page, colleague);
        await firstVisit(page);
        await page.goto('/links-selector.html');
        await expect(page.locator('#selectorNotForYou')).toBeVisible();
        await expect(page.locator('#tipsLightbox')).toBeHidden();
        await expect(page.locator('#selectorNoteBox')).toHaveCount(0);
    });
});
