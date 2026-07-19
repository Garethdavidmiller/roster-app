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
    searchInput.addEventListener('input', function () { applyCountryFilter(searchInput.value); });
    searchInput.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && searchInput.value) { e.preventDefault(); searchInput.value = ''; applyCountryFilter(''); }
    });
}
if (clearBtn && searchInput) {
    clearBtn.addEventListener('click', function () { searchInput.value = ''; applyCountryFilter(''); searchInput.focus(); });
}

// ── Section chip-bar: sticky quick-nav to the major sections (v17.66) ──────────────────────────
document.querySelector('.chip-bar')?.addEventListener('click', function (e) {
    var chip = /** @type {HTMLElement|null} */ (/** @type {Element} */ (e.target).closest('.chip'));
    if (!chip) return;
    var target = document.getElementById(chip.dataset.target || '');
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // Land focus on the section (keyboard / screen-reader users) and mark the active chip.
    target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
    document.querySelectorAll('.chip-bar .chip[aria-current]').forEach(function (c) { c.removeAttribute('aria-current'); });
    chip.setAttribute('aria-current', 'true');
});

// Sit the sticky chip-bar directly under the sticky header, then set scroll-margin-top on every jump
// target (section headings + country cards) so a jump isn't hidden under header + chip-bar. Runs
// after fonts load so the header height is measured accurately (mirrors railcard-guide.js).
function adjustFipOffsets() {
    var hdr = /** @type {HTMLElement|null} */ (document.querySelector('.page-header'));
    var bar = /** @type {HTMLElement|null} */ (document.querySelector('.chip-bar'));
    if (!hdr || !bar) return;
    var hdrH = hdr.offsetHeight;
    bar.style.top = hdrH + 'px';
    var stickyH = hdrH + bar.offsetHeight + 8;
    document.querySelectorAll('.section-label[id], [id^="country-"]').forEach(function (el) {
        /** @type {HTMLElement} */ (el).style.scrollMarginTop = stickyH + 'px';
    });
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
