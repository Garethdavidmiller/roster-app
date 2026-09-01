// @ts-check
/**
 * paycalc-fill-year.test.mjs — the bulk fill, organised by what a bulk write against PAY DATA can
 * destroy. The four rules in the module header each get their violation shown to fail:
 *
 *  - OVERWRITING ENTERED DATA is the catastrophic direction — hand-typed pay figures replaced by
 *    an estimate, silently, in periods nobody is looking at. Rule 1's cases pin that an entered
 *    period is untouchable even when everything else about it qualifies.
 *  - OVERWRITING A CORRUPT PERIOD destroys the evidence the corrupt-period banner exists to
 *    surface. Rule 2.
 *  - A BASE-ONLY FILL puts confident numbers into an invisible period while the recorded shift
 *    changes that would correct them sit unfetched. Rule 3: skipped and NAMED.
 *  - AN UNMARKED FILL looks hand-entered — the gold provenance is what tells the member (and the
 *    result card's chip) that these hours are the calendar's guess. Rule 4.
 *
 * The deps are fakes; emptiness and the write SHAPE are the real isDataEmpty/emptyPeriodData —
 * a restated schema here would pass against a drifted one. Part of test:hygiene.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { fillablePeriods, fillYearFromCalendar, fillYearReceipt } from './paycalc-fill-year.js';
import { emptyPeriodData, isDataEmpty } from './paycalc-form-data.js';

const NOW = new Date(2026, 8, 1);
const P = (num, payday, over = {}) => ({ num, payday, ...over });
const PERIODS = [
    P(1, new Date(2026, 3, 10)),   // paid
    P(2, new Date(2026, 4, 8)),    // paid
    P(3, new Date(2026, 5, 5)),    // paid
    P(4, new Date(2026, 11, 25)),  // future — never touched
];

/** A deps bundle over an in-memory store. @param {Record<number, any>} saved */
function makeDeps(saved = {}, { overrideState = 'loaded', suggestions = {} } = {}) {
    const writes = /** @type {{pNum: number, data: any, snap: any}[]} */ ([]);
    const fetched = /** @type {number[]} */ ([]);
    return {
        writes, fetched,
        deps: {
            proRateFactor: () => 1,
            readSaved: (/** @type {number} */ n) => saved[n] ?? { data: null },
            fetchOverrides: async (/** @type {any} */ p) => { fetched.push(p.num); return typeof overrideState === 'function' ? overrideState(p) : overrideState; },
            suggest: (/** @type {any} */ p) => suggestions[p.num] ?? null,
            write: (/** @type {number} */ pNum, /** @type {any} */ data, /** @type {any} */ snap) => writes.push({ pNum, data, snap }),
        },
    };
}

describe('rule 1 — never a period with entered data', () => {
    test('an entered period is untouchable; the empty ones around it fill', async () => {
        const { deps, writes } = makeDeps(
            { 2: { data: { ...emptyPeriodData(), satH: 7 } } },
            { suggestions: { 1: { satH: 4, satM: 30 }, 3: { rdwH: 8, rdwM: 0 } } });
        const r = await fillYearFromCalendar({ periods: PERIODS, member: { name: 'G. Miller' }, now: NOW, deps });
        assert.deepEqual(writes.map(w => w.pNum), [1, 3]);
        assert.deepEqual(r.filled.map(p => p.num), [1, 3]);
    });

    test('eligibility is the SAME test as "Not entered yet": unpaid and pre-start periods are out', () => {
        const { fillable } = fillablePeriods({
            periods: PERIODS, now: NOW,
            proRateFactor: (/** @type {any} */ p) => (p.num === 1 ? 0 : 1),   // joiner: P1 pre-start
            readSaved: () => ({ data: null }),
        });
        assert.deepEqual(fillable.map(p => p.num), [2, 3]);                   // no P1, no future P4
    });

    test('a period holding ONLY a non-hours entry (slSkip, an adjustment) still counts as entered', () => {
        const { fillable } = fillablePeriods({
            periods: [PERIODS[0]], now: NOW, proRateFactor: () => 1,
            readSaved: () => ({ data: { ...emptyPeriodData(), slSkip: true } }),
        });
        assert.equal(fillable.length, 0);
    });
});

