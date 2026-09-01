// @ts-check
/**
 * paycalc-fill-year.js — "Fill this tax year from your calendar": the bulk form of the
 * single-period roster pre-fill, and the rules that make a bulk write safe against pay data.
 *
 * The single fill is good and almost nobody has history: the HPP estimate, the back-pay accrual
 * and the year-so-far summary all sharpen with filled periods, but populating a year meant
 * visiting thirteen periods by hand. One action now runs the SAME conservative engine
 * (getRosterSuggestion — premium categories only, no guessed weekday hours) across every period
 * the year-so-far block lists under "Not entered yet", and no others.
 *
 * Four rules, each the difference between a convenience and a data-loss bug:
 *
 *  1. NEVER A PERIOD WITH ENTERED DATA. Eligibility is the EXACT test the "Not entered yet" list
 *     uses (paid + employed + isDataEmpty), so the button fills precisely what that line names.
 *  2. A CORRUPT PERIOD IS NEVER WRITTEN. readSavedPeriod's error state means "something is here
 *     we could not read" — overwriting it destroys whatever it held. It is skipped and counted.
 *  3. NO BASE-ONLY FILLS. The single fill may fall back to the base roster because its result
 *     lands on screen under the member's eyes with a badge saying so; a bulk fill lands in
 *     periods nobody is looking at. A period whose recorded-changes fetch fails is SKIPPED and
 *     named — refuse rather than half-know.
 *  4. FILLS ARE MARKED. Every written period also gets the roster snapshot (the same shape
 *     _saveRosterSnap writes), so opening it shows the gold roster-suggested state and the
 *     result card's provenance chip, exactly like the single fill.
 *
 * Pure orchestration over INJECTED deps (fetch, suggest, read, write), so the interleavings and
 * all four rules run in Node — paycalc-fill-year.test.mjs, including the reintroduction of each
 * rule's violation as a mutation. The DOM button and the post-fill refresh live in paycalc-app.js.
 */

import { HM_PAIRS, isDataEmpty } from './paycalc-format.js';
import { emptyPeriodData } from './paycalc-form-data.js';

/**
 * Which of the year's periods this action may touch — and what it must leave alone.
 *
 * @param {{ periods: any[], now: Date, proRateFactor: (p: any) => number,
 *   readSaved: (pNum: number) => {data: any, error?: any} }} arg
 * @returns {{ fillable: any[], corrupt: any[] }}
 */
export function fillablePeriods({ periods, now, proRateFactor, readSaved }) {
    const fillable = [], corrupt = [];
    for (const p of periods) {
        if (!(p.payday <= now) || !(proRateFactor(p) > 0)) continue;   // unpaid, or pre-start
        const parsed = readSaved(p.num);
        if (parsed.error) { corrupt.push(p); continue; }               // rule 2
        if (parsed.data && !isDataEmpty(parsed.data)) continue;        // rule 1
        fillable.push(p);
    }
    return { fillable, corrupt };
}

/**
 * Run the fill. Sequential on purpose: the suggestion engine keeps one module-level override map
 * per fetch, so periods must be fetched and read one at a time — and the CALLER must re-fetch the
 * on-screen period afterwards, because the loop leaves that map pointing at the last period here.
 *
 * @param {{ periods: any[], member: any, now: Date,
 *   deps: {
 *     proRateFactor: (p: any) => number,
 *     readSaved: (pNum: number) => {data: any, error?: any},
 *     fetchOverrides: (p: any, memberName: string) => Promise<string>,
 *     suggest: (p: any, member: any) => any,
 *     write: (pNum: number, data: Record<string, any>, snap: Record<string, any>) => boolean,
 *   } }} arg
 * @returns {Promise<{ filled: any[], unreached: any[], nothing: any[], corrupt: any[], unsaved: any[] }>}
 *   filled — written AND verified; unreached — skipped, recorded changes could not be loaded
 *   (rule 3); nothing — eligible but no premium hours to add; corrupt — skipped unreadable
 *   (rule 2); unsaved — the write was attempted and did not persist (rule 6).
 */
