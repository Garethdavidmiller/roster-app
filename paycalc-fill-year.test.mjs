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
import { HM_PAIRS } from './paycalc-format.js';

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

// ─────────────────────────────────────────────────────────────────────────────────────────────
// RULE 5 — THE FILL OWNS THE CALENDAR'S FIELDS AND NOTHING ELSE (v22.13)
//
// The bug this pins, reported by an external review and reproduced against the shipped code:
// `isDataEmpty` deliberately means "has no CALCULATION INPUTS", and it is right to — a period
// holding only a payslip figure genuinely cannot produce an estimate. But the fill read that as
// "has nothing worth keeping" and then wrote a FRESH `emptyPeriodData()`. So a historical period
// holding actual gross/net/tax/NI, or a custom pension, and no premium hours was judged empty,
// overwritten, and the member's own typed figures were gone with no message.
//
// Two features, each correct alone — v22.06 (bulk fill) and v22.07 (the payslip actuals) — met over
// one saved object with nothing stating who owns which field.
//
// The fix is NOT to widen `isDataEmpty`: other callers correctly need "can this be calculated?".
// It is for the fill to PRESERVE the saved period and replace only what the calendar owns.
describe('rule 5 — a fill preserves every field the calendar does not own', () => {
    /** A period holding only payslip actuals + a custom pension: no hours at all. */
    const actualsOnly = () => ({
        ...emptyPeriodData(),
        actualGross: 3800.44, actualNet: 2900.12, actualTax: 512.30, actualNi: 205.10,
        actualPension: 151.86, pension: 123.45,
    });

    test('a period with payslip figures and no hours is still FILLABLE', () => {
        // It has no calculation inputs, so filling it is right — it is the WRITE that must not destroy.
        const { fillable } = fillablePeriods({
            periods: [PERIODS[0]], now: NOW, proRateFactor: () => 1,
            readSaved: () => ({ data: actualsOnly() }),
        });
        assert.equal(fillable.length, 1);
    });

    test('actuals-only: the fill adds hours and KEEPS every payslip figure', async () => {
        const { deps, writes } = makeDeps(
            { 1: { data: actualsOnly() } },
            { suggestions: { 1: { satH: 8, satM: 0 } } },
        );
        await fillYearFromCalendar({ periods: [PERIODS[0]], member: { name: 'G. Miller' }, now: NOW, deps });
        assert.equal(writes.length, 1, 'the period should have been filled');
        const d = writes[0].data;
        assert.equal(d.satH, 8, 'the calendar-owned field is written');
        for (const [k, v] of Object.entries({
            actualGross: 3800.44, actualNet: 2900.12, actualTax: 512.30,
            actualNi: 205.10, actualPension: 151.86, pension: 123.45,
        })) {
            assert.equal(d[k], v, `${k} is the member's own figure and must survive the fill`);
        }
    });

    test('a custom pension alone survives a fill', async () => {
        const { deps, writes } = makeDeps(
            { 1: { data: { ...emptyPeriodData(), pension: 99.01 } } },
            { suggestions: { 1: { sunH: 7, sunM: 30 } } },
        );
        await fillYearFromCalendar({ periods: [PERIODS[0]], member: { name: 'G. Miller' }, now: NOW, deps });
        assert.equal(writes[0].data.pension, 99.01);
        assert.equal(writes[0].data.sunH, 7);
    });

    test('a period with NOTHING saved still fills against the full empty schema', async () => {
        // The preserve must not depend on there BEING a saved object to preserve.
        const { deps, writes } = makeDeps({}, { suggestions: { 1: { satH: 4, satM: 0 } } });
        await fillYearFromCalendar({ periods: [PERIODS[0]], member: { name: 'G. Miller' }, now: NOW, deps });
        assert.equal(writes[0].data.satH, 4);
        assert.equal(writes[0].data.actualNet, null, 'absent actuals stay null, not undefined');
        for (const k of Object.keys(emptyPeriodData())) {
            assert.ok(k in writes[0].data, `${k} must be present so a later read cannot see a hole`);
        }
    });

    test('every calendar-owned field is one isDataEmpty checks — the merge\'s safety condition', () => {
        // WHY THIS AND NOT A BEHAVIOURAL CASE. The obvious other-direction test — "a stale hour the
        // suggestion no longer reports is zeroed" — is UNREACHABLE: every HM_PAIRS field is one
        // `isDataEmpty` looks at, so a period holding one is not fillable and never reaches the
        // write. That relationship is exactly what makes `{...empty, ...saved}` safe rather than a
        // way of preserving stale hours, and it holds by coincidence of two separate lists.
        //
        // So it is asserted structurally. Add a calendar-owned field that `isDataEmpty` ignores and
        // the merge would silently start carrying a stale value forward — this fails first.
        for (const { hId, mId } of HM_PAIRS) {
            for (const id of [hId, mId]) {
                const withOne = { ...emptyPeriodData(), [id]: 1 };
                assert.equal(isDataEmpty(withOne), false,
                    `${id} is written by the fill, so isDataEmpty must count it — otherwise a period `
                    + 'holding it is judged fillable and the saved value is carried forward stale');
            }
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// RULE 6 — A RECEIPT COUNTS ONLY A VERIFIED WRITE (v22.13)
//
// `lsSet` swallows a storage exception on purpose: iOS private mode, a full quota and a
// locked-down browser all throw, and a preference that fails to save is not worth crashing a page
// over. A BULK write onto pay data reads that silence as success — so the fill could say
// "Filled 5 payslips" having stored three, and the member would believe the other two were done.
// The same shape as the migration defect `lsSetVerified` was written for.
describe('rule 6 — a write that did not persist is never counted as filled', () => {
    test('a refused write lands in `unsaved`, not `filled`', async () => {
        const { deps } = makeDeps({}, { suggestions: { 1: { satH: 8, satM: 0 }, 3: { sunH: 4, sunM: 0 } } });
        deps.write = (/** @type {number} */ pNum) => pNum !== 1;      // period 1's storage refuses
        const r = await fillYearFromCalendar({ periods: PERIODS, member: { name: 'G. Miller' }, now: NOW, deps });
        assert.deepEqual(r.unsaved.map((/** @type {any} */ p) => p.num), [1]);
        assert.ok(!r.filled.some((/** @type {any} */ p) => p.num === 1), 'a refused write must not be reported as filled');
        assert.deepEqual(r.filled.map((/** @type {any} */ p) => p.num), [3]);
    });

    test('the receipt NAMES what could not be saved, and does not claim it', async () => {
        const { deps } = makeDeps({}, { suggestions: { 1: { satH: 8, satM: 0 } } });
        deps.write = () => false;                                     // storage refuses everything
        const r = await fillYearFromCalendar({ periods: PERIODS, member: { name: 'G. Miller' }, now: NOW, deps });
        const text = fillYearReceipt(r, (/** @type {Date} */ d) => `D${d.getDate()}`).join(' ');
        assert.match(text, /Couldn't save/, 'the failure must be stated, not swallowed');
        assert.doesNotMatch(text, /^Filled/, 'nothing was filled, so nothing may be claimed');
        assert.match(text, /Nothing was lost/, 'and the member needs to know the old data survived');
    });

    test('an all-refused run still reports the OTHER outcomes truthfully', async () => {
        const { deps } = makeDeps({}, { suggestions: {} });           // no suggestions anywhere
        deps.write = () => false;
        const r = await fillYearFromCalendar({ periods: PERIODS, member: { name: 'G. Miller' }, now: NOW, deps });
        assert.equal(r.unsaved.length, 0, 'a period with nothing to add is never written, so never unsaved');
        assert.ok(r.nothing.length > 0);
    });
});
