// @ts-check
// @lane hygiene
/**
 * paycalc-current-year.test.mjs — the tax year staff are actually being paid in.
 *
 * ── WHY THIS EXISTS, AND THE MEASUREMENT THAT PROMPTED IT ──────────────────────────────────────
 *
 * The repo's pay-maths safety net is thirteen of a colleague's REAL payslips. They run
 * 2025-04-11 → 2026-03-13: the complete 2025/26 year, every period. That is an unusually strong
 * anchor — and it covers a year that has ENDED.
 *
 * Measured 16 Sep 2026, during a deep review: changing the 2026/27 personal allowance by £50/year
 * — a figure inside every estimate a member sees today — left the WHOLE estate green:
 *
 *     npm test  →  3209 + 1 + 1918 passed, 0 failed
 *
 * No payslip covers 2026/27, and nothing pinned its constants, so the current year's arithmetic was
 * verified only by the calculator agreeing with itself. `npm run test:payslip-local` did not help:
 * its green means the real comparison ran — against LAST year.
 *
 * ── WHAT MAKES THIS MORE THAN A TAUTOLOGY ──────────────────────────────────────────────────────
 *
 * A test that reads a constant and asserts it equals itself proves nothing. This one is built on
 * the FREEZE instead, which is a real, checkable relationship:
 *
 *     2025/26 is anchored by thirteen real payslips.
 *     The Westminster freeze (Autumn 2024 Budget, extended Autumn 2025 to Apr 2031) says the
 *     rUK personal allowance and higher/additional thresholds do NOT move.
 *     Therefore specific 2026/27 values MUST EQUAL their payslip-verified 2025/26 counterparts.
 *
 * So the equality assertions below carry evidence from real payslips into the current year. That is
 * the half of this file that can catch a WRONG figure, not merely a CHANGED one.
 *
 * ── AND WHAT IT HONESTLY CANNOT DO ─────────────────────────────────────────────────────────────
 *
 * Some figures no payslip on record can vouch for, in EITHER year, so the freeze carries no evidence
 * into them: every Scottish band and rate (set annually by the Scottish Budget, and no payslip on
 * record carries a Scottish code — VALIDATION_REGISTER.md, VAL-PAY-006), Plan 4 and the
 * Postgraduate Loan (no payslip on record deducts either), and the student-loan thresholds uprated
 * each April. Those are pinned as LITERALS, each beside the published table it was read from and a
 * note that it is published-source only. A literal lock is a CHANGE-DETECTOR, not a truth-oracle: it
 * cannot tell you the published figure is right, only that nobody altered it without coming here,
 * reading the source line, and re-checking it deliberately. That is the whole intent — the failure
 * it prevents is a silent edit, which is exactly what the mutation demonstrated.
 *
 * A comparison between the two years is NOT such a lock, and Scotland once leaned on one: the
 * Scottish tests asserted only that the current year's upper tops EQUAL the anchored year's, so a
 * top wrong in both years passed — and the Advanced top was, written in income space (£112,570)
 * where HMRC's table says £125,140 of taxable pay (17 Nov 2026). Every figure below was read against
 * GOV.UK's "Rates and thresholds for employers" pages for 2025 to 2026 and 2026 to 2027 that day.
 *
 * WHEN A NEW TAX YEAR ARRIVES this file fails, loudly, because `CURRENT` must be the newest entry in
 * TAX_YEARS — which is the point: the new year's figures want checking against the published tables,
 * not inheriting. (Until 7 Nov 2026 `CURRENT` was only a literal, so this sentence was not true.)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { TAX_BY_YEAR, NI_BY_YEAR, SL_BY_YEAR, SCOTTISH_TAX_BY_YEAR, P_YR, TAX_YEARS } from '../paycalc-calc.js';

/** The year every live estimate uses. Bump deliberately, with the tables open. */
const CURRENT = '2026/27';
/** The year the thirteen real payslips cover — the evidence the freeze carries forward. */
const ANCHORED = '2025/26';

/** Annual £ → the 4-weekly figure the tables store, so assertions read in real money. */
const perPeriod = (/** @type {number} */ annual) => annual / P_YR;

