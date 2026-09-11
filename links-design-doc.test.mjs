/**
 * links-design-doc.test.mjs — the design doc ↔ object mapping (v19.94).
 * Run: node --test links-design-doc.test.mjs   (part of `npm run test:hygiene`)
 *
 * Eleven sites in links-app.js built these objects by hand, in four shapes, with two near-identical
 * copies of the write payload. The way that fails is silent — a field left out of one site is not an
 * error, it is a design that quietly loses something — and it has failed twice:
 *
 *   v19.55  the bin kept `patterns` but not `window`, so a restore handed back a design wearing the
 *           app default and the next save wrote that default over the moved boundary it was built to.
 *   v19.94  the legacy `combined-28` migration was the ONLY read path that skipped
 *           `normalisePatterns` — into memory AND into the new document — and wrote no `window`.
 *           Found by this extraction, not by anything watching.
 *
 *   v23.62  `revision` — the concurrency identity — was carried out of a document with a `typeof`
 *           guard that nothing asserted. Found by a mutation sweep, not by a defect: replacing the
 *           guard with `?? null` left this file AND links-concurrency.test.mjs green.
 *
 * So the suite is organised around the two INVARIANTS rather than around the functions: every shape
 * carries a window, and everything arriving from Firestore is canonicalised. A per-function suite
 * would pass on exactly the code that produced both bugs.
 *
 * INVARIANT 2 IS ABOUT TYPE AS WELL AS FORMAT. Canonicalising the times was its first instance and
 * for a long time its only one, so the invariant read as "pad the times". It is the wider rule the
 * module header states — exactly one shape of each value exists in memory, because the document is
 * where the other shapes get in — and `revision` is the second instance: a `number|null` in memory,
 * whatever a corrupt or older-client document holds. That half is tested below beside the times.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    LEGACY_DOC_ID, deepCopyPatterns, designFromDoc, binEntryFromDoc,
    docPayload, workingCopy, binEntryFrom, restoredEntryFrom, lastSavedLabel,
} from './links-design-doc.js';
import { DEFAULT_WINDOW } from './links-window.js';

const MOVED = { monSat: { start: '06:20', end: '23:55' }, sun: { start: '07:15', end: '22:00' } };
const PATTERNS = { '1': { sun: 'RD', mon: '06:20-14:20', tue: 'SPARE', wed: 'RD', thu: 'RD', fri: 'RD', sat: 'RD' } };

/** Every producer in the module, as {name, build} — so an invariant is asserted over ALL of them. */
const EVERY_SHAPE = [
    { name: 'designFromDoc',     build: (o) => designFromDoc('d1', o) },
    { name: 'binEntryFromDoc',   build: (o) => binEntryFromDoc('d1', o) },
    { name: 'docPayload',        build: (o) => docPayload(o, { updatedBy: 'G. Miller', updatedAt: 'TS' }) },
    { name: 'workingCopy',       build: (o) => workingCopy({ id: 'd1', ...o }) },
    { name: 'binEntryFrom',      build: (o) => binEntryFrom({ id: 'd1', ...o }, 'G. Miller') },
    { name: 'restoredEntryFrom', build: (o) => restoredEntryFrom({ id: 'd1', ...o }, { updatedAt: 'TS', updatedBy: 'G. Miller' }) },
];

// ── INVARIANT 1 — the window travels ───────────────────────────────────────────────────────────
describe('every shape carries the window (v19.55)', () => {
    test('a moved boundary survives EVERY conversion in the module', () => {
        // The v19.55 failure was one producer dropping it. Asserting over the whole set is what
        // makes a NEW producer added later fail here rather than in somebody's proposal.
        for (const { name, build } of EVERY_SHAPE) {
            const out = build({ name: 'Option A', patterns: PATTERNS, window: MOVED });
            assert.ok(out.window, `${name} produced no window at all`);
            assert.equal(out.window.sun.end, '22:00',
                `${name} lost the moved Sunday boundary — this is the v19.55 defect`);
        }
    });

    test('a design with no window reads as the app default, not as nothing', () => {
        // A design saved before the field existed must render against the standard hours rather than
        // an undefined span — which is what makes adding the field non-breaking.
        for (const { name, build } of EVERY_SHAPE) {
            const out = build({ name: 'Old', patterns: PATTERNS });
            assert.deepEqual(out.window, DEFAULT_WINDOW, `${name} did not fall back to the default`);
        }
    });

    test('the full round trip — doc → entry → bin → restore → payload — keeps it', () => {
        // The v19.55 route, walked end to end. Every step looked right on its own.
        const doc = { name: 'Option A', patterns: PATTERNS, window: MOVED, updatedAt: 'T1', updatedBy: 'S. Silva' };
        const entry    = designFromDoc('d1', doc);
        const binned   = binEntryFrom(entry, 'M. Robson');
        const restored = restoredEntryFrom(binned, { updatedAt: 'T2', updatedBy: 'M. Robson' });
        const payload  = docPayload(restored, { updatedBy: 'M. Robson', updatedAt: 'T2' });
        assert.equal(payload.window.sun.end, '22:00');
        assert.deepEqual(payload.patterns, entry.patterns);
    });
});

