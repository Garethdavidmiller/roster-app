'use strict';

/**
 * functions/roster-parse-helpers.js
 *
 * Pure helper functions extracted from functions/index.js.
 * No Firebase, no secrets, no HTTP — fully testable with Node's built-in test runner.
 *
 * Required across functions/ — index.js and the domain modules compose its parse decisions, and the
 * senders and account modules its name derivation (`nameToEmail`, `nameToPassword`); module.exports is
 * the list. The account rules, the reset-request queue's rules and the push transport guards live in
 * modules of their own (the note above module.exports).
 *
 * ** `.claude/rules/roster-import.md` IS THE CONTRACT FOR THIS PIPELINE — read it before changing
 * anything here.** It holds the day-drift defence and why its three "layers" are not three
 * witnesses, the geometry gate, the review states, and what a blank cell means on each day.
 * Every rule in it is there because a week was written onto the wrong days, or nearly was.
 */

// ── WHAT THE MODEL WRITES FOR A PHYSICALLY EMPTY CELL ──────────────────────────────────────────
//
// One token, and the model's ONLY job with an empty cell is to report it — never to decide it means
// RD, which the code below could not tell from a printed RD. What a blank MEANS is the day rule's.
//
// It is matched CASE-INSENSITIVELY, beside the EMPTY and lone dash a model also writes
// (`BLANK_READINGS`, cell-day-rules.js): the row read and both scans ask that one list, so one model's
// three reads cannot disagree about what an empty cell looks like.
//
// Required at the top, because `normaliseShift` asks it about NA and NS.
const {
    BLANK_CELL_TOKEN, BLANK_READINGS,
    isBlankReading, isPhysicallyBlank, isNotAvailable, isNotAvailableSunday, blankCellMeaning,
} = require('./cell-day-rules');
const { readOtherDayCell, namesMeeting } = require('./roster-other-days');
const { fieldsOf } = require('./caught');

// ── Shift normalisation ──────────────────────────────────────────────────────

/**
 * A clock time in what follows a cell's first range: "14:00", "14.00", "1400", "600". Two of them are a second range,
 * however they are joined — "/ 14:00-18:00", " 1400-1800", "RDW 14:00-18:00", "14:00 to 18:00", "14:00—18:00" — so the
 * test counts TIMES, never a separator (a separator list misses "to" or an em dash and returns the first range alone).
 * A duty code's number ("CEA 10", "SUP 1") is too short to count.
 */
const CLOCK_TIME = /(?<!\d)(?:\d{1,2}[:.]\d{2}|\d{3,4})(?!\d)/g;

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
 *   "NA", "N/A", "NS" → "RD"  (not available — a rest day on every day)
 *   "MTG", "MEET" → "MEET"; "10:00-14:00 MTG" → "MEET 10:00-14:00"  (a meeting keeps its times)
 *
 * @param {string} raw - Shift value from Claude AI
 * @param {{ quiet?: boolean }} [opts] - `quiet` classifies without logging, for a caller that only
 *   asks what a PRINTED cell says (`cellSaysRest`), where a warning would be about a review row that
 *   never exists
 * @returns {string}   - Normalised shift value
 */
