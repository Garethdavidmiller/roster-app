import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PILL_TYPES } from './admin-shift-types.js';
import { tsToMillis, shouldReplaceOverride, reconcileRangeIntoCache, isBeforeMemberStart, isRestShift, computePeriodDeleteIds,
         OTHER_FLAVOURS, OTHER_RDW_DEFAULT_MINS, isOtherValue, parseOtherValue, composeOtherValue, resolveOtherPay,
         isOverrideDisplaySuppressed, mergeBookedPeriods, resolveEffectiveShift, toOverrideRecord,
         buildOverrideWrite, buildOverrideCacheRecord, collectOverrideRecords, SUNDAY_FORBIDDEN_TYPES, isForbiddenOnSunday, sundaySafeValue,
         CONTRACTED_WORK_TYPES, VOLUNTARY_WORK_TYPES, isContractedWorkOverride, nextReplacedType, manualCellValue } from './override-utils.js';

/** Build a fake Firestore QuerySnapshot from an array of {id, ...data} rows. */
function fakeSnapshot(rows) {
    return { forEach: (/** @type {any} */ cb) => rows.forEach(r => cb({ id: r.id, data: () => r.data })) };
}

// ── collectOverrideRecords (shared cache-feeder collector) ─────────────────────

describe('collectOverrideRecords', () => {
    it('maps valid docs to {memberName, date, record} with toOverrideRecord defaults', () => {
        const recs = collectOverrideRecords(fakeSnapshot([
            { id: 'a', data: { memberName: 'G. Miller', date: '2026-06-01', value: 'AL', type: 'annual_leave', source: 'manual', createdAt: { seconds: 1 } } },
        ]));
        assert.equal(recs.length, 1);
        assert.deepEqual(recs[0], {
            memberName: 'G. Miller', date: '2026-06-01',
            record: { value: 'AL', note: '', type: 'annual_leave', source: 'manual', createdAt: { seconds: 1 } },
        });
    });

    it('skips docs missing memberName, date, or value', () => {
        const recs = collectOverrideRecords(fakeSnapshot([
            { id: 'noMember', data: { date: '2026-06-01', value: 'AL' } },
            { id: 'noDate',   data: { memberName: 'A', value: 'AL' } },
            { id: 'noValue',  data: { memberName: 'A', date: '2026-06-01' } },
            { id: 'ok',       data: { memberName: 'A', date: '2026-06-02', value: 'RD', type: 'correction' } },
        ]));
        assert.equal(recs.length, 1);
        assert.equal(recs[0].date, '2026-06-02');
    });

    it('returns an empty array for an empty snapshot', () => {
        assert.deepEqual(collectOverrideRecords(fakeSnapshot([])), []);
    });
});

// ── isBeforeMemberStart ───────────────────────────────────────────────────────

describe('isBeforeMemberStart', () => {
    it('returns false when member has no startDate', () => {
        assert.equal(isBeforeMemberStart({}, new Date(2026, 4, 1)), false);
    });

    it('returns true for a date strictly before startDate', () => {
        const member = { startDate: new Date(2026, 3, 20) }; // Apr 20
        assert.equal(isBeforeMemberStart(member, new Date(2026, 3, 19)), true);
    });

    it('returns false on the startDate itself (midnight)', () => {
        const member = { startDate: new Date(2026, 3, 20) };
        assert.equal(isBeforeMemberStart(member, new Date(2026, 3, 20)), false);
    });

    it('returns false for a date after startDate', () => {
        const member = { startDate: new Date(2026, 3, 20) };
        assert.equal(isBeforeMemberStart(member, new Date(2026, 4, 1)), false);
    });
});

// ── tsToMillis ────────────────────────────────────────────────────────────────

describe('tsToMillis', () => {
    it('returns 0 for null', () => {
        assert.equal(tsToMillis(null), 0);
    });

    it('calls .toMillis() on a Firestore Timestamp object', () => {
        const ts = { toMillis: () => 1_700_000_000_000 };
        assert.equal(tsToMillis(ts), 1_700_000_000_000);
    });

    it('converts plain {seconds} object to milliseconds', () => {
        assert.equal(tsToMillis({ seconds: 1_700_000 }), 1_700_000_000);
    });

    it('returns 0 for an unrecognised shape', () => {
        assert.equal(tsToMillis({ nanoseconds: 123 }), 0);
    });

    it('prefers .toMillis() over .seconds when both are present', () => {
        const ts = { toMillis: () => 999, seconds: 1_000_000 };
        assert.equal(tsToMillis(ts), 999);
    });
});

// ── shouldReplaceOverride ─────────────────────────────────────────────────────

describe('shouldReplaceOverride', () => {
    it('returns true when there is no existing entry', () => {
        assert.equal(shouldReplaceOverride(undefined, { source: 'roster_import' }), true);
        assert.equal(shouldReplaceOverride(null,      {}), true);
    });

    it('manual incoming always beats roster_import existing', () => {
        const existing = { source: 'roster_import', createdAt: { seconds: 2000 } };
        const incoming = { source: '',              createdAt: { seconds: 1000 } }; // older but manual
        assert.equal(shouldReplaceOverride(existing, incoming), true);
    });

    it('roster_import incoming cannot beat manual existing', () => {
        const existing = { source: '',              createdAt: { seconds: 1000 } };
        const incoming = { source: 'roster_import', createdAt: { seconds: 9999 } }; // newer but import
        assert.equal(shouldReplaceOverride(existing, incoming), false);
    });

    it('among two roster_import entries, newer createdAt wins', () => {
        const existing = { source: 'roster_import', createdAt: { seconds: 1000 } };
        const newer    = { source: 'roster_import', createdAt: { seconds: 2000 } };
        const older    = { source: 'roster_import', createdAt: { seconds:  500 } };
        assert.equal(shouldReplaceOverride(existing, newer), true);
        assert.equal(shouldReplaceOverride(existing, older), false);
    });

    it('equal timestamps — incoming replaces existing (>= rule)', () => {
        const ts = { toMillis: () => 1_000 };
        const existing = { source: '', createdAt: ts };
        const incoming = { source: '', createdAt: ts };
        assert.equal(shouldReplaceOverride(existing, incoming), true);
    });

    it('handles null createdAt gracefully (treated as 0)', () => {
        const existing = { source: 'roster_import', createdAt: null };
        const incoming = { source: 'roster_import', createdAt: null };
        // both 0 → equal → incoming wins via >= rule
        assert.equal(shouldReplaceOverride(existing, incoming), true);
    });

    it('handles missing createdAt gracefully', () => {
        const existing = { source: 'roster_import' };
        const incoming = { source: 'roster_import', createdAt: { seconds: 1000 } };
        assert.equal(shouldReplaceOverride(existing, incoming), true);
    });

    it('uses .toMillis() on Firestore Timestamp objects for comparison', () => {
        const existing = { source: '', createdAt: { toMillis: () => 5000 } };
        const incoming = { source: '', createdAt: { toMillis: () => 6000 } };
        assert.equal(shouldReplaceOverride(existing, incoming), true);
    });
});

// ── reconcileRangeIntoCache (authoritative range refresh — Finding #1) ─────────

