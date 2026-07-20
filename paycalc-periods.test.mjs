/**
 * Unit tests for:
 *   paycalc-periods.js — period arithmetic, BH/Boxing Day detection, navigation
 *   paycalc-settings.js — pure helpers: getEffectiveContr, getProRateFactor, settingsKey
 *   paycalc-backpay.js  — _bpAwardTaxYear
 *
 * Run: node --experimental-test-module-mocks --test paycalc-periods.test.mjs
 *
 * DOM-dependent functions (buildPeriodSelect, saveSettings, loadSettings,
 * updateTyTabs, updateBhRows, confirmSettings) are not tested here; they belong
 * in a Playwright smoke suite (item 7 of the test plan).
 */
import { test, describe, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { calcProRateFactor } from './paycalc-calc.js';

// ── Mock-controllable state ───────────────────────────────────────────────────

const _ls             = new Map();
let   _session        = null;
const _teamMembersData = [];        // mutated per-test; same reference used by mock
let   _bhDatesForYear = {};         // year → Date[] — controls bhsForYear mock

mock.module('./firebase-client.js', {
    namedExports: {
        auth:                           {},
        authReady:                      Promise.resolve(),
        onAuthStateChanged:             () => () => {},
        signInWithEmailAndPassword:     async () => {},
        createUserWithEmailAndPassword: async () => {},
        signInAnonymously:              async () => {},
        signOut:                        async () => {},
        db:                             null,
        collection:                     () => {},
        query:                          () => {},
        where:                          () => {},
        getDocs:                        async () => ({ forEach: () => {}, docs: [] }),
        COLLECTIONS:                    { overrides: 'overrides', clientErrors: 'clientErrors' },
        nameToEmail:                    n => n + '@test',
        normaliseSurname:               n => n,
    },
});

mock.module('./session.js', {
    namedExports: {
        AUTH_KEY:             'myb_admin_session',
        SESSION_MS:           30 * 24 * 60 * 60 * 1000,
        IDLE_MS:               7 * 24 * 60 * 60 * 1000,
        getSession:           () => _session,
        saveSession:          () => {},
        clearSession:         async () => {},
        ensureFirebaseSession: async () => {},
        sessionReady:         Promise.resolve(),
        resolveSession:       () => {},
        getSurname:           () => '',
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
        teamMembers:     _teamMembersData,
        APP_VERSION:     '13.00',
        CONFIG:          { ADMIN_NAMES: [], LINKS_DESIGNERS: [], MAX_YEAR: 2027, MIN_YEAR: 2025 },
        avatarInitials:  () => '??',
        avatarHue:       () => 0,
        formatISO:       /** @param {Date} d */ d =>
            `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`,
        parseSmartFloat: /** @param {any} v */ v => parseFloat(String(v)),
    },
});

mock.module('./paycalc-roster-suggestions.js', {
    namedExports: {
        bhsForYear:            /** @param {number} y */ y => _bhDatesForYear[y] || [],
        getRosterSuggestion:   async () => ({}),
        fetchOverridesForPeriod: async () => {},
    },
});

const {
    CONFIG: PC_CONFIG, getPeriods, payslipPeriodNum,
    hasBoxingDay, hasBankHoliday,
    _setSelectPeriod, prevPeriod, nextPeriod,
    computeEarliestVisiblePNum, setEarliestVisiblePeriod, getEarliestVisiblePNum,
    visiblePeriods, isTaxYearVisible,
} = await import('./paycalc-periods.js');

const {
    settingsKey, getContr, getEffectiveContr, getProRateFactor,
} = await import('./paycalc-settings.js');

const { _bpAwardTaxYear, raiseByPercent, _accrueBackPayPeriod } = await import('./paycalc-backpay.js');

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Reset all controllable state between tests. */
function reset() {
    _ls.clear();
    _session = null;
    _bhDatesForYear = {};
    _teamMembersData.length = 0;
    delete global.document;
}

/**
 * Build a minimal period object for pure-function tests.
 * start/cutoff are midnight local; payday is 6 days after cutoff.
 * @param {number} sy @param {number} sm @param {number} sd  start year/month(1-12)/day
 * @param {number} cy @param {number} cm @param {number} cd  cutoff year/month/day
 * @param {number} [num]  period number (default 48)
 */
function makePeriod(sy, sm, sd, cy, cm, cd, num = 48) {
    const start  = new Date(sy, sm - 1, sd);
    const cutoff = new Date(cy, cm - 1, cd);
    const payday = new Date(cy, cm - 1, cd + 6);
    return { start, cutoff, payday, num };
}

/**
 * Build a fake <select> element backed by the full period list.
 * @param {number} currentPNum  initially "selected" period number
 */
function makeFakeSel(currentPNum) {
    const options = getPeriods().map(p => ({ value: String(p.num), selected: false }));
    return { value: String(currentPNum), options };
}

// ─────────────────────────────────────────────────────────────────────────────
// paycalc-periods.js — getPeriods
// ─────────────────────────────────────────────────────────────────────────────

describe('getPeriods', () => {
    test('returns LAST_OFFSET − FIRST_OFFSET + 1 periods', () => {
        const expected = PC_CONFIG.LAST_OFFSET - PC_CONFIG.FIRST_OFFSET + 1;
        assert.equal(getPeriods().length, expected);
    });

    test('P48 payday is Friday 13 Feb 2026 (the CONFIG anchor)', () => {
        const p = getPeriods().find(p => p.num === 48);
        assert.ok(p, 'P48 missing');
        assert.equal(p.payday.getFullYear(), 2026);
        assert.equal(p.payday.getMonth(),    1);   // February (0-indexed)
        assert.equal(p.payday.getDate(),     13);
        assert.equal(p.payday.getDay(),      5);   // Friday
    });

    test('P48 cutoff is Saturday 7 Feb 2026 (payday − 6)', () => {
        const p = getPeriods().find(p => p.num === 48);
        assert.ok(p);
        assert.equal(p.cutoff.getDate(),  7);
        assert.equal(p.cutoff.getMonth(), 1);   // February
        assert.equal(p.cutoff.getDay(),   6);   // Saturday
    });

    test('P48 start is Sunday 11 Jan 2026 (cutoff − 27 days)', () => {
        const p = getPeriods().find(p => p.num === 48);
        assert.ok(p);
        assert.equal(p.start.getDate(),  11);
        assert.equal(p.start.getMonth(), 0);   // January
        assert.equal(p.start.getDay(),   0);   // Sunday
    });

    test('every consecutive payday is exactly 28 CALENDAR days apart (DST-safe)', () => {
        // Compare in calendar days, not exact milliseconds: getPeriods() anchors every date at
        // LOCAL noon via setDate arithmetic, so under a DST timezone (TZ=Europe/London — the
        // timezone staff actually live in) a gap that spans a clock change is 28 days ± 1 hour.
        // The old strict ms/86400000 === 28 assertion failed there (P44→P45 spans the autumn
        // change → 28.0417), making `npm test` spuriously red on any UK-configured machine.
        const periods = getPeriods();
        for (let i = 1; i < periods.length; i++) {
            const diffDays = Math.round((periods[i].payday - periods[i - 1].payday) / 86400000);
            assert.equal(diffDays, 28,
                `gap P${periods[i-1].num}→P${periods[i].num} should be 28 calendar days`);
            // And the noon anchor survives every transition — the app's DST-safety invariant.
            assert.equal(periods[i].payday.getHours(), 12,
                `P${periods[i].num} payday must stay anchored at local noon`);
        }
    });

    test('first period number is 48 + FIRST_OFFSET and last is 48 + LAST_OFFSET', () => {
        const periods = getPeriods();
        assert.equal(periods[0].num,                  48 + PC_CONFIG.FIRST_OFFSET);
        assert.equal(periods[periods.length - 1].num, 48 + PC_CONFIG.LAST_OFFSET);
    });

    test('each period start is exactly one CALENDAR day after the previous cutoff (DST-safe)', () => {
        const periods = getPeriods();
        for (let i = 1; i < periods.length; i++) {
            const prevCutoff = periods[i - 1].cutoff;
            const curStart   = periods[i].start;
            // Rounded for the same DST reason as the payday-gap test above (a start landing on a
            // clock-change Sunday makes the exact diff 1 ± 1/24).
            const diffDays   = Math.round((curStart - prevCutoff) / 86400000);
            assert.equal(diffDays, 1,
                `P${periods[i].num} start should be the day after P${periods[i-1].num} cutoff`);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// paycalc-periods.js — payslipPeriodNum (printed payslip number: weeks-into-year, ×4, resets April)
// ─────────────────────────────────────────────────────────────────────────────
describe('payslipPeriodNum', () => {
    const printedFor = num => payslipPeriodNum({ num });

    test('April (first period of a tax year) prints "Period 4"', () => {
        assert.equal(printedFor(37), 4);  // 2025/26 first period (~11 Apr 2025)
        assert.equal(printedFor(50), 4);  // 2026/27 first period (~10 Apr 2026)
    });

    test('the anchor 13 Feb 2026 prints "Period 48"', () => {
        assert.equal(printedFor(48), 48); // 12th period of 2025/26
    });

    test('last period of a tax year prints "Period 52"', () => {
        assert.equal(printedFor(49), 52); // 2025/26 last (13th, ~13 Mar 2026)
        assert.equal(printedFor(62), 52); // 2026/27 last (13th, ~11 Mar 2027)
    });

    test('advances by exactly 4 per period within a tax year', () => {
        assert.equal(printedFor(38), 8);
        assert.equal(printedFor(39), 12);
        assert.equal(printedFor(54), 20); // 31 Jul 2026 — 5th period of 2026/27
    });

    test('resets each April (52 → 4 across the tax-year boundary)', () => {
        assert.equal(printedFor(49), 52); // last of 2025/26
        assert.equal(printedFor(50), 4);  // first of 2026/27
    });

    test('every period prints a multiple of 4 in 4..52', () => {
        for (const p of getPeriods()) {
            const n = payslipPeriodNum(p);
            assert.equal(n % 4, 0, `P(internal ${p.num}) printed ${n} — not a multiple of 4`);
            assert.ok(n >= 4 && n <= 52, `P(internal ${p.num}) printed ${n} — out of 4..52`);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// paycalc-periods.js — member visibility clamp (new starters see "from this year onwards")
// ─────────────────────────────────────────────────────────────────────────────
describe('computeEarliestVisiblePNum', () => {
    const FLOOR = 48 + PC_CONFIG.FIRST_OFFSET; // 37 — first supported period (2025/26)
    const FIRST_2627 = 50;                      // 48 + 2 — first period of 2026/27

    test('no member / no startDate → no clamp (range floor)', () => {
        assert.equal(computeEarliestVisiblePNum(null), FLOOR);
        assert.equal(computeEarliestVisiblePNum({ name: 'X' }), FLOOR);
    });

    test('startDate this tax year (2026/27) → clamped to first period of 2026/27', () => {
        assert.equal(computeEarliestVisiblePNum({ startDate: new Date(2026, 3, 20) }), FIRST_2627); // 20 Apr 2026
        assert.equal(computeEarliestVisiblePNum({ startDate: new Date(2026, 4, 5) }),  FIRST_2627); // 5 May 2026
        assert.equal(computeEarliestVisiblePNum({ startDate: new Date(2026, 5, 3) }),  FIRST_2627); // 3 Jun 2026
    });

    test('startDate in a prior tax year (2025/26) → no effective clamp', () => {
        assert.equal(computeEarliestVisiblePNum({ startDate: new Date(2025, 8, 1) }), FLOOR); // 1 Sep 2025
    });

    test('noProRate secondment return is NOT clamped even with a this-year startDate', () => {
        assert.equal(computeEarliestVisiblePNum({ startDate: new Date(2026, 5, 9), noProRate: true }), FLOOR);
    });
});

describe('setEarliestVisiblePeriod / visiblePeriods / isTaxYearVisible', () => {
    test('a 2026/27 starter sees only 2026/27 periods and tab', () => {
        setEarliestVisiblePeriod({ startDate: new Date(2026, 3, 20) });
        assert.equal(getEarliestVisiblePNum(), 50);
        const nums = visiblePeriods().map(p => p.num);
        assert.ok(nums.every(n => n >= 50), 'no period before P50 (Apr 2026) is visible');
        assert.ok(!nums.includes(49), '2025/26 last period (49) hidden');
        assert.equal(isTaxYearVisible({ first: -11, last: 1 }),  false); // 2025/26 hidden
        assert.equal(isTaxYearVisible({ first: 2,   last: 14 }), true);  // 2026/27 visible
    });

    test('an unclamped member sees the whole range again', () => {
        setEarliestVisiblePeriod(null);
        assert.equal(getEarliestVisiblePNum(), 48 + PC_CONFIG.FIRST_OFFSET);
        assert.equal(visiblePeriods().length, getPeriods().length);
        assert.equal(isTaxYearVisible({ first: -11, last: 1 }), true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// paycalc-periods.js — hasBoxingDay
// ─────────────────────────────────────────────────────────────────────────────

describe('hasBoxingDay', () => {
    test('returns true when period spans 26 Dec', () => {
        assert.ok(hasBoxingDay(makePeriod(2025, 12, 14, 2026, 1, 10)));
    });

    test('returns false when period ends on 25 Dec (cutoff = Dec 25)', () => {
        assert.equal(hasBoxingDay(makePeriod(2025, 11, 28, 2025, 12, 25)), false);
    });

    test('returns false when period starts on 27 Dec (start = Dec 27)', () => {
        assert.equal(hasBoxingDay(makePeriod(2025, 12, 27, 2026, 1, 23)), false);
    });

    test('returns true when 26 Dec is exactly the start date', () => {
        assert.ok(hasBoxingDay(makePeriod(2025, 12, 26, 2026, 1, 22)));
    });

    test('returns true when 26 Dec is exactly the cutoff date', () => {
        assert.ok(hasBoxingDay(makePeriod(2025, 11, 29, 2025, 12, 26)));
    });

    test('returns false for a summer period with no Dec', () => {
        assert.equal(hasBoxingDay(makePeriod(2026, 6, 1, 2026, 6, 28)), false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// paycalc-periods.js — hasBankHoliday
// ─────────────────────────────────────────────────────────────────────────────

describe('hasBankHoliday', () => {
    test('returns false when bhsForYear returns empty (no BH dates)', () => {
        _bhDatesForYear = { 2026: [] };
        assert.equal(hasBankHoliday(makePeriod(2026, 3, 15, 2026, 4, 11)), false);
    });

    test('returns true when a BH falls within the period', () => {
        _bhDatesForYear = { 2026: [new Date(2026, 3, 3)] }; // Good Friday 3 Apr 2026
        assert.ok(hasBankHoliday(makePeriod(2026, 3, 15, 2026, 4, 11)));
    });

    test('returns false when BH is one day before period start', () => {
        _bhDatesForYear = { 2026: [new Date(2026, 3, 2)] }; // 2 Apr — day before start
        assert.equal(hasBankHoliday(makePeriod(2026, 4, 3, 2026, 4, 30)), false);
    });

    test('returns true when BH is exactly the period start date', () => {
        _bhDatesForYear = { 2026: [new Date(2026, 3, 3)] }; // 3 Apr
        assert.ok(hasBankHoliday(makePeriod(2026, 4, 3, 2026, 4, 30)));
    });

    test('returns false when BH is one day after period cutoff', () => {
        _bhDatesForYear = { 2026: [new Date(2026, 3, 4)] }; // 4 Apr — day after cutoff
        assert.equal(hasBankHoliday(makePeriod(2026, 3, 7, 2026, 4, 3)), false);
    });

    test('returns true when BH is exactly the period cutoff date', () => {
        _bhDatesForYear = { 2026: [new Date(2026, 3, 3)] }; // 3 Apr
        assert.ok(hasBankHoliday(makePeriod(2026, 3, 7, 2026, 4, 3)));
    });

    test('handles a period that spans a year boundary (checks both years)', () => {
        // Period: Dec 14 2025 → Jan 10 2026. BH on Jan 1 2026.
        _bhDatesForYear = { 2025: [], 2026: [new Date(2026, 0, 1)] };
        assert.ok(hasBankHoliday(makePeriod(2025, 12, 14, 2026, 1, 10)));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// paycalc-periods.js — _setSelectPeriod
// ─────────────────────────────────────────────────────────────────────────────

describe('_setSelectPeriod', () => {
    test('sets .selected = true on the matching option only', () => {
        const sel = { options: [
            { value: '48', selected: false },
            { value: '49', selected: false },
            { value: '50', selected: false },
        ]};
        _setSelectPeriod(sel, 49);
        assert.equal(sel.options[0].selected, false);
        assert.equal(sel.options[1].selected, true);
        assert.equal(sel.options[2].selected, false);
    });

    test('does not select anything when pNum is not in the options list', () => {
        const sel = { options: [{ value: '48', selected: false }] };
        assert.doesNotThrow(() => _setSelectPeriod(sel, 99));
        assert.equal(sel.options[0].selected, false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// paycalc-periods.js — prevPeriod / nextPeriod
// ─────────────────────────────────────────────────────────────────────────────

describe('prevPeriod / nextPeriod', () => {
    beforeEach(reset);

    test('prevPeriod moves to the preceding period and calls onPeriodChange once', () => {
        const periods = getPeriods();
        const sel = makeFakeSel(periods[1].num);
        global.document = { getElementById: () => sel };
        let calls = 0;
        prevPeriod(() => calls++);
        assert.equal(calls, 1);
        assert.ok(sel.options[0].selected, 'first period option should be selected');
    });

    test('prevPeriod is a no-op at the first period (boundary)', () => {
        const periods = getPeriods();
        const sel = makeFakeSel(periods[0].num);
        global.document = { getElementById: () => sel };
        let calls = 0;
        prevPeriod(() => calls++);
        assert.equal(calls, 0);
    });

    test('nextPeriod moves to the following period and calls onPeriodChange once', () => {
        const periods = getPeriods();
        const sel = makeFakeSel(periods[periods.length - 2].num);
        global.document = { getElementById: () => sel };
        let calls = 0;
        nextPeriod(() => calls++);
        assert.equal(calls, 1);
        assert.ok(sel.options[periods.length - 1].selected, 'last period option should be selected');
    });

    test('nextPeriod is a no-op at the last period (boundary)', () => {
        const periods = getPeriods();
        const sel = makeFakeSel(periods[periods.length - 1].num);
        global.document = { getElementById: () => sel };
        let calls = 0;
        nextPeriod(() => calls++);
        assert.equal(calls, 0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// paycalc-settings.js — settingsKey
// ─────────────────────────────────────────────────────────────────────────────

describe('settingsKey', () => {
    test('replaces "/" with "_" in the tax year label', () => {
        assert.equal(settingsKey({ label: '2025/26' }), 'myb_pc_setup_2025_26');
        assert.equal(settingsKey({ label: '2026/27' }), 'myb_pc_setup_2026_27');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// paycalc-settings.js — getEffectiveContr
// ─────────────────────────────────────────────────────────────────────────────

describe('getEffectiveContr', () => {
    beforeEach(reset);

    test('returns full contracted hours when member has no startDate', () => {
        _session = { name: 'J. Full', exp: Date.now() + 9e9, idle: Date.now() + 9e9 };
        _teamMembersData.push({ name: 'J. Full', role: 'CEA', currentWeek: 1, rosterType: 'main' });
        const p = makePeriod(2026, 5, 10, 2026, 6, 6, 51);
        const base = getContr();
        assert.equal(getEffectiveContr(p), base);
    });

    test('returns pro-rated hours when member started mid-period', () => {
        _session = { name: 'J. Joiner', exp: Date.now() + 9e9, idle: Date.now() + 9e9 };
        // P48: Jan 11 – Feb 7 (noon) 2026 (28 days). Member starts Jan 25.
        const start    = new Date(2026, 0, 11, 12, 0, 0); // noon — calcProRateFactor invariant
        const cutoff   = new Date(2026, 1, 7, 12, 0, 0); // noon — calcProRateFactor invariant
        const startDate = new Date(2026, 0, 25);          // day 15 of the period
        _teamMembersData.push({ name: 'J. Joiner', role: 'CEA', currentWeek: 1, rosterType: 'main', startDate });
        const p    = { start, cutoff, payday: new Date(2026, 1, 13), num: 48 };
        const base = getContr();
        const factor = calcProRateFactor(startDate, start, cutoff);
        assert.ok(factor > 0 && factor < 1, `factor should be (0,1), got ${factor}`);
        assert.equal(getEffectiveContr(p), 75, 'Math.round(140 * 15/28) = 75');
        assert.equal(getEffectiveContr(p), Math.round(base * factor));
    });

    test('returns full hours for noProRate member even with a mid-period startDate', () => {
        _session = { name: 'J. Return', exp: Date.now() + 9e9, idle: Date.now() + 9e9 };
        const startDate = new Date(2026, 0, 25);
        _teamMembersData.push({ name: 'J. Return', role: 'CEA', currentWeek: 1, rosterType: 'main', startDate, noProRate: true });
        const p = makePeriod(2026, 1, 11, 2026, 2, 7, 48);
        assert.equal(getEffectiveContr(p), getContr(), 'noProRate suppresses pro-rating');
    });

    test('returns full hours when startDate is before period start (already employed full period)', () => {
        _session = { name: 'J. Senior', exp: Date.now() + 9e9, idle: Date.now() + 9e9 };
        _teamMembersData.push({ name: 'J. Senior', role: 'CEA', currentWeek: 1, rosterType: 'main',
            startDate: new Date(2025, 0, 1) });
        const p = makePeriod(2026, 1, 11, 2026, 2, 7, 48);
        assert.equal(getEffectiveContr(p), getContr());
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// paycalc-settings.js — getProRateFactor
// ─────────────────────────────────────────────────────────────────────────────

describe('getProRateFactor', () => {
    beforeEach(reset);

    test('returns 1 when member has no startDate (full period)', () => {
        _session = { name: 'J. Full', exp: Date.now() + 9e9, idle: Date.now() + 9e9 };
        _teamMembersData.push({ name: 'J. Full', role: 'CEA', currentWeek: 1, rosterType: 'main' });
        const p = makePeriod(2026, 1, 11, 2026, 2, 7, 48);
        assert.equal(getProRateFactor(p), 1);
    });

    test('returns fraction < 1 when member joined mid-period', () => {
        _session = { name: 'J. Mid', exp: Date.now() + 9e9, idle: Date.now() + 9e9 };
        const startDate = new Date(2026, 0, 25);
        _teamMembersData.push({ name: 'J. Mid', role: 'CEA', currentWeek: 1, rosterType: 'main', startDate });
        const p = { start: new Date(2026, 0, 11), cutoff: new Date(2026, 1, 7, 12), payday: new Date(2026, 1, 13), num: 48 };
        const f = getProRateFactor(p);
        assert.ok(f > 0 && f < 1, `factor should be in (0,1), got ${f}`);
    });

    test('returns 1 for noProRate member regardless of startDate', () => {
        _session = { name: 'J. NoP', exp: Date.now() + 9e9, idle: Date.now() + 9e9 };
        _teamMembersData.push({ name: 'J. NoP', role: 'CEA', currentWeek: 1, rosterType: 'main',
            startDate: new Date(2026, 0, 20), noProRate: true });
        const p = makePeriod(2026, 1, 11, 2026, 2, 7, 48);
        assert.equal(getProRateFactor(p), 1);
    });

    test('returns 1 when no session is active (getLoggedMember() → null)', () => {
        _session = null;
        const p = makePeriod(2026, 1, 11, 2026, 2, 7, 48);
        assert.equal(getProRateFactor(p), 1);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// paycalc-backpay.js — _bpAwardTaxYear
// ─────────────────────────────────────────────────────────────────────────────

describe('_bpAwardTaxYear', () => {
    beforeEach(reset);

    test('returns 2025/26 for P48 (offset 0, within first=-11..last=1)', () => {
        assert.equal(_bpAwardTaxYear(48).label, '2025/26');
    });

    test('returns 2026/27 for P50 (offset 2, within first=2..last=14)', () => {
        assert.equal(_bpAwardTaxYear(50).label, '2026/27');
    });

    test('returns 2025/26 for P37 (first period, offset -11)', () => {
        assert.equal(_bpAwardTaxYear(37).label, '2025/26');
    });

    test('returns 2026/27 for P62 (last period, offset 14)', () => {
        assert.equal(_bpAwardTaxYear(62).label, '2026/27');
    });

    test('falls back to currentPeriodNum when fromPNum is 0', () => {
        // Stub DOM so currentPeriodNum() returns P48 (2025/26)
        global.document = { getElementById: () => ({ value: '48' }) };
        assert.equal(_bpAwardTaxYear(0).label, '2025/26');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// paycalc-backpay.js — raiseByPercent (the "Pay rise %" shortcut maths)
// ─────────────────────────────────────────────────────────────────────────────

describe('raiseByPercent', () => {
    test('applies a 3.6% rise to the CEA hourly rate', () => {
        assert.ok(Math.abs(raiseByPercent(20.74, 3.6) - 21.48664) < 1e-5);
    });

    test('applies a 3.6% rise to the London Allowance', () => {
        assert.ok(Math.abs(raiseByPercent(276.16, 3.6) - 286.101760) < 1e-4);
    });

    test('rounds (via caller .toFixed) to the expected CES new rate', () => {
        assert.equal(raiseByPercent(21.81, 3.6).toFixed(2), '22.60');
    });

    test('returns 0 when the old value is missing or non-positive', () => {
        assert.equal(raiseByPercent(0, 3.6), 0);
        assert.equal(raiseByPercent(-5, 3.6), 0);
        assert.equal(raiseByPercent(NaN, 3.6), 0);
    });

    test('returns 0 when the percentage is missing or non-positive', () => {
        assert.equal(raiseByPercent(20.74, 0), 0);
        assert.equal(raiseByPercent(20.74, -1), 0);
        assert.equal(raiseByPercent(20.74, NaN), 0);
    });

    test('a small percentage still returns a positive scaled value', () => {
        assert.ok(raiseByPercent(100, 0.5) > 100);
        assert.ok(Math.abs(raiseByPercent(100, 0.5) - 100.5) < 1e-9); // 1.005 is not exact in FP
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// paycalc-backpay.js — _accrueBackPayPeriod (pure per-period back-pay arithmetic)
// ─────────────────────────────────────────────────────────────────────────────
describe('_accrueBackPayPeriod', () => {
    // Real 2025/26 CEA award figures: rate £20.06 → £20.74, London £267.08 → £276.16.
    const RATE_DIFF   = 20.74 - 20.06;   // 0.68/hr
    const LONDON_DIFF = 276.16 - 267.08; // 9.08/period
    const approx = (actual, expected, msg, tol = 1e-9) =>
        assert.ok(Math.abs(actual - expected) <= tol, `${msg}: got ${actual}, want ${expected}`);
    const base = { effContr: 140, proRateFactor: 1, rateDiff: RATE_DIFF, londonDiff: LONDON_DIFF };

    test('contracted-only period (no hours entered): contracted + London in the lump, none accrues HPP', () => {
        const { backPay, varPay } = _accrueBackPayPeriod({ ...base, hours: {} });
        approx(backPay, 140 * RATE_DIFF + LONDON_DIFF, 'backPay'); // £104.28 — matches the rendered rows
        approx(varPay, 0, 'varPay excludes contracted basic AND London (London does not accrue HPP, v17.23)');
    });

    test('premium buckets scale by their multipliers (RDW 1.25 · Sun 1.5 · Boxing 3.0)', () => {
        const { backPay, varPay } = _accrueBackPayPeriod({
            ...base, hours: { rdwHrs: 8, sunHrs: 8, boxHrs: 8 },
        });
        const premium = 8 * RATE_DIFF * 1.25 + 8 * RATE_DIFF * 1.5 + 8 * RATE_DIFF * 3;
        approx(backPay, 140 * RATE_DIFF + premium + LONDON_DIFF, 'backPay');
        approx(varPay, premium, 'varPay = premiums only (excludes London — London does not accrue HPP)');
    });

    test('Saturday hours cap at contracted; BH caps at the remaining normal hours', () => {
        // 150 Sat hours on a 140h contract → capped 140, leaving 0 normal hours, so BH caps to 0.
        const { backPay } = _accrueBackPayPeriod({ ...base, hours: { satHrs: 150, bhHrs: 10 } });
        approx(backPay, 140 * RATE_DIFF + 140 * RATE_DIFF * 0.25 + LONDON_DIFF, 'sat capped, bh squeezed out');
    });

    test('peer-training days add to backPay (2h/day at basic) but NOT to varPay', () => {
        const withPeer = _accrueBackPayPeriod({ ...base, peer: 2, hours: {} });
        const without  = _accrueBackPayPeriod({ ...base, hours: {} });
        approx(withPeer.backPay - without.backPay, 2 * 2 * RATE_DIFF, 'peer adds 2h/day of rate diff');
        approx(withPeer.varPay, without.varPay, 'varPay unchanged by peer');
    });

    test('pre-start period (effContr 0, factor 0) accrues nothing', () => {
        const { backPay, varPay } = _accrueBackPayPeriod({
            effContr: 0, proRateFactor: 0, rateDiff: RATE_DIFF, londonDiff: LONDON_DIFF, hours: {},
        });
        assert.equal(backPay, 0);
        assert.equal(varPay, 0);
    });

    test('London-only award (no rate change): the lump is pro-rated London arrears, but NONE of it accrues HPP', () => {
        const { backPay, varPay } = _accrueBackPayPeriod({
            effContr: 70, proRateFactor: 0.5, rateDiff: 0, londonDiff: LONDON_DIFF, hours: { rdwHrs: 8 },
        });
        approx(backPay, LONDON_DIFF * 0.5, 'rateDiff 0 zeroes every hours bucket; only London arrears remain');
        approx(varPay, 0, 'varPay = 0 — London does not accrue HPP');
    });
});
