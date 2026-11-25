/**
 * paycalc-backpay.spec.js — the Pay Calculator (paycalc.html): the two opt-in lumps — back pay and the
 * Holiday Pay Premium — and the take-home £ and loan rows.
 *
 * Split by feature out of paycalc.spec.js on 25 Nov 2026, test for test and unchanged; what more than
 * one paycalc-*.spec.js file needs is in paycalc-helpers.js, including the roster rows these tests sign
 * in as, which are chosen by shape and never written down (payroll-anonymity.test.mjs).
 */
import { test, expect } from './fixtures.js';
import { collectFatalErrors, seedSession, seedMember } from './helpers.js';
// The REAL pay tables, imported rather than restated: the unsupported-role block below asserts that
// a CES is priced as a CES, and a literal rate there would go stale on the next award — or, worse,
// be "corrected" to whatever the page happened to show.
import { GRADES, AWARD_RATES, TAX_YEARS, computeGross, computeTax, computeNI, getThresholds, getPensionForPeriod } from '../paycalc-calc.js';
import { PAY_2026_27_DAY, poundsOf, LUMP_QUIET } from './paycalc-helpers.js';

// ── THE BACK-PAY LUMP, AS THE PAGE ACTUALLY SHOWS IT (v21.82) ────────────────────────────────────
//
// The award window fix (v21.79, VAL-PAY-001) was documented in six places and guarded in none.
// `awardWindowFactor` is unit-tested, and `_accrueBackPayPeriod` is unit-tested to honour the
// factor it is handed — but nothing checked that `calcBackPay` HANDS it one. Deleting that single
// line restores the whole defect, the app goes 19% high again, and every one of those tests stays
// green. Verified by doing exactly that before writing this.
//
// So the guard has to be the figure on screen. With NO hours entered the lump is basic + London
// only, which makes it exactly derivable and independent of anything the member did:
//
//   rate  £20.74 → £21.49  = £0.75  × 140 contracted hours = £105.00 a period
//   London £276.16 → £286.10 = £9.94                       = £114.94 a period
//   five periods in the window, the first (paid 10 Apr, shifts 8 Mar – 4 Apr) at 4/28:
//   4 × £114.94 + 4/28 × £114.94 = £476.18
//
// Without the window factor that first period counts whole — £574.70, £98.52 too much. The clock is
// pinned because the window's size depends on today: `calcBackPay` caps the accrual at today's
// payslip, so an unpinned run would quietly test a different number of periods each month.
test('paycalc: the back-pay lump scales the first period of the award window', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.clock.setFixedTime(new Date('2026-08-20T09:00:00Z'));
    await seedSession(page);
    await seedMember(page);
    await page.goto('/paycalc.html');
    await expect(page.locator('#pensionAmt')).toBeVisible();

    // The card computes whether or not it is open (v16.00) — the banner and take-home depend on it —
    // so the assertion does not need to expand anything. The hero £ is what the member reads.
    await expect(page.locator('#backPayTotalAmt')).toHaveText('£476.18');
    await expect(page.locator('#backPayTotalBasis')).toHaveText('5 periods backdated at the rates on record');
    // Compute mode, or the figure above came from a typed one and proves nothing.
    await expect(page.locator('#bpModeCompute')).toBeChecked();
    expect(errors, 'Uncaught JS exceptions on the back-pay card').toHaveLength(0);
});

// ── THE TWO OPT-IN LUMPS: THE TICK IS THE GATE, AND THE BANNER MUST AGREE WITH THE £ ─────────────
//
// Back pay and the Holiday Pay Premium are both OFF by default (owner, Jul 2026). `calculate()`
// adds each only when its own include flag is set:
//
//     const _bpThisPeriod  = (_bpPNum > 0 && _bpPNum === _pNum && _bpIncluded) ? _bpAmount : 0;
//     const _hppForPeriod  = _hppIncluded ? _hppAmount : 0;
//
// Drop `_bpIncluded` / `_hppIncluded` from those lines and **nothing in the repo fails**. The
// estimate silently gains £476.18 of back pay, or £1,843.01 of premium, while the banner directly
// beneath it still reads "could land on this payslip — not added to this estimate".
//
// That contradiction is precisely the failure `paycalc-money-banner.test.mjs` exists to prevent,
// reached from the side it cannot see: that suite pins the SENTENCE against the `included` flag it
// is handed, and nothing pins the ARITHMETIC to the same flag. So these two tests assert the pair
// together — the words and the figure, in the same browser, as one fact — because a member reading
// "not added" over a number that contains it has no way to notice, and the two states differ by
// hundreds of pounds with both looking equally plausible.
//
// The assertions are on the MOVEMENT, not on a hardcoded take-home: ticking must raise the figure,
// un-ticking must put it back exactly, and the rise must be a taxed share of the lump (more than
// nothing, less than all of it). Under either mutation the movement is ZERO in both directions.
// The clock is pinned because which payslip carries each lump depends on today.

