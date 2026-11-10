// @ts-check
/**
 * paycalc-cards.spec.js — the Pay Calculator's occasional cards, against what the rest of the page
 * shows, in a real browser.
 *
 * The cards' RULES are unit-tested beside their modules (paycalc-hpp.test.mjs and its neighbours).
 * What only a page can show is the WIRING: that an entry on a card reaches the take-home, the
 * banners and the year block it feeds, and that a card says what is on this device NOW rather than
 * what was there when the page loaded. Each test below names the defect it was written for.
 */
import { test, expect } from './fixtures.js';
import { collectFatalErrors, seedSession } from './helpers.js';

const QUIET = () => {
    localStorage.setItem('myb_pc_ns_migrated', '1');
    localStorage.setItem('myb_pc_ytd_notice_2_shown', '1');
};

/** Parse a rendered "£3,122.27" into a number. */
const poundsOf = (/** @type {string|null} */ s) => parseFloat(String(s ?? '').replace(/[^0-9.]/g, ''));

/** Show the payslip whose option reads `paid` (e.g. "15 Jan 2027"), the way a member picks one. */
async function showPayslip(/** @type {import('@playwright/test').Page} */ page, /** @type {string} */ paid) {
    await expect(page.locator('#periodSelect option').first()).toBeAttached();
    const value = await page.locator('#periodSelect').evaluate((s, label) =>
        [.../** @type {HTMLSelectElement} */ (s).options].find(o => o.textContent?.includes(label))?.value ?? '', paid);
    expect(value, `the period list offers the ${paid} payslip`).not.toBe('');
    await page.locator('#periodSelect').evaluate((s, v) => {
        /** @type {HTMLSelectElement} */ (s).value = v;
        s.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);
}

// ── CONFIRMING LAST YEAR'S PREMIUM REPRICES THE JANUARY PAYSLIP (paycalc-2-1) ───────────────────
//
// The confirmed figure is stored and the HPP card repaints — and until v25.6x nothing else did:
// the take-home, its banner, the chips and the year block were all built by `calculate()`, which
// the confirm box never ran. A member who typed the figure off their January payslip read
// "✓ Confirmed £1,843.01" on the card above a take-home still built on the old estimate. The
// assertions pair the WORDS with the FIGURE, because either alone passes against the old code
// for half its cases.

test('paycalc: confirming last year\'s premium reprices the January take-home it is ticked into', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.clock.setFixedTime(new Date('2027-01-16T10:00:00Z'));   // the day after the January payday
    await seedSession(page);
    await page.addInitScript(QUIET);
    await page.addInitScript(() => {
        localStorage.setItem('myb_pc_gmiller_hpp_est_2025_26', '1700.00');
        localStorage.setItem('myb_pc_gmiller_hpp_inc_2025_26', '1');   // ticked into the take-home
    });
    await page.goto('/paycalc.html');
    await showPayslip(page, '15 Jan 2027');
    await expect(page.locator('#hppBannerText')).toContainText('Includes estimated Holiday Pay Premium of £1,700.00');
    const before = poundsOf(await page.locator('#netDisplay').textContent());

    await page.locator('#hppCardToggle').click();
    const box = page.locator('#priorHppActualInput');
    await expect(box).toBeEnabled();
    await box.fill('1843.01');
    await box.press('Tab');                                  // it commits on `change`, never per keystroke

    await expect(page.locator('#priorHppAmt')).toHaveText('£1,843.01');
    await expect(page.locator('#hppBannerText'), 'the banner names the CONFIRMED figure, no longer "estimated"')
        .toContainText('Includes Holiday Pay Premium of £1,843.01');
    await expect.poll(async () => poundsOf(await page.locator('#netDisplay').textContent()),
        'the take-home moves by a taxed share of the £143.01 difference').toBeGreaterThan(before);
    const after = poundsOf(await page.locator('#netDisplay').textContent());
    expect(after - before).toBeLessThan(143.01);
    expect(errors).toHaveLength(0);
});

// ── THE YEAR BLOCK KEEPS A KEYBOARD USER'S PLACE (paycalc-2-18) ─────────────────────────────────
//
// "This tax year so far" is rebuilt with innerHTML on every recalculation, and a focused button that
// leaves the page drops focus to the body. So a keyboard user on "Fill these from your calendar" lost
// their place whenever anything recalculated, and again when the fill ended — with its receipt, a
// status region inserted already filled, often never read out. The recalculation is started from
// script so that focus is not moved by the test itself: only the rebuild can move it. (When the end
// of a fill may take focus, and when it must not, is unit-tested in paycalc-year-card.test.mjs.)

