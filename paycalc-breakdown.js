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
        <div class="sum-row sum-net"><span class="lbl">Estimated take-home pay${_netNote(d) ? `<span class="sum-net-sub">${_netNote(d)}</span>` : ''}</span><span class="val">${fmt(net)}</span></div>
      `;
}

/**
 * The qualifier under the take-home figure when it carries more than the regular period.
 *
 * A SECOND LINE, not a parenthetical, since v20.53. As a suffix it made the app's most-read label
 * ("Estimated take-home pay (inc. estimated back pay & HPP)") wrap to two lines and then, because
 * `.sum-row` is `space-between` with no gap, run straight into the £ figure beside it — reported from
 * a real phone. The fix is two-part and both halves matter: the `gap` in paycalc.css stops ANY long
 * label touching its figure, and this keeps the qualifier off the headline so the row reads as one
 * line plus a note rather than a wrapped sentence with a number embedded in it.
 *
 * It also states BOTH estimate flags. The old nested ternary took `_bpIsEstimate` for the combined
 * case, so an estimated HPP alongside a confirmed back pay was silently described as confirmed.
 *
 * @param {{ _bpThisPeriod:number, _hppForPeriod:number, _bpIsEstimate:boolean, _hppIsEstimate:boolean }} d
 * @returns {string} '' when the figure is just the period's own pay
 */
function _netNote({ _bpThisPeriod, _hppForPeriod, _bpIsEstimate, _hppIsEstimate }) {
    const parts = [];
    if (_bpThisPeriod > 0) parts.push(`${_bpIsEstimate  ? 'estimated ' : ''}back pay`);
    if (_hppForPeriod > 0) parts.push(`${_hppIsEstimate ? 'estimated ' : ''}HPP`);
    return parts.length ? `includes ${parts.join(' & ')}` : '';
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
 *   larger → check hours / absence / back pay / payroll corrections / a student loan that was
 *            NOT deducted on that payslip (the documented
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
    // The ✓ is wrapped because this lands in `#actualVerdict`, which is `aria-live="polite"`
    // (v21.94). A pure builder returning markup is a shape `status-glyph-parity` cannot see —
    // it has no assignment target to attribute — so this one is kept right by hand.
    if (ad < 0.005)
        return `<div class="check-actual-line check-ok"><span aria-hidden="true">✓</span> Matches your payslip exactly.</div>`;
    if (ad <= 2)
        return `<div class="check-actual-line check-ok"><span aria-hidden="true">✓</span> Matches your payslip to within ${fmt(ad)} — the expected rounding from payroll's cumulative tax method.</div>`;
    const dir = diff > 0 ? 'more' : 'less';
    if (ad <= 25)
        return `<div class="check-actual-line check-near">Close — your payslip pays ${fmt(ad)} ${dir} than this estimate. Small gaps usually come from tax adjustments; entering your Year to Date figures sharpens the next estimate.</div>`;
    return `<div class="check-actual-line check-near">Your payslip pays ${fmt(ad)} ${dir} than this estimate. Check this payslip's hours are complete, and look for absence, back pay, a payroll correction, or a student loan deduction that isn't on the payslip.</div>`;
}

/**
 * The estimate-vs-payslip comparison table (v22.07) — the four other payslip lines beside the
 * long-standing net check. One row per line the member has actually typed; a line left blank
 * renders nothing, because an absent figure is not a £0 claim.
 *
 * THE DIFFERENCE STATES ITSELF AND EXPLAINS NOTHING. A row says the payslip's tax is £1.40 more
 * — it never guesses why, because a confident wrong cause is worse than an honest gap. The one
 * place causes are (carefully) discussed stays the net verdict line, which has owned that wording
 * since v18.42.
 *
 * @param {{ actual: {gross: number|null, pension: number|null, tax: number|null,
 *   ni: number|null, net: number|null},
 *   estimate: {gross: number, pension: number, tax: number, ni: number, net: number} }} d
 * @returns {string} '' when no line beyond net is entered
 */
export function buildActualComparison({ actual, estimate }) {
    const LINES = /** @type {const} */ ([
        ['gross',   'Total pay'],
        ['pension', 'Pension contribution'],
        ['tax',     'Income Tax'],
        ['ni',      'National Insurance'],
        ['net',     'Take-home'],
    ]);
    // Only worth a TABLE when something beyond the net was typed — net alone already has its
    // verdict line, and a one-row table under it would say the same thing twice.
    const beyondNet = LINES.some(([k]) => k !== 'net' && actual[k] != null);
    if (!beyondNet) return '';
    const rows = LINES.filter(([k]) => actual[k] != null).map(([k, lbl]) => {
        const a = /** @type {number} */ (actual[k]);
        const e = estimate[k];
        const d = a - e;
        const cls = Math.abs(d) < 0.005 ? 'cmp-same' : 'cmp-diff';
        const dTxt = Math.abs(d) < 0.005 ? '—' : `${d > 0 ? '+' : '−'}${fmt(Math.abs(d))}`;
        return `<tr><th scope="row">${lbl}</th><td>${fmt(e)}</td><td>${fmt(a)}</td><td class="${cls}">${dTxt}</td></tr>`;
    }).join('');
    return `<table class="actual-cmp"><caption class="sr-only">Estimate compared with your payslip</caption>
        <thead><tr><th scope="col"></th><th scope="col">Estimate</th><th scope="col">Payslip</th><th scope="col">Difference</th></tr></thead>
        <tbody>${rows}</tbody></table>`;
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