describe('reconcileRangeIntoCache', () => {
    const rec = (value, source, seconds, extra = {}) =>
        ({ type: 'shift', value, note: '', source, createdAt: { seconds }, ...extra });
    const row = (memberName, date, r) => ({ memberName, date, record: r });

    it('a cached MANUAL deleted in Firestore, snapshot has only a lower-priority import → import wins', () => {
        // The exact Finding #1 bug: the old merge kept the deleted manual (import can't out-rank it),
        // yet the key was "seen" so the deletion pass skipped it. Reconcile rebuilds from the snapshot.
        const cache = new Map([['G. Miller|2026-08-10', rec('06:00-14:00', '', 100)]]);
        const importRec = rec('07:00-15:00', 'roster_import', 200);
        const changed = reconcileRangeIntoCache(cache, [row('G. Miller', '2026-08-10', importRec)],
            '2026-08-10', '2026-08-16');
        assert.equal(cache.get('G. Miller|2026-08-10'), importRec, 'the import is now authoritative');
        assert.equal(changed, true, 'the visible shift changed');
    });

    // ── authoritative:false — the E1 cache-phase contract (AUTH_PLAN.md → E1) ──
    // A local-cache read returns a possibly-stale SUBSET, so it must merge but never evict. If it
    // evicted, it would be a second authoritative reconciler racing the server read on the same
    // range — the v18.76 Team View bug, where the staler snapshot wiped the grid to base roster.

    it('authoritative:false does NOT evict an in-range key the snapshot omits', () => {
        const live = rec('06:00-14:00', '', 100);
        const cache = new Map([
            ['G. Miller|2026-08-10', live],                            // omitted by the snapshot
            ['S. Silva|2026-08-11',  rec('07:00-15:00', '', 100)],     // also omitted
        ]);
        const changed = reconcileRangeIntoCache(cache, [], '2026-08-10', '2026-08-16',
            { authoritative: false });
        assert.equal(cache.get('G. Miller|2026-08-10'), live, 'a stale cache subset must not delete live data');
        assert.equal(cache.size, 2, 'nothing evicted');
        assert.equal(changed, false, 'no display change to report');
    });

    it('authoritative:false still MERGES what the snapshot does carry', () => {
        const cache = new Map();
        const r = rec('06:00-14:00', '', 100);
        const changed = reconcileRangeIntoCache(cache, [row('G. Miller', '2026-08-10', r)],
            '2026-08-10', '2026-08-16', { authoritative: false });
        assert.equal(cache.get('G. Miller|2026-08-10'), r, 'the additive half still applies');
        assert.equal(changed, true);
    });

    it('the default is authoritative — omitting opts still evicts (the server-read contract)', () => {
        const cache = new Map([['G. Miller|2026-08-10', rec('06:00-14:00', '', 100)]]);
        const changed = reconcileRangeIntoCache(cache, [], '2026-08-10', '2026-08-16');
        assert.equal(cache.size, 0, 'a server snapshot omitting a key IS a delete');
        assert.equal(changed, true);
    });

    it('a cached NEWER import gone, snapshot has only an OLDER import → the older import wins', () => {
        const cache = new Map([['G. Miller|2026-08-11', rec('07:00-15:00', 'roster_import', 500)]]);
        const older = rec('08:00-16:00', 'roster_import', 100);
        reconcileRangeIntoCache(cache, [row('G. Miller', '2026-08-11', older)], '2026-08-10', '2026-08-16');
        assert.equal(cache.get('G. Miller|2026-08-11'), older, 'the snapshot is authoritative, not the newer cached copy');
    });

    it('a snapshot with manual + import duplicates for one date → manual wins regardless of order', () => {
        const manual = rec('06:00-14:00', '', 50);
        const importA = rec('06:00-14:00', 'roster_import', 100);
        const importB = rec('06:00-14:00', 'roster_import', 200);
        for (const order of [[importA, manual, importB], [importB, importA, manual], [manual, importA, importB]]) {
            const cache = new Map();
            reconcileRangeIntoCache(cache, order.map(r => row('G. Miller', '2026-08-21', r)),
                '2026-08-20', '2026-08-26');
            assert.equal(cache.get('G. Miller|2026-08-21'), manual, `manual wins for order ${order.map(r => r.source || 'manual')}`);
        }
    });

    it('entries OUTSIDE the queried range are left untouched', () => {
        const outside = rec('06:00-14:00', '', 100);
        const cache = new Map([['G. Miller|2026-07-01', outside]]);
        reconcileRangeIntoCache(cache, [], '2026-08-10', '2026-08-16');
        assert.equal(cache.get('G. Miller|2026-07-01'), outside, 'a date before the range survives an empty snapshot');
    });

    it('an in-range key the snapshot omits entirely is evicted (a genuine delete)', () => {
        const cache = new Map([['G. Miller|2026-08-12', rec('06:00-14:00', '', 100)]]);
        const changed = reconcileRangeIntoCache(cache, [], '2026-08-10', '2026-08-16');
        assert.equal(cache.has('G. Miller|2026-08-12'), false);
        assert.equal(changed, true);
    });

    it('a same-VALUE higher-priority winner updates the cache but reports NO display change', () => {
        const cache = new Map([['G. Miller|2026-08-13', rec('06:00-14:00', 'roster_import', 100)]]);
        const manual = rec('06:00-14:00', '', 50);
        const changed = reconcileRangeIntoCache(cache, [row('G. Miller', '2026-08-13', manual)],
            '2026-08-10', '2026-08-16');
        assert.equal(cache.get('G. Miller|2026-08-13'), manual, 'winner metadata is stored');
        assert.equal(changed, false, 'the visible shift is identical → no repaint');
    });

    it('an unchanged in-range record reports no display change', () => {
        const same = rec('06:00-14:00', '', 100);
        const cache = new Map([['G. Miller|2026-08-14', same]]);
        const changed = reconcileRangeIntoCache(cache, [row('G. Miller', '2026-08-14', rec('06:00-14:00', '', 100))],
            '2026-08-10', '2026-08-16');
        assert.equal(changed, false);
    });
});

// ── isRestShift ───────────────────────────────────────────────────────────────

describe('isRestShift', () => {
    it('returns true for RD', () => {
        assert.equal(isRestShift('RD'), true);
    });

    it('returns true for OFF (bilingual rest)', () => {
        assert.equal(isRestShift('OFF'), true);
    });

    it('returns false for a worked shift', () => {
        assert.equal(isRestShift('09:00-17:00'), false);
    });

    it('returns false for SPARE', () => {
        assert.equal(isRestShift('SPARE'), false);
    });

    it('returns false for AL', () => {
        assert.equal(isRestShift('AL'), false);
    });

    it('returns false for SICK', () => {
        assert.equal(isRestShift('SICK'), false);
    });

    it('returns false for RDW', () => {
        assert.equal(isRestShift('RDW'), false);
    });

    it('returns false for empty string', () => {
        assert.equal(isRestShift(''), false);
    });
});

// ── isOverrideDisplaySuppressed ───────────────────────────────────────────────

