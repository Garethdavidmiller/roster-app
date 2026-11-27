// @ts-check
/**
 * mirror-move-words.js — the Pages mirror's desktop line: who gets it, where it links and what it
 * says, with no DOM of the page's own and nothing that loads Firebase, so it runs in a unit test.
 * Why the line exists, and where it is shown: mirror-move.js.
 */

import { MAIN_ADDRESS } from './notif-card-core.js';

/** The words, in the order they are read: the news in bold, then where to go, then (Pay only) what to do first. */
export const MIRROR_HEAD = 'This is the app’s older address, which will close.';
export const MIRROR_LEAD = 'Its main address is ';
export const MIRROR_TAIL = ': update your bookmark.';
/** The Pay page's second sentence, either side of its link to the Move Your Pay Data card. */
export const MIRROR_PAY = 'Move your Pay Calculator figures first, with ';
export const MIRROR_PAY_LINK = '💾 Move Your Pay Data';

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
 * The line itself, in the gold wash's own order (the Pay page's first-run banner, Settings' "things to
 * finish"): a bold head that says what is wrong, then what to do. The Pay page's sentence is a block of
 * its own, and its link is the one the first-run banner uses — `#payTransferCard`, which
 * paycalc-transfer-card.js opens on the way.
 * @param {Document} doc
 * @param {{ tag?: string, className: string, pay?: boolean, href: string }} opts
 * @returns {HTMLElement}
 */
export function buildMirrorLine(doc, { tag = 'p', className, pay = false, href }) {
    const line = doc.createElement(tag);
    line.className = className;
    const head = doc.createElement('strong');
    head.className = 'mirror-move-head';
    head.textContent = MIRROR_HEAD;
    const a = doc.createElement('a');
    a.href = href;
    a.textContent = MAIN_ADDRESS.text;
    a.className = 'mirror-move-link';
    line.append(head, ' ', MIRROR_LEAD, a, MIRROR_TAIL);
    if (pay) {
        const more = doc.createElement('span');
        more.className = 'mirror-move-pay';
        const card = doc.createElement('a');
        card.href = '#payTransferCard';
        card.textContent = MIRROR_PAY_LINK;
        card.className = 'mirror-move-link';
        more.append(MIRROR_PAY, card, '.');
        line.append(more);
    }
    return line;
}
