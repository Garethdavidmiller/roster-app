// @ts-check
/**
 * paycalc-breakdown.js — the two pure HTML builders for the pay-result card, extracted from
 * `calculate()` in paycalc-app.js (review item 20). `calculate()` used to interleave DOM reads,
 * pay maths, AND result-markup string-building in one long function; the markup is now written +
 * unit-testable here, independent of the DOM/calc phases. Each builder takes a plain params object
 * (field names match the caller's locals, so the call site is a shorthand object literal) and
 * returns an HTML string; the coordinator assigns the result to the relevant element. Pure: no DOM,
 * no Firebase. The ONLY dependency is `fmt` (the shared GBP formatter).
 *
 * The template bodies are byte-for-byte the same markup calculate() produced — do not restyle here;
 * this was a mechanical extraction to gain testability, not a redesign of the breakdown.
 */

import { fmt } from './paycalc-format.js';

/**
 * Decimal hours → "Nh Mm" / "Nh" — the per-row hours label in the full breakdown. Pure.
 * @param {number} h decimal hours
 * @returns {string}
 */
export function fmtHrsMins(h) {
    const hh = Math.floor(h), mm = Math.round((h - hh) * 60);
    return mm > 0 ? `${hh}h ${mm}m` : `${hh}h`;
}

/**
 * Build the estimate summary rows (#summary): Regular/Total pay → back pay → HPP → pension →
 * tax → NI → Student Loan → estimated take-home. `slLines` is pre-rendered SL markup passed in.
 * @param {{
 *   _bpThisPeriod:number, _hppForPeriod:number, gross:number, grossWithBp:number,
 *   _bpIsEstimate:boolean, _hppIsEstimate:boolean, pension:number, sacGross:number,
 *   usingCumulative:boolean, tax:number, ni:number, slLines:string, net:number
 * }} d
 * @returns {string} innerHTML for #summary
 */
export function buildSummaryRows(d) {
    const {
        _bpThisPeriod, _hppForPeriod, gross, grossWithBp, _bpIsEstimate, _hppIsEstimate,
        pension, sacGross, usingCumulative, tax, ni, slLines, net,
    } = d;
    return `
        ${(_bpThisPeriod > 0 || _hppForPeriod > 0)
          ? `<div class="sum-row"><span class="lbl">Regular pay</span><span class="val">${fmt(gross)}</span></div>
             ${_bpThisPeriod > 0 ? `<div class="sum-row sum-bp"><span class="lbl">Back pay lump sum (pay award${_bpIsEstimate ? ' — estimate' : ''})</span><span class="val">+${fmt(_bpThisPeriod)}</span></div>` : ''}
             ${_hppForPeriod > 0 ? `<div class="sum-row sum-hpp"><span class="lbl">Holiday Pay Premium${_hppIsEstimate ? ' <span class="sum-est">(estimated)</span>' : ''}</span><span class="val">+${fmt(_hppForPeriod)}</span></div>` : ''}
             <div class="sum-row sum-gross"><span class="lbl">Total pay</span><span class="val">${fmt(grossWithBp)}</span></div>`
          : `<div class="sum-row sum-gross"><span class="lbl">Total pay</span><span class="val">${fmt(gross)}</span></div>`}
        ${pension > 0 ? `<div class="sum-row sum-ded"><span class="lbl">Pension contribution</span><span class="val">−${fmt(pension)}</span></div>` : ''}
        ${pension > 0 ? `<div class="sum-row sum-gross"><span class="lbl">Pay after pension deduction</span><span class="val">${fmt(sacGross)}</span></div>` : ''}
        <div class="sum-row sum-ded"><span class="lbl">Income Tax${usingCumulative ? ' <span style="font-size:var(--type-micro);font-weight:400;color:var(--text-faint);margin-left:4px">adjusted from payslip</span>' : ''}</span><span class="val">−${fmt(tax)}</span></div>
        <div class="sum-row sum-ded"><span class="lbl">National Insurance</span><span class="val">−${fmt(ni)}</span></div>
        ${slLines}
        <div class="sum-row sum-net"><span class="lbl">Estimated take-home pay${_bpThisPeriod > 0 && _hppForPeriod > 0 ? ` (inc. ${_bpIsEstimate ? 'estimated ' : ''}back pay & HPP)` : _bpThisPeriod > 0 ? ` (inc. ${_bpIsEstimate ? 'estimated ' : ''}back pay)` : _hppForPeriod > 0 ? ` (inc. ${_hppIsEstimate ? 'estimated ' : ''}HPP)` : ''}</span><span class="val">${fmt(net)}</span></div>
      `;
}