describe('isOverrideDisplaySuppressed', () => {
    // sick: suppressed on a rest-day base OR any Sunday
    it('suppresses sick on a rest-day base (RD), any weekday', () => {
        assert.equal(isOverrideDisplaySuppressed({ type: 'sick' }, 'RD', false), true);
    });
    it('suppresses sick on an OFF base', () => {
        assert.equal(isOverrideDisplaySuppressed({ type: 'sick' }, 'OFF', false), true);
    });
    it('suppresses sick on ANY Sunday even with a worked base', () => {
        assert.equal(isOverrideDisplaySuppressed({ type: 'sick' }, '09:00-17:00', true), true);
    });
    it('does NOT suppress sick on a worked weekday base', () => {
        assert.equal(isOverrideDisplaySuppressed({ type: 'sick' }, '09:00-17:00', false), false);
    });

    // annual_leave + other: suppressed on any Sunday only
    it('suppresses annual_leave on a Sunday (legacy backstop)', () => {
        assert.equal(isOverrideDisplaySuppressed({ type: 'annual_leave' }, 'RD', true), true);
    });
    it('does NOT suppress annual_leave on a weekday', () => {
        assert.equal(isOverrideDisplaySuppressed({ type: 'annual_leave' }, '09:00-17:00', false), false);
    });
    it('suppresses Other-family on a Sunday', () => {
        assert.equal(isOverrideDisplaySuppressed({ type: 'other' }, '09:00-17:00', true), true);
    });
    it('does NOT suppress Other-family on a weekday', () => {
        assert.equal(isOverrideDisplaySuppressed({ type: 'other' }, 'RD', false), false);
    });

    // never suppressed
    for (const type of ['rdw', 'correction', 'spare_shift', 'shift']) {
        it(`never suppresses ${type} (even on a Sunday rest-day base)`, () => {
            assert.equal(isOverrideDisplaySuppressed({ type }, 'RD', true), false);
        });
    }
});

// ── mergeBookedPeriods ────────────────────────────────────────────────────────

describe('mergeBookedPeriods', () => {
    // Local-component +1 day (midday anchor → TZ-safe), matching admin-app's _addDays/formatISO.
    const addDay = (/** @type {string} */ d) => {
        const dt = new Date(d + 'T12:00:00'); dt.setDate(dt.getDate() + 1);
        return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    };
    const noGaps = () => false;

    it('empty list → []', () => {
        assert.deepEqual(mergeBookedPeriods([], noGaps, addDay), []);
    });

    it('single date → one period, count 1', () => {
        assert.deepEqual(mergeBookedPeriods(['2026-06-15'], noGaps, addDay),
            [{ start: '2026-06-15', end: '2026-06-15', count: 1 }]);
    });

    it('consecutive days merge into one period', () => {
        assert.deepEqual(mergeBookedPeriods(['2026-06-15', '2026-06-16', '2026-06-17'], noGaps, addDay),
            [{ start: '2026-06-15', end: '2026-06-17', count: 3 }]);
    });

    it('a rest-gap between two dates merges them (Fri + Mon across a weekend)', () => {
        const rest = new Set(['2026-06-20', '2026-06-21']);   // Sat + Sun
        assert.deepEqual(mergeBookedPeriods(['2026-06-19', '2026-06-22'], d => rest.has(d), addDay),
            [{ start: '2026-06-19', end: '2026-06-22', count: 2 }]);
    });

    it('a NON-rest (worked) day in the gap splits into two periods', () => {
        assert.deepEqual(mergeBookedPeriods(['2026-06-15', '2026-06-17'], noGaps, addDay),
            [{ start: '2026-06-15', end: '2026-06-15', count: 1 },
             { start: '2026-06-17', end: '2026-06-17', count: 1 }]);
    });

    it('mixed: a merged pair then a split single', () => {
        assert.deepEqual(mergeBookedPeriods(['2026-06-15', '2026-06-16', '2026-06-18'], noGaps, addDay),
            [{ start: '2026-06-15', end: '2026-06-16', count: 2 },
             { start: '2026-06-18', end: '2026-06-18', count: 1 }]);
    });
});

// ── computePeriodDeleteIds ────────────────────────────────────────────────────

describe('computePeriodDeleteIds', () => {
    const M = 'G. Miller';
    // 2026-06-21 is a Sunday (2026-06-28 is the known Sunday in this roster cycle);
    // 2026-06-20 is the Saturday before, 2026-06-22 the Monday after.
    const range1AL = [
        { id: 'a15', memberName: M, date: '2026-06-15', type: 'annual_leave', value: 'AL' },
        { id: 'a16', memberName: M, date: '2026-06-16', type: 'annual_leave', value: 'AL' },
        { id: 'a20', memberName: M, date: '2026-06-20', type: 'annual_leave', value: 'AL' },
    ];
    const sunCorrection = { id: 'c21', memberName: M, date: '2026-06-21', type: 'correction', value: 'RD' };
    const params = { type: 'annual_leave', memberName: M, start: '2026-06-15', end: '2026-06-21' };

    it('non-overlap: deletes the leave days AND the Sunday correction', () => {
        const ids = computePeriodDeleteIds([...range1AL, sunCorrection], params);
        assert.deepEqual(new Set(ids), new Set(['a15', 'a16', 'a20', 'c21']));
    });

    it('overlapping same-type ranges keep the shared Sunday correction', () => {
        // A second AL range [Sun 21 .. Fri 26] leaves AL on Mon 22 — adjacent to the Sunday.
        const range2AL = [
            { id: 'b22', memberName: M, date: '2026-06-22', type: 'annual_leave', value: 'AL' },
            { id: 'b23', memberName: M, date: '2026-06-23', type: 'annual_leave', value: 'AL' },
        ];
        const ids = computePeriodDeleteIds([...range1AL, sunCorrection, ...range2AL], params);
        assert.ok(!ids.includes('c21'), 'shared Sunday correction must be kept for the remaining range');
        assert.deepEqual(new Set(ids), new Set(['a15', 'a16', 'a20']));
    });

    it('overlapping cross-type (AL + adjacent sick) keeps the shared Sunday correction', () => {
        const sickAdjacent = { id: 's22', memberName: M, date: '2026-06-22', type: 'sick', value: 'SICK' };
        const ids = computePeriodDeleteIds([...range1AL, sunCorrection, sickAdjacent], params);
        assert.ok(!ids.includes('c21'), 'correction kept because an adjacent sick override remains');
    });

    it('keeps the shared Sunday correction when the surviving range reaches it only via Friday (Saturday is base-RD)', () => {
        // Delete range A = [Sun 21 .. Wed 24] (leave Mon–Wed). A surviving range B ends on the same
        // Sunday but its Saturday (20th) is a base rest day, so B's nearest surviving leave is Fri 19
        // — two days before the Sunday. A ±1 check would miss it and wrongly delete the shared
        // correction, resurrecting the worked Sunday shift mid-leave.
        const rangeA = [
            { id: 'a22', memberName: M, date: '2026-06-22', type: 'annual_leave', value: 'AL' },
            { id: 'a23', memberName: M, date: '2026-06-23', type: 'annual_leave', value: 'AL' },
            { id: 'a24', memberName: M, date: '2026-06-24', type: 'annual_leave', value: 'AL' },
        ];
        const rangeBFriday = [
            { id: 'b18', memberName: M, date: '2026-06-18', type: 'annual_leave', value: 'AL' },
            { id: 'b19', memberName: M, date: '2026-06-19', type: 'annual_leave', value: 'AL' }, // Fri — Sat 20 is base-RD, no leave
        ];
        const ids = computePeriodDeleteIds(
            [...rangeA, ...rangeBFriday, sunCorrection],
            { type: 'annual_leave', memberName: M, start: '2026-06-21', end: '2026-06-24' });
        assert.ok(!ids.includes('c21'), 'shared Sunday correction must survive — range B still spans it via Friday');
        assert.deepEqual(new Set(ids), new Set(['a22', 'a23', 'a24']));
    });

    it('ignores other members and out-of-range dates', () => {
        const all = [
            ...range1AL,
            { id: 'x', memberName: 'S. Silva', date: '2026-06-16', type: 'annual_leave', value: 'AL' },
            { id: 'y', memberName: M, date: '2026-07-01', type: 'annual_leave', value: 'AL' },
        ];
        const ids = computePeriodDeleteIds(all, params);
        assert.ok(!ids.includes('x') && !ids.includes('y'));
        assert.deepEqual(new Set(ids), new Set(['a15', 'a16', 'a20']));
    });

    it('returns empty when nothing matches', () => {
        assert.deepEqual(computePeriodDeleteIds([sunCorrection], { type: 'annual_leave', memberName: 'Nobody', start: '2026-06-15', end: '2026-06-21' }), []);
    });
});

