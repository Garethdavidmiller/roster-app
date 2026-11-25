// @ts-check
/**
 * nav-drawer-lightboxes.js — The nav drawer's two lightboxes, the info panel (`#navComingSoonLightbox`: a
 * document that cannot open, a blocked bell) and App Notices (`#navNoticesLightbox`), and the ONE lifecycle
 * they share (`_drawerLightbox`).
 *
 * NOT createLightbox, AND NEVER TO BE MIGRATED TO IT (overlay.js → createLightbox's JSDoc;
 * .claude/rules/nav-drawer.md). Both open from inside the drawer and REUSE the drawer's one history entry, so
 * Back from either pops that one entry and the overlay stack never sees it. The entry is nav-panel.js's — it
 * is pushed, consumed and stepped off there — so this file reaches it only through the three moves it is
 * handed (`entry`). Their open flags stay nav-panel.js's too (`comingSoon`, `notices`), because
 * `resetNavPanel` and the drawer's popstate handler ask them with no lightbox in hand. What each lightbox
 * keeps for itself is its content and what Tab does in it.
 *
 * Moved out of nav-panel.js (25 Nov 2026), which builds both once per `initNavPanel`.
 */

import { lockBodyScroll, unlockBodyScroll, suppressNextPop, watchScrollFade, closeOnBackdropTap, pinCloseButton } from './overlay.js';
import { readArchivedNotices, noticeDateInFull } from './notice-archive.js';
import { SECTION_MODS } from './nav-destinations.js';

/** How long after an open the drawer and its two lightboxes move focus to their ✕: long enough for the CSS
 *  transition to have started, so a screen reader announces the dialog rather than the button alone. */
export const FOCUS_DELAY_MS = 60;
/** Another overlay open over a drawer lightbox (a dialog, a viewer a notification tap opened) owns the keyboard — `_isTopOverlay`'s rule, read from the DOM because these share the drawer's history entry (test audit, 7 Nov 2026). */
const _overlayAbove = (/** @type {Element|null} */ own) => Array.from(document.querySelectorAll('.lb-overlay.open')).some(el => el !== own);

/**
 * Build the drawer's two lightboxes over the DOM nav-panel-markup.js drew, and hand back what the drawer
 * calls: the two openers, and each lightbox's `closeFromBack` and `onKey` (the Back handler and the reset ask
 * them). `burger` takes focus back as either closes; `entry` is the drawer's history entry — is it there,
 * push one, and forget it (the browser has popped it, or this close pops it). `notices` is read as
 * `noticesFlag`, because `_openNotices` names the archive it reads `notices`.
 * @param {{ burger: HTMLElement,
 *   entry: { isPushed: () => boolean, push: () => void, forget: () => void },
 *   comingSoon: { isOpen: () => boolean, setOpen: (v: boolean) => void },
 *   notices: { isOpen: () => boolean, setOpen: (v: boolean) => void } }} drawer
 */
