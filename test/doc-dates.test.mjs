// @ts-check
// @lane hygiene
/**
 * doc-dates.test.mjs — the ☰ menu's date beside the Daily Huddle, Weekly Retail Circular and Marylebone
 * Newsletter (doc-dates.js, owner, 27 Nov 2026).
 * Run: node scripts/run-tests.mjs test/doc-dates.test.mjs
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/** @type {Map<string, string>} */ const store = new Map();
globalThis.localStorage = /** @type {any} */ ({
    getItem: (/** @type {string} */ k) => (store.has(k) ? store.get(k) : null),
    setItem: (/** @type {string} */ k, /** @type {string} */ v) => { store.set(k, String(v)); },
    removeItem: (/** @type {string} */ k) => { store.delete(k); },
});
const { recordDocDate, docDate, docDateLabel, checkLatestCircular, DOC_DATE_KEYS, huddleForDate, HUDDLE_NEXT_DAY_FROM_HOUR } = await import('../doc-dates.js');
const { recordLatestNewsletter } = await import('../newsletter-recency.js');

const NOW = new Date(2026, 10, 27, 12);
beforeEach(() => { store.clear(); recordDocDate('huddle', null); recordDocDate('circular', null); store.clear(); });

test('a Huddle is worded for the day it plans, an issue by its own date', () => {
    recordDocDate('huddle', '2026-11-28');
    recordDocDate('circular', '2026-11-27');
    recordLatestNewsletter('2026-11-02');
    assert.equal(docDateLabel('huddle', NOW), 'for Sat 28 Nov');
    assert.equal(docDateLabel('circular', NOW), 'Fri 27 Nov');
    assert.equal(docDateLabel('newsletter', NOW), 'Mon 2 Nov', 'the Newsletter\'s date is newsletter-recency.js\'s');
});

test('another year\'s date carries its year, in full', () => {
    recordDocDate('circular', '2025-12-30');
    assert.equal(docDateLabel('circular', NOW), 'Tue 30 December 2025');
});

test('a date this device does not know, or cannot read, is never guessed', () => {
    assert.equal(docDateLabel('huddle', NOW), '', 'never heard');
    recordDocDate('huddle', 'tomorrow');
    assert.equal(docDate('huddle'), '', 'not a date: kept as none');
    recordDocDate('huddle', '2026-02-30');
    assert.equal(docDateLabel('huddle', NOW), '', 'not a real date');
});

test('the Circular check keeps the server\'s answer, and a failed read keeps what the device knew', async () => {
    await checkLatestCircular({ ready: Promise.resolve(), canRead: () => true, fetchLatest: async () => ({ date: '2026-11-27' }) });
    assert.equal(store.get(DOC_DATE_KEYS.circular), '2026-11-27');
    await checkLatestCircular({ ready: Promise.resolve(), canRead: () => true, fetchLatest: async () => { throw new Error('offline'); } });
    assert.equal(docDate('circular'), '2026-11-27', 'a failed read changed the date');
    await checkLatestCircular({ ready: Promise.resolve(), canRead: () => false, fetchLatest: async () => ({ date: '2026-12-04' }) });
    assert.equal(docDate('circular'), '2026-11-27', 'a locked Calendar asked anyway');
    await checkLatestCircular({ ready: Promise.resolve(), canRead: () => true, fetchLatest: async () => null });
    assert.equal(docDate('circular'), '', 'the server said there is none');
});

// A HUDDLE THAT ARRIVES AFTER MIDDAY IS TOMORROW'S (owner, 27 Nov 2026). The flow files a Huddle under the
// London date its email arrived; the evening's Huddle plans the next day.
const utc = (/** @type {number[]} */ ...a) => Date.UTC(a[0], a[1] - 1, a[2], a[3], a[4] ?? 0);

test('a Huddle filed under the day it arrived, arriving at 12:00 London or later, is the next day\'s', () => {
    assert.equal(HUDDLE_NEXT_DAY_FROM_HOUR, 12);
    assert.equal(huddleForDate('2026-11-27', utc(2026, 11, 27, 19)), '2026-11-28', 'the evening Huddle (GMT)');
    assert.equal(huddleForDate('2026-11-27', utc(2026, 11, 27, 12)), '2026-11-28', '12:00 itself is after midday');
    assert.equal(huddleForDate('2026-11-27', utc(2026, 11, 27, 11, 59)), '2026-11-27', '11:59 is the morning: that day\'s');
    assert.equal(huddleForDate('2026-11-27', utc(2026, 11, 27, 6, 30)), '2026-11-27', 'a morning Huddle is that day\'s');
});

test('the hour is LONDON\'s, on both sides of the clock change', () => {
    assert.equal(huddleForDate('2026-07-10', utc(2026, 7, 10, 11)), '2026-07-11', '11:00 UTC is 12:00 BST: the next day\'s');
    assert.equal(huddleForDate('2026-07-10', utc(2026, 7, 10, 10, 59)), '2026-07-10', '10:59 UTC is 11:59 BST: that day\'s');
    assert.equal(huddleForDate('2026-07-10', utc(2026, 7, 9, 23, 30)), '2026-07-10', '23:30 UTC on the 9th is 00:30 BST on the 10th: a morning');
});

test('the next day crosses a month and a year', () => {
    assert.equal(huddleForDate('2026-11-30', utc(2026, 11, 30, 18)), '2026-12-01');
    assert.equal(huddleForDate('2026-12-31', utc(2026, 12, 31, 18)), '2027-01-01');
});

test('a date not filed under the day it arrived is taken as filed, so no date moves twice', () => {
    assert.equal(huddleForDate('2026-11-28', utc(2026, 11, 27, 19)), '2026-11-28', 'uploaded by hand with tomorrow chosen');
    assert.equal(huddleForDate('2026-11-20', utc(2026, 11, 27, 15)), '2026-11-20', 'an older one filled in later');
});

test('an arrival this device cannot read leaves the date as filed; a date that is not one is none', () => {
    assert.equal(huddleForDate('2026-11-27', undefined), '2026-11-27', 'a write still pending in the cache');
    assert.equal(huddleForDate('2026-11-27', null), '2026-11-27');
    assert.equal(huddleForDate('2026-11-27', 'yesterday'), '2026-11-27');
    assert.equal(huddleForDate('2026-11-27', { toMillis: () => utc(2026, 11, 27, 19) }), '2026-11-28', 'a Firestore Timestamp');
    assert.equal(huddleForDate('2026-11-27', new Date(utc(2026, 11, 27, 19))), '2026-11-28', 'a Date');
    assert.equal(huddleForDate(null, utc(2026, 11, 27, 19)), null);
    assert.equal(huddleForDate('27/11/2026', utc(2026, 11, 27, 19)), null);
});

test('the menu words the evening Huddle for the day it plans', () => {
    recordDocDate('huddle', huddleForDate('2026-11-27', utc(2026, 11, 27, 19)));
    assert.equal(docDateLabel('huddle', NOW), 'for Sat 28 Nov');
});
