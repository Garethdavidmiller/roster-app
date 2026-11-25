/**
 * paycalc-ytd.spec.js — the Pay Calculator (paycalc.html): the payslip check and the Year to Date
 * figures — which payslip they sharpen, and when they are not used.
 *
 * Split by feature out of paycalc.spec.js on 25 Nov 2026, test for test and unchanged; what more than
 * one paycalc-*.spec.js file needs is in paycalc-helpers.js, including the roster rows these tests sign
 * in as, which are chosen by shape and never written down (payroll-anonymity.test.mjs).
 */
import { test, expect } from './fixtures.js';
import { collectFatalErrors, seedSession, seedMember, clickInView, waitForReadsToLand } from './helpers.js';
import { LONG_SERVING, LONG_SERVING_PC, poundsOf } from './paycalc-helpers.js';

// The data-ownership prompt is the paycalc overlay with the highest stakes — it decides whether
// another member's pay data on a shared device is claimed or discarded — so it must actually open,
// and it must be the ONLY thing open (overlay.js manages a single active overlay; two at once fight
// over Back/Escape/Tab).
//
// This is a STACKING test again (v21.91). It stopped being one twice over — the welcome lightbox was
// retired at v19.36, and the YTD notice went past its expiry on 5 Jul, leaving nothing on the page to
// stack WITH; the comment here recorded that loss as real and deliberate rather than pretending the
// assertion still meant something. Re-posting the YTD notice restores the competitor, so the
// priority rule is exercised from the outside once more. Note what that means: the value of the
// `toHaveCount(1)` assertion below has been silently zero for seven weeks, and only the note saying
// so made that recoverable.
// ── Estimate vs payslip (v22.07) ──────────────────────────────────────────────────────────────
// The builder and the round trip are unit-tested; a browser proves the WIRING — the disclosure,
// the table appearing as figures are typed, and saved figures surviving a reload INTO AN OPEN
// section (restored values hidden behind a closed disclosure was the designed-against failure).

// ── The payslip in hand, and the two settings that explain most big gaps (v24.87) ────────────────
// A colleague held her 23 Oct 2026 payslip on the 22nd and found no box to check it in: it appeared
// only from payday. And her £111.51 gap came from two settings — no pension, the default tax code —
// which the old line never mentioned. The wording is unit-tested (paycalc-breakdown.test.mjs); THIS
// pins the wiring: that the box keys off the payslip in hand, and that the line is handed the code
// and pension the estimate really used, not the box contents or a default.
test('paycalc: the payslip check is there while the payslip is in hand, and names this estimate\'s tax code and pension', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.clock.setFixedTime(new Date('2026-10-22T09:00:00Z'));   // cut off on the 17th, pays the 23rd
    await seedSession(page);
    await page.addInitScript(() => { localStorage.setItem('myb_pc_ns_migrated', '1'); });
    await page.goto('/paycalc.html?payday=2026-10-23');
    await expect(page.locator('#pensionAmt')).toBeVisible();
    await expect(page.locator('#checkActualWrap'), 'before payday, with the payslip in hand').toBeVisible();

    const verdict = page.locator('#actualVerdict');
    await page.locator('#taxCode').fill('1182L');
    await page.locator('#actualNetInput').fill('1000');                 // far from any estimate: the big-gap line
    await expect(verdict).toContainText('this estimate uses tax code 1182L and a pension of £151.86.');
    // The pension the ESTIMATE took, read through the same path as the figure: a typed 0 is an opt-out.
    await page.locator('#pensionAmt').fill('0');
    await expect(verdict).toContainText('this estimate uses tax code 1182L and no pension.');
    // And a blank Tax Code box is named as what the calculation made of it.
    await page.locator('#taxCode').fill('');
    await expect(verdict).toContainText('this estimate uses tax code 1257L and no pension.');
    // A code the calculator cannot read is priced on the standard allowance, so it is never quoted as
    // the code in use (v24.89) — "OT" with a letter O beside a payslip's 0T was the case found.
    await page.locator('#taxCode').fill('OT');
    await expect(verdict).toContainText("The tax code in Your Settings, OT, isn't one the calculator recognises");
    await expect(verdict).not.toContainText('this estimate uses tax code OT');

    // The NEXT payslip has not been cut off yet, so it cannot be in anybody's hand.
    const next = await page.locator('#periodSelect option').evaluateAll(os =>
        os.find(o => /20 November 2026/.test(o.textContent ?? ''))?.getAttribute('value') ?? null);
    expect(next, 'the 20 Nov payslip is on the list').not.toBeNull();
    await page.locator('#periodSelect').selectOption(/** @type {string} */ (next));
    await expect(page.locator('#checkActualWrap')).toBeHidden();
    expect(errors).toHaveLength(0);
});

