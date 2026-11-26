// @ts-check
/**
 * nav-latest-doc.js — The drawer's two document rows, the Circular and the Newsletter: one tap opens the latest
 * issue in a new tab, or says in the drawer's info panel why it cannot.
 *
 * Moved out of nav-panel.js (25 Nov 2026), which builds one opener per `initNavPanel` and calls it from its
 * delegated click. What a tap must get right, each argued where it is decided below: the document GATE before
 * the blank tab opens (`canReadDocuments`); the blank tab opened ON the gesture, so Safari does not call the
 * later navigation a popup; ONE budget for the read and the short-lived link; an access refusal told apart from
 * a connection fault; a phone that gives no tab back (an installed iOS app) handed to the Calendar's in-app
 * viewer through the drawer's own link path; and every late answer dropped unless THIS drawer is still the
 * open surface — a rebuilt drawer (`resetNavPanel`) removes the old element, so `panel.isConnected` says so.
 */

import { isSafeStorageUrl, resolveDocumentOpenUrl, fetchSignedDocumentUrl } from './firebase-client.js';
import { whenHistorySettled } from './overlay.js';
import { recordLatestNewsletter } from './newsletter-recency.js';
import { isAccessFailure } from './claim-retry.js';
import { recordOpen } from './usage-reporter.js';

/** How long a drawer document tap waits for a session before reading anyway — a "here's a response"
 *  budget, not a general timeout. The whole open stays inside `DOC_FETCH_BUDGET_MS`. */
const DOC_AUTH_WAIT_MS = 2000;
/** The most a drawer document tap waits, from the tap, before it gives its answer: the read and the
 *  short-lived link race this one budget, and past it the stored url (or the fallback) is used. */
const DOC_FETCH_BUDGET_MS = 8000;

/**
 * Build the drawer's document opener. The drawer's collaborators are passed under the names nav-panel.js gives
 * them, so the bodies read as they did there. `isPanelOpen` reads the drawer's open flag, which stays
 * nav-panel.js's: its reset and its Back handler ask it too.
 * @param {{ panel: HTMLElement, isPanelOpen: () => boolean, closePanel: () => void, _closePanelVisualOnly: () => void,
 *   _openComingSoon: (triggerEl?: HTMLElement, overrideBody?: string) => void, _onCalendarPage: () => boolean,
 *   canReadDocuments: () => boolean, authReady: Promise<any>, _usageId: string|null }} drawer
 */
