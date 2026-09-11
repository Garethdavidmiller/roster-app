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
//
// The restore is an IIFE, so one import can only ever exercise ONE seeded state. Everything below
// the first case therefore re-imports under a fresh query string — the same trick
// `perf-reporter.test.mjs` uses — which re-evaluates the module against a newly seeded store while
// the mocks above still apply (they key on the resolved specifier of `./ls.js`, which is unchanged).
//
// Organised by what a wrong answer costs, and the two directions are not symmetrical:
//
//   · RESTORING A FUTURE MONTH is the one the guard exists for, and it is silent. Somebody browses
//     ahead to plan leave, closes the app, and opens it next shift on a month that is not the one
//     they are working — with today's date nowhere on screen and nothing saying why. The app's
//     whole job on open is to answer "what am I doing today".
//   · DROPPING A PAST MONTH costs a swipe, and the reader can see where they are.
//
// Deleting `if (!isFuture)` left this file green (measured) — the seeded month was in the past, so
// the guard had nothing to refuse. It now fails, as does inverting it and dropping the MIN/MAX year
// bounds.
//
// ONE MUTATION HERE PROVABLY CANNOT FAIL, and there is no test for it rather than a test that
// pretends: widening `m > today.getMonth()` to `m >= today.getMonth()`. That changes the answer for
// exactly one seed — today's own month — and for that seed "restored" and "dropped" are the SAME
// PAIR OF NUMBERS, because dropping falls back to today. No assertion on this function's output can
// separate them, so the `>` is held by review, not by this file.
describe('restoreViewedMonth', () => {
    test('restores a valid past month and year from localStorage on module load', () => {
        assert.equal(importedMonth, 3);
        assert.equal(importedYear, 2025);
    });

    /** Re-evaluate the module against a freshly seeded store. */
    async function restoreWith(month, year, tag) {
        store.set('myb_roster_month', String(month));
        store.set('myb_roster_year',  String(year));
        const m = await import('./calendar-state.js?restore=' + tag);
        return { month: m.getDisplayMonth(), year: m.getDisplayYear() };
    }

    test('a month in a FUTURE YEAR is dropped — the app opens on today', async () => {
        const today = new Date();
        // Both fields are discarded, not just the month: a guard that clamped the month and kept
        // the year would open on a year the member is not working in, which is the same failure.
        const got = await restoreWith(0, today.getFullYear() + 1, 'future-year');
        assert.deepEqual(got, { month: today.getMonth(), year: today.getFullYear() },
            'a month the member had browsed ahead to was restored over today');
    });

    test('a LATER MONTH of this year is dropped too — the boundary is today, not January', async () => {
        const today = new Date();
        // One month on from today, rolled properly, so this is a future month whatever the date is.
        const m = (today.getMonth() + 1) % 12;
        const y = today.getMonth() === 11 ? today.getFullYear() + 1 : today.getFullYear();
        const got = await restoreWith(m, y, 'next-month');
        assert.deepEqual(got, { month: today.getMonth(), year: today.getFullYear() });
    });

    test('an EARLIER month of this year is restored — the guard refuses the future, not storage', async () => {
        // The other direction. Without this, every case above would pass on a restore that had
        // simply stopped reading localStorage at all.
        const today = new Date();
        const m = (today.getMonth() + 11) % 12;
        const y = today.getMonth() === 0 ? today.getFullYear() - 1 : today.getFullYear();
        const got = await restoreWith(m, y, 'last-month');
        assert.deepEqual(got, { month: m, year: y },
            'a month the member was last looking at was thrown away');
    });

    test('a year outside MIN_YEAR..MAX_YEAR is dropped whichever side it falls', async () => {
        const today = new Date();
        const belowMin = await restoreWith(5, 2023, 'below-min');   // MIN_YEAR is 2024 here
        assert.deepEqual(belowMin, { month: today.getMonth(), year: today.getFullYear() });
        const aboveMax = await restoreWith(5, 2031, 'above-max');   // MAX_YEAR is 2030
        assert.deepEqual(aboveMax, { month: today.getMonth(), year: today.getFullYear() });
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
