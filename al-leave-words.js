// @ts-check
/**
 * al-leave-words.js — every sentence the Annual leave sheet card says (operations-al-sheet.js). Pure:
 * the comparison (al-leave-compare.js) decides each day, and this only says it, so every line can be
 * tested without a browser (al-leave-words.test.mjs).
 *
 * ── WRITTEN FOR THE PERSON ACTING ON IT ─────────────────────────────────────────────────────────
 *
 * The reader is the admin with the clerks' sheet in one hand and Admin's Change a Shift in the other.
 * So each day says two things, side by side and in this order: what the SHEET says (where the day was
 * found, and whether the sheet's own total counts it), then what the APP has. A difference is named
 * as a fact about the records — never as an instruction, and never as one side being wrong: the
 * workbook is a quota grid and the app a leave record, and both can be right (AL_WORKBOOK.md §9).
 *
 * The two that need a person's knowledge ask the question Admin itself asks — "was it a swapped
 * working day?" — because only the person who booked the day knows (al-swapped-days.js).
 *
 * Calm, UK English, no exclamation marks (CLAUDE.md → staff-facing wording); "the admin" is never
 * named, because the reader is the admin.
 */
import { formatWeekdayDate, formatDayMonthYear } from './date-format.js';
import { parseISODate } from './roster-data.js';

/** "Tue 24 Feb 2026" — every date on the card carries its year, because the sheet runs into the next. @param {string} iso */
export const dayLabel = iso => formatWeekdayDate(parseISODate(iso), true);

/**
 * What the SHEET says about a day.
 * @param {string} foundIn @param {string} kind
 * @returns {string}
 */
export function sheetWords(foundIn, kind) {
    if (kind === 'sunday-counted') return 'A plain name on a Sunday — the sheet counts it';
    switch (foundIn) {
    case 'grid': return 'In the grid';
    case 'grid-misspelt': return 'In the grid under another spelling — the sheet’s own total misses it';
    case 'column-e': return 'Over quota — dated in the note, not in the grid';
    case 'column-e-uncounted': return 'Dated in the over-quota note, but the count beside it is blank';
    case 'no-totals-row': return 'In the grid — the sheet has no totals row for them';
    case 'grid-tag': return 'A Sunday tag — the clerks mark the day, never as leave';
    default: return 'On the sheet';
    }
}

/**
 * A pattern shift in words: 'a rest day', 'a spare day', '06:00–14:00', or the code as it stands.
 * @param {string} shift
 */
export function patternWords(shift) {
    if (shift === 'RD' || shift === 'OFF') return 'a rest day';
    if (shift === 'SPARE') return 'a spare day';
    const m = /^(\d\d:\d\d)-(\d\d:\d\d)$/.exec(shift ?? '');
    return m ? `${m[1]}–${m[2]}` : String(shift ?? '');
}

/**
 * A recorded day in words, from its record's type and value.
 * @param {{ type: string, value: string }|null} app
 */
export function recordWords(app) {
    if (!app) return 'nothing';
    switch (app.type) {
    case 'annual_leave': return 'annual leave';
    case 'sick': return 'an absence';
    case 'correction': return 'a rest day';
    case 'rdw': return 'rest day working (RDW)';
    case 'spare_shift': return 'a Spare turn';
    case 'other': return 'an Other day (training, a meeting or similar)';
    case 'shift': {
        const m = /^(\d\d:\d\d)-(\d\d:\d\d)$/.exec(app.value ?? '');
        return m ? `a shift, ${m[1]}–${m[2]}` : 'a shift';
    }
    default: return 'a change of shift';
    }
}

/**
 * What the APP has on a day, given the comparison's state for it.
 * @param {{ state: string, app: { type: string, value: string }|null, pattern: string }} day
 * @param {number} year the sheet's year
 * @returns {string}
 */
export function appWords(day, year) {
    switch (day.state) {
    case 'match': return 'In the app as annual leave';
    case 'not-in-app': return `Not in the app — ${patternWords(day.pattern)} on their pattern`;
    case 'rest-day': return 'Not in the app — a rest day on their pattern. Was it a swapped working day?';
    case 'free-in-app': return 'In the app, but on a rest day, so it costs nothing there. Was it a swapped working day?';
    case 'other-year': return `In the app, but charged to a different year’s allowance — the sheet counts it in ${year}`;
    case 'differs': return `The app has ${recordWords(day.app)} instead`;
    case 'worked': return `The app has ${recordWords(day.app)} — work, which an upload would never overwrite`;
    case 'before-start': return 'Before their start date — the app holds nothing then';
    case 'sunday': return day.app
        ? `The app has ${recordWords(day.app)} that Sunday`
        : `The app has ${patternWords(day.pattern)} on their pattern that Sunday`;
    default: return '';
    }
}

