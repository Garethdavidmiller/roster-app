// @ts-check
/**
 * paycalc-pension.js — WHEN a member was in the pension scheme, not merely WHETHER (v21.78).
 *
 * ── THE DEFECT THIS MODULE EXISTS FOR ───────────────────────────────────────────────────────────
 *
 * v21.64 added "I'm not in the pension scheme" as a single boolean. The setting was right; the
 * SHAPE was wrong, and the shape is what made it a money bug — found by external review, then
 * reproduced: a 2025/26 payslip with real hours entered went from a £160.78 pension deduction to
 * £0.00, and its take-home rose by £115.92, purely because the member ticked a box today.
 *
 * The mechanism is the collision of two individually-good designs:
 *
 *   · `readFormData` stores `null` when the pension field equals the period default, so the
 *     period keeps healing as the app learns the real historic rates (PENSION_STEPS). Most
 *     historical payslips therefore hold NO pension figure of their own — they hold "the default".
 *   · The opt-out made the default £0 for every period there has ever been.
 *
 * So "payslips from when you WERE contributing keep their own amount" — which the Settings hint
 * promised in those words — was true only of the rare payslip carrying an explicitly-typed
 * non-default figure. Everything else was rewritten retroactively, silently, and in the direction
 * that overstates take-home.
 *
 * ── WHY A TIMELINE AND NOT A SECOND DATE FIELD ──────────────────────────────────────────────────
 *
 * Leaving the scheme is not a one-way door. UK auto-enrolment requires an employer to RE-ENROL
 * opted-out staff roughly every three years, so "out from P56, back in from P95" is not a
 * hypothetical to be handled later — it is the expected shape within the life of this data. A
 * single "opted out from" field models the first event and then makes the second one produce the
 * same class of bug in reverse: un-ticking would hand the scheme default back to the months she
 * genuinely was not contributing.
 *
 * A timeline is a list of CHANGES, ascending by payslip: `[{from: 56, out: true}]` means
 * contributing up to P55 and out from P56 onwards. Absent or empty means contributing throughout,
 * which is every member but one and costs nothing to represent.
 *
 * `p.num` is the app's global ascending payslip number (it spans tax years — see `getPeriods`), so
 * one integer is a total order and no date arithmetic is needed here.
 *
 * ── THE RULES AN EDIT MUST NOT BREAK ────────────────────────────────────────────────────────────
 *
 *  1. **An empty timeline means CONTRIBUTING.** Never opted out. A parse failure, a cleared key and
 *     a member who never touched the setting must all land on the same answer, and it must be the
 *     one that leaves every historical figure exactly as it was.
 *  2. **A period before the first change is never affected by it.** This is the whole module. The
 *     lookup takes the LAST change at or before the payslip, and if there is none the member was
 *     contributing — it does not fall back to the newest state.
 *  3. **`parsePensionTimeline` is a trust boundary**, like `validateBackup`. It reads localStorage,
 *     which survives app versions and can be edited by hand or restored from another device's
 *     backup. Anything it cannot read whole becomes an empty timeline (rule 1) rather than a
 *     partial one — a half-read timeline would silently move the boundary between contributing and
 *     not, which is the defect this module was written to remove.
 *
 * Pure: no DOM, no storage, no imports. Tested by paycalc-pension.test.mjs.
 */

/**
 * @typedef {{ from: number, out: boolean }} PensionChange
 *   `from` — the payslip number (`p.num`) this state begins at, inclusive.
 *   `out`  — true = not in the scheme from that payslip onwards.
 */

/**
 * Read a stored timeline. THE TRUST BOUNDARY — see rule 3.
 *
 * Refuses whole rather than in part: one malformed entry discards the lot, because a timeline
 * missing its middle change reads as a perfectly valid timeline that says something else.
 *
 * @param {string|null|undefined} raw JSON as stored, or null when the key is absent.
 * @returns {PensionChange[]} ascending by `from`, at most one change per payslip. Empty on
 *   anything unreadable.
 */
export function parsePensionTimeline(raw) {
    if (!raw) return [];
    let parsed;
    try { parsed = JSON.parse(raw); } catch { return []; }
    if (!Array.isArray(parsed) || parsed.length === 0) return [];
    /** @type {PensionChange[]} */
    const out = [];
    for (const entry of parsed) {
        if (!entry || typeof entry !== 'object') return [];
        const from = entry.from;
        if (typeof from !== 'number' || !Number.isFinite(from) || !Number.isInteger(from)) return [];
        if (typeof entry.out !== 'boolean') return [];
        // A duplicated payslip is ambiguous about which state wins — refuse rather than pick.
        if (out.some(c => c.from === from)) return [];
        out.push({ from, out: entry.out });
    }
    out.sort((a, b) => a.from - b.from);
    return out;
}

