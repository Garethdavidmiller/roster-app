/**
 * Unit tests for paycalc-hpp.js: the pure exports (_decodeHours, _varPayForPeriod, …; isDataEmpty, from paycalc-format.js)
 * and, against a fake `document`, the card itself — the prior-year block a member reads on the
 * January payslip, and the amount-source state.
 *
 * Run: node --experimental-test-module-mocks scripts/run-tests.mjs test/paycalc-hpp.test.mjs
 *
 * Mock strategy:
 *   paycalc-periods.js   — mocked: controllable hasBankHoliday/hasBoxingDay flags and the viewed
 *                          period; the GRID, the tax years and `payslipMayBeInHand` are the REAL ones
 *                          (loaded through `?real`), so a date a test pins is the app's own date
 *   paycalc-settings.js  — mocked: getEffectiveContr→140, a controllable pro-rate, grade and rate
 *   ls.js / roster-data.js — mocked (no Firebase transitive deps)
 *   paycalc-calc.js / paycalc-migrations.js / paycalc-hpp-schedule.js — imported real (pure)
 */
import { test, describe, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { RATE_125, RATE_150, RATE_300, awardRatesFor, getRateForPeriod as _rateForPeriod, isPreAwardPeriod as _preAward, taxYearForPeriod as _tyOf } from '../paycalc-calc.js';

// Tests live in test/ but address files from the repository root (moved 24 Nov 2026).
const REPO_ROOT_URL = new URL('../', import.meta.url);

// ── Mock-controllable state ───────────────────────────────────────────────────

const _ls = new Map();
let _hasBankHolidayVal = false;
let _hasBoxingDayVal   = false;
/** The joining factor: one figure for every payslip, or a function of the payslip where a test needs the year's
 *  first and last told apart (premiumStillToEstimate). @type {number | ((p: any) => number)} */
let _proRate           = 1;
let _grade             = 'cea';
/** The payslip on screen (`currentPeriodNum`). */
let _viewPNum          = 48;
/** The settled rate the settings module would derive (its real rule: AWARD_RATES by grade). */
let _settledRate = (/** @type {any} */ ty) => awardRatesFor(_grade, ty?.label)?.rate ?? 20.74;

// The real period module, so the grid, the tax years and the in-hand rule are the app's own. It no
// longer reaches Firebase (bhsForYear moved into it, Nov 2026), so nothing stands in for anything.
const _realPeriods = await import('../paycalc-periods.js?real');

mock.module('../paycalc-periods.js', {
    namedExports: {
        hasBankHoliday:   () => _hasBankHolidayVal,
        hasBoxingDay:     () => _hasBoxingDayVal,
        getPeriods:       () => _realPeriods.getPeriods(),
        periodByNum:      _realPeriods.periodByNum,
        currentPeriodNum: () => _viewPNum,
        todaysPeriodNum:  () => _realPeriods.todaysPeriodNum(),
        isTaxYearVisible: () => true,   // new-starter clamp — default visible; updatePriorHpp gates on it
        payslipMayBeInHand: _realPeriods.payslipMayBeInHand,
        CONFIG:           _realPeriods.CONFIG,
    },
});

mock.module('../paycalc-settings.js', {
    namedExports: {
        // One grade for every payslip here (a member who never changed grade); the dated-grade
        // pricing itself is pinned by paycalc-grade.test.mjs and paycalc-settings.test.mjs. These
        // three answer exactly what the real ones answer for such a member.
        awardGrade:        () => _grade,
        periodRate:        (/** @type {any} */ ty, /** @type {any} */ p) => ({
            rate: _rateForPeriod(p, _grade, ty.label, _settledRate(ty)), preAward: _preAward(p, _grade, ty.label) }),
        settledRateFor:    (/** @type {any} */ p, /** @type {any} */ ty) => _settledRate(ty ?? _tyOf(p)),
        getLoggedMember:   () => null,
        getEffectiveContr: () => 140,
        // CONTROLLABLE (test audit, 7 Nov 2026). It was a constant 1, so multiplying any premium in
        // _varPayForPeriod by the joiner's factor was invisible — and invariant 7 (HPP is never
        // pro-rated for a joiner) had nothing behind it. The module still imports it for other work.
        getProRateFactor:  (/** @type {any} */ p) => (typeof _proRate === 'function' ? _proRate(p) : _proRate),
        getPensionDefault: () => 147.36,
        isPensionOptedOut: () => false,
        // Every payslip here is worked under a grade with rates; a refused one is
        // paycalc-grade-wiring.test.mjs's, through the real settings module.
        isPeriodPriced:    () => true,
    },
});

mock.module('../ls.js', {
    namedExports: {
        lsGet:  k      => _ls.has(k) ? _ls.get(k) : null,
        lsSet:  (k, v) => { _ls.set(k, String(v)); },
        lsDel:  k      => { _ls.delete(k); },
        lsKeys: ()     => [..._ls.keys()],
        // The real semantics, not a stub that always succeeds: these mocks back onto a Map
        // that cannot fail, so both simply mirror what ls.js does when storage works.
        lsSetVerified: (/** @type {string} */ k, /** @type {any} */ v) => { _ls.set(k, String(v)); return true; },
        lsMove: (/** @type {string} */ a, /** @type {string} */ b, /** @type {any} */ v) => {
            const val = v === undefined ? (_ls.has(a) ? _ls.get(a) : null) : v;
            if (val === null) return false;
            _ls.set(b, String(val)); _ls.delete(a); return true;
        },
    },
});

// The REAL money parser for `priorHppToStore`: "£1,200" read back as 1 was that rule's whole defect,
// so a stand-in here would test the stand-in.
const { parseSmartFloatOrNull: _realOrNull } = await import('../roster-data.js?real');
mock.module('../roster-data.js', {
    namedExports: {
        formatISO:       /** @param {Date} d */ d =>
            `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`,
        parseSmartFloat: /** @param {any} v */ v => parseFloat(String(v)),
        parseSmartFloatOrNull: _realOrNull,
        teamMembers:     [],   // paycalc-migrations.js imports this for member-slug classification
    },
});

// ── A fake document for the card ──────────────────────────────────────────────
// Every id the card writes, as stubs that RECORD what they were given — a harness that discarded
// writes could not tell "Estimated" from "Your figure", or a locked box from an open one.
/** @type {Record<string, any>} */
const _els = {};
function _node(/** @type {string} */ id) {
    return {
        id, value: '', checked: false, disabled: false, hidden: false, style: /** @type {Record<string,string>} */ ({}),
        _t: '', _h: '',
        classList: {
            _s: new Set(),
            add(/** @type {string} */ c) { this._s.add(c); },
            remove(/** @type {string} */ c) { this._s.delete(c); },
            toggle(/** @type {string} */ c, /** @type {boolean|undefined} */ on) {
                const want = on === undefined ? !this._s.has(c) : !!on;
                if (want) this._s.add(c); else this._s.delete(c);
                return want;
            },
            contains(/** @type {string} */ c) { return this._s.has(c); },
        },
        set textContent(v) { this._t = String(v); this._h = ''; },
        get textContent() { return this._t || this._h.replace(/<[^>]+>/g, ''); },
        set innerHTML(v) { this._h = String(v); this._t = ''; },
        get innerHTML() { return this._h || this._t; },
    };
}
const _CARD_IDS = [
    'priorHppSection', 'priorHppTitle', 'currentHppTitle', 'priorHppDueBadge', 'priorHppAmtLabel',
    'priorHppAmt', 'priorHppBasis', 'priorHppActualInput', 'priorHppActualNote', 'priorHppActualHint',
    'hppLabel', 'hppNote', 'hppAmount', 'hppBasis', 'hppModeHoursAmt', 'hppModeYtdAmt', 'hppModeExactAmt',
    'hppYtdWrap', 'hppExactWrap', 'hppExactAmt', 'ytdPay',
];
/** The three amount-source radios, as one group: checking one unchecks the others. */
const _RADIOS = { hppModeHours: 'hours', hppModeYtd: 'ytd', hppModeExact: 'exact' };
function _resetDom() {
    for (const id of _CARD_IDS) _els[id] = _node(id);
    for (const [id, value] of Object.entries(_RADIOS)) {
        const n = _node(id);
        let on = value === 'hours';
        Object.defineProperty(n, 'checked', {
            get: () => on,
            set: (v) => { on = !!v; if (on) for (const o of Object.keys(_RADIOS)) if (o !== id) _els[o]._off(); },
        });
        n._off = () => { on = false; };
        n.value = value;
        _els[id] = n;
    }
}
_resetDom();
globalThis.document = /** @type {any} */ ({
    activeElement: null,
    getElementById: (/** @type {string} */ id) => _els[id] ?? null,
    querySelector: (/** @type {string} */ sel) => (sel === 'input[name="hppMode"]:checked'
        ? Object.keys(_RADIOS).map(id => _els[id]).find(n => n.checked) ?? null
        : null),
});

const { isDataEmpty } = await import('../paycalc-format.js');
const { _decodeHours, _varPayForPeriod, resolveHppForPeriod, hppFromYtdTaxable, knownYtdLumps,
        priorHppToStore, updatePriorHpp, calcHPP, readHppState, restoreHppState, saveHppState,
        savedPeriodPension, premiumStillToEstimate } = await import('../paycalc-hpp.js');
const { periodKey, hppEstKey, hppActualKey, hppModeKey } = await import('../paycalc-migrations.js');
const { getPeriods, CONFIG: PERIOD_CONFIG } = _realPeriods;

// ── Helpers ───────────────────────────────────────────────────────────────────

function reset() {
    _ls.clear();
    _hasBankHolidayVal = false;
    _hasBoxingDayVal   = false;
    _proRate           = 1;
    _grade             = 'cea';
    _viewPNum          = 48;
    _resetDom();
}

/** The two tax years the grid holds, from the REAL table. */
const TY25 = /** @type {any} */ (PERIOD_CONFIG.TAX_YEARS.find((/** @type {any} */ t) => t.label === '2025/26'));
const TY26 = /** @type {any} */ (PERIOD_CONFIG.TAX_YEARS.find((/** @type {any} */ t) => t.label === '2026/27'));
/** A period of the real grid by number. @param {number} n */
const P = (n) => /** @type {any} */ (getPeriods().find((/** @type {any} */ p) => p.num === n));
/** Save hours on a payslip of the real grid. @param {number} n @param {Record<string, number>} d */
const saveHours = (n, d) => _ls.set(periodKey(n), JSON.stringify(d));

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
// resolveHppForPeriod — "confirmed actual beats estimate" (incl. a confirmed £0)
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveHppForPeriod', () => {
    beforeEach(reset);

    test('no actual, no estimate → £0, not an estimate', () => {
        assert.deepEqual(resolveHppForPeriod(null, null), { amount: 0, isEstimate: false, hasActual: false });
    });

    test('estimate only → uses the estimate, flagged as estimate', () => {
        assert.deepEqual(resolveHppForPeriod(null, '1791.72'), { amount: 1791.72, isEstimate: true, hasActual: false });
    });

    test('empty-string actual is treated as NOT confirmed → falls back to estimate', () => {
        assert.deepEqual(resolveHppForPeriod('', '1791.72'), { amount: 1791.72, isEstimate: true, hasActual: false });
    });

    test('a confirmed actual beats the estimate', () => {
        assert.deepEqual(resolveHppForPeriod('1650.00', '1791.72'), { amount: 1650, isEstimate: false, hasActual: true });
    });

    test('a confirmed £0 WINS over the estimate (the v17.26 money fix)', () => {
        // Payslip HPP genuinely £0 (e.g. a year of absence). Before v17.26 the `actual > 0` test
        // ignored this and kept adding the stale estimate to the January take-home.
        assert.deepEqual(resolveHppForPeriod('0.00', '1791.72'), { amount: 0, isEstimate: false, hasActual: true });
    });

    test('a confirmed negative clamps to £0 (a payslip HPP cannot be negative)', () => {
        assert.deepEqual(resolveHppForPeriod('-50.00', '1791.72'), { amount: 0, isEstimate: false, hasActual: true });
    });

    test('an estimate of £0 is not treated as a live estimate', () => {
        assert.deepEqual(resolveHppForPeriod(null, '0.00'), { amount: 0, isEstimate: false, hasActual: false });
    });

    test('stored text that is not a figure confirms nothing — it read as a confirmed £0 (paycalc-2-15)', () => {
        assert.deepEqual(resolveHppForPeriod('abc', '9'), { amount: 9, isEstimate: true, hasActual: false });
        assert.deepEqual(resolveHppForPeriod('£1,843.01', '9'), { amount: 1843.01, isEstimate: false, hasActual: true });
    });
});