const TABLES = /** @type {[string, Record<string, any>][]} */ ([
    ['TAX_BY_YEAR', TAX_BY_YEAR], ['NI_BY_YEAR', NI_BY_YEAR],
    ['SL_BY_YEAR', SL_BY_YEAR], ['SCOTTISH_TAX_BY_YEAR', SCOTTISH_TAX_BY_YEAR],
]);

describe('a NEW tax year cannot arrive without coming through this file', () => {
    // The header promised that a new tax year fails this file loudly. It could not: CURRENT was a
    // literal, so adding 2027/28 to TAX_YEARS with no tax, NI, student-loan or Scottish entries at
    // all left every test here passing (test audit, 7 Nov 2026) — and the estimate priced the new
    // year quietly on 2025/26's tables. These two read TAX_YEARS itself, so the promise now holds.
    test('CURRENT is the newest tax year the app is configured for', () => {
        const newest = TAX_YEARS[TAX_YEARS.length - 1].label;
        assert.equal(newest, CURRENT,
            `TAX_YEARS now ends at ${newest}: check its figures against the published tables, then move CURRENT here`);
    });

    test('every configured tax year has an entry in all four tables', () => {
        for (const ty of TAX_YEARS) {
            for (const [name, table] of TABLES) {
                assert.ok(table[ty.label], `${name} has no ${ty.label} entry — that year would silently be priced on another's`);
            }
        }
    });
});

describe('the current tax year is present at all', () => {
    test('every table carries an entry for it — a missing one silently falls back a year', () => {
        // `getThresholds` (paycalc-calc.js) warns and uses 2025/26 when a table lacks the year. A console warning in a
        // browser nobody is watching is not a control: the member still gets a number, and it is
        // last year's. These four assertions are what stop that being invisible.
        for (const [name, table] of /** @type {[string, Record<string, any>][]} */ ([
            ['TAX_BY_YEAR', TAX_BY_YEAR], ['NI_BY_YEAR', NI_BY_YEAR],
            ['SL_BY_YEAR', SL_BY_YEAR], ['SCOTTISH_TAX_BY_YEAR', SCOTTISH_TAX_BY_YEAR],
        ])) {
            assert.ok(table[CURRENT], `${name} has no ${CURRENT} entry — estimates would silently use ${ANCHORED}`);
        }
    });
});

describe('THE FROZEN FIGURES: real-payslip evidence carried into the current year', () => {
    // These are equalities, not literals. They fail if somebody edits the current year away from a
    // value thirteen payslips confirm — which is precisely the mutation that survived.
    test('rUK: the personal allowance and every threshold are IDENTICAL to the anchored year', () => {
        assert.deepEqual(TAX_BY_YEAR[CURRENT], TAX_BY_YEAR[ANCHORED],
            'the Westminster freeze runs to Apr 2031 — if this legitimately changed, the freeze ended '
            + 'and that is a deliberate edit needing a fresh source, not a silent one');
    });

    test('National Insurance: thresholds and rates are IDENTICAL to the anchored year', () => {
        assert.deepEqual(NI_BY_YEAR[CURRENT], NI_BY_YEAR[ANCHORED],
            'NI was confirmed unchanged for 2026/27 — a difference here is unverified');
    });
});

// ── SCOTLAND: PUBLISHED SOURCE ONLY ─────────────────────────────────────────────────────────────
// No payslip on record carries a Scottish code (VAL-PAY-006), so nothing here is evidence carried
// from a payslip — and comparing one year with the other proves nothing about either. Each band is
// pinned as GOV.UK's employer table prints it: the TOP of its slice of annual TAXABLE pay (pay above
// the PAYE threshold), and its rate. The table stores each top ÷ 13.
/** @type {Record<string, [number, number, string][]>} [annual taxable top, rate, band] — every row
 *  published-source only. */
