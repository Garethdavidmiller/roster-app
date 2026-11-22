// @ts-check
/**
 * trains-status.js — what a screen reader is told on trains.html: ONE short line per press, in #trStatus.
 *
 * ── ONE LINE, NOT THE CARDS (Trains review, 22 Nov 2026) ────────────────────────────────────────
 *
 * The changes list and the station card were live regions themselves, so every press that redrew one
 * read the whole card out — a dozen headlines, or a station's figures and every train — before the
 * member could move on. They are quiet now, and #trStatus says in one line what the press changed:
 * the list's day, the station's journey and its answer, the grid's chosen train, how many stations a
 * search offers.
 *
 * Each line is made of the WORDS ALREADY ON SCREEN (trains-render.js writes them, phase by phase), so
 * it turns with the page at 13 December and after, and has no wording of its own to fall out of date —
 * except the station count, which says only what the chips show.
 *
 * The first line is RECORDED, NOT SAID: the page opening is not a change. A redraw that changes
 * nothing (the tab coming back into view) says nothing, because the line is the same.
 *
 * trains-app.js calls `announce(statusLine(state))` after every draw, and `announce(matchesLine())`
 * once typing in the station box pauses; proven by e2e/trains.spec.js ("a screen reader is told…").
 */

/** @typedef {import('./trains-cards.js').PageState} PageState */

/** The line last given to #trStatus; null until the first draw, which is recorded and not said. @type {string|null} */
let said = null;

/** Say `line`, once: the same line again (a redraw that changed nothing) is not said again. @param {string} line */
export function announce(line) {
    if (said === null) { said = line; return; }
    if (line === said) return;
    said = line;
    const status = document.getElementById('trStatus');
    if (status) status.textContent = line;
}

/** An element's words, without any part `drop` names, as one line. @param {Element|null} node @param {string} [drop] */
function wordsOf(node, drop = '') {
    if (!node) return '';
    const copy = /** @type {Element} */ (node.cloneNode(true));
    if (drop) for (const gone of copy.querySelectorAll(drop)) gone.remove();
    return (copy.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** What the view on screen now says, in one line. @param {PageState} state @returns {string} */
export function statusLine(state) {
    if (state.view === 'changes') return wordsOf(document.getElementById('trChangesHint'));
    if (state.view === 'grid') {
        // A chosen train says which it is ("Only where the :06 to Oxford stops."); otherwise the grid's day and what it shows.
        const focus = document.querySelector('#trPattern .tr-grid-focus');
        return focus ? wordsOf(focus, 'button') : wordsOf(document.getElementById('trPatternHint'));
    }
    if (!state.station) return '';
    // The journey as the subtitle draws it, spoken ("London Marylebone to Amersham"), then the answer's first line.
    const journey = wordsOf(document.getElementById('trStationHint')).replace(/\s*→\s*/g, ' to ').replace(/\s*·\s*/g, ', ');
    const answer = wordsOf(document.querySelector('#trStation .tr-verdict'), '.tr-verdict-also');
    return answer ? `${journey}. ${answer}` : journey;
}

/** How many stations the typed search offers — '' while the box is empty. @returns {string} */
export function matchesLine() {
    if (!(/** @type {HTMLInputElement|null} */ (document.getElementById('trStationInput'))?.value.trim())) return '';
    const chips = /** @type {HTMLElement[]} */ ([...document.querySelectorAll('#trStationPicks button[data-station]')]);
    return chips.length === 1 ? `1 station to choose from: ${chips[0].textContent}`
        : chips.length ? `${chips.length} stations to choose from` : 'No station matches that.';
}
