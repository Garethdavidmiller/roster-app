/**
 * calendar-sequences.test.mjs — the Calendar's access, reads and redraws, driven through thousands of
 * seeded random ORDERS of events, with the rules that must hold whatever the order checked after every
 * event.
 * Run: node --experimental-test-module-mocks scripts/run-tests.mjs calendar-sequences.test.mjs
 *
 * ── WHY IT EXISTS (external review, 11 Nov 2026) ────────────────────────────────────────────────
 *
 * The Calendar's regressions have come from its STATE, and each one was an order of events nobody had
 * written a test for: an answer from an earlier grant kept under the next one (v25.63, F2), a failed
 * re-check that left a month drawn as current (F1), a retry that waited for ever (v25.69). The unit
 * suites test the orders their authors thought of, one at a time, and that stays the first line
 * (.claude/rules/calendar.md → "A change to the Calendar's state brings a test of the ORDER it could
 * break"). This file tries the orders nobody thought of: thousands of sequences of the events that
 * move the Calendar — access granted and lost, reads issued and answered in any order and every way,
 * swipes, the clock, a new name, Team View, Try again — through the REAL modules, with eight rules
 * checked after every event. The review's advice was to keep testing sequences of events alongside
 * individual functions; this is that advice made permanent, so the next change to the Calendar's state
 * meets it without anybody having to remember.
 *
 * ── WHAT IS REAL AND WHAT IS NOT ────────────────────────────────────────────────────────────────
 *
 * Real: calendar-access-state.js (whether access is held), calendar-overrides.js (the read ticket, the
 * month claims, the cache), calendar-data-state.js (what each month is known to be) and
 * calendar-redraw.js (when the page may draw).
 * Not real: Firestore — every read PARKS until the sequence answers it, so answers land in any order;
 * the scheduler's clock, which moves only on a tick; and the page. `calendar-app.js` cannot load
 * outside a browser, so `makePage` below wires the modules the way it does — the grant's two hooks in
 * the order calendar-access.js calls them, the ONE repaint every month read waits on, the lock card,
 * the first load's repaint, Try again — and each copied line names the line it copies, so a change to
 * the page that this file no longer matches can be found.
 *
 * Some events are deliberately WRONG callers: a read asked for while the Calendar is locked, the way a
 * future edit could misorder the page. The gates exist for exactly that caller. And a grant can land
 * on a Calendar that is already open: calendar-access.js grants only from locked today, but
 * calendar-access-state.js promises that every grant is a fresh start, open or shut, so the promise is
 * held here as well.
 *
 * ── THE RULES, CHECKED AFTER EVERY EVENT ────────────────────────────────────────────────────────
 *
 *   1. NOTHING IS READ WHILE LOCKED. No Firestore read — the server's or this device's cache — is
 *      issued while access is shut (CALENDAR_DATA.md 3).
 *   2. A LOCKED CALENDAR KNOWS NOTHING. While access is shut every month is `unknown`, so no grid can
 *      be drawn as a roster; a draw made while locked is checked as it happens.
 *   3. AN ANSWER NOBODY WANTS CHANGES NOTHING. An answer or a failure that lands after the access its
 *      read was issued under has gone, or been replaced by a new grant, leaves the cache, every
 *      month's knowledge, access itself and the page exactly as they were (CALENDAR_DATA.md 20).
 *      Rules 2 and 3 together are "no answer from before a lock is ever drawn after the next unlock".
 *   4. A WANTED ANSWER ARRIVES. A month read answered under the access it was issued under makes its
 *      month current, and reaches the page: drawn, held for the gesture, or Team View redrawn. And
 *      whenever the Calendar is on screen, holding access, with nothing held for a gesture and no read
 *      of its month still out, the screen is not waiting and not claiming more than is known: never
 *      "Checking this month" with nothing out to end it (the v20.40 and v20.41 waits), a month known
 *      current drawn as current, and nothing drawn as current that is not (the F1 failure). Without
 *      this rule, rules 1–3 could all pass by nothing ever happening.
 *   5. NOTHING IS DRAWN MID-GESTURE, NOR INTO TEAM VIEW, by a background repaint (the v16.23 freeze,
 *      the v16.21 paint into Team View).
 *   6. WHAT IS HELD IS SETTLED ONCE. Held work always has exactly one tick waiting for it, and the
 *      first tick with no gesture live settles everything owed in one draw. No event draws more than
 *      a handful of times.
 *   7. A NEW NAME IS NEVER DROPPED. A name picked mid-gesture is held, and saved when the gesture ends.
 *   8. A MONTH IS READ ONCE AT A TIME. A draw joins the read already out for its month rather than
 *      starting a second — unless the month has been handed back since that read went out: by Try
 *      again, by a stale month released, or by a read of it that failed.
 *
 * The page's idea of whether access is held is kept by this file from the events it ran, NOT read
 * from the modules, so a module that miscounts its grants cannot also mislead the check (a mutation
 * that stopped the grant number moving passed a version of this file that asked the module).
 *
 * And when the events run out the sequence is wound down — the gesture ended, every tick taken, every
 * read answered, the page's own recovery pressed where it offers one — and THE CALENDAR MUST GO QUIET:
 * nothing still coming after a bounded number of rounds, nothing owed, and a Calendar that holds
 * access showing its month as current. A month left on "Checking this month" with nothing out to
 * answer it is the permanent wait state v20.41 shipped.
 *
 * ── A FAILURE IS A SEED ─────────────────────────────────────────────────────────────────────────
 *
 * Every sequence comes from a seed, so a failure replays exactly. The message names the seed, the
 * rule, and the events that led to it; run that sequence alone with
 *     CALENDAR_SEQUENCE_SEED=<seed> node --experimental-test-module-mocks scripts/run-tests.mjs calendar-sequences.test.mjs
 * A seed is never "flaky": the same seed is the same sequence. Fix the code, not the seed list.
 *
 * ── WHAT IT DOES NOT COVER ──────────────────────────────────────────────────────────────────────
 *
 * The first load (calendar-initial-fetch.js: its chip, its attempts and its `standing` question have
 * their own suite), the documents' gate, the member's stored copy, and the screen itself. The first
 * load's two reads are issued here as plain reads, so their tickets are covered; what the first load
 * does with an answer is not. Nor is a thrown listener or the order listeners are told in:
 * calendar-access-state.test.mjs holds those.
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// ── THE FAKE FIRESTORE: every read parks until the sequence answers it ───────────────────────────

/** The sequence being run. The fake files each read it is asked for against it. @type {any} */
let page = null;

