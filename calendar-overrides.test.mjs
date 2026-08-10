/**
 * Unit tests for calendar-overrides.js — Firestore override cache.
 * Run: node --experimental-test-module-mocks --test calendar-overrides.test.mjs
 *
 * Tests: monthKey formatting, addFetchedMonths/clearFetchedMonth guards,
 * duplicate override resolution (manual beats import; newer beats older),
 * and getShiftTypesInMonth type detection including Sunday sick suppression.
 */
import { test, describe, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// Controllable getDocs mock — tests set _mockDocs before each async call.
let _mockDocs = [];
let _getBaseShiftFn = () => 'RD';
// When true, getDocs rejects — lets the failure-path tests simulate a Firestore fetch error.
let _getDocsThrows = false;
// Phase-1 (local cache) mock state — see getDocsFromCache below.
let _mockCacheDocs = [];
let _cacheThrows   = false;
// DEFERRED READS — the only way to interleave two in-flight fetches deterministically. When on,
// every getDocs call SNAPSHOTS the docs at issue time and then parks until the test releases it by
// index, so a test can land the second read first and the first one late. That ordering is the
// entire subject of the cache-ownership tests; a mock that resolves immediately cannot express it.
let _deferGetDocs = false;
/** @type {(() => void)[]} */
const _releases = [];
const _tick = async (n = 3) => { for (let i = 0; i < n; i++) await Promise.resolve(); };

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
        getDocs:    async () => {
            if (_getDocsThrows) throw new Error('simulated Firestore fetch failure');
            const docs = _mockDocs;   // captured at ISSUE — a later test mutation must not reach it
            if (_deferGetDocs) await new Promise(r => _releases.push(r));
            return { size: docs.length, forEach: cb => docs.forEach(cb) };
        },
        // Phase 1 of the two-phase load (AUTH_PLAN.md → E1). Defaults to an EMPTY cache so every
        // existing test keeps exercising the server path unchanged; the cache tests set _mockCacheDocs.
        getDocsFromCache: async () => {
            if (_cacheThrows) throw new Error('simulated cache miss');
            return { size: _mockCacheDocs.length, empty: _mockCacheDocs.length === 0,
                     forEach: cb => _mockCacheDocs.forEach(cb) };
        },
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
    monthKey, _monthSlices, fetchOverridesForRange, fetchOverridesForRangeFromCache,
    ensureOverridesCached, getShiftTypesInMonth, setOverrideAccess,
} = await import('./calendar-overrides.js');

// Open the Calendar access gate for this whole file (v20.12). Every read here refuses to run
// without it — that is the point of the gate, and this suite is about what the reads DO once they
// are permitted, not about whether they are. The gate itself is `calendar-access-gate.test.mjs`,
// which asserts the opposite direction: that nothing gets through while it is shut.
setOverrideAccess(true);

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
    _mockCacheDocs = [];
    _cacheThrows   = false;
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

// ── ensureOverridesCached — far-month fetch failure is silent, safe, retryable ─
// Finding #5 (far-month half): a far-month override fetch that fails must degrade
// silently — no partial paint, no cache poisoning, and it must stay retryable.
// The app deliberately has NO override-load status indicator (CLAUDE.md, Team Week
// View), so the guarantee here is clean silent fallback, verified by test.

// ── WHO OWNS A MONTH'S CACHE ENTRY (v20.44) ────────────────────────────────────────────────────
//
// The defect these pin is the one the generation counter in calendar-initial-fetch.js does NOT
// cover. That counter stops a late, superseded read from REPAINTING; nothing stopped it WRITING.
// `reconcileRangeIntoCache` is authoritative for its range and EVICTS what its snapshot omits, so a
// stale snapshot landing after a fresh one silently removed the fresh data from the cache — leaving
// the screen correct at that instant and wrong on the next render, which is the worst shape a bug
// can have: the symptom is detached in time from the cause.

describe('_monthSlices', () => {
    test('splits a range into whole months, clamped to the range', () => {
        assert.deepEqual(_monthSlices('2035-01-01', '2035-03-31'), [
            { key: '2035-01', from: '2035-01-01', to: '2035-01-31' },
            { key: '2035-02', from: '2035-02-01', to: '2035-02-28' },
            { key: '2035-03', from: '2035-03-01', to: '2035-03-31' },
        ]);
    });

    test('a partial month keeps the range ends, so the slices still partition it exactly', () => {
        // The union of the parts must equal the whole, or slicing would change what gets evicted.
        assert.deepEqual(_monthSlices('2035-01-10', '2035-02-05'), [
            { key: '2035-01', from: '2035-01-10', to: '2035-01-31' },
            { key: '2035-02', from: '2035-02-01', to: '2035-02-05' },
        ]);
    });

    test('a single day is one slice', () => {
        assert.deepEqual(_monthSlices('2035-05-04', '2035-05-04'),
            [{ key: '2035-05', from: '2035-05-04', to: '2035-05-04' }]);
    });

    test('it crosses a year boundary', () => {
        assert.deepEqual(_monthSlices('2035-12-01', '2036-01-31').map(x => x.key),
            ['2035-12', '2036-01']);
    });
});

