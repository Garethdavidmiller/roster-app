/**
 * Unit tests for usage-reporter.js — specifically the WRITE-TIME ADMIN EXCLUSION and the recordOpen
 * gate, which keep the developer's own sessions out of the anonymous analytics. The pure maths
 * (shouldCountMonth/rollingMove/monthKey/dayKey) is covered by usage-stats.test.mjs; the
 * reporter's decision layer (WHEN it writes, and that an admin identity writes NOTHING) was not.
 * A regression here silently pollutes staff-usage figures with the developer's test loads.
 *
 * Since v25.00 it also pins the other direction, which is the one that went wrong: a SELECTED admin
 * (the station PC left on the admin's row) must not take real staff opens out with it, a release
 * reload must not count as a visit, and a rolling count must MOVE to the latest active day.
 *
 * Run: node --experimental-test-module-mocks --test usage-reporter.test.mjs
 */
import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

const _ls = new Map();
/** @type {string[]} */ let _pageViews = [];
/** @type {any[]} */    let _activeAccounts = [];
/** @type {any[]} */
let _origins = [];

mock.module('./firebase-client.js', {
    namedExports: {
        recordPageView:     (/** @type {string} */ id) => { _pageViews.push(id); },
        recordActiveAccount: (/** @type {any} */ payload) => { _activeAccounts.push(payload); },
        recordOriginUse: (/** @type {any} */ payload) => { _origins.push(payload); },
    },
});
mock.module('./ls.js', {
    namedExports: {
        lsGet: (/** @type {string} */ k) => _ls.has(k) ? _ls.get(k) : null,
        lsSet: (/** @type {string} */ k, /** @type {any} */ v) => { _ls.set(k, String(v)); },
    },
});
mock.module('./roster-data.js', {
    namedExports: { CONFIG: { ADMIN_NAMES: ['G. Miller'] } },
});
// Whether THIS load was a release reload — App Speed's shared answer (perf-reporter.js), set per test.
let _release = false;
mock.module('./perf-reporter.js', {
    namedExports: { loadFollowedRelease: () => _release },
});

const { recordUsage, recordOpen } = await import('./usage-reporter.js');

// `_recordOrigin` reads location/window; Node has neither, and the reporter's own try/catch would
// swallow the ReferenceError into a silent no-op — a test that passes because nothing ran.
/** @param {{host?: string, standalone?: boolean}} [o] */
function setEnv({ host = 'myb-roster.web.app', standalone = false } = {}) {
    globalThis.location = /** @type {any} */ ({ hostname: host });
    globalThis.window = /** @type {any} */ ({
        matchMedia: () => ({ matches: standalone }),
        navigator: {},
    });
}

beforeEach(() => { _ls.clear(); _pageViews = []; _activeAccounts = []; _origins = []; _release = false; setEnv(); });

