/**
 * paycalc-entries.spec.js — the Pay Calculator (paycalc.html): entered hours and settings — what a
 * settings change may save, the loan line, one edit reaching the year so far, and Clear all entries.
 *
 * Split by feature out of paycalc.spec.js on 25 Nov 2026, test for test and unchanged; what more than
 * one paycalc-*.spec.js file needs is in paycalc-helpers.js, including the roster rows these tests sign
 * in as, which are chosen by shape and never written down (payroll-anonymity.test.mjs).
 */
import { test, expect } from './fixtures.js';
import { collectFatalErrors, seedSession, clickInView } from './helpers.js';
// The REAL pay tables, imported rather than restated: the unsupported-role block below asserts that
// a CES is priced as a CES, and a literal rate there would go stale on the next award — or, worse,
// be "corrected" to whatever the page happened to show.
import { AWARD_RATES } from '../paycalc-calc.js';
import { memberSlug } from '../paycalc-migrations.js';
import { LONG_SERVING, PAY_2026_27_DAY, PT_QUIET, AUDIT_DAY, payPageReady } from './paycalc-helpers.js';

// Whole-app review, Oct 2026: a SETTING change (the loan plan, the pension scheme) ran the payslip's
// autosave, which writes the whole form — the calendar's display-only suggestion with it (invariant 11:
// viewing never persists) — and wrote over saved entries that could not be read.
const changeSettings = (/** @type {import('@playwright/test').Page} */ page) => page.evaluate(() => {
    const fire = (/** @type {string} */ id, /** @type {(el: any) => void} */ set) => {
        const el = /** @type {any} */ (document.getElementById(id));
        set(el); el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    fire('studentLoan', el => { el.value = 'plan2'; });
    fire('pgLoanCheck', el => { el.checked = true; });
    fire('pensionOptOutCheck', el => { el.checked = true; });
});
test('paycalc: changing a setting never saves the calendar\'s suggestion as entered hours', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-22T09:00:00Z'));
    await seedSession(page);
    await page.addInitScript(() => localStorage.setItem('myb_pc_ns_migrated', '1'));
    await page.goto('/paycalc.html?payday=2026-10-23');
    await expect(page.locator('#satH'), 'premise: the calendar\'s Saturday is shown, not saved').toHaveClass(/roster-suggested/);
    const saved = () => page.evaluate(() => localStorage.getItem('myb_pc_gmiller_p57'));
    expect(await saved()).toBeNull();
    await changeSettings(page);
    await expect(page.locator('#netDisplay')).not.toBeEmpty();
    expect(await saved(), 'a setting saved the suggestion as though the member had entered it').toBeNull();
});

// …NOR TAPPING INTO A SATURDAY BOX AND LEAVING IT (24-hour review, 25 Nov 2026). The Saturday boxes cap when they
// are left, and that blur saved the whole form every time — the gold suggestion with it, on nothing more than a
// tap in and a tap on Next. Leaving saves only what the cap rewrote; what is typed is saved as it is typed.
test('paycalc: tapping into a Saturday box and leaving it never saves the calendar\'s suggestion; a cap is saved', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-22T09:00:00Z'));
    await seedSession(page);
    await page.addInitScript(() => localStorage.setItem('myb_pc_ns_migrated', '1'));
    await page.goto('/paycalc.html?payday=2026-10-23');
    await expect(page.locator('#satH'), 'premise: the calendar\'s Saturday is shown, not saved').toHaveClass(/roster-suggested/);
    const saved = () => page.evaluate(() => localStorage.getItem('myb_pc_gmiller_p57'));
    await page.locator('#satH').focus();
    await page.locator('#satM').focus();      // leaves the hours box…
    await page.locator('#sunH').focus();      // …and the minutes box
    await expect(page.locator('#netDisplay')).not.toBeEmpty();
    expect(await saved(), 'a look at the Saturday boxes saved the suggestion as though the member had entered it').toBeNull();

    await page.locator('#satH').fill('200');
    await page.locator('#sunH').focus();
    const cap = (/Capped at (\d+) hrs/.exec(await page.locator('#satWarn').innerText()) ?? [])[1];
    expect(cap, 'premise: the box was capped when left').toBeTruthy();
    await expect.poll(async () => JSON.parse(await saved() ?? '{}').satH, 'the capped figure is what is saved').toBe(Number(cap));
});

