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

    // RDW with time: "RDW 14:30-22:00" or "RDW 1430-2200" → "RDW|14:30-22:00".
    // Hours may be 1 or 2 digits (OCR sometimes drops the leading zero, e.g. "6:30");
    // pad to 2 so a single-digit hour isn't silently lost as a rest day.
    const rdwMatch = s.match(/^RDW\s+(\d{1,2})[:\.]?(\d{2})[\s\-–]+(\d{1,2})[:\.]?(\d{2})$/);
    if (rdwMatch) return `RDW|${rdwMatch[1].padStart(2, '0')}:${rdwMatch[2]}-${rdwMatch[3].padStart(2, '0')}:${rdwMatch[4]}`;

    if (['RD', 'OFF', 'AL', 'SPARE', 'SICK', 'RDW'].includes(s)) return s;

    // Plain time range: "0530-1130", "05:30-11:30", "05.30-11.30", "0530 1130",
    // "6:30-12:30" (single-digit hour). Pad single-digit hours to 2 digits.
    const match = s.match(/^(\d{1,2})[:\.]?(\d{2})[\s\-–]+(\d{1,2})[:\.]?(\d{2})$/);
    if (match) {
        return `${match[1].padStart(2, '0')}:${match[2]}-${match[3].padStart(2, '0')}:${match[4]}`;
    }

    console.warn(`[parseRosterPDF] Unrecognised shift value: "${raw}" — defaulting to RD`);
    return 'RD';
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

/** Maps day-name column headers (any case) to week index (0 = Sunday, 6 = Saturday). */
const HEADER_TO_INDEX = {
    'sun': 0, 'sunday': 0,
    'mon': 1, 'monday': 1,
    'tue': 2, 'tues': 2, 'tuesday': 2,
    'wed': 3, 'weds': 3, 'wednesday': 3,
    'thu': 4, 'thur': 4, 'thurs': 4, 'thursday': 4,
    'fri': 5, 'friday': 5,
    'sat': 6, 'saturday': 6,
};

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
    for (const entry of parsedMembers) {
        if (typeof entry.memberName !== 'string' || !entry.memberName.trim()) continue;

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

        safeEntries.push({ memberName: entry.memberName.trim(), shifts });
    }
    return safeEntries;
}

// ── Sunday scan post-processing ──────────────────────────────────────────────

/**
 * Apply Sunday scan corrections to safe entries (modifies in place).
 *
 * The AI commits to what it sees in each Sunday cell via sundayScan before
 * producing the full parsed output. This catches two failure modes:
 *   Case A: blank Sunday misread as Monday — sundayScan="blank" but parsed has a time
 *   Case B: worked Sunday with RDW stripped — sundayScan="RDW HH:MM" but parsed has plain time
 *
 * @param {object[]} safeEntries    - modified in place
 * @param {object}   sundayScan     - { memberName: scanValue } from AI output
 * @param {boolean}  hasSundayColumn
 * @param {string[]} dates          - 7 ISO dates; dates[0] is the Sunday
 */
function applySundayScanCorrections(safeEntries, sundayScan, hasSundayColumn, dates) {
    if (!sundayScan || typeof sundayScan !== 'object') return;
    if (!hasSundayColumn) return;
    if (dates.length < 2) return;

    const sunDate     = dates[0];
    const isPlainTime = v => /^\d{2}:\d{2}-\d{2}:\d{2}$/.test(v);

    for (const entry of safeEntries) {
        const scanRaw = sundayScan[entry.memberName];
        if (scanRaw === undefined || scanRaw === null) continue;

        const scanStr  = String(scanRaw).trim().toUpperCase();
        const sunShift = entry.shifts[sunDate];

        // Case A: scan says blank but parsed has a plain time → blank misread
        const isBlank = ['BLANK', '', 'RD', 'EMPTY', '-', 'N/A', 'NA'].includes(scanStr);
        if (isBlank && isPlainTime(sunShift)) {
            console.warn(`[parseRosterPDF] ${entry.memberName}: sundayScan="${scanRaw}" (blank) but parsed Sunday="${sunShift}" — correcting to RD`);
            entry.shifts[sunDate] = 'RD';
            continue;
        }

        // Case B: scan says RDW shift but AI stripped the RDW prefix
        if (scanStr.includes('RDW') && isPlainTime(sunShift)) {
            console.warn(`[parseRosterPDF] ${entry.memberName}: sundayScan="${scanRaw}" (RDW) but parsed Sunday="${sunShift}" (plain time) — adding RDW prefix`);
            entry.shifts[sunDate] = `RDW|${sunShift}`;
        }
    }
}

// ── Huddle push notification day label ───────────────────────────────────────

/**
 * Build the smart day label for a Huddle push notification.
 *
 * @param {string} huddleDate - YYYY-MM-DD — the date the huddle is FOR
 * @param {Date}   nowLondon  - current moment as a Date object in London timezone
 * @returns {string} e.g. "Today's", "Tomorrow's", "Thursday's"
 */
function huddleDayLabel(huddleDate, nowLondon) {
    const todayMs  = Date.UTC(nowLondon.getFullYear(), nowLondon.getMonth(), nowLondon.getDate());
    const parts    = huddleDate.split('-').map(Number);
    const huddleMs = Date.UTC(parts[0], parts[1] - 1, parts[2]);
    const diffDays = Math.round((huddleMs - todayMs) / 86_400_000);

    if (diffDays === 0) return "Today's";
    if (diffDays === 1) return "Tomorrow's";
    const dayName = new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'Europe/London' })
        .format(new Date(huddleDate + 'T12:00:00Z'));
    return `${dayName}'s`;
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
    const FIRST_PAYDAY_MS = new Date(2026, 1, 13, 12, 0, 0).getTime(); // 13 Feb 2026
    const INTERVAL_DAYS   = 28;
    const MS_PER_DAY      = 86_400_000;
    // Cutoff is 6 days before payday (Saturday before a Friday)
    const candidate = new Date(date.getTime() + 6 * MS_PER_DAY);
    candidate.setHours(12, 0, 0, 0);
    const diff = candidate.getTime() - FIRST_PAYDAY_MS;
    if (diff < 0) return false;
    return Math.round(diff / MS_PER_DAY) % INTERVAL_DAYS === 0;
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
    return surname.length >= 6 ? surname : surname.padEnd(6, surname);
}

// ── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
    normaliseShift,
    buildWeekDates,
    extractAIJson,
    HEADER_TO_INDEX,
    mapColumnHeadersToDates,
    buildSafeEntries,
    applySundayScanCorrections,
    huddleDayLabel,
    isPayCutoffDay,
    nameToEmail,
    nameToPassword,
};