describe('a late, superseded read must not write', () => {
    beforeEach(() => {
        rosterOverridesCache.clear(); _mockDocs = []; _getDocsThrows = false;
        _releases.length = 0; _deferGetDocs = false;
        setOverrideAccess(true);   // also clears month ownership — a grant is a fresh start
    });
    afterEach(() => { _deferGetDocs = false; _releases.length = 0; });

    const AL = (date) => makeDoc('a1', { memberName: 'A. Smith', date, value: 'AL',
        type: 'annual_leave', note: '', source: 'manual', createdAt: { seconds: 1000 } });

    test('the exact reported sequence: A issued, B issued, B lands, A lands stale', async () => {
        _deferGetDocs = true;
        // A sees an EMPTY snapshot (its read left the server before the leave was booked).
        _mockDocs = [];
        const pA = fetchOverridesForRange('2035-03-01', '2035-03-31');
        await _tick();
        // B sees the current one.
        _mockDocs = [AL('2035-03-10')];
        const pB = fetchOverridesForRange('2035-03-01', '2035-03-31');
        await _tick();
        assert.equal(_releases.length, 2, 'both reads must be in flight before either lands');

        _releases[1](); await pB;   // the newer read lands FIRST
        assert.equal(rosterOverridesCache.get('A. Smith|2035-03-10')?.value, 'AL');

        _releases[0](); await pA;   // …and the older one lands after it
        assert.equal(rosterOverridesCache.get('A. Smith|2035-03-10')?.value, 'AL',
            'the stale snapshot evicted the newer read\'s data — this is the regression');
    });

    test('the ORDINARY order still applies both, newest last', async () => {
        // The guard must not become "first write wins", which would be the same bug reversed.
        _deferGetDocs = true;
        _mockDocs = [];
        const pA = fetchOverridesForRange('2035-04-01', '2035-04-30');
        await _tick();
        _mockDocs = [AL('2035-04-10')];
        const pB = fetchOverridesForRange('2035-04-01', '2035-04-30');
        await _tick();

        _releases[0](); await pA;   // older lands first — nothing to see
        assert.equal(rosterOverridesCache.has('A. Smith|2035-04-10'), false);
        _releases[1](); await pB;   // newer lands after, and MUST be applied
        assert.equal(rosterOverridesCache.get('A. Smith|2035-04-10')?.value, 'AL',
            'a newer read landing later must still write — ownership orders, it does not freeze');
    });

    test('a month superseded for ONE month still writes the others', async () => {
        // Why ownership is per MONTH. A three-month boot read beaten for its middle month still
        // holds the only data anybody has for the outer two; all-or-nothing would discard them.
        _deferGetDocs = true;
        _mockDocs = [AL('2035-06-10'), AL('2035-07-10'), AL('2035-08-10')].map((d, i) =>
            makeDoc('m' + i, { ...d.data(), memberName: 'A. Smith' }));
        const pWide = fetchOverridesForRange('2035-06-01', '2035-08-31');
        await _tick();
        _mockDocs = [];   // July is now genuinely empty — the newer read for July alone
        const pJuly = fetchOverridesForRange('2035-07-01', '2035-07-31');
        await _tick();

        _releases[1](); await pJuly;    // newer, July only
        _releases[0](); await pWide;    // older, all three — must apply to June and August ONLY

        assert.equal(rosterOverridesCache.get('A. Smith|2035-06-10')?.value, 'AL', 'June is unopposed');
        assert.equal(rosterOverridesCache.get('A. Smith|2035-08-10')?.value, 'AL', 'August is unopposed');
        assert.equal(rosterOverridesCache.has('A. Smith|2035-07-10'), false,
            'July was answered by a newer read and must not be overwritten by the older one');
    });

    test('a local-cache snapshot never writes a month a server read already owns', async () => {
        // Additive merging cannot evict, but reconcile stores every winner it is handed without
        // ranking it against what is cached — so a late cache read could still overwrite a fresher
        // server record with an older one.
        _mockDocs = [AL('2035-09-10')];
        await fetchOverridesForRange('2035-09-01', '2035-09-30');
        assert.equal(rosterOverridesCache.get('A. Smith|2035-09-10')?.value, 'AL');

        _mockCacheDocs = [makeDoc('old', { memberName: 'A. Smith', date: '2035-09-10', value: 'RD',
            type: 'correction', note: '', source: 'manual', createdAt: { seconds: 1 } })];
        const changed = await fetchOverridesForRangeFromCache('2035-09-01', '2035-09-30');
        _mockCacheDocs = [];
        assert.equal(changed, false, 'nothing should have been written');
        assert.equal(rosterOverridesCache.get('A. Smith|2035-09-10')?.value, 'AL',
            'a cache snapshot overwrote an authoritative answer');
    });
});

