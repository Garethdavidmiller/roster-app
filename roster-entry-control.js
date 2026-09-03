// @ts-check
/**
 * roster-entry-control.js — answering an unreadable roster cell where the question is asked.
 *
 * Owns: the little type-pill + times editor that appears under an UNREADABLE review row, and the
 *   one rule about when a half-finished entry becomes a value.
 * Does NOT own: what an unreadable cell IS (admin-roster-upload.js), the value grammar
 *   (`manualCellValue`, override-utils.js) or the guards (`normaliseCellValue`, roster-cell-rules.js).
 * Edit here for: the control's markup, or what it says while incomplete.
 *
 * ── WHY IT EXISTS ──────────────────────────────────────────────────────────────────────────────
 *
 * An unreadable cell with no candidate readings was a DEAD END: the row said "check the paper
 * roster" and the only way to act on it was to finish the review, leave for the Admin page, and
 * remember the person and the day. The real Supervisor roster contains cells like `SEE NATHAN` and
 * `See CEM`, which no parser will ever read as a shift, so the dead end is not a rare corner.
 *
 * ── THE THREE RULES ────────────────────────────────────────────────────────────────────────────
 *
 * 1. **The pills are generated from `PILL_TYPES`** — the ONE declaration of which pills exist and
 *    in what order — so this control and Change a Shift cannot drift apart. That includes `other`
 *    since v22.50: its `FLAVOUR[" RDW"][" HH:MM-HH:MM"]` grammar arrives with the same sub-controls
 *    the week editor has, generated from `OTHER_FLAVOURS` and composed by `composeOtherValue`, so
 *    nothing about the grammar is authored twice. Spare is the one flavour not offered here.
 * 2. **Sunday exclusions are consulted, never restated.** `isForbiddenOnSunday` is the list; it has
 *    six numbered enforcement layers already and a seventh copy is how one of them goes stale.
 * 3. **An entry passes the guards a parsed value passes.** `commitEntry` composes through
 *    `manualCellValue` and then `normaliseCellValue` (roster-cell-rules.js), so entering a value can
 *    never be a route to write something the parsed path would have refused.
 *
 * ── WHY THE TIMES ARE TEXT AND NOT `<input type="time">` ───────────────────────────────────────
 *
 * `type="time"` was written first — it validates by construction and needs no formatter, which is a
 * real argument. It was replaced on a MEASUREMENT. Chromium renders that control from the OS/browser
 * format settings, not from the page, so it showed `06:00 AM` / `02:00 PM` even with
 * `navigator.language` forced to `en-GB` (checked, because the obvious explanation — an en-US test
 * browser — turned out to be the wrong one). Every other time on this page is 24-hour, and the shift
 * badges beside this control read `13:30-21:00`, so a 12-hour box in the one place the admin TYPES
 * is both inconsistent and genuinely ambiguous.
 *
 * Text does not weaken the guard: `manualCellValue` requires a REAL clock time on both boxes —
 * the shape AND hours 00–23, minutes 00–59 — so a half-typed or impossible time produces no entry
 * and writes nothing. (It checked only the shape for one release, which let `29:00` through.) What it needs instead is to SAY
 * so, which is what the hint under the boxes is for — and what `patchEntryRow` keeps true as the
 * admin types, because a re-render would destroy the field they are typing into.
 */

import { escapeHtml as esc, isSunday } from './roster-data.js';
import { TYPES, PILL_TYPES } from './admin-shift-types.js';
import { manualCellValue, isForbiddenOnSunday, composeOtherValue, isRestShift, OTHER_FLAVOURS } from './override-utils.js';
import { normaliseCellValue } from './roster-cell-rules.js';

/** What the hint under the time boxes says, in both of its states. */
const HINT_DONE = '\u2713 this day will be saved';
const HINT_TODO = 'Enter both times in 24-hour form, e.g. 06:20';
/** Other days take their hours from the day underneath unless a time is given, so both boxes may
 *  stay blank — the hint has to say so, or an admin fills them in to make the tick appear. */
const HINT_FLAVOUR = 'Choose the kind of Other day above.';
const HINT_OTHER = 'Times are optional — leave both blank to use the usual hours for that day.';
/** The two questions, STATED (v22.51). The control carried an `aria-label` and nothing on screen,
 *  so a sighted admin met six unlabelled buttons in a grey box — and, once Other was picked, six
 *  more of them. Naming each question is what makes the second group read as a narrowing of the
 *  first rather than a competing row of equals. */
