/**
 * Unit tests for computeYearSoFar (paycalc-year-summary.js) — the "This tax year so far"
 * aggregation in the Year to Date card (v18.41, review item 11).
 *
 * Run: node --experimental-test-module-mocks --test paycalc-year-summary.test.mjs
 *
 * Mock strategy (mirrors paycalc-hpp.test.mjs):
 *   paycalc-periods.js  — mocked with a controllable getPeriods()
 *   paycalc-settings.js — mocked: cea / 140 contracted / no pro-rate / £147.36 pension / £20.74
 *   ls.js / roster-data.js — mocked (no Firebase transitive deps)
 *   paycalc-calc.js / paycalc-migrations.js / paycalc-hpp.js — REAL (pure), so the per-payslip
 *     figures assert the same engine calculate() uses.
 *
 * Periods are placed AFTER the 2025/26 award date (24 Oct 2025) so the mid-year rate step is not
 * in play and every payslip prices at the settled £20.74.
 */
import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

const _ls = new Map();
/** @type {any[]} */
let _periods = [];
/** Controllable pro-rate factor per period (default 1 = long-server). A joiner test sets 0 for
 *  its pre-start periods to exercise the annual-projection clamp. @type {(p:any)=>number} */
let _proRate = () => 1;

mock.module('./paycalc-periods.js', {
    namedExports: {
        hasBankHoliday:   () => false,
        hasBoxingDay:     () => false,
        getPeriods:       () => _periods,
        currentPeriodNum: () => 60,
        todaysPeriodNum:  () => 60,
        isTaxYearVisible: () => true,
        CONFIG:           { TAX_YEARS: [] },
    },
});

mock.module('./paycalc-settings.js', {
    namedExports: {
        getGrade:             () => 'cea',
        getLoggedMember:      () => null,
        getEffectiveContr:    () => 140,
        getProRateFactor:     /** @param {any} p */ p => _proRate(p),
        getPensionDefault:    () => 147.36,
        getStoredRateForYear: () => 20.74,
    },
});

mock.module('./ls.js', {
    namedExports: {
        lsGet:  k      => _ls.has(k) ? _ls.get(k) : null,
        lsSet:  (k, v) => { _ls.set(k, String(v)); },
        lsDel:  k      => { _ls.delete(k); },
        lsKeys: ()     => [..._ls.keys()],
    },
});

mock.module('./roster-data.js', {
    namedExports: {
        formatISO:       /** @param {Date} d */ d =>
            `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`,
        parseSmartFloat: /** @param {any} v */ v => parseFloat(String(v)),
        teamMembers:     [],
    },
});

const { computeYearSoFar } = await import('./paycalc-year-summary.js');
const { computeGross, computeTax, computeNI, computeSL, getThresholds } = await import('./paycalc-calc.js');

// ── Fixture ───────────────────────────────────────────────────────────────────

// A 4-payslip slice of 2025/26, all paydays after the 24 Oct 2025 award date (no rate step).
// Offsets (p.num − 48) 12–15 → ty.first 12 / ty.last 15.
const TY = { label: '2025/26', first: 12, last: 15, londonAllow: 276.16, londonAllowPre: 267.08 };
const P60 = { num: 60, payday: new Date(2025, 10, 21) };
const P61 = { num: 61, payday: new Date(2025, 11, 19) };
const P62 = { num: 62, payday: new Date(2026, 0, 16) };
const P63 = { num: 63, payday: new Date(2026, 1, 13) };
const NOW = new Date(2026, 1, 1);   // between P62 and P63 → 3 paid, P63 future
const T25 = getThresholds('2025/26');
const RATE = 20.74, CONTR = 140, LONDON = 276.16, PENSION = 147.36;
const OPTS = { taxCode: '1257L', plan: 'none', pgLoan: false, now: NOW };

/** Mirror one payslip through the same real engine, so the totals assert the wiring. `lump` is a
 *  gross bp/HPP lump folded into gross BEFORE pension/tax/NI/SL — exactly as calculate() does. */
function mirror({ oHrs = 0, sHrs = 0, pension = PENSION, plan = 'none', slSkip = false, lump = 0 }) {
    const g = computeGross({ rate: RATE, effContr: CONTR, satHrs: 0, bhHrs: 0, bhOtHrs: 0,
        oHrs, rHrs: 0, sHrs, bHrs: 0, peerDays: 0, london: LONDON, otherAdj: 0 });
    const sacGross = g.gross + lump - pension;
    const tax = computeTax(sacGross, '1257L', T25).tax;
    const ni  = computeNI(sacGross, T25.ni);
    const sl  = computeSL(sacGross, plan, T25.sl, slSkip);
    return { sacGross, tax, ni, sl, net: sacGross - tax - ni - sl };
}

