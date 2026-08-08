// @ts-check
// Rangers & Rovers Guide — interactive behaviours.
//
// A near-copy of railcard-guide.js, deliberately: the two pages share the sticky header + chip-bar
// stack, and that stack has already produced one real bug (v18.82 — a stale sticky `top` after a
// late font swap let page content show through the gap). Re-deriving it here would re-open that.
// The ONLY differences are the selectors this page's cards use.
// Print / Save as PDF button
document.getElementById('savePdfBtn')?.addEventListener('click', function () {
    window.print();
});

// Chip-bar navigation: click a chip → smooth-scroll to the target section
document.querySelector('.chip-bar')?.addEventListener('click', function (e) {
    var chip = /** @type {HTMLElement|null} */ (/** @type {Element} */ (e.target).closest('.chip'));
    if (!chip) return;
    var target = document.getElementById(chip.dataset.target ?? '');
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // Move focus to the jumped-to section and mark the active chip, so keyboard
    // and screen-reader users land on the target and hear which chip is current
    // (without this the viewport scrolls but focus stays on the chip).
    target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
    document.querySelectorAll('.chip-bar .chip[aria-current]').forEach(function (c) {
        c.removeAttribute('aria-current');
    });
    chip.setAttribute('aria-current', 'true');
});

// Adjust sticky chip-bar top offset to sit directly below the sticky page header,
// then set scroll-margin-top on every card and section so they aren't hidden
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
    document.querySelectorAll('.rr-card, .rr-no-item, .section').forEach(function (el) {
        /** @type {HTMLElement} */ (el).style.scrollMarginTop = stickyH + 'px';
    });
}
if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(adjustScrollOffsets);
} else {
    requestAnimationFrame(adjustScrollOffsets);
}
// Re-sync the sticky stack whenever the header's box changes after the one-shot measurement (late
// font swap, font-scale change, rotation) — else the chip-bar's sticky `top` goes stale and page
// content shows through the gap (v18.82; mirrors fip.js).
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
