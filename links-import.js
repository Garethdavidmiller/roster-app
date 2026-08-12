// @ts-check
/**
 * links-import.js — turning somebody ELSE's roster proposal into a design this app can hold.
 *
 * Pure: no DOM, no Firebase, no imports beyond `links-design.js`'s own pure helpers. The UI half is
 * in `links-app.js`. Tested by links-import.test.mjs.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────────
 *
 * Every design in the workspace so far was either auto-generated or painted cell by cell. Proposals
 * do not arrive that way. They arrive as a photograph of a handwritten sheet, a Word table, or a
 * column out of one of the Dec 2026 simplifier spreadsheets — and the only route in was 168 taps,
 * which is enough friction that a colleague's idea simply never gets compared against anything.
 * That is the failure this removes: not typing effort, but proposals that are never assessed.
 *
 * ── IT IS A TRUST BOUNDARY, AND THAT IS THE WHOLE JOB ───────────────────────────────────────────
 *
 * `paycalc-transfer.js`'s `validateBackup` is the model. Text pasted from outside is not data yet;
 * it is a claim about data. Everything here exists to turn that claim into either a design or a
 * refusal, and **never into a half-design**. The specific hazards, in the order they bite:
 *
 *   · A cell nobody can read. Refused BY NAME with its week and day, never silently dropped and
 *     never quietly defaulted to a rest day — a proposal that imports "successfully" with four
 *     duties missing looks lighter than it is, and the hours panel would then report a comfortable
 *     average for a week nobody actually proposed.
 *   · A row of the wrong width. Seven days or nothing. A six-column row is not a week with a
 *     missing day, it is a paste that lost a column, and guessing WHICH column is guessing at
 *     somebody's rest days.
 *   · A week number outside the rotation, or the same week twice. Both mean the paste and the
 *     rotation disagree about what is being described, and silently keeping the last one wins an
 *     argument the reader did not know was happening.
 *
 * ── WARNINGS ARE NOT ERRORS, AND THE DIFFERENCE IS DELIBERATE ───────────────────────────────────
 *
 * A refusal means "this text does not describe a design". A warning means "it does, and here is
 * what I had to decide for you" — a short rotation, or a token that had no exact home. The caller
 * shows warnings BEFORE the save, not after: a decision reported once the write has happened is a
 * notification, not a choice.
 *
 * ── WHAT IT DELIBERATELY DOES NOT DO ────────────────────────────────────────────────────────────
 *
 * No hours arithmetic, no coverage, no verdict of any kind. The design goes into the workspace and
 * the workspace's own panels assess it, exactly as they assess a generated one — an importer that
 * scored its own input would be a second opinion competing with `runDesignChecks`, and the first
 * time the two disagreed nobody would know which to believe.
 */

import { DAYS, canonicaliseShift, ROTATING_LINES } from './links-design.js';

/** How long a pasted design name may be — matches the picker's own limit. */
export const MAX_IMPORT_NAME = 100;

/**
 * Tokens that mean "this person is not working that day", mapped to the app's one non-worked value.
 *
 * `NA` earns its place here and is the reason the map exists at all. Marylebone's Sundays are
 * non-contracted, so a paper roster commonly writes `NA` in the Sunday column for "no Sunday duty"
 * while using `RD` for a rest day in a contracted week. The app has ONE non-worked state, so the
 * distinction cannot survive — and the caller is told so in a warning rather than left to discover
 * it from a grid that quietly disagrees with the sheet it came from.
 */
const REST_TOKENS = new Map([
    ['RD', 'RD'], ['R', 'RD'], ['REST', 'RD'], ['REST DAY', 'RD'],
    ['OFF', 'OFF'], ['O', 'OFF'],
    ['NA', 'RD'], ['N/A', 'RD'], ['-', 'RD'], ['–', 'RD'], ['—', 'RD'],
]);

/** Tokens that mean a spare (cover) day. */
const SPARE_TOKENS = new Set(['SP', 'SPARE', 'S', 'COVER']);

