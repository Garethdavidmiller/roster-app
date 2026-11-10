/**
 * Unit tests for the money-critical grade lookups in paycalc-settings.js:
 *   gradeForRole (which pay grade a member's ROLE is — see its own block at the foot of this file),
 *   getStoredRateForYear (the hourly rate for a tax year) and getPensionDefault (the period's
 *   default pension). These were previously ONLY ever mocked (paycalc-hpp/-year-summary tests
 *   mock the whole module), so a regression in the wrapper — e.g. delegating to the wrong grade,
 *   or losing the award/period lookup — would ship green. The underlying maths (AWARD_RATES,
 *   awardRatesFor, getPensionForPeriod, PENSION_STEPS) is covered by paycalc.test.mjs; here we
 *   assert the WRAPPERS delegate to it correctly (compared against the real functions, not magic
 *   numbers, so award/pension figure changes don't churn this file).
 *
 * Run: node --experimental-test-module-mocks --test paycalc-settings.test.mjs
 * Mock strategy mirrors paycalc-periods.test.mjs (firebase-client / session / ls / roster-data /
 * roster-suggestions stubbed; paycalc-calc + paycalc-migrations are REAL).
 */
import { test, describe, before, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

const _ls = new Map();
let _session = null;
/** The roster the module under test reads. Mutable so a case can BE a joiner: `getLoggedMember`
 *  finds the session name in here, and everything pro-rate hangs off what it finds. */
const _members = /** @type {any[]} */ ([]);

mock.module('./firebase-client.js', {
    namedExports: {
        auth: {}, authReady: Promise.resolve(), onAuthStateChanged: () => () => {},
        signInWithEmailAndPassword: async () => {}, createUserWithEmailAndPassword: async () => {},
        signInAnonymously: async () => {}, signOut: async () => {}, db: null,
        collection: () => {}, query: () => {}, where: () => {},
        getDocs: async () => ({ forEach: () => {}, docs: [] }),
        COLLECTIONS: { overrides: 'overrides', clientErrors: 'clientErrors' },
        nameToEmail: n => n + '@test', normaliseSurname: n => n,
    },
});
mock.module('./session.js', {
    namedExports: {
        AUTH_KEY: 'myb_admin_session', SESSION_MS: 1,
        getSession: () => _session, saveSession: () => {}, clearSession: async () => {},
        ensureFirebaseSession: async () => {}, sessionReady: Promise.resolve(),
        resolveSession: () => {}, getSurname: () => '',
    },
});
mock.module('./ls.js', {
    namedExports: {
        lsGet: k => _ls.has(k) ? _ls.get(k) : null,
        lsSet: (k, v) => { _ls.set(k, String(v)); },
        lsDel: k => { _ls.delete(k); }, lsKeys: () => [..._ls.keys()],
        // Real semantics, not an always-succeeds stub: the Map cannot fail, so these mirror
        // what ls.js does when storage works.
        lsSetVerified: (k, v) => { _ls.set(k, String(v)); return true; },
        lsMove: (a, b, v) => {
            const val = v === undefined ? (_ls.has(a) ? _ls.get(a) : null) : v;
            if (val === null) return false;
            _ls.set(b, String(val)); _ls.delete(a); return true;
        },
    },
});
// The REAL money parser, reached past the mock below via `?real` (roster-data.js loads in Node):
// the confirmSettings block pastes "£151.86", and a stub parseFloat would test the stub.
const _realRosterData = await import('./roster-data.js?real');
mock.module('./roster-data.js', {
    namedExports: {
        teamMembers: _members, APP_VERSION: '13.00',
        CONFIG: { ADMIN_NAMES: [], LINKS_DESIGNERS: [], MAX_YEAR: 2027, MIN_YEAR: 2025 },
        formatISO: d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`,
        parseSmartFloat: v => parseFloat(String(v)),
        parseSmartFloatOrNull: _realRosterData.parseSmartFloatOrNull,
        // The REAL rule (v24.86: it lives in roster-data.js now, re-exported by paycalc-settings.js).
        // A copy here would turn the gradeForRole block below into a test of the copy.
        gradeForRole: _realRosterData.gradeForRole,
    },
});
mock.module('./paycalc-roster-suggestions.js', {
    namedExports: { bhsForYear: () => [], getRosterSuggestion: async () => ({}), fetchOverridesForPeriod: async () => {} },
});

const { SK, periodKey } = await import('./paycalc-migrations.js');
const {
    getStoredRateForYear, getPensionDefault, isPensionOptedOut, gradeForRole,
    periodDefaultPension, getProRateFactor, getEffectiveContr, periodRate,
} = await import('./paycalc-settings.js');
const { awardRatesFor, getPensionForPeriod, GRADES, computeGross, getRateForPeriod, getLondonAllowanceForPeriod } = await import('./paycalc-calc.js');
// The REAL period grid and the REAL year engine, both running against the REAL settings module
// above. Nothing about the pro-rate is mocked in the joining-period blocks at the foot of this file
// — that is the whole point of them, and it is only possible because this file mocks the LEAF
// modules (Firebase, session, storage, the roster) rather than paycalc-settings itself.
const { getPeriods, CONFIG: PERIOD_CONFIG } = await import('./paycalc-periods.js');
const { computeYearSoFar } = await import('./paycalc-year-summary.js');
// The REAL roster people table, NOT the `./roster-data.js` stub above — this file mocks that
// specifier only, and `roster-member-data.js` imports nothing, so it loads in Node as it is.
// The role→grade contract is derived from it rather than from a list kept here.
const { teamMembers } = await import('./roster-member-data.js');

// getGrade() reads SK.grade from (mocked) localStorage and CACHES on first call — so pin the grade
// before any settings function runs. One grade per module load is enough to prove the wiring.
before(() => { _ls.set(SK.grade, 'cea'); });

describe('getStoredRateForYear — delegates to awardRatesFor, with the grade default as fallback', () => {
    test('a year on record returns its settled award rate', () => {
        assert.equal(getStoredRateForYear({ label: '2025/26' }), awardRatesFor('cea', '2025/26').rate);
        assert.equal(getStoredRateForYear({ label: '2026/27' }), awardRatesFor('cea', '2026/27').rate);
    });
    test('a year NOT on record falls back to the grade default rate (no throw)', () => {
        assert.equal(getStoredRateForYear({ label: '2099/00' }), GRADES.cea.rate);
    });

    test('a stale rate left in storage is never read (invariant 8; contracts-b-6)', () => {
        // The legacy `rate`/`rates` keys still sit on devices that had them. Read "as a fallback" by a
        // later edit, they would price a member at a pre-award rate — the failure class invariant 8
        // exists to end, and every case above runs with them absent, so none of them would notice.
        _ls.set(SK.rate, '19.99');
        _ls.set(SK.rates, JSON.stringify({ '2025/26': 19.99, '2026/27': 19.99 }));
        try {
            assert.equal(getStoredRateForYear({ label: '2026/27' }), awardRatesFor('cea', '2026/27').rate);
            assert.equal(getStoredRateForYear({ label: '2025/26' }), awardRatesFor('cea', '2025/26').rate);
            assert.equal(getStoredRateForYear({ label: '2099/00' }), GRADES.cea.rate);
        } finally {
            _ls.delete(SK.rate);
            _ls.delete(SK.rates);
        }
    });
});

// ── NO MEMBER-LEVEL PENSION IS STORED (paycalc-3-15) ─────────────────────────────────────────────
// `SK.pension` was written on every settings keystroke and read only into a field that the payslip's
// own paint replaced in the same start-up — no figure ever came from it, but every backup carried it,
// and the rules file described it as the default later payslips inherit. Each payslip keeps its own
// figure; one with none takes its period default.
describe('saveSettings stores no member-level pension', () => {
    test('a save writes nothing under the retired pension key', async () => {
        const { saveSettings } = await import('./paycalc-settings.js');
        beNobody();
        _ls.clear(); _ls.set(SK.grade, 'cea');
        const els = /** @type {Record<string, any>} */ ({});
        global.document = /** @type {any} */ ({ getElementById: (/** @type {string} */ id) => (els[id] ??= { value: '', checked: false }) });
        els.periodSelect = { value: String(getPeriods()[20].num) };
        els.gradeSelect = { value: 'cea' };
        els.pensionAmt = { value: '0.00' };
        saveSettings();
        assert.equal(_ls.get(SK.pension), undefined, 'a member-level pension default was written');
    });
});

// ── periodRate — the rate a payslip was paid at, one answer for the rate field and the summary ───
// The Settings summary worked this out for itself beside updateRateForPeriod until both asked here.
// Paydays from the real grid: 24 Oct 2025 and 28 Aug 2026 are the two award payslips.
describe('periodRate — the rate a payslip was PAID at', () => {
    const TY = (/** @type {string} */ l) => /** @type {any} */ (PERIOD_CONFIG.TAX_YEARS.find((/** @type {any} */ t) => t.label === l));
    const P = (/** @type {number} */ n) => /** @type {any} */ (getPeriods().find((/** @type {any} */ p) => p.num === n));
    test('fixture: P44 and P55 are the award payslips, and each year has a rate before its award', () => {
        assert.equal(P(44).payday.toDateString(), 'Fri Oct 24 2025');
        assert.equal(P(55).payday.toDateString(), 'Fri Aug 28 2026');
        for (const l of ['2025/26', '2026/27']) assert.notEqual(awardRatesFor('cea', l).pre, awardRatesFor('cea', l).rate);
    });
    test('a payslip before its year\'s award was paid the rate before it, and says so', () => {
        assert.deepEqual(periodRate(TY('2025/26'), P(43)), { rate: awardRatesFor('cea', '2025/26').pre, preAward: true });
        assert.deepEqual(periodRate(TY('2026/27'), P(54)), { rate: awardRatesFor('cea', '2026/27').pre, preAward: true });
    });
    test('from the award payslip on, the year\'s settled rate', () => {
        assert.deepEqual(periodRate(TY('2025/26'), P(44)), { rate: awardRatesFor('cea', '2025/26').rate, preAward: false });
        assert.deepEqual(periodRate(TY('2026/27'), P(55)), { rate: awardRatesFor('cea', '2026/27').rate, preAward: false });
    });
    test('no payslip named → the settled rate', () => {
        assert.deepEqual(periodRate(TY('2026/27')), { rate: getStoredRateForYear(TY('2026/27')), preAward: false });
    });
});

describe('getPensionDefault — delegates to getPensionForPeriod for a dated period', () => {
    test('a period with a payday returns that period-step pension (not just the flat default)', () => {
        // A payday in an OLDER pension era must return the historic step, proving the payday branch
        // delegates to getPensionForPeriod rather than always returning GRADES.pension.
        const payday = new Date(2025, 6, 1); // 1 Jul 2025
        assert.equal(getPensionDefault({ payday }), getPensionForPeriod('cea', payday));
        // sanity: the historic step differs from today's flat default, so this actually exercises delegation
        assert.notEqual(getPensionForPeriod('cea', payday), GRADES.cea.pension);
    });
    test('no payday → the grade flat pension default', () => {
        assert.equal(getPensionDefault({}), GRADES.cea.pension);
        assert.equal(getPensionDefault(null), GRADES.cea.pension);
    });
});

// ── OUT OF THE PENSION SCHEME (v21.64) ───────────────────────────────────────────────────────────
//
// Organised by what a wrong answer COSTS, not by function. Both directions are money, and only one
// of them is visible: answering "the scheme rate" for somebody who has withdrawn understates her
// take-home by the whole contribution on every payslip she has not hand-edited, and it does so
// silently — the figure looks exactly like everyone else's. Answering "£0" for somebody still IN
// the scheme is the opposite error and would be spotted the same day, because the take-home would
// be too high by the same £147.
//
// These assert through `getPensionDefault` deliberately. It is the one function the field default,
// calculate()'s fallback, the HPP estimate and the year summary all consult, so a case that passes
// here is a case those four cannot disagree about.
describe('getPensionDefault — a member who is not in the pension scheme', () => {
    // ⚠️ THIS BLOCK USED TO ASSERT THE DEFECT. Until v21.78 its first case read "opted out → £0 for
    // EVERY period, including a historic pension era", which is precisely what external review
    // found and what was then reproduced in a browser: a 2025/26 payslip's deduction went
    // £160.78 → £0.00 and its take-home rose £115.92 because the member ticked a box in August
    // 2026. The test passed throughout, because it had encoded the behaviour rather than the
    // requirement. Left recorded here: a test can only defend the question it was asked.
    const OUT_FROM = 56;
    const optedOutFrom = (/** @type {number} */ p) =>
        _ls.set(SK.pensionTimeline, JSON.stringify([{ from: p, out: true }]));

    test('a payslip BEFORE she left keeps the scheme default for its own era', () => {
        optedOutFrom(OUT_FROM);
        const payday = new Date(2025, 6, 1);
        assert.equal(getPensionDefault({ num: OUT_FROM - 1, payday }), getPensionForPeriod('cea', payday));
        assert.equal(getPensionDefault({ num: 1, payday }), getPensionForPeriod('cea', payday));
    });

    test('the payslip she named, and every one after it, is £0', () => {
        optedOutFrom(OUT_FROM);
        assert.equal(getPensionDefault({ num: OUT_FROM, payday: new Date(2026, 7, 28) }), 0);
        assert.equal(getPensionDefault({ num: OUT_FROM + 9, payday: new Date(2026, 7, 28) }), 0);
    });

    test('with no payslip in hand the answer is the scheme default, not £0', () => {
        // Reached on the field paint before a period is resolved. Answering "out" because the
        // newest change says so would be the retroactive bug in miniature.
        optedOutFrom(OUT_FROM);
        assert.equal(getPensionDefault({}), GRADES.cea.pension);
        assert.equal(getPensionDefault(null), GRADES.cea.pension);
        assert.equal(getPensionDefault(), GRADES.cea.pension);
    });

    test('rejoining restores the scheme WITHOUT restoring it to the months she was out', () => {
        _ls.set(SK.pensionTimeline, JSON.stringify([
            { from: OUT_FROM, out: true }, { from: 95, out: false },
        ]));
        const payday = new Date(2026, 7, 28);
        assert.equal(getPensionDefault({ num: OUT_FROM, payday }), 0);
        assert.equal(getPensionDefault({ num: 94, payday }), 0);
        assert.equal(getPensionDefault({ num: 95, payday }), getPensionForPeriod('cea', payday));
    });

    test('no timeline restores the scheme default — nothing else changed', () => {
        _ls.delete(SK.pensionTimeline);
        const payday = new Date(2025, 6, 1);
        assert.equal(getPensionDefault({ num: 60, payday }), getPensionForPeriod('cea', payday));
        assert.equal(getPensionDefault({}), GRADES.cea.pension);
    });

    test('a timeline that will not parse fails SAFE — still in the scheme, still deducting', () => {
        // The unsafe direction is the one that silently stops a real deduction, so anything this
        // cannot read whole must land on "contributing". Parsing itself is covered case-by-case in
        // paycalc-pension.test.mjs; this asserts the CONSUMER inherits that answer.
        for (const junk of ['1', 'true', '{}', '[{"from":56}]', '[{"from":"56","out":true}]', 'null']) {
            _ls.set(SK.pensionTimeline, junk);
            assert.equal(isPensionOptedOut({ num: 60 }), false, `"${junk}" must not read as opted out`);
            assert.equal(getPensionDefault({ num: 60 }), GRADES.cea.pension);
        }
        _ls.delete(SK.pensionTimeline);
    });
});

// ── WHICH PAY GRADE A ROLE IS (v21.78) ───────────────────────────────────────────────────────────
//
// `gradeForRole` had no test anywhere in the repo, and it is the function every figure on the page
// eventually hangs off: `loadSettings` calls it to auto-detect a member's grade, and the grade
// picks the hourly rate, every premium bucket, the Holiday Pay Premium base and the back-pay
// accrual. Organised by what a wrong answer COSTS, and the two directions are not remotely equal:
//
//   · SOMEBODY ELSE'S RATE is the expensive one and it is SILENT. Map 'CES' to 'cea' and every
//     supervisor is computed at the CEA rate — the figure is complete, formatted, plausible, and
//     wrong by the gap asserted below on contracted basic alone, before a single premium hour.
//     Nothing on screen says so, because nothing knows.
//   · A REFUSAL the app did not mean costs a CEA or a CES the calculator entirely — loud, and the
//     member reports it the same day. It is still a bug, which is why the positive cases are here.
//
// The third case is the one `.claude/rules/paycalc.md` invariant 13 names: a role with no confirmed
// rates gets NO figure, not a caption over somebody else's. `null` is what makes that possible, so
// it is a return value with a job, not an absence.
describe('gradeForRole — the role → pay-grade map every figure hangs off', () => {
    test('a CES is a CES, and the gap is the reason that matters', () => {
        assert.equal(gradeForRole('CES'), 'ces');
        // Stated as MONEY, not as a string match: what a wrong mapping costs is this, per payslip,
        // on contracted hours alone. Derived from the real tables so an award never churns it.
        const perPeriod = (GRADES.ces.rate - GRADES.cea.rate) * GRADES.ces.contr;
        assert.ok(perPeriod > 100,
            `the two grades must be far enough apart for this test to mean anything (gap £${perPeriod.toFixed(2)})`);
        assert.equal(GRADES[/** @type {string} */ (gradeForRole('CES'))].rate, GRADES.ces.rate);
    });

    test('a CEA is a CEA', () => {
        assert.equal(gradeForRole('CEA'), 'cea');
        assert.equal(GRADES[/** @type {string} */ (gradeForRole('CEA'))].rate, GRADES.cea.rate);
    });

    test('the rate that FOLLOWS from the role is the right year’s CES rate', () => {
        // One rung further down the chain than the map itself, because the map being right is only
        // useful if what reads it lands on the same grade's award row.
        for (const ty of ['2025/26', '2026/27']) {
            const ces = awardRatesFor(/** @type {string} */ (gradeForRole('CES')), ty);
            const cea = awardRatesFor(/** @type {string} */ (gradeForRole('CEA')), ty);
            assert.equal(ces.rate, awardRatesFor('ces', ty).rate, `${ty}: a CES was priced off the wrong row`);
            assert.notEqual(ces.rate, cea.rate, `${ty}: the two grades' rates are identical, so this proves nothing`);
        }
    });

    test('a role with no confirmed rates gets NULL, never a fallback grade', () => {
        // invariant 13. `getGrade()` returns '' for anybody with nothing stored and every consumer
        // then falls back to `GRADES.cea`, so returning a grade here for an unmodelled role is not
        // a smaller error than a wrong one — it is the same error, arriving quietly.
        for (const role of ['Dispatcher', 'Management', 'Supervisor', 'CEA ', 'cea', '', null, undefined]) {
            assert.equal(gradeForRole(/** @type {any} */ (role)), null,
                `"${String(role)}" was handed a pay grade the app has no rates for`);
        }
    });

    test('and every role the REAL roster carries is answered deliberately', () => {
        // Derived from the file that owns the roster rather than from a list kept here, so a role
        // added to the establishment fails HERE — where the answer is decided — instead of handing
        // that person a plausible CEA estimate on a page nobody thought about.
        const KNOWN = { CEA: 'cea', CES: 'ces', Dispatcher: null, Management: null };
        const roles = [...new Set(teamMembers.map(m => m.role))];
        assert.ok(roles.length >= 2, 'the roster produced no roles — this case is checking nothing');
        for (const role of roles) {
            assert.ok(role in KNOWN, `the roster carries a role this test has never decided about: ${role}`);
            assert.equal(gradeForRole(role), KNOWN[/** @type {'CEA'} */ (role)], `role ${role}`);
        }
    });
});

