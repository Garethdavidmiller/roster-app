'use strict';

/**
 * functions/roster-parse-helpers.js
 *
 * Pure helper functions extracted from functions/index.js.
 * No Firebase, no secrets, no HTTP — fully testable with Node's built-in test runner.
 *
 * Imported by functions/index.js via require('./roster-parse-helpers').
 */

// ── Shift normalisation ──────────────────────────────────────────────────────

/**
 * Normalise a shift value returned by the AI into the canonical app format.
 *
 * Handles common variations:
 *   "0530-1130"   → "05:30-11:30"
 *   "05:30-11:30" → "05:30-11:30"  (already correct)
 *   "05.30-11.30" → "05:30-11:30"
 *   "RD", "AL", "SPARE", "SICK" → unchanged (uppercase)
 *   "SP"          → "SPARE"
 *   "RDW"         → "RDW"  (sentinel — prompt instructs AI to include time)
 *   "RDW 14:30-22:00" → "RDW|14:30-22:00"
 *
 * @param {string} raw - Shift value from Claude AI
 * @returns {string}   - Normalised shift value
 */
function normaliseShift(raw) {
    if (typeof raw !== 'string') return 'RD';
    const s = raw.trim().toUpperCase();

    if (s === 'SP') return 'SPARE';

    // Valid 24-hour clock value: hours 00–23, minutes 00–59. The regexes below only
    // constrain digit COUNT, so without this an OCR slip like "29:75-88:90" would
    // normalise to a bogus shift time and pass review as a genuine shift. Out-of-range
    // values fall through to the unrecognised path (warn → 'RD') so they don't silently
    // become a real working shift.
    const validHHMM = (h, m) => +h >= 0 && +h <= 23 && +m >= 0 && +m <= 59;

    // RDW with time, RDW on EITHER side: "RDW 14:30-22:00" / "RDW 1430-2200" AND the
    // time-first paper-roster form "14:30-22:00 RDW" → "RDW|14:30-22:00". Matching only the
    // RDW-first form silently dropped a time-first RDW to a plain worked shift (a pay-
    // correctness bug — RDW is overtime), mirroring the one-sided gap the Other-family parser
    // already avoids. The `s.includes('RDW')` guard keeps a bare time out of this branch.
    // Hours may be 1 or 2 digits (OCR sometimes drops the leading zero, e.g. "6:30");
    // pad to 2 so a single-digit hour isn't silently lost as a rest day.
    const rdwMatch = s.match(/^(?:RDW\s+)?(\d{1,2})[:.]?(\d{2})[\s\-–]+(\d{1,2})[:.]?(\d{2})(?:\s+RDW)?$/);
    if (rdwMatch && s.includes('RDW') && validHHMM(rdwMatch[1], rdwMatch[2]) && validHHMM(rdwMatch[3], rdwMatch[4])) {
        return `RDW|${rdwMatch[1].padStart(2, '0')}:${rdwMatch[2]}-${rdwMatch[3].padStart(2, '0')}:${rdwMatch[4]}`;
    }

    if (['RD', 'OFF', 'AL', 'SPARE', 'SICK'].includes(s)) return s;

    // Paid-absence roster codes (owner, Jul 2026): HA = Hospital Appointment (a day off on full
    // pay); OD = paid absence, often used as a blanket Mon–Fri marking for long-term sickness;
    // SC/SN = sick (the prompt already tells the AI to return SICK for these, but if it echoes
    // the RAW code the server must still map it — otherwise a real absence surfaced as an
    // UNREADABLE cell instead of Absent). All become the app's Absent day ('SICK' — the reason
    // is never stored). Dots/slashes are stripped first so the punctuated paper-roster forms
    // ("O.D.", "O/D", "H.A") map too. Sunday and base-rest-day normalisation happen client-side
    // in computeCellStates, same as SICK.
    if (['HA', 'OD', 'SC', 'SN'].includes(s.replace(/[./]/g, ''))) return 'SICK';

    // Training / Induction / Assessment / Team Day (OTHER_PLAN.md). Roster words collapse
    // to the canonical flavour sentinels; an RDW marker (either side: "TRG RDW" or "RDW TRG")
    // marks a rest-day and is preserved as the canonical " RDW" suffix. These cells never
    // carry times (the trainer/manager sets them later) — a timed variant falls through to
    // UNKNOWN below and surfaces as an UNREADABLE review row, never mis-saved. "Team Day" is
    // the one multi-word roster label (appears exactly as "Team Day"); its captured token is
    // whitespace-collapsed before the lookup so OCR double-spacing can't miss the table.
    // Deliberate duplicate of the client grammar in override-utils.js (CommonJS cannot
    // import browser ES modules — same accepted pattern as nameToPassword).
    const trgMatch = s.match(/^(?:RDW\s+)?(TRG|TRAINING|TRAIN|IND(?:UCTION)?|ASSESS(?:MENTS?)?|TEAM(?:\s+DAYS?)?)(?:\s+(RDW))?$/);
    if (trgMatch) {
        // Explicit alias → sentinel table (NOT first-letter dispatch, which would silently map any
        // future alias added to the regex without a table entry onto the wrong flavour).
        const FLAVOUR_LOOKUP = {
            TRG: 'TRG', TRAINING: 'TRG', TRAIN: 'TRG',
            IND: 'IND', INDUCTION: 'IND',
            ASSESS: 'ASSESS', ASSESSMENT: 'ASSESS', ASSESSMENTS: 'ASSESS',
            TEAM: 'TEAM', 'TEAM DAY': 'TEAM', 'TEAM DAYS': 'TEAM',
        };
        const flavour = FLAVOUR_LOOKUP[trgMatch[1].replace(/\s+/g, ' ')];
        const rdw = /^RDW\s/.test(s) || !!trgMatch[2];
        return rdw ? `${flavour} RDW` : flavour;
    }

    if (s === 'RDW') {
        // Bare 'RDW' means the AI omitted the required shift time. Return as-is so
        // the review table displays it for manual correction — the admin can see the
        // unusual value and fix it before approving the upload.
        console.warn(`[parseRosterPDF] AI returned bare "RDW" with no time for "${raw}" — review table will flag it`);
        return s;
    }

    // Plain time range: "0530-1130", "05:30-11:30", "05.30-11.30", "0530 1130",
    // "6:30-12:30" (single-digit hour). Pad single-digit hours to 2 digits.
    const match = s.match(/^(\d{1,2})[:.]?(\d{2})[\s\-–]+(\d{1,2})[:.]?(\d{2})$/);
    if (match && validHHMM(match[1], match[2]) && validHHMM(match[3], match[4])) {
        return `${match[1].padStart(2, '0')}:${match[2]}-${match[3].padStart(2, '0')}:${match[4]}`;
    }

    // A value that STARTS with a valid time range but has trailing content — e.g. "06:00-12:00 GER"
    // (a real worked shift annotated with a depot/notes code), which the anchored regex above rejects.
    // Extract the leading time rather than defaulting to 'RD': if the member's base shift is also RD,
    // an 'RD' here would classify as MATCH and silently drop a genuine worked shift from the roster.
    // The extracted shift is still shown in the review table (surfaced as a DIFF when it differs from
    // base). Genuinely unrecognised values (no valid leading time) still fall through to 'RD' below.
    // ACCEPTED TRADE-OFF: a hypothetical negating annotation ("06:00-12:00 CANCELLED") would also be
    // extracted as the worked time — but the old RD-default silently lost genuinely WORKED annotated
    // shifts, which is the error we have actually observed. If cancellation-style annotations ever
    // appear in these PDFs, gate the extraction on the trailing text instead of removing it.
    const lead = s.match(/^(\d{1,2})[:.]?(\d{2})[\s\-–]+(\d{1,2})[:.]?(\d{2})\b/);
    if (lead && validHHMM(lead[1], lead[2]) && validHHMM(lead[3], lead[4])) {
        const time = `${lead[1].padStart(2, '0')}:${lead[2]}-${lead[3].padStart(2, '0')}:${lead[4]}`;
        // Preserve an RDW marker carried in the trailing content: "06:00-12:00 RDW GER" is rest-day-
        // worked OVERTIME with a depot annotation. The anchored rdwMatch above ($-terminated) rejects
        // the trailing token, so without this the RDW was dropped and the day saved as a plain `shift`
        // (normal pay) — the exact pay-loss rdwMatch guards, leaking through the annotated-time path (v16.19).
        if (/\bRDW\b/.test(s)) {   // word-boundaried so a stray substring (e.g. "…hARDWare…") can't force an RDW encode (v16.22)
            console.warn(`[parseRosterPDF] Extracted leading RDW time from "${raw}" (trailing content ignored) — review table will show it`);
            return `RDW|${time}`;
        }
        console.warn(`[parseRosterPDF] Extracted leading time from "${raw}" (trailing content ignored) — review table will show it`);
        return time;
    }

    // A genuinely blank cell is a rest day — nothing to flag. (buildSafeEntries already maps
    // empty cells to 'RD' before calling this, so this mainly guards direct callers.)
    if (s === '') return 'RD';

    // Non-empty but unrecognised (garbled OCR, unexpected text, out-of-range time). Do NOT
    // default to 'RD': when the member's base shift is also RD, an RD here classifies as MATCH
    // and the real (unreadable) shift is silently dropped from the review — never shown to the
    // admin. Return a review-only sentinel instead, carrying the raw text for display. The client
    // surfaces it as an UNREADABLE cell (skip-only, never written); the admin fixes the source PDF
    // and re-uploads, or records the shift manually. Pipes are stripped so they can't break the
    // "PREFIX|value" decoding; capped so a pathological value can't bloat the payload.
    const cleaned = s.replace(/\|/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
    if (cleaned === '') return 'RD';   // was only pipes/whitespace — treat as blank
    console.warn(`[parseRosterPDF] Unrecognised shift value: "${raw}" — flagged UNKNOWN for review`);
    return `UNKNOWN|${cleaned}`;
}

// ── Week date building ───────────────────────────────────────────────────────

/**
 * Build the 7 ISO date strings (Sun–Sat) for a week given the Saturday end date.
 *
 * @param {string} weekEnding - YYYY-MM-DD (must be a Saturday)
 * @returns {string[]} 7 dates: index 0 = Sunday, index 6 = Saturday (= weekEnding)
 */
function buildWeekDates(weekEnding) {
    const weekEndDate = new Date(weekEnding + 'T12:00:00Z');
    const dates = [];
    for (let i = 6; i >= 0; i--) {
        const d = new Date(weekEndDate);
        d.setUTCDate(d.getUTCDate() - i);
        dates.push(d.toISOString().slice(0, 10));
    }
    return dates;
}

// ── AI response JSON extraction ──────────────────────────────────────────────

/**
 * Extract the first complete JSON object from a text string.
 * Strips preamble, markdown fences, or trailing text safely.
 *
 * @param {string} text - Raw text from AI response
 * @returns {object} Parsed JSON object
 * @throws {SyntaxError} if no JSON object is found or JSON is invalid
 */
function extractAIJson(text) {
    const start = text.indexOf('{');
    if (start === -1) {
        throw new SyntaxError('No JSON object found in AI response');
    }
    // Walk from the first '{', tracking brace depth while respecting string
    // literals (and escapes), and stop at the matching close. This is robust to
    // prose containing braces before/after the object, or a stray '}' in trailing
    // text — the old first-'{'-to-last-'}' slice broke on both.
    let depth = 0, inStr = false, escaped = false;
    for (let i = start; i < text.length; i++) {
        const ch = text[i];
        if (inStr) {
            if (escaped)            escaped = false;
            else if (ch === '\\')   escaped = true;
            else if (ch === '"')    inStr = false;
        } else if (ch === '"') {
            inStr = true;
        } else if (ch === '{') {
            depth++;
        } else if (ch === '}') {
            depth--;
            if (depth === 0) return JSON.parse(text.slice(start, i + 1));
        }
    }
    throw new SyntaxError('No complete JSON object found in AI response');
}

// ── Column header → day index mapping ───────────────────────────────────────

// Maps day-name column headers (any case) to week index (0 = Sunday, 6 = Saturday).
// Null-prototype so a raw AI-supplied header that names an inherited Object property
// ('constructor', 'toString', 'hasOwnProperty') resolves to undefined and is rejected as an
// unrecognised header, rather than returning a truthy function that bypasses the guards below.
const HEADER_TO_INDEX = Object.assign(Object.create(null), {
    'sun': 0, 'sunday': 0,
    'mon': 1, 'monday': 1,
    'tue': 2, 'tues': 2, 'tuesday': 2,
    'wed': 3, 'weds': 3, 'wednesday': 3,
    'thu': 4, 'thur': 4, 'thurs': 4, 'thursday': 4,
    'fri': 5, 'friday': 5,
    'sat': 6, 'saturday': 6,
});

/**
 * Map AI column headers to ISO date strings for the given week.
 *
 * @param {string[]} columnHeaders - e.g. ['Sun', 'Mon', 'Tue', ...]
 * @param {string[]} dates         - 7 ISO dates from buildWeekDates()
 * @returns {{ columnDates: string[]|null, error: string|null }}
 *   error is null on success; columnDates is null on error.
 */
function mapColumnHeadersToDates(columnHeaders, dates) {
    const columnDates = [];
    for (const header of columnHeaders) {
        const key      = String(header).trim().toLowerCase();
        const dayIndex = HEADER_TO_INDEX[key] ?? HEADER_TO_INDEX[key.slice(0, 3)];
        if (dayIndex === undefined) {
            return { columnDates: null, error: `The AI returned an unrecognised column header: "${header}". Please try again.` };
        }
        columnDates.push(dates[dayIndex]);
    }
    if (new Set(columnDates).size !== columnDates.length) {
        return { columnDates: null, error: 'The AI returned duplicate day columns — please try again.' };
    }
    return { columnDates, error: null };
}

// ── Safe entry builder ───────────────────────────────────────────────────────

/**
 * Build safe shift entries from AI parsed output.
 *
 * The AI returns each member as an object with day-name keys.
 * Any missing key is filled with 'RD' (blank = rest day by definition).
 * Shift values are normalised via normaliseShift().
 *
 * @param {object[]} parsedMembers  - AI-returned member objects (memberName + day keys)
 * @param {string[]} columnHeaders  - column headers from AI output
 * @param {string[]} dates          - 7 ISO dates (Sun → Sat) from buildWeekDates()
 * @returns {object[]} safeEntries: [{ memberName: string, shifts: { date: value } }]
 */
function buildSafeEntries(parsedMembers, columnHeaders, dates) {
    const safeEntries = [];
    const seenMembers = new Set();
    for (const entry of parsedMembers) {
        // Guard against a non-object array element (e.g. the AI returns `"parsed": [null]`):
        // `entry.memberName` on null throws a TypeError, and this runs OUTSIDE the AI-call
        // try/catch, so it would surface as an ungraceful 500 instead of the clean 502.
        if (!entry || typeof entry !== 'object') continue;
        if (typeof entry.memberName !== 'string' || !entry.memberName.trim()) continue;
        // Skip a repeated member (e.g. a two-page roster that lists someone on both pages, or an AI
        // hallucinated duplicate). Two rows for the same member would render duplicate review rows and,
        // on save, write the same date/member override doc twice with nondeterministic last-write-wins.
        const memberKey = entry.memberName.trim();
        if (seenMembers.has(memberKey)) {
            console.warn(`[parseRosterPDF] Duplicate member "${memberKey}" in AI output — keeping the first, skipping the repeat`);
            continue;
        }
        seenMembers.add(memberKey);

        // Default all dates to RD — covers any day the AI skips entirely
        const shifts = {};
        for (const date of dates) shifts[date] = 'RD';

        const missingKeys = [];
        for (let i = 0; i < columnHeaders.length; i++) {
            const header   = columnHeaders[i];
            const key      = String(header).trim().toLowerCase();
            const dayIndex = HEADER_TO_INDEX[key] ?? HEADER_TO_INDEX[key.slice(0, 3)];
            if (dayIndex === undefined) continue;

            const date  = dates[dayIndex];
            const raw   = entry[header];
            const value = (raw !== undefined && raw !== null && String(raw).trim() !== '')
                ? String(raw).trim()
                : 'RD';

            if (raw === undefined || raw === null || String(raw).trim() === '') {
                missingKeys.push(header);
            }

            shifts[date] = normaliseShift(value);
        }

        if (missingKeys.length > 0) {
            console.warn(`[parseRosterPDF] ${entry.memberName}: AI omitted key(s) [${missingKeys.join(', ')}] — filled with RD`);
        }

        safeEntries.push({ memberName: memberKey, shifts });
    }
    return safeEntries;
}

// ── Sunday scan post-processing ──────────────────────────────────────────────

/**
 * Apply Sunday scan corrections to safe entries (modifies in place).
 *
 * The AI commits to what it sees in each Sunday cell via sundayScan (a dedicated "look at ONLY
 * the Sunday column" pass) before producing the full parsed output. sundayScan is far more
 * reliable for Sunday than the row read, so it is the authority when the two disagree.
 * This catches three failure modes:
 *   Case A — DAY-SHIFT (the common Sonnet-5 regression): the AI skips the blank Sunday cell and
 *     shifts the whole row LEFT — Monday's shift lands in the Sun key, Tuesday's in Mon, …, and
 *     Saturday ends up empty. Signature: sundayScan="blank", parsed Sun ≠ RD, AND parsed Sat = RD
 *     (the empty trailing slot the dropped leading blank pushed in). That signature is exactly a
 *     one-day left-shift, so a one-day RIGHT-shift deterministically undoes it. If Sat is NOT RD
 *     the shift can't be cleanly reversed → fall back to fixing only the Sunday cell + warn.
 *   Case B — worked Sunday with RDW stripped — sundayScan="RDW HH:MM" but parsed has plain time.
 *
 * @param {object[]} safeEntries    - modified in place
 * @param {object}   sundayScan     - { memberName: scanValue } from AI output
 * @param {boolean}  hasSundayColumn
 * @param {string[]} dates          - 7 ISO dates; dates[0] is Sunday, dates[6] Saturday
 */
function applySundayScanCorrections(safeEntries, sundayScan, hasSundayColumn, dates) {
    if (!sundayScan || typeof sundayScan !== 'object') return;
    if (!hasSundayColumn) return;
    if (dates.length < 7) return;   // a full Sun→Sat week is required for the shift repair

    const sunDate     = dates[0];
    const satDate     = dates[6];
    const isPlainTime = v => /^\d{2}:\d{2}-\d{2}:\d{2}$/.test(v);

    for (const entry of safeEntries) {
        const scanRaw = sundayScan[entry.memberName];
        if (scanRaw === undefined || scanRaw === null) continue;

        const scanStr  = String(scanRaw).trim().toUpperCase();
        const sunShift = entry.shifts[sunDate];

        // Case A: scan says the Sunday cell is blank, but the AI put SOMETHING there. The AI's own
        // separate Sunday scan is the authority, so this is a misread — almost always the
        // dropped-blank-Sunday LEFT-SHIFT of the whole row.
        const isBlank = ['BLANK', '', 'RD', 'EMPTY', '-', 'N/A', 'NA'].includes(scanStr);
        if (isBlank && sunShift !== 'RD') {
            if (entry.shifts[satDate] === 'RD') {
                // Clean left-shift signature (Sat empty) → RIGHT-shift the whole row to undo it:
                // each day takes the value the AI mis-placed one slot earlier; Sunday becomes RD;
                // the old (empty) Saturday slot falls off. Provably reverses a one-day left-shift.
                for (let i = 6; i >= 1; i--) entry.shifts[dates[i]] = entry.shifts[dates[i - 1]];
                entry.shifts[sunDate] = 'RD';
                console.warn(`[parseRosterPDF] ${entry.memberName}: sundayScan="${scanRaw}" (blank) but parsed Sunday="${sunShift}" and Saturday empty — day-shift detected, RIGHT-shifted the week to realign`);
            } else {
                // Can't cleanly reverse (Saturday is occupied) — at least honour the blank Sunday.
                entry.shifts[sunDate] = 'RD';
                console.warn(`[parseRosterPDF] ${entry.memberName}: sundayScan="${scanRaw}" (blank) but parsed Sunday="${sunShift}" with a non-empty Saturday — set Sunday to RD; a wider shift may remain, CHECK THE REVIEW TABLE`);
            }
            continue;
        }

        // Case B: scan says RDW shift but AI stripped the RDW prefix
        if (scanStr.includes('RDW') && isPlainTime(sunShift)) {
            console.warn(`[parseRosterPDF] ${entry.memberName}: sundayScan="${scanRaw}" (RDW) but parsed Sunday="${sunShift}" (plain time) — adding RDW prefix`);
            entry.shifts[sunDate] = `RDW|${sunShift}`;
        }
    }
}

// ── Column-scan cross-check (the general day-shift defence) ─────────────────

// Scan tokens that mean "this cell is empty" — mirrors the Case-A blank set above.
const BLANK_SCAN_TOKENS = new Set(['BLANK', '', 'RD', 'EMPTY', '-', 'N/A', 'NA', 'OFF']);

/**
 * Normalise a raw columnScan cell value to the same vocabulary as the row read,
 * so the two are comparable. Returns null when there is NO usable signal
 * (missing member/day, or the scan value itself is unreadable) — the cross-check
 * must fail OPEN to today's behaviour on absent signal, never invent one.
 * @param {any} raw
 * @returns {string|null}
 */
function normaliseScanValue(raw) {
    if (raw === undefined || raw === null) return null;
    if (typeof raw !== 'string' && typeof raw !== 'number') return null;   // inherited fn / object → no signal
    const s = String(raw).trim();
    if (BLANK_SCAN_TOKENS.has(s.toUpperCase())) return 'RD';
    const norm = normaliseShift(s);
    return norm.startsWith('UNKNOWN|') ? null : norm;
}

/** Human form of a normalised shift for the "read two ways" message ("RDW|t" → "RDW t", capped). */
function displayableShift(v) {
    return String(v).replace('RDW|', 'RDW ').slice(0, 20);
}

/**
 * Cross-check the row read against the column scan, cell by cell (modifies safeEntries in place).
 *
 * WHY: the ONLY way a one-day shift enters the pipeline is the AI's visual ROW read — a blank
 * cell anywhere in a row can be skipped, sliding every later value one day left (or, rarer,
 * misaligning right). sundayScan anchors only the Sunday cell, so a drift that starts mid-week,
 * any right-shift, and Monday-start rosters (no Sunday column) all sailed past it. The columnScan
 * is a SECOND, column-wise read of the whole table (the same kind of read sundayScan already
 * proved more reliable per column), giving a per-cell cross-check:
 *
 *   • Row and column reads AGREE on a cell → confident, keep it.
 *   • The whole disagreement realigns EXACTLY under a ±1-day shift of the row (and there are
 *     ≥ 2 disagreements with ≥ 5 signalled days) → adopt the shifted row: the shifted row and the
 *     column read then agree everywhere, which is two-source consensus — the same authority
 *     argument as the validated Sunday Case-A repair, but provable across the whole row.
 *   • Any OTHER disagreement → the cell becomes `UNKNOWN|…` (the existing skip-only UNREADABLE
 *     review state): surfaced to the admin with both readings, NEVER silently written.
 *
 * Fail-open: no columnScan / missing column / missing member / unreadable scan value → no signal
 * for that cell → today's behaviour. Runs AFTER applySundayScanCorrections, so a Case-A partial
 * repair's residual mid-week drift (previously only a Cloud-log warning) is now caught here too.
 *
 * @param {object[]} safeEntries   - modified in place ({ memberName, shifts: { date: value } })
 * @param {object}   columnScan    - { header: { memberName: rawCellValue } } from AI output
 * @param {string[]} columnHeaders - column headers from AI output
 * @param {string[]} dates         - 7 ISO dates (Sun → Sat) from buildWeekDates()
 */
function applyColumnScanCrossCheck(safeEntries, columnScan, columnHeaders, dates) {
    if (!columnScan || typeof columnScan !== 'object') return;
    if (!Array.isArray(columnHeaders) || dates.length < 7) return;

    for (const entry of safeEntries) {
        // Build this member's column-read map: date → normalised value (signalled cells only).
        const colRead = Object.create(null);
        for (const header of columnHeaders) {
            const key      = String(header).trim().toLowerCase();
            const dayIndex = HEADER_TO_INDEX[key] ?? HEADER_TO_INDEX[key.slice(0, 3)];
            if (dayIndex === undefined) continue;
            const colObj = columnScan[header];
            if (!colObj || typeof colObj !== 'object') continue;
            const v = normaliseScanValue(colObj[entry.memberName]);
            if (v !== null) colRead[dates[dayIndex]] = v;
        }
        const signalDates = Object.keys(colRead);
        if (signalDates.length === 0) continue;

        const disagree = signalDates.filter(d =>
            typeof entry.shifts[d] === 'string'
            && !entry.shifts[d].startsWith('UNKNOWN|')
            && entry.shifts[d] !== colRead[d]);
        if (disagree.length === 0) continue;

        // Provable realignment. A dropped blank cell shifts only the SUFFIX of the row after it
        // (a drop at Sunday = the classic full-row drift; a drop mid-week leaves the head aligned).
        // Anchor at the FIRST disagreeing day k and try both one-day suffix shifts:
        //   delta +1 (undo a DROPPED cell): days after k take the row value one slot earlier;
        //            day k itself takes the column scan's value (the dropped cell's true content).
        //   delta -1 (undo an INSERTED/ghost cell): days from k take the row value one slot later;
        //            Saturday takes the column scan's value.
        // Adopt ONLY if the repaired row then agrees with the column scan on EVERY signalled day —
        // i.e. two-source consensus on the realigned row (a non-drift disagreement scrambles the
        // agreeing tail under either shift and fails this verification).
        let repaired = false;
        if (disagree.length >= 2 && signalDates.length >= 5) {
            const k = dates.findIndex(d => disagree.includes(d));
            for (const delta of [1, -1]) {
                const shifted = Object.create(null);
                for (let i = 0; i < 7; i++) shifted[dates[i]] = entry.shifts[dates[i]];
                if (delta === 1) {
                    for (let i = 6; i >= k + 1; i--) shifted[dates[i]] = entry.shifts[dates[i - 1]];
                    shifted[dates[k]] = colRead[dates[k]] ?? 'RD';
                } else {
                    for (let i = k; i <= 5; i++) shifted[dates[i]] = entry.shifts[dates[i + 1]];
                    shifted[dates[6]] = colRead[dates[6]] ?? 'RD';
                }
                if (signalDates.every(d => shifted[d] === colRead[d])) {
                    for (let i = 0; i < 7; i++) entry.shifts[dates[i]] = shifted[dates[i]];
                    console.warn(`[parseRosterPDF] ${entry.memberName}: row read disagreed with the column scan on ${disagree.length} day(s) and realigns exactly under a one-day suffix ${delta > 0 ? 'RIGHT' : 'LEFT'}-shift from ${dates[k]} — day-drift repaired (repaired row matches the column scan everywhere)`);
                    repaired = true;
                    break;
                }
            }
        }
        if (repaired) continue;

        // No provable realignment — flag each disagreeing cell for the admin (skip-only in review;
        // never written). A row-vs-column disagreement must never be silently written.
        for (const d of disagree) {
            const rowV = displayableShift(entry.shifts[d]);
            const colV = displayableShift(colRead[d]);
            console.warn(`[parseRosterPDF] ${entry.memberName} ${d}: row read "${entry.shifts[d]}" ≠ column scan "${colRead[d]}" — flagged for review`);
            entry.shifts[d] = `UNKNOWN|${rowV} or ${colV}? (PDF unclear)`;
        }
    }
}

// ── Huddle push notification day label ───────────────────────────────────────


/**
 * Parse a strict YYYY-MM-DD calendar date. Returns the UTC-noon Date if the string is a real
 * calendar date, else null. Rejects bad formats AND JS-normalised impossible dates (2026-02-30 →
 * 2026-03-02) via a round-trip check — the format regex alone is not enough. Shared by both HTTP
 * handlers (ingestHuddle, parseRosterPDF) so date validation is identical.
 * @param {string} str
 * @returns {Date|null}
 */
function parseStrictIsoDate(str) {
    if (typeof str !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return null;
    const d = new Date(str + 'T12:00:00Z');
    if (isNaN(d.getTime())) return null;
    const [y, m, day] = str.split('-').map(Number);
    if (d.getUTCFullYear() !== y || d.getUTCMonth() + 1 !== m || d.getUTCDate() !== day) return null;
    return d;
}

// ── Pay cutoff detection ─────────────────────────────────────────────────────

/**
 * Returns true if the given date is a pay cutoff day (Saturday before payday).
 * Mirrors isCutoffDate() in roster-data.js.
 * FIRST_PAYDAY and INTERVAL_DAYS must stay in sync with CONFIG in roster-data.js.
 *
 * @param {Date} date - midnight local date to check
 * @returns {boolean}
 */
function isPayCutoffDay(date) {
    // Anchor in UTC so the arithmetic is correct on any server timezone.
    // Date.UTC and setUTCHours give the same result as their local counterparts on
    // UTC Cloud Run — but are explicit and correct if TZ ever differs.
    const FIRST_PAYDAY_MS = Date.UTC(2026, 1, 13, 12, 0, 0); // 13 Feb 2026, noon UTC
    const INTERVAL_DAYS   = 28;
    const MS_PER_DAY      = 86_400_000;
    // Rebuild the intended CALENDAR day at noon UTC from the input's local components. The caller
    // builds `date` with the local-timezone `new Date(y, m, d)`, so mixing its raw getTime() with
    // setUTCHours could land the +6-day candidate on the wrong UTC day on a non-UTC runtime and make
    // the 28-day modulo miss (silently stopping cutoff reminders). This makes it TZ-independent.
    const dayNoonUtc = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0);
    // Cutoff is 6 days before payday (Saturday before a Friday)
    const candidate = dayNoonUtc + 6 * MS_PER_DAY;
    const diff = candidate - FIRST_PAYDAY_MS;
    // Use abs so the 28-day cycle is detected in both directions from the anchor.
    // The original `if (diff < 0) return false` guard incorrectly excluded Jan 10
    // (6 days before the Jan 16 payday, one cycle before the Feb 13 anchor).
    return Math.round(Math.abs(diff) / MS_PER_DAY) % INTERVAL_DAYS === 0;
}

// ── Firebase Auth name helpers ───────────────────────────────────────────────

/**
 * Derive the Firebase Auth email from a teamMembers display name.
 * Must stay in sync with nameToEmail() in firebase-client.js.
 *
 * @param {string} fullName - e.g. "G. Miller" → "g.miller@myb-roster.local"
 */
function nameToEmail(fullName) {
    const parts   = fullName.split(' ');
    const initial = parts[0].replace(/[^a-zA-Z]/g, '').toLowerCase();
    const surname = parts.slice(1).join('').toLowerCase().replace(/[^a-z]/g, '');
    return `${initial}.${surname}@myb-roster.local`;
}

/**
 * Derive the Firebase Auth password from a teamMembers display name.
 * Firebase requires minimum 6 characters — short surnames are padded by
 * repeating the surname (e.g. "tuck" → "tucktu").
 *
 * @param {string} fullName - e.g. "G. Miller" → "miller", "N. Tuck" → "tucktu"
 */
function nameToPassword(fullName) {
    const surname = fullName.split(' ').slice(1).join('').toLowerCase().replace(/[^a-z]/g, '');
    // padEnd with an empty fill string cannot extend — guard so the caller gets a
    // clear error rather than '' being sent to Firebase as an invalid password.
    if (!surname) throw new Error(`no usable surname in "${fullName}"`);
    return surname.length >= 6 ? surname : surname.padEnd(6, surname);
}

/**
 * Lightweight magic-byte ("file signature") check: confirm a decoded upload's
 * leading bytes match the type claimed by its filename extension. Guards against a
 * mislabelled or spoofed upload reaching Storage or the AI parser.
 *   PDF  → starts with "%PDF-"           (25 50 44 46 2D)
 *   DOCX → ZIP local-file header "PK\x03\x04" (50 4B 03 04) — all OOXML is a ZIP
 * @param {Buffer} buf - decoded file bytes
 * @param {'pdf'|'docx'} fileType - the type claimed by the extension
 * @returns {boolean} true when the signature matches the claimed type
 */
function fileSignatureMatches(buf, fileType) {
    if (!buf || buf.length < 4) return false;
    if (fileType === 'pdf') {
        return buf.length >= 5 &&
            buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46 && buf[4] === 0x2D;
    }
    if (fileType === 'docx') {
        return buf[0] === 0x50 && buf[1] === 0x4B && buf[2] === 0x03 && buf[3] === 0x04;
    }
    return false;
}

// ── Push notification design language ─────────────────────────────────────────
// Single source of truth for Web Push payloads. See .claude/rules/notifications.md.
// The leading emoji MUST match the feature's in-app icon (nav drawer / card) so a
// notification visibly belongs to its part of the app. Adding a notifying feature =
// one entry here + build via buildPushPayload (never a hand-written literal).

const NOTIFICATION_FEATURES = {
    // Document arrivals — title "<emoji> Latest <Doc>". "Latest" (not "Today's") because
    // a document is republished regularly and the Huddle is the next-day plan sent the
    // evening before, so day-relative words are inaccurate by the time it is read.
    huddle:     { emoji: '📋',  tag: 'huddle',       defaultHeadline: 'Latest Huddle',                 hashPath: '/#huddle' },
    circular:   { emoji: '📰',  tag: 'circular',     defaultHeadline: 'Latest Retail Circular',        hashPath: '/#circular' },
    newsletter: { emoji: '🗞️', tag: 'newsletter',   defaultHeadline: 'Latest Marylebone Newsletter',  hashPath: '/#newsletter' },
    // Event reminder — title "<emoji> <Event> — <urgency>"; caller passes headline + url.
    pay:        { emoji: '💷',  tag: 'pay-reminder' },
};

/**
 * Build a Web Push payload to the notification design language.
 * Guarantees the leading feature emoji, the per-feature tag, and a deep-link URL.
 *
 * @param {object} opts
 * @param {keyof NOTIFICATION_FEATURES} opts.feature - notification feature key
 * @param {string} opts.body                         - the supporting line (no emoji)
 * @param {string} [opts.baseUrl]                    - origin for the default deep link (document features)
 * @param {string} [opts.headline]                   - override the default headline (required for event features)
 * @param {string} [opts.url]                        - override the default deep link (required for event features)
 * @returns {{title: string, body: string, tag: string, url: string}}
 */
function buildPushPayload({ feature, body, baseUrl, headline, url }) {
    const f = NOTIFICATION_FEATURES[feature];
    if (!f) throw new Error(`Unknown notification feature: ${feature}`);
    const finalHeadline = headline || f.defaultHeadline;
    if (!finalHeadline) throw new Error(`No headline for notification feature: ${feature}`);
    const finalUrl = url || (f.hashPath ? `${baseUrl}${f.hashPath}` : undefined);
    if (!finalUrl) throw new Error(`No url for notification feature: ${feature}`);
    return { title: `${f.emoji} ${finalHeadline}`, body, tag: f.tag, url: finalUrl };
}

// ── setupRosterAuth — pure decision helpers (B4) ───────────────────────────────
// Extracted from the setupRosterAuth onRequest handler so the auth-provisioning logic (which uses
// the Firebase Admin SDK and cannot be exercised in the test sandbox) is unit-tested here. The
// handler calls each of these; keep them the single source so the handler and tests can't drift.

/**
 * Parse the ACTION flags from a setupRosterAuth request. Only `removeOrphans`/`confirmOrphanRemoval`
 * are honoured (member/role lists are server-owned). A non-JSON Content-Type makes firebase-functions
 * populate `reqBody` with a wrong-shape object, so re-parse `rawBody` as JSON whenever `removeOrphans`
 * isn't already a boolean — otherwise the flags would silently drop on the raw-body curl fallback.
 * @param {any} reqBody  req.body (parsed by firebase-functions, or a wrong-shape object)
 * @param {any} rawBody  req.rawBody (Buffer/string) — the raw request body
 * @returns {{ removeOrphans: boolean, confirmOrphanRemoval: boolean }}
 */
function parseSetupActionFlags(reqBody, rawBody) {
    let body = (reqBody && typeof reqBody === 'object' && !Array.isArray(reqBody)) ? reqBody : {};
    if (typeof body.removeOrphans !== 'boolean' && rawBody) {
        try {
            const parsed = JSON.parse(rawBody.toString('utf8'));
            if (parsed && typeof parsed === 'object') body = parsed;
        } catch (_e) { /* not JSON — keep reqBody; flags default off (fail-safe: no sweep) */ }
    }
    return { removeOrphans: body.removeOrphans === true, confirmOrphanRemoval: body.confirmOrphanRemoval === true };
}

/**
 * Resolve the SERVER-OWNED member + role lists from roster-members.json and fail closed on a broken
 * config. Returns `{ error }` (a short code) when unusable — an empty active-members list, or an empty
 * admin list (which would strip the admin claim on the next run and lock admin provisioning out).
 * `processMembers` unions the role names into the member set so every role-holder is provisioned AND
 * lands in the never-orphan set (a leaver sweep can then never disable an admin/manager/designer).
 * @param {any} rosterMembers  the parsed roster-members.json
 * @returns {{ error?: string, members?: string[], admin?: string[], manager?: string[], designer?: string[], processMembers?: string[] }}
 */
function resolveRosterAuthConfig(rosterMembers) {
    const members  = Array.isArray(rosterMembers && rosterMembers.activeMembers) ? rosterMembers.activeMembers : [];
    const roles    = (rosterMembers && rosterMembers.roles) || {};
    const admin    = Array.isArray(roles.admin)    ? roles.admin    : [];
    const manager  = Array.isArray(roles.manager)  ? roles.manager  : [];
    const designer = Array.isArray(roles.designer) ? roles.designer : [];
    if (members.length === 0) return { error: 'missing-active-members' };
    if (admin.length === 0)   return { error: 'empty-admin' };
    const processMembers = [...new Set([...members, ...admin, ...manager, ...designer])];
    return { members, admin, manager, designer, processMembers };
}

/**
 * The custom-claims object for one member. admin outranks manager (a member in both gets `admin`
 * only); `linksDesigner` is additive (orthogonal to the admin/manager tier). Every account gets `name`.
 * @param {string} name
 * @param {{ adminSet: Set<string>, managerSet: Set<string>, designerSet: Set<string> }} sets
 * @returns {Record<string, any>}
 */
function claimsForTier(name, { adminSet, managerSet, designerSet }) {
    const isAdmin    = adminSet.has(name);
    const isManager  = !isAdmin && managerSet.has(name);
    const isDesigner = designerSet.has(name);
    /** @type {Record<string, any>} */
    const claims = { name };
    if (isAdmin)        claims.admin = true;
    else if (isManager) claims.manager = true;
    if (isDesigner)     claims.linksDesigner = true;
    return claims;
}

/**
 * Which Firebase Auth accounts are leaver ORPHANS: a `@myb-roster.local` account not in the active
 * set and not already disabled. Pure detection — the handler decides whether to preview (dry-run) or
 * disable+revoke them. Skips accounts with no email and never returns an already-disabled account.
 * @param {Array<{ uid?: string, email?: string, displayName?: string, disabled?: boolean }>} users
 * @param {Set<string>} activeEmails  emails of currently-provisioned members (never disabled)
 * @returns {Array<{ uid: string|undefined, label: string }>}
 */
function computeOrphanLabels(users, activeEmails) {
    const out = [];
    for (const user of users || []) {
        if (user && user.email &&
            user.email.endsWith('@myb-roster.local') &&
            !activeEmails.has(user.email) &&
            !user.disabled) {
            out.push({ uid: user.uid, label: user.displayName || user.email });
        }
    }
    return out;
}

// ── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
    normaliseShift,
    fileSignatureMatches,
    buildWeekDates,
    extractAIJson,
    HEADER_TO_INDEX,
    mapColumnHeadersToDates,
    buildSafeEntries,
    applySundayScanCorrections,
    applyColumnScanCrossCheck,
    normaliseScanValue,
    parseStrictIsoDate,
    isPayCutoffDay,
    nameToEmail,
    nameToPassword,
    NOTIFICATION_FEATURES,
    buildPushPayload,
    parseSetupActionFlags,
    resolveRosterAuthConfig,
    claimsForTier,
    computeOrphanLabels,
};
