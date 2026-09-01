// @ts-check
/**
 * roster-alignment.js — is a roster read trustworthy, or is it a day out?
 *
 * Owns: the ONE question "does this parsed week belong to the days it claims?", per member and
 *   across the whole read.
 * Does NOT own: the parse (functions/roster-parse-helpers.js), the review states or the writes
 *   (admin-roster-upload.js), or the review markup.
 * Edit here for: the drift detector, the block threshold, or how a batch signature is judged.
 *
 * ── WHY THIS IS ITS OWN MODULE (v22.16, external review) ───────────────────────────────────────
 *
 * It is the app's only AI-INDEPENDENT evidence about the roster import, and that makes it a
 * domain rule rather than coordination.
 *
 * The row read, the Sunday scan and the column scan all come from ONE model call looking at ONE
 * PDF. They are not independent witnesses, and the failure that prompted this proves it: when the
 * model visually collapses the blank Sunday cell and repeats that same positional mistake across
 * all three channels, every server-side check agrees with the wrong answer and a whole week is
 * written onto the wrong days. Nothing errors. Staff come in on the wrong day.
 *
 * What this module compares against is not the model at all — it is the member's own rotating base
 * pattern, which the PDF cannot influence. That is the whole value, and it is why the decision has
 * to be reachable, testable and stated in one place rather than computed inside a 1,400-line
 * coordinator at render time.
 *
 * Extracting it was forced by the ratchet, and the ratchet was right: the coordinator had grown by
 * 135 lines of RULE. It also has a second payoff the ratchet did not promise — this module imports
 * no Firebase, so the detector loads in Node, and a test can build a shifted-week fixture from the
 * real roster instead of hard-coding member names that go stale.
 */

import { teamMembers, getBaseShift, parseISODate } from './roster-data.js';

const RDW_PREFIX       = 'RDW|';
const UNKNOWN_PREFIX   = 'UNKNOWN|';
const isRdwEncoded     = /** @param {any} v */ v => typeof v === 'string' && v.startsWith(RDW_PREFIX);
const stripRdw         = /** @param {any} v */ v => v.slice(RDW_PREFIX.length);
const isUnknownEncoded = /** @param {any} v */ v => typeof v === 'string' && v.startsWith(UNKNOWN_PREFIX);

/**
 * Detect a parsed row that looks shifted by ONE DAY against the member's own base roster —
 * the one signal fully independent of the AI (both the row read AND the column-scan cross-check
 * come from the same model looking at the same PDF, so they can, rarely, misread identically;
 * the base rotating pattern cannot).
 *
 * Correlates the parsed week against the base roster at offsets −1 / 0 / +1: if a ±1 alignment
 * matches ≥ 3 MORE days than the correct alignment (and ≥ 5 of 7 overall), the row very probably
 * drifted a day in the parse. Rotating rosters make adjacent days differ most weeks, so a genuine
 * override-heavy week (sparse changes) doesn't correlate at ±1 — while a drifted row mismatches
 * nearly everywhere at offset 0 and snaps into place at ±1. Fixed-pattern members (same time all
 * week) score similarly at every offset, so the ≥3 improvement bar keeps them silent.
 *
 * Pure (no DOM); returns 'left' (values belong one day LATER — row slid left), 'right', or null.
 *
 * @param {any} member       teamMembers entry
 * @param {Record<string,string>} shifts   parsed { date: value }
 * @param {string[]} dates   the week's 7 ISO dates
 * @returns {'left'|'right'|null}
 */
