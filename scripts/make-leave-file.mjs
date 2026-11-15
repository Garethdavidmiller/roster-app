#!/usr/bin/env node
// @ts-check
/**
 * make-leave-file.mjs — STAGE 1 of the annual leave uploader: the clerks' workbook in, a leave file
 * out (docs/AL_UPLOADER_PLAN.md §3). Run in a SESSION, never by the app, and never inside CI on a
 * real workbook: the workbook and the file both name colleagues against their leave.
 *
 *   node scripts/make-leave-file.mjs --workbook <book.xlsx> --year 2026 \
 *        (--previous <last.leave.json> | --first-run) [--answers <answers.local.json>] \
 *        --out <outside-the-repo>/leave-2026-as-of-<date>.leave.json [--csv <outside>/days.csv] [--today YYYY-MM-DD]
 *
 * Exit 0: the file is written, sealed, and has passed the app's own validator. Exit 2: questions
 * only a person can answer are printed as JSON — answer them in an answers file and run again.
 * Exit 3: the workbook is not shaped the way the method knows; read docs/AL_WORKBOOK.md before
 * changing anything here. Exit 1: a usage or input error. Name the answers file `*.local.json`, which
 * .gitignore excludes: its answers are personal facts about colleagues.
 *
 * ── THE METHOD IS docs/AL_WORKBOOK.md, AND THIS FOLLOWS IT ─────────────────────────────────────
 *
 *   · The calendar sheet is chosen by its FIRST DATE (`<year>-01-01` in B2) and a Marylebone name,
 *     never by its name alone — the 2021 sheet's name looks more canonical than the live one (§2).
 *     The totals sheet is the one whose COUNTIF formulas name that calendar.
 *   · A totals row is a row whose Used is ONE COUNTIF of the calendar, and what it COUNTS is the
 *     formula's criterion. A row relabelled "Vacancy" still counts its leaver's days (measured,
 *     14 Nov 2026), and the reader's own count must equal the sheet's cached Used on every row, or
 *     nothing is written. EVERY row of the totals sheet is looked at, not only the rows with a Used:
 *     a row that looks like a person's (a role, a `Surname . I`, a figure or a comment in column E)
 *     whose Used is anything else stops the file, and so does a row whose Used is BLANK while it
 *     still carries something to lose — a `Surname . I`, a column-E figure or a column-E comment.
 *     Skipping either lost the row's column E, the §0 failure, with exit 0. A blank Used beside a
 *     grade and nothing else is one of the sheet's empty placeholder rows, and is left out with a note.
 *   · Grade blocks come from the COUNTIF ranges, so a name is only ever counted in its own block (§3),
 *     and only ever MATCHED in it: a row, a cell or a tag in one grade's block is matched mechanically
 *     only to a member of that grade (a manager, whose leave is never imported, to any). Two people
 *     can share one spelling in two blocks — a CEA trainee the app does not hold, and a CES member it
 *     does — and a grade-blind match gave the CES member the trainee's days.
 *   · Column E is read with its threaded comment, scoped to the totals sheet through its own
 *     relationships, replies included; where only Excel's legacy copy of a thread survives, it is split
 *     back into the thread's entries. `D/M` and `DD.MM` are both dates, the full stop only between two
 *     digits each side (`1.5 DAYS` is not 1 May). A START entry's first date after the word is the
 *     start date and is dropped; another date in that entry is asked about — but "start" in a phrase
 *     about LEAVE (`START OF A/L 24/12`) is not a joiner, and is asked about rather than dropped. An
 *     entry that names a date in a shape the method does not read (`24 Dec`, `24-12`, `Christmas
 *     Eve`, `the 24th`, a half day) is asked about too: read as words, it became an undated lump. So
 *     is one whose date no leave can be on — outside the sheet (a year mistyped), a Sunday, 25 or 26
 *     December — which stopped the file with no answer to give. A date the grid already holds is
 *     counted once (§5, §6).
 *   · A comment that dates days beside a BLANK count (§8 defect 7) is real leave the count missed —
 *     but only while the thread is the dates alone. Words beside them (`CANCELLED`, `NOT TAKEN`) may
 *     say a day was not taken, so that thread is asked about. `A/L`, `AL` and `A.L.` in any case are
 *     the one whitelist (LEAVE_MARKER): they say what the date is, not whether it stands.
 *   · Sunday tags are never leave. A tag is placed by its TEXT, or by an answer; its slot column —
 *     whoever holds the days either side — is offered as evidence and never decides (measured: one
 *     neighbour agrees with a readable tag 51 times in 83, §7). A ONE-word tag is never matched
 *     mechanically: §7 measured first names among them, so `N/A Grace` could be filed under a member
 *     whose SURNAME is Grace.
 *   · Everything is ordered by code unit, never by locale, so the seal does not depend on the session.
 *   · A misspelt name in the grid is still that person's leave (owner, 14 Nov 2026), recorded as not
 *     counted by the sheet, so the file says what the sheet's own total missed (§8 defect 9).
 *   · NEVER KEY ANYTHING BY NAME ALONE (§8 defect 6): rows are kept by row number, and a person with
 *     two rows has both listed, with which was used and why. A stale row is settled by rule only when
 *     it loses nothing: every column-E date on it must also be on the row that is used, which must be
 *     in the member's own grade block. Otherwise which row is theirs is asked.
 *   · Somebody whose days are not imported (a leaver, a manager) has their column E left unread, with
 *     a note: a comment nobody will use is no reason to stop the file. An uncounted name on a Sunday or
 *     a closed day is not leave and no figure counts it, so it is noted and left out the same way.
 *
 * ── IT ASKS, NEVER GUESSES ─────────────────────────────────────────────────────────────────────
 *
 * A name it cannot match mechanically (`Surname . I` against `I. Surname`), a duplicate row it
 * cannot settle by rule (rows with the same figures and different comments included), a comment date
 * that could be either January with no date beside it to settle it: each becomes a QUESTION, and
 * no file is written until it is answered. Every NAME answer and match goes into the file's
 * `nameMap`, and the NEXT run reads them from the previous file — so two sessions match the same names
 * from the same workbook (plan §3.4). The other answers (which duplicate row, which January, an entry
 * read by hand, the dates beside a blank count, a commented row that counts nobody) are keyed by row
 * and cell, which move between copies of the sheet, so they are not carried: a new copy asks them
 * again (leave-file-script.test.mjs pins it). The map is never committed: the exceptions in it are
 * personal.
 *
 * A carried name is CHECKED, never just believed: the roster moves between copies. An answer in THIS
 * run's answers file is taken as given; a value carried from the previous file stands only while the
 * mechanical match does not contradict it. A carried "not in the app" (null) whose spelling now
 * matches a member is asked again — the trainee of AL_WORKBOOK.md §10 Q14/Q16 is answered null while
 * the sheet carries them and the app does not, and stayed null after `/new-starter` added them, their
 * days silently left out. A carried name is asked again when the match now names somebody else, or
 * more than one member. A carried name the match finds nobody for (an answered misspelling, or the
 * other block's row of a person with a row in each) still stands, so an unchanged roster makes the
 * same file and asks nothing.
 *
 * What each question is, and the answers file's field for it (an object; every field optional):
 *
 *   row-name, cell-name, tag-name  → `rows`, `cells`, `tags`: { <key>: "<app name>" | null }, null for
 *                                    somebody the app does not hold. Carried in the next file's map.
 *   duplicate-rows                 → `duplicates`: { <app name>: <the row number that is theirs> }
 *   comment-date                   → `commentDates`: { <key>: "<one of its candidates>" }
 *   comment-entry                  → `entryDates`: { <key>: ["YYYY-MM-DD", …] } — the days of leave that
 *                                    comment entry names, read by hand; [] for none. Given for an entry
 *                                    the method can read, it is used instead of the reading.
 *   uncounted-dates                → `uncounted`: { <key>: ["YYYY-MM-DD", …] } — which of the dates
 *                                    beside a blank count are leave; [] for none
 *   unnamed-row                    → `unnamedRows`: { <key>: null } — the comment on a row that counts
 *                                    no name was read by hand, and the row is left out
 *
 * An answer that is not one the question allows is not used: the question is asked again, with a note.
 *
 * ── IT NEVER WRITES INSIDE THE REPOSITORY ──────────────────────────────────────────────────────
 *
 * The Pages mirror serves every committed file. `--out` and `--csv` are refused inside the
 * repository, inside any other git checkout or worktree, by a path with `..` in it, and over an
 * existing file with another name (a hard link, whose other names could be anywhere); the leave file
 * must end `.leave.json` and the day list `.csv`, which .gitignore excludes besides. No output may
 * name an input or the other output (`isOutsideRepo`, `fileOf`).
 */