// ── priorHppToStore — what a typed prior-year premium is stored as (moved from the coordinator) ──
describe('priorHppToStore', () => {
    test('a payslip-style figure is stored clean, never as typed', () => {
        assert.equal(priorHppToStore('1,200'), '1200.00', 'stored verbatim, "1,200" read back as £1');
        assert.equal(priorHppToStore('£350'), '350.00', 'stored verbatim, "£350" read back as NaN');
        assert.equal(priorHppToStore(' 1843.017 '), '1843.02');
    });

    test('a typed 0 is a confirmed figure; a negative is floored to it', () => {
        assert.equal(priorHppToStore('0'), '0.00', 'a year of absence: confirmed, and it must beat the estimate');
        assert.equal(priorHppToStore('-50'), '0.00');
    });

    test('blank, or not a figure, clears the confirmation rather than confirming £0', () => {
        for (const raw of ['', '   ', '.', 'abc']) assert.equal(priorHppToStore(raw), null, JSON.stringify(raw));
    });

    test('what it stores reads back as the confirmed amount', () => {
        assert.deepEqual(resolveHppForPeriod(priorHppToStore('£1,843.01'), '1791.72'), { amount: 1843.01, isEstimate: false, hasActual: true });
    });
});

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

    test('hours saved as TEXT are read as the figures they are, garbage as 0 (paycalc-2-15)', () => {
        // A backup made elsewhere can hold "5": `"5" + 0.5` is "50.5", so HPP, back pay and the year
        // block priced fifty hours where the form — which parses — showed five, and "abc" gave £NaN.
        assert.equal(_decodeHours(makeP50(), { otH: '5', otM: '30' }).otHrs, 5.5);
        assert.equal(_decodeHours(makeP50(), { satH: 'abc' }).satHrs, 0);
        assert.ok(Number.isFinite(_varPayForPeriod(makeP50(), { satH: 'abc', sunH: '2' }, 20.74)));
    });
});