test('paycalc: changing a setting never writes over saved entries that could not be read', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-22T09:00:00Z'));
    await seedSession(page);
    await page.addInitScript(() => {
        localStorage.setItem('myb_pc_ns_migrated', '1');
        localStorage.setItem('myb_pc_gmiller_p57', '{not json');
    });
    await page.goto('/paycalc.html?payday=2026-10-23');
    await expect(page.locator('.save-status.corrupt')).toBeVisible();
    await changeSettings(page);
    expect(await page.evaluate(() => localStorage.getItem('myb_pc_gmiller_p57')),
        'only something the member TYPES may replace damaged entries').toBe('{not json');
});

// A period holding valid JSON of the wrong SHAPE — a list — read as a payslip with nothing in it, so
// the screen said "No entries saved" over it. It is damaged, and says so, and nothing rewrites it.
test('paycalc: a saved payslip that is a list, not a record, shows the damaged warning and is left alone', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-22T09:00:00Z'));
    await seedSession(page);
    await page.addInitScript(() => {
        localStorage.setItem('myb_pc_ns_migrated', '1');
        localStorage.setItem('myb_pc_gmiller_p57', '[]');
    });
    await page.goto('/paycalc.html?payday=2026-10-23');
    await expect(page.locator('.save-status.corrupt')).toBeVisible();
    await expect(page.locator('#saveStatus')).toContainText("Couldn't read this payslip's saved entries");
    await changeSettings(page);
    expect(await page.evaluate(() => localStorage.getItem('myb_pc_gmiller_p57')),
        'a damaged period was rewritten without the member typing').toBe('[]');
});

// The developer's payslip-actuals sheet said "Imported … Reloading" over a write the browser had
// refused, and the reload took the pasted text with it. Success is now what storage reads back.
test('paycalc: the payslip actuals sheet reports a save or a clear the browser refused, and stays put', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-22T09:00:00Z'));
    await seedSession(page);   // G. Miller — the account whose device offers the actuals sheet
    await page.addInitScript(() => {
        localStorage.setItem('myb_pc_ns_migrated', '1');
        localStorage.setItem('myb_pc_gmiller_actuals', '{"2025-04-11":{"gross":1,"tax":1,"ni":1,"net":1}}');
        const KEY = 'myb_pc_gmiller_actuals';
        const set = Storage.prototype.setItem, remove = Storage.prototype.removeItem;
        Storage.prototype.setItem = function (k, v) {
            if (k === KEY) { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; }
            return set.call(this, k, v);
        };
        Storage.prototype.removeItem = function (k) { if (k !== KEY) remove.call(this, k); };   // refused silently
    });
    await page.goto('/paycalc.html?payday=2026-10-23');
    await payPageReady(page);
    if (!await page.locator('#settingsBody').evaluate(el => el.classList.contains('open'))) {
        await page.locator('#settingsToggle .card-toggle-arrow').click();
    }
    await page.locator('#actualsImportBtn').click();
    await expect(page.locator('#actualsLightbox.visible')).toBeVisible();
    await page.evaluate(() => { /** @type {any} */ (window).__noReload = true; });

    const pasted = '{"2025-05-09":{"gross":2,"tax":2,"ni":2,"net":2}}';
    await page.locator('#actualsInput').fill(pasted);
    await page.locator('#actualsImport').click();
    await expect(page.locator('#actualsStatus')).toHaveText(
        'These figures could not be saved on this device. Your text is still in the box, so you can try again.');
    await expect(page.locator('#actualsInput')).toHaveValue(pasted);

    await page.locator('#actualsClear').click();
    await expect(page.locator('#actualsStatus')).toHaveText(
        'The stored figures could not be removed from this device. Please try again.');
    expect(await page.evaluate(() => /** @type {any} */ (window).__noReload), 'the page reloaded over a failure').toBe(true);
    await expect(page.locator('#actualsLightbox.visible')).toBeVisible();
});

