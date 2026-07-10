// @ts-check
// Override priority, member-start, and shift-classification helpers.
// Shared by calendar-app.js, calendar-team-view.js, and the admin modules.

/**
 * Returns true if the shift is a non-working rest day (RD or OFF).
 * @param {string} shift
 * @returns {boolean}
 */
export function isRestShift(shift) {
    return shift === 'RD' || shift === 'OFF';
}

/**
 * Display-suppression rule (CLAUDE.md "Sundays are non-contracted", layer 5) — SINGLE SOURCE for the
 * calendar renderer, Team Week View, and month legend so they can never disagree. True when an
 * override must NOT replace the base shift on the calendar: a `sick` override on a rest-day base OR
 * any Sunday, and `annual_leave` / Other-family (`other`) on any Sunday. (A worked Sunday is always
 * RDW, never AL/Absent; Sundays and rest days are non-contracted — such overrides are only ever
 * legacy/hand-written data.) `rdw`, `correction`, `spare_shift`, and plain `shift` are never suppressed.
 * Takes `sunday` as a boolean (not the date) so this module stays free of a roster-data import — that
 * would be a cycle, since roster-data imports from here. Callers pass `isSunday(dateStr)`.
 * @param {{type: string}} override
 * @param {string} baseShift  the member's base roster shift for that date
 * @param {boolean} sunday    whether the date is a Sunday
 * @returns {boolean} true → ignore the override, keep the base shift
 */
export function isOverrideDisplaySuppressed(override, baseShift, sunday) {
    switch (override.type) {
        case 'sick':         return isRestShift(baseShift) || sunday;
        case 'annual_leave': return sunday;
        case 'other':        return sunday;
        default:             return false;
    }
}

/**
 * Group a sorted, Sunday-excluded list of AL/absence dates into contiguous "periods" for the admin
 * booked-dates boxes, merging two dates into ONE period when every calendar day BETWEEN them is a
 * "rest gap" (a Sunday or a base rest day) — so e.g. a Fri + the following Mon reads as one period
 * across the weekend. Pure: the day-of-week / base-roster knowledge stays with the caller, which
 * supplies `isRestGap(dateStr)` and `addDay(dateStr)`. Extracted from admin-app.js `_renderBookedPeriods`
 * (v16.42) so this previously-untested merge logic is unit-testable.
 * @param {string[]} dateList  sorted ascending "YYYY-MM-DD", already Sunday-filtered
 * @param {(dateStr: string) => boolean} isRestGap  true if the date is a skippable rest gap
 * @param {(dateStr: string) => string} addDay      the next calendar day after `dateStr`
 * @returns {{ start: string, end: string, count: number }[]}
 */
export function mergeBookedPeriods(dateList, isRestGap, addDay) {
    if (!dateList.length) return [];
    const periods = [];
    let periodStart = dateList[0];
    let periodEnd   = dateList[0];
    let count       = 1;
    for (let i = 1; i < dateList.length; i++) {
        const prev = dateList[i - 1];
        const curr = dateList[i];
        let gapAllRest = true;
        let cursor = addDay(prev);
        while (cursor < curr) {
            if (!isRestGap(cursor)) { gapAllRest = false; break; }
            cursor = addDay(cursor);
        }
        if (gapAllRest) {
            periodEnd = curr;
            count++;
        } else {
            periods.push({ start: periodStart, end: periodEnd, count });
            periodStart = curr;
            periodEnd   = curr;
            count       = 1;
        }
    }
    periods.push({ start: periodStart, end: periodEnd, count });
    return periods;
}

/**
 * Converts a Firestore Timestamp or plain {seconds} object to milliseconds.
 * Returns 0 for null/undefined or unrecognised shapes.
 * @param {any} ts
 * @returns {number}
 */
export function tsToMillis(ts) {
    if (!ts) return 0;
    if (typeof ts.toMillis === 'function') return ts.toMillis();
    if (typeof ts.seconds === 'number') return ts.seconds * 1000;
    // Plain JS Date (v16.23): the write paths stamp cache-inserted docs with `createdAt: new Date()`.
    // Returning 0 for those made shouldReplaceOverride rank a JUST-SAVED override below a lingering
    // same-source duplicate with a real Firestore timestamp — the grid kept showing the stale value
    // until the next full reload.
    if (ts instanceof Date) return ts.getTime();
    return 0;
}

/**
 * Returns true if `date` falls before the member's contracted start date.
 * Overrides should be suppressed before a member's start date — getBaseShift
 * already returns 'RD' for those dates; allowing an override would undo that.
 * Returns false if the member has no startDate.
 * Always call this helper — never inline the date comparison at a call site.
 * @param {any} member
 * @param {Date} date
 * @returns {boolean}
 */
