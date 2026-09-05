// @ts-check
/**
 * admin-deep-link.js — WHERE A HASH ON admin.html ACTUALLY LANDS.
 *
 * Admin is a page of folded cards, so arriving at `admin.html#something` is only useful if the
 * thing named is UNFOLDED when you get there. That was true while every deep link named a whole
 * card: open the card's own body, scroll to it, done.
 *
 * It stopped being true at v22.91, when the Calendar's day panel gained a "View leave dates" action
 * pointing at the **Recorded Annual Leave dates** box — which is not a card but a box INSIDE one,
 * with a fold of its own. Two things then went wrong at once, and both were silent:
 *
 *   · the containing card was never opened, because the old code looked for a collapsible INSIDE
 *     the target rather than around it, so the link scrolled to an element with no height; and
 *   · even with the card open, the box's own fold stayed shut, so the link landed on a page where
 *     the thing it named was still folded away.
 *
 * A button that appears to do nothing is worse than no button, so this owns the answer.
 *
 * ── IT DECIDES; THE CALLER PAINTS ──────────────────────────────────────────────────────────────
 *
 * `resolveDeepLink` returns WHICH folds to open and WHAT to scroll to. It opens nothing and scrolls
 * nothing — `admin-app.js` already owns `openCollapsibleCard`, which keeps `aria-expanded` in step,
 * and a second opener would be a second place for that to be forgotten. Taking `doc` as an argument
 * is what lets the whole decision run against a fake document in Node.
 *
 * ── THREE THINGS NOT TO "TIDY" ─────────────────────────────────────────────────────────────────
 *
 *   1. **`NESTED_DEEP_LINKS` is an explicit map, not a guessed selector.** These boxes do not share
 *      the card body's class (`.al-booked-body` against `.card-collapsible-body` — the same
 *      mechanism, different padding), and a link that opens the WRONG fold is worse than one that
 *      opens none. The same shape, and the same reason, as `DEEP_LINK_CARDS` on operations.html.
 *   2. **A nested target scrolls to its CARD, not to itself.** The box carries `hidden` until its
 *      own async render un-hides it, and that happens after this runs — scrolling to it would aim
 *      at a zero-height element. The card is on the page from the start, and the fold below it is
 *      already open when the list arrives.
 *   3. **The hash is decoded inside a `try`, and never fed to `querySelector`.** A malformed hash
 *      (`#[`, `#%`, `#..`) makes `querySelector` throw a SyntaxError, which on the in-place-login
 *      path is caught into a reload — and the bad hash survives that reload and loops.
 *      `getElementById` cannot throw, and a bad decode is simply no target.
 */

/**
 * Deep-link targets that live INSIDE a card and carry a fold of their own, so arriving at one means
 * opening two things rather than one. Keyed by the target element's id.
 * @type {Record<string, {body: string, chevron: string}>}
 */
export const NESTED_DEEP_LINKS = {
    alBookedBox: { body: 'alBookedBody', chevron: 'alBookedChevron' },
};

/**
 * Work out what a hash should open and where it should land.
 *
 * @param {string} hash  `location.hash`, with or without its leading `#`
 * @param {Document} doc
 * @returns {null | { folds: {body: Element|null, chevron: Element|null}[], scrollTo: Element }}
 *   `null` when the hash names nothing on the page — no target, nothing to open, nothing to scroll.
 */
export function resolveDeepLink(hash, doc) {
    if (!hash || !doc) return null;
    let target = null;
    try {
        const id = decodeURIComponent(String(hash).replace(/^#/, ''));
        target = id ? doc.getElementById(id) : null;
    } catch { /* a malformed hash decodes to nothing, which IS the "no target" answer */ }
    if (!target) return null;

    // The card AROUND the target — for a link that names a card, that is the target itself, so
    // every pre-v22.91 deep link resolves to exactly what it always did.
    const card = /** @type {Element} */ (target.closest?.('.card') || target);
    const folds = [{
        body:    card.querySelector('.card-collapsible-body'),
        chevron: card.querySelector('.collapse-chevron'),
    }];

    const nested = NESTED_DEEP_LINKS[target.id];
    if (nested) {
        folds.push({ body: doc.getElementById(nested.body), chevron: doc.getElementById(nested.chevron) });
    }
    return { folds, scrollTo: nested ? card : target };
}
