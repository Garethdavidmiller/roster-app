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
  getOverridesFetchState,
} = await import('./paycalc-roster-suggestions.js');

const { teamMembers, parseISODate } = await import('./roster-data.js');
const cReen = teamMembers.find(m => m.name === 'C. Reen');
// C. Reen: fixed roster — Mon–Fri 12:00-19:00 (7h), Sat/Sun RD.
const sBoyle = teamMembers.find(m => m.name === 'S. Boyle');
const lSpringer = teamMembers.find(m => m.name === 'L. Springer');
// L. Springer: main wk1 — base WORKED Sunday 2026-05-10 (14:30-23:25, ~8h55m), used for the
// Sunday-training fall-back test (verified against getBaseShift).
// S. Boyle: main roster wk10 — has a SPARE week in Jan 2026. Base is SPARE on the dates below
// (verified against getBaseShift), used for the spare-week RDW/contracted-Saturday tests:
//   2026-01-19 (Mon)  → SPARE weekday
//   2026-01-24 (Sat)  → SPARE Saturday
// Neither is a bank holiday.

// ── Helpers ───────────────────────────────────────────────────────────────────

function mockSnap(docs) {
  return { forEach: cb => docs.forEach(d => cb({ data: () => d })) };
}

/**
 * A pay period spanning the given dates. Built at LOCAL NOON with the app's own `parseISODate`, as
 * the app builds its periods — `new Date('YYYY-MM-DD')` is UTC midnight, which is the previous
 * evening anywhere west of UTC, and failed 30 tests there (whole-app review, I9).
 */
