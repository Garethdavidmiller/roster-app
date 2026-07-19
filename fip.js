// @ts-check
// FIP Travel Guide — country finder + open-on-jump behaviour.
//
// Two jobs, both progressive enhancement (CSP blocks inline scripts, so this is a `defer`-loaded
// external file like railcard-guide.js; with JS off the page still works — every country visible):
//   1. Country finder (v17.64): a search box live-filters the 25 country cards AND the A–Z jump
//      list by country name or operator/train text, so a 25-country reference is navigable at work.
//   2. Open-on-jump: the jump/popular links (#country-fr, …) point at native <details>. A bare
//      anchor-scroll lands ON the row but leaves it COLLAPSED (double taps). We open the target
//      <details> on a deep link, on every in-page jump, and — if it was filtered out — clear the
//      search first so the jump actually lands (C1).

/** decodeURIComponent that never throws — a malformed hash (e.g. a lone "%") would otherwise raise an
 *  uncaught URIError on load / hashchange. Falls back to the raw string (which matches no id → no-op). */
function safeDecode(/** @type {string} */ s) {
    try { return decodeURIComponent(s); } catch { return s; }
}

/** Open the <details> with the given id, if it is a collapsed <details>. @param {string} id */
function openDetails(id) {
    if (!id) return;
    var el = document.getElementById(id);
    if (el && el.tagName === 'DETAILS') {
        /** @type {HTMLDetailsElement} */ (el).open = true;
    }
}

// ── Country finder ────────────────────────────────────────────────────────────────────────────
var searchInput = /** @type {HTMLInputElement|null} */ (document.getElementById('countrySearch'));
var clearBtn    = document.getElementById('countryClear');
var countEl     = document.getElementById('countryCount');
var noMatchEl    = document.getElementById('countryNoMatch');
// The 25 country cards (23 <details> + 2 not-FIP <div>), each id="country-XX". (Finder control ids
// use no hyphen — countrySearch/countryClear/… — so they never match this "country-" selector.)
var countryCards = Array.prototype.slice.call(document.querySelectorAll('[id^="country-"]'));
// A–Z jump chips, kept in lockstep with their target card's visibility.
var jumpChips = Array.prototype.slice.call(document.querySelectorAll('.country-jump a[href^="#country-"]'));

function norm(/** @type {string} */ s) { return (s || '').toLowerCase().replace(/\s+/g, ' ').trim(); }

/** Filter the country cards + jump chips to the query (matched against each card's full text, so an
 *  operator/train name like "ÖBB" or "Railjet" finds its country too). Empty query resets. */
function applyCountryFilter(/** @type {string} */ raw) {
    var q = norm(raw);
    var shown = 0;
    countryCards.forEach(function (card) {
        var match = !q || norm(card.textContent || '').indexOf(q) !== -1;
        card.hidden = !match;
        if (match) shown++;
    });
    jumpChips.forEach(function (chip) {
        var target = document.getElementById((chip.getAttribute('href') || '').slice(1));
        chip.hidden = !!(target && target.hidden);
    });
    if (clearBtn) clearBtn.hidden = !q;
    if (countEl) {
        // Show the count only while filtering AND something matched — on zero matches the no-match
        // message is the sole live-region announcement (avoids a double aria-live read).
        var showCount = !!q && shown > 0;
        countEl.hidden = !showCount;
        countEl.textContent = showCount ? ('Showing ' + shown + ' of ' + countryCards.length + ' countries') : '';
    }
    if (noMatchEl) {
        var none = !!q && shown === 0;
        noMatchEl.hidden = !none;
        noMatchEl.textContent = none
            ? ('No countries or operators match “' + (searchInput ? searchInput.value.trim() : '') + '”. Try a different term, or clear the search.')
            : '';
    }
}

if (searchInput) {
    // Capture into a const so TS narrows it inside these callbacks (a closed-over `var` is not
    // narrowed — it could in principle be reassigned before the listener fires).
    const si = searchInput;
    si.addEventListener('input', function () { applyCountryFilter(si.value); });
    si.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && si.value) { e.preventDefault(); si.value = ''; applyCountryFilter(''); }
    });
}
if (clearBtn && searchInput) {
    const si = searchInput;
    clearBtn.addEventListener('click', function () { si.value = ''; applyCountryFilter(''); si.focus(); });
}