describe('recordUsage — admin exclusion + page-view/active-account gating', () => {
    test('a SIGNED-IN admin records NOTHING (page view AND active account suppressed)', () => {
        recordUsage('paycalc', 'G. Miller');
        assert.deepEqual(_pageViews, []);
        assert.deepEqual(_activeAccounts, []);
    });

    test('a signed-in admin records nothing whoever is selected on the Calendar', () => {
        recordUsage('calendar', 'G. Miller', 'S. Silva');
        assert.deepEqual(_pageViews, []);
        assert.deepEqual(_activeAccounts, []);
        assert.deepEqual(_origins, []);
    });

    test('an admin SELECTED where nobody is signed in still counts the page view — but no member-device (v25.00)', () => {
        // This test used to assert the opposite — `_pageViews` EMPTY — and that was the bug. The
        // station PC reads the roster on the staff PIN with whichever row was picked last, and the
        // default selection IS the admin, so excluding on the selection dropped every staff open
        // there. A selection says whose roster is on screen, not who is looking at it: the view
        // counts, and nothing is counted against a member it cannot name.
        recordUsage('calendar', null, 'G. Miller');
        assert.deepEqual(_pageViews, ['calendar']);
        assert.deepEqual(_activeAccounts, []);
        assert.deepEqual(_origins, []);
    });

    test('a real staff member records a page view AND (first time) an active account', () => {
        recordUsage('paycalc', 'S. Silva');
        assert.deepEqual(_pageViews, ['paycalc']);
        assert.equal(_activeAccounts.length, 1, 'first load this month/window counts the account');
    });

    test('a CALENDAR-ONLY visitor counts as an active account (v19.95)', () => {
        // The change this signature exists for. The calendar has no Auth session, so until v19.95 it
        // passed member=null and the account metric skipped it — and a member who only ever reads
        // the roster signs in NOWHERE, so "accounts active" was quietly counting the minority who
        // open an authenticated page while reading as though it counted everybody.
        recordUsage('calendar', null, 'S. Silva');
        assert.deepEqual(_pageViews, ['calendar']);
        assert.equal(_activeAccounts.length, 1, 'a signed-out calendar visitor is an active account');
    });

    test('a FIRST-RUN device (no identity) records the view but NO account', () => {
        // Nothing to dedup on — and the "selection" at that moment is only the default member, an
        // admin. One load per device, immediately before a member is chosen.
        recordUsage('calendar', null, null);
        assert.deepEqual(_pageViews, ['calendar']);
        assert.deepEqual(_activeAccounts, []);
    });

    test('a second same-day load by the same member does NOT double-count the account', () => {
        recordUsage('paycalc', 'S. Silva');   // first — counts
        recordUsage('paycalc', 'S. Silva');   // same day — deduped
        assert.deepEqual(_pageViews, ['paycalc', 'paycalc'], 'page views always count');
        assert.equal(_activeAccounts.length, 1, 'active account deduped for the window');
    });

    test('the calendar and an authenticated page are ONE account, not two', () => {
        // The dedup keys are shared across both routes on purpose. Reading the roster and then
        // opening Settings is one person having one day, and a per-route key would have inflated
        // every figure the moment calendar visits started counting.
        recordUsage('calendar', null, 'S. Silva');
        recordUsage('settings', 'S. Silva');
        assert.equal(_activeAccounts.length, 1);
    });
});

describe('a release reload is not a visit (v25.00)', () => {
    test('a load the app reloaded itself for an update records NOTHING', () => {
        // About one Calendar open in seven in September was this reload, which runs while the page
        // is hidden. It is the app reloading itself, not somebody opening a page.
        _release = true;
        recordUsage('calendar', 'S. Silva');
        assert.deepEqual(_pageViews, []);
        assert.deepEqual(_activeAccounts, []);
        assert.deepEqual(_origins, []);
    });

    test('an ordinary load records as before', () => {
        recordUsage('calendar', 'S. Silva');
        assert.deepEqual(_pageViews, ['calendar']);
    });

    test('an OPEN is a tap, not a load — a release reload never suppresses one', () => {
        _release = true;
        recordOpen('huddle', 'S. Silva');
        assert.deepEqual(_pageViews, ['huddle']);
    });
});

