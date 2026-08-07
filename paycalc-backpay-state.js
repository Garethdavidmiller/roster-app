// @ts-check
/**
 * paycalc-backpay-state.js — which figure ends up in which back-pay box, and which of them the
 * member is allowed to change (extracted from paycalc-backpay.js, v19.93).
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────────────────────────
 *
 * `paycalc-backpay.js` was the ONLY module in the paycalc family with no test file of its own —
 * `-calc`, `-hpp`, `-hpp-schedule`, `-format`, `-breakdown`, `-year-summary`, `-inputs`,
 * `-form-data`, `-transfer` and `-migrations` all have one. Four of its ten exports were untested,
 * including `calcBackPay`, the function that produces the lump-sum figure itself. The per-period
 * accrual was covered (`_accrueBackPayPeriod`, in paycalc-periods.test.mjs); what was not covered
 * was the ASSEMBLY around it — and the assembly is where every one of its recorded defects sits.
 *
 * All five are the same shape: **a money figure ends up wrong, and nothing says so.**
 *
 *   1. The card's state was ephemeral, so "the paid-in period's take-home silently LOST the lump on
 *      reload until the card was reopened — the same period showed different take-home before and
 *      after a refresh."
 *   2. A year switch left the previous year's figures in any box the new year's blob did not
 *      overwrite — "the no-recorded-figure CES 2025/26 old-rate box silently inheriting the 2026/27
 *      rate." A restored blob is only as safe as the CLEAR that precedes it.
 *   3. A saved paid-in that was missing or no longer valid for the year's window left the period at
 *      0, so "the lump would silently drop to £0 with no way to fix it" — on a decided award the
 *      selector is hidden, so there was no control to correct it with.
 *   4. (review F1) The lock decision read the box's CONTENTS, so it fired on the first keystroke of
 *      a recompute and froze a half-typed fragment.
 *   5. (review F2) Locking a box did not WRITE the authoritative figure into it, so a stale restored
 *      or typed value could be frozen behind a padlock and presented as being on record.
 *
 * Every one was fixed by reasoning inline in a 200-line function that interleaves maths, DOM reads,
 * DOM writes and persistence — and every one was fixed by adding a comment, because there was
 * nothing to test through. Two of the five (2 and 4) are round-trip and ordering properties that a
 * comment structurally cannot hold: they are about what happens ACROSS two operations, so only a
 * write→read→write test sees them. Same argument as `paycalc-form-data.js`, and the same stakes.
 *
 * ── WHAT IS AND IS NOT HERE ────────────────────────────────────────────────────────────────────
 *
 * Here: the three decisions, all pure. Which fields make up the saved blob and how a restore must
 * clear before it applies; which of the four rate boxes are ON RECORD and therefore locked; and
 * which period the lump is paid in. Not here: the accrual maths (`_accrueBackPayPeriod`), the
 * rendering, and every DOM read/write — `paycalc-backpay.js` keeps all of that and passes plain
 * values in, so this module needs no `document` and no module mocks.
 */

/**
 * The back-pay card's TEXT fields: DOM id ↔ saved-blob key. ONE declaration, because save, clear and
 * restore each used to walk their own hand-written list.
 *
 * That is defect 2 above in one line. The three lists agreed by hand, and a field present in save
 * and restore but absent from clear does not error, does not warn, and does not look wrong — it just
 * leaves the previous tax year's number sitting in a box the new year had nothing to say about, and
 * the member reconciles a lump against a rate they never entered.
 *
 * `paidIn`, `inc` and `mode` are deliberately NOT here: they are a `<select>`, a checkbox and a radio
 * group, none of which is cleared by writing `''` and each of which has its own restore rule.
 * @type {ReadonlyArray<{id: string, key: string}>}
 */
export const BP_FIELDS = Object.freeze([
    { id: 'bpRisePct',    key: 'pct'    },
    { id: 'oldRate',      key: 'oldR'   },
    { id: 'newRateInput', key: 'newR'   },
    { id: 'oldLondon',    key: 'oldL'   },
    { id: 'newLondon',    key: 'newL'   },
    { id: 'bpManualAmt',  key: 'manual' },
]);

/**
 * Read the card's text fields into the saved-blob shape.
 *
 * Values are carried as the RAW STRINGS the boxes hold — never parsed and re-formatted on the way
 * through. A blob is written by one version of the app and read by another, and a round trip that
 * reformats is a round trip that can change a figure the member typed.
 *
 * @param {(id: string) => string} get - reads a field's current value by DOM id
 * @returns {Record<string, string>}
 */
export function readBpFields(get) {
    /** @type {Record<string, string>} */
    const out = {};
    for (const f of BP_FIELDS) out[f.key] = get(f.id) ?? '';
    return out;
}

