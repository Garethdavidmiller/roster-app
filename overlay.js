// @ts-check
/**
 * overlay.js — The overlay layer's front door: the shared scroll lock, the canonical lightbox
 * (`createLightbox`), the notice gate (`openNoticeIfClear`) and the in-app confirm/prompt dialogs built on
 * the lightbox. The rest of the layer lives in its own modules and is RE-EXPORTED below, so every page and
 * module imports all of it from here as it always has (the Facade pattern — one door, several rooms):
 *
 *   · overlay-history.js      — the Android Back stack, `whenHistorySettled`, `followLinkOutOf`
 *   · overlay-focus.js        — the Tab trap and the guard for focus moves no key reports
 *   · overlay-panel-scroll.js — a scrolling panel's "more below" fade and its pinned ✕
 *   · card-collapse.js        — the collapsible card and the deep link that opens one by name
 *
 * WHY THE DIALOGS STAY HERE. They are createLightbox's own clients, and page-session.js and the pages
 * import `confirmDialog` from this file. Moved out, they would import createLightbox from here while this
 * file re-exported them — a cycle (import-graph.test.mjs) — so they stay beside the lifecycle they wire.
 *
 * Imported by most pages and many feature modules — grep for the import rather than trusting a
 * list here.
 *
 * Body scroll lock: iOS Safari ignores overflow:hidden on body, so we pin
 * position:fixed at the current scroll offset and restore on close. The
 * .lb-open class (defined in shared.css) applies the fix.
 *
 * Android Back button: every overlay's entry and close handler go on ONE stack, so Back closes only the
 * topmost — overlay-history.js's header has the model and the incident behind it.
 */

export { initCardCollapse, openCardNamedByHash } from './card-collapse.js';
import { _pushOverlayState, _isTopOverlay, _clearOverlayHistory, whenHistorySettled } from './overlay-history.js';
import { trapFocus, _guardFocus, _highestOpenLayer, _zOf } from './overlay-focus.js';
import { watchScrollFade, pinCloseButton } from './overlay-panel-scroll.js';
export { _pushOverlayState, _isTopOverlay, _clearOverlayHistory, registerPopInterceptor, suppressNextPop, whenHistorySettled, followLinkOutOf } from './overlay-history.js';
export { trapFocus } from './overlay-focus.js';
export { watchScrollFade, pinCloseButton } from './overlay-panel-scroll.js';

let _lbScrollY = 0;
// Depth-counted so nesting is safe (the v15.69 history stack made nested overlays a
// supported case). Once `.lb-open` is applied (position:fixed) window.scrollY reads 0, so a
// naive second lock would capture 0 and the inner unlock would strip the lock (background
// jumps to top) while the outer overlay is still open. Capture only on 0→1, restore on 1→0.
let _lbDepth = 0;

/** Lock body scroll for an open overlay (iOS Safari fix). Re-entrant / nesting-safe. */
export function lockBodyScroll() {
    if (_lbDepth++ > 0) return;   // already locked by an outer overlay — keep its scroll baseline
    _lbScrollY = window.scrollY;
    // THE PAGE DOES NOT JUMP SIDEWAYS (lightbox review R1-13, 22 Nov 2026). On a screen with a
    // permanent scrollbar — the Windows station PC — fixing the body took the scrollbar away and the
    // page behind moved right by its width, on every lightbox and the drawer. Where a scrollbar is
    // taking room NOW, its gutter is kept for as long as the lock (shared.css, `html.lb-keep-gutter`).
    // Only then: a gutter kept always (the reviewer's draft) moved every desktop page that does not
    // scroll by the gutter's width, and a phone's scrollbar takes no room, so it never gains one.
    const root = document.documentElement;
    if (root && window.innerWidth - root.clientWidth > 0) root.classList.add('lb-keep-gutter');
    document.body.style.setProperty('--lb-scroll-y', `-${_lbScrollY}px`);
    document.body.classList.add('lb-open');
}

/** Restore body scroll after an overlay closes. Only the outermost unlock restores. */
export function unlockBodyScroll() {
    // Already fully unlocked → do nothing. Without this, an UNBALANCED second unlock at depth 0
    // (e.g. Android Back closes the nav drawer mid doc-fetch, then the fetch's own close fires a
    // second unlock) fell straight through to scrollTo(0, _lbScrollY) with a now-stale offset,
    // yanking the reader back to where the overlay opened. Restore only when we truly go 1→0 (v16.19).
    if (_lbDepth === 0) return;
    if (--_lbDepth > 0) return;    // an outer overlay is still open — keep the lock
    document.body.classList.remove('lb-open');
    document.documentElement?.classList.remove('lb-keep-gutter');
    document.body.style.removeProperty('--lb-scroll-y');
    window.scrollTo(0, _lbScrollY);
}