/**
 * File a read and hand the module the promise it awaits. Rules 1 and 8 are checked HERE, as the read
 * is issued, because that is the moment they are about.
 * @param {'server'|'cache'} kind
 * @param {any[]} args  what `query(…)` was given
 */
function issue(kind, args) {
    const bound = (/** @type {string} */ op) => args.find(a => a?._where?.[0] === 'date' && a._where[1] === op)?._where[2];
    const from = bound('>='), to = bound('<=');
    const read = {
        id: ++page.readCount, kind, from, to, epoch: page.epoch,
        // A MONTH read is a server read of exactly one month: `ensureOverridesCached`. The first load's
        // window spans three, and the cache read is the first load's early paint.
        month: kind === 'server' && from?.slice(0, 7) === to?.slice(0, 7) ? from.slice(0, 7) : null,
        /** @type {(v: any) => void} */ resolve: () => {}, /** @type {(e: any) => void} */ reject: () => {},
    };
    if (!page.open) violation(page, 1, `a ${kind} read of ${from}…${to} was issued while the Calendar was locked`);
    if (read.month) {
        const handedBack = page.handedBack.get(read.month) ?? 0;
        const twin = page.pending.find((/** @type {any} */ r) => r.month === read.month && r.epoch === page.epoch && r.id > handedBack);
        if (twin) violation(page, 8, `a second read of ${read.month} was started while read ${twin.id} was still out for it`);
    }
    page.pending.push(read);
    return new Promise((resolve, reject) => { read.resolve = resolve; read.reject = reject; });
}