/** A duty time in any of the shapes a person actually types or a spreadsheet exports. */
const TIME_RE = /^(\d{1,2})[:.](\d{2})\s*(?:-|–|—|to)\s*(\d{1,2})[:.](\d{2})$/i;

/**
 * One cell → the value the design stores, or null when it cannot be read.
 *
 * Returns `{ value }` or `{ error }` — never a bare string, because "" and "RD" are both legitimate
 * values and a caller distinguishing them from a failure by falsiness gets it wrong on the empty
 * cell, which is the commonest cell in a roster.
 * @param {string} raw
 * @returns {{ value: string, assumed?: string } | { error: string }}
 */
export function parseCell(raw) {
    const t = String(raw ?? '').trim();
    // An EMPTY cell is a rest day. That is the one silent default here and it is safe in the
    // direction that matters: a blank on a roster sheet means nothing is worked, and the mistake it
    // could hide (a duty somebody forgot to write down) is not one the importer can invent.
    if (!t) return { value: 'RD' };

    const upper = t.toUpperCase().replace(/\s+/g, ' ');
    if (SPARE_TOKENS.has(upper)) return { value: 'SPARE' };
    const rest = REST_TOKENS.get(upper);
    // The assumption is reported for anything that is not literally the value stored — `NA` becomes
    // a rest day and the reader has to be told, because their sheet drew a distinction we cannot.
    if (rest) return upper === rest ? { value: rest } : { value: rest, assumed: `“${t}” read as ${rest}` };

    const m = TIME_RE.exec(t);
    if (!m) return { error: `“${t}” is not a time, a rest day or a spare day` };
    const [, h1, m1, h2, m2] = m;
    if (+h1 > 23 || +h2 > 23) return { error: `“${t}” is not a real time` };
    // Round-tripped through the app's own canonicaliser rather than formatted here, so an imported
    // time is byte-identical to a painted one. Two spellings of the same duty would defeat every
    // comparison the workspace makes.
    const value = canonicaliseShift(`${h1.padStart(2, '0')}:${m1}-${h2.padStart(2, '0')}:${m2}`);
    return typeof value === 'string' && /^\d{2}:\d{2}-\d{2}:\d{2}$/.test(value)
        ? { value }
        : { error: `“${t}” is not a real time` };
}

/** Split one line into cells: tabs first, then commas, then runs of two-or-more spaces.
 * @param {string} line */
function splitRow(line) {
    if (line.includes('\t')) return line.split('\t');
    if (line.includes(',')) return line.split(',');
    return line.split(/ {2,}/);
}

/** True for a header row — the day names, in any order or casing.
 * @param {string[]} cells */
function isHeaderRow(cells) {
    const names = new Set(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat',
        'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']);
    return cells.filter(c => names.has(String(c).trim().toLowerCase())).length >= 4;
}

/**
 * Parse a pasted grid: one line per rotation week, seven day cells, optionally led by a week number
 * and optionally trailed by an hours total.
 *
 * ── WHY THE WEEK NUMBER IS OPTIONAL BUT HONOURED ────────────────────────────────────────────────
 *
 * A spreadsheet column pasted straight in has no numbers and its order IS the rotation. A Word
 * table transcribed from a handwritten sheet usually has them, and where it does they are the
 * author's own statement about which line is which — so they win over position. Mixing the two in
 * one paste is refused rather than reconciled: if some rows say where they belong and others do
 * not, any rule for placing the silent ones is the importer inventing a rotation.
 *
 * A trailing HOURS column is DISCARDED, deliberately and without a warning. It is the author's
 * arithmetic about their own sheet; the workspace computes hours from the duties, and keeping a
 * second figure beside the first is how two numbers for one fact end up on a screen.
 *
 * @param {string} text
 * @param {{ lines?: number }} [opts]
 * @returns {{ ok: true, patterns: Record<string, Record<string, string>>, warnings: string[] }
 *          | { ok: false, error: string }}
 */
