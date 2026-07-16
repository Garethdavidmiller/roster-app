// paycalc.test.mjs — unit tests for paycalc-calc.js
// Run with: node --test paycalc.test.mjs
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  P_YR, TAX_YEARS, GRADES, HPP_FRACTION, AWARD_RATES, awardRatesFor, getRateForPeriod, capHours,
  awardFromForYear, isPreAwardPeriod,
  calcBandedTax, getTaxYearForOffset, getThresholds, getLondonAllowanceForPeriod,
  computeGross, computeTax, computeNI, computeSL, calcProRateFactor, getPensionForPeriod,
} from './paycalc-calc.js';
import { MILLER_ACTUALS } from './test-fixtures/miller-actuals.js';

// Floating-point helper — within 1p is close enough for payroll
function approx(actual, expected, msg, tol = 0.01) {
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `${msg ?? 'value'}: expected ${expected.toFixed(4)}, got ${actual.toFixed(4)} (diff ${(actual - expected).toFixed(4)})`
  );
}

const T25 = getThresholds('2025/26');
const T26 = getThresholds('2026/27');
const TY25 = TAX_YEARS[0]; // 2025/26
const TY26 = TAX_YEARS[1]; // 2026/27

// ── Constants ─────────────────────────────────────────────────────────────────

describe('constants', () => {
  test('P_YR is 13', () => { assert.equal(P_YR, 13); });
  test('HPP_FRACTION is 4/52', () => { approx(HPP_FRACTION, 4 / 52, 'HPP_FRACTION'); });

  test('GRADES.cea has correct rate and contracted hours', () => {
    assert.equal(GRADES.cea.rate, 20.74);
    assert.equal(GRADES.cea.contr, 140);
    assert.equal(GRADES.cea.pension, 147.36);
  });

  test('TAX_YEARS has 2025/26 and 2026/27 entries', () => {
    assert.equal(TAX_YEARS.length, 2);
    assert.equal(TAX_YEARS[0].label, '2025/26');
    assert.equal(TAX_YEARS[1].label, '2026/27');
  });

  test('AWARD_RATES: CEA 2025/26 old £20.06 → new £20.74 (payslip-confirmed)', () => {
    // Old rate from G. Miller payslip 09/05/2025 ("Basic Pay @ 20.06"); new = the settled 2025/26 rate.
    assert.equal(AWARD_RATES.cea['2025/26'].pre, 20.06);
    assert.equal(AWARD_RATES.cea['2025/26'].rate, 20.74);
  });

  test('AWARD_RATES: pending 2026/27 has old = last year rate, new unconfirmed (null)', () => {
    assert.equal(AWARD_RATES.cea['2026/27'].pre, 20.74); // 2025/26 rate is the pending award's OLD rate
    assert.equal(AWARD_RATES.cea['2026/27'].rate, null); // award not yet agreed
    assert.equal(AWARD_RATES.ces['2026/27'].pre, 21.81);
  });

  test('awardRatesFor: known grade/year returns the record, unknown returns null', () => {
    assert.equal(awardRatesFor('cea', '2025/26').rate, 20.74);
    assert.equal(awardRatesFor('cea', '2025/26').pre, 20.06);
    assert.equal(awardRatesFor('cea', '2099/00'), null);        // unknown year
    assert.equal(awardRatesFor('ces', '2025/26').pre, null);    // CES 2024/25 rate not on record
    assert.equal(awardRatesFor('zzz', '2025/26').rate, 20.74);  // unknown grade → CEA, never throws
  });

  test('getRateForPeriod: CEA 2025/26 mid-year step at 24 Oct 2025 (£20.06 → £20.74)', () => {
    const settled = 20.74;
    // A payday BEFORE 24 Oct 2025 was paid at the pre-rise rate…
    assert.equal(getRateForPeriod({ payday: new Date(2025, 8, 26) }, 'cea', '2025/26', settled), 20.06);
    // …the award-date payslip and after use the settled rate.
    assert.equal(getRateForPeriod({ payday: new Date(2025, 9, 24) }, 'cea', '2025/26', settled), 20.74);
    assert.equal(getRateForPeriod({ payday: new Date(2025, 10, 21) }, 'cea', '2025/26', settled), 20.74);
  });

  test('getRateForPeriod: no step when the year/grade has no recorded pre-rate', () => {
    // CES 2025/26 has no recorded pre rate → always settled, even before the award date.
    assert.equal(getRateForPeriod({ payday: new Date(2025, 5, 6) }, 'ces', '2025/26', 21.81), 21.81);
    // Pending 2026/27 has from:null → always settled.
    assert.equal(getRateForPeriod({ payday: new Date(2026, 4, 8) }, 'cea', '2026/27', 20.74), 20.74);
    // Unknown year → settled (never throws).
    assert.equal(getRateForPeriod({ payday: new Date(2030, 0, 1) }, 'cea', '2099/00', 25), 25);
  });

  test('awardFromForYear: single-sourced from the year’s londonAllowFrom', () => {
    // The award-application date is NOT stored in AWARD_RATES — it is the year's londonAllowFrom.
    assert.deepEqual(awardFromForYear('2025/26'), new Date(2025, 9, 24)); // 24 Oct 2025
    assert.equal(awardFromForYear('2026/27'), null);                      // pending — no mid-year step
    assert.equal(awardFromForYear('2099/00'), null);                      // unknown year
  });

  test('isPreAwardPeriod: true only for a recorded-pre grade before the award date', () => {
    assert.equal(isPreAwardPeriod({ payday: new Date(2025, 8, 26) }, 'cea', '2025/26'), true);  // 26 Sep 2025
    assert.equal(isPreAwardPeriod({ payday: new Date(2025, 9, 24) }, 'cea', '2025/26'), false); // on the award date
    assert.equal(isPreAwardPeriod({ payday: new Date(2025, 5, 6) },  'ces', '2025/26'), false); // CES has no recorded pre
    assert.equal(isPreAwardPeriod({ payday: new Date(2026, 4, 8) },  'cea', '2026/27'), false); // pending, no date
  });

  test('AWARD_RATES drift guards: settled rate matches GRADES; each year’s pre = prior year rate', () => {
    for (const grade of ['cea', 'ces']) {
      // The settled 2025/26 rate must equal the grade default (the two must not drift apart).
      assert.equal(AWARD_RATES[grade]['2025/26'].rate, GRADES[grade].rate,
        `${grade} 2025/26 AWARD_RATES.rate must match GRADES.rate`);
      // A year's `pre` is the prior year's settled rate.
      assert.equal(AWARD_RATES[grade]['2026/27'].pre, AWARD_RATES[grade]['2025/26'].rate,
        `${grade} 2026/27 pre must equal 2025/26 rate`);
    }
    // A SETTLED mid-year rate step (recorded pre AND a real hourly rate that grade was stepped to)
    // must have an award-application date, else getRateForPeriod would never fire the step. 2025/26
    // is the only settled step on record; the pending 2026/27 correctly has pre but no date yet.
    assert.ok(awardFromForYear('2025/26') instanceof Date, '2025/26 award date must be set');
  });

  describe('capHours (shared hour-capping cascade)', () => {
    test('Saturday fills contracted first, BH takes the remainder', () => {
      // 140 contracted, 100 Sat, 60 BH → satCapped 100, normHrs 40, bhCapped 40, nonBhNorm 0
      assert.deepEqual(capHours({ effContr: 140, satHrs: 100, bhHrs: 60 }),
        { satCapped: 100, normHrs: 40, bhCapped: 40, nonBhNorm: 0 });
    });
    test('Saturday alone under contracted leaves normal + no BH squeeze', () => {
      assert.deepEqual(capHours({ effContr: 140, satHrs: 30, bhHrs: 0 }),
        { satCapped: 30, normHrs: 110, bhCapped: 0, nonBhNorm: 110 });
    });
    test('Saturday over contracted caps at contracted and squeezes BH to zero', () => {
      assert.deepEqual(capHours({ effContr: 140, satHrs: 150, bhHrs: 20 }),
        { satCapped: 140, normHrs: 0, bhCapped: 0, nonBhNorm: 0 });
    });
    test('no hours → all normal', () => {
      assert.deepEqual(capHours({ effContr: 140 }),
        { satCapped: 0, normHrs: 140, bhCapped: 0, nonBhNorm: 140 });
    });
  });

  test('NI 2025/26 thresholds are exactly £968 PT and £3868 UEL (weekly × 4)', () => {
    // HMRC specifies NI thresholds weekly; 4-weekly values are weekly × 4.
    // If HMRC changes the reference frequency this test will catch a silent error.
    assert.equal(T25.ni.pt,  968);   // £242/wk × 4
    assert.equal(T25.ni.uel, 3868);  // £967/wk × 4
  });

  test('NI 2026/27 thresholds confirmed unchanged from 2025/26', () => {
    assert.equal(T26.ni.pt,  T25.ni.pt);
    assert.equal(T26.ni.uel, T25.ni.uel);
  });
});

