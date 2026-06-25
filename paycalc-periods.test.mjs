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
        lsGet: k      => _ls.has(k) ? _ls.get(k) : null,
        lsSet: (k, v) => { _ls.set(k, String(v)); },
        lsDel: k      => { _ls.delete(k); },
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
        MILLER_ACTUALS:  {},
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
    CONFIG: PC_CONFIG, getPeriods,
    hasBoxingDay, hasBankHoliday,
    _setSelectPeriod, prevPeriod, nextPeriod,
} = await import('./paycalc-periods.js');

const { SK } = await import('./paycalc-migrations.js');

const {
    settingsKey, getContr, getEffectiveContr, getProRateFactor,
} = await import('./paycalc-settings.js');

const { _bpAwardTaxYear } = await import('./paycalc-backpay.js');

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

    test('every consecutive payday is exactly 28 days apart', () => {
        const periods = getPeriods();
        for (let i = 1; i < periods.length; i++) {
            const diffDays = (periods[i].payday - periods[i - 1].payday) / 86400000;
            assert.equal(diffDays, 28,
                `gap P${periods[i-1].num}→P${periods[i].num} should be 28 days`);
        }
    });

    test('first period number is 48 + FIRST_OFFSET and last is 48 + LAST_OFFSET', () => {
        const periods = getPeriods();
        assert.equal(periods[0].num,                  48 + PC_CONFIG.FIRST_OFFSET);
        assert.equal(periods[periods.length - 1].num, 48 + PC_CONFIG.LAST_OFFSET);
    });

    test('each period start is exactly one day after the previous cutoff', () => {
        const periods = getPeriods();
        for (let i = 1; i < periods.length; i++) {
            const prevCutoff = periods[i - 1].cutoff;
            const curStart   = periods[i].start;
            const diffDays   = (curStart - prevCutoff) / 86400000;
            assert.equal(diffDays, 1,
                `P${periods[i].num} start should be the day after P${periods[i-1].num} cutoff`);
        }
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
        const start    = new Date(2026, 0, 11);
        const cutoff   = new Date(2026, 1, 7, 12, 0, 0); // noon — calcProRateFactor invariant
        const startDate = new Date(2026, 0, 25);          // day 15 of the period
        _teamMembersData.push({ name: 'J. Joiner', role: 'CEA', currentWeek: 1, rosterType: 'main', startDate });
        const p    = { start, cutoff, payday: new Date(2026, 1, 13), num: 48 };
        const base = getContr();
        const factor = calcProRateFactor(startDate, start, cutoff);
        assert.ok(factor > 0 && factor < 1, `factor should be (0,1), got ${factor}`);
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
