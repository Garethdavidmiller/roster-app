// @ts-check
/**
 * newsletter-recency.test.mjs — the ☰ menu offers the Marylebone Newsletter only while its latest
 * issue is under six weeks old (newsletter-recency.js, owner, 14 Nov 2026).
 * Run: node scripts/run-tests.mjs newsletter-recency.test.mjs   (part of `npm run test:hygiene`)
 *
 * Every date here is FIXED, and "today" is handed in, so "six weeks later" is tested rather than
 * assumed: the boundary day, a clock change inside the window, a date that is not a date. The storage
 * is a real Map behind the real `ls.js`, so a key the module writes under one spelling and reads under
 * another would fail here. The browser half (the drawer, the Calendar's check, an Operations upload)
 * is e2e/calendar.spec.js and e2e/operations.spec.js.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/** @type {Map<string,string>} */
const store = new Map();
let storageWorks = true;
globalThis.localStorage = /** @type {any} */ ({
    getItem: (/** @type {string} */ k) => { if (!storageWorks) throw new Error('SecurityError'); return store.has(k) ? store.get(k) : null; },
    setItem: (/** @type {string} */ k, /** @type {string} */ v) => { if (!storageWorks) throw new Error('SecurityError'); store.set(k, String(v)); },
    removeItem: (/** @type {string} */ k) => { store.delete(k); },
});

const {
    NEWSLETTER_RECENT_DAYS, NEWSLETTER_LATEST_KEY, isRecentIssue, newsletterInMenu,
    recordLatestNewsletter, noteNewsletterUploaded, checkLatestNewsletter,
} = await import('./newsletter-recency.js');

/** Noon local time, so no test depends on the hour it runs at. */
const day = (/** @type {string} */ iso) => new Date(`${iso}T12:00:00`);

/**
 * The module also keeps this page's answer in memory (for a device whose storage refuses it), and one
 * import is one page. So every test that reads the menu RECORDS its own starting answer first, through
 * the module, and the one test about a later page load imports a second copy of the module.
 */
beforeEach(() => { storageWorks = true; store.clear(); });

test('the window is six weeks, which the copy says in words (guide-app-parity.test.mjs holds the words)', () => {
    assert.equal(NEWSLETTER_RECENT_DAYS, 6 * 7);
});

test('an issue is recent from its own day until the day before it is six weeks old', () => {
    assert.equal(isRecentIssue('2026-11-14', day('2026-11-14')), true, 'issued today');
    assert.equal(isRecentIssue('2026-10-04', day('2026-11-14')), true, '41 days old');
    assert.equal(isRecentIssue('2026-10-03', day('2026-11-14')), false, 'six weeks old to the day');
    assert.equal(isRecentIssue('2026-07-31', day('2026-11-14')), false, 'July’s issue in November');
});

test('an issue dated after today is recent: it is the latest, and nothing newer can be offered instead', () => {
    assert.equal(isRecentIssue('2026-12-01', day('2026-11-14')), true);
});

// THE CLOCK CHANGES RUN IN LONDON TIME, whatever zone the run is in (admin-rangepicker.test.mjs has the
// same helper, and says why): CI runs in UTC, which changes no clocks, so a count by HOURS passes there.
// The premise checks make sure the zone really does change its clocks, so this cannot pass vacuously.
/** Run `fn` with the process clock in `tz`, restoring the previous zone afterwards. */
function inZone(/** @type {string} */ tz, /** @type {() => void} */ fn) {
    const prev = process.env.TZ;
    process.env.TZ = tz;
    try { fn(); } finally { if (prev === undefined) delete process.env.TZ; else process.env.TZ = prev; }
}

test('the days are counted by the calendar, so a clock change inside the window moves nothing', () => {
    inZone('Europe/London', () => {
        assert.notEqual(new Date(2026, 9, 24).getTimezoneOffset(), new Date(2026, 9, 26).getTimezoneOffset(),
            'premise: the clocks go back in this zone on 25 October 2026');
        assert.notEqual(new Date(2026, 2, 28).getTimezoneOffset(), new Date(2026, 2, 30).getTimezoneOffset(),
            'premise: the clocks go forward in this zone on 29 March 2026');
        // Every minute of a day gives that day's answer: a count by hours calls one minute past midnight on
        // 1 May only 41 days 23 hours after 20 March, because the clocks went forward in between.
        for (const [h, m] of [[0, 1], [12, 0], [23, 59]]) {
            const at = (/** @type {number} */ mo, /** @type {number} */ d) => new Date(2026, mo - 1, d, h, m);
            const when = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
            assert.equal(isRecentIssue('2026-10-25', at(12, 5)), true, `41 days across the autumn change, at ${when}`);
            assert.equal(isRecentIssue('2026-10-25', at(12, 6)), false, `42 days across the autumn change, at ${when}`);
            assert.equal(isRecentIssue('2026-03-20', at(4, 30)), true, `41 days across the spring change, at ${when}`);
            assert.equal(isRecentIssue('2026-03-20', at(5, 1)), false, `42 days across the spring change, at ${when}`);
        }
    });
});

test('a date that cannot be read is never recent', () => {
    for (const bad of [null, undefined, '', '2026-11', '14/11/2026', '2026-13-01', '2026-02-30', '2026-11-14T00:00', 20261114, {}]) {
        assert.equal(isRecentIssue(bad, day('2026-11-14')), false, `${JSON.stringify(bad)} counted as recent`);
    }
});