export function isBeforeMemberStart(member, date) {
    if (!member.startDate) return false;
    const s = member.startDate;
    return date < new Date(s.getFullYear(), s.getMonth(), s.getDate());
}

/**
 * Returns true if `incoming` should replace `existing` in the override cache.
 *
 * Priority rules (highest first):
 *   1. Manual overrides (source !== 'roster_import') always beat roster_import.
 *   2. Among entries of equal source-class, the newer createdAt wins.
 *
 * This ensures a human-entered correction survives a roster re-upload, and
 * that if two imports exist for the same date the most recent one is used.
 *
 * @param {any} existing
 * @param {any} incoming
 * @returns {boolean}
 */
// Rule: see CLAUDE.md — "shouldReplaceOverride" precedence: manual beats import; within same source, newer wins.
export function shouldReplaceOverride(existing, incoming) {
    if (!existing) return true;
    const existingIsImport = (existing.source || '') === 'roster_import';
    const incomingIsImport = (incoming.source || '') === 'roster_import';
    if (existingIsImport && !incomingIsImport) return true;   // manual beats import
    if (!existingIsImport && incomingIsImport) return false;  // import can't beat manual
    return tsToMillis(incoming.createdAt) >= tsToMillis(existing.createdAt);
}

/** True when a "YYYY-MM-DD" date string falls on a Sunday (UTC-safe, no timezone drift).
 * @param {string} dateStr */
function _isSundayISO(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 0;
}

/** Shift a "YYYY-MM-DD" date string by ±N days, returning "YYYY-MM-DD" (UTC-safe).
 * @param {string} dateStr
 * @param {number} deltaDays */
function _shiftISODate(dateStr, deltaDays) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + deltaDays)).toISOString().slice(0, 10);
}

/**
 * Decide which override document IDs to delete when removing one AL/sick range,
 * correctly scoping the Sunday RD-correction deletes so an overlapping range's shared
 * Sunday correction is not stripped.
 *
 * A range spanning a Sunday writes the leave type on the working days and a
 * `correction`/`RD` on the Sunday (Sundays are non-contracted, so AL/sick is never
 * written on a Sunday). Two ranges — same OR different type — that overlap the same
 * worked Sunday share ONE correction doc. When deleting one range, that correction must
 * be kept if a REMAINING AL/sick override still spans the Sunday.
 *
 * "Still spans" is detected by a remaining leave override within TWO days either side of the
 * Sunday (Fri/Sat before, Mon/Tue after). The Sunday itself never carries AL/sick, and the
 * immediately-adjacent Saturday is often a base rest day (so no leave override is written there
 * either) — a range that ENDS on the Sunday then has its nearest surviving leave on the Friday,
 * two days back. Checking only ±1 day therefore missed it and wrongly deleted the shared
 * correction, resurrecting the worked Sunday shift in the MIDDLE of a member's remaining leave.
 * (An earlier bug looked for an AL/sick record ON the Sunday — which never exists — and deleted
 * the correction every time.)
 *
 * @param {Array<{id:string,memberName:string,date:string,type:string,value:string}>} allOverrides
 * @param {{type:string, memberName:string, start:string, end:string}} range  type is 'annual_leave' | 'sick'; start/end inclusive YYYY-MM-DD
 * @returns {string[]} override document IDs to delete
 */
export function computePeriodDeleteIds(allOverrides, { type, memberName, start, end }) {
    const inRange = (/** @type {any} */ o) => o.memberName === memberName && o.date >= start && o.date <= end;
    // Leave-type day overrides inside the range — always removed.
    const leaveIds = new Set(allOverrides.filter(o => inRange(o) && o.type === type).map(o => o.id));
    // Dates of AL/sick overrides (either type) that SURVIVE this delete.
    const remainingLeaveDates = new Set(
        allOverrides
            .filter(o => o.memberName === memberName &&
                (o.type === 'annual_leave' || o.type === 'sick') && !leaveIds.has(o.id))
            .map(o => o.date)
    );
    // A surviving range covers the Sunday iff it has a leave override within 2 days either side
    // (±1 = Sat/Mon, ±2 = Fri/Tue for when the adjacent rest day carries no leave). Keep the shared
    // correction in that case; only delete it when nothing surviving spans the Sunday.
    // ACCEPTED TRADE-OFF: per-day override docs carry no booking-range identity, so this heuristic
    // can FALSE-KEEP — an unrelated 1-day absence at Sunday±2 preserves a correction whose booking
    // was fully deleted (calendar shows a stale RD on a worked Sunday until manually removed). We
    // bias toward keeping: the opposite error (deleting a correction an overlapping booking still
    // needs) resurrects a WORKED shift in the middle of someone's remaining leave, which is worse.
    const _spansSunday = (/** @type {string} */ sundayISO) =>
        [-2, -1, 1, 2].some(off => remainingLeaveDates.has(_shiftISODate(sundayISO, off)));
    const correctionIds = allOverrides
        .filter(o => inRange(o) && o.type === 'correction' && o.value === 'RD' && _isSundayISO(o.date) &&
            !_spansSunday(o.date))
        .map(o => o.id);
    return [...leaveIds, ...correctionIds];
}

