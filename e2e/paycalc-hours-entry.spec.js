/**
 * paycalc-hours-entry.spec.js — the Pay Calculator (paycalc.html): typing hours — decimal commas and
 * minutes, the iPhone keypad, and editing the Saturday hours.
 *
 * Split by feature out of paycalc.spec.js on 25 Nov 2026, test for test and unchanged; what more than
 * one paycalc-*.spec.js file needs is in paycalc-helpers.js, including the roster rows these tests sign
 * in as, which are chosen by shape and never written down (payroll-anonymity.test.mjs).
 */
import { test, expect } from './fixtures.js';
import { collectFatalErrors, seedSession, isTouchProject, waitForPageSettled, waitForReadsToLand } from './helpers.js';
import { PT_QUIET, openReturning } from './paycalc-helpers.js';

// ── THE IPHONE AUDIT (7 Nov 2026) ─────────────────────────────────────────────────────────────────
// Each block below is one finding, proved where a member meets it: the page, not the helper.

// The converter was the one figure box still read with a bare parseFloat, so "7,5" from a
// decimal-comma keypad answered "7 hrs". The rule is unit-tested (`decimalHoursText`,
// paycalc-inputs.test.mjs); this proves the card asks it.
test('paycalc: the Decimal Hours Converter reads a decimal comma as the point', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await seedSession(page);
    await page.addInitScript(PT_QUIET);
    await page.goto('/paycalc.html');
    await page.locator('#decimalConverterToggle').click();
    const box = page.locator('#decimalHrsInput');
    const answer = page.locator('#decimalHrsResult');
    await box.fill('7,5');
    await expect(answer).toHaveText('7 hrs 30 mins');
    // Only what it can read whole (whole-app check, 10 Nov 2026): these answered "7 hrs" and "1000 hrs".
    await box.fill('7:30');
    await expect(answer, 'a clock time is already hours and minutes').toHaveText('7 hrs 30 mins');
    await box.fill('1e3');
    await expect(answer).toHaveText('–');
    await box.fill('');
    await expect(answer, 'a cleared box asks nothing, so answers nothing').toHaveText('–');
    expect(errors).toHaveLength(0);
});

// A desk keyboard can type a clock time into an hours box; parseInt stopped at the colon, so "7:30" was
// priced and SAVED as 7h while the box still read 7:30 (whole-app review, Nov 2026). The reading is
// unit-tested (`hoursTextToHM`); this proves the price, the save and the blur split all use it.
test('paycalc: "7:30" in an hours box is seven and a half hours — priced, saved and split', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.clock.setFixedTime(new Date('2026-11-07T09:00:00Z'));
    await seedSession(page);
    await page.addInitScript(() => { localStorage.setItem('myb_pc_ns_migrated', '1'); });
    await page.goto('/paycalc.html');
    await expect(page.locator('#pensionAmt')).toBeVisible();
    const pNum = await page.locator('#periodSelect').inputValue();
    await page.locator('#otH').fill('7:30');
    await expect(page.locator('#otH').locator('xpath=ancestor::div[contains(@class,"hhmm-wrap")]/..').locator('.hhmm-dec-hint'))
        .toHaveText('= 7h 30m');
    const saved = await page.evaluate((n) => JSON.parse(localStorage.getItem(`myb_pc_gmiller_p${n}`) ?? 'null'), pNum);
    expect([saved?.otH, saved?.otM], 'saved as typed means, before the box is left').toEqual([7, 30]);
    await page.locator('#otH').blur();
    await expect(page.locator('#otH')).toHaveValue('7');
    await expect(page.locator('#otM')).toHaveValue('30');
    expect(errors).toHaveLength(0);
});

/**
 * A tap whose click iOS CANCELLED: with the soft keyboard up, tapping a control dismisses the
 * keyboard first, the viewport shifts, and the tap never becomes a click — the repo's own
 * measurement, recorded on `wireIosTap` (paycalc-inputs.js). touchstart and touchend reach the
 * control; no click ever does. A real tap would deliver the click, which is why this is built by
 * hand rather than with `tap()`.
 * @param {import('@playwright/test').Locator} control
 */
