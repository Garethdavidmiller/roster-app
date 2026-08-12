/**
 * links-target-sets.test.mjs — saved generator target sets: the trust boundary and the ownership rule.
 * Run: node --test links-target-sets.test.mjs   (no mocks; part of `npm run test:hygiene`)
 *
 * Organised around the two ways this feature can betray its one promise — "others can mess about
 * but not lose my set". A CORRUPT set that half-loads becomes a lighter week every panel then
 * reports confidently about (the `parseDesignImport` hazard, arriving from Firestore instead of a
 * paste); and a WRONG ownership answer either offers a colleague a Save that will permission-deny
 * after the tap, or tells the owner their own set is not theirs. The server enforces the real
 * rule — `firestore.rules.test.mjs` covers that side case for case — this file pins the client's
 * copy of it, which drives what the buttons offer.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    targetSetFromDoc, targetSetPayload, canOverwriteTargetSet, sortTargetSets,
    MAX_SET_NAME, MAX_SET_SLOTS,
} from './links-target-sets.js';

const GOOD = {
    name: 'Set A',
    slots: [
        { time: '06:20-14:20', weekday: 1, sat: 1, sun: 0 },
        { time: '15:15-23:55', weekday: 1, sat: 1, sun: 0 },
    ],
    spareLines: 4,
    createdBy: 'G. Miller',
    updatedBy: 'G. Miller',
    updatedAt: 1_760_000_000_000,
};

describe('targetSetFromDoc — a set loads whole, or not at all', () => {
    test('a well-formed document round-trips, with fresh objects', () => {
        const set = targetSetFromDoc('s1', GOOD);
        assert.ok(set);
        assert.equal(set.name, 'Set A');
        assert.equal(set.createdBy, 'G. Miller');
        assert.deepEqual(set.slots, GOOD.slots);
        assert.notEqual(set.slots, GOOD.slots, 'must copy, not alias — the generator edits in place');
        assert.notEqual(set.slots[0], GOOD.slots[0]);
    });

    test('a corrupt row REFUSES THE WHOLE SET — a half-set is a lighter week nobody can see', () => {
        // One bad row among good ones is the dangerous shape: dropping it would load a plausible
        // table that asks for less work than the set's author saved. Same rule as the design
        // importer — refused by the set, never repaired row by row.
        const bad = { ...GOOD, slots: [...GOOD.slots, { time: 'half seven', weekday: 1, sat: 0, sun: 0 }] };
        assert.equal(targetSetFromDoc('s1', bad), null);
        const negative = { ...GOOD, slots: [...GOOD.slots, { time: '06:20-14:20', weekday: -1, sat: 0, sun: 0 }] };
        assert.equal(targetSetFromDoc('s1', negative), null);
    });

    test('a set with NO OWNER is refused — createdBy is the key the whole feature turns on', () => {
        assert.equal(targetSetFromDoc('s1', { ...GOOD, createdBy: '' }), null);
        const { createdBy, ...rest } = GOOD;
        assert.equal(targetSetFromDoc('s1', rest), null);
    });

    test('empty, oversized and non-integer shapes are refused, not clamped', () => {
        assert.equal(targetSetFromDoc('s1', { ...GOOD, slots: [] }), null);
        assert.equal(targetSetFromDoc('s1', { ...GOOD, slots: Array(MAX_SET_SLOTS + 1).fill(GOOD.slots[0]) }), null);
        assert.equal(targetSetFromDoc('s1', { ...GOOD, spareLines: 2.5 }), null);
        assert.equal(targetSetFromDoc('s1', { ...GOOD, spareLines: -1 }), null);
        assert.equal(targetSetFromDoc('s1', { ...GOOD, name: '' }), null);
        assert.equal(targetSetFromDoc('s1', { ...GOOD, name: 'x'.repeat(MAX_SET_NAME + 1) }), null);
        assert.equal(targetSetFromDoc('s1', null), null);
    });

    test('a missing updatedBy falls back to the creator — old enough to predate the field', () => {
        const { updatedBy, ...rest } = GOOD;
        assert.equal(targetSetFromDoc('s1', rest)?.updatedBy, 'G. Miller');
    });
});

describe('canOverwriteTargetSet — whose Save button is this', () => {
    const set = { createdBy: 'G. Miller' };

    test('the creator may; a colleague may not — the whole ask, in one rule', () => {
        assert.equal(canOverwriteTargetSet(set, 'G. Miller'), true);
        assert.equal(canOverwriteTargetSet(set, 'S. Silva'), false);
    });

    test('the admin may — same override the design bin already grants', () => {
        assert.equal(canOverwriteTargetSet(set, 'S. Silva', true), true);
    });

    test('no identity means NO — never a default-open answer on an ownership question', () => {
        assert.equal(canOverwriteTargetSet(set, null), false);
        assert.equal(canOverwriteTargetSet(set, ''), false);
        assert.equal(canOverwriteTargetSet(set, undefined), false);
    });
});

describe('targetSetPayload — what a save actually writes', () => {
    test('fresh copies, trimmed name, and the ownership pair as given', () => {
        const table = { name: '  Set B  ', slots: GOOD.slots, spareLines: 4 };
        const p = targetSetPayload(table, 'G. Miller', 'S. Silva', 'TS');
        assert.equal(p.name, 'Set B');
        assert.equal(p.createdBy, 'G. Miller');
        assert.equal(p.updatedBy, 'S. Silva');
        assert.equal(p.updatedAt, 'TS');
        assert.notEqual(p.slots, GOOD.slots);
        assert.notEqual(p.slots[0], GOOD.slots[0]);
        assert.deepEqual(p.slots, GOOD.slots);
    });

    test('a payload round-trips through targetSetFromDoc — write what we can read', () => {
        const p = targetSetPayload(GOOD, 'G. Miller', 'G. Miller', 1_760_000_000_000);
        const back = targetSetFromDoc('s1', p);
        assert.ok(back);
        assert.deepEqual(back.slots, GOOD.slots);
        assert.equal(back.spareLines, 4);
    });
});

test('sortTargetSets — name order, stable, without mutating the input', () => {
    const sets = [
        { name: 'set b', id: '2' }, { name: 'Set A', id: '3' },
        { name: 'Set A', id: '1' }, { name: 'Weekend trial', id: '4' },
    ];
    const before = [...sets];
    assert.deepEqual(sortTargetSets(sets).map(s => s.id), ['1', '3', '2', '4']);
    assert.deepEqual(sets, before, 'sort must not reorder the caller\'s array');
});