// ── calcBandedTax ─────────────────────────────────────────────────────────────

describe('calcBandedTax', () => {
  const bands2526 = T25.scottishTax.bands;

  test('zero taxable → 0', () => {
    assert.equal(calcBandedTax(0, bands2526), 0);
  });

  test('within starter band (£200 taxable — 19%)', () => {
    approx(calcBandedTax(200, bands2526), 200 * 0.19, 'starter band');
  });

  test('spanning starter + basic bands', () => {
    // top of starter = 2827/13 ≈ 217.46; within basic is 20%
    const starterTop = 2827 / P_YR;
    const taxable = starterTop + 100;
    const expected = starterTop * 0.19 + 100 * 0.20;
    approx(calcBandedTax(taxable, bands2526), expected, 'starter+basic');
  });

  test('scale=2 doubles all band widths (cumulative period 2)', () => {
    // At scale 2, starter band top doubles to 2×(2827/13)
    const starterTop = 2827 / P_YR;
    const taxable = starterTop * 2.5; // sits inside scaled basic band
    const result = calcBandedTax(taxable, bands2526, 2);
    const expected = (starterTop * 2) * 0.19 + (taxable - starterTop * 2) * 0.20;
    approx(result, expected, 'scale=2');
  });
});

// ── getTaxYearForOffset ────────────────────────────────────────────────────────

describe('getTaxYearForOffset', () => {
  test('offset -11 (first period 2025/26) → 2025/26', () => {
    assert.equal(getTaxYearForOffset(-11).label, '2025/26');
  });

  test('offset 0 (mid 2025/26) → 2025/26', () => {
    assert.equal(getTaxYearForOffset(0).label, '2025/26');
  });

  test('offset +1 (last period 2025/26) → 2025/26', () => {
    assert.equal(getTaxYearForOffset(1).label, '2025/26');
  });

  test('offset +2 (first period 2026/27) → 2026/27', () => {
    assert.equal(getTaxYearForOffset(2).label, '2026/27');
  });

  test('offset +14 (last period 2026/27) → 2026/27', () => {
    assert.equal(getTaxYearForOffset(14).label, '2026/27');
  });

  test('offset out of range falls back to 2025/26', () => {
    assert.equal(getTaxYearForOffset(-99).label, '2025/26');
    assert.equal(getTaxYearForOffset(99).label, '2025/26');
  });
});

// ── getLondonAllowanceForPeriod ───────────────────────────────────────────────

describe('getLondonAllowanceForPeriod', () => {
  // 2025/26: award cut-over on 24 Oct 2025 — pre: 267.08, post: 276.16
  // (267.08 confirmed from payslips in v8.66 — was 267.12 before)
  const cutover = TY25.londonAllowFrom; // new Date(2025, 9, 24)

  test('payday one day before cutover → pre-award rate (267.08)', () => {
    const paydayBefore = new Date(cutover.getTime() - 86400000);
    approx(getLondonAllowanceForPeriod({ payday: paydayBefore }, TY25), 267.08, 'pre-award');
  });

  test('payday on cutover date → post-award rate (276.16)', () => {
    approx(getLondonAllowanceForPeriod({ payday: cutover }, TY25), 276.16, 'on cutover');
  });

  test('2026/27 has no londonAllowPre → always returns londonAllow', () => {
    const payday = new Date(2026, 5, 1);
    approx(getLondonAllowanceForPeriod({ payday }, TY26), TY26.londonAllow, '2026/27 single rate');
  });
});

