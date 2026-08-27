// @ts-check
/**
 * status-text.js — the leading GLYPH on a transient status message, and who hears it.
 *
 * ── THE PROBLEM ─────────────────────────────────────────────────────────────────────────────────
 *
 * The app writes about fifty transient status lines that lead with a glyph — `✓ Settings saved`,
 * `⚠ No working days in that range`, `✗ Copy failed`, `↻ Updating your shifts…`. Most of them land
 * in an `aria-live` region, which is the whole point: a sighted user sees the line appear, and a
 * screen-reader user is told about it.
 *
 * They are told about the glyph too. `⚠️` and `✅` are emoji and are announced by name in every
 * screen reader ("warning", "white heavy check mark"); `✓`, `✗` and `↻` are symbols, announced or
 * not depending on the reader's punctuation verbosity — so the same message is read differently on
 * different machines, and on the noisier settings every save is prefixed with a word that is not
 * part of the sentence. The glyph is decoration: the text beside it already says what happened.
 *
 * This was logged as the last open item in A11Y_FINDINGS.md and deferred with a reason — "hiding it
 * needs a span restructure at each site; best done later via one shared helper". This is that
 * helper. It was deferred rather than dropped because axe cannot see this: `aria-hidden` on a
 * decorative glyph is a judgement about MEANING, and there is no rule that fires on its absence.
 *
 * ── WHY THE GLYPH IS SPLIT OFF RATHER THAN PASSED SEPARATELY ────────────────────────────────────
 *
 * `setStatus(el, '✓ Saved')` is a one-token change at each call site. `setStatus(el, '✓',
 * 'Saved')` would have been marginally more explicit and would have required every caller that
 * composes its message (most of them — counts, names, dates) to be taken apart first. A migration
 * whose cost is proportional to the number of sites is a migration that gets done to half of them,
 * and half-done is worse here than not started: the sites left behind look identical in the source.
 *
 * The glyph vocabulary is therefore CLOSED and lives in `STATUS_GLYPHS`. A string that does not
 * start with one is passed through untouched, so `setStatus` is safe to use for any status line —
 * which is what makes "always use setStatus" a rule somebody can follow without checking.
 *
 * ── WHAT IT DELIBERATELY DOES NOT CHANGE ────────────────────────────────────────────────────────
 *
 * `el.textContent` still reads back exactly the string that was passed in, because a text node
 * inside a child span is still text content. That is not an accident — it is what let the existing
 * sites migrate without touching a single assertion, and it is worth knowing before anyone "simplifies"
 * this to `innerHTML`.
 *
 * Rendering is byte-identical: an inline span with no styling occupies the same space as the text
 * node it replaced. The visual baselines are unchanged by design, which also means they cannot
 * confirm this module is wired in — `status-text.test.mjs` is the only thing that can.
 *
 * BUTTONS ARE OUT OF SCOPE. `✓ Resolve` on a button is a stable LABEL, not a transient status: the
 * glyph is part of the control's accessible name, changing it changes what `getByRole(name:)`
 * matches, and a button is announced once on focus rather than interrupting whatever the user was
 * reading. Different problem, different risk, decided separately.
 */

/**
 * The closed set of leading status glyphs, ordered longest-first.
 *
 * `⚠️` is U+26A0 followed by the variation selector U+FE0F, so it STARTS WITH the bare `⚠` that is
 * also in this list. Matching the short form first would take one code point and leave the selector
 * at the head of the announced string — invisible in an editor, invisible in a diff, and read out
 * by some screen readers.
 *
 * Today the `rest.startsWith(' ')` guard below catches that on its own (an orphaned selector is not
 * a space, so the short match is rejected and the long one is tried next), which means the ordering
 * is belt-and-braces rather than the thing doing the work — a mutation reversing it changes no
 * behaviour. It is still stated as an invariant and pinned by `status-text.test.mjs`, because the
 * space guard is a rule about SENTENCES and could reasonably be relaxed later by someone who has no
 * idea it is quietly holding this up.
 * @type {string[]}
 */
export const STATUS_GLYPHS = ['⚠️', 'ℹ️', '✅', '⚠', 'ℹ', '✓', '✗', '↻', '⎘', '⏳'];

/**
 * Split a leading status glyph off a message.
 *
 * @param {string} text
 * @returns {{ glyph: string, rest: string }} `glyph` is '' when the string does not lead with one,
 *          in which case `rest` is the input unchanged.
 */
export function splitStatusGlyph(text) {
    const s = typeof text === 'string' ? text : String(text ?? '');
    for (const g of STATUS_GLYPHS) {
        if (!s.startsWith(g)) continue;
        // Only a glyph followed by a SPACE is decoration in front of a sentence. A message that is
        // just the glyph, or one where it runs straight into a word, is left alone — it is carrying
        // meaning on its own there, and hiding it would remove the message rather than tidy it.
        const rest = s.slice(g.length);
        if (!rest.startsWith(' ')) continue;
        return { glyph: g, rest: rest.slice(1) };
    }
    return { glyph: '', rest: s };
}

/**
 * Set a transient status message on an element, with any leading glyph hidden from screen readers.
 *
 * @param {Element|null|undefined} el
 * @param {string} text
 * @returns {void}
 */
export function setStatus(el, text) {
    if (!el) return;
    const { glyph, rest } = splitStatusGlyph(text);
    if (!glyph) { el.textContent = typeof text === 'string' ? text : String(text ?? ''); return; }
    // Built as nodes rather than an innerHTML template: `rest` routinely carries a member name, a
    // file name or an error message, and this module must not become the one place a status line
    // can inject markup.
    el.textContent = '';
    const span = el.ownerDocument.createElement('span');
    span.setAttribute('aria-hidden', 'true');
    span.textContent = glyph;
    el.appendChild(span);
    el.appendChild(el.ownerDocument.createTextNode(' ' + rest));
}