const Q_TYPE = 'What kind of day was it?';
const Q_OTHER = 'Which kind of Other day?';

/**
 * The in-place "enter it myself" control for an unreadable cell (v22.17).
 *
 * WHY IT EXISTS. An unreadable cell with no candidate readings was a dead end: the row said
 * "check the paper roster" and the only way to act was to finish the review, leave for the
 * Admin page, and remember the person and the day. The real Supervisor roster carries cells like
 * `SEE NATHAN` and `See CEM`, which no parser will read as a shift, so this is not a rare corner.
 * Answering the question where it is asked is the fix.
 *
 * The pills are generated from `PILL_TYPES` — the ONE declaration of which pills exist and in
 * what order — so this row and Change a Shift cannot drift apart. Sunday exclusions come from
 * `isForbiddenOnSunday`, consulted rather than restated: that list has six numbered enforcement
 * layers and a seventh copy is how one of them goes stale — which is why the note naming what a
 * Sunday DOES allow is derived from that same call rather than written out.
 *
 * Both groups state their question on screen (v22.51). They had an `aria-label` and nothing else,
 * so a sighted admin met six unlabelled buttons in a grey box, then six more; and the two reasons a
 * control is locked — a Sunday, a rest day — lived in `title` attributes, which a phone never shows.
 *
 * ── WHY THE TIMES ARE TEXT AND NOT `<input type="time">` ───────────────────────────────────
 *
 * `type="time"` was written first — it validates by construction and needs no formatter, which
 * is a real argument. It was replaced on a MEASUREMENT. Chromium renders that control from the
 * OS/browser format settings, not from the page, so it showed `06:00 AM` / `02:00 PM` even with
 * `navigator.language` forced to `en-GB` (checked, because the obvious explanation — an en-US
 * test browser — turned out to be the wrong one). Every other time on this page is 24-hour, and
 * the shift badges beside this control read `13:30-21:00`, so a 12-hour box in the one place the
 * admin TYPES is both inconsistent and genuinely ambiguous.
 *
 * Text does not weaken the guard: `manualCellValue` requires `HH:MM` on both boxes, so a
 * half-typed or malformed time simply produces no entry and writes nothing. What it needs
 * instead is to SAY so, which is what the hint under the boxes is for.
 *
 * @param {string} key @param {any} s @param {string} date
 */
export function entryControlHtml(key, s, date) {
    const d = s.draft || { type: null, from: '', to: '' };
    const sun = isSunday(date);
    const pills = PILL_TYPES.map(t => {
        const off = sun && isForbiddenOnSunday(t);
        return `<button type="button" class="roster-entry-pill${d.type === t ? ' is-on' : ''}"
            data-key="${esc(key)}" data-entry-type="${t}" aria-pressed="${d.type === t}"
            ${off ? 'disabled title="Not allowed on a Sunday — Sunday work is RDW"' : ''}>${esc(TYPES[t].pill)}</button>`;
    }).join('');
    // The Sunday exclusions are DERIVED for the note as well as for the pills (rule 2). A `title`
    // is not a mobile affordance and every admin here is on a phone, so the reason four of the six
    // pills are dead has to be on screen — but naming them in prose would be the seventh copy of a
    // list with six enforcement layers, so it names what is LEFT, read from `isForbiddenOnSunday`.
    const sunNote = !sun ? '' : `<p class="roster-entry-sunday">Only ${
        esc(PILL_TYPES.filter(t => !isForbiddenOnSunday(t)).map(t => TYPES[t].pill).join(' and '))
    } can be recorded on a Sunday — Sunday work is always RDW.</p>`;
    const isOther   = d.type === 'other';
    const needsTime = d.type === 'shift' || d.type === 'rdw' || isOther;
    const baseIsRd  = isRestShift(s.baseShift);
    // An Other day's value is a GRAMMAR — `FLAVOUR[" RDW"][" HH:MM-HH:MM"]` — so it needs the same
    // three sub-controls the week editor gives it. They are generated from `OTHER_FLAVOURS`, the ONE
    // declaration of which flavours exist, and composed by `composeOtherValue`, the writer half of
    // the grammar that the week editor's save path already calls: this control authors nothing of
    // its own, so the two surfaces cannot disagree about what a Training day is.
    const otherOpts = !isOther ? '' : `<div class="roster-entry-other">
            <p class="roster-entry-q roster-entry-q--sub">${Q_OTHER}</p>
            <div class="roster-entry-flavours" role="group" aria-label="Type of day">
                ${Object.entries(OTHER_FLAVOURS).map(([k, f]) =>
                    `<button type="button" class="roster-entry-flavour${d.flavour === k ? ' is-on' : ''}"
                        data-key="${esc(key)}" data-entry-flavour="${k}" aria-pressed="${d.flavour === k}">${esc(f.full)}</button>`).join('')}
            </div>
            <label class="roster-entry-rdw"><input type="checkbox" class="roster-entry-rdw-cb" data-key="${esc(key)}"
                ${(d.rdw || baseIsRd) ? 'checked' : ''}${baseIsRd ? ' disabled title="Rest day — RDW is automatic"' : ''}> Rest day worked${
                baseIsRd ? '<span class="roster-entry-lock">(automatic on a rest day)</span>' : ''}</label>
        </div>`;
    return `<div class="roster-entry" data-key="${esc(key)}">
        <p class="roster-entry-q">${Q_TYPE}</p>
        <div class="roster-entry-pills" role="group" aria-label="Choose the shift type">${pills}</div>
        ${sunNote}
        ${otherOpts}
        ${needsTime ? `<div class="roster-entry-times">
            <input type="text" class="roster-entry-time" data-key="${esc(key)}" data-part="from"
                   value="${esc(d.from)}" inputmode="numeric" maxlength="5" placeholder="HH:MM"
                   autocomplete="off" aria-label="Start time (24-hour, HH:MM)">
            <span class="roster-entry-dash" aria-hidden="true">–</span>
            <input type="text" class="roster-entry-time" data-key="${esc(key)}" data-part="to"
                   value="${esc(d.to)}" inputmode="numeric" maxlength="5" placeholder="HH:MM"
                   autocomplete="off" aria-label="End time (24-hour, HH:MM)">
        </div>` : ''}
        ${d.type ? `<p class="roster-entry-hint">${entryHint(d, s)}</p>` : ''}
    </div>`;
}


