/**
 * paycalc-roster-suggestions.test.mjs
 * Tests for getRosterSuggestion, fetchOverridesForPeriod, and override priority.
 * Run with: node --experimental-test-module-mocks --test paycalc-roster-suggestions.test.mjs
 *
 * firebase-client.js is mocked via mock.module() because it imports Firebase
 * from CDN URLs that are unreachable in Node. The version constant V must match
 * the ?v= string used inside paycalc-roster-suggestions.js — update both together
 * when bumping the app version.
 */

import { test, describe, mock } from 'node:test';
import assert from 'node:assert/strict';

// V must match the ?v= suffix inside paycalc-roster-suggestions.js imports.
const V = '8.65';

// Mutable getter — individual tests can swap this out via _setMockGetDocs().
let _mockGetDocs = async () => ({ forEach: () => {} });

// mock.module must be called before the module under test is imported.
mock.module(`./firebase-client.js?v=${V}`, {
  namedExports: {
    db:         null,
    collection: () => null,
    query:      () => null,
    where:      () => null,
    getDocs:    (...args) => _mockGetDocs(...args),
  },
});

const {
  getRosterSuggestion,
  _setOverridesForTest,
  fetchOverridesForPeriod,
  resetOverrides,
} = await import('./paycalc-roster-suggestions.js');

const { teamMembers } = await import('./roster-data.js');
const cReen = teamMembers.find(m => m.name === 'C. Reen');
// C. Reen: fixed roster — Mon–Fri 12:00-19:00 (7h), Sat/Sun RD.

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

  test('Saturday override → sat bucket, no overtime when base is RD', () => {
    // C. Reen base Sat=RD → no base duration to split against.
    _setOverridesForTest(new Map([
      ['2026-04-11', { type: 'shift', value: '10:00-18:00', _ts: 1, _manual: true }],
    ]));
    const s = getRosterSuggestion(period('2026-04-11'), cReen);
    assert.ok(s);
    assert.equal(s.satCount, 1);
    assert.equal(s.satH, 8);
    assert.equal(s.satM, 0);
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

  test('AL override on BH day → suppresses contribution → null', () => {
    _setOverridesForTest(new Map([
      ['2026-04-06', { type: 'annual_leave', value: 'AL', _ts: 1, _manual: true }],
    ]));
    assert.strictEqual(getRosterSuggestion(period('2026-04-06'), cReen), null);
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
    // manual value (10:00-19:00 = 9h) wins despite lower timestamp
    const s = getRosterSuggestion(period(date), cReen);
    assert.ok(s);
    assert.equal(s.satH, 9); // 10:00-19:00 = 9h
  });

  test('within same class, newer createdAt wins', async () => {
    const date = '2026-04-11';
    _mockGetDocs = async () => mockSnap([
      { date, memberName: 'C. Reen', type: 'shift', value: '08:00-16:00', source: 'manual', createdAt: { toMillis: () => 500  } }, // 8h older
      { date, memberName: 'C. Reen', type: 'shift', value: '10:00-19:00', source: 'manual', createdAt: { toMillis: () => 2000 } }, // 9h newer
    ]);
    resetOverrides('checking');
    await fetchOverridesForPeriod({ start: new Date(date), cutoff: new Date(date) }, 'C. Reen');
    const s = getRosterSuggestion(period(date), cReen);
    assert.ok(s);
    assert.equal(s.satH, 9); // newer (9h) wins over older (8h)
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
