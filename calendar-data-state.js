// @ts-check
/**
 * calendar-data-state.js — what the Calendar KNOWS about a month's overrides, and what it is
 * therefore allowed to show.
 *
 * ── THE INVARIANT ──────────────────────────────────────────────────────────────────────────────
 *
 *   Cache absence is not evidence that no override exists.
 *
 * That sentence is the whole module. The Calendar's base roster is a rotating pattern computed
 * locally, so it can always be drawn instantly — and it is WRONG for anybody with annual leave, an
 * absence, a changed shift or an RDW. Those live only in Firestore. Drawing the base roster before
 * the override state is known produces a page that looks finished and is lying: a member on leave
 * sees the shift they are not working, in the app's own house style, with no indication that
 * anything is outstanding.
 *
 * Before v20.40 that is exactly what happened on a fresh browser — `_startCalendarWorkspace()`
 * started the three-month fetch and then rendered synchronously. The two-phase load (v19.01) covers
 * a RETURNING device, because phase 1 paints from the local Firestore cache; a device with no cache
 * has nothing to paint from, so the base roster went up while the authoritative read was in flight.
 * `.calendar-fetching` shimmers the cells, which reads as *loading*, not as *this may be wrong* —
 * the times underneath stay perfectly legible. And on a FAILED read the base roster simply stayed,
 * beside a "Couldn't update" chip, indefinitely.
 *
 * ── FOUR STATES, AND WHY NOT THREE ─────────────────────────────────────────────────────────────
 *
 *   unknown        nobody has looked. NOT the same as "no overrides" — this is the state the old
 *                  code conflated with "clear", and the conflation is the bug.
 *   cached         we hold a previously-known effective state for this month. Usable, but it may
 *                  have been superseded, so it must be LABELLED rather than presented as current.
 *   authoritative  a server read settled for this month. This is the only state that may be shown
 *                  as current.
 *   error          a read was attempted and failed. Distinct from `unknown` because the user can
 *                  act on it: it earns a Retry, where `unknown` only earns a wait.
 *
 * Collapsing `cached` into `authoritative` loses the staleness warning; collapsing `error` into
 * `unknown` loses the Retry. Both collapses look harmless and remove the two things a person
 * standing at a barrier or reading their shift on a phone actually needs.
 *
 * ── DELIBERATELY PURE ──────────────────────────────────────────────────────────────────────────
 *
 * No DOM, no Firebase, no imports. The decision is the part worth testing exhaustively and the part
 * that must not drift, so it lives where a Node test can reach every branch without a browser. The
 * wiring — who calls it, and what gets painted — stays in the modules that already own those jobs
 * (`calendar-overrides.js` records, `calendar-app.js` paints), per the audit's instruction not to
 * grow the coordinator.
 */

/** @typedef {'unknown'|'cached'|'authoritative'|'error'} Knowledge */

/** How well each month's override state is known. Keyed by `monthKey(year, month)`. */
const _knowledge = new Map();

/**
 * Rank a knowledge state. Higher is better-known.
 *
 * `error` outranks `unknown` deliberately: both mean "not current", but an error is a state the
 * user can DO something about, and a month that failed must not be downgraded to "still waiting" by
 * a later no-op. It stays below `cached` because holding real data always beats holding none.
 * @param {Knowledge} k
 * @returns {number}
 */
function rank(k) {
    return k === 'authoritative' ? 3 : k === 'cached' ? 2 : k === 'error' ? 1 : 0;
}

/**
 * Record what is now known about a month — but never FORGET something better.
 *
 * Monotonic on purpose. Several things race here: the three-month boot fetch, a per-month navigation
 * fetch, and a manual retry can all be outstanding at once, and they settle in any order. A late
 * `cached` landing after an `authoritative` must not walk the month backwards and re-hide a grid the
 * user is already reading — the same class of bug as the stale-snapshot cache eviction the audit
 * describes, one level up. Downgrading is only ever done explicitly, by `forget()`.
 * @param {string[]|string} keys one or more `monthKey` values
 * @param {Knowledge} k
 */
export function noteKnowledge(keys, k) {
    for (const key of Array.isArray(keys) ? keys : [keys]) {
        const cur = /** @type {Knowledge} */ (_knowledge.get(key) || 'unknown');
        if (rank(k) >= rank(cur)) _knowledge.set(key, k);
    }
}

/**
 * Drop what was known about a month, so the next navigation re-reads it.
 * The one legitimate downgrade: used when access is lost, where continuing to show a roster the
 * session is no longer entitled to read would be worse than showing nothing.
 * @param {string[]|string} [keys] omit to forget everything
 */
export function forget(keys) {
    if (keys === undefined) { _knowledge.clear(); return; }
    for (const key of Array.isArray(keys) ? keys : [keys]) _knowledge.delete(key);
}

/**
 * What is known about this month?
 * @param {string} key
 * @returns {Knowledge}
 */
export function knowledgeOf(key) {
    return /** @type {Knowledge} */ (_knowledge.get(key) || 'unknown');
}

/**
 * The WORST knowledge across a set of months — because a view is only as trustworthy as its
 * least-known month.
 *
 * This is what makes Team View correct rather than approximately correct: a week straddling two
 * months is one surface, and if either month is unknown the whole week is. Returning the best, or
 * the first, would let a half-known week render as though it were settled.
 * @param {string[]} keys
 * @returns {Knowledge}
 */
export function worstKnowledge(keys) {
    if (!keys.length) return 'unknown';
    /** @type {Knowledge} */
    let worst = 'authoritative';
    for (const key of keys) {
        const k = knowledgeOf(key);
        if (rank(k) < rank(worst)) worst = k;
    }
    return worst;
}

/**
 * What may the Calendar show, given what it knows?
 *
 *   'render'      the grid, as current
 *   'stale'       the grid, explicitly labelled as possibly out of date, with a retry
 *   'loading'     no grid — a wait state, because we do not yet know enough to draw one
 *   'unavailable' no grid — a failure the user can retry
 *
 * The two no-grid outcomes are the point of the whole module, and they are the ones under pressure
 * from every instinct about perceived performance. An instant grid is worth nothing if it shows a
 * shift somebody is not working.
 * @param {Knowledge} knowledge
 * @returns {'render'|'stale'|'loading'|'unavailable'}
 */
export function decideDisplay(knowledge) {
    if (knowledge === 'authoritative') return 'render';
    if (knowledge === 'cached')        return 'stale';
    if (knowledge === 'error')         return 'unavailable';
    return 'loading';
}

/**
 * Is this display state one in which an actual ROSTER is on screen?
 *
 * The question the page-ready metric asks, and it lives here rather than in a coordinator because
 * it is a statement about the four states above, not about any page. `render` and `stale` are both
 * real grids — one current, one labelled last-known — and both are a roster a member can read.
 * `loading` and `unavailable` are a withheld grid, which is this module working correctly and is
 * the opposite of usable.
 *
 * It matters because the metric that got this wrong was wrong in the flattering direction: timing
 * the moment the Calendar finished deciding it had nothing to show, most often on the slowest
 * loads, so the figure could not be read in either direction.
 * @param {'render'|'stale'|'loading'|'unavailable'} display
 * @returns {boolean}
 */
export function showsRoster(display) { return display === 'render' || display === 'stale'; }

/** Test seam — the module holds process-wide state, so a suite must be able to reset it. */
export function _reset() { _knowledge.clear(); }