// Review, 15 Nov 2026: "a loan applies to every payslip" moved from under the plan, which every first
// visit read, into the block that shows only once a loan is chosen. paycalc-copy-parity.test.mjs pins
// WHERE the words are; this pins that their block is shown with a loan and only then — a Postgraduate
// Loan on its own included, which puts the same "not deducted" tick under Hours.
test('paycalc: the loan\'s every-payslip line shows only once a loan is chosen', async ({ page }) => {
    await page.clock.setFixedTime(AUDIT_DAY);
    await seedSession(page);
    await page.addInitScript(PT_QUIET);   // a first visit: nothing saved, so Settings starts open
    await page.goto('/paycalc.html');
    await payPageReady(page);
    if (!await page.locator('#settingsBody').evaluate(el => el.classList.contains('open'))) {
        await page.locator('#settingsToggle .card-toggle-arrow').click();
    }
    await expect(page.locator('#settingsBody')).toHaveCSS('visibility', 'visible');
    const line = page.locator('#slEveryPayslip');
    const tick = page.locator('#slSkipRow');   // under Hours → Unusual deductions or corrections
    const plan = (/** @type {string} */ value) => page.evaluate(v => {
        const s = /** @type {HTMLSelectElement} */ (document.getElementById('studentLoan'));
        s.value = v; s.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);

    await expect(line, 'no loan: the line is not read on a first visit').toBeHidden();
    await expect(tick, 'premise: no loan, no tick').toHaveClass(/\bhidden\b/);
    await plan('plan2');
    await expect(line, 'a plan: the line is shown').toBeVisible();
    await expect(tick, '…and the tick it names is there to find').not.toHaveClass(/\bhidden\b/);
    await plan('none');
    await expect(line, 'back to None: the line goes again').toBeHidden();
    await page.locator('#pgLoanCheck').check();
    await expect(line, 'a Postgraduate Loan on its own: the line is shown').toBeVisible();
    await expect(tick).not.toHaveClass(/\bhidden\b/);
    await page.locator('#pgLoanCheck').uncheck();
    await expect(line).toBeHidden();
});

// ── ONE EDIT REACHES THE FIGURES THAT READ STORAGE (whole-app review, Oct 2026) ───────────────
// autosave() priced the page BEFORE it saved, and "This tax year so far" — like the Holiday Pay
// Premium card and its stored estimate, the figure a January payslip adds — reads the payslip back
// from storage. So each lagged one edit behind: the first keystroke changed the result card and
// nothing that summed the year. One input here, and the block must move without a second one.
test('paycalc: one edit reaches "This tax year so far" at once, not on the next edit', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.clock.setFixedTime(new Date('2026-10-25T09:00:00Z'));
    await seedSession(page);
    await page.addInitScript(() => {
        localStorage.setItem('myb_pc_ns_migrated', '1');
        localStorage.setItem('myb_pc_ytd_notice_2_shown', '1');
        // Internal period 51 is the 8 May 2026 payday (48 is 13 Feb 2026; a period is 28 days).
        localStorage.setItem('myb_pc_gmiller_p51', JSON.stringify({
            satH: 7, satM: 0, bhH: 0, bhM: 0, bhOtH: 0, bhOtM: 0, otH: 0, otM: 0,
            rdwH: 0, rdwM: 0, sunH: 0, sunM: 0, boxH: 0, boxM: 0, peer: 0,
            slSkip: false, otherAdj: 0, actualNet: null,
        }));
    });
    await page.goto('/paycalc.html?payday=2026-05-08');
    const block = page.locator('#ytdYearSoFar');
    // SETTLED before it is read: the block's first paint is not its last, and a "before" taken from
    // an earlier one made this pass against the very order it exists to refuse.
    await expect(block).toContainText('1 of 8 paid payslips entered');
    await page.waitForLoadState('networkidle');
    const before = await block.innerText();
    // READ ONCE, NOT POLLED. The input handler prices the page synchronously, so the block is
    // already what this edit made it; a polling assertion would wait for whatever recalculates
    // NEXT, and that later pass reads storage after the save — hiding exactly this lag.
    await page.locator('#otH').fill('10');
    const afterFirst = await block.innerText();
    expect(afterFirst, 'the year still reads the payslip as it was before this edit').not.toBe(before);
    await page.locator('#otH').fill('0');
    expect(await block.innerText(), 'and the next edit moves it again, not to the state one edit ago').not.toBe(afterFirst);
    expect(errors, `fatal errors: ${errors.join(', ')}`).toHaveLength(0);
});

