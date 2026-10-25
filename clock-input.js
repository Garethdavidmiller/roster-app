// @ts-check
/**
 * clock-input.js — the rules of a TEXT clock box: what counts as a time, what the box shows while
 * one is being typed, and what it holds once it is left. Pure; no DOM, no Firebase, no imports.
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
 * `isClockTime` ACCEPTS; `formatClockInput` and `finaliseClockInput` SHAPE. A shaped value is still
 * judged — the shapers never widen what the guard admits, they only make the admitted form
 * reachable from a phone.
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
 * week grid had solved this on its own since v10; this is that rule as a pure function, and since
 * v24.64 the week grid uses it too (admin-time-inputs.js keeps only the focus move): keep the
 * digits, at most four; the colon goes in after the hour once there is one; a four-digit run that
 * is not a time ("2400", "6300") is left for `isClockTime` to refuse — reshaping it would produce
 * a valid time nobody typed. Setting a box to the value it already holds is a no-op for the caret,
 * so callers may assign the result unconditionally.
 *
 * THREE DIGITS ARE RESHAPED HERE ONLY WHEN NO FOURTH COULD FOLLOW (whole-app review, Oct 2026). A
 * first digit of 3 to 9 cannot begin an hour, so "630" can only be 06:30 and becomes it at once.
 * "240" is different: it may be 02:40, or the first three keys of "2400". This function used to
 * read every run whose first pair passed 23 as a dropped zero, so "240" became "02:40" — five
 * characters, a full box — and the last 0 of a midnight finish was never typed; 02:40 is a valid
 * time, so it saved. The unit test fed the whole string "2400" and passed, because a whole string
 * is not how a box is filled. A first pair of 24 to 29 is now left as typed, and the dropped-zero
 * reading waits for the box to be left (`finaliseClockInput`), when no fourth digit is coming.
 * @param {string} raw  whatever is in the box
 * @returns {string}
 */
export function formatClockInput(raw) {
    let d = String(raw ?? '').replace(/[^0-9]/g, '').slice(0, 4);
    if (d.length === 3 && +d[0] >= 3) d = '0' + d;
    return d.length >= 3 ? `${d.slice(0, 2)}:${d.slice(2)}` : d;
}

/**
 * What a TEXT clock box should hold once it is LEFT — on blur, or before its value is read. The
 * keystroke rule above, plus the one reading it has to defer: three digits whose first pair cannot
 * be an hour ("240", "253") are a dropped leading zero (02:40, 02:53). Leaving the box is what says
 * no fourth digit is coming. Anything else is what `formatClockInput` shows, so a box that already
 * holds a time, or an impossible one, is unchanged.
 * @param {string} raw  whatever is in the box
 * @returns {string}
 */
export function finaliseClockInput(raw) {
    const d = String(raw ?? '').replace(/[^0-9]/g, '').slice(0, 4);
    if (d.length === 3 && +d.slice(0, 2) > 23) return `0${d[0]}:${d.slice(1)}`;
    return formatClockInput(raw);
}
