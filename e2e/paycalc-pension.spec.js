/**
 * paycalc-pension.spec.js — the Pay Calculator (paycalc.html): the pension opt-out — across payslips,
 * backwards, its date, and a figure behind the lock.
 *
 * Split by feature out of paycalc.spec.js on 25 Nov 2026, test for test and unchanged; what more than
 * one paycalc-*.spec.js file needs is in paycalc-helpers.js, including the roster rows these tests sign
 * in as, which are chosen by shape and never written down (payroll-anonymity.test.mjs).
 */
import { test, expect } from './fixtures.js';
import { collectFatalErrors, seedSession, seedMember } from './helpers.js';

// ── NOT IN THE PENSION SCHEME (v21.64) ───────────────────────────────────────────────────────────
//
// The reported defect was invisible on the payslip the member was looking at. She typed £0, it held,
// and it reverted on every OTHER payslip — because a payslip with no saved figure falls back to the
// scheme default, and "is she in the scheme?" was never a question the app asked. So the assertion
// that matters is not that the tick box sets £0; it is that £0 SURVIVES the two things that used to
// undo it — switching payslip, and reloading. A unit test cannot see either: both are the
// coordinator's load order (loadSettings runs, then onPeriodChange overwrites what it just wrote).
test('paycalc: the pension opt-out holds across payslips and reloads', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await seedSession(page);
    await seedMember(page);
    await page.goto('/paycalc.html');

    const amt = page.locator('#pensionAmt');
    await expect(amt).toBeVisible();
    const schemeFigure = await amt.inputValue();
    expect(schemeFigure, 'a member in the scheme starts on a real contribution').not.toBe('0.00');

    await page.locator('#pensionOptOutCheck').check();
    await expect(amt).toHaveValue('0.00');
    // Disabled, not merely zeroed: an editable field showing a figure that cannot be changed invites
    // the member to "correct" it and wonder why it will not stick.
    await expect(amt).toBeDisabled();

    // The v21.64 bug reappeared exactly here — a payslip with nothing saved against it, which
    // silently took the default. It must still hold for payslips AT OR AFTER the one she named
    // (v21.78); the payslips before it are the subject of the next test, and asserting 0.00 on
    // those is what this test used to do and what the external review correctly called a defect.
    const sel = page.locator('#periodSelect');
    const values = await sel.locator('option').evaluateAll(os => os.map(o => o.value));
    const from = Number(await page.locator('#pensionOptOutFrom').inputValue());
    const after = values.filter(v => Number(v) >= from);
    expect(after.length, 'the fixture must offer a payslip at or after the opt-out').toBeGreaterThan(0);
    for (const v of after.slice(0, 3)) {
        await sel.selectOption(v);
        await expect(amt).toHaveValue('0.00');
    }

    await page.reload();
    await expect(page.locator('#pensionOptOutCheck')).toBeChecked();
    await expect(page.locator('#pensionAmt')).toHaveValue('0.00');

    // Reversible: rejoining the scheme must put the real figure back, not leave a frozen £0 that
    // would then be saved as a deliberate opt-out on the next keystroke.
    await page.locator('#pensionOptOutCheck').uncheck();
    await expect(page.locator('#pensionAmt')).toHaveValue(schemeFigure);
    await expect(page.locator('#pensionAmt')).toBeEnabled();

    // ...AND THE STORED DEFAULT MUST AGREE WITH THE BOX (v21.77). Un-ticking left the member-level
    // default at '0.00' while the box read "in the scheme": the settings save runs before the field
    // is rebuilt, and copies whatever the field is showing at the time. The visible field is fine
    // either way — `onPeriodChange` repaints it from the grade-derived period default a moment
    // after load — which is exactly why the three assertions above still passed with the defect
    // present, and why the assertion that finds it has to read storage. Not a money error today;
    // a stored figure contradicting the choice beside it, which a pay-data backup would carry to
    // the member's next device.
    await page.reload();
    await expect(page.locator('#pensionOptOutCheck')).not.toBeChecked();
    await expect(page.locator('#pensionAmt')).toHaveValue(schemeFigure);
    await expect(page.locator('#pensionAmt')).toBeEnabled();
    const stored = await page.evaluate(() => localStorage.getItem('myb_pc_gmiller_pension'));
    expect(stored, 'the member-level pension default must not be left at the opted-out zero').not.toBe('0.00');
    expect(errors, 'Uncaught JS exceptions on the pension opt-out').toHaveLength(0);
});

