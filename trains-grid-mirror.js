// @ts-check
/**
 * trains-grid-mirror.js — the Trains grid's column heads, kept in view (v24.92).
 *
 * A fixed copy of the stopping-pattern grid's header row, shown while the real one has scrolled
 * off the top of the screen and the table has not. On a phone the grid is 39 rows, and without this
 * a reader was 600px below the minute and destination that give a column's dots their meaning.
 *
 * ── A PICTURE OF THE HEADER, NOT A SECOND HEADER ───────────────────────────────────────────────
 *
 * It is `aria-hidden` and takes no pointer events: the real heads stay the only controls, so a
 * screen reader meets one header and a tap lands on the one that does something. Its cells are the
 * real heads' visible spans, cloned, at the real cells' measured widths, and it follows the grid's
 * sideways scroll with a transform — so it is exactly as wide as the table box, never wider, and
 * cannot scroll the page (the sideways-scroll test in e2e/trains.spec.js measures that).
 *
 * ── FIXED, NOT STICKY ──────────────────────────────────────────────────────────────────────────
 *
 * `position: sticky` sticks to the nearest ancestor that clips overflow, and here that is the card
 * (`.card { overflow: hidden }`), then the scroll box the table lives in. Neither is the screen. So
 * the copy is `position: fixed`, placed by measuring the scroll box on every scroll and resize
 * (one rAF a frame, at most), and hidden the moment the real header is back on screen or the table
 * has gone past. A hidden view or a collapsed card measures as nothing and shows nothing.
 *
 * Owned by trains-app.js, which calls `syncGridMirror` after every render: the copy is rebuilt from
 * whatever grid is on the page, and torn down when there is none.
 */

/** @type {{ stick: HTMLElement, wrap: HTMLElement, onSync: () => void }|null} */
let mirror = null;

/**
 * Rebuild the mirror for the grid inside `host` — or remove it, when `host` holds no grid.
 * @param {HTMLElement|null} host   the element the grid is rendered into (#trPattern)
 */
export function syncGridMirror(host) {
    if (mirror) {
        window.removeEventListener('scroll', mirror.onSync);
        window.removeEventListener('resize', mirror.onSync);
        mirror.wrap.removeEventListener('scroll', mirror.onSync);
        mirror.stick.remove();
        mirror = null;
    }
    const wrap = /** @type {HTMLElement|null} */ (host?.querySelector('.tr-grid-wrap') ?? null);
    const heads = wrap ? /** @type {HTMLElement[]} */ ([...wrap.querySelectorAll('thead th')]) : [];
    if (!wrap || heads.length < 2) return;
    const stick = document.createElement('div');
    stick.className = 'tr-grid-stick';
    stick.setAttribute('aria-hidden', 'true');
    stick.hidden = true;
    const st = document.createElement('div');
    st.className = 'tr-grid-stick-st';
    st.textContent = heads[0].textContent ?? '';
    const clip = document.createElement('div');
    clip.className = 'tr-grid-stick-clip';
    const row = document.createElement('div');
    row.className = 'tr-grid-stick-row';
    for (const th of heads.slice(1)) {
        const cell = document.createElement('div');
        // The head's visible spans, never its button: the mirror is not a control.
        for (const span of th.querySelectorAll('span:not(.sr-only)')) cell.appendChild(span.cloneNode(true));
        row.appendChild(cell);
    }
    clip.appendChild(row);
    stick.append(st, clip);
    wrap.before(stick);
    const cells = /** @type {HTMLElement[]} */ ([...row.children]);
    let raf = 0;
    const place = () => {
        raf = 0;
        const table = wrap.querySelector('table'), thead = wrap.querySelector('thead');
        if (!table || !thead) { stick.hidden = true; return; }
        const t = table.getBoundingClientRect(), h = thead.getBoundingClientRect();
        // While the real header is above the screen and the table's foot is not.
        const show = h.height > 0 && h.bottom < 0 && t.bottom > stick.offsetHeight + 8;
        stick.hidden = !show;
        if (!show) return;
        const w = wrap.getBoundingClientRect();
        stick.style.left = `${w.left}px`;
        stick.style.width = `${w.width}px`;
        st.style.width = `${heads[0].getBoundingClientRect().width}px`;
        cells.forEach((c, i) => { c.style.width = `${heads[i + 1].getBoundingClientRect().width}px`; });
        row.style.transform = `translateX(${-wrap.scrollLeft}px)`;
    };
    const onSync = () => { if (!raf) raf = requestAnimationFrame(place); };
    window.addEventListener('scroll', onSync, { passive: true });
    window.addEventListener('resize', onSync);
    wrap.addEventListener('scroll', onSync, { passive: true });
    mirror = { stick, wrap, onSync };
    place();
}