export function createDrawerLightboxes({ burger, entry, comingSoon, notices: noticesFlag }) {
    // The drawer's info panel — a document that cannot open, and the blocked bell, explain themselves
    // here (its ids still say "coming soon": the links it was first built for are gone). Shared .lb-overlay pattern.
    const csLightbox = document.getElementById('navComingSoonLightbox');
    const csClose    = document.getElementById('navComingSoonClose');
    const csTitle    = document.getElementById('navComingSoonTitle');
    const csIcon     = document.getElementById('navComingSoonIcon');
    const csBody     = document.getElementById('navComingSoonBody');

    /**
     * Open the drawer's info panel for the control that was tapped (a document row, the blocked bell).
     * @param {HTMLElement} [triggerEl] the link that was tapped - its
     *   data-cs-title / data-cs-icon drive the heading, so the one generic
     *   lightbox shows the right title for whichever item opened it.
     * @param {string} [overrideBody]
     */
    function _openComingSoon(triggerEl, overrideBody) {
        if (!csLightbox) return;
        // Every trigger names itself (a document row, the blocked bell); these are only a neutral fallback —
        // "Coming soon" with a bell outlived the coming-soon links it was for (review, 21 Nov 2026).
        const title = triggerEl?.dataset.csTitle || 'Menu';
        const icon  = triggerEl?.dataset.csIcon  || 'ℹ️';
        const body  = overrideBody ?? triggerEl?.dataset.csBody ?? '';
        if (csTitle) csTitle.textContent = title;
        if (csIcon)  csIcon.textContent  = icon;
        if (csBody)  csBody.textContent  = body;
        csLightbox.setAttribute('aria-label', title);
        csLb.open();
    }

    /**
     * Shared teardown: fade `el` out, hide it once the fade completes, then unlock
     * scroll and return focus to the burger. A 500ms fallback fires in case
     * transitionend is suppressed (iOS backgrounded tab, prefers-reduced-motion).
     * At once when there is no fade: reduced motion, or a panel that never faded in.
     * @param {HTMLElement} el - The .lb-overlay element to finish closing.
     */
    function _finishNavLightboxClose(el) {
        const fadedIn = el.classList.contains('open');   // read before it goes: see the finish below
        el.classList.remove('open');
        // NEVER FADED IN, NOTHING TO FADE OUT (15 Nov 2026) — dismissOverlay's rule (overlay.js): a panel
        // closed before its first frame added `.open` is still transparent, so no transition runs, and
        // waiting for one left an invisible layer over the page for 500 ms, swallowing every tap.
        if (!fadedIn || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            el.classList.remove('visible');
            unlockBodyScroll();
            burger.focus();
            return;
        }
        const t = setTimeout(done, 500);
        // The panel's OWN fade only — `transitionend` bubbles, and a child's (a pressed button easing
        // back) finished this close early (lightbox review R1-4). Not `{ once: true }`: a child's event
        // would spend it, and `done` removes the listener itself.
        /** @param {Event} e */
        const onEnd = (e) => { if (e.target === el) done(); };
        function done() {
            clearTimeout(t);
            el.removeEventListener('transitionend', onEnd);
            el.classList.remove('visible');
            unlockBodyScroll();
            burger.focus();
        }
        el.addEventListener('transitionend', onEnd);
    }

    /**
     * The lifecycle the drawer's two lightboxes share — the info panel and App Notices. NOT createLightbox
     * (.claude/rules/nav-drawer.md): both reuse the DRAWER's one history entry, so they hand-roll it, and
     * this is the one copy (they were two, line for line). What each keeps for itself is its content and
     * what Tab does in it. Its open state is the module's flag (`isOpen`/`setOpen`), because
     * `resetNavPanel` and the popstate handler ask it with no lightbox in hand.
     * `scroller` — a panel whose LIST scrolls (App Notices) fades its foot while there is more below, as every
     * other scrolling panel does (`watchScrollFade`): it stopped at a hard edge that said nothing (24 Nov 2026).
     * @param {{ el: HTMLElement|null, closeBtn: HTMLElement|null, isOpen: () => boolean, setOpen: (v: boolean) => void, onTab: (e: KeyboardEvent) => void, scroller?: HTMLElement|null }} cfg
     */
    function _drawerLightbox({ el, closeBtn, isOpen, setOpen, onTab, scroller = null }) {
        let stopFade = () => {};
        function open() {
            if (!el) return;
            lockBodyScroll();
            setOpen(true);   // before the frame and the timer below, which both ask it
            el.classList.add('visible');
            // Its ✕ stays in reach as a long panel scrolls, as every createLightbox panel's does (overlay.js).
            // A no-op where the ✕ is not directly inside a scrolling panel (App Notices' list scrolls instead).
            pinCloseButton(/** @type {HTMLElement|null} */ (el.querySelector('.lb-content')));
            stopFade(); stopFade = watchScrollFade(scroller);
            // A CLOSE BEFORE THIS FRAME, OR THE TIMER, RETIRES THEM (15 Nov 2026), as createLightbox's does:
            // an Escape before a slow engine draws, or a tab that runs no frames while hidden. Run after the
            // close, the frame faded the panel back in over the page and the timer moved focus into it.
            requestAnimationFrame(() => { if (isOpen()) el.classList.add('open'); });
            document.addEventListener('keydown', onKey);
            // Reuse the panel's single history entry (normally already present, as
            // the lightbox opens from the open panel); push one only if missing.
            if (!entry.isPushed()) entry.push();
            setTimeout(() => { if (isOpen()) closeBtn?.focus(); }, FOCUS_DELAY_MS);
        }
        // Called by user action (Escape, ✕, backdrop) — pop the shared entry.
        function close() {
            if (!el || !isOpen()) return;   // ONCE: a second ✕/backdrop tap mid-fade unlocked twice (test audit)
            setOpen(false);
            stopFade();
            document.removeEventListener('keydown', onKey);
            if (entry.isPushed()) {
                entry.forget();
                suppressNextPop();   // don't let the echo reach the overlay stack (v16.23)
                history.back();
            }
            _finishNavLightboxClose(el);
        }
        // Called from popstate — history.back() already happened.
        function closeFromBack() {
            if (!el) return;
            setOpen(false);
            stopFade();
            entry.forget();
            document.removeEventListener('keydown', onKey);
            _finishNavLightboxClose(el);
        }
        /** Escape closes it; Tab stays inside (`onTab` says where it goes). @param {any} e */
        function onKey(e) {
            // Stale-survivor guard: a copy surviving a reset-while-open would swallow every Tab page-wide
            // and its Escape would steal the REBUILT drawer's history entry. Self-remove.
            if (!isOpen()) { document.removeEventListener('keydown', onKey); return; }
            if (_overlayAbove(el)) return;   // one Escape closed both, and Tab was dragged back under it
            if (e.key === 'Escape') { close(); return; }
            if (e.key === 'Tab') { e.preventDefault(); onTab(e); }
        }
        closeBtn?.addEventListener('click', close);
        // Only close on a tap on the backdrop itself — the ✕ already has its own listener and event
        // bubbling would otherwise close twice; and a text selection dragged out onto it is not a tap
        // (`closeOnBackdropTap`).
        if (el) closeOnBackdropTap(el, close);
        return { open, closeFromBack, onKey };
    }

    // The info panel has one focusable element (the ✕), so Tab stays on it.
    const csLb = _drawerLightbox({
        el: /** @type {HTMLElement|null} */ (csLightbox), closeBtn: csClose,
        isOpen: comingSoon.isOpen, setOpen: comingSoon.setOpen,
        onTab: () => csClose?.focus(),
    });

    // App Notices archive lightbox — its lifecycle is `_drawerLightbox`'s, like the info
    // panel's (it reuses the panel's single history entry; no createLightbox).
    const noticesLightbox = document.getElementById('navNoticesLightbox');
    const noticesClose    = document.getElementById('navNoticesClose');
    const noticesList     = document.getElementById('navNoticesList');
    const noticesEmpty    = document.getElementById('navNoticesEmpty');

    function _openNotices() {
        if (!noticesLightbox) return;
        // Render the archive (notice-archive.js reads it, and an unreadable one reads as empty).
        const notices = readArchivedNotices();
        if (noticesList) {
            noticesList.innerHTML = '';
            notices.forEach(/** @param {any} n */ n => {
                const item    = document.createElement('div');
                item.className = 'notices-item';
                const header  = document.createElement('div');
                header.className = 'notices-item-header';
                const sectionEl = document.createElement('span');
                const sectionMod = SECTION_MODS[n.section];   // nav-destinations.js — a section with none stays grey
                sectionEl.className = `notices-item-section${sectionMod ? ' notices-item-section--' + sectionMod : ''}`;
                sectionEl.textContent = n.section || '';
                const dateEl  = document.createElement('span');
                dateEl.className = 'notices-item-date';
                dateEl.textContent = noticeDateInFull(n.date || '');   // stored short: it is the expiry key
                header.appendChild(sectionEl);
                header.appendChild(dateEl);
                const titleEl = document.createElement('div');
                titleEl.className = 'notices-item-title';
                titleEl.textContent = n.title || '';
                const bodyEl  = document.createElement('div');
                bodyEl.className = 'notices-item-body';
                bodyEl.textContent = n.body || '';
                item.appendChild(header);
                item.appendChild(titleEl);
                item.appendChild(bodyEl);
                noticesList.appendChild(item);
            });
        }
        if (noticesList)  noticesList.hidden  = notices.length === 0;
        if (noticesEmpty) noticesEmpty.hidden = notices.length > 0;
        noticesLb.open();
    }

    const noticesLb = _drawerLightbox({
        el: /** @type {HTMLElement|null} */ (noticesLightbox), closeBtn: noticesClose,
        isOpen: noticesFlag.isOpen, setOpen: noticesFlag.setOpen,
        scroller: /** @type {HTMLElement|null} */ (noticesList),
        // TWO STOPS, the ✕ and the list: the list SCROLLS, and one the keyboard cannot reach cannot
        // be scrolled (axe scrollable-region-focusable). A hidden (empty) list is no stop.
        onTab: e => {
            const stops = [noticesClose, noticesList].filter(el => el && !el.hidden);
            const at = stops.indexOf(/** @type {HTMLElement} */ (document.activeElement));
            stops[(at + (e.shiftKey ? -1 : 1) + stops.length) % stops.length]?.focus();
        },
    });

    return { openComingSoon: _openComingSoon, openNotices: _openNotices, csLb, noticesLb };
}
