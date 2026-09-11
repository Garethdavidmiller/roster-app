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
import { test, describe, before, mock } from 'node:test';
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
mock.module('./roster-data.js', {
    namedExports: {
        teamMembers: _members, APP_VERSION: '13.00',
        CONFIG: { ADMIN_NAMES: [], LINKS_DESIGNERS: [], MAX_YEAR: 2027, MIN_YEAR: 2025 },
        formatISO: d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`,
        parseSmartFloat: v => parseFloat(String(v)),
    },
});
mock.module('./paycalc-roster-suggestions.js', {
    namedExports: { bhsForYear: () => [], getRosterSuggestion: async () => ({}), fetchOverridesForPeriod: async () => {} },
});

const { SK, periodKey } = await import('./paycalc-migrations.js');
const {
    getStoredRateForYear, getPensionDefault, isPensionOptedOut, gradeForRole,
    periodDefaultPension, getProRateFactor, getEffectiveContr,
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
