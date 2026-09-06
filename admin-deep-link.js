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
 * `resolveDeepLink` returns WHICH folds to open and WHAT to scroll to. It opens NOTHING —
 * `admin-app.js` already owns `openCollapsibleCard`, which keeps `aria-expanded` in step, and a
 * second opener would be a second place for that to be forgotten. Taking `doc` as an argument is
 * what lets the whole decision run against a fake document in Node.
 *
 * The SCROLLING is this module's, in `createDeepLinkLanding` — landing is what the module is named
 * for, and unlike the folds there is no other authority over it to keep in step.
 *
 * ── THREE THINGS NOT TO "TIDY" ─────────────────────────────────────────────────────────────────
 *
 *   1. **`NESTED_DEEP_LINKS` is an explicit map, not a guessed selector.** These boxes do not share
 *      the card body's class (`.al-booked-body` against `.card-collapsible-body` — the same
 *      mechanism, different padding), and a link that opens the WRONG fold is worse than one that
 *      opens none. The same shape, and the same reason, as `DEEP_LINK_CARDS` on operations.html.
 *   2. **A nested target scrolls to its CARD FIRST AND TO ITSELF LATER, and both halves matter.**
 *      The box carries `hidden` until its own async render un-hides it, which happens after this
 *      runs — so scrolling straight to it would aim at a zero-height element, and that is why the
 *      card is the immediate answer. But the card is NOT a sufficient answer, which is what the
 *      first cut of this got wrong (reported 6 Sep 2026: "it takes me to admin and not to the
 *      Recorded Annual Leave dates sub card"). The box sits below the banner, the member row, the
 *      range picker, the preview and the Save button, so landing at the top of the card leaves the
 *      thing the link NAMED off the bottom of the screen — folds dutifully open, around something
 *      nobody can see. Hence `settleOn`: the second scroll runs when the box actually appears,
 *      which `_renderBookedPeriods` knows exactly, so no timer or observer is needed.
 *
 *      It is deliberately an ID and not an element: the element resolved here is the one that was
 *      hidden, and the caller acts at a different moment.
 *
 *      **AND THE SECOND SCROLL MUST CANCEL THE FIRST** (`landing.settle`, measured 6 Sep 2026).
 *      Two smooth scrolls a frame apart do NOT simply resolve to the later one. A box near the
 *      foot of a short page cannot be lifted to the top, so its request clamps to the scroll
 *      maximum the page is *already* at — Chrome finds nothing to do, cancels nothing, and the
 *      card's animation finishes on top of it. Measured at 390x844: the box landed at y=709 with
 *      its last 32px below the fold, exactly the reported symptom, with the correct scroll issued
 *      and ignored. An instant scroll to the current position first aborts the animation in
 *      flight; the box then lands at 493, whole. The fix is one line and nothing else can see it,
 *      which is why the e2e asserts the box's BOTTOM edge rather than that it scrolled.
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
 * @returns {null | { folds: {body: Element|null, chevron: Element|null}[], scrollTo: Element,
 *   settleOn: string|null }}
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
    // `settleOn` is the id the caller should scroll to LATER, once the box it names has actually
    // been rendered — see the header. Null for a plain card link, which is on the page already.
    return { folds, scrollTo: nested ? card : target, settleOn: nested ? target.id : null };
}

/**
 * The SCROLLING half of a deep-link arrival, and the one-shot state behind it.
 *
 * Two scrolls, because a nested target is not on screen when the hash is read — see rule 2 in the
 * header for why both are needed and why the second has to cancel the first.
 *
 * @param {Window} win
 * @returns {{ arrive(resolved: {scrollTo: Element, settleOn: string|null}): void,
 *             settle(boxId: string): void }}
 */
export function createDeepLinkLanding(win) {
    /** The nested target still waiting to be scrolled to, or null. @type {string|null} */
    let pending = null;

    // Two frames: the folds were opened in the same tick, and the first frame still carries the
    // pre-open geometry. The scroll to where we already are aborts any smooth scroll still in
    // flight — without it the earlier one silently wins (header, rule 2).
    //
    // The TWO-ARGUMENT form deliberately: it is always instant, and it takes no `behavior` enum.
    // `scrollTo({ behavior: 'instant' })` is the same instruction and needs a value only added to
    // the enum in 2023 — an engine that does not know it raises a TypeError, inside a rAF, where
    // nothing would report it and the second scroll would simply stop happening.
    const scrollTo = (/** @type {Element} */ el) => {
        win.requestAnimationFrame(() => win.requestAnimationFrame(() => {
            win.scrollTo(win.scrollX, win.scrollY);
            el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }));
    };

    return {
        /** Land on the card now, and remember the nested box to finish on later. */
        arrive(resolved) { scrollTo(resolved.scrollTo); pending = resolved.settleOn; },

        /**
         * Called the instant a box gains a height — the one moment it can be landed on.
         *
         * ONCE ONLY, and that is the guard worth keeping: the box re-renders on every member
         * change, every save and every delete, and re-scrolling the page on a later render would
         * yank it out from under somebody who is using the card. It does nothing at all on the
         * common case where nobody arrived by a deep link.
         */
        settle(boxId) {
            if (pending !== boxId) return;
            pending = null;
            const el = win.document.getElementById(boxId);
            if (el) scrollTo(el);
        },
    };
}
