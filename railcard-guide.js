// @ts-check
// Railcard Guide — interactive behaviours
// The Print / Save as PDF button is wired by the shared guide-print.js (a module since v24.61 — it
// is where the iOS home-screen print guard lives, so no guide may keep a private copy).

// ── Section chip-bar: quick-nav + scrollspy, ported from fip-guide.js ──────────────────────────
// This bar had drifted from the FIP one (whole-app review, Nov 2026): it smooth-scrolled even with
// Reduce Motion on — a scroll of several thousand pixels — and the chip it marked current stayed
// current after the reader had scrolled elsewhere, naming one section over another. The FIP bar's
// scrollspy answered both, so this is that code; rangers-guide.js carries the same block.
var chipBar = /** @type {HTMLElement|null} */ (document.querySelector('.chip-bar'));
var reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

// [{ chip, section }] for the chipped sections, in document (== chip-bar) order.
var chipTargets = chipBar
    ? Array.prototype.slice.call(chipBar.querySelectorAll('.chip')).map(function (c) {
        var chip = /** @type {HTMLElement} */ (c);
        return { chip: chip, section: document.getElementById(chip.dataset.target || '') };
    }).filter(function (t) { return t.section; })
    : [];

/** @type {HTMLElement|null} */
var activeChip = null;

/** Mark exactly one chip current (idempotent) and reveal it within the horizontally-scrollable bar. */
function setActiveChip(/** @type {HTMLElement|null} */ chip) {
    if (chip === activeChip) return;
    if (activeChip) activeChip.removeAttribute('aria-current');
    activeChip = chip;
    if (!chip || !chipBar) return;
    chip.setAttribute('aria-current', 'true');
    // Centre the active chip; this scrolls ONLY the bar's own horizontal overflow, never the page.
    var left = chip.offsetLeft - (chipBar.clientWidth - chip.offsetWidth) / 2;
    var max = chipBar.scrollWidth - chipBar.clientWidth;
    chipBar.scrollTo({ left: Math.max(0, Math.min(left, max)), behavior: reduceMotion ? 'auto' : 'smooth' });
}

// Scrollspy: the current section is the LAST chipped section whose top has scrolled below the sticky
// header + chip-bar. Above the first section the first chip wins (covers the page intro); at the page
// bottom the last chip wins (a short final section may never reach the line).
var spyPaused = false;
var spyTimer = 0;
var spyTicking = false;
var spyThreshold = 106;   // header + chip-bar + margin; measured for real once the header lays out

/** Cache the sticky-stack height so the scroll handler never forces a layout read per frame. */
function measureThreshold() {
    var hdr = /** @type {HTMLElement|null} */ (document.querySelector('.page-header'));
    spyThreshold = (hdr ? hdr.offsetHeight : 54) + (chipBar ? chipBar.offsetHeight : 40) + 12;
}

/** @returns {HTMLElement|null} */
function currentChip() {
    if (!chipTargets.length) return null;
    if (Math.ceil(window.innerHeight + window.scrollY) >= document.documentElement.scrollHeight - 2) {
        return chipTargets[chipTargets.length - 1].chip;
    }
    var chosen = chipTargets[0].chip;
    for (var i = 0; i < chipTargets.length; i++) {
        var sec = /** @type {HTMLElement} */ (chipTargets[i].section);
        if (sec.getBoundingClientRect().top <= spyThreshold) chosen = chipTargets[i].chip;
        else break;
    }
    return chosen;
}
function updateSpy() { if (!spyPaused) setActiveChip(currentChip()); }

/** Lift the post-click pause and reconcile the active chip to the settled scroll position. */
function resumeSpy() { spyPaused = false; if (spyTimer) { clearTimeout(spyTimer); spyTimer = 0; } updateSpy(); }

if (chipTargets.length) {
    measureThreshold();
    window.addEventListener('scroll', function () {
        if (spyTicking) return;
        spyTicking = true;
        // finally: a throw in updateSpy must never latch spyTicking true (that would kill the spy).
        requestAnimationFrame(function () { try { updateSpy(); } finally { spyTicking = false; } });
    }, { passive: true });
    window.addEventListener('resize', function () { measureThreshold(); updateSpy(); }, { passive: true });
    // scrollend lifts the click pause exactly when the smooth scroll settles.
    window.addEventListener('scrollend', resumeSpy);
    updateSpy();
}

// Chip click → scroll to the section (instantly under Reduce Motion), focus it, mark it current. While
// a smooth scroll is in flight the spy is paused, so mid-flight frames don't light other chips;
// scrollend (or the fallback timer, for engines without it) resumes it on landing.
if (chipBar) {
    chipBar.addEventListener('click', function (e) {
        var chip = /** @type {HTMLElement|null} */ (/** @type {Element} */ (e.target).closest('.chip'));
        if (!chip) return;
        var target = document.getElementById(chip.dataset.target || '');
        if (!target) return;
        setActiveChip(chip);
        if (!reduceMotion) {
            spyPaused = true;
            if (spyTimer) clearTimeout(spyTimer);
            spyTimer = setTimeout(resumeSpy, 1500);   // ceiling fallback where scrollend is unsupported
        }
        target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
        // Land focus on the section, so keyboard and screen-reader users arrive where the page did.
        target.setAttribute('tabindex', '-1');
        target.focus({ preventScroll: true });
    });
}

