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
