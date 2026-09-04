// @ts-check
/**
 * paycalc-result-headline.js — WHICH figure is the headline, and what it is called.
 *
 * Owns: the result card's headline label and figure, the summary rows when a confirmed payslip is
 *   on screen, the breakdown button's label, and the sticky bar's amount, label and accessible name.
 * Does NOT own: any calculation (paycalc-calc.js), the breakdown rows (paycalc-breakdown.js), or
 *   the sticky bar's show/hide behaviour (paycalc-sticky-total.js).
 * Edit here for: the words beside the money. Do not edit here for: the money.
 *
 * ── WHY THIS IS ITS OWN MODULE ──────────────────────────────────────────────────────────────────
 *
 * Extracted from `calculate()` in paycalc-app.js at v22.56, and not for line count. It is TWO
 * PARALLEL BRANCHES — a confirmed payslip figure, or the calculator's estimate — WRITING THE SAME
 * SIX DOM TARGETS. That shape has exactly one failure mode and it is silent: a target written on
 * one path and not the other keeps whatever the previous render left there, so the screen shows one
 * branch's number under the other branch's label. Nothing throws. The figure looks right.
 *
 * **The invariant: the headline figure and the words beside it must always agree.** An actual is
 * never called an estimate and an estimate is never called an actual — they differ by real money,
 * and the whole reason the actuals overlay exists is to compare the two.
 *
 * The repo has already paid for that rule twice, both times in the sticky bar rather than the card:
 * v18.14 added the payday to the sticky label because a scrolled-away £ did not say WHICH payslip
 * it belonged to (the back-pay lump lands on exactly one), and v18.15 split it into two weights
 * because one flat muted string read as noise. Both fixes had to be made in both branches by hand.
 *
 * `headlineLabels` is PURE and holds every word, so the agreement is testable without a DOM; the
 * renderer below is the part that touches the page, and its own contract is that it writes every
 * target on both paths. Tested by paycalc-result-headline.test.mjs.
 *
 * ── THE ACTUALS PATH IS DEVELOPER-ONLY, AND STAYS THAT WAY ──────────────────────────────────────
 *
 * `actual` is non-null only for a device that has imported payslip figures into localStorage, for
 * the one member gated by `isActualsDev`. The data is never served and never leaves the device
 * (ARCHITECTURE_PLAN.md → MILLER_ACTUALS). This module takes the resolved value as an argument and
 * makes no decision about who may see it — the gate stays with the caller, where the identity is.
 */

import { fmt, fdShort } from './paycalc-format.js';
import { setStatus } from './status-text.js';

/**
 * The words, with no DOM and no money maths. One object per render, so a test can hold both
 * branches side by side and assert they cannot be confused for one another.
 *
 * @param {object} s
 * @param {boolean} s.hasActual        a confirmed payslip figure is on screen
 * @param {Date|null} s.payday         the period's payday, or null when no period is selected
 * @param {number} s.bpThisPeriod      back-pay lump included in the estimate (0 = none)
 * @param {number} s.hppForPeriod      holiday pay premium included in the estimate (0 = none)
 * @param {boolean} s.bpIsEstimate     the back-pay figure is not yet confirmed
 * @param {boolean} s.hppIsEstimate    the HPP figure is not yet confirmed
 * @returns {{ netLabel: string, stickyLabelHtml: string, stickyAria: string, bdBtnHtml: string }}
 */
export function headlineLabels({ hasActual, payday, bpThisPeriod = 0, hppForPeriod = 0,
                                 bpIsEstimate = false, hppIsEstimate = false }) {
    const when = payday ? fdShort(payday) : null;
    // The accessible name says the same thing as the visible label. It is built from the same
    // branch deliberately: a screen-reader user and a sighted user must not be told different
    // things about whether the number in front of them is confirmed.
    const forPayslip = when ? ` for the ${when} payslip` : '';

    if (hasActual) {
        return {
            netLabel: '✅ Your Actual Take-Home Pay',
            // Two weights (v18.15): the payday is the load-bearing half, so it renders full-white
            // semibold while the descriptor stays muted. App-built markup, no user content.
            stickyLabelHtml: when
                ? `✅ <span class="s-pay">Paid ${when}</span><span class="s-desc"> · Actual take-home</span>`
                : '<span class="s-desc">✅ Actual take-home</span>',
            stickyAria: `Actual take-home${forPayslip} — tap to view the full breakdown`,
            // The button changes JOB, not just wording: with an actual on screen the panel below is
            // a comparison against the estimate rather than a breakdown of the figure above.
            bdBtnHtml: 'Compare with estimate &nbsp;<span class="bd-arrow">▼</span>',
        };
    }

    // What the estimate INCLUDES, when it includes something a member would otherwise not expect.
    // Only on the card: the sticky strip stays compact, and it is the payslip identity that has to
    // survive scrolling, not the composition.
    const suffix = bpThisPeriod > 0 && hppForPeriod > 0
        ? `inc. ${bpIsEstimate ? 'est. ' : ''}back pay & HPP`
        : bpThisPeriod > 0 ? `inc. ${bpIsEstimate ? 'est. ' : ''}back pay`
        : hppForPeriod > 0 ? `inc. HPP${hppIsEstimate ? ' estimate' : ''}`
        : null;

    return {
        netLabel: suffix ? `💷 Estimated Take-Home Pay (${suffix})` : '💷 Estimated Take-Home Pay',
        stickyLabelHtml: when
            ? `💷 <span class="s-pay">Paid ${when}</span><span class="s-desc"> · Estimated take-home</span>`
            : `<span class="s-desc">💷 ${suffix ? `Estimated take-home (${suffix})` : 'Estimated take-home'}</span>`,
        stickyAria: `Estimated take-home${forPayslip} — tap to view the full breakdown`,
        bdBtnHtml: 'Full pay breakdown &nbsp;<span class="bd-arrow">▼</span>',
    };
}

