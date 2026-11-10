// @ts-check
/**
 * pdf-viewer.js — the in-app PDF viewer: a full-screen panel with a ✕ that draws a PDF's pages with
 * PDF.js, so a document opens INSIDE the app and is closed back to it. Why the app does this at all,
 * rather than linking the file: pdf-viewer-core.js's header (the iPhone with no way back).
 *
 * Owns: #pdfViewer and its parts (the page carries the markup — newlink.html), loading PDF.js on
 * first use, fetching the file, drawing its pages, zoom, the failure state, and the "open it on its
 * own" link where that is safe. Its rules — page sizes, zoom steps, when a file may be opened outside
 * the app, what a failure says — are pdf-viewer-core.js, pure and tested in Node.
 * Does NOT own: which files exist or how they are listed (the page: newlink-render.js / newlink-app.js),
 * or the lifecycle — focus, scroll lock, Escape, Android Back and the Tab trap are createLightbox's
 * (overlay.js), like every other overlay in the app. It is not a fourth hand-rolled exception.
 *
 * ── THE LIBRARY ─────────────────────────────────────────────────────────────────────────────────
 *
 * PDF.js 4.10.38 — Mozilla's renderer, the one inside Firefox and the version the server's roster
 * reader already uses — VENDORED in pdfjs/ (the legacy build: it supports Safari 16.4, the oldest iOS
 * the app supports). Served from our own origin because its worker must be: a browser will not start
 * a Worker from another origin, and `worker-src 'self'` would refuse one anyway. It is NOT precached —
 * about 1.8 MB that most members never need — so the service worker's cache-first branch keeps it once
 * it has been used. It loads by URL, not by a static import, so no page pays for it until a file opens
 * and the typecheck never reads the minified bundle.
 *
 * ── THREE THINGS THAT ARE EASY TO GET WRONG ─────────────────────────────────────────────────────
 *
 *  1. ONLY PAGES NEAR THE SCREEN ARE DRAWN. A canvas per page for a 15-page presentation at 2× zoom
 *     is more memory than an older iPhone gives a tab, and iOS answers by reloading the page — the
 *     reader would lose the viewer and the page under it. An IntersectionObserver draws a page as it
 *     comes within a screen of view and frees its canvas when it leaves; pdf-viewer-core.js caps each
 *     canvas's pixels.
 *  2. A CLOSED VIEWER STOPS. Closing aborts the download, cancels drawing and destroys the document
 *     (and with it PDF.js's worker). Every await re-checks that the load it belongs to is still the
 *     current one, so a slow file that arrives after the reader has closed it — or opened another —
 *     draws nothing.
 *  3. `isEvalSupported: false`. PDF.js compiles some PDF functions with `new Function`, which the CSP
 *     forbids; without this it would try, be refused, and log a violation on every such file.
 *
 * ── A PAGE THAT CANNOT BE DRAWN SAYS SO (external review, 10 Nov 2026) ─────────────────────────
 *
 * The file can open and one page still fail: PDF.js refuses it, or the browser gives its canvas no
 * memory to draw in (an older iPhone near its limit). Such a page was marked failed and skipped in
 * silence — a blank white box, no word why, no way to try it again short of zooming. Its box now says
 * so, with a Try again of its own; a zoom or a resize clears it too, as it always did. A failed page is
 * never retried on its own, because a page PDF.js cannot draw would fail again in a loop.
 */
import { createLightbox } from './overlay.js';
import { fetchWithTimeout, isFetchTimeout } from './fetch-timeout.js';
import {
    ZOOM_STEPS, zoomAfter, zoomLabel, pageLayout, canOpenOutside, classifyFailure, FAILURE_TEXT,
    PAGE_FAILURE_TEXT, pageLabel, pagesLabel,
} from './pdf-viewer-core.js';

const LIBRARY_URL = new URL('./pdfjs/pdf.min.mjs', import.meta.url).href;
const WORKER_URL = new URL('./pdfjs/pdf.worker.min.mjs', import.meta.url).href;

/** The pack's largest file is about 1.4 MB: generous on a poor signal, and never for ever. */
const FETCH_BUDGET_MS = 45_000;

/** @type {Promise<any>|null} */ let _library = null;
let _libraryAttempts = 0;

