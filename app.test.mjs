import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { tsToMillis, shouldReplaceOverride, isBeforeMemberStart } from './app-override-utils.js';

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
