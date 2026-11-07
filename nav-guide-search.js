// @ts-check
/**
 * nav-guide-search.js — the cross-guide search box in the nav drawer's Reference zone.
 *
 * LAZY-LOADED: nav-panel.js imports this module (and, through it, the ~90KB generated index) only
 * when the search input first gains focus — the drawer itself must stay cheap on every page boot.
 * The module renders results; every RULE lives elsewhere: matching in guide-search.js (pure,
 * tested), the index's truth in guide-index-parity.test.mjs, and the navigation behaviour in
 * nav-panel.js's existing delegated guide-link handler.
 *
 * That last point is the load-bearing trick: a result row is an ordinary
 * `<a class="nav-panel-link--guide" data-open-id href="…#anchor">`, so the SAME delegated handler
 * that serves the static guide list gives results the open-counter, the `?from=` back-link hint
 * (URL hash survives — `new URL()` keeps it through searchParams.set) and the Android-Back history
 * dance. Rendering anything else here would fork that behaviour into a second copy.
 *
 * Evidence chips: a provisional state the page declares is shown on the row, one chip per state,
 * never merged into a "worst" and never dropped — a member deciding at a gateline must meet the
 * page's own doubt IN the result, not after the tap (guide-search.js header, rule 1).
 *
 * SEARCH MODE (iPhone audit, 7 Nov 2026): while a query is active the drawer's page pills and its
 * Latest section step aside, so the results sit just under the box rather than ~500px down the
 * drawer — under the iPhone keyboard, which does not resize the page. The rules (which state
 * drives it, when it comes back, why the box is held still on the way out) are beside
 * `syncSearchMode` below; the hiding itself is one CSS rule, `.nav-panel--searching` in shared.css.
 */

import { GUIDE_INDEX } from './guide-index.js';
import { searchGuideIndex, tokeniseText } from './guide-search.js';

/** How the three provisional states read on a result row. Wording follows the guides' own pills. */
const EVIDENCE_LABELS = {
    conflict:    '⚠ Source conflict — check the retail system',
    unconfirmed: '⚠ Unconfirmed — check the retail system',
    draft:       'Draft — source not yet verified',
};

const RESULT_LIMIT = 8;

/**
 * Wire the search box. Idempotent per page load; called once by nav-panel.js on first focus.
 *
 * @param {{ guides: {icon: string, label: string, url: string, openId: string}[] }} cfg
 *   `guides` is nav-panel's own NAV_GUIDES — passed in rather than imported so the drawer keeps
 *   the single declaration of which guides exist (it is deliberately not exported).
 */