/**
 * Open a one-time NOTICE only if nothing else is on screen — otherwise leave it for the next load.
 *
 * A notice is dismissed once and then never shown again, so it must never appear stacked behind (or
 * in front of) another overlay: the reader either cannot see it, or cannot see what it covered.
 * Returning without opening leaves the notice UNSEEN and UNARCHIVED — the "seen" flag is written in
 * `onClose`, which cannot run — so it simply gets its turn next time.
 *
 * Which one wins when two are due is DOM/registration order, and that is fine: the point is that
 * exactly one shows per load, not which. The `new-notice` skill's actionable pattern already had
 * this guard inline; the close-only pattern (which both of the app's current notices use) did not.
 * @param {{ open: (...a: any[]) => void }} lightbox - the createLightbox handle
 * @returns {boolean} true if it opened
 */
export function openNoticeIfClear(lightbox) {
    if (document.body.classList.contains('lb-open')) return false;
    lightbox.open();
    return true;
}

/**
 * Close an overlay: remove .open, then once the CSS fade-out ends (or after a
 * 500 ms safety fallback) remove .visible and unlock body scroll — at once when there is no fade
 * (reduced motion, or an overlay that never faded in).
 *
 * @param {Element}  el                  - The .lb-overlay element
 * @param {object}   [opts]
 * @param {EventListener} [opts.onKey]   - document keydown listener to remove
 * @param {HTMLElement}  [opts.focusReturn]  - element to focus synchronously on close
 * @param {Function} [opts.afterClose]   - called once .visible is removed and scroll unlocked
 * @param {Function} [opts.backHandler]  - the close handler this overlay registered via
 *   _pushOverlayState; passed on so _clearOverlayHistory drops THIS overlay's entry (not
 *   just the top) and a double-tap / non-topmost dismiss can't pop a different overlay's entry.
 */
