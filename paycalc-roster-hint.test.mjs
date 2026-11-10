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

/** A suggestion a test supplies, or null for the default. @type {null | ((p: any) => any)} */
let _suggestion = null;
/** @type {string} */ let _fetchState = 'base-only';
/** @type {number} */ let _fetchCalls = 0;
/** @type {(v: string) => void} */ let _resolveFetch = () => {};
mock.module('./session.js', { namedExports: { getSession: () => ({ name: 'G. Miller' }) } });
mock.module('./paycalc-roster-suggestions.js', {
    namedExports: {
        bhsForYear: () => [],
        getOverridesFetchState: () => _fetchState,
        // Every period's calendar says 5h overtime, tagged with the period so a cross-write is visible —
        // unless a test hands in a suggestion of its own (the rendered-badge tests below).
        getRosterSuggestion: (/** @type {any} */ p) => (_suggestion ? _suggestion(p) : { otH: 5, otM: p.num % 60 }),
        fetchOverridesForPeriod: () => {
            _fetchCalls++;
            return new Promise(r => { _resolveFetch = (v) => { if (v === 'loaded') _fetchState = 'loaded'; r(v); }; });
        },
    },
});

const { fillFromRoster, snapKey, _restoreRosterSuggested, _applyRosterSuggestion, _confBadge, updateRosterHint, recordCalendarFigures } = await import('./paycalc-roster-hint.js');
// The REAL form writer, for the blocks that replay a page load (loadPeriodData's order).
const { writeFormData } = await import('./paycalc-form-data.js');
const { periodKey } = await import('./paycalc-migrations.js');

const A = '60', B = '61';
/** @type {number} */ let _autosaves = 0;
const autosave = () => { _autosaves++; };

beforeEach(() => { _store.clear(); _fetchState = 'base-only'; _fetchCalls = 0; _autosaves = 0; _suggestion = null; });

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

// ── A DEFAULT IS NEVER DRESSED AS A RECORD (paycalc.md, invariant 1) ──────────────────────────
// The suggestion engine flags the buckets holding a default; this is what the member then reads.
// The 7h Training-day default on a bank holiday (owner, 7 Nov 2026) arrives in the `bh` bucket,
// where an unflagged row carries no badge at all and so reads as a figure taken from the roster.
describe('the estimate badge', () => {
    test('an 8h default says so', () => {
        assert.deepEqual(_confBadge('rdw', true, 8), { text: 'Includes an 8h estimate \u2014 check', cls: 'conf-possible' });
    });
    test('the 7h Training-day default says so too, on a row that otherwise carries no badge', () => {
        assert.deepEqual(_confBadge('bh', false, 7), { text: 'Includes a 7h estimate \u2014 check', cls: 'conf-possible' });
        assert.equal(_confBadge('bh', false, 0), null, 'unflagged, the base bank-holiday row has no badge — which is why the flag matters');
    });
});

