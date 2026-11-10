/**
 * Unit tests for paycalc-hpp.js: the pure exports (isDataEmpty, _decodeHours, _varPayForPeriod, …)
 * and, against a fake `document`, the card itself — the prior-year block a member reads on the
 * January payslip, and the amount-source state.
 *
 * Run: node --experimental-test-module-mocks --test paycalc-hpp.test.mjs
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
import { RATE_125, RATE_150, RATE_300, awardRatesFor } from './paycalc-calc.js';

// ── Mock-controllable state ───────────────────────────────────────────────────

const _ls = new Map();
let _hasBankHolidayVal = false;
let _hasBoxingDayVal   = false;
let _proRate           = 1;
let _grade             = 'cea';
/** The payslip on screen (`currentPeriodNum`). */
let _viewPNum          = 48;
/** The settled rate the settings module would derive (its real rule: AWARD_RATES by grade). */
let _settledRate = (/** @type {any} */ ty) => awardRatesFor(_grade, ty?.label)?.rate ?? 20.74;

// The real period module, so the grid, the tax years and the in-hand rule are the app's own. It
// reaches Firebase only through the suggestion module, which is all this stands in for.
mock.module('./paycalc-roster-suggestions.js', { namedExports: { bhsForYear: () => [] } });
const _realPeriods = await import('./paycalc-periods.js?real');

mock.module('./paycalc-periods.js', {
    namedExports: {
        hasBankHoliday:   () => _hasBankHolidayVal,
        hasBoxingDay:     () => _hasBoxingDayVal,
        getPeriods:       () => _realPeriods.getPeriods(),
        currentPeriodNum: () => _viewPNum,
        todaysPeriodNum:  () => _realPeriods.todaysPeriodNum(),
        isTaxYearVisible: () => true,   // new-starter clamp — default visible; updatePriorHpp gates on it
        payslipMayBeInHand: _realPeriods.payslipMayBeInHand,
        CONFIG:           _realPeriods.CONFIG,
    },
});

mock.module('./paycalc-settings.js', {
    namedExports: {
        getGrade:          () => _grade,
        getLoggedMember:   () => null,
        getEffectiveContr: () => 140,
        // CONTROLLABLE (test audit, 7 Nov 2026). It was a constant 1, so multiplying any premium in
        // _varPayForPeriod by the joiner's factor was invisible — and invariant 7 (HPP is never
        // pro-rated for a joiner) had nothing behind it. The module still imports it for other work.
        getProRateFactor:  () => _proRate,
        getPensionDefault: () => 147.36,
        getStoredRateForYear: (/** @type {any} */ ty) => _settledRate(ty),
        isPensionOptedOut: () => false,
    },
});

mock.module('./ls.js', {
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
const { parseSmartFloatOrNull: _realOrNull } = await import('./roster-data.js?real');
mock.module('./roster-data.js', {
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

const { isDataEmpty, _decodeHours, _varPayForPeriod, resolveHppForPeriod, hppFromYtdTaxable, knownYtdLumps,
        priorHppToStore, updatePriorHpp, calcHPP, readHppState, restoreHppState } = await import('./paycalc-hpp.js');
const { periodKey, hppEstKey, hppActualKey, hppModeKey } = await import('./paycalc-migrations.js');
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

const { hppPayslipForTaxYear } = await import('./paycalc-hpp-schedule.js');
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