test('paycalc: the year fill button keeps keyboard focus through a recalculation, and a keyboard fill focuses its receipt', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.clock.setFixedTime(new Date('2026-11-07T09:00:00Z'));   // inside 2026/27, paid payslips waiting
    await seedSession(page);
    await page.addInitScript(QUIET);
    await page.goto('/paycalc.html');
    const btn = page.locator('#fillYearBtn');
    await expect(btn).toBeVisible();

    await btn.focus();
    await btn.evaluate((b) => { b.dataset.before = '1'; });             // marks THIS node, not its successor
    await page.locator('#taxCode').evaluate((el) => el.dispatchEvent(new Event('input', { bubbles: true })));
    await expect(page.locator('#fillYearBtn:not([data-before])'), 'the block was rebuilt').toBeAttached();
    await expect(btn, 'focus came back to the rebuilt button, not the page body').toBeFocused();

    await page.keyboard.press('Enter');
    const receipt = page.locator('#ytdYearSoFar .yearso-receipt');
    await expect(receipt).toContainText(/Filled \d+ payslips? from your calendar/);
    await expect(receipt, 'a fill started from the keyboard moves focus to what it did').toBeFocused();
    expect(errors, `fatal errors: ${errors.join(', ')}`).toHaveLength(0);
});

test('paycalc: with no estimate, confirming last year\'s premium offers it on the January payslip at once', async ({ page }) => {
    // The member who entered no 2025/26 hours has no estimate, so no banner — and the banner carries
    // the opt-in tick. Before the fix it appeared only after some unrelated edit.
    const errors = collectFatalErrors(page);
    await page.clock.setFixedTime(new Date('2027-01-16T10:00:00Z'));
    await seedSession(page);
    await page.addInitScript(QUIET);
    await page.goto('/paycalc.html');
    await showPayslip(page, '15 Jan 2027');
    await expect(page.locator('#hppActiveBanner')).toBeHidden();

    await page.locator('#hppCardToggle').click();
    await page.locator('#priorHppActualInput').fill('500');
    await page.locator('#priorHppActualInput').press('Tab');

    await expect(page.locator('#hppActiveBanner')).toBeVisible();
    await expect(page.locator('#hppBannerText')).toContainText('Holiday Pay Premium of £500.00 could land on this payslip');
    expect(errors).toHaveLength(0);
});

// ── "ON THIS DEVICE" IS WHAT IS ON THIS DEVICE NOW (paycalc-2-11) ───────────────────────────────
//
// Move Your Pay Data lists what a copy would carry. The list was painted once, at page load, so a
// member who entered payslips and THEN opened the card to save a copy — the order anyone changing
// phone would go in — read a list without them. The downloaded file was always right; the list that
// answers "what am I about to carry?" was not.

test('paycalc: Move Your Pay Data lists the payslips entered since the page opened', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.clock.setFixedTime(new Date('2026-11-07T09:00:00Z'));
    await seedSession(page);
    await page.addInitScript(QUIET);
    await page.goto('/paycalc.html');
    await expect(page.locator('#periodSelect option').first()).toBeAttached();
    const list = page.locator('#ptInventory');
    await expect(list, 'precondition: a fresh device holds no payslip').not.toContainText('payslip');

    await page.locator('#otH').fill('5');                                  // saved as it is typed
    await page.locator('#payTransferToggle').click();
    await expect(list, 'opening the card reads what is saved now').toContainText('1 payslip of entered figures');

    // And with the card open, an entry elsewhere on the page reaches it too.
    await showPayslip(page, '25 Sep 2026');
    await page.locator('#otH').fill('3');
    await expect(list).toContainText('2 payslips of entered figures');
    expect(errors, `fatal errors: ${errors.join(', ')}`).toHaveLength(0);
});

// ── THE BACKUP IS NAMED FOR THE DAY IT IS HERE (paycalc-2-21) ───────────────────────────────────
//
// The filename took its date from the UTC instant, so a copy saved between midnight and 01:00 in UK
// summer time — a night turn's end — was named for the day before. `backupFilename`'s own rule is
// unit-tested (paycalc-transfer.test.mjs); this is the card passing it the right thing.

test.describe('a backup saved after midnight in summer', () => {
    test.use({ timezoneId: 'Europe/London' });

    test('paycalc: a backup saved at 00:30 UK time is named for that day, not the day before', async ({ page }) => {
        const errors = collectFatalErrors(page);
        await page.clock.setFixedTime(new Date('2026-07-14T23:30:00Z'));   // 00:30 on 15 Jul in the UK
        await seedSession(page);
        await page.addInitScript(QUIET);
        await page.addInitScript(() => {
            localStorage.setItem('myb_pc_gmiller_p51', JSON.stringify({
                satH: 7, satM: 0, bhH: 0, bhM: 0, bhOtH: 0, bhOtM: 0, otH: 0, otM: 0,
                rdwH: 0, rdwM: 0, sunH: 0, sunM: 0, boxH: 0, boxM: 0, peer: 0,
                slSkip: false, otherAdj: 0, actualNet: null,
            }));
        });
        await page.goto('/paycalc.html');
        await page.locator('#payTransferToggle').click();
        const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#ptDownload').click()]);
        expect(download.suggestedFilename()).toBe('myb-pay-backup-gmiller-2026-07-15.json');
        expect(errors, `fatal errors: ${errors.join(', ')}`).toHaveLength(0);
    });
});
