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
let _getPatternShiftFn = () => 'RD';
// When true, getDocs rejects — lets the failure-path tests simulate a Firestore fetch error.
let _getDocsThrows = false;
// When true, getDocs answers as Firestore does on a dead signal: from the CACHE (`metadata.fromCache`).
let _getDocsFromCacheFlag = false;
// Phase-1 (local cache) mock state — see getDocsFromCache below.
let _mockCacheDocs = [];
let _cacheThrows   = false;
// Every cache read, as the query it was issued with — so a test can count them AND see whether one
// was narrowed to a single member (the retired provisional scope did exactly that).
/** @type {any[]} */
let _cacheQueries  = [];
// DEFERRED READS — the only way to interleave two in-flight fetches deterministically. When on,
// every getDocs call SNAPSHOTS the docs at issue time and then parks until the test releases it by
// index, so a test can land the second read first and the first one late. That ordering is the
// entire subject of the cache-ownership tests; a mock that resolves immediately cannot express it.
let _deferGetDocs = false;
// Each parked read is released by calling its entry: with nothing it ANSWERS, with an error it
// REJECTS (10 Nov 2026) — a read that fails after another has landed is half of the ordering tests.
/** @type {((err?: any) => void)[]} */
const _releases = [];
// The same lever for the phase-1 CACHE read, which had none: "the Calendar locked while the cache
// read was out" could not be expressed, so nothing could see what that read did when it landed.
let _deferCacheDocs = false;
/** @type {(() => void)[]} */
const _cacheReleases = [];
const _tick = async (n = 3) => { for (let i = 0; i < n; i++) await Promise.resolve(); };

/** Build a fake Firestore document. */
function makeDoc(id, data) {
    return { id, data: () => data };
}

// EVERY query this module builds, as it was actually built. The fake used to answer
// `where: () => ({})` and `collection: () => ({})`, which threw the constraints away — so no test
// in this file could see what was ASKED FOR, only what came back, and the two are different passes
// over the same state. Recorded as plain tuples; `queries` groups them per issued query, because
// the module builds two shapes and "which read carried what" is the question.
/** @type {Array<[string, string, any]>} */
let wheres = [];
/** @type {string[]} */
let collections = [];
/** @type {Array<{ collection: string|null, wheres: Array<[string, string, any]> }>} */
let queries = [];

mock.module('./firebase-client.js', {
    namedExports: {
        db:         {},
        collection: (/** @type {any} */ _db, /** @type {any} */ name) => { collections.push(name); return { _collection: name }; },
        query:      (/** @type {any} */ ...args) => {
            const coll = args.find(a => a && a._collection)?._collection ?? null;
            queries.push({ collection: coll, wheres: args.filter(a => Array.isArray(a?._where)).map(a => a._where) });
            return args;
        },
        where:      (/** @type {any} */ f, /** @type {any} */ op, /** @type {any} */ v) => {
            const c = /** @type {[string, string, any]} */ ([f, op, v]);
            wheres.push(c);
            return { _where: c };
        },
        getDocs:    async () => {
            if (_getDocsThrows) throw new Error('simulated Firestore fetch failure');
            const docs = _mockDocs;   // captured at ISSUE — a later test mutation must not reach it
            const fromCache = _getDocsFromCacheFlag;   // …and so is who answers: a parked read keeps the answer it was issued with
            if (_deferGetDocs) await new Promise((res, rej) => _releases.push((/** @type {any} */ err) => err ? rej(err) : res(undefined)));
            return { size: docs.length, forEach: cb => docs.forEach(cb), metadata: { fromCache } };
        },
        // Phase 1 of the two-phase load (AUTH_PLAN.md → E1). Defaults to an EMPTY cache so every
        // existing test keeps exercising the server path unchanged; the cache tests set _mockCacheDocs.
        getDocsFromCache: async (/** @type {any} */ q) => {
            _cacheQueries.push(q);
            if (_cacheThrows) throw new Error('simulated cache miss');
            const docs = _mockCacheDocs;
            if (_deferCacheDocs) await new Promise(r => _cacheReleases.push(() => r(undefined)));
            return { size: docs.length, empty: docs.length === 0, forEach: cb => docs.forEach(cb) };
        },
        COLLECTIONS: { overrides: 'overrides', linkDesigns: 'linkDesigns' },
    },
});
// The legend asks christmas-leave.js about 25/26 December (v25.37), which reads the member's
// PATTERN and the shipped date helpers. Those are the real ones, reached past this mock the way
// calendar-renderer.test.mjs reaches them (`?real` is a different URL, so it is not intercepted);
// the pattern itself is a seam, like `getBaseShift`, so a test decides whether a member was due.
const realRosterData = await import('./roster-data.js?real');
mock.module('./roster-data.js', {
    namedExports: {
        getBaseShift: (...args) => _getBaseShiftFn(...args),
        getPatternShift: (...args) => _getPatternShiftFn(...args),
        formatISO:    d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
        isSunday:     dateStr => new Date(dateStr + 'T12:00:00').getDay() === 0,
        isChristmasRD:  realRosterData.isChristmasRD,
        isWorkedShift:  realRosterData.isWorkedShift,
        isBankHoliday:  realRosterData.isBankHoliday,
        parseISODate:   realRosterData.parseISODate,
        CONFIG:       { MIN_YEAR: 2024, MAX_YEAR: 2030 },
        teamMembers:  [],
    },
});

