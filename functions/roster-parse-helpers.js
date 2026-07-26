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

    if (s.replace(/[./]/g, '') === 'SP') return 'SPARE';   // "SP" / "S.P." / "S/P"

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

    // Strip dots/slashes so punctuated paper-roster forms ("A/L", "A.L.", "R.D.") map to the
    // canonical code too — parity with the absence-code strip below (v16.83). By here the time
    // and RDW regexes have already run, so `s` is a short code; the strip can't corrupt a time.
    const _code = s.replace(/[./]/g, '');
    if (['RD', 'OFF', 'AL', 'SPARE', 'SICK'].includes(_code)) return _code;

    // Paid-absence roster codes (owner, Jul 2026): HA = Hospital Appointment (a day off on full
    // pay); OD = paid absence, often used as a blanket Mon–Fri marking for long-term sickness;
    // SC/SN = sick; ML = Maternity leave (a long paid-absence block). All become the app's Absent
    // day ('SICK' — the reason is never stored, GDPR). The prompt already tells the AI to return
    // SICK for these, but if it echoes the RAW code the server must still map it — otherwise a real
    // absence surfaced as an UNREADABLE cell instead of Absent. Dots/slashes are stripped first so
    // the punctuated paper-roster forms ("O.D.", "O/D", "H.A", "M.L") map too. Sunday and
    // base-rest-day normalisation happen client-side in computeCellStates, same as SICK.
    if (['HA', 'OD', 'SC', 'SN', 'ML'].includes(s.replace(/[./]/g, ''))) return 'SICK';

    // Training / Induction / Assessment / Team Day / Union course (OTHER_PLAN.md). Roster words
    // collapse to the canonical flavour sentinels; an RDW marker (either side: "TRG RDW" or "RDW TRG")
    // marks a rest-day and is preserved as the canonical " RDW" suffix. These cells never
    // carry times (the trainer/manager sets them later) — a timed variant falls through to
    // UNKNOWN below and surfaces as an UNREADABLE review row, never mis-saved. "Team Day" and
    // "Union course" are the multi-word roster labels; their captured token is whitespace-collapsed
    // before the lookup so OCR double-spacing can't miss the table.
    // Deliberate duplicate of the client grammar in override-utils.js (CommonJS cannot
    // import browser ES modules — same accepted pattern as nameToPassword).
    const trgMatch = s.match(/^(?:RDW\s+)?(TRG|TRAINING|TRAIN|IND(?:UCTION)?|ASSESS(?:MENTS?)?|TEAM(?:\s+DAYS?)?|UNION(?:\s+COURSE)?|MTG|MEETINGS?)(?:\s+(RDW))?$/);
    if (trgMatch) {
        // Explicit alias → sentinel table (NOT first-letter dispatch, which would silently map any
        // future alias added to the regex without a table entry onto the wrong flavour).
        const FLAVOUR_LOOKUP = {
            TRG: 'TRG', TRAINING: 'TRG', TRAIN: 'TRG',
            IND: 'IND', INDUCTION: 'IND',
            ASSESS: 'ASSESS', ASSESSMENT: 'ASSESS', ASSESSMENTS: 'ASSESS',
            TEAM: 'TEAM', 'TEAM DAY': 'TEAM', 'TEAM DAYS': 'TEAM',
            UNION: 'UNION', 'UNION COURSE': 'UNION',
            MTG: 'MEET', MEETING: 'MEET', MEETINGS: 'MEET',
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
    if (text.indexOf('{') === -1) {
        throw new SyntaxError('No JSON object found in AI response');
    }
    // Walk from each candidate '{', tracking brace depth while respecting string literals (and
    // escapes), and stop at the matching close. Robust to prose containing braces before/after the
    // object, or a stray '}' in trailing text (the old first-'{'-to-last-'}' slice broke on both) —
    // AND to a BALANCED brace pair in the preamble (e.g. a "{curly}" placeholder): if the first
    // balanced span isn't valid JSON we keep scanning for the next candidate object instead of
    // throwing on it. (The real response is bare JSON — prompt says "return ONLY valid JSON" — so
    // this is defence-in-depth for a chatty model.)
    // A span that PARSES is not necessarily the payload. A chatty preamble can contain a perfectly
    // VALID JSON literal — "blank cells are {} in this output" is the realistic one — and the scan
    // used to stop at the first span that parsed, returning `{}` and discarding the real roster
    // object that followed. parseRosterPDF then rejected it with "The AI returned an unexpected
    // format" and the whole upload failed even though the AI had answered correctly (v18.84). So
    // recognise the payload by its required shape, keep scanning past a parsed-but-unusable span,
    // and fall back to the first parsed object only if nothing better turns up (a shape change must
    // not start throwing where this used to return).
    const looksLikeRoster = (/** @type {any} */ v) => !!v && typeof v === 'object' && !Array.isArray(v)
        && Array.isArray(v.parsed) && Array.isArray(v.columnHeaders);
    let fallback = null, haveFallback = false;
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
            if (!haveFallback) { fallback = candidate; haveFallback = true; }   // parsed, but not it
        } catch (e) {
            if (!firstErr) firstErr = e;             // remember the first failure for the message
        }
        searchFrom = text.indexOf('{', searchFrom + 1);   // not the payload — try the next candidate
    }
    if (haveFallback) return fallback;   // nothing matched the shape — behave as before
    throw new SyntaxError('No valid JSON object found in AI response' + (firstErr ? `: ${firstErr.message}` : ''));
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
 * buildSafeEntries, applyColumnScanCrossCheck) — they used to inline this two-line lookup, so a
 * change (a new alias, a different fallback) had to be made in all three or they'd drift.
 * @param {string} header
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
 * @returns {{ columnDates: string[]|null, error: string|null }}
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

        // Default all dates to RD — covers any day the AI skips entirely.
        // REVIEWED + KEPT (v16.95 review Finding #4, owner decision Jul 2026): a blank roster cell
        // means REST DAY by definition (CLAUDE.md), and the AI omits rest-day cells routinely — so
        // promoting every missing key to a review-required UNREADABLE row would flood the review table
        // with false "couldn't read" rows on essentially every upload. The genuine risk this guards
        // (a DROPPED or MISALIGNED real shift) is already caught by three independent layers:
        // applyColumnScanCrossCheck, applySundayScanCorrections, and detectShiftedRow (client). The
        // per-member missingKeys console.warn below keeps the omission observable in the logs.
        const shifts = {};
        for (const date of dates) shifts[date] = 'RD';

        // Tolerant member-cell lookup (v16.84): the header→date map resolves a header
        // case/abbrev-insensitively (lowercased first-3 chars), but reading the cell with the RAW
        // header was stricter — if the AI keyed a member's days as "Sunday" while columnHeaders listed
        // "Sun" (or any case drift between the two lists it generates), entry[header] read undefined
        // → filled 'RD', silently dropping a real shift where the base was also RD. Index the entry's
        // day keys the same tolerant way so the two lookups can't diverge. (Day abbrevs sun/mon/…/sat
        // don't collide with member metadata keys like name/grade.)
        const entryByDay = {};
        for (const k of Object.keys(entry)) {
            const kk = String(k).trim().toLowerCase().slice(0, 3);
            if (!(kk in entryByDay)) entryByDay[kk] = entry[k];
        }

        const missingKeys = [];
        for (let i = 0; i < columnHeaders.length; i++) {
            const header   = columnHeaders[i];
            const key      = String(header).trim().toLowerCase();  // also used for the tolerant 3-char cell read below
            const dayIndex = headerToDayIndex(header);
            if (dayIndex === undefined) continue;

            const date  = dates[dayIndex];
            const raw   = entry[header] !== undefined ? entry[header] : entryByDay[key.slice(0, 3)];
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
function reviewLabel(v) {
    // App-language label for a normalised shift, for the admin-facing "couldn't read" review message.
    // Uses the app's STAFF-FACING terms — never the internal 'SICK' data value (wording rule: absence
    // copy says "Absent", never "sick").
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
 * for that cell → today's behaviour.
 *
 * ⚠️ ORDER IS LOAD-BEARING: this MUST run BEFORE applySundayScanCorrections. The model may lazily
 * COPY columnScan from its own row read (the prompt forbids it, nothing enforces it) — a copied
 * scan mirrors the RAW drifted row. Run first, a copied scan simply agrees with the row (harmless
 * no-op) and the validated Sunday corrections still land afterwards as the final authority. Run
 * AFTER them instead, a copied scan "disagrees" with the freshly-repaired row and the suffix-shift
 * realignment would provably REVERSE a correct Case-A repair back to the drifted week — silently.
 * (An honest scan is order-insensitive: its repairs leave Sunday agreeing with sundayScan, so the
 * Sunday pass no-ops.) A Case-A PARTIAL repair (Sat occupied) therefore keeps its residual-drift
 * limitation server-side — the client's detectShiftedRow banner remains the catch for that case.
 *
 * @param {object[]} safeEntries   - modified in place ({ memberName, shifts: { date: value } })
 * @param {object}   columnScan    - { header: { memberName: rawCellValue } } from AI output
 * @param {string[]} columnHeaders - column headers from AI output
 * @param {string[]} dates         - 7 ISO dates (Sun → Sat) from buildWeekDates()
 */
function applyColumnScanCrossCheck(safeEntries, columnScan, columnHeaders, dates) {
    // Coverage stats so the caller can tell the ADMIN when the fail-open path ran — the check
    // failing open must not be invisible (v16.70). checked = members with a usable signal on ≥5
    // days (the same bar the auto-repair uses).
    const stats = { checked: 0, total: safeEntries.length };
    if (!columnScan || typeof columnScan !== 'object') return stats;
    if (!Array.isArray(columnHeaders) || dates.length < 7) return stats;

    for (const entry of safeEntries) {
        // Build this member's column-read map: date → normalised value (signalled cells only).
        const colRead = Object.create(null);
        for (const header of columnHeaders) {
            const dayIndex = headerToDayIndex(header);
            if (dayIndex === undefined) continue;
            const colObj = columnScan[header];
            if (!colObj || typeof colObj !== 'object') continue;
            const v = normaliseScanValue(colObj[entry.memberName]);
            if (v !== null) colRead[dates[dayIndex]] = v;
        }
        const signalDates = Object.keys(colRead);
        if (signalDates.length >= 5) stats.checked++;
        if (signalDates.length === 0) continue;

        // Comparison equality. The row read passes 'OFF' through verbatim (normaliseShift keeps it;
        // the client treats OFF ≡ RD), but the scan normalises OFF → 'RD' via BLANK_SCAN_TOKENS — so
        // compare with OFF folded to RD on the row side, or every ordinary CES/bilingual rest day
        // would false-flag as a disagreement.
        const rowEq = v => (v === 'OFF' ? 'RD' : v);
        const cellsAgree = (rowV, colV) => rowEq(rowV) === colV;

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
                if (signalDates.every(d => cellsAgree(shifted[d], colRead[d]))) {
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
            // REST ↔ ABSENCE: exactly one read is 'SICK' (a positive absence code — OD/HA/SC/SN — was
            // seen on that pass) and the other is a rest day. RECORD THE ABSENCE rather than flag
            // UNREADABLE: dropping a real absence (writing RD) is the dangerous SILENT failure — the
            // person then appears to be working — whereas a false absence is visible on the calendar
            // and easily corrected. An absence code is not something the AI hallucinates on a truly
            // blank cell, so a SICK from EITHER pass is real signal. Not applied to Sunday (dates[0],
            // non-contracted — the client's Sunday layer would strip it anyway). This is the ONLY
            // disagreement auto-resolved; every other kind still flags UNREADABLE. (OD/HA reliability.)
            // Positioning note: this resolves the absence at its CURRENT column. applySundayScanCorrections
            // runs AFTER this (index.js — it is the validated final authority) and may right/left-shift the
            // whole row on a genuine Sunday-anchored drift; the SICK moves WITH the row, which is correct
            // (a drifted row's absence was misread one day off and the shift realigns it). On an undetected
            // drift the absence lands a day off — the same positional risk that applies to EVERY cell on
            // that row (pre-existing), not new to this resolution, and review-gated (admin sees the DIFF).
            const isRest = x => x === 'RD' || x === 'OFF';
            if (d !== dates[0] && ((rowV === 'SICK' && isRest(colV)) || (isRest(rowV) && colV === 'SICK'))) {
                console.warn(`[parseRosterPDF] ${entry.memberName} ${d}: row/column read disagreed Rest↔Absent — recorded as Absent (an absence code was read on one pass; never silently drop an absence)`);
                entry.shifts[d] = 'SICK';
                continue;
            }
            // Otherwise flag for the admin (skip-only in review; never written). The message uses
            // app-language labels (reviewLabel) — never the internal 'SICK' value.
            console.warn(`[parseRosterPDF] ${entry.memberName} ${d}: row read "${rowV}" ≠ column scan "${colV}" — flagged for review`);
            entry.shifts[d] = `UNKNOWN|${reviewLabel(rowV)} or ${reviewLabel(colV)}? (PDF unclear)`;
        }
    }
    return stats;
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
    // Admin-only (v18.95). 🙋 is the Operations "Password Reset Requests" card's own emoji.
    // The ONE stable tag is load-bearing here rather than merely conventional: a second request
    // REPLACES the first in the Notification Centre, so the headline carries the queue DEPTH
    // ("2 waiting") and each new request refreshes it. Stacking would leave the admin counting
    // notifications to learn what one glance now tells them.
    resetRequest: { emoji: '🙋', tag: 'reset-request' },
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
    // Enforce the notification design language's truncation-safe budgets (.claude/rules/notifications.md:
    // title ≤ ~40 chars INCLUDING the emoji, body ≤ ~80) so the builder GUARANTEES a clean fit rather
    // than letting the OS hard-truncate a long caller-supplied headline/body mid-word. All current
    // callers already fit — this is a guard for future ones. A clean … ellipsis on a word boundary
    // where one is near the cut.
    return {
        title: _clipNotifText(`${f.emoji} ${finalHeadline}`, 40),
        body:  _clipNotifText(body, 80),
        tag:   f.tag,
        url:   finalUrl,
    };
}

/**
 * Clip notification text to a maximum length with a trailing ellipsis, preferring a word boundary
 * within the last ~12 chars so the cut doesn't land mid-word. Returns the input unchanged when it
 * already fits.
 * @param {string} s @param {number} max @returns {string}
 */
function _clipNotifText(s, max) {
    if (typeof s !== 'string' || s.length <= max) return s;
    const hard = s.slice(0, max - 1);
    const sp = hard.lastIndexOf(' ');
    return (sp >= max - 12 ? hard.slice(0, sp) : hard).trimEnd() + '…';
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
 * Count how many DISTINCT accounts have signed in inside each window (v18.96).
 *
 * The point of this metric: the Usage card's existing "active accounts" figure is deduped on the
 * DEVICE (localStorage flags that never leave the phone), so one member on a phone and a laptop
 * counts twice — a usage trend, not a headcount. This is the exact counterpart, and it is exact for
 * free: Firebase Auth already records `lastSignInTime` per account, so uniqueness is a property of
 * the data rather than something we have to enforce. **No identity is stored, transmitted or
 * returned** — only counts — so it adds no privacy surface over what Firebase already holds.
 *
 * PURE, because the handler around it uses the Admin SDK and can't run in the test sandbox. Every
 * judgement worth getting wrong lives here:
 *
 *  · **Disabled accounts are ignored entirely**, including in the total. A leaver is not a
 *    provisioned account waiting to be used; counting them would permanently depress the ratio.
 *  · **Admin accounts are excluded**, matching recordUsage's write-time CONFIG.ADMIN_NAMES filter —
 *    the figures must reflect real staff, not the developer's own testing.
 *  · **A missing/unparseable `lastSignInTime` means never signed in**, never "signed in long ago".
 *    Firebase leaves it empty for an account created but never used, which is precisely the
 *    `neverSignedIn` population — the actionable one (provisioned staff who may not know the app
 *    exists). Treating a junk value as a sign-in would hide them.
 *  · **A FUTURE timestamp counts as recent**, not as an error. A clock skew must not make a real
 *    member vanish from the count.
 *
 * Windows are inclusive at the boundary (exactly 30 days ago counts as within 30 days) — the same
 * convention as shouldRecordResetRequest.
 *
 * @param {Array<{ email?: string, disabled?: boolean, metadata?: { lastSignInTime?: string|null } }>} users
 * @param {number} nowMs
 * @param {Set<string>} excludeEmails  lowercase emails to omit (admins)
 * @returns {{ total: number, last7: number, last30: number, neverSignedIn: number }}
 */
function summariseSignIns(users, nowMs, excludeEmails) {
    const DAY = 24 * 60 * 60 * 1000;
    const out = { total: 0, last7: 0, last30: 0, neverSignedIn: 0 };
    for (const u of Array.isArray(users) ? users : []) {
        if (!u || u.disabled) continue;                       // leavers are not provisioned accounts
        const email = typeof u.email === 'string' ? u.email.toLowerCase() : '';
        if (!email || (excludeEmails && excludeEmails.has(email))) continue;
        out.total++;
        const raw = u.metadata && u.metadata.lastSignInTime;
        const ms  = raw ? Date.parse(raw) : NaN;
        if (!Number.isFinite(ms)) { out.neverSignedIn++; continue; }
        const age = nowMs - ms;                                // negative (future clock) → counts as recent
        if (age <= 30 * DAY) out.last30++;
        if (age <= 7  * DAY) out.last7++;
    }
    return out;
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

/**
 * Decide whether a failed Web Push send means the subscription is DEAD and should be deleted.
 * Extracted + tested (v16.81) because this encodes the load-bearing v16.15 lesson that previously
 * survived only as a comment inline in fanOutPush: a 410/404 is a genuinely gone endpoint (delete
 * it), but a 401 is the push service rejecting our VAPID auth JWT — a server MISCONFIG in which
 * EVERY send 401s. Deleting on 401 would wipe the whole pushSubscriptions collection in one run,
 * and since the client VAPID fingerprint (derived from the unchanged public key) wouldn't change,
 * no device would ever re-subscribe → a permanent, silent notification outage. So ONLY 410/404
 * delete; everything else (401, 5xx, network) is a transient/keep.
 * @param {number|undefined|null} statusCode  HTTP status from the push service
 * @returns {boolean} true → delete the subscription doc; false → keep and log
 */
function shouldDeleteSubscription(statusCode) {
    return statusCode === 410 || statusCode === 404;
}

// ── Exports ──────────────────────────────────────────────────────────────────


/**
 * Throttle decision for a password-reset REQUEST (PASSWORD_PLAN.md — the request queue).
 *
 * PURE so the one piece of judgement in an otherwise mechanical public endpoint is unit-testable.
 * Returns true when the request should be RECORDED (write the doc + count it), false when it should be
 * silently absorbed as a duplicate.
 *
 * Why throttle at all when the collection can't grow (doc id = member name, so at most one row per
 * member — see the endpoint)? Two reasons: a member tapping the link repeatedly should not inflate the
 * `count` the admin reads as "how badly are they stuck", and every recorded request is a potential
 * notification. The endpoint returns success either way, so a throttled request is indistinguishable
 * from a recorded one to the caller — nothing is leaked by the difference.
 *
 * A missing/unparseable previous timestamp means "never asked" → record.
 *
 * @param {number|null|undefined} lastRequestedAtMs  previous requestedAt in ms, or null
 * @param {number} nowMs
 * @param {number} throttleMs
 * @returns {boolean}
 */
function shouldRecordResetRequest(lastRequestedAtMs, nowMs, throttleMs) {
    const last = Number(lastRequestedAtMs);
    if (!Number.isFinite(last) || last <= 0) return true;   // never asked (or junk) → record
    return (nowMs - last) >= throttleMs;
}

/**
 * The headline + body for the admin's "someone asked for a password reset" push
 * (PASSWORD_PLAN.md — the request queue, Phase 2).
 *
 * PURE so the wording — the whole user-visible product of this feature — is unit-testable without a
 * push service, and so the design language's truncation budgets are verifiable rather than assumed.
 *
 * The headline carries the QUEUE DEPTH, not just "someone asked", because the feature shares ONE
 * notification tag: request #2 replaces request #1 on the lock screen. Depth-in-the-headline turns
 * that replacement from lossy into useful — the newest notification always states the current total.
 * The body names the member who just asked (safe to render: the name came from the server-owned
 * activeMembers list, never the request body) and, when others are also waiting, says so rather than
 * implying this one request is the whole queue.
 *
 * `pending` is the number of UNCLEARED rows in `resetRequests`, which is exactly the number on the
 * Operations card's count chip — so the notification and the card can never disagree.
 *
 * Tone follows .claude/rules/notifications.md: calm, factual, no exclamation. Deliberately NOT
 * "urgent"/"locked out" — the admin decides urgency, and a request is not proof of one (§13).
 *
 * @param {string} member    display name, from the server-owned roster
 * @param {number} pending   uncleared rows in resetRequests (>= 1 — this request is one of them)
 * @returns {{ headline: string, body: string }}
 */
function buildResetRequestNotice(member, pending) {
    const n = Number.isFinite(Number(pending)) && Number(pending) >= 1 ? Math.floor(Number(pending)) : 1;
    const others = n - 1;
    return {
        // "Reset requests", not "Password reset": a COLLAPSED notification shows the title alone, and
        // "Password reset — 1 waiting" on your own lock screen reads first as something about YOUR
        // password. This also matches the card the notification opens ("Password Reset Requests"), and
        // the body supplies the word "password" for anyone reading the expanded form.
        headline: `Reset requests — ${n} waiting`,
        body: others > 0
            ? `${member} asked for a reset. ${others} other${others === 1 ? '' : 's'} waiting.`
            : `${member} asked for a password reset.`,
    };
}

module.exports = {
    shouldDeleteSubscription,
    normaliseShift,
    fileSignatureMatches,
    buildWeekDates,
    extractAIJson,
    HEADER_TO_INDEX,
    headerToDayIndex,
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
    shouldRecordResetRequest,
    buildResetRequestNotice,
    summariseSignIns,
};