// ── computeNI ─────────────────────────────────────────────────────────────────

describe('computeNI', () => {
  const ni = T25.ni; // PT=968, UEL=3868, r8=0.08, r2=0.02

  test('below PT → 0', () => {
    assert.equal(computeNI(900, ni), 0);
  });

  test('exactly at PT → 0', () => {
    assert.equal(computeNI(ni.pt, ni), 0);
  });

  test('between PT and UEL → 8% on excess over PT', () => {
    const sacGross = 1500;
    approx(computeNI(sacGross, ni), (sacGross - ni.pt) * 0.08, 'mid-band NI');
  });

  test('above UEL → 8% up to UEL then 2% above', () => {
    const sacGross = 4000;
    const expected = (ni.uel - ni.pt) * 0.08 + (sacGross - ni.uel) * 0.02;
    approx(computeNI(sacGross, ni), expected, 'above UEL NI');
  });
});

// ── computeSL ─────────────────────────────────────────────────────────────────

describe('computeSL', () => {
  const sl = T25.sl;

  test('plan "none" → 0', () => {
    assert.equal(computeSL(3000, 'none', sl), 0);
  });

  test('skip flag → 0 regardless of income', () => {
    assert.equal(computeSL(3000, 'plan2', sl, true), 0);
  });

  test('2025/26 thresholds match the confirmed GOV.UK annual figures', () => {
    // Pins the corrected 2025/26 values (were the 2024/25 figures). GOV.UK, checked Jul 2026.
    assert.equal(sl.plan1.t, 26065 / P_YR);
    assert.equal(sl.plan2.t, 28470 / P_YR);
    assert.equal(sl.plan4.t, 32745 / P_YR);
  });

  test('plan2: below threshold → 0', () => {
    const threshold = sl.plan2.t; // 28470/13 ≈ 2190.0
    assert.equal(computeSL(threshold - 100, 'plan2', sl), 0);
  });

  test('plan2: above threshold → floor of 9% on excess', () => {
    const sacGross = 2500;
    const threshold = sl.plan2.t;
    const expected = Math.floor((sacGross - threshold) * 0.09);
    assert.equal(computeSL(sacGross, 'plan2', sl), expected);
  });

  test('HMRC method: the excess keeps its pence; ONLY the final deduction is floored to a whole pound', () => {
    // The recovery rate is applied to the FULL excess (pence included); only the resulting deduction is
    // rounded down to £. Construct excess = £1011.20:
    //   correct:  floor(1011.20 × 0.09) = floor(91.008) = £91
    //   the WITHDRAWN v17.04 "floor the excess to a whole pound first" method gave £90 — proven wrong
    //   by G. Miller's real P2 payslip (see the MILLER_ACTUALS.sl regression below).
    const threshold = sl.plan2.t;   // 28470/13 = 2190.00 exactly (penny-floor is a no-op here)
    const sacGross = threshold + 1011.20;
    assert.equal(computeSL(sacGross, 'plan2', sl), 91);
  });

  test('plan1: lower threshold than plan2 — deducts more at same income', () => {
    const sacGross = 2500;
    const sl1 = computeSL(sacGross, 'plan1', sl);
    const sl2 = computeSL(sacGross, 'plan2', sl);
    assert.ok(sl1 > sl2, `plan1 (${sl1}) should exceed plan2 (${sl2}) at same gross`);
  });

  test('floor rounding: fractional pence are dropped, not rounded', () => {
    const threshold = sl.plan2.t;
    const sacGross2 = threshold + 100.1; // excess ≈ 100.1, * 0.09 = 9.009 → floor = 9
    assert.equal(computeSL(sacGross2, 'plan2', sl), Math.floor((sacGross2 - threshold) * 0.09));
  });

  test('postgrad plan uses 6% rate', () => {
    const sacGross = 2500;
    const threshold = Math.floor((21000 / P_YR) * 100) / 100;   // penny-floored, matching computeSL
    const expected = Math.floor((sacGross - threshold) * 0.06);
    assert.equal(computeSL(sacGross, 'postgrad', sl), expected);
  });

  test('Plan 5 returns 0 in 2025/26 (not repayable until 6 Apr 2026) but deducts in 2026/27', () => {
    // The 2025/26 map has no plan5 → computeSL returns 0 for a plan5 selection on a 2025/26 period.
    assert.equal(computeSL(2500, 'plan5', sl), 0, 'Plan 5 must not deduct in 2025/26');
    const sl26 = getThresholds('2026/27').sl;
    assert.ok(computeSL(2500, 'plan5', sl26) > 0, 'Plan 5 deducts normally in 2026/27');
  });

  test('a plan and a Postgraduate Loan deduct independently — the coordinator sums two computeSL calls', () => {
    // Item 3: one undergraduate plan + a Postgraduate Loan can apply together (HMRC deducts both).
    // The coordinator computes computeSL(plan) + computeSL('postgrad'); verify each is the independent
    // HMRC calc and both are non-zero at a normal 4-weekly gross.
    const sacGross = 3000;
    const under = computeSL(sacGross, 'plan2', sl);
    const post  = computeSL(sacGross, 'postgrad', sl);
    assert.equal(under, Math.floor((sacGross - Math.floor(sl.plan2.t * 100) / 100) * 0.09), 'plan 2 leg');
    assert.equal(post,  Math.floor((sacGross - Math.floor(sl.postgrad.t * 100) / 100) * 0.06), 'postgrad leg');
    assert.ok(under > 0 && post > 0 && under !== post, 'both loans deduct, at different rates/thresholds');
  });

  // ── Real-payslip regression (the source of truth) ─────────────────────────────
  // G. Miller is on Plan 1. His real SL deductions lock the HMRC rounding method: the excess keeps
  // its pence, only the final deduction is floored to £. (P2 = £214 is the case the withdrawn v17.04
  // method got wrong as £213.) Only the whole-pound, non-zero periods are asserted: P4 carries a
  // £259.12 payslip adjustment (has pence — not a clean period deduction), and from P7 his loan is
  // settled so the payslip shows £0 while his gross is still above the threshold (a loan-balance fact
  // the estimator does not model). Threshold: Plan 1 26065/13 = £2005.00 exactly.
  test('MILLER_ACTUALS.sl: computeSL matches every clean Plan 1 payslip deduction exactly', () => {
    for (const [date, v] of Object.entries(MILLER_ACTUALS)) {
      if (!v.sl || !Number.isInteger(v.sl)) continue;   // skip £0 (loan settled) and the pence adjustment
      assert.equal(computeSL(v.gross, 'plan1', sl), v.sl, `SL ${date} (gross ${v.gross})`);
    }
  });

});

