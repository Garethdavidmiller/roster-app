// @ts-check
/**
 * pdf-viewer-core.js — the rules behind the in-app PDF viewer (pdf-viewer.js), as pure functions:
 * how big a page is drawn, which zoom comes next, whether a file may be opened OUTSIDE the app, and
 * what a failure says. No DOM, no PDF.js, no clock, so every rule here runs in Node
 * (pdf-viewer-core.test.mjs).
 *
 * ── WHY THE APP DRAWS PDFs ITSELF (owner, 10 Nov 2026) ─────────────────────────────────────────
 *
 * "The pdfs on the new links page don't have a close button like the huddle pdf does. This is
 * particularly an issue on iphone." The New link pack's PDFs are served by the GitHub Pages mirror,
 * so for an app installed from that address they are inside the app's own scope — and iOS opens an
 * in-scope link in the app's OWN window, which on an iPhone has no Back and no toolbar: the reader was
 * left on the PDF with no way back but closing the app. The Huddle escapes because its file is on
 * Firebase Storage, outside every install's scope, so iOS gives it its own viewer with a Done button.
 * A redirect cannot borrow that: iOS hands a navigation that comes back into scope straight back to
 * the app's window. So the pages are drawn here, in a panel with a ✕, the same on every phone and both
 * addresses (owner's choice over serving the pack from Firebase as well, 10 Nov 2026).
 *
 * ── THE ONE RULE THAT IS EASY TO UNDO ───────────────────────────────────────────────────────────
 *
 * `canOpenOutside` decides whether the viewer may offer "Open the PDF on its own". It may NOT where
 * the app runs installed AND the file is inside the app's scope: that is the exact trap the viewer
 * exists to remove, and a helpful-looking link would put it back.
 */

/** Zoom, as a multiple of "the page fits the box" (pageLayout): a phone reads a sheet's weekly grid at 2× or 3×. */
export const ZOOM_STEPS = Object.freeze([1, 1.5, 2, 3]);

/**
 * At most two device pixels per CSS pixel. An iPhone's screen is 3×, and drawing every page at 3×
 * costs 2.25 times the memory of 2× for a difference nobody reads; iOS kills a tab that holds too much
 * canvas, and the viewer would close itself mid-read.
 */
export const MAX_DEVICE_PIXEL_RATIO = 2;

/**
 * The most pixels one page's canvas may hold (3 MP, about 12 MB). At 3× zoom an A4 page on a phone
 * would want over 7 MP; past this cap it is drawn a little softer instead, and only the pages near the
 * screen are drawn at all (pdf-viewer.js), so a 15-page file never holds fifteen of them.
 */
export const MAX_CANVAS_PIXELS = 3_145_728;

/**
 * The widest a page is drawn at 1×, in CSS pixels. On a desktop the box is far wider than a page needs
 * to be read, and a sheet blown up to 1,900 pixels is a sheet you scroll sideways to read a line of.
 */
export const MAX_FIT_WIDTH = 960;

/**
 * The next zoom step in a direction, or the current one at either end.
 * @param {number} current  a value from ZOOM_STEPS (anything else snaps to the nearest step first)
 * @param {1|-1} direction  1 = in, -1 = out
 * @returns {number}
 */
export function zoomAfter(current, direction) {
    let at = ZOOM_STEPS.indexOf(current);
    if (at < 0) {
        at = ZOOM_STEPS.reduce((best, step, i) => (Math.abs(step - current) < Math.abs(ZOOM_STEPS[best] - current) ? i : best), 0);
    }
    const next = Math.min(ZOOM_STEPS.length - 1, Math.max(0, at + direction));
    return ZOOM_STEPS[next];
}

/** "100%", "150%" — the zoom as a reader says it. @param {number} zoom */
export const zoomLabel = (zoom) => `${Math.round(zoom * 100)}%`;

/**
 * How one page is drawn: its size on screen and the size of the canvas behind it.
 *
 * @param {object} p
 * @param {number} p.pageWidth   the page's width at scale 1 (PDF points — what PDF.js's viewport reports)
 * @param {number} p.pageHeight  its height at scale 1
 * @param {number} p.boxWidth    the width the page may fill at 1× zoom, in CSS pixels
 * @param {number} [p.boxHeight] the height a LANDSCAPE page may fill at 1× zoom; 0 or absent fits the width only.
 *   A slide is read one at a time, so at 1× it fits the window both ways: fitted to the width alone, a 16:9 slide was
 *   960×540 on a laptop that shows 444px under the bar, the bottom of every slide was always off screen, and "−" is
 *   disabled at 1× (laptop polish, 13 Nov 2026). A PORTRAIT sheet keeps the width fit and is read by scrolling: fitted
 *   to a laptop's height an A4 page would be 314px wide, and its weekly grid unreadable.
 * @param {number} [p.zoom]      a ZOOM_STEPS value
 * @param {number} [p.dpr]       window.devicePixelRatio
 * @param {number} [p.maxPixels] the canvas pixel cap
 * @returns {{ cssWidth: number, cssHeight: number, pixelWidth: number, pixelHeight: number, scale: number }}
 *   `scale` is what PDF.js's getViewport takes to fill `pixelWidth`
 */
