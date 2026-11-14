// @ts-check
/**
 * newsletter-recency.js — the ☰ menu offers the Marylebone Newsletter only while its latest issue is RECENT.
 *
 * ── WHY IT EXISTS (owner, 14 Nov 2026) ───────────────────────────────────────────────────────────
 *
 * No newsletter came out between July and November, and the menu went on offering July's issue as
 * "the latest", so the button was hidden by hand (v26.07, a switch). The owner then asked for it to
 * hide itself once the latest issue is a month or more old, and come back with the next upload. This
 * is that rule. The button follows the data rather than a setting somebody has to remember to change
 * (the pattern is called DERIVED STATE: the screen is worked out from the facts, never stored beside them).
 *
 * ── THE RULE ─────────────────────────────────────────────────────────────────────────────────────
 *
 * An issue is recent for SIX WEEKS from its issue date: the date the admin picks when uploading, which
 * is also how the latest is found (`orderBy('date', 'desc')`, documents-client.js `latestIn`), so the
 * button can never be judged on one issue and open another. Six weeks, not four: a monthly newsletter
 * that came out a few days late would otherwise vanish for those days every month. An issue dated
 * after today is recent. A date that cannot be read is not.
 *
 * ── WHERE THE ANSWER COMES FROM ──────────────────────────────────────────────────────────────────
 *
 * The CALENDAR asks, once per load, the moment its documents open (calendar-app.js, on
 * `calendarAuthReady` and through the same gate a tap passes), and the answer is kept on this device
 * for every page: the latest issue's DATE, never a yes or no. So an answer kept from yesterday still
 * ages correctly today, offline included, and the button goes on its own at six weeks with no read
 * at all. Only the Calendar asks because it is the page every member opens first and the home of the
 * documents, and because a read on every page would land inside the windows where the browser tests
 * count reads exactly (e2e/overtime.spec.js expects four). The drawer re-reads this answer every time
 * it opens (nav-panel.js), and an Operations upload from this device counts as an answer at once
 * (`noteNewsletterUploaded`), so the admin sees the button come back as soon as they upload.
 *
 * A device that has never asked shows NO button. Offering an issue nobody has dated is the fault this
 * exists to stop, and the next Calendar load fixes it. A failed read changes nothing: the device keeps
 * what it knew. Where storage is refused (iOS private browsing) the answer is held in memory for the
 * page instead, so the Calendar still shows the button it has just been told about.
 *
 * Pure apart from `ls.js`: no DOM, no Firebase. The read is handed in (`fetchLatest`), so the rule,
 * the memory and the check are all unit-tested in Node (newsletter-recency.test.mjs).
 */
import { lsGet, lsSet } from './ls.js';

/** How long an issue stays on the menu, counted in whole days from its issue date. The copy says
 *  "six weeks" in four places (guide-app-parity.test.mjs holds them to this number). */
export const NEWSLETTER_RECENT_DAYS = 42;

/** Where this device keeps the latest issue's date ('' once the server has said there is none).
 *  Device-level, like every Calendar-wide fact: the issue is the same whoever is signed in. */
export const NEWSLETTER_LATEST_KEY = 'myb_newsletter_latest';

/** This page's copy of the answer, for a device whose storage refuses it. @type {string|null} */
let _memo = null;

/**
 * A 'YYYY-MM-DD' date as a day number (days since 1 Jan 1970, by the calendar, not the clock), or
 * null when it is not a real date. Counted in UTC from the date's own figures, so a clock change
 * between the issue and today never moves the count by a day.
 * @param {unknown} iso
 * @returns {number|null}
 */
function _dayNumber(iso) {
    if (typeof iso !== 'string') return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m) return null;
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const t = Date.UTC(y, mo - 1, d);
    const back = new Date(t);
    // 2026-02-30 is not a date: Date.UTC would roll it on to 2 March. Refused, not corrected.
    if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
    return t / 86_400_000;
}

/**
 * Is an issue with this date recent enough for the ☰ menu on `now`'s day? True from its date (or
 * before it) until the day before it turns six weeks old.
 * @param {unknown} issueDate  'YYYY-MM-DD'
 * @param {Date} [now]
 * @returns {boolean}
 */
export function isRecentIssue(issueDate, now = new Date()) {
    const issue = _dayNumber(issueDate);
    if (issue === null) return false;
    const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86_400_000;
    return today - issue < NEWSLETTER_RECENT_DAYS;
}

/** The latest issue's date as this device knows it: '' for none, null for never asked. This page's own
 *  answer comes first: it is the newest thing the page has heard, and storage may have refused it. */
function _known() {
    return _memo ?? lsGet(NEWSLETTER_LATEST_KEY);
}

/**
 * Should the ☰ menu offer the Marylebone Newsletter now? Asked by the drawer as it is drawn and
 * every time it opens, and by the Calendar's sign-in card (calendar-lock-cards.js), whose staff PIN
 * line names the Newsletter only while the menu does.
 * @param {Date} [now]
 * @returns {boolean}
 */
export function newsletterInMenu(now = new Date()) {
    return isRecentIssue(_known(), now);
}

/**
 * Keep what the server said is the latest issue: its date, or none at all.
 * @param {unknown} issueDate  the latest issue's `date`, or null when none has been uploaded
 */
export function recordLatestNewsletter(issueDate) {
    const value = typeof issueDate === 'string' ? issueDate : '';
    _memo = value;
    lsSet(NEWSLETTER_LATEST_KEY, value);
}

/**
 * This device has just uploaded an issue (Operations). The latest is now at least this one, so it is
 * kept unless the device already knows a later one: an older issue filed for the record must not
 * stand in for a newer one, and would hide a button that should show.
 * @param {string} issueDate  'YYYY-MM-DD', as uploaded
 */
export function noteNewsletterUploaded(issueDate) {
    const uploaded = _dayNumber(issueDate);
    if (uploaded === null) return;
    const known = _dayNumber(_known());
    if (known !== null && known >= uploaded) return;
    recordLatestNewsletter(issueDate);
}

/**
 * Ask the server for the latest issue's date and keep it. Waits for `ready` (the page's session),
 * asks nothing while `canRead()` says the documents are shut, and never rejects: a refused or failed
 * read leaves this device's answer as it was.
 * @param {{ ready: Promise<any>, canRead: () => boolean, fetchLatest: () => Promise<any> }} deps
 *   fetchLatest — the latest Newsletter's data, or null when none has been uploaded
 *   (firebase-client.js `getLatestNewsletter`, the same read the ☰ button opens).
 * @returns {Promise<void>}
 */
export async function checkLatestNewsletter({ ready, canRead, fetchLatest }) {
    try {
        await ready;
        if (!canRead()) return;
        const latest = await fetchLatest();
        recordLatestNewsletter(latest?.date ?? null);
    } catch { /* kept: a read that could not answer says nothing about the newsletter */ }
}
