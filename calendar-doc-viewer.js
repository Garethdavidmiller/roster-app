// @ts-check
/**
 * calendar-doc-viewer.js — in-app viewer for the Weekly Retail Circular and the
 * Marylebone Newsletter on index.html.
 *
 * Owns: the #docViewer lightbox, opened from a notification deep link
 *   (#circular / #newsletter — see .claude/rules/notifications.md and the
 *   onCircularCreated / onNewsletterCreated Cloud Function triggers).
 * Does NOT own: the Huddle viewer (calendar-huddle-viewer.js — the Huddle has its
 *   own full-bleed panel and DOCX inline-render path), uploads (operations-app.js),
 *   or the nav-drawer links (nav-panel.js still opens these in a new tab).
 *
 * Both documents are always PDFs, so — exactly like the Huddle's PDF path — the
 * viewer shows an explicit "Open" button rather than trying to render inline or
 * calling window.open() at open time: a notification tap carries no user
 * activation, so opening the file directly would be pop-up-blocked / would knock
 * the PWA out of standalone. Tapping the button IS a real gesture, so it opens the
 * file as a Custom Tab over the intact app.
 */
import { createLightbox } from './overlay.js';
import { getLatestCircular, getLatestNewsletter, isSafeStorageUrl } from './firebase-client.js';

/**
 * Per-document config. The emoji matches each feature's in-app icon (nav drawer /
 * Operations card) and its push-notification emoji — the same identity everywhere.
 * @type {Record<string, { emoji: string, label: string, fetch: () => Promise<any>, empty: string }>}
 */
const DOCS = {
    circular:   { emoji: '📰',  label: 'Weekly Retail Circular', fetch: getLatestCircular,
                  empty: "No Weekly Retail Circular has been uploaded yet — it's usually available on Friday." },
    newsletter: { emoji: '🗞️', label: 'Marylebone Newsletter',  fetch: getLatestNewsletter,
                  empty: 'No Marylebone Newsletter has been uploaded yet.' },
};

/** Wire up the document viewer and open it if the page loaded on a #circular/#newsletter deep link. */
export function initDocViewer() {
    const overlay  = /** @type {HTMLElement|null} */ (document.getElementById('docViewer'));
    const content  = /** @type {HTMLElement|null} */ (document.getElementById('docViewerContent'));
    if (!overlay || !content) return;
    // Cast the inner elements (they exist in index.html markup) so type-narrowing
    // holds inside the nested closures below — matches calendar-huddle-viewer.js.
    const titleEl  = /** @type {HTMLElement} */ (document.getElementById('docViewerTitle'));
    const bodyEl   = /** @type {HTMLElement} */ (document.getElementById('docViewerBody'));
    const closeBtn = /** @type {HTMLElement} */ (document.getElementById('docViewerClose'));

    const lb = createLightbox({ overlay, content, closeBtn });

    /** Render a short message (no markup) into the viewer body. @param {string} text @param {string} cls */
    function showMessage(text, cls) {
        bodyEl.textContent = '';
        const p = document.createElement('p');
        p.className = cls;
        p.textContent = text;
        bodyEl.appendChild(p);
    }

    /** @param {string} key 'circular' | 'newsletter' */
    async function openDoc(key) {
        const d = DOCS[key];
        if (!d) return;
        titleEl.textContent = `${d.emoji} ${d.label}`;
        showMessage('Loading…', 'doc-viewer-loading');
        lb.open();
        try {
            const doc = await d.fetch();
            if (doc && isSafeStorageUrl(doc.storageUrl)) {
                bodyEl.textContent = '';
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'doc-open-btn';
                btn.textContent = `📄 Open ${d.label}`;
                // Real user gesture → window.open opens a Custom Tab over the standalone app.
                btn.addEventListener('click', () => window.open(doc.storageUrl, '_blank', 'noopener'));
                bodyEl.appendChild(btn);
                btn.focus();
            } else {
                showMessage(d.empty, 'doc-viewer-empty');
            }
        } catch (err) {
            console.warn(`[DocViewer] ${key} fetch failed:`, err);
            showMessage("Couldn't load this document — please try again.", 'doc-viewer-empty');
        }
    }

    // A notification tap deep-links to #circular / #newsletter. Handle both a cold
    // open (page loads on the hash) and a hash-only navigation of an already-open
    // page (the SW navigates the existing window — fires hashchange, no reload).
    function handleHash() {
        const key = window.location.hash.slice(1);
        if (key !== 'circular' && key !== 'newsletter') return;
        // Clear the hash so a manual reload / Back doesn't re-open the viewer.
        history.replaceState(null, '', window.location.pathname);
        openDoc(key);
    }
    handleHash();
    window.addEventListener('hashchange', handleHash);
}