// ── INVARIANT 2 — everything from Firestore is canonicalised ───────────────────────────────────
describe('canonicalisation on the way IN (the v19.94 defect)', () => {
    const LEGACY = { '1': { sun: 'RD', mon: '6:00-14:00', tue: 'RD', wed: 'RD', thu: 'RD', fri: 'RD', sat: 'RD' } };

    test('an unpadded legacy time is padded by every FROM-DOC reader', () => {
        // Unpadded, "6:00-14:00" classified as a worked early — so it counted in the day totals —
        // while startMinutes returned null, making it invisible in the coverage heat map and exempt
        // from every short-turnaround check. Counted, and unchecked, is the worst of both.
        for (const read of [designFromDoc, binEntryFromDoc]) {
            const out = read('d1', { name: 'x', patterns: LEGACY });
            assert.equal(out.patterns['1'].mon, '06:00-14:00',
                `${read.name} did not canonicalise a legacy time`);
        }
    });

    test('the LEGACY doc id is named, so the migration cannot quietly skip the legacy handling', () => {
        // combined-28 is the pre-multi-design singleton: of every document in the collection it is
        // the one GUARANTEED to predate canonicalisation, and it was the only read path that skipped
        // it — persisting the uncanonicalised times into the new named document for good. It ran
        // once, for one document, on a visit nobody was watching.
        assert.equal(LEGACY_DOC_ID, 'combined-28');
        const migrated = designFromDoc('', { ...{ patterns: LEGACY }, name: 'Design 1' });
        assert.equal(migrated.patterns['1'].mon, '06:00-14:00');
        // …and the document it writes carries a window, which the old inline migration did not.
        const payload = docPayload(migrated, { updatedBy: 'G. Miller', updatedAt: 'TS' });
        assert.ok(payload.window, 'the migrated document must carry a window like every other write');
    });

    test('in-memory shapes do NOT re-normalise — the asymmetry is deliberate', () => {
        // Values already in memory have been through the gate. Re-running would be harmless but the
        // distinction is what stops a future edit "tidying" the FROM-DOC calls away.
        const weird = { '1': { mon: '6:00-14:00' } };
        assert.equal(binEntryFrom({ id: 'd1', patterns: weird }, 'x').patterns['1'].mon, '6:00-14:00');
        assert.equal(restoredEntryFrom({ id: 'd1', patterns: weird }, { updatedAt: null, updatedBy: 'x' })
            .patterns['1'].mon, '6:00-14:00');
    });
});

