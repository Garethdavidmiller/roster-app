// @ts-check
/**
 * paycalc-money-banner.js — the two opt-in money banners on the result card.
 *
 * Owns: what the back-pay and Holiday Pay Premium banners SAY, the three states each can be in, and
 *   their controls — the opt-in ticks and the "view … card" links, with the HPP card's link to the
 *   back-pay card (`wireBannerTicks`, out of paycalc-app.js on 25 Nov 2026).
 * Does NOT own: the amounts (paycalc-backpay.js / paycalc-hpp.js), or whether the lump is added to the
 *   estimate (`takeHomeInputs`, paycalc-calc.js — the rule the ticks below feed).
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
import { TAX_YEARS } from './paycalc-calc.js';
import { hppIncKey } from './paycalc-migrations.js';
import { lsSet, lsDel } from './ls.js';

/**
 * The back-pay banner's words. `included` is the opt-in tick's own state, and it is what decides
 * between the two sentences — never the availability, which is only whether there is anything to
 * offer.
 *
 * The note says how to sharpen a lump WORKED OUT from hours, so it is empty for one the member typed
 * from the payslip (`fromPayslip`, the card's "Enter the amount from your payslip"): hours change
 * nothing there, and the payslip's own figure has nothing left to sharpen.
 *
 * A confirmed award's lump "will land" only until its payslip arrives (17 Nov 2026). From the
 * payslip's cut-off it may be in the member's hand (`inHand`, paycalc-periods.js → payslipMayBeInHand),
 * and the lump IS on it — a payslip paid in August 2026, or October 2025, still said "will land".
 *
 * @param {object} s
 * @param {number} s.thisPeriod   the lump actually added to this estimate (0 = opted out)
 * @param {number} s.amount       the lump available on this payslip
 * @param {boolean} s.isEstimate  the award is not yet confirmed
 * @param {string} s.aprilYear    the tax year the award backdates to, e.g. "2026"
 * @param {boolean} [s.fromPayslip]  the lump was typed from the payslip rather than worked out
 * @param {boolean} [s.inHand]    this payslip may already be in the member's hand (from its cut-off)
 * @returns {{ text: string, note: string }}
 */
export function backPayBannerCopy({ thisPeriod, amount, isEstimate, aprilYear, fromPayslip = false, inHand = false }) {
    return {
        text: thisPeriod > 0
            ? `✓ Includes ${isEstimate ? 'estimated ' : ''}back pay lump sum of ${fmt(thisPeriod)}`
            // A CONFIRMED award definitely lands ("will", and "is on" once its payslip arrives); an
            // unconfirmed one stays hedged ("could"). Either way it is opt-in, so every sentence ends
            // by saying it is not added.
            : isEstimate
                ? `ℹ️ Estimated back pay lump sum of ${fmt(amount)} could land on this payslip — not added to this estimate`
                : `ℹ️ Your back pay lump sum of ${fmt(amount)} ${inHand ? 'is on' : 'will land on'} this payslip — not added to this estimate`,
        note: fromPayslip ? '' : `For the best estimate, fill in your hours on each payslip back to 1 April ${aprilYear}.`,
    };
}

/**
 * The HPP banner's words. Same two sentences, and one difference that is deliberate: the note
 * appears ONLY when the member has opted in to a figure that is still an estimate, because that is
 * the only state where there is something for them to do when the payslip arrives.
 *
 * A CONFIRMED premium is never hedged. It is the figure the member copied off this very payslip
 * (the HPP card's box asks for the Holiday Pay Premium line on the January payslip, and this banner
 * shows only on that payslip), so it IS on this payslip — "could land" undersold a fact the member
 * had just read, where back pay's confirmed award says it "will land", and "is on" once in hand.
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
            : isEstimate
                ? `ℹ️ Estimated Holiday Pay Premium of ${fmt(amount)} could land on this payslip — not added to this estimate`
                : `ℹ️ Your Holiday Pay Premium of ${fmt(amount)} is on this payslip — not added to this estimate`,
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

/**
 * Open a collapsed card and bring it into view — through its header's own click, so initCardCollapse
 * keeps aria-expanded in step and runs whatever the card does on opening (the back-pay card's
 * pre-fill). An open card is only scrolled to.
 * @param {string} cardId @param {string} bodyId @param {string} toggleId
 */
function viewCard(cardId, bodyId, toggleId) {
    if (!document.getElementById(bodyId)?.classList.contains('open')) {
        /** @type {HTMLElement|null} */ (document.getElementById(toggleId))?.click();
    }
    document.getElementById(cardId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * Wire the two banners' controls, once, at init: each opt-in tick, each "view … card" link, and the
 * HPP card's "Expecting a pay rise? Calculate back pay →" link, which goes the same way as the banner's.
 *
 * THE HPP TICK targets the tax year stamped on it at paint (`paintBanner`'s `tickYear`, as
 * `data-year`) — the year whose premium lands on the payslip on screen — so this one listener is
 * always about the right year; the flag it sets (`hppIncKey`) is the `premium.included` that
 * `takeHomeInputs` reads. THE BACK-PAY TICK is a proxy for the card's own (hidden) `#bpIncludeTick`,
 * the state-holder: setting that and firing its change reuses the card's whole persist-and-re-price.
 * @param {{ calculate: () => void }} deps  the coordinator's re-price
 */
export function wireBannerTicks({ calculate }) {
    const hppTick = /** @type {HTMLInputElement|null} */ (document.getElementById('hppBannerTick'));
    hppTick?.addEventListener('change', () => {
        const ty = TAX_YEARS.find(t => t.label === hppTick.dataset.year);
        if (!ty) return;
        if (hppTick.checked) lsSet(hppIncKey(ty), '1'); else lsDel(hppIncKey(ty));
        calculate();
    });
    const bpTick = /** @type {HTMLInputElement|null} */ (document.getElementById('bpBannerTick'));
    bpTick?.addEventListener('change', () => {
        const dst = /** @type {HTMLInputElement|null} */ (document.getElementById('bpIncludeTick'));
        if (!dst) return;
        dst.checked = bpTick.checked;
        dst.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const toBackPay = () => viewCard('backPayCard', 'backPayBody', 'backPayCardToggle');
    document.getElementById('bpBannerViewLink')?.addEventListener('click', toBackPay);
    document.getElementById('hppBackPayLink')?.addEventListener('click', toBackPay);
    document.getElementById('hppBannerViewLink')?.addEventListener('click', () => viewCard('hppCard', 'hppCardBody', 'hppCardToggle'));
}
