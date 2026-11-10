/**
 * links-deletion.test.mjs — the "Recently deleted" rules for the Links workspace.
 * Run: node --test links-deletion.test.mjs   (part of `npm run test:hygiene`)
 *
 * WHY THIS EXISTS. Soft delete replaced a permanent one (v19.41), so this module is what stands
 * between a designer's work and a real `deleteDoc`.
 *
 * The state that matters most is an UNRESOLVED `deletedAt`: a `serverTimestamp()` write reads back
 * as null on the writing device until the server resolves it, and it must still count as deleted —
 * or the design sits in the picker on the very device that just binned it.
 *
 * **The `isPurgeable` / `purgeableIds` / `daysLeft` suites went at v24.10**, with the functions
 * themselves: the bin is permanent by owner decision and nothing expires a design, so the rules
 * that decided WHEN to destroy one no longer exist to be tested. The asymmetry they were weighted
 * for is now structural rather than defended — there is no automatic path to destruction left.
 * Removal is a designer pressing "Remove for good", which links-design-store.js makes
 * transactional. See links-deletion.js's header.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    tsMillis, isDeleted, deletedLabel, sortByDeleted, deleteOutcomeLine, renameRefusedLine,
} from './links-deletion.js';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 7, 1, 12, 0, 0);
/** A Firestore-ish timestamp. */
const ts = (/** @type {number} */ ms) => ({ toMillis: () => ms, toDate: () => new Date(ms) });
/** A document deleted `days` ago. */
const binned = (/** @type {number} */ days, by = 'S. Silva') =>
    ({ name: 'Design 1', patterns: {}, deletedAt: ts(NOW - days * DAY), deletedBy: by });
/** The writer's own local echo, before the server resolves the timestamp. */
const UNRESOLVED = { name: 'Design 1', patterns: {}, deletedAt: null, deletedBy: 'S. Silva' };
const LIVE = { name: 'Design 1', patterns: {}, updatedAt: ts(NOW), updatedBy: 'S. Silva' };

describe('isDeleted — is this design in the bin?', () => {
    test('no deletedAt key → live', () => {
        assert.equal(isDeleted(LIVE), false);
    });
    test('a resolved deletedAt → deleted', () => {
        assert.equal(isDeleted(binned(1)), true);
    });
    test('an UNRESOLVED deletedAt → deleted (the deleter\'s own device)', () => {
        // Requiring a usable number here would leave the design in the picker on the very device
        // that just deleted it, until a server round trip it may not get offline.
        assert.equal(isDeleted(UNRESOLVED), true);
    });
    test('an explicitly undefined deletedAt → live (a cleared field reads as absent)', () => {
        assert.equal(isDeleted({ ...LIVE, deletedAt: undefined }), false);
    });
    test('null/undefined document → live, never a crash', () => {
        assert.equal(isDeleted(null), false);
        assert.equal(isDeleted(undefined), false);
    });
});

describe('deletedLabel — the staff-facing line', () => {
    // ── IT MUST NOT PROMISE A REMOVAL DATE (v19.96, external review P2) ─────────────────────────
    // These cases asserted the countdown — "· removed for good in 30 days" — right up to here, and
    // went on passing for ten versions after v19.86 switched OFF the thing that would have done it.
    // The tests were pinning the SENTENCE, and the sentence was still being produced correctly; what
    // had changed was whether it was true. Nothing in the suite was asking that.
    //
    // The contradiction was visible on one screen: the bin's intro says "kept here until someone
    // removes it for good. Nothing is deleted automatically", and every row underneath it counted
    // down to an automatic removal. Now the row states only what is known.
    test('names who and when — and promises nothing about removal', () => {
        assert.equal(deletedLabel(binned(0), NOW), 'Deleted today by S. Silva');
        assert.equal(deletedLabel(binned(1), NOW), 'Deleted yesterday by S. Silva');
        assert.equal(deletedLabel(binned(4), NOW), 'Deleted 4 days ago by S. Silva');
    });
    test('an OLD deletion reads exactly the same — age is not expiry', () => {
        // 30 days was the old retention constant, and these are the rows that used to say "removed
        // for good today". Nothing removes them and nothing ever will, so the line must not imply
        // anything is about to happen; it just keeps counting up. The literal stays as a literal —
        // there is no constant left to read it from, which is the point.
        assert.equal(deletedLabel(binned(30), NOW), 'Deleted 30 days ago by S. Silva');
        assert.equal(deletedLabel(binned(400), NOW), 'Deleted 400 days ago by S. Silva');
    });
    test('no row anywhere counts down, at any age', () => {
        // The generic form, so a countdown cannot come back through a branch these cases miss.
        for (const d of [binned(0), binned(1), binned(29), binned(30), binned(31), binned(365), UNRESOLVED]) {
            assert.doesNotMatch(deletedLabel(d, NOW), /removed|deleted in|days left|expire/i,
                `the bin promises an automatic removal that does not happen: "${deletedLabel(d, NOW)}"`);
        }
    });
    // CALENDAR DAYS (test audit, 7 Nov 2026). The age was counted in elapsed 24-hour blocks, so the
    // label disagreed with the clock on the wall either side of midnight — and with lastSavedLabel
    // beside it, which already counts calendar days.
    test('a design binned late last night was deleted YESTERDAY, an hour after midnight', () => {
        const at = new Date(2026, 10, 6, 23, 30).getTime(), now = new Date(2026, 10, 7, 0, 30).getTime();
        assert.equal(deletedLabel({ deletedAt: ts(at) }, now), 'Deleted yesterday');
    });
    test('one binned at 23:00 two evenings ago is two days ago, not yesterday', () => {
        const at = new Date(2026, 10, 5, 23, 0).getTime(), now = new Date(2026, 10, 7, 1, 0).getTime();
        assert.equal(deletedLabel({ deletedAt: ts(at) }, now), 'Deleted 2 days ago');
    });
    test('CONTROL: binned just after midnight and read just before the next one is still today', () => {
        const at = new Date(2026, 10, 7, 0, 10).getTime(), now = new Date(2026, 10, 7, 23, 50).getTime();
        assert.equal(deletedLabel({ deletedAt: ts(at) }, now), 'Deleted today');
    });
    test('a 25-hour day across the autumn clock change still counts as one day', () => {
        const was = process.env.TZ;
        process.env.TZ = 'Europe/London';
        try {
            // 25 Oct 2026 is the day the clocks go back: noon Saturday to noon Monday is 49 hours.
            const at = new Date(2026, 9, 24, 12, 0).getTime(), now = new Date(2026, 9, 26, 12, 0).getTime();
            assert.equal((now - at) / 3_600_000, 49, 'premise: the clock change is in this span');
            assert.equal(deletedLabel({ deletedAt: ts(at) }, now), 'Deleted 2 days ago');
        } finally { if (was === undefined) delete process.env.TZ; else process.env.TZ = was; }
    });
    test('a deletion stamped a little ahead of this device\'s clock reads today, never a negative age', () => {
        const now = new Date(2026, 10, 7, 23, 59).getTime();
        assert.equal(deletedLabel({ deletedAt: ts(now + 5 * 60_000) }, now), 'Deleted today');
    });
    test('drops the name when nobody is recorded', () => {
        assert.equal(deletedLabel({ deletedAt: ts(NOW - DAY) }, NOW), 'Deleted yesterday');
    });
    test('says only what it knows when the timestamp has not resolved', () => {
        assert.equal(deletedLabel(UNRESOLVED, NOW), 'Deleted by S. Silva');
    });
    test('no exclamation marks or alarm language (wording conventions)', () => {
        for (const d of [binned(0), binned(30), UNRESOLVED]) {
            assert.doesNotMatch(deletedLabel(d, NOW), /[!]|permanent|forever|lost/i);
        }
    });
});

