// @ts-check
/**
 * calendar-snapshot.test.mjs — the member's own stored roster (v24.59): every rule that decides
 * whether a copy may be READ, and that a write keeps only what it should.
 * Run with: node scripts/run-tests.mjs test/calendar-snapshot.test.mjs
 *
 * The page-level behaviour (painted at once, labelled, never for the PIN, written by a live read) is
 * pinned in e2e/calendar-access.spec.js; this file covers the refusals one by one, because each is a
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
    get length() { return store.size; },
    key: (/** @type {number} */ i) => [...store.keys()][i] ?? null,
});

const snap = await import('../calendar-snapshot.js');
const { CALENDAR_SNAPSHOT } = await import('../storage-keys.js');

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
        }, 'a colleague\'s row is never written, and nothing beyond the fields a paint needs is kept');
    });

    // Whole-app review, Oct 2026: an absence on a day swapped in from a rest day is shown only
    // because it carries `replacedType`; trimmed away, the stored copy painted Rest over it.
    test('keeps replacedType, so a swapped-in absence still shows over a rest day', async () => {
        const { isOverrideDisplaySuppressed } = await import('../override-utils.js');
        snap.saveSnapshotMonths('G. Miller', { '2026-10': [rec('G. Miller', '2026-10-08',
            { type: 'sick', value: 'SICK', replacedType: 'shift' })] }, NOW);
        const day = snap.snapshotMonth('G. Miller', 2026, 9, NOW)?.get('2026-10-08');
        assert.equal(day?.replacedType, 'shift');
        assert.equal(isOverrideDisplaySuppressed(/** @type {any} */ (day), 'RD', false), false,
            'the stored record must reach the display rule with what it needs to show the absence');
    });

    // v25.18: the day panel names the allowance a moved January leave day comes out of. Trimmed
    // away, a launch from the stored copy dropped the line until the live read settled.
    test('keeps leaveYear, so a moved January day still says which allowance it uses', () => {
        snap.saveSnapshotMonths('G. Miller', { '2026-10': [rec('G. Miller', '2026-10-09', { leaveYear: 2025 }),
            rec('G. Miller', '2026-10-12', { leaveYear: '2025' })] }, NOW);
        const days = stored().months['2026-10'].days;
        assert.equal(days['2026-10-09'].leaveYear, 2025);
        assert.ok(!('leaveYear' in days['2026-10-12']), 'only a whole number is kept, as the rules allow');
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

    test('a month that has left the window is not shown, however fresh it is', () => {
        // Saved on its last day in the window and read the next morning: a few hours old, so only the
        // WINDOW can refuse it (test audit, 7 Nov 2026). This used to read in February 2027, when the
        // 14-day limit refused the copy as well, and deleting the window check left the file green.
        const lastDay     = new Date(2026, 10, 30, 22).getTime();   // 30 Nov — October is last month
        const nextMorning = new Date(2026, 11, 1, 7).getTime();     // 1 Dec — October is two months back
        snap.saveSnapshotMonths('G. Miller', { '2026-10': [rec('G. Miller', '2026-10-06')] }, lastDay);
        assert.equal(snap.snapshotMonth('G. Miller', 2026, 9, lastDay)?.get('2026-10-06')?.value, 'AL',
            'guard: on its last day in the window the month is shown');
        assert.ok(nextMorning - lastDay < snap.MAX_AGE_MS, 'guard: the age limit cannot be what refuses it');
        assert.equal(snap.snapshotMonth('G. Miller', 2026, 9, nextMorning), null);
    });

    test('a copy stamped in the FUTURE is refused — a clock set back cannot stretch its 14 days', () => {
        // Untested until the test audit (7 Nov 2026). The age limit is measured FROM `savedAt`, so a
        // copy written while the device clock ran ahead would outlive 14 days by however far the clock
        // was wrong. A minute's difference is allowed, because phones correct their clocks.
        assert.ok(snap.snapshotMonth('G. Miller', 2026, 9, NOW - 30_000), 'half a minute behind is ordinary clock drift');
        assert.equal(snap.readSnapshot('G. Miller', NOW - 2 * 60_000), null, 'read two minutes before it was written');
        assert.equal(store.has(CALENDAR_SNAPSHOT), false, 'and a copy that cannot be shown is deleted');
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

// ── THE LEAVE BALANCE (16 Nov 2026) ─────────────────────────────────────────────────────────────
// The Annual Leave panel's saved balance was `myb_al_stats_<name>|<year>`, one key per member and year,
// and nothing deleted one: a shared phone kept every balance anybody had opened on it. It rides in the
// member's own copy now, so each rule above is the balance's too. Invented members throughout.
describe('the leave balance — the same copy, the same rules', () => {
    const OWN = 'A. Example', OTHER = 'B. Sample';
    const STATS = { taken: 3, booked: 2, entitlement: 30, breakdown: null, carry: null, christmas: null };

    test('kept for the member, read back for that member and year only', () => {
        snap.saveLeaveBalance(OWN, 2026, STATS, NOW);
        assert.deepEqual(snap.readLeaveBalance(OWN, 2026, NOW), STATS);
        assert.equal(snap.readLeaveBalance(OWN, 2025, NOW), null, 'a year never saved is null');
    });

    test('anybody else gets nothing, and the copy — balance and all — is DELETED', () => {
        snap.saveLeaveBalance(OWN, 2026, STATS, NOW);
        assert.equal(snap.readLeaveBalance(OTHER, 2026, NOW), null);
        assert.equal(store.has(CALENDAR_SNAPSHOT), false, 'a different member on a shared phone ends it');
    });

    test('ONE member: a different member\'s balance REPLACES the copy, months and balances alike', () => {
        snap.saveSnapshotMonths(OWN, { '2026-10': [rec(OWN, '2026-10-06')] }, NOW);
        snap.saveLeaveBalance(OWN, 2026, STATS, NOW);
        snap.saveLeaveBalance(OTHER, 2026, { ...STATS, taken: 9 }, NOW);
        assert.equal(stored().member, OTHER);
        assert.deepEqual(stored().months, {}, 'the first member\'s months went with them');
        assert.deepEqual(Object.keys(stored().leave), ['2026']);
        assert.equal(stored().leave['2026'].stats.taken, 9);
    });

    test('it dies with the session: clearSnapshot — every sign-out, PIN grant and lost grant — deletes it', () => {
        snap.saveLeaveBalance(OWN, 2026, STATS, NOW);
        snap.clearSnapshot();
        assert.equal(snap.readLeaveBalance(OWN, 2026, NOW), null);
        assert.equal(store.has(CALENDAR_SNAPSHOT), false);
    });

    test('BOUNDED: only the years either side of today\'s are kept, and an old one is dropped on the next write', () => {
        snap.saveLeaveBalance(OWN, 2024, STATS, NOW);
        assert.equal(store.has(CALENDAR_SNAPSHOT), false, 'two years back is never written');
        const late = new Date(2026, 11, 28, 12).getTime();   // so the new year's write is inside the 14 days
        for (const y of [2025, 2026, 2027]) snap.saveLeaveBalance(OWN, y, STATS, late);
        assert.deepEqual(Object.keys(stored().leave).sort(), ['2025', '2026', '2027']);
        const nextYear = new Date(2027, 0, 5, 12).getTime();
        snap.saveLeaveBalance(OWN, 2028, STATS, nextYear);
        assert.deepEqual(Object.keys(stored().leave).sort(), ['2026', '2027', '2028'], '2025 left the window and the write');
        assert.equal(snap.readLeaveBalance(OWN, 2025, nextYear), null);
    });

    test('it AGES OUT with the months: older than 14 days it is gone, and a future stamp is refused', () => {
        snap.saveLeaveBalance(OWN, 2026, STATS, NOW);
        assert.equal(snap.readLeaveBalance(OWN, 2026, NOW + 15 * DAY), null);
        assert.equal(store.has(CALENDAR_SNAPSHOT), false);
        snap.saveLeaveBalance(OWN, 2026, STATS, NOW);
        assert.equal(snap.readLeaveBalance(OWN, 2026, NOW - 2 * 60_000), null);
    });

    test('a balance with no month beside it is still a copy — the months\' "empty copy" rule does not delete it', () => {
        snap.saveLeaveBalance(OWN, 2026, STATS, NOW);
        assert.equal(snap.snapshotMonth(OWN, 2026, 9, NOW), null, 'no month to paint');
        assert.deepEqual(snap.readLeaveBalance(OWN, 2026, NOW), STATS, 'and the balance survived the month read');
        snap.saveSnapshotMonths(OWN, { '2027-06': [] }, NOW);   // nothing in the window to write
        assert.deepEqual(snap.readLeaveBalance(OWN, 2026, NOW), STATS, 'a months write with nothing to keep leaves the balance');
    });

    test('a months write carries the balance across, and a balance write keeps the months', () => {
        snap.saveLeaveBalance(OWN, 2026, STATS, NOW);
        snap.saveSnapshotMonths(OWN, { '2026-10': [rec(OWN, '2026-10-06')] }, NOW);
        assert.deepEqual(snap.readLeaveBalance(OWN, 2026, NOW), STATS);
        snap.saveLeaveBalance(OWN, 2027, STATS, NOW);
        assert.equal(snap.snapshotMonth(OWN, 2026, 9, NOW)?.get('2026-10-06')?.value, 'AL');
    });

    test('the retired per-member keys are swept, and nothing else is', () => {
        store.set(`myb_al_stats_${OWN}|2026`, '{}');
        store.set(`myb_al_stats_${OTHER}|2025`, '{}');
        store.set('myb_roster_selected_member', OWN);
        snap.sweepRetiredLeaveKeys();
        assert.deepEqual([...store.keys()], ['myb_roster_selected_member']);
    });
});
