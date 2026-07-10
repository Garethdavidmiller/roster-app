// @ts-check
// FIP Travel Guide — open a country/section when you jump to it.
//
// The country jump links (#country-fr, #country-be, …) and the multi-country note point at native
// <details> elements. A bare anchor-scroll lands ON the row but leaves it COLLAPSED, so you have to
// tap again to read the thing you just navigated to — double the taps on a 25-country page (C1).
// This opens the target <details> automatically: on first load (a deep link) and on every in-page
// jump. CSP blocks inline scripts, so it lives in its own file (like railcard-guide.js), `defer`-loaded.

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

/** Open whatever the current URL hash points at (deep links + back/forward navigation). */
function openHashTarget() {
    openDetails(safeDecode(location.hash.slice(1)));
}

window.addEventListener('hashchange', openHashTarget);

// Also handle a jump-link tap directly: re-tapping a link whose hash is already current fires no
// hashchange, so this covers "closed it, tapped the same country again". Idempotent with the above.
document.querySelector('.country-jump')?.addEventListener('click', function (e) {
    var a = /** @type {HTMLAnchorElement|null} */ (/** @type {Element} */ (e.target).closest('a[href^="#"]'));
    if (!a) return;
    openDetails(safeDecode((a.getAttribute('href') || '').slice(1)));
});

openHashTarget();   // first load: honour a deep link (defer → the DOM is already parsed)
