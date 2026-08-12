/**
 * overtime-parity.test.mjs — the client and the server must agree about a submission's history.
 * Run: node --test overtime-parity.test.mjs   (part of `npm run test:hygiene`)
 *
 * `deriveHistory` exists TWICE: in `functions/overtime-core.js` (CommonJS, for the endpoints) and in
 * `overtime-format.js` (ESM, for the Manager view). Cloud Functions cannot import a browser module,
 * which is the same boundary `normaliseSurname` and the payday cutoffs already sit on — and those
 * both have a parity test for the same reason this one exists.
 *
 * ── WHY DRIFT HERE IS SILENT ────────────────────────────────────────────────────────────────────
 *
 * The consequences are all ABSENCES. If the client's copy diverges, the Manager view stops showing
 * "Changed since initial deadline" — and a flag that is absent is indistinguishable from a change
 * that never happened. Nothing errors, nothing looks wrong, and the clerk plans a roster against a
 * version of somebody's availability that was superseded.
 *
 * So this compares BEHAVIOUR over a table of cases rather than source text. A source-equivalence
 * check would fail on a comment and pass on a rewritten comparison.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { deriveHistory as clientDerive, isWithdrawn as clientWithdrawn } from './overtime-format.js';

const require = createRequire(import.meta.url);
const { deriveHistory: serverDerive, isWithdrawn: serverWithdrawn } = require('./functions/overtime-core.js');

const A = { '2026-08-30': { mode: 'all_day' }, '2026-08-31': { mode: 'unavailable' } };
const B = { '2026-08-30': { mode: 'unavailable' }, '2026-08-31': { mode: 'unavailable' } };
const DEADLINE = 1000;
const rev = (n, days, at) => ({ revision: n, days, acceptedAt: at });

/** Every case is a state a real submission can be in, not a permutation for its own sake. */
const CASES = [
    ['nothing submitted',                     [], null],
    ['one revision, before the deadline',     [rev(1, A, 100)], A],
    ['one revision, after the deadline',      [rev(1, A, 5000)], A],
    ['exactly ON the deadline',               [rev(1, A, DEADLINE)], A],
    ['one millisecond before it',             [rev(1, A, DEADLINE - 1)], A],
    ['changed after the deadline',            [rev(1, A, 100), rev(2, B, 5000)], B],
    ['changed and changed back',              [rev(1, A, 100), rev(2, B, 5000), rev(3, A, 6000)], A],
    ['several before the deadline',           [rev(1, A, 100), rev(2, B, 500)], B],
    ['revisions out of order',                [rev(3, A, 6000), rev(1, A, 100), rev(2, B, 500)], A],
    ['a head with no revisions at all',       [], A],
    ['reordered day keys, same content',      [rev(1, A, 100)], { '2026-08-31': { mode: 'unavailable' }, '2026-08-30': { mode: 'all_day' } }],
];

describe('client and server derive the same history', () => {
    for (const [name, revisions, headDays] of CASES) {
        test(name, () => {
            const c = clientDerive(revisions, headDays, DEADLINE);
            const s = serverDerive(revisions, headDays, DEADLINE);
            assert.equal(c.lateInitial, s.lateInitial, 'lateInitial');
            assert.equal(c.changedSinceInitial, s.changedSinceInitial, 'changedSinceInitial');
            assert.equal(c.initialRevision?.revision ?? null, s.initialRevision?.revision ?? null, 'initialRevision');
        });
    }

    test('the table exercises BOTH values of both flags — guard the guard', () => {
        // Two implementations that always return false would agree on every case above.
        const results = CASES.map(([, r, h]) => clientDerive(r, h, DEADLINE));
        assert.ok(results.some(r => r.lateInitial),  'no case produces lateInitial: true');
        assert.ok(results.some(r => !r.lateInitial), 'no case produces lateInitial: false');
        assert.ok(results.some(r => r.changedSinceInitial),  'no case produces changedSinceInitial: true');
        assert.ok(results.some(r => !r.changedSinceInitial), 'no case produces changedSinceInitial: false');
        assert.ok(results.some(r => r.initialRevision), 'no case finds an initial revision');
    });

    test('a reordered week is not read as a change, on either side', () => {
        // Firestore does not guarantee key order, so an object-identity or naive-stringify
        // comparison would flag every read as an amendment and fill the Manager view with noise.
        const reordered = { '2026-08-31': { mode: 'unavailable' }, '2026-08-30': { mode: 'all_day' } };
        assert.equal(clientDerive([rev(1, A, 100)], reordered, DEADLINE).changedSinceInitial, false);
        assert.equal(serverDerive([rev(1, A, 100)], reordered, DEADLINE).changedSinceInitial, false);
    });
});

describe('client and server agree who is still being asked', () => {
    // `isWithdrawn` is the second rule on this boundary, and it fails in both directions:
    //
    //   client looser than server → a person the endpoints still count as expected disappears from
    //     the reviewer's lists, so nobody chases somebody the counts say is outstanding; and
    //   client stricter → a withdrawn leaver stays in every list while the count beneath them says
    //     one fewer, which is the page disagreeing with itself in the one number a clerk acts on.
    //
    // Neither raises anything. Both are one field test, which is exactly the kind of rule that gets
    // "tidied" into a truthiness check on the side that is being edited that day.
    const SHAPES = [
        ['withdrawn',                   { withdrawn: true }],
        ['a legacy record, no field',   { memberName: 'A. One' }],
        ['an explicit false',           { withdrawn: false }],
        ['a truthy non-boolean',        { withdrawn: 'true' }],
        ['a timestamp in the flag',     { withdrawn: 1_755_000_000_000 }],
        ['an empty string',             { withdrawn: '' }],
        ['restored — fields removed',   { memberName: 'A. One', grade: 'CEA' }],
        ['null',                        null],
        ['undefined',                   undefined],
    ];

    for (const [label, participant] of SHAPES) {
        test(label, () => {
            assert.equal(clientWithdrawn(participant), serverWithdrawn(participant),
                'the two copies disagree about whether this person is still being asked');
        });
    }

    test('and they agree that a truthy non-boolean is NOT withdrawal', () => {
        // Pinned as an outcome rather than only as parity: two copies that drift the same way agree
        // perfectly and are both wrong, and this is the direction that removes a real person from a
        // list somebody rings round from.
        assert.equal(clientWithdrawn({ withdrawn: 'true' }), false);
        assert.equal(serverWithdrawn({ withdrawn: 'true' }), false);
    });
});
