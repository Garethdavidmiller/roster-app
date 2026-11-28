// @ts-check
/**
 * nav-bell.js — The drawer footer's notification bell (🔔/🔕): its paint, its refresh on every drawer open,
 * and its tap. Every line of push logic is notif.js's; this only renders, refreshes and toggles.
 *
 * Moved out of nav-panel.js (25 Nov 2026). nav-panel-markup.js draws the button (signed-in only, and only
 * where `notifSupported()`); nav-panel.js calls `wireNavBell` once per `initNavPanel` and the refresh it
 * returns on every open. The decisions — a COMPACT icon beside Sign out, never a labelled row (owner,
 * reverted twice); `aria-pressed` the only state; a blocked bell's tap explaining itself in the drawer's
 * info panel, as an OFF bell's does on the GitHub Pages mirror (`MIRROR_OFF_PANEL`) — are
 * .claude/rules/nav-drawer.md's. Why a refresh never paints over a tap (`_bellGen`, `_bellBusy`) is argued
 * beside the two counters below.
 */

import { peekNotifState, enableNotifications, disableNotifications, onPagesMirror } from './notif.js';
import { currentUserAfterBoot } from './firebase-client.js';

/**
 * What a tap on a BLOCKED bell says (its title and icon are the bell's `data-cs-*`). On Settings the card it sends
 * the reader to is on the page under the drawer, so it says so rather than giving the menu route to the page they
 * are already reading (18 Nov 2026).
 * @param {string} currentPage
 */
const blockedBellText = (currentPage) => 'Notifications are blocked for this app in your phone’s or browser’s settings, so the bell can’t switch '
    + 'them on. ' + (currentPage === 'settings'
        ? 'The Notifications card on this page says how to allow them.'
        : '☰ → Settings → Notifications says how to allow them.');

/**
 * What the info panel is headed when a tap to turn notifications ON ends 'off-lapsed' (owner, 26 Nov 2026): the
 * permission was given and the subscription still failed. The bell used to fall back to 🔕 with nothing said, as
 * if the tap had not landed; the Settings card says `ENABLE_FAILED_LINE`, and the bell now says the same line, in
 * the same panel its blocked tap uses. A stand-in trigger carries the heading, because the bell's own `data-cs-*`
 * are the BLOCKED panel's. The line is imported only when it is needed: notif-card-core.js is the Settings card's
 * module (it brings settings-status.js with it), and every page draws the bell.
 */
const ENABLE_FAILED_PANEL = Object.freeze({ dataset: Object.freeze({ csTitle: 'Couldn’t turn notifications on', csIcon: '🔕' }) });

/**
 * What the info panel is headed when an OFF bell is tapped on the GitHub Pages mirror (owner, 26 Nov 2026). Notifications
 * are never turned on there (`enableNotifications` refuses, notif.js says why), so the tap does not toggle: it says where
 * they ARE turned on, in the Settings card's own mirror line (`MIRROR_OFF_LINE`), imported when needed as
 * `ENABLE_FAILED_LINE` is. An ON bell there still toggles: a device subscribed there before v26.92 must be able to stop.
 */
const MIRROR_OFF_PANEL = Object.freeze({ dataset: Object.freeze({ csTitle: 'Turn on at the app’s main address', csIcon: '🔕' }) });

/**
 * Whether this state, here, is an OFF bell on the Pages mirror — one whose tap explains rather than toggles.
 * @param {string|undefined} state
 * @returns {boolean}
 */
const mirrorOff = (state) => state !== 'on' && state !== 'loading' && state !== 'denied' && onPagesMirror();


/**
 * Wire the bell, if the drawer drew one, and hand back its refresh. The drawer's two collaborators are passed
 * under the names nav-panel.js gives them, so the body reads as it did there: a BLOCKED bell's tap closes the
 * drawer visually (keeping its history entry) and opens the info panel over it.
 * @param {{ currentPage: string, _closePanelVisualOnly: () => void, _openComingSoon: (triggerEl?: HTMLElement, overrideBody?: string) => void }} drawer
 * @returns {() => Promise<void>} re-read and repaint the bell — a no-op when it is not drawn
 */
