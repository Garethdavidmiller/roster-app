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

import { test, describe, mock, beforeEach } from 'node:test';
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

globalThis.document = /** @type {any} */ ({ querySelectorAll: () => [] });

// ── THE MOCKED EDGES ────────────────────────────────────────────────────────────────────────────

/** Answers `getOvertimeManagerOverview` will give, in order — each may be a promise to resolve. */
let overviewQueue = [];
/** Answers `loadWeekDetail` will give, keyed by week; a function is called with a `resolve` gate. */
let detailFor = new Map();
/** Every week handed to the renderer, in paint order — the record the first block reads. */
let painted = [];

mock.module('./overtime-data.js', {
    namedExports: {
        correctedNow: () => Date.parse('2026-08-20T09:00:00Z'),
        getOvertimeManagerOverview: async () => overviewQueue.shift() ?? { ok: true, data: { planningWeeks: [], retained: [] } },
        loadWeekDetail: async (weekEnding) => {
            const entry = detailFor.get(weekEnding);
            return typeof entry === 'function' ? entry() : (entry ?? { ok: false });
        },
        withdrawOvertimeParticipant: async () => ({ ok: true }),
    },
});

mock.module('./overtime-manager.js', {
    namedExports: {
        renderWeekDetail: (_host, win, data, opts) => {
            painted.push({ weekEnding: win.weekEnding, dates: opts.dates, grade: opts.grade, day: opts.day, opts });
        },
    },
});

mock.module('./overlay.js', { namedExports: { confirmDialog: async () => true } });

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

/** Let every pending read settle — a macrotask, because these chains are more than one await deep. */
const settle = () => new Promise(r => setTimeout(r, 0));

function makeController(over = {}) {
    return createReviewController({
        el, esc: (/** @type {any} */ s) => String(s ?? ''),
        renderLoading: (/** @type {any} */ host, /** @type {string} */ m) => { host.innerHTML = `LOADING:${m}`; },
        renderError: (/** @type {any} */ host) => { host.innerHTML = 'ERROR'; },
        detailRefreshDebounceMs: over.debounce ?? 30_000,
    });
}

beforeEach(() => {
    dom = {};
    overviewQueue = [];
    detailFor = new Map();
    painted = [];
});

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
        c.refreshSelectedIfStale();
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

        c.refreshSelectedIfStale();
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
        c.refreshSelectedIfStale();
        await settle();
        assert.equal(painted.length, 0, 'inside the debounce, nothing is re-read');
    });

    test('and a week left open long enough is', async () => {
        // The other direction costs the reviewer the whole point of the card: a workspace that
        // does not live-update reads as current while going stale.
        detailFor.set(A, detail(4, 1));

        const c = makeController({ debounce: 0 });
        await boot(c, [WEEK_A]);
        await c.selectWeek(A);
        painted.length = 0;
        c.refreshSelectedIfStale();
        await settle();
        assert.equal(painted.length, 1, 'past the debounce it refreshes');
    });
});
