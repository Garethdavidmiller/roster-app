/**
 * Unit tests for the money-critical grade-lookup wrappers in paycalc-settings.js:
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
const { getStoredRateForYear, getPensionDefault, isPensionOptedOut } = await import('./paycalc-settings.js');
const { awardRatesFor, getPensionForPeriod, GRADES } = await import('./paycalc-calc.js');

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
    test('opted out → £0 for EVERY period, including a historic pension era', () => {
        _ls.set(SK.pensionOptOut, '1');
        assert.equal(getPensionDefault({ payday: new Date(2025, 6, 1) }), 0);
        assert.equal(getPensionDefault({ payday: new Date(2026, 7, 28) }), 0);
        assert.equal(getPensionDefault({}), 0);
        assert.equal(getPensionDefault(null), 0);
        assert.equal(getPensionDefault(), 0);
    });
    test('un-ticking restores the scheme default — the flag is the ONLY thing that changed', () => {
        _ls.set(SK.pensionOptOut, '');
        const payday = new Date(2025, 6, 1);
        assert.equal(getPensionDefault({ payday }), getPensionForPeriod('cea', payday));
        assert.equal(getPensionDefault({}), GRADES.cea.pension);
    });
    test('only the exact stored flag counts — a stray value must not opt anybody out by accident', () => {
        // The write path stores '1' or ''. Anything else reaching this key (an older build, a hand
        // edit, a half-finished migration) must fail SAFE: still in the scheme, still deducting.
        // The unsafe direction is the one that silently stops a real deduction.
        for (const junk of ['0', 'false', 'true', 'yes', ' 1', '1 ', 'null']) {
            _ls.set(SK.pensionOptOut, junk);
            assert.equal(isPensionOptedOut(), false, `"${junk}" must not read as opted out`);
            assert.equal(getPensionDefault({}), GRADES.cea.pension);
        }
        _ls.delete(SK.pensionOptOut);
        assert.equal(isPensionOptedOut(), false);
        assert.equal(getPensionDefault({}), GRADES.cea.pension);
    });
});