describe('the rolling count moves to the latest active day (v25.00)', () => {
    /** 09:00 local on the given October 2026 day — day keys are LOCAL, so the tests are too. */
    const oct = (/** @type {number} */ d) => new Date(2026, 9, d, 9, 0);

    test('the first open places the count on today, taking nothing back', (t) => {
        t.mock.timers.enable({ apis: ['Date'], now: oct(1) });
        recordUsage('calendar', 'S. Silva');
        assert.deepEqual(_activeAccounts, [{ month: '2026-10', day: '2026-10-01', fromDay: null }]);
    });

    test('an open on a NEW day moves the count: +1 today, -1 on the day it sat on', (t) => {
        // The rule this release adds. It used to freeze on the first day for 30 days, so anyone
        // whose count aged out while they kept opening the app vanished from "last 30 days".
        t.mock.timers.enable({ apis: ['Date'], now: oct(1) });
        recordUsage('calendar', 'S. Silva');
        t.mock.timers.setTime(oct(9).getTime());
        recordUsage('calendar', 'S. Silva');
        assert.deepEqual(_activeAccounts[1], { month: null, day: '2026-10-09', fromDay: '2026-10-01' });
    });

    test('a second open on the same day moves nothing — at most one write a day', (t) => {
        t.mock.timers.enable({ apis: ['Date'], now: oct(9) });
        recordUsage('calendar', 'S. Silva');
        t.mock.timers.setTime(oct(9).getTime() + 8 * 3600_000);
        recordUsage('paycalc', 'S. Silva');
        assert.equal(_activeAccounts.length, 1);
    });

    test('a count that has already left the window is not taken back — its day no longer counts', (t) => {
        // And may already have been pruned, where a -1 would recreate the key below zero.
        _ls.set('myb_usage_d30_S. Silva', String(new Date(2026, 8, 1, 9).getTime()));   // 1 Sep
        _ls.set('myb_usage_m_S. Silva', '2026-10');
        t.mock.timers.enable({ apis: ['Date'], now: oct(26) });
        recordUsage('calendar', 'S. Silva');
        assert.deepEqual(_activeAccounts, [{ month: null, day: '2026-10-26', fromDay: null }]);
    });

    test('a flag the OLD code wrote is read as it is: its day is the day its count sits on', (t) => {
        // No migration step: the flag still means "when the count was placed". A device updating
        // mid-window moves its existing count rather than adding a second one.
        _ls.set('myb_usage_d30_S. Silva', String(oct(16).getTime()));
        _ls.set('myb_usage_m_S. Silva', '2026-10');
        t.mock.timers.enable({ apis: ['Date'], now: oct(26) });
        recordUsage('calendar', 'S. Silva');
        assert.deepEqual(_activeAccounts, [{ month: null, day: '2026-10-26', fromDay: '2026-10-16' }]);
    });

    test('the address counts move the same way, each of the two flags on its own', (t) => {
        t.mock.timers.enable({ apis: ['Date'], now: oct(1) });
        recordUsage('calendar', 'S. Silva');                         // a browser tab
        t.mock.timers.setTime(oct(2).getTime());
        setEnv({ standalone: true });
        recordUsage('calendar', 'S. Silva');                         // the installed app, next day
        t.mock.timers.setTime(oct(3).getTime());
        recordUsage('calendar', 'S. Silva');                         // the installed app again
        const pick = (/** @type {any} */ o) => ({ day: o.day, countVisit: o.countVisit, fromDay: o.fromDay, installed: o.installed, fromPwaDay: o.fromPwaDay });
        assert.deepEqual(_origins.map(pick), [
            { day: '2026-10-01', countVisit: true, fromDay: null,         installed: false, fromPwaDay: null },
            { day: '2026-10-02', countVisit: true, fromDay: '2026-10-01', installed: true,  fromPwaDay: null },
            { day: '2026-10-03', countVisit: true, fromDay: '2026-10-02', installed: true,  fromPwaDay: '2026-10-02' },
        ]);
    });
});

describe('recordOpen — admin exclusion, no dedup', () => {
    test('an ADMIN identity records no open', () => {
        recordOpen('huddle', 'G. Miller');
        assert.deepEqual(_pageViews, []);
    });
    test('a real staff member records the open', () => {
        recordOpen('huddle', 'S. Silva');
        assert.deepEqual(_pageViews, ['huddle']);
    });
    test('a null identity records anonymously', () => {
        recordOpen('circular', null);
        assert.deepEqual(_pageViews, ['circular']);
    });
    test('every open counts — NO dedup (unlike active accounts)', () => {
        recordOpen('guide-fip', 'S. Silva');
        recordOpen('guide-fip', 'S. Silva');
        assert.deepEqual(_pageViews, ['guide-fip', 'guide-fip']);
    });
});