export function dismissOverlay(el, { onKey, focusReturn, afterClose, backHandler } = {}) {
    _clearOverlayHistory(backHandler);
    const fadedIn = el.classList.contains('open');   // read before it goes: see the finish below
    el.classList.remove('open');
    if (onKey) document.removeEventListener('keydown', onKey);
    focusReturn?.focus();
    // Whichever fires first (the transition ending, or the 500 ms fallback when iOS suppresses
    // transitionend on a backgrounded tab) runs finish() exactly once AND removes the listener.
    // Previously the fallback timer left the {once:true} transitionend listener attached, so it
    // survived and re-fired on the overlay's NEXT opening transition — hiding it right after it
    // appeared and leaking a phantom history entry.
    let _done = false;
    /** @type {any} */ let _t;
    // THE OVERLAY'S OWN FADE, NOT A CHILD'S (lightbox review R1-4, 22 Nov 2026). `transitionend`
    // BUBBLES: a dialog button's press easing back (`.dialog-btn`, `.notice-cta`, 120 ms) reached
    // this listener and finished the 200 ms fade early, so the card vanished instead of fading.
    /** @param {Event} e */
    const onEnd = (e) => { if (e.target === el) finishOnce(); };
    const finishOnce = () => {
        if (_done) return;
        _done = true;
        clearTimeout(_t);
        el.removeEventListener('transitionend', onEnd);
        el.classList.remove('visible');
        unlockBodyScroll();
        afterClose?.();
    };
    // Reduced motion disables the fade transition entirely (shared.css), so transitionend never
    // fires — finish immediately (return null: nothing left pending) instead of making those users
    // wait out the 500 ms fallback with body scroll still locked.
    // NEVER FADED IN, NOTHING TO FADE OUT (15 Nov 2026): the same for an overlay closed before the
    // open's first frame added `.open`. It is still transparent, so no transition runs, and waiting
    // for one left half a second of an invisible layer over the page, swallowing every tap.
    if (!fadedIn || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { finishOnce(); return null; }
    _t = setTimeout(finishOnce, 500);
    el.addEventListener('transitionend', onEnd);
    // Return the idempotent finisher so a caller re-opening DURING the fade can complete this close
    // synchronously first (removes .visible + unlocks scroll exactly once) and then re-open cleanly,
    // instead of the re-open being silently dropped by a `.visible`-still-set guard.
    return finishOnce;
}

/**
 * Close on a tap on the BACKDROP: a press and a release on the overlay itself. A mouse drag that starts
 * inside the card and ends on the backdrop — selecting a prompt's text — arrives as a `click` on the
 * overlay too, because a click goes to the nearest element the press and the release share, and it
 * closed the prompt under the selection. A click with no press seen (one made in code) still counts.
 * @param {Element} overlay
 * @param {() => void} close
 */
export function closeOnBackdropTap(overlay, close) {
    /** @type {EventTarget|null} */ let pressedOn = null;
    overlay.addEventListener('pointerdown', e => { pressedOn = e.target; });
    overlay.addEventListener('click', e => {
        const from = pressedOn;
        pressedOn = null;
        if (e.target === overlay && (from === null || from === overlay)) close();
    });
}

/** Input types that raise no keyboard; any other input, and a textarea, is typed into. */
const _NO_KEYBOARD = new Set(['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'image', 'range', 'color', 'hidden']);
const _isTextEntry = (/** @type {any} */ el) => el?.tagName === 'TEXTAREA' || (el?.tagName === 'INPUT' && !_NO_KEYBOARD.has(String(el.type || 'text').toLowerCase()));

/**
 * Build a lightbox with the canonical open/close lifecycle (the rule is in CLAUDE.md's
 * architecture table; the lifecycle and its three exceptions are here). One factory so every lightbox gets the
 * same behaviour and none can drift: focus save/restore, .visible → rAF →
 * .open + focus, body scroll lock, Android Back support, Escape to close,
 * a Tab trap and a guard for focus moves Tab never sees, and a text field focused in the tap.
 *
 * THREE EXCEPTIONS, AND THE FIRST TWO ARE ONE DECISION. The drawer's `#navComingSoonLightbox` and
 * `#navNoticesLightbox` (App Notices) belong to the drawer alone (nav-drawer-lightboxes.js) and hand-roll this lifecycle,
 * because they share the drawer's history entry: never migrate either to createLightbox. Both are
 * injected at runtime, so overlay-parity.test.mjs's scan of the served HTML cannot see them. The
 * third is `#huddleViewer` (calendar-huddle-viewer.js), a full-bleed panel with no backdrop close.
 * All three keep the first-frame rule by hand: the frame that fades one in, and the drawer panels'
 * 60 ms focus, ask whether it is still open first.
 *
 * Default wiring added here: a tap on the backdrop (the overlay itself, not
 * the content card — `closeOnBackdropTap`) closes, and the close button closes. Callers add any
 * further triggers themselves and prepare dynamic content BEFORE calling
 * open() — or via onOpen, which runs before the overlay becomes visible.
 *
 * @param {object} opts
 * @param {Element}   opts.overlay       - The .lb-overlay element
 * @param {Element}  [opts.content]      - The .lb-content card (focus-trap boundary; defaults to overlay)
 * @param {Element}  [opts.closeBtn]     - The .lb-close button (also the default initial focus)
 * @param {Element|Function} [opts.initialFocus] - Element (or fn returning one) to focus on open instead of closeBtn
 * @param {Function} [opts.onOpen]       - Called with open()'s arguments before the overlay is shown
 * @param {Function} [opts.onClose]      - Called as the overlay starts closing (any close path)
 * @param {Function} [opts.afterClose]   - Called once a close has fully LANDED: the fade finished
 *   (or the reduced-motion synchronous finish) AND the popstate echo of its history.back() has
 *   arrived. The moment after which opening another overlay is safe — see `whenHistorySettled`.
 * @returns {{ open: () => void, close: () => Promise<void> }} — `close()` resolves at that same
 *   moment. A caller that does not care may ignore the promise; one that acts on a close (the
 *   picker sheet applying a pick) awaits it rather than a timer.
 */
export function createLightbox({ overlay, content, closeBtn, initialFocus, onOpen, onClose, afterClose }) {
    /** @type {Element|null} */
    let _focusReturn = null;
    // The in-flight close's finisher while the overlay is fading out (null otherwise). Lets a
    // re-open DURING the fade complete that close synchronously and then re-open, instead of the
    // re-open being silently dropped.
    /** @type {(() => void)|null} */
    let _pendingClose = null;
    /** The in-flight close's landing promise (fade AND history echo), so a second close() during the
     *  fade hands back the same promise rather than a fresh resolved one. */
    /** @type {Promise<void>|null} */
    let _settling = null;
    /** Counts opens, so a close knows whether it was SUPERSEDED: a re-open before it landed (during the
     *  fade, or after the fade with the history echo still out) leaves the overlay open, and that close's
     *  `afterClose` must not then run against it (16 Nov 2026). Moved on by every open. */
    let _openSeq = 0;
    /** Retires this open's scroll/resize listeners. Reassigned per open, called on close. */
    let _stopScrollFade = /** @type {() => void} */ (() => {});
    let _stopFocusGuard = /** @type {() => void} */ (() => {});   // this open's guard; retired first thing in a close
    /** Which open's first frame is still wanted. An open notes it and a close moves it on, so a frame
     *  that runs after its open was closed does nothing (the frame in `open()`). Only a close writes
     *  it: no open follows another without a close between them. */
    let _frameWanted = 0;

    /** @param {KeyboardEvent} e */
    function onKey(e) {
        // Only the TOPMOST overlay reacts. Both halves matter: Escape used to close every open
        // overlay at once (see `_isTopOverlay`), and `trapFocus` on a BURIED overlay would drag Tab
        // back into a dialog the user cannot see. Fails open — see `_isTopOverlay`. Only e2e/links.spec.js
        // proves this wiring: delete the guard and every unit test stays green.
        if (!_isTopOverlay(close)) return;
        if (e.key === 'Escape') { close(); return; }
        trapFocus(content ?? overlay, e);
    }

    function open(/** @type {any[]} */...args) {
        // Re-open during the close fade: the overlay is still `.visible` (removed only at
        // transitionend/fallback) but logically closing. Complete that close NOW (removes .visible +
        // unlocks scroll exactly once — idempotent finisher) so the fresh open below re-locks and
        // re-shows cleanly. Without this, a staff member re-tapping the trigger within ~0.2–0.5 s of
        // closing (e.g. re-checking the About panel) got nothing until a second tap.
        if (_pendingClose) { _pendingClose(); _pendingClose = null; }
        // Idempotent: a second open() while already/still open (not closing) would push a duplicate
        // lockBodyScroll (depth counter → the lock never releases on close) and re-run onOpen.
        // Reachable via a fast double-tap on a trigger during the opener's slide-in.
        else if (overlay.classList.contains('visible')) return;
        // A close not yet LANDED is superseded by this open: its landing still resolves the promise its
        // caller holds, but runs no `afterClose` and clears no `_settling` — `close()`'s landing below.
        _openSeq++;
        _focusReturn = document.activeElement;
        onOpen?.(...args);
        lockBodyScroll();
        _pushOverlayState(close);
        overlay.classList.add('visible');
        pinCloseButton(content);   // now it has boxes to measure; still transparent until the frame below
        _stopScrollFade = watchScrollFade(/** @type {HTMLElement|null} */ (content ?? null));
        _stopFocusGuard = _guardFocus(overlay, content ?? overlay, () => _isTopOverlay(close));   // after the push: already top
        // A TEXT FIELD IS FOCUSED NOW, IN THE TAP (iPhone audit, 7 Nov 2026): iOS raises its keyboard only for
        // a focus made synchronously in the gesture, and the frame below is not. The rest keep the frame.
        const early = /** @type {any} */ (typeof initialFocus === 'function' ? initialFocus() : initialFocus);
        const focusedEarly = _isTextEntry(early) && (early.focus(), document.activeElement === early);
        const frame = _frameWanted;
        requestAnimationFrame(() => {
            // CLOSED BEFORE ITS FIRST FRAME (14 Nov 2026). This frame fades the overlay in and moves
            // focus into it, and a close can come first: an Escape before a slow engine draws, or a
            // tab that runs no frames while it is hidden. Run late, it faded the closing panel back in
            // and took focus into it, so focus fell to <body> as the panel went, where the Calendar's
            // arrow keys change the month instead of the day. Headless WebKit draws slowly enough
            // to lose that race about one run in five (calendar-swipe-redraw.spec.js, the day panel closed over a
            // rebuilt grid).
            if (frame !== _frameWanted) return;
            overlay.classList.add('open');
            if (focusedEarly) return;
            const explicit = /** @type {any} */ (typeof initialFocus === 'function' ? initialFocus() : initialFocus);
            // A NAMED TARGET THAT WILL NOT TAKE FOCUS COUNTS AS NONE. A disabled first row (the Links
            // ··· More sheet's, on an unsaved design) refuses `focus()`, which left focus on the control
            // behind the dialog — where Enter acts on the page and a screen reader is never moved in.
            explicit?.focus?.();
            if (explicit && document.activeElement === explicit) return;
            // Default focus goes to the dialog PANEL (given a `tabindex="-1"`), NOT the ✕ close button.
            // Moving focus into the dialog on open is the WAI-ARIA pattern, but landing it on the close
            // BUTTON makes a keyboard-focus ring appear around the ✕ even when the dialog was opened by
            // tap or AUTO-opened (a notice): Samsung/Android treat the programmatic focus as
            // focus-visible → a heavy navy outline box round the ✕. A non-interactive panel with
            // tabindex="-1" is outside the global :focus-visible ring selector (button/[tabindex="0"]),
            // so screen-reader users still get moved into the dialog with no ring on a control.
            // Explicit initialFocus callers (login field, confirm/prompt input) are unchanged.
            const panel = /** @type {HTMLElement|null} */ (content ?? null);
            if (panel) {
                if (!panel.hasAttribute('tabindex')) panel.setAttribute('tabindex', '-1');
                panel.focus?.();
                return;
            }
            /** @type {any} */ (closeBtn)?.focus?.();
        });
        document.addEventListener('keydown', onKey);
    }

    function close() {
        // ALREADY CLOSING — do nothing (v21.86, external audit). `close` is reachable from four
        // places at once (✕, backdrop, Escape, Android Back), and during the ~300ms fade a second
        // one used to run the whole body again: a second `onClose`, and a second `dismissOverlay`
        // with its own `_done` flag, so `unlockBodyScroll()` ran TWICE for one open.
        //
        // That is only invisible while a single overlay is up, because the lock is DEPTH-COUNTED.
        // With a lightbox open over another (a confirm over the bin, a notice over the Huddle
        // viewer) the depth went 2 → 1 → 0 and the page behind the still-open outer overlay became
        // scrollable. Reproduced by the audit.
        //
        // The history stack was already guarded against the same double-tap — `backHandler: close`
        // below exists for exactly that — so this was the one lifecycle the guard had missed.
        // TWO conditions, because there are two ways to be "already closed" and only one of them
        // leaves a pending finisher behind. `_pendingClose` covers the fade; the `visible` check
        // covers REDUCED MOTION, where `dismissOverlay` finishes synchronously and returns null —
        // so a guard on `_pendingClose` alone would let a second close through on exactly the
        // devices whose users asked for less animation.
        if (_pendingClose) return _settling ?? Promise.resolve();
        if (!overlay.classList.contains('visible')) return _settling ?? Promise.resolve();
        _stopScrollFade();
        _stopFocusGuard();
        _frameWanted++;   // an open whose first frame has not run yet must not run it now
        // A caller's onClose must NEVER strand the overlay: if it threw, dismissOverlay below would
        // not run, leaving the overlay .open/.visible, body scroll locked, and the pushed Back-history
        // entry orphaned (a later Android Back would then pop the wrong overlay). Isolate it.
        try { onClose?.(); } catch (e) { console.error('[overlay] onClose threw:', e); }
        // Pass `close` as backHandler so a double-tap on the ✕ (or backdrop) during the fade
        // drops only THIS lightbox's entry, never the overlay beneath it. Capture the finisher so a
        // re-open during the fade can complete this close first; afterClose clears it once the close
        // lands naturally (transitionend/fallback).
        /** @type {() => void} */ let fadeLanded = () => {};
        const fade = /** @type {Promise<void>} */ (new Promise(res => { fadeLanded = () => res(); }));
        _pendingClose = dismissOverlay(overlay, {
            onKey: /** @type {EventListener} */ (onKey),
            focusReturn: /** @type {HTMLElement|undefined} */ (_focusReturn ?? undefined),
            backHandler: close,
            afterClose: () => { _pendingClose = null; fadeLanded(); },
        });
        _focusReturn = null;
        // The close has LANDED when both halves have: the fade (or its fallback, or the synchronous
        // reduced-motion finish — `fade` covers all three) AND the history echo, which
        // `dismissOverlay` has just made outstanding via `_clearOverlayHistory`. Under reduced motion
        // the first half is already done by this line and the second is what the caller is really
        // waiting for; a picker that opened a dialog on the fade alone would have it popped.
        const echo = /** @type {Promise<void>} */ (new Promise(res => whenHistorySettled(() => res())));
        // A CLOSE THAT A RE-OPEN OVERTOOK IS NOT A CLOSE (16 Nov 2026). `afterClose` says the overlay has
        // gone; reopened before this landed, it has not, and running it then undid the reopen's state —
        // calendar-doc-viewer.js's resets the viewer's z-index, putting a reopened viewer back under the
        // Huddle. The promise still resolves: a caller awaiting it is told this close is over.
        const seq = _openSeq;
        const landing = Promise.all([fade, echo]).then(() => {
            if (seq !== _openSeq) return;
            _settling = null;
            try { afterClose?.(); } catch (e) { console.error('[overlay] afterClose threw:', e); }
        });
        _settling = landing;
        return landing;
    }

    closeOnBackdropTap(overlay, close);
    closeBtn?.addEventListener('click', close);

    return { open, close };
}

// Monotonic id source for dynamically-built dialogs (aria-labelledby/-describedby targets).
// A plain counter — deterministic, no Math.random/Date needed.
let _dialogSeq = 0;

/**
 * Build the DOM for a confirm/prompt dialog and wire it through createLightbox. Shared by
 * confirmDialog and promptDialog. The overlay reuses the `.lb-overlay`/`.lb-content` chrome
 * (so it inherits the canonical open animation, backdrop, blur) plus dialog-specific classes
 * styled in shared.css. Returns a Promise resolving to the caller's result.
 *
 * @param {object}  o
 * @param {string}  o.message
 * @param {string} [o.title]
 * @param {string}  o.confirmLabel
 * @param {string|null} o.cancelLabel     - null: no Cancel button — a report of something already done
 * @param {boolean} o.danger
 * @param {boolean} o.withInput            - render a text input (prompt) vs none (confirm)
 * @param {string} [o.defaultValue]        - initial input value (prompt)
 * @param {string} [o.placeholder]         - input placeholder (prompt)
 * @param {number} [o.maxLength]           - input maxlength (prompt)
 * @param {{ label: string, hint?: string }} [o.option] - one unticked box under the message (`confirmWithOption`)
 * @param {(input: HTMLInputElement|null, box: HTMLInputElement|null) => any} o.resultOnConfirm - value to resolve on confirm
 * @param {any}     o.resultOnCancel       - value to resolve on the Cancel button
 * @param {any}     o.resultOnDismiss      - value to resolve on a dismissal: the backdrop, Escape, Android Back
 * @returns {Promise<any>}
 */
function _openDialog(o) {
    return new Promise(resolve => {
        const seq   = ++_dialogSeq;
        const msgId = `mybDlgMsg${seq}`;
        const titleId = `mybDlgTitle${seq}`;

        const overlay = document.createElement('div');
        overlay.className = 'lb-overlay dialog-overlay';
        overlay.setAttribute('role', o.withInput ? 'dialog' : 'alertdialog');
        overlay.setAttribute('aria-modal', 'true');
        // Named by the title and described by the message; with NO title the message is the name alone.
        // Naming AND describing by the same sentence read it out twice (lightbox review R1-8, 22 Nov 2026).
        if (o.title) {
            overlay.setAttribute('aria-labelledby', titleId);
            overlay.setAttribute('aria-describedby', msgId);
        } else {
            overlay.setAttribute('aria-labelledby', msgId);
        }

        const content = document.createElement('div');
        content.className = 'lb-content dialog-lb-content';

        if (o.title) {
            const h = document.createElement('h2');
            h.className = 'dialog-title';
            h.id = titleId;
            h.textContent = o.title;
            content.appendChild(h);
        }

        const p = document.createElement('p');
        p.className = 'dialog-message';
        p.id = msgId;
        p.textContent = o.message;   // textContent — never innerHTML (message can be arbitrary)
        content.appendChild(p);

        /** @type {HTMLInputElement|null} */
        let input = null;
        if (o.withInput) {
            input = document.createElement('input');
            input.type = 'text';
            input.className = 'dialog-input';
            input.value = o.defaultValue ?? '';
            if (o.placeholder) input.placeholder = o.placeholder;
            if (o.maxLength)   input.maxLength = o.maxLength;
            input.setAttribute('aria-label', o.title || o.message);
            content.appendChild(input);
        }

        // The option: the app-drawn box (shared.css), inside a <label> so the whole row ticks it and is its touch target.
        // Named by its label alone and DESCRIBED by its hint — the row's text is both, and a name that read the hint out
        // too would be a sentence long. It starts unticked: the variant has to be chosen, never inherited.
        /** @type {HTMLInputElement|null} */
        let box = null;
        if (o.option) {
            const row = document.createElement('label');
            row.className = 'dialog-option';
            box = document.createElement('input');
            box.type = 'checkbox';
            box.checked = false;                 // said, not assumed: the rule above, where a test can hold it
            const name = document.createElement('span');
            name.id = `mybDlgOpt${seq}`;
            name.textContent = o.option.label;   // textContent — as the message
            box.setAttribute('aria-labelledby', name.id);
            const text = document.createElement('span');
            text.className = 'dialog-option-text';
            text.appendChild(name);
            if (o.option.hint) {
                const hint = document.createElement('span');
                hint.className = 'dialog-option-hint';
                hint.id = `mybDlgOptHint${seq}`;
                hint.textContent = o.option.hint;
                text.appendChild(hint);
                box.setAttribute('aria-describedby', hint.id);
            }
            row.appendChild(box);
            row.appendChild(text);
            content.appendChild(row);
        }

        const actions = document.createElement('div');
        actions.className = 'dialog-actions';
        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'dialog-btn dialog-btn-cancel';
        cancelBtn.textContent = o.cancelLabel ?? '';
        const confirmBtn = document.createElement('button');
        confirmBtn.type = 'button';
        confirmBtn.className = 'dialog-btn dialog-btn-confirm' + (o.danger ? ' danger' : '');
        confirmBtn.textContent = o.confirmLabel;
        // Cancel first, confirm last — matches the app's primary-action-on-the-right convention. A REPORT
        // has nothing to cancel, so `cancelLabel: null` draws no Cancel at all (whole-app check, 17 Nov
        // 2026): beside an outcome that has already happened, "Cancel" read as a way to undo it.
        if (o.cancelLabel !== null) actions.appendChild(cancelBtn);
        actions.appendChild(confirmBtn);
        content.appendChild(actions);

        overlay.appendChild(content);
        document.body.appendChild(overlay);
        // ON TOP OF WHATEVER IS SHOWING (routed from the pwa audit, 10 Nov 2026). A dialog's layer is the
        // lightbox base, but one can open over a HIGHER layer: a notification tapped while a page holds
        // unsaved work asks its question over whatever is up (sw-register.js) — the picker sheet, the
        // sign-in card, a notice. It painted BENEATH that layer while holding the keyboard — focus on its
        // button, Tab trapped in it, Escape its own — so Enter answered a question nobody could see. The
        // newest overlay is the top of the stack (`_isTopOverlay`); it paints at the top too: one above
        // the highest layer showing, and only when one outranks it, so the usual dialog gains no style.
        // (This one is not `.visible` yet, so it has no boxes and is not counted among them.)
        const beneath = _highestOpenLayer();
        if (beneath > _zOf(overlay)) overlay.style.zIndex = String(beneath + 1);

        let settled = false;
        // Until a button is pressed the dialog is being DISMISSED — the backdrop, Escape or Android Back
        // — which `confirmDialog` reads as Cancel unless its caller must tell "not now" from "no": the
        // unsaved-work offer, whose Cancel deletes the kept work (unsaved-draft.js).
        let result = o.resultOnDismiss;
        // ONE ANSWER PER DIALOG. The card stays on screen, and tappable, through its close fade, so a
        // second tap used to run its button again: a double tap on "Open in Safari" ran `onConfirm`
        // twice, and Cancel then Confirm resolved a cancelled dialog as confirmed. The first answer —
        // a button, or a dismissal (`onClose` below) — stands.
        let answered = false;
        /** @param {() => any} pick */
        const answer = (pick) => {
            if (answered) return;
            answered = true;
            // try/finally so a throwing resultOnConfirm can never leave the dialog open and the Promise
            // pending (today both resolvers are total, but this keeps the contract robust).
            try { result = pick(); } finally { lb.close(); }
        };

        const lb = createLightbox({
            overlay,
            content,
            // No `closeBtn`: Cancel is wired below, because it is an ANSWER, and createLightbox's close
            // control would resolve it as a dismissal. The backdrop, Escape and Back stay its own.
            // The prompt's field; else the option, the one choice the dialog asks for — so Space ticks it, and Tab
            // reaches Cancel and the confirm button; else the confirm button, as a plain confirm always has —
            // EXCEPT a destructive one, which opens on Cancel (lightbox review R1-2 / R5-1, 22 Nov 2026): on the
            // red button one stray Enter or Space removed the thing. Admin's own unsaved-work banner already
            // focused "Keep editing". A danger REPORT (no Cancel) still focuses its one answer.
            initialFocus: () => input ?? box ?? (o.danger && o.cancelLabel !== null ? cancelBtn : confirmBtn),
            // Resolve when the close has LANDED, not as it starts. Callers chain dialogs
            // (`if (!await confirmDialog(…)) return; await promptDialog(…)`), and a resolve here in
            // onClose let the next dialog push its Back entry while this close's history.back() was
            // still in flight — the traversal popped the NEW entry, so Back then left the page.
            afterClose: () => { if (!settled) { settled = true; resolve(result); } },
            onClose: () => {
                answered = true;   // a dismissal is an answer too: no button may change it during the fade
                // Remove the dynamic node AFTER the close transition (not synchronously here): a
                // node detached now would suppress dismissOverlay's transitionend, forcing its 500ms
                // fallback AND skipping the fade-out every other lightbox shows. 500ms clears the
                // 0.2s fade with margin; reduced-motion finishes sooner and the node just lingers
                // invisibly until this fires.
                setTimeout(() => overlay.remove(), 500);
            },
        });

        const confirmAndClose = () => answer(() => o.resultOnConfirm(input, box));
        confirmBtn.addEventListener('click', confirmAndClose);
        cancelBtn.addEventListener('click', () => answer(() => o.resultOnCancel));
        // Enter in the prompt input submits (mirrors native prompt()).
        input?.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); confirmAndClose(); }
        });

        lb.open();
    });
}

