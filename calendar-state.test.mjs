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
    changeDisplay, persistViewedMonth, addMonths, watchLocalDate,
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
// ON A PINNED CLOCK (test audit, 7 Nov 2026). The cases below re-derived "today" from the real
// clock against a MAX_YEAR pinned at 2030, so the earlier-month case would have started failing in
// 2031; and a stored year above MAX_YEAR is also a FUTURE year on any clock before 2031, so the
// future guard refused it first and the MAX_YEAR bound could be deleted with the file green. The
// restore reads `new Date()` once, at import, so each re-import runs at a written-out date — and
// the MAX_YEAR case runs at one after 2030, the one place that bound is the only thing refusing.
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

    /** "Today" for these cases: 15 July 2026, midday. Months are 0-indexed, so July is 6. */
    const TODAY = new Date(2026, 6, 15, 12);

    /** Re-evaluate the module against a freshly seeded store, on a pinned clock. */
    async function restoreWith(month, year, tag, now = TODAY) {
        store.set('myb_roster_month', String(month));
        store.set('myb_roster_year',  String(year));
        mock.timers.enable({ apis: ['Date'], now });
        try {
            const m = await import('./calendar-state.js?restore=' + tag);
            return { month: m.getDisplayMonth(), year: m.getDisplayYear() };
        } finally { mock.timers.reset(); }
    }

    test('a month in a FUTURE YEAR is dropped — the app opens on today', async () => {
        // Both fields are discarded, not just the month: a guard that clamped the month and kept
        // the year would open on a year the member is not working in, which is the same failure.
        const got = await restoreWith(0, 2027, 'future-year');
        assert.deepEqual(got, { month: 6, year: 2026 },
            'a month the member had browsed ahead to was restored over today');
    });

    test('a LATER MONTH of this year is dropped too — the boundary is today, not January', async () => {
        assert.deepEqual(await restoreWith(7, 2026, 'next-month'), { month: 6, year: 2026 });
    });

    test('an EARLIER month of this year is restored — the guard refuses the future, not storage', async () => {
        // The other direction. Without this, every case above would pass on a restore that had
        // simply stopped reading localStorage at all.
        const got = await restoreWith(5, 2026, 'last-month');
        assert.deepEqual(got, { month: 5, year: 2026 },
            'a month the member was last looking at was thrown away');
    });

    test('in JANUARY, last December is the past and next February the future — the year is compared first', async () => {
        // The year boundary, which the real clock only crossed when the suite ran in January.
        const newYear = new Date(2027, 0, 10, 12);
        assert.deepEqual(await restoreWith(11, 2026, 'jan-last-december', newYear), { month: 11, year: 2026 },
            'December was refused as a future month because 11 is greater than January\'s 0');
        assert.deepEqual(await restoreWith(1, 2027, 'jan-next-february', newYear), { month: 0, year: 2027 });
    });

    // A LINK THAT NAMES A DATE WINS, future months included (whole-app review, Oct 2026). The Pay
    // Calculator's "View these dates in your roster calendar" and Admin's Calendar pill both pass
    // ?date=, and nothing read it. Honoured once: the parameter comes off the address.
    test('?date= opens that month, a future one included, and is taken off the address', async () => {
        const replaced = /** @type {string[]} */ ([]);
        /** @type {any} */ (globalThis).location = { search: '?date=2029-03-10', href: 'https://x.test/?date=2029-03-10#huddle' };
        /** @type {any} */ (globalThis).history = { state: null, replaceState: (/** @type {any} */ _s, /** @type {any} */ _t, /** @type {any} */ u) => { replaced.push(String(u)); } };
        try {
            const m = await import('./calendar-state.js?restore=date-param');
            assert.deepEqual({ month: m.getDisplayMonth(), year: m.getDisplayYear() }, { month: 2, year: 2029 },
                'the month the link named must open, even though it is in the future');
            assert.deepEqual(replaced, ['https://x.test/#huddle'], 'the parameter is honoured once, and only it is removed');
        } finally {
            delete /** @type {any} */ (globalThis).location;
            delete /** @type {any} */ (globalThis).history;
        }
    });

    test('a year outside MIN_YEAR..MAX_YEAR is dropped whichever side it falls', async () => {
        const belowMin = await restoreWith(5, 2023, 'below-min');   // MIN_YEAR is 2024 here
        assert.deepEqual(belowMin, { month: 6, year: 2026 });
        // Above MAX_YEAR (2030 here) the stored year is in the future on any clock before 2031, so
        // the future guard would refuse it first. Read in March 2032 instead — a device whose app has
        // outlived its last roster year — June 2031 is in the PAST, and only the bound refuses it.
        const aboveMax = await restoreWith(5, 2031, 'above-max', new Date(2032, 2, 15, 12));
        assert.deepEqual(aboveMax, { month: 2, year: 2032 },
            'a stored month beyond the last roster year was restored');
    });

    test('a ?date= outside MIN_YEAR..MAX_YEAR is refused, and the stored month opens instead', async () => {
        // The link path honours FUTURE months, so its own bounds are the only thing that can refuse
        // one — and neither was tested (test audit, 7 Nov 2026): deleting either left the file green.
        for (const [date, tag] of [['2031-03-10', 'date-above-max'], ['2023-03-10', 'date-below-min']]) {
            /** @type {any} */ (globalThis).location = { search: `?date=${date}`, href: `https://x.test/?date=${date}` };
            /** @type {any} */ (globalThis).history = { state: null, replaceState() {} };
            try {
                assert.deepEqual(await restoreWith(5, 2026, tag), { month: 5, year: 2026 },
                    `?date=${date} opened a month with no roster year behind it`);
            } finally {
                delete /** @type {any} */ (globalThis).location;
                delete /** @type {any} */ (globalThis).history;
            }
        }
    });
});

