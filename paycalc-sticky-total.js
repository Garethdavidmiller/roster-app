// @ts-check
/**
 * paycalc-sticky-total.js — the bar that keeps the take-home figure on screen.
 *
 * ── WHAT IT IS ──────────────────────────────────────────────────────────────────────────────────
 *
 * A small state machine with three inputs and two outputs. The inputs are whether the result figure
 * is in the viewport (IntersectionObserver), whether a field is focused, and where the visual
 * viewport currently sits; the outputs are whether `#stickyTotal` is shown and how far up it is
 * translated, and — with the keyboard up — a scroll that moves the field being typed in clear of
 * it. The decisions are the pure `stickyBarShows` and `scrollToClearBar`, unit-tested. It touches no
 * money, no period, no storage and no calculation — the figure inside it is written by
 * `calculate()`, which does not know this file exists.
 *
 * ── WHY IT IS ITS OWN MODULE ────────────────────────────────────────────────────────────────────
 *
 * Not for the line count. `paycalc-app.js` had reached 1,988 of its 2,000-line cap, and the next
 * change to the Pay Calculator — a coordinator holding tax-period resolution, YTD selection,
 * back-pay, HPP and pension orchestration — would have had to fight for room against a
 * scroll-position widget. Of everything in that file this is the piece whose removal cannot affect
 * a single figure a member reads.
 *
 * ── THE PART THAT IS EASY TO BREAK, AND HAS BEEN ────────────────────────────────────────────────
 *
 * Every guard below is the fix to a reported iOS behaviour, and each one is conservative in the
 * same direction — it can only skip an update, never invent one:
 *
 *   · NO pagehide-disconnect. An IntersectionObserver survives the bfcache freeze/thaw, and the
 *     init never re-runs, so a prior version that disconnected on navigate-away left the bar frozen
 *     over the footer for the rest of the session after any Back/Forward (v16.19).
 *   · The bar is PINNED above the iOS keyboard, not hidden behind it. Hiding it was the actual
 *     cause of the staff-reported "pay total is slow to update on iOS" — the maths was never slow,
 *     the figure was invisible while you typed (v21.65).
 *   · focusout defers BOTH the keyboard-up removal and the baseline rebase behind the same check,
 *     because moving between fields fires focusout→focusin and the keyboard never goes down.
 *   · The translate COMPOSES with the desktop centring rule; an iPad soft keyboard satisfies both,
 *     and a bare translateY threw the bar to the left edge for exactly that user.
 *   · With the keyboard up, the VISUAL viewport decides whether the bar shows, not the observer —
 *     the keys cover the layout viewport without shrinking it, so on the Overtime and Rest Day
 *     Working rows the £ sat behind them and no bar came. And the bar, pinned where iOS has just
 *     scrolled the focused box, moves that box clear of itself once (the iPhone audit, 7 Nov 2026).
 *
 * None of this is reproducible in headless or e2e — visual-viewport keyboard behaviour needs a real
 * device — which is precisely why the reasoning is written down beside it rather than assumed.
 */

import { wireIosTap } from './paycalc-inputs.js';

/** The figure counts as on screen from this far below the top edge. The observer's rootMargin and
 *  the visual-viewport test in `stickyBarShows` read the same number, so they cannot disagree. */
const TOP_INSET = 8;
/** The gap kept between a field being typed in and the top of the bar pinned above the keyboard. */
const FIELD_GAP = 8;

/**
 * Whether the take-home bar shows — the whole decision, PURE, so it is tested without a phone.
 *
 * With the keyboard DOWN the observer's answer is the truth: the layout viewport is the screen. With
 * it UP it is not (the iPhone audit, 7 Nov 2026). The keyboard covers the bottom of the layout
 * viewport without shrinking it, so a figure the observer calls "in view" can sit behind the keys —
 * typing on the Overtime or Rest Day Working rows put it exactly there, and no bar came, the moment
 * the live figure mattered most. Then only the VISUAL viewport is on screen, and the figure counts
 * as seen only where it overlaps that. Both rects are in layout-viewport coordinates (what
 * getBoundingClientRect reports, and what visualViewport.offsetTop is measured in).
 *
 * @param {{ inLayoutView: boolean, keyboardUp: boolean,
 *           figure?: { top: number, bottom: number } | null,
 *           visual?: { top: number, height: number } | null }} s
 *   `inLayoutView`: the observer's answer · `figure`: the £ figure's rect ·
 *   `visual`: visualViewport's offsetTop and height. Without both rects, the observer decides.
 * @returns {boolean}
 */
export function stickyBarShows({ inLayoutView, keyboardUp, figure = null, visual = null }) {
  if (!keyboardUp || !figure || !visual) return !inLayoutView;
  const seen = figure.bottom > visual.top + TOP_INSET && figure.top < visual.top + visual.height;
  return !seen;
}