function period(...isoStrings) {
  const dates = isoStrings.map(parseISODate).sort((a, b) => a - b);
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

  test('BH override when base is RD → bhOt bucket, not bh (non-rostered BH worked, v15.70)', () => {
    // L. Springer base = RD on May Day (2026-05-04, a bank holiday). Working it via a Shift
    // override is Bank Holiday OVERTIME ("Bank Holiday Overtime 1.25"), mirroring the
    // Saturday-on-RD → RDW rule — same 1.25× rate, correct payslip field. Confirmed by Gareth.
    _setOverridesForTest(new Map([
      ['2026-05-04', { type: 'shift', value: '09:00-17:00', _ts: 1, _manual: true }],
    ]));
    const s = getRosterSuggestion(period('2026-05-04'), lSpringer);
    assert.ok(s);
    assert.equal(s.bhOtCount, 1);
    assert.equal(s.bhOtH, 8);   // 09:00-17:00
    assert.equal(s.bhOtM, 0);
    assert.equal(s.bhCount, 0, 'must NOT land in the rostered "Bank Holiday Rostered" bucket');
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

// ── Shifts that run past midnight, and a rostered Saturday that ran long (test audit, 7 Nov 2026) ──
//
// Every case above uses daytime CEA shifts, so the two `+= 24 * 60` wraps — one on the worked shift,
// one on the base shift it is measured against — could be deleted, or "fixed" to `mins = -mins`, with
// this file green. CES lines finish after midnight routinely, and their Saturdays and Sundays carry
// the premiums this engine exists to pre-fill.
//   F. Mohamed (CES): base Tue 2026-04-07 15:30-00:30 (9h), base Sat 2026-04-11 15:00-00:30 (9h30)
//   L. Springer (main): base Sat 2026-04-25 06:20-14:50 (8h30)
// (verified against getBaseShift).
describe('getRosterSuggestion — overnight shifts and long Saturdays', () => {
  const fMohamed = teamMembers.find(m => m.name === 'F. Mohamed');

  test('an overnight base Saturday counts its real length: 15:00-00:30 is 9h30', () => {
    _setOverridesForTest(new Map());
    const s = getRosterSuggestion(period('2026-04-11'), fMohamed);
    assert.ok(s);
    assert.equal(s.satCount, 1);
    assert.equal(s.satH, 9);
    assert.equal(s.satM, 30, 'not -14h30 (no wrap) and not 14h30 (the sign flipped)');
  });

  test('an overnight weekday shift worked an hour longer → exactly 1h overtime', () => {
    // Both wraps matter here: the worked 15:30-01:30 (10h) and the base 15:30-00:30 (9h).
    _setOverridesForTest(new Map([
      ['2026-04-07', { type: 'shift', value: '15:30-01:30', _ts: 1, _manual: true }],
    ]));
    const s = getRosterSuggestion(period('2026-04-07'), fMohamed);
    assert.ok(s);
    assert.equal(s.otCount, 1);
    assert.equal(s.otH, 1, 'the base must wrap too, or the whole shift reads as overtime');
    assert.equal(s.otM, 0);
  });

  test('an overnight Saturday worked longer → the rostered 9h30 at 1.25x, the extra hour as overtime', () => {
    _setOverridesForTest(new Map([
      ['2026-04-11', { type: 'shift', value: '15:00-01:30', _ts: 1, _manual: true }],
    ]));
    const s = getRosterSuggestion(period('2026-04-11'), fMohamed);
    assert.ok(s);
    assert.equal(s.satH, 9);
    assert.equal(s.satM, 30);
    assert.equal(s.otH, 1);
    assert.equal(s.otM, 0);
  });

  test('a rostered daytime Saturday that ran long: capped at the base, the excess to overtime', () => {
    // The bank-holiday twin of this rule is tested above; the Saturday one was not, so crediting the
    // whole 10h30 at the Saturday rate (no cap) left the file green.
    _setOverridesForTest(new Map([
      ['2026-04-25', { type: 'shift', value: '06:20-16:50', _ts: 1, _manual: true }],
    ]));
    const s = getRosterSuggestion(period('2026-04-25'), lSpringer);
    assert.ok(s);
    assert.equal(s.satH, 8);
    assert.equal(s.satM, 30, 'the rostered 06:20-14:50');
    assert.equal(s.otCount, 1);
    assert.equal(s.otH, 2, 'the two hours past it are overtime, not Saturday hours');
    assert.equal(s.otM, 0);
  });
});

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

// ── Training / Induction / Assessment (OTHER_DAYS.md) ─────────────────────
// Training pays as the day underneath (resolveOtherPay): weekday → contracted
// basic (nothing to suggest), BH → bh bucket, actual times → base-cap + excess→OT,
// TRG RDW → rdw bucket (8h default, member-adjusted). Sundays can never be training.

describe('getRosterSuggestion — training days', () => {

  test('training on a plain weekday → null (contracted basic already covers it)', () => {
    // 2026-04-08 Wed — C. Reen base 12:00-19:00; TRG resolves as-base → no special category.
    _setOverridesForTest(new Map([
      ['2026-04-08', { type: 'other', value: 'TRG', _ts: 1, _manual: true }],
    ]));
    assert.strictEqual(getRosterSuggestion(period('2026-04-08'), cReen), null);
  });

  test('training on a rostered BANK HOLIDAY → bh bucket at base hours (keeps the premium)', () => {
    // Easter Monday 2026 — C. Reen base 12:00-19:00 (7h). Induction that day pays as the day.
    _setOverridesForTest(new Map([
      ['2026-04-06', { type: 'other', value: 'IND', _ts: 1, _manual: true }],
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
      ['2026-04-13', { type: 'other', value: 'TRG 12:00-21:00', _ts: 1, _manual: true }],
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
      ['2026-04-11', { type: 'other', value: 'TRG RDW', _ts: 1, _manual: true }],
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
      ['2026-04-11', { type: 'other', value: 'TRG RDW 09:00-18:00', _ts: 1, _manual: true }],
    ]));
    const s = getRosterSuggestion(period('2026-04-11'), cReen);
    assert.ok(s);
    assert.equal(s.rdwCount, 1);
    assert.equal(s.rdwH, 9);
    assert.equal(s.otCount, 0, 'an RDW day is all-RDW — no overtime split');
  });

  test('training on a rest day WITHOUT the RDW flag → still rdw 8h (belt-and-braces, never £0)', () => {
    _setOverridesForTest(new Map([
      ['2026-04-11', { type: 'other', value: 'TRG', _ts: 1, _manual: true }],
    ]));
    const s = getRosterSuggestion(period('2026-04-11'), cReen);
    assert.ok(s);
    assert.equal(s.rdwCount, 1);
    assert.equal(s.rdwH, 8);
  });

  test('a (legacy) SUNDAY training override falls back to the BASE — rest-day base → null', () => {
    // 2026-04-12 is a Sunday; the write layers block this, so a doc can only be legacy.
    // C. Reen base Sunday = RD → nothing to suggest (same as no override).
    _setOverridesForTest(new Map([
      ['2026-04-12', { type: 'other', value: 'TRG', _ts: 1, _manual: true }],
    ]));
    assert.strictEqual(getRosterSuggestion(period('2026-04-12'), cReen), null);
  });

  test('a (legacy) SUNDAY training override does NOT drop a WORKED base Sunday from the suggestion', () => {
    // The display layers suppress a Sunday training and show the base — the engine must match,
    // or the calendar shows a worked Sunday whose 1.5× hours silently vanish from the pre-fill.
    // L. Springer base Sunday 2026-05-10 = 14:30-23:25 (8h55m) → sun bucket.
    _setOverridesForTest(new Map([
      ['2026-05-10', { type: 'other', value: 'TRG', _ts: 1, _manual: true }],
    ]));
    const s = getRosterSuggestion(period('2026-05-10'), lSpringer);
    assert.ok(s, 'worked base Sunday must still be suggested');
    assert.equal(s.sunCount, 1);
    assert.equal(s.sunH, 8);
    assert.equal(s.sunM, 55);
    assert.equal(s.rdwCount, 0);
  });

  test('TRG RDW on BOXING DAY → box bucket at 3× (confirmed rule: 26 Dec is always Boxing Day)', () => {
    // 2026-12-26 is a Saturday, C. Reen base RD. A plain rdw override that day lands in box —
    // a training rest-day must do the same, not 1.25× RDW (~14h pay under-suggestion on 8h).
    _setOverridesForTest(new Map([
      ['2026-12-26', { type: 'other', value: 'TRG RDW', _ts: 1, _manual: true }],
    ]));
    const s = getRosterSuggestion(period('2026-12-26'), cReen);
    assert.ok(s);
    assert.equal(s.boxCount, 1);
    assert.equal(s.boxH, 8);
    assert.equal(s.rdwCount, 0, 'must not land in the 1.25× RDW bucket');
    // …and the 8h is a DEFAULT, so the Boxing Day row must say so. The flag follows the minutes into
    // the box bucket; deleting it left this file green (test audit, 7 Nov 2026), and the row would then
    // have read "Recorded change" over a guess the member is meant to correct.
    assert.deepEqual(s.defaulted8h, { rdw: false, bhOt: false, box: true });
  });

  test('NEVER-LESS floor: timed training that ran SHORT of a BH shift still pays the full shift', () => {
    // Easter Monday, base 12:00-19:00 (7h); training ran only 12:00-16:00 (4h). Decision 5:
    // never paid less than the rostered shift — the bh bucket must hold 7h, not 4h.
    _setOverridesForTest(new Map([
      ['2026-04-06', { type: 'other', value: 'TRG 12:00-16:00', _ts: 1, _manual: true }],
    ]));
    const s = getRosterSuggestion(period('2026-04-06'), cReen);
    assert.ok(s);
    assert.equal(s.bhCount, 1);
    assert.equal(s.bhH, 7, 'floored at the base shift, not the short training duration');
    assert.equal(s.bhOtCount, 0);
  });

  test('training on a ROSTERED SATURDAY, no times → sat bucket at base hours (spec table row)', () => {
    // L. Springer base Sat 2026-04-04 = 13:30-21:00 (7h30).
    _setOverridesForTest(new Map([
      ['2026-04-04', { type: 'other', value: 'IND', _ts: 1, _manual: true }],
    ]));
    const s = getRosterSuggestion(period('2026-04-04'), lSpringer);
    assert.ok(s);
    assert.equal(s.satCount, 1);
    assert.equal(s.satH, 7);
    assert.equal(s.satM, 30);
    assert.equal(s.rdwCount + s.otCount, 0);
  });

  test('NEVER-LESS floor on a rostered Saturday: short timed training pays the full 7h30', () => {
    _setOverridesForTest(new Map([
      ['2026-04-04', { type: 'other', value: 'TRG 13:30-17:30', _ts: 1, _manual: true }],
    ]));
    const s = getRosterSuggestion(period('2026-04-04'), lSpringer);
    assert.ok(s);
    assert.equal(s.satCount, 1);
    assert.equal(s.satH, 7);
    assert.equal(s.satM, 30, 'floored — 4h of training on a 7h30 Saturday still pays 7h30');
    assert.equal(s.otCount, 0);
  });

  test('defaulted8h flag is PER BUCKET and follows the routed minutes', () => {
    // Untimed rest-day default on a plain Saturday → the estimate is in the rdw bucket.
    _setOverridesForTest(new Map([
      ['2026-04-11', { type: 'other', value: 'TRG RDW', _ts: 1, _manual: true }],
    ]));
    let s = getRosterSuggestion(period('2026-04-11'), cReen);
    assert.deepEqual(s.defaulted8h, { rdw: true, bhOt: false, box: false });
    // Actual times → no estimate anywhere.
    _setOverridesForTest(new Map([
      ['2026-04-11', { type: 'other', value: 'TRG RDW 09:00-17:00', _ts: 1, _manual: true }],
    ]));
    s = getRosterSuggestion(period('2026-04-11'), cReen);
    assert.deepEqual(s.defaulted8h, { rdw: false, bhOt: false, box: false });
    // Untimed default routed to a BANK HOLIDAY → the estimate flag must follow it to bhOt
    // (previously the global flag mis-badged the rdw row, or vanished when rdwCount was 0).
    _addBhDateForTest(2026, '2026-04-11');
    try {
      _setOverridesForTest(new Map([
        ['2026-04-11', { type: 'other', value: 'TRG RDW', _ts: 1, _manual: true }],
      ]));
      s = getRosterSuggestion(period('2026-04-11'), cReen);
      assert.deepEqual(s.defaulted8h, { rdw: false, bhOt: true, box: false });
      assert.equal(s.bhOtH, 8);
    } finally {
      _removeBhDateForTest(2026, '2026-04-11');
    }
  });

  test('TRG RDW on a BANK HOLIDAY → bhOt bucket (mirrors a plain rdw override on a BH)', () => {
    // Inject a BH on 2026-04-11 (Sat, C. Reen base RD) via the test hook.
    _addBhDateForTest(2026, '2026-04-11');
    try {
      _setOverridesForTest(new Map([
        ['2026-04-11', { type: 'other', value: 'TRG RDW', _ts: 1, _manual: true }],
      ]));
      const s = getRosterSuggestion(period('2026-04-11'), cReen);
      assert.ok(s);
      assert.equal(s.bhOtCount, 1);
      assert.equal(s.bhOtH, 8);
      assert.equal(s.rdwCount, 0);
    } finally {
      _removeBhDateForTest(2026, '2026-04-11');
    }
  });

  test('training in a SPARE week → null (one of the four contracted days; basic pay covers it)', () => {
    // 2026-01-24 Sat — S. Boyle base SPARE (verified date). Not a rest day, so NOT rdw.
    _setOverridesForTest(new Map([
      ['2026-01-24', { type: 'other', value: 'TRG', _ts: 1, _manual: true }],
    ]));
    assert.strictEqual(getRosterSuggestion(period('2026-01-24'), sBoyle), null);
  });

});

// ── Absence = full pay (owner, Jul 2026) ─────────────────────────────────────
// A sick/absent day (incl. HA hospital appointments and OD long-term-sick markings)
// pays exactly as the day underneath: premium days keep their premium at base hours;
// a base REST day contributes nothing (the overpay guard for blanket Mon–Fri OD weeks).
// AL is deliberately unchanged (suppresses — leave pay is payroll's own mechanism).

describe('getRosterSuggestion — absence pays as the day underneath (full pay)', () => {

  test('absence on a rostered SATURDAY → sat bucket at base hours (premium kept)', () => {
    // L. Springer base Sat 2026-04-04 = 13:30-21:00 (7h30).
    _setOverridesForTest(new Map([
      ['2026-04-04', { type: 'sick', value: 'SICK', _ts: 1, _manual: true }],
    ]));
    const s = getRosterSuggestion(period('2026-04-04'), lSpringer);
    assert.ok(s, 'full-pay absence must keep the Saturday premium');
    assert.equal(s.satCount, 1);
    assert.equal(s.satH, 7);
    assert.equal(s.satM, 30);
    assert.equal(s.rdwCount + s.otCount, 0);
    // The hours are the ROSTER'S, not a recorded time, so the row must not be badged "Recorded change"
    // (_confBadge reads this flag). Treating the absence as an ordinary override moved no money and left
    // this file green (test audit, 7 Nov 2026).
    assert.equal(s.satFromOv, false, 'an absence is paid from the roster, not from a recorded shift');
  });

  test('absence on a rostered BANK HOLIDAY → bh bucket at base hours', () => {
    // Easter Monday 2026 — C. Reen base 12:00-19:00 (7h).
    _setOverridesForTest(new Map([
      ['2026-04-06', { type: 'sick', value: 'SICK', _ts: 1, _manual: true }],
    ]));
    const s = getRosterSuggestion(period('2026-04-06'), cReen);
    assert.ok(s);
    assert.equal(s.bhCount, 1);
    assert.equal(s.bhH, 7);
    assert.equal(s.bhFromOv, false, 'an absence is paid from the roster, not from a recorded shift');
  });

  test('absence on a plain weekday → null (basic pay already covers it)', () => {
    _setOverridesForTest(new Map([
      ['2026-04-08', { type: 'sick', value: 'SICK', _ts: 1, _manual: true }],
    ]));
    assert.strictEqual(getRosterSuggestion(period('2026-04-08'), cReen), null);
  });

  test('OVERPAY GUARD: absence on a base REST day contributes nothing', () => {
    // The blanket Mon–Fri "OD" marking on a long-term sick member must not pay for
    // days their base roster had as rest. C. Reen base Sat 2026-04-11 = RD.
    _setOverridesForTest(new Map([
      ['2026-04-11', { type: 'sick', value: 'SICK', _ts: 1, _manual: true }],
    ]));
    assert.strictEqual(getRosterSuggestion(period('2026-04-11'), cReen), null);
  });

  test('absence on a SWAPPED-IN rest day (contracted replacedType) → nothing, because its times were never kept', () => {
    // The calendar shows this day as Absent (review A3), and it pays as the day underneath — but
    // `replacedType` carries only the TYPE of that day, so there are no hours to credit and none are
    // invented (paycalc.md invariant 1). C. Reen base Sat 2026-04-11 = RD.
    _setOverridesForTest(new Map([
      ['2026-04-11', { type: 'sick', value: 'SICK', replacedType: 'shift', _ts: 1, _manual: true }],
    ]));
    assert.strictEqual(getRosterSuggestion(period('2026-04-11'), cReen), null);
  });

  test('AL is unchanged — still suppresses the day entirely', () => {
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
    // The PREVIOUS payslip's recorded changes are still in the cache when the next one is opened — a
    // shift on this Saturday, which would suggest 9h of RDW. This test used to empty the cache itself
    // before asserting, so it could not see a leak (test audit, 7 Nov 2026): deleting the clear in
    // resetOverrides left the whole file green, and a failed fetch would then have shown one payslip
    // the other's hours.
    _setOverridesForTest(new Map([
      [date, { type: 'shift', value: '10:00-19:00', _ts: 1, _manual: true }],
    ]));
    assert.equal(getRosterSuggestion(period(date), cReen)?.rdwH, 9, 'premise: the stale override would be suggested');
    _mockGetDocs = async () => { throw new Error('network error'); };
    resetOverrides('checking');
    const result = await fetchOverridesForPeriod({ start: new Date(date), cutoff: new Date(date) }, 'C. Reen');
    assert.equal(result, 'base-only');
    assert.equal(getOverridesFetchState(), 'base-only', 'the badge must say the recorded changes are not included');
    // Nothing cached → the base roster alone → C. Reen's base Saturday is a rest day → nothing to suggest.
    assert.strictEqual(getRosterSuggestion(period(date), cReen), null, 'a failed fetch must not leave the last payslip\'s changes in place');
  });

  // AN ANSWER FROM THIS DEVICE'S CACHE IS NOT THE SERVER'S (72-hour review). With the persistent
  // local cache on, an OFFLINE getDocs does not throw — it resolves from IndexedDB, which may hold
  // nothing for a period never fetched. Reported as 'loaded', that told the year fill "no recorded
  // changes" (base-only fills written and marked entered), and told the single Fill to CLEAR hours
  // the calendar merely could not see. So it is its own answer, and the state stays base-only.
  test('a snapshot served from the local cache → "cached", state base-only, nothing applied', async () => {
    const date = '2026-04-11';
    _mockGetDocs = async () => ({ ...mockSnap([
      { date, memberName: 'C. Reen', type: 'shift', value: '10:00-19:00', source: 'manual', createdAt: { toMillis: () => 1 } },
    ]), metadata: { fromCache: true } });
    resetOverrides('checking');
    const result = await fetchOverridesForPeriod({ start: new Date(date), cutoff: new Date(date) }, 'C. Reen');
    assert.equal(result, 'cached');
    assert.equal(getOverridesFetchState(), 'base-only', 'the badge must not claim recorded changes are included');
    assert.strictEqual(getRosterSuggestion(period(date), cReen), null, 'an unconfirmed cache answer is not applied');
  });

  test('CONTROL: a server snapshot (fromCache false) is still "loaded"', async () => {
    const date = '2026-04-11';
    _mockGetDocs = async () => ({ ...mockSnap([]), metadata: { fromCache: false } });
    resetOverrides('checking');
    assert.equal(await fetchOverridesForPeriod({ start: new Date(date), cutoff: new Date(date) }, 'C. Reen'), 'loaded');
    assert.equal(getOverridesFetchState(), 'loaded');
  });

});

// ── EACH PAYSLIP KEEPS ITS OWN RECORDED CHANGES (the paycalc-2-8 lead) ────────────────────────────
// The year fill fetches payslip after payslip into this module while the payslip on screen stays
// put. With one map and one "loaded", that payslip read 'loaded' and priced itself from the last
// payslip the fill had reached — its recorded Saturday back to nothing — and its Replace cleared
// what the other payslip's map called zero. Each answer is kept under the payslip it is for.
describe('getRosterSuggestion — each payslip reads its own recorded changes', () => {
  // C. Reen's Saturdays are rest days, so a recorded shift on one is 9h of RDW, and without it nothing.
  const onScreen  = period('2026-04-11');
  const elsewhere = period('2026-05-16');
  const recordedSat = () => mockSnap([{ date: '2026-04-11', memberName: 'C. Reen', type: 'shift',
    value: '10:00-19:00', source: 'manual', createdAt: { toMillis: () => 1 } }]);

  test("a later fetch for another payslip leaves this one its own changes, and its own 'loaded'", async () => {
    resetOverrides('checking');
    _mockGetDocs = async () => recordedSat();
    await fetchOverridesForPeriod(onScreen, 'C. Reen');
    _mockGetDocs = async () => mockSnap([]);
    // …and the year fill moves on to its next period:
    await fetchOverridesForPeriod(elsewhere, 'C. Reen');
    assert.equal(getRosterSuggestion(onScreen, cReen)?.rdwH, 9,
      'the payslip on screen was priced from the last payslip fetched, without its own recorded change');
    assert.equal(getOverridesFetchState(onScreen), 'loaded');
  });

  test("a payslip with no answer of its own is not 'loaded' because another payslip is", async () => {
    resetOverrides('checking');
    _mockGetDocs = async () => mockSnap([]);
    await fetchOverridesForPeriod(elsewhere, 'C. Reen');
    assert.equal(getOverridesFetchState(onScreen), 'checking', "another payslip's answer stood in for this one's");
    assert.equal(getOverridesFetchState(elsewhere), 'loaded');
  });

  test('a payslip whose own fetch failed, or came from the device cache, says so while another stays loaded', async () => {
    resetOverrides('checking');
    _mockGetDocs = async () => recordedSat();
    await fetchOverridesForPeriod(onScreen, 'C. Reen');
    _mockGetDocs = async () => { throw new Error('network error'); };
    await fetchOverridesForPeriod(elsewhere, 'C. Reen');
    assert.equal(getOverridesFetchState(elsewhere), 'base-only', 'a failed fetch must be named for its payslip');
    _mockGetDocs = async () => ({ ...mockSnap([]), metadata: { fromCache: true } });
    const third = period('2026-06-13');
    await fetchOverridesForPeriod(third, 'C. Reen');
    assert.equal(getOverridesFetchState(third), 'base-only', 'a cache answer must be named for its payslip');
    assert.equal(getOverridesFetchState(onScreen), 'loaded', '…and neither touches the payslip that did load');
    assert.equal(getRosterSuggestion(onScreen, cReen)?.rdwH, 9);
  });

  test('a reset forgets every payslip, so a period change can never inherit an earlier answer', async () => {
    resetOverrides('checking');
    _mockGetDocs = async () => recordedSat();
    await fetchOverridesForPeriod(onScreen, 'C. Reen');
    resetOverrides('checking');
    assert.equal(getOverridesFetchState(onScreen), 'checking');
    assert.strictEqual(getRosterSuggestion(onScreen, cReen), null, "the last period's recorded change outlived the reset");
  });

  test('CONTROL: with no payslip named, the state is whatever the last fetch left, as before', async () => {
    resetOverrides('checking');
    _mockGetDocs = async () => recordedSat();
    await fetchOverridesForPeriod(onScreen, 'C. Reen');
    _mockGetDocs = async () => { throw new Error('network error'); };
    await fetchOverridesForPeriod(elsewhere, 'C. Reen');
    assert.equal(getOverridesFetchState(), 'base-only');
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

// ── A SHIFT CHANGE ON A WEEKDAY REST DAY IS NEVER INFERRED (invariant 11; contracts-b-5) ──────────
// The first half of paycalc.md invariant 11 — swap shifts and rest-day weekday changes are never
// inferred — rests on ONE condition in the weekday branch, `fromOv && baseWorked`: on a rest-day base
// `baseMins` is 0, so without it the whole shift is "excess" and is offered as Overtime 1.25, which
// "Fill from calendar" then saves. Every weekday fixture above sits on a worked base, so deleting
// `baseWorked` left this file green.
describe('getRosterSuggestion — a shift change on a weekday rest day', () => {
  const RD_TUE = '2026-06-09';

  test('the fixture is a weekday rest day', async () => {
    const { getBaseShift } = await import('./roster-data.js');
    assert.equal(getBaseShift(lSpringer, parseISODate(RD_TUE)), 'RD');
  });

  test('a plain shift recorded there suggests no overtime — a swap pays in ways the app cannot predict', () => {
    _setOverridesForTest(new Map([[RD_TUE, { type: 'shift', value: '09:00-17:00', _ts: 1, _manual: true }]]));
    assert.equal(getRosterSuggestion(period(RD_TUE), lSpringer), null, 'the whole shift was offered as Overtime 1.25');
  });

  test('CONTROL: a rest day worked recorded there is Rest Day Working', () => {
    _setOverridesForTest(new Map([[RD_TUE, { type: 'rdw', value: '09:00-17:00', _ts: 1, _manual: true }]]));
    const s = getRosterSuggestion(period(RD_TUE), lSpringer);
    assert.equal(s?.rdwH, 8);
    assert.equal(s?.otH, 0);
  });
});

// ── A RECORD DATED BEFORE THE MEMBER STARTED (paycalc-3-6) ───────────────────────────────────────
// Every display layer suppresses a recorded change dated before a member's start date
// (`isBeforeMemberStart`, override-utils.js: "Always call this helper"), so the Calendar shows a rest
// day there. The suggestion engine did not ask, and counted the record — then the page applied it to
// the estimate on view: pay for a day the app itself says came before they started.
describe('getRosterSuggestion — a record dated before the member\'s start date', () => {
  const joiner = { ...cReen, startDate: new Date(2026, 3, 13) };   // starts Mon 13 Apr 2026

  test('suggests nothing for a bank holiday or a Saturday worked before the start date', () => {
    _setOverridesForTest(new Map([
      ['2026-04-06', { type: 'shift', value: '12:00-21:00', _ts: 1, _manual: true }],   // Easter Monday
      ['2026-04-11', { type: 'shift', value: '10:00-18:00', _ts: 1, _manual: true }],   // a Saturday
    ]));
    assert.equal(getRosterSuggestion(period('2026-04-05', '2026-04-12'), joiner), null,
      'the Calendar shows rest days there, and the pay suggestion counted the records anyway');
  });

  test('CONTROL: the same kind of record from the start date on is counted', () => {
    _setOverridesForTest(new Map([['2026-04-18', { type: 'shift', value: '10:00-18:00', _ts: 1, _manual: true }]]));
    assert.equal(getRosterSuggestion(period('2026-04-13', '2026-04-19'), joiner)?.rdwH, 8);
  });
});

// ── A TRAINING DAY FROM THE PATTERN ON A BANK HOLIDAY (owner, 7 Nov 2026) ──────────────────────
// Fixed pattern 3 is a bare TRG Monday to Friday — no times — and the engine prices only a timed
// day, so a bank holiday inside a trainee's weeks suggested no "Bank Holiday Rostered" hours at all,
// where the 09:00-16:00 line it stands for suggests 7. The owner's answer: suggest the 7 hours,
// flagged as a default the member checks.
describe('getRosterSuggestion — a bare Training day from the pattern on a bank holiday', () => {
  const campbell = teamMembers.find(m => m.name === 'M. Campbell');
  const BH = '2026-10-14';   // a Wednesday inside her training weeks, made a bank holiday for the test

  test('the fixture is a Training day with no times', async () => {
    const { getBaseShift } = await import('./roster-data.js');
    assert.equal(getBaseShift(campbell, parseISODate(BH)), 'TRG');
  });

  test('suggests the 7-hour day as Bank Holiday Rostered, flagged as a default', () => {
    _addBhDateForTest(2026, BH);
    try {
      _setOverridesForTest(new Map());
      const s = getRosterSuggestion(period(BH), campbell);
      assert.ok(s, 'a suggestion, not nothing');
      assert.equal(s.bhH, 7);
      assert.equal(s.bhM, 0);
      assert.equal(s.bhCount, 1);
      assert.deepEqual(s.defaulted7h, { bh: true });
      assert.equal(s.days.find(d => d.type === 'bh')?.shift, '7h default — adjust to actual');
    } finally {
      _removeBhDateForTest(2026, BH);
    }
  });

  test('an absence on it still pays as the day underneath — the same 7 hours', () => {
    _addBhDateForTest(2026, BH);
    try {
      _setOverridesForTest(new Map([[BH, { type: 'sick', value: 'SICK', _ts: 1, _manual: true }]]));
      assert.equal(getRosterSuggestion(period(BH), campbell)?.bhH, 7);
    } finally {
      _removeBhDateForTest(2026, BH);
    }
  });

  // THE BUCKET, NOT ONLY THE SUM (paycalc-3-4). This case used to assert `bhH + bhOtH === 8`, which
  // stayed true while all eight hours sat in Bank Holiday OVERTIME: a record with times found no
  // rostered shift to cap against (the base has none), so the branch for a bank holiday worked on a
  // REST day took the whole day. Overtime is paid on top of contracted hours; rostered hours only
  // carry the premium — so a seven-hour day was over-suggested by a day's basic pay. The rostered day
  // on a bank holiday is the 7-hour day, with or without times on record.
  /** Suggest the bank holiday with this one record on it. */
  function withRecord(/** @type {any} */ ov) {
    _addBhDateForTest(2026, BH);
    try {
      _setOverridesForTest(new Map([[BH, { _ts: 1, _manual: true, ...ov }]]));
      return /** @type {any} */ (getRosterSuggestion(period(BH), campbell));
    } finally {
      _removeBhDateForTest(2026, BH);
    }
  }

  test('recorded times replace the default — the rostered 7 hours, the excess as overtime', () => {
    const s = withRecord({ type: 'other', value: 'TRG 09:00-17:00' });
    assert.equal(s.bhH, 7, 'the rostered day went to Bank Holiday Overtime');
    assert.equal(s.bhOtH, 1, 'only the hour past the 7-hour day is overtime');
    assert.deepEqual(s.defaulted7h, { bh: false }, 'the eight hours are on record');
  });

  test('a 7-hour Training day, or a plain shift, is all Bank Holiday Rostered', () => {
    for (const ov of [{ type: 'other', value: 'TRG 09:00-16:00' }, { type: 'shift', value: '09:00-16:00' }]) {
      const s = withRecord(ov);
      assert.equal(s.bhH, 7, `${ov.value}: the rostered day was paid as overtime`);
      assert.equal(s.bhOtH, 0, ov.value);
      assert.equal(s.bhOtCount, 0, ov.value);
    }
  });

  test('a Training day that ran short still pays the 7-hour day — flagged, because the 7 is not on record', () => {
    const s = withRecord({ type: 'other', value: 'TRG 09:00-14:00' });
    assert.equal(s.bhH, 7, 'never paid less than the rostered day (OTHER_DAYS.md decision 5)');
    assert.equal(s.bhOtH, 0);
    assert.deepEqual(s.defaulted7h, { bh: true });
  });

  test('a plain shift recorded short is the shift recorded — a shift replaces the day', () => {
    const s = withRecord({ type: 'shift', value: '09:00-14:00' });
    assert.equal(s.bhH, 5);
    assert.equal(s.bhOtH, 0);
    assert.deepEqual(s.defaulted7h, { bh: false });
  });

  test('a rest day worked recorded on top adds to the rostered day, as on any rostered bank holiday', () => {
    const s = withRecord({ type: 'rdw', value: '18:00-20:00' });
    assert.equal(s.bhH, 7, 'the rostered day was dropped');
    assert.equal(s.bhOtH, 2);
    assert.deepEqual(s.defaulted7h, { bh: true }, 'the 7 rostered hours here are the default');
  });

  test('on an ordinary weekday it suggests nothing — the day is contracted basic pay', () => {
    _setOverridesForTest(new Map());
    assert.equal(getRosterSuggestion(period(BH), campbell), null);
  });

  test('…even with long times recorded: the 7-hour day is a bank-holiday decision, not a weekday one', () => {
    // Splitting a long weekday Training day into overtime would infer a category nobody decided
    // (invariant 11) — the owner's 7 hours answer the bank holiday only.
    _setOverridesForTest(new Map([[BH, { type: 'other', value: 'TRG 09:00-18:00', _ts: 1, _manual: true }]]));
    assert.equal(getRosterSuggestion(period(BH), campbell), null);
  });
});
