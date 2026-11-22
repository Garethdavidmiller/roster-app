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
 * @module tips-lightbox
 */

import { escapeHtml } from './roster-data.js';
import { createLightbox } from './overlay.js';

/**
 * Wire up the page's #tipsLightbox and every `?` button that opens it (`.btn-card-tips` by default).
 * Safe no-op if the page has no #tipsLightbox.
 *
 * @param {object} cardTips - Tips content keyed by data-card value
 * @param {object} [opts]
 * @param {Function} [opts.getIsAdmin] - Returns whether the current user is an
 *   admin, read at open time (login may complete after init). When omitted,
 *   adminOnly items are hidden and staffOnly items shown.
 * @param {{ selector: string, key: string }} [opts.trigger] - Which buttons open the panel, and the
 *   `data-*` name holding each one's content key. Default `.btn-card-tips` / `data-card`. The Pay
 *   Calculator passes `{ selector: '.help-btn', key: 'help' }`: its `?` buttons predate this module and
 *   keep their own markup and look, so the PANEL is shared without restyling five buttons (Nov 2026).
 */
export function initTipsLightbox(cardTips, { getIsAdmin, trigger = { selector: '.btn-card-tips', key: 'card' } } = {}) {
    const lb       = document.getElementById('tipsLightbox');
    const content  = document.getElementById('tipsLightboxContent');
    const closeBtn = document.getElementById('tipsLightboxClose');
    const titleEl  = document.getElementById('tipsLbTitle');
    const bodyEl   = document.getElementById('tipsLbBody');
    if (!lb || !titleEl || !bodyEl) return;

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
        return html;
    }

    /** @param {any} key */
    function openTips(key) {
        const tips = /** @type {Record<string, any>} */ (cardTips)[key];
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

    // Wire every card's ? button — stopPropagation prevents collapsing the card
    document.querySelectorAll(trigger.selector).forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            openTips(/** @type {HTMLElement} */ (btn).dataset[trigger.key]);
        });
    });
}