// ── A PAYSLIP WITH NO SPECIAL-RATE HOURS (18 Nov 2026) ─────────────────────────────────────────
// On a Monday-to-Friday line every hours box stays empty — they are all special rates, and basic pay
// needs nothing typed — so the payslip saved only zeros and never counted as entered: "Not entered
// yet" for good. The tick is its entry. The rule is unit-tested (paycalc-form-data, paycalc-fill-year);
// this is the WIRING — the page's own listener saving the tick, and every recalculation hiding it
// while hours are on screen. The member is INVENTED, served on fixed pattern 4 (weekdays only, at rest
// on bank holidays) for this test alone.
const WEEKDAY_MEMBER = 'Test Weekday Member';
test('paycalc: a payslip with no special-rate hours counts as entered once ticked — and hours typed take the tick away', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.clock.setFixedTime(PAY_2026_27_DAY);
    await page.route('**/roster-member-data.js', async (route) => {
        const res = await route.fetch();
        const entry = `{ name: '${WEEKDAY_MEMBER}', currentWeek: 4, rosterType: 'fixed', role: 'CEA' }`;
        const body = (await res.text()).replace(/\n\];\s*$/, `\n    ${entry},\n];\n`);
        expect(body, 'premise: the invented member reached the served roster').toContain(WEEKDAY_MEMBER);
        await route.fulfill({ response: res, body });
    });
    await seedSession(page, WEEKDAY_MEMBER);
    await page.addInitScript(() => localStorage.setItem('myb_pc_ns_migrated', '1'));
    await page.goto('/paycalc.html?payday=2026-10-23');
    const key = `myb_pc_${memberSlug(WEEKDAY_MEMBER)}_p57`;   // 23 Oct 2026 is internal p57
    const saved = () => page.evaluate(k => JSON.parse(localStorage.getItem(k) || 'null'), key);

    const row = page.locator('#noSpecialRow');
    const tick = page.locator('#noSpecialCheck');
    const block = page.locator('#ytdYearSoFar');
    await expect(row, 'no hours on screen: the tick is offered').toBeVisible();
    await expect(tick).not.toBeChecked();
    await expect(block).toContainText('0 of 8 paid payslips entered');
    await expect(page.locator('#saveStatus')).toHaveText('No entries saved for this payslip');

    await clickInView(row);                                   // the whole row is the label
    await expect(tick).toBeChecked();
    await expect(page.locator('#saveStatus')).toHaveText('✓ Entries saved for this payslip');
    await expect(block, 'the ticked payslip counts as entered').toContainText('1 of 8 paid payslips entered');
    expect((await saved())?.noSpecialHours, 'the page saved the tick').toBe(true);

    // Hours typed supersede it: the tick goes, and the save no longer carries it.
    await page.locator('#otH').fill('2');
    await expect(row).toBeHidden();
    await expect.poll(async () => (await saved())?.otH).toBe(2);
    expect((await saved())?.noSpecialHours, 'a payslip cannot hold hours and say it has none').toBe(false);
    await page.locator('#otH').fill('');
    await expect(row, 'hours gone: the tick is offered again').toBeVisible();
    await expect(tick, '…unticked, because the hours superseded it').not.toBeChecked();
    expect(errors, `fatal errors: ${errors.join(', ')}`).toHaveLength(0);
});

// The result card's pay-award warning shows ONLY on today's payslip, so it is seen with Settings shut
// (owner). It shipped with an inline display:none that the class its code toggles could never clear
// (18 Nov 2026), so it had never shown once; no tax year is flagged today, and the next award would
// have been the first to find out. The flag is set for this test alone, in the table the page loads.
test('paycalc: a pay award not on payslips yet is said on the result card — on today\'s payslip only', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.clock.setFixedTime(PAY_2026_27_DAY);
    await page.route('**/paycalc-calc.js', async (route) => {
        const res = await route.fetch();
        const row = 'londonAllowFrom: new Date(2026, 7, 28) }';
        const src = await res.text();
        expect(src.split(row).length - 1, 'premise: the 2026/27 row is found once').toBe(1);
        await route.fulfill({ response: res, body: src.replace(row, 'londonAllowFrom: new Date(2026, 7, 28), rateUnconfirmed: true }') });
    });
    await seedSession(page, LONG_SERVING);
    await page.addInitScript(() => localStorage.setItem('myb_pc_ns_migrated', '1'));
    await page.goto('/paycalc.html');
    const notice = page.locator('#resultRateNotice');
    await expect(notice, 'today\'s payslip: the award is not on payslips yet').toBeVisible();
    await expect(notice).toContainText("isn't confirmed on payslips yet");
    await clickInView(page.locator('#prevBtn'));
    await expect(notice, 'an earlier payslip is not the one about to be paid at the old rate').toBeHidden();
    expect(errors, `fatal errors: ${errors.join(', ')}`).toHaveLength(0);
});

