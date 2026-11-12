// @ts-check
// guide-chips.js — the "Jump to section" chip bar, shared by four guides: Railcard, Rangers & Rovers,
// the Staff & Admin Guide and the Pay Calculator Guide. A classic `defer` script with no exports, run
// once against the page's `<nav class="chip-bar">` of `<button class="chip" data-target="ID">`.
//
// It owns four things, and each has already produced a real bug on some guide:
//   1. the JUMP — a chip scrolls to its section (instantly under Reduce Motion) and lands focus there;
//   2. the SCROLLSPY — which chip is marked current while the reader scrolls, and after a jump or a link;
//   3. the STICKY STACK — the bar's `top` and every id's scroll margin, from the MEASURED header: a
//      stale `top` after a late font swap once let page content show through the gap (v18.82);
//   4. the DEEP-LINK LANDING — a search result opened at a #fragment lands below that stack.
//
// ONE COPY (Nov 2026). This was railcard-guide.js and rangers-guide.js, identical but for their
// comments, and the chip bar arriving on the two document guides would have made it four. A classic
// script needs no module to be shared: each page loads this file. fip-guide.js still carries the same
// blocks, woven into its country finder — a jump there also opens the country's <details>.
// The ⤓ PDF button is guide-print.js's, and the ← arrow is guide-back.js's.

var chipBar = /** @type {HTMLElement|null} */ (document.querySelector('.chip-bar'));
var reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

// [{ chip, section }] for the chipped sections, in chip-bar order — which is document order.
var chipTargets = chipBar
    ? Array.prototype.slice.call(chipBar.querySelectorAll('.chip')).map(function (c) {
        var chip = /** @type {HTMLElement} */ (c);
        return { chip: chip, section: document.getElementById(chip.dataset.target || '') };
    }).filter(function (t) { return t.section; })
    : [];

/** @type {HTMLElement|null} */
var activeChip = null;

/** Mark at most one chip current (idempotent) and reveal it within the horizontally-scrollable bar. */
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

// ── Scrollspy ─────────────────────────────────────────────────────────────────────────────────────
// On a page read top to bottom, the current section is the LAST chipped section whose top has scrolled
// up past the sticky header + chip bar. Above the first section the first chip wins (it covers the page
// intro); at the bottom of the page the last chip wins (a short final section may never reach the line).
// A section whose heading sits inside a navy banner (the Staff Guide's "Admin Guide") starts where its
// BANNER starts, because that is where a jump or a link puts it (adjustScrollOffsets): measured to the
// heading, the banner sat under the bar while the bar still named the section before it.
//
// TWO COLUMNS HAVE NO CURRENT SECTION. The two document guides set their sections side by side from
// 641px (guide-doc.css), so on a desktop "What It Does" and "Pay Types" begin on the same line, and
// which of them is being read is up to the reader's eye, not the scroll position. The rule above
// would light a right-hand chip while the left column was being read. So it runs only while the
// chipped sections still read top to bottom — measured from where they ARE (`oneColumn`), not from a
// width, so a change to that breakpoint cannot leave this behind. On two columns a chip is current
// only after a jump or a link to it.
//
// A JUMP'S CHIP HOLDS UNTIL THE READER MOVES ON. The chip just chosen answers "where am I" for as long
// as its section stays where the jump put it — even where the rule above would answer differently: a
// section near the end of the page cannot scroll up to the line, and at the bottom the last chip wins.
// The section moving more than 2px hands the bar back to the rule, and so does a jump that never
// arrived because the reader stopped it (jumpArrived). It is the SECTION that is watched, not the
// scroll position: a resize, or a phone turned on its side, reflows the page without scrolling it,
// and a hold kept by the scroll position went on naming a section that was no longer at the top.
//
// A LINK HOLDS THE SAME WAY. A search result or a shared link opened at a #fragment is a jump the
// reader chose before the page existed. So the chip of the section it lands in (chipFor: a link can
// name a card inside a section) is lit from the first paint and held through the landing below, and
// then on a tap's terms. The tap's arrival rule does not judge it: the landing moves the target more
// than once, and on the narrowest phones leaves it below the line on purpose. It holds if its target
// is on screen when the landing ends. A reload or Back/Forward restores the reader's own position,
// not the link, so it holds nothing; nor does a hash changed in place — the guides carry no in-page
// links, so that is a fragment typed by hand, or Back across one — which ends the link's answer.
var spyPaused = false;
var spyTimer = 0;
var spyTicking = false;
var spyThreshold = 106;   // header + chip-bar + margin; measured for real once the header lays out
var oneColumn = true;
/** @type {HTMLElement|null} */
var jumpChip = null;      // the chip a jump or a link holds lit
/** @type {Element|null} */
var jumpEl = null;        // what the jump or link put in place: the chip's heading, or the linked element
var jumpTop = NaN;        // where that was left, in viewport pixels; NaN while still in flight
var jumpByLink = false;   // the hold is a link's: the landing settles it, not the tap's arrival rule