// ── TRAINING / INDUCTION / ASSESSMENT (OTHER_PLAN.md) ──────────────────────
// One override type ('other') whose value uses a human-readable grammar that
// mirrors the roster's own language:
//
//   value := FLAVOUR [" RDW"] [" HH:MM-HH:MM"]
//   FLAVOUR := "TRG" | "IND" | "ASSESS" | "TEAM"
//
// Examples: 'TRG' · 'IND RDW' · 'ASSESS 08:00-16:00' · 'TRG RDW 08:00-16:00' · 'TEAM'.
// " RDW" marks an Other-family rest-day (explicitly written on the roster as "TRG RDW");
// the optional time range is the trainer's ACTUAL hours, entered manually by the
// admin (roster uploads never carry times). This module is the client-side single
// source for the grammar; a deliberate duplicate of the RECOGNITION grammar (the
// looser roster-word aliases) lives in functions/roster-parse-helpers.js —
// Cloud Functions are CommonJS and cannot import this module (same accepted
// pattern as normaliseSurname). If the grammar changes, update both.

/** Badge (short) and full display words per Other-family flavour. Badge word shows in the
 *  calendar-cell badge next to 🏷️; full word is used on tap (day detail / tooltip / aria). */
export const OTHER_FLAVOURS = {
    TRG:    { badge: 'Train',  full: 'Training'   },
    IND:    { badge: 'Ind',    full: 'Induction'  },
    ASSESS: { badge: 'Assess', full: 'Assessment' },
    TEAM:   { badge: 'Team',   full: 'Team Day'   },
};

/** Default duration credited to an Other-family REST-DAY (e.g. TRG RDW) when no actual times are
 *  recorded: 8 hours, pre-filled into the pay calculator's RDW bucket for the member to
 *  correct to the real hours (confirmed by Gareth, Jul 2026). Single source — never inline 480. */
export const OTHER_RDW_DEFAULT_MINS = 480;

