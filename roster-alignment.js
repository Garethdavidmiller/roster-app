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

/** 'left' | 'right' from the base-roster detector; 'geometry' when the PDF's own grid refused a cell on the row. */
/** @typedef {'left'|'right'|'geometry'} Drift */

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
 * @param {{parsed: {memberName: string, shifts: Record<string,string>}[], dates: string[], geometryRefused?: string[]}} parsedResult
 * @returns {{ byMember: Map<string, Drift>, blocked: boolean,
 *             direction: 'left'|'right'|null, suspects: string[], geometryRefused: string[] }}
 */
export function assessRosterAlignment(parsedResult) {
    /** @type {Map<string, Drift>} */
    const byMember = new Map();
    const dates = parsedResult?.dates || [];
    for (const entry of (parsedResult?.parsed || [])) {
        const member = teamMembers.find(m => m.name === entry.memberName && !m.hidden);
        if (!member) continue;
        const drift = detectShiftedRow(member, entry.shifts, dates);
        if (drift) byMember.set(entry.memberName, drift);
    }
    // THE PDF'S OWN GRID (functions/roster-geometry.js, v22.31). A row the server refused holds a
    // claim in a physically EMPTY cell — misaligned as a matter of fact, not of correlation, and
    // measured at zero false refusals. It is folded in HERE, not wired separately, so the
    // coordinator keeps ONE reading of "this row is a day out": `byMember` unticks the row and
    // `suspects` feeds the breaker, for either origin. A base-roster verdict keeps its direction (it
    // knows one); geometry does not, and must not borrow one.
    // Only names actually ON this review count: the server filters unknown names AFTER its witness
    // runs, so a refused name can arrive that no row carries, and a phantom must not trip the breaker.
    const onReview = new Set((parsedResult?.parsed || []).map(e => e.memberName));
    const geometryRefused = new Set((Array.isArray(parsedResult?.geometryRefused) ? parsedResult.geometryRefused : [])
        .filter(name => onReview.has(name)));
    for (const name of geometryRefused) if (!byMember.has(name)) byMember.set(name, 'geometry');
    // Count by DIRECTION, not by total. A parser that drops a leading blank moves every row the
    // same way; two members drifting in opposite directions is noise, not a systematic misread.
    // A geometry refusal is not noise — it counts whichever way the others lean.
    /** @type {Record<string, string[]>} */
    const byDirection = { left: [], right: [], geometry: [] };
    for (const [name, dir] of byMember) byDirection[dir].push(name);
    const worst = byDirection.left.length >= byDirection.right.length ? 'left' : 'right';
    const suspects = [...new Set([...byDirection[worst], ...geometryRefused])];
    const blocked = suspects.length >= ALIGNMENT_BLOCK_THRESHOLD;
    // `direction` is what the stop banner phrases its cause from — null when nothing directional
    // contributed, so the copy cannot claim a direction it does not have.
    const direction = blocked && byDirection[worst].length ? /** @type {'left'|'right'} */ (worst) : null;
    return { byMember, blocked, direction, suspects, geometryRefused: [...geometryRefused] };
}

/**
 * Did the PDF's own grid actually get consulted, and what does the admin need to know if it did
 * not?
 *
 * **The witness is fail-open by design, and a fail-open check nobody can see is indistinguishable
 * from one that passed.** The server has reported `geometry.status` since the witness shipped, and
 * for nine versions no client read it: a file with no text layer, a page pdf.js could not parse, a
 * `pdfjs-dist` that failed to load — every one of those produced a review that looked exactly like
 * a review where the grid had agreed with every cell (v22.39 external review).
 *
 * The three answers are deliberately not symmetrical:
 *
 * · `complete` says NOTHING. It ran on every row, so there is no exception to report — and a green
 *   "✓ layout checked" badge would be a claim the admin never asked for, on a surface whose whole
 *   discipline is that an absence of warnings is the good state.
 * · `partial` names the arithmetic. The refusals it DID find are already on the rows; what this
 *   adds is that some rows were never asked about, which is the part no row can say for itself.
 * · `unavailable`, **including a response with no `geometry` field at all**, says the check did
 *   not happen. Absence is read as "did not run" rather than "ran and found nothing", because the
 *   alternative is the exact failure this function exists to end.
 *
 * It deliberately does NOT untick anything. Whether a missing second witness should also fail the
 * whole read closed is a real question and an owner decision — the base-roster detector is still
 * running, so the import is no weaker than it was before geometry existed, and quietly promoting
 * "we could not check" to "we refuse" would block imports on any PDF pdf.js dislikes.
 *
 * @param {{ status?: string, checked?: number, total?: number }} [geometry]
 * @returns {string} HTML, or '' when there is nothing to say
 */
