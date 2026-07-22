// paycalc-breakdown.test.mjs — tests for the two pure HTML builders extracted from calculate()
// (review item 20). These lock the result-card markup so a future edit to the summary/breakdown
// can't silently change what staff see. No mocks, no DOM; part of test:hygiene.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtHrsMins, buildSummaryRows, buildBreakdownRows, buildActualCheck } from './paycalc-breakdown.js';

test('fmtHrsMins formats decimal hours as "Nh"/"Nh Mm"', () => {
    assert.equal(fmtHrsMins(8), '8h');
    assert.equal(fmtHrsMins(7.5), '7h 30m');
    assert.equal(fmtHrsMins(0), '0h');
    assert.equal(fmtHrsMins(1.25), '1h 15m');
});

// ── buildSummaryRows ────────────────────────────────────────────────────────────
const SUM_BASE = {
    _bpThisPeriod: 0, _hppForPeriod: 0, gross: 2000, grossWithBp: 2000,
    _bpIsEstimate: false, _hppIsEstimate: false, pension: 0, sacGross: 2000,
    usingCumulative: false, tax: 300, ni: 150, slLines: '', net: 1550,
};

test('buildSummaryRows: plain period → Total pay, tax, NI, take-home; no Regular/pension rows', () => {
    const html = buildSummaryRows(SUM_BASE);
    assert.ok(html.includes('<span class="lbl">Total pay</span><span class="val">£2,000.00</span>'));
    assert.ok(html.includes('Income Tax'));
    assert.ok(html.includes('National Insurance'));
    assert.ok(html.includes('Estimated take-home pay</span><span class="val">£1,550.00</span>'));
    assert.ok(!html.includes('Regular pay'), 'no Regular pay row without bp/hpp');
    assert.ok(!html.includes('Pension contribution'), 'no pension row when pension = 0');
});

test('buildSummaryRows: pension present adds the deduction + pay-after-pension rows', () => {
    const html = buildSummaryRows({ ...SUM_BASE, pension: 147.36, sacGross: 1852.64 });
    assert.ok(html.includes('Pension contribution</span><span class="val">−£147.36</span>'));
    assert.ok(html.includes('Pay after pension deduction</span><span class="val">£1,852.64</span>'));
});

test('buildSummaryRows: back pay + HPP → Regular pay + both extra rows + grossWithBp Total + take-home suffix', () => {
    const html = buildSummaryRows({
        ...SUM_BASE, _bpThisPeriod: 500, _hppForPeriod: 120, grossWithBp: 2620,
    });
    assert.ok(html.includes('Regular pay</span><span class="val">£2,000.00</span>'));
    assert.ok(html.includes('Back pay lump sum (pay award)</span><span class="val">+£500.00</span>'));
    assert.ok(html.includes('Holiday Pay Premium'));
    assert.ok(html.includes('<span class="val">+£120.00</span>'));
    assert.ok(html.includes('Total pay</span><span class="val">£2,620.00</span>'), 'Total uses grossWithBp');
    assert.ok(html.includes('(inc. back pay &amp; HPP)') || html.includes('(inc. back pay & HPP)'));
});

test('buildSummaryRows: estimate flags add " — estimate"/"(estimated)" labels', () => {
    const html = buildSummaryRows({
        ...SUM_BASE, _bpThisPeriod: 500, _bpIsEstimate: true, _hppForPeriod: 120, _hppIsEstimate: true, grossWithBp: 2620,
    });
    assert.ok(html.includes('Back pay lump sum (pay award — estimate)'));
    assert.ok(html.includes('<span class="sum-est">(estimated)</span>'));
});

test('buildSummaryRows: cumulative tax adds the "adjusted from payslip" note; slLines injected verbatim', () => {
    const sl = '<div class="sum-row sum-ded"><span class="lbl">Student Loan</span><span class="val">−£30.00</span></div>';
    const html = buildSummaryRows({ ...SUM_BASE, usingCumulative: true, slLines: sl });
    assert.ok(html.includes('adjusted from payslip'));
    assert.ok(html.includes(sl), 'pre-rendered slLines passed through unchanged');
});

// ── buildBreakdownRows ──────────────────────────────────────────────────────────
const BD_BASE = {
    nonBhNorm: 140, rate: 21.49, gBasicNorm: 3008.6,
    satCapped: 0, r125: 26.86, gBasicSat: 0, bhCapped: 0, gBankHol: 0,
    bhOtHrs: 0, gBhOt: 0, oHrs: 0, gOvertime: 0, rHrs: 0, gRdw: 0,
    sHrs: 0, r150: 32.24, gSunday: 0, bHrs: 0, r300: 64.47, gBoxing: 0,
    peer: 0, gPeer: 0, LONDON: 286.1, otherAdj: 0, slSkip: false, plan: 'none',
    pgLoan: false, usingCumulative: false,
    _bpThisPeriod: 0, _bpIsEstimate: false, _hppForPeriod: 0, _hppIsEstimate: false,
};