// THE £ FIGURE BESIDE ITS LABEL IN THE BACK-PAY STATE — in a BLOCKING lane (test audit, 7 Nov 2026 —
// UI-12). This check lived only in visual.spec.js, an opt-in lane whose CI job is report-only: any
// failure there reads as "baselines drifted" and blocks nothing. So the row that broke on a real phone
// — "Estimated take-home pay (inc. back pay)" wrapping into its own figure, `.sum-row` being
// `space-between` with nothing to keep the two apart — had no guard that could stop a merge. The same
// state and the same sentinels as the visual test, without the picture: the clock is that test's
// (15 Jul 2026) and P55 is the payslip the 2026 award lands on.
//
// TWO THINGS ARE TIGHTER THAN THE VISUAL TEST'S CHECK, because as written there it could not fail
// (measured by deleting each rule): at 390px no label in this state fills its row, so the gap
// between label and figure was the row's slack rather than the `gap: 16px` that keeps them apart; and
// "same line" was `val.top < lbl.bottom`, true of a figure anywhere beside a two-line label. So the
// rows are also measured at 320px, where both labels fill them and the gap rule is all that is left
// between the words and the money; the long back-pay row that actually broke is measured as well as
// the take-home row; and "same line" means the figure's middle lies inside the headline's own line box.
for (const width of [390, 320]) {
    test(`paycalc: with back pay included, each £ sits beside its label and never touches it (${width}px)`, async ({ page }) => {
        await page.clock.setFixedTime(new Date('2026-07-15T09:00:00Z'));
        await page.setViewportSize({ width, height: 1600 });
        await seedSession(page);
        await page.addInitScript(LUMP_QUIET);
        await page.goto('/paycalc.html');
        await expect(page.locator('#netDisplay')).toHaveText(/£\d/);
        await page.locator('#periodSelect').selectOption('55');   // Paid 28 August 2026 · P24
        await page.evaluate(() => document.getElementById('backPayHeader')?.click());
        // The include tick lives in the card's paid-in wrap; set it the way its change handler hears it.
        await page.evaluate(() => {
            const t = /** @type {HTMLInputElement|null} */ (document.getElementById('bpIncludeTick'));
            if (t) { t.checked = true; t.dispatchEvent(new Event('change', { bubbles: true })); }
        });
        // Sentinels FIRST, waited for: without the back-pay state there is nothing long enough to break.
        await expect(page.locator('#summary .sum-bp')).toHaveCount(1);
        await expect(page.locator('#summary .sum-net-sub')).toHaveText('includes back pay');
        const geom = await page.evaluate(() => Object.fromEntries(['sum-net', 'sum-bp'].map(cls => {
            const row = /** @type {Element} */ (document.querySelector(`#summary .${cls}`));
            const lblEl = /** @type {Element} */ (row.querySelector('.lbl'));
            const lbl = lblEl.getBoundingClientRect();
            const val = /** @type {Element} */ (row.querySelector('.val')).getBoundingClientRect();
            // The headline's first line box: the label's own words, before the sub-line under them.
            const words = [...lblEl.childNodes].find(n => n.nodeType === Node.TEXT_NODE && (n.textContent || '').trim());
            const range = document.createRange();
            if (words) range.selectNodeContents(words);
            const first = words ? range.getClientRects()[0] : lbl;
            const mid = (val.top + val.bottom) / 2;
            return [cls, { gap: Math.round(val.left - lbl.right), sameLine: mid >= first.top - 0.5 && mid <= first.bottom + 0.5 }];
        })));
        for (const [cls, g] of Object.entries(geom)) {
            expect(g.gap, `.${cls}: the £ figure must never touch the label`).toBeGreaterThan(4);
        }
        // The take-home row only: it alone is aligned to its headline's BASELINE (paycalc.css), so the
        // figure stays on the words it belongs to; every other row centres its figure by design.
        expect(geom['sum-net'].sameLine, 'the take-home £ sits beside the headline\'s first line, not under the sub-line').toBe(true);
    });
}