export function pageLayout({ pageWidth, pageHeight, boxWidth, boxHeight = 0, zoom = 1, dpr = 1, maxPixels = MAX_CANVAS_PIXELS }) {
    let fit = Math.min(MAX_FIT_WIDTH, Math.floor(boxWidth));
    if (boxHeight > 0 && pageWidth > pageHeight) fit = Math.min(fit, Math.floor(boxHeight * pageWidth / pageHeight));
    fit = Math.max(1, fit);
    const cssWidth = Math.max(1, Math.floor(fit * zoom));
    const cssHeight = Math.max(1, Math.round(cssWidth * pageHeight / pageWidth));
    let density = Math.min(Math.max(dpr || 1, 1), MAX_DEVICE_PIXEL_RATIO);
    if (cssWidth * cssHeight * density * density > maxPixels) density = Math.sqrt(maxPixels / (cssWidth * cssHeight));
    const pixelWidth = Math.max(1, Math.floor(cssWidth * density));
    const pixelHeight = Math.max(1, Math.floor(cssHeight * density));
    return { cssWidth, cssHeight, pixelWidth, pixelHeight, scale: pixelWidth / pageWidth };
}

/**
 * May the viewer offer to open this file OUTSIDE the app?
 *
 * In a browser tab, always: the file opens in a tab of its own, and the browser has a way back. In an
 * installed app, only when the file is OUTSIDE the app's scope — then the phone opens it in its own
 * viewer, with Done (iPhone) or ✕ (Android), exactly as it opens the Huddle. Inside the scope it would
 * open in the app's own window, with no way back on an iPhone — the trap this viewer exists to remove.
 *
 * The scope is the folder the app's pages are in (manifest.json `scope: "./"`): `/` on Firebase,
 * `/roster-app/` on the GitHub Pages mirror.
 *
 * @param {{ fileUrl: string, pageUrl: string, standalone: boolean }} p
 * @returns {boolean}
 */
export function canOpenOutside({ fileUrl, pageUrl, standalone }) {
    if (!standalone) return true;
    let file, scope;
    try {
        file = new URL(fileUrl, pageUrl);
        scope = new URL('./', pageUrl);
    } catch {
        return false;   // an address we cannot read is not one to send a reader to
    }
    return !(file.origin === scope.origin && file.pathname.startsWith(scope.pathname));
}

/**
 * A click the viewer should take over: the main button with no modifier. Ctrl-, Cmd-, Shift- and
 * middle-click keep the browser's own meaning (a new tab or window), which is what a desktop reader
 * asking for one wants.
 * @param {{ button?: number, metaKey?: boolean, ctrlKey?: boolean, shiftKey?: boolean, altKey?: boolean, defaultPrevented?: boolean }} e
 */
export function isPlainClick(e) {
    return (e.button ?? 0) === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && !e.defaultPrevented;
}

/**
 * What went wrong, in the three kinds a reader can act on differently.
 *  - `connection`: no signal, or the file took too long to arrive — try again with a signal.
 *  - `gone`: the address answered 404 — the page's list is older than the pack, so reload the page.
 *  - `broken`: anything else (a server error, a file PDF.js could not read) — the admin's problem.
 * @param {{ online?: boolean, status?: number, timedOut?: boolean, networkError?: boolean }} p
 * @returns {'connection'|'gone'|'broken'}
 */
export function classifyFailure({ online = true, status, timedOut = false, networkError = false }) {
    if (!online || timedOut || networkError) return 'connection';
    if (status === 404 || status === 410) return 'gone';
    return 'broken';
}

/** What each kind of failure says. App problems are the admin's (CLAUDE.md → "the admin" vs "your manager"). */
export const FAILURE_TEXT = Object.freeze({
    connection: 'This file needs a connection. Check your signal, then try again.',
    gone: 'This file is no longer in the pack. Reload the page to see the current files.',
    broken: 'This file could not be shown. Try again, and tell the admin if it keeps happening.',
});

/**
 * What a page says in its own box when the file opened but that page could not be drawn — PDF.js refused it, or the
 * browser gave its canvas no memory to draw in. Its button tries that page again (external review, 10 Nov 2026).
 */
export const PAGE_FAILURE_TEXT = 'This page could not be shown.';

/** "Page 3 of 8" — each page's name to a screen reader. @param {number} n @param {number} total */
export const pageLabel = (n, total) => `Page ${n} of ${total}`;

/** "1 page", "15 pages". @param {number} total */
export const pagesLabel = (total) => `${total} ${total === 1 ? 'page' : 'pages'}`;
