/**
 * admin-rangepicker.js — Inline date-range picker calendar for admin.html.
 *
 * Extracted from admin-app.js at v11.36.
 * Owns: buildRangePicker() — creates an inline swipe-able month calendar
 *   wired to hidden <input type="date"> elements and chip labels.
 * Does NOT own: AL/sick save logic, week grid, or any other admin section.
 */

import { DAY_NAMES, MONTH_ABB, MONTH_NAMES, formatISO, SWIPE_THRESHOLD, SWIPE_VELOCITY } from './roster-data.js';

/**
 * Builds an inline date-range calendar inside #{prefix}RangePicker and wires
 * it to the hidden <input type="date"> elements #{prefix}From / #{prefix}To.
 * Returns { reset() } for post-save clearing.
 * @param {string} prefix  'al' | 'sick'
 * @returns {{ reset: Function }}
 */
export function buildRangePicker(prefix) {

    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const TRANSITION  = prefersReduced ? 'none' : 'transform 0.3s cubic-bezier(0.4,0,0.2,1)';
    const DURATION_MS = prefersReduced ? 0 : 300;

    const fromInput = document.getElementById(prefix + 'From');
    const toInput   = document.getElementById(prefix + 'To');
    const wrap      = document.getElementById(prefix + 'RangePicker');

    let fromISO  = '', toISO = '', hoverISO = '';
    let yr = new Date().getFullYear(), mo = new Date().getMonth();

    wrap.innerHTML = `
        <div class="rp-chips">
            <div class="rp-chip" id="${prefix}RpFrom">Choose start</div>
            <span class="rp-sep">→</span>
            <div class="rp-chip" id="${prefix}RpTo">Choose end</div>
            <button class="rp-clear" id="${prefix}RpClear" aria-label="Clear dates">✕</button>
        </div>
        <div class="rp-nav">
            <button class="rp-nav-btn" id="${prefix}RpPrev" aria-label="Previous month">‹</button>
            <span class="rp-label" id="${prefix}RpLabel"></span>
            <button class="rp-nav-btn" id="${prefix}RpNext" aria-label="Next month">›</button>
        </div>
        <div class="rp-clip" id="${prefix}RpClip">
            <div class="rp-grid" id="${prefix}RpGrid"></div>
        </div>`;

    const chipFrom  = document.getElementById(prefix + 'RpFrom');
    const chipTo    = document.getElementById(prefix + 'RpTo');
    const clearBtn  = document.getElementById(prefix + 'RpClear');
    const label     = document.getElementById(prefix + 'RpLabel');
    const clip      = document.getElementById(prefix + 'RpClip');
    const grid      = document.getElementById(prefix + 'RpGrid');

    document.getElementById(prefix + 'RpPrev').addEventListener('click', () => { if (--mo < 0) { mo = 11; yr--; } render(); });
    document.getElementById(prefix + 'RpNext').addEventListener('click', () => { if (++mo > 11) { mo = 0; yr++; } render(); });
    clearBtn.addEventListener('click', () => {
        fromISO = toISO = hoverISO = '';
        fromInput.value = toInput.value = '';
        toInput.dispatchEvent(new Event('change'));
        render();
        updateChips();
    });

    function fmt(iso) {
        const d = new Date(iso + 'T12:00:00');
        return `${DAY_NAMES[d.getDay()].slice(0,3)} ${d.getDate()} ${MONTH_ABB[d.getMonth()]}`;
    }

    function updateChips() {
        chipFrom.textContent = fromISO ? fmt(fromISO) : 'Choose start';
        chipFrom.classList.toggle('rp-chip-set', !!fromISO);
        chipTo.textContent   = toISO   ? fmt(toISO)   : 'Choose end';
        chipTo.classList.toggle('rp-chip-set', !!toISO);
        clearBtn.classList.toggle('visible', !!(fromISO || toISO));
    }

    // Renders a month grid into any target element for the current yr/mo state.
    function renderGrid(target) {
        const startOff    = (new Date(yr, mo, 1).getDay() + 6) % 7; // Mon = 0
        const daysInMonth = new Date(yr, mo + 1, 0).getDate();
        const todayISO    = formatISO(new Date());
        const previewEnd  = !toISO && fromISO && hoverISO > fromISO ? hoverISO : toISO;
        target.innerHTML  = '';
        ['M','T','W','T','F','S','S'].forEach(d => {
            const el = document.createElement('div');
            el.className = 'rp-dow';
            el.textContent = d;
            target.appendChild(el);
        });
        for (let i = 0; i < startOff; i++) {
            const el = document.createElement('div');
            el.className = 'rp-day rp-filler';
            target.appendChild(el);
        }
        for (let d = 1; d <= daysInMonth; d++) {
            const iso = `${yr}-${String(mo+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
            const el  = document.createElement('div');
            el.className  = 'rp-day';
            el.textContent = d;
            el.dataset.iso = iso;
            el.tabIndex    = 0;
            el.setAttribute('role', 'button');
            if (iso === todayISO) el.classList.add('rp-today');
            if (iso === fromISO)  el.classList.add('rp-from');
            if (iso === toISO)    el.classList.add('rp-to');
            if (fromISO && previewEnd && iso > fromISO && iso < previewEnd)
                el.classList.add(toISO ? 'rp-in-range' : 'rp-preview');
            if (!toISO && fromISO && iso === hoverISO && iso > fromISO)
                el.classList.add('rp-preview', 'rp-preview-end');
            target.appendChild(el);
        }
    }

    function render() {
        label.textContent = `${MONTH_NAMES[mo]} ${yr}`;
        grid.style.transition = '';
        grid.style.transform  = '';
        renderGrid(grid);
    }

    function commit() {
        fromInput.value = fromISO;
        toInput.value   = toISO;
        if (toISO) toInput.dispatchEvent(new Event('change'));
        updateChips();
        render();
    }

    // Build an adjacent month panel for carousel animation.
    // Temporarily shifts yr/mo by delta, renders into a new div, then restores state.
    function buildAdjPanel(delta) {
        const savedMo = mo, savedYr = yr;
        mo += delta;
        if (mo > 11) { mo = 0; yr++; }
        if (mo < 0)  { mo = 11; yr--; }
        const panel = document.createElement('div');
        panel.className = 'rp-grid rp-adj-panel';
        renderGrid(panel);
        mo = savedMo; yr = savedYr;
        clip.appendChild(panel);
        return panel;
    }

    // Carousel swipe — same pattern as the week grid in admin-app.js.
    let swStartX = 0, swStartY = 0, swStartT = 0;
    let swListening = false, swDragging = false, swFired = false;
    let swHaptic = false, swCooldown = false;
    let swWidth = 0, swPanelPrev = null, swPanelNext = null;

    function discardAdj() {
        if (swPanelPrev?.parentNode) swPanelPrev.remove();
        if (swPanelNext?.parentNode) swPanelNext.remove();
        swPanelPrev = swPanelNext = null;
    }

    function snapBack() {
        grid.style.transition = TRANSITION;
        grid.style.transform  = '';
        if (swPanelPrev) { swPanelPrev.style.transition = TRANSITION; swPanelPrev.style.transform = `translate3d(${-swWidth}px,0,0)`; }
        if (swPanelNext) { swPanelNext.style.transition = TRANSITION; swPanelNext.style.transform = `translate3d(${swWidth}px,0,0)`;  }
        setTimeout(() => { discardAdj(); grid.style.transition = ''; swCooldown = false; }, DURATION_MS + 50);
    }

    grid.addEventListener('pointerdown', e => {
        if (!e.isPrimary || swCooldown) return;
        navigator.vibrate?.(0);
        swStartX = e.clientX; swStartY = e.clientY; swStartT = e.timeStamp;
        swListening = true; swDragging = false; swFired = false; swHaptic = false;
    });

    grid.addEventListener('pointermove', e => {
        if (!e.isPrimary || !swListening) return;
        const dx = e.clientX - swStartX, dy = e.clientY - swStartY;

        if (!swDragging) {
            if (Math.abs(dx) <= 5 && Math.abs(dy) <= 5) return;
            if (Math.abs(dy) >= Math.abs(dx)) { swListening = false; return; } // vertical — let browser scroll
            // Horizontal intent confirmed — build carousel
            swWidth = Math.ceil(clip.getBoundingClientRect().width);
            grid.setPointerCapture(e.pointerId);
            grid.style.transition = 'none';
            grid.style.willChange = 'transform';
            swPanelPrev = buildAdjPanel(-1);
            swPanelNext = buildAdjPanel(+1);
            swPanelPrev.style.transform = `translate3d(${-swWidth}px,0,0)`;
            swPanelNext.style.transform = `translate3d(${swWidth}px,0,0)`;
            swCooldown = true;
            swDragging = true;
        }

        grid.style.transform = `translate3d(${dx}px,0,0)`;
        if (swPanelPrev) swPanelPrev.style.transform = `translate3d(${-swWidth + dx}px,0,0)`;
        if (swPanelNext) swPanelNext.style.transform = `translate3d(${swWidth  + dx}px,0,0)`;

        if (!swHaptic && Math.abs(dx) >= SWIPE_THRESHOLD) {
            navigator.vibrate?.(6);
            swHaptic = true;
        }
    });

    grid.addEventListener('pointerup', e => {
        if (!e.isPrimary || !swListening) return;
        swListening = false;
        if (!swDragging) return; // was a tap
        swDragging = false;
        try { grid.releasePointerCapture(e.pointerId); } catch (_) {}

        const dx  = e.clientX - swStartX;
        const vel = e.timeStamp > swStartT ? Math.abs(dx) / (e.timeStamp - swStartT) : 0;
        const goLeft  = dx < 0 && (Math.abs(dx) >= SWIPE_THRESHOLD || vel >= SWIPE_VELOCITY);
        const goRight = dx > 0 && (Math.abs(dx) >= SWIPE_THRESHOLD || vel >= SWIPE_VELOCITY);

        if (goLeft || goRight) {
            if (!swHaptic) navigator.vibrate?.(6);
            const incoming = goLeft ? swPanelNext : swPanelPrev;
            const discard  = goLeft ? swPanelPrev : swPanelNext;
            if (goLeft) { if (++mo > 11) { mo = 0; yr++; } }
            else        { if (--mo < 0)  { mo = 11; yr--; } }
            label.textContent = `${MONTH_NAMES[mo]} ${yr}`;
            // Slide both panels to their committed positions
            grid.style.transition     = TRANSITION;
            grid.style.transform      = `translate3d(${goLeft ? -swWidth : swWidth}px,0,0)`;
            incoming.style.transition = TRANSITION;
            incoming.style.transform  = '';
            setTimeout(() => {
                renderGrid(grid);
                grid.style.transition = '';
                grid.style.transform  = '';
                grid.style.willChange = '';
                if (discard?.parentNode)  discard.remove();
                if (incoming?.parentNode) incoming.remove();
                swPanelPrev = swPanelNext = null;
                swCooldown = false;
            }, DURATION_MS + 50);
            swFired = true;
        } else {
            snapBack();
        }
    });

    grid.addEventListener('pointercancel', e => {
        if (!e.isPrimary || !swListening) return;
        swListening = false;
        try { grid.releasePointerCapture(e.pointerId); } catch (_) {}
        if (swDragging) {
            swDragging = false;
            snapBack();
        } else {
            swCooldown = false;
        }
    });

    grid.addEventListener('click', e => {
        if (swFired) { swFired = false; return; }
        const cell = e.target.closest('[data-iso]');
        if (!cell) return;
        const iso = cell.dataset.iso;
        if (!fromISO || toISO)  { fromISO = iso; toISO = ''; }
        else if (iso < fromISO) { fromISO = iso; toISO = ''; }
        else                    { toISO   = iso; }
        hoverISO = '';
        commit();
    });

    grid.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.target.click(); }
    });

    // Hover preview only on devices with a real cursor — guards iOS from firing
    // mouseover on touch and showing a stale preview range.
    const _supportsHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    if (_supportsHover) {
        grid.addEventListener('mouseover', e => {
            if (swDragging || !fromISO || toISO) return;
            const iso = e.target.closest('[data-iso]')?.dataset.iso || '';
            if (iso === hoverISO) return;
            hoverISO = iso;
            renderGrid(grid);
        });

        grid.addEventListener('mouseleave', () => {
            if (!hoverISO) return;
            hoverISO = '';
            renderGrid(grid);
        });
    }

    render();
    updateChips();

    return {
        reset() {
            fromISO = toISO = hoverISO = '';
            yr = new Date().getFullYear();
            mo = new Date().getMonth();
            fromInput.value = toInput.value = '';
            toInput.dispatchEvent(new Event('change'));
            render();
            updateChips();
        }
    };
}