export function initGuideSearch({ guides }) {
    const input    = /** @type {HTMLInputElement|null} */ (document.getElementById('navGuideSearchInput'));
    const _results = document.getElementById('navGuideSearchResults');
    const _status  = document.getElementById('navGuideSearchStatus');
    const _list    = document.getElementById('navGuidesList');
    if (!input || !_results || !_status || !_list) return;
    // Re-bound after the guard so the closures below see non-null types (narrowing does not
    // survive into a nested function).
    const results = _results, status = _status, list = _list;
    const panel = document.getElementById('navPanel');
    const zone  = document.getElementById('navGuideSearchZone');

    /** Whether the drawer is in search mode — the class is the state; this only spares a re-read. */
    let searching = false;
    /**
     * Put the drawer into search mode while a query is active, and take it out again.
     *
     * Driven by the QUERY (the attribute `render()` publishes), not by focus: the box can be tapped
     * and left empty without the drawer's map disappearing under the reader. Off while the Reference
     * section is folded, because the fold hides the box — search mode with no box is an empty drawer.
     *
     * Two scroll rules, one per direction. Going IN, the drawer scrolls to its top, so the box is
     * just under the header wherever the member had scrolled to reach it. Coming OUT with the box
     * still focused (a cleared query), the box is held where it is: the pills and Latest come back
     * ABOVE it, and without the correction they would push it ~500px down — under the keyboard the
     * member is still typing on.
     */
    function syncSearchMode() {
        const on = results.dataset.gsActive === '1' && !zone?.hidden;
        if (!panel || on === searching) return;
        const body = panel.querySelector('.nav-panel-body');
        const holdBox = !on && document.activeElement === input;
        const before = holdBox ? /** @type {HTMLInputElement} */ (input).getBoundingClientRect().top : 0;
        panel.classList.toggle('nav-panel--searching', on);
        searching = on;
        if (!body) return;
        if (on) body.scrollTop = 0;
        else if (holdBox) body.scrollTop += /** @type {HTMLInputElement} */ (input).getBoundingClientRect().top - before;
    }

    /** Guide metadata by basename — result rows join the index to the drawer's own entries. */
    const byPage = new Map(guides.map(g => [g.url.replace(/^\.\//, ''), g]));

    /** @param {import('./guide-search.js').GuideSearchResult} r @returns {HTMLLIElement|null} */
    function buildRow(r) {
        const g = byPage.get(r.page);
        if (!g) return null;                        // an index page the drawer doesn't list — skip
        const li = document.createElement('li');
        const a  = document.createElement('a');
        a.className = 'nav-panel-link nav-panel-link--guide nav-gs-result';
        a.href = `${g.url}#${r.id}`;
        a.dataset.openId = g.openId;

        const icon = document.createElement('span');
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = g.icon;

        const text = document.createElement('span');
        text.className = 'nav-link-text';
        const title = document.createElement('span');
        title.className = 'nav-link-title';
        title.textContent = r.title;
        const meta = document.createElement('span');
        meta.className = 'nav-link-sub';
        meta.textContent = g.label;
        text.append(title, meta);
        for (const state of r.evidence) {
            const flag = document.createElement('span');
            flag.className = `nav-gs-flag nav-gs-flag--${state}`;
            flag.textContent = EVIDENCE_LABELS[/** @type {keyof typeof EVIDENCE_LABELS} */ (state)] || state;
            text.append(flag);
        }

        a.append(icon, text);
        li.append(a);
        return li;
    }

    function render() {
        const q = input?.value ?? '';
        const active = tokeniseText(q).length > 0;
        // PUBLISHED for the drawer's Reference toggle (v23.41). Collapsing and re-expanding the
        // section used to un-hide the full static list while these results were still on screen,
        // because the toggle set `hidden = false` unconditionally. It now asks this attribute
        // instead of re-deriving "is a query active" — that test is `tokeniseText`, one line above,
        // and a second copy in nav-panel.js would disagree the first time somebody typed a comma.
        // One writer here, one reader there.
        results.dataset.gsActive = active ? '1' : '';
        if (!active) {
            results.hidden = true;
            results.textContent = '';
            list.hidden = false;
            status.textContent = '';
            syncSearchMode();
            return;
        }
        const hits = searchGuideIndex(GUIDE_INDEX, q, { limit: RESULT_LIMIT });
        results.textContent = '';
        for (const r of hits) {
            const row = buildRow(r);
            if (row) results.append(row);
        }
        results.hidden = hits.length === 0;
        list.hidden = true;
        // A live region, so the count reaches a screen reader without moving focus. Wording leads
        // with the number, never a glyph (status-glyph-parity).
        status.textContent = hits.length === 0
            ? 'No matches in the guides'
            : `${hits.length} ${hits.length === 1 ? 'match' : 'matches'}`;
        syncSearchMode();
    }

    input.addEventListener('input', render);
    // Escape with text in the box clears the box; only an EMPTY box lets Escape bubble on to the
    // drawer (which closes). Standard search-field behaviour, and it keeps one keypress from
    // both clearing the query and dismissing the drawer.
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && input.value) {
            e.stopPropagation();
            input.value = '';
            render();
        }
        // THE KEYBOARD'S SEARCH KEY PUTS THE KEYBOARD AWAY (iPhone audit, 7 Nov 2026). Results arrive
        // as you type, so there is nothing to submit; "done typing" is the key's only useful meaning,
        // and on an iPhone the keyboard is what covers the results. Not mid-IME composition, where
        // Enter commits the characters instead.
        if (e.key === 'Enter' && !e.isComposing) {
            e.preventDefault();
            input.blur();
        }
    });

    // RESTORED WHEN THE DRAWER NEXT OPENS, not as it closes: cleared on the way out, the pills and
    // Latest would reappear while the drawer is still sliding away. The member next sees a drawer
    // with its map back and an empty box either way. A drawer re-built by `resetNavPanel` is a new
    // element with no query, and these observers go with the old one.
    if (panel && typeof MutationObserver === 'function') {
        let wasOpen = panel.classList.contains('open');
        new MutationObserver(() => {
            const open = panel.classList.contains('open');
            if (open && !wasOpen && input.value) { input.value = ''; render(); }
            wasOpen = open;
        }).observe(panel, { attributes: true, attributeFilter: ['class'] });
    }
    // Folding Reference hides the box (nav-panel.js's toggle), so search mode follows it both ways.
    if (zone && typeof MutationObserver === 'function') {
        new MutationObserver(syncSearchMode).observe(zone, { attributes: true, attributeFilter: ['hidden'] });
    }

    render();   // the focus that loaded the module may follow typed characters
}