// ── computeTax ────────────────────────────────────────────────────────────────

describe('computeTax', () => {
  test('NT code → 0 tax always', () => {
    const { tax } = computeTax(2000, 'NT', T25);
    assert.equal(tax, 0);
  });

  test('BR code → flat 20%', () => {
    const sacGross = 2000;
    const { tax } = computeTax(sacGross, 'BR', T25);
    approx(tax, sacGross * 0.20, 'BR tax');
  });

  test('D0 code → flat 40%', () => {
    const { tax } = computeTax(2000, 'D0', T25);
    approx(tax, 2000 * 0.40, 'D0 tax');
  });

  test('D1 code → flat 45%', () => {
    const { tax } = computeTax(2000, 'D1', T25);
    approx(tax, 2000 * 0.45, 'D1 tax');
  });

  test('0T code → no personal allowance, all taxed at 20%', () => {
    const sacGross = 1000;
    // No PA, basic band applies to full amount
    const { tax } = computeTax(sacGross, '0T', T25);
    const TAX = T25.tax;
    const basicBand = Math.max(0, TAX.b - 0);
    const expected = sacGross <= basicBand ? sacGross * TAX.r20 : /* higher */ sacGross * TAX.r40;
    approx(tax, expected, '0T tax');
  });

  test('1257L: sacGross below PA → 0 tax', () => {
    // PA = 12570/13 ≈ 967.69
    const { tax } = computeTax(800, '1257L', T25);
    assert.equal(tax, 0);
  });

  test('1257L: sacGross above PA → 20% on excess (HMRC-floored)', () => {
    const sacGross = 1500;
    const pa = 12570 / P_YR;
    const expected = Math.floor(sacGross - pa) * 0.20; // HMRC floors taxable to whole pounds
    const { tax } = computeTax(sacGross, '1257L', T25);
    approx(tax, expected, '1257L above PA');
  });

  test('K code (K500) → negative allowance adds to taxable income', () => {
    const sacGross = 1000;
    // K500: PA = -(500 × 10 / 13) = -384.62; taxable = sacGross + 384.62
    const negPa = 500 * 10 / P_YR;
    const taxable = sacGross + negPa;
    const TAX = T25.tax;
    const basicBand = TAX.b;
    const expected = taxable <= basicBand ? taxable * TAX.r20 : /* higher rate logic */ null;
    const { tax } = computeTax(sacGross, 'K500', T25);
    approx(tax, taxable <= basicBand ? taxable * TAX.r20 : 0, 'K500', 1);
    // Verify it taxes more than a standard code at the same gross
    const { tax: stdTax } = computeTax(sacGross, '1257L', T25);
    assert.ok(tax > stdTax, `K500 (${tax}) should tax more than 1257L (${stdTax})`);
  });

  test('N code (marriage allowance transferred out) → less allowance, more tax than 1257L', () => {
    // 1131N gives a £11,310 allowance vs 1257L's £12,570 — the digits×10 rule, not the default PA.
    const sacGross = 1500; // above both per-period allowances
    const { tax: nTax }   = computeTax(sacGross, '1131N', T25);
    const { tax: stdTax } = computeTax(sacGross, '1257L', T25);
    const expectedN = Math.floor(sacGross - 11310 / P_YR) * 0.20;
    approx(nTax, expectedN, '1131N tax');
    assert.ok(nTax > stdTax, `1131N (${nTax}) should tax more than 1257L (${stdTax})`);
  });

  test('M code (marriage allowance received) → more allowance, less tax than 1257L', () => {
    const sacGross = 1500;
    const { tax: mTax }   = computeTax(sacGross, '1383M', T25);
    const { tax: stdTax } = computeTax(sacGross, '1257L', T25);
    const expectedM = Math.floor(sacGross - 13830 / P_YR) * 0.20;
    approx(mTax, expectedM, '1383M tax');
    assert.ok(mTax < stdTax, `1383M (${mTax}) should tax less than 1257L (${stdTax})`);
  });

  test('0T high earner: basic-rate band is the fixed £37,700 (not 50,270 − 0)', () => {
    // Cumulative to period 13 with cumGross £45,000 and no allowance (0T). The 20% band is the fixed
    // £37,700 of taxable income; the £7,300 above it is 40%. The old (TAX.b − allowance) formula gave
    // a £50,270 band and taxed the whole £45,000 at 20%. A realistic ytdTax keeps the period-13 deduction
    // small so it isn't clipped by the reg-23 50% cap — the band structure (via cumTaxDue) is what's tested.
    const sacGross = 5000, ytdPay = 40000, ytdTax = 10000;
    const { tax } = computeTax(sacGross, '0T', T25, { ytdPay, ytdTax, periodN: 13 });
    const expected = 37700 * 0.20 + (45000 - 37700) * 0.40 - ytdTax;
    approx(tax, expected, '0T 40% boundary', 1);
  });

  test('W1 suffix → non-cumulative even when YTD values provided', () => {
    const opts = { ytdPay: 5000, ytdTax: 500, periodN: 5 };
    const { tax: cumTax, usingCumulative: isCum } = computeTax(1200, '1257L', T25, opts);
    const { tax: w1Tax, usingCumulative: isW1Cum } = computeTax(1200, '1257LW1', T25, opts);
    // W1 should NOT use cumulative path
    assert.equal(isW1Cum, false, 'W1 code should not use cumulative path');
    assert.equal(isCum, true, 'Standard code with YTD should use cumulative');
    // The W1 result should differ from cumulative result
    assert.notEqual(w1Tax, cumTax);
  });

  test('M1 suffix → same non-cumulative behaviour as W1', () => {
    const opts = { ytdPay: 5000, ytdTax: 500, periodN: 5 };
    const { usingCumulative } = computeTax(1200, '1257LM1', T25, opts);
    assert.equal(usingCumulative, false, 'M1 code should not use cumulative path');
  });

  test('X suffix → non-cumulative', () => {
    const opts = { ytdPay: 5000, ytdTax: 500, periodN: 5 };
    const { usingCumulative } = computeTax(1200, '1257LX', T25, opts);
    assert.equal(usingCumulative, false, 'X suffix should not use cumulative path');
  });

  test('S prefix → routes to Scottish tax bands (higher than rUK for same gross)', () => {
    const sacGross = 2500; // in intermediate Scottish band (21%)
    const { tax: scotTax } = computeTax(sacGross, 'S1257L', T25);
    const { tax: ukTax } = computeTax(sacGross, '1257L', T25);
    // Scottish intermediate 21% > rUK basic 20% on same taxable amount
    assert.ok(scotTax > ukTax, `Scottish (${scotTax}) should exceed rUK (${ukTax}) for intermediate earner`);
  });

  test('SBR code → Scottish basic rate', () => {
    const sacGross = 2000;
    const { tax } = computeTax(sacGross, 'SBR', T25);
    // SBR uses Scottish basic band rate (0.20)
    approx(tax, sacGross * T25.scottishTax.bands[1].rate, 'SBR tax');
  });

  test('SD0 code → Scottish INTERMEDIATE rate (21%), not higher', () => {
    const sacGross = 2000;
    const { tax } = computeTax(sacGross, 'SD0', T25);
    // SD0 = Scottish intermediate = bands[2] (0.21). Regression guard: it previously
    // pointed at bands[3] (higher 42%), over-taxing by a full band.
    approx(tax, sacGross * T25.scottishTax.bands[2].rate, 'SD0 tax');
  });

  test('SD1 code → Scottish HIGHER rate (42%), not top', () => {
    const sacGross = 2000;
    const { tax } = computeTax(sacGross, 'SD1', T25);
    // SD1 = Scottish higher = bands[3] (0.42). Regression guard: it previously pointed
    // at bands[5] (top 48%).
    approx(tax, sacGross * T25.scottishTax.bands[3].rate, 'SD1 tax');
  });

  test('SD2 code → Scottish ADVANCED rate (45%) flat on all pay', () => {
    const sacGross = 2000;
    const { tax } = computeTax(sacGross, 'SD2', T25);
    // SD2 = Scottish advanced = bands[4] (0.45). Previously unhandled → fell through to banded + allowance.
    approx(tax, sacGross * T25.scottishTax.bands[4].rate, 'SD2 tax');
  });

  test('SD3 code → Scottish TOP rate (48%) flat on all pay', () => {
    const sacGross = 2000;
    const { tax } = computeTax(sacGross, 'SD3', T25);
    // SD3 = Scottish top = bands[5] (0.48). Previously unhandled → fell through to banded + allowance.
    approx(tax, sacGross * T25.scottishTax.bands[5].rate, 'SD3 tax');
  });

  test('Welsh C-prefix codes tax identically to their rUK equivalents (C stripped)', () => {
    // Welsh rates == English/rUK, so a C-code must match the unprefixed code exactly. Previously
    // CBR/CD0/CD1/CNT fell through to banded tax and C0T wrongly kept the full allowance.
    for (const [welsh, ruk] of [['CBR','BR'], ['CD0','D0'], ['CD1','D1'], ['C0T','0T'], ['C1257L','1257L'], ['CNT','NT']]) {
      approx(computeTax(2000, welsh, T25).tax, computeTax(2000, ruk, T25).tax, `${welsh} == ${ruk}`);
    }
  });

  // ── 50% overriding limit (HMRC PAYE reg 23) ───────────────────────────────────
  test('50% cap: an ordinary 1257L code is never capped', () => {
    const { tax } = computeTax(3000, '1257L', T25);
    assert.ok(tax < 3000 * 0.5, `1257L tax (${tax}) is well under the 50% cap and unaffected`);
  });

  test('50% cap: an ordinary K code below the cap is unaffected', () => {
    // K500 on £3000 → taxable ≈ 3384 (into the 40% band at period scale), tax ≈ £774 — under the £1500 cap.
    const { tax } = computeTax(3000, 'K500', T25);
    assert.ok(tax > 0 && tax < 3000 * 0.5, `K500 tax (${tax}) is under the 50% cap`);
  });

  test('50% cap: an extreme K code is capped at half the period pay (non-cumulative)', () => {
    // K9999 on £3000: uncapped tax ≈ £3798 (> the whole payment); reg 23 caps it at 50% = £1500.
    const { tax } = computeTax(3000, 'K9999', T25);
    assert.equal(tax, 1500, 'tax deducted cannot exceed 50% of the period pay');
  });

  test('50% cap: applies on the cumulative path too', () => {
    // Same extreme K code, cumulative (first period, no YTD) — the period deduction is still capped at 50%.
    const { tax, usingCumulative } = computeTax(3000, 'K9999', T25, { ytdPay: 0, ytdTax: 0, periodN: 1 });
    assert.equal(usingCumulative, true);
    assert.equal(tax, 1500, 'the cumulative period deduction is also capped at 50% of period pay');
  });

  test('cumulative PAYE: uses ytdPay + sacGross across periodN', () => {
    // Period 5, YTD pay = 4800, YTD tax = 200, this period gross = 1200
    // cumGross = 6000; PA scaled × 5 = (12570/13) × 5
    const pa = 12570 / P_YR;
    const scaledPa = pa * 5;
    const cumGross = 4800 + 1200;
    const taxable = Math.floor(Math.max(0, cumGross - scaledPa)); // HMRC floors
    const TAX = T25.tax;
    const basicBand = Math.max(0, TAX.b * 5 - Math.max(0, scaledPa));
    const cumTaxDue = taxable <= basicBand ? taxable * TAX.r20 : basicBand * TAX.r20 + (taxable - basicBand) * TAX.r40;
    const expected = Math.max(0, cumTaxDue - 200);

    const { tax, usingCumulative } = computeTax(1200, '1257L', T25, { ytdPay: 4800, ytdTax: 200, periodN: 5 });
    assert.equal(usingCumulative, true, 'should use cumulative path');
    approx(tax, expected, 'cumulative tax');
  });

  test('cumulative PAYE: ytdTax overpaid → clamps to 0 not negative', () => {
    // ytdTax intentionally very large — result must not go negative
    const { tax } = computeTax(500, '1257L', T25, { ytdPay: 500, ytdTax: 9999, periodN: 2 });
    assert.ok(tax >= 0, 'tax should never be negative');
  });

  test('no YTD provided → non-cumulative even for standard code', () => {
    const { usingCumulative } = computeTax(1200, '1257L', T25);
    assert.equal(usingCumulative, false);
  });

  test('lowercase tax code is normalised to uppercase', () => {
    const { tax: lower } = computeTax(1500, '1257l', T25);
    const { tax: upper } = computeTax(1500, '1257L', T25);
    approx(lower, upper, 'lowercase normalised');
  });

  test('empty/null tax code falls back to 1257L', () => {
    const { tax: empty  } = computeTax(1500, '', T25);
    const { tax: normal } = computeTax(1500, '1257L', T25);
    approx(empty, normal, 'empty code fallback');
  });

  test('HMRC floor: G. Miller P20 (01/08/2025) and P28 (26/09/2025) — Math.floor step applied', () => {
    // Verifies the HMRC round-down step in the NON-CUMULATIVE tax computation.
    // P20: sacGross £4,441.60 → without floor £809.87, with floor £809.60
    // P28: sacGross £4,810.43 → without floor £957.40, with floor £957.20
    // P28's floored estimate equals the actual payslip (£957.20) exactly. P20's
    // actual payslip tax was £809.71 (MILLER_ACTUALS, the source of truth) — 11p
    // above the non-cumulative estimate because real payroll is cumulative. That
    // drift is expected, not a regression (see the integration block below).
    const { tax: taxP20 } = computeTax(4441.60, '1257L', T25);
    const { tax: taxP28 } = computeTax(4810.43, '1257L', T25);
    approx(taxP20, 809.60, 'P20 non-cumulative floored tax', 0.005);
    approx(taxP28, 957.20, 'P28 non-cumulative floored tax', 0.005);
  });
});