const tapWithoutClick = (control) => control.evaluate((el) => {
    for (const type of ['touchstart', 'touchend']) {
        const e = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperty(e, 'touches', { value: type === 'touchstart' ? [{ clientX: 1, clientY: 1 }] : [] });
        el.dispatchEvent(e);
    }
});

test('paycalc: with the keypad up, ONE tap works the controls iOS needed two for', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await seedSession(page);
    await page.addInitScript(PT_QUIET);
    await page.goto('/paycalc.html');
    await expect(page.locator('#periodSelect option').first()).toBeAttached();
    const period = () => page.locator('#periodSelect').evaluate(s => Number(/** @type {HTMLSelectElement} */ (s).value));
    const start = await period();
    await tapWithoutClick(page.locator('#prevBtn'));
    await expect.poll(period, '← Earlier').toBe(start - 1);
    await tapWithoutClick(page.locator('#nextBtn'));
    await expect.poll(period, 'Later →').toBe(start);
    // 📍 and the tax-year tabs move the page as the arrows do, and were bare clicks (whole-app check,
    // 10 Nov 2026): with the keypad up, the tap that should have jumped did nothing.
    await tapWithoutClick(page.locator('#prevBtn'));
    await expect.poll(period, '← Earlier, again').toBe(start - 1);
    await tapWithoutClick(page.locator('#todayPeriodBtn'));
    await expect.poll(period, '📍 back to the payslip being earned').toBe(start);
    await tapWithoutClick(page.locator('#tyTab0'));
    await expect.poll(period, 'the 2025/26 tab — that year ends with internal period 49').toBeLessThanOrEqual(49);
    await tapWithoutClick(page.locator('#todayPeriodBtn'));
    await expect.poll(period, '📍 from another tax year').toBe(start);
    await tapWithoutClick(page.locator('#peerPlus'));
    await expect(page.locator('#peerVal'), 'the peer-training +').toHaveText('1');
    await tapWithoutClick(page.locator('#peerMinus'));
    await expect(page.locator('#peerVal'), 'the peer-training −').toHaveText('0');
    await expect(page.locator('#setupBanner')).toBeVisible();
    await tapWithoutClick(page.locator('#saveSettingsBtn'));
    await expect(page.locator('#setupBanner'), 'Save settings confirms the year').toBeHidden();
    // The take-home bar shows while the £ figure is off screen (below the fold at the top of a
    // phone's page), and one tap takes the member to it.
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(page.locator('#stickyTotal')).toBeVisible();
    await tapWithoutClick(page.locator('#stickyTotal'));
    await expect(page.locator('#netDisplay'), 'the take-home bar').toBeInViewport();
    expect(errors).toHaveLength(0);
});

