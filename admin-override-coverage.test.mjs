/**
 * Tests for admin-override-coverage.js — what the Admin override cache knows.
 *
 * ORGANISED BY THE TWO WAYS AN ANSWER IS WRONG, not by function. A per-function suite would pass on
 * exactly the code that produces the defect this module exists to prevent, because every individual
 * function is trivially correct in isolation; the bug is in which question gets asked.
 *
 *   · SAYING YES WHEN IT DOES NOT KNOW — a write proceeds against data that never arrived. Silent,
 *     and it corrupts the roster: a duplicate override, an erased worked Sunday, a missed rest gap.
 *   · SAYING NO WHEN IT DOES KNOW — the page refuses work it could do. Visible and annoying, and it
 *     is the direction a nervous fix drifts in, so it is pinned too.
 *
 * No mocks — the module imports nothing.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
    emptyCoverage, withMember, withAll, clearedCoverage,
    hasAuthorityFor, coversEveryone, replaceMemberSlice,
} from './admin-override-coverage.js';

describe('saying yes when it does not know', () => {
    test('a fresh cache has authority over nobody', () => {
        const cov = emptyCoverage();
        assert.equal(hasAuthorityFor(cov, 'G. Miller'), false);
        assert.equal(coversEveryone(cov), false);
    });

    test('loading ONE member grants nothing about another', () => {
        // The invariant the staged load lives or dies by. Before coverage this was a single boolean,
        // so loading anybody granted authority over everybody — and the cache would have been
        // genuinely loaded while knowing nothing at all about the member on screen.
        const cov = withMember(emptyCoverage(), 'G. Miller');
        assert.equal(hasAuthorityFor(cov, 'G. Miller'), true);
        assert.equal(hasAuthorityFor(cov, 'S. Silva'), false);
    });

    test('having loaded every member one at a time is still not "all staff"', () => {
        // Different claims. A member added to the roster since, or a document the roster importer
        // wrote under a name nobody has selected, belongs to the collection read and not to the sum
        // of the individual ones. Collapsing them makes the All-staff list quietly short.
        let cov = emptyCoverage();
        for (const m of ['G. Miller', 'S. Silva', 'M. Robson']) cov = withMember(cov, m);
        assert.equal(hasAuthorityFor(cov, 'M. Robson'), true);
        assert.equal(coversEveryone(cov), false, 'three members read is not the collection read');
    });

    test('a missing or empty member name is refused under partial coverage', () => {
        const cov = withMember(emptyCoverage(), 'G. Miller');
        assert.equal(hasAuthorityFor(cov, ''), false);
        assert.equal(hasAuthorityFor(cov, null), false);
        assert.equal(hasAuthorityFor(cov, undefined), false);
    });

    test('clearing forgets everything, including full coverage', () => {
        const cov = clearedCoverage();
        assert.equal(hasAuthorityFor(cov, 'G. Miller'), false);
        assert.equal(coversEveryone(cov), false);
    });
});

describe('saying no when it does know', () => {
    test('full coverage answers for anybody, including a name never individually read', () => {
        const cov = withAll(emptyCoverage());
        assert.equal(hasAuthorityFor(cov, 'Anybody At All'), true);
        assert.equal(coversEveryone(cov), true);
    });

    test('full coverage answers even a malformed question', () => {
        // Order matters and this pins it. Asking "is the member name present?" BEFORE "do we hold
        // everything?" makes `all` not mean all — and refuses a write on a page whose member field
        // simply had not been read yet, with the whole collection sitting in the cache.
        const cov = withAll(emptyCoverage());
        assert.equal(hasAuthorityFor(cov, ''), true);
        assert.equal(hasAuthorityFor(cov, undefined), true);
    });

    test('full coverage survives a later per-member read', () => {
        const cov = withMember(withAll(emptyCoverage()), 'G. Miller');
        assert.equal(coversEveryone(cov), true, 'refreshing one member must not demote the cache');
    });
});

describe('the records themselves', () => {
    test('recording a member does not mutate the record handed in', () => {
        // Coverage is authority. A function that widened its argument in place would let a caller
        // holding a reference gain authority it never asked for, which is the whole hazard inverted.
        const before = emptyCoverage();
        const after = withMember(before, 'G. Miller');
        assert.deepEqual(before.members, [], 'the original is untouched');
        assert.deepEqual(after.members, ['G. Miller']);
    });

    test('recording the same member twice changes nothing', () => {
        const once = withMember(emptyCoverage(), 'G. Miller');
        const twice = withMember(once, 'G. Miller');
        assert.deepEqual(twice.members, ['G. Miller']);
        assert.equal(twice, once, 'an unchanged record is returned as-is');
    });

    test('an empty member name is never recorded', () => {
        assert.deepEqual(withMember(emptyCoverage(), '').members, []);
    });
});

describe('replacing a member slice', () => {
    const OTHER = { id: 'x1', memberName: 'S. Silva', date: '2026-06-01' };

    test('a fresh read REPLACES that member, it does not merge', () => {
        // The read is authoritative for the member, so a document it does not contain has been
        // deleted. Merging would resurrect it — the same reasoning, and the same bug, as the
        // Calendar's authoritative range reconcile.
        const before = [OTHER, { id: 'g1', memberName: 'G. Miller', date: '2026-06-01' }];
        const after = replaceMemberSlice(before, 'G. Miller', [{ id: 'g2', memberName: 'G. Miller', date: '2026-06-02' }]);
        assert.deepEqual(after.filter(d => d.memberName === 'G. Miller').map(d => d.id), ['g2'],
            'the deleted g1 is gone, not merged alongside g2');
    });

    test('every other member is left exactly as it was', () => {
        const before = [OTHER, { id: 'g1', memberName: 'G. Miller', date: '2026-06-01' }];
        const after = replaceMemberSlice(before, 'G. Miller', []);
        assert.deepEqual(after, [OTHER], 'S. Silva survives a G. Miller read that returned nothing');
    });

    test('an empty fresh read genuinely empties that member', () => {
        // The member who had everything deleted. Their slice must go — and note this is precisely
        // the state that is indistinguishable from "never read" by looking at the array, which is
        // why authority is tracked separately rather than inferred from it.
        const after = replaceMemberSlice([{ id: 'g1', memberName: 'G. Miller' }], 'G. Miller', []);
        assert.deepEqual(after, []);
    });

    test('it does not mutate the array handed in', () => {
        const before = [{ id: 'g1', memberName: 'G. Miller' }];
        replaceMemberSlice(before, 'G. Miller', []);
        assert.equal(before.length, 1, 'the caller\'s array is untouched');
    });
});