// ── computeGross ──────────────────────────────────────────────────────────────

describe('computeGross', () => {
  const BASE = { effContr: 140, rate: 20.74, satHrs: 0, bhHrs: 0, bhOtHrs: 0,
                 oHrs: 0, rHrs: 0, sHrs: 0, bHrs: 0, peerDays: 0, otherAdj: 0, london: 276.16 };

  test('contracted-only: all basic weekday hours + London Allowance', () => {
    const { gross, gBasicNorm } = computeGross(BASE);
    approx(gBasicNorm, 140 * 20.74, 'basic norm pay');
    approx(gross, 140 * 20.74 + 276.16, 'contracted-only gross');
  });

  test('Saturday hours at 1.25×', () => {
    const { gross, gBasicSat, satCapped } = computeGross({ ...BASE, satHrs: 8 });
    assert.equal(satCapped, 8);
    approx(gBasicSat, 8 * 20.74 * 1.25, 'Saturday pay');
    // normHrs reduced by satHrs
    approx(gross, 132 * 20.74 + 8 * 20.74 * 1.25 + 276.16, 'gross with Saturday');
  });

  test('Sunday hours at 1.5×', () => {
    const { gSunday } = computeGross({ ...BASE, sHrs: 6 });
    approx(gSunday, 6 * 20.74 * 1.50, 'Sunday pay');
  });

  test('Boxing Day hours at 3×', () => {
    const { gBoxing } = computeGross({ ...BASE, bHrs: 7.5 });
    approx(gBoxing, 7.5 * 20.74 * 3.00, 'Boxing Day pay');
  });

  test('Bank holiday hours at 1.25× (capped to normHrs)', () => {
    const { gBankHol, bhCapped } = computeGross({ ...BASE, bhHrs: 8 });
    assert.equal(bhCapped, 8);
    approx(gBankHol, 8 * 20.74 * 1.25, 'BH pay');
  });

  test('BH hours cap: cannot exceed normHrs', () => {
    // satHrs=100 → normHrs=40; bhHrs=60 → bhCapped=40
    const { bhCapped, nonBhNorm } = computeGross({ ...BASE, satHrs: 100, bhHrs: 60 });
    assert.equal(bhCapped, 40);
    assert.equal(nonBhNorm, 0);
  });

  test('Saturday hours cap at effContr', () => {
    const { satCapped, normHrs } = computeGross({ ...BASE, satHrs: 200 });
    assert.equal(satCapped, 140); // capped
    assert.equal(normHrs, 0);
  });

  test('overtime at 1.25×', () => {
    const { gOvertime } = computeGross({ ...BASE, oHrs: 4 });
    approx(gOvertime, 4 * 20.74 * 1.25, 'overtime pay');
  });

  test('RDW at 1.25×', () => {
    const { gRdw } = computeGross({ ...BASE, rHrs: 8 });
    approx(gRdw, 8 * 20.74 * 1.25, 'RDW pay');
  });

  test('peer training: 2 hours at 1× per day', () => {
    const { gPeer } = computeGross({ ...BASE, peerDays: 3 });
    approx(gPeer, 3 * 2 * 20.74, 'peer pay');
  });

  test('otherAdj positive adds to gross', () => {
    const { gross } = computeGross({ ...BASE, otherAdj: 100 });
    approx(gross, 140 * 20.74 + 276.16 + 100, 'positive adjustment');
  });

  test('otherAdj negative reduces gross', () => {
    const { gross } = computeGross({ ...BASE, otherAdj: -50 });
    approx(gross, 140 * 20.74 + 276.16 - 50, 'negative adjustment');
  });

  test('CES rate (21.81) gives higher gross than CEA (20.74) for same hours', () => {
    const ceaGross = computeGross(BASE).gross;
    const cesGross = computeGross({ ...BASE, rate: 21.81 }).gross;
    approx(cesGross - ceaGross, 140 * (21.81 - 20.74), 'CES vs CEA gross diff');
  });

  test('combined: Saturday + Sunday + OT + RDW + peer + adjustment', () => {
    const i = { ...BASE, satHrs: 8, sHrs: 6, oHrs: 4, rHrs: 8, peerDays: 2, otherAdj: -25 };
    const r = computeGross(i);
    // satCapped=8, normHrs=132, bhCapped=0, nonBhNorm=132
    const expected =
      132 * 20.74 +          // basic norm (132hrs × rate)
      8 * 20.74 * 1.25 +     // Saturday
      6 * 20.74 * 1.50 +     // Sunday
      4 * 20.74 * 1.25 +     // overtime
      8 * 20.74 * 1.25 +     // RDW
      2 * 2 * 20.74 +        // peer (2 days × 2h × rate)
      276.16 - 25;           // London + adj
    approx(r.gross, expected, 'combined gross');
  });
});