// ── THE LOCK AND THE £ AGREE ON FIRST PAINT (72-hour review) ─────────────────────────────────────
//
// A payslip inside an opt-out spell that still carries an explicit saved pension (typed before she
// left, or frozen by an older Save) was PRICED with that deduction and then had its field locked to
// £0.00 — the lock ran after calculate(), with no recalc. The page read "£0.00 pension" over a
// take-home that had taken one off, until the next keystroke silently corrected it. Probed by effect:
// a recompute that changes nothing on screen must not move the £.
test('paycalc: an opted-out payslip with an old saved pension is priced at the £0 its field shows', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await seedSession(page);
    await seedMember(page);
    await page.goto('/paycalc.html');
    await expect(page.locator('#pensionAmt')).toBeVisible();
    const target = await page.locator('#periodSelect').inputValue();
    await page.evaluate((t) => {
        localStorage.setItem('myb_pc_gmiller_pension_timeline', JSON.stringify([{ from: Number(t), out: true }]));
        localStorage.setItem(`myb_pc_gmiller_p${t}`, JSON.stringify({ otH: 4, otM: 0, pension: 147.36 }));
    }, target);
    await page.reload();
    await expect(page.locator('#periodSelect')).toHaveValue(target);
    await expect(page.locator('#pensionAmt')).toHaveValue('0.00');
    await expect(page.locator('#pensionAmt')).toBeDisabled();
    const firstPaint = await page.locator('#netDisplay').textContent();
    await page.locator('#otH').fill('4');   // the same value — a recompute from what is on screen
    await expect(page.locator('#netDisplay'), 'the first paint priced a pension its field says is £0')
        .toHaveText(/** @type {string} */ (firstPaint));
    expect(errors).toHaveLength(0);
});

// ── AND IT MUST NOT REACH BACKWARDS (v21.78) ─────────────────────────────────────────────────────
//
// The defect external review found in the v21.64 opt-out, reproduced here before it was fixed: a
// 2025/26 payslip with real hours went from a £160.78 pension deduction to £0.00, and its take-home
// rose by £115.92, because the member ticked a box in August 2026.
//
// The mechanism is two good designs colliding. A period whose pension equals the expected amount
// stores `null` and re-reads the default, so it keeps healing as the app learns the real historic
// rates — and the opt-out made that default £0 for every payslip there has ever been. So the
// Settings hint's promise, "payslips from when you WERE contributing keep their own amount", held
// only for the rare payslip carrying an explicitly-typed non-default figure.
//
// This is an e2e and not a unit test on purpose: the rules are unit-tested in
// paycalc-pension.test.mjs, but the collision lives in the coordinator's load order — settings
// paint, then period restore, then calculate — and only a browser runs all three.
test('paycalc: leaving the pension scheme does not rewrite earlier payslips', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.clock.setFixedTime(new Date('2026-07-15T09:00:00Z'));
    await seedSession(page);
    await seedMember(page);
    await page.goto('/paycalc.html');
    await expect(page.locator('#pensionAmt')).toBeVisible();

    const values = await page.locator('#periodSelect option').evaluateAll(os => os.map(o => o.value));
    const oldest = values[0];
    const today  = values[values.length - 1];

    // A historical payslip with hours entered, while she was contributing. Nothing types a pension
    // figure — which is the point: the period stores `pension: null` and takes the default.
    await page.locator('#periodSelect').selectOption(oldest);
    await page.locator('#otH').fill('4');
    await expect(page.locator('#pensionAmt')).not.toHaveValue('0.00');
    const wasPension = await page.locator('#pensionAmt').inputValue();
    const wasNet     = await page.locator('#netDisplay').textContent();
    expect(await page.evaluate(k => JSON.parse(localStorage.getItem(k)).pension, `myb_pc_gmiller_p${oldest}`))
        .toBe(null);   // the self-heal that left it undefended

    // She leaves the scheme, today.
    await page.locator('#periodSelect').selectOption(today);
    await page.locator('#pensionOptOutCheck').check();
    await expect(page.locator('#pensionAmt')).toHaveValue('0.00');
    // The date is the control, and it must be visible and dated — a tick with no date is the bug.
    await expect(page.locator('#pensionOptOutField')).toBeVisible();
    await expect(page.locator('#pensionOptOutFrom')).toHaveValue(today);

    // Back to the historical payslip: unchanged, and still editable.
    await page.locator('#periodSelect').selectOption(oldest);
    await expect(page.locator('#pensionAmt')).toHaveValue(wasPension);
    await expect(page.locator('#pensionAmt')).toBeEnabled();
    expect(await page.locator('#netDisplay').textContent()).toBe(wasNet);

    // And it survives a reload — the timeline is what persists, not a boolean.
    await page.reload();
    await page.locator('#periodSelect').selectOption(oldest);
    await expect(page.locator('#pensionAmt')).toHaveValue(wasPension);
    await page.locator('#periodSelect').selectOption(today);
    await expect(page.locator('#pensionAmt')).toHaveValue('0.00');
    expect(errors, 'Uncaught JS exceptions on the pension timeline').toHaveLength(0);
});

