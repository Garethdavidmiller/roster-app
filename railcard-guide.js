// @ts-check
// Railcard Guide — interactive behaviours
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
    document.querySelectorAll('.rc, .section').forEach(function (el) {
        /** @type {HTMLElement} */ (el).style.scrollMarginTop = stickyH + 'px';
    });
}
if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(adjustScrollOffsets);
} else {
    requestAnimationFrame(adjustScrollOffsets);
}
