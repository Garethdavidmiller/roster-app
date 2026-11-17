// @ts-check
/**
 * calendar-lock-slot.js — the ONE place on the Calendar page where a card can stand in for the grid.
 *
 * Owns: the element currently occupying the space the Calendar will fill (a sign-in card, the
 *   staff-PIN card, a member's own sign-in card, the boot skeleton, or the member's stored roster
 *   painted by calendar-app.js), the mount/unmount of it, and
 *   the skeleton's delay timer.
 *   It also owns the other half of that exchange: hiding and showing the workspace the card stands
 *   in for (`setWorkspaceHidden` — moved here from calendar-access.js, 16 Nov 2026).
 * Does NOT own: any DECISION about which card to show, or when the workspace is shown
 *   (calendar-access.js), or the cards' contents or wiring (calendar-lock-cards.js / login-overlay.js).
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
 * either — it judges the page only at 20 seconds, long after this gap has closed.
 *
 * It shows the SHAPE of a calendar and no data — no dates, no shift text, nothing from the roster
 * module — so it is safe in front of a visitor who may turn out to have no access at all. That is
 * why it lives on the access side rather than in the workspace: `calendar-app.js` may not run a
 * single line until access is granted, and this has to appear before that is known.
 */
export function showBootSkeleton() {
    // The member's own stored roster is a better answer to "working" than an empty shape, and it is
    // already up when it exists (v24.59) — the skeleton never replaces it.
    if (lockCardId() === 'calendarSnapshot') return;
    // Month bar, day-name row, then 42 cells — six weeks, the calendar's own worst case, so the
    // block does not resize when the real grid replaces it. The measurements in the CSS are the
    // REAL grid's, taken from a rendered calendar rather than guessed, so the swap is a fill-in
    // rather than a re-layout. `aria-hidden` because it is scenery: the live region above is what a
    // screen reader should hear, and 42 announced blanks is what it should not.
    const card = mountLockCard({
        id: 'calendarBooting',
        className: 'cal-boot',
        html:
            '<p class="sr-only" role="status"></p>' +
            '<div class="cal-boot-head" aria-hidden="true"></div>' +
            '<div class="cal-boot-days" aria-hidden="true">' + '<span></span>'.repeat(7) + '</div>' +
            '<div class="cal-boot-grid" aria-hidden="true">' + '<span class="cal-boot-cell"></span>'.repeat(42) + '</div>',
    });
    // The words go in once the region has been DRAWN, not merely put in the document: see
    // `speakAfterMount` below. Written on the next line, as they were until 17 Nov 2026, they arrived
    // in the same task as the region itself, which a screen reader cannot tell from text it was
    // created with — so "Loading the roster…" was never spoken.
    const status = card?.querySelector('[role="status"]');
    speakAfterMount(status, () => { if (status) status.textContent = 'Loading the roster…'; });
}

/**
 * Write into a live region put on the page in THIS task — once the browser has drawn it empty.
 *
 * A live region announces what CHANGES while it is in the accessibility tree, and the tree catches
 * up between tasks, never inside one. A card mounted and filled in one task therefore arrives with
 * its words already in it, which is a region CREATED with text: read by nobody. Putting the write on
 * the line after the mount does not change that, and three of this slot's messages were silent for
 * exactly that reason (the skeleton's, the member card's reason, the PIN card's "expired" line). So
 * the write waits for the next frame, where the tree is brought up to date, and then a task — the
 * month announcer (`announceMonthChange`, calendar-app.js) writes a frame after it clears, for the
 * same reason. Skipped when the region has left the page by then: its card was replaced, and the
 * next card says its own words.
 * @param {Element|null|undefined} region  the live region, or the box inside it that is written
 * @param {() => void} write
 */
export function speakAfterMount(region, write) {
    if (!region) return;
    const later = () => setTimeout(() => { if (region.isConnected !== false) write(); }, 0);
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(later);
    else later();
}

// ── The workspace the card stands in for ─────────────────────────────────────────────────────────

/** The Calendar workspace: everything that implies usable roster data. The header and the nav
 *  drawer are deliberately NOT in this list — the guides are reachable without Calendar access, and
 *  locking the whole app to read the Railcard guide would be absurd. The Huddle and the documents
 *  used to be reachable too; since v23.17 their reads sit behind `calendar-doc-access.js`, which
 *  opens with the full grant (`grant`, calendar-access.js) — so the drawer still SHOWS them, and a
 *  tap while locked is answered with what to do rather than with the document. */
const WORKSPACE_IDS = ['calendarControls', 'installPrompt', 'notifPrompt', 'swipeHint', 'calendarDisplay', 'calendarLegend'];

/** Hide the workspace (a card is up) or show it (access granted). Called only by the access gate
 *  and the cards it wires. @param {boolean} hidden */
export function setWorkspaceHidden(hidden) {
    for (const id of WORKSPACE_IDS) {
        const el = document.getElementById(id);
        if (!el) continue;
        // The `hidden` ATTRIBUTE, not a CSS class or opacity: it removes the element from the
        // accessibility tree as well as the page, so a screen reader cannot read out a Calendar the
        // eye cannot see. But only where the stylesheet lets it: a `display` of the element's own
        // outranks the attribute, so each element here needs a `[hidden]` rule beside that `display`
        // (cal-docs-11 found the two prompt strips without one). And it is load-bearing: before the
        // first grant these nodes are empty, but a re-lock (`handleAccessLost`) does not reload, so
        // after one they hold the roster the grant drew.
        if (hidden) el.setAttribute('hidden', '');
        else el.removeAttribute('hidden');
    }
}