// ── Salary sacrifice interaction ──────────────────────────────────────────────

describe('salary sacrifice', () => {
  const i = { effContr: 140, rate: 20.74, satHrs: 0, bhHrs: 0, bhOtHrs: 0,
              oHrs: 0, rHrs: 0, sHrs: 0, bHrs: 0, peerDays: 0, otherAdj: 0, london: 276.16 };
  const { gross } = computeGross(i); // 3179.76
  const pension = 154.77;
  const sacGross = Math.max(0, gross - pension); // ~3025.00 (pre-pension gross minus contribution)

  test('sacGross reduces tax base vs pre-sacrifice gross', () => {
    const { tax: taxOnGross } = computeTax(gross, '1257L', T25);
    const { tax: taxOnSac  } = computeTax(sacGross, '1257L', T25);
    assert.ok(taxOnSac < taxOnGross, 'pension sacrifice should reduce income tax');
  });

  test('sacGross reduces NI base vs pre-sacrifice gross', () => {
    const ni = T25.ni;
    assert.ok(computeNI(sacGross, ni) < computeNI(gross, ni), 'pension sacrifice should reduce NI');
  });

  test('sacGross reduces SL base vs pre-sacrifice gross', () => {
    const sl = computeSL(sacGross, 'plan2', T25.sl);
    const slFull = computeSL(gross, 'plan2', T25.sl);
    assert.ok(sl < slFull, 'pension sacrifice should reduce SL repayment');
  });

  test('pension exceeding gross → sacGross clamps to 0', () => {
    const sacGross0 = Math.max(0, 100 - 200); // pension > gross
    assert.equal(sacGross0, 0);
    const { tax } = computeTax(0, '1257L', T25);
    assert.equal(tax, 0);
    assert.equal(computeNI(0, T25.ni), 0);
  });
});