export function createLatestDocOpener({ panel, isPanelOpen, closePanel, _closePanelVisualOnly, _openComingSoon, _onCalendarPage, canReadDocuments, authReady, _usageId }) {
    // Guard against repeated taps while a circular/newsletter Firestore fetch is in flight.
    let _docFetching = false;

    /**
     * Failure/no-doc fallback for _openLatestDoc, GUARDED on the drawer still being the open
     * surface: the fetch can settle up to 8s later, and over App Notices or About it would unlock
     * THAT lightbox's scroll and stack on its history entry. If the panel is no longer open, the
     * fallback is dropped (the spinner was already cleared by the .finally).
     * @param {HTMLElement} triggerEl @param {string} [msg]
     */
    function _docFailureFallback(triggerEl, msg) {
        // …and only THIS drawer: a slow read that answers after `resetNavPanel` rebuilt the drawer belongs
        // to one no longer on the page, and closing "the open drawer" then closed the new one's state
        // under it — Escape stopped working (review, 21 Nov 2026). A rebuild removes the old element.
        if (!isPanelOpen() || panel.isConnected === false) return;
        _closePanelVisualOnly();
        _openComingSoon(triggerEl, msg);
    }

    /**
     * Opens the latest Circular or Newsletter in a new tab — DIRECTLY, in one tap.
     * A PDF opens by its own URL (browsers render it inline); a Word (.docx) document
     * would DOWNLOAD if opened directly, so it is routed through Microsoft's Office
     * Online viewer (officeViewerUrl) which renders it — with images — in the same tab.
     * The nav link is a real user gesture, so window.open is allowed (unlike a
     * notification tap, which has no activation and must route through the in-app
     * #circular/#newsletter viewer's Open button — calendar-doc-viewer.js).
     * Opens a blank tab synchronously (same event tick = user gesture) so Safari
     * doesn't classify the later window.open() inside .then() as a popup.
     * Falls back to the coming-soon lightbox if no document exists or fetch fails.
     * @param {HTMLElement} triggerEl
     * @param {() => Promise<any>} fetchFn
     * @param {string} docId - open-counter id ('circular' | 'newsletter'), recorded on the success path
     */
    function _openLatestDoc(triggerEl, fetchFn, docId) {
        if (_docFetching) return;
        // THE DOCUMENT GATE (calendar-doc-access.js): refused HERE, before the blank tab is opened —
        // a tab that closes a second later reads as a fault. The message names the fix.
        if (!canReadDocuments()) {
            // The viewers' own words (calendar-doc-viewer.js), naming the document. ("Or enter the staff PIN" went
            // with the PIN, 23 Nov 2026.)
            _docFailureFallback(triggerEl, `Sign in to read the ${triggerEl.dataset.csTitle}.`);
            return;
        }
        _docFetching = true;
        // Visible in-flight state — the fetch races an 8s timeout, and on weak signal the tapped
        // link otherwise just sat there (a blank tab open in the background) reading as "broken".
        triggerEl.classList.add('nav-panel-link--loading');
        triggerEl.setAttribute('aria-busy', 'true');
        const newTab = window.open('', '_blank');
        if (newTab) newTab.opener = null;
        // Race the fetch against a timeout: a wedged promise would leave _docFetching stuck true,
        // killing BOTH doc links and orphaning the blank tab. On timeout the .catch closes the tab.
        const timed = new Promise((_res, reject) =>
            setTimeout(() => reject(new Error('doc-fetch-timeout')), DOC_FETCH_BUDGET_MS));
        // Wait for a Firebase session before reading (AUTH_AND_SESSIONS.md → "The two-phase load (E1)"): the document collections
        // require access, so a read fired before the session lands is refused. BOUNDED, not plain:
        // the in-place-login pages leave `sessionReady` UNRESOLVED until the user signs in, so a plain
        // await sat a signed-out tap through the whole 8s race. Waiting a moment then reading anyway
        // refuses a visitor with no session straight into the fallback.
        const authOrSoon = Promise.race([authReady, new Promise(r => setTimeout(r, DOC_AUTH_WAIT_MS))]);
        // The short-lived url is requested ALONGSIDE the document read (the server picks the latest
        // itself) and never rejects (document-url.js). It races the SAME budget as the read, or a token
        // refresh on a weak signal holds the blank tab far past it. Out of time, the stored url opens.
        const signedP = Promise.race([
            authOrSoon.then(() => fetchSignedDocumentUrl(/** @type {any} */ (docId))),
            new Promise(r => setTimeout(() => r(null), DOC_FETCH_BUDGET_MS)),
        ]);
        Promise.race([authOrSoon.then(() => fetchFn()), timed]).then(/** @param {any} data */ async data => {
            // The issue just read is the latest the ☰ menu should offer (newsletter-recency.js): kept, as
            // the Calendar's own check and its viewer keep it (review, 22 Nov 2026).
            if (docId === 'newsletter') recordLatestNewsletter(data?.date ?? null);
            const url = data?.storageUrl;
            const safeUrl = isSafeStorageUrl(url) ? url : null;
            if (safeUrl) {
                // ── THE SHORT-LIVED URL, AND WHY AWAITING IS SAFE *HERE* ─────────────────────────
                // Elsewhere awaiting inside a click handler spends the user gesture; here `newTab` was
                // opened ON the gesture, above, so there is no gesture left to lose. `docId` is the KIND
                // the endpoint takes; a null is ordinary (no IAM grant, lapsed claim, timeout) and the
                // stored url is then used.
                const signed = await signedP;
                const open = resolveDocumentOpenUrl({ signed, stored: safeUrl, fileType: data.fileType, storagePath: data.storagePath });
                // Unreachable while `safeUrl` is non-null, but this branch hands a url to window.open,
                // so it fails closed: the pre-opened tab is CLOSED, as on the no-document path below.
                if (!open) { if (newTab) newTab.close(); return _docFailureFallback(triggerEl); }
                const openUrl = open.url;
                if (newTab) {
                    // The document genuinely opens — count it (anonymous, admin-excluded). The other
                    // branch hands over to the in-app viewer, whose own Open button counts.
                    recordOpen(docId, _usageId);
                    // A SEPARATE tab — this page stays, so close with a real history.back() to CONSUME
                    // the drawer's entry (a dead same-URL entry would swallow the next Back)…
                    newTab.location.href = openUrl;
                    // …but ONLY if the drawer is still the open surface, and still this one (as _docFailureFallback).
                    if (isPanelOpen() && panel.isConnected !== false) closePanel();
                } else {
                    // NO TAB CAME BACK — a popup blocker, or a home-screen app on iOS (iOS audit B5).
                    // Navigating THIS page to the storage url left an installed app on a bare PDF with
                    // no way back, so hand over to the Calendar's in-app viewer (calendar-doc-viewer.js,
                    // the notification tap's route). On the Calendar that is a hash change after the
                    // drawer's Back echo; elsewhere a navigation, and the drawer's entry goes with the page.
                    if (panel.isConnected === false) {
                        // The drawer the tap came from has been rebuilt: nothing of it is left to hand over from.
                    } else if (isPanelOpen() && _onCalendarPage()) {
                        closePanel();
                        // The hash alone, never `./#…` (24-hour review) — see `_onCalendarPage`.
                        whenHistorySettled(() => { location.hash = docId; });
                    } else {
                        // THROUGH THE DRAWER'S OWN LINK PATH: `location.href` would skip the unsaved-work
                        // question (page-session.js watches `.nav-panel a[href]`); a hidden panel link is asked.
                        const handoff = /** @type {HTMLAnchorElement} */ (panel.querySelector('a[data-doc-handoff]')
                            ?? panel.appendChild(Object.assign(document.createElement('a'), { className: 'nav-panel-link', hidden: true })));
                        handoff.setAttribute('data-doc-handoff', ''); handoff.href = `./#${docId}`; handoff.click();
                    }
                }
            } else {
                if (newTab) newTab.close();
                // An uploaded document whose link this app will not open is not "none uploaded yet" —
                // the in-app viewer says the same (calendar-doc-viewer.js, whole-app check 17 Nov 2026).
                _docFailureFallback(triggerEl, data ? `The latest ${triggerEl.dataset.csTitle} can’t be opened — please tell the admin.` : undefined);
            }
        }).catch((/** @type {any} */ err) => {
            if (newTab) newTab.close();
            // AN ACCESS REFUSAL IS NOT A CONNECTION FAULT (`isAccessFailure`, claim-retry.js). The gate
            // above answers a page that knows it has no access; this is the SERVER refusing one that
            // thought it had (review, 22 Nov 2026).
            _docFailureFallback(triggerEl, isAccessFailure(err)
                ? 'Couldn’t open — your sign-in may have ended. Sign in again to read it.'
                : 'Couldn’t connect — check your connection and try again.');
        }).finally(() => {
            triggerEl.classList.remove('nav-panel-link--loading');
            triggerEl.removeAttribute('aria-busy');
            _docFetching = false;
        });
    }

    return _openLatestDoc;
}
