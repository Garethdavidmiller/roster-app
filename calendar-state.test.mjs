/**
 * Unit tests for calendar-state.js — display month/year state machine.
 * Run: node --experimental-test-module-mocks --test calendar-state.test.mjs
 *
 * calendar-state.js executes a restoreViewedMonth() IIFE at import time that
 * reads from localStorage. The store is seeded before the import so we can
 * verify the restore logic, then tests manipulate state via the exported setters.
 */
import { test, describe, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();

mock.module('./ls.js', {
    namedExports: {
        lsGet: k      => (store.has(k) ? store.get(k) : null),
        lsSet: (k, v) => { store.set(k, String(v)); },
        lsDel: k      => { store.delete(k); },
    },
});
mock.module('./roster-data.js', {
    namedExports: { CONFIG: { MIN_YEAR: 2024, MAX_YEAR: 2030 } },
});

// Seed a valid PAST month/year so restoreViewedMonth picks it up on import.
// (A future month would be ignored by the guard in the IIFE.)
store.set('myb_roster_month', '3');    // April (0-indexed)
store.set('myb_roster_year',  '2025');

const {
    getDisplayMonth, getDisplayYear,
    setDisplayMonth, setDisplayYear,
    changeDisplay, persistViewedMonth, addMonths,
} = await import('./calendar-state.js');

// Capture state IMMEDIATELY after import, before any beforeEach runs.
// restoreViewedMonth executed during import; these values reflect what it set.
const importedMonth = getDisplayMonth();
const importedYear  = getDisplayYear();

// ── restoreViewedMonth (runs at import time) ──────────────────────────────────

describe('restoreViewedMonth', () => {
    test('restores a valid past month and year from localStorage on module load', () => {
        assert.equal(importedMonth, 3);
        assert.equal(importedYear, 2025);
    });
});

// ── persistViewedMonth ────────────────────────────────────────────────────────

describe('persistViewedMonth', () => {
    test('writes current display position to localStorage', () => {
        setDisplayMonth(8);
        setDisplayYear(2027);
        persistViewedMonth();
        assert.equal(store.get('myb_roster_month'), '8');
        assert.equal(store.get('myb_roster_year'),  '2027');
    });

    test('overwrites a previous stored position', () => {
        setDisplayMonth(0);
        setDisplayYear(2026);
        persistViewedMonth();
        setDisplayMonth(11);
        setDisplayYear(2028);
        persistViewedMonth();
        assert.equal(store.get('myb_roster_month'), '11');
        assert.equal(store.get('myb_roster_year'),  '2028');
    });
});

// ── changeDisplay ─────────────────────────────────────────────────────────────

describe('changeDisplay', () => {
    beforeEach(() => {
        setDisplayMonth(5);    // June
        setDisplayYear(2026);
    });

    test('+1 advances month by one', () => {
        changeDisplay(1);
        assert.equal(getDisplayMonth(), 6);    // July
        assert.equal(getDisplayYear(), 2026);
    });

    test('-1 goes back one month', () => {
        changeDisplay(-1);
        assert.equal(getDisplayMonth(), 4);    // May
        assert.equal(getDisplayYear(), 2026);
    });

    test('December + 1 wraps to January of the next year', () => {
        setDisplayMonth(11);   // December
        setDisplayYear(2026);
        changeDisplay(1);
        assert.equal(getDisplayMonth(), 0);    // January
        assert.equal(getDisplayYear(), 2027);
    });

    test('January - 1 wraps to December of the previous year', () => {
        setDisplayMonth(0);    // January
        setDisplayYear(2026);
        changeDisplay(-1);
        assert.equal(getDisplayMonth(), 11);   // December
        assert.equal(getDisplayYear(), 2025);
    });

    test('clamps at MAX_YEAR December — does not advance past it', () => {
        setDisplayMonth(11);
        setDisplayYear(2030);  // MAX_YEAR
        changeDisplay(1);
        assert.equal(getDisplayYear(), 2030);
        assert.equal(getDisplayMonth(), 11);
    });

    test('clamps at MIN_YEAR January — does not go back past it', () => {
        setDisplayMonth(0);
        setDisplayYear(2024);  // MIN_YEAR
        changeDisplay(-1);
        assert.equal(getDisplayYear(), 2024);
        assert.equal(getDisplayMonth(), 0);
    });

});

// ── addMonths (the pure shared rollover, also used by calendar-swipe) ──────────
describe('addMonths', () => {
    test('adds within the same year', () => {
        assert.deepEqual(addMonths(4, 2026, 1), { month: 5, year: 2026 });
        assert.deepEqual(addMonths(4, 2026, -1), { month: 3, year: 2026 });
    });
    test('rolls the year forward/back across the December↔January boundary', () => {
        assert.deepEqual(addMonths(11, 2026, 1), { month: 0, year: 2027 });
        assert.deepEqual(addMonths(0, 2026, -1), { month: 11, year: 2025 });
    });
    test('clamps at MAX_YEAR December and MIN_YEAR January', () => {
        assert.deepEqual(addMonths(11, 2030, 1), { month: 11, year: 2030 });
        assert.deepEqual(addMonths(0, 2024, -1), { month: 0, year: 2024 });
    });
    test('rolls correctly for a delta larger than one (robustness beyond ±1)', () => {
        assert.deepEqual(addMonths(10, 2026, 3), { month: 1, year: 2027 });  // Nov + 3 → Feb next year
        assert.deepEqual(addMonths(1, 2026, -3), { month: 10, year: 2025 }); // Feb − 3 → Nov prev year
    });
});
