// @ts-check
/**
 * nav-guide-fold.js — The drawer's Reference section: its fold (`#navGuidesToggle`) and the cross-guide search
 * box, whose module loads on the box's FIRST FOCUS only — `import('./nav-guide-search.js')`, never a static
 * import, so the ~90KB index is in no page's boot (guide-index-parity.test.mjs, contract 7).
 *
 * `aria-expanded` is the fold's ONLY state: the arrow and the count chip are CSS-keyed to it, and a second
 * `.open` class once left the arrow stuck (nav-panel.js's header has the measurements). Which list shows while
 * expanded is nav-guide-search.js's answer, read off `#navGuideSearchResults`, never recomputed here.
 *
 * Moved out of nav-panel.js (25 Nov 2026), which calls `wireGuideFold` once per `initNavPanel`. A result row is
 * an ordinary guide link, so nav-panel.js's delegated click gives it counting, `?from=` and the history dance.
 */

import { NAV_GUIDES } from './nav-destinations.js';

/** Wire the Reference fold and the search box's lazy load, over the DOM nav-panel-markup.js drew. */
export function wireGuideFold() {
    // Guides submenu accordion — an in-panel toggle, so the panel stays open.
    const guidesToggle = document.getElementById('navGuidesToggle');
    const guidesList   = document.getElementById('navGuidesList');
    guidesToggle?.addEventListener('click', () => {
        // aria-expanded is the ONLY state (the header says why; see the CSS note in shared.css).
        const isOpen = guidesToggle.getAttribute('aria-expanded') === 'true';
        guidesToggle.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
        // EXPANDING RESTORES THE SECTION, NOT NECESSARILY THE STATIC LIST: a search shows results in
        // its place. WHICH LIST SHOWS is `nav-guide-search.js`'s `render()` — read, never recomputed
        // here (a second copy of one boolean). Absent = the module never loaded = not filtering.
        const filtering = document.getElementById('navGuideSearchResults')?.dataset.gsActive === '1';
        if (guidesList) guidesList.hidden = isOpen || filtering;
        const searchZone = document.getElementById('navGuideSearchZone');
        if (searchZone) searchZone.hidden = isOpen;
    });

    // Cross-guide search loads on FIRST FOCUS only — the module and its ~90KB index are not part
    // of any page's boot. If the import fails (it is SW-precached, so this is rare), the box says
    // so rather than sitting silently dead.
    const gsInput = /** @type {HTMLInputElement|null} */ (document.getElementById('navGuideSearchInput'));
    let _gsRequested = false;
    gsInput?.addEventListener('focus', () => {
        if (_gsRequested) return;
        _gsRequested = true;
        import('./nav-guide-search.js')
            .then(m => m.initGuideSearch({ guides: NAV_GUIDES }))
            .catch(() => {
                const st = document.getElementById('navGuideSearchStatus');
                if (st) { st.textContent = 'Search is unavailable — the guides below still open.'; st.dataset.state = 'error'; }
            });
    });
}