// ── A CODE THE CALCULATOR DOES NOT RECOGNISE, SAID WHERE IT MATTERS (whole-app review, Nov 2026) ──
// Priced on the standard 1257L allowance, and only the check line above said so — hidden until the
// payslip's cut-off. The words are unit-tested; this pins calculate() handing computeTax's own flag to
// the Income Tax row, the box's warning and the Year to Date line, on the payslip the page opens on.
test('paycalc: an unrecognised tax code is named under Income Tax and the box, and the Year to Date line holds back', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.clock.setFixedTime(new Date('2026-11-07T09:00:00Z'));   // 20 Nov is next; 23 Oct is paid
    await seedSession(page);
    await seedMember(page);
    await page.addInitScript(() => {
        localStorage.setItem('myb_pc_ns_migrated', '1');
        localStorage.setItem('myb_pc_ytd_notice_2_shown', '1');
    });
    await page.goto('/paycalc.html');
    await expect(page.locator('#pensionAmt')).toBeVisible();
    await page.locator('#periodSelect').selectOption('58');
    const line = page.locator('#netYtdNudge');
    await expect(line, 'premise: with 1257L the line asks for the figures').toBeVisible();

    await page.locator('#taxCode').fill('OT');
    await expect(page.locator('#summary')).toContainText("Tax code OT isn't one the calculator recognises");
    await expect(line, 'with a wrong code the figures make the estimate worse').toBeHidden();
    await expect(page.locator('#taxCodeWarn.show'), 'nothing flashes while the box is being typed in').toHaveCount(0);
    await page.locator('#taxCode').blur();
    const warn = page.locator('#taxCodeWarn');
    await expect(warn).toBeVisible();
    await expect(warn).toContainText('0T and D0 are written with a zero, not the letter O');

    await page.locator('#taxCode').fill('0T');
    await page.locator('#taxCode').blur();
    await expect(warn).toBeHidden();
    await expect(page.locator('#summary')).not.toContainText('recognises');
    expect(errors).toHaveLength(0);
});

test('paycalc: with Year to Date figures in use, a payslip gap names the payslip they count from (v24.89)', async ({ page }) => {
    /*
     * On 22 Oct a first entry is stamped with the 25 Sep payslip — the latest PAID one — while a
     * member may hold the 23 Oct payslip already. The card names its payslip; this is the line a
     * member chasing a gap reads, and it is only as good as the calculator handing it the anchor
     * actually used. (Figures COPIED from 23 Oct but stamped 25 Sep no longer fit the code, so they
     * are not used at all — 21 Nov 2026; these are 25 Sep's own, £2,845.20 being what 1257L takes.)
     */
    const errors = collectFatalErrors(page);
    await page.clock.setFixedTime(new Date('2026-10-22T09:00:00Z'));   // the 23 Oct payslip is in hand
    await seedSession(page);
    await seedMember(page);
    await page.addInitScript(() => {
        localStorage.setItem('myb_pc_ns_migrated', '1');
        localStorage.setItem('myb_pc_ytd_notice_2_shown', '1');
        localStorage.setItem('myb_pc_gmiller_ytd_src_2026_27', '56');   // paid 25 Sep — the first-entry stamp that day
        localStorage.setItem('myb_pc_gmiller_ytd_pay_2026_27', '21000');
        localStorage.setItem('myb_pc_gmiller_ytd_tax_2026_27', '2845.20');
    });
    await page.goto('/paycalc.html?payday=2026-10-23');
    await expect(page.locator('#ytdStatusChip')).toHaveText('✓ in use');
    await page.locator('#actualNetInput').fill('1000');                 // far from any estimate: the big-gap line
    const verdict = page.locator('#actualVerdict');
    await expect(verdict).toContainText('It also counts your Year to Date figures as copied from your 25 Sep payslip');
    // The 23 Oct payslip chosen instead: the figures now sharpen the NEXT payslip, so this one's line
    // stops naming them.
    await page.locator('#ytdSrcSelect').selectOption('57', { force: true });
    await expect(page.locator('#ytdStatusChip')).not.toHaveText('✓ in use');
    await expect(verdict).toContainText('this estimate uses tax code');
    await expect(verdict).not.toContainText('counts your Year to Date figures');
    expect(errors).toHaveLength(0);
});

test('paycalc: the payslip comparison renders per typed line and survives a reload', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await seedSession(page);
    await page.addInitScript(() => { localStorage.setItem('myb_pc_ytd_notice_2_shown', '1'); });
    await page.goto('/paycalc.html');
    await expect(page.locator('#periodSelect option').first()).toBeAttached();
    // A PAID period — the check block renders once a payslip may be in hand (from its cut-off,
    // v24.87), and P2's payday is long past.
    await page.locator('#periodSelect').selectOption({ index: 1 });
    await expect(page.locator('#checkActualWrap')).toBeVisible();

    await clickInView(page.locator('#actualMoreBtn'));
    await expect(page.locator('#actualMoreWrap')).toBeVisible();
    await page.locator('#actualGrossInput').fill('3808.87');
    await page.locator('#actualTaxInput').fill('540.20');
    const table = page.locator('#actualCompare table.actual-cmp');
    await expect(table).toBeVisible();
    await expect(table).toContainText('Taxable Pay');
    await expect(table).toContainText('Income Tax');
    await expect(table).toContainText('£3,808.87');
    // Only the typed lines render — an absent figure is not a £0 claim.
    await expect(table).not.toContainText('National Insurance');

    // Reload: the figures persisted into the period blob, and the section restored OPEN.
    await page.reload();
    await expect(page.locator('#periodSelect option').first()).toBeAttached();
    await page.locator('#periodSelect').selectOption({ index: 1 });
    await expect(page.locator('#actualMoreWrap')).toBeVisible();
    await expect(page.locator('#actualGrossInput')).toHaveValue('3808.87');
    await expect(page.locator('#actualCompare table.actual-cmp')).toBeVisible();

    expect(errors, `fatal errors: ${errors.join(', ')}`).toHaveLength(0);
});