/**
 * The cell key is `member|YYYY-MM-DD`, and a roster name can hold no `|`, so the date is the tail.
 * @param {string} key @returns {string} ISO date
 */
export function isoFromKey(key) {
    return key.slice(key.lastIndexOf('|') + 1);
}

/**
 * Re-draw ONE row's entry control, leaving the rest of the review alone (v22.50).
 *
 * The sibling of `patchEntryRow` below, and it exists for the same reason one step further out.
 * That one says a re-render would destroy the input being typed into; this one says a re-render
 * ALSO destroys the admin's place in a long review. `renderReviewTable` rebuilds every section and
 * replaces the list container outright, so the document momentarily holds no rows at all, the
 * scroll position clamps to the shorter page, and pressing a disclosure button throws the reader
 * back to the top. Reported from the station, then measured at 390x844: scrollY 1286 -> 462 on a
 * single tap, and again on every pill after it.
 *
 * Picking a type genuinely changes the control (which pill is lit, whether the time boxes are
 * needed), so it must be re-drawn — but only IT.
 *
 * @param {any} rowEl the `.roster-change-row` @param {string} key @param {any} st its cell state
 */
export function redrawEntry(rowEl, key, st) {
    const el = rowEl?.querySelector('.roster-entry');
    if (el) el.outerHTML = entryControlHtml(key, st, isoFromKey(key));
}

/**
 * Open or close a row's entry control, in place.
 *
 * Where it goes differs by row and this is the only place that knows: after the whole pick GROUP
 * on a CONFLICT row that offers readings, and after the button itself on an UNREADABLE row that
 * does not — matching where the review's own render puts it.
 *
 * @param {any} rowEl the `.roster-change-row` @param {any} btn the pressed button
 * @param {string} key @param {any} st its cell state @param {boolean} open
 */
export function toggleEntry(rowEl, btn, key, st, open) {
    const already = rowEl?.querySelector('.roster-entry');
    if (!open) { already?.remove(); }
    else if (!already) {
        const group  = btn.closest('.roster-pick');
        const anchor = (group && rowEl?.contains(group)) ? group : btn;
        anchor.insertAdjacentHTML('afterend', entryControlHtml(key, st, isoFromKey(key)));
    }
    btn.classList.toggle('is-open', open);
}

/**
 * Keep a row honest while the admin types (v22.17).
 *
 * The keystroke path deliberately does NOT re-render — that would destroy the input being typed
 * into — so without this the row went on reading "Not saved · couldn't read — check the paper
 * roster" while the summary above had already counted the entry. The screen contradicted itself.
 *
 * @param {Element|null|undefined} rowEl @param {boolean} done
 * @param {any} [st] the cell state — pass it and the hint speaks for ANY draft, not just a timed one
 */