// ── INVARIANT 2, second instance — the CONCURRENCY IDENTITY is coerced, not carried ────────────
//
// WHAT A WRONG ANSWER COSTS. `revision` is the exact identity `conflictOf` compares with `===` to
// decide whether a colleague saved while this page was open. A non-number that survives the read is
// not a wrong figure on a screen — it is an identity nobody can be equal to, or (with a document
// written by an older client at both ends) two values that ARE equal and mean nothing. Both
// directions land in the class links-concurrency.js exists to prevent: the loser of the race sees a
// successful save, the work destroyed is somebody else's, and they find out on reopening.
//
// WHY THE GUARD LIVES HERE AND IS TESTED HERE. Every downstream consumer re-asks `typeof` —
// `baselineFromEntry`, `conflictOf`'s own `freshRev`, the store's `liveRev` — so this coercion is
// defence in depth for them, and a case in links-concurrency.test.mjs cannot see it removed
// (measured: with the guard replaced by `?? null`, that whole file stays green). But it is NOT
// defence in depth for everybody. `links-app.js`'s rename path reads the entry with
// `(d.revision ?? null)` and no guard of its own, so this line is the only thing standing between a
// corrupt document and the value `store.rename` compares to decide whether our baseline may advance.
describe('a revision arriving from Firestore is a number or it is nothing', () => {
    // The shapes a document can actually hold: an older client's string, a boolean somebody wrote,
    // an object, the empty string. Not NaN — that IS a number and the module lets it through, which
    // is safe here (it can never be `===` anything, so it always reports a conflict) and would be a
    // product change to alter.
    const NOT_A_REVISION = [false, true, '3', '', 'rev-3', {}, [], () => 3];

    test('designFromDoc coerces every non-number to null — the trust boundary', () => {
        for (const bad of NOT_A_REVISION) {
            assert.equal(designFromDoc('d1', { name: 'A', revision: bad }).revision, null,
                `a revision of ${JSON.stringify(bad) ?? String(bad)} was carried into memory as an identity`);
        }
        assert.equal(designFromDoc('d1', { name: 'A' }).revision, null,
            'a design nobody has saved since v22.18 has no revision, and null is what says so');
    });

    test('…and a REAL revision survives, or the guard would simply have disabled the feature', () => {
        // The control. Without it the assertions above would pass equally on `revision: null` hard-coded,
        // which loses the exact identity and silently drops every design back to the timestamp rules.
        assert.equal(designFromDoc('d1', { name: 'A', revision: 7 }).revision, 7);
        assert.equal(designFromDoc('d1', { name: 'A', revision: 0 }).revision, 0,
            'zero is a number — the guard must test the TYPE, never the truthiness');
    });

    test('the consumer\'s own expression sees null — `links-app.js` reads `d.revision ?? null`', () => {
        // Written as the call site writes it, because `??` is exactly what does NOT stop `false`
        // or `'3'`. The rename path then hands that value to `store.rename` as `preRevision`, where
        // `liveRev === preRevision` decides whether our baseline may advance over a colleague's save.
        for (const bad of NOT_A_REVISION) {
            const entry = designFromDoc('d1', { name: 'A', revision: bad });
            assert.equal(entry.revision ?? null, null,
                'the one unguarded consumer would receive a non-number as an exact version identity');
        }
    });

    test('every FROM-DOC reader obeys it, so a new one cannot join carrying the raw value', () => {
        // The EVERY_SHAPE discipline applied to this invariant: the rule is asserted over the
        // readers whose INPUT is a Firestore document, not over the one that happens to have the
        // field today. `binEntryFromDoc` emits no revision at all and passes by absence — which is
        // the point, since the day it starts emitting one it is checked here rather than in a
        // designer's proposal.
        for (const read of [designFromDoc, binEntryFromDoc]) {
            for (const bad of NOT_A_REVISION) {
                const out = /** @type {any} */ (read('d1', { name: 'A', revision: bad }));
                assert.ok(!('revision' in out) || out.revision === null || typeof out.revision === 'number',
                    `${read.name} carried a ${typeof bad} out of a document as a revision`);
            }
        }
    });
});

// ── The remaining shape rules ──────────────────────────────────────────────────────────────────
describe('the working copy is genuinely a copy', () => {
    test('editing the live design does not reach back into the list entry', () => {
        // The grid writes patterns[pos][day]. A SHALLOW copy still shares the row objects, so an
        // edit would mutate the designs[] entry the concurrency baseline is compared against — a
        // save would then be diffed against data that had already changed underneath it.
        const entry = { id: 'd1', name: 'A', patterns: PATTERNS, window: MOVED };
        const live  = workingCopy(entry);
        live.patterns['1'].mon = 'RD';
        assert.equal(entry.patterns['1'].mon, '06:20-14:20', 'the working copy aliased its source');
    });

    test('deepCopyPatterns survives null/undefined without throwing', () => {
        assert.deepEqual(deepCopyPatterns(null), {});
        assert.deepEqual(deepCopyPatterns(undefined), {});
    });

    test('the working copy carries NO updatedAt/updatedBy', () => {
        // Those describe the SAVED document. Holding them on the live copy is how a printed sheet
        // ends up carrying somebody else's "Last saved by" over your unsaved edits.
        const live = workingCopy({ id: 'd1', name: 'A', patterns: PATTERNS, window: MOVED,
                                   updatedAt: 'T1', updatedBy: 'S. Silva' });
        assert.deepEqual(Object.keys(live).sort(), ['id', 'name', 'patterns', 'window']);
    });
});

describe('the Firestore write payload', () => {
    test('it contains ONLY the keys firestore.rules allows', () => {
        // The rules pin create/update to hasOnly(['name','patterns','updatedAt','updatedBy']) plus
        // the window and the optional deleted pair. An extra key does not warn — every save
        // permission-denies, on every device, until the rules catch up (and hosting and rules ship
        // from the same push through separate workflows with no ordering guarantee).
        const payload = docPayload({ name: 'A', patterns: PATTERNS, window: MOVED },
                                   { updatedBy: 'G. Miller', updatedAt: 'TS' });
        assert.deepEqual(Object.keys(payload).sort(),
            ['name', 'patterns', 'updatedAt', 'updatedBy', 'window']);
    });

    test('it never carries deletedAt/deletedBy — a save must not resurrect or re-bin', () => {
        const payload = docPayload(
            { name: 'A', patterns: PATTERNS, window: MOVED, deletedAt: 'X', deletedBy: 'Y' },
            { updatedBy: 'G. Miller', updatedAt: 'TS' });
        assert.equal('deletedAt' in payload, false);
        assert.equal('deletedBy' in payload, false);
    });

    test('an unnamed design gets the fallback name, never an empty one', () => {
        // `name` is required by the rules as a 1–100 char string, so an empty one is a hard write
        // failure rather than an untidy picker.
        assert.equal(docPayload({}, { updatedBy: 'x', updatedAt: 'TS' }).name, 'Design 1');
        assert.equal(docPayload({ name: '' }, { updatedBy: 'x', updatedAt: 'TS' }).name, 'Design 1');
    });
});

