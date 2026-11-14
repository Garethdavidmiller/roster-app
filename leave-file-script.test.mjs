// @ts-check
/**
 * leave-file-script.test.mjs — STAGE 1 of the annual leave uploader, run against a workbook built at
 * test time: the reader (scripts/xlsx-read.mjs), the method (scripts/make-leave-file.mjs →
 * `buildLeaveFile`) and the command line (`main`, run as the real CLI in a child process).
 * Run: node scripts/run-tests.mjs leave-file-script.test.mjs   (part of `npm run test:hygiene`)
 *
 * ── EVERY PERSON, DATE AND FIGURE HERE IS INVENTED ─────────────────────────────────────────────
 *
 * The real workbook names every colleague against their leave and can never be a fixture
 * (docs/AL_WORKBOOK.md, .gitignore). So `test-fixtures/xlsx-write.mjs` builds one: a full 2026 grid
 * that runs into next January, a totals sheet whose Used figures are real COUNTIF formulas with
 * cached values, threaded comments with replies, a legacy note, and decoys. The members are invented
 * too ("A. Example" …) and passed in, so the method never sees the real roster; they borrow the real
 * roster PATTERNS, which are rota data, not people. The command-line tests do run against the real
 * roster, because `main` imports it — they assert shapes and counts only, and write outside the
 * repository into a temporary folder they delete.
 *
 * ── WHAT IT PROVES ─────────────────────────────────────────────────────────────────────────────
 *
 * Each defect AL_WORKBOOK.md records is a case in the one workbook, and the expected file is written
 * out BY HAND below — not derived from the fixture — so a reading that drops, gains or moves a day
 * fails here, and so does one that files a day under the wrong place:
 *
 *   · the calendar is chosen by its first date and a Marylebone name; a 2021 decoy and another
 *     depot's 2026 calendar, both holding the same names, are ignored (§2);
 *   · Used is the formula's COUNTIF, counted case-insensitively and untrimmed as Excel does, and the
 *     reader's own count must equal the cached figure or nothing is written (§3);
 *   · a "Vacancy" row still counts its leaver's days; a vacancy row whose criterion was overtyped
 *     counts nothing and is left out with a note (measured on the 6 Nov copy);
 *   · column E: a thread with replies and a `.` separator whose dates fall one short of its count
 *     (the rest unexplained), Excel's legacy copy beside every thread and never read in its place, a
 *     joiner's START entry dropped and its replies kept, words with no dates as a lump, a value with
 *     no comment unexplained, a legacy note read where there is no thread, a dated comment with a
 *     blank count as uncounted leave, a date the grid also holds counted once, `02/01 03/01` settled
 *     by its sibling and a lone `02/01` asked (§5, §8 defects 5, 7, 11);
 *   · Sunday tags never leave, read in three shapes; one that cannot be read is ASKED, with its slot
 *     column offered as evidence and never used to answer (§7);
 *   · a misspelt grid name is that person's leave, uncounted by the sheet (§8 defect 9); a person
 *     with no totals row (defect 10); three kinds of duplicate row, one only a person can settle,
 *     and a blank-E duplicate that is asked about once it carries a comment (defect 1); a manager and
 *     a leaver left out; a recordable member absent from the workbook;
 *   · and where the method once guessed, it now asks or refuses (review of Stage 1, 14 Nov 2026): a
 *     person's row whose Used is not one COUNTIF of the calendar, an early-January date with no date
 *     beside it, `1.5 DAYS` read as a date, a START entry with another date in it, a thread kept only
 *     as Excel's legacy copy, two rows with the same figures and different comments, a one-word
 *     Sunday tag outside its own grade, and an order that changed with the session's locale. The
 *     reader refuses an XML part it cannot read where it stands, an entry that inflates past its cap
 *     and two entries with one name.
 */
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { buildXlsx, isoToSerial, zip, legacyThreadNote, THREAD_NOTE_PLACEHOLDER } from './test-fixtures/xlsx-write.mjs';
import { readXlsx, readZip, serialToIso, parseXml } from './scripts/xlsx-read.mjs';
import { buildLeaveFile, normaliseKey } from './scripts/make-leave-file.mjs';
import { validateLeaveFile, sealLeaveFile, readLeaveFile, canonicalJson, isSundayIso } from './al-leave-file.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(ROOT, 'scripts', 'make-leave-file.mjs');
const TMP = mkdtempSync(join(tmpdir(), 'leave-file-script-'));
after(() => rmSync(TMP, { recursive: true, force: true }));

// ── The invented workbook ───────────────────────────────────────────────────────────────────────

