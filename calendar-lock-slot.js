// @ts-check
/**
 * calendar-lock-slot.js — the ONE place on the Calendar page where a card can stand in for the grid.
 *
 * Owns: the element currently occupying the space the Calendar will fill (a sign-in card, the
 *   staff-PIN card, a member's own sign-in card, or the boot skeleton), the mount/unmount of it, and
 *   the skeleton's delay timer.
 * Does NOT own: any DECISION about which card to show (calendar-access.js), the cards' contents or
 *   wiring (calendar-access.js / login-overlay.js), or the workspace it stands in for.
 * Edit here for: how a card is put on the page and taken off it — never for what a card says.
 *
 * ── WHY A SLOT, AND NOT FOUR CARDS THAT EACH FIND THE CONTAINER ─────────────────────────────────
 *
 * Every card here is an ALTERNATIVE for the same place, and the invariant that matters is that at
 * most one of them exists at a time: the PIN → member direction is exactly what a re-lock followed by
 * a fresh decision produces, and a second card stacked under the first is a page with two sign-in
 * forms on it. With three cards that rule lived in three copies of the same twelve lines — find the
 * host, tear the previous panel down, build a section, remember it — and the fourth card (the
 * sign-in-first front door, v23.19) would have made it four. One `mountLockCard` is that rule
 * written once; `unmountLockCard` is the only teardown, so the skeleton's timer can never orphan a
 * panel it did not build.
 *
 * ── THE HOST FALLS BACK TO <body> ON PURPOSE ────────────────────────────────────────────────────
 *
 * `.container` has been there since the app was written, but the cost of it being absent is not "the
 * card is misplaced" — it is a navy page with no card, no calendar and no way forward, on the app's
 * front door. A misplaced card is recoverable; nothing is not.
 */

/** @type {HTMLElement|null} */
let _panel = null;
/** @type {any} */
let _skeletonTimer = null;

/**
 * Put a card in the slot, replacing whatever is there.
 * @param {{ id?: string, className?: string, html?: string, labelledBy?: string }} [spec]
 * @returns {HTMLElement|null} the mounted section, or null when the page has no host at all
 */
export function mountLockCard({ id = 'calendarLock', className = 'cal-lock', html = '', labelledBy = '' } = {}) {
    unmountLockCard();   // replace, never stack
    const host = document.querySelector('.container') || document.body;
    if (!host) return null;
    const panel = document.createElement('section');
    panel.id = id;
    panel.className = className;
    if (labelledBy) panel.setAttribute('aria-labelledby', labelledBy);
    if (html) panel.innerHTML = html;
    host.appendChild(panel);
    _panel = panel;
    return panel;
}

/** Take whatever is in the slot off the page, and disarm a pending skeleton. */
export function unmountLockCard() {
    if (_panel) { _panel.remove(); _panel = null; }
    if (_skeletonTimer) { clearTimeout(_skeletonTimer); _skeletonTimer = null; }
}

/** The id of the card currently in the slot, or null. Lets the decision ask "is the skeleton up?"
 *  without holding a reference of its own. */
export function lockCardId() {
    return _panel ? _panel.id : null;
}

/**
 * Show the skeleton after `ms` unless something else takes the slot first. Every path that answers
 * the decision mounts a card or grants — both go through `unmountLockCard`, which disarms this.
 * @param {number} ms
 */
export function armSkeleton(ms) {
    if (_skeletonTimer) clearTimeout(_skeletonTimer);
    _skeletonTimer = setTimeout(() => { _skeletonTimer = null; showBootSkeleton(); }, ms);
}

/**
 * Say "working", while the access decision is still outstanding.
 *
 * ── THE HOLE THIS FILLS (v20.80) ────────────────────────────────────────────────────────────────
 *
 * The splash is dismissed by `calendar-app.js` at module-execution time — deliberately, because
 * leaving it up would trap a locked visitor behind a loading screen with no way out. But the access
 * decision resolves LATER, and between the two there is nothing on the page at all: a navy field, a
 * burger and a wordmark. MEASURED, with the auth restore held at 3s: splash down at ~700ms, the
 * card or the grid at ~3.6s, and 2.9 seconds of blank in between. It reads as a broken app, which
 * is a worse answer than the loading screen it replaced. `splash-watchdog.js` does not cover it
 * either — it stands down the moment the splash gets `.hidden`, which is exactly when this starts.
 *
 * It shows the SHAPE of a calendar and no data — no dates, no shift text, nothing from the roster
 * module — so it is safe in front of a visitor who may turn out to have no access at all. That is
 * why it lives on the access side rather than in the workspace: `calendar-app.js` may not run a
 * single line until access is granted, and this has to appear before that is known.
 */
export function showBootSkeleton() {
    // Month bar, day-name row, then 42 cells — six weeks, the calendar's own worst case, so the
    // block does not resize when the real grid replaces it. The measurements in the CSS are the
    // REAL grid's, taken from a rendered calendar rather than guessed, so the swap is a fill-in
    // rather than a re-layout. `aria-hidden` because it is scenery: the live region above is what a
    // screen reader should hear, and 42 announced blanks is what it should not.
    mountLockCard({
        id: 'calendarBooting',
        className: 'cal-boot',
        html:
            '<p class="sr-only" role="status">Loading the roster…</p>' +
            '<div class="cal-boot-head" aria-hidden="true"></div>' +
            '<div class="cal-boot-days" aria-hidden="true">' + '<span></span>'.repeat(7) + '</div>' +
            '<div class="cal-boot-grid" aria-hidden="true">' + '<span class="cal-boot-cell"></span>'.repeat(42) + '</div>',
    });
}
