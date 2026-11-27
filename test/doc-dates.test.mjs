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
const { recordDocDate, docDate, docDateLabel, checkLatestCircular, DOC_DATE_KEYS } = await import('../doc-dates.js');
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
