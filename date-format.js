// @ts-check
/**
 * date-format.js — ONE spelling of a date, everywhere the app writes one in words.
 *
 * Pure, and imports NOTHING — so any module can take a date vocabulary without taking the roster
 * with it. `paycalc-format.js`, `operations-reports.js` and `links-design-doc.js` were all
 * roster-free before this, and five paycalc suites mock `roster-data.js` by name.
 *
 * ── WHY THIS IS ITS OWN MODULE (v24.06) ────────────────────────────────────────────────────────
 *
 * It was written INTO roster-data.js first, and that file's 1250-line ratchet refused it at once.
 * The ratchet offers EXTRACT, SPLIT or RAISE, and extracting was right on its own merits: a date
 * vocabulary is one subject, and it is not the subject roster-data.js is about. The tables stay
 * there because ~8 modules already read `MONTH_ABB` and `DAY_NAMES` directly and none of them are
 * about formatting; moving those would have been churn in the service of tidiness.
 *
 * ── THE RULE ───────────────────────────────────────────────────────────────────────────────────
 *
 * `Intl` / `toLocaleDateString` with `month: 'short'` is NOT this vocabulary. en-GB abbreviates
 * September to FOUR letters and every other month to three, so a surface built on ICU says
 * "18 Sept 2026" while the calendar grid, the week label and the admin rows beside it say
 * "18 Sep". Measured on real engines rather than assumed — Node 22, Chromium and WebKit all
 * return "Sept", and all agree with MONTH_ABB on the other eleven — so it reached every staff
 * device, on screen and on paper.
 *
 * It had already been found twice and fixed twice LOCALLY: Team View built the string from
 * MONTH_ABB by hand (v22.86), Overtime formatted through ICU and then trimmed the result with
 * `.replace(/\bSept\b/, 'Sep')` (in two places). That left three strategies for one question, and
 * the Links print header, the Pay Calculator, Settings and the Operations error log still on
 * ICU's. These composers are the fourth strategy replacing all of them, and
 * `month-vocabulary-parity.test.mjs` fails on a fifth.
 *
 * ── THE ZONE ───────────────────────────────────────────────────────────────────────────────────
 *
 * Every composer reads the LOCAL getters of the Date it is handed: the caller decides which
 * calendar a date is in, and the vocabulary only spells it. For an instant that must read as
 * London wall-clock — a roster-office document — convert with `londonDate` / `londonClock` first.
 * One zone shim, then the same words.
 */


/**
 * The two NAME TABLES, owned here rather than in roster-data.js (v24.06).
 *
 * They started there — they are shared constants, and that is where the app's shared constants
 * live — and moved when five paycalc suites went red: each mocks `./roster-data.js` with an
 * explicit `namedExports` list, so a formatter reaching through that module for a table broke
 * every test that had not been told to expect it. That is a signal, not an obstacle. The tables ARE
 * the vocabulary; a module that spells dates and then asks another module how to spell them is
 * split across a seam that does not exist. So this file imports NOTHING, and `roster-data.js`
 * re-exports both for the ~8 modules that already read them from there — the same shape
 * `normaliseSurname` has, living in the pure `auth-identity.js` and re-exported by
 * `firebase-client.js`.
 */
export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const MONTH_ABB = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// The year is the device's own calendar year, deliberately: these take a Date that a caller has
// already put in the calendar it means. For an instant that must read as LONDON wall-clock,
// convert with `londonDate` first and then compose — one zone shim, then the same words.

/**
 * An unusable date renders as the app's own em-dash, never as arithmetic.
 *
 * The composers read `getDate()`/`getMonth()` directly, so an Invalid Date came out as
 * "NaN undefined NaN" — which is worse than what they replaced: `toLocaleDateString` says
 * "Invalid Date", and however ugly that is, it says what happened. This is the one behaviour the
 * v24.06 sweep made worse rather than better, and it is guarded HERE rather than at the six call
 * sites, three of which already tested for it and three of which did not.
 *
 * `—` rather than an empty string, deliberately: a blank reads as "no date recorded", which is a
 * different and legitimate state several of these surfaces also have ("Not saved yet"). The app
 * already uses the em-dash for a figure it cannot supply — the Calendar's AL lightbox does — so a
 * reader meets it as "this is missing", not as a date.
 * @param {Date} d
 */
const usable = d => d instanceof Date && !Number.isNaN(d.getTime());
export const NO_DATE = '—';

/** "18 Sep" @param {Date} d */
export const formatDayMonth = d => (usable(d) ? `${d.getDate()} ${MONTH_ABB[d.getMonth()]}` : NO_DATE);

