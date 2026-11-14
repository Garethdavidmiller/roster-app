#!/usr/bin/env node
// @ts-check
/**
 * make-leave-file.mjs — STAGE 1 of the annual leave uploader: the clerks' workbook in, a leave file
 * out (docs/AL_UPLOADER_PLAN.md §3). Run in a SESSION, never by the app, and never inside CI on a
 * real workbook: the workbook and the file both name colleagues against their leave.
 *
 *   node scripts/make-leave-file.mjs --workbook <book.xlsx> --year 2026 \
 *        (--previous <last.leave.json> | --first-run) [--answers <answers.json>] \
 *        --out <outside-the-repo>/leave-2026-as-of-<date>.leave.json [--csv <outside>/days.csv] [--today YYYY-MM-DD]
 *
 * Exit 0: the file is written, sealed, and has passed the app's own validator. Exit 2: questions
 * only a person can answer are printed as JSON — answer them in an answers file and run again.
 * Exit 3: the workbook is not shaped the way the method knows; read docs/AL_WORKBOOK.md before
 * changing anything here. Exit 1: a usage or input error.
 *
 * ── THE METHOD IS docs/AL_WORKBOOK.md, AND THIS FOLLOWS IT ─────────────────────────────────────
 *
 *   · The calendar sheet is chosen by its FIRST DATE (`<year>-01-01` in B2) and a Marylebone name,
 *     never by its name alone — the 2021 sheet's name looks more canonical than the live one (§2).
 *     The totals sheet is the one whose COUNTIF formulas name that calendar.
 *   · A totals row is a row whose Used is ONE COUNTIF of the calendar, and what it COUNTS is the
 *     formula's criterion. A row relabelled "Vacancy" still counts its leaver's days (measured,
 *     14 Nov 2026), and the reader's own count must equal the sheet's cached Used on every row, or
 *     nothing is written. A row that looks like a person's (a role, a `Surname . I`, a figure or a
 *     comment in column E) whose Used is anything else stops the file: skipping it lost the row's
 *     column E, the §0 failure, with exit 0.
 *   · Grade blocks come from the COUNTIF ranges, so a name is only ever counted in its own block (§3).
 *   · Column E is read with its threaded comment, scoped to the totals sheet through its own
 *     relationships, replies included; where only Excel's legacy copy of a thread survives, it is split
 *     back into the thread's entries. `D/M` and `DD.MM` are both dates, the full stop only between two
 *     digits each side (`1.5 DAYS` is not 1 May). A START entry's first date after the word is the
 *     start date and is dropped; another date in that entry is asked about. A date the grid already
 *     holds is counted once (§5, §6).
 *   · Sunday tags are never leave. A tag is placed by its TEXT, or by an answer; its slot column —
 *     whoever holds the days either side — is offered as evidence and never decides (measured: one
 *     neighbour agrees with a readable tag 51 times in 83, §7). A surname alone is matched only within
 *     its own grade block.
 *   · Everything is ordered by code unit, never by locale, so the seal does not depend on the session.
 *   · A misspelt name in the grid is still that person's leave (owner, 14 Nov 2026), recorded as not
 *     counted by the sheet, so the file says what the sheet's own total missed (§8 defect 9).
 *   · NEVER KEY ANYTHING BY NAME ALONE (§8 defect 6): rows are kept by row number, and a person with
 *     two rows has both listed, with which was used and why.
 *
 * ── IT ASKS, NEVER GUESSES ─────────────────────────────────────────────────────────────────────
 *
 * A name it cannot match mechanically (`Surname . I` against `I. Surname`), a duplicate row it
 * cannot settle by rule (rows with the same figures and different comments included), a comment date
 * that could be either January with no date beside it to settle it: each becomes a QUESTION, and
 * no file is written until it is answered. Every NAME answer and match goes into the file's
 * `nameMap`, and the NEXT run reads them from the previous file — so two sessions match the same names
 * from the same workbook (plan §3.4). The other answers (which duplicate row, which January) are keyed
 * by row and cell, which move between copies of the sheet, so they are not carried: a new copy asks
 * them again (leave-file-script.test.mjs pins it). The map is never committed: the exceptions in it are
 * personal.
 *
 * ── IT NEVER WRITES INSIDE THE REPOSITORY ──────────────────────────────────────────────────────
 *
 * The Pages mirror serves every committed file. `--out` and `--csv` are refused inside the
 * repository, and the leave file must end `.leave.json`, which .gitignore excludes besides.
 */
