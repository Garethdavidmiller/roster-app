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
const PAGES = ['admin.html', 'paycalc.html', 'operations.html', 'settings.html', 'links.html'];

// Comments are stripped BEFORE matching: a long explanatory comment between the `.card-header` and
// its title would otherwise push the heading past the search window and silently skip that card —
// the guard would then pass by not looking, which is worse than not existing.
const read = p => readFileSync(new URL(`./${p}`, import.meta.url), 'utf8').replace(/<!--[\s\S]*?-->/g, '');

/** Every heading that sits inside a `.card-header` block, with its tag and text. */
function cardHeadings(html) {
    /** @type {Array<{ tag: string, text: string }>} */
    const out = [];
    // `.card-header` … the first heading that follows it, before the header block's actions.
    const re = /class="[^"]*\bcard-header\b[^"]*"[\s\S]{0,400}?<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1>/g;
    let m;
    while ((m = re.exec(html)) !== null) out.push({ tag: m[1], text: m[2] });
    return out;
}

/** Strip tags/entities and any HTML comment, leaving the visible title text. */
const visible = t => t.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]*>/g, '').replace(/&[a-z]+;/g, ' ').trim();

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
