// @ts-check
/**
 * clock-input.js — the rules of a TEXT clock box: what counts as a time, what the box shows while
 * one is being typed, and what it holds once it is left. No DOM calls, no Firebase, no imports: the
 * rules are pure, and the one fact they cannot read from a string — whether an entry is an EDIT of a
 * time the box held — is remembered per box (`shapeClockBox`, `settleClockBox`).
 *
 * Four places in the app type a time into a text box rather than an `<input type="time">`: the
 * roster review's entry control (`manualCellValue`, override-utils.js), the Admin week grid
 * (admin-time-inputs.js), the Overtime custom-hours row (overtime-form.js) and the Links window
 * editor (links-app.js). Each refused the native control
 * for the same measured reason — Chromium renders it from the OS format settings, not the page, so
 * it shows `06:00 AM` beside 24-hour shift badges — and each pays the same price: nothing in the
 * browser validates the value or helps type it any more. Both halves of that price are paid here,
 * once, so that the next box cannot pay only one of them.
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
 * @param {{ edited?: boolean }} [opts]  `edited`: three digits left by deleting from a time (`shapeClockBox`) — never padded
 * @returns {string}
 */
export function formatClockInput(raw, { edited = false } = {}) {
    let d = String(raw ?? '').replace(/[^0-9]/g, '').slice(0, 4);
    if (d.length === 3 && +d[0] >= 3 && !edited) d = '0' + d;
    return d.length >= 3 ? `${d.slice(0, 2)}:${d.slice(2)}` : d;
}

/**
 * What a TEXT clock box should hold once it is LEFT — on blur, or before its value is read. The
 * keystroke rule above, plus the one reading it has to defer: three digits whose first pair cannot
 * be an hour ("240", "253") are a dropped leading zero (02:40, 02:53). Leaving the box is what says
 * no fourth digit is coming. Anything else is what `formatClockInput` shows, so a box that already
 * holds a time, or an impossible one, is unchanged.
 * @param {string} raw  whatever is in the box
 * @param {{ edited?: boolean }} [opts]  `edited`: the digits are what is left of a time (`settleClockBox`) — never a dropped zero
 * @returns {string}
 */
export function finaliseClockInput(raw, { edited = false } = {}) {
    const d = String(raw ?? '').replace(/[^0-9]/g, '').slice(0, 4);
    // ANY three digits left in the box are a dropped zero when that reads as a time (owner, 24 Nov 2026): "130"
    // was left as "13:0" and refused at Save, though it can only mean 01:30 — and a keyboard that types a colon
    // makes it common ("1:30" is the digits 130). A reading that is no time ("199", 01:99) is left as typed.
    // NOT FOR AN EDIT (external review of v26.79): `edited` says the digits were left by deleting from a
    // time, so they are what is left of THAT time, not a new one typed short.
    if (d.length === 3 && !edited) {
        const dropped = `0${d[0]}:${d.slice(1)}`;
        if (isClockTime(dropped)) return dropped;
    }
    return formatClockInput(raw, { edited });
}

// ── A NEW TIME TYPED SHORT, OR WHAT IS LEFT OF AN OLD ONE (external review of v26.79) ─────────────
//
// Both shortcuts above read three digits as a time with its leading zero dropped: "130" is 01:30, "630"
// is 06:30. That is right for a time being TYPED, and wrong for one being EDITED. An admin who opens
// 22:30, deletes the last 0 and leaves the box has "22:3", the digits 223, and the dropped-zero reading
// made that 02:23: a valid time, so it saved, and it looked like an answer. Deleting the 1 of 16:30 did
// the same while typing ("630" became 06:30 at once). A string cannot tell the two apart, because
// "130" typed new and "22:3" left over are both three digits, so each box remembers the one fact that
// can: whether its digits are what is left of a time it held. If so, neither shortcut applies, and
// the box keeps what is there: incomplete, and refused at Save like any other unfinished time.
//
// The memory is a WeakMap keyed by the box, holding what the box last showed. Its rules (24-hour review,
// 25 Nov 2026, which found the first version's three gaps):
//   1. AN EDIT KEEPS WHAT IS IN THE BOX — the digits and the colon where the member left them, never
//      re-split as HH:MM (with no colon left in it, it goes after the hour as usual). Re-splitting moved the colon: the first 2 of 22:30 deleted showed "23:0", the
//      caret jumped to the end, and the 1 typed to make 12:30 made 23:01, a valid time, so it saved.
//      Kept as "2:30", the 1 lands where it is typed.
//   2. TYPING OVER PART OF A TIME IS AN EDIT, as deleting from one is. Selecting the 30 of 22:30 and typing
//      4 left "22:4", read as new and settled to 02:24 — the very answer rule 1's deletion case was written
//      to stop. The event says what was typed (`data`): when some of the held time's digits survive beside
//      it, it is an edit; when none do (select all, then type or paste) it is a new time, shortcuts and all.
//   3. A deletion that leaves two or three digits is an edit when the box held a time before it, or when
//      the box was never seen (what it held came from the page: a stored time).
//   4. THE FLAG CLEARS when the box holds a complete time again, or is emptied to one digit or none, which is
//      how a new time is started. It stayed on after an edit was finished, and a time pasted in later lost
//      its shortcut.
// A box whose remembered value is not what it now shows was set by the page since; its digits are treated
// as an edit, the safe reading.