// ── persistViewedMonth ────────────────────────────────────────────────────────

describe('persistViewedMonth', () => {
    // ON A PINNED CLOCK, because the rule now compares against TODAY: on the real clock a fixed month
    // below becomes the current one some day, and the case silently changes meaning.
    /** @param {Date} now @param {() => void} fn */
    function at(now, fn) {
        mock.timers.enable({ apis: ['Date'], now });
        try { fn(); } finally { mock.timers.reset(); }
    }
    const MID_JULY_2026 = new Date(2026, 6, 15, 12);

    test('writes current display position to localStorage', () => at(MID_JULY_2026, () => {
        setDisplayMonth(8);
        setDisplayYear(2027);
        persistViewedMonth();
        assert.equal(store.get('myb_roster_month'), '8');
        assert.equal(store.get('myb_roster_year'),  '2027');
    }));

    test('overwrites a previous stored position', () => at(MID_JULY_2026, () => {
        setDisplayMonth(0);
        setDisplayYear(2026);
        persistViewedMonth();
        setDisplayMonth(11);
        setDisplayYear(2028);
        persistViewedMonth();
        assert.equal(store.get('myb_roster_month'), '11');
        assert.equal(store.get('myb_roster_year'),  '2028');
    }));

    // cal-data-1 (10 Nov 2026). Every render saves, so a member who simply had TODAY's month open
    // saved it — and once that month ended it was a past month like any other, restored on every
    // launch until somebody navigated. Today's month is the default, so it is cleared, not stored.
    test('the CURRENT month is not stored — it clears a month stored before it', () => at(MID_JULY_2026, () => {
        setDisplayMonth(3); setDisplayYear(2026);   // April, browsed back to: stored
        persistViewedMonth();
        assert.equal(store.get('myb_roster_month'), '3', 'precondition: a browsed month is stored');
        setDisplayMonth(6); setDisplayYear(2026);   // back on July — today's month
        persistViewedMonth();
        assert.equal(store.get('myb_roster_month'), undefined, 'today\'s month was stored, so it would be restored after it ended');
        assert.equal(store.get('myb_roster_year'),  undefined);
    }));
});