const SCOTTISH_PUBLISHED = {
    // GOV.UK, "Rates and thresholds for employers 2025 to 2026" → Scottish PAYE tax rates and
    // thresholds (read 17 Nov 2026). Published source only — no payslip on record.
    '2025/26': [
        [2827, 0.19, 'Starter'],          // up to £2,827 — published source only
        [14921, 0.20, 'Basic'],           // £2,828 to £14,921 — published source only
        [31092, 0.21, 'Intermediate'],    // £14,922 to £31,092 — published source only
        [62430, 0.42, 'Higher'],          // £31,093 to £62,430 — published source only
        [125140, 0.45, 'Advanced'],       // £62,431 to £125,140 — published source only
        [Infinity, 0.48, 'Top'],          // above £125,140 — published source only
    ],
    // GOV.UK, "Rates and thresholds for employers 2026 to 2027" → Scottish PAYE tax rates and
    // thresholds (read 17 Nov 2026; the Scottish Budget 2026/27 uprated Starter and Basic only).
    // Published source only — no payslip on record.
    '2026/27': [
        [3967, 0.19, 'Starter'],          // up to £3,967 — published source only
        [16956, 0.20, 'Basic'],           // £3,968 to £16,956 — published source only
        [31092, 0.21, 'Intermediate'],    // £16,957 to £31,092 — published source only
        [62430, 0.42, 'Higher'],          // £31,093 to £62,430 — published source only
        [125140, 0.45, 'Advanced'],       // £62,431 to £125,140 — published source only
        [Infinity, 0.48, 'Top'],          // above £125,140 — published source only
    ],
};

describe('SCOTLAND: every band and rate, as published — no payslip evidence exists', () => {
    for (const [year, rows] of Object.entries(SCOTTISH_PUBLISHED)) {
        test(`${year}: each band's taxable top and rate is the published one`, () => {
            const bands = SCOTTISH_TAX_BY_YEAR[year].bands;
            assert.equal(bands.length, rows.length, `${year}: the band COUNT changed — that is a structural change`);
            rows.forEach(([top, rate, name], i) => {
                assert.equal(bands[i].top, top === Infinity ? Infinity : perPeriod(top), `${year} ${name} top`);
                assert.equal(bands[i].rate, rate, `${year} ${name} rate`);
            });
        });
    }

    test('the Advanced top is £125,140 of TAXABLE pay — never £125,140 less the allowance', () => {
        // The income-space figure (£112,570) is the mistake the rUK branch of computeTax already
        // corrected for its 45% band, and Scotland carried until 17 Nov 2026.
        for (const year of Object.keys(SCOTTISH_PUBLISHED)) {
            assert.notEqual(SCOTTISH_TAX_BY_YEAR[year].bands[4].top, perPeriod(125140 - 12570), year);
        }
    });

    test('the personal allowance is Westminster-set, so it is frozen too', () => {
        assert.equal(SCOTTISH_TAX_BY_YEAR[CURRENT].pa, SCOTTISH_TAX_BY_YEAR[ANCHORED].pa);
        assert.equal(SCOTTISH_TAX_BY_YEAR[CURRENT].pa, TAX_BY_YEAR[CURRENT].pa,
            'the Scottish table must not carry a different personal allowance from the rUK one');
    });

    test('consistency, not evidence: only Starter and Basic moved between the two years', () => {
        // The Scottish Budget 2026/27 uprated Starter and Basic and held the rest. This catches an
        // edit to the wrong row of ONE year; the literals above are what catch a figure wrong in both.
        const cur = SCOTTISH_TAX_BY_YEAR[CURRENT].bands;
        const anc = SCOTTISH_TAX_BY_YEAR[ANCHORED].bands;
        for (const i of [2, 3, 4, 5]) {
            assert.equal(cur[i].top, anc[i].top,
                `Scottish band ${i} (0-indexed) moved; only Starter (0) and Basic (1) were uprated for ${CURRENT}`);
        }
        assert.ok(cur[0].top > anc[0].top, 'Starter should have been uprated upward');
        assert.ok(cur[1].top > anc[1].top, 'Basic should have been uprated upward');
        assert.deepEqual(cur.map((/** @type {any} */ b) => b.rate), anc.map((/** @type {any} */ b) => b.rate),
            'a rate change is a Budget event, not an edit');
    });
});

