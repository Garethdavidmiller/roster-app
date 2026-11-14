// @ts-check
/**
 * al-leave-file.js — the LEAVE FILE: what a valid one is, and how to tell it is the one that was made.
 *
 * ── WHY THERE IS A FILE BETWEEN THE WORKBOOK AND THE APP ────────────────────────────────────────
 *
 * The clerks' annual-leave workbook is a quota grid, not a leave register (docs/AL_WORKBOOK.md §1),
 * and every rule for reading it was learnt by getting it wrong once: the 2021 decoy sheet, comments
 * merged across 23 sheets, duplicate rows, misspelt names, Sunday tags in four spellings. So the app
 * never reads the workbook. A session reads it, following AL_WORKBOOK.md (scripts/make-leave-file.mjs,
 * "Stage 1"), and writes this file; the Operations card reads the FILE (operations-al-sheet.js,
 * "Stage 2"). This module is the contract between the two, and both import it, so they cannot
 * disagree about what a valid file is or how its seal is worked out (docs/AL_UPLOADER_PLAN.md §3).
 *
 * ── WHAT THE FILE PROMISES, AND HOW THE APP CHECKS IT RATHER THAN TRUSTING IT ───────────────────
 *
 *   · Names are the APP's, never the sheet's. Every sheet row a person has is listed (`sheetRows`),
 *     with which one was used and why, because the sheet holds the same person twice (§8 defect 1).
 *   · Every day says where it was found and whether the sheet's own total counts it (`foundIn`,
 *     `countedBySheet`), so a misspelt day or an over-quota day with a blank count is still that
 *     person's leave (owner, 14 Nov 2026) and is not mistaken for one the sheet charged.
 *   · The sheet's own printed figures travel with it, and `personSums` re-adds every person's days
 *     against them. A day dropped while the file was made then fails HERE — it does not pass because
 *     the stage that made the file marked its own work.
 *   · A SEAL (`digest`): SHA-256 over one canonical form of everything else. A file edited by hand is
 *     refused, never half-trusted (owner's decision, 14 Nov 2026) — a correction goes back through a
 *     session, which is the only place the method lives.
 *
 * ── REFUSALS ARE RETURNED, NEVER THROWN ─────────────────────────────────────────────────────────
 *
 * The file names people against their dates of leave. A thrown error reaches the Error Log with its
 * message (error-reporter.js keeps 300 characters of any uncaught one), and `JSON.parse`'s message
 * quotes the text it failed on. So every way a file can be wrong comes back as a coded refusal, and
 * the parse error's own message is never read, kept or shown.
 *
 * Pure: no DOM, no Firebase, no app module. It must load in Node (Stage 1) and in the browser alike.
 */

export const LEAVE_FILE_FORMAT = 'myb-annual-leave';
export const LEAVE_FILE_VERSION = 1;
/** How old the clerks' copy may be before the card warns that it needs a fresh one (owner, 14 Nov 2026). */
export const LEAVE_FILE_MAX_AGE_DAYS = 14;
/** The real 2026 file is about 200 KB; a file ten times that is not one. */
export const LEAVE_FILE_MAX_BYTES = 2_000_000;

export const GRADES = Object.freeze(['CEA', 'CES', 'DISP']);
export const DAY_KINDS = Object.freeze(['leave', 'sunday-tag', 'sunday-counted']);

/**
 * Where a day was found, which kinds of day it may be, and whether the sheet's own total counts it.
 * Fixed per place, so `countedBySheet` can be checked rather than believed.
 * @type {Readonly<Record<string, { kinds: string[], counted: boolean }>>}
 */
export const FOUND_IN = Object.freeze({
    'grid':               { kinds: ['leave', 'sunday-counted'], counted: true },   // the row's own COUNTIF finds it
    'grid-misspelt':      { kinds: ['leave'], counted: false },   // their name, spelt another way (§8 defect 9)
    'column-e':           { kinds: ['leave'], counted: true },    // over quota, dated in column E's comment (§5)
    'column-e-uncounted': { kinds: ['leave'], counted: false },   // dated in the comment, the count left blank (defect 7)
    'no-totals-row':      { kinds: ['leave'], counted: false },   // in the grid, and no totals row counts it (defect 10)
    'grid-tag':           { kinds: ['sunday-tag'], counted: false },   // `N/A <name>` on a Sunday — never leave (§4)
});