// THE TWO-TAP CLEAR (`createClearConfirm`, paycalc-clear-confirm.js). The one destructive control on the page: the
// first tap only ARMS it, with a countdown; three seconds, or a change of payslip, disarms it; only a
// second tap while armed wipes the payslip — and only the one on screen.
test('paycalc: "Clear all entries" needs a second tap, and disarms itself', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.clock.install({ time: new Date('2026-11-08T12:00:00') });   // on screen: the 20 Nov payslip (P58)
    await seedSession(page);
    await page.addInitScript(() => {
        localStorage.setItem('myb_pc_ns_migrated', '1');
        localStorage.setItem('myb_pc_gmiller_p57', JSON.stringify({ satH: 7 }));
        localStorage.setItem('myb_pc_gmiller_p58', JSON.stringify({ satH: 8 }));
    });
    await page.goto('/paycalc.html');
    await expect(page.locator('#satH')).toHaveValue('8');
    await page.clock.pauseAt(new Date('2026-11-08T12:01:00'));
    const btn = page.locator('#clearBtn');
    const saved = (/** @type {number} */ n) => page.evaluate((k) => localStorage.getItem(k), `myb_pc_gmiller_p${n}`);
    const view = (/** @type {number} */ n) => page.evaluate((num) => {
        const sel = /** @type {HTMLSelectElement} */ (document.getElementById('periodSelect'));
        for (const o of sel.options) o.selected = o.value === String(num);
        sel.dispatchEvent(new Event('change', { bubbles: true }));
    }, n);

    await btn.click();
    await expect(btn).toHaveText('Select again to confirm (3)');
    await expect(btn).toHaveClass(/confirming/);
    await page.clock.runFor(1000);
    await expect(btn).toHaveText('Select again to confirm (2)');
    await page.clock.runFor(2000);
    await expect(btn, 'three seconds disarm it').toHaveText('Clear all entries');
    await expect(btn).not.toHaveClass(/confirming/);
    expect(await saved(58), 'nothing was cleared').not.toBeNull();

    await btn.click();
    await view(57);
    await expect(btn, 'a change of payslip disarms it').toHaveText('Clear all entries');
    await btn.click();
    expect(await saved(57), 'one tap on the new payslip only arms it').not.toBeNull();
    // A double-tap is ONE gesture (whole-app review, Nov 2026): the second tap at once is not a
    // confirmation anybody read, and it used to clear the payslip.
    await btn.click();
    expect(await saved(57), 'a tap straight after arming does not confirm').not.toBeNull();
    await expect(btn).toHaveText('Select again to confirm (3)');
    await page.clock.runFor(1000);
    await btn.click();
    await expect(btn).toHaveText('Clear all entries');
    expect(await saved(57), 'the second tap clears the payslip on screen').toBeNull();
    expect(await saved(58), '…and only that one').not.toBeNull();
    await expect(page.locator('#saveStatus')).toHaveText('No entries saved for this payslip');
    await page.clock.runFor(4000);   // the cleared arm's timers are gone: nothing re-arms or changes
    await expect(btn).toHaveText('Clear all entries');
    expect(errors, 'Uncaught JS exceptions on the Pay Calculator').toHaveLength(0);
});