import { readFileSync, writeFileSync, realpathSync, existsSync, lstatSync, readlinkSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { dirname, resolve, relative, isAbsolute, join, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readXlsx, serialToIso, splitRef, colNumber } from './xlsx-read.mjs';
import { LEAVE_FILE_FORMAT, LEAVE_FILE_VERSION, validateLeaveFile, sealLeaveFile, readLeaveFile, describeRefusal,
    isSundayIso, isChristmasIso, isRealIsoDate } from '../al-leave-file.js';
import { leaveRecordability } from '../al-leave-compare.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ── Names ───────────────────────────────────────────────────────────────────────────────────────

/**
 * One spelling of a key: NFC, lower case, single spaces, nothing at either end. Dots are kept:
 * `Smith . J` is the sheet's form. NFC because the seal is worked out over NFC (al-leave-file.js), so
 * a carried key comes back NFC whatever the workbook wrote. Apostrophes are NOT folded here: a key is
 * the spelling as written, and COUNTIF tells `O’Brien` from `O'Brien` just as this does — folding
 * belongs to MATCHING (`forMatching`), never to what a key is.
 * @param {string} s
 */
export const normaliseKey = s => s.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * A spelling made ready to be MATCHED to a member: NFC, curly apostrophes straightened (Word and a
 * phone type `O’Brien`; the roster may say `O'Brien`), lower case. Used by the app's form, the sheet's
 * form and a tag's alike, so the three can never disagree about one name.
 * @param {string} s
 */
const forMatching = s => s.normalize('NFC').replace(/[\u2018\u2019]/g, "'").toLowerCase();

/** `I. Surname` → its parts, ready to match; an initial is any letter (`Ö. Öst`). @param {string} name */
function appParts(name) {
    const m = /^(\p{L})\.\s+(.+)$/u.exec(forMatching(name).trim());
    return m ? { initial: m[1], surname: m[2] } : null;
}
/**
 * `Surname . I` → its parts, ready to match; anything else (a garbled criterion) is not a name. Letters
 * are any script's (`Agüero . M`), with an apostrophe, a hyphen or a space inside the surname. ASCII
 * alone made a real surname "something that is not a name", which stopped the file — or, on a row
 * counting nothing, left the person out in silence.
 * @param {string} s
 */
export function sheetParts(s) {
    const m = /^(\p{L}[\p{L}\p{M}' -]*\p{L})\s+\.\s+(\p{L})$/u.exec(forMatching(s).trim());
    return m ? { surname: m[1], initial: m[2] } : null;
}
/** A Sunday tag's words, the state removed: `J Surname`, `J. Surname` or one word. @param {string} key */
function tagParts(key) {
    const words = forMatching(key).replace(/\./g, ' ').split(/\s+/).filter(Boolean);
    if (words.length >= 2 && words[0].length === 1) return { initial: words[0], surname: words.slice(1).join(' ') };
    if (words.length === 1) return { initial: null, surname: words[0] };
    return null;
}
/**
 * May a member be matched into a grade block? Only their own (§3) — except a member with no block, a
 * manager, whose leave is never imported (`leaveRecordability`): matching one cannot file a day under
 * the wrong person, it only names whose row was left out.
 * @param {any} m a teamMembers entry @param {string} grade
 */
const fitsBlock = (m, grade) => { const g = memberGrade(m); return g === null || g === grade; };
/**
 * Every member whose initial and surname match, in that grade block — the names, so a caller can tell
 * nobody from more than one. A ONE-word tag (no initial) matches nobody: §7 measured first names
 * among them, and a surname match filed `N/A Grace` under a member whose SURNAME is Grace.
 * @param {{ initial: string|null, surname: string }|null} parts @param {any[]} members @param {string} grade
 * @returns {string[]}
 */
function mechanicalHits(parts, members, grade) {
    if (!parts || parts.initial === null) return [];
    return members.filter(m => {
        const p = appParts(m.name);
        return p && p.surname === parts.surname && p.initial === parts.initial && fitsBlock(m, grade);
    }).map(m => m.name);
}
/** Members a person might mean, for a question — never used to answer one. */
function suggestions(/** @type {string} */ surname, /** @type {any[]} */ members) {
    const near = (/** @type {string} */ a, /** @type {string} */ b) => {
        if (Math.abs(a.length - b.length) > 2) return false;
        /** @type {number[]} */ let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
        for (let i = 1; i <= a.length; i++) {
            const cur = [i];
            for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
            prev = cur;
        }
        return prev[b.length] <= 2;
    };
    return members.map(m => m.name).filter(n => {
        const p = appParts(n);
        return p && (near(p.surname, surname) || p.surname.includes(surname) || surname.includes(p.surname));
    }).sort();
}

const STATE_ONLY = /^\s*(available|pending|n\s*\/\s*a|na|closed)\s*$/i;
const STATE_TOKEN = /(?<![A-Za-z])(?:n\s*\/\s*a|na)(?![A-Za-z])/gi;
// A comment date: `D/M` or `DD/MM` (then `/YY` or `/YYYY`), or `DD.MM` (then `.YY` or `.YYYY`). The
// clerks write `19.08` and `21.10` (§5), so the full stop stays — but only between TWO-digit parts,
// or a quantity reads as a day: `1.5 DAYS FROM PRE JUNE` was the first of May.
const DATE_TOKEN = /(?<!\d)(?:(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?|(\d{2})\.(\d{2})(?:\.(\d{2}|\d{4}))?)(?!\d)/g;
// The ways a comment names a date that DATE_TOKEN does not read. Read as words they became an
// undated lump, and the day was lost from the person's list with nothing to say so; each is asked
// about instead. A month NAME alone is not a date — `A/L FROM PRE JUNE 2026` is the sheet's own lump
// (§5) — so a month counts only with a day number beside it, and a four-digit year is not a day.
const MONTH = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const UNREAD_DATE_SHAPES = [
    new RegExp(`(?<![\\p{L}\\d])\\d{1,2}(?:st|nd|rd|th)?\\s*(?:of\\s+)?${MONTH}(?!\\p{L})`, 'iu'),   // 24 Dec · 24th of December
    new RegExp(`(?<!\\p{L})${MONTH}\\.?\\s*\\d{1,2}(?:st|nd|rd|th)?(?!\\d)`, 'iu'),                   // Dec 24 · December 24th
    /(?<![\d/.])\d{1,2}-\d{1,2}(?![\d/.])/,                // 24-12 (and never the `04-11` inside `10/04-11/04`)
    /(?<!\d)\d{1,2}(?:st|nd|rd|th)(?!\p{L})/iu,            // the 24th
    /\b(?:christmas|xmas|boxing\s+day|new\s+year|easter)\b/i,   // a day by its name
    /\bhalf\b|(?<!\d)1\s*\/\s*2\s*(?:a\s+)?days?\b/i,      // a part day: `1/2 DAY` read as the first of February
];
/** @param {string} text @returns {boolean} does a comment entry name a date in a shape the method does not read? */
const namesUnreadDate = text => UNREAD_DATE_SHAPES.some(re => re.test(text));
// The words that say a dated day IS leave, and no more — the one whitelist beside a blank count
// (§8 defect 7): `A/L 10/04` is the date alone; `10/04 NOT TAKEN` or a reply `CANCELLED` is not.
const LEAVE_MARKER = /(?<!\p{L})(?:a\s*\/\s*l|a\.l\.?|al)(?!\p{L})/giu;
/** @param {string} text @returns {boolean} letters in it besides its dates and the leave markers */
const hasWords = text => /\p{L}/u.test(text.replace(DATE_TOKEN, ' ').replace(LEAVE_MARKER, ' '));
// "start" in a phrase about LEAVE — `START OF A/L 24/12`, `A/L START 24/12` — is when the leave
// starts, not a joiner's start date. Read as a joiner, its date was dropped as a start date and the
// rest of column E became a joiner's reduction. `STARTED ON 20/09 9 DAYS LEAVE ALLOWANCE` is a joiner:
// its leave word is not beside the start word.
const LEAVE_WORD = '(?:a\\s*\\/\\s*l|a\\.l\\.?|al|annual\\s+leave|leave|holidays?|hols?)';
const LEAVE_START = new RegExp(`\\bstart\\w*\\s+(?:(?:of|on|from)\\s+)?(?:(?:my|his|her|their|the)\\s+)?${LEAVE_WORD}(?!\\p{L})`
    + `|(?<!\\p{L})${LEAVE_WORD}\\s+start`, 'iu');
const COUNTIF = /^COUNTIF\(\s*'?([^'!]+)'?!\$?([A-Z]{1,3})\$?(\d+):\$?([A-Z]{1,3})\$?(\d+)\s*,\s*"((?:[^"]|"")*)"\s*\)$/i;
const ROLE_GRADE = /** @type {Record<string, string>} */ ({ CEA: 'CEA', BLCEA: 'CEA', CES: 'CES', DISP: 'DISP' });
/** The sheet's grade block for an app role. Management has none (`fitsBlock` says what that means for a match). */
const MEMBER_GRADE = /** @type {Record<string, string>} */ ({ CEA: 'CEA', CES: 'CES', Dispatcher: 'DISP' });
/** @param {any} m a teamMembers entry @returns {string|null} */
const memberGrade = m => (typeof m?.role === 'string' && Object.hasOwn(MEMBER_GRADE, m.role) ? MEMBER_GRADE[m.role] : null);

/**
 * Order by UTF-16 code unit, never by locale: `localeCompare` sorts by the SESSION's collation, so
 * the same workbook made a different file — and a different seal — in a Swedish locale and an English
 * one (`Ö` after `Z`, or beside `O`).
 * @param {string} a @param {string} b
 */
const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** @param {string} iso @param {number} n */
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * Every reading of one DATE_TOKEN match inside the sheet's own dates: one with a year, else this
 * year's and next year's (the grid runs into next January, §2), each kept only if it is a real date
 * the sheet covers.
 * @param {RegExpMatchArray} tk @param {number} year @param {string} first @param {string} last
 * @returns {string[]}
 */
function tokenCandidates(tk, year, first, last) {
    const mm = (tk[2] ?? tk[5]).padStart(2, '0'), dd = (tk[1] ?? tk[4]).padStart(2, '0'), yy = tk[3] ?? tk[6];
    return (yy ? [`${yy.length === 2 ? `20${yy}` : yy}-${mm}-${dd}`] : [`${year}-${mm}-${dd}`, `${year + 1}-${mm}-${dd}`])
        .filter(c => isRealIsoDate(c) && c >= first && c <= last);
}

/**
 * The clerks' last save (`dcterms:modified`) as the UTC instant the file records, or null. W3CDTF
 * carries its zone, and an offset is CONVERTED: `14:07:42+01:00` is 13:07:42Z, where it was relabelled
 * 14:07:42Z, an hour out, and a day out for a save just after midnight. A time with no zone is read as
 * UTC, which is what Excel writes.
 * @param {string|null} v
 * @returns {string|null} `YYYY-MM-DDTHH:MM:SSZ`
 */
export function savedInstant(v) {
    const m = typeof v === 'string'
        ? /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/.exec(v.trim()) : null;
    if (!m || !isRealIsoDate(m[1])) return null;
    const zone = !m[5] || m[5] === 'Z' ? 'Z' : m[5].includes(':') ? m[5] : `${m[5].slice(0, 3)}:${m[5].slice(3)}`;
    const ms = Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4] ?? '00'}${zone}`);
    return Number.isNaN(ms) ? null : `${new Date(ms).toISOString().slice(0, 19)}Z`;
}

/**
 * A column-E comment's entries from Excel's LEGACY note, read where no thread survives. Excel's copy
 * of a threaded comment is a placeholder sentence, then `Comment:` and each `Reply:` on a line of its
 * own with the text beneath (§5). Read whole it is ONE entry where the thread was several, so a
 * joiner's `STARTED` root took its dated replies down with it; it is split back into the thread it
 * copies, the placeholder dropped. A plain note is one entry, as it was written.
 * @param {string} note
 * @returns {string[]|null} null for a copy of a thread with no `Comment:` in it — not a known shape
 */
function legacyNoteEntries(note) {
    const text = note.replace(/\r\n?/g, '\n');
    if (!text.trimStart().startsWith('[Threaded comment]')) return [note];
    const heads = [...text.matchAll(/^(?:Comment|Reply):[ \t]*$/gm)];
    if (!heads.length) return null;
    return heads.map((h, i) => text.slice((h.index ?? 0) + h[0].length, heads[i + 1]?.index ?? text.length)
        .split('\n').map(line => line.trim()).join('\n').trim());
}

/**
 * @typedef {{ kind: string, key?: string, [k: string]: unknown }} Question
 * @typedef {{ rows?: Record<string, string|null>, cells?: Record<string, string|null>, tags?: Record<string, string|null>,
 *             duplicates?: Record<string, number>, commentDates?: Record<string, string>,
 *             entryDates?: Record<string, string[]>, uncounted?: Record<string, string[]>,
 *             unnamedRows?: Record<string, null> }} Answers
 *   What each field answers: the header (IT ASKS, NEVER GUESSES).
 */

/**
 * The workbook, read into the shape the method needs. Throws only on a file that is not a workbook.
 * @param {ReturnType<typeof readXlsx>} wb @param {number} year
 * @param {(q: Question) => void} unexpected
 * @param {(n: string) => void} [note] what was read past and why, for the session to see
 */
export function readLeaveWorkbook(wb, year, unexpected, note = () => {}) {
    const first = `${year}-01-01`;
    const calendars = wb.sheetNames.filter(n => /marylebone/i.test(n)
        && serialToIso(wb.sheet(n).cells.get('B2')?.v, wb.date1904) === first);
    if (calendars.length !== 1) { unexpected({ kind: 'unexpected', what: `${calendars.length} Marylebone calendar sheets start on ${first}` }); return null; }
    const cal = wb.sheet(calendars[0]);

    // The date rows: one per date, consecutive, from row 2.
    /** @type {Map<number, string>} row → date */ const dateOfRow = new Map();
    for (const [ref, c] of cal.cells) {
        const { col, row } = splitRef(ref);
        if (col !== 'B' || row < 2) continue;
        const iso = serialToIso(c.v, wb.date1904);
        if (iso) dateOfRow.set(row, iso);
    }
    const rows = [...dateOfRow.keys()].sort((a, b) => a - b);
    for (let i = 0; i < rows.length; i++) {
        if (rows[i] !== 2 + i || dateOfRow.get(rows[i]) !== addDays(first, i)) {
            unexpected({ kind: 'unexpected', what: `the calendar's dates are not one row per day from row 2 (row ${rows[i]})` });
            return null;
        }
    }
    const lastDate = dateOfRow.get(rows[rows.length - 1]) ?? first;

    // The totals sheet: the one whose COUNTIF formulas name this calendar.
    const totalsNames = wb.sheetNames.filter(n => n !== cal.name && [...wb.sheet(n).cells.values()]
        .some(c => c.f && COUNTIF.exec(c.f)?.[1] === cal.name));
    if (totalsNames.length !== 1) { unexpected({ kind: 'unexpected', what: `${totalsNames.length} sheets count this calendar` }); return null; }
    const tot = wb.sheet(totalsNames[0]);
    const val = (/** @type {string} */ ref) => tot.cells.get(ref)?.v ?? null;
    const num = (/** @type {string} */ ref, /** @type {boolean} */ blankIsZero) => {
        const v = val(ref);
        if ((v === null || (typeof v === 'string' && !v.trim())) && blankIsZero) return 0;
        return typeof v === 'number' && Number.isInteger(v) ? v : NaN;
    };

    /** @param {number} row @returns {boolean} a grade (CEA, BLCEA, CES, DISP) in column A */
    const gradeIn = row => Object.hasOwn(ROLE_GRADE, String(val(`A${row}`) ?? '').trim().toUpperCase());
    /**
     * Does a totals row carry something a skipped row would LOSE: a `Surname . I` in column B, a figure
     * in column E, or a comment on E (threaded, or a legacy note)? Column E's text is the header's, so
     * only a FIGURE or a comment there counts. A grade alone does not: the sheet has empty placeholder
     * rows that hold a grade in A and nothing else.
     * @param {number} row
     */
    const losable = row => !!sheetParts(String(val(`B${row}`) ?? '')) || typeof val(`E${row}`) === 'number'
        || tot.threaded.has(`E${row}`) || tot.notes.has(`E${row}`);
    /**
     * Does a totals row look like a person's, whatever its Used holds? Then a Used the method cannot
     * read stops the file. Skipped, the row's grid days came out as "no totals row" and its column E
     * — the leave §0 is about — went with it, and the run still succeeded.
     * @param {number} row
     */
    const personLike = row => gradeIn(row) || losable(row);

    // EVERY row the totals sheet holds anything on — a cell, or only a comment — in order. Reading
    // only the rows with something in Used skipped a person whose Used was blank or missing, column E
    // and all, with exit 0: the §0 failure again, one column along.
    /** @type {Set<number>} */ const sheetRowNumbers = new Set();
    for (const ref of [...tot.cells.keys(), ...tot.threaded.keys(), ...tot.notes.keys()]) sheetRowNumbers.add(splitRef(ref).row);

    /** @type {any[]} */ const totals = [];
    for (const row of [...sheetRowNumbers].sort((a, b) => a - b)) {
        const c = tot.cells.get(`G${row}`);
        if (!c || (!c.f && (c.v === null || (typeof c.v === 'string' && !c.v.trim())))) {
            // Used is blank, or not there at all. A placeholder (a grade and nothing else) is nobody's.
            // Anything a person's row carries is not read by skipping it, so it stops the file.
            if (losable(row)) {
                unexpected({ kind: 'unexpected', what: `totals row ${row}: its Used is blank, but the row has a name, a column-E figure or a column-E comment, so its days and its column E cannot be read` });
            } else if (gradeIn(row)) {
                note(`totals row ${row}: a grade with a blank Used and nothing else, a placeholder (left out)`);
            }
            continue;
        }
        // A totals row is ONE COUNTIF of this calendar, by name. Anything else in Used — two counts
        // added, a criterion that is a cell, a figure typed over the formula, another sheet's count —
        // is not a reading the method has, on a person's row or anywhere else.
        const m = c.f ? COUNTIF.exec(c.f) : null;
        if (!m || m[1] !== cal.name) {
            if (personLike(row)) {
                unexpected({ kind: 'unexpected', what: `totals row ${row}: its Used is not one COUNTIF of this calendar by name, so its days and its column E cannot be read` });
            } else if (c.f || typeof c.v === 'number') {
                note(`totals row ${row}: column G is not a count of this calendar, and the row is not a person's (left out)`);
            }
            continue;
        }
        const range = { c1: colNumber(m[2]), c2: colNumber(m[4]), r1: Number(m[3]), r2: Number(m[5]) };
        const printed = { carriedForward: num(`C${row}`, true), allowance: num(`D${row}`, false), columnE: num(`E${row}`, true),
                          used: num(`G${row}`, false), remaining: num(`H${row}`, false) };
        if (Object.values(printed).some(Number.isNaN)) { unexpected({ kind: 'unexpected', what: `totals row ${row} has a figure that is not a whole number` }); continue; }
        const role = String(val(`A${row}`) ?? '').trim().toUpperCase();
        const label = String(val(`B${row}`) ?? '').trim();
        // Column E's comment: the thread (body and replies, in the file's order), else the legacy note,
        // split back into its thread when it is Excel's copy of one.
        const thread = tot.threaded.get(`E${row}`);
        const legacy = tot.notes.get(`E${row}`);
        const entries = thread?.length ? thread.map(t => t.text) : legacy === undefined ? [] : legacyNoteEntries(legacy);
        if (!entries) { unexpected({ kind: 'unexpected', what: `totals row ${row}: column E's comment is a copy of a thread with no Comment: in it` }); continue; }
        totals.push({ row, role, label, criterion: m[6].replace(/""/g, '"'), range, printed, eEntries: entries,
                      otherComments: [...tot.threaded.keys(), ...tot.notes.keys()].filter(k => k !== `E${row}` && splitRef(k).row === row).length });
    }
    totals.sort((a, b) => a.row - b.row);

    // The grade blocks, from the ranges — a name is only ever counted in its own block (§3).
    /** @type {Map<string, { grade: string, c1: number, c2: number }>} */ const blocks = new Map();
    for (const t of totals) {
        const grade = Object.hasOwn(ROLE_GRADE, t.role) ? ROLE_GRADE[t.role] : undefined;
        const key = `${t.range.c1}-${t.range.c2}`;
        if (!grade) { unexpected({ kind: 'unexpected', what: `totals row ${t.row} has a role the method does not know` }); continue; }
        const b = blocks.get(key);
        if (b && b.grade !== grade) { unexpected({ kind: 'unexpected', what: `columns ${key} are counted for two grades` }); continue; }
        blocks.set(key, { grade, c1: t.range.c1, c2: t.range.c2 });
        t.grade = grade;
    }
    const blockList = [...blocks.values()].sort((a, b) => a.c1 - b.c1);
    for (let i = 1; i < blockList.length; i++) {
        if (blockList[i].c1 <= blockList[i - 1].c2) unexpected({ kind: 'unexpected', what: 'two grade blocks overlap' });
    }
    /** Every cell's text, by row and column number. */
    /** @type {Map<number, Map<number, string>>} */ const grid = new Map();
    for (const [ref, c] of cal.cells) {
        const { col, row } = splitRef(ref);
        const n = colNumber(col);
        if (!dateOfRow.has(row) || !blockList.some(b => n >= b.c1 && n <= b.c2) || c.v === null) continue;
        if (typeof c.v !== 'string') { unexpected({ kind: 'unexpected', what: `calendar cell ${ref} holds a number, not a name or a state` }); continue; }
        if (!grid.has(row)) grid.set(row, new Map());
        /** @type {Map<number, string>} */ (grid.get(row)).set(n, c.v);
    }

    // Who wrote the threaded comments on the totals sheet — the clerks (§1). The last saver is
    // compared with them, so the file can say whether a clerk saved it last without naming anybody.
    const authors = new Set([...tot.threaded.values()].flat().map(t => wb.persons.get(t.personId ?? '')).filter(Boolean));
    const lastBy = wb.props.lastModifiedBy;
    const modified = savedInstant(wb.props.modified);
    return {
        calendarName: cal.name, totalsName: tot.name, dateOfRow, rows, lastDate, totals, blocks: blockList, grid,
        source: { firstDate: first, lastDate, clerksLastSaved: modified,
                  lastSavedByClerk: lastBy && authors.size ? authors.has(lastBy) : null },
    };
}

