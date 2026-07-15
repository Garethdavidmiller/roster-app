import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { tsToMillis, shouldReplaceOverride, reconcileRangeIntoCache, isBeforeMemberStart, isRestShift, computePeriodDeleteIds,
         OTHER_FLAVOURS, OTHER_RDW_DEFAULT_MINS, isOtherValue, parseOtherValue, resolveOtherPay,
         isOverrideDisplaySuppressed, mergeBookedPeriods, resolveEffectiveShift, toOverrideRecord,
         buildOverrideWrite, buildOverrideCacheRecord } from './override-utils.js';

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
        for (const f of ['TRG', 'IND', 'ASSESS', 'TEAM']) {
            assert.equal(isOtherValue(f), true, f);
            assert.deepEqual(parseOtherValue(f), { flavour: f, rdw: false, time: null });
        }
    });

    it('accepts the RDW marker', () => {
        assert.deepEqual(parseOtherValue('TRG RDW'),    { flavour: 'TRG',    rdw: true, time: null });
        assert.deepEqual(parseOtherValue('ASSESS RDW'), { flavour: 'ASSESS', rdw: true, time: null });
        assert.deepEqual(parseOtherValue('TEAM RDW'),   { flavour: 'TEAM',   rdw: true, time: null });
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