// ── THE JOINING PERIOD'S PENSION (seams 1 and 2 of the v23.63 mutation sweep) ─────────────────────
//
// `periodDefaultPension(p)` is `getPensionDefault(p) × getProRateFactor(p)`, rounded to the penny,
// and DELETING THE PRO-RATE FACTOR LEFT EVERY SUITE IN THIS REPO GREEN. So did deleting the same
// multiplication from `computeYearSoFar`. Two copies of one rule, neither protected.
//
// What a wrong answer COSTS, and the directions are not symmetrical:
//
//   · NOT PRO-RATING is the silent one. A member who joined ten days before the cut-off is shown a
//     full period's pension deduction. It comes off gross BEFORE tax and NI, so the error is not
//     confined to one line — it moves the tax, the National Insurance and the take-home together,
//     and every figure stays perfectly plausible. Nothing is out of range, nothing says "this was
//     built for a whole period", and the one member it happens to is a new starter with no earlier
//     payslip from this employer to compare against. It is their FIRST payslip that is wrong.
//   · PRO-RATING SOMEBODY WHO SHOULD NOT BE is the other direction and has a real population: a
//     secondment return carries `startDate` (to suppress the shifts before they came back) with
//     `noProRate: true`, because their pay and leave are full-year. Scaling their pension
//     understates the deduction and OVERSTATES take-home, which is the direction a member does not
//     query.
//
// Every figure is derived from the real period grid and the real pension table, so an award or a
// pension step moves these cases rather than breaking them.