/** "18 Sep 2026" @param {Date} d */
export const formatDayMonthYear = d => (usable(d) ? `${formatDayMonth(d)} ${d.getFullYear()}` : NO_DATE);

/** "18 Sep 26" — the two-digit-year form. @param {Date} d */
export const formatDayMonthYear2 = d => (usable(d)
    ? `${formatDayMonth(d)} ${String(((d.getFullYear() % 100) + 100) % 100).padStart(2, '0')}`
    : NO_DATE);

/** "Fri 18 Sep", or "Fri 18 Sep 2026" with the year. @param {Date} d @param {boolean} [withYear] */
export const formatWeekdayDate = (d, withYear = false) => (usable(d)
    ? `${DAY_NAMES[d.getDay()]} ${withYear ? formatDayMonthYear(d) : formatDayMonth(d)}`
    : NO_DATE);

/**
 * "Printed Fri 18 Sep 2026 · 14:23" — the provenance line every printable surface closes on.
 *
 * ONE SHAPE ACROSS FIVE SURFACES (v24.06). The Calendar, Team View, Overtime, Links and the Pay
 * Calculator all print a "when", and each said it differently: a long month with "at" before the
 * time, a bare date with no time at all, and a weekday-led stamp with one. The ROADMAP listed four
 * of the five and called unifying them tidiness; the argument for it is stronger than that, and it
 * was already written beside the Overtime one, which is why ITS shape is the one the other four
 * adopt rather than the other way round:
 *
 *   A reviewer holding two printouts of the same week cannot tell which is the later one
 *   without the time. The data line above it does not order them — both sheets may have been
 *   taken from snapshots sharing it. The printed-at line is what orders them.
 *
 * That applies to every sheet a colleague can reprint after changing something, which is all five.
 * The YEAR is there for the same reason the deadline lines deliberately omit theirs: a deadline is
 * days away, a printout goes in a folder and is read next August.
 *
 * The TIME is passed in rather than read off `date`, because the two are not always in the same
 * calendar. The Overtime sheet is a roster-office document and states LONDON wall-clock whatever
 * the device is set to; the other four state the device's own. Making the caller supply both means
 * a surface cannot silently acquire the wrong zone — there is no default to inherit.
 *
 * @param {Date} date   the calendar date to name
 * @param {string} clock  the time to name, already in that same calendar
 */
export const printedStamp = (date, clock) => `Printed ${formatWeekdayDate(date, true)} · ${clock}`;

/**
 * "14:23" in LONDON wall-clock, whatever the device is set to.
 *
 * Separate from `londonDate` rather than folded into it, and the reason is a DST trap: `londonDate`
 * returns a local-calendar Date at NOON precisely so no shim can move its day. Carrying the London
 * TIME on that Date instead would put it back at risk — a device whose own DST gap is at 01:00
 * renders a 01:30 London instant as 02:30, because that local time does not exist. Formatting the
 * clock through `Intl` in London never constructs a local Date at all.
 * @param {number|Date} at
 */
export const londonClock = at => new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
}).format(at instanceof Date ? at : new Date(at));

/**
 * "14:23" — 24-hour, zero-padded, in the device's own zone.
 *
 * `hourCycle: 'h23'` explicitly: en-GB's default is already 24-hour, but `'h24'` renders midnight
 * as "24:00" and a locale fallback can reach 12-hour, and every clock face in this app is 24-hour
 * because every roster and payslip staff read is.
 * @param {Date} d
 */
export const formatClock = d => (usable(d)
    ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    : NO_DATE);

/**
 * An instant's LONDON wall-clock calendar date, as a local-calendar Date at noon — so the four
 * composers above can then spell it without ever seeing a timezone.
 *
 * Noon, not midnight, for the reason `getPeriods` uses noon: a local-calendar Date built at
 * midnight lands on the previous day under a negative DST shim on some engines. Nothing reads the
 * time off the result; only its day/month/year/weekday.
 *
 * `formatToParts` with NUMERIC parts, not a formatted string: the numbers are the same in every
 * locale and every ICU version, so the spelling divergence this whole section exists for cannot
 * re-enter through the zone shim.
 * @param {number|Date} at @returns {Date}
 */
export function londonDate(at) {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/London', year: 'numeric', month: 'numeric', day: 'numeric',
    }).formatToParts(at instanceof Date ? at : new Date(at));
    const get = (/** @type {string} */ type) => Number(parts.find(p => p.type === type)?.value);
    return new Date(get('year'), get('month') - 1, get('day'), 12);
}
