// @ts-check
// FIP Travel Guide — country finder, open-on-jump and print preparation.
//
// Three jobs, all progressive enhancement (CSP blocks inline scripts, so this is a `defer`-loaded
// external file; with JS off the page still works — every country visible):
//   1. Country finder (v17.64): a search box live-filters the country cards AND the A–Z jump
//      list by country name or operator/train text, so a long country reference is navigable at work.
//   2. Open-on-jump: the jump/popular links (#country-fr, …) point at native <details>. A bare
//      anchor-scroll lands ON the row but leaves it COLLAPSED (double taps). We open the target
//      <details> on a deep link, on every in-page jump, and — if it was filtered out — clear the
//      search first so the jump actually lands (C1).
//   3. Print: open every country for the PDF, print what the finder is showing, and the per-country
//      "⤓ Print <country>" buttons; guide-print.js does the printing.
//
// THE CHIP BAR IS NOT THIS FILE'S (Nov 2026). It is guide-chips.js's, as on every other guide, loaded
// before this one. This file used to carry its own copy of the bar, woven between the finder and the
// jump and held to the shared one only by four exact strings, so a change to one copy's arrival
// tolerance passed with the other untouched. Nothing here needs the bar's internals: a chip
// jumps to a section heading, never to a country, and the country links open their card below.

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
// The country cards (<details>, plus the not-FIP <div>s), each id="country-XX". **Never write the
// count down** — it was "25" until the v20.25 audit made it 32, and a number in a comment is a
// claim nobody re-checks. The finder counts the DOM. (Finder control ids
// use no hyphen — countrySearch/countryClear/… — so they never match this "country-" selector.)
// They are CARDS, and the count says so: one is Lake Constance's ferries, which is not a country,
// so "3 of 32 countries" counted a lake (whole-app check, Nov 2026).
var countryCards = Array.prototype.slice.call(document.querySelectorAll('[id^="country-"]'));
// A–Z jump chips, kept in lockstep with their target card's visibility.
var jumpChips = Array.prototype.slice.call(document.querySelectorAll('.country-jump a[href^="#country-"]'));

function norm(/** @type {string} */ s) { return (s || '').toLowerCase().replace(/\s+/g, ' ').trim(); }

/**
 * The WORDS of a text, accents folded — the way the drawer's cross-guide search reads it
 * (guide-search.js `tokeniseText`). The finder lower-cased and nothing else, so "obb", "mav" and
 * "krakow" — an operator or city typed on a UK keyboard — found nothing, and "cie" matched the middle
 * of "Société" and offered Switzerland instead of Ireland (whole-app review, Oct 2026).
 * A stroke or a ligature is part of its letter, so NFKD cannot take it off: "Łódź", "ŁKA" and
 * "København" fell apart at the Ł or the ø (Nov 2026). The same table as guide-search.js's
 * WHOLE_LETTERS, kept inside this function so guide-search.test.mjs can run it beside the drawer's.
 * @param {string} s @returns {string[]}
 */
function foldWords(s) {
    /** @type {Record<string, string>} */
    var whole = { 'ł': 'l', 'đ': 'd', 'ø': 'o', 'æ': 'ae', 'œ': 'oe', 'ß': 'ss' };
    return (s || '').toLowerCase().replace(/[łđøæœß]/g, function (c) { return whole[c]; })
        .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
        .split(/[^a-z0-9]+/).filter(Boolean);
}
// Each card's words, read once: the cards are static, and the filter runs on every keystroke.
var cardWords = countryCards.map(function (card) { return foldWords(card.textContent || ''); });

var printBtn = document.querySelector('.btn-print');
/**
 * Say what the ⤓ PDF button will actually print, now that it prints what is on screen.
 *
 * The VISIBLE label stays "⤓ PDF": it is the shared `.btn-print` every guide carries, sitting in a
 * header with a back arrow beside it, and a label that changes length would move the header about
 * as the reader types. The accessible name is where the scope belongs — it is what a screen reader
 * announces and what a long-press or hover surfaces, and it costs the layout nothing. It STARTS
 * with "PDF", the word on the button (v25.27): somebody driving the page by voice says what they
 * see, and WCAG 2.5.3 (Label in Name) needs that word inside the name — axe checks it from 4.14.
 *
 * No page count is written here. The guide's length is measured elsewhere and would rot in a string.
 * @param {number|null} shown — how many country cards the filter is showing, or null when unfiltered.
 */
