// @ts-check
/**
 * paycalc-year-card.js — the "This tax year so far" block in the Year to Date card, and the
 * fill-the-year control that lives beside its "Not entered yet" line.
 *
 * Extracted from paycalc-app.js at v22.06, when the fill-year feature needed a home the
 * coordinator's ratchet had no room for — the right response being an extraction that pays for
 * the feature, not a raised cap. The RENDER half is `_renderYearSoFar` moved verbatim (v18.41's
 * headless per-payslip sum + rough projection; the v18.84 prior-year HPP flag fix rides along
 * unchanged). What is NEW here:
 *
 *  - THE BUTTON sits beside the line that names what it fixes: "Not entered yet: 10 Apr, 8 May"
 *    gains "Fill these from your calendar". No confirm — it cannot overwrite anything
 *    (paycalc-fill-year.js rule 1) — and a receipt afterwards, because a bulk action's follow-up
 *    question is always "which ones?".
 *  - THE FROM-ZERO STATE. The block used to hide entirely until one payslip had hours — which
 *    hid the button from exactly the member the bulk fill helps most. With nothing entered but
 *    paid periods waiting, a slim variant now renders: the count, the missing list, the button —
 *    no totals rows, because there is nothing to total.
 *  - THE POST-FILL ORDER: re-fetch the ON-SCREEN period's recorded changes (the fill loop leaves
 *    the suggestion module's map on the last period it visited), hand the receipt to the
 *    coordinator (which reloads the visible form if it was one of the filled ones, then
 *    recalculates — re-rendering this block WITH the receipt), then refresh the hint bar.
 *
 * The RULES all live in paycalc-fill-year.js (pure, tested); this module renders and sequences.
 */

import { computeYearSoFar } from './paycalc-year-summary.js';
import { getPeriods, currentPeriodNum, CONFIG } from './paycalc-periods.js';
import { periodsInTaxYear, hppPaidInTaxYear } from './paycalc-hpp-schedule.js';
import { resolveHppForPeriod } from './paycalc-hpp.js';
import { getLoggedMember, getProRateFactor } from './paycalc-settings.js';
import { readSavedPeriod, periodKey, hppEstKey, hppActualKey, hppIncKey } from './paycalc-migrations.js';
import { getRosterSuggestion, fetchOverridesForPeriod } from './paycalc-roster-suggestions.js';
import { snapKey, updateRosterHint } from './paycalc-roster-hint.js';
import { fillYearFromCalendar, fillYearReceipt } from './paycalc-fill-year.js';
import { fmt, fdList, fdShort } from './paycalc-format.js';
import { lsGet, lsSetBothVerified } from './ls.js';

/** @type {{ tyLabel: string, lines: string[] }|null} last fill's receipt, shown until the year changes */
let _receipt = null;
/** @type {any} the args of the last render, so the fill handler acts on what is on screen */
let _lastArgs = null;
/** @type {((r: any) => void)|null} */
let _afterFill = null;
let _filling = false;

/**
 * Wire the card once (delegated — the render replaces the block's children on every calculate).
 * @param {{ afterFill: (r: any) => void }} cfg  coordinator hook: reload the visible form if it
 *   was filled, then recalculate (which re-renders this block, receipt included).
 */
export function initYearCard({ afterFill }) {
    _afterFill = afterFill;
    const el = document.getElementById('ytdYearSoFar');
    el?.addEventListener('click', (e) => {
        const btn = /** @type {HTMLButtonElement|null} */ (/** @type {Element} */ (e.target).closest('#fillYearBtn'));
        if (btn && !_filling) _runFill(btn);
    });
}

/**
 * Render the block — `_renderYearSoFar` moved verbatim from paycalc-app.js (v22.06), plus the
 * fill control and the from-zero state.
 * @param {{ ty: any, plan: string, pgLoan: boolean, slPaidOffFromP: number,
 *   bpLump: {pNum: number, amount: number}|null }} args
 */