describe('rule 2 — a corrupt period is never written', () => {
    test('an unreadable save is skipped, counted, and reaches the receipt', async () => {
        const { deps, writes } = makeDeps(
            { 1: { data: null, error: new Error('bad json') } },
            { suggestions: { 1: { satH: 4 }, 2: { satH: 2 }, 3: null } });
        const r = await fillYearFromCalendar({ periods: PERIODS, member: { name: 'G. Miller' }, now: NOW, deps });
        assert.ok(!writes.some(w => w.pNum === 1), 'the corrupt period must not be written');
        assert.deepEqual(r.corrupt.map(p => p.num), [1]);
        assert.match(fillYearReceipt(r, d => String(d.getDate())).join(' '), /couldn't be read and was left untouched/);
    });
});

describe('rule 3 — no base-only fills into invisible periods', () => {
    test('a period whose recorded-changes fetch fails is skipped and NAMED, not half-filled', async () => {
        const { deps, writes } = makeDeps({}, {
            overrideState: (/** @type {any} */ p) => (p.num === 2 ? 'base-only' : 'loaded'),
            suggestions: { 1: { satH: 4 }, 2: { satH: 9 }, 3: null },
        });
        const r = await fillYearFromCalendar({ periods: PERIODS, member: { name: 'G. Miller' }, now: NOW, deps });
        assert.deepEqual(writes.map(w => w.pNum), [1]);
        assert.deepEqual(r.unreached.map(p => p.num), [2]);
        assert.match(fillYearReceipt(r, d => String(d.getDate())).join(' '), /Couldn't check your recorded shift changes/);
    });

    test('a fetch that THROWS is the same answer as base-only', async () => {
        const { deps, writes } = makeDeps({}, {
            overrideState: () => { throw new Error('offline'); },
            suggestions: { 1: { satH: 4 } },
        });
        const r = await fillYearFromCalendar({ periods: [PERIODS[0]], member: { name: 'G. Miller' }, now: NOW, deps });
        assert.equal(writes.length, 0);
        assert.equal(r.unreached.length, 1);
    });
});

describe('rule 4 — fills are marked, and the written shape is the schema\'s', () => {
    test('the write carries the full data shape (non-empty by the real test) AND the gold snapshot', async () => {
        const { deps, writes } = makeDeps({}, { suggestions: { 1: { satH: 4, satM: 30, rdwH: 8 } } });
        await fillYearFromCalendar({ periods: [PERIODS[0]], member: { name: 'G. Miller' }, now: NOW, deps });
        const w = writes[0];
        assert.equal(w.data.satH, 4); assert.equal(w.data.satM, 30); assert.equal(w.data.rdwH, 8);
        assert.equal(w.data.sunH, 0, 'unsuggested categories are the schema zero, not absent');
        assert.equal(w.data.actualNet, null, 'the full emptyPeriodData shape rides along');
        assert.equal(isDataEmpty(w.data), false, 'a fill must not write the empty shape');
        assert.equal(w.snap.satH, 4); assert.equal(w.snap.rdwH, 8);
        assert.ok('sunH' in w.snap, 'the snapshot mirrors _saveRosterSnap: every pair key present');
    });

    test('a quiet period (no premium shifts) writes nothing and is reported as nothing-to-add', async () => {
        const { deps, writes } = makeDeps({}, { suggestions: {} });
        const r = await fillYearFromCalendar({ periods: [PERIODS[0]], member: { name: 'G. Miller' }, now: NOW, deps });
        assert.equal(writes.length, 0);
        assert.equal(r.nothing.length, 1);
        assert.match(fillYearReceipt(r, d => String(d.getDate())).join(' '), /No special-rate hours to add/);
    });
});

test('the all-clear receipt exists — a tap with nothing eligible must say so, not go quiet', () => {
    assert.match(fillYearReceipt({ filled: [], unreached: [], nothing: [], corrupt: [] }, d => '')[0],
        /already has entries — nothing to fill/);
});
