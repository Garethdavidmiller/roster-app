/**
 * paycalc-grade-wiring.test.mjs — the dated grade THROUGH the module that prices a payslip.
 * Run: node --experimental-test-module-mocks scripts/run-tests.mjs paycalc-grade-wiring.test.mjs
 *
 * paycalc-grade.test.mjs proves the rules on hand-built payslips. This proves the production path
 * reaches them: the REAL period table, the REAL settings module (periodRate, getContr,
 * settledRateFor, awardGrade) and the REAL roster rows, with only the leaves stubbed — Firebase, the
 * session, storage — exactly as paycalc-settings.test.mjs does. A helper can be perfect and the
 * figure still wrong, because the line that calls it passed the wrong grade; these are the tests
 * that would see that.
 *
 * The grade setting is pinned to 'roster' — the default since grades had dates — before the
 * settings module first reads it (it caches the setting), so every case here is priced by the
 * roster's dates.
 */
import { test, describe, before, mock } from 'node:test';
import assert from 'node:assert/strict';

const _ls = new Map();
/** @type {{ name: string }|null} */
let _session = null;
/** The roster the module under test reads: the REAL rows, plus any a case adds. */
const _members = /** @type {any[]} */ ([]);

mock.module('./firebase-client.js', {
    namedExports: {
        auth: {}, authReady: Promise.resolve(), onAuthStateChanged: () => () => {},
        signInWithEmailAndPassword: async () => {}, createUserWithEmailAndPassword: async () => {},
        signInAnonymously: async () => {}, signOut: async () => {}, db: null,
        collection: () => {}, query: () => {}, where: () => {},
        getDocs: async () => ({ forEach: () => {}, docs: [] }),
        COLLECTIONS: { overrides: 'overrides', clientErrors: 'clientErrors' },
        nameToEmail: (/** @type {string} */ n) => n + '@test', normaliseSurname: (/** @type {string} */ n) => n,
    },
});
mock.module('./session.js', {
    namedExports: {
        AUTH_KEY: 'myb_admin_session', SESSION_MS: 1,
        getSession: () => _session, saveSession: () => {}, clearSession: async () => {},
        ensureFirebaseSession: async () => {}, sessionReady: Promise.resolve(),
        resolveSession: () => {},
    },
});
mock.module('./ls.js', {
    namedExports: {
        lsGet: (/** @type {string} */ k) => (_ls.has(k) ? _ls.get(k) : null),
        lsSet: (/** @type {string} */ k, /** @type {any} */ v) => { _ls.set(k, String(v)); },
        lsDel: (/** @type {string} */ k) => { _ls.delete(k); }, lsKeys: () => [..._ls.keys()],
        lsSetVerified: (/** @type {string} */ k, /** @type {any} */ v) => { _ls.set(k, String(v)); return true; },
        lsMove: () => false,
    },
});
const _realRosterData = await import('./roster-data.js?real');
mock.module('./roster-data.js', {
    namedExports: {
        teamMembers: _members, APP_VERSION: '13.00',
        CONFIG: { ADMIN_NAMES: [], LINKS_DESIGNERS: [], MAX_YEAR: 2027, MIN_YEAR: 2025 },
        formatISO: _realRosterData.formatISO,
        parseSmartFloat: (/** @type {any} */ v) => parseFloat(String(v)),
        parseSmartFloatOrNull: _realRosterData.parseSmartFloatOrNull,
        // The REAL rule: a copy here would make these tests about the copy.
        gradeForRole: _realRosterData.gradeForRole,
    },
});
mock.module('./paycalc-roster-suggestions.js', {
    namedExports: { bhsForYear: () => [], getRosterSuggestion: async () => ({}), fetchOverridesForPeriod: async () => {} },
});
// awardGrade's last resort reads the payslip selector; with none on screen it falls to today's.
/** @type {any} */ (globalThis).document ??= { getElementById: (/** @type {string} */ id) => (id === 'periodSelect' ? { value: '' } : null) };

const { SK } = await import('./paycalc-migrations.js');
const { periodRate, getContr, settledRateFor, awardGrade, gradeDaysFor, getEffectiveContr } = await import('./paycalc-settings.js');
const { GRADES, AWARD_RATES, TAX_YEARS, awardRatesFor, awardFromForYear, getRateForPeriod, isPreAwardPeriod, taxYearForPeriod } = await import('./paycalc-calc.js');
const { getPeriods } = await import('./paycalc-periods.js');
const { gradeDays, windowGrade, FROM_ROSTER } = await import('./paycalc-grade.js');
const { teamMembers } = await import('./roster-member-data.js');
_members.push(...teamMembers);