export function parseGrid(text, { lines = ROTATING_LINES } = {}) {
    // The LINE is not trimmed before splitting, only each cell afterwards. Trimming first eats
    // trailing tabs — and a week whose Friday and Saturday are rest days exports from a spreadsheet
    // as exactly that: two empty trailing cells. Losing them turned a valid seven-day row into a
    // five-column one and refused it with a message about separators.
    const rows = String(text ?? '').split(/\r?\n/)
        .filter(l => l.trim() !== '')
        .map(splitRow)
        .map((/** @type {string[]} */ cells) => cells.map((/** @type {string} */ c) => String(c).trim()))
        .filter(cells => !isHeaderRow(cells));
    if (!rows.length) return { ok: false, error: 'There is nothing to import.' };

    // Numbering is decided over the WHOLE paste before a single cell is read. It used to be counted
    // as the rows were built, which let a duplicate-week refusal fire first and report "Week 1
    // appears twice" about a paste whose actual fault was that only some rows were numbered — an
    // accurate sentence pointing at the wrong problem.
    const looksNumbered = (/** @type {string[]} */ cells) => cells.length > 7 && /^\d{1,3}$/.test(cells[0]);
    const numbered = rows.filter(looksNumbered).length;
    if (numbered && numbered !== rows.length) {
        return { ok: false, error: `${numbered} of ${rows.length} rows are numbered. `
            + 'Either number every row or none of them — otherwise the unnumbered ones have no place in the rotation.' };
    }

    /** @type {Record<string, Record<string, string>>} */
    const patterns = {};
    /** @type {string[]} */
    const warnings = [];
    /** @type {Set<string>} */
    const assumptions = new Set();

    for (let i = 0; i < rows.length; i++) {
        let cells = rows[i];
        const at = `Row ${i + 1}`;
        // A leading integer is a week number; a trailing one is an hours total. Both are stripped
        // before the width check, so the seven-day rule below is about DAYS and nothing else.
        let week = null;
        if (looksNumbered(cells)) { week = Number(cells[0]); cells = cells.slice(1); }
        if (cells.length === 8 && /^\d{1,3}(\.\d+)?$/.test(cells[7])) cells = cells.slice(0, 7);

        if (cells.length !== 7) {
            return { ok: false, error: `${at} has ${cells.length} day columns, not 7. `
                + 'Each row needs Sunday to Saturday — check for a missing or extra separator.' };
        }
        const pos = String(week ?? (i + 1));
        if (week !== null && (week < 1 || week > lines)) {
            return { ok: false, error: `${at} is numbered ${week}, which is outside the ${lines}-line rotation.` };
        }
        if (patterns[pos]) return { ok: false, error: `Week ${pos} appears twice.` };

        /** @type {Record<string, string>} */
        const row = {};
        for (let d = 0; d < 7; d++) {
            const res = parseCell(cells[d]);
            if ('error' in res) {
                return { ok: false, error: `${at}, ${DAYS[d].toUpperCase()}: ${res.error}.` };
            }
            row[DAYS[d]] = res.value;
            if (res.assumed) assumptions.add(res.assumed);
        }
        patterns[pos] = row;
    }

    const count = Object.keys(patterns).length;
    if (count > lines) {
        return { ok: false, error: `That is ${count} weeks, and the rotation is ${lines} lines.` };
    }
    // SHORT is a warning, not a refusal: a half-drafted proposal is a real thing to want in the
    // workspace, and the design panels already report an unfilled line better than this could.
    if (count < lines) {
        warnings.push(`Only ${count} of ${lines} lines are filled — the rest stay empty, and the `
            + 'design checks will flag them.');
    }
    for (const a of assumptions) warnings.push(a);
    return { ok: true, patterns, warnings };
}