export function wireNavBell({ currentPage, _closePanelVisualOnly, _openComingSoon }) {
    // Notification toggle — an in-panel action, so the panel stays open (a BLOCKED bell is the exception:
    // its tap explains itself in the info panel, nav-drawer-lightboxes.js).
    const bell      = /** @type {HTMLButtonElement|null} */ (document.getElementById('navNotifBell'));
    const bellIcon  = document.getElementById('navNotifIcon');
    let _bellBusy   = false;
    // A REFRESH ANSWERS ONLY IF NOTHING NEWER HAS STARTED (review, 21 Nov 2026). Each open starts a
    // refresh it does not wait for; a tap while that refresh was still reading repainted the bell, when
    // it answered, with the state it read BEFORE the tap — 🔕 "off" on a device just subscribed. Every
    // refresh and every tap takes the next number, and a refresh paints only while its number is current.
    // …AND NEVER WHILE A TAP IS IN FLIGHT, NOR AFTER ITS ANSWER (24-hour check, 22 Nov 2026): the drawer
    // closed and reopened during a slow toggle (up to ~8 s) started a refresh with a HIGHER number than
    // the tap's, whose read — begun before the toggle settled — then painted the old 🔕 over the tap's 🔔.
    // So a refresh that finds a tap in flight after its first wait stands aside (`_bellBusy`): one that
    // gets past it begins its read only once the tap has let go, so it reads the tap's answer, never the
    // state from before it — and a tap that starts after that still makes it stale through the number.
    let _bellGen    = 0;

    /** Apply a state string to the toggle glyph and accessible name.
     * @param {any} state
     * @param {'on'|'off'|null} [turning] while a tap is in flight, which way it is going — from the state
     *   BEFORE the tap. "Checking…" was the name for both a tap and a first read (owner, 26 Nov 2026). */
    function _paintBell(state, turning = null) {
        if (!bell) return;
        const on = state === 'on';
        // While the real state is still resolving (up to ~8s for swReady), a neutral "working" glyph —
        // never 🔔, which only ever means genuinely on. Compact icon: the aria-label carries the state.
        if (bellIcon)  bellIcon.textContent  = state === 'loading' ? '🔄' : on ? '🔔' : '🔕';
        bell.dataset.notifState = state;
        // A TOGGLE SAYS ITS STATE ONCE (review, 21 Nov 2026): `aria-pressed` is the state, so the name
        // stays "Notifications" — the name used to say it too ("on — tap to turn off, toggle button,
        // pressed"). Checking and blocked are not on/off, so they drop `aria-pressed` and say what
        // they are; a blocked bell's tap explains how to allow them, and its name says so.
        // An OFF bell on the Pages mirror is not a toggle either: its tap says where to turn them on.
        const offHere = mirrorOff(state);
        const toggle = state !== 'loading' && state !== 'denied' && !offHere;
        if (toggle) bell.setAttribute('aria-pressed', on ? 'true' : 'false');
        else bell.removeAttribute('aria-pressed');
        bell.setAttribute('aria-label',
            state === 'loading' ? (turning ? `Notifications — turning ${turning}…` : 'Notifications — checking…')
          : state === 'denied' ? 'Notifications blocked — how to allow them'
          : offHere ? 'Notifications off — where to turn them on'
          : 'Notifications');
    }

    /**
     * Re-read and repaint the bell. No-op when the bell is not rendered.
     * Uses peekNotifState (no side effects) — repainting on every panel open
     * must not write to Firestore. VAPID rotation and the record's re-save run from getNotifState, which
     * calendar-notif-prompt.js calls on a signed-in Calendar load and notif-card.js once as Settings opens.
     */
    async function _refreshBell() {
        if (!bell) return;
        const gen = ++_bellGen;
        // NOT WHILE THE ACCOUNT BEHIND THE SESSION IS GONE: a tap then subscribed, the rules refused
        // the save and the bell flipped back to off unexplained. After the boot restore, so one in progress keeps it.
        const user = await currentUserAfterBoot(3000);
        if (gen !== _bellGen || _bellBusy) return;
        bell.hidden = !user;
        // A restore still running at 3s is not an account gone (48-hour review): bring it back when it lands.
        if (bell.hidden) { void currentUserAfterBoot().then(u => { if (u) void _refreshBell(); }); return; }
        const state = await peekNotifState();
        if (gen === _bellGen) _paintBell(state);
    }

    /**
     * Is the drawer the bell sits in still open? The info panel reuses the drawer's history entry, which a drawer
     * closed meanwhile has given up, so a panel opened then would stack on whatever is open now. Asked after every
     * wait: a toggle's answer, and the import of notif-card-core.js, which on a first visit is a network fetch.
     * @returns {boolean}
     */
    const drawerStillOpen = () => !bell?.closest?.('[aria-hidden="true"]');

    bell?.addEventListener('click', async () => {
        if (_bellBusy) return;
        const state = bell.dataset.notifState;
        // Browser-blocked: the browser will not ask again, so the tap SAYS where it is fixed — in the
        // drawer's info panel, as a document that cannot open does. It did nothing at all, under a 🔕
        // that looks exactly like "off" (whole-app check, 17 Nov 2026); the aria-label said "blocked"
        // to a screen reader only. Settings' card has each phone's own steps. 'loading' is a no-op:
        // toggling then would re-subscribe a device that may already be subscribed.
        if (state === 'denied') { _closePanelVisualOnly(); _openComingSoon(bell, blockedBellText(currentPage)); return; }
        if (state === 'loading') return;
        // OFF on the Pages mirror: say where they are turned on, as the Settings card does, rather than ask the
        // browser for a subscription notif.js would refuse anyway. Busy across the import, so a second tap waits.
        if (mirrorOff(state)) {
            _bellBusy = true;
            try {
                const { MIRROR_OFF_LINE } = await import('./notif-card-core.js');
                // The import is the first visit's network fetch, and the drawer can be closed while it lands.
                if (!drawerStillOpen()) return;
                _closePanelVisualOnly();
                _openComingSoon(/** @type {HTMLElement} */ (/** @type {unknown} */ (MIRROR_OFF_PANEL)), MIRROR_OFF_LINE);
            } catch (err) {
                console.warn('[Nav] Bell mirror panel failed:', err);
            } finally {
                _bellBusy = false;
            }
            return;
        }
        _bellBusy = true;
        _bellGen++;   // a refresh still reading from before this tap must not paint over it
        bell.dataset.notifState = 'loading';
        const turning = state === 'on' ? 'off' : 'on';
        _paintBell('loading', turning);   // repaint NOW — otherwise the old 🔔/"On" glyph shows through a slow toggle (up to 8s)
        bell.disabled = true;
        let failed = false;
        /** @type {string|null} */ let answer = null;
        try {
            answer = turning === 'off' ? await disableNotifications() : await enableNotifications();
            _paintBell(answer);
        } catch (err) {
            console.warn('[Nav] Bell toggle failed:', err);
            failed = true;
        } finally {
            bell.disabled = false;
            _bellBusy = false;
        }
        // Restore the real state if the toggle errored — once the tap has let go, or the refresh stands aside.
        if (failed) await _refreshBell();
        // Permission given, subscription not made: say so, as the blocked tap does (ENABLE_FAILED_PANEL, above).
        // A dismissed prompt ('off-default') and a refusal ('denied') are the member's own answers and need no telling.
        // Only while the drawer is still open: the panel reuses the drawer's history entry, which a drawer closed
        // during a slow toggle has given up — the bell's 🔕 says the rest when it is next opened.
        else if (turning === 'on' && answer === 'off-lapsed' && drawerStillOpen()) {
            const { ENABLE_FAILED_LINE } = await import('./notif-card-core.js');
            if (!drawerStillOpen()) return;   // …and asked again once the import has landed
            _closePanelVisualOnly();
            _openComingSoon(/** @type {HTMLElement} */ (/** @type {unknown} */ (ENABLE_FAILED_PANEL)), ENABLE_FAILED_LINE);
        }
    });

    return _refreshBell;
}
