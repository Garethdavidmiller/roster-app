/**
 * Unit tests for paycalc-hpp-schedule.js — the payslip ↔ tax-year relation for the Holiday Pay
 * Premium (v18.85).
 *
 * Run: node scripts/run-tests.mjs paycalc-hpp-schedule.test.mjs   (no mocks — the module is argument-injected)
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
import { readFileSync } from 'node:fs';

import {
    periodsInTaxYear, hppPayslipForTaxYear, hppTaxYearForPayslip, hppPaidInTaxYear,
} from './paycalc-hpp-schedule.js';

// ── The REAL tax-year table, imported ─────────────────────────────────────────────────────────
// TAX_YEARS is imported for real (v18.91), not mirrored. It used to be a hand-copy, which made the
// "round trip against the REAL tax-year table" claim untrue and the test blind to the drift that
// matters most: changing hppPaidJan in paycalc-calc.js left the suite fully green. paycalc-calc.js
// has no imports of its own, so there is no Firebase transitive dep to avoid here.
import { TAX_YEARS } from './paycalc-calc.js';

const TY_25 = TAX_YEARS.find(t => t.label === '2025/26');
const TY_26 = TAX_YEARS.find(t => t.label === '2026/27');
// Fail loudly rather than silently skipping if the table is re-labelled at the April rollover.
assert.ok(TY_25 && TY_26, 'TAX_YEARS must still carry 2025/26 and 2026/27 — update this fixture');

// ── The period grid, READ from paycalc-periods.js (18 Nov 2026) ─────────────────────────────────
// paycalc-periods.js pulls in Firebase transitively, so it cannot be imported into a plain Node test
// — but its CONFIG can be read as text. The grid here used to be a hand-copy of it (anchor, offsets
// −11…14), and a copy ends where the page's list ends: 2026/27's premium, paid in January 2028, was
// never looked for, so changing that year's hppPaidJan left this file green. Now the anchor and the
// offsets are the page's own, built as getPeriods() builds them, and the grid is also run one tax
// year further (BEYOND), which is where every year on record must find the payslip carrying it.
const CONFIG_SRC = (() => {
    const src = readFileSync(new URL('./paycalc-periods.js', import.meta.url), 'utf8');
    return src.slice(src.indexOf('export const CONFIG = {'));
})();
/** A whole-number CONFIG entry, as paycalc-periods.js writes it. @param {string} name */
const configNumber = (name) => {
    const m = CONFIG_SRC.match(new RegExp(`\\b${name}:\\s*(-?\\d+)`));
    assert.ok(m, `paycalc-periods.js CONFIG no longer writes ${name} as a number — re-read this reader`);
    return Number(m[1]);
};
const ANCHOR_ARGS = CONFIG_SRC.match(/\bANCHOR_DATE:\s*new Date\(([\d,\s]+)\)/)?.[1].split(',').map(Number);
assert.ok(ANCHOR_ARGS && ANCHOR_ARGS.length >= 3,
    'paycalc-periods.js CONFIG no longer writes ANCHOR_DATE as new Date(y, m, d, …) — re-read this reader');
const ANCHOR = new Date(...ANCHOR_ARGS);
const PERIOD_DAYS = configNumber('PERIOD_DAYS');
const FIRST_OFFSET = configNumber('FIRST_OFFSET');
// LAST_OFFSET is not a number in the source: it is the last tax year's last payslip, read from the
// table (Nov 2026 debt pass), so a year added to TAX_YEARS is offered without a second edit. This
// reader follows it there — and fails if the page goes back to writing its own figure.
assert.match(CONFIG_SRC, /\bLAST_OFFSET:\s*TAX_YEARS\[TAX_YEARS\.length - 1\]\.last\b/,
    'paycalc-periods.js CONFIG no longer reads LAST_OFFSET from TAX_YEARS — re-read this reader');
const LAST_OFFSET = TAX_YEARS[TAX_YEARS.length - 1].last;
/** The page's payslips from offset `first` to `last`, as getPeriods() builds them.
 *  @param {number} first @param {number} last */
const grid = (first, last) => {
    const out = [];
    for (let offset = first; offset <= last; offset++) {
        const payday = new Date(ANCHOR);
        payday.setDate(payday.getDate() + offset * PERIOD_DAYS);
        out.push({ num: 48 + offset, payday });
    }
    return out;
};
const PERIODS = grid(FIRST_OFFSET, LAST_OFFSET);        // the payslips the page offers today
const BEYOND  = grid(FIRST_OFFSET, LAST_OFFSET + 13);   // and the following tax year's thirteen

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
        // The LAST tax year on record is paid in the January after the page's last payslip (2026/27's
        // in January 2028, past a grid that ends in March 2027): until the April rollover extends the
        // grid there is no payslip to name.
        const lastTy = TAX_YEARS[TAX_YEARS.length - 1];
        assert.ok(PERIODS[PERIODS.length - 1].payday < new Date(lastTy.hppPaidJan, 0, 1),
            `premise: the page's grid ends before January ${lastTy.hppPaidJan}`);
        assert.equal(hppPayslipForTaxYear(lastTy, PERIODS), null);
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
    test("the grid is the page's own: 13 payslips for every tax year on record, num 48 on the anchor", () => {
        assert.equal(PERIODS.length, LAST_OFFSET - FIRST_OFFSET + 1);
        assert.equal(PERIODS.find(p => p.num === 48)?.payday.getTime(), ANCHOR.getTime());
        for (const ty of TAX_YEARS) assert.equal(periodsInTaxYear(ty, PERIODS).length, 13, ty.label);
    });

    test('every tax year on record is paid on the FIRST January payslip after its own thirteen', () => {
        // Invariant 4, asked of each year in turn on the grid run one year on — 2026/27 included, whose
        // January 2028 payslip the page does not list yet. A hppPaidJan a year late finds no payslip
        // there; one a year early lands inside the year's own window.
        for (const ty of TAX_YEARS) {
            const own = periodsInTaxYear(ty, BEYOND);
            const lastOwn = own[own.length - 1].num;
            const firstJan = BEYOND.find(p => p.num > lastOwn && p.num <= lastOwn + 13 && p.payday.getMonth() === 0);
            assert.ok(firstJan, `${ty.label}: premise — the following tax year holds a January payslip`);
            const carrier = hppPayslipForTaxYear(ty, BEYOND);
            assert.ok(carrier, `${ty.label}: hppPaidJan ${ty.hppPaidJan} names a January the following year does not hold`);
            assert.equal(carrier.num, firstJan.num,
                `${ty.label}: its premium is due on the ${firstJan.payday.toDateString()} payslip`);
            assert.equal(hppTaxYearForPayslip(carrier, BEYOND, TAX_YEARS), ty, `${ty.label}: and that payslip names it back`);
        }
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
