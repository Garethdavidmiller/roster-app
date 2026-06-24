// @ts-check
// Railcard Guide — interactive behaviours
// Print / Save as PDF button
document.getElementById('savePdfBtn').addEventListener('click', function () {
    window.print();
});

// Chip-bar navigation: click a chip → smooth-scroll to the target section
document.querySelector('.chip-bar').addEventListener('click', function (e) {
    var chip = e.target.closest('.chip');
    if (!chip) return;
    var target = document.getElementById(chip.dataset.target);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

// Adjust sticky chip-bar top offset to sit directly below the sticky page header,
// then set scroll-margin-top on every card and section so they aren't hidden
// under the combined sticky header + chip-bar height when scrolled into view.
// Runs after fonts are loaded so the header height measurement is accurate —
// measuring at rAF can give the wrong height if Inter hasn't applied yet and
// the subtitle wraps at a different line height under the fallback font.
function adjustScrollOffsets() {
    var hdr = document.querySelector('.page-header');
    var bar = document.querySelector('.chip-bar');
    var hdrH = hdr.offsetHeight;
    bar.style.top = hdrH + 'px';
    var stickyH = hdrH + bar.offsetHeight + 8;
    document.querySelectorAll('.rc, .section').forEach(function (el) {
        el.style.scrollMarginTop = stickyH + 'px';
    });
}
if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(adjustScrollOffsets);
} else {
    requestAnimationFrame(adjustScrollOffsets);
}
