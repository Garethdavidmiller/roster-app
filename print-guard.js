// @ts-check
/**
 * print-guard.js — can `window.print()` do anything HERE, and what to say when it cannot (v24.61,
 * iOS 27 audit finding A1). Pure: no DOM beyond `window.open`, no imports, so the guide pages (no
 * shared.css, no overlay machinery) and the app pages share one rule.
 *
 * ── THE FACT ────────────────────────────────────────────────────────────────────────────────────
 *
 * In a home-screen web app on iOS 27, `window.print()` does nothing: no sheet, no error, no
 * `beforeprint`. The same tap in a Safari tab prints. WebKit bug 325259 (25 Sep 2026) places the
 * fault "in web app support code outside WebKit", tracked by Apple internally; it is not fixed in
 * 27.0.1 and there is no page-side workaround. This app has FIVE print controls — the Calendar's
 * About panel and its `p` key, the five guides' ⤓ PDF buttons (and the FIP guide's per-country
 * ones), and the Links print — and every one of them was a dead button on an installed iPhone.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────────────────────────
 *
 * `printIsBlocked()` is true for `navigator.standalone === true`, which exists on iOS alone and is
 * true only when the page was launched from the Home Screen — the one signal that names this exact
 * situation, where `display-mode: standalone` would also be true on an installed Android app that
 * prints perfectly well.
 *
 * IT USED TO READ THE iOS VERSION TOO, AND THAT NEVER WORKED ON A REAL iPHONE (whole-app review, Oct
 * 2026). The rule blocked iOS 27 and later and let iOS 26 and earlier print — but WebKit freezes the
 * version in the user agent: every recent iPhone reports `iPhone OS 18_7`, iOS 27 included. So the
 * guard read 18, stood down, and the dead buttons it was written to explain were dead again; its
 * tests passed because they fed it an invented `27_0` that no device sends. Nothing a page can read
 * tells iOS 27 from iOS 26 now, so every home-screen launch is treated as blocked. The cost is a
 * dialog on an older install that could have printed; the alternative is a button that does nothing.
 * When Apple fixes the shell, this stays until an installed iPhone is seen to print — there is no
 * version number left to raise.
 *
 * ── WHAT IT SAYS ────────────────────────────────────────────────────────────────────────────────
 *
 * The explanation names the fix the member can actually make — open the page in Safari — and offers
 * it as one tap: `openInSafari` opens THIS url in a new context, which from a home-screen app is
 * Safari (or its in-app sheet, whose share menu also prints). The text is here so that the guides'
 * inline notice and the app's dialog cannot drift apart.
 */

/** @type {string} */
export const PRINT_UNAVAILABLE_TEXT =
    'Printing isn’t available from the installed app on iPhone or iPad. Open this page in Safari to print it or save it as a PDF.';
/** @type {string} */
export const OPEN_IN_SAFARI_LABEL = 'Open in Safari';

/**
 * Whether `window.print()` would silently do nothing here: a page launched from the Home Screen on
 * an iPhone or iPad (see the header for why no version is read).
 * @param {{ standalone?: boolean }} [env]  defaults read the live page; tests pass it.
 * @returns {boolean}
 */
export function printIsBlocked({
    standalone = typeof navigator !== 'undefined' && /** @type {any} */ (navigator).standalone === true,
} = {}) {
    return standalone === true;
}

/**
 * Open this page where printing works. From a home-screen app a `_blank` open leaves for Safari.
 * Must run inside a user gesture — the tap on the notice's button is one.
 * @param {string} [url]
 */
export function openInSafari(url = window.location.href) {
    window.open(url, '_blank', 'noopener');
}

/**
 * Print, or explain why not. Every print control goes through here.
 * @param {{ print?: () => void, explain: () => void }} opts  `print` defaults to `window.print()`.
 * @returns {boolean} true when a print was attempted
 */
export function printOrExplain({ print = () => window.print(), explain }) {
    if (printIsBlocked()) { explain(); return false; }
    print();
    return true;
}

/**
 * The app pages' explanation: the shared dialog, whose confirm is the one tap to Safari. Takes the
 * dialog as a parameter so this module stays import-free for the guides.
 * @param {(opts: { title?: string, message: string, confirmLabel?: string, cancelLabel?: string }) => Promise<boolean>} confirmDialog
 * @returns {Promise<void>}
 */
export async function explainNoPrint(confirmDialog) {
    const go = await confirmDialog({
        title: 'Printing isn’t available here',
        message: PRINT_UNAVAILABLE_TEXT,
        confirmLabel: OPEN_IN_SAFARI_LABEL,
        cancelLabel: 'Close',
    });
    if (go) openInSafari();
}
