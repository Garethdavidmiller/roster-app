// @ts-check
/**
 * overflow-hint.js — A "SWIPE THE TABLE" LINE THAT IS TRUE: shown only while its table really
 * scrolls sideways.
 *
 * Owns: the one rule for when such a line shows (its scroll box wider inside than out, by more than
 *   a rounding pixel) and the watch that applies it again whenever the box or its table changes size.
 * Does NOT own: the line's words, where it sits, or retiring it for good once the reader has swiped
 *   (calendar-team-view.js keeps that; the Trains grid has none). Nor whether it is a TOUCH line:
 *   `touch-only` decides that, and this only ever hides what that would show.
 *
 * `touch-only` shows a line on any coarse pointer, so a tablet, a phone on its side or a touch
 * laptop, where the table fits, was told to swipe a table that does not move (desktop audit
 * follow-up, Nov 2026). Team view's week was the first case; the Trains grid was the second, where a
 * screen-width cut-off at 700px stood in for the measurement and was wrong below it — measured at
 * 600 and 699px wide, 10 of the 12 day-and-timetable grids fitted, and every one still showed the
 * line. A width can only guess at a table whose width depends on its data; the box knows.
 *
 * Measured as the table is drawn, so the line never arrives showing, and again whenever the box or
 * its table changes size (a rotation, a resized window, the typeface arriving), which one
 * measurement could not see. The line's `hidden` needs a companion `[hidden] { display: none }`
 * rule in the page's stylesheet, because `.touch-only` sets `display` and wins over the attribute.
 * Tested by overflow-hint.test.mjs; each page's wiring by its own e2e spec.
 */

/**
 * Show `hint` only while `wrap` scrolls sideways, now and after every later change of size.
 * @param {HTMLElement|null} wrap  the table's scroll box
 * @param {HTMLElement|null} hint  the line
 * @returns {ResizeObserver|null}  the watch, for the caller to disconnect when the table goes; null
 *   when there is nothing to watch, or no ResizeObserver to watch with (it was measured once)
 */
export function watchOverflowHint(wrap, hint) {
    if (!wrap || !hint) return null;
    const fit = () => { hint.hidden = wrap.scrollWidth <= wrap.clientWidth + 1; };
    fit();
    if (typeof ResizeObserver !== 'function') return null;
    // A frame later, not inside the callback: showing or hiding the line can resize the very box
    // being watched (below 1024px a short Team view grade's box grows into the space it leaves), and
    // a size change made inside an observer's callback is reported as a "loop" error.
    const watch = new ResizeObserver(() => requestAnimationFrame(fit));
    watch.observe(wrap);
    const table = wrap.querySelector('table');
    if (table) watch.observe(table);
    return watch;
}
