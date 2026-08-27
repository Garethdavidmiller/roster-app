// @ts-check
/**
 * admin-week-swipe.js — the week-grid swipe gesture on admin.html.
 *
 * ── WHAT IT IS ──────────────────────────────────────────────────────────────────────────────────
 *
 * A pointer state machine with a carousel attached. It decides when a drag is a horizontal SWIPE
 * rather than a tap or a scroll, builds the adjacent week panels once that is confirmed, animates
 * the commit, and holds a cooldown so one gesture cannot advance two weeks.
 *
 * It knows nothing about rosters, overrides, annual leave or saving. What a week change MEANS to
 * Admin is the coordinator's, and arrives here as two callbacks: `onWeekCommitted` (the date has
 * moved — refresh whatever depends on it) and `onSettled` (the animation is over — the grid is
 * ready to be edited again).
 *
 * ── WHY IT IS ITS OWN MODULE ────────────────────────────────────────────────────────────────────
 *
 * `admin-app.js` was 1,783 lines against a 1,800 cap, so the next Admin change — a coordinator
 * holding annual leave, absence, the week editor and the save paths — would have had to make room
 * by arguing with a gesture handler. This is the piece with no business rule in it at all.
 *
 * ── AND WHY IT IS *NOT* SHARED WITH THE CALENDAR'S SWIPE ────────────────────────────────────────
 *
 * `calendar-swipe.js` looks like the same thing and is not. It moves a month, not a week; it has no
 * unsaved-work guard, no adjacent-panel build, and a different idea of what a commit does. Merging
 * them would produce one handler behind a mode flag and a dozen options — worse than two files
 * each of which can be read in one sitting. A little duplicated gesture arithmetic is cheaper than
 * coupling the Calendar to Admin's editing lifecycle.
 *
 * ── TWO STANDING RULES, BOTH LEARNED THE HARD WAY ───────────────────────────────────────────────
 *
 * · POINTER EVENTS, never Touch Events — one handler covers touch, mouse and trackpad.
 * · `setPointerCapture` goes on the GRID, not the clip. Events dispatched to a capture target do
 *   not bubble down to its children, and capturing on the clip breaks the drag animation.
 *
 * Both are in CLAUDE.md's architecture table because both have been "simplified" before.
 */

import { SWIPE_THRESHOLD, SWIPE_VELOCITY, formatISO, parseISODate } from './roster-data.js';
import { buildWeekGridInto } from './admin-week-editor.js';

/**
 * Wire the week-grid swipe and the week arrows (they share its cooldown, so one gesture and one
 * button press cannot both commit).
 *
 * @param {object} deps
 * @param {HTMLElement} deps.weekGrid            the swipeable surface
 * @param {HTMLInputElement} deps.fieldDate      the date input that holds "which week"
 * @param {HTMLElement} deps.prevWeekBtn
 * @param {HTMLElement} deps.nextWeekBtn
 * @param {() => boolean} deps.canNavigate        may we leave this week? (staged work, no member)
 * @param {(iso: string) => void} deps.onWeekCommitted  the date has moved — refresh what depends on it
 * @param {() => void} deps.onSettled            the animation is over — the grid is editable again
 * @param {(delta: number) => void} deps.shiftWeek      what the arrows do
 * @returns {void}
 */
