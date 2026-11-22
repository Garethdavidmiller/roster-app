// @ts-check
/**
 * guide-index-lib.mjs — HOW the guide-search index is read out of the five guide pages.
 *
 * Shared by scripts/generate-guide-index.mjs (writes the committed guide-index.js) and
 * guide-index-parity.test.mjs (regenerates in memory and diffs against the committed file, so the
 * index cannot go stale against the HTML without CI saying so — the roster-members.json
 * discipline). Extraction is deliberately REGEX-STRUCTURAL, like the repo's other static guards:
 * no DOM, no dependency, and it fails loudly on shapes it does not recognise rather than guessing.
 *
 * Two contracts worth naming:
 *
 *  - EVERY h2 IN EVERY GUIDE MUST CARRY AN id. Sections are deep-link targets; an id-less h2 is a
 *    section search can see but never navigate to, which reads as a broken result. extract() throws
 *    on one, so a future section added without an id fails the parity test rather than shipping.
 *
 *  - AN EXAMPLE IS NOT AN ANSWER. An element marked `data-gs-example` is dropped before anything
 *    is extracted, so its words never become a unit's tokens. It exists for one shape and the shape
 *    is self-inflicted: the Staff Guide's own "Search the guides" tip names two things to try, and
 *    naming them put those phrases into the index. Every hit for `boxing day` scored the same (a
 *    body match is worth 1), ties break on index order, and the Staff Guide is indexed first — so
 *    the top result for the query the guide TELLS you to type was the paragraph telling you to type
 *    it, ahead of the Boxing Day pay rows in the Pay Calculator Guide. Same principle as the key
 *    legend below ("a definition is not a claim"), one level up: this drops the text outright
 *    rather than only from the evidence scan, because a definition can still be an answer and an
 *    example of a search never is.
 *
 *  - PROVISIONAL MARKERS ARE READ, NEVER INFERRED. The draft and conflict lists below are
 *    guide-sources.test.mjs's own per-class marker lists (its `PROVISIONAL`), copied because
 *    importing a test file would run its tests. Contract 3 of guide-index-parity.test.mjs reads
 *    that list out of the file and holds the two equal in BOTH directions: a marker guide-sources
 *    gains and this file lacks leaves a provisional claim unflagged in the drawer. While the check
 *    ran one way only, the FIP guide's conflict callout went unflagged for exactly that reason.
 *    `unconfirmed` has no list there: it is the Rangers guide's Marylebone badge, which
 *    guide-sources polices as a badge, so contract 3 checks that the badge is real. A unit's
 *    evidence is the set of distinct states whose markers appear in its OWN slice — and a
 *    section's evidence excludes markers that live inside its child cards, because a section is
 *    not provisional merely for containing one provisional card.
 */

import { tokeniseText } from '../guide-search.js';
import { GUIDE_PAGES as GUIDE_PAGE_ENTRIES } from './app-pages.mjs';

/** Marker classes that make a provisional claim visible — the same lists as guide-sources.test.mjs (header). */
export const PROVISIONAL_MARKERS = {
    draft:       ['rr-card--draft', 'rc-unsourced'],
    conflict:    ['rr-card--conflict', 'rr-unresolved', 'fip-unresolved'],
    unconfirmed: ['myb-status--unconfirmed'],
};

/**
 * Per-page card rules: which elements are fine-grained answer units of their own.
 *
 * A rule names a TAG and tests the element's id and class list — never the order its attributes are
 * written in. These were once regexes that spelled the attributes out in sequence (`class` then `id`
 * on the Railcard and Rangers cards, `id` then `class` on the FIP ones), and writing the Gold Card's
 * `id` before its `class` dropped it from the search with every test green: the pattern stopped
 * matching, and an unmatched card is not an error. guide-index-parity.test.mjs (contract 10) also
 * checks, by a scan of its own, that every such card IS a unit.
 * @type {Record<string, Array<{ tag: string, id: RegExp, cls?: string[], close: string|null }>>}
 */