// THE CALL SITE, not only the helper (test audit, 7 Nov 2026). The two tests above call _confBadge
// directly, so the render could stop passing the 7h flag — `s.defaulted7h?.[r.cat] ? 7 : 0` dropped
// from the call — with this file green, and the bank-holiday row would read as a figure off the roster.
describe('the estimate badge reaches the rendered row', () => {
    /** Render the hint for payslip A with this suggestion, and return the rows' HTML. */
    function render(/** @type {any} */ suggestion) {
        setupDom(A);
        _els.rosterHintBar = { style: {} };
        _els.rosterRows = { innerHTML: '' };
        _suggestion = () => suggestion;
        updateRosterHint();
        return String(_els.rosterRows.innerHTML);
    }

    test('a 7h Training-day default on a bank holiday is labelled as an estimate', () => {
        const html = render({ bhH: 7, bhM: 0, bhCount: 1, bhFromOv: false, defaulted7h: { bh: true }, defaulted8h: {} });
        assert.match(html, /data-cat="bh"/, 'premise: the bank-holiday row rendered');
        assert.match(html, /Includes a 7h estimate/, 'the default was drawn as if the roster said so');
    });

    test('an 8h RDW default is labelled too', () => {
        const html = render({ rdwH: 8, rdwM: 0, rdwCount: 1, defaulted8h: { rdw: true }, defaulted7h: {} });
        assert.match(html, /data-cat="rdw"/, 'premise: the RDW row rendered');
        assert.match(html, /Includes an 8h estimate/);
    });

    // paycalc-3-2. The two cases above render with BLANK boxes — and that is not what a member sees:
    // the page applies the suggestion by itself on view, so the row they read is the MATCHED one, and
    // that state dropped the badge: "RDW 8h 1 day ✓" over a take-home holding 8 hours nobody recorded.
    // The badge is a statement about the figure, not about the mismatch.
    /** Apply `suggestion` as the page does on view, then render; return the rows' HTML. */
    function renderApplied(/** @type {any} */ suggestion) {
        setupDom(A);
        for (const id of HM_IDS) _els[id] = input();
        _els.rosterHintBar = { style: {} };
        _els.rosterRows = { innerHTML: '' };
        _suggestion = () => suggestion;
        _applyRosterSuggestion(suggestion);
        updateRosterHint();
        return String(_els.rosterRows.innerHTML);
    }

    test('the estimate badge stays on the row once the estimate is in the boxes', () => {
        const rdw = renderApplied({ rdwH: 8, rdwM: 0, rdwCount: 1, defaulted8h: { rdw: true }, defaulted7h: {} });
        assert.match(rdw, /roster-row--matched/, 'premise: the row is in its matched state');
        assert.match(rdw, /Includes an 8h estimate/, 'a matched row dressed the 8h default as a record');
        const bh = renderApplied({ bhH: 7, bhM: 0, bhCount: 1, bhFromOv: false, defaulted7h: { bh: true }, defaulted8h: {} });
        assert.match(bh, /roster-row--matched/);
        assert.match(bh, /Includes a 7h estimate/, 'a matched row dressed the 7h default as a record');
    });

    test('CONTROL: a matched row with no default stays the calm ✓, with no chip', () => {
        const html = renderApplied({ rdwH: 7, rdwM: 30, rdwCount: 1, defaulted8h: {}, defaulted7h: {} });
        assert.match(html, /roster-row--matched/);
        assert.doesNotMatch(html, /conf-badge/, 'only an ESTIMATE is worth repeating on a row that matches');
    });
});

/** An <input> as the page has one: `value` is always a string, and its classList works. */
function input() {
    const c = new Set();
    let v = '';
    return {
        get value() { return v; }, set value(x) { v = String(x); },
        classList: { add: (/** @type {string} */ x) => c.add(x), remove: (/** @type {string} */ x) => c.delete(x), contains: (/** @type {string} */ x) => c.has(x) },
    };
}