/** Put a single member on the (mocked) roster and make them the session. */
function beMember(/** @type {any} */ fields) {
    _members.length = 0;
    _members.push({ name: 'Z. Joiner', role: 'CEA', ...fields });
    _session = /** @type {any} */ ({ name: 'Z. Joiner' });
}
function beNobody() { _members.length = 0; _session = null; }

/** The real 2026/27 tax year, so the post-award rates and the current pension step apply. */
const TY_2627 = () => PERIOD_CONFIG.TAX_YEARS.find(/** @param {any} t */ t => t.label === '2026/27');
const periodsInYear = () => {
    const ty = TY_2627();
    return getPeriods().filter(/** @param {any} p */ p => p.num - 48 >= ty.first && p.num - 48 <= ty.last);
};
/** Joined `days` days before this period's cut-off — so the factor is days/28, never 0 or 1. */
function joinedPartWay(/** @type {any} */ p, /** @type {number} */ days) {
    const d = new Date(p.cutoff);
    d.setDate(d.getDate() - (days - 1));
    return d;
}

describe('the joining period’s pension is pro-rated — and only for somebody who should be', () => {
    test('a part-period joiner pays part of the contribution, to the penny', () => {
        const p = periodsInYear()[6];
        beMember({ startDate: joinedPartWay(p, 10) });

        const factor = getProRateFactor(p);
        assert.ok(factor > 0 && factor < 1, `the fixture is not a part period (factor ${factor})`);

        const full = getPensionDefault(p);
        assert.ok(full > 0, 'no scheme pension on record for this period — the case proves nothing');
        assert.equal(periodDefaultPension(p), parseFloat((full * factor).toFixed(2)));

        // Stated as MONEY, because that is what a missing factor costs. It is not a rounding
        // difference; it is most of a pension contribution, taken off gross before tax and NI.
        const missed = full - periodDefaultPension(p);
        assert.ok(missed > 90, `a dropped pro-rate would overstate the deduction by £${missed.toFixed(2)} — too small a gap to prove anything`);
    });

    test('a secondment return is NOT pro-rated — `noProRate` is what says so', () => {
        const p = periodsInYear()[6];
        beMember({ startDate: joinedPartWay(p, 10), noProRate: true });
        assert.equal(getProRateFactor(p), 1);
        assert.equal(periodDefaultPension(p), getPensionDefault(p));
        // The same fixture WITHOUT the flag must differ, or this case is passing on the date rather
        // than on the flag it names.
        beMember({ startDate: joinedPartWay(p, 10) });
        assert.notEqual(periodDefaultPension(p), getPensionDefault(p));
    });

    test('a long-server with no start date pays the full contribution', () => {
        const p = periodsInYear()[6];
        beMember({});
        assert.equal(getProRateFactor(p), 1);
        assert.equal(periodDefaultPension(p), getPensionDefault(p));
        beNobody();
        assert.equal(periodDefaultPension(p), getPensionDefault(p), 'no session at all must behave like a long-server, not throw');
    });

    test('a payslip entirely before they joined has no contribution at all', () => {
        // Factor 0 is a real value the ladder must carry through, not a falsy case that quietly
        // becomes 1 — and it is the one assertion here that a `?? 1` fallback would fail.
        const ps = periodsInYear();
        beMember({ startDate: joinedPartWay(ps[6], 10) });
        assert.equal(getProRateFactor(ps[2]), 0);
        assert.equal(periodDefaultPension(ps[2]), 0);
    });

    test('the figure is a 2dp MONEY value, not a raw float', () => {
        // The field writes it with `.toFixed(2)`, and `readFormData` compares a typed figure against
        // it within half a penny to decide whether the member overrode the default. An unrounded
        // value here would make that comparison ask a slightly different question.
        const p = periodsInYear()[6];
        beMember({ startDate: joinedPartWay(p, 9) });
        const v = periodDefaultPension(p);
        assert.equal(v, parseFloat(v.toFixed(2)));
        assert.notEqual(getPensionDefault(p) * getProRateFactor(p), v, 'the raw product is already 2dp — this case proves nothing');
    });

    test('no period in hand returns the bare default — the boot paint, before a payslip is resolved', () => {
        beMember({ startDate: joinedPartWay(periodsInYear()[6], 10) });
        assert.equal(periodDefaultPension(null), GRADES.cea.pension);
        assert.equal(periodDefaultPension(undefined), GRADES.cea.pension);
    });
});

