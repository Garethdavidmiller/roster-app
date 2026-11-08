/**
 * admin-bulk-apply.test.mjs — what the week card's bulk Apply waits for, and the words that say so.
 * Run: node --test admin-bulk-apply.test.mjs   (part of `npm run test:hygiene`)
 *
 * No mocks: the rule reads the real `SUNDAY_FORBIDDEN_TYPES` (through `isForbiddenOnSunday`) and the
 * real `isSunday`, so a change to either is a change to what this greys out. The browser half — the
 * button really disabled, the line really under it — is e2e/admin.spec.js.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bulkApplyWaitingFor } from './admin-bulk-apply.js';
import { SUNDAY_FORBIDDEN_TYPES } from './override-utils.js';
import { PILL_TYPES } from './admin-shift-types.js';

const SUN = '2026-07-12', MON = '2026-07-13', TUE = '2026-07-14';

describe('bulkApplyWaitingFor — Apply is greyed out until it can do something', () => {
    test('nothing ticked and no type: both are asked for, in one line', () => {
        assert.equal(bulkApplyWaitingFor([], ''), 'Tick at least one day and choose a type');
    });

    test('a type but nothing ticked: the days are asked for', () => {
        assert.equal(bulkApplyWaitingFor([], 'annual_leave'), 'Tick the days to apply it to');
    });

    test('days ticked but no type: the type is asked for, one day or several', () => {
        assert.equal(bulkApplyWaitingFor([MON], ''), 'Choose a type for the ticked day');
        assert.equal(bulkApplyWaitingFor([MON, TUE], ''), 'Choose a type for the ticked days');
    });

    test('a working day and a type: Apply can act', () => {
        assert.equal(bulkApplyWaitingFor([MON, TUE], 'annual_leave'), '');
    });

    test('ONLY a Sunday ticked, with a type a Sunday refuses: greyed out, and the line says why', () => {
        for (const type of SUNDAY_FORBIDDEN_TYPES) {
            assert.equal(bulkApplyWaitingFor([SUN], type), 'Sunday isn’t a contracted day — tick a working day', type);
        }
    });

    test('ONLY a Sunday ticked, with a type a Sunday takes (a worked Sunday is RDW): Apply can act', () => {
        // Every pill the bulk bar can offer that the Sunday list does not name — read from the two
        // declarations, so a type moved into or out of SUNDAY_FORBIDDEN_TYPES moves here with it.
        const allowed = PILL_TYPES.filter(t => !SUNDAY_FORBIDDEN_TYPES.includes(t));
        assert.ok(allowed.includes('rdw'), 'premise: RDW is a Sunday type');
        for (const type of allowed) assert.equal(bulkApplyWaitingFor([SUN], type), '', type);
    });

    test('a Sunday AMONG working days is not a reason: the apply skips it and says so (layer 2)', () => {
        assert.equal(bulkApplyWaitingFor([SUN, MON], 'annual_leave'), '');
    });
});
