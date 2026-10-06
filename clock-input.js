// @ts-check
/**
 * clock-input.js — the two rules of a TEXT clock box: what counts as a time, and what the box
 * shows while one is being typed. Pure; no DOM, no Firebase, no imports.
 *
 * Three places in the app type a time into a text box rather than an `<input type="time">`: the
 * roster review's entry control (`manualCellValue`, override-utils.js), the Overtime custom-hours
 * row (overtime-form.js) and the Links window editor (links-app.js). Each refused the native control
 * for the same measured reason — Chromium renders it from the OS format settings, not the page, so
 * it shows `06:00 AM` beside 24-hour shift badges — and each pays the same price: nothing in the
 * browser validates the value or helps type it any more. Both halves of that price are paid here,
 * once, so that a fourth box cannot pay only one of them.
 *
 * Extracted from override-utils.js at v24.61 when `formatClockInput` arrived and the coordinator
 * ratchet said that file had grown past 900 lines. It was right in the way it is meant to be: both
 * functions are rules a Node test pins without a DOM, and neither is about overrides.
 *
 * `isClockTime` ACCEPTS; `formatClockInput` SHAPES. A shaped value is still judged — the shaper
 * never widens what the guard admits, it only makes the admitted form reachable from a phone.
 */

/**
 * Is `v` a REAL clock time in `HH:MM`, not merely the shape of one?
 *
 * What a text box costs is the browser's free validation, and nothing else rejects `29:00` or
 * `99:99`; a shape test alone let both through, to be read as nonsense by every duration helper
 * downstream. `24:00` is refused with them: the roster writes a midnight finish as `00:00`
 * (`15:00-00:00` appears on the real Supervisor sheet), and an overnight range is expressed by
 * end < start.
 * @param {string} v
 * @returns {boolean}
 */
export function isClockTime(v) {
    const m = /^(\d{2}):(\d{2})$/.exec(String(v ?? ''));
    return !!m && +m[1] <= 23 && +m[2] <= 59;
}

/**
 * What a TEXT clock box should show after each keystroke (v24.61, iOS audit). The boxes are
 * `inputmode="numeric"`, and on an iPhone that keypad has digits and nothing else — no colon — so
 * a box whose reader demands `HH:MM` could not be filled from a phone at all: the Links window
 * times reverted "0730" and the roster review's entry cells stayed "Not saved" on it. The admin
 * week grid had solved this on its own since v10 (its formatter lives in admin-week-editor.js and
 * also moves focus, which is why it is not simply reused); this is that rule as a pure function,
 * for every other clock box: keep the digits, at most four; a THREE-digit run whose first pair cannot
 * be an hour ("630") is read as a leading zero dropped ("06:30"), never "63:0"; a four-digit run that
 * is not a time ("2400", "6300") is left for `isClockTime` to refuse — reshaping it would produce a
 * valid time nobody typed; the colon goes in after the hour once there is one. Setting a box to the value it already holds is
 * a no-op for the caret, so callers may assign the result unconditionally.
 * @param {string} raw  whatever is in the box
 * @returns {string}
 */
export function formatClockInput(raw) {
    let d = String(raw ?? '').replace(/[^0-9]/g, '').slice(0, 4);
    // The dropped-zero reading applies to THREE digits only, exactly as the week editor's rule
    // (admin-week-editor.js): a four-digit run that is not a time — "2400", "6300" — is left as it is,
    // for `isClockTime` to refuse, never reshaped into a valid time nobody typed (24-hour review).
    if (d.length === 3 && parseInt(d.slice(0, 2), 10) > 23) d = '0' + d;
    return d.length >= 3 ? `${d.slice(0, 2)}:${d.slice(2)}` : d;
}
