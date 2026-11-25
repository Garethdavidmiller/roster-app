// @ts-check
/**
 * two-tap.js — the two-tap destructive control: tap once to arm ("Delete?"), tap again to confirm.
 *
 * Owns: `twoTap` (the one way to arm a control, and whether a tap confirms), `disarmConfirm`, and
 *   `TWO_TAP_MIN_MS`.
 * Does NOT own: what the action does, or the feedback line it reports on (feedback-line.js).
 * Used by: the Recorded-dates lists (admin-booked-periods.js), Saved Changes (admin-saved-changes.js)
 *   and Operations' email Remove (operations-app.js). Tested by two-tap.test.mjs, and through each list.
 *
 * ── WHY IT IS ITS OWN MODULE (25 Nov 2026) ──────────────────────────────────────────────────────
 *
 * It lived in admin-booked-periods.js, exported from a module whose subject is the recorded-dates
 * list, and Operations imported a leave list to get a button. It has no subject but the control, so
 * it is a module of its own; the reasoning below moved with it.
 *
 * ── ONE COPY CANNOT DRIFT ───────────────────────────────────────────────────────────────────────
 *
 * Saved Changes deletes the same records the Recorded-dates lists do, another way. There was a second
 * copy of the two-tap in Saved Changes, and only that copy had been fixed: the lists' copy left its
 * five-second disarm timer running, so it could disarm a re-armed ✕ early or put "✕" back over a slow
 * delete's "…" (whole-app check, 10 Nov 2026). One copy cannot drift.
 *
 * ── A DOUBLE TAP IS ONE GESTURE, NOT A QUESTION ANSWERED (confirm review, Nov 2026) ─────────────
 *
 * The second tap of a double tap met an armed control and deleted at once, so the two-tap asked
 * nothing of the hand that double-tapped — and iOS teaches double taps by swallowing a first tap with
 * the keypad up. The Pay Calculator's Clear had already learned this (`CLEAR_CONFIRM_MIN_MS`,
 * paycalc-clear-confirm.js); here the minimum lives in the one way to arm a control, `twoTap`, so no caller can
 * arm without it. `armConfirm` is deliberately NOT exported: a caller that armed it directly and
 * tested `confirming` itself would be the copy that forgot.
 */

/**
 * Arm a two-tap destructive control: its label, class and accessible name change together. A
 * DESTRUCTIVE TWO-STEP CONTROL MUST SAY ITS MEANING CHANGED (v23.16, external review), so the name
 * becomes "Confirm …"; the idle name is kept on the element, so any exit — the timer, a failure,
 * success — can restore it, and a re-arm while armed never reads "Confirm confirm …". It disarms
 * itself after five seconds — but never while it is `disabled`, which is how both delete paths mark
 * a delete in flight.
 *
 * The countdown is ONE per control, so a re-arm gets its own five seconds, and it lives ON the
 * control as `armTimer`, where the Saved Changes copy kept it: e2e/axe.spec.js clears it to hold
 * a confirm open for the length of its scan.
 * @param {HTMLElement} btn
 * @param {string} armedText what the armed control SHOWS
 * @param {string} idleText what it shows again once disarmed
 * @param {string} [armedName] the armed accessible name, where "Confirm " + the idle one would not
 *   contain what the control shows — the bulk button's count, said by a voice user as "Delete 3"
 *   (WCAG 2.5.3; 6 Nov 2026)
 */
function armConfirm(btn, armedText, idleText, armedName) {
    /** @type {any} */ (btn).armedAt = performance.now();
    btn.classList.add('confirming');
    btn.textContent = armedText;
    const idle = btn.dataset.idleLabel || btn.getAttribute('aria-label');
    if (idle) {
        btn.dataset.idleLabel = idle;
        btn.setAttribute('aria-label', armedName ?? `Confirm ${idle.charAt(0).toLowerCase()}${idle.slice(1)}`);
    }
    const b = /** @type {any} */ (btn);
    clearTimeout(b.armTimer);
    b.armTimer = setTimeout(() => {
        if (btn.classList.contains('confirming') && !b.disabled) disarmConfirm(btn, idleText);
    }, 5000);
}

/** A confirming tap sooner than this after arming is the SAME gesture — a double tap — never a
 *  question read and answered. The figure is the Pay Calculator's `CLEAR_CONFIRM_MIN_MS`, for the
 *  same reason (header). Measured on `performance.now()`, not `Date.now()`: it is monotonic, so a
 *  clock correction between the taps cannot shorten or stretch it, and the end-to-end suites pin
 *  `Date` with `page.clock.setFixedTime`, under which a `Date` gap never grows and no delete could
 *  ever be confirmed. */
export const TWO_TAP_MIN_MS = 500;

/**
 * One tap of a two-tap destructive control, and whether it CONFIRMS. An idle control is armed and the
 * tap confirms nothing; an armed one confirms only once `TWO_TAP_MIN_MS` has passed since it was
 * armed, so the second tap of a double tap is ignored and the control stays armed for a real answer.
 * On `true` the control is still armed: the caller disarms it, as it always has, when the action
 * starts or ends.
 *
 * `armedFor` names WHAT was asked about — the bulk delete's selection. A tap while armed for
 * something else re-arms for the new thing, with its own count and its own minimum, so the count asked
 * about is the count deleted.
 * @param {HTMLElement} btn
 * @param {string} armedText what the armed control shows — ONE word per action: 'Delete?' for one row,
 *   `Delete ${n}?` for several
 * @param {string} idleText what it shows again once disarmed
 * @param {string} [armedName] the armed accessible name (`armConfirm`)
 * @param {string} [armedFor] what this arming is for, when that can change under it
 * @returns {boolean} true: carry out the action now
 */
export function twoTap(btn, armedText, idleText, armedName, armedFor = '') {
    if (!btn.classList.contains('confirming') || (btn.dataset.armedFor ?? '') !== armedFor) {
        if (armedFor) btn.dataset.armedFor = armedFor; else delete btn.dataset.armedFor;
        armConfirm(btn, armedText, idleText, armedName);
        return false;
    }
    return performance.now() - (/** @type {any} */ (btn).armedAt ?? 0) >= TWO_TAP_MIN_MS;
}

/**
 * The armed control back to idle — label, class and accessible name together, so no exit can
 * restore two of the three — and its countdown stopped.
 * @param {HTMLElement} btn @param {string} idleText
 */
export function disarmConfirm(btn, idleText) {
    const b = /** @type {any} */ (btn);
    clearTimeout(b.armTimer);
    b.armTimer = undefined;
    btn.classList.remove('confirming');
    btn.textContent = idleText;
    if (btn.dataset.idleLabel) btn.setAttribute('aria-label', btn.dataset.idleLabel);
}