// ── Training grammar + pay resolution (OTHER_PLAN.md) ─────────────────────

describe('isOtherValue / parseOtherValue — value grammar', () => {
    it('accepts every flavour, bare', () => {
        for (const f of ['TRG', 'IND', 'ASSESS', 'TEAM', 'UNION', 'MEET']) {
            assert.equal(isOtherValue(f), true, f);
            assert.deepEqual(parseOtherValue(f), { flavour: f, rdw: false, time: null });
        }
    });

    it('accepts the RDW marker', () => {
        assert.deepEqual(parseOtherValue('TRG RDW'),    { flavour: 'TRG',    rdw: true, time: null });
        assert.deepEqual(parseOtherValue('ASSESS RDW'), { flavour: 'ASSESS', rdw: true, time: null });
        assert.deepEqual(parseOtherValue('TEAM RDW'),   { flavour: 'TEAM',   rdw: true, time: null });
        assert.deepEqual(parseOtherValue('UNION RDW'),  { flavour: 'UNION',  rdw: true, time: null });
    });

    it('accepts actual times, with and without RDW', () => {
        assert.deepEqual(parseOtherValue('IND 08:00-16:00'),     { flavour: 'IND', rdw: false, time: '08:00-16:00' });
        assert.deepEqual(parseOtherValue('TRG RDW 08:00-16:00'), { flavour: 'TRG', rdw: true,  time: '08:00-16:00' });
    });

    it('rejects non-training values, malformed grammar, and impossible times', () => {
        // 'TEAM DAY' is the ROSTER label; the stored value is always the single-token 'TEAM'
        // (the parser converts "Team Day" → "TEAM"), so 'TEAM DAY' is not a valid stored value.
        for (const v of ['RD', 'SPARE', 'AL', 'SICK', 'RDW', '06:00-14:00', 'RDW TRG',
                         'TRAINING', 'trg', 'TRG BAD', 'TRGRDW', 'TRG  RDW', 'ASS', 'TEAM DAY',
                         'TRG 25:00-30:00', 'TRG RDW 08:00', '', null, undefined, 42]) {
            assert.equal(isOtherValue(v), false, String(v));
            assert.equal(parseOtherValue(v), null, String(v));
        }
    });

    it('flavour labels carry both the badge word and the full tap word', () => {
        assert.equal(OTHER_FLAVOURS.TRG.badge,    'Train');
        assert.equal(OTHER_FLAVOURS.TRG.full,     'Training');
        assert.equal(OTHER_FLAVOURS.IND.badge,    'Ind');
        assert.equal(OTHER_FLAVOURS.IND.full,     'Induction');
        assert.equal(OTHER_FLAVOURS.ASSESS.badge, 'Assess');
        assert.equal(OTHER_FLAVOURS.ASSESS.full,  'Assessment');
        assert.equal(OTHER_FLAVOURS.TEAM.badge,   'Team');
        assert.equal(OTHER_FLAVOURS.TEAM.full,    'Team Day');
        assert.equal(OTHER_FLAVOURS.UNION.badge,  'Union');
        assert.equal(OTHER_FLAVOURS.UNION.full,   'Union');
    });
});

describe('resolveOtherPay — the pay mapping (single source)', () => {
    const parse = (v) => {
        const p = parseOtherValue(v);
        assert.ok(p, `expected training value: ${v}`);
        return p;
    };

    it('rostered day, no times → as-base (pays exactly as the base shift, never less)', () => {
        assert.deepEqual(resolveOtherPay(parse('TRG'), '06:00-14:00'), { mode: 'as-base' });
        assert.deepEqual(resolveOtherPay(parse('ASSESS'), '12:00-19:00'), { mode: 'as-base' });
        // A union course pays exactly like the day underneath, same as every Other flavour.
        assert.deepEqual(resolveOtherPay(parse('UNION'), '09:00-16:00'), { mode: 'as-base' });
    });

    it('rostered day, actual times → timed (engine applies the base-cap + excess→OT split)', () => {
        assert.deepEqual(resolveOtherPay(parse('TRG 08:00-18:00'), '06:00-14:00'),
            { mode: 'timed', time: '08:00-18:00' });
    });

    it('explicit RDW, no times → rdw with the 8h default', () => {
        assert.deepEqual(resolveOtherPay(parse('TRG RDW'), 'RD'),
            { mode: 'rdw', mins: OTHER_RDW_DEFAULT_MINS });
        assert.equal(OTHER_RDW_DEFAULT_MINS, 480, 'default is 8 hours (confirmed by Gareth)');
    });

    it('explicit RDW with actual times → rdw with the actual duration (never split into OT)', () => {
        assert.deepEqual(resolveOtherPay(parse('TRG RDW 08:00-18:00'), 'RD'),
            { mode: 'rdw', mins: 600 });
    });

    it('RDW duration wraps overnight ranges', () => {
        assert.deepEqual(resolveOtherPay(parse('TRG RDW 22:00-06:00'), 'RD'),
            { mode: 'rdw', mins: 480 });
    });

    it('belt-and-braces: base is a rest day but the RDW flag is missing → still rdw', () => {
        // The roster marks rest-day training explicitly ("TRG RDW"), but if the flag is
        // ever missing while the base is RD/OFF, as-base would pay ZERO hours — so the
        // resolver derives rdw-ness from the base as a defensive layer.
        assert.deepEqual(resolveOtherPay(parse('TRG'), 'RD'),
            { mode: 'rdw', mins: OTHER_RDW_DEFAULT_MINS });
        assert.deepEqual(resolveOtherPay(parse('IND'), 'OFF'),
            { mode: 'rdw', mins: OTHER_RDW_DEFAULT_MINS });
    });

    it('spare-week training is NOT rdw — SPARE is not a rest day (contracted day, as-base)', () => {
        assert.deepEqual(resolveOtherPay(parse('TRG'), 'SPARE'), { mode: 'as-base' });
    });
});

