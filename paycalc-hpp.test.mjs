/**
 * Unit tests for the three pure exports of paycalc-hpp.js:
 *   isDataEmpty, _decodeHours, _varPayForPeriod
 *
 * Run: node --experimental-test-module-mocks --test paycalc-hpp.test.mjs
 *
 * DOM-dependent functions (calcHPP, updatePriorHpp) are not tested here;
 * they require a live DOM and belong in a Playwright smoke suite (item 7).
 *
 * Mock strategy:
 *   paycalc-periods.js   — mocked with controllable hasBankHoliday/hasBoxingDay flags
 *   paycalc-settings.js  — mocked: getEffectiveContr→140, getProRateFactor→1
 *   ls.js / roster-data.js — mocked (no Firebase transitive deps)
 *   paycalc-calc.js / paycalc-migrations.js — imported real (pure, no Firebase)
 */
import { test, describe, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { RATE_125, RATE_150, RATE_300 } from './paycalc-calc.js';

// ── Mock-controllable state ───────────────────────────────────────────────────

const _ls = new Map();
let _hasBankHolidayVal = false;
let _hasBoxingDayVal   = false;
let _proRateFactorVal  = 1;

mock.module('./paycalc-periods.js', {
    namedExports: {
        hasBankHoliday:   () => _hasBankHolidayVal,
        hasBoxingDay:     () => _hasBoxingDayVal,
        getPeriods:       () => [],
        currentPeriodNum: () => 48,
        isTaxYearVisible: () => true,   // new-starter clamp — default visible; updatePriorHpp gates on it
        CONFIG:           { TAX_YEARS: [] },
    },
});

mock.module('./paycalc-settings.js', {
    namedExports: {
        getGrade:          () => 'cea',
        getLoggedMember:   () => null,
        getEffectiveContr: () => 140,
        getProRateFactor:  () => _proRateFactorVal,
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
        teamMembers:     [],   // paycalc-migrations.js imports this for member-slug classification
    },
});

const { isDataEmpty, _decodeHours, _varPayForPeriod } = await import('./paycalc-hpp.js');

// ── Helpers ───────────────────────────────────────────────────────────────────

function reset() {
    _ls.clear();
    _hasBankHolidayVal = false;
    _hasBoxingDayVal   = false;
    _proRateFactorVal  = 1;
}

/**
 * Period 50 (2026/27): payday Apr 10 2026.
 * No London Allowance pre/post split in 2026/27 → always 276.16.
 */
function makeP50() {
    return { start: new Date(2026, 2, 13), cutoff: new Date(2026, 3, 9),
             payday: new Date(2026, 3, 10), num: 50 };
}

/** Asserts actual is within £0.005 of expected (half a penny). */
function assertPounds(actual, expected, msg) {
    assert.ok(Math.abs(actual - expected) < 0.005,
        `${msg ?? ''}: expected £${expected.toFixed(2)}, got £${actual.toFixed(2)}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// isDataEmpty
// ─────────────────────────────────────────────────────────────────────────────

describe('isDataEmpty', () => {
    test('returns true for a fully empty object {}', () => {
        assert.ok(isDataEmpty({}));
    });

    test('returns true when all fields are 0 / false (falsy)', () => {
        assert.ok(isDataEmpty({ satH: 0, satM: 0, bhH: 0, bhM: 0, bhOtH: 0, bhOtM: 0,
            otH: 0, otM: 0, rdwH: 0, rdwM: 0, sunH: 0, sunM: 0,
            boxH: 0, boxM: 0, peer: 0, slSkip: false, otherAdj: 0 }));
    });

    test('returns false when satH is non-zero', () => {
        assert.equal(isDataEmpty({ satH: 8 }), false);
    });

    test('returns false when peer training flag is set', () => {
        assert.equal(isDataEmpty({ peer: 1 }), false);
    });

    test('returns false when slSkip is true', () => {
        assert.equal(isDataEmpty({ slSkip: true }), false);
    });

    test('returns false when otherAdj is non-zero', () => {
        assert.equal(isDataEmpty({ otherAdj: 50 }), false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// _decodeHours
// ─────────────────────────────────────────────────────────────────────────────

describe('_decodeHours', () => {
    beforeEach(reset);

    test('zeros bhHrs and bhOtHrs when hasBankHoliday is false', () => {
        _hasBankHolidayVal = false;
        const h = _decodeHours(makeP50(), { bhH: 4, bhM: 0, bhOtH: 2, bhOtM: 0 });
        assert.equal(h.bhHrs,   0, 'bhHrs should be 0');
        assert.equal(h.bhOtHrs, 0, 'bhOtHrs should be 0');
    });

    test('passes bhHrs and bhOtHrs through when hasBankHoliday is true', () => {
        _hasBankHolidayVal = true;
        const h = _decodeHours(makeP50(), { bhH: 4, bhM: 0, bhOtH: 2, bhOtM: 0 });
        assert.equal(h.bhHrs,   4, 'bhHrs should be 4');
        assert.equal(h.bhOtHrs, 2, 'bhOtHrs should be 2');
    });

    test('zeros boxHrs when hasBoxingDay is false', () => {
        _hasBoxingDayVal = false;
        const h = _decodeHours(makeP50(), { boxH: 2, boxM: 30 });
        assert.equal(h.boxHrs, 0, 'boxHrs should be 0');
    });

    test('passes boxHrs (including minutes) when hasBoxingDay is true', () => {
        _hasBoxingDayVal = true;
        const h = _decodeHours(makeP50(), { boxH: 2, boxM: 30 });
        assert.ok(Math.abs(h.boxHrs - 2.5) < 0.001, `expected 2.5, got ${h.boxHrs}`);
    });

    test('converts satM minutes to fractional hours', () => {
        const h = _decodeHours(makeP50(), { satH: 7, satM: 30 });
        assert.ok(Math.abs(h.satHrs - 7.5) < 0.001, `expected 7.5, got ${h.satHrs}`);
    });

    test('returns zero for all fields when data object is empty', () => {
        const h = _decodeHours(makeP50(), {});
        assert.equal(h.satHrs, 0);
        assert.equal(h.otHrs,  0);
        assert.equal(h.rdwHrs, 0);
        assert.equal(h.sunHrs, 0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// _varPayForPeriod — P50 (2026/27), rate = 20.74, effContr = 140, proRate = 1
//   London Allowance 2026/27 = 276.16 (no mid-year split)
// ─────────────────────────────────────────────────────────────────────────────

describe('_varPayForPeriod', () => {
    beforeEach(reset);

    const RATE   = 20.74;
    const LONDON = 276.16;                     // 2026/27 London Allowance (no split)
    const SAT_UP = RATE * (RATE_125 - 1);      // 5.185/hr — premium above base only
    const R125   = RATE * RATE_125;            // 25.925/hr
    const R150   = RATE * RATE_150;            // 31.110/hr
    const R300   = RATE * RATE_300;            // 62.220/hr

    test('returns London Allowance only when all hours are zero', () => {
        assertPounds(_varPayForPeriod(makeP50(), {}, RATE), LONDON, 'zero hours');
    });

    test('prices London at the SETTLED value for a PRE-AWARD period of a split year (v16.90)', () => {
        // 2025/26 spans offsets [-11, 1] and has a mid-year London step (londonAllowFrom 24 Oct 2025:
        // 267.08 → 276.16). Period 44 (offset -4) has a pre-award payday (15 May 2025). Before v16.90
        // _varPayForPeriod priced London period-aware → the OLD 267.08 for this pre-award period, while
        // pricing the RATE settled-whole-year — a mismatch that under-counted the pre-award London
        // uplift in the HPP. It now prices London settled-whole-year too: 276.16 regardless of payday.
        const preAwardP = { start: new Date(2025, 3, 20), cutoff: new Date(2025, 4, 14),
                            payday: new Date(2025, 4, 15), num: 44 };
        assertPounds(_varPayForPeriod(preAwardP, {}, 20.06), 276.16,
            'pre-award split-year London must be the settled 276.16, not the old 267.08');
    });

    test('adds Saturday uplift (premium only, not full 1.25× rate)', () => {
        // satCapped=8, normHrs=132, bhCapped=0
        assertPounds(
            _varPayForPeriod(makeP50(), { satH: 8 }, RATE),
            8 * SAT_UP + LONDON, '8 sat hrs');
    });

    test('adds OT at r125', () => {
        assertPounds(
            _varPayForPeriod(makeP50(), { otH: 4 }, RATE),
            4 * R125 + LONDON, '4 OT hrs');
    });

    test('adds RDW at r125', () => {
        assertPounds(
            _varPayForPeriod(makeP50(), { rdwH: 4 }, RATE),
            4 * R125 + LONDON, '4 RDW hrs');
    });

    test('adds Sunday at r150', () => {
        assertPounds(
            _varPayForPeriod(makeP50(), { sunH: 3 }, RATE),
            3 * R150 + LONDON, '3 Sun hrs');
    });

    test('adds Boxing Day at r300 when hasBoxingDay is true', () => {
        _hasBoxingDayVal = true;
        assertPounds(
            _varPayForPeriod(makeP50(), { boxH: 2 }, RATE),
            2 * R300 + LONDON, '2 Boxing hrs');
    });

    test('excludes Boxing Day hours when hasBoxingDay is false', () => {
        _hasBoxingDayVal = false;
        assertPounds(
            _varPayForPeriod(makeP50(), { boxH: 2 }, RATE),
            LONDON, 'boxH ignored when no Boxing Day');
    });

    test('adds BH uplift when hasBankHoliday is true and satHrs < effContr', () => {
        // satHrs=0, satCapped=0, normHrs=140, bhCapped=min(4,140)=4
        _hasBankHolidayVal = true;
        assertPounds(
            _varPayForPeriod(makeP50(), { bhH: 4 }, RATE),
            4 * SAT_UP + LONDON, '4 BH hrs');
    });

    test('BH capped to zero when all contracted hours are Saturday (normHrs = 0)', () => {
        // satHrs=140, satCapped=140, normHrs=0, bhCapped=min(4,0)=0
        // This mirrors the calculate() cap: when Saturday fills the contract,
        // the BH premium is already accounted for in the Saturday rate.
        _hasBankHolidayVal = true;
        assertPounds(
            _varPayForPeriod(makeP50(), { satH: 140, bhH: 4 }, RATE),
            140 * SAT_UP + LONDON, 'BH capped at normHrs=0');
    });

    test('adds BH overtime at r125 when hasBankHoliday is true', () => {
        _hasBankHolidayVal = true;
        assertPounds(
            _varPayForPeriod(makeP50(), { bhOtH: 2 }, RATE),
            2 * R125 + LONDON, '2 bhOt hrs');
    });

    test('pro-rates London Allowance when getProRateFactor returns 0.5', () => {
        _proRateFactorVal = 0.5;
        assertPounds(
            _varPayForPeriod(makeP50(), {}, RATE),
            LONDON * 0.5, 'half London Allowance for joiner');
    });
});