test('the menu offers it only while this device knows of a recent issue', () => {
    recordLatestNewsletter('2026-11-10');
    assert.equal(newsletterInMenu(day('2026-11-14')), true, 'a recent issue');
    assert.equal(newsletterInMenu(day('2026-12-22')), false, 'the same answer, six weeks on: it ages with no read at all');
    recordLatestNewsletter(null);
    assert.equal(newsletterInMenu(day('2026-11-14')), false, 'the server said none has been uploaded');
    assert.equal(store.get(NEWSLETTER_LATEST_KEY), '', '"none" is kept as an answer, not as never asked');
});

test('the answer is kept on the device, under the one key, as the date itself, for the next page to read', async () => {
    recordLatestNewsletter('2026-11-10');
    assert.equal(store.get(NEWSLETTER_LATEST_KEY), '2026-11-10');
    // A later page: a second copy of the module, with no answer of its own in memory, reads the device's.
    const nextPage = await import('./newsletter-recency.js?page=2');
    assert.equal(nextPage.newsletterInMenu(day('2026-11-14')), true, 'the next page did not read the answer this one kept');
    store.set(NEWSLETTER_LATEST_KEY, '2026-07-31');   // another page has since been told of nothing newer
    assert.equal(nextPage.newsletterInMenu(day('2026-11-14')), false);
});

test('a device whose storage refuses it still shows the button it has just been told about', () => {
    storageWorks = false;
    recordLatestNewsletter('2026-11-10');
    assert.equal(newsletterInMenu(day('2026-11-14')), true, 'held in memory for the page');
    recordLatestNewsletter(null);
    assert.equal(newsletterInMenu(day('2026-11-14')), false);
});

test('an upload from this device counts at once, and an older one never stands in for a newer', () => {
    recordLatestNewsletter('2026-07-31');
    noteNewsletterUploaded('2026-11-10');
    assert.equal(store.get(NEWSLETTER_LATEST_KEY), '2026-11-10', 'the new issue is the latest');
    assert.equal(newsletterInMenu(day('2026-11-14')), true);
    noteNewsletterUploaded('2026-06-30');
    assert.equal(store.get(NEWSLETTER_LATEST_KEY), '2026-11-10', 'a back issue filed for the record replaced the latest');
    noteNewsletterUploaded('not a date');
    assert.equal(store.get(NEWSLETTER_LATEST_KEY), '2026-11-10', 'an unreadable date replaced the latest');
    recordLatestNewsletter(null);
    noteNewsletterUploaded('not a date');
    assert.equal(store.get(NEWSLETTER_LATEST_KEY), '', 'an unreadable date replaced "none"');
    noteNewsletterUploaded('2026-11-10');
    assert.equal(store.get(NEWSLETTER_LATEST_KEY), '2026-11-10', 'after "none", the first upload is the latest');
});

test('the check waits for the session, then keeps the latest issue’s date', async () => {
    recordLatestNewsletter('2026-07-31');
    /** @type {(v?: any) => void} */ let open = () => {};
    const ready = new Promise(r => { open = r; });
    let reads = 0;
    const done = checkLatestNewsletter({ ready, canRead: () => true, fetchLatest: async () => { reads++; return { date: '2026-11-10', storageUrl: 'x' }; } });
    await new Promise(r => setTimeout(r, 0));
    assert.equal(reads, 0, 'it read before the page had a session');
    open();
    await done;
    assert.equal(reads, 1);
    assert.equal(store.get(NEWSLETTER_LATEST_KEY), '2026-11-10');
});

test('the check asks NOTHING while the documents are shut (a locked Calendar)', async () => {
    recordLatestNewsletter('2026-11-10');
    let reads = 0;
    await checkLatestNewsletter({ ready: Promise.resolve(), canRead: () => false, fetchLatest: async () => { reads++; return null; } });
    assert.equal(reads, 0, 'a shut gate was read through');
    assert.equal(store.get(NEWSLETTER_LATEST_KEY), '2026-11-10', 'and what the device knew is untouched');
});

test('the server saying none have been uploaded hides the button', async () => {
    recordLatestNewsletter('2026-11-10');
    await checkLatestNewsletter({ ready: Promise.resolve(), canRead: () => true, fetchLatest: async () => null });
    assert.equal(store.get(NEWSLETTER_LATEST_KEY), '');
    assert.equal(newsletterInMenu(day('2026-11-14')), false);
});

test('a read that fails or is refused changes nothing, and the check never rejects', async () => {
    recordLatestNewsletter('2026-11-10');
    for (const err of [new Error('offline'), Object.assign(new Error('denied'), { code: 'permission-denied' })]) {
        await checkLatestNewsletter({ ready: Promise.resolve(), canRead: () => true, fetchLatest: () => Promise.reject(err) });
        assert.equal(store.get(NEWSLETTER_LATEST_KEY), '2026-11-10', `${err.message}: the device's answer was overwritten`);
    }
    // A session that never arrives is a check that never finishes — not one that throws.
    await checkLatestNewsletter({ ready: Promise.reject(new Error('no session')), canRead: () => true, fetchLatest: async () => null });
    assert.equal(store.get(NEWSLETTER_LATEST_KEY), '2026-11-10');
});