describe('sortByDeleted — the bin reads newest first', () => {
    test('most recent deletion first', () => {
        const rows = [{ id: 'old', ...binned(9) }, { id: 'new', ...binned(1) }, { id: 'mid', ...binned(4) }];
        assert.deepEqual(sortByDeleted(rows).map(r => r.id), ['new', 'mid', 'old']);
    });
    test('an unresolved deletion sorts to the TOP (it just happened here)', () => {
        const rows = [{ id: 'old', ...binned(9) }, { id: 'justnow', ...UNRESOLVED }];
        assert.deepEqual(sortByDeleted(rows).map(r => r.id), ['justnow', 'old']);
    });
    test('two unresolved rows keep their order instead of going NaN-ordered', () => {
        // Infinity - Infinity is NaN, and a NaN comparator gives an implementation-defined order
        // with no error — the two-null case is answered explicitly for exactly that reason.
        const rows = [{ id: 'a', ...UNRESOLVED }, { id: 'b', ...UNRESOLVED }];
        assert.deepEqual(sortByDeleted(rows).map(r => r.id), ['a', 'b']);
    });
    test('does not reorder the caller\'s array', () => {
        const rows = [{ id: 'old', ...binned(9) }, { id: 'new', ...binned(1) }];
        sortByDeleted(rows);
        assert.deepEqual(rows.map(r => r.id), ['old', 'new']);
    });
    test('empty / missing input is safe', () => {
        assert.deepEqual(sortByDeleted([]), []);
        assert.deepEqual(sortByDeleted(/** @type {any} */ (null)), []);
    });
});

// WHAT A DELETE OR A RENAME FOUND, IN WORDS (whole-app fix, Nov 2026). The store now reports a design
// that was no longer live; the page used to file a colleague's delete as the reader's, or say "check
// your connection" about a rename no retry could make.
describe('the lines a delete or a rename gives when the design was already gone', () => {
    test('a delete names the colleague who had already binned it, or says it was removed for good', () => {
        assert.equal(deleteOutcomeLine('deleted', 'Option A'), '“Option A” is in Recently deleted.');
        assert.equal(deleteOutcomeLine('already-deleted', 'Option A', { deletedBy: 'S. Silva' }),
            '“Option A” is in Recently deleted — S. Silva had already deleted it.');
        assert.equal(deleteOutcomeLine('already-deleted', 'Option A', { deletedBy: ' ' }),
            '“Option A” is in Recently deleted — someone had already deleted it.', 'no deleter invented');
        assert.equal(deleteOutcomeLine('gone', 'Option A'), '“Option A” had already been removed for good.');
    });
    test('a rename says it did not happen, and why — never "check your connection"', () => {
        assert.equal(renameRefusedLine('Option A', { deletedBy: 'S. Silva' }),
            '“Option A” was not renamed — S. Silva deleted it while it was open here. It is in Recently deleted.');
        assert.equal(renameRefusedLine('Option A', null), '“Option A” was not renamed — it was removed for good while it was open here.');
        assert.doesNotMatch(renameRefusedLine('Option A', null) + renameRefusedLine('Option A', {}), /connection/);
    });
});

describe('tsMillis', () => {
    test('reads a timestamp, and answers null for everything that is not one', () => {
        assert.equal(tsMillis(ts(1234)), 1234);
        assert.equal(tsMillis(null), null);
        assert.equal(tsMillis(undefined), null);
        assert.equal(tsMillis({}), null);
        assert.equal(tsMillis(ts(NaN)), null);
        assert.equal(tsMillis(1234), null, 'a bare number is not a Firestore timestamp');
    });
});
