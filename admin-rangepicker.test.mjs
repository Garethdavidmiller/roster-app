/**
 * Unit tests for the pure date-range maths in admin-rangepicker.js.
 * Run with: node --test admin-rangepicker.test.mjs
 *
 * getDateRange() feeds the AL and absence save pipelines — an off-by-one
 * here writes a wrong number of override documents to Firestore.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getDateRange } from './admin-rangepicker.js';

test('getDateRange: empty from returns []', () => {
    assert.deepEqual(getDateRange('', '2026-06-10'), []);
});

test('getDateRange: empty to returns []', () => {
    assert.deepEqual(getDateRange('2026-06-10', ''), []);
});

test('getDateRange: reversed range (to before from) returns null', () => {
    assert.equal(getDateRange('2026-06-12', '2026-06-10'), null);
});

test('getDateRange: single day (from === to) returns that one date', () => {
    assert.deepEqual(getDateRange('2026-06-10', '2026-06-10'), ['2026-06-10']);
});

test('getDateRange: endpoints are inclusive', () => {
    assert.deepEqual(
        getDateRange('2026-06-10', '2026-06-12'),
        ['2026-06-10', '2026-06-11', '2026-06-12']
    );
});

test('getDateRange: crosses a month boundary', () => {
    assert.deepEqual(
        getDateRange('2026-01-30', '2026-02-02'),
        ['2026-01-30', '2026-01-31', '2026-02-01', '2026-02-02']
    );
});

test('getDateRange: crosses a year boundary', () => {
    assert.deepEqual(
        getDateRange('2026-12-31', '2027-01-01'),
        ['2026-12-31', '2027-01-01']
    );
});

test('getDateRange: non-leap February has no Feb 29', () => {
    assert.deepEqual(
        getDateRange('2026-02-28', '2026-03-01'),
        ['2026-02-28', '2026-03-01']
    );
});

test('getDateRange: leap-year February includes Feb 29', () => {
    assert.deepEqual(
        getDateRange('2028-02-28', '2028-03-01'),
        ['2028-02-28', '2028-02-29', '2028-03-01']
    );
});

test('getDateRange: no skipped/duplicated day across BST spring-forward (29 Mar 2026)', () => {
    assert.deepEqual(
        getDateRange('2026-03-28', '2026-03-30'),
        ['2026-03-28', '2026-03-29', '2026-03-30']
    );
});

test('getDateRange: no skipped/duplicated day across BST fall-back (25 Oct 2026)', () => {
    assert.deepEqual(
        getDateRange('2026-10-24', '2026-10-26'),
        ['2026-10-24', '2026-10-25', '2026-10-26']
    );
});