// ── THE SNAPSHOT DESCRIBES WHAT IS SAVED (paycalc-3-1) ───────────────────────────────────────────
//
// The snapshot is how a reload knows which SAVED figures came from the calendar (and so may follow
// it). The background refresh on view is display-only — it puts the calendar's latest figure in the
// box and saves nothing — but it used to rewrite the snapshot anyway. So a payslip filled at 8h of
// RDW, whose calendar later said 16h, showed 16 on one visit and, on the next, compared the saved 8
// against a snapshot of 16, decided the 8 was hand-typed, and kept it: 8 at 1.25x one visit, 16 the
// visit before, with nothing typed in between. Each visit below is loadPeriodData's order — the real
// writeFormData, the restore, then the fetch callback's display-only apply with no autosave.
describe('the background refresh never moves the snapshot of a saved figure', () => {
    /** A page load of payslip `pNum` holding `blob`, then the background refresh with `calendar`. */
    function visit(/** @type {number} */ pNum, /** @type {any} */ blob, /** @type {any} */ calendar) {
        setupDom(String(pNum));
        for (const id of HM_IDS) _els[id] = input();
        _els.peerVal = { textContent: '' }; _els.slSkipCheck = { checked: false }; _els.otherAdj = { value: '' };
        writeFormData(blob);
        _restoreRosterSuggested(pNum);
        _applyRosterSuggestion(calendar);
        return { rdw: _els.rdwH.value, gold: _els.rdwH.classList.contains('roster-suggested') };
    }
    const snapOf = (/** @type {number} */ n) => JSON.parse(String(localStorage.getItem(snapKey(n))));

    test('a filled figure whose calendar later changes reads the same on every visit', () => {
        _store.set(snapKey(58), JSON.stringify({ rdwH: 8, rdwM: 0 }));     // pressed Fill at 8h
        const saved = { rdwH: 8, rdwM: 0 };
        const calendar = { rdwH: 16, rdwM: 0 };                             // a second RDW recorded since
        const first = visit(58, saved, calendar);
        const second = visit(58, saved, calendar);
        assert.deepEqual(first, { rdw: '16', gold: true }, 'premise: the calendar-linked figure follows the calendar');
        assert.deepEqual(second, first, 'the next visit read the saved 8 as typed and showed it instead');
        assert.equal(snapOf(58).rdwH, 8, 'viewing rewrote the snapshot of a figure nothing saved');
    });

    test('a visit with no signal does not strip a saved figure of its calendar link', () => {
        _store.set(snapKey(58), JSON.stringify({ satH: 8, satM: 0, rdwH: 8, rdwM: 0 }));
        const saved = { satH: 8, satM: 0, rdwH: 8, rdwM: 0 };
        visit(58, saved, { satH: 8, satM: 0, rdwH: 0, rdwM: 0 });          // base pattern only: no RDW
        assert.deepEqual(visit(58, saved, { satH: 8, satM: 0, rdwH: 16, rdwM: 0 }), { rdw: '16', gold: true },
            'one visit with no signal turned a calendar figure into a typed one for good');
    });

    test('CONTROL: a figure the refresh fills from blank, then saved by the member, stays linked', () => {
        // Implicit acceptance (paycalc.md): typing anything else saves the gold figures with it.
        assert.deepEqual(visit(58, {}, { rdwH: 8, rdwM: 0 }), { rdw: '8', gold: true });
        const savedByAutosave = { rdwH: 8, rdwM: 0 };
        assert.deepEqual(visit(58, savedByAutosave, { rdwH: 16, rdwM: 0 }), { rdw: '16', gold: true },
            'a figure the member accepted lost its calendar link');
    });

    // The save's own half: `recordCalendarFigures`, which the coordinator's autosave calls once it
    // has written the payslip. A REFRESHED figure (8h saved, 16h shown) that the member then saves by
    // typing somewhere else must stay linked — the display-only refresh no longer records it.
    test('a refreshed figure the member saves keeps its calendar link, through the save', () => {
        _store.set(snapKey(58), JSON.stringify({ rdwH: 8, rdwM: 0 }));
        assert.deepEqual(visit(58, { rdwH: 8, rdwM: 0 }, { rdwH: 16, rdwM: 0 }), { rdw: '16', gold: true });
        _els.otH.value = '3';                                               // the member types overtime…
        const saved = { rdwH: 16, rdwM: 0, otH: 3, otM: 0 };              // …and autosave saves the form
        _store.set(periodKey(58), JSON.stringify(saved));
        recordCalendarFigures(58);
        assert.deepEqual(snapOf(58), { rdwH: 16, rdwM: 0 }, 'the snapshot must name exactly the gold figures saved');
        assert.deepEqual(visit(58, saved, { rdwH: 24, rdwM: 0 }), { rdw: '24', gold: true },
            'the saved 16 came back as typed, and stopped following the calendar');
        assert.equal(_els.otH.value, '3', 'and the typed overtime is never treated as the calendar\'s');
    });

    test('a saved figure the member typed is never recorded as the calendar\'s', () => {
        setupDom('58');
        for (const id of HM_IDS) _els[id] = input();
        _els.rdwH.value = '8'; _els.rdwH.classList.add('roster-suggested'); _els.rdwM.classList.add('roster-suggested');
        _els.satH.value = '7';                                              // typed: no gold
        _store.set(snapKey(58), JSON.stringify({ satH: 7, satM: 0 }));     // a stale entry from an old fill
        _store.set(periodKey(58), JSON.stringify({ rdwH: 8, rdwM: 0, satH: 7, satM: 0 }));
        recordCalendarFigures(58);
        assert.deepEqual(snapOf(58), { rdwH: 8, rdwM: 0 }, 'a typed 7h of Saturday would follow the calendar on the next visit');
    });
});
