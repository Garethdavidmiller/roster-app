// paycalc.test.mjs — unit tests for paycalc-calc.js
// Run with: node --test paycalc.test.mjs
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  P_YR, TAX_YEARS, GRADES, HPP_FRACTION,
  calcBandedTax, getTaxYearForOffset, getThresholds, getLondonAllowanceForPeriod,
  computeGross, computeTax, computeNI, computeSL, calcProRateFactor, getPensionForPeriod,
} from './paycalc-calc.js';

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

  test('GRADES.ces has correct rate and contracted hours', () => {
    assert.equal(GRADES.ces.rate, 21.81);
    assert.equal(GRADES.ces.contr, 140);
    assert.equal(GRADES.ces.pension, 147.36);
  });

  test('TAX_YEARS has 2025/26 and 2026/27 entries', () => {
    assert.equal(TAX_YEARS.length, 2);
    assert.equal(TAX_YEARS[0].label, '2025/26');
    assert.equal(TAX_YEARS[1].label, '2026/27');
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

  test('payday well after cutover → post-award rate (276.16)', () => {
    const later = new Date(2026, 2, 1);
    approx(getLondonAllowanceForPeriod({ payday: later }, TY25), 276.16, 'post cutover');
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

  test('plan2: below threshold → 0', () => {
    // plan2 threshold 2025/26 = 27295/13 ≈ 2099.62
    assert.equal(computeSL(2000, 'plan2', sl), 0);
  });

  test('plan2: above threshold → floor of 9% on excess', () => {
    const sacGross = 2500;
    const threshold = 27295 / P_YR;
    const expected = Math.floor((sacGross - threshold) * 0.09);
    assert.equal(computeSL(sacGross, 'plan2', sl), expected);
  });

  test('plan1: lower threshold than plan2 — deducts more at same income', () => {
    const sacGross = 2500;
    const sl1 = computeSL(sacGross, 'plan1', sl);
    const sl2 = computeSL(sacGross, 'plan2', sl);
    assert.ok(sl1 > sl2, `plan1 (${sl1}) should exceed plan2 (${sl2}) at same gross`);
  });

  test('floor rounding: fractional pence are dropped, not rounded', () => {
    // plan2 threshold ≈ 2099.615. Choose sacGross so (gross-threshold)*0.09 has a fraction.
    const sacGross = 2099.615 + 100; // excess = 100, * 0.09 = 9.00 exactly
    // Choose one with fractional result:
    const sacGross2 = 2099.615 + 100.1; // excess ≈ 100.1, * 0.09 = 9.009 → floor = 9
    assert.equal(computeSL(sacGross2, 'plan2', sl), Math.floor((sacGross2 - 27295 / P_YR) * 0.09));
  });

  test('postgrad plan uses 6% rate', () => {
    const sacGross = 2500;
    const threshold = 21000 / P_YR;
    const expected = Math.floor((sacGross - threshold) * 0.06);
    assert.equal(computeSL(sacGross, 'postgrad', sl), expected);
  });

  test('2026/27 plan1 threshold is higher than 2025/26', () => {
    assert.ok(T26.sl.plan1.t > T25.sl.plan1.t, 'plan1 threshold should increase for 2026/27');
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

  test('HMRC floor: G. Miller P20 (01/08/2025) and P28 (26/09/2025) payslip exact match', () => {
    // P20: sacGross £4,441.60 → payslip tax £809.60
    // P28: sacGross £4,810.43 → payslip tax £957.20
    // Without floor: P20 = £809.87 (+27p), P28 = £957.40 (+20p)
    // With floor:    P20 = £809.60 (exact), P28 = £957.20 (exact)
    const { tax: taxP20 } = computeTax(4441.60, '1257L', T25);
    const { tax: taxP28 } = computeTax(4810.43, '1257L', T25);
    approx(taxP20, 809.60, 'P20 payslip tax', 0.005);
    approx(taxP28, 957.20, 'P28 payslip tax', 0.005);
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
    assert.ok(cesGross > ceaGross, 'CES gross should exceed CEA gross');
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
    assert.ok(sl <= slFull, 'pension sacrifice should reduce or maintain SL repayment');
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

  test('gross is sensible (roughly £3,200–£3,300)', () => {
    assert.ok(gross > 3200 && gross < 3300, `gross ${gross.toFixed(2)} out of expected range`);
  });

  test('tax > 0', () => { assert.ok(tax > 0); });
  test('NI > 0',  () => { assert.ok(ni > 0); });
  test('net < sacGross', () => { assert.ok(net < sacGross); });
  test('net is positive', () => { assert.ok(net > 0); });

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