describe('a GRANT is a fresh start (v20.41)', () => {
    // The bug this pins: `handleAccessLost` re-locks the Calendar and forgets what every month knew,
    // but the months stayed CLAIMED in fetchedMonths. Re-entering the PIN therefore came back to a
    // Calendar that would never read anything again — every ensureOverridesCached a no-op against a
    // claim from the previous session, every month stuck on "Checking this month", and a Try again
    // that could not win. Revoking the viewer's tokens is a documented step of rotating the PIN, so
    // this is the ordinary path, not a corner.
    beforeEach(() => { rosterOverridesCache.clear(); _mockDocs = []; _getDocsThrows = false; });
    // These are the only tests in the file that SHUT the gate, and the module holds it process-wide —
    // leaving it shut silently disabled every read in every suite that ran afterwards.
    afterEach(() => { setOverrideAccess(true); });

    test('re-granting access releases months claimed before it was lost', async () => {
        setOverrideAccess(true);
        _mockDocs = [];
        let renders = 0;
        await ensureOverridesCached(2031, 4, () => { renders++; });   // claims 2031-05
        assert.equal(renders, 1, 'first read settles and repaints');

        // Same month again — correctly a no-op while the claim stands.
        await ensureOverridesCached(2031, 4, () => { renders++; });
        assert.equal(renders, 1);

        // Access lost, then returns (the member entered the rotated PIN).
        setOverrideAccess(false);
        setOverrideAccess(true);

        await ensureOverridesCached(2031, 4, () => { renders++; });
        assert.equal(renders, 2, 'the re-granted session must be able to read the month again');
    });

    test('revoking access does NOT clear the claims — only a grant does', async () => {
        // Deliberate asymmetry. Clearing on revoke would let anything that ran between the revoke and
        // the next grant re-claim months against a shut gate.
        setOverrideAccess(true);
        let renders = 0;
        await ensureOverridesCached(2032, 4, () => { renders++; });
        setOverrideAccess(false);
        await ensureOverridesCached(2032, 4, () => { renders++; });
        assert.equal(renders, 1, 'a shut gate reads nothing at all, claims or no claims');
    });
});

