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
import { readFileSync } from 'node:fs';
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

// ── THE ORCHESTRATION, PINNED STATICALLY (v21.86) ───────────────────────────────────────────────
//
// Every rule in this module is unit-tested above, and an external audit still found two silent
// overwrites in the coordinator that calls them. Both were the same shape and neither is visible
// from here: the rules were right, and they were being asked about a moment that had already
// passed.
//
//   1. RENAME did `getDoc` → decide → `setDoc`. A co-editor saving inside that gap kept their
//      patterns (the rename is a merge) but lost the truth of our baseline: we advanced it to a
//      revision whose CONTENT we had never taken in, so our NEXT save saw server == baseline,
//      raised no conflict, and wrote our stale copy over theirs.
//   2. SAVE used a transaction, then fell back to `getDoc` → check → `setDoc` on ANY non-conflict
//      failure — including an online one. A serialisation mechanism failing is not a reason to
//      substitute an unserialised one.
//
// Reproducing either needs two clients and controlled Firestore scheduling, which this repo has no
// harness for and which `links-app.js` — a 3,200-line coordinator importing the gstatic SDK —
// cannot be loaded in Node to provide. So these are STATIC contracts: weaker than a behavioural
// test, and honest about it. They fail if the orchestration is written the old way again, which is
// the failure that actually happened.
describe('the coordinator uses these rules atomically', () => {
    // Comments are stripped first. The rename's own comment NAMES `canAdvanceBaseline` while
    // explaining why it now sits inside the transaction — so an ordering check that reads the raw
    // source finds the explanation before the code and fails on correct work. (Found by this test
    // failing on the very commit that fixed the bug it guards.)
    const app = readFileSync(new URL('./links-app.js', import.meta.url), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
    /** The body of a named function declaration, up to the next one at the same indent. */
    const bodyOf = (name) => {
        const start = app.indexOf(`async function ${name}(`);
        assert.notEqual(start, -1, `${name} not found in links-app.js`);
        const next = app.indexOf('\n    async function ', start + 10);
        const end  = app.indexOf('\n    function ', start + 10);
        const stop = Math.min(...[next, end, app.length].filter(n => n > 0));
        return app.slice(start, stop);
    };

    test('rename reads and writes inside ONE transaction', () => {
        const body = bodyOf('renameDesign');
        assert.match(body, /runTransaction/,
            'renameDesign must read the current revision and write the new name atomically — a ' +
            'getDoc/setDoc pair lets a co-editor land between them and corrupts the baseline');
    });

    test('rename only advances the baseline from a read it made itself', () => {
        // `canAdvanceBaseline` must be consulted INSIDE the transaction: called outside it, it is
        // answering about a revision that may already have been replaced by the time we commit.
        const body = bodyOf('renameDesign');
        const txAt = body.indexOf('runTransaction');
        const decideAt = body.indexOf('canAdvanceBaseline');
        // Both must EXIST before their order means anything. `indexOf` returns -1 for a miss, and
        // `decideAt > -1` is true for any present decision — so without this the ordering check
        // passed on a rename with no transaction at all. Found by mutation.
        assert.notEqual(txAt, -1, 'no transaction in renameDesign');
        assert.notEqual(decideAt, -1, 'renameDesign no longer consults canAdvanceBaseline');
        assert.ok(decideAt > txAt,
            'canAdvanceBaseline is consulted before the transaction opens — its answer is then ' +
            'about a moment that has passed');
    });

    test('save does not downgrade to an unserialised write when it is ONLINE', () => {
        const body = bodyOf('saveChanges');
        assert.match(body, /_isOffline/,
            'the transaction fallback must be gated on being offline; without that gate a ' +
            'contended or transient failure silently overwrites a colleague\'s intervening save');
        assert.match(body, /else throw txErr/,
            'an ONLINE transaction failure must surface, keeping the dirty state, not fall through');
    });
});