export function detectShiftedRow(member, shifts, dates) {
    if (!member || !shifts || !Array.isArray(dates) || dates.length < 7) return null;
    const normRest = (/** @type {string} */ v) => (v === 'OFF' ? 'RD' : v);
    const parsedAt = (/** @type {string} */ date) => {
        const v = shifts[date];
        if (typeof v !== 'string' || v === '' ) return null;
        if (isUnknownEncoded(v)) return null;            // already flagged — no signal
        return normRest(isRdwEncoded(v) ? stripRdw(v) : v);
    };
    const baseAt = (/** @type {string} */ date, /** @type {number} */ offset) => {
        const d = parseISODate(date);
        d.setDate(d.getDate() + offset);
        return normRest(getBaseShift(member, d));
    };
    const score = (/** @type {number} */ offset) => dates.reduce((n, date) => {
        const p = parsedAt(date);
        return (p !== null && p === baseAt(date, offset)) ? n + 1 : n;
    }, 0);
    const s0 = score(0);
    // Row slid LEFT → each parsed value is really the NEXT day's → matches base at offset +1.
    const sLeft  = score(1);
    const sRight = score(-1);
    if (sLeft  - s0 >= 3 && sLeft  >= 5 && sLeft  >= sRight) return 'left';
    if (sRight - s0 >= 3 && sRight >= 5) return 'right';
    return null;
}

/**
 * How many members must share the SAME one-day drift before the whole read is refused.
 *
 * Three. One member can genuinely have an unusual week. Two is a coincidence. Three separate
 * employees whose weeks all correlate with their own base pattern shifted one day in the SAME
 * direction, in one upload, is not something that happens on a real roster — it is a parser
 * failure with a batch signature. And the per-member bar is already high (`detectShiftedRow`
 * needs ≥5 of 7 matching at ±1 and ≥3 better than the correct alignment), so three of those
 * together is not a near-miss.
 */
export const ALIGNMENT_BLOCK_THRESHOLD = 3;

/**
 * The roster-level alignment verdict — the CIRCUIT BREAKER (v22.16, external review).
 *
 * ── WHY A WHOLE-ROSTER VERDICT AND NOT JUST PER-ROW WARNINGS ────────────────────────────────────
 *
 * The row read, the Sunday scan and the column scan all come from ONE model call looking at one
 * PDF. They are not independent evidence, and the failure this defends against proves it: when the
 * model visually collapses the blank Sunday cell and repeats that mistake consistently across all
 * three channels, every server-side check agrees with the wrong answer and the shifted week
 * survives. `detectShiftedRow` is the only signal that does not come from the model — it compares
 * the parsed week against the member's own rotating base pattern — but it was WARN-ONLY, with
 * every change still ticked, so the last line of defence asked a tired admin to notice.
 *
 * A systematic one-day displacement across several people is overwhelmingly more likely to be a
 * parser failure than several employees independently changing their whole roster in the same
 * direction in the same week. When it looks like that, the software knows enough to refuse.
 *
 * Deliberately: NO per-row override and NO "save anyway" when blocked. A systematic misread makes
 * the WHOLE read untrustworthy, including the rows that happen to look fine — the rows that agree
 * with the base roster are exactly the rows a shift would leave looking unremarkable.
 *
 * @param {{parsed: {memberName: string, shifts: Record<string,string>}[], dates: string[]}} parsedResult
 * @returns {{ byMember: Map<string,'left'|'right'>, blocked: boolean,
 *             direction: 'left'|'right'|null, suspects: string[] }}
 */
export function assessRosterAlignment(parsedResult) {
    /** @type {Map<string,'left'|'right'>} */
    const byMember = new Map();
    const dates = parsedResult?.dates || [];
    for (const entry of (parsedResult?.parsed || [])) {
        const member = teamMembers.find(m => m.name === entry.memberName && !m.hidden);
        if (!member) continue;
        const drift = detectShiftedRow(member, entry.shifts, dates);
        if (drift) byMember.set(entry.memberName, drift);
    }
    // Count by DIRECTION, not by total. A parser that drops a leading blank moves every row the
    // same way; two members drifting in opposite directions is noise, not a systematic misread.
    /** @type {Record<string, string[]>} */
    const byDirection = { left: [], right: [] };
    for (const [name, dir] of byMember) byDirection[dir].push(name);
    const worst = byDirection.left.length >= byDirection.right.length ? 'left' : 'right';
    const suspects = byDirection[worst];
    const blocked = suspects.length >= ALIGNMENT_BLOCK_THRESHOLD;
    return { byMember, blocked, direction: blocked ? /** @type {'left'|'right'} */ (worst) : null, suspects };
}