/**
 * The method: the workbook as read, the roster, and every answer given → the leave file, or the
 * questions that stand in its way.
 * @param {{ workbook: ReturnType<typeof readXlsx>, sha256: string, year: number, members: any[],
 *           previousMap?: any, answers?: Answers, today: string, script: string, appVersion: string }} args
 * @returns {{ file: any|null, questions: Question[], notes: string[] }}
 */
export function buildLeaveFile({ workbook, sha256, year, members, previousMap = null, answers = {}, today, script, appVersion }) {
    /** @type {Question[]} */ const questions = [];
    /** @type {string[]} */ const notes = [];
    const ask = (/** @type {Question} */ q) => { if (!questions.some(x => x.kind === q.kind && x.key === q.key && x.what === q.what)) questions.push(q); };
    const wbr = readLeaveWorkbook(workbook, year, ask, n => notes.push(n));
    if (!wbr) return { file: null, questions, notes };
    const known = new Set(members.map(m => m.name));
    /** @type {{ rows: Record<string, string|null>, cells: Record<string, string|null>, tags: Record<string, string|null> }} */
    const nameMap = { rows: {}, cells: {}, tags: {} };
    const prev = previousMap && typeof previousMap === 'object' ? previousMap : { rows: {}, cells: {}, tags: {} };

    /**
     * Resolve one spelling: this run's answer, then the previous file's map CHECKED against the
     * mechanical match, then the mechanical match (header: A carried name is CHECKED).
     *
     * An answer in this run's file is the session's word, taken as given. A carried value stands only
     * while the roster does not contradict it: a carried null ("not in the app") whose spelling now
     * matches anybody, or a carried name the match now gives to somebody else or to more than one
     * member, is asked again with what was carried. A carried name the match finds nobody for stands —
     * a misspelling answered by hand, or the other block's row of a person with a row in each block —
     * so an unchanged roster asks nothing.
     * @param {'rows'|'cells'|'tags'} kind @param {string} key @param {() => string[]} mechanical every match
     * @param {() => Question} question
     * @returns {string|null|undefined} a name, null (not in the app / not placeable), undefined (asked)
     */
    function resolveName(kind, key, mechanical, question) {
        // Once per spelling, though a cell's spelling is resolved again on every date it is written on.
        const noteOnce = (/** @type {string} */ n) => { if (!notes.includes(n)) notes.push(n); };
        const given = answers[kind];
        if (given && Object.hasOwn(given, key)) {
            const v = given[key];
            if (v === null || known.has(v)) { nameMap[kind][key] = v; return v; }
            noteOnce(`${kind} "${key}" was answered with a name no longer on the roster, so it is asked again`);
        }
        const hits = mechanical();
        const carried = prev[kind];
        if (carried && typeof carried === 'object' && Object.hasOwn(carried, key)) {
            const v = carried[key];
            if (v !== null && !known.has(v)) {
                noteOnce(`${kind} "${key}" was mapped to a name no longer on the roster, so it is asked again`);
            } else if (v === null ? hits.length === 0 : hits.length === 0 || (hits.length === 1 && hits[0] === v)) {
                nameMap[kind][key] = v;
                return v;
            } else {
                noteOnce(`${kind} "${key}" was ${v === null ? '"not in the app"' : v} in the previous file and now matches `
                    + `${hits.length === 1 ? hits[0] : `${hits.length} members`}, so it is asked again`);
                ask({ ...question(), carried: v });
                return undefined;
            }
        }
        if (hits.length === 1) { nameMap[kind][key] = hits[0]; return hits[0]; }
        ask(question());
        return undefined;
    }

    // ── Totals rows → people ──
    const cellText = (/** @type {number} */ row, /** @type {number} */ col) => wbr.grid.get(row)?.get(col) ?? null;
    /** @param {any} t the reader's own COUNTIF: case-insensitive, untrimmed, its own range — as Excel counts */
    const countif = t => {
        let n = 0;
        const want = t.criterion.toLowerCase();
        for (let r = t.range.r1; r <= t.range.r2; r++) for (let c = t.range.c1; c <= t.range.c2; c++) {
            if (cellText(r, c)?.toLowerCase() === want) n++;
        }
        return n;
    };
    /** @type {Map<string, any[]>} app name → its rows */ const rowsOf = new Map();
    /** @type {Map<string, string>} criterion (lower) → app name, for the rows that count somebody */
    const criterionName = new Map();
    for (const t of wbr.totals) {
        if (!t.grade) continue;
        if (countif(t) !== t.printed.used) {
            ask({ kind: 'unexpected', what: `totals row ${t.row}: this reader counts ${countif(t)} where the sheet says ${t.printed.used}` });
            continue;
        }
        if (t.otherComments) notes.push(`totals row ${t.row} has a comment outside column E (read by hand: it is not part of the file)`);
        if (/[*?~]/.test(t.criterion) || /^[=<>]/.test(t.criterion)) { ask({ kind: 'unexpected', what: `totals row ${t.row} counts a pattern, not a name` }); continue; }
        const isName = !!sheetParts(t.criterion);
        if (!isName) {
            // A relabelled row whose criterion was overtyped — measured once, counting nothing. It is
            // left out in silence only while its column E says nothing either: a comment there may
            // date somebody's leave, and only a person reading it can say whose, or that it is nobody's.
            if (t.printed.used === 0 && t.printed.columnE === 0) {
                const key = `${t.row}|${normaliseKey(t.criterion)}`;
                if (!t.eEntries.some((/** @type {string} */ e) => e.trim())) notes.push(`totals row ${t.row} counts no name and nothing (left out)`);
                else if (answers.unnamedRows && Object.hasOwn(answers.unnamedRows, key) && answers.unnamedRows[key] === null) {
                    notes.push(`totals row ${t.row} counts no name and nothing, and its column-E comment was read by hand (left out)`);
                } else ask({ kind: 'unnamed-row', key, row: t.row, spelt: t.label, entries: t.eEntries });
                continue;
            }
            ask({ kind: 'unexpected', what: `totals row ${t.row} counts something that is not a name` });
            continue;
        }
        if (sheetParts(t.label) && normaliseKey(t.label) !== normaliseKey(t.criterion)) notes.push(`totals row ${t.row}: column B and the count name different spellings; the count's is used`);
        const key = normaliseKey(t.criterion);
        // One key for every row with this spelling, in any block, so one answer covers them all; the
        // question lists them, so a spelling that is two people in two blocks shows as such.
        const sharing = wbr.totals.filter(o => o.grade && normaliseKey(o.criterion) === key);
        const name = resolveName('rows', key, () => mechanicalHits(sheetParts(t.criterion), members, t.grade), () => ({
            kind: 'row-name', key, spelt: t.criterion, row: t.row, grade: t.grade,
            ...(sharing.length > 1 ? { rows: sharing.map(o => ({ row: o.row, grade: o.grade, printed: o.printed })) } : {}),
            suggestions: suggestions(/** @type {any} */ (sheetParts(t.criterion)).surname, members) }));
        if (name === undefined) continue;
        t.name = name;
        if (name === null) { t.notInApp = true; continue; }
        criterionName.set(key, name);
        rowsOf.set(name, [...(rowsOf.get(name) ?? []), t]);
    }

    // ── Which of a person's rows is theirs (§8 defect 1) ──
    /** @type {Map<string, any>} */ const usedOf = new Map();
    // One row twice: the same figures, grade, count and block — and the same column-E comment. Two
    // rows that agree on every figure can still date different days in their comments, and settling
    // them as identical dropped the second row's dates; that is a person's call.
    const same = (/** @type {any} */ a, /** @type {any} */ b) => JSON.stringify(a.printed) === JSON.stringify(b.printed)
        && a.grade === b.grade && normaliseKey(a.criterion) === normaliseKey(b.criterion)
        && a.range.c1 === b.range.c1 && a.range.c2 === b.range.c2
        && JSON.stringify(a.eEntries.map(normaliseKey)) === JSON.stringify(b.eEntries.map(normaliseKey));
    /**
     * The column-E dates a row's comment writes, each as every reading it has inside the sheet — a
     * joiner's start date left out (it is not leave) — or null when the comment holds a date the
     * method cannot read at all (a shape DATE_TOKEN does not know, or "start" in a phrase about leave).
     * @param {any} row @returns {string[][]|null}
     */
    const eDateReadings = row => {
        /** @type {string[][]} */ const out = [];
        for (const text of row.eEntries) {
            if (namesUnreadDate(text) || LEAVE_START.test(text)) return null;
            const tokens = [...text.matchAll(DATE_TOKEN)];
            const start = /\bstart/i.exec(text);
            const startDate = start ? tokens.find(tk => (tk.index ?? 0) > start.index) : undefined;
            for (const tk of tokens) if (tk !== startDate) out.push(tokenCandidates(tk, year, wbr.source.firstDate, wbr.lastDate));
        }
        return out;
    };
    /**
     * Would settling `stale` as an abandoned copy of `used` lose a day? It would unless every date its
     * column E writes is also written on the used row — the same readings, or a narrower one (`02/01/2026`
     * beside `02/01`). Measured on the 6 Nov copy: the stale CEA row's `02/01` and `03/01` are both on
     * the live CES row's comment, and that pair settles; a stale row dating a day the used row does not
     * once dropped it with exit 0.
     * @param {any} stale @param {any} used
     */
    const staleLoses = (stale, used) => {
        const mine = eDateReadings(stale);
        if (mine === null) return true;
        if (!mine.length) return false;
        const theirs = eDateReadings(used) ?? [];
        return !mine.every(c => theirs.some(u => c.every(iso => u.includes(iso))));
    };
    for (const [name, list] of rowsOf) {
        if (list.length === 1) { usedOf.set(name, list[0]); continue; }
        /** @type {any} */ let used;
        /** @type {string} */ let why = 'duplicate-chosen';
        const live = list.filter(r => r.printed.used > 0);
        const own = memberGrade(members.find(m => m.name === name));
        if (list.every(r => same(r, list[0]))) { used = list[0]; why = 'duplicate-identical'; }
        // A row per grade, one of them in use: the others abandoned when the person moved grade (§8
        // defect 1) — settled by rule only when the live row is in the member's own block and the
        // stale rows lose nothing by it. Their printed figures stay in `sheetRows` either way.
        else if (new Set(list.map(r => r.grade)).size === list.length && live.length === 1
            && (own === null || live[0].grade === own) && !list.some(r => r !== live[0] && staleLoses(r, live[0]))) {
            used = live[0]; why = 'duplicate-stale';
        } else if (list.every(r => r.grade === list[0].grade && normaliseKey(r.criterion) === normaliseKey(list[0].criterion)
            && r.printed.used === list[0].printed.used && r.printed.allowance === list[0].printed.allowance
            && r.printed.carriedForward === list[0].printed.carriedForward)
            && list.filter(r => r.printed.columnE > 0).length === 1
            && list.filter(r => r.printed.columnE === 0).every(r => r.eEntries.length === 0)) {
            used = list.find(r => r.printed.columnE > 0); why = 'duplicate-missing-column-e';
        } else {
            const chosen = answers.duplicates && Object.hasOwn(answers.duplicates, name) ? answers.duplicates[name] : undefined;
            used = list.find(r => r.row === chosen) ?? null;
            if (!used) {
                if (chosen !== undefined) notes.push(`the answer for "${name}" is not one of their rows, so it is asked again`);
                ask({ kind: 'duplicate-rows', key: name, rows: list.map(r => ({ row: r.row, grade: r.grade, printed: r.printed })) });
                continue;
            }
        }
        usedOf.set(name, used);
        for (const r of list) if (r !== used) r.why = why;
    }

    // ── The grid, cell by cell ──
    /** @type {Map<string, Map<string, any>>} name → date → day */ const daysOf = new Map();
    const addDay = (/** @type {string} */ name, /** @type {any} */ day) => {
        const m = daysOf.get(name) ?? new Map();
        if (m.has(day.date)) {
            // Twice on one date: the sheet counts both, the app can hold one (§4's SET check).
            ask({ kind: 'unexpected', what: `a person is in the grid twice on ${day.date}` });
            return;
        }
        m.set(day.date, day);
        daysOf.set(name, m);
    };
    /** @type {Map<string, string>} `row:col` → who holds that slot, for the slot-column rule */
    const holder = new Map();
    /** @type {Array<{ date: string, row: number, col: number, grade: string, key: string }>} */ const tags = [];
    /** @type {Map<string, string>} grid-only person → block */ const gradeOf = new Map();
    /** @type {Map<string, string>} a cell's key → its spelling as written, for `notImported` */ const speltOf = new Map();
    for (const row of wbr.rows) {
        const date = /** @type {string} */ (wbr.dateOfRow.get(row));
        const sunday = isSundayIso(date);
        for (const b of wbr.blocks) for (let col = b.c1; col <= b.c2; col++) {
            const text = cellText(row, col);
            if (text === null || !text.trim() || STATE_ONLY.test(text)) continue;
            // Counted by the sheet: a row of this block counts this exact text (COUNTIF's own match).
            const counting = wbr.totals.filter(t => t.grade === b.grade && t.range.c1 === b.c1
                && row >= t.range.r1 && row <= t.range.r2 && t.criterion.toLowerCase() === text.toLowerCase() && sheetParts(t.criterion));
            if (counting.length) {
                const names = new Set(counting.map(t => t.name));
                if (names.size !== 1) { ask({ kind: 'unexpected', what: `one spelling is counted for two people on ${date}` }); continue; }
                const name = /** @type {string|null|undefined} */ ([...names][0]);
                if (!name) continue;   // a person not in the app (asked, or answered as not in it)
                holder.set(`${row}:${col}`, name);
                const used = usedOf.get(name);
                // No used row yet: which of their rows it is, is a duplicate-rows question already asked.
                // Calling the day "unexpected" would turn a question into a refusal (exit 3, not 2).
                if (!used) continue;
                if (!counting.includes(used)) { ask({ kind: 'unexpected', what: `${date}: a day counted only by a row that is not used` }); continue; }
                if (isChristmasIso(date)) { ask({ kind: 'unexpected', what: `a name on ${date}, which the sheet should mark closed` }); continue; }
                addDay(name, { name, date, kind: sunday ? 'sunday-counted' : 'leave', foundIn: 'grid', countedBySheet: true });
                continue;
            }
            const stripped = text.replace(STATE_TOKEN, ' ');
            if (stripped !== text && stripped.trim()) {
                if (!sunday) { ask({ kind: 'unexpected', what: `a tagged cell on ${date}, which is not a Sunday` }); continue; }
                tags.push({ date, row, col, grade: b.grade, key: normaliseKey(stripped) });
                continue;
            }
            // A name nobody's count finds: their name spelt another way, or somebody with no row.
            const trimmed = normaliseKey(text);
            const key = `${b.grade}|${trimmed}`;
            speltOf.set(key, text.trim());
            const near = wbr.totals.find(t => t.grade === b.grade && t.name && normaliseKey(t.criterion) === trimmed);
            const name = near ? /** @type {string} */ (near.name) : resolveName('cells', key, () => mechanicalHits(sheetParts(text), members, b.grade), () => ({
                kind: 'cell-name', key, spelt: text.trim(), grade: b.grade, dates: [date],
                suggestions: suggestions(sheetParts(text)?.surname ?? trimmed, members) }));
            if (near) nameMap.cells[key] = near.name;
            if (name === undefined) {
                const q = questions.find(x => x.kind === 'cell-name' && x.key === key);
                if (q && Array.isArray(q.dates) && !q.dates.includes(date)) q.dates.push(date);
                continue;
            }
            if (name === null) continue;
            holder.set(`${row}:${col}`, name);
            // Uncounted, on a Sunday or a closed day: not leave the app could hold (SUNDAY_FORBIDDEN_TYPES,
            // §4), and no figure on the sheet counts it — so nothing depends on it and it is left out,
            // where it once stopped the whole file with no answer that could let it through.
            if (sunday || isChristmasIso(date)) { notes.push(`${date}: a name no row counts, on a ${sunday ? 'Sunday' : 'closed day'} in the ${b.grade} columns (not leave, left out)`); continue; }
            const used = usedOf.get(name);
            if (used && used.grade !== b.grade) { ask({ kind: 'unexpected', what: `${date}: a person's days in another grade's columns` }); continue; }
            if (!used && rowsOf.has(name)) continue;   // their row is still being asked about
            if (!used) {
                if (gradeOf.has(name) && gradeOf.get(name) !== b.grade) { ask({ kind: 'unexpected', what: 'a person with no row has days in two grades' }); continue; }
                gradeOf.set(name, b.grade);
            }
            addDay(name, { name, date, kind: 'leave', foundIn: used ? 'grid-misspelt' : 'no-totals-row', countedBySheet: false });
        }
    }

    // ── Sunday tags (§4, §7): never leave, and placed by their TEXT or a recorded answer only ──
    // The slot column — whoever holds the days either side — was §7's way of reading a tag that
    // cannot be read, and it is weaker than it looks. Measured on the 6 Nov copy (14 Nov 2026),
    // against the tags whose text CAN be read: the same person on both sides agrees with the text 20
    // times in 21; a person on one side only, 51 times in 83. So it is offered to the session as
    // evidence in the question, never used to answer it.
    let unplacedSundayTags = 0;
    for (const t of tags) {
        const key = `${t.grade}|${t.key}`;
        const neighbours = { date: t.date, saturday: holder.get(`${t.row - 1}:${t.col}`) ?? null, monday: holder.get(`${t.row + 1}:${t.col}`) ?? null };
        // Two words carry their initial, so they are matched as a row's name is, within the block the
        // tag sits in. ONE word is never matched: it may be a first name (§7 measured three, across
        // eight tags), and read as a surname `N/A Grace` went to a member whose surname is Grace. It is
        // asked, and the answer is carried, so the next copy does not ask it again.
        const parts = tagParts(t.key);
        const name = resolveName('tags', key, () => mechanicalHits(parts, members, t.grade), () => ({
            kind: 'tag-name', key, grade: t.grade, dates: [], neighbours: [], suggestions: suggestions(parts?.surname ?? t.key, members) }));
        if (name === undefined) {
            const q = questions.find(x => x.kind === 'tag-name' && x.key === key);
            if (q && Array.isArray(q.dates) && Array.isArray(q.neighbours)) { q.dates.push(t.date); q.neighbours.push(neighbours); }
            continue;
        }
        if (name === null) { unplacedSundayTags++; continue; }
        const existing = daysOf.get(name)?.get(t.date);
        if (existing) {
            notes.push(`${t.date}: ${existing.kind === 'sunday-tag' ? 'a second Sunday tag' : 'a Sunday tag beside a counted name'} for the same person (kept once)`);
            continue;
        }
        if (!gradeOf.has(name) && !usedOf.has(name)) gradeOf.set(name, t.grade);
        addDay(name, { name, date: t.date, kind: 'sunday-tag', foundIn: 'grid-tag', countedBySheet: false });
    }

    // ── Column E: the over-quota days and what else the column carries (§5) ──
    /** @type {Map<string, any>} */ const columnEOf = new Map();
    const inSheet = (/** @type {unknown} */ d) => isRealIsoDate(d) && d >= wbr.source.firstDate && d <= wbr.lastDate;
    for (const [name, used] of usedOf) {
        // Not imported — a leaver, a manager, anybody the app has no allowance for: their days are
        // discarded and their column E is no part of the file, so a comment the method cannot read (a
        // mistyped year, say) is no reason to stop it. Read, it once stopped the file with nothing a
        // person could answer to let it through.
        const reason = leaveRecordability(members.find(m => m.name === name), year);
        if (reason) {
            if (used.printed.columnE || used.eEntries.some((/** @type {string} */ t) => t.trim())) {
                notes.push(`totals row ${used.row}: not imported (${reason}), so its column E is not read`);
            }
            continue;
        }
        const grid = daysOf.get(name) ?? new Map();
        /** @type {string[]} */ const dated = [];
        // `words`: an entry with no date at all (a lump's explanation, or a reply such as CANCELLED);
        // `wordy`: an entry with dates AND words besides them (`10/04 NOT TAKEN`).
        let joiner = false, words = false, wordy = false, mixed = false, unread = false;
        /** @type {Array<{ token: string, candidates: string[], entry?: string }>} */ const found = [];
        for (const text of used.eEntries) {
            // An entry the method cannot read is asked about, and the answer — the days of leave it
            // names, read by hand — is used in place of any reading. Its key carries the entry's own
            // text, so a changed comment on a later copy is asked again, never answered by an old reply.
            const entryKey = `${used.row}|${normaliseKey(text)}`;
            const why = namesUnreadDate(text) ? 'a date in a shape the method does not read'
                : LEAVE_START.test(text) ? '"start" in a phrase about leave, which is not a joiner\'s start date' : null;
            if (answers.entryDates && Object.hasOwn(answers.entryDates, entryKey)) {
                const given = answers.entryDates[entryKey];
                if (Array.isArray(given) && given.every(d => inSheet(d) && !isSundayIso(d) && !isChristmasIso(d))) {
                    for (const iso of new Set(given)) found.push({ token: iso, candidates: [iso] });
                    continue;
                }
                notes.push(`totals row ${used.row}: the answer for a comment entry is not a list of days the sheet could hold as leave, so it is asked again`);
                ask({ kind: 'comment-entry', key: entryKey, row: used.row, entry: text.trim(), why: why ?? 'the answer given for it could not be used' });
                unread = true;
                continue;
            }
            if (why) { ask({ kind: 'comment-entry', key: entryKey, row: used.row, entry: text.trim(), why }); unread = true; continue; }
            const tokens = [...text.matchAll(DATE_TOKEN)];
            const start = /\bstart/i.exec(text);
            if (start) {
                // A joiner's start date is not leave (§5): it is the first date after the word. Any
                // other date in the same entry — `STARTED 05/10, A/L 24/12` — may be leave or may not,
                // and dropping it with the start date lost a day; only a person reading it can say.
                joiner = true;
                const startDate = tokens.find(tk => (tk.index ?? 0) > start.index);
                if (tokens.some(tk => tk !== startDate)) {
                    ask({ kind: 'unexpected', what: `totals row ${used.row}: one comment entry gives a start date and another date` });
                    mixed = true;
                }
                continue;
            }
            if (!tokens.length) { if (text.trim()) words = true; continue; }
            if (hasWords(text)) wordy = true;
            for (const tk of tokens) found.push({ token: tk[0], candidates: tokenCandidates(tk, year, wbr.source.firstDate, wbr.lastDate), entry: text });
        }
        if (mixed || unread) continue;
        // A date the method reads but no leave can be — outside the sheet (a year mistyped: `24/12/25`
        // on the 2026 sheet), on a Sunday, on 25 or 26 December — is the entry's to read by hand, as
        // an unreadable one is. It once stopped the whole file with nothing a person could answer.
        /** @param {{ entry?: string|null }} f @param {string} why */
        const readByHand = (f, why) => {
            const entry = f.entry ?? '';
            ask({ kind: 'comment-entry', key: `${used.row}|${normaliseKey(entry)}`, row: used.row, entry: entry.trim(), why });
        };
        // A DD/MM in the first days of January can be this January or next (the grid runs into it,
        // §2). It is settled only by a date BESIDE it: exactly one of its readings within three days of
        // another date in the thread that has one reading of its own. `02/01 03/01` (the next day) and
        // `02/01 05/01` (across a weekend) settle; `24/12 02/01` does not, though it took this year's
        // January once — the likelier reading is one block over Christmas into next, so it is asked.
        const anchors = found.filter(f => f.candidates.length === 1).map(f => Date.parse(f.candidates[0]));
        const beside = (/** @type {string} */ iso) => anchors.some(a => Math.abs(Date.parse(iso) - a) <= 3 * 86_400_000);
        let pending = false;   // a date of this thread is asked about, so its dates are not all known yet
        for (const f of found) {
            const qKey = `${used.row}|${f.token}`;
            let iso = f.candidates.length === 1 ? f.candidates[0] : undefined;
            if (f.candidates.length > 1) {
                // An answer must be one of the token's own readings: `2026-03-16` for `02/01` was
                // written as given, a day nobody's comment named.
                const given = answers.commentDates && Object.hasOwn(answers.commentDates, qKey) ? answers.commentDates[qKey] : undefined;
                if (given !== undefined && !f.candidates.includes(given)) {
                    notes.push(`totals row ${used.row}: the answer for ${f.token} is not one of its readings, so it is asked again`);
                } else {
                    const near = f.candidates.filter(beside);
                    iso = given ?? (near.length === 1 ? near[0] : undefined);
                }
            }
            if (!iso) {
                if (f.candidates.length) ask({ kind: 'comment-date', key: qKey, row: used.row, token: f.token, candidates: f.candidates });
                else readByHand(f, `a date outside the sheet's own dates (${f.token})`);
                pending = true;
                continue;
            }
            if (grid.has(iso) || dated.includes(iso)) continue;   // counted once, from the grid
            if (isSundayIso(iso) || isChristmasIso(iso)) { readByHand(f, `a date no leave can be on (${iso})`); pending = true; continue; }
            dated.push(iso);
        }
        // What column E then says waits for those answers: asked now, a blank count's question would be
        // keyed on dates that are not all there, and a sum would be judged on half a thread.
        if (pending) continue;
        const e = used.printed.columnE;
        if (e === 0 && dated.length) {
            // Defect 7: dated in the comment, the count left blank — real leave the total misses. But
            // only while the thread is the dates alone: words beside them (`10/04 NOT TAKEN`, a reply
            // `CANCELLED`) may say a day was not taken, and read as leave the day became one to add.
            // Then which of the dates are leave is asked; `A/L` beside a date is not a word here.
            let leave = dated;
            if (words || wordy) {
                const key = `${used.row}|${[...dated].sort().join(' ')}`;
                const given = answers.uncounted && Object.hasOwn(answers.uncounted, key) ? answers.uncounted[key] : undefined;
                if (!Array.isArray(given) || !given.every(d => dated.includes(d))) {
                    if (given !== undefined) notes.push(`totals row ${used.row}: the answer for its dates is not drawn from them, so it is asked again`);
                    ask({ kind: 'uncounted-dates', key, row: used.row, entries: used.eEntries, dates: [...dated].sort() });
                    continue;
                }
                leave = given;
                for (const iso of dated) if (!leave.includes(iso)) notes.push(`totals row ${used.row}: ${iso}, dated beside a blank count, was answered as not leave (left out)`);
            }
            for (const iso of dated) if (leave.includes(iso)) addDay(name, { name, date: iso, kind: 'leave', foundIn: 'column-e-uncounted', countedBySheet: false });
            columnEOf.set(name, { datedDays: 0, joinerReduction: 0, lump: 0, unexplained: 0 });
            continue;
        }
        if (dated.length > e) { ask({ kind: 'unexpected', what: `totals row ${used.row}: the comment dates more days than column E counts` }); continue; }
        for (const iso of dated) addDay(name, { name, date: iso, kind: 'leave', foundIn: 'column-e', countedBySheet: true });
        const rest = e - dated.length;
        columnEOf.set(name, { datedDays: dated.length, joinerReduction: joiner ? rest : 0,
                              lump: !joiner && words ? rest : 0, unexplained: !joiner && !words ? rest : 0 });
    }

    if (questions.length) return { file: null, questions, notes };

    // ── Assemble ──
    /** @type {any[]} */ const people = [];
    /** @type {Map<string, string>} */ const notImported = new Map();
    for (const t of wbr.totals) if (t.notInApp) notImported.set(t.criterion.trim(), 'not-in-app');
    for (const [key, v] of Object.entries(nameMap.cells)) if (v === null) notImported.set(speltOf.get(key) ?? key.split('|')[1], 'not-in-app');
    const everyone = new Set([...rowsOf.keys(), ...daysOf.keys()]);
    for (const name of [...everyone].sort()) {
        const member = members.find(m => m.name === name);
        const reason = leaveRecordability(member, year);
        if (reason) { notImported.set(name, reason); continue; }
        const rows = rowsOf.get(name) ?? [];
        const used = usedOf.get(name);
        const days = [...(daysOf.get(name)?.values() ?? [])];
        const misspelt = days.filter(d => d.foundIn === 'grid-misspelt').length;
        const blankE = days.filter(d => d.foundIn === 'column-e-uncounted').length;
        const sundays = days.filter(d => d.kind === 'sunday-counted').length;
        const grade = used ? used.grade : gradeOf.get(name);
        if (!grade) { ask({ kind: 'unexpected', what: 'a person with neither a row nor a block' }); continue; }
        people.push({
            name, grade,
            sheetRows: rows.map(r => ({ row: r.row, spelt: r.criterion.trim(), grade: r.grade, used: r === used,
                                        ...(r === used ? {} : { why: r.why ?? 'duplicate-chosen' }), printed: r.printed })),
            columnE: used ? columnEOf.get(name) : null,
            corrected: used ? { remaining: used.printed.remaining - misspelt - blankE + sundays,
                                because: [misspelt && 'grid-misspelt', blankE && 'column-e-blank', sundays && 'sunday-counted'].filter(Boolean) } : null,
        });
    }
    if (questions.length) return { file: null, questions, notes };
    const listed = new Set([...people.map(p => p.name), ...notImported.keys()]);
    const days = people.flatMap(p => [...(daysOf.get(p.name)?.values() ?? [])]
        .map(d => (d.kind === 'leave' && d.date.startsWith(`${year + 1}-`) ? { ...d, leaveYear: year } : d)))
        .sort((a, b) => byCodeUnit(a.name, b.name) || byCodeUnit(a.date, b.date));
    const file = {
        format: LEAVE_FILE_FORMAT, version: LEAVE_FILE_VERSION, year,
        source: { sha256, ...wbr.source },
        made: { on: today, script, appVersion },
        nameMap,
        people,
        days,
        absentFromWorkbook: members.filter(m => !listed.has(m.name) && leaveRecordability(m, year) === null).map(m => m.name).sort(),
        notImported: [...notImported].map(([name, reason]) => ({ name, reason })).sort((a, b) => byCodeUnit(a.name, b.name)),
        unplacedSundayTags,
    };
    const refusals = validateLeaveFile(file);
    if (refusals.length) {
        for (const r of refusals) ask({ kind: 'unexpected', what: `the file the method made is refused: ${describeRefusal(r)}` });
        return { file: null, questions, notes };
    }
    return { file, questions, notes };
}

