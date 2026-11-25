// @ts-check
// @lane unit
/**
 * calendar-initial-fetch.js — the page coming back into view WHILE the first load is still out.
 *
 * calendar-initial-fetch.test.mjs mocks `_initialFetchInProgress` as false, and a module mock's export
 * is a snapshot, so that file cannot reach the mid-load branch of the visibilitychange handler. This
 * one mocks it TRUE. The branch repaints "so the calendar is not blank" — and it drew with no access
 * check, so a Calendar locked mid-load was redrawn behind its lock card (whole-app review, 24 Nov 2026).
 *
 * Run: node --experimental-test-module-mocks scripts/run-tests.mjs test/calendar-initial-fetch-midload.test.mjs
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

let hasAccess = true;
mock.module('../calendar-overrides.js', { namedExports: {
    _initialFetchInProgress: true,   // the first load is still out
    setInitialFetchInProgress() {},
    addFetchedMonths() {}, clearFetchedMonth() {}, oweRecheck() {},
    releaseStaleMonths: () => [],
    monthKey: (/** @type {number} */ y, /** @type {number} */ m) => `${y}-${String(m + 1).padStart(2, '0')}`,
    fetchOverridesForRange: () => new Promise(() => {}),   // never answers: the load stays in progress
    fetchOverridesForRangeFromCache: () => new Promise(() => {}),
    issueReadTicket: () => ({ grant: 0, seq: 0 }),
    answerStillWanted: () => hasAccess,
    hasOverrideAccess: () => hasAccess,
} });
mock.module('../roster-data.js', { namedExports: {
    formatISO: (/** @type {Date} */ d) => d.toISOString().slice(0, 10),
    CONFIG: { MIN_YEAR: 2024, MAX_YEAR: 2040 },
} });

/** @type {Record<string, Function[]>} */ const listeners = {};
const el = () => ({ classList: { add() {}, remove() {}, contains: () => false }, setAttribute() {}, appendChild() {}, remove() {} });
/** @type {any} */ (globalThis).document = {
    hidden: false,
    getElementById: () => el(),
    querySelector: () => null,
    createElement: el,
    addEventListener: (/** @type {string} */ evt, /** @type {Function} */ fn) => { (listeners[evt] ??= []).push(fn); },
    removeEventListener() {},
    body: el(),
};
/** @type {any} */ (globalThis).MutationObserver = class { observe() {} disconnect() {} };

const { initInitialFetch } = await import('../calendar-initial-fetch.js');

test('back in view mid-load: a Calendar that holds access repaints, a locked one draws nothing', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });   // the load never settles
    let calendar = 0, team = 0, teamView = false;
    initInitialFetch({ isTeamViewMode: () => teamView, renderCalendar: () => { calendar++; }, renderTeamView: () => { team++; } });
    const back = () => { for (const fn of listeners.visibilitychange ?? []) fn(); };

    back();
    assert.equal(calendar, 1, 'with access, the mid-load return repaints so the calendar is not blank');

    hasAccess = false;
    back();
    teamView = true;
    back();
    assert.deepEqual([calendar, team], [1, 0], 'a Calendar locked mid-load was redrawn behind its card');

    hasAccess = true;
    back();
    assert.equal(team, 1, 'and Team View repaints once access is back');
});
