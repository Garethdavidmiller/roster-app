// @ts-check
/**
 * mirror-move.js — on a DESKTOP at the GitHub Pages mirror, one line saying the address is closing and
 * where the app lives now (owner, 27 Nov 2026: "Please do that", of a banner reading "This address is
 * closing — use myb-roster.web.app").
 *
 * ── WHY A LINE, NOT A REDIRECT OR A STOP ──────────────────────────────────────────────────────────
 *
 * The mirror serves no redirects and no headers (CLAUDE.md → Project identity), so anything here runs
 * in the page. A redirect would leave a member's Pay Calculator figures behind at this address with
 * nothing on screen to say so: storage belongs to an ADDRESS, and `paycalc-transfer.js` is the only way
 * they move. A line tells them, and leaves the move to them. It is not dismissible, because it has no
 * storage of its own to forget, and because its whole job is to be there each time until the bookmark
 * changes.
 *
 * ── WHO GETS IT ───────────────────────────────────────────────────────────────────────────────────
 *
 * A desktop only: `onPagesMirror()`, not the installed app, and no coarse pointer. The station PCs are
 * shared HARDWARE with a Windows login each (CLAUDE.md → Key rules), so this is about the PCs'
 * BOOKMARKS, not anybody's privacy. Phones at the mirror already get the move notice and the install
 * words (calendar-notices.js), which say the same at the length a phone warrants.
 *
 * ── TWO PLACES, ONE BUILDER ───────────────────────────────────────────────────────────────────────
 *
 * The page banner (`showMirrorBanner`, after the page's `<header>`), and the sign-in card
 * (`mirrorCardLine`, login-overlay.js), because a member signing in sees only the card — when the card
 * is OVER the page. The Calendar's card is in the page, under the strip, so it gets no second copy. Both are built
 * by `buildMirrorLine`, so the two cannot say different things. The Pay page's banner adds where the
 * figures move from (`pay`), and the card never does: before a sign-in this address holds nothing the
 * reader can be told is theirs.
 *
 * The link goes to the SAME page at the main address, with its query and hash (`mainAddressFor`), so a
 * bookmark of the Pay page becomes a bookmark of the Pay page. Only the page's file name is carried,
 * never the path, so nothing typed into the address bar can steer the link off the main address.
 */

import { onPagesMirror, isStandalonePWA } from './notif.js';
import { mirrorLineDue, mainAddressFor, buildMirrorLine } from './mirror-move-words.js';

/** The live device, for `mirrorLineDue`. @returns {boolean} */
function dueHere() {
    let coarse = true;   // unknown: treat as a phone, which has words of its own
    try { if (window.matchMedia) coarse = window.matchMedia('(pointer: coarse)').matches; } catch { /* keep true */ }
    return mirrorLineDue({ mirror: onPagesMirror(), standalone: isStandalonePWA(), coarse });
}

/**
 * The page banner, after the page's `<header>`. Once per page; nothing on a device it is not for.
 * @param {{ pay?: boolean }} [opts]  pay: the Pay page, which says where the figures move from
 * @returns {HTMLElement|null} the banner, or null where none was added
 */
export function showMirrorBanner({ pay = false } = {}) {
    if (!dueHere() || document.getElementById('mirrorMoveBanner')) return null;
    const header = document.querySelector('body > header, header.header, header.app-header');
    if (!header) return null;
    const banner = buildMirrorLine(document, { tag: 'div', className: 'mirror-move', pay, href: mainAddressFor(window.location) });
    banner.id = 'mirrorMoveBanner';
    banner.setAttribute('role', 'note');
    header.insertAdjacentElement('afterend', banner);
    return banner;
}

/**
 * The sign-in card's line, or null where it is not due.
 * @param {Document} doc
 * @returns {HTMLElement|null}
 */
export function mirrorCardLine(doc) {
    if (!dueHere()) return null;
    return buildMirrorLine(doc, { className: 'login-mirror', href: mainAddressFor(window.location) });
}