/** The per-person figures line. @param {import('./al-leave-compare.js').PersonComparison} p */
export function figuresLine(p) {
    const app = p.app.remaining === null ? 'App: no allowance on record' : `App: ${p.app.remaining} left`;
    if (!p.sheet) return `Sheet: no totals row · ${app}`;
    const sheet = p.sheet.corrected !== p.sheet.remaining
        ? `Sheet: ${p.sheet.remaining} left (${p.sheet.corrected} with the days its total misses)`
        : `Sheet: ${p.sheet.remaining} left`;
    return `${sheet} · ${app}`;
}

/**
 * The lines that explain a person's figures beyond their days: an allowance that differs, days the
 * sheet deducts without dates, a second row.
 * @param {import('./al-leave-compare.js').PersonComparison} p
 * @param {{ role?: string }|undefined} member
 * @returns {string[]}
 */
export function personNotes(p, member) {
    /** @type {string[]} */ const out = [];
    const s = p.sheet;
    if (s && p.allowanceDiffers) {
        const sheetAllows = s.carriedForward + s.allowance - s.joinerReduction;
        out.push(`The sheet allows ${sheetAllows} and the app ${p.app.entitlement}.`
            + (member?.role === 'Dispatcher' ? ' The app adds a day in lieu for each bank holiday worked.' : ''));
    }
    if (s && s.undated > 0) out.push(`The sheet deducts ${s.undated} more ${s.undated === 1 ? 'day' : 'days'} over quota with no date, so ${s.undated === 1 ? 'it cannot' : 'they cannot'} be checked against the app.`);
    if (p.otherRows > 0) out.push(`The sheet lists them on ${p.otherRows + 1} rows; this uses the one with their days.`);
    return out;
}

/** The short chips on a person's row: only what needs a look. */
const CHIP_WORDS = /** @type {Record<string, [string, string]>} */ ({
    'not-in-app': ['not in the app', 'not in the app'],
    'rest-day': ['rest day to ask about', 'rest days to ask about'],
    'free-in-app': ['costs nothing in the app', 'cost nothing in the app'],
    'other-year': ['other year', 'other year'],
    'differs': ['differs', 'differ'],
    'worked': ['work recorded', 'work recorded'],
    'app-only': ['only in the app', 'only in the app'],
});

/**
 * A person's chips. An allowance that differs gets one too, first: a person can need a look for that
 * alone, and a closed row with no chip would not say why it is in the list.
 * @param {Record<string, number>} counts @param {boolean} [allowanceDiffers]
 * @returns {Array<{ key: string, text: string }>}
 */
export function chipsFor(counts, allowanceDiffers = false) {
    const out = allowanceDiffers ? [{ key: 'allowance', text: 'allowance differs' }] : [];
    return [...out, ...Object.entries(CHIP_WORDS)
        .filter(([k]) => (counts[k] ?? 0) > 0)
        .map(([k, [one, many]]) => ({ key: k, text: `${counts[k]} ${counts[k] === 1 ? one : many}` }))];
}

/** The summary's lines, one per kind of difference found anywhere. */
const TOTAL_WORDS = /** @type {Record<string, [string, string]>} */ ({
    'not-in-app': ['day of leave on the sheet is not in the app', 'days of leave on the sheet are not in the app'],
    'rest-day': ['day of leave falls on a rest day — was it a swapped working day?', 'days of leave fall on rest days — were they swapped working days?'],
    'free-in-app': ['day of leave is in the app on a rest day, costing nothing', 'days of leave are in the app on rest days, costing nothing'],
    'other-year': ['day of leave comes out of a different year’s allowance in the app', 'days of leave come out of a different year’s allowance in the app'],
    'differs': ['day has a shift, an absence or a rest day in the app instead', 'days have a shift, an absence or a rest day in the app instead'],
    'worked': ['day has work recorded in the app', 'days have work recorded in the app'],
    'app-only': ['day of leave is in the app and not on the sheet', 'days of leave are in the app and not on the sheet'],
});

