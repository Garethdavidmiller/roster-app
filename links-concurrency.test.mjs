/**
 * links-concurrency.test.mjs — the Links workspace's co-editing rules.
 * Run: node --test links-concurrency.test.mjs   (part of `npm run test:hygiene`)
 *
 * WHY THIS EXISTS. Three separate bugs have come out of this logic (v16.19, v16.23, v17.18) and
 * every one was a SILENT overwrite of a colleague's work — the loser of the race sees a successful
 * save and only finds out when they reopen the design. All three were fixed by careful reasoning
 * inline in a 1,500-line coordinator, and pinned by nothing, because there was no seam to test
 * through. Each historical bug below has its own case.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { conflictOf, baselineAfterWrite, canAdvanceBaseline } from './links-concurrency.js';

/** A Firestore-ish timestamp. */
const ts = (/** @type {number} */ ms) => ({ toMillis: () => ms, toDate: () => new Date(ms) });
const ME = 'G. Miller';
const THEM = 'S. Silva';

describe('conflictOf — did someone else save while we had the page open?', () => {
    const state = (/** @type {any} */ o = {}) =>
        ({ loadedUpdatedAt: null, baselineUnknown: false, currentUser: ME, ...o });

    test('same timestamp as we loaded → no conflict', () => {
        assert.equal(
            conflictOf({ updatedAt: ts(1000), updatedBy: THEM }, true, state({ loadedUpdatedAt: 1000 })),
            null, 'their name is irrelevant when the version is the one we loaded');
    });

    test('different timestamp → conflict, naming who and when', () => {
        const c = conflictOf({ updatedAt: ts(2000), updatedBy: THEM }, true, state({ loadedUpdatedAt: 1000 }));
        assert.ok(c);
        assert.equal(c.by, THEM);
        assert.equal(c.at?.toMillis?.(), 2000);
    });

    test('a timestamp mismatch conflicts even against OUR OWN name', () => {
        // Our own second device is still a different version of the truth.
        const c = conflictOf({ updatedAt: ts(2000), updatedBy: ME }, true, state({ loadedUpdatedAt: 1000 }));
        assert.ok(c, 'path 1 is about the version, not the person');
    });

    test('no baseline and no unknown-flag → no conflict (nothing to compare)', () => {
        assert.equal(conflictOf({ updatedAt: ts(2000), updatedBy: THEM }, true, state()), null);
    });

    test('UNKNOWN baseline + someone else last wrote → conflict (v17.18)', () => {
        // The v17.18 bug: a failed read-back left loadedUpdatedAt null and baselineUnknown FALSE, so
        // the case above applied and the guard was silently switched off. With the flag set, the
        // weaker name-based check takes over.
        const c = conflictOf({ updatedAt: ts(2000), updatedBy: THEM }, true,
            state({ baselineUnknown: true }));
        assert.ok(c, 'an unknown baseline must not read as "safe to overwrite"');
        assert.equal(c.by, THEM);
    });

    test('UNKNOWN baseline + WE last wrote → no conflict (the accepted limit)', () => {
        assert.equal(
            conflictOf({ updatedAt: ts(2000), updatedBy: ME }, true, state({ baselineUnknown: true })),
            null, 'two devices under one display name cannot be told apart this way — documented');
    });

    test('UNKNOWN baseline + no updatedBy recorded → no conflict', () => {
        assert.equal(
            conflictOf({ updatedAt: ts(2000), updatedBy: '' }, true, state({ baselineUnknown: true })),
            null, 'nothing to compare a name against');
    });

    test('a document that does not exist yet is never a conflict', () => {
        assert.equal(conflictOf({}, false, state({ loadedUpdatedAt: 1000 })), null);
        assert.equal(conflictOf(null, false, state({ baselineUnknown: true })), null);
    });

    test('a server doc with no usable timestamp is not treated as a conflict', () => {
        // An unresolved serverTimestamp reads back as null on the writer's own device.
        assert.equal(conflictOf({ updatedAt: null, updatedBy: THEM }, true,
            state({ loadedUpdatedAt: 1000 })), null);
    });

    test('the conflict names "Someone" rather than blank when the writer is unrecorded', () => {
        const c = conflictOf({ updatedAt: ts(2000) }, true, state({ loadedUpdatedAt: 1000 }));
        assert.equal(c?.by, 'Someone');
    });
});

describe('baselineAfterWrite — an unknown baseline must never look like "no baseline"', () => {
    test('a good read-back arms the baseline', () => {
        assert.deepEqual(baselineAfterWrite(5000), { loadedUpdatedAt: 5000, baselineUnknown: false });
    });

    test('a FAILED read-back flags unknown (v17.18)', () => {
        assert.deepEqual(baselineAfterWrite(null, false), { loadedUpdatedAt: null, baselineUnknown: true });
    });

    test('a read-back that returned no timestamp also flags unknown', () => {
        // Same danger as a failure: null alone reads as "nothing to compare" in conflictOf.
        assert.deepEqual(baselineAfterWrite(null), { loadedUpdatedAt: null, baselineUnknown: true });
        assert.deepEqual(baselineAfterWrite(undefined), { loadedUpdatedAt: null, baselineUnknown: true });
    });

    test('the two functions compose: a failed read-back keeps the NEXT save guarded', () => {
        // The whole point, end to end. Without the flag this returns null and the co-editor's work
        // is overwritten with no prompt at all.
        const after = baselineAfterWrite(null, false);
        const c = conflictOf({ updatedAt: ts(9000), updatedBy: THEM }, true, { ...after, currentUser: ME });
        assert.ok(c, 'the next save still prompts');
    });
});

describe('canAdvanceBaseline — a rename may only move our baseline if nothing changed under us', () => {
    test('nobody saved in between → advance (v16.19)', () => {
        // v16.19: a rename that did NOT move our baseline let a co-editor's next save revert it.
        assert.equal(canAdvanceBaseline(1000, 1000), true);
    });

    test('someone saved in between → do NOT advance (v16.23)', () => {
        // v16.23: advancing blindly made the next save skip the conflict confirm and overwrite their
        // patterns with our stale copy.
        assert.equal(canAdvanceBaseline(2000, 1000), false);
    });

    test('an unreadable pre-read (offline) does not advance', () => {
        assert.equal(canAdvanceBaseline(null, 1000, false), false);
        assert.equal(canAdvanceBaseline(1000, 1000, false), false, 'even a matching value is untrusted if the read threw');
    });

    test('null baseline matches only a null pre-read', () => {
        assert.equal(canAdvanceBaseline(null, null), true, 'a doc with no timestamp yet, unchanged');
        assert.equal(canAdvanceBaseline(1000, null), false);
        assert.equal(canAdvanceBaseline(null, 1000), false);
    });
});