function normaliseShift(raw, { quiet = false } = {}) {
    if (typeof raw !== 'string') return 'RD';
    const s = raw.trim().toUpperCase();
    const warn = quiet ? () => {} : (/** @type {string} */ m) => console.warn(m);

    if (s.replace(/[./]/g, '') === 'SP') return 'SPARE';   // "SP" / "S.P." / "S/P"

    // Valid 24-hour clock value: the regexes below only constrain digit COUNT, so without this
    // "29:75-88:90" would pass as a genuine shift. Out-of-range values fall through to UNKNOWN.
    const validHHMM = (/** @type {string} */ h, /** @type {string} */ m) => +h >= 0 && +h <= 23 && +m >= 0 && +m <= 59;

    // A WORKED RANGE NEEDS TWO DIFFERENT CLOCK TIMES: every duration helper reads `end <= start` as an
    // OVERNIGHT WRAP, so 08:00-08:00 would become a TWENTY-FOUR HOUR shift and reach pay. Equality
    // only — `end < start` stays legal (overnight shifts are ordinary). A failure goes to UNKNOWN for
    // human review, never corrected.
    const workedRange = (/** @type {string} */ h1, /** @type {string} */ m1, /** @type {string} */ h2, /** @type {string} */ m2) =>
        validHHMM(h1, m1) && validHHMM(h2, m2)
        && !(+h1 === +h2 && +m1 === +m2);

    // RDW with time, RDW on EITHER side: "RDW 14:30-22:00" / "RDW 1430-2200" AND the time-first
    // "14:30-22:00 RDW" → "RDW|14:30-22:00" — a time-first RDW must not drop to a plain shift (RDW
    // is overtime). The `s.includes('RDW')` guard keeps a bare time out of this branch. Hours may be
    // 1 or 2 digits (OCR drops a leading zero); pad to 2.
    const rdwMatch = s.match(/^(?:RDW\s+)?(\d{1,2})[:.]?(\d{2})[\s\-–]+(\d{1,2})[:.]?(\d{2})(?:\s+RDW)?$/);
    if (rdwMatch && s.includes('RDW') && workedRange(rdwMatch[1], rdwMatch[2], rdwMatch[3], rdwMatch[4])) {
        return `RDW|${rdwMatch[1].padStart(2, '0')}:${rdwMatch[2]}-${rdwMatch[3].padStart(2, '0')}:${rdwMatch[4]}`;
    }

    // Strip dots/slashes so punctuated paper-roster forms ("A/L", "A.L.", "R.D.") map to the
    // canonical code too. By here the time regexes have run, so the strip can't corrupt a time.
    const _code = s.replace(/[./]/g, '');
    if (['RD', 'OFF', 'AL', 'SPARE', 'SICK'].includes(_code)) return _code;

    // SN = sick on a day the person was NOT booked to work (owner, Sep 2026). NOT a synonym of SC
    // (sickness against a booked turn, an absence): an SN day is the REST DAY it already was. Kept as
    // its own list so roster-prompt-parity reads the code out of the source.
    if (['SN'].includes(_code)) return 'RD';

    // NA and NS — NOT AVAILABLE — are REST DAYS, on every day (owner, 6 Nov 2026): "NA and NS
    // should be treated as rest days on the roster uploader". cell-day-rules.js's recognisers read the
    // spellings (`N/A`, `N.A.`) for this and for the Sunday scan repair alike.
    if (isNotAvailable(s) || isNotAvailableSunday(s)) return 'RD';

    // Paid-absence roster codes (owner, Jul 2026; CL added Sep 2026): HA = Hospital Appointment (a
    // day off on full pay); OD = paid absence, often used as a blanket Mon–Fri marking for
    // long-term sickness; SC = sick on a booked turn; ML = Maternity leave (a long paid-absence
    // block); CL = Compassionate leave (a paid absence). All become the app's Absent day ('SICK' —
    // the reason is never stored, GDPR, which is why the five collapse to ONE value, and why CL must
    // never reach a staff-facing surface as itself). If the AI echoes the RAW code instead of SICK,
    // the server must still map it. Punctuated forms ("O.D.", "O/D", "C/L") map too.
    //
    // ⚠️ A CODE MISSING FROM THIS LIST IS NOT A REST DAY — it falls through to UNKNOWN (the safe
    // failure). If an absence arrives as REST, look at the deliberate base-rest-day guard in
    // `normaliseCellValue` (roster-cell-rules.js), which rewrites SICK to RD on a base rest day.
    //
    // Sunday and base-rest-day normalisation happen client-side in computeCellStates.
    if (['HA', 'OD', 'SC', 'ML', 'CL'].includes(_code)) return 'SICK';

    // Training / Induction / Assessment / Team Day / Union course / Meeting — roster-other-days.js,
    // which reads a MEETING whole, its times included (owner, 6 Nov 2026: "MTG should always be other,
    // with the meeting flavour"). The other five carry no times on the roster.
    const otherDay = readOtherDayCell(s, workedRange);
    if (otherDay) return otherDay;

    if (s === 'RDW') {
        // Bare 'RDW' means the AI omitted the required shift time. Returned as-is so the review
        // table shows it for manual correction.
        warn(`[parseRosterPDF] AI returned bare "RDW" with no time for "${raw}" — review table will flag it`);
        return s;
    }

    // Plain time range: "0530-1130", "05:30-11:30", "05.30-11.30", "0530 1130",
    // "6:30-12:30" (single-digit hour). Pad single-digit hours to 2 digits.
    const match = s.match(/^(\d{1,2})[:.]?(\d{2})[\s\-–]+(\d{1,2})[:.]?(\d{2})$/);
    if (match && workedRange(match[1], match[2], match[3], match[4])) {
        return `${match[1].padStart(2, '0')}:${match[2]}-${match[3].padStart(2, '0')}:${match[4]}`;
    }

    // A value that STARTS with a valid time range but has trailing content — "06:00-12:00 GER", a
    // worked shift with a depot code. Extract the leading time rather than defaulting to 'RD', which
    // over a base RD would MATCH and silently drop the shift. ACCEPTED TRADE-OFF: a negating
    // annotation ("06:00-12:00 CANCELLED") would also be extracted; if such annotations ever appear,
    // gate the extraction on the trailing text instead of removing it.
    // NEVER WHEN THE CELL NAMES A MEETING: one the reader above could not take whole goes to review.
    const lead = s.match(/^(\d{1,2})[:.]?(\d{2})[\s\-–]+(\d{1,2})[:.]?(\d{2})\b/);
    if (lead && workedRange(lead[1], lead[2], lead[3], lead[4]) && !namesMeeting(s)) {
        // …BUT NEVER WHEN THE REST IS A SECOND TIME RANGE ("06:00-10:00 / 14:00-18:00"): two more clock times send the
        // WHOLE cell to review — a shift that looks complete and is not is the failure. The app has no split shift.
        if ((s.slice(lead[0].length).match(CLOCK_TIME) || []).length >= 2) {
            warn('[parseRosterPDF] Two time ranges in one cell — flagged UNKNOWN for review');
            return `UNKNOWN|two times in one cell (${s.replace(/\|/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40)}) — check the PDF`;
        }
        const time = `${lead[1].padStart(2, '0')}:${lead[2]}-${lead[3].padStart(2, '0')}:${lead[4]}`;
        // Preserve an RDW marker in the trailing content ("06:00-12:00 RDW GER" is OVERTIME), which
        // the anchored rdwMatch rejects. The log lines name the TIME, never the cell: the trailing
        // text can be an absence's reason.
        if (/\bRDW\b/.test(s)) {   // word-boundaried so a stray substring (e.g. "…hARDWare…") can't force an RDW encode
            warn(`[parseRosterPDF] Extracted the leading RDW time ${time} from a cell with more text (the rest ignored) — review table will show it`);
            return `RDW|${time}`;
        }
        warn(`[parseRosterPDF] Extracted the leading time ${time} from a cell with more text (the rest ignored) — review table will show it`);
        return time;
    }

    // ⚠️ A BLANK CELL IS NOT A REST DAY, AND THIS LINE IS NOT WHERE THAT IS DECIDED.
    //
    // `buildSafeEntries` intercepts physical blanks BEFORE this function and applies the day rule —
    // a blank Sunday is a rest day, a blank Mon–Sat a cell NOBODY READ (an UNREADABLE review row).
    // This branch is a defensive fallback for a DIRECT caller only. Do not route physical blanks
    // here; do not delete the guards in `buildSafeEntries` on the strength of this line.
    if (s === '') return 'RD';

    // Non-empty but unrecognised. Do NOT default to 'RD': over a base RD it would MATCH and the real
    // shift would never be shown. A review-only sentinel instead, carrying the raw text (the UNREADABLE
    // review state). Pipes are stripped so they can't break "PREFIX|value" decoding; capped in length.
    const cleaned = s.replace(/\|/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
    // ONLY PIPES IS NOT A BLANK: something was in the cell, so it goes to review, on any day.
    if (cleaned === '') return 'UNKNOWN|only a line was read in this cell — check the PDF';
    // Its length, never its text (as above): the review row carries the text to the admin, who holds the PDF.
    warn(`[parseRosterPDF] Unrecognised shift value (${s.length} characters) — flagged UNKNOWN for review`);
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
 * @returns {any} Parsed JSON object — the MODEL'S JSON, unvalidated, so `any` is its honest type: an
 *   external payload whose every field the caller and each layer after it checks before reading
 * @throws {SyntaxError} if no JSON object is found or JSON is invalid
 */
function extractAIJson(text) {
    if (text.indexOf('{') === -1) {
        throw new SyntaxError('No JSON object found in AI response');
    }
    // Walk from each candidate '{', tracking brace depth while respecting string literals (and
    // escapes), and stop at the matching close — robust to braces in prose and to a balanced but
    // invalid span (keep scanning). Defence-in-depth for a chatty model.
    // A span that PARSES is not necessarily the payload ("blank cells are {} in this output"), so
    // recognise the payload by its required shape, keep scanning past a parsed-but-unusable span,
    // and fall back to the first parsed object only if nothing better turns up.
    // The geometry-path prompt asks for `{ parsed }` ALONE, so a span with parsed[] is the payload
    // too — second-best to the full legacy shape, which the caller still requires on that path.
    const hasParsed = (/** @type {any} */ v) => !!v && typeof v === 'object' && !Array.isArray(v) && Array.isArray(v.parsed);
    const looksLikeRoster = (/** @type {any} */ v) => hasParsed(v) && Array.isArray(v.columnHeaders);
    let fallback = null, haveFallback = false, parsedOnly = null;
    let firstErr = null;
    let searchFrom = text.indexOf('{');
    while (searchFrom !== -1) {
        let depth = 0, inStr = false, escaped = false, end = -1;
        for (let i = searchFrom; i < text.length; i++) {
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
                if (depth === 0) { end = i; break; }
            }
        }
        if (end === -1) break;   // unbalanced from here to EOF — no complete object beyond this point
        try {
            const candidate = JSON.parse(text.slice(searchFrom, end + 1));
            if (looksLikeRoster(candidate)) return candidate;         // the payload — done
            if (!parsedOnly && hasParsed(candidate)) parsedOnly = candidate;
            if (!haveFallback) { fallback = candidate; haveFallback = true; }   // parsed, but not it
        } catch (e) {
            if (!firstErr) firstErr = e;             // remember the first failure for the message
        }
        searchFrom = text.indexOf('{', searchFrom + 1);   // not the payload — try the next candidate
    }
    if (parsedOnly) return parsedOnly;
    if (haveFallback) return fallback;   // nothing matched the shape — behave as before
    throw new SyntaxError('No valid JSON object found in AI response' + (firstErr ? `: ${fieldsOf(firstErr).message}` : ''));
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
 * Resolve a raw AI column header (e.g. "Sun", "TUESDAY", " thurs ") to a 0–6 day index (Sun=0),
 * or undefined if unrecognised. The 3-char fallback tolerates long/rare forms not in the alias map.
 * SINGLE source for the three parse layers that each resolve a header (mapColumnHeadersToDates,
 * buildSafeEntries, applyColumnScanCrossCheck), so they cannot drift.
 * @param {unknown} header  a model-written header or day key: read through `String()`
 * @returns {number|undefined}
 */
function headerToDayIndex(header) {
    const key = String(header).trim().toLowerCase();
    return HEADER_TO_INDEX[key] ?? HEADER_TO_INDEX[key.slice(0, 3)];
}

/**
 * Map AI column headers to ISO date strings for the given week.
 *
 * @param {string[]} columnHeaders - e.g. ['Sun', 'Mon', 'Tue', ...]
 * @param {string[]} dates         - 7 ISO dates from buildWeekDates()
 * @returns {{ columnDates: string[], error: null } | { columnDates: null, error: string }}
 *   error is null on success; columnDates is null on error.
 */
function mapColumnHeadersToDates(columnHeaders, dates) {
    const columnDates = [];
    for (const header of columnHeaders) {
        const dayIndex = headerToDayIndex(header);
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
 * One member's week as the server holds it after the read: their roster name and a normalised value
 * for each ISO date. What every layer after `buildSafeEntries` reads and repairs in place.
 * @typedef {{ memberName: string, shifts: Record<string, string> }} SafeEntry
 */

/** Day names for the "no <day> cell was read" sentinel, indexed like `dates` (Sunday first). */
const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * The row that speaks for each member: the FIRST THAT SAYS ANYTHING. A real Dispatch sheet prints
 * an EMPTY placeholder above the same member's real row, and the grid matcher already breaks that
 * tie this way (`soleOccupied`, roster-geometry.js): an empty row states
 * nothing, so it stands only when no row for the name says anything. Two that do keep the first.
 * @param {any[]} parsedMembers  the model's rows
 * @returns {Map<string, any>}   trimmed memberName → the row that stands
 */
function memberRows(parsedMembers) {
    const says = (/** @type {any} */ e) => Object.keys(e).some(k => headerToDayIndex(k) !== undefined && !isBlankReading(e[k]));
    const out = new Map();
    for (const e of Array.isArray(parsedMembers) ? parsedMembers : []) {
        if (!e || typeof e !== 'object' || typeof e.memberName !== 'string' || !e.memberName.trim()) continue;
        const kept = out.get(e.memberName.trim());
        if (!kept || (!says(kept) && says(e))) out.set(e.memberName.trim(), e);
    }
    return out;
}

/**
 * Build safe shift entries from AI parsed output.
 *
 * The AI returns each member as an object with day-name keys.
 * A missing SUNDAY is filled with 'RD' — the one column whose blank is an answer. A missing
 * Mon–Sat day fails closed to the UNREADABLE sentinel (the reasoning is inline below).
 * Shift values are normalised via normaliseShift().
 *
 * @param {any[]}    parsedMembers  - AI-returned member objects (memberName + day keys). The model's
 *                                    JSON, UNVALIDATED — `any` for that reason: every field is checked
 *                                    below before it is read
 * @param {string[]} columnHeaders  - column headers from AI output
 * @param {string[]} dates          - 7 ISO dates (Sun → Sat) from buildWeekDates()
 * @returns {SafeEntry[]} safeEntries: [{ memberName: string, shifts: { date: value } }]
 */
function buildSafeEntries(parsedMembers, columnHeaders, dates) {
    const safeEntries = [];
    const standing = memberRows(parsedMembers);
    for (const entry of parsedMembers) {
        // Guard against a non-object element (`"parsed": [null]`): this runs OUTSIDE the AI-call
        // try/catch, so a TypeError would surface as a 500 instead of the clean 502.
        if (!entry || typeof entry !== 'object') continue;
        if (typeof entry.memberName !== 'string' || !entry.memberName.trim()) continue;
        // Skip a repeated member: two rows would render duplicate review rows and write one override
        // doc twice, last-write-wins. Which one stands is `memberRows`' rule.
        const memberKey = entry.memberName.trim();
        if (standing.get(memberKey) !== entry) {
            console.warn(`[parseRosterPDF] Duplicate member "${memberKey}" in AI output — kept the first row that says anything, skipped this one`);
            continue;
        }

        // ── SUNDAY IS THE ONE COLUMN WHOSE BLANK IS AN ANSWER ───────────────────────────────────
        //
        // The row read, `sundayScan` and `columnScan` are ONE model reading ONE PDF in ONE call, so
        // they are not independent layers. And the rosters do not blank a rest day: Mon–Sat unworked
        // days are stated explicitly (RD, AL, SC, SN, OD, HA, ML, CL, NA). The measured Mon–Sat blanks
        // were a person on a second roster who works only its Saturday — writing RD across their
        // Mon–Fri would silently overwrite what their PRIMARY roster's import wrote. So Sunday keeps
        // the RD default and Mon–Sat fails closed to the UNREADABLE sentinel (roster-import.md).
        //
        // **Sunday's exemption does NOT depend on the Sunday COLUMN existing**: on a Mon–Sat-only
        // roster (`hasSundayColumn`, index.js) an absent Sunday column means "not rostered on Sunday"
        // too. A missing weekday COLUMN correctly floods — that is a broken read, not a format.
        /** @type {Record<string, string>} */
        const shifts = {};
        for (let i = 0; i < dates.length; i++) {
            shifts[dates[i]] = blankCellMeaning(i, DAY_LABELS[i]);
        }

        // Tolerant member-cell lookup: index the entry's day keys the same case/abbrev-insensitive
        // way the header map does, so "Sunday" keys beside a "Sun" header still read the cell.
        // (Day abbrevs sun/mon/…/sat don't collide with member metadata keys like name/grade.)
        /** @type {Record<string, unknown>} */
        const entryByDay = {};
        for (const k of Object.keys(entry)) {
            const kk = String(k).trim().toLowerCase().slice(0, 3);
            if (!(kk in entryByDay)) entryByDay[kk] = entry[k];
        }

        // TWO DIFFERENT FACTS, and the warning tells them apart. The prompt requires a key for EVERY
        // column header, with "BLANK" for an empty cell, so:
        //   · reportedBlank — the model looked and said the cell was empty. Evidence.
        //   · absentKey     — the model did not answer for this day: a READ FAILURE, not evidence
        //                     the member was off.
        // They take the same branch below; whether an absent key should go to review needs the
        // compliance rate these separate log lines measure.
        /** @type {string[]} */
        const blankKeys = [];
        /** @type {string[]} */
        const absentKeys = [];
        for (let i = 0; i < columnHeaders.length; i++) {
            const header   = columnHeaders[i];
            const key      = String(header).trim().toLowerCase();  // also used for the tolerant 3-char cell read below
            const dayIndex = headerToDayIndex(header);
            if (dayIndex === undefined) continue;

            const date  = dates[dayIndex];
            const raw   = entry[header] !== undefined ? entry[header] : entryByDay[key.slice(0, 3)];
            // An explicit BLANK, EMPTY or lone dash counts here, not just an absent key — the same
            // branch, as both scans read them.
            const blank = isBlankReading(raw);

            if (blank) {
                (raw === undefined || raw === null ? absentKeys : blankKeys).push(header);
                // The same rule as the initialiser above, and it must be here too: that covers a day
                // whose HEADER was never listed, this one a header listed with nothing in it.
                shifts[date] = blankCellMeaning(dayIndex, DAY_LABELS[dayIndex]);
                continue;
            }

            // NA and NS are rest days on every day, so `normaliseShift` answers them like any code.
            shifts[date] = normaliseShift(String(raw).trim());
        }

        if (blankKeys.length > 0 || absentKeys.length > 0) {
            const parts = [];
            if (blankKeys.length)  parts.push(`reported blank [${blankKeys.join(', ')}]`);
            if (absentKeys.length) parts.push(`NO ANSWER for [${absentKeys.join(', ')}]`);
            const sunOnly = [...blankKeys, ...absentKeys].every(h => headerToDayIndex(h) === 0);
            console.warn(`[parseRosterPDF] ${entry.memberName}: ${parts.join('; ')}`
                + (sunOnly ? ' — Sunday, so filled with RD' : ' — sent to review rather than assumed to be a rest day'));
        }

        safeEntries.push({ memberName: memberKey, shifts });
    }
    return safeEntries;
}

// ── Sunday scan post-processing: functions/roster-sunday-repair.js ──


// ── Column-scan cross-check (the general day-shift defence) ─────────────────

// Scan tokens that read as a rest day on ANY day: the row read's own words for an empty cell
// (`BLANK_READINGS`) and the two printed rest codes. NA and NS are not listed: `normaliseShift`
// reads both as the rest day.
const BLANK_SCAN_TOKENS = new Set([...BLANK_READINGS, 'RD', 'OFF']);

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

/** Human form of a normalised shift for the "read two ways" message ("RDW|t" → "RDW t", capped). @param {unknown} v @returns {string} */
function reviewLabel(v) {
    // App-language label, for the admin-facing review message: STAFF-FACING terms — "Absent", never
    // the internal 'SICK' data value.
    const s = String(v);
    if (s === 'SICK')              return 'Absent';
    if (s === 'RD' || s === 'OFF') return 'Rest day';
    if (s === 'AL')                return 'AL';
    if (s === 'SPARE')             return 'Spare';
    return s.replace('RDW|', 'RDW ').slice(0, 20);
}

/**
 * Cross-check the row read against the column scan, cell by cell (modifies safeEntries in place).
 *
 * WHY: the ONLY way a one-day shift enters the pipeline is the AI's visual ROW read — a skipped
 * blank cell slides every later value one day. sundayScan anchors only the Sunday cell, so a
 * mid-week drift, a right-shift and a Monday-start roster pass it. The columnScan is a SECOND,
 * column-wise read of the whole table, giving a per-cell cross-check (roster-import.md, layer 2):
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
 * for that cell → today's behaviour.
 *
 * ⚠️ ORDER IS LOAD-BEARING: this MUST run BEFORE applySundayScanCorrections. The model may COPY
 * columnScan from its own drifted row read: run first, a copied scan agrees with the row (a no-op)
 * and the Sunday corrections land afterwards as the final authority; run AFTER them, a copied scan
 * would REVERSE a correct Case-A repair back to the drifted week — silently. A Case-A PARTIAL repair
 * leaves the Sunday claim for the geometry witness (roster-sunday-repair.js), and the client's
 * detectShiftedRow remains the catch when the witness cannot run.
 *
 * @param {SafeEntry[]} safeEntries - modified in place ({ memberName, shifts: { date: value } })
 * @param {Record<string, any>|null|undefined} columnScan - { header: { memberName: rawCellValue } } from
 *                                   AI output, UNVALIDATED: each column and cell is checked as it is read
 * @param {string[]} columnHeaders - column headers from AI output
 * @param {string[]} dates         - 7 ISO dates (Sun → Sat) from buildWeekDates()
 */
function applyColumnScanCrossCheck(safeEntries, columnScan, columnHeaders, dates) {
    // Coverage stats so the caller can tell the ADMIN when the fail-open path ran — failing open
    // must not be invisible. checked = members with a usable signal on ≥5 days (the auto-repair's bar).
    // `choices` carries the two candidate VALUES for every two-way disagreement, keyed
    // "memberName|date", so the review table can offer them as a pick; absent, it falls back to a
    // skip-only row.
    const stats = { checked: 0, total: safeEntries.length, choices: Object.create(null) };
    if (!columnScan || typeof columnScan !== 'object') return stats;
    if (!Array.isArray(columnHeaders) || dates.length < 7) return stats;

    // The scan's columns are found by DAY, the way `buildSafeEntries` finds a row's cells: its own
    // spelling first, then whichever scan key names the same day ("Sunday" beside a "Sun" header).
    /** @type {Record<number, any>} */
    const scanByDay = Object.create(null);
    for (const key of Object.keys(columnScan)) {
        const dayIndex = headerToDayIndex(key);
        if (dayIndex !== undefined && !(dayIndex in scanByDay)) scanByDay[dayIndex] = columnScan[key];
    }

    for (const entry of safeEntries) {
        // Build this member's column-read map: date → normalised value (signalled cells only), and
        // which of those the scan read as an EMPTY cell rather than a printed rest code.
        const colRead = Object.create(null);
        const scanBlank = new Set();
        for (const header of columnHeaders) {
            const dayIndex = headerToDayIndex(header);
            if (dayIndex === undefined) continue;
            const colObj = columnScan[header] !== undefined ? columnScan[header] : scanByDay[dayIndex];
            if (!colObj || typeof colObj !== 'object') continue;
            const v = normaliseScanValue(colObj[entry.memberName]);
            if (v === null) continue;
            colRead[dates[dayIndex]] = v;
            if (isBlankReading(colObj[entry.memberName])) scanBlank.add(dates[dayIndex]);
        }

        // ── WHY THE COLUMN SCAN IS NOT A WITNESS TO BLANKNESS (tried and refused, 1 Sep 2026) ──
        //
        // The blank-cell contract works only while the model reports an empty cell as told. The
        // obvious hardening — flag where the column scan saw an empty weekday and the row read a rest
        // day — was built, and the fixtures in roster-parse-helpers.test.mjs refused it.
        //
        // The CES case is the proof: a single real row scans as
        //     ['blank', '06:00-14:00', 'OFF', 'blank', '07:00-15:00', '-', 'blank']
        // against a row read of OFF for every one of those non-worked days. The scan uses 'blank',
        // 'OFF' and '-' INTERCHANGEABLY for the same kind of cell, within one row. So a scan
        // 'blank' is not evidence that the cell is physically empty, and a rule built on it would
        // flag ordinary rest days across a whole CES roster — which is what that test is named for.
        //
        // Do not rebuild this on the column scan. The independent witness this needs is the PDF's
        // own text geometry, where occupancy is a physical fact the model cannot influence — and on
        // the geometry path it now exists: a rest day read for an empty weekday goes to the review
        // (`reviewRestReadsOfEmptyCells`, roster-prompt.js). On the PDF fallback the residual is
        // real, and documented in KNOWN_LIMITATIONS.md rather than papered over with a check that
        // cries wolf.

        const signalDates = Object.keys(colRead);
        if (signalDates.length >= 5) stats.checked++;
        if (signalDates.length === 0) continue;

        // Comparison equality: the scan normalises OFF → 'RD' while the row keeps 'OFF', so fold OFF
        // to RD on the row side, or every CES/bilingual rest day would false-flag.
        const rowEq = (/** @type {string} */ v) => (v === 'OFF' ? 'RD' : v);
        const cellsAgree = (/** @type {string} */ rowV, /** @type {string} */ colV) => rowEq(rowV) === colV;

        // Per-cell RDW repair BEFORE the disagreement count: RDW-stripping is a known one-sided
        // failure (the reads agree on the TIME, only the RDW marker differs). Column has RDW, row
        // lost it → upgrade the row (the scan kept the marker — same authority as Case B). Row has
        // RDW, scan lost it → keep the row. Neither counts as a disagreement.
        for (const d of signalDates) {
            const rowV = entry.shifts[d];
            if (typeof rowV !== 'string' || rowV.startsWith('UNKNOWN|')) continue;
            if (colRead[d] === `RDW|${rowV}`) {
                console.warn(`[parseRosterPDF] ${entry.memberName} ${d}: column scan kept an RDW marker the row read dropped — upgraded to "${colRead[d]}"`);
                entry.shifts[d] = colRead[d];
            } else if (rowV === `RDW|${colRead[d]}`) {
                colRead[d] = rowV;   // row kept the marker the scan dropped — align the comparison
            }
        }

        const disagree = signalDates.filter(d =>
            typeof entry.shifts[d] === 'string'
            && !entry.shifts[d].startsWith('UNKNOWN|')
            && !cellsAgree(entry.shifts[d], colRead[d]));
        if (disagree.length === 0) continue;

        // Provable realignment. A dropped blank cell shifts only the SUFFIX of the row after it
        // (a drop at Sunday = the classic full-row drift; a drop mid-week leaves the head aligned).
        // Anchor at the FIRST disagreeing day k and try both one-day suffix shifts:
        //   delta +1 (undo a DROPPED cell): days after k take the row value one slot earlier, and
        //            day k — VACATED, no row value left for it — takes the column scan's reading.
        //   delta -1 (undo an INSERTED/ghost cell): days from k take the row value one slot later,
        //            and the vacated Saturday takes the column scan's reading.
        // Adopt ONLY if the repaired row then agrees with the column scan on EVERY signalled day —
        // i.e. two-source consensus on the realigned row (a non-drift disagreement scrambles the
        // agreeing tail under either shift and fails this verification).
        let repaired = false;
        if (disagree.length >= 2 && signalDates.length >= 5) {
            const k = dates.findIndex(d => disagree.includes(d));
            for (const delta of [1, -1]) {
                const shifted = Object.create(null);
                for (let i = 0; i < 7; i++) shifted[dates[i]] = entry.shifts[dates[i]];
                const vacated = delta === 1 ? k : 6;
                if (delta === 1) for (let i = 6; i >= k + 1; i--) shifted[dates[i]] = entry.shifts[dates[i - 1]];
                else for (let i = k; i <= 5; i++) shifted[dates[i]] = entry.shifts[dates[i + 1]];
                shifted[dates[vacated]] = colRead[dates[vacated]];
                if (signalDates.every(d => cellsAgree(shifted[d], colRead[d]))) {
                    // What is WRITTEN in the vacated slot is what an honest read of that cell gives:
                    // Monday to Saturday a blank (or a slot no scan read) is a question, never a rest day.
                    const d = dates[vacated];
                    if (colRead[d] === undefined || scanBlank.has(d)) shifted[d] = blankCellMeaning(vacated, DAY_LABELS[vacated]);
                    for (let i = 0; i < 7; i++) entry.shifts[dates[i]] = shifted[dates[i]];
                    console.warn(`[parseRosterPDF] ${entry.memberName}: row read disagreed with the column scan on ${disagree.length} day(s) and realigns exactly under a one-day suffix ${delta > 0 ? 'RIGHT' : 'LEFT'}-shift from ${dates[k]} — day-drift repaired (repaired row matches the column scan everywhere)`);
                    repaired = true;
                    break;
                }
            }
        }
        if (repaired) continue;

        // No provable realignment. Resolve one disagreement kind; flag the rest for review.
        for (const d of disagree) {
            const rowV = entry.shifts[d];
            const colV = colRead[d];
            // REST ↔ ABSENCE: exactly one read is 'SICK' (a positive OD/HA/SC/ML/CL code) and the other
            // a rest day. RECORD THE ABSENCE: dropping a real absence is the dangerous SILENT failure
            // (the person appears to be working); a false absence is visible and correctable, and an
            // absence code is not hallucinated on a blank cell. Not on Sunday (dates[0]). The ONLY
            // disagreement auto-resolved. The SICK moves with the row if applySundayScanCorrections
            // (run after this) shifts it.
            const isRest = (/** @type {string} */ x) => x === 'RD' || x === 'OFF';
            if (d !== dates[0] && ((rowV === 'SICK' && isRest(colV)) || (isRest(rowV) && colV === 'SICK'))) {
                console.warn(`[parseRosterPDF] ${entry.memberName} ${d}: row/column read disagreed Rest↔Absent — recorded as Absent (an absence code was read on one pass; never silently drop an absence)`);
                entry.shifts[d] = 'SICK';
                continue;
            }
            // Otherwise flag for the admin, in app-language labels (reviewLabel).
            console.warn(`[parseRosterPDF] ${entry.memberName} ${d}: row read "${rowV}" ≠ column scan "${colV}" — flagged for review`);
            entry.shifts[d] = `UNKNOWN|${reviewLabel(rowV)} or ${reviewLabel(colV)}? (PDF unclear)`;
            // Both readings, as VALUES rather than the prose above, so the review table can offer
            // them as a choice. Order matches the message: row read first, column scan second.
            stats.choices[`${entry.memberName}|${d}`] = [rowV, colV];
        }
    }
    return stats;
}

// ── Strict calendar dates ────────────────────────────────────────────────────

/**
 * Parse a strict YYYY-MM-DD calendar date. Returns the UTC-noon Date if the string is a real
 * calendar date, else null — a round-trip check rejects JS-normalised impossible dates
 * (2026-02-30). Shared by ingestHuddle and parseRosterPDF.
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
 * The pay cycle's anchor payday and length — GENERATED into roster-members.json from
 * CONFIG.FIRST_PAYDAY and CONFIG.PAYDAY_INTERVAL_DAYS in roster-data.js by
 * `npm run generate:roster-members`. Never write them here: move them in CONFIG and regenerate.
 */
const PAY_CYCLE = require('./roster-members.json').payCycle;

/**
 * Returns true if the given date is a pay cutoff day (Saturday before payday).
 * Mirrors isCutoffDate() in roster-data.js, on the cycle in roster-members.json (PAY_CYCLE, above).
 *
 * @param {Date} date - midnight local date to check
 * @returns {boolean}
 */
function isPayCutoffDay(date) {
    // Anchor in UTC so the arithmetic is correct on any server timezone.
    const [anchorY, anchorM, anchorD] = String(PAY_CYCLE.firstPayday).split('-').map(Number);
    const FIRST_PAYDAY_MS = Date.UTC(anchorY, anchorM - 1, anchorD, 12, 0, 0); // the anchor payday, noon UTC
    const INTERVAL_DAYS   = PAY_CYCLE.intervalDays;
    const MS_PER_DAY      = 86_400_000;
    // Rebuild the intended CALENDAR day at noon UTC from the input's local components (the caller
    // builds `date` locally), so the cycle modulo cannot miss on a non-UTC runtime.
    const dayNoonUtc = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0);
    // Cutoff is 6 days before payday (Saturday before a Friday)
    const candidate = dayNoonUtc + 6 * MS_PER_DAY;
    const diff = candidate - FIRST_PAYDAY_MS;
    // Use abs so the cycle is detected in both directions from the anchor (before it too).
    return Math.round(Math.abs(diff) / MS_PER_DAY) % INTERVAL_DAYS === 0;
}

// ── Firebase Auth name helpers ───────────────────────────────────────────────

/** The SURNAME half of an account identity — every word after the first, lower-cased, letters a–z only. The ONE copy on
 *  this side, behind nameToEmail and nameToPassword; `normaliseSurname` (auth-identity.js) is the browser's, held equal
 *  by surname-parity.test.mjs. @param {string} fullName @returns {string} */
function surnameCore(fullName) { return fullName.split(' ').slice(1).join('').toLowerCase().replace(/[^a-z]/g, ''); }

/**
 * Derive the Firebase Auth email from a teamMembers display name.
 * Must stay in sync with nameToEmail() in auth-identity.js AND `memberEmailFor` in
 * firestore.rules — a mismatch with the rules copy locks that member out.
 *
 * @param {string} fullName - e.g. "G. Miller" → "g.miller@myb-roster.local"
 */
function nameToEmail(fullName) {
    const initial = fullName.split(' ')[0].replace(/[^a-zA-Z]/g, '').toLowerCase();
    return `${initial}.${surnameCore(fullName)}@myb-roster.local`;
}

/**
 * Derive the Firebase Auth password from a teamMembers display name.
 * Firebase requires minimum 6 characters — short surnames are padded by
 * repeating the surname (e.g. "tuck" → "tucktu").
 *
 * @param {string} fullName - e.g. "G. Miller" → "miller", "N. Tuck" → "tucktu"
 */
function nameToPassword(fullName) {
    const surname = surnameCore(fullName);
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

// ── Push notification design language — functions/push-notices.js ─────
// The feature table and the one builder live there, re-exported below so every sender's import from
// here stands. See .claude/rules/notifications.md.
const { NOTIFICATION_FEATURES, buildPushPayload } = require('./push-notices');

// ── Moved out ───────────────────────────────────────────────────────────────────────────────────────
// The account rules → ./account-rules.js; the reset-request queue's rules → ./reset-request-rules.js;
// the push transport guards → ./push-guards.js. Nothing is re-exported: account-rules.js needs
// nameToEmail from here, so its re-export would be a require cycle, and no name has two homes.

module.exports = {
    normaliseShift,
    fileSignatureMatches,
    buildWeekDates,
    extractAIJson,
    HEADER_TO_INDEX,
    headerToDayIndex,
    mapColumnHeadersToDates,
    memberRows,
    buildSafeEntries,
    BLANK_CELL_TOKEN,
    isPhysicallyBlank,
    applyColumnScanCrossCheck,
    normaliseScanValue,
    reviewLabel,
    parseStrictIsoDate,
    isPayCutoffDay,
    nameToEmail,
    nameToPassword,
    surnameCore,
    NOTIFICATION_FEATURES,
    buildPushPayload,
};