const {
    rosterOverridesCache, _initialFetchInProgress,
    setInitialFetchInProgress, addFetchedMonths, clearFetchedMonth,
    monthKey, _monthSlices, fetchOverridesForRange, fetchOverridesForRangeFromCache,
    ensureOverridesCached, getShiftTypesInMonth, setOverrideAccess, releaseStaleMonths, SERVED_FROM_CACHE,
    READ_SUPERSEDED,
} = await import('./calendar-overrides.js');
// The REAL knowledge module — this suite is where a read's outcome becomes a claim about a month.
const { knowledgeOf, decideDisplay, forget: forgetKnowledge } = await import('./calendar-data-state.js');

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

// ── WHAT WAS ACTUALLY ASKED FOR (v23.63) ────────────────────────────────────────────────────────
//
// Every test above reads this module's answers. None of them could read its QUESTIONS, because the
// fake discarded `where()` and `collection()` — "a harness that discards is a harness that cannot
// see" (CLAUDE.md), and the thing it could not see here is the date range.
//
// Organised by what a wrong question costs, and the two directions are not symmetrical:
//
//   · An UNBOUNDED read is silent and it is the expensive one. Drop either date bound and every
//     assertion in this file still passes: the per-month slice below `getDocs` filters what is
//     WRITTEN, so the cache stays correct and the grid is identical — the app has simply asked
//     Firestore for every override it has ever held, on a phone, on mobile data, on every month
//     navigation that is not already claimed. The module carries its own 1,900-document warning
//     for exactly this, and MAINTENANCE_CALENDAR.md has the collection on a path past 5,000.
//     Measured: removing `where('date', '<=', endStr)` left the whole repository green.
//   · A read scoped TOO TIGHTLY loses overrides off the end of the month, which is visible — the
//     grid shows a base roster where a change was recorded, and somebody reports it.
//
// The member scope is NOT re-pinned here: `calendar-access-gate.test.mjs` already drives it from
// both sides, with a recording fake of its own, in the file that owns the access question.
describe('the QUESTION, not the answer — every read is bounded to the range it was asked for', () => {
    beforeEach(() => {
        rosterOverridesCache.clear();
        _mockDocs = [];
        _mockCacheDocs = [];
        _cacheThrows = false;
        wheres = [];
        collections = [];
        queries = [];
    });

    test('the authoritative read asks for the overrides collection, and only the range', async () => {
        await fetchOverridesForRange('2026-06-01', '2026-06-30');
        assert.deepEqual(collections, ['overrides'], 'the read went to another collection');
        assert.equal(queries.length, 1, 'one read, one query');
        assert.deepEqual(queries[0].wheres, [
            ['date', '>=', '2026-06-01'],
            ['date', '<=', '2026-06-30'],
        ], 'the server read was not bounded to the range it was handed');
    });

    test('the CACHE read carries the same bounds — it is the same range, without the network', async () => {
        _mockCacheDocs = [makeDoc('c1', { memberName: 'A. Smith', date: '2026-06-10', value: 'AL', type: 'annual_leave', source: 'manual', note: '' })];
        await fetchOverridesForRangeFromCache('2026-06-01', '2026-06-30');
        assert.deepEqual(collections, ['overrides']);
        assert.deepEqual(queries[0].wheres, [
            ['date', '>=', '2026-06-01'],
            ['date', '<=', '2026-06-30'],
        ], 'the local cache read was unbounded — it deserialises the whole collection out of IndexedDB');
    });

    test('a different month asks a different question — the bounds are the argument, not a constant', async () => {
        // Otherwise both cases above would pass on a read that hardcoded June.
        await ensureOverridesCached(2027, 1, () => {});      // February 2027
        assert.equal(queries.length, 1);
        assert.deepEqual(queries[0].wheres, [
            ['date', '>=', '2027-02-01'],
            ['date', '<=', '2027-02-28'],
        ], 'the month asked for is not the month the caller named');
    });

    test('the range spans WHOLE months — a 3-month fetch is one query, first to last', async () => {
        // The initial fetch hands three months at once and relies on one round trip for the lot.
        // Asserted because the alternative — a query per month — is a change nothing else would
        // notice and three times the reads on the app's most-opened page.
        await fetchOverridesForRange('2026-05-01', '2026-07-31');
        assert.equal(queries.length, 1, 'a multi-month range was split into separate reads');
        assert.deepEqual(queries[0].wheres, [
            ['date', '>=', '2026-05-01'],
            ['date', '<=', '2026-07-31'],
        ]);
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
        _getPatternShiftFn = () => 'RD';
    });

    test('Christmas leave lights AL in December 2026, where nothing is recorded (v25.37)', () => {
        // Both days are a rest day for everybody (`getBaseShift`); a member whose PATTERN had them
        // at work is on annual leave there, and the legend must say what the grid draws.
        _getPatternShiftFn = () => '06:00-14:00';
        assert.equal(getShiftTypesInMonth({ name: 'XmasDue' }, 2026, 11).has('AL'), true);
        _getPatternShiftFn = () => 'RD';
        assert.equal(getShiftTypesInMonth({ name: 'XmasRest' }, 2026, 11).has('AL'), false);
        // …and before 2026 the days stay Rest, as they always were.
        _getPatternShiftFn = () => '06:00-14:00';
        assert.equal(getShiftTypesInMonth({ name: 'Xmas2025' }, 2025, 11).has('AL'), false);
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
        assert.equal(rosterOverridesCache.has('A. Smith|2026-05-20'), true, 'out-of-range May entry untouched');
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

    test('a month read the CACHE answered never writes a month a server read already owns', async () => {
        // The same rule where the other non-authoritative answer arrives (test audit, 7 Nov 2026).
        // On a dead signal `getDocs` resolves from this device's cache, and that branch merges what it
        // is handed; removing its ownership check left every suite green, and the older record the
        // cache held overwrote the server's newer answer.
        _mockDocs = [AL('2035-11-10')];
        await fetchOverridesForRange('2035-11-01', '2035-11-30');
        assert.equal(rosterOverridesCache.get('A. Smith|2035-11-10')?.value, 'AL');

        _getDocsFromCacheFlag = true;
        _mockDocs = [makeDoc('old', { memberName: 'A. Smith', date: '2035-11-10', value: 'RD',
            type: 'correction', note: '', source: 'manual', createdAt: { seconds: 1 } })];
        try {
            await assert.rejects(() => fetchOverridesForRange('2035-11-01', '2035-11-30'),
                (/** @type {any} */ e) => e.code === SERVED_FROM_CACHE, 'guard: this read must take the cache-served branch');
        } finally { _getDocsFromCacheFlag = false; _mockDocs = []; }
        assert.equal(rosterOverridesCache.get('A. Smith|2035-11-10')?.value, 'AL',
            'a cache-served answer overwrote what the server had already said for the month');
    });
});

describe('a settled month is re-read once it is old (Oct 2026 review)', () => {
    // The defect: a month marked fetched stayed fetched for the life of the page, so a shared PC or a
    // resumed iPhone app showed the morning's roster as current hours later. releaseStaleMonths is
    // what the page calls on resume; these pin what it may and may not release.
    beforeEach(() => { rosterOverridesCache.clear(); _mockDocs = []; _getDocsThrows = false; _deferGetDocs = false; });
    const HOUR = 3_600_000;

    test('a month older than the limit is released, and the next render reads it again', async () => {
        let renders = 0;
        await ensureOverridesCached(2041, 2, () => { renders++; });
        await ensureOverridesCached(2041, 2, () => { renders++; });
        assert.equal(renders, 1, 'while fresh, the claim stands');
        assert.ok(releaseStaleMonths(HOUR, Date.now() + 2 * HOUR).includes('2041-03'));
        await ensureOverridesCached(2041, 2, () => { renders++; });
        assert.equal(renders, 2, 'released, so the resume render re-reads it');
    });

    test('a fresh month is not released', async () => {
        await ensureOverridesCached(2042, 2, () => {});
        assert.ok(!releaseStaleMonths(HOUR, Date.now() + 60_000).includes('2042-03'));
    });

    test('a month still being read is never released under its own read', async () => {
        _deferGetDocs = true;
        const pending = ensureOverridesCached(2043, 2, () => {});
        await _tick();
        assert.ok(!releaseStaleMonths(0, Date.now() + 10 * HOUR).includes('2043-03'), 'in flight — left alone');
        _deferGetDocs = false;
        while (_releases.length) _releases.shift()();
        await pending;
    });

    test('nothing is released while the initial fetch still owns its months', () => {
        addFetchedMonths(['2044-03']);
        setInitialFetchInProgress(true);
        try { assert.deepEqual(releaseStaleMonths(0, Date.now() + 10 * HOUR), []); }
        finally { setInitialFetchInProgress(false); }
        assert.ok(releaseStaleMonths(0, Date.now() + 10 * HOUR).includes('2044-03'), 'and once it settles, its months age like any other');
    });
});

describe('a GRANT is a fresh start (v20.41)', () => {
    // The bug this pins: losing access re-locks the Calendar and forgets what every month knew (the
    // shut, `setOverrideAccess(false)`), but the months stayed CLAIMED in fetchedMonths. Re-entering the PIN therefore came back to a
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

// ── A RE-CHECK THAT FAILS (10 Nov 2026, external review F1) ─────────────────────────────────────────
// A month read once and re-read later (the page came back into view after ten minutes) with no signal
// stayed `authoritative`: knowledge was monotonic, so the failure could not be recorded, and the
// morning's grid went on being drawn as current — "As rostered" included — with the "Saved copy —
// couldn't check for changes" label never reached. These run the real `ensureOverridesCached` into
// the real knowledge module, because the defect lived between the two.
describe('a re-check that fails keeps the grid as the saved copy, never as current', () => {
    const HOUR = 3_600_000;
    beforeEach(() => {
        rosterOverridesCache.clear(); _mockDocs = []; _getDocsThrows = false; _getDocsFromCacheFlag = false;
        _deferGetDocs = false; _releases.length = 0;
        setOverrideAccess(true);   // a grant is a fresh start: no claims, no owners, nothing owed
    });
    afterEach(() => { _getDocsThrows = false; _getDocsFromCacheFlag = false; _deferGetDocs = false; _releases.length = 0; });

    const AL = (/** @type {string} */ date) => makeDoc('al-' + date, { memberName: 'A. Smith', date, value: 'AL',
        type: 'annual_leave', note: '', source: 'manual', createdAt: { seconds: 1000 } });
    /** The month is read and settled, then old enough for the page's return to release it. */
    async function readThenExpire(/** @type {number} */ year, /** @type {number} */ month, /** @type {Function} */ paint = () => {}) {
        const key = monthKey(year, month);
        _mockDocs = [AL(`${key}-10`)];
        await ensureOverridesCached(year, month, paint);
        assert.equal(knowledgeOf(key), 'authoritative', 'premise: the first read settled');
        assert.ok(releaseStaleMonths(HOUR, Date.now() + 2 * HOUR).includes(key), 'premise: old enough to be re-read');
        return key;
    }

    test('the re-read is answered by the offline CACHE: the saved copy, the leave kept, one repaint', async () => {
        let paints = 0;
        const key = await readThenExpire(2051, 2, () => { paints++; });
        _getDocsFromCacheFlag = true; _mockDocs = [];   // no signal: an empty subset from this device's cache
        await ensureOverridesCached(2051, 2, () => { paints++; });
        assert.equal(knowledgeOf(key), 'cached', 'the month is no longer current');
        assert.equal(decideDisplay(knowledgeOf(key)), 'stale', 'the grid is kept — as the labelled saved copy');
        assert.equal(rosterOverridesCache.get('A. Smith|2051-03-10')?.value, 'AL', 'and the leave already held is still there');
        assert.equal(paints, 2, 'the failure repaints once, or the label never reaches the screen');
    });

    test('the network REJECTS the re-read: the same saved copy, not the failure panel', async () => {
        const key = await readThenExpire(2052, 2);
        _getDocsThrows = true;
        await ensureOverridesCached(2052, 2, () => {});
        assert.equal(knowledgeOf(key), 'cached');
        assert.equal(rosterOverridesCache.get('A. Smith|2052-03-10')?.value, 'AL');
    });

    test('the next read that succeeds makes the month current again', async () => {
        const key = await readThenExpire(2053, 2);
        _getDocsThrows = true;
        await ensureOverridesCached(2053, 2, () => {});
        assert.equal(knowledgeOf(key), 'cached', 'premise: the re-check failed');
        _getDocsThrows = false; _mockDocs = [];
        let paints = 0;
        await ensureOverridesCached(2053, 2, () => { paints++; });
        assert.equal(knowledgeOf(key), 'authoritative');
        assert.equal(paints, 1, 'and the grid is redrawn without its label');
        assert.equal(rosterOverridesCache.has('A. Smith|2053-03-10'), false, 'the server\'s answer is applied: the leave was cancelled meanwhile');
    });

    test('a failure OLDER than the latest answer does not un-confirm it', async () => {
        // The re-read is slow; another read (the chip's retry covers the same month) is issued after it
        // and lands first. The server has answered since the slow one was asked, so its failure is not
        // news — recording it would label a month "couldn't check" seconds after a check that worked.
        const key = await readThenExpire(2054, 2);
        _deferGetDocs = true;
        const slow = ensureOverridesCached(2054, 2, () => {});
        await _tick();
        assert.equal(_releases.length, 1, 'premise: the re-read is out');
        _deferGetDocs = false;
        _mockDocs = [AL('2054-03-12')];
        await fetchOverridesForRange('2054-03-01', '2054-03-31');   // newer, and it lands
        _releases[0](new Error('simulated: the slow read fails'));
        await slow;
        assert.equal(knowledgeOf(key), 'authoritative', 'a superseded failure walked a freshly confirmed month backwards');
        assert.equal(rosterOverridesCache.get('A. Smith|2054-03-12')?.value, 'AL');
    });

    test('"Try again" while still offline gives the saved copy back, not the failure panel', async () => {
        // The page's retry forgets the month first, so the press visibly does something. A second
        // failure then recorded `error` — and the member lost the grid they had by pressing a button.
        const key = await readThenExpire(2055, 2);
        _getDocsThrows = true;
        await ensureOverridesCached(2055, 2, () => {});
        clearFetchedMonth(key); forgetKnowledge(key);            // what retryMonth does (calendar-app.js)
        assert.equal(knowledgeOf(key), 'unknown', 'premise: forgotten for the retry');
        let paints = 0;
        await ensureOverridesCached(2055, 2, () => { paints++; });
        assert.equal(knowledgeOf(key), 'cached', 'the server\'s earlier answer is still in hand');
        assert.equal(paints, 1, 'and the retry reports its outcome');
    });

    test('a month this device has NEVER read still fails as a failure — there is no copy to label', async () => {
        // The other direction. `cached` over a month nobody read would draw the bare base roster
        // under a label saying it was once checked.
        _getDocsThrows = true;
        await ensureOverridesCached(2056, 2, () => {});
        assert.equal(knowledgeOf(monthKey(2056, 2)), 'error');
    });

    test('the month is asked for again when the page comes back — however recent the failure', async () => {
        // It is already unclaimed, so any render re-reads it; but nothing renders when a phone is
        // simply picked up again, and the label then stayed until somebody pressed Try again.
        const key = await readThenExpire(2057, 2);
        _getDocsThrows = true;
        await ensureOverridesCached(2057, 2, () => {});
        assert.ok(releaseStaleMonths(HOUR, Date.now()).includes(key), 'owed a re-check on return');
        assert.ok(!releaseStaleMonths(HOUR, Date.now()).includes(key), 'handed back once, not on every return');
        _getDocsThrows = false; _mockDocs = [];
        await ensureOverridesCached(2057, 2, () => {});
        assert.equal(knowledgeOf(key), 'authoritative', 'premise: the re-check worked');
        assert.ok(!releaseStaleMonths(HOUR, Date.now()).includes(key), 'a month that is current again is owed nothing');
    });

    test('the read that re-checks a month settles the debt — it is not still owed once it has aged', async () => {
        const key = await readThenExpire(2059, 2);
        _getDocsThrows = true;
        await ensureOverridesCached(2059, 2, () => {});          // the re-check fails: owed
        _getDocsThrows = false;
        await ensureOverridesCached(2059, 2, () => {});          // and this one is the re-check
        const released = releaseStaleMonths(HOUR, Date.now() + 2 * HOUR);
        assert.equal(released.filter(k => k === key).length, 1, 'released once, for its age — not a second time for a debt already paid');
    });

    test('…but only a month with a copy to re-check: a plain failure is not re-read on return', async () => {
        // Its failure panel and its Try again are unchanged; handing it back here would re-read on
        // every return to the page, beside a sync chip that goes on saying the load failed.
        _getDocsThrows = true;
        await ensureOverridesCached(2058, 2, () => {});
        assert.ok(!releaseStaleMonths(HOUR, Date.now()).includes(monthKey(2058, 2)));
    });
});

// ── AN ANSWER BELONGS TO THE GRANT THAT ASKED (10 Nov 2026, external review F2) ─────────────────────
// The access gate was checked when a read was ISSUED, and a read takes time. An answer that landed
// after access had been lost — or lost and granted again — was committed all the same: rows written
// behind the lock card, and a month marked current over the new grant's own failed read. A REFUSAL
// from an earlier grant was already ignored (v24.56); these are the same rule for a success.
describe('an answer belongs to the grant that asked for it', () => {
    beforeEach(() => {
        rosterOverridesCache.clear(); _mockDocs = []; _mockCacheDocs = []; _getDocsThrows = false;
        _deferGetDocs = false; _releases.length = 0; _deferCacheDocs = false; _cacheReleases.length = 0;
        forgetKnowledge();
        setOverrideAccess(true);
    });
    // The module holds the gate process-wide: leave it open for the suites that follow.
    afterEach(() => {
        _deferGetDocs = false; _releases.length = 0; _deferCacheDocs = false; _cacheReleases.length = 0;
        _getDocsThrows = false; _mockCacheDocs = [];
        setOverrideAccess(true);
    });

    const AL = (/** @type {string} */ date) => makeDoc('al-' + date, { memberName: 'A. Smith', date, value: 'AL',
        type: 'annual_leave', note: '', source: 'manual', createdAt: { seconds: 1000 } });

    test('the reported sequence: A is out, access is lost and regained, the new read FAILS, then A lands', async () => {
        const key = monthKey(2061, 2);
        _deferGetDocs = true; _mockDocs = [AL('2061-03-10')];
        let paintsA = 0;
        const a = ensureOverridesCached(2061, 2, () => { paintsA++; });
        await _tick();
        assert.equal(_releases.length, 1, 'premise: A is out');
        setOverrideAccess(false); setOverrideAccess(true);   // re-locked (the shut forgets), then the PIN again
        _deferGetDocs = false; _getDocsThrows = true;
        await ensureOverridesCached(2061, 2, () => {});
        _getDocsThrows = false;
        assert.equal(knowledgeOf(key), 'error', 'premise: the new grant\'s own read failed');

        _releases[0](); await a;
        assert.equal(knowledgeOf(key), 'error', 'the earlier grant\'s answer marked the month current over a failed check');
        assert.equal(rosterOverridesCache.has('A. Smith|2061-03-10'), false, 'and wrote its rows');
        assert.equal(paintsA, 0, 'and repainted for a session that had gone');
    });

    test('A lands while the Calendar is still LOCKED: nothing written, nothing known, nothing painted', async () => {
        const key = monthKey(2062, 2);
        _deferGetDocs = true; _mockDocs = [AL('2062-03-10')];
        let paints = 0;
        const a = ensureOverridesCached(2062, 2, () => { paints++; });
        await _tick();
        setOverrideAccess(false);   // access lost — and nobody has re-entered the PIN
        _releases[0](); await a;
        assert.equal(rosterOverridesCache.size, 0, 'rows were written behind the lock card');
        assert.equal(knowledgeOf(key), 'unknown', 'a discarded answer is not a failure either — it is nothing');
        assert.equal(paints, 0);

        // And the claim it held does not strand the next grant: the month is read again, and lands.
        _deferGetDocs = false;
        setOverrideAccess(true);
        await ensureOverridesCached(2062, 2, () => { paints++; });
        assert.equal(knowledgeOf(key), 'authoritative');
        assert.equal(paints, 1);
    });

    test('a discarded answer is REPORTED as discarded, so no caller can record it as a success', async () => {
        // The first load and the chip's retry call this directly and mark their months current when
        // it returns. Resolving here would hand them a success to record.
        _deferGetDocs = true; _mockDocs = [AL('2063-03-10')];
        const read = fetchOverridesForRange('2063-03-01', '2063-03-31');
        await _tick();
        setOverrideAccess(false);
        _releases[0]();
        await assert.rejects(read, (/** @type {any} */ e) => e.code === READ_SUPERSEDED);
        assert.equal(rosterOverridesCache.size, 0);
    });

    test('an answer the CACHE gave is discarded the same way — that branch merges too', async () => {
        _deferGetDocs = true; _getDocsFromCacheFlag = true; _mockDocs = [AL('2064-03-10')];
        const read = fetchOverridesForRange('2064-03-01', '2064-03-31');
        _getDocsFromCacheFlag = false;
        await _tick();
        setOverrideAccess(false);
        _releases[0]();
        await assert.rejects(read, (/** @type {any} */ e) => e.code === READ_SUPERSEDED,
            'guard: discarded BEFORE the cache-served branch, which would have merged the rows and thrown its own code');
        assert.equal(rosterOverridesCache.size, 0);
    });

    test('a local-CACHE read out when the Calendar locks paints nothing', async () => {
        // Invariant 3's read: a cache hit consults no rule, so this refusal is the only one there is —
        // and it used to be made once, when the read was issued.
        _deferCacheDocs = true; _mockCacheDocs = [AL('2065-03-10')];
        /** @type {string[]} */ const months = [];
        const read = fetchOverridesForRangeFromCache('2065-03-01', '2065-03-31', months);
        await _tick();
        assert.equal(_cacheReleases.length, 1, 'premise: the cache read is out');
        setOverrideAccess(false);
        _cacheReleases[0]();
        assert.equal(await read, false, 'it must report that nothing was painted');
        assert.equal(rosterOverridesCache.size, 0, 'yesterday\'s rows were written behind the lock card');
        assert.deepEqual(months, [], 'and no month may be called known on the strength of them');
    });

    test('…nor does one that lands under a NEWER grant', async () => {
        _deferCacheDocs = true; _mockCacheDocs = [AL('2066-03-10')];
        const read = fetchOverridesForRangeFromCache('2066-03-01', '2066-03-31');
        await _tick();
        setOverrideAccess(false); setOverrideAccess(true);
        _cacheReleases[0]();
        assert.equal(await read, false);
        assert.equal(rosterOverridesCache.size, 0);
    });

    test('the check refuses only what outlived its grant — an answer under its own grant is committed', async () => {
        // The guard for the guard: a check that refused everything would pass every test above.
        _deferGetDocs = true; _mockDocs = [AL('2067-03-10')];
        const a = ensureOverridesCached(2067, 2, () => {});
        await _tick();
        _releases[0](); await a;
        assert.equal(knowledgeOf(monthKey(2067, 2)), 'authoritative');
        assert.equal(rosterOverridesCache.get('A. Smith|2067-03-10')?.value, 'AL');

        _deferGetDocs = false; _deferCacheDocs = true; _mockCacheDocs = [AL('2068-03-10')];
        const cached = fetchOverridesForRangeFromCache('2068-03-01', '2068-03-31');
        await _tick();
        _cacheReleases[0]();
        assert.equal(await cached, true);
        assert.equal(rosterOverridesCache.get('A. Smith|2068-03-10')?.value, 'AL');
    });
});

// ── A month read the SERVER did not answer (v24.48, external audit F1) ─────────────────────────────
// Offline, `getDocs` resolves from this device's cache — a subset, possibly empty — and reconciling it
// authoritatively evicted leave the device already held and marked the month current: a base shift on
// screen with nothing saying it might be wrong.
describe('ensureOverridesCached — a read answered by the offline cache', () => {
    beforeEach(() => { rosterOverridesCache.clear(); _mockDocs = []; _getDocsThrows = false; _getDocsFromCacheFlag = true; });
    afterEach(() => { _getDocsFromCacheFlag = false; });

    test('an EMPTY cache answer keeps the leave already held, and the month is not current', async () => {
        const { knowledgeOf } = await import('./calendar-data-state.js');
        rosterOverridesCache.set('A. Smith|2097-03-10', { value: 'AL', type: 'annual_leave', note: '', source: 'manual', createdAt: { seconds: 5 } });
        await ensureOverridesCached(2097, 2, () => {});
        assert.equal(rosterOverridesCache.get('A. Smith|2097-03-10')?.value, 'AL', 'absence from a cached subset is not a delete');
        // `error`, exactly — invariant 16's "or `error` if it held nothing" (test audit, 7 Nov 2026).
        // This asserted only "not authoritative", so recording every cache answer as `cached` left
        // it green — and a month the cache knew nothing about would be drawn from the base roster
        // under the "saved copy" label instead of earning the failure panel and its Try again.
        assert.equal(knowledgeOf(monthKey(2097, 2)), 'error',
            'a cache answer holding nothing for the month is a failure, not a saved copy');
    });

    test('a cache answer HOLDING records paints them as the labelled last-known grid, and asks again next time', async () => {
        const { knowledgeOf } = await import('./calendar-data-state.js');
        _mockDocs = [makeDoc('c9', { memberName: 'B. Jones', date: '2096-04-02', value: 'AL', type: 'annual_leave', source: 'manual', note: '' })];
        await ensureOverridesCached(2096, 3, () => {});
        assert.equal(rosterOverridesCache.get('B. Jones|2096-04-02')?.value, 'AL');
        assert.equal(knowledgeOf(monthKey(2096, 3)), 'cached');
        // Released: the next visit reaches the server, which here answers properly.
        _getDocsFromCacheFlag = false; _mockDocs = [];
        await ensureOverridesCached(2096, 3, () => {});
        assert.equal(knowledgeOf(monthKey(2096, 3)), 'authoritative');
        assert.equal(rosterOverridesCache.has('B. Jones|2096-04-02'), false, 'the SERVER may evict');
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
        let rendered;
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

    // ONE MONTH CANNOT VOUCH FOR THREE (whole-app review, Oct 2026). The boot window is three
    // months and the boolean answers for all of them, so a single cached month marked a month this
    // device never loaded as known — drawn from the bare base roster, its leave missing.
    test('it names WHICH months held cached rows', async () => {
        _mockCacheDocs = [_cacheDoc('c9', 'G. Miller', '2041-08-10', 'annual_leave', 'AL')];
        const months = /** @type {string[]} */ ([]);
        await fetchOverridesForRangeFromCache('2041-07-01', '2041-09-30', months);
        assert.deepEqual(months, ['2041-08'], 'only the month that held a row is known from the cache');
    });

    test('never throws — a cache miss resolves false instead of reaching the error path', async () => {
        _cacheThrows = true;
        assert.equal(await fetchOverridesForRangeFromCache('2026-08-01', '2026-08-31'), false);
        _cacheThrows = false;
    });
});

// ── A returning member's boot reads the cache ONCE, and for everyone ─────────────────────────
//
// The provisional paint (v22.97, retired 26 Sep 2026 by owner decision — DECISIONS.md) read ONE
// member's rows out of the cache before the grant, and a second, unscoped read had to follow it.
// Both defects it shipped lived in that pair of reads. With it gone a boot makes exactly one cache
// read, over the whole window, after the one grant. Real calendar-overrides + calendar-data-state +
// calendar-initial-fetch; only Firestore is faked.
describe('the initial fetch after a grant', async () => {
    const { initInitialFetch } = await import('./calendar-initial-fetch.js');
    const { knowledgeOf, forget: forgetKnowledge } = await import('./calendar-data-state.js');
    const now   = new Date();
    const pad   = (/** @type {number} */ n) => String(n).padStart(2, '0');
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const thisMonth = monthKey(now.getFullYear(), now.getMonth());
    const _doc = (/** @type {string} */ id, /** @type {string} */ member) => makeDoc(id, {
        memberName: member, date: today, value: 'AL', type: 'annual_leave', source: 'manual', note: '', createdAt: { seconds: 1000 },
    });
    /** @type {any} */ let _savedDoc;

    beforeEach(() => {
        _savedDoc = /** @type {any} */ (globalThis).document;
        /** @type {any} */ (globalThis).document = { getElementById: () => null, querySelector: () => null, addEventListener: () => {}, body: null };
        mock.timers.enable({ apis: ['setTimeout'] });
        rosterOverridesCache.clear();
        forgetKnowledge();
        _mockCacheDocs = [_doc('a', 'A. Member'), _doc('b', 'B. Colleague')];
        _getDocsThrows = false;
        _deferGetDocs = true;          // phase 2's server read stays in flight throughout
        _cacheQueries = [];
    });
    afterEach(() => {
        mock.timers.reset();
        /** @type {any} */ (globalThis).document = _savedDoc;
        _deferGetDocs = false; _releases.length = 0;
        setInitialFetchInProgress(false);
        forgetKnowledge();
        setOverrideAccess(true);       // also releases the months the boot claimed
    });

    test('ONE cache read, unscoped — every member\'s cached rows are loaded, not one member\'s', async () => {
        setOverrideAccess(true);
        const { cacheSettled } = initInitialFetch({ isTeamViewMode: () => false, renderCalendar: () => {}, authReady: Promise.resolve() });
        assert.equal(await cacheSettled, true);
        await _tick(10);
        assert.equal(_cacheQueries.length, 1, 'a boot made more than one cache read — a scoped read and its re-read are back');
        const scoped = _cacheQueries[0].filter((/** @type {any} */ a) => Array.isArray(a?._where) && a._where[0] === 'memberName');
        assert.deepEqual(scoped, [], 'the boot\'s cache read was narrowed to one member');
        assert.equal(rosterOverridesCache.has(`B. Colleague|${today}`), true);
        assert.equal(knowledgeOf(thisMonth), 'cached');
    });
});

// ── ACCESS LOST THROUGH THE FIRST LOAD FORGETS TOO (cal-data-6, 10 Nov 2026) ───────────────────────
// The month read's route shut the gate AND forgot what every month knew; the first load's read and
// its chip's retry reach the coordinator's wrapper, which shut the gate only. So after the next PIN
// a month read under the old grant was drawn as current — and stayed current, "As rostered" included,
// when the new grant's own read failed. Driven through the REAL chip retry; the wrapper is modelled by
// the one step of it that touches this state, `setOverrideAccess(false)` (calendar-app.js).
describe('losing access through the first load\'s chip forgets what the old grant knew', async () => {
    const { initInitialFetch } = await import('./calendar-initial-fetch.js');
    const { hasOverrideAccess } = await import('./calendar-overrides.js');
    const now = new Date();
    const thisMonth = monthKey(now.getFullYear(), now.getMonth());
    // A month the member navigates to, well outside the first load's three.
    const far = { y: now.getMonth() + 4 > 11 ? now.getFullYear() + 1 : now.getFullYear(), m: (now.getMonth() + 4) % 12 };
    const farMonth = monthKey(far.y, far.m);
    const AL = (/** @type {string} */ date) => makeDoc('al-' + date, { memberName: 'A. Smith', date, value: 'AL',
        type: 'annual_leave', note: '', source: 'manual', createdAt: { seconds: 1000 } });
    const OFFLINE = () => Object.assign(new Error('offline'), { code: 'unavailable' });
    const DENIED  = () => Object.assign(new Error('denied'), { code: 'permission-denied' });
    /** @type {any} */ let savedDoc;
    /** @type {any[]} */ let headerKids;

    beforeEach(() => {
        savedDoc = /** @type {any} */ (globalThis).document;
        headerKids = [];
        const header = { appendChild(/** @type {any} */ c) { headerKids.push(c); c.isConnected = true; return c; } };
        /** @type {any} */ (globalThis).document = {
            getElementById: () => null,
            querySelector: (/** @type {string} */ sel) => (sel === '.calendar-header' ? header : null),
            createElement: (/** @type {string} */ tag) => ({ tag, type: '', className: '', textContent: '', disabled: false, onclick: null,
                isConnected: false, setAttribute() {}, remove() { this.isConnected = false; }, focus() {} }),
            addEventListener: () => {}, body: null,
        };
        mock.timers.enable({ apis: ['setTimeout'] });
        rosterOverridesCache.clear(); forgetKnowledge();
        _mockDocs = []; _getDocsThrows = false; _deferGetDocs = true; _releases.length = 0;
    });
    afterEach(() => {
        mock.timers.reset();
        /** @type {any} */ (globalThis).document = savedDoc;
        _deferGetDocs = false; _releases.length = 0; _mockCacheDocs = []; _mockDocs = [];
        setInitialFetchInProgress(false);
        forgetKnowledge();
        setOverrideAccess(true);
    });

    test('the chip\'s retry is refused, the Calendar re-locks, the PIN again — and the new grant\'s read fails', async () => {
        const chip = () => headerKids.find(k => k.tag === 'button' && k.isConnected);
        _mockCacheDocs = [AL(`${thisMonth}-10`)];   // the device holds this month: phase 1 paints it
        setOverrideAccess(true);
        initInitialFetch({ isTeamViewMode: () => false, renderCalendar: () => {}, authReady: Promise.resolve(),
            onAccessLost: () => setOverrideAccess(false) });
        await _tick(30);
        assert.equal(knowledgeOf(thisMonth), 'cached', 'premise: the first load painted the saved copy');
        _releases.shift()?.(OFFLINE());   // …and its server read failed on the network
        await _tick(30);
        assert.ok(chip()?.className.includes('sync-chip-error'), 'premise: the chip offers the retry');

        _mockDocs = [AL(`${farMonth}-10`)];   // the member moves on to a month that loads
        const nav = ensureOverridesCached(far.y, far.m, () => {});
        await _tick(); _releases.shift()?.(); await nav;
        assert.equal(knowledgeOf(farMonth), 'authoritative', 'premise: that month is current');

        chip().onclick();                     // the PIN has been rotated; somebody presses the chip
        await _tick(30);
        _releases.shift()?.(DENIED());
        await _tick(30);
        assert.equal(hasOverrideAccess(), false, 'premise: the refusal re-locked the Calendar');
        assert.deepEqual([knowledgeOf(thisMonth), knowledgeOf(farMonth)], ['unknown', 'unknown'],
            'what the old grant knew survived the lock');

        setOverrideAccess(true);              // the new PIN
        _mockDocs = [];
        const again = ensureOverridesCached(far.y, far.m, () => {});
        await _tick(); _releases.shift()?.(OFFLINE()); await again;
        assert.equal(knowledgeOf(farMonth), 'error',
            'the old grant\'s month was drawn as current by the new one, over its own failed read');
    });
});