/**
 * Promise-based replacement for the browser's confirm(), styled as an app lightbox (inherits the
 * createLightbox lifecycle: focus trap, Escape, Android Back, scroll lock, transitionend fallback).
 * Resolves true if the user confirms and false on Cancel. A DISMISSAL — backdrop, Escape, Android
 * Back — resolves `dismissResult`, which is false, a Cancel, unless the caller passes something else.
 *
 * ASYNC by nature — it cannot stand in for confirm() in a SYNCHRONOUS context that must decide
 * `preventDefault()` inline (a capture-phase navigation guard) or in a `beforeunload` handler.
 * For a navigation guard, intercept-always then navigate when the returned Promise resolves true;
 * beforeunload must keep the native dialog.
 *
 * @template [D=false]
 * @param {object} opts
 * @param {string}  opts.message
 * @param {string} [opts.title]
 * @param {string} [opts.confirmLabel='OK']
 * @param {string|null} [opts.cancelLabel='Cancel'] - null draws NO Cancel: a report of something already
 *                                         done, whose one answer is the confirm button ("OK")
 * @param {boolean} [opts.danger=false]  - style the confirm button as destructive (e.g. Delete)
 * @param {() => void} [opts.onConfirm]  - run synchronously INSIDE the confirm tap, for work that
 *                                         needs the user gesture (window.open)
 * @param {D} [opts.dismissResult]       - what a dismissal resolves to (default false). For a question
 *   whose Cancel destroys something, so that a tap meant for the page behind cannot: the unsaved-work
 *   offer passes null, and a dismissed offer is asked again next load (unsaved-draft.js).
 * @returns {Promise<boolean|D>}
 */
