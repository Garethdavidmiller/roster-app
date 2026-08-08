/**
 * Unit tests for usage-reporter.js — specifically the WRITE-TIME ADMIN EXCLUSION and the recordOpen
 * gate, which keep the developer's own sessions out of the anonymous analytics. The pure maths
 * (shouldCountMonth/shouldCountRolling/monthKey/dayKey) is covered by usage-stats.test.mjs; the
 * reporter's decision layer (WHEN it writes, and that an admin identity writes NOTHING) was not.
 * A regression here silently pollutes staff-usage figures with the developer's test loads.
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

beforeEach(() => { _ls.clear(); _pageViews = []; _activeAccounts = []; _origins = []; setEnv(); });

describe('recordUsage — admin exclusion + page-view/active-account gating', () => {
    test('an ADMIN identity records NOTHING (page view AND active account suppressed)', () => {
        recordUsage('paycalc', 'G. Miller');
        assert.deepEqual(_pageViews, []);
        assert.deepEqual(_activeAccounts, []);
    });

    test('the anonymous calendar with an ADMIN selected member records nothing (identity arg excludes)', () => {
        recordUsage('calendar', 'G. Miller');
        assert.deepEqual(_pageViews, []);
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
        recordUsage('calendar', 'S. Silva');
        assert.deepEqual(_pageViews, ['calendar']);
        assert.equal(_activeAccounts.length, 1, 'a signed-out calendar visitor is an active account');
    });

    test('a FIRST-RUN device (no identity) records the view but NO account', () => {
        // Nothing to dedup on — and the "selection" at that moment is only the default member, an
        // admin. One load per device, immediately before a member is chosen.
        recordUsage('calendar', null);
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
        recordUsage('calendar', 'S. Silva');
        recordUsage('settings', 'S. Silva');
        assert.equal(_activeAccounts.length, 1);
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
        recordUsage('calendar', null);
        assert.deepEqual(_origins, []);
    });

    test('a first visit records the address, not installed', () => {
        recordUsage('calendar', 'S. Silva');
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