test('paycalc: the back-pay lump joins take-home ONLY when the tick is on', async ({ page }) => {
    const errors = collectFatalErrors(page);
    // 28 Aug 2026 is the payslip the 2026/27 award actually landed on, so the lump is offered here.
    await page.clock.setFixedTime(new Date('2026-08-20T09:00:00Z'));
    await seedSession(page);
    await seedMember(page);
    await page.addInitScript(LUMP_QUIET);
    await page.goto('/paycalc.html');
    await expect(page.locator('#pensionAmt')).toBeVisible();
    await expect(page.locator('#bpActiveBanner')).toBeVisible();

    // The lump is real money out of the real tables, not a placeholder. Derived rather than
    // written down, so the next award moves it instead of failing here: one period's arrears is
    // the hourly uplift over contracted hours plus the London Allowance step, and the window the
    // pinned clock produces is four whole periods plus the April fraction of a fifth.
    const AW = AWARD_RATES.cea['2026/27'];
    const TY = TAX_YEARS.find(t => t.label === '2026/27');
    const perPeriodUplift = (AW.rate - AW.pre) * GRADES.cea.contr + (TY.londonAllow - TY.londonAllowPre);
    const lump = poundsOf(await page.locator('#backPayTotalAmt').textContent());
    expect(lump, 'the lump is four-and-a-bit periods of the recorded uplift')
        .toBeGreaterThan(perPeriodUplift * 4);
    expect(lump).toBeLessThan(perPeriodUplift * 5);

    // OFF by default: the tick is clear, the sentence says so, and the receipt chip is absent.
    await expect(page.locator('#bpBannerTick')).not.toBeChecked();
    await expect(page.locator('#bpBannerText')).toContainText('not added to this estimate');
    await expect(page.locator('#provChips')).not.toContainText('back pay');
    const excluded = poundsOf(await page.locator('#netDisplay').textContent());
    expect(excluded, 'the take-home figure rendered').toBeGreaterThan(0);

    // ON: the sentence flips to "Includes", the same lump is named, and the figure moves.
    await page.locator('#bpBannerTick').check();
    await expect(page.locator('#bpBannerText')).toContainText('✓ Includes');
    await expect(page.locator('#bpBannerText')).toContainText('back pay lump sum');
    await expect(page.locator('#provChips')).toContainText('back pay');
    await expect.poll(async () => poundsOf(await page.locator('#netDisplay').textContent()))
        .toBeGreaterThan(excluded);
    const included = poundsOf(await page.locator('#netDisplay').textContent());

    // A taxed share of the lump: strictly more than nothing, strictly less than the whole sum.
    // Nothing is asserted about the exact deduction — that is computeTax/computeNI's own suite.
    const delta = included - excluded;
    expect(delta, 'the lump reaches take-home net of tax and NI, never in full').toBeLessThan(lump);
    expect(delta, 'and the deductions do not swallow it either').toBeGreaterThan(lump * 0.4);

    // And back off again. The round trip is what proves the tick is the gate rather than a
    // one-way door that happens to fire a recompute.
    await page.locator('#bpBannerTick').uncheck();
    await expect(page.locator('#bpBannerText')).toContainText('not added to this estimate');
    await expect.poll(async () => poundsOf(await page.locator('#netDisplay').textContent()))
        .toBe(excluded);

    // AND ONLY ON ITS OWN PAYSLIP (test audit, 7 Nov 2026). Until here this test never left the 28 Aug
    // payslip, so deleting `_bpPNum === _pNum` — which added the whole lump to EVERY payslip of the
    // year while the tick was on — kept it green. The banner has a gate of its own, so it hid on those
    // payslips while the money stayed in the figure. The banner is set in the same calculation as the
    // £, so its hiding is also the sign that the next payslip's figure is the one on screen.
    const paidIn = await page.locator('#periodSelect').inputValue();
    const nextPayslip = String(Number(paidIn) + 1);
    await page.locator('#periodSelect').selectOption(nextPayslip);
    await expect(page.locator('#bpActiveBanner'), 'premise: the next payslip does not carry the lump').toBeHidden();
    const nextWithout = poundsOf(await page.locator('#netDisplay').textContent());
    await page.locator('#periodSelect').selectOption(paidIn);
    await page.locator('#bpBannerTick').check();
    await expect(page.locator('#bpBannerText')).toContainText('✓ Includes');
    await page.locator('#periodSelect').selectOption(nextPayslip);
    await expect(page.locator('#bpActiveBanner')).toBeHidden();
    expect(poundsOf(await page.locator('#netDisplay').textContent()),
        'the lump was added to a payslip that does not carry it').toBe(nextWithout);
    expect(errors, 'Uncaught JS exceptions on the back-pay opt-in').toHaveLength(0);
});

