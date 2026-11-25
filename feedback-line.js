// @ts-check
/**
 * feedback-line.js — a feedback line's fade: ONE per line, cancelled by every later write to it.
 *
 * Owns: `holdFeedback` (stop a pending fade before writing) and `fadeFeedback` (fade the line back to
 *   its idle class after a while).
 * Does NOT own: what a line says (status-text.js writes the words and the glyph).
 * Used by: the range cards (admin-range-booking.js), the Recorded-dates deletes
 *   (admin-period-delete.js) and Saved Changes (admin-saved-changes.js). Tested by two-tap.test.mjs.
 *
 * ── WHY ONE FADE PER LINE ───────────────────────────────────────────────────────────────────────
 *
 * The range cards write the same feedback line the Recorded-dates list's deletes report on, and each
 * writer used to start its own timer: a fade started for an earlier message took a later one down —
 * an error three seconds after a delete, or a receipt meant never to time out (whole-app check,
 * 10 Nov 2026). So the pending fade is kept per element, here, and every writer of a shared line
 * holds it before writing. It left admin-booked-periods.js on 25 Nov 2026, as two-tap.js did: its
 * subject is the line, not the list.
 */

/** Each feedback line's pending fade. ONE per line, cancelled by every later write to it. */
const _fades = new WeakMap();

/**
 * Stop a feedback line's pending fade. Every writer of a shared line calls this before it writes:
 * a fade started for an earlier message took a later one down — an error three seconds after a
 * delete, or a receipt meant never to time out (whole-app check, 10 Nov 2026).
 * @param {Element|null|undefined} el
 */
export function holdFeedback(el) {
    if (!el) return;
    clearTimeout(_fades.get(el));
    _fades.delete(el);
}

/**
 * Fade a feedback line back to `idleClass` after `ms`, replacing any fade already pending on it.
 * @param {Element|null|undefined} el @param {string} idleClass @param {number} ms
 */
export function fadeFeedback(el, idleClass, ms) {
    if (!el) return;
    holdFeedback(el);
    _fades.set(el, setTimeout(() => { _fades.delete(el); el.className = idleClass; }, ms));
}