// ── LIKE WITH LIKE (whole-app check, 10 Nov 2026) ──────────────────────────────────────────────
// The payslip's pay figure is its Taxable Pay, AFTER the pension, and the comparison set it against
// the estimate's Total pay, BEFORE it — so a perfect estimate showed the whole pension as a gap. The
// figure typed here is the estimate's own "Pay after pension deduction", read off the summary, so the
// row must read as a match.
test('paycalc: the comparison sets the payslip\'s Taxable Pay against the pay after the pension', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await seedSession(page);
    await page.addInitScript(() => { localStorage.setItem('myb_pc_ytd_notice_2_shown', '1'); });
    await page.goto('/paycalc.html');
    await expect(page.locator('#periodSelect option').first()).toBeAttached();
    await page.locator('#periodSelect').selectOption({ index: 1 });
    await expect(page.locator('#checkActualWrap')).toBeVisible();

    const afterPension = page.locator('#summary .sum-row', { hasText: 'Pay after pension deduction' }).locator('.val');
    await expect(afterPension).toBeVisible();
    const figure = (await afterPension.textContent() ?? '').replace(/[£,]/g, '').trim();
    expect(Number(figure)).toBeGreaterThan(0);

    await clickInView(page.locator('#actualMoreBtn'));
    await page.locator('#actualGrossInput').fill(figure);
    const row = page.locator('#actualCompare table.actual-cmp tbody tr', { hasText: 'Taxable Pay' });
    await expect(row).toBeVisible();
    await expect(row.locator('td').last()).toHaveText('—');
    await expect(row.locator('td').last()).toHaveClass(/cmp-same/);

    expect(errors, `fatal errors: ${errors.join(', ')}`).toHaveLength(0);
});

// ── THE YEAR TO DATE FIGURES ARE ANCHORED TO THE PAYSLIP THEY CAME FROM (v17.98) ─────────────────
//
// The cumulative PAYE method adds THIS payslip's pay to the entered totals, so it is only valid on
// the payslip immediately after the one the member copied them from. `calculate()` enforces that
// with one line:
//
//     if (!(_ytdSrc && _curP && _curP.num === _ytdSrc + 1)) { ytdP = null; ytdT = null; }
//
// Delete it and nothing fails. Stale totals are then treated as last-payslip figures on whatever
// payslip happens to be on screen, which is exactly the pre-v17.98 defect — a member who entered
// their figures in July and left them there gets a skewed tax estimate for the rest of the year,
// with no error and no visible difference.
//
// What makes it worth a browser is that the page ALREADY SAYS THE RIGHT THING: `updateYtdNote`
// (paycalc-ytd-card.js) writes "not in use" into the header chip and "worked out from this payslip alone" into the
// note from the same rule, independently of the arithmetic. So without the guard the chip and the
// figure disagree, and the chip is the honest one. The assertion therefore pairs them.
//
// The probe is the figures' own EFFECT: clear the two boxes and see whether the take-home moves.
// On the anchored payslip it must (they are feeding the estimate); on any other payslip it must
// not (they are being ignored). The second half is vacuous without the first, which is why the
// anchored payslip is exercised in the same test rather than assumed.
test('paycalc: Year to Date figures sharpen ONLY the payslip after their source', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.clock.setFixedTime(new Date('2027-01-10T09:00:00Z'));
    await seedSession(page);
    await seedMember(page);
    // Source = P32 (paid 23 Oct 2026, internal p.num 57). Anchored payslip = 58; 59 and 60 are not.
    // Figures must FIT the code to be used (15 and 21 Nov 2026): £8,263.60 is what 1257L takes on
    // £40,000 by the 23 Oct payslip — a year into the higher rate, so the figures visibly move the £.
    const SRC = 57, YTD_PAY = '40000', YTD_TAX = '8263.60';
    await page.addInitScript(([src, pay, tax]) => {
        localStorage.setItem('myb_pc_ns_migrated', '1');
        localStorage.setItem('myb_pc_ytd_notice_2_shown', '1');
        localStorage.setItem('myb_pc_gmiller_ytd_src_2026_27', src);
        localStorage.setItem('myb_pc_gmiller_ytd_pay_2026_27', pay);
        localStorage.setItem('myb_pc_gmiller_ytd_tax_2026_27', tax);
    }, [String(SRC), YTD_PAY, YTD_TAX]);
    await page.goto('/paycalc.html');
    await expect(page.locator('#pensionAmt')).toBeVisible();
    // The two boxes are in the Year to Date card, which starts closed — and a closed card's fields
    // are out of reach, for this test as for a member (paycalc.css → `.collapsible-body`).
    await page.locator('#payslipCardToggle .card-toggle-arrow').click();

    /** Take-home with the two boxes filled, then emptied, then refilled — on the payslip on screen. */
    const netWithAndWithoutFigures = async () => {
        await expect(page.locator('#ytdPay')).toHaveValue(YTD_PAY);
        const withFigures = poundsOf(await page.locator('#netDisplay').textContent());
        for (const id of ['#ytdPay', '#ytdTax']) {
            await page.fill(id, '');
            await page.dispatchEvent(id, 'input');
        }
        await expect(page.locator('#ytdPay')).toHaveValue('');
        const withoutFigures = poundsOf(await page.locator('#netDisplay').textContent());
        await page.fill('#ytdPay', YTD_PAY);
        await page.dispatchEvent('#ytdPay', 'input');
        await page.fill('#ytdTax', YTD_TAX);
        await page.dispatchEvent('#ytdTax', 'input');
        await expect(page.locator('#ytdPay')).toHaveValue(YTD_PAY);
        return { withFigures, withoutFigures };
    };

    // THE ANCHORED PAYSLIP — source + 1. The figures are in use, and removing them moves the £.
    await page.locator('#periodSelect').selectOption(String(SRC + 1));
    await expect(page.locator('#ytdStatusChip')).toHaveText('✓ in use');
    await expect(page.locator('#ytdUptoNote')).toContainText("sharpen this payslip's tax estimate");
    const anchored = await netWithAndWithoutFigures();
    expect(anchored.withFigures,
        'on source + 1 the entered totals must actually change the estimate — without this the '
        + 'equalities below would pass on figures nothing ever reads')
        .not.toBe(anchored.withoutFigures);

    // EVERY OTHER PAYSLIP — the chip says "not in use", and the arithmetic must agree with it.
    for (const pNum of [SRC + 2, SRC + 3]) {
        await page.locator('#periodSelect').selectOption(String(pNum));
        await expect(page.locator('#ytdStatusChip')).toHaveText('not in use');
        await expect(page.locator('#ytdUptoNote')).toContainText("This payslip's tax is worked out from this payslip alone");
        const other = await netWithAndWithoutFigures();
        expect(other.withFigures,
            `p${pNum} is not the payslip these totals came from, so they must not reach the estimate`)
            .toBe(other.withoutFigures);
    }
    expect(errors, 'Uncaught JS exceptions on the Year to Date anchor').toHaveLength(0);
});