describe('the bin entry', () => {
    test('an UNRESOLVED deletedAt is passed through as null, not coerced', () => {
        // That is what serverTimestamp() reads back as on the device that just wrote it, and
        // links-deletion.js depends on the distinction: unresolved counts as DELETED (so the design
        // leaves the picker at once) but never as PURGEABLE (an age you cannot read has not expired).
        assert.equal(binEntryFromDoc('d1', { name: 'A', deletedAt: undefined }).deletedAt, null);
        assert.equal(binEntryFrom({ id: 'd1', name: 'A' }, 'G. Miller').deletedAt, null);
        // A resolved one is preserved untouched.
        const ts = { toMillis: () => 1 };
        assert.equal(binEntryFromDoc('d1', { name: 'A', deletedAt: ts }).deletedAt, ts);
    });

    test('the bin keeps PATTERNS, so a restore is a merge and never re-uploads a stale copy', () => {
        assert.deepEqual(binEntryFrom({ id: 'd1', patterns: PATTERNS }, 'x').patterns, PATTERNS);
    });
});

describe('reading a malformed document', () => {
    test('missing fields produce a usable object rather than throwing', () => {
        // getDocs returns whatever is there. A single malformed doc must not take the whole
        // workspace down to the load-failed empty state.
        for (const read of [designFromDoc, binEntryFromDoc]) {
            const out = read('d1', {});
            assert.equal(out.id, 'd1');
            assert.equal(out.name, '');
            assert.deepEqual(out.patterns, {});
            assert.ok(out.window);
        }
    });

    test('a name is trimmed, because the picker sorts on it', () => {
        assert.equal(designFromDoc('d1', { name: '  Option A  ' }).name, 'Option A');
    });
});


// ── lastSavedLabel (v21.08) ─────────────────────────────────────────────────────────────────────
//
// The line under the Save button, and the one thing it must never do is make an OLD save look like
// a recent one. It printed the time alone until v21.08, so a design last touched three days ago
// read "at 15:06" — indistinguishable from one saved this afternoon, which is the exact question
// the line is there to answer. `now` is injected so the today boundary is a fact rather than a
// property of when the suite happens to run.
describe('lastSavedLabel — an old save must not read as a recent one', () => {
    const NOW = new Date(2026, 7, 12, 16, 30);          // 12 Aug 2026, 16:30

    test('today is a time — adding today\'s date to every save would be noise', () => {
        const label = lastSavedLabel('G. Miller', new Date(2026, 7, 12, 15, 6), NOW);
        assert.match(label, /^Last saved by G\. Miller at 15:06$/);
    });

    test('yesterday gains the date — the defect, stated directly', () => {
        const label = lastSavedLabel('G. Miller', new Date(2026, 7, 11, 15, 6), NOW);
        assert.match(label, /11 Aug/);
        assert.match(label, /15:06/);
        assert.notEqual(label, lastSavedLabel('G. Miller', new Date(2026, 7, 12, 15, 6), NOW),
            'the same clock time on two different days must not produce the same label');
    });

    test('a different year gains the year — proposals get read months later', () => {
        assert.match(lastSavedLabel('S. Silva', new Date(2025, 11, 3, 9, 0), NOW), /2025/);
        assert.doesNotMatch(lastSavedLabel('S. Silva', new Date(2026, 0, 3, 9, 0), NOW), /2026/,
            'the current year is not worth the width');
    });

    test('same day-of-month in a different month is still not today', () => {
        // The boundary a naive `getDate()` comparison gets wrong.
        assert.match(lastSavedLabel('G. Miller', new Date(2026, 6, 12, 15, 6), NOW), /12 Jul/);
    });

    test('no name means no line at all — never a dangling "Last saved by"', () => {
        assert.equal(lastSavedLabel('', new Date(), NOW), '');
        assert.equal(lastSavedLabel(null, new Date(), NOW), '');
    });

    test('a missing or unreadable time still names who saved it', () => {
        assert.equal(lastSavedLabel('G. Miller', null, NOW), 'Last saved by G. Miller');
        assert.equal(lastSavedLabel('G. Miller', new Date(NaN), NOW), 'Last saved by G. Miller');
    });
});
