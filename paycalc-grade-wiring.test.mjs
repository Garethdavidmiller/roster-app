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
// awardGrade's last resort reads the payslip selector; with none on screen it falls to today's. The
// premium estimate reads it too, for the tax year on screen, and writes its figures into the card —
// so a case may put a payslip on screen and give the card the boxes it reads; each puts them back.
const _periodSelect = { value: '' };
/** @type {Record<string, any>} */
const _els = {};
/** @type {any} */ (globalThis).document ??= {
    getElementById: (/** @type {string} */ id) => (id === 'periodSelect' ? _periodSelect : (_els[id] ?? null)),
    querySelector: () => null,
};

const { SK, periodKey, hppEstKey, ytdSrcKey } = await import('./paycalc-migrations.js');
const { periodRate, getContr, settledRate, settledRateFor, awardGrade, gradeDaysFor, getEffectiveContr } = await import('./paycalc-settings.js');
const { GRADES, AWARD_RATES, TAX_YEARS, awardRatesFor, awardFromForYear, getRateForPeriod, isPreAwardPeriod, taxYearForPeriod,
    computeGross, getLondonAllowanceForPeriod, HPP_FRACTION } = await import('./paycalc-calc.js');
const { getPeriods } = await import('./paycalc-periods.js');
const { gradeDays, windowGrade, FROM_ROSTER } = await import('./paycalc-grade.js');
const { teamMembers } = await import('./roster-member-data.js');
_members.push(...teamMembers);
// The two surfaces that price a WHOLE YEAR at once, loaded for real.
const { computeYearSoFar } = await import('./paycalc-year-summary.js');
const { calcHPP, _varPayForPeriod, _decodeHours, savedPeriodPension } = await import('./paycalc-hpp.js');

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

