// @lane unit
/**
 * Unit tests for calendar-state.js — display month/year state machine.
 * Run: node --experimental-test-module-mocks scripts/run-tests.mjs test/calendar-state.test.mjs
 *
 * calendar-state.js executes a restoreViewedMonth() IIFE at import time that
 * reads from localStorage. The store is seeded before the import so we can
 * verify the restore logic, then tests manipulate state via the exported setters.
 */
import { test, describe, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();

mock.module('../ls.js', {
    namedExports: {
        lsGet: k      => (store.has(k) ? store.get(k) : null),
        lsSet: (k, v) => { store.set(k, String(v)); },
        lsDel: k      => { store.delete(k); },
    },
});
mock.module('../roster-data.js', {
    namedExports: { CONFIG: { MIN_YEAR: 2024, MAX_YEAR: 2030 } },
});

// Seed a valid month/year so restoreViewedMonth picks it up on import, stored just now — a month is
// kept for half an hour (BROWSED_MONTH_KEPT_MS), whether it is ahead of today's or behind it.
store.set('myb_roster_month', '3');    // April (0-indexed)
store.set('myb_roster_year',  '2025');
store.set('myb_roster_month_at', String(Date.now()));

const {
    getDisplayMonth, getDisplayYear,
    setDisplayMonth, setDisplayYear,
    changeDisplay, persistViewedMonth, addMonths, watchLocalDate, BROWSED_MONTH_KEPT_MS,
} = await import('../calendar-state.js');

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
// Organised by what a wrong answer costs. A month is kept for HALF AN HOUR, ahead of today's or behind
// it (owner, 18 Nov 2026), and two failures are silent:
//
//   · DROPPING A MONTH STORED A MINUTE AGO. Somebody swipes to December, goes to Trains and comes
//     back through the drawer — a fresh load — and is put on November. From August 2026 until
//     18 Nov 2026 a month AHEAD of today was refused for exactly that, so that somebody who browsed
//     ahead to plan leave would not open the app at their next shift on a month they are not
//     working. The half hour (15 Nov 2026) answers that reason itself, and the refusal only made a
//     reload disagree with a resume, which kept the month.
//   · KEEPING A MONTH LONGER THAN THE HALF HOUR — the June that reopened for months (below).
//
// ON A PINNED CLOCK (test audit, 7 Nov 2026). The cases below re-derived "today" from the real
// clock against a MAX_YEAR pinned at 2030, so the earlier-month case would have started failing in
// 2031. The restore reads `new Date()` once, at import, so each re-import runs at a written-out date.
//
// THE MAX_YEAR BOUND IS NOW THE ONLY THING REFUSING A STORED YEAR PAST THE LAST ROSTER YEAR. While a
// month ahead was refused, a stored 2031 was a FUTURE year on any clock before 2031, so that refusal
// came first and the bound could be deleted with this file green (test audit, 7 Nov 2026). So the
// year-bounds case below asks it on today's pinned clock as well as on one after 2030.
describe('restoreViewedMonth', () => {
    test('restores a valid past month and year from localStorage on module load', () => {
        assert.equal(importedMonth, 3);
        assert.equal(importedYear, 2025);
    });

    /** "Today" for these cases: 15 July 2026, midday. Months are 0-indexed, so July is 6. */
    const TODAY = new Date(2026, 6, 15, 12);

    /** Re-evaluate the module against a freshly seeded store, on a pinned clock. The month was stored
     *  `storedAgo` ms before `now` — a minute, unless a case says otherwise; null stores no time at all. */
    async function restoreWith(month, year, tag, now = TODAY, /** @type {number|null} */ storedAgo = 60_000) {
        store.set('myb_roster_month', String(month));
        store.set('myb_roster_year',  String(year));
        if (storedAgo === null) store.delete('myb_roster_month_at');
        else store.set('myb_roster_month_at', String(now.getTime() - storedAgo));
        mock.timers.enable({ apis: ['Date'], now });
        try {
            const m = await import('../calendar-state.js?restore=' + tag);
            return { month: m.getDisplayMonth(), year: m.getDisplayYear() };
        } finally { mock.timers.reset(); }
    }

    // AHEAD OF TODAY IS KEPT TOO (owner, 18 Nov 2026). These two pinned the refusal until then.
    test('a LATER MONTH of this year, stored within the half hour, IS restored', async () => {
        assert.deepEqual(await restoreWith(7, 2026, 'next-month'), { month: 7, year: 2026 },
            'a month the member moved ahead to a minute ago was thrown away on a reload');
    });

    test('a month in a LATER YEAR, stored within the half hour, IS restored — both fields', async () => {
        // The month AND the year: a restore that kept one and dropped the other would open on a
        // month the member never looked at.
        assert.deepEqual(await restoreWith(0, 2027, 'future-year'), { month: 0, year: 2027 },
            'a month the member moved ahead to a minute ago was thrown away on a reload');
    });

    test('a month AHEAD stored more than the half hour ago is not restored — today opens', async () => {
        assert.deepEqual(await restoreWith(7, 2026, 'ahead-stale', TODAY, BROWSED_MONTH_KEPT_MS + 1), { month: 6, year: 2026 },
            'a month browsed ahead to over half an hour ago was restored over today');
        assert.deepEqual(await restoreWith(0, 2027, 'ahead-stale-year', TODAY, 3 * 60 * 60 * 1000), { month: 6, year: 2026 });
    });

    test('an EARLIER month of this year is restored', async () => {
        // The other direction. Without this, the stale cases would pass on a restore that had simply
        // stopped reading localStorage at all.
        const got = await restoreWith(5, 2026, 'last-month');
        assert.deepEqual(got, { month: 5, year: 2026 },
            'a month the member was last looking at was thrown away');
    });

    // KEPT FOR HALF AN HOUR (owner, 15 Nov 2026): "It always reopens on June 2026", the month the app was
    // installed — stored then, when every render stored the month on screen. A past month was restored
    // on every launch and stored again each time it was drawn, until the member came back to today's.
    test('a month stored more than half an hour ago opens on today — the June that stayed for months', async () => {
        assert.deepEqual(await restoreWith(5, 2026, 'stale', TODAY, 3 * 60 * 60 * 1000), { month: 6, year: 2026 },
            'a month somebody looked at hours ago was restored over today');
    });

    test('the half hour is the boundary: stored exactly that long ago it is kept, a millisecond more it is not', async () => {
        // The figure is the owner's; the tests below are relative to it, so it is pinned here once.
        assert.equal(BROWSED_MONTH_KEPT_MS, 30 * 60 * 1000, 'the owner chose half an hour (15 Nov 2026)');
        assert.deepEqual(await restoreWith(5, 2026, 'edge-in', TODAY, BROWSED_MONTH_KEPT_MS), { month: 5, year: 2026 });
        assert.deepEqual(await restoreWith(5, 2026, 'edge-out', TODAY, BROWSED_MONTH_KEPT_MS + 1), { month: 6, year: 2026 });
    });

    test('a month stored with NO time — every one stored before v26.19 — opens on today', async () => {
        assert.deepEqual(await restoreWith(5, 2026, 'no-time', TODAY, null), { month: 6, year: 2026 },
            'an untimed month was restored: the June on the owner\'s phone would have stayed');
    });

    test('a time AHEAD of the clock is not trusted — the clock was put back since', async () => {
        assert.deepEqual(await restoreWith(5, 2026, 'ahead', TODAY, -60_000), { month: 6, year: 2026 });
    });

    test('in JANUARY, last December and next February are both kept — across the year, either way', async () => {
        // The year boundary, which the real clock only crossed when the suite ran in January.
        const newYear = new Date(2027, 0, 10, 12);
        assert.deepEqual(await restoreWith(11, 2026, 'jan-last-december', newYear), { month: 11, year: 2026 },
            'last December was refused in January');
        assert.deepEqual(await restoreWith(1, 2027, 'jan-next-february', newYear), { month: 1, year: 2027 },
            'next February was refused in January');
    });

    // A LINK THAT NAMES A DATE WINS, future months included (whole-app review, Oct 2026). The Pay
    // Calculator's "View these dates in your roster calendar" and Admin's Calendar pill both pass
    // ?date=, and nothing read it. Honoured once: the parameter comes off the address.
    test('?date= opens that month, a future one included, and is taken off the address', async () => {
        const replaced = /** @type {string[]} */ ([]);
        /** @type {any} */ (globalThis).location = { search: '?date=2029-03-10', href: 'https://x.test/?date=2029-03-10#huddle' };
        /** @type {any} */ (globalThis).history = { state: null, replaceState: (/** @type {any} */ _s, /** @type {any} */ _t, /** @type {any} */ u) => { replaced.push(String(u)); } };
        try {
            const m = await import('../calendar-state.js?restore=date-param');
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
        // Above MAX_YEAR (2030 here), on today's clock: the case the retired future-month refusal
        // used to answer before the bound was reached. The bound alone refuses it now.
        assert.deepEqual(await restoreWith(5, 2031, 'above-max-today'), { month: 6, year: 2026 },
            'a stored month beyond the last roster year was restored');
        // And read in March 2032 — a device whose app has outlived its last roster year — where
        // June 2031 is in the PAST.
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
        assert.equal(store.get('myb_roster_month_at'), String(MID_JULY_2026.getTime()), 'stored without the time it was stored');
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
        assert.equal(store.get('myb_roster_month_at'), undefined);
    }));

    // v26.19: what the member is LOOKING at, or nothing. A copy in the background — a second tab, or the
    // app behind another one — still redraws when the date turns or a read lands, and kept its month,
    // and its time, fresh for the next launch.
    test('a page out of sight stores nothing — not a month, and not a clear either', () => at(MID_JULY_2026, () => {
        store.set('myb_roster_month', '3'); store.set('myb_roster_year', '2026'); store.set('myb_roster_month_at', '1');
        /** @type {any} */ (globalThis).document = { visibilityState: 'hidden' };
        try {
            setDisplayMonth(4); setDisplayYear(2026);   // May, browsed
            persistViewedMonth();
            setDisplayMonth(6); setDisplayYear(2026);   // July, today
            persistViewedMonth();
        } finally { delete /** @type {any} */ (globalThis).document; }
        assert.deepEqual([store.get('myb_roster_month'), store.get('myb_roster_year'), store.get('myb_roster_month_at')], ['3', '2026', '1']);
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
            const m = await import('../calendar-state.js?launch=' + tag);
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

    test('a month the member BROWSED back to is restored for half an hour — and not the next day', async () => {
        // The other direction. Within the half hour (the app reloaded behind another one, a trip to
        // another page and back) the member's own month comes back; the next day it is today's again
        // (owner, 15 Nov 2026 — before, it stayed until somebody came back to today's month).
        store.clear();
        await launchAt(new Date(2026, 10, 15, 12), 'browse', m => { m.setDisplayMonth(9); m.setDisplayYear(2026); });
        assert.equal(await launchAt(new Date(2026, 10, 15, 12, 20), 'browse-soon'), '9/2026',
            'twenty minutes later the member\'s own month was dropped');
        assert.equal(await launchAt(new Date(2026, 11, 1, 5, 30), 'browse-next'), '11/2026',
            'a month browsed to a fortnight ago was restored over today');
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
            hide: () => { doc.visibilityState = 'hidden'; handlers.visibilitychange?.(); },
            show: () => { doc.visibilityState = 'visible'; handlers.visibilitychange?.(); },
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

    test('a month the member browsed to is left where it is when they are back within half an hour — across midnight too', () => {
        const r = rig('2026-11-30T23:50:00');
        setDisplayMonth(9); setDisplayYear(2026);   // October, browsed back to
        let calls = 0;
        watchLocalDate(() => { calls++; }, r.env);
        r.hide();
        r.set('2026-12-01T00:10:00'); r.show();
        assert.deepEqual([getDisplayMonth(), getDisplayYear()], [9, 2026],
            'the date turning took the member off a month they had chosen');
        assert.equal(calls, 1, 'the date turned, so Today has to be redrawn');
    });

    // v26.19 (owner, 15 Nov 2026): "It always reopens on June 2026." An app left in memory is not
    // reloaded when it is opened again — it is just shown — so the restore's half-hour rule only held
    // when the phone had happened to close it. Back after longer than that: today's month.
    test('back after more than half an hour, a browsed month returns to today\'s — and repaints on the same day', () => {
        const r = rig('2026-11-15T12:00:00');
        setDisplayMonth(5); setDisplayYear(2026);   // June, browsed back to
        let calls = 0;
        watchLocalDate(() => { calls++; }, r.env);
        r.hide();
        r.set('2026-11-15T12:31:00'); r.show();
        assert.deepEqual([getDisplayMonth(), getDisplayYear()], [10, 2026], 'opened again after half an hour, still on June');
        assert.equal(calls, 1, 'the month moved but nothing redrew it');
    });

    test('back after EXACTLY half an hour it stays — the boundary is the restore\'s', () => {
        const r = rig('2026-11-15T12:00:00');
        setDisplayMonth(5); setDisplayYear(2026);
        let calls = 0;
        watchLocalDate(() => { calls++; }, r.env);
        r.hide();
        r.set('2026-11-15T12:30:00'); r.show();
        assert.deepEqual([getDisplayMonth(), getDisplayYear()], [5, 2026]);
        assert.equal(calls, 0);
    });

    test('the time away counts from the FIRST time the page went out of sight', () => {
        const r = rig('2026-11-15T12:00:00');
        setDisplayMonth(5); setDisplayYear(2026);
        watchLocalDate(() => {}, r.env);
        r.hide();
        r.set('2026-11-15T12:20:00'); r.hide();   // a second "hidden" with no "visible" between
        r.set('2026-11-15T12:40:00'); r.show();
        assert.deepEqual([getDisplayMonth(), getDisplayYear()], [10, 2026],
            'the second hidden event restarted the clock: forty minutes away counted as twenty');
    });

    test('two short trips away are not added together', () => {
        const r = rig('2026-11-15T12:00:00');
        setDisplayMonth(5); setDisplayYear(2026);
        watchLocalDate(() => {}, r.env);
        r.hide(); r.set('2026-11-15T12:20:00'); r.show();   // twenty minutes away
        r.set('2026-11-15T12:25:00'); r.hide();
        r.set('2026-11-15T12:45:00'); r.show();             // and twenty more
        assert.deepEqual([getDisplayMonth(), getDisplayYear()], [5, 2026],
            'the first absence was still counted when the second ended: two short trips took the member off June');
    });

    // TEAM VIEW (16 Nov 2026): its week is not this module's, so the listener is told what changed and
    // the watcher is told when Team View is off this week — or a long absence on today's month redrew
    // nothing, and a Team View left on a browsed week stayed there.
    test('the listener is told the date it last saw, the date now, and whether the page was away', () => {
        const r = rig('2026-11-14T22:00:00');
        setDisplayMonth(10); setDisplayYear(2026);
        /** @type {any[]} */ const seen = [];
        watchLocalDate((change) => { seen.push(change); }, r.env);
        r.set('2026-11-15T07:30:00'); r.resume();
        assert.equal(seen.length, 1);
        assert.equal(seen[0].was.getDate(), 14);
        assert.equal(seen[0].now.getDate(), 15);
        assert.equal(seen[0].away, false);
        r.hide(); r.set('2026-11-15T09:00:00'); r.show();
        assert.equal(seen.length, 1, 'premise: on today\'s month with nothing off today, a long absence redraws nothing');
    });

    test('long away on today\'s month, with Team View OFF this week, repaints — and says it was away', () => {
        const r = rig('2026-11-15T12:00:00');
        setDisplayMonth(10); setDisplayYear(2026);
        /** @type {any[]} */ const seen = [];
        let off = true;
        watchLocalDate((change) => { seen.push(change); off = false; }, { ...r.env, offToday: () => off });
        r.hide(); r.set('2026-11-15T12:20:00'); r.show();
        assert.equal(seen.length, 0, 'twenty minutes away: the browsed week stays');
        r.hide(); r.set('2026-11-15T13:00:00'); r.show();
        assert.equal(seen.length, 1, 'forty minutes away on a browsed week, and nothing redrew it');
        assert.equal(seen[0].away, true);
    });

    test('long away on TODAY\'s month, on the same day, redraws nothing', () => {
        const r = rig('2026-11-15T12:00:00');
        setDisplayMonth(10); setDisplayYear(2026);  // November — today's month
        let calls = 0;
        watchLocalDate(() => { calls++; }, r.env);
        r.hide();
        r.set('2026-11-15T15:00:00'); r.show();
        assert.equal(calls, 0, 'a page already on today repainted for nothing');
    });
});