export function renderYearCard({ ty, plan, pgLoan, slPaidOffFromP, bpLump }) {
    const el = document.getElementById('ytdYearSoFar');
    if (!el) return;
    _lastArgs = { ty, plan, pgLoan, slPaidOffFromP, bpLump };
    const taxCode = (/** @type {HTMLInputElement} */ (document.getElementById('taxCode'))?.value || '1257L');
    // The HPP landing INSIDE this tax year is the PRIOR year's premium — a year's HPP is paid the
    // January AFTER it ends — so read the flags for THAT year, not the viewed one (v18.84: reading
    // hppIncKey(ty) asked the viewed year, whose own premium isn't paid until a year later, so the
    // tick came off the wrong year and the lump never joined these totals). Same single source as
    // the result card's _hppTy, asked from the other direction.
    const _ysHpp = hppPaidInTaxYear(ty, getPeriods(), CONFIG.TAX_YEARS);
    const _ysHppTy = _ysHpp ? _ysHpp.taxYear : null;
    const _ysHppIncluded = !!_ysHppTy && lsGet(hppIncKey(_ysHppTy)) === '1';
    const _ysHppAmount = _ysHppIncluded
        ? resolveHppForPeriod(lsGet(hppActualKey(_ysHppTy)), lsGet(hppEstKey(_ysHppTy))).amount : 0;
    const hppLump = (_ysHppIncluded && _ysHppAmount > 0) ? { amount: _ysHppAmount } : null;
    const y = computeYearSoFar(ty, { taxCode, plan, pgLoan, slPaidOffFromP, bpLump, hppLump });

    const fillControl = y.missing.length
        ? `<div class="yearso-fill"><button type="button" id="fillYearBtn" class="btn-action btn-secondary">`
          + `<span aria-hidden="true">📅</span> Fill these from your calendar</button></div>`
        : '';
    const receiptHtml = (_receipt && _receipt.tyLabel === ty.label)
        ? `<div class="yearso-receipt" role="status">${_receipt.lines.map(l => `<div>${l}</div>`).join('')}</div>`
        : '';

    // FROM-ZERO: nothing entered, nothing corrupt — but paid periods are waiting. The old
    // early-return hid the block (right as a quiet default, wrong once it hides the one control
    // that fixes the emptiness). A slim variant renders instead of the totals.
    if (!y.entered && !y.skipped) {
        if (!y.missing.length && !receiptHtml) { el.hidden = true; el.innerHTML = ''; return; }
        el.hidden = false;
        el.innerHTML =
            `<div class="yearso-head">This tax year so far <span class="yearso-count">0 of ${y.paid} paid payslip${y.paid !== 1 ? 's' : ''} entered</span></div>` +
            (y.missing.length ? `<div class="yearso-proj">Not entered yet: ${fdList(y.missing)}.</div>` : '') +
            fillControl + receiptHtml;
        return;
    }
    el.hidden = false;
    const row = /** @param {string} lbl @param {number} val */ (lbl, val) =>
        `<div class="yearso-row"><span class="lbl">${lbl}</span><span class="val">≈ ${fmt(val)}</span></div>`;
    el.innerHTML =
        `<div class="yearso-head">This tax year so far <span class="yearso-count">${y.entered} of ${y.paid} paid payslip${y.paid !== 1 ? 's' : ''} entered</span></div>` +
        row('Taxable pay', y.taxable) + row('Tax', y.tax) + row('National Insurance', y.ni) +
        (y.sl > 0 ? row('Student Loan', y.sl) : '') +
        row('Take-home', y.net) +
        // Paid-but-empty payslips are NAMED (v18.42 — review item 2) so "N of M" is actionable.
        (y.missing.length ? `<div class="yearso-proj">Not entered yet: ${fdList(y.missing)}.</div>` : '') +
        fillControl +
        // The projection is deliberately labelled rough — it assumes the rest of the year looks
        // like the entered payslips (premiums vary period to period).
        `<div class="yearso-proj">If the rest of ${ty.label} looks similar: take-home ≈ <strong>${fmt(y.projectedNet)}</strong> for the year (rough — based on your entered payslips).</div>` +
        (y.skipped ? `<div class="yearso-proj pay-skip-warn">⚠️ Couldn't read ${y.skipped} saved payslip${y.skipped > 1 ? 's' : ''}, so these totals may be too low.</div>` : '') +
        receiptHtml;
}

/** @param {HTMLButtonElement} btn */
async function _runFill(btn) {
    const member = getLoggedMember();
    const ty = _lastArgs?.ty;
    if (!member || !ty) return;
    _filling = true;
    btn.disabled = true;
    btn.textContent = 'Filling from your calendar…';
    try {
        const receipt = await fillYearFromCalendar({
            periods: periodsInTaxYear(ty, getPeriods()), member, now: new Date(),
            deps: {
                proRateFactor: getProRateFactor,
                readSaved: readSavedPeriod,
                fetchOverrides: (p, name) => fetchOverridesForPeriod(p, name),
                suggest: (p) => getRosterSuggestion(p, member),
                // Verified, not fire-and-forget (v22.13): `lsSet` swallows a storage failure, so
                // an unverified bulk write can report "Filled 5" having saved three. BOTH halves
                // must land — a period whose hours saved but whose gold roster snapshot did not
                // would show as hand-entered, which is rule 4 lost at the last step.
                // FAILURE-ATOMIC (v22.19, external review). `a && b` reported the right answer and
                // left the wrong state: if the period saved and the snapshot did not, the receipt
                // correctly said "not filled" while the period HAD changed — and it now holds
                // Calendar hours with no gold snapshot, so it reads as hand-entered, which is
                // rule 4 lost at the last step AND makes it ineligible for the retry the message
                // invites. So the period write is rolled back to whatever was there before.
                write: (pNum, data, snap) => lsSetBothVerified(
                    periodKey(pNum), JSON.stringify(data),
                    snapKey(pNum),   JSON.stringify(snap)),
            },
        });
        // The loop leaves the suggestion module's override map on the LAST period it fetched —
        // put the ON-SCREEN period's back before anything repaints from it.
        const cur = getPeriods().find((/** @type {any} */ x) => x.num === currentPeriodNum());
        if (cur && member.name) { try { await fetchOverridesForPeriod(cur, member.name); } catch { /* hint bar shows base-only */ } }
        _receipt = { tyLabel: ty.label, lines: fillYearReceipt(receipt, fdShort) };
        _afterFill?.(receipt);   // coordinator reloads the visible form if filled, then recalculates
        updateRosterHint();
    } finally {
        _filling = false;        // the re-render replaced the button; this guards the no-render error path
    }
}