before(() => { _ls.set(SK.grade, FROM_ROSTER); });

/** The period paid on a date. @param {number} y @param {number} m 1-based @param {number} d */
const paidOn = (y, m, d) => {
    const p = getPeriods().find((/** @type {any} */ x) => x.payday.getFullYear() === y && x.payday.getMonth() === m - 1 && x.payday.getDate() === d);
    assert.ok(p, `a payslip is paid on ${d}/${m}/${y}`);
    return p;
};
const day = (/** @type {Date} */ d) => d.toDateString();
const rate2627 = (/** @type {string} */ g) => /** @type {any} */ (AWARD_RATES)[g]['2026/27'].rate;
const PROMOTED = 'K. Jedlinski';

describe('the three payslips around the promotion, priced through the settings module', () => {
    const BEFORE = paidOn(2026, 11, 20), ACROSS = paidOn(2026, 12, 18), AFTER = paidOn(2027, 1, 15);

    test('the real period table has the dates paycalc-grade.test.mjs builds by hand', () => {
        assert.deepEqual([day(BEFORE.start), day(BEFORE.cutoff)], [day(new Date(2026, 9, 18)), day(new Date(2026, 10, 14))]);
        assert.deepEqual([day(ACROSS.start), day(ACROSS.cutoff)], [day(new Date(2026, 10, 15)), day(new Date(2026, 11, 12))]);
        assert.deepEqual([day(AFTER.start), day(AFTER.cutoff)], [day(new Date(2026, 11, 13)), day(new Date(2027, 0, 9))]);
        assert.deepEqual([BEFORE.num, ACROSS.num, AFTER.num], [58, 59, 60]);
    });

    test('each payslip is priced at the grade held on its days: CEA, the blend by days, CES', () => {
        _session = { name: PROMOTED };
        const ty = taxYearForPeriod(ACROSS);
        assert.deepEqual(periodRate(ty, BEFORE), { rate: rate2627('cea'), preAward: false });
        assert.deepEqual(periodRate(ty, ACROSS), { rate: (7 * rate2627('cea') + 21 * rate2627('ces')) / 28, preAward: false });
        assert.deepEqual(periodRate(taxYearForPeriod(AFTER), AFTER), { rate: rate2627('ces'), preAward: false });
        // Today's figures, written out, so a reader can hold them against the real payslips.
        assert.deepEqual([BEFORE, ACROSS, AFTER].map(p => periodRate(taxYearForPeriod(p), p).rate.toFixed(4)), ['21.4900', '22.3225', '22.6000']);
    });

    test('the contracted hours are 140 on each, so the payslip across the change pays £3,125.15 basic', () => {
        _session = { name: PROMOTED };
        for (const p of [BEFORE, ACROSS, AFTER]) {
            assert.equal(getContr(p), GRADES.cea.contr);
            assert.equal(getEffectiveContr(p), 140, 'a full payslip — the join date was in June');
        }
        const { rate } = periodRate(taxYearForPeriod(ACROSS), ACROSS);
        assert.equal(Math.round(rate * getEffectiveContr(ACROSS) * 100) / 100, 3125.15);
    });

    test('the Holiday Pay Premium estimate prices each payslip at its own grade\'s settled rate', () => {
        _session = { name: PROMOTED };
        assert.equal(settledRateFor(BEFORE), rate2627('cea'));
        assert.equal(settledRateFor(ACROSS), (7 * rate2627('cea') + 21 * rate2627('ces')) / 28);
        assert.equal(settledRateFor(AFTER), rate2627('ces'));
    });

    test('nobody signed in: CEA stands in, as it always has, until the page refuses', () => {
        _session = null;
        assert.deepEqual(gradeDaysFor(ACROSS), [{ grade: 'cea', days: 28 }]);
    });
});