// ── THE TWO EDITS THE CARD MAKES, IN A BROWSER (v21.80) ──────────────────────────────────────────
//
// The rules are unit-tested in paycalc-pension.test.mjs; what is tested HERE is the wiring, which
// is where both defects were. Each was silent on screen and each corrected itself out of sight on
// the next reload, which is the only reason neither showed up in a manual pass:
//
//   · Re-picking a LATER payslip did nothing. The control read one payslip and the figures used
//     another, until a reload put the control back.
//   · Un-ticking ERASED the spell rather than ending it, so the rejoin the hint under the control
//     instructs ("untick the box while viewing the first payslip that has a deduction again") gave
//     back the pension on every payslip she had been out for.
test('paycalc: the opt-out date can be corrected forward, and un-ticking records a rejoin', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.clock.setFixedTime(new Date('2026-07-15T09:00:00Z'));
    await seedSession(page);
    await seedMember(page);
    await page.goto('/paycalc.html');
    await expect(page.locator('#pensionAmt')).toBeVisible();

    const values = await page.locator('#periodSelect option').evaluateAll(os => os.map(o => o.value));
    expect(values.length, 'the fixture must offer several payslips').toBeGreaterThan(4);
    const early = values[values.length - 4];
    const mid   = values[values.length - 3];
    const later = values[values.length - 2];
    const last  = values[values.length - 1];

    // She leaves the scheme — dated, by default, to the payslip she is looking at.
    await page.locator('#periodSelect').selectOption(early);
    const schemeFigure = await page.locator('#pensionAmt').inputValue();
    expect(schemeFigure).not.toBe('0.00');
    await page.locator('#pensionOptOutCheck').check();
    await expect(page.locator('#pensionOptOutFrom')).toHaveValue(early);
    await expect(page.locator('#pensionAmt')).toHaveValue('0.00');

    // ...then corrects it FORWARD: it was actually two payslips later.
    await page.locator('#pensionOptOutFrom').selectOption(later);
    await page.locator('#periodSelect').selectOption(mid);
    await expect(page.locator('#pensionAmt'), 'a payslip she has taken back is contributing again').toHaveValue(schemeFigure);
    await expect(page.locator('#pensionAmt')).toBeEnabled();
    await page.locator('#periodSelect').selectOption(later);
    await expect(page.locator('#pensionAmt')).toHaveValue('0.00');

    // The correction is what persists — not the payslip she first picked.
    await page.reload();
    await expect(page.locator('#pensionOptOutCheck')).toBeChecked();
    await expect(page.locator('#pensionOptOutFrom')).toHaveValue(later);

    // She rejoins, and records it the way the hint tells her to: untick while viewing the first
    // payslip that has a deduction again.
    await page.locator('#periodSelect').selectOption(last);
    await page.locator('#pensionOptOutCheck').uncheck();
    await expect(page.locator('#pensionAmt')).toHaveValue(schemeFigure);
    await expect(page.locator('#pensionOptOutField'), 'the question has no answer once she is back in').toBeHidden();

    // The spell she was out for MUST survive the rejoin — erasing it was the defect.
    await page.reload();
    await expect(page.locator('#pensionOptOutCheck')).not.toBeChecked();
    await page.locator('#periodSelect').selectOption(later);
    await expect(page.locator('#pensionAmt'), 'the months she was out keep their zero').toHaveValue('0.00');
    await page.locator('#periodSelect').selectOption(last);
    await expect(page.locator('#pensionAmt')).toHaveValue(schemeFigure);
    expect(errors, 'Uncaught JS exceptions correcting the pension timeline').toHaveLength(0);
});