/**
 * PDF.js, loaded once. A FAILED load is forgotten, so "Try again" really tries again — and it asks
 * for a fresh address, because a browser may keep a module that failed to arrive as failed for the
 * life of the page.
 * @returns {Promise<any>}
 */
function loadLibrary() {
    if (!_library) {
        const url = _libraryAttempts++ ? `${LIBRARY_URL}?attempt=${_libraryAttempts}` : LIBRARY_URL;
        _library = import(url).then((lib) => {
            lib.GlobalWorkerOptions.workerSrc = WORKER_URL;
            return lib;
        });
        _library.catch(() => { _library = null; });
    }
    return _library;
}

/** Installed to the home screen (Android or iOS), where an in-scope link has no way back on an iPhone. */
function isStandalone() {
    try {
        return !!window.matchMedia?.('(display-mode: standalone)').matches
            || /** @type {any} */ (navigator).standalone === true;
    } catch {
        return false;
    }
}

/** @param {HTMLCanvasElement} canvas  frees the bitmap now — iOS returns canvas memory on a zero size */
function freeCanvas(canvas) {
    canvas.width = 0;
    canvas.height = 0;
    canvas.remove();
}

/**
 * @typedef {object} PageEntry
 * @property {any} page            PDF.js's PDFPageProxy
 * @property {number} width        page width at scale 1
 * @property {number} height       page height at scale 1
 * @property {HTMLElement} wrap    the page's box in the sheet
 * @property {HTMLElement} words   the page's text, for a screen reader
 * @property {ReturnType<typeof pageLayout>} layout
 * @property {HTMLCanvasElement|null} canvas
 * @property {number} drawnWidth   the pixel width `canvas` was drawn at (0 = nothing drawn)
 * @property {any} task            the render task in flight, or null
 * @property {boolean} near        within a screen of view
 * @property {boolean} failed      it could not be drawn; not retried until its Try again, a zoom or a resize
 * @property {HTMLElement|null} notice  the "could not be shown" box with its Try again, while it is failed
 */

/**
 * Wire the viewer, if this page carries its markup. Returns null on a page that does not.
 * @returns {{ open: (file: { url: string, title: string, kicker?: string, pages?: number }) => void }|null}
 */