// The same tap must let go of the field FIRST, as a native tap would have: the guard that stops a
// duplicate click also cancels the tap's move of focus. The prior-year Holiday Pay Premium commits
// only on `change`, so a figure typed there and followed by "← Earlier" committed AFTER the page
// had moved — here, into 2025/26, which has no prior year on record, so the figure was lost.
test('paycalc: a tap on ← Earlier lets go of the field first, so its figure lands on the year it was typed for', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await seedSession(page);
    await page.addInitScript(PT_QUIET);
    // A figure already on record keeps the box open before the January 2027 payslip exists.
    await page.addInitScript(() => localStorage.setItem('myb_pc_gmiller_hpp_actual_2025_26', '100.00'));
    await page.goto('/paycalc.html');
    await expect(page.locator('#periodSelect option').first()).toBeAttached();
    // P50 is the first 2026/27 payslip, so ONE step back crosses into 2025/26.
    await page.locator('#periodSelect').evaluate((s) => {
        /** @type {HTMLSelectElement} */ (s).value = '50';
        s.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.locator('#hppCardToggle').click();
    const box = page.locator('#priorHppActualInput');
    await expect(box).toHaveValue('100.00');
    await box.fill('1843.01');
    await tapWithoutClick(page.locator('#prevBtn'));
    await expect.poll(() => page.locator('#periodSelect').evaluate(s => /** @type {HTMLSelectElement} */ (s).value)).toBe('49');
    expect(await page.evaluate(() => localStorage.getItem('myb_pc_gmiller_hpp_actual_2025_26')),
        'the 2025/26 premium typed on a 2026/27 payslip is kept for 2025/26').toBe('1843.01');
    expect(errors).toHaveLength(0);
});

// Typed, then swiped away from: the figure commits only on `change`, which fires when the field is
// left — and a page that is hidden and never comes back is never left. Hiding now lets go of it.
test('paycalc: hiding the page commits the prior-year Holiday Pay Premium being typed', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await seedSession(page);
    await page.addInitScript(PT_QUIET);
    await page.addInitScript(() => localStorage.setItem('myb_pc_gmiller_hpp_actual_2025_26', '100.00'));
    await page.goto('/paycalc.html');
    await expect(page.locator('#periodSelect option').first()).toBeAttached();
    await page.locator('#hppCardToggle').click();
    const box = page.locator('#priorHppActualInput');
    await expect(box).toHaveValue('100.00');
    await box.fill('1843.01');
    expect(await page.evaluate(() => localStorage.getItem('myb_pc_gmiller_hpp_actual_2025_26')),
        'not yet — it commits on leaving the field, by design (v17.26)').toBe('100.00');
    // What swiping to the Home Screen does to the page: it is hidden, and nothing else happens.
    await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
        document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(await page.evaluate(() => localStorage.getItem('myb_pc_gmiller_hpp_actual_2025_26'))).toBe('1843.01');
    expect(errors).toHaveLength(0);
});

// THE TAKE-HOME BAR WITH THE KEYPAD UP. The keyboard covers the bottom of the layout viewport without
// shrinking it, so typing on the Overtime or Rest Day Working rows put the £ behind the keys while the
// IntersectionObserver still called it "in view" — and no bar came. Where the bar did come, pinned
// above the keys, it sat on the very box being typed in. The rules are unit-tested
// (paycalc-sticky-total.test.mjs); this runs the real module on a real page. Playwright raises no
// soft keyboard, so a stand-in visualViewport — read by nothing else in the app — is shrunk instead.
test('paycalc: with the keypad up, the take-home bar comes when the £ is behind the keys, and clears the box being typed in', async ({ page }, info) => {
    test.skip(!isTouchProject(info), 'the keyboard rules are for a coarse pointer');
    const errors = collectFatalErrors(page);
    await seedSession(page);
    await page.addInitScript(PT_QUIET);
    await page.addInitScript(() => {
        const vv = new EventTarget();
        let height = window.innerHeight;
        Object.defineProperty(vv, 'height', { get: () => height });
        Object.defineProperty(vv, 'offsetTop', { get: () => 0 });
        Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => vv });
        /** @type {any} */ (window).__keyboardTo = (/** @type {number} */ h) => { height = h; vv.dispatchEvent(new Event('resize')); };
    });
    await page.goto('/paycalc.html');
    // Settled, and the calendar read answered: the roster hint bar arrives with it and would move
    // every row under a geometry measured too soon.
    await waitForPageSettled(page);
    await waitForReadsToLand(page);
    // …and a first visit's Settings card has finished opening: it grows ~900px in the 0.3s after the
    // page is ready, so a scroll taken mid-reveal left the £ wherever the rest of it pushed the page.
    await page.evaluate(() => Promise.all(document.getAnimations()
        .filter(a => a instanceof CSSTransition).map(a => a.finished.catch(() => null))));
    const bar = page.locator('#stickyTotal');

    // The £ low in the layout viewport: in view by the observer's lights, so no bar yet.
    await page.evaluate(() => {
        const net = /** @type {HTMLElement} */ (document.getElementById('netDisplay'));
        window.scrollBy(0, net.getBoundingClientRect().top - (window.innerHeight - 60));
    });
    await expect(bar).toBeHidden();

    // Type on the Rest Day Working row, and raise a keyboard whose top is just below the box — where
    // iOS puts a focused box — so the £ is now behind the keys.
    const geometry = await page.evaluate(() => {
        const box = /** @type {HTMLInputElement} */ (document.getElementById('rdwH'));
        box.focus({ preventScroll: true });
        const boxBottom = box.getBoundingClientRect().bottom;
        const keysTop = Math.round(boxBottom + 20);
        /** @type {any} */ (window).__keyboardTo(keysTop);
        const net = /** @type {HTMLElement} */ (document.getElementById('netDisplay')).getBoundingClientRect();
        return { keysTop, netTop: net.top, innerHeight: window.innerHeight };
    });
    expect(geometry.netTop, 'the setup must put the £ behind the keys and inside the layout viewport')
        .toBeGreaterThan(geometry.keysTop);
    expect(geometry.netTop).toBeLessThan(geometry.innerHeight);
    await expect(bar, 'the £ is behind the keyboard, so the bar must carry it').toBeVisible();
    await expect(bar).toHaveClass(/keyboard-up/);

    // …and the bar, pinned above the keys, does not sit on the box being typed in.
    await expect.poll(() => page.evaluate(() => {
        const box = /** @type {HTMLElement} */ (document.getElementById('rdwH')).getBoundingClientRect();
        const b = /** @type {HTMLElement} */ (document.getElementById('stickyTotal')).getBoundingClientRect();
        return Math.round(b.top - box.bottom);
    }), { message: 'the gap between the box and the bar above the keys' }).toBeGreaterThanOrEqual(7);
    expect(errors).toHaveLength(0);
});