// ── HOURS INSIDE THE AWARD WINDOW MOVE THE LUMP AT ONCE (paycalc-2-2, whole-app check, 10 Nov 2026) ──
// The lump accrues from SAVED hours, and saving hours re-priced everything but it: 20 hours of overtime
// on the 5 Jun payslip left the card on £476.18 until the member moved away and back (£494.93). The
// figure must move on the edit, to exactly what a fresh look gives.
test('paycalc: an hours edit inside the award window re-prices the back-pay lump at once', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.clock.setFixedTime(PAY_2026_27_DAY);
    await seedSession(page);
    await page.addInitScript(LUMP_QUIET);
    await page.goto('/paycalc.html');
    await expect(page.locator('#netDisplay')).toHaveText(/£\d/);
    await page.locator('#periodSelect').selectOption('52');   // 5 Jun 2026 — inside the 2026/27 award window
    await page.evaluate(() => {
        const t = /** @type {HTMLElement} */ (document.getElementById('backPayCardToggle'));
        /** @type {HTMLElement} */ (t.querySelector('.collapse-chevron') || t).click();
    });
    const total = page.locator('#backPayTotalAmt');
    await expect(total).toHaveText(/£\d/);
    const before = await total.textContent();

    await page.fill('#otH', '20');
    await page.dispatchEvent('#otH', 'input');
    await expect(total, 'the overtime is priced into the lump on the edit').not.toHaveText(before ?? '');
    const moved = await total.textContent();
    await page.locator('#periodSelect').selectOption('53');
    await page.locator('#periodSelect').selectOption('52');
    await expect(total, 'and to exactly what a fresh look gives').toHaveText(moved ?? '');
    expect(errors, `fatal errors: ${errors.join(', ')}`).toHaveLength(0);
});

// …AND CLEARING THEM MOVES IT BACK (17 Nov 2026). "Clear all entries" deletes the saved hours the lump
// accrues from, and re-priced everything but the lump: the card kept the cleared overtime in it.
test('paycalc: clearing a payslip inside the award window re-prices the back-pay lump at once', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.clock.install({ time: PAY_2026_27_DAY });   // a running clock: the clear's second tap must come later
    await seedSession(page);
    await page.addInitScript(LUMP_QUIET);
    await page.goto('/paycalc.html');
    await expect(page.locator('#netDisplay')).toHaveText(/£\d/);
    await page.locator('#periodSelect').selectOption('52');   // 5 Jun 2026 — inside the 2026/27 award window
    await page.evaluate(() => {
        const t = /** @type {HTMLElement} */ (document.getElementById('backPayCardToggle'));
        /** @type {HTMLElement} */ (t.querySelector('.collapse-chevron') || t).click();
    });
    const total = page.locator('#backPayTotalAmt');
    await expect(total).toHaveText(/£\d/);
    const before = await total.textContent();
    await page.fill('#otH', '20');
    await page.dispatchEvent('#otH', 'input');
    await expect(total, 'premise: the overtime is in the lump').not.toHaveText(before ?? '');

    await page.clock.pauseAt(new Date(PAY_2026_27_DAY.getTime() + 60_000));
    await page.locator('#clearBtn').click();                  // arms…
    await page.clock.runFor(1000);
    await page.locator('#clearBtn').click();                  // …and a second later, confirms
    await expect(page.locator('#otH'), 'premise: the payslip is cleared').toHaveValue('');
    await expect(total, 'the cleared overtime leaves the lump at once').toHaveText(before ?? '');
    expect(errors, `fatal errors: ${errors.join(', ')}`).toHaveLength(0);
});