export async function fillYearFromCalendar({ periods, member, now, deps }) {
    const { fillable, corrupt } = fillablePeriods({ periods, now, proRateFactor: deps.proRateFactor, readSaved: deps.readSaved });
    const filled = [], unreached = [], nothing = [], unsaved = [];
    for (const p of fillable) {
        let state = 'base-only';
        try { state = await deps.fetchOverrides(p, member?.name); } catch { /* skip below */ }
        if (state !== 'loaded') { unreached.push(p); continue; }       // rule 3 — never half-know
        const s = deps.suggest(p, member);
        if (!s) { nothing.push(p); continue; }                         // a quiet period is not an error
        // RULE 5 — PRESERVE WHAT THE CALENDAR DOES NOT OWN (v22.13).
        //
        // This used to be `{ ...emptyPeriodData() }` — a fresh object — and that was silent data
        // loss. `isDataEmpty` means "has no CALCULATION INPUTS", which is the right question for
        // eligibility (a period holding only a payslip figure genuinely cannot produce an estimate,
        // so filling it IS correct). It is not the same question as "holds nothing worth keeping":
        // actual gross/net/tax/NI and a custom pension are all invisible to it. A historical period
        // with those and no premium hours was therefore judged fillable and then overwritten, and
        // the member's own typed figures went with no message. Reported by external review and
        // reproduced.
        //
        // So: the empty schema underneath (no key may be MISSING, or a later read sees a hole), the
        // saved period on top of it, and only then the calendar's own fields. Widening
        // `isDataEmpty` would have been the wrong fix — its other callers correctly need the
        // narrower meaning.
        const savedData = deps.readSaved(p.num)?.data;
        const data = /** @type {Record<string, any>} */ ({ ...emptyPeriodData(), ...(savedData || {}) });
        const snap = /** @type {Record<string, any>} */ ({});
        for (const { hId, mId } of HM_PAIRS) {
            data[hId] = s[hId] ?? 0;
            data[mId] = s[mId] ?? 0;
            snap[hId] = s[hId]; snap[mId] = s[mId];                    // rule 4 — same shape as _saveRosterSnap
        }
        // RULE 6 — A RECEIPT ONLY COUNTS A VERIFIED WRITE (v22.13). `lsSet` is deliberately
        // forgiving: iOS private mode, a full quota and a locked-down browser all throw, and a
        // preference that fails to save is not worth crashing a page over. A BULK write onto pay
        // data reads that silence as success and then tells the member "Filled 5 payslips" when
        // some were not saved at all — the same shape as the migration defect `lsSetVerified`
        // exists for. `write` therefore returns a boolean, and only a true lands in `filled`.
        if (deps.write(p.num, data, snap)) filled.push(p);
        else unsaved.push(p);
    }
    return { filled, unreached, nothing, corrupt, unsaved };
}

/**
 * The receipt, in words — a count cannot answer "which ones?", and the commonest follow-up
 * question ("why not that one?") gets its answer by NAME.
 * @param {{ filled: any[], unreached: any[], nothing: any[], corrupt: any[], unsaved?: any[] }} r
 * @param {(d: Date) => string} fd  short date formatter
 * @returns {string[]} lines; empty when there was nothing eligible at all
 */
export function fillYearReceipt(r, fd) {
    const list = (/** @type {any[]} */ ps) => ps.map(p => fd(p.payday)).join(', ');
    const lines = [];
    if (r.filled.length) {
        lines.push(`Filled ${r.filled.length} payslip${r.filled.length === 1 ? '' : 's'} from your calendar — ${list(r.filled)}. `
            + 'Review the suggested hours (shown in gold) before relying on them.');
    }
    if (r.nothing.length) lines.push(`No special-rate hours to add for ${list(r.nothing)}.`);
    if (r.unreached.length) {
        lines.push(`Couldn't check your recorded shift changes for ${list(r.unreached)} — `
            + 'open each of those payslips and use "Fill from calendar" there.');
    }
    if (r.unsaved?.length) {
        lines.push(`Couldn't save ${list(r.unsaved)} — this device refused to store them `
            + '(private browsing, or storage is full). Nothing was lost; try again after freeing space.');
    }
    if (r.corrupt.length) lines.push(`${r.corrupt.length} saved payslip${r.corrupt.length === 1 ? '' : 's'} couldn't be read and ${r.corrupt.length === 1 ? 'was' : 'were'} left untouched.`);
    if (!lines.length) lines.push('Every paid payslip this year already has entries — nothing to fill.');
    return lines;
}