// ── EDITING THE SATURDAY HOURS (edit-sequence tests, 25 Nov 2026) ─────────────────────────────────
// The box capped Saturday hours at the contracted maximum on EVERY keystroke, so an edit that passes through a
// bigger number on its way to the one meant — "32" made "36" by typing the 6 before deleting the 2 reads 362 for
// a moment — was rewritten to the cap, and the digits being edited were gone. It warns while typing and caps when
// the box is left; the pay maths caps the hours itself meanwhile, so nothing is overpaid.
test('paycalc: an edit passing through too many Saturday hours keeps the figure meant; the cap waits for the box to be left', async ({ page }) => {
    await openReturning(page, { width: 390, height: 844 });
    const hrs = page.locator('#satH');
    const mins = page.locator('#satM');
    const warn = page.locator('#satWarn');
    await hrs.fill('');
    await hrs.pressSequentially('32');
    await hrs.press('Home');
    await hrs.press('ArrowRight');
    await hrs.press('6');
    await expect(hrs, 'mid-edit, the digits stay as typed').toHaveValue('362');
    await expect(warn).toHaveClass(/\bshow\b/);
    await expect(warn).toContainText('capped there when you leave the box');
    await hrs.press('Delete');
    await mins.focus();
    await expect(hrs, 'the figure meant').toHaveValue('36');
    await expect(warn).not.toHaveClass(/\bshow\b/);

    // Too many, and the box left: capped then, and said.
    await hrs.fill('');
    await hrs.pressSequentially('200');
    await expect(hrs).toHaveValue('200');
    await mins.focus();
    await expect(warn).toContainText(/Capped at \d+ hrs/);
    const cap = (/Capped at (\d+) hrs/.exec(await warn.innerText()) ?? [])[1];
    await expect(hrs).toHaveValue(String(cap));

    // The minutes box holds two digits: a key pressed in a full box changes nothing, and a digit typed over
    // a selected one is the figure meant.
    await hrs.fill('');
    await hrs.pressSequentially('8');
    await mins.fill('');
    await mins.pressSequentially('30');
    await mins.press('End');
    await mins.press('5');
    await expect(mins).toHaveValue('30');
    await mins.press('Shift+ArrowLeft');
    await mins.press('5');
    await expect(mins).toHaveValue('35');
});