/** @type {WeakMap<object, { last: string, edited: boolean }>} */
const boxes = new WeakMap();

/** @param {string} v @returns {string} */
const digitsOf = v => String(v ?? '').replace(/[^0-9]/g, '').slice(0, 4);

/** Is `few` what is left of `many` after some of its digits are deleted? @param {string} few @param {string} many */
function leftAfterDeleting(few, many) {
    let i = 0;
    for (const c of many) if (c === few[i]) i++;
    return few.length < many.length && i === few.length;
}

/** The box as the member left it (rule 1): its digits, at most four, and the first colon where it stands.
 *  @param {string} v @returns {string} */
function asLeft(v) {
    let out = '', digits = 0, colon = false;
    for (const c of String(v ?? '')) {
        if (c >= '0' && c <= '9' && digits < 4) { out += c; digits++; }
        else if (c === ':' && !colon) { out += c; colon = true; }
    }
    return out;
}

/** Rule 1 applies: an unfinished edit whose colon the member left in place.
 *  @param {string} v @param {string} d  its digits @param {boolean} edited */
const keepsAsLeft = (v, d, edited) => edited && d.length < 4 && String(v ?? '').includes(':');

/** Did typing `typed` over the held digits `before` leave some of them beside it (rule 2)?
 *  @param {string} now  the digits now @param {string} before  the digits held @param {string} typed  the digits typed */
function typedOverPart(now, before, typed) {
    const kept = now.length - typed.length;
    return kept > 0 && now.length <= before.length;
}

/**
 * What a text clock box should show after an INPUT event: `formatClockInput`, told whether this entry is
 * an edit of a time the box held — and, while it is one and unfinished, the box as the member left it
 * (rule 1). Call it from the box's `input` handler, with the event.
 * @param {{ value: string }} box  the input element
 * @param {{ inputType?: string, data?: string | null } | null} [event]  the `input` event: `inputType` says
 *   whether this was a deletion, `data` what was typed
 * @returns {string}
 */
export function shapeClockBox(box, event) {
    const d = digitsOf(box.value);
    const seen = boxes.get(box);
    const kind = String(event?.inputType ?? '');
    let edited = false;
    if (d.length > 1) {
        if (kind.startsWith('delete')) {
            const before = seen?.last;
            edited = before === undefined || !leftAfterDeleting(d, before)
                || isClockTime(formatClockInput(before)) || seen?.edited === true;
        } else {
            // What was typed: the event's own `data` — one digit when a browser leaves it out of a keystroke.
            const typed = event?.data == null ? (kind === 'insertText' ? 'x' : '') : digitsOf(event.data);
            const before = seen?.last;
            const overTime = before === undefined
                ? kind === 'insertText'                       // a keystroke into a box the page filled: its stored time
                : isClockTime(formatClockInput(before));
            edited = seen?.edited === true
                || (overTime && typed !== '' && typedOverPart(d, before ?? '9999', typed));
        }
    }
    const shaped = keepsAsLeft(box.value, d, edited) ? asLeft(box.value) : formatClockInput(box.value, { edited });
    // Rule 4: a complete time again ends the edit.
    boxes.set(box, { last: digitsOf(shaped), edited: edited && !isClockTime(shaped) });
    return shaped;
}

/**
 * What a text clock box should hold once it is LEFT: `finaliseClockInput`, told whether its digits are
 * what is left of a time it held (`shapeClockBox`) — and an unfinished edit left as it is (rule 1).
 * Call it on blur, or before the value is read.
 * @param {{ value: string }} box  the input element
 * @returns {string}
 */
export function settleClockBox(box) {
    const d = digitsOf(box.value);
    const seen = boxes.get(box);
    // Never typed in: nothing was deleted. Set by the page since it was last typed in: the safe reading.
    const edited = seen === undefined ? false : (seen.last === d ? seen.edited : d.length === 3);
    if (keepsAsLeft(box.value, d, edited)) return asLeft(box.value);
    return finaliseClockInput(box.value, { edited });
}

/** What is wrong with a FILLED-IN pair of clock times, or `''` — the ONE rule a Shift's times and an
 *  Other day's share (`composeTimedValue` here, `composeOtherValue` in other-day.js; review, 21 Nov
 *  2026: the week grid's save had its own copy). Equal times are refused because a 0h shift PAYS as
 *  24h through the overnight wrap in the duration maths. @param {string} s @param {string} e @returns {string} */
export function timePairError(s, e) {
    if (!isClockTime(s) || !isClockTime(e)) return 'times must be in HH:MM format (e.g. 07:00)';
    return s === e ? 'start and end times are the same' : '';
}

/**
 * COMPOSE a timed value — a Shift's or an RDW's `HH:MM-HH:MM`. Both times are REQUIRED here; an Other
 * day's are optional (`composeOtherValue`), which is the one difference between the two writers.
 * @param {{ start?: string, end?: string }} f
 * @returns {{ value: string, error?: undefined } | { error: string, value?: undefined }}
 */
export function composeTimedValue(f) {
    const s = ((f && f.start) || '').trim();
    const e = ((f && f.end)   || '').trim();
    if (!s || !e) return { error: 'fill in the start and end time' };
    const bad = timePairError(s, e);
    return bad ? { error: bad } : { value: `${s}-${e}` };
}
