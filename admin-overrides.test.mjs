/**
 * Unit tests for admin-overrides.js pure/near-pure exports.
 * Run with: node --experimental-test-module-mocks --test admin-overrides.test.mjs
 *
 * firebase-client.js is mocked — it imports Firebase from CDN URLs unreachable in Node.
 * global.document is stubbed so validateShiftRules' DOM marking no-ops cleanly.
 */

import { test, describe, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// validateShiftRules calls document.getElementById to mark grid rows with .row-error.
// Return null so the optional-chain .querySelector?.(...)?.classList silently no-ops.
// createElement is needed by renderTable() (called inside recordRangeOverrides after commit).
global.document = {
    getElementById: () => null,
    createElement: () => ({ innerHTML: '', dataset: {}, style: {} }),
};

// Shared mock objects referenced by more than one export, hoisted so both the mock and the tests
// can reach them. `auth` is mutated by tests to set currentUser.
const mockAuth = { currentUser: null };

// How many of the NEXT batch.commit() calls should throw `permission-denied` (tests set this to
// simulate a stale-claim manager token). Each mock batch also refuses a second commit on the SAME
// object, so a bug that reused a committed WriteBatch on retry would fail this test.
let _failNextCommits = 0;

// Faithful copy of firebase-client.writeWithClaimRetry so recordRangeOverrides exercises the real
// retry wiring in tests (the true function can't be imported — firebase-client.js pulls the CDN).
// Mirrors the real helper's error-preservation: if the token refresh itself fails, the ORIGINAL
// permission-denied is re-thrown (not the refresh error) so callers key their message on err.code.
async function mockWriteWithClaimRetry(writeFn) {
    try {
        return await writeFn();
    } catch (err) {
        const user = mockAuth.currentUser;
        if (/** @type {any} */ (err)?.code === 'permission-denied' && user) {
            try {
                await user.getIdToken(true);
            } catch {
                throw err;                     // preserve the original permission-denied
            }
            return await writeFn();
        }
        throw err;
    }
}

// Must be called before importing the module under test.
mock.module('./firebase-client.js', {
    namedExports: {
        db:              null,
        collection:      () => null,
        query:           () => null,
        orderBy:         () => null,
        limit:           () => null,
        getDocs:         async () => ({ forEach: () => {} }),
        deleteDoc:       async () => {},
        doc:             (() => { let n = 0; return () => ({ id: 'mock-doc-' + (++n) }); })(),
        serverTimestamp: () => null,
        writeBatch:      () => {
            let committed = false;
            return {
                set: () => {}, delete: () => {},
                commit: async () => {
                    if (committed) throw new Error('WriteBatch reused after commit()');
                    committed = true;
                    if (_failNextCommits > 0) {
                        _failNextCommits--;
                        const e = /** @type {any} */ (new Error('Missing or insufficient permissions'));
                        e.code = 'permission-denied';
                        throw e;
                    }
                },
            };
        },
        writeWithClaimRetry:           mockWriteWithClaimRetry,
        auth:                          mockAuth,
        authReady:                     Promise.resolve(),
        onAuthStateChanged:            () => () => {},
        nameToEmail:                   () => '',
        normaliseSurname:              s => s,
        signInWithEmailAndPassword:    async () => {},
        createUserWithEmailAndPassword: async () => {},
        signInAnonymously:             async () => {},
        signOut:                       async () => {},
        COLLECTIONS:     { overrides: 'overrides', huddles: 'huddles', circulars: 'circulars', newsletters: 'newsletters', pushSubscriptions: 'pushSubscriptions', staffContact: 'staffContact', clientErrors: 'clientErrors', linkDesigns: 'linkDesigns' },
    },
});

// admin-overrides.js imports `sessionReady` from session.js; recordRangeOverrides/executeSave await it
// before the auth.currentUser check (the v14.86 write-race fix). Provide an already-resolved promise so
// those awaits don't hang on the real (never-resolved-in-test) sessionReady.
mock.module('./session.js', { namedExports: { sessionReady: Promise.resolve(true) } });

const {
    getEffectiveShift,
    validateShiftRules,
    buildMemberDateMap,
    setAllOverrides,
    getAllOverrides,
    recordRangeOverrides,
    executeSave,
} = await import('./admin-overrides.js');

// Grab the mocked auth object so we can set currentUser for recordRangeOverrides tests.
const { auth } = await import('./firebase-client.js');

// ── getEffectiveShift ─────────────────────────────────────────────────────────

describe('getEffectiveShift', () => {

    beforeEach(() => setAllOverrides([]));

    test('batch entry takes priority over _allOverrides and base roster', () => {
        setAllOverrides([{ memberName: 'G. Miller', date: '2026-06-15', value: 'EXISTING' }]);
        const result = getEffectiveShift('G. Miller', '2026-06-15', [
            { date: '2026-06-15', value: '07:00-15:00' },
        ]);
        assert.equal(result, '07:00-15:00');
    });

    test('falls back to _allOverrides when date is absent from batch', () => {
        setAllOverrides([{ memberName: 'G. Miller', date: '2026-06-15', value: '09:00-17:00' }]);
        assert.equal(getEffectiveShift('G. Miller', '2026-06-15', []), '09:00-17:00');
    });

    test('override for a different member is not returned', () => {
        setAllOverrides([{ memberName: 'G. Miller', date: '2026-06-15', value: '07:00-15:00' }]);
        // C. Reen's base roster on 2026-06-15 (Monday) is 12:00-19:00
        assert.equal(getEffectiveShift('C. Reen', '2026-06-15', []), '12:00-19:00');
    });

    test('falls back to base roster — C. Reen Monday returns 12:00-19:00', () => {
        // C. Reen: fixed Mon–Fri 12:00-19:00. 2026-06-15 is Monday.
        assert.equal(getEffectiveShift('C. Reen', '2026-06-15', []), '12:00-19:00');
    });

    test('falls back to base roster — C. Reen Sunday returns RD', () => {
        // 2026-06-14 is Sunday.
        assert.equal(getEffectiveShift('C. Reen', '2026-06-14', []), 'RD');
    });

    test('returns RD for a member name not in teamMembers', () => {
        assert.equal(getEffectiveShift('Imaginary Person', '2026-06-15', []), 'RD');
    });
});

// ── buildMemberDateMap ────────────────────────────────────────────────────────

describe('buildMemberDateMap', () => {

    beforeEach(() => setAllOverrides([]));

    test('returns empty Map when _allOverrides is empty', () => {
        assert.equal(buildMemberDateMap('G. Miller').size, 0);
    });

    test('returns empty Map when overrides exist only for other members', () => {
        setAllOverrides([{ memberName: 'C. Reen', date: '2026-06-15', value: '12:00-19:00' }]);
        assert.equal(buildMemberDateMap('G. Miller').size, 0);
    });

    test('includes only overrides for the target member', () => {
        setAllOverrides([
            { memberName: 'G. Miller', date: '2026-06-15', value: '07:00-15:00' },
            { memberName: 'C. Reen',   date: '2026-06-15', value: '12:00-19:00' },
        ]);
        const map = buildMemberDateMap('G. Miller');
        assert.equal(map.size, 1);
        assert.equal(map.get('2026-06-15').value, '07:00-15:00');
    });

    test('includes all dates when member has multiple overrides', () => {
        setAllOverrides([
            { memberName: 'G. Miller', date: '2026-06-15', value: '07:00-15:00' },
            { memberName: 'G. Miller', date: '2026-06-16', value: 'AL' },
        ]);
        const map = buildMemberDateMap('G. Miller');
        assert.equal(map.size, 2);
        assert.ok(map.has('2026-06-15'));
        assert.ok(map.has('2026-06-16'));
    });

    test('map values are the full override objects', () => {
        const entry = { memberName: 'G. Miller', date: '2026-06-15', value: 'AL', type: 'annual_leave' };
        setAllOverrides([entry]);
        const map = buildMemberDateMap('G. Miller');
        assert.deepEqual(map.get('2026-06-15'), entry);
    });

    // Regression: v13.97 — bare .find() returned whichever doc arrived first in
    // the array; buildMemberDateMap must apply shouldReplaceOverride() so a manual
    // override always beats a roster_import doc for the same (member, date).
    test('manual override beats roster_import for the same date (precedence regression)', () => {
        const importDoc = { memberName: 'G. Miller', date: '2026-06-15', value: '09:00-17:00', source: 'roster_import',
            createdAt: { seconds: 1000 } };
        const manualDoc = { memberName: 'G. Miller', date: '2026-06-15', value: 'AL', source: 'manual',
            createdAt: { seconds: 500 } }; // older timestamp but manual → must win
        // Both orderings of the array must yield the manual doc.
        setAllOverrides([importDoc, manualDoc]);
        assert.equal(buildMemberDateMap('G. Miller').get('2026-06-15')?.value, 'AL',
            'manual doc should win even when roster_import arrives first in the array');
        setAllOverrides([manualDoc, importDoc]);
        assert.equal(buildMemberDateMap('G. Miller').get('2026-06-15')?.value, 'AL',
            'manual doc should win even when roster_import arrives second in the array');
    });

    test('among same-source overrides, newer createdAt wins', () => {
        const older = { memberName: 'G. Miller', date: '2026-06-15', value: '07:00-15:00', source: 'manual',
            createdAt: { seconds: 100 } };
        const newer = { memberName: 'G. Miller', date: '2026-06-15', value: '09:00-17:00', source: 'manual',
            createdAt: { seconds: 200 } };
        setAllOverrides([older, newer]);
        assert.equal(buildMemberDateMap('G. Miller').get('2026-06-15')?.value, '09:00-17:00');
        setAllOverrides([newer, older]);
        assert.equal(buildMemberDateMap('G. Miller').get('2026-06-15')?.value, '09:00-17:00');
    });
});

// ── validateShiftRules ────────────────────────────────────────────────────────
//
// Uses 'NONEXISTENT' as memberName throughout — not in teamMembers, so adjacent
// base-roster lookups always return 'RD', keeping rest-gap checks isolated to
// the cases we explicitly control.

describe('validateShiftRules', () => {

    beforeEach(() => setAllOverrides([]));

    test('empty toSave → no errors', () => {
        assert.deepEqual(validateShiftRules([], 'NONEXISTENT'), []);
    });

    test('fixed type annual_leave is skipped — no errors', () => {
        const toSave = [{ date: '2026-06-15', value: 'AL', type: 'annual_leave' }];
        assert.deepEqual(validateShiftRules(toSave, 'NONEXISTENT'), []);
    });

    test('fixed type correction is skipped — no errors', () => {
        const toSave = [{ date: '2026-06-15', value: 'RD', type: 'correction' }];
        assert.deepEqual(validateShiftRules(toSave, 'NONEXISTENT'), []);
    });

    test('fixed type sick is skipped — no errors', () => {
        const toSave = [{ date: '2026-06-15', value: 'SICK', type: 'sick' }];
        assert.deepEqual(validateShiftRules(toSave, 'NONEXISTENT'), []);
    });

    test('training WITHOUT times is skipped — the pay defaults apply, nothing to validate', () => {
        for (const value of ['TRG', 'IND RDW', 'ASSESS']) {
            assert.deepEqual(validateShiftRules([{ date: '2026-06-15', value, type: 'other' }], 'NONEXISTENT'), [], value);
        }
    });

    test('training WITH times validates the time part (13h → max-12h error, not a NaN no-op)', () => {
        const toSave = [{ date: '2026-06-15', value: 'TRG RDW 06:00-19:00', type: 'other' }];
        const errors = validateShiftRules(toSave, 'NONEXISTENT');
        assert.equal(errors.length, 1);
        assert.match(errors[0], /max is 12h/);
    });

    test('training with valid times passes', () => {
        const toSave = [{ date: '2026-06-15', value: 'TRG 08:00-16:00', type: 'other' }];
        assert.deepEqual(validateShiftRules(toSave, 'NONEXISTENT'), []);
    });

    test('value without hyphen (SPARE) is skipped — no errors', () => {
        const toSave = [{ date: '2026-06-15', value: 'SPARE', type: 'shift' }];
        assert.deepEqual(validateShiftRules(toSave, 'NONEXISTENT'), []);
    });

    test('valid 8h shift with no adjacent worked shifts → no errors', () => {
        const toSave = [{ date: '2026-06-15', value: '07:00-15:00', type: 'shift' }];
        assert.deepEqual(validateShiftRules(toSave, 'NONEXISTENT'), []);
    });

    test('exactly 12h shift is allowed (> not >=)', () => {
        // 07:00-19:00 = 720 mins exactly — should NOT trigger the >12h check
        const toSave = [{ date: '2026-06-15', value: '07:00-19:00', type: 'shift' }];
        assert.deepEqual(validateShiftRules(toSave, 'NONEXISTENT'), []);
    });

    test('shift over 12h produces one error mentioning the duration', () => {
        // 07:00-20:00 = 13h
        const toSave = [{ date: '2026-06-15', value: '07:00-20:00', type: 'shift' }];
        const errors = validateShiftRules(toSave, 'NONEXISTENT');
        assert.equal(errors.length, 1);
        assert.match(errors[0], /13h/);
        assert.match(errors[0], /max is 12h/);
    });

    test('short rest gap after previous day override → error mentioning gap', () => {
        // Previous day 14:00-22:00: effectiveEnd = 1320.
        // Current 07:00-15:00: startMins = 420. gap = 420+1440-1320 = 540 = 9h.
        setAllOverrides([{ memberName: 'NONEXISTENT', date: '2026-06-14', value: '14:00-22:00' }]);
        const toSave = [{ date: '2026-06-15', value: '07:00-15:00', type: 'shift' }];
        const errors = validateShiftRules(toSave, 'NONEXISTENT');
        assert.equal(errors.length, 1);
        assert.match(errors[0], /9h/);
        assert.match(errors[0], /need 12h/);
    });

    test('adequate 17h rest after previous day → no errors', () => {
        // Previous day 05:00-14:00: effectiveEnd = 840.
        // Current 07:00-15:00: startMins = 420. gap = 420+1440-840 = 1020 = 17h.
        setAllOverrides([{ memberName: 'NONEXISTENT', date: '2026-06-14', value: '05:00-14:00' }]);
        const toSave = [{ date: '2026-06-15', value: '07:00-15:00', type: 'shift' }];
        assert.deepEqual(validateShiftRules(toSave, 'NONEXISTENT'), []);
    });

    test('short rest gap to next-day shift in same batch → both entries flag an error', () => {
        // 14:00-22:00 then 07:00-15:00 next day = 9h rest → both entries should error
        const toSave = [
            { date: '2026-06-15', value: '14:00-22:00', type: 'shift' },
            { date: '2026-06-16', value: '07:00-15:00', type: 'shift' },
        ];
        const errors = validateShiftRules(toSave, 'NONEXISTENT');
        assert.equal(errors.length, 2);
    });

    test('overnight shift 22:00-06:00 is 8h and passes all checks in isolation', () => {
        // effectiveEnd = 06:00+24h offset = 1800; start = 1320; duration = 480 = 8h
        const toSave = [{ date: '2026-06-15', value: '22:00-06:00', type: 'shift' }];
        assert.deepEqual(validateShiftRules(toSave, 'NONEXISTENT'), []);
    });

    test('rdw type is not fixed — duration and rest checks apply', () => {
        // rdw: fixed=false, so the 13h check runs
        const toSave = [{ date: '2026-06-15', value: '07:00-20:00', type: 'rdw' }];
        const errors = validateShiftRules(toSave, 'NONEXISTENT');
        assert.equal(errors.length, 1);
        assert.match(errors[0], /13h/);
    });
});

// ── recordRangeOverrides — Sunday prohibition (layer 3 of 5) ─────────────────
//
// CLAUDE.md: "Sundays are non-contracted — AL and Absent cannot be recorded on
// Sundays."  The filter in recordRangeOverrides is layer 3; the other 4 layers
// live in the week-grid pill rendering, bulk-bar skip, computeCellStates, and
// calendar-app.js Sunday sick suppression.
//
// Test date: Mon 15 Jun – Sun 21 Jun 2026.  G. Miller is on main roster Week 1
// (Mon-Sat all SPARE) for 15-20 Jun and Week 2 (sun: '14:30-23:25') for 21 Jun.
// Week 2 Sunday is a worked shift → without the filter it would be a sundayCount
// candidate; with the filter the AL override is never written for 21 Jun.

describe('recordRangeOverrides — Sunday prohibition', () => {

    beforeEach(() => {
        setAllOverrides([]);
        auth.currentUser = { uid: 'test-user', displayName: 'Test' };
    });

    test('Sunday (21 Jun 2026) is excluded from written AL overrides even when base shift is worked', async () => {
        const dates = [
            '2026-06-15', '2026-06-16', '2026-06-17',
            '2026-06-18', '2026-06-19', '2026-06-20',
            '2026-06-21', // Sunday — must be excluded from workingDates
        ];
        const result = await recordRangeOverrides({
            type: 'annual_leave', value: 'AL',
            memberName: 'G. Miller', dates, changedBy: 'G. Miller',
        });

        // Sunday must not appear as an AL override (it may appear as an RD correction)
        const writtenALDates = getAllOverrides()
            .filter(o => o.type === 'annual_leave')
            .map(o => o.date);
        assert.ok(!writtenALDates.includes('2026-06-21'),
            'Sunday 2026-06-21 must not be written as an AL override');

        // workingCount covers Mon-Sat (Week 1 = all SPARE = worked), not Sunday
        assert.equal(result.workingCount, 6, 'Mon-Sat SPARE days → workingCount 6');

        // sundayCount: Jun 21 Week 2 Sunday has shift 14:30-23:25 (worked), no existing override
        assert.equal(result.sundayCount, 1, 'Worked Sunday should trigger an RD correction doc');
    });

    test('Sunday correction doc is type correction / value RD — the AL override is never written', async () => {
        // Sat 20 Jun (SPARE = worked) + Sun 21 Jun (worked base 14:30-23:25):
        // the batch runs (workingCount=1 for Saturday), Sunday correction is also committed.
        const dates = ['2026-06-20', '2026-06-21'];
        await recordRangeOverrides({
            type: 'annual_leave', value: 'AL',
            memberName: 'G. Miller', dates, changedBy: 'G. Miller',
        });
        const docs = getAllOverrides();
        // Saturday is written as AL
        assert.equal(docs.find(o => o.date === '2026-06-20')?.type, 'annual_leave');
        // Sunday is NOT written as AL
        assert.equal(docs.find(o => o.date === '2026-06-21' && o.type === 'annual_leave'), undefined,
            'AL doc must not be written for a Sunday');
        // Sunday is written as an RD correction instead
        const rdDoc = docs.find(o => o.date === '2026-06-21' && o.type === 'correction');
        assert.ok(rdDoc, 'RD correction doc should be written for a worked Sunday');
        assert.equal(rdDoc?.value, 'RD');
    });

    test('a non-worked Sunday (RD base) is silently skipped — no override written at all', async () => {
        // Week 3, Sunday is RD.  G. Miller is on Week 3 on the reference date 8 Feb 2026.
        // 8 Feb 2026 is itself a Sunday — base shift for that date is Week 3 Sunday = 'RD'.
        const dates = ['2026-02-08'];
        const result = await recordRangeOverrides({
            type: 'annual_leave', value: 'AL',
            memberName: 'G. Miller', dates, changedBy: 'G. Miller',
        });
        assert.equal(result.workingCount, 0);
        assert.equal(result.sundayCount, 0, 'RD Sunday must not trigger a correction doc');
        assert.equal(getAllOverrides().length, 0, 'No docs written for an RD Sunday');
    });
});

// ── recordRangeOverrides — stale-claim write retry (B3 safety net, v15.18) ────
//
// A just-provisioned manager can hold a token minted before their `manager` claim existed, so the
// first on-behalf override write fails `permission-denied`. writeWithClaimRetry force-refreshes the
// token once and retries — the batch is REBUILT (a WriteBatch can't be re-committed).

describe('recordRangeOverrides — stale-claim retry', () => {

    beforeEach(() => {
        setAllOverrides([]);
        _failNextCommits = 0;
        mockAuth.currentUser = null;
    });

    test('a permission-denied write force-refreshes the token once and retries, and the save succeeds', async () => {
        const refreshCalls = [];
        mockAuth.currentUser = { uid: 'mgr', getIdToken: async (/** @type {boolean} */ f) => { refreshCalls.push(f); } };
        _failNextCommits = 1;   // first commit throws permission-denied; the retry's fresh batch succeeds

        // Mon 15 Jun 2026 — G. Miller Week 1 is SPARE (worked), so one AL override is written.
        const result = await recordRangeOverrides({
            type: 'annual_leave', value: 'AL',
            memberName: 'G. Miller', dates: ['2026-06-15'], changedBy: 'S. Stewart',
        });

        assert.deepEqual(refreshCalls, [true], 'getIdToken(true) called exactly once, forced');
        assert.equal(result.workingCount, 1, 'the retried save reports the worked day');
        // Exactly ONE AL doc — the failed first attempt's docs are discarded, so no ghost/duplicate
        // row: the cache reflects only the successful retry's rebuilt batch (reviewer point 3).
        assert.equal(getAllOverrides().filter(o => o.type === 'annual_leave' && o.date === '2026-06-15').length, 1,
            'the AL override is written after the retry');
    });

    test('a permission-denied that persists on retry surfaces to the caller, refreshes ONCE, writes nothing', async () => {
        const refreshCalls = [];
        mockAuth.currentUser = { uid: 'mgr', getIdToken: async (/** @type {boolean} */ f) => { refreshCalls.push(f); } };
        _failNextCommits = 2;   // both the first attempt and the retry fail

        // recordRangeOverrides has no try/catch — it rejects so the caller (AL/sick save handler)
        // shows its own error rather than silently reporting success.
        await assert.rejects(
            () => recordRangeOverrides({
                type: 'annual_leave', value: 'AL',
                memberName: 'G. Miller', dates: ['2026-06-15'], changedBy: 'S. Stewart',
            }),
            /** @param {any} err */ err => err?.code === 'permission-denied',
        );
        // One forced refresh only — no retry loop, so a genuine authorisation denial isn't masked.
        assert.deepEqual(refreshCalls, [true], 'exactly one forced token refresh, then the denial stands');
        assert.equal(getAllOverrides().length, 0, 'nothing is written when both attempts fail');
    });

    test('when the token refresh itself fails, the ORIGINAL permission-denied is preserved (not the refresh error) and the write is not retried', async () => {
        let refreshCalls = 0;
        mockAuth.currentUser = {
            uid: 'mgr',
            // Refresh blows up (offline/flaky) — its network error must NOT replace the permission-denied.
            getIdToken: async () => { refreshCalls++; throw new Error('network-request-failed'); },
        };
        // Count commit attempts via _failNextCommits: first commit throws permission-denied; if the
        // helper wrongly retried after a failed refresh, a second commit would run.
        _failNextCommits = 1;
        const _origLen = getAllOverrides().length;
        await assert.rejects(
            () => recordRangeOverrides({
                type: 'annual_leave', value: 'AL',
                memberName: 'G. Miller', dates: ['2026-06-15'], changedBy: 'S. Stewart',
            }),
            /** @param {any} err */ err => err?.code === 'permission-denied' && !/network/.test(err?.message ?? ''),
        );
        assert.equal(refreshCalls, 1, 'exactly one refresh attempt');
        // _failNextCommits stays at 0 (consumed by the single first commit); had it retried, it would
        // have attempted a second commit that (with the counter at 0) would have SUCCEEDED and written.
        assert.equal(getAllOverrides().length, _origLen, 'no write lands — the failed refresh aborts before any retry');
    });
});

// ── executeSave (Change a Shift path) — same stale-claim retry ─────────────────
//
// executeSave is the week-grid "Save changes" write. It has its OWN try/catch, so a persistent
// permission-denied is swallowed into _showError (no throw) and the in-memory cache is NOT mutated.

describe('executeSave — stale-claim retry', () => {

    beforeEach(() => {
        setAllOverrides([]);
        _failNextCommits = 0;
        mockAuth.currentUser = null;
    });

    test('a permission-denied write force-refreshes once, retries, and the shift save lands', async () => {
        const refreshCalls = [];
        mockAuth.currentUser = { uid: 'mgr', getIdToken: async (/** @type {boolean} */ f) => { refreshCalls.push(f); } };
        _failNextCommits = 1;

        await executeSave([{ memberName: 'G. Miller', date: '2026-06-15', type: 'shift', value: '07:00-15:00', note: '' }]);

        assert.deepEqual(refreshCalls, [true], 'getIdToken(true) called exactly once, forced');
        const saved = getAllOverrides().filter(o => o.date === '2026-06-15' && o.value === '07:00-15:00');
        assert.equal(saved.length, 1, 'the shift override is cached after the retry (no ghost row from attempt 1)');
    });

    test('a persistent permission-denied leaves the cache untouched (UI cannot lie)', async () => {
        setAllOverrides([{ id: 'keep-1', memberName: 'G. Miller', date: '2026-05-01', type: 'shift', value: '08:00-16:00' }]);
        mockAuth.currentUser = { uid: 'mgr', getIdToken: async () => {} };
        _failNextCommits = 2;   // both attempts fail — executeSave swallows into _showError

        await executeSave([{ memberName: 'G. Miller', date: '2026-06-15', type: 'shift', value: '07:00-15:00', note: '' }]);

        const all = getAllOverrides();
        assert.equal(all.length, 1, 'no new doc cached when both attempts fail');
        assert.equal(all[0].id, 'keep-1', 'the pre-existing cache entry is unchanged');
    });
});