test('buildBreakdownRows: bare period → only Mon–Fri basic + London Allowance', () => {
    const html = buildBreakdownRows(BD_BASE);
    assert.ok(html.includes('Basic pay — Mon–Fri (140h × £21.49)'));
    assert.ok(html.includes('London Allowance'));
    assert.ok(!html.includes('Saturday'));
    assert.ok(!html.includes('Overtime'));
    assert.ok(!html.includes('Sunday Working'));
});

test('buildBreakdownRows: each premium row appears only when its hours > 0', () => {
    const html = buildBreakdownRows({
        ...BD_BASE, satCapped: 8, gBasicSat: 214.88, oHrs: 4, gOvertime: 107.44,
        sHrs: 8, gSunday: 257.92, bHrs: 8, gBoxing: 515.76,
    });
    assert.ok(html.includes('Basic pay — Saturday (8h × £26.86)'));
    assert.ok(html.includes('Overtime (4h × £26.86)'));
    assert.ok(html.includes('Sunday Working (8h × £32.24)'));
    assert.ok(html.includes('Boxing Day Working (8h × £64.47)'));
    assert.ok(!html.includes('Bank Holiday Rostered'), 'bhCapped = 0 → no BH row');
});

test('buildBreakdownRows: training pluralises days; otherAdj shows sign', () => {
    const one = buildBreakdownRows({ ...BD_BASE, peer: 1, gPeer: 42.98 });
    assert.ok(one.includes('Training Days (1 day × 2h × £21.49)'));
    const many = buildBreakdownRows({ ...BD_BASE, peer: 3, gPeer: 128.94 });
    assert.ok(many.includes('Training Days (3 days × 2h × £21.49)'));
    // A negative adjustment gets no '+' prefix; fmt() renders the sign after the £ (£-12.50) —
    // this mirrors the original inline template exactly (byte-identical extraction).
    const neg = buildBreakdownRows({ ...BD_BASE, otherAdj: -12.5 });
    assert.ok(neg.includes('Other payroll adjustment</span><span class="b-val">£-12.50</span>'));
    const pos = buildBreakdownRows({ ...BD_BASE, otherAdj: 12.5 });
    assert.ok(pos.includes('Other payroll adjustment</span><span class="b-val">+£12.50</span>'));
});

test('buildBreakdownRows: SL-skip note only with an active plan; cumulative + bp/hpp extra rows', () => {
    assert.ok(!buildBreakdownRows({ ...BD_BASE, slSkip: true, plan: 'none' }).includes('Student Loan not deducted'),
        'slSkip with no plan → no note');
    assert.ok(buildBreakdownRows({ ...BD_BASE, slSkip: true, plan: 'plan2' }).includes('Student Loan not deducted this period'));
    assert.ok(buildBreakdownRows({ ...BD_BASE, usingCumulative: true }).includes('Tax adjusted using Year to Date figures'));
    const extras = buildBreakdownRows({ ...BD_BASE, _bpThisPeriod: 500, _bpIsEstimate: true, _hppForPeriod: 120, _hppIsEstimate: true });
    assert.ok(extras.includes('bd-extra'));
    assert.ok(extras.includes('Back pay lump sum (pay award — estimate)</span><span class="b-val">+£500.00</span>'));
    assert.ok(extras.includes('Holiday Pay Premium (estimated)</span><span class="b-val">+£120.00</span>'));
});

test('buildBreakdownRows: SL repaid-in-full note (v18.41) — active plan only, outranks the skip', () => {
    assert.ok(buildBreakdownRows({ ...BD_BASE, slPaidOff: true, plan: 'plan1' }).includes('Student Loan repaid in full'));
    assert.ok(!buildBreakdownRows({ ...BD_BASE, slPaidOff: true, plan: 'none' }).includes('repaid in full'),
        'paid-off with no active loan → no note');
    const both = buildBreakdownRows({ ...BD_BASE, slPaidOff: true, slSkip: true, plan: 'plan1' });
    assert.ok(both.includes('repaid in full') && !both.includes('not deducted this period'),
        'repaid outranks the one-off skip — one note, not two');
    assert.ok(!buildBreakdownRows({ ...BD_BASE, plan: 'plan1' }).includes('repaid in full'),
        'omitted param defaults to still-repaying');
});

// "Check against your payslip" verdict (v18.42 — review item 3). Bands are the documented
// tolerances: ≤£2 = the cumulative-PAYE drift the payslip regression allows; larger gaps point at
// the known less-accurate cases rather than alarming.
test('buildActualCheck: quiet when empty; band boundaries; direction named', () => {
    assert.equal(buildActualCheck(0, 2900), '', 'no figure → nothing rendered');
    assert.match(buildActualCheck(2900, 2900), /Matches your payslip exactly/);
    assert.match(buildActualCheck(2901.50, 2900), /within £1\.50/, 'inside the £2 rounding band');
    assert.match(buildActualCheck(2901.50, 2900), /check-ok/);
    const near = buildActualCheck(2910, 2900);
    assert.match(near, /£10\.00 more/, 'direction: payslip pays more');
    assert.match(near, /Year to Date/, 'points at the sharpening lever');
    const far = buildActualCheck(2800, 2900);
    assert.match(far, /£100\.00 less/, 'direction: payslip pays less');
    assert.match(far, /absence, back pay or a payroll correction/);
    assert.ok(!/check-ok/.test(far), 'a large gap is not a green line');
});
