/**
 * admin-bulk-apply.test.mjs — what the week card's bulk Apply waits for, and the words that say so.
 * Run: node scripts/run-tests.mjs admin-bulk-apply.test.mjs   (part of `npm run test:hygiene`)
 *
 * No mocks: the rule reads the real `SUNDAY_FORBIDDEN_TYPES` (through `isForbiddenOnSunday`) and the
 * real `isSunday`, so a change to either is a change to what this greys out. The browser half — the
 * button really disabled, the line really under it — is e2e/admin.spec.js.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bulkApplyWaitingFor, bulkSkippedLine } from './admin-bulk-apply.js';
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

describe('the days Apply leaves alone beyond Sunday — greyed out when they are all it has', () => {
    const REST = 'An absence isn’t recorded on a rest day — tick a working day';
    test('Absent with only rest days ticked, a Sunday among them or not (owner, 10 Nov 2026)', () => {
        assert.equal(bulkApplyWaitingFor([MON], 'sick', () => 'rest'), REST);
        assert.equal(bulkApplyWaitingFor([SUN, MON], 'sick', () => 'rest'), REST);
    });

    test('a working day among them: Apply can act', () => {
        assert.equal(bulkApplyWaitingFor([MON, TUE], 'sick', d => (d === MON ? 'rest' : '')), '');
    });

    test('only days before the start date, or a mix of reasons', () => {
        assert.equal(bulkApplyWaitingFor([MON, TUE], 'shift', () => 'start'), 'Nothing is recorded before the start date — tick a later day');
        assert.equal(bulkApplyWaitingFor([MON, TUE], 'sick', d => (d === MON ? 'rest' : 'start')),
            'None of the ticked days can take it — tick a working day');
    });
});

describe('bulkSkippedLine — the line Apply leaves names every day it left alone', () => {
    const fmt = (/** @type {string} */ d) => d;
    test('nothing left alone: nothing said', () => {
        assert.equal(bulkSkippedLine(5, [], fmt), '');
    });

    test('a Sunday alone keeps the words it always had', () => {
        assert.equal(bulkSkippedLine(6, [{ date: SUN, why: 'sunday' }], fmt), 'Set 6 days — Sunday skipped (not a contracted day).');
    });

    test('rest days are named, in the Absence card’s and the roster import’s words', () => {
        assert.equal(bulkSkippedLine(4, [{ date: SUN, why: 'sunday' }, { date: '2026-07-15', why: 'rest' }, { date: '2026-07-16', why: 'rest' }], fmt),
            'Set 4 days — Sunday skipped (not a contracted day); 2026-07-15 and 2026-07-16 skipped: rest days on the base roster, so nothing is recorded.');
        assert.equal(bulkSkippedLine(1, [{ date: MON, why: 'rest' }], fmt),
            'Set 1 day — 2026-07-13 skipped: a rest day on the base roster, so nothing is recorded.');
    });

    test('three days take commas and an "and"; a day before the start date says so', () => {
        assert.equal(bulkSkippedLine(2, ['2026-07-13', '2026-07-14', '2026-07-15'].map(date => ({ date, why: /** @type {'start'} */ ('start') })), fmt),
            'Set 2 days — 2026-07-13, 2026-07-14 and 2026-07-15 skipped: before the start date, so nothing is recorded.');
    });
});