// ── A LUMP TYPED FROM THE PAYSLIP IS NOT AN ESTIMATE TO SHARPEN (whole-app check, 10 Nov 2026) ────
// The banner's second line — "For the best estimate, fill in your hours on each payslip back to
// 1 April …" — is the way to improve a lump WORKED OUT from hours. Typed from the payslip it is the
// payslip's own figure, and hours change nothing, so the line has nothing to say there.
test('paycalc: a back-pay lump typed from the payslip is not told to fill in hours', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.clock.setFixedTime(PAY_2026_27_DAY);   // 7 Nov 2026 — the 28 Aug award payslip is paid
    await seedSession(page);
    await page.addInitScript(LUMP_QUIET);
    await page.goto('/paycalc.html');
    await expect(page.locator('#netDisplay')).toHaveText(/£\d/);
    await page.locator('#periodSelect').selectOption('55');   // Paid 28 August 2026 · P24 — carries the 2026/27 award
    await expect(page.locator('#bpActiveBanner')).toBeVisible();
    // Paid in August, so the lump IS on it — never "will land", ten weeks after it did (17 Nov 2026).
    await expect(page.locator('#bpBannerText')).toContainText('is on this payslip — not added to this estimate');
    await expect(page.locator('#bpBannerNote'), 'worked out from hours: the line is the way to sharpen it')
        .toHaveText('For the best estimate, fill in your hours on each payslip back to 1 April 2026.');

    await page.evaluate(() => {
        const t = /** @type {HTMLElement} */ (document.getElementById('backPayCardToggle'));
        /** @type {HTMLElement} */ (t.querySelector('.collapse-chevron') || t).click();
    });
    const worked = (await page.locator('#backPayTotalAmt').textContent() ?? '').replace(/[£,]/g, '').trim();
    expect(Number(worked), 'premise: a lump worked out from hours').toBeGreaterThan(0);
    await page.locator('#bpModeManual').check();
    await page.locator('#bpManualAmt').fill('500.00');
    await expect(page.locator('#bpBannerText')).toContainText('£500.00');
    await expect(page.locator('#bpBannerNote')).toHaveText('');
    await expect(page.locator('#bpBannerNote')).toBeHidden();

    // The SAME figure as the worked-out lump, then back to hours: nothing but the source changes, so
    // only the source can bring the line back.
    await page.locator('#bpManualAmt').fill(worked);
    await expect(page.locator('#bpBannerText')).not.toContainText('£500.00');
    await expect(page.locator('#bpBannerNote')).toHaveText('');
    await page.locator('#bpModeCompute').check();
    await expect(page.locator('#bpBannerNote')).toHaveText(/fill in your hours on each payslip back to 1 April 2026/);
    expect(errors, `fatal errors: ${errors.join(', ')}`).toHaveLength(0);
});

