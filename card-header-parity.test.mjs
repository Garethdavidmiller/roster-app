/**
 * Static guard for the canonical card-header conventions across the five card-bearing app pages
 * (v18.86). No emulator, no browser — it reads the served HTML.
 *
 * Two conventions, both of which had already drifted unnoticed because nothing enforced them:
 *
 *   1. A card title is an `h2`. operations.html marked all nine of its cards up as `h3` while the
 *      other four pages used `h2`; `shared.css` styled both identically, so it LOOKED right while
 *      the page's heading outline ran h1 → h3 with no h2 at all. axe's heading-order rule is tagged
 *      best-practice rather than WCAG A/AA, so the accessibility gate never saw it.
 *
 *   2. Every card title carries a leading emoji. "Change a Shift" — the Admin page's primary card —
 *      was the ONLY one in the app without one, so the odd one out was also the most prominent.
 *
 * Part of `npm run test:hygiene`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/** The app pages that carry `.card-header` cards. index.html has none (the calendar is a grid). */
const PAGES = ['admin.html', 'paycalc.html', 'operations.html', 'settings.html', 'links.html', 'overtime.html'];

// Comments are stripped BEFORE matching: a long explanatory comment between the `.card-header` and
// its title would otherwise push the heading past the search window and silently skip that card —
// the guard would then pass by not looking, which is worse than not existing.
const read = p => readFileSync(new URL(`./${p}`, import.meta.url), 'utf8').replace(/<!--[\s\S]*?-->/g, '');

/**
 * Every `.card-header` block, paired with the first heading that follows it (null if there is none).
 *
 * Class matching is TOKEN-exact (v18.91). The old `\bcard-header\b` test also matched
 * `class="card-header-actions"` — `-` is a non-word character, so `\b` happily sits between
 * `header` and `-actions` — which made every actions cluster look like a second card header that
 * then paired with the NEXT card's title. Splitting the class attribute on whitespace can't do that.
 */
function cardHeaderBlocks(html) {
    // Index every class attribute once, so each header's search window can be bounded by the START
    // OF THE NEXT CARD rather than a fixed character count. A fixed window was the real gap: a
    // header with no heading simply scanned on and adopted the NEXT card's title, so the guard
    // passed by not looking. Nothing inside a header block carries a bare `card`/`card-header`
    // token (the children are card-header-actions, btn-card-tips, collapse-chevron, hint), so the
    // next such token is reliably the next card.
    /** @type {Array<{ index: number, tokens: string[] }>} */
    const attrs = [];
    const re = /class="([^"]*)"/g;
    let m;
    while ((m = re.exec(html)) !== null) attrs.push({ index: m.index, tokens: m[1].split(/\s+/) });

    const isBoundary = (/** @type {string[]} */ t) => t.includes('card') || t.includes('card-header');

    /** @type {Array<{ tag: string|null, text: string }>} */
    const out = [];
    attrs.forEach((a, i) => {
        if (!a.tokens.includes('card-header')) return;
        const next = attrs.slice(i + 1).find(b => isBoundary(b.tokens));
        const end  = Math.min(next ? next.index : html.length, a.index + 4000);
        const h = /<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1>/.exec(html.slice(a.index, end));
        out.push(h ? { tag: h[1], text: h[2] } : { tag: null, text: '' });
    });
    return out;
}

/** Only the blocks that actually have a heading — for the tag/emoji conventions. */
const cardHeadings = html =>
    /** @type {Array<{ tag: string, text: string }>} */
    (cardHeaderBlocks(html).filter(b => b.tag !== null));

/** Strip tags/entities and any HTML comment, leaving the visible title text. */
const visible = t => t.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]*>/g, '').replace(/&[a-z]+;/g, ' ').trim();

// The conventions below only inspect headings that EXIST, so a `.card-header` carrying no heading at
// all slipped through both of them (v18.91). A titleless card is the worst case for the outline the
// h2 rule protects — assert every header block has one before asserting anything about it.
test('every .card-header block actually has a heading', () => {
    for (const page of PAGES) {
        const blocks = cardHeaderBlocks(read(page));
        assert.ok(blocks.length > 0, `${page}: expected at least one .card-header block`);
        const missing = blocks.filter(b => b.tag === null).length;
        assert.equal(missing, 0,
            `${page}: ${missing} of ${blocks.length} .card-header blocks have no heading — every card needs a title`);
    }
});

test('every card title is an h2 (no skipped heading levels)', () => {
    for (const page of PAGES) {
        const headings = cardHeadings(read(page));
        assert.ok(headings.length > 0, `${page}: expected at least one .card-header heading`);
        const wrong = headings.filter(h => h.tag !== 'h2').map(h => `${h.tag}: ${visible(h.text)}`);
        assert.deepEqual(wrong, [], `${page} must use h2 for card titles, found → ${wrong.join(' · ')}`);
    }
});

test('every card title leads with an emoji', () => {
    // Pictographic + regional-indicator ranges; the flag emoji used by the guides is a pair of
    // regional indicators, so include those too.
    const LEADING_EMOJI = /^(\p{Extended_Pictographic}|\p{Regional_Indicator})/u;
    for (const page of PAGES) {
        const bare = cardHeadings(read(page))
            .map(h => visible(h.text))
            .filter(t => t && !LEADING_EMOJI.test(t));
        assert.deepEqual(bare, [],
            `${page}: card titles must lead with an emoji (the app-wide convention) → ${bare.join(' · ')}`);
    }
});