describe('the promoted member\'s whole year: every payslip at its own grade, through the real surfaces', () => {
    // periodRate and settledRateFor are pinned above. These run the REAL surfaces that price a whole
    // tax year at once — "This tax year so far", the Holiday Pay Premium estimate from the hours, and
    // its rough Year to Date version — because the risk there is not the rule but the call: a loop
    // that asks with the payslip on screen, or with the grade held today, prices every payslip at one
    // grade, and every figure it shows still looks plausible.
    const P = [paidOn(2026, 11, 20), paidOn(2026, 12, 18), paidOn(2027, 1, 15)];
    // Paid, and settled, at these: all three are after the year's award, so the two are the same.
    const RATES = [rate2627('cea'), (7 * rate2627('cea') + 21 * rate2627('ces')) / 28, rate2627('ces')];
    const TY = taxYearForPeriod(P[1]);
    const HOURS = { otH: 10, otM: 0, satH: 7, satM: 30 };   // premium hours: the premium is 7.69% of them
    /** Put HOURS on the three payslips under the member signed in, run `fn`, and take them off again. */
    const withHours = (/** @type {() => void} */ fn) => {
        const keys = P.map(p => periodKey(p.num));
        for (const k of keys) _ls.set(k, JSON.stringify(HOURS));
        try { fn(); } finally { for (const k of keys) _ls.delete(k); }
    };

    test('This tax year so far adds each payslip at its own rate', () => {
        _session = { name: PROMOTED };
        withHours(() => {
            const out = computeYearSoFar(TY, { taxCode: '1257L', plan: 'none', pgLoan: false, now: new Date(2027, 0, 16, 12) });
            assert.equal(out.entered, 3, 'premise: the three payslips were read');
            const priced = (/** @type {number[]} */ rates) => P.reduce((s, p, i) => {
                const h = _decodeHours(p, HOURS);
                const g = computeGross({
                    rate: rates[i], effContr: getEffectiveContr(p),
                    satHrs: h.satHrs, bhHrs: h.bhHrs, bhOtHrs: h.bhOtHrs,
                    oHrs: h.otHrs, rHrs: h.rdwHrs, sHrs: h.sunHrs, bHrs: h.boxHrs,
                    peerDays: 0, london: getLondonAllowanceForPeriod(p, TY), otherAdj: 0,
                });
                return s + Math.max(0, g.gross - savedPeriodPension(p, HOURS, 1));
            }, 0);
            const want = priced(RATES);
            assert.ok(Math.abs(out.taxable - want) < 1e-6, `the year's pay ${out.taxable}, want ${want}`);
            // What makes it a test: priced at one grade all year, the same hours come to another figure.
            assert.ok(Math.abs(priced(RATES.map(() => rate2627('cea'))) - want) > 100, 'premise: the grades are far apart');
            assert.ok(Math.abs(priced(RATES.map(() => rate2627('ces'))) - want) > 100, 'premise: the grades are far apart');
        });
    });

    test('the Holiday Pay Premium from the hours prices each payslip at its own grade', () => {
        _session = { name: PROMOTED };
        _periodSelect.value = String(P[2].num);
        try {
            withHours(() => {
                calcHPP();
                const want = (P.reduce((s, p, i) => s + _varPayForPeriod(p, HOURS, RATES[i]), 0) * HPP_FRACTION).toFixed(2);
                assert.equal(_ls.get(hppEstKey(TY)), want);
                const oneGrade = (P.reduce((s, p) => s + _varPayForPeriod(p, HOURS, rate2627('ces')), 0) * HPP_FRACTION).toFixed(2);
                assert.notEqual(oneGrade, want, 'premise: one grade all year is a different figure');
            });
        } finally {
            _periodSelect.value = '';
            _ls.delete(hppEstKey(TY));
        }
    });

    test('the rough Year to Date premium takes off each payslip\'s basic pay at its own rate', () => {
        // The same Taxable Pay figure, the same start date and the same everything else, for the
        // promoted member and for a colleague who stayed a CEA: the only difference in what the two
        // are expected to have been paid as basic is the CES days, so that is the only difference
        // in the premium left over — 140 hours at the difference in rate on the payslip across the
        // change (by its days) and on the one after it, at 7.69%.
        const promoted = /** @type {any} */ (_members.find(m => m.name === PROMOTED));
        _members.push({ ...promoted, name: 'Test Stayed CEA', role: 'CEA', roleHistory: undefined });
        _periodSelect.value = String(P[2].num);
        Object.assign(_els, { ytdPay: { value: '60000' }, hppModeYtdAmt: { textContent: '' } });
        const shown = (/** @type {string} */ name) => {
            _session = { name };
            _ls.set(ytdSrcKey(TY), String(P[2].num));
            try {
                calcHPP();
                const m = /^≈ £([\d,]+\.\d\d)$/.exec(_els.hppModeYtdAmt.textContent);
                assert.ok(m, `the card shows a figure for ${name}: "${_els.hppModeYtdAmt.textContent}"`);
                return Number(m[1].replace(/,/g, ''));
            } finally {
                _ls.delete(ytdSrcKey(TY));
                _ls.delete(hppEstKey(TY));
            }
        };
        try {
            const stayed = shown('Test Stayed CEA');
            const moved  = shown(PROMOTED);
            const want = 140 * ((RATES[1] - rate2627('cea')) + (RATES[2] - rate2627('cea'))) * HPP_FRACTION;
            assert.ok(Math.abs((stayed - moved) - want) <= 0.011,
                `the premium is £${(stayed - moved).toFixed(2)} lower for the promoted member, want £${want.toFixed(2)}`);
        } finally {
            _members.pop();
            _periodSelect.value = '';
            delete _els.ytdPay; delete _els.hppModeYtdAmt;
        }
    });

    test('last year\'s premium, shown beside this year\'s, prices each of last year\'s payslips at its own grade', () => {
        // No grade on the roster changes inside a year the calculator shows as "last year" yet, so
        // the case is the plainest one the line must still get right: a CES all along is priced at
        // last year's CES rate, not at the CEA one a payslip asked about wrongly falls back to.
        const ces = /** @type {any} */ (teamMembers.find(m => m.role === 'CES' && !m.roleHistory?.length && !m.startDate));
        assert.ok(ces, 'premise: a CES who has been here since before last year');
        const prior = /** @type {any} */ (TAX_YEARS.find(t => t.label === '2025/26'));
        const lastYears = getPeriods().find((/** @type {any} */ p) => taxYearForPeriod(p) === prior && p.num === 48);
        assert.ok(lastYears, 'premise: payslip 48 is last year\'s');
        assert.notEqual(settledRate('ces', prior), settledRate('cea', prior), 'premise: the two grades are priced apart');
        _session = { name: ces.name };
        _periodSelect.value = String(P[2].num);
        _els.priorHppSection = { classList: { add() {}, remove() {}, toggle() {} } };
        const key = periodKey(lastYears.num);
        _ls.set(key, JSON.stringify(HOURS));
        try {
            calcHPP();
            const want = (_varPayForPeriod(lastYears, HOURS, settledRate('ces', prior)) * HPP_FRACTION).toFixed(2);
            assert.equal(_ls.get(hppEstKey(prior)), want);
        } finally {
            _ls.delete(key);
            _ls.delete(hppEstKey(prior));
            _ls.delete(hppEstKey(TY));
            _periodSelect.value = '';
            delete _els.priorHppSection;
        }
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
