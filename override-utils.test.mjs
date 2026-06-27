import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { tsToMillis, shouldReplaceOverride, isBeforeMemberStart, isRestShift, computePeriodDeleteIds } from './override-utils.js';

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
