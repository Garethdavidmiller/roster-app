// @ts-check
/**
 * tips-lightbox.js — Shared per-card Tips (#tipsLightbox) panel.
 *
 * Used by every page whose cards carry a `?` Tips button — grep for the import rather than keeping a
 * list here: one went stale twice, each time missing the page that arrived last, which is the failure
 * mode a module header shares with help text. Each
 * page keeps only its CARD_TIPS content data; the lifecycle, renderer, and
 * ? button wiring live here (previously copy-pasted four times, with drift:
 * two pages never moved focus into the dialog, two never updated the dialog's
 * aria-label, and none trapped Tab).
 *
 * Content shape (keyed by the data-card attribute on each .btn-card-tips):
 *   { title, sections: [{ heading?, adminOnly?, staffOnly?,
 *       items: [{ icon, html, adminOnly?, staffOnly? }] }] }
 * adminOnly/staffOnly filtering only applies when getIsAdmin is supplied
 * (admin.html shows different tips to admins and staff).
 *
 * THE GLOSSARY OPENS IN THE SAME PANEL (26 Nov 2026). "Glossary" (glossary.js) is one more set of
 * tips, keyed `GLOSSARY_KEY`, so it needs no overlay of its own: a panel whose text uses one of its words ends
 * with a "What these words mean" button that redraws THIS panel as the glossary — no second overlay, so no
 * shared Escape and no second history entry — and the drawer's Reference row opens it through `openGlossary`,
 * which reaches the page's panel. Focus goes to the ✕, because the button that had it is redrawn away.
 *
 * @module tips-lightbox
 */

import { escapeHtml } from './roster-data.js';
import { createLightbox } from './overlay.js';
import { GLOSSARY, GLOSSARY_TITLE, mentionsGlossaryTerm } from './glossary.js';

/** The glossary's key among a page's tips. Not a `data-card` value any page uses. */
export const GLOSSARY_KEY = 'glossary';

/** The glossary in the tips shape. */
const GLOSSARY_TIPS = Object.freeze({
    title: GLOSSARY_TITLE,
    sections: [{ items: GLOSSARY.map(g => ({ icon: g.icon, html: `<strong>${escapeHtml(g.term)}</strong>: ${escapeHtml(g.line)}` })) }],
});

/**
 * The ONE panel built on this page's `#tipsLightbox`, once built: a second `createLightbox` on the same overlay would
 * close twice on one ✕, unlocking the scroll twice and taking a second history entry off. A later `initTipsLightbox`
 * hands its content to this one instead (regression review, 26 Nov 2026).
 * @type {{ lb: HTMLElement, set: (tips: object, getIsAdmin: Function|undefined) => void, open: (key: string) => void }|null}
 */
let built = null;

/**
 * Open the page's `?` panel as the glossary — the drawer's "Glossary". A page that has not built its panel
 * yet (Overtime while paused, Pay's refusal card: no card is drawn, so nothing asked) has it built here, with no cards;
 * the page's own later call fills them in. False only on a page with no `#tipsLightbox` at all.
 * @returns {boolean}
 */
export function openGlossary() {
    if (!built && !initTipsLightbox({}, { trigger: null })) return false;
    built?.open(GLOSSARY_KEY);
    return true;
}

/**
 * Wire up the page's #tipsLightbox and every `?` button that opens it (`.btn-card-tips` by default).
 * Safe no-op if the page has no #tipsLightbox.
 *
 * @param {object} cardTips - Tips content keyed by data-card value
 * @param {object} [opts]
 * @param {Function} [opts.getIsAdmin] - Returns whether the current user is an
 *   admin, read at open time (login may complete after init). When omitted,
 *   adminOnly items are hidden and staffOnly items shown.
 * @param {{ selector: string, key: string }|null} [opts.trigger] - Which buttons open the panel, and the
 *   `data-*` name holding each one's content key. Default `.btn-card-tips` / `data-card`. The Pay
 *   Calculator passes `{ selector: '.help-btn', key: 'help' }`: its `?` buttons predate this module and
 *   keep their own markup and look, so the PANEL is shared without restyling five buttons (Nov 2026).
 *   `null` wires nothing: the Calendar's `?` is redrawn with Team View, so it calls `open` itself.
 * @returns {{ open: (key: string) => void }|null} the panel's opener, or null with no #tipsLightbox
 */