// ── AND THE YEAR CARD MUST NOT DISAGREE WITH THE FIELD ───────────────────────────────────────────
//
// `computeYearSoFar` re-runs the calculator headlessly over every entered payslip and multiplies the
// SAME two things by hand: `getPensionDefault(p) * proRate`. Two copies of one rule in two modules,
// which is the exact shape of the v18.84 year-summary defect — the card and the calculator reporting
// different money for the same payslip, both plausible, neither flagged.
//
// So the property is asserted rather than each copy separately: for a joiner, the pension the YEAR
// ENGINE actually used must be the pension the FIELD would have shown. It is recovered from the
// engine's own output (taxable = gross − pension) rather than read out of it, which is what makes
// this a test of the assembly and not of the expression.
//
// ONE DIFFERENCE IS REAL AND DELIBERATE, and the tolerance names it: the field rounds to the penny
// and the year engine does not. Measured at under half a penny on a joining period, and it stops
// there. A dropped pro-rate at either end moves the same comparison by ninety pounds, which is the
// distance this is actually watching.
describe('the pay field and the year card agree about a joiner’s pension', () => {
    /** Run the real year engine over one entered payslip and hand back what it and the field say. */
    function priceOnePayslip(/** @type {any} */ p, { london = 1 } = {}) {
        const ty = TY_2627();
        _ls.clear();
        _ls.set(SK.grade, 'cea');
        _ls.set(periodKey(p.num), JSON.stringify({ otH: 4, otM: 0 }));
        const now = new Date(p.payday);
        now.setDate(now.getDate() + 1);
        const y = computeYearSoFar(ty, { taxCode: '1257L', plan: 'none', pgLoan: false, now });
        // Rebuild the gross the engine priced, from the same REAL settings module it read. Nothing
        // here is a restatement of the engine's own line — every input comes from the shipped code.
        const g = computeGross({
            rate:     getRateForPeriod(p, 'cea', ty.label, getStoredRateForYear(ty)),
            effContr: getEffectiveContr(p),
            satHrs: 0, bhHrs: 0, bhOtHrs: 0,
            oHrs: 4, rHrs: 0, sHrs: 0, bHrs: 0, peerDays: 0,
            london:   getLondonAllowanceForPeriod(p, ty) * london,
            otherAdj: 0,
        });
        return { y, engine: g.gross - y.taxable, field: periodDefaultPension(p) };
    }

    test('the pension the year engine used is the one the field would show', () => {
        const p = periodsInYear()[4];
        beMember({ startDate: joinedPartWay(p, 10) });
        const { y, engine, field } = priceOnePayslip(p, { london: getProRateFactor(p) });
        assert.equal(y.entered, 1, 'the fixture did not reach the engine — nothing below means anything');
        assert.ok(Math.abs(engine - field) < 0.005,
            `the year card priced this payslip's pension at £${engine.toFixed(4)} and the field would show £${field.toFixed(2)}`);

        // …and the agreement is not the trivial one: without the pro-rate at either end the two
        // would stand this far apart.
        const gapIfEitherDropped = getPensionDefault(p) - field;
        assert.ok(gapIfEitherDropped > 90,
            `a divergence would only be £${gapIfEitherDropped.toFixed(2)} — the fixture is too close to a full period`);
    });

    test('and they agree for a long-server too — the case with no pro-rate in it at all', () => {
        const p = periodsInYear()[4];
        beMember({});
        const { engine, field } = priceOnePayslip(p);
        assert.ok(Math.abs(engine - field) < 0.005);
        assert.equal(field, getPensionDefault(p), 'a long-server must be charged the whole contribution');
    });
});