// ── The command line ────────────────────────────────────────────────────────────────────────────

/** Does a path climb with `..` anywhere in it? @param {string} path */
const climbs = path => path.split(/[\\/]+/).includes('..');

/**
 * Where a write to `path` lands: the REAL directory it is written in, and the file there. A file that
 * is a symlink is followed, existing or not — writing to it writes there — and a folder that does not
 * exist yet is judged by the nearest one that does.
 *
 * null for a path with `..` in it, the given one or a link's own text: `resolve()` takes `..` away
 * before any symlink is followed, so `<a folder that links into a checkout>/../x` was judged where it
 * reads and written where it leads. And null for a loop of links.
 * @param {string} path @param {number} [hops] symlinks followed so far
 * @returns {{ dir: string, file: string }|null}
 */
function writeTarget(path, hops = 0) {
    if (climbs(path)) return null;
    const abs = resolve(path);
    if (lstatSync(abs, { throwIfNoEntry: false })?.isSymbolicLink()) {
        if (hops >= 20) return null;
        const link = readlinkSync(abs);
        // The link's text, joined but NOT normalised, so a `..` in it is seen and refused.
        return writeTarget(isAbsolute(link) ? link : `${dirname(abs)}${sep}${link}`, hops + 1);
    }
    let dir = dirname(abs);
    while (!existsSync(dir) && dirname(dir) !== dir) dir = dirname(dir);
    const real = realpathSync.native(dir);
    return { dir: real, file: join(real, relative(dir, abs)) };
}