// ── LAST YEAR'S TOTALS TYPED IN MARCH ARE NEVER READ AS APRIL'S (24 Nov 2026) ────────────────────
// Between the March and April paydays the page opens on the new year's first payslip, and a member
// copying their March payslip's totals types them into the new year's card. From 21 Nov 2026 nothing
// was recorded for them while that payslip could not be in hand — but the first load after its
// cut-off filed them against it, so the 8 May payslip was priced cumulatively on last year's totals.
// On a K code, which the under-the-code check leaves alone, that was about £1,650 of tax where £770.40
// was right (review, 24 Nov 2026). The rule is ytdSourceToStamp (paycalc-periods.test.mjs); this pins
// the whole path — typed on one day, loaded on a later one — to the rendered £: exactly the take-home
// with no Year to Date figures at all. Figures invented.
test('paycalc: Year to Date figures typed before the year\'s first payslip is in hand never reach a later payslip\'s £', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.clock.setFixedTime(new Date('2026-03-20T10:00:00Z'));   // the 10 Apr 2026 payslip (p50) is not yet issued
    await seedSession(page, LONG_SERVING);
    await page.addInitScript((pc) => {
        localStorage.setItem('myb_pc_ns_migrated', '1');
        localStorage.setItem('myb_pc_ytd_notice_2_shown', '1');
        localStorage.setItem(`${pc}grade`, 'cea');
        localStorage.setItem(`${pc}setup`, '1');
        localStorage.setItem(`${pc}code`, 'K100');
    }, LONG_SERVING_PC);
    await page.goto('/paycalc.html');
    await expect(page.locator('#netDisplay')).toHaveText(/£\d/);
    await page.locator('#periodSelect').selectOption('50');
    await page.locator('#payslipCardToggle .card-toggle-arrow').click();
    await page.fill('#ytdPay', '42000');
    await page.dispatchEvent('#ytdPay', 'input');
    await page.fill('#ytdTax', '7400');
    await page.dispatchEvent('#ytdTax', 'input');
    await expect.poll(() => page.evaluate(k => localStorage.getItem(k), `${LONG_SERVING_PC}ytd_tax_2026_27`),
        'premise: the figures are saved in the new year\'s card').toBe('7400');

    /** The take-home on the 8 May 2026 payslip (p51), loaded on 20 Apr — after p50's cut-off. */
    const netOnMay8 = async () => {
        await page.clock.setFixedTime(new Date('2026-04-20T10:00:00Z'));
        await page.reload();
        await expect(page.locator('#netDisplay')).toHaveText(/£\d/);
        await page.locator('#periodSelect').selectOption('51');
        await expect(page.locator('#netDisplay')).toHaveText(/£\d/);
        await waitForReadsToLand(page);
        return poundsOf(await page.locator('#netDisplay').textContent());
    };
    const withFigures = await netOnMay8();
    const chip = (await page.locator('#ytdStatusChip').textContent() ?? '').trim();
    const note = await page.locator('#ytdUptoNote').textContent() ?? '';
    await page.evaluate((pc) => {
        localStorage.removeItem(`${pc}ytd_pay_2026_27`);
        localStorage.removeItem(`${pc}ytd_tax_2026_27`);
    }, LONG_SERVING_PC);
    const withoutFigures = await netOnMay8();
    expect(withFigures, 'March\'s totals must not reach the 8 May payslip\'s take-home').toBe(withoutFigures);
    expect(chip, 'nor is the card to call them in use').not.toBe('✓ in use');
    expect(note, 'nor to say they are from the 10 Apr payslip').not.toContain('10 Apr');

    // Figures typed in NOW, with the 10 Apr payslip in hand, are a first entry again and are filed
    // against it — the marker holds back only the load, never the member.
    await page.locator('#payslipCardToggle .card-toggle-arrow').click();
    await page.fill('#ytdPay', '3000');
    await page.dispatchEvent('#ytdPay', 'input');
    await expect.poll(() => page.evaluate(k => localStorage.getItem(k), `${LONG_SERVING_PC}ytd_src_2026_27`),
        'typed on 20 Apr, the figures are from the 10 Apr payslip').toBe('50');
    expect(errors, `fatal errors: ${errors.join(', ')}`).toHaveLength(0);
});

