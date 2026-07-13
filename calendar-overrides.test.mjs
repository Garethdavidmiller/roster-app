/**
 * Unit tests for calendar-overrides.js — Firestore override cache.
 * Run: node --experimental-test-module-mocks --test calendar-overrides.test.mjs
 *
 * Tests: monthKey formatting, addFetchedMonths/clearFetchedMonth guards,
 * duplicate override resolution (manual beats import; newer beats older),
 * and getShiftTypesInMonth type detection including Sunday sick suppression.
 */
import { test, describe, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Controllable getDocs mock — tests set _mockDocs before each async call.
let _mockDocs = [];
let _getBaseShiftFn = () => 'RD';

/** Build a fake Firestore document. */
function makeDoc(id, data) {
    return { id, data: () => data };
}

mock.module('./firebase-client.js', {
    namedExports: {
        db:         {},
        collection: () => ({}),
        query:      (...args) => args,
        where:      () => ({}),
        getDocs:    async () => ({
            size:    _mockDocs.length,
            forEach: cb => _mockDocs.forEach(cb),
        }),
        COLLECTIONS: { overrides: 'overrides', linkDesigns: 'linkDesigns' },
    },
});
mock.module('./roster-data.js', {
    namedExports: {
        getBaseShift: (...args) => _getBaseShiftFn(...args),
        formatISO:    d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
        isSunday:     dateStr => new Date(dateStr + 'T12:00:00').getDay() === 0,
        CONFIG:       { MIN_YEAR: 2024, MAX_YEAR: 2030 },
        teamMembers:  [],
    },
});

const {
    rosterOverridesCache, _initialFetchInProgress,
    setInitialFetchInProgress, addFetchedMonths, clearFetchedMonth,
    monthKey, fetchOverridesForRange,
    ensureOverridesCached, getShiftTypesInMonth,
} = await import('./calendar-overrides.js');

// ── monthKey ──────────────────────────────────────────────────────────────────

describe('monthKey', () => {
    test('formats year/month as YYYY-MM with zero-padding', () => {
        assert.equal(monthKey(2026, 0),  '2026-01');
        assert.equal(monthKey(2026, 11), '2026-12');
        assert.equal(monthKey(2026, 5),  '2026-06');
    });

    test('handles single-digit month values', () => {
        assert.equal(monthKey(2024, 8), '2024-09');
    });
});

// ── addFetchedMonths / clearFetchedMonth ──────────────────────────────────────

describe('addFetchedMonths / clearFetchedMonth', () => {
    test('addFetchedMonths prevents ensureOverridesCached from re-fetching', async () => {
        const key = monthKey(2099, 6);   // '2099-07'
        addFetchedMonths([key]);

        let fetched = false;
        // getDocs would be called if a real fetch happened; since the month is
        // pre-claimed, ensureOverridesCached should be a no-op.
        const origDocs = _mockDocs;
        _mockDocs = [{ id: 'x', data: () => ({ memberName: 'X', date: '2099-07-01', value: 'AL', note: '', type: 'annual_leave', source: 'manual' }) }];
        await ensureOverridesCached(2099, 6, () => { fetched = true; });
        _mockDocs = origDocs;

        assert.equal(fetched, false);   // renderFn was not called — no fetch happened
        assert.equal(rosterOverridesCache.has('X|2099-07-01'), false);
    });

    test('clearFetchedMonth allows the month to be re-fetched', async () => {
        const key = monthKey(2099, 7);    // '2099-08'
        addFetchedMonths([key]);
        clearFetchedMonth(key);

        let fetched = false;
        _mockDocs = [];
        await ensureOverridesCached(2099, 7, () => { fetched = true; });
        assert.equal(fetched, true);   // fetch was allowed after clearing
    });
});

// ── fetchOverridesForRange — duplicate resolution ─────────────────────────────

describe('fetchOverridesForRange duplicate resolution', () => {
    beforeEach(() => {
        rosterOverridesCache.clear();
        _mockDocs = [];
    });

    test('roster_import followed by manual — manual wins', async () => {
        _mockDocs = [
            makeDoc('id1', { memberName: 'A. Smith', date: '2026-06-01', value: '09:00-17:00', type: 'shift', source: 'roster_import', note: '', createdAt: { seconds: 1000 } }),
            makeDoc('id2', { memberName: 'A. Smith', date: '2026-06-01', value: '10:00-18:00', type: 'shift', source: 'manual',        note: '', createdAt: { seconds: 2000 } }),
        ];
        await fetchOverridesForRange('2026-06-01', '2026-06-30');
        assert.equal(rosterOverridesCache.get('A. Smith|2026-06-01')?.value, '10:00-18:00');
    });

    test('manual followed by roster_import — manual still wins regardless of order', async () => {
        _mockDocs = [
            makeDoc('id1', { memberName: 'A. Smith', date: '2026-06-02', value: '10:00-18:00', type: 'shift', source: 'manual',        note: '', createdAt: { seconds: 2000 } }),
            makeDoc('id2', { memberName: 'A. Smith', date: '2026-06-02', value: '09:00-17:00', type: 'shift', source: 'roster_import', note: '', createdAt: { seconds: 1000 } }),
        ];
        await fetchOverridesForRange('2026-06-02', '2026-06-30');
        assert.equal(rosterOverridesCache.get('A. Smith|2026-06-02')?.value, '10:00-18:00');
    });

    test('two manual entries — newer createdAt wins', async () => {
        _mockDocs = [
            makeDoc('id1', { memberName: 'A. Smith', date: '2026-06-03', value: '07:00-15:00', type: 'shift', source: 'manual', note: '', createdAt: { seconds: 1000 } }),
            makeDoc('id2', { memberName: 'A. Smith', date: '2026-06-03', value: '09:00-17:00', type: 'shift', source: 'manual', note: '', createdAt: { seconds: 2000 } }),
        ];
        await fetchOverridesForRange('2026-06-03', '2026-06-30');
        assert.equal(rosterOverridesCache.get('A. Smith|2026-06-03')?.value, '09:00-17:00');
    });

    test('two roster_import entries — newer createdAt wins', async () => {
        _mockDocs = [
            makeDoc('id1', { memberName: 'B. Jones', date: '2026-06-04', value: '06:00-14:00', type: 'shift', source: 'roster_import', note: '', createdAt: { seconds: 3000 } }),
            makeDoc('id2', { memberName: 'B. Jones', date: '2026-06-04', value: '08:00-16:00', type: 'shift', source: 'roster_import', note: '', createdAt: { seconds: 1000 } }),
        ];
        await fetchOverridesForRange('2026-06-04', '2026-06-30');
        assert.equal(rosterOverridesCache.get('B. Jones|2026-06-04')?.value, '06:00-14:00');
    });

    test('skips documents with missing required fields', async () => {
        _mockDocs = [
            makeDoc('bad', { memberName: 'A. Smith', date: '2026-06-05' /* missing value */ }),
        ];
        await fetchOverridesForRange('2026-06-05', '2026-06-30');
        assert.equal(rosterOverridesCache.has('A. Smith|2026-06-05'), false);
    });
});

// ── getShiftTypesInMonth ──────────────────────────────────────────────────────
// Uses unique member names per test to bypass the internal shiftTypesMonthCache
// (keyed "memberName|year|month") and ensure each test computes fresh.

describe('getShiftTypesInMonth', () => {
    beforeEach(() => {
        rosterOverridesCache.clear();
        _getBaseShiftFn = () => 'RD';
    });

    test('returns empty set when all days are RD with no overrides', () => {
        const types = getShiftTypesInMonth({ name: 'NoOverride' }, 2025, 1);
        assert.equal(types.size, 0);
    });

    test('detects AL override on a non-Sunday workday', () => {
        _getBaseShiftFn = () => '06:00-14:00';
        // 2025-01-02 is a Thursday
        rosterOverridesCache.set('ALTest|2025-01-02', { type: 'annual_leave', value: 'AL', source: 'manual' });
        const types = getShiftTypesInMonth({ name: 'ALTest' }, 2025, 0);
        assert.equal(types.has('AL'), true);
    });

    test('detects SPARE override', () => {
        rosterOverridesCache.set('SpareTest|2025-01-02', { type: 'spare_shift', value: 'SPARE', source: 'manual' });
        const types = getShiftTypesInMonth({ name: 'SpareTest' }, 2025, 0);
        assert.equal(types.has('SPARE'), true);
    });

    test('detects RDW override', () => {
        rosterOverridesCache.set('RdwTest|2025-01-02', { type: 'rdw', value: 'RDW', source: 'manual' });
        const types = getShiftTypesInMonth({ name: 'RdwTest' }, 2025, 0);
        assert.equal(types.has('RDW'), true);
    });

    test('detects SICK override on a non-Sunday workday', () => {
        _getBaseShiftFn = () => '06:00-14:00';
        // 2025-01-02 is a Thursday — sick is allowed
        rosterOverridesCache.set('SickWeekday|2025-01-02', { type: 'sick', value: 'SICK', source: 'manual' });
        const types = getShiftTypesInMonth({ name: 'SickWeekday' }, 2025, 0);
        assert.equal(types.has('SICK'), true);
    });

    test('suppresses SICK override on a Sunday (2025-01-05)', () => {
        _getBaseShiftFn = () => '06:00-14:00';
        // 2025-01-05 is a Sunday — sick must never render
        rosterOverridesCache.set('SickSunday|2025-01-05', { type: 'sick', value: 'SICK', source: 'manual' });
        const types = getShiftTypesInMonth({ name: 'SickSunday' }, 2025, 0);
        assert.equal(types.has('SICK'), false);
    });

    test('suppresses SICK override when base shift is RD', () => {
        // The sick guard also applies when base shift is RD (leave on rest day is invalid)
        rosterOverridesCache.set('SickRd|2025-01-02', { type: 'sick', value: 'SICK', source: 'manual' });
        // _getBaseShiftFn returns 'RD' (default from beforeEach)
        const types = getShiftTypesInMonth({ name: 'SickRd' }, 2025, 0);
        assert.equal(types.has('SICK'), false);
    });

    test('suppresses overrides for dates before member startDate', () => {
        _getBaseShiftFn = () => '06:00-14:00';
        // Member started on 2025-02-01 — January overrides should be invisible
        rosterOverridesCache.set('Joiner|2025-01-15', { type: 'annual_leave', value: 'AL', source: 'manual' });
        const member = { name: 'Joiner', startDate: new Date(2025, 1, 1) };  // Feb 1
        const types = getShiftTypesInMonth(member, 2025, 0);
        assert.equal(types.has('AL'), false);
    });
});

// ── fetchOverridesForRange — deletion reconciliation (v16.70) ─────────────────

describe('fetchOverridesForRange deletion reconciliation', () => {
    beforeEach(() => {
        rosterOverridesCache.clear();
        _mockDocs = [];
    });

    test('a cached entry in-range whose doc vanished is EVICTED (deleted elsewhere)', async () => {
        rosterOverridesCache.set('A. Smith|2026-06-10',
            { value: 'SICK', type: 'sick', note: '', source: 'manual', createdAt: { seconds: 500 } });
        _mockDocs = [];   // Firestore now returns nothing for the range — the doc was deleted
        await fetchOverridesForRange('2026-06-01', '2026-06-30');
        assert.equal(rosterOverridesCache.has('A. Smith|2026-06-10'), false,
            'the deleted override must not survive a successful re-query of its range');
    });

    test('entries OUTSIDE the queried range are untouched; in-range survivors are kept', async () => {
        rosterOverridesCache.set('A. Smith|2026-05-20',
            { value: 'AL', type: 'annual_leave', note: '', source: 'manual', createdAt: { seconds: 500 } });
        rosterOverridesCache.set('A. Smith|2026-06-10',
            { value: 'AL', type: 'annual_leave', note: '', source: 'manual', createdAt: { seconds: 500 } });
        _mockDocs = [
            makeDoc('id1', { memberName: 'A. Smith', date: '2026-06-10', value: 'AL', type: 'annual_leave', source: 'manual', note: '', createdAt: { seconds: 500 } }),
        ];
        await fetchOverridesForRange('2026-06-01', '2026-06-30');
        assert.equal(rosterOverridesCache.has('2026-05-20' && 'A. Smith|2026-05-20'), true, 'out-of-range May entry untouched');
        assert.equal(rosterOverridesCache.get('A. Smith|2026-06-10')?.value, 'AL', 'in-range survivor kept');
    });

    test('a MALFORMED doc in the snapshot does not protect its cached entry (server copy is broken)', async () => {
        rosterOverridesCache.set('A. Smith|2026-06-15',
            { value: '09:00-17:00', type: 'shift', note: '', source: 'manual', createdAt: { seconds: 500 } });
        _mockDocs = [
            makeDoc('bad', { memberName: 'A. Smith', date: '2026-06-15' /* value missing → skipped */ }),
        ];
        await fetchOverridesForRange('2026-06-01', '2026-06-30');
        assert.equal(rosterOverridesCache.has('A. Smith|2026-06-15'), false);
    });
});
