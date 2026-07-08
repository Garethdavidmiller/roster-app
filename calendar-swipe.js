// @ts-check
/**
 * calendar-swipe.js — Pointer Events swipe gesture handler for the calendar carousel.
 *
 * Exports initSwipeHandler(deps) which wires all pointer events on #calendarDisplay.
 * Also exports isSwipeCooldown() so the coordinator can suppress button clicks
 * while a swipe animation is in flight.
 *
 * Design notes:
 * - Adjacent panels are built in pointerdown (not pointermove) so GPU layers are
 *   already promoted by the time horizontal intent is confirmed, eliminating jank.
 * - setPointerCapture is deferred to pointermove (after horizontal intent confirmed)
 *   because iOS Safari suppresses pointermove if captured on pointerdown.
 * - RAF-throttled transform writes keep swipe smooth at 120 Hz (ProMotion).
 * - translate3d instead of translateX for reliable GPU compositing on iOS Safari.
 */

import { CONFIG, MONTH_NAMES, SWIPE_THRESHOLD } from './roster-data.js';
import { getDisplayMonth, getDisplayYear, persistViewedMonth } from './calendar-state.js';
import { buildCalendarContainer, getSwipeDirection } from './calendar-renderer.js';
import { ensureOverridesCached } from './calendar-overrides.js';
import { getSelectedMemberIndex } from './calendar-member.js';

let _swipeCooldown = false;
// True from pointerdown until the gesture RESOLVES (tap / abandon / commit-restore / snap-back /
// cancel). Broader than _swipeCooldown, which only turns on once horizontal INTENT is confirmed
// mid-pointermove — background code gating on the cooldown alone could still wipe the carousel
// DOM inside the pre-intent window (finger down, <5px moved). (v16.23)
let _gestureActive = false;

/** Returns true while a swipe animation is in progress. */
export function isSwipeCooldown() { return _swipeCooldown; }

/** True while a pointer gesture is live on the calendar OR its commit animation is settling.
 *  Background re-renders (initial-fetch resolution, deferred member apply) must wait on THIS —
 *  renderCalendar wipes #calendarDisplay, detaching the carousel panels mid-gesture and leaving
 *  the grid frozen on the old month while title/state advance (v16.23). */
export function isSwipeGestureActive() { return _gestureActive || _swipeCooldown; }

/**
 * Wire the Pointer Events swipe gesture handler on #calendarDisplay.
 * @param {{
 *   isTeamViewMode: () => boolean,
 *   changeMonth: (delta: number) => void,
 *   renderCalendar: () => void,
 *   updateLegend: () => void,
 *   updateNavButtonState: () => void,
 *   navigateToPaycalc: (str: string) => void,
 *   openDayDetail: ((cell: Element) => void) | null,
 * }} deps
 */
