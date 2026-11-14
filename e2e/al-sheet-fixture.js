// @ts-check
/**
 * al-sheet-fixture.js — a sealed leave file for the Annual leave sheet card (operations-al-sheet.js),
 * built at test time and never written to disk. Used by operations.spec.js and axe.spec.js.
 *
 * ── WHO IS IN IT, AND WHY NOBODY IS NAMED HERE ──────────────────────────────────────────────────
 *
 * The card compares a file with the roster the app holds, so the file's people have to be members it
 * can record leave for — invented names would all land under "not compared". So two members are taken
 * from the roster AS IT STANDS, by rule (main-line CEAs with no start date, both recordable), and
 * never by name: a roster name typed here beside its leave is exactly what
 * payroll-anonymity.test.mjs exists to stop. Every DATE is found from that member's own pattern, so
 * a pattern edit moves a date rather than turning a working day into a rest day under the test.
 *
 *   member A — a day that matches, a day the app lacks, a day on a rest day, and a day only in the app
 *   member B — a day that matches, so one person needs a look and one agrees
 *
 * And one invented name, on the sheet but not in the app, for the "not compared" list. On request, a
 * member who has LEFT since the file was made — on the roster, hidden, also taken by rule — whose
 * records the card must not read.
 */
import { teamMembers, getBaseShift, parseISODate, isBankHoliday, isSunday } from '../roster-data.js';
import { leaveRecordability } from '../al-leave-compare.js';
import { entitlementFor } from '../al-entitlement.js';
import { sealLeaveFile, LEAVE_FILE_FORMAT, LEAVE_FILE_VERSION } from '../al-leave-file.js';

const YEAR = 2026;
const DAY_MS = 86_400_000;
/** @param {string} d */
const nextDay = d => new Date(Date.parse(`${d}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
/** @param {string} s */
export const isTimed = s => /^\d\d:\d\d-\d\d:\d\d$/.test(s);
/** @param {string} s */
const isResting = s => s === 'RD' || s === 'OFF';

/**
 * The first date from `from` — never a Sunday, a bank holiday or one already used — whose pattern
 * shift passes `want`.
 * @param {any} m @param {string} from @param {(shift: string) => boolean} want @param {string[]} [not]
 */
function findDay(m, from, want, not = []) {
    for (let d = from, i = 0; i < 300; d = nextDay(d), i++) {
        if (isSunday(d) || isBankHoliday(parseISODate(d)) || not.includes(d)) continue;
        if (want(getBaseShift(m, parseISODate(d)))) return d;
    }
    throw new Error(`no such day from ${from}`);
}

/** A grid day of leave, as Stage 1 writes it. @param {string} name @param {string} date */
const gridDay = (name, date) => ({ name, date, kind: 'leave', foundIn: 'grid', countedBySheet: true });
/** An override as Firestore holds it. @param {string} name @param {string} date */
const alRecord = (name, date) => ({ id: `${name}|${date}`, memberName: name, date, type: 'annual_leave', value: 'AL',
    note: '', source: 'manual', createdAt: 1_770_000_000_000 });

/**
 * A person whose figures agree with their own grid days, and whose allowance is the app's own — or
 * `off` days more than it, for the case of an allowance the two sides disagree about.
 * @param {any} m @param {number} used @param {number} [off]
 */
function person(m, used, off = 0) {
    const allowance = (entitlementFor(m, YEAR) ?? 32) + off;
    const printed = { carriedForward: 0, allowance, used, columnE: 0, remaining: allowance - used };
    return {
        name: m.name, grade: 'CEA',
        sheetRows: [{ row: 10, spelt: 'Sheet spelling', grade: 'CEA', used: true, printed }],
        columnE: { datedDays: 0, joinerReduction: 0, lump: 0, unexplained: 0 },
        corrected: { remaining: printed.remaining, because: [] },
    };
}

/**
 * The file, its text, the records the app holds, and the dates each case landed on.
 * @param {{ savedDaysAgo?: number|null, bAllowanceOff?: number, withLeaver?: boolean }} [o]  how long
 *        before today the clerks last saved the sheet (null: the file does not say), how many days more
 *        than the app's figure the sheet allows member B, and whether the file holds a member who has
 *        left since it was made
 */
export async function alSheetFixture({ savedDaysAgo = 2, bAllowanceOff = 0, withLeaver = false } = {}) {
    const [A, B] = teamMembers.filter(m => m.role === 'CEA' && m.rosterType === 'main' && !m.startDate
        && leaveRecordability(m, YEAR) === null);
    if (!A || !B) throw new Error('the roster no longer has two recordable main-line CEAs');
    const L = withLeaver ? teamMembers.find(m => leaveRecordability(m, YEAR) === 'leaver') : null;
    if (withLeaver && !L) throw new Error('the roster has no leaver to stand for one');

    const match = findDay(A, '2026-03-02', isTimed);
    const missing = findDay(A, '2026-03-02', isTimed, [match]);
    const restDay = findDay(A, '2026-03-02', isResting);
    const appOnly = findDay(A, '2026-04-06', isTimed, [match, missing]);
    const bMatch = findDay(B, '2026-05-04', isTimed);

    const today = new Date();
    const saved = savedDaysAgo === null ? null
        : new Date(today.getTime() - savedDaysAgo * DAY_MS).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const file = await sealLeaveFile({
        format: LEAVE_FILE_FORMAT, version: LEAVE_FILE_VERSION, year: YEAR,
        source: { sha256: 'e'.repeat(64), firstDate: `${YEAR}-01-01`, lastDate: `${YEAR + 1}-01-02`,
                  clerksLastSaved: saved, lastSavedByClerk: true },
        made: { on: today.toISOString().slice(0, 10), script: 'e2e fixture', appVersion: 'e2e' },
        nameMap: { rows: {}, cells: {}, tags: {} },
        // In code-unit order by name, as Stage 1 writes them.
        people: [person(A, 3), person(B, 1, bAllowanceOff), ...(L ? [person(L, 0)] : [])]
            .sort((p, q) => (p.name < q.name ? -1 : p.name > q.name ? 1 : 0)),
        days: [gridDay(A.name, match), gridDay(A.name, missing), gridDay(A.name, restDay), gridDay(B.name, bMatch)],
        absentFromWorkbook: [],
        notImported: [{ name: 'Z. Example', reason: 'not-in-app' }],
        unplacedSundayTags: 0,
    });
    return {
        text: JSON.stringify(file), file, A, B, L, year: YEAR,
        dates: { match, missing, restDay, appOnly, bMatch },
        records: [alRecord(A.name, match), alRecord(A.name, appOnly), alRecord(B.name, bMatch)],
    };
}