function describePrintScope(shown) {
    if (!printBtn) return;
    // "the guide with \u2026", not "the N countries": the general chapters print as well, and a name that
    // promised only countries would undersell the sheet by a dozen pages (whole-app review, Nov 2026).
    // CARDS, as the finder's count line says (above `countryCards`): one of them is a lake's ferries.
    var label = shown === null ? 'PDF \u2014 save or print the whole FIP guide'
        : shown === 0          ? 'PDF \u2014 save or print the guide without countries, as none matches your search'
        : shown === 1          ? 'PDF \u2014 save or print the 1 card shown, with what to carry and the key rules'
        :                        'PDF \u2014 save or print the ' + shown + ' cards shown, with what to carry and the key rules';
    printBtn.setAttribute('aria-label', label);
}
describePrintScope(null);

/** Filter the country cards + jump chips to the query (matched against each card's full text, so an
 *  operator/train name like "ÖBB" or "Railjet" finds its country too). Empty query resets. */
function applyCountryFilter(/** @type {string} */ raw) {
    var q = norm(raw);
    var terms = foldWords(raw);
    var shown = 0;
    countryCards.forEach(function (card, i) {
        // Every typed word must START a word of the card — accents folded on both sides.
        var match = !q || terms.every(function (t) {
            return cardWords[i].some(function (w) { return w.indexOf(t) === 0; });
        });
        card.hidden = !match;
        if (match) shown++;
    });
    jumpChips.forEach(function (chip) {
        var target = document.getElementById((chip.getAttribute('href') || '').slice(1));
        chip.hidden = !!(target && target.hidden);
    });
    if (clearBtn) clearBtn.hidden = !q;
    describePrintScope(q ? shown : null);
    if (countEl) {
        // Show the count only while filtering AND something matched — on zero matches the no-match
        // message is the sole live-region announcement (avoids a double aria-live read).
        var showCount = !!q && shown > 0;
        countEl.hidden = !showCount;
        // The second clause is the VISIBLE half of describePrintScope. The accessible name carries
        // the scope for a screen reader, but a sighted reader filtering to one country has nothing
        // on screen saying the ⤓ PDF button will follow their filter — and the whole reason that
        // behaviour exists is a traveller who wants one country, not 25 pages. It states the RULE
        // rather than repeating the number, so it reads correctly at one country and at twelve.
        countEl.textContent = showCount
            ? ('Showing ' + shown + ' of ' + countryCards.length + ' cards · the PDF saves these, with what to carry and the key rules')
            : '';
    }
    if (noMatchEl) {
        var none = !!q && shown === 0;
        noMatchEl.hidden = !none;
        // "No country CARD", and where the rest lives: the finder reads the country cards only, so
        // "No countries or operators match “Eurostar”" told a reader the page had nothing on an
        // operator it covers in a section of its own (whole-app review, Nov 2026).
        noMatchEl.textContent = none
            ? ('No country card matches “' + (searchInput ? searchInput.value.trim() : '')
                + '”. Eurostar and the ferries have their own sections — tap Eurostar or Ferries at the top. Or try a different term.')
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

// ── Print: expand every country ─────────────────────────────────────────────────────────────────
// The country cards are native <details>. Modern Chromium collapses a closed <details>'s body via
// the ::details-content pseudo (content-visibility), which the print CSS `.detail-body{display:block}`
// cannot reach — so a printed FIP guide showed each country as an empty bordered strip. Force every
// <details> OPEN for the print run, then restore the on-screen state afterwards, so the printout is
// the country reference the fip-guide.css @media print block already intends.
//
// IT PRINTS WHAT IS ON SCREEN (v23.27). Until now the prepare also UN-HID every card the finder had
// filtered out, on the reasoning that paper should carry the whole reference. That reasoning ignores
// why anybody presses this button: a traveller has searched "Belgium", is looking at one country,
// and gets 25 pages. Opening a collapsed card is a RENDERING repair — the content is on screen and
// the print engine would drop it. Un-hiding a filtered one is not; it overrides a choice the reader
// made deliberately, in the one direction that costs them a stack of paper at a station.
// The button now SAYS which it will do, from the same count the finder already computes.
//
// PREPARE ON THE BUTTON, NOT ONLY ON `beforeprint` (v23.20). This block used to assert that
// "beforeprint/afterprint fire for Ctrl+P and the ⤓ PDF button on every browser" — while
// `calendar-app.js` records the opposite about the engine most of this station reads on:
// "iOS Safari does not fire beforeprint when AirPrint is invoked", which is why the Calendar and
// the Pay Calculator stamp their print headers eagerly. Two surfaces defended against it; two
// asserted it could not happen.
//
// What that costs here was MEASURED rather than reasoned about: rendering this page to PDF with
// `fip-guide.js` served as an empty file gives 8 pages against 24. Sixteen pages — two thirds of
// the guide — exist only because the handler ran. A traveller checking whether a coupon is valid
// in Belgium would get a sheet of country headings with the answers gone, and nothing on the paper
// would say it was incomplete.
//
// So the ⤓ PDF button prepares SYNCHRONOUSLY, in the capture phase, before `guide-print.js`'s own
// click handler reaches `window.print()`. `beforeprint` stays as the fallback for somebody using
// the browser's own menu.
//
// BOTH HALVES MUST BE IDEMPOTENT, and that is not a nicety. On a browser where both routes fire,
// prepare runs twice; a second snapshot would record every <details> as ALREADY open, and restore
// would then leave the whole guide expanded for good — printing would become a way to permanently
// change the page. `_fipPrepared` is what stops that.
/** @type {Array<[HTMLDetailsElement, boolean]>} */
var _fipOpenRestore = [];
var _fipPrepared = false;
// A SEARCH PRINTS ITS CARDS AND THE KEY RULES, NOT THE BOOK (owner, 18 Nov 2026). With a search
// showing cards, the general chapters — how coupons work, booking, Eurostar, ferries, common mistakes —
// came out with them: twelve sheets for "Belgium". The owner chose the cards plus the two short lists a
// traveller carries away, "What to carry" and "Important to know". It is the same CSS-state pattern as
// "Print this country" below (`body[data-print-filtered]`, the kept blocks marked `fip-filter-print` in
// the markup), set here because both print routes come through this function, and taken off by the
// restore. A search that matches nothing still prints the whole guide without countries: there are no
// cards to print, and the key rules alone would be a sheet with nothing it is about.
function filterShowsCards() {
    return !!(searchInput && searchInput.value.trim())
        && countryCards.some(function (c) { return !c.hidden; });
}
function expandAllForPrint() {
    if (_fipPrepared) return;          // second route through — the snapshot below is already true
    _fipPrepared = true;
    if (filterShowsCards() && !document.body.hasAttribute('data-print-country')) {
        document.body.setAttribute('data-print-filtered', '');
    }
    _fipOpenRestore = [];
    // A HIDDEN card's <details> is opened too, deliberately: `hidden` is what keeps it off the
    // paper (fip-guide.css expands only `details:not([hidden])` in print), and leaving it closed as
    // well would mean the filter and the disclosure state had to be restored in the right order to
    // end up where we started.
    document.querySelectorAll('details').forEach(function (d) {
        var det = /** @type {HTMLDetailsElement} */ (d);
        _fipOpenRestore.push([det, det.open]);
        det.open = true;
    });
}
function restoreAfterPrint() {
    if (!_fipPrepared) return;         // afterprint can fire twice, or without a prepare at all
    _fipPrepared = false;
    document.body.removeAttribute('data-print-filtered');
    _fipOpenRestore.forEach(function (p) { p[0].open = p[1]; });
    _fipOpenRestore = [];
}
window.addEventListener('beforeprint', expandAllForPrint);
window.addEventListener('afterprint', restoreAfterPrint);
// The restore needs the same defence the prepare got (v23.27). `afterprint` is the same event from
// the same engine that does not fire `beforeprint` for AirPrint, and un-restored, every country card
// the reader had closed would stay open for good — printing would have changed the page. Becoming
// visible again is the signal every engine sends. Where `afterprint` fires it has already cleared
// the flag, so this is a no-op.
document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') restoreAfterPrint();
});
// Capture phase, so this runs before guide-print.js's own bubble-phase handler calls window.print()
// — registration order would give the same result today, but only because of the <script> order in
// fip-guide.html, which is not a thing this file should depend on.
//
// START FROM THE PAGE ON SCREEN. The engine that sends no `afterprint` for AirPrint need not send
// `visibilitychange` either, so a "Print <country>" can still be in force here — prepared, one
// country marked. Left alone, this button would print that country and its prepare would no-op.
// `resetStalePrint` is idempotent, so on every engine that did restore it changes nothing.
function resetStalePrint() {
    clearCountryPrint();
    restoreAfterPrint();
}
document.querySelector('.btn-print')?.addEventListener('click', function () {
    resetStalePrint();
    expandAllForPrint();
}, true);
// …and when guide-print.js REFUSES the print (a home-screen app on iOS 27), nothing will restore
// what the prepare opened — so the refusal says so, and the page puts itself back (whole-app review).
document.addEventListener('guide:print-refused', resetStalePrint);