export function initSwipeHandler({ isTeamViewMode, changeMonth, renderCalendar, updateLegend, updateNavButtonState, navigateToPaycalc, openDayDetail }) {
    const calendarDisplay = document.getElementById('calendarDisplay');
    if (!calendarDisplay) return;

    // Respect prefers-reduced-motion — instant transitions for users who need it
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const TRANSITION             = prefersReducedMotion ? 'none' : 'transform 0.35s cubic-bezier(0.4, 0, 0.2, 1)';
    const TRANSITION_DURATION_MS = prefersReducedMotion ? 0 : 350; // Must match the duration in TRANSITION above

    /** @type {HTMLElement|null} */
    let prevPanel = null;
    /** @type {HTMLElement|null} */
    let nextPanel = null;
    let isListening = false;     // True from pointerdown until gesture is resolved (tap or completed swipe)
    let isDragging = false;      // True only after horizontal intent is confirmed in pointermove
    let touchStartX = 0;
    let touchStartY = 0;
    let touchStartTime = 0;
    let gestureW = 0;            // Cached display width — measured on pointerdown, reused throughout gesture
    /** @type {HTMLElement|null} */
    let gestureCurrentPanel = null; // Cached current panel — queried once on pointerdown, reused throughout gesture
    /** @type {number|null} */
    let rafId = null;            // requestAnimationFrame handle — throttles transform writes to one per frame
    let pendingX = 0;            // Most recent deltaX — consumed by the scheduled RAF frame
    let _vibratePrimed = false;  // navigator.vibrate(0) only needs to run once per page lifetime
    let hapticFired = false;

    // Returns true if swiping in the given direction would actually change the month.
    // At the year boundaries, swiping toward the blocked side should always snap back.
    function canNavigate(/** @type {string} */ direction) {
        if (direction === 'prev') return !(getDisplayYear() === CONFIG.MIN_YEAR && getDisplayMonth() === 0);
        if (direction === 'next') return !(getDisplayYear() === CONFIG.MAX_YEAR && getDisplayMonth() === 11);
        return true;
    }

    // Build a panel for an adjacent month using explicit month/year params —
    // no global state mutation, no risk of corruption if an exception is thrown.
    function buildAdjacentPanel(/** @type {number} */ monthDelta) {
        let m = getDisplayMonth() + monthDelta;
        let y = getDisplayYear();
        if (m > 11) { m = 0;  y++; }
        if (m < 0)  { m = 11; y--; }
        if (y > CONFIG.MAX_YEAR) { y = CONFIG.MAX_YEAR; m = 11; }
        if (y < CONFIG.MIN_YEAR) { y = CONFIG.MIN_YEAR; m = 0;  }
        return buildCalendarContainer(m, y, {
            navigateToPaycalc,
            onDayDetail: openDayDetail ?? undefined,
        });
    }

    // Position a panel off-screen without transition.
    // Static layout (position/top/left/width) is in the .carousel-panel CSS class.
    // gestureW is cached on pointerdown — no layout recalculation needed here.
    function parkPanel(/** @type {HTMLElement} */ panel, /** @type {string} */ side) {
        panel.classList.add('carousel-panel');
        panel.style.transition = 'none';
        panel.style.transform  = `translate3d(${side === 'right' ? gestureW : -gestureW}px, 0, 0)`;
        panel.style.willChange = 'transform';
    }

    function discardPanels() {
        if (prevPanel && prevPanel.parentNode) prevPanel.remove();
        if (nextPanel && nextPanel.parentNode) nextPanel.remove();
        prevPanel = null;
        nextPanel = null;
    }

    // pointerdown — record start position and pre-build adjacent panels.
    // Panels are built here (not in pointermove) so DOM construction and layer promotion
    // happen during the dead-zone before horizontal intent is confirmed. By the time the
    // user has moved far enough to trigger dragging, GPU layers are already ready —
    // eliminating the jank spike that occurred when panels were built mid-swipe.
    calendarDisplay.addEventListener('pointerdown', (e) => {
        if (!e.isPrimary || _swipeCooldown || isTeamViewMode()) return;

        gestureCurrentPanel = /** @type {HTMLElement|null} */ (document.querySelector('.calendar-container:not(.carousel-panel)'));
        if (!gestureCurrentPanel) return;

        // Prime the Vibration API once on the first user gesture only.
        // Chrome Android requires a user activation before navigator.vibrate() works,
        // but we only need to do it once per page lifetime, not on every pointerdown.
        if (!_vibratePrimed && navigator.vibrate) { navigator.vibrate(0); _vibratePrimed = true; }

        touchStartX    = e.clientX;
        touchStartY    = e.clientY;
        touchStartTime = Date.now();
        isListening    = true;
        isDragging     = false;
        hapticFired    = false;
        _gestureActive = true;   // live from pointerdown — see isSwipeGestureActive (v16.23)

        // Measure width now — avoids a forced layout reflow mid-gesture.
        // Math.ceil eliminates sub-pixel seam on high-DPI screens — do not remove.
        gestureW = Math.ceil(calendarDisplay.getBoundingClientRect().width);

        // Promote current panel to its own compositor layer before dragging starts.
        gestureCurrentPanel.style.willChange = 'transform';

        // Build and park adjacent panels while the finger is still in the dead-zone.
        try {
            if (canNavigate('prev')) {
                prevPanel = buildAdjacentPanel(-1);
                parkPanel(prevPanel, 'left');
                calendarDisplay.appendChild(prevPanel);
            }
            if (canNavigate('next')) {
                nextPanel = buildAdjacentPanel(1);
                parkPanel(nextPanel, 'right');
                calendarDisplay.appendChild(nextPanel);
            }
        } catch (err) {
            console.error('Failed to pre-build adjacent panels:', err);
            discardPanels();
        }
    });

    // pointermove — confirm direction then track finger position.
    // Deferring setPointerCapture to here (not pointerdown) is the key fix for iOS Safari,
    // which is stricter than Android about gesture arbitration.
    calendarDisplay.addEventListener('pointermove', (e) => {
        if (!e.isPrimary || !isListening) return;

        const deltaX = e.clientX - touchStartX;
        const deltaY = e.clientY - touchStartY;

        if (!isDragging) {
            // Dead zone — ignore tiny jitter
            if (Math.abs(deltaX) <= 5 && Math.abs(deltaY) <= 5) return;

            if (Math.abs(deltaY) >= Math.abs(deltaX)) {
                // Vertical intent — abandon; let the browser handle scrolling.
                isListening = false;
                _gestureActive = false;
                discardPanels();
                if (gestureCurrentPanel) {
                    gestureCurrentPanel.style.willChange = '';
                    gestureCurrentPanel = null;
                }
                return;
            }

            // Horizontal intent confirmed — defer setPointerCapture to here (iOS Safari
            // suppresses pointermove if captured on pointerdown).
            calendarDisplay.setPointerCapture(e.pointerId);
            if (gestureCurrentPanel) gestureCurrentPanel.style.transition = 'none';
            _swipeCooldown = true;
            isDragging    = true;
        }

        if (!gestureCurrentPanel) return;

        const RESISTANCE = 0.3;
        const atPrevBoundary = deltaX > 0 && !prevPanel;
        const atNextBoundary = deltaX < 0 && !nextPanel;
        const effectiveDeltaX = (atPrevBoundary || atNextBoundary)
            ? deltaX * RESISTANCE
            : deltaX;

        // RAF-throttle transform writes — pointermove fires faster than the display
        // refresh rate (up to 120 Hz on ProMotion). translate3d is used instead of
        // translateX — functionally equivalent but more reliably GPU-composited on iOS.
        pendingX = effectiveDeltaX;
        if (!rafId) {
            rafId = requestAnimationFrame(() => {
                rafId = null;
                if (!gestureCurrentPanel) return;
                gestureCurrentPanel.style.transform = `translate3d(${pendingX}px, 0, 0)`;
                if (prevPanel) prevPanel.style.transform = `translate3d(${-gestureW + pendingX}px, 0, 0)`;
                if (nextPanel) nextPanel.style.transform = `translate3d(${gestureW  + pendingX}px, 0, 0)`;
            });
        }

        if (!hapticFired && !atPrevBoundary && !atNextBoundary && Math.abs(deltaX) >= SWIPE_THRESHOLD) {
            if (navigator.vibrate) navigator.vibrate(30);
            hapticFired = true;
        }
    });

    // pointerup — replaces touchend
    calendarDisplay.addEventListener('pointerup', (e) => {
        if (!e.isPrimary || !isListening) return;
        isListening = false;

        if (!isDragging) {
            // Pointer went down and up without confirmed horizontal drag — was a tap.
            if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
            discardPanels();
            if (gestureCurrentPanel) gestureCurrentPanel.style.willChange = '';
            gestureCurrentPanel = null;
            _gestureActive = false;
            return;
        }
        isDragging = false;
        if (rafId) { cancelAnimationFrame(rafId); rafId = null; }

        try { calendarDisplay.releasePointerCapture(e.pointerId); } catch (_) {}

        const current = gestureCurrentPanel;
        if (!current) { discardPanels(); _swipeCooldown = false; _gestureActive = false; return; }

        const direction = getSwipeDirection(touchStartX, touchStartY, e.clientX, e.clientY, Date.now() - touchStartTime);
        const w = gestureW;

        if (direction) {
            if (!hapticFired && navigator.vibrate) navigator.vibrate(30);

            const incomingPanel = direction === 'left' ? nextPanel : prevPanel;
            const discardPanel  = direction === 'left' ? prevPanel : nextPanel;

            if (!incomingPanel) {
                discardPanels();
                current.style.transition = 'none';
                current.style.transform  = '';
                current.style.willChange = '';
                _swipeCooldown = false;
                _gestureActive = false;
                console.warn('Swipe commit: incomingPanel was null, aborting without state change');
                return;
            }

            changeMonth(direction === 'left' ? 1 : -1);
            document.title = `Marylebone Roster — ${MONTH_NAMES[getDisplayMonth()]} ${getDisplayYear()}`;
            updateLegend();
            updateNavButtonState?.();   // refresh Prev/Next disabled state at year boundaries after a swipe

            current.style.transition       = TRANSITION;
            current.style.transform        = `translate3d(${direction === 'left' ? -w : w}px, 0, 0)`;
            incomingPanel.style.transition = TRANSITION;
            incomingPanel.style.transform  = 'translate3d(0, 0, 0)';

            if (discardPanel && discardPanel.parentNode) discardPanel.remove();

            let _restored = false;
            function restoreIncoming() {
                // Idempotent: the safety timer AND a late transitionend must not both run. A late
                // transitionend (backgrounded/janky tab, firing >50ms after the safety timer) would
                // otherwise re-null the SHARED prev/next/gestureCurrentPanel — wiping the state of a
                // NEW gesture the user has already started, silently dropping that swipe (v16.21).
                if (_restored) return;
                _restored = true;
                incomingPanel?.removeEventListener('transitionend', onEnd);
                if (incomingPanel) {
                    incomingPanel.classList.remove('carousel-panel');
                    incomingPanel.style.transition = '';
                    incomingPanel.style.transform  = '';
                    incomingPanel.style.willChange = '';
                }
                if (current && current.parentNode) current.remove();
                prevPanel = null;
                nextPanel = null;
                gestureCurrentPanel = null;
                _swipeCooldown = false;
                _gestureActive = false;
                // Always persist — ensureOverridesCached is a no-op for pre-cached
                // months and won't call renderCalendar (which is where persist
                // normally happens), so we must persist unconditionally here.
                persistViewedMonth();
                const _mAtFetch = getSelectedMemberIndex();
                ensureOverridesCached(getDisplayYear(), getDisplayMonth(), () => {
                    if (!isTeamViewMode() && getSelectedMemberIndex() === _mAtFetch) renderCalendar();
                });
            }

            const safetyTimer = setTimeout(restoreIncoming, TRANSITION_DURATION_MS + 50);
            // transitionend BUBBLES — a descendant element finishing any transition would fire this
            // early and snap the slide into place. Only the incoming panel's own `transform` ending
            // counts (v16.21). (Not {once:true}: a filtered-out descendant event must not consume it.)
            /** @param {TransitionEvent} ev */
            function onEnd(ev) {
                if (ev.target !== incomingPanel || ev.propertyName !== 'transform') return;
                clearTimeout(safetyTimer);
                restoreIncoming();
            }
            incomingPanel.addEventListener('transitionend', onEnd);

        } else {
            // No swipe threshold met — snap back to current month
            current.style.transition = TRANSITION;
            current.style.transform  = 'translate3d(0, 0, 0)';
            current.style.willChange = '';
            if (prevPanel) { prevPanel.style.transition = TRANSITION; prevPanel.style.transform = `translate3d(${-w}px, 0, 0)`; }
            if (nextPanel) { nextPanel.style.transition = TRANSITION; nextPanel.style.transform = `translate3d(${w}px, 0, 0)`;  }
            setTimeout(() => {
                discardPanels();
                gestureCurrentPanel = null;
                _swipeCooldown = false;
                _gestureActive = false;
            }, TRANSITION_DURATION_MS + 50);
        }
    });

    // Pre-intent abandon fallback (v16.23): before horizontal intent confirms there is NO pointer
    // capture, so a pointerup/pointercancel landing OUTSIDE #calendarDisplay never reaches the
    // element handlers — _gestureActive would stay true forever, permanently blocking the deferred
    // background renders and member applies that gate on it. Document-level (bubble phase, so the
    // element handler has already run and cleared isListening for on-element ups).
    /** @param {PointerEvent} e */
    function _abandonUncaptured(e) {
        if (!e.isPrimary || !isListening || isDragging) return;
        isListening    = false;
        _gestureActive = false;
        discardPanels();
        if (gestureCurrentPanel) { gestureCurrentPanel.style.willChange = ''; gestureCurrentPanel = null; }
    }
    document.addEventListener('pointerup', _abandonUncaptured);
    document.addEventListener('pointercancel', _abandonUncaptured);

    // pointercancel — fires when OS interrupts the gesture (call, notification, rotate)
    calendarDisplay.addEventListener('pointercancel', (e) => {
        if (!e.isPrimary || !isListening) return;
        isListening    = false;
        isDragging     = false;
        _swipeCooldown = false;
        _gestureActive = false;
        if (rafId) { cancelAnimationFrame(rafId); rafId = null; }

        try { calendarDisplay.releasePointerCapture(e.pointerId); } catch (_) {}

        if (gestureCurrentPanel) {
            gestureCurrentPanel.style.transition = 'none';
            gestureCurrentPanel.style.transform  = '';
            gestureCurrentPanel.style.willChange = '';
            gestureCurrentPanel = null;
        }
        discardPanels();
    });

    // Prevent context menu on long-press (Android) or right-click (desktop)
    calendarDisplay.addEventListener('contextmenu', (e) => e.preventDefault());
}