describe('THE UPRATED FIGURES: literals, pinned to their published source', () => {
    // Honest framing: these catch a silent edit, not a wrong source. See the header.
    test('Plan 4 and the Postgraduate Loan, both years — published source only', () => {
        // No payslip on record deducts either, so none of these six figures is payslip-evidenced.
        // GOV.UK, "Rates and thresholds for employers 2025 to 2026" (read 17 Nov 2026):
        assert.equal(SL_BY_YEAR[ANCHORED].plan4.t, perPeriod(32745));     // Plan 4 £32,745 — published source only
        assert.equal(SL_BY_YEAR[ANCHORED].plan4.r, 0.09);                 // Plan 4 9% — published source only
        assert.equal(SL_BY_YEAR[ANCHORED].postgrad.t, perPeriod(21000));  // Postgraduate £21,000 — published source only
        assert.equal(SL_BY_YEAR[ANCHORED].postgrad.r, 0.06);              // Postgraduate 6% — published source only
        // GOV.UK, "Rates and thresholds for employers 2026 to 2027" (read 17 Nov 2026):
        assert.equal(SL_BY_YEAR[CURRENT].plan4.t, perPeriod(33795));      // Plan 4 £33,795 — published source only
        assert.equal(SL_BY_YEAR[CURRENT].plan4.r, 0.09);                  // Plan 4 9% — published source only
        assert.equal(SL_BY_YEAR[CURRENT].postgrad.t, perPeriod(21000));   // Postgraduate £21,000 — published source only
        assert.equal(SL_BY_YEAR[CURRENT].postgrad.r, 0.06);               // Postgraduate 6% — published source only
    });

    test('the five student-loan thresholds match HMRC SL3 2026-27', () => {
        const sl = SL_BY_YEAR[CURRENT];
        assert.equal(sl.plan1.t,    perPeriod(26900));
        assert.equal(sl.plan2.t,    perPeriod(29385));
        assert.equal(sl.plan4.t,    perPeriod(33795));
        assert.equal(sl.plan5.t,    perPeriod(25000));
        assert.equal(sl.postgrad.t, perPeriod(21000));
    });

    test('Plan 5 becomes repayable in the current year and Plan 1/2/4 keep the 9% rate', () => {
        // Plan 5 is deliberately ABSENT from 2025/26 (repayments began 6 Apr 2026). Its arrival is a
        // real behavioural difference between the two years, so it is pinned rather than assumed.
        assert.equal(SL_BY_YEAR[ANCHORED].plan5, undefined,
            'Plan 5 must stay absent for 2025/26 — computeSL returns 0 for it there, by design');
        for (const plan of ['plan1', 'plan2', 'plan4', 'plan5']) {
            assert.equal(SL_BY_YEAR[CURRENT][plan].r, 0.09, `${plan} rate`);
        }
        assert.equal(SL_BY_YEAR[CURRENT].postgrad.r, 0.06);
    });
});

describe('structural sanity a wrong figure would break', () => {
    test('Scottish band tops ascend, and the last is open-ended', () => {
        const bands = SCOTTISH_TAX_BY_YEAR[CURRENT].bands;
        for (let i = 1; i < bands.length; i++) {
            assert.ok(bands[i].top > bands[i - 1].top,
                `band ${i} top (${bands[i].top}) must exceed band ${i - 1}'s — a transposed pair taxes the wrong slice`);
        }
        assert.equal(bands[bands.length - 1].top, Infinity, 'the top band must be open-ended');
    });

    test('the rUK basic-rate threshold sits below the additional-rate one', () => {
        assert.ok(TAX_BY_YEAR[CURRENT].b < TAX_BY_YEAR[CURRENT].h);
        assert.ok(TAX_BY_YEAR[CURRENT].pa < TAX_BY_YEAR[CURRENT].b);
    });

    test('NI primary threshold sits below the upper earnings limit', () => {
        assert.ok(NI_BY_YEAR[CURRENT].pt < NI_BY_YEAR[CURRENT].uel);
    });
});