// ── AN OVER-COLLECTED YEAR IS SAID, NOT HIDDEN BEHIND £0 (72-hour review) ────────────────────────
// computeTax reports the over-collection it clamps to £0; this pins calculate() handing it to the
// summary — the wiring a unit test of either half cannot see.
// A Tax Paid typed one digit short (348 for 3,480) asked for nearly a year's tax at once. Bounded by the
// pay alone, the tax took all of it and NI came off on top: a negative take-home (whole-app review,
// Nov 2026). This pins calculate() handing NI and loans to computeTax, and the summary saying why.
// From the year's second payslip a Tax Paid far UNDER the code is not used at all (owner, 21 Nov 2026):
// it is the payslip priced on its own, and the line says which two figures disagree. The pay bound
// behind "ask for more tax than this payslip pays" is unit-tested on the year's first payslip.
test('paycalc: a mistyped Tax Paid never makes the take-home negative, and the summary says to check it', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.clock.setFixedTime(new Date('2026-11-07T09:00:00Z'));
    await seedSession(page);
    await seedMember(page);
    await page.addInitScript(() => {
        localStorage.setItem('myb_pc_ns_migrated', '1');
        localStorage.setItem('myb_pc_ytd_notice_2_shown', '1');
        localStorage.setItem('myb_pc_gmiller_sl', 'plan2');
        localStorage.setItem('myb_pc_gmiller_ytd_src_2026_27', '57');
        localStorage.setItem('myb_pc_gmiller_ytd_pay_2026_27', '25142.72');
        localStorage.setItem('myb_pc_gmiller_ytd_tax_2026_27', '348');
    });
    await page.goto('/paycalc.html');
    await expect(page.locator('#pensionAmt')).toBeVisible();
    await page.locator('#periodSelect').selectOption('58');
    await expect(page.locator('#summary')).toContainText("Your Year to Date figures don't fit tax code 1257L");
    await expect(page.locator('#summary')).toContainText('Check the code on that payslip matches Your Settings');
    const net = await page.locator('#netDisplay').textContent();
    expect(poundsOf(net), `the take-home reads ${net}`).toBeGreaterThanOrEqual(0);
    expect(net ?? '', 'no minus sign on the take-home').not.toMatch(/[−-]/);
    expect(errors).toHaveLength(0);
});

