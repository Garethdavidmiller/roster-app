// @ts-check
// The "Other day" grammar (OTHER_DAYS.md): the value an `other` override stores, how it is read and
// written, and how such a day pays. Pure: no DOM, no Firestore — each export's JSDoc carries its own
// reasoning.
//
// Moved out of override-utils.js on 25 Nov 2026, unchanged, when that module reached its size cap.
// override-utils.js RE-EXPORTS every name here, so no importer changed, and its `resolveEffectiveShift`
// (the display ladder) reads the grammar from here. Import from override-utils.js as before; this
// module is where the grammar is READ and CHANGED.
//
// `isRestShift` came too, for one reason: `resolveOtherPay` needs it, and this module may not import
// override-utils.js, which imports it — a cycle (import-graph.test.mjs). It is override-utils.js's
// export as much as ever, and is re-exported from there.

import { timePairError } from './clock-input.js';   // ONE time rule, with a Shift's

/**
 * Returns true if the shift is a non-working rest day (RD or OFF).
 * @param {string} shift
 * @returns {boolean}
 */
export function isRestShift(shift) {
    return shift === 'RD' || shift === 'OFF';
}

// ── TRAINING / INDUCTION / ASSESSMENT (OTHER_DAYS.md) ──────────────────────
// One override type ('other') whose value uses a human-readable grammar that
// mirrors the roster's own language:
//
//   value := FLAVOUR [" RDW"] [" HH:MM-HH:MM"]
//   FLAVOUR := "TRG" | "IND" | "ASSESS" | "TEAM" | "UNION" | "MEET"
//
// Examples: 'TRG' · 'IND RDW' · 'ASSESS 08:00-16:00' · 'TRG RDW 08:00-16:00' · 'TEAM' · 'UNION' · 'MEET'.
// " RDW" marks an Other-family rest-day (written on the roster as "TRG RDW"); the optional time
// range is the ACTUAL hours, entered by the admin — or, for a MEETING only, printed on the roster
// ("10:00-14:00 MTG" imports as 'MEET 10:00-14:00'). This module is the client-side single source
// for the grammar; a deliberate duplicate of the RECOGNITION grammar (OTHER_DAY_ALIASES and
// BARE_OTHER_DAY) lives in functions/roster-other-days.js — Cloud Functions are CommonJS and cannot
// import this module (as with normaliseSurname). If the grammar changes, update both.

/** Badge (short) and full display words per Other-family flavour. Badge word shows in the
 *  calendar-cell badge next to 🏷️; full word is used on tap (day detail / tooltip / aria).
 *  `hideBaseTime` (optional) suppresses the base-shift-time fallback in the hours slot — see below.
 *  @type {Record<string, { badge: string, full: string, hideBaseTime?: boolean }>} */
export const OTHER_FLAVOURS = {
    TRG:    { badge: 'Train',  full: 'Training'   },
    IND:    { badge: 'Ind',    full: 'Induction'  },
    ASSESS: { badge: 'Assess', full: 'Assessment' },
    TEAM:   { badge: 'Team',   full: 'Team Day'   },
    // `hideBaseTime`: Meetings + Union duties are "attend-an-event" days not tied to a rostered
    // shift time, so the hours slot shows NO time unless one is entered/on the roster; the others
    // happen DURING your shift and keep the base time. Pay is unaffected — `resolveOtherPay` is
    // flavour-agnostic. Confirmed by Gareth Jul 2026.
    UNION:  { badge: 'Union',  full: 'Union',     hideBaseTime: true },
    MEET:   { badge: 'Meet',   full: 'Meeting',   hideBaseTime: true },
};

/** Default duration credited to an Other-family REST-DAY (e.g. TRG RDW) when no actual times are
 *  recorded: 8 hours, pre-filled into the pay calculator's RDW bucket for the member to
 *  correct to the real hours (confirmed by Gareth, Jul 2026). Single source — never inline 480. */
export const OTHER_RDW_DEFAULT_MINS = 480;

// Anchored full-string grammar. Time range is bounded HH:MM (00-23 / 00-59) so an
// impossible time can never ride in on an Other-family value. The flavour alternation is DERIVED
// from OTHER_FLAVOURS, never hand-written: the composer accepts any OTHER_FLAVOURS key, so a literal
// list here would let it write a value this regex rejects — unparseable data, permanently.
const _OTHER_RE = new RegExp(
    `^(${Object.keys(OTHER_FLAVOURS).join('|')})( RDW)?( ([01]\\d|2[0-3]):[0-5]\\d-([01]\\d|2[0-3]):[0-5]\\d)?$`
);

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
 * @returns {{ flavour: 'TRG'|'IND'|'ASSESS'|'TEAM'|'UNION'|'MEET', rdw: boolean, time: string|null } | null}
 */
export function parseOtherValue(v) {
    if (typeof v !== 'string') return null;
    const m = v.match(_OTHER_RE);
    if (!m) return null;
    return {
        flavour: /** @type {'TRG'|'IND'|'ASSESS'|'TEAM'|'UNION'|'MEET'} */ (m[1]),
        rdw:     !!m[2],
        time:    m[3] ? m[3].trim() : null,
    };
}

/**
 * COMPOSE an Other-family value — the writer half of the grammar `FLAVOUR[" RDW"][" HH:MM-HH:MM"]`,
 * living next to `parseOtherValue` (its reader) so the two can never drift apart. A parse bug shows
 * the wrong thing; a compose bug writes bad data permanently.
 *
 * Returns `{ value }` on success, or `{ error }` with a bare, staff-facing sentence (no date
 * prefix — the caller adds "Fri 3 Jul: " itself). Times are OPTIONAL: both blank means "use the
 * default hours", but a half-filled or malformed pair is an error, never a silent drop.
 *
 * SPARE is deliberately NOT handled here. It lives under the same Admin pill but is its own
 * override TYPE (`spare_shift` / 'SPARE'), not a value in this grammar — the caller routes it
 * before composing.
 *
 * @param {{ flavour?: string|null, rdwTicked?: boolean, baseIsRd?: boolean,
 *           start?: string, end?: string }} f
 *   `rdwTicked` is the row's RDW checkbox; `baseIsRd` is whether the day's BASE shift is a rest day
 *   (which FORCES the marker — see the caller's note: both display layers and the pay engine derive
 *   RDW-ness from a rest-day base anyway, so omitting it would make the stored value lie).
 * @returns {{ value: string, error?: undefined } | { error: string, value?: undefined }}
 */
export function composeOtherValue(f) {
    const flavour = (f && f.flavour) || '';
    // Force an explicit choice — no silent Training default (owner decision, v15.56): a manager
    // recording an induction who didn't tap a type would otherwise have it saved as Training.
    if (!Object.prototype.hasOwnProperty.call(OTHER_FLAVOURS, flavour)) {
        return { error: 'choose the type of Other day (Training, Induction, Assessment, Team Day, Union, Meeting or Spare)' };
    }
    const rdw = (f.rdwTicked || f.baseIsRd) ? ' RDW' : '';

    const s = (f.start || '').trim();
    const e = (f.end   || '').trim();
    let time = '';
    if (s || e) {
        if (!s || !e)                             return { error: 'fill in both times, or leave both blank to use the default hours' };
        const bad = timePairError(s, e);   // ONE time rule, with a Shift's (clock-input.js)
        if (bad)                                  return { error: bad };
        time = ` ${s}-${e}`;
    }
    return { value: `${flavour}${rdw}${time}` };
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
 * Resolve how an Other-family day PAYS (OTHER_DAYS.md — the pay mapping, in one place).
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
