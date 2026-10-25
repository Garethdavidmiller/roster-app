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

const { fillFromRoster, snapKey, _restoreRosterSuggested, _applyRosterSuggestion } = await import('./paycalc-roster-hint.js');

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
        // Numerically, because the box SHOWS two digits (polish round 2) — see the block below.
        assert.equal(Number(_els.otM.value), Number(A) % 60);
        assert.equal(_autosaves, 1);
        assert.ok(localStorage.getItem(snapKey(Number(A))), 'the fill is marked as calendar-sourced');
    });
});

// ── A FILLED MINUTES BOX READS "00", NOT "0" (polish round 2) ────────────────────────────────────
// The calendar fill wrote the engine's number straight in, so 16h showed "16 : 0" beside empty boxes
// reading "0 : 00" (their placeholder). The fix is DISPLAY ONLY — every reader parses the box — so
// this pins both halves: the fill shows two digits, and what it saved is the number, unchanged.
describe('fillFromRoster — the minutes box shows two digits', () => {
    test('a whole-hour fill shows "00" and saves minutes as the number 0', async () => {
        setupDom(A);                            // period 60 → the mock's otM is 60 % 60 = 0
        const run = fillFromRoster(autosave);
        _resolveFetch('loaded');
        await run;
        assert.equal(_els.otM.value, '00', 'a filled zero-minute box must read "00", not "0"');
        const snap = JSON.parse(String(localStorage.getItem(snapKey(Number(A)))));
        assert.equal(snap.otM, 0, 'the snapshot keeps the NUMBER, not the display text');
    });

    test('a single-digit minute fill shows a leading zero', async () => {
        setupDom('62');                         // 62 % 60 = 2 → "02"
        const run = fillFromRoster(autosave);
        _resolveFetch('loaded');
        await run;
        assert.equal(_els.otM.value, '02');
    });
});

// ── THE GOLD COMES BACK ON BOTH HALVES OF A WHOLE-HOUR FILL (48-hour review) ───────────────────
describe('restoring the calendar-fill highlight after a reload', () => {
    test('a whole-hour fill (16h 0m) highlights the MINUTES box too, which writeFormData left blank', () => {
        setupDom('1');
        /** @type {Record<string, Set<string>>} */ const cls = {};
        for (const id of HM_IDS) {
            cls[id] = new Set();
            _els[id].classList = { add: (/** @type {string} */ c) => cls[id].add(c), remove: (/** @type {string} */ c) => cls[id].delete(c) };
        }
        _store.set(snapKey(1), JSON.stringify({ satH: 16, satM: 0 }));
        // What writeFormData puts in the boxes for a saved 16h 0m: "16", and a BLANK minutes box.
        _els.satH.value = '16';
        _els.satM.value = '';
        _restoreRosterSuggested(1);
        assert.ok(cls.satH.has('roster-suggested'), 'the hours box is gold');
        assert.ok(cls.satM.has('roster-suggested'), 'and so is the minutes box beside it — "00" never matched a blank');
    });
});

// ── ONE PAIR, ONE AUTHOR (whole-app review, Oct 2026) ──────────────────────────────────────────
//
// The background refresh fills only what the member has not typed — and used to judge that per BOX.
// A payslip saved as RDW 8h 0m reloads as "8" beside a BLANK minutes box (writeFormData writes a
// saved 0 as blank), so a calendar 7h 30m kept the typed 8 and put its 30 in the blank: 8h 30m, a
// figure neither side gave, priced at once and saved by the next unrelated edit. The reviewer saw a
// take-home move £7.96 in the browser. The pair is one figure; if either half was typed, it is theirs.
describe('the background fill treats an hours box and its minutes box as ONE figure', () => {
    /** Fields with a working classList, so "typed" vs "gold" is real. */
    function gold() {
        setupDom('1');
        for (const id of HM_IDS) {
            const c = new Set();
            _els[id].classList = { add: (/** @type {string} */ x) => c.add(x), remove: (/** @type {string} */ x) => c.delete(x), contains: (/** @type {string} */ x) => c.has(x) };
        }
    }
    const CAL = { rdwH: 7, rdwM: 30 };

    test('typed hours beside a blank minutes box (a saved 8h 0m) take NOTHING from the calendar', () => {
        gold();
        _els.rdwH.value = '8';
        _applyRosterSuggestion(CAL);
        assert.equal(_els.rdwH.value, '8');
        assert.equal(_els.rdwM.value, '', 'the calendar\'s 30 went into the blank half of a typed 8h 0m — priced as 8h 30m');
    });

    test('typed minutes beside a blank hours box take nothing either', () => {
        gold();
        _els.rdwM.value = '45';
        _applyRosterSuggestion(CAL);
        assert.equal(_els.rdwH.value, '', 'the calendar\'s 7 joined a typed 45 minutes — 7h 45m');
        assert.equal(_els.rdwM.value, '45');
    });

    test('a pair the member never typed is still filled, and a gold pair is still refreshed', () => {
        gold();
        _applyRosterSuggestion(CAL);
        assert.equal(_els.rdwH.value, 7);
        assert.equal(_els.rdwM.value, '30');
        _applyRosterSuggestion({ rdwH: 6, rdwM: 15 });
        assert.equal(_els.rdwH.value, 6, 'a calendar-filled pair follows the calendar');
        assert.equal(_els.rdwM.value, '15');
    });
});