import { readFileSync, writeFileSync, realpathSync, existsSync, lstatSync, readlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, resolve, relative, isAbsolute, join, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readXlsx, serialToIso, splitRef, colNumber } from './xlsx-read.mjs';
import { LEAVE_FILE_FORMAT, LEAVE_FILE_VERSION, validateLeaveFile, sealLeaveFile, readLeaveFile, describeRefusal,
    isSundayIso, isChristmasIso, isRealIsoDate } from '../al-leave-file.js';
import { leaveRecordability } from '../al-leave-compare.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ── Names ───────────────────────────────────────────────────────────────────────────────────────

/** One spelling of a key: lower case, single spaces, nothing at either end. Dots are kept: `Smith . J` is the sheet's form. @param {string} s */
export const normaliseKey = s => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** `I. Surname` → its parts, lower case. @param {string} name */
function appParts(name) {
    const m = /^([A-Za-z])\.\s+(.+)$/.exec(name.trim());
    return m ? { initial: m[1].toLowerCase(), surname: m[2].toLowerCase() } : null;
}
/** `Surname . I` → its parts, lower case; anything else (a garbled criterion) is not a name. @param {string} s */
export function sheetParts(s) {
    const m = /^([A-Za-z][A-Za-z' -]*[A-Za-z])\s+\.\s+([A-Za-z])$/.exec(s.trim());
    return m ? { surname: m[1].toLowerCase(), initial: m[2].toLowerCase() } : null;
}
/** A Sunday tag's words, the state removed: `J Surname`, `J. Surname` or `Surname`. @param {string} key */
function tagParts(key) {
    const words = key.replace(/\./g, ' ').split(/\s+/).filter(Boolean);
    if (words.length >= 2 && words[0].length === 1) return { initial: words[0], surname: words.slice(1).join(' ') };
    if (words.length === 1) return { initial: null, surname: words[0] };
    return null;
}
/**
 * The one member whose initial and surname match, or null.
 * @param {{ initial: string|null, surname: string }|null} parts @param {any[]} members
 */
function mechanicalMatch(parts, members) {
    if (!parts) return null;
    const hits = members.filter(m => {
        const p = appParts(m.name);
        return p && p.surname === parts.surname && (parts.initial === null || p.initial === parts.initial);
    });
    return hits.length === 1 ? hits[0].name : null;
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
const COUNTIF = /^COUNTIF\(\s*'?([^'!]+)'?!\$?([A-Z]{1,3})\$?(\d+):\$?([A-Z]{1,3})\$?(\d+)\s*,\s*"((?:[^"]|"")*)"\s*\)$/i;
const ROLE_GRADE = /** @type {Record<string, string>} */ ({ CEA: 'CEA', BLCEA: 'CEA', CES: 'CES', DISP: 'DISP' });
/** The sheet's grade block for an app role. Management has none: a manager is never matched into one. */
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
 *             duplicates?: Record<string, number>, commentDates?: Record<string, string> }} Answers
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

    /**
     * Does a totals row look like a person's, whatever its Used holds? Then a Used the method cannot
     * read stops the file. Skipped, the row's grid days came out as "no totals row" and its column E
     * — the leave §0 is about — went with it, and the run still succeeded. Column E's text is the
     * header's, so only a FIGURE or a comment there marks a person.
     * @param {number} row
     */
    const personLike = row => {
        const e = val(`E${row}`);
        return Object.hasOwn(ROLE_GRADE, String(val(`A${row}`) ?? '').trim().toUpperCase())
            || !!sheetParts(String(val(`B${row}`) ?? '')) || typeof e === 'number'
            || tot.threaded.has(`E${row}`) || tot.notes.has(`E${row}`);
    };

    /** @type {any[]} */ const totals = [];
    for (const [ref, c] of tot.cells) {
        const { col, row } = splitRef(ref);
        if (col !== 'G') continue;
        if (!c.f && (c.v === null || (typeof c.v === 'string' && !c.v.trim()))) continue;   // nothing there
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
    const modified = wb.props.modified && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(wb.props.modified)
        ? `${wb.props.modified.slice(0, 19)}Z` : null;
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
     * Resolve one spelling: this run's answer, then the previous file's map, then the mechanical match.
     * @param {'rows'|'cells'|'tags'} kind @param {string} key @param {() => string|null} mechanical
     * @param {() => Question} question
     * @returns {string|null|undefined} a name, null (not in the app / not placeable), undefined (asked)
     */
    function resolveName(kind, key, mechanical, question) {
        for (const source of [answers[kind], prev[kind]]) {
            if (source && Object.prototype.hasOwnProperty.call(source, key)) {
                const v = source[key];
                if (v === null || known.has(v)) { nameMap[kind][key] = v; return v; }
                notes.push(`${kind} "${key}" was mapped to a name no longer on the roster, so it is asked again`);
            }
        }
        const m = mechanical();
        if (m) { nameMap[kind][key] = m; return m; }
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
            // A relabelled row whose criterion was overtyped — measured once, counting nothing.
            if (t.printed.used === 0 && t.printed.columnE === 0) { notes.push(`totals row ${t.row} counts no name and nothing (left out)`); continue; }
            ask({ kind: 'unexpected', what: `totals row ${t.row} counts something that is not a name` });
            continue;
        }
        if (sheetParts(t.label) && normaliseKey(t.label) !== normaliseKey(t.criterion)) notes.push(`totals row ${t.row}: column B and the count name different spellings; the count's is used`);
        const key = normaliseKey(t.criterion);
        const name = resolveName('rows', key, () => mechanicalMatch(sheetParts(t.criterion), members), () => ({
            kind: 'row-name', key, spelt: t.criterion, row: t.row, grade: t.grade,
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
    for (const [name, list] of rowsOf) {
        if (list.length === 1) { usedOf.set(name, list[0]); continue; }
        /** @type {any} */ let used;
        /** @type {string} */ let why = 'duplicate-chosen';
        if (list.every(r => same(r, list[0]))) { used = list[0]; why = 'duplicate-identical'; }
        else if (new Set(list.map(r => r.grade)).size === list.length && list.filter(r => r.printed.used > 0).length === 1) {
            used = list.find(r => r.printed.used > 0); why = 'duplicate-stale';
        } else if (list.every(r => r.grade === list[0].grade && normaliseKey(r.criterion) === normaliseKey(list[0].criterion)
            && r.printed.used === list[0].printed.used && r.printed.allowance === list[0].printed.allowance
            && r.printed.carriedForward === list[0].printed.carriedForward)
            && list.filter(r => r.printed.columnE > 0).length === 1
            && list.filter(r => r.printed.columnE === 0).every(r => r.eEntries.length === 0)) {
            used = list.find(r => r.printed.columnE > 0); why = 'duplicate-missing-column-e';
        } else {
            const chosen = answers.duplicates?.[name];
            used = list.find(r => r.row === chosen) ?? null;
            if (!used) {
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
            const name = near ? /** @type {string} */ (near.name) : resolveName('cells', key, () => mechanicalMatch(sheetParts(text), members), () => ({
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
            if (sunday || isChristmasIso(date)) { ask({ kind: 'unexpected', what: `an uncounted name on ${date}` }); continue; }
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
        // A surname alone is matched only among the members of the block it sits in: `N/A Smith` in
        // the CES columns is not the CEA Smith, however few Smiths the roster has. Two words carry
        // their initial, so they are matched as a row's name is.
        const parts = tagParts(t.key);
        const pool = parts?.initial === null ? members.filter(m => memberGrade(m) === t.grade) : members;
        const name = resolveName('tags', key, () => mechanicalMatch(parts, pool), () => ({
            kind: 'tag-name', key, grade: t.grade, dates: [], neighbours: [], suggestions: suggestions(tagParts(t.key)?.surname ?? t.key, members) }));
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
    for (const [name, used] of usedOf) {
        const grid = daysOf.get(name) ?? new Map();
        /** @type {string[]} */ const dated = [];
        let joiner = false, words = false, mixed = false;
        /** @type {Array<{ token: string, candidates: string[] }>} */ const found = [];
        for (const text of used.eEntries) {
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
            for (const tk of tokens) {
                const mm = (tk[2] ?? tk[5]).padStart(2, '0'), dd = (tk[1] ?? tk[4]).padStart(2, '0'), yy = tk[3] ?? tk[6];
                const candidates = (yy ? [`${yy.length === 2 ? `20${yy}` : yy}-${mm}-${dd}`]
                    : [`${year}-${mm}-${dd}`, `${year + 1}-${mm}-${dd}`])
                    .filter(c => isRealIsoDate(c) && c >= wbr.source.firstDate && c <= wbr.lastDate);
                found.push({ token: tk[0], candidates });
            }
        }
        if (mixed) continue;
        // A DD/MM in the first days of January can be this January or next (the grid runs into it,
        // §2). It is settled only by a date BESIDE it: exactly one of its readings within three days of
        // another date in the thread that has one reading of its own. `02/01 03/01` (the next day) and
        // `02/01 05/01` (across a weekend) settle; `24/12 02/01` does not, though it took this year's
        // January once — the likelier reading is one block over Christmas into next, so it is asked.
        const anchors = found.filter(f => f.candidates.length === 1).map(f => Date.parse(f.candidates[0]));
        const beside = (/** @type {string} */ iso) => anchors.some(a => Math.abs(Date.parse(iso) - a) <= 3 * 86_400_000);
        for (const f of found) {
            const qKey = `${used.row}|${f.token}`;
            let iso = f.candidates.length === 1 ? f.candidates[0] : undefined;
            if (f.candidates.length > 1) {
                const near = f.candidates.filter(beside);
                iso = answers.commentDates?.[qKey] ?? (near.length === 1 ? near[0] : undefined);
            }
            if (!iso) {
                if (f.candidates.length) ask({ kind: 'comment-date', key: qKey, row: used.row, token: f.token, candidates: f.candidates });
                else ask({ kind: 'unexpected', what: `totals row ${used.row}: a comment date outside the sheet (${f.token})` });
                continue;
            }
            if (grid.has(iso) || dated.includes(iso)) continue;   // counted once, from the grid
            if (isSundayIso(iso) || isChristmasIso(iso)) { ask({ kind: 'unexpected', what: `totals row ${used.row}: an over-quota date on ${iso}` }); continue; }
            dated.push(iso);
        }
        const e = used.printed.columnE;
        if (e === 0 && dated.length) {
            // Defect 7: dated in the comment, the count left blank — real leave the total misses.
            for (const iso of dated) addDay(name, { name, date: iso, kind: 'leave', foundIn: 'column-e-uncounted', countedBySheet: false });
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

/**
 * Is `path` outside the repository? The leave file must never be written where git could pick it up.
 * A FILE that is a symlink is judged by where it points, existing or not — writing to it writes
 * there — and a name that merely begins with two dots (`..x.leave.json`) is inside, not above.
 * @param {string} path @param {number} [hops] symlinks followed so far; a loop is refused
 * @returns {boolean}
 */
export function isOutsideRepo(path, hops = 0) {
    const abs = resolve(path);
    if (lstatSync(abs, { throwIfNoEntry: false })?.isSymbolicLink()) {
        return hops < 20 && isOutsideRepo(resolve(dirname(abs), readlinkSync(abs)), hops + 1);
    }
    let dir = dirname(abs);
    while (!existsSync(dir) && dirname(dir) !== dir) dir = dirname(dir);
    const real = join(realpathSync(dir), relative(dir, abs));
    const rel = relative(realpathSync(REPO), real);
    return rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel);
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
    for (const p of [out, args.csv]) if (typeof p === 'string' && !isOutsideRepo(p)) throw new Error(`refusing to write inside the repository: ${p}`);
    if (!args.previous && !args['first-run']) throw new Error('give --previous <last.leave.json>, or --first-run to be asked about every match');
    const today = typeof args.today === 'string' ? args.today : new Date().toISOString().slice(0, 10);
    if (!isRealIsoDate(today)) throw new Error('--today must be YYYY-MM-DD');

    let previousMap = null;
    if (typeof args.previous === 'string') {
        const read = await readLeaveFile(readFileSync(args.previous, 'utf8'));
        if (!read.ok) throw new Error(`the previous leave file is refused: ${read.refusals.map(describeRefusal).join(' ')}`);
        previousMap = read.file.nameMap;
    }
    const answers = typeof args.answers === 'string' ? JSON.parse(readFileSync(args.answers, 'utf8')) : {};
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