// ── The month on screen when it was current, once it has ended (cal-data-1) ─────────────────────
//
// The two halves above joined: a render saves, the next LAUNCH restores. Each launch below is a
// fresh import on its own pinned clock, rendering (saving) once, as `renderCalendar` does.
describe('a launch after the month on screen has ended', () => {
    /** Open the Calendar at `now`: a fresh module, one render's save. @returns {Promise<string>} "month/year" opened on */
    async function launchAt(/** @type {Date} */ now, /** @type {string} */ tag, /** @type {((m: any) => void)|null} */ navigate = null) {
        mock.timers.enable({ apis: ['Date'], now });
        try {
            const m = await import('./calendar-state.js?launch=' + tag);
            const opened = `${m.getDisplayMonth()}/${m.getDisplayYear()}`;
            navigate?.(m);
            m.persistViewedMonth();
            return opened;
        } finally { mock.timers.reset(); }
    }

    test('open on 30 November, then on 1 December: December — and every launch after it', async () => {
        store.clear();
        assert.equal(await launchAt(new Date(2026, 10, 30, 21), 'nov-30'), '10/2026');
        assert.equal(await launchAt(new Date(2026, 11, 1, 5, 30), 'dec-1'), '11/2026',
            'the Calendar opened on November on 1 December — the month that was current when it was last drawn');
        assert.equal(await launchAt(new Date(2026, 11, 2, 5, 30), 'dec-2'), '11/2026');
        assert.equal(await launchAt(new Date(2027, 0, 1, 5, 30), 'jan-1'), '0/2027', 'and across the year end');
    });

    test('a month the member BROWSED back to is still the one restored', async () => {
        // The other direction, and the decision the restore cases above pin: dropping a past month
        // the member chose costs them a swipe, so the fix must not drop it with today's.
        store.clear();
        await launchAt(new Date(2026, 10, 15, 12), 'browse', m => { m.setDisplayMonth(9); m.setDisplayYear(2026); });
        assert.equal(await launchAt(new Date(2026, 11, 1, 5, 30), 'browse-next'), '9/2026');
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

// ── watchLocalDate — a PWA resumed the next morning must not keep yesterday as Today ────────────
describe('watchLocalDate', () => {
    /** A fake document + clock + one-slot timer, so a test can move time and fire events.
     *  @param {string} start */
    function rig(start) {
        let t = new Date(start);
        /** @type {Record<string, Function>} */ const handlers = {};
        const doc = {
            visibilityState: 'visible',
            addEventListener: (/** @type {string} */ ev, /** @type {Function} */ fn) => { handlers[ev] = fn; },
            removeEventListener: (/** @type {string} */ ev) => { delete handlers[ev]; },
        };
        /** @type {{ fn: Function, ms: number }|null} */ let timer = null;
        const env = {
            doc: /** @type {any} */ (doc), now: () => new Date(t),
            setTimer: /** @type {any} */ ((/** @type {Function} */ fn, /** @type {number} */ ms) => { timer = { fn, ms }; return 1; }),
            clearTimer: () => { timer = null; },
        };
        return {
            env, doc,
            set: (/** @type {string} */ iso) => { t = new Date(iso); },
            resume: () => handlers.visibilitychange?.(),
            fireTimer: () => { const x = timer; timer = null; x?.fn(); },
            timer: () => timer,
        };
    }

    test('resuming on the SAME day does nothing — no re-render for a date that did not change', () => {
        const r = rig('2026-09-26T09:00:00');
        let calls = 0;
        watchLocalDate(() => { calls++; }, r.env);
        r.set('2026-09-26T23:59:00'); r.resume();
        assert.equal(calls, 0);
    });

    test('resuming on the NEXT day fires once, and only once for that day', () => {
        const r = rig('2026-09-26T22:00:00');
        let calls = 0;
        watchLocalDate(() => { calls++; }, r.env);
        r.set('2026-09-27T07:30:00'); r.resume();
        assert.equal(calls, 1, 'a Calendar resumed the next morning still highlighted yesterday');
        r.resume();
        assert.equal(calls, 1);
    });

    test('a hidden page\'s visibilitychange is not a resume', () => {
        const r = rig('2026-09-26T22:00:00');
        let calls = 0;
        watchLocalDate(() => { calls++; }, r.env);
        r.set('2026-09-27T07:30:00'); r.doc.visibilityState = 'hidden'; r.resume();
        assert.equal(calls, 0);
    });

    test('an open page rolls over at local midnight — the timer is armed for it', () => {
        const r = rig('2026-09-26T23:59:00');
        let calls = 0;
        watchLocalDate(() => { calls++; }, r.env);
        const armed = r.timer();
        assert.ok(armed && armed.ms > 0 && armed.ms <= 2 * 60 * 1000, `timer armed for ${armed?.ms}ms, not the coming midnight`);
        r.set('2026-09-27T00:00:01'); r.fireTimer();
        assert.equal(calls, 1);
        assert.ok(r.timer(), 'the timer re-arms for the following midnight');
    });

    // cal-data-1 (10 Nov 2026): the repaint kept the MONTH, so a page on November at midnight on the
    // 30th — or a phone resumed on 1 December — showed November with no today in it, and saved it.
    test('across a month end, a display on the month that was current moves to the new one BEFORE the repaint', () => {
        const r = rig('2026-11-30T23:59:00');
        setDisplayMonth(10); setDisplayYear(2026);
        /** @type {number[]|null} */ let drawn = null;
        watchLocalDate(() => { drawn = [getDisplayMonth(), getDisplayYear()]; }, r.env);
        r.set('2026-12-01T00:00:01'); r.fireTimer();
        assert.deepEqual(drawn, [11, 2026], 'the repaint drew November on 1 December');
    });

    test('…and a phone resumed the next morning, across the year end', () => {
        const r = rig('2026-12-31T22:00:00');
        setDisplayMonth(11); setDisplayYear(2026);
        watchLocalDate(() => {}, r.env);
        r.set('2027-01-01T07:30:00'); r.resume();
        assert.deepEqual([getDisplayMonth(), getDisplayYear()], [0, 2027]);
    });

    test('…and a page left open across TWO month ends follows both — each from the date it last saw', () => {
        const r = rig('2026-11-30T22:00:00');
        setDisplayMonth(10); setDisplayYear(2026);
        watchLocalDate(() => {}, r.env);
        r.set('2026-12-01T07:30:00'); r.resume();
        r.set('2026-12-15T07:30:00'); r.resume();
        r.set('2027-01-01T07:30:00'); r.resume();
        assert.deepEqual([getDisplayMonth(), getDisplayYear()], [0, 2027],
            'the second month end compared the display with the date the page OPENED on, and kept December');
    });

    test('a month the member browsed to is left where it is', () => {
        const r = rig('2026-11-30T22:00:00');
        setDisplayMonth(9); setDisplayYear(2026);   // October, browsed back to
        watchLocalDate(() => {}, r.env);
        r.set('2026-12-01T07:30:00'); r.resume();
        assert.deepEqual([getDisplayMonth(), getDisplayYear()], [9, 2026],
            'the date turning took the member off a month they had chosen');
    });
});