// ── THE SETTINGS SAVE PATCHES THE ON-SCREEN PAYSLIP'S PENSION (72-hour review) ──────────────────────
//
// `confirmSettings` writes the pension field into the saved period it is showing. It did so with
// `parseFloat(raw) || 0`, which broke both halves of the round trip `readFormData` keeps:
//   · a value EQUAL to the period default was stored as a number, not null — freezing that payslip
//     onto today's default so it stops following `PENSION_STEPS` (the 28 Aug £147.36 → £151.86 step
//     is exactly the kind of change it would then silently ignore);
//   · "£151.86", a figure pasted from the payslip, parsed to NaN → 0, a £0 opt-out nobody chose.
// Driven through the REAL confirmSettings over a fake DOM, so the call site is what is tested.
describe('confirmSettings — the pension it writes into the viewed payslip obeys the round trip', () => {
    // A successful save ends with `setTimeout(…, 2500)`, which clears "✓ Settings saved" and folds the
    // card away. On real timers that held this file open 2.5 s after its last assertion — 2.7 s for
    // 0.2 s of tests (test audit, 7 Nov 2026). Fake timers instead; each test's collapse is RUN before
    // they are reset, so a callback that throws on this fake page still fails the test that queued it.
    beforeEach(() => { mock.timers.enable({ apis: ['setTimeout'] }); });
    afterEach(() => { try { mock.timers.runAll(); } finally { mock.timers.reset(); } });

    /** @type {Record<string, any>} */ let els = {};
    const makeEl = () => {
        /** @type {any} */ const el = {
            value: '', checked: false, textContent: '', innerHTML: '', disabled: false, style: {},
            classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
            setAttribute() {}, getAttribute: () => null, closest: () => null, appendChild() {},
            querySelector: () => null,
        };
        el.ownerDocument = { createElement: () => makeEl(), createTextNode: () => ({}) };
        return el;
    };
    /** Save Settings on payslip `p` with the pension field reading `raw`; return what was stored. */
    async function saveWithPension(/** @type {any} */ p, /** @type {string} */ raw) {
        const { confirmSettings } = await import('./paycalc-settings.js');
        els = {};
        global.document = /** @type {any} */ ({ getElementById: (/** @type {string} */ id) => (els[id] ??= makeEl()) });
        els.periodSelect = makeEl(); els.periodSelect.value = String(p.num);
        els.gradeSelect  = makeEl(); els.gradeSelect.value = 'cea';
        els.taxCode      = makeEl(); els.taxCode.value = '1257L';
        els.studentLoan  = makeEl(); els.studentLoan.value = 'none';
        els.pensionAmt   = makeEl(); els.pensionAmt.value = raw;
        _ls.set(periodKey(p.num), JSON.stringify({ otH: 4, otM: 0 }));
        confirmSettings(() => {});
        return JSON.parse(/** @type {string} */ (_ls.get(periodKey(p.num)))).pension;
    }
    /** A 2026/27 payslip on or after the 28 Aug 2026 award step, so its default is the current era. */
    const postAward = () => /** @type {any} */ (periodsInYear().find(
        /** @param {any} p */ p => p.payday >= new Date(2026, 7, 28)));
    const fresh = () => { beNobody(); _ls.clear(); _ls.set(SK.grade, 'cea'); };

    test('the period default is stored as NULL, so the payslip keeps following the pension table', async () => {
        fresh();
        const p = postAward();
        const def = periodDefaultPension(p).toFixed(2);
        assert.equal(await saveWithPension(p, def), null,
            `saving Settings over the default £${def} froze it onto the payslip`);
    });

    test('a payslip figure pasted with its £ sign is the default, not a £0 opt-out', async () => {
        fresh();
        const p = postAward();
        assert.equal(await saveWithPension(p, `£${periodDefaultPension(p).toFixed(2)}`), null);
    });

    test('a genuinely different figure is kept, and a typed 0 is still a real opt-out', async () => {
        fresh();
        const p = postAward();
        assert.equal(await saveWithPension(p, '£200.00'), 200);
        assert.equal(await saveWithPension(p, '0'), 0);
        assert.equal(await saveWithPension(p, ''), null, 'blank → the default, never £0');
        assert.equal(await saveWithPension(p, 'abc'), null, 'garbage → the default, never £0');
    });
});

// ── A FAKE SETTINGS CARD, FOR THE BLOCKS BELOW THAT DRIVE loadSettings / saveSettings ─────────────
//
// A <select> with the two HTML rules these depend on: setting `.value` to a value no option carries
// selects NOTHING (value '' and selectedIndex -1), and a dropdown that gains options while nothing
// has been chosen shows its first one. Everything else is the plain input the module reads.
const classes = () => {
    const s = new Set();
    return {
        add: (/** @type {string} */ x) => s.add(x), remove: (/** @type {string} */ x) => s.delete(x),
        contains: (/** @type {string} */ x) => s.has(x),
        toggle(/** @type {string} */ x, /** @type {boolean} [on] */ on) { (on === undefined ? !s.has(x) : on) ? s.add(x) : s.delete(x); return s.has(x); },
    };
};
const fakeOption = (/** @type {string} */ value = '', /** @type {string} */ text = '') =>
    ({ tagName: 'OPTION', value, textContent: text, disabled: false });
const fakeOptgroup = () => ({ tagName: 'OPTGROUP', label: '', /** @type {any[]} */ children: [],
    appendChild(/** @type {any} */ c) { this.children.push(c); return c; } });
