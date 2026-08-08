/**
 * links-deletion.test.mjs — the "Recently deleted" rules for the Links workspace.
 * Run: node --test links-deletion.test.mjs   (part of `npm run test:hygiene`)
 *
 * WHY THIS EXISTS. Soft delete replaced a permanent one (v19.41), so this module is now the only
 * thing standing between a designer's work and a real `deleteDoc`. The two directions are not
 * equally costly and the tests are weighted accordingly: a design wrongly treated as LIVE
 * reappears in the picker and someone deletes it again, while a design wrongly treated as
 * PURGEABLE is gone for good — which is the exact outcome the feature was added to prevent.
 *
 * The state that separates them is an UNRESOLVED `deletedAt`: a `serverTimestamp()` write reads
 * back as null on the writing device until the server resolves it. That state must count as
 * deleted (or the design sits in the picker on the device that just binned it) and must NOT count
 * as purgeable (an age you cannot read is not an age that has expired).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    SOFT_DELETE_RETENTION_DAYS, tsMillis, isDeleted, isPurgeable, purgeableIds,
    daysLeft, deletedLabel, canSoftDelete, sortByDeleted,
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

describe('isPurgeable — may this be destroyed for good?', () => {
    test('a live design is never purgeable, however old', () => {
        assert.equal(isPurgeable({ ...LIVE, updatedAt: ts(NOW - 999 * DAY) }, NOW), false);
    });
    test('inside the window → kept', () => {
        assert.equal(isPurgeable(binned(SOFT_DELETE_RETENTION_DAYS - 1), NOW), false);
    });
    test('exactly ON the boundary → kept (strictly older than the window)', () => {
        assert.equal(isPurgeable(binned(SOFT_DELETE_RETENTION_DAYS), NOW), false);
    });
    test('past the window → purgeable', () => {
        assert.equal(isPurgeable(binned(SOFT_DELETE_RETENTION_DAYS + 1), NOW), true);
    });

    // The two fail-closed cases. Both are the difference between an untidy bin and lost work.
    test('an UNRESOLVED deletedAt is NOT purgeable — unknown age is not expired', () => {
        assert.equal(isPurgeable(UNRESOLVED, NOW), false,
            'this is the one state where isDeleted and isPurgeable deliberately disagree');
    });
    test('a FUTURE deletedAt is NOT purgeable (a device clock that has jumped)', () => {
        // The purge runs on the client, like every other prune in this app, so it is only as
        // trustworthy as Date.now(). Reading a future date as "very old" would empty the whole bin
        // on one wrong machine.
        assert.equal(isPurgeable(binned(-5), NOW), false);
    });
    test('a malformed deletedAt is NOT purgeable', () => {
        assert.equal(isPurgeable({ deletedAt: 'yesterday' }, NOW), false);
        assert.equal(isPurgeable({ deletedAt: ts(NaN) }, NOW), false);
        assert.equal(isPurgeable({ deletedAt: {} }, NOW), false);
    });
    test('the retention window is configurable and respected', () => {
        assert.equal(isPurgeable(binned(8), NOW, 7), true);
        assert.equal(isPurgeable(binned(8), NOW, 90), false);
    });
});

describe('purgeableIds', () => {
    test('picks out only the expired ones, by id', () => {
        const entries = [
            { id: 'a', ...binned(SOFT_DELETE_RETENTION_DAYS + 3) },
            { id: 'b', ...binned(2) },
            { id: 'c', ...UNRESOLVED },
            { id: 'd', ...LIVE },
            { id: 'e', ...binned(SOFT_DELETE_RETENTION_DAYS + 100) },
        ];
        assert.deepEqual(purgeableIds(entries, NOW), ['a', 'e']);
    });
    test('empty / missing input is safe', () => {
        assert.deepEqual(purgeableIds([], NOW), []);
        assert.deepEqual(purgeableIds(/** @type {any} */ (null), NOW), []);
    });
});

describe('daysLeft', () => {
    test('counts down whole days, rounding UP so time left never reads 0', () => {
        assert.equal(daysLeft(binned(0), NOW), SOFT_DELETE_RETENTION_DAYS);
        assert.equal(daysLeft(binned(1), NOW), SOFT_DELETE_RETENTION_DAYS - 1);
        assert.equal(daysLeft({ deletedAt: ts(NOW - (SOFT_DELETE_RETENTION_DAYS * DAY) + 1) }, NOW), 1);
    });
    test('never negative', () => {
        assert.equal(daysLeft(binned(SOFT_DELETE_RETENTION_DAYS + 10), NOW), 0);
    });
    test('unknown when the timestamp has not resolved — null, not a made-up number', () => {
        assert.equal(daysLeft(UNRESOLVED, NOW), null);
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
        // The rows that used to say "removed for good today". Nothing removes them, so the line
        // must not imply anything is about to happen; it just keeps counting up.
        assert.equal(deletedLabel(binned(SOFT_DELETE_RETENTION_DAYS), NOW),
            `Deleted ${SOFT_DELETE_RETENTION_DAYS} days ago by S. Silva`);
        assert.equal(deletedLabel(binned(400), NOW), 'Deleted 400 days ago by S. Silva');
    });
    test('no row anywhere counts down, at any age', () => {
        // The generic form, so a countdown cannot come back through a branch these cases miss.
        for (const d of [binned(0), binned(1), binned(29), binned(30), binned(31), binned(365), UNRESOLVED]) {
            assert.doesNotMatch(deletedLabel(d, NOW), /removed|deleted in|days left|expire/i,
                `the bin promises an automatic removal that does not happen: "${deletedLabel(d, NOW)}"`);
        }
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

describe('canSoftDelete — the workspace always keeps one live design', () => {
    test('counts LIVE designs, so a full bin never makes the last one disposable', () => {
        assert.equal(canSoftDelete(0), false);
        assert.equal(canSoftDelete(1), false);
        assert.equal(canSoftDelete(2), true);
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