// ── FIGURES THAT DO NOT FIT THE TAX CODE ARE NOT USED (owner, 15 Nov 2026) ──────────────────────
// A payroll taxing each payslip on its own, under a code printed plainly, produces Year to Date figures
// the code could never have produced worked out over the year. The cumulative method read them as an
// over-collected year: no tax at all, and "a refund may be due" — a take-home a whole payslip's tax
// too high, from a real screenshot. computeTax now refuses such a pair and reports both figures; this
// pins calculate() handing that to every surface that speaks of the figures and, above all, the £:
// exactly the estimate with no Year to Date figures at all. Figures invented.
test('paycalc: Year to Date figures that cannot come from the tax code are not used, and the estimate says why', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.clock.setFixedTime(new Date('2026-11-07T09:00:00Z'));
    await seedSession(page);
    await seedMember(page);
    await page.addInitScript(() => {
        localStorage.setItem('myb_pc_ns_migrated', '1');
        localStorage.setItem('myb_pc_ytd_notice_2_shown', '1');
        localStorage.setItem('myb_pc_gmiller_ytd_src_2026_27', '57');
        localStorage.setItem('myb_pc_gmiller_ytd_pay_2026_27', '20000');
        localStorage.setItem('myb_pc_gmiller_ytd_tax_2026_27', '9000');   // 1257L takes £2,451.80 on £20,000 by 23 Oct
    });
    await page.goto('/paycalc.html');
    await expect(page.locator('#pensionAmt')).toBeVisible();
    await page.locator('#periodSelect').selectOption('58');
    const summary = page.locator('#summary');
    await expect(summary).toContainText("Your Year to Date figures don't fit tax code 1257L: it would have taken about "
        + '£2,451.80 by your 23 Oct payslip, not £9,000.00. So this payslip\'s tax is worked out on its own.');
    await expect(summary).not.toContainText('may be due on this payslip');
    await expect(page.locator('#ytdStatusChip')).toHaveText('not in use');
    await expect(page.locator('#ytdUptoNote')).toContainText("they don't fit your tax code");
    await expect(page.locator('#provChips')).not.toContainText('Year to Date figures ·');
    await expect(page.locator('#netYtdNudge'), 'the figures are the right payslip\'s already: nothing to ask for').toBeHidden();

    // THE £ — the figures do not reach it. Emptied, the take-home must not move, and the line under it
    // then asks for figures: it was quiet above because of the misfit, not because it could not speak.
    const withFigures = poundsOf(await page.locator('#netDisplay').textContent());
    expect(withFigures, 'a payslip\'s tax was taken: the take-home is not the whole pay after NI').toBeGreaterThan(0);
    await page.locator('#payslipCardToggle .card-toggle-arrow').click();
    for (const id of ['#ytdPay', '#ytdTax']) {
        await page.fill(id, '');
        await page.dispatchEvent(id, 'input');
    }
    await expect(page.locator('#netYtdNudge')).toBeVisible();
    expect(poundsOf(await page.locator('#netDisplay').textContent()), 'the same £ with no figures at all').toBe(withFigures);
    await expect(summary).not.toContainText("don't fit");
    expect(errors).toHaveLength(0);
});

// …while figures that FIT still report a refund where real cumulative PAYE makes one: a payslip paying
// less than its share of the tax-free allowance. Invented: a normal 1257L year to 23 Oct, then a
// 20 Nov payslip cut to a few hundred pounds by an adjustment.
test('paycalc: after figures that fit, a short-paid payslip still says a refund may be due', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.clock.setFixedTime(new Date('2026-11-07T09:00:00Z'));
    await seedSession(page);
    await seedMember(page);
    await page.addInitScript(() => {
        localStorage.setItem('myb_pc_ns_migrated', '1');
        localStorage.setItem('myb_pc_ytd_notice_2_shown', '1');
        localStorage.setItem('myb_pc_gmiller_ytd_src_2026_27', '57');
        localStorage.setItem('myb_pc_gmiller_ytd_pay_2026_27', '20000');
        localStorage.setItem('myb_pc_gmiller_ytd_tax_2026_27', '2451.80');   // exactly what 1257L takes by 23 Oct
        localStorage.setItem('myb_pc_gmiller_p58', JSON.stringify({
            satH: 0, satM: 0, bhH: 0, bhM: 0, bhOtH: 0, bhOtM: 0, otH: 0, otM: 0,
            rdwH: 0, rdwM: 0, sunH: 0, sunM: 0, boxH: 0, boxM: 0, peer: 0,
            slSkip: false, otherAdj: -3000, actualNet: null,
        }));
    });
    await page.goto('/paycalc.html');
    await expect(page.locator('#pensionAmt')).toBeVisible();
    await page.locator('#periodSelect').selectOption('58');
    await expect(page.locator('#ytdStatusChip')).toHaveText('✓ in use');
    await expect(page.locator('#summary')).toContainText('may be due on this payslip');
    await expect(page.locator('#summary')).not.toContainText("don't fit");
    expect(errors).toHaveLength(0);
});