// Anchored full-string grammar. Time range is bounded HH:MM (00-23 / 00-59) so an
// impossible time can never ride in on an Other-family value.
const _OTHER_RE = /^(TRG|IND|ASSESS|TEAM)( RDW)?( ([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d)?$/;

/**
 * True when a stored override/shift value is an Other-family value (any flavour,
 * with or without the RDW marker and optional times).
 * @param {any} v
 * @returns {boolean}
 */
export function isOtherValue(v) {
    return typeof v === 'string' && _OTHER_RE.test(v);
}

/**
 * Parse an Other-family value into its parts, or null when it isn't one.
 * @param {any} v
 * @returns {{ flavour: 'TRG'|'IND'|'ASSESS'|'TEAM', rdw: boolean, time: string|null } | null}
 */
export function parseOtherValue(v) {
    if (typeof v !== 'string') return null;
    const m = v.match(_OTHER_RE);
    if (!m) return null;
    return {
        flavour: /** @type {'TRG'|'IND'|'ASSESS'|'TEAM'} */ (m[1]),
        rdw:     !!m[2],
        time:    m[3] ? m[3].trim() : null,
    };
}

/**
 * Duration of an HH:MM-HH:MM range in minutes; overnight ranges wrap past midnight.
 * @param {string} time
 * @returns {number}
 */
function _shiftMins(time) {
    const [st, en] = time.split('-');
    const [sh, sm] = st.split(':').map(Number);
    const [eh, em] = en.split(':').map(Number);
    let mins = (eh * 60 + em) - (sh * 60 + sm);
    if (mins <= 0) mins += 24 * 60;
    return mins;
}

/**
 * Resolve how an Other-family day PAYS (OTHER_PLAN.md — the pay mapping, in one place).
 * Display deliberately does NOT use this — it shows the 🏷️ badge; only pay consumers
 * (paycalc-roster-suggestions.js) resolve an Other day to the day underneath it.
 *
 * Modes:
 *   'rdw'     — an Other-family rest-day: explicit " RDW" flag OR (belt-and-braces) the base
 *               is itself a rest day. mins = actual times when recorded, else the 8h
 *               default (OTHER_RDW_DEFAULT_MINS). All hours stay RDW — never split into OT.
 *   'timed'   — a rostered day with actual times recorded: classify like a shift
 *               override (the existing base-cap + excess→overtime split applies).
 *   'as-base' — a rostered day, no times: pay exactly as the base shift (the member is
 *               never paid less than their rostered shift, even if the Other day runs short).
 *
 * @param {{ flavour: string, rdw: boolean, time: string|null }} parsed  from parseOtherValue()
 * @param {string} baseValue  the member's base roster shift for that date
 * @returns {{ mode: 'rdw', mins: number } | { mode: 'timed', time: string } | { mode: 'as-base' }}
 */
export function resolveOtherPay(parsed, baseValue) {
    const rdw = parsed.rdw || isRestShift(baseValue);
    if (rdw) return { mode: 'rdw', mins: parsed.time ? _shiftMins(parsed.time) : OTHER_RDW_DEFAULT_MINS };
    if (parsed.time) return { mode: 'timed', time: parsed.time };
    return { mode: 'as-base' };
}

/** A worked-shift "HH:MM-HH:MM" range (the DISPLAY form — 1-or-2-digit hours, no anchoring;
 *  matches the renderer's historical inline regex, deliberately looser than roster-data's TIME_RE). */
const SHIFT_RANGE_RE = /^\d{1,2}:\d{2}-\d{1,2}:\d{2}$/;

/**
 * Resolve a Firestore override onto a base shift into ONE canonical display descriptor.
 *
 * This is the single source for the "apply override onto base shift" ladder that used to be
 * re-implemented in three places (calendar renderer, Team Week View, month legend). Those
 * copies drifted once already — the missing Sunday-AL suppression in Team view (fixed v16.37
 * by extracting `isOverrideDisplaySuppressed`). This extracts the whole ladder (v16.48) so the
 * three consumers render from one resolution and can never disagree again. Pure — no DOM, no
 * Firestore, no roster lookup; the caller passes the already-fetched override and base shift
 * (and must pass `null` for a before-member-start / absent override, exactly as before).
 *
 * @param {any}     override  The override for this member+date, or null/undefined.
 * @param {string}  baseShift The base shift from getBaseShift (Christmas/startDate already applied).
 * @param {boolean} sunday    isSunday(dateStr) — Sundays are non-contracted (suppression input).
 * @returns {{ shift: string, rdwTime: string, derivedRdw: boolean, note: string }}
 *   shift      canonical effective shift: `baseShift` when there is no override or it is
 *              suppressed; `'RDW'` for an rdw override; the raw Other grammar value for a
 *              parseable `other`; otherwise `override.value` (AL→'AL', SICK→'SICK',
 *              correction→'RD', spare_shift→'SPARE', legacy types via their value).
 *   rdwTime    rdw override → `override.value`; parseable Other → its hours-slot string
 *              (actual time → 'RDW' → the base shift's own time → ''); '' otherwise.
 *   derivedRdw parseable Other day only: true when RDW via the explicit flag OR a rest-day base.
 *   note       `override.note` (or '') when an override applied; '' otherwise.
 */
export function resolveEffectiveShift(override, baseShift, sunday) {
    if (!override || isOverrideDisplaySuppressed(override, baseShift, sunday)) {
        return { shift: baseShift, rdwTime: '', derivedRdw: false, note: '' };
    }
    const note = override.note || '';
    if (override.type === 'rdw') {
        return { shift: 'RDW', rdwTime: override.value, derivedRdw: false, note };
    }
    const parsedOther = override.type === 'other' ? parseOtherValue(override.value) : null;
    if (parsedOther) {
        const derivedRdw = parsedOther.rdw || isRestShift(baseShift);
        // Hours slot: admin-entered actual times → 'RDW' (a rest-day Other, no times) → the base
        // shift's own time (a rostered-day Other happens during your shift) → '' (badge only).
        const rdwTime = parsedOther.time ?? (derivedRdw ? 'RDW'
            : (SHIFT_RANGE_RE.test(baseShift) ? baseShift : ''));
        return { shift: override.value, rdwTime, derivedRdw, note };
    }
    return { shift: override.value, rdwTime: '', derivedRdw: false, note };
}
