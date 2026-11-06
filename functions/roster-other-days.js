'use strict';

/**
 * functions/roster-other-days.js — what a roster cell reads as when it names an OTHER-FAMILY day:
 * Training, Induction, Assessment, Team Day, Union course or Meeting (OTHER_DAYS.md).
 * Requires nothing: no Firebase, no HTTP, no clock. Imported by `functions/roster-parse-helpers.js`,
 * whose `normaliseShift` asks it before any time is read.
 * Read first: `.claude/rules/roster-import.md` — the import's whole contract.
 *
 * Moved out of `normaliseShift` at v25.38, when meetings gained their times and the parser reached
 * its line cap (coordinator-ratchet.test.mjs) — the same move that made `cell-day-rules.js` and
 * `roster-sunday-repair.js`.
 *
 * ── THE GRAMMAR IT WRITES ───────────────────────────────────────────────────────────────────────
 *
 * `FLAVOUR [" RDW"] [" HH:MM-HH:MM"]` — the client's own (`_OTHER_RE`, override-utils.js), which the
 * calendar, the pay engine and firestore.rules all read. This file is a deliberate duplicate of the
 * RECOGNITION side only: CommonJS cannot import a browser ES module (the accepted pattern, as with
 * `normaliseSurname`). The roster's words collapse to the sentinels through an explicit table; an
 * RDW marker on either side ("TRG RDW", "RDW TRG") marks a rest day and is kept as " RDW".
 *
 * ── EACH SENTINEL IS ALSO ITS OWN ALIAS, AND `MEET` WAS THE ONE THAT WAS NOT (v25.38) ───────────
 *
 * The prompt asks the model to return the sentinel ("MTG or MEETING = Meeting day. Return "MEET""),
 * and this grammar knew `MTG` and `MEETING` but not `MEET` — so every meeting an obedient model
 * returned became an UNREADABLE review cell for the admin to answer by hand. The other five never
 * had the gap only because each sentinel happens to be one of its roster's own words.
 * roster-prompt-parity.test.mjs now checks the right of every prompt row as well as the left.
 *
 * ── A MEETING IS ALWAYS A MEETING, TIMES AND ALL (owner, 6 Nov 2026) ────────────────────────────
 *
 * "MTG should always be other (with the meeting flavour)." A meeting is an attend-an-event day
 * (`hideBaseTime`), so a time printed with it is the meeting's own and worth keeping: the sheet
 * puts the time above the code, and the model may return either first. Before v25.38
 * "10:00-14:00 MTG" took `normaliseShift`'s trailing-content path and saved a plain SHIFT, the
 * meeting gone with nothing to say so. Now the meeting is read whole, and a cell naming a meeting
 * that cannot be read whole goes to review: `namesMeeting` is how `normaliseShift` refuses to keep
 * the time and drop the code.
 *
 * The other five keep the rule they had: no times on the roster. A timed one written code first
 * ("TRG 08:00-16:00") goes to review; written time first it still imports as a plain shift, a known
 * gap nobody has asked to close.
 */

/** The roster's words → the app's sentinel. Explicit, never first-letter dispatch, which would map
 *  an alias added to the pattern without a row here onto the wrong flavour. */
const OTHER_DAY_ALIASES = {
    TRG: 'TRG', TRAINING: 'TRG', TRAIN: 'TRG',
    IND: 'IND', INDUCTION: 'IND',
    ASSESS: 'ASSESS', ASSESSMENT: 'ASSESS', ASSESSMENTS: 'ASSESS',
    TEAM: 'TEAM', 'TEAM DAY': 'TEAM', 'TEAM DAYS': 'TEAM',
    UNION: 'UNION', 'UNION COURSE': 'UNION',
    MTG: 'MEET', MEET: 'MEET', MEETING: 'MEET', MEETINGS: 'MEET',
};

/** A bare Other-family cell: the flavour word, with an RDW marker on either side or neither. The
 *  multi-word labels are whitespace-collapsed before the lookup, so OCR double spacing still matches. */
const BARE_OTHER_DAY = /^(?:RDW\s+)?(TRG|TRAINING|TRAIN|IND(?:UCTION)?|ASSESS(?:MENTS?)?|TEAM(?:\s+DAYS?)?|UNION(?:\s+COURSE)?|MTG|MEET(?:INGS?)?)(?:\s+(RDW))?$/;

/** The roster's words for a MEETING, as whole words, so `MEETS` is not one. Upper case only. */
const MEETING_WORD = /\b(?:MTG|MEET(?:INGS?)?)\b/;

/**
 * Read a MEETING cell that carries its times, in any order — `MTG 10:00-14:00`, `10:00-14:00 MTG`,
 * `MEET RDW 10:00-14:00`, `10:00-14:00 RDW MTG` — as `MEET[" RDW"] HH:MM-HH:MM`. The cell must hold
 * the meeting word, one time range and at most an RDW marker, and nothing else.
 * @param {string} s  the cell, trimmed and upper-cased
 * @param {(h1: string, m1: string, h2: string, m2: string) => boolean} workedRange  normaliseShift's own time check
 * @returns {string|null}
 */
function meetingWithTimes(s, workedRange) {
    if (!MEETING_WORD.test(s)) return null;
    let rest = s.replace(MEETING_WORD, ' ');
    const time = rest.match(/(\d{1,2})[:.]?(\d{2})[\s\-–]+(\d{1,2})[:.]?(\d{2})/);
    if (!time || !workedRange(time[1], time[2], time[3], time[4])) return null;
    rest = rest.replace(time[0], ' ');
    const rdw = /\bRDW\b/.test(rest);
    if (rdw) rest = rest.replace(/\bRDW\b/, ' ');
    if (rest.trim() !== '') return null;
    const range = `${time[1].padStart(2, '0')}:${time[2]}-${time[3].padStart(2, '0')}:${time[4]}`;
    return `MEET${rdw ? ' RDW' : ''} ${range}`;
}

/**
 * The Other-family value this cell reads as, or null when it is not a clean Other-family cell.
 * @param {string} s  the cell, trimmed and upper-cased
 * @param {(h1: string, m1: string, h2: string, m2: string) => boolean} workedRange
 * @returns {string|null}
 */
function readOtherDayCell(s, workedRange) {
    const bare = s.match(BARE_OTHER_DAY);
    if (bare) {
        const flavour = OTHER_DAY_ALIASES[/** @type {keyof typeof OTHER_DAY_ALIASES} */ (bare[1].replace(/\s+/g, ' '))];
        const rdw = /^RDW\s/.test(s) || !!bare[2];
        return rdw ? `${flavour} RDW` : flavour;
    }
    return meetingWithTimes(s, workedRange);
}

/**
 * Does the cell NAME a meeting anywhere? `normaliseShift`'s trailing-content path asks, so that a
 * meeting it could not read whole ("06:00-12:00 MTG CEA 3") goes to review rather than losing its
 * code to leave a plain shift.
 * @param {string} s  upper-cased
 * @returns {boolean}
 */
function namesMeeting(s) { return MEETING_WORD.test(s); }

module.exports = { OTHER_DAY_ALIASES, readOtherDayCell, meetingWithTimes, namesMeeting };