/**
 * Build the full pay-breakdown rows (written into #bdRows inside #bdBody): one row per pay component present. Only components
 * with hours/amount > 0 render (matching calculate()'s per-line guards).
 * @param {{
 *   nonBhNorm:number, rate:number, gBasicNorm:number, satCapped:number, r125:number,
 *   gBasicSat:number, bhCapped:number, gBankHol:number, bhOtHrs:number, gBhOt:number,
 *   oHrs:number, gOvertime:number, rHrs:number, gRdw:number, sHrs:number, r150:number,
 *   gSunday:number, bHrs:number, r300:number, gBoxing:number, peer:number, gPeer:number,
 *   LONDON:number, otherAdj:number, slSkip:boolean, slPaidOff?:boolean, plan:string,
 *   pgLoan:boolean, usingCumulative:boolean, _bpThisPeriod:number, _bpIsEstimate:boolean,
 *   _hppForPeriod:number, _hppIsEstimate:boolean
 * }} d
 * @returns {string} innerHTML for #bdRows (the static pension/absence notes are siblings in #bdBody)
 */
export function buildBreakdownRows(d) {
    const {
        nonBhNorm, rate, gBasicNorm, satCapped, r125, gBasicSat, bhCapped, gBankHol,
        bhOtHrs, gBhOt, oHrs, gOvertime, rHrs, gRdw, sHrs, r150, gSunday, bHrs, r300, gBoxing,
        peer, gPeer, LONDON, otherAdj, slSkip, slPaidOff = false, plan, pgLoan, usingCumulative,
        _bpThisPeriod, _bpIsEstimate, _hppForPeriod, _hppIsEstimate,
    } = d;
    const fh = fmtHrsMins;
    let bd = '';
    bd += `<div class="bd-row"><span class="b-lbl">Basic pay — Mon–Fri (${fh(nonBhNorm)} × ${fmt(rate)})</span><span class="b-val">${fmt(gBasicNorm)}</span></div>`;
    if (satCapped > 0)
        bd += `<div class="bd-row"><span class="b-lbl">Basic pay — Saturday (${fh(satCapped)} × ${fmt(r125)})</span><span class="b-val">${fmt(gBasicSat)}</span></div>`;
    if (bhCapped > 0)
        bd += `<div class="bd-row"><span class="b-lbl">Bank Holiday Rostered (${fh(bhCapped)} × ${fmt(r125)})</span><span class="b-val">${fmt(gBankHol)}</span></div>`;
    if (bhOtHrs > 0)
        bd += `<div class="bd-row"><span class="b-lbl">Bank Holiday Overtime (${fh(bhOtHrs)} × ${fmt(r125)})</span><span class="b-val">${fmt(gBhOt)}</span></div>`;
    if (oHrs > 0)
        bd += `<div class="bd-row"><span class="b-lbl">Overtime (${fh(oHrs)} × ${fmt(r125)})</span><span class="b-val">${fmt(gOvertime)}</span></div>`;
    if (rHrs > 0)
        bd += `<div class="bd-row"><span class="b-lbl">Rest Day Working (${fh(rHrs)} × ${fmt(r125)})</span><span class="b-val">${fmt(gRdw)}</span></div>`;
    if (sHrs > 0)
        bd += `<div class="bd-row"><span class="b-lbl">Sunday Working (${fh(sHrs)} × ${fmt(r150)})</span><span class="b-val">${fmt(gSunday)}</span></div>`;
    if (bHrs > 0)
        bd += `<div class="bd-row"><span class="b-lbl">Boxing Day Working (${fh(bHrs)} × ${fmt(r300)})</span><span class="b-val">${fmt(gBoxing)}</span></div>`;
    if (peer > 0)
        bd += `<div class="bd-row"><span class="b-lbl">Training Days (${peer} day${peer>1?'s':''} × 2h × ${fmt(rate)})</span><span class="b-val">${fmt(gPeer)}</span></div>`;
    bd += `<div class="bd-row"><span class="b-lbl">London Allowance</span><span class="b-val">${fmt(LONDON)}</span></div>`;
    if (otherAdj !== 0)
        bd += `<div class="bd-row"><span class="b-lbl">Other payroll adjustment</span><span class="b-val">${otherAdj >= 0 ? '+' : ''}${fmt(otherAdj)}</span></div>`;
    // The repaid cutover outranks the one-off skip (mirrors the summary-row precedence).
    if (slPaidOff && (plan !== 'none' || pgLoan))
        bd += `<div class="bd-row"><span class="b-lbl" style="font-style:italic;color:var(--text-faint)">Student Loan repaid in full — no deduction from this payslip onwards</span><span class="b-val"></span></div>`;
    else if (slSkip && (plan !== 'none' || pgLoan))
        bd += `<div class="bd-row"><span class="b-lbl" style="font-style:italic;color:var(--text-faint)">Student Loan not deducted this period</span><span class="b-val"></span></div>`;
    if (usingCumulative)
        bd += `<div class="bd-row"><span class="b-lbl" style="font-style:italic;color:var(--text-faint)">Tax adjusted using Year to Date figures from your last payslip</span><span class="b-val"></span></div>`;
    if (_bpThisPeriod > 0)
        bd += `<div class="bd-row bd-extra"><span class="b-lbl">Back pay lump sum (pay award${_bpIsEstimate ? ' — estimate' : ''})</span><span class="b-val">+${fmt(_bpThisPeriod)}</span></div>`;
    if (_hppForPeriod > 0)
        bd += `<div class="bd-row bd-extra"><span class="b-lbl">Holiday Pay Premium${_hppIsEstimate ? ' (estimated)' : ''}</span><span class="b-val">+${fmt(_hppForPeriod)}</span></div>`;
    return bd;
}

