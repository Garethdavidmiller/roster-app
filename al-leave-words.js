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
 * found, and whether the sheet's own total counts it), then what the APP SHOWS — what the Calendar
 * draws that day (`drawn`, from `resolveDayShift`), which is what the admin will find there; a stored
 * record that no surface draws is not described as if it were. A difference is named as a fact about
 * the records — never as an instruction, and never as one side being wrong: the workbook is a quota
 * grid and the app a leave record, and both can be right (AL_WORKBOOK.md §9).
 *
 * The days that need a person's knowledge ask the question Admin itself asks — "was it a swapped
 * working day?" — and only where Admin would ask it (`swapQuestion`), because only the person who
 * booked the day knows (al-swapped-days.js).
 *
 * The allowance is explained from each side's OWN parts, never from a rule restated here: the
 * sheet's printed figures, and the app's own note (`entitlementNote`, the words Admin's banner uses).
 * The first cut put a Dispatcher's difference down to "a day in lieu for each bank holiday worked"
 * even where the app's figure was the LOWER one (review, 14 Nov 2026).
 *
 * Calm, UK English, no exclamation marks (CLAUDE.md → staff-facing wording); "the admin" is never
 * named, because the reader is the admin.
 */
import { formatWeekdayDate, formatDayMonthYear } from './date-format.js';
import { parseISODate } from './roster-data.js';

/** "Tue 24 Feb 2026" — every date on the card carries its year, because the sheet runs into the next. @param {string} iso */
export const dayLabel = iso => formatWeekdayDate(parseISODate(iso), true);

/** @param {number} n @param {string} one @param {string} many */
const plural = (n, one, many) => (n === 1 ? one : many);

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

const RANGE = /^(\d{1,2}:\d\d)-(\d{1,2}:\d\d)$/;

/**
 * What the Calendar draws on a day, in words. The pattern, when no record is shown there; otherwise
 * the drawn shift — so an absence on a rest day reads as the rest day the Calendar shows, and an old
 * timed shift on a Sunday as the rest day working it is drawn as.
 * @param {{ pattern: string, drawn: { shift: string, rdwTime: string, fromPattern: boolean, type: string|null } }} day
 * @returns {string}
 */
export function drawnWords(day) {
    const d = day.drawn;
    if (d.fromPattern) return `${patternWords(day.pattern)} on their pattern`;
    if (d.type === 'other') return 'an Other day (training, a meeting or similar)';
    if (d.shift === 'RD' || d.shift === 'OFF') return 'a rest day';
    if (d.shift === 'SPARE') return 'a Spare turn';
    if (d.shift === 'AL') return 'annual leave';
    if (d.shift === 'SICK') return 'an absence';
    if (d.shift === 'RDW') {
        const t = RANGE.exec(d.rdwTime ?? '');
        return `rest day working (RDW)${t ? `, ${t[1]}–${t[2]}` : ''}`;
    }
    const m = RANGE.exec(d.shift ?? '');
    return m ? `a shift, ${m[1]}–${m[2]}` : 'a change of shift';
}

/**
 * What the APP has on a day, given the comparison's state for it.
 * @param {{ state: string, pattern: string, appYear?: number|null, swapQuestion?: boolean,
 *           drawn: { shift: string, rdwTime: string, fromPattern: boolean, type: string|null } }} day
 * @param {number} year the sheet's year
 * @returns {string}
 */
export function appWords(day, year) {
    switch (day.state) {
    case 'match': return 'In the app as annual leave';
    case 'not-in-app': return `Not in the app — ${patternWords(day.pattern)} on their pattern`;
    case 'rest-day': return 'Not in the app — a rest day on their pattern. Was it a swapped working day?';
    case 'free-in-app': return day.swapQuestion
        ? 'In the app, but on a rest day on their pattern, so it costs nothing there. Was it a swapped working day?'
        : 'In the app, but recorded over a rest day, so it costs nothing there';
    case 'other-year': return `In the app, but from ${day.appYear}’s allowance — the sheet has it as a ${year} day`;
    case 'carried': return `In the app from ${day.appYear}’s allowance — the sheet counts it in ${year} and carries a day forward from ${day.appYear} to pay for it`;
    case 'differs': return `The app shows ${drawnWords(day)} instead`;
    case 'worked': return `The app shows ${drawnWords(day)} — work, which an upload would never overwrite`;
    case 'before-start': return 'Before their start date in the app, which shows and counts nothing then';
    case 'sunday': return `The app shows ${drawnWords(day)} that Sunday`;
    default: return '';
    }
}

/** A figure in words, as the Admin banner says it: "3 left", "0 left", "1 over limit". @param {number} n */
const leftWords = n => (n < 0 ? `${-n} over limit` : `${n} left`);

/** The per-person figures line. @param {import('./al-leave-compare.js').PersonComparison} p */
export function figuresLine(p) {
    const app = p.app.remaining === null ? 'App: no allowance on record' : `App: ${leftWords(p.app.remaining)}`;
    if (!p.sheet) return `Sheet: no totals row · ${app}`;
    const sheet = p.sheet.corrected !== p.sheet.remaining
        ? `Sheet: ${leftWords(p.sheet.remaining)} (corrected: ${leftWords(p.sheet.corrected)})`
        : `Sheet: ${leftWords(p.sheet.remaining)}`;
    return `${sheet} · ${app}`;
}

/**
 * Why the sheet's own figure is corrected, from the days that move it: its total misses a day under
 * another spelling, or a dated over-quota day with the count left blank (each takes one off), and
 * it counts a Sunday, which is never leave (one back). The first cut said "with the days its total
 * misses" even when a counted Sunday had RAISED the figure (review, 14 Nov 2026).
 * @param {import('./al-leave-compare.js').PersonComparison} p
 */
function correctionWords(p) {
    const count = (/** @type {(d: any) => boolean} */ f) => p.days.filter(f).length;
    const misspelt = count(d => d.foundIn === 'grid-misspelt');
    const blank = count(d => d.foundIn === 'column-e-uncounted');
    const sundays = count(d => d.kind === 'sunday-counted');
    /** @type {string[]} */ const parts = [];
    if (misspelt) parts.push(`its total misses ${misspelt} ${plural(misspelt, 'day', 'days')} under another spelling`);
    if (blank) parts.push(`${blank} ${plural(blank, 'day is', 'days are')} dated over quota with the count beside ${plural(blank, 'it', 'them')} left blank`);
    if (sundays) parts.push(`it counts ${sundays} ${plural(sundays, 'Sunday', 'Sundays')}, and a Sunday is never annual leave`);
    const s = /** @type {NonNullable<typeof p.sheet>} */ (p.sheet);
    return `Corrected, the sheet leaves ${s.corrected}, not ${s.remaining}: ${parts.join('; ')}.`;
}

/** "includes 1 day…" from "Includes 1 day…" — the app's own note, inside a sentence. @param {string} s */
const lowerFirst = s => s.charAt(0).toLowerCase() + s.slice(1);

/**
 * The lines that explain a person's figures beyond their days: a corrected sheet figure, a carry-over,
 * an allowance that differs, days the sheet deducts without dates, a gap nothing explains, a second row.
 * @param {import('./al-leave-compare.js').PersonComparison} p
 * @param {number} year the sheet's year
 * @returns {string[]}
 */
export function personNotes(p, year) {
    /** @type {string[]} */ const out = [];
    const s = p.sheet;
    if (s && s.corrected !== s.remaining) out.push(correctionWords(p));
    if (s && p.carried > 0) {
        out.push(`The sheet carries ${s.carriedForward} ${plural(s.carriedForward, 'day', 'days')} forward from ${year - 1}; `
            + `the app takes ${p.carried} January ${plural(p.carried, 'day', 'days')} from ${year - 1}’s allowance instead, `
            + 'marked as carried below.');
    }
    if (s && p.allowanceDiffers) {
        const forward = s.carriedForward - p.carried;
        /** @type {string[]} */ const parts = [];
        if (forward) parts.push(`plus ${forward} carried forward`);
        if (s.joinerReduction) parts.push(`less ${s.joinerReduction} for starting part way through the year`);
        out.push(`The sheet allows ${forward + s.allowance - s.joinerReduction}${parts.length ? ` (${s.allowance}, ${parts.join(', ')})` : ''}, `
            + `and the app ${p.app.entitlement}${p.app.note ? ` (${lowerFirst(p.app.note)})` : ''}.`);
    }
    if (s && s.undated > 0) out.push(`The sheet deducts ${s.undated} more ${plural(s.undated, 'day', 'days')} over quota with no date, so ${plural(s.undated, 'it cannot', 'they cannot')} be checked against the app.`);
    if (s && p.counts.figures > 0) out.push(`The sheet leaves ${s.corrected} and the app ${p.app.remaining}, and nothing on the sheet shows why.`);
    if (p.otherRows > 0) out.push(`The sheet lists them on ${p.otherRows + 1} rows; this uses the one with their days.`);
    return out;
}

/** The short chips on a person's row: only what needs a look. Each says its own count. */
const CHIP_WORDS = /** @type {Record<string, (n: number) => string>} */ ({
    'not-in-app': n => `${n} not in the app`,
    'rest-day': n => `${n} ${plural(n, 'rest day', 'rest days')} to ask about`,
    'free-in-app': n => `${n} ${plural(n, 'costs', 'cost')} nothing in the app`,
    'other-year': n => `${n} from another year’s allowance`,
    'differs': n => `${n} ${plural(n, 'differs', 'differ')}`,
    'worked': n => `${n} with work recorded`,
    'before-start': n => `${n} before their start date`,
    'app-only': n => `${n} only in the app`,
    'beyond': n => `${n} after the sheet ends`,
    'undated': n => `${n} undated over quota`,
    'figures': () => 'figures differ',
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
        .map(([k, words]) => ({ key: k, text: words(counts[k]) }))];
}

/** The summary's lines, one per kind of difference found anywhere. */
const TOTAL_WORDS = /** @type {Record<string, [string, string]>} */ ({
    'not-in-app': ['day of leave on the sheet is not in the app', 'days of leave on the sheet are not in the app'],
    'rest-day': ['day of leave falls on a rest day — was it a swapped working day?', 'days of leave fall on rest days — were they swapped working days?'],
    'free-in-app': ['day of leave is in the app on a rest day, costing nothing', 'days of leave are in the app on rest days, costing nothing'],
    'other-year': ['day of leave comes out of a different year’s allowance in the app', 'days of leave come out of a different year’s allowance in the app'],
    'differs': ['day has a shift, an absence or a rest day in the app instead', 'days have a shift, an absence or a rest day in the app instead'],
    'worked': ['day has work recorded in the app', 'days have work recorded in the app'],
    'before-start': ['day of leave on the sheet comes before a start date in the app', 'days of leave on the sheet come before a start date in the app'],
    'app-only': ['day of leave is in the app and not on the sheet', 'days of leave are in the app and not on the sheet'],
    'beyond': ['day of leave after the sheet’s last date comes out of this year’s allowance in the app', 'days of leave after the sheet’s last date come out of this year’s allowance in the app'],
    'undated': ['day over quota is on the sheet with no date, so it cannot be checked', 'days over quota are on the sheet with no date, so they cannot be checked'],
    'figures': ['person’s figures differ with nothing on the sheet to show why', 'people’s figures differ with nothing on the sheet to show why'],
});

/**
 * The summary's lines, each with the kind it counts — the same key its chips wear, so the card can
 * colour a line like the chips it sums up. An allowance that differs comes first, as its chip does.
 * @param {Record<string, number>} totals @param {number} [allowances] how many people's allowance differs
 * @returns {Array<{ key: string, text: string }>}
 */
export function totalsEntries(totals, allowances = 0) {
    const out = allowances > 0
        ? [{ key: 'allowance', text: `${allowances} ${allowances === 1 ? 'person’s allowance differs' : 'people’s allowances differ'} between the sheet and the app` }]
        : [];
    return [...out, ...Object.entries(TOTAL_WORDS)
        .filter(([k]) => (totals[k] ?? 0) > 0)
        .map(([k, [one, many]]) => ({ key: k, text: `${totals[k]} ${totals[k] === 1 ? one : many}` }))];
}

/** The summary's lines, words only. @param {Record<string, number>} totals @param {number} [allowances] */
export const totalsLines = (totals, allowances = 0) => totalsEntries(totals, allowances).map(e => e.text);

/** Why a person is not compared. @param {string} reason */
export function reasonWords(reason) {
    switch (reason) {
    case 'leaver': return 'has left (not on the roster any more)';
    case 'manager': return 'a manager — the app keeps no leave figures for managers';
    case 'no-allowance': return 'no leave allowance on record in the app for this year';
    case 'not-in-app': return 'not in the app';
    case 'since': return 'left out when this file was made — a new leave file would include them';
    default: return 'not compared';
    }
}

/** The card's fixed lines and headings — every one of them here, so the browser test and the card read one source. */
export const CARD_WORDS = Object.freeze({
    checking: 'Checking the file and reading the app’s records…',
    unreadable: 'That file could not be read. Choose it again.',
    offline: 'You’re offline, so the app’s own records can’t be read, and a check against this device’s copy could call leave missing that isn’t. Try again with a connection.',
    readFailed: 'The app’s records couldn’t be read. Check your connection and try again.',
    failed: 'The check stopped part way. Nothing was saved. Try again, and if it happens again, make a fresh leave file.',
    notByClerk: 'Somebody other than the clerks saved the sheet last, so its date may say less about when the leave was checked.',
    ageUnknown: 'Without that date, the card can’t tell how old the copy is. Ask the clerks for a fresh copy before relying on what follows.',
    needsALook: 'Needs a look',
    agree: 'Agree with the app',
    notCompared: 'On the sheet, not compared',
    absent: 'In the app, not on the sheet',
    appOnlyHead: 'Leave in the app that the sheet does not have',
    beyondDay: 'After the sheet’s last date, so the sheet cannot show it',
    noDays: 'No days on the sheet for them this year.',
    checkOnly: 'This is a check only: nothing has been saved. To change a day, use Change a Shift on the Admin page.',
});

/** The heading over leave the app takes from this year after the sheet ends. @param {number} year */
export const beyondHeadWords = year => `Leave after the sheet ends that comes out of ${year}’s allowance in the app`;

/** The status line once a check is done. @param {number} n people compared */
export const checkedWords = n => `Checked ${n} ${n === 1 ? 'person' : 'people'} against the app. Nothing was saved.`;

/** The summary's headline. @param {number} look people needing a look @param {number} people people compared */
export function overallWords(look, people) {
    if (people === 0) return 'Nobody on the sheet could be compared with the app.';
    if (people === 1) return look ? 'The one person compared needs a look.' : 'The one person compared agrees with the app.';
    if (look) return `${look} of ${people} people ${look === 1 ? 'needs' : 'need'} a look.`;
    return `All ${people} agree with the app.`;
}

/** The warning under an old copy. @param {number} maxAge */
export const oldWords = maxAge => `That is more than ${maxAge} days old. Ask the clerks for a fresh copy before relying on what follows.`;

/** Sunday tags nobody could be tied to. @param {number} n */
export const unplacedWords = n => `${n} Sunday ${n === 1 ? 'tag' : 'tags'} on the sheet could not be tied to anybody the app holds.`;

/** A day of leave only the app holds. @param {number|null} chargedTo the year whose allowance it costs a day of; null when it costs nothing */
export const appOnlyWords = chargedTo => (chargedTo === null ? 'Costs nothing in the app' : `Costs a day of ${chargedTo}’s allowance in the app`);

/** The fold holding a person's other days. @param {number} n */
export const moreDaysWords = n => (n === 1
    ? '1 more day on the sheet that agrees, or that the app cannot hold'
    : `${n} more days on the sheet that agree, or that the app cannot hold`);

/** A line under "On the sheet, not compared". @param {{ name: string, reason: string }} n */
export const notComparedWords = n => `${n.name} — ${reasonWords(n.reason)}`;

/**
 * How old the clerks' copy is, in words, with the warning when it is past the limit — or, when the
 * file does not say, that it cannot be told. A file with no save time is a valid one (Stage 1 writes
 * null when the workbook carries none), and the first cut called it "more than 14 days old"
 * (review, 14 Nov 2026).
 * @param {{ saved: string|null, ageDays: number|null, maxAge: number }} a  `saved` is the ISO instant
 * @returns {{ line: string, old: boolean, unknown: boolean }}
 */
export function ageWords({ saved, ageDays, maxAge }) {
    if (!saved || ageDays === null) return { line: 'This file does not say when the clerks last saved the sheet.', old: false, unknown: true };
    const when = formatDayMonthYear(parseISODate(saved.slice(0, 10)));
    const ago = ageDays <= 0 ? 'today' : ageDays === 1 ? 'yesterday' : `${ageDays} days ago`;
    return { line: `The clerks last saved this sheet on ${when} (${ago}). Anything booked since then shows as only in the app.`,
             old: ageDays > maxAge, unknown: false };
}

// ── THE SAVE (Phase 2b) ─────────────────────────────────────────────────────────────────────────
// What the Save says (operations-al-save.js). The rest-day question and its two answers are the Admin
// leave card's own words (admin-week-editor.js, admin-range-booking.js), so the day is asked about the
// same way wherever leave is booked. A refusal says why and what to do; nothing says the admin is
// wrong, and nothing is said about a colleague but that a day changed.

/** The Save's fixed lines. */
export const SAVE_WORDS = Object.freeze({
    swapped: 'Swapped — counts',
    free: 'Rest day — free',
    intro: 'Only the people you confirm are saved. Each day is checked again as it is written, and a day somebody has changed since this check is left as it is.',
    removedSince: 'Removed in the app since this sheet was last saved here, so the Save will not put it back. If it should be there, add it in Admin.',
    nothingForSave: 'Nothing here is for the Save: a day that differs another way is changed in Admin, with Change a Shift.',
    confirmFirst: 'Confirm a person to save',
    saveable: 'Nothing is saved until you confirm a person and press Save. A day that differs another way is changed in Admin, with Change a Shift.',
    logsUnreadable: 'The record of earlier Saves couldn’t be read, so this file can’t be saved. Check again with a connection.',
    noName: 'You need to be signed in as yourself to save, so this file can’t be saved here.',
    offlineNow: 'You’re offline. Save again with a connection.',
    lost: 'The connection was lost, so the Save stopped. Check again when you’re back online: whatever was saved shows as already right, and saving again finishes it.',
    failed: 'The Save stopped part way. Check again to see what was saved, then save again to finish it.',
    unreadAfter: 'The app’s records couldn’t be read after the Save, so it isn’t recorded yet. Check again with a connection to see what was saved and record it.',
    recorded: 'This Save is recorded, so it can be undone.',
    notRecorded: 'This Save couldn’t be recorded, so it can’t be undone here. What it saved is in the app.',
    nowRecorded: 'The earlier Save is now recorded, so it can be undone.',
    undo: 'Undo this Save',
    undoing: 'Taking back what the Save added…',
    undoStopped: 'The Undo stopped part way. Nothing about it was recorded, so you can press Undo again.',
    undoNothing: 'Nothing was taken back: every day it added has changed since, or is already gone.',
    recheckFailed: 'The check after it stopped part way. Check again to see what the app now holds.',
    clearAsk: 'Clear the check? Your answers, and the people you have confirmed, go with it.',
});

/** The question over a rest day. @param {string} date */
export const questionWords = date => `Was ${dayLabel(date)} a swapped working day?`;

/**
 * What a person's confirmation does: days added, and days already booked that a swap now makes count.
 * @param {{ name: string, add: number, swap: number }} a
 */
export function confirmWords({ name, add, swap }) {
    const adds = `add ${add} ${plural(add, 'day', 'days')} of leave`;
    const swaps = `count ${swap} booked rest ${plural(swap, 'day', 'days')} as swapped`;
    const what = add && swap ? `${adds}, and ${swaps}` : add ? adds : swaps;
    return `${what.charAt(0).toUpperCase()}${what.slice(1)} for ${name}`;
}

/** The person's figures once the Save is done. @param {import('./al-leave-compare.js').PersonComparison} p */
export const afterWords = p => `After this Save — ${figuresLine(p)}`;

/** What the Save leaves different, in the chips' own words. @param {Array<{ text: string }>} chips */
export const stillDiffersWords = chips => `Still different after it: ${chips.map(c => c.text).join(' · ')}`;

/** Rest days not yet answered, which the Save leaves alone. @param {number} n */
export const unansweredWords = n => `${n} ${plural(n, 'rest day above is', 'rest days above are')} still to answer, and won’t be saved until ${plural(n, 'it is', 'they are')}.`;

/** The Save button. @param {{ days: number, people: number }} t */
export const saveButtonWords = t => (t.days === 0 ? SAVE_WORDS.confirmFirst
    : `Save ${t.days} ${plural(t.days, 'day', 'days')} for ${t.people} ${plural(t.people, 'person', 'people')}`);

/** While the Save runs. @param {number} done @param {number} total */
export const savingWords = (done, total) => `Saving… ${done} of ${total} ${plural(total, 'day', 'days')}`;

/** "6 Nov 2026" from an ISO instant or a server stamp. @param {any} at */
const dateOf = at => formatDayMonthYear(at instanceof Date ? at : parseISODate(String(at).slice(0, 10)));

/**
 * Why this file cannot be saved (al-leave-plan.js → `saveRefusal`), with what to do instead.
 * @param {'age-unknown'|'too-old'|'older-copy'} code
 * @param {{ maxAge: number, newest?: { clerksLastSaved: string, savedAt?: any }|null }} a  `savedAt` as a Date
 */
export function refusalWords(code, { maxAge, newest = null }) {
    const fresh = 'Ask the clerks for a fresh copy and make a new leave file.';
    if (code === 'age-unknown') return `This file doesn’t say when the clerks last saved the sheet, so it can’t be saved. ${fresh}`;
    if (code === 'too-old') return `This copy is more than ${maxAge} days old, so it can’t be saved. ${fresh}`;
    const when = newest?.savedAt instanceof Date ? ` on ${dateOf(newest.savedAt)}` : '';
    return `A newer copy of this sheet, saved by the clerks on ${newest ? dateOf(newest.clerksLastSaved) : 'a later date'}, was saved here${when}. `
        + 'This copy is older, so it can’t be saved: it could put back leave cancelled since.';
}

/**
 * The receipt's first lines: what was saved, and for whom nothing was. `unsure`: the Save stopped
 * where its writes may have landed and the server could not be read since, so "Nothing was saved"
 * would be a guess; the line saying why it stopped goes on alone. A refused person is refused whole:
 * their days go in one part (al-leave-save.js), which takes 450 operations, and a year's sheet gives
 * anybody a few dozen days.
 * @param {{ days: number, people: number, refused: Map<string, string[]>, unsure?: boolean }} a
 * @returns {string[]}
 */
export function receiptWords({ days, people, refused, unsure = false }) {
    /** @type {string[]} */ const out = [];
    if (days) out.push(`Saved ${days} ${plural(days, 'day', 'days')} for ${people} ${plural(people, 'person', 'people')}.`);
    for (const [name, dates] of refused) {
        out.push(`Nothing was saved for ${name}: ${dates.map(dayLabel).join(', ')} changed after the check. `
            + 'Their answers are kept; look at them again below.');
    }
    if (!out.length && !unsure) out.push('Nothing was saved.');
    return out;
}

/**
 * The last Save of this year's sheet, as the summary names it, with its Undo beside it.
 * @param {{ savedAt: Date|null, savedBy: string, added: number }} a
 */
export const lastSaveWords = ({ savedAt, savedBy, added }) => `This sheet was last saved here${savedAt ? ` on ${dateOf(savedAt)}` : ''} by ${savedBy}, `
    + `adding ${added} ${plural(added, 'day', 'days')} of leave.`;

/** The Undo's question. @param {number} n days the Save added */
export const undoConfirmWords = n => `This takes back the ${n} ${plural(n, 'day', 'days')} of leave the Save added — except any that somebody has changed since.`;

/** "C. Specimen, Tue 3 Mar 2026" for a "Name|date" key. @param {string} key */
const keyWords = key => { const [name, date] = key.split('|'); return `${name}, ${dayLabel(date)}`; };

/**
 * What an Undo did.
 * @param {{ removed: string[], kept: string[], gone: string[] }} r
 * @returns {string[]}
 */
export function undoneWords({ removed, kept, gone }) {
    if (!removed.length) return [SAVE_WORDS.undoNothing];
    const out = [`Took back ${removed.length} ${plural(removed.length, 'day', 'days')} of leave.`];
    if (kept.length) out.push(`${kept.length} ${plural(kept.length, 'day was', 'days were')} kept, because ${plural(kept.length, 'it has', 'they have')} changed since: ${kept.map(keyWords).join('; ')}.`);
    if (gone.length) out.push(`${gone.length} ${plural(gone.length, 'day was', 'days were')} already gone.`);
    return out;
}
