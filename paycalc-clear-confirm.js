// @ts-check
/**
 * paycalc-clear-confirm.js — the Pay Calculator's two-tap "Clear all entries".
 *
 * Owns: arming the button, its three-second countdown, disarming it, and which tap CONFIRMS.
 * Does NOT own: what a clear deletes (paycalc-app.js → clearPeriod, handed in as `onConfirm`), or WHEN
 *   the page disarms it — a change of payslip and a hidden tab, both the coordinator's (`reset`).
 *
 * Out of paycalc-app.js (25 Nov 2026), where its state was the `_clearState` object, so the arm, the
 * countdown and the two timers reset together. Admin's two-tap controls are their own code
 * (`TWO_TAP_MIN_MS`); what they share with this one is the minimum gap and the clock it is read on.
 *
 * ── THE RULES ─────────────────────────────────────────────────────────────────────────────────
 *
 * 1. The first tap ARMS: "Select again to confirm (3)", counting down a second at a time, and
 *    disarming itself after three seconds (e2e/paycalc.spec.js holds the words and the timing).
 * 2. A confirming tap sooner than `CLEAR_CONFIRM_MIN_MS` after arming is the SAME gesture — a
 *    double-tap, which iOS teaches by swallowing a first tap with the keypad up — never a prompt read
 *    and answered. It is ignored, and the button stays armed for a real answer.
 * 3. The gap is measured on `performance.now()`, not `Date.now()` (25 Nov 2026, as Admin's): it is
 *    monotonic, so a clock correction between the taps cannot shorten or stretch it, and the
 *    end-to-end suites pin `Date`, under which a `Date` gap need not grow.
 * 4. `reset` disarms from anywhere — the coordinator calls it on a change of payslip (arming Clear on
 *    payslip A then switching to B left the confirm live, so ONE tap on B wiped B) and when the tab is
 *    hidden (iOS fires a suspended timer at once on resume — an accidental wipe). A confirm disarms
 *    BEFORE `onConfirm` runs, so nothing it does can find the button still armed.
 */

/** A confirming tap sooner than this after arming is the same gesture (rule 2). */
export const CLEAR_CONFIRM_MIN_MS = 500;
/** How long the button stays armed, counted down a second at a time on its label. */
const ARMED_SECONDS = 3;
const IDLE_LABEL = 'Clear all entries';

/**
 * Wire `btn` as a two-tap destructive control.
 * @param {HTMLElement|null} btn  the "Clear all entries" button (nothing is wired without one)
 * @param {() => void} onConfirm  what a confirmed second tap does
 * @returns {{ reset: () => void }}  disarm it, if armed — a no-op otherwise
 */
export function createClearConfirm(btn, onConfirm) {
  let pending = false;
  let armedAt = 0;
  /** @type {ReturnType<typeof setTimeout> | undefined} */ let timer;
  /** @type {ReturnType<typeof setInterval> | undefined} */ let countdown;

  const reset = () => {
    if (!pending) return;
    clearTimeout(timer);
    clearInterval(countdown);
    pending = false;
    timer = countdown = undefined;
    if (btn) { btn.textContent = IDLE_LABEL; btn.classList.remove('confirming'); }
  };

  const arm = () => {
    pending = true;
    let secs = ARMED_SECONDS;
    if (btn) { btn.textContent = `Select again to confirm (${secs})`; btn.classList.add('confirming'); }
    countdown = setInterval(() => {   // the countdown, a tick a second
      secs--;
      if (secs > 0 && btn) btn.textContent = `Select again to confirm (${secs})`;
    }, 1000);
    timer = setTimeout(reset, ARMED_SECONDS * 1000);
    armedAt = performance.now();
  };

  btn?.addEventListener('click', () => {
    if (!pending) { arm(); return; }
    if (performance.now() - armedAt < CLEAR_CONFIRM_MIN_MS) return;   // still the arming tap's gesture
    reset();
    onConfirm();
  });

  return { reset };
}