// ── PRINT THIS COUNTRY (v24.06) ────────────────────────────────────────────────────────────────
//
// The print review, item 1 (ROADMAP_HISTORY.md), and the row states the case: "Most readers want France, not the book."
// The full guide is 25 sheets and a traveller checking one coupon before a trip needs one card.
//
// A BUTTON PER CARD, not one control in the header. A header control would have to know which
// country the reader means, and the only honest answers to that are a picker (a second list of 32
// names, beside the finder and the jump chips that are already two) or "whichever is open", which
// is wrong the moment two are. Inside the card there is no question to answer: the country is the
// one you are reading. It is injected rather than written into 32 cards by hand — the same reason
// the drawer builds its own pills.
//
// PRINTING ONE CARD IS A CSS STATE, NOT A DOM EDIT. `body[data-print-country]` plus a marker class
// on the chosen card; `@media print` hides the rest. Nothing is removed and nothing is re-inserted,
// so an interrupted print cannot leave the page missing a country — which is the failure the
// restore machinery above exists to prevent, reached a different way.
//
// IT REUSES THE EXPAND, DELIBERATELY. `expandAllForPrint` opens every <details>, including the 31
// this print will hide, and that is cheaper than a second narrower path: the hidden ones cost
// nothing on paper, and one prepare/restore pair means one thing to keep idempotent rather than
// two. The restore is chained onto the existing one for the same reason.
var PRINT_COUNTRY_MARK = 'is-print-country';
/** @type {HTMLElement | null} */
var _fipPrintTarget = null;