function fakeSelect() {
    /** @type {any} */ const sel = {
        tagName: 'SELECT', /** @type {any[]} */ children: [], classList: classes(),
        _chosen: /** @type {any} */ (null), _cleared: false,
        get options() { return this.children.flatMap((/** @type {any} */ c) => c.tagName === 'OPTGROUP' ? c.children : [c]); },
        get selectedIndex() {
            const opts = this.options;
            if (this._chosen && opts.includes(this._chosen)) return opts.indexOf(this._chosen);
            return this._cleared || !opts.length ? -1 : 0;
        },
        get value() { const i = this.selectedIndex; return i === -1 ? '' : this.options[i].value; },
        set value(v) {
            this._chosen = this.options.find((/** @type {any} */ o) => o.value === String(v)) ?? null;
            this._cleared = !this._chosen;
        },
        set innerHTML(_v) { this.children = []; this._chosen = null; this._cleared = false; },
        get innerHTML() { return ''; },
        appendChild(/** @type {any} */ c) { this.children.push(c); this._cleared = false; return c; },
        insertBefore(/** @type {any} */ c, /** @type {any} */ ref) {
            const nodes = c.nodeType === 11 ? c.children.splice(0) : [c];   // a fragment moves its children
            const i = ref ? this.children.indexOf(ref) : -1;
            if (i === -1) this.children.push(...nodes); else this.children.splice(i, 0, ...nodes);
            this._cleared = false;
            return c;
        },
        querySelector(/** @type {string} */ q) {
            return q === 'optgroup' ? (this.children.find((/** @type {any} */ c) => c.tagName === 'OPTGROUP') ?? null) : null;
        },
        /** @type {Record<string, Function[]>} */ listeners: {},
        addEventListener(/** @type {string} */ t, /** @type {Function} */ f) { (this.listeners[t] ||= []).push(f); },
        fire(/** @type {string} */ t) { for (const f of this.listeners[t] || []) f({ target: this }); },
    };
    return sel;
}
/** An <input>: `value` is always a string, as the page's is. */
const fakeInput = () => {
    let v = '';
    /** @type {any} */ const el = { checked: false, disabled: false, textContent: '', classList: classes(),
        get value() { return v; }, set value(x) { v = String(x); },
        closest: () => null, setAttribute() {}, focus() {}, querySelector: () => null, style: {},
        /** @type {Record<string, Function[]>} */ listeners: {},
        addEventListener(/** @type {string} */ t, /** @type {Function} */ f) { (this.listeners[t] ||= []).push(f); },
        fire(/** @type {string} */ t) { for (const f of this.listeners[t] || []) f({ target: this }); } };
    return el;
};
/** @type {Record<string, any>} */ let card = {};
/**
 * The Settings card as the coordinator leaves it before loadSettings: the loan stop's static
 * "No — still deducted" option, then one group per tax year of the payslips the member can see.
 */
async function settingsCard(/** @type {number} */ viewing) {
    const { appendPayslipOptions, visiblePeriods } = await import('./paycalc-periods.js');
    card = {};
    global.document = /** @type {any} */ ({
        getElementById: (/** @type {string} */ id) => (card[id] ??= fakeInput()),
        createElement: (/** @type {string} */ tag) => tag === 'optgroup' ? fakeOptgroup() : fakeOption(),
        createDocumentFragment: () => ({ nodeType: 11, /** @type {any[]} */ children: [],
            appendChild(/** @type {any} */ c) { this.children.push(c); return c; } }),
        activeElement: null,
    });
    card.periodSelect = fakeInput(); card.periodSelect.value = String(viewing);
    card.gradeSelect = fakeInput(); card.gradeSelect.value = 'cea';
    card.taxCode = fakeInput(); card.taxCode.value = '1257L';
    card.studentLoan = fakeInput(); card.studentLoan.value = 'plan2';
    card.pensionOptOutFrom = fakeSelect();
    card.slPaidOffFrom = fakeSelect();
    card.slPaidOffFrom.appendChild(fakeOption('', 'No — still deducted'));
    appendPayslipOptions(card.slPaidOffFrom, visiblePeriods());
}
const chosenText = (/** @type {any} */ sel) => String(sel.options[sel.selectedIndex]?.textContent ?? '');