// localStorage, as a browser has it. calendar-overrides.js records there which months this device has
// read WHOLE (`_heldWhole`), and that record decides whether an answer the cache gave may be drawn as
// the labelled saved copy — without it that path would never run here. Emptied with everything else
// at the start of each sequence.
const storage = new Map();
globalThis.localStorage = /** @type {any} */ ({
    getItem: (/** @type {string} */ k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (/** @type {string} */ k, /** @type {any} */ v) => { storage.set(k, String(v)); },
    removeItem: (/** @type {string} */ k) => { storage.delete(k); },
});

mock.module('./firebase-client.js', {
    namedExports: {
        db: {},
        collection: () => ({}),
        query: (/** @type {any[]} */ ...args) => args,
        where: (/** @type {string} */ f, /** @type {string} */ op, /** @type {any} */ v) => ({ _where: [f, op, v] }),
        getDocs: (/** @type {any[]} */ q) => issue('server', q),
        getDocsFromCache: (/** @type {any[]} */ q) => issue('cache', q),
        COLLECTIONS: { overrides: 'overrides' },
    },
});

const {
    rosterOverridesCache, ensureOverridesCached, fetchOverridesForRange, fetchOverridesForRangeFromCache,
    setOverrideAccessLostHandler, hasOverrideAccess, clearFetchedMonth, releaseStaleMonths, setInitialFetchInProgress,
} = await import('./calendar-overrides.js');
const { setCalendarAccess, hasCalendarAccess } = await import('./calendar-access-state.js');
const { knowledgeOf, decideDisplay, showsRoster, forget, _reset: resetKnowledge } = await import('./calendar-data-state.js');
const { createRedrawScheduler, GESTURE_POLL_MS } = await import('./calendar-redraw.js');

// ── THE WORLD: three months, and how many sequences ────────────────────────────────────────────────

/** The months a sequence moves between — a year's end, so a read can straddle it. */
const MONTHS = [[2026, 10], [2026, 11], [2027, 0]].map(([y, m]) => {
    const key = `${y}-${String(m + 1).padStart(2, '0')}`;
    const last = new Date(y, m + 1, 0).getDate();
    return { y, m, key, first: `${key}-01`, last: `${key}-${String(last).padStart(2, '0')}` };
});
/** The first load's window: all three months in one read. */
const WINDOW = { from: MONTHS[0].first, to: MONTHS[MONTHS.length - 1].last };

const RUNS = 2000;
const FIRST_SEED = 1;
const ONLY = process.env.CALENDAR_SEQUENCE_SEED ? Number(process.env.CALENDAR_SEQUENCE_SEED) : null;

/** A small, fast generator whose sequence is fixed by its seed (mulberry32). @param {number} seed */
function generator(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** What happened across every sequence, so the run can show it was not vacuous. */
const seen = new Map();
const count = (/** @type {string} */ what) => { seen.set(what, (seen.get(what) ?? 0) + 1); };

// ── THE PAGE: the modules wired as calendar-app.js wires them ───────────────────────────────────────

/** @param {number} seed */
function makePage(seed) {
    const p = {
        seed, rng: generator(seed), trace: /** @type {string[]} */ ([]), violations: /** @type {string[]} */ ([]),
        // The page's own record of access (see the header): set by the events, never read from a module.
        open: false, epoch: 0, started: false,
        readCount: 0, pending: /** @type {any[]} */ ([]), handedBack: new Map(),
        gesture: false, teamView: false, shown: 1,
        draws: 0, backgroundDraws: 0, teamDraws: 0, saves: 0, nameDirty: false, lockShown: 0,
        /** What the Calendar's last draw put on screen. @type {{ key: string, display: string }|null} */ lastDraw: null,
        /** What the event just run did, for the trace. */ note: '',
        now: 0, timers: /** @type {{ at: number, fn: () => void }[]} */ ([]),
        /** @type {any} */ redraw: null, /** @type {() => void} */ repaintAfterMonthRead: () => {},
    };
    p.redraw = createRedrawScheduler({
        gestureLive: () => p.gesture,
        teamViewOn: () => p.teamView,
        drawCalendar: () => draw(p, 'background'),
        drawTeam: () => { p.teamDraws++; },
        saveName: () => { p.saves++; p.nameDirty = false; },
        nameApplied: () => {},
        setTimer: (fn, ms) => { p.timers.push({ at: p.now + ms, fn }); },
    });
    // ONE function, as calendar-app.js's `_repaintAfterMonthRead` is one: the month read's waiters are a
    // Set, so a fresh closure per draw would be called once for every draw that joined the read.
    p.repaintAfterMonthRead = () => { p.redraw.repaint('month-read'); };
    return p;
}

/**
 * `renderCalendar`: draw the month on screen, and pull its read as every render does.
 * @param {any} p @param {'background'|'press'|'first'|'swipe'} source
 */
function draw(p, source) {
    const month = MONTHS[p.shown];
    if (source === 'background') {
        p.backgroundDraws++;
        if (p.gesture) violation(p, 5, 'a background repaint drew the Calendar while a gesture was live');
        if (p.teamView) violation(p, 5, 'a background repaint drew the Calendar into Team View');
    }
    const display = decideDisplay(knowledgeOf(month.key));
    if (!hasCalendarAccess() && showsRoster(display)) violation(p, 2, `a locked Calendar drew ${month.key} as a roster (${display})`);
    p.lastDraw = { key: month.key, display };
    p.draws++;
    ensureOverridesCached(month.y, month.m, p.repaintAfterMonthRead);
}

/** Team View's week fetch: the shown week's month, through the SHARED month read (calendar.md → Team Week View). @param {any} p */
function teamFetch(p) {
    p.teamDraws++;
    ensureOverridesCached(MONTHS[p.shown].y, MONTHS[p.shown].m, p.repaintAfterMonthRead);
}

/**
 * Record a broken rule. Collected, not thrown: a throw inside a module's callback is caught and
 * logged by the module, and would surface as a confusing second-hand failure.
 * @param {any} p @param {number} rule @param {string} what
 */
function violation(p, rule, what) { p.violations.push(`rule ${rule}: ${what}`); }

/** Let every answer that has been given run to its end. */
const settle = () => new Promise(resolve => setImmediate(resolve));

/** Everything a stale answer must leave alone (rule 3). @param {any} p */
function observe(p) {
    return JSON.stringify({
        cache: [...rosterOverridesCache].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        known: MONTHS.map(m => knowledgeOf(m.key)),
        open: hasCalendarAccess(),
        draws: p.draws, team: p.teamDraws, lock: p.lockShown, saves: p.saves,
        owed: p.redraw.owed(), timers: p.timers.length, pending: p.pending.length,
    });
}

/** Rows for each month a read covers: two invented colleagues, the read's number in the shift so two
 *  answers for one month differ. @param {any} read */
function rowsFor(read) {
    const rows = [];
    for (const m of MONTHS) {
        if (m.first > read.to || m.last < read.from) continue;
        const date = `${m.key}-${String(1 + ((read.id * 7) % 27)).padStart(2, '0')}`;
        rows.push({ memberName: 'A. Sample', date, type: 'shift', value: `0${read.id % 10}:00-1${read.id % 10}:00`, source: 'manual', note: '', createdAt: { seconds: read.id } });
        if (read.id % 3 === 0) rows.push({ memberName: 'B. Sample', date, type: 'annual_leave', value: 'AL', source: 'manual', note: '', createdAt: { seconds: read.id } });
    }
    return rows;
}

/** @param {any} read @param {string} outcome */
function deliver(read, outcome) {
    const docs = ['ok', 'from-cache', 'hit'].includes(outcome)
        ? rowsFor(read).map((d, i) => ({ id: `r${read.id}-${i}`, data: () => d })) : [];
    const snapshot = { size: docs.length, empty: docs.length === 0, forEach: (/** @type {any} */ f) => docs.forEach(f) };
    if (outcome === 'ok' || outcome === 'from-cache') read.resolve({ ...snapshot, metadata: { fromCache: outcome === 'from-cache' } });
    else if (outcome === 'hit' || outcome === 'empty') read.resolve(snapshot);
    else if (outcome === 'offline') read.reject(Object.assign(new Error('Could not reach Cloud Firestore backend.'), { code: 'unavailable' }));
    else if (outcome === 'refused') read.reject(Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' }));
    else read.reject(new Error('Failed to get documents from cache.'));
}

/**
 * Answer one read, and hold rules 3 and 4 to what it did.
 * @param {any} p @param {any} read @param {string} outcome
 */
async function answer(p, read, outcome) {
    p.pending = p.pending.filter((/** @type {any} */ r) => r !== read);
    const wanted = p.open && read.epoch === p.epoch;
    p.note = `read ${read.id} (${read.month ?? (read.kind === 'cache' ? 'cache' : 'window')}, grant ${read.epoch}) ${outcome}`;
    count(`${wanted ? 'wanted' : 'stale'} ${read.month ? 'month' : read.kind === 'cache' ? 'cache' : 'window'} ${outcome}`);
    // A month read that FAILS under its own grant hands its month back for a retry (`ensureOverridesCached`
    // → "Allow retry on next navigation"), even where another read of it is out — and its repaint can
    // start that retry before this function sees the answer land. So the hand-back is noted first.
    if (wanted && read.month && outcome !== 'ok') p.handedBack.set(read.month, p.readCount);
    const before = observe(p);
    const drawsBefore = p.draws, teamBefore = p.teamDraws;
    deliver(read, outcome);
    await settle();
    if (!wanted) {
        const after = observe(p);
        if (after !== before) violation(p, 3, `read ${read.id} (${read.from}…${read.to}, issued under grant ${read.epoch}) answered "${outcome}" after its access had gone, and changed the Calendar:\n      before ${before}\n      after  ${after}`);
        return;
    }
    if (read.month && outcome === 'ok') {
        if (knowledgeOf(read.month) !== 'authoritative') violation(p, 4, `read ${read.id} answered for ${read.month} under its own grant, and the month is "${knowledgeOf(read.month)}", not current`);
        const reached = p.draws > drawsBefore || p.teamDraws > teamBefore || p.redraw.owed().repaint.includes('month-read');
        if (!reached) violation(p, 4, `read ${read.id} answered for ${read.month} under its own grant, and nothing on the page heard`);
    }
}

/** The scheduler's clock moves on one poll. Rule 6 is about what that tick does. @param {any} p */
async function tick(p) {
    p.now += GESTURE_POLL_MS;
    const due = p.timers.filter(t => t.at <= p.now);
    p.timers = p.timers.filter(t => t.at > p.now);
    const owed = p.redraw.owed();
    const owing = owed.name || owed.repaint.length > 0;
    const drawsBefore = p.backgroundDraws;
    const gestureLive = p.gesture;
    for (const t of due) t.fn();
    await settle();
    if (!due.length || gestureLive) return;
    const left = p.redraw.owed();
    if (left.name || left.repaint.length) violation(p, 6, `a tick with no gesture live left work owed: ${JSON.stringify(left)}`);
    const expected = owing && !p.teamView ? 1 : 0;
    if (p.backgroundDraws - drawsBefore !== expected) violation(p, 6, `a tick with no gesture live drew ${p.backgroundDraws - drawsBefore} time(s) for ${expected} owed`);
    if (owing) count('held work settled');
}

/** Access granted: `grant()` in calendar-access.js — the one write, then `onEveryGrant`, then `onGranted` once. @param {any} p */
function grant(p) {
    p.open = true; p.epoch++;
    setCalendarAccess(true);
    // onEveryGrant (calendar-app.js): only once the workspace exists; Team View re-reads its week.
    if (p.redraw.reached('workspace')) { if (p.teamView) teamFetch(p); else p.redraw.repaint('access-returned'); }
    // onGranted, ONCE: the workspace is built and drawn. (The first load's own reads are `stray` events.)
    if (!p.started) { p.started = true; p.redraw.reach('workspace'); draw(p, 'first'); p.redraw.reach('surface'); }
}

/** Access lost: `handleAccessLost` — the one write, then the lock card. @param {any} p */
function lose(p) {
    p.open = false;
    if (hasCalendarAccess()) setCalendarAccess(false);
    p.lockShown++;
}

/** The failure panel's Try again: `retryMonth` in calendar-app.js. @param {any} p */
function tryAgain(p) {
    const key = MONTHS[p.shown].key;
    clearFetchedMonth(key);
    forget(key);
    p.handedBack.set(key, p.readCount);
    draw(p, 'press');
}

/**
 * The events, each with a weight. One that cannot happen now returns false and another is drawn —
 * a press needs a Calendar on screen, a swipe needs one to swipe.
 * @type {[string, number, (p: any) => (boolean|void|Promise<boolean|void>)][]}
 */
const EVENTS = [
    ['grant', 6, grant],
    ['lose', 4, p => { if (!p.open) return false; lose(p); }],
    ['answer', 26, async p => {
        if (!p.pending.length) return false;
        const read = p.pending[Math.floor(p.rng() * p.pending.length)];
        const r = p.rng();
        const outcome = read.kind === 'cache'
            ? (r < 0.5 ? 'hit' : r < 0.75 ? 'empty' : 'miss')
            : (r < 0.55 ? 'ok' : r < 0.70 ? 'from-cache' : r < 0.90 ? 'offline' : 'refused');
        await answer(p, read, outcome);
    }],
    ['tick', 12, tick],
    ['gesture starts', 5, p => {
        if (p.gesture || p.teamView || !p.open || !p.started) return false;
        p.gesture = true;
    }],
    ['gesture ends', 5, p => {
        if (!p.gesture) return false;
        p.gesture = false;
        // Half the time the swipe commits: the new month is drawn by the swipe itself.
        if (p.rng() < 0.5) { p.shown = Math.max(0, Math.min(MONTHS.length - 1, p.shown + (p.rng() < 0.5 ? -1 : 1))); draw(p, 'swipe'); }
    }],
    ['press', 6, p => {
        if (p.gesture || p.teamView || !p.open || !p.started) return false;
        p.shown = (p.shown + 1 + Math.floor(p.rng() * (MONTHS.length - 1))) % MONTHS.length;
        draw(p, 'press');
    }],
    ['name picked', 5, p => {
        if (!p.open || !p.started) return false;
        p.nameDirty = true;
        if (p.redraw.nameChanged() === 'held') count('name held');
    }],
    // The date turning at midnight: `if (hasOverrideAccess()) redraw.repaint('date-turned')`.
    ['date turns', 3, p => { if (!hasOverrideAccess()) return false; p.redraw.repaint('date-turned'); }],
    ['Team View opens', 3, p => {
        if (p.teamView || p.gesture || !p.open || !p.started) return false;
        p.teamView = true; teamFetch(p);
    }],
    // Leaving Team View draws the Calendar afresh (calendar-redraw.js rule 3).
    ['Team View closes', 3, p => { if (!p.teamView) return false; p.teamView = false; draw(p, 'press'); }],
    ['Try again', 3, p => {
        if (!p.open || !p.started || p.teamView || p.gesture) return false;
        const k = knowledgeOf(MONTHS[p.shown].key);
        if (k !== 'error' && k !== 'cached') return false;   // the button is on the failure panel and the saved copy
        count('Try again');
        tryAgain(p);
    }],
    // The page back in view, or ten minutes on: `refreshIfStale` (calendar-initial-fetch.js), whose
    // `renderCalendar` is the scheduler's 'first-load' repaint (calendar-app.js) and whose
    // `refetchTeamView` re-reads the week.
    ['page back in view', 3, p => {
        if (!p.started) return false;
        const released = releaseStaleMonths(0);
        if (!released.length) return false;
        count('months released');
        for (const key of released) p.handedBack.set(key, p.readCount);
        if (p.teamView) teamFetch(p); else p.redraw.repaint('first-load');
    }],
    // WRONG CALLERS AS WELL AS RIGHT ONES: the first load's two reads and a bare month read, asked for
    // whether or not the Calendar holds access. Locked, every one must be refused at the source (rule 1).
    ['a read is asked for', 4, p => {
        const r = p.rng();
        if (r < 0.35) fetchOverridesForRangeFromCache(WINDOW.from, WINDOW.to, []);
        else if (r < 0.7) fetchOverridesForRange(WINDOW.from, WINDOW.to).catch(() => {});
        else { const m = MONTHS[Math.floor(p.rng() * MONTHS.length)]; ensureOverridesCached(m.y, m.m, p.repaintAfterMonthRead); }
        if (!p.open) count('read asked for while locked');
    }],
];
const TOTAL_WEIGHT = EVENTS.reduce((sum, [, w]) => sum + w, 0);

/** Draw and run one event that can happen now. @param {any} p */
async function step(p) {
    for (let tries = 0; tries < 8; tries++) {
        let pick = p.rng() * TOTAL_WEIGHT;
        const event = EVENTS.find(([, w]) => (pick -= w) < 0) ?? EVENTS[EVENTS.length - 1];
        const drawsBefore = p.draws + p.teamDraws;
        if ((await event[2](p)) === false) continue;
        await settle();
        p.trace.push(`${event[0]}${p.note ? ` ${p.note}` : ''}${p.open ? '' : ' [locked]'}`);
        p.note = '';
        count(event[0]);
        if (p.draws + p.teamDraws - drawsBefore > 4) violation(p, 6, `one event ("${event[0]}") drew ${p.draws + p.teamDraws - drawsBefore} times`);
        return;
    }
    await tick(p);
    p.trace.push('tick');
}

/** The rules that hold between any two events. @param {any} p */
function checkStanding(p) {
    if (hasCalendarAccess() !== p.open) violation(p, 3, `access is ${hasCalendarAccess() ? 'held' : 'shut'}, where the events that ran leave it ${p.open ? 'held' : 'shut'}`);
    if (!p.open) {
        const known = MONTHS.filter(m => knowledgeOf(m.key) !== 'unknown');
        if (known.length) violation(p, 2, `the Calendar is locked and still knows ${known.map(m => `${m.key} (${knowledgeOf(m.key)})`).join(', ')}`);
    }
    const owed = p.redraw.owed();
    if (p.timers.length > 1) violation(p, 6, `${p.timers.length} ticks are waiting where there is one wait`);
    if ((owed.name || owed.repaint.length) && p.timers.length !== 1) violation(p, 6, `work is held (${JSON.stringify(owed)}) with no tick waiting to settle it`);
    if (p.nameDirty && !owed.name) violation(p, 7, 'a name was picked and is neither saved nor held');
    // Rule 4's second half: the screen is never left waiting, nor left claiming more than is known.
    // Asked only where the Calendar is what the reader sees (unlocked, not Team View), nothing is held
    // for a gesture, and no read of the month on screen is still out under this grant — while one is,
    // its answer will repaint, and the screen may lag it.
    const key = MONTHS[p.shown].key;
    const quiet = p.open && p.started && !p.teamView && !p.gesture && !owed.name && !owed.repaint.length
        && !p.pending.some((/** @type {any} */ r) => r.month === key && r.epoch === p.epoch);
    if (quiet && p.lastDraw) {
        const k = knowledgeOf(key), shown = p.lastDraw.display;
        if (p.lastDraw.key !== key) violation(p, 4, `${key} is on screen and was never drawn — the last draw was ${p.lastDraw.key}`);
        else if (k === 'unknown') violation(p, 4, `${key} is on screen, unknown, and nothing is out to answer it — a wait with no end`);
        else if (shown === 'loading') violation(p, 4, `${key} is known "${k}", and the screen still says "Checking this month" with nothing out to change it`);
        else if (k === 'authoritative' && shown !== 'render') violation(p, 4, `${key} is known current, and is drawn as "${shown}"`);
        else if (shown === 'render' && k !== 'authoritative') violation(p, 4, `${key} is drawn as current and is only known "${k}" — a failed check left it looking current (F1)`);
        // A labelled copy shown as the failure panel, or the other way round, is allowed: both say the
        // month is not current, and both offer Try again.
    }
}

/** Stop a sequence that has broken a rule, saying how to replay it. @param {any} p */
function report(p) {
    if (!p.violations.length) return;
    assert.fail(`seed ${p.seed} broke ${p.violations.length === 1 ? 'a rule' : `${p.violations.length} rules`}:\n  ${p.violations.join('\n  ')}\n`
        + `  after: ${(ONLY !== null ? p.trace : p.trace.slice(-25)).join(' → ')}\n`
        + `  replay it: CALENDAR_SEQUENCE_SEED=${p.seed} node --experimental-test-module-mocks scripts/run-tests.mjs calendar-sequences.test.mjs`);
}

/**
 * Wind the sequence down and hold it to the closing rules: it goes quiet, nothing is owed, and a
 * Calendar that holds access shows its month as current. The recovery the page offers is pressed
 * where it offers one, because that recovery is part of what must work.
 * @param {any} p
 */
async function windDown(p) {
    p.gesture = false;
    if (p.teamView) { p.teamView = false; draw(p, 'press'); await settle(); }
    for (let round = 0; round < 25; round++) {
        while (p.timers.length) await tick(p);
        while (p.pending.length) await answer(p, p.pending[0], p.pending[0].kind === 'cache' ? 'hit' : 'ok');
        if (p.timers.length || p.pending.length) continue;
        const k = knowledgeOf(MONTHS[p.shown].key);
        if (p.open && p.started && (k === 'error' || k === 'cached')) { tryAgain(p); await settle(); continue; }
        if (p.open && p.started && k !== 'authoritative') violation(p, 4, `wound down holding access, with ${MONTHS[p.shown].key} left "${k}" and nothing out to change it`);
        if (p.nameDirty) violation(p, 7, 'wound down with a picked name never saved');
        const owed = p.redraw.owed();
        if (owed.name || owed.repaint.length) violation(p, 6, `wound down still owing ${JSON.stringify(owed)}`);
        if (p.open && p.started && k === 'authoritative') count('wound down current');
        return;
    }
    violation(p, 6, 'the Calendar never went quiet: reads or ticks were still coming after 25 rounds');
}

/** @param {number} seed */
async function runSequence(seed) {
    // Each sequence starts as a freshly loaded page does — locked, nothing known, nothing cached. The
    // modules keep their state at module level, so it is put back by hand. (The previous sequence was
    // wound down, so no read of its is still out to land in this one.)
    if (hasCalendarAccess()) setCalendarAccess(false);
    rosterOverridesCache.clear();
    resetKnowledge();
    storage.clear();
    setInitialFetchInProgress(false);
    const p = page = makePage(seed);
    // `setOverrideAccessLostHandler(handleAccessLost)`: a month read refused because access has gone
    // has already shut it (the one write) by the time this runs; the page puts the card up.
    setOverrideAccessLostHandler(() => { count('access lost by a refused read'); p.open = false; p.lockShown++; });
    const length = 30 + Math.floor(p.rng() * 50);
    for (let i = 0; i < length; i++) {
        await step(p);
        checkStanding(p);
        report(p);
    }
    await windDown(p);
    checkStanding(p);
    report(p);
}

test('the Calendar keeps its eight rules through thousands of random orders of its events', async (t) => {
    // The modules log a failed read; a thousand sequences would print thousands of lines. Any OTHER
    // error they log — a listener that threw, a repaint that threw — is a fault, and fails the run.
    // Node's own warnings are not the modules' errors. Node 24 — CI's runtime — writes them through
    // console.error, so they land in this stub (Node 22 writes them past it), and the two this file
    // earns reach it after it is in place: module mocking is experimental, and `namedExports` is
    // deprecated. They failed CI's first run of this file (11 Nov 2026). Only those two KINDS pass
    // through, to the real console; on Node 24 any other warning still fails the run, as an error
    // would.
    const unexpected = [];
    const restore = [console.error, console.warn];
    const nodeWarning = new RegExp(`^\\(node:${process.pid}\\) (?:Experimental|Deprecation)Warning: `);
    console.error = (/** @type {any[]} */ ...args) => {
        if (nodeWarning.test(String(args[0]))) { restore[0](...args); return; }
        if (!String(args[0]).startsWith('[Firestore] Failed to fetch overrides for')) unexpected.push(args.map(String).join(' '));
    };
    console.warn = (/** @type {any[]} */ ...args) => { unexpected.push(args.map(String).join(' ')); };
    try {
        const seeds = ONLY !== null ? [ONLY] : Array.from({ length: RUNS }, (_, i) => FIRST_SEED + i);
        for (const seed of seeds) {
            await runSequence(seed);
            assert.deepEqual(unexpected, [], `seed ${seed}: a module logged an error nobody expected`);
        }
    } finally {
        [console.error, console.warn] = restore;
        setCalendarAccess(false);
    }
    t.diagnostic([...seen].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}: ${v}`).join(' · '));
    if (ONLY !== null) return;

    // NOT VACUOUS. Every rule above is about something that has to HAPPEN for the rule to be tested — a
    // stale answer landing, a gesture holding work, access lost by a refused read. A change that made
    // one of them stop happening would leave every rule green and the file testing nothing. Floors, not
    // exact counts: the seeds may change, and these only have to show each case is still reached.
    for (const what of [
        'stale month ok', 'stale month refused', 'stale month offline', 'stale month from-cache',
        'stale window ok', 'stale cache hit',
        'wanted month ok', 'wanted month offline', 'wanted month from-cache', 'wanted window ok', 'wanted cache hit',
        'access lost by a refused read', 'held work settled', 'name held', 'Try again', 'months released',
        'read asked for while locked', 'wound down current',
    ]) {
        assert.ok((seen.get(what) ?? 0) >= 20, `"${what}" happened ${seen.get(what) ?? 0} time(s) across ${RUNS} sequences — too rarely for the rules about it to be tested`);
    }
});
