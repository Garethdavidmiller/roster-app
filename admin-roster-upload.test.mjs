/**
 * admin-roster-upload.test.mjs
 * Tests for shiftValueToOverrideType — the parsed-value → Firestore override `type`
 * classification (hoisted to module scope + exported at v15.34 so it is unit-testable).
 * Run with: node --experimental-test-module-mocks --test admin-roster-upload.test.mjs
 *
 * firebase-client.js is mocked via mock.module() because it imports Firebase
 * from CDN URLs that are unreachable in Node. roster-data.js and override-utils.js
 * are pure and imported for real.
 */

import { test, describe, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ── Mock-controllable state for the roster-upload save-path tests ───────────────
let   _idTokenRefreshes = 0;
let   _refreshShouldFail = false;     // model getIdToken(true) failing (offline/flaky)
let   _commitBehavior   = () => {};   // called on each batch.commit(); may throw
const _batchOps         = [];         // one ops-array per writeBatch() call
// getDocs impl the fetchOverridesForWeek tests swap in (default: empty result set).
let   _getDocsImpl      = async () => ({ docs: [] });

/** A permission-denied error shaped like Firestore's (writeWithClaimRetry keys on .code). */
function _denied() {
    const e = new Error('Missing or insufficient permissions.');
    /** @type {any} */ (e).code = 'permission-denied';
    return e;
}

// mock.module must be called before the module under test is imported.
mock.module('./firebase-client.js', {
    namedExports: {
        db: null,
        collection: () => ({}),
        query: () => null,
        where: () => null,
        getDocs: async (/** @type {any} */ ...args) => _getDocsImpl(...args),
        doc: () => ({}),
        writeBatch: () => {
            const ops = [];
            _batchOps.push(ops);
            return {
                set:    (/** @type {any} */ _ref, /** @type {any} */ data) => ops.push({ op: 'set', data }),
                delete: () => ops.push({ op: 'delete' }),
                commit: async () => { _commitBehavior(); },
            };
        },
        serverTimestamp: () => 'TS',
        // Faithful mini-implementation of the real helper: run the thunk; on permission-denied,
        // "force a token refresh" (counter) and retry once; any other error rethrows immediately.
        writeWithClaimRetry: async (/** @type {Function} */ fn) => {
            try { return await fn(); }
            catch (err) {
                if (/** @type {any} */ (err)?.code === 'permission-denied') {
                    // Model getIdToken(true): it may fail (offline/flaky). When it does, the ORIGINAL
                    // permission-denied is preserved and NOT replaced by the refresh's own error — the
                    // caller keys its user-facing message on err.code (matches firebase-client.js).
                    try {
                        if (_refreshShouldFail) throw new Error('token refresh failed (network)');
                        _idTokenRefreshes++;
                    } catch { throw err; }
                    return await fn();   // retry once with the fresh token
                }
                throw err;
            }
        },
        COLLECTIONS: { overrides: 'overrides' },
    },
});

const { shiftValueToOverrideType, _saveOverrideBatches, fetchOverridesForWeek } = await import('./admin-roster-upload.js');

// 2026-06-21 is a Sunday; 2026-06-15 is a Monday.
const SUN = '2026-06-21';
const MON = '2026-06-15';

describe('shiftValueToOverrideType — existing vocabulary (regression)', () => {
    test('AL → annual_leave; SICK → sick; SPARE → spare_shift', () => {
        assert.equal(shiftValueToOverrideType('AL', 'RD', MON), 'annual_leave');
        assert.equal(shiftValueToOverrideType('SICK', 'RD', MON), 'sick');
        assert.equal(shiftValueToOverrideType('SPARE', 'RD', MON), 'spare_shift');
    });

    test('RD / OFF → correction', () => {
        assert.equal(shiftValueToOverrideType('RD', '06:00-14:00', MON), 'correction');
        assert.equal(shiftValueToOverrideType('OFF', '06:00-14:00', MON), 'correction');
    });

    test('pipe-encoded RDW and bare RDW → rdw', () => {
        assert.equal(shiftValueToOverrideType('RDW|14:30-22:00', 'RD', MON), 'rdw');
        assert.equal(shiftValueToOverrideType('RDW', 'RD', MON), 'rdw');
    });

    test('plain time → shift on a weekday, rdw on a Sunday (Sundays uncontracted)', () => {
        assert.equal(shiftValueToOverrideType('06:30-14:30', 'RD', MON), 'shift');
        assert.equal(shiftValueToOverrideType('06:30-14:30', 'RD', SUN), 'rdw');
    });

    test('Sunday AL / SICK → correction (the Sunday block)', () => {
        assert.equal(shiftValueToOverrideType('AL', 'RD', SUN), 'correction');
        assert.equal(shiftValueToOverrideType('SICK', 'RD', SUN), 'correction');
    });
});

describe('shiftValueToOverrideType — training (OTHER_PLAN.md)', () => {
    test('every training grammar form → training', () => {
        for (const v of ['TRG', 'IND', 'ASSESS', 'TRG RDW', 'IND RDW', 'ASSESS RDW',
                         'TRG 08:00-16:00', 'TRG RDW 08:00-16:00']) {
            assert.equal(shiftValueToOverrideType(v, 'RD', MON), 'other', v);
        }
    });

    test('Sunday training → correction (layer 1 of the Sunday block — never written as training)', () => {
        for (const v of ['TRG', 'TRG RDW', 'IND', 'ASSESS']) {
            assert.equal(shiftValueToOverrideType(v, 'RD', SUN), 'correction', v);
        }
    });

    test('a training value never falls through to rdw/shift on its RDW substring', () => {
        // 'TRG RDW' contains 'RDW' — the training check must classify it before the
        // RDW checks could ever see it.
        assert.equal(shiftValueToOverrideType('TRG RDW', '06:00-14:00', MON), 'other');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// _saveOverrideBatches — stale-claim retry parity (v15.70; the v15.48/v15.69
// review fix — roster-import saves now self-heal a stale admin/manager claim,
// like every other Admin write path).
// ─────────────────────────────────────────────────────────────────────────────

describe('_saveOverrideBatches — stale-claim retry parity', () => {
    beforeEach(() => { _idTokenRefreshes = 0; _refreshShouldFail = false; _batchOps.length = 0; _commitBehavior = () => {}; });

    const one = [{ memberName: 'G. Miller', date: MON, value: '06:30-14:30', baseShift: 'RD' }];

    test('happy path — one batch, one commit, no token refresh, roster_import payload', async () => {
        await _saveOverrideBatches(one, 'G. Miller');
        assert.equal(_batchOps.length, 1);
        const sets = _batchOps[0].filter(o => o.op === 'set');
        assert.equal(sets.length, 1);
        assert.equal(sets[0].data.source, 'roster_import');
        assert.equal(sets[0].data.type, 'shift');       // weekday plain time → shift
        assert.equal(sets[0].data.value, '06:30-14:30');
        assert.equal(sets[0].data.changedBy, 'G. Miller');
        assert.equal(_idTokenRefreshes, 0);
    });

    test('weekday RDW import (RDW-encoded value from computeCellStates) saves type rdw, not shift', async () => {
        // Regression: a weekday rest-day-worked import used to save the BARE time → type 'shift'
        // (RDW overtime dropped from the calendar badge + paycalc RDW pre-fill). computeCellStates
        // now hands _saveOverrideBatches the RDW-encoded value; the save must write {type:'rdw'}
        // with the plain time (the RDW| encoding stripped).
        await _saveOverrideBatches(
            [{ memberName: 'G. Miller', date: MON, value: 'RDW|14:30-22:00', baseShift: 'RD' }], 'G. Miller');
        const sets = _batchOps[0].filter(o => o.op === 'set');
        assert.equal(sets.length, 1);
        assert.equal(sets[0].data.type, 'rdw');
        assert.equal(sets[0].data.value, '14:30-22:00');
    });

    test('permission-denied once → force token refresh → batch REBUILT → success', async () => {
        let n = 0;
        _commitBehavior = () => { if (n++ === 0) throw _denied(); };   // first commit denied, second ok
        await _saveOverrideBatches(one, 'G. Miller');                  // must NOT throw
        assert.equal(_idTokenRefreshes, 1, 'forced exactly one token refresh');
        assert.equal(_batchOps.length, 2, 'a fresh batch was built for the retry (not reused)');
    });

    test('persistent permission-denied → rejects after one retry (feedback stays error)', async () => {
        _commitBehavior = () => { throw _denied(); };
        await assert.rejects(_saveOverrideBatches(one, 'G. Miller'), /permission/i);
        assert.equal(_idTokenRefreshes, 1, 'refreshed once');
        assert.equal(_batchOps.length, 2, 'tried the original + one retry, then gave up');
    });

    test('token refresh itself FAILS → original permission-denied preserved, no retry', async () => {
        // Offline/flaky getIdToken(true): the caller must still see a permission-denied (an
        // authorisation problem), NOT the refresh's network error — and there is no second attempt.
        _refreshShouldFail = true;
        _commitBehavior = () => { throw _denied(); };
        await assert.rejects(_saveOverrideBatches(one, 'G. Miller'), /permission/i);
        assert.equal(_idTokenRefreshes, 0, 'refresh failed → not counted as a successful refresh');
        assert.equal(_batchOps.length, 1, 'no retry attempted after a failed refresh');
    });

    test('a non-auth error is NOT retried', async () => {
        _commitBehavior = () => { throw new Error('network down'); };
        await assert.rejects(_saveOverrideBatches(one, 'G. Miller'), /network/);
        assert.equal(_idTokenRefreshes, 0);
        assert.equal(_batchOps.length, 1);
    });

    test('deleteOnly (REMOVE_IMPORT) writes a delete and no set', async () => {
        await _saveOverrideBatches(
            [{ memberName: 'G. Miller', date: MON, value: 'RD', baseShift: '06:00-14:00', replaceId: 'stale1', deleteOnly: true }],
            'G. Miller');
        assert.equal(_batchOps[0].filter(o => o.op === 'set').length, 0);
        assert.equal(_batchOps[0].filter(o => o.op === 'delete').length, 1);
    });

    test('replaceId on a normal write emits a delete + a set (replace in place)', async () => {
        await _saveOverrideBatches(
            [{ memberName: 'G. Miller', date: MON, value: '06:30-14:30', baseShift: 'RD', replaceId: 'old1' }],
            'G. Miller');
        assert.equal(_batchOps[0].filter(o => o.op === 'delete').length, 1);
        assert.equal(_batchOps[0].filter(o => o.op === 'set').length, 1);
    });
});

// ── Roster Upload conflict-read FAIL-CLOSED (regression for the v16.24 Tier-1 bug) ──
// The existing-overrides read gates the review classification. If it fails, the upload must
// NOT proceed as "no existing overrides" — that let the review mark rows safe while blind to
// manual AL/absence/shift changes, so Save could silently overwrite/duplicate them. The fix:
// fetchOverridesForWeek THROWS a tagged `conflictReadFailed` error (never returns []) so the
// parse handler stops, hides the review, clears _cellStates, and shows the fail-closed message.
describe('fetchOverridesForWeek — fail-closed conflict read (v16.25 regression)', () => {
    beforeEach(() => { _getDocsImpl = async () => ({ docs: [] }); });

    test('a getDocs rejection throws a tagged conflictReadFailed error — NOT []', async () => {
        _getDocsImpl = async () => { throw new Error('unavailable'); };
        await assert.rejects(
            () => fetchOverridesForWeek(['2026-06-15', '2026-06-16']),
            (/** @type {any} */ err) => {
                // The tag is what routes the parse handler to fail-closed (hide review, clear
                // _cellStates, show "Couldn't check your existing saved changes"). Without it the
                // handler would treat the failure as a generic error, and a [] return would have
                // let the review apply blind — the exact Tier-1 bug.
                assert.equal(err.conflictReadFailed, true);
                assert.equal(err.message, 'CONFLICT_READ_FAILED');
                return true;
            });
    });

    test('a permission-denied rejection also fails closed (does not swallow to [])', async () => {
        _getDocsImpl = async () => { throw _denied(); };
        await assert.rejects(
            () => fetchOverridesForWeek(['2026-06-15']),
            (/** @type {any} */ err) => err.conflictReadFailed === true);
    });

    test('happy path returns the mapped overrides (id + data spread), never throws', async () => {
        _getDocsImpl = async () => ({
            docs: [
                { id: 'o1', data: () => ({ memberName: 'G. Miller', date: '2026-06-15', value: 'AL', source: 'manual' }) },
                { id: 'o2', data: () => ({ memberName: 'S. Boyle',  date: '2026-06-16', value: 'SICK', source: 'manual' }) },
            ],
        });
        const rows = await fetchOverridesForWeek(['2026-06-15', '2026-06-16']);
        assert.equal(rows.length, 2);
        assert.deepEqual(rows[0], { id: 'o1', memberName: 'G. Miller', date: '2026-06-15', value: 'AL', source: 'manual' });
        assert.equal(rows[1].id, 'o2');
    });
});
