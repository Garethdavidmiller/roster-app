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
global.document = { getElementById: () => null };

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
        doc:             () => null,
        serverTimestamp: () => null,
        writeBatch:      () => ({ set: () => {}, delete: () => {}, commit: async () => {} }),
        auth:            { currentUser: null },
        COLLECTIONS:     { overrides: 'overrides', huddles: 'huddles', circulars: 'circulars', newsletters: 'newsletters', pushSubscriptions: 'pushSubscriptions', staffContact: 'staffContact', clientErrors: 'clientErrors', linkDesigns: 'linkDesigns' },
    },
});

const {
    getEffectiveShift,
    validateShiftRules,
    buildMemberDateMap,
    setAllOverrides,
} = await import('./admin-overrides.js');

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