describe('resolveEffectiveShift — the shared display ladder (single source for 3 consumers)', () => {
    it('no override → keeps the base shift, no rdwTime/derivedRdw/note', () => {
        assert.deepEqual(resolveEffectiveShift(null, '06:00-14:00', false),
            { shift: '06:00-14:00', rdwTime: '', derivedRdw: false, note: '' });
    });

    it('suppressed overrides keep the base (sick on rest/Sunday, AL/Other on Sunday)', () => {
        assert.equal(resolveEffectiveShift({ type: 'sick', value: 'SICK' }, 'RD', false).shift, 'RD');
        assert.equal(resolveEffectiveShift({ type: 'sick', value: 'SICK' }, '06:00-14:00', true).shift, '06:00-14:00');
        assert.equal(resolveEffectiveShift({ type: 'annual_leave', value: 'AL' }, '06:00-14:00', true).shift, '06:00-14:00');
        assert.equal(resolveEffectiveShift({ type: 'other', value: 'TRG' }, '06:00-14:00', true).shift, '06:00-14:00');
    });

    it('sick on a WORKED weekday is NOT suppressed → resolves to SICK', () => {
        assert.equal(resolveEffectiveShift({ type: 'sick', value: 'SICK' }, '06:00-14:00', false).shift, 'SICK');
    });

    it('rdw → shift "RDW" with the time carried in rdwTime (not the pipe form)', () => {
        assert.deepEqual(resolveEffectiveShift({ type: 'rdw', value: '09:00-17:00', note: 'ot' }, 'RD', false),
            { shift: 'RDW', rdwTime: '09:00-17:00', derivedRdw: false, note: 'ot' });
    });

    it('a TIMED worked-type override on a SUNDAY displays as RDW, not a plain shift (legacy-data coercion)', () => {
        // A worked Sunday is always RDW (Sundays are uncontracted); new creation is blocked at every
        // write path, but a legacy shift/allocated/overtime/swap doc on a Sunday must still DISPLAY as
        // RDW — matching the creation invariant and the 1.5× pay routing.
        for (const type of ['shift', 'allocated', 'overtime', 'swap']) {
            const r = resolveEffectiveShift({ type, value: '09:00-17:00', note: 'n' }, 'RD', true);
            assert.deepEqual(r, { shift: 'RDW', rdwTime: '09:00-17:00', derivedRdw: true, note: 'n' },
                `${type} on a Sunday should resolve to RDW`);
        }
    });

    it('the same worked-type override on a NON-Sunday keeps its plain shift value (no coercion off-Sunday)', () => {
        assert.equal(resolveEffectiveShift({ type: 'shift', value: '09:00-17:00' }, 'RD', false).shift, '09:00-17:00');
    });

    it('a NON-timed worked-type override on a Sunday is NOT coerced (falls through to its raw value)', () => {
        assert.equal(resolveEffectiveShift({ type: 'shift', value: 'SPARE' }, 'RD', true).shift, 'SPARE');
    });

    it('annual_leave / correction / spare_shift resolve via their value', () => {
        assert.equal(resolveEffectiveShift({ type: 'annual_leave', value: 'AL' }, '06:00-14:00', false).shift, 'AL');
        assert.equal(resolveEffectiveShift({ type: 'correction', value: 'RD' }, '06:00-14:00', false).shift, 'RD');
        assert.equal(resolveEffectiveShift({ type: 'spare_shift', value: 'SPARE' }, 'RD', false).shift, 'SPARE');
    });

    it('Other on a rostered day, no times → derived-RDW false, hours slot shows the base shift time', () => {
        const r = resolveEffectiveShift({ type: 'other', value: 'TRG' }, '06:00-14:00', false);
        assert.equal(r.shift, 'TRG');
        assert.equal(r.derivedRdw, false);
        assert.equal(r.rdwTime, '06:00-14:00');
    });

    it('Other on a REST-day base (no flag) → derived-RDW true, hours slot "RDW"', () => {
        const r = resolveEffectiveShift({ type: 'other', value: 'TRG' }, 'RD', false);
        assert.equal(r.derivedRdw, true);
        assert.equal(r.rdwTime, 'RDW');
    });

    it('Other with the explicit RDW flag → derived-RDW true even on a worked base', () => {
        assert.equal(resolveEffectiveShift({ type: 'other', value: 'TRG RDW' }, '06:00-14:00', false).derivedRdw, true);
    });

    it('Other with actual times → hours slot shows the actual times (highest priority)', () => {
        assert.equal(resolveEffectiveShift({ type: 'other', value: 'TRG 08:00-18:00' }, '06:00-14:00', false).rdwTime, '08:00-18:00');
    });

    it('Other with an UNparseable value falls through to its raw value (no rdwTime)', () => {
        assert.deepEqual(resolveEffectiveShift({ type: 'other', value: 'GIBBERISH' }, 'RD', false),
            { shift: 'GIBBERISH', rdwTime: '', derivedRdw: false, note: '' });
    });

    // Meetings + Union duties (hideBaseTime): attend-an-event days → NO base-time fallback.
    it('MEET/UNION on a rostered day, no times → hours slot is empty (badge only, NOT the base time)', () => {
        for (const f of ['MEET', 'UNION']) {
            const r = resolveEffectiveShift({ type: 'other', value: f }, '06:00-14:00', false);
            assert.equal(r.shift, f);
            assert.equal(r.derivedRdw, false);
            assert.equal(r.rdwTime, '', `${f} should show no base time`);
        }
    });

    it('MEET/UNION with actual times still show them (a roster/manual time always wins)', () => {
        assert.equal(resolveEffectiveShift({ type: 'other', value: 'MEET 09:00-10:00' }, '06:00-14:00', false).rdwTime, '09:00-10:00');
        assert.equal(resolveEffectiveShift({ type: 'other', value: 'UNION 13:00-14:00' }, 'RD', false).rdwTime, '13:00-14:00');
    });

    it('MEET/UNION on a rest-day base or with the RDW flag → still derived-RDW "RDW" (8h default is a pay concern)', () => {
        assert.equal(resolveEffectiveShift({ type: 'other', value: 'MEET' }, 'RD', false).rdwTime, 'RDW');
        assert.equal(resolveEffectiveShift({ type: 'other', value: 'UNION RDW' }, '06:00-14:00', false).derivedRdw, true);
    });
});

describe('toOverrideRecord — the shared cache-record shape (2 writers must not drift)', () => {
    it('copies value and defaults note/type to "" and source/createdAt to null', () => {
        assert.deepEqual(toOverrideRecord({ memberName: 'X', date: '2026-05-01', value: 'AL' }),
            { value: 'AL', note: '', type: '', source: null, createdAt: null });
    });
    it('preserves provided fields (does not clobber real note/type/source/createdAt)', () => {
        const ts = { seconds: 1 };
        assert.deepEqual(
            toOverrideRecord({ value: '09:00-17:00', note: 'ot', type: 'rdw', source: 'manual', createdAt: ts }),
            { value: '09:00-17:00', note: 'ot', type: 'rdw', source: 'manual', createdAt: ts });
    });
    it('does NOT carry memberName/date through (only the display-relevant fields)', () => {
        const rec = toOverrideRecord({ memberName: 'X', date: '2026-05-01', value: 'SICK' });
        assert.equal('memberName' in rec, false);
        assert.equal('date' in rec, false);
    });
});

// ── buildOverrideWrite / buildOverrideCacheRecord (shared save-doc shape) ──────

describe('buildOverrideWrite', () => {
    const ts = { __serverTimestamp: true };
    it('assembles the exact rules-required field set with the injected createdAt', () => {
        const doc = buildOverrideWrite(
            { memberName: 'G. Miller', date: '2026-05-01', type: 'rdw', value: '09:00-17:00', note: 'x', source: 'manual', changedBy: 'G. Miller' }, ts);
        assert.deepEqual(doc, {
            memberName: 'G. Miller', date: '2026-05-01', type: 'rdw', value: '09:00-17:00',
            note: 'x', source: 'manual', createdAt: ts, changedBy: 'G. Miller',
        });
    });
    it('defaults a missing note to "" (the rules require the field present)', () => {
        const doc = buildOverrideWrite({ memberName: 'A', date: '2026-05-01', type: 'shift', value: 'V', source: 'roster_import', changedBy: 'A' }, ts);
        assert.equal(doc.note, '');
    });
    it('drops any extra field on the input (shape is enforced)', () => {
        const doc = buildOverrideWrite(/** @type {any} */ ({ memberName: 'A', date: '2026-05-01', type: 'shift', value: 'V', source: 'manual', changedBy: 'A', existingId: 'evil', foo: 1 }), ts);
        assert.equal('existingId' in doc, false);
        assert.equal('foo' in doc, false);
        assert.deepEqual(Object.keys(doc).sort(), ['changedBy', 'createdAt', 'date', 'memberName', 'note', 'source', 'type', 'value']);
    });
});

