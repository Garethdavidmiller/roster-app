// @ts-check
/**
 * trains-status.js — what a screen reader is told on trains.html: ONE short line per press, in #trStatus — and Find
 * a train's answer, its first lines only, in #trLookupStatus (`sayLookup`).
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
 * once typing in the station box pauses, unless a station has been chosen meanwhile; proven by e2e/trains.spec.js ("a screen reader is told…").
 */

/** @typedef {import('./trains-cards.js').PageState} PageState */

/** The lookup's line last given to #trLookupStatus. */
let lookupSaid = '';

/**
 * Find a train's answer, said in its own line (#trLookupStatus) as the cards' is in #trStatus: the answer itself
 * was a live region, read out whole — every train and stop — on each change, and each minute while "the next
 * train" follows the clock. Called after every lookup (trains-cards.js → `renderLookup`); the same line again,
 * as on a minute that moved nothing, is not said.
 */
export function sayLookup() {
    const line = lookupLine();
    if (line === lookupSaid) return;
    lookupSaid = line;
    const status = document.getElementById('trLookupStatus');
    if (status) status.textContent = line;
}

/** A block's words as a sentence: a full stop added where it has no stop of its own. @param {string} s */
const sentence = (s) => !s || /[.:?]$/.test(s) ? s : `${s}.`;

/**
 * The lookup's answer in a few sentences, from the words on screen: an ended timetable, words the box did not read,
 * the Christmas lines, the question asked, and the answer — the first train's line and when it gets there, never its
 * stops. With no train left that day, the next day's first is said too. With no answer, the box's first line
 * ("No station matches…", how to type a time).
 * @returns {string}
 */
export function lookupLine() {
    const box = document.getElementById('trLookupResult');
    if (!box) return '';
    const kids = [...box.children];
    const at = kids.findIndex(n => n.matches('.tr-answer'));
    // A journey with no train left that day answers in a sentence, and the next day's first train (or "None tomorrow
    // either") follows it: said too, as what the reader is waiting for.
    const after = box.querySelector(':scope > .tr-jr-meta') ? kids[at + 1] : undefined;
    const end = at < 0 || kids[at].matches('.tr-jr-first') ? at
        : after?.matches('.tr-jr-ask') ? Math.max(at, kids.findIndex((n, k) => k > at && n.matches('.tr-jr-first')))
        : after?.matches('.tr-lead') ? at + 1 : at;
    const lines = at < 0 ? [...kids.filter(n => n.matches('.tr-ended')), kids.find(n => n.matches('p:not(.tr-ended)'))]
        : kids.slice(0, end + 1).filter((n, k) => k === at || k === end || n.matches('.tr-lead, .tr-unread, .tr-festive, .tr-jr-ask'));
    // A train's own lines, one sentence each — its stops are on tap, not read; of the Christmas line, its first sentence.
    return lines.flatMap(n => !n ? [] : n.matches('.tr-jr-first') ? [...n.querySelectorAll('.tr-jr-line, .tr-jr-arr')]
        : n.matches('.tr-festive') ? [n.querySelector('strong')] : [n])
        .map(n => sentence(wordsOf(n, 'details, .sr-only'))).filter(Boolean).join(' ');
}

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

/**
 * How many stations the typed search offers — '' while the box is empty — or null, say nothing, once the picker
 * has folded away under a chosen station. Enter or a chip inside the typing pause left the count to be said after
 * the card's own line, and "1 station to choose from: Amersham" replaced it (24-hour check, 22 Nov 2026).
 * @returns {string|null}
 */
export function matchesLine() {
    // …or under a section that has been left: another tab hides the whole Stations view, not the picker, so
    // a count due inside the pause replaced the new tab's own line (external review of v26.55). `closest`
    // tests the picker itself too.
    if (document.getElementById('trStationPicker')?.closest('[hidden]')) return null;
    if (!(/** @type {HTMLInputElement|null} */ (document.getElementById('trStationInput'))?.value.trim())) return '';
    const chips = /** @type {HTMLElement[]} */ ([...document.querySelectorAll('#trStationPicks button[data-station]')]);
    return chips.length === 1 ? `1 station to choose from: ${chips[0].textContent}`
        : chips.length ? `${chips.length} stations to choose from` : 'No station matches that.';
}
