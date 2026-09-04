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
    targetSetFromDoc, targetSetPayload, canOverwriteTargetSet, describeSetState, sortTargetSets,
    MAX_SET_NAME, MAX_SET_SLOTS, describeSetList,
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


// ── describeSetState (v21.08) ───────────────────────────────────────────────────────────────────
//
// Organised by the two questions the sentence answers, because collapsing them is the bug this
// function exists to prevent: v21.06 derived "is it mine?" from "may I write it?" and told the
// admin a colleague's set was theirs — and then, in the same breath, that nobody could overwrite
// it. Both halves are therefore asserted separately AND together, and the negative cases matter as
// much as the positive: what the sentence must NOT say is the part that shipped wrong.
describe('describeSetState — whose it is', () => {
    const SET = { name: 'Set A', createdBy: 'S. Silva' };

    test('the creator owns it, and is told so', () => {
        const r = describeSetState(SET, { userName: 'S. Silva' });
        assert.equal(r.owned, true);
        assert.equal(r.canWrite, true);
        assert.equal(r.canDelete, true);
        assert.match(r.text, /yours to change/);
        assert.doesNotMatch(r.text, /saved by/, 'do not attribute a set to its owner reading it');
    });

    test('the admin may write it WITHOUT owning it — the v21.06 defect', () => {
        const r = describeSetState(SET, { userName: 'G. Miller', isAdmin: true });
        assert.equal(r.owned, false, 'permission is not ownership');
        assert.equal(r.canWrite, true, 'but the admin can still overwrite');
        assert.match(r.text, /saved by S\. Silva/);
        assert.match(r.text, /as the admin/);
        assert.doesNotMatch(r.text, /yours to change/, 'the shipped bug: claiming a colleague\'s set');
        assert.doesNotMatch(r.text, /Only they can overwrite/,
            'and its inverse: telling the one person who CAN that nobody can');
    });

    test('another designer can neither write nor delete it', () => {
        const r = describeSetState(SET, { userName: 'M. Robson' });
        assert.equal(r.owned, false);
        assert.equal(r.canWrite, false);
        assert.equal(r.canDelete, false);
        assert.match(r.text, /Only they can overwrite it/);
    });

    test('signed out is not ownership, even of a set with an empty creator', () => {
        assert.equal(describeSetState(SET, {}).canWrite, false);
        assert.equal(describeSetState({ name: 'X', createdBy: '' }, { userName: '' }).owned, false);
    });

    test('no set selected says what to do, and offers nothing', () => {
        const r = describeSetState(null, { userName: 'G. Miller', isAdmin: true });
        assert.equal(r.canWrite, false);
        assert.equal(r.canDelete, false, 'the admin cannot delete a set that is not picked');
        assert.match(r.text, /Save these staffing numbers/);
    });
});

describe('describeSetState — where the table is', () => {
    const SET = { name: 'Set A', createdBy: 'G. Miller' };
    const as = (/** @type {any} */ ctx) => describeSetState(SET, { userName: 'G. Miller', ...ctx }).text;

    test('not loaded says how to load it, and never claims a match', () => {
        const t = as({ isLoaded: false });
        assert.match(t, /Press Use setup/);
        assert.doesNotMatch(t, /matches/);
    });

    test('loaded and matching says so — this is the reassurance the row existed without', () => {
        assert.match(as({ isLoaded: true }), /still matches it/);
    });

    test('loaded and changed says so, and names both ways out', () => {
        const t = as({ isLoaded: true, changed: true });
        assert.match(t, /You have changed the table/);
        assert.match(t, /Save changes/);
        assert.match(t, /Save as new/);
        assert.doesNotMatch(t, /matches/, 'a changed table must never read as a matching one');
    });

    test('changed, but not yours: only the branch is offered', () => {
        const t = describeSetState({ name: 'Set A', createdBy: 'S. Silva' },
            { userName: 'M. Robson', isLoaded: true, changed: true }).text;
        assert.match(t, /Save as new/);
        assert.doesNotMatch(t, /Save changes updates/, 'do not offer a write that will be refused');
        assert.match(t, /theirs untouched/);
    });

    test('changed is ignored when nothing is loaded — the two are independent', () => {
        // A guard against a future refactor deriving one from the other: having edited the table
        // says nothing about a set you have not loaded, and the row must not report on it.
        assert.equal(as({ isLoaded: false, changed: true }), as({ isLoaded: false }));
    });
});

// ── FOUR STATES, BECAUSE ABSENCE AND IGNORANCE ARE DIFFERENT ANSWERS (v22.57) ───────────────────
//
// `catch { targetSets = []; }` rendered "No saved sets yet", so a dropped connection, a rules
// refusal and a genuinely empty account were one sentence — and the wrong one twice over, because
// these sets are SHARED: the designer is told their colleagues' sets do not exist.
//
// Organised by what each wrong answer costs. Saying NOTHING IS THERE when we could not tell is the
// shipped defect and the expensive direction: it is silent, it accuses a colleague, and the controls
// stay armed against a list nobody has. Saying SOMETHING IS WRONG over an empty account is the
// careless fix — it sends a designer to check a connection that is fine.
describe('describeSetList — what the picker may claim about a list it might not have', () => {
    test('a failed read never renders as an empty account, and offers a way back', () => {
        const r = describeSetList('error', []);
        assert.ok(!/no staffing setups saved yet|no saved sets yet/i.test(r.placeholder ?? ''),
            'a failed read still says "No saved sets yet" — the v21.07/v22.56 defect. These sets are '
            + 'shared, so this tells a designer their colleagues\' work is gone.');
        assert.equal(r.canRetry, true, 'nothing offers to try again, so the state is a dead end');
        // BOTH HALVES, because the first cut of this assertion pinned the WORDING — `/not been
        // deleted/` — and the wording it locked in was "Your sets have not been deleted", which is
        // a claim about the SETS that a failed read cannot support (v22.66, external review). A
        // test can hold a sentence in place long after the sentence stopped being true.
        assert.match(r.hint ?? '', /deleted/i,
            'the hint does not address deletion at all, so it leaves standing the reading a '
            + 'designer reaches for first: somebody removed my colleagues\' work');
        assert.doesNotMatch(r.hint ?? '', /(have|were|are) not been deleted|are still there|are safe/i,
            'the hint asserts the sets\' STATE. The read failed — it knows nothing about them, '
            + 'including that they survive. Reassure about the ERROR, which is the only thing this '
            + 'branch can vouch for.');
        assert.equal(r.usable, false);
    });

    test('a list nobody has cannot be acted on — loading and still-failed both refuse', () => {
        // `usable` is the load-bearing field: a control armed against an unknown list is how a
        // designer overwrites a set the picker never showed them.
        for (const status of /** @type {const} */ (['loading', 'error'])) {
            assert.equal(describeSetList(status, []).usable, false, `${status} reports usable`);
        }
    });

    test('an empty account is READY and says so plainly — no alarm, no retry', () => {
        const r = describeSetList('ready', []);
        assert.equal(r.usable, true, 'a designer with no sets is told something went wrong');
        assert.equal(r.canRetry, false);
        assert.match(r.placeholder ?? '', /no staffing setups saved yet/i);
        assert.equal(r.hint, null, 'an empty account overrides the ordinary hint');
    });

    test('a loaded list adds no placeholder and no hint of its own', () => {
        const r = describeSetList('ready', [{ id: 'a', name: 'Set A' }]);
        assert.equal(r.placeholder, null, 'a placeholder option would sit above the real rows');
        assert.equal(r.hint, null, 'the hint belongs to describeSetState once there is a set to describe');
        assert.equal(r.usable, true);
    });
});
