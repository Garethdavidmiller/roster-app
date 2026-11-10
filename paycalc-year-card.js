// @ts-check
/**
 * paycalc-year-card.js — the "This tax year so far" card (a sidebar card of its own since v22.08,
 * no longer inside the Year to Date card), and the fill-the-year control beside its "Not entered
 * yet" line.
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
import { getRosterSuggestion, fetchOverridesForPeriod, resetOverrides } from './paycalc-roster-suggestions.js';
import { snapKey, updateRosterHint } from './paycalc-roster-hint.js';
import { fillYearFromCalendar, fillYearReceipt, answerWithin, FETCH_TIMEOUT_MS } from './paycalc-fill-year.js';
import { fmt, fdList, fdShort } from './paycalc-format.js';
import { lsGet, lsSetBothVerified } from './ls.js';

/** @type {{ tyLabel: string, lines: string[] }|null} last fill's receipt, shown until the year changes */
let _receipt = null;
/** @type {any} the args of the last render, so the fill handler acts on what is on screen */
let _lastArgs = null;
/** @type {((r: any) => void)|null} */
let _afterFill = null;
let _filling = false;
/** How long any one fetch may hold the fill — the loop's and the re-fetch after it alike. */
let _fetchTimeoutMs = FETCH_TIMEOUT_MS;

/**
 * Wire the card once (delegated — the render replaces the block's children on every calculate).
 * @param {{ afterFill: (r: any) => void, fetchTimeoutMs?: number }} cfg  coordinator hook: reload
 *   the visible form if it was filled, then recalculate (which re-renders this block, receipt
 *   included). `fetchTimeoutMs` is for tests; the page takes the fill's own limit.
 */
