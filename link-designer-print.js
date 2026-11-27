// @ts-check
/**
 * link-designer-print.js — preparing the Link Designer for paper, and putting it back. Tested by
 * link-designer-print.test.mjs; the printed sheet itself by e2e/link-designer.spec.js and e2e/print.spec.js.
 *
 * ── WHY EVERY `<details>` IS OPENED, AND BY SCRIPT ──────────────────────────────────────────────
 *
 * CSS cannot open a disclosure for print: Chromium hides a closed `details`'s content through an
 * internal slot no author rule reaches (measured: a `@media print` override still printed 13 of the
 * fatigue panel's 24 rows). The sheet goes to the assessing manager, so dropping completed checks
 * from it is the false-assurance failure the Design checks exist to prevent. Restoring afterwards
 * matters the other way round: printing must not expand for good what the designer collapsed.
 *
 * ── FOUR RULES AN EDIT CAN BREAK ────────────────────────────────────────────────────────────────
 *
 * 1. **The Print button prepares before `window.print()`, not only `beforeprint`** (v23.20): iOS
 *    Safari fires no `beforeprint` for AirPrint. And it starts from the page on screen — a print
 *    still in force from a sheet that never said it ended is put back first.
 * 2. **The "Printed" time is stamped on every prepare**, before the idempotency check, so a print
 *    after one whose restore never came does not carry the earlier time.
 * 3. **Preparing is idempotent.** Where both routes fire, a second snapshot would record every
 *    disclosure as already open, and the restore would leave the workspace expanded.
 * 4. **A print is over when the reader is back** (Nov 2026, as fip-guide.js). `afterprint` is the
 *    event iOS does not send for AirPrint, and its sheet need not change the page's visibility, so
 *    `_printPrepared` could stick for good. The print sheet is MODAL, so any touch, key or scroll the
 *    page receives after a prepare means it has gone. The prepare's own effects must not end it:
 *    opening the disclosures moves the page, so a scroll counts only once the page has moved from
 *    where it stood after they opened, and only on screen (an engine laying the page out for paper
 *    fires `scroll` without the reader). The pointerdown and keydown that START a print come before
 *    its click, so they cannot end it; and a blocking `window.print()` lets nothing reach the page.
 *
 * Shared with fip-guide.js in BEHAVIOUR, not in code: that page is a classic script with its own
 * country-print state, and a module both could import would carry that state or a hook for it.
 */

const PRINT_END_EVENTS = /** @type {const} */ (['pointerdown', 'keydown', 'scroll']);

/**
 * Wire the page's print preparation, once.
 * @param {{ stamp: () => void, win?: Window, doc?: Document }} o  `stamp` writes the print masthead, "Printed" time included
 * @returns {{ prepare: () => void, restore: () => void, printNow: (print: () => void) => void, isPrepared: () => boolean }}
 */
export function createPrintPrep({ stamp, win = window, doc = document }) {
    let prepared = false, armed = false, endY = 0;
    /** @type {HTMLDetailsElement[]} */ let reopened = [];

    /** @param {Event} e */
    const onReaderBack = (e) => {
        if (e.type === 'scroll' && (win.matchMedia('print').matches || Math.abs(win.scrollY - endY) <= 2)) return;
        restore();
    };
    function arm() {
        endY = win.scrollY;   // read once the disclosures are open, with their move already laid out
        if (armed) return;
        armed = true;
        for (const type of PRINT_END_EVENTS) win.addEventListener(type, onReaderBack, { capture: true, passive: true });
    }
    function disarm() {
        if (!armed) return;
        armed = false;
        for (const type of PRINT_END_EVENTS) win.removeEventListener(type, onReaderBack, { capture: true });
    }

    function prepare() {
        stamp();                      // rule 2: every time
        if (prepared) return;         // rule 3
        prepared = true;
        reopened = /** @type {HTMLDetailsElement[]} */ ([...doc.querySelectorAll('details:not([open])')]);
        for (const d of reopened) d.open = true;
        arm();
    }
    function restore() {
        if (!prepared) return;        // afterprint can fire twice, or not at all
        prepared = false;
        disarm();
        for (const d of reopened) d.open = false;
        reopened = [];
    }

    win.addEventListener('beforeprint', prepare);
    win.addEventListener('afterprint', restore);
    doc.addEventListener('visibilitychange', () => { if (doc.visibilityState === 'visible') restore(); });

    return {
        prepare,
        restore,
        /** The Print button's route (rule 1): from the page on screen, prepared, then printed. @param {() => void} print */
        printNow(print) { restore(); prepare(); print(); },
        isPrepared: () => prepared,
    };
}