describe('ensureOverridesCached fetch failure', () => {
    beforeEach(() => {
        rosterOverridesCache.clear();
        _mockDocs = [];
        _getDocsThrows = false;
    });

    test('a failed far-month fetch repaints ONCE and leaves the cache untouched', async () => {
        // A previously-cached override for an already-loaded month must survive: a failed
        // fetch must never poison or clear existing good data (reconcile runs only on success).
        //
        // The repaint half inverts what this asserted before v20.40, and the reason is that the
        // consequence of a failure changed. It used to be "the base roster stays", where a repaint
        // would have redrawn the same wrong thing; it is now "the grid is withheld", where the
        // repaint is what turns an indefinite "Checking this month" into a failure panel with a
        // Try again. ONCE is the load-bearing word — see the loop below.
        rosterOverridesCache.set('A. Smith|2027-01-10',
            { value: 'AL', type: 'annual_leave', note: '', source: 'manual', createdAt: { seconds: 500 } });
        _getDocsThrows = true;

        let renders = 0;
        await ensureOverridesCached(2099, 2, () => { renders++; });   // far month; getDocs rejects

        assert.equal(renders, 1, 'the failure has to reach the screen');
        assert.equal(rosterOverridesCache.get('A. Smith|2027-01-10')?.value, 'AL',
            'existing cached data must survive a failed fetch (no poisoning)');
    });

    test('the failure repaint is ONE-SHOT — otherwise it is a fetch↔render loop', async () => {
        // The loop is invisible from either end. renderCalendar calls ensureOverridesCached on
        // every render; the catch releases the month so a later navigation can retry it; and the
        // repaint IS a later render. Unguarded that is fetch → fail → paint → fetch → fail → paint
        // against Firestore for as long as the month is on screen. The month still gets one
        // automatic second attempt — after that the recovery is the panel's own Try again.
        _getDocsThrows = true;
        let renders = 0;
        const paint = () => { renders++; };
        await ensureOverridesCached(2098, 5, paint);
        await ensureOverridesCached(2098, 5, paint);   // the repaint's own render, re-fetching
        await ensureOverridesCached(2098, 5, paint);   // and again, and again…
        assert.equal(renders, 1, 'a month may announce its failure once per claim, not per attempt');
    });

    test('clearFetchedMonth re-arms it — a fresh attempt may report its own outcome', async () => {
        // "Try again" goes through clearFetchedMonth. Releasing the month and suppressing the
        // repaint are deliberately separate flags, and this is why: a user who asks for another
        // attempt must be told how THAT attempt went, not silently left on the previous verdict.
        _getDocsThrows = true;
        let renders = 0;
        await ensureOverridesCached(2097, 5, () => { renders++; });
        assert.equal(renders, 1);
        clearFetchedMonth(monthKey(2097, 5));
        await ensureOverridesCached(2097, 5, () => { renders++; });
        assert.equal(renders, 2, 'the re-armed attempt reports its own failure');
    });

    test('a failed far-month fetch is retryable — the month is not left marked fetched', async () => {
        _getDocsThrows = true;
        let rendered = false;
        await ensureOverridesCached(2099, 3, () => { rendered = true; });   // 2099-04, fails
        rendered = false;   // the failure's own one-shot repaint — see the test above

        // Second attempt with the fetch now succeeding MUST run — proving the month key was
        // released on failure, so navigating back to that month re-queries it.
        _getDocsThrows = false;
        _mockDocs = [
            makeDoc('id1', { memberName: 'A. Smith', date: '2099-04-05', value: 'AL', type: 'annual_leave', source: 'manual', note: '', createdAt: { seconds: 1000 } }),
        ];
        await ensureOverridesCached(2099, 3, () => { rendered = true; });
        assert.equal(rendered, true, 'retry after a failure must re-fetch (failed month was not left marked fetched)');
        assert.equal(rosterOverridesCache.get('A. Smith|2099-04-05')?.value, 'AL', 'retry loads the overrides');
    });

    test('fetchOverridesForRange rejects (does not swallow) so callers control the failure path', async () => {
        _getDocsThrows = true;
        await assert.rejects(fetchOverridesForRange('2099-05-01', '2099-05-31'));
    });
});

// ── fetchOverridesForRangeFromCache — phase 1 of the two-phase load (AUTH_PLAN.md → E1) ──
//
// The contract that matters: it MERGES but never EVICTS. A local-cache snapshot is a possibly-stale
// subset, so treating an absent key as a delete would make it a second authoritative reconciler
// racing the server read — the v18.76 Team View bug. And it must never throw: a cache miss is the
// normal first-visit state, not a failure, and must not reach the sync chip's error path.

describe('fetchOverridesForRangeFromCache', () => {
    const _cacheDoc = (id, member, date, type, value) => makeDoc(id, {
        memberName: member, date, value, type, source: 'manual', note: '', createdAt: { seconds: 1000 },
    });

    test('merges cached docs into the shared cache', async () => {
        _mockCacheDocs = [_cacheDoc('c1', 'G. Miller', '2026-08-10', 'annual_leave', 'AL')];
        const changed = await fetchOverridesForRangeFromCache('2026-08-01', '2026-08-31');
        assert.equal(changed, true);
        assert.equal(rosterOverridesCache.get('G. Miller|2026-08-10')?.type, 'annual_leave');
    });

    test('does NOT evict an in-range key the cache snapshot omits', async () => {
        _mockCacheDocs = [_cacheDoc('c1', 'G. Miller', '2026-08-10', 'annual_leave', 'AL')];
        await fetchOverridesForRangeFromCache('2026-08-01', '2026-08-31');
        // A second, staler cache read no longer carrying that date must leave it alone.
        _mockCacheDocs = [_cacheDoc('c2', 'S. Silva', '2026-08-12', 'sick', 'SICK')];
        await fetchOverridesForRangeFromCache('2026-08-01', '2026-08-31');
        assert.ok(rosterOverridesCache.get('G. Miller|2026-08-10'),
            'a cache subset must never delete live data — only the server read may evict');
    });

    test('an empty cache reports no change and paints nothing', async () => {
        _mockCacheDocs = [];
        assert.equal(await fetchOverridesForRangeFromCache('2026-08-01', '2026-08-31'), false);
    });

    test('never throws — a cache miss resolves false instead of reaching the error path', async () => {
        _cacheThrows = true;
        assert.equal(await fetchOverridesForRangeFromCache('2026-08-01', '2026-08-31'), false);
        _cacheThrows = false;
    });
});