function clearCountryPrint() {
    if (_fipPrintTarget) _fipPrintTarget.classList.remove(PRINT_COUNTRY_MARK);
    _fipPrintTarget = null;
    document.body.removeAttribute('data-print-country');
}

// THE SAME TWO ROUTES the expand/restore pair above uses, registered separately rather than
// chained onto `restoreAfterPrint`. Wrapping that function was the first cut and both the linter
// and the type-checker refuse it outright (`no-func-assign`) — rightly: a reader of
// `restoreAfterPrint` 40 lines up would have no way to know a later line had replaced it.
//
// Separate listeners cost nothing here because `clearCountryPrint` is unconditionally idempotent —
// it has no snapshot to protect, unlike the <details> restore, which is why that one needs a flag
// and this one does not. `visibilitychange` is the route that covers the engine most of this
// station reads on, which fires no `afterprint` for AirPrint at all.
window.addEventListener('afterprint', clearCountryPrint);
document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') clearCountryPrint();
});

countryCards.forEach(function (card) {
    var body = card.querySelector('.detail-body');
    if (!body) return;                                  // the two not-FIP <div>s have no body
    var name = (card.querySelector('summary')?.textContent || '').replace('▾', '').trim();
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-print-country';
    // The country is NAMED in the label. "Print this country" on a sheet of 32 identical buttons
    // reads fine in place and badly in a screen reader's element list, where they would be 32
    // copies of one string with nothing to tell them apart.
    btn.textContent = '⤓ Print ' + name.replace(/^\S+\s/, '');
    btn.addEventListener('click', function () {
        resetStalePrint();   // a previous country's print may never have been restored — see above
        _fipPrintTarget = /** @type {HTMLElement} */ (card);
        card.classList.add(PRINT_COUNTRY_MARK);
        document.body.setAttribute('data-print-country', card.id);
        expandAllForPrint();
        // No `window.print()` here since v24.61: guide-print.js's delegated handler prints (or, in a
        // home-screen app on iOS 27, explains why it cannot) once this handler has prepared the page.
    });
    body.appendChild(btn);
});
