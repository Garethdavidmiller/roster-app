// @ts-check
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
 * Two sets of current-year figures are NOT frozen and cannot be derived from anything the repo can
 * verify: the Scottish Starter/Basic band tops (set annually by the Scottish Budget, uprated +7.4%
 * for 2026/27) and the five student-loan thresholds (uprated annually, HMRC SL3). Those are pinned
 * as LITERALS with their source named. A literal lock is a CHANGE-DETECTOR, not a truth-oracle: it
 * cannot tell you the published figure is right, only that nobody altered it without coming here,
 * reading the source line, and re-checking it deliberately. That is the whole intent — the failure
 * it prevents is a silent edit, which is exactly what the mutation demonstrated.
 *
 * WHEN A NEW TAX YEAR ARRIVES this file fails, loudly, on `CURRENT` — which is the point: the new
 * year's figures want checking against the published tables, not inheriting.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { TAX_BY_YEAR, NI_BY_YEAR, SL_BY_YEAR, SCOTTISH_TAX_BY_YEAR, P_YR } from './paycalc-calc.js';

/** The year every live estimate uses. Bump deliberately, with the tables open. */
const CURRENT = '2026/27';
/** The year the thirteen real payslips cover — the evidence the freeze carries forward. */
const ANCHORED = '2025/26';

/** Annual £ → the 4-weekly figure the tables store, so assertions read in real money. */
const perPeriod = (/** @type {number} */ annual) => annual / P_YR;

describe('the current tax year is present at all', () => {
    test('every table carries an entry for it — a missing one silently falls back a year', () => {
        // `resolveYear` warns and uses 2025/26 when a table lacks the year. A console warning in a
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

    test('Scotland: the personal allowance is Westminster-set, so it is frozen too', () => {
        assert.equal(SCOTTISH_TAX_BY_YEAR[CURRENT].pa, SCOTTISH_TAX_BY_YEAR[ANCHORED].pa);
        assert.equal(SCOTTISH_TAX_BY_YEAR[CURRENT].pa, TAX_BY_YEAR[CURRENT].pa,
            'the Scottish table must not carry a different personal allowance from the rUK one');
    });

    test('Scotland: the four UPPER band tops are frozen, and only the lower two were uprated', () => {
        // The Scottish Budget 2026/27 uprated Starter and Basic and held the rest. Pinning WHICH
        // bands moved is the part that catches an edit to the wrong row — a mistake that would
        // otherwise look exactly like the legitimate uprating.
        const cur = SCOTTISH_TAX_BY_YEAR[CURRENT].bands;
        const anc = SCOTTISH_TAX_BY_YEAR[ANCHORED].bands;
        assert.equal(cur.length, anc.length, 'the band COUNT changed — that is a structural change');
        for (const i of [2, 3, 4, 5]) {
            assert.equal(cur[i].top, anc[i].top,
                `Scottish band ${i} (0-indexed) moved; only Starter (0) and Basic (1) were uprated for ${CURRENT}`);
        }
        assert.ok(cur[0].top > anc[0].top, 'Starter should have been uprated upward');
        assert.ok(cur[1].top > anc[1].top, 'Basic should have been uprated upward');
    });

    test('every rate is unchanged in both regimes — a rate change is a Budget event, not an edit', () => {
        assert.deepEqual(
            SCOTTISH_TAX_BY_YEAR[CURRENT].bands.map((/** @type {any} */ b) => b.rate),
            SCOTTISH_TAX_BY_YEAR[ANCHORED].bands.map((/** @type {any} */ b) => b.rate));
    });
});

describe('THE UPRATED FIGURES: literals, pinned to their published source', () => {
    // Honest framing: these catch a silent edit, not a wrong source. See the header.
    test('Scottish Starter and Basic tops match the Scottish Budget 2026/27', () => {
        // gov.scot rates & bands: Starter to £16,537, Basic to £29,526. Stored as TAXABLE tops,
        // i.e. the total-income threshold minus the £12,570 personal allowance.
        assert.equal(SCOTTISH_TAX_BY_YEAR[CURRENT].bands[0].top, perPeriod(16537 - 12570));
        assert.equal(SCOTTISH_TAX_BY_YEAR[CURRENT].bands[1].top, perPeriod(29526 - 12570));
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
