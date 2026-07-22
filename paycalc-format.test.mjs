// paycalc-format.test.mjs — tests for the pure formatters/time-input helpers in paycalc-format.js.
// clampMinute + decimalToHM were extracted from paycalc-app.js (Section G / G1) so the hrs/mins
// arithmetic — previously inline and duplicated between the live preview and the on-blur split —
// is written once and unit-tested. No mocks; part of test:hygiene-style pure coverage.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fd, fdShort, fdLong, fdList, fmt, clampMinute, decimalToHM } from './paycalc-format.js';

test('clampMinute clamps into [0, 59]', () => {
    assert.equal(clampMinute(0), 0);
    assert.equal(clampMinute(30), 30);
    assert.equal(clampMinute(59), 59);
    assert.equal(clampMinute(60), 59);   // one past the top
    assert.equal(clampMinute(100), 59);
    assert.equal(clampMinute(-1), 0);
    assert.equal(clampMinute(-40), 0);
});

test('decimalToHM splits decimal hours into whole h + m', () => {
    assert.deepEqual(decimalToHM(7.5), { h: 7, m: 30 });
    assert.deepEqual(decimalToHM(7.25), { h: 7, m: 15 });
    assert.deepEqual(decimalToHM(0.5), { h: 0, m: 30 });
    assert.deepEqual(decimalToHM(8), { h: 8, m: 0 });
    assert.deepEqual(decimalToHM(0), { h: 0, m: 0 });
});

test('decimalToHM carries a rounded-up 60 minutes into the next hour (float guard)', () => {
    // 7.999 → round(0.999 × 60) = 60 → must become 8h 00m, never 7h 60m.
    assert.deepEqual(decimalToHM(7.999), { h: 8, m: 0 });
    // 7.991666… (7h 59.5m) rounds to 60 → carries.
    assert.deepEqual(decimalToHM(7 + 59.5 / 60), { h: 8, m: 0 });
    // Just under the carry boundary stays put.
    assert.deepEqual(decimalToHM(7 + 59.4 / 60), { h: 7, m: 59 });
});

test('decimalToHM rejects negative / non-finite input', () => {
    assert.equal(decimalToHM(-1), null);
    assert.equal(decimalToHM(-0.5), null);
    assert.equal(decimalToHM(NaN), null);
    assert.equal(decimalToHM(Infinity), null);
});

test('fmt renders GBP with thousands separators and 2dp', () => {
    assert.equal(fmt(0), '£0.00');
    assert.equal(fmt(1234.5), '£1,234.50');
    assert.equal(fmt(1000000), '£1,000,000.00');
    assert.equal(fmt(-42.1), '£-42.10');
});

// Date formatters. fdLong was extracted (review item 21) from ~8 inline copies of the same
// en-GB long form; these pin the three variants apart so a future edit can't silently merge them.
// Dates are constructed via new Date(y, m-1, d) — device-local calendar values (no timeZone), matching
// how getPeriods builds period dates, so the printed day is stable regardless of the runner's zone.
test('fd / fdShort / fdLong are three distinct en-GB variants', () => {
    const d = new Date(2026, 6, 3);           // 3 Jul 2026, local noon-free calendar date
    assert.equal(fdLong(d),  '3 Jul 2026');   // full year — the payday / joined-on / printed-on form
    assert.equal(fd(d),      '3 Jul 26');     // 2-digit year
    assert.equal(fdShort(d), '3 Jul');        // no year
});

// Capped payday list for "these payslips are missing" copy (v18.42 — review item 2).
test('fdList joins paydays, capping with an explicit overflow count', () => {
    const ds = [new Date(2026, 5, 5), new Date(2026, 6, 3), new Date(2026, 6, 31), new Date(2026, 7, 28), new Date(2026, 8, 25), new Date(2026, 9, 23)];
    assert.equal(fdList([]), '');
    assert.equal(fdList(ds.slice(0, 2)), '5 Jun, 3 Jul');
    assert.equal(fdList(ds.slice(0, 4)), '5 Jun, 3 Jul, 31 Jul, 28 Aug', 'exactly at the cap — no overflow tail');
    assert.equal(fdList(ds), '5 Jun, 3 Jul, 31 Jul, 28 Aug and 2 more', 'over the cap — count says how many are hidden');
    assert.equal(fdList(ds, 2), '5 Jun, 3 Jul and 4 more', 'custom cap');
});