// ── THE YEAR TO DATE LINE UNDER THE TAKE-HOME £ (owner, 7 Nov 2026) ─────────────────────────────
// The figures change on every payslip, so the result card asks for the latest ones wherever they
// would sharpen the estimate on screen. The rule is unit-tested (paycalc-periods.test.mjs →
// ytdUpdateFrom); these pin the wiring: calculate() writing the line on every run, the date it
// names, the button, and the line going once the figures are in. On 7 Nov 2026 the 23 Oct payslip
// (internal 57) is the latest paid, 20 Nov (58) is next, and 18 Dec (59) is not yet out.
test('paycalc: the take-home asks for the latest Year to Date figures, and stops once they are in', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.clock.setFixedTime(new Date('2026-11-07T09:00:00Z'));
    await seedSession(page);
    await seedMember(page);
    await page.addInitScript(() => {
        localStorage.setItem('myb_pc_ns_migrated', '1');
        localStorage.setItem('myb_pc_ytd_notice_2_shown', '1');
    });
    await page.goto('/paycalc.html');
    await expect(page.locator('#pensionAmt')).toBeVisible();
    await page.locator('#periodSelect').selectOption('58');

    const line = page.locator('#netYtdNudge');
    await expect(line).toBeVisible();
    await expect(line).toContainText('copy the Year to Date figures from your 23 Oct payslip');

    // The button opens the card, brings it into view and puts the cursor in the first box.
    await expect(page.locator('#payslipCardBody')).not.toHaveClass(/\bopen\b/);
    await page.locator('#netYtdNudgeBtn').click();
    await expect(page.locator('#payslipCardBody')).toHaveClass(/\bopen\b/);
    await expect(page.locator('#ytdPay')).toBeFocused();
    await expect(page.locator('#payslipCard')).toBeInViewport();

    // One figure is not a pair: the estimate cannot use it yet, so the line stays — and the card's chip
    // says so too, from what computeTax did rather than from "a box has text" (whole-app review).
    await page.fill('#ytdPay', '13200');
    await page.dispatchEvent('#ytdPay', 'input');
    await expect(line).toBeVisible();
    await expect(page.locator('#ytdStatusChip')).toHaveText('not in use');
    await expect(page.locator('#ytdUptoNote')).toContainText('fill in both Taxable Pay and Tax Paid');
    // Both figures, stamped to the 23 Oct payslip: in use, so the line goes. £1,091.80 is what 1257L
    // takes on £13,200 by that payslip — figures must fit their code to be used (owner, 15 Nov 2026).
    await page.fill('#ytdTax', '1091.80');
    await page.dispatchEvent('#ytdTax', 'input');
    await expect(page.locator('#ytdSrcSelect')).toHaveValue('57');
    await expect(page.locator('#ytdStatusChip')).toHaveText('✓ in use');
    await expect(line).toBeHidden();

    // Quiet on a payslip already paid, and on one whose previous payslip is not out yet.
    await page.locator('#periodSelect').selectOption('57');
    await expect(page.locator('#netPeriod')).toContainText('23 Oct');
    await expect(line).toBeHidden();
    await page.locator('#periodSelect').selectOption('59');
    await expect(page.locator('#netPeriod')).toContainText('18 Dec');
    await expect(line).toBeHidden();
    expect(errors, 'Uncaught JS exceptions on the Year to Date line').toHaveLength(0);
});

test('paycalc: Year to Date figures from an older payslip are asked for again', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.clock.setFixedTime(new Date('2026-11-07T09:00:00Z'));
    await seedSession(page);
    await seedMember(page);
    await page.addInitScript(() => {
        localStorage.setItem('myb_pc_ns_migrated', '1');
        localStorage.setItem('myb_pc_ytd_notice_2_shown', '1');
        localStorage.setItem('myb_pc_gmiller_ytd_src_2026_27', '56');   // the 25 Sep payslip
        localStorage.setItem('myb_pc_gmiller_ytd_pay_2026_27', '11000');
        localStorage.setItem('myb_pc_gmiller_ytd_tax_2026_27', '1400');
    });
    await page.goto('/paycalc.html');
    await expect(page.locator('#pensionAmt')).toBeVisible();
    await page.locator('#periodSelect').selectOption('58');
    await expect(page.locator('#ytdStatusChip')).toHaveText('not in use');
    await expect(page.locator('#netYtdNudge')).toBeVisible();
    await expect(page.locator('#netYtdNudge')).toContainText('from your 23 Oct payslip');

    // Doing what it asks MOVES the source (whole-app review, Nov 2026): the figures were stamped on
    // first entry only, so re-typed ones stayed on 25 Sep — the line kept asking, and the 23 Oct
    // payslip, straight after that old source, counted its own pay twice.
    await page.locator('#netYtdNudgeBtn').click();
    await page.fill('#ytdPay', '14300');
    await page.dispatchEvent('#ytdPay', 'input');
    await page.fill('#ytdTax', '1311.80');   // what 1257L takes on £14,300 by 23 Oct: the pair fits
    await page.dispatchEvent('#ytdTax', 'input');
    await expect(page.locator('#ytdSrcSelect')).toHaveValue('57');
    await expect(page.locator('#ytdStatusChip')).toHaveText('✓ in use');
    await expect(page.locator('#ytdUptoNote')).toContainText('from your 23 Oct payslip');
    await expect(page.locator('#netYtdNudge')).toBeHidden();
    await page.locator('#periodSelect').selectOption('57');
    await expect(page.locator('#netPeriod')).toContainText('23 Oct');
    await expect(page.locator('#ytdStatusChip'), 'the 23 Oct payslip no longer counts its own pay twice').toHaveText('not in use');
    expect(errors).toHaveLength(0);
});

