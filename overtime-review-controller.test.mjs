/**
 * overtime-review-controller.test.mjs — WHICH WEEK IS ON SCREEN, AND WHICH WEEK THE DATA IS FROM.
 * Run with: node --experimental-test-module-mocks --test overtime-review-controller.test.mjs
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────────────────────────
 *
 * `overtime-review-controller.js` had no unit suite. Its header states the invariant plainly —
 * eight pieces of state exist so that several asynchronous reads cannot disagree about which week
 * the reviewer is looking at — and nothing was checking any of it. The e2e drives the workspace
 * through a browser, but a browser cannot choose which of two in-flight reads resolves last, which
 * is the only condition under which any of these guards does anything.
 *
 * ── ORGANISED BY WHAT A WRONG ANSWER COSTS ──────────────────────────────────────────────────────
 *
 *   1. ONE WEEK'S ANSWERS UNDER ANOTHER WEEK'S HEADING. The expensive direction, and it is silent
 *      in the worst possible way: a complete, well-formed availability workspace with a date range
 *      at the top of it. A roster clerk rings the people who said yes — to a different week. Every
 *      guard in the first block is a door to that, and each is one line.
 *   2. A RATIO THAT DISAGREES WITH THE CARD UNDER IT. `4/6` beside a card reading "4 of 5" gives
 *      the reader two answers and no way to tell which is stale. The chip is written only by a
 *      read that has been allowed to paint, and cleared the moment the week changes.
 *   3. A CARD STRANDED ON A WEEK THAT NO LONGER EXISTS. Retention moves under a long session. A
 *      silent return leaves the previous week's workspace up, captioned with the new week's name.
 *   4. A LENS THAT SURVIVES THE WRONG THING. The grade is a way of working and belongs to the
 *      reviewer; the day lens names one window's own dates, so carrying it into another week filters
 *      by a date that week does not have. Cheap, but it makes a full week look empty.
 *
 * ── THE HARNESS ────────────────────────────────────────────────────────────────────────────────
 *
 * The four DOM helpers are already injected, which is what makes this testable at all. Beyond them
 * the controller touches a handful of elements by id and one `document.querySelectorAll`, so the
 * fake DOM answers by name.
 *
 * `overtime-manager.js` is MOCKED rather than real, and that is the point of the first block: the
 * question is not what the workspace renders but WHICH week's data it was handed, so the paint is
 * recorded instead of performed. `overtime-format.js` stays real — its words are what the rows and
 * the chip are made of.
 */

