// @ts-check
/**
 * glossary.js — "Words used in the app": the roster words a newcomer meets before anybody explains them, one
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
 * 2. **No pay rate, no allowance figure.** Those live in `.claude/rules/paycalc.md` and `al-contract.js` alone; a
 *    copy here would be the stale one. Say what a word MEANS, not what it is worth.
 * 3. **`mentionsGlossaryTerm` is what puts the link on a panel**, so a term added here is found in every panel
 *    without touching one. Its tests are glossary.test.mjs.
 */

/** @typedef {{ term: string, icon: string, line: string }} GlossaryEntry */

/** The words, in the order a newcomer meets them on the Calendar. @type {ReadonlyArray<GlossaryEntry>} */
export const GLOSSARY = Object.freeze([
    { term: 'RDW', icon: '💼', line: 'Rest Day Working: a shift worked on one of your rest days, paid as overtime.' },
    { term: 'AL', icon: '🏖️', line: 'Annual leave: a day of holiday taken from your yearly allowance.' },
    { term: 'Spare', icon: '📋', line: 'On standby: you are at work that day, but your shift is not set yet.' },
    { term: 'Pay cut-off', icon: '✂️', line: 'The last day of shifts paid on the coming payday; shifts after it are paid on the payday after that.' },
    { term: 'Lieu day', icon: '🎁', line: 'A day of leave owed for a day you worked, such as a Boxing Day you were rostered to work; it is added to your allowance.' },
    { term: 'Year to Date', icon: '📊', line: 'The running totals on your payslip since the tax year began on 6\u00a0April, such as Taxable Pay and Tax\u00a0Paid.' },
].map(e => Object.freeze(e)));

/** The panel's own title — the drawer row's words, and with no emoji: it is the dialog's name, read out (tips-content.test.mjs). */
export const GLOSSARY_TITLE = 'Words used in the app';

/**
 * How each word is written where it is used. The short forms count only in capitals, as whole words: "al" inside
 * a word is not AL, and "spare" in a sentence is the ordinary word. The rest in any case ("pay cut-off", "a lieu day",
 * "year to date"), with "Annual leave" and "Rest Day Working" the long forms of AL and RDW.
 */
const SHORT_FORMS = /\b(?:RDW|AL|Spare)\b/;
const WORDS = /Rest Day Working|\bannual leave\b|\bpay cut-off\b|\blieu\b|\byear to date\b/i;   // "pay cut-off": Overtime's "cut-off" is its deadline (26 Nov 2026)

/**
 * Does this text use a word the glossary defines? Markup is ignored, so a word inside a tag's attribute is not
 * a mention. @param {string} text @returns {boolean}
 */
export function mentionsGlossaryTerm(text) {
    const words = String(text ?? '').replace(/<[^>]*>/g, ' ');
    return SHORT_FORMS.test(words) || WORDS.test(words);
}