export function patchEntryRow(rowEl, done, st) {
    if (!rowEl) return;
    const act = rowEl.querySelector('.roster-act');
    if (act) {
        act.textContent = done ? 'Your entry' : "Couldn't read";
        act.classList.toggle('act-choice', done);
        act.classList.toggle('act-read', !done);
    }
    const note = rowEl.querySelector('.roster-remove-note');
    if (note) note.textContent = done
        ? '\u2713 you entered the shift below'
        : 'check the paper roster, or enter it below';
    const btn = rowEl.querySelector('.roster-choice-btn--enter');
    if (btn) {
        btn.textContent = done ? 'Entered — change it' : 'Enter the shift';
        btn.classList.toggle('is-chosen', done);
        btn.setAttribute('aria-pressed', String(done));
    }
    // ONE function decides what this line says (v22.50). This used to pick between two constants,
    // which was right while the only draft was a shift with two times — and silently wrong the
    // moment an Other day arrived, because it runs AFTER `redrawEntry` and overwrote a correct
    // "choose the type of Other day" with "enter both times". Pass the state and it cannot.
    const hint = rowEl.querySelector('.roster-entry-hint');
    if (hint) hint.textContent = st ? entryHint(st.draft || {}, st) : (done ? HINT_DONE : HINT_TODO);
    rowEl.classList.toggle('roster-change-unreadable', !done);
}

/**
 * Compose what a draft AMOUNTS TO — the parsed-roster value, or null with the reason it is not one.
 *
 * Both kinds route through code that already exists: an ordinary type through `manualCellValue`,
 * an Other day through `composeOtherValue`. Nothing about either grammar is written here.
 * @param {any} d the draft @param {any} st the cell state @returns {{ value: string|null, error: string }}
 */
function draftValue(d, st) {
    if (d.type !== 'other') return { value: d.type ? manualCellValue(d.type, d.from, d.to) : null, error: '' };
    const r = composeOtherValue({
        flavour: d.flavour, rdwTicked: d.rdw, baseIsRd: isRestShift(st.baseShift), start: d.from, end: d.to,
    });
    return { value: r.value ?? null, error: r.error ?? '' };
}

/** The line under the boxes. It must never say "will be saved" over a draft that would not be.
 *  @param {any} d @param {any} st @returns {string} */
function entryHint(d, st) {
    const { value, error } = draftValue(d, st);
    if (value) return HINT_DONE;
    // `composeOtherValue`'s own "no flavour yet" message names Spare, because the week editor
    // offers it. This control does not, so it says its own sentence rather than promising a chip
    // that is not on screen — every other error it raises is about times and reads correctly here.
    if (!d.flavour && d.type === 'other') return HINT_FLAVOUR;
    if (error) return esc(error.charAt(0).toUpperCase() + error.slice(1));
    return d.type === 'other' ? HINT_OTHER : HINT_TODO;
}

/**
 * Apply a click inside the control to the draft, then commit it.
 *
 * Lives here rather than in the review's delegated handler because the coordinator sits AT its
 * ratchet cap and, more to the point, because which sub-controls exist is this module's business.
 * @param {any} el the clicked element @param {any} st the cell state @returns {boolean} handled
 */
export function entryClick(el, st) {
    const d = { ...(st.draft || {}), open: true };
    const type = el.dataset?.entryType;
    const flav = el.dataset?.entryFlavour;
    if (type !== undefined)      d.type = d.type === type ? null : type;
    else if (flav !== undefined) d.flavour = d.flavour === flav ? null : flav;
    else if (el.classList?.contains('roster-entry-rdw-cb')) d.rdw = !!el.checked;
    else return false;
    st.draft = d;
    commitEntry(st);
    return true;
}

/**
 * Turn the in-progress draft into a committed entry, or into nothing (v22.17).
 *
 * The composed value goes through `normaliseCellValue` — the SAME guards an ordinary parsed value
 * gets (the Sunday rewrite, the absence-on-a-rest-day rewrite, the RDW display marker). Entering a
 * value must never be a route to write something the parsed path would have refused; the pick
 * control already works this way and this joins it.
 *
 * @param {any} s a cell state
 */
export function commitEntry(s) {
    const d = s.draft || {};
    const raw = draftValue(d, s).value;
    if (!raw) { s.entered = null; if (s.chosen === 'entered') s.chosen = null; return; }
    s.entered = normaliseCellValue(raw, s.baseShift, s.date);
    s.chosen  = 'entered';
}
