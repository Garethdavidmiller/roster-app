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
 * Converts a Firestore Timestamp or plain {seconds} object to milliseconds.
 * Returns 0 for null/undefined or unrecognised shapes.
 * @param {any} ts
 * @returns {number}
 */
export function tsToMillis(ts) {
    if (!ts) return 0;
    if (typeof ts.toMillis === 'function') return ts.toMillis();
    if (typeof ts.seconds === 'number') return ts.seconds * 1000;
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
//   FLAVOUR := "TRG" | "IND" | "ASSESS"
//
// Examples: 'TRG' · 'IND RDW' · 'ASSESS 08:00-16:00' · 'TRG RDW 08:00-16:00'.
// " RDW" marks a training rest-day (explicitly written on the roster as "TRG RDW");
// the optional time range is the trainer's ACTUAL hours, entered manually by the
// admin (roster uploads never carry times). This module is the client-side single
// source for the grammar; a deliberate duplicate of the RECOGNITION grammar (the
// looser roster-word aliases) lives in functions/roster-parse-helpers.js —
// Cloud Functions are CommonJS and cannot import this module (same accepted
// pattern as normaliseSurname). If the grammar changes, update both.

/** Badge (short) and full display words per training flavour. Badge word shows in the
 *  calendar-cell badge next to 🏷️; full word is used on tap (day detail / tooltip / aria). */
export const OTHER_FLAVOURS = {
    TRG:    { badge: 'Train',  full: 'Training'   },
    IND:    { badge: 'Ind',    full: 'Induction'  },
    ASSESS: { badge: 'Assess', full: 'Assessment' },
};

/** Default duration credited to a training REST-DAY (TRG RDW) when no actual times are
 *  recorded: 8 hours, pre-filled into the pay calculator's RDW bucket for the member to
 *  correct to the real hours (confirmed by Gareth, Jul 2026). Single source — never inline 480. */
export const OTHER_RDW_DEFAULT_MINS = 480;

// Anchored full-string grammar. Time range is bounded HH:MM (00-23 / 00-59) so an
// impossible time can never ride in on a training value.
const _TRAINING_RE = /^(TRG|IND|ASSESS)( RDW)?( ([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d)?$/;

/**
 * True when a stored override/shift value is a training-family value (any flavour,
 * with or without the RDW marker and optional times).
 * @param {any} v
 * @returns {boolean}
 */
export function isOtherValue(v) {
    return typeof v === 'string' && _TRAINING_RE.test(v);
}

/**
 * Parse a training value into its parts, or null when it isn't one.
 * @param {any} v
 * @returns {{ flavour: 'TRG'|'IND'|'ASSESS', rdw: boolean, time: string|null } | null}
 */
export function parseOtherValue(v) {
    if (typeof v !== 'string') return null;
    const m = v.match(_TRAINING_RE);
    if (!m) return null;
    return {
        flavour: /** @type {'TRG'|'IND'|'ASSESS'} */ (m[1]),
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
 * Resolve how a training day PAYS (OTHER_PLAN.md — the pay mapping, in one place).
 * Display deliberately does NOT use this — it shows the 🏷️ badge; only pay consumers
 * (paycalc-roster-suggestions.js) resolve training to the day underneath it.
 *
 * Modes:
 *   'rdw'     — a training rest-day: explicit " RDW" flag OR (belt-and-braces) the base
 *               is itself a rest day. mins = actual times when recorded, else the 8h
 *               default (OTHER_RDW_DEFAULT_MINS). All hours stay RDW — never split into OT.
 *   'timed'   — a rostered day with actual times recorded: classify like a shift
 *               override (the existing base-cap + excess→overtime split applies).
 *   'as-base' — a rostered day, no times: pay exactly as the base shift (the member is
 *               never paid less than their rostered shift, even if training runs short).
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