// THE SETTINGS SUMMARY QUOTES THE RATE THE PAYSLIP WAS PAID AT — periodRate (paycalc-settings.js), the
// answer the rate field shows. They used to work it out separately; before the 28 Aug 2026 award
// payslip it is the earlier rate, and the summary must not quote the new one over it.
test('paycalc: the Settings summary and the rate field agree about the rate a payslip was paid at', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.clock.setFixedTime(new Date('2026-11-08T12:00:00'));
    await seedSession(page);
    await page.addInitScript(() => {
        localStorage.setItem('myb_pc_ns_migrated', '1');
        localStorage.setItem('myb_pc_gmiller_grade', 'cea');
        localStorage.setItem('myb_pc_gmiller_setup', '1');
        localStorage.setItem('myb_pc_gmiller_setup_2026_27', '1');   // the year confirmed, so the summary shows
    });
    await page.goto('/paycalc.html');
    const view = (/** @type {number} */ n) => page.evaluate((num) => {
        const sel = /** @type {HTMLSelectElement} */ (document.getElementById('periodSelect'));
        for (const o of sel.options) o.selected = o.value === String(num);
        sel.dispatchEvent(new Event('change', { bubbles: true }));
    }, n);
    const award = AWARD_RATES.cea['2026/27'];
    expect(award.pre, 'premise: the year has a rate before its award').not.toBe(award.rate);
    await view(54);   // paid 31 Jul 2026
    await expect(page.locator('#settingsHint')).toHaveText(`✓ 2026/27 — £${award.pre.toFixed(2)}/hr · pre-rise`);
    await expect(page.locator('#hourlyRate')).toHaveValue(award.pre.toFixed(2));
    await view(55);   // paid 28 Aug 2026, the award payslip
    await expect(page.locator('#settingsHint')).toHaveText(`✓ 2026/27 — £${award.rate.toFixed(2)}/hr`);
    await expect(page.locator('#hourlyRate')).toHaveValue(award.rate.toFixed(2));
    expect(errors, 'Uncaught JS exceptions on the Pay Calculator').toHaveLength(0);
});

// ── A YEAR NOT YET CHECKED, IN A MEMBER'S FIRST SESSION (whole-app review, Nov 2026) ──────────────
// Grade, tax code, loan and pension are single settings used for every payslip; only the "checked"
// mark is per tax year. The banner said they "apply to 2025/26 only", the card opened announcing a
// "New tax year 2025/26" that had ended, and the header kept the checked year's "✓ … £21.49/hr" over
// a payslip priced at £20.74. Here 2026/27 is checked and 2025/26 is not (the state after a first
// Save, before the one-time sweep of a later load marks the older years).
test('paycalc: stepping back to a year not yet checked says what is true, and no "New tax year" for one that is over', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.clock.setFixedTime(new Date('2026-11-08T12:00:00'));
    await seedSession(page);
    await page.addInitScript(() => {
        localStorage.setItem('myb_pc_ns_migrated', '1');
        localStorage.setItem('myb_pc_gmiller_grade', 'cea');
        localStorage.setItem('myb_pc_gmiller_setup', '1');
        localStorage.setItem('myb_pc_gmiller_setup_2026_27', '1');
        localStorage.setItem('myb_pc_gmiller_setup_years_migrated', '1');
    });
    await page.goto('/paycalc.html');
    const view = (/** @type {number} */ n) => page.evaluate((num) => {
        const sel = /** @type {HTMLSelectElement} */ (document.getElementById('periodSelect'));
        for (const o of sel.options) o.selected = o.value === String(num);
        sel.dispatchEvent(new Event('change', { bubbles: true }));
    }, n);
    await expect(page.locator('#settingsHint')).toHaveText(/^✓ 2026\/27 — £/);
    await view(47);   // paid 16 Jan 2026 — 2025/26, after its award
    await expect(page.locator('#setupBanner')).toBeVisible();
    // What is single and what is per payslip, named — "Your settings apply to every payslip" sat beside
    // "pension saves per payslip" (whole-app review, 24 Nov 2026).
    await expect(page.locator('#setupBannerBody')).toContainText('Your tax code and student loan apply to every payslip, your pension is kept per payslip, and your grade follows the roster by date unless you choose one');
    await expect(page.locator('#setupBannerBody')).not.toContainText('only');
    await expect(page.locator('#settingsHint'), 'no ✓ over a year not yet checked').toHaveText('Check once per tax year — pension saves per payslip');
    await expect(page.locator('#settingsNewYearNotice'), 'a year that is over is not a new one').toBeHidden();
    await view(58);
    await expect(page.locator('#settingsHint')).toHaveText(/^✓ 2026\/27 — £/);
    expect(errors, 'Uncaught JS exceptions on the Pay Calculator').toHaveLength(0);
});
