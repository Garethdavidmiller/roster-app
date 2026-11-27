// @ts-check
/**
 * mirror-move-words.js — the Pages mirror's desktop line: who gets it, where it links and what it
 * says, with no DOM of the page's own and nothing that loads Firebase, so it runs in a unit test.
 * Why the line exists, and where it is shown: mirror-move.js.
 */

import { MAIN_ADDRESS } from './notif-card-core.js';

/** The sentence before the link, and after it. */
export const MIRROR_LEAD = 'This is the app’s older address, which will close. Its main address is ';
export const MIRROR_TAIL = ': update your bookmark.';
/** The Pay page's second sentence. */
export const MIRROR_PAY = 'Move your Pay Calculator figures first, with 💾 Move Your Pay Data below.';

/**
 * Whether this device gets the line: a desktop browser at the mirror.
 * @param {{ mirror: boolean, standalone: boolean, coarse: boolean }} device
 * @returns {boolean}
 */
export function mirrorLineDue({ mirror, standalone, coarse }) {
    return mirror && !standalone && !coarse;
}

/**
 * The same page at the main address: its file name, query and hash, never its path.
 * @param {{ pathname: string, search: string, hash: string }} loc
 * @returns {string}
 */
export function mainAddressFor({ pathname, search, hash }) {
    const last = pathname.split('/').pop() || '';
    const page = /^[a-z0-9-]+\.html$/i.test(last) && last.toLowerCase() !== 'index.html' ? last : '';
    return MAIN_ADDRESS.href + page + search + hash;
}

/**
 * The line itself.
 * @param {Document} doc
 * @param {{ tag?: string, className: string, pay?: boolean, href: string }} opts
 * @returns {HTMLElement}
 */
export function buildMirrorLine(doc, { tag = 'p', className, pay = false, href }) {
    const line = doc.createElement(tag);
    line.className = className;
    const a = doc.createElement('a');
    a.href = href;
    a.textContent = MAIN_ADDRESS.text;
    a.className = 'mirror-move-link';
    line.append(MIRROR_LEAD, a, MIRROR_TAIL);
    if (pay) line.append(' ', MIRROR_PAY);
    return line;
}
