/**
 * paycalc-roster-suggestions.test.mjs
 * Tests for getRosterSuggestion, fetchOverridesForPeriod, and override priority.
 * Run with: node --experimental-test-module-mocks --test paycalc-roster-suggestions.test.mjs
 *
 * firebase-client.js is mocked via mock.module() because it imports Firebase
 * from CDN URLs that are unreachable in Node.
 */

import { test, describe, mock } from 'node:test';
import assert from 'node:assert/strict';

// Mutable getter — individual tests can swap this out via _setMockGetDocs().
let _mockGetDocs = async () => ({ forEach: () => {} });

// mock.module must be called before the module under test is imported.
mock.module('./firebase-client.js', {
  namedExports: {
    db:          null,
    collection:  () => null,
    query:       () => null,
    where:       () => null,
    getDocs:     (...args) => _mockGetDocs(...args),
    COLLECTIONS: { overrides: 'overrides', huddles: 'huddles', circulars: 'circulars', newsletters: 'newsletters', pushSubscriptions: 'pushSubscriptions', staffContact: 'staffContact', clientErrors: 'clientErrors', linkDesigns: 'linkDesigns' },
  },
});

const {
  getRosterSuggestion,
  _setOverridesForTest,
  _addBhDateForTest,
  _removeBhDateForTest,
  fetchOverridesForPeriod,
  resetOverrides,
} = await import('./paycalc-roster-suggestions.js');

const { teamMembers } = await import('./roster-data.js');
const cReen = teamMembers.find(m => m.name === 'C. Reen');
// C. Reen: fixed roster — Mon–Fri 12:00-19:00 (7h), Sat/Sun RD.
const sBoyle = teamMembers.find(m => m.name === 'S. Boyle');
// S. Boyle: main roster wk10 — has a SPARE week in Jan 2026. Base is SPARE on the dates below
// (verified against getBaseShift), used for the spare-week RDW/contracted-Saturday tests:
//   2026-01-19 (Mon)  → SPARE weekday
//   2026-01-24 (Sat)  → SPARE Saturday
// Neither is a bank holiday.

// ── Helpers ───────────────────────────────────────────────────────────────────

function mockSnap(docs) {
  return { forEach: cb => docs.forEach(d => cb({ data: () => d })) };
}

function period(...isoStrings) {
  const dates = isoStrings.map(s => new Date(s)).sort((a, b) => a - b);
  return { start: dates[0], cutoff: dates[dates.length - 1] };
}

// ── getRosterSuggestion ───────────────────────────────────────────────────────

describe('getRosterSuggestion — base roster', () => {

  test('returns null for null member', () => {
    _setOverridesForTest(new Map());
    assert.strictEqual(getRosterSuggestion(period('2026-04-13'), null), null);
  });

  test('plain weekday (no override) → null', () => {
    _setOverridesForTest(new Map());
    // 2026-04-08 is Wednesday — C. Reen base 12:00-19:00, but weekday base hours
    // are contracted basic pay, not a special category.
    assert.strictEqual(getRosterSuggestion(period('2026-04-08'), cReen), null);
  });

  test('Easter Monday base shift → bh bucket (7h)', () => {
    _setOverridesForTest(new Map());
    // 2026-04-06 is Easter Monday — C. Reen base 12:00-19:00.
    const s = getRosterSuggestion(period('2026-04-06'), cReen);
    assert.ok(s, 'expected a suggestion');
    assert.equal(s.bhCount, 1);
    assert.equal(s.bhH, 7);
    assert.equal(s.bhM, 0);
    assert.equal(s.satCount + s.sunCount + s.otCount + s.rdwCount + s.boxCount, 0);
  });

});