/** The summary rows shown ONLY when a confirmed payslip is on screen — actual figures, with the
 *  calculator's own estimate beneath as the comparison the overlay exists to make. */
function actualSummaryHtml(/** @type {any} */ actual, /** @type {number} */ estimateNet) {
    return `
          <div class="sum-row sum-gross"><span class="lbl">Total pay</span><span class="val">${fmt(actual.gross)}</span></div>
          <div class="sum-row sum-ded"><span class="lbl">Income Tax</span><span class="val">−${fmt(actual.tax)}</span></div>
          <div class="sum-row sum-ded"><span class="lbl">National Insurance</span><span class="val">−${fmt(actual.ni)}</span></div>
          ${actual.sl > 0 ? `<div class="sum-row sum-ded"><span class="lbl">Student Loan</span><span class="val">−${fmt(actual.sl)}</span></div>` : ''}
          <div class="sum-row sum-net"><span class="lbl">Actual take-home</span><span class="val">${fmt(actual.net)}</span></div>
          <div class="sum-row" style="border-top:1px solid var(--border-light);margin-top:6px;padding-top:6px;font-size:var(--type-small);color:var(--text-faint)">
            <span class="lbl">Calculator estimate</span><span class="val">${fmt(estimateNet)}</span>
          </div>
        `;
}

/**
 * Paint the headline. **Every target is written on both paths** — that is the contract, not a
 * coincidence of the current code: a target left unwritten on one branch keeps the other branch's
 * value from the previous render, which is how a confirmed figure ends up under an estimate's label.
 * The one exception is `#summary`, which the estimate path leaves to the caller because the ordinary
 * summary rows are built by paycalc-breakdown.js; it is named here rather than left to be noticed.
 *
 * @param {object} cfg
 * @param {any} cfg.actual        the device-local payslip record, or null for the estimate path
 * @param {number} cfg.net        the calculator's estimated take-home
 * @param {Date|null} cfg.payday
 * @param {number} [cfg.bpThisPeriod] @param {number} [cfg.hppForPeriod]
 * @param {boolean} [cfg.bpIsEstimate] @param {boolean} [cfg.hppIsEstimate]
 */
export function renderResultHeadline({ actual, net, payday, bpThisPeriod = 0, hppForPeriod = 0,
                                       bpIsEstimate = false, hppIsEstimate = false }) {
    const L = headlineLabels({ hasActual: !!actual, payday, bpThisPeriod, hppForPeriod,
                               bpIsEstimate, hppIsEstimate });
    const byId = (/** @type {string} */ id) => document.getElementById(id);

    const netLabel = byId('netLabel');
    // setStatus on BOTH paths, which is the ONE behaviour change the v22.56 extraction made rather
    // than preserved, and it is deliberate. Before the move the actual path used `setStatus` and the
    // estimate path a plain `textContent` — an accident of the v21.94 glyph sweep touching one and
    // not the other. Both labels lead with a decorative glyph (✅ / 💷), so both should hide it from
    // the accessibility tree; `#netLabel` is not itself a live region (`#netDisplay` beside it is),
    // so nothing is announced either way and the rendered text is identical — `textContent` still
    // reads back the original string, which is why no existing assertion moved. Two branches doing
    // the same thing two different ways is exactly what this module was extracted to end.
    if (netLabel) setStatus(netLabel, L.netLabel);

    const bdBtn = byId('bdBtn');
    if (bdBtn) bdBtn.innerHTML = L.bdBtnHtml;

    const stickyAmt = byId('stickyAmount');
    if (stickyAmt) stickyAmt.textContent = fmt(actual ? actual.net : net);

    const stickyLbl = byId('stickyLabel');
    if (stickyLbl) stickyLbl.innerHTML = L.stickyLabelHtml;

    const stickyBar = byId('stickyTotal');
    if (stickyBar) stickyBar.setAttribute('aria-label', L.stickyAria);

    if (actual) {
        const netDisplay = byId('netDisplay');
        if (netDisplay) netDisplay.textContent = fmt(actual.net);
        const summary = byId('summary');
        if (summary) summary.innerHTML = actualSummaryHtml(actual, net);
    }
}