describe('per-address counters — the migration metric (v19.23)', () => {
    test('an admin identity records no address either', () => {
        recordUsage('paycalc', 'G. Miller');
        assert.deepEqual(_origins, []);
    });

    test('no identity records nothing — there is nothing to dedup on', () => {
        recordUsage('calendar', null, null);
        assert.deepEqual(_origins, []);
    });

    test('a first visit records the address, not installed', () => {
        recordUsage('calendar', null, 'S. Silva');
        assert.equal(_origins.length, 1);
        assert.equal(_origins[0].origin, 'web');
        assert.equal(_origins[0].countVisit, true);
        assert.equal(_origins[0].installed, false);
    });

    test('the calendar now counts in BOTH metrics on one identity (v19.95)', () => {
        // This test used to assert the opposite half — `_activeAccounts` EMPTY — because the address
        // metric was deliberately compensating for a blind spot in the account metric above it:
        // calendar-only staff are the majority, they sign in nowhere, and they are exactly the
        // people an old installed PWA strands. v19.95 removed the blind spot rather than leaving one
        // metric working around another, so the two now key on the same identity and agree.
        recordUsage('calendar', 'S. Silva');
        assert.equal(_activeAccounts.length, 1, 'the account metric must no longer skip the calendar');
        assert.equal(_origins.length, 1);
    });

    test('a second visit in the same window is NOT counted again', () => {
        recordUsage('calendar', 'S. Silva');
        recordUsage('paycalc', 'S. Silva');
        assert.equal(_origins.length, 1, 'unique accounts must not double-count');
    });

    test('the mirror is recorded as its own address', () => {
        setEnv({ host: 'garethdavidmiller.github.io' });
        recordUsage('calendar', 'S. Silva');
        assert.equal(_origins[0].origin, 'pages');
    });

    test('installed on the first open records BOTH counters in one write', () => {
        setEnv({ standalone: true });
        recordUsage('calendar', 'S. Silva');
        assert.deepEqual(
            { countVisit: _origins[0].countVisit, installed: _origins[0].installed },
            { countVisit: true, installed: true });
    });

    test('a browser tab FIRST, then the installed app, counts the install without re-counting the visit', () => {
        // The asymmetry the two independent flags exist for. A single shared flag would freeze
        // whichever mode came first, so this member would never be counted as installed — and
        // "how many have actually installed it on the new address" is the entire question.
        recordUsage('calendar', 'S. Silva');                 // browser tab
        setEnv({ standalone: true });
        recordUsage('calendar', 'S. Silva');                 // now from the home screen
        assert.equal(_origins.length, 2);
        assert.deepEqual(
            { countVisit: _origins[1].countVisit, installed: _origins[1].installed },
            { countVisit: false, installed: true },
            'the visit must not be counted twice, but the install must be recorded');
    });

    test('a third open changes nothing once both are counted', () => {
        setEnv({ standalone: true });
        recordUsage('calendar', 'S. Silva');
        recordUsage('calendar', 'S. Silva');
        recordUsage('paycalc', 'S. Silva');
        assert.equal(_origins.length, 1);
    });

    test('two members on one device are counted separately', () => {
        recordUsage('calendar', 'S. Silva');
        recordUsage('calendar', 'J. Davies');
        assert.equal(_origins.length, 2);
    });
});

describe('the callers hand over the SESSION as the identity that excludes (v25.00)', async () => {
    // The reporter can only be as right as its arguments. Each of these call sites used to pass the
    // Calendar's SELECTED member where the session belonged, which is how a station PC left on the
    // admin's row dropped every staff open on it. Read from the source, because the pages render the
    // same whether these counters fire or not — no browser test can see the difference.
    const { readFileSync } = await import('node:fs');
    const src = (/** @type {string} */ f) => readFileSync(new URL(`./${f}`, import.meta.url), 'utf8');

    test('the Calendar passes the session first and the selection second', () => {
        const call = /recordUsage\('calendar',\s*([^,]+),\s*(.+?)\);/.exec(src('calendar-app.js'));
        assert.ok(call, 'the Calendar\'s recordUsage call was not found');
        assert.match(call[1], /getSession\(\)/, 'the identity that excludes must be the session');
        assert.doesNotMatch(call[1], /getCurrentMember/, 'never the selected member');
        assert.match(call[2], /getCurrentMember\(\)/, 'the selection is the dedup key, second');
    });
    test('the drawer, the document viewer and the Huddle viewer count opens against the session', () => {
        assert.match(src('nav-panel.js'), /const _usageId = memberName;/);
        for (const f of ['calendar-doc-viewer.js', 'calendar-huddle-viewer.js']) {
            const calls = [...src(f).matchAll(/recordOpen\([^,]+,\s*([^)]*\)[^)]*)\)/g)].map(m => m[1]);
            assert.ok(calls.length, `${f}: no recordOpen call found`);
            for (const c of calls) {
                assert.match(c, /getSession\(\)/, `${f}: ${c}`);
                assert.doesNotMatch(c, /getCurrentMember/, `${f}: ${c}`);
            }
        }
    });
});