// ── THE TAKE-HOME £ IS THE ENGINE'S OWN FIGURE FOR WHAT IS ON SCREEN (test audit, 7 Nov 2026) ─────
// Every other test in this file checks that the figure MOVES, or that it agrees with itself on a
// second look. None said what it should BE, so `calculate()` could assemble the pieces wrongly with
// every lane green: charging NI on the pay before the pension comes off cost about £12 a payslip and
// failed nothing. `calculate()` cannot be reached from a unit test, so this reads what the page is
// showing — the hours, the tax code — composes it with the pure engine in paycalc-calc.js, and
// requires the page's £ to equal that, to the penny. The rate, the London Allowance and the pension
// come from the tables, not from the page, so a wrong one on screen cannot pass by agreement.
test('paycalc: the take-home £ is the pay engine\'s figure for the payslip on screen', async ({ page }) => {
    const errors = collectFatalErrors(page);
    // The 23 Oct 2026 payslip: after the award, and no bank holiday or Boxing Day in its weeks.
    await page.clock.setFixedTime(new Date('2026-10-21T09:00:00Z'));
    await seedSession(page);
    await seedMember(page);
    await page.addInitScript(LUMP_QUIET);
    await page.goto('/paycalc.html');
    await expect(page.locator('#pensionAmt')).toBeVisible();
    await expect(page.locator('#periodSelect option:checked')).toContainText('23 October 2026');

    const TY = /** @type {any} */ (TAX_YEARS.find(t => t.label === '2026/27'));
    const th = getThresholds('2026/27');
    const rate = AWARD_RATES.cea['2026/27'].rate;
    const pension = getPensionForPeriod('cea', new Date(2026, 9, 23, 12));
    /** What the page shows, read in ONE evaluate so a recalculation between two reads cannot split it. */
    const read = () => page.evaluate(() => {
        const v = (/** @type {string} */ id) => (/** @type {HTMLInputElement|null} */ (document.getElementById(id))?.value ?? '').trim();
        const hrs = (/** @type {string} */ h, /** @type {string} */ m) => (parseInt(v(h), 10) || 0) + (parseInt(v(m), 10) || 0) / 60;
        return {
            net: document.getElementById('netDisplay')?.textContent ?? '',
            rate: v('hourlyRate'), pension: v('pensionAmt'), code: v('taxCode'), loan: v('studentLoan'),
            pg: /** @type {HTMLInputElement|null} */ (document.getElementById('pgLoanCheck'))?.checked ?? null,
            adj: v('otherAdj'), ytd: v('ytdPay') + v('ytdTax'),
            sat: hrs('satH', 'satM'), ot: hrs('otH', 'otM'), rdw: hrs('rdwH', 'rdwM'), sun: hrs('sunH', 'sunM'),
            peer: Number(document.getElementById('peerVal')?.textContent || 0),
        };
    });
    /** The engine's take-home for those inputs: gross, the pension taken off first, then tax and NI on what is left. */
    const engine = (/** @type {Awaited<ReturnType<typeof read>>} */ s) => {
        const { gross } = computeGross({ effContr: GRADES.cea.contr, rate, satHrs: s.sat, bhHrs: 0, bhOtHrs: 0,
            oHrs: s.ot, rHrs: s.rdw, sHrs: s.sun, bHrs: 0, peerDays: s.peer, otherAdj: 0, london: TY.londonAllow });
        const sac = Math.max(0, gross - pension);
        return sac - computeTax(sac, s.code, th).tax - computeNI(sac, th.ni);
    };
    // Compared until the roster-assist has filled in this payslip's Saturdays and Sundays — the
    // figure moves when it does, and the inputs are read in the same moment as the figure.
    await expect.poll(async () => { const s = await read(); return Math.abs(Math.round((poundsOf(s.net) - engine(s)) * 100)); },   // pennies apart; abs, as -0 is not 0 to toBe
        'the take-home on screen is not what the pay engine makes of the inputs on screen').toBe(0);

    // The premises the comparison rests on, checked rather than trusted.
    const s = await read();
    expect(poundsOf(s.net), 'premise: a figure was rendered').toBeGreaterThan(0);
    expect(Number(s.rate), 'the hourly rate on screen is the 2026/27 settled rate').toBe(rate);
    expect(s.pension === '' || Number(s.pension) === pension, `the pension on screen (${s.pension}) is this payslip's default`).toBe(true);
    expect([s.loan, s.pg, s.ytd], 'premise: no student loan and no Year to Date figures').toEqual(['none', false, '']);
    expect(s.adj === '' || Number(s.adj) === 0, 'premise: no other adjustment').toBe(true);
    expect(errors, 'Uncaught JS exceptions on the Pay Calculator').toHaveLength(0);
});