/**
 * The values to write into the card's text fields for a given saved blob — INCLUDING the empties.
 *
 * This returns an entry for EVERY field, not only the ones the blob carries, and that is the whole
 * point: the caller assigns the lot, so a field the blob is silent about is actively blanked rather
 * than left holding whatever the previously-viewed year put there (defect 2). Clearing separately
 * and then applying works too — it is what the coordinator did — but it is two steps that have to
 * stay in step, and they did not.
 *
 * A null/undefined blob yields every field empty, which is the correct reading of "no saved state".
 *
 * @param {Record<string, any>|null|undefined} blob
 * @returns {Array<{id: string, value: string}>}
 */
export function bpFieldWrites(blob) {
    return BP_FIELDS.map(f => {
        const v = blob?.[f.key];
        return { id: f.id, value: v == null ? '' : String(v) };
    });
}

/**
 * Which of the four rate boxes carry a figure that is ON RECORD, and what that figure is.
 *
 * `null` means "not recorded" — the box stays permanently editable, because the member is the only
 * source for it. The live example is the CES 2025/26 old rate, which the app has never held.
 *
 * TWO RULES, one per historical defect, and both are easy to undo:
 *
 * **The decision never looks at what the box contains** (defect 4). An earlier version locked a box
 * when its value was non-empty, so a recompute triggered mid-typing froze the fragment the member
 * had got as far as. Whether a figure is on record is a property of the award, not of the form.
 *
 * **A locked box is WRITTEN, not merely disabled** (defect 5). Returning the value alongside the
 * lock is what makes that possible in one step: a caller that locks without writing leaves a stale
 * restored figure behind a padlock, which reads to the member as the app confirming it.
 *
 * An UNSETTLED award (`rateUnconfirmed`) records nothing at all — the figures are estimates until
 * the payslip lands, so every box stays open.
 *
 * @param {{rateUnconfirmed?: boolean, londonAllow?: number|null, londonAllowPre?: number|null}|null|undefined} taxYear
 * @param {{rate?: number|null, pre?: number|null}|null|undefined} award - awardRatesFor(grade, label)
 * @returns {{oldRate: number|null, newRateInput: number|null, oldLondon: number|null, newLondon: number|null}}
 */
export function resolveAuthoritativeRates(taxYear, award) {
    const settled = !taxYear?.rateUnconfirmed;
    const on = (/** @type {any} */ v) => (settled && typeof v === 'number' ? v : null);
    return {
        oldRate:      on(award?.pre),
        newRateInput: on(award?.rate),
        oldLondon:    on(taxYear?.londonAllowPre),
        newLondon:    on(taxYear?.londonAllow),
    };
}

/**
 * Are ALL four figures on record? Drives the collapse of the two input-shaped Old→New rows into one
 * read-only line — ~300px of boxes nobody can edit, restating figures the hero already carries.
 *
 * Named rather than inlined because "every box is locked" and "the rates are stated once" have to be
 * the same condition: collapsing on a weaker test would hide a box the member still needs to fill.
 * @param {Record<string, number|null>} auth
 */
export function allRatesOnRecord(auth) {
    const vals = Object.values(auth);
    return vals.length > 0 && vals.every(v => v != null);
}

/**
 * Which payslip period the back-pay lump is paid in.
 *
 * THE LADDER, and why it is in this order:
 *
 * 1. **A DECIDED award derives, and never trusts what was saved** (defect 1 / v18.12). The award's
 *    payment date is on record, so the payslip is deterministic — and its selector is HIDDEN, so a
 *    saved value from before an award-date move (the 3.6% award, deferred 31 Jul → 28 Aug) would pin
 *    the lump to a payslip the member can no longer see or change.
 * 2. Otherwise the member's own saved choice, which for an undecided award is the only answer there
 *    is.
 * 3. Otherwise the derived period, if there is one.
 * 4. Otherwise the fallback (today's period).
 *
 * **It must not return 0 while any candidate exists** (defect 3). Zero means "no paid-in period",
 * which drops the lump to £0 — and on a decided award there is no visible control to put it back.
 * That is the assertion worth keeping if the ladder is ever reordered.
 *
 * @param {object} o
 * @param {boolean} o.awardDecided - the award's payment date is on record
 * @param {number|null|undefined} o.derivedPNum - paidInPeriodNum(periods, awardFrom)
 * @param {number|null|undefined} o.savedPNum - the persisted selection, if still valid for this year
 * @param {number|null|undefined} o.fallbackPNum - todaysPeriodNum()
 * @returns {number} the period number, or 0 when genuinely nothing is known
 */
export function resolvePaidInPeriod({ awardDecided, derivedPNum, savedPNum, fallbackPNum }) {
    const ok = (/** @type {any} */ n) => (typeof n === 'number' && n > 0 ? n : 0);
    if (awardDecided && ok(derivedPNum)) return ok(derivedPNum);
    return ok(savedPNum) || ok(derivedPNum) || ok(fallbackPNum) || 0;
}
