// @ts-check
/**
 * calendar-snapshot.test.mjs — the member's own stored roster (v24.59): every rule that decides
 * whether a copy may be READ, and that a write keeps only what it should.
 * Run with: node --test calendar-snapshot.test.mjs
 *
 * The page-level behaviour (painted at once, labelled, never for the PIN, written by a live read) is
 * pinned in e2e/calendar-pin.spec.js; this file covers the refusals one by one, because each is a
 * way a member's shifts could be shown to somebody else or shown after they should have gone.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/** A localStorage stand-in — ls.js reads the global. @type {Map<string, string>} */
const store = new Map();
globalThis.localStorage = /** @type {any} */ ({
    getItem: (/** @type {string} */ k) => store.has(k) ? store.get(k) : null,
    setItem: (/** @type {string} */ k, /** @type {string} */ v) => { store.set(k, String(v)); },
    removeItem: (/** @type {string} */ k) => { store.delete(k); },
});

const snap = await import('./calendar-snapshot.js');
const { CALENDAR_SNAPSHOT } = await import('./storage-keys.js');

const NOW = new Date(2026, 9, 5, 12).getTime();   // 5 Oct 2026
const DAY = 86_400_000;
const rec = (/** @type {string} */ memberName, /** @type {string} */ date, extra = {}) =>
    ({ memberName, date, type: 'annual_leave', value: 'AL', source: 'manual', changedBy: 'G. Miller', note: 'n', createdAt: 1, ...extra });
const stored = () => JSON.parse(store.get(CALENDAR_SNAPSHOT) ?? 'null');

beforeEach(() => store.clear());

describe('writing the copy', () => {
    test('keeps the member\'s own rows, trimmed to what a paint needs', () => {
        snap.saveSnapshotMonths('G. Miller', { '2026-10': [rec('G. Miller', '2026-10-06'), rec('S. Boyle', '2026-10-07')] }, NOW);
        const s = stored();
        assert.equal(s.member, 'G. Miller');
        assert.deepEqual(s.months['2026-10'].days, {
            '2026-10-06': { type: 'annual_leave', value: 'AL', source: 'manual', changedBy: 'G. Miller' },
        }, 'a colleague\'s row is never written, and nothing beyond the four fields is kept');
    });

    test('an empty month is a real answer — nothing changed — and is stored as one', () => {
        snap.saveSnapshotMonths('G. Miller', { '2026-10': [] }, NOW);
        assert.deepEqual(stored().months['2026-10'].days, {});
    });

    test('months outside the window are never written', () => {
        snap.saveSnapshotMonths('G. Miller', { '2026-01': [rec('G. Miller', '2026-01-06')], '2027-06': [] }, NOW);
        assert.equal(store.has(CALENDAR_SNAPSHOT), false);
    });

    test('a write for a different member REPLACES the copy rather than merging into it', () => {
        snap.saveSnapshotMonths('S. Boyle', { '2026-11': [rec('S. Boyle', '2026-11-03')] }, NOW);
        snap.saveSnapshotMonths('G. Miller', { '2026-10': [] }, NOW);
        assert.equal(stored().member, 'G. Miller');
        assert.deepEqual(Object.keys(stored().months), ['2026-10']);
    });

    test('an unchanged month is not rewritten on every render, but is re-stamped after a day', () => {
        snap.saveSnapshotMonths('G. Miller', { '2026-10': [rec('G. Miller', '2026-10-06')] }, NOW);
        const first = store.get(CALENDAR_SNAPSHOT);
        snap.saveSnapshotMonths('G. Miller', { '2026-10': [rec('G. Miller', '2026-10-06')] }, NOW + 1000);
        assert.equal(store.get(CALENDAR_SNAPSHOT), first);
        snap.saveSnapshotMonths('G. Miller', { '2026-10': [rec('G. Miller', '2026-10-06')] }, NOW + 2 * DAY);
        assert.equal(stored().months['2026-10'].savedAt, NOW + 2 * DAY, 'so it does not age out while used');
    });
});

describe('reading the copy — each refusal', () => {
    beforeEach(() => snap.saveSnapshotMonths('G. Miller', { '2026-10': [rec('G. Miller', '2026-10-06')] }, NOW));

    test('the member it belongs to gets their month back as a date → record map', () => {
        const m = snap.snapshotMonth('G. Miller', 2026, 9, NOW);
        assert.equal(m?.get('2026-10-06')?.value, 'AL');
        assert.equal(snap.snapshotMonth('G. Miller', 2026, 10, NOW), null, 'a month not held is null, not empty');
    });

    test('anybody else gets nothing — and the copy is DELETED', () => {
        assert.equal(snap.readSnapshot('S. Boyle', NOW), null);
        assert.equal(store.has(CALENDAR_SNAPSHOT), false);
    });

    test('no name gets nothing, and deletes it too', () => {
        assert.equal(snap.readSnapshot('', NOW), null);
        assert.equal(store.has(CALENDAR_SNAPSHOT), false);
    });

    test('older than 14 days it is gone', () => {
        assert.equal(snap.readSnapshot('G. Miller', NOW + 15 * DAY), null);
        assert.equal(store.has(CALENDAR_SNAPSHOT), false);
        assert.equal(snap.MAX_AGE_MS, 14 * DAY);
    });

    test('a month that has left the window is not shown', () => {
        assert.equal(snap.snapshotMonth('G. Miller', 2026, 9, new Date(2027, 1, 20).getTime()), null);
    });

    test('an unreadable or old-shape copy is deleted, never trusted', () => {
        for (const bad of ['{not json', JSON.stringify({ v: 0, member: 'G. Miller', months: {} }), JSON.stringify({ member: 'G. Miller' })]) {
            store.set(CALENDAR_SNAPSHOT, bad);
            assert.equal(snap.readSnapshot('G. Miller', NOW), null);
            assert.equal(store.has(CALENDAR_SNAPSHOT), false, bad);
        }
    });

    test('clearSnapshot deletes it', () => {
        snap.clearSnapshot();
        assert.equal(store.has(CALENDAR_SNAPSHOT), false);
    });
});