/** Why a sheet row was NOT the one used for a person. */
export const ROW_WHY = Object.freeze(['duplicate-identical', 'duplicate-stale', 'duplicate-missing-column-e', 'duplicate-chosen']);
/** Why somebody on the sheet is not in the file's people. Codes, so there is no free text to render. */
export const NOT_IMPORTED_REASONS = Object.freeze(['leaver', 'manager', 'no-allowance', 'not-in-app']);
/** Why a person's corrected remaining differs from the sheet's printed one. */
export const CORRECTED_BECAUSE = Object.freeze(['grid-misspelt', 'column-e-blank', 'sunday-counted']);

const TOP_FIELDS = ['format', 'version', 'year', 'source', 'made', 'nameMap', 'people', 'days',
    'absentFromWorkbook', 'notImported', 'unplacedSundayTags', 'digest'];
const MAX_REFUSALS = 25;
const NAME_MAX = 80;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const HEX64 = /^[0-9a-f]{64}$/;
const SEAL = /^sha256:[0-9a-f]{64}$/;

/**
 * @typedef {{ carriedForward: number, allowance: number, used: number, columnE: number, remaining: number }} Printed
 * @typedef {{ row: number, spelt: string, grade: string, used: boolean, why?: string, printed: Printed }} SheetRow
 * @typedef {{ datedDays: number, joinerReduction: number, lump: number, unexplained: number }} ColumnE
 * @typedef {{ name: string, grade: string, sheetRows: SheetRow[], columnE: ColumnE|null,
 *             corrected: { remaining: number, because: string[] }|null }} LeavePerson
 * @typedef {{ name: string, date: string, kind: string, foundIn: string, countedBySheet: boolean, leaveYear?: number }} LeaveDay
 * @typedef {{ code: string, name?: string, date?: string, field?: string }} Refusal
 */

// ── The canonical form and the seal ─────────────────────────────────────────────────────────────

/**
 * One JSON text for a value: object keys sorted (JavaScript's default string order), no whitespace,
 * arrays in their own order, every scalar exactly as `JSON.stringify` writes it. Both stages seal
 * and check through this one function, and leave-file.test.mjs pins it to a fixed vector, so a
 * change here is a change of format, not a refactor.
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalJson(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
    if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
    const obj = /** @type {Record<string, unknown>} */ (value);
    const keys = Object.keys(obj).filter(k => obj[k] !== undefined).sort();
    return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalJson(obj[k])).join(',') + '}';
}

/** @param {string} text @returns {Promise<string>} lowercase hex */
async function sha256Hex(text) {
    const bytes = new TextEncoder().encode(text);
    const buf = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The seal a file should carry: SHA-256 over the canonical form of every field but `digest`.
 * @param {Record<string, unknown>} file
 * @returns {Promise<string>} `sha256:<hex>`
 */
export async function leaveFileDigest(file) {
    const { digest: _ignored, ...rest } = file;
    return 'sha256:' + await sha256Hex(canonicalJson(rest));
}

/**
 * The file with its seal set — what Stage 1 writes.
 * @template {Record<string, unknown>} T
 * @param {T} file
 * @returns {Promise<T & { digest: string }>}
 */
export async function sealLeaveFile(file) {
    return { ...file, digest: await leaveFileDigest(file) };
}

// ── Small pure date helpers (no app import: this module loads in Node without the roster) ─────────

/** @param {unknown} s @returns {s is string} a real calendar date, `YYYY-MM-DD` */
export function isRealIsoDate(s) {
    if (typeof s !== 'string' || !ISO_DATE.test(s)) return false;
    const [y, m, d] = s.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1, d));
    return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** @param {string} iso a real date @returns {boolean} */
export function isSundayIso(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 0;
}

/** @param {string} iso @returns {boolean} 25 or 26 December */
export function isChristmasIso(iso) {
    return iso.endsWith('-12-25') || iso.endsWith('-12-26');
}

/**
 * Whole days from the clerks' last save to `todayStr`, or null when the file does not know it. The
 * save time is UTC; its date is taken as it stands, which can read a day early for a save in the hour
 * after midnight in summer — a day either way does not change what the age is for.
 * @param {{ source?: { clerksLastSaved?: string|null } }} file
 * @param {string} todayStr `YYYY-MM-DD`
 * @returns {number|null}
 */
