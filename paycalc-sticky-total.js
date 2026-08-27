// @ts-check
/**
 * paycalc-sticky-total.js — the bar that keeps the take-home figure on screen.
 *
 * ── WHAT IT IS ──────────────────────────────────────────────────────────────────────────────────
 *
 * A small state machine with three inputs and one output. The inputs are whether the result figure
 * is in the viewport (IntersectionObserver), whether a field is focused, and where the visual
 * viewport currently sits; the output is whether `#stickyTotal` is shown and how far up it is
 * translated. It touches no money, no period, no storage and no calculation — the figure inside it
 * is written by `calculate()`, which does not know this file exists.
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
 *
 * None of this is reproducible in headless or e2e — visual-viewport keyboard behaviour needs a real
 * device — which is precisely why the reasoning is written down beside it rather than assumed.
 */

/**
 * Wire the sticky take-home bar. Safe to call when the elements are absent.
 * @returns {void}
 */
export function initPaycalcStickyTotal() {
  const stickyBar  = document.getElementById('stickyTotal');
  const resultCard = document.querySelector('.result-card');
  if (!stickyBar || !resultCard || !('IntersectionObserver' in window)) return;
  // v16.12: no desktop skip — the bar runs at every width now. On desktop it backstops
  // the footer rows below the sticky col-3 result rail (v16.14): the rail keeps the live
  // figure visible across the work area, the bar covers the scroll past it.
  // Defensive single-init guard. init() runs exactly once (paycalc-boot.js), and a bfcache
  // restore THAWS the frozen document rather than re-executing module code — so this IIFE
  // does NOT re-run on a Back/Forward restore. The guard only matters if init() is ever
  // wired to run twice. An IntersectionObserver survives the bfcache freeze/thaw intact,
  // so there is deliberately NO pagehide-disconnect: a prior version disconnected the
  // observer on navigate-away and, because the IIFE never re-runs, nothing reconnected it —
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
  // rAF wrapper prevents class-toggle flicker during iOS momentum scroll, where
  // IntersectionObserver can fire repeatedly within a single frame.
  const obs = new IntersectionObserver(([entry]) => {
    requestAnimationFrame(() => {
      const show = !entry.isIntersecting;
      stickyBar.classList.toggle('visible', show);
      document.body.classList.toggle('sticky-active', show);
    });
  }, { threshold: 0, rootMargin: '-8px 0px 0px 0px' });
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
  if (window.visualViewport) {
    const _vv = window.visualViewport;
    let _inputFocused = false;
    let _baseVVH = _vv.height;
    const _pinSticky = () => {
      const keyboardUp = window.matchMedia('(pointer: coarse)').matches
          && _inputFocused && (_baseVVH - _vv.height) > 120;
      stickyBar.classList.toggle('keyboard-up', keyboardUp);
      // The desktop rule centres the bar with translateX(-50%); an iPad soft keyboard can
      // satisfy both, so compose rather than replace — a bare translateY would throw the
      // bar to the left edge for exactly that user.
      const _centred = window.matchMedia('(min-width: 1024px)').matches ? 'translateX(-50%) ' : '';
      stickyBar.style.transform = keyboardUp
        ? `${_centred}translateY(-${Math.max(0, window.innerHeight - _vv.height - _vv.offsetTop)}px)`
        : '';
    };

    document.addEventListener('focusin', e => {
      _inputFocused = /^(INPUT|TEXTAREA|SELECT)$/.test(/** @type {Element} */ (e.target).tagName);
    });

    document.addEventListener('focusout', () => {
      _inputFocused = false;
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
  stickyBar.addEventListener('click', () =>
    resultCard.scrollIntoView({ behavior: 'smooth', block: 'start' })
  );
  stickyBar.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault(); // Space must not also scroll the page
      resultCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
}