/**
 * @param {Record<string, number>} totals @param {number} [allowances] how many people's allowance differs
 * @returns {string[]}
 */
export function totalsLines(totals, allowances = 0) {
    const out = allowances > 0
        ? [`${allowances} ${allowances === 1 ? 'person’s allowance differs' : 'people’s allowances differ'} between the sheet and the app`]
        : [];
    return [...out, ...Object.entries(TOTAL_WORDS)
        .filter(([k]) => (totals[k] ?? 0) > 0)
        .map(([k, [one, many]]) => `${totals[k]} ${totals[k] === 1 ? one : many}`)];
}

/** Why a person is not compared. @param {string} reason */
export function reasonWords(reason) {
    switch (reason) {
    case 'leaver': return 'has left (not on the roster any more)';
    case 'manager': return 'a manager — the app keeps no leave figures for managers';
    case 'no-allowance': return 'no leave allowance on record in the app for this year';
    case 'not-in-app': return 'not in the app';
    default: return 'not compared';
    }
}

/** The card's fixed lines and headings — every one of them here, so the browser test and the card read one source. */
export const CARD_WORDS = Object.freeze({
    checking: 'Checking the file and reading the app’s records…',
    unreadable: 'That file could not be read. Choose it again.',
    offline: 'You’re offline, so the app’s own records can’t be read, and a check against this device’s copy could call leave missing that isn’t. Try again with a connection.',
    readFailed: 'The app’s records couldn’t be read. Check your connection and try again.',
    notByClerk: 'Somebody other than the clerks saved the sheet last, so its date may say less about when the leave was checked.',
    needsALook: 'Needs a look',
    agree: 'Agree with the app',
    notCompared: 'On the sheet, not compared',
    absent: 'In the app, not on the sheet',
    appOnlyHead: 'Leave in the app that the sheet does not have',
    noDays: 'No days on the sheet for them this year.',
    checkOnly: 'This is a check only: nothing has been saved. To change a day, use Change a Shift on the Admin page.',
});

/** The status line once a check is done. @param {number} n people compared */
export const checkedWords = n => `Checked ${n} ${n === 1 ? 'person' : 'people'} against the app. Nothing was saved.`;

/** The summary's headline. @param {number} look people needing a look @param {number} people people compared */
export function overallWords(look, people) {
    if (people === 0) return 'Nobody on the sheet could be compared with the app.';
    if (look) return `${look} of ${people} ${people === 1 ? 'person needs' : 'people need'} a look.`;
    return people === 1 ? 'The one person compared agrees with the app.' : `All ${people} agree with the app.`;
}

/** The warning under an old copy. @param {number} maxAge */
export const oldWords = maxAge => `That is more than ${maxAge} days old. Ask the clerks for a fresh copy before relying on what follows.`;

/** Sunday tags nobody could be tied to. @param {number} n */
export const unplacedWords = n => `${n} Sunday ${n === 1 ? 'tag' : 'tags'} on the sheet could not be tied to anybody the app holds.`;

/** A day of leave only the app holds. @param {boolean} counts whether it costs a day of this year's allowance */
export const appOnlyWords = counts => (counts ? 'Costs a day in the app' : 'Costs nothing in the app');

/** The fold holding a person's other days. @param {number} n */
export const moreDaysWords = n => (n === 1
    ? '1 more day on the sheet that agrees, or that the app cannot hold'
    : `${n} more days on the sheet that agree, or that the app cannot hold`);

/** A line under "On the sheet, not compared". @param {{ name: string, reason: string }} n */
export const notComparedWords = n => `${n.name} — ${reasonWords(n.reason)}`;

/**
 * How old the clerks' copy is, in words, with the warning when it is past the limit.
 * @param {{ saved: string|null, ageDays: number|null, maxAge: number }} a  `saved` is the ISO instant
 * @returns {{ line: string, old: boolean }}
 */
export function ageWords({ saved, ageDays, maxAge }) {
    if (!saved || ageDays === null) return { line: 'This file does not say when the clerks last saved the sheet.', old: true };
    const when = formatDayMonthYear(parseISODate(saved.slice(0, 10)));
    const ago = ageDays <= 0 ? 'today' : ageDays === 1 ? 'yesterday' : `${ageDays} days ago`;
    return { line: `The clerks last saved this sheet on ${when} (${ago}). Anything booked since then shows as only in the app.`,
             old: ageDays > maxAge };
}
