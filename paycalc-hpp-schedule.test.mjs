/**
 * Unit tests for paycalc-hpp-schedule.js — the payslip ↔ tax-year relation for the Holiday Pay
 * Premium (v18.85).
 *
 * Run: node --test paycalc-hpp-schedule.test.mjs   (no mocks — the module is argument-injected)
 *
 * The headline case is the ROUND TRIP against the REAL tax-year table and the REAL period grid:
 * asking "which payslip carries this year's premium?" and then "whose premium does that payslip
 * carry?" must return the year you started with. That invariant is precisely what four hand-rolled
 * copies of this rule failed to hold — one of them searched for a year's hppPaidJan among that
 * year's OWN paydays, which can never match, so "This tax year so far" silently dropped every
 * opted-in premium (v18.84). This test fails against that derivation.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
    periodsInTaxYear, hppPayslipForTaxYear, hppTaxYearForPayslip, hppPaidInTaxYear,
} from './paycalc-hpp-schedule.js';

// ── The REAL grid + table, rebuilt here (importing paycalc-periods pulls in Firebase) ──────────
// Mirrors paycalc-periods.js CONFIG: anchor 13 Feb 2026 = num 48, 28-day periods, offsets −11…14.
const ANCHOR = new Date(2026, 1, 13, 12, 0, 0);
const PERIODS = [];
for (let offset = -11; offset <= 14; offset++) {
    const payday = new Date(ANCHOR);
    payday.setDate(payday.getDate() + offset * 28);
    PERIODS.push({ num: 48 + offset, payday });
}
// Mirrors paycalc-calc.js TAX_YEARS (label/first/last/hppPaidJan — the fields this module reads).
const TY_25 = { label: '2025/26', first: -11, last: 1,  hppPaidJan: 2027 };
const TY_26 = { label: '2026/27', first: 2,   last: 14, hppPaidJan: 2028 };
const TAX_YEARS = [TY_25, TY_26];

describe('periodsInTaxYear', () => {
    test('returns the year’s own 13 payslips, in payday order', () => {
        const ps = periodsInTaxYear(TY_25, PERIODS);
        assert.equal(ps.length, 13);
        assert.equal(ps[0].payday.getFullYear(), 2025);
        assert.equal(ps[0].payday.getMonth(), 3, 'first payslip is April');
        assert.ok(ps.every((p, i) => i === 0 || p.payday >= ps[i - 1].payday), 'ascending');
    });
    test('the two tax years do not overlap', () => {
        const a = periodsInTaxYear(TY_25, PERIODS).map(p => p.num);
        const b = periodsInTaxYear(TY_26, PERIODS).map(p => p.num);
        assert.equal(a.filter(n => b.includes(n)).length, 0);
    });
    test('tolerates junk', () => {
        assert.deepEqual(periodsInTaxYear(null, PERIODS), []);
        assert.deepEqual(periodsInTaxYear(TY_25, null), []);
    });
});

describe('hppPayslipForTaxYear', () => {
    test('a year’s premium is carried by a January payslip OUTSIDE that year’s own window', () => {
        const carrier = hppPayslipForTaxYear(TY_25, PERIODS);
        assert.ok(carrier, '2025/26 has a carrier in the grid');
        assert.equal(carrier.payday.getFullYear(), 2027);
        assert.equal(carrier.payday.getMonth(), 0, 'January');
        // THE TRAP: it is NOT one of 2025/26's own payslips.
        const own = periodsInTaxYear(TY_25, PERIODS).map(p => p.num);
        assert.ok(!own.includes(carrier.num),
            'the carrier belongs to the FOLLOWING tax year — searching a year’s own paydays never finds it');
    });
    test('returns null when the grid does not reach that January yet', () => {
        // 2026/27's premium is paid in January 2028; the current grid ends March 2027.
        assert.equal(hppPayslipForTaxYear(TY_26, PERIODS), null);
    });
    test('tolerates junk', () => {
        assert.equal(hppPayslipForTaxYear(null, PERIODS), null);
        assert.equal(hppPayslipForTaxYear({}, PERIODS), null, 'no hppPaidJan');
        assert.equal(hppPayslipForTaxYear(TY_25, null), null);
    });
});

describe('hppTaxYearForPayslip', () => {
    test('the January 2027 payslip carries 2025/26’s premium', () => {
        const jan27 = PERIODS.find(p => p.payday.getFullYear() === 2027 && p.payday.getMonth() === 0);
        assert.equal(hppTaxYearForPayslip(jan27, PERIODS, TAX_YEARS), TY_25);
    });
    test('the January 2026 payslip carries nothing (2024/25 is not in the table)', () => {
        const jan26 = PERIODS.find(p => p.payday.getFullYear() === 2026 && p.payday.getMonth() === 0);
        assert.equal(hppTaxYearForPayslip(jan26, PERIODS, TAX_YEARS), null);
    });
    test('a non-January payslip never carries a premium', () => {
        for (const p of PERIODS.filter(x => x.payday.getMonth() !== 0)) {
            assert.equal(hppTaxYearForPayslip(p, PERIODS, TAX_YEARS), null,
                `${p.payday.toDateString()} must not carry HPP`);
        }
    });
    test('only the EARLIEST January payslip carries it when a January holds two paydays', () => {
        const jan = new Date(2027, 0, 1, 12), jan2 = new Date(2027, 0, 29, 12);
        const grid = [{ num: 900, payday: jan }, { num: 901, payday: jan2 }];
        assert.equal(hppTaxYearForPayslip(grid[0], grid, TAX_YEARS), TY_25, 'first January payslip carries it');
        assert.equal(hppTaxYearForPayslip(grid[1], grid, TAX_YEARS), null, 'the second must NOT add it again');
    });
    test('tolerates junk', () => {
        assert.equal(hppTaxYearForPayslip(null, PERIODS, TAX_YEARS), null);
        assert.equal(hppTaxYearForPayslip(PERIODS[0], PERIODS, null), null);
    });
});

describe('hppPaidInTaxYear', () => {
    test('the premium paid INSIDE 2026/27 is the PRIOR year’s (2025/26), not its own', () => {
        const paid = hppPaidInTaxYear(TY_26, PERIODS, TAX_YEARS);
        assert.ok(paid, '2026/27 contains a January payslip');
        assert.equal(paid.taxYear, TY_25, 'a year’s own premium is NEVER paid inside its own window');
        assert.notEqual(paid.taxYear, TY_26);
        const own = periodsInTaxYear(TY_26, PERIODS).map(p => p.num);
        assert.ok(own.includes(paid.payslip.num), 'but the carrying payslip IS one of this year’s');
    });
    test('2025/26 contains a January payslip that carries nothing we know about', () => {
        // Its January 2026 payslip would carry 2024/25's premium — a year absent from the table.
        assert.equal(hppPaidInTaxYear(TY_25, PERIODS, TAX_YEARS), null);
    });
    test('null when the window holds no January payslip at all', () => {
        const springOnly = PERIODS.filter(p => p.payday.getMonth() >= 3 && p.payday.getMonth() <= 8);
        assert.equal(hppPaidInTaxYear(TY_26, springOnly, TAX_YEARS), null);
    });
});

describe('the two directions are inverses (the v18.84 regression guard)', () => {
    test('carrier → tax year → carrier round-trips for every tax year the grid covers', () => {
        let checked = 0;
        for (const ty of TAX_YEARS) {
            const carrier = hppPayslipForTaxYear(ty, PERIODS);
            if (!carrier) continue;                 // grid doesn't reach it yet — nothing to assert
            checked++;
            assert.equal(hppTaxYearForPayslip(carrier, PERIODS, TAX_YEARS), ty,
                `${ty.label}: the payslip carrying its premium must report it back`);
        }
        assert.ok(checked > 0, 'at least one tax year must be exercised, or this guard proves nothing');
    });
    test('hppPaidInTaxYear agrees with hppPayslipForTaxYear', () => {
        for (const ty of TAX_YEARS) {
            const paid = hppPaidInTaxYear(ty, PERIODS, TAX_YEARS);
            if (!paid) continue;
            assert.equal(hppPayslipForTaxYear(paid.taxYear, PERIODS).num, paid.payslip.num,
                'the year named must be the one whose carrier is that payslip');
        }
    });
});