describe('savedPeriodPension — the pension a saved payslip is priced with (paycalc-2-16)', () => {
    beforeEach(reset);
    test('its own figure, floored at £0 as the result card floors the box', () => {
        assert.equal(savedPeriodPension(makeP50(), { pension: -50 }, 1), 0, 'a negative added untaxed headroom');
        assert.equal(savedPeriodPension(makeP50(), { pension: 100 }, 1), 100);
        assert.equal(savedPeriodPension(makeP50(), { pension: '£120.50' }, 1), 120.5);
    });
    test('none saved, or text that is not a figure: the period default, scaled for a joining period', () => {
        assert.equal(savedPeriodPension(makeP50(), { pension: 'abc' }, 1), 147.36, 'as the box treats unreadable text');
        assert.equal(savedPeriodPension(makeP50(), null, 0.5), 147.36 * 0.5);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// _varPayForPeriod — P50 (2026/27), rate = 20.74, effContr = 140, proRate = 1
//   London Allowance 2026/27 = 276.16 (no mid-year split)
// ─────────────────────────────────────────────────────────────────────────────

describe('_varPayForPeriod', () => {
    beforeEach(reset);

    const RATE   = 20.74;
    const SAT_UP = RATE * (RATE_125 - 1);      // 5.185/hr — premium above base only
    const R125   = RATE * RATE_125;            // 25.925/hr
    const R150   = RATE * RATE_150;            // 31.110/hr
    const R300   = RATE * RATE_300;            // 62.220/hr

    // London Allowance does NOT accrue HPP (removed v17.23; paycalc.md invariant 6 + Jan-2026
    // payslip) — a period with no variable premiums contributes ZERO to the HPP base.
    test('returns 0 when all hours are zero (London Allowance does not accrue HPP)', () => {
        assertPounds(_varPayForPeriod(makeP50(), {}, RATE), 0, 'zero hours → zero HPP base');
    });

    test('adds Saturday uplift (premium only, not full 1.25× rate)', () => {
        // satCapped=8, normHrs=132, bhCapped=0
        assertPounds(
            _varPayForPeriod(makeP50(), { satH: 8 }, RATE),
            8 * SAT_UP, '8 sat hrs');
    });

    test('adds OT at r125', () => {
        assertPounds(
            _varPayForPeriod(makeP50(), { otH: 4 }, RATE),
            4 * R125, '4 OT hrs');
    });

    test('adds RDW at r125', () => {
        assertPounds(
            _varPayForPeriod(makeP50(), { rdwH: 4 }, RATE),
            4 * R125, '4 RDW hrs');
    });

    test('adds Sunday at r150', () => {
        assertPounds(
            _varPayForPeriod(makeP50(), { sunH: 3 }, RATE),
            3 * R150, '3 Sun hrs');
    });

    test('adds Boxing Day at r300 when hasBoxingDay is true', () => {
        _hasBoxingDayVal = true;
        assertPounds(
            _varPayForPeriod(makeP50(), { boxH: 2 }, RATE),
            2 * R300, '2 Boxing hrs');
    });

    test('excludes Boxing Day hours when hasBoxingDay is false', () => {
        _hasBoxingDayVal = false;
        assertPounds(
            _varPayForPeriod(makeP50(), { boxH: 2 }, RATE),
            0, 'boxH ignored when no Boxing Day');
    });

    test('adds BH uplift when hasBankHoliday is true and satHrs < effContr', () => {
        // satHrs=0, satCapped=0, normHrs=140, bhCapped=min(4,140)=4
        _hasBankHolidayVal = true;
        assertPounds(
            _varPayForPeriod(makeP50(), { bhH: 4 }, RATE),
            4 * SAT_UP, '4 BH hrs');
    });

    test('BH capped to zero when all contracted hours are Saturday (normHrs = 0)', () => {
        // satHrs=140, satCapped=140, normHrs=0, bhCapped=min(4,0)=0
        // This mirrors the calculate() cap: when Saturday fills the contract,
        // the BH premium is already accounted for in the Saturday rate.
        _hasBankHolidayVal = true;
        assertPounds(
            _varPayForPeriod(makeP50(), { satH: 140, bhH: 4 }, RATE),
            140 * SAT_UP, 'BH capped at normHrs=0');
    });

    test('adds BH overtime at r125 when hasBankHoliday is true', () => {
        _hasBankHolidayVal = true;
        assertPounds(
            _varPayForPeriod(makeP50(), { bhOtH: 2 }, RATE),
            2 * R125, '2 bhOt hrs');
    });
});

describe('hppFromYtdTaxable (v18.34 — estimate from Year to Date Taxable Pay)', () => {
    test('(taxable − expected non-premium) × 4/52 = the premium portion HPP', () => {
        // Isolate the premium pay by removing expected basic + London − pension, then take 7.69%.
        assert.ok(Math.abs(hppFromYtdTaxable(62554, 38948) - (62554 - 38948) * (4 / 52)) < 0.001);
        assert.equal(hppFromYtdTaxable(40000, 30000), 10000 * (4 / 52));
    });
    test('clamps to 0 when expected non-premium ≥ taxable (nothing to premium)', () => {
        assert.equal(hppFromYtdTaxable(30000, 35000), 0);
        assert.equal(hppFromYtdTaxable(0, 0), 0);
        assert.equal(hppFromYtdTaxable(NaN, 100), 0);
    });
});

// THE LUMPS INSIDE TAXABLE PAY (72-hour review). The 'ytd' estimate takes 7.69% of Taxable Pay minus
// expected basic + London − pension — so anything ELSE in Taxable Pay that is not a premium was
// priced as one. Two such lumps the app holds exactly: peer-training pay (extra BASIC, no payslip
// line of its own) and last year's Holiday Pay Premium, paid on this year's January payslip.
describe('knownYtdLumps — non-premium lumps inside a Year to Date Taxable Pay figure', () => {
    const P = (/** @type {number} */ num) => ({ num });
    const saved = /** @type {Record<number, any>} */ ({ 50: { data: { peer: 2 } }, 51: { data: { peer: 0 } } });
    const base = {
        covered: [P(50), P(51), P(52)],
        readSaved: (/** @type {number} */ n) => saved[n] ?? { data: null },
        rateFor: () => 20,
        hppCarrier: null, priorHppAmount: 0,
    };

    test('peer-training days are removed at 2h basic each', () => {
        assertPounds(knownYtdLumps(base), 2 * 2 * 20, 'two peer days at £20/h');
    });

    test("last year's premium is removed only once its January payslip is inside the figure", () => {
        assertPounds(knownYtdLumps({ ...base, hppCarrier: P(52), priorHppAmount: 1843.01 }), 80 + 1843.01, 'carrier covered');
        assertPounds(knownYtdLumps({ ...base, hppCarrier: P(60), priorHppAmount: 1843.01 }), 80, 'carrier not yet reached');
    });

    test('nothing known → nothing removed (an unreadable or empty period adds no guess)', () => {
        assert.equal(knownYtdLumps({ ...base, readSaved: () => ({ data: null, error: true }) }), 0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Invariant 7 — HPP is NEVER pro-rated for a joiner (.claude/rules/paycalc.md)
// ─────────────────────────────────────────────────────────────────────────────
// It accrues on the extras actually done, so a part-year premium is lower by itself; a pro-rate term
// on top would scale it down a second time. The joining period's factor reaches this function's
// neighbours (London and the pension are pro-rated in calculate()), which is what makes a stray
// `× getProRateFactor(p)` here look plausible.
describe('_varPayForPeriod — no joiner pro-rate (invariant 7)', () => {
    beforeEach(reset);

    test('a joining period counts its premiums in full, whatever its pro-rate factor', () => {
        const RATE = 21.49;
        const d = { satH: 8, otH: 4, rdwH: 6, sunH: 5, bhOtH: 2 };
        const full = _varPayForPeriod(makeP50(), d, RATE);
        assert.ok(full > 0, 'premiums were worked');
        for (const f of [0.25, 0.5, 10 / 28]) {
            _proRate = f;
            assertPounds(_varPayForPeriod(makeP50(), d, RATE), full, `factor ${f.toFixed(3)}`);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE PRIOR-YEAR BLOCK — what a member reads on the January payslip (paycalc-2-3, paycalc-2-4)
// ─────────────────────────────────────────────────────────────────────────────
// Driven through the REAL `updatePriorHpp` against the fake document and the real grid. Last year's
// premium is the figure that lands on the January payslip and can be ticked into its take-home, so
// what this block says about it — where it came from, and whether the box beneath it is open — is
// what a member acts on in January.

const { hppPayslipForTaxYear } = await import('../paycalc-hpp-schedule.js');
/** The January payslip that carries 2025/26's premium — asked of the schedule, never written down. */
const JAN = /** @type {any} */ (hppPayslipForTaxYear(TY25, getPeriods()));
const HOUR = 3600e3;
/** Paint the block for the payslip on screen at an instant. @param {any} t @param {Date} now */
function paintAt(t, now, pNum = JAN.num) {
    t.mock.timers.enable({ apis: ['Date'], now });
    _viewPNum = pNum;
    updatePriorHpp(TY26);
}

describe('the confirm box opens once the January payslip can be in hand (paycalc-2-3)', () => {
    beforeEach(reset);

    test('precondition: the carrier is a January payslip whose cut-off comes days before its payday', () => {
        assert.ok(JAN, 'the grid reaches the January that carries 2025/26');
        assert.equal(JAN.payday.getMonth(), 0);
        assert.ok(JAN.payday - JAN.cutoff >= 5 * 24 * HOUR, 'cut-off and payday must be days apart, or this proves nothing');
    });

    test('locked before the cut-off, and the card does not ask for a figure it cannot take', (t) => {
        saveHours(45, { otH: 20, otM: 0 });                  // a 2025/26 payslip → an estimate to show
        paintAt(t, new Date(JAN.cutoff.getTime() - HOUR));
        assert.equal(_els.priorHppActualInput.disabled, true);
        assert.match(_els.priorHppActualHint.textContent, /Unlocks when your January \d{4} payslip arrives/);
        assert.doesNotMatch(_els.priorHppBasis.textContent, /check your January \d{4} payslip and enter/,
            'the basis line asked for the confirmed amount over a locked box');
        assert.match(_els.priorHppBasis.textContent, /once your January \d{4} payslip arrives/);
    });

    test('OPEN from the cut-off, through the days before payday and the morning of payday itself', (t) => {
        saveHours(45, { otH: 20, otM: 0 });
        for (const [label, now] of [
            ['an hour after the cut-off', new Date(JAN.cutoff.getTime() + HOUR)],
            ['the day before payday', new Date(JAN.payday.getTime() - 24 * HOUR)],
            ['07:30 on payday', new Date(JAN.payday.getFullYear(), 0, JAN.payday.getDate(), 7, 30)],
        ]) {
            t.mock.timers.reset();
            _resetDom();
            paintAt(t, /** @type {Date} */ (now));
            assert.equal(_els.priorHppActualInput.disabled, false, `${label}: the payslip may be in hand, so the box must be open`);
            assert.match(_els.priorHppActualHint.textContent, /Find the Holiday Pay Premium line/, String(label));
            assert.match(_els.priorHppBasis.textContent, /check your January \d{4} payslip and enter the confirmed amount below/, String(label));
        }
    });

    test('a stored figure keeps the box open whatever the date — a wrong figure is never locked in', (t) => {
        _ls.set(hppActualKey(TY25), '100.00');
        paintAt(t, new Date(JAN.cutoff.getTime() - 30 * 24 * HOUR), 58);
        assert.equal(_els.priorHppActualInput.disabled, false);
    });

    test('the open hint says where the take-home choice is, rather than promising it moves by itself', (t) => {
        saveHours(45, { otH: 20, otM: 0 });
        paintAt(t, new Date(JAN.payday.getTime() + HOUR));
        // The premium is OPT-IN: a confirmed figure changes the take-home only once ticked in.
        assert.doesNotMatch(_els.priorHppActualHint.textContent, /updates your January take-home/);
        assert.match(_els.priorHppActualHint.textContent, /tick the box in its green note/);
    });
});

describe('last year\'s premium says what it was built from (paycalc-2-4)', () => {
    beforeEach(reset);
    const NOT_JAN = 58;                                       // a 2026/27 payslip that is not the carrier

    test('from hours: the count of last year\'s payslips entered, not a bare "estimated from your periods"', (t) => {
        saveHours(45, { sunH: 10, sunM: 0 });                 // ONE payslip of thirteen
        paintAt(t, new Date(2026, 10, 10, 10), NOT_JAN);
        assert.equal(_els.priorHppAmtLabel.textContent, 'Estimated');
        assert.equal(_els.priorHppBasis.textContent, '1 of 13 2025/26 payslips entered · due January 2027');
    });

    test('a figure the member typed is labelled as theirs, never "Estimated"', (t) => {
        _ls.set(hppModeKey(TY25), JSON.stringify({ mode: 'exact', exact: '1500' }));
        _ls.set(hppEstKey(TY25), '1500.00');
        saveHours(45, { sunH: 10, sunM: 0 });                 // hours exist too — the TYPED figure is the one stored
        paintAt(t, new Date(2026, 10, 10, 10), NOT_JAN);
        assert.equal(_els.priorHppAmtLabel.textContent, 'Your figure');
        assert.equal(_els.priorHppAmt.textContent, '£1,500.00');
        assert.equal(_els.priorHppBasis.textContent, 'Entered by you · due January 2027');
    });

    test('a figure from the Year to Date card says it is the rough one', (t) => {
        _ls.set(hppModeKey(TY25), JSON.stringify({ mode: 'ytd', exact: '' }));
        _ls.set(hppEstKey(TY25), '210.40');
        paintAt(t, new Date(2026, 10, 10, 10), NOT_JAN);
        assert.equal(_els.priorHppBasis.textContent, 'Rough estimate from your 2025/26 Year to Date pay · due January 2027');
    });

    test('an unreadable saved choice claims no source it cannot know', (t) => {
        _ls.set(hppModeKey(TY25), '{"mode":"exa');
        _ls.set(hppEstKey(TY25), '1500.00');
        paintAt(t, new Date(2026, 10, 10, 10), NOT_JAN);
        assert.equal(_els.priorHppAmtLabel.textContent, 'Estimated');
        assert.equal(_els.priorHppBasis.textContent, 'Estimated from your 2025/26 payslips · due January 2027');
    });

    test('on the January payslip itself the basis survives beside the instruction', (t) => {
        saveHours(45, { sunH: 10, sunM: 0 });
        paintAt(t, new Date(JAN.payday.getTime() + HOUR));
        assert.equal(_els.priorHppAmtLabel.textContent, 'Expected on this payslip');
        assert.match(_els.priorHppBasis.textContent, /^1 of 13 2025\/26 payslips entered — check your January 2027 payslip/);
    });
});

// ── A CHOSEN SOURCE WITH NOTHING IN IT GETS NO FIGURE FROM HOURS (17 Nov 2026) ───────────────────
// With nothing stored, the block worked last year's premium out from its saved hours and STORED it,
// whatever source that year had chosen. The next render read the stored figure back under the
// member's choice: one payslip of Sunday hours became "Your figure £23.93 — Entered by you", counted
// as done for the January notice, and fed the January payslip — and viewing a 2025/26 payslip
// deleted it again, so it came and went. A figure not on record, dressed as the member's own.
describe('last year\'s chosen source, with nothing in it, gets no figure from hours', () => {
    beforeEach(reset);
    const NOT_JAN = 58;
    const NOV17 = new Date(2026, 10, 17, 10);

    test('"Enter the figure yourself" left empty: £–, the block asks for it, and nothing is stored — on every render', (t) => {
        saveHours(45, { sunH: 10, sunM: 0 });                                       // 2025/26 hours exist …
        _ls.set(hppModeKey(TY25), JSON.stringify({ mode: 'exact', exact: '' }));   // … but the member chose to type it
        paintAt(t, NOV17, NOT_JAN);
        for (const render of ['first', 'second']) {
            assert.equal(_els.priorHppAmt.textContent, '£–', `${render} render`);
            assert.equal(_els.priorHppAmtLabel.textContent, 'Your figure');
            assert.equal(_els.priorHppBasis.textContent,
                'No figure yet — you chose to enter the 2025/26 figure yourself. Open any 2025/26 payslip and type it into this card.');
            assert.equal(_ls.get(hppEstKey(TY25)), undefined, `${render} render: nothing stored for the January payslip`);
            _resetDom();
            updatePriorHpp(TY26);
        }
        assert.equal(premiumStillToEstimate(TY25), 'open', 'the January notice still has something to ask');
    });

    test('a rough estimate from Year to Date pay with no Taxable Pay yet: £–, naming the payslip to copy from', (t) => {
        saveHours(45, { sunH: 10, sunM: 0 });
        _ls.set(hppModeKey(TY25), JSON.stringify({ mode: 'ytd', exact: '' }));
        paintAt(t, NOV17, NOT_JAN);
        assert.equal(_els.priorHppAmt.textContent, '£–');
        assert.equal(_els.priorHppAmtLabel.textContent, 'Estimated');
        assert.equal(_els.priorHppBasis.textContent, 'No figure yet — you chose a rough estimate from your 2025/26 Year to '
            + 'Date pay. Open your 13 March 2026 payslip and copy its Year to Date Taxable Pay into Year to Date Figures.');
        assert.equal(_ls.get(hppEstKey(TY25)), undefined);
        _resetDom();
        updatePriorHpp(TY26);
        assert.doesNotMatch(_els.priorHppBasis.textContent, /Rough estimate from your 2025\/26 Year to Date pay ·/,
            'an hours figure was read back as the rough Year to Date one');
    });

    test('a figure stored from hours beside an EMPTY "Enter the figure yourself" box is not the member\'s', (t) => {
        // What the block used to leave behind on a device: the hours figure, under the member's choice.
        _ls.set(hppModeKey(TY25), JSON.stringify({ mode: 'exact', exact: '' }));
        _ls.set(hppEstKey(TY25), '23.93');
        assert.equal(premiumStillToEstimate(TY25), 'open', 'nothing typed is nothing done');
        paintAt(t, NOV17, NOT_JAN);
        assert.equal(_els.priorHppAmt.textContent, '£–');
        assert.equal(_ls.get(hppEstKey(TY25)), undefined, 'and it no longer feeds the January payslip');
    });

    test('CONTROL: with the hours as the source — chosen, or never chosen — last year\'s hours still build it', (t) => {
        saveHours(45, { sunH: 10, sunM: 0 });
        for (const saved of [null, JSON.stringify({ mode: 'hours', exact: '' })]) {
            _ls.delete(hppEstKey(TY25));
            if (saved) _ls.set(hppModeKey(TY25), saved); else _ls.delete(hppModeKey(TY25));
            _resetDom();
            paintAt(t, NOV17, NOT_JAN);
            t.mock.timers.reset();
            assert.equal(_els.priorHppBasis.textContent, '1 of 13 2025/26 payslips entered · due January 2027', String(saved));
            assert.ok(Number(_ls.get(hppEstKey(TY25))) > 0, `${saved}: stored for the January payslip`);
        }
    });

    test('CONTROL: a figure the member typed is still theirs, and done', (t) => {
        _ls.set(hppModeKey(TY25), JSON.stringify({ mode: 'exact', exact: '1,500' }));
        _ls.set(hppEstKey(TY25), '1500.00');
        assert.equal(premiumStillToEstimate(TY25), 'done');
        paintAt(t, NOV17, NOT_JAN);
        assert.equal(_els.priorHppAmt.textContent, '£1,500.00');
        assert.equal(_els.priorHppBasis.textContent, 'Entered by you · due January 2027');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE ROUGH YEAR TO DATE PREMIUM AND THE BACK-PAY LUMP (paycalc-2-13, owner 10 Nov 2026)
// ─────────────────────────────────────────────────────────────────────────────
// The 'ytd' estimate takes 7.69% of whatever premium pay is inside a Taxable Pay figure. Once the
// payslip carrying the pay award's lump is covered, the lump is inside it — and its basic and London
// arrears are not premium pay. They come out, computed from the RECORD; its premium arrears stay in.
// Every expected figure below is DERIVED from the same tables and accrual the card uses, so the next
// award moves these cases instead of breaking them.

const { getRateForPeriod, getLondonAllowanceForPeriod, awardFromForYear, HPP_FRACTION } = await import('../paycalc-calc.js');
const { _accrueBackPayPeriod, awardWindowFactor, _awardBackdateDate, paidInPeriodNum } = await import('../paycalc-backpay-accrual.js');
const { resolveAuthoritativeRates } = await import('../paycalc-backpay-state.js');
const { ytdSrcKey } = await import('../paycalc-migrations.js');

/** What one payslip of `ty` paid that is not premium: contracted basic + London − the pension. */
function plainPay(/** @type {any} */ ty, /** @type {any} */ p) {
    return 140 * getRateForPeriod(p, _grade, ty.label, _settledRate(ty)) + getLondonAllowanceForPeriod(p, ty) - 147.36;
}
/** The year's award: the payslip carrying the lump, the window it covers and the record's rates. */
function award(/** @type {any} */ ty) {
    const from = /** @type {Date} */ (awardFromForYear(ty.label));
    const carrier = P(/** @type {number} */ (paidInPeriodNum(getPeriods(), from)));
    const yearPeriods = getPeriods().filter((/** @type {any} */ p) => p.num - 48 >= ty.first && p.num - 48 <= ty.last);
    const window = yearPeriods.filter((/** @type {any} */ p) => p.payday < from);
    const auth = resolveAuthoritativeRates(ty, awardRatesFor(_grade, ty.label));
    return { carrier, window, auth };
}
/** The card's lump for the saved hours, and its non-premium share — the card's own accrual. */
function lump(/** @type {any} */ ty, /** @type {Record<number, any>} */ hours = {}) {
    const { window, auth } = award(ty);
    const rateDiff = /** @type {number} */ (auth.newRateInput) - /** @type {number} */ (auth.oldRate);
    const londonDiff = /** @type {number} */ (auth.newLondon) - /** @type {number} */ (auth.oldLondon);
    let total = 0, premium = 0;
    for (const p of window) {
        const r = _accrueBackPayPeriod({ effContr: 140, proRateFactor: 1, rateDiff, londonDiff,
            windowFactor: awardWindowFactor(p, _awardBackdateDate(ty)), hours: _decodeHours(p, hours[p.num] ?? {}) });
        if (r.backPay > 0) total += Math.round(r.backPay * 100) / 100;
        premium += r.varPay;
    }
    return { total, premium };
}
/** Show `pNum` in 'ytd' mode with the Year to Date figures copied from `srcNum`, and run the card. */
function runYtd(/** @type {any} */ t, /** @type {number} */ pNum, /** @type {string} */ src, /** @type {number} */ taxable) {
    t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 10, 10, 10) });   // 10 Nov 2026
    _viewPNum = pNum;
    _ls.set(ytdSrcKey(/** @type {any} */ (PERIOD_CONFIG.TAX_YEARS.find((/** @type {any} */ y) => pNum - 48 >= y.first && pNum - 48 <= y.last))), src);
    _els.ytdPay.value = taxable.toFixed(2);
    _els.hppModeYtd.checked = true;
    calcHPP();
}

describe('the rough Year to Date premium takes the back-pay lump\'s arrears out (paycalc-2-13)', () => {
    beforeEach(reset);

    test('a member with NO premium pay gets £0.00 once the award payslip is covered (it read £36.63)', (t) => {
        const { carrier } = award(TY26);
        const L = lump(TY26).total;
        assert.ok(L > 400, `the 2026/27 lump is real money (£${L.toFixed(2)}) — nothing below means anything without it`);
        // Taxable Pay exactly as those payslips paid it: plain pay on each, and the lump on its own.
        let taxable = L;
        for (const p of getPeriods()) if (p.num >= 48 + TY26.first && p.num <= carrier.num) taxable += plainPay(TY26, p);
        runYtd(t, 58, String(carrier.num), taxable);
        assert.equal(_els.hppAmount.textContent, '£0.00',
            `before the fix the lump was priced as premium pay: £${(L * HPP_FRACTION).toFixed(2)}`);
        assert.equal(_ls.has(hppEstKey(TY26)), false, 'a £0 premium is not stored as an estimate');
        assert.doesNotMatch(_els.hppBasis.textContent, /looks lower/, 'a figure that MATCHES the expected pay is not lower');
    });

    test('a member WITH premium pay keeps it — and the lump\'s premium arrears with it', (t) => {
        const { carrier, window } = award(TY26);
        const hours = { [window[2].num]: { otH: 10, otM: 0, sunH: 8, sunM: 0 }, [carrier.num + 1]: { otH: 5, otM: 0 } };
        for (const [n, d] of Object.entries(hours)) saveHours(Number(n), d);
        const L = lump(TY26, hours);
        assert.ok(L.premium > 5, 'the window hours earn premium arrears, or this case cannot tell them apart');
        let taxable = L.total, premiumPaid = 0;
        for (const p of getPeriods()) {
            if (p.num < 48 + TY26.first || p.num > carrier.num + 1) continue;
            const prem = _varPayForPeriod(p, hours[p.num] ?? {}, getRateForPeriod(p, _grade, TY26.label, _settledRate(TY26)));
            premiumPaid += prem;
            taxable += plainPay(TY26, p) + prem;
        }
        runYtd(t, 58, String(carrier.num + 1), taxable);
        const expected = (premiumPaid + L.premium) * HPP_FRACTION;
        assert.ok(expected > 1, 'precondition: a real premium');
        assert.equal(_els.hppAmount.textContent, `£${expected.toFixed(2)}`,
            'the premium pay AND the premium arrears stay in; only the basic and London arrears come out');
    });

    test('a year whose old rate is not on record (CES 2025/26) is LABELLED, never guessed', (t) => {
        _grade = 'ces';
        const { carrier, auth } = award(TY25);
        assert.equal(auth.oldRate, null, 'precondition: CES 2025/26 has no old rate on record');
        const covered = getPeriods().filter((/** @type {any} */ p) => p.num >= 48 + TY25.first && p.num <= carrier.num + 2);
        const plain = covered.reduce((/** @type {number} */ s, /** @type {any} */ p) => s + plainPay(TY25, p), 0);
        const taxable = plain + 1000;                        // £1,000 of premium pay and arrears together
        runYtd(t, carrier.num + 3, String(carrier.num + 2), taxable);
        assert.match(_els.hppBasis.textContent, /This may include back pay/);
        assert.match(_els.hppBasis.textContent, /pay-rise lump on your \d{1,2} [A-Z][a-z]+ 2025 payslip/);
        // Nothing was taken out: the figure is 7.69% of all £1,000.
        assert.equal(_els.hppAmount.textContent, `£${(1000 * HPP_FRACTION).toFixed(2)}`);
    });

    test('a saved negative pension is priced at £0 here too, as the result card prices it (paycalc-2-16)', (t) => {
        const { carrier } = award(TY26);
        const odd = 48 + TY26.first + 1;
        saveHours(odd, { pension: -50 });                     // a pasted −50: the card took no pension
        let taxable = lump(TY26).total;
        for (const p of getPeriods()) {
            if (p.num >= 48 + TY26.first && p.num <= carrier.num) taxable += plainPay(TY26, p) + (p.num === odd ? 147.36 : 0);
        }
        runYtd(t, 58, String(carrier.num), taxable);
        assert.equal(_els.hppAmount.textContent, '£0.00', 'the −£50 was subtracted as pension and read as £50 short');
    });

    test('before the award payslip is covered, nothing is taken out and nothing is said', (t) => {
        const { carrier } = award(TY26);
        const covered = getPeriods().filter((/** @type {any} */ p) => p.num >= 48 + TY26.first && p.num < carrier.num);
        const taxable = covered.reduce((/** @type {number} */ s, /** @type {any} */ p) => s + plainPay(TY26, p), 0) + 500;
        runYtd(t, carrier.num, String(carrier.num - 1), taxable);
        assert.equal(_els.hppAmount.textContent, `£${(500 * HPP_FRACTION).toFixed(2)}`);
        assert.doesNotMatch(_els.hppBasis.textContent, /back pay/);
    });
});

describe('with the Year to Date figures detached, only PAID payslips count (paycalc-2-12)', () => {
    beforeEach(reset);

    test('the payslip still being earned is not treated as covered', (t) => {
        // 10 Nov 2026: the 20 Nov payslip is still being earned. The stored '0' is the member choosing
        // "— choose a payslip —"; the cap then falls to the last PAID payslip, not today's period.
        const last = [...getPeriods()].reverse().find((/** @type {any} */ p) => p.payday <= new Date(2026, 10, 10, 10));
        let taxable = lump(TY26).total;
        for (const p of getPeriods()) if (p.num >= 48 + TY26.first && p.num <= last.num) taxable += plainPay(TY26, p);
        runYtd(t, 58, '0', taxable);
        assert.doesNotMatch(_els.hppBasis.textContent, /looks lower/,
            'counting the unpaid payslip\'s basic made a correct figure read as too low');
        assert.equal(_els.hppAmount.textContent, '£0.00');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// A SAVED AMOUNT-SOURCE CHOICE OF THE WRONG SHAPE (paycalc-2-7, paycalc-2-10)
// ─────────────────────────────────────────────────────────────────────────────
// Only this app writes the blob, always an object — so anything else came in through a backup made
// elsewhere, which the import ladder lets through as a string. restoreHppState runs during start-up.

describe('restoring an unreadable choice never throws — start-up runs through it (paycalc-2-7)', () => {
    beforeEach(reset);

    test('JSON that is not an object, and text that is not JSON, both read as "no choice" → hours', () => {
        for (const raw of ['null', '5', '"x"', '[]', 'true', '{broken']) {
            _resetDom();
            _els.hppModeExact.checked = true;                 // whatever the page last showed
            _els.hppExactAmt.value = '999';
            _ls.set(hppModeKey(TY26), raw);
            assert.doesNotThrow(() => restoreHppState(TY26), `stored ${raw}`);
            assert.equal(_els.hppModeHours.checked, true, `stored ${raw}: falls back to hours`);
            assert.equal(_els.hppExactAmt.value, '', `stored ${raw}: no figure is carried over`);
            assert.equal(readHppState(TY26).damaged, true, `stored ${raw}: reported as damaged, not as absent`);
        }
        _ls.delete(hppModeKey(TY26));
        assert.deepEqual(readHppState(TY26), { mode: null, exact: '', damaged: false }, 'nothing stored is not damage');
    });

    test('an object whose figure is not text never writes "[object Object]" into the box', () => {
        _ls.set(hppModeKey(TY26), JSON.stringify({ mode: 'exact', exact: { a: 1 } }));
        restoreHppState(TY26);
        assert.equal(_els.hppModeExact.checked, true);
        assert.equal(_els.hppExactAmt.value, '');
    });
});

describe('an unreadable choice never silently replaces the member\'s own figure (paycalc-2-10)', () => {
    beforeEach(reset);

    test('the stored figure is kept and the card says why it shows the hours estimate — until they choose', (t) => {
        t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 10, 10, 10) });
        _viewPNum = 58;
        _ls.set(hppEstKey(TY26), '1500.00');                  // the member's own "Enter the figure yourself"
        saveHours(56, { otH: 10, otM: 0 });                   // and some hours, so the hours estimate differs
        _ls.set(hppModeKey(TY26), '{"mode":"exact","exact":"15');   // the choice is damaged
        restoreHppState(TY26);
        calcHPP();
        assert.equal(_ls.get(hppEstKey(TY26)), '1500.00', 'the member\'s figure was replaced by an estimate nobody chose');
        assert.match(_els.hppBasis.textContent, /saved choice of where this figure comes from couldn't be read/);
        assert.match(_els.hppBasis.textContent, /£1,500\.00 stays in use until you choose an option above/);

        saveHppState(TY26);                                   // the member picks an option (hours is ticked)
        calcHPP();
        assert.notEqual(_ls.get(hppEstKey(TY26)), '1500.00', 'once chosen, the card works normally again');
        assert.doesNotMatch(_els.hppBasis.textContent, /couldn't be read/);
    });
});

describe('knownYtdLumps — the award lump only once its payslip is covered', () => {
    const base = { covered: [{ num: 54 }, { num: 55 }], readSaved: () => ({ data: null }), rateFor: () => 20,
        hppCarrier: null, priorHppAmount: 0 };
    test('covered → its non-premium share comes out; not covered → nothing', () => {
        assertPounds(knownYtdLumps({ ...base, awardCarrier: { num: 55 }, awardNonPremium: 476.18 }), 476.18, 'covered');
        assertPounds(knownYtdLumps({ ...base, awardCarrier: { num: 56 }, awardNonPremium: 476.18 }), 0, 'not yet covered');
        assertPounds(knownYtdLumps({ ...base, awardCarrier: { num: 55 }, awardNonPremium: -3 }), 0, 'never negative');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE JANUARY NOTICE (hpp_2526, owner 16 Nov 2026 — v26.22)
// ─────────────────────────────────────────────────────────────────────────────
// The Pay page's second notice sends a member to estimate the 2025/26 premium from their Year to Date
// pay. Three things here, each against the REAL payslip grid this file loads: who it is for
// (`premiumStillToEstimate`), what the card says about the one lump the 2025/26 figure cannot take
// out, and that the notice's own dates and link are the grid's. Its wiring is paycalc-notice-order.test.mjs;
// the browser half is e2e/paycalc-notices.spec.js ("premium notice").

const { readFileSync } = await import('node:fs');
const { hppTaxYearForPayslip, periodsInTaxYear } = await import('../paycalc-hpp-schedule.js');   // hppPayslipForTaxYear: above
const { fdLong: _fdLong, fdShort: _fdShort } = await import('../paycalc-format.js');

describe('premiumStillToEstimate — the reader the January notice is for (v26.22)', () => {
    beforeEach(reset);

    test('nothing stored: open — the member the notice exists for', () => {
        assert.equal(premiumStillToEstimate(TY25), 'open');
    });

    test('no payslip in the year — every pay period closed before they started — is none', () => {
        _proRate = 0;
        assert.equal(premiumStillToEstimate(TY25), 'none');
    });

    test('a joiner part-way through the year IS a reader: their last payslip of it is what counts', () => {
        // Started for the 13 Feb 2026 payslip: the year's first ten payslips predate them, its last
        // three do not. Asking the FIRST payslip would turn away somebody a premium is due to.
        const last = /** @type {any} */ (periodsInTaxYear(TY25, getPeriods()).at(-1));
        _proRate = (/** @type {any} */ p) => (p.num >= 48 ? 1 : 0);
        assert.equal(premiumStillToEstimate(TY25), 'open');
        // …and one who started after the year's last pay period closed is not.
        _proRate = (/** @type {any} */ p) => (p.num > last.num ? 1 : 0);
        assert.equal(premiumStillToEstimate(TY25), 'none');
    });

    test('a figure from the Year to Date pay on the year\'s LAST payslip, or typed in, is done', () => {
        const last = /** @type {any} */ (periodsInTaxYear(TY25, getPeriods()).at(-1));
        _ls.set(ytdSrcKey(TY25), String(last.num));
        _ls.set(hppModeKey(TY25), JSON.stringify({ mode: 'ytd', exact: '' }));
        _ls.set(hppEstKey(TY25), '445.10');
        assert.equal(premiumStillToEstimate(TY25), 'done');
        _ls.set(hppModeKey(TY25), JSON.stringify({ mode: 'exact', exact: '320' }));
        _ls.set(hppEstKey(TY25), '320.00');
        assert.equal(premiumStillToEstimate(TY25), 'done');
    });

    test('a rough figure from an EARLIER payslip\'s Year to Date pay covers part of the year: still open', () => {
        // The notice asks for the LAST payslip's figure because only that one holds the whole year; a
        // figure from the 19 Dec 2025 payslip is the low one it is there to replace.
        _ls.set(hppModeKey(TY25), JSON.stringify({ mode: 'ytd', exact: '' }));
        _ls.set(hppEstKey(TY25), '310.00');
        _ls.set(ytdSrcKey(TY25), '46');
        assert.equal(premiumStillToEstimate(TY25), 'open', 'from the 19 Dec 2025 payslip');
        _ls.delete(ytdSrcKey(TY25));
        assert.equal(premiumStillToEstimate(TY25), 'open', 'from no payslip on record');
        // A figure the member TYPED is theirs to vouch for, whatever the card holds.
        _ls.set(hppModeKey(TY25), JSON.stringify({ mode: 'exact', exact: '310' }));
        assert.equal(premiumStillToEstimate(TY25), 'done');
    });

    test('the source chosen but no figure yet is still open', () => {
        _ls.set(hppModeKey(TY25), JSON.stringify({ mode: 'ytd', exact: '' }));
        assert.equal(premiumStillToEstimate(TY25), 'open', 'nothing stored');
        _ls.set(hppEstKey(TY25), '0.00');
        assert.equal(premiumStillToEstimate(TY25), 'open', 'a £0 estimate is no figure');
    });

    test('an hours estimate — part of a year typed in — is still open: the route may well be better', () => {
        _ls.set(hppEstKey(TY25), '120.00');                   // no saved choice: the hours ran
        assert.equal(premiumStillToEstimate(TY25), 'open');
        _ls.set(hppModeKey(TY25), JSON.stringify({ mode: 'hours', exact: '' }));
        assert.equal(premiumStillToEstimate(TY25), 'open');
    });

    test('a confirmed figure, £0 included, is done', () => {
        _ls.set(hppActualKey(TY25), '0.00');
        assert.equal(premiumStillToEstimate(TY25), 'done');
    });

    test('an unreadable saved choice is not taken for theirs', () => {
        _ls.set(hppModeKey(TY25), '{"mode":"ytd"');
        _ls.set(hppEstKey(TY25), '445.10');
        assert.equal(premiumStillToEstimate(TY25), 'open');
    });

    test('it asks about the year it is handed, never another', () => {
        _ls.set(hppModeKey(TY26), JSON.stringify({ mode: 'ytd', exact: '' }));
        _ls.set(ytdSrcKey(TY26), String(/** @type {any} */ (periodsInTaxYear(TY26, getPeriods()).at(-1)).num));
        _ls.set(hppEstKey(TY26), '500.00');
        assert.equal(premiumStillToEstimate(TY26), 'done');
        assert.equal(premiumStillToEstimate(TY25), 'open', '2026/27\'s figure says nothing about 2025/26');
    });
});

describe('the rough 2025/26 premium names last January\'s premium, which no record holds (v26.22)', () => {
    beforeEach(reset);
    const SAYS = 'This may be a little high: your Year to Date pay includes any Holiday Pay Premium on your '
        + '16 January 2026 payslip, and the calculator has no record of that to take out.';

    test('covered by the figure, it is counted in, never guessed out — and said', (t) => {
        // A member with no premium pay at all but £600 of last year's premium on the 16 Jan 2026 payslip,
        // as a Taxable Pay figure holds it. Nothing on record says £600, so 7.69% of it stays in.
        const P = 600;
        let taxable = lump(TY25).total + P;
        for (const p of getPeriods()) if (p.num >= 48 + TY25.first && p.num <= 49) taxable += plainPay(TY25, p);
        runYtd(t, 49, '49', taxable);
        assert.equal(_els.hppAmount.textContent, `£${(P * HPP_FRACTION).toFixed(2)}`, 'nothing taken out for it');
        assert.ok(_els.hppBasis.textContent.includes(SAYS), _els.hppBasis.textContent);
    });

    test('a figure copied before that payslip says nothing of it', (t) => {
        runYtd(t, 49, '46', 40000);                           // 19 Dec 2025: January is not in it yet
        assert.doesNotMatch(_els.hppBasis.textContent, /little high/);
    });

    test('a member who started after that payslip says nothing of it', (t) => {
        _proRate = (/** @type {any} */ p) => (p.num >= 48 ? 1 : 0);   // from the 13 Feb 2026 payslip
        // A figure well above the expected pay, so the card reaches the estimate it would name the
        // premium in. At £12,000 it refused ("below") first, and this passed whatever the rule said:
        // mutation testing found it (v26.22) — the 16 Jan 2026 payslip was never theirs to name.
        runYtd(t, 49, '49', 200000);
        assert.match(_els.hppBasis.textContent, /^Rough estimate from your Year to Date pay up to your /, 'premise: the estimate is drawn, not refused');
        assert.doesNotMatch(_els.hppBasis.textContent, /little high/);
    });

    test('2026/27\'s January premium IS on record: it comes out, and nothing is said', (t) => {
        _ls.set(hppEstKey(TY25), '300.00');                   // the 2025/26 premium the member worked out
        runYtd(t, 61, '60', 45000);                           // covering the 15 Jan 2027 payslip
        assert.match(_els.hppBasis.textContent, /^Rough estimate/, 'premise: the estimate is drawn');
        assert.doesNotMatch(_els.hppBasis.textContent, /little high/);
    });

    test('2026/27\'s January premium with NO 2025/26 figure stored is said — never read as £0 (review, 16 Nov 2026)', (t) => {
        // The year is on record, so before this the premium on the 15 Jan 2027 payslip was taken out
        // as £0 — nothing came out, and nothing was said: the figure ran high with no word of it.
        runYtd(t, 61, '60', 45000);
        assert.ok(_els.hppBasis.textContent.includes('This may be a little high: your Year to Date pay includes any Holiday Pay '
            + 'Premium on your 15 January 2027 payslip, and the calculator has no record of that to take out.'), _els.hppBasis.textContent);
        // A member not employed in 2025/26 had none to record, so there is nothing to say.
        _proRate = (/** @type {any} */ p) => (p.num - 48 >= TY26.first ? 1 : 0);
        _resetDom(); t.mock.timers.reset();
        runYtd(t, 61, '60', 45000);
        assert.doesNotMatch(_els.hppBasis.textContent, /little high/);
    });

    test('the rough line says what it covers — and, for a year that has ended, that a part of it may be low', (t) => {
        runYtd(t, 49, '46', 40000);                           // 19 Dec 2025's figures, viewed on 10 Nov 2026
        assert.match(_els.hppBasis.textContent, /^Rough estimate from your Year to Date pay up to your 19 December 2025 payslip:/);
        assert.ok(_els.hppBasis.textContent.includes('It covers 2025/26 only up to that payslip, so it may be low — the Year to '
            + 'Date pay on your 13 March 2026 payslip covers the whole year.'), _els.hppBasis.textContent);
        _resetDom(); t.mock.timers.reset();
        runYtd(t, 49, '49', 40000);                           // the year's LAST payslip: the whole year
        assert.doesNotMatch(_els.hppBasis.textContent, /may be low/);
        _resetDom(); t.mock.timers.reset();
        runYtd(t, 58, '57', 40000);                           // 2026/27, still under way: part of it is all there is
        assert.doesNotMatch(_els.hppBasis.textContent, /may be low/);
    });
});

describe('the January notice\'s dates and link are the payslip grid\'s own (v26.22)', () => {
    const LIGHTBOXES = readFileSync(new URL('./paycalc-lightboxes.js', REPO_ROOT_URL), 'utf8');
    const HTML = readFileSync(new URL('./paycalc.html', REPO_ROOT_URL), 'utf8');
    const NOTICE = HTML.slice(HTML.indexOf('<div id="noticeHppLightbox"'), HTML.indexOf('<!-- Shared-device data ownership prompt'));
    const IIFE = LIGHTBOXES.slice(LIGHTBOXES.indexOf('const showHppNotice = (function () {'));
    const literal = (/** @type {string} */ name) => IIFE.match(new RegExp(`const ${name}\\s*=\\s*'([^']+)'`))?.[1];
    const last = /** @type {any} */ (periodsInTaxYear(TY25, getPeriods()).at(-1));
    const carrier = /** @type {any} */ (hppPayslipForTaxYear(TY25, getPeriods()));

    test('the year it names is the one the January 2027 payslip pays', () => {
        assert.equal(literal('TAX_YEAR'), TY25.label);
        assert.equal(hppTaxYearForPayslip(carrier, getPeriods(), PERIOD_CONFIG.TAX_YEARS), TY25);
        assert.equal(carrier.payday.getFullYear(), 2027);
    });

    test('its link and words name the LAST payslip of 2025/26 — whose Year to Date box holds the whole year', () => {
        const iso = `${last.payday.getFullYear()}-${String(last.payday.getMonth() + 1).padStart(2, '0')}-${String(last.payday.getDate()).padStart(2, '0')}`;
        assert.equal(iso, '2026-03-13', 'premise: the grid\'s last 2025/26 payday');
        assert.ok(NOTICE.includes(`href="./paycalc.html?payday=${iso}#payslipCard"`), 'the link opens that payslip, at the Year to Date card');
        // Words, not spacing: the dates are held together with &nbsp; (and \u00a0 in App Notices) so a
        // phone never breaks "13 March 2026" across a line, and that must not hide which payslip is named.
        const words = (/** @type {string} */ s) => s.replace(/&nbsp;|\u00a0|\\u00a0/g, ' ');
        const day = _fdLong(last.payday);
        assert.ok(words(NOTICE).includes(`your <strong>${day}</strong> payslip`), `the body names it: ${day}`);
        // The button names its day and month and keeps to one line on a 360px phone; the year is in the
        // sentence above it, and inside the notice's window (16 Nov – 8 Jan) "13 March" has only one past.
        const button = words(NOTICE.match(/id="noticeHppGo"[^>]*>([^<]+)<\/a>/)?.[1] ?? '');
        assert.equal(button, `Open your ${day.replace(/ \d{4}$/, '')} payslip &rarr;`, 'and so does the button');
        assert.ok(words(IIFE).includes(`Your ${day} payslip gives a rough figure`), 'and App Notices');
    });

    test('it ends the day before that January payslip can be in hand', (t) => {
        const dayBefore = new Date(carrier.cutoff);
        dayBefore.setDate(dayBefore.getDate() - 1);
        // LAST_DAY is never shown: it is read by `isNoticeExpired`, whose parser takes the notice system's
        // "8 Jan 2027" form — so it is checked in that form, not in the full one the copy uses.
        assert.equal(literal('LAST_DAY'), `${_fdShort(dayBefore)} ${dayBefore.getFullYear()}`,
            'LAST_DAY is the eve of the January payslip\'s cut-off');
        // Asked of the app's own rule (`payslipMayBeInHand`, from the cut-off — noon, the grid's anchor
        // hour): not in hand at any moment of the notice's last day, so it never runs beside the box that
        // takes the real figure; in hand from the cut-off on the 9th.
        t.mock.timers.enable({ apis: ['Date'], now: new Date(2027, 0, 8, 23, 59, 59) });
        assert.equal(_realPeriods.payslipMayBeInHand(carrier), false, 'the last moment of its last day');
        t.mock.timers.setTime(carrier.cutoff.getTime());
        assert.equal(_realPeriods.payslipMayBeInHand(carrier), true, 'the cut-off, on the 9th');
        assert.equal(carrier.cutoff.getDate(), 9);
    });
});
