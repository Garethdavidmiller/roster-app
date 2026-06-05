/**
 * avatar.js — Shared profile-avatar helpers.
 *
 * One place for the avatar localStorage cache key and the DOM painter, so the
 * 88px settings preview and the 26px nav-footer badge render identically and
 * read/write the same cache (CLAUDE.md: "so both render the exact same
 * fallback"). The pure name→initials / name→colour helpers live in
 * roster-data.js; this module owns only the DOM painting + cache key.
 *
 * Imported by settings-avatar.js and nav-panel.js.
 */

import { avatarInitials, avatarHue } from './roster-data.js';

/** localStorage cache key for a member's avatar URL. */
export const avatarCacheKey = (memberName) => `myb_avatar_${memberName}`;

/**
 * Paint an avatar into a container element: a cover-fitted photo when a URL is
 * given, otherwise the member's initials on a stable colour. Built with DOM
 * methods (no innerHTML). If the photo fails to load (stale/rotated Storage
 * token, deleted file, offline), it falls back to initials rather than showing
 * the browser's broken-image glyph.
 * @param {HTMLElement|null} el
 * @param {string|null} url
 * @param {string} memberName
 */
export function paintAvatar(el, url, memberName) {
    if (!el) return;
    el.textContent = '';
    el.style.background = '';
    if (url) {
        const img = document.createElement('img');
        img.alt = '';
        img.className = 'avatar-img';
        // Degrade to initials if the image can't be fetched/decoded.
        img.addEventListener('error', () => paintAvatar(el, null, memberName), { once: true });
        img.src = url;
        el.appendChild(img);
    } else {
        el.textContent = avatarInitials(memberName);
        el.style.background = avatarHue(memberName);
    }
}
