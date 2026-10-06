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
 * `printIsBlocked()` is true only for `navigator.standalone === true`, which exists on iOS alone and
 * is true only when the page was launched from the Home Screen — it is the one signal that names
 * this exact situation, where `display-mode: standalone` would also be true on an installed Android
 * app that prints perfectly well. The iOS major version is read from the user agent; 27 and above
 * are blocked, and so is an UNKNOWN version, because an iPad on its desktop-class user agent carries
 * no version at all and is the device most likely to be printing. An iPhone on iOS 26 or earlier,
 * where the bug does not exist, keeps its print. When Apple ships the fix, raise the floor here —
 * one number — rather than removing the guard, since the installs it protects update on their own
 * schedule.
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

/** The first iOS release on which a home-screen web app cannot print. Raise when Apple fixes it. */
export const PRINT_BLOCKED_FROM_IOS = 27;

/**
 * The iOS major version a user agent names, or null when it names none (an iPad on its desktop
 * user agent, or any non-iOS browser).
 * @param {string} [ua]
 * @returns {number|null}
 */
export function iosMajorVersion(ua = typeof navigator === 'undefined' ? '' : navigator.userAgent) {
    const m = /(?:iPhone|iPad|iPod).*? OS (\d+)_/.exec(ua) || /CPU OS (\d+)_/.exec(ua);
    return m ? parseInt(m[1], 10) : null;
}

/**
 * Whether `window.print()` would silently do nothing here.
 * @param {{ standalone?: boolean, iosMajor?: number|null }} [env]  defaults read the live page;
 *   tests pass both.
 * @returns {boolean}
 */
export function printIsBlocked({
    standalone = typeof navigator !== 'undefined' && /** @type {any} */ (navigator).standalone === true,
    iosMajor = iosMajorVersion(),
} = {}) {
    if (!standalone) return false;
    return iosMajor === null || iosMajor >= PRINT_BLOCKED_FROM_IOS;
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