/** @param {PensionChange[]} timeline @returns {string} */
export function serialisePensionTimeline(timeline) {
    return JSON.stringify(timeline);
}

/**
 * Was the member OUT of the scheme on this payslip?
 *
 * The last change at or before `pNum` wins; with no such change the member was contributing
 * (rule 2). Note what this deliberately does NOT do: it never consults a later change, so
 * recording an opt-out today can not reach backwards into a payslip already paid.
 *
 * @param {PensionChange[]} timeline
 * @param {number|null|undefined} pNum The payslip number, or null when there is no period in
 *   hand — answered as "contributing", the state that changes no figure.
 * @returns {boolean}
 */
export function isOptedOutAt(timeline, pNum) {
    if (!timeline.length || typeof pNum !== 'number') return false;
    let state = false;
    for (const change of timeline) {
        if (change.from > pNum) break;
        state = change.out;
    }
    return state;
}

/**
 * Record "from payslip `pNum` the member is (not) in the scheme".
 *
 * Redundant changes are collapsed — a change that states what was already true at that point
 * carries no information and would otherwise accumulate every time the box is toggled. Later
 * changes are KEPT: they are recorded facts about payslips this one does not cover, and silently
 * dropping them is how a timeline starts disagreeing with what the member entered.
 *
 * @param {PensionChange[]} timeline
 * @param {number} pNum
 * @param {boolean} out
 * @returns {PensionChange[]} a new timeline; the input is not mutated.
 */
export function withPensionChange(timeline, pNum, out) {
    const kept = timeline.filter(c => c.from !== pNum);
    kept.push({ from: pNum, out });
    kept.sort((a, b) => a.from - b.from);
    // Collapse: drop any change equal to the state immediately before it. Runs after the insert so
    // a re-tick of an existing state disappears rather than being stored twice.
    /** @type {PensionChange[]} */
    const collapsed = [];
    let state = false;
    for (const change of kept) {
        if (change.out === state) continue;
        collapsed.push(change);
        state = change.out;
    }
    return collapsed;
}

/**
 * The payslip the member's CURRENT out-of-scheme spell began at, or null when the timeline's
 * final state is "contributing".
 *
 * Used to fill the "from which payslip?" control, so re-opening Settings shows the date already
 * recorded rather than defaulting back to today and inviting an accidental correction.
 *
 * @param {PensionChange[]} timeline
 * @returns {number|null}
 */
export function optOutStartsAt(timeline) {
    const last = timeline[timeline.length - 1];
    return last && last.out ? last.from : null;
}

/**
 * Has the member ever recorded a pension change? Drives whether the "from which payslip?" control
 * is worth showing — a member who has never left the scheme should not be asked to date something
 * that did not happen, but one who HAS must keep the control after un-ticking, or a rejoin has
 * nowhere to say which payslip it started on.
 *
 * @param {PensionChange[]} timeline @returns {boolean}
 */
export function hasAnyPensionChange(timeline) {
    return timeline.length > 0;
}

/**
 * Convert the retired v21.64–v21.77 boolean into a timeline.
 *
 * The flag recorded no date, so no migration can recover the real one. This picks the FIRST
 * PAYSLIP OF THE TAX YEAR IN WHICH THE FLAG COULD FIRST HAVE BEEN SET — the feature shipped on
 * 23 Aug 2026, so anybody carrying the flag set it in 2026/27 — and the property that makes it
 * safe is directional: every payslip it moves, it moves from a wrongly-imposed £0 back to the
 * scheme default, and it can never impose a £0 on a payslip that did not already have one.
 * Earlier tax years, which the flag was silently rewriting, are restored in full.
 *
 * Within the current year it may still start a few payslips early. That is visible and correctable
 * in the control the migration makes appear, which is the difference between a wrong figure and a
 * wrong figure nobody can reach.
 *
 * @param {boolean} legacyOptedOut
 * @param {number|null} firstPNumOfCurrentTaxYear
 * @returns {PensionChange[]}
 */
export function migrateLegacyOptOut(legacyOptedOut, firstPNumOfCurrentTaxYear) {
    if (!legacyOptedOut || typeof firstPNumOfCurrentTaxYear !== 'number') return [];
    return [{ from: firstPNumOfCurrentTaxYear, out: true }];
}
