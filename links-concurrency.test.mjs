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
import { conflictOf, baselineAfterWrite, baselineAfterCommit, baselineFromEntry, canAdvanceBaseline, nextRevision } from './links-concurrency.js';

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
        // `loadedRevision: null` is asserted rather than tolerated (v22.18): this path is the one
        // that CANNOT know the revision — a read-back, not a commit — and a stray number here would
        // be a baseline claiming an exactness it does not have.
        assert.deepEqual(baselineAfterWrite(5000), { loadedRevision: null, loadedUpdatedAt: 5000, baselineUnknown: false });
    });

    test('a FAILED read-back flags unknown (v17.18)', () => {
        assert.deepEqual(baselineAfterWrite(null, false), { loadedRevision: null, loadedUpdatedAt: null, baselineUnknown: true });
    });

    test('a read-back that returned no timestamp also flags unknown', () => {
        // Same danger as a failure: null alone reads as "nothing to compare" in conflictOf.
        assert.deepEqual(baselineAfterWrite(null), { loadedRevision: null, loadedUpdatedAt: null, baselineUnknown: true });
        assert.deepEqual(baselineAfterWrite(undefined), { loadedRevision: null, loadedUpdatedAt: null, baselineUnknown: true });
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

// ── THE ORCHESTRATION NOW HAS ONE OWNER (v21.87) ────────────────────────────────────────────────
//
// Every rule in this module is unit-tested above, and an external audit still found two silent
// overwrites in the code that CALLS them — in different functions, both the same shape. The rules
// were right; they were being asked about a moment that had already passed.
//
// v21.86 fixed both where they lay. v21.87 removed the shape: the protocol moved to
// `links-design-store.js`, which takes its Firebase handles as arguments, so the interleavings can
// be replayed deterministically in `links-design-store.test.mjs` rather than reasoned about.
//
// What remains here is the guard that keeps it that way. These are STATIC contracts — weaker than a
// behavioural test and honest about it — and they exist because the failure that actually happened
// was a THIRD write path being added in the coordinator's own idiom.
describe('the design protocol has exactly one owner', () => {
    const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const app   = strip(readFileSync(new URL('./links-app.js', import.meta.url), 'utf8'));
    const store = strip(readFileSync(new URL('./links-design-store.js', import.meta.url), 'utf8'));

    test('the coordinator writes no design document itself', () => {
        // The one that matters. Five write paths each had their own version of the protocol, which
        // is how the same defect reached production twice; a sixth added the old way would be
        // invisible to every behavioural test until two designers collided.
        //
        // Scoped to the DESIGN collection: links-app.js legitimately writes `linkTargetSets`, which
        // is a different document with no revision semantics and no co-editing guarantee.
        // Each write is judged by WHAT IT TARGETS, not counted against an approximation — the
        // first draft compared two totals and fired on a target-set write whose collection
        // constant it had not thought of, which is a guard that reports the wrong thing.
        //
        // The target is found by BRACKET-MATCHING the call, not by reading a fixed number of
        // characters after it (v21.96). The window was 160 chars, which is a proximity test: it
        // passed for every write that named its collection early and failed the moment a
        // legitimate target-set transaction put its `doc(...)` on the third line. A guard that
        // depends on where the author breaks a line reports formatting, not structure.
        const offenders = [];
        for (const m of app.matchAll(/(setDoc|addDoc|deleteDoc|runTransaction)\s*\(/g)) {
            let i = app.indexOf('(', m.index), depth = 0;
            for (; i < app.length; i++) {
                const ch = app[i];
                if (ch === '(' || ch === '{') depth++;
                else if (ch === ')' || ch === '}') { if (--depth === 0) break; }
            }
            const call = app.slice(m.index, i + 1);
            if (/linkTargetSets|SETS_COL/.test(call)) continue;   // a different document entirely
            offenders.push(`${m[1]} @ ${app.slice(0, m.index).split('\n').length}`);
        }
        assert.deepEqual(offenders, [],
            'links-app.js writes a design document itself — design persistence belongs in ' +
            'links-design-store.js, where the protocol is applied once instead of per call site');
    });

    test('the store decides inside its transactions, never before them', () => {
        // The rename bug in one line: `canAdvanceBaseline` called before the transaction opens is
        // answering about a revision that may already have been replaced by the time we commit.
        const body = store.slice(store.indexOf('async rename('));
        const txAt = body.indexOf('runTransaction');
        const decideAt = body.indexOf('canAdvanceBaseline');
        assert.notEqual(txAt, -1, 'rename no longer uses a transaction');
        assert.notEqual(decideAt, -1, 'rename no longer consults canAdvanceBaseline');
        assert.ok(decideAt > txAt, 'the decision is made before the transaction opens');
    });

    test('the store has exactly one unserialised write path, and it is gated on OFFLINE', () => {
        // Rule 2. A serialisation mechanism failing is not a reason to substitute an unserialised
        // one — but a device with no server has nothing to serialise against, and this app is
        // deliberately offline-first. The gate is what keeps those two apart.
        assert.match(store, /if \(!isOffline\(e\)\) throw err;/,
            'save must rethrow an ONLINE transaction failure rather than falling through');
        assert.match(store, /if \(!isOffline\(err\)\) throw err;/,
            'rename must do the same');
    });

    test('the store holds no UI', () => {
        // The split that makes the interleaving tests possible at all. A dialog in here would drag
        // the DOM back in and the fake-Firestore harness would stop working.
        for (const forbidden of ['confirmDialog', 'promptDialog', 'document.', 'innerHTML', 'querySelector']) {
            assert.ok(!store.includes(forbidden),
                `links-design-store.js references ${forbidden} — it decides, the workspace presents`);
        }
    });
});


// ── THE REVISION (v22.18) — the fourth silent-overwrite bug, closed by construction ────────────
//
// The three bugs this module opened with were all reasoned about and fixed in prose. This is the
// fourth, and it is a different KIND: not a rule written wrongly, but a rule that could not be
// asked correctly. `updatedAt` is a serverTimestamp, so a writer cannot know its own write's value
// without a SEPARATE read afterwards — and a colleague's save can land in that gap, leaving us
// holding a baseline that points at a revision whose CONTENT we never took in. Our next save then
// matches, skips the confirm, and overwrites them.
//
// Organised by what a wrong answer COSTS, and the directions are not symmetric:
//   MISSING A CONFLICT destroys a colleague's work silently — they see a successful save and find
//     out on reopening. That is every bug in this module's header.
//   INVENTING ONE costs a confirm dialog nobody needed. Annoying, visible, survivable.

describe('the revision closes the read-back window', () => {
    const ME = 'G. Miller';
    const state = (o) => ({ currentUser: ME, loadedRevision: null, loadedUpdatedAt: null, baselineUnknown: false, ...o });
    const doc = (o) => ({ updatedBy: 'S. Silva', updatedAt: { toMillis: () => 5000 }, ...o });

    // ── MISSING A CONFLICT ─────────────────────────────────────────────────────────────────────

    test('THE BUG: a baseline armed from a read-back that caught a COLLEAGUE\'s write', () => {
        // We committed revision 4. Between our commit and our read-back, S. Silva committed 5 — so
        // a timestamp-armed baseline would hold THEIR revision and our next save would sail through.
        // Armed from what we COMMITTED, the mismatch is visible.
        assert.ok(conflictOf(doc({ revision: 5 }), true, state({ loadedRevision: 4 })),
            'holding our own committed revision, their save is a conflict');
        // The same race in the world before this release: no revision anywhere, and the baseline
        // armed from a read-back that returned THEIR timestamp. It matches, so the guard says
        // nothing and the next save destroys their work. This assertion is the defect itself.
        assert.equal(conflictOf(doc({}), true, state({ loadedUpdatedAt: 5000 })), null,
            'a timestamp read back AFTER the commit agrees — which is why it cannot be the identity');
    });

    test('an older client overwriting the field is a conflict, not a match', () => {
        // A device on a pre-v22.18 build writes without a revision. We hold 5; the server holds
        // none. Absent is not equal to present, in either direction.
        assert.ok(conflictOf(doc({}), true, state({ loadedRevision: 5 })));
        assert.ok(conflictOf(doc({ revision: 1 }), true, state({ loadedRevision: null, loadedUpdatedAt: 5000 })),
            'we loaded before the first revisioned save');
    });

    test('a corrupt revision can never freeze or reverse the counter', () => {
        // A value that is not a usable number restarts at 1 rather than propagating. Freezing it
        // would make every later comparison agree when it should not — the failure this closes.
        for (const bad of [undefined, null, 'x', NaN, Infinity, 0, -3, {}]) {
            assert.equal(nextRevision({ revision: bad }), 1, `revision ${String(bad)} must not be trusted`);
        }
        assert.equal(nextRevision({ revision: 7 }), 8);
        assert.equal(nextRevision({ revision: 2.7 }), 3, 'a float is floored, never carried forward');
    });

    // ── INVENTING ONE ──────────────────────────────────────────────────────────────────────────

    test('our own committed revision matches, so an ordinary second save does not prompt', () => {
        assert.equal(conflictOf(doc({ revision: 4 }), true, state({ loadedRevision: 4 })), null);
    });

    test('a design nobody has saved since v22.18 still uses the timestamp', () => {
        // Neither side has a revision, so the pre-existing rules run unchanged. Without this the
        // release would prompt on every save of every legacy design.
        assert.equal(conflictOf(doc({}), true, state({ loadedUpdatedAt: 5000 })), null);
        assert.ok(conflictOf(doc({}), true, state({ loadedUpdatedAt: 4000 })));
    });

    test('a missing document is not a conflict — the delete paths own that', () => {
        assert.equal(conflictOf({}, false, state({ loadedRevision: 5 })), null);
    });

    test('an UNKNOWN baseline still falls to the name check, revision or not', () => {
        // baselineUnknown means we verified nothing, so the exact rule has nothing to be exact
        // about. It must not short-circuit to "no conflict" (the v17.18 shape).
        assert.ok(conflictOf(doc({ revision: 9 }), true,
            state({ loadedRevision: null, baselineUnknown: true })), 'somebody else last wrote it');
        assert.equal(conflictOf(doc({ revision: 9, updatedBy: ME }), true,
            state({ loadedRevision: null, baselineUnknown: true })), null, 'our own name, as before');
    });

    test('a conflict names the REVISION it saw, so a forced overwrite consents to that one', () => {
        const c = conflictOf(doc({ revision: 9 }), true, state({ loadedRevision: 4 }));
        assert.equal(c.rev, 9, 'the store re-checks this exact number inside the forcing transaction');
    });

    test('baselineAfterCommit is exact and known — the pairing that broke at v17.18 is safe HERE', () => {
        const b = baselineAfterCommit(4);
        assert.deepEqual(b, { loadedRevision: 4, loadedUpdatedAt: null, baselineUnknown: false });
        // The v17.18 danger was `loadedUpdatedAt: null` with `baselineUnknown: false` — a baseline
        // that knew nothing while claiming to be known. This one knows the revision, and conflictOf
        // reaches that first, which is what makes the same shape correct rather than a repeat.
        assert.ok(conflictOf(doc({ revision: 5 }), true, { ...b, currentUser: ME }));
        assert.equal(conflictOf(doc({ revision: 4 }), true, { ...b, currentUser: ME }), null);
    });
});

describe('baselineFromEntry — selecting a design we LOADED', () => {
    // The third arming case, and the one with no write in it. It had no test on the first pass:
    // deleting its revision branch left the whole suite green, because every other case here goes
    // through a commit or a read-back. What that costs is not visible either — the page would fall
    // back to the timestamp on a design that HAS a revision, which is the pre-v22.18 behaviour, so
    // nothing breaks and the guarantee is quietly gone.
    const entry = (/** @type {any} */ o) => ({ updatedAt: { toMillis: () => 5000 }, ...o });

    test('a loaded revision arms the baseline exactly', () => {
        assert.deepEqual(baselineFromEntry(entry({ revision: 7 })),
            { loadedRevision: 7, loadedUpdatedAt: 5000, baselineUnknown: false });
    });

    test('and it is KNOWN even when the timestamp is not', () => {
        // An unresolved serverTimestamp — what our own recent write reads back as on this device.
        // Before the revision there was nothing to compare, so the baseline had to be flagged
        // unknown; now there is, and flagging it unknown would prompt on a design we know exactly.
        assert.deepEqual(baselineFromEntry({ revision: 3, updatedAt: null }),
            { loadedRevision: 3, loadedUpdatedAt: null, baselineUnknown: false });
    });

    test('a design with no revision falls through to the old rules, unchanged', () => {
        assert.deepEqual(baselineFromEntry(entry({})),
            { loadedRevision: null, loadedUpdatedAt: 5000, baselineUnknown: false });
        assert.deepEqual(baselineFromEntry({ updatedAt: null }),
            { loadedRevision: null, loadedUpdatedAt: null, baselineUnknown: true },
            'nothing to compare at all — the v17.18 shape, still flagged');
    });

    test('a corrupt revision is not a revision', () => {
        // Same refusal as nextRevision: a non-number must not become a baseline that compares
        // equal to itself for ever.
        for (const bad of ['5', null, {}, NaN]) {
            const r = baselineFromEntry(entry({ revision: bad }));
            if (Number.isNaN(/** @type {any} */ (bad))) continue;   // NaN IS a number; see below
            assert.equal(r.loadedRevision, null, `revision ${String(bad)} must not arm a baseline`);
        }
        // NaN passes `typeof === 'number'` and is carried through — deliberately not special-cased
        // here, because `NaN !== NaN` makes every comparison in conflictOf a MISMATCH, which is the
        // safe direction (a prompt), and `nextRevision` refuses it on the way to the server.
        assert.ok(conflictOf({ revision: NaN }, true,
            { loadedRevision: NaN, loadedUpdatedAt: null, baselineUnknown: false, currentUser: ME }),
            'a NaN revision never agrees with itself, so it always prompts');
    });

    test('missing input is not a crash', () => {
        assert.deepEqual(baselineFromEntry(null),
            { loadedRevision: null, loadedUpdatedAt: null, baselineUnknown: true });
    });
});