const CARD_RULES = {
    'railcard-guide.html': [{ tag: 'div', cls: ['rc'], id: /^rc-[a-z0-9-]+$/, close: null }],
    'rangers-guide.html':  [{ tag: 'div', cls: ['rr-card', 'rr-no-item'], id: /^rr-[a-z0-9-]+$/, close: null }],
    'fip-guide.html': [
        { tag: 'details', id: /^[a-z0-9-]+$/, close: '</details>' },
        // The "No FIP operator listed" cards are plain divs, not <details>. Read by the details rule
        // alone, Sweden and Finland were never units, so "sweden" in the drawer found Denmark's card
        // and "finland" the top of the countries section (whole-app check, 10 November 2026).
        { tag: 'div', cls: ['not-fip-card'], id: /^country-[a-z]+$/, close: null },
    ],
};

/**
 * One attribute's value out of an opening tag's attribute text, wherever in the tag it is written.
 * Anchored to whitespace, so `data-id="…"` is not read as `id`.
 * @param {string} attrs @param {string} name @returns {string|null}
 */
function attrOf(attrs, name) {
    const m = attrs.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`));
    return m ? m[1] : null;
}

/**
 * Where each element a card rule names opens, and its id, in document order.
 * @param {string} src @param {{ tag: string, id: RegExp, cls?: string[] }} rule
 * @returns {{ index: number, id: string }[]}
 */
function cardOpenings(src, rule) {
    /** @type {{ index: number, id: string }[]} */
    const out = [];
    for (const m of src.matchAll(new RegExp(`<${rule.tag}\\b([^>]*)>`, 'g'))) {
        const id = attrOf(m[1], 'id');
        if (!id || !rule.id.test(id)) continue;
        const classes = (attrOf(m[1], 'class') || '').split(/\s+/);
        if (rule.cls && !rule.cls.some(c => classes.includes(c))) continue;
        out.push({ index: m.index ?? 0, id });
    }
    return out;
}

/** @param {string} html strip tags + entities to visible text */
function textOf(html) {
    return html
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        // Common entities become their character — a title like "Amsterdam &amp; Cologne" must not
        // lose its ampersand. Anything unrecognised becomes a space rather than surviving as markup.
        .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&(?:mdash|#8212);/g, '—')
        .replace(/&(?:ndash|#8211);/g, '–').replace(/&(?:rsquo|#8217);/g, '\u2019')
        .replace(/&(?:lsquo|#8216);/g, '\u2018').replace(/&(?:hellip|#8230);/g, '…')
        .replace(/&[a-z]+;|&#\d+;/gi, ' ');
}

/** Title of a card slice: the first name-bearing element this repo's guides actually use. */
function cardTitle(slice) {
    const m = slice.match(/class="(?:rc-name|rr-name|not-fip-name)"[^>]*>([^<]+)</)
        || slice.match(/class="rr-no-name"><span>(?:<span[^>]*>[^<]*<\/span>)?\s*([^<]+)</)
        || slice.match(/<summary>([\s\S]*?)<\/summary>/);
    if (!m) return null;
    return textOf(m[1]).replace(/[▾]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Distinct provisional states DECLARED in the slice. The key legend (the `<div class="key">` block) is blanked
 * first: it teaches the marker vocabulary with example markers, and a definition is not a claim —
 * without this the Rangers quick-reference section read as `unconfirmed` because its legend showed
 * what the ⚠ Check marker looks like. Pinned by guide-index-parity.test.mjs.
 * @param {string} slice @returns {string[]}
 */
function evidenceOf(slice) {
    const scanned = slice.replace(/<div class="key"[\s\S]*?<\/div>/g, ' ');
    const out = [];
    for (const [state, classes] of Object.entries(PROVISIONAL_MARKERS)) {
        if (classes.some(c => scanned.includes(c))) out.push(state);
    }
    return out;
}

/**
 * Extract index units from one guide page.
 * @param {string} html
 * @param {string} page  basename, e.g. "railcard-guide.html"
 * @returns {import('../guide-search.js').GuideIndexUnit[]}
 */
export function extractGuideUnits(html, page) {
    // Index only the served body — not comments, which in this repo carry design prose, and not
    // anything marked `data-gs-example` (see header). Dropped from `src` itself, before sections or
    // cards are located, so the exclusion cannot be reintroduced by whichever slice happens to
    // contain it.
    const src = html
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<(\w+)[^>]*\bdata-gs-example\b[^>]*>[\s\S]*?<\/\1>/g, ' ');

    if (/<h2(?![^>]*\bid=)[^>]*>/.test(src)) {
        throw new Error(`${page}: an <h2> without an id — sections must be deep-linkable`);
    }

    // Section boundaries: every h2-with-id, to the next h2 or end of file.
    const heads = [...src.matchAll(/<h2[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/h2>/g)];
    /** @type {{id: string, title: string, start: number, end: number}[]} */
    const sections = heads.map((m, i) => ({
        id: m[1],
        title: textOf(m[2]).replace(/\s+/g, ' ').trim(),
        start: m.index ?? 0,
        end: i + 1 < heads.length ? (heads[i + 1].index ?? src.length) : src.length,
    }));

    // Card boundaries: pattern open → explicit close tag, or the next card/section boundary.
    /** @type {{id: string, start: number, end: number}[]} */
    const cards = [];
    const rules = CARD_RULES[/** @type {keyof typeof CARD_RULES} */ (page)] || [];
    // Every card start on the page, whichever rule found it: an open-ended card runs to the next one.
    const allStarts = rules.flatMap(r => cardOpenings(src, r).map(o => o.index)).sort((a, b) => a - b);
    for (const rule of rules) {
        for (const o of cardOpenings(src, rule)) {
            const start = o.index;
            let end;
            if (rule.close) {
                const c = src.indexOf(rule.close, start);
                end = c === -1 ? src.length : c;
            } else {
                const nextCard = allStarts.find(s => s > start) ?? src.length;
                const nextHead = heads.find(h => (h.index ?? 0) > start);
                end = Math.min(nextCard, nextHead ? (nextHead.index ?? src.length) : src.length);
            }
            cards.push({ id: o.id, start, end });
        }
    }
    cards.sort((a, b) => a.start - b.start);

    /** @type {import('../guide-search.js').GuideIndexUnit[]} */
    const units = [];
    const parentOf = (/** @type {number} */ pos) => {
        const s = [...sections].reverse().find(sec => sec.start <= pos);
        return s ? s.id : null;
    };

    for (const sec of sections) {
        let slice = src.slice(sec.start, sec.end);
        // Blank child-card slices out of the SECTION's evidence scan (see header) — but keep their
        // text in the section's tokens, so a query spanning two cards can still land on the section.
        let evidenceSlice = slice;
        for (const c of cards) {
            if (c.start >= sec.start && c.start < sec.end) {
                evidenceSlice = evidenceSlice.replace(src.slice(c.start, c.end), ' ');
            }
        }
        const bodyTokens = tokeniseText(textOf(slice));
        const titleTokens = tokeniseText(sec.title);
        units.push({
            page, id: sec.id, t: sec.title,
            tt: titleTokens.join(' '),
            k: bodyTokens.filter(t => !titleTokens.includes(t)).join(' '),
            e: evidenceOf(evidenceSlice), p: null,
        });
    }

    for (const c of cards) {
        const slice = src.slice(c.start, c.end);
        const title = cardTitle(slice);
        if (!title) throw new Error(`${page}: card #${c.id} has no recognisable title element`);
        const titleTokens = tokeniseText(title);
        units.push({
            page, id: c.id, t: title,
            tt: titleTokens.join(' '),
            k: tokeniseText(textOf(slice)).filter(t => !titleTokens.includes(t)).join(' '),
            e: evidenceOf(slice), p: parentOf(c.start),
        });
    }

    return units;
}

/** The guides, in the drawer's own order — from scripts/app-pages.mjs, the one page list (v24.52). */
export const GUIDE_PAGES = GUIDE_PAGE_ENTRIES.map(p => p.file);

/**
 * @param {(name: string) => string} readPage
 * @returns {import('../guide-search.js').GuideIndexUnit[]}
 */
export function buildGuideIndex(readPage) {
    return GUIDE_PAGES.flatMap(p => extractGuideUnits(readPage(p), p));
}