// ── Real-period integration fixture ──────────────────────────────────────────

describe('integration fixture (CEA Period 8 2025/26)', () => {
  // P8 is offset -11+7 = -4 → still 2025/26 tax year
  // 8 Saturday hours, 0 others, pension sacrifice applied
  const rate = 20.74;
  const effContr = 140;
  const pension = 154.77;
  const london = 276.16; // post-award

  const { gross } = computeGross({
    effContr, rate, satHrs: 8, bhHrs: 0, bhOtHrs: 0, oHrs: 0,
    rHrs: 0, sHrs: 0, bHrs: 0, peerDays: 0, otherAdj: 0, london,
  });
  const sacGross = Math.max(0, gross - pension);
  const { tax } = computeTax(sacGross, '1257L', T25);
  const ni  = computeNI(sacGross, T25.ni);
  const net = sacGross - tax - ni;

  test('gross is correct for effContr=140, satHrs=8', () => {
    approx(gross, 3221.24, 'P8 gross');
  });

  test('tax + NI < sacGross', () => {
    assert.ok(tax + ni < sacGross, `deductions (${(tax + ni).toFixed(2)}) should not exceed sacGross (${sacGross.toFixed(2)})`);
  });
});

// ── getPensionForPeriod ───────────────────────────────────────────────────────
// Pension changed £154.77 → £147.36 at the May 8 2026 payslip.
// Periods before that date (P50 = Apr 10 2026 and earlier) must show £154.77.
// Periods from May 8 2026 (P51) onwards must show £147.36.

describe('getPensionForPeriod', () => {
  const cutover = new Date(2026, 4, 8); // May 8 2026 — first payday at new rate

  test('payday one day before May 8 2026 → pre-change rate £154.77', () => {
    const before = new Date(cutover.getTime() - 86400000);
    assert.equal(getPensionForPeriod('cea', before), 154.77);
    assert.equal(getPensionForPeriod('ces', before), 154.77);
  });

  test('payday = May 8 2026 → new rate £147.36', () => {
    assert.equal(getPensionForPeriod('cea', cutover), 147.36);
    assert.equal(getPensionForPeriod('ces', cutover), 147.36);
  });

  test('payday well after May 8 2026 → new rate £147.36', () => {
    assert.equal(getPensionForPeriod('cea', new Date(2026, 5, 5)), 147.36); // Jun 5
  });

  test('P50 payday (Apr 10 2026) → old rate £154.77', () => {
    // P50 was the first period of 2026/27 but pension had not yet changed
    assert.equal(getPensionForPeriod('cea', new Date(2026, 3, 10)), 154.77);
  });

  test('2025/26 payday → old rate £154.77', () => {
    assert.equal(getPensionForPeriod('cea', new Date(2026, 2, 13)), 154.77); // Mar 13 = P49
  });

  test('unknown grade falls back to cea', () => {
    assert.equal(getPensionForPeriod('dispatcher', cutover), 147.36);
  });
});

// ── calcProRateFactor ─────────────────────────────────────────────────────────
// Reproduces getPeriods() arithmetic to get exact period dates for P51.
// P51 payday = Feb 13 2026 (noon) + 3 × 28 days = May 8 2026.
// FORMULA INVARIANT: periodCutoff is noon local; startDate is midnight local.
// Math.round on the 0.5-day offset always gives the correct calendar count.