export function confirmDialog({ message, title, confirmLabel = 'OK', cancelLabel = 'Cancel', danger = false, onConfirm, dismissResult }) {
    return _openDialog({
        message, title, confirmLabel, cancelLabel, danger,
        withInput: false,
        // `onConfirm` runs INSIDE the confirm tap (v25.06): the promise settles only after the close
        // fade and the Back echo, by which time the user gesture is spent — so work that needs one
        // (`window.open`) belongs here, not after the await. print-guard.js → explainNoPrint.
        resultOnConfirm: () => { onConfirm?.(); return true; },
        resultOnCancel: false,
        resultOnDismiss: dismissResult === undefined ? false : dismissResult,
    });
}

/**
 * `confirmDialog` with ONE option: an unticked box under the message, for a question with a variant the asker must
 * choose on purpose — Operations → Reset's "Their phone is lost or stolen" (sign-in audit D1, Nov 2026). A SEPARATE
 * function, so every existing `confirmDialog` caller still gets the boolean it has always had.
 *
 * Resolves `{ confirmed, option }`. `option` is the box as it stood when the confirm button was pressed, and FALSE on
 * Cancel or a dismissal (the backdrop, Escape, Android Back) whatever the box showed — a caller can never act on a
 * choice nobody confirmed. Focus opens on the box; Enter there does nothing, as on any checkbox — confirming is the
 * button's job. The box is shared.css's drawn one, and the row's styles are `.dialog-option` beside the dialog's.
 * @param {object} opts
 * @param {string}  opts.message
 * @param {string} [opts.title]
 * @param {string} [opts.confirmLabel='OK']
 * @param {string} [opts.cancelLabel='Cancel']
 * @param {boolean} [opts.danger=false]
 * @param {{ label: string, hint?: string }} opts.option - the box's label, and one line on what ticking it changes
 * @returns {Promise<{ confirmed: boolean, option: boolean }>}
 */