export function leaveFileAgeDays(file, todayStr) {
    const saved = file?.source?.clerksLastSaved;
    if (typeof saved !== 'string' || !ISO_INSTANT.test(saved) || !isRealIsoDate(todayStr)) return null;
    const ms = Date.parse(`${todayStr}T00:00:00Z`) - Date.parse(`${saved.slice(0, 10)}T00:00:00Z`);
    return Math.round(ms / 86_400_000);
}

// ── The sums the sheet's own figures must agree with ────────────────────────────────────────────

/** @param {LeavePerson} person @returns {SheetRow|null} the row the person's figures come from */
export function usedRow(person) {
    return Array.isArray(person?.sheetRows) ? (person.sheetRows.find(r => r && r.used === true) ?? null) : null;
}

/**
 * Which of the four sums fail for one person, given their days. Empty means the file agrees with the
 * sheet's printed figures:
 *   used       — days the row's own count finds (the grid, a plain-name Sunday) = the printed Used;
 *   column-e   — dated over-quota days + the undated parts = the printed column E;
 *   remaining  — every row: carried forward + allowance − (Used + column E) = the printed Remaining,
 *                which is the sheet's own formula (AL_WORKBOOK.md §3), so a misread figure shows;
 *   corrected  — the corrected remaining = the printed one, less the leave the sheet's total misses,
 *                plus a Sunday it charges, and `because` names exactly those.
 * A person with no totals row has no figures: every leave day must then be `no-totals-row`.
 * @param {LeavePerson} person
 * @param {LeaveDay[]} days that person's days
 * @returns {string[]}
 */
export function personSums(person, days) {
    const out = [];
    const rows = Array.isArray(person.sheetRows) ? person.sheetRows : [];
    const row = usedRow(person);
    const count = (/** @type {(d: LeaveDay) => boolean} */ f) => days.filter(f).length;
    if (!row) {
        if (rows.length || person.columnE !== null || person.corrected !== null
            || count(d => d.kind !== 'sunday-tag' && d.foundIn !== 'no-totals-row')) out.push('no-row');
        return out;
    }
    if (count(d => d.foundIn === 'no-totals-row')) out.push('no-row');
    if (count(d => d.foundIn === 'grid') !== row.printed.used) out.push('used');
    const e = person.columnE;
    const dated = count(d => d.foundIn === 'column-e');
    if (!e || e.datedDays !== dated
        || dated + e.joinerReduction + e.lump + e.unexplained !== row.printed.columnE) out.push('column-e');
    for (const r of rows) {
        const p = r.printed;
        if (p.carriedForward + p.allowance - (p.used + p.columnE) !== p.remaining) { out.push('remaining'); break; }
    }
    const misspelt = count(d => d.foundIn === 'grid-misspelt');
    const blankE = count(d => d.foundIn === 'column-e-uncounted');
    const sundays = count(d => d.kind === 'sunday-counted');
    const because = [misspelt && 'grid-misspelt', blankE && 'column-e-blank', sundays && 'sunday-counted'].filter(Boolean).sort();
    const c = person.corrected;
    if (!c || c.remaining !== row.printed.remaining - misspelt - blankE + sundays
        || canonicalJson([...c.because].sort()) !== canonicalJson(because)) out.push('corrected');
    return out;
}

// ── Reading a file ──────────────────────────────────────────────────────────────────────────────

/**
 * Read a leave file from its text: refused by name, never defaulted. Order matters — the seal is
 * checked before the structure, because a file that is not what was made is refused as such
 * whatever else is wrong with it, and a sealed file that still fails is a fault in Stage 1.
 * @param {string} text
 * @returns {Promise<{ ok: true, file: any } | { ok: false, refusals: Refusal[] }>}
 */