export function initAdminWeekSwipe({
    weekGrid, fieldDate, prevWeekBtn, nextWeekBtn,
    canNavigate, onWeekCommitted, onSettled, shiftWeek,
}) {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const TRANSITION  = prefersReducedMotion ? 'none' : 'transform 0.35s cubic-bezier(0.4,0,0.2,1)';
    const DURATION_MS = prefersReducedMotion ? 0 : 350;
    const SWIPE_PX  = SWIPE_THRESHOLD;  // shared constant from roster-data.js
    const SWIPE_VEL = SWIPE_VELOCITY;   // shared constant from roster-data.js

    /** @type {any} */
    let swipePanelPrev = null;
    /** @type {any} */
    let swipePanelNext = null;
    /** @type {any} */
    let swipePanelCurrent = null;
    let swipePanelWidth = 0, swipeStartX = 0, swipeStartY = 0, swipeStartTime = 0;
    let swipeListening = false, swipeDragging = false, swipeHapticFired = false, swipeCooldown = false;

    // Build a fully-functional adjacent week panel offset off-screen by delta weeks.
    /** @param {any} delta */
    function buildAdjPanel(delta) {
        const d = parseISODate(fieldDate.value);
        d.setDate(d.getDate() + delta * 7);
        const panel = document.createElement('div');
        panel.className = 'week-panel week-carousel-panel';
        buildWeekGridInto(panel, formatISO(d));
        weekGrid.appendChild(panel);
        panel.style.transform = `translate3d(${delta < 0 ? -swipePanelWidth : swipePanelWidth}px, 0, 0)`;
        return panel;
    }

    function discardPanels() {
        if (swipePanelPrev && swipePanelPrev.parentNode) swipePanelPrev.remove();
        if (swipePanelNext && swipePanelNext.parentNode) swipePanelNext.remove();
        swipePanelPrev = null; swipePanelNext = null;
    }

    function snapBack() {
        if (swipePanelCurrent) { swipePanelCurrent.style.transition = TRANSITION; swipePanelCurrent.style.transform = 'translate3d(0, 0, 0)'; }
        if (swipePanelPrev)    { swipePanelPrev.style.transition    = TRANSITION; swipePanelPrev.style.transform    = `translate3d(${-swipePanelWidth}px, 0, 0)`; }
        if (swipePanelNext)    { swipePanelNext.style.transition    = TRANSITION; swipePanelNext.style.transform    = `translate3d(${swipePanelWidth}px, 0, 0)`; }
        setTimeout(() => {
            discardPanels();
            if (swipePanelCurrent) { swipePanelCurrent.style.transition = ''; swipePanelCurrent.style.willChange = ''; }
            swipePanelCurrent = null; swipeCooldown = false;
        }, DURATION_MS + 50);
    }

    // pointerdown: record start position only — no capture, no panel building yet.
    weekGrid.addEventListener('pointerdown', e => {
        if (e.clientX < 24) return; // leave iOS system back-swipe region
        if (!e.isPrimary || swipeCooldown) return;
        // ONE question, asked by the coordinator: may we leave this week? It is false for staged
        // work (never carry an unsaved edit into another week) and false with no member or week
        // loaded (there is nothing to swipe between). Both were inline here; neither is a fact
        // about a gesture.
        if (!canNavigate()) return;

        swipePanelCurrent = weekGrid.querySelector('.week-panel:not(.week-carousel-panel)');
        if (!swipePanelCurrent) return;

        navigator.vibrate?.(0);  // prime Vibration API on Android Chrome
        swipeStartX = e.clientX; swipeStartY = e.clientY; swipeStartTime = e.timeStamp;
        swipeListening = true; swipeDragging = false; swipeHapticFired = false;
    });

    // pointermove: confirm direction; start carousel only when clearly horizontal.
    weekGrid.addEventListener('pointermove', e => {
        if (!e.isPrimary || !swipeListening) return;
        const dx = e.clientX - swipeStartX;
        const dy = e.clientY - swipeStartY;

        if (!swipeDragging) {
            if (Math.abs(dx) <= 5 && Math.abs(dy) <= 5) return;

            if (Math.abs(dy) >= Math.abs(dx)) {
                // Vertical — abandon; let the browser scroll
                swipeListening = false;
                return;
            }

            // Horizontal confirmed — commit to swipe gesture
            swipePanelWidth = Math.ceil(weekGrid.getBoundingClientRect().width);
            weekGrid.setPointerCapture(e.pointerId);
            swipePanelCurrent.style.transition = 'none';
            swipePanelCurrent.style.willChange = 'transform';
            swipePanelPrev = buildAdjPanel(-1);
            swipePanelNext = buildAdjPanel(+1);
            swipeCooldown = true;
            swipeDragging = true;
        }

        swipePanelCurrent.style.transform = `translate3d(${dx}px, 0, 0)`;
        if (swipePanelPrev) swipePanelPrev.style.transform = `translate3d(${-swipePanelWidth + dx}px, 0, 0)`;
        if (swipePanelNext) swipePanelNext.style.transform = `translate3d(${swipePanelWidth + dx}px, 0, 0)`;

        if (!swipeHapticFired && Math.abs(dx) >= SWIPE_PX) {
            navigator.vibrate?.(6);
            swipeHapticFired = true;
        }
    });

    weekGrid.addEventListener('pointerup', e => {
        if (!e.isPrimary || !swipeListening) return;
        swipeListening = false;

        if (!swipeDragging) return; // was a tap — buttons/inputs handle their own clicks
        swipeDragging = false;
        try { weekGrid.releasePointerCapture(e.pointerId); } catch (_) {}

        const dx  = e.clientX - swipeStartX;
        const vel = e.timeStamp > swipeStartTime ? Math.abs(dx) / (e.timeStamp - swipeStartTime) : 0;
        const goLeft  = dx < 0 && (Math.abs(dx) >= SWIPE_PX || vel >= SWIPE_VEL);
        const goRight = dx > 0 && (Math.abs(dx) >= SWIPE_PX || vel >= SWIPE_VEL);

        if (goLeft || goRight) {
            if (!swipeHapticFired) navigator.vibrate?.(6);
            const incoming = goLeft ? swipePanelNext : swipePanelPrev;
            const discard  = goLeft ? swipePanelPrev : swipePanelNext;
            if (!incoming) { snapBack(); return; }

            // Commit: advance date state before animation so label is correct
            const d = parseISODate(fieldDate.value);
            d.setDate(d.getDate() + (goLeft ? +7 : -7));
            fieldDate.value = formatISO(d);
            onWeekCommitted(fieldDate.value);

            swipePanelCurrent.style.transition = TRANSITION;
            swipePanelCurrent.style.transform  = `translate3d(${goLeft ? -swipePanelWidth : swipePanelWidth}px, 0, 0)`;
            incoming.style.transition = TRANSITION;
            incoming.style.transform  = 'translate3d(0, 0, 0)';
            if (discard && discard.parentNode) discard.remove();

            function restore() {
                incoming.classList.remove('week-carousel-panel');
                incoming.style.transition = incoming.style.transform = incoming.style.willChange = '';
                if (swipePanelCurrent && swipePanelCurrent.parentNode) swipePanelCurrent.remove();
                swipePanelPrev = swipePanelNext = swipePanelCurrent = null;
                onSettled();
                swipeCooldown = false;
            }
            const timer = setTimeout(restore, DURATION_MS + 50);
            incoming.addEventListener('transitionend', () => { clearTimeout(timer); restore(); }, { once: true });

        } else {
            snapBack();
        }
    });

    weekGrid.addEventListener('pointercancel', e => {
        if (!e.isPrimary || !swipeListening) return;
        swipeListening = false; swipeCooldown = false;
        try { weekGrid.releasePointerCapture(e.pointerId); } catch (_) {}
        if (swipeDragging) {
            swipeDragging = false;
            if (swipePanelCurrent) { swipePanelCurrent.style.transition = swipePanelCurrent.style.transform = swipePanelCurrent.style.willChange = ''; }
            discardPanels(); swipePanelCurrent = null;
        }
    });

    // Button handlers inside IIFE so they share the swipeCooldown closure variable
    /** @type {HTMLElement} */ (prevWeekBtn).addEventListener('click', () => { if (!swipeCooldown) shiftWeek(-1); });
    /** @type {HTMLElement} */ (nextWeekBtn).addEventListener('click', () => { if (!swipeCooldown) shiftWeek(+1); });
}