import { test, describe, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// ── THE FAKE DOM ────────────────────────────────────────────────────────────────────────────────

function fakeEl(id) {
    return {
        id, innerHTML: '', textContent: '', hidden: true,
        querySelectorAll: () => [], querySelector: () => null,
        addEventListener() {}, setAttribute() {}, scrollIntoView() {},
    };
}

/** @type {Record<string, any>} */
let dom = {};
const el = (/** @type {string} */ id) => (dom[id] ||= fakeEl(id));

globalThis.document = /** @type {any} */ ({ querySelectorAll: () => [], body: { style: {} } });

// ── THE MOCKED EDGES ────────────────────────────────────────────────────────────────────────────

/** Answers `getOvertimeManagerOverview` will give, in order — each may be a promise to resolve. */
let overviewQueue = [];
/** How many times the overview was read — the horizon's own freshness is a count of these. */
let overviewReads = 0;
/** Answers `loadWeekDetail` will give, keyed by week; a function is called with a `resolve` gate. */
let detailFor = new Map();
/** Every week handed to the renderer, in paint order — the record the first block reads. */
let painted = [];
/** Answers `createOvertimeWindow` will give (preview, commit and top-up share it), in order. */
let createQueue = [];
/** When set, `withdrawOvertimeParticipant` returns what this gives — a promise the test resolves. */
let withdrawHold = /** @type {null | (() => any)} */ (null);

mock.module('./overtime-data.js', {
    namedExports: {
        correctedNow: () => Date.parse('2026-08-20T09:00:00Z'),
        getOvertimeManagerOverview: async () => {
            overviewReads++;
            return overviewQueue.shift() ?? { ok: true, data: { planningWeeks: [], retained: [] } };
        },
        loadWeekDetail: async (weekEnding) => {
            const entry = detailFor.get(weekEnding);
            return typeof entry === 'function' ? entry() : (entry ?? { ok: false });
        },
        withdrawOvertimeParticipant: async () => (withdrawHold ? withdrawHold() : { ok: true }),
        createOvertimeWindow: async () => createQueue.shift() ?? { ok: true, data: { added: [] } },
    },
});

/** Every restamp of the sheet's "Printed …" line, as [host, instant]. */
let stamped = /** @type {any[]} */ ([]);
/** What the workspace reports it opened on — the real one says when it fell back to All grades. */
let opensOn = /** @type {null | ((grade: string) => string)} */ (null);
mock.module('./overtime-manager.js', {
    namedExports: {
        renderWeekDetail: (_host, win, data, opts) => {
            painted.push({ weekEnding: win.weekEnding, phase: win.phase, dates: opts.dates, grade: opts.grade, day: opts.day, data, opts });
            return { grade: opensOn ? opensOn(opts.grade) : opts.grade };
        },
        stampPrinted: (/** @type {any} */ host, /** @type {number} */ at) => { stamped.push([host, at]); },
    },
});

/** The page's window, as far as the controller uses it: the listeners it adds. */
const windowListeners = /** @type {Record<string, Function>} */ ({});
globalThis.window = /** @type {any} */ ({ addEventListener: (/** @type {string} */ t, /** @type {Function} */ f) => { windowListeners[t] = f; } });

/** Every confirmation the controller asked for, in order — its words are part of what it promises. */
let dialogs = /** @type {any[]} */ ([]);
mock.module('./overlay.js', { namedExports: { confirmDialog: async (/** @type {any} */ o) => { dialogs.push(o); return true; } } });

const { createReviewController } = await import('./overtime-review-controller.js');

// ── THE HORIZON ─────────────────────────────────────────────────────────────────────────────────

const A = '2026-09-05';
const B = '2026-09-12';

/** A created, open week as the overview returns it. */
function week(weekEnding, weekStart, over = {}) {
    return {
        weekEnding, weekStart, exists: true, state: 'created', canCreate: false,
        expected: 5, received: 2, canAdd: 0,
        initialDeadlineAt: Date.parse('2026-08-25T11:00:00Z'),
        finalDeadlineAt: Date.parse('2026-09-01T11:00:00Z'),
        ...over,
    };
}
const WEEK_A = week(A, '2026-08-30');
const WEEK_B = week(B, '2026-09-06');

/** A detail payload: `n` participants, the first `m` of whom have answered. */
function detail(n, m) {
    const participants = Array.from({ length: n }, (_, i) => ({ memberName: `P${i}`, grade: 'CEA', rosterOrder: i }));
    const submissions = new Map(participants.slice(0, m).map(p => [p.memberName, { memberName: p.memberName, days: {} }]));
    return { ok: true, participants, submissions, revisions: [] };
}

/** A detail read the test decides when to answer. */
function gated(payload) {
    let release;
    const gate = new Promise(res => { release = res; });
    return { fn: () => gate.then(() => payload), release: () => release() };
}

/**
 * Put weeks into the controller's week map without tripping the auto-select.
 *
 * `loadHorizon` opens the week being planned by itself, which is right for the page and in the way
 * here — most of these cases are about a selection the TEST makes. Retained weeks land in the same
 * map and are not candidates for the lead, so this seeds without choosing.
 */
async function boot(c, weeks) {
    overviewQueue.unshift({ ok: true, data: { planningWeeks: [], retained: weeks } });
    await c.loadHorizon();
    painted.length = 0;
}

/** Let every pending read settle — a macrotask, because these chains are more than one await deep.
 *  `setImmediate` rather than `setTimeout(0)`, because setTimeout is MOCKED in this file (below). */
const settle = () => new Promise(r => setImmediate(r));

function makeController(over = {}) {
    return createReviewController({
        el, esc: (/** @type {any} */ s) => String(s ?? ''),
        renderLoading: (/** @type {any} */ host, /** @type {string} */ m) => { host.innerHTML = `LOADING:${m}`; },
        renderError: (/** @type {any} */ host, /** @type {any} */ retry) => { host.innerHTML = 'ERROR'; host.retry = retry; },
        detailRefreshDebounceMs: over.debounce ?? 30_000,
    });
}

beforeEach(() => {
    dom = {};
    overviewQueue = [];
    overviewReads = 0;
    detailFor = new Map();
    painted = [];
    createQueue = [];
    withdrawHold = null;
    dialogs = [];
    opensOn = null;
    // A success flash arms a REAL 2.5-second auto-hide that no test here waits for, and it held the
    // process open after the last test: 2.7 s of wall for ~60 ms of tests (test audit, 7 Nov 2026).
    // Mocked, it is a fake timer that the reset below throws away.
    mock.timers.enable({ apis: ['setTimeout'] });
});
afterEach(() => { mock.timers.reset(); });

// ────────────────────────────────────────────────────────────────────────────────────────────────
describe('an older read must never paint over a newer selection', () => {
// ────────────────────────────────────────────────────────────────────────────────────────────────

    test('week A\'s answers, arriving after the reviewer moved to week B, are dropped', async () => {
        // The classic late read. Both weeks are real and both payloads are valid, so there is
        // nothing anywhere to notice: the workspace renders A's availability under B's name and a
        // clerk plans B from it.
        const slowA = gated(detail(6, 6));
        detailFor.set(A, slowA.fn);
        detailFor.set(B, detail(4, 1));

        const c = makeController();
        await boot(c, [WEEK_A, WEEK_B]);
        const first = c.selectWeek(A);      // in flight
        await c.selectWeek(B);              // the reviewer moves on; B lands first
        slowA.release();
        await first;

        assert.deepEqual(painted.map(p => p.weekEnding), [B], 'only the selected week is ever painted');
        assert.equal(dom.otWeekChip.textContent, '1/4', 'and the ratio is the selected week\'s');
    });

    test('a superseded read of the SAME week is dropped too — the week guard cannot see it', async () => {
        // Two reads of one week, the older resolving last. `selectedWeek` matches on both, so the
        // only thing standing between a reviewer and a stale count is the generation ticket. A
        // refresh pressed twice does exactly this.
        const slow = gated(detail(9, 9));
        detailFor.set(A, slow.fn);

        const c = makeController();
        await boot(c, [WEEK_A]);
        const first = c.selectWeek(A);
        detailFor.set(A, detail(4, 1));     // the second read sees the newer truth
        await c.selectWeek(A);
        slow.release();
        await first;

        assert.equal(painted.length, 1, 'the superseded read paints nothing');
        assert.equal(dom.otWeekChip.textContent, '1/4', 'the newer count stands');
    });

    test('an overview arriving after a newer one neither paints nor restocks the week map', async () => {
        // Three actions reload the horizon and two in quick succession put two reads in flight. The
        // older one painting last shows pre-action counts — and, worse, repopulates the map the
        // NEXT detail read takes its milestones from, so a week the newer read had dropped becomes
        // openable again from rows nobody is looking at.
        let releaseOld;
        const oldRead = new Promise(res => { releaseOld = res; });
        overviewQueue = [
            oldRead.then(() => ({ ok: true, data: { planningWeeks: [WEEK_A, WEEK_B], retained: [] } })),
            { ok: true, data: { planningWeeks: [WEEK_B], retained: [] } },
        ];
        detailFor.set(B, detail(4, 1));

        const c = makeController();
        const first = c.loadHorizon();
        await c.loadHorizon();
        const afterNewer = dom.otHorizonContent.innerHTML;
        releaseOld();
        await first;

        assert.equal(dom.otHorizonContent.innerHTML, afterNewer, 'the stale rows never reach the card');

        // The map is not directly readable, so ask it the question the app asks it: week A is gone,
        // and a week that is gone must not open.
        await c.selectWeek(A);
        assert.match(dom.otWeekContent.innerHTML, /no longer available/, 'A did not come back with the stale read');
    });
});

// ────────────────────────────────────────────────────────────────────────────────────────────────
describe('a week that has gone says so, and leaves the chip able to come back', () => {
// ────────────────────────────────────────────────────────────────────────────────────────────────

    test('selecting a week the horizon does not hold clears the selection and reports it', async () => {
        // Retention moving under a long session. A silent return strands whatever the card is
        // showing — including a disabled "Refreshing…" button that nothing puts back.
        detailFor.set(B, detail(4, 1));
        overviewQueue = [{ ok: true, data: { planningWeeks: [WEEK_B], retained: [] } }];

        const c = makeController();
        await c.loadHorizon();
        assert.equal(painted.length, 1, 'the horizon opened the week it does hold');

        await c.selectWeek(A);
        assert.match(dom.otWeekContent.innerHTML, /no longer available/);
        assert.equal(dom.otWeekChip.textContent, '', 'the ratio is EMPTIED, not hidden');
        assert.equal(dom.otWeekChip.hidden, true, 'and nothing set a second mechanism nobody undoes');

        // The selection was cleared, so the visibility refresh has nothing to re-read — a card
        // reading "that week is gone" must not repopulate itself from the week it just disowned.
        painted.length = 0;
        c.refreshIfStale();
        await settle();
        assert.equal(painted.length, 0);
    });

    test('a week that ages out UNDER an open card takes its ratio down with it', async () => {
        // `selectWeek` clears the chip on the way in, so on that route the gone branch has nothing
        // to do — which is what made deleting its own clear look safe. The route that matters does
        // not go through `selectWeek` at all: the reviewer leaves the card open, the week crosses
        // retention, and the visibility refresh re-reads a week the map no longer holds. Without
        // this, `4/6` stays in the header over a card saying the week is gone, and the reader has
        // two answers and no way to tell which is the stale one.
        detailFor.set(A, detail(6, 4));
        overviewQueue = [{ ok: true, data: { planningWeeks: [WEEK_A], retained: [] } }];

        const c = makeController({ debounce: 0 });
        await c.loadHorizon();                       // opens A by itself
        assert.equal(dom.otWeekChip.textContent, '4/6');

        // A crosses retention while the card is open; the selection is untouched, so nothing has
        // re-entered through `selectWeek`.
        overviewQueue.unshift({ ok: true, data: { planningWeeks: [WEEK_B], retained: [] } });
        await c.loadHorizon();
        assert.equal(dom.otWeekChip.textContent, '4/6', 'still there — the card has not been re-read yet');

        c.refreshIfStale();
        await settle();
        assert.match(dom.otWeekContent.innerHTML, /no longer available/);
        assert.equal(dom.otWeekChip.textContent, '', 'and the ratio goes with the card it described');
    });

    test('the next horizon load puts the reviewer back on a real week', async () => {
        // Why the gone branch CLEARS the selection rather than merely reporting. The auto-select
        // only runs when nothing is selected, so a stranded `selectedWeek` naming a week that no
        // longer exists suppresses it — for the rest of the session. The reviewer sits on "pick a
        // week above" while every reload of the card walks straight past a week it could open, and
        // the only thing wrong is one variable holding a name nothing can resolve.
        detailFor.set(B, detail(4, 1));

        const c = makeController();
        await boot(c, [WEEK_A]);
        await c.selectWeek(B);              // gone, because only A was seeded
        assert.match(dom.otWeekContent.innerHTML, /no longer available/);

        overviewQueue.unshift({ ok: true, data: { planningWeeks: [WEEK_B], retained: [] } });
        await c.loadHorizon();

        assert.deepEqual(painted.map(p => p.weekEnding), [B], 'the card recovers on its own');
    });

    test('and a read still in flight does not paint over the message', async () => {
        // The one state where the generation ticket is NOT enough, found by deleting the guard
        // beside it and watching every other case stay green. Landing on a week that has gone
        // returns BEFORE taking a ticket — there is nothing to read — so it clears the selection
        // without advancing the generation. An earlier week's read is then still the newest one
        // there is, and it paints its workspace, and its ratio, straight over the sentence saying
        // no week is selected.
        const slowA = gated(detail(6, 6));
        detailFor.set(A, slowA.fn);

        const c = makeController();
        await boot(c, [WEEK_A]);            // A is known; B is not
        const first = c.selectWeek(A);
        await c.selectWeek(B);              // gone — clears the selection, takes no ticket
        slowA.release();
        await first;

        assert.equal(painted.length, 0, 'nothing is painted under a card that says to pick a week');
        assert.match(dom.otWeekContent.innerHTML, /no longer available/);
        assert.equal(dom.otWeekChip.textContent, '', 'and no ratio arrives for a week nobody chose');
    });

    test('a week that CAN be shown writes a ratio into the same chip afterwards', async () => {
        // The other half of "one way it goes away, one way it comes back": the v21.94 defect was
        // that the gone-branch hid the chip permanently, so this is what proves it did not.
        detailFor.set(A, detail(4, 1));
        detailFor.set(B, detail(6, 6));
        overviewQueue = [{ ok: true, data: { planningWeeks: [WEEK_B], retained: [] } }];

        const c = makeController();
        await c.loadHorizon();
        await c.selectWeek(A);                       // gone — empties the chip
        assert.equal(dom.otWeekChip.textContent, '');
        await c.selectWeek(B);
        assert.equal(dom.otWeekChip.textContent, '6/6', 'a later week still gets its ratio');
    });

    test('a carried grade the week does not hold is counted as the workspace drew it — All grades (overtime-ui-8)', async () => {
        // The workspace falls back to All grades and leaves the reviewer's choice alone (it comes
        // back on a week that holds it); the chip went on counting the absent grade: "0/0" over
        // "1 of 2 forms received".
        detailFor.set(A, detail(4, 1));
        const c = makeController();
        await boot(c, [WEEK_A]);
        await c.selectWeek(A);
        painted.at(-1).opts.onGrade('CES');   // the reviewer works CES …
        opensOn = () => 'ALL';                // … on a week whose population holds none
        await c.selectWeek(A);
        assert.equal(painted.at(-1).grade, 'CES', 'the choice is still handed in — it is the reviewer\'s');
        assert.equal(dom.otWeekChip.textContent, '1/4', 'and the chip counts what the card does');
    });

    test('a past week chosen before a horizon reload is still marked as chosen after it (css lead)', async () => {
        // Its View button was built with no `aria-pressed`, unlike a horizon row's, so any reload of
        // the list — every Refresh now — unmarked the week on screen.
        const PAST = week('2026-08-15', '2026-08-09');
        detailFor.set(PAST.weekEnding, detail(2, 1));
        const c = makeController();
        await boot(c, [PAST]);
        await c.selectWeek(PAST.weekEnding);
        overviewQueue.push({ ok: true, data: { planningWeeks: [], retained: [PAST] } });
        await c.loadHorizon();
        assert.match(dom.otHorizonContent.innerHTML, /data-open="2026-08-15"\s+aria-pressed="true"/);
    });
});

// ────────────────────────────────────────────────────────────────────────────────────────────────
describe('the two lenses survive different things, on purpose', () => {
// ────────────────────────────────────────────────────────────────────────────────────────────────

    test('the grade crosses a week switch and the day does not', async () => {
        // They look like one feature and are two. A grade is how this reviewer works and should
        // follow them; a day lens names one window's own dates, so carried across it filters by a
        // date the new week does not contain — which renders as a week where nobody is available.
        detailFor.set(A, detail(4, 1));
        detailFor.set(B, detail(4, 1));

        const c = makeController();
        await boot(c, [WEEK_A, WEEK_B]);
        await c.selectWeek(A);
        painted.at(-1).opts.onGrade('CES');
        painted.at(-1).opts.onDay('2026-08-31');

        await c.selectWeek(B);
        assert.equal(painted.at(-1).grade, 'CES', 'the grade is the reviewer\'s, not the week\'s');
        assert.equal(painted.at(-1).day, 'ALL', 'the day lens belongs to the week that has been left');
    });

    test('a refresh of the SAME week keeps the day lens it was given', async () => {
        detailFor.set(A, detail(4, 1));

        const c = makeController({ debounce: 0 });
        await boot(c, [WEEK_A]);
        await c.selectWeek(A);
        painted.at(-1).opts.onDay('2026-08-31');
        await painted.at(-1).opts.onRefresh();

        assert.equal(painted.at(-1).day, '2026-08-31', 'a refresh is not a switch');
    });
});

// ────────────────────────────────────────────────────────────────────────────────────────────────
describe('the visibility refresh asks before it re-reads', () => {
// ────────────────────────────────────────────────────────────────────────────────────────────────

    test('a week read a moment ago is not read again', async () => {
        // Coming back to a tab is not evidence anything changed, and this fires on every return.
        detailFor.set(A, detail(4, 1));

        const c = makeController({ debounce: 30_000 });
        await boot(c, [WEEK_A]);
        await c.selectWeek(A);
        painted.length = 0;
        const reads = overviewReads;
        c.refreshIfStale();
        await settle();
        assert.equal(painted.length, 0, 'inside the debounce, nothing is re-read');
        assert.equal(overviewReads, reads, 'the horizon included');
    });

    test('and a week left open long enough is', async () => {
        // The other direction costs the reviewer the whole point of the card: a workspace that
        // does not live-update reads as current while going stale.
        detailFor.set(A, detail(4, 1));

        const c = makeController({ debounce: 0 });
        await boot(c, [WEEK_A]);
        await c.selectWeek(A);
        painted.length = 0;
        const reads = overviewReads;
        overviewQueue.push({ ok: true, data: { planningWeeks: [], retained: [WEEK_A] } });
        c.refreshIfStale();
        await settle();
        assert.equal(painted.length, 1, 'past the debounce it refreshes');
        // The HORIZON too (overtime-ui-3): a week the 05:00 run failed to open went on reading
        // "Opens automatically overnight" all morning, over a week card that had re-read itself.
        assert.equal(overviewReads, reads + 1, 'and the horizon above it is re-read with it');
    });
});

// ────────────────────────────────────────────────────────────────────────────────────────────────
describe('Refresh re-reads the horizon too, and a re-read that fails keeps what is on screen', () => {
// ────────────────────────────────────────────────────────────────────────────────────────────────

    test('the Refresh button re-reads the horizon as well as the week (overtime-ui-3)', async () => {
        // The row could say "2 of 5 forms received" over a card that, after Refresh, said 4 of 5.
        detailFor.set(A, detail(4, 1));
        const c = makeController();
        await boot(c, [WEEK_A]);
        await c.selectWeek(A);
        const reads = overviewReads;
        overviewQueue.push({ ok: true, data: { planningWeeks: [], retained: [WEEK_A] } });
        await painted.at(-1).opts.onRefresh();
        await settle();
        assert.equal(overviewReads, reads + 1);
    });

    test('a horizon being refreshed stays on screen, and one that fails to refresh says so', async () => {
        detailFor.set(A, detail(4, 1));
        const c = makeController();
        await boot(c, [WEEK_A]);
        await c.selectWeek(A);
        /** @type {any} */ let land;
        overviewQueue.push(new Promise(r => { land = r; }));
        const refreshing = painted.at(-1).opts.onRefresh();
        await settle();
        assert.match(dom.otHorizonContent.innerHTML, /ot-week-list/, 'no loading line over the list being refreshed');
        land({ ok: false, code: 'network' });
        await refreshing; await settle();
        const html = dom.otHorizonContent.innerHTML;
        assert.match(html, /ot-week-list/, 'the rows already read are kept');
        assert.match(html, /Couldn't refresh just now — this list is as at /, 'and it says how old they are');
        assert.notEqual(html, 'ERROR');
    });

    test('a failed re-read of the week on screen keeps that snapshot and says so (overtime-ui-11)', async () => {
        // The phone unlocks, the automatic re-read runs before the signal is back, and the list a
        // clerk was ringing round from was replaced by "Couldn't load" — though it carried an honest
        // "as at" time. Keep it; say the refresh failed; let the next return try again.
        const first = detail(4, 1);
        const answers = [first, { ok: false }];
        detailFor.set(A, () => answers.shift());
        const c = makeController({ debounce: 0 });
        await boot(c, [WEEK_A]);
        await c.selectWeek(A);
        const shownAt = painted.at(-1).opts.now;
        overviewQueue.push({ ok: true, data: { planningWeeks: [], retained: [WEEK_A] } });
        c.refreshIfStale();
        await settle();
        assert.notEqual(dom.otWeekContent.innerHTML, 'ERROR', 'the snapshot is not taken away');
        const again = painted.at(-1);
        assert.equal(again.opts.refreshFailed, true, 'the workspace is told the refresh failed');
        assert.equal(again.data, first, 'and still draws the data it had');
        assert.equal(again.opts.now, shownAt, 'with the time that data was read, not a newer one');
        assert.equal(dom.otWeekChip.textContent, '1/4', 'the chip still agrees with the card');
    });

    test('…but a week with nothing on screen yet still gets the error card and its retry', async () => {
        detailFor.set(A, { ok: false });
        const c = makeController();
        await boot(c, [WEEK_A]);
        await c.selectWeek(A);
        assert.equal(dom.otWeekContent.innerHTML, 'ERROR');
        assert.equal(typeof dom.otWeekContent.retry, 'function');
    });
});

// ────────────────────────────────────────────────────────────────────────────────────────────────
describe('the phase the workspace draws is the phase the week is in NOW', () => {
// ────────────────────────────────────────────────────────────────────────────────────────────────

    // The overview's rows are built from stored milestones and have never carried `phase` — only
    // `getMyOvertimeState` sends one. The workspace keys two things on it: a CLOSED week shows
    // "Who was asked" with no Stop-asking buttons (the server refuses them with `closed`), and a
    // FINAL_OPEN week reports whether the reminder went. With no phase, every week read as open
    // and no week ever reported its reminder. correctedNow() is pinned at 20 Aug 09:00 UTC.
    const at = (/** @type {string} */ iso) => Date.parse(iso);

    test('a server-shaped row with no phase is handed over with the phase derived from the clock', async () => {
        const closed = week(A, '2026-08-30', {
            initialDeadlineAt: at('2026-08-11T11:00:00Z'), finalDeadlineAt: at('2026-08-18T11:00:00Z') });
        const final = week(B, '2026-09-06', {
            initialDeadlineAt: at('2026-08-18T11:00:00Z'), finalDeadlineAt: at('2026-08-25T11:00:00Z') });
        const open = week('2026-09-19', '2026-09-13');   // deadlines 25 Aug / 1 Sep
        for (const w of [closed, final, open]) assert.equal('phase' in w, false, 'the fixture is server-shaped');
        detailFor.set(A, detail(2, 1));
        detailFor.set(B, detail(2, 1));
        detailFor.set('2026-09-19', detail(2, 1));

        const c = makeController();
        await boot(c, [closed, final, open]);
        await c.selectWeek(A);
        await c.selectWeek(B);
        await c.selectWeek('2026-09-19');
        assert.deepEqual(painted.map(p => p.phase), ['CLOSED', 'FINAL_OPEN', 'INITIAL_OPEN']);
    });

    test('and the clock outranks a phase the row happens to carry', async () => {
        // A row read at 11:59 and viewed at 12:01 is the case: the phase belongs to the moment.
        const stale = week(A, '2026-08-30', { phase: 'INITIAL_OPEN',
            initialDeadlineAt: at('2026-08-11T11:00:00Z'), finalDeadlineAt: at('2026-08-18T11:00:00Z') });
        detailFor.set(A, detail(2, 1));
        const c = makeController();
        await boot(c, [stale]);
        await c.selectWeek(A);
        assert.equal(painted.at(-1).phase, 'CLOSED');
    });
});

// ────────────────────────────────────────────────────────────────────────────────────────────────
describe('a failure retries what failed, and a message never re-arms a create', () => {
// ────────────────────────────────────────────────────────────────────────────────────────────────

    test('a horizon that fails to load retries the HORIZON, not the whole page', async () => {
        // The page's default retry is loadEverything, which rebuilds the member's own form too —
        // so a reviewer who is also a participant lost a half-filled form to a Try again pressed
        // on a different card.
        overviewQueue = [{ ok: false, code: 'network' }];
        const c = makeController();
        await c.loadHorizon();
        const retry = dom.otHorizonContent.retry;
        assert.equal(typeof retry, 'function', 'the error is given its own retry');
        overviewQueue = [{ ok: true, data: { planningWeeks: [], retained: [] } }];
        await retry();
        assert.equal(overviewQueue.length, 0, 'which re-reads the overview');
        assert.match(dom.otHorizonContent.innerHTML, /ot-week-list/, 'and paints the horizon');
    });

    /** Horizon buttons the fake DOM can press. */
    function fakeButton(attr, value) {
        const on = [];
        return {
            textContent: 'x', disabled: false, classList: { add() {}, remove() {} },
            getAttribute: (/** @type {string} */ a) => (a === attr ? value : null),
            setAttribute() {},
            addEventListener: (/** @type {string} */ _t, /** @type {any} */ f) => on.push(f),
            press: () => Promise.all(on.map(f => f())),
        };
    }

    async function armedFor(weekEnding, topupWeek) {
        const create = fakeButton('data-create', weekEnding);
        const topup = fakeButton('data-topup', topupWeek);
        dom.otHorizonContent = { ...fakeEl('otHorizonContent'),
            querySelectorAll: (/** @type {string} */ s) =>
                (s === '[data-create]' ? [create] : s === '[data-topup]' ? [topup] : []) };
        const c = makeController();
        await boot(c, [WEEK_A]);
        createQueue = [{ ok: true, data: { window: { ...WEEK_A, audience: 'restricted', expectedCount: 1 } } }];
        await create.press();
        assert.equal(dom.otConfirmCreate.disabled, false, 'the preview armed Create for its week');
        return { c, topup };
    }

    test('an "Add N" message does not leave an earlier preview armed beneath it', async () => {
        // Preview week A, then press Add on week B without cancelling. The bar now reads "Added to
        // B" — and its Create button was live, one press from creating A under a message about B.
        const { topup } = await armedFor('2026-09-26', B);
        createQueue = [{ ok: true, data: { added: ['P9'] } }];
        await topup.press();
        assert.match(dom.otConfirmText.innerHTML, /Added to/);
        assert.equal(dom.otConfirmCreate.disabled, true, 'Create is disarmed under an unrelated message');
    });

    test('nor does a Stop-asking message', async () => {
        detailFor.set(A, detail(2, 1));
        const { c } = await armedFor('2026-09-26', B);
        await c.selectWeek(A);
        await painted.at(-1).opts.onAsk('P0', false);
        assert.match(dom.otConfirmText.innerHTML, /no longer being asked/);
        assert.equal(dom.otConfirmCreate.disabled, true);
    });

    test('nor a preview that LANDS while Stop asking is out (whole-app review, Nov 2026)', async () => {
        // Stop asking is not a button a preview locks. A preview still preparing when it was
        // pressed landed during that call and re-armed Create — and the message that followed
        // replaced the preview's question with Create still live for the preview's week.
        detailFor.set(A, detail(2, 1));
        const create = fakeButton('data-create', '2026-09-26');
        dom.otHorizonContent = { ...fakeEl('otHorizonContent'),
            querySelectorAll: (/** @type {string} */ s) => (s === '[data-create]' ? [create] : []) };
        const c = makeController();
        await boot(c, [WEEK_A]);
        await c.selectWeek(A);
        /** @type {any} */ let landPreview;
        createQueue = [new Promise(r => { landPreview = () => r({ ok: true,
            data: { window: { ...WEEK_A, audience: 'restricted', expectedCount: 1 } } }); })];
        /** @type {any} */ let landWithdraw;
        withdrawHold = () => new Promise(r => { landWithdraw = () => r({ ok: true }); });
        const previewing = create.press();
        const asking = painted.at(-1).opts.onAsk('P0', false);
        await settle();
        landPreview(); await previewing;
        assert.equal(dom.otConfirmCreate.disabled, false, 'premise: the preview armed Create when it landed');
        landWithdraw(); await asking;
        assert.match(dom.otConfirmText.innerHTML, /no longer being asked/);
        assert.equal(dom.otConfirmCreate.disabled, true, 'Create is disarmed under the Stop-asking message');
    });
});

describe('a create that fails under ANOTHER week\'s question disarms (48-hour review, Nov 2026)', () => {
    // Commit does not lock the row buttons (only a preview does), so a reviewer can press Open now on
    // week B while week A's create is out. B's question lands and arms Create for B; A's create then
    // times out, and its message about A sat above a Create button armed for B — one press from
    // creating B, and creating a week freezes its population.
    function btn(/** @type {string} */ attr, /** @type {string|null} */ value) {
        /** @type {Function[]} */ const on = [];
        return { textContent: 'x', disabled: false, hidden: true, innerHTML: '', classList: { add() {}, remove() {} },
            getAttribute: (/** @type {string} */ a) => (a === attr ? value : null), setAttribute() {},
            addEventListener: (/** @type {string} */ _t, /** @type {Function} */ f) => on.push(f),
            press: () => Promise.all(on.map(f => f())) };
    }
    test('the timeout message about A leaves Create disarmed, not armed for B', async () => {
        const WA = '2026-09-26', WB = '2026-10-03';
        const createA = btn('data-create', WA), createB = btn('data-create', WB);
        dom.otHorizonContent = { ...fakeEl('otHorizonContent'),
            querySelectorAll: (/** @type {string} */ s) => (s === '[data-create]' ? [createA, createB] : []) };
        dom.otConfirmCreate = btn('x', null);
        dom.otConfirmCancel = btn('x', null);
        const c = makeController();
        await boot(c, [WEEK_A]);
        c.wireConfirmBar();
        createQueue = [{ ok: true, data: { window: { ...WEEK_A, weekEnding: WA, audience: 'restricted', expectedCount: 1 } } }];
        await createA.press();
        /** @type {any} */ let landCommit;
        createQueue = [new Promise(r => { landCommit = r; }),
            { ok: true, data: { window: { ...WEEK_A, weekEnding: WB, audience: 'restricted', expectedCount: 1 } } }];
        const committing = dom.otConfirmCreate.press();          // Create (A), held
        await settle();
        await createB.press();                                   // B's question lands meanwhile
        assert.equal(dom.otConfirmCreate.disabled, false, 'premise: B\'s preview armed Create for B');
        landCommit({ ok: false, code: 'timeout' });
        await committing;
        assert.match(dom.otConfirmText.innerHTML, /may still have been created/);
        assert.equal(dom.otConfirmCreate.disabled, true, 'a message about A must not sit over a Create armed for B');
    });
});

describe('the Stop-asking confirmation promises only the undo the rule allows (overtime-ui-2)', () => {
    // It said "you can put them back while the form is open". For a press made before the first
    // deadline that is false from the deadline on: Ask again is refused (`restore-window-passed`)
    // though the form stays open six more days — and the reviewer pressed on the strength of it.
    test('before the first deadline it says until then; after it, while the week is open', async () => {
        // The mocked clock reads 20 Aug: WEEK_A's first deadline (25 Aug) is ahead, LATE's behind.
        const LATE = week(B, '2026-09-06', { initialDeadlineAt: Date.parse('2026-08-18T11:00:00Z') });
        const both = () => ({ ok: true, data: { planningWeeks: [], retained: [WEEK_A, LATE] } });
        detailFor.set(A, detail(2, 1));
        detailFor.set(B, detail(2, 1));
        const c = makeController();
        await boot(c, [WEEK_A, LATE]);
        await c.selectWeek(A);
        overviewQueue.push(both());   // the re-read after the action keeps both weeks in the map
        await painted.at(-1).opts.onAsk('P0', false);
        assert.match(dialogs.at(-1).message, /put them back until the first deadline, Tue 25 Aug · 12:00\./);
        await c.selectWeek(B);
        overviewQueue.push(both());
        await painted.at(-1).opts.onAsk('P0', false);
        assert.match(dialogs.at(-1).message, /put them back while the week is open\./);
        assert.doesNotMatch(dialogs.map(d => d.message).join(' '), /while the form is open/);
    });
});

describe('the sheet says when it was PRINTED (overtime-ui-7)', () => {
    // "Printed …" was drawn once, at paint, by the device clock: two printouts of a week opened at
    // 09:00 and printed at 10:30 and 11:15 both read 09:00, on the line whose job is to order them.
    test('each paint is stamped by the corrected clock, and printing restamps the workspace', async () => {
        detailFor.set(A, detail(2, 1));
        stamped = [];
        const c = makeController();
        await boot(c, [WEEK_A]);
        await c.selectWeek(A);
        const NOW = Date.parse('2026-08-20T09:00:00Z');   // the mocked corrected clock
        assert.equal(painted.at(-1).opts.printedAt, NOW, 'the paint carries the corrected clock');
        assert.equal(typeof windowListeners.beforeprint, 'function', 'the page listens for printing');
        windowListeners.beforeprint();
        assert.equal(stamped.at(-1)?.[0], dom.otWeekContent, 'the workspace is restamped');
        assert.equal(stamped.at(-1)?.[1], NOW, 'by the corrected clock, as the as-at line beside it is');
    });
});
