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

import { test, describe, mock } from 'node:test';
import assert from 'node:assert/strict';

// mock.module must be called before the module under test is imported.
mock.module('./firebase-client.js', {
    namedExports: {
        db: null,
        collection: () => null,
        query: () => null,
        where: () => null,
        getDocs: async () => ({ forEach: () => {} }),
        doc: () => ({}),
        writeBatch: () => ({}),
        serverTimestamp: () => null,
        COLLECTIONS: { overrides: 'overrides' },
    },
});

const { shiftValueToOverrideType } = await import('./admin-roster-upload.js');

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