function reset() {
    _ls.clear();
    _periods = [P60, P61, P62, P63];
    _proRate = () => 1;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('computeYearSoFar', () => {
    beforeEach(reset);

    test('sums only PAID payslips with saved hours; empty and future periods excluded', () => {
        _ls.set('myb_pc_p60', JSON.stringify({ otH: 4, otM: 0 }));            // 4h overtime
        _ls.set('myb_pc_p61', JSON.stringify({ sunH: 6, sunM: 0, pension: 100 })); // own pension
        _ls.set('myb_pc_p63', JSON.stringify({ otH: 9, otM: 0 }));            // FUTURE — must not count
        const y = computeYearSoFar(TY, OPTS);
        assert.equal(y.entered, 2, 'P60 + P61 (P62 never saved, P63 future)');
        assert.equal(y.paid, 3, 'paydays on/before now: P60–P62');
        assert.equal(y.total, 4);
        assert.equal(y.skipped, 0);
        assert.deepEqual(y.missing, [P62.payday], 'the paid-but-empty payslip is NAMED (item 2); the future one is not "missing"');
        const m60 = mirror({ oHrs: 4 });
        const m61 = mirror({ sHrs: 6, pension: 100 });
        assert.ok(Math.abs(y.taxable - (m60.sacGross + m61.sacGross)) < 0.01, 'taxable = Σ sacGross');
        assert.ok(Math.abs(y.tax - (m60.tax + m61.tax)) < 0.01);
        assert.ok(Math.abs(y.ni  - (m60.ni  + m61.ni )) < 0.01);
        assert.ok(Math.abs(y.net - (m60.net + m61.net)) < 0.01);
        assert.ok(Math.abs(y.projectedNet - (y.net / 2) * 4) < 0.01, 'projection = avg × year total');
    });

    test('mid-year joiner: annual projection extrapolates over EMPLOYED periods, not the full year', () => {
        // Joiner employed only from P62 onward — P60/P61 are fully pre-start (factor 0).
        _proRate = (/** @type {any} */ p) => (p.num >= 62 ? 1 : 0);
        _ls.set('myb_pc_p62', JSON.stringify({ otH: 4, otM: 0 }));   // one paid payslip with hours
        const y = computeYearSoFar(TY, OPTS);
        assert.equal(y.entered, 1, 'only P62 entered');
        const m62 = mirror({ oHrs: 4 });
        assert.ok(Math.abs(y.net - m62.net) < 0.01);
        // Projection base = 2 EMPLOYED periods (P62, P63), NOT the full 4. Multiplying by 4 here
        // would over-project a joiner's full-year take-home by 2×.
        assert.ok(Math.abs(y.projectedNet - (y.net / 1) * 2) < 0.01, 'projection = avg × employed periods (2), not year total (4)');
        assert.notEqual(Math.round(y.projectedNet), Math.round((y.net / 1) * 4), 'must NOT project over all 4 periods');
    });

    test('nothing entered → all-zero result with a zero projection', () => {
        const y = computeYearSoFar(TY, OPTS);
        assert.equal(y.entered, 0);
        assert.equal(y.net, 0);
        assert.equal(y.projectedNet, 0);
    });

    test('Student Loan: deducted per payslip; the repaid cutover (item 9) zeroes from its payslip on', () => {
        _ls.set('myb_pc_p60', JSON.stringify({ otH: 4, otM: 0 }));
        _ls.set('myb_pc_p61', JSON.stringify({ otH: 4, otM: 0 }));
        const withSl = computeYearSoFar(TY, { ...OPTS, plan: 'plan1' });
        const perSlip = mirror({ oHrs: 4, plan: 'plan1' });
        assert.ok(perSlip.sl > 0, 'fixture pay must clear the Plan 1 threshold');
        assert.ok(Math.abs(withSl.sl - perSlip.sl * 2) < 0.01, 'both payslips deduct');
        // Cutover at P61: P60 keeps its deduction, P61 goes to £0.
        const cutover = computeYearSoFar(TY, { ...OPTS, plan: 'plan1', slPaidOffFromP: 61 });
        assert.ok(Math.abs(cutover.sl - perSlip.sl) < 0.01, 'only the pre-cutover payslip deducts');
        assert.ok(Math.abs(cutover.net - withSl.net - perSlip.sl) < 0.01, 'the freed deduction lands in take-home');
    });

    test("a payslip's own saved slSkip is honoured", () => {
        _ls.set('myb_pc_p60', JSON.stringify({ otH: 4, otM: 0, slSkip: true }));
        const y = computeYearSoFar(TY, { ...OPTS, plan: 'plan1' });
        assert.equal(y.sl, 0, 'the saved per-period skip zeroes that payslip');
    });

    test('corrupt saved period → counted in skipped, never aborts the rest', () => {
        _ls.set('myb_pc_p60', 'not json{');
        _ls.set('myb_pc_p61', JSON.stringify({ otH: 4, otM: 0 }));
        const y = computeYearSoFar(TY, OPTS);
        assert.equal(y.skipped, 1);
        assert.equal(y.entered, 1, 'the readable payslip still counts');
    });

    test('an INCLUDED back-pay lump is folded into its payslip (taxed) and added to the projection ONCE', () => {
        _ls.set('myb_pc_p60', JSON.stringify({ otH: 4, otM: 0 }));
        _ls.set('myb_pc_p61', JSON.stringify({ otH: 4, otM: 0 }));
        const base   = computeYearSoFar(TY, OPTS);
        const withBp = computeYearSoFar(TY, { ...OPTS, bpLump: { pNum: 60, amount: 500 } });
        const lumpNet = mirror({ oHrs: 4, lump: 500 }).net - mirror({ oHrs: 4 }).net;
        assert.ok(lumpNet > 0, 'a £500 gross lump nets something after tax/NI');
        // Take-home so far agrees with the result card (the lump joins P60's take-home).
        assert.ok(Math.abs(withBp.net - (base.net + lumpNet)) < 0.01, 'so-far net includes the taxed lump');
        assert.ok(Math.abs(withBp.taxable - (base.taxable + 500)) < 0.01, 'taxable rises by the gross lump');
        // Projection = recurring hours-only average × employed periods + the one-off lump ONCE
        // (base.entered = 2, employedPeriods = 4). The lump must NOT be extrapolated across the year.
        assert.ok(Math.abs(withBp.projectedNet - ((base.net / 2) * 4 + lumpNet)) < 0.01,
            'lump added once to the projection, not multiplied across periods');
        assert.notEqual(Math.round(withBp.projectedNet), Math.round((withBp.net / 2) * 4),
            'must not extrapolate the lump-inflated per-payslip average');
    });

    // REGRESSION (v18.84): this used to pass a synthetic `{ ...TY, hppPaidJan: 2026 }` — the one
    // value that would fall inside the fixture's own period range — so it was green against a
    // configuration that CANNOT occur. In the real table a year's HPP is paid the January AFTER the
    // year ends (2025/26 → hppPaidJan 2027, a payday outside 2025/26's periods), so the old
    // `payday.getFullYear() === ty.hppPaidJan` lookup never matched for ANY real tax year and the
    // lump was silently dropped from these totals while the result card added it. TY here carries
    // the REALISTIC out-of-range hppPaidJan, so the old lookup would fail this test.
    test('an INCLUDED HPP lump lands on the tax year’s first January payslip', () => {
        _ls.set('myb_pc_p62', JSON.stringify({ otH: 4, otM: 0 }));   // P62 = Jan 2026 (paid: now = 1 Feb)
        const tyReal  = { ...TY, hppPaidJan: 2027 };   // as the real table has it — NOT inside TY's periods
        const base    = computeYearSoFar(tyReal, OPTS);
        const withHpp = computeYearSoFar(tyReal, { ...OPTS, hppLump: { amount: 800 } });
        const lumpNet = mirror({ oHrs: 4, lump: 800 }).net - mirror({ oHrs: 4 }).net;
        assert.ok(lumpNet > 0, 'an £800 gross lump nets something after tax/NI');
        assert.equal(base.entered, 1, 'only P62 is paid + entered');
        assert.ok(Math.abs(withHpp.net - (base.net + lumpNet)) < 0.01, 'HPP joins the January payslip take-home');
        assert.ok(Math.abs(withHpp.taxable - (base.taxable + 800)) < 0.01, 'taxable rises by the gross lump');
    });

    test('an HPP lump is NOT added when the January payslip has no saved hours', () => {
        _ls.set('myb_pc_p60', JSON.stringify({ otH: 4, otM: 0 }));   // P62 (January) deliberately empty
        const base    = computeYearSoFar(TY, OPTS);
        const withHpp = computeYearSoFar(TY, { ...OPTS, hppLump: { amount: 800 } });
        assert.ok(Math.abs(withHpp.net - base.net) < 0.01,
            'an un-entered payslip is excluded wholesale — its lump must not appear on its own');
    });

    // REGRESSION (v18.84): `paid`/`missing` filtered only on "payday has passed", so a mid-year
    // joiner was counted against — and told to fill in — payslips from before they worked here.
    // employedPeriods already applied the pre-start test; the two now agree.
    test('mid-year joiner: pre-start payslips are neither counted nor named as missing', () => {
        _proRate = (/** @type {any} */ p) => (p.num >= 62 ? 1 : 0);   // employed from P62
        const y = computeYearSoFar(TY, OPTS);
        assert.equal(y.paid, 1, 'only P62 is both paid and employed (P60/P61 pre-start, P63 future)');
        assert.deepEqual(y.missing, [P62.payday], 'pre-employment paydays are never named as "not entered yet"');
        assert.ok(!y.missing.some(d => d.getTime() === P60.payday.getTime()), 'P60 predates employment');
        assert.ok(!y.missing.some(d => d.getTime() === P61.payday.getTime()), 'P61 predates employment');
    });
});