export async function readLeaveFile(text) {
    if (typeof text !== 'string' || !text.trim()) return { ok: false, refusals: [{ code: 'empty' }] };
    if (text.length > LEAVE_FILE_MAX_BYTES) return { ok: false, refusals: [{ code: 'too-large' }] };
    /** @type {any} */ let file;
    // The parse error is DISCARDED, not reported: its message quotes the file (header).
    try { file = JSON.parse(text); } catch { return { ok: false, refusals: [{ code: 'not-json' }] }; }
    if (!file || typeof file !== 'object' || Array.isArray(file) || file.format !== LEAVE_FILE_FORMAT) {
        return { ok: false, refusals: [{ code: 'not-a-leave-file' }] };
    }
    if (file.version !== LEAVE_FILE_VERSION) {
        const newer = Number.isInteger(file.version) && file.version > LEAVE_FILE_VERSION;
        return { ok: false, refusals: [{ code: newer ? 'newer-version' : 'unknown-version' }] };
    }
    if (typeof file.digest !== 'string' || !SEAL.test(file.digest)) return { ok: false, refusals: [{ code: 'not-sealed' }] };
    // `crypto.subtle` exists only in a secure context. The app is always served over HTTPS, but a
    // page without it must still refuse rather than throw (header).
    /** @type {string} */ let seal;
    try { seal = await leaveFileDigest(file); } catch { return { ok: false, refusals: [{ code: 'cannot-check-seal' }] }; }
    if (seal !== file.digest) return { ok: false, refusals: [{ code: 'changed-since-made' }] };
    const refusals = validateLeaveFile(file);
    return refusals.length ? { ok: false, refusals } : { ok: true, file };
}

/**
 * Every structural rule and every sum, for a file already parsed. The seal is NOT checked here
 * (`readLeaveFile` does, and Stage 1 runs this before sealing). At most MAX_REFUSALS are returned,
 * the last of them saying how many more there were.
 * @param {any} file
 * @returns {Refusal[]}
 */
