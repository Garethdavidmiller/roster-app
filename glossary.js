// @ts-check
/**
 * glossary.js — "Glossary": the roster words a newcomer meets before anybody explains them, one
 * line each, and the one test of whether a piece of help text uses one.
 *
 * WHY (owner, 26 Nov 2026). The app's words are the railway's: RDW, AL, Spare, a pay cut-off, a lieu day, Year
 * to Date. Each page explains its own, where it uses it, and a colleague who meets one somewhere else — at 22:00
 * on a late turn, with nobody to ask — had nowhere to look it up (CLAUDE.md → "Plain English that TEACHES").
 * So the words are defined ONCE, here, and shown in the page's own `?` panel (tips-lightbox.js): from the
 * drawer's Reference zone, and from the foot of any `?` panel whose text uses one of them.
 *
 * ── RULES AN EDIT CAN BREAK ─────────────────────────────────────────────────────────────────────
 *
 * 1. **One line each, in the app's own words.** Each line was taken from what the app already says where the
 *    word appears (the badge key, the day-detail panel, the Christmas rules, the Pay Calculator), so the glossary
 *    cannot teach a second meaning. Change a meaning there and here together.
 * 2. **No pay rate, no allowance figure.** Those live in `docs/PAYCALC_REFERENCE.md` and `al-contract.js` alone; a
 *    copy here would be the stale one. Say what a word MEANS, not what it is worth.
 * 3. **`mentionsGlossaryTerm` is what puts the link on a panel**, so a term added here is found in every panel
 *    without touching one. Its tests are glossary.test.mjs.
 */

/** @typedef {{ term: string, icon: string, line: string }} GlossaryEntry */

/** The words, in the order a newcomer meets them on the Calendar. @type {ReadonlyArray<GlossaryEntry>} */
export const GLOSSARY = Object.freeze([
    { term: 'Early, Late, Night', icon: '☀️', line: 'A shift named by its start: Early from 04:00 to 10:59, Late from 11:00 to 20:59, Night from 21:00 to 03:59.' },
    { term: 'RD', icon: '🏠', line: 'Rest day: a day off in your roster pattern.' },
    { term: 'RDW', icon: '💼', line: 'Rest Day Working: a shift worked on one of your rest days, paid as overtime.' },
    { term: 'AL', icon: '🏖️', line: 'Annual leave: a day of holiday taken from your yearly allowance.' },
    // "Absent", never "sick" (CLAUDE.md): the reason is never stored, and the line says so.
    { term: 'Absent', icon: '🪑', line: 'A day recorded as away from work, for any reason; the app keeps the day, never the reason.' },
    // Not every Spare day is worked: a CEA or CES Spare week is four shifts, set nearer the time (newlink-tips.js;
    // admin-tips.js, "a whole Spare week off uses 4 days, not 6"). A Dispatcher's Spare days are not counted that way.
    { term: 'Spare', icon: '📋', line: 'On standby: your shift for that day is set nearer the time; a CEA or CES Spare week works four of its days.' },
    // paycalc-help.js: Other days "pay as the day they replace".
    { term: 'Other', icon: '🏷️', line: 'A day of training, induction, an assessment, a team day, union duties or a meeting; it is paid as the day it replaces.' },
    { term: 'BH', icon: '🏛️', line: 'Bank holiday: a public holiday; hours worked on one are paid at a higher rate.' },
    { term: 'Pay cut-off', icon: '✂️', line: 'The last day of shifts paid on the coming payday; shifts after it are paid on the payday after that.' },
    // Earned by working Boxing Day when the pattern had you at work (`boxingDayLieuDays`, christmas-leave.js), or by a
    // Dispatcher working a bank holiday (al-contract.js). It is held in that December's allowance or the next year's
    // (`boxingDayLieuYear`, al-entitlement.js), so the line names no year.
    { term: 'Lieu day', icon: '🎁', line: 'A day of leave added to your allowance for working Boxing Day when your pattern had you at work, or, for a Dispatcher, a bank holiday.' },
    { term: 'Year to Date', icon: '📊', line: 'The running totals on your payslip since the tax year began on 6\u00a0April, such as Taxable Pay and Tax\u00a0Paid.' },
    // paycalc-help.js: the premium is on all pay above basic, paid as one sum on a January payslip.
    { term: 'HPP', icon: '\ud83d\udcb7', line: 'Holiday Pay Premium: extra pay for your annual leave, worked out from your pay above basic, paid once a year in January.' },
    { term: 'CEA', icon: '\ud83e\udeaa', line: 'Customer Experience Ambassador: a station grade, with its own roster and pay rate.' },
    { term: 'CES', icon: '\ud83e\udeaa', line: 'Customer Experience Supervisor: the supervisors\u2019 grade, with its own roster and pay rate.' },
    { term: 'Dispatcher', icon: '\ud83e\udeaa', line: 'The Dispatchers\u2019 grade, with its own roster.' },
    // newlink-tips.js's own definition (rule 1).
    { term: 'Link', icon: '\ud83d\udd01', line: 'The set of weeks everyone on a roster works through in turn, one week each, then on to the next.' },
    // newlink-tips.js's "The weeks" panel, word for word.
    { term: 'Cover week', icon: '\ud83d\udccb', line: 'A Spare week: four shifts between Monday and Saturday, set nearer the time, to cover leave and absence.' },
].map(e => Object.freeze(e)));

/** The panel's own title — the drawer row's words, and with no emoji: it is the dialog's name, read out (tips-content.test.mjs). */
export const GLOSSARY_TITLE = 'Glossary';

/**
 * How each word is written where it is used. The short forms count only in capitals, as whole words: "al" inside
 * a word is not AL, "spare" and "absent" in a sentence are the ordinary words, and RD inside RDW is not RD. The rest
 * in any case ("pay cut-off", "a lieu day", "year to date"), with "Annual leave", "Rest Day Working", "bank holiday"
 * and "Holiday Pay Premium" the long forms of AL, RDW, BH and HPP. A link is "the link" or "today’s link", never a
 * bare "link": "a new link" to a file is a web address (operations-tips.js). Early, Late, Night and Other are not
 * looked for: each is an ordinary word at the start of a sentence.
 */
const SHORT_FORMS = /\b(?:RDW|RD|AL|BH|HPP|CEA|CES|Spare|Absent)\b/;
const WORDS = /Rest Day Working|\brest days?\b|\bannual leave\b|\bbank holidays?\b|Holiday Pay Premium|\bpay cut-off\b|\blieu\b|\byear to date\b|\bdispatchers?\b|\bcover weeks?\b|\b(?:the|today[’']s) (?:new )?link\b/i;   // "pay cut-off": Overtime's "cut-off" is its deadline (26 Nov 2026)

/**
 * Does this text use a word the glossary defines? Markup is ignored, so a word inside a tag's attribute is not
 * a mention. @param {string} text @returns {boolean}
 */
export function mentionsGlossaryTerm(text) {
    const words = String(text ?? '').replace(/<[^>]*>/g, ' ');
    return SHORT_FORMS.test(words) || WORDS.test(words);
}