describe('getRosterSuggestion — overrides via _setOverridesForTest', () => {

  test('BH extended override → bh 7h + bhOt 2h (12:00-21:00 on Easter Monday)', () => {
    _setOverridesForTest(new Map([
      ['2026-04-06', { type: 'shift', value: '12:00-21:00', _ts: 1, _manual: true }],
    ]));
    const s = getRosterSuggestion(period('2026-04-06'), cReen);
    assert.ok(s);
    assert.equal(s.bhCount, 1);
    assert.equal(s.bhH, 7);
    assert.equal(s.bhM, 0);
    assert.equal(s.bhOtCount, 1);
    assert.equal(s.bhOtH, 2);
    assert.equal(s.bhOtM, 0);
  });

  test('Saturday override when base is RD → rdw bucket (confirmed payroll rule)', () => {
    // C. Reen base Sat=RD → rest day worked, goes to RDW not Saturday enhanced rate.
    // Gareth confirmed May 2026: unrostered Saturday = Rest Day Working.
    _setOverridesForTest(new Map([
      ['2026-04-11', { type: 'shift', value: '10:00-18:00', _ts: 1, _manual: true }],
    ]));
    const s = getRosterSuggestion(period('2026-04-11'), cReen);
    assert.ok(s);
    assert.equal(s.rdwCount, 1);
    assert.equal(s.rdwH, 8);
    assert.equal(s.rdwM, 0);
    assert.equal(s.satCount, 0);
    assert.equal(s.otCount, 0);
  });

  test('Sunday override → sun bucket', () => {
    _setOverridesForTest(new Map([
      ['2026-04-12', { type: 'shift', value: '10:00-18:00', _ts: 1, _manual: true }],
    ]));
    const s = getRosterSuggestion(period('2026-04-12'), cReen);
    assert.ok(s);
    assert.equal(s.sunCount, 1);
    assert.equal(s.sunH, 8);
    assert.equal(s.sunM, 0);
  });

  test('RDW override on weekday → rdw bucket', () => {
    _setOverridesForTest(new Map([
      ['2026-04-13', { type: 'rdw', value: '14:00-22:00', _ts: 1, _manual: true }],
    ]));
    const s = getRosterSuggestion(period('2026-04-13'), cReen); // Monday, not BH
    assert.ok(s);
    assert.equal(s.rdwCount, 1);
    assert.equal(s.rdwH, 8);
    assert.equal(s.rdwM, 0);
    assert.equal(s.otCount, 0);
  });

  test('extended weekday shift → overtime only (12:00-21:00 vs base 7h = 2h OT)', () => {
    _setOverridesForTest(new Map([
      ['2026-04-13', { type: 'shift', value: '12:00-21:00', _ts: 1, _manual: true }],
    ]));
    const s = getRosterSuggestion(period('2026-04-13'), cReen);
    assert.ok(s);
    assert.equal(s.otCount, 1);
    assert.equal(s.otH, 2);
    assert.equal(s.otM, 0);
    assert.equal(s.satCount + s.sunCount + s.bhCount + s.rdwCount + s.boxCount, 0);
  });

  test('weekday override at exact base duration → no overtime', () => {
    _setOverridesForTest(new Map([
      ['2026-04-13', { type: 'shift', value: '12:00-19:00', _ts: 1, _manual: true }],
    ]));
    // Exactly matches base — no special category → null
    assert.strictEqual(getRosterSuggestion(period('2026-04-13'), cReen), null);
  });

  test('Boxing Day override → box bucket, not bh or sat', () => {
    // 2026-12-26 is a Saturday. C. Reen base Sat=RD, override to work.
    _setOverridesForTest(new Map([
      ['2026-12-26', { type: 'shift', value: '10:00-18:00', _ts: 1, _manual: true }],
    ]));
    const s = getRosterSuggestion(period('2026-12-26'), cReen);
    assert.ok(s);
    assert.equal(s.boxCount, 1);
    assert.equal(s.boxH, 8);
    assert.equal(s.bhCount, 0);
    assert.equal(s.satCount, 0);
  });

  test('Boxing Day on a Sunday → box bucket (3×), not sun (1.5×)', () => {
    // 2027-12-26 is a Sunday. 26 Dec is always the 3× Boxing Day rate regardless
    // of weekday (confirmed by Gareth) — the isBoxing check must run BEFORE the
    // Sunday (dow === 0 → 1.5×) branch. C. Reen base Sun=RD, override to work.
    _setOverridesForTest(new Map([
      ['2027-12-26', { type: 'shift', value: '10:00-18:00', _ts: 1, _manual: true }],
    ]));
    const s = getRosterSuggestion(period('2027-12-26'), cReen);
    assert.ok(s);
    assert.equal(s.boxCount, 1);
    assert.equal(s.boxH, 8);
    assert.equal(s.sunCount, 0);
    assert.equal(s.bhCount, 0);
  });

  test('AL override on BH day → suppresses contribution → null', () => {
    _setOverridesForTest(new Map([
      ['2026-04-06', { type: 'annual_leave', value: 'AL', _ts: 1, _manual: true }],
    ]));
    assert.strictEqual(getRosterSuggestion(period('2026-04-06'), cReen), null);
  });

  test('RDW override on rostered BH → base hours to bh, rdw hours to bhOt', () => {
    // Easter Monday 2026 (2026-04-06): C. Reen base 12:00-19:00 (7h worked).
    // Admin records an rdw override (extra block, e.g. 20:00-22:00 = 2h).
    // Expected: base 7h → bh bucket, rdw 2h → bhOt bucket. No rdw bucket.
    _setOverridesForTest(new Map([
      ['2026-04-06', { type: 'rdw', value: '20:00-22:00', _ts: 1, _manual: true }],
    ]));
    const s = getRosterSuggestion(period('2026-04-06'), cReen);
    assert.ok(s, 'expected a suggestion');
    assert.equal(s.bhCount,   1);
    assert.equal(s.bhH,       7); // base shift 12:00-19:00
    assert.equal(s.bhM,       0);
    assert.equal(s.bhOtCount, 1);
    assert.equal(s.bhOtH,     2); // rdw override 20:00-22:00
    assert.equal(s.bhOtM,     0);
    assert.equal(s.satCount + s.sunCount + s.rdwCount + s.otCount + s.boxCount, 0);
  });

});