/** The top of what a jump or link put in place, in viewport pixels; NaN once it has gone or is hidden. */
function heldTop() {
    return jumpEl && jumpEl.isConnected && jumpEl.getClientRects().length ? jumpEl.getBoundingClientRect().top : NaN;
}

/** Where a chipped section starts on screen: its banner's top if its heading sits in one. @param {Element} heading */
function sectionStart(heading) {
    return (heading.closest('.guide-header') || heading).getBoundingClientRect().top;
}

/** Cache the sticky-stack height and the layout, so the scroll handler never forces a layout read per frame. */
function measureSpy() {
    var hdr = /** @type {HTMLElement|null} */ (document.querySelector('.page-header'));
    spyThreshold = (hdr ? hdr.offsetHeight : 54) + (chipBar ? chipBar.offsetHeight : 40) + 12;
    oneColumn = true;
    var prev = -Infinity;
    for (var i = 0; i < chipTargets.length; i++) {
        var r = /** @type {HTMLElement} */ (chipTargets[i].section).getBoundingClientRect();
        if (!r.width && !r.height) continue;   // not laid out (display:none) — says nothing about columns
        if (r.top < prev - 1) { oneColumn = false; break; }
        prev = r.top;
    }
}

/** @returns {HTMLElement|null} */
function currentChip() {
    if (!chipTargets.length) return null;
    if (jumpChip) {
        if (isNaN(jumpTop) || Math.abs(heldTop() - jumpTop) <= 2) return jumpChip;
        jumpChip = null;   // the reader has moved on; the jump's answer does not come back
    }
    if (!oneColumn) return null;
    if (Math.ceil(window.innerHeight + window.scrollY) >= document.documentElement.scrollHeight - 2) {
        return chipTargets[chipTargets.length - 1].chip;
    }
    var chosen = chipTargets[0].chip;
    for (var i = 0; i < chipTargets.length; i++) {
        if (sectionStart(/** @type {HTMLElement} */ (chipTargets[i].section)) <= spyThreshold) chosen = chipTargets[i].chip;
        else break;
    }
    return chosen;
}
function updateSpy() { if (!spyPaused) setActiveChip(currentChip()); }

/**
 * Did the jump ARRIVE? Its section sits at the line it was sent to (its own scroll margin), or the page
 * ran out below it. A scroll that settled anywhere else was the reader's, not the jump's — a finger that
 * stopped the smooth scroll halfway leaves the page where the reader wants it, and the chip must not
 * claim a section the reader is not at.
 * @param {Element} target
 */
function jumpArrived(target) {
    var top = target.getBoundingClientRect().top;
    var line = parseFloat(getComputedStyle(target).scrollMarginTop) || 0;
    var atBottom = Math.ceil(window.innerHeight + window.scrollY) >= document.documentElement.scrollHeight - 2;
    return Math.abs(top - line) <= 2 || (atBottom && top > line);
}

/** Lift the post-click pause, note where an arrived jump settled, and reconcile the active chip there. */
function resumeSpy() {
    spyPaused = false;
    if (spyTimer) { clearTimeout(spyTimer); spyTimer = 0; }
    // A link's hold is the landing's to settle (endLanding): the landing's own scrolls end too, and
    // judged here the first of them would fix the hold before the landing had finished moving it.
    if (jumpChip && !jumpByLink && isNaN(jumpTop)) {
        var top = heldTop();
        if (!isNaN(top) && jumpArrived(/** @type {Element} */ (jumpEl))) jumpTop = top;
        else jumpChip = null;
    }
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
        jumpChip = chip;
        jumpEl = target;
        jumpTop = NaN;
        jumpByLink = false;
        if (!reduceMotion) {
            spyPaused = true;
            if (spyTimer) clearTimeout(spyTimer);
            spyTimer = setTimeout(resumeSpy, 1500);   // ceiling fallback where scrollend is unsupported
        }
        target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
        if (reduceMotion) jumpTop = heldTop();   // an instant jump has already settled
        // Land focus on the section, so keyboard and screen-reader users arrive where the page did.
        target.setAttribute('tabindex', '-1');
        target.focus({ preventScroll: true });
    });
}