export function confirmWithOption({ message, title, confirmLabel = 'OK', cancelLabel = 'Cancel', danger = false, option }) {
    const declined = { confirmed: false, option: false };
    return _openDialog({
        message, title, confirmLabel, cancelLabel, danger, option,
        withInput: false,
        resultOnConfirm: (_input, box) => ({ confirmed: true, option: !!box?.checked }),
        resultOnCancel: declined,
        resultOnDismiss: declined,
    });
}

/**
 * Promise-based replacement for the browser's prompt(), styled as an app lightbox. Resolves the
 * entered string on confirm (Enter or the confirm button), or null on Cancel / dismiss — matching
 * native prompt()'s string|null contract, so callers keep their `(await promptDialog(...))?.trim()`.
 *
 * @param {object} opts
 * @param {string}  opts.message
 * @param {string} [opts.title]
 * @param {string} [opts.defaultValue='']
 * @param {string} [opts.placeholder]
 * @param {number} [opts.maxLength]
 * @param {string} [opts.confirmLabel='OK']
 * @param {string} [opts.cancelLabel='Cancel']
 * @returns {Promise<string|null>}
 */
export function promptDialog({ message, title, defaultValue = '', placeholder, maxLength, confirmLabel = 'OK', cancelLabel = 'Cancel' }) {
    return _openDialog({
        message, title, confirmLabel, cancelLabel, danger: false,
        withInput: true, defaultValue, placeholder, maxLength,
        resultOnConfirm: input => (input ? input.value : null),
        resultOnCancel: null,
        resultOnDismiss: null,
    });
}
