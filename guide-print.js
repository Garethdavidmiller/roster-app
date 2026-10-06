// @ts-check
// guide-print.js — the ⤓ PDF button on every guide, and the FIP guide's per-country print buttons.
//
// A MODULE since v24.61 (it was a classic `<script defer>` for the three guides that then loaded it;
// the Railcard and Rangers guides each carried their own two-line copy). It became one so that it
// could import the print guard: in a home-screen web app on iOS 27 `window.print()` does nothing
// (print-guard.js has the reference), and a button that silently does nothing is the worst kind of
// broken. All five guides now load this one file as `<script type="module">`.
//
// ONE DELEGATED LISTENER, on the document, in the bubble phase. The FIP guide's per-country buttons
// are created at runtime and prepare the page in their own handlers (fip-guide.js) — bound on the
// button itself, so they run first — and then this prints. The header button's capture-phase
// prepare in fip-guide.js runs before this for the same reason. Nothing here prepares anything;
// it only decides between printing and explaining.
import { printOrExplain, openInSafari, PRINT_UNAVAILABLE_TEXT, OPEN_IN_SAFARI_LABEL } from './print-guard.js';

const NOTICE_ID = 'printUnavailable';

/** Say why the button did nothing, once, under the header, with the one tap that fixes it. */
function explain() {
    let notice = document.getElementById(NOTICE_ID);
    if (!notice) {
        notice = document.createElement('p');
        notice.id = NOTICE_ID;
        notice.className = 'print-unavailable';
        notice.setAttribute('role', 'status');
        const text = document.createElement('span');
        text.textContent = PRINT_UNAVAILABLE_TEXT + ' ';
        const open = document.createElement('button');
        open.type = 'button';
        open.className = 'print-unavailable-open';
        open.textContent = OPEN_IN_SAFARI_LABEL;
        open.addEventListener('click', () => openInSafari());
        notice.append(text, open);
        const header = document.querySelector('.page-header');
        if (header?.parentNode) header.parentNode.insertBefore(notice, header.nextSibling);
        else document.body.prepend(notice);
    }
    notice.scrollIntoView?.({ block: 'nearest' });
    /** @type {HTMLButtonElement|null} */ (notice.querySelector('button'))?.focus();
}

document.addEventListener('click', (e) => {
    const target = /** @type {Element|null} */ (e.target instanceof Element ? e.target : null);
    if (!target?.closest('.btn-print, .btn-print-country')) return;
    printOrExplain({ explain });
});
