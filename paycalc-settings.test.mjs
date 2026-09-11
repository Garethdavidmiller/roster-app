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
        teamMembers: [], APP_VERSION: '13.00',
        CONFIG: { ADMIN_NAMES: [], LINKS_DESIGNERS: [], MAX_YEAR: 2027, MIN_YEAR: 2025 },
        formatISO: d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`,
        parseSmartFloat: v => parseFloat(String(v)),
    },
});
mock.module('./paycalc-roster-suggestions.js', {
    namedExports: { bhsForYear: () => [], getRosterSuggestion: async () => ({}), fetchOverridesForPeriod: async () => {} },
});

const { SK } = await import('./paycalc-migrations.js');
const { getStoredRateForYear, getPensionDefault, isPensionOptedOut, gradeForRole } = await import('./paycalc-settings.js');
const { awardRatesFor, getPensionForPeriod, GRADES } = await import('./paycalc-calc.js');
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