// ── A PAYSLIP ON RECORD THAT THE LIST NO LONGER OFFERS (paycalc-3-8) ─────────────────────────────
//
// The pension opt-out start and the student-loan stop each name ONE payslip, picked from a list of
// the payslips the member can see. A select set to a value none of its options carries selects
// NOTHING, and that blank used to be read and saved as an answer: `calculate()` read the loan stop
// as "still deducted", the next save erased it, and the same save MOVED the opt-out start to the
// payslip on screen — so every payslip in between got its pension deduction back. Nothing said so.
//
// The list gets shorter in two real ways, and both are here: a start date added after the choice
// was made (the new-starter clamp hides the earlier tax year), and a tax year dropped from the grid
// at a rollover (the period is no longer generated at all).
describe('a payslip on record that the list no longer offers is kept (paycalc-3-8)', () => {
    /** A member who joined in 2026/27, so the lists start at that year's first payslip. */
    const JOINER = { startDate: new Date(2026, 5, 15) };
    /** @type {any} */ let P = null;
    /** @type {any} */ let S = null;
    before(async () => { P = await import('./paycalc-periods.js'); S = await import('./paycalc-settings.js'); });
    beforeEach(() => {
        beNobody();
        _ls.clear(); _ls.set(SK.grade, 'cea'); _ls.set(SK.setup, '1'); _ls.set(SK.sl, 'plan2');
    });
    afterEach(() => { P.setEarliestVisiblePeriod(null); });

    test('a loan stop dated before the list starts is shown, read and kept', async () => {
        P.setEarliestVisiblePeriod(JOINER);
        const RECORDED = P.visiblePeriods()[0].num - 3;
        assert.ok(getPeriods().some((/** @type {any} */ p) => p.num === RECORDED), 'premise: the grid still has that payslip');
        _ls.set(SK.slPaidOff, String(RECORDED));
        await settingsCard(P.todaysPeriodNum());
        S.loadSettings();
        assert.equal(card.slPaidOffFrom.value, String(RECORDED),
            'the control came up blank — and calculate() reads a blank loan stop as "still deducted"');
        assert.match(chosenText(card.slPaidOffFrom), /^Paid \d{1,2} \w{3} \d{4} · P\d+$/, 'named the way every payslip list names one');
        S.saveSettings();                    // one keystroke in the tax code box
        assert.equal(_ls.get(SK.slPaidOff), String(RECORDED), 'the next save erased the stop');
    });

    test('a pension opt-out dated before the list starts stays where it began', async () => {
        P.setEarliestVisiblePeriod(JOINER);
        const RECORDED = P.visiblePeriods()[0].num - 3;
        const timeline = JSON.stringify([{ from: RECORDED, out: true }]);
        _ls.set(SK.pensionTimeline, timeline);
        await settingsCard(P.todaysPeriodNum());
        S.loadSettings();
        assert.equal(card.pensionOptOutCheck.checked, true, 'premise: still out of the scheme');
        assert.equal(card.pensionOptOutFrom.value, String(RECORDED), 'the control came up blank');
        S.saveSettings();
        assert.equal(_ls.get(SK.pensionTimeline), timeline,
            'the save MOVED the opt-out to the payslip on screen — every payslip between the two got its deduction back');
    });

    test('a payslip the grid no longer generates at all is kept too, and labelled without a guess', async () => {
        const GONE = 48 + PERIOD_CONFIG.FIRST_OFFSET - 5;     // a tax year dropped at a rollover
        assert.ok(!getPeriods().some((/** @type {any} */ p) => p.num === GONE), 'premise: no such period in the grid');
        const timeline = JSON.stringify([{ from: GONE, out: true }]);
        _ls.set(SK.slPaidOff, String(GONE));
        _ls.set(SK.pensionTimeline, timeline);
        await settingsCard(P.todaysPeriodNum());
        S.loadSettings();
        assert.equal(card.slPaidOffFrom.value, String(GONE));
        assert.equal(card.pensionOptOutFrom.value, String(GONE));
        assert.equal(chosenText(card.slPaidOffFrom), 'An earlier payslip, before this list starts');
        S.saveSettings();
        assert.equal(_ls.get(SK.slPaidOff), String(GONE));
        assert.equal(_ls.get(SK.pensionTimeline), timeline);
    });

    test('a select with nothing chosen never overwrites what is on record', async () => {
        // The second line of defence: whatever leaves a select holding nothing, a save must not write
        // that nothing over a recorded payslip. Built by hand, so loadSettings cannot repair it first.
        const RECORDED = P.todaysPeriodNum() - 4;
        const timeline = JSON.stringify([{ from: RECORDED, out: true }]);
        _ls.set(SK.slPaidOff, String(RECORDED));
        _ls.set(SK.pensionTimeline, timeline);
        await settingsCard(P.todaysPeriodNum());
        P.appendPayslipOptions(card.pensionOptOutFrom, P.visiblePeriods());
        card.pensionOptOutCheck = fakeInput(); card.pensionOptOutCheck.checked = true;
        card.pensionOptOutFrom.value = 'none of these';
        card.slPaidOffFrom.value = 'none of these';
        assert.equal(card.slPaidOffFrom.selectedIndex, -1, 'premise: nothing is selected');
        S.saveSettings();
        assert.equal(_ls.get(SK.slPaidOff), String(RECORDED), 'a blank select erased the loan stop');
        assert.equal(_ls.get(SK.pensionTimeline), timeline, 'a blank select moved the opt-out start');
    });

    test('CONTROL: a payslip the member PICKS is still saved, and "No — still deducted" still clears', async () => {
        const RECORDED = P.todaysPeriodNum() - 4;
        _ls.set(SK.slPaidOff, String(RECORDED));
        _ls.set(SK.pensionTimeline, JSON.stringify([{ from: RECORDED, out: true }]));
        await settingsCard(P.todaysPeriodNum());
        S.loadSettings();
        card.pensionOptOutFrom.value = String(RECORDED + 1);
        card.slPaidOffFrom.value = String(RECORDED + 2);
        S.saveSettings();
        assert.equal(_ls.get(SK.slPaidOff), String(RECORDED + 2));
        assert.equal(_ls.get(SK.pensionTimeline), JSON.stringify([{ from: RECORDED + 1, out: true }]));
        card.slPaidOffFrom.value = '';
        S.saveSettings();
        assert.equal(_ls.get(SK.slPaidOff), '', '"No — still deducted" must still clear the stop');
    });
});

// ── A ONE-TIME LEGACY MIGRATION RUNS FOR LEGACY DATA ONLY (paycalc-3-16) ────────────────────────
// Two steps in loadSettings call themselves one-time legacy migrations and did not ask whether the
// data in front of them was legacy. (1) The per-year setup stamp ran for EVERY member on their second
// load, marking every tax year in the table confirmed — so a 2026/27 joiner's backup claimed "Tax
// years 2025/26 and 2026/27", and nobody was ever asked to check their settings for a year they had
// not set up. (2) The retired opt-out flag was dated from the first payslip of TODAY's tax year; it
// could only ever have been set in 2026/27, and from the 2027/28 rollover "today" would have put a
// pension deduction back on the 2026/27 payslips the member was out of the scheme for.
describe('the one-time legacy migrations run for legacy data only (paycalc-3-16)', () => {
    /** @type {any} */ let P = null;
    /** @type {any} */ let S = null;
    before(async () => { P = await import('./paycalc-periods.js'); S = await import('./paycalc-settings.js'); });
    beforeEach(() => { beNobody(); _ls.clear(); _ls.set(SK.grade, 'cea'); _ls.set(SK.setup, '1'); });
    const Y = (/** @type {string} */ label) => ({ label });
    const MIGRATED = () => `${SK.setup}_years_migrated`;

    test('a member who confirmed one tax year is not stamped confirmed for the others', async () => {
        _ls.set(S.settingsKey(Y('2026/27')), '1');                   // what Save settings writes
        await settingsCard(P.todaysPeriodNum());
        S.loadSettings();
        assert.equal(_ls.get(S.settingsKey(Y('2025/26'))), undefined, 'a year never set up was stamped confirmed');
        assert.equal(_ls.get(MIGRATED()), '1', 'the step is still recorded as done, so it never runs again');
    });

    test('CONTROL: a member from before per-year tracking still has every year confirmed', async () => {
        await settingsCard(P.todaysPeriodNum());                     // `setup`, and no per-year flag at all
        S.loadSettings();
        for (const ty of PERIOD_CONFIG.TAX_YEARS) assert.equal(_ls.get(S.settingsKey(ty)), '1', ty.label);
    });

    test('the retired opt-out flag is dated to 2026/27, whatever the clock says', async () => {
        const ty = PERIOD_CONFIG.TAX_YEARS.find((/** @type {any} */ t) => t.label === '2026/27');
        const first2627 = 48 + ty.first;
        _ls.set(SK.pensionOptOut, '1');
        mock.timers.enable({ apis: ['Date'], now: new Date(2026, 0, 15) });   // a clock in another tax year
        try {
            assert.notEqual(P.todaysPeriodNum() - 48 >= ty.first, true, 'premise: "today" is outside 2026/27');
            await settingsCard(P.todaysPeriodNum());
            S.loadSettings();
        } finally { mock.timers.reset(); }
        assert.equal(_ls.get(SK.pensionTimeline), JSON.stringify([{ from: first2627, out: true }]),
            'the flag was dated by the clock, not by the one tax year it can have been set in');
    });
});

