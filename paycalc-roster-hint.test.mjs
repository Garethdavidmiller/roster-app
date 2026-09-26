// @ts-check
/**
 * paycalc-roster-hint.test.mjs — "Fill from calendar" across an await.
 * Run with: node --experimental-test-module-mocks --test paycalc-roster-hint.test.mjs
 *
 * WHAT A WRONG ANSWER COSTS. The single-period fill retries the recorded-changes fetch before it
 * writes (v21.67) — and then writes into WHATEVER FORM IS ON SCREEN and saves it under WHATEVER
 * PERIOD THE SELECT NOW SHOWS. Nothing checked either after the await (72-hour review), so a member
 * who tapped Fill on one payslip and switched to another while the phone was on poor signal had the
 * first payslip's calendar hours written into the second and saved as the second's own. The
 * background fetch in paycalc-app.js has carried exactly this guard since v16.69; the tap did not.
 *
 * THE HARNESS. `paycalc-roster-suggestions.js` and `session.js` are mocked for the usual reason —
 * both reach `firebase-client.js`, which imports the SDK from gstatic and cannot load in Node — and
 * the suggestion mock hands back a fetch the test resolves BY HAND, which is the only way to put a
 * period switch inside the await. Everything else (the period grid, the snapshot key, storage
 * through `ls.js`) is the real module over an in-memory `localStorage`.
 */
import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

const _store = new Map();
global.localStorage = /** @type {any} */ ({
    getItem: (/** @type {string} */ k) => (_store.has(k) ? _store.get(k) : null),
    setItem: (/** @type {string} */ k, /** @type {any} */ v) => _store.set(k, String(v)),
    removeItem: (/** @type {string} */ k) => _store.delete(k),
    key: (/** @type {number} */ i) => [..._store.keys()][i] ?? null,
    get length() { return _store.size; },
});

const HM_IDS = ['satH', 'satM', 'bhH', 'bhM', 'bhOtH', 'bhOtM', 'otH', 'otM', 'rdwH', 'rdwM', 'sunH', 'sunM', 'boxH', 'boxM'];
/** @type {Record<string, any>} */ let _els = {};
function setupDom(/** @type {string} */ period) {
    const field = () => ({ value: '', classList: { add() {}, remove() {} } });
    _els = { periodSelect: { value: period }, fillFromRosterBtn: { disabled: false } };
    for (const id of HM_IDS) _els[id] = field();
    // No #rosterHintBar / #rosterHintText: updateRosterHint returns at its first lookup, which keeps
    // this suite about the write, not the hint bar's rendering.
    global.document = /** @type {any} */ ({ getElementById: (/** @type {string} */ id) => _els[id] ?? null });
}

/** @type {string} */ let _fetchState = 'base-only';
/** @type {number} */ let _fetchCalls = 0;
/** @type {(v: string) => void} */ let _resolveFetch = () => {};
mock.module('./session.js', { namedExports: { getSession: () => ({ name: 'G. Miller' }) } });
mock.module('./paycalc-roster-suggestions.js', {
    namedExports: {
        bhsForYear: () => [],
        getOverridesFetchState: () => _fetchState,
        // Every period's calendar says 5h overtime, tagged with the period so a cross-write is visible.
        getRosterSuggestion: (/** @type {any} */ p) => ({ otH: 5, otM: p.num % 60 }),
        fetchOverridesForPeriod: () => {
            _fetchCalls++;
            return new Promise(r => { _resolveFetch = (v) => { if (v === 'loaded') _fetchState = 'loaded'; r(v); }; });
        },
    },
});

const { fillFromRoster, snapKey } = await import('./paycalc-roster-hint.js');

const A = '60', B = '61';
/** @type {number} */ let _autosaves = 0;
const autosave = () => { _autosaves++; };

beforeEach(() => { _store.clear(); _fetchState = 'base-only'; _fetchCalls = 0; _autosaves = 0; });

describe('fillFromRoster — the period on screen when the fetch returns is the one it was asked for', () => {
    test('switching payslip during the fetch writes NOTHING into the new one', async () => {
        setupDom(A);
        const run = fillFromRoster(autosave);
        _els.periodSelect.value = B;          // the member moves on while the phone waits
        _resolveFetch('loaded');
        await run;
        assert.equal(_els.otH.value, '', "period A's calendar hours were written into B's form");
        assert.equal(_autosaves, 0, "…and saved under B's key");
        assert.equal(localStorage.getItem(snapKey(Number(B))), null, "…and B was marked as calendar-filled");
    });

    test('a fetch the fetch module itself CANCELLED writes nothing either', async () => {
        setupDom(A);
        const run = fillFromRoster(autosave);
        _resolveFetch('cancelled');
        await run;
        assert.equal(_els.otH.value, '');
        assert.equal(_autosaves, 0);
    });

    test('the button is disabled while the fetch is in flight, and a second tap starts nothing', async () => {
        setupDom(A);
        const run = fillFromRoster(autosave);
        assert.equal(_els.fillFromRosterBtn.disabled, true, 'the control must say it is busy');
        await fillFromRoster(autosave);        // a second tap during the wait
        assert.equal(_fetchCalls, 1, 'the second tap started a second fill');
        _resolveFetch('loaded');
        await run;
        assert.equal(_els.fillFromRosterBtn.disabled, false, 'the control never came back');
        assert.equal(_autosaves, 1, 'exactly one fill ran');
    });

    test('CONTROL: the same payslip still on screen is filled and saved', async () => {
        setupDom(A);
        const run = fillFromRoster(autosave);
        _resolveFetch('loaded');
        await run;
        assert.equal(String(_els.otH.value), '5');
        assert.equal(String(_els.otM.value), String(Number(A) % 60));
        assert.equal(_autosaves, 1);
        assert.ok(localStorage.getItem(snapKey(Number(A))), 'the fill is marked as calendar-sourced');
    });
});