// ── Spare weeks: RDW vs contracted Saturday ───────────────────────────────────
// Confirmed operational rule (Gareth, Jul 2026): in a spare week a worked Saturday is one of the
// four CONTRACTED days (paid as a rostered Saturday, 1.25×) — UNLESS the roster specifically marks
// it RDW, in which case it is rest-day-worked. And an RDW written on any spare-week day is picked
// up as RDW regardless of the SPARE base. These pin those three cases against a real SPARE base.

describe('getRosterSuggestion — spare weeks (RDW vs contracted Saturday)', () => {

  test('RDW override on a SPARE weekday → rdw bucket (SPARE base does not suppress it)', () => {
    // 2026-01-19 is a Monday, S. Boyle base = SPARE. An explicit rdw override is picked up because
    // effType === 'rdw' is checked before any base/day-of-week logic.
    _setOverridesForTest(new Map([
      ['2026-01-19', { type: 'rdw', value: '06:00-14:00', _ts: 1, _manual: true }],
    ]));
    const s = getRosterSuggestion(period('2026-01-19'), sBoyle);
    assert.ok(s);
    assert.equal(s.rdwCount, 1);
    assert.equal(s.rdwH, 8);
    assert.equal(s.satCount, 0);
    assert.equal(s.otCount, 0);
  });

  test('SPARE Saturday worked as a plain shift → sat bucket (contracted Saturday, 1.25×), all hours, no OT', () => {
    // 2026-01-24 is a Saturday, S. Boyle base = SPARE. A plain shift (not marked RDW) is the spare
    // week's actual allocation — one of the four contracted days — so ALL hours go to sat (no base
    // to cap against, so no overtime split), NOT rdw.
    _setOverridesForTest(new Map([
      ['2026-01-24', { type: 'shift', value: '10:00-18:00', _ts: 1, _manual: true }],
    ]));
    const s = getRosterSuggestion(period('2026-01-24'), sBoyle);
    assert.ok(s);
    assert.equal(s.satCount, 1);
    assert.equal(s.satH, 8);
    assert.equal(s.otCount, 0);
    assert.equal(s.rdwCount, 0);
  });

  test('SPARE Saturday specifically marked RDW → rdw bucket (RDW wins over the contracted-Saturday rule)', () => {
    // Same Saturday, but the roster marks it RDW → the effType === 'rdw' branch fires first, so it
    // is rest-day-worked, not a contracted Saturday.
    _setOverridesForTest(new Map([
      ['2026-01-24', { type: 'rdw', value: '10:00-18:00', _ts: 1, _manual: true }],
    ]));
    const s = getRosterSuggestion(period('2026-01-24'), sBoyle);
    assert.ok(s);
    assert.equal(s.rdwCount, 1);
    assert.equal(s.rdwH, 8);
    assert.equal(s.satCount, 0);
  });

});

// ── Training / Induction / Assessment (TRAINING_PLAN.md) ─────────────────────
// Training pays as the day underneath (resolveTrainingPay): weekday → contracted
// basic (nothing to suggest), BH → bh bucket, actual times → base-cap + excess→OT,
// TRG RDW → rdw bucket (8h default, member-adjusted). Sundays can never be training.