export function validateLeaveFile(file) {
    /** @type {Refusal[]} */ const out = [];
    let more = 0;
    /** @param {Refusal} r */
    const refuse = r => { if (out.length < MAX_REFUSALS) out.push(r); else more++; };
    /** @param {string} field */
    const bad = field => refuse({ code: 'bad-field', field });
    const isObj = (/** @type {any} */ v) => !!v && typeof v === 'object' && !Array.isArray(v);
    const isName = (/** @type {any} */ v) => typeof v === 'string' && v.trim() === v && v.length > 0 && v.length <= NAME_MAX;
    const isCount = (/** @type {any} */ v) => Number.isInteger(v) && v >= 0 && v <= 1000;
    const only = (/** @type {any} */ o, /** @type {string[]} */ keys) => Object.keys(o).every(k => keys.includes(k));

    if (!isObj(file)) return [{ code: 'not-a-leave-file' }];
    for (const k of Object.keys(file)) if (!TOP_FIELDS.includes(k)) bad(k);
    if (file.format !== LEAVE_FILE_FORMAT) return [{ code: 'not-a-leave-file' }];
    if (file.version !== LEAVE_FILE_VERSION) return [{ code: 'unknown-version' }];
    const year = file.year;
    if (!Number.isInteger(year) || year < 2020 || year > 2100) return [{ code: 'bad-field', field: 'year' }];

    // source
    const s = file.source;
    if (!isObj(s) || !only(s, ['sha256', 'firstDate', 'lastDate', 'clerksLastSaved', 'lastSavedByClerk'])
        || typeof s.sha256 !== 'string' || !HEX64.test(s.sha256)
        || s.firstDate !== `${year}-01-01` || !isRealIsoDate(s.lastDate)
        || s.lastDate < `${year}-12-31` || s.lastDate > `${year + 1}-01-31`
        || !(s.clerksLastSaved === null || (typeof s.clerksLastSaved === 'string' && ISO_INSTANT.test(s.clerksLastSaved)))
        || !(s.lastSavedByClerk === null || typeof s.lastSavedByClerk === 'boolean')) {
        bad('source');
        return finish();
    }

    // made
    const m = file.made;
    if (!isObj(m) || !only(m, ['on', 'script', 'appVersion']) || !isRealIsoDate(m.on)
        || typeof m.script !== 'string' || m.script.length > 64 || typeof m.appVersion !== 'string' || m.appVersion.length > 16) bad('made');

    // nameMap — carried for the NEXT run (AL_UPLOADER_PLAN.md §3.4); the app never renders it.
    const nm = file.nameMap;
    if (!isObj(nm) || !only(nm, ['rows', 'cells', 'tags'])
        || !['rows', 'cells', 'tags'].every(k => isObj(nm[k]) && Object.entries(nm[k]).every(
            ([key, v]) => key.length > 0 && key.length <= 120 && (v === null || isName(v))))) bad('nameMap');

    if (!isCount(file.unplacedSundayTags)) bad('unplacedSundayTags');

    // people
    /** @type {Map<string, LeavePerson>} */ const people = new Map();
    // A person refused for their own entry is not refused AGAIN for each of their days.
    const malformed = new Set();
    if (!Array.isArray(file.people) || file.people.length > 500) { bad('people'); return finish(); }
    for (const p of file.people) {
        if (!isObj(p) || !isName(p.name)) { bad('people'); continue; }
        if (people.has(p.name)) { refuse({ code: 'duplicate-person', name: p.name }); continue; }
        if (!only(p, ['name', 'grade', 'sheetRows', 'columnE', 'corrected'])
            || !GRADES.includes(p.grade) || !Array.isArray(p.sheetRows) || p.sheetRows.length > 6) { malformed.add(p.name); bad(`people:${p.name}`); continue; }
        const rowsOk = p.sheetRows.every((/** @type {any} */ r) => isObj(r)
            && only(r, ['row', 'spelt', 'grade', 'used', 'why', 'printed'])
            && Number.isInteger(r.row) && r.row >= 1 && r.row <= 100_000 && isName(r.spelt) && GRADES.includes(r.grade)
            && typeof r.used === 'boolean' && (r.used ? r.why === undefined : ROW_WHY.includes(r.why))
            && isObj(r.printed) && only(r.printed, ['carriedForward', 'allowance', 'used', 'columnE', 'remaining'])
            && ['carriedForward', 'allowance', 'used', 'columnE'].every(k => isCount(r.printed[k]))
            && Number.isInteger(r.printed.remaining) && Math.abs(r.printed.remaining) <= 1000);
        const usedCount = p.sheetRows.filter((/** @type {any} */ r) => r && r.used === true).length;
        const figuresOk = p.sheetRows.length
            ? usedCount === 1 && isObj(p.columnE) && only(p.columnE, ['datedDays', 'joinerReduction', 'lump', 'unexplained'])
              && ['datedDays', 'joinerReduction', 'lump', 'unexplained'].every(k => isCount(p.columnE[k]))
              && isObj(p.corrected) && only(p.corrected, ['remaining', 'because']) && Number.isInteger(p.corrected.remaining)
              && Array.isArray(p.corrected.because) && p.corrected.because.every((/** @type {any} */ b) => CORRECTED_BECAUSE.includes(b))
            : p.columnE === null && p.corrected === null;
        if (!rowsOk || !figuresOk) { malformed.add(p.name); bad(`people:${p.name}`); continue; }
        people.set(p.name, p);
    }

    // days
    /** @type {Map<string, LeaveDay[]>} */ const byName = new Map();
    if (!Array.isArray(file.days) || file.days.length > 20_000) { bad('days'); return finish(); }
    const seen = new Set();
    for (const d of file.days) {
        if (!isObj(d) || !only(d, ['name', 'date', 'kind', 'foundIn', 'countedBySheet', 'leaveYear']) || !isName(d.name)) { bad('days'); continue; }
        const where = { name: d.name, date: typeof d.date === 'string' ? d.date : '' };
        if (malformed.has(d.name)) continue;
        if (!isRealIsoDate(d.date)) { refuse({ code: 'bad-date', ...where }); continue; }
        if (!people.has(d.name)) { refuse({ code: 'unknown-person', name: d.name }); continue; }
        const rule = FOUND_IN[d.foundIn];
        if (!DAY_KINDS.includes(d.kind) || !rule || !rule.kinds.includes(d.kind) || d.countedBySheet !== rule.counted) {
            refuse({ code: 'bad-day', ...where }); continue;
        }
        const key = `${d.name}|${d.date}`;
        if (seen.has(key)) { refuse({ code: 'duplicate-day', ...where }); continue; }
        seen.add(key);
        if (d.date < s.firstDate || d.date > s.lastDate) { refuse({ code: 'outside-sheet', ...where }); continue; }
        const sunday = isSundayIso(d.date);
        if (d.kind === 'leave' && sunday) { refuse({ code: 'sunday-leave', ...where }); continue; }
        if (d.kind !== 'leave' && !sunday) { refuse({ code: 'bad-day', ...where }); continue; }
        if (d.kind === 'leave' && isChristmasIso(d.date)) { refuse({ code: 'christmas-leave', ...where }); continue; }
        // A day in NEXT January on this year's sheet comes out of this year's allowance, and says so.
        const nextYear = d.date.startsWith(`${year + 1}-`);
        const yearOk = d.kind === 'leave' && nextYear ? d.leaveYear === year : d.leaveYear === undefined;
        if (!yearOk) { refuse({ code: 'bad-leave-year', ...where }); continue; }
        const list = byName.get(d.name) ?? [];
        list.push(d);
        byName.set(d.name, list);
    }

    // the sums, person by person — the file must agree with the sheet's own printed figures
    for (const p of people.values()) {
        for (const sum of personSums(p, byName.get(p.name) ?? [])) refuse({ code: `sum-${sum}`, name: p.name });
    }

    // who is not in it, and why
    const listed = new Set(people.keys());
    if (!Array.isArray(file.notImported) || !file.notImported.every((/** @type {any} */ n) => isObj(n)
        && only(n, ['name', 'reason']) && isName(n.name) && NOT_IMPORTED_REASONS.includes(n.reason))) bad('notImported');
    else for (const n of file.notImported) {
        if (listed.has(n.name)) refuse({ code: 'duplicate-person', name: n.name });
        listed.add(n.name);
    }
    if (!Array.isArray(file.absentFromWorkbook) || !file.absentFromWorkbook.every(isName)) bad('absentFromWorkbook');
    else for (const n of file.absentFromWorkbook) {
        if (listed.has(n)) refuse({ code: 'duplicate-person', name: n });
        listed.add(n);
    }
    return finish();

    function finish() {
        if (more) out.push({ code: 'more', field: String(more) });
        return out;
    }
}