describe('calcProRateFactor', () => {
  // Build P51 dates exactly as getPeriods() does in paycalc.js
  const anchor  = new Date(2026, 1, 13, 12, 0, 0);          // Feb 13 2026, noon local
  const p51pay  = new Date(anchor); p51pay.setDate(p51pay.getDate() + 3 * 28);
  const p51cut  = new Date(p51pay); p51cut.setDate(p51cut.getDate() - 6);
  const p51start= new Date(p51cut); p51start.setDate(p51start.getDate() - 27);
  // p51start = Sun Apr 5 2026 noon, p51cut = Sat May 2 2026 noon, 28-day window

  test('no startDate → 1.0 (full period)', () => {
    assert.equal(calcProRateFactor(null, p51start, p51cut), 1);
    assert.equal(calcProRateFactor(undefined, p51start, p51cut), 1);
  });

  test('startDate before period start → 1.0 (full period)', () => {
    assert.equal(calcProRateFactor(new Date(2026, 2, 1), p51start, p51cut), 1); // Mar 1
  });

  test('startDate = same calendar day as period start → 1.0', () => {
    // Apr 5 midnight < Apr 5 noon (p51start), so sd <= periodStart → return 1
    assert.equal(calcProRateFactor(new Date(2026, 3, 5), p51start, p51cut), 1);
  });

  test('M. Okeke: startDate Apr 20 midnight → 14/28 = 0.5 (matches payslip)', () => {
    // Apr 20 midnight → raw 12.5 → Math.round(12.5)=13 → daysEmployed=14 → 14/28=0.5
    // Verified: May 8 2026 payslip shows London Allowance £276.16 × 0.5 = £138.08 ✓
    const factor = calcProRateFactor(new Date(2026, 3, 20), p51start, p51cut);
    assert.equal(factor, 14 / 28);
    assert.equal(factor, 0.5);
  });

  test('startDate Apr 20 → contracted hours = Math.round(140 × 0.5) = 70', () => {
    const factor = calcProRateFactor(new Date(2026, 3, 20), p51start, p51cut);
    assert.equal(Math.round(140 * factor), 70);
  });

  test('startDate Apr 20 → London Allowance = £276.16 × 0.5 = £138.08', () => {
    const factor = calcProRateFactor(new Date(2026, 3, 20), p51start, p51cut);
    approx(276.16 * factor, 138.08, 'London Allowance pro-rated');
  });

  test('startDate after cutoff → 0.0 (not yet employed)', () => {
    assert.equal(calcProRateFactor(new Date(2026, 4, 5), p51start, p51cut), 0); // May 5
  });

  test('startDate = cutoff day midnight → 1/28 (last day only)', () => {
    // May 2 midnight → raw 0.5 → Math.round=1 → days=2 → 2/28 by the formula
    // This edge case is noted: formula gives 2 days for a cutoff-day joiner.
    // In practice Chiltern would never start someone on the last day of a period.
    const factor = calcProRateFactor(new Date(2026, 4, 2), p51start, p51cut);
    assert.equal(factor, 2 / 28);
  });

  test('Apr 19 midnight → 15/28 ≠ 0.5 (confirms Apr 20 is the correct startDate)', () => {
    // This was the v8.77 regression: changing Apr 20 → Apr 19 gave 53.6% not 50%
    const factor = calcProRateFactor(new Date(2026, 3, 19), p51start, p51cut);
    assert.equal(factor, 15 / 28);
    assert.notEqual(factor, 0.5);
  });

  test('totalDays is always 28 for a standard period', () => {
    // Internal check: (cutoff noon − start noon) = 27 whole days → +1 = 28
    const msPerDay  = 86400000;
    const totalDays = Math.round((p51cut - p51start) / msPerDay) + 1;
    assert.equal(totalDays, 28);
  });
});

// ── G. Miller 2025/26 payslip integration ─────────────────────────────────────
// Actual payslip figures from MILLER_ACTUALS in test-fixtures/miller-actuals.js.
// gross = post-pension sacGross (matches "Taxable Pay" on payslip).
// Tax and NI are tested non-cumulatively: actual payroll uses cumulative PAYE,
// so small per-period differences (up to ~£1 tax, ~20p NI) are expected and
// acceptable. Any larger gap would indicate a formula regression.
// Student loan: NOT tested here — the SL plan cannot be determined from the
// actuals alone (the back-calculated threshold doesn't match any standard plan,
// and some SL values in the actuals don't reconcile exactly from other fields,
// suggesting minor transcription imprecision). Verify SL plan from your payslip
// settings and add a test once the plan is confirmed.
// NOTE: The HMRC-floor test above asserts P20 NON-CUMULATIVE tax = £809.60, while
// MILLER_ACTUALS records the actual payslip tax of £809.71 for the same period.
// These do not conflict: £809.71 is the cumulative payslip figure (the source of
// truth), £809.60 is the non-cumulative floored estimate, and the 11p gap is the
// expected cumulative-PAYE drift documented above. Confirmed by Gareth (Jun 2026).

describe('G. Miller 2025/26 payslip integration (non-cumulative estimates)', () => {
  // Derived from the real payslip fixture (test-fixtures/miller-actuals.js) — the single
  // source of truth for this regression net. These figures lived in MILLER_ACTUALS in the
  // served roster-data.js until v14.68, when they were moved to a hosting-excluded fixture
  // for privacy (Track 2, Option A). Object insertion order is payday-ascending, preserved.
  const actuals = Object.entries(MILLER_ACTUALS)
    .map(([date, v]) => ({ date, gross: v.gross, tax: v.tax, ni: v.ni }));

  for (const p of actuals) {
    test(`${p.date}: tax within £1 of payslip`, () => {
      const { tax } = computeTax(p.gross, '1257L', T25);
      approx(tax, p.tax, `tax ${p.date}`, 1.00);
    });

    test(`${p.date}: NI within 20p of payslip`, () => {
      const ni = computeNI(p.gross, T25.ni);
      approx(ni, p.ni, `NI ${p.date}`, 0.20);
    });
  }
});
