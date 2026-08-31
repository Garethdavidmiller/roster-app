// @ts-check
/**
 * guide-search.js — the PURE rules of cross-guide search: how a query becomes tokens, how tokens
 * match the generated index, and what a result is allowed to say.
 *
 * Why this module exists at all: five guides answer overlapping questions ("someone has a Network
 * Railcard", "is a Thames Rover any good here?", "can FIP reach Eurostar?"), and a member usually
 * knows the TERM, not which guide owns it. Search is the drawer's answer — but only if three rules
 * hold, and each is the kind an innocent edit can quietly break:
 *
 *   1. EVIDENCE STATE PASSES THROUGH UNTOUCHED. A guide claim can be provisional — a source
 *      conflict, an unread source (draft), an unconfirmed claim — and the guides go to lengths to
 *      keep those states distinct (guide-sources.test.mjs pins the marker vocabulary). A search
 *      result that flattened "⚠ source conflict" into an ordinary-looking row would launder doubt
 *      the page itself declares, at the exact moment somebody is deciding at a gateline. Results
 *      therefore carry the index's evidence list VERBATIM — never summarised into a worst state,
 *      never dropped under a display cap.
 *
 *   2. ONE TOKENISER, SHARED. The index generator (scripts/generate-guide-index.mjs) imports
 *      `tokeniseText` from HERE. If query and index tokenised differently — one folding case or
 *      punctuation the other keeps — a term would exist in the index and be unfindable by the box,
 *      with nothing failing anywhere.
 *
 *   3. A CARD BEATS ITS OWN SECTION. Cards (a railcard, a rover, a country) are also inside an
 *      h2 section the index carries, so both match the same words. Returning both reads as two
 *      answers to one question; the section row is the vaguer one and buries the card rows below
 *      it. When a result's id is another result's parent, the parent is dropped.
 *
 * Matching is AND across tokens (every query token must hit the unit), with the LAST token treated
 * as a prefix — the query is usually mid-keystroke ("euro" → Eurostar). Title hits outrank
 * body hits; ties keep index order, which is page order, which is the guides' own editorial order.
 *
 * Pure — no DOM, no imports. Tested by guide-search.test.mjs (test:hygiene); the index it runs
 * over is pinned to the guide HTML by guide-index-parity.test.mjs.
 */

/** Minimum characters for a token. One-letter fragments match half the corpus and rank noise. */
const MIN_TOKEN_LEN = 2;

/**
 * Lower-case, strip accents, split on anything that is not a letter or digit, drop short
 * fragments, dedupe. The ONE tokeniser — the generator imports this; see rule 2 above.
 * @param {string} text
 * @returns {string[]} unique tokens, first-seen order
 */
export function tokeniseText(text) {
    if (typeof text !== 'string' || !text) return [];
    const folded = text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
    const out = [];
    const seen = new Set();
    for (const raw of folded.split(/[^a-z0-9]+/)) {
        if (raw.length < MIN_TOKEN_LEN || seen.has(raw)) continue;
        seen.add(raw);
        out.push(raw);
    }
    return out;
}

/**
 * @typedef {object} GuideIndexUnit
 * @property {string} page  guide filename, e.g. "railcard-guide.html"
 * @property {string} id    anchor id within the page
 * @property {string} t     display title
 * @property {string} tt    title tokens, space-joined
 * @property {string} k     body tokens, space-joined
 * @property {string[]} e   provisional evidence states declared by the page ([] when none)
 * @property {string|null} p enclosing section id, for parent suppression
 */

/**
 * @typedef {object} GuideSearchResult
 * @property {string} page
 * @property {string} id
 * @property {string} title
 * @property {string[]} evidence  verbatim from the index — see rule 1 in the header
 * @property {number} score
 */

/**
 * Search the generated index.
 *
 * @param {GuideIndexUnit[]} index
 * @param {string} query
 * @param {{limit?: number}} [opts]
 * @returns {GuideSearchResult[]} ranked, parent-suppressed, capped at limit
 */
export function searchGuideIndex(index, query, { limit = 12 } = {}) {
    const qTokens = tokeniseText(query);
    if (!qTokens.length || !Array.isArray(index)) return [];

    /** @type {(GuideSearchResult & {p: string|null, order: number})[]} */
    const hits = [];
    index.forEach((unit, order) => {
        const titleTokens = (unit.tt || '').split(' ');
        const bodyTokens  = (unit.k  || '').split(' ');
        let score = 0;
        for (let i = 0; i < qTokens.length; i++) {
            const q = qTokens[i];
            const isLast = i === qTokens.length - 1;
            const inTitle = isLast ? titleTokens.some(t => t.startsWith(q)) : titleTokens.includes(q);
            const inBody  = isLast ? bodyTokens.some(t => t.startsWith(q))  : bodyTokens.includes(q);
            if (!inTitle && !inBody) { score = -1; break; }   // AND: one miss refuses the unit
            score += inTitle ? 3 : 1;
        }
        if (score < 0) return;
        hits.push({
            page: unit.page, id: unit.id, title: unit.t,
            evidence: Array.isArray(unit.e) ? unit.e.slice() : [],
            score, p: unit.p ?? null, order,
        });
    });

    // A card beats its own section (rule 3): drop any hit that is the PARENT of another hit.
    const hitIds = new Set(hits.map(h => `${h.page}|${h.id}`));
    const kept = hits.filter(h => !hits.some(o => o.p && o.page === h.page && o.p === h.id && hitIds.has(`${o.page}|${o.id}`)));

    kept.sort((a, b) => b.score - a.score || a.order - b.order);
    return kept.slice(0, limit).map(({ p: _p, order: _o, ...r }) => r);
}