// ── THE PENSION CONTROLS NEVER WIPE A PAYSLIP'S OWN FIGURE (paycalc-3-3) ─────────────────────────
//
// A member whose contribution differs from the scheme's has typed their own figure on the payslip on
// screen. Ticking "not in the pension scheme" by mistake and unticking it, or correcting the opt-out
// date while looking at an earlier payslip she was still paying into, used to replace that figure
// with the scheme default — in the box AND in storage, with no message. The guide promises the
// opposite: "Everything before it keeps the pension it was actually paid with". A figure inside an
// opt-out spell lies dormant behind the lock (priced at £0 by every surface), as every OTHER payslip
// in the spell already does. `persist` below is the coordinator's `persistSetting(['pension'])`,
// built from the REAL form-data functions it uses.
describe('the pension controls keep a payslip\'s own figure (paycalc-3-3)', () => {
    /** @type {any} */ let P = null;
    /** @type {any} */ let S = null;
    /** @type {any} */ let F = null;
    before(async () => {
        P = await import('./paycalc-periods.js');
        S = await import('./paycalc-settings.js');
        F = await import('./paycalc-form-data.js');
    });
    beforeEach(() => { beNobody(); _ls.clear(); _ls.set(SK.grade, 'cea'); _ls.set(SK.setup, '1'); });

    const persist = () => {
        const pNum = Number(card.periodSelect.value);
        const p = getPeriods().find((/** @type {any} */ x) => x.num === pNum);
        const w = F.settingFieldsWrite(_ls.get(periodKey(pNum)) ?? null,
            F.readFormData({ adjNegative: false, periodDefaultPension: p ? S.periodDefaultPension(p) : null }), ['pension']);
        if (w) _ls.set(periodKey(pNum), w);
    };
    /** Open payslip `pNum` holding `blob` the way loadPeriodData paints it, with the controls wired. */
    async function open(/** @type {number} */ pNum, /** @type {any} */ blob) {
        _ls.set(periodKey(pNum), JSON.stringify(blob));
        await settingsCard(pNum);
        S.loadSettings();
        const p = getPeriods().find((/** @type {any} */ x) => x.num === pNum);
        card.pensionAmt.value = blob.pension != null ? blob.pension : S.periodDefaultPension(p).toFixed(2);
        S.applyPensionOptOutUI(p);
        S.wirePensionControls({ autosave: persist });
    }
    const storedPension = (/** @type {number} */ pNum) => JSON.parse(String(_ls.get(periodKey(pNum)))).pension;

    test('ticking "not in the scheme" by mistake and unticking it gives the payslip its figure back', async () => {
        const V = P.todaysPeriodNum();
        await open(V, { otH: 4, otM: 0, pension: 50 });
        card.pensionOptOutCheck.checked = true; card.pensionOptOutCheck.fire('change');
        assert.equal(card.pensionAmt.value, '0.00', 'premise: the lock shows £0.00');
        assert.equal(card.pensionAmt.disabled, true);
        assert.equal(storedPension(V), 50, 'the tick wrote the lock\'s £0.00 over the payslip\'s own figure');
        card.pensionOptOutCheck.checked = false; card.pensionOptOutCheck.fire('change');
        assert.equal(card.pensionAmt.value, '50', 'the untick painted the scheme default over her own figure');
        assert.equal(storedPension(V), 50);
    });

    test('correcting the opt-out date while viewing an earlier payslip leaves its figure alone', async () => {
        const V = P.todaysPeriodNum() - 4;
        _ls.set(SK.pensionTimeline, JSON.stringify([{ from: V + 2, out: true }]));
        await open(V, { otH: 4, otM: 0, pension: 50 });
        assert.equal(card.pensionAmt.disabled, false, 'premise: she was still paying in on this payslip');
        card.pensionOptOutFrom.value = String(V + 3); card.pensionOptOutFrom.fire('change');
        assert.equal(card.pensionAmt.value, '50', 'a payslip the correction never touched lost its figure');
        assert.equal(storedPension(V), 50);
    });

    test('CONTROL: a payslip holding no figure of its own still gets the scheme figure back on untick', async () => {
        const V = P.todaysPeriodNum();
        await open(V, { otH: 4, otM: 0 });
        const def = S.periodDefaultPension(getPeriods().find((/** @type {any} */ x) => x.num === V)).toFixed(2);
        card.pensionOptOutCheck.checked = true; card.pensionOptOutCheck.fire('change');
        assert.equal(card.pensionAmt.value, '0.00');
        card.pensionOptOutCheck.checked = false; card.pensionOptOutCheck.fire('change');
        assert.equal(card.pensionAmt.value, def, 'a frozen £0.00 left behind would save as a real opt-out');
        assert.equal(storedPension(V), null, 'the scheme default is stored as null, so it keeps following the table');
    });
});

// ── A REFUSED START IS NOT LEFT ON SCREEN (paycalc-1-10; whole-app check, 10 Nov 2026) ───────────
// A start moved at or before an earlier rejoin is refused — a spell that has already ENDED is left
// alone (`withOptOutStartAt`). The date's change handler saved, nothing moved, and the select went on
// naming the payslip it had just refused, while every figure used the start on record until a reload.
describe('the opt-out date shows the start on record after a refused correction (paycalc-1-10)', () => {
    /** @type {any} */ let P = null;
    /** @type {any} */ let S = null;
    before(async () => { P = await import('./paycalc-periods.js'); S = await import('./paycalc-settings.js'); });
    beforeEach(() => { beNobody(); _ls.clear(); _ls.set(SK.grade, 'cea'); _ls.set(SK.setup, '1'); });

    /** Out from V−6, back in from V−4, out again from V−2: viewing V, with the controls wired. */
    async function twoSpells() {
        const V = P.todaysPeriodNum();
        const timeline = JSON.stringify([{ from: V - 6, out: true }, { from: V - 4, out: false }, { from: V - 2, out: true }]);
        _ls.set(SK.pensionTimeline, timeline);
        await settingsCard(V);
        S.loadSettings();
        S.wirePensionControls({ autosave: () => {} });
        return { V, timeline };
    }

    test('a start moved into the spell that already ended is refused, and the control shows the start on record', async () => {
        const { V, timeline } = await twoSpells();
        assert.equal(card.pensionOptOutFrom.value, String(V - 2), 'premise: the control opens on the current spell\'s start');
        card.pensionOptOutFrom.value = String(V - 5); card.pensionOptOutFrom.fire('change');
        assert.equal(_ls.get(SK.pensionTimeline), timeline, 'premise: the refused start moved nothing');
        assert.equal(card.pensionOptOutFrom.value, String(V - 2), 'the control went on naming the payslip it had just refused');
    });

    test('CONTROL: a start moved later than the rejoin is kept, and shown', async () => {
        const { V } = await twoSpells();
        card.pensionOptOutFrom.value = String(V - 1); card.pensionOptOutFrom.fire('change');
        assert.equal(_ls.get(SK.pensionTimeline),
            JSON.stringify([{ from: V - 6, out: true }, { from: V - 4, out: false }, { from: V - 1, out: true }]));
        assert.equal(card.pensionOptOutFrom.value, String(V - 1));
    });
});