const FIRST = '2026-01-01';
/** @param {string} iso @param {number} n */
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
/** The calendar row of a date: row 2 is 1 January, one row per day. @param {string} iso */
const rowOf = iso => 2 + Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${FIRST}T00:00:00Z`)) / 86_400_000);
const LAST_ROW = rowOf('2027-01-02');          // 368
const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** @type {Record<string, string[]>} */
const BLOCK_COLS = { CEA: ['C', 'D', 'E', 'F'], CES: ['G', 'H'], DISP: ['I', 'J'] };
/** @type {Record<string, string>} */
const RANGE = { CEA: `$C$2:$F$${LAST_ROW}`, CES: `$G$2:$H$${LAST_ROW}`, DISP: `$I$2:$J$${LAST_ROW}` };
/** @param {string} col */
const blockOfCol = col => Object.keys(BLOCK_COLS).find(g => BLOCK_COLS[g].includes(col));

/** Every name in the grid: [date, column, text]. Weekdays are asserted in the first test. */
/** @type {Array<[string, string, string]>} */
const PLACED = [
    // CEA block, C–F
    ['2026-01-13', 'C', 'Leaver . F'], ['2026-01-14', 'C', 'Leaver . F'],
    ['2026-02-06', 'C', 'Example . A'], ['2026-02-08', 'C', 'N/A A Example'],
    ['2026-02-09', 'D', 'Example . A'],
    ['2026-02-10', 'E', 'example . a'],             // counted: COUNTIF ignores case
    ['2026-03-01', 'D', 'A Example N/A'],           // a reversed tag
    ['2026-03-03', 'F', 'Example . A '],            // NOT counted: COUNTIF does not trim — misspelt
    ['2026-03-08', 'E', 'N/A A Example NA'],        // the state written twice
    ['2026-03-17', 'C', 'Twice . Q'],
    ['2026-04-01', 'C', 'Sample . B'], ['2026-04-05', 'C', 'Sample . B'],   // a plain name on a Sunday
    ['2026-04-09', 'C', 'Blank . L'],
    ['2026-04-12', 'C', 'N/A Bee'],                 // a tag nobody can read mechanically
    ['2026-09-01', 'C', 'Quota . H'],
    ['2026-11-03', 'C', 'Boss . J'],
    ['2027-01-02', 'C', 'Year . N'],                // next January, on this year's sheet
    // CES block, G–H
    ['2026-05-05', 'H', 'Trial . D'], ['2026-05-06', 'G', 'Trail . D'],     // misspelt
    ['2026-05-09', 'G', 'Trial . D'], ['2026-05-10', 'G', 'N/A Zed'],       // a first name, between D. Trial's days
    ['2026-05-11', 'G', 'Trial . D'],
    ['2026-07-07', 'G', 'Mover . G'], ['2026-07-08', 'H', 'Mover . G'],
    ['2026-10-20', 'G', 'Joiner . C'],
    // Dispatcher block, I–J
    ['2026-06-01', 'I', 'Pilot . E'], ['2026-06-02', 'I', 'Pilot . E'],     // nobody's row counts these
    ['2026-08-04', 'I', 'Split . R'],
];

/**
 * @typedef {{ row: number, role: string, label?: string, crit: string, cf?: number, d: number, e?: number,
 *             thread?: Array<{ text: string, reply?: boolean }>, note?: string }} TotalsRow
 */
/** @type {TotalsRow[]} */
const TOTALS = [
    // Two dates for a count of three: the third is unexplained, not a lump — the thread has no words.
    // (Excel's legacy copy beside it has words AND the same dates, so it would add nothing if read.)
    { row: 2, role: 'CEA', crit: 'Example . A', d: 32, e: 3, thread: [{ text: '24/02' }, { text: '19.08', reply: true }] },
    { row: 3, role: 'CEA', crit: 'Sample . B', d: 32 },
    { row: 4, role: 'CEA', crit: 'Sample . B', d: 32 },                         // identical duplicate
    { row: 5, role: 'CES', crit: 'Joiner . C', d: 34, e: 27,
      thread: [{ text: 'STARTED ON 28/09 9 DAYS LEAVE ALLOWANCE' }, { text: '12/10', reply: true }, { text: '13/10', reply: true }] },
    { row: 6, role: 'CES', crit: 'Trial . D', d: 34, e: 2 },                    // E with no comment at all
    { row: 7, role: 'CEA', label: 'Vacancy', crit: 'Leaver . F', d: 32 },
    { row: 8, role: 'CEA', label: 'Vacancy', crit: "Gone A8+'New Marylebone Totals'!F8. Q", d: 32 },
    { row: 9, role: 'CEA', crit: 'Mover . G', cf: 2, d: 32 },                   // the stale row, other grade
    { row: 10, role: 'CES', crit: 'Mover . G', d: 34 },
    { row: 11, role: 'CEA', crit: 'Quota . H', d: 32, e: 1, thread: [{ text: '15/09' }] },
    { row: 12, role: 'CEA', crit: 'Quota . H', d: 32 },                         // missing its over-quota day
    { row: 13, role: 'CEA', crit: 'Boss . J', d: 32 },
    { row: 14, role: 'CEA', crit: 'Blank . L', d: 32, thread: [{ text: '10/04' }] },   // dated, count left blank
    { row: 15, role: 'CES', crit: 'Lump . M', d: 34, e: 3, thread: [{ text: 'A/L FROM PRE JUNE' }] },
    { row: 16, role: 'CEA', crit: 'Year . N', d: 32, e: 2, thread: [{ text: '02/01 03/01' }] },
    { row: 17, role: 'CEA', crit: 'Lone . P', d: 32, e: 1, thread: [{ text: '02/01' }] },
    { row: 18, role: 'CEA', crit: 'Twice . Q', d: 32, e: 1, note: '17/03 18/03' },     // a legacy note only
    { row: 19, role: 'DISP', crit: 'Split . R', d: 22 },
    { row: 20, role: 'DISP', crit: 'Split . R', d: 20 },                        // differs, by rule undecidable
];

/** The invented roster. They borrow real PATTERNS (rosterType + currentWeek) and nothing else. */
const MEMBERS = [
    { name: 'A. Example', role: 'CEA', rosterType: 'main', currentWeek: 1 },
    { name: 'B. Sample', role: 'CEA', rosterType: 'main', currentWeek: 2 },
    { name: 'C. Joiner', role: 'CES', rosterType: 'ces', currentWeek: 1, startDate: new Date(2026, 8, 28), proRatedAL: { 2026: 9 } },
    { name: 'D. Trial', role: 'CES', rosterType: 'ces', currentWeek: 2 },
    { name: 'E. Pilot', role: 'Dispatcher', rosterType: 'dispatcher', currentWeek: 1 },
    { name: 'F. Leaver', role: 'CEA', rosterType: 'main', currentWeek: 3, hidden: true },
    { name: 'G. Mover', role: 'CES', rosterType: 'ces', currentWeek: 3 },
    { name: 'H. Quota', role: 'CEA', rosterType: 'main', currentWeek: 4 },
    { name: 'J. Boss', role: 'Management', rosterType: 'main', currentWeek: 1, hidden: true, managerOnly: true },
    { name: 'K. Absent', role: 'CEA', rosterType: 'main', currentWeek: 5 },
    { name: 'L. Blank', role: 'CEA', rosterType: 'main', currentWeek: 6 },
    { name: 'M. Lump', role: 'CES', rosterType: 'ces', currentWeek: 4 },
    { name: 'N. Year', role: 'CEA', rosterType: 'main', currentWeek: 7 },
    { name: 'P. Lone', role: 'CEA', rosterType: 'main', currentWeek: 8 },
    { name: 'Q. Twice', role: 'CEA', rosterType: 'main', currentWeek: 9 },
    { name: 'R. Split', role: 'Dispatcher', rosterType: 'dispatcher', currentWeek: 2 },
    { name: 'S. Gone', role: 'CEA', rosterType: 'main', currentWeek: 10, hidden: true },   // a leaver the workbook never had
];

/** What only a person can answer, answered. */
const ANSWERS = {
    cells: { 'CES|trail . d': 'D. Trial' },
    tags: { 'CEA|bee': 'B. Sample', 'CES|zed': null },
    duplicates: { 'R. Split': 19 },
    commentDates: { '17|02/01': '2026-01-02' },
};

/**
 * Build the workbook. Options change one thing each, for the tests that need a variant.
 * @param {{ cachedUsed?: Record<number, number>, lastModifiedBy?: string|null, extraPlaced?: Array<[string, string, string]>,
 *           secondCalendar?: boolean, modified?: string|null, extraThreads?: Record<string, string[]>,
 *           columnE?: Record<number, number>, extraTotals?: TotalsRow[], totalsCells?: Record<string, any>,
 *           calendarCells?: Record<string, any>, legacyOnly?: number[] }} [o]
 *   `extraTotals` adds rows (and `totalsCells` then writes over any cell of the totals sheet, `null`
 *   removing it), `calendarCells` writes over the calendar, and `legacyOnly` keeps those rows' threads
 *   only as Excel's legacy copy — the shape a workbook saved by an older Excel is left in.
 */
function leaveWorkbook(o = {}) {
    const placed = [...PLACED, ...(o.extraPlaced ?? [])];
    /** @type {Record<string, any>} */
    const cal = { A1: 'Day', B1: 'Date', C1: 'CEA', G1: 'CES', I1: 'Dispatcher' };
    for (let r = 2; r <= LAST_ROW; r++) {
        const iso = addDays(FIRST, r - 2);
        const wd = new Date(`${iso}T00:00:00Z`).getUTCDay();
        cal[`A${r}`] = WEEKDAY[wd];
        cal[`B${r}`] = isoToSerial(iso);
        const fill = wd === 0 ? 'N/A' : (iso.endsWith('-12-25') || iso.endsWith('-12-26') ? 'Closed' : 'Available');
        for (const col of Object.values(BLOCK_COLS).flat()) cal[`${col}${r}`] = fill;
    }
    for (const [iso, col, text] of placed) cal[`${col}${rowOf(iso)}`] = text;
    Object.assign(cal, o.calendarCells ?? {});

    /** @type {Record<string, any>} */
    const tot = { A1: 'Role', B1: 'Name', C1: 'c/f', D1: 'AL allowance', E1: 'AL over depot quota', F1: 'Total', G1: 'Used', H1: 'Remaining' };
    /** @type {Record<string, Array<{ text: string, person: string, reply?: boolean }>>} */
    const threads = {};
    /** @type {Record<string, string>} */
    const notes = {};
    for (const t of [...TOTALS, ...(o.extraTotals ?? [])]) {
        const block = t.role === 'DISP' ? 'DISP' : t.role === 'CES' ? 'CES' : 'CEA';
        const counted = placed.filter(([iso, col, text]) => blockOfCol(col) === block && rowOf(iso) >= 2 && rowOf(iso) <= LAST_ROW
            && text.toLowerCase() === t.crit.toLowerCase()).length;
        const used = o.cachedUsed?.[t.row] ?? counted;
        const cf = t.cf ?? 0, e = o.columnE?.[t.row] ?? t.e ?? 0;
        tot[`A${t.row}`] = t.role;
        tot[`B${t.row}`] = t.label ?? t.crit;
        if (cf) tot[`C${t.row}`] = cf;
        tot[`D${t.row}`] = t.d;
        if (e) tot[`E${t.row}`] = e;
        tot[`F${t.row}`] = { f: `C${t.row}+D${t.row}`, v: cf + t.d };
        tot[`G${t.row}`] = { f: `COUNTIF('New Marylebone Calendar'!${RANGE[block]},"${t.crit}")`, v: used };
        tot[`H${t.row}`] = { f: `F${t.row}-(G${t.row}+E${t.row})`, v: cf + t.d - (used + e) };
        if (t.thread && o.legacyOnly?.includes(t.row)) notes[`E${t.row}`] = legacyThreadNote(t.thread);
        else if (t.thread) threads[`E${t.row}`] = t.thread.map((x, i) => ({ ...x, person: i % 2 ? 'Clerk Two' : 'Clerk One' }));
        if (t.note) notes[`E${t.row}`] = t.note;
    }
    threads.D5 = [{ text: 'START DATE 28/09', person: 'Clerk One' }];   // a comment outside column E
    for (const [ref, texts] of Object.entries(o.extraThreads ?? {})) threads[ref] = texts.map(text => ({ text, person: 'Clerk One' }));
    Object.assign(tot, o.totalsCells ?? {});

    /** A small calendar + totals pair for a decoy sheet. @param {string} calName @param {string} first */
    const decoy = (calName, totName, first) => {
        /** @type {Record<string, any>} */ const c = {};
        for (let r = 2; r <= 9; r++) { c[`A${r}`] = 'x'; c[`B${r}`] = isoToSerial(addDays(first, r - 2)); }
        c.C6 = 'Example . A';                                   // the same name, on a decoy
        return [{ name: calName, cells: c }, { name: totName, cells: {
            B2: 'Example . A', D2: 32, G2: { f: `COUNTIF('${calName}'!$C$2:$F$9,"Example . A")`, v: 1 }, H2: 31 } }];
    };
    const sheets = [
        ...decoy('Marylebone Calendar', 'Marylebone Totals', '2021-01-01'),
        ...decoy('South Bucks Calendar', 'South Bucks Totals', FIRST),
        // A decoy COMMENT at the totals row's own ref, on the calendar: never A. Example's over-quota day.
        { name: 'New Marylebone Calendar', cells: cal, threaded: { E2: [{ text: '27/02', person: 'Clerk One' }] } },
        { name: 'New Marylebone Totals', cells: tot, threaded: threads, notes },
    ];
    if (o.secondCalendar) sheets.push({ name: 'Marylebone Calendar 2026', cells: { B2: isoToSerial(FIRST), B3: isoToSerial('2026-01-02') } });
    return buildXlsx({ sheets, core: {
        modified: o.modified === undefined ? '2026-11-06T14:07:42Z' : o.modified,
        lastModifiedBy: o.lastModifiedBy === undefined ? 'Clerk One' : o.lastModifiedBy } });
}

/** @param {Buffer} buf @param {any} [over] */
function build(buf, over = {}) {
    return buildLeaveFile({ workbook: readXlsx(buf), sha256: 'b'.repeat(64), year: 2026, members: MEMBERS,
        answers: ANSWERS, today: '2026-11-14', script: 'test', appVersion: '0.00', ...over });
}

// ── What the file must say, written out by hand ─────────────────────────────────────────────────

/** [name, date, kind, foundIn] for every day of every person in the file. */
const EXPECTED_DAYS = [
    ['A. Example', '2026-02-06', 'leave', 'grid'], ['A. Example', '2026-02-08', 'sunday-tag', 'grid-tag'],
    ['A. Example', '2026-02-09', 'leave', 'grid'], ['A. Example', '2026-02-10', 'leave', 'grid'],
    ['A. Example', '2026-02-24', 'leave', 'column-e'], ['A. Example', '2026-03-01', 'sunday-tag', 'grid-tag'],
    ['A. Example', '2026-03-03', 'leave', 'grid-misspelt'], ['A. Example', '2026-03-08', 'sunday-tag', 'grid-tag'],
    ['A. Example', '2026-08-19', 'leave', 'column-e'],
    ['B. Sample', '2026-04-01', 'leave', 'grid'], ['B. Sample', '2026-04-05', 'sunday-counted', 'grid'],
    ['B. Sample', '2026-04-12', 'sunday-tag', 'grid-tag'],
    ['C. Joiner', '2026-10-12', 'leave', 'column-e'], ['C. Joiner', '2026-10-13', 'leave', 'column-e'],
    ['C. Joiner', '2026-10-20', 'leave', 'grid'],
    ['D. Trial', '2026-05-05', 'leave', 'grid'], ['D. Trial', '2026-05-06', 'leave', 'grid-misspelt'],
    ['D. Trial', '2026-05-09', 'leave', 'grid'], ['D. Trial', '2026-05-11', 'leave', 'grid'],
    ['E. Pilot', '2026-06-01', 'leave', 'no-totals-row'], ['E. Pilot', '2026-06-02', 'leave', 'no-totals-row'],
    ['G. Mover', '2026-07-07', 'leave', 'grid'], ['G. Mover', '2026-07-08', 'leave', 'grid'],
    ['H. Quota', '2026-09-01', 'leave', 'grid'], ['H. Quota', '2026-09-15', 'leave', 'column-e'],
    ['L. Blank', '2026-04-09', 'leave', 'grid'], ['L. Blank', '2026-04-10', 'leave', 'column-e-uncounted'],
    ['N. Year', '2026-01-02', 'leave', 'column-e'], ['N. Year', '2026-01-03', 'leave', 'column-e'],
    ['N. Year', '2027-01-02', 'leave', 'grid'],
    ['P. Lone', '2026-01-02', 'leave', 'column-e'],
    ['Q. Twice', '2026-03-17', 'leave', 'grid'], ['Q. Twice', '2026-03-18', 'leave', 'column-e'],
    ['R. Split', '2026-08-04', 'leave', 'grid'],
];
const pr = (/** @type {number[]} */ [carriedForward, allowance, used, columnE, remaining]) => ({ carriedForward, allowance, used, columnE, remaining });
const ce = (/** @type {number[]} */ [datedDays, joinerReduction, lump, unexplained]) => ({ datedDays, joinerReduction, lump, unexplained });
/** name → [grade, rows [[row, grade, used?, why, printed]], columnE, corrected] */
const EXPECTED_PEOPLE = {
    'A. Example': ['CEA', [[2, 'CEA', null, pr([0, 32, 3, 3, 26])]], ce([2, 0, 0, 1]), { remaining: 25, because: ['grid-misspelt'] }],
    'B. Sample': ['CEA', [[3, 'CEA', null, pr([0, 32, 2, 0, 30])], [4, 'CEA', 'duplicate-identical', pr([0, 32, 2, 0, 30])]],
        ce([0, 0, 0, 0]), { remaining: 31, because: ['sunday-counted'] }],
    'C. Joiner': ['CES', [[5, 'CES', null, pr([0, 34, 1, 27, 6])]], ce([2, 25, 0, 0]), { remaining: 6, because: [] }],
    'D. Trial': ['CES', [[6, 'CES', null, pr([0, 34, 3, 2, 29])]], ce([0, 0, 0, 2]), { remaining: 28, because: ['grid-misspelt'] }],
    'E. Pilot': ['DISP', [], null, null],
    'G. Mover': ['CES', [[9, 'CEA', 'duplicate-stale', pr([2, 32, 0, 0, 34])], [10, 'CES', null, pr([0, 34, 2, 0, 32])]],
        ce([0, 0, 0, 0]), { remaining: 32, because: [] }],
    'H. Quota': ['CEA', [[11, 'CEA', null, pr([0, 32, 1, 1, 30])], [12, 'CEA', 'duplicate-missing-column-e', pr([0, 32, 1, 0, 31])]],
        ce([1, 0, 0, 0]), { remaining: 30, because: [] }],
    'L. Blank': ['CEA', [[14, 'CEA', null, pr([0, 32, 1, 0, 31])]], ce([0, 0, 0, 0]), { remaining: 30, because: ['column-e-blank'] }],
    'M. Lump': ['CES', [[15, 'CES', null, pr([0, 34, 0, 3, 31])]], ce([0, 0, 3, 0]), { remaining: 31, because: [] }],
    'N. Year': ['CEA', [[16, 'CEA', null, pr([0, 32, 1, 2, 29])]], ce([2, 0, 0, 0]), { remaining: 29, because: [] }],
    'P. Lone': ['CEA', [[17, 'CEA', null, pr([0, 32, 0, 1, 31])]], ce([1, 0, 0, 0]), { remaining: 31, because: [] }],
    'Q. Twice': ['CEA', [[18, 'CEA', null, pr([0, 32, 1, 1, 30])]], ce([1, 0, 0, 0]), { remaining: 30, because: [] }],
    'R. Split': ['DISP', [[19, 'DISP', null, pr([0, 22, 1, 0, 21])], [20, 'DISP', 'duplicate-chosen', pr([0, 20, 1, 0, 19])]],
        ce([0, 0, 0, 0]), { remaining: 21, because: [] }],
};
/** @param {any} f */
const daysOf = f => f.days.map((/** @type {any} */ d) => [d.name, d.date, d.kind, d.foundIn]);
/** @param {any[]} qs */
const asked = qs => qs.map(q => `${q.kind} ${q.key ?? q.what}`).sort();

// ── The reader ──────────────────────────────────────────────────────────────────────────────────

describe('the reader (scripts/xlsx-read.mjs)', () => {
    const book = buildXlsx({ sheets: [
        { name: "Bert & Ann's", cells: {
            A1: 'Fish & <chips> "x"', A2: { inline: 'an inline one' },
            A3: { rich: [{ t: 'Exam' }, { t: 'ple' }, { t: 'えくざんぷる', rPh: true }] },
            B2: isoToSerial('2026-03-01'), C2: 4.5, G5: { f: `COUNTIF('X'!$C$2:$F$9,"A . B")`, v: 3 }, G6: { f: 'A1&"!"', v: 'joined' } },
          threaded: { E5: [{ text: '24/12', person: 'Clerk One' }, { text: '19.08', person: 'Clerk Two', reply: true }] },
          notes: { E6: 'a plain note' } },
        { name: 'Other', cells: { A1: 'x' }, threaded: { E5: [{ text: '27/02', person: 'Clerk One' }] } },
    ], core: { modified: '2026-11-06T14:07:42Z', lastModifiedBy: 'Clerk One' } });

    test('cells: shared and inline strings, rich text WITHOUT its phonetic run, entities, numbers, formulas', () => {
        const wb = readXlsx(book);
        assert.deepEqual(wb.sheetNames, ["Bert & Ann's", 'Other']);
        const s = wb.sheet("Bert & Ann's");
        assert.equal(s.cells.get('A1')?.v, 'Fish & <chips> "x"');
        assert.equal(s.cells.get('A2')?.v, 'an inline one');
        assert.equal(s.cells.get('A3')?.v, 'Example');          // the rPh run is Excel's guide, not the text
        assert.equal(serialToIso(s.cells.get('B2')?.v, false), '2026-03-01');
        assert.equal(s.cells.get('C2')?.v, 4.5);
        assert.deepEqual(s.cells.get('G5'), { v: 3, f: `COUNTIF('X'!$C$2:$F$9,"A . B")`, shared: false });
        assert.deepEqual(s.cells.get('G6'), { v: 'joined', f: 'A1&"!"', shared: false });
    });

    test('comments come from THEIR OWN sheet — a thread in order, replies kept — and a note beside them', () => {
        const wb = readXlsx(book);
        const s = wb.sheet("Bert & Ann's");
        assert.deepEqual(s.threaded.get('E5')?.map(t => [t.text, t.parentId !== null]), [['24/12', false], ['19.08', true]]);
        assert.equal(s.notes.get('E6'), 'a plain note');
        // Excel's legacy copy of the thread sits at the same cell, all words: the thread is the source.
        assert.match(s.notes.get('E5') ?? '', /^\[Threaded comment\][^]*\n\nComment:\n {4}24\/12\nReply:\n {4}19\.08$/);
        // The other sheet has a comment at the SAME ref: it stays there (AL_WORKBOOK.md §6).
        assert.deepEqual(wb.sheet('Other').threaded.get('E5')?.map(t => t.text), ['27/02']);
        assert.deepEqual([...wb.persons.values()].sort(), ['Clerk One', 'Clerk Two']);
    });

    test('docProps: the last save and who made it; a workbook without them reads null', () => {
        assert.deepEqual(readXlsx(book).props, { modified: '2026-11-06T14:07:42Z', lastModifiedBy: 'Clerk One' });
        const bare = buildXlsx({ sheets: [{ name: 'S', cells: { A1: 'x' } }], core: {} });
        assert.deepEqual(readXlsx(bare).props, { modified: null, lastModifiedBy: null });
    });

    test('a stored entry reads the same as a deflated one, and both date systems convert', () => {
        const stored = buildXlsx({ sheets: [{ name: 'S', cells: { A1: 'plain' } }] }, { method: 0 });
        assert.equal(readXlsx(stored).sheet('S').cells.get('A1')?.v, 'plain');
        assert.equal(serialToIso(isoToSerial('2026-07-01', true), true), '2026-07-01');
        assert.equal(serialToIso(46022.5, false), null);          // a time of day is not a calendar date
        assert.equal(serialToIso('46022', false), null);
    });

    test('a damaged or hostile archive is refused, naming the part and never a cell', () => {
        const parts = /** @type {Array<[string, Buffer]>} */ ([['xl/workbook.xml', Buffer.from('<workbook/>')]]);
        const badCrc = zip(parts, { badCrc: 'xl/workbook.xml' });
        const get = readZip(badCrc).get('xl/workbook.xml');
        assert.ok(get);
        assert.throws(() => get(), /checksum mismatch in xl\/workbook\.xml/);
        assert.throws(() => readZip(zip(parts, { claimSize: { name: 'xl/workbook.xml', size: 0x7fffffff } })), /entry too large/);
        assert.throws(() => readZip(zip(parts, { claimMethod: { name: 'xl/workbook.xml', method: 12 } })), /unsupported compression in xl\/workbook\.xml/);
        assert.throws(() => readZip(Buffer.from('not a zip at all, just words in a file')), /not a zip file/);
        assert.throws(() => readXlsx(zip([['other.txt', Buffer.from('x')]])), /missing part xl\/workbook\.xml/);
    });

    test('the cap holds DURING inflation: an entry that claims to be small and inflates past it is refused', () => {
        // 64 KB of zeros deflate to a few hundred bytes, and the directory says the entry is 100 bytes:
        // only the cap handed to the inflater stops it. Without that cap it inflated in full and was
        // refused only afterwards, by its checksum — however large it had grown by then.
        const bomb = zip([['xl/workbook.xml', Buffer.alloc(65_536)]], { claimSize: { name: 'xl/workbook.xml', size: 100 } });
        const get = readZip(bomb, { maxEntryBytes: 1024 }).get('xl/workbook.xml');
        assert.ok(get);
        assert.throws(() => get(), /entry too large when inflated: xl\/workbook\.xml/);
        // A stream that is not deflate at all is a damaged entry, named — never zlib's own error.
        const notDeflate = zip([['xl/workbook.xml', Buffer.from([0x07, 0x00])]], { method: 0, claimMethod: { name: 'xl/workbook.xml', method: 8 } });
        assert.throws(() => readZip(notDeflate).get('xl/workbook.xml')?.(), /damaged entry xl\/workbook\.xml/);
    });

    test('two entries with one name are refused: the second would silently replace the first', () => {
        const twice = zip([['xl/workbook.xml', Buffer.from('<workbook/>')], ['xl/workbook.xml', Buffer.from('<other/>')]]);
        assert.throws(() => readZip(twice), /two entries named xl\/workbook\.xml/);
    });

    test('the XML scanner reads only from where it stands: a `<` it cannot read is refused, never skipped', () => {
        for (const xml of ['<a><!-- never closed</a>', '<a><?never closed</a>', '<a><![CDATA[never closed</a>',
            '<!DOCTYPE a><a/>', '<a>one < two</a>', '<a>x</a><']) {
            assert.throws(() => parseXml(xml), /malformed XML/, xml);
        }
        // What it can read, it still reads: a declaration, a comment and CDATA, each closed.
        const read = parseXml('<?xml version="1.0"?><!-- a note --><a><![CDATA[x<y]]>&amp;z</a>');
        assert.deepEqual(read.children.map(c => [c.name, c.text]), [['a', 'x<y&z']]);
    });

    test('an unclosed construct is refused in ONE pass: a few hundred KB of them, quickly', () => {
        // In a child with a hard limit, so a scanner that went back to searching forward fails here
        // instead of holding up the suite. 300 KB of unclosed comments took the old one 4.5 s, read
        // without complaint, and its cost grew with the square of the part (xlsx-read.mjs header).
        const code = `
            const { parseXml } = await import(${JSON.stringify(pathToFileURL(join(ROOT, 'scripts', 'xlsx-read.mjs')).href)});
            const out = {};
            for (const [label, open] of Object.entries({ comment: '<!--', declaration: '<?', cdata: '<![CDATA[', doctype: '<!DOCTYPE ' })) {
                const xml = '<r>' + (open + 'x').repeat(Math.ceil(300_000 / (open.length + 1))) + '</r>';
                const started = performance.now();
                let result = 'read without complaint';
                try { parseXml(xml); } catch (e) { result = e.message; }
                out[label] = { result, ms: performance.now() - started };
            }
            process.stdout.write(JSON.stringify(out));`;
        const child = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', timeout: 60_000 });
        assert.equal(child.error, undefined, 'the scan did not finish within a minute');
        assert.equal(child.status, 0, child.stderr);
        for (const [label, { result, ms }] of Object.entries(JSON.parse(child.stdout))) {
            assert.match(result, /malformed XML/, label);
            assert.ok(ms < 1000, `${label}: ${Math.round(ms)} ms`);
        }
    });
});

// ── The method ──────────────────────────────────────────────────────────────────────────────────

describe('the method (buildLeaveFile)', () => {
    test('the fixture is what it claims: every placed name on the weekday it says, the tags on Sundays', () => {
        for (const [iso, , text] of PLACED) {
            const tag = /N\/A|\bNA\b/.test(text);
            const sunday = isSundayIso(iso);
            if (tag) assert.ok(sunday, `${iso} ${text}`);
            else if (text !== 'Sample . B' || iso !== '2026-04-05') assert.ok(!sunday, `${iso} ${text}`);
        }
        assert.equal(LAST_ROW, 368);
    });

    test('with no answers it ASKS what only a person can answer, and makes no file', () => {
        const { file, questions } = build(leaveWorkbook(), { answers: {} });
        assert.equal(file, null);
        assert.deepEqual(asked(questions), [
            'cell-name CES|trail . d', 'comment-date 17|02/01', 'duplicate-rows R. Split', 'tag-name CEA|bee', 'tag-name CES|zed']);
        const zed = questions.find(q => q.key === 'CES|zed');
        // The slot column is EVIDENCE in the question — D. Trial on both sides — and never the answer.
        assert.deepEqual(zed?.neighbours, [{ date: '2026-05-10', saturday: 'D. Trial', monday: 'D. Trial' }]);
        assert.deepEqual(zed?.dates, ['2026-05-10']);
        assert.deepEqual(questions.find(q => q.key === 'CES|trail . d')?.suggestions, ['D. Trial']);
        assert.deepEqual(questions.find(q => q.kind === 'comment-date')?.candidates, ['2026-01-02', '2027-01-02']);
        assert.ok(questions.every(q => q.kind !== 'unexpected'), JSON.stringify(questions.filter(q => q.kind === 'unexpected')));
    });

    test('with the answers it makes the file: every day where it was found, nothing gained, lost or moved', async () => {
        const { file, questions, notes } = build(leaveWorkbook());
        assert.deepEqual(questions, []);
        assert.ok(file);
        assert.deepEqual(daysOf(file), EXPECTED_DAYS);
        // Next January on this year's sheet comes out of THIS year's allowance, and says so.
        assert.deepEqual(file.days.filter((/** @type {any} */ d) => d.leaveYear !== undefined).map((/** @type {any} */ d) => [d.name, d.date, d.leaveYear]),
            [['N. Year', '2027-01-02', 2026]]);
        // Neither the START date, the decoy comment, the 2021 sheet nor the other depot reached anybody.
        for (const iso of ['2026-09-28', '2026-02-27', '2021-01-05', '2026-01-05']) {
            assert.ok(!file.days.some((/** @type {any} */ d) => d.date === iso), iso);
        }
        assert.deepEqual(validateLeaveFile(file), []);
        const read = await readLeaveFile(JSON.stringify(await sealLeaveFile(file)));
        assert.equal(read.ok, true);
        assert.ok(notes.includes('totals row 8 counts no name and nothing (left out)'), notes.join('\n'));
        assert.ok(notes.includes('totals row 5 has a comment outside column E (read by hand: it is not part of the file)'), notes.join('\n'));
    });

    test('every person’s rows, figures, column E and corrected remaining are the sheet’s own', () => {
        const { file } = build(leaveWorkbook());
        assert.ok(file);
        assert.deepEqual(file.people.map((/** @type {any} */ p) => p.name), Object.keys(EXPECTED_PEOPLE));
        for (const p of file.people) {
            const [grade, rows, columnE, corrected] = /** @type {any} */ (EXPECTED_PEOPLE)[p.name];
            assert.equal(p.grade, grade, p.name);
            assert.deepEqual(p.sheetRows.map((/** @type {any} */ r) => [r.row, r.grade, r.used ? null : r.why, r.printed]), rows, p.name);
            assert.deepEqual(p.columnE, columnE, p.name);
            assert.deepEqual(p.corrected && { ...p.corrected, because: [...p.corrected.because].sort() },
                corrected && { ...corrected, because: [...corrected.because].sort() }, p.name);
        }
    });

    test('a duplicate is "missing its column E" only while it is silent and the other is the one figure — else it is ASKED', () => {
        // H. Quota's second row reads as missing its over-quota day because its E is blank AND
        // uncommented. A comment on it may be the clerk's reason the rows differ; a second E figure
        // means the rows disagree. Either way which row is theirs is a person's call.
        for (const variant of [{ extraThreads: { E12: ['see the row above'] } }, { columnE: { 12: 2 } }]) {
            const { file, questions } = build(leaveWorkbook(variant));
            assert.equal(file, null, JSON.stringify(variant));
            assert.deepEqual(asked(questions), ['duplicate-rows H. Quota'], JSON.stringify(variant));
        }
    });

    test('who is not in it, and why: a leaver through a Vacancy row, a manager, one absent, the tags nobody holds', () => {
        const { file } = build(leaveWorkbook());
        assert.ok(file);
        assert.deepEqual(file.notImported, [{ name: 'F. Leaver', reason: 'leaver' }, { name: 'J. Boss', reason: 'manager' }]);
        assert.deepEqual(file.absentFromWorkbook, ['K. Absent']);   // never S. Gone: a leaver is nobody to look for
        assert.equal(file.unplacedSundayTags, 1);
        assert.deepEqual(file.source, { sha256: 'b'.repeat(64), firstDate: '2026-01-01', lastDate: '2027-01-02',
            clerksLastSaved: '2026-11-06T14:07:42Z', lastSavedByClerk: true });
        assert.deepEqual(file.nameMap.tags, { 'CEA|a example': 'A. Example', 'CEA|bee': 'B. Sample', 'CES|zed': null });
        assert.deepEqual(file.nameMap.cells, { 'CEA|example . a': 'A. Example', 'CES|trail . d': 'D. Trial', 'DISP|pilot . e': 'E. Pilot' });
        assert.equal(file.nameMap.rows['leaver . f'], 'F. Leaver');
        assert.ok(!Object.keys(file.nameMap.rows).some(k => k.includes('new marylebone totals')), 'the overtyped criterion is not a name');
    });

    test('the same workbook and the previous file’s map make the same file — and the per-workbook answers are asked again', () => {
        const first = build(leaveWorkbook()).file;
        assert.ok(first);
        const again = build(leaveWorkbook(), { previousMap: first.nameMap,
            answers: { duplicates: ANSWERS.duplicates, commentDates: ANSWERS.commentDates } }).file;
        assert.equal(canonicalJson(again), canonicalJson(first));
        // A duplicate row and an either-January date are keyed by ROW, which moves between copies of
        // the workbook, so they are not carried in the map: given only the map, exactly those come back.
        const mapOnly = build(leaveWorkbook(), { previousMap: first.nameMap, answers: {} });
        assert.equal(mapOnly.file, null);
        assert.deepEqual(asked(mapOnly.questions), ['comment-date 17|02/01', 'duplicate-rows R. Split']);
    });

    test('a cached Used the grid does not bear out stops everything — the reader’s count must be the sheet’s', () => {
        const { file, questions } = build(leaveWorkbook({ cachedUsed: { 2: 4 } }));
        assert.equal(file, null);
        assert.deepEqual(questions.filter(q => q.kind === 'unexpected').map(q => q.what),
            ['totals row 2: this reader counts 3 where the sheet says 4']);
    });

    test('whether a clerk saved it last: a comment author, somebody else, or nobody named', () => {
        assert.equal(build(leaveWorkbook({ lastModifiedBy: 'Someone Else' })).file?.source.lastSavedByClerk, false);
        assert.equal(build(leaveWorkbook({ lastModifiedBy: null })).file?.source.lastSavedByClerk, null);
        assert.equal(build(leaveWorkbook({ modified: null })).file?.source.clerksLastSaved, null);
    });

    test('shapes the method does not know are refused, not guessed', () => {
        // Two Marylebone calendars that both start on 1 January: which is this year's is not a guess.
        const two = build(leaveWorkbook({ secondCalendar: true }));
        assert.equal(two.file, null);
        assert.deepEqual(two.questions.map(q => q.what), ['2 Marylebone calendar sheets start on 2026-01-01']);
        // A tag on a weekday is not a Sunday tag.
        const weekdayTag = build(leaveWorkbook({ extraPlaced: [['2026-06-03', 'J', 'N/A A Example']] }));
        assert.equal(weekdayTag.file, null);
        assert.ok(weekdayTag.questions.some(q => q.what === 'a tagged cell on 2026-06-03, which is not a Sunday'));
        // A name on Christmas Day, which the sheet marks closed.
        const christmas = build(leaveWorkbook({ extraPlaced: [['2026-12-25', 'G', 'Mover . G']], cachedUsed: { 10: 3 } }));
        assert.equal(christmas.file, null);
        assert.ok(christmas.questions.some(q => q.what === 'a name on 2026-12-25, which the sheet should mark closed'));
    });

    test('an answer naming somebody no longer on the roster is not used: it is asked again, with a note', () => {
        const { file, questions, notes } = build(leaveWorkbook(), { answers: { ...ANSWERS, cells: { 'CES|trail . d': 'X. Nobody' } } });
        assert.equal(file, null);
        assert.deepEqual(asked(questions), ['cell-name CES|trail . d']);
        assert.ok(notes.some(n => n.includes('no longer on the roster')));
    });
});

// ── Where the method once guessed, it now asks or refuses (review of Stage 1, 14 Nov 2026) ─────────

/** People only some variants need — invented like the rest, and on no roster. */
const T_BROKEN = { name: 'T. Broken', role: 'CEA', rosterType: 'main', currentWeek: 11 };
const W_TWIN = { name: 'W. Twin', role: 'CEA', rosterType: 'main', currentWeek: 12 };
/** A row whose Used is read or not by what G21 holds; its grid day and its over-quota day are real. */
const BROKEN_ROW = { row: 21, role: 'CEA', crit: 'Broken . T', d: 32, e: 1, thread: [{ text: '24/03' }] };
/** @param {Record<string, any>} [totalsCells] @param {TotalsRow} [row] */
const brokenBook = (totalsCells, row = BROKEN_ROW) => leaveWorkbook({ extraTotals: [row], extraPlaced: [['2026-03-25', 'C', 'Broken . T']], totalsCells });
/** @param {any} f @param {string} name */
const daysFor = (f, name) => daysOf(f).filter((/** @type {string[]} */ d) => d[0] === name);
/** @param {any[]} qs */
const refusals = qs => qs.filter(q => q.kind === 'unexpected').map(q => q.what);

describe('the method: where it once guessed, it now asks or refuses', () => {
    test('a totals row read in full, as the baseline the next test breaks', () => {
        const { file, questions } = build(brokenBook(), { members: [...MEMBERS, T_BROKEN] });
        assert.deepEqual(questions, []);
        assert.deepEqual(daysFor(file, 'T. Broken'), [['T. Broken', '2026-03-24', 'leave', 'column-e'], ['T. Broken', '2026-03-25', 'leave', 'grid']]);
    });

    test('a person’s row whose Used is not ONE count of this calendar stops the file — it is never dropped', () => {
        // Dropped, the row's grid day came out as "no totals row" and its over-quota day vanished
        // (AL_WORKBOOK.md §0), and the run still exited 0.
        const cal = "'New Marylebone Calendar'!$C$2:$F$368";
        const why = ['totals row 21: its Used is not one COUNTIF of this calendar by name, so its days and its column E cannot be read'];
        const silent = { ...BROKEN_ROW, thread: undefined };
        for (const [what, G21, more, row] of /** @type {Array<[string, any, Record<string, any>, TotalsRow]>} */ ([
            ['two counts added', { f: `COUNTIF(${cal},"Broken . T")+COUNTIF(${cal},"Brokn . T")`, v: 1 }, {}, BROKEN_ROW],
            ['a criterion that is a cell', { f: `COUNTIF(${cal},B21)`, v: 1 }, {}, BROKEN_ROW],
            ['a figure typed over the formula', 1, {}, BROKEN_ROW],
            ['another calendar’s count', { f: 'COUNTIF(\'Marylebone Calendar\'!$C$2:$F$9,"Broken . T")', v: 0 }, {}, BROKEN_ROW],
            // Each mark of a person's row is enough on its own: a role…
            ['a role, nothing else', 1, { B21: 'Vacancy', E21: null }, silent],
            // …a name in the sheet's form…
            ['a name, nothing else', 1, { A21: null, E21: null }, silent],
            // …a figure in column E…
            ['a figure in column E, nothing else', 1, { A21: null, B21: 'Vacancy' }, silent],
            // …or a comment there.
            ['a comment on column E, nothing else', 1, { A21: null, B21: 'Vacancy', E21: null }, BROKEN_ROW],
        ])) {
            const { file, questions } = build(brokenBook({ G21, ...more }, row), { members: [...MEMBERS, T_BROKEN] });
            assert.equal(file, null, what);
            assert.deepEqual(refusals(questions), why, what);
        }
    });

    test('a row that is nobody’s is left out with a note when its Used is a formula or a figure; blanks and labels say nothing', () => {
        const plain = build(leaveWorkbook());
        const footer = build(leaveWorkbook({ totalsCells: { B40: 'Total', G40: { f: 'SUM(G2:G20)', v: 25 }, B41: 'Typed', G41: 7, G42: '', B43: 'Label', G43: 'Used' } }));
        assert.ok(footer.file && plain.file);
        assert.equal(canonicalJson(footer.file), canonicalJson(plain.file));
        assert.deepEqual(footer.notes.filter(n => !plain.notes.includes(n)), [
            'totals row 40: column G is not a count of this calendar, and the row is not a person\'s (left out)',
            'totals row 41: column G is not a count of this calendar, and the row is not a person\'s (left out)']);
    });

    test('an early-January date is settled only by a date BESIDE it — otherwise it is asked', () => {
        const noAnswer = { ...ANSWERS, commentDates: {} };
        /** @param {string} comment @param {any} [answers] */
        const lone = (comment, answers = noAnswer) => build(leaveWorkbook({ extraThreads: { E17: [comment] }, columnE: { 17: 2 } }), { answers });
        // One block over Christmas into next January is the likelier reading of this, so it is not
        // given this year's January because the other date is this year's (the old rule).
        const christmas = lone('24/12 02/01');
        assert.equal(christmas.file, null);
        assert.deepEqual(asked(christmas.questions), ['comment-date 17|02/01']);
        assert.deepEqual(christmas.questions[0].candidates, ['2026-01-02', '2027-01-02']);
        // Two days after New Year's Eve is next January, from this year's sheet.
        const newYear = lone('31/12 02/01').file;
        assert.deepEqual(daysFor(newYear, 'P. Lone'), [['P. Lone', '2026-12-31', 'leave', 'column-e'], ['P. Lone', '2027-01-02', 'leave', 'column-e']]);
        assert.equal(newYear.days.find((/** @type {any} */ d) => d.name === 'P. Lone' && d.date === '2027-01-02').leaveYear, 2026);
        // Across a weekend still settles: Friday the 2nd, Monday the 5th.
        assert.deepEqual(daysFor(lone('02/01 05/01').file, 'P. Lone'), [['P. Lone', '2026-01-02', 'leave', 'column-e'], ['P. Lone', '2026-01-05', 'leave', 'column-e']]);
        // An answer still wins over the rule.
        const answered = lone('31/12 02/01', { ...ANSWERS, commentDates: { '17|02/01': '2026-01-02' } }).file;
        assert.deepEqual(daysFor(answered, 'P. Lone').map(d => d[1]), ['2026-01-02', '2026-12-31']);
    });

    test('a full stop makes a date only between two-digit parts: `1.5 DAYS` is not the first of May', () => {
        /** @param {string} comment */
        const lump = comment => build(leaveWorkbook({ extraThreads: { E15: [comment] } })).file;
        const words = lump('1.5 DAYS FROM PRE JUNE');
        assert.deepEqual(daysFor(words, 'M. Lump'), []);
        assert.deepEqual(words.people.find((/** @type {any} */ p) => p.name === 'M. Lump').columnE, ce([0, 0, 3, 0]));
        // The forms the clerks do write still read: `D/M`, and `DD.MM.YYYY`.
        for (const [comment, date] of [['1/5', '2026-05-01'], ['21.10.2026', '2026-10-21']]) {
            const f = lump(comment);
            assert.deepEqual(daysFor(f, 'M. Lump'), [['M. Lump', date, 'leave', 'column-e']], comment);
            assert.deepEqual(f.people.find((/** @type {any} */ p) => p.name === 'M. Lump').columnE, ce([1, 0, 0, 2]), comment);
        }
    });

    test('a START entry’s first date after the word is the start date; any other date in it is asked about', () => {
        /** @param {string[]} thread */
        const joiner = thread => build(leaveWorkbook({ extraThreads: { E5: thread } }));
        for (const entry of ['STARTED 05/10, A/L 24/12', '28/09 STARTED']) {
            const { file, questions } = joiner([entry]);
            assert.equal(file, null, entry);
            assert.deepEqual(refusals(questions), ['totals row 5: one comment entry gives a start date and another date'], entry);
        }
        // One date, after the word: a joiner, no day of leave, the rest of column E the reduction — as before.
        for (const entry of ['STARTED 28/09', 'START ON 19/10', 'STARTED SUN 20/09 9 DAYS LEAVE THIS YEAR']) {
            const { file } = joiner([entry, '12/10', '13/10']);
            assert.ok(file, entry);
            assert.deepEqual(daysFor(file, 'C. Joiner'), EXPECTED_DAYS.filter(d => d[0] === 'C. Joiner'), entry);
            assert.deepEqual(file.people.find((/** @type {any} */ p) => p.name === 'C. Joiner').columnE, ce([2, 25, 0, 0]), entry);
        }
    });

    test('where only Excel’s legacy copy of a thread survives, it is read as the thread it copies', () => {
        // Read whole, the joiner's copy was one entry with START in it, and took both dated replies down.
        const threaded = build(leaveWorkbook()).file;
        const legacy = build(leaveWorkbook({ legacyOnly: [2, 5] })).file;
        assert.ok(legacy);
        assert.equal(canonicalJson(legacy), canonicalJson(threaded));
        // A copy with no `Comment:` in it is not a shape the method knows.
        const bare = build(brokenBook({}, { ...BROKEN_ROW, thread: undefined, note: THREAD_NOTE_PLACEHOLDER }), { members: [...MEMBERS, T_BROKEN] });
        assert.equal(bare.file, null);
        assert.deepEqual(refusals(bare.questions), ['totals row 21: column E\'s comment is a copy of a thread with no Comment: in it']);
    });

    test('two rows with the same figures and DIFFERENT comments are asked about, not settled as one', () => {
        /** @param {string} second */
        const twins = second => build(leaveWorkbook({ extraTotals: [
            { row: 21, role: 'CEA', crit: 'Twin . W', d: 32, e: 1, thread: [{ text: '10/06' }] },
            { row: 22, role: 'CEA', crit: 'Twin . W', d: 32, e: 1, thread: [{ text: second }] }] }), { members: [...MEMBERS, W_TWIN] });
        const differ = twins('11/06');
        assert.equal(differ.file, null);
        assert.deepEqual(asked(differ.questions), ['duplicate-rows W. Twin']);
        // The same comment, spaced differently, is still one row twice.
        const same = twins('  10/06 ').file;
        assert.deepEqual(daysFor(same, 'W. Twin'), [['W. Twin', '2026-06-10', 'leave', 'column-e']]);
        assert.deepEqual(same.people.find((/** @type {any} */ p) => p.name === 'W. Twin').sheetRows.map((/** @type {any} */ r) => [r.row, r.why ?? null]),
            [[21, null], [22, 'duplicate-identical']]);
    });

    test('a surname alone on a Sunday is matched only within its own grade block', () => {
        // B. Sample is the only Sample on the roster, and a CEA: in the CES columns the tag is not theirs.
        const ces = build(leaveWorkbook({ extraPlaced: [['2026-05-17', 'H', 'N/A Sample']] }));
        assert.equal(ces.file, null);
        assert.deepEqual(asked(ces.questions), ['tag-name CES|sample']);
        // In their own block it is, and a CES surname in the CES block is still matched.
        const own = build(leaveWorkbook({ extraPlaced: [['2026-05-24', 'H', 'N/A Trial'], ['2026-05-31', 'F', 'N/A Sample']] })).file;
        assert.ok(own);
        assert.ok(daysOf(own).some((/** @type {string[]} */ d) => d.join() === 'D. Trial,2026-05-24,sunday-tag,grid-tag'));
        assert.ok(daysOf(own).some((/** @type {string[]} */ d) => d.join() === 'B. Sample,2026-05-31,sunday-tag,grid-tag'));
    });

    test('the file — and so its seal — is the same whatever the session’s collation', () => {
        const members = [...MEMBERS, { name: 'Z. Zeta', role: 'CEA', rosterType: 'main', currentWeek: 13 },
            { name: 'Ö. Öst', role: 'CEA', rosterType: 'main', currentWeek: 14 }];
        const answers = { ...ANSWERS, cells: { ...ANSWERS.cells, 'CEA|ost . o': 'Ö. Öst', 'CEA|öst . ö': null, 'CEA|zeta . q': null } };
        const book = leaveWorkbook({ extraPlaced: [['2026-07-14', 'D', 'Zeta . Z'], ['2026-07-15', 'D', 'Ost . O'], ['2026-07-16', 'D', 'Öst . Ö'], ['2026-07-17', 'D', 'Zeta . Q']] });
        const real = String.prototype.localeCompare;
        /** Made with `localeCompare` answering as a session in that locale would. @param {string} locale */
        const madeIn = locale => {
            const collator = new Intl.Collator(locale);
            String.prototype.localeCompare = function (/** @type {string} */ that) { return collator.compare(String(this), that); };
            try { return build(book, { members, answers }).file; } finally { String.prototype.localeCompare = real; }
        };
        const sv = madeIn('sv'), en = madeIn('en');   // Swedish puts Ö after Z; English beside O
        assert.ok(sv && en);
        assert.equal(canonicalJson(sv), canonicalJson(en));
        // Code-unit order: `Z` (U+005A) before `Ö` (U+00D6), in both lists the order is visible in.
        assert.deepEqual(sv.days.slice(-2).map((/** @type {any} */ d) => d.name), ['Z. Zeta', 'Ö. Öst']);
        assert.deepEqual(sv.notImported.map((/** @type {any} */ n) => n.name), ['F. Leaver', 'J. Boss', 'Zeta . Q', 'Öst . Ö']);
    });

    test('the calendar must be one row per day from row 2: a repeated or a missing date stops everything', () => {
        const repeated = build(leaveWorkbook({ calendarCells: { B70: isoToSerial('2026-03-11') } }));
        assert.equal(repeated.file, null);
        assert.deepEqual(refusals(repeated.questions), ['the calendar\'s dates are not one row per day from row 2 (row 70)']);
        const missing = build(leaveWorkbook({ calendarCells: { B70: null } }));
        assert.equal(missing.file, null);
        assert.deepEqual(refusals(missing.questions), ['the calendar\'s dates are not one row per day from row 2 (row 71)']);
    });

    test('the file the method makes is checked by the app’s own validator BEFORE it is sealed', () => {
        // A cell of words answered "not in the app" is listed by its spelling, and this one is longer
        // than any name the format accepts: the method must not seal a file the app would refuse.
        const spelt = 'Held for a colleague from another depot until the end of the month, then released';
        const { file, questions } = build(leaveWorkbook({ extraPlaced: [['2026-07-21', 'D', spelt]] }),
            { answers: { ...ANSWERS, cells: { ...ANSWERS.cells, [`CEA|${normaliseKey(spelt)}`]: null } } });
        assert.equal(file, null);
        assert.deepEqual(refusals(questions), ['the file the method made is refused: Part of the file is not in the expected form (notImported).']);
    });
});

// ── The command line, run as itself ─────────────────────────────────────────────────────────────

describe('the command line (main)', () => {
    const workbook = join(TMP, 'book.xlsx');
    writeFileSync(workbook, leaveWorkbook());
    /** @param {string[]} args */
    const cli = args => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', cwd: TMP });
    const base = ['--workbook', workbook, '--year', '2026', '--today', '2026-11-14'];

    test('questions exit 2 as JSON; answered, it writes a sealed file and a day list OUTSIDE the repository', async () => {
        const out = join(TMP, 'leave-2026.leave.json');
        const csv = join(TMP, 'days.csv');
        // Against the REAL roster none of these invented names matches, so every one is asked.
        const first = cli([...base, '--first-run', '--out', out]);
        assert.equal(first.status, 2, first.stderr);
        assert.ok(!existsSync(out));
        const { questions } = JSON.parse(first.stdout);
        assert.ok(questions.length > 0 && questions.every((/** @type {any} */ q) => ['row-name', 'cell-name', 'tag-name'].includes(q.kind)));
        // Answer every one "not in the app", which needs no real name at all.
        /** @type {Record<string, Record<string, null>>} */
        const answers = { rows: {}, cells: {}, tags: {} };
        for (const q of questions) answers[{ 'row-name': 'rows', 'cell-name': 'cells', 'tag-name': 'tags' }[/** @type {'row-name'} */ (q.kind)]][q.key] = null;
        const answersPath = join(TMP, 'answers.local.json');
        writeFileSync(answersPath, JSON.stringify(answers));
        const second = cli([...base, '--first-run', '--answers', answersPath, '--out', out, '--csv', csv]);
        assert.equal(second.status, 0, second.stderr);
        const summary = JSON.parse(second.stdout);
        assert.equal(summary.people, 0);
        const read = await readLeaveFile(readFileSync(out, 'utf8'));
        assert.equal(read.ok, true);
        assert.ok(read.ok && read.file.notImported.some((/** @type {any} */ n) => n.name === 'Example . A' && n.reason === 'not-in-app'));
        assert.equal(readFileSync(csv, 'utf8').split('\n')[0], '"name","date","kind","foundIn","countedBySheet","leaveYear"');
        // And the run it makes from its own previous file is the same file.
        const third = cli([...base, '--previous', out, '--out', join(TMP, 'again.leave.json')]);
        assert.equal(third.status, 0, third.stderr);
        assert.equal(readFileSync(join(TMP, 'again.leave.json'), 'utf8'), readFileSync(out, 'utf8'));
    });

    test('it refuses to write inside the repository, or anything not named .leave.json', () => {
        const inside = cli([...base, '--first-run', '--out', join(ROOT, 'x.leave.json')]);
        assert.equal(inside.status, 1);
        assert.match(inside.stderr, /refusing to write inside the repository/);
        assert.ok(!existsSync(join(ROOT, 'x.leave.json')));
        const csvInside = cli([...base, '--first-run', '--out', join(TMP, 'y.leave.json'), '--csv', join(ROOT, 'days.csv')]);
        assert.equal(csvInside.status, 1);
        assert.match(csvInside.stderr, /refusing to write inside the repository/);
        const named = cli([...base, '--first-run', '--out', join(TMP, 'leave.json')]);
        assert.equal(named.status, 1);
        assert.match(named.stderr, /must end \.leave\.json/);
    });

    test('it refuses a hand-edited previous file, and a run with no map and no --first-run', async () => {
        const { file } = build(leaveWorkbook());
        assert.ok(file);
        const text = JSON.stringify(await sealLeaveFile(file));
        const edited = join(TMP, 'edited.leave.json');
        writeFileSync(edited, text.replace('"2026-02-24"', '"2026-02-25"'));
        const run = cli([...base, '--previous', edited, '--out', join(TMP, 'z.leave.json')]);
        assert.equal(run.status, 1);
        assert.match(run.stderr, /the previous leave file is refused/);
        const none = cli([...base, '--out', join(TMP, 'z.leave.json')]);
        assert.equal(none.status, 1);
        assert.match(none.stderr, /--first-run/);
    });
});