// ── Deep-link landing ─────────────────────────────────────────────────────────────────────────
// A guide-search result IS a deep link (railcard-guide.html#rc-senior). The browser scrolls to the
// #fragment as soon as the target is laid out, using the stylesheet's FALLBACK scroll-margin,
// because the real sticky stack is known only once adjustScrollOffsets has measured it — and
// Chromium stops re-applying a fragment once the page has loaded. On a phone serving the page from
// its cache the load usually finishes first, so a card arrived with its name under the chip bar
// (whole-app review, Nov 2026: 28px short at 375px). So each measurement re-lands the fragment
// itself while the page is still LANDING: until it has loaded and measured with its fonts, or the
// reader touches, clicks, scrolls with a wheel or types — whichever comes first. A reload or
// Back/Forward restores the reader's own position, not the fragment, so it is left alone.
var landingId = '';
(function () {
    var nav = /** @type {PerformanceNavigationTiming|undefined} */ (
        window.performance && performance.getEntriesByType ? performance.getEntriesByType('navigation')[0] : undefined);
    if (nav && nav.type !== 'navigate') return;
    try { landingId = decodeURIComponent(location.hash.slice(1)); } catch { landingId = ''; }
})();
function endLanding() { landingId = ''; }
['pointerdown', 'touchstart', 'wheel', 'keydown'].forEach(function (type) {
    window.addEventListener(type, endLanding, { capture: true, passive: true });
});
window.addEventListener('hashchange', endLanding);

/**
 * While the page is still landing on a deep link, move the target back out from under the sticky
 * stack. Only a target that STARTS under the stack is moved: one the page cannot scroll to the top
 * (near its end) sits lower and is left there, and so is one the reader has scrolled past.
 * @param {number} stickyH the measured header + chip bar, which a landed target must clear
 */
function keepLandingClear(stickyH) {
    if (!landingId) return;
    var target = document.getElementById(landingId);
    if (!target) { landingId = ''; return; }
    var top = target.getBoundingClientRect().top;
    if (top >= 0 && top < stickyH - 1) target.scrollIntoView({ block: 'start' });
}

// Adjust sticky chip-bar top offset to sit directly below the sticky page header,
// then set scroll-margin-top on every id in the page body so a jump to it isn't hidden
// under the combined sticky header + chip-bar height when scrolled into view.
// Runs after fonts are loaded so the header height measurement is accurate —
// measuring at rAF can give the wrong height if Inter hasn't applied yet and
// the subtitle wraps at a different line height under the fallback font.
function adjustScrollOffsets() {
    var hdr = /** @type {HTMLElement} */ (document.querySelector('.page-header'));
    var bar = /** @type {HTMLElement} */ (document.querySelector('.chip-bar'));
    var hdrH = hdr.offsetHeight;
    bar.style.top = hdrH + 'px';
    var stickyH = hdrH + bar.offsetHeight + 8;
    // EVERY id, not a list of card classes: anything with an id can be linked to, and one a list
    // missed kept the stylesheet's fallback margin (the FIP guide's ferry cards did, Nov 2026).
    document.querySelectorAll('main [id]').forEach(function (el) {
        /** @type {HTMLElement} */ (el).style.scrollMarginTop = stickyH + 'px';
    });
    keepLandingClear(stickyH);
    measureThreshold();   // keep the cached scrollspy threshold in step with the real header height
    updateSpy();
}
if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(adjustScrollOffsets);
} else {
    requestAnimationFrame(adjustScrollOffsets);
}
// The landing ends with one last measurement once the page has loaded AND its fonts are ready —
// the last point at which the sticky stack is still settling.
Promise.all([
    document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve(),
    document.readyState === 'complete' ? Promise.resolve()
        : new Promise(function (resolve) { window.addEventListener('load', resolve, { once: true }); }),
]).then(function () {
    requestAnimationFrame(function () { adjustScrollOffsets(); endLanding(); });
});
// Re-sync the sticky stack whenever the header's box changes after the one-shot measurement (late
// font swap, font-scale change, rotation) — else the chip-bar's sticky `top` goes stale and page
// content shows through the gap (v18.82; mirrors fip-guide.js).
if (typeof ResizeObserver === 'function') {
    var _hdrEl = document.querySelector('.page-header');
    if (_hdrEl) {
        var _roScheduled = false;
        new ResizeObserver(function () {
            if (_roScheduled) return;
            _roScheduled = true;
            requestAnimationFrame(function () { _roScheduled = false; adjustScrollOffsets(); });
        }).observe(_hdrEl);
    }
}