describe('buildOverrideCacheRecord', () => {
    it('mirrors the write MINUS changedBy, PLUS id, with the given Date createdAt', () => {
        const when = new Date(2026, 4, 1, 12);
        const rec = buildOverrideCacheRecord('doc123',
            { memberName: 'G. Miller', date: '2026-05-01', type: 'rdw', value: '09:00-17:00', note: '', source: 'manual', changedBy: 'ignored' }, when);
        assert.deepEqual(rec, {
            id: 'doc123', memberName: 'G. Miller', date: '2026-05-01', type: 'rdw', value: '09:00-17:00',
            note: '', source: 'manual', createdAt: when,
        });
        assert.equal('changedBy' in rec, false, 'the optimistic cache record does not carry changedBy');
    });
});

// ── composeOtherValue — the WRITER half of the grammar (v18.85) ────────────────────────────────
// Extracted from admin-app.js's save handler, where it was inline and untested: the parser was
// single-sourced and pinned here while the composer that PRODUCES the stored strings was not — the
// wrong way round for a format persisted to Firestore (a compose bug writes bad data permanently).

describe('composeOtherValue', () => {
    it('composes a bare flavour when nothing else is set', () => {
        for (const f of Object.keys(OTHER_FLAVOURS)) {
            assert.deepEqual(composeOtherValue({ flavour: f }), { value: f });
        }
    });

    // The guard that binds the two halves of the grammar. Asserting only the composed STRING (above)
    // left the reader and writer free to drift: the writer accepts any OTHER_FLAVOURS key, so a new
    // flavour added there alone would compose a value isOtherValue rejects — unparseable data,
    // permanently, in Firestore. Every flavour the writer accepts, the reader must read back.
    it('every flavour the writer accepts, the reader parses back — for all four value shapes', () => {
        for (const f of Object.keys(OTHER_FLAVOURS)) {
            for (const opts of [
                { flavour: f },
                { flavour: f, rdwTicked: true },
                { flavour: f, start: '09:00', end: '17:00' },
                { flavour: f, rdwTicked: true, start: '09:00', end: '17:00' },
            ]) {
                const { value, error } = composeOtherValue(opts);
                assert.equal(error, undefined, `${f}: composer rejected its own flavour`);
                assert.ok(isOtherValue(value), `${f}: composed "${value}" but isOtherValue() says no`);
                assert.equal(parseOtherValue(value)?.flavour, f, `${f}: parsed back to the wrong flavour`);
            }
        }
    });

    it('adds the RDW marker from the tick', () => {
        assert.deepEqual(composeOtherValue({ flavour: 'TRG', rdwTicked: true }), { value: 'TRG RDW' });
    });

    it('a rest-day base FORCES the RDW marker even when the tick is off', () => {
        // Both display layers and the pay engine derive RDW-ness from a rest-day base anyway, so a
        // bare 'TRG' would make the stored value lie about the behaviour the app honours.
        assert.deepEqual(composeOtherValue({ flavour: 'TEAM', rdwTicked: false, baseIsRd: true }),
            { value: 'TEAM RDW' });
    });

    it('appends times when both are given, and trims them', () => {
        assert.deepEqual(composeOtherValue({ flavour: 'IND', start: '08:00', end: '16:00' }),
            { value: 'IND 08:00-16:00' });
        assert.deepEqual(composeOtherValue({ flavour: 'IND', start: ' 08:00 ', end: ' 16:00 ' }),
            { value: 'IND 08:00-16:00' }, 'whitespace must not reach the stored value');
        assert.deepEqual(composeOtherValue({ flavour: 'TRG', rdwTicked: true, start: '09:00', end: '17:30' }),
            { value: 'TRG RDW 09:00-17:30' }, 'marker and times together, in that order');
    });

    it('rejects a missing or unknown flavour rather than defaulting to Training', () => {
        for (const bad of [undefined, null, '', 'SPARE', 'NOPE', 'trg']) {
            const r = composeOtherValue({ flavour: /** @type {any} */ (bad) });
            assert.equal(r.value, undefined, `${String(bad)} must not compose`);
            assert.match(r.error, /choose the type of Other day/);
        }
    });

    it('rejects a half-filled time pair (never silently drops one)', () => {
        assert.match(composeOtherValue({ flavour: 'TRG', start: '08:00' }).error, /fill in both times/);
        assert.match(composeOtherValue({ flavour: 'TRG', end: '16:00' }).error,   /fill in both times/);
    });

    it('rejects malformed or impossible times', () => {
        for (const [s, e] of [['8:00', '16:00'], ['08:00', '16:0'], ['24:00', '16:00'], ['08:60', '16:00'], ['abc', 'def']]) {
            assert.match(composeOtherValue({ flavour: 'TRG', start: s, end: e }).error,
                /times must be in HH:MM format/, `${s}-${e} must be rejected`);
        }
    });

    it('rejects equal start and end (0h by validation, 24h by the pay maths)', () => {
        assert.match(composeOtherValue({ flavour: 'TRG', start: '08:00', end: '08:00' }).error,
            /start and end times are the same/);
    });

    it('every composed value round-trips through the parser', () => {
        // THE invariant the split risked: writer and reader must agree on the same grammar.
        const cases = [
            { flavour: 'TRG' }, { flavour: 'MEET', rdwTicked: true },
            { flavour: 'ASSESS', start: '06:15', end: '14:45' },
            { flavour: 'UNION', baseIsRd: true, start: '00:00', end: '23:59' },
        ];
        for (const c of cases) {
            const { value } = composeOtherValue(c);
            assert.ok(isOtherValue(value), `${value} must be recognised by isOtherValue`);
            const back = parseOtherValue(value);
            assert.equal(back.flavour, c.flavour);
            assert.equal(back.rdw, !!(c.rdwTicked || c.baseIsRd));
            assert.equal(back.time, c.start ? `${c.start}-${c.end}` : null);
        }
    });
});

// ── The Sunday policy ──────────────────────────────────────────────────────────────────────────
//
// Enforced at several points on purpose, and that stays — the failure it prevents is annual leave
// written against a day nobody was contracted to work. What is new is that the policy is DECLARED
// once instead of restated in each site's own vocabulary. These tests pin the declaration; the last
// two pin the sites that keep a bespoke copy for a reason (per-pill wording; three different
// outcomes for four types), so a fifth forbidden type fails HERE rather than being writable there.

import { readFileSync } from 'node:fs';
const readSrc = (/** @type {string} */ f) => readFileSync(new URL(f, import.meta.url), 'utf8');

/**
 * The source between an anchor comment and the first line past the block it marks.
 *
 * Asserts the anchor was FOUND rather than inferring it from the slice length — a rename that keeps
 * the anchor as a prefix ("write guard" → "write guardian") passes a substring test AND a length
 * test, so both guards below reported healthy against a marker that no longer meant anything. Found
 * by mutation, which is the only way that one shows up.
 */
function blockAfter(/** @type {string} */ src, /** @type {string} */ anchor, /** @type {string} */ end) {
    const from = src.indexOf(anchor);
    assert.notEqual(from, -1, `the "${anchor}" anchor has gone — re-anchor this test on the real code`);
    const rest = src.slice(from + anchor.length);
    const to   = rest.indexOf(end);
    assert.notEqual(to, -1, `no "${end}" after the "${anchor}" anchor — the block has been restructured`);
    return rest.slice(0, to);
}