/**
 * The "check against your payslip" verdict line (v18.42 — review item 3): the member types the
 * take-home printed on a PAID payslip and this states, calmly, how close the estimate is —
 * self-serve trust in the maths, and a way to catch their own entry mistakes. Pure; returns ''
 * with no figure entered (quiet default).
 *
 * Bands (|actual − estimated|):
 *   < 1p   → exact match
 *   ≤ £2   → within the expected cumulative-PAYE rounding (the payslip-regression tolerance —
 *            payroll computes tax cumulatively, the estimate per period)
 *   ≤ £25  → close; usually a tax adjustment — pointing at the Year to Date card
 *   larger → check hours / absence / back pay / payroll corrections (the documented
 *            less-accurate cases from the result card's own caveat)
 *
 * @param {number} actual    take-home printed on the payslip (0/absent → '')
 * @param {number} estimated the app's take-home for the same payslip
 * @returns {string}
 */
export function buildActualCheck(actual, estimated) {
    if (!(actual > 0)) return '';
    const diff = actual - estimated;
    const ad   = Math.abs(diff);
    if (ad < 0.005)
        return `<div class="check-actual-line check-ok">✓ Matches your payslip exactly.</div>`;
    if (ad <= 2)
        return `<div class="check-actual-line check-ok">✓ Matches your payslip to within ${fmt(ad)} — the expected rounding from payroll's cumulative tax method.</div>`;
    const dir = diff > 0 ? 'more' : 'less';
    if (ad <= 25)
        return `<div class="check-actual-line check-near">Close — your payslip pays ${fmt(ad)} ${dir} than this estimate. Small gaps usually come from tax adjustments; entering your Year to Date figures sharpens the next estimate.</div>`;
    return `<div class="check-actual-line check-near">Your payslip pays ${fmt(ad)} ${dir} than this estimate. Check this payslip's hours are complete, and look for absence, back pay or a payroll correction on it.</div>`;
}

/**
 * The provenance chips under the take-home £ (v18.44 — review item 1): quiet labels naming what
 * fed THIS number, rendered on the navy hero. A normal payslip renders NOTHING (empty string —
 * the row costs no space); a chip appears only when something noteworthy is inside the figure:
 *   - cumulative tax engaged (the YTD card is sharpening this payslip — names the source payslip)
 *   - the back-pay lump is ticked in (gold — money added)
 *   - the January HPP add is ticked in (gold — money added)
 *   - some hours came from the calendar pre-fill rather than typing
 * Pure; `srcLabel` is app-generated (a formatted payday), no user text.
 *
 * @param {{ usingCumulative: boolean, srcLabel?: string, bpAmount?: number, hppAmount?: number,
 *           hoursFromCalendar?: boolean }} d
 * @returns {string} innerHTML for #provChips ('' = no chips)
 */
export function buildProvChips(d) {
    let h = '';
    if (d.usingCumulative)
        h += `<span class="prov-chip">✓ Cumulative tax${d.srcLabel ? ` · from your ${d.srcLabel} payslip` : ''}</span>`;
    if (d.bpAmount && d.bpAmount > 0)
        h += `<span class="prov-chip prov-chip--add">+ ${fmt(d.bpAmount)} back pay</span>`;
    if (d.hppAmount && d.hppAmount > 0)
        h += `<span class="prov-chip prov-chip--add">+ ${fmt(d.hppAmount)} Holiday Pay Premium</span>`;
    if (d.hoursFromCalendar)
        h += `<span class="prov-chip"><span aria-hidden="true">📅</span> Hours from calendar</span>`;
    return h;
}