// ── Deep-link landing ─────────────────────────────────────────────────────────────────────────
// A guide-search result IS a deep link (rangers-guide.html#rr-thames). The browser scrolls to the
// #fragment as soon as the target is laid out, using the stylesheet's FALLBACK scroll-margin,
// because the real sticky stack is known only once adjustScrollOffsets has measured it — and
// Chromium stops re-applying a fragment once the page has loaded. On a phone serving the page from
// its cache the load usually finishes first, so a card arrived with its name under the chip bar
// (whole-app review, Nov 2026: 48px short at 375px). So each measurement re-lands the fragment
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

/**
 * The chip of the section an element sits in: the last chipped heading at or before it in the page.
 * A link can name a card or a sub-heading inside a section; one before the first section has none.
 * @param {Element} el
 */
function chipFor(el) {
    /** @type {HTMLElement|null} */
    var found = null;
    for (var i = 0; i < chipTargets.length; i++) {
        var heading = /** @type {HTMLElement} */ (chipTargets[i].section);
        if (heading !== el && !(heading.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)) break;
        found = chipTargets[i].chip;
    }
    return found;
}
// The link's chip holds from the first paint (the Scrollspy note): the spy starts below this block.
(function () {
    var target = landingId ? document.getElementById(landingId) : null;
    var chip = target ? chipFor(target) : null;
    if (!chip) return;
    jumpChip = chip;
    jumpEl = target;
    jumpTop = NaN;
    jumpByLink = true;
})();

/** The landing is over. A link's hold now stands where the landing left its target — if the reader can see it. */
function endLanding() {
    landingId = '';
    if (jumpChip && jumpByLink && isNaN(jumpTop)) {
        var top = heldTop();
        if (top >= 0 && top < window.innerHeight) jumpTop = top;
        else { jumpChip = null; updateSpy(); }
    }
}
['pointerdown', 'touchstart', 'wheel', 'keydown'].forEach(function (type) {
    window.addEventListener(type, endLanding, { capture: true, passive: true });
});
// A hash changed in place is not the link the page opened on, so that link's answer goes with it.
window.addEventListener('hashchange', function () {
    if (jumpByLink) jumpChip = null;
    endLanding();
    updateSpy();
});

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

// The spy starts here, after the landing block has set any link's hold, so its first paint already
// lights the link's chip rather than whichever one the scroll position would.
if (chipTargets.length) {
    measureSpy();
    window.addEventListener('scroll', function () {
        if (spyTicking) return;
        spyTicking = true;
        // finally: a throw in updateSpy must never latch spyTicking true (that would kill the spy).
        requestAnimationFrame(function () { try { updateSpy(); } finally { spyTicking = false; } });
    }, { passive: true });
    window.addEventListener('resize', function () { measureSpy(); updateSpy(); }, { passive: true });
    // scrollend lifts the click pause exactly when the smooth scroll settles.
    window.addEventListener('scrollend', resumeSpy);
    updateSpy();
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
    // A heading inside a navy banner (the Staff Guide's "Admin Guide" divider, guide-doc.css's
    // `.guide-header`) lands with its BANNER clear of the stack, not just its words: measured to the
    // words alone, the banner's top edge and icon went under the chip bar.
    document.querySelectorAll('main [id]').forEach(function (el) {
        var banner = el.closest('.guide-header');
        var inset = banner ? el.getBoundingClientRect().top - banner.getBoundingClientRect().top : 0;
        /** @type {HTMLElement} */ (el).style.scrollMarginTop = (stickyH + Math.max(0, inset)) + 'px';
    });
    keepLandingClear(stickyH);
    measureSpy();   // keep the cached threshold and layout in step with the real header height
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
// content shows through the gap (v18.82; mirrors fip-guide.js). The BAR is watched as well: a bar
// that wraps (guide-shell.css) gains or loses a row without the header changing at all — a window
// made taller or shorter across 600px — and margins measured for one row landed a jump under the
// second. Only the lit chip's colours change, never its size, so this cannot feed itself.
if (typeof ResizeObserver === 'function') {
    var _hdrEl = document.querySelector('.page-header');
    if (_hdrEl) {
        var _roScheduled = false;
        var _stackObserver = new ResizeObserver(function () {
            if (_roScheduled) return;
            _roScheduled = true;
            requestAnimationFrame(function () { _roScheduled = false; adjustScrollOffsets(); });
        });
        _stackObserver.observe(_hdrEl);
        if (chipBar) _stackObserver.observe(chipBar);
    }
}