// ── A FIGURE BEHIND THE LOCK IS KEPT, NOT ERASED (17 Nov 2026) ───────────────────────────────────
// Inside an opt-out spell the box is locked at £0.00 — the payslip's default there — and the save
// read that as "the default", storing nothing over the figure the payslip held. An hours edit on the
// payslip, or Save settings, erased it; correcting the date then brought back the scheme figure.
test('paycalc: a pension typed on a payslip survives edits inside an opt-out spell, and returns with the date', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.clock.setFixedTime(new Date('2026-07-15T09:00:00Z'));
    await seedSession(page);
    await seedMember(page);
    await page.goto('/paycalc.html');
    await expect(page.locator('#pensionAmt')).toBeVisible();
    const values = await page.locator('#periodSelect option').evaluateAll(os => os.map(o => o.value));
    const early = values[values.length - 4], mid = values[values.length - 3], later = values[values.length - 2];
    const saved = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null')?.pension ?? null, `myb_pc_gmiller_p${mid}`);

    // Her own figure on one payslip…
    await page.locator('#periodSelect').selectOption(mid);
    await page.locator('#pensionAmt').fill('140');
    await expect.poll(saved, 'premise: the figure is saved on that payslip').toBe(140);
    // …then she ticks "not in the scheme", dated — too early — from an earlier payslip.
    await page.locator('#periodSelect').selectOption(early);
    await page.locator('#pensionOptOutCheck').check();
    await page.locator('#periodSelect').selectOption(mid);
    await expect(page.locator('#pensionAmt'), 'premise: inside the spell the box is locked at £0.00').toHaveValue('0.00');
    await expect(page.locator('#pensionAmt')).toBeDisabled();

    // An hours edit on that payslip, and Save settings, while it is locked.
    await page.locator('#otH').fill('2');
    await expect.poll(() => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '{}').otH, `myb_pc_gmiller_p${mid}`)).toBe(2);
    expect(await saved(), 'the edit stored the lock\'s £0.00 over her figure').toBe(140);
    await page.locator('#saveSettingsBtn').click();
    expect(await saved(), 'Save settings wrote over her figure').toBe(140);

    // She corrects the date: the spell starts two payslips later, and her own figure is back.
    await page.locator('#pensionOptOutFrom').selectOption(later);
    await expect(page.locator('#pensionAmt'), 'her £140, not the scheme figure').toHaveValue('140');
    await expect(page.locator('#pensionAmt')).toBeEnabled();
    expect(errors, 'Uncaught JS exceptions keeping the pension figure').toHaveLength(0);
});

// The device that already carries the retired boolean. It records no date, so the migration dates
// it to the first payslip of the current tax year — and the property that makes that safe is
// directional: it can only move a payslip from a wrongly-imposed £0 back to the scheme default,
// never the reverse. Earlier tax years, which the flag was silently rewriting, come back in full.
test('paycalc: a device holding the old opt-out flag has its earlier years given back', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.clock.setFixedTime(new Date('2026-07-15T09:00:00Z'));
    await seedSession(page);
    await seedMember(page);
    await page.addInitScript(() => {
        localStorage.setItem('myb_pc_gmiller_pension_optout', '1');   // as v21.64–v21.77 wrote it
    });
    await page.goto('/paycalc.html');
    await expect(page.locator('#pensionAmt')).toBeVisible();

    // The tick is still on — she did leave the scheme, and the app must not forget that.
    await expect(page.locator('#pensionOptOutCheck')).toBeChecked();
    // ...but it now has a date, and the control that holds it is on screen to be corrected.
    await expect(page.locator('#pensionOptOutField')).toBeVisible();
    const stored = await page.evaluate(() => localStorage.getItem('myb_pc_gmiller_pension_timeline'));
    expect(stored, 'the migration must persist, not recompute on every load').toBeTruthy();

    // A prior-tax-year payslip is contributing again.
    const values = await page.locator('#periodSelect option').evaluateAll(os => os.map(o => o.value));
    await page.locator('#periodSelect').selectOption(values[0]);
    await expect(page.locator('#pensionAmt')).not.toHaveValue('0.00');
    expect(errors, 'Uncaught JS exceptions migrating the pension flag').toHaveLength(0);
});