/**
 * How far to scroll so the field being typed in sits clear of the bar pinned above the keyboard —
 * 0 when it already does. PURE. The bar's bottom is the visual viewport's bottom (the translate in
 * `initPaycalcStickyTotal` puts it there), so its top is that less its own height. Never so far that
 * the field's own top leaves the visible area: a field taller than the room keeps its top in view.
 *
 * @param {{ field: { top: number, bottom: number }, visual: { top: number, height: number },
 *           barHeight: number }} a  rects in layout-viewport coordinates, as for `stickyBarShows`
 * @returns {number} pixels to scroll the page DOWN by; never negative
 */
export function scrollToClearBar({ field, visual, barHeight }) {
  const barTop = visual.top + visual.height - barHeight;
  const overlap = field.bottom + FIELD_GAP - barTop;
  if (overlap <= 0) return 0;
  return Math.max(0, Math.min(overlap, field.top - (visual.top + FIELD_GAP)));
}

/**
 * Wire the sticky take-home bar. Safe to call when the elements are absent.
 * @returns {void}
 */
export function initPaycalcStickyTotal() {
  const stickyBar  = document.getElementById('stickyTotal');
  const resultCard = document.querySelector('.result-card');
  if (!stickyBar || !resultCard || !('IntersectionObserver' in window)) return;
  // v16.12: no desktop skip — the bar runs at every width. It is the ONLY thing that keeps the
  // take-home £ in view while scrolling: the result card itself is a static column, not sticky
  // (.claude/rules/paycalc.md → Layout decisions), on desktop as on a phone.
  // Defensive single-init guard. init() runs exactly once (paycalc-boot.js), and a bfcache
  // restore THAWS the frozen document rather than re-executing module code — so this function
  // does NOT re-run on a Back/Forward restore. The guard only matters if init() is ever
  // wired to run twice. An IntersectionObserver survives the bfcache freeze/thaw intact,
  // so there is deliberately NO pagehide-disconnect: a prior version disconnected the
  // observer on navigate-away and, because this never re-runs, nothing reconnected it —
  // after any Back/Forward restore the sticky bar froze over the footer for the rest of
  // the session (v16.19).
  if (stickyBar.dataset.obsInit) return;
  stickyBar.dataset.obsInit = '1';
  // Observe the £ amount display specifically, not the whole card.
  // threshold:0 fires when it fully leaves the viewport. Show the bar whenever the figure is
  // OFF-SCREEN IN EITHER DIRECTION (v16.69): the old `top < 0` guard ("scrolled off the top
  // only") was written for the pre-v16.67 DOM where the result sat ABOVE Hours — after the
  // v16.67 move (result below Hours on mobile) it suppressed the bar for the entire
  // hours-entry session, exactly when the live figure is most needed. Below-the-fold on load
  // now deliberately SHOWS the bar — that is the feature: the take-home stays visible while
  // entering hours above it.
  const netDisplay = document.getElementById('netDisplay') || resultCard;
  // ONE DECISION, TWO SOURCES (the iPhone audit, 7 Nov 2026). The observer answers for the layout
  // viewport; with the soft keyboard up (`_keyboardUp`, set by `_pinSticky` below) the VISUAL
  // viewport answers instead — `stickyBarShows` holds the rule. Feature-detected: without
  // visualViewport the keyboard is never "up" here and the observer alone decides, as it always did.
  const _vv = window.visualViewport || null;
  let _inLayoutView = true;
  let _keyboardUp = false;
  /** @type {Element|null} The field already moved clear of the bar, this time it was focused. */
  let _clearedFor = null;
  const _apply = () => {
    const visual = _keyboardUp && _vv ? { top: _vv.offsetTop, height: _vv.height } : null;
    const show = stickyBarShows({ inLayoutView: _inLayoutView, keyboardUp: _keyboardUp,
      figure: visual ? netDisplay.getBoundingClientRect() : null, visual });
    stickyBar.classList.toggle('visible', show);
    document.body.classList.toggle('sticky-active', show);
    // A BAR OVER THE KEYS MUST NOT COVER THE BOX BEING TYPED IN. iOS scrolls a focused field to
    // just above the keyboard — which is where the pinned bar now sits — so move the page by the
    // difference (`scrollToClearBar`). ONCE per field per focus: a member who then scrolls it back
    // under the bar on purpose is not fought, and the scroll this causes cannot re-trigger it.
    const f = document.activeElement;
    if (!show || !visual || !f || f === _clearedFor || !/^(INPUT|TEXTAREA|SELECT)$/.test(f.tagName)) return;
    const dy = scrollToClearBar({ field: f.getBoundingClientRect(), visual, barHeight: stickyBar.offsetHeight });
    if (dy > 0) { _clearedFor = f; window.scrollBy(0, dy); }
  };
  // rAF wrapper prevents class-toggle flicker during iOS momentum scroll, where
  // IntersectionObserver can fire repeatedly within a single frame — coalesced, so a burst of
  // observer and scroll callbacks is one decision per frame.
  let _queued = false;
  const _applySoon = () => {
    if (_queued) return;
    _queued = true;
    requestAnimationFrame(() => { _queued = false; _apply(); });
  };
  const obs = new IntersectionObserver(([entry]) => {
    _inLayoutView = entry.isIntersecting;
    _applySoon();
  }, { threshold: 0, rootMargin: `-${TOP_INSET}px 0px 0px 0px` });
  obs.observe(netDisplay);
  // PIN the sticky bar to the top of the iOS soft keyboard (v21.65 — was hide, and the hide
  // WAS the staff-reported "pay total is slow to update on iOS"). iOS anchors position:fixed
  // to the LAYOUT viewport, which the keyboard does not shrink — a fixed-bottom bar sits
  // behind the keyboard while typing. v16.19 answered that by hiding the bar (`display:none`)
  // until a focusout timer + the dismiss animation brought it back, which meant the one
  // moment the live figure matters most — while entering hours — iOS showed nothing, then
  // "updated" half a second after the keyboard went down. Android resizes the viewport, so
  // the same bar rides above the keyboard and updates per keystroke; this gives iOS the same
  // behaviour by translating the bar up by the visual-viewport gap (glued on vv resize AND
  // scroll — iOS pans the visual viewport while the keyboard is open). The maths was never
  // slow; the figure was invisible. Needs real-iOS verification, like the code it replaces.
  if (_vv) {
    let _inputFocused = false;
    let _baseVVH = _vv.height;
    const _pinSticky = () => {
      const keyboardUp = window.matchMedia('(pointer: coarse)').matches
          && _inputFocused && (_baseVVH - _vv.height) > 120;
      _keyboardUp = keyboardUp;
      stickyBar.classList.toggle('keyboard-up', keyboardUp);
      // The desktop rule centres the bar with translateX(-50%); an iPad soft keyboard can
      // satisfy both, so compose rather than replace — a bare translateY would throw the
      // bar to the left edge for exactly that user.
      const _centred = window.matchMedia('(min-width: 1024px)').matches ? 'translateX(-50%) ' : '';
      stickyBar.style.transform = keyboardUp
        ? `${_centred}translateY(-${Math.max(0, window.innerHeight - _vv.height - _vv.offsetTop)}px)`
        : '';
      _apply();   // the keyboard moved, so the visible area did: re-decide in the same frame as the pin
    };

    document.addEventListener('focusin', e => {
      _inputFocused = /^(INPUT|TEXTAREA|SELECT)$/.test(/** @type {Element} */ (e.target).tagName);
      // Field to field with the keyboard already up: no viewport event may follow (the new box can
      // already be in view, under the bar), so look at it now.
      if (_keyboardUp) _applySoon();
    });
    // With the keyboard up, scrolling the PAGE moves the figure in and out of the visible area
    // without the observer noticing — the figure can stay inside the layout viewport throughout.
    window.addEventListener('scroll', () => { if (_keyboardUp) _applySoon(); }, { passive: true });

    document.addEventListener('focusout', () => {
      _inputFocused = false;
      _clearedFor = null;
      // Defer BOTH the keyboard-up removal AND the baseline rebase behind the same
      // !_inputFocused check. Moving directly from one field to the next fires
      // focusout→focusin, so an input is refocused before this timer runs and the soft
      // keyboard never actually goes down — meaning no visualViewport 'resize' fires to
      // re-add keyboard-up. Removing the class UNCONDITIONALLY on focusout therefore
      // re-showed the bar floating over the keyboard/active field the moment you tabbed
      // between hours fields, for the rest of the typing session (v16.19). Rebasing
      // _baseVVH here (only when the keyboard is genuinely down) is the pre-existing guard.
      // (Both are conservative — they can only skip a bad update. Needs real-iOS
      // verification: visualViewport keyboard behaviour can't be reproduced in headless/e2e.)
      setTimeout(() => {
        if (!_inputFocused) {
          _baseVVH = _vv.height;
          _pinSticky();
        }
      }, 300);
    });

    // Touch devices only (checked inside _pinSticky): the >120px shrink heuristic detects
    // the SOFT keyboard. On desktop (v16.12 — the bar runs there too) a window resize or
    // docked DevTools with an input focused is not a keyboard and must not move the bar.
    _vv.addEventListener('resize', _pinSticky, { passive: true });
    _vv.addEventListener('scroll', _pinSticky, { passive: true });
  }
  // ONE TAP WITH THE KEYPAD UP (the iPhone audit, 7 Nov 2026). The bar matters most while a field
  // is being typed in, which is exactly when iOS cancelled its click — the keyboard's dismissal
  // shifts the viewport and the tap never becomes a click — so it took two. It now goes through the
  // calculator's one guarded tap (`wireIosTap`, paycalc-inputs.js), letting go of the field first as
  // a native tap would, so the member lands on the result with the keyboard down.
  wireIosTap(stickyBar, () => resultCard.scrollIntoView({ behavior: 'smooth', block: 'start' }), { releaseFocus: true });
  stickyBar.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault(); // Space must not also scroll the page
      resultCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
}
