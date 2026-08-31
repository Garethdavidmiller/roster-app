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
 *  - PROVISIONAL MARKERS ARE READ, NEVER INFERRED. The marker vocabulary below mirrors what
 *    guide-sources.test.mjs pins (its per-class marker lists); the parity test asserts the two
 *    stay identical. A unit's evidence is the set of distinct states whose markers appear in its
 *    OWN slice — and a section's evidence excludes markers that live inside its child cards,
 *    because a section is not provisional merely for containing one provisional card.
 */

import { tokeniseText } from '../guide-search.js';

/** Marker classes that make a provisional claim visible — MUST mirror guide-sources.test.mjs. */
export const PROVISIONAL_MARKERS = {
    draft:       ['rr-card--draft', 'rc-unsourced'],
    conflict:    ['rr-card--conflict', 'rr-unresolved'],
    unconfirmed: ['myb-status--unconfirmed'],
};

/** Per-page card patterns: which elements are fine-grained answer units of their own. */
const CARD_RULES = {
    'railcard-guide.html': { open: /<div class="rc[^"]*" id="(rc-[a-z0-9-]+)"/g,                    close: null },
    'rangers-guide.html':  { open: /<div class="rr-(?:card|no-item)[^"]*" id="(rr-[a-z0-9-]+)"/g,   close: null },
    'fip.html':            { open: /<details id="([a-z0-9-]+)"/g,                                   close: '</details>' },
};

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
    const m = slice.match(/class="(?:rc-name|rr-name)"[^>]*>([^<]+)</)
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
    // Index only the served body — not comments, which in this repo carry design prose.
    const src = html.replace(/<!--[\s\S]*?-->/g, ' ');

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
    const rule = CARD_RULES[/** @type {keyof typeof CARD_RULES} */ (page)];
    if (rule) {
        const opens = [...src.matchAll(rule.open)];
        opens.forEach((m, i) => {
            const start = m.index ?? 0;
            let end;
            if (rule.close) {
                const c = src.indexOf(rule.close, start);
                end = c === -1 ? src.length : c;
            } else {
                const nextCard = i + 1 < opens.length ? (opens[i + 1].index ?? src.length) : src.length;
                const nextHead = heads.find(h => (h.index ?? 0) > start);
                end = Math.min(nextCard, nextHead ? (nextHead.index ?? src.length) : src.length);
            }
            cards.push({ id: m[1], start, end });
        });
    }

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

/** The five guides, in the drawer's own order. */
export const GUIDE_PAGES = ['guide.html', 'paycalc-guide.html', 'railcard-guide.html', 'rangers-guide.html', 'fip.html'];

/**
 * @param {(name: string) => string} readPage
 * @returns {import('../guide-search.js').GuideIndexUnit[]}
 */
export function buildGuideIndex(readPage) {
    return GUIDE_PAGES.flatMap(p => extractGuideUnits(readPage(p), p));
}