// …but ONLY over figures already recorded (whole-app check, 10 Nov 2026 — the move above first fired
// on any typing). Figures typed into empty boxes against a payslip already recorded, or after the
// member picked one in the select, come from the payslip they chose; moving it lost that choice, and
// for a joiner it priced a June figure as October's (the ytd-mode HPP test went to £0).
test('paycalc: Year to Date figures typed against a payslip the member chose keep it', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.clock.setFixedTime(new Date('2026-11-07T09:00:00Z'));
    await seedSession(page);
    await seedMember(page);
    await page.addInitScript(() => {
        localStorage.setItem('myb_pc_ns_migrated', '1');
        localStorage.setItem('myb_pc_ytd_notice_2_shown', '1');
        localStorage.setItem('myb_pc_gmiller_ytd_src_2026_27', '56');   // the 25 Sep payslip — no figures yet
    });
    await page.goto('/paycalc.html');
    await expect(page.locator('#pensionAmt')).toBeVisible();
    await page.locator('#periodSelect').selectOption('58');
    await page.locator('#payslipCardToggle .card-toggle-arrow').click();

    // Into the empty boxes — both, which are one edit: the payslip already recorded stands.
    await page.fill('#ytdPay', '11000');
    await page.dispatchEvent('#ytdPay', 'input');
    await page.fill('#ytdTax', '1400');
    await page.dispatchEvent('#ytdTax', 'input');
    await expect(page.locator('#ytdSrcSelect')).toHaveValue('56');

    // A new edit over those figures — the boxes are left first, as picking in the sheet leaves them —
    // after picking a payslip in the select: the pick stands.
    await page.locator('#ytdTax').blur();
    await page.locator('#ytdSrcSelect').selectOption('55', { force: true });
    await page.locator('#ytdSrcSelect').dispatchEvent('change');
    await page.fill('#ytdPay', '9000');
    await page.dispatchEvent('#ytdPay', 'input');
    await expect(page.locator('#ytdSrcSelect')).toHaveValue('55');
    expect(errors).toHaveLength(0);
});

// A week 1 / month 1 code never uses the figures, and the card said "✓ in use" over it all the same
// (whole-app review, Nov 2026). The code is a setting, not a Year to Date box — so this pins that the
// chip is written by calculate() from computeTax's own answer, on every recalculation.
test('paycalc: under a week 1 / month 1 tax code the Year to Date card says its figures are not in use', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.clock.setFixedTime(new Date('2026-11-07T09:00:00Z'));
    await seedSession(page);
    await seedMember(page);
    await page.addInitScript(() => {
        localStorage.setItem('myb_pc_ns_migrated', '1');
        localStorage.setItem('myb_pc_ytd_notice_2_shown', '1');
        localStorage.setItem('myb_pc_gmiller_ytd_src_2026_27', '57');
        localStorage.setItem('myb_pc_gmiller_ytd_pay_2026_27', '13200');
        localStorage.setItem('myb_pc_gmiller_ytd_tax_2026_27', '1091.80');   // fits 1257L by 23 Oct
    });
    await page.goto('/paycalc.html');
    await expect(page.locator('#pensionAmt')).toBeVisible();
    await page.locator('#periodSelect').selectOption('58');
    await expect(page.locator('#ytdStatusChip')).toHaveText('✓ in use');
    // The box's own hint says to type the marker, and what it means (15 Nov 2026).
    await expect(page.locator('#taxCode + .field-hint')).toContainText('If W1, M1 or X comes after it, type that too');
    await page.locator('#taxCode').fill('1257L M1');
    await expect(page.locator('#ytdStatusChip')).toHaveText('not in use');
    await expect(page.locator('#ytdUptoNote')).toContainText('a tax code ending in W1, M1 or X works out each payslip on its own');
    await page.locator('#taxCode').fill('1257L');
    await expect(page.locator('#ytdStatusChip')).toHaveText('✓ in use');
    expect(errors).toHaveLength(0);
});

// ── THE PAYSLIP IN HAND BEFORE PAYDAY (72-hour review) ───────────────────────────────────────────
// Payslips arrive before payday. Figures typed on 22 Sep 2026 may come from the 25 Sep payslip (cut
// off 19 Sep), which the picker did not offer, so a member who had it in hand could not say so. The
// picker now offers it from its cut-off; the first-entry stamp keeps the standing rule (the payslip
// before today's), which the member corrects by picking. Rules: paycalc-periods.test.mjs.
test('paycalc: between cut-off and payday the new payslip can be picked as the Year to Date source', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.clock.setFixedTime(new Date('2026-09-22T09:00:00Z'));
    await seedSession(page);
    await seedMember(page);
    await page.addInitScript(() => {
        localStorage.setItem('myb_pc_ns_migrated', '1');
        localStorage.setItem('myb_pc_ytd_notice_2_shown', '1');
    });
    await page.goto('/paycalc.html');
    await expect(page.locator('#pensionAmt')).toBeVisible();
    // Opened first: a closed card's fields are out of reach (paycalc.css → `.collapsible-body`).
    await page.locator('#payslipCardToggle .card-toggle-arrow').click();
    await page.fill('#ytdPay', '23100');
    await page.dispatchEvent('#ytdPay', 'input');
    await page.fill('#ytdTax', '3266.20');
    await page.dispatchEvent('#ytdTax', 'input');
    const offered = await page.locator('#ytdSrcSelect option').evaluateAll(os => os.map(o => o.textContent));
    expect(offered.some(t => /25 September 2026/.test(t ?? '')), 'the payslip in hand must be offered').toBe(true);
    expect(offered.some(t => /28 August 2026/.test(t ?? ''))).toBe(true);
    expect(errors).toHaveLength(0);
});
