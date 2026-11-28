// @ts-check
/**
 * e2e/links-selector.spec.js — the Links Selector (links-selector.html): a proposal drawn as the Calendar draws a month.
 *
 * What only a browser can show: the page admits New CEA Link's audience and refuses everybody else; the month is the
 * Calendar's grid with the proposal's days in it, blank before the link starts; the two pickers, the month buttons and
 * the swipe move it; the address and this device keep the choice; and a day opens its panel. The rules themselves —
 * which line a date falls on, Christmas, a choice that names nothing — are links-selector-core.test.mjs.
 */
import { test, expect, appTab } from './fixtures.js';
import { collectFatalErrors, seedSession } from './helpers.js';
import { CONFIG, teamMembers, getBaseShift } from '../roster-data.js';
import { isChristmasLeaveDay } from '../christmas-leave.js';
import { proposalById, proposalDisplayName } from '../link-designer-proposals.js';
import { dayOn, proposalsAtoZ } from '../links-selector-core.js';
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

    // ⚖️ COMPARE (owner, 28 Nov 2026: "Do 2, not as the default view"): every proposal side by side, the same month from the
    // same week. Organised by what a wrong answer costs: opened by itself, it is the default view the owner said it must not
    // be; a column that disagrees with that proposal's own month shows a colleague a rota that is not the one on offer; and
    // a table wider than the phone hides a proposal off the edge.
    test('Compare all: never by itself, every proposal side by side — each column that proposal\'s own month — and Month goes back', async ({ page }) => {
        const errors = collectFatalErrors(page);
        await seedSession(page, ADMIN);
        await page.goto('/links-selector.html?proposal=LC-26-T10&line=7');
        await expect(page.locator('#selectorViewMonth')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('#selectorViewCompare')).toHaveAttribute('aria-pressed', 'false');
        await expect(page.locator('.cmp-table')).toHaveCount(0);
        await page.locator('#selectorViewCompare').click();
        await expect(page.locator('#selectorViewCompare')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('.cmp-table')).toBeVisible();
        await expect(page).toHaveURL(/[?&]view=compare\b/);
        await expect(page.locator('#selectorNote')).toContainText('Proposals, not your roster');
        // A column per proposal, A to Z, the chosen one in the page's colour
        const names = proposalsAtoZ().map(proposalDisplayName);
        await expect(page.locator('.cmp-table thead th.cmp-col')).toHaveText(names);
        await expect(page.locator('.cmp-table thead th.cmp-chosen')).toHaveText(proposalDisplayName(/** @type {any} */ (proposalById('proposal:LC-26-T10'))));
        // 1–16 January folded into one row; then every date from the 17th, each cell that proposal's own day
        await expect(page.locator('.cmp-before')).toHaveCount(1);
        const rows = page.locator('.cmp-table tbody:not(.cmp-totals) tr:not(.cmp-week):not(.cmp-before)');
        await expect(rows).toHaveCount(15);
        for (const [i, p] of proposalsAtoZ().entries()) {
            for (const d of [17, 18, 24, 31]) {
                const want = /** @type {any} */ (dayOn(p, 7, new Date(2027, 0, d)));
                const cell = rows.nth(d - 17).locator('td').nth(i);
                const text = want.shift === 'RD' ? '–' : want.shift === 'SPARE' ? '📋 Spare' : want.shift;
                await expect(cell, `${proposalDisplayName(p)}, ${d} January`).toContainText(text);
            }
        }
        // The month moves as the month does, and the key names what any column has
        await page.locator('#nextMonth').click();
        await expect(page.locator('.month-year')).toHaveText('February 2027');
        await expect(page.locator('.cmp-before')).toHaveCount(0);
        await expect(page.locator('.cmp-table tbody:not(.cmp-totals) tr:not(.cmp-week)')).toHaveCount(28);
        // A reload keeps it (the address), but this device never does: the stored choice names no view
        await page.reload();
        await expect(page.locator('.cmp-table')).toBeVisible();
        const stored = await page.evaluate(() => localStorage.getItem('myb_links_selector_choice'));
        expect(JSON.parse(stored || '{}')).toEqual({ proposal: 'LC-26-T10', line: 7 });
        await page.goto('/links-selector.html');
        await expect(page.locator('.calendar-grid')).toBeVisible();
        await expect(page.locator('.cmp-table')).toHaveCount(0);
        await page.locator('#selectorViewCompare').click();
        await page.locator('#selectorViewMonth').click();
        await expect(page.locator('.calendar-grid')).toBeVisible();
        await expect(page).not.toHaveURL(/view=/);
        expect(errors).toEqual([]);
    });

    test('Compare fits a 320px phone: no proposal off the edge, no time broken at its dash', async ({ page }) => {
        await page.setViewportSize({ width: 320, height: 640 });
        await seedSession(page, ADMIN);
        await page.goto('/links-selector.html?proposal=MB-26-V6&line=2&view=compare');
        await page.locator('#nextMonth').click();   // February: a full month of times
        await expect(page.locator('.cmp-table')).toBeVisible();
        const fit = await page.evaluate(() => {
            const t = /** @type {HTMLElement} */ (document.querySelector('.cmp-table'));
            const times = [...document.querySelectorAll('.cmp-time')].map(e => e.getClientRects().length);
            return { page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
                table: t.getBoundingClientRect().right - /** @type {HTMLElement} */ (t.parentElement).getBoundingClientRect().right,
                broken: times.filter(n => n > 1).length, times: times.length };
        });
        expect(fit.page, 'the page scrolls sideways').toBeLessThanOrEqual(0);
        expect(fit.table, 'the table runs past its card').toBeLessThanOrEqual(0.5);
        expect(fit.times, 'premise: February has times to draw').toBeGreaterThan(20);
        expect(fit.broken, 'a time wrapped onto two lines').toBe(0);
        // and every view control is on the screen
        for (const id of ['#selectorViewMonth', '#selectorViewCompare', '#selectorStartBtn']) {
            const box = /** @type {any} */ (await page.locator(id).boundingBox());
            expect(box.x + box.width, `${id} off the edge`).toBeLessThanOrEqual(320);
        }
    });

    // 👤 COMPARE WITH MINE (owner, 28 Nov 2026: "Do 5 … as a button and not the default option. Clear labelling."): the
    // reader's own roster today beside the chosen proposal. What a wrong answer costs: a "today" column that is not what the
    // Calendar draws teaches a colleague a false trade-off; one that reads as a proposal, or a proposal as their roster, is
    // the confusion the whole page guards against.
    test('Compare with mine: your roster today, as the Calendar draws it, beside the chosen proposal — labelled, and never by itself', async ({ page }) => {
        const errors = collectFatalErrors(page);
        await seedSession(page, ADMIN);
        await page.goto('/links-selector.html?proposal=MG-26-T8&line=4');
        await expect(page.locator('#selectorViewMine')).toBeVisible();
        await expect(page.locator('#selectorViewMine')).toHaveAttribute('aria-pressed', 'false');
        await page.locator('#selectorViewMine').click();
        await expect(page.locator('#selectorViewMine')).toHaveAttribute('aria-pressed', 'true');
        await expect(page).toHaveURL(/[?&]view=mine\b/);
        await expect(page.locator('#selectorNote')).toContainText('Your roster beside a proposal.');
        await expect(page.locator('#selectorNote')).toContainText('without leave or changed shifts');
        // Two columns, labelled: yours first, in the Calendar's gold; the proposal in the page's colour
        await expect(page.locator('.cmp-table thead th.cmp-col')).toHaveText(['Your roster today', proposalDisplayName(/** @type {any} */ (proposalById('proposal:MG-26-T8')))]);
        await expect(page.locator('.cmp-table thead th.cmp-mine')).toHaveText('Your roster today');
        await expect(page.locator('.cmp-table thead th.cmp-chosen')).toHaveCount(1);
        // February 2027, day by day: the left column is the Calendar's base day for the signed-in member
        await page.locator('#nextMonth').click();
        await expect(page.locator('.month-year')).toHaveText('February 2027');
        const me = /** @type {any} */ (teamMembers.find(m => m.name === ADMIN));
        const mg = /** @type {any} */ (proposalById('proposal:MG-26-T8'));
        const rows = page.locator('.cmp-table tbody:not(.cmp-totals) tr:not(.cmp-week)');
        await expect(rows).toHaveCount(28);
        const text = (/** @type {string} */ shift) => shift === 'RD' || shift === 'OFF' ? '–' : shift === 'SPARE' ? '📋 Spare' : shift === 'AL' ? '🏖️ AL' : shift;
        for (const d of [1, 5, 9, 14, 20, 27]) {
            const date = new Date(2027, 1, d);
            await expect(rows.nth(d - 1).locator('td').nth(0), `yours, ${d} February`).toContainText(text(getBaseShift(me, date)));
            await expect(rows.nth(d - 1).locator('td').nth(1), `the proposal, ${d} February`).toContainText(text(/** @type {any} */ (dayOn(mg, 4, date)).shift));
        }
        // Not the default: a fresh visit opens on the month, and the stored choice names no view
        expect(JSON.parse(await page.evaluate(() => localStorage.getItem('myb_links_selector_choice') || '{}'))).toEqual({ proposal: 'MG-26-T8', line: 4 });
        await page.goto('/links-selector.html');
        await expect(page.locator('.calendar-grid')).toBeVisible();
        await expect(page.locator('#selectorViewMonth')).toHaveAttribute('aria-pressed', 'true');
        expect(errors).toEqual([]);
    });

    test('Christmas 2027 beside your roster: each side by its own rule — your Christmas leave from your pattern, the proposal\'s from its own', async ({ page }) => {
        await seedSession(page, ADMIN);
        await page.goto('/links-selector.html?proposal=MB-26-V6&line=1&view=mine');
        await page.locator('.month-year').click();
        await page.locator('#monthJumpMonth').selectOption('11');
        await page.locator('#monthJumpConfirm').click();
        await expect(page.locator('.month-year')).toHaveText('December 2027');
        const me = /** @type {any} */ (teamMembers.find(m => m.name === ADMIN));
        const v6 = /** @type {any} */ (proposalById('proposal:MB-26-V6'));
        const row = (/** @type {number} */ d) => page.locator('.cmp-table tbody:not(.cmp-totals) tr:not(.cmp-week)').nth(d - 1);
        for (const d of [25, 27]) {
            const date = new Date(2027, 11, d);
            const mine = /** @type {any} */ (getBaseShift(me, date));
            const xmasMine = d === 25 && isChristmasLeaveDay(me, date);
            const want = xmasMine ? '🏖️ AL' : mine === 'RD' || mine === 'OFF' ? '–' : mine === 'SPARE' ? '📋 Spare' : mine;
            await expect(row(d).locator('td').nth(0)).toContainText(want);
            const theirs = /** @type {any} */ (dayOn(v6, 1, date));
            await expect(row(d).locator('td').nth(1)).toContainText(theirs.shift === 'AL' ? '🏖️ AL' : theirs.shift === 'RD' ? '–' : theirs.shift === 'SPARE' ? '📋 Spare' : theirs.shift);
        }
    });

    // 📆 YEAR (owner, 28 Nov 2026: "do exactly the same with year view"): the proposal's whole year, a small month at a time.
    // What a wrong answer costs: a coloured square that is not that day's kind shows a false rhythm, and a year view that opened
    // by itself would be the default view the owner said it must not be.
    test('Year: never by itself; twelve small months, each day the proposal\'s own; Next is a year; a month\'s name opens it', async ({ page }) => {
        const errors = collectFatalErrors(page);
        await seedSession(page, ADMIN);
        await page.goto('/links-selector.html?proposal=LC-26-T10&line=7');
        await expect(page.locator('#selectorViewYear')).toHaveAttribute('aria-pressed', 'false');
        await expect(page.locator('.yr-months')).toHaveCount(0);
        await page.locator('#selectorViewYear').click();
        await expect(page.locator('#selectorViewYear')).toHaveAttribute('aria-pressed', 'true');
        await expect(page).toHaveURL(/[?&]view=year\b/);
        await expect(page.locator('.yr-title')).toHaveText('2027');
        await expect(page).toHaveTitle(/^2027 — Links Selector/);
        await expect(page.locator('.yr-month')).toHaveCount(12);
        await expect(page.locator('#selectorNote')).toContainText('The whole year, each day coloured by what it is');
        await expect(page.locator('#prevMonth')).toHaveAttribute('aria-label', 'Prev year');
        await expect(page.locator('#prevMonth')).toHaveAttribute('aria-disabled', 'true');
        // Every day of three months: the kind of day the proposal gives, by its colour class and its spoken words
        const lc = /** @type {any} */ (proposalById('proposal:LC-26-T10'));
        const kind = (/** @type {string} */ s) => s === 'RD' || s === 'OFF' ? 'tv-rest' : s === 'SPARE' ? 'tv-spare' : s === 'AL' ? 'tv-al' : null;
        for (const m of [0, 6, 11]) {
            const days = page.locator('.yr-month').nth(m).locator('.yr-day');
            const n = new Date(2027, m + 1, 0).getDate();
            await expect(days).toHaveCount(n);
            for (let d = 1; d <= n; d += 3) {
                const want = /** @type {any} */ (dayOn(lc, 7, new Date(2027, m, d)));
                const cell = days.nth(d - 1);
                if (want.blank) { await expect(cell).toHaveClass(/yr-blank/); continue; }
                const k = kind(want.shift);
                await expect(cell).toHaveClass(k ? new RegExp(k) : /tv-(early|late|night)/);
                if (!k) await expect(cell).toHaveAttribute('aria-label', new RegExp(`${want.shift}`));
            }
        }
        // Next is a year; at 2028 the end is faded
        await page.locator('#nextMonth').click();
        await expect(page.locator('.yr-title')).toHaveText('2028');
        await expect(page.locator('#nextMonth')).toHaveAttribute('aria-disabled', 'true');
        // A month's name opens that month, day by day
        await page.locator('.yr-open', { hasText: 'March' }).click();
        await expect(page.locator('.month-year')).toHaveText('March 2028');
        await expect(page.locator('#selectorViewMonth')).toHaveAttribute('aria-pressed', 'true');
        await expect(page).not.toHaveURL(/view=/);
        expect(errors).toEqual([]);
    });

    test('Compare says what a cell cannot: Sunday shifts are overtime, and what a cover week is — only in a month that has them', async ({ page }) => {
        await seedSession(page, ADMIN);
        await page.goto('/links-selector.html?proposal=MB-26-V6&line=5&view=compare');
        await expect(page.locator('.cmp-foot')).toHaveText(/Sunday shifts are overtime\..*Spare is a cover week: four shifts between Monday and Saturday/);
        // A Sunday cell says so aloud too, where the eye has the note
        const sundayWorked = page.locator('.cmp-table tbody tr', { has: page.locator('th', { hasText: /^Sun/ }) }).locator('td[aria-label*="overtime"]');
        await expect(sundayWorked.first()).toBeAttached();
    });

    // WHAT A MONTH ADDS UP TO (owner, 28 Nov 2026: "Do your suggestions"). What a wrong answer costs: a count that disagrees
    // with the days above it — a colleague votes on "2 weekends off" the grid does not have. So the page's own numbers are
    // checked against the page's own cells, through the real build, and the table's against each column's month.
    test('Totals: under the month, each count is the grid\'s own days; January counts from the 17th; the week chosen is named', async ({ page }) => {
        const errors = collectFatalErrors(page);
        await seedSession(page, ADMIN);
        await page.goto('/links-selector.html?proposal=LC-26-T10&line=7');
        const totals = page.locator('.sel-totals');
        await expect(totals.locator('.sel-totals-head')).toHaveText('January in total, from 17 January · starting on Week 7');
        await page.locator('#nextMonth').click();
        await expect(page.locator('.month-year')).toHaveText('February 2027');
        await expect(totals.locator('.sel-totals-head')).toHaveText('February in total · starting on Week 7');
        // Count the drawn grid, cell by cell: a Sunday shift apart from the rest.
        const cells = await page.locator('.calendar-day[role="button"]').evaluateAll(els => els.map(e => ({
            cls: e.className, sunday: (e.getAttribute('data-detail-day') ?? '').startsWith('Sunday') })));
        const worked = (/** @type {{cls: string}} */ c) => /early-shift|late-shift|night-shift/.test(c.cls);
        const want = {
            early: cells.filter(c => !c.sunday && /early-shift/.test(c.cls)).length,
            late: cells.filter(c => !c.sunday && /late-shift/.test(c.cls)).length,
            rest: cells.filter(c => /rest-day/.test(c.cls)).length,
            sunday: cells.filter(c => c.sunday && worked(c)).length,
        };
        const count = async (/** @type {string} */ key) => Number((await totals.locator(`.sel-total--${key}`).innerText()).match(/\d+/)?.[0]);
        expect(await count('early')).toBe(want.early);
        expect(await count('late')).toBe(want.late);
        expect(await count('rest')).toBe(want.rest);
        if (want.sunday) expect(await count('sunday')).toBe(want.sunday);
        else await expect(totals.locator('.sel-total--sunday')).toHaveCount(0);
        // A different week is a different month, and its totals follow.
        const before = await totals.innerText();
        await page.locator('#selectorLine').selectOption('8');
        await expect(totals.locator('.sel-totals-head')).toContainText('starting on Week 8');
        expect(await totals.innerText()).not.toBe(before);
        expect(errors).toEqual([]);
    });

    test('Totals side by side: a row per count, a number per column, each the column\'s own month; and under the Year', async ({ page }) => {
        await seedSession(page, ADMIN);
        await page.goto('/links-selector.html?proposal=MB-26-V6&line=1&view=compare');
        await page.locator('#nextMonth').click();
        const block = page.locator('tbody.cmp-totals');
        await expect(block.locator('.cmp-week')).toHaveText('February in total');
        const names = await block.locator('th.cmp-total-name').allInnerTexts();
        expect(names.map(n => n.replace(/^\P{L}+/u, '').trim()).slice(0, 2)).toEqual(['Earlies', 'Lates']);
        // Each column's numbers are what that proposal's own month says: open it, read its line, compare.
        const tableEarlies = await block.locator('tr.cmp-total--early td').allInnerTexts();
        for (const [i, p] of proposalsAtoZ().entries()) {
            const tab = await appTab(page.context());   // under the suite's routes, as the test's own page is
            await tab.goto(`/links-selector.html?proposal=${p.code}&line=1`);
            await tab.locator('#nextMonth').click();
            await expect(tab.locator('.month-year')).toHaveText('February 2027');
            const early = (await tab.locator('.sel-total--early').innerText()).match(/\d+/)?.[0];
            expect(tableEarlies[i], `${proposalDisplayName(p)}: the table and its month disagree`).toBe(early);
            await tab.close();
        }
        // Beside your roster, BOTH columns count the same days — from the 17th in January — so neither has the longer month.
        await page.locator('#selectorViewMine').click();
        await page.locator('#prevMonth').click();
        await expect(page.locator('.month-year')).toHaveText('January 2027');
        await expect(block.locator('.cmp-week')).toHaveText('January in total, from 17 January');
        for (const col of [0, 1]) {
            const days = await block.locator('tr.cmp-total-row:not(.cmp-total--weekendsOff)').evaluateAll(
                (rows, i) => rows.reduce((sum, r) => sum + Number(r.querySelectorAll('td')[i]?.textContent ?? 0), 0), col);
            expect(days, col ? 'the proposal' : 'your roster today').toBe(15);
        }
        // The Year: one line for the whole year, counted from the link's start.
        await page.locator('#selectorViewYear').click();
        await expect(page.locator('.selector-year .sel-totals-head')).toHaveText('2027 in total, from 17 January · starting on Week 1');
    });

    // THE WHOLE-PAGE REVIEW (owner, 28 Nov 2026: "bug and regression check the entire Links Selector page"). Each test is a
    // defect a reader would have met; the one-line cause is beside its fix in links-selector-app.js / -render.js.
    test('A manager is never offered "With my roster": a manager\'s row is a login, not a roster', async ({ page }) => {
        const manager = /** @type {string} */ (teamMembers.find(m => m.managerOnly && CONFIG.MANAGER_NAMES.includes(m.name))?.name);
        await seedSession(page, manager);
        await page.goto('/links-selector.html?proposal=MB-26-V6&line=1&view=mine');
        await expect(page.locator('.calendar-grid')).toBeVisible();
        await expect(page.locator('#selectorViewMine')).toBeHidden();
        await expect(page.locator('#selectorViewMonth')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('.cmp-mine')).toHaveCount(0);
    });

    test('Beside your roster, the key names only what the table draws — never a spare day from before the link starts', async ({ page }) => {
        // A member whose January 2027 has spare days ONLY before the 17th, and a proposal week with none from the 17th.
        const me = /** @type {any} */ (teamMembers.find(m => !m.managerOnly && !m.hidden && Array.from({ length: 31 }, (_, i) => i + 1)
            .every(d => (getBaseShift(m, new Date(2027, 0, d)) === 'SPARE') === (d < 17 && getBaseShift(m, new Date(2027, 0, d)) === 'SPARE'))
            && Array.from({ length: 16 }, (_, i) => getBaseShift(m, new Date(2027, 0, i + 1))).includes('SPARE')));
        const v6 = /** @type {any} */ (proposalById('proposal:MB-26-V6'));
        expect(Array.from({ length: 15 }, (_, i) => /** @type {any} */ (dayOn(v6, 2, new Date(2027, 0, 17 + i))).shift)).not.toContain('SPARE');
        await seedSession(page, me.name);
        await page.goto('/links-selector.html?proposal=MB-26-V6&line=2&view=mine');
        await expect(page.locator('.month-year')).toHaveText('January 2027');
        await expect(page.locator('.cmp-table tbody:not(.cmp-totals) td', { hasText: 'Spare' })).toHaveCount(0);
        await expect(page.locator('#legend-spare')).toBeHidden();
    });

    test('Year: no today ring on a day before the link starts; the Today key follows the year, not the month left behind', async ({ page }) => {
        await page.clock.setFixedTime(new Date('2027-01-10T09:00:00Z'));
        await seedSession(page, ADMIN);
        await page.goto('/links-selector.html?proposal=MB-26-V6&line=1&view=year');
        await expect(page.locator('.yr-title')).toHaveText('2027');
        await expect(page.locator('.yr-today')).toHaveCount(0);
        await expect(page.locator('#selectorLegendToday')).toBeHidden();
        // In March, leave the Month view on January, then open the Year: today's ring is on March, and the key says so.
        await page.clock.setFixedTime(new Date('2027-03-10T09:00:00Z'));
        await page.goto('/links-selector.html?proposal=MB-26-V6&line=1');
        await expect(page.locator('.month-year')).toHaveText('March 2027');
        await page.locator('#prevMonth').click();
        await page.locator('#prevMonth').click();
        await expect(page.locator('.month-year')).toHaveText('January 2027');
        await page.locator('#selectorViewYear').click();
        await expect(page.locator('.yr-today')).toHaveCount(1);
        await expect(page.locator('#selectorLegendToday')).toBeVisible();
    });

    test('Year: a swipe re-stamps the printed heading, and ← → keep the keyboard on the same month\'s name', async ({ page }) => {
        await seedSession(page, ADMIN);
        await page.goto('/links-selector.html?proposal=MB-26-V6&line=1&view=year');
        await expect(page.locator('#selectorPrintChoice')).toContainText('the year 2027');
        const box = /** @type {{ x: number, y: number, width: number, height: number }} */ (await page.locator('#calendarDisplay').boundingBox());
        const y = box.y + Math.min(box.height / 2, 300);
        for (let attempt = 0; attempt < 4; attempt++) {
            await page.mouse.move(box.x + box.width - 20, y);
            await page.mouse.down();
            await page.mouse.move(box.x + 20, y, { steps: 12 });
            await page.mouse.up();
            try {
                await page.waitForFunction(() => document.querySelectorAll('.yr-title').length === 1
                    && document.querySelector('.yr-title')?.textContent === '2028', null, { timeout: 5000 });
                break;
            } catch { /* a simulated gesture is sometimes swallowed — e2e/calendar-swipe-redraw.spec.js */ }
        }
        await expect(page.locator('.yr-title')).toHaveText('2028');
        await expect(page.locator('#selectorPrintChoice')).toContainText('the year 2028');
        await page.locator('.yr-open[data-month="2"]').focus();
        await page.keyboard.press('ArrowLeft');
        await expect(page.locator('.yr-title')).toHaveText('2027');
        await expect(page.locator('.yr-open[data-month="2"]')).toBeFocused();
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
