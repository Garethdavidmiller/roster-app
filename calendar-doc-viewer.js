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
 * The viewer shows an explicit "Open" button rather than rendering inline or
 * calling window.open() at open time: a notification tap carries no user
 * activation, so opening the file directly would be pop-up-blocked / would knock
 * the PWA out of standalone. Tapping the button IS a real gesture, so it opens the
 * file as a Custom Tab over the intact app. A PDF opens by its own URL; a Word
 * (.docx) document would download if opened directly, so it is routed through
 * Microsoft's Office Online viewer (officeViewerUrl) which renders it with images.
 */
import { createLightbox } from './overlay.js';
import { getLatestCircular, getLatestNewsletter, isSafeStorageUrl, officeViewerUrl } from './firebase-client.js';
import { recordOpen } from './usage-reporter.js';
import { getCurrentMember, isFirstRun } from './calendar-member.js';

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
/**
 * @param {{ authReady?: Promise<any> }} [deps] authReady — resolves once a Firebase session exists.
 *   Awaited before the document read (AUTH_PLAN.md → E1). Defaults to already-resolved.
 */
/** Wait a moment for a session before reading, then read regardless — the user just tapped a
 *  notification and is watching a "Loading…" panel. */
const DOC_AUTH_WAIT_MS = 2000;
/** Total deadline for the whole open, mirroring the nav-drawer document path's 8s race. */
const DOC_FETCH_TIMEOUT_MS = 8000;

/** @param {number} ms */
const _delay = (ms) => new Promise(r => setTimeout(r, ms));

export function initDocViewer({ authReady = Promise.resolve() } = {}) {
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

    // Discards a superseded fetch: two rapid notification taps (#circular then #newsletter) each set
    // the title synchronously then await their fetch — if the first resolves LAST it would write its
    // "Open" button under the second's title (persistent doc/title mismatch). Only the latest tap wins.
    let _openSeq = 0;

    /** @param {string} key 'circular' | 'newsletter' */
    async function openDoc(key) {
        const d = DOCS[key];
        if (!d) return;
        const seq = ++_openSeq;
        titleEl.textContent = `${d.emoji} ${d.label}`;
        showMessage('Loading…', 'doc-viewer-loading');
        lb.open();
        try {
            // BOUNDED, not plain (v19.08). This awaited `authReady` with no deadline, and the comment
            // that used to sit here argued the visible "Loading…" made that acceptable. It does not:
            // a loading state tells you something is happening, it does not make an unbounded wait
            // RECOVERABLE. On a stalled connection where persistence setup or signInAnonymously never
            // settles, the fetch was never attempted and the viewer sat on "Loading…" forever — from
            // an explicit user action (a notification tap), with no failure ever announced to a
            // screen reader. Same shape as the nav-drawer path and the calendar retry: wait a moment
            // for a session, then read anyway; today that succeeds, and once reads require a session
            // it fails into the catch below, which now offers a retry.
            const authOrSoon = Promise.race([authReady, _delay(DOC_AUTH_WAIT_MS)]);
            const doc = await Promise.race([
                authOrSoon.then(() => (seq === _openSeq ? d.fetch() : null)),
                _delay(DOC_FETCH_TIMEOUT_MS).then(() => { throw new Error('doc-fetch-timeout'); }),
            ]);
            if (seq !== _openSeq) return;   // a newer tap superseded this one — don't clobber its content
            if (doc && isSafeStorageUrl(doc.storageUrl)) {
                bodyEl.textContent = '';
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'doc-open-btn';
                btn.textContent = `📄 Open ${d.label}`;
                // A .docx would download if opened directly — render it via the Office Online
                // viewer instead. PDFs open by their own URL (browsers show them inline).
                const openUrl = doc.fileType === 'docx' ? officeViewerUrl(doc.storageUrl) : doc.storageUrl;
                // Real user gesture → window.open opens a Custom Tab over the standalone app.
                // Counted here (not on viewer open) so the count means the document was actually
                // opened — mirroring the nav-drawer path (v18.20; admin-excluded, anonymous).
                btn.addEventListener('click', () => {
                    // Identity: null on a first-run device — the DEFAULT selection is the
                    // developer, and excluding on it would drop fresh visitors' opens (v18.22).
                    recordOpen(key, isFirstRun() ? null : getCurrentMember()?.name ?? null);
                    window.open(openUrl, '_blank', 'noopener');
                });
                bodyEl.appendChild(btn);
                btn.focus();
            } else {
                showMessage(d.empty, 'doc-viewer-empty');
            }
        } catch (err) {
            if (seq !== _openSeq) return;   // superseded — leave the newer tap's content alone
            console.warn(`[DocViewer] ${key} fetch failed:`, err);
            // A RETRY CONTROL, not just text (v19.08). "please try again" with nothing to press is a
            // dead end — and for a screen-reader user it is the only thing that ever replaces
            // "Loading…", so it has to be actionable.
            bodyEl.textContent = '';
            const msg = document.createElement('p');
            msg.className = 'doc-viewer-empty';
            msg.textContent = "Couldn't load this document.";
            const again = document.createElement('button');
            again.type = 'button';
            again.className = 'doc-open-btn';
            again.textContent = '↻ Try again';
            again.addEventListener('click', () => openDoc(key));
            bodyEl.appendChild(msg);
            bodyEl.appendChild(again);
            again.focus();
        }
    }

    // A notification tap deep-links to #circular / #newsletter. Handle both a cold
    // open (page loads on the hash) and a hash-only navigation of an already-open
    // page (the SW navigates the existing window — fires hashchange, no reload).
    function handleHash() {
        const key = window.location.hash.slice(1);
        if (key !== 'circular' && key !== 'newsletter') return;
        // Clear the hash so a manual reload / Back doesn't re-open the viewer.
        history.replaceState(null, '', window.location.pathname + window.location.search);
        openDoc(key);
    }
    handleHash();
    window.addEventListener('hashchange', handleHash);
}