/**
 * Is a real, existing directory inside a git work tree — this checkout, another one, or a worktree
 * beside it? Asked of git from the directory alone: every `GIT_*` variable is left out (a GIT_DIR set
 * by a hook would answer for the wrong repository), discovery crosses filesystems, and the answer is
 * read in git's own words. Anything git says other than "not a git repository" is a yes.
 * @param {string} dir
 * @returns {boolean|null} null when git cannot be run here — then only this repository can be judged
 */
function insideGitWorkTree(dir) {
    /** @type {Record<string, string>} */ const env = {};
    for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('GIT_') && v !== undefined) env[k] = v;
    const r = spawnSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], { encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'], env: { ...env, LC_ALL: 'C', GIT_DISCOVERY_ACROSS_FILESYSTEM: '1' } });
    if (r.error) return /** @type {any} */ (r.error).code === 'ENOENT' ? null : true;
    if (r.status === 0) return true;
    return !/not a git repository/i.test(r.stderr ?? '');
}

/**
 * May the script write to `path`? The leave file must never land where git could pick it up: not in
 * this repository, not in any other checkout or worktree of it (the Pages mirror serves whatever is
 * committed from any of them), and not by a path with `..` in it. A FILE that is a symlink is judged
 * by where it points, existing or not, and a name that merely begins with two dots (`..x.leave.json`)
 * is inside, not above. With no git to ask, only this repository is judged.
 *
 * And an existing file with MORE THAN ONE NAME (a hard link) is refused wherever it is: writing to
 * one name writes the file every other name shares, and one of those may be inside a checkout —
 * `ln <a tracked file> /tmp/x.leave.json` passed, because nothing here can say where a file's other
 * names are without searching every disk for them.
 * @param {string} path
 * @returns {boolean}
 */
