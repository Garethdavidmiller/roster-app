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
import { readFileSync } from 'node:fs';

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

const { shiftValueToOverrideType, _saveOverrideBatches, fetchOverridesForWeek, computeCellStates,
        shiftDisplay, manualShiftDisplay, isZeroLengthRange } = await import('./admin-roster-upload.js');
const { teamMembers, getBaseShift } = await import('./roster-data.js');
// The alignment rules moved OUT of the coordinator at v22.16 (roster-alignment.js) — a Firebase-free
// module, so this import needs none of the mocking above.
const { detectShiftedRow, assessRosterAlignment, ALIGNMENT_BLOCK_THRESHOLD, driftCopy, stopCopy, geometryCopy } = await import('./roster-alignment.js');

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
        for (const v of ['TRG', 'IND', 'ASSESS', 'MEET', 'TRG RDW', 'IND RDW', 'ASSESS RDW', 'MEET RDW',
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

    test('a replaced doc\'s type survives into replacedType — swap evidence is not destroyed (v21.56)', async () => {
        // The import deletes the doc it replaces like every other write path, and it was the one
        // path not stamping what it destroyed: a re-import resolving a DIFF/CONFLICT over a
        // swapped-in day (a `shift` on a base rest day) erased the only evidence the member was
        // contracted to work it, and leave booked there afterwards went free.
        await _saveOverrideBatches(
            [{ memberName: 'G. Miller', date: MON, value: '06:30-14:30', baseShift: 'RD',
               replaceId: 'old1', replacedFrom: { type: 'rdw', replacedType: null } }], 'G. Miller');
        const sets = _batchOps[0].filter(o => o.op === 'set');
        assert.equal(sets[0].data.replacedType, 'rdw');
        assert.equal(_batchOps[0].filter(o => o.op === 'delete').length, 1);
    });

    test('replacing nothing writes NO replacedType key — the rules refuse a null', async () => {
        await _saveOverrideBatches(
            [{ memberName: 'G. Miller', date: MON, value: '06:30-14:30', baseShift: 'RD',
               replaceId: null, replacedFrom: null }], 'G. Miller');
        const sets = _batchOps[0].filter(o => o.op === 'set');
        assert.ok(!('replacedType' in sets[0].data));
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

// ── computeCellStates — the review state machine (hoisted to module scope + exported v16.37) ──
// Uses a real main-roster member and reads the actual base shift at setup, so the expectations
// track the real getBaseShift source rather than a brittle mock.
describe('computeCellStates — review state machine', () => {
    const member = teamMembers.find(/** @param {any} m */ m => !m.hidden && !m.managerOnly && m.rosterType === 'main');
    const mname  = member.name;
    const WD     = '2026-06-15';   // a Monday (non-Sunday)
    const base   = getBaseShift(member, new Date(WD + 'T12:00:00'));
    const differ = (base === 'RD' || base === 'OFF') ? '07:00-15:00' : 'RD';   // guaranteed != base

    /** @param {string} shiftVal @param {any[]} [existing] */
    const run = (shiftVal, existing = []) =>
        computeCellStates(
            { parsed: [{ memberName: mname, shifts: { [WD]: shiftVal } }], dates: [WD] },
            existing,
        ).get(`${mname}|${WD}`);

    test('parsed == base, no override → MATCH', () => {
        assert.equal(run(base).state, 'MATCH');
    });

    test('parsed differs from base, no override → DIFF (pre-approved)', () => {
        const c = run(differ);
        assert.equal(c.state, 'DIFF');
        assert.equal(c.chosen, true);
    });

    test('manual override already equals the PDF → COVERED', () => {
        const c = run(differ, [{ memberName: mname, date: WD, value: differ, type: 'shift', source: 'manual', id: 'm1' }]);
        assert.equal(c.state, 'COVERED');
    });

    test('manual override differs from the PDF → CONFLICT', () => {
        const c = run(differ, [{ memberName: mname, date: WD, value: '23:00-06:00', type: 'shift', source: 'manual', id: 'm2' }]);
        assert.equal(c.state, 'CONFLICT');
    });

    test('stale roster_import, PDF now matches base → REMOVE_IMPORT (delete, write nothing)', () => {
        const c = run(base, [{ memberName: mname, date: WD, value: differ, type: 'shift', source: 'roster_import', id: 'i1' }]);
        assert.equal(c.state, 'REMOVE_IMPORT');
    });

    test('bare "RDW" (AI omitted the time) → UNREADABLE, never written (chosen stays null)', () => {
        const c = run('RDW');
        assert.equal(c.state, 'UNREADABLE');
        assert.equal(c.chosen, null);
    });

    // ── Resolving a flagged cell from the review table (v19.32) ──────────────────────────────
    // Owner: "when something is flagged for review there is no way to choose the correct option
    // from the results screen." The server now sends both readings; these pin what the client does
    // with them — above all that a PICK cannot bypass a guard the parsed path enforces.

    // A weekday this member is ROSTERED TO WORK, and one they are not. Both guards below normalise
    // AL away on a rest day, so the "offers both readings" case is only observable on a worked day —
    // finding it by scanning beats hardcoding a date that a roster-data edit could silently flip.
    const scan = /** @param {(v: string) => boolean} pred */ pred => {
        for (let d = 1; d <= 28; d++) {
            const iso = `2026-06-${String(d).padStart(2, '0')}`;
            const dt  = new Date(iso + 'T12:00:00');
            if (dt.getDay() === 0) continue;                       // Sundays have their own rule
            if (pred(getBaseShift(member, dt))) return iso;
        }
        throw new Error('no suitable date found for the choice tests');
    };
    const WORKDAY = scan(/** @param {string} v */ v => /^\d{2}:\d{2}-/.test(v));
    const RESTDAY = scan(/** @param {string} v */ v => v === 'RD' || v === 'OFF');

    /** @param {string} shiftVal @param {string[]} cand @param {string} [date] */
    const runChoice = (shiftVal, cand, date = WORKDAY) =>
        computeCellStates(
            {
                parsed:  [{ memberName: mname, shifts: { [date]: shiftVal } }],
                dates:   [date],
                choices: { [`${mname}|${date}`]: cand },
            }, [],
        ).get(`${mname}|${date}`);

    test('a flagged cell with two known readings offers both, and still defaults to writing nothing', () => {
        const c = runChoice('UNKNOWN|AL or Rest day? (PDF unclear)', ['AL', 'RD']);
        assert.equal(c.state, 'UNREADABLE');
        assert.equal(c.chosen, null, 'untouched must still write nothing — the pre-v19.32 behaviour');
        assert.equal(c.options.length, 2);
        assert.deepEqual(c.options.map(/** @param {any} o */ o => o.value), ['AL', 'RD']);
    });

    test('a flagged cell over a MANUAL override records that a saved entry is at stake', () => {
        // Picking a reading writes with replaceId = the existing doc, so it REPLACES whatever is
        // there. For a previous import that is correct and routine. For a MANUAL entry it is the one
        // thing the review table otherwise guarantees never happens silently — a readable PDF value
        // in this situation becomes a CONFLICT row that shows "Saved: X" and asks. The flagged row
        // has to carry the same information, so the renderer can show it.
        const c = computeCellStates(
            {
                parsed:  [{ memberName: mname, shifts: { [WORKDAY]: 'UNKNOWN|AL or Rest day? (PDF unclear)' } }],
                dates:   [WORKDAY],
                choices: { [`${mname}|${WORKDAY}`]: ['AL', 'RD'] },
            },
            [{ memberName: mname, date: WORKDAY, value: '23:00-06:00', type: 'shift', source: 'manual', id: 'm9' }],
        ).get(`${mname}|${WORKDAY}`);
        assert.equal(c.state, 'UNREADABLE');
        assert.ok(c.options, 'still offers the two readings');
        assert.equal(c.isManual, true, 'the row must know a MANUAL entry would be replaced');
        assert.equal(c.manualValue, '23:00-06:00');
    });

    test('a flagged cell over a previous IMPORT is not flagged as manual', () => {
        const c = computeCellStates(
            {
                parsed:  [{ memberName: mname, shifts: { [WORKDAY]: 'UNKNOWN|AL or Rest day? (PDF unclear)' } }],
                dates:   [WORKDAY],
                choices: { [`${mname}|${WORKDAY}`]: ['AL', 'RD'] },
            },
            [{ memberName: mname, date: WORKDAY, value: '23:00-06:00', type: 'shift', source: 'roster_import', id: 'i9' }],
        ).get(`${mname}|${WORKDAY}`);
        assert.equal(c.isManual, false, 'replacing a previous import is routine, not a warning');
    });

    test('no candidates from the server → the old skip-only row, not a broken picker', () => {
        const c = run('UNKNOWN|garbled (PDF unclear)');
        assert.equal(c.state, 'UNREADABLE');
        assert.equal(c.options, null, 'fails open to skip-only when the server sent no readings');
    });

    test('a SUNDAY choice cannot smuggle AL past the Sunday guard', () => {
        // The whole point of routing options through normaliseCellValue. On a Sunday both readings
        // normalise to RD, so there is no longer a question to ask — and crucially no AL to pick.
        const c = runChoice('UNKNOWN|AL or Rest day? (PDF unclear)', ['AL', 'RD'], SUN);
        assert.equal(c.options, null, 'both readings collapse to RD — nothing to choose between');
    });

    test('a choice on a base REST DAY cannot smuggle AL past the rest-day guard', () => {
        // Same guard, the other axis (v16.19): AL on a day the member was not rostered to work must
        // not consume an entitlement day, whether the AL was parsed or picked.
        const c = runChoice('UNKNOWN|AL or Rest day? (PDF unclear)', ['AL', 'RD'], RESTDAY);
        assert.equal(c.options, null, 'AL on a base rest day normalises to RD, so both readings agree');
    });

    test('a Sunday "AL" is normalised to RD — never written as AL', () => {
        // SUN (2026-06-21) is the module-level Sunday constant.
        const c = computeCellStates(
            { parsed: [{ memberName: mname, shifts: { [SUN]: 'AL' } }], dates: [SUN] }, [],
        ).get(`${mname}|${SUN}`);
        assert.equal(c.displayShift, 'RD');   // the invariant: Sunday AL never surfaces/saves as AL
    });
});

// ── detectShiftedRow — the base-roster day-drift detector ─────────────────────
// The independent (non-AI) signal: a parsed week that correlates with the member's
// own base pattern ONE DAY out is very probably a drifted AI row read.

describe('detectShiftedRow', () => {
    const MEMBER = teamMembers.find(m => m.name === 'G. Miller');
    const DATES  = ['2026-08-02', '2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08'];
    const base   = (/** @type {string} */ d, off = 0) => {
        const dt = new Date(d + 'T12:00:00'); dt.setDate(dt.getDate() + off);
        return getBaseShift(MEMBER, dt);
    };
    const rowOf = (/** @type {number} */ off) =>
        Object.fromEntries(DATES.map(d => [d, base(d, off)]));

    test('an aligned week (matches base) → null', () => {
        assert.equal(detectShiftedRow(MEMBER, rowOf(0), DATES), null);
    });

    test('a row whose values belong one day LATER (left drift) → "left"', () => {
        assert.equal(detectShiftedRow(MEMBER, rowOf(1), DATES), 'left');
    });

    test('a row whose values belong one day EARLIER (right drift) → "right"', () => {
        assert.equal(detectShiftedRow(MEMBER, rowOf(-1), DATES), 'right');
    });

    test('a genuine override-heavy week (sparse changes from base) → null, no false alarm', () => {
        const row = rowOf(0);
        row[DATES[1]] = 'AL';
        row[DATES[4]] = 'RDW|09:00-17:00';
        assert.equal(detectShiftedRow(MEMBER, row, DATES), null);
    });

    test('UNKNOWN cells carry no signal but the drift is still detected from the rest', () => {
        const row = rowOf(1);
        row[DATES[2]] = 'UNKNOWN|smudge';
        row[DATES[6]] = 'UNKNOWN|smudge';
        assert.equal(detectShiftedRow(MEMBER, row, DATES), 'left');
    });

    test('guards: missing member / short dates / empty shifts → null', () => {
        assert.equal(detectShiftedRow(null, rowOf(1), DATES), null);
        assert.equal(detectShiftedRow(MEMBER, rowOf(1), DATES.slice(0, 5)), null);
        assert.equal(detectShiftedRow(MEMBER, {}, DATES), null);
    });
});

// ── shiftDisplay / manualShiftDisplay — the review table's pure formatters (v18.85) ─────────────
// Both were module-private and reachable only through the DOM-heavy review table, so their
// branches (unreadable sentinel, RDW re-encoding, Other-family detail, Sunday promotion) went
// unpinned. They are pure, so they are worth asserting directly.

describe('shiftDisplay', () => {
    test('an UNREADABLE cell shows the raw text, escaped, and no badge', () => {
        const html = shiftDisplay('UNKNOWN|<b>7A</b>');
        assert.match(html, /review-shift-unreadable/);
        assert.match(html, /couldn't read/);
        assert.ok(!html.includes('<b>'), 'raw PDF text must be escaped, never injected as markup');
        assert.match(html, /&lt;b&gt;7A&lt;\/b&gt;/);
    });

    test('an RDW-encoded value shows the RDW badge plus the plain time', () => {
        const html = shiftDisplay('RDW|08:00-16:00');
        assert.match(html, /08:00-16:00/);
        assert.ok(!html.includes('RDW|'), 'the pipe encoding must never reach the rendered output');
    });

    test('a worked SUNDAY is displayed as RDW — Sundays are uncontracted, so any work is overtime', () => {
        const sun = shiftDisplay('08:00-16:00', SUN);
        const mon = shiftDisplay('08:00-16:00', MON);
        assert.notEqual(sun, mon, 'the Sunday badge must differ from the weekday one');
        assert.match(sun, /08:00-16:00/, 'the time is still shown');
    });

    test('an Other-family value shows its RDW marker and times, not the badge alone', () => {
        // TRG vs TRG RDW decides between "nothing to pay" and the 8h RDW default, so the review
        // must surface the difference.
        assert.match(shiftDisplay('TRG RDW'), /RDW/);
        assert.match(shiftDisplay('IND 09:00-17:00'), /09:00-17:00/);
        const bare = shiftDisplay('TRG');
        assert.ok(!/review-shift-time/.test(bare), 'a bare flavour has no time detail to show');
    });

    test('a non-time value (RD/AL) renders the badge alone', () => {
        assert.ok(!/review-shift-time/.test(shiftDisplay('RD')));
        assert.ok(!/review-shift-time/.test(shiftDisplay('AL')));
    });
});

describe('manualShiftDisplay', () => {
    test('a saved RDW override is re-encoded so it shows the RDW badge, not an ordinary shift', () => {
        // RDW-ness lives in `type`, not the value — without the re-encode the admin could not tell
        // a saved RDW from a normal shift when resolving a CONFLICT (v16.19).
        const asRdw    = manualShiftDisplay({ manualValue: '08:00-16:00', manualType: 'rdw' });
        const asNormal = manualShiftDisplay({ manualValue: '08:00-16:00', manualType: 'shift' });
        assert.notEqual(asRdw, asNormal, 'an RDW override must not render identically to a plain shift');
        assert.equal(asRdw, shiftDisplay('RDW|08:00-16:00'));
    });

    test('a non-rdw type passes the value straight through', () => {
        assert.equal(manualShiftDisplay({ manualValue: 'AL', manualType: 'annual_leave' }), shiftDisplay('AL'));
    });

    test('an rdw type with a non-time value is not re-encoded', () => {
        assert.equal(manualShiftDisplay({ manualValue: 'RD', manualType: 'rdw' }), shiftDisplay('RD'));
    });
});

// ── ZERO-LENGTH RANGES CANNOT REACH FIRESTORE (v20.39, audit §24) ──────────────────────────────
//
// The server refuses equal start/end in `normaliseShift`. This is the second lock on the same door,
// and it is not redundant: the review table's CONFLICT picker lets an admin choose between two
// candidate readings, and a hand-edited cell takes this path without passing the server normaliser
// again. Skipping is the safe failure — the day keeps what it had rather than gaining a shift that
// every duration helper would read as 24 hours.
describe('isZeroLengthRange', () => {
    test('catches equal times, in both the bare and RDW-encoded forms', () => {
        for (const v of ['08:00-08:00', '00:00-00:00', '23:59-23:59', 'RDW|08:00-08:00']) {
            assert.equal(isZeroLengthRange(v), true, `${v} should be refused`);
        }
    });

    test('leaves genuine overnight and ordinary ranges alone', () => {
        // Equality, not "end < start" — an overnight shift is ordinary on this roster and a guard
        // that caught it would silently drop real night work.
        for (const v of ['22:00-06:00', '00:00-08:00', '08:00-16:00', 'RDW|22:00-06:00', '08:00-08:01']) {
            assert.equal(isZeroLengthRange(v), false, `${v} is legitimate and must be written`);
        }
    });

    test('ignores non-time values rather than guessing at them', () => {
        // AL / SICK / SPARE / the Other family all pass through this path; a loose regex here would
        // start dropping them.
        for (const v of ['AL', 'SICK', 'SPARE', 'RD', 'TRG RDW', 'UNKNOWN|08:00', '']) {
            assert.equal(isZeroLengthRange(v), false, `${v} must not be treated as a zero-length range`);
        }
    });
});


// ── FAILING CLOSED ON A SHIFTED READ (v22.16, external review) ────────────────────────────────
//
// ORGANISED BY WHAT EACH WRONG ANSWER COSTS, and the two directions are not remotely symmetric.
//
//   ACCEPTING A SHIFTED READ writes an entire week onto the wrong days for real staff — silently,
//     because a shifted row still looks like a perfectly ordinary roster. It is then acted on:
//     people come in on the wrong day and pay is calculated from it. That is the shipped defect,
//     and it survived because the last line of defence was a WARNING above a fully-ticked list.
//
//   REFUSING A GOOD READ costs the admin a re-upload. Annoying, visible, and instantly correctable.
//
// So these tests lean hard on the first and keep only enough of the second to stop the gate
// becoming one nobody can get past.
//
// Driven through `computeCellStates` — the ENTRY POINT — not through `detectShiftedRow`, which is
// already tested above and was already correct. The defect was never the detector; it was what the
// pipeline DID with what the detector said. A perfect helper whose answer is discarded is exactly
// the failure shape this repo names in CLAUDE.md.

// ── THE SAFETY RULE THAT DISARMED THE SAFETY NET (v22.19) ───────────────────────────────────────
//
// v22.16 flagged every plain-time Sunday on the SERVER as UNREADABLE, reasoning that a genuinely
// worked Sunday carries an RDW marker. Three real rosters disproved the premise (21 worked Sundays,
// none marked). But the sharper problem is what it did to THIS detector.
//
// `detectShiftedRow` scores only cells that are not UNKNOWN. On a left-shifted row the Sunday cell
// holds MONDAY's real value — which matches the base roster at offset +1, so it is a positive
// contributor to exactly the score that identifies the drift. Flagging it deleted that.
//
// MEASURED over the whole 44-member roster, every row left-shifted: 14 members are detected without
// the flag and 12 with it. Two detections lost. With a batch threshold of three, losing two can
// take a read from REFUSED to accepted — which is the hazard, and it is why the fix was to remove
// the preprocessing rather than to loosen the detector.
describe('a flagged Sunday is drift evidence deleted', () => {
    const DATES = ['2026-08-02', '2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08'];
    /** `m`'s own base pattern read one day out — the shape a collapsed blank Sunday produces. */
    const leftShifted = (/** @type {any} */ m) => Object.fromEntries(DATES.map(d => {
        const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + 1);
        return [d, getBaseShift(m, x)];
    }));

    test('the Sunday cell is what makes a left drift detectable at all, for some members', () => {
        // Not "for every member" — most rows have margin. The point is that some do not, and those
        // are the ones a threshold of three is counting.
        const roster = teamMembers.filter(/** @param {any} m */ m => !m.hidden && !m.managerOnly);
        let withCell = 0, withoutCell = 0;
        for (const m of roster) {
            const row = leftShifted(m);
            if (detectShiftedRow(m, row, DATES)) withCell++;
            const blinded = { ...row, [DATES[0]]: 'UNKNOWN|flagged' };
            if (detectShiftedRow(m, blinded, DATES)) withoutCell++;
        }
        assert.ok(withCell > 0, 'the fixture must actually produce detectable drift');
        assert.ok(withoutCell < withCell,
            `blinding the Sunday must LOSE detections — it lost ${withCell - withoutCell} of ${withCell}. `
            + 'If this ever reads zero, either the detector stopped scoring Sunday or the roster '
            + 'changed shape; both are worth knowing before anyone re-adds a Sunday preprocessing rule.');
    });

    test('an UNKNOWN cell contributes nothing to the score — the mechanism, stated once', () => {
        // WHICH member loses its detection depends on the week, so the fixture FINDS one rather
        // than naming one. A hardcoded name here passed on the week it was written against and
        // would have gone quietly wrong on the next — the same class of staleness the roster
        // fixtures elsewhere in this file are built from the real detector to avoid.
        const roster = teamMembers.filter(/** @param {any} m */ m => !m.hidden && !m.managerOnly);
        const victim = roster.find(/** @param {any} m */ (m) => {
            const row = leftShifted(m);
            return detectShiftedRow(m, row, DATES)
                && !detectShiftedRow(m, { ...row, [DATES[0]]: 'UNKNOWN|flagged' }, DATES);
        });
        assert.ok(victim, 'at least one member must lose its detection when the Sunday is blinded');
        const row = leftShifted(victim);
        assert.equal(detectShiftedRow(victim, row, DATES), 'left', 'detectable with all seven cells');
        assert.equal(detectShiftedRow(victim, { ...row, [DATES[0]]: 'UNKNOWN|flagged' }, DATES), null,
            `and silent with the Sunday blinded (${victim.name})`);
    });
});

// ── The PDF's own grid, folded into the same verdict (v22.31) ──────────────────────────────────
//
// The server (functions/roster-geometry.js) refuses a row whose AI-read day lands in a physically
// EMPTY cell and returns those names as `geometryRefused`. These pin that the client treats such a
// row exactly as it treats a base-roster drift — unticked, explained, counted by the breaker —
// through ONE wiring, and that the words never borrow a direction geometry does not have.
describe('a row the PDF\'s own grid refused fails closed the same way', () => {
    const MEMBER = teamMembers.find(/** @param {any} m */ m => m.name === 'G. Miller');
    const DATES  = ['2026-08-02', '2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08'];
    /** An HONEST week — the base pattern read on the right days — so the base-roster detector is silent. */
    const honest = (/** @type {any} */ m) => Object.fromEntries(DATES.map(d => [d, getBaseShift(m, new Date(d + 'T12:00:00'))]));
    const others = teamMembers.filter(/** @param {any} m */ m => !m.hidden && !m.managerOnly && m.rosterType === 'main' && m.name !== 'G. Miller');
    const states = (/** @type {any} */ parsedResult) => computeCellStates(parsedResult, []);
    const writable = (/** @type {Map<string,any>} */ st) =>
        [...st.values()].filter(c => (c.state === 'DIFF' || c.state === 'REMOVE_INPUT' || c.state === 'REMOVE_IMPORT') && c.chosen !== false);

    test('a geometry-refused member\'s rows start UNTICKED even though the base roster sees no drift', () => {
        const parsed = [{ memberName: 'G. Miller', shifts: { ...honest(MEMBER), [DATES[1]]: '22:00-06:00' } }];
        assert.equal(assessRosterAlignment({ parsed, dates: DATES }).byMember.get('G. Miller'), undefined, 'fixture: the detector must be silent');
        const st = states({ parsed, dates: DATES, geometryRefused: ['G. Miller'] });
        assert.equal(writable(st).length, 0, 'nothing selected');
        assert.ok([...st.values()].filter(c => c.state === 'DIFF').every(c => c.drift === 'geometry'), 'and every cell says which witness');
    });

    test('without the field, the same read is saved as before — the fold-in is inert when the server says nothing', () => {
        const parsed = [{ memberName: 'G. Miller', shifts: { ...honest(MEMBER), [DATES[1]]: '22:00-06:00' } }];
        const st = states({ parsed, dates: DATES });
        assert.ok(writable(st).length > 0);
    });

    test('a base-roster verdict keeps its DIRECTION when geometry also refuses the row', () => {
        const rowFor = (/** @type {any} */ m, off) => Object.fromEntries(DATES.map(d => {
            const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + off); return [d, getBaseShift(m, x)]; }));
        const drifter = teamMembers.find(/** @param {any} m */ m => !m.hidden && !m.managerOnly && m.rosterType === 'main'
            && detectShiftedRow(m, rowFor(m, 1), DATES) === 'left');
        const a = assessRosterAlignment({ parsed: [{ memberName: drifter.name, shifts: rowFor(drifter, 1) }], dates: DATES, geometryRefused: [drifter.name] });
        assert.equal(a.byMember.get(drifter.name), 'left', 'the more specific verdict wins');
        assert.deepEqual(a.geometryRefused, [drifter.name], 'but the refusal is still recorded');
    });

    test('geometry refusals count toward the breaker, and three of them REFUSE the whole read', () => {
        const names = [MEMBER, ...others.slice(0, ALIGNMENT_BLOCK_THRESHOLD - 1)];
        const parsed = names.map(m => ({ memberName: m.name, shifts: honest(m) }));
        const a = assessRosterAlignment({ parsed, dates: DATES, geometryRefused: names.map(m => m.name) });
        assert.equal(a.blocked, true);
        assert.equal(a.direction, null, 'no directional evidence → no direction claimed');
        assert.deepEqual([...a.suspects].sort(), names.map(m => m.name).sort());
        const st = states({ parsed, dates: DATES, geometryRefused: names.map(m => m.name) });
        assert.ok([...st.values()].every(c => c.rosterBlocked));
    });

    test('two refusals plus one drift the breaker can see is also three', () => {
        const rowFor = (/** @type {any} */ m, off) => Object.fromEntries(DATES.map(d => {
            const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + off); return [d, getBaseShift(m, x)]; }));
        const drifter = others.find(/** @param {any} m */ m => detectShiftedRow(m, rowFor(m, 1), DATES) === 'left');
        const [g1, g2] = others.filter(m => m !== drifter);
        const a = assessRosterAlignment({
            parsed: [{ memberName: drifter.name, shifts: rowFor(drifter, 1) }, { memberName: g1.name, shifts: honest(g1) }, { memberName: g2.name, shifts: honest(g2) }],
            dates: DATES, geometryRefused: [g1.name, g2.name],
        });
        assert.equal(a.blocked, true);
        assert.equal(a.direction, 'left', 'the one directional verdict names the direction');
    });

    test('a name the server refused that is not on this roster is ignored, not counted', () => {
        const a = assessRosterAlignment({ parsed: [{ memberName: 'G. Miller', shifts: honest(MEMBER) }], dates: DATES, geometryRefused: ['Nobody Here', 'G. Miller'] });
        assert.deepEqual(a.suspects, ['G. Miller']);
    });

    // ── did the witness run at all? ──
    // Organised by what each wrong answer COSTS, and the two directions are not symmetrical.
    // SAYING NOTHING when the check did not run is the shipped defect: it is silent, it is
    // indistinguishable from the check having agreed with every cell, and the admin then saves a
    // week believing two independent readings matched. SAYING SOMETHING when it ran on everybody
    // is noise on the surface whose whole discipline is that no warning means no exception.
    describe('geometryCopy — the fail-open check must be visible when it fails open', () => {
        test('a complete run says nothing at all', () => {
            assert.equal(geometryCopy({ status: 'complete', checked: 15, total: 15 }), '');
        });

        test('an unavailable run says the check did not happen', () => {
            const c = geometryCopy({ status: 'unavailable', checked: 0, total: 15 });
            assert.match(c, /couldn\u2019t run/);
            assert.match(c, /one method only/, 'it must say WHY that matters, not merely that it happened');
            assert.match(c, /before saving/);
        });

        test('a MISSING geometry field reads as did-not-run, never as passed', () => {
            // The direction that matters. An older server, a response shape change, a field lost
            // in a refactor — every one of those must land on "we could not check", because the
            // alternative is a review that silently claims a witness it never had.
            for (const g of [undefined, null, {}, { status: undefined }, { status: 'weird' }]) {
                assert.match(geometryCopy(/** @type {any} */ (g)), /couldn\u2019t run/,
                    `${JSON.stringify(g)} must not read as a clean run`);
            }
        });

        test('a partial run states the arithmetic, which no row can state for itself', () => {
            const c = geometryCopy({ status: 'partial', checked: 12, total: 15 });
            assert.match(c, /12 of 15/);
            assert.match(c, /not checked/);
            // Never a bare "3 rows" — the admin has to know which side the number is on.
            assert.doesNotMatch(c, /couldn\u2019t run/);
        });

        test('a partial run with unusable counts still warns rather than printing NaN', () => {
            const c = geometryCopy(/** @type {any} */ ({ status: 'partial' }));
            assert.doesNotMatch(c, /NaN|undefined/);
            assert.match(c, /0 of 0/);
        });
    });

    // ── the words ──
    test('the per-row warning for a geometry refusal never claims "shifted a day later"', () => {
        const g = driftCopy('geometry', 'G. Miller');
        assert.match(g, /empty cell/);
        assert.doesNotMatch(g, /shifted a day (earlier|later)/);
        assert.match(driftCopy('left', 'G. Miller'), /shifted a day earlier/);
        assert.match(driftCopy('right', 'G. Miller'), /shifted a day later/);
        for (const d of /** @type {const} */ (['left', 'right', 'geometry'])) {
            assert.match(driftCopy(d, 'X'), /nothing here is selected/, d);
            assert.match(driftCopy(d, 'X'), /read the roster again/, d);
        }
    });

    test('the stop banner with NO direction speaks of the PDF\'s own table, not of a shift', () => {
        const none = stopCopy({ direction: null, suspects: ['A', 'B', 'C'], geometryRefused: ['A', 'B', 'C'] }, 'A, B, C');
        assert.match(none, /empty cell/);
        assert.doesNotMatch(none, /shifted a day/);
        assert.match(none, /has not been saved/);
        const left = stopCopy({ direction: 'left', suspects: ['A', 'B', 'C'], geometryRefused: ['C'] }, 'A, B, C');
        assert.match(left, /shifted a day earlier/);
        assert.match(left, /On 1 of those rows the PDF/);
        assert.match(left, /blank Sunday/);
        assert.doesNotMatch(stopCopy({ direction: 'right', suspects: ['A'], geometryRefused: [] }, 'A'), /blank Sunday|of those rows/);
    });
});

describe('a shifted read fails closed', () => {
    const MEMBER = teamMembers.find(/** @param {any} m */ m => m.name === 'G. Miller');
    const DATES  = ['2026-08-02', '2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08'];
    const baseAt = (/** @type {string} */ d, off = 0) => {
        const dt = new Date(d + 'T12:00:00'); dt.setDate(dt.getDate() + off);
        return getBaseShift(MEMBER, dt);
    };
    /** A week for `name` whose values are their own base pattern read `off` days out. */
    const rowFor = (/** @type {any} */ m, off) => {
        const dts = DATES.map(d => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + off); return x; });
        return Object.fromEntries(DATES.map((d, i) => [d, getBaseShift(m, dts[i])]));
    };
    /**
     * The members whose drift is DETECTABLE at all — 13 of the 20 main-roster lines.
     *
     * Not cherry-picking: `detectShiftedRow` is deliberately conservative, because a member whose
     * pattern looks similar on adjacent days scores the same at every offset and must stay silent
     * rather than false-alarm. Building the scenario out of members the detector can actually see
     * is what makes these tests about the GATE. A fixture that quietly included a silent member
     * would fail for a reason that has nothing to do with what is under test — which is exactly
     * what the first version of this block did.
     */
    const DRIFTABLE = teamMembers.filter(/** @param {any} m */ m =>
        !m.hidden && !m.managerOnly && m.rosterType === 'main'
        && detectShiftedRow(m, rowFor(m, 1), DATES) === 'left');

    /** The same, for the OTHER direction. Detectability is per-direction and per-member — a member
     *  the detector sees drifting left is not automatically one it sees drifting right, which the
     *  first version of the opposite-directions case below assumed and got wrong. */
    const RIGHT_DRIFTABLE = teamMembers.filter(/** @param {any} m */ m =>
        !m.hidden && !m.managerOnly && m.rosterType === 'main'
        && detectShiftedRow(m, rowFor(m, -1), DATES) === 'right');

    const states = (/** @type {any[]} */ parsed) => computeCellStates({ parsed, dates: DATES }, []);
    /** Only the cells that would actually be written. */
    const writable = (/** @type {Map<string,any>} */ st) =>
        [...st.values()].filter(c => (c.state === 'DIFF' || c.state === 'REMOVE_IMPORT') && c.chosen !== false);

    // ── ACCEPTING A SHIFTED READ ───────────────────────────────────────────────────────────────

    test('a drifted member\'s rows are NOT selected for saving', () => {
        const st = states([{ memberName: 'G. Miller', shifts: rowFor(MEMBER, 1) }]);
        assert.equal(writable(st).length, 0, 'a week that looks a day out must not default to save');
        assert.ok([...st.values()].every(c => c.drift === 'left'), 'and every cell must say why');
    });

    test('three members drifting the same way REFUSE the whole read', () => {
        const three = DRIFTABLE.slice(0, ALIGNMENT_BLOCK_THRESHOLD);
        assert.equal(three.length, ALIGNMENT_BLOCK_THRESHOLD, 'fixture must match the threshold it is testing');
        const st = states(three.map(m => ({ memberName: m.name, shifts: rowFor(m, 1) })));
        assert.ok([...st.values()].every(c => c.rosterBlocked), 'every cell of a refused read is marked');
        assert.equal(writable(st).length, 0);
    });

    test('a refused read blocks EVERY member, including one that reads perfectly', () => {
        // THE CASE THE REVIEWER INSISTED ON, and the one a per-row gate would miss. A systematic
        // misread makes the whole read untrustworthy — and a shifted row is at its most invisible
        // exactly where it happens to agree with the base pattern.
        const three = DRIFTABLE.slice(0, ALIGNMENT_BLOCK_THRESHOLD);
        const clean = DRIFTABLE[ALIGNMENT_BLOCK_THRESHOLD];
        const parsed = three.map(m => ({ memberName: m.name, shifts: rowFor(m, 1) }));
        parsed.push({ memberName: clean.name, shifts: rowFor(clean, 0) });
        const st = states(parsed);
        const cleanCells = [...st.entries()].filter(([k]) => k.startsWith(`${clean.name}|`)).map(([, v]) => v);
        assert.ok(cleanCells.length > 0);
        assert.ok(cleanCells.every(c => c.rosterBlocked), 'the clean member is blocked too');
        assert.equal(writable(st).length, 0);
    });

    test('drift in OPPOSITE directions is noise, not a systematic misread', () => {
        // A parser that drops a leading blank moves every row the SAME way. Counting bare drift
        // totals rather than per-direction would refuse reads over unrelated coincidences.
        const rightward = RIGHT_DRIFTABLE.find(/** @param {any} m */ m =>
            m.name !== DRIFTABLE[0].name && m.name !== DRIFTABLE[1].name);
        assert.ok(rightward, 'fixture needs a member the detector can see drifting RIGHT');
        const parsed = [
            { memberName: DRIFTABLE[0].name, shifts: rowFor(DRIFTABLE[0], 1) },
            { memberName: DRIFTABLE[1].name, shifts: rowFor(DRIFTABLE[1], 1) },
            { memberName: rightward.name,    shifts: rowFor(rightward, -1) },
        ];
        const a = assessRosterAlignment({ parsed, dates: DATES });
        assert.equal(a.blocked, false, 'two left and one right is not three in one direction');
        assert.equal(a.byMember.size, 3, 'but all three are still individually suspect');
    });

    // ── REFUSING A GOOD READ ───────────────────────────────────────────────────────────────────

    test('an ordinary aligned week is untouched — ticked, unblocked, no drift', () => {
        const parsed = DRIFTABLE.slice(0, 4).map(m => ({ memberName: m.name, shifts: rowFor(m, 0) }));
        const st = states(parsed);
        assert.ok([...st.values()].every(c => !c.rosterBlocked && c.drift === null));
        assert.equal(assessRosterAlignment({ parsed, dates: DATES }).blocked, false);
    });

    test('ONE drifted member does not refuse the read for everybody else', () => {
        // One person can genuinely have an unusual week. The gate is per-row until the batch
        // signature appears; conflating the two would make a single odd rota unimportable.
        const other = DRIFTABLE[1];
        const st = states([
            { memberName: DRIFTABLE[0].name, shifts: rowFor(DRIFTABLE[0], 1) },
            { memberName: other.name,        shifts: rowFor(other, 0) },
        ]);
        assert.ok([...st.values()].every(c => !c.rosterBlocked), 'one suspect row is not a refused read');
        const otherCells = [...st.entries()].filter(([k]) => k.startsWith(`${other.name}|`)).map(([, v]) => v);
        assert.ok(otherCells.every(c => c.drift === null));
    });

    test('an unknown name contributes nothing to the verdict', () => {
        const a = assessRosterAlignment({ parsed: [{ memberName: 'Nobody At All', shifts: {} }], dates: DATES });
        assert.equal(a.byMember.size, 0);
        assert.equal(a.blocked, false);
    });

    test('the SAVE LOOP itself refuses a blocked cell — a STATIC contract, and here is why', () => {
        // This one case is not behavioural, and the reason is worth stating rather than leaving to
        // look like laziness. There are TWO guards on a refused read and they protect different
        // futures: the tick handler ignores a click (`s.rosterBlocked` → return), and the save loop
        // skips the cell (`state.rosterBlocked` → continue). The e2e proves the first — clicking
        // every tick leaves them all off. It CANNOT reach the second, because with the first in
        // place `chosen` can never become true, so deleting the save-loop guard leaves the whole
        // browser suite green. That was found by mutation, not by reading.
        //
        // The save-loop guard is the one that survives a future renderer, a bulk "select all", or
        // a Skip-all/Restore path setting `chosen` without going through the tick handler — i.e.
        // exactly the kind of change that gets made when the breaker is no longer fresh in mind.
        // It is defence in depth, it is unreachable from the UI today, and a static assertion is
        // the only form of protection available to it. Anchored on the two identifiers together so
        // a rename cannot quietly satisfy it.
        const src = readFileSync('./admin-roster-upload.js', 'utf8');
        const loop = src.slice(src.indexOf('for (const [key, state] of _cellStates)'));
        assert.ok(/if \(state\.rosterBlocked\) continue;/.test(loop.slice(0, 1200)),
            'the save loop must skip a cell from a refused read, before any state check');
        // …and it must come BEFORE the first thing that can queue a write.
        assert.ok(loop.indexOf('state.rosterBlocked') < loop.indexOf('toWrite.push'),
            'the guard is worthless below the first push');
    });

    test('an empty or malformed result is not a refusal', () => {
        // The breaker must fail OPEN on absence of evidence — refusing a read nobody has parsed
        // yet would be a gate that fires on nothing.
        for (const bad of [{}, { parsed: [], dates: [] }, { parsed: null, dates: null }]) {
            const a = assessRosterAlignment(/** @type {any} */ (bad));
            assert.equal(a.blocked, false);
            assert.equal(a.suspects.length, 0);
        }
    });
});