describe('getRosterSuggestion — training days', () => {

  test('training on a plain weekday → null (contracted basic already covers it)', () => {
    // 2026-04-08 Wed — C. Reen base 12:00-19:00; TRG resolves as-base → no special category.
    _setOverridesForTest(new Map([
      ['2026-04-08', { type: 'training', value: 'TRG', _ts: 1, _manual: true }],
    ]));
    assert.strictEqual(getRosterSuggestion(period('2026-04-08'), cReen), null);
  });

  test('training on a rostered BANK HOLIDAY → bh bucket at base hours (keeps the premium)', () => {
    // Easter Monday 2026 — C. Reen base 12:00-19:00 (7h). Induction that day pays as the day.
    _setOverridesForTest(new Map([
      ['2026-04-06', { type: 'training', value: 'IND', _ts: 1, _manual: true }],
    ]));
    const s = getRosterSuggestion(period('2026-04-06'), cReen);
    assert.ok(s);
    assert.equal(s.bhCount, 1);
    assert.equal(s.bhH, 7);
    assert.equal(s.rdwCount + s.otCount + s.satCount, 0);
  });

  test('training with ACTUAL times over the base shift → excess to overtime', () => {
    // 2026-04-13 Mon — base 12:00-19:00 (7h); training ran 12:00-21:00 (9h) → 2h OT.
    _setOverridesForTest(new Map([
      ['2026-04-13', { type: 'training', value: 'TRG 12:00-21:00', _ts: 1, _manual: true }],
    ]));
    const s = getRosterSuggestion(period('2026-04-13'), cReen);
    assert.ok(s);
    assert.equal(s.otCount, 1);
    assert.equal(s.otH, 2);
    assert.equal(s.rdwCount, 0);
  });

  test('TRG RDW with no times → rdw bucket with the 8h default', () => {
    // 2026-04-11 Sat — C. Reen base RD. Training rest-day defaults to 8h RDW (member adjusts).
    _setOverridesForTest(new Map([
      ['2026-04-11', { type: 'training', value: 'TRG RDW', _ts: 1, _manual: true }],
    ]));
    const s = getRosterSuggestion(period('2026-04-11'), cReen);
    assert.ok(s);
    assert.equal(s.rdwCount, 1);
    assert.equal(s.rdwH, 8);
    assert.equal(s.rdwM, 0);
    assert.equal(s.otCount + s.satCount, 0);
  });

  test('TRG RDW with ACTUAL times → rdw bucket with the real duration (never split into OT)', () => {
    _setOverridesForTest(new Map([
      ['2026-04-11', { type: 'training', value: 'TRG RDW 09:00-18:00', _ts: 1, _manual: true }],
    ]));
    const s = getRosterSuggestion(period('2026-04-11'), cReen);
    assert.ok(s);
    assert.equal(s.rdwCount, 1);
    assert.equal(s.rdwH, 9);
    assert.equal(s.otCount, 0, 'an RDW day is all-RDW — no overtime split');
  });

  test('training on a rest day WITHOUT the RDW flag → still rdw 8h (belt-and-braces, never £0)', () => {
    _setOverridesForTest(new Map([
      ['2026-04-11', { type: 'training', value: 'TRG', _ts: 1, _manual: true }],
    ]));
    const s = getRosterSuggestion(period('2026-04-11'), cReen);
    assert.ok(s);
    assert.equal(s.rdwCount, 1);
    assert.equal(s.rdwH, 8);
  });

  test('a (legacy) SUNDAY training override is ignored — Sundays are never training days', () => {
    // 2026-04-12 is a Sunday; the write layers block this, so a doc can only be legacy.
    _setOverridesForTest(new Map([
      ['2026-04-12', { type: 'training', value: 'TRG', _ts: 1, _manual: true }],
    ]));
    assert.strictEqual(getRosterSuggestion(period('2026-04-12'), cReen), null);
  });

  test('training in a SPARE week → null (one of the four contracted days; basic pay covers it)', () => {
    // 2026-01-24 Sat — S. Boyle base SPARE (verified date). Not a rest day, so NOT rdw.
    _setOverridesForTest(new Map([
      ['2026-01-24', { type: 'training', value: 'TRG', _ts: 1, _manual: true }],
    ]));
    assert.strictEqual(getRosterSuggestion(period('2026-01-24'), sBoyle), null);
  });

});