export function initPdfViewer() {
    const overlay = document.getElementById('pdfViewer');
    if (!overlay) return null;
    const panel = /** @type {HTMLElement} */ (document.getElementById('pdfViewerPanel'));
    const closeBtn = /** @type {HTMLElement} */ (document.getElementById('pdfViewerClose'));
    const titleEl = /** @type {HTMLElement} */ (document.getElementById('pdfViewerTitle'));
    const metaEl = /** @type {HTMLElement} */ (document.getElementById('pdfViewerMeta'));
    const pagesEl = /** @type {HTMLElement} */ (document.getElementById('pdfViewerPages'));
    const sheetEl = /** @type {HTMLElement} */ (document.getElementById('pdfViewerSheet'));
    const statusEl = /** @type {HTMLElement} */ (document.getElementById('pdfViewerStatus'));
    const retryBtn = /** @type {HTMLButtonElement} */ (document.getElementById('pdfViewerRetry'));
    const footEl = /** @type {HTMLElement} */ (document.getElementById('pdfViewerFoot'));
    const outsideEl = /** @type {HTMLAnchorElement} */ (document.getElementById('pdfViewerOutside'));
    const zoomOutBtn = /** @type {HTMLButtonElement} */ (document.getElementById('pdfViewerZoomOut'));
    const zoomInBtn = /** @type {HTMLButtonElement} */ (document.getElementById('pdfViewerZoomIn'));
    const zoomLevelEl = /** @type {HTMLElement} */ (document.getElementById('pdfViewerZoomLevel'));

    /**
     * The load on screen. Replaced on every open and every retry; null while closed.
     * @type {{ url: string, abort: AbortController, task: any, entries: PageEntry[], zoom: number,
     *          observer: IntersectionObserver|null, resize: ResizeObserver|null, boxWidth: number }|null}
     */
    let current = null;
    /** @type {string} */ let currentUrl = '';
    let drawing = false;

    const lightbox = createLightbox({
        overlay,
        content: panel,
        closeBtn,
        onClose: stop,
        // The pages go once the fade has finished, so the panel does not empty while it is still on screen.
        // Only if nothing was opened since: a re-open during the fade has already replaced them.
        afterClose: () => { if (!current) clearSheet(); },
    });

    zoomOutBtn.addEventListener('click', () => { if (current) setZoom(zoomAfter(current.zoom, -1)); });
    zoomInBtn.addEventListener('click', () => { if (current) setZoom(zoomAfter(current.zoom, 1)); });
    retryBtn.addEventListener('click', () => { if (currentUrl) load(currentUrl); });

    /** @param {{ url: string, title: string, kicker?: string, pages?: number }} file */
    function open(file) {
        titleEl.textContent = file.title;
        metaEl.textContent = [file.kicker, 'PDF', file.pages ? pagesLabel(file.pages) : ''].filter(Boolean).join(' · ');
        outsideEl.href = file.url;
        footEl.hidden = !canOpenOutside({ fileUrl: file.url, pageUrl: location.href, standalone: isStandalone() });
        lightbox.open();
        load(file.url);
    }

    /** Empty the sheet, freeing every canvas in it. */
    function clearSheet() {
        for (const canvas of sheetEl.querySelectorAll('canvas')) freeCanvas(/** @type {HTMLCanvasElement} */ (canvas));
        sheetEl.replaceChildren();
    }

    /** Stop everything the current load is doing — the download, the drawing, PDF.js's worker. */
    function stop() {
        const was = current;
        current = null;
        if (!was) return;
        was.abort.abort();
        was.observer?.disconnect();
        was.resize?.disconnect();
        for (const entry of was.entries) entry.task?.cancel();
        // destroy() ends the document AND the worker PDF.js started for it. Nothing to report if it fails.
        Promise.resolve(was.task?.destroy()).catch(() => {});
    }

    /** @param {string} text @param {{ busy?: boolean, retry?: boolean }} [o] */
    function showStatus(text, { busy = false, retry = false } = {}) {
        statusEl.textContent = text;
        pagesEl.setAttribute('aria-busy', String(busy));
        retryBtn.hidden = !retry;
    }

    function updateZoom() {
        const zoom = current?.zoom ?? 1;
        const ready = !!current?.entries.length;
        zoomOutBtn.disabled = !ready || zoom <= ZOOM_STEPS[0];
        zoomInBtn.disabled = !ready || zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1];
        zoomLevelEl.textContent = zoomLabel(zoom);
    }

    /** @param {string} url */
    async function load(url) {
        stop();
        clearSheet();
        currentUrl = url;
        const mine = {
            url, abort: new AbortController(), task: /** @type {any} */ (null), entries: /** @type {PageEntry[]} */ ([]),
            zoom: 1, observer: /** @type {IntersectionObserver|null} */ (null), resize: /** @type {ResizeObserver|null} */ (null),
            boxWidth: 0,
        };
        current = mine;
        updateZoom();
        showStatus('Opening…', { busy: true });
        try {
            const lib = await loadLibrary();
            if (current !== mine) return;
            const res = await fetchWithTimeout(url, { signal: mine.abort.signal }, FETCH_BUDGET_MS);
            if (!res.ok) throw Object.assign(new Error(`The file answered ${res.status}`), { status: res.status });
            const data = new Uint8Array(await res.arrayBuffer());
            if (current !== mine) return;
            mine.task = lib.getDocument({ data, isEvalSupported: false, verbosity: lib.VerbosityLevel.ERRORS });
            const pdf = await mine.task.promise;
            if (current !== mine) return;
            const pages = await Promise.all(Array.from({ length: pdf.numPages }, (_, i) => pdf.getPage(i + 1)));
            if (current !== mine) return;
            build(mine, pages);
            showStatus('');
            readWords(mine);
        } catch (err) {
            if (current !== mine) return;   // closed, or another file opened — nothing to say about this one
            console.error('[pdf-viewer] could not open', url, err);
            const e = /** @type {any} */ (err);
            const kind = classifyFailure({
                online: navigator.onLine !== false,
                status: typeof e?.status === 'number' ? e.status : undefined,
                timedOut: isFetchTimeout(e),
                networkError: e instanceof TypeError,
            });
            showStatus(FAILURE_TEXT[kind], { retry: true });
        }
    }

    /** The width a page may fill at 1×: the scroll box less its padding. */
    function boxWidth() {
        const style = getComputedStyle(pagesEl);
        return pagesEl.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    }

    /** @param {NonNullable<typeof current>} mine @param {any[]} pages */
    function build(mine, pages) {
        const total = pages.length;
        mine.boxWidth = boxWidth();
        mine.entries = pages.map((page, i) => {
            const viewport = page.getViewport({ scale: 1 });
            const wrap = document.createElement('div');
            wrap.className = 'pdf-viewer-page';
            wrap.setAttribute('role', 'group');
            wrap.setAttribute('aria-label', pageLabel(i + 1, total));
            const words = document.createElement('p');
            words.className = 'visually-hidden';
            wrap.append(words);
            sheetEl.append(wrap);
            return {
                page, width: viewport.width, height: viewport.height, wrap, words,
                layout: pageLayout({ pageWidth: viewport.width, pageHeight: viewport.height, boxWidth: mine.boxWidth }),
                canvas: null, drawnWidth: 0, task: null, near: false, failed: false, notice: null,
            };
        });
        layout(mine);
        updateZoom();
        const byWrap = new Map(mine.entries.map(e => [e.wrap, e]));
        if (typeof IntersectionObserver === 'function') {
            mine.observer = new IntersectionObserver((records) => {
                for (const r of records) {
                    const entry = byWrap.get(/** @type {HTMLElement} */ (r.target));
                    if (!entry) continue;
                    entry.near = r.isIntersecting;
                    // Out of reach: give its memory back. One mid-draw is freed when the draw lands.
                    if (!entry.near && entry.canvas && !entry.task) {
                        freeCanvas(entry.canvas);
                        entry.canvas = null;
                        entry.drawnWidth = 0;
                    }
                }
                drawNext();
            }, { root: pagesEl, rootMargin: '100% 0px' });
            for (const entry of mine.entries) mine.observer.observe(entry.wrap);
        } else {
            for (const entry of mine.entries) entry.near = true;   // no observer: draw them all, in order
            drawNext();
        }
        if (typeof ResizeObserver === 'function') {
            /** @type {ReturnType<typeof setTimeout>|undefined} */ let settle;
            mine.resize = new ResizeObserver(() => {
                clearTimeout(settle);
                settle = setTimeout(() => {
                    if (current !== mine) return;
                    const width = boxWidth();
                    if (Math.abs(width - mine.boxWidth) < 1) return;
                    mine.boxWidth = width;
                    layout(mine);
                    drawNext();
                }, 150);
            });
            mine.resize.observe(pagesEl);
        }
    }

    /** Size every page box for the current zoom and width. A canvas already there stretches until redrawn. @param {NonNullable<typeof current>} mine */
    function layout(mine) {
        const dpr = window.devicePixelRatio || 1;
        for (const entry of mine.entries) {
            entry.layout = pageLayout({ pageWidth: entry.width, pageHeight: entry.height, boxWidth: mine.boxWidth, zoom: mine.zoom, dpr });
            entry.wrap.style.width = `${entry.layout.cssWidth}px`;
            entry.wrap.style.height = `${entry.layout.cssHeight}px`;
            clearFailure(entry);   // a new size is worth one more try
        }
    }

    /**
     * The page could not be drawn: say so in its box, with a Try again for that page alone. Any older drawing of it goes,
     * so the box holds the notice and nothing stale beneath it.
     * @param {PageEntry} entry
     */
    function markFailed(entry) {
        entry.failed = true;
        if (entry.canvas) {
            freeCanvas(entry.canvas);
            entry.canvas = null;
            entry.drawnWidth = 0;
        }
        if (entry.notice) return;
        const notice = document.createElement('div');
        notice.className = 'pdf-viewer-page-failed';
        const text = document.createElement('p');
        text.textContent = PAGE_FAILURE_TEXT;
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'pdf-viewer-page-retry';
        retry.textContent = 'Try again';
        retry.addEventListener('click', () => retryPage(entry));
        notice.append(text, retry);
        entry.wrap.append(notice);
        entry.notice = notice;
    }

    /** Clear a page's failure, and its notice. @param {PageEntry} entry */
    function clearFailure(entry) {
        entry.failed = false;
        if (!entry.notice) return;
        // Focus on its button would go with it, out of the viewer to the page beneath: keep it on the pages.
        if (entry.notice.contains(document.activeElement)) pagesEl.focus({ preventScroll: true });
        entry.notice.remove();
        entry.notice = null;
    }

    /** One page's Try again: clear it and draw it. @param {PageEntry} entry */
    function retryPage(entry) {
        if (!current?.entries.includes(entry)) return;   // a notice left from a load that has since gone
        clearFailure(entry);
        drawNext();
    }

    /** @param {number} zoom */
    function setZoom(zoom) {
        const mine = current;
        if (!mine || !mine.entries.length || zoom === mine.zoom) return;
        // Keep the reader's place: whatever was at the middle of the box stays at the middle.
        const midY = (pagesEl.scrollTop + pagesEl.clientHeight / 2) / Math.max(1, pagesEl.scrollHeight);
        const midX = (pagesEl.scrollLeft + pagesEl.clientWidth / 2) / Math.max(1, pagesEl.scrollWidth);
        mine.zoom = zoom;
        layout(mine);
        pagesEl.scrollTop = midY * pagesEl.scrollHeight - pagesEl.clientHeight / 2;
        pagesEl.scrollLeft = midX * pagesEl.scrollWidth - pagesEl.clientWidth / 2;
        updateZoom();
        drawNext();
    }

    /** Draw the pages that need it, one at a time, nearest the middle of the box first. */
    async function drawNext() {
        if (drawing) return;
        drawing = true;
        try {
            for (;;) {
                const mine = current;
                if (!mine) return;
                const middle = pagesEl.scrollTop + pagesEl.clientHeight / 2;
                const distance = (/** @type {PageEntry} */ e) => Math.abs(e.wrap.offsetTop + e.wrap.offsetHeight / 2 - middle);
                const next = mine.entries
                    .filter(e => e.near && !e.failed && e.drawnWidth !== e.layout.pixelWidth)
                    .sort((a, b) => distance(a) - distance(b))[0];
                if (!next) return;
                await draw(mine, next);
            }
        } finally {
            drawing = false;
        }
    }

    /** @param {NonNullable<typeof current>} mine @param {PageEntry} entry */
    async function draw(mine, entry) {
        const plan = entry.layout;
        const canvas = document.createElement('canvas');
        canvas.width = plan.pixelWidth;
        canvas.height = plan.pixelHeight;
        canvas.setAttribute('aria-hidden', 'true');
        const context = canvas.getContext('2d', { alpha: false });
        // No context: the browser would not give this canvas memory to draw in. Said, not skipped.
        if (!context) {
            freeCanvas(canvas);
            console.error('[pdf-viewer] no drawing context for a page');
            markFailed(entry);
            return;
        }
        try {
            entry.task = entry.page.render({ canvasContext: context, viewport: entry.page.getViewport({ scale: plan.scale }) });
            await entry.task.promise;
        } catch (err) {
            freeCanvas(canvas);
            // A cancelled draw is the viewer closing or the page leaving; anything else is a page PDF.js
            // could not draw, and trying it again in a loop would never end.
            if (current === mine && /** @type {any} */ (err)?.name !== 'RenderingCancelledException') {
                console.error('[pdf-viewer] could not draw a page', err);
                markFailed(entry);
            }
            return;
        } finally {
            entry.task = null;
        }
        // Landed too late: the viewer closed, the page left reach, or the zoom moved on while it drew.
        if (current !== mine || !entry.near || entry.layout !== plan) { freeCanvas(canvas); return; }
        if (entry.canvas) freeCanvas(entry.canvas);
        entry.canvas = canvas;
        entry.drawnWidth = plan.pixelWidth;
        entry.wrap.prepend(canvas);
    }

    /**
     * Each page's words, for a screen reader — which cannot read a drawing. Read in the background,
     * page by page, after the pages are on screen; a page whose words cannot be read still opens.
     * @param {NonNullable<typeof current>} mine
     */
    async function readWords(mine) {
        for (const entry of mine.entries) {
            if (current !== mine) return;
            try {
                const content = await entry.page.getTextContent();
                if (current !== mine) return;
                entry.words.textContent = content.items
                    .map((/** @type {any} */ item) => (typeof item.str === 'string' ? item.str : ''))
                    .join(' ').replace(/\s+/g, ' ').trim();
            } catch { /* the drawing is what matters */ }
        }
    }

    return { open };
}