describe('a member who never changed grade is priced exactly as before, on every payslip', () => {
    // What periodRate answered before grades had dates, for a member whose saved grade was their
    // role's: the stored grade's settled rate, or its pre-award rate before the year's pay rise.
    const before = (/** @type {any} */ p, /** @type {string} */ g) => {
        const ty = taxYearForPeriod(p);
        const award = awardRatesFor(g, ty.label);
        const settled = (award && award.rate != null ? award.rate : 0) || GRADES[g].rate;
        const preAward = isPreAwardPeriod(p, g, ty.label);
        return { settled, rate: preAward ? getRateForPeriod(p, g, ty.label, settled) : settled, preAward };
    };

    test('the rate field, the contracted hours and the Holiday Pay Premium rate, to the last binary digit', () => {
        let checked = 0;
        for (const m of teamMembers.filter(x => !x.roleHistory?.length && _realRosterData.gradeForRole(x.role))) {
            _session = { name: m.name };
            const g = /** @type {string} */ (_realRosterData.gradeForRole(m.role));
            for (const p of getPeriods()) {
                const was = before(p, g);
                const now = periodRate(taxYearForPeriod(p), p);
                assert.ok(Object.is(now.rate, was.rate), `${m.name}, payslip ${p.num}: ${now.rate} was ${was.rate}`);
                assert.equal(now.preAward, was.preAward);
                assert.equal(getContr(p), GRADES[g].contr);
                assert.ok(Object.is(settledRateFor(p), was.settled), `${m.name}, payslip ${p.num}: settled ${settledRateFor(p)} was ${was.settled}`);
                checked++;
            }
        }
        assert.ok(checked > 500, `premise: the sweep reached the roster (${checked} payslips)`);
    });
});

describe('back pay is priced at the grade of the months the award covers', () => {
    const TY2627 = /** @type {any} */ (TAX_YEARS.find(t => t.label === '2026/27'));

    test('a member promoted after an award was paid is owed it at the grade they held while earning it', (t) => {
        _session = { name: PROMOTED };
        for (const now of [new Date(2026, 10, 13, 10), new Date(2027, 0, 20, 10)]) {
            t.mock.timers.enable({ apis: ['Date'], now });
            assert.equal(awardGrade(TY2627), 'cea', `on ${now.toDateString()}`);
            t.mock.timers.reset();
        }
    });

    test('a member on one grade is priced at it', (t) => {
        t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 10, 13, 10) });
        _session = { name: 'F. Mohamed' };
        assert.equal(awardGrade(TY2627), 'ces');
        _session = { name: 'G. Miller' };
        assert.equal(awardGrade(TY2627), 'cea');
    });

    test('a window that spans a change is priced at the later grade, and says so in the log', (t) => {
        t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 10, 13, 10) });
        const warn = t.mock.method(console, 'warn', () => {});
        _members.push({ name: 'Test Mid-Window', role: 'CES', roleHistory: [{ role: 'CEA', until: new Date(2026, 5, 6) }] });
        try {
            _session = { name: 'Test Mid-Window' };
            assert.equal(awardGrade(TY2627), 'ces');
            assert.equal(warn.mock.callCount(), 1);
            assert.match(String(warn.mock.calls[0].arguments[0]), /2026\/27 award window spans a change of grade/);
        } finally {
            _members.pop();
        }
    });
});

describe('THE DATA — no grade on the roster changes inside an award\'s backdated months', () => {
    test('every dated grade falls outside every award window', () => {
        // The back-pay card prices ONE grade's old and new rates over the months an award was
        // backdated to (awardGrade). A promotion inside those months would need the lump split by
        // grade, which nothing does yet: this fails the commit that dates one there, so the split
        // is decided — with the real payslip in hand — before it can be priced wrong.
        let windows = 0;
        for (const ty of TAX_YEARS) {
            const from = awardFromForYear(ty.label);
            if (!from) continue;
            const months = getPeriods().filter((/** @type {any} */ p) => taxYearForPeriod(p) === ty && p.payday < from);
            assert.ok(months.length > 0, `premise: the ${ty.label} award has backdated months`);
            windows++;
            for (const m of teamMembers.filter(x => x.roleHistory?.length)) {
                const parts = months.flatMap((/** @type {any} */ p) => gradeDays(m, p, { grade: FROM_ROSTER, from: 0 }));
                assert.equal(windowGrade(parts).mixed, false, `${m.name} changes grade inside the ${ty.label} award's backdated months`);
            }
        }
        assert.ok(windows >= 2, `premise: the award table was read (${windows} windows)`);
    });
});