describe('what may not be recorded on a Sunday', () => {
    it('RDW is NOT forbidden — Sunday work is the one thing that belongs there', () => {
        // The single most important entry in this list is the one that is absent. Sundays are
        // uncontracted, so any Sunday work is overtime; forbidding `rdw` would make a real,
        // payable shift unrecordable.
        assert.equal(isForbiddenOnSunday('rdw'), false);
        assert.ok(!SUNDAY_FORBIDDEN_TYPES.includes('rdw'));
    });

    it('leave, absence, an Other day and a plain shift are all forbidden', () => {
        for (const t of ['annual_leave', 'sick', 'other', 'shift']) {
            assert.equal(isForbiddenOnSunday(t), true, `${t} must be forbidden on a Sunday`);
        }
    });

    it('a type nobody has heard of is not silently forbidden', () => {
        // Fail OPEN here, deliberately: the four enforcement layers each also check `isSunday`, and
        // an unknown type reaching this predicate means a new override type has been added without
        // a decision about Sundays. Refusing it by default would make that new type mysteriously
        // unwritable on one day a week; allowing it makes the omission visible at review.
        assert.equal(isForbiddenOnSunday('correction'), false);
        assert.equal(isForbiddenOnSunday('spare_shift'), false);
    });

    it('the import NORMALISES rather than refusing — AL, Absent and Other become RD', () => {
        // A PDF is a statement about the past, and rejecting a whole week over one cell would lose
        // the other six.
        assert.equal(sundaySafeValue('AL'), 'RD');
        assert.equal(sundaySafeValue('SICK'), 'RD');
        assert.equal(sundaySafeValue('TRG'), 'RD');
    });

    it('and it leaves everything else alone, so a caller can use it unconditionally', () => {
        for (const v of ['RD', 'RDW', 'SPARE', '07:00-14:00']) {
            assert.equal(sundaySafeValue(v), v, `${v} must pass through untouched`);
        }
    });

    it('the single-row SAVE answers for every forbidden type — it keeps its own copy too', () => {
        // The write path for the "Change a Shift" week grid, and the one this list matters most to:
        // the pills only decide what can be PRESSED, and the bulk bar only what a sweep touches.
        // This is where a manual row actually becomes a Firestore document.
        //
        // It cannot consume the list directly, because the four types get three different answers —
        // `shift` is promoted to `rdw`, `other` is refused unless the flavour is Spare, leave and
        // absence are refused outright. So this asserts each type is ANSWERED here at all. Without
        // it, a fifth forbidden type would be blocked by the pills, skipped by the bulk bar and
        // normalised by the import, and then written anyway by the one path that does the writing.
        const scope = blockAfter(readSrc('./admin-app.js'),
            'Sunday write guard — the list is `SUNDAY_FORBIDDEN_TYPES`', 'const typeMeta');
        for (const t of SUNDAY_FORBIDDEN_TYPES) {
            assert.ok(scope.includes(`type === '${t}'`),
                `the single-row save has no Sunday answer for ${t} — it would be written`);
        }
    });

    it('LAYER 1 disables a pill for every forbidden type — it keeps its own copy', () => {
        // The week-grid pills carry bespoke wording per pill ("Annual leave cannot be recorded on a
        // Sunday…"), which is right — a shared message would be vaguer than any of them. So that
        // layer cannot consume the list directly, and this is what keeps it honest instead: a fifth
        // forbidden type added to the declaration and not to the grid would leave a pill a member
        // can press on a day the write path will silently drop.
        // Anchored on admin-week-editor.js since v21.38 — the week grid moved there in the Admin
        // split. The re-anchor was forced by this assertion failing, which is the guard doing its
        // job: it refuses to pass when it cannot find the code it claims to be checking.
        const scope = blockAfter(readSrc('./admin-week-editor.js'),
            'layer 1: disable pills in week grid', '\n        }');
        for (const t of SUNDAY_FORBIDDEN_TYPES) {
            assert.ok(scope.includes(`.pill-${t}`),
                `no Sunday-disable for the ${t} pill — the declaration and the grid have drifted`);
        }
    });
});

/**
 * ── SWAP vs OVERTIME (v21.55) ───────────────────────────────────────────────────────────────────
 *
 * `WORKED_OVERRIDE_TYPES` answers "is somebody at work?" and for that `shift` and `rdw` are the
 * same. For ANNUAL LEAVE they are opposites: a `shift` on a base rest day is a swap, so leave
 * there spends a day; an `rdw` is overtime the member volunteered for, so it does not. These two
 * sets must therefore stay DISJOINT — a type in both would be the bug, not a tidy-up.
 */
describe('contracted work vs volunteered work', () => {
    it('the two sets are disjoint — no type can be both', () => {
        for (const t of CONTRACTED_WORK_TYPES) {
            assert.ok(!VOLUNTARY_WORK_TYPES.has(t), `${t} is in both sets`);
        }
    });

    it('rdw is voluntary and shift is contracted — the distinction the whole rule rests on', () => {
        assert.equal(isContractedWorkOverride({ type: 'shift', value: '07:00-15:00' }), true);
        assert.equal(isContractedWorkOverride({ type: 'rdw',   value: '07:00-15:00' }), false);
    });

    it('a rest VALUE is not work whatever its type — the other half of a swap', () => {
        assert.equal(isContractedWorkOverride({ type: 'correction', value: 'RD' }), false);
        assert.equal(isContractedWorkOverride({ type: 'shift', value: 'OFF' }), false,
            'the value is checked first, deliberately: it is the stronger statement');
    });

    it('a correction classifies from the TYPE alone — the value is pinned to RD by the rules', () => {
        // This is the reconstructed-from-replacedType path, where no value exists: without the
        // type-level answer, AL over a swapped-OUT day was charged the moment the correction doc
        // was destroyed (v21.56 — the first cut read a replacedValue nothing has ever written).
        assert.equal(isContractedWorkOverride({ type: 'correction' }), false);
    });

    it('an ABSENCE answers UNKNOWN, never false', () => {
        // false would mean "not contracted", which would quietly stop leave over a sick day on an
        // ordinary working date from costing anything. null sends the caller to the base roster.
        assert.equal(isContractedWorkOverride({ type: 'sick', value: 'SICK' }), null);
        assert.equal(isContractedWorkOverride({ type: 'annual_leave', value: 'AL' }), null);
        assert.equal(isContractedWorkOverride(null), null);
        assert.equal(isContractedWorkOverride({ value: 'RD' }), null, 'no type ⇒ no information');
    });

    it('the legacy types split the same way as the modern ones', () => {
        assert.equal(isContractedWorkOverride({ type: 'swap',      value: '07:00-15:00' }), true);
        assert.equal(isContractedWorkOverride({ type: 'allocated', value: '07:00-15:00' }), true);
        assert.equal(isContractedWorkOverride({ type: 'overtime',  value: '07:00-15:00' }), false);
    });
});