// ── fetchOverridesForPeriod — priority ────────────────────────────────────────

describe('fetchOverridesForPeriod — override priority', () => {

  test('manual override beats newer roster_import on same date', async () => {
    const date = '2026-04-11';
    _mockGetDocs = async () => mockSnap([
      { date, memberName: 'C. Reen', type: 'shift', value: '08:00-16:00', source: 'roster_import', createdAt: { toMillis: () => 2000 } },
      { date, memberName: 'C. Reen', type: 'shift', value: '10:00-19:00', source: 'manual',        createdAt: { toMillis: () => 500  } },
    ]);
    resetOverrides('checking');
    await fetchOverridesForPeriod({ start: new Date(date), cutoff: new Date(date) }, 'C. Reen');
    // manual value (10:00-19:00 = 9h) wins despite lower timestamp.
    // 2026-04-11 is a Saturday with C. Reen base=RD → rdw bucket (not sat).
    const s = getRosterSuggestion(period(date), cReen);
    assert.ok(s);
    assert.equal(s.rdwH, 9); // 10:00-19:00 = 9h
  });

  test('within same class, newer createdAt wins', async () => {
    const date = '2026-04-11';
    _mockGetDocs = async () => mockSnap([
      { date, memberName: 'C. Reen', type: 'shift', value: '08:00-16:00', source: 'manual', createdAt: { toMillis: () => 500  } }, // 8h older
      { date, memberName: 'C. Reen', type: 'shift', value: '10:00-19:00', source: 'manual', createdAt: { toMillis: () => 2000 } }, // 9h newer
    ]);
    resetOverrides('checking');
    await fetchOverridesForPeriod({ start: new Date(date), cutoff: new Date(date) }, 'C. Reen');
    // 2026-04-11 is a Saturday with C. Reen base=RD → rdw bucket (not sat).
    const s = getRosterSuggestion(period(date), cReen);
    assert.ok(s);
    assert.equal(s.rdwH, 9); // newer (9h) wins over older (8h)
  });

  test('docs for other members are ignored', async () => {
    const date = '2026-04-11';
    _mockGetDocs = async () => mockSnap([
      { date, memberName: 'G. Miller', type: 'shift', value: '08:00-16:00', source: 'manual', createdAt: { toMillis: () => 1000 } },
    ]);
    resetOverrides('checking');
    await fetchOverridesForPeriod({ start: new Date(date), cutoff: new Date(date) }, 'C. Reen');
    // No override for C. Reen → base Sat=RD → null
    assert.strictEqual(getRosterSuggestion(period(date), cReen), null);
  });

  test('getDocs failure → returns base-only, cache remains empty', async () => {
    const date = '2026-04-11';
    _mockGetDocs = async () => { throw new Error('network error'); };
    resetOverrides('checking');
    const result = await fetchOverridesForPeriod({ start: new Date(date), cutoff: new Date(date) }, 'C. Reen');
    assert.equal(result, 'base-only');
    // Cache empty → base roster used → BH on Easter Monday still shows
    _setOverridesForTest(new Map());
    assert.strictEqual(getRosterSuggestion(period(date), cReen), null); // Sat=RD base, no override
  });

});

// ── Sunday-on-BH payroll rule ─────────────────────────────────────────────────

describe('getRosterSuggestion — Sunday-on-BH payroll rule', () => {

  test('Sunday-on-BH: Sunday wins (sun bucket at 1.5×, not bh bucket)', () => {
    // Chiltern rule: Sunday always pays at 1.5×, regardless of whether it is also
    // a bank holiday. The dow===0 check is before isBH in the suggestion engine.
    // 2026-06-07 is a Sunday. Inject it as a BH to verify the ordering.
    _addBhDateForTest(2026, '2026-06-07');
    _setOverridesForTest(new Map([
      ['2026-06-07', { type: 'shift', value: '10:00-18:00', _ts: 1, _manual: true }],
    ]));
    const s = getRosterSuggestion(period('2026-06-07'), cReen);
    assert.ok(s, 'expected a suggestion for the Sunday override');
    assert.equal(s.sunCount, 1, 'Sunday-on-BH must go to sun bucket, not bh bucket');
    assert.equal(s.bhCount,  0, 'Sunday-on-BH must not go to bh bucket');
    // Cleanup
    _removeBhDateForTest(2026, '2026-06-07');
  });

});