// ── What a refusal says ─────────────────────────────────────────────────────────────────────────

const SUM_WORDS = /** @type {Record<string, string>} */ ({
    'sum-used': 'the days in the grid do not add up to the sheet’s own Used figure',
    'sum-column-e': 'the over-quota days do not add up to the sheet’s own column E',
    'sum-remaining': 'the sheet’s own figures do not add up (carried forward + allowance − used − over quota)',
    'sum-corrected': 'the corrected figure does not follow from the days',
    'sum-no-row': 'the days do not match whether the sheet has a totals row',
});

/**
 * The sentence for a refusal — plain text, for `textContent` and for the Stage 1 script's output.
 * @param {Refusal} r
 * @returns {string}
 */
export function describeRefusal(r) {
    const who = r.name ? `${r.name}: ` : '';
    const on = r.date ? ` (${r.date})` : '';
    switch (r.code) {
    case 'empty': return 'Nothing was chosen or pasted.';
    case 'too-large': return 'This file is too large to be a leave file.';
    case 'not-json':
    case 'not-a-leave-file': return 'This is not a leave file. Choose the .json file a session made from the clerks’ workbook.';
    case 'newer-version': return 'This leave file was made by a newer method than this copy of the app knows. Reload the app to update it, then try again.';
    case 'unknown-version': return 'This leave file’s version is not one the app knows.';
    case 'not-sealed':
    case 'changed-since-made': return 'This leave file has been changed since it was made, so it is not used. Ask a session for a fresh one: corrections go back through the session, never into the file.';
    case 'duplicate-person': return `${who}listed twice.`;
    case 'unknown-person': return `${who}has days in the file but no entry of their own.`;
    case 'bad-date': return `${who}a date that is not a real date${on}.`;
    case 'bad-day': return `${who}a day that is not in the expected form${on}.`;
    case 'duplicate-day': return `${who}the same date twice${on}.`;
    case 'outside-sheet': return `${who}a date outside the sheet’s own dates${on}.`;
    case 'sunday-leave': return `${who}leave on a Sunday${on}. The app never records leave on a Sunday.`;
    case 'christmas-leave': return `${who}leave on Christmas Day or Boxing Day${on}, which the sheet marks closed.`;
    case 'bad-leave-year': return `${who}a day charged to the wrong year’s allowance${on}.`;
    case 'cannot-check-seal': return 'This browser cannot check the file’s seal, so it is not used. Open Operations over https and try again.';
    case 'more': return `And ${r.field} more.`;
    case 'bad-field': return `Part of the file is not in the expected form${r.field ? ` (${r.field})` : ''}.`;
    default: return SUM_WORDS[r.code] ? `${who}${SUM_WORDS[r.code]}.` : 'The file could not be read.';
    }
}