// THE LOAN ROWS, THROUGH calculate(). Their words are buildLoanLines' (paycalc-breakdown.js) and are
// pinned in Node; what only the page can show is that calculate() hands it the plan's own label from
// the select and the date of the payslip the deductions stopped on — the wiring, not the rule.
test('paycalc: the loan rows name the plan picked and the payslip deductions stopped on', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.clock.setFixedTime(new Date('2026-11-08T12:00:00'));   // on screen: the 20 Nov payslip (P58)
    await seedSession(page);
    await page.addInitScript(() => {
        localStorage.setItem('myb_pc_ns_migrated', '1');
        localStorage.setItem('myb_pc_gmiller_sl', 'plan4');
        localStorage.setItem('myb_pc_gmiller_sl_paid_off', '57');   // stopped from the 23 Oct payslip
        // 25 Sep, before the stop: a £2,000 correction takes pay well under any loan threshold
        localStorage.setItem('myb_pc_gmiller_p56', JSON.stringify({ otherAdj: -2000 }));
    });
    await page.goto('/paycalc.html');
    const summary = page.locator('#summary');
    await expect(summary).toContainText('Student Loan — not deducted from your 23 Oct payslip onwards');
    await page.evaluate(() => {
        const sel = /** @type {HTMLSelectElement} */ (document.getElementById('periodSelect'));
        for (const o of sel.options) o.selected = o.value === '56';
        sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(summary).toContainText(
        'Student Loan — no deduction: pay after pension is under the Plan 4 (Scotland) threshold (£2,599.61 per period)');
    expect(errors, 'Uncaught JS exceptions on the Pay Calculator').toHaveLength(0);
});

test('paycalc: the Holiday Pay Premium joins take-home ONLY when the tick is on', async ({ page }) => {
    const errors = collectFatalErrors(page);
    // The 2025/26 premium is paid on the first January payslip of 2027 (TAX_YEARS.hppPaidJan), so
    // this clock lands the calculator on the one payslip of the year that can carry it.
    await page.clock.setFixedTime(new Date('2027-01-10T09:00:00Z'));
    await seedSession(page);
    await seedMember(page);
    // A CONFIRMED premium, seeded as the figure a member copies off the January payslip — the
    // amount here is payslip-shaped rather than rate-derived, and the gate is what is under test.
    // A confirmed actual also keeps the banner's wording free of the estimate hedge, so the two
    // sentences below discriminate on the include state alone.
    const PREMIUM = 1843.01;
    await page.addInitScript((amt) => {
        localStorage.setItem('myb_pc_ns_migrated', '1');
        localStorage.setItem('myb_pc_ytd_notice_2_shown', '1');
        localStorage.setItem('myb_pc_gmiller_hpp_actual_2025_26', String(amt));
    }, PREMIUM);
    await page.goto('/paycalc.html');
    await expect(page.locator('#pensionAmt')).toBeVisible();
    await expect(page.locator('#hppActiveBanner')).toBeVisible();

    await expect(page.locator('#hppBannerTick')).not.toBeChecked();
    await expect(page.locator('#hppBannerText')).toContainText('not added to this estimate');
    // Confirmed, so not hedged: the figure was copied off this payslip (whole-app check, 10 Nov 2026).
    await expect(page.locator('#hppBannerText')).toContainText('Your Holiday Pay Premium of £1,843.01 is on this payslip');
    await expect(page.locator('#provChips')).not.toContainText('Holiday Pay Premium');
    const excluded = poundsOf(await page.locator('#netDisplay').textContent());
    expect(excluded, 'the take-home figure rendered').toBeGreaterThan(0);

    await page.locator('#hppBannerTick').check();
    await expect(page.locator('#hppBannerText')).toContainText('✓ Includes');
    await expect(page.locator('#hppBannerText')).toContainText('Holiday Pay Premium');
    await expect(page.locator('#provChips')).toContainText('Holiday Pay Premium');
    await expect.poll(async () => poundsOf(await page.locator('#netDisplay').textContent()))
        .toBeGreaterThan(excluded);
    const included = poundsOf(await page.locator('#netDisplay').textContent());

    const delta = included - excluded;
    expect(delta, 'the premium reaches take-home net of tax and NI, never in full').toBeLessThan(PREMIUM);
    expect(delta, 'and the deductions do not swallow it either').toBeGreaterThan(PREMIUM * 0.4);

    await page.locator('#hppBannerTick').uncheck();
    await expect(page.locator('#hppBannerText')).toContainText('not added to this estimate');
    await expect.poll(async () => poundsOf(await page.locator('#netDisplay').textContent()))
        .toBe(excluded);
    expect(errors, 'Uncaught JS exceptions on the Holiday Pay Premium opt-in').toHaveLength(0);
});
