/**
 * tips-lightbox.js — Shared per-card Tips (#tipsLightbox) panel.
 *
 * Used by admin.html, operations.html, settings.html, and links.html. Each
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
 * Wire up the page's #tipsLightbox and every .btn-card-tips button.
 * Safe no-op if the page has no #tipsLightbox.
 *
 * @param {object} cardTips - Tips content keyed by data-card value
 * @param {object} [opts]
 * @param {Function} [opts.getIsAdmin] - Returns whether the current user is an
 *   admin, read at open time (login may complete after init). When omitted,
 *   adminOnly items are hidden and staffOnly items shown.
 */
export function initTipsLightbox(cardTips, { getIsAdmin } = {}) {
    const lb       = document.getElementById('tipsLightbox');
    const content  = document.getElementById('tipsLightboxContent');
    const closeBtn = document.getElementById('tipsLightboxClose');
    const titleEl  = document.getElementById('tipsLbTitle');
    const bodyEl   = document.getElementById('tipsLbBody');
    if (!lb || !titleEl || !bodyEl) return;

    const lightbox = createLightbox({ overlay: lb, content, closeBtn });

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

    function openTips(key) {
        const tips = cardTips[key];
        if (!tips) return;
        lb.setAttribute('aria-label', tips.title);
        titleEl.textContent = tips.title;
        bodyEl.innerHTML = render(tips, !!getIsAdmin?.());
        lightbox.open();
    }

    // Wire every card's ? button — stopPropagation prevents collapsing the card
    document.querySelectorAll('.btn-card-tips').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            openTips(btn.dataset.card);
        });
    });
}