describe('nextReplacedType — what a write must remember about the doc it deletes', () => {
    it('records the type it replaced', () => {
        assert.equal(nextReplacedType({ type: 'shift' }, 'annual_leave'), 'shift');
        assert.equal(nextReplacedType({ type: 'rdw' },   'annual_leave'), 'rdw');
    });

    it('INHERITS when the type is unchanged, so a re-save cannot erase the context', () => {
        // Re-saving a range is ordinary. Writing 'annual_leave' as what an AL doc replaced would
        // make a swapped-in day cost a day until somebody pressed Save twice, then stop.
        assert.equal(
            nextReplacedType({ type: 'annual_leave', replacedType: 'shift' }, 'annual_leave'),
            'shift');
    });

    it('CHAINS THROUGH an absence on a type change — swap → sick → AL keeps the shift (v21.56)', () => {
        // Reclassifying sickness as leave is routine; recording 'sick' as what the AL replaced
        // would discard the shift underneath and the swapped day would go free.
        assert.equal(nextReplacedType({ type: 'sick', replacedType: 'shift' }, 'annual_leave'), 'shift');
        assert.equal(nextReplacedType({ type: 'annual_leave', replacedType: 'shift' }, 'sick'), 'shift');
        // …but an INFORMATIVE type is itself the fact, and still wins over whatever it replaced:
        // if the roster office corrected the day to rest, the day IS rest, whatever came before.
        assert.equal(nextReplacedType({ type: 'correction', replacedType: 'shift' }, 'annual_leave'),
            'correction');
        assert.equal(nextReplacedType({ type: 'shift', replacedType: 'sick' }, 'annual_leave'), 'shift');
    });

    it('is null when there was nothing to replace, so the key is simply absent', () => {
        // The Firestore rules validate replacedType only when present; null must not be written.
        assert.equal(nextReplacedType(null, 'annual_leave'), null);
        assert.equal(nextReplacedType({ type: 'annual_leave' }, 'annual_leave'), null);
    });

    it('the calendar cache record carries replacedType like every other mirror', () => {
        assert.equal(toOverrideRecord({ value: 'AL', type: 'annual_leave', replacedType: 'shift' }).replacedType, 'shift');
        assert.ok(!('replacedType' in toOverrideRecord({ value: 'AL', type: 'annual_leave' })),
            'and absent stays absent — same key-presence convention as the write builders');
    });

    it('the builders omit the key entirely rather than writing a null', () => {
        const base = { memberName: 'A. Member', date: '2026-09-09', type: 'annual_leave', value: 'AL', source: 'manual', changedBy: 'X' };
        assert.ok(!('replacedType' in buildOverrideWrite({ ...base, replacedType: null }, new Date())));
        assert.equal(buildOverrideWrite({ ...base, replacedType: 'shift' }, new Date()).replacedType, 'shift');
        assert.ok(!('replacedType' in buildOverrideCacheRecord('id1', { ...base, replacedType: null }, new Date())));
        assert.equal(buildOverrideCacheRecord('id1', { ...base, replacedType: 'shift' }, new Date()).replacedType, 'shift');
    });
});


// ── manualCellValue — the roster review's in-place answer to an unreadable cell (v22.17) ────────
//
// ORGANISED BY WHAT A WRONG ANSWER COSTS. This function turns a pill press into a value that goes
// straight into an override write, so the two directions are:
//
//   PRODUCING A VALUE FROM AN INCOMPLETE ENTRY writes a shift the admin never finished typing —
//     silently, because a half-entered time still looks like a time. That is the dangerous one.
//   REFUSING A COMPLETE ENTRY is a control that appears to do nothing, which is visible and
//     annoying but corrects itself the moment somebody reports it.

describe('manualCellValue', () => {
    it('maps each fixed type to the value the parsed path uses', () => {
        // These are the parsed-roster VALUES, not the override TYPE ids — the two vocabularies the
        // module header keeps apart. Getting this mapping wrong writes a valid-looking wrong day.
        assert.equal(manualCellValue('correction'), 'RD');
        assert.equal(manualCellValue('annual_leave'), 'AL');
        assert.equal(manualCellValue('sick'), 'SICK');
        assert.equal(manualCellValue('spare_shift'), 'SPARE');
    });

    it('composes a timed shift, and marks an RDW so the type survives', () => {
        assert.equal(manualCellValue('shift', '06:00', '14:00'), '06:00-14:00');
        // The RDW| marker is what makes shiftValueToOverrideType write `rdw` rather than `shift`.
        // Without it a rest-day-worked entry would be saved as an ordinary shift and paid as one.
        assert.equal(manualCellValue('rdw', '06:00', '14:00'), 'RDW|06:00-14:00');
    });

    it('refuses an incomplete or malformed time rather than guessing', () => {
        for (const [from, to] of [['', ''], ['06:00', ''], ['', '14:00'], ['6:00', '14:00'],
                                  ['0600', '1400'], ['06:0', '14:00'], ['abc', 'def']]) {
            assert.equal(manualCellValue('shift', from, to), null, `${from}-${to} must not compose`);
            assert.equal(manualCellValue('rdw', from, to), null);
        }
    });

    it('refuses `other`, because its grammar needs controls this surface does not have', () => {
        // FLAVOUR[" RDW"][" HH:MM-HH:MM"] is composed from a flavour chip, a rest-day tick and
        // optional times. A second partial implementation is where a wrong value would come from,
        // so the review refuses and points at Change a Shift instead.
        assert.equal(manualCellValue('other'), null);
        assert.equal(manualCellValue('other', '06:00', '14:00'), null);
    });

    it('refuses a type it does not know, rather than falling through to a shift', () => {
        for (const t of ['', 'nonsense', 'allocated', 'overtime', 'swap']) {
            assert.equal(manualCellValue(t, '06:00', '14:00'), null);
        }
    });

    it('every PILL_TYPES entry either composes or is refused for a stated reason', () => {
        // The pills are generated from PILL_TYPES, so a type added there arrives on this control
        // whether or not anybody taught this function about it. `other` is the one deliberate
        // refusal; anything else silently unsupported would render a pill that does nothing.
        const KNOWN_REFUSALS = new Set(['other']);
        for (const t of PILL_TYPES) {
            const v = manualCellValue(t, '06:00', '14:00');
            if (KNOWN_REFUSALS.has(t)) assert.equal(v, null, `${t} is a stated refusal`);
            else assert.ok(v, `${t} is offered as a pill but composes nothing — teach manualCellValue or exclude it`);
        }
    });
});
describe('manualCellValue — a real clock time, not the shape of one', () => {
    // The entry boxes are TEXT (roster-entry-control.js's header measures why), so nothing in the
    // browser rejects an impossible time. The first cut tested only `\d{2}:\d{2}`, which let
    // `29:00` and `99:99` compose a shift that every duration and classification helper downstream
    // reads as nonsense — silently, because a shift-shaped string is what they all expect.
    // Organised by cost: ACCEPTING an impossible time writes bad roster data; REFUSING a real one
    // makes a legitimate entry impossible to record.

    it('an impossible hour or minute produces no entry at all', () => {
        for (const [f, t] of [['99:99', '06:00'], ['25:00', '26:00'], ['24:00', '06:00'],
                              ['06:60', '14:00'], ['06:00', '24:00']]) {
            assert.equal(manualCellValue('shift', f, t), null, `${f}-${t} must not compose`);
        }
    });

    it('and the shape is still required — a half-typed time writes nothing', () => {
        for (const [f, t] of [['6:00', '14:00'], ['06:00', ''], ['', '14:00'], ['0600', '1400']]) {
            assert.equal(manualCellValue('shift', f, t), null);
        }
    });

    it('every real time the roster actually uses is accepted', () => {
        // Including the two boundaries: a midnight FINISH is written `00:00` on the real Supervisor
        // sheet (`15:00-00:00`), never `24:00`, and an overnight range is end < start, which is
        // ordinary here and must not be mistaken for an error.
        assert.equal(manualCellValue('shift', '00:00', '23:59'), '00:00-23:59');
        assert.equal(manualCellValue('shift', '15:00', '00:00'), '15:00-00:00');
        assert.equal(manualCellValue('shift', '06:20', '14:20'), '06:20-14:20');
        assert.equal(manualCellValue('rdw',   '22:30', '07:00'), 'RDW|22:30-07:00');
    });
});

