// @ts-check
/**
 * paycalc-money-banner.js — the two opt-in money banners on the result card.
 *
 * Owns: what the back-pay and Holiday Pay Premium banners SAY, and the three states each can be in.
 * Does NOT own: the amounts (paycalc-backpay.js / paycalc-hpp.js), the tick's change handlers
 *   (wired once in paycalc-app.js), or whether the lump is added to the estimate.
 *
 * ── WHY ONE MODULE FOR TWO BANNERS ──────────────────────────────────────────────────────────────
 *
 * They are the same shape twice, and were maintained as two hand-kept copies inside `calculate()`
 * until v22.56. Each has THREE states — the sum is included · the sum is available and NOT included
 * · there is nothing to say — and each pairs a sentence with an opt-in tick.
 *
 * **The invariant: a banner may only say "Includes" when the sum is actually in the figure above
 * it.** Those two states differ by hundreds of pounds and the difference is invisible — the estimate
 * looks equally plausible either way, and a member who reads "could land on this payslip" as
 * "is on this payslip" has no way to notice. The word and the tick have to be the same fact.
 *
 * A second rule falls out of the first and is easy to lose in a tidy-up: **a figure that is not yet
 * confirmed says so, on both paths.** Back pay hedges with "Estimated … could land"; HPP with
 * "Estimated Holiday Pay Premium". Dropping the hedge would make an unconfirmed number read as a
 * settled one, which is the same defect wearing different words.
 *
 * The copy builders are PURE, so both banners' wording can be held side by side and asserted not to
 * contradict their own tick. `paintBanner` is the only part that touches the page, and it hides the
 * banner by the same route on both — a banner left visible with stale text is the third way this
 * goes wrong. Tested by paycalc-money-banner.test.mjs.
 */

import { fmt } from './paycalc-format.js';

/**
 * The back-pay banner's words. `included` is the opt-in tick's own state, and it is what decides
 * between the two sentences — never the availability, which is only whether there is anything to
 * offer.
 *
 * @param {object} s
 * @param {number} s.thisPeriod   the lump actually added to this estimate (0 = opted out)
 * @param {number} s.amount       the lump available on this payslip
 * @param {boolean} s.isEstimate  the award is not yet confirmed
 * @param {string} s.aprilYear    the tax year the award backdates to, e.g. "2026"
 * @returns {{ text: string, note: string }}
 */
export function backPayBannerCopy({ thisPeriod, amount, isEstimate, aprilYear }) {
    return {
        text: thisPeriod > 0
            ? `✓ Includes ${isEstimate ? 'estimated ' : ''}back pay lump sum of ${fmt(thisPeriod)}`
            // A CONFIRMED award definitely lands ("will"); an unconfirmed one stays hedged
            // ("could"). Either way it is opt-in, so both sentences end by saying it is not added.
            : isEstimate
                ? `ℹ️ Estimated back pay lump sum of ${fmt(amount)} could land on this payslip — not added to this estimate`
                : `ℹ️ Your back pay lump sum of ${fmt(amount)} will land on this payslip — not added to this estimate`,
        note: `For the best estimate, fill in your hours on each payslip back to 1 April ${aprilYear}.`,
    };
}

/**
 * The HPP banner's words. Same two sentences, and one difference that is deliberate: the note
 * appears ONLY when the member has opted in to a figure that is still an estimate, because that is
 * the only state where there is something for them to do when the payslip arrives.
 *
 * @param {object} s
 * @param {number} s.forPeriod    the premium actually added to this estimate (0 = opted out)
 * @param {number} s.amount       the premium available on this payslip
 * @param {boolean} s.isEstimate  the premium is computed, not taken from a payslip
 * @returns {{ text: string, note: string }}
 */
export function hppBannerCopy({ forPeriod, amount, isEstimate }) {
    return {
        text: forPeriod > 0
            ? `✓ Includes ${isEstimate ? 'estimated ' : ''}Holiday Pay Premium of ${fmt(amount)}`
            : `ℹ️ ${isEstimate ? 'Estimated' : 'A'} Holiday Pay Premium of ${fmt(amount)} could land on this payslip — not added to this estimate`,
        note: (forPeriod > 0 && isEstimate)
            ? 'When your payslip arrives, enter the confirmed Holiday Pay Premium on the HPP card to replace this estimate.'
            : '',
    };
}

/**
 * Paint one banner, or hide it.
 *
 * `available` is the ONLY thing that decides visibility, and `included` the only thing that decides
 * the wording — keeping them separate is what stops "there is a sum here" from being rendered as
 * "the sum is in your total".
 *
 * @param {object} cfg
 * @param {string} cfg.rootId @param {string} cfg.textId @param {string} cfg.tickId @param {string} cfg.noteId
 * @param {boolean} cfg.available    is there a sum to talk about on this payslip at all
 * @param {boolean} cfg.included     is it in the figure above (the tick's state)
 * @param {{text: string, note: string}} cfg.copy
 * @param {string} [cfg.tickYear]    HPP only — the tax year the once-wired change listener targets
 */
export function paintBanner({ rootId, textId, tickId, noteId, available, included, copy, tickYear }) {
    const root = document.getElementById(rootId);
    if (!root) return;
    if (!available) {
        // Hidden, and nothing else touched. The text is deliberately left as it was: it is not
        // readable, and rewriting it would be one more place for the two to disagree.
        root.style.display = 'none';
        return;
    }
    const text = document.getElementById(textId);
    if (text) text.textContent = copy.text;
    const tick = /** @type {HTMLInputElement|null} */ (document.getElementById(tickId));
    if (tick) {
        tick.checked = included;
        if (tickYear !== undefined) tick.dataset.year = tickYear;
    }
    const note = document.getElementById(noteId);
    if (note) note.textContent = copy.note;
    root.style.display = '';
}