export function geometryCopy(geometry) {
    const status = geometry?.status;
    if (status === 'complete') return '';
    const lead = '<span aria-hidden="true">⚠</span> ';
    if (status === 'partial') {
        const checked = Number(geometry?.checked) || 0;
        const total   = Number(geometry?.total) || 0;
        return `${lead}<strong>The PDF layout check read ${checked} of ${total} staff rows.</strong> `
            + 'The rest were not checked against the PDF\u2019s own table — compare those against the roster before saving.';
    }
    return `${lead}<strong>The extra PDF layout check couldn\u2019t run for this file.</strong> `
        + 'The days below were read by one method only, so compare the changes against the original roster before saving.';
}

/**
 * Per-member warning for a row that starts unticked. Returns HTML; `escapedName` is already escaped
 * by the caller. Lives beside the verdict so a third kind of drift cannot silently wear the wording
 * of the first two — 'geometry' rendered "shifted a day later" until this existed.
 * @param {Drift} drift @param {string} escapedName
 */
export function driftCopy(drift, escapedName) {
    const lead = '<span aria-hidden="true">⚠️</span> <strong>These days may be one day out — nothing here is selected.</strong> ';
    const tail = ' Check each day against the PDF and tick only what you have confirmed, or read the roster again.';
    if (drift === 'geometry') {
        return `${lead}A day was read for ${escapedName} where the PDF's own table has an empty cell, which usually means the row was read a column out.${tail}`;
    }
    // 'left' = each parsed value really belongs to the NEXT day (parsed[d] matches base[d+1]) —
    // i.e. the usual pattern appears a day EARLIER than it should. (The first wording had this
    // inverted — v16.69 review fix.)
    return `${lead}${escapedName}'s week lines up better with their usual pattern shifted a day ${drift === 'left' ? 'earlier' : 'later'}, which usually means a column was skipped when the roster was read.${tail}`;
}

/**
 * The whole-read refusal banner. `who` is the escaped, capped name list the caller built.
 * The CAUSE is stated as a possibility, not a diagnosis: a left shift is usually the blank Sunday
 * column being skipped, and saying so helps — but on a right shift that explanation is simply
 * wrong, and when the evidence is the PDF's own grid the cause is a different sentence again. A
 * confident wrong cause sends the admin looking in the wrong place, which is worse than none.
 * @param {{ direction: 'left'|'right'|null, suspects: string[], geometryRefused?: string[] }} alignment @param {string} who
 */
export function stopCopy(alignment, who) {
    const n = alignment.suspects.length;
    const lead = '<span aria-hidden="true">⛔</span> <strong>This read looks one day out and has not been saved.</strong>';
    const close = ' <strong>Nothing has been selected for saving.</strong> Read the roster again; if it happens twice, check the PDF against this week by hand.';
    if (alignment.direction === null) {
        return `${lead} On ${n} staff rows a day was read where the PDF's own table has an empty cell — ${who}. That is a sign the roster was read a column out — not everyone changing their week at once.${close}`;
    }
    const likely = alignment.direction === 'left'
        ? 'usually the blank Sunday column being skipped when the roster is read'
        : 'a sign a cell was misread when the roster was read';
    const geo = (alignment.geometryRefused || []).length;
    const also = geo ? ` On ${geo} of those rows the PDF's own table shows an empty cell where a day was read.` : '';
    return `${lead} ${n} staff line up with their usual pattern shifted a day ${alignment.direction === 'left' ? 'earlier' : 'later'} — ${who}.${also} That is ${likely} — not everyone changing their week at once.${close}`;
}