export function initTipsLightbox(cardTips, { getIsAdmin, trigger = { selector: '.btn-card-tips', key: 'card' } } = {}) {
    const lb       = document.getElementById('tipsLightbox');
    if (lb && built?.lb === lb) {
        built.set(cardTips, getIsAdmin);
        wireTriggers(trigger, built.open);
        return { open: built.open };
    }
    const content  = document.getElementById('tipsLightboxContent');
    const closeBtn = document.getElementById('tipsLightboxClose');
    const titleEl  = document.getElementById('tipsLbTitle');
    const bodyEl   = document.getElementById('tipsLbBody');
    if (!lb || !titleEl || !bodyEl) return null;

    const lightbox = createLightbox({ overlay: lb, content: content ?? undefined, closeBtn: closeBtn ?? undefined });

    /**
     * @param {any} tips
     * @param {boolean} isAdmin
     */
    function render(tips, isAdmin) {
        let html = '';
        for (const section of tips.sections) {
            if (section.adminOnly && !isAdmin) continue;
            if (section.staffOnly &&  isAdmin) continue;
            if (section.heading) html += `<div class="tips-lb-section">${escapeHtml(section.heading)}</div>`;
            for (const item of section.items) {
                if (item.adminOnly && !isAdmin) continue;
                if (item.staffOnly &&  isAdmin) continue;
                html += `<div class="tips-lb-item"><span class="tips-lb-icon" aria-hidden="true">${item.icon}</span><span>${item.html}</span></div>`;
            }
        }
        // A panel that uses one of the glossary's words says where they are explained.
        if (tips !== GLOSSARY_TIPS && mentionsGlossaryTerm(html)) {
            html += '<button type="button" class="tips-lb-glossary" data-glossary><span aria-hidden="true">📖</span><span class="tips-lb-glossary-words">What these words mean</span></button>';
        }
        return html;
    }

    /** @param {any} key */
    function openTips(key) {
        const tips = key === GLOSSARY_KEY ? GLOSSARY_TIPS : /** @type {Record<string, any>} */ (cardTips)[key];
        if (!tips) return;
        /** @type {HTMLElement} */ (lb).setAttribute('aria-label', tips.title);
        /** @type {HTMLElement} */ (titleEl).textContent = tips.title;
        /** @type {HTMLElement} */ (bodyEl).innerHTML = render(tips, !!getIsAdmin?.());
        // EVERY CARD'S PANEL OPENS AT ITS TOP (Nov 2026). One sheet serves every `?` on a page, so a panel
        // scrolled to its end left the NEXT card's panel opening part-way down, its first section and
        // heading out of sight above — found on the Pay page, where the panels are long. AFTER open():
        // a closed overlay is `display: none`, where a scroll write is lost and the old offset comes back.
        lightbox.open();
        if (content) content.scrollTop = 0;
    }

    bodyEl.addEventListener('click', e => {
        if (!/** @type {Element} */ (e.target).closest?.('[data-glossary]')) return;
        openTips(GLOSSARY_KEY);
        /** @type {HTMLElement|null} */ (closeBtn)?.focus();
    });
    built = { lb, open: openTips, set: (tips, isAdmin) => { cardTips = tips; getIsAdmin = isAdmin; } };

    wireTriggers(trigger, openTips);
    return { open: openTips };
}

/**
 * Wire every card's ? button to the panel, once each — stopPropagation keeps the press from collapsing the card.
 * @param {{ selector: string, key: string }|null} trigger @param {(key: string) => void} open
 */
function wireTriggers(trigger, open) {
    if (!trigger) return;
    document.querySelectorAll(trigger.selector).forEach(btn => {
        const b = /** @type {HTMLElement} */ (btn);
        if (b.dataset.tipsWired) return;
        b.dataset.tipsWired = '1';
        b.addEventListener('click', e => {
            e.stopPropagation();
            open(/** @type {string} */ (b.dataset[trigger.key]));
        });
    });
}
