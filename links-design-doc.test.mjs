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
 * So the suite is organised around the two INVARIANTS rather than around the functions: every shape
 * carries a window, and everything arriving from Firestore is canonicalised. A per-function suite
 * would pass on exactly the code that produced both bugs.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    LEGACY_DOC_ID, deepCopyPatterns, designFromDoc, binEntryFromDoc,
    docPayload, workingCopy, binEntryFrom, restoredEntryFrom,
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