export function isOutsideRepo(path) {
    const target = writeTarget(path);
    if (!target) return false;
    const existing = statSync(target.file, { throwIfNoEntry: false });
    if (existing && !existing.isDirectory() && existing.nlink > 1) return false;
    const rel = relative(realpathSync.native(REPO), target.file);
    if (!(rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel))) return false;
    return insideGitWorkTree(target.dir) !== true;
}

/**
 * The one file a path names, so two arguments can be told apart: an existing file by its real path
 * and its device and inode (a hard link is the same file), one not made yet by where it will land.
 * @param {string} path
 */
function fileOf(path) {
    const st = statSync(path, { throwIfNoEntry: false });
    if (st) return { file: realpathSync.native(path), inode: `${st.dev}:${st.ino}` };
    return { file: writeTarget(path)?.file ?? resolve(path), inode: null };
}

/** @param {string[]} argv */
function parseArgs(argv) {
    /** @type {Record<string, string|boolean>} */ const out = {};
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (!a.startsWith('--')) throw new Error(`unexpected argument ${a}`);
        const k = a.slice(2);
        if (k === 'first-run') out[k] = true;
        else { const v = argv[++i]; if (v === undefined) throw new Error(`--${k} needs a value`); out[k] = v; }
    }
    return out;
}

/** @param {string[]} argv @returns {Promise<number>} the exit code */
export async function main(argv) {
    const args = parseArgs(argv);
    const need = (/** @type {string} */ k) => { if (typeof args[k] !== 'string') throw new Error(`--${k} is required`); return /** @type {string} */ (args[k]); };
    const workbookPath = need('workbook'), out = need('out');
    const year = Number(need('year'));
    if (!Number.isInteger(year)) throw new Error('--year must be a year');
    if (!out.endsWith('.leave.json')) throw new Error('--out must end .leave.json, which .gitignore excludes');
    if (typeof args.csv === 'string' && !args.csv.endsWith('.csv')) throw new Error('--csv must end .csv, which .gitignore excludes');
    // An output must not be an input, or the other output: `--csv <the workbook>` once wrote a CSV
    // header over the workbook and exited 0. Every pair is checked before anything is read or written,
    // and before where an output lands: a hard link to the workbook is refused as the workbook, by name,
    // rather than as a file with another name somewhere (`isOutsideRepo`).
    /** @type {Array<[string, string]>} */ const named = [];
    for (const k of ['workbook', 'previous', 'answers', 'out', 'csv']) if (typeof args[k] === 'string') named.push([k, /** @type {string} */ (args[k])]);
    const files = named.map(([, p]) => fileOf(p));
    for (let i = 0; i < named.length; i++) for (let j = i + 1; j < named.length; j++) {
        if (files[i].file === files[j].file || (files[i].inode !== null && files[i].inode === files[j].inode)) {
            throw new Error(`--${named[i][0]} and --${named[j][0]} name the same file; refusing before anything is written`);
        }
    }
    for (const p of [out, args.csv]) {
        if (typeof p === 'string' && !isOutsideRepo(p)) {
            throw new Error(`refusing to write inside the repository or any git checkout, by a path with .. in it, `
                + `or over a file with another name (a hard link): ${p}`);
        }
    }
    if (!args.previous && !args['first-run']) throw new Error('give --previous <last.leave.json>, or --first-run to be asked about every match');
    const today = typeof args.today === 'string' ? args.today : new Date().toISOString().slice(0, 10);
    if (!isRealIsoDate(today)) throw new Error('--today must be YYYY-MM-DD');

    let previousMap = null;
    if (typeof args.previous === 'string') {
        const read = await readLeaveFile(readFileSync(args.previous, 'utf8'));
        if (!read.ok) throw new Error(`the previous leave file is refused: ${read.refusals.map(describeRefusal).join(' ')}`);
        previousMap = read.file.nameMap;
    }
    // A byte-order mark is stripped, as the card's file reader does for the leave file itself.
    const answers = typeof args.answers === 'string' ? JSON.parse(readFileSync(args.answers, 'utf8').replace(/^\uFEFF/, '')) : {};
    if (!answers || typeof answers !== 'object' || Array.isArray(answers)) throw new Error('the answers file must hold one JSON object');
    const bytes = readFileSync(workbookPath);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const { teamMembers, APP_VERSION } = await import('../roster-data.js');
    let script = 'unknown';
    try { script = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim(); } catch { /* not a checkout */ }

    const { file, questions, notes } = buildLeaveFile({ workbook: readXlsx(bytes), sha256, year, members: teamMembers,
        previousMap, answers, today, script, appVersion: APP_VERSION });
    for (const n of notes) process.stderr.write(`note: ${n}\n`);
    if (!file) {
        process.stdout.write(JSON.stringify({ questions }, null, 1) + '\n');
        return questions.some(q => q.kind === 'unexpected') ? 3 : 2;
    }
    const sealed = await sealLeaveFile(file);
    writeFileSync(out, JSON.stringify(sealed, null, 1) + '\n');
    if (typeof args.csv === 'string') {
        const rows = [['name', 'date', 'kind', 'foundIn', 'countedBySheet', 'leaveYear'],
            ...sealed.days.map((/** @type {any} */ d) => [d.name, d.date, d.kind, d.foundIn, String(d.countedBySheet), d.leaveYear ?? ''])];
        writeFileSync(args.csv, rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n') + '\n');
    }
    const kinds = /** @type {Record<string, number>} */ ({});
    for (const d of sealed.days) kinds[`${d.kind}/${d.foundIn}`] = (kinds[`${d.kind}/${d.foundIn}`] ?? 0) + 1;
    process.stdout.write(JSON.stringify({ written: out, digest: sealed.digest, people: sealed.people.length,
        notImported: sealed.notImported.length, absentFromWorkbook: sealed.absentFromWorkbook.length,
        unplacedSundayTags: sealed.unplacedSundayTags, days: kinds }, null, 1) + '\n');
    return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main(process.argv.slice(2)).then(code => { process.exitCode = code; }, err => {
        process.stderr.write(`make-leave-file: ${err instanceof Error ? err.message : String(err)}\n`);
        process.exitCode = 1;
    });
}