/**
 * Parse a pasted design in EITHER shape — the app's own JSON, or a grid.
 *
 * JSON is tried first and only when the text actually looks like an object, so a grid that happens
 * to start with a brace-shaped scribble still reaches the grid parser with a grid-shaped error
 * message. A JSON payload that parses but carries no `patterns` is refused rather than falling
 * through to the grid parser, which would report "not a time" about a line of JSON — an error
 * message that sends the reader to entirely the wrong place.
 *
 * @param {string} text
 * @param {{ lines?: number }} [opts]
 * @returns {{ ok: true, name: string, patterns: Record<string, Record<string, string>>, warnings: string[] }
 *          | { ok: false, error: string }}
 */
export function parseDesignImport(text, { lines = ROTATING_LINES } = {}) {
    const text_ = String(text ?? '');
    // Trimmed ONLY to decide "is there anything here" and "does this look like JSON". The grid
    // parser is handed the ORIGINAL: a trim eats the trailing tabs of the last line, and the last
    // line of a pasted rotation is as likely as any other to end in two rest days — which is
    // exactly the row this fix was made for one level down, undone here.
    const raw = text_.trim();
    if (!raw) return { ok: false, error: 'Paste a design first.' };

    if (raw.startsWith('{')) {
        let obj;
        try { obj = JSON.parse(raw); } catch { return { ok: false, error: 'That looks like JSON but it is not valid.' }; }
        const src = obj && typeof obj === 'object' && obj.patterns && typeof obj.patterns === 'object'
            ? obj.patterns : null;
        if (!src) return { ok: false, error: 'That JSON has no “patterns” in it.' };

        /** @type {Record<string, Record<string, string>>} */
        const patterns = {};
        /** @type {Set<string>} */
        const assumptions = new Set();
        for (const [pos, row] of Object.entries(src)) {
            if (!/^\d{1,3}$/.test(pos)) return { ok: false, error: `“${pos}” is not a line number.` };
            if (+pos < 1 || +pos > lines) return { ok: false, error: `Line ${pos} is outside the ${lines}-line rotation.` };
            if (!row || typeof row !== 'object') return { ok: false, error: `Line ${pos} is not a week.` };
            /** @type {Record<string, string>} */
            const out = {};
            for (const d of DAYS) {
                const res = parseCell(/** @type {any} */ (row)[d]);
                if ('error' in res) return { ok: false, error: `Line ${pos}, ${d.toUpperCase()}: ${res.error}.` };
                out[d] = res.value;
                if (res.assumed) assumptions.add(res.assumed);
            }
            patterns[pos] = out;
        }
        const count = Object.keys(patterns).length;
        const warnings = count < lines
            ? [`Only ${count} of ${lines} lines are filled — the rest stay empty, and the design checks will flag them.`]
            : [];
        for (const a of assumptions) warnings.push(a);
        return { ok: true, name: importName(obj.name), patterns, warnings };
    }

    const grid = parseGrid(text_, { lines });
    return grid.ok ? { ok: true, name: '', patterns: grid.patterns, warnings: grid.warnings } : grid;
}

/** A pasted name, trimmed to the picker's limit. Never trusted for length; never used unescaped.
 * @param {any} v */
function importName(v) {
    return typeof v === 'string' ? v.trim().slice(0, MAX_IMPORT_NAME) : '';
}

/**
 * A one-line description of what is about to be saved, for the confirm step.
 *
 * Counts only — no hours, no verdict. See the module header: the workspace's own panels assess a
 * design, and a second opinion computed here would compete with them.
 * @param {Record<string, Record<string, string>>} patterns
 * @param {number} [lines]
 */
export function summariseImport(patterns, lines = ROTATING_LINES) {
    let worked = 0, spare = 0, rest = 0;
    const filled = Object.keys(patterns || {}).length;
    for (const row of Object.values(patterns || {})) {
        for (const d of DAYS) {
            const s = row[d];
            if (s === 'SPARE') spare++;
            else if (s === 'RD' || s === 'OFF' || !s) rest++;
            else worked++;
        }
    }
    return { filled, lines, worked, spare, rest };
}