export function initYearCard({ afterFill, fetchTimeoutMs }) {
    _afterFill = afterFill;
    _fetchTimeoutMs = fetchTimeoutMs ?? FETCH_TIMEOUT_MS;
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

    // While a fill runs, a recalculation still rebuilds this block — and a fresh, enabled-looking
    // button whose taps `_filling` then ignored read as broken. It keeps saying what it is doing
    // (paycalc-2-8).
    const fillControl = y.missing.length
        ? `<div class="yearso-fill"><button type="button" id="fillYearBtn" class="btn-action btn-secondary"${_filling ? ' disabled' : ''}>`
          + (_filling ? 'Filling from your calendar…' : '<span aria-hidden="true">📅</span> Fill these from your calendar')
          + '</button></div>'
        : '';
    // tabindex="-1": focus can be MOVED to the receipt after a fill (see _restoreFocus), never tabbed to.
    const receiptHtml = (_receipt && _receipt.tyLabel === ty.label)
        ? `<div class="yearso-receipt" role="status" tabindex="-1">${_receipt.lines.map(l => `<div>${l}</div>`).join('')}</div>`
        : '';
    const plural = (/** @type {number} */ n) => (n > 1 ? 's' : '');
    const hadFocus = _focusHeld(el);

    // FROM-ZERO: nothing READABLE entered — but paid periods are waiting. The old early-return hid
    // the block (right as a quiet default, wrong once it hides the one control that fixes the
    // emptiness). A slim variant renders instead of the totals — and a year holding only UNREADABLE
    // payslips lands here too: it rendered four "≈ £0.00" rows and a £0.00 projection, figures about
    // pay nobody could read (paycalc-2-20).
    if (!y.entered) {
        if (!y.missing.length && !receiptHtml && !y.skipped) { el.hidden = true; el.innerHTML = ''; return; }
        el.hidden = false;
        el.innerHTML =
            `<div class="yearso-head">This tax year so far <span class="yearso-count">0 of ${y.paid} paid payslip${y.paid !== 1 ? 's' : ''} entered</span></div>` +
            (y.missing.length ? `<div class="yearso-proj">Not entered yet: ${fdList(y.missing)}.</div>` : '') +
            (y.skipped ? `<div class="yearso-proj pay-skip-warn">⚠️ Couldn't read ${y.skipped} saved payslip${plural(y.skipped)}, so there is nothing to total yet — open ${y.skipped > 1 ? 'those payslips' : 'that payslip'} above and enter the hours again.</div>` : '') +
            fillControl + receiptHtml;
        _restoreFocus(el, hadFocus);
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
        // like the entered payslips (premiums vary period to period). With every payslip of the year
        // entered there is no "rest", and it only repeated the take-home above it (paycalc-2-20).
        (y.entered < y.employed
            ? `<div class="yearso-proj">If the rest of ${ty.label} looks similar: take-home ≈ <strong>${fmt(y.projectedNet)}</strong> for the year (rough — based on your entered payslips).</div>`
            : '') +
        (y.skipped ? `<div class="yearso-proj pay-skip-warn">⚠️ Couldn't read ${y.skipped} saved payslip${plural(y.skipped)}, so these totals may be too low.</div>` : '') +
        receiptHtml;
    _restoreFocus(el, hadFocus);
}

/** Set at the end of a fill whose focus is free (see _focusIsFree), so the render that brings the
 *  receipt focuses it. */
let _focusReceiptNext = false;

/** Was focus inside the block a rebuild is about to replace? @param {any} el */
function _focusInside(el) {
    const a = typeof document !== 'undefined' ? document.activeElement : null;
    return !!(a && el && typeof el.contains === 'function' && el.contains(a));
}

/**
 * Which of the block's controls a rebuild is about to take focus from: the receipt, or another
 * (the button) — or null when focus is outside the block. @param {any} el
 * @returns {'receipt'|'other'|null}
 */
function _focusHeld(el) {
    if (!_focusInside(el)) return null;
    return typeof el.querySelector === 'function' && el.querySelector('.yearso-receipt') === document.activeElement
        ? 'receipt' : 'other';
}

/**
 * May the end of a fill move focus to its receipt? Only when focus has nowhere else to be: on the
 * page body (the button it started on was disabled, or rebuilt away) or still in this block. A member
 * who went on to another field while the fill ran keeps their place.
 */
function _focusIsFree() {
    if (typeof document === 'undefined') return false;
    const a = document.activeElement;
    return !a || a === document.body || _focusInside(document.getElementById('ytdYearSoFar'));
}

/**
 * FOCUS SURVIVES THE REBUILD (paycalc-2-18). The block is rebuilt with innerHTML on every
 * recalculation, and a focused button that leaves the page drops focus to the body — so a keyboard
 * user lost their place on any background recalculation, and after every fill. Focus goes back to
 * the button; at the end of a fill, to the receipt instead — its words are then read out, where a
 * status region inserted already filled is often not announced at all. Not only after a keyboard
 * start: Safari does not focus a tapped button, so a screen reader on an iPhone would be missed.
 * And a receipt that has focus KEEPS it through the rebuilds after the first: a fill is followed
 * by more than one (re-pricing the back-pay lump recalculates, then the coordinator recalculates
 * again), and handing the second one's focus to the button moved it off what was being read.
 * @param {any} el @param {'receipt'|'other'|null} hadFocus  what `_focusHeld` saw before the rebuild
 */
function _restoreFocus(el, hadFocus) {
    const toReceipt = _focusReceiptNext || hadFocus === 'receipt';
    _focusReceiptNext = false;
    if ((!hadFocus && !toReceipt) || typeof el.querySelector !== 'function') return;
    const target = (toReceipt && el.querySelector('.yearso-receipt')) || el.querySelector('#fillYearBtn');
    target?.focus?.();
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
                timeoutMs: _fetchTimeoutMs,
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
        // Invalidate any fetch the loop ABANDONED on its timeout first: resolving late, it would
        // otherwise overwrite the restored map with a different period's changes (and a later Fill
        // would write them into this one). The reset bumps the fetch token, so it returns 'cancelled'.
        resetOverrides(cur && member.name ? 'checking' : 'base-only');
        if (cur && member.name) {
            // Bounded like every fetch in the loop (paycalc-2-14): unbounded, a connection that stopped
            // answering here left the receipt, the coordinator's reload and the button all waiting for
            // ever, with the filled payslips already in storage unannounced. No answer in time is
            // base-only — the badge is the truth — and the reset cancels a late answer.
            let answer = 'base-only';
            try { answer = await answerWithin(fetchOverridesForPeriod(cur, member.name), _fetchTimeoutMs); } catch { /* hint bar shows base-only */ }
            if (answer === 'timeout') resetOverrides('base-only');
        }
        _receipt = { tyLabel: ty.label, lines: fillYearReceipt(receipt, fdShort) };
        _filling = false;        // before the coordinator's re-render, so the button it draws is live
        _focusReceiptNext = _focusIsFree();
        _afterFill?.(receipt);   // coordinator reloads the visible form if filled, then recalculates
        _focusReceiptNext = false;
        updateRosterHint();
    } catch (err) {
        // A CONTROL THAT NEVER COMES BACK (v23.71). Everything above restores this button by being
        // REPLACED — `_afterFill` recalculates, which re-renders the whole block. So the success
        // path needs no restore and the failure path had none: `fillYearFromCalendar` wraps only
        // `fetchOverrides`, so a throw from `suggest`, `readSaved` or `write` rejected straight out
        // of a click handler that returns no promise. Nothing on screen, nothing in the console the
        // member can see, and a permanently disabled button still reading "Filling from your
        // calendar…". The only escape was to change an input and force a recalculate, which nothing
        // tells anyone to do.
        //
        // Re-rendering is the restore AND the message: it rebuilds the block from `_lastArgs`, so
        // the button comes back live and the missing list comes back ACCURATE — which is what the
        // wording leans on. The loop writes period by period, so a throw part-way leaves earlier
        // periods genuinely filled; claiming "nothing was changed" would be false exactly when it
        // matters and would invite a retry against half-written data. Same rule as the range
        // writer's `partialCommit`: a failure may never claim it did not happen.
        console.error('[PayCalc] Fill year failed', err);
        _receipt = { tyLabel: ty.label, lines: ["Couldn't finish filling from your calendar. "
            + 'Any payslips it did fill have been saved; the others are untouched. Try again.'] };
        _filling = false;        // before the re-render, so the button it draws is live
        _focusReceiptNext = _focusIsFree();
        if (_lastArgs) renderYearCard(_lastArgs);
        _focusReceiptNext = false;
    } finally {
        _filling = false;        // the re-render replaced the button; this guards the no-render error path
    }
}