// ── Section chip-bar: sticky quick-nav + scrollspy (chip-bar v17.66, scrollspy v17.68) ─────────
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
// header + chip-bar. Above the first section the first chip wins (covers the page-intro); at the page
// bottom the last chip wins (a short final section may never reach the line). Non-chipped sections
// fall naturally into the zone of the preceding chipped section.
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
    // At (or a hair from) the very bottom, the last chip wins — a short final section may never scroll
    // its top up to the trigger line. Math.ceil absorbs sub-pixel scroll heights; the margin covers
    // browser-zoom / mobile-toolbar rounding that a tight `- 2` could miss (leaving the last chip unlit).
    if (Math.ceil(window.innerHeight + window.scrollY) >= document.documentElement.scrollHeight - 2) {
        return chipTargets[chipTargets.length - 1].chip;
    }
    var chosen = chipTargets[0].chip;   // default: first chip (page-intro sits above section 1)
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
    // scrollend lifts the click pause EXACTLY when the smooth scroll settles (no fixed-time guess), so
    // a long jump can't unpause mid-flight and flicker; harmless on a user's own free-scroll.
    window.addEventListener('scrollend', resumeSpy);
    updateSpy();   // initial highlight (re-run once fonts settle the header height, below)
}

// Chip click → smooth-scroll to the section, focus it, mark it active. While a NON-instant scroll is
// in flight, pause the spy so mid-flight frames don't flicker a different chip; scrollend (or the
// fallback timer, for engines without it) resumes it on landing. A reduced-motion (instant) jump
// lands immediately, so it needs no pause.
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
        // Land focus on the section (keyboard / screen-reader users).
        target.setAttribute('tabindex', '-1');
        target.focus({ preventScroll: true });
    });
}

// Sit the sticky chip-bar directly under the sticky header, then set scroll-margin-top on every jump
// target (section headings + country cards) so a jump isn't hidden under header + chip-bar. Runs
// after fonts load so the header height is measured accurately (mirrors railcard-guide.js).
function adjustFipOffsets() {
    if (!chipBar) return;
    var hdr = /** @type {HTMLElement|null} */ (document.querySelector('.page-header'));
    if (!hdr) return;
    var hdrH = hdr.offsetHeight;
    chipBar.style.top = hdrH + 'px';
    var stickyH = hdrH + chipBar.offsetHeight + 8;
    document.querySelectorAll('.section-label[id], [id^="country-"]').forEach(function (el) {
        /** @type {HTMLElement} */ (el).style.scrollMarginTop = stickyH + 'px';
    });
    measureThreshold();   // keep the cached scrollspy threshold in step with the real header height
    updateSpy();          // re-evaluate with the accurate header height
}
if (document.fonts && document.fonts.ready) { document.fonts.ready.then(adjustFipOffsets); }
else { requestAnimationFrame(adjustFipOffsets); }

// ── Open-on-jump ──────────────────────────────────────────────────────────────────────────────

/** Open whatever the current URL hash points at (deep links + back/forward navigation). */
function openHashTarget() {
    openDetails(safeDecode(location.hash.slice(1)));
}

window.addEventListener('hashchange', openHashTarget);

// Delegated click for EVERY country jump link (A–Z chips, the popular shortcuts, and in-body links):
// re-tapping a link whose hash is already current fires no hashchange, so this covers "closed it,
// tapped the same country again". If the target is currently filtered OUT, clear the search first so
// the jump actually reveals it. Idempotent with the hashchange handler.
document.addEventListener('click', function (e) {
    var a = /** @type {HTMLAnchorElement|null} */ (
        /** @type {Element} */ (e.target).closest && /** @type {Element} */ (e.target).closest('a[href^="#country-"]'));
    if (!a) return;
    var id = safeDecode((a.getAttribute('href') || '').slice(1));
    var target = document.getElementById(id);
    if (target && target.hidden && searchInput && searchInput.value) {
        searchInput.value = '';
        applyCountryFilter('');   // reveal all so the jump lands on the now-visible card
    }
    openDetails(id);
});

openHashTarget();   // first load: honour a deep link (defer → the DOM is already parsed)
